-- journey-active-since.sql — id ลูกค้าปัจจุบัน (placeholder ที่รวมแล้วชี้ไปคนจริง) ที่ขยับตั้งแต่ $1 — cron journey:recompute
-- $1 text เวลา ISO UTC · 🚨 ห้าม now()
WITH hits AS (
  SELECT c.id AS member_id FROM customers c WHERE c.updated_at >= $1::timestamp
  UNION SELECT e.customer_id FROM customer_journey_entries e WHERE e.created_at >= $1::timestamp OR e.deleted_at >= $1::timestamp
  UNION SELECT r.customer_id FROM chat_rooms r WHERE r.updated_at >= $1::timestamp
  UNION SELECT r.customer_id FROM chat_messages m JOIN chat_rooms r ON r.id = m.room_id WHERE m.created_at >= $1::timestamp
  UNION SELECT r.customer_id FROM todos td JOIN chat_rooms r ON r.id = td.room_id WHERE td.updated_at >= $1::timestamp
  UNION SELECT r.customer_id FROM room_credit_analyses rca JOIN chat_rooms r ON r.id = rca.room_id WHERE rca.updated_at >= $1::timestamp
  UNION SELECT k.customer_id FROM contracts k WHERE k.updated_at >= $1::timestamp
  UNION SELECT s.customer_id FROM sales s WHERE s.updated_at >= $1::timestamp
  UNION SELECT cc.customer_id FROM credit_checks cc WHERE cc.updated_at >= $1::timestamp
  UNION SELECT b.customer_id FROM bookings b WHERE b.updated_at >= $1::timestamp
  UNION SELECT l.customer_id FROM customer_line_links l WHERE l.updated_at >= $1::timestamp
  UNION SELECT a.customer_id FROM online_installment_applications a WHERE a.updated_at >= $1::timestamp
  UNION SELECT pr.customer_id FROM product_reservations pr WHERE pr.updated_at >= $1::timestamp
  UNION SELECT ti.customer_id FROM trade_ins ti WHERE ti.updated_at >= $1::timestamp
  UNION SELECT al.entity_id FROM audit_logs al WHERE al.action = 'AI_LEAD_CAPTURED' AND al.entity = 'customer' AND al.created_at >= $1::timestamp
)
SELECT DISTINCT COALESCE(c.merged_into_id, c.id) AS customer_id
FROM hits h
JOIN customers c ON c.id = h.member_id
