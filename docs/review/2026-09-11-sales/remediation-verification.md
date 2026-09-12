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

## ขอบเขตระยะขยาย

การนำมัดจำไปใช้กับสัญญาผ่อนหรือไฟแนนซ์ยังเป็นระยะขยายตามแผน ไม่เปิดความสามารถดังกล่าวผ่านการเปลี่ยน UI ในชุด A–D; ผลการดำเนินการ D และการตรวจรับสุดท้ายอยู่ท้ายรายงาน

## ชุด B: Booking integrity

| งาน | ผลที่เปลี่ยน | หลักฐาน |
|---|---|---|
| B1 / F02 | ทุก mutation อ่านแถวหลัง PostgreSQL row lock; PAID แก้ได้เฉพาะ notes/expiry ที่ยังไม่หมดอายุ; items/deposit ตรวจยอดร่วมกัน | ก่อนแก้ 5 fail; unit + DB update↔pay, cancel↔pay, remove↔pay, JE failure rollback, item replacement rollback |
| B2 / F03/F04, S06 | เลือกเครื่องจริงในสาขา; convert บังคับหนึ่งเครื่อง quantity1 และยอดรายการตรงเอกสาร; policy branch/stock/deleted/damaged ใช้ร่วมกับ writer; stock CAS และ Serializable ในทุก sale writer | policy12 tests; DB booking↔booking หนึ่งเครื่องสำเร็จเพียงหนึ่งใบ, retry ไม่ซ้ำ, invalid branch/damaged/legacy items ไม่สร้าง Sale/JE |
| B3 / F08 | method รับมัดจำ/ส่วนต่างรองรับ CASH/BANK_TRANSFER/QR; backend resolve และ persist SHOP account จริง; reject compatibility account ที่ไม่ตรง; full prepay ไม่สร้าง tender ใหม่ | DB ตรวจ net cash1000 + bank9000 และสลับวิธี, full prepay QR10000, liability0, revenue10000, receipt mismatch rollback; DTO7 tests |
| B4 / F15, S07 | ปฏิเสธเมื่อ cutoff <= now หลัง lock; pending expiry ไม่มี forfeit JE; cron เดินทุก batch และ retry เฉพาะแถวล้มเหลว; UI ยึดเวลาไทยและแสดง cutoff พร้อมเวลา | 8 tender/expiry cases ล้มเหลวก่อนแก้; DB exact cutoff/races, 501 pending + 1 posting failure, retry แล้วไม่ลงซ้ำ; date27 tests รวม impossible dates |

Browser [bookings-browser-check.mjs](bookings-browser-check.mjs) ผ่าน **20 states (1440/390)**: partial/full prepay, receipt method, converted, restricted PAID editor, linked product create, legacy blocked, expired, detail503/retry. ไม่มี page-level overflow/uncaught error; dialog อยู่ใน viewport และเลื่อนเนื้อหาได้ ภาพ/ผลอยู่ `evidence/bookings/` โดยตัวเลข/POST ใน browser ถูก intercept ทั้งหมด ไม่ได้เขียนธุรกรรมจริง ส่วนบัญชี/stock/rollback ทดสอบด้วย PostgreSQL จริงแยกต่างหาก

ฟอร์ม PAID ส่งเฉพาะ notes/expireDate; ล้าง notes ได้จริง; แก้ field อื่นไม่เปลี่ยน instant หมดอายุของใบเก่า การแสดง list/detail ระบุทั้งวันที่ เวลา และเวลาไทย เพื่อไม่ให้ cutoff00:00 ถูกอ่านเป็นสิ้นวันถัดไป ไม่มีการล็อกสต็อกตั้งแต่สร้างใบจอง และไม่มีการ backfill เงินเก่า

ผลชุด B ล่าสุดก่อน final checkpoint:

- `bookings-api-final.log`: **7 suites / 145 tests ผ่าน** (รวม DTO7 และ imported-sales จากชื่อ filter); เพิ่ม regression ยืนยัน installment Serializable และอ่าน stock ใหม่เมื่อ retry รวม policy ของแถมผิดสาขา/เสียหาย
- `bookings-web.log`: 3 suites / 42 tests ผ่าน (forms10, original helpers5, dates27)
- `bookings-full-db.log`: **9 suites / 112 tests ผ่าน**; booking21 tests ใช้ journal templates จริงและ disposable PostgreSQL
- `bookings-browser.log`: 20 states ผ่าน; สังเกต mobile table มี scroll ภายใน ซึ่งอยู่ในงานจัด layout D4 ต่อ
- `bookings-local-check.log`: **PASS — 21 checks** types/lint/builds, Web/shared/storefront tests และ managed preview เริ่มใหม่; เพิ่มเฉพาะ API regression3เคสหลังรอบนี้และ targeted tests145ผ่านแล้ว ต้องรัน local check ใหม่ตาม M1 เมื่อจบชุด C/D

ปัญหา test transport ที่พิสูจน์และแก้ในชุดนี้: บน Darwin/Node24 server ที่ bind IPv6 `::` อาจใช้เลขพอร์ตเดียวกับอีก server ที่ bind IPv4 ได้ ขณะที่ Supertest สร้าง URL `127.0.0.1` เสมอ ทำให้ request ไปผิดแอปและได้501/404แบบไม่แน่นอน reviewer สร้าง synthetic proof: exact same-port ได้501จากผิด server, auto-port ทำซ้ำได้รอบ290, explicit IPv4 ผ่าน500/500 แก้ HTTP fixtures5ไฟล์ให้ `app.listen(0, '127.0.0.1')` และคง `app.close()`; full harness ผ่านแล้ว ไม่แก้ permission/domain logic เพื่อกลบ test failure

### รายการใบจองเดิมสำหรับตรวจด้วยเอกสารจริง (ยังไม่ได้รัน)

```sql
SELECT b.id, b.booking_number, b.status, b.deposit_method, b.deposit_account_code,
       b.deposit_amount, b.total_amount, b.expire_date,
       count(i.id) AS item_count, bool_or(i.product_id IS NULL OR i.quantity <> 1) AS incompatible_item
FROM bookings b
LEFT JOIN booking_items i ON i.booking_id = b.id
WHERE b.deleted_at IS NULL
GROUP BY b.id
HAVING b.deposit_account_code LIKE '11-%'
    OR count(i.id) <> 1
    OR bool_or(i.product_id IS NULL OR i.quantity <> 1)
ORDER BY b.created_at, b.id;
```

ผล query เป็นเพียงผู้สมัครตรวจสอบ ไม่ใช่คำสั่งเปลี่ยนบัญชี/จัดสรรเงินใหม่ให้ใบเก่า

## ชุด C: Contract quote, receipt and signature consistency

- Server quote resolves actual branch VAT, deterministic category config and term-rate flag; normalized monetary values and full schedule form the fingerprint. Creation recomputes inside the transaction and returns409 before claims when conditions changed. The wizard displays only the server result, including last-installment rounding; pending/error/stale data cannot submit and409 requires an explicit review.
- New contracts persist actual down-payment tender/time/reference. Zero cash does not fabricate a receipt; legacy callers default to CASH with an audit event. Activation preserves tender and any existing Sale identity, requires receipt proof for catch-up posting, and draft deletion reverses the original JE account even after branch account settings change. No historical tender backfill.
- Formal and legacy installment paths share active-contract policy, monetary quote, customer snapshot and tender rules inside Serializable transactions. Retry classification also handles PostgreSQL40001/40P01 surfaced as Prisma P2010; exhausted conflicts return409. Notes-only draft edits do not rewrite money, receipt or payment identities.
- Shared signer requirements cover CUSTOMER, COMPANY/STAFF, both witnesses and guardian according to backend Bangkok-age policy. Deleted/duplicate signatures do not satisfy missing parties; incomplete/missing/revised requirements revoke wizard readiness and stale callbacks.
- Caller inventory: repository UI uses `/contracts` via the contract wizard; dormant POS INSTALLMENT payload code and API compatibility tests still reference `/sales` INSTALLMENT. Legacy callers retain Sale id/number/response; physical draft Sale timing remains compatible but default sales reports exclude draft-linked rows. A repository search cannot rule out external consumers.

Read-only reviewer: **PASS, no Critical/Warning** after correcting effective quote rates, stale signer callbacks, explicit payday fingerprint and transaction retries.

| Command/evidence (2026-09-11) | Result |
|---|---|
| API targeted quote/policy/signers/retry/lifecycle/workflow/facade/writer/validation (`contracts-api-final.log`) | **14 suites / 299 tests PASS** |
| Web targeted contract defaults, restore, quote flow, signing/draft (`contracts-web-final.log`) | **10 suites / 71 tests PASS** |
| `bash tools/test-chat-credit.sh` (`contracts-db-final.log`) | **9 suites / 116 tests PASS**, disposable PostgreSQL and additive migration |
| `LOCAL_PREVIEW_PORT=5207 npm run local:check` (`contracts-local-final.log`) | **21 checks PASS**, finished2026-09-11T05:20:57Z, baseHEAD a7974a1d6 + C working changes; source fingerprint71e779e2cfb1ebfae093d85c6cb61a6d617938153df86e41dfb576d0d54cabfd |
| `node docs/review/2026-09-11-sales/contracts-browser-check.mjs` | **10 states PASS** at1440/390: quote, transfer/schedule,409review,503quote failure, guardian required; no page overflow/uncaught errors, actual request fingerprint/tender checked |

C browser captures are in `evidence/contracts/`; visual inspection confirmed responsive form/summary and distinct receipt section. Browser API responses/writes are synthetic; actual money, stock, approval claim, rollback and reversal assertions are in PostgreSQL tests. AI, OTP, storage and outbound notifications remain stubs; no production data, messages or financial writes. A test-only `.at()` incompatible with the web TS target was replaced by slice; one overlapping Prisma regeneration temporarily removed generated client files, so API tests were rerun after generation and passed.

## ชุด D: รายงาน การส่งต่องาน และ UX/UI ครบหกเมนู

| งาน / Finding | ผลที่เปลี่ยน | หลักฐาน |
|---|---|---|
| D1 / F06,F17,F18 | กำไร OWNER รวมทั้งชุดตัวกรองและไม่เปลี่ยนตามหน้า; strict วันไทยใช้ขอบเขตต้นวันถึงก่อนต้นวันถัดไป; draft/void แยกความหมาย; คงเหลือทั้งหมดแยกจากเกินกำหนด; คะแนน null และยอดรับ null ไม่กลายเป็น0 | API unit + HTTP บน PostgreSQL, Decimal balance tests, browser null/zero |
| D2 / F07,F09 | export ลูกค้า/สัญญา/ใบขายเริ่มหน้า1ครั้งละ200ตามตัวกรองเดียวกับรายการ; ตรวจ total/ID ซ้ำและหยุดเมื่อเปลี่ยนบริษัท; ระบุเวลาดึง; คิวเครดิต/จองมี pagination; tier/credit-score ลูกค้าคัด/เรียงก่อนแบ่งหน้า; Kanban ระบุจำนวนในหน้านี้ | 201-row workbook assertions, API DTO bounds and stable ordering, derived customer query/tier tests |
| D3 / F10,F11,F14 | POS ส่ง customer/product IDs พร้อมแจ้งข้อมูลที่ต้องระบุใหม่; ปุ่มตรง roles ของ API; cache ที่สัมพันธ์กัน refresh หลังขาย/ยกเลิก/จอง/สร้างสัญญา; branchless Contracts fail closed | rendered POS handoff/restore, warm-cache tests, HTTP role matrix, actual company-switch download cancellation |
| D4 / F16,F17 | CustomerDetail ทุกแท็บอยู่ในกรอบมือถือ; ลูกค้า/เครดิตใช้ filter sheet; คืน focus และคงช่องค้นหาเมื่อ pending/error; ใบขายใช้ชื่อรายการขายและรายละเอียด deep link; ปุ่มเงินจอง/ดาวน์ระบุผลจริง; ACTIVE เปิดดาวน์โหลดเอกสารแทนชวนลงนาม | responsive browser1440/390, all7 customer tabs, errors/retry, guardian4/5, synthetic PDF download |

แนวทางรวมส่วนซ้ำ: ใช้ quote/tender/stock/signature policy กลาง และ helper สำหรับ export/invalidation/filter panel ร่วมกัน ยังคงทั้งหกเมนูตามงานของผู้ใช้ การรวมทุกงานเป็นหน้าขายเดียวหรือใช้มัดจำร่วมกับผ่อน/ไฟแนนซ์ยังเป็นระยะขยายที่ระบุไว้ในแผน ไม่ได้เปิดด้วย UI เพียงอย่างเดียว

ข้อจำกัดที่คงไว้โดยตั้งใจ:

- กำไรเป็นยอดสุทธิหักต้นทุนเครื่องปัจจุบัน ไม่ใช่ต้นทุน ณ วันขายหรือกำไรบัญชีหลังภาษี/ดอกเบี้ย/ค่าคอม
- Export หลายคำขอไม่ใช่ transaction snapshot; total/duplicate checks ตรวจการเปลี่ยนได้บางแบบเท่านั้น ไฟล์ระบุเวลาที่ดึงข้อมูล
- Tier export ใช้ batched queries แทน N+1 แต่แต่ละหน้าต้องคำนวณผู้สมัครทั้งชุดซ้ำ ข้อมูลหลักหมื่นขึ้นไปยังไม่ได้วัดเวลาจริง; งาน server export แบบ snapshot/performance เป็นระยะถัดไป
- ข้อมูลเก่าที่ไม่มีหลักฐานรับเงินไม่ถูก backfill; null แสดงยังไม่ระบุ ส่วนยอด0ที่ระบุชัดยังแสดง0.00
- Browser fixtures ใช้หน้า React จริงและ intercept API ทั้งอ่าน/เขียน ไม่ติดต่อฐานข้อมูลหรือส่งเงิน/ข้อความ; PDF fixture ตรวจการเรียก endpoint/ดาวน์โหลด ไม่อ้างว่าตรวจเนื้อหา PDF จริงจาก production ส่วนวงจรเงินและบัญชีใช้ PostgreSQL ชั่วคราวแยก

ผลชุด D (11 กันยายน 2569, เวลาไทย):

| คำสั่ง / หลักฐาน | ผล | เสร็จเวลา |
|---|---|---|
| API targeted: query/date/DTO/customer-tier/contract scope; `reports-api.log` | **10 suites / 198 tests PASS** | 12:35:13 |
| Web targeted: export/balances/cache/POS/bookings/credit/void/wizard/return; `reports-web.log` | **16 files / 121 tests PASS** หลังแก้ ExportError/focus | 12:50:54 |
| `bash tools/test-chat-credit.sh`; `reports-db.log` | **9 suites / 123 tests PASS** บน PostgreSQL ชั่วคราว รวม pagination/date/profit HTTP ใหม่ | 12:42:27 |
| `npm run test:e2e --workspace=apps/web -- --config=playwright.sales.config.ts`; `reports-browser.log` | **18 tests PASS**, 1440/390, 28 ภาพ, ไม่มี uncaught page error/หน้าเว็บล้นแนวนอน | 12:53:17 |
| `node docs/review/2026-09-11-sales/core-browser-check.mjs` | **8 states PASS** ราคาและ preview/retry | 12:45:53 |
| `node docs/review/2026-09-11-sales/bookings-browser-check.mjs` | **20 states PASS** มัดจำ/ส่วนต่าง/expiry/legacy/error | 12:46:03 |
| `node docs/review/2026-09-11-sales/contracts-browser-check.mjs` | **10 states PASS** quote/tender/409/503/guardian | 12:45:51 |

Commits: `50a21b5d5` API รายงาน/สิทธิ์/การแบ่งหน้า, `eb7000344` UI/export/handoff/cache, `b86687bd2` six-menu browser regression. แยก commit ตามชั้น API/UI/tests เพราะ helper ใช้ร่วมหลายหน้า; ไม่ได้แยกตาม layout รายหน้าแบบที่เสนอไว้เดิม

ผล independent read-only review ล่าสุด: **0 Critical / 0 Warning** หลังแก้ export company revision, branchless contract scope, overdue partial/fee balance, customer selection retention, focus และข้อความ export. มีข้อสังเกตระดับ Info เรื่องเวลาคำนวณ tier export ข้อมูลจำนวนมากตามข้อจำกัดข้างต้น

Browser พบปัญหาที่เพิ่ม regression แล้ว: URL ทำให้ตารางสร้าง link node ใหม่ จึงคืน focus ด้วย sale ID แทน DOM node เก่า; `getErrorMessage` ใช้กับ transport error จึงต้องแยก `ExportError` ที่คาดหมายเพื่อแสดงเหตุเปลี่ยนบริษัท/ชุดข้อมูล. การจับภาพรอแผงเปิดสุดและตรวจกรอบ dialog ก่อนบันทึก ป้องกันภาพตัดข้อมูลกลาง animation

Red evidence D1/D2 อยู่ `reports-red.log` (กำไร/วันไทย) และ `export-red.log` (helper ยังไม่มี). Handoff มี rendered regression หลัง implementation และ audit baseline; ไม่มี red log แยกในชุด D. Local check รอบแรกตรวจโค้ด/build/browser แล้วปฏิเสธ checkpoint เพราะแก้ไฟล์ e2e ระหว่างรัน จึงไม่ใช้รอบนั้นเป็นผลส่งมอบ

## Coverage ปิดข้อค้นพบ

| ข้อค้นพบ | สถานะ | งานและหลักฐาน |
|---|---|---|
| F01, S02 | แก้แล้ว | A2 + D2 HTTP role/branch/projection; branchless list/detail |
| F02–F04, F08, F15, S06–S07 | แก้แล้ว | B1–B4 เงิน/stock/locking/expiry + PostgreSQL/20 browser states |
| F05, S05 | แก้แล้ว | A3–A4 ราคาเงินสด/actual down + POS/settlement/void |
| F06–F07, F09, F18 | แก้แล้ว | D1–D2 totals/date/tier/pagination + workbook201/filter assertions |
| F10–F11, F14 | แก้แล้ว | D3 roles/handoff/cache; API HTTP + rendered navigation + warm-cache tests |
| F12–F13, S01, S03–S04 | แก้แล้ว | A5 + C1–C3 preview consent/signers/quote/tender/lifecycle parity |
| F16–F17 | แก้แล้ว | D1/D4 mobile tabs/filter sheet/focus/detail/ยอดเงินที่แยกความหมาย |
| S08 | กำหนดขอบเขตแล้ว | prototype ไม่ถือเป็น backend acceptance; การใช้มัดจำข้ามผ่อน/ไฟแนนซ์ยังเป็นระยะขยาย ไม่เปิดการเงินโดยไม่มี lifecycle spec |

## M1 — ผลตรวจส่งมอบ

`LOCAL_PREVIEW_PORT=5207 npm run local:check` **PASS ครบ21 checks** วันที่11 กันยายน2569 เวลา12:55:36 บน revision `b86687bd2`, source fingerprint `5fffca7284eccabdd7293a2cd5d685c58842791e32ccfdb64636bbe925b654cb` รวม API/Web types, lintไม่มี errors, Web1963/shared77/storefront31 tests, ทั้งสอง builds และ managed browser1440/390. มี lint/build warnings เดิม ไม่ได้อ้างว่าทั้ง repository ไม่มี warnings

หลักฐาน checkpoint: [local-check.json](remediation-evidence/local-check.json); ภาพและรายละเอียด18กรณีของชุด D: [README](remediation-evidence/README.md). รอบสุดท้ายเริ่ม backend ใหม่จาก checkout นี้และยังเปิดไว้ที่ [พรีวิวรายการขาย](http://localhost:5207/sales), [ขายสินค้า](http://localhost:5207/pos), [ลูกค้า](http://localhost:5207/customers)

ปิดงานแก้ A–D/M1 ตาม coverage ข้างต้นแล้ว; ข้อจำกัดรายงาน/ข้อมูลเก่าและ feature ระยะขยายยังคงตามที่ระบุ. พรีวิวเป็นข้อมูล/AI จำลองและเป็นขอบเขตจำกัดตาม AGENTS.md; ธุรกรรมจริงของบริการขาย/มัดจำ/สัญญา/ledger ตรวจด้วย PostgreSQL ชั่วคราวแยก. ไม่มีการ deploy/merge/แก้ฐาน production หรือส่งข้อความออกภายนอก


## Subsequent follow-up

The owner approved further work after A–D. See [followup-verification.md](./followup-verification.md) for receipt breakdown, recorded sale cost, server snapshots, Thai errors and the current verification results. Earlier current-cost/paged-export limitations above describe the pre-follow-up revision.
