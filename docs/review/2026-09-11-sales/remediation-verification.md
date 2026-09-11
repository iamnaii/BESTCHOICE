# Sales remediation — execution evidence

เริ่มดำเนินการหลังเจ้าของยืนยัน `ok` ตาม [แผนหลัก](../../superpowers/plans/2026-09-11-sales-remediation.md) จาก revision `dce7ae7054624a7b791fa39cb48995c901232bab` วันที่ 11 กันยายน 2569

## ชุด A: Core correctness

| งาน | ผลที่เปลี่ยน | หลักฐาน |
|---|---|---|
| A1 | คืน dependencies ตาม lockfile เดิม; storefront พบ gsap แล้ว | `npm ci --ignore-scripts --no-audit --no-fund`; ไม่มี diff manifest/lock; baseline source checks ทั้ง 11 ขั้นผ่าน |
| A2 / F01, S02 | ใบขาย list/detail/daily/top/salespersons ใช้ actor scope; branchless คืนว่าง; non-OWNER ไม่มีต้นทุน; SALES mask เลขบัตร; detail ไม่ปล่อย contract snapshot | HTTP ผ่าน Nest Roles/Branch guards และ EntityScopeInterceptor จริงบน PostgreSQL แยก; ก่อนแก้ 10 กรณีล้มเหลวตามช่องโหว่ หลังแก้ผ่านทั้งหมด; policy/facade unit tests |
| A3 / F05 | CASH ตั้งราคาเงินสด; price chip ตรงทั้งประเภทและจำนวน; เปลี่ยนโหมดโดยตั้งใจจึงเลือกราคาใหม่; ไม่มีราคาสดขึ้นคำเตือนและไม่บันทึกศูนย์บาท | real POS handler/form/summary/POST ใน Vitest 7 กรณี (ชุดราคาเดิมก่อนแก้ 5 fail / 1 pass; เพิ่มเปลี่ยนเครื่อง/เก็บส่วนลด) |
| A4 / S05 | `amountReceived` เท่ากับดาวน์ที่รับตอนขาย; ยอดจัดไฟแนนซ์เก็บเป็นลูกหนี้; รับ explicit 0 และตรวจยอดรวมด้วย Decimal ที่ความละเอียดสตางค์ | writer unit tests 23 ผ่าน; PostgreSQL + journal/resolver/template จริง 5 กรณี: 0/2000 down, settlement ไม่ซ้ำ, void ก่อนรับไฟแนนซ์คืน stock/JE ทั้งสองแบบ |
| A5 / F13 | loading/error ไม่ให้ยืนยันอ่านหรือไปเซ็น; retry ได้; iframe ต้องโหลดก่อน; เปลี่ยนเอกสาร/สัญญาแล้วขอยืนยันใหม่; callback จากการเซ็นรอบเก่าไม่ข้ามขั้น | review component 7 + wizard 5 = 12 tests ผ่าน; เคส document invalidation หลังไปหน้าเซ็นตรวจจาก independent review แล้วเพิ่ม regression |

การทวนโค้ดโดย read-only reviewer: **0 Critical / 0 Warning** หลังแก้ปัญหาการคง consent และ callback ของเอกสารเก่า ไม่ได้เปลี่ยนกติกาผู้ลงนามหรืออ้างว่าการโหลด iframe พิสูจน์ว่าลูกค้าอ่านเอกสารครบทุกคำ

POS ยังคงราคาขายแบบอ่านอย่างเดียวและให้เลือกปุ่มราคาตามสิทธิ์เดิม ไม่มีการเพิ่มสิทธิ์กรอกราคาเองตามข้อความตัวอย่างในแผนเดิม

Commits ของชุด A: `29dfb5048` (API scope/finance), `b82ce500e` (POS), `cfe315ea7` (signing)

## คำสั่งและผลทดสอบ

| ตรวจ | ผล |
|---|---|
| `bash tools/test-chat-credit.sh` | **PASS — 8 suites, 91 tests** รวม read scope และ external finance ใหม่; disposable PostgreSQL พร้อม migrations จริง |
| Web targeted POS + review + wizard | **PASS — POS 7 + review/wizard 12 = 19 tests** |
| API targeted read policy + facade + writer | **PASS — 4 suites, 81 tests** (รวม imported-sales จาก test-name filter) |
| `LOCAL_PREVIEW_PORT=5207 npm run local:check` | **PASS — 21 checks** รวม API/Web types, lint (0 errors; warnings เดิมยังมี), Web 1,928 / shared 77 / storefront 31 tests, ทั้งสอง builds และ managed browser 1440/390; backend เริ่มใหม่จาก checkout นี้ |
| `node docs/review/2026-09-11-sales/core-browser-check.mjs` | **PASS — 8 states ที่ 1440/390**; ไม่มี page-level horizontal overflow หรือ uncaught browser error; ไม่มี signature/financial writes |

Log ของรอบนี้อยู่ใน `.tmp/sales-audit/`: `scope-red.log`, `pos-red.log`, `external-validation-red.log`, `signing-red.log`, `wizard-red.log`, `core-db-green.log`, `core-web-green.log`, `core-api-unit.log`, `core-local-check.log`, `core-local-check-final.log`, `core-browser.log` ส่วนผลมาตรฐานอยู่ `.tmp/local-preview/check.json`

ปัญหาเครื่องมือที่แก้ระหว่างตรวจ:

- หลังคืน node_modules, Vite เดิมมี cached optimize dependency จึงตอบ 504 เริ่มใหม่เฉพาะ managed preview ของ checkout นี้แล้ว browser baseline ผ่านทั้งสองขนาด ไม่แตะ session พอร์ต 5195
- read-scope fixture เคยใช้เลขใบขายสุ่มซึ่งไหลไปเข้าตัวสร้างเลขของ suite ถัดไป เพิ่ม cleanup เฉพาะ fixture ของ suite; ชุดฐานข้อมูลทั้งหมดผ่านแล้ว ไม่แก้ตัวสร้างเลข production เพื่อทำให้ test ผ่าน
- Browser พบป้ายราคาขายยังไม่มี htmlFor/input id; เชื่อมด้วย useId แล้วใช้ label จริงใน unit/browser test แทนการอ้าง input ตามลำดับ
- TypeScript พบ `exact` ซึ่งเป็นตัวเลือก Playwright แต่ไม่มีใน Testing Library; ลบออกจาก test แล้วตรวจซ้ำ

## ขอบเขตหลักฐาน

- ฐานข้อมูล/ลูกค้า/สินค้า/ผู้ใช้/บัญชี/JE เป็นข้อมูลจำลองบน PostgreSQL ที่ harness สร้างและทำลายเอง ไม่มีการอ่านหรือแก้ฐานจริง
- HTTP test เปลี่ยนเฉพาะ authenticated principal ของ JWT; guard และ response projection เป็นโค้ดจริง
- Financial test ใช้บริการขาย, receivable, void, journal และ account resolver จริง แทนเฉพาะการแจ้งเตือนประกันไปภายนอก
- Managed preview ครอบคลุม Inbox/ลูกค้า/เครดิต/portfolio/trade-in ตาม `AGENTS.md`; ไม่ได้อ้างว่าพรีวิวจำกัดนี้ทดสอบธุรกรรมขายทุกแบบ
- Browser core check ใช้หน้า React จริงพร้อม API read fixture และบังคับ preview 503 ไม่มีการส่งลายเซ็นหรือรับเงินจริง; [script](core-browser-check.mjs) เก็บภาพ/ผลใน `evidence/core/`

## รายการเก่าที่ควรตรวจหลังแก้โค้ด

ตรวจผู้ใช้ `amountReceived`: POS summary ใช้เฉพาะ CASH; Sale ที่ external finance ต้องอ่านยอดรับภายหลังจาก FinanceReceivable แยกจากยอดดาวน์ตอนสร้าง; writer ของสัญญา/booking/online-order มีความหมายตาม flow ของตนเองและไม่ได้ถูก backfill

ตัวอย่าง query **read-only สำหรับหาผู้สมัครตรวจสอบ** — ไม่ได้รันกับข้อมูลจริง และไม่ใช่คำสั่งแก้ยอดย้อนหลัง:

```sql
SELECT s.id, s.sale_number, s.created_at,
       s.down_payment_amount, s.amount_received, s.finance_amount,
       fr.id AS receivable_id, fr.status AS receivable_status,
       fr.expected_amount, fr.received_amount, fr.received_date
FROM sales s
LEFT JOIN finance_receivables fr ON fr.sale_id = s.id AND fr.deleted_at IS NULL
WHERE s.sale_type = 'EXTERNAL_FINANCE'
  AND s.down_payment_amount = 0
  AND s.amount_received > 0
  AND s.amount_received = s.finance_amount
ORDER BY s.created_at, s.id;
```

ต้องเทียบเอกสารรับเงินและ JE รายใบก่อนตัดสินใจแก้รายการเดิม ไม่อนุมานว่ารับเงินแล้ว/ยังไม่รับจากเงื่อนไขนี้เพียงอย่างเดียว

พรีวิวที่ตรวจแล้ว: http://localhost:5207/pos และ http://localhost:5207/inbox; server ยังทำงานจาก checkout นี้

## งานที่ยังไม่ปิดในแผน

ชุด B (ใบจอง/มัดจำ/stock race/expiry), C (quote-create/tender/legacy/signers) และ D (รายงาน/export/pagination/role CTA/handoff/cache/UX ครบ 6 เมนู) ยังไม่ได้แก้ใน checkpoint นี้ ข้อค้นพบเหล่านั้นยังเปิดอยู่ รวมกำไรที่ขึ้นกับหน้าปัจจุบันและช่วงวันไทย จึงยังไม่ถือว่าปิดการตรวจหมวดขายทั้งหมด

การนำมัดจำไปใช้กับสัญญาผ่อนหรือไฟแนนซ์ยังเป็นระยะขยายตามแผน ไม่เปิดความสามารถดังกล่าวผ่านการเปลี่ยน UI ในชุด A
