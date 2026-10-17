# BESTCHOICE — ตรวจ UX/UI และฟอร์มทั้งระบบ 2026-10-16

ขยายจากรายงานฟอร์ม 25 กรณีเดิมเป็น inventory ของระบบหลังบ้าน, เว็บลูกค้า, LIFF และชุด browser/API regression ใช้ UI UX Pro Max ประกอบการตรวจ label, mobile-first layout และขนาดพื้นที่กด โดยคง Noto Sans Thai Looped ใน UI และฟอนต์เอกสารเดิม

## สภาพแวดล้อมและความหมายของผล

- Checkout: `BESTCHOICE-layout-audit`, branch `fix/appointment-field-consistency-20261016`, base `c5d26edcf` พร้อม working changes
- หลังบ้าน: AppModule จริง, JWT/guards จริง, PostgreSQL SHOP/FINANCE ที่สร้างใหม่และลบทิ้ง, ข้อมูลทดสอบสังเคราะห์
- เว็บลูกค้าและ LIFF: browser จริง แต่ API/LINE identity/payment handoff ใช้ fixture; ไม่ใช่การรับรองระบบภายนอกจริง
- Route inventory รวม redirects, aliases, settings tabs และหน้าสำหรับลิงก์หมดอายุ/ข้อมูลไม่พบ ไม่ตีความทุกแถวว่าเป็นหน้าธุรกรรมที่มีข้อมูลพร้อมทำงาน
- ไม่มีการแก้ production data, ส่งข้อความถึงลูกค้า หรือชำระเงินจริง
- ภาพ/trace/JSON เต็มเก็บใน `.tmp/system-audit/`; รายการ route แบบย่ออยู่คู่กับรายงานนี้

## สิ่งที่แก้

1. มาตรฐานช่องกรอกและตัวกรอง 44 px ที่ root 16 px, font 14 px desktop/16 px mobile, scale ตาม root font และมีข้อยกเว้นสำหรับ paper/editor/textarea/ยอดเงินใหญ่
2. ผูก label กับช่องกรอกด้วย ID ที่ไม่ซ้ำ รวมถึง dynamic rows; เพิ่มชื่อช่องค้นหา/ตัวกรอง/ปุ่มที่ซ่อนข้อความในมือถือ
3. ฟอร์มผู้จัดจำหน่าย, ลูกค้าในสัญญา, เชิญผู้ใช้ และซื้อสินค้า ใช้ dialog/drawer ที่จัดการ focus และ Escape; mobile grids ไม่บีบหลายช่องลงในแถวเดียว
4. เงินเดือน, ทุน, ชำระเจ้าหนี้, ค่าเสื่อม, ตารางเลขเอกสาร และทะเบียนสินทรัพย์: แก้ช่องตัวเลขแคบและตารางดันหน้า โดยเลื่อนเฉพาะตารางเมื่อจำเป็น
5. รายได้อื่น: จัดหัวเอกสารและตัวอย่างรายการบัญชีใหม่บนมือถือ ลดข้อความเชิงเทคนิค และเพิ่ม contrast ข้อความในสรุปยอด
6. Customer portal: อ่าน flat API payload จริง แทนการคาดว่าอยู่ใน `contract`; ตัดข้อมูลที่ API ไม่ให้ และไม่อนุมานยอดคงเหลือจากยอดชำระที่อาจรวมค่าปรับ
7. จำหน่ายสินทรัพย์: ล้างช่องราคาขายแล้วไม่เกิด Decimal exception; ค่าว่าง/ไม่ถูกต้องยังผ่านการยืนยันไม่ได้
8. เว็บลูกค้า OrderDetail: แสดง error/retry เมื่อโหลดครั้งแรกไม่สำเร็จ และเก็บรายละเอียดเดิมพร้อมสถานะเตือนเมื่อ background refresh ไม่สำเร็จ
9. ข้อความช่วยกรอกนิติบุคคลและสรุปรายได้อื่น: เอาความโปร่งใสที่ทำให้ contrast ต่ำออก

## ผลตรวจ

ยืนยันกับ source fingerprint `b2ff0f68f09a22264343d07be8f99e786cb5aa1191cf6ee80a38595f3b4ddcce` รอบ local check เสร็จ 16 ตุลาคม 2026 เวลา 19:51 น. (Asia/Bangkok) และตรวจว่า preview ยังทำงานด้วย source ชุดเดียวกัน

| ชุดตรวจ | ขอบเขต | ผลและหลักฐาน |
| --- | --- | --- |
| หลังบ้าน: route/state inventory | 269 รายการ × 1440/390/320 px × light/dark = 1,614 observations | หลังรวมผลทวน ผ่านครบ: ไม่มีหน้าเปล่า/error boundary, page overflow, ฟอนต์ UI ผิด หรือช่องกรอกที่ตรวจพบแต่ไม่มีชื่อ; [JSON](system-uxui-2026-10-16-routes.json), [CSV](system-uxui-2026-10-16-routes.csv) |
| ฟอร์มชุดเดิม | 25 กรณี × 1440/768/390/320 px × 2 themes = 200 observations | ผ่าน; `.tmp/system-audit/fields-verified/fields/results.json` |
| ฟอร์ม/dialog เพิ่มเติม | 28 กรณี × 1440/390/320 px × 2 themes = 168 observations | ผ่าน; ไม่พบ ID ซ้ำ/ช่องไม่มีชื่อ/page overflow; dialog ที่ทดสอบกัก focus และปิดด้วย Escape ได้; `dialogs-final2/dialogs/results.json` |
| ขยายตัวอักษร | 28 กรณี, root font 20 px, desktop/mobile × 2 themes = 112 observations | ผ่าน; `forms-large-font/dialogs/results.json` |
| Accessible names และ contrast | 8 ฟอร์มตัวแทน × 2 themes = 16 scans | axe ไม่รายงาน violations ในกฎ label, select-name, button-name, aria-input-field-name, color-contrast; มี contrast ที่เครื่องมือสรุปไม่ได้ 42 node-observations จึงไม่ถือว่าผ่านอัตโนมัติ; `forms-accessibility-verified/dialogs/results.json` |
| Native control theme | light/dark ผ่าน next-themes จริง | root และ input ใช้ color-scheme ตรงกัน; `.tmp/system-audit/native-theme.json` |
| เว็บลูกค้า | 38 routes × 320/390/1440 px × 2 themes; ชุด typography/interaction เพิ่มที่ 375/768/1024 px | 12 browser tests ผ่าน; `.tmp/system-audit/storefront/`, `/tmp/system-audit-shop.log` |
| LIFF | Chromium Pixel 7 และ WebKit iPhone 13 simulation × light/dark | 84/84 ผ่าน; `.tmp/uxui-remediation/liff-browser-results.json`; LINE/payment ใช้ fixture |
| Legacy browser regression | 824 กรณี รวม role/permission และงานหลายหมวด | รอบหลัก 812 ผ่าน, 2 ไม่ผ่านจาก selector เก่า, 10 ข้าม; แก้ selector แล้วทวน 2/2 ผ่าน รวม 814 กรณีผ่านข้ามรอบ; `e2e-run2/playwright-results.json`, `/tmp/system-audit-sales-retry.log`, [รายการที่ข้าม](system-uxui-2026-10-16-skipped.json) |
| ธุรกรรม/เอกสาร | 154 tests, 18 domains, 12/12 กลุ่มเอกสาร | รอบหลัก 153 ผ่านและ 1 browser test ถูก HMR ขัดจังหวะ; ทวน payroll/voucher 28/28 ผ่าน รวมกรณีที่ล้มเดิม; scenario audit ประวัติจริงยัง BLOCKED 1 รายการตามข้อจำกัดข้อมูล |
| PDF | รอบหลัก 75 ไฟล์/266 หน้า; ทวน payroll/voucher 15 ไฟล์/28 หน้า | ทุก artifact check ผ่าน; `domains/artifact-checks.json`, `payroll-voucher-verified/artifact-checks.json`; ชุดทวนมีเอกสารซ้ำกับรอบหลัก ไม่รวมเป็น 90 เอกสารไม่ซ้ำ |
| Unit/build/types/lint | Web 3,359 + shared 149 + storefront 48 tests | รวม 3,556 ผ่าน; build/type/lint ไม่มี errors แต่ยังมี lint/build warnings เดิม |
| Local handoff | `npm run local:check` | 39/39 checks ผ่าน; `.tmp/local-preview/check.json`, preview [localhost:5206/inbox](http://localhost:5206/inbox) ยังทำงาน |

เส้นทางหลักฐานที่ไม่ได้ขึ้นต้นด้วย `.tmp/` หรือ `/tmp/` ในตารางอยู่ภายใต้ `.tmp/system-audit/` ชุดผลแต่ละรอบเก็บแยกกัน ไม่เขียนทับความล้มเหลวเดิมเพื่อให้ตรวจย้อนกลับได้

### การทวนกรณีที่เคยไม่ผ่าน

- Inventory รอบ `routes-verified` จบด้วย 2/3 width tests ผ่าน: แถว 137 (`/shop/accounting`) และ 181 (`/chat-analytics`) ที่ 1440 px ถูกกระทบระหว่าง source reload จึงทวนทั้งสองหน้าที่ทั้งสามขนาดบน source ที่หยุดแก้แล้วใน `routes-recheck` และผ่าน 3/3 tests
- รอบ `routes-targeted` ผ่านอีก 3/3 tests ครอบคลุมแถว 47, 67, 129, 169, 175, 233 ที่ทั้งสามขนาด รวมตัวอย่างค่าเสื่อมที่มีข้อมูลและช่องเลขเอกสาร แถว 47 แก้ fixture จาก inspection ID เป็น product ID ตาม route จริงแล้วอ่านข้อมูลได้
- รายการ route สุดท้ายรวม 807 records จาก `routes-verified`, `routes-targeted`, `routes-recheck` ตามลำดับ พร้อมระบุชื่อรอบและ path ภาพต่อรายการ ไม่ตีความว่า full run เดียวผ่านทั้งหมด
- Legacy credit queue 2 กรณีเดิมหา combobox ที่ไม่มีชื่อ เมื่อช่องมี accessible name แล้วจึงเปลี่ยน selector เป็น `สถานะตรวจเครดิต` และทวนผ่านทั้ง desktop/mobile
- Domain suite ทวน payroll browser ที่ element หลุดระหว่าง HMR และ voucher ที่ได้รับการปรับ wrapper; `payroll-voucher-verified` ผ่าน 28/28 tests และ 15/15 PDF checks
- Code reviewer ตรวจ shared control sizing, portal balance, order retry/refetch, modal focus และการแก้ contrast รอบสุดท้ายแล้ว ไม่เหลือ Critical/Warning ในขอบเขต diff ที่ตรวจ

## ปัญหาที่ไม่ใช่ layout และขอบเขตที่ยังยืนยันไม่ได้

- Production branch configuration: การตรวจ read-only ก่อนหน้าเจอสาขาที่ยังไม่ได้ผูก SHOP company ทำให้หน้านัดเข้าร้านไม่มีสาขาให้ใช้ รอบนี้แก้สถานะ UI ให้บอกความจริง แต่ไม่ได้เติมข้อมูลบริษัทให้ production
- ไม่มี staging/อุปกรณ์ iPhone หรือ Android จริง จึงยังไม่ยืนยันคีย์บอร์ดจริง, LINE in-app browser/OAuth, การส่ง LINE/SMS/email, payment gateway จริง, PBX/Yeastar, GCS/MinIO production หรือเครื่องพิมพ์
- API ใน harness สำหรับ Rich Menu และ PBX ไม่มี provider configuration; ไม่ถือว่าการเปิดหน้า settings เป็นการทดสอบการเชื่อมต่อสำเร็จ
- Legacy browser suite มี 10 กรณีข้ามด้วยเงื่อนไข fixture/skip เดิม แยกจากกรณีที่ผ่าน ส่วนหลักฐาน transaction/PDF มาจาก dedicated isolated suites
- Historical sales audit ตรวจ SQL กับ fixture ได้ แต่ไม่มีข้อมูลและเอกสารต้นทาง production/staging สำหรับรับรองประวัติจริง จึงมี scenario BLOCKED ตามข้อจำกัดนี้
- Automated axe ตรวจกลุ่มฟอร์มตัวแทนและกฎที่ระบุ ไม่ใช่ WCAG audit ครบทุกเกณฑ์ทุกหน้าจอ; 42 incomplete contrast node-observations มาจาก purchase wizard 20 nodes/theme และ asset create 1 node/theme
- Route inventory ตรวจ dark palette ด้วย class; native browser control color-scheme ยืนยันแยกผ่าน next-themes จริง การเปิดหน้า recovery/empty state สำเร็จไม่ใช่หลักฐานว่า provider integration หรือธุรกรรมของหน้านั้นผ่าน
- งานนี้ยังไม่ commit/push/merge/deploy รอบใหม่

## การรันซ้ำ

ดู [คู่มือฟอร์ม](../guides/form-field-qa.md) และข้อกำหนด local preview ใน `AGENTS.md` หลังแก้ source ต้องรัน `npm run local:check` ให้ fingerprint ตรงกับ source ล่าสุด

```sh
# Full route inventory; private DB and full local API
NODE_OPTIONS=--max-old-space-size=8192 UXUI_POPULATED=1 \
  bash tools/docs-integration.sh uxui-pages.browser.docs-spec.ts

# Secondary forms; FORM_CASES and FORM_WIDTHS can narrow a rerun
NODE_OPTIONS=--max-old-space-size=8192 \
  bash tools/docs-integration.sh --testRegex='e2e/ui-fields/dialogs.audit-spec.ts$'

# Enlarged text; add FORM_AXE=1 to run naming and contrast rules
NODE_OPTIONS=--max-old-space-size=8192 FORM_ROOT_FONT=20 FORM_WIDTHS=1440,390 \
  bash tools/docs-integration.sh --testRegex='e2e/ui-fields/dialogs.audit-spec.ts$'

# The legacy dev seed is permitted only inside this disposable wrapper
NODE_OPTIONS=--max-old-space-size=8192 \
  bash tools/docs-integration.sh --testRegex='e2e/ui-fields/system-e2e.audit-spec.ts$'
```

ใช้ `DOCS_QA_OUTPUT` คนละโฟลเดอร์ต่อรอบเพื่อเก็บหลักฐาน ไม่รัน legacy browser suite พร้อมกันหลายชุดเพราะใช้ไฟล์ auth ชั่วคราวร่วมกัน หยุดแก้ source ระหว่าง browser verification เพื่อไม่ให้ Vite reload กลางขั้นตอน เก็บผล fail เดิมและผลทวนแยกกัน
