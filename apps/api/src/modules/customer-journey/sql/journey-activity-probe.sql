-- journey-activity-probe.sql — ลูกค้าชุดนี้มีอะไรขยับหลัง $2 ไหม (summary ใช้ตัดสินว่าแคชที่เก่ากว่า 15 นาทีต้อง recompute)
-- $1 text[] id ลูกค้า + placeholder ที่รวมเข้ามา · $2 text เวลา ISO UTC · 🚨 ห้าม now() · PDPA: อ่านแค่เวลา
SELECT (
  EXISTS (SELECT 1 FROM customers c WHERE c.id = ANY($1::text[]) AND c.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM customer_journey_entries e WHERE e.customer_id = ANY($1::text[]) AND (e.created_at > $2::timestamp OR e.deleted_at > $2::timestamp))
  OR EXISTS (SELECT 1 FROM chat_rooms r WHERE r.customer_id = ANY($1::text[]) AND r.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM chat_rooms r JOIN chat_messages m ON m.room_id = r.id WHERE r.customer_id = ANY($1::text[]) AND m.created_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM chat_rooms r JOIN todos td ON td.room_id = r.id WHERE r.customer_id = ANY($1::text[]) AND td.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM chat_rooms r JOIN room_credit_analyses rca ON rca.room_id = r.id WHERE r.customer_id = ANY($1::text[]) AND rca.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM contracts k WHERE k.customer_id = ANY($1::text[]) AND k.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = ANY($1::text[]) AND s.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM credit_checks cc WHERE cc.customer_id = ANY($1::text[]) AND cc.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id = ANY($1::text[]) AND b.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM customer_line_links l WHERE l.customer_id = ANY($1::text[]) AND l.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM online_installment_applications a WHERE a.customer_id = ANY($1::text[]) AND a.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM product_reservations pr WHERE pr.customer_id = ANY($1::text[]) AND pr.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM trade_ins ti WHERE ti.customer_id = ANY($1::text[]) AND ti.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM audit_logs al WHERE al.entity = 'customer' AND al.entity_id = ANY($1::text[]) AND al.action = 'AI_LEAD_CAPTURED' AND al.created_at > $2::timestamp)
) AS active
