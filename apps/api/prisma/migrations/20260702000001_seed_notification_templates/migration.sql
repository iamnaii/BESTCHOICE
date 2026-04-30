-- Seed 18 required notification templates
-- Idempotent via ON CONFLICT (event_type) DO NOTHING

-- Dunning escalation stages (4)
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'dunning.reminder', 'แจ้งเตือนค้างชำระ (REMINDER)', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] แจ้งเตือน: คุณ${name} มียอดค้างชำระ ${amount} บาท สัญญา ${contractNumber} กรุณาชำระโดยเร็ว',
   '{"name":"สมหมาย","amount":"1,500","contractNumber":"CT-001-2026","daysOverdue":"2"}'::jsonb,
   'Stage 1 dunning — sent at first overdue. Soft tone.', now(), now()),

  (gen_random_uuid(), 'dunning.notice', 'แจ้งค้างชำระ (NOTICE)', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] แจ้งค้างชำระ: คุณ${name} มียอดค้างชำระ ${amount} บาท ค้างชำระ ${daysOverdue} วัน กรุณาติดต่อชำระเงินทันที',
   '{"name":"สมหมาย","amount":"1,500","contractNumber":"CT-001-2026","daysOverdue":"7"}'::jsonb,
   'Stage 2 dunning — firm tone, mentions days overdue.', now(), now()),

  (gen_random_uuid(), 'dunning.final_warning', 'เตือนครั้งสุดท้าย (FINAL_WARNING)', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] เตือนครั้งสุดท้าย: คุณ${name} ค้างชำระ ${daysOverdue} วัน ยอด ${amount} บาท หากไม่ชำระภายใน 30 วัน จะดำเนินการตามกฎหมาย',
   '{"name":"สมหมาย","amount":"1,500","contractNumber":"CT-001-2026","daysOverdue":"30"}'::jsonb,
   'Stage 3 dunning — final warning before legal action.', now(), now()),

  (gen_random_uuid(), 'dunning.legal_action', 'แจ้งดำเนินการ (LEGAL_ACTION)', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] แจ้งดำเนินการ: สัญญา ${contractNumber} ค้างชำระเกิน 60 วัน ทางร้านจะดำเนินการยึดคืนสินค้า กรุณาติดต่อร้านทันที',
   '{"name":"สมหมาย","amount":"1,500","contractNumber":"CT-001-2026","daysOverdue":"60"}'::jsonb,
   'Stage 4 dunning — legal action notice.', now(), now())
ON CONFLICT (event_type) DO NOTHING;

-- Pre-due reminders (2)
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'payment.due_in_3_days', 'เตือนก่อนถึงงวด 3 วัน', 'REMINDER', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] แจ้งเตือน: คุณ${name} งวดที่ ${installmentNo} (${amount} บาท) ครบกำหนด ${dueDate} (อีก 3 วัน)',
   '{"name":"สมหมาย","amount":"1,500","installmentNo":"3","dueDate":"5 พ.ค. 2569"}'::jsonb,
   'Sent 3 days before due date.', now(), now()),

  (gen_random_uuid(), 'payment.due_in_1_day', 'เตือนก่อนถึงงวด 1 วัน', 'REMINDER', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] เตือนความจำ: คุณ${name} งวดที่ ${installmentNo} (${amount} บาท) ครบกำหนดพรุ่งนี้ ${dueDate}',
   '{"name":"สมหมาย","amount":"1,500","installmentNo":"3","dueDate":"5 พ.ค. 2569"}'::jsonb,
   'Sent 1 day before due date.', now(), now())
ON CONFLICT (event_type) DO NOTHING;

-- Overdue notices (3)
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'payment.overdue_day_1', 'แจ้งค้างชำระ วันที่ 1', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] คุณ${name} ค้างชำระงวดที่ ${installmentNo} ยอด ${amount} บาท (เลยกำหนด 1 วัน) กรุณาชำระโดยเร็ว',
   '{"name":"สมหมาย","amount":"1,500","installmentNo":"3","contractNumber":"CT-001-2026"}'::jsonb,
   'Sent on day 1 overdue.', now(), now()),

  (gen_random_uuid(), 'payment.overdue_day_3', 'แจ้งค้างชำระ วันที่ 3', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] คุณ${name} ค้างชำระมาแล้ว 3 วัน ยอด ${amount} บาท กรุณาติดต่อร้านเพื่อชำระเงิน',
   '{"name":"สมหมาย","amount":"1,500","installmentNo":"3","contractNumber":"CT-001-2026"}'::jsonb,
   'Sent on day 3 overdue.', now(), now()),

  (gen_random_uuid(), 'payment.overdue_day_7', 'แจ้งค้างชำระ วันที่ 7', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] คุณ${name} ค้างชำระมาแล้ว 7 วัน ยอด ${amount} บาท หากไม่ชำระภายใน 7 วันถัดไป สถานะสัญญาอาจถูกปรับเป็น OVERDUE',
   '{"name":"สมหมาย","amount":"1,500","installmentNo":"3","contractNumber":"CT-001-2026"}'::jsonb,
   'Sent on day 7 overdue.', now(), now())
ON CONFLICT (event_type) DO NOTHING;

-- Status change (2)
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'contract.status_overdue', 'แจ้งสัญญาถูกปรับเป็น OVERDUE', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] สัญญา ${contractNumber} ของคุณ${name} ถูกปรับสถานะเป็น OVERDUE เนื่องจากค้างชำระเกินกำหนด ยอดรวมค้างชำระ ${totalOverdue} บาท กรุณาติดต่อร้านทันที',
   '{"name":"สมหมาย","contractNumber":"CT-001-2026","totalOverdue":"4,500","daysOverdue":"15"}'::jsonb,
   'When contract status changes to OVERDUE.', now(), now()),

  (gen_random_uuid(), 'contract.status_default', 'แจ้งสัญญาถูกปรับเป็น DEFAULT', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] สัญญา ${contractNumber} ของคุณ${name} ถูกปรับสถานะเป็น DEFAULT (ผิดนัดชำระ) ทางร้านจะดำเนินการตามขั้นตอนต่อไป กรุณาติดต่อร้านด่วน',
   '{"name":"สมหมาย","contractNumber":"CT-001-2026","totalOverdue":"4,500","daysOverdue":"60"}'::jsonb,
   'When contract status changes to DEFAULT.', now(), now())
ON CONFLICT (event_type) DO NOTHING;

-- Auto payment link (1)
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'payment.auto_link', 'ส่งลิงก์ชำระเงิน', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] คุณ${name} ลิงก์สำหรับชำระค่างวดที่ ${installmentNo} (${amount} บาท): ${paymentUrl}',
   '{"name":"สมหมาย","amount":"1,500","installmentNo":"3","paymentUrl":"https://pay.example.com/abc"}'::jsonb,
   'Auto-generated payment link sent to customer.', now(), now())
ON CONFLICT (event_type) DO NOTHING;

-- MDM lock notice (1)
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'mdm.lock_notice', 'แจ้งเตือนล็อคเครื่อง', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] เครื่องของคุณ${name} ภายใต้สัญญา ${contractNumber} ได้ถูกล็อคเนื่องจากค้างชำระ ${daysOverdue} วัน กรุณาชำระเงินเพื่อปลดล็อค',
   '{"name":"สมหมาย","contractNumber":"CT-001-2026","daysOverdue":"45"}'::jsonb,
   'When MDM auto-locks customer device.', now(), now())
ON CONFLICT (event_type) DO NOTHING;

-- Staff alerts (5)
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'staff.manager_overdue_summary', 'สรุปสัญญาค้างชำระ (manager)', 'STAFF', 'line-staff', 'LINE', 'text',
   'สรุปสัญญาค้างชำระวันนี้ (${date}): ${count} สัญญา, รวม ${totalAmount} บาท. รายละเอียด: ${listSummary}',
   '{"date":"30 เม.ย. 2569","count":"15","totalAmount":"75,000","listSummary":"CT-001 / CT-002 / CT-003..."}'::jsonb,
   'Daily manager summary at 09:30 ICT.', now(), now()),

  (gen_random_uuid(), 'staff.owner_default_alert', 'แจ้งสัญญา DEFAULT (owner)', 'STAFF', 'line-staff', 'LINE', 'text',
   'แจ้ง: สัญญา ${contractNumber} ของลูกค้า ${name} ถูกปรับเป็น DEFAULT — ค้างชำระ ${daysOverdue} วัน',
   '{"contractNumber":"CT-001-2026","name":"สมหมาย","daysOverdue":"60"}'::jsonb,
   'Owner alert when contract defaults.', now(), now()),

  (gen_random_uuid(), 'staff.daily_report', 'รายงานสรุปวัน', 'STAFF', 'line-staff', 'LINE', 'text',
   'รายงาน ${date}: ขายสด ${cashSales} บาท / ผ่อน ${hpSales} บาท / รับชำระ ${received} บาท / สัญญาใหม่ ${newContracts} ฉบับ',
   '{"date":"30 เม.ย. 2569","cashSales":"50,000","hpSales":"125,000","received":"35,000","newContracts":"3"}'::jsonb,
   'Daily summary at 23:55 ICT.', now(), now()),

  (gen_random_uuid(), 'staff.weekly_report', 'รายงานสรุปสัปดาห์', 'STAFF', 'line-staff', 'LINE', 'text',
   'สรุปสัปดาห์ ${weekStart}-${weekEnd}: ยอดขายรวม ${totalSales} / รับชำระ ${totalReceived} / ค้างชำระ ${totalOverdue}',
   '{"weekStart":"24 เม.ย.","weekEnd":"30 เม.ย.","totalSales":"500,000","totalReceived":"125,000","totalOverdue":"75,000"}'::jsonb,
   'Weekly summary every Monday 00:05 ICT.', now(), now()),

  (gen_random_uuid(), 'staff.daily_line_report', 'รายงาน LINE OA', 'STAFF', 'line-staff', 'LINE', 'text',
   'LINE OA ${date}: ส่งสำเร็จ ${sent} / ล้มเหลว ${failed} / ค้างคิว ${pending}',
   '{"date":"30 เม.ย. 2569","sent":"450","failed":"5","pending":"12"}'::jsonb,
   'LINE OA stats at 20:00 ICT.', now(), now()),

  (gen_random_uuid(), 'staff.sms_credit_low', 'แจ้งเครดิต SMS ใกล้หมด', 'STAFF', 'line-staff', 'LINE', 'text',
   '[BESTCHOICE] เครดิต SMS ใกล้หมด: เหลือ ${credit} เครดิต — กรุณาเติมก่อนหมด',
   '{"credit":"50"}'::jsonb,
   'When SMS credit < 100.', now(), now())
ON CONFLICT (event_type) DO NOTHING;
