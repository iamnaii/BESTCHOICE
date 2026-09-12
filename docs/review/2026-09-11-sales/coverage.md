# ขอบเขตและหลักฐานการตรวจหมวดขาย

[กลับรายงาน](audit.md) · [ต้นแบบที่คลิกได้](http://localhost:5211/prototype.html)

**รอบตรวจซ้ำ `/scrutinize`:** [ข้อค้นพบเพิ่มเติมและแผนที่ปรับ](scrutinize.md), [ผล HTTP/DTO/service/calculation](evidence/scrutinize-check.json), [ผล browser เพิ่ม 7 captures](evidence/scrutinize-browser.json) ใช้สถานะเอกสารโหลดล้มเหลว ราคาสด/ผ่อนต่างกัน และ config ที่ทำให้ frontend/backend ต่างกัน

ตรวจจาก checkout revision `dce7ae705` วันที่ 11 กันยายน 2569 ทั้งโค้ด frontend, API และหน้าตาที่เปิดได้ใน local preview ใช้ข้อมูลทดสอบ/ข้อมูลสมมติ ไม่มีธุรกรรมกับลูกค้าจริง ภาพต้นแบบแยกจากภาพระบบปัจจุบันด้านล่างอย่างชัดเจน

## หน้าหลักทั้ง 6 เมนู

| เมนู / route | ภาพระบบปัจจุบัน จอใหญ่ | ภาพระบบปัจจุบัน มือถือ | แหล่งข้อมูล |
|---|---|---|---|
| ลูกค้า `/customers` | [1440px](evidence/customers-1440.png) | [390px](evidence/customers-390.png) | Local preview API |
| ตรวจเครดิต `/credit-checks` | [1440px](evidence/credit-1440.png) | [390px](evidence/credit-390.png) | Local preview API / AI จำลอง |
| ขายสินค้า `/pos` | [1440px](evidence/pos-1440.png) | [390px](evidence/pos-390.png) | Local preview API; top-products จำลองเป็นรายการว่าง |
| การจอง / มัดจำ `/bookings` | [1440px](evidence/bookings-1440.png) | [390px](evidence/bookings-390.png) | Browser response fixtures |
| สัญญาผ่อนชำระ `/contracts` | [1440px](evidence/contracts-1440.png) | [390px](evidence/contracts-390.png) | Browser response fixtures |
| ยอดขาย `/sales` | [1440px](evidence/sales-1440.png) | [390px](evidence/sales-390.png) | Browser response fixtures |

Browser fixtures ใช้เพื่อแสดง React components จริงจาก checkout โดยแทนข้อมูลที่ API preview ยังไม่รองรับ ไม่ใช่ผลทดสอบธุรกรรมของ API ภาพที่มี total มากกว่าแถวที่โหลดตั้งใจใช้ตรวจการแบ่งหน้าและโครงสร้างตาราง ห้ามนำตัวเลขเหล่านี้ไปประเมินผลประกอบการ

## หน้าย่อยและสถานะที่เปิดตรวจ

| กลุ่ม | หลักฐานภาพ | ขอบเขต / ข้อจำกัด |
|---|---|---|
| เพิ่มลูกค้า | [ฟอร์มจากหน้าลูกค้า](evidence/customer-create.png), [ฟอร์มจาก POS](evidence/pos-customer-create.png) | เปิดตรวจฟอร์มและอ่าน mapping payload ทั้งสองจุด รวม CustomerCreateModal ใน flow สัญญา; ไม่บันทึกลูกค้าใหม่ |
| รายละเอียดลูกค้า | [ข้อมูลส่วนตัว](evidence/customer-info.png), [ติดต่อ/ที่อยู่](evidence/customer-tab-25.png), [งาน/รายได้](evidence/customer-tab-26.png), [เครดิต](evidence/customer-tab-27.png), [สัญญา](evidence/customer-tab-28.png), [ประวัติซื้อ](evidence/customer-tab-29.png), [Loyalty](evidence/customer-tab-30.png) | Preview คืนรายการสัญญา/ซื้อบางส่วนเป็นว่าง จึงไม่ใช้จำนวนศูนย์เป็นหลักฐานบั๊ก production |
| รายละเอียดลูกค้าบนมือถือ | [เครดิต 390px](evidence/customer-credit-390.png) | ยืนยัน document overflow: viewport 390px แต่ document 714px; แถวแท็บยื่นออกทั้งหน้า |
| ตรวจเครดิต | [สร้างคำขอ](evidence/credit-create.png), [คิว](evidence/credit-queue.png), [พิจารณายอดผ่อน](evidence/credit-decision.png) | ใช้ผล AI จำลองของ preview; อ่าน approval gate ฝั่ง API และการคืนบริบทไปสัญญา; ไม่ส่งอนุมัติจริง |
| POS | [เริ่มรายการ](evidence/pos-start.png), [ไฟแนนซ์ภายนอก](evidence/pos-external.png), [เลือกสินค้า](evidence/pos-selected-price.png) | ตรวจราคา เงินรับ ส่วนลด ของแถม และลิงก์ผ่อน BESTCHOICE จากโค้ด; สินค้าในภาพมีราคาสด/ผ่อนเท่ากัน จึงไม่ใช้ภาพนี้ยืนยันส่วนต่างราคาตาม F05 |
| สร้างใบจอง | [1440px](evidence/booking-create-1440.png), [390px](evidence/booking-create-390.png) | ฟอร์มจริงแต่รายการ/ข้อมูลประกอบบางส่วนจำลอง; ไม่สร้างใบจอง |
| ใบจองรอมัดจำ | [รายละเอียด 1440px](evidence/booking-deposit-detail-1440.png), [390px](evidence/booking-deposit-detail-390.png) | ตรวจช่องรับเงิน วิธีชำระ และบัญชี; ไม่มี POST รับเงินจริง |
| ใบจองรับมัดจำแล้ว | [รายละเอียด 1440px](evidence/booking-paid-detail-1440.png), [390px](evidence/booking-paid-detail-390.png) | ตรวจขายต่อ/เก็บส่วนต่าง/ยกเลิกจาก UI และ service; ไม่ convert จริง |
| รายการสัญญา | [ตาราง](evidence/contract-list.png), [Kanban](evidence/contract-kanban.png) | ข้อมูลสัญญาจำลอง; ตรวจการแบ่งหน้า export และ workflow จากโค้ด |
| สร้างสัญญา | [เลือกสินค้า](evidence/contract-create-product.png), [เลือกลูกค้า](evidence/contract-create-customer.png), [แผนผ่อนและยืนยัน](evidence/contract-create-plan.png) | เปิดครบ 3 ขั้น; ลูกค้า/สินค้า/แผนจาก preview, latest credit approval แทนด้วย fixture ที่ผ่านและยังไม่ใช้; ไม่กดสร้างสัญญา |
| รายละเอียดสัญญา | [DRAFT](evidence/contract-detail-draft.png), [ACTIVE](evidence/contract-detail-active.png), [มือถือ](evidence/contract-detail-390.png) | อ่าน actions/status/ยอดและสิทธิ์; ข้อมูลสัญญาจำลอง |
| แท็บสัญญา | [ดูสัญญา](evidence/contract-tab-ดูสัญญา.png), [เอกสาร](evidence/contract-tab-เอกสาร.png), [ตรวจเครดิต](evidence/contract-tab-ตรวจเครดิต.png) | Preview HTML เป็นเอกสารสมมติ ไม่ใช่แบบสัญญาฉบับจริง |
| ลงนาม | [KYC](evidence/sign-kyc.png), [PDPA](evidence/sign-pdpa.png), [อ่านเอกสาร](evidence/sign-review.png), [ลายเซ็น](evidence/sign-signature.png) | เปิดขั้นตอนด้วยสถานะ fixture; อ่าน required signers/validation/หน้าสำเร็จจากโค้ด; ไม่ยืนยัน KYC/consent/เซ็นจริง และไม่ได้ทดสอบ final completion ผ่าน API |
| ยกเลิกใบขาย | [dialog 1440px](evidence/sale-void-dialog-1440.png), [390px](evidence/sale-void-dialog-390.png) | เปิด dialog ตรวจเหตุผลและคำยืนยัน; ไม่ส่งคำสั่งยกเลิก |

ภาพบางหน้ามี sidebar ย่อ/ขยายต่างกันตาม state ของ Layout และขนาดจอ ไม่ได้เปลี่ยน application code ระหว่างจับภาพ

## หลักฐานตรวจโค้ดและทดสอบ

- [ผล capture หลัก 47 สถานะ](evidence/screens.json): ไม่พบ pageerror แต่มีภาพใบจองสองชื่อ `booking-paid-*` ที่ยังเป็นหน้ารายการจากการเปิดรายละเอียดไม่สำเร็จ จึงไม่ใช้สองภาพนี้ในรายงาน; ใช้ `booking-paid-detail-*` ที่เปิดสำเร็จภายหลังแทน
- [ผล capture เพิ่มเติม 5 สถานะ](evidence/extra.json): สร้างสัญญา 3 ขั้น และ POS ก่อน/หลังเลือกสินค้า ไม่พบ pageerror
- [ทำซ้ำกำไรรวม/การจำกัดสาขา/export](evidence/reproductions.json): ใช้ SalesQueryService, SalesController และ BranchGuard จริงร่วมกับ Prisma mock
- [ทำซ้ำแก้มัดจำ/ยอดรวมใบจอง/validation export](evidence/booking-reproductions.json): ใช้ BookingsService และ PaginationDto จริงร่วมกับ dependencies จำลอง
- รายละเอียด unit tests และ `local:check` ที่ไม่ผ่าน storefront เพราะ import `gsap` อยู่ท้าย [รายงาน](audit.md)

รอบแรกเก็บภาพระบบปัจจุบันที่ใช้ประกอบการตรวจ 57 ไฟล์ใน `evidence/` บางภาพเป็นสถานะเดียวกันที่คนละขนาดหรือจังหวะ จึงไม่ถือเป็น 57 หน้าที่แยกกัน รอบ scrutinize เพิ่ม 7 ภาพตามลิงก์ด้านบน ไม่ได้ทำ full end-to-end ของทุกปุ่ม ทุกบทบาท และทุกสถานะธุรกรรม

## ต้นแบบที่เสนอ

ใช้ `ui-ux-pro-max` ประกอบการออกแบบ โดยคง Emerald/Zinc และ IBM Plex Sans Thai ให้เข้ากับโครงการ เป็นข้อมูลสมมติและปุ่มสาธิต ไม่มี API mutation

| หน้า | จอใหญ่ | มือถือ |
|---|---|---|
| ขายสินค้า | [1440px](proposal-sale-1440.png) | [390px](proposal-sale-390.png) |
| การจอง / มัดจำ | [1440px](proposal-bookings-1440.png) | [390px](proposal-bookings-390.png) |
| ลูกค้า | [1440px](proposal-customers-1440.png) | [390px](proposal-customers-390.png) |
| ตรวจเครดิต | [1440px](proposal-credit-1440.png) | [390px](proposal-credit-390.png) |
| สัญญาผ่อนชำระ | [1440px](proposal-contracts-1440.png) | [390px](proposal-contracts-390.png) |
| รายการขาย | [1440px](proposal-sales-1440.png) | [390px](proposal-sales-390.png) |

[ผลตรวจต้นแบบ](prototype-check.json): ทั้ง 12 page/viewport combinations ไม่มี document overflow และไม่มี JS pageerror; การเปิด review dialog และส่งต่อผ่อน BESTCHOICE ไปหน้าสัญญาทำงาน ไม่ใช่การรับรอง accessibility ครบทุกเกณฑ์หรือความถูกต้องของธุรกรรมจริง
