# PR-5: Favorites + Recurring Cron — Implementation Plan

**Goal:** Add `ExpenseTemplate` (per-branch shared) for repeated entries (utilities, payroll, settlements). Save form data as template via checkbox; click favorite → instantiate as DRAFT doc with prefilled fields (excl. amount/date). Optional `recurringDay` triggers daily cron at 08:00 BKK creating DRAFTs idempotently per (branch, date, template).

**Architecture:** New `ExpenseTemplate` table with `documentType` discriminator + `prefilledData` JSON. New CRUD endpoints `/expense-templates`. Recurring cron in `expense-documents/crons/`. Frontend `/expenses/favorites` page (card grid). Each form (EX/CN/PR/SE) gains "บันทึกเป็นรายการโปรด" checkbox with name input.

**Branch:** `feat/expense-documents-pr5` (off `feat/expense-documents-pr4`).

**Spec ref:** §1.3 (ExpenseTemplate), §7.1 (workflow + cron).

---

## File Structure

### API
- Modify: `prisma/schema.prisma` — add `ExpenseTemplate`
- Create: `prisma/migrations/<ts>_add_expense_template/migration.sql`
- Create: `modules/expense-documents/expense-templates.service.ts`
- Create: `modules/expense-documents/expense-templates.controller.ts`
- Create: `modules/expense-documents/dto/create-template.dto.ts`
- Create: `modules/expense-documents/dto/update-template.dto.ts`
- Modify: `modules/expense-documents/expense-documents.module.ts` — register
- Create: `modules/expense-documents/crons/expense-recurring.cron.ts`
- Tests: 1 service spec + 1 cron spec

### Web
- Create: `pages/ExpenseFavoritesPage.tsx` — card grid + filter + edit modal
- Modify: `App.tsx` — add `/expenses/favorites` route
- Modify: `pages/ExpensesPage.tsx` — wire `รายการโปรด` tab to navigate
- Modify: 4 forms (EX/CN/PR/SE) — add "บันทึกเป็นรายการโปรด" checkbox + name input

---

## Task 1: Schema

Add to `apps/api/prisma/schema.prisma` after `SettlementLine` model:

```prisma
model ExpenseTemplate {
  id              String   @id @default(uuid())
  name            String
  documentType    DocumentType    @map("document_type")
  branchId        String          @map("branch_id")
  prefilledData   Json            @map("prefilled_data")
  isRecurring     Boolean         @default(false) @map("is_recurring")
  recurringDay    Int?            @map("recurring_day")
  createdById     String          @map("created_by_id")
  createdAt       DateTime        @default(now()) @map("created_at")
  updatedAt       DateTime        @updatedAt @map("updated_at")
  deletedAt       DateTime?       @map("deleted_at")

  branch          Branch          @relation(fields: [branchId], references: [id])
  createdBy       User            @relation("ExpenseTemplateCreator", fields: [createdById], references: [id])

  @@index([branchId, deletedAt])
  @@index([isRecurring, recurringDay])
  @@map("expense_templates")
}
```

In `model Branch` add: `expenseTemplates ExpenseTemplate[]`
In `model User` add: `expenseTemplates ExpenseTemplate[] @relation("ExpenseTemplateCreator")`

Migration `20260914000000_add_expense_template/migration.sql`:

```sql
CREATE TABLE "expense_templates" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "document_type" "DocumentType" NOT NULL,
  "branch_id" TEXT NOT NULL,
  "prefilled_data" JSONB NOT NULL,
  "is_recurring" BOOLEAN NOT NULL DEFAULT false,
  "recurring_day" INTEGER,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "expense_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expense_templates_branch_id_deleted_at_idx" ON "expense_templates"("branch_id", "deleted_at");
CREATE INDEX "expense_templates_is_recurring_recurring_day_idx" ON "expense_templates"("is_recurring", "recurring_day");

ALTER TABLE "expense_templates" ADD CONSTRAINT "expense_templates_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT;
ALTER TABLE "expense_templates" ADD CONSTRAINT "expense_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
```

## Task 2: ExpenseTemplatesService (TDD)

Service methods:
- `create(dto, user)` — branch access check, validates `recurringDay` 1-31 if `isRecurring`
- `list({ branchId, type? }, user)` — filter, exclude deleted
- `findOne(id, user)` — branch access
- `update(id, dto, user)` — branch access
- `softDelete(id, user)` — sets deletedAt
- `instantiate(id, user, dto?)` — creates DRAFT doc from prefilledData. dto optional for overriding e.g. amount.

Tests (8):
1. create rejects when isRecurring=true without recurringDay
2. create rejects recurringDay out of 1-31
3. list filters by branchId + excludes deleted
4. update preserves immutable fields (documentType)
5. softDelete sets deletedAt
6. instantiate EX → creates DRAFT EX with prefilledData merged + fromTemplateId set
7. instantiate PR → creates DRAFT PR with payrollPeriod from current month
8. instantiate cross-branch rejected

Implementation key points:
- `prefilledData` shape varies by documentType (EX has category/vendor/method; PR has period default; SE has empty since lines come at instantiate time)
- `instantiate()` uses existing `service.create/createCreditNote/createPayroll/createSettlement` methods — must adapt prefilledData to each type's DTO shape
- Sets `fromTemplateId: template.id` on created doc

## Task 3: Controller endpoints

```
GET    /expense-templates              list (query: branchId, type)
POST   /expense-templates              create
GET    /expense-templates/:id          findOne
PATCH  /expense-templates/:id          update
DELETE /expense-templates/:id          softDelete
POST   /expense-templates/:id/instantiate  → returns new DRAFT doc id
```

Roles: OWNER/BRANCH_MANAGER/FINANCE_MANAGER/ACCOUNTANT for all.

## Task 4: Recurring cron

Create `modules/expense-documents/crons/expense-recurring.cron.ts`:

```ts
@Cron('0 8 * * *', { timeZone: 'Asia/Bangkok' })
async tick() {
  const today = new Date();
  const dayOfMonth = today.getDate();
  const templates = await this.prisma.expenseTemplate.findMany({
    where: { isRecurring: true, recurringDay: dayOfMonth, deletedAt: null },
  });
  for (const tpl of templates) {
    try {
      // Idempotency: skip if any doc exists for (branch, date, template)
      const existing = await this.prisma.expenseDocument.findFirst({
        where: {
          branchId: tpl.branchId,
          documentDate: { gte: startOfDay(today), lte: endOfDay(today) },
          fromTemplateId: tpl.id,
        },
      });
      if (existing) continue;
      await this.templatesService.instantiate(tpl.id, /* system user */, { documentDate: today });
    } catch (e) {
      Sentry.captureException(e, { extra: { templateId: tpl.id } });
    }
  }
}
```

Need system user lookup helper (mirror BadDebtProvisionCron pattern: `findFirst({ where: { isSystemUser: true } })`).

Tests (3):
1. Cron skips when no templates have recurringDay = today
2. Cron creates DRAFT for active templates
3. Cron is idempotent (no duplicate creation if doc already exists)

## Task 5: Frontend ExpenseFavoritesPage

Card grid layout per spec mockup. Each card shows: name, type badge, vendor preview, recurring chip (`🔄 ทุก ${recurringDay}`), actions [ใช้, แก้ไข, ลบ].

"ใช้" → POST `/expense-templates/:id/instantiate` → redirect to `/expenses/{newId}` (or open form with id).

"แก้ไข" → modal with name + recurring fields (other fields read-only since they came from form save).

Skeleton:
```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

export default function ExpenseFavoritesPage() {
  const navigate = useNavigate();
  const { data: templates } = useQuery({
    queryKey: ['expense-templates'],
    queryFn: async () => (await api.get('/expense-templates')).data,
  });
  // ... card grid + action buttons
}
```

Update `pages/ExpensesPage.tsx` — `รายการโปรด` tab onClick navigates to `/expenses/favorites` (currently is filter tab).

Update each form (EX/CN/PR/SE) to add checkbox at bottom:
```tsx
<label>
  <input type="checkbox" checked={saveAsTemplate} onChange={...} />
  🔖 บันทึกเป็นรายการโปรด
</label>
{saveAsTemplate && (
  <input value={templateName} onChange={...} placeholder="ชื่อ template (เช่น ค่าไฟ)" />
)}
```

When form submits + saveAsTemplate=true: also call `POST /expense-templates` with prefilledData = current form values (excl. amount + date).

## Task 6: Verify + push + PR

```bash
./tools/check-types.sh all
git push -u origin feat/expense-documents-pr5
gh pr create --base feat/expense-documents-pr4 --title "PR-5: Favorites + Recurring Cron"
```

---

## Self-Review

- §1.3 schema ✅, §7.1 workflow + cron ✅
- Idempotency via `fromTemplateId` (already present from PR-1)
- Branch scoping via `hasCrossBranchAccess`

## Out of Scope
- Cross-branch template share — per-branch only
- Template versioning — overwrite on edit
- Recurring with end date — runs forever until soft-deleted
- Analytics on template usage — defer
