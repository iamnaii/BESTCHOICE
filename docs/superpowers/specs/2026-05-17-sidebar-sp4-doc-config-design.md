# SP4 — Document Number Config UI (Design Spec)

**Sub-project:** SP4 (of 6) — ดู roadmap: `2026-05-17-sidebar-redesign-roadmap.md`
**Status:** Design approved 2026-05-17
**ETA:** 2-4 commits / 1-2 days

---

## 1. Problem Statement

ปัจจุบัน document number convention (per `.claude/rules/accounting.md`):
```
<TYPE>-YYYYMMDD-NNNN
```
- TYPE prefix fixed in code: `EX`, `CN`, `PR`, `SE`, `OI`, `RT`
- Owner ต้องการ UI ปรับ format + เลขที่ ต่อ doc type (รายรับ/รายจ่าย)

CSV requirement (BESTCHOICE FINANCE 8):
> ตั้งค่าเอกสาร: รูปแบบ + เลขที่เอกสาร (ตัวอักษร/ปี/เดือน/วัน/เลขรัน)

## 2. Goals / Non-Goals

**Goals (SP4 scope):**
- `/settings/document-config` — Settings UI for each doc type
- View current format per type
- Edit prefix + reset cadence (DAILY/MONTHLY/YEARLY/NEVER)
- Preview format with sample (e.g., `EX-20260517-0001`)
- Audit log all changes
- Backend: read configs from new `DocumentNumberConfig` table (or extend existing SystemConfig)

**Non-Goals:**
- Per-company doc number formats (single FINANCE chart in Phase A.4)
- Custom Thai-character prefixes (e.g., จก-, รข-) — owner may add later
- Migrating historical doc numbers (only affects NEW docs)
- Per-branch sequences (already global)

## 3. Schema Design

### Option A (recommended): New `DocumentNumberConfig` model

```prisma
model DocumentNumberConfig {
  id            String   @id @default(uuid())
  docType       String   @unique  // 'EX', 'CN', 'PR', 'SE', 'OI', 'RT', 'CT', 'IV', etc.
  description   String              // Thai: 'ใบสำคัญจ่าย', 'ใบลดหนี้', etc.
  prefix        String   @default('') // user-editable, e.g. 'EX' or 'จก'
  format        String   @default('{prefix}-{YYYYMMDD}-{NNNN}')
  resetCadence  String   @default('DAILY') // DAILY | MONTHLY | YEARLY | NEVER
  digitCount    Int      @default(4)
  active        Boolean  @default(true)
  notes         String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?
  updatedById   String?
  updatedBy     User?    @relation("DocNumberConfigUpdatedBy", fields: [updatedById], references: [id])
  
  @@index([docType])
  @@index([deletedAt])
}
```

Migration: `20260939000000_add_document_number_config`:
- Create table
- Seed defaults for: EX, CN, PR, SE, OI, RT, CT (Contract), IV (Invoice — Phase 2), QU (Quote — Phase 2)

### Option B (alternative): SystemConfig key-value (cleaner but less queryable)

Use existing `SystemConfig` model:
```
key='doc_number_config.EX', value={ prefix: 'EX', format: '...', resetCadence: 'DAILY', digitCount: 4 }
```

**Decision: Option A** for clarity + JSON-schema validation + audit trail.

## 4. Service Changes

### Update `DocNumberService.next()` in `apps/api/src/utils/doc-number.service.ts` (or wherever it lives)

Current:
```ts
async next(docType: string, txDate: Date) {
  // Hard-coded format <TYPE>-YYYYMMDD-NNNN
  // Daily reset via advisory lock
}
```

New:
```ts
async next(docType: string, txDate: Date) {
  const config = await this.prisma.documentNumberConfig.findUnique({
    where: { docType, deletedAt: null },
  });
  if (!config) throw new NotFoundException(`Doc type ${docType} not configured`);
  
  // Build period bounds based on resetCadence
  const { periodStart, periodEnd } = this.getPeriodBounds(txDate, config.resetCadence);
  
  // Advisory lock per (docType, periodStart)
  // Find max existing seq in period
  // Format: replace tokens {prefix}, {YYYY}, {MM}, {DD}, {NNNN}, {NN}, etc.
}
```

### New endpoints in `apps/api/src/modules/settings/doc-config.controller.ts`

```
GET /settings/doc-config                         # list all configs
GET /settings/doc-config/:docType                # single config
PATCH /settings/doc-config/:docType              # update format/prefix/resetCadence/digitCount
POST /settings/doc-config/:docType/preview       # preview with sample data
```

Roles: OWNER only (Settings = OWNER per accounting.md).

### DTO

```ts
class UpdateDocConfigDto {
  @IsOptional() @IsString() @MaxLength(20) prefix?: string;
  @IsOptional() @IsString() @MaxLength(100) format?: string;
  @IsOptional() @IsIn(['DAILY', 'MONTHLY', 'YEARLY', 'NEVER']) resetCadence?: 'DAILY' | 'MONTHLY' | 'YEARLY' | 'NEVER';
  @IsOptional() @IsInt() @Min(1) @Max(10) digitCount?: number;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}
```

### Audit log

On update, write `AuditLog`:
- `action: 'DOC_NUMBER_CONFIG_UPDATED'`
- `entity: 'document_number_config'`
- `oldValue: { prefix, format, resetCadence, digitCount }`
- `newValue: { ... }`

## 5. Frontend

### New page `DocumentConfigPage.tsx` (`/settings/document-config`)

Layout:
- Header: "ตั้งค่าเลขที่/รูปแบบเอกสาร"
- Table of doc types:
  - Type / Thai name / Current format / Reset cadence / Last update / [Edit] button
- Edit dialog:
  - Prefix input (max 20 chars)
  - Format input with token helpers (insert {YYYY}/{MM}/{DD}/{NNNN}/{prefix})
  - Reset cadence dropdown (DAILY/MONTHLY/YEARLY/NEVER)
  - Digit count (1-10)
  - **Live preview**: "ตัวอย่างเลขที่ถัดไป: EX-20260517-0001"
  - Save / Cancel
- Confirmation dialog: "การเปลี่ยนแปลงจะมีผลกับเอกสารใหม่หลังจากนี้ (ไม่ย้อนหลัง)"

OWNER-only — redirect non-OWNER to `/`.

## 6. Test Plan

### API tests (`apps/api/src/modules/settings/__tests__/doc-config.service.spec.ts`)
- 4 tests: getAll, getByType, update, preview generates expected number
- 2 tests for `DocNumberService.next()` with custom format (replaces hard-coded path)
- 1 test for audit log writing on update

### Frontend (`apps/web/src/pages/DocumentConfigPage.test.tsx`)
- 3 tests: list renders, edit dialog opens, preview updates on format change

### Playwright
- 2 cases: OWNER can edit, BRANCH_MANAGER blocked

## 7. PR Breakdown

1. Backend: schema + migration + DocNumberConfig model + seed
2. Backend: DocNumberService.next() refactor to use config + tests
3. Backend: controller + DTO + audit log
4. Frontend: DocumentConfigPage + dialog + preview + tests
5. Route swap (placeholder → real)
6. Playwright E2E

## 8. Acceptance Criteria

- [ ] OWNER can view all doc type configs
- [ ] OWNER can edit prefix/format/resetCadence/digitCount
- [ ] Live preview shows next number
- [ ] Audit log written on changes
- [ ] BRANCH_MANAGER/FM/ACC/SALES redirected from page
- [ ] Existing doc number generation unchanged for unmodified types
- [ ] Tests pass, types clean, no emoji
