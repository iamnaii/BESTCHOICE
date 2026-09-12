# Scrutinize รอบสอง — BESTCHOICE หมวดขาย

11 กันยายน 2569 · revision `dce7ae705` · [รายงานรอบแรก](audit.md) · [ต้นแบบ](http://localhost:5211/prototype.html)

**เป้าหมาย:** ให้พนักงานทำงานตั้งแต่เลือกลูกค้า ตรวจเครดิต จอง รับเงิน ไปจนถึงขายหรือเปิดสัญญา โดยตัวเลข สิทธิ์ และสถานะตรงกันทุกหน้า

**ทางที่เล็กกว่า:** คง 6 เมนูและ wizard สัญญาที่มีอยู่ก่อน แก้ข้อผิดพลาดกับการส่งต่อข้อมูลผ่าน `contractReturnUrl`/`useDraftStorage` เดิม ไม่ต้องเริ่มด้วย SalesDraft ใหม่หรือเปลี่ยนลำดับเมนูทั้งระบบ การรวมหน้าตาให้เป็นจุดเริ่มเดียวทำได้ภายหลังเมื่อกำหนดคำสั่งรับเงิน การใช้มัดจำ และเส้นทางสร้างสัญญาที่เป็นมาตรฐานแล้ว

รอบแรกมีหลักฐานรองรับข้อผิดพลาดหลัก แต่ข้อเสนอ UI ยังนำหน้าความสามารถจริงบางส่วน รอบนี้พบ **8 ประเด็นเพิ่มเติม/ขยายผล** ด้านล่าง จึงควรปรับแผนก่อนใช้เป็นสเปกลงมือ ไม่ใช่นำต้นแบบไปต่อ API ตรง ๆ

## S01 · P1 — ยอดผ่อนบนจอและยอดที่ backend คำนวณใช้ค่าตั้งต้นคนละชุด

**ผลกระทบ:** พนักงานเสนอค่างวดหนึ่ง แต่ระบบสร้างอีกยอด หรือหน้าเว็บบล็อกเพราะคิดว่าเกินวงเงินทั้งที่ยอด backend อยู่ในวงเงิน การใช้สูตร Decimal ร่วมกันยังไม่แก้ความต่างของ config ที่ป้อนเข้าไป

**เส้นทาง:** หน้าสร้างสัญญาโหลด `interest-configs/by-category` → hook ใช้ `interestConfig.vatPct` และ `interestRate × months` → ส่งข้อมูลไป `/contracts` → backend เลือก config อีกครั้ง แล้ว override VAT จากบริษัทของสาขา และอาจใช้ `InterestConfigRate` เมื่อเปิด feature flag

**ทำซ้ำแล้ว:** ราคา 10,000 / ดาวน์ 2,000 / 6 งวด / ดอกเบี้ยต่อเดือน 1% / commission 10% / config VAT 7% → React page จริงแสดง **1,654.93 บาท/งวด**; resolver ฝั่ง API เมื่อบริษัทสาขา `vatRegistered=false` คืน VAT 0 และเครื่องคำนวณจริงได้ **1,546.66 บาท/งวด** ใช้ response/branch fixtures ไม่ได้สร้างสัญญาลงฐานข้อมูล และไม่ใช่คำวินิจฉัยว่าธุรกิจควรเสีย VAT แบบใด

ยังมีความต่างที่ยืนยันจากโค้ด: frontend เลือก oldest-active config อย่างกำหนดลำดับ แต่ contract create `findFirst` ไม่มี `orderBy`; frontend ยังไม่ใช้ตาราง rates ที่ backend ใช้ได้เมื่อ `USE_NEW_RATE_LOOKUP=true` ยังไม่ได้ตรวจว่าตั้ง flag นี้ใน production หรือไม่

**แก้ขั้นต่ำ:** ให้ preview และ create ใช้ผล resolve/quote เดียวกัน รวม branch, configId, effective VAT, rates, rounding และงวดสุดท้าย; ก่อนยืนยันเทียบ quote กับข้อมูลล่าสุดและแจ้งยอดที่เปลี่ยน ห้ามแก้โดยเลือกเอายอดจากฝั่งใดฝั่งหนึ่งโดยไม่ตกลงนโยบายเดิม

หลักฐาน: [apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.ts:72](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.ts:72) · [apps/api/src/modules/interest-config/interest-config.service.ts:28](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/interest-config/interest-config.service.ts:28) · [apps/api/src/modules/contracts/services/contract-lifecycle.service.ts:86](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/contracts/services/contract-lifecycle.service.ts:86) · [apps/api/src/utils/config.util.ts:286](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/utils/config.util.ts:286) · [apps/api/src/utils/get-rate-for-months.util.ts:15](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/utils/get-rate-for-months.util.ts:15) · [ภาพจอจริงด้วย fixture](evidence/scrutinize-create-calculation.png)

## S02 · P1 — API ใบขายรายใบคืนข้อมูลที่ API รายการตั้งใจซ่อน

**ผลกระทบ:** การซ่อนต้นทุนในตารางไม่ใช่การจำกัดสิทธิ์ ผู้ใช้ SALES เรียกใบขายรายใบแล้วได้ `product.costPrice` และเลขบัตรลูกค้าเต็ม ต่างจากนโยบาย masking ของหน้าลูกค้า และยังต่อยอดปัญหาข้ามสาขา F01

**เส้นทาง:** `GET /sales/:id` ผ่าน RolesGuard ที่อนุญาต SALES → BranchGuard ไม่เห็น branchId จึงผ่าน → controller ไม่ส่ง user → facade → query `findUnique({where:{id}})` select ต้นทุนและ nationalId → คืนตรง ๆ ไม่มี role shaping ในเส้นทางนี้ ส่วน list มีการลบ costPrice สำหรับ non-OWNER

**ทำซ้ำแล้ว:** Nest HTTP test จำลอง principal SALES สาขา A ใช้ RolesGuard/BranchGuard/EntityScopeInterceptor และ SalesService จริง แต่ Prisma เป็น in-memory mock: list ซ่อนต้นทุน; detail คืน 200 พร้อมต้นทุนและเลขบัตรเต็ม โดย detail query มีเพียง id ไม่มี branch predicate ไม่ได้ทดสอบ JWT จริงหรือฐานข้อมูล production

**แก้ขั้นต่ำ:** ส่ง actor ไป list/detail/daily summary และใช้ branch scope กับ response projection/masking ร่วมกัน ไม่แก้เฉพาะการซ่อนคอลัมน์หน้าจอ

หลักฐาน: [apps/api/src/modules/sales/sales.controller.ts:86](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/sales/sales.controller.ts:86) · [apps/api/src/modules/sales/services/sales-query.service.ts:125](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/sales/services/sales-query.service.ts:125) · [apps/api/src/modules/sales/services/sales-query.service.ts:158](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/sales/services/sales-query.service.ts:158) · [apps/api/src/modules/customers/customers.controller.ts:51](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/customers/customers.controller.ts:51) · [ผลทดสอบ HTTP](evidence/scrutinize-check.json)

## S03 · P1 — สร้างสัญญาผ่อนมีสองเส้นทางที่กติกาและจังหวะสร้างใบขายต่างกัน

**ผลกระทบ:** หากรวม POS แล้วเปิด INSTALLMENT ผ่าน `/sales` จะไม่เท่ากับพาไป wizard เดิม ลูกค้าที่ชำระสิ้นเดือนอาจสร้างไม่ได้ และรายงานขายนับรายการตั้งแต่ยังเป็น DRAFT

**เส้นทาง A:** หน้า ContractCreate → `POST /contracts` → ContractLifecycleService: รับวัน 1–31, ตรวจสัญญา ACTIVE/OVERDUE/DEFAULT พร้อม override, เก็บ customerSnapshot, สร้างร่าง/ตารางผ่อน/รับดาวน์; เปิด ACTIVE ปกติจึงสร้าง Sale เมื่อยังไม่มี

**เส้นทาง B:** `POST /sales` ด้วย INSTALLMENT → SaleCreationService → SaleWriterService: DTO จำกัดวัน 1–28, ไม่มีด่าน active-contract แบบ A ในเส้นทางที่ตรวจ, สร้าง Contract DRAFT พร้อม Sale ทันที; SalesQuery default กรอง deletedAt แต่ไม่กรองสถานะสัญญา

**ทำซ้ำแล้ว:** ผ่าน ValidationPipe ค่าตั้งเดียวกับ main.ts: `paymentDueDay=31` ผ่าน CreateContractDto แต่ CreateSaleDto คืน 400 ส่วนความต่างเรื่อง creation/รายงานยืนยันจาก call path ยังไม่ได้ทำธุรกรรมครบทั้งสองเส้นทางบน PostgreSQL

ปัจจุบัน POS **ซ่อน** ตัวเลือก INSTALLMENT และส่งผู้ใช้ไป wizard จึงไม่กล่าวว่าทุกการขายผ่อนผ่านหน้าจอปัจจุบันผิด ห้ามเปิด branch ที่ซ่อนอยู่เพียงเพื่อให้ต้นแบบสามแท็บทำงาน

ทั้งสองเส้นทางยังเรียก `claimCreditApproval` ซึ่งตรวจผลอนุมัติ ความสดของข้อมูล และภาระผ่อนเดิม ความต่างที่กล่าวถึงคือด่านห้ามมีสัญญา active เว้นแต่ role ที่อนุญาตยืนยัน override ในเส้นทาง A ไม่ใช่การกล่าวว่าเส้นทาง B ไม่มีการตรวจเครดิต ([credit-approval.ts:217](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/credit-check/services/credit-approval.ts:217))

**แก้ขั้นต่ำ:** คง wizard `/contracts` เป็นทางเข้าจาก POS; ตรวจผู้เรียก API อีกเส้นทางก่อน deprecate หรือทำให้ delegate ไป lifecycle เดียวกัน พร้อมกำหนดเวลาสร้าง Sale ให้ชัด อย่าคัดลอกด่านเพิ่มคนละชุด

หลักฐาน: [apps/web/src/pages/POSPage/index.tsx:28](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/src/pages/POSPage/index.tsx:28) · [apps/api/src/modules/sales/dto/sale.dto.ts:88](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/sales/dto/sale.dto.ts:88) · [apps/api/src/modules/contracts/dto/contract.dto.ts:49](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/contracts/dto/contract.dto.ts:49) · [apps/api/src/modules/contracts/services/contract-lifecycle.service.ts:53](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/contracts/services/contract-lifecycle.service.ts:53) · [apps/api/src/modules/sales/services/sale-writer.service.ts:395](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/sales/services/sale-writer.service.ts:395) · [apps/api/src/modules/contracts/contract-workflow.service.ts:515](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/contracts/contract-workflow.service.ts:515)

## S04 · P1 — ช่อง “เงินดาวน์ที่รับเป็นเงินสด/โอน” ไม่มีวิธีรับเงินให้บันทึกจริง

**ผลกระทบ:** หากลูกค้าโอนดาวน์ ระบบเส้นทางสร้างสัญญานี้ยังเลือกบัญชีลิ้นชักสาขา และตอนสร้าง Sale เมื่อเปิด ACTIVE ระบุ paymentMethod เป็น CASH จึงไม่ควรออกแบบปุ่ม “สร้างร่าง” ให้ดูเหมือนยังไม่มีผลต่อเงิน

**เส้นทาง:** ฟอร์มมีจำนวน downPayment → CreateContractDto ไม่มี downPaymentMethod/receipt reference → ContractLifecycleService.create โพสต์ ShopDownPayment ภายใน transaction ทันทีเมื่อดาวน์ > 0 ด้วย `resolveBranchCashAccount` → activate สร้าง Sale `paymentMethod:'CASH'` ทั้งที่ resolver มี `resolveInflowCashAccount` สำหรับแยกเงินสด/โอนอยู่แล้ว

**แก้ขั้นต่ำ:** แยก “ดาวน์ที่ตกลง” กับ “รับเงินจริงแล้ว” ในคำเรียกและคำสั่งให้ชัด เก็บวิธีรับ/เวลา/หลักฐานตามที่ธุรกิจใช้จริง และส่งถึง resolver/ใบขาย หากคงรับเงินพร้อมสร้างสัญญา ให้หน้าทบทวนบอกผลนี้ก่อนยืนยัน ตรวจแก้ยอด/ยกเลิก/คืนเงินเป็นวงจรเดียวกันด้วย

ยืนยันจากโค้ด ไม่ได้ทดสอบ journal จริงและไม่ได้เปลี่ยนนโยบายเวลารับเงินของธุรกิจ

หลักฐาน: [apps/web/src/pages/ContractCreatePage/hooks/useContractCreateData.ts:320](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/src/pages/ContractCreatePage/hooks/useContractCreateData.ts:320) · [apps/api/src/modules/contracts/dto/contract.dto.ts:4](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/contracts/dto/contract.dto.ts:4) · [apps/api/src/modules/contracts/services/contract-lifecycle.service.ts:255](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/contracts/services/contract-lifecycle.service.ts:255) · [apps/api/src/modules/journal/shop-account-resolver.service.ts:40](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/journal/shop-account-resolver.service.ts:40) · [apps/api/src/modules/contracts/contract-workflow.service.ts:530](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/contracts/contract-workflow.service.ts:530)

## S05 · P1 — ไฟแนนซ์ภายนอกดาวน์ศูนย์ บันทึกยอดจัดเป็น amountReceived เต็มยอด

**ผลกระทบ:** ข้อมูลใบขายระบุรับเงินแล้ว แม้ยังตั้งยอดรอรับจากบริษัทไฟแนนซ์อยู่ การออกแบบ KPI “เงินรับวันนี้” จาก Sale.amountReceived โดยตรงจึงใช้ไม่ได้

**เส้นทาง:** POS ส่ง downPayment=0 และ financeAmount=netAmount → writer ใช้ `downPayment > 0 ? downPayment : financeAmount` เป็น amountReceived → สร้าง FinanceReceivable.expectedAmount=financeAmount อีกครั้ง โดยไม่มี receipt event ในคำขอนี้

**ทำซ้ำแล้ว:** writer จริง + dependencies จำลอง: ดาวน์ 0 / ขาย 10,000 → amountReceived 10,000 และยัง expectedFromFinance 10,000 ในธุรกรรมเดียวกัน ยังไม่ได้กล่าวว่าทุก dashboard ปัจจุบันนำค่าผิดนี้ไปใช้ เพราะต้องตามผู้ใช้ข้อมูลแต่ละรายงานต่อ

**แก้ขั้นต่ำ:** amountReceived ตอนขายต้องสื่อเงินที่รับจริงตามนิยามที่กำหนด แยกยอดรอรับจากไฟแนนซ์ออกจากการรับชำระภายหลัง และทำรายงานกระแสเงินจาก receipt/ledger ตามวันที่รับจริง ไม่ใช้วันที่สร้าง Sale แทน

หลักฐาน: [apps/web/src/pages/POSPage/index.tsx:223](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/src/pages/POSPage/index.tsx:223) · [apps/api/src/modules/sales/services/sale-writer.service.ts:550](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/sales/services/sale-writer.service.ts:550) · [apps/api/src/modules/sales/services/sale-writer.service.ts:642](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/sales/services/sale-writer.service.ts:642) · [ผลทำซ้ำ](evidence/scrutinize-check.json)

## S06 · P1 — การแปลงใบจองข้ามด่านสินค้าที่เส้นทางขายปกติบังคับ

**ผลกระทบ:** แม้แก้ product picker ตาม F03 แล้ว ก็ยังไม่ปลอดภัยพอให้เปิดใช้ convert เต็มรูปแบบ การเช็ก IN_STOCK อย่างเดียวไม่ครอบคลุมกติกาสินค้า

**เส้นทาง:** BookingsController อนุญาต SALES → convert ตรวจสาขาใบจอง → อ่านเครื่องและตรวจ IN_STOCK/deletedAt/test-side → สร้าง Sale/ตัดสต็อก/ลงบัญชี แต่ไม่ตรวจ wasPreviouslyDamaged และไม่เทียบ product.branchId กับ booking.branchId

**ทำซ้ำแล้วด้วย service จริงและ in-memory dependencies แยกกรณี:**

- SALES แปลงใบจองของตัวเองที่ผูกเครื่อง wasPreviouslyDamaged=true ได้ ขณะที่ส่ง input เครื่องเดียวกันเข้า normal SaleCreationService ถูกปฏิเสธเพราะไม่มี acknowledgement
- ใบจองสาขา A ที่ผูกเครื่องสาขา B สร้าง Sale สาขา A และตัดเครื่อง B ได้ การสร้างใบจองตรวจ product test-side แต่ไม่ได้บังคับความตรงของสาขา และ API update ก็เปิดให้ผูกสินค้า

ไม่ได้ทดสอบ concurrent transactions จริง; จำนวน journal calls ในผลทดสอบเป็น template mocks ไม่ใช่การรับรองว่า ledger จริงถูกต้อง

**แก้ขั้นต่ำ:** ใช้ transaction-scoped validation ของสินค้าและนโยบายสิทธิ์ร่วมกัน ส่ง actor/acknowledgement/branch ชัดเจน; รวม invariants นี้ก่อนรวม writer ทั้งก้อน เพราะ booking มีการล้างมัดจำที่การขายปกติไม่มี

หลักฐาน: [apps/api/src/modules/bookings/bookings.controller.ts:118](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/bookings/bookings.controller.ts:118) · [apps/api/src/modules/bookings/bookings.service.ts:627](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/bookings/bookings.service.ts:627) · [apps/api/src/modules/bookings/bookings.service.ts:685](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/bookings/bookings.service.ts:685) · [apps/api/src/modules/bookings/bookings.service.ts:705](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/bookings/bookings.service.ts:705) · [apps/api/src/modules/sales/services/sale-creation.service.ts:86](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/sales/services/sale-creation.service.ts:86) · [ผลทำซ้ำ](evidence/scrutinize-check.json)

## S07 · P2 — ใบจองหมดอายุแล้วแปลงขายได้ แต่ยกเลิกไม่ได้ก่อน cron ทำงาน

**ผลกระทบ:** ใบเดียวกันไปต่อได้หรือไม่ได้ตาม action ที่เลือกและเวลาที่ cron ทำงาน ไม่ใช่ตามสถานะทางธุรกิจที่สื่อกับพนักงาน

**เส้นทาง:** cancel ตรวจ expireDate แล้วปฏิเสธ → convert ตรวจเพียง PAID/convertedToSaleId ไม่มี expireDate ใน precheck หรือ updateMany predicate → cron ค่อยเปลี่ยน PAID เป็น EXPIRED วันละครั้ง

**ทำซ้ำแล้ว:** service จริงกับ PAID fixture ที่ expireDate อยู่ปี 2000 ยัง convert สำเร็จ จุดนี้เลื่อนจาก “ต้องทดสอบเพิ่ม” ในรายงานแรกเป็น **ยืนยันพฤติกรรม service แล้ว**; ยังต้องตกลงนโยบายว่าอนุญาตต่ออายุ/ขายต่อโดย role ใดก่อนแก้ ไม่สรุปเองว่าทุกใบหมดอายุต้องริบเงิน

**แก้ขั้นต่ำ:** ใช้ expiry/extension policy เดียวกันใน pay/cancel/convert/cron และตรวจในเงื่อนไข write ภายใน transaction; ปรับสถานะ unpaid-expired ตาม F15 ด้วย

หลักฐาน: [apps/api/src/modules/bookings/bookings.service.ts:528](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/bookings/bookings.service.ts:528) · [apps/api/src/modules/bookings/bookings.service.ts:629](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/bookings/bookings.service.ts:629) · [apps/api/src/modules/bookings/bookings.service.ts:669](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/bookings/bookings.service.ts:669) · [apps/api/src/modules/bookings/bookings.service.ts:904](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/bookings/bookings.service.ts:904)

## S08 · P2 — ต้นแบบรวมเงินมัดจำไปทุกวิธีขาย แต่ backend ปัจจุบันรองรับเฉพาะ CASH

**ผลกระทบ:** ถ้านำต้นแบบไปต่อ API ตรง ๆ อาจนำมัดจำไปหักบนจอโดยยังไม่ล้างเงินมัดจำฝั่งระบบ และของแถมหรือราคาที่ตกลงอาจหายระหว่าง POS → สัญญา

**หลักฐาน:** prototype ใช้ใบจองเดียวกันเมื่อสลับ cash/installment/external; ConvertBookingDto อนุญาตเพียง CASH; CreateContractDto ไม่มี bookingId; `contractReturnUrl` อนุญาต customerId/productId/fromRoom/downAmount/months/resume เท่านั้น จึงส่งส่วนลด ของแถม หรือเงินมัดจำต่อไม่ได้ด้วยการเพิ่ม IDs สองตัวอย่างเดียว

**แก้ข้อเสนอ:** แยกเป็นสองระยะชัดเจน:

1. ระยะแรก — คงเมนูเดิม ส่ง customerId/productId ไป wizard เดิมเพื่อไม่ต้องเลือกซ้ำ พร้อมทบทวนราคาผ่อนใหม่; ระบุ/จัดการ fields ที่ไม่ถูกส่งต่อให้ชัด; booking convert ยังใช้ CASH ตาม API จนวงจรเงินพร้อม
2. ระยะถัดไป — ออกแบบการใช้มัดจำร่วมกับผ่อน/ไฟแนนซ์ รวม claim ใช้ครั้งเดียว, customer/product/branch match, refund/void, และผลต่อ SHOP/FINANCE ก่อนพัฒนา UI ต่อ

แก้ป้ายต้นแบบให้ระบุว่าเป็น **แนวคิดระยะถัดไป** แล้ว การสลับหน้าและ dialog สาธิตไม่ใช่การพิสูจน์เลือกสินค้า เปลี่ยนลูกค้า ค้นหา รับเงิน หรือส่งออกครบวงจร การสลับลำดับเมนูยังเป็นสมมติฐานการออกแบบ ไม่มีผลทดสอบใช้งานกับพนักงานมารองรับ

หลักฐาน: [docs/review/2026-09-11-sales/prototype.html:21](/Users/iamnaii/Desktop/App/BESTCHOICE/docs/review/2026-09-11-sales/prototype.html:21) · [apps/api/src/modules/bookings/dto/convert-booking.dto.ts:18](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/bookings/dto/convert-booking.dto.ts:18) · [apps/api/src/modules/contracts/dto/contract.dto.ts:4](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/contracts/dto/contract.dto.ts:4) · [apps/web/src/lib/contract-return.ts:7](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/src/lib/contract-return.ts:7) · [apps/web/src/pages/ContractCreatePage/hooks/useContractCreateData.ts:24](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/src/pages/ContractCreatePage/hooks/useContractCreateData.ts:24)

## ทวนข้อค้นพบเดิมและคุณภาพหลักฐาน

| ข้อเดิม | ผลตรวจซ้ำ |
|---|---|
| F01 สาขายอดขาย | คงไว้และเพิ่ม Nest HTTP + guards จริงตาม S02; JWT/principal กับ Prisma ยังจำลอง |
| F02 แก้มัดจำรับแล้ว | คงไว้: update ไม่ปรับ journal และไม่ตรวจมัดจำเดิมเมื่อเปลี่ยนเฉพาะ total |
| F03–F04 ใบจองผูกสินค้า/หลายรายการ | คงไว้; เพิ่มว่าการแก้ picker อย่างเดียวไม่พอตาม S06 |
| F05 ราคา POS | ยืนยันเพิ่มใน browser: CASH แต่เลือก 10,000 ทั้งที่ cashPrice=9,000 และ isDefault=true — [ภาพ](evidence/scrutinize-pos-cash-price.png) |
| F06–F07 กำไรรวม/export | คงไว้: aggregate คนละ scope กับ page data; query export ยังใช้ page เดิม; customer limit ขัด DTO |
| F08 บัญชีมัดจำ | คงไว้เฉพาะ metadata/ตัวเลือกบัญชีไม่ตรงกับ resolver และวิธีรับส่วนต่างไม่ให้เลือก ไม่กล่าวว่า backend เอารหัส FINANCE ไปลง SHOP จริง |
| F09–F11 pagination/สิทธิ์/ส่งต่อ | คงไว้; การส่งต่อ IDs แก้เพียงลูกค้าและสินค้า ไม่ได้รักษาทุก field ตาม S08 |
| F12 ลายเซ็น 4/5 | คงไว้เป็น UI mismatch; backend approval/activation มี guardian gate จึงไม่ใช่หลักฐานเปิดสัญญาโดยเซ็นไม่ครบ |
| F13 อ่านเอกสารไม่สำเร็จ | ยืนยันเพิ่มใน browser: preview 503, iframe=0, ติ๊กแล้ว nextEnabled=true และไป StepSignature ได้ — [ภาพก่อน](evidence/scrutinize-sign-preview-failed.png), [ภาพหลัง](evidence/scrutinize-sign-advanced-without-preview.png) |
| F14 cache | คงไว้; เป็น stale view ภายในช่วง cache ไม่ใช่หลักฐานว่าข้อมูลที่บันทึกหายจาก DB |
| F15 expiry | คงไว้และเพิ่ม expired-convert ตาม S07 |
| F16 มือถือล้น | คงผลจับภาพเดิม; แก้แนวทาง container ไม่จำเป็นต้องรื้อ Layout ทั้งหมด |
| F17–F18 คำเรียก/ช่วงวัน | คงไว้; นิยามเงินรับต้องคำนึง S04–S05 ด้วย ไม่แก้แค่ชื่อ KPI |

**ข้อจำกัดของ tests เดิม:** จำนวน tests ที่ผ่านไม่ใช่หลักฐานว่าไม่มีปัญหาเหล่านี้ ตัวอย่าง SaleWriter unit tests mock `claimCreditApproval` และเรียก writer ตรง จึงไม่ผ่าน validation DTO; hook calculation tests ป้อน config ตรง จึงไม่ตรวจ config resolver ฝั่ง API; booking test ที่ตั้ง claim.count=0 ตรวจ double-convert ใบเดียว ไม่ได้จำลองการแข่งขันคนละใบจองแย่งเครื่องเดียวกัน

หลักฐาน: [apps/api/src/modules/sales/services/sale-writer.service.spec.ts:49](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/sales/services/sale-writer.service.spec.ts:49) · [apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.test.ts:51](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/src/pages/ContractCreatePage/hooks/useContractCalculation.test.ts:51) · [apps/api/src/modules/bookings/__tests__/bookings.service.spec.ts:520](/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/bookings/__tests__/bookings.service.spec.ts:520)

## การตรวจที่รันเพิ่มและสิ่งที่ยังไม่ได้รับรอง

- [Diagnostic script](scrutinize-check.ts): **8 observations ยืนยันได้** รวม HTTP/DTO/booking/finance/calculation; การผ่านหมายถึงทำซ้ำพฤติกรรมที่พบได้ ไม่ใช่ regression tests ที่ยืนยันว่าแก้แล้ว — [ผล](evidence/scrutinize-check.json)
- Browser: **7 captures**, ไม่มี pageerror; บังคับ preview 503, ราคาสด/ผ่อนต่างกัน และ config VAT 7% เพื่อเปิดข้อผิดพลาดที่ happy-path fixtures รอบแรกไม่แสดง — [ผล](evidence/scrutinize-browser.json)
- ตรวจต้นแบบหลังแก้ป้าย: 6 เมนู × 2 ขนาดจอ ไม่ล้น document, ไม่มี pageerror, review dialog และการส่งต่อหน้าสาธิตทำงาน — [ผล](prototype-check.json)
- ไม่มี application code/schema/ข้อมูลจริงถูกแก้; มีเพียงเอกสาร หลักฐาน และป้ายอธิบายต้นแบบ
- ไม่รัน `local:check` ทั้งชุดซ้ำในรอบตรวจเอกสารนี้ ผลรอบแรกยังคงเป็น fail เพราะ storefront resolve `gsap` ไม่ได้ ไม่อ้างว่าชุดรวมผ่านแล้ว
- ยังไม่ได้พิสูจน์ ledger จริง, DB constraints ทุกชุด, concurrency, external finance settlement, OTP/sign submission หรือ role journeys ครบทุกแบบกับ API เต็ม
- Local app: [5207](http://localhost:5207/customers) เป็น limited preview จาก checkout นี้; [ต้นแบบ 5211](http://localhost:5211/prototype.html) เป็นแนวคิดระยะถัดไปและข้อมูลจำลอง

รัน diagnostic ซ้ำจาก repository root (ต้องมี `evidence/scrutinize-browser.json` ที่บันทึกไว้):

```sh
TS_NODE_PROJECT=apps/api/tsconfig.json node -r ts-node/register/transpile-only docs/review/2026-09-11-sales/scrutinize-check.ts
```

**Verdict: REWORK แผนรวม flow ก่อนลงมือ — เหตุผลใหญ่ที่สุดคือเงินและเงื่อนไขธุรกิจยังให้ผลต่างกันตามเส้นทางที่เรียก การรวม UI ทันทีจะซ่อนความต่างนี้แทนที่จะทำให้ตรงกัน**
