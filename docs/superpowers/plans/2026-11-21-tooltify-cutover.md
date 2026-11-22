# Tooltify → BESTCHOICE Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ย้ายสต๊อกคงเหลือและประวัติขายที่ตรวจยอดแล้วเข้า BESTCHOICE เพื่อหยุดใช้ Tooltify โดยรักษาตัวตน IMEI จำนวนสินค้า ยอดขาย และรายการเดิมใน BESTCHOICE

**Architecture:** ต่อ CLI/parser และหน้าประวัติเดิมด้วยขั้น inspect → normalize → dry-run → apply → reconcile และบันทึก provenance ใน transaction เดียวกับรายการที่สร้าง ใช้ snapshot ล่าสุดสำหรับสต๊อก ใช้ IMEI จับคู่เครื่อง และใช้เหตุการณ์ขายแยกจากตัวเครื่อง เปิดใช้งานจริงครั้งเดียวหลังซ้อมและตรวจยอดผ่าน; ไม่มีงานซิงก์ถาวร

**Tech Stack:** TypeScript, NestJS, Prisma/PostgreSQL, ExcelJS, React/TanStack Query, Jest, Vitest, Playwright และ Node crypto/fs ที่มีอยู่ ไม่เพิ่ม dependency เพื่ออ่าน Excel หรือสร้างระบบนำเข้าทั่วไป

**Spec:** `docs/superpowers/specs/2026-11-21-tooltify-cutover-design.md` (ฉบับหลัง scrutinize และคำยืนยัน barcode = IMEI)

## Global Constraints

- “barcode ของเครื่องคือ IMEI ของเครื่องนั้น”: map ไป `Product.imeiSerial` เป็น string ไม่เติม/ตัดหลัก ไม่ใช้ชื่อรุ่นเป็น identity
- “ไม่ใช้การรับเข้า−ขายออกเป็นหลักฐานยอดคงเหลือ”; snapshot IMEI ซ้ำต้อง fail ไม่เลือกแถวล่าสุดเอง
- “ไม่คืนชีพสินค้าที่ขายแล้ว ถูกลบ หรือมีสัญญาอ้างอิงโดยอัตโนมัติ”; ไม่ล้างคลังเดิม ไม่ update Product เดิมใน importer รุ่นแรก
- “ไม่เติมศูนย์เงียบ ๆ”; invalid money/IMEI/หมวด/สาขาต้องมีข้อผิดพลาดรายแถว ก่อนเปิดขายต้องผ่าน `hasSellingPrice`
- “รายการขายเดิมไม่สร้าง Sale/สัญญา/รับเงิน/ค่าคอมใหม่”; ประวัติอยู่ `ImportedSale` และไม่ถูกรวมกับยอดปฏิบัติการโดยปริยาย
- “เวลาทั้งสองใช้ Asia/Bangkok”; เงินใช้ Decimal และเทียบยอดถึงสตางค์ ใช้ UUID สำหรับ ID ใหม่
- “ห้ามคืน backup ทั้งฐานทับรายการจริง” หลังเปิดใช้; Product rollback เป็น soft-delete เฉพาะรายการใหม่ที่ยังไม่ถูกใช้
- “ProductPrice” ต้อง sync พร้อมคอลัมน์ราคาใน transaction; ใช้ helpers เดิม ไม่จำลองการซื้อสินค้าเพื่อให้ helper ทำงาน
- ทุกแถวต้นทางต้องอยู่ในรายงาน disposition และทุกการเขียนต้องมี batch/target ID ที่ย้อนตรวจได้ ไฟล์จริง/PII ไม่เข้า Git
- SHOP คือหน้าร้าน; สิทธิ์ imported-sales และการซ่อน cost/profit เดิมต้องคงอยู่ ไม่เพิ่ม company selector
- งานรอบนี้คือแผน การ implement, deploy, import production และยกเลิกบริการ Tooltify เป็นคนละการดำเนินการ
- ก่อนแก้โค้ดอ่าน `AGENTS.md`, `.claude/CLAUDE.md` และ workflow ที่เกี่ยวข้อง; หลัง code change ผ่าน `npm run local:check` จาก checkout นี้ และทดสอบ flow ที่เปลี่ยนด้วย backend จริงของ checkout นี้

## Review Focus

1. IMEI เคยขายแล้วแต่กลับมาอยู่ใน snapshot ต้องยังเป็นหนึ่งเครื่อง; IMEI เดียวต่างบิลต้องเก็บครบ (Tasks 2, 3, 5)
2. ไฟล์ซ้ำ/ทับช่วง หรือ Accessories สองแถวเหมือนกันทุกช่องต้องไม่ทำจำนวนหายหรือเพิ่มเอง (Tasks 1, 3, 6)
3. DB เปลี่ยนหลัง dry-run หรือ process ตายหลัง commit ต้องไม่คืนชีพ/สร้างซ้ำ และ rollback ต้องไม่แตะธุรกรรมใหม่ (Tasks 4, 5, 6, 9)
4. Excel numeric/date/formula/rich-text และช่องว่างกลางตารางต้องไม่เลื่อนคอลัมน์ สูญหลัก IMEI หรือตัดข้อมูลเงียบ (Tasks 2, 3)
5. ผู้ไม่มีสิทธิ์ต้นทุน/กำไรยังค้นได้ตามสิทธิ์ แต่ต้องไม่เห็นเงินที่ถูกซ่อน; วันที่ขอบเดือนและผลรวมต้องตรงกับผลกรอง (Tasks 7, 8)

## ขนาดงานและเงื่อนไขเริ่ม

งานเดียวแบ่ง 10 tasks เพราะ stock/history ใช้ชุดไฟล์และ batch provenance ร่วมกันและมีวัน cutover เดียว Tasks 2–3 และ 7–8 ตรวจรับแยกได้ แต่ต้องรวมซ้อมก่อนเปิดใช้ ห้ามลงมือเขียน production ตามแผนนี้ทันที

ข้อเท็จจริงตั้งต้น: ไฟล์สต๊อกชื่อวันที่ 19 พ.ย. 2026 มี 28 IMEI ไม่ซ้ำ + Accessories 665 แถว + ไม่มีหมวด 2 แถว; ไฟล์ขายชื่อ ต.ค.–พ.ย. มีข้อมูลจริง 1 ต.ค.–18 พ.ย. 2026 จำนวน 1,380 รายการ คู่ซ้ำแถว 1620–1621 เป็น Accessories ไม่ใช่เครื่อง ตัวเลขเหล่านี้เป็นหลักฐานสำรวจ ไม่ใช่ acceptance totals ของวัน cutover

Task 1 ต้องออก decision record ก่อน Tasks 3–6: ช่วงประวัติ, report quantity semantics, รายการซ้ำจริง, คืน/ยกเลิก, branch/status mappings, ราคาและต้นทุนเปิด และงานค้าง ถ้าพบลูกหนี้/งานซ่อม/เคลมที่อยู่เฉพาะ Tooltify ให้ทำแผนย่อยรับช่วงก่อนปิด Tooltify; ไม่สร้างสัญญาจาก label ยอดขาย

## File structure และ interfaces ร่วม

ไฟล์ใหม่ใน `apps/api/src/cli/tooltify-cutover/` แยกตามหน้าที่:

| ไฟล์ | หน้าที่ |
|---|---|
| `types.ts` | InputManifest, canonical rows, issues, disposition, immutable plan/report contracts |
| `inspect.ts` | inventory ไฟล์/checksum/ช่วงรายงาน/section/coverage; ไม่ใช้ DB |
| `canonicalize.ts` | เลือกไฟล์ canonical, ตรวจ overlap, source identity และ decisions ที่ผูก checksum |
| `plan.ts` | DB read-only: classify CREATE/MATCH/CONFLICT/EXCLUDE, counts/money และ dependency fingerprint |
| `batch.ts` | durable batch/item records, locks, apply receipt และ retry |
| `stock-writer.ts` | สร้างสินค้าใหม่ + helpers ราคา + provenance แบบ atomic |
| `sales-writer.ts` | สร้าง ImportedSale + provenance แบบ atomic |
| `reconcile.ts` | เทียบต้นทาง/canonical/target และผลข้างเคียง |
| `rollback.ts` | dry-run rollback และ reverse เฉพาะ target ที่ batch สร้างและไม่ถูกใช้ |

ต่อ parser ใน `apps/api/src/modules/imported-sales/`; เพิ่ม `tooltify-stock-snapshot-parser.ts` สำหรับหัวคอลัมน์ snapshot โดยไม่บิด legacy flow parser เป็น snapshot ปรับ CLI เดิมเป็น thin entry เข้า shared runner `apps/api/src/cli/tooltify-cutover.cli.ts` เพื่อไม่เหลือทางเขียนข้าม guard

types หลัก (ประกาศจริงใน Task 1; แต่ละ task ระบุรายละเอียดเพิ่มของชนิดที่ตัวเองเป็นเจ้าของ):

```ts
type FileRef = { path: string; sha256: string; kind: 'STOCK_SNAPSHOT'|'SALES'|'ENRICHMENT'; storeKey: string; branchId: string|null; reportFrom: string|null; reportTo: string|null };
type SourceRef = { fileSha256: string; sheet: string; row: number; storeKey: string };
type ImportIssue = { code: string; source: SourceRef|null; message: string };
type Disposition = 'CREATE'|'MATCH'|'CONFLICT'|'EXCLUDE';
type InputManifest = { version: 1; cutoverAt: string; companyCode: 'SHOP'; files: FileRef[]; decisionsSha256: string; canonicalSetId: string };
type ApplyReceipt = { batchId: string; created: number; matched: number; excluded: number; status: 'APPLIED'|'FAILED' };
```

`cutoverAt` ต้องเป็น ISO พร้อม `+07:00`; reportFrom/To เป็นวันไทย; `SourceRef.row` เป็นเลขแถว Excel 1-based จริง InputManifest ไม่มีรหัสผ่าน/ชื่อจริงลูกค้า ทุก alias/path ที่ใช้ระบุไฟล์ใน report ต้องไม่เผย credentials

`PlannedItem` ประกาศใน Task 4 เป็น discriminated union ของ `PlannedStockItem`/`PlannedSalesItem`: batchId:string, kind STOCK/SALES, sourceKey, payloadHash, disposition, targetId:string|null, reason:string|null, payload (canonical row), dependencyFingerprint:string ส่วนผลตรวจที่กล่าวในแต่ละ task ให้ประกาศใน `types.ts` พร้อมผู้สร้าง type นั้น ไม่สร้างประเภทผลลัพธ์ซ้ำใน writer/CLI/API

## คำสั่งตรวจที่ใช้ร่วมกัน

- Unit API: `npm test --workspace=@installment/api -- --runTestsByPath <paths relative to apps/api>`; ต้องเป็น pure/mocked tests เท่านั้น
- DB integration: `bash tools/test-db-vitest.sh <integration paths relative to apps/api>` — script นี้สร้าง PostgreSQL/pgvector ชั่วคราวเองและทำ migrate deploy ไม่รัน Vitest DB tests ตรงกับ inherited DATABASE_URL
- Web: `npm test --workspace=@installment/web -- <path relative to apps/web>`
- Typecheck: `./tools/check-types.sh all`; local preview/check: `npm run local:check`
- ทุก Task ที่แก้โค้ดจบด้วย tests ของ task + local checks ตาม AGENTS.md; งานแก้แต่เอกสารไม่ต้องเปิด preview หรือรันทั้ง suite
- Commit เฉพาะไฟล์ของ task: `git add -- <exact task files>` แล้วใช้ commit message ที่ระบุ ไม่ `git add .` และไม่ push/merge/deploy อัตโนมัติ

---

### Task 1: สร้างบัญชีไฟล์และยืนยันขอบเขตข้อมูลก่อนสร้าง writer

**Files:** Create `apps/api/src/cli/tooltify-cutover/{types,inspect,canonicalize}.ts`, `apps/api/src/cli/tooltify-cutover/__tests__/inspect.spec.ts`, `apps/api/src/cli/tooltify-cutover.cli.ts`; Modify `apps/api/package.json`; Create `docs/superpowers/plans/2026-11-21-tooltify-source-decisions.md` (เฉพาะสรุปไม่ใส่ข้อมูลลูกค้า)

**Interfaces:** `inspectFiles(paths: string[]): Promise<InspectionReport>` คืน checksum, section headers, source row counts, report date range เทียบกับวันที่จริง, duplicates/overlaps; `validateManifest(manifest: InputManifest, inspection: InspectionReport, decisions: SourceDecisions): ImportIssue[]` ตรวจว่าสาขา/ช่วง/การตัดซ้ำมีหลักฐาน; `SourceDecisions` เก็บราย file hash + source rows + action + reason + evidence reference ไม่เก็บคำอนุมัติแบบ boolean โดยไร้ที่มา

- [ ] **1. เขียน failing tests** ด้วย workbook สังเคราะห์: สำเนาชื่อใหม่ checksum เดิมต้องรายงานเป็นไฟล์เดียว; ชื่อไฟล์ถึง 30 พ.ย. แต่ข้อมูลถึง 18 พ.ย. ต้องแสดงทั้งสองค่า; snapshot หลายวันต้องไม่ถูกรวม; ช่วงขาย overlap ต้องไม่ผ่าน validation โดยไม่มี canonical selection; checksum เปลี่ยนต้องทำให้ decisions เดิมใช้ไม่ได้

  Assertion ของ test `rejects_decisions_for_changed_files` หลังแก้ fixture แต่คง manifest/decisions เดิม:
  ```ts
  expect(validateManifest(manifest, changedInspection, decisions))
    .toContainEqual(expect.objectContaining({ code: 'FILE_HASH_MISMATCH' }));
  ```
- [ ] **2. รันให้เห็น failure:** `npm test --workspace=@installment/api -- --runTestsByPath src/cli/tooltify-cutover/__tests__/inspect.spec.ts` → FAIL เพราะยังไม่มี inspector/validator
- [ ] **3. Implement** inspect/validation และ `import:tooltify-cutover` script (`tsx src/cli/tooltify-cutover.cli.ts` ผ่าน dependency ใน repo) โดย mode `inspect` ไม่สร้าง PrismaClient เขียนรายงาน JSON/CSV ที่ directory ผู้ใช้ระบุและตั้งไฟล์ private อ่านจาก explicit file list ไม่ glob ทุก Downloads แล้วนำเข้าทั้งหมด
- [ ] **4. ตรวจไฟล์จริงแบบอ่านอย่างเดียว** และเขียน decision record: เลือก snapshot ต่อสาขา, coverage, zero-sales periods, source store, price/status mappings, 4 phone barcode anomalies, 2 unknown stock categories และคู่ Accessories ซ้ำ ระบุคู่ซ้ำเป็น `REPORT_DUPLICATE` หรือ `DISTINCT_UNITS` ได้ต่อเมื่อเทียบบิล/รายงานจำนวนแล้ว ถ้ายังพิสูจน์ไม่ได้ใช้ `UNRESOLVED` ซึ่ง block apply ไม่เดาคำตอบแทนเจ้าของ
- [ ] **5. รัน tests ให้ผ่านและตรวจ privacy ของรายงาน**; commit `feat: inspect and validate Tooltify source manifests`

**Gate:** ถ้ามีคืน/ยกเลิกที่เปลี่ยนยอดแต่ยังไม่มีเอกสารผูกบิล ห้ามอ้าง totals ว่าเป็นยอดสุทธิหรือเดินหน้า final apply ให้จัด source decision/แบบเหตุการณ์เพิ่มก่อน Tasks 3/6; ส่วน parser/หน้าค้นทำต่อได้ ถ้ามีงานค้างนอก stock/history ให้แยกแผนรับช่วงและบันทึกเป็น blocker ของ retirement ไม่ยัดเข้า ImportedSale

### Task 2: อ่าน snapshot ตามหัวจริงและรักษา IMEI/ตำแหน่ง Excel

**Files:** Modify `apps/api/src/modules/imported-sales/xlsx-reader.ts`, `tooltify-stock-parser.ts`, `__tests__/xlsx-reader.spec.ts`; Create `tooltify-stock-snapshot-parser.ts`, `__tests__/tooltify-stock-snapshot-parser.spec.ts`; Modify `apps/api/src/cli/tooltify-cutover/types.ts`

**Interfaces:** เพิ่ม `readXlsxTable(filePath: string): Promise<{sheet: string; rows: string[][]}>` ที่ preserve row/column index; คง `readXlsxRows(filePath: string): Promise<string[][]>` wrapper สำหรับ callers เดิม `parseStockSnapshot(rows: string[][], context: {file: FileRef; sheet: string; canonicalSetId: string}): ParseResult<CanonicalStockUnit>` เป็น pure โดย `ParseResult<T>={rows:T[];issues:ImportIssue[]}`; `CanonicalStockUnit` มี source, sourceKey, kind DEVICE/ACCESSORY, barcode:string, category, deviceOrigin, name/brand/model/storage/color, cost:string, cashPrice/installmentPrice/financePrice:string|null, branchId, sourceStatus, desiredStatus, importedAt:string, priceEvidence:string|null ไม่มี default IN_STOCK

- [ ] **1. เขียน failing tests:** header ของ snapshot 10 คอลัมน์ต้นทุนอยู่ช่อง 9; สลับคอลัมน์แล้วยังอ่านถูก; เสียคอลัมน์ต้นทุนต้อง issue; empty row กลาง section ต้องไม่ตัดรายการถัดไป; สูตรที่มี cached result/richText อ่านได้และสูตรไม่มี result ต้อง issue; Excel date ขอบวันถูกตีความตามวันเวลาไทยที่แสดงใน source; IMEI string มีเลขนำหน้า 0 ต้องไม่สูญหลัก; numeric ที่ precision หายห้ามเดาเติม
- [ ] **2. เพิ่มกรณีตัวเครื่อง:** snapshot IMEI ซ้ำแม้ต่างสาขา → `DUPLICATE_IMEI`; `iPhone มือ 2 (เครื่องนอก)` → PHONE_USED + IMPORTED; หมวดเครื่อง barcode ผิดรูปแบบ → `INVALID_DEVICE_IMEI` ไม่ ACCESSORY/null; หมวดไม่รู้จัก → issue; IMEI เคยขายในอดีตไม่เป็น input ของ parser และยังคงอยู่ snapshot; Accessories 3 แถวที่ระบุหนึ่งแถว/ชิ้น → 3 units ตาม Task 1

  Assertion ของ test `preserves_device_identity_and_origin` ใช้ fixture barcode `012345678901234`, หมวดเครื่องนอก:
  ```ts
  const result = parseStockSnapshot(snapshotRows, context);
  expect(result.rows[0]).toMatchObject({ barcode: '012345678901234', category: 'PHONE_USED', deviceOrigin: 'IMPORTED' });
  expect(result.issues).toEqual([]);
  ```
- [ ] **3. รัน tests → FAIL แล้ว implement** อ่าน `cell` ตาม index จริง (`row.getCell`) ไม่ push แล้วเลื่อนช่อง; decode string/number/date/formula/richText อย่าง explicit และเก็บ physical row เลขเดิม; ใช้ Decimal ตรวจเงิน finite/scale/range ไม่ `Number → 0`; แยก snapshot parser ออกจาก `reconstructCurrentStock`; หมวด/สถานะใช้ allow-list ตาม source decisions ไม่อนุมานจากรูปรหัสเพียงอย่างเดียว

  Reader ที่พบ unsupported/formula without result โยน `XlsxReadError` พร้อม sheet/row/column ให้ inspector แปลงเป็น ImportIssue ไม่แปลงเป็น `[object Object]`; Excel date ที่ไม่มี timezone เป็นเวลาหน้าปัดไทยตาม report format ให้ normalize ก่อน parser ไม่ผูก timezone เครื่องที่รัน ทดสอบทั้ง Date cell และ string cell ของเวลาไทยเดียวกันได้ instant เดียวกัน
- [ ] **4. รัน:** `npm test --workspace=@installment/api -- --runTestsByPath src/modules/imported-sales/__tests__/xlsx-reader.spec.ts src/modules/imported-sales/__tests__/tooltify-stock-snapshot-parser.spec.ts src/modules/imported-sales/__tests__/tooltify-stock-parser.spec.ts` → PASS รวม regression ของ legacy reader; เพิ่ม fixture สังเคราะห์เลียนแบบโครงไฟล์จริง ไม่ commit ไฟล์จริง
- [ ] **5. Commit:** `feat: parse Tooltify stock snapshots by header and IMEI`

**Decision:** รายการขาดราคาพักอยู่นอกฐานจนแก้ครบ หรือเข้า QC_PENDING เฉพาะเมื่อผู้รับผิดชอบยืนยันสถานะนั้นจริง ไม่ใช้ QC_PENDING ปลอมเป็นถังพักราคา สถานะจองต้องมีหลักฐาน/งานรับช่วง; ไม่เปิด IN_STOCK แทนเพียงเพราะ snapshot มีแถวนั้น

### Task 3: Canonical sales และการกันไฟล์ซ้ำโดยไม่ทำจำนวนขายหาย

**Files:** Modify `apps/api/src/modules/imported-sales/tooltify-sales-parser.ts`, `__tests__/tooltify-sales-parser.spec.ts`, `apps/api/src/cli/tooltify-cutover/{types,canonicalize}.ts`; Create `apps/api/src/cli/tooltify-cutover/__tests__/canonicalize.spec.ts`

**Interfaces:** เพิ่ม `parseSalesReport(rows, context): ParseResult<CanonicalSaleLine>` โดย context ใช้ FileRef/sheet เช่น Task 2; คง `parseSalesLineItems` wrapper จนย้าย callers หมด `CanonicalSaleLine` = ParsedSale + source + sourceKey + sourceStoreKey + occurrence:number; หนึ่ง record เป็นหนึ่งชิ้น/รายการตาม source decisions `canonicalizeSales(parsed: CanonicalSaleLine[], decisions: SourceDecisions): ParseResult<CanonicalSaleLine>` ไม่ใช้ DB

- [ ] **1. เขียน failing tests:** IMEI เดียวต่าง order/time เก็บ 2 รายการ; ไฟล์เดิมสองชื่อไม่เพิ่มยอด; overlap ที่มีบิลแก้ราคาต้อง `SOURCE_CONFLICT`; คู่ Accessories ทุกช่องเหมือนกันห้าม drop ถ้า unresolved; decision DISTINCT_UNITS เก็บ 2 occurrence และ REPORT_DUPLICATE เก็บ 1 + excluded provenance; ไฟล์รายงานไม่มี section/จำนวน 0 ไม่ตรง summary ต้อง fail
- [ ] **2. เขียน assertions เรื่องเงินและวันที่:** ของแถมขาย 0 และ profit ติดลบยังเก็บได้; วันไทยขอบเดือนตรง ISO instant; malformed soldAt/money ต้อง issue ที่ระบุแถว ไม่ skip; summary ที่รายงานกับ detail ไม่ตรงต้องแสดง delta แยกยอดขาย/ต้นทุน/กำไร ไม่คำนวณทับค่าต้นทางเงียบ ๆ

  Assertion ของ test `keeps_two_bills_for_one_device` ใช้ fixture IMEI เดียวและบิล `A-1`,`A-2`:
  ```ts
  const result = canonicalizeSales(twoBillLines, decisions);
  expect(result.rows.map(r => r.orderNumber)).toEqual(['A-1', 'A-2']);
  expect(new Set(result.rows.map(r => r.sourceKey)).size).toBe(2);
  ```
- [ ] **3. รันสอง suites → FAIL แล้ว implement** header/section parser และ canonical selection ตาม Task 1 ใช้ non-overlapping report coverage เป็น baseline; sourceKey = SHA-256 ของ sourceStoreKey + orderNumber + barcode + soldAt + occurrence (canonical JSON); changed money ไม่เปลี่ยน key แต่ต้อง conflict เมื่อ payload hash ต่าง; ordinal นับเฉพาะ multiplicity ที่พิสูจน์แล้ว ไม่ใช้ชื่อไฟล์เป็น identity ข้าม re-export
- [ ] **4. รัน:** `npm test --workspace=@installment/api -- --runTestsByPath src/modules/imported-sales/__tests__/tooltify-sales-parser.spec.ts src/cli/tooltify-cutover/__tests__/canonicalize.spec.ts` → PASS; ใน report แยก gross sales vs adjustments ห้ามเรียกยอด gross ว่าสุทธิ หาก source events ต้องการ schema นอกแบบ ให้หยุด sales writer จนเพิ่มแบบที่ผูกเอกสารได้
- [ ] **5. Commit:** `feat: canonicalize Tooltify sales without losing repeated units`

### Task 4: เก็บ batch provenance และวาง dry-run ที่ตรวจ DB จริง

**Files:** Modify `apps/api/prisma/schema.prisma`; Create migration directory ใช้ timestamp ถัดจาก migrations ปัจจุบันและ suffix `_tooltify_cutover_provenance`; Create `apps/api/src/cli/tooltify-cutover/{batch,plan}.ts`, `__tests__/batch.integration.spec.ts`, `__tests__/plan.integration.spec.ts`; Modify `types.ts`

**Interfaces / storage:**
- `TooltifyImportBatch`: UUID, canonicalSetId, kind STOCK/SALES, manifestHash, planHash, sourceCutoverAt, status APPLYING/APPLIED/FAILED/VERIFIED/ROLLED_BACK, codeRevision, createdAt/updatedAt/deletedAt; unique `[canonicalSetId,kind]` เก็บประวัติ state change ใน audit/receipt ไม่ rewrite hash เพื่อใช้ batch เดิมกับ input ใหม่
- `TooltifyImportItem`: UUID, batchId FK, sourceKey, sourceRefs JSON (ไม่มีข้อมูลลูกค้า), payloadHash, disposition, targetType PRODUCT/IMPORTED_SALE, targetId nullable, afterFingerprint nullable, reversedAt nullable, createdAt/updatedAt/deletedAt; unique `[batchId,sourceKey]`; MATCH ต้องมี targetId แต่ไม่ได้เป็นเจ้าของรายการนั้นสำหรับ rollback
- รุ่นแรกสร้างใหม่หรือ MATCH เท่านั้น ไม่แก้/restore สินค้าเดิม จึงไม่มี before-image update ที่ต้องคืน; ถ้าต้องแก้ของเดิมเป็นงาน reconciliation แยกก่อนสร้าง dry-run รอบใหม่
- `buildImportPlan(db: PrismaClient, input: CanonicalInput): Promise<ImportPlan>` คืน batchId, planHash, dependencyFingerprint, decisionsHash, planned items, totals, issues; `CanonicalInput` รวม manifest + CanonicalStockUnit[] หรือ CanonicalSaleLine[]; batchId ใช้ record เดิมถ้ามี canonicalSetId/kind ตรง มิฉะนั้น allocate UUID ใน plan โดยยังไม่เขียน DB; `ImportPlan` ไม่มี secrets และ hash ผูก canonical input, codeRevision, DB identity, mapping, current target states และ matched price-template versions
- `applyBatch(db, plan, applyItem): Promise<ApplyReceipt>` รับ callback `(tx: Prisma.TransactionClient, item: PlannedItem) => Promise<TargetWriteResult>`; `TargetWriteResult` มี targetType/id, created:boolean, afterFingerprint; apply progress/provenance commit ใน transaction เดียวกับ item

- [ ] **1. เขียน DB tests:** IMEI active ที่ไม่มี TTFY prefix ต้องพบ; soft-deleted และ SOLD/held target → conflict; active สาขา/สถานะ/ต้นทุนตรงจริง → MATCH ไม่ update; snapshot เดิมที่ matched Product เปลี่ยนหลัง dry-run ต้อง fail; dry-run row counts ของทุกตารางไม่เปลี่ยน
- [ ] **2. เขียน retry tests:** transaction rollback ไม่เหลือ item หรือ target; crash หลัง item commit รันซ้ำไม่เพิ่ม; canonicalSetId เดิม hash ใหม่ถูกปฏิเสธ; concurrent apply ชุดเดียวกันสร้างหนึ่ง target เท่านั้น; conflict ไม่ถูก `skipDuplicates` กลืน

  Assertion ของ test `matches_existing_imei_without_legacy_prefix` ใช้ fixture Product active ที่ข้อมูลตรงและไม่มี TTFY code:
  ```ts
  const plan = await buildImportPlan(db, input);
  expect(plan.items[0]).toMatchObject({ disposition: 'MATCH', targetId: existingProduct.id });
  expect(await db.product.count()).toBe(beforeCount);
  ```
- [ ] **3. รัน harness → FAIL จาก table/function ที่ยังไม่มี แล้วสร้าง models/migration และ implement** ใช้ PostgreSQL advisory lock ต่อ batch/identity และตรวจ unique constraints ภายใน transaction สำหรับ item ใหม่ แต่ละรอบ revalidate dependency fingerprint ก่อนเขียน; item ที่ commit แล้วตรวจ receipt/payload ไม่ตรวจเสมือนยังเป็น candidate ใหม่ ใช้ transaction ต่อชิ้น ไม่เปิด transaction ค้างระหว่างอ่านไฟล์

  DB identity เก็บ host/database fingerprint โดยไม่เก็บ credentials; expected identity ต้องส่งจาก operator และเทียบ connection จริง ถ้า schema/connection ไม่ตรงหยุด รายการ Accessories ที่มี SKU ใน BESTCHOICE อยู่แล้วต้องมี explicit target-ID mapping/จำนวนที่ตรวจแล้วใน decisions ก่อน MATCH หรือ CREATE ส่วนเพิ่ม ไม่มีการจับคู่สุ่มตามรุ่นแล้วเพิ่มทั้ง snapshot ทับของเดิม
- [ ] **4. Sales uniqueness decision:** ถ้า Task 1 พิสูจน์ multiplicity หรือเลขบิลชนต่าง sourceStore จริง ให้ migration เพิ่ม `sourceStoreKey` (legacy sentinel) และ `sourceOccurrence` default 1 แล้วแทน unique เดิมด้วย `[source,sourceStoreKey,barcode,orderNumber,soldAt,sourceOccurrence]`; audit/backfill rows เดิมก่อน drop index และคง occurrence=1 ให้ทุก legacy row ถ้าไม่พบหลักฐาน ให้คง unique เดิมและ writer fail เมื่อ occurrence>1 หรือ store collision ห้ามเปลี่ยนตามการคาดเดา บันทึก branch ที่เลือกใน source-decisions เพื่อให้ generated types/tests ใช้ schema เดียวกัน
- [ ] **5. Generate client แล้วรัน:** `bash tools/test-db-vitest.sh src/cli/tooltify-cutover/__tests__/batch.integration.spec.ts src/cli/tooltify-cutover/__tests__/plan.integration.spec.ts` → PASS และตรวจ partial IMEI index กับ `product_prices_one_default` ยังอยู่; commit `feat: track and preflight Tooltify import batches`

### Task 5: นำเข้าสินค้าใหม่โดยผ่านกติกา IMEI ราคา และสถานะ

**Files:** Create `apps/api/src/cli/tooltify-cutover/stock-writer.ts`, `__tests__/stock-writer.integration.spec.ts`; Modify `apps/api/src/cli/import-tooltify-stock.cli.ts`, `apps/api/src/modules/products/product-enter-stock.util.ts` (อัปเดตคำอธิบายข้อยกเว้น importer เก่าเท่านั้น); Reference `apps/api/src/utils/{product-price-autofill.util,product-price-sync.util,product-finance-price.util}.ts`, `apps/api/src/modules/products/product-hold.util.ts`

**Interfaces:** `writeStockItem(tx: Prisma.TransactionClient, item: PlannedStockItem): Promise<TargetWriteResult>`; `PlannedStockItem` = PlannedItem with payload CanonicalStockUnit และ resolved template/branch/company/fingerprint; ใช้ helpers ภายใน tx ไม่เปิด PrismaClient อื่น

- [ ] **1. เขียน DB tests:** snapshot มีหนึ่ง IMEI ที่มีประวัติขาย Tooltify → สร้างหนึ่ง Product ตาม snapshot; default cash/ผ่อน/finance rows sync ตรงคอลัมน์และ default มีหนึ่งแถว; GFIN อย่างเดียวไม่ผ่าน `hasSellingPrice`; missing price ไม่ถูกเปลี่ยนเป็นศูนย์พร้อมขาย; CATEGORY/ORIGIN ตรงเครื่องนอก; existing MATCH ไม่เปลี่ยน updatedAt หรือราคา; soft-delete/SOLD/held conflict ไม่คืนชีพ
- [ ] **2. เพิ่ม assertions:** branch/company SHOP ถูกต้อง; SourceKey Accessories หลายชิ้นได้ Product ตามจำนวน; หมวด unknown/สถานะจองที่ไม่มีเอกสารบล็อก apply; Sale/Contract/Payment/commission/journal counts ไม่เพิ่มจากการสร้าง stock และ simulated failure ใน helper rollback ทั้ง Product/Price/Item

  Assertion ของ test `does_not_publish_an_unpriced_device` ใช้ fixture ไม่มีทั้ง source price และ matching template:
  ```ts
  await expect(db.$transaction(tx => writeStockItem(tx, unpricedItem))).rejects.toThrow('MISSING_SELLING_PRICE');
  expect(await db.product.count({ where: { imeiSerial: unpricedItem.payload.barcode } })).toBe(0);
  ```
- [ ] **3. รัน harness → FAIL แล้ว implement** เฉพาะ CREATE: สร้างใน tx, เติมเฉพาะราคาขาดจาก template ที่ผูกใน plan, เรียก sync helper และ reread รวม live prices, ตรวจ `hasSellingPrice` ก่อน commit ของ IN_STOCK; prices/template เปลี่ยนจาก dry-run ต้อง replan; ไม่เขียน fields ของ Product MATCH และไม่เรียก purchase/Sales services

  Product ใหม่ใช้ `legacyProductCode = TTFY-CUTOVER:<batch UUID>:<sourceKey>`; sourceKey DEVICE = hash(storeKey+IMEI) และ ACCESSORY = hash(canonicalSetId+fileHash+sheet+physicalRow+unitOrdinal) ตาม multiplicity ที่ยืนยัน ทุกค่า deterministic ภายใน frozen manifest; batch ใหม่หลัง rollback ไม่ชน unique legacy code ของแถว soft-deleted แต่ต้องผ่าน IMEI/target reconciliation ใหม่ทั้งหมด
- [ ] **4. ย้าย CLI เดิมเข้าระบบใหม่:** ไม่มีการเขียนแบบ reconstructCurrentStock, `IMPORT_AS_IS` ที่ลืมแล้ว subtract sales, หรือ restore soft-deleted อัตโนมัติ; legacy invocation ที่ไม่มี manifest คืน actionable error ก่อนต่อ DB; explicit `current-stock-snapshot` เท่านั้น source historical importedAt เก็บ provenance; `stockInDate` ใช้วันที่เข้าคลังที่ยืนยันจาก source และรายงานที่มาชัด
- [ ] **5. รัน:** `bash tools/test-db-vitest.sh src/cli/tooltify-cutover/__tests__/stock-writer.integration.spec.ts` → PASS; รัน unit price helpers ที่มีอยู่ + local checks; commit `feat: import verified Tooltify stock with current pricing rules`

### Task 6: นำเข้าประวัติและตรวจยอดพร้อมควบคุม entry points

**Files:** Create `apps/api/src/cli/tooltify-cutover/{sales-writer,reconcile}.ts`, `__tests__/sales-writer.integration.spec.ts`, `__tests__/cutover-cli.spec.ts`; Modify `apps/api/src/cli/{tooltify-cutover.cli,import-tooltify.cli}.ts`, `apps/api/package.json`

**Interfaces:** `writeSalesItem(tx, item: PlannedSalesItem): Promise<TargetWriteResult>`; `reconcileBatch(db, batchId): Promise<ReconciliationReport>` มี totals/source/target/deltas แยก counts, money, month/channel/branch ที่พิสูจน์ได้ และ `canOpen:boolean`; runner `runCutover(args: string[], deps: CliDependencies): Promise<number>`; `CliDependencies` ห่อ filesystem/checksum/DB identity/writer เพื่อทดสอบ CLI โดยไม่ใช้ฐานจริง

- [ ] **1. เขียน DB tests:** rerun 0 extra rows; same IMEI different bill retained; verified multiplicity เก็บครบตาม schema Task 4; changed same identity fails; invalid row ไม่ถูกทิ้งเงียบ; source=TOOLTIFY ถูกกำหนด server-side; failure กลาง batch resume แล้ว totals ตรง
- [ ] **2. เขียน CLI guard tests:** default dry-run; missing/wrong expected DB name/host fingerprint, manifest hash เปลี่ยน, codeRevision เปลี่ยน, unresolved issues, plan hash ไม่ตรง → nonzero ก่อน write; mode apply ต้องทั้ง `--apply`, `CONFIRM_TOOLTIFY_IMPORT=YES_I_AM_SURE`, `EXPECTED_DB_NAME` และ `--plan-hash`; database ที่ไม่ใช่ isolated test/local ที่พิสูจน์ได้ต้อง `ALLOW_PROD_TOOLTIFY_IMPORT=YES_I_AM_SURE` โดยไม่อาศัย NODE_ENV เพียงอย่างเดียว legacy write flags ไม่ข้าม guard

  Assertion ของ test `fails_before_write_when_plan_changed` ใช้ injected deps ที่คำนวณ hash ต่างจาก argument:
  ```ts
  expect(await runCutover(['apply', '--apply', '--plan-hash', 'stale', '--manifest', fixturePath], deps)).not.toBe(0);
  expect(deps.apply).not.toHaveBeenCalled();
  ```
- [ ] **3. รัน tests → FAIL แล้ว implement** runner โหมด inspect/dry-run/apply/reconcile/rollback-dry-run/rollback จาก manifest ที่ระบุ; wrappers เดิม reuse guard เดียวกัน; SALES writer `create` พร้อม receipt ใน tx ไม่ `createMany(skipDuplicates)`; MATCH ต้อง payload ตรงและไม่เป็นของ batch สำหรับ rollback
- [ ] **4. Reconcile** ตรวจ source count = created + matched + excluded-with-evidence, target rows/เงินตาม canonical ถึง 0.00, จำนวนบิล distinct จาก store+orderNumber (เลขบิลว่างเป็น issue); เทียบ IMEI/SKU/branch/status/cost/price ตามชนิด รายงาน raw totals→canonical adjustments→target totals แยกกันและตรวจ forbidden side effects ด้วย reference/provenance ไม่เทียบ global counts ที่ธุรกรรมอื่นเปลี่ยนได้
- [ ] **5. รัน:** unit CLI suite และ `bash tools/test-db-vitest.sh src/cli/tooltify-cutover/__tests__/sales-writer.integration.spec.ts` → PASS; commit `feat: apply and reconcile Tooltify imports with explicit guards`

### Task 7: API ค้นประวัติด้วย IMEI/เลขบิลและนับบิลให้ถูก

**Files:** Modify `apps/api/src/modules/imported-sales/{dto/query-imported-sales.dto,imported-sales.service,imported-sales.controller}.ts`, `__tests__/imported-sales.service.spec.ts`; Create `__tests__/imported-sales-query.integration.spec.ts`; Reference `apps/api/src/modules/employee-access/access-imported-source.ts`

**Interfaces:** DTO เพิ่ม `barcode?:string`, `orderNumber?:string` trim/max 100 ตัวอักษร; exact match barcode เพื่อระบุเครื่อง, contains orderNumber แบบ parameterized Prisma; list/summary ใช้ buildWhere เดียวกัน summary `totals` เพิ่ม `billCount:number`, `lineCount:number` และคง `count=lineCount` ให้ caller เก่า; cost/profit เป็น `string|null` เหมือนเดิม

- [ ] **1. เขียน failing tests:** barcode หนึ่งเลขหลายบิลได้ครบ; same bill หลาย line → billCount 1/lineCount N; ข้าม store ไม่นับรวมบิลชื่อเดียวกันเมื่อ schema รองรับ; combined filters ช่องทาง/วัน/IMEI ตรงทั้ง list และ summary; limit/page และลำดับ `soldAt DESC,id DESC` คงที่
- [ ] **2. เพิ่ม tests สิทธิ์/เวลา:** denied imported-sales.read ยังถูกปฏิเสธ; sensitive cost/profit ไม่มีสิทธิ์ได้ null ทุก bucket; 1 พ.ย. 00:00 ไทยไม่ตกเดือน ต.ค.; query ว่างคืนผลกรองตามสิทธิ์และ summary ศูนย์ไม่ error; invalid length/วันที่กลับด้านถูก reject

  Assertion ของ test `distinguishes_bill_and_line_counts` fixture สอง lines ในบิลเดียว:
  ```ts
  expect((await service.summary(query)).totals).toMatchObject({ billCount: 1, lineCount: 2, count: 2 });
  ```
- [ ] **3. รัน unit → FAIL แล้ว implement** DTO/controller result/service พร้อม active access context เดิม; aggregate ทั้งผลกรองไม่ใช่เฉพาะหน้า; ไม่ใส่ชื่อจริง/PII เพิ่มเพื่อค้น IMEI ไม่เปิดสิทธิ์ใหม่เพื่อให้ migration test ผ่าน
- [ ] **4. รัน:** unit service suite + `bash tools/test-db-vitest.sh src/modules/imported-sales/__tests__/imported-sales-query.integration.spec.ts` + `bash tools/test-employee-access-tender-imported.sh` → PASS; สรุปสิทธิ์ด้วย data ที่สร้างใน isolated DB เท่านั้น
- [ ] **5. Commit:** `feat: search imported sales by IMEI and bill with correct counts`

### Task 8: หน้าเว็บค้นประวัติและแสดง coverage/ยอดอย่างถูกต้อง

**Files:** Modify `apps/web/src/pages/ImportedSalesPage.tsx`, `apps/web/package.json` (version ถัดไปตาม repo); Create `apps/web/src/pages/ImportedSalesPage.test.tsx`, `apps/web/e2e/imported-sales-cutover.spec.ts`; Modify API summary contract/service tests จาก Task 7 เพื่อเพิ่ม `coverage:{firstSoldAt:string|null,lastSoldAt:string|null,verifiedThrough:string|null}` จาก batch VERIFIED (first/last ไม่เท่ากับช่วงครบถ้วน)

**Interfaces:** หน้าใช้ filters barcode/orderNumber/startDate/endDate/saleChannel ใน queryKey และ params ของทั้ง list/summary; `verifiedThrough` เป็นวันเวลาที่ reconciliation รับรอง ไม่ใช่ max(soldAt); money masked null แสดง “ไม่มีสิทธิ์ดู” ไม่ 0 บาท; Source label Tooltify ชัดเจน

- [ ] **1. เขียน failing component tests:** ค้น IMEI/เลขบิลส่ง query ถูก; เปลี่ยน filter reset page; มี loading/error/retry/empty; billCount/lineCount label คนละตัว; ราคาถึงสตางค์; cost/profit null ไม่ crash; แสดงข้อมูลล่าสุดกับวันที่รับรอง coverage แยกกัน ไม่บอกครบเพียงเพราะมีวันสูงสุด

  Assertion ของ test `renders_masked_money_without_zero` หลัง render response cost/profit=null:
  ```tsx
  expect(await screen.findAllByText('ไม่มีสิทธิ์ดู')).toHaveLength(2);
  expect(screen.getByText('จำนวนบิล')).toBeInTheDocument();
  expect(screen.getByText('จำนวนรายการ')).toBeInTheDocument();
  ```
- [ ] **2. รัน:** `npm test --workspace=@installment/web -- src/pages/ImportedSalesPage.test.tsx` → FAIL แล้ว implement โดยใช้ controls/query/error pattern เดิม ไม่เพิ่มระบบจัดการนำเข้าบน UI และไม่เปลี่ยน SHOP/FINANCE navigation
- [ ] **3. เขียน E2E** fixture ใช้ API จริงของ checkout/isolated DB: 2 บิลของ IMEI เดียว และหลายรายการหนึ่งบิล → ค้นได้ครบ ตรง summary; user ไม่มีสิทธิ์เงินไม่เห็นใน UI หรือ response; หน้าจอ desktop/mobile ไม่มี overflow ที่ทำให้ค้นไม่ได้
- [ ] **4. รัน component/API tests + `npm run local:check`** แล้วเปิด backend เต็มของ checkout ที่ชี้ isolated DB และรัน `npm run test:e2e --workspace=@installment/web -- e2e/imported-sales-cutover.spec.ts`; config E2E ต้อง fail ถ้า BASE_URL ไม่ใช่ local server ที่ task สร้าง ไม่ใช้ preview Inbox มาอ้างว่าหน้า imported-sales ผ่าน
- [ ] **5. Commit:** `feat: make Tooltify sales history searchable after cutover`

### Task 9: ย้อนคืนเฉพาะ batch และพิสูจน์ crash/retry/concurrency

**Files:** Create `apps/api/src/cli/tooltify-cutover/rollback.ts`, `__tests__/rollback.integration.spec.ts`, `__tests__/cutover-flow.integration.spec.ts`; Modify `tooltify-cutover.cli.ts`, `batch.ts`; Reference `apps/api/src/modules/products/product-hold.util.ts`, `apps/api/src/cli/stock-go-live/wipe-stock-go-live.ts` (เพื่อสำรวจ references เท่านั้น ไม่เรียก wipe)

**Interfaces:** `planRollback(db,batchId): Promise<RollbackPlan>` คืน created target IDs, fingerprints, active refs, blockers; `applyRollback(db,plan): Promise<RollbackReceipt>` revalidates/locks ก่อนเขียน ถ้าพบ blocker ให้หยุดทั้ง rollback plan ก่อน mutation ไม่ย้อนบางส่วนเงียบ ๆ

- [ ] **1. เขียน DB tests:** CREATE products/prices soft-delete ด้วยเวลารอบเดียวกัน; MATCH ไม่ถูกแตะ; ImportedSale ลบเฉพาะ IDs ที่ item CREATE ผูกอยู่ตาม immutable import exception; batch item เก็บ tombstone/provenance; rollback ซ้ำเป็น no-op; batch ที่ย้อนแล้ว apply เดิมต้อง explicit error ให้สร้าง inspected new run ไม่ restore เงียบ
- [ ] **2. ทดสอบ used/changed:** Product มี Sale/Contract/hold/StockTransfer/stock count/adjustment/PO reference หรือ fingerprint เปลี่ยนต้อง block; สร้าง reference ระหว่าง rollback plan กับ apply ต้อง block ผ่าน transaction lock/recheck; concurrent writer เขียน refs ต้องไม่ลอดก่อน soft-delete (พิสูจน์กับ writer จริง ถ้าล็อกเดิมไม่พอต้องใช้หน้าต่าง freeze ที่ตรวจได้ ไม่อ้างรับประกัน online rollback)

  Assertion ของ test `blocks_rollback_after_real_use` เมื่อ plan เสร็จแล้ว fixture สร้าง Sale อ้าง Product ผ่าน service จริง:
  ```ts
  await expect(applyRollback(db, rollbackPlan)).rejects.toThrow('TARGET_IN_USE');
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).deletedAt).toBeNull();
  ```
- [ ] **3. รัน harness → FAIL แล้ว implement** ล็อก targets ตาม id ลำดับเดียวกันและ revalidate references ทุกโมเดลที่ตรวจพบใน schema; rollback สำเร็จทำ target+item+batch state ใน transaction ไม่เรียก hard-delete Product หรือ prefix wipe; รายงานหลัง G ว่า manual reconciliation required ไม่เสนอ restore ทั้งฐาน
- [ ] **4. E2E import flow ใน isolated DB:** inspect/canonicalize → dry-run ไม่เขียน → apply crash หลัง N → resume → reconcile 0 delta → retry 0 extra → rollback คืนเฉพาะของรอบนี้; ยืนยัน template price change หลัง dry-run ถูกปฏิเสธและ rerun ไม่ทับธุรกรรมใหม่
- [ ] **5. รัน:** `bash tools/test-db-vitest.sh src/cli/tooltify-cutover/__tests__/rollback.integration.spec.ts src/cli/tooltify-cutover/__tests__/cutover-flow.integration.spec.ts` → PASS; commit `feat: safely reverse and resume Tooltify import batches`

### Task 10: ซ้อม เตรียม runbook และตรวจรับก่อนวันตัดระบบ

**Files:** Create `docs/guides/tooltify-cutover-runbook.md`; Update source-decisions และ spec เฉพาะข้อสรุปที่มีหลักฐาน; เก็บ rehearsal artifacts นอก Git ใน private output directory ที่เลือกตอนรัน

**Interfaces:** runbook รับ manifestHash/planHash/codeRevision/database fingerprint, T (หยุด Tooltify), G (เปิด BESTCHOICE), owner/operator/stock checker/accounting checker, verified backup ID/restore evidence และ actual timings จาก rehearsal ห้าม hardcodeวันเปิดใช้หรือ duration ก่อนวัด

- [ ] **1. ซ้อมบน isolated DB สภาพแทน production** รวมกรณีมีสินค้าเดิม: เปรียบเทียบ schema/index/price templates/branch mapping กับ production แบบ read-only; ใช้ข้อมูลจริงเฉพาะพื้นที่ที่อนุญาต/จำกัดสิทธิ์ ไม่มีการส่งออก PII ผ่านเครื่องมือที่ปิดบังข้อมูล ถ้าต้องย้ายข้อมูลอ่อนไหวให้ใช้กระบวนการภายในที่ได้รับสิทธิ์
- [ ] **2. ทำ rehearsal report:** counts/เงินแยก raw/canonical/target, exceptions, สินค้า/ราคา/สาขา, รายเดือน/ช่องทาง, UI ค้น IMEI/เลขบิล, ขายเครื่องนำเข้าในฐานทดสอบและตรวจต้นทุน/สต๊อก, retry/rollback, เวลาที่ใช้จริงทุกขั้น; unexplained delta ต้อง 0; ยอดเปิดบัญชีต้องมีตารางเทียบทุนที่เคยรับรู้แล้วกับทุนที่ยังไม่ได้รับรู้ก่อน go-live ไม่โพสต์ซื้อย้อนหลังเอง
- [ ] **3. เขียน runbook แบบปฏิบัติตามลำดับ:** (a) ระบุผู้ตรวจและเวลาหยุดสูงสุดจาก rehearsal (b) สำรองและทดสอบกู้คืนก่อนวันย้าย (c) ที่ T หยุดการเปลี่ยน stock ทั้งสองระบบรวมช่องทางเว็บ/จองที่เกี่ยวข้อง ใช้เลขทะเบียนรายการชั่วคราวสำหรับข้อยกเว้น (d) export สุดท้าย/ตรวจ checksum และ coverage (e) dry-run ใหม่กับฐานจริงและสรุป reviewable report (f) เมื่ออนุญาตการนำเข้ารอบนั้นแล้วจึง apply (g) reconcile/ค้นตัวอย่าง/ตรวจยอดเปิด/งานค้าง (h) เปิดที่ G แล้วลงทะเบียนชั่วคราวครั้งเดียว (i) ตรวจสิ้นวันและวันที่ 7
- [ ] **4. กำหนด stop/rollback:** ก่อน G ถ้าข้อมูลไม่ครบ/ราคาไม่พร้อม/delta ไม่ผ่าน/เกินหน้าต่าง ให้ไม่เปิดขายและใช้ rollback ที่ซ้อมแล้ว; หลัง G ถ้ามีธุรกรรมจริงต้องระงับเฉพาะรายการและปรับอย่างมีหลักฐาน ห้าม restore backup ทับ; ยกเลิก subscription Tooltify หลัง archive ค้นเอกสารได้และงานค้างทั้งหมดมีผู้รับช่วงเท่านั้น ไม่ยกเลิกอัตโนมัติตามผ่านไป 7 วัน
- [ ] **5. ตรวจ release package:** targeted tests ของทุก task ผ่าน, typecheck/local preview ผ่าน, full import/POS/history verification มีหลักฐาน, runbook ระบุ version/hash และ backupจริง; commit `docs: add verified Tooltify cutover runbook` และส่งรายงานพร้อม URL local ที่ตรวจแล้วให้เจ้าของ ขั้นนี้ไม่รวม merge/deploy/write production/cancel subscription

## ลำดับและผลส่งมอบ

`1 → (2,3) → 4 → (5,6) → 9 → 10` และ `7 → 8 → 10`; Tasks 7–8 ทำได้เมื่อ schema decision Task 4 ชัดเจน ทุกขั้นยังอยู่ในแผนเดียวเพื่อใช้ canonical manifest/provenance เดียว ไม่เปิดขาย stock ก่อน sales coverage และงานค้างผ่านเกณฑ์ cutover

| Milestone | เจ้าของจะตรวจอะไร |
|---|---|
| M1 หลัง Task 1 | รายการไฟล์/ช่วงที่ขาด/งานค้าง/รายการต้องตัดสิน ไม่ต้องอ่านโค้ด |
| M2 หลัง Tasks 2–6 | dry-run บอกเพิ่ม/ตรงเดิม/ชน/ยกเว้น พร้อมยอดก่อน–หลังและเหตุผลรายแถว |
| M3 หลัง Tasks 7–9 | local ค้น IMEI/บิลได้ ซ้อมนำเข้า/ขาย/รันซ้ำ/ย้อนคืนผ่าน |
| M4 หลัง Task 10 | runbook และชุดข้อมูลสุดท้ายที่พร้อมทบทวนเพื่อกำหนดวันย้าย |

## Self-review ก่อนส่งแผน

- Spec §1–4 / IMEI / scope / source reality → Tasks 1–3, 5; ประวัติ read-only และรับช่วงงานค้าง → Tasks 1, 6, 10
- Spec §5 / identity / batch / dry-run → Tasks 1–6; การเปลี่ยน unique key มี evidence gate ไม่อ้างว่าคู่ Accessories เป็น IMEI ซ้ำ
- Spec §6–8 / cutover / acceptance / rollback → Tasks 9–10; stop date/cancel date แยกกันและไม่มี blanket restore หลัง G
- Spec §9–10 / builder decisions → signatures/files ในแต่ละ task และ source-decisions; ราคากลางใช้ existing helpers ไม่เพิ่ม service ใหม่
- Review Focus ทั้ง 5 ข้อมี tests ใน tasks ที่ระบุ; API/UI covered รวม null sensitive money และวันที่ขอบเดือน
- Type consistency: FileRef/SourceRef/InputManifest/CanonicalInput/ImportPlan เป็น shared types; callback writer ใช้ TransactionClient เดียวกัน; amount เป็น string/Decimal; DTO/query/summary API/UI เพิ่มพร้อมกัน
- Verification commands อ้าง scripts ที่มีจริง (`test-db-vitest.sh`, `test-employee-access-tender-imported.sh`, `local:check`); ยังไม่ได้รัน tests ที่แผนจะสร้างและไม่อ้างว่า implementation ผ่านแล้ว

**สถานะแผน:** พร้อมให้ลงมือทีละ task หลังเลือกวิธีดำเนินงาน; task checkboxes ทั้งหมดตั้งใจยังว่าง เพราะรอบนี้สร้างแผนเท่านั้น
