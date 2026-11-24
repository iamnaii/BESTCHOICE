# เมนูปัจจุบันแยกทุก role

สำรวจจาก config ที่ checkout วันที่ 24 พฤศจิกายน 2026 ไม่ใช่การยืนยันว่า API ทุกหน้าทำงานได้ และไม่ใช่สิทธิ์ของบัญชีจริง รายการ GROUP เป็นหัวข้อเมนู ไม่ใช่ปลายทาง หน้าเสริม/หน้าลูกทั้งหมดดู web-route-gates.csv

## OWNER

| ส่วนงาน | หมวด | หน้า | เส้นทาง | ชนิด |
|---|---|---|---|---|
| shop | ลูกค้าและนัดหมาย | ลูกค้า | `/customers` | LINK |
| shop | ลูกค้าและนัดหมาย | ตรวจเครดิต | `/credit-checks` | LINK |
| shop | ลูกค้าและนัดหมาย | นัดเข้าร้าน | `/appointments` | LINK |
| shop | ขายและบริการ | ขายสินค้า | `/pos` | LINK |
| shop | ขายและบริการ | ราคาและเรทผ่อน | `/prices` | LINK |
| shop | ขายและบริการ | การจอง / มัดจำ | `/bookings` | LINK |
| shop | ขายและบริการ | สัญญาผ่อนชำระ | `/contracts` | LINK |
| shop | ขายและบริการ | รายการขาย | `/sales` | LINK |
| shop | ขายและบริการ | หลังการขาย | `/after-sales` | LINK |
| shop | คลังและจัดซื้อ | คลังสินค้า | `/stock` | LINK |
| shop | คลังและจัดซื้อ | ผู้จัดจำหน่าย | `/suppliers` | LINK |
| shop | คลังและจัดซื้อ | สั่งซื้อ (PO) | `/purchase-orders` | LINK |
| shop | คลังและจัดซื้อ | รับซื้อมือสอง | `/trade-in` | LINK |
| shop | คลังและจัดซื้อ | รอถ่ายรูป | `/purchase-orders/qc` | LINK |
| shop | คลังและจัดซื้อ | รายการสินค้า | `/stock/products` | LINK |
| shop | คลังและจัดซื้อ | ตัดสินค้า | `/stock/adjustments` | LINK |
| shop | คลังและจัดซื้อ | พิมพ์สติกเกอร์ | `/stickers` | LINK |
| shop | เงินและบัญชีหน้าร้าน | สรุปเงินรายวัน | `/shop/daily-cash` | LINK |
| shop | เงินและบัญชีหน้าร้าน | เงินสดย่อย | `/shop/petty-cash` | LINK |
| shop | เงินและบัญชีหน้าร้าน | งบทดลอง + P&L | `/shop/accounting` | LINK |
| shop | เงินและบัญชีหน้าร้าน | ยอดขายย้อนหลัง (Tooltify) | `/imported-sales` | LINK |
| shop | งานของฉัน | ลงเวลา | `/attendance` | LINK |
| shop | งานของฉัน | เวลาทำงานของฉัน | `/attendance/me` | LINK |
| fin | ภาพรวม | หน้าหลัก | `/finance-portfolio` | LINK |
| fin | รายรับ | รับชำระค่างวด | `/payments` | LINK |
| fin | รายรับ | รายได้อื่น | `/other-income` | LINK |
| fin | รายรับ | เอกสารยกเลิกสัญญา | `/finance/contract-cancellation` | LINK |
| fin | รายรับ | ใบเสร็จอิเล็กทรอนิกส์อัตโนมัติ | `/finance/e-receipt-auto` | LINK |
| fin | ติดตามหนี้ | ติดตามหนี้ | `/overdue` | LINK |
| fin | ติดตามหนี้ | จัดการจดหมาย | `/letters` | LINK |
| fin | ติดตามหนี้ | ล็อคเครื่อง (MDM) | `/mdm` | LINK |
| fin | ติดตามหนี้ | รับเครื่องคืน / ยึดคืน | `/repossessions` | LINK |
| fin | รายจ่าย | จ่ายให้หน้าร้าน | `/accounting/intercompany` | LINK |
| fin | รายจ่าย | บันทึกค่าใช้จ่าย | `/expenses` | LINK |
| fin | รายจ่าย | บิลประจำ | `/expenses/recurring-bills` | LINK |
| fin | สินทรัพย์ | สินทรัพย์ถาวร | `/assets` | LINK |
| fin | การเงิน | เงินสด/ธนาคาร | `/finance/bank-accounts` | LINK |
| fin | ภาษี | ภาษีมูลค่าเพิ่ม (ภ.พ.30) | `/finance/vat` | LINK |
| fin | ภาษี | ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.1/3/53) | `/finance/wht` | LINK |
| fin | ภาษี | ภ.ง.ด.1 เงินเดือน (รายพนักงาน) | `/finance/wht-report` | LINK |
| fin | ภาษี | ประกันสังคม (สปส.1-10) | `/finance/sso-report` | LINK |
| fin | ภาษี | ภ.ง.ด.1ก / ใบ 50 ทวิ (รายปี) | `/finance/wht-annual` | LINK |
| fin | ภาษี | e-Tax Invoice | `/finance/e-tax` | LINK |
| fin | ภาษี | รายการบัญชี VAT อัตโนมัติ | `/finance/vat-auto-journal` | LINK |
| fin | บัญชี & งบการเงิน | สมุดรายวัน | `/finance/general-journal` | LINK |
| fin | บัญชี & งบการเงิน | บัญชีแยกประเภท | `/finance/general-ledger` | LINK |
| fin | บัญชี & งบการเงิน | งบทดลอง | `/finance/trial-balance` | LINK |
| fin | บัญชี & งบการเงิน | งบฐานะการเงิน | `/finance/balance-sheet` | LINK |
| fin | บัญชี & งบการเงิน | งบกำไรขาดทุน | `/profit-loss` | LINK |
| fin | บัญชี & งบการเงิน | งบกระแสเงินสด | `/finance/cash-flow` | LINK |
| fin | บัญชี & งบการเงิน | งบส่วนของผู้ถือหุ้น | `/finance/equity-statement` | LINK |
| fin | ปิดงวด & ทุน | ปิดบัญชีรายเดือน | `/monthly-close` | LINK |
| fin | ปิดงวด & ทุน | ปิดบัญชีสิ้นปี | `/finance/year-end-closing` | LINK |
| fin | ปิดงวด & ทุน | งวดบัญชี | `/accounting/periods` | LINK |
| fin | ปิดงวด & ทุน | ตรวจสอบบัญชี | `/financial-audit` | LINK |
| fin | ปิดงวด & ทุน | ส่งออก PEAK CSV | `/finance/peak-export` | LINK |
| fin | ปิดงวด & ทุน | ส่วนของผู้ถือหุ้น | `/finance/equity` | LINK |
| fin | ปิดงวด & ทุน | ทะเบียนปันผล + ภ.ง.ด.2 | `/finance/dividend-register` | LINK |
| fin | รายงาน | รายงานรวม | `/reports` | LINK |
| fin | รายงาน | รายงานลูกหนี้และอายุหนี้ | `/finance/aging-report` | LINK |
| fin | รายงาน | รายงานหนี้สูญ | `/finance/bad-debt-report` | LINK |
| fin | รายงาน | รายงานลูกหนี้ระหว่างบริษัท | `/finance/intercompany-report` | LINK |
| fin | รายงาน | ค่าคอมมิชชัน | `/commissions` | LINK |
| settings | ตั้งค่าระบบ | รายชื่อผู้ติดต่อ | `/contacts` | LINK |
| settings | ตั้งค่าระบบ | บริษัท & สาขา | `/settings/company` | LINK |
| settings | ตั้งค่าระบบ | ผู้ใช้ & สิทธิ์ | `/settings/access` | LINK |
| settings | ตั้งค่าระบบ | บัญชี & ภาษี | `/settings/accounting` | LINK |
| settings | ตั้งค่าระบบ | การเงิน & สินเชื่อ | `/settings/finance` | LINK |
| settings | ตั้งค่าระบบ | สินค้า & การขาย | `/settings/products` | LINK |
| settings | ตั้งค่าระบบ | สื่อสารลูกค้า | `/settings/comms` | LINK |
| settings | ตั้งค่าระบบ | AI | `/settings/ai` | LINK |
| settings | ตั้งค่าระบบ | เชื่อมต่อ | `/settings/integrations` | LINK |
| settings | ตั้งค่าระบบ | ระบบ & ความปลอดภัย | `/settings/system` | LINK |
| contextual | Top bar / mobile | แชทลูกค้า | `/inbox` | LINK |

## BRANCH_MANAGER

| ส่วนงาน | หมวด | หน้า | เส้นทาง | ชนิด |
|---|---|---|---|---|
| shop | ลูกค้าและนัดหมาย | ลูกค้า | `/customers` | LINK |
| shop | ลูกค้าและนัดหมาย | ตรวจเครดิต | `/credit-checks` | LINK |
| shop | ลูกค้าและนัดหมาย | นัดเข้าร้าน | `/appointments` | LINK |
| shop | ขายและบริการ | ขายสินค้า | `/pos` | LINK |
| shop | ขายและบริการ | ราคาและเรทผ่อน | `/prices` | LINK |
| shop | ขายและบริการ | การจอง / มัดจำ | `/bookings` | LINK |
| shop | ขายและบริการ | สัญญาผ่อนชำระ | `/contracts` | LINK |
| shop | ขายและบริการ | รายการขาย | `/sales` | LINK |
| shop | ขายและบริการ | หลังการขาย | `/after-sales` | LINK |
| shop | ขายและบริการ | จัดการอุปกรณ์ | `/mdm` | LINK |
| shop | คลังและจัดซื้อ | คลังสินค้า | `/stock` | LINK |
| shop | คลังและจัดซื้อ | ผู้จัดจำหน่าย | `/suppliers` | LINK |
| shop | คลังและจัดซื้อ | สั่งซื้อ (PO) | `/purchase-orders` | LINK |
| shop | คลังและจัดซื้อ | รับซื้อมือสอง | `/trade-in` | LINK |
| shop | คลังและจัดซื้อ | รอถ่ายรูป | `/purchase-orders/qc` | LINK |
| shop | คลังและจัดซื้อ | รายการสินค้า | `/stock/products` | LINK |
| shop | คลังและจัดซื้อ | ตัดสินค้า | `/stock/adjustments` | LINK |
| shop | คลังและจัดซื้อ | พิมพ์สติกเกอร์ | `/stickers` | LINK |
| shop | เงินและบัญชีหน้าร้าน | สรุปเงินรายวัน | `/shop/daily-cash` | LINK |
| shop | เงินและบัญชีหน้าร้าน | รับชำระค่างวด | `/payments` | LINK |
| shop | เงินและบัญชีหน้าร้าน | บันทึกค่าใช้จ่าย | `/expenses` | LINK |
| shop | เงินและบัญชีหน้าร้าน | บิลประจำ | `/expenses/recurring-bills` | LINK |
| shop | เงินและบัญชีหน้าร้าน | สินทรัพย์ถาวร | `/assets` | LINK |
| shop | เงินและบัญชีหน้าร้าน | งบกำไรขาดทุน | `/profit-loss` | LINK |
| shop | เงินและบัญชีหน้าร้าน | รายงาน | `/reports` | LINK |
| shop | งานของฉัน | ลงเวลา | `/attendance` | LINK |
| shop | งานของฉัน | เวลาทำงานของฉัน | `/attendance/me` | LINK |
| shop | งานของฉัน | งานของทีม | `/todos` | LINK |
| shop | ภาพรวม | หน้าหลัก | `/` | LINK |
| shop | ติดตาม | ติดตามหนี้ | `/overdue` | LINK |
| shop | ติดตาม | จัดการจดหมาย | `/letters` | LINK |
| shop | ติดตาม | รับเครื่องคืน / ยึดคืน | `/repossessions` | LINK |
| contextual | Top bar / mobile | แชทลูกค้า | `/inbox` | LINK |

## SALES

| ส่วนงาน | หมวด | หน้า | เส้นทาง | ชนิด |
|---|---|---|---|---|
| shop | ลูกค้าและนัดหมาย | ลูกค้า | `/customers` | LINK |
| shop | ลูกค้าและนัดหมาย | ตรวจเครดิต | `/credit-checks` | LINK |
| shop | ลูกค้าและนัดหมาย | นัดเข้าร้าน | `/appointments` | LINK |
| shop | ขายและบริการ | ขายสินค้า | `/pos` | LINK |
| shop | ขายและบริการ | ราคาและเรทผ่อน | `/prices` | LINK |
| shop | ขายและบริการ | การจอง / มัดจำ | `/bookings` | LINK |
| shop | ขายและบริการ | สัญญาผ่อนชำระ | `/contracts` | LINK |
| shop | ขายและบริการ | รายการขาย | `/sales` | LINK |
| shop | ขายและบริการ | หลังการขาย | `/after-sales` | LINK |
| shop | คลังและจัดซื้อ | คลังสินค้า | `/stock` | LINK |
| shop | คลังและจัดซื้อ | รับซื้อมือสอง | `/trade-in` | LINK |
| shop | คลังและจัดซื้อ | รายการสินค้า | `/stock/products` | LINK |
| shop | คลังและจัดซื้อ | ตัดสินค้า | `/stock/adjustments` | LINK |
| shop | คลังและจัดซื้อ | พิมพ์สติกเกอร์ | `/stickers` | LINK |
| shop | เงินและบัญชีหน้าร้าน | สรุปเงินรายวัน | `/shop/daily-cash` | LINK |
| shop | เงินและบัญชีหน้าร้าน | รับชำระค่างวด | `/payments` | LINK |
| shop | งานของฉัน | เวลาทำงานของฉัน | `/attendance/me` | LINK |
| shop | งานของฉัน | ค่าคอมมิชชัน | `/commissions` | LINK |
| shop | งานของฉัน | งานของทีม | `/todos` | LINK |
| shop | สัญญา & ชำระ | จัดการจดหมาย | `/letters` | LINK |
| contextual | Top bar / mobile | แชทลูกค้า | `/inbox` | LINK |

## FINANCE_MANAGER

| ส่วนงาน | หมวด | หน้า | เส้นทาง | ชนิด |
|---|---|---|---|---|
| shop | ขายและบริการ | ราคาและเรทผ่อน | `/prices` | LINK |
| shop | ขายและบริการ | การจอง / มัดจำ | `/bookings` | LINK |
| shop | ขายและบริการ | สัญญาผ่อนชำระ | `/contracts` | LINK |
| shop | ขายและบริการ | หลังการขาย | `/after-sales` | LINK |
| shop | ขายและบริการ | จัดการอุปกรณ์ | `/mdm` | LINK |
| shop | คลังและจัดซื้อ | คลังสินค้า | `/stock` | LINK |
| shop | คลังและจัดซื้อ | สั่งซื้อ (PO) | `/purchase-orders` | LINK |
| shop | คลังและจัดซื้อ | รายการสินค้า | `/stock/products` | LINK |
| shop | คลังและจัดซื้อ | ตัดสินค้า | `/stock/adjustments` | LINK |
| shop | คลังและจัดซื้อ | พิมพ์สติกเกอร์ | `/stickers` | LINK |
| shop | เงินและบัญชีหน้าร้าน | สรุปเงินรายวัน | `/shop/daily-cash` | LINK |
| shop | เงินและบัญชีหน้าร้าน | เงินสดย่อย | `/shop/petty-cash` | LINK |
| shop | เงินและบัญชีหน้าร้าน | บัญชีหน้าร้าน (SHOP) | `/shop/accounting` | LINK |
| shop | เงินและบัญชีหน้าร้าน | ยอดขายย้อนหลัง (Tooltify) | `/imported-sales` | LINK |
| shop | เงินและบัญชีหน้าร้าน | รับชำระค่างวด | `/payments` | LINK |
| fin | ภาพรวม | หน้าหลัก | `/finance-portfolio` | LINK |
| fin | ภาพรวม | งานของทีม | `/todos` | LINK |
| fin | ภาพรวม | เวลาทำงานของฉัน | `/attendance/me` | LINK |
| fin | ลูกค้า & สัญญา | สัญญาผ่อนชำระ | `/contracts` | LINK |
| fin | ลูกค้า & สัญญา | ลูกค้า | `/customers` | LINK |
| fin | ลูกค้า & สัญญา | ตรวจเครดิต | `/credit-checks` | LINK |
| fin | รายรับ | รับชำระค่างวด | `/payments` | LINK |
| fin | รายรับ | รายได้อื่น | `/other-income` | LINK |
| fin | รายรับ | เอกสารยกเลิกสัญญา | `/finance/contract-cancellation` | LINK |
| fin | รายรับ | ใบเสร็จอิเล็กทรอนิกส์อัตโนมัติ | `/finance/e-receipt-auto` | LINK |
| fin | ติดตามหนี้ | ติดตามหนี้ | `/overdue` | LINK |
| fin | ติดตามหนี้ | จัดการจดหมาย | `/letters` | LINK |
| fin | ติดตามหนี้ | รับเครื่องคืน / ยึดคืน | `/repossessions` | LINK |
| fin | รายจ่าย | จ่ายให้หน้าร้าน | `/accounting/intercompany` | LINK |
| fin | รายจ่าย | บันทึกค่าใช้จ่าย | `/expenses` | LINK |
| fin | รายจ่าย | บิลประจำ | `/expenses/recurring-bills` | LINK |
| fin | สินทรัพย์ | สินทรัพย์ถาวร | `/assets` | LINK |
| fin | การเงิน | เงินสด/ธนาคาร | `/finance/bank-accounts` | LINK |
| fin | ภาษี | ภาษีมูลค่าเพิ่ม (ภ.พ.30) | `/finance/vat` | LINK |
| fin | ภาษี | ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.1/3/53) | `/finance/wht` | LINK |
| fin | ภาษี | ภ.ง.ด.1 เงินเดือน (รายพนักงาน) | `/finance/wht-report` | LINK |
| fin | ภาษี | ประกันสังคม (สปส.1-10) | `/finance/sso-report` | LINK |
| fin | ภาษี | ภ.ง.ด.1ก / ใบ 50 ทวิ (รายปี) | `/finance/wht-annual` | LINK |
| fin | ภาษี | e-Tax Invoice | `/finance/e-tax` | LINK |
| fin | ภาษี | รายการบัญชี VAT อัตโนมัติ | `/finance/vat-auto-journal` | LINK |
| fin | บัญชี & งบการเงิน | สมุดรายวัน | `/finance/general-journal` | LINK |
| fin | บัญชี & งบการเงิน | บัญชีแยกประเภท | `/finance/general-ledger` | LINK |
| fin | บัญชี & งบการเงิน | งบทดลอง | `/finance/trial-balance` | LINK |
| fin | บัญชี & งบการเงิน | งบฐานะการเงิน | `/finance/balance-sheet` | LINK |
| fin | บัญชี & งบการเงิน | งบกำไรขาดทุน | `/profit-loss` | LINK |
| fin | บัญชี & งบการเงิน | งบกระแสเงินสด | `/finance/cash-flow` | LINK |
| fin | บัญชี & งบการเงิน | งบส่วนของผู้ถือหุ้น | `/finance/equity-statement` | LINK |
| fin | ปิดงวด & ทุน | ปิดบัญชีรายเดือน | `/monthly-close` | LINK |
| fin | ปิดงวด & ทุน | ปิดบัญชีสิ้นปี | `/finance/year-end-closing` | LINK |
| fin | ปิดงวด & ทุน | ตรวจสอบบัญชี | `/financial-audit` | LINK |
| fin | ปิดงวด & ทุน | ส่งออก PEAK CSV | `/finance/peak-export` | LINK |
| fin | ปิดงวด & ทุน | ส่วนของผู้ถือหุ้น | `/finance/equity` | LINK |
| fin | ปิดงวด & ทุน | ทะเบียนปันผล + ภ.ง.ด.2 | `/finance/dividend-register` | LINK |
| fin | รายงาน | รายงานรวม | `/reports` | LINK |
| fin | รายงาน | รายงานลูกหนี้และอายุหนี้ | `/finance/aging-report` | LINK |
| fin | รายงาน | รายงานหนี้สูญ | `/finance/bad-debt-report` | LINK |
| fin | รายงาน | รายงานลูกหนี้ระหว่างบริษัท | `/finance/intercompany-report` | LINK |
| fin | รายงาน | ค่าคอมมิชชัน | `/commissions` | LINK |
| settings | ตั้งค่าระบบ | รายชื่อผู้ติดต่อ | `/contacts` | LINK |
| settings | ตั้งค่าระบบ | บัญชี & ภาษี | `/settings/accounting` | LINK |
| settings | ตั้งค่าระบบ | การเงิน & สินเชื่อ | `/settings/finance` | LINK |
| settings | ตั้งค่าระบบ | สื่อสารลูกค้า | `/settings/comms` | LINK |
| contextual | Top bar / mobile | แชทลูกค้า | `/inbox` | LINK |

## ACCOUNTANT

| ส่วนงาน | หมวด | หน้า | เส้นทาง | ชนิด |
|---|---|---|---|---|
| shop | เงินและบัญชีหน้าร้าน | สรุปเงินรายวัน | `/shop/daily-cash` | LINK |
| shop | เงินและบัญชีหน้าร้าน | เงินสดย่อย | `/shop/petty-cash` | LINK |
| shop | เงินและบัญชีหน้าร้าน | งบทดลอง + P&L | `/shop/accounting` | LINK |
| shop | เงินและบัญชีหน้าร้าน | ยอดขายย้อนหลัง (Tooltify) | `/imported-sales` | LINK |
| fin | ภาพรวม | ภาพรวม การเงิน | `/finance-portfolio` | LINK |
| fin | ภาพรวม | งานของทีม | `/todos` | LINK |
| fin | ภาพรวม | เวลาทำงานของฉัน | `/attendance/me` | LINK |
| fin | รายรับ | รับชำระค่างวด | `/payments` | LINK |
| fin | รายรับ | รายได้อื่น | `/other-income` | LINK |
| fin | รายรับ | เอกสารยกเลิกสัญญา | `/finance/contract-cancellation` | LINK |
| fin | รายรับ | ใบเสร็จอิเล็กทรอนิกส์อัตโนมัติ | `/finance/e-receipt-auto` | LINK |
| fin | ติดตามหนี้ | จัดการจดหมาย | `/letters` | LINK |
| fin | ติดตามหนี้ | รับเครื่องคืน / ยึดคืน | `/repossessions` | LINK |
| fin | รายจ่าย | จ่ายให้หน้าร้าน | `/accounting/intercompany` | LINK |
| fin | รายจ่าย | บันทึกค่าใช้จ่าย | `/expenses` | LINK |
| fin | รายจ่าย | บิลประจำ | `/expenses/recurring-bills` | LINK |
| fin | สินทรัพย์ | สินทรัพย์ถาวร | `/assets` | LINK |
| fin | การเงิน | เงินสด/ธนาคาร | `/finance/bank-accounts` | LINK |
| fin | ภาษี | ภาษีมูลค่าเพิ่ม (ภ.พ.30) | `/finance/vat` | LINK |
| fin | ภาษี | ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.1/3/53) | `/finance/wht` | LINK |
| fin | ภาษี | ภ.ง.ด.1 เงินเดือน (รายพนักงาน) | `/finance/wht-report` | LINK |
| fin | ภาษี | ประกันสังคม (สปส.1-10) | `/finance/sso-report` | LINK |
| fin | ภาษี | ภ.ง.ด.1ก / ใบ 50 ทวิ (รายปี) | `/finance/wht-annual` | LINK |
| fin | ภาษี | e-Tax Invoice | `/finance/e-tax` | LINK |
| fin | ภาษี | รายการบัญชี VAT อัตโนมัติ | `/finance/vat-auto-journal` | LINK |
| fin | บัญชี & งบการเงิน | สมุดรายวัน | `/finance/general-journal` | LINK |
| fin | บัญชี & งบการเงิน | บัญชีแยกประเภท | `/finance/general-ledger` | LINK |
| fin | บัญชี & งบการเงิน | งบทดลอง | `/finance/trial-balance` | LINK |
| fin | บัญชี & งบการเงิน | งบฐานะการเงิน | `/finance/balance-sheet` | LINK |
| fin | บัญชี & งบการเงิน | งบกำไรขาดทุน | `/profit-loss` | LINK |
| fin | บัญชี & งบการเงิน | งบกระแสเงินสด | `/finance/cash-flow` | LINK |
| fin | บัญชี & งบการเงิน | งบส่วนของผู้ถือหุ้น | `/finance/equity-statement` | LINK |
| fin | ปิดงวด & ทุน | ปิดบัญชีรายเดือน | `/monthly-close` | LINK |
| fin | ปิดงวด & ทุน | ปิดบัญชีสิ้นปี | `/finance/year-end-closing` | LINK |
| fin | ปิดงวด & ทุน | ตรวจสอบบัญชี | `/financial-audit` | LINK |
| fin | ปิดงวด & ทุน | ส่งออก PEAK CSV | `/finance/peak-export` | LINK |
| fin | ปิดงวด & ทุน | ส่วนของผู้ถือหุ้น | `/finance/equity` | LINK |
| fin | ปิดงวด & ทุน | ทะเบียนปันผล + ภ.ง.ด.2 | `/finance/dividend-register` | LINK |
| fin | รายงาน | รายงานรวม | `/reports` | LINK |
| fin | รายงาน | รายงานลูกหนี้และอายุหนี้ | `/finance/aging-report` | LINK |
| fin | รายงาน | รายงานหนี้สูญ | `/finance/bad-debt-report` | LINK |
| fin | รายงาน | รายงานลูกหนี้ระหว่างบริษัท | `/finance/intercompany-report` | LINK |
| fin | ข้อมูลอ้างอิง | ลูกค้า | `/customers` | LINK |
| fin | ข้อมูลอ้างอิง | สัญญาผ่อนชำระ | `/contracts` | LINK |
| fin | ข้อมูลอ้างอิง | คลังสินค้า | `/stock` | LINK |
| fin | ข้อมูลอ้างอิง | ราคาและเรทผ่อน | `/prices` | LINK |
| fin | ข้อมูลอ้างอิง | สั่งซื้อ (PO) | `/purchase-orders` | LINK |
| fin | ข้อมูลอ้างอิง | รายการสินค้า | `/stock/products` | LINK |
| fin | ข้อมูลอ้างอิง | ตัดสินค้า | `/stock/adjustments` | LINK |
| fin | ข้อมูลอ้างอิง | พิมพ์สติกเกอร์ | `/stickers` | LINK |
| fin | ข้อมูลอ้างอิง | การจอง / มัดจำ | `/bookings` | LINK |
| fin | ข้อมูลอ้างอิง | หลังการขาย | `/after-sales` | LINK |
| settings | ตั้งค่าระบบ | รายชื่อผู้ติดต่อ | `/contacts` | LINK |
| settings | ตั้งค่าระบบ | บัญชี & ภาษี | `/settings/accounting` | LINK |
| settings | ตั้งค่าระบบ | เชื่อมต่อ | `/settings/integrations` | LINK |

## VIEWER

| ส่วนงาน | หมวด | หน้า | เส้นทาง | ชนิด |
|---|---|---|---|---|
| shop | เงินและบัญชีหน้าร้าน | เงินสดย่อย | `/shop/petty-cash` | LINK |
| shop | เงินและบัญชีหน้าร้าน | งบทดลอง + P&L | `/shop/accounting` | LINK |
| fin | บัญชี + งบการเงิน | งบฐานะการเงิน | `/finance/balance-sheet` | LINK |
| fin | บัญชี + งบการเงิน | งบกำไรขาดทุน | `/profit-loss` | LINK |
| fin | บัญชี + งบการเงิน | งบกระแสเงินสด | `/finance/cash-flow` | LINK |
| fin | บัญชี + งบการเงิน | งบส่วนของผู้ถือหุ้น | `/finance/equity-statement` | LINK |
| fin | รายงาน | รายงานรวม | `/reports` | LINK |
| fin | รายงาน | รายงานลูกหนี้และอายุหนี้ | `/finance/aging-report` | LINK |
| fin | รายงาน | สมุดรายวัน | `/finance/general-journal` | LINK |
| fin | รายงาน | บัญชีแยกประเภท | `/finance/general-ledger` | LINK |
| fin | รายงาน | รายงานหนี้สูญ | `/finance/bad-debt-report` | LINK |
| fin | รายงาน | รายงานลูกหนี้ระหว่างบริษัท | `/finance/intercompany-report` | LINK |
| fin | รายงาน | ตรวจสอบบัญชี | `/financial-audit` | LINK |
| fin | บันทึกระบบ | ประวัติการดำเนินการ | `/audit-logs` | LINK |
