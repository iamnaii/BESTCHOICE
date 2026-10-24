# ด่าน blacklist ตอนทำสัญญา (ก้อน 5 — C3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ลูกค้าที่ติด blacklist (HARD) เปิดสัญญาผ่อนไม่ได้ทั้งตอนสร้างร่างและตอนเปิดใช้; ลูกค้าที่พัวพันผู้อ้างอิง (SOFT) ต้องให้ OWNER/ผจก.สาขาปลดพร้อมเหตุผลที่บันทึกลงสัญญา; ผลตรวจโชว์ล่วงหน้าที่หน้าสร้างสัญญา/ตรวจเครดิต/แชท/หน้าลูกค้า.

**Architecture:** `CustomerBlacklistService` (โมดูลใหม่ `CustomerBlacklistModule` — Prisma + `CustomerPiiService`) คืน `{ level, reasons[] }` จากสถานะปัจจุบันของสัญญา/ยึด/tag/เบอร์/ผู้อ้างอิง. ฟังก์ชันบริสุทธิ์ `assertBlacklistGate` แปลงผลเป็น 409 สองโค้ด และถูกเรียกสองจุด: `ContractLifecycleService.create()` (เขียนการปลด SOFT ลงแถวสัญญา) และ `ContractWorkflowService.activate()` (ยอมรับการปลดที่บันทึกไว้). `assertCustomerContractPolicy` กลายเป็น fail-closed ใน tx ทั้งสองจุด. Web ใช้ hook เดียว `useCustomerBlacklist` + `CustomerBlacklistBadge` + `BlacklistReasonList` ร่วมกัน 4 หน้า.

**Tech Stack:** NestJS + Prisma (jest) · React/Vite/shadcn (vitest) · `packages/shared` สำหรับ type/constant ร่วม (API อ่านจาก dist — ต้อง `npm run build --workspace=@installment/shared` ก่อนรัน jest ทุกครั้งที่แก้ shared)

**Spec:** `docs/superpowers/specs/2026-10-23-contract-blacklist-gate-design.md` (รอบ 3, commit `4f1b01e55`)

## Global Constraints

- ข้อความ UI/validation เป็นภาษาไทย · โทเคนสีจาก `index.css` เท่านั้น (`bg-destructive/5`, `border-warning/40`, `text-warning-strong`) ห้าม hex/gray
- 409 ใช้ `ConflictException({ code, level, reasons, message, canOverride? })` — `code` ∈ `CUSTOMER_BLACKLISTED` (HARD) · `CUSTOMER_BLACKLIST_REVIEW` (SOFT)
- เหตุผลปลด SOFT: trim แล้ว 10–500 ตัว · บทบาทที่ปลดได้ `OWNER`, `BRANCH_MANAGER` เท่านั้น · ข้อความ validation `กรุณาระบุเหตุผล 10–500 ตัวอักษร`
- `ACTIVE_CONTRACT` นับสถานะ `ACTIVE`, `OVERDUE`, `DEFAULT` (ไม่นับ `DRAFT`) · set blacklist = `CLOSED_BAD_DEBT`/`TERMINATED` + `Repossession` ไม่ถูกลบ + tag `BLACKLIST` ไม่ถูกลบ (รวมลูกค้า soft-delete; ตัดแฝด `mergedIntoId` ทั้งสองทิศ)
- โหมดทดสอบ (`isTestModeEnabled`) **ไม่ข้าม** ด่าน blacklist · สัญญาเปลี่ยนเครื่อง (`exchangedFromContractId` มีค่า) **ข้าม** ด่านทั้งสองชั้นตอน activate
- AuditLog เขียน **หลัง** `$transaction` commit ผ่าน `AuditService.log` (database.md) · ห้าม `await audit.log` ใน tx
- ห้ามรัน `npm --prefix apps/api run lint` (มี `--fix`) · ห้าม bare `git stash` · seed ชื่อใน e2e ห้ามมีตัวเลข (บทเรียน `generateSaleNumber`)
- bump `apps/web/package.json` version → `26.10.52`
- คำสั่งเทส: API `npm --prefix apps/api test -- <path>` · Web `(cd apps/web && npx vitest run <path>)` · Shared `(cd packages/shared && npx vitest run <path>)` · e2e disposable-Postgres `tools/test-chat-credit.sh`

## Review Focus

1. **สัญญาเปลี่ยนเครื่อง** — `activate()` ของสัญญาที่มี `exchangedFromContractId` ต้องไม่ถูก `ACTIVE_CONTRACT` ของสัญญาเดิมบล็อก (Task 6 เทส "exchange contract skips the gate")
2. **ลูกค้าไม่มีเบอร์ (ผู้สนใจจากแชท `phone = null`) / ไม่มี references** — evaluate ต้องคืน NONE ไม่ throw (Task 3 เทส "skips phone and reference matching when the customer has no phone")
3. **ciphertext ของสมาชิก set เสีย** — `decryptCustomerFields` โยน → ข้ามสมาชิกนั้น ไม่ล้มทั้ง evaluate (Task 3 เทส "ignores a set member whose references cannot be decrypted")
4. **SALES ปลอม `blacklistOverrideReason`** ตอน SOFT → 409 REVIEW `canOverride:false` และไม่เขียนคอลัมน์ (Task 4 + Task 5)
5. **หน้าเว็บโหลดผลไม่ได้** — `canNext` เป็น false ขณะ loading/error และมีปุ่มลองใหม่ (Task 9 เทส "disables next while the blacklist query is loading or failed")

---

### Task 1: Shared types + constants

**Files:**
- Create: `packages/shared/src/customer-blacklist.ts`
- Create: `packages/shared/src/customer-blacklist.test.ts`
- Modify: `packages/shared/src/index.ts` (เพิ่ม `export * from './customer-blacklist';` ท้ายไฟล์)

**Interfaces:**
- Produces:
  ```ts
  export type BlacklistLevel = 'NONE' | 'SOFT' | 'HARD';
  export type BlacklistReasonCode =
    | 'ACTIVE_CONTRACT' | 'BAD_DEBT' | 'REPOSSESSED' | 'TERMINATED_UNRETURNED' | 'MANUAL_TAG' | 'PHONE_MATCH'
    | 'REFERENCES_BLACKLISTED' | 'REFERENCED_BY_BLACKLISTED';
  export const HARD_BLACKLIST_CODES: ReadonlySet<BlacklistReasonCode>; // 6 ตัวแรก
  export interface BlacklistReason { code: BlacklistReasonCode; level: 'HARD' | 'SOFT'; message: string;
    contractNumber?: string | null; related?: { customerId: string; name: string } | null }
  export interface CustomerBlacklistResult { level: BlacklistLevel; reasons: BlacklistReason[]; checkedAt: string }
  export const BLACKLIST_OVERRIDE_ROLES = ['OWNER', 'BRANCH_MANAGER'] as const;
  export const BLACKLIST_OVERRIDE_REASON_MIN = 10; export const BLACKLIST_OVERRIDE_REASON_MAX = 500;
  export const BLACKLIST_BATCH_MAX = 100;
  export const BLACKLIST_ERROR_CODE = { HARD: 'CUSTOMER_BLACKLISTED', SOFT: 'CUSTOMER_BLACKLIST_REVIEW' } as const;
  export function resolveBlacklistLevel(reasons: Pick<BlacklistReason, 'level'>[]): BlacklistLevel;
  export function canOverrideBlacklist(role: string | null | undefined): boolean;
  export function isValidBlacklistOverrideReason(reason: string | null | undefined): reason is string; // trim length 10–500
  ```

- [ ] **Step 1: เขียนเทสที่ fail**

```ts
import { describe, expect, it } from 'vitest';
import { canOverrideBlacklist, isValidBlacklistOverrideReason, resolveBlacklistLevel } from './customer-blacklist';

describe('customer-blacklist shared rules', () => {
  it('HARD wins over SOFT, SOFT over nothing', () => {
    expect(resolveBlacklistLevel([])).toBe('NONE');
    expect(resolveBlacklistLevel([{ level: 'SOFT' }])).toBe('SOFT');
    expect(resolveBlacklistLevel([{ level: 'SOFT' }, { level: 'HARD' }])).toBe('HARD');
  });
  it('only OWNER and BRANCH_MANAGER can override', () => {
    expect(canOverrideBlacklist('OWNER')).toBe(true);
    expect(canOverrideBlacklist('BRANCH_MANAGER')).toBe(true);
    expect(canOverrideBlacklist('FINANCE_MANAGER')).toBe(false);
    expect(canOverrideBlacklist(undefined)).toBe(false);
  });
  it('override reason is 10–500 chars after trim', () => {
    expect(isValidBlacklistOverrideReason('   สั้นไป   ')).toBe(false);
    expect(isValidBlacklistOverrideReason('เหตุผลยาวพอสิบตัว')).toBe(true);
    expect(isValidBlacklistOverrideReason('ก'.repeat(501))).toBe(false);
    expect(isValidBlacklistOverrideReason(null)).toBe(false);
  });
});
```

- [ ] **Step 2: รันให้ fail** — `(cd packages/shared && npx vitest run src/customer-blacklist.test.ts)` · Expected: FAIL "Failed to resolve import ./customer-blacklist"
- [ ] **Step 3: สร้าง `customer-blacklist.ts` ตาม Interfaces + export จาก index.ts**
- [ ] **Step 4: รันให้ผ่าน** — คำสั่งเดิม · Expected: 3 passed · แล้ว `npm run build --workspace=@installment/shared` · Expected: exit 0
- [ ] **Step 5: Commit** — `git add packages/shared && git commit -m "feat(shared): customer blacklist types, override roles and reason bounds"`

---

### Task 2: Prisma schema + migration (คอลัมน์การปลด SOFT บนสัญญา)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` — model `Contract` (ใต้บล็อก `inputVat*` ~บรรทัด 1534) และ model `User` (ใต้ `appliedTags` ~บรรทัด 1023)
- Create: `apps/api/prisma/migrations/20261102000000_contract_blacklist_override/migration.sql`

**Interfaces:**
- Produces (Contract): `blacklistOverrideReason String? @map("blacklist_override_reason")` · `blacklistOverriddenById String? @map("blacklist_overridden_by_id")` · `blacklistOverriddenAt DateTime? @map("blacklist_overridden_at")` · `blacklistOverriddenBy User? @relation("ContractBlacklistOverriddenBy", fields: [blacklistOverriddenById], references: [id], onDelete: SetNull)`
- Produces (User): `blacklistOverriddenContracts Contract[] @relation("ContractBlacklistOverriddenBy")`

- [ ] **Step 1: แก้ schema ตาม Interfaces** (คอมเมนต์ `// ก้อน 5 C3 — การปลด SOFT blacklist ที่บันทึกตอนสร้างร่าง (activate อ่าน blacklistOverriddenAt)`)
- [ ] **Step 2: เขียน migration.sql**

```sql
-- ก้อน 5 C3 — ด่าน blacklist: เก็บการปลดระดับ SOFT ลงแถวสัญญา (ใคร/เมื่อไร/เหตุผล) ให้ activate ตรวจซ้ำได้
ALTER TABLE "contracts"
  ADD COLUMN IF NOT EXISTS "blacklist_override_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "blacklist_overridden_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "blacklist_overridden_at" TIMESTAMP(3);
DO $$ BEGIN
  ALTER TABLE "contracts" ADD CONSTRAINT "contracts_blacklist_overridden_by_id_fkey"
    FOREIGN KEY ("blacklist_overridden_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 3: ตรวจ** — `(cd apps/api && npx prisma validate && npx prisma generate)` · Expected: "The schema … is valid" + client generated · แล้ว `./tools/check-types.sh api` · Expected: 0 errors
- [ ] **Step 4: Commit** — `git add apps/api/prisma && git commit -m "feat(contracts): blacklist override columns on contracts"`

---

### Task 3: `CustomerBlacklistService` + module

**Files:**
- Create: `apps/api/src/modules/customers/customer-blacklist.service.ts`
- Create: `apps/api/src/modules/customers/customer-blacklist.module.ts`
- Create: `apps/api/src/modules/customers/customer-blacklist.service.spec.ts`

**Interfaces:**
- Consumes: `CustomerPiiService.decryptCustomerFields(row)` · `CustomerPiiService.hash(value)` (null เมื่อไม่มี salt) · `normalizeThaiPhone` (`apps/api/src/utils/thai-phone.util.ts`) · `fmtDateShort` (`apps/api/src/utils/document-format.util.ts`) · shared Task 1
- Produces:
  ```ts
  @Injectable() export class CustomerBlacklistService {
    constructor(private readonly prisma: PrismaService, private readonly pii: CustomerPiiService) {}
    evaluate(customerId: string, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<CustomerBlacklistResult>;
    evaluateMany(customerIds: string[], db?: Prisma.TransactionClient | PrismaService): Promise<Record<string, CustomerBlacklistResult>>;
  }
  export const BLACKLIST_SET_CONTRACT_STATUSES = ['CLOSED_BAD_DEBT', 'TERMINATED'] as const;
  export const ACTIVE_CONTRACT_STATUSES = ['ACTIVE', 'OVERDUE', 'DEFAULT'] as const;
  @Module({ imports: [PrismaModule, CustomerPiiModule], providers: [CustomerBlacklistService], exports: [CustomerBlacklistService] }) export class CustomerBlacklistModule {}
  ```
- การอ่าน (ทั้งหมดใน `evaluateMany` — `evaluate(id)` = `(await evaluateMany([id]))[id]`):
  1. `db.customer.findMany({ where: { id: { in: ids } }, select: { id, name, phone, phoneSecondary, phoneHash, phoneEncrypted, phoneSecondaryEncrypted, references, referencesEncrypted, mergedIntoId } })` (ไม่กรอง deletedAt)
  2. `db.contract.findMany({ where: { customerId: { in: ids }, deletedAt: null, status: { in: [...ACTIVE_CONTRACT_STATUSES, ...BLACKLIST_SET_CONTRACT_STATUSES] } }, select: { id, customerId, contractNumber, status, repossession: { select: { id, createdAt, deletedAt, deviceReturn: { select: { returnKind, deviceReceivedAt } } } }, deviceReturns: { where: { status: 'PENDING_CONFIRM', deletedAt: null }, select: { docNumber: true } } }, orderBy: { createdAt: 'asc' } })`
  3. `db.customerTag.findMany({ where: { customerId: { in: ids }, tag: 'BLACKLIST', deletedAt: null }, include: { appliedBy: { select: { name: true } } }, orderBy: { createdAt: 'desc' } })`
  4. set: `db.customer.findMany({ where: { OR: [ { contracts: { some: { deletedAt: null, status: { in: BLACKLIST_SET_CONTRACT_STATUSES } } } }, { contracts: { some: { repossession: { is: { deletedAt: null } } } } }, { tags: { some: { tag: 'BLACKLIST', deletedAt: null } } } ] }, select: เหมือนข้อ 1 })`
- กติกาจับคู่: คีย์เบอร์ของแถว = `{ phoneHash, norm, pii.hash(norm) }` (ตัด null; `norm = normalizeThaiPhone(decrypted.phone) || null`) · PHONE_MATCH เมื่อคีย์เบอร์หลักของลูกค้า ∩ คีย์เบอร์หลักของสมาชิก ≠ ∅ · REFERENCES_BLACKLISTED: `norm(ref.phone)` หรือ `hash(norm(ref.phone))` ของลูกค้าตรงกับคีย์เบอร์หลักของสมาชิก · REFERENCED_BY_BLACKLISTED: คีย์ของ `ref.phone` ของสมาชิกตรงกับคีย์เบอร์หลัก**หรือเบอร์สำรอง**ของลูกค้า · ตัดสมาชิก `m.id === id || m.mergedIntoId === id || customer.mergedIntoId === m.id` · ถอดรหัสสมาชิกใน try/catch — โยน = ข้ามสมาชิกนั้น · ถอดรหัส references เฉพาะแถวที่ `references ?? referencesEncrypted` ไม่ว่าง
- ข้อความ (ตาม spec): ACTIVE_CONTRACT `มีสัญญาผ่อนอยู่ ${no} (${label}) — 1 คนผ่อนได้ 1 เครื่อง ต้องปิดสัญญาเดิมก่อน` (label: ACTIVE→'กำลังผ่อน' · OVERDUE→'ค้างชำระ' · DEFAULT→'ผิดนัด') · TERMINATED_UNRETURNED ไม่มีใบ `สัญญา ${no} ถูกบอกเลิกแล้วแต่ยังไม่ได้รับเครื่องคืน` / มีใบ `สัญญา ${no} รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน (ใบ ${docNumber})` · REPOSSESSED VOLUNTARY `เคยเอาเครื่องมาคืนเอง (สัญญา ${no} · ${fmtDateShort(deviceReceivedAt ?? createdAt)})` / อื่น `เคยถูกยึดเครื่อง (สัญญา ${no} · ${date})` · BAD_DEBT `เคยถูกตัดเป็นหนี้สูญ (สัญญา ${no})` · MANUAL_TAG `ติด tag blacklist โดย ${appliedBy?.name ?? 'ระบบ'} ${fmtDateShort(createdAt)}` + (reason ? `: ${reason}` : '') · PHONE_MATCH `เบอร์โทรตรงกับ ${name} ที่ติด blacklist` · REFERENCES_BLACKLISTED `ผู้อ้างอิง "${refFirstName} ${refLastName}".trim() คือ ${name} ที่ติด blacklist` · REFERENCED_BY_BLACKLISTED `${name} ที่ติด blacklist เคยใส่ลูกค้าคนนี้เป็นผู้อ้างอิง` · `related = { customerId: m.id, name: m.name }` สำหรับสาม code หลัง · `contractNumber` สำหรับ 4 code ของสัญญา
- ลำดับ reasons: ACTIVE_CONTRACT → TERMINATED_UNRETURNED → REPOSSESSED → BAD_DEBT → MANUAL_TAG → PHONE_MATCH → REFERENCES_BLACKLISTED → REFERENCED_BY_BLACKLISTED · REPOSSESSED/BAD_DEBT หนึ่งรายการต่อสัญญา · `checkedAt = new Date().toISOString()`

- [ ] **Step 1: เขียนเทสที่ fail** — mock prisma เป็น object `{ customer: { findMany }, contract: { findMany }, customerTag: { findMany } }` โดย `customer.findMany` ตอบตาม `where.id` (มี `id.in` = ลูกค้าที่ประเมิน · ไม่มี = set) · pii จริง `new CustomerPiiService(prisma as never)` โดย `process.env.PII_HASH_SALT = 'test-salt-0123456789'` และ `PII_ENCRYPTION_KEY` ว่าง (plaintext path) · กรณี:

```ts
it('NONE for a clean customer', …)                       // ไม่มีสัญญา/tag/match → { level: 'NONE', reasons: [] }
it('ACTIVE_CONTRACT per live contract, DEFAULT reads ผิดนัด', …) // 2 สัญญา ACTIVE+DEFAULT → 2 reasons HARD, message มี 'ผิดนัด'
it('TERMINATED without device return reads ยังไม่ได้รับเครื่องคืน', …)
it('TERMINATED with a pending device return names the DR number', …) // deviceReturns: [{docNumber:'DR-TEST'}] → message มี 'รอ FINANCE ยืนยัน (ใบ DR-TEST)'
it('REPOSSESSED voluntary vs seized wording, no duplicate BAD_DEBT', …) // CLOSED_BAD_DEBT + repossession{deviceReturn{returnKind:'VOLUNTARY'}} → 1 reason REPOSSESSED 'เคยเอาเครื่องมาคืนเอง'; repossession ไม่มี deviceReturn → 'เคยถูกยึดเครื่อง'
it('BAD_DEBT when CLOSED_BAD_DEBT has no repossession', …)
it('ignores a soft-deleted repossession', …)             // repossession.deletedAt set → ไม่มี REPOSSESSED (CLOSED_BAD_DEBT → BAD_DEBT)
it('MANUAL_TAG names the user and reason', …)
it('PHONE_MATCH by hash and by normalized plaintext, never with self or merged twin', …) // สมาชิก A phoneHash เท่ากัน → match · สมาชิก B phone '081-234-5678' vs ลูกค้า '0812345678' ไม่มี hash → match · สมาชิก C = ลูกค้าเอง / mergedIntoId → ไม่ match
it('SOFT reference links both directions', …)           // ลูกค้า references [{firstName:'สมชาย', lastName:'ดี', phone:'0899999999'}] ตรงเบอร์หลักสมาชิก → REFERENCES_BLACKLISTED related.name · สมาชิก references phone = เบอร์สำรองลูกค้า → REFERENCED_BY_BLACKLISTED · level 'SOFT'
it('skips phone and reference matching when the customer has no phone', …) // phone null references null → NONE
it('ignores a set member whose references cannot be decrypted', …) // member.referencesEncrypted = 'enc:garbage' + PII_ENCRYPTION_KEY ตั้งค่า → ไม่ throw, NONE
it('evaluateMany loads the set once and returns a map keyed by id', …) // 2 ids → customer.findMany ถูกเรียก 2 ครั้ง (ids + set), contract.findMany 1, customerTag.findMany 1
```

- [ ] **Step 2: รันให้ fail** — `npm --prefix apps/api test -- src/modules/customers/customer-blacklist.service.spec.ts` · Expected: FAIL "Cannot find module './customer-blacklist.service'"
- [ ] **Step 3: สร้าง service + module ตาม Interfaces** (ฟังก์ชันย่อย `phoneKeys(row)`, `referencePhones(row)`, `contractReasons(contracts)`, `tagReason(tag)`, `matchReasons(customer, set)` — ไม่เกิน ~220 บรรทัด)
- [ ] **Step 4: รันให้ผ่าน** — คำสั่งเดิม · Expected: 13 passed
- [ ] **Step 5: Commit** — `git add apps/api/src/modules/customers/customer-blacklist.* && git commit -m "feat(customers): CustomerBlacklistService — HARD/SOFT reasons from live status, phone and reference links"`

---

### Task 4: ด่านบริสุทธิ์ `assertBlacklistGate` + `assertCustomerContractPolicy` fail-closed

**Files:**
- Create: `apps/api/src/modules/contracts/services/contract-blacklist-gate.ts`
- Create: `apps/api/src/modules/contracts/services/contract-blacklist-gate.spec.ts`
- Modify: `apps/api/src/modules/contracts/services/contract-create-policy.ts:7-15`
- Modify: `apps/api/src/modules/contracts/services/contract-create-policy.spec.ts:5-13`

**Interfaces:**
- Produces:
  ```ts
  export const BLACKLIST_HARD_MSG = 'ลูกค้าติด blacklist ไม่สามารถทำสัญญาได้';
  export const BLACKLIST_REVIEW_MSG = 'ลูกค้ามีประวัติที่ต้องให้ผู้จัดการอนุมัติก่อนทำสัญญา';
  export const BLACKLIST_REVIEW_AT_ACTIVATE_MSG = 'ลูกค้ามีประวัติที่ต้องให้ผู้จัดการอนุมัติ (เกิดหลังสร้างร่าง) — ให้ OWNER/ผู้จัดการสาขาลบร่างนี้แล้วสร้างสัญญาใหม่พร้อมอนุมัติ';
  export interface BlacklistGateInput { result: CustomerBlacklistResult; actorRole: string; stage: 'CREATE' | 'ACTIVATE';
    overrideReason?: string | null; persistedOverride?: boolean }
  /** คืนเหตุผลที่ trim แล้วเมื่อ CREATE+SOFT+ปลดได้ (ให้ caller เขียนลงสัญญา) · null เมื่อผ่านโดยไม่ต้องปลด · โยน ConflictException เมื่อห้าม */
  export function assertBlacklistGate(input: BlacklistGateInput): string | null;
  export async function assertCustomerContractPolicy(tx: Prisma.TransactionClient, customerId: string): Promise<void>; // ไม่มี role/override อีกต่อไป
  ```
- Response ของ 409: `{ code, level, reasons, message, canOverride }` — HARD: `canOverride` ไม่ใส่ · SOFT CREATE: `canOverride = canOverrideBlacklist(actorRole)` · SOFT ACTIVATE: `canOverride: false`

- [ ] **Step 1: เขียนเทสที่ fail** (`contract-blacklist-gate.spec.ts`)

```ts
const hard = { level: 'HARD', reasons: [{ code: 'MANUAL_TAG', level: 'HARD', message: 'x' }], checkedAt: 't' } as const;
const soft = { level: 'SOFT', reasons: [{ code: 'REFERENCES_BLACKLISTED', level: 'SOFT', message: 'y' }], checkedAt: 't' } as const;
const none = { level: 'NONE', reasons: [], checkedAt: 't' } as const;
it('NONE passes and returns null even when a reason is sent', () => expect(assertBlacklistGate({ result: none, actorRole: 'SALES', stage: 'CREATE', overrideReason: 'เหตุผลยาวพอสิบตัว' })).toBeNull());
it.each(['OWNER', 'SALES'])('HARD rejects %s at CREATE and ACTIVATE', role => {
  for (const stage of ['CREATE', 'ACTIVATE'] as const)
    expect(() => assertBlacklistGate({ result: hard, actorRole: role, stage, overrideReason: 'เหตุผลยาวพอสิบตัว', persistedOverride: true }))
      .toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'CUSTOMER_BLACKLISTED', level: 'HARD', message: BLACKLIST_HARD_MSG }) }));
});
it('SOFT at CREATE without reason → REVIEW with canOverride by role', () => {
  expect(() => assertBlacklistGate({ result: soft, actorRole: 'OWNER', stage: 'CREATE' })).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'CUSTOMER_BLACKLIST_REVIEW', canOverride: true }) }));
  expect(() => assertBlacklistGate({ result: soft, actorRole: 'SALES', stage: 'CREATE', overrideReason: 'เหตุผลยาวพอสิบตัว' })).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'CUSTOMER_BLACKLIST_REVIEW', canOverride: false }) }));
  expect(() => assertBlacklistGate({ result: soft, actorRole: 'OWNER', stage: 'CREATE', overrideReason: ' สั้น ' })).toThrow(/CUSTOMER_BLACKLIST_REVIEW|ลูกค้ามีประวัติ/);
});
it('SOFT at CREATE with a valid reason by BRANCH_MANAGER returns the trimmed reason', () => expect(assertBlacklistGate({ result: soft, actorRole: 'BRANCH_MANAGER', stage: 'CREATE', overrideReason: '  ลูกค้าเก่าของสาขา ผู้จัดการรับรองเอง  ' })).toBe('ลูกค้าเก่าของสาขา ผู้จัดการรับรองเอง'));
it('SOFT at ACTIVATE passes only with a persisted override', () => {
  expect(assertBlacklistGate({ result: soft, actorRole: 'SYSTEM', stage: 'ACTIVATE', persistedOverride: true })).toBeNull();
  expect(() => assertBlacklistGate({ result: soft, actorRole: 'OWNER', stage: 'ACTIVATE', overrideReason: 'เหตุผลยาวพอสิบตัว' })).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'CUSTOMER_BLACKLIST_REVIEW', canOverride: false, message: BLACKLIST_REVIEW_AT_ACTIVATE_MSG }) }));
});
```

และแก้ `contract-create-policy.spec.ts`: ลบ 2 เทส override เดิม (บรรทัด 7–13) แทนด้วย
```ts
it('rejects any live contract — no role or flag can bypass', async () => {
  await expect(assertCustomerContractPolicy(tx as unknown as Prisma.TransactionClient, 'customer')).rejects.toMatchObject({ response: { code: 'CUSTOMER_HAS_ACTIVE_CONTRACT' } });
  expect((assertCustomerContractPolicy as unknown as { length: number }).length).toBe(2);
});
```

- [ ] **Step 2: รันให้ fail** — `npm --prefix apps/api test -- src/modules/contracts/services/contract-blacklist-gate.spec.ts src/modules/contracts/services/contract-create-policy.spec.ts` · Expected: gate spec FAIL "Cannot find module" · policy spec FAIL (length 4, canOverride ยังอยู่)
- [ ] **Step 3: สร้าง gate + แก้ `assertCustomerContractPolicy(tx, customerId)`** (ลบ `canOverride`/`override`; response เหลือ `{ message, code: 'CUSTOMER_HAS_ACTIVE_CONTRACT', activeContracts }`)
- [ ] **Step 4: รันให้ผ่าน** — คำสั่งเดิม · Expected: ทั้งสองไฟล์ผ่าน (ตัว lifecycle ยังไม่คอมไพล์ — แก้ใน Task 5)
- [ ] **Step 5: Commit** — `git add apps/api/src/modules/contracts/services/contract-blacklist-gate.* apps/api/src/modules/contracts/services/contract-create-policy.* && git commit -m "feat(contracts): pure blacklist gate + fail-closed active-contract policy"`

---

### Task 5: ด่านจุดที่ 1 — `ContractLifecycleService.create()` + DTO + จุดสร้าง service ทั้ง 7

**Files:**
- Modify: `apps/api/src/modules/contracts/dto/contract.dto.ts:69-72` (ลบ `overrideActiveContractCheck`; เพิ่ม `blacklistOverrideReason`)
- Modify: `apps/api/src/modules/sales/dto/sale.dto.ts:7` (ลบบรรทัด `overrideActiveContractCheck`)
- Modify: `apps/api/src/modules/contracts/services/contract-lifecycle.service.ts` (ctor 44-52 · create 54-78 · contract.create data ~142 · หลัง loop ~262)
- Modify: `apps/api/src/modules/contracts/contracts.service.ts:45-56` (ctor + `new ContractLifecycleService(...)`)
- Modify: `apps/api/src/modules/contracts/contracts.module.ts` (import `CustomerBlacklistModule`)
- Modify (จุดสร้าง): `apps/api/src/modules/contracts/services/contract-lifecycle.service.spec.ts:245` · `apps/api/src/modules/contracts/__tests__/product-guard.integration.spec.ts:56` · `apps/api/src/modules/contracts/__tests__/shop-tenders.integration.spec.ts:56` · `apps/api/src/modules/contracts/__tests__/contract-bundles.integration.spec.ts:65` · `apps/api/e2e/credit-payment-flow.e2e-spec.ts:110` · `apps/api/e2e/support/chat-credit-preview.ts:195`

**Interfaces:**
- Consumes: Task 3 `CustomerBlacklistService`, Task 4 `assertBlacklistGate` / `assertCustomerContractPolicy(tx, customerId)`
- Produces: `ContractLifecycleService` ctor = `(prisma, query, shopDownPaymentTemplate, shopDownPaymentReversalTemplate, shopAccountResolver, blacklist: CustomerBlacklistService, warrantyService?, audit?)` — **แทรกตำแหน่งที่ 6** · `ContractsService` ctor เพิ่ม `private blacklist: CustomerBlacklistService` หลัง `shopAccountResolver` (ก่อน `@Optional()` ตัวแรก) · `CreateContractDto.blacklistOverrideReason?: string` (`@IsOptional() @IsString() @Length(10, 500, { message: 'กรุณาระบุเหตุผล 10–500 ตัวอักษร' })`) · AuditLog action `CONTRACT_BLACKLIST_OVERRIDDEN` entity `contract`
- จุดสร้างในเทส/e2e ที่มี DB จริง ส่ง `new CustomerBlacklistService(db, new CustomerPiiService(db))` · unit spec ส่ง `{ evaluate: jest.fn().mockResolvedValue({ level: 'NONE', reasons: [], checkedAt: 't' }) } as never`

- [ ] **Step 1: เพิ่มเทสใน `contract-lifecycle.service.spec.ts`** (describe ใหม่ `'blacklist gate (ก้อน 5 C3)'`, ประกอบ service ด้วย `blacklist` mock ที่ตั้งผลได้ต่อเทส; tx mock เดิมมี `contract.create` คืน `{ id }` และ `contract.findMany → []`)

```ts
it('HARD → 409 CUSTOMER_BLACKLISTED before any transaction', async () => {
  blacklist.evaluate.mockResolvedValue(hardResult);
  await expect(service.create(baseDto, 'owner-1', 'OWNER')).rejects.toMatchObject({ response: { code: 'CUSTOMER_BLACKLISTED' } });
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
it('SOFT without reason → 409 REVIEW; SALES with reason → 409 REVIEW canOverride false', …);
it('SOFT with reason by OWNER persists override columns and audits after commit', async () => {
  blacklist.evaluate.mockResolvedValue(softResult);
  await service.create({ ...baseDto, blacklistOverrideReason: '  ลูกค้าเก่าของสาขา ผู้จัดการรับรองเอง ' }, 'owner-1', 'OWNER');
  expect(tx.contract.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    blacklistOverrideReason: 'ลูกค้าเก่าของสาขา ผู้จัดการรับรองเอง', blacklistOverriddenById: 'owner-1', blacklistOverriddenAt: expect.any(Date) }) }));
  expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CONTRACT_BLACKLIST_OVERRIDDEN', entity: 'contract', userId: 'owner-1',
    newValue: expect.objectContaining({ customerId: 'cust-1', level: 'SOFT', overrideReason: 'ลูกค้าเก่าของสาขา ผู้จัดการรับรองเอง' }) }));
});
it('NONE writes no override columns even when a reason is sent', …); // data ไม่มี blacklistOverrideReason key
it('test mode does not bypass the blacklist gate', …);   // queryMock.isTestModeEnabled → true, HARD → ยัง 409
it('in-tx active-contract policy is fail-closed (legacy flag ignored)', async () => {
  tx.contract.findMany.mockResolvedValueOnce([{ id: 'a', contractNumber: 'A', status: 'ACTIVE' }]);
  await expect(service.create({ ...baseDto, overrideActiveContractCheck: true } as never, 'owner-1', 'OWNER')).rejects.toMatchObject({ response: { code: 'CUSTOMER_HAS_ACTIVE_CONTRACT' } });
});
```
ลบ `overrideActiveContractCheck: false` ออกจาก `baseDto` (บรรทัด 131).

- [ ] **Step 2: รันให้ fail** — `npm --prefix apps/api test -- src/modules/contracts/services/contract-lifecycle.service.spec.ts` · Expected: FAIL (ctor ไม่รับ blacklist / TS error ที่ DTO)
- [ ] **Step 3: แก้ DTO สองไฟล์ · ctor + `create()`**: ก่อน loop `const blacklistResult = await this.blacklist.evaluate(dto.customerId); const overrideReason = assertBlacklistGate({ result: blacklistResult, actorRole: actor.role, stage: 'CREATE', overrideReason: dto.blacklistOverrideReason });` · ใน tx `await assertCustomerContractPolicy(tx, dto.customerId);` · `contract.create` data เพิ่ม `...(overrideReason ? { blacklistOverrideReason: overrideReason, blacklistOverriddenById: actor.id, blacklistOverriddenAt: new Date() } : {})` · หลัง `const created = …` เพิ่ม `if (overrideReason && this.audit) await this.audit.log({ userId: salespersonId, action: 'CONTRACT_BLACKLIST_OVERRIDDEN', entity: 'contract', entityId: created.id, newValue: { customerId: dto.customerId, level: 'SOFT', reasons: blacklistResult.reasons, overrideReason } });` · แก้ `ContractsService` ctor/บรรทัด 56 · `contracts.module.ts` imports เพิ่ม `CustomerBlacklistModule` (คอมเมนต์ว่าโมดูลพึ่ง Prisma + PII เท่านั้น ไม่มีวงจร) · แก้จุดสร้างอีก 5 ไฟล์ตาม Interfaces (e2e บรรทัด 110 แทรก `new CustomerBlacklistService(db, new CustomerPiiService(db))` หลัง `shopAccounts`)
- [ ] **Step 4: รันให้ผ่าน** — คำสั่งเดิม + `npm --prefix apps/api test -- src/modules/contracts/services` · Expected: ทุกไฟล์ผ่าน · `./tools/check-types.sh api` · Expected: 0 errors
- [ ] **Step 5: Commit** — `git add -A apps/api/src apps/api/e2e && git commit -m "feat(contracts): blacklist gate at contract creation; persist SOFT override; drop overrideActiveContractCheck"`

---

### Task 6: ด่านจุดที่ 2 — `ContractWorkflowService.activate()` + จุดสร้างทั้ง 8 + e2e

**Files:**
- Modify: `apps/api/src/modules/contracts/contract-workflow.service.ts` (ctor 47-58 · activate ~398-485)
- Modify (จุดสร้าง): `apps/api/src/modules/contracts/contract-workflow.schedule.spec.ts:23` · `contract-workflow.journey.spec.ts:41` · `__tests__/product-guard.integration.spec.ts:36` · `__tests__/product-lifecycle.integration.spec.ts:87` · `__tests__/shop-tenders.integration.spec.ts:50` · `__tests__/contract-bundles.integration.spec.ts:52` · `apps/api/src/modules/purchase-orders/__tests__/installment-input-vat.integration.spec.ts:66` · `apps/api/e2e/credit-payment-flow.e2e-spec.ts:123`
- Test: `apps/api/e2e/credit-payment-flow.e2e-spec.ts` (describe ใหม่)

**Interfaces:**
- Consumes: Task 3, Task 4, คอลัมน์ Task 2
- Produces: `ContractWorkflowService` ctor **แทรก `private blacklist: CustomerBlacklistService` เป็นอาร์กิวเมนต์ที่ 11** (หลัง `installmentInputVatTemplate`, ก่อน `@Optional() testMode?`) — จุดสร้างที่ส่งอาร์กิวเมนต์ตัวที่ 11+ อยู่แล้ว (testMode/journeyEntries/moduleRef) ให้แทรกก่อนตัวเหล่านั้น

- [ ] **Step 1: เขียน e2e ที่ fail** — ใน `credit-payment-flow.e2e-spec.ts` เพิ่ม helper `plainCase(name: string)` (ลูกค้า + เครื่อง ACCESSORY ใน `branchId` ไม่มี trade-in; ชื่อ `ISOLATED BLACKLIST ${name}` ไม่มีตัวเลข; เบอร์สุ่มจาก `randomUUID().replace(/\D/g,'').slice(0,9)` นำหน้า '0' · dto `{ customerId, productId, branchId, sellingPrice: 15000, downPayment: 2000, totalMonths: 12, paymentDueDay: 25, paymentMethod: 'CASH' }`) และ describe:

```ts
describe('blacklist gate (ก้อน 5 C3)', () => {
  it('two drafts: first activates, second is HARD at activate and at create', async () => {
    const c = await plainCase('TWO DRAFTS'); await approve(c.customer.id);
    const first = await lifecycle.create(c.dto, ownerId, 'OWNER');
    const second = await lifecycle.create({ ...c.dto, productId: (await spareProduct()).id }, ownerId, 'OWNER'); // approve() ซ้ำก่อนสร้างใบสอง
    await activate(first.id, c.customer.id);
    await expect(activate(second.id, c.customer.id)).rejects.toMatchObject({ response: { code: 'CUSTOMER_BLACKLISTED', reasons: [expect.objectContaining({ code: 'ACTIVE_CONTRACT' })] } });
    expect((await db.contract.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('DRAFT');
    await expect(lifecycle.create({ ...c.dto }, ownerId, 'OWNER')).rejects.toMatchObject({ response: { code: 'CUSTOMER_BLACKLISTED' } });
  });
  it('manual BLACKLIST tag added after the draft blocks activation', …);           // db.customerTag.create → activate 409 CUSTOMER_BLACKLISTED MANUAL_TAG
  it('TERMINATED blocks a new contract until it is paid off to COMPLETED', …);       // activate ใบแรก → db.contract.update status TERMINATED → create 409 TERMINATED_UNRETURNED → update status COMPLETED → create ผ่าน
  it('phone match with a blacklisted customer is HARD for a brand-new customer', …); // ลูกค้าใหม่เบอร์เดียวกับคนที่ TERMINATED → 409 PHONE_MATCH
  it('reference link is SOFT: needs an OWNER reason at create, then activates on the persisted override', async () => {
    // A = TERMINATED (จากเคสก่อน หรือสร้างใหม่) · B.references = [{ firstName:'อ้างอิง', lastName:'ทดสอบ', phone: A.phone }]
    await expect(lifecycle.create(b.dto, ownerId, 'OWNER')).rejects.toMatchObject({ response: { code: 'CUSTOMER_BLACKLIST_REVIEW', canOverride: true } });
    await expect(lifecycle.create({ ...b.dto, blacklistOverrideReason: 'ผู้จัดการตรวจแล้วว่าไม่ใช่คนเดียวกัน' }, salesId, 'SALES')).rejects.toMatchObject({ response: { code: 'CUSTOMER_BLACKLIST_REVIEW', canOverride: false } });
    const draft = await lifecycle.create({ ...b.dto, blacklistOverrideReason: 'ผู้จัดการตรวจแล้วว่าไม่ใช่คนเดียวกัน' }, ownerId, 'OWNER');
    const row = await db.contract.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.blacklistOverriddenById).toBe(ownerId); expect(row.blacklistOverrideReason).toBe('ผู้จัดการตรวจแล้วว่าไม่ใช่คนเดียวกัน');
    await activate(draft.id, b.customer.id); // ผ่าน
    expect(await db.auditLog.count({ where: { action: 'CONTRACT_BLACKLIST_OVERRIDDEN', entityId: draft.id } })).toBe(1);
  });
  it('exchange contract skips the gate', …); // ถ้ามี fixture เปลี่ยนเครื่องในไฟล์อยู่แล้ว (Case 2A ใน exchange-priced-flow อยู่คนละไฟล์) → ให้ยืนยันผ่าน unit แทน: ใน `contract-workflow.journey.spec.ts` หรือ spec ใหม่ `contract-workflow.blacklist.spec.ts` — `blacklist.evaluate` ต้องไม่ถูกเรียกเมื่อ `exchangedFromContractId` มีค่า (mock `findOne` ด้วย jest.spyOn)
});
```
`salesId` = `db.user.upsert({ where: { email: 'sales@isolated.test' }, create: { …role: 'SALES', branchId }, update: {} }).id` ใน beforeAll.

- [ ] **Step 2: รันให้ fail** — `tools/test-chat-credit.sh` (ทั้งชุด; ใช้เวลา ~5 นาที — เก็บ output ไว้ `.superpowers/sdd/2026-10-24-contract-blacklist-gate/e2e-run1.log`) · Expected: เคสใหม่ FAIL ที่ `activate(second.id)` resolves / ctor arity · เคสเดิมเขียว
- [ ] **Step 3: แก้ `activate()`**: หลังด่าน PDPA (ก่อน `verifyContractHash` หรือทันทีหลังนิยาม `isExchangeContract` — ย้าย `const isExchangeContract` ขึ้นมาเหนือ) เพิ่ม `if (!isExchangeContract) { const result = await this.blacklist.evaluate(contract.customerId); assertBlacklistGate({ result, actorRole: 'SYSTEM', stage: 'ACTIVATE', persistedOverride: !!contract.blacklistOverriddenAt }); }` · ใน tx หลัง `assertContractCreditApproval(...)`: `if (!isExchangeContract) await assertCustomerContractPolicy(tx, current.customerId);` (import จาก `./services/contract-create-policy`) · แก้ ctor + 8 จุดสร้าง (schedule.spec: `stub` ตัวที่ 11 ต้องเป็น `{ evaluate: async () => NONE }` ถ้าเทสนั้นเรียก activate — ถ้าไม่เรียก ใช้ `stub` เดิม)
- [ ] **Step 4: รันให้ผ่าน** — unit: `npm --prefix apps/api test -- src/modules/contracts` · Expected: ผ่าน · e2e: `tools/test-chat-credit.sh` → `e2e-run2.log` · Expected: ทุก suite เขียว · `./tools/check-types.sh api` 0 errors
- [ ] **Step 5: Commit** — `git add -A apps/api && git commit -m "feat(contracts): blacklist gate at activation — two drafts cannot both activate; persisted SOFT override honored"`

---

### Task 7: endpoint อ่านผล `GET /customers/:id/blacklist` + `GET /customers/blacklist?ids=`

**Files:**
- Modify: `apps/api/src/modules/customers/customers.controller.ts` (ctor 42-49 · route ใหม่ก่อน `@Get(':id')` บรรทัด 179 · `:id/blacklist` หลัง `findOne`)
- Modify: `apps/api/src/modules/customers/customers.module.ts:24` (imports เพิ่ม `CustomerBlacklistModule`)
- Modify: `apps/api/src/modules/customers/customers.controller.spec.ts:38-46` (providers เพิ่ม `{ provide: CustomerBlacklistService, useValue: blacklist }`)

**Interfaces:**
- Consumes: Task 3
- Produces:
  ```ts
  @Get('blacklist') @Roles('OWNER','BRANCH_MANAGER','FINANCE_MANAGER','ACCOUNTANT','SALES')
  getBlacklistBatch(@Query('ids') ids?: string): Promise<Record<string, CustomerBlacklistResult>>  // split ',', trim, dedupe; 0 หรือ >100 → BadRequestException('ระบุ ids 1–100 รายการ')
  @Get(':id/blacklist') @Roles(…เดิม) getBlacklist(@Param('id') id: string): Promise<CustomerBlacklistResult>
  ```

- [ ] **Step 1: เขียนเทสที่ fail** (ใน `customers.controller.spec.ts` describe ใหม่ ใช้ testing module เดิม)

```ts
it('GET blacklist?ids splits, dedupes and forwards to evaluateMany', async () => {
  blacklist.evaluateMany.mockResolvedValue({ a: none, b: none });
  await expect(controller.getBlacklistBatch(' a, b ,a,')).resolves.toEqual({ a: none, b: none });
  expect(blacklist.evaluateMany).toHaveBeenCalledWith(['a', 'b']);
});
it('GET blacklist?ids rejects empty and >100 ids', async () => {
  await expect(controller.getBlacklistBatch('')).rejects.toBeInstanceOf(BadRequestException);
  await expect(controller.getBlacklistBatch(Array.from({ length: 101 }, (_, i) => `c${i}`).join(','))).rejects.toBeInstanceOf(BadRequestException);
});
it('GET :id/blacklist forwards to evaluate', …);
```

- [ ] **Step 2: รันให้ fail** — `npm --prefix apps/api test -- src/modules/customers/customers.controller.spec.ts` · Expected: FAIL "controller.getBlacklistBatch is not a function" / DI resolve
- [ ] **Step 3: เพิ่ม route + ctor param + module import**
- [ ] **Step 4: รันให้ผ่าน** — คำสั่งเดิม · Expected: ผ่าน
- [ ] **Step 5: Commit** — `git add apps/api/src/modules/customers && git commit -m "feat(customers): blacklist read endpoints (single + batch)"`

---

### Task 8: Web — hook + `CustomerBlacklistBadge` + `BlacklistReasonList`

**Files:**
- Create: `apps/web/src/hooks/useCustomerBlacklist.ts`
- Create: `apps/web/src/components/customer/BlacklistReasonList.tsx`
- Create: `apps/web/src/components/customer/CustomerBlacklistBadge.tsx`
- Create: `apps/web/src/components/customer/CustomerBlacklistBadge.test.tsx`

**Interfaces:**
- Consumes: shared Task 1 (`import type { CustomerBlacklistResult } from '@installment/shared'`) · `api` จาก `@/lib/api` · `Badge` (`variant="destructive" | "warning"`, `appearance="light"`)
- Produces:
  ```ts
  export function useCustomerBlacklist(customerId: string | null | undefined): UseQueryResult<CustomerBlacklistResult>; // key ['customer-blacklist', id], GET /customers/${id}/blacklist, enabled: !!id, staleTime: 0
  export function useCustomerBlacklistBatch(ids: string[]): UseQueryResult<Record<string, CustomerBlacklistResult>>; // key ['customer-blacklist-batch', sorted.join(',')], GET /customers/blacklist?ids=, enabled ids.length>0
  export function BlacklistReasonList({ reasons, className }: { reasons: BlacklistReason[]; className?: string }): JSX.Element; // <ul> หนึ่ง <li> ต่อ reason: ไอคอนตาม code (ACTIVE_CONTRACT→FileWarning · TERMINATED_UNRETURNED→FileX · REPOSSESSED→Smartphone · BAD_DEBT→Ban · MANUAL_TAG→Tag · PHONE_MATCH→Phone · REFERENCES_*/REFERENCED_BY_*→Users) + message · related → <Link to={`/customers/${related.customerId}`}> ชื่อ
  export const BLACKLIST_BADGE_LABEL = { HARD: 'ติด blacklist · ห้ามทำสัญญา', SOFT: 'ต้องให้ผู้จัดการอนุมัติ' } as const;
  export default function CustomerBlacklistBadge({ result, size = 'sm', expandable = true, className }: { result: CustomerBlacklistResult | null | undefined; size?: 'sm'|'md'; expandable?: boolean; className?: string }): JSX.Element | null; // null เมื่อ !result หรือ level NONE · ปุ่ม aria-expanded เปิด/ปิด BlacklistReasonList
  ```

- [ ] **Step 1: เขียนเทสที่ fail** (`CustomerBlacklistBadge.test.tsx`, render ใน `MemoryRouter`)

```ts
it('renders nothing for NONE or missing result', …);
it('HARD badge shows the forbidden label and expands reasons with a customer link', async () => {
  render(<MemoryRouter><CustomerBlacklistBadge result={{ level: 'HARD', checkedAt: 't', reasons: [{ code: 'PHONE_MATCH', level: 'HARD', message: 'เบอร์โทรตรงกับ สมชาย ที่ติด blacklist', related: { customerId: 'c9', name: 'สมชาย' } }] }} /></MemoryRouter>);
  const btn = screen.getByRole('button', { name: /ติด blacklist · ห้ามทำสัญญา/ });
  expect(btn).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(btn);
  expect(screen.getByText(/เบอร์โทรตรงกับ/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'สมชาย' })).toHaveAttribute('href', '/customers/c9');
});
it('SOFT badge shows the manager-approval label', …);
```

- [ ] **Step 2: รันให้ fail** — `(cd apps/web && npx vitest run src/components/customer/CustomerBlacklistBadge.test.tsx)` · Expected: FAIL "Failed to resolve import"
- [ ] **Step 3: สร้าง 3 ไฟล์ตาม Interfaces** (badge: `HARD` → `<Badge variant="destructive" appearance="light">` ไอคอน `ShieldBan` · `SOFT` → `variant="warning" appearance="light"` ไอคอน `ShieldAlert` · ไม่ expandable = span ธรรมดา)
- [ ] **Step 4: รันให้ผ่าน** — คำสั่งเดิม · Expected: 3 passed
- [ ] **Step 5: Commit** — `git add apps/web/src/hooks/useCustomerBlacklist.ts apps/web/src/components/customer/BlacklistReasonList.tsx apps/web/src/components/customer/CustomerBlacklistBadge.* && git commit -m "feat(web): customer blacklist hook, badge and reason list"`

---

### Task 9: Web — หน้าสร้างสัญญา ขั้นเลือกลูกค้า (fail-closed) + 409 กลับขั้นเลือกลูกค้า

**Files:**
- Modify: `apps/web/src/pages/ContractCreatePage/hooks/useContractCreateData.ts` (state ~106 · query ข้าง `latestCreditQuery` ~299 · payload ~463 · `canNext` ~472-478 · return ~518)
- Modify: `apps/web/src/pages/ContractCreatePage/components/CustomerSelectStep.tsx` (props 8-24 · banner 108-137)
- Modify: `apps/web/src/pages/ContractCreatePage/index.tsx` (effect 55-61 · props 158-173)
- Modify: `apps/web/src/pages/ContractCreatePage/hooks/useContractCreateData.test.tsx` (เพิ่มเคส)
- Create: `apps/web/src/pages/ContractCreatePage/components/CustomerSelectStep.blacklist.test.tsx`

**Interfaces:**
- Consumes: Task 8 hook/`BlacklistReasonList` · shared `canOverrideBlacklist`, `isValidBlacklistOverrideReason`, `BLACKLIST_ERROR_CODE`
- Produces (hook return เพิ่ม/แทน): `blacklist: CustomerBlacklistResult | undefined` · `blacklistStatus: 'idle' | 'loading' | 'error' | 'ready'` · `refetchBlacklist: () => void` · `overrideAccepted: boolean` · `setOverrideAccepted` · `overrideReason: string` · `setOverrideReason` — **ลบ** `overrideActiveContractCheck`/`setOverrideActiveContractCheck` · `canNext` step 1 = `!!selectedCustomer && customerCreditApproved && blacklistStatus === 'ready' && blacklist!.level !== 'HARD' && (blacklist!.level !== 'SOFT' || (overrideAccepted && isValidBlacklistOverrideReason(overrideReason)))` · `setSelectedCustomer` รีเซ็ต `overrideAccepted=false`, `overrideReason=''` · payload: `...(blacklist?.level === 'SOFT' && overrideAccepted ? { blacklistOverrideReason: overrideReason.trim() } : {})`
- Produces (`CustomerSelectStepProps` แทนสองตัวเดิม): `blacklist`, `blacklistStatus`, `onRetryBlacklist`, `overrideAccepted`, `setOverrideAccepted`, `overrideReason`, `setOverrideReason`
- index.tsx effect: ถ้า `error.response?.data?.code` ∈ `Object.values(BLACKLIST_ERROR_CODE)` → `toast.error([data.message, ...(data.reasons ?? []).map(r => r.message)].join('\n'))`, `goToStep(1)`, `data.refetchBlacklist()`

- [ ] **Step 1: เขียนเทสที่ fail**
  - `CustomerSelectStep.blacklist.test.tsx` (mock `@/contexts/AuthContext` ต่อเทสด้วย `vi.mock` + `mocks.role`; render ใน `MemoryRouter`):
    ```ts
    it('HARD shows the red box with reasons and no override controls', …);   // role OWNER · getByRole('alert') มี 'ห้ามทำสัญญา — ลูกค้าติด blacklist' · ไม่มี checkbox · มีข้อความ 'ไม่มีการอนุมัติข้าม'
    it('HARD with MANUAL_TAG tells OWNER where to remove the tag', …);          // 'ถอด tag ได้ที่หน้าลูกค้า'
    it('SOFT lets OWNER tick and type a reason with a counter', async () => {   // checkbox 'อนุมัติทำสัญญาทั้งที่มีประวัติ (ในฐานะ เจ้าของ)' · textarea · พิมพ์ 5 ตัว → text '5/10' หรือคำเตือน · setOverrideReason ถูกเรียก
    it('SOFT tells SALES to contact the branch manager', …);                    // role SALES → 'กรุณาติดต่อผู้จัดการสาขาเพื่ออนุมัติ' · ไม่มี checkbox
    it('error state offers a retry button', async () => { … getByRole('button', { name: 'ลองใหม่' }) → onRetryBlacklist called });
    it('no longer renders the legacy active-contract banner', …);              // selectedCustomer.activeContracts = 2, blacklist NONE → queryByText(/ยังมีสัญญาที่กำลังผ่อนอยู่/) null
    ```
  - `useContractCreateData.test.tsx` เพิ่ม (mock `mocks.get` ให้ตอบ `/customers/:id/blacklist`):
    ```ts
    it('disables next while the blacklist query is loading or failed, enables on NONE', …);
    it('SOFT needs tick + 10-char reason and sends blacklistOverrideReason trimmed', …); // ตรวจ body ของ post
    it('switching customer resets override tick and reason', …);
    ```
- [ ] **Step 2: รันให้ fail** — `(cd apps/web && npx vitest run src/pages/ContractCreatePage)` · Expected: ไฟล์ใหม่ FAIL (props ไม่มี) · เทสเดิมเขียว
- [ ] **Step 3: แก้ hook / step / index.tsx ตาม Interfaces** — กล่อง HARD: `rounded-xl border border-destructive/30 bg-destructive/5 p-4` + `role="alert"` + `ShieldBan` + `<BlacklistReasonList>` + บรรทัด "ไม่มีการอนุมัติข้าม" + ทางออก (OWNER/FINANCE_MANAGER และมี `MANUAL_TAG` → "ถอด tag ได้ที่หน้าลูกค้า" ลิงก์ `/customers/:id` · อื่น → "ติดต่อเจ้าของ/ผู้จัดการการเงิน") · กล่อง SOFT: `border-warning/40 bg-warning/10` + `ShieldAlert` + รายการ + (canOverride ? `<Checkbox>` + `<Textarea>` + ตัวนับ `${len}/10` สีแดงเมื่อ < 10 : ข้อความติดต่อ) · กล่อง error: `bg-muted` + "โหลดผลตรวจ blacklist ไม่ได้" + `<Button variant="outline" size="sm">ลองใหม่</Button>` · loading: บรรทัดเล็ก "กำลังตรวจ blacklist…" · ลบ banner เดิม + prop เดิม
- [ ] **Step 4: รันให้ผ่าน** — `(cd apps/web && npx vitest run src/pages/ContractCreatePage)` · Expected: ผ่านทั้งหมด · `./tools/check-types.sh web` 0 errors
- [ ] **Step 5: Commit** — `git add apps/web/src/pages/ContractCreatePage && git commit -m "feat(web): blacklist box on customer step — HARD blocks, SOFT needs manager tick + reason, fail-closed loading"`

---

### Task 10: Web — ป้ายในหน้าตรวจเครดิต / หน้าลูกค้า / แผงแชท · toast ตอนเปิดใช้ · ป้าย tier

**Files:**
- Modify: `apps/web/src/pages/CreditChecksPage.tsx` (~114 query · column `customer` 156-168)
- Modify: `apps/web/src/pages/CustomerDetailPage/components/DetailHeader.tsx:103-110`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.tsx` (~598 `name`/`metaLine` ส่วนหัว)
- Modify: `apps/web/src/pages/ContractDetailPage.tsx:218-222` (`activateMutation.onError`)
- Modify: `apps/web/src/types/customer-tier.ts:31` (`BLACKLIST: 'ประวัติเสีย'`)
- Modify/Create tests: `apps/web/src/components/customer/CustomerTierBadge.test.tsx` (ปรับ label ถ้า assert) · `apps/web/src/pages/CreditChecksPage.blacklist.test.tsx` (ใหม่) · `apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx` (เพิ่ม 1 เคส)

**Interfaces:**
- Consumes: Task 8 · `BLACKLIST_ERROR_CODE`
- Produces: `CreditChecksPage` เรียก `useCustomerBlacklistBatch(ids)` โดย `ids = (query.data?.data ?? []).map(r => r.customer?.id).filter((x): x is string => !!x)` และวาง `<CustomerBlacklistBadge result={batch.data?.[c.customer.id]} className="mt-1" />` ใต้ชื่อในคอลัมน์ `customer` · `DetailHeader`: `const blacklist = useCustomerBlacklist(customer.id)` → `<CustomerBlacklistBadge result={blacklist.data} size="md" />` ถัดจาก tier badge (ทุก kind) · `RoomDossier`: เมื่อ `customerId` → `<CustomerBlacklistBadge result={useCustomerBlacklist(customerId).data} />` ใต้ `metaLine` · `ContractDetailPage.onError`: code ∈ BLACKLIST → `toast.error([message, ...reasons.map(r => r.message)].join('\n'))` ไม่งั้นเดิม

- [ ] **Step 1: เขียนเทสที่ fail** — `CreditChecksPage.blacklist.test.tsx`: mock `api.get` ให้ `/credit-checks` คืน 2 แถว (customer c1, c2) และ `/customers/blacklist` คืน `{ c1: HARD }` → `expect(mocks.get).toHaveBeenCalledWith('/customers/blacklist', { params: { ids: 'c1,c2' } })` และเห็นป้าย 'ติด blacklist · ห้ามทำสัญญา' 1 อัน · `RoomDossier.test.tsx` เพิ่ม: ห้องที่มี customerId + `/customers/:id/blacklist` คืน SOFT → เห็น 'ต้องให้ผู้จัดการอนุมัติ' · `CustomerTierBadge.test.tsx`: BLACKLIST แสดง 'ประวัติเสีย'
- [ ] **Step 2: รันให้ fail** — `(cd apps/web && npx vitest run src/pages/CreditChecksPage.blacklist.test.tsx src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx src/components/customer/CustomerTierBadge.test.tsx)` · Expected: FAIL
- [ ] **Step 3: แก้ 5 ไฟล์ตาม Interfaces**
- [ ] **Step 4: รันให้ผ่าน** — คำสั่งเดิม แล้ว `(cd apps/web && npx vitest run)` ทั้งชุด · Expected: เขียว · `./tools/check-types.sh web` 0 errors · `(cd apps/web && npx eslint src/pages/CreditChecksPage.tsx src/pages/UnifiedInboxPage/components/RoomDossier.tsx src/pages/CustomerDetailPage/components/DetailHeader.tsx src/pages/ContractCreatePage src/components/customer src/hooks/useCustomerBlacklist.ts)` 0 errors
- [ ] **Step 5: Commit** — `git add apps/web/src && git commit -m "feat(web): blacklist badges on credit checks, customer header and chat dossier; activation toast lists reasons"`

---

### Task 11: เอกสาร + bump version + ตรวจรวม

**Files:**
- Modify: `apps/web/package.json:3` → `"version": "26.10.52"`
- Modify: `.claude/CLAUDE.md` ส่วน "Important Notes" — เพิ่ม bullet เดียว: `**ด่าน blacklist ตอนทำสัญญา (2026-10-24 · ก้อน 5 C3)**: CustomerBlacklistService (HARD: สัญญาผ่อนอยู่ 1 คน 1 เครื่อง · TERMINATED · ยึด/คืนเอง · หนี้สูญ · tag BLACKLIST · เบอร์ซ้ำ — ไม่มีใครปลด · SOFT: ผู้อ้างอิงพัวพัน — OWNER/BM ปลดพร้อมเหตุผล บันทึกลง Contract.blacklistOverride*) ตรวจที่ ContractLifecycleService.create() และ ContractWorkflowService.activate() (เปลี่ยนเครื่องข้าม) · overrideActiveContractCheck ถอดแล้ว · spec docs/superpowers/specs/2026-10-23-contract-blacklist-gate-design.md`

- [ ] **Step 1: แก้สองไฟล์**
- [ ] **Step 2: ตรวจรวม** — `./tools/check-types.sh all` · `npm --prefix apps/api test -- src/modules/contracts src/modules/customers` · `(cd apps/web && npx vitest run)` · Expected: 0 errors / เขียวทั้งหมด (e2e รันแล้วใน Task 6 — ถ้า Task 7–10 แตะ API อีกให้รัน `tools/test-chat-credit.sh` ซ้ำ)
- [ ] **Step 3: Commit** — `git add apps/web/package.json .claude/CLAUDE.md && git commit -m "chore: web 26.10.52 + CLAUDE.md note for the contract blacklist gate"`
