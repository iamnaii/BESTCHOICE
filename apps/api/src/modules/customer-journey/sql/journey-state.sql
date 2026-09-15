-- journey-state.sql — คำนวณแคช customer_journey_states ใหม่ทั้งแถวของลูกค้าชุดหนึ่ง (recompute / cron / CLI backfill ใช้ไฟล์เดียวนี้)
-- $1 text[] id ลูกค้า (แถวที่ถูกลบถูกข้าม) · $2 text[] CUSTOMER_BOUGHT_CONTRACT_STATUSES · $3 text[] CUSTOMER_BOUGHT_SALE_TYPES · $4 text เวลาคำนวณ ISO UTC
-- 🚨 คอลัมน์เวลาเป็น timestamp without time zone เก็บ UTC และ session อาจเป็น Asia/Bangkok ⇒ ห้าม now()/timestamptz
-- 🚨 PDPA: ไม่อ่าน content ของ chat_messages / note ของ entries · phone, national_id ใช้แค่ IS NOT NULL
WITH target AS (
  SELECT c.id, c.created_at, c.updated_at, c.acquisition_source, c.referred_by_id,
         (c.phone IS NOT NULL OR c.national_id IS NOT NULL) AS has_contact,
         CASE WHEN left(c.acquisition_source, 5) = 'CHAT_' THEN NULL ELSE c.created_at END AS walk_in_at
  FROM customers c
  WHERE c.id = ANY($1::text[]) AND c.deleted_at IS NULL
),
family AS (
  SELECT t.id AS customer_id, t.id AS member_id FROM target t
  UNION ALL
  SELECT m.merged_into_id, m.id FROM customers m JOIN target t ON m.merged_into_id = t.id
),
rooms AS (
  SELECT f.customer_id, r.id AS room_id, r.channel::text AS channel, r.created_at, r.attribution_id,
         cm.first_customer_at, cm.last_customer_at
  FROM family f
  JOIN chat_rooms r ON r.customer_id = f.member_id
  LEFT JOIN LATERAL (
    SELECT MIN(m.created_at) AS first_customer_at, MAX(m.created_at) AS last_customer_at
    FROM chat_messages m
    WHERE m.room_id = r.id AND m.role = 'CUSTOMER'
  ) cm ON true
),
earliest_room AS (
  SELECT DISTINCT ON (ro.customer_id)
         ro.customer_id, ro.channel, LEAST(ro.created_at, ro.first_customer_at) AS first_at,
         ac.id AS ad_campaign_id, ac.campaign_id AS ad_platform_campaign_id
  FROM rooms ro
  LEFT JOIN ads_attributions aa ON aa.id = ro.attribution_id
  LEFT JOIN ads_campaigns ac ON ac.id = aa.campaign_id
  ORDER BY ro.customer_id, LEAST(ro.created_at, ro.first_customer_at), ro.room_id
),
room_agg AS (
  SELECT ro.customer_id, MAX(ro.last_customer_at) AS last_customer_at FROM rooms ro GROUP BY ro.customer_id
),
auto_anchor AS MATERIALIZED (
  -- MATERIALIZED: ถ้าปล่อย inline ใน NOT EXISTS ของ staff_reply จะคำนวณ anchor ซ้ำต่อแถว STAFF (วัดบน prod ชุด 500 คน: 2.0 วิ → 0.45 วิ)
  -- จุดเริ่มช่วงข้อความอัตโนมัติของเพจ (instant reply / away message / ตอบตาม keyword) — ยึดทุกครั้งที่ลูกค้าทัก
  -- ไม่ใช่แค่คำตอบใบแรกของห้อง (ยึดใบแรกของห้อง ⇒ away message ตอนลูกค้ากลับมารอบหลังหลุดไปนับ และค่าที่เร็วไปแช่แข็งถาวร)
  -- anchor = echo (มี external_message_id ไม่มี outbound_sent_at) ที่
  --   (ก) ออกหลังข้อความลูกค้าไม่เกิน 10 วิ — echo หลังลูกค้าเปิดรอบใหม่บน prod กระจุก 0–6 วิ ร่องที่ 7–9 วิ
  --       แล้วเป็นเส้นคนตอบตั้งแต่ ~10 วิ ⇒ คนที่ตอบ 10–60 วิหลังลูกค้า (ไม่มีข้อความอัตโนมัติคั่น) นับ
  --   (ข) หรือบันทึกก่อนข้อความลูกค้าไม่เกิน 10 วิ และไม่มีข้อความลูกค้าเลยใน 30 นาทีก่อน echo — race ของ greeting:
  --       webhook await echo ทันที แต่ routeInbound ไม่ await และดึงโปรไฟล์ Graph ก่อน saveMessage (prod: กระจุก 0–2 วิ)
  --       ด่าน 30 นาทีกันคำตอบของคนที่ลูกค้าตอบกลับเร็ว หรือข้อความลูกค้าที่ค้างคิวต่อลูกค้าแล้วถูกบันทึกหลัง echo
  -- ใช้เฉพาะแถวที่มีสิทธิ์ถูกนับ (STAFF echo) — BOT และส่งจาก inbox (outbound_sent_at = คนกดส่ง) ไม่เป็น anchor
  SELECT a.room_id, a.created_at AS anchor_at
  FROM chat_messages a
  WHERE a.room_id IN (SELECT ro.room_id FROM rooms ro)
    AND a.role = 'STAFF' AND a.outbound_sent_at IS NULL AND a.external_message_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM chat_messages c
        WHERE c.room_id = a.room_id AND c.role = 'CUSTOMER'
          AND c.created_at BETWEEN a.created_at - interval '10 seconds' AND a.created_at
      )
      OR (
        EXISTS (
          SELECT 1 FROM chat_messages c
          WHERE c.room_id = a.room_id AND c.role = 'CUSTOMER'
            AND c.created_at > a.created_at AND c.created_at <= a.created_at + interval '10 seconds'
        )
        AND NOT EXISTS (
          SELECT 1 FROM chat_messages c
          WHERE c.room_id = a.room_id AND c.role = 'CUSTOMER'
            AND c.created_at BETWEEN a.created_at - interval '30 minutes' AND a.created_at
        )
      )
    )
),
staff_reply AS (
  -- "ถึงลูกค้าจริง" มีสองทาง: ส่งจาก inbox สำเร็จ = markOutboundSent stamp outbound_sent_at (LINE ไม่คืน message id)
  -- · echo จากเพจ (พนักงานตอบใน Meta Business Suite/แอป Page + ข้อความอัตโนมัติของเพจ) = mirrorOutbound เก็บ mid ไว้ใน
  -- external_message_id โดยไม่มี outbound_sent_at · ส่งจาก inbox ที่ล้มเหลือแถวไว้โดยไม่มีทั้งสองคอลัมน์ (save-before-send) จึงไม่นับ
  -- ข้าม echo ทุกใบที่ออกภายใน 60 วิหลัง anchor ใดก็ได้ของห้อง (รวมตัว anchor เอง) — ข้อความอัตโนมัติมาหลาย bubble ได้
  -- (ข้อความ + รูป / instant reply + away message) · ส่งจาก inbox (outbound_sent_at) = คนกดส่งเสมอ จึงไม่ถูกข้าม
  -- ต่อยอดจาก RoomManagerService.shouldSkipFirstOutboundClear (คิวรอตอบ — กติกาแยก ข้ามเฉพาะใบแรกของห้อง)
  -- ทิศที่เลือก: ข้ามเกิน (คนตอบภายใน 60 วิหลังข้อความอัตโนมัติ) = ค่าช้าไป กู้ได้ด้วย LEAST เมื่อผ่อนกติกา ·
  -- นับเกิน = ค่าเร็วไป ถูกแช่แข็งถาวร (ดู ON CONFLICT ด้านล่าง)
  -- ที่ยังรู้ตัว (prod 2026-09-15 ห้อง Facebook): ~11 ห้องจาก ~7.6 พันได้ค่าที่ห่างข้อความลูกค้า ≤3 วิ — ลูกค้าส่งตามหลัง echo
  -- ทั้งที่มีข้อความลูกค้าใน 30 นาทีก่อนหน้า (แยกคนตอบ+คิวค้าง ออกจาก keyword response ไม่ได้จาก metadata) · ห้องที่เพจทักก่อน
  -- โดยลูกค้าไม่เคยส่งข้อความเลย (~59 ห้อง) ยังได้ค่า เพราะไม่มีข้อความลูกค้าให้ยึด
  SELECT ro.customer_id, MIN(m.created_at) AS first_staff_reply_at
  FROM rooms ro
  JOIN chat_messages m ON m.room_id = ro.room_id AND m.role = 'STAFF'
   AND (m.outbound_sent_at IS NOT NULL OR m.external_message_id IS NOT NULL)
  WHERE m.outbound_sent_at IS NOT NULL
     OR NOT EXISTS (
       SELECT 1 FROM auto_anchor aa
       WHERE aa.room_id = m.room_id AND m.created_at BETWEEN aa.anchor_at AND aa.anchor_at + interval '60 seconds'
     )
  GROUP BY ro.customer_id
),
-- บันทึกการเดินทางอ่านผ่าน family (ลูกค้า + placeholder ที่ merged_into_id ชี้มา) เหมือนตัวอ่านอื่นทุกตัว —
-- แถวที่ค้างใต้ id ของ placeholder (เช่น ถอย image ระหว่างทาง แล้วซ่อมด้วยการเติม merged_into_id) ยังนับเข้าแคชของคนจริง
entry_agg AS (
  SELECT f.customer_id,
         MIN(e.occurred_at) FILTER (WHERE e.kind IN ('CONTACT_ADDED', 'LINE_LINKED', 'PLACEHOLDER_MERGED')) AS identified_entry_at,
         MIN(e.occurred_at) FILTER (WHERE e.kind = 'TOUCHPOINT' AND e.outcome IN ('APPOINTED', 'VISITED')) AS manual_interest_at,
         MAX(e.occurred_at) FILTER (WHERE e.kind = 'TOUCHPOINT') AS last_touch_at
  FROM customer_journey_entries e
  JOIN family f ON f.member_id = e.customer_id
  WHERE e.deleted_at IS NULL
  GROUP BY f.customer_id
),
activated AS (
  SELECT f.customer_id, MIN(e.occurred_at) AS at
  FROM customer_journey_entries e
  JOIN family f ON f.member_id = e.customer_id
  JOIN contracts k ON k.id = e.ref_id AND k.deleted_at IS NULL
  WHERE e.kind = 'CONTRACT_ACTIVATED' AND e.deleted_at IS NULL
  GROUP BY f.customer_id
),
heard AS (
  SELECT DISTINCT ON (f.customer_id) f.customer_id, e.heard_from
  FROM customer_journey_entries e
  JOIN family f ON f.member_id = e.customer_id
  WHERE e.kind = 'HEARD_FROM' AND e.deleted_at IS NULL AND e.heard_from IS NOT NULL
  ORDER BY f.customer_id, e.occurred_at DESC, e.id DESC
),
lost_mark AS (
  SELECT DISTINCT ON (f.customer_id) f.customer_id, e.kind, e.occurred_at, e.lost_reason
  FROM customer_journey_entries e
  JOIN family f ON f.member_id = e.customer_id
  WHERE e.kind IN ('MARKED_LOST', 'REOPENED') AND e.deleted_at IS NULL
  ORDER BY f.customer_id, e.occurred_at DESC, e.id DESC
),
line_agg AS (
  SELECT f.customer_id, MIN(l.linked_at) AS linked_at
  FROM family f JOIN customer_line_links l ON l.customer_id = f.member_id
  WHERE l.unlinked_at IS NULL AND l.deleted_at IS NULL
  GROUP BY f.customer_id
),
merged_agg AS (
  SELECT m.merged_into_id AS customer_id, MIN(m.deleted_at) AS merged_at
  FROM customers m JOIN target t ON t.id = m.merged_into_id
  GROUP BY m.merged_into_id
),
interest_agg AS (
  SELECT f.customer_id, MIN(x.at) AS at
  FROM family f
  CROSS JOIN LATERAL (
    SELECT b.created_at AS at FROM bookings b WHERE b.customer_id = f.member_id AND b.deleted_at IS NULL
    UNION ALL
    SELECT a.created_at FROM online_installment_applications a WHERE a.customer_id = f.member_id AND a.deleted_at IS NULL
    UNION ALL
    SELECT pr.reserved_at FROM product_reservations pr WHERE pr.customer_id = f.member_id
    UNION ALL
    SELECT ti.created_at FROM trade_ins ti WHERE ti.customer_id = f.member_id AND ti.deleted_at IS NULL
    UNION ALL
    SELECT al.created_at FROM audit_logs al WHERE al.entity = 'customer' AND al.entity_id = f.member_id AND al.action = 'AI_LEAD_CAPTURED'
  ) x
  GROUP BY f.customer_id
),
todo_agg AS (
  SELECT ro.customer_id, MIN(td.created_at) AS at
  FROM rooms ro JOIN todos td ON td.room_id = ro.room_id
  WHERE td.due_date IS NOT NULL AND td.deleted_at IS NULL
  GROUP BY ro.customer_id
),
credit_agg AS (
  SELECT f.customer_id, MIN(x.at) AS at
  FROM family f
  CROSS JOIN LATERAL (
    SELECT cc.created_at AS at FROM credit_checks cc WHERE cc.customer_id = f.member_id AND cc.deleted_at IS NULL
    UNION ALL
    SELECT k.created_at FROM contracts k WHERE k.customer_id = f.member_id AND k.deleted_at IS NULL
  ) x
  GROUP BY f.customer_id
),
room_credit_agg AS (
  SELECT ro.customer_id, MIN(rca.created_at) AS at
  FROM rooms ro JOIN room_credit_analyses rca ON rca.room_id = ro.room_id
  WHERE rca.status = 'COMPLETED' AND rca.deleted_at IS NULL
  GROUP BY ro.customer_id
),
purchase AS (
  -- predicate เดียวกับ BOUGHT_WHERE (customer-query.service.ts) — รายการสถานะฉีดจาก @installment/shared
  SELECT t.id AS customer_id,
         (EXISTS (SELECT 1 FROM contracts k WHERE k.customer_id = t.id AND k.deleted_at IS NULL AND k.status::text = ANY($2::text[]))
          OR EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = t.id AND s.deleted_at IS NULL AND s.sale_type::text = ANY($3::text[]))) AS bought,
         (SELECT MIN(s.created_at) FROM sales s
           WHERE s.customer_id = t.id AND s.deleted_at IS NULL AND s.sale_type = 'CASH' AND s.sale_type::text = ANY($3::text[])) AS cash_at,
         (SELECT MIN(s.created_at) FROM sales s
           WHERE s.customer_id = t.id AND s.deleted_at IS NULL AND s.sale_type = 'EXTERNAL_FINANCE' AND s.sale_type::text = ANY($3::text[])) AS external_at,
         (SELECT MIN(s.created_at) FROM sales s JOIN contracts k ON k.id = s.contract_id AND k.deleted_at IS NULL
           WHERE s.customer_id = t.id AND s.deleted_at IS NULL AND s.sale_type = 'INSTALLMENT') AS installment_sale_at,
         (SELECT MIN(k.created_at) FROM contracts k
           WHERE k.customer_id = t.id AND k.deleted_at IS NULL AND k.status::text = ANY($2::text[])) AS bought_contract_at
  FROM target t
),
base AS (
  SELECT t.id AS customer_id,
         COALESCE(LEAST(er.first_at, t.walk_in_at), t.created_at) AS contacted_at,
         (er.first_at IS NOT NULL AND (t.walk_in_at IS NULL OR er.first_at <= t.walk_in_at)) AS chat_first,
         er.channel AS first_room_channel, er.ad_campaign_id, er.ad_platform_campaign_id,
         t.acquisition_source, t.referred_by_id,
         CASE WHEN t.has_contact OR la.linked_at IS NOT NULL OR ma.merged_at IS NOT NULL OR ea.identified_entry_at IS NOT NULL
              THEN LEAST(ea.identified_entry_at,
                         CASE WHEN t.has_contact THEN COALESCE(t.walk_in_at, t.updated_at) END,
                         la.linked_at, ma.merged_at)
         END AS identified_at,
         LEAST(ia.at, ta.at, ea.manual_interest_at) AS interested_at,
         LEAST(ca.at, rca.at) AS credit_at,
         p.bought, p.cash_at, p.external_at,
         COALESCE(LEAST(act.at, p.installment_sale_at), p.bought_contract_at) AS installment_at,
         sr.first_staff_reply_at, ra.last_customer_at, ea.last_touch_at, h.heard_from,
         lm.kind AS lost_kind, lm.occurred_at AS lost_mark_at, lm.lost_reason AS lost_mark_reason
  FROM target t
  JOIN purchase p ON p.customer_id = t.id
  LEFT JOIN earliest_room er ON er.customer_id = t.id
  LEFT JOIN room_agg ra ON ra.customer_id = t.id
  LEFT JOIN staff_reply sr ON sr.customer_id = t.id
  LEFT JOIN entry_agg ea ON ea.customer_id = t.id
  LEFT JOIN activated act ON act.customer_id = t.id
  LEFT JOIN heard h ON h.customer_id = t.id
  LEFT JOIN lost_mark lm ON lm.customer_id = t.id
  LEFT JOIN line_agg la ON la.customer_id = t.id
  LEFT JOIN merged_agg ma ON ma.customer_id = t.id
  LEFT JOIN interest_agg ia ON ia.customer_id = t.id
  LEFT JOIN todo_agg ta ON ta.customer_id = t.id
  LEFT JOIN credit_agg ca ON ca.customer_id = t.id
  LEFT JOIN room_credit_agg rca ON rca.customer_id = t.id
),
shaped AS (
  SELECT b.*,
         CASE WHEN b.bought THEN LEAST(b.cash_at, b.external_at, b.installment_at) END AS first_purchase_at,
         CASE WHEN NOT b.bought THEN NULL
              WHEN b.installment_at IS NOT NULL AND b.installment_at <= COALESCE(LEAST(b.cash_at, b.external_at), b.installment_at) THEN 'INSTALLMENT'
              WHEN b.cash_at IS NOT NULL AND b.cash_at <= COALESCE(b.external_at, b.cash_at) THEN 'CASH'
              ELSE 'EXTERNAL_FINANCE' END AS first_purchase_kind,
         CASE WHEN b.chat_first THEN 'CHAT_' || b.first_room_channel
              WHEN left(b.acquisition_source, 5) = 'CHAT_' THEN left(b.acquisition_source, 20)
              WHEN b.referred_by_id IS NOT NULL THEN 'REFERRAL'
              ELSE 'WALK_IN' END AS first_channel,
         CASE WHEN b.chat_first THEN b.ad_campaign_id END AS first_ad_campaign_id
  FROM base b
),
resolved AS (
  SELECT s.*,
         CASE WHEN s.first_ad_campaign_id IS NOT NULL THEN left('AD:' || s.ad_platform_campaign_id, 30)
              WHEN left(s.first_channel, 5) = 'CHAT_' THEN s.first_channel
              WHEN s.referred_by_id IS NOT NULL THEN 'REFERRAL'
              WHEN s.heard_from IS NOT NULL THEN left('HEARD:' || s.heard_from, 30)
              ELSE 'WALK_IN' END AS first_source,
         CASE WHEN s.bought THEN 'PURCHASED'
              WHEN s.credit_at IS NOT NULL THEN 'CREDIT'
              WHEN s.interested_at IS NOT NULL THEN 'INTERESTED'
              WHEN s.identified_at IS NOT NULL THEN 'IDENTIFIED'
              ELSE 'CONTACTED' END AS stage,
         CASE WHEN s.bought THEN s.first_purchase_kind
              WHEN s.credit_at IS NOT NULL THEN 'INSTALLMENT'
              ELSE 'UNKNOWN' END AS path,
         CASE WHEN s.lost_kind = 'MARKED_LOST' AND NOT s.bought
                   AND (s.last_customer_at IS NULL OR s.last_customer_at <= s.lost_mark_at)
                   AND (s.last_touch_at IS NULL OR s.last_touch_at <= s.lost_mark_at)
              THEN s.lost_mark_at END AS lost_at
  FROM shaped s
)
INSERT INTO customer_journey_states (
  customer_id, stage, stage_entered_at, path, contacted_at, identified_at, interested_at, credit_at,
  first_purchase_at, first_purchase_kind, first_staff_reply_at, first_channel, first_source, first_ad_campaign_id,
  heard_from, last_customer_at, last_touch_at, lost_at, lost_reason, computed_at
)
SELECT r.customer_id, r.stage,
       CASE r.stage WHEN 'PURCHASED' THEN r.first_purchase_at WHEN 'CREDIT' THEN r.credit_at
                    WHEN 'INTERESTED' THEN r.interested_at WHEN 'IDENTIFIED' THEN r.identified_at
                    ELSE r.contacted_at END,
       r.path, r.contacted_at, r.identified_at, r.interested_at, r.credit_at,
       r.first_purchase_at, r.first_purchase_kind, r.first_staff_reply_at, r.first_channel, r.first_source, r.first_ad_campaign_id,
       r.heard_from, r.last_customer_at, r.last_touch_at, r.lost_at,
       CASE WHEN r.lost_at IS NOT NULL THEN r.lost_mark_reason END,
       $4::timestamp
FROM resolved r
-- ล็อกแถวแคชเรียงตาม customer_id เสมอ — recompute หลายชุดพร้อมกัน (cron หลาย instance / CLI / summary)
-- และ freezeJourneyOrigin ในทรานแซกชันรวมผู้สนใจ แตะแถวลำดับเดียวกัน จึงไม่ deadlock กันเอง
ORDER BY r.customer_id
ON CONFLICT (customer_id) DO UPDATE SET
  -- แช่แข็ง: เวลาเริ่มต้นไม่มีทางเลื่อนไปข้างหลัง (ข้อความ retention/ห้องนำเข้าใหม่/merge)
  contacted_at = LEAST(customer_journey_states.contacted_at, EXCLUDED.contacted_at),
  identified_at = LEAST(customer_journey_states.identified_at, EXCLUDED.identified_at),
  -- 🚨 first_staff_reply_at แช่แข็งด้วย LEAST (merge ใช้ earliest() ด้วย): ค่าที่เร็วเกินจริงเลื่อนไปข้างหน้าไม่ได้อีก ⇒
  -- ถ้าวันหน้าทำกติกา staff_reply ให้แคบลง (ตัดแถวที่เคยนับ) ต้องมี UPDATE ... SET first_staff_reply_at = NULL ใน PR เดียวกันก่อนคำนวณใหม่
  first_staff_reply_at = LEAST(customer_journey_states.first_staff_reply_at, EXCLUDED.first_staff_reply_at),
  stage_entered_at = CASE EXCLUDED.stage
    WHEN 'CONTACTED' THEN LEAST(customer_journey_states.contacted_at, EXCLUDED.contacted_at)
    WHEN 'IDENTIFIED' THEN LEAST(customer_journey_states.identified_at, EXCLUDED.identified_at)
    ELSE EXCLUDED.stage_entered_at END,
  first_channel = CASE WHEN EXCLUDED.contacted_at < customer_journey_states.contacted_at
    THEN EXCLUDED.first_channel ELSE customer_journey_states.first_channel END,
  first_ad_campaign_id = CASE WHEN EXCLUDED.contacted_at < customer_journey_states.contacted_at
    THEN EXCLUDED.first_ad_campaign_id ELSE customer_journey_states.first_ad_campaign_id END,
  first_source = CASE
    WHEN EXCLUDED.contacted_at < customer_journey_states.contacted_at THEN EXCLUDED.first_source
    -- ชั้น "ลูกค้าบอก/หน้าร้าน" อัปเดตได้เมื่อจุดเริ่มเดิม (HEARD_FROM มาทีหลังได้)
    WHEN (customer_journey_states.first_source IN ('WALK_IN', 'REFERRAL') OR customer_journey_states.first_source LIKE 'HEARD:%')
     AND (EXCLUDED.first_source IN ('WALK_IN', 'REFERRAL') OR EXCLUDED.first_source LIKE 'HEARD:%')
    THEN EXCLUDED.first_source
    ELSE customer_journey_states.first_source END,
  stage = EXCLUDED.stage,
  path = EXCLUDED.path,
  interested_at = EXCLUDED.interested_at,
  credit_at = EXCLUDED.credit_at,
  first_purchase_at = EXCLUDED.first_purchase_at,
  first_purchase_kind = EXCLUDED.first_purchase_kind,
  heard_from = EXCLUDED.heard_from,
  last_customer_at = EXCLUDED.last_customer_at,
  last_touch_at = EXCLUDED.last_touch_at,
  lost_at = EXCLUDED.lost_at,
  lost_reason = EXCLUDED.lost_reason,
  computed_at = EXCLUDED.computed_at
