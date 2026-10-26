# ตรวจฟิลด์และฟอร์มหลังแก้ UI

มาตรฐานช่องกรอกและตัวกรองใน app shell อยู่ที่ `components/ui/form-styles.ts` และ `styles/admin-typography.css`: สูง 2.75 rem (44 px เมื่อ root 16 px), ตัวอักษรมือถือ 16 px และ desktop 14 px, ใช้ semantic tokens และ Noto Sans Thai Looped ช่องข้อความหลายบรรทัดคงความสูงตามเนื้อหา ส่วนตัวกระดาษ/PDF/editor และช่องยอดเงินขนาดใหญ่ใช้ข้อยกเว้นของตนเอง CSS ครอบคลุม modal ที่ render ผ่าน portal และมีข้อยกเว้นสำหรับ input ที่ฝังใน InputWrapper/QtyStepper

## การตรวจด้วย API จริงและฐานข้อมูลแยก

รันจาก root ของ checkout:

```sh
DOCS_QA_SKIP_PREPARE=1 bash tools/docs-integration.sh \
  --roots "$PWD/apps/api/e2e/ui-fields" \
  --testRegex 'fields\.audit-spec\.ts$' \
  --globals '{"ts-jest":{"isolatedModules":true,"diagnostics":false}}' \
  --runInBand
```

คำสั่งใช้ PostgreSQL และ API ของ checkout นี้ผ่าน disposable documents harness, ข้อมูลสังเคราะห์, outbound transports จำลอง ไม่มีการบันทึกฟอร์มธุรกิจหรือแก้ฐานข้อมูลจริง หาก dependencies/generated clients ยังไม่พร้อมให้ไม่ตั้ง `DOCS_QA_SKIP_PREPARE`

ชุดตรวจครอบคลุม 25 กรณีที่ความกว้าง 320, 390, 768, 1440 px ทั้ง light/dark (200 observations): ลูกค้าและรายละเอียด/ฟอร์มที่ขยายส่วนเพิ่ม, ใบจอง, เครดิต, สัญญา, ชำระเงิน, ค่าใช้จ่าย, สินค้าใหม่/มือสอง/อุปกรณ์, POS, สาขา, ผู้ใช้ทั้ง 3 แท็บ, รับซื้อ, ผู้ติดต่อ และแจ้งปัญหาเครื่อง

ตรวจ route ที่เปิดจริง, font, accessible names, ความสูงฟอร์มที่ปรับ, ช่องไม่เล็กเกินไปบนมือถือ และไม่ล้น viewport

ปุ่มในตาราง/แถบเมนูที่เลื่อนแนวนอนได้ตรวจแยกจากปุ่มที่ล้นหน้า: ต้องมี scroll container อยู่ใน viewport และ Playwright ต้องเลื่อนถึงตำแหน่งที่ปุ่มรับคลิกได้จริง (`trial: true` ไม่กดคำสั่งธุรกิจ) เก็บ trace แต่ละขนาดจอไว้สำหรับตรวจข้อผิดพลาดย้อนหลัง

พฤติกรรมที่ทดสอบ:

- ฟอร์มลูกค้า: กรอก/ล้าง, validation บน input, คลิก label, ยกเลิกและเปิดใหม่
- ที่อยู่: เลือกด้วยคีย์บอร์ด/เมาส์, reset อำเภอ–ตำบล–รหัสไปรษณีย์เมื่อเปลี่ยนจังหวัด, Escape ปิดรายการโดย dialog ยังอยู่
- สินค้า: เปลี่ยนประเภทและยี่ห้อ/รุ่น, อุปกรณ์ชุดชาร์จ, สถานะวันหมดประกัน
- ค่าใช้จ่าย: เปิดตรงด้วย OWNER ที่ไม่มีสาขาประจำ, กรอก/ล้าง, เพิ่ม/ลบรายการโดยค่าเดิมไม่หายและ label ID ไม่ซ้ำ
- ผู้ใช้: เส้นทางสร้างใหม่เปิดช่องอีเมลและรหัสผ่านให้กรอก พร้อมตรวจแท็บบุคคล/HR
- แจ้งปัญหาเครื่อง: สถานะปุ่มค้นหาหลังกรอก/ล้าง IMEI

ภาพและค่าที่วัดอยู่ใน `fields/` ภายใต้ output ของ harness; บันทึก console/status ของการทดสอบอยู่ในผล Jest

## ข้อจำกัด

นี่คือ regression suite ของฟิลด์ที่ตรวจในรอบนี้ ไม่ใช่การรับรองทุกเส้นทาง/ทุกสิทธิ์/ทุกขั้นตอนธุรกิจ ไม่ครอบคลุมการบันทึกและยอดบัญชีทุกชนิดเอกสาร, อุปกรณ์ iPhone/Android จริง หรือ production branch configuration ต้องทดสอบ business flow แยกตาม feature เมื่อมีการเปลี่ยนข้อมูลหรือกฎธุรกิจ

ก่อนส่งมอบ code ให้รัน `npm run local:check` ตาม AGENTS.md ด้วย managed preview ครอบคลุมเฉพาะ domains ที่ระบุในคู่มือ local-check; หน้าอื่นตรวจด้วย full API harness ข้างต้น
