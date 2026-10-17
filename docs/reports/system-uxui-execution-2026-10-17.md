# ผลดำเนินงานตรวจ UX/UI ทั้งโปรแกรม — 17 ตุลาคม 2026

สถานะ: **แก้ข้อบกพร่องที่ยืนยันแล้วและตรวจซ้ำผ่าน — ยังไม่ใช่การรับรองทุกปุ่ม/ทุกสถานะของทั้งโปรแกรม**

ทำงานใน `BESTCHOICE-layout-audit`, branch `fix/appointment-field-consistency-20261016`
จาก base `c5d26edcf` และรักษางานที่มีอยู่ก่อนเริ่มรอบนี้ไว้ การตรวจใช้ UI UX Pro Max
ประกอบกับ tokens และข้อกำหนดของ BESTCHOICE: Noto Sans Thai Looped ใน UI,
control ปกติ 2.75rem, label ไม่ชน focus ring, ลูกศรมีพื้นที่และจัดกึ่งกลาง,
ข้อความไทยไม่ถูกตัด และเนื้อหาต้องเข้าถึงได้บนจอแคบ เอกสารคงฟอนต์เดิม

## รอบเก็บงานค้างล่าสุด

ดู [รายงานเก็บงานค้างและหลักฐานปัจจุบัน](uxui-closure-2026-10-17/README.md): เพิ่มการตรวจเป้ากด/คีย์บอร์ดใน Chromium และ WebKit, ทวน 390px ครบ 269 entries ทั้งสองธีม และแก้จุดตกหล่นจริงในปิดเงินสด ค่าใช้จ่าย ข้อมูลลูกค้า/สินค้า ตารางเลือกจดหมาย/เจ้าหนี้ และฟอร์มผลต่าง รวมถึงข้อผิดพลาด public contract verification, profile preferences และข้อมูลค้างในงานติดตามหนี้ การทดสอบเต็มและ local รอบสุดท้ายอยู่ในรายงานดังกล่าว ไม่ใช้ตัวเลขประวัติด้านล่างเป็นผลของ source ล่าสุด

## ประวัติรอบแก้ dropdown ทั้งระบบ ก่อนเก็บงานค้าง

งาน dropdown รอบล่าสุดปิดแล้ว: 209 ตำแหน่งใน 125 consumer files; สแกน 1,322 production source files ไม่พบ legacy native dropdown หรือ raw datalist ตกค้างนอก shared implementations. รายละเอียดและข้อจำกัดอยู่ใน [รายงาน dropdown](dropdown-migration-2026-10-17/README.md).

`local:check` ของ source ณ รอบประวัตินี้ผ่าน 39/39, unit tests 3,590 ผ่าน และ preview ตรงกับ fingerprint ที่ตรวจแล้ว. E2E รอบเต็มผ่าน 814 ข้าม 10 โดยไม่มี failed/flaky; การแก้ autocomplete และ request-size ของ Inbox มีการทวนเฉพาะส่วนและ final local check เพิ่มภายหลัง จึงไม่อ้างว่าทุกชุดรันจาก snapshot เดียวกัน. สถานะนี้เป็นประวัติก่อนเก็บงานค้าง; ผลปัจจุบันและสถานะ release ดูรายงานด้านบนกับ PR ของรอบนี้.

รายการ action/state, เป้ากดขนาดเล็ก, accessibility และ fixtures ด้านล่างเป็นผล baseline ก่อน migration ล่าสุด ต้องทวน/ผูกหลักฐานกับ source ปัจจุบันก่อนปิด audit ทั้งระบบ ตัวเลข observations ไม่ใช่จำนวนบั๊กที่ยืนยันว่าคงเหลือ.

## ทวนเพิ่มเติมหลังผู้ใช้แจ้งช่องสาขายังเพี้ยน

พบตกหล่นจริง: ช่องสาขา 2 จุดและพนักงาน 2 จุดยังใช้ select เดิม แม้ความสูง/ฟอนต์ผ่าน
การตรวจ baseline. เปลี่ยนเป็น NativeSelect และแก้ WebKit ชื่อยาว/root20 ที่ดันหน้าแนวนอน
พร้อมตรวจระยะลูกศรและ focus แบบเจาะจง [รายงานและภาพ](system-uxui-execution-2026-10-17/appointments/README.md).
รอบแก้ช่องสาขา `npm run local:check` ผ่าน 39 checks และ preview ตรงกับ source ล่าสุด
[ผลตรวจ](system-uxui-execution-2026-10-17/appointments/local-check.json).
ผล baseline ด้านล่างเป็นหลักฐานก่อนการแก้รอบนี้ ไม่ได้รันทุกหน้าใหม่

## ขอบเขตที่มีหลักฐานแล้ว

| ชุด | ผลและขอบเขต |
| --- | --- |
| บัญชีหน้า | 307 entries / 299 คู่ app/path ไม่ซ้ำ; รวม aliases, settings entrances, public และ LIFF |
| หลังบ้าน/ตั้งค่า | 269 entries × 8 widths = 2,152 route/viewport cases; 4,304 light/dark observations |
| เว็บลูกค้า | 38 routes × 8 widths × 2 themes = 608 observations; ใช้ fixture API |
| Forms | 25 surfaces × 4 widths = 100 cases / 200 theme observations |
| Dialogs และฟอร์มย่อย | 28 surfaces × 3 widths = 84 cases / 168 theme observations |
| PO filters | เลือก/ค้นหา/ล้าง/keyboard/ข้อความยาว 6 configs ทั้ง Chromium และ WebKit |
| PO รายการและรายละเอียด | 6 configs ต่อ engine (Chromium/WebKit): เลขยาวไม่ล้ำคอลัมน์, Tab/Alt+Tab, payment dialog → Escape คืน focus, ปิดรายละเอียดคืนปุ่ม PO และเปลี่ยน desktop→mobile ขณะเปิด |
| Shared controls | 7 configs ผ่านทั้ง Chromium/WebKit; calendar ในหน้าและซ้อนใน dialog/drawer; ทวน WebKit จอแคบ/แนวนอนเพิ่ม 4 configs ผ่าน |
| Reports | 8 แท็บ, 53 รายการรับชำระ, 2 สาขา, ยอดมีทศนิยม, pagination, CSV และสิทธิ์ export; ฐานทดสอบจริงแยกจากข้อมูลใช้งาน |
| Other income | 56 รายการ, เปลี่ยนหน้า/ขนาดหน้า/ไปหน้าที่เลือก, filter, เลื่อนตารางไปปุ่มลบ→ยกเลิก และ Enter เปิดเอกสาร |
| ตั้งค่าเพิ่มเติม | ผังบัญชี FINANCE/SHOP สร้าง–แก้ไข–ยกเลิก–ลบในฐานแยก; เมนูผู้ใช้/แสดงรหัสแบบไม่บันทึก; ช่องทางแชทแสดง–ซ่อน token จำลอง; ค่าเริ่มต้นช่องทางรับชำระ/ลบ→ยกเลิก; Chromium และ WebKit ผ่าน 4 configs ต่อ engine |
| ชุด E2E เดิม | 811 ผ่าน + 3 locator เก่าล้มเหลว; แก้ locator แล้ว rerun 46 ผ่าน ทำให้ 814 กรณีไม่ซ้ำผ่าน; ยัง skipped 10 |

Widths baseline: 320, 390, 768, 1024, 1280, 1440, 1512 และ 1920px.
รอบแรกมี HMR/font readiness/context closed ชั่วคราว 9 route/viewport cases;
เก็บผลเดิมและทวนชุดที่ได้รับผลแล้ว รายงานรวมใช้ `routes-final` ตามด้วย
`routes-patch`, `routes-extra`, `routes-reports-mobile` และ `routes-settings-verified`
โดยแทนเฉพาะคู่ page ID/width ที่ทวนจริง ชุดตั้งค่าล่าสุด 64 route/viewport cases ผ่าน
ผลรวมไม่มี document horizontal overflow หรือ UI font ผิดตามตัววัด baseline
**ไม่ได้แปลว่าตรวจความสวยของทุกภาพหรือกดครบทุกคำสั่งแล้ว**

## สิ่งที่แก้ในรอบนี้

| ID | ปัญหา | การแก้/หลักฐาน |
| --- | --- | --- |
| UX-001 | native arrow และแนวข้อความไม่สม่ำเสมอ | เพิ่ม NativeSelect รักษาพฤติกรรม native; control 44px, icon 16px, inset 12px ภายใน border; ใช้กับ product, supplier, stock alert, company และ Rich Menu ที่ทดสอบแล้ว |
| UX-002 | Select ข้อความยาวเบียดลูกศร/รายการแคบ | `min-w-0`, จัดข้อความซ้าย, จำกัด popover ตามพื้นที่, option ขึ้นบรรทัดได้; PO long-value และ keyboard cases ผ่าน |
| UX-003 | label/focus ring และ repeated fields | เพิ่ม label association/ระยะห่าง/ID, gutter ใน Modal; supplier payment rows เพิ่ม–ลบโดยค่าแถวที่เหลือไม่หาย |
| UX-004 | NameAutocomplete ไม่ครบทาง keyboard | ArrowUp/Down, Enter, Escape, ARIA และชื่ออิสระ; Escape ในรายการไม่ปิด modal แม่ |
| UX-005 | ปฏิทินปุ่มเล็ก/จอเตี้ย/โฟกัส WebKit | ปุ่ม 44px, จำกัดสูง/เลื่อนใน popup, keyboard/focus return; ทำให้ anchor scroll ก่อนเปิดและยกเลิก smooth scroll ระดับ html ที่รบกวน focus; ดูผลทวน engine ล่าสุด |
| UX-006 | บัญชีไม่มีชื่อแสดงว่าง | CashAccountSelect fallback เป็นรหัสบัญชี |
| UX-007 | ฟอร์มเฉพาะหน้าไม่เท่ากัน | Forgot password, After-sales IMEI, asset register, stock alerts, other-income daily, Rich Menu และ WHT annual ใช้ความสูง/label/การเรียงบนมือถือที่ตรวจแล้ว |
| UX-008 | WHT ปีเก่า/ชื่อปีถูกตัด/empty table | รายการปีคงที่ 2020–ปีปัจจุบัน, ช่องกว้างพอ, empty state ชัด, ตารางเลื่อนเฉพาะส่วน |
| UX-009 | pagination และ chip กดลำบากบนมือถือ | ปุ่ม/ช่องเลือก 44px, wrap, ลดเลขหน้าที่แสดงบนจอเล็กโดยยังมี previous/next/jump |
| UX-010 | ตารางรายได้อื่นบีบเลขเอกสารและชื่อ | จำกัด scroll ใน region ที่ focus ได้, กำหนดความกว้างอ่านได้, เลขเอกสารเป็น Link, ปุ่มลบ 44px และ confirmation เดิม |
| UX-011 | Reports อ่าน response/ส่ง period ไม่ตรง API | ปรับ 7 แท็บให้ใช้ DTO จริงและช่วงวันที่ถูกต้อง; จำนวน/ยอดรวม/เฉพาะหน้าแยกชัด; ไม่เปลี่ยนสูตรบัญชี |
| UX-012 | export CSV ได้ JSON และขอบเขตสาขาไม่ถูกบังคับ | สร้าง CSV UTF-8 BOM/escape/formula protection; BM export เฉพาะสาขาตนเอง, BM ไม่มีสาขาปฏิเสธ; ทวนกับ isolated API |
| UX-013 | Reports tabs กินพื้นที่มือถือมาก | จอเล็กเลือกประเภทด้วย NativeSelect; จอใหญ่คงแท็บ; ใช้รายการสิทธิ์เดียวกัน |
| UX-014 | วันที่นอกเดือนยังเลือกได้แต่สีจางเกิน | axe ยืนยัน contrast 2.38:1 ใน dark mode; เปลี่ยนเป็น muted token เต็มและเพิ่ม hover background, ไม่ลด opacity ของข้อความที่เลือกได้ |
| UX-015 | ผังบัญชีใช้ overlay เก่า/ช่องเบียดบนมือถือ/ปุ่มในแถวเล็ก | ใช้ Modal ที่มี focus containment/Escape, mobile หนึ่งคอลัมน์, label/native select มาตรฐาน และ table region ที่เลื่อนได้; สร้าง–แก้ไข–ยกเลิก–ลบข้อมูลจำลองผ่าน |
| UX-016 | เมนูผู้ใช้และปุ่มแสดงรหัสกดเล็ก | เป้ากดมือถือ 44px, reserve พื้นที่ปุ่มในช่องรหัส, ปุ่มส่วนหัว wrap, แท็บมีสถานะเลือก; ไม่เปลี่ยนรหัสของผู้ใช้ใด |
| UX-017 | ตารางช่องทางรับชำระซ่อนคอลัมน์ขวา | เพิ่ม scroll region ที่ focus ได้และความกว้างคอลัมน์อ่านได้; ปุ่มดาว/ลบ 44px, ชื่อปุ่มบอกการเปลี่ยนค่าเริ่มต้นถูกต้อง, สีดาวใช้ semantic token เต็ม |
| UX-018 | ฟิลด์ช่องทางแชทและปุ่มดู token/copy แน่น | ใช้ form styles ร่วมกัน, ปุ่ม 44px, padding ไม่ชนข้อความ, header wrap บนมือถือ; ทวนแสดง/ซ่อน token จำลองแบบไม่บันทึก |
| UX-019 | เลข PO ยาวล้ำคอลัมน์ผู้ขายแม้ document ไม่ล้น | เลข PO ขึ้นบรรทัดในคอลัมน์ 12rem และ table min-width 80rem; mobile card ย่อพื้นที่ข้อความได้และคงเลขเต็ม |
| UX-020 | รายละเอียด PO ไม่คืน focus/วันที่ในประวัติเบียดชื่อ | จัดการ Tab เมื่อเป็น dialog บนสุด; คืน focus ตาม logical opener หลัง table rerender และ desktop→mobile; หน้าต่างจ่ายคืน focus สู่ parent; header/footer/history จัดใหม่บนมือถือโดยไม่เปลี่ยนธุรกรรม |

การแก้ API ใน UX-012 เป็นการจำกัดข้อมูล export ตามสิทธิ์เดิมของรายงาน
ทดสอบ owner, ผู้จัดการสาขา A, ขอข้อมูลสาขา B และผู้จัดการไม่มีสาขา
ไม่มีการส่งข้อความถึงลูกค้าหรือบันทึกธุรกรรมในฐานใช้งานจริง

## หลักฐานที่เปิดตรวจต่อได้

- [บัญชีรายหน้า CSV](system-uxui-execution-2026-10-17/page-checklist.csv)
- [บัญชีรายหน้า JSON](system-uxui-execution-2026-10-17/page-checklist.json)
- [ผล route/viewport และลิงก์ภาพ](system-uxui-execution-2026-10-17/route-observations.json)
- [ผลเว็บลูกค้า](system-uxui-execution-2026-10-17/storefront-observations.json)
- [คำสั่งที่กดและตรวจผลจริง พร้อมข้อจำกัด](system-uxui-execution-2026-10-17/action-evidence.csv)
- [รายชื่อ E2E เดิมแยกทุกกรณี](system-uxui-execution-2026-10-17/existing-e2e-cases.csv)
- [10 กรณีที่ยังข้าม](system-uxui-execution-2026-10-17/remaining-skipped.json)
- [สาเหตุและสิ่งที่ต้องเพิ่มสำหรับกรณีที่ข้าม](system-uxui-execution-2026-10-17/open-test-gaps.md)
- [control ที่ค้นพบจากหน้าเริ่มต้น 390px](system-uxui-execution-2026-10-17/visible-control-inventory.csv)
- [event sites จาก source สำหรับสำรวจต่อ](system-uxui-execution-2026-10-17/source-action-candidates.csv)
- [การทวนคู่สี](system-uxui-execution-2026-10-17/contrast-color-analysis.json)
- [การทวนตำแหน่งและสิ่งที่บังข้อความ](system-uxui-execution-2026-10-17/contrast-geometry.json)
- [ตั้งค่า: ผล Chromium รวมรอบทวน](system-uxui-execution-2026-10-17/settings-actions-chromium.json)
- [ตั้งค่า: ผล WebKit รวมรอบทวน](system-uxui-execution-2026-10-17/settings-actions-webkit.json)
- [พฤติกรรมคีย์บอร์ด WebKit ที่ทวนกับหน้าเปล่า](system-uxui-execution-2026-10-17/browser-keyboard-notes.md)
- [PO ข้อความยาว/รายละเอียด/หน้าต่างซ้อน](system-uxui-execution-2026-10-17/po-long-number.json)
- [ชุดรันและ source fingerprint ของแต่ละชุด](system-uxui-execution-2026-10-17/evidence-runs.json)
- [รายการ hash ของ source ล่าสุด](system-uxui-execution-2026-10-17/source-fingerprint.json)

ภาพตัวอย่างที่ตรวจด้วยสายตา:

| ส่วน | ก่อน | หลัง |
| --- | --- | --- |
| Reports มือถือ 320px/root 20px | [แท็บหลายบรรทัด](system-uxui-execution-2026-10-17/screenshots/reports-mobile-before.png) | [ช่องเลือกรายงาน](system-uxui-execution-2026-10-17/screenshots/reports-mobile-after.png) |
| Calendar WebKit 320px | [ปุ่มด้านล่างอยู่นอกจอ](system-uxui-execution-2026-10-17/screenshots/calendar-webkit-before.png) | [popover อยู่ในจอ](system-uxui-execution-2026-10-17/screenshots/calendar-webkit-after.png) |
| ฟิลด์มือถือ | — | [PO filters](system-uxui-execution-2026-10-17/screenshots/po-filter-390.png), [เพิ่มสินค้า](system-uxui-execution-2026-10-17/screenshots/product-fields-390.png) |
| PO ข้อมูลยาว/หน้าต่างซ้อน | [เลขเอกสารล้ำคอลัมน์](system-uxui-execution-2026-10-17/screenshots/po-table-before.png) | [ตารางเดสก์ท็อป](system-uxui-execution-2026-10-17/screenshots/po-chromium-1440-16.png), [การ์ดมือถือ](system-uxui-execution-2026-10-17/screenshots/po-chromium-390-16.png), [ประวัติ 320px/root 20px](system-uxui-execution-2026-10-17/screenshots/po-detail-chromium-320-20.png) |
| ตั้งค่า | — | [ผังบัญชี](system-uxui-execution-2026-10-17/screenshots/chart-form-390.png), [ช่องทางแชท](system-uxui-execution-2026-10-17/screenshots/channel-fields-390.png), [ตารางรับชำระที่เลื่อนในพื้นที่ได้](system-uxui-execution-2026-10-17/screenshots/payment-methods-320-large-text.png) |

ภาพ Reports เป็น full-page capture แถบเมนูที่ fixed อยู่กลางภาพยาวคือตำแหน่ง
ขอบ viewport ตอนจับภาพ ไม่ได้แปลว่าเมนูวางอยู่กลางเนื้อหาเมื่อเลื่อนใช้งาน

ภาพเต็ม, traces, raw measurements และผลที่ล้มเหลวก่อนแก้อยู่ใน
`.tmp/system-uxui-execution-20261017/` ของ checkout นี้ เส้นทางใน CSV/JSON
อ้างจากราก repository; ตัวอย่างข้อมูลเป็นข้อมูลทดสอบที่สร้างในฐานแยก
ผลตรวจเกิดหลายชุดระหว่างแก้ source ไม่ใช่การรันทั้งหมดจาก hash เดียว
หลังแก้ส่วนที่มีผลต่อพฤติกรรมได้ทวนชุดนั้นโดยเฉพาะ; ใช้ fingerprint ต่อชุดเพื่อเทียบ
อย่านำจำนวน baseline/E2E เดิมไปอ้างว่าครอบคลุมทุกคำสั่งของ source ล่าสุด

## สำรวจ dropdown ที่ยังตกหล่นเพิ่มเติม

หลังผู้ใช้ขอค้นหาทั้งระบบ พบ raw native select แบบเดิม 206 ตำแหน่งใน122ไฟล์
(หลังบ้าน197/เว็บลูกค้า9) และ custom select ที่ซ่อนลูกศรโดยไม่มีลูกศรทดแทนอีก1จุด.
ตัวเลขเป็น source sites รวมโค้ดที่ยังไม่ยืนยันทางเข้า ไม่ใช่จำนวน bugs หรือหน้าที่กดครบ.
[บัญชีทุกตำแหน่งและผลเปิดตัวอย่าง](dropdown-inventory-2026-10-17/README.md).
สถานะรอบสำรวจเดิม: ยังไม่ได้ migrate; **อัปเดตล่าสุด: migrate ครบแล้ว** รวมรายการแนะนำอีก 2 จุด เป็น 209 ตำแหน่ง ดูรายงาน dropdown ด้านบน

## งานที่ยังต้องปิดก่อนกล่าวว่า “ครบทั้งโปรแกรม”

1. **บัญชีทุก action/state ยังไม่ครบ** — พบ 4,331 event sites ใน 667 source files
   และ 2,557 control observations บนหน้าเริ่มต้น 390px ตัวเลขเหล่านี้มีคำสั่งซ้ำ
   และสถานะที่ยังไม่เปิด จึงใช้เป็นรายการสำรวจ ไม่ใช้เป็นจำนวนปุ่มที่ทดสอบผ่าน
   ต้องผูกผล E2E/การคลิกกับ action และเพิ่ม nested menus/wizard states ต่อหน้า
2. **เป้ากดขนาดเล็กต้องทวนเป็นรายกรณี** — ผล baseline เดิมพบ 551 observations ต่ำกว่า 44px
   บนหน้าเริ่มต้น 390px รวม links/tabs/controls ซ้ำและข้อยกเว้นตามหน้าที่
   ลดจาก 1,105 หลังแก้กลุ่มตั้งค่า (มีแถวและทางเข้าซ้ำ จึงไม่เรียกว่าแก้ 554 bugs)
   ยังไม่ยืนยันว่าเป็น 551 bugs และไม่แก้ด้วย global CSS ครอบทุกปุ่ม
3. **ผล accessibility มีขอบเขต** — ทวน 126 incomplete node-observations ใหม่
   คำนวณคู่สีผ่าน 4.5:1 ทุกจุด (ต่ำสุด 4.969), เลื่อนมาวัดขอบ/พื้นที่ clipping
   และ hit-test 5 จุด ทุก node เห็นเต็มและไม่ถูกบัง; axe เองผ่าน 18 และยังคืน
   incomplete 108 จึงเก็บผลทวนประกอบไว้ ไม่อ้างเป็นการรับรอง accessibility ทั้งระบบ
4. **Fixtures และ API states** — 12 inventory entries พบ error responses บาง
   viewport ได้แก่ verify token/hash, receipt/voucher ที่ไม่มีรายการ, visit token,
   inbox company permission, legacy insurance fixture, LINE Rich Menu และ Yeastar.
   ต้องแยก invalid-token ที่ตั้งใจทดสอบจาก successful populated flow ที่ยังไม่มีหลักฐาน
5. **สิทธิ์และ integrations** — baseline ส่วนใหญ่ OWNER; ไม่มีหลักฐานครบทุก
   role/branch/company/action. Storefront ใช้ fixture API; provider/camera/mic/file/
   payment/LINE OAuth จริง และเครื่องจริงยังไม่ทดสอบ ผู้ใช้ยืนยันว่าไม่มี staging/
   iPhone/Android พร้อมในรอบนี้
6. **Zoom จริง** — เปิด macOS Chrome 200% และกด PO filter/เปิด–เลื่อน–ปิด wizard
   ใน managed preview แล้ว แยกจาก root font 20px. ภายหลัง CUA คืน
   `cgWindowNotFound` จึงยังยืนยันการคืนค่าซูมแท็บทดสอบไม่ได้

## ตรวจรอบสุดท้ายและ local preview

`npm run local:check` ของ baseline ก่อนแก้ช่องสาขา **PASS**: TypeScript/lint/build ผ่าน,
Web 3,379, shared 149 และ storefront 48 tests ผ่าน รวม browser smoke.
[ผลฉบับเต็ม](system-uxui-execution-2026-10-17/local-check.json) บันทึก fingerprint
ที่ตรงกับ preview `a3b9ee9c844a61db2cecbe3f156877e9b10b117ce24364062a3eea5ef9097a37`.
รอบก่อนพบ draft แชทหายหนึ่งครั้งระหว่างที่มีการแก้ source; การทวน
`check-local-chat-team` แยกผ่านทั้ง 1440/390px และรอบรวม source คงที่ผ่านแล้ว
ยังไม่อ้างว่า HMR เป็นสาเหตุที่พิสูจน์แน่ชัด เก็บผลที่ล้มเหลวแยกไว้
[ก่อนทวน](system-uxui-execution-2026-10-17/local-check-prior-failure.json).

Local preview จาก checkout นี้ที่ [localhost:5206](http://localhost:5206).
Managed preview มีข้อมูล/AI จำลองและครอบคลุมเฉพาะ flow ที่ระบุใน AGENTS.md;
ผลฐานทดสอบ API ของโมดูลอื่นอ้างจาก harness แยก

เปิด [preview ฐานทดสอบแยก](http://127.0.0.1:51763) สำหรับตรวจ Reports,
PO, ผังบัญชีและตั้งค่า ใช้บัญชีจำลอง `ux-review@example.invalid`; รหัสผ่านอยู่ใน
[ไฟล์ local review-access](../../.tmp/system-uxui-execution-20261017/full-preview/review-access.json)
ที่ไม่รวมเข้า repository. API ใช้โค้ดจริงและ PostgreSQL แยก แต่ข้อมูล/provider/
storage เป็นสภาพแวดล้อมทดสอบ เซิร์ฟเวอร์นี้ตั้งให้ทำงานได้สูงสุด 24 ชั่วโมง
ไม่มี merge/deploy ในรอบนี้
