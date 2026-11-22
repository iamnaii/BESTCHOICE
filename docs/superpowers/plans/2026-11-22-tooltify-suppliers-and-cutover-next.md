# Tooltify Suppliers and Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** นำผู้จัดจำหน่ายตามข้อมูลที่ยืนยันแล้วมาผูกกับสต๊อก และเตรียมการย้ายประวัติขาย/เปิดใช้ BESTCHOICE ต่อจากงานเดิมโดยไม่สร้างข้อมูลหรือยอดเงินซ้ำ

**Architecture:** ต่อขยาย CLI และ provenance ของ Tooltify เดิม ไม่สร้างระบบนำเข้าใหม่ ใช้ Excel v4 เป็นข้อมูลต้นทางส่วนตัว → ตรวจและสร้าง manifest ผู้ขาย → dry-run ผู้ขาย → นำเข้าผู้ขาย → plan สต๊อกใหม่โดยอ้าง target ID ของผู้ขาย → สต๊อกและประวัติขาย → กระทบยอดก่อนเปิดใช้จริง ทุกการเขียนใช้ transaction และตรวจว่าข้อมูลเปลี่ยนจากแผนหรือไม่

**Tech Stack:** TypeScript, NestJS, Prisma/PostgreSQL, parser Excel ที่มีอยู่; openpyxl ใช้เฉพาะจัดข้อมูลประกอบ

**Spec:** `docs/superpowers/specs/2026-11-22-tooltify-suppliers-followup-design.md` ร่วมกับแบบ cutover 21 พ.ย. และ stock-total 22 พ.ย.

## Global Constraints

- VAT: SUP006/SUP007=true; อีก 10=false ตามเจ้าของ; APPLE หมายถึง Apple Flagship ต่างจาก Apple Exchange
- เครดิต: SUP006=15; อีก 11=1; ไม่แก้ธุรกรรมเก่า
- คง 12 กลุ่ม/รหัส SUP และเก็บชื่อเดิมทั้งหมด; ห้ามผูก Apple หลายแพลตฟอร์มกับเลขภาษี Shopee โดยอัตโนมัติ
- ห้ามเดาประเภทผู้ขาย/โทรศัพท์/เลขภาษี/บัญชี; ข้อมูลไม่ครบให้รายงานเป็น issue พร้อมรายการที่ได้รับผลกระทบ
- IMEI เป็นตัวเครื่อง ไม่ใช่ key ของเหตุการณ์ขาย; หน่วยเงินใช้ Decimal; เวลา Asia/Bangkok
- ไม่สร้างการซื้อ หนี้ รับเงิน หรือ journal ใหม่จากข้อมูลย้อนหลัง
- Production writes ณ การจัดทำแผนนี้ = 0; การทดสอบ DB ใช้ฐานแยก และต้องตรวจ local preview เมื่อมีการแก้โค้ด
- ข้อมูลจริงและ artifact ที่มี PII อยู่พื้นที่ส่วนตัว ไม่อยู่ใน git; ใช้ข้อมูลสังเคราะห์ใน tests

## Review Focus

1. ผู้ขายจด VAT แต่บิลไม่มี VAT/เป็นใบอย่างย่อ: master flag เปลี่ยนได้โดยไม่สร้าง VAT entry (Task 1/3)
2. ชื่อบัญชีต่างจากชื่อผู้ขาย: Contact ต้องเป็นผู้ขาย ไม่ใช่ผู้รับโอน (Task 3)
3. Apple alias มาจากต่างช่องทาง: ต้องพักการจับคู่ตัวตนหากไม่ทราบช่องทาง ไม่ใช้ Scommerce ครอบทุกบิล (Task 1/4)
4. สินค้า/ผู้ขายเดิมเปลี่ยนหลัง dry-run หรือมีคำสั่งซื้อหลังนำเข้า: หยุด apply/rollback แทน overwrite (Task 2/3/4)
5. IMEI ขายหลายรอบและหลายบิลใช้เลขเดียวกัน: เก็บเหตุการณ์แยก ไม่ตัดซ้ำตาม IMEI/เลขบิลอย่างเดียว (Task 5)

## สถานะที่ตรวจจากโค้ด

- `apps/api/src/modules/suppliers/suppliers.service.ts:92` สร้าง Supplier, paymentMethods และ Contact ใน transaction เดียว ต้องรักษาพฤติกรรมนี้ใน importer
- `apps/api/prisma/schema.prisma:2004` Supplier มี `hasVat`, type เริ่มต้น JURISTIC, phone บังคับ; เครดิตอยู่ SupplierPaymentMethod (`:2059`) ไม่ใช่คอลัมน์ Supplier
- `apps/api/src/cli/tooltify-cutover/stock-writer.ts:29` สร้าง Product แต่ยังไม่ส่ง supplierId; การใส่ Excel อย่างเดียวจึงยังไม่เกิดลิงก์จริง
- `apps/api/src/cli/tooltify-cutover/types.ts:183` และ batch/rollback แยก STOCK/SALES ต้องเพิ่ม SUPPLIER อย่างชัดเจนทุกจุด ไม่ปล่อยให้ ternary ส่งไปทาง SALES
- `apps/api/prisma/schema.prisma:9608` legacy sales unique ยังเป็น source+barcode+orderNumber+soldAt; `plan.ts:40` ตรวจ index ชื่อนี้ด้วย การรองรับหลาย occurrence ต้องเปลี่ยน schema และ runtime gate ร่วมกันหลังมีหลักฐาน

## Task 1: แปลง Excel v4 เป็นชุดผู้ขายพร้อมตรวจข้อมูล

**Files:** Create `apps/api/src/cli/tooltify-cutover/supplier-input.ts`, `supplier-types.ts`, `__tests__/supplier-input.spec.ts`; Modify `apps/api/src/cli/tooltify-cutover.cli.ts`.

**Interfaces:** `readSupplierWorkbook(path: string): Promise<SupplierInput[]>`; `validateSupplierInputs(rows: SupplierInput[]): SupplierValidation` โดย SupplierInput ระบุ supplierRef, aliases, displayName, legalName/type/phone ที่ nullable, hasVat, creditTermDays, bankAccounts, legalProfileScope และ evidenceRefs; SupplierValidation คืน `{rows, issues}`. ปัญหาแต่ละข้อมี supplierRef/code/field/evidenceRef. ข้อมูลที่ไม่ทราบต้องคง null.

- [x] อัปเดต Excel v4 และ `supplier-policy-v4.json`; ตรวจ VAT 2/10 และเครดิต 15/1 รวม 12 ราย โดยไฟล์เดิมและเลขบัญชีไม่เปลี่ยน
- [ ] เพิ่ม failing tests: 12 supplierRef ไม่ซ้ำ; VAT true เฉพาะ SUP006/SUP007; เครดิต 15 เฉพาะ SUP006; synthetic บัญชีขึ้นต้น 0 เป็น string; ประเภทไม่ทราบออก `SUPPLIER_TYPE_REQUIRED`; phone ไม่มีออก `SUPPLIER_PHONE_REQUIRED`; Apple profile ข้ามช่องทางออก `SUPPLIER_LEGAL_SCOPE_UNRESOLVED`
- [ ] รัน `npm test --workspace=@installment/api -- --runTestsByPath src/cli/tooltify-cutover/__tests__/supplier-input.spec.ts` ให้เห็นความล้มเหลวก่อน implement
- [ ] Implement reader และ validator โดยใช้ alias mapping ที่เจ้าของยืนยันเท่านั้น ห้าม fuzzy merge หรือใช้ hasVat=false อนุมานว่าเป็นบุคคล
- [ ] เพิ่ม CLI `supplier-inspect --workbook <private.xlsx> --out-dir <private-dir>` ที่สร้าง supplier-input.json และ supplier-issues.csv แบบ read-only; ไม่เชื่อม DB ในคำสั่งนี้
- [ ] รัน test เดิมให้ผ่านและตรวจไฟล์จริง: input 12 ราย, alias ตรง v4, missing fields แสดงครบ; commit เฉพาะโค้ด/fixture สังเคราะห์

**Deliverable:** manifest ผู้ขายที่อ้าง SHA256 ของ workbook พร้อมรายการข้อมูลขาด รายที่ยังขาดไม่ถูกสร้าง แต่ไม่ขัดขวางการเตรียมแถวอื่น

## Task 2: เพิ่ม provenance และแผนผู้ขายใน CLI เดิม

**Files:** Modify `apps/api/prisma/schema.prisma`, `apps/api/src/cli/tooltify-cutover/{types,plan,batch,plan-targets,reconcile,rollback,rollback-references}.ts`, `apps/api/src/cli/tooltify-cutover.cli.ts`; Create `apps/api/prisma/migrations/20261122000000_tooltify_supplier_provenance/migration.sql`, `apps/api/src/cli/tooltify-cutover/supplier-plan.ts`, `__tests__/supplier-plan.integration.spec.ts`.

**Interfaces:** `planSuppliers(db: PrismaClient, input: SupplierInput[], context: SupplierPlanContext): Promise<SupplierImportPlan>`; context มี canonicalSetId, workbookSha256, codeRevision, accessCompanyCode='SHOP', accessBranchId, cutoverAt. SupplierImportPlan เป็น ImportPlan branch `kind:'SUPPLIER'` พร้อม items แบบ PlannedSupplierItem (supplierRef, payload, disposition, targetId, dependencyFingerprint, reason). คงรูปแบบ planHash/dbIdentity เดิม

- [ ] อ่าน workflow Prisma ก่อน schema change; เพิ่ม failing tests สำหรับ SUPPLIER batch + receipt, MATCH ผู้ขายเดิมที่ยืนยัน targetId, CONFLICT คนละชื่อแต่บัญชีเดียว, และ unknown kind ต้องปฏิเสธ
- [ ] รันผ่าน `bash tools/docs-integration.sh --runInBand --runTestsByPath src/cli/tooltify-cutover/__tests__/supplier-plan.integration.spec.ts` เพื่อยืนยัน failure บนฐานแยก
- [ ] เพิ่ม enum SUPPLIER ใน TooltifyImportKind/TooltifyTargetType และแก้ constraint/trigger ของ migration เดิมที่ whitelist kind/target; ไม่แก้ schema Supplier เพื่อกลบข้อมูลที่ขาด
- [ ] ทำ dispatch แบบ explicit ตาม kind ทุกจุดใน plan/batch/reconcile/rollback; canonicalSetId+kind และ receipt key คง uniqueness เดิม; supplier identity เป็น SUP reference ใน source namespace ไม่ใช่ชื่อหรือบัญชี
- [ ] ให้แผนอ่านผู้ขาย active/inactive/deleted รวม Contact/paymentMethods; MATCH ต้องมีหลักฐาน targetId หรือ verified legal identity พร้อม scope; ข้อมูลต่างเป็น CONFLICT ไม่อัปเดตเดิมอัตโนมัติ; hash ครอบ aliases/VAT/credit/payment/legal scope/company/branch
- [ ] เพิ่ม `supplier-plan --input <json> --out-dir <dir>`; รันทดสอบเดิมและ supplier-plan ให้ผ่าน; ทดสอบ migration บนฐานเก่าและฐานใหม่; commit

## Task 3: เขียนผู้ขายพร้อม Contact/การชำระ และย้อนกลับอย่างปลอดภัย

**Files:** Create `apps/api/src/cli/tooltify-cutover/supplier-writer.ts`, `__tests__/supplier-writer.integration.spec.ts`; Modify `apps/api/src/modules/suppliers/suppliers.service.ts`, Create `apps/api/src/modules/suppliers/create-supplier-in-transaction.ts`; Modify batch/rollback/rollback-references/CLI จาก Task 2.

**Interfaces:** `writeSupplierItem(tx: Prisma.TransactionClient, item: PlannedSupplierItem): Promise<TargetWriteResult>` ใช้ signature แบบ writer เดิม; extract helper `createSupplierInTransaction(tx, dto: CreateSupplierDto, context: SupplierCreationContext)` จาก service เดิม โดย context มี explicit SHOP/branch และ ContactResolver dependency. ทั้ง service และ importer เรียก helper เดียวกัน

- [ ] เพิ่ม failing tests: create Supplier+Contact+credit+bank+receipt atomic; crash/retry ไม่เพิ่มรายการ; bank holder คนละชื่อไม่สร้าง Contact แทน vendor; VAT 2/10 ไม่เพิ่ม tax/journal rows; permission scope ข้ามบริษัทต้องถูกปฏิเสธ
- [ ] รัน `bash tools/docs-integration.sh --runInBand --runTestsByPath src/cli/tooltify-cutover/__tests__/supplier-writer.integration.spec.ts` ให้ fail ก่อน implement
- [ ] สร้าง payment method `CREDIT` เป็น default พร้อม creditTermDays ตาม owner; บัญชีที่ครบสร้าง BANK_TRANSFER แยกและไม่ default; ช่อง bank ที่ไม่มีไม่ต้องสร้าง placeholder; รักษา service เดิมสำหรับผู้ใช้ทั่วไป
- [ ] เพิ่ม `supplier-apply --plan <reviewed-plan.json>` โดยผ่าน applyBatch และตรวจ planHash/dbIdentity/dependency ซ้ำใน transaction; CREATE เท่านั้นที่เขียน, MATCH ไม่แก้ข้อมูล
- [ ] เพิ่ม rollback test: ผู้ขายใหม่ที่ไม่มี reference ย้อนกลับได้; ผู้ขายเดิม MATCH ไม่ถูกลบ; ผู้ขายที่มี PO/Product/repair/expense หรือถูกแก้หลังนำเข้าถูกบล็อก; Contact ที่สร้างร่วมให้ soft-delete เฉพาะไม่มี reference ใหม่ และคง receipt/audit
- [ ] รัน supplier writer/plan และ supplier service regression ให้ผ่าน; commit

## Task 4: ผูก Product กับ supplier ของรอบรับเข้าที่ถูกต้อง

**Files:** Modify `apps/api/src/cli/tooltify-cutover/{types,source-input,plan,plan-targets,stock-writer,rollback,reconciliation-snapshot}.ts`; Create `supplier-link.ts`, `__tests__/supplier-link.spec.ts`; Extend `__tests__/stock-writer.integration.spec.ts`.

**Interfaces:** `resolveSupplierLink(source: SourceRef, rawSupplierLabel: string | null, channel: string | null, registry: SupplierRegistry): SupplierLinkResult`; Registry entries มี supplierRef, aliases, targetId, legalScope, targetFingerprint และ sourceReceipt; result = `{status:'RESOLVED', supplierRef,targetId,fingerprint}` หรือ `{status:'NO_SUPPLIER',reason,evidenceRef}` หรือ `{status:'BLOCKED',code}`. StockResolution เพิ่ม supplierLink และ dependency hash รวมข้อมูลนี้

- [ ] เพิ่ม failing tests: alias ที่ยืนยันเลือก target ถูก; generic/self-buy ไม่มี vendor โดยมี explicit evidence; unknown label บล็อก; IMEI รับเข้าหลายรอบใช้ source row รอบนั้น; Apple ไม่ทราบ channel บล็อก; target เปลี่ยนหลัง plan บล็อก
- [ ] รัน unit test supplier-link และ stock-writer integration บนฐานแยกให้ fail ก่อน implement
- [ ] Implement link และส่ง supplierId เข้า Product.create; MATCH สินค้าเดิมที่ supplier ไม่ตรงเป็น CONFLICT ไม่เขียนทับ; provenance เก็บ raw label และ evidenceRef; ไม่ใช้ supplier จากประวัติขายมาแทนรอบรับเข้า
- [ ] หลัง supplier-apply สร้าง stock plan ใหม่จาก target IDs/fingerprints จริง; ตรวจ final stock ราย known vendor ทุกแถวมี link หรือ issue อธิบายได้
- [ ] เพิ่ม rollback order test: stock ก่อน supplier; reference ใหม่จากงานขาย/รับเข้า/เอกสารบล็อก rollback; รัน tests ให้ผ่าน; commit

## Task 5: ปิดข้อยกเว้นข้อมูลจริงและรองรับประวัติขายครบ

**Files:** Update private `.tmp/tooltify-live-20261122/` manifests/row decisions/evidence; Extend `apps/api/src/cli/tooltify-cutover/__tests__/cutover-flow.integration.spec.ts`; หากหลักฐานยืนยัน distinct duplicate occurrences ให้ Modify `apps/api/prisma/schema.prisma`, `apps/api/src/cli/tooltify-cutover/{canonicalize,plan,plan-targets,batch,sales-writer,types}.ts`, parser `apps/api/src/modules/imported-sales/tooltify-sales-parser.ts`; Create migration `20261122000001_tooltify_sale_occurrence/migration.sql` และ `__tests__/sales-occurrence.integration.spec.ts`.

**Interfaces:** คง SourceDecision/SourceRef เดิมและเพิ่มเอกสารอ้างอิงรายแถว; กรณี distinct units ที่พิสูจน์แล้วใช้ `ImportedSale.sourceOccurrence: Int @default(1)` และ unique `[source,barcode,orderNumber,soldAt,sourceOccurrence]`; occurrence เป็นลำดับ stable ใน canonical set ที่มีหลักฐาน ไม่ใช่เลขแถวไฟล์ที่เปลี่ยนเมื่อ export ใหม่

- [ ] ตรวจ 21 กลุ่ม source key ซ้ำเทียบเอกสาร: DISTINCT_UNITS / REPORT_DUPLICATE / UNRESOLVED; ไม่บังคับให้ทุกคู่เป็นหน่วยแยกและไม่ลบซ้ำด้วย IMEI
- [ ] ก่อนเปิด occurrence>1 เพิ่ม failing DB tests: สองหน่วยบิลเดียวคงสองแถว, retry ไม่เพิ่ม, same IMEI ต่างบิลคงทุกเหตุการณ์, same bill ต่างเวลาไม่รวม, overlapping exports ไม่เพิ่มซ้ำ
- [ ] เมื่อมีหลักฐาน DISTINCT_UNITS ให้ทำ migration default=1 รักษาแถวเดิม และเปลี่ยน index guard `assertImportDatabase` รวม findUnique/create/canonical key ทุกเส้นทาง; ถ้ายังไม่มีหลักฐานคง gate UNRESOLVED และระบุผลใน issue report
- [ ] ปิด category/serial ของ iPad และ Apple Pencil สองแถว; legacy phone/category anomalies ใช้ evidence-bound exception เก็บ raw ไม่ดัด IMEI ให้ผ่าน
- [ ] กระทบยอดยอดขายรวมกับเงินรับจริงแยกรายงาน: pending transfer ไม่สร้าง receipt; ตรวจยอดต่างช่วงก่อนหน้า, zero-line bill 135 และ bill 433 ต่างเวลา โดยเก็บ header evidence ของบิลไม่มีรายการ
- [ ] รัน source review, sales writer/occurrence, cutover flow บนฐานแยกให้ผ่าน; เก็บจำนวนแถว จำนวนเหตุการณ์บิล หน่วย ต้นทุน ยอดขาย เงินรับ และส่วนต่างเป็นคนละค่า; commit เฉพาะโค้ด/fixture

## Task 6: ซ้อมทั้งชุดและกำหนดรอบตัดระบบ

**Files:** Update `docs/guides/tooltify-cutover-runbook.md`; เก็บ private `supplier-rehearsal/`, `final-cutover/` evidence ภายใต้ `.tmp/tooltify-live-20261122/`.

- [ ] ทดสอบผู้ขาย → สต๊อก → ประวัติขายบนฐานแยกด้วยข้อมูลจริงที่จำกัดสิทธิ์; จำนวนจริงที่ถูกบล็อกต้องอยู่ในรายงาน ไม่ประกาศครบเมื่อมี excluded/unresolved ที่ยังไม่ยอมรับ
- [ ] ทดสอบ replay ทั้งชุดไม่เพิ่มรายการ และ rollback order history → stock → supplier; existing rows, shared Contacts, และข้อมูลที่เกิดหลังนำเข้าต้องไม่ถูกลบ
- [ ] หลังแก้โค้ดรัน `npm run local:check`; เปิด preview จาก checkout นี้และตรวจหน้าผู้ขาย VAT/เครดิต/บัญชี, stock supplier, history IMEI ขายซ้ำ; เก็บผลจริงพร้อมข้อจำกัด simulation
- [ ] เตรียม backup และซ้อม restore ก่อนรอบจริง; ตรวจ branch/company scope และ schema/provenance ของ production อีกครั้ง ไม่ยึดจำนวนเดิม 2 suppliers/1,175 products ว่ายังปัจจุบัน
- [ ] ขอข้อมูลเวลาหยุดทำรายการจริง T และผู้รับผิดชอบหน้างานเมื่อพร้อมตัดระบบ; การอนุญาตย้ายมีแล้ว แต่ยังไม่มีเวลา freeze ที่ระบุ ห้ามสมมติว่าต้นทางหยุดเคลื่อนไหว
- [ ] ณ T หยุดรายการที่เปลี่ยนยอดในทั้งสองระบบตาม runbook และดึง final exports ใหม่พร้อม SHA256/cutover timestamp; บันทึกรายการคั่นช่วงเพื่อใส่หลังเปิดใช้ไม่ให้ตกหล่น
- [ ] สร้าง final plans ใหม่จาก snapshot และฐานปลายทางล่าสุด ตรวจทุก delta/conflict, apply ผู้ขาย → regenerate stock plan → สต๊อก → history ตาม runbook; ไม่ใช้แผนที่ target เปลี่ยนแล้ว
- [ ] หลัง apply ตรวจ supplier policy 2/10 และเครดิต15/1, stock counts/cost/prices/status/supplier, sales totals/coverage และ provenance; ผลต่างไม่ทราบสาเหตุต้องคงสถานะยังไม่เปิดใช้
- [ ] เปิด BESTCHOICE เป็นระบบหลักเมื่อผ่านเกณฑ์; เก็บ Tooltify/export แบบอ่านย้อนหลังจนสำรองและงานค้าง (ผ่อน/จอง/ซ่อม/เคลม/ประกัน) มีผู้รับช่วงครบ ไม่สั่งลบข้อมูลต้นทาง

## ลำดับและข้อมูลที่ยังต้องเติม

ทำ Task 1–4 ได้โดยไม่ต้องรอวันหยุดระบบ ส่วนการสร้าง supplier จริงยังต้องผ่านข้อมูลบังคับรายนั้น: ประเภท/ตัวตนผู้ขายที่ยังไม่ยืนยัน, โทรศัพท์ iStar/LUCKY/Apple Flagship/Apple Exchange/GFIN และขอบเขตตัวตน Apple หลายช่องทาง ดูรายการล่าสุดใน Excel v4 แท็บ “ข้อมูลที่ยังขาด” ห้ามถือว่าทุกรายพร้อมเพราะยืนยัน VAT แล้ว

Task 5 และการเตรียม backup/ซ้อมใน Task 6 ทำต่อได้พร้อมการเติมข้อมูลผู้ขาย ส่วนเวลา T เป็นข้อมูลหน้างานที่ต้องได้รับก่อนหยุดระบบ ไม่ใช่การขออนุญาตย้ายซ้ำ

## Scrutinize — ผลตรวจแผน

ทางที่เล็กกว่า: ใช้ Supplier/Contact/payment method และ CLI เดิม แทนสร้าง master ใหม่หรือกรอกซ้ำผ่าน UI 12 รอบ แต่ต้องเพิ่ม provenance เพราะการสร้างผ่าน UI อย่างเดียวไม่มี replay/rollback ของ batch

ช่องว่างสำคัญที่รวมในแผนแล้ว: stock writer ไม่ผูก supplier (Task 4); type default ทำให้ข้อมูลไม่ทราบกลายเป็นนิติบุคคล (Task 1); direct Prisma create ข้าม Contact resolver (Task 3); STOCK/SALES ternary ส่ง SUPPLIER ไปผิด branch (Task 2); occurrence index gate เดิมปฏิเสธ schema ใหม่ (Task 5).

**Verdict:** พร้อมใช้เป็นแผนพัฒนาและซ้อม; ยังไม่พร้อม apply ข้อมูลจริง เพราะข้อมูลบังคับผู้ขาย/ข้อยกเว้นแถว/เวลาตัดระบบยังไม่ครบ ไม่ได้รันทดสอบ implementation ใหม่ในรอบจัดทำแผนนี้

## Owner update — 22 November 2026, during execution
เจ้าของยืนยัน “3 ยึดตาม Shopee ได้เลย”: ใช้ชื่อบริษัท/เลขภาษี/สาขา/ที่อยู่ Shopee เป็น master ของ Apple Flagship ทั้งกลุ่ม แทนข้อกำหนดพักการจับคู่ข้ามช่องทางก่อนหน้านี้ คงหลักฐาน Shopee และการอนุญาตของเจ้าของ ไม่กล่าวว่าตรวจทุกแพลตฟอร์มแล้ว ใช้ workbook/policy v5 ล่าสุด Tests ต้องยอมรับ legalProfileScope=OWNER_ADOPTED_GROUP และยังปฏิเสธ scope ที่ไม่ได้ยืนยัน
