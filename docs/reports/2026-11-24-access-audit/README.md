# ผลตรวจสิทธิ์ทุกตำแหน่ง BESTCHOICE

ตรวจ 24 พฤศจิกายน 2026 (Asia/Bangkok), source `b2c007cdd` พร้อมไฟล์งานเดิมใน checkout ขณะตรวจ งานนี้เป็นการสำรวจและเสนอแผน ไม่แก้ runtime ไม่เปลี่ยนบัญชีจริง และไม่ deploy

## ข้อสรุป

ระบบมีสิทธิ์สองชุดที่ยังทำงานไม่เหมือนกัน: **role เดิม 6 แบบ** และ **แม่แบบตำแหน่งใหม่ 9 แบบ** การมีรายการ permission ในระบบใหม่ไม่ได้แปลว่าหน้า/API/ไฟล์/แชททุกส่วนรองรับแล้ว ระบบเดิมมีทั้งสิทธิ์กว้างเกินข้อตกลงและหน้าที่เปิดไม่ได้ ส่วนระบบใหม่ยังมีเส้นทางที่ปฏิเสธงานปกติ จึงควรปิดช่องโหว่สำคัญและทำ workflow ให้ครบก่อนย้ายบัญชี

พบข้อกำหนดเจ้าของเดิมวันที่ 17 ต.ค. เรื่องไม่ให้ผู้จัดการเห็นต้นทุน/กำไรโดยค่าเริ่มต้น และให้เจ้าของอนุมัติยกเลิกขาย/คืนเงิน/ลดดอกเบี้ย/ยกเว้นค่าปรับ ต้องรักษาข้อตกลงนี้ ส่วนข้อกำหนดเงินเดือนวันที่ 28 ต.ค. ใหม่กว่าและยังให้ผู้จัดการอ่านใบของสาขาตนเองและพิมพ์สลิปได้ แต่ห้ามทำใบเงินเดือน จึงต้องรักษาข้อยกเว้นที่มีขอบเขตนี้ด้วย

## ข้อมูลที่ตรวจจริง

| ขอบเขต | ผล |
|---|---|
| เส้นทางใน App.tsx | 225 เส้นทาง รวมหน้าพนักงาน หน้าสาธารณะ และ redirect |
| API/socket entrypoints | 1,491 ใน 192 ไฟล์: staff 1,378, self-service 11, public 60, customer 30, integration 12 |
| Domain policies | 1,145 รายการที่ต้องใช้การตรวจแหล่งข้อมูล/ขอบเขต **ไม่ใช่จำนวนงานที่ยังไม่เสร็จ** |
| Permission catalog | 399 สิทธิ์ย่อย |
| Legacy role | OWNER, BRANCH_MANAGER, SALES, FINANCE_MANAGER, ACCOUNTANT, VIEWER |
| Default position templates | เจ้าของ + 8 ตำแหน่งที่มอบหมายได้; ยังไม่รวมแม่แบบ VIEWER/แอดมินแชท/HR |
| Production ที่ connector เชื่อมต่อ | active OWNER 7 บัญชี; active BM 2 บัญชี (1 บัญชีไม่ผูกสาขา); SALES 2 / ACCOUNTANT 1 / OWNER 2 ที่ไม่ active |
| ตำแหน่ง/การมอบหมายในฐานที่เชื่อมต่อ | access_positions, employee_access_assignments และตารางผูกสาขา ล้วน 0 แถว |

ตัวเลขบัญชีไม่ยืนยันจำนวนบุคคลหรือหน้าที่จริง บัญชี OWNER อาจมีวัตถุประสงค์ต่างกัน ต้องตรวจชื่อ/ID/ผู้ใช้จริงผ่านช่องทางที่เจ้าของเข้าถึงได้ก่อนลดสิทธิ์ Connector ไม่อนุญาตอ่าน access_managed และ accessible_companies จึงไม่สรุปสถานะสองค่านี้รายบัญชี และไม่พยายามหลบข้อจำกัด

## สิทธิ์เดิมแยกทุก role

จำนวนด้านล่างคือปลายทางเมนูไม่ซ้ำ รวมปุ่มแชทและรายการตั้งค่าตาม config ไม่เท่ากับจำนวนหน้าทั้งหมดหรือสิทธิ์ API

| Role | เมนู | สิ่งที่โค้ดเดิมเปิดให้โดยสรุป | ข้อจำกัด/ความเสี่ยงสำคัญ |
|---|---:|---|---|
| OWNER | 74 | ขาย สต็อก จัดซื้อ การเงิน บัญชี พนักงาน ตั้งค่าและสิทธิ์ | ต้องแยกบัญชีเจ้าของจริงจากผู้ทำงานทั่วไป; ยังต้องผ่านข้อบังคับธุรกิจ/สถานะและบันทึกประวัติ |
| BRANCH_MANAGER | 33 | งานหน้าร้าน ลูกค้า ขาย สัญญา รับชำระ คลัง จัดซื้อ ค่าใช้จ่าย ทีม รายงาน ติดตาม และแชท | ปัจจุบันยังเห็นต้นทุน/กำไร ยกเลิกขายตรงได้ และมีเส้นทางยกเว้นค่าปรับ; ไม่ตรงข้อกำหนดใหม่; สาขาว่างทำให้ Home 403 แต่บางรายงานกลับกว้างขึ้น |
| SALES | 21 | ลูกค้า จอง ขาย เตรียมสัญญา รับชำระ รับซื้อมือสอง งานหลังขาย ดูคลัง ราคา สติกเกอร์ คอมมิชชัน งานทีม แชท | ซ่อนต้นทุนใน response หลายจุด แต่ error ส่วนลดยังเผยต้นทุน; role cap อนุญาตลดเองบางช่วง; การอ่านข้อมูลลูกค้าบางเส้นทางกว้างกว่าผู้รับผิดชอบ |
| FINANCE_MANAGER | 61 | เครดิต สัญญา รับชำระ ติดตาม การเงิน รายงาน บัญชี/ค่าใช้จ่ายบางส่วน เงินเดือน และแชท | เดิมเข้าข้ามสาขาและเห็นต้นทุน/กำไร; อนุมัติยกเลิกสัญญา/ยกเว้นค่าปรับบางเส้นทาง; ต้องแยกการอนุมัติทั่วไปจากข้อยกเว้นสงวนของเจ้าของ |
| ACCOUNTANT | 55 | บัญชี ภาษี เอกสาร ค่าใช้จ่าย สินทรัพย์ รายงาน กระทบยอด รับชำระบางส่วน เงินเดือน | ต้นทุน/กำไรให้ได้ตามนโยบาย แต่ขอบเขตบริษัท/สาขาและการลงบัญชี/กลับรายการต้องแยก; ไม่มีสิทธิ์ตอบแชทตาม role |
| VIEWER | 14 | เมนูรายงาน งบการเงิน และ audit; API ที่ระบุ role ต้องผ่าน viewer_role_enabled | บางเมนูขัดกับ frontend route; อ่านอย่างเดียวไม่ได้แปลว่าข้อมูลถูกปกปิดหรือห้าม export; การตรวจ viewer flag ไม่ครอบคลุม route ที่ไม่มี @Roles |

**รายละเอียดแต่ละหน้าและแต่ละคำสั่ง:**

- [เมนูแยก role แบบอ่านง่าย](legacy-menus.md) และ [CSV เมนู](menus-by-role.csv)
- [ตารางหน้าเว็บ × 6 roles ทั้ง 225 เส้นทาง](web-route-gates.csv)
- [ตาราง API/socket × 6 roles ทั้ง 1,491 จุด พร้อม managed permission](api-declared-gates.csv)
- [แม่แบบตำแหน่งใหม่พร้อมรายการสิทธิ์ภาษาไทย](current-position-templates.md)
- [ตาราง 399 permissions × 9 แม่แบบ](position-defaults-by-permission.csv)

CSV ของ route/API เป็น **declared gates** ไม่ใช่ effective access: `DECLARED_ALLOWED` ยังต้องผ่าน authentication, ส่วนงาน, สาขา, แหล่งข้อมูล, สถานะ, sensitive permissions และ approval; `NO_ROLE_METADATA` ไม่ได้แปลว่า public/ทุกคนเข้าได้; `NO_ADDITIONAL_ROLE_GATE` ยังมี MainLayout/settings/API; `TEMPLATE_GRANT` เป็นค่าใน source ไม่ใช่ grant บัญชีจริง ผลสแกน role expressions ไม่มี UNRESOLVED เหลือ แต่ยังไม่ครอบคลุม dynamic service conditions ด้วยการสแกนอย่างเดียว

ข้อแก้ความเข้าใจจากรายงานผู้จัดการรอบแรก: แม้ raw ZONE_CONFIG ของ BM มี SHOP/FINANCE แต่ `getZoneConfigForRole` กรองตามบริษัทและการมีเมนูจริงด้วย ผู้จัดการปัจจุบันจึงใช้ SHOP; ไม่ได้เลือก FINANCE เพียงเพราะ config raw มีชื่ออยู่ (`menu.ts:1020–1030`, `menu.test.ts:358–366`) งานที่ชื่อเกี่ยวกับการเงินบางงานยังอยู่ในเมนู SHOP ของ BM

## ประเด็นที่ต้องแก้ เรียงตามผลกระทบ

| ลำดับ | สิ่งที่พบ | ผลกระทบและงานที่ต้องทำ | หลักฐาน |
|---|---|---|---|
| 1 | ตรวจ branch จาก request แต่บาง route ไม่ตรวจเจ้าของข้อมูลจริง | legacy Product detail/update และ Customer detail มี read/update ด้วย ID ที่ไม่ผูก source scope ในเส้นทางที่ตรวจ ผู้ใช้ไม่ส่ง branchId ก็ไม่ทำให้เกิดการตรวจสาขาเป้าหมาย ต้องบังคับจาก persisted source ทุกครั้ง รวมข้อมูลลูก/ไฟล์ | products.controller.ts:255–276; products.service.ts:227–266,403–476; customer-query.service.ts:1088–1137; BranchGuard |
| 2 | ข้อความส่วนลด legacy เผยต้นทุน | ผู้ขายที่ไม่มีสิทธิ์ต้นทุนอาจได้ตัวเลขจาก error ต้องตัดทั้ง error/detail/preview/export ไม่ใช่เฉพาะ success | sales/services/discount-policy.util.ts:60–65 |
| 3 | BM/FM เห็นต้นทุน/กำไรเกินค่าเริ่มต้นที่ตกลง | canSeeCost เปิดให้ทุก role ยกเว้น SALES; Home รายเดือนอ่านทั้ง SHOP; ปรับตาม source-sensitive capability และแยกยอดขายจากกำไร | products/cost-visibility.util.ts:16–18; shop-home.controller.ts:24–43; shop-home.service.ts:121–140 |
| 4 | BM ไม่มีสาขา: Home ปฏิเสธ แต่ P&L อาจไม่กรอง | reports controller แปลง branchId ว่างเป็น undefined และ report service ใช้ filter ว่าง ต้องมีผลลัพธ์ปฏิเสธ/ยังไม่ตั้งสาขาที่สอดคล้องกัน ห้ามแปลว่างเป็นทุกสาขา | reports.controller.ts:64–88; transactional-report.service.ts:126–167 |
| 5 | อำนาจเงินใน legacy ไม่ตรงข้อตกลง | BM void sale; FM approve installment cancellation; BM/FM late fee waiver; refund ใช้สิทธิ์ราย username ต้องย้ายไป owner approval ของรายการจริงและผู้ดำเนินการแยก | sales.controller.ts:132–140; contracts.controller.ts:408–415; late-fee-waiver.controller.ts:49–55; refunds.service.ts:672–686 |
| 6 | ส่วนลดไม่ได้ใช้คำอนุมัติที่ตรวจย้อนหลังครบ | legacy SALES cap 5%, BM 15%; เกิน 10% ตรวจเพียงมี secondApproverId ไม่มีเพดานบาท; managed ปัจจุบันยังจำกัด discretionary discount ให้ owner แทน flow ผู้จัดการ | discount-policy.util.ts:14–65; sale-creation.service.ts:72–75,176–182 |
| 7 | Managed Home ใช้ไม่ได้ | มี dashboard.read แต่ไม่มี registered boundary สำหรับ ShopHomeController.get; non-owner ได้ 403 แม้ grant ถูก | access-policy.manifest.json:1437; access-policy.ts:39–65 |
| 8 | แม่แบบใหม่ยังขาดสิทธิ์ประกอบงาน | BM มี promotions.apply แต่ไม่มี read; สร้างสัญญาแต่ไม่มีเอกสารประกอบ; ไม่มี trade-in.* ในทุกแม่แบบ; FM activate แต่ไม่มี Product source read ที่ flow ต้องใช้ ต้องทดสอบงานตั้งแต่ต้นจนจบและให้เฉพาะสิทธิ์จำเป็น | employee-access.ts:589–870; access-contract-files-boundaries.ts:35; manifest:1347 |
| 9 | หน้าเว็บยังยึด user.role; socket managed ถูกตัด | อาจเห็นเมนูที่เปิดไม่ได้/ซ่อนสิ่งที่ grant ให้; cache ไม่ติดตาม revision สิทธิ์; realtime ยัง fail-closed staging | ProtectedRoute.tsx:42; LayoutContext.tsx:109–125; access-socket-boundary.ts:10–34 |
| 10 | ประวัติสำหรับพนักงานทุกคนยังไม่เสร็จ | generic interceptor ข้าม reads หลายอย่างและเขียนแบบ best effort; หน้าประวัติเดิม OWNER/VIEWER อ่าน raw changes ต้องสร้าง safe summary และ source-filtered detail โดยรักษา logs เดิม | audit.interceptor.ts:45–104; audit.service.ts:157–166; audit.controller.ts:29; AuditLogsPage |
| 11 | บันทึก assignment คือการเปลี่ยนโหมดจริง | service ตั้ง managed=true และล้าง overrides เดิมใน transaction; invite ยังสร้าง legacy โดย default ต้อง preview ผลต่างและปิดช่องทางสร้างบัญชีที่ข้ามนโยบาย | employee-access.service.ts:290–358,385; invite.service.ts:281–299 |
| 12 | VIEWER ไม่ตรงกันระหว่างเมนู/route/API | บางเมนูถูก frontend ปฏิเสธ; direct report export/audit ยังมีรายละเอียดส่วนบุคคลตาม legacy ต้องกำหนดชุดเอกสารและ scope ชัดเจน ไม่ตีความ read-only ว่าดูได้ทุกอย่าง | menu.ts:736–790; App.tsx:823–884; reports.controller.ts:280–292; operational-report.service.ts:135–176 |

รายละเอียดที่ต้องรวมในงานข้อ 5: การปิดยอดผ่อนด้วยสลิปที่ตรวจยอดตรงยังรับ discountPct ของ BM/FM ใน legacy โดยด่านห้ามส่วนลดบวกใช้กับ managed เท่านั้น (`contract-payment.service.ts:572–622`) ห้ามสรุปว่าการปิด direct early-payoff endpoint เพียงจุดเดียวแก้ครบ เพราะ direct endpoint มี guard approvalContext อยู่แล้ว ต้องคง zero-discount/gateway payment ปกติ และควบคุม discretionary interest reduction ทุกทางเข้า นอกจากนี้ ACCOUNTANT เห็นปุ่มอนุมัติ/ปฏิเสธคิวยกเลิกสัญญาบนเว็บ แต่ API อนุญาต OWNER/FM เท่านั้น เป็นตัวอย่าง action UI/API ไม่ตรงกัน (`ContractCancellationPage.tsx:244–261`, `contracts.controller.ts:408–424`)

นี่เป็นข้อค้นพบจาก local source/ชุดทดสอบ ไม่ได้ยิงคำสั่งแก้ไขหรือทดลองเข้าข้ามสาขาบน production จึงไม่กล่าวอ้างว่าได้พิสูจน์การโจมตีจริงหรือว่า production ใช้ commit เดียวกันทุกส่วน

## เรื่องที่ต้องรักษา ไม่ตัดสิทธิ์ทิ้งโดยเหมารวม

- คำสั่งเจ้าของ 28 ต.ค.: ผู้จัดการอ่านใบเงินเดือนสาขาตนเองและพิมพ์สลิปได้ แต่ห้ามสร้าง/แก้/อนุมัติ/ลงบัญชี/ยกเลิก/ลบ (`.claude/rules/accounting.md:1134`; `expense-documents/payroll-roles.ts:3`) ต้องใช้ข้อกำหนดใหม่นี้กับงานเงินเดือนโดยเฉพาะ ไม่ขยายไปสิทธิ์บัญชีธนาคารเงินเดือนหรือทั้งบริษัท
- คืนเงินที่อนุมัติแล้วให้พนักงานการเงิน/เจ้าของดำเนินการตามยอดเดิมได้ การอนุมัติคืนเงินไม่ใช่การจ่ายเงินจริง และต้องรักษาการป้องกันซ้ำ/บัญชีเดิมที่มีอยู่
- การยกเลิกขายต้องรักษาการกลับบัญชีและหักคืนคอมมิชชันตามกติกาใหม่ แม้เปลี่ยนผู้อนุมัติ
- หน้าราคาและเรทผ่อนยังต้องใช้ได้ตามหน้าที่; การแก้ต้นทุนให้แยกสิทธิ์จัดซื้อจากการดู/แก้ราคาขาย ไม่ใช้การปิดทั้งหน้าเป็นวิธีแก้
- การเห็นลูกค้ารายหนึ่งไม่เปิดประวัติทุกบริษัท/ทุกสาขาของลูกค้านั้น และการขาดสิทธิ์ข้อมูลบางหมวดต้องแสดง “ไม่มีสิทธิ์/ไม่พร้อม” ไม่แสดงเป็นยอดศูนย์

## ผลตรวจและข้อจำกัด

- Inventory checker ผ่าน 1,491 entrypoints; scanner regression 1 test ผ่าน
- Shared evaluator/default tests 47 ผ่าน
- Parent web tests 96 ผ่าน (menu/route/CTA/settings)
- ชุด route-reachability เดิมไม่ได้รวม VIEWER ใน ALL_ROLES จึงใช้ผลเขียวของชุดนั้นยืนยัน VIEWER ไม่ได้; ข้อค้นพบ VIEWER มาจากการเทียบ config/route/API แยก
- Independent legacy audit: web 173, API unit/mocked 148 ผ่าน
- Independent managed audit: API unit 35 ผ่าน; shared 47 ผ่านซ้ำ จึงไม่บวกเป็น test ใหม่
- มี overlap ระหว่าง suite บางชุด จึงไม่ใช้ผลบวกรวมเป็นจำนวน tests ไม่ซ้ำ API script ใช้ forceExit ตามโครงการ
- Inventory generator สร้าง artifacts จาก source จริง ตรวจ role expressions ครบ; ไม่ใช่การทดสอบ HTTP/ปุ่มทุกหน้า
- ไม่ได้ทดสอบ browser login ทุก role, production denial logs, grant รายคน, live providers หรือ migration จริง
- ไม่มีการแก้ product code จึงไม่สร้าง preview จำลองมาอ้างว่า validation ของระบบสิทธิ์ทั้งหมดผ่าน

อ่าน [ข้อเสนอสิทธิ์และแผนเปลี่ยนผ่าน](../../superpowers/specs/2026-11-24-role-access-renewal-design.md) ต่อ รายละเอียดนี้ต่อยอดแผน 17 ต.ค. ไม่แทนที่งานเก่าหรือเปลี่ยนสถานะงานค้างว่าเสร็จแล้ว
