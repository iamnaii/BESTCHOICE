-- ใบรับเครื่องคืน (spec docs/superpowers/specs/2026-09-20-device-return-intake-design.md §5.5) — แม่แบบไลน์แจ้งลูกค้า 2 แถว
-- Idempotent via ON CONFLICT (event_type) DO NOTHING (precedent 20260702000001_seed_notification_templates)
-- placeholder = ${var} ตาม NotificationDispatchService.replacePlaceholders — ห้ามเปลี่ยนเป็น {{var}}
-- ตัวแปรที่ DeviceReturnNotifyService ส่ง: customerName docNumber contractNumber deviceName branchName receivedDate grade returnKindLabel
-- (ไม่มีราคาประเมิน — สมมติฐานเจ้าของ: ไม่แสดงราคาในไลน์)
-- category TRANSACTIONAL = ไม่ผ่านด่านความยินยอม/quiet hours (compliance.service.ts COMPLIANCE_CHECKED_CATEGORIES) — แจ้งตามสัญญา ไม่ใช่การตลาด
-- แก้ข้อความภายหลังที่หน้า /notifications (TemplateManager) — migration ไม่ทับแถวที่มีอยู่แล้ว

INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'DEVICE_RETURNED', 'แจ้งรับเครื่องคืน (ใบรับเครื่องคืน)', 'TRANSACTIONAL', 'line-finance', 'LINE', 'text',
   'รับเครื่องคืนแล้ว ใบ ${docNumber} สัญญา ${contractNumber} ${deviceName} ที่สาขา ${branchName} วันที่ ${receivedDate} สภาพเกรด ${grade} — สัญญาหยุดนับค่างวดและค่าปรับตั้งแต่วันนี้ FINANCE จะตรวจสอบและแจ้งผลปิดสัญญาพร้อมใบลดหนี้ทางไลน์นี้',
   '{"customerName":"สมหมาย","docNumber":"DR-20260920-0001","contractNumber":"BCP2609-00042","deviceName":"Apple iPhone 14 128GB","branchName":"ลาดพร้าว","receivedDate":"20/09/2026","grade":"B","returnKindLabel":"คืนเครื่องเอง"}'::jsonb,
   'ส่งทันทีที่สาขาบันทึกใบรับเครื่องคืน (POST /device-returns) และเมื่อกดส่งซ้ำ — ไลน์การเงินเท่านั้น ไม่ตก SMS', now(), now()),

  (gen_random_uuid(), 'DEVICE_RETURN_CANCELED', 'แจ้งยกเลิกใบรับเครื่องคืน', 'TRANSACTIONAL', 'line-finance', 'LINE', 'text',
   'ใบรับเครื่องคืน ${docNumber} สัญญา ${contractNumber} ถูกยกเลิก สัญญาเดินต่อตามเดิม หากมีข้อสงสัยติดต่อสาขา ${branchName}',
   '{"customerName":"สมหมาย","docNumber":"DR-20260920-0001","contractNumber":"BCP2609-00042","deviceName":"Apple iPhone 14 128GB","branchName":"ลาดพร้าว","receivedDate":"20/09/2026","grade":"B","returnKindLabel":"คืนเครื่องเอง"}'::jsonb,
   'ส่งเมื่อ FINANCE ส่งกลับใบ (reject) หรือสาขายกเลิกใบ (cancel)', now(), now())
ON CONFLICT (event_type) DO NOTHING;
