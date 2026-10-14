# BESTCHOICE — ผลแก้ UX/UI และตรวจรอบต่อเนื่อง 14 ต.ค. 2569

แก้ครบรายการที่พบในรอบนี้ใน branch `fix/uxui-audit-2026-10-14` บนฐานโค้ด `444c4450291f780eeb095088d764d38815b59d35` รวม 18 findings เดิมและข้อบกพร่องที่พบจากการไล่รายหน้าเพิ่มเติม โค้ดยังอยู่ในเครื่อง **ไม่ได้ commit/push/merge/deploy** และไม่ได้เปลี่ยนข้อมูล production

ผู้ใช้แก้ข้อมูลล่าสุดว่า **ไม่มี staging และไม่มีเครื่องจริงสำหรับทดสอบ** จึงไม่ลงนามว่าผ่าน native LINE/iPhone/Android หรือเครื่องพิมพ์จริง ผลทั้งหมดด้านล่างเป็นการตรวจในเครื่องพร้อมขอบเขตชัดเจน

## สิ่งที่แก้เพิ่มจากรอบ 18 findings

| กลุ่ม | ผลแก้ | หลักฐาน |
|---|---|---|
| ลิงก์ใบสำคัญเก่า | รองรับ prefix 2–4 ตัวและรูปแบบปี/เดือน/วัน; ค้นหมายเลขตรงตัวโดยยึดสิทธิ์บริษัทและสาขา รวมเอกสารยกเลิก; guest กลับมาปลายทางหลัง login | Unit + full API actual JWT, guest/role/branch/company denial และ browser cold login |
| หมายเลข RT ที่ซ้ำประเภทได้ | หยุดเดาประเภทจาก prefix ให้เลือกใบเสร็จ/ใบสำคัญตามหัวเอกสาร แล้วเข้าหน้า canonical ที่ตรวจสิทธิ์; ไม่มี query เอกสารก่อนเลือก | Regression เคย fail ก่อนแก้; ตรวจทั้งสองปลายทางและไม่ auto-open |
| LINE / LIFF | callback บัญชีใหม่แทน cache เก่า; ยกเลิก login ไม่แสดงบัญชีเดิม; alias คง query/hash; API error ไม่แสดงว่าชำระครบแล้ว; ปรับข้อความไม่มีสัญญาที่ปิดยอดได้ | Hook regression + 84 browser cases Android Chromium/iPhone WebKit, light/dark; SDK/API ในชุดนี้จำลอง |
| ตัวแก้เทมเพลต | toolbar/ปุ่มแก้ block wrap; มือถือเริ่ม editor; เมนูเพิ่มใช้ portal/scroll/collision; preview A4 ย่อเฉพาะการแสดงผลให้พอดีพื้นที่ | กดเมนูสุดท้าย “แนบรูปภาพ”, ตรวจ block เพิ่มจริงและ preview ที่ 320×568 ทั้งสอง theme |
| แท็บและ filter | กำหนดขนาดขั้นต่ำ/สูงสุดไม่ให้ native select ดันหน้า; แท็บเลื่อนภายในและใช้ keyboard ถึงท้ายได้ | ภาพทุก route + ทดสอบ End key บน GFIN; ไม่ซ่อนเนื้อหาด้วยการ clip body |
| คลัง/สินค้า/ยอดขาย | stock count/alerts filter wrap, price form ขึ้นแถวเหมาะสม, sales history สรุปไม่บีบตัวเลข | 320/390/1440 light/dark |
| การเงินและหน้าอื่น | action group หุ้น/ทุน, Monthly Close, contract tabs/stepper, profile email, system diagram/table, LINE OA/e-tax URL และ learning summary ไม่ดัน viewport | ภาพรายหน้าและสภาพข้อมูลสังเคราะห์ |
| สรุปรายจ่ายรายวัน | จำกัดความกว้าง controls, placeholder สาขาชัดเจนและเลือกได้แม้มีสาขาเดียว; failed load มี retry; ห้ามพิมพ์/Excel ขณะ query error | 320px single-branch → API500 → retry → APIจริงสำเร็จ + document/PDF regression |
| ตั้งค่าระบบ | ข้อความ code/path ยาวใน Off-site Backup และ PDPA ตัดบรรทัดในพื้นที่; progress wrap | ตรวจซ้ำ /settings/system และ 3 sections ที่ 320/390/1440 สว่าง/มืด |
| Backend หน้าแชตบอต | แก้ SQL join เก่าจาก sessions เป็น rooms 3 จุด; เพิ่ม forward migration ซ่อม room_id ที่ตกหล่นโดย rename ไม่ลบข้อมูล | API สถิติ/ช่วงวัน/suggestions ผ่าน; seeded FINANCE ไม่รวม SHOP; migration เก็บ row เดิม/index และรันซ้ำได้ |

Migration ใหม่: `apps/api/prisma/migrations/20261026000000_repair_chat_suggestion_room_column/migration.sql` ทดสอบเฉพาะฐานข้อมูลทิ้งได้ ยังไม่ได้ใช้กับ production และไม่แก้ migration เก่าที่เคยใช้แล้ว

## ขอบเขตตรวจรายหน้า

- Inventory **269 รายการ** (ต่อจาก 266 เดิมและเพิ่ม 3 เส้นทางตรวจสอบเอกสาร) รวมหน้า, redirects และส่วนตั้งค่า จึงไม่ใช่ 269 หน้า unique
- 3 ความกว้าง **320 / 390 / 1440 CSS px** × 2 themes = **807 route/viewport states, 1,614 ภาพ**
- ผลรวมหลัง rerun จุดที่แก้: **807/807 ไม่ล้น viewport และไม่เกิด root page crash** เป็นผลรวมจาก full sweep และ targeted reruns ไม่ใช่คำกล่าวว่า full run แรกผ่านทั้งหมด
- หน้า dynamic ที่มี fixture: contract/customer/product/user; บางเอกสารใช้ missing-record recovery อย่างจงใจ ส่วนเส้นทางมีข้อมูล/ธุรกรรมจริงของเอกสารตรวจใน domain suites แยก
- Public token ใช้ invalid/expired; LINE route inventory ใช้ cancelled login; ไม่อ้างว่าได้ล็อกอิน LINE จริง
- ตรวจ root error, ข้อความ/heading, loading, API failures, alias destination, inline settings panel และ body scrollWidth; ภาพเป็น viewport snapshot ไม่ใช่ทุก interaction/ทุก role ของทุกหน้า
- ตารางรายละเอียด: `PAGE-IMPLEMENTATION-MATRIX.csv` (คอลัมน์ status/desktop_evidence เก็บ baseline; ดู implementation_status/post_fix_verification สำหรับหลังแก้); raw result พร้อมสถานะ/URL/API errors/run ต้นทาง: `PAGE-VERIFICATION-RESULTS.json`
- หลงเหลือ 500 จาก `/yeastar/extensions` ใน fixture ที่ไม่ได้ตั้ง PBX เท่านั้น หน้า profile แสดงสถานะตามการตั้งค่า; ไม่เรียกบริการโทรศัพท์จริง

## ผลทดสอบพฤติกรรมและเอกสาร

- Document integration **145 tests / 20 suites** ผ่านเมื่อรวม 18 suites รอบใหญ่กับ explicit rerun ของ payroll/assets 2 suites ไม่กลบประวัติ fail: payroll เป็น locator ปุ่มปิดซ้ำหลังมี accessible label; assets เป็น timeout iframe PDF และผ่านเมื่อตรวจซ้ำ มี JSON ระบุ run ของแต่ละ suite
- ครอบคลุมเอกสาร 12 กลุ่ม; รอบใหญ่ตรวจ PDF **74/74 artifacts** ผ่าน ใช้ real Nest AppModule/Prisma/migrations/JWT/role/company/branch guards และ disposable SHOP+FINANCE PostgreSQL
- Outbound LINE/SMS/email ถูก capture, scheduler ปิด และข้อมูลทั้งหมดสังเคราะห์
- สิทธิ์ลิงก์ใบสำคัญ: **8 configurations** = 6 roles + FINANCE-only accountant + branchless manager ผ่านทั้ง HTTP และ UI
- Mobile interaction: editor Add-last-option/preview และ GFIN keyboard ใน 2 themes; daily summary single-branch/error/retry ผ่าน
- Chatbot API/migration 3 cases ผ่านจากฐานข้อมูล migrate จริง
- LIFF UI **84 cases** ผ่านใน Chromium Pixel 7 และ WebKit iPhone 13 ทั้งสว่าง/มืด เป็น browser emulation พร้อม SDK/API fixtures ไม่ใช่โทรศัพท์จริง
- UX suite **88/88 PASS** และ typography/paper suite **PASS** หลัง build จาก preview ใหม่; ตัวอักษร ขนาดและสี paper ใน screen/print ผ่านตาม assertions
- `npm run local:check` รอบ authoritative: **PASS 39 stages**, จบ 2026-10-13T20:01:53.614Z; Web 3,323 + Shared 149 + Storefront 46 = **3,518 tests**; lint 0 errors (API 3,014 / Web 473 warnings); ดู `FINAL-CHECKS.json`

## 18 findings เดิมที่แก้แล้ว

| Finding | ผลแก้ | วิธีตรวจเดิม (มีการตรวจเพิ่มด้านบน) |
|---|---|---|
| F01 | สีและฟอนต์ admin คงอยู่เมื่อเปิด paper/editor/iframe; คืน palette เฉพาะเอกสารโดยไม่ทับสีที่เอกสารกำหนดเอง | Browser ตรวจ shell ก่อน/หลัง mount 5 รูปแบบ ทั้ง light/dark; เทียบ receipt/template/sticker ทั้ง screen/print; เปิดแท็บเอกสารสัญญาใน Chrome |
| F02 | ใช้วันที่ธุรกิจ Asia/Bangkok ในรายงานและฟอร์ม; preset อัปเดตวันเริ่ม–วันจบครั้งเดียว; clamp ปลายเดือน; คำนวณวันที่ฟอร์มเมื่อเปิดใช้ | Regression ของช่วงเที่ยงคืนไทย ข้ามเดือน/ปี leap day และ query ของ Cash Flow/เงินรับไฟแนนซ์ |
| F03 | เส้นกราฟและ legend อ่าน config ชุดเดียว; แยกแกนจำนวนสัญญากับบาท; เพิ่มตารางตัวเลขและหน่วย | Fixture มี 2/7 สัญญา กับ 125,000/32,500 บาท; ตรวจสีเส้นตรง legend และตารางอ่านค่าจริงได้ |
| F04 | การ์ด 4 ใบเป็น 2×2 จนพื้นที่พอ; 5 ใบให้ใบสุดท้ายเต็มแถวบนจอแคบ และ 5 คอลัมน์บนจอกว้าง | พอร์ตมีข้อมูลจริงใน local fixture; ตรวจ 8 ความกว้าง light/dark; จำนวนเงินไม่ถูก ellipsis |
| F05 | FINANCE เหลือ 4 งานหลัก + เพิ่มเติม; จดหมายอยู่ใน sidebar; เมนูล่างสูง 64px พร้อม safe-area | ตรวจจำนวนแท็บและป้ายในทุกขนาดมือถือ; ปรับระยะ Inbox/สินทรัพย์/หลังการขายที่อ้างความสูงเดิม |
| F06 | กลุ่มชื่อ integration หดและ wrap ได้; badge มีพื้นที่; ชื่อยาวไม่ผลัก badge ออกนอกการ์ด | Fixture 3 integrations ทั้งไทย/อังกฤษและ 2 สถานะ × 8 ขนาด × 2 ธีม |
| F07 | ช่องสาขามีความกว้างอ่านได้และสูง 44px; แสดงข้อความเมื่อไม่มีสาขา | ตรวจตัวเลือกสาขาใน local appointments × 8 ขนาด × 2 ธีม; กรณีไม่มีสาขาแก้ที่ component |
| F08 | DateRangeField รวมวันเริ่ม/สิ้นสุดพร้อม label; มือถือเต็มแถวและตรงแนวเดียวกัน | ใช้ LetterFiltersBar ตัวจริงใน fixture; ตรวจ field อยู่ใน viewport และ input 16px |
| F09 | PageShell กำหนด inset มือถือ/desktop; ฟอร์มจำกัดความกว้าง; PageHeader wrap; breadcrumb ใช้ชื่อไทย; แก้ subtitle สีจางและหัวข้อรายจ่ายที่ถูกตัด | Shared layout ครอบ admin routes; title/breadcrumb unit tests; responsive representative screens ไม่เท่ากับตรวจทุก state ของทุก route |
| F10 | รวมความหมายและสี bucket ค้างชำระของ Aging widget/report; ใช้ semantic warning/orange/destructive พร้อมข้อความ | ตรวจว่าอ่าน ledger aging ที่นับรายการเกินกำหนดเหมือนกัน; Aging Report tests ผ่านตามชุดตรวจ |
| F11 | เปลี่ยนคำ “ผ่อนสบาย” จาก gradient ต่างระบบสีเป็น foreground สีทึบของ hero | ตรวจหน้า Landing ที่โหลดเสร็จใน Chrome; เปลี่ยนเฉพาะข้อความ marketing ไม่ดึง admin theme ไปครอบ public |
| F12 | เปลี่ยน POST/validation code ในฟอร์มและ action bar เป็นคำบอกผลลัพธ์ภาษาไทย; error summary พาไป field | Unit tests ของ action bar; types/build; ไม่เปลี่ยน enum, calculation หรือสิทธิ์ลงบัญชี |
| F13 | QueryBoundary แยก loading/403/error/retry; ไม่แสดงยอดศูนย์แทน failed receivable read; ปรับ empty/error ของ chatbot | Regression 403/500/loading และ list read failure; เพิ่ม full API บนฐานข้อมูลแยกตามผลด้านล่าง |
| F14 | ปุ่มร่วมและ input มือถือเป้าหมาย 44px; focus ไม่หายเมื่อเปิดเอกสาร; Dialog มีระยะขอบและพื้นที่หัวข้อข้างปุ่มปิด | Browser วัด control, font input, modal containment และ title/close collision ที่ 320/1440; ไม่ใช่ใบรับรอง WCAG ทั้งระบบ |
| F15 | แยก `/verify/contracts/:id`, `/receipts/verify/:receiptNumber`; legacy UUID/hash คงเดิม; RT ที่อาจซ้ำกับเลขใบสำคัญให้เลือกประเภทก่อน; voucher ใหม่ใช้ `/expenses/verify/:id`; login คืนปลายทางเดิม | Browser ตรวจ contract/receipt API ไม่สลับกัน และ guest → login → receipt/voucher; helper/public-route tests; API permissions เดิม |
| F16 | Warning ใช้ AlertContent และ foreground ที่เหมาะกับพื้นโปร่งใน light/dark; แก้ Equity warning และ dossier badge | วัดตัวอักษร warning หลัง compositing ≈13.87:1 light / 12.98:1 dark; ตรวจข้อความ 320px |
| F17 | Customer edit ใช้ Radix Dialog กลาง; focus เข้า/กัก/คืน, Escape ปิด; label อ้างถึง input แต่ละคนไม่ซ้ำ | Unit keyboard/reference labels และ browser 320px บน customer fixture จริงของ preview |
| F18 | Action group ของผู้ติดต่อหดและขึ้นบรรทัดตามพื้นที่ | Browser ตรวจปุ่มโทร/คัดลอก/รวมผู้ติดต่ออยู่ใน viewport 320–1440 light/dark |


## ขอบเขตที่ยังยืนยันไม่ได้ในเครื่อง

- iOS/Android จริง: Safari/Chrome และ LINE WebView, safe-area, keyboard, rotation, text enlargement
- LINE จริง: login/account switch, camera/gallery permission, resume/back, expired links/OTP; ชุดอัตโนมัติจำลอง SDK/API
- ข้อมูลและบัญชี production ทุกชุด/ทุก role ทุกหน้า, บริการ PBX/payment จริง และเครื่องพิมพ์จริง
- ไม่อ้าง WCAG certification หรือรับประกันว่าจะไม่มีบั๊กในทุกสภาพแวดล้อม; จุดที่พบในงานนี้มีหลักฐานแก้และตรวจซ้ำตามรายการ

มี `REAL-DEVICE-CHECKLIST.md` สำหรับตรวจเพิ่มเติมเมื่อมีสภาพแวดล้อม ไม่ต้องส่งรหัสผ่านหรือข้อมูลลูกค้าจริงในแชต

Preview ที่ตรวจ: http://localhost:5206/finance-portfolio และ http://localhost:5206/inbox — managed preview ใช้ API/data/AI สังเคราะห์ในขอบเขตที่ repo รองรับ ส่วน full API หลายหน้าใช้ harness ฐานข้อมูลแยกซึ่งปิดหลังเก็บผลแล้ว ไม่ได้อ้างว่า preview นี้ให้บริการทุก endpoint

Verified source fingerprint: `429b3903b65991beba470a53aa140bef9084649f738567a05dd64d572e6345a6`


## PR CI follow-up — populated mobile states

PR #1699's `cefa16ec6` passed Lint & Test and the complete E2E run (814 passed, 10 skipped, no retried failures). The full documents job reached its 45-minute limit and exposed additional findings; this snapshot does not label that run a pass.

- Populated equity/shareholder and dividend tables now scroll within their cards. Dividend print retains its natural width and visible overflow.
- The dashboard collection pipeline now wraps its progress bar below the label/count on phones; watch/upsell tables scroll, and KPI cards use one column below 480px so populated values remain readable.
- The receipt cancellation check clears the intentionally created 503 toast before checking for a new error toast; download-count/cancellation assertions remain intact. The updated receipt + interaction run passed 13/13 tests and 4/4 PDF artifacts. Expanded long-name/high-value fixtures then passed 5/5 interaction tests.
- Route checks wait for real content and visible skeletons to finish, then capture before measuring so completed CSS transitions match the recorded image. Each viewport gets a fresh access token; failed layout evidence includes overflowing elements.
- CI now runs 23 domain suites and the route inventory in independent jobs at 1440/390/320px. Jest's discovered suite lists confirm all 24 original suites remain covered. Populated-layout fixtures are explicit and do not depend on records left by other suites.

The latest pre-merge local check passed all 39 stages; the fresh full route rerun was still in progress when this snapshot was committed. Results and scope are recorded in `FINAL-CHECKS.json`; the authoritative shipping status and CI outcomes remain on [PR #1699](https://github.com/iamnaii/BESTCHOICE/pull/1699).
