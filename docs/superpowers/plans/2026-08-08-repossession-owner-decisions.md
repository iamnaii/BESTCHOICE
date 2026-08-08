# Repossession Owner Decisions Implementation Plan (คำสั่งเจ้าของ 2026-08-08)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำตามคำตัดสินเจ้าของ 3 ข้อ (2026-08-08, supersede คำถาม CPA ใน `docs/accounting/cpa-questions-repossession-2026-08.md`): (1) ห้าม backdate การยึดข้ามเดือน (2) เงินคืนส่วนต่างลูกค้า: ตั้งหนี้ ณ วันยึดผ่านบัญชีใหม่ **21-1107 เจ้าหนี้เงินคืนลูกค้า-ยึดเครื่อง** ใน JP5 + ปุ่มจ่ายคืน (3) หน้าจอยึดเครื่องโชว์ทั้ง "กำไรเชิงบริหาร" และ "ผลทางบัญชี" พร้อมป้ายกำกับ — ไม่แตะโครง JE นอกเหนือจากข้อ 2

**Architecture:** ข้อ 2 อาศัยกลไก loss/gain plug ของ JP5 (`lossOrGain = ΣCr − ΣDr` ของบรรทัดก่อนหน้า) — เพิ่ม `Cr 21-1107 [customerRefund]` ก่อนคำนวณ plug ทำให้ขาดทุนเพิ่ม/กำไรลดเท่าเงินคืน**โดยอัตโนมัติ** ไม่ต้องแก้สูตร plug; การจ่ายคืนใช้ template ใหม่ `RefundPayoutTemplate` โครงเดียวกับ `ShopCollectSettlementTemplate` ทุกประการ (GL lens ตาม `metadata.contractId`, requestId idempotency, แปล P2002/P2034 → 409, Sentry บน P2034) แต่ทิศกลับ: `Dr 21-1107 / Cr เงินสด-ธนาคาร`

**Tech Stack:** NestJS+Prisma (apps/api), React (apps/web), jest (mocked) + vitest integration (DB จริง — local docker `installment-postgres` มี migrations+CoA แล้ว)

## Global Constraints

- Branch: `feat/repossession-owner-decisions-2026-08` (แตกจาก main แล้ว) — ห้ามแตะไฟล์ที่ PR #1398 กำลังแก้ (`shop-collect-settlement.template.ts`, `docs/accounting/cpa-questions-repossession-2026-08.md`, `menu.ts`, `debt-collection.spec.ts`)
- Error/UI messages ภาษาไทย; เงิน = `Prisma.Decimal`; ทุก query กรอง `deletedAt: null`; Prettier printWidth 100
- **JP5 goldens เดิมต้องไม่ขยับแม้แต่สตางค์เดียว** — บรรทัด 21-1107 เพิ่มเฉพาะเมื่อ `customerRefund > 0` ซึ่ง fixture เดิมไม่ส่ง
- คอมเมนต์การตัดสินใจใช้รูปแบบ `// คำสั่งเจ้าของ 2026-08-08 (ข้อ N): ...`
- ทดสอบ: jest `cd apps/api && npx jest src/modules/repossessions src/modules/journal --silent`; integration `npx vitest run --no-file-parallelism <file>`; types `./tools/check-types.sh all`
- จบทุก task: commit แยก; จบแผน: code-reviewer + รอเจ้าของ approve ก่อนเปิด PR

---

### Task 1: ห้าม backdate การยึดข้ามเดือน (ข้อ 3)

**Files:**
- Modify: `apps/api/src/modules/repossessions/repossessions.service.ts` (create(), หลัง `isFutureBkkDay` guard ~line 290-295)
- Modify: `apps/web/src/pages/PaymentsPage/components/RepossessionOverlay.tsx` (hint ใต้ช่องวันที่รับเงิน)
- Test: `apps/api/src/modules/repossessions/repossessions.service.spec.ts`

**Interfaces:**
- Consumes: `paymentDate` (มีอยู่แล้ว)
- Produces: BadRequestException ข้อความ `'วันที่รับเงินย้อนหลังได้เฉพาะภายในเดือนปัจจุบัน (ใบลดหนี้ต้องอยู่งวดภาษีเดียวกับ JE)'`

- [ ] **Step 1: เขียน failing tests** (ใน describe ของ create; ใช้ mock ชุดเดิม — เคสผ่านให้ payments ทั้งหมด PAID เพื่อเลี่ยง JP5 path เหมือนเทสต์ deletedAt เดิม; ใช้ jest fake timers หรือสร้างวันที่จากวันนี้จริง)

```ts
it('create() ปฏิเสธ paymentDate เดือนก่อนหน้า (ห้ามข้ามเดือน — คำสั่งเจ้าของ 2026-08-08 ข้อ 3)', async () => {
  const prevMonth = new Date();
  prevMonth.setDate(1);
  prevMonth.setDate(0); // วันสุดท้ายของเดือนก่อน
  await expect(
    service.create(
      {
        contractId: 'contract-1',
        repossessedDate: '2026-08-01',
        conditionGrade: 'B',
        appraisalPrice: 5000,
        paymentDate: prevMonth.toISOString(),
      },
      'user-1',
    ),
  ).rejects.toThrow('วันที่รับเงินย้อนหลังได้เฉพาะภายในเดือนปัจจุบัน');
});
```

(เคส "ภายในเดือนเดียวกัน ผ่าน" ให้ mock ครบตามแบบเทสต์ deletedAt เดิมและ assert ว่าไม่ throw ข้อความนี้)

- [ ] **Step 2: รันให้ fail** — `npx jest src/modules/repossessions -t "ห้ามข้ามเดือน" --silent` → FAIL

- [ ] **Step 3: Implement** — หลัง `isFutureBkkDay` guard:

```ts
    // คำสั่งเจ้าของ 2026-08-08 (ข้อ 3): ใบลดหนี้ (CN) ออกวันที่/เลขที่เดือนปัจจุบันเสมอ
    // → JE ต้องอยู่เดือนเดียวกัน ไม่งั้นงวด ภ.พ.30 ของ VAT reversal กับเอกสารแยกกัน
    const bkkMonth = (d: Date) =>
      d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
    if (bkkMonth(paymentDate) !== bkkMonth(new Date())) {
      throw new BadRequestException(
        'วันที่รับเงินย้อนหลังได้เฉพาะภายในเดือนปัจจุบัน (ใบลดหนี้ต้องอยู่งวดภาษีเดียวกับ JE)',
      );
    }
```

FE: ใต้ช่องวันที่รับเงินใน RepossessionOverlay เพิ่ม `<p className="text-xs text-muted-foreground leading-snug mt-1">ย้อนหลังได้ภายในเดือนนี้เท่านั้น</p>` (หา JSX ช่อง paymentDate ตาม state `paymentDate`)

- [ ] **Step 4: รันให้ผ่าน + types** — jest module + `./tools/check-types.sh all`
- [ ] **Step 5: Commit** — `fix(repossessions): ห้าม backdate การยึดข้ามเดือน — งวด ภ.พ.30 ของ JE กับใบลดหนี้ต้องตรงกัน (คำสั่งเจ้าของ 2026-08-08)` + Co-Authored-By trailer

---

### Task 2: เงินคืนลูกค้า — บัญชี 21-1107 + JP5 Cr line + RefundPayoutTemplate + endpoint + FE (ข้อ 2)

**Files:**
- Modify: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv` (แถวใหม่หลัง 21-1106, คอลัมน์ตามพี่น้อง: `21-1107,เจ้าหนี้เงินคืนลูกค้า-ยึดเครื่อง,หนี้สิน,Cr,เจ้าหนี้,ไม่,ตั้ง ณ วันยึดเมื่อราคากลาง > ยอดปิด (JP5) ล้างเมื่อจ่ายคืนลูกค้า,ใช้งาน` + comma padding เท่าแถวอื่น)
- Modify: `apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.ts` (input + บรรทัดใหม่ก่อน plug)
- Modify: `apps/api/src/modules/repossessions/repossessions.service.ts` (ส่ง customerRefund เข้า execute + previewJe; เมธอดใหม่ `refundPayment`)
- Create: `apps/api/src/modules/journal/cpa-templates/refund-payout.template.ts`
- Modify: `apps/api/src/modules/journal/journal.module.ts` (register+export template ใหม่), `apps/api/src/modules/repossessions/repossessions.module.ts` (ถ้าจำเป็นต่อ DI)
- Modify: `apps/api/src/modules/repossessions/repossessions.controller.ts` (POST :id/refund-payment), `apps/api/src/modules/repossessions/dto/refund-payment.dto.ts` (Create)
- Modify: `apps/web/src/pages/RepossessionsPage.tsx` (ปุ่ม+modal จ่ายเงินคืน)
- Modify: `.claude/rules/accounting.md` (ตาราง Liabilities + note ใน JP5 section)
- Test: jest ใน `repossessions.service.spec.ts`; integration ใหม่ `apps/api/src/modules/contracts/refund-payout.integration.spec.ts` (วางข้าง SCS spec — **ตรวจ glob ใน `.github/workflows/deploy-gcp.yml` ว่าไฟล์ `src/modules/contracts/*.integration.spec.ts` ถูกรวมใน vitest step; ถ้าไม่ ให้ขยาย glob ด้วย**)

**Interfaces:**
- Produces: `RepossessionInput.customerRefund?: Decimal`; `RefundPayoutTemplate.execute({ contractId, depositAccountCode, amount, requestId?, postedById? }, outerTx?) → { entryNo, deduped }`; `POST /repossessions/:id/refund-payment` body `{ depositAccountCode, amount, requestId? }` @Roles OWNER/FINANCE_MANAGER/ACCOUNTANT; `RefundPaymentDto` (@IsIn CASH_ACCOUNT_CODES จาก `constants/cash-account.constants`, @IsPositive amount, @IsUUID(4) @IsOptional requestId)

- [ ] **Step 1: JP5 — failing golden (integration หรือ jest ตามแบบ spec ที่มีอยู่ของ template)** — เคสใหม่: contract 17,000/12m ไม่ accrue, repossessionValue 20,000 (gain branch เดิม gain 1,810.00) + `customerRefund 1,810.00` → คาด: `Cr 21-1107 = 1,810.00` และ **gain (41-1102) หายเป็น 0** (plug ดูดซับพอดี); ทดสอบ loss branch: เคส Scenario-A-เดิม + refund 500 → loss plug 51-1102 เพิ่มขึ้น 500 พอดี; assert goldens เดิม (ไม่ส่ง refund) เท่าเดิมทุกสตางค์ — วางในไฟล์ spec เดียวกับ goldens JP5 ปัจจุบัน (`jp5-vat-split.spec.ts`, DB-backed vitest)
- [ ] **Step 2: รัน RED** — เคสใหม่ fail (ไม่มีบรรทัด 21-1107)
- [ ] **Step 3: Implement JP5** — ใน `RepossessionInput` เพิ่ม `/** เงินคืนส่วนต่างลูกค้า — ตั้งหนี้ ณ วันยึด (คำสั่งเจ้าของ 2026-08-08 ข้อ 2) */ customerRefund?: Decimal;` และใน buildJe หลัง clearing legs สุดท้าย ก่อนคำนวณ `lossOrGain`:

```ts
    // คำสั่งเจ้าของ 2026-08-08 (ข้อ 2): เงินคืนส่วนต่างลูกค้า — Cr เจ้าหนี้ 21-1107
    // วางก่อน plug → ขาดทุนเพิ่ม/กำไรลดเท่าเงินคืนโดยอัตโนมัติ (ไม่มีสูตรใหม่)
    if (input.customerRefund && input.customerRefund.gt(0)) {
      lines.push({
        accountCode: '21-1107',
        dr: zero,
        cr: input.customerRefund,
        description: `เงินคืนส่วนต่างลูกค้า ${input.customerRefund.toFixed(2)} ฿`,
      });
    }
```

service create(): ที่จุดเรียก `repossessionJP5Template.execute({...})` เพิ่ม `customerRefund: customerRefund.gt(0) ? customerRefund : undefined,`; previewCalculation: ใน `previewJe({...})` เพิ่มค่าเดียวกัน (ตัวแปร `customerRefund` คำนวณอยู่แล้วเหนือ journalPreview block — ย้ายการคำนวณขึ้นก่อนถ้าจำเป็น)
- [ ] **Step 4: GREEN + goldens เดิมไม่ขยับ** — รัน jp5 spec ทั้งไฟล์
- [ ] **Step 5: CSV + seeder + accounting.md** — เพิ่มแถว CSV; รัน `cd apps/api && npx tsx prisma/seed-coa-finance.ts` ไม่ต้อง (upsert อัตโนมัติตอน seed:coa/CI) — แค่ตรวจ loader test ผ่าน (`npx jest src/modules/journal -t coa --silent` ถ้ามี); accounting.md: เพิ่ม `| 21-1107 | เจ้าหนี้เงินคืนลูกค้า-ยึดเครื่อง |` ในตาราง Liabilities + หมายเหตุใน section JP5/RepossessionJP5Template ว่า template มี optional Cr 21-1107 + จ่ายคืนผ่าน RefundPayoutTemplate + จำนวนบัญชี FINANCE เดินตาม CSV (อย่าแก้เลข 110 เป็นค่าคงที่ — ระบุ "111 ณ 2026-08-08")
- [ ] **Step 6: RefundPayoutTemplate (TDD ผ่าน integration spec ใหม่)** — copy โครง `shop-collect-settlement.template.ts` (หลัง #1398 merge โครงจะมี P2034 แล้ว — **branch นี้แตกจาก main ที่ยังไม่มี #1398** ดังนั้น copy pattern จาก branch `fix/repossessions-followups-2026-08` โดยอ่านไฟล์: `git show fix/repossessions-followups-2026-08:apps/api/src/modules/journal/cpa-templates/shop-collect-settlement.template.ts`) แล้วสลับ: outstanding = ΣCr−ΣDr ของ 21-1107 (เจ้าหนี้คงค้าง), JE = `Dr 21-1107 / Cr depositAccountCode`, flow `'refund-payout'`, ข้อความไทย "ไม่มียอดเจ้าหนี้เงินคืนลูกค้าค้างจ่ายสำหรับสัญญานี้" / over-pay guard / requestId dedupe scoped contractId / P2002+P2034 → ConflictException + Sentry warning บน P2034; integration spec: seed contract → JP5 พร้อม refund → จ่ายคืนเต็ม → 21-1107 net 0; จ่ายเกิน → 400; requestId ซ้ำ → deduped; race 2-connection ไม่บังคับ (pattern พิสูจน์แล้วที่ SCS — ระบุใน comment)
- [ ] **Step 7: endpoint + DTO + FE** — controller `@Post(':id/refund-payment') @Roles('OWNER','FINANCE_MANAGER','ACCOUNTANT')` → service.refundPayment(id, user, dto): โหลด repo ผ่าน findOne(id, user) (branch scope ฟรี), ตรวจ `repo.customerRefundEnabled` จริง (`ไม่ได้ติ๊กคืนเงินส่วนต่างไว้ตอนยึด`→400), เรียก template ใน `$transaction` Serializable + AuditLog `REFUND_PAYOUT` (entity 'repossession', newValue: amount/depositAccountCode/requestId/deduped); FE: ปุ่ม "จ่ายเงินคืน" ในคอลัมน์ actions แสดงเมื่อ `canSettle && r.customerRefundEnabled && Number(r.customerRefund) > 0` เปิด Modal (โครงเดียวกับรับโอนหน้าร้าน: CashAccountSelect codes เต็ม `CASH_ACCOUNT_CODES` — import จาก CashAccountSelect ถ้า export ไว้ ไม่งั้นไม่ส่ง prop codes เพื่อใช้ default ทั้ง 6, prefill = customerRefund, requestId = crypto.randomUUID() ตอนเปิด)
- [ ] **Step 8: รันครบ** — integration ใหม่ + jp5 spec + jest repossessions/journal + types all + eslint FE
- [ ] **Step 9: Commit** — `feat(repossessions): เงินคืนส่วนต่างลูกค้า — ตั้งหนี้ 21-1107 ใน JP5 + จ่ายคืนผ่าน RefundPayoutTemplate (คำสั่งเจ้าของ 2026-08-08)` + trailer

---

### Task 3: จอโชว์ 2 เลขพร้อมป้ายกำกับ (ข้อ 1)

**Files:**
- Modify: `apps/web/src/pages/PaymentsPage/components/RepossessionOverlay.tsx` (การ์ด P&L ~line 463-493)

**Interfaces:**
- Consumes: `preview.journalPreview` (มีอยู่แล้วจาก GET /repossessions/preview — โครงจาก `RepossessionJePreview`: อ่านไฟล์ template หา field ขาดทุน/กำไร เช่น lines ที่ accountCode '51-1102'/'41-1102' หรือ field สรุป — ยึดตามโครงจริง)

- [ ] **Step 1: Implement** — ในการ์ด "บริษัทได้กำไร/ขาดทุน": เปลี่ยน label เป็น `กำไร/ขาดทุนเชิงบริหาร` + คำอธิบายเดิม; ใต้การ์ดเพิ่มแถวเล็ก:

```tsx
{/* คำสั่งเจ้าของ 2026-08-08 (ข้อ 1): โชว์เลขบัญชีคู่กับเลขบริหาร — สองเลขต่างกันได้
    (ส่วนลด/ราคากลาง อยู่เฉพาะมุมมองบริหาร; บัญชีรับรู้จากราคาตี + เงินคืน) */}
<div className="flex justify-between text-xs mt-2 px-3">
  <span className="text-muted-foreground">ผลทางบัญชี (ledger — จากราคาตี{refundEnabled ? ' หักเงินคืน' : ''})</span>
  <span className="font-medium text-foreground">{ledgerPl >= 0 ? '+' : ''}{ledgerPl.toLocaleString()} ฿</span>
</div>
```

โดย `ledgerPl` คำนวณจาก journalPreview: หา line 41-1102 (cr>0 → +cr) หรือ 51-1102 (dr>0 → −dr) — เขียน helper เล็กในไฟล์; ถ้า journalPreview เป็น null (ไม่มียอดค้าง) ให้ซ่อนแถวนี้
- [ ] **Step 2: Verify** — `./tools/check-types.sh web` + eslint ไฟล์
- [ ] **Step 3: Commit** — `feat(repossessions): จอยึดเครื่องโชว์กำไรเชิงบริหารคู่ผลทางบัญชี พร้อมป้ายกำกับ (คำสั่งเจ้าของ 2026-08-08)` + trailer

---

### ✋ Gate (จบแผน)

- [ ] jest + integration + types ทั้งหมดเขียว
- [ ] Dispatch `code-reviewer` ตรวจทั้ง branch — แก้ Critical/Important ก่อนไปต่อ
- [ ] **STOP — สรุปให้เจ้าของ approve → เปิด PR** (ระบุใน PR ว่า supersede คำถาม CPA + ถ้า #1398 merge แล้วให้ rebase ก่อนเปิด)
