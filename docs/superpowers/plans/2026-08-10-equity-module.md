# Equity Transaction Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เมนูบันทึกธุรกรรมส่วนของผู้ถือหุ้น 7 ประเภท (CAP_INIT/CAP_INC/CAP_DEC/DRAW/DIV_DEC/DIV_PAY/PRIOR_ADJ) + ทะเบียนผู้ถือหุ้น + ทะเบียนปันผล/ภ.ง.ด.2 + อัพเกรดงบ Equity เดิม ตาม spec `docs/superpowers/specs/2026-08-10-equity-module-design.md`

**Architecture:** module `equity` ใหม่เลียนโครง `other-income` ทุกชั้น — JE สร้างจาก pure-function builder ตัวเดียว โพสต์ผ่าน `JournalAutoService.createAndPost` (ได้ balance check ฟรี) + idempotency index เดิม + `validatePeriodOpen` + mirror-reverse pattern ของ interco. Workflow DRAFT→READY→POSTED→REVERSED, maker-checker opt-in ผ่าน SystemConfig (default OFF)

**Tech Stack:** NestJS + Prisma (`Prisma.Decimal` เท่านั้น) / React 18 + React Query + shadcn/ui + react-hook-form + zod (`standardSchemaResolver`)

## Global Constraints

- เงินทุกค่า = `Prisma.Decimal` (`@db.Decimal(12, 2)`) — ห้าม `Number()` ในเส้นทางคำนวณ; WHT ปัด `ROUND_HALF_UP` 2 ตำแหน่ง; การเทียบ 25% ใช้ `Decimal.gte` ตรงๆ ไม่มี float tolerance
- Error message ภาษาไทยทุก DTO/exception
- ทุก model: UUID id + `createdAt/updatedAt/deletedAt` (@map snake_case, @@map ชื่อตาราง) — ยกเว้นที่ระบุพร้อม `///` comment
- Soft delete เท่านั้น (ยกเว้น: ลบ+สร้าง `EquityShareholderLine` ใหม่ตอนแก้ร่าง — precedent interco updateBatch)
- Frontend: semantic tokens เท่านั้น (`bg-card`, `text-muted-foreground`, …) — ห้าม hex/gray; ไทยใช้ `leading-snug`; ทุก page ผ่าน `React.lazy` + `ProtectedRoute`; วันที่แสดงผลผ่าน `formatThaiDateShort`/`formatThaiDate` จาก `@/lib/date`
- Resolver ฟอร์ม = `standardSchemaResolver` จาก `@hookform/resolvers/standard-schema` (ไม่ใช่ zodResolver)
- companyId ของทุกเอกสาร/JE = FINANCE (ผ่าน `CompanyResolverService.getFinanceCompanyId(tx)`)
- JE metadata: `{ flow: 'equity', idempotencyKey: 'equity:<docId>' }` (reverse: `flow: 'equity-reverse'`, `idempotencyKey: 'equity-reverse:<originalJeId>'`) — index `journal_entries_idempotency_idx` ครอบให้อยู่แล้ว
- สิทธิ์: ดู/สร้าง/แก้/submit/withdraw/แนบไฟล์ = `OWNER, FINANCE_MANAGER, ACCOUNTANT` · post/reverse = `OWNER, FINANCE_MANAGER`
- `*.spec.ts` ธรรมดา = jest (รันใน `npm --prefix apps/api run test`) · `*.integration.spec.ts` = vitest เท่านั้น และ**ต้องเพิ่ม glob ใน deploy-gcp.yml** (Task 6) มิฉะนั้นไม่รันใน CI เลย

## File Map

| ไฟล์ | Task | หน้าที่ |
|---|---|---|
| `apps/api/prisma/schema.prisma` (แก้) | 1 | enums + 4 models + back-relations บน User/CompanyInfo |
| `apps/api/prisma/migrations/20260992000000_add_equity_module/migration.sql` | 1 | migration (สร้างผ่าน `prisma migrate dev`) |
| `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv` (แก้) | 1 | เพิ่ม 11-1310 |
| `apps/api/src/cli/wipe-accounting.cli.ts` (แก้) | 1 | ถ้อยคำ "expected 111" → เดินตาม CSV |
| `apps/api/src/modules/equity/equity-journal.builder.ts` + `.spec.ts` | 2 | pure JE builder + golden specs |
| `apps/api/src/modules/equity/equity-validation.util.ts` + `.spec.ts` | 3 | validation rules (pure) + specs |
| `apps/api/src/modules/equity/services/equity-doc-number.service.ts` | 4 | EQ-YYYYMMDD-NNNN advisory lock |
| `apps/api/src/modules/equity/dto/*.ts` | 4 | Create/Update/Post/Reverse/Preview/Shareholder DTOs |
| `apps/api/src/modules/equity/equity.service.ts` | 4, 5 | CRUD (4) + lifecycle post/reverse/GL guards (5) |
| `apps/api/src/modules/equity/equity.controller.ts` | 4, 5, 7 | endpoints |
| `apps/api/src/modules/equity/equity.module.ts` + `app.module.ts` (แก้) | 4 | wiring |
| `apps/api/src/modules/equity/__tests__/equity.integration.spec.ts` | 6 | vitest DB จริง |
| `.github/workflows/deploy-gcp.yml` (แก้) | 6 | `EQUITY_FILES` glob |
| `apps/api/src/modules/equity/services/equity-attachment.service.ts` + spec | 7 | S3 upload/download |
| `apps/api/src/modules/equity/services/equity-report.service.ts` | 8 | dividend register |
| `apps/api/src/modules/tax/*` (แก้) | 8 | PND2 preview + XLSX form |
| `apps/api/src/modules/accounting/general-ledger-report.service.ts` (แก้) | 9 | capitalStatus + caveat conditional |
| `apps/web/src/lib/equity.ts` + `equity.types.ts` | 10 | api client + types |
| `apps/web/src/pages/equity/EquityListPage.tsx` | 10 | hub: list + tab ผู้ถือหุ้น |
| `apps/web/src/App.tsx`, `config/menu.ts`, `components/CommandPalette.tsx` (แก้) | 10 | routes + เมนู + palette |
| `apps/web/src/pages/equity/EquityEntryPage.tsx` | 11 | wizard 3 ขั้น |
| `apps/web/src/pages/equity/EquityViewPage.tsx` | 11 | detail + post/reverse/แนบไฟล์ |
| `apps/web/src/pages/equity/DividendRegisterPage.tsx` | 12 | ทะเบียนปันผล + ภ.ง.ด.2 |
| `apps/web/src/pages/EquityStatementPage.tsx` (แก้) | 12 | capitalStatus cards |
| `.claude/rules/accounting.md` (แก้) | 13 | หัวข้อ Equity Module |

---

### Task 1: Prisma schema + migration + CoA CSV (11-1310)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_add_equity_module/migration.sql` (ผ่าน `prisma migrate dev`)
- Modify: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv`
- Modify: `apps/api/src/cli/wipe-accounting.cli.ts:132`

**Interfaces:**
- Produces: models `Shareholder`, `EquityDocument`, `EquityShareholderLine`, `EquityAttachment`; enums `EquityTxnType`, `EquityDocStatus`, `ShareholderType` — Task 2+ ใช้ผ่าน `@prisma/client`
- Produces: บัญชี `11-1310` ใน CoA (seeder อ่าน CSV อัตโนมัติ)

- [ ] **Step 1: เพิ่ม enums + models ใน schema.prisma**

วาง enums ไว้ท้ายกลุ่ม enum อื่น (ใกล้ `OtherIncomeStatus` ได้) และ models ไว้ท้ายไฟล์ ตาม convention:

```prisma
enum EquityTxnType {
  CAP_INIT
  CAP_INC
  CAP_DEC
  DRAW
  DIV_DEC
  DIV_PAY
  PRIOR_ADJ
}

enum EquityDocStatus {
  DRAFT
  READY // maker-checker opt-in (SystemConfig EQUITY_MAKER_CHECKER_ENABLED) — ไม่มี APPROVED ตามบทเรียน W5 other-income
  POSTED
  REVERSED
}

enum ShareholderType {
  INDIVIDUAL // บุคคลธรรมดา — WHT ปันผล 10% (ม.50(2))
  JURISTIC_TH // นิติบุคคลไทย — ไม่หัก (ม.65 ทวิ(10))
  JURISTIC_FOREIGN // นิติบุคคลต่างชาติ — default 10% แก้ได้ตาม DTA
}

model Shareholder {
  id       String          @id @default(uuid())
  name     String
  taxId    String?         @map("tax_id") // เลขผู้เสียภาษี — ใช้ออก ภ.ง.ด.2
  shares   Int             @default(0)
  sharePct Decimal?        @map("share_pct") @db.Decimal(5, 2)
  type     ShareholderType @default(INDIVIDUAL)
  note     String?
  isActive Boolean         @default(true) @map("is_active")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  lines EquityShareholderLine[]

  @@index([isActive])
  @@map("shareholders")
}

model EquityDocument {
  id        String          @id @default(uuid())
  docNumber String          @unique @map("doc_number") // EQ-YYYYMMDD-NNNN (BKK)
  companyId String          @map("company_id") // FINANCE เสมอใน v1
  txnType   EquityTxnType   @map("txn_type")
  status    EquityDocStatus @default(DRAFT)

  txnDate     DateTime @map("txn_date") // วันที่ลง JE — ต้องอยู่ในงวดเปิด
  description String?

  // มติที่ประชุม — บังคับเมื่อ txnType ∈ NEEDS_RESOLUTION (V_RESOLUTION)
  resolutionNo   String?   @map("resolution_no")
  resolutionDate DateTime? @map("resolution_date")

  // ช่องทางเงิน — บังคับเมื่อ txnType ∈ NEEDS_PAYMENT (validate กับ CASH_ACCOUNT_CODES)
  paymentAccountCode String? @map("payment_account_code")

  // PRIOR_ADJ เท่านั้น
  paAccountCode String?  @map("pa_account_code")
  paAmount      Decimal? @map("pa_amount") @db.Decimal(12, 2)
  paDirection   String?  @map("pa_direction") // 'DR_OTHER_CR_RE' | 'DR_RE_CR_OTHER'

  makerId    String  @map("maker_id")
  approverId String? @map("approver_id") // null จนกว่า approve; maker=approver ได้เมื่อ MC ปิด

  // FK-by-value ไป JournalEntry (pattern InterCoSettlementBatch — ไม่แตะ JournalEntry model)
  journalEntryId        String? @unique @map("journal_entry_id")
  reverseJournalEntryId String? @unique @map("reverse_journal_entry_id")
  reverseReason         String? @map("reverse_reason") // ≥10 ตัวอักษร บังคับที่ DTO

  postedAt   DateTime? @map("posted_at")
  reversedAt DateTime? @map("reversed_at")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  company  CompanyInfo @relation(fields: [companyId], references: [id])
  maker    User        @relation("EquityDocMaker", fields: [makerId], references: [id])
  approver User?       @relation("EquityDocApprover", fields: [approverId], references: [id])

  lines       EquityShareholderLine[]
  attachments EquityAttachment[]

  @@index([txnType, status])
  @@index([status, createdAt(sort: Desc)])
  @@index([txnDate])
  @@index([deletedAt])
  @@map("equity_documents")
}

/// บรรทัดผู้ถือหุ้นของเอกสาร equity — แก้ร่าง = deleteMany แล้วสร้างใหม่ทั้งชุด
/// (precedent interco updateBatch: ปลอดภัยก่อน POSTED เพราะไม่มี JE อ้างถึง)
/// deletedAt intentionally omitted — replaced wholesale, ไม่มี soft-delete รายบรรทัด
model EquityShareholderLine {
  id              String @id @default(uuid())
  documentId      String @map("document_id")
  shareholderId   String @map("shareholder_id")
  shareholderName String @map("shareholder_name") // snapshot กัน history เพี้ยนเมื่อแก้ master
  lineNo          Int    @map("line_no")

  amount  Decimal @default(0) @db.Decimal(12, 2) // par (CAP_*) หรือจำนวนเงิน (DRAW/DIV_*)
  premium Decimal @default(0) @db.Decimal(12, 2) // CAP_INC เท่านั้น
  paid    Decimal @default(0) @db.Decimal(12, 2) // CAP_INIT เท่านั้น
  wht     Decimal @default(0) @db.Decimal(12, 2) // DIV_PAY เท่านั้น

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  document    EquityDocument @relation(fields: [documentId], references: [id], onDelete: Restrict)
  shareholder Shareholder    @relation(fields: [shareholderId], references: [id], onDelete: Restrict)

  @@unique([documentId, shareholderId]) // V_SH_UNIQUE ระดับ DB
  @@unique([documentId, lineNo])
  @@index([shareholderId])
  @@map("equity_shareholder_lines")
}

/// Append-only (pattern OtherIncomeAttachment) — updatedAt/deletedAt intentionally omitted;
/// ลบไฟล์ = hard delete แถว + ลบ S3 (DRAFT/READY เท่านั้น, service enforce)
model EquityAttachment {
  id           String   @id @default(uuid())
  documentId   String   @map("document_id")
  s3Key        String   @map("s3_key")
  filename     String
  size         Int
  mimeType     String   @map("mime_type")
  uploadedById String   @map("uploaded_by_id")
  createdAt    DateTime @default(now()) @map("created_at")

  document EquityDocument @relation(fields: [documentId], references: [id], onDelete: Restrict)

  @@index([documentId])
  @@map("equity_attachments")
}
```

- [ ] **Step 2: เพิ่ม back-relations**

บน `model User` (ใกล้ relation อื่นๆ เช่น `OtherIncomeCreatedBy`):

```prisma
  equityDocsMade     EquityDocument[] @relation("EquityDocMaker")
  equityDocsApproved EquityDocument[] @relation("EquityDocApprover")
```

บน `model CompanyInfo`:

```prisma
  equityDocuments EquityDocument[]
```

- [ ] **Step 3: สร้าง migration + generate**

Run (ต้องมี local DB ตาม `project_local_dev_setup`):
```bash
cd apps/api
npx prisma migrate dev --name add_equity_module
npx prisma generate
```
Expected: migration ใหม่ใต้ `prisma/migrations/`, generate ผ่าน, ไม่มี drift

- [ ] **Step 4: เพิ่ม 11-1310 ลง finance-coa.csv**

แทรก **ระหว่างบรรทัด 18 (`11-1203,...`) กับบรรทัด 19 (`11-21XX  กลุ่มลูกหนี้...`)** — 2 บรรทัด (group header 22 comma ท้าย / data row 14 comma ท้าย ตาม format เดิม):

```csv
11-13XX  กลุ่มลูกหนี้ค่าหุ้น,,,,,,,,,,,,,,,,,,,,,,
11-1310,ค่าหุ้นค้างชำระ (Unpaid Capital),สินทรัพย์,Dr,ลูกหนี้,ไม่,ลูกหนี้ผู้ถือหุ้น — ทุนจดทะเบียนส่วนที่ยังไม่เรียกชำระ (CAP_INIT) ล้างเมื่อรับชำระค่าหุ้น,ใช้งาน,,,,,,,,,,,,,,,
```

- [ ] **Step 5: แก้ข้อความ wipe-accounting.cli.ts:132**

เปลี่ยนส่วน `-- expected 111 (FINANCE — เดินตาม finance-coa.csv, ณ 2026-08-08)` เป็น `-- expected = จำนวนแถวใน finance-coa.csv (นับจาก CSV เสมอ — 2026-08-10 เพิ่ม 11-1310)`

- [ ] **Step 6: รัน spec ที่เกี่ยวกับ CSV/seed ให้เขียว**

```bash
cd apps/api
npx jest src/modules/journal/__tests__/csv-fixture-loader.spec.ts
npx vitest run prisma/seed-coa-finance.spec.ts
```
Expected: PASS ทั้งคู่ (loader floor ≥90; seed spec derive จาก CSV — ไม่มี count ตายตัว, ยืนยันจากการวิจัย 2026-08-10 ว่าไม่มี test ไหน assert 111)

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv apps/api/src/cli/wipe-accounting.cli.ts
git commit -m "feat(equity): schema 4 models + enums + บัญชี 11-1310 ค่าหุ้นค้างชำระ"
```

---

### Task 2: JE Builder (pure function) + golden specs — TDD

**Files:**
- Create: `apps/api/src/modules/equity/equity-journal.builder.ts`
- Test: `apps/api/src/modules/equity/equity-journal.builder.spec.ts`

**Interfaces:**
- Consumes: enum `EquityTxnType` จาก `@prisma/client` (Task 1)
- Produces: `buildEquityJournal(input: EquityBuilderInput): EquityJeLine[]` · `EQ_ACCOUNTS` const · types `EquityBuilderInput { txnType, paymentAccountCode?, paAccountCode?, paAmount?, paDirection?, lines: EquityBuilderLine[] }`, `EquityBuilderLine { amount, premium, paid, wht: Prisma.Decimal }`, `EquityJeLine { accountCode, dr, cr: Prisma.Decimal, description }` — Task 5 (post) + Task 5 (journal-preview) เรียกใช้

- [ ] **Step 1: เขียน failing spec (jest — golden ต่อ 7 ประเภท)**

```ts
// apps/api/src/modules/equity/equity-journal.builder.spec.ts
import { Prisma } from '@prisma/client';
import { buildEquityJournal, EQ_ACCOUNTS } from './equity-journal.builder';

const D = Prisma.Decimal;
const line = (over: Partial<{ amount: string; premium: string; paid: string; wht: string }> = {}) => ({
  amount: new D(over.amount ?? '0'),
  premium: new D(over.premium ?? '0'),
  paid: new D(over.paid ?? '0'),
  wht: new D(over.wht ?? '0'),
});
const sum = (ls: { dr: Prisma.Decimal; cr: Prisma.Decimal }[]) => ({
  dr: ls.reduce((s, l) => s.plus(l.dr), new D(0)),
  cr: ls.reduce((s, l) => s.plus(l.cr), new D(0)),
});
const byCode = (ls: ReturnType<typeof buildEquityJournal>, code: string) =>
  ls.find((l) => l.accountCode === code);

describe('buildEquityJournal — goldens (Handover §8)', () => {
  it('CAP_INIT partial 1M/paid 700k → Dr bank 700k + Dr 11-1310 300k / Cr 31-1101 1M', () => {
    const j = buildEquityJournal({
      txnType: 'CAP_INIT',
      paymentAccountCode: '11-1201',
      lines: [
        line({ amount: '500000', paid: '500000' }),
        line({ amount: '300000', paid: '100000' }),
        line({ amount: '200000', paid: '100000' }),
      ],
    });
    expect(j).toHaveLength(3);
    expect(byCode(j, '11-1201')!.dr.toFixed(2)).toBe('700000.00');
    expect(byCode(j, EQ_ACCOUNTS.UNPAID_CAPITAL)!.dr.toFixed(2)).toBe('300000.00');
    expect(byCode(j, EQ_ACCOUNTS.COMMON_STOCK)!.cr.toFixed(2)).toBe('1000000.00');
    const t = sum(j);
    expect(t.dr.equals(t.cr)).toBe(true);
  });

  it('CAP_INIT paid เต็ม → ไม่มีบรรทัด 11-1310', () => {
    const j = buildEquityJournal({
      txnType: 'CAP_INIT',
      paymentAccountCode: '11-1201',
      lines: [line({ amount: '1000000', paid: '1000000' })],
    });
    expect(j).toHaveLength(2);
    expect(byCode(j, EQ_ACCOUNTS.UNPAID_CAPITAL)).toBeUndefined();
  });

  it('CAP_INC 500k + premium 100k → Dr bank 600k / Cr 31-1101 500k + Cr 31-1102 100k', () => {
    const j = buildEquityJournal({
      txnType: 'CAP_INC',
      paymentAccountCode: '11-1201',
      lines: [line({ amount: '500000', premium: '100000' })],
    });
    expect(byCode(j, '11-1201')!.dr.toFixed(2)).toBe('600000.00');
    expect(byCode(j, EQ_ACCOUNTS.COMMON_STOCK)!.cr.toFixed(2)).toBe('500000.00');
    expect(byCode(j, EQ_ACCOUNTS.SHARE_PREMIUM)!.cr.toFixed(2)).toBe('100000.00');
  });

  it('CAP_INC premium 0 → ไม่มีบรรทัด 31-1102', () => {
    const j = buildEquityJournal({
      txnType: 'CAP_INC',
      paymentAccountCode: '11-1201',
      lines: [line({ amount: '500000' })],
    });
    expect(byCode(j, EQ_ACCOUNTS.SHARE_PREMIUM)).toBeUndefined();
  });

  it('CAP_DEC 200k → Dr 31-1101 / Cr bank', () => {
    const j = buildEquityJournal({
      txnType: 'CAP_DEC',
      paymentAccountCode: '11-1201',
      lines: [line({ amount: '200000' })],
    });
    expect(byCode(j, EQ_ACCOUNTS.COMMON_STOCK)!.dr.toFixed(2)).toBe('200000.00');
    expect(byCode(j, '11-1201')!.cr.toFixed(2)).toBe('200000.00');
  });

  it('DRAW 50k → Dr 22-1102 / Cr cash', () => {
    const j = buildEquityJournal({
      txnType: 'DRAW',
      paymentAccountCode: '11-1101',
      lines: [line({ amount: '50000' })],
    });
    expect(byCode(j, EQ_ACCOUNTS.DIRECTOR_DRAWING)!.dr.toFixed(2)).toBe('50000.00');
    expect(byCode(j, '11-1101')!.cr.toFixed(2)).toBe('50000.00');
  });

  it('DIV_DEC 200k → Dr 32-1101 / Cr 21-4104', () => {
    const j = buildEquityJournal({
      txnType: 'DIV_DEC',
      lines: [line({ amount: '100000' }), line({ amount: '60000' }), line({ amount: '40000' })],
    });
    expect(byCode(j, EQ_ACCOUNTS.RETAINED_EARNINGS)!.dr.toFixed(2)).toBe('200000.00');
    expect(byCode(j, EQ_ACCOUNTS.DIVIDEND_PAYABLE)!.cr.toFixed(2)).toBe('200000.00');
  });

  it('DIV_PAY 200k หัก WHT 20k → Dr 21-4104 200k / Cr bank 180k + Cr 21-3104 20k', () => {
    const j = buildEquityJournal({
      txnType: 'DIV_PAY',
      paymentAccountCode: '11-1201',
      lines: [
        line({ amount: '100000', wht: '10000' }),
        line({ amount: '60000', wht: '6000' }),
        line({ amount: '40000', wht: '4000' }),
      ],
    });
    expect(byCode(j, EQ_ACCOUNTS.DIVIDEND_PAYABLE)!.dr.toFixed(2)).toBe('200000.00');
    expect(byCode(j, '11-1201')!.cr.toFixed(2)).toBe('180000.00');
    expect(byCode(j, EQ_ACCOUNTS.WHT_DIVIDEND)!.cr.toFixed(2)).toBe('20000.00');
  });

  it('DIV_PAY WHT 0 ทุกบรรทัด → ไม่มีบรรทัด 21-3104', () => {
    const j = buildEquityJournal({
      txnType: 'DIV_PAY',
      paymentAccountCode: '11-1201',
      lines: [line({ amount: '100000' })],
    });
    expect(byCode(j, EQ_ACCOUNTS.WHT_DIVIDEND)).toBeUndefined();
    expect(byCode(j, '11-1201')!.cr.toFixed(2)).toBe('100000.00');
  });

  it('PRIOR_ADJ DR_OTHER_CR_RE → Dr paAccount / Cr 32-1101', () => {
    const j = buildEquityJournal({
      txnType: 'PRIOR_ADJ',
      paAccountCode: '11-1201',
      paAmount: new D('15000'),
      paDirection: 'DR_OTHER_CR_RE',
      lines: [],
    });
    expect(byCode(j, '11-1201')!.dr.toFixed(2)).toBe('15000.00');
    expect(byCode(j, EQ_ACCOUNTS.RETAINED_EARNINGS)!.cr.toFixed(2)).toBe('15000.00');
  });

  it('PRIOR_ADJ DR_RE_CR_OTHER → Dr 32-1101 / Cr paAccount', () => {
    const j = buildEquityJournal({
      txnType: 'PRIOR_ADJ',
      paAccountCode: '11-1201',
      paAmount: new D('15000'),
      paDirection: 'DR_RE_CR_OTHER',
      lines: [],
    });
    expect(byCode(j, EQ_ACCOUNTS.RETAINED_EARNINGS)!.dr.toFixed(2)).toBe('15000.00');
    expect(byCode(j, '11-1201')!.cr.toFixed(2)).toBe('15000.00');
  });

  it('ทุกประเภท: ΣDr = ΣCr เสมอ (โครงสร้าง balanced)', () => {
    const cases = [
      { txnType: 'CAP_INIT' as const, paymentAccountCode: '11-1101', lines: [line({ amount: '999.99', paid: '250.00' })] },
      { txnType: 'DIV_PAY' as const, paymentAccountCode: '11-1101', lines: [line({ amount: '333.33', wht: '33.33' })] },
    ];
    for (const c of cases) {
      const t = sum(buildEquityJournal(c));
      expect(t.dr.equals(t.cr)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: รันให้ fail**

```bash
cd apps/api
npx jest src/modules/equity/equity-journal.builder.spec.ts
```
Expected: FAIL — `Cannot find module './equity-journal.builder'`

- [ ] **Step 3: implement builder**

```ts
// apps/api/src/modules/equity/equity-journal.builder.ts
import { Prisma, EquityTxnType } from '@prisma/client';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);

/** รหัสบัญชีที่ builder ใช้ — ทุกตัวมีอยู่ใน finance-coa.csv แล้ว (11-1310 เพิ่ม Task 1) */
export const EQ_ACCOUNTS = {
  UNPAID_CAPITAL: '11-1310',
  WHT_DIVIDEND: '21-3104',
  DIVIDEND_PAYABLE: '21-4104',
  DIRECTOR_DRAWING: '22-1102',
  COMMON_STOCK: '31-1101',
  SHARE_PREMIUM: '31-1102',
  RETAINED_EARNINGS: '32-1101',
} as const;

/** ประเภทที่ต้องมีมติที่ประชุม + แนบไฟล์ (V_RESOLUTION + V8) */
export const NEEDS_RESOLUTION: EquityTxnType[] = ['CAP_INIT', 'CAP_INC', 'CAP_DEC', 'DIV_DEC', 'PRIOR_ADJ'];
/** ประเภทที่ต้องเลือกช่องทางเงินสด/ธนาคาร */
export const NEEDS_PAYMENT: EquityTxnType[] = ['CAP_INIT', 'CAP_INC', 'CAP_DEC', 'DRAW', 'DIV_PAY'];
/** ประเภทที่ต้องมีบรรทัดผู้ถือหุ้น ≥1 */
export const NEEDS_SHAREHOLDERS: EquityTxnType[] = ['CAP_INIT', 'CAP_INC', 'CAP_DEC', 'DRAW', 'DIV_DEC', 'DIV_PAY'];

export type PaDirection = 'DR_OTHER_CR_RE' | 'DR_RE_CR_OTHER';

export interface EquityBuilderLine {
  amount: Dec;
  premium: Dec;
  paid: Dec;
  wht: Dec;
}

export interface EquityBuilderInput {
  txnType: EquityTxnType;
  paymentAccountCode?: string | null;
  paAccountCode?: string | null;
  paAmount?: Dec | null;
  paDirection?: PaDirection | null;
  lines: EquityBuilderLine[];
}

export interface EquityJeLine {
  accountCode: string;
  dr: Dec;
  cr: Dec;
  description: string;
}

function totals(lines: EquityBuilderLine[]) {
  return lines.reduce(
    (t, l) => ({
      amount: t.amount.plus(l.amount),
      premium: t.premium.plus(l.premium),
      paid: t.paid.plus(l.paid),
      wht: t.wht.plus(l.wht),
    }),
    { amount: ZERO, premium: ZERO, paid: ZERO, wht: ZERO },
  );
}

/**
 * สร้าง JE lines จากเอกสาร equity — pure function, balanced โดยโครงสร้างทุกประเภท
 * (JournalAutoService ยังเช็ค Dr=Cr ซ้ำอีกชั้นตอนโพสต์). ตัวเลข golden: Handover §8.
 * ผู้เรียกต้อง validate field ครบก่อน (equity-validation.util) — builder โยนเฉพาะ
 * กรณีข้อมูลขาดจนประกอบ JE ไม่ได้
 */
export function buildEquityJournal(input: EquityBuilderInput): EquityJeLine[] {
  const t = totals(input.lines);
  const pay = input.paymentAccountCode ?? null;
  const lines: EquityJeLine[] = [];

  switch (input.txnType) {
    case 'CAP_INIT': {
      if (!pay) throw new Error('CAP_INIT ต้องมี paymentAccountCode');
      const unpaid = t.amount.minus(t.paid);
      if (t.paid.gt(0)) lines.push({ accountCode: pay, dr: t.paid, cr: ZERO, description: 'รับเงินลงทุนตั้งบริษัท (ชำระจริง)' });
      if (unpaid.gt(0)) lines.push({ accountCode: EQ_ACCOUNTS.UNPAID_CAPITAL, dr: unpaid, cr: ZERO, description: 'ค่าหุ้นค้างชำระ' });
      lines.push({ accountCode: EQ_ACCOUNTS.COMMON_STOCK, dr: ZERO, cr: t.amount, description: 'ทุนจดทะเบียน (par)' });
      break;
    }
    case 'CAP_INC': {
      if (!pay) throw new Error('CAP_INC ต้องมี paymentAccountCode');
      lines.push({ accountCode: pay, dr: t.amount.plus(t.premium), cr: ZERO, description: 'รับเงินเพิ่มทุน' });
      lines.push({ accountCode: EQ_ACCOUNTS.COMMON_STOCK, dr: ZERO, cr: t.amount, description: 'เพิ่มหุ้นสามัญ (par)' });
      if (t.premium.gt(0)) lines.push({ accountCode: EQ_ACCOUNTS.SHARE_PREMIUM, dr: ZERO, cr: t.premium, description: 'ส่วนเกินมูลค่าหุ้น' });
      break;
    }
    case 'CAP_DEC': {
      if (!pay) throw new Error('CAP_DEC ต้องมี paymentAccountCode');
      lines.push({ accountCode: EQ_ACCOUNTS.COMMON_STOCK, dr: t.amount, cr: ZERO, description: 'ลดหุ้นสามัญ' });
      lines.push({ accountCode: pay, dr: ZERO, cr: t.amount, description: 'จ่ายคืนเงินทุน' });
      break;
    }
    case 'DRAW': {
      if (!pay) throw new Error('DRAW ต้องมี paymentAccountCode');
      lines.push({ accountCode: EQ_ACCOUNTS.DIRECTOR_DRAWING, dr: t.amount, cr: ZERO, description: 'กรรมการถอนเงิน (เงินทดรองจ่ายกรรมการ)' });
      lines.push({ accountCode: pay, dr: ZERO, cr: t.amount, description: 'จ่ายให้กรรมการ' });
      break;
    }
    case 'DIV_DEC': {
      lines.push({ accountCode: EQ_ACCOUNTS.RETAINED_EARNINGS, dr: t.amount, cr: ZERO, description: 'ประกาศจ่ายปันผลจากกำไรสะสม (TAS 10)' });
      lines.push({ accountCode: EQ_ACCOUNTS.DIVIDEND_PAYABLE, dr: ZERO, cr: t.amount, description: `เงินปันผลค้างจ่าย (${input.lines.length} ราย)` });
      break;
    }
    case 'DIV_PAY': {
      if (!pay) throw new Error('DIV_PAY ต้องมี paymentAccountCode');
      const net = t.amount.minus(t.wht);
      lines.push({ accountCode: EQ_ACCOUNTS.DIVIDEND_PAYABLE, dr: t.amount, cr: ZERO, description: `ตัดเงินปันผลค้างจ่าย (${input.lines.length} ราย)` });
      lines.push({ accountCode: pay, dr: ZERO, cr: net, description: 'จ่ายเงินปันผลสุทธิ' });
      if (t.wht.gt(0)) lines.push({ accountCode: EQ_ACCOUNTS.WHT_DIVIDEND, dr: ZERO, cr: t.wht, description: 'ภ.ง.ด.2 ค้างจ่าย (WHT ปันผล 10%)' });
      break;
    }
    case 'PRIOR_ADJ': {
      const amt = input.paAmount ?? ZERO;
      const acc = input.paAccountCode;
      if (!acc || amt.lte(0) || !input.paDirection) throw new Error('PRIOR_ADJ ต้องมี paAccountCode + paAmount + paDirection');
      if (input.paDirection === 'DR_OTHER_CR_RE') {
        lines.push({ accountCode: acc, dr: amt, cr: ZERO, description: 'ปรับปรุงงบย้อนหลัง (TAS 8)' });
        lines.push({ accountCode: EQ_ACCOUNTS.RETAINED_EARNINGS, dr: ZERO, cr: amt, description: 'ปรับปรุงกำไรสะสม' });
      } else {
        lines.push({ accountCode: EQ_ACCOUNTS.RETAINED_EARNINGS, dr: amt, cr: ZERO, description: 'ปรับปรุงกำไรสะสม' });
        lines.push({ accountCode: acc, dr: ZERO, cr: amt, description: 'ปรับปรุงงบย้อนหลัง (TAS 8)' });
      }
      break;
    }
  }
  return lines;
}
```

- [ ] **Step 4: รันให้ pass**

```bash
cd apps/api
npx jest src/modules/equity/equity-journal.builder.spec.ts
```
Expected: PASS ทั้ง 12 tests

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/equity
git commit -m "feat(equity): JE builder 7 ประเภท + golden specs (Handover §8)"
```

---

### Task 3: Validation util (pure) + specs — TDD

**Files:**
- Create: `apps/api/src/modules/equity/equity-validation.util.ts`
- Test: `apps/api/src/modules/equity/equity-validation.util.spec.ts`

**Interfaces:**
- Consumes: `NEEDS_RESOLUTION/NEEDS_PAYMENT/NEEDS_SHAREHOLDERS` จาก `./equity-journal.builder` (Task 2)
- Produces: `validateEquityDoc(doc: EquityValidationDoc, opts: { hasAttachment: boolean }): EquityValidationError[]` + `computeDefaultWht(type: ShareholderType, amount: Decimal): Decimal` — Task 4 (create/update WHT default) + Task 5 (submit/post gate) ใช้

- [ ] **Step 1: เขียน failing spec**

```ts
// apps/api/src/modules/equity/equity-validation.util.spec.ts
import { Prisma, ShareholderType } from '@prisma/client';
import { validateEquityDoc, computeDefaultWht } from './equity-validation.util';

const D = Prisma.Decimal;
const base = {
  txnType: 'CAP_INIT' as const,
  resolutionNo: 'MOA-2569-001',
  resolutionDate: new Date('2026-01-10'),
  paymentAccountCode: '11-1201',
  paAccountCode: null,
  paAmount: null,
  paDirection: null,
  lines: [
    { shareholderId: 'sh-1', amount: new D('500000'), premium: new D(0), paid: new D('500000'), wht: new D(0) },
    { shareholderId: 'sh-2', amount: new D('500000'), premium: new D(0), paid: new D('0'), wht: new D(0) },
  ],
};
const codes = (errs: { code: string }[]) => errs.map((e) => e.code);

describe('validateEquityDoc', () => {
  it('CAP_INIT ครบถ้วน + paid 50% → ผ่าน', () => {
    expect(validateEquityDoc(base, { hasAttachment: true })).toEqual([]);
  });

  it('V_INIT_25: paid 24.99% ของ par → fail; 25% พอดี → ผ่าน (Decimal ตรงๆ ไม่มี tolerance)', () => {
    const under = { ...base, lines: [{ ...base.lines[0], amount: new D('1000000'), paid: new D('249999.99') }] };
    expect(codes(validateEquityDoc(under, { hasAttachment: true }))).toContain('V_INIT_25');
    const exact = { ...base, lines: [{ ...base.lines[0], amount: new D('1000000'), paid: new D('250000') }] };
    expect(codes(validateEquityDoc(exact, { hasAttachment: true }))).not.toContain('V_INIT_25');
  });

  it('V_INIT_PAID_LE_PAR: paid > par → fail', () => {
    const doc = { ...base, lines: [{ ...base.lines[0], amount: new D('100'), paid: new D('100.01') }] };
    expect(codes(validateEquityDoc(doc, { hasAttachment: true }))).toContain('V_INIT_PAID_LE_PAR');
  });

  it('V_SH_UNIQUE: shareholderId ซ้ำ → fail', () => {
    const doc = { ...base, lines: [base.lines[0], { ...base.lines[1], shareholderId: 'sh-1' }] };
    expect(codes(validateEquityDoc(doc, { hasAttachment: true }))).toContain('V_SH_UNIQUE');
  });

  it('V_RESOLUTION: DIV_DEC ไม่มีเลขมติ → fail; DRAW ไม่ต้องมี → ผ่าน', () => {
    const divDec = { ...base, txnType: 'DIV_DEC' as const, resolutionNo: null, resolutionDate: null, paymentAccountCode: null };
    expect(codes(validateEquityDoc(divDec, { hasAttachment: true }))).toContain('V_RESOLUTION');
    const draw = { ...base, txnType: 'DRAW' as const, resolutionNo: null, resolutionDate: null, lines: [base.lines[0]] };
    expect(codes(validateEquityDoc(draw, { hasAttachment: false }))).not.toContain('V_RESOLUTION');
  });

  it('V8: ประเภทที่ต้องมีมติ แต่ไม่มีไฟล์แนบ → fail', () => {
    expect(codes(validateEquityDoc(base, { hasAttachment: false }))).toContain('V8');
  });

  it('PAYMENT: DIV_PAY ไม่เลือกช่องเงิน → fail', () => {
    const doc = { ...base, txnType: 'DIV_PAY' as const, paymentAccountCode: null, resolutionNo: null, resolutionDate: null,
      lines: [{ ...base.lines[0], wht: new D('50000') }] };
    expect(codes(validateEquityDoc(doc, { hasAttachment: false }))).toContain('PAYMENT');
  });

  it('SH_REQUIRED: CAP_INC ไม่มีบรรทัดผู้ถือหุ้น → fail · PRIOR_ADJ ไม่ต้องมี → ผ่าน', () => {
    const noLines = { ...base, txnType: 'CAP_INC' as const, lines: [] };
    expect(codes(validateEquityDoc(noLines, { hasAttachment: true }))).toContain('SH_REQUIRED');
    const pa = { ...base, txnType: 'PRIOR_ADJ' as const, lines: [], paymentAccountCode: null,
      paAccountCode: '11-1201', paAmount: new D('100'), paDirection: 'DR_OTHER_CR_RE' as const };
    expect(codes(validateEquityDoc(pa, { hasAttachment: true }))).not.toContain('SH_REQUIRED');
  });

  it('SH_AMOUNT: amount ≤ 0 → fail', () => {
    const doc = { ...base, lines: [{ ...base.lines[0], amount: new D('0'), paid: new D('0') }] };
    expect(codes(validateEquityDoc(doc, { hasAttachment: true }))).toContain('SH_AMOUNT');
  });

  it('WHT_RANGE: DIV_PAY wht เกิน amount → fail', () => {
    const doc = { ...base, txnType: 'DIV_PAY' as const, resolutionNo: null, resolutionDate: null,
      lines: [{ ...base.lines[0], amount: new D('100'), wht: new D('100.01') }] };
    expect(codes(validateEquityDoc(doc, { hasAttachment: false }))).toContain('WHT_RANGE');
  });

  it('PA_FIELDS: PRIOR_ADJ ขาด paAmount → fail', () => {
    const doc = { ...base, txnType: 'PRIOR_ADJ' as const, lines: [], paymentAccountCode: null,
      paAccountCode: '11-1201', paAmount: null, paDirection: 'DR_OTHER_CR_RE' as const };
    expect(codes(validateEquityDoc(doc, { hasAttachment: true }))).toContain('PA_FIELDS');
  });
});

describe('computeDefaultWht', () => {
  it('INDIVIDUAL → 10% HALF_UP 2dp', () => {
    expect(computeDefaultWht('INDIVIDUAL' as ShareholderType, new D('333.35')).toFixed(2)).toBe('33.34');
  });
  it('JURISTIC_TH → 0 (ม.65 ทวิ(10))', () => {
    expect(computeDefaultWht('JURISTIC_TH' as ShareholderType, new D('1000')).toFixed(2)).toBe('0.00');
  });
  it('JURISTIC_FOREIGN → 10% default', () => {
    expect(computeDefaultWht('JURISTIC_FOREIGN' as ShareholderType, new D('1000')).toFixed(2)).toBe('100.00');
  });
});
```

- [ ] **Step 2: รันให้ fail** — `cd apps/api && npx jest src/modules/equity/equity-validation.util.spec.ts` → FAIL (module not found)

- [ ] **Step 3: implement**

```ts
// apps/api/src/modules/equity/equity-validation.util.ts
import { Prisma, EquityTxnType, ShareholderType } from '@prisma/client';
import { NEEDS_PAYMENT, NEEDS_RESOLUTION, NEEDS_SHAREHOLDERS, PaDirection } from './equity-journal.builder';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export interface EquityValidationLine {
  shareholderId: string;
  amount: Dec;
  premium: Dec;
  paid: Dec;
  wht: Dec;
}

export interface EquityValidationDoc {
  txnType: EquityTxnType;
  resolutionNo: string | null;
  resolutionDate: Date | null;
  paymentAccountCode: string | null;
  paAccountCode: string | null;
  paAmount: Dec | null;
  paDirection: PaDirection | string | null;
  lines: EquityValidationLine[];
}

export interface EquityValidationError {
  code: string;
  msg: string;
}

/** WHT ปันผล default ตามประเภทผู้ถือหุ้น — INDIVIDUAL/JURISTIC_FOREIGN = 10% (HALF_UP 2dp), JURISTIC_TH = 0 */
export function computeDefaultWht(type: ShareholderType, amount: Dec): Dec {
  if (type === 'JURISTIC_TH') return new D(0);
  return amount.times('0.10').toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Validation ก่อน submit/post (pure — GL guards ที่ต้องอ่าน DB อยู่ใน EquityService).
 * คืน [] เมื่อผ่านทั้งหมด — error message ภาษาไทย
 */
export function validateEquityDoc(
  doc: EquityValidationDoc,
  opts: { hasAttachment: boolean },
): EquityValidationError[] {
  const errors: EquityValidationError[] = [];
  const t = doc.txnType;

  if (NEEDS_RESOLUTION.includes(t)) {
    if (!doc.resolutionNo || !doc.resolutionDate) {
      errors.push({ code: 'V_RESOLUTION', msg: 'กรุณากรอกเลขที่และวันที่มติที่ประชุม' });
    }
    if (!opts.hasAttachment) {
      errors.push({ code: 'V8', msg: 'ต้องแนบเอกสารมติที่ประชุมอย่างน้อย 1 ไฟล์' });
    }
  }

  if (NEEDS_PAYMENT.includes(t) && !doc.paymentAccountCode) {
    errors.push({ code: 'PAYMENT', msg: 'กรุณาเลือกช่องทางเงินสด/ธนาคาร' });
  }

  if (NEEDS_SHAREHOLDERS.includes(t)) {
    if (doc.lines.length === 0) {
      errors.push({ code: 'SH_REQUIRED', msg: 'กรุณาเพิ่มผู้ถือหุ้นอย่างน้อย 1 ราย' });
    }
    const seen = new Set<string>();
    doc.lines.forEach((ln, i) => {
      if (seen.has(ln.shareholderId)) {
        errors.push({ code: 'V_SH_UNIQUE', msg: `รายการที่ ${i + 1}: ผู้ถือหุ้นซ้ำในเอกสารเดียวกัน` });
      }
      seen.add(ln.shareholderId);
      if (ln.amount.lte(0)) {
        errors.push({ code: 'SH_AMOUNT', msg: `รายการที่ ${i + 1}: จำนวนเงินต้องมากกว่า 0` });
      }
    });
  }

  if (t === 'CAP_INIT') {
    doc.lines.forEach((ln, i) => {
      if (ln.paid.lt(0) || ln.paid.gt(ln.amount)) {
        errors.push({
          code: 'V_INIT_PAID_LE_PAR',
          msg: `รายการที่ ${i + 1}: ชำระจริง (${ln.paid.toFixed(2)}) ต้องอยู่ระหว่าง 0 ถึงมูลค่าหุ้นที่จอง (${ln.amount.toFixed(2)})`,
        });
      }
    });
    const totalPar = doc.lines.reduce((s, l) => s.plus(l.amount), new D(0));
    const totalPaid = doc.lines.reduce((s, l) => s.plus(l.paid), new D(0));
    if (totalPar.gt(0) && totalPaid.lt(totalPar.times('0.25'))) {
      errors.push({
        code: 'V_INIT_25',
        msg: `ต้องชำระขั้นต่ำ 25% ของทุนจดทะเบียน (${totalPar.times('0.25').toFixed(2)} บาท) — ปัจจุบันชำระ ${totalPaid.toFixed(2)} บาท (ป.พ.พ. ม.1110)`,
      });
    }
  }

  if (t === 'DIV_PAY') {
    doc.lines.forEach((ln, i) => {
      if (ln.wht.lt(0) || ln.wht.gt(ln.amount)) {
        errors.push({ code: 'WHT_RANGE', msg: `รายการที่ ${i + 1}: WHT ต้องอยู่ระหว่าง 0 ถึงยอดปันผลของรายนั้น` });
      }
    });
  }

  if (t === 'PRIOR_ADJ') {
    const dirOk = doc.paDirection === 'DR_OTHER_CR_RE' || doc.paDirection === 'DR_RE_CR_OTHER';
    if (!doc.paAccountCode || !doc.paAmount || doc.paAmount.lte(0) || !dirOk) {
      errors.push({ code: 'PA_FIELDS', msg: 'กรุณากรอกบัญชีคู่ปรับปรุง จำนวนเงิน (>0) และทิศทาง' });
    }
  }

  return errors;
}
```

- [ ] **Step 4: รันให้ pass** — `npx jest src/modules/equity/equity-validation.util.spec.ts` → PASS

- [ ] **Step 5: Commit** — `git add apps/api/src/modules/equity && git commit -m "feat(equity): validation rules (V_INIT_25/V_SH_UNIQUE/V8/...) + WHT default"`

---

### Task 4: Scaffold — DocNumber service, DTOs, Service CRUD, Controller, Module wiring

**Files:**
- Create: `apps/api/src/modules/equity/services/equity-doc-number.service.ts`
- Create: `apps/api/src/modules/equity/dto/create-equity-document.dto.ts`, `dto/update-equity-document.dto.ts`, `dto/reverse-equity-document.dto.ts`, `dto/journal-preview.dto.ts`, `dto/shareholder.dto.ts`, `dto/list-equity.dto.ts`
- Create: `apps/api/src/modules/equity/equity.service.ts` (CRUD ส่วนแรก — lifecycle เพิ่ม Task 5)
- Create: `apps/api/src/modules/equity/equity.controller.ts`
- Create: `apps/api/src/modules/equity/equity.module.ts`
- Modify: `apps/api/src/app.module.ts` (import + register `EquityModule`)

**Interfaces:**
- Consumes: `buildEquityJournal`, `computeDefaultWht`, `validateEquityDoc` (Task 2-3); `CASH_ACCOUNT_CODES` จาก `../../constants/cash-account.constants`; `CompanyResolverService` จาก `../journal/company-resolver.service`
- Produces: `EquityDocNumberService.nextDocNumber(tx, date): Promise<string>` · `EquityService` methods: `list(query)`, `findOne(id)`, `create(dto, userId)`, `update(id, dto, userId)`, `softDelete(id, userId)`, `listShareholders()`, `createShareholder(dto)`, `updateShareholder(id, dto)`, `journalPreview(dto)` — Task 5 เพิ่ม `submit/withdraw/post/reverse`

- [ ] **Step 1: EquityDocNumberService** — สำเนา pattern other-income เปลี่ยน prefix/lock key

```ts
// apps/api/src/modules/equity/services/equity-doc-number.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/** EQ-YYYYMMDD-NNNN — BKK-day advisory-lock pattern (สำเนาจาก other-income DocNumberService) */
@Injectable()
export class EquityDocNumberService {
  async nextDocNumber(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date,
  ): Promise<string> {
    const { yyyymmdd } = this.getBkkDayBounds(issueDate);
    const lockKey = this.hashLockKey(`eq:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    // max(seq) ไม่ใช่ count() — เอกสาร soft-deleted ยังครองเลขผ่าน unique constraint
    const lastDoc = await tx.equityDocument.findFirst({
      where: { docNumber: { startsWith: `EQ-${yyyymmdd}-` } },
      orderBy: { docNumber: 'desc' },
      select: { docNumber: true },
    });
    const lastSeq = lastDoc ? parseInt(lastDoc.docNumber.split('-')[2], 10) || 0 : 0;
    return `EQ-${yyyymmdd}-${String(lastSeq + 1).padStart(4, '0')}`;
  }

  private getBkkDayBounds(date: Date): { yyyymmdd: string } {
    const parts = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m, d] = parts.split('-').map((s) => parseInt(s, 10));
    return { yyyymmdd: `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}` };
  }

  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return h;
  }
}
```

- [ ] **Step 2: DTOs**

```ts
// apps/api/src/modules/equity/dto/create-equity-document.dto.ts
import {
  IsArray, IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsString,
  IsUUID, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EquityTxnType } from '@prisma/client';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';

export class EquityLineDto {
  @IsUUID('4', { message: 'กรุณาเลือกผู้ถือหุ้น' })
  shareholderId!: string;

  @IsNumber({}, { message: 'จำนวนเงินไม่ถูกต้อง' })
  @Min(0.01, { message: 'จำนวนเงินต้องมากกว่า 0' })
  amount!: number;

  @IsOptional()
  @IsNumber({}, { message: 'ส่วนเกินมูลค่าหุ้นไม่ถูกต้อง' })
  @Min(0)
  premium?: number;

  @IsOptional()
  @IsNumber({}, { message: 'จำนวนชำระจริงไม่ถูกต้อง' })
  @Min(0)
  paid?: number;

  /** DIV_PAY เท่านั้น — ไม่ส่ง = server คำนวณ default ตามประเภทผู้ถือหุ้น */
  @IsOptional()
  @IsNumber({}, { message: 'WHT ไม่ถูกต้อง' })
  @Min(0)
  wht?: number;
}

export class CreateEquityDocumentDto {
  @IsEnum(EquityTxnType, { message: 'ประเภทธุรกรรมไม่ถูกต้อง' })
  txnType!: EquityTxnType;

  @IsDateString({}, { message: 'วันที่ทำรายการไม่ถูกต้อง' })
  txnDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'คำอธิบายยาวเกินไป (สูงสุด 500 ตัวอักษร)' })
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'เลขที่มติยาวเกินไป' })
  resolutionNo?: string;

  @IsOptional()
  @IsDateString({}, { message: 'วันที่มติไม่ถูกต้อง' })
  resolutionDate?: string;

  @IsOptional()
  @IsIn([...CASH_ACCOUNT_CODES], { message: 'ช่องทางเงินต้องเป็นบัญชีเงินสด/ธนาคาร FINANCE ที่กำหนด' })
  paymentAccountCode?: string;

  @IsOptional()
  @IsString()
  paAccountCode?: string;

  @IsOptional()
  @IsNumber({}, { message: 'ยอดปรับปรุงไม่ถูกต้อง' })
  @Min(0.01, { message: 'ยอดปรับปรุงต้องมากกว่า 0' })
  paAmount?: number;

  @IsOptional()
  @IsIn(['DR_OTHER_CR_RE', 'DR_RE_CR_OTHER'], { message: 'ทิศทางปรับปรุงไม่ถูกต้อง' })
  paDirection?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EquityLineDto)
  lines!: EquityLineDto[];
}
```

```ts
// apps/api/src/modules/equity/dto/update-equity-document.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateEquityDocumentDto } from './create-equity-document.dto';

export class UpdateEquityDocumentDto extends PartialType(CreateEquityDocumentDto) {}
```

หมายเหตุ: ถ้า `@nestjs/mapped-types` ไม่อยู่ใน deps (เช็ค `apps/api/package.json` — โมดูลอื่นใช้แยก DTO มือ) ให้เขียน UpdateDto ซ้ำทุก field เป็น `@IsOptional()` แทน — ห้ามเพิ่ม dependency ใหม่

```ts
// apps/api/src/modules/equity/dto/reverse-equity-document.dto.ts
import { IsString, MinLength, MaxLength } from 'class-validator';

export class ReverseEquityDocumentDto {
  @IsString({ message: 'กรุณาระบุเหตุผลการกลับรายการ' })
  @MinLength(10, { message: 'เหตุผลต้องยาวอย่างน้อย 10 ตัวอักษร' })
  @MaxLength(500, { message: 'เหตุผลยาวเกินไป (สูงสุด 500 ตัวอักษร)' })
  reason!: string;
}
```

```ts
// apps/api/src/modules/equity/dto/journal-preview.dto.ts
// payload เดียวกับ Create — ใช้ preview JE จากร่างบนหน้าจอโดยไม่บันทึก
import { CreateEquityDocumentDto } from './create-equity-document.dto';

export class JournalPreviewDto extends CreateEquityDocumentDto {}
```

```ts
// apps/api/src/modules/equity/dto/shareholder.dto.ts
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ShareholderType } from '@prisma/client';

export class CreateShareholderDto {
  @IsString({ message: 'กรุณากรอกชื่อผู้ถือหุ้น' })
  @MaxLength(200, { message: 'ชื่อยาวเกินไป' })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'เลขผู้เสียภาษียาวเกินไป' })
  taxId?: string;

  @IsOptional()
  @IsInt({ message: 'จำนวนหุ้นต้องเป็นจำนวนเต็ม' })
  @Min(0)
  shares?: number;

  @IsOptional()
  @IsNumber({}, { message: 'สัดส่วนหุ้นไม่ถูกต้อง' })
  @Min(0)
  sharePct?: number;

  @IsOptional()
  @IsEnum(ShareholderType, { message: 'ประเภทผู้ถือหุ้นไม่ถูกต้อง' })
  type?: ShareholderType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateShareholderDto extends CreateShareholderDto {}
// ทุก field optional อยู่แล้วยกเว้น name — override:
// ถ้าต้องการแก้บางส่วนโดยไม่ส่ง name ให้เปลี่ยน name เป็น @IsOptional() ใน UpdateShareholderDto:
//   @IsOptional() @IsString() @MaxLength(200) name?: string;
```

```ts
// apps/api/src/modules/equity/dto/list-equity.dto.ts
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListEquityDto {
  @IsOptional()
  @IsIn(['CAP_INIT', 'CAP_INC', 'CAP_DEC', 'DRAW', 'DIV_DEC', 'DIV_PAY', 'PRIOR_ADJ'])
  txnType?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'READY', 'POSTED', 'REVERSED'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
```

- [ ] **Step 3: EquityService — CRUD + shareholders + journalPreview**

```ts
// apps/api/src/modules/equity/equity.service.ts
import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma, EquityDocStatus, EquityTxnType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { EquityDocNumberService } from './services/equity-doc-number.service';
import {
  buildEquityJournal, EquityBuilderLine, NEEDS_SHAREHOLDERS, PaDirection,
} from './equity-journal.builder';
import { computeDefaultWht, validateEquityDoc } from './equity-validation.util';
import { CreateEquityDocumentDto, EquityLineDto } from './dto/create-equity-document.dto';
import { UpdateEquityDocumentDto } from './dto/update-equity-document.dto';
import { ReverseEquityDocumentDto } from './dto/reverse-equity-document.dto';
import { CreateShareholderDto, UpdateShareholderDto } from './dto/shareholder.dto';
import { ListEquityDto } from './dto/list-equity.dto';

const D = Prisma.Decimal;

@Injectable()
export class EquityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: EquityDocNumberService,
    private readonly companyResolver: CompanyResolverService,
    private readonly journalAuto: JournalAutoService,
  ) {}

  // ─── Shareholders ────────────────────────────────────────────────────────

  listShareholders() {
    return this.prisma.shareholder.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  createShareholder(dto: CreateShareholderDto) {
    return this.prisma.shareholder.create({
      data: {
        name: dto.name,
        taxId: dto.taxId ?? null,
        shares: dto.shares ?? 0,
        sharePct: dto.sharePct != null ? new D(dto.sharePct) : null,
        type: dto.type ?? 'INDIVIDUAL',
        note: dto.note ?? null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateShareholder(id: string, dto: UpdateShareholderDto) {
    const sh = await this.prisma.shareholder.findFirst({ where: { id, deletedAt: null } });
    if (!sh) throw new NotFoundException('ไม่พบผู้ถือหุ้น');
    return this.prisma.shareholder.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.taxId !== undefined ? { taxId: dto.taxId } : {}),
        ...(dto.shares !== undefined ? { shares: dto.shares } : {}),
        ...(dto.sharePct !== undefined ? { sharePct: new D(dto.sharePct) } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  // ─── Documents CRUD ──────────────────────────────────────────────────────

  async list(query: ListEquityDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where: Prisma.EquityDocumentWhereInput = {
      deletedAt: null,
      ...(query.txnType ? { txnType: query.txnType as EquityTxnType } : {}),
      ...(query.status ? { status: query.status as EquityDocStatus } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.equityDocument.findMany({
        where,
        include: { lines: { orderBy: { lineNo: 'asc' } }, attachments: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.equityDocument.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const doc = await this.prisma.equityDocument.findFirst({
      where: { id, deletedAt: null },
      include: {
        lines: { orderBy: { lineNo: 'asc' }, include: { shareholder: true } },
        attachments: true,
        maker: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
      },
    });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');
    return doc;
  }

  /** แปลง DTO lines → snapshot rows พร้อม WHT default (DIV_PAY) — ใช้ทั้ง create/update/preview */
  private async resolveLines(txnType: EquityTxnType, dtoLines: EquityLineDto[]) {
    if (!NEEDS_SHAREHOLDERS.includes(txnType)) return [];
    const ids = dtoLines.map((l) => l.shareholderId);
    const shs = await this.prisma.shareholder.findMany({
      where: { id: { in: ids }, deletedAt: null },
    });
    const byId = new Map(shs.map((s) => [s.id, s]));
    return dtoLines.map((l, i) => {
      const sh = byId.get(l.shareholderId);
      if (!sh) throw new BadRequestException(`รายการที่ ${i + 1}: ไม่พบผู้ถือหุ้นในระบบ`);
      const amount = new D(l.amount);
      const wht =
        txnType === 'DIV_PAY'
          ? l.wht != null
            ? new D(l.wht)
            : computeDefaultWht(sh.type, amount)
          : new D(0);
      return {
        shareholderId: sh.id,
        shareholderName: sh.name,
        lineNo: i + 1,
        amount,
        premium: new D(l.premium ?? 0),
        paid: new D(l.paid ?? 0),
        wht,
      };
    });
  }

  private toBuilderLines(rows: { amount: Prisma.Decimal; premium: Prisma.Decimal; paid: Prisma.Decimal; wht: Prisma.Decimal }[]): EquityBuilderLine[] {
    return rows.map((r) => ({
      amount: new D(r.amount.toString()),
      premium: new D(r.premium.toString()),
      paid: new D(r.paid.toString()),
      wht: new D(r.wht.toString()),
    }));
  }

  /** V_INIT_ONCE — มี CAP_INIT อื่นที่ยังไม่ถูก reverse → ห้ามสร้าง/โพสต์ใบใหม่ */
  private async assertInitOnce(excludeId?: string) {
    const other = await this.prisma.equityDocument.findFirst({
      where: {
        txnType: 'CAP_INIT',
        status: { not: 'REVERSED' },
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { docNumber: true },
    });
    if (other) {
      throw new ConflictException(
        `มีเอกสารเริ่มลงทุน (CAP_INIT) อยู่แล้ว (${other.docNumber}) — บันทึกได้ครั้งเดียว หากต้องการเพิ่มทุนให้ใช้ประเภท "เพิ่มทุน (CAP_INC)"`,
      );
    }
  }

  async create(dto: CreateEquityDocumentDto, userId: string) {
    if (dto.txnType === 'CAP_INIT') await this.assertInitOnce();
    const companyId = await this.companyResolver.getFinanceCompanyId();
    const lines = await this.resolveLines(dto.txnType, dto.lines ?? []);

    const created = await this.prisma.$transaction(async (tx) => {
      const txnDate = new Date(dto.txnDate);
      const docNumber = await this.docNumber.nextDocNumber(tx, txnDate);
      return tx.equityDocument.create({
        data: {
          docNumber,
          companyId,
          txnType: dto.txnType,
          status: 'DRAFT',
          txnDate,
          description: dto.description ?? null,
          resolutionNo: dto.resolutionNo ?? null,
          resolutionDate: dto.resolutionDate ? new Date(dto.resolutionDate) : null,
          paymentAccountCode: dto.paymentAccountCode ?? null,
          paAccountCode: dto.paAccountCode ?? null,
          paAmount: dto.paAmount != null ? new D(dto.paAmount) : null,
          paDirection: dto.paDirection ?? null,
          makerId: userId,
          lines: { create: lines },
        },
        include: { lines: true },
      });
    });

    await this.audit(userId, 'EQUITY_CREATED', created.id, { docNumber: created.docNumber, txnType: created.txnType });
    return created;
  }

  async update(id: string, dto: UpdateEquityDocumentDto, userId: string) {
    const doc = await this.findOne(id);
    if (doc.status !== 'DRAFT') {
      throw new ConflictException(`เอกสาร ${doc.docNumber} สถานะ ${doc.status} — แก้ไขได้เฉพาะร่าง`);
    }
    const txnType = (dto.txnType ?? doc.txnType) as EquityTxnType;
    if (txnType === 'CAP_INIT') await this.assertInitOnce(id);
    const lines =
      dto.lines !== undefined ? await this.resolveLines(txnType, dto.lines) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (lines !== null) {
        // แก้ร่าง = ลบทั้งชุดแล้วสร้างใหม่ (precedent interco updateBatch — ยังไม่มี JE อ้างถึง)
        await tx.equityShareholderLine.deleteMany({ where: { documentId: id } });
      }
      return tx.equityDocument.update({
        where: { id },
        data: {
          txnType,
          ...(dto.txnDate !== undefined ? { txnDate: new Date(dto.txnDate) } : {}),
          ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
          ...(dto.resolutionNo !== undefined ? { resolutionNo: dto.resolutionNo ?? null } : {}),
          ...(dto.resolutionDate !== undefined
            ? { resolutionDate: dto.resolutionDate ? new Date(dto.resolutionDate) : null }
            : {}),
          ...(dto.paymentAccountCode !== undefined ? { paymentAccountCode: dto.paymentAccountCode ?? null } : {}),
          ...(dto.paAccountCode !== undefined ? { paAccountCode: dto.paAccountCode ?? null } : {}),
          ...(dto.paAmount !== undefined ? { paAmount: dto.paAmount != null ? new D(dto.paAmount) : null } : {}),
          ...(dto.paDirection !== undefined ? { paDirection: dto.paDirection ?? null } : {}),
          ...(lines !== null ? { lines: { create: lines } } : {}),
        },
        include: { lines: true },
      });
    });
    await this.audit(userId, 'EQUITY_UPDATED', id, { docNumber: doc.docNumber });
    return updated;
  }

  async softDelete(id: string, userId: string) {
    const doc = await this.findOne(id);
    if (doc.status !== 'DRAFT') {
      throw new ConflictException(`เอกสาร ${doc.docNumber} สถานะ ${doc.status} — ลบได้เฉพาะร่าง`);
    }
    await this.prisma.equityDocument.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit(userId, 'EQUITY_DELETED', id, { docNumber: doc.docNumber });
    return { success: true };
  }

  /** Preview JE จาก payload ร่าง (wizard step 2) — single source of truth ฝั่ง server */
  async journalPreview(dto: CreateEquityDocumentDto) {
    const lines = await this.resolveLines(dto.txnType, dto.lines ?? []);
    const jeLines = buildEquityJournal({
      txnType: dto.txnType,
      paymentAccountCode: dto.paymentAccountCode ?? null,
      paAccountCode: dto.paAccountCode ?? null,
      paAmount: dto.paAmount != null ? new D(dto.paAmount) : null,
      paDirection: (dto.paDirection ?? null) as PaDirection | null,
      lines: this.toBuilderLines(lines),
    });
    const codes = [...new Set(jeLines.map((l) => l.accountCode))];
    const coa = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: codes }, deletedAt: null },
      select: { code: true, name: true },
    });
    const nameByCode = new Map(coa.map((c) => [c.code, c.name]));
    return {
      lines: jeLines.map((l) => ({
        accountCode: l.accountCode,
        accountName: nameByCode.get(l.accountCode) ?? l.accountCode,
        debit: l.dr.toFixed(2),
        credit: l.cr.toFixed(2),
        description: l.description,
      })),
      resolvedLines: lines.map((l) => ({
        shareholderId: l.shareholderId,
        shareholderName: l.shareholderName,
        amount: l.amount.toFixed(2),
        premium: l.premium.toFixed(2),
        paid: l.paid.toFixed(2),
        wht: l.wht.toFixed(2),
      })),
    };
  }

  private async audit(userId: string, action: string, entityId: string, newValue: Prisma.InputJsonObject) {
    await this.prisma.auditLog.create({
      data: { userId, action, entity: 'equity_document', entityId, newValue },
    });
  }
}
```

- [ ] **Step 4: Controller (CRUD ส่วนแรก — literal routes ก่อน `:id` เสมอ)**

```ts
// apps/api/src/modules/equity/equity.controller.ts
import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post,
  Query, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { EquityService } from './equity.service';
import { CreateEquityDocumentDto } from './dto/create-equity-document.dto';
import { UpdateEquityDocumentDto } from './dto/update-equity-document.dto';
import { ReverseEquityDocumentDto } from './dto/reverse-equity-document.dto';
import { JournalPreviewDto } from './dto/journal-preview.dto';
import { CreateShareholderDto, UpdateShareholderDto } from './dto/shareholder.dto';
import { ListEquityDto } from './dto/list-equity.dto';

@Controller('equity')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
@UsePipes(new ValidationPipe({ whitelist: true }))
export class EquityController {
  constructor(private readonly service: EquityService) {}

  // ─── Shareholders (literal — ต้องมาก่อน documents/:id) ─────────────────
  @Get('shareholders')
  listShareholders() {
    return this.service.listShareholders();
  }

  @Post('shareholders')
  createShareholder(@Body() dto: CreateShareholderDto) {
    return this.service.createShareholder(dto);
  }

  @Patch('shareholders/:id')
  updateShareholder(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateShareholderDto) {
    return this.service.updateShareholder(id, dto);
  }

  // ─── Preview ────────────────────────────────────────────────────────────
  @Post('journal-preview')
  @HttpCode(200)
  journalPreview(@Body() dto: JournalPreviewDto) {
    return this.service.journalPreview(dto);
  }

  // ─── Documents ──────────────────────────────────────────────────────────
  @Get('documents')
  list(@Query() query: ListEquityDto) {
    return this.service.list(query);
  }

  @Get('documents/:id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findOne(id);
  }

  @Post('documents')
  create(@Body() dto: CreateEquityDocumentDto, @CurrentUser('id') userId: string) {
    return this.service.create(dto, userId);
  }

  @Patch('documents/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateEquityDocumentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.update(id, dto, userId);
  }

  @Delete('documents/:id')
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string) {
    return this.service.softDelete(id, userId);
  }

  // Task 5 เพิ่ม: submit / withdraw / post / reverse
  // Task 7 เพิ่ม: attachments
  // Task 8 เพิ่ม: dividend-register
}
```

- [ ] **Step 5: Module + app.module**

```ts
// apps/api/src/modules/equity/equity.module.ts
import { Module } from '@nestjs/common';
import { JournalModule } from '../journal/journal.module';
import { StorageModule } from '../storage/storage.module';
import { EquityController } from './equity.controller';
import { EquityService } from './equity.service';
import { EquityDocNumberService } from './services/equity-doc-number.service';

// PrismaService global ผ่าน PrismaModule (@Global) — ไม่ต้อง import
// JournalModule ให้ JournalAutoService + CompanyResolverService (ตรวจ exports ของ
// journal.module.ts — ถ้า CompanyResolverService ไม่ถูก export ให้เพิ่มใน exports ที่นั่น)
@Module({
  imports: [JournalModule, StorageModule],
  controllers: [EquityController],
  providers: [EquityService, EquityDocNumberService],
  exports: [EquityService],
})
export class EquityModule {}
```

`apps/api/src/app.module.ts` — เพิ่มถัดจาก `OtherIncomeModule` (import บรรทัด ~67, register บรรทัด ~249):

```ts
import { EquityModule } from './modules/equity/equity.module';
// ...ใน imports: [...]
    EquityModule,
```

- [ ] **Step 6: Typecheck + commit**

```bash
./tools/check-types.sh api
```
Expected: "TypeScript check passed!" — ถ้า `CompanyResolverService` ไม่ resolve ให้เพิ่มใน `exports` ของ `journal.module.ts` ตามหมายเหตุใน Step 5

```bash
git add apps/api/src/modules/equity apps/api/src/app.module.ts apps/api/src/modules/journal/journal.module.ts
git commit -m "feat(equity): scaffold module — doc number, DTOs, CRUD, shareholders, journal-preview"
```

---

### Task 5: Lifecycle — submit / withdraw / post / reverse + GL guards + maker-checker

**Files:**
- Modify: `apps/api/src/modules/equity/equity.service.ts` (เพิ่ม methods)
- Modify: `apps/api/src/modules/equity/equity.controller.ts` (เพิ่ม endpoints)

**Interfaces:**
- Consumes: `validatePeriodOpen` จาก `../../utils/period-lock.util`; `JeLineInput` จาก `../journal/journal-auto.service`; `validateEquityDoc` (Task 3); `buildEquityJournal` + `EQ_ACCOUNTS` (Task 2)
- Produces: `submit(id, userId)`, `withdraw(id, userId)`, `post(id, userId)`, `reverse(id, dto, userId)`, `isMakerCheckerEnabled()` — Task 6 integration spec + Task 11 frontend เรียกใช้

- [ ] **Step 1: เพิ่ม imports + lifecycle methods ใน EquityService**

เพิ่ม import ด้านบนไฟล์:

```ts
import { ForbiddenException } from '@nestjs/common';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { JeLineInput } from '../journal/journal-auto.service';
import { EQ_ACCOUNTS } from './equity-journal.builder';
```

เพิ่ม methods (ท้าย class ก่อน `audit()`):

```ts
  // ─── Maker-checker (SystemConfig EQUITY_MAKER_CHECKER_ENABLED, default OFF) ─

  async isMakerCheckerEnabled(): Promise<{ enabled: boolean }> {
    try {
      const row = await this.prisma.systemConfig.findUnique({
        where: { key: 'EQUITY_MAKER_CHECKER_ENABLED' },
      });
      return { enabled: row?.value === 'true' };
    } catch {
      return { enabled: false };
    }
  }

  // ─── Workflow: submit / withdraw ────────────────────────────────────────

  /** DRAFT → READY (เมื่อ maker-checker เปิด) — validate ครบก่อนส่ง */
  async submit(id: string, userId: string) {
    const { enabled } = await this.isMakerCheckerEnabled();
    if (!enabled) {
      throw new BadRequestException('Maker-Checker ปิดอยู่ — กดลงบัญชีได้โดยตรง ไม่ต้องส่งอนุมัติ');
    }
    const doc = await this.findOne(id);
    if (doc.status !== 'DRAFT') {
      throw new ConflictException(`เอกสาร ${doc.docNumber} สถานะ ${doc.status} — ส่งอนุมัติได้เฉพาะร่าง`);
    }
    this.assertDocValid(doc);
    if (doc.txnType === 'CAP_INIT') await this.assertInitOnce(id);

    const claimed = await this.prisma.equityDocument.updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'READY' },
    });
    if (claimed.count === 0) {
      throw new ConflictException('เอกสารถูกเปลี่ยนสถานะโดยผู้อื่นแล้ว — กรุณารีโหลด');
    }
    await this.audit(userId, 'EQUITY_SUBMITTED', id, { docNumber: doc.docNumber });
    return this.findOne(id);
  }

  /** READY → DRAFT — maker เท่านั้น */
  async withdraw(id: string, userId: string) {
    const doc = await this.findOne(id);
    if (doc.status !== 'READY') {
      throw new ConflictException(`เอกสาร ${doc.docNumber} สถานะ ${doc.status} — ถอนได้เฉพาะรออนุมัติ`);
    }
    if (doc.makerId !== userId) {
      throw new ForbiddenException('เฉพาะผู้สร้างเอกสารจึงจะถอนกลับเป็นร่างได้');
    }
    await this.prisma.equityDocument.update({ where: { id }, data: { status: 'DRAFT' } });
    await this.audit(userId, 'EQUITY_WITHDRAWN', id, { docNumber: doc.docNumber });
    return this.findOne(id);
  }

  /** โยน BadRequestException เมื่อ validateEquityDoc ไม่ผ่าน (ใช้ตอน submit + post) */
  private assertDocValid(doc: Awaited<ReturnType<EquityService['findOne']>>) {
    const errors = validateEquityDoc(
      {
        txnType: doc.txnType,
        resolutionNo: doc.resolutionNo,
        resolutionDate: doc.resolutionDate,
        paymentAccountCode: doc.paymentAccountCode,
        paAccountCode: doc.paAccountCode,
        paAmount: doc.paAmount ? new D(doc.paAmount.toString()) : null,
        paDirection: doc.paDirection,
        lines: doc.lines.map((l) => ({
          shareholderId: l.shareholderId,
          amount: new D(l.amount.toString()),
          premium: new D(l.premium.toString()),
          paid: new D(l.paid.toString()),
          wht: new D(l.wht.toString()),
        })),
      },
      { hasAttachment: doc.attachments.length > 0 },
    );
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'ไม่ผ่านการตรวจสอบก่อนลงบัญชี', errors });
    }
  }

  // ─── GL guards ──────────────────────────────────────────────────────────

  /** ยอดคงเหลือทั้งบัญชี (POSTED, ไม่ลบ) — side 'cr' = ΣCr−ΣDr, 'dr' = ΣDr−ΣCr */
  private async accountBalance(
    client: Prisma.TransactionClient | PrismaService,
    accountCode: string,
    side: 'dr' | 'cr',
  ): Promise<Prisma.Decimal> {
    const expr = side === 'cr' ? 'jl.credit - jl.debit' : 'jl.debit - jl.credit';
    const rows = await client.$queryRawUnsafe<Array<{ balance: unknown }>>(
      `SELECT COALESCE(SUM(${expr}), 0)::decimal AS balance
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.journal_entry_id
       WHERE jl.account_code = $1
         AND jl.deleted_at IS NULL
         AND je.status = 'POSTED'
         AND je.deleted_at IS NULL`,
      accountCode,
    );
    return new D(String(rows[0]?.balance ?? 0));
  }

  // ─── Post (DRAFT→POSTED เมื่อ MC ปิด / READY→POSTED เมื่อ MC เปิด) ───────

  async post(id: string, userId: string) {
    const doc = await this.findOne(id);
    const { enabled: makerChecker } = await this.isMakerCheckerEnabled();

    if (makerChecker) {
      if (doc.status !== 'READY') {
        throw new ConflictException(
          `Maker-Checker เปิดอยู่ — เอกสารต้องผ่านการส่งอนุมัติก่อน (สถานะปัจจุบัน: ${doc.status})`,
        );
      }
      if (doc.makerId === userId) {
        throw new ForbiddenException('ผู้อนุมัติต้องไม่ใช่ผู้สร้างเอกสาร (Maker-Checker เปิดอยู่)');
      }
    } else if (doc.status !== 'DRAFT' && doc.status !== 'READY') {
      throw new ConflictException(`เอกสาร ${doc.docNumber} สถานะ ${doc.status} — ลงบัญชีซ้ำไม่ได้`);
    }

    this.assertDocValid(doc);
    if (doc.txnType === 'CAP_INIT') await this.assertInitOnce(id);

    const companyId = await this.companyResolver.getFinanceCompanyId();
    await validatePeriodOpen(this.prisma, doc.txnDate, companyId);

    const builderLines = this.toBuilderLines(doc.lines);
    const totalAmount = builderLines.reduce((s, l) => s.plus(l.amount), new D(0));

    // GL guards (อ่านยอดสด — เช็คซ้ำใน tx อีกรอบเพื่อปิด race)
    const runGlGuards = async (client: Prisma.TransactionClient | PrismaService) => {
      if (doc.txnType === 'DIV_PAY') {
        const payable = await this.accountBalance(client, EQ_ACCOUNTS.DIVIDEND_PAYABLE, 'cr');
        if (totalAmount.gt(payable)) {
          throw new BadRequestException(
            `V_DIV_PAY_LE_PAYABLE — ยอดจ่ายปันผล (${totalAmount.toFixed(2)}) เกินเงินปันผลค้างจ่ายในบัญชี 21-4104 (${payable.toFixed(2)}) — กรุณาบันทึกประกาศจ่ายปันผล (DIV_DEC) ก่อน`,
          );
        }
      }
      if (doc.txnType === 'CAP_DEC') {
        const capital = await this.accountBalance(client, EQ_ACCOUNTS.COMMON_STOCK, 'cr');
        if (totalAmount.gt(capital)) {
          throw new BadRequestException(
            `V_CAP_DEC_LE_CAPITAL — ยอดลดทุน (${totalAmount.toFixed(2)}) เกินหุ้นสามัญคงเหลือในบัญชี 31-1101 (${capital.toFixed(2)})`,
          );
        }
      }
    };
    await runGlGuards(this.prisma);

    // DIV_VS_RE — warning ไม่ block (ปันผลระหว่างกาลก่อนปิดปีทำได้) — ตอบกลับให้ UI แสดง
    let warning: string | null = null;
    if (doc.txnType === 'DIV_DEC') {
      const re = await this.accountBalance(this.prisma, EQ_ACCOUNTS.RETAINED_EARNINGS, 'cr');
      if (totalAmount.gt(re)) {
        warning = `DIV_VS_RE — ยอดปันผลที่ประกาศ (${totalAmount.toFixed(2)}) เกินกำไรสะสมในบัญชี 32-1101 (${re.toFixed(2)}) — ตรวจสอบว่าเป็นปันผลระหว่างกาลจากกำไรปีปัจจุบันจริง`;
      }
    }

    const jeLines = buildEquityJournal({
      txnType: doc.txnType,
      paymentAccountCode: doc.paymentAccountCode,
      paAccountCode: doc.paAccountCode,
      paAmount: doc.paAmount ? new D(doc.paAmount.toString()) : null,
      paDirection: doc.paDirection as PaDirection | null,
      lines: builderLines,
    });

    const posted = await this.prisma.$transaction(async (tx) => {
      // CAS claim — กันโพสต์แข่งกัน
      const claimed = await tx.equityDocument.updateMany({
        where: { id, status: doc.status },
        data: { status: 'POSTED', approverId: userId, postedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException('เอกสารถูกเปลี่ยนสถานะโดยผู้อื่นแล้ว — กรุณารีโหลด');
      }
      await runGlGuards(tx); // เช็คซ้ำใน tx ปิด race window

      const je = await this.journalAuto.createAndPost(
        {
          description: `ส่วนของผู้ถือหุ้น ${doc.txnType} ${doc.docNumber}${doc.description ? ` — ${doc.description}` : ''}`,
          reference: doc.id,
          companyId: doc.companyId,
          postedAt: doc.txnDate,
          metadata: {
            flow: 'equity',
            idempotencyKey: `equity:${doc.id}`,
            equityDocId: doc.id,
            docNumber: doc.docNumber,
            txnType: doc.txnType,
          },
          lines: jeLines.map<JeLineInput>((l) => ({
            accountCode: l.accountCode,
            dr: l.dr,
            cr: l.cr,
            description: l.description,
          })),
        },
        tx,
      );
      return tx.equityDocument.update({
        where: { id },
        data: { journalEntryId: je.id },
        include: { lines: true, attachments: true },
      });
    });

    await this.audit(userId, 'EQUITY_POSTED', id, {
      docNumber: doc.docNumber,
      txnType: doc.txnType,
      journalEntryId: posted.journalEntryId,
      totalAmount: totalAmount.toFixed(2),
      ...(warning ? { warning } : {}),
    });
    return { ...posted, warning };
  }

  // ─── Reverse (POSTED → REVERSED, mirror-reverse pattern interco) ────────

  async reverse(id: string, dto: ReverseEquityDocumentDto, userId: string) {
    const doc = await this.findOne(id);
    if (doc.status !== 'POSTED') {
      throw new ConflictException(`เอกสาร ${doc.docNumber} สถานะ ${doc.status} — กลับรายการได้เฉพาะที่ลงบัญชีแล้ว`);
    }
    if (!doc.journalEntryId) throw new BadRequestException(`เอกสาร ${doc.docNumber} ไม่มี JE reference`);

    const companyId = await this.companyResolver.getFinanceCompanyId();
    await validatePeriodOpen(this.prisma, new Date(), companyId); // reversal ลงวันนี้

    const originalJe = await this.prisma.journalEntry.findUnique({
      where: { id: doc.journalEntryId },
      include: { lines: true },
    });
    if (!originalJe) throw new NotFoundException(`ไม่พบ JE ${doc.journalEntryId}`);

    const reversed = await this.prisma.$transaction(async (tx) => {
      const reversedLines: JeLineInput[] = originalJe.lines.map((l) => ({
        accountCode: l.accountCode,
        dr: new D(l.credit.toString()),
        cr: new D(l.debit.toString()),
        description: `[กลับรายการ] ${l.description ?? ''}`.trim(),
      }));

      let result: { id: string; entryNumber: string };
      try {
        result = await this.journalAuto.createAndPost(
          {
            description: `[กลับรายการ] ${doc.docNumber} — ${dto.reason}`,
            reference: `${originalJe.id}:equity-reverse`,
            companyId: originalJe.companyId,
            metadata: {
              tag: 'REVERSAL',
              flow: 'equity-reverse',
              idempotencyKey: `equity-reverse:${originalJe.id}`,
              originalEntryId: originalJe.id,
              reversesEntryId: originalJe.id,
              equityDocId: doc.id,
            },
            lines: reversedLines,
          },
          tx,
        );
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('การกลับรายการเอกสารนี้ถูกลงบัญชีไปแล้ว (คำขอซ้ำ)');
        }
        throw err;
      }

      const meta = (originalJe.metadata ?? {}) as Record<string, unknown>;
      await tx.journalEntry.update({
        where: { id: originalJe.id },
        data: {
          metadata: {
            ...(meta as Prisma.InputJsonObject),
            reversed: true,
            reversedByEntryNumber: result.entryNumber,
          },
        },
      });

      return tx.equityDocument.update({
        where: { id },
        data: {
          status: 'REVERSED',
          reverseJournalEntryId: result.id,
          reverseReason: dto.reason,
          reversedAt: new Date(),
        },
        include: { lines: true, attachments: true },
      });
    });

    await this.audit(userId, 'EQUITY_REVERSED', id, {
      docNumber: doc.docNumber,
      reason: dto.reason,
      reverseJournalEntryId: reversed.reverseJournalEntryId,
    });
    return reversed;
  }
```

- [ ] **Step 2: เพิ่ม endpoints ใน controller**

แทน comment `// Task 5 เพิ่ม: ...` ด้วย:

```ts
  @Get('maker-checker-enabled')
  makerCheckerEnabled() {
    return this.service.isMakerCheckerEnabled();
  }

  @Post('documents/:id/submit')
  @HttpCode(200)
  submit(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string) {
    return this.service.submit(id, userId);
  }

  @Post('documents/:id/withdraw')
  @HttpCode(200)
  withdraw(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string) {
    return this.service.withdraw(id, userId);
  }

  @Post('documents/:id/post')
  @Roles('OWNER', 'FINANCE_MANAGER')
  @HttpCode(200)
  post(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string) {
    return this.service.post(id, userId);
  }

  @Post('documents/:id/reverse')
  @Roles('OWNER', 'FINANCE_MANAGER')
  @HttpCode(200)
  reverse(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReverseEquityDocumentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.reverse(id, dto, userId);
  }
```

**สำคัญ:** `@Get('maker-checker-enabled')` เป็น literal route — ต้องอยู่**ก่อน** `@Get('documents/:id')` ในไฟล์ (จริงๆ คนละ prefix จึงไม่ชน แต่คง convention เดิมของ other-income ไว้)

- [ ] **Step 3: Typecheck** — `./tools/check-types.sh api` → passed

- [ ] **Step 4: Commit** — `git add apps/api/src/modules/equity && git commit -m "feat(equity): lifecycle submit/withdraw/post/reverse + GL guards + maker-checker opt-in"`

---

### Task 6: Integration spec (vitest, DB จริง) + CI glob

**Files:**
- Create: `apps/api/src/modules/equity/__tests__/equity.integration.spec.ts`
- Modify: `.github/workflows/deploy-gcp.yml` (step "Run DB-backed money-invariant specs")

**Interfaces:**
- Consumes: `EquityService` ทั้งชุด (Task 4-5), `seedFinanceCoa` จาก `apps/api/prisma/seed-coa-finance`

**ข้อควรรู้:** ชื่อไฟล์ `*.integration.spec.ts` — jest มองไม่เห็น (testPathIgnorePatterns) รันได้เฉพาะ vitest; ต้องมี DB จริง (`DATABASE_URL` ชี้ dev DB ตาม `project_local_dev_setup`)

- [ ] **Step 1: เขียน integration spec**

```ts
// apps/api/src/modules/equity/__tests__/equity.integration.spec.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { EquityDocNumberService } from '../services/equity-doc-number.service';
import { EquityService } from '../equity.service';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';

const D = Prisma.Decimal;

/** ยอดทั้งบัญชี (POSTED) — mirror ของ EquityService.accountBalance ไว้ assert */
async function bal(prisma: PrismaService, code: string, side: 'dr' | 'cr') {
  const lines = await prisma.journalLine.findMany({
    where: { accountCode: code, deletedAt: null, journalEntry: { status: 'POSTED', deletedAt: null } },
    select: { debit: true, credit: true },
  });
  return lines.reduce(
    (s, l) =>
      side === 'dr'
        ? s.plus(l.debit.toString()).minus(l.credit.toString())
        : s.plus(l.credit.toString()).minus(l.debit.toString()),
    new D(0),
  );
}

describe('EquityService — integration (DB จริง)', () => {
  const prisma = new PrismaService();
  const service = new EquityService(
    prisma,
    new EquityDocNumberService(),
    new CompanyResolverService(prisma),
    new JournalAutoService(prisma),
  );
  let userId: string;
  let approverUserId: string;
  let sh1: string;
  let sh2: string;

  beforeAll(async () => {
    await prisma.$connect();
    await seedFinanceCoa(prisma as never);
    // FINANCE company + system user (admin@bestchoice.com) ต้องมี — สร้างถ้ายังไม่มี
    const finance = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE', deletedAt: null } });
    if (!finance) {
      await prisma.companyInfo.create({
        data: { companyCode: 'FINANCE', name: 'BESTCHOICE FINANCE (test)' } as never,
      });
    }
    const admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com', deletedAt: null } });
    if (!admin) throw new Error('ต้อง seed dev DB ก่อน (admin@bestchoice.com) — ดู project_local_dev_setup');
    userId = admin.id;
    const other = await prisma.user.findFirst({
      where: { email: { not: 'admin@bestchoice.com' }, deletedAt: null },
    });
    approverUserId = other?.id ?? admin.id;

    const a = await prisma.shareholder.create({
      data: { name: 'ผู้ถือหุ้นทดสอบ 1', taxId: '1100200111111', type: 'INDIVIDUAL' },
    });
    const b = await prisma.shareholder.create({
      data: { name: 'ผู้ถือหุ้นทดสอบ 2 (นิติบุคคล)', taxId: '0105500000001', type: 'JURISTIC_TH' },
    });
    sh1 = a.id;
    sh2 = b.id;
  });

  beforeEach(async () => {
    // ล้างเฉพาะข้อมูล equity ของเทสต์ — accountBalance เป็น whole-account จึงต้องเริ่มศูนย์ทุกครั้ง
    const jes = await prisma.journalEntry.findMany({
      where: {
        OR: [
          { metadata: { path: ['flow'], equals: 'equity' } },
          { metadata: { path: ['flow'], equals: 'equity-reverse' } },
        ],
      },
      select: { id: true },
    });
    const ids = jes.map((j) => j.id);
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: ids } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: ids } } });
    await prisma.equityAttachment.deleteMany({});
    await prisma.equityShareholderLine.deleteMany({});
    await prisma.equityDocument.deleteMany({});
    await prisma.systemConfig.deleteMany({ where: { key: 'EQUITY_MAKER_CHECKER_ENABLED' } });
  });

  afterAll(async () => {
    await prisma.shareholder.deleteMany({ where: { id: { in: [sh1, sh2] } } });
    await prisma.$disconnect();
  });

  const capInitDto = () => ({
    txnType: 'CAP_INIT' as const,
    txnDate: new Date().toISOString(),
    resolutionNo: 'MOA-TEST-001',
    resolutionDate: new Date().toISOString(),
    paymentAccountCode: '11-1201',
    lines: [
      { shareholderId: sh1, amount: 700000, paid: 700000 },
      { shareholderId: sh2, amount: 300000, paid: 0 },
    ],
  });

  async function withAttachment(docId: string) {
    await prisma.equityAttachment.create({
      data: { documentId: docId, s3Key: `test/${docId}.pdf`, filename: 'มติ.pdf', size: 100, mimeType: 'application/pdf', uploadedById: userId },
    });
  }

  it('CAP_INIT post → GL ถูกต้อง แล้ว reverse → net 0 ทุกบัญชี', async () => {
    const doc = await service.create(capInitDto(), userId);
    await withAttachment(doc.id);
    await service.post(doc.id, userId);

    expect((await bal(prisma, '31-1101', 'cr')).toFixed(2)).toBe('1000000.00');
    expect((await bal(prisma, '11-1310', 'dr')).toFixed(2)).toBe('300000.00');
    expect((await bal(prisma, '11-1201', 'dr')).toFixed(2)).toBe('700000.00');

    await service.reverse(doc.id, { reason: 'ทดสอบกลับรายการยาวสิบตัวอักษร' }, userId);
    expect((await bal(prisma, '31-1101', 'cr')).toFixed(2)).toBe('0.00');
    expect((await bal(prisma, '11-1310', 'dr')).toFixed(2)).toBe('0.00');
    expect((await bal(prisma, '11-1201', 'dr')).toFixed(2)).toBe('0.00');

    const after = await service.findOne(doc.id);
    expect(after.status).toBe('REVERSED');
    expect(after.reverseJournalEntryId).toBeTruthy();
  });

  it('V_INIT_ONCE — สร้าง CAP_INIT ใบสองไม่ได้ จนกว่าใบแรกถูก reverse', async () => {
    const doc = await service.create(capInitDto(), userId);
    await expect(service.create(capInitDto(), userId)).rejects.toThrow(/CAP_INIT/);
    await withAttachment(doc.id);
    await service.post(doc.id, userId);
    await service.reverse(doc.id, { reason: 'กลับรายการเพื่อทดสอบระบบ' }, userId);
    await expect(service.create(capInitDto(), userId)).resolves.toBeTruthy();
  });

  it('V_DIV_PAY_LE_PAYABLE — DIV_PAY โดยไม่มี DIV_DEC ถูก block; หลัง DIV_DEC ผ่าน + WHT default', async () => {
    const payDto = {
      txnType: 'DIV_PAY' as const,
      txnDate: new Date().toISOString(),
      paymentAccountCode: '11-1201',
      lines: [
        { shareholderId: sh1, amount: 60000 }, // INDIVIDUAL → WHT default 6000
        { shareholderId: sh2, amount: 40000 }, // JURISTIC_TH → 0
      ],
    };
    const pay1 = await service.create(payDto, userId);
    await expect(service.post(pay1.id, userId)).rejects.toThrow(/V_DIV_PAY_LE_PAYABLE/);

    const dec = await service.create({
      txnType: 'DIV_DEC' as const,
      txnDate: new Date().toISOString(),
      resolutionNo: 'AGM-TEST-001',
      resolutionDate: new Date().toISOString(),
      lines: [
        { shareholderId: sh1, amount: 60000 },
        { shareholderId: sh2, amount: 40000 },
      ],
    }, userId);
    await withAttachment(dec.id);
    const decRes = await service.post(dec.id, userId);
    // 32-1101 ว่าง → DIV_VS_RE warning (ไม่ block)
    expect(decRes.warning).toMatch(/DIV_VS_RE/);

    const posted = await service.post(pay1.id, userId);
    expect(posted.warning ?? null).toBeNull();
    expect((await bal(prisma, '21-4104', 'cr')).toFixed(2)).toBe('0.00'); // ตัดหมด
    expect((await bal(prisma, '21-3104', 'cr')).toFixed(2)).toBe('6000.00'); // WHT default เฉพาะบุคคลธรรมดา
    const payDoc = await service.findOne(pay1.id);
    expect(payDoc.lines.find((l) => l.shareholderId === sh1)!.wht.toString()).toBe('6000');
    expect(payDoc.lines.find((l) => l.shareholderId === sh2)!.wht.toString()).toBe('0');
  });

  it('V_CAP_DEC_LE_CAPITAL — ลดทุนเกิน 31-1101 ถูก block', async () => {
    const dec = await service.create({
      txnType: 'CAP_DEC' as const,
      txnDate: new Date().toISOString(),
      resolutionNo: 'EGM-TEST-001',
      resolutionDate: new Date().toISOString(),
      paymentAccountCode: '11-1201',
      lines: [{ shareholderId: sh1, amount: 50000 }],
    }, userId);
    await withAttachment(dec.id);
    await expect(service.post(dec.id, userId)).rejects.toThrow(/V_CAP_DEC_LE_CAPITAL/);
  });

  it('post ซ้ำ → ConflictException (status guard)', async () => {
    const doc = await service.create(capInitDto(), userId);
    await withAttachment(doc.id);
    await service.post(doc.id, userId);
    await expect(service.post(doc.id, userId)).rejects.toThrow(/ลงบัญชีซ้ำไม่ได้|สถานะ/);
  });

  it('maker-checker ON — maker โพสต์เองไม่ได้ ต้อง submit แล้วให้อีกคนโพสต์', async () => {
    await prisma.systemConfig.create({
      data: { key: 'EQUITY_MAKER_CHECKER_ENABLED', value: 'true' },
    });
    const doc = await service.create(capInitDto(), userId);
    await withAttachment(doc.id);
    await expect(service.post(doc.id, userId)).rejects.toThrow(/ส่งอนุมัติก่อน/);
    await service.submit(doc.id, userId);
    if (approverUserId !== userId) {
      await expect(service.post(doc.id, userId)).rejects.toThrow(/ผู้อนุมัติต้องไม่ใช่ผู้สร้าง/);
      await service.post(doc.id, approverUserId);
      expect((await service.findOne(doc.id)).status).toBe('POSTED');
    } else {
      await expect(service.post(doc.id, userId)).rejects.toThrow(/ผู้อนุมัติต้องไม่ใช่ผู้สร้าง/);
    }
  });

  it('period guard — txnDate ในงวด CLOSED ถูก block', async () => {
    const companyId = (await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } }))!.id;
    const closed = new Date(2020, 0, 15); // ม.ค. 2020
    await prisma.accountingPeriod.upsert({
      where: { companyId_year_month: { companyId, year: 2020, month: 1 } },
      update: { status: 'CLOSED' },
      create: { companyId, year: 2020, month: 1, status: 'CLOSED' } as never,
    });
    const doc = await service.create({ ...capInitDto(), txnDate: closed.toISOString() }, userId);
    await withAttachment(doc.id);
    await expect(service.post(doc.id, userId)).rejects.toThrow(/งวดที่ปิดแล้ว/);
  });
});
```

- [ ] **Step 2: รัน local ให้ผ่าน**

```bash
cd apps/api
npx vitest run src/modules/equity/__tests__/equity.integration.spec.ts
```
Expected: PASS 7 tests (ต้องมี docker DB + seed ตาม `project_local_dev_setup`; ถ้า schema ของ `companyInfo.create`/`accountingPeriod.create` ต้องการ field บังคับเพิ่ม ให้เติมตาม error ที่เจอ — โครง DB จริงคือ source of truth)

- [ ] **Step 3: เพิ่ม CI glob**

ใน `.github/workflows/deploy-gcp.yml` step "Run DB-backed money-invariant specs (vitest — #1328)" — เพิ่มบรรทัดหลัง `DASH_FILES=...`:

```yaml
          # Equity module E2E (2026-08-10) — same jest-invisible *.integration.spec.ts naming
          EQUITY_FILES=$(ls src/modules/equity/__tests__/*.integration.spec.ts)
```

และเพิ่ม `$EQUITY_FILES \` ต่อท้ายรายการ argument ของ `npx vitest run` (หลัง `$DASH_FILES` ใส่ `\` ให้บรรทัดเดิมก่อน):

```yaml
            $DASH_FILES \
            $EQUITY_FILES
```

- [ ] **Step 4: Commit** — `git add apps/api/src/modules/equity/__tests__ .github/workflows/deploy-gcp.yml && git commit -m "test(equity): integration spec 7 เคส (GL/guards/MC/period) + CI glob EQUITY_FILES"`

---

### Task 7: Attachments — S3 upload / signed-url / delete

**Files:**
- Create: `apps/api/src/modules/equity/services/equity-attachment.service.ts`
- Test: `apps/api/src/modules/equity/services/equity-attachment.service.spec.ts`
- Modify: `apps/api/src/modules/equity/equity.controller.ts`, `equity.module.ts`

**Interfaces:**
- Consumes: `StorageService` จาก `../../storage/storage.service` (`upload(key, buffer, contentType)`, `getSignedDownloadUrl(key, expiresIn)`, `delete(key)`)
- Produces: `upload(docId, file, userId)`, `getSignedUrl(attachmentId)`, `remove(docId, attachmentId, userId)`

- [ ] **Step 1: เขียน failing spec (jest, mocked prisma/storage)**

```ts
// apps/api/src/modules/equity/services/equity-attachment.service.spec.ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { EquityAttachmentService } from './equity-attachment.service';

const pdfBuffer = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(20)]);
const fakePngNamedPdf = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)]);
const file = (buf: Buffer, mimetype = 'application/pdf'): Express.Multer.File =>
  ({ buffer: buf, mimetype, originalname: 'มติ.pdf', size: buf.length }) as Express.Multer.File;

describe('EquityAttachmentService', () => {
  const prisma = {
    equityDocument: { findFirst: jest.fn() },
    equityAttachment: { create: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
  };
  const storage = { upload: jest.fn(), delete: jest.fn(), getSignedDownloadUrl: jest.fn() };
  const service = new EquityAttachmentService(prisma as never, storage as never);

  beforeEach(() => jest.clearAllMocks());

  it('อัพโหลดสำเร็จเมื่อ DRAFT + magic bytes ตรง', async () => {
    prisma.equityDocument.findFirst.mockResolvedValue({ id: 'doc-1', status: 'DRAFT' });
    prisma.equityAttachment.create.mockResolvedValue({ id: 'att-1' });
    await service.upload('doc-1', file(pdfBuffer), 'user-1');
    expect(storage.upload).toHaveBeenCalled();
    expect(prisma.equityAttachment.create).toHaveBeenCalled();
  });

  it('ปฏิเสธไฟล์ magic bytes ไม่ตรง mimetype (PNG ปลอมเป็น PDF)', async () => {
    prisma.equityDocument.findFirst.mockResolvedValue({ id: 'doc-1', status: 'DRAFT' });
    await expect(service.upload('doc-1', file(fakePngNamedPdf), 'user-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('ปฏิเสธเมื่อเอกสาร POSTED แล้ว', async () => {
    prisma.equityDocument.findFirst.mockResolvedValue({ id: 'doc-1', status: 'POSTED' });
    await expect(service.upload('doc-1', file(pdfBuffer), 'user-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('ลบไฟล์ได้เฉพาะ DRAFT/READY', async () => {
    prisma.equityDocument.findFirst.mockResolvedValue({ id: 'doc-1', status: 'POSTED' });
    prisma.equityAttachment.findFirst.mockResolvedValue({ id: 'att-1', s3Key: 'k', documentId: 'doc-1' });
    await expect(service.remove('doc-1', 'att-1', 'user-1')).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 2: รันให้ fail** — `npx jest src/modules/equity/services/equity-attachment.service.spec.ts` → FAIL

- [ ] **Step 3: implement**

```ts
// apps/api/src/modules/equity/services/equity-attachment.service.ts
import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

/** แนบไฟล์มติที่ประชุม — pattern เดียวกับ interco uploadSlip (magic-byte re-check + rollback) */
@Injectable()
export class EquityAttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private async findDocOrFail(docId: string) {
    const doc = await this.prisma.equityDocument.findFirst({
      where: { id: docId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');
    return doc;
  }

  async upload(docId: string, file: Express.Multer.File, userId: string) {
    const doc = await this.findDocOrFail(docId);
    if (doc.status !== 'DRAFT' && doc.status !== 'READY') {
      throw new ConflictException('แนบไฟล์ได้เฉพาะเอกสารสถานะร่างหรือรออนุมัติ');
    }
    if (!this.matchesMimeMagicBytes(file)) {
      throw new BadRequestException('ประเภทไฟล์ไม่ตรงกับเนื้อหา (รองรับเฉพาะ PDF, JPEG, PNG, WEBP)');
    }
    const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    // eslint-disable-next-line no-control-regex
    const safeName = decodedName.replace(/[<>:"/\\|?*\x00-\s]/g, '_');
    const key = `equity/${docId}/${Date.now()}-${randomUUID()}-${safeName}`;

    await this.storage.upload(key, file.buffer, file.mimetype);
    try {
      return await this.prisma.equityAttachment.create({
        data: {
          documentId: docId,
          s3Key: key,
          filename: decodedName,
          size: file.size,
          mimeType: file.mimetype,
          uploadedById: userId,
        },
      });
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  async getSignedUrl(attachmentId: string): Promise<{ url: string; expiresIn: number }> {
    const att = await this.prisma.equityAttachment.findFirst({ where: { id: attachmentId } });
    if (!att) throw new NotFoundException('ไม่พบไฟล์แนบ');
    const expiresIn = 900;
    const url = await this.storage.getSignedDownloadUrl(att.s3Key, expiresIn);
    return { url, expiresIn };
  }

  async remove(docId: string, attachmentId: string, userId: string) {
    const doc = await this.findDocOrFail(docId);
    if (doc.status !== 'DRAFT' && doc.status !== 'READY') {
      throw new ConflictException('ลบไฟล์ได้เฉพาะเอกสารสถานะร่างหรือรออนุมัติ');
    }
    const att = await this.prisma.equityAttachment.findFirst({
      where: { id: attachmentId, documentId: docId },
    });
    if (!att) throw new NotFoundException('ไม่พบไฟล์แนบ');
    await this.prisma.equityAttachment.delete({ where: { id: attachmentId } });
    await this.storage.delete(att.s3Key).catch(() => undefined);
    return { success: true, removedBy: userId };
  }

  private matchesMimeMagicBytes(file: Express.Multer.File): boolean {
    const buf = file.buffer;
    if (!buf || buf.length < 12) return false;
    const mime = file.mimetype;
    if (mime === 'application/pdf') {
      return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d;
    }
    if (mime === 'image/jpeg') {
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    }
    if (mime === 'image/png') {
      return (
        buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
        buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
      );
    }
    if (mime === 'image/webp') {
      return (
        buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
      );
    }
    return false;
  }
}
```

หมายเหตุ spec เทียบ magic-byte PDF: buffer `%PDF-` = `[0x25,0x50,0x44,0x46,0x2d]` — spec Step 1 ใช้ `Buffer.from('%PDF-')` ตรงแล้ว

- [ ] **Step 4: controller endpoints + module provider**

Controller — แทน comment `// Task 7 เพิ่ม: attachments` (เพิ่ม imports: `FileTypeValidator, MaxFileSizeValidator, ParseFilePipe, UploadedFile, UseInterceptors` จาก `@nestjs/common`, `FileInterceptor` จาก `@nestjs/platform-express`, และ inject `EquityAttachmentService` ใน constructor):

```ts
  @Post('documents/:id/attachments')
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') userId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024, message: 'ไฟล์มีขนาดเกิน 5MB' }),
          new FileTypeValidator({ fileType: /^(application\/pdf|image\/(jpeg|png|webp))$/ }),
        ],
        fileIsRequired: true,
        errorHttpStatusCode: 400,
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.attachments.upload(id, file, userId);
  }

  @Get('attachments/:attId/signed-url')
  attachmentSignedUrl(@Param('attId', new ParseUUIDPipe()) attId: string) {
    return this.attachments.getSignedUrl(attId);
  }

  @Delete('documents/:id/attachments/:attId')
  removeAttachment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('attId', new ParseUUIDPipe()) attId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.attachments.remove(id, attId, userId);
  }
```

`equity.module.ts` — เพิ่ม `EquityAttachmentService` ใน `providers`

- [ ] **Step 5: รันให้ pass + typecheck + commit**

```bash
cd apps/api && npx jest src/modules/equity/services/equity-attachment.service.spec.ts
./tools/check-types.sh api
git add apps/api/src/modules/equity && git commit -m "feat(equity): แนบไฟล์มติ — S3 upload + magic-byte check + signed url"
```

---

### Task 8: ทะเบียนปันผล + ภ.ง.ด.2 (preview + XLSX)

**Files:**
- Create: `apps/api/src/modules/equity/services/equity-report.service.ts`
- Test: `apps/api/src/modules/equity/services/equity-report.service.spec.ts`
- Modify: `apps/api/src/modules/equity/equity.controller.ts`, `equity.module.ts`
- Modify: `apps/api/src/modules/tax/tax.service.ts` (เพิ่ม `'PND2'` ใน `TaxFormCode` + delegate)
- Modify: `apps/api/src/modules/tax/services/tax-preview.service.ts` (เพิ่ม `previewPnd2`)
- Modify: `apps/api/src/modules/tax/services/tax-export.service.ts` (เพิ่ม branch PND2)
- Modify: `apps/api/src/modules/tax/tax.controller.ts` (เพิ่ม route + เพิ่ม `'PND2'` ใน ALLOWED)

**Interfaces:**
- Produces: `GET /equity/dividend-register?year=` → `{ year, rows: [{ shareholderId, name, taxId, type, payCount, gross, wht, net, docNumbers[] }], totals }` · `GET /tax/pnd2-preview?year=&month=` (อ่านเอกสาร DIV_PAY POSTED — ใบ REVERSED หลุดอัตโนมัติ, pattern เดียวกับ previewPayrollWHT) · `GET /tax/export-xlsx?form=PND2&year=&month=`

- [ ] **Step 1: เขียน failing spec (jest, mocked prisma)**

```ts
// apps/api/src/modules/equity/services/equity-report.service.spec.ts
import { Prisma } from '@prisma/client';
import { EquityReportService } from './equity-report.service';

const D = Prisma.Decimal;

describe('EquityReportService.dividendRegister', () => {
  const prisma = { equityDocument: { findMany: jest.fn() } };
  const service = new EquityReportService(prisma as never);

  it('aggregate ต่อผู้ถือหุ้นข้ามหลายใบ + totals', async () => {
    prisma.equityDocument.findMany.mockResolvedValue([
      {
        docNumber: 'EQ-20260410-0001', txnDate: new Date('2026-04-10'),
        lines: [
          { shareholderId: 'a', shareholderName: 'ก', amount: new D(100000), wht: new D(10000),
            shareholder: { taxId: '111', type: 'INDIVIDUAL' } },
          { shareholderId: 'b', shareholderName: 'ข', amount: new D(60000), wht: new D(0),
            shareholder: { taxId: '222', type: 'JURISTIC_TH' } },
        ],
      },
      {
        docNumber: 'EQ-20260810-0002', txnDate: new Date('2026-08-10'),
        lines: [
          { shareholderId: 'a', shareholderName: 'ก', amount: new D(50000), wht: new D(5000),
            shareholder: { taxId: '111', type: 'INDIVIDUAL' } },
        ],
      },
    ]);
    const r = await service.dividendRegister(2026);
    const a = r.rows.find((x) => x.shareholderId === 'a')!;
    expect(a.payCount).toBe(2);
    expect(a.gross).toBe('150000.00');
    expect(a.wht).toBe('15000.00');
    expect(a.net).toBe('135000.00');
    expect(a.docNumbers).toEqual(['EQ-20260410-0001', 'EQ-20260810-0002']);
    expect(r.totals.gross).toBe('210000.00');
    expect(r.totals.wht).toBe('15000.00');
  });
});
```

- [ ] **Step 2: รันให้ fail** → FAIL (module not found)

- [ ] **Step 3: implement report service**

```ts
// apps/api/src/modules/equity/services/equity-report.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

const D = Prisma.Decimal;

/** ทะเบียนปันผลรายปี — อ่านจากเอกสาร DIV_PAY ที่ POSTED (ไม่เดิน GL — ใบ REVERSED หลุดเอง) */
@Injectable()
export class EquityReportService {
  constructor(private readonly prisma: PrismaService) {}

  async dividendRegister(year: number) {
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59, 999);
    const docs = await this.prisma.equityDocument.findMany({
      where: {
        txnType: 'DIV_PAY',
        status: 'POSTED',
        deletedAt: null,
        txnDate: { gte: start, lte: end },
      },
      orderBy: { txnDate: 'asc' },
      include: { lines: { include: { shareholder: { select: { taxId: true, type: true } } } } },
    });

    const byId = new Map<string, {
      shareholderId: string; name: string; taxId: string | null; type: string;
      payCount: number; gross: Prisma.Decimal; wht: Prisma.Decimal; docNumbers: string[];
    }>();
    for (const doc of docs) {
      for (const ln of doc.lines) {
        const cur = byId.get(ln.shareholderId) ?? {
          shareholderId: ln.shareholderId,
          name: ln.shareholderName,
          taxId: ln.shareholder?.taxId ?? null,
          type: ln.shareholder?.type ?? 'INDIVIDUAL',
          payCount: 0,
          gross: new D(0),
          wht: new D(0),
          docNumbers: [] as string[],
        };
        cur.payCount += 1;
        cur.gross = cur.gross.plus(ln.amount.toString());
        cur.wht = cur.wht.plus(ln.wht.toString());
        cur.docNumbers.push(doc.docNumber);
        byId.set(ln.shareholderId, cur);
      }
    }
    const rows = [...byId.values()].map((r) => ({
      ...r,
      gross: r.gross.toFixed(2),
      wht: r.wht.toFixed(2),
      net: r.gross.minus(r.wht).toFixed(2),
    }));
    const totals = rows.reduce(
      (t, r) => ({
        gross: t.gross.plus(r.gross),
        wht: t.wht.plus(r.wht),
        net: t.net.plus(r.net),
      }),
      { gross: new D(0), wht: new D(0), net: new D(0) },
    );
    return {
      year,
      rows,
      totals: { gross: totals.gross.toFixed(2), wht: totals.wht.toFixed(2), net: totals.net.toFixed(2) },
    };
  }
}
```

- [ ] **Step 4: controller endpoint + provider**

Controller — แทน comment `// Task 8 เพิ่ม: dividend-register` (inject `EquityReportService`; **literal route — วางไว้ก่อนกลุ่ม `documents/:id`**):

```ts
  @Get('dividend-register')
  dividendRegister(@Query('year') year: string) {
    const y = parseInt(year, 10);
    if (!Number.isInteger(y) || y < 2020 || y > 2100) {
      throw new BadRequestException('ปีไม่ถูกต้อง (ค.ศ.)');
    }
    return this.reports.dividendRegister(y);
  }
```
(เพิ่ม `BadRequestException` ใน imports ของ controller) · `equity.module.ts` เพิ่ม `EquityReportService` ใน providers

- [ ] **Step 5: PND2 ใน tax module**

`tax.service.ts` — ขยาย type + delegate:
```ts
export type TaxFormCode = 'PP30' | 'PND1' | 'PND3' | 'PND53' | 'SSO110' | 'PND1A' | 'PND2';
// เพิ่ม method:
  async previewPnd2(year: number, month: number) {
    return this.preview.previewPnd2(year, month);
  }
```

`services/tax-preview.service.ts` — เพิ่ม method (pattern เดียวกับ previewPayrollWHT — อ่านเอกสาร ไม่เดิน GL):
```ts
  /** ภ.ง.ด.2 รายเดือน — จากเอกสาร equity DIV_PAY ที่ POSTED (จ่ายจริงในเดือนนั้น, ม.52 ยื่นใน 7 วันเดือนถัดไป) */
  async previewPnd2(year: number, month: number) {
    const { startDate, endDate } = this.getDateRange(year, month);
    const docs = await this.prisma.equityDocument.findMany({
      where: {
        txnType: 'DIV_PAY',
        status: 'POSTED',
        journalEntryId: { not: null },
        deletedAt: null,
        txnDate: { gte: startDate, lte: endDate },
      },
      orderBy: { txnDate: 'asc' },
      select: {
        docNumber: true,
        txnDate: true,
        lines: {
          select: {
            shareholderName: true,
            amount: true,
            wht: true,
            shareholder: { select: { taxId: true, type: true } },
          },
        },
      },
    });
    const items = docs.flatMap((doc) =>
      doc.lines.map((ln) => ({
        shareholderName: ln.shareholderName,
        taxId: ln.shareholder?.taxId ?? null,
        type: ln.shareholder?.type ?? 'INDIVIDUAL',
        gross: ln.amount,
        whtAmount: ln.wht,
        payDate: doc.txnDate,
        docNumber: doc.docNumber,
      })),
    );
    const grossIncome = items.reduce((s, x) => s.add(x.gross), new Prisma.Decimal(0));
    const whtTotal = items.reduce((s, x) => s.add(x.whtAmount), new Prisma.Decimal(0));
    return { items, grossIncome, whtTotal, count: items.length, period: { year, month, startDate, endDate }, form: 'PND2' as const };
  }
```

`tax.controller.ts` — เพิ่ม route + แก้ ALLOWED:
```ts
  @Get('pnd2-preview')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  previewPnd2(@Query('year') year: string, @Query('month') month: string) {
    const y = parseInt(year); const m = parseInt(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      throw new BadRequestException('ปี/เดือนไม่ถูกต้อง');
    }
    return this.taxService.previewPnd2(y, m);
  }
```
ใน `exportXlsx`: `const ALLOWED: TaxFormCode[] = ['PP30', 'PND1', 'PND3', 'PND53', 'SSO110', 'PND1A', 'PND2'];` และ PND2 เป็น company-wide เหมือน SSO110/PND1A: `const companyWide = form === 'SSO110' || form === 'PND1A' || form === 'PND2';`

`services/tax-export.service.ts` — เพิ่ม branch (ก่อนบรรทัด `writeBuffer`):
```ts
    } else if (form === 'PND2') {
      const data = await this.preview.previewPnd2(year, month);
      const sheet = workbook.addWorksheet(`PND2-${year}-${String(month).padStart(2, '0')}`);
      sheet.columns = [
        { header: 'ลำดับ', key: 'no', width: 6 },
        { header: 'ผู้รับเงินปันผล', key: 'name', width: 30 },
        { header: 'เลขประจำตัวผู้เสียภาษี', key: 'taxId', width: 22 },
        { header: 'วันที่จ่าย', key: 'payDate', width: 14 },
        { header: 'เงินปันผล (บาท)', key: 'gross', width: 18 },
        { header: 'ภาษีหัก ณ ที่จ่าย 10% (บาท)', key: 'wht', width: 22 },
        { header: 'เอกสารอ้างอิง', key: 'doc', width: 20 },
      ];
      sheet.getRow(1).font = { bold: true };
      data.items.forEach((it, idx) => {
        sheet.addRow({
          no: idx + 1, name: it.shareholderName, taxId: it.taxId ?? '',
          payDate: it.payDate.toISOString().slice(0, 10),
          gross: Number(it.gross), wht: Number(it.whtAmount), doc: it.docNumber,
        });
      });
      const total = sheet.addRow({});
      total.getCell('name').value = 'รวม';
      total.getCell('gross').value = Number(data.grossIncome);
      total.getCell('wht').value = Number(data.whtTotal);
      total.font = { bold: true };
    }
```

- [ ] **Step 6: รัน spec + typecheck + commit**

```bash
cd apps/api
npx jest src/modules/equity/services/equity-report.service.spec.ts
npx jest src/modules/tax   # กัน regression ใน tax specs เดิม
./tools/check-types.sh api
git add apps/api/src/modules/equity apps/api/src/modules/tax
git commit -m "feat(equity): ทะเบียนปันผลรายปี + ภ.ง.ด.2 preview/XLSX (form=PND2)"
```

---

### Task 9: SOCE — capitalStatus block + caveat conditional

**Files:**
- Modify: `apps/api/src/modules/accounting/general-ledger-report.service.ts` (`getEquityStatementFromJournal`, lines ~789-909)
- Test: `apps/api/src/modules/accounting/equity-capital-status.integration.spec.ts` (glob `src/modules/accounting/*.integration.spec.ts` ใน CI ครอบอยู่แล้ว — ไม่ต้องแก้ yml)

**Interfaces:**
- Produces: response ของ `GET /expenses/ledger/equity-statement` เพิ่ม `capitalStatus: { authorized, unpaid, paidUp, premium: number }` และ `caveat` เป็น conditional — Task 12 frontend ใช้

- [ ] **Step 1: แก้ getEquityStatementFromJournal**

ก่อน `return { ... }` (บรรทัด ~899) เพิ่ม:

```ts
    // Equity module (2026-08-10): สถานะทุนจดทะเบียน — 11-1310 เป็น Dr-normal อยู่นอก EQUITY_ACCOUNTS
    const authorized = await this.sumAccountBalances(['31-1101'], periodEnd, 'Cr', companyId);
    const unpaid = await this.sumAccountBalances(['11-1310'], periodEnd, 'Dr', companyId);
    const premium = await this.sumAccountBalances(['31-1102'], periodEnd, 'Cr', companyId);
    const capitalStatus = {
      authorized: authorized.toNumber(),
      unpaid: unpaid.toNumber(),
      paidUp: authorized.sub(unpaid).toNumber(),
      premium: premium.toNumber(),
    };

    // Caveat conditional (ปิด gap เดิมที่ documented ใน .claude/rules/accounting.md):
    // มี year-end closing ของปีนั้นที่ยังไม่ถูก reverse → เปลี่ยนข้อความ
    const yeCandidates = await this.prisma.journalEntry.findMany({
      where: {
        status: 'POSTED',
        deletedAt: null,
        AND: [
          { metadata: { path: ['flow'], equals: 'year-end-closing' } },
          { metadata: { path: ['year'], equals: periodEnd.getFullYear() } },
        ],
      },
      select: { metadata: true },
    });
    const yearClosed = yeCandidates.some((je) => {
      const m = (je.metadata ?? {}) as Record<string, unknown>;
      return !m.reversedByBatchId;
    });
    const caveat = yearClosed
      ? `ปิดบัญชีสิ้นปี ${periodEnd.getFullYear()} แล้ว — กำไรปีปัจจุบันถูกโอนเข้า 33-1101/32-1101 เรียบร้อย`
      : 'ค่าประมาณกำไรปีปัจจุบัน — ยังไม่ปิดบัญชีจริงเข้า 33-1101 / 32-1101 (รอปิดบัญชีสิ้นปี)';
```

แล้วแก้ `return` เดิม: ลบ `caveat: '...'` string ตายตัว → ใช้ตัวแปร `caveat`, และเพิ่ม `capitalStatus`:

```ts
    return {
      periodStart,
      periodEnd,
      rows,
      currentYearProfit,
      caveat,
      capitalStatus,
      totalOpening: totalOpening.toNumber(),
      totalClosing: totalClosing.toNumber(),
    };
```

**ตรวจก่อนแก้:** `metadata.year` ใน year-end-closing JE เป็น number หรือ string — เปิด `apps/api/src/modules/journal/cpa-templates/year-end-closing.template.ts` ดูค่าที่ stamp จริง ถ้าเป็น string ให้ `equals: String(periodEnd.getFullYear())`

- [ ] **Step 2: เขียน integration spec**

```ts
// apps/api/src/modules/accounting/equity-capital-status.integration.spec.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GeneralLedgerReportService } from './general-ledger-report.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';

describe('getEquityStatementFromJournal — capitalStatus (2026-08-10)', () => {
  const prisma = new PrismaService();
  const service = new GeneralLedgerReportService(prisma, new CompanyResolverService(prisma));
  const journalAuto = new JournalAutoService(prisma);
  let jeId: string;

  beforeAll(async () => {
    await prisma.$connect();
    await seedFinanceCoa(prisma as never);
    const D = Prisma.Decimal;
    const je = await journalAuto.createAndPost({
      description: 'ทดสอบ capitalStatus — CAP_INIT partial',
      metadata: { flow: 'equity', idempotencyKey: `capstat-test-${Date.now()}` },
      lines: [
        { accountCode: '11-1201', dr: new D(700000), cr: new D(0) },
        { accountCode: '11-1310', dr: new D(300000), cr: new D(0) },
        { accountCode: '31-1101', dr: new D(0), cr: new D(1000000) },
      ],
    });
    jeId = je.id;
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({ where: { journalEntryId: jeId } });
    await prisma.journalEntry.delete({ where: { id: jeId } });
    await prisma.$disconnect();
  });

  it('authorized/unpaid/paidUp สะท้อน GL 31-1101 กับ 11-1310', async () => {
    const now = new Date();
    const r = await service.getEquityStatementFromJournal(new Date(now.getFullYear(), 0, 1), now);
    expect(r.capitalStatus.authorized).toBeGreaterThanOrEqual(1000000);
    expect(r.capitalStatus.unpaid).toBeGreaterThanOrEqual(300000);
    expect(r.capitalStatus.paidUp).toBe(r.capitalStatus.authorized - r.capitalStatus.unpaid);
    expect(typeof r.caveat).toBe('string');
  });
});
```

- [ ] **Step 3: รัน + commit**

```bash
cd apps/api
npx vitest run src/modules/accounting/equity-capital-status.integration.spec.ts
./tools/check-types.sh api
git add apps/api/src/modules/accounting
git commit -m "feat(accounting): งบ Equity เพิ่ม capitalStatus (ทุนจดทะเบียน/ชำระแล้ว/ค้างชำระ) + caveat conditional"
```

---

### Task 10: Frontend — api lib + types + EquityListPage (hub) + routes/menu/palette

**Files:**
- Create: `apps/web/src/lib/equity.types.ts`, `apps/web/src/lib/equity.ts`
- Create: `apps/web/src/pages/equity/EquityListPage.tsx`
- Modify: `apps/web/src/App.tsx` (lazy imports + 5 routes), `apps/web/src/config/menu.ts` (3 role configs), `apps/web/src/components/CommandPalette.tsx` (pages array)

**Interfaces:**
- Produces: `equityApi` (list/findOne/create/update/remove/submit/withdraw/post/reverse/preview/shareholders/dividendRegister/makerCheckerEnabled) — Task 11-12 ใช้
- Routes: `/finance/equity`, `/finance/equity/new`, `/finance/equity/:id`, `/finance/equity/:id/edit`, `/finance/dividend-register` — ทุกตัว roles `['OWNER','FINANCE_MANAGER','ACCOUNTANT']`

- [ ] **Step 1: types + api client**

```ts
// apps/web/src/lib/equity.types.ts
export type EquityTxnType =
  | 'CAP_INIT' | 'CAP_INC' | 'CAP_DEC' | 'DRAW' | 'DIV_DEC' | 'DIV_PAY' | 'PRIOR_ADJ';
export type EquityDocStatus = 'DRAFT' | 'READY' | 'POSTED' | 'REVERSED';
export type ShareholderType = 'INDIVIDUAL' | 'JURISTIC_TH' | 'JURISTIC_FOREIGN';

export interface Shareholder {
  id: string;
  name: string;
  taxId: string | null;
  shares: number;
  sharePct: string | null;
  type: ShareholderType;
  note: string | null;
  isActive: boolean;
}

export interface EquityLine {
  id: string;
  shareholderId: string;
  shareholderName: string;
  lineNo: number;
  amount: string;
  premium: string;
  paid: string;
  wht: string;
}

export interface EquityAttachment {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  createdAt: string;
}

export interface EquityDocument {
  id: string;
  docNumber: string;
  txnType: EquityTxnType;
  status: EquityDocStatus;
  txnDate: string;
  description: string | null;
  resolutionNo: string | null;
  resolutionDate: string | null;
  paymentAccountCode: string | null;
  paAccountCode: string | null;
  paAmount: string | null;
  paDirection: 'DR_OTHER_CR_RE' | 'DR_RE_CR_OTHER' | null;
  journalEntryId: string | null;
  reverseJournalEntryId: string | null;
  reverseReason: string | null;
  postedAt: string | null;
  createdAt: string;
  lines: EquityLine[];
  attachments: EquityAttachment[];
  warning?: string | null;
}

export interface EquityLineInput {
  shareholderId: string;
  amount: number;
  premium?: number;
  paid?: number;
  wht?: number;
}

export interface EquityFormValues {
  txnType: EquityTxnType;
  txnDate: string;
  description?: string;
  resolutionNo?: string;
  resolutionDate?: string;
  paymentAccountCode?: string;
  paAccountCode?: string;
  paAmount?: number;
  paDirection?: string;
  lines: EquityLineInput[];
}

export interface JournalPreview {
  lines: { accountCode: string; accountName: string; debit: string; credit: string; description: string }[];
  resolvedLines: { shareholderId: string; shareholderName: string; amount: string; premium: string; paid: string; wht: string }[];
}

export interface DividendRegisterRow {
  shareholderId: string;
  name: string;
  taxId: string | null;
  type: ShareholderType;
  payCount: number;
  gross: string;
  wht: string;
  net: string;
  docNumbers: string[];
}
```

```ts
// apps/web/src/lib/equity.ts
import api from '@/lib/api';
import type {
  DividendRegisterRow, EquityDocument, EquityFormValues, JournalPreview, Shareholder,
} from './equity.types';

export const equityApi = {
  list: (params: { txnType?: string; status?: string; page?: number; limit?: number } = {}) =>
    api
      .get<{ data: EquityDocument[]; total: number; page: number; limit: number }>(
        '/equity/documents',
        { params },
      )
      .then((r) => r.data),
  findOne: (id: string) => api.get<EquityDocument>(`/equity/documents/${id}`).then((r) => r.data),
  create: (data: EquityFormValues) =>
    api.post<EquityDocument>('/equity/documents', data).then((r) => r.data),
  update: (id: string, data: Partial<EquityFormValues>) =>
    api.patch<EquityDocument>(`/equity/documents/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/equity/documents/${id}`).then((r) => r.data),
  submit: (id: string) => api.post<EquityDocument>(`/equity/documents/${id}/submit`).then((r) => r.data),
  withdraw: (id: string) => api.post<EquityDocument>(`/equity/documents/${id}/withdraw`).then((r) => r.data),
  post: (id: string) => api.post<EquityDocument>(`/equity/documents/${id}/post`).then((r) => r.data),
  reverse: (id: string, reason: string) =>
    api.post<EquityDocument>(`/equity/documents/${id}/reverse`, { reason }).then((r) => r.data),
  preview: (data: EquityFormValues) =>
    api.post<JournalPreview>('/equity/journal-preview', data).then((r) => r.data),
  makerCheckerEnabled: () =>
    api.get<{ enabled: boolean }>('/equity/maker-checker-enabled').then((r) => r.data),
  uploadAttachment: (docId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/equity/documents/${docId}/attachments`, fd).then((r) => r.data);
  },
  attachmentUrl: (attId: string) =>
    api.get<{ url: string }>(`/equity/attachments/${attId}/signed-url`).then((r) => r.data),
  removeAttachment: (docId: string, attId: string) =>
    api.delete(`/equity/documents/${docId}/attachments/${attId}`).then((r) => r.data),
  shareholders: () => api.get<Shareholder[]>('/equity/shareholders').then((r) => r.data),
  createShareholder: (data: Partial<Shareholder>) =>
    api.post<Shareholder>('/equity/shareholders', data).then((r) => r.data),
  updateShareholder: (id: string, data: Partial<Shareholder>) =>
    api.patch<Shareholder>(`/equity/shareholders/${id}`, data).then((r) => r.data),
  dividendRegister: (year: number) =>
    api
      .get<{ year: number; rows: DividendRegisterRow[]; totals: { gross: string; wht: string; net: string } }>(
        '/equity/dividend-register',
        { params: { year } },
      )
      .then((r) => r.data),
};

export const TXN_TYPE_LABELS: Record<string, string> = {
  CAP_INIT: 'เริ่มลงทุนตั้งบริษัท',
  CAP_INC: 'เพิ่มทุน',
  CAP_DEC: 'ลดทุน',
  DRAW: 'กรรมการถอนเงิน',
  DIV_DEC: 'ประกาศจ่ายปันผล',
  DIV_PAY: 'จ่ายปันผล (หัก WHT)',
  PRIOR_ADJ: 'ปรับปรุงงบย้อนหลัง',
};

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'ร่าง',
  READY: 'รออนุมัติ',
  POSTED: 'ลงบัญชีแล้ว',
  REVERSED: 'กลับรายการ',
};

export const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  READY: 'bg-warning/10 text-warning',
  POSTED: 'bg-success/10 text-success',
  REVERSED: 'bg-destructive/10 text-destructive',
};
```

- [ ] **Step 2: EquityListPage (hub — 2 tabs: เอกสาร / ทะเบียนผู้ถือหุ้น)**

```tsx
// apps/web/src/pages/equity/EquityListPage.tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Landmark, Plus, Users, CalendarDays, Coins } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getErrorMessage } from '@/lib/api';
import { equityApi, STATUS_COLORS, STATUS_LABELS, TXN_TYPE_LABELS } from '@/lib/equity';
import type { EquityDocument, Shareholder } from '@/lib/equity.types';
import { formatThaiDateShort } from '@/lib/date';
import { formatNumberDecimal } from '@/utils/formatters';

function docTotal(d: EquityDocument): number {
  if (d.txnType === 'PRIOR_ADJ') return parseFloat(d.paAmount ?? '0');
  return d.lines.reduce(
    (s, l) => s + parseFloat(l.amount) + (d.txnType === 'CAP_INC' ? parseFloat(l.premium) : 0),
    0,
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

const SH_TYPE_LABELS: Record<string, string> = {
  INDIVIDUAL: 'บุคคลธรรมดา',
  JURISTIC_TH: 'นิติบุคคลไทย',
  JURISTIC_FOREIGN: 'นิติบุคคลต่างชาติ',
};

function ShareholdersTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['equity', 'shareholders'], queryFn: equityApi.shareholders });
  const [form, setForm] = useState({ name: '', taxId: '', shares: '', type: 'INDIVIDUAL' });
  const createMut = useMutation({
    mutationFn: () =>
      equityApi.createShareholder({
        name: form.name,
        taxId: form.taxId || undefined,
        shares: form.shares ? parseInt(form.shares, 10) : 0,
        type: form.type as Shareholder['type'],
      }),
    onSuccess: () => {
      toast.success('เพิ่มผู้ถือหุ้นแล้ว');
      setForm({ name: '', taxId: '', shares: '', type: 'INDIVIDUAL' });
      qc.invalidateQueries({ queryKey: ['equity', 'shareholders'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={q.refetch}>
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <input className="border border-border rounded-md px-3 py-2 text-sm bg-background md:col-span-2" placeholder="ชื่อผู้ถือหุ้น" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="border border-border rounded-md px-3 py-2 text-sm bg-background" placeholder="เลขผู้เสียภาษี" value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} />
            <select className="border border-border rounded-md px-3 py-2 text-sm bg-background" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {Object.entries(SH_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <Button disabled={!form.name || createMut.isPending} onClick={() => createMut.mutate()}>
              <Plus className="h-4 w-4 mr-1" /> เพิ่ม
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                <th className="py-2">ชื่อ</th><th>เลขผู้เสียภาษี</th><th>ประเภท</th>
                <th className="text-right">หุ้น</th><th className="text-right">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((s) => (
                <tr key={s.id} className="border-b border-border">
                  <td className="py-2 font-medium">{s.name}</td>
                  <td className="font-mono text-xs">{s.taxId ?? '—'}</td>
                  <td>{SH_TYPE_LABELS[s.type]}</td>
                  <td className="text-right font-mono">{s.shares.toLocaleString('th-TH')}</td>
                  <td className="text-right">{s.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
                </tr>
              ))}
              {(q.data ?? []).length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">ยังไม่มีผู้ถือหุ้น — เพิ่มตาม บอจ.5</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </QueryBoundary>
  );
}

export default function EquityListPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'docs' | 'shareholders'>('docs');
  const [statusFilter, setStatusFilter] = useState('');
  const listQuery = useQuery({
    queryKey: ['equity', 'list', { statusFilter }],
    queryFn: () => equityApi.list({ status: statusFilter || undefined, limit: 100 }),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="ส่วนของผู้ถือหุ้น (Equity)"
        subtitle="เพิ่มทุน · ลดทุน · ปันผล · กรรมการถอนเงิน · ปรับปรุงย้อนหลัง"
        icon={Landmark}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/finance/dividend-register"><Coins className="h-4 w-4 mr-1" /> ทะเบียนปันผล</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/finance/year-end-closing"><CalendarDays className="h-4 w-4 mr-1" /> ปิดบัญชีสิ้นปี</Link>
            </Button>
            <Button onClick={() => navigate('/finance/equity/new')}>
              <Plus className="h-4 w-4 mr-1" /> บันทึกธุรกรรมใหม่
            </Button>
          </div>
        }
      />

      <div className="flex gap-1 border-b border-border">
        {([['docs', 'เอกสารธุรกรรม'], ['shareholders', 'ทะเบียนผู้ถือหุ้น']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px leading-snug ${
              tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {key === 'shareholders' && <Users className="h-4 w-4 inline mr-1" />}
            {label}
          </button>
        ))}
      </div>

      {tab === 'shareholders' ? (
        <ShareholdersTab />
      ) : (
        <QueryBoundary isLoading={listQuery.isLoading} isError={listQuery.isError} error={listQuery.error} onRetry={listQuery.refetch}>
          <Card>
            <CardContent className="pt-4">
              <div className="mb-3">
                <select className="border border-border rounded-md px-3 py-2 text-sm bg-background" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">สถานะทั้งหมด</option>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                    <th className="py-2">เลขที่</th><th>วันที่</th><th>ประเภท</th><th>คำอธิบาย</th>
                    <th className="text-right">จำนวนเงิน</th><th className="text-right">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQuery.data?.data ?? []).map((d) => (
                    <tr
                      key={d.id}
                      className="border-b border-border hover:bg-accent cursor-pointer"
                      onClick={() => navigate(`/finance/equity/${d.id}`)}
                    >
                      <td className="py-2 font-mono text-xs font-semibold">{d.docNumber}</td>
                      <td>{formatThaiDateShort(d.txnDate)}</td>
                      <td>{TXN_TYPE_LABELS[d.txnType]}</td>
                      <td className="text-muted-foreground max-w-[280px] truncate">{d.description ?? '—'}</td>
                      <td className="text-right font-mono">{formatNumberDecimal(docTotal(d), 2)}</td>
                      <td className="text-right"><StatusBadge status={d.status} /></td>
                    </tr>
                  ))}
                  {(listQuery.data?.data ?? []).length === 0 && (
                    <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">ยังไม่มีเอกสาร</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </QueryBoundary>
      )}
    </div>
  );
}
```

**ตรวจก่อนใช้:** props จริงของ `PageHeader` (เปิด `apps/web/src/components/ui/PageHeader.tsx`) — ถ้าไม่มี `icon`/`actions`/`subtitle` ตามนี้ ให้ปรับ JSX ตาม signature จริง (pattern เดียวกับที่ OtherIncomeListPage ใช้)

- [ ] **Step 3: routes ใน App.tsx**

Lazy imports (วางใกล้กลุ่ม other-income บรรทัด ~234):

```tsx
const EquityListPage = lazy(() => import('@/pages/equity/EquityListPage'));
const EquityEntryPage = lazy(() => import('@/pages/equity/EquityEntryPage'));
const EquityViewPage = lazy(() => import('@/pages/equity/EquityViewPage'));
const DividendRegisterPage = lazy(() => import('@/pages/equity/DividendRegisterPage'));
```

Routes (วางใกล้ `/finance/year-end-closing` บรรทัด ~839 — **`/new` ก่อน `/:id` เสมอ**):

```tsx
          {/* ส่วนของผู้ถือหุ้น (Equity) — CRITICAL: /new ก่อน /:id */}
          <Route
            path="/finance/equity"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <EquityListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/equity/new"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <EquityEntryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/equity/:id/edit"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <EquityEntryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/equity/:id"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <EquityViewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/dividend-register"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <DividendRegisterPage />
              </ProtectedRoute>
            }
          />
```

(Task 11-12 สร้างไฟล์ EntryPage/ViewPage/DividendRegisterPage — ระหว่างนั้น build จะ fail ถ้า import ไฟล์ที่ยังไม่มี ให้ทำ Step นี้พร้อม Task 11-12 หรือสร้างไฟล์ stub `export default function ...(){return null}` ไว้ก่อนแล้ว replace)

- [ ] **Step 4: menu.ts — เพิ่ม 2 items ใน 3 role configs**

item ที่เพิ่ม (icon `Landmark` มี import อยู่แล้ว, เพิ่ม `Coins` ถ้ายังไม่มีใน scope):

```ts
        { label: 'ส่วนของผู้ถือหุ้น (Equity)', path: '/finance/equity', icon: Landmark },
        { label: 'ทะเบียนปันผล + ภ.ง.ด.2', path: '/finance/dividend-register', icon: Coins },
```

ตำแหน่ง:
- **FINANCE_MANAGER** section `fm-finance` (บรรทัด ~342) — ต่อท้าย `{ label: 'ปิดบัญชีสิ้นปี', ... }`
- **ACCOUNTANT** section `acc-close` (บรรทัด ~423) — ต่อท้าย `{ label: 'ปิดบัญชีสิ้นปี', ... }`
- **OWNER** section `owner-period-close` (บรรทัด ~578) — ต่อท้าย `{ label: 'ปิดบัญชีสิ้นปี', ... }`

- [ ] **Step 5: CommandPalette — เพิ่มใน `pages` array (hardcoded, ไม่อ่าน menu.ts)**

ใน `apps/web/src/components/CommandPalette.tsx` array `pages` (บรรทัด ~54-77):

```ts
  { label: 'ส่วนของผู้ถือหุ้น (Equity)', path: '/finance/equity', icon: Landmark, keywords: 'equity ทุน ปันผล ผู้ถือหุ้น เพิ่มทุน ถอนเงิน', roles: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
  { label: 'ทะเบียนปันผล + ภ.ง.ด.2', path: '/finance/dividend-register', icon: Landmark, keywords: 'dividend ปันผล ภงด2 pnd2 wht', roles: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
```
(เพิ่ม `Landmark` ใน lucide-react imports ของไฟล์ถ้ายังไม่มี)

- [ ] **Step 6: Typecheck + commit**

```bash
./tools/check-types.sh web
git add apps/web/src
git commit -m "feat(equity-web): api lib + hub page (เอกสาร/ทะเบียนผู้ถือหุ้น) + routes/เมนู/palette"
```

---

### Task 11: Frontend — Wizard (EquityEntryPage) + EquityViewPage

**Files:**
- Create: `apps/web/src/pages/equity/EquityEntryPage.tsx`
- Create: `apps/web/src/pages/equity/EquityViewPage.tsx`

**Interfaces:**
- Consumes: `equityApi`, `TXN_TYPE_LABELS`, types (Task 10) · `/equity/journal-preview` (Task 4)

- [ ] **Step 1: EquityEntryPage — wizard 3 ขั้น (ประเภท+ข้อมูล → preview JE → ยืนยัน)**

โครงหลัก (complete — ปรับ import/props ตาม shadcn components ที่มีจริงในโปรเจค เช่นเดียวกับ Task 10):

```tsx
// apps/web/src/pages/equity/EquityEntryPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, Landmark, Plus, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getErrorMessage } from '@/lib/api';
import { equityApi, TXN_TYPE_LABELS } from '@/lib/equity';
import type { EquityFormValues, EquityLineInput, EquityTxnType, JournalPreview } from '@/lib/equity.types';
import { formatNumberDecimal } from '@/utils/formatters';

const NEEDS_RESOLUTION: EquityTxnType[] = ['CAP_INIT', 'CAP_INC', 'CAP_DEC', 'DIV_DEC', 'PRIOR_ADJ'];
const NEEDS_PAYMENT: EquityTxnType[] = ['CAP_INIT', 'CAP_INC', 'CAP_DEC', 'DRAW', 'DIV_PAY'];
const NEEDS_SHAREHOLDERS: EquityTxnType[] = ['CAP_INIT', 'CAP_INC', 'CAP_DEC', 'DRAW', 'DIV_DEC', 'DIV_PAY'];

// 6 บัญชีเงินสด/ธนาคาร FINANCE (ตรงกับ CASH_ACCOUNT_CODES ฝั่ง API)
const CASH_ACCOUNTS = [
  { code: '11-1101', label: 'เงินสด — สุทธินีย์' },
  { code: '11-1102', label: 'เงินสด — เอกนรินทร์' },
  { code: '11-1103', label: 'เงินสด — พนักงานบัญชี' },
  { code: '11-1201', label: 'ธนาคารกสิกรไทย (รับ)' },
  { code: '11-1202', label: 'ธนาคารไทยพาณิชย์ (ค่าใช้จ่าย)' },
  { code: '11-1203', label: 'ธนาคารไทยพาณิชย์ (ค่าเสื่อม)' },
];

const TXN_DESC: Record<EquityTxnType, string> = {
  CAP_INIT: 'บันทึกทุนตั้งบริษัท รองรับชำระบางส่วน (ขั้นต่ำ 25% — ป.พ.พ. ม.1110) · บันทึกได้ครั้งเดียว',
  CAP_INC: 'รับเงินเพิ่มทุน (ระบุส่วนเกินมูลค่าหุ้นได้)',
  CAP_DEC: 'ลดทุนจดทะเบียน จ่ายคืนผู้ถือหุ้น',
  DRAW: 'กรรมการถอนเงินไปใช้ส่วนตัว → 22-1102 (Contra)',
  DIV_DEC: 'มติประกาศจ่ายปันผล → ตั้งเจ้าหนี้ 21-4104',
  DIV_PAY: 'จ่ายเงินปันผลจริง หัก ภ.ง.ด.2 10% (บุคคลธรรมดา)',
  PRIOR_ADJ: 'แก้ข้อผิดพลาดงวดก่อนผ่านกำไรสะสม 32-1101 (TAS 8)',
};

const emptyLine = (): EquityLineInput => ({ shareholderId: '', amount: 0 });

export default function EquityEntryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<EquityFormValues>({
    txnType: 'CAP_INC',
    txnDate: new Date().toISOString().slice(0, 10),
    lines: [emptyLine()],
  });
  const [preview, setPreview] = useState<JournalPreview | null>(null);

  const shareholders = useQuery({ queryKey: ['equity', 'shareholders'], queryFn: equityApi.shareholders });
  const mcQuery = useQuery({ queryKey: ['equity', 'mc'], queryFn: equityApi.makerCheckerEnabled });

  const existing = useQuery({
    queryKey: ['equity', 'doc', id],
    queryFn: () => equityApi.findOne(id!),
    enabled: !!id,
  });
  // โหลดร่างเดิมเข้าฟอร์ม (edit mode)
  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setForm({
      txnType: d.txnType,
      txnDate: d.txnDate.slice(0, 10),
      description: d.description ?? undefined,
      resolutionNo: d.resolutionNo ?? undefined,
      resolutionDate: d.resolutionDate?.slice(0, 10),
      paymentAccountCode: d.paymentAccountCode ?? undefined,
      paAccountCode: d.paAccountCode ?? undefined,
      paAmount: d.paAmount ? parseFloat(d.paAmount) : undefined,
      paDirection: d.paDirection ?? undefined,
      lines: d.lines.map((l) => ({
        shareholderId: l.shareholderId,
        amount: parseFloat(l.amount),
        premium: parseFloat(l.premium) || undefined,
        paid: parseFloat(l.paid) || undefined,
        wht: parseFloat(l.wht) || undefined,
      })),
    });
  }, [existing.data]);

  const t = form.txnType;
  const showSh = NEEDS_SHAREHOLDERS.includes(t);
  const isInit = t === 'CAP_INIT';
  const isInc = t === 'CAP_INC';
  const isDivPay = t === 'DIV_PAY';

  const setLine = (i: number, patch: Partial<EquityLineInput>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const previewMut = useMutation({
    mutationFn: () => equityApi.preview(form),
    onSuccess: (p) => {
      setPreview(p);
      setStep(2);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const saveMut = useMutation({
    mutationFn: () => (id ? equityApi.update(id, form) : equityApi.create(form)),
    onSuccess: (doc) => {
      toast.success(`บันทึกร่าง ${doc.docNumber} แล้ว — แนบไฟล์มติ/ลงบัญชีได้จากหน้าเอกสาร`);
      navigate(`/finance/equity/${doc.id}`);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const totals = form.lines.reduce(
    (s, l) => ({
      amount: s.amount + (l.amount || 0),
      premium: s.premium + (l.premium || 0),
      paid: s.paid + (l.paid || 0),
      wht: s.wht + (l.wht || 0),
    }),
    { amount: 0, premium: 0, paid: 0, wht: 0 },
  );
  const initPctPaid = totals.amount > 0 ? (totals.paid / totals.amount) * 100 : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={id ? 'แก้ไขธุรกรรมส่วนของผู้ถือหุ้น' : 'บันทึกธุรกรรมส่วนของผู้ถือหุ้น'}
        icon={Landmark}
        actions={
          <Button variant="ghost" onClick={() => navigate('/finance/equity')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> กลับ
          </Button>
        }
      />

      {/* Stepper */}
      <div className="flex gap-2">
        {['ประเภท & ข้อมูล', 'ตรวจ Journal', 'ยืนยัน'].map((label, i) => (
          <div key={label} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${step === i + 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            <span className="font-semibold">{i + 1}</span> {label}
          </div>
        ))}
      </div>

      {step === 1 && (
        <QueryBoundary isLoading={shareholders.isLoading || (!!id && existing.isLoading)} isError={shareholders.isError} error={shareholders.error} onRetry={shareholders.refetch}>
          {/* 1.1 เลือกประเภท */}
          <Card>
            <CardHeader className="font-semibold">1.1 ประเภทธุรกรรม</CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {(Object.keys(TXN_TYPE_LABELS) as EquityTxnType[]).map((code) => (
                <button
                  key={code}
                  onClick={() => setForm((f) => ({ ...f, txnType: code, lines: NEEDS_SHAREHOLDERS.includes(code) ? (f.lines.length ? f.lines : [emptyLine()]) : [] }))}
                  className={`text-left border rounded-lg p-3 leading-snug ${t === code ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'border-border hover:bg-accent'}`}
                >
                  <div className="font-medium text-sm">{TXN_TYPE_LABELS[code]}</div>
                  <div className="text-xs text-muted-foreground mt-1">{TXN_DESC[code]}</div>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* 1.2 รายละเอียด */}
          <Card>
            <CardHeader className="font-semibold">1.2 รายละเอียดเอกสาร</CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="text-sm space-y-1">
                <span className="text-muted-foreground">วันที่ทำรายการ *</span>
                <input type="date" className="w-full border border-border rounded-md px-3 py-2 bg-background" value={form.txnDate} onChange={(e) => setForm({ ...form, txnDate: e.target.value })} />
              </label>
              <label className="text-sm space-y-1 md:col-span-3">
                <span className="text-muted-foreground">คำอธิบาย</span>
                <input className="w-full border border-border rounded-md px-3 py-2 bg-background" value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </label>
              {NEEDS_RESOLUTION.includes(t) && (
                <>
                  <label className="text-sm space-y-1">
                    <span className="text-muted-foreground">เลขที่มติ *</span>
                    <input className="w-full border border-border rounded-md px-3 py-2 bg-background" placeholder="เช่น BOD-2569-02" value={form.resolutionNo ?? ''} onChange={(e) => setForm({ ...form, resolutionNo: e.target.value })} />
                  </label>
                  <label className="text-sm space-y-1">
                    <span className="text-muted-foreground">วันที่มติ *</span>
                    <input type="date" className="w-full border border-border rounded-md px-3 py-2 bg-background" value={form.resolutionDate ?? ''} onChange={(e) => setForm({ ...form, resolutionDate: e.target.value })} />
                  </label>
                </>
              )}
              {NEEDS_PAYMENT.includes(t) && (
                <label className="text-sm space-y-1 md:col-span-2">
                  <span className="text-muted-foreground">ช่องทางเงินสด/ธนาคาร *</span>
                  <select className="w-full border border-border rounded-md px-3 py-2 bg-background" value={form.paymentAccountCode ?? ''} onChange={(e) => setForm({ ...form, paymentAccountCode: e.target.value })}>
                    <option value="">— เลือกบัญชี —</option>
                    {CASH_ACCOUNTS.map((a) => (
                      <option key={a.code} value={a.code}>{a.code} · {a.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </CardContent>
          </Card>

          {/* 1.3 ผู้ถือหุ้น / PRIOR_ADJ */}
          {showSh && (
            <Card>
              <CardHeader className="font-semibold flex-row items-center justify-between">
                <span>1.3 ผู้ถือหุ้น ({form.lines.length} ราย)</span>
                {isInit && (
                  <span className={`text-xs px-2 py-1 rounded-full ${initPctPaid >= 25 ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                    ชำระแล้ว {initPctPaid.toFixed(1)}% {initPctPaid >= 25 ? '✓ ≥25%' : '✗ ต่ำกว่า 25% (ม.1110)'}
                  </span>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                {form.lines.map((ln, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <select className="col-span-4 border border-border rounded-md px-2 py-2 text-sm bg-background" value={ln.shareholderId} onChange={(e) => setLine(i, { shareholderId: e.target.value })}>
                      <option value="">— เลือกผู้ถือหุ้น —</option>
                      {(shareholders.data ?? []).filter((s) => s.isActive).map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <input type="number" className="col-span-2 border border-border rounded-md px-2 py-2 text-sm bg-background text-right font-mono" placeholder={isInit ? 'มูลค่าจอง (par)' : 'จำนวนเงิน'} value={ln.amount || ''} onChange={(e) => setLine(i, { amount: parseFloat(e.target.value) || 0 })} />
                    {isInit && (
                      <input type="number" className="col-span-2 border border-border rounded-md px-2 py-2 text-sm bg-background text-right font-mono" placeholder="ชำระจริง" value={ln.paid ?? ''} onChange={(e) => setLine(i, { paid: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
                    )}
                    {isInc && (
                      <input type="number" className="col-span-2 border border-border rounded-md px-2 py-2 text-sm bg-background text-right font-mono" placeholder="ส่วนเกินมูลค่า" value={ln.premium ?? ''} onChange={(e) => setLine(i, { premium: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
                    )}
                    {isDivPay && (
                      <input type="number" className="col-span-2 border border-border rounded-md px-2 py-2 text-sm bg-background text-right font-mono" placeholder="WHT (เว้นว่าง = อัตโนมัติ)" value={ln.wht ?? ''} onChange={(e) => setLine(i, { wht: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
                    )}
                    <button className="col-span-1 text-destructive" onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }))}>
                  <Plus className="h-4 w-4 mr-1" /> เพิ่มผู้ถือหุ้น
                </Button>
                {isDivPay && (
                  <p className="text-xs text-muted-foreground leading-snug">
                    เว้นช่อง WHT ว่าง = ระบบคำนวณให้: บุคคลธรรมดา/นิติบุคคลต่างชาติ 10% · นิติบุคคลไทย 0 (ม.65 ทวิ(10))
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {t === 'PRIOR_ADJ' && (
            <Card>
              <CardHeader className="font-semibold">1.3 ปรับปรุงงบย้อนหลัง (ผ่าน 32-1101 เท่านั้น — TAS 8)</CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="text-sm space-y-1">
                  <span className="text-muted-foreground">ทิศทาง *</span>
                  <select className="w-full border border-border rounded-md px-3 py-2 bg-background" value={form.paDirection ?? ''} onChange={(e) => setForm({ ...form, paDirection: e.target.value })}>
                    <option value="">— เลือก —</option>
                    <option value="DR_OTHER_CR_RE">Dr บัญชีคู่ / Cr 32-1101 (กำไรสะสมเพิ่ม)</option>
                    <option value="DR_RE_CR_OTHER">Dr 32-1101 / Cr บัญชีคู่ (กำไรสะสมลด)</option>
                  </select>
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-muted-foreground">รหัสบัญชีคู่ *</span>
                  <input className="w-full border border-border rounded-md px-3 py-2 bg-background font-mono" placeholder="เช่น 11-1201" value={form.paAccountCode ?? ''} onChange={(e) => setForm({ ...form, paAccountCode: e.target.value })} />
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-muted-foreground">ยอดปรับปรุง *</span>
                  <input type="number" className="w-full border border-border rounded-md px-3 py-2 bg-background text-right font-mono" value={form.paAmount ?? ''} onChange={(e) => setForm({ ...form, paAmount: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
                </label>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Button onClick={() => previewMut.mutate()} disabled={previewMut.isPending}>
              ตรวจ Journal <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </QueryBoundary>
      )}

      {step === 2 && preview && (
        <Card>
          <CardHeader className="font-semibold flex-row items-center justify-between">
            <span>2. Journal ที่จะลงบัญชี (สร้างโดยระบบ)</span>
            <span className="text-xs px-2 py-1 rounded-full bg-success/10 text-success">BALANCED — ตรวจโดย server</span>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                  <th className="py-2">รหัส</th><th>ชื่อบัญชี</th><th>คำอธิบาย</th>
                  <th className="text-right">Dr</th><th className="text-right">Cr</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((l, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="py-2 font-mono text-xs font-semibold">{l.accountCode}</td>
                    <td>{l.accountName}</td>
                    <td className="text-muted-foreground text-xs">{l.description}</td>
                    <td className="text-right font-mono">{parseFloat(l.debit) > 0 ? formatNumberDecimal(parseFloat(l.debit), 2) : ''}</td>
                    <td className="text-right font-mono">{parseFloat(l.credit) > 0 ? formatNumberDecimal(parseFloat(l.credit), 2) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {isDivPay && (
              <p className="text-xs text-muted-foreground mt-2 leading-snug">
                WHT ที่คำนวณจริงต่อราย: {preview.resolvedLines.map((r) => `${r.shareholderName} ${formatNumberDecimal(parseFloat(r.wht), 2)}`).join(' · ')}
              </p>
            )}
            <div className="flex justify-between mt-4">
              <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4 mr-1" /> ย้อนกลับ</Button>
              <Button onClick={() => setStep(3)}>ถัดไป <ArrowRight className="h-4 w-4 ml-1" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader className="font-semibold">3. ยืนยันบันทึกร่าง</CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-muted p-4 text-sm space-y-1">
              <div>ประเภท: <span className="font-medium">{TXN_TYPE_LABELS[t]}</span></div>
              <div>ยอดรวม: <span className="font-mono font-semibold">{formatNumberDecimal(t === 'PRIOR_ADJ' ? (form.paAmount ?? 0) : totals.amount + (isInc ? totals.premium : 0), 2)} บาท</span></div>
              {isInit && <div>ชำระจริง {formatNumberDecimal(totals.paid, 2)} · ค้างชำระ (11-1310) {formatNumberDecimal(totals.amount - totals.paid, 2)}</div>}
            </div>
            {NEEDS_RESOLUTION.includes(t) && (
              <p className="text-xs text-warning leading-snug">
                ประเภทนี้ต้องแนบไฟล์มติที่ประชุมก่อนลงบัญชี (V8) — แนบได้ในหน้าเอกสารหลังบันทึกร่าง
              </p>
            )}
            {mcQuery.data?.enabled && (
              <p className="text-xs text-muted-foreground leading-snug">Maker-Checker เปิดอยู่ — หลังบันทึกร่างต้องส่งอนุมัติ และผู้อนุมัติต้องเป็นคนละคนกับผู้สร้าง</p>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft className="h-4 w-4 mr-1" /> ย้อนกลับ</Button>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                <Check className="h-4 w-4 mr-1" /> บันทึกร่าง
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: EquityViewPage — detail + แนบไฟล์ + submit/post/reverse**

```tsx
// apps/web/src/pages/equity/EquityViewPage.tsx
import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Landmark, Paperclip, Pencil, RotateCcw, Send, Trash2, Upload } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { getErrorMessage } from '@/lib/api';
import { equityApi, STATUS_COLORS, STATUS_LABELS, TXN_TYPE_LABELS } from '@/lib/equity';
import { formatThaiDate, formatThaiDateTime } from '@/lib/date';
import { formatNumberDecimal } from '@/utils/formatters';

const CAP_TYPES = ['CAP_INIT', 'CAP_INC', 'CAP_DEC'];

export default function EquityViewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [postConfirm, setPostConfirm] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('');

  const canPost = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';

  const q = useQuery({ queryKey: ['equity', 'doc', id], queryFn: () => equityApi.findOne(id!), enabled: !!id });
  const mc = useQuery({ queryKey: ['equity', 'mc'], queryFn: equityApi.makerCheckerEnabled });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['equity'] });
  };
  const mut = (fn: () => Promise<unknown>, ok: string) =>
    fn()
      .then((res) => {
        const w = (res as { warning?: string | null } | undefined)?.warning;
        toast.success(ok);
        if (w) toast.warning(w, { duration: 10000 });
        invalidate();
      })
      .catch((e) => toast.error(getErrorMessage(e)));

  const doc = q.data;

  return (
    <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={q.refetch}>
      {doc && (
        <div className="space-y-4">
          <PageHeader
            title={`${doc.docNumber} — ${TXN_TYPE_LABELS[doc.txnType]}`}
            icon={Landmark}
            actions={
              <div className="flex gap-2 flex-wrap">
                <Button variant="ghost" onClick={() => navigate('/finance/equity')}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> กลับ
                </Button>
                {doc.status === 'DRAFT' && (
                  <>
                    <Button variant="outline" onClick={() => navigate(`/finance/equity/${doc.id}/edit`)}>
                      <Pencil className="h-4 w-4 mr-1" /> แก้ไข
                    </Button>
                    {mc.data?.enabled ? (
                      <Button onClick={() => mut(() => equityApi.submit(doc.id), 'ส่งอนุมัติแล้ว')}>
                        <Send className="h-4 w-4 mr-1" /> ส่งอนุมัติ
                      </Button>
                    ) : (
                      canPost && <Button onClick={() => setPostConfirm(true)}>ลงบัญชี</Button>
                    )}
                  </>
                )}
                {doc.status === 'READY' && (
                  <>
                    <Button variant="outline" onClick={() => mut(() => equityApi.withdraw(doc.id), 'ถอนกลับเป็นร่างแล้ว')}>
                      ถอนกลับร่าง
                    </Button>
                    {canPost && <Button onClick={() => setPostConfirm(true)}>อนุมัติ + ลงบัญชี</Button>}
                  </>
                )}
                {doc.status === 'POSTED' && canPost && (
                  <Button variant="destructive" onClick={() => setReverseOpen(true)}>
                    <RotateCcw className="h-4 w-4 mr-1" /> กลับรายการ
                  </Button>
                )}
              </div>
            }
          />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">สถานะ</div><span className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[doc.status]}`}>{STATUS_LABELS[doc.status]}</span></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">วันที่ทำรายการ</div><div className="font-medium mt-1">{formatThaiDate(doc.txnDate)}</div></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">เลขที่มติ</div><div className="font-mono mt-1">{doc.resolutionNo ?? '—'}</div></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="text-xs text-muted-foreground">ลงบัญชีเมื่อ</div><div className="mt-1">{doc.postedAt ? formatThaiDateTime(doc.postedAt) : '—'}</div></CardContent></Card>
          </div>

          {doc.lines.length > 0 && (
            <Card>
              <CardHeader className="font-semibold">ผู้ถือหุ้น</CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                      <th className="py-2">ชื่อ</th>
                      <th className="text-right">จำนวนเงิน</th>
                      <th className="text-right">ส่วนเกิน</th>
                      <th className="text-right">ชำระจริง</th>
                      <th className="text-right">WHT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lines.map((l) => (
                      <tr key={l.id} className="border-b border-border">
                        <td className="py-2">{l.shareholderName}</td>
                        <td className="text-right font-mono">{formatNumberDecimal(parseFloat(l.amount), 2)}</td>
                        <td className="text-right font-mono">{formatNumberDecimal(parseFloat(l.premium), 2)}</td>
                        <td className="text-right font-mono">{formatNumberDecimal(parseFloat(l.paid), 2)}</td>
                        <td className="text-right font-mono">{formatNumberDecimal(parseFloat(l.wht), 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="font-semibold flex-row items-center justify-between">
              <span><Paperclip className="h-4 w-4 inline mr-1" /> ไฟล์แนบ (มติที่ประชุม)</span>
              {(doc.status === 'DRAFT' || doc.status === 'READY') && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) mut(() => equityApi.uploadAttachment(doc.id, f), 'แนบไฟล์แล้ว');
                      e.target.value = '';
                    }}
                  />
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-1" /> แนบไฟล์
                  </Button>
                </>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {doc.attachments.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีไฟล์แนบ</p>}
              {doc.attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between border border-border rounded-md px-3 py-2 text-sm">
                  <button
                    className="flex items-center gap-2 hover:underline"
                    onClick={() => equityApi.attachmentUrl(a.id).then(({ url }) => window.open(url, '_blank'))}
                  >
                    <FileText className="h-4 w-4" /> {a.filename}
                  </button>
                  {(doc.status === 'DRAFT' || doc.status === 'READY') && (
                    <button className="text-destructive" onClick={() => mut(() => equityApi.removeAttachment(doc.id, a.id), 'ลบไฟล์แล้ว')}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <ConfirmDialog
            open={postConfirm}
            onOpenChange={setPostConfirm}
            title="ยืนยันลงบัญชี"
            description={`ลงบัญชี ${doc.docNumber} (${TXN_TYPE_LABELS[doc.txnType]}) — เมื่อลงแล้วแก้ไขไม่ได้ ต้องกลับรายการเท่านั้น (V11)`}
            onConfirm={() => {
              setPostConfirm(false);
              mut(() => equityApi.post(doc.id), 'ลงบัญชีแล้ว');
            }}
          />
          <ConfirmDialog
            open={reverseOpen}
            onOpenChange={setReverseOpen}
            title="กลับรายการเอกสาร"
            description={
              CAP_TYPES.includes(doc.txnType)
                ? 'คำเตือน: ธุรกรรมทุนจดทะเบียน — การกลับรายการอาจต้องแจ้งแก้ไขข้อมูลกับ DBD (กรมพัฒนาธุรกิจการค้า) ด้วย · กรอกเหตุผล ≥10 ตัวอักษร'
                : doc.txnType === 'DIV_DEC'
                  ? 'คำเตือน: ถ้ามีการจ่ายปันผล (DIV_PAY) ไปแล้ว การกลับรายการประกาศจะทำให้ 21-4104 ติดลบ — ควรกลับรายการใบจ่ายก่อน · กรอกเหตุผล ≥10 ตัวอักษร'
                  : 'กรอกเหตุผลการกลับรายการ ≥10 ตัวอักษร'
            }
            onConfirm={() => {
              if (reverseReason.trim().length < 10) {
                toast.error('เหตุผลต้องยาวอย่างน้อย 10 ตัวอักษร');
                return;
              }
              setReverseOpen(false);
              mut(() => equityApi.reverse(doc.id, reverseReason.trim()), 'กลับรายการแล้ว');
              setReverseReason('');
            }}
          >
            <textarea
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background mt-2"
              rows={3}
              placeholder="เหตุผล เช่น บันทึกยอดผิด ต้องแก้ไขใหม่"
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
            />
          </ConfirmDialog>
        </div>
      )}
    </QueryBoundary>
  );
}
```

**ตรวจก่อนใช้:** props จริงของ `ConfirmDialog` (เปิด `apps/web/src/components/ui/ConfirmDialog.tsx`) — ถ้าไม่รองรับ children/onOpenChange ตามนี้ ให้ใช้ `Dialog` + `Textarea` ตาม pattern ใน `YearEndClosingPage.tsx` (reverse dialog มี zod `min(10)` ให้ลอกได้)

- [ ] **Step 3: Typecheck + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/equity
git commit -m "feat(equity-web): wizard 3 ขั้น + หน้าเอกสาร (แนบไฟล์/submit/post/reverse + คำเตือน DBD)"
```

---

### Task 12: Frontend — DividendRegisterPage + capitalStatus บนงบ Equity เดิม

**Files:**
- Create: `apps/web/src/pages/equity/DividendRegisterPage.tsx`
- Modify: `apps/web/src/pages/EquityStatementPage.tsx`

**Interfaces:**
- Consumes: `equityApi.dividendRegister` (Task 8/10) · `GET /tax/export-xlsx?form=PND2` (Task 8) · `capitalStatus` จาก equity-statement response (Task 9)

- [ ] **Step 1: DividendRegisterPage — ตารางรายปี + XLSX + พิมพ์หนังสือรับรอง ต่อคน**

หนังสือรับรองหักภาษี: **ลอก pattern inline-Dialog + print CSS จาก `WhtAnnualPage.tsx` บรรทัด 212-321** (ไม่ใช่ shared component — ยืนยันจากการวิจัย 2026-08-10) — เปลี่ยนเนื้อหาเป็นเงินปันผล/ภ.ง.ด.2:

```tsx
// apps/web/src/pages/equity/DividendRegisterPage.tsx
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Coins, Download, Printer } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import api from '@/lib/api';
import { equityApi } from '@/lib/equity';
import type { DividendRegisterRow } from '@/lib/equity.types';
import { formatNumberDecimal } from '@/utils/formatters';

interface CompanyRow { companyCode: string; name: string; taxId?: string | null; address?: string | null }

export default function DividendRegisterPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [certFor, setCertFor] = useState<DividendRegisterRow | null>(null);

  const q = useQuery({
    queryKey: ['dividend-register', year],
    queryFn: () => equityApi.dividendRegister(year),
  });
  const companies = useQuery({
    queryKey: ['company-info-list'],
    queryFn: () => api.get<CompanyRow[]>('/company').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const payer = companies.data?.find((c) => c.companyCode === 'FINANCE') ?? companies.data?.[0];

  const downloadXlsx = async (month: number) => {
    const res = await api.get(`/tax/export-xlsx?form=PND2&year=${year}&month=${month}`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PND2-${year}-${String(month).padStart(2, '0')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const [xlsxMonth, setXlsxMonth] = useState(new Date().getMonth() + 1);

  return (
    <div className="space-y-4">
      <PageHeader
        title="ทะเบียนปันผล + ภ.ง.ด.2"
        subtitle="สรุปเงินปันผลจ่ายจริงต่อผู้ถือหุ้น — ภ.ง.ด.2 ยื่นภายในวันที่ 7 ของเดือนถัดจากเดือนที่จ่าย (ม.52)"
        icon={Coins}
        actions={
          <Button variant="ghost" asChild>
            <Link to="/finance/equity"><ArrowLeft className="h-4 w-4 mr-1" /> กลับ</Link>
          </Button>
        }
      />

      <div className="flex items-center gap-2 flex-wrap">
        <select className="border border-border rounded-md px-3 py-2 text-sm bg-background" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))}>
          {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
            <option key={y} value={y}>ปี {y + 543}</option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <select className="border border-border rounded-md px-3 py-2 text-sm bg-background" value={xlsxMonth} onChange={(e) => setXlsxMonth(parseInt(e.target.value, 10))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>เดือน {m}</option>
            ))}
          </select>
          <Button variant="outline" onClick={() => downloadXlsx(xlsxMonth)}>
            <Download className="h-4 w-4 mr-1" /> ภ.ง.ด.2 XLSX
          </Button>
        </div>
      </div>

      <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={q.refetch}>
        <Card>
          <CardContent className="pt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                  <th className="py-2">ผู้ถือหุ้น</th><th>เลขผู้เสียภาษี</th>
                  <th className="text-center">ครั้ง</th>
                  <th className="text-right">ปันผลก่อนหัก</th><th className="text-right">WHT 10%</th>
                  <th className="text-right">จ่ายสุทธิ</th><th className="text-right"></th>
                </tr>
              </thead>
              <tbody>
                {(q.data?.rows ?? []).map((r) => (
                  <tr key={r.shareholderId} className="border-b border-border">
                    <td className="py-2 font-medium">{r.name}</td>
                    <td className="font-mono text-xs">{r.taxId ?? '—'}</td>
                    <td className="text-center">{r.payCount}</td>
                    <td className="text-right font-mono">{formatNumberDecimal(parseFloat(r.gross), 2)}</td>
                    <td className="text-right font-mono">{formatNumberDecimal(parseFloat(r.wht), 2)}</td>
                    <td className="text-right font-mono text-success">{formatNumberDecimal(parseFloat(r.net), 2)}</td>
                    <td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setCertFor(r)}>
                        <Printer className="h-4 w-4 mr-1" /> หนังสือรับรอง
                      </Button>
                    </td>
                  </tr>
                ))}
                {(q.data?.rows ?? []).length === 0 && (
                  <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">ยังไม่มีการจ่ายปันผลปีนี้</td></tr>
                )}
              </tbody>
              {q.data && q.data.rows.length > 0 && (
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-2" colSpan={3}>รวม</td>
                    <td className="text-right font-mono">{formatNumberDecimal(parseFloat(q.data.totals.gross), 2)}</td>
                    <td className="text-right font-mono">{formatNumberDecimal(parseFloat(q.data.totals.wht), 2)}</td>
                    <td className="text-right font-mono">{formatNumberDecimal(parseFloat(q.data.totals.net), 2)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </CardContent>
        </Card>
      </QueryBoundary>

      {/* หนังสือรับรองการหักภาษี ณ ที่จ่าย (ม.50 ทวิ) — pattern จาก WhtAnnualPage lines 212-321 */}
      <Dialog open={certFor !== null} onOpenChange={(o) => !o && setCertFor(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {certFor && payer && (
            <>
              <style>{`@media print {
                body * { visibility: hidden !important; }
                #div-cert-print, #div-cert-print * { visibility: visible !important; }
                #div-cert-print { position: fixed; inset: 0; padding: 24px; background: white; }
              }`}</style>
              {/* print/receipt context — เอกสารทางการพิมพ์ขาวดำ ใช้สีตรงได้ตามข้อยกเว้นใน rules */}
              <div id="div-cert-print" className="bg-white text-black p-6 text-sm space-y-4">
                <h2 className="text-center font-bold text-base leading-snug">
                  หนังสือรับรองการหักภาษี ณ ที่จ่าย (ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร)
                </h2>
                <div className="border border-black p-3 space-y-1">
                  <div className="font-semibold">ผู้จ่ายเงิน</div>
                  <div>{payer.name}</div>
                  <div>เลขประจำตัวผู้เสียภาษี: {payer.taxId ?? '—'}</div>
                  {payer.address && <div>{payer.address}</div>}
                </div>
                <div className="border border-black p-3 space-y-1">
                  <div className="font-semibold">ผู้รับเงิน (ผู้ถูกหักภาษี)</div>
                  <div>{certFor.name}</div>
                  <div>เลขประจำตัวผู้เสียภาษี: {certFor.taxId ?? '—'}</div>
                </div>
                <table className="w-full border-collapse border border-black text-sm">
                  <thead>
                    <tr>
                      <th className="border border-black p-2 text-left">ประเภทเงินได้</th>
                      <th className="border border-black p-2 text-right">จำนวนเงินที่จ่าย</th>
                      <th className="border border-black p-2 text-right">ภาษีที่หักนำส่ง</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-black p-2">เงินปันผล — ม.40(4)(ข) (ภ.ง.ด.2) · ปีภาษี {year + 543}</td>
                      <td className="border border-black p-2 text-right font-mono">{formatNumberDecimal(parseFloat(certFor.gross), 2)}</td>
                      <td className="border border-black p-2 text-right font-mono">{formatNumberDecimal(parseFloat(certFor.wht), 2)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="flex justify-between pt-8">
                  <div>วันที่ออกหนังสือรับรอง: ____/____/______</div>
                  <div className="text-center">
                    <div>ลงชื่อ ______________________ ผู้จ่ายเงิน</div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => window.print()}>
                  <Printer className="h-4 w-4 mr-1" /> พิมพ์
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: EquityStatementPage — เพิ่ม capitalStatus cards**

ใน `apps/web/src/pages/EquityStatementPage.tsx`: (1) ขยาย type `EquityStatementData` เพิ่ม `capitalStatus?: { authorized: number; unpaid: number; paidUp: number; premium: number }` (2) เหนือตาราง SOCE เดิม เพิ่ม block (แสดงเมื่อ `capitalStatus` มีค่า):

```tsx
      {data?.capitalStatus && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'ทุนจดทะเบียน (Authorized)', value: data.capitalStatus.authorized, hint: 'GL 31-1101' },
            { label: 'ทุนชำระแล้ว (Paid-up)', value: data.capitalStatus.paidUp, hint: 'Authorized − ค้างชำระ' },
            { label: 'ค่าหุ้นค้างชำระ', value: data.capitalStatus.unpaid, hint: 'GL 11-1310' },
            { label: 'ส่วนเกินมูลค่าหุ้น', value: data.capitalStatus.premium, hint: 'GL 31-1102' },
          ].map((c) => (
            <div key={c.label} className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground leading-snug">{c.label}</div>
              <div className="text-lg font-semibold font-mono mt-1">
                {c.value.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">{c.hint}</div>
            </div>
          ))}
        </div>
      )}
```

(ปรับตัวแปร `data` ให้ตรงชื่อ query result ในไฟล์จริง — query อยู่บรรทัด ~79-88)

- [ ] **Step 3: Typecheck + web tests + commit**

```bash
./tools/check-types.sh web
npm --prefix apps/web run test
git add apps/web/src
git commit -m "feat(equity-web): ทะเบียนปันผล + หนังสือรับรอง ภ.ง.ด.2 + capitalStatus บนงบ Equity"
```

---

### Task 13: Docs + final verification

**Files:**
- Modify: `.claude/rules/accounting.md` (เพิ่มหัวข้อใหม่)
- (ตรวจอย่างเดียว) ทั้ง repo

- [ ] **Step 1: เพิ่มหัวข้อใน `.claude/rules/accounting.md`** (วางหลังหัวข้อ "Year-End Closing")

```markdown
## Equity Module — ธุรกรรมส่วนของผู้ถือหุ้น (2026-08-10)

Spec: `docs/superpowers/specs/2026-08-10-equity-module-design.md` · Plan: `docs/superpowers/plans/2026-08-10-equity-module.md`
Module: `apps/api/src/modules/equity/` · หน้า: `/finance/equity`, `/finance/dividend-register`

- 7 ประเภท: CAP_INIT (ครั้งเดียว, ชำระขั้นต่ำ 25% ม.1110, ค้างชำระเข้า **11-1310**), CAP_INC (31-1102 premium),
  CAP_DEC, DRAW (22-1102 Contra), DIV_DEC (Dr 32-1101 / Cr 21-4104 — TAS 10), DIV_PAY (WHT 10% → **21-3104**,
  เฉพาะบุคคลธรรมดา/นิติต่างชาติ; นิติไทย 0 ตาม ม.65 ทวิ(10)), PRIOR_ADJ (คู่ 32-1101 เท่านั้น — TAS 8)
- YE_CLOSE ของ prototype ถูกตัด — ใช้ `/finance/year-end-closing` เดิม
- JE: builder เดียว `equity-journal.builder.ts` → `JournalAutoService.createAndPost` ·
  `metadata.flow='equity'`, `idempotencyKey='equity:<docId>'` · reverse = mirror ตาม pattern interco
- Workflow: DRAFT→READY→POSTED→REVERSED · maker-checker opt-in ผ่าน SystemConfig
  **`EQUITY_MAKER_CHECKER_ENABLED`** (ไม่ seed — missing = OFF; เปิดแล้ว approver ≠ maker)
- GL guards ตอนโพสต์: `V_DIV_PAY_LE_PAYABLE` (Σจ่าย ≤ ยอด 21-4104), `V_CAP_DEC_LE_CAPITAL` (Σลด ≤ 31-1101) —
  block · `DIV_VS_RE` (ประกาศ > 32-1101) — **warning ไม่ block** (ปันผลระหว่างกาลทำได้)
- ภ.ง.ด.2: `GET /tax/pnd2-preview` + `export-xlsx?form=PND2` — อ่านจากเอกสาร DIV_PAY POSTED (ไม่เดิน GL)
- งบ Equity เดิมเพิ่ม `capitalStatus` (authorized/paidUp/unpaid/premium) + caveat เป็น conditional ตามสถานะปิดปี
- AuditLog: `EQUITY_CREATED/UPDATED/DELETED/SUBMITTED/WITHDRAWN/POSTED/REVERSED` (entity `equity_document`)
- **Prod rollout**: (1) รัน `seed:coa` หลัง deploy (บัญชีใหม่ 11-1310) (2) สร้างทะเบียนผู้ถือหุ้นตาม บอจ.5
  (3) **CAP_INIT backfill = CPA-gated** — ยอดยกมาทั้งชุด (ทุน+เงินสด+กำไรสะสม) ต้องให้ CPA เคาะก่อน
  ห้ามโพสต์ขา Dr ธนาคารเงียบๆ (opening-balance gap เดียวกับ interco spec §11)
- Deferred: Capital Call (รับชำระค่าหุ้นค้างภายหลัง — Dr เงิน / Cr 11-1310), แบบยื่น ภ.ง.ด.2 ทางการ
```

- [ ] **Step 2: Final verification ทั้งชุด**

```bash
./tools/check-types.sh all
npm --prefix apps/api run test          # jest unit ทั้งหมด (equity specs ใหม่รวมอยู่)
npm --prefix apps/web run test
cd apps/api && npx vitest run src/modules/equity/__tests__/equity.integration.spec.ts src/modules/accounting/equity-capital-status.integration.spec.ts
```
Expected: types ผ่านทั้งคู่ · jest ผ่าน (baseline เดิม + equity ใหม่) · web tests ผ่าน · vitest integration ผ่าน

- [ ] **Step 3: Commit + สรุปให้เจ้าของ**

```bash
git add .claude/rules/accounting.md
git commit -m "docs(rules): หัวข้อ Equity Module ใน accounting.md"
```

รายงานเจ้าของก่อน merge (ตาม memory `feedback_phase_review`): สรุปสิ่งที่ทำ + จุดที่ต้องตัดสินใจตอน rollout (seed:coa + CPA-gated backfill) — **ห้าม merge จนเจ้าของ approve**

---

## หมายเหตุผู้ execute

1. **ลำดับ task ต้องตามนี้** — 2/3 พึ่ง 1 (Prisma types), 5 พึ่ง 4, 6 พึ่ง 5, 10-12 พึ่ง backend เสร็จ
2. **อย่าเดา API ภายในที่ plan บอกให้ "ตรวจก่อนใช้"** (PageHeader/ConfirmDialog props, `metadata.year` ของ year-end JE, exports ของ journal.module) — เปิดไฟล์จริงแล้วปรับตาม
3. Integration spec ต้องมี DB จริง (docker ตาม `project_local_dev_setup`) — ถ้ารัน local ไม่ได้ให้พึ่ง CI หลังเพิ่ม glob
4. ก่อน commit ทุกครั้ง: เฉพาะไฟล์ที่เกี่ยว — ห้าม `git add -A` ทั้ง repo








