# Contact Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) trade-in sellers unify with their existing Customer/Contact, (2) merge() carries identity fields + audit + a search-based UI, (3) partial-unique indexes on Contact.taxId/nationalIdHash (WHERE deleted_at IS NULL) + P2002 retry.

**Architecture:** Backend-first. Part 3 (schema + resolver retry) is the foundation; Part 1 keys trade-in via customerId/sellerIdCardNumber; Part 2 fixes merge + adds UI. Partial unique makes uniqueness a DB guarantee (durable) and lets merge carry taxId to the primary while the soft-deleted duplicate's row is excluded from the constraint.

**Tech Stack:** NestJS + Prisma + Postgres + Jest (api), React + react-query + Vitest (web)

**Spec:** `docs/superpowers/specs/2026-06-02-contact-hardening-design.md`

**Verified facts:** `normalizeNationalId` = `raw.replace(/[\s-]/g,'').toUpperCase()` (`customers.service.ts:459-461`). `CustomerPiiService.hash(value)` returns sha256(salt) or null. `TradeIn` has `customerId?`, `sellerName`, `sellerPhone`, `sellerIdCardNumber` (plaintext 13-digit), `sellerContactId`. `merge()` (`contacts.service.ts`) currently unions roles + repoints + soft-deletes, does NOT carry identity fields nor audit. Resolver create block has no P2002 handling. Task-1 (prior) migration named the taxId unique `contacts_tax_id_key` (Prisma default — confirm).

---

## PART 3 — partial unique + retry

### Task 1: Partial unique indexes (migration)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model Contact: remove `@@unique([taxId])`; keep field)
- Create: `apps/api/prisma/migrations/<synthetic-ts>_contact_partial_unique/migration.sql`

- [ ] **Step 1: Pre-check dev DB for existing duplicate keys (must be empty before adding unique)**

Run (psql via DATABASE_URL, or `prisma db execute`):
```sql
SELECT tax_id, count(*) FROM contacts WHERE deleted_at IS NULL AND tax_id IS NOT NULL GROUP BY tax_id HAVING count(*) > 1;
SELECT national_id_hash, count(*) FROM contacts WHERE deleted_at IS NULL AND national_id_hash IS NOT NULL GROUP BY national_id_hash HAVING count(*) > 1;
```
Expected: 0 rows each. If any rows → STOP, report (must dedupe via merge first). (At ~37 clean rows this should be empty.)

- [ ] **Step 2: Edit schema** — in `model Contact` remove the line `@@unique([taxId])`. Keep `taxId String? @map("tax_id")` and `nationalIdHash String? @map("national_id_hash")` + their `@@index`. (We replace the full unique with a partial one in raw SQL.)

- [ ] **Step 3: Hand-author the migration** (synthetic timestamp folder sorting LAST, e.g. `20260967000000_contact_partial_unique`). `migration.sql`:
```sql
-- Drop the full unique on tax_id (created as contacts_tax_id_key by the add_contact_party_master migration)
DROP INDEX IF EXISTS "contacts_tax_id_key";
-- Partial unique: only non-null, non-deleted rows are unique (keyless/soft-deleted excluded)
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_tax_id_active_key" ON "contacts"("tax_id") WHERE "deleted_at" IS NULL AND "tax_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_national_id_hash_active_key" ON "contacts"("national_id_hash") WHERE "deleted_at" IS NULL AND "national_id_hash" IS NOT NULL;
```
> Confirm the real existing index name first: `\d contacts` (psql) or check the add_contact_party_master migration.sql — use the actual name in DROP INDEX. The pre-existing `@@index([nationalIdHash])` (non-unique) can stay; the new partial unique is additional.

- [ ] **Step 4: Apply on dev + regenerate client + verify**

Run: `cd apps/api && npx prisma migrate reset --force --skip-seed` (dev throwaway — replays all incl. new) — confirm it applies cleanly and `\d contacts` shows the two `*_active_key` partial unique indexes. Then `npx prisma generate`. (`prisma migrate reset` needs `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1` env in this harness, per prior tasks.)
- Verify partial-unique semantics with a quick check: inserting two non-deleted rows with same tax_id fails; with deleted_at set on one, allowed. (Optional manual psql check.)

- [ ] **Step 5: Type-check + commit** — `./tools/check-types.sh api` (0 errors) ; `git add apps/api/prisma && git commit -m "feat(contacts): partial unique on taxId/nationalIdHash (WHERE deleted_at IS NULL)"`

---

### Task 2: Resolver P2002 → friendly ConflictException

> SCRUTINIZE FIX: the original plan re-fetched in the SAME transaction after a P2002. In Postgres a failed statement ABORTS the transaction ("current transaction is aborted") — and the resolver always runs inside the caller's `$transaction`, so an in-tx re-query throws. We CANNOT recover in-tx without a savepoint. Instead, translate P2002 to a clear `ConflictException`; the caller's tx rolls back and the user retries. (C3 race is low-probability; the goal is just a sane error, not a silent attach.)

**Files:**
- Modify: `apps/api/src/modules/contacts/contact-resolver.service.ts` (`findOrCreateByNaturalKey`)
- Test: `apps/api/src/modules/contacts/__tests__/contact-resolver.service.spec.ts`

- [ ] **Step 1: Failing test**
```typescript
it('translates a P2002 on create into a ConflictException (no in-tx re-query)', async () => {
  prisma.contact.findFirst
    .mockResolvedValueOnce(null)             // initial natural-key lookup → no match
    .mockResolvedValueOnce({ contactCode: 'P-00001' }); // nextContactCode
  const err: any = new Error('unique'); err.code = 'P2002';
  prisma.contact.create.mockRejectedValue(err);
  await expect(
    svc.findOrCreateByNaturalKey(prisma, { name: 'X', taxId: '0105', nationalIdHash: null, role: 'SUPPLIER' }),
  ).rejects.toThrow('ผู้ติดต่อนี้ถูกสร้างพร้อมกัน');
  // must NOT attempt a second findFirst after the failed create (no in-tx re-query)
  expect(prisma.contact.findFirst).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run FAIL** — `cd apps/api && npx jest contact-resolver --silent`

- [ ] **Step 3: Implement** — wrap ONLY the create; on P2002 throw a ConflictException (do NOT query again in this tx):
```typescript
import { ConflictException } from '@nestjs/common';
// ... inside findOrCreateByNaturalKey, replace the final create block:
const contactCode = await this.nextContactCode(tx);
try {
  return await tx.contact.create({
    data: { contactCode, name: input.name, taxId: input.taxId ?? null, nationalIdHash: input.nationalIdHash ?? null, phone: input.phone ?? null, email: input.email ?? null, roles: [input.role] },
  });
} catch (e) {
  if ((e as { code?: string })?.code === 'P2002') {
    // Concurrent create of the same party (partial-unique race). The tx is now
    // aborted, so we cannot recover here — surface a retryable conflict.
    throw new ConflictException('ผู้ติดต่อนี้ถูกสร้างพร้อมกัน กรุณาลองใหม่อีกครั้ง');
  }
  throw e;
}
```

- [ ] **Step 4: Run PASS + type-check** — `cd apps/api && npx jest contact-resolver --silent && cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api`
- [ ] **Step 5: Commit** — `git add apps/api/src/modules/contacts && git commit -m "feat(contacts): translate resolver P2002 to retryable ConflictException"`

---

## PART 1 — trade-in unify

### Task 3: Key trade-in seller by customerId/sellerIdCardNumber

**Files:**
- Modify: `apps/api/src/modules/trade-in/trade-in.service.ts` (create, ~line 196) + `trade-in.module.ts`
- Test: `apps/api/src/modules/trade-in/__tests__/trade-in.service.spec.ts`

- [ ] **Step 1: Failing tests**
```typescript
it('keys trade-in seller by customer nationalIdHash when customerId given (unifies)', async () => {
  // mock prisma.customer.findUnique -> { id:'cus1', nationalIdHash:'h1' }
  resolver.findOrCreateByNaturalKey.mockResolvedValue({ id: 'cShared' });
  const res = await service.create({ customerId: 'cus1', sellerName: 'A', /* ...required fields */ } as any);
  expect(resolver.findOrCreateByNaturalKey).toHaveBeenCalledWith(expect.anything(),
    expect.objectContaining({ role: 'TRADE_IN_SELLER', nationalIdHash: 'h1' }));
});
it('keys by hashed sellerIdCardNumber (normalized) when no customerId', async () => {
  pii.hash.mockReturnValue('hcard');
  resolver.findOrCreateByNaturalKey.mockResolvedValue({ id: 'c2' });
  await service.create({ sellerName: 'B', sellerIdCardNumber: '1-1019 00201390', /* ... */ } as any);
  expect(pii.hash).toHaveBeenCalledWith('1101900201390'); // normalized: strip space/dash, upper
  expect(resolver.findOrCreateByNaturalKey).toHaveBeenCalledWith(expect.anything(),
    expect.objectContaining({ nationalIdHash: 'hcard' }));
});
it('stays keyless when neither customerId nor sellerIdCardNumber', async () => {
  resolver.findOrCreateByNaturalKey.mockResolvedValue({ id: 'c3' });
  await service.create({ sellerName: 'C', /* ... */ } as any);
  expect(resolver.findOrCreateByNaturalKey).toHaveBeenCalledWith(expect.anything(),
    expect.objectContaining({ nationalIdHash: null }));
});
```
> Adapt to the real `create` mock setup + required DTO fields (read the spec file's existing tests). Inject mocked `CustomerPiiService` (as `pii`) + `ContactResolverService` (as `resolver`).

- [ ] **Step 2: Run FAIL** — `cd apps/api && npx jest trade-in.service --silent`

- [ ] **Step 3: Implement** — inject `CustomerPiiService`; add a private normalizer identical to Customer's; compute the seller hash before the resolver call:
```typescript
private normalizeNationalId(raw: string): string { return raw.replace(/[\s-]/g, '').toUpperCase(); }

// inside create, before findOrCreateByNaturalKey:
let sellerNationalIdHash: string | null = null;
if (dto.customerId) {
  const cust = await tx.customer.findUnique({ where: { id: dto.customerId }, select: { nationalIdHash: true } });
  sellerNationalIdHash = cust?.nationalIdHash ?? null;
} else if (dto.sellerIdCardNumber) {
  sellerNationalIdHash = this.pii.hash(this.normalizeNationalId(dto.sellerIdCardNumber));
}
const sellerContact = await this.contactResolver.findOrCreateByNaturalKey(tx, {
  name: dto.sellerName ?? 'ไม่ระบุชื่อ',
  taxId: null,
  nationalIdHash: sellerNationalIdHash,
  phone: dto.sellerPhone ?? null,
  role: 'TRADE_IN_SELLER',
});
```
Add `imports: [CustomersModule]` (or whichever module exports `CustomerPiiService`) to `trade-in.module.ts` — confirm `CustomerPiiService` is exported; if not, export it. Watch for circular deps (customers↔trade-in); if cyclic, instead import the smaller `CustomerPiiModule` if one exists, or duplicate the tiny hash via the crypto util directly. Report if cyclic.

- [ ] **Step 4: Run PASS + type-check** — `cd apps/api && npx jest trade-in --silent && ./tools/check-types.sh api`
- [ ] **Step 5: Commit** — `git add apps/api/src/modules/trade-in apps/api/src/modules/customers && git commit -m "feat(contacts): unify trade-in seller with customer via id-card/customerId"`

---

## PART 2 — merge fix + UI

### Task 4: merge carries identity fields + audit

**Files:**
- Modify: `apps/api/src/modules/contacts/contacts.service.ts` (`merge`)
- Test: `apps/api/src/modules/contacts/__tests__/contacts.service.spec.ts`

- [ ] **Step 1: Failing test**
```typescript
it('carries identity fields from duplicate to primary when primary lacks them + audits', async () => {
  prisma._tx.contact.findMany.mockResolvedValue([
    { id: 'p1', roles: ['CUSTOMER'], taxId: null, nationalIdHash: null, peakContactCode: null, phone: null, email: null },
    { id: 'd1', roles: ['SUPPLIER'], taxId: '0105', nationalIdHash: 'h', peakContactCode: 'C001', phone: '02', email: 'a@b.c' },
  ]);
  await svc.merge({ primaryId: 'p1', duplicateId: 'd1' });
  // primary updated with carried fields + union roles
  expect(prisma._tx.contact.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'p1' },
    data: expect.objectContaining({ taxId: '0105', nationalIdHash: 'h', peakContactCode: 'C001', phone: '02', email: 'a@b.c' }),
  }));
  // audit written
  expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CONTACTS_MERGED' }));
});
it('does NOT overwrite primary fields that are already set', async () => {
  prisma._tx.contact.findMany.mockResolvedValue([
    { id: 'p1', roles: [], taxId: '9999', nationalIdHash: null, peakContactCode: null, phone: '08', email: null },
    { id: 'd1', roles: [], taxId: '0105', nationalIdHash: null, peakContactCode: null, phone: '02', email: null },
  ]);
  await svc.merge({ primaryId: 'p1', duplicateId: 'd1' });
  const primaryUpdate = prisma._tx.contact.update.mock.calls.find((c: any) => c[0].where.id === 'p1');
  expect(primaryUpdate[0].data.taxId).toBe('9999'); // kept primary's
  expect(primaryUpdate[0].data.phone).toBe('08');
});
```
> Add a mocked `AuditService` (`audit`) to the merge test module. Update the existing merge test's `findMany` mock to include the new fields (taxId/nationalIdHash/etc.) so it still passes.

- [ ] **Step 2: Run FAIL** — `cd apps/api && npx jest contacts.service --silent`

- [ ] **Step 3: Implement** — inject `AuditService`; compute carried fields with coalesce; **soft-delete the duplicate FIRST, then update the primary** (order is critical — see note):
```typescript
const carry = {
  taxId: primary.taxId ?? duplicate.taxId,
  nationalIdHash: primary.nationalIdHash ?? duplicate.nationalIdHash,
  peakContactCode: primary.peakContactCode ?? duplicate.peakContactCode,
  phone: primary.phone ?? duplicate.phone,
  email: primary.email ?? duplicate.email,
};
// 1) Soft-delete the duplicate FIRST so it leaves the partial-unique scope,
//    otherwise setting the carried taxId/nationalIdHash on the (still-active)
//    primary collides with the (still-active) duplicate → P2002.
await tx.contact.update({ where: { id: duplicateId }, data: { deletedAt: new Date() } });
// 2) Now the carried keys are unique among active rows.
await tx.contact.update({ where: { id: primaryId }, data: { roles: { set: unionRoles }, ...carry } });
await this.audit.log({ action: 'CONTACTS_MERGED', entity: 'contact', entityId: primaryId, newValue: { duplicateId, mergedRoles: unionRoles, carried: carry } });
return { primaryId, mergedRoles: unionRoles };
```
> SCRUTINIZE FIX: the original order (update primary → then soft-delete duplicate) would, at the primary update, have TWO active rows (deletedAt null) holding the same taxId/nationalIdHash → partial-unique P2002. Soft-deleting the duplicate first removes it from the `WHERE deleted_at IS NULL` index so the carry succeeds. The FK repoints (customer/supplier/tradeIn/finance) can stay where they are (before or after) — they don't touch the unique. Inject AuditService via its `@Global` module (no import needed) like the bypass tasks did. Confirm `AuditService.log` signature from prior usage.

- [ ] **Step 4: Run PASS + type-check** — `cd apps/api && npx jest contacts.service --silent && ./tools/check-types.sh api`
- [ ] **Step 5: Commit** — `git add apps/api/src/modules/contacts && git commit -m "feat(contacts): merge carries identity fields from duplicate + audit"`

---

### Task 5: Merge UI (search-based)

**Files:**
- Modify: `apps/web/src/pages/ContactDetailPage.tsx` (add "รวมผู้ติดต่อซ้ำ" — OWNER)
- Possibly: `apps/web/src/lib/api/contacts.ts` (merge already exists; add a search helper if needed — `contactsApi.list` exists)
- Test: `apps/web/src/pages/__tests__/ContactDetailPage.test.tsx`

- [ ] **Step 1: Failing test**
```tsx
it('OWNER can search a duplicate and merge it into the current contact', async () => {
  // mock useAuth/role = OWNER (match how the app exposes role in tests)
  (contactsApi.detail as any).mockResolvedValue({ id: 'c1', contactCode: 'P-1', name: 'A', roles: ['CUSTOMER'], isActive: true, taxId: null, phone: null, email: null, peakContactCode: null, customers: [], suppliers: [], tradeInsAsSeller: [], externalFinanceCompany: [] });
  (contactsApi.list as any).mockResolvedValue({ data: [{ id: 'c2', contactCode: 'P-2', name: 'A dup', roles: ['SUPPLIER'], isActive: true, taxId: '0105', phone: null, email: null, peakContactCode: null }], total: 1, page: 1, limit: 50 });
  (contactsApi.merge as any) = vi.fn().mockResolvedValue({ primaryId: 'c1' });
  // render page as OWNER, click "รวมผู้ติดต่อซ้ำ", search, pick c2, confirm
  // assert contactsApi.merge called with (primaryId='c1', duplicateId='c2')
});
```
> Adapt to how the app provides current user role in tests (find an existing test that renders an OWNER-gated control). If role wiring in tests is heavy, at minimum test: the merge dialog calls `contactsApi.merge('c1','c2')` on confirm.

- [ ] **Step 2: Run FAIL** — `cd apps/web && npx vitest run ContactDetailPage --silent`

- [ ] **Step 3: Implement** — add an OWNER-only "รวมผู้ติดต่อซ้ำ" button on ContactDetailPage header that opens a dialog: a debounced search input → `contactsApi.list({ search })` results (exclude the current contact id) → pick one → ConfirmDialog (destructive) showing "ยุบ [P-2 name] เข้า [current] — role/ข้อมูลจะรวมเข้าอันนี้ ตัวที่เลือกจะถูกปิด" → on confirm `contactsApi.merge(currentId, selectedId)` → invalidate `contactKeys.detail(currentId)` + toast.success + close. Gate the button by OWNER role (use the app's existing role hook/context — find how other OWNER-only UI gates). Semantic tokens, Thai leading-snug, reuse ConfirmDialog.

- [ ] **Step 4: Run PASS + type-check** — `cd apps/web && npx vitest run ContactDetailPage --silent && ./tools/check-types.sh web`
- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(contacts): merge duplicate contacts UI (OWNER, search-based)"`

---

## Task 6: Verify
- [ ] `./tools/check-types.sh all` → 0 errors
- [ ] `cd apps/api && npx jest contact-resolver contacts.service trade-in --silent` → green
- [ ] `cd apps/web && npx vitest run ContactDetailPage --silent` → green
- [ ] Confirm migration present + partial indexes exist on dev (`\d contacts`)

---

## Self-Review
- **Spec coverage:** partial unique + pre-check (T1) ✓; P2002 retry/C3 (T2) ✓; trade-in unify/I2 (T3) ✓; merge carry/C1 + audit/M2 (T4) ✓; merge UI (T5) ✓.
- **Placeholders:** test bodies note "adapt to real DTO/role wiring" — implementer must read the actual create-DTO + role hook; behavior fully specified. Index name in DROP must be confirmed against the real migration.
- **Type consistency:** `findOrCreateByNaturalKey` input unchanged; `merge` return unchanged; `nationalIdHash` carried as string|null throughout; normalizeNationalId identical to Customer's.
- **Dependency order:** T1 (partial unique) before T4 (merge carry) — T4 relies on the soft-deleted duplicate being excluded from the unique so carrying taxId doesn't P2002.
- Backlog (not done): I1, I3, I4, I5, M1, M3.
