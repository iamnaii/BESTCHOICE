-- After-sales hub PR 3 — แม่แบบ LINE ลูกค้า (ช่องร้าน) · แก้ข้อความที่ /notifications · migration ไม่ทับแถวเดิม
-- Idempotent via ON CONFLICT (event_type) DO NOTHING (precedent 20261003200000_seed_device_return_templates)
-- placeholder = ${var} ตาม NotificationDispatchService.replacePlaceholders — ห้ามเปลี่ยนเป็นรูปแบบวงเล็บปีกกาคู่
-- ตัวแปร 4 แถวแรก (AFTER_SALES_*) ผลิตโดย buildLineData() ใน after-sales-line-copy.util.ts (PR 3 Task 1)
-- ตัวแปรของ WARRANTY_EXPIRING_7D (warrantyType/daysRemaining/expireDate) มาจากงานคนละก้อน (ประกันใกล้หมด
-- ของสินค้าที่ซื้อ ไม่ใช่ AfterSalesCase) — แถวนี้ seed ไว้ก่อนแต่ปิด is_active=false จนกว่าเจ้าของจะเคาะข้อความ
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, is_active, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'AFTER_SALES_RECEIVED', 'หลังการขาย 1 · รับเรื่องแล้ว', 'TRANSACTIONAL', 'line-shop', 'LINE', 'text',
   E'รับเครื่องของคุณไว้ที่สาขาแล้ว\nเคส ${caseNumber} · ${branchName}\n${deviceName}\nอาการที่แจ้ง: ${symptom}\n\nสิทธิ์: ${entitlementLine}\n${nextLine}\n${liffLine}',
   '{"caseNumber":"AS-20260907-0004","branchName":"สาขาลพบุรี","deviceName":"iPhone 13 128GB","symptom":"เปิดไม่ติด ชาร์จไม่เข้า","entitlementLine":"อยู่ในประกันร้าน ไม่มีค่าใช้จ่าย","nextLine":"ซ่อมเสร็จเมื่อไร ทางร้านจะแจ้งทาง LINE นี้ทันที","liffLine":"ดูสถานะเคส: https://liff.line.me/xxxx/liff/warranty"}'::jsonb,
   'ส่งทันทีที่เปิดเคสหลังการขาย (ลูกค้าที่ผูก LINE ฝั่งร้าน)', true, now(), now()),

  (gen_random_uuid(), 'AFTER_SALES_READY', 'หลังการขาย 2 · มารับได้แล้ว', 'TRANSACTIONAL', 'line-shop', 'LINE', 'text',
   E'${readyLine}\nเคส ${caseNumber}\n${deviceName}\n\nรับได้ที่ ${branchName} ทุกวัน 10:00–20:00\nค่าใช้จ่าย: ${costLine}\nนำบัตรประชาชนหรือใบรับฝากเครื่องมาด้วย\n${liffLine}',
   '{"readyLine":"ซ่อมเสร็จแล้ว มารับได้เลย","caseNumber":"AS-20260907-0004","deviceName":"iPhone 13 128GB","branchName":"สาขาลพบุรี","costLine":"ค่าซ่อม 1,500 บาท ชำระที่สาขา","liffLine":"ดูสถานะเคส: https://liff.line.me/xxxx/liff/warranty"}'::jsonb,
   'ซ่อมเสร็จ / ผจก.ยืนยันเปลี่ยนเครื่อง / คำขออนุมัติแล้ว (เวลาเปิดสาขาแก้ในข้อความนี้)', true, now(), now()),

  (gen_random_uuid(), 'AFTER_SALES_CLOSED', 'หลังการขาย 3 · ปิดเคส', 'TRANSACTIONAL', 'line-shop', 'LINE', 'text',
   E'ส่งมอบเครื่องเรียบร้อย\nเคส ${caseNumber} ปิดแล้ว\n${deviceLine}\n\n${warrantyLines}\nมีปัญหาอีก ทักมาที่ LINE นี้ได้เลย ขอบคุณที่ไว้วางใจ BESTCHOICE\n${liffLine}',
   '{"caseNumber":"AS-20260907-0004","deviceLine":"iPhone 13 128GB","warrantyLines":"ประกันร้าน ถึง 17 พ.ย. 69\nประกันศูนย์ ถึง 1 มี.ค. 70","liffLine":"ดูสถานะเคส: https://liff.line.me/xxxx/liff/warranty"}'::jsonb,
   'ส่งเมื่อส่งมอบเครื่องคืน/เครื่องใหม่ หรือคำขอเปลี่ยนเครื่องลงผลแล้ว', true, now(), now()),

  (gen_random_uuid(), 'AFTER_SALES_PICKUP_REMINDER', 'หลังการขาย · เตือนให้มารับ', 'TRANSACTIONAL', 'line-shop', 'LINE', 'text',
   E'เครื่องของคุณ${readyKind}รอรับที่ ${branchName} ตั้งแต่ ${readySince}\nเคส ${caseNumber} · ${deviceName}\nรับได้ทุกวัน 10:00–20:00 นำบัตรประชาชนหรือใบรับฝากเครื่องมาด้วย\n${liffLine}',
   '{"readyKind":"ซ่อมเสร็จ","branchName":"สาขาลพบุรี","readySince":"10 ก.ย. 69","caseNumber":"AS-20260907-0004","deviceName":"iPhone 13 128GB","liffLine":"ดูสถานะเคส: https://liff.line.me/xxxx/liff/warranty"}'::jsonb,
   'cron 10:00 ส่ง 1 ครั้งเมื่อครบ 7 วันยังไม่มารับ', true, now(), now()),

  (gen_random_uuid(), 'WARRANTY_EXPIRING_7D', 'ประกันใกล้หมด 7 วัน', 'REMINDER', 'line-shop', 'LINE', 'text',
   E'ประกัน${warrantyType}ของ ${deviceName} จะหมดในอีก ${daysRemaining} วัน (${expireDate})\nถ้ามีอาการผิดปกติ นำเครื่องมาเช็คที่สาขาก่อนหมดประกันได้เลย\n${liffLine}',
   '{"warrantyType":"ร้าน","deviceName":"iPhone 13 128GB","daysRemaining":"7","expireDate":"17 พ.ย. 69","liffLine":"ดูสถานะเคส: https://liff.line.me/xxxx/liff/warranty"}'::jsonb,
   'ปิดไว้จนเจ้าของเคาะข้อความ — เปิดที่ /notifications (ผ่านด่านความยินยอม/เวลาทำการ)', false, now(), now())
ON CONFLICT (event_type) DO NOTHING;
