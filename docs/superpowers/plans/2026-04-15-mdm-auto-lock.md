# MDM Auto Lock/Unlock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้า MDM Test สำหรับทดสอบ lock/unlock จริง + auto lock เมื่อค้างชำระ + auto unlock เมื่อจ่ายครบ + LINE แจ้งลูกค้า

**Architecture:** เพิ่ม `mdmLockedAt` field ใน Contract, สร้าง MdmAutoService สำหรับ auto logic, hook auto unlock เข้า recordPayment(), cron auto lock ทุกวัน, สร้าง MdmTestPage frontend

**Tech Stack:** NestJS, Prisma, PJ-Soft MDM API, React, TanStack Query, LINE Messaging API

**Spec:** `docs/superpowers/specs/2026-04-15-mdm-auto-lock-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `apps/api/src/modules/mdm/mdm-auto.service.ts` | Auto lock/unlock logic, settings read, LINE notify |
| `apps/api/src/modules/mdm/mdm-auto.cron.ts` | Daily cron: scan overdue contracts → auto lock |
| `apps/web/src/pages/MdmTestPage.tsx` | Test page: search IMEI, view status, lock/unlock buttons |
| `apps/api/prisma/migrations/XXXXXX_add_mdm_locked_at/migration.sql` | DB migration |

### Files to Modify

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | Add `mdmLockedAt` to Contract |
| `apps/api/src/modules/mdm/mdm.module.ts` | Register MdmAutoService, MdmAutoCron |
| `apps/api/src/modules/payments/payments.service.ts` | Add auto unlock hook after payment |
| `apps/web/src/App.tsx` | Add route `/settings/mdm-test` |
| `apps/web/src/config/menu.ts` | Add MDM Test to OWNER menu |

---

## Task 1: DB Migration — mdmLockedAt on Contract

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (Contract model)

- [ ] **Step 1: Add mdmLockedAt field**

In Contract model, add:

```prisma
mdmLockedAt     DateTime?   @map("mdm_locked_at")
```

- [ ] **Step 2: Run migration**

```bash
cd apps/api && npx prisma migrate dev --name add_mdm_locked_at_to_contract
```

- [ ] **Step 3: Verify + commit**

```bash
cd apps/api && npx prisma generate
./tools/check-types.sh api
git add apps/api/prisma/
git commit -m "feat(api): add mdmLockedAt field to Contract model"
```

---

## Task 2: MDM Auto Service

**Files:**
- Create: `apps/api/src/modules/mdm/mdm-auto.service.ts`

- [ ] **Step 1: Create mdm-auto.service.ts**

Service with methods:

1. **`getSettings()`** — read MDM auto settings from SystemConfig via IntegrationConfigService
   - `mdm.autoLockEnabled` (default false)
   - `mdm.autoLockDays` (default 30)
   - `mdm.autoUnlockEnabled` (default false)
   - `mdm.notifyLine` (default true)

2. **`autoLockOverdueContracts()`** — called by cron
   - Find contracts: status OVERDUE/DEFAULT, mdmLockedAt is null, has product with imeiSerial
   - Calculate daysOverdue for each
   - If daysOverdue >= autoLockDays → lock + notify + set mdmLockedAt

3. **`autoUnlockAfterPayment(contractId)`** — called after payment
   - Check: contract.mdmLockedAt != null (is locked)
   - Check: no outstanding overdue payments (all PENDING/PAID, none OVERDUE)
   - If clear → unlock + notify + set mdmLockedAt = null

4. **`notifyCustomerLock(contract, daysOverdue)`** — send LINE message about lock
5. **`notifyCustomerUnlock(contract)`** — send LINE message about unlock

Dependencies:
- `MdmService` (same module — lockDevice/unlockDevice)
- `PrismaService`
- `IntegrationConfigService` from integrations module (for settings)
- LINE notification: use existing `LineOaService` or `NotificationsService` pattern for sending LINE messages

Key details:
- Contract → Product relation: `contract.product.imeiSerial`
- For LINE: find customer's LINE userId via `CustomerLineLink` table or `ChatSession` with channel LINE_FINANCE
- All MDM calls wrapped in try/catch — non-blocking, log errors
- Log every action in AuditLog (use existing `AuditInterceptor` pattern or manual insert)

- [ ] **Step 2: Type check + commit**

```bash
./tools/check-types.sh api
git commit -m "feat(api): add MdmAutoService — auto lock/unlock logic with LINE notify"
```

---

## Task 3: MDM Auto Lock Cron

**Files:**
- Create: `apps/api/src/modules/mdm/mdm-auto.cron.ts`

- [ ] **Step 1: Create cron**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MdmAutoService } from './mdm-auto.service';

@Injectable()
export class MdmAutoCron {
  private readonly logger = new Logger(MdmAutoCron.name);

  constructor(private mdmAuto: MdmAutoService) {}

  @Cron('30 1 * * *', { timeZone: 'Asia/Bangkok' })
  async autoLockOverdue(): Promise<void> {
    this.logger.log('Starting MDM auto-lock scan');
    try {
      const result = await this.mdmAuto.autoLockOverdueContracts();
      this.logger.log(`MDM auto-lock: ${result.locked} locked, ${result.skipped} skipped, ${result.failed} failed`);
    } catch (error) {
      this.logger.error('MDM auto-lock cron failed', error);
    }
  }
}
```

Runs at 01:30 Bangkok time (30 min after dunning escalation at 01:00).

- [ ] **Step 2: Register in module**

Add `MdmAutoService` and `MdmAutoCron` to `mdm.module.ts` providers.

Import `IntegrationsModule` to get `IntegrationConfigService`.

- [ ] **Step 3: Type check + commit**

```bash
./tools/check-types.sh api
git commit -m "feat(api): add daily MDM auto-lock cron for overdue contracts"
```

---

## Task 4: Auto Unlock Hook in Payments

**Files:**
- Modify: `apps/api/src/modules/payments/payments.service.ts`

- [ ] **Step 1: Inject MdmAutoService**

Read payments.service.ts first. Find `recordPayment()` method and `checkContractCompletion()`.

Import and inject `MdmAutoService` (use `@Optional()` in case MDM module not available):

```typescript
import { MdmAutoService } from '../mdm/mdm-auto.service';

constructor(
  // ... existing
  @Optional() private mdmAuto?: MdmAutoService,
) {}
```

- [ ] **Step 2: Add auto unlock after payment**

In `recordPayment()`, AFTER the payment is recorded and all post-payment actions (journal, receipt, loyalty) are done, add:

```typescript
// Auto unlock MDM if device was locked
if (this.mdmAuto) {
  this.mdmAuto.autoUnlockAfterPayment(contractId).catch((err) =>
    this.logger.error('MDM auto-unlock failed', err),
  );
}
```

This is fire-and-forget — payment succeeds even if MDM fails.

- [ ] **Step 3: Make MdmAutoService available**

In `mdm.module.ts`, export `MdmAutoService`.
In `payments.module.ts` (or wherever payments module is), import `MdmModule`.

Read both module files to understand the import pattern.

- [ ] **Step 4: Type check + commit**

```bash
./tools/check-types.sh api
git commit -m "feat(api): hook MDM auto-unlock into payment recording flow"
```

---

## Task 5: MDM Test Page (Frontend)

**Files:**
- Create: `apps/web/src/pages/MdmTestPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 1: Create MdmTestPage**

OWNER-only page with:

**Section 1: ค้นหาเครื่อง**
- Text input for IMEI + "ค้นหา" button
- API: `GET /mdm/device-status?imei=xxx`
- Show result: device name, model, IMEI, lock status (ล็อค/ไม่ล็อค) with color badge

**Section 2: Actions (shown after search)**
- "ล็อคเครื่อง" button (red) — requires reason input + confirm dialog → `POST /mdm/lock` body: { imei, reason }
- "ปลดล็อค" button (green) — confirm dialog → `POST /mdm/unlock` body: { imei }
- Show result after action: success/failure message with toast

**Section 3: MDM Auto Settings**
- Toggle: Auto Lock (on/off)
- Number input: จำนวนวันก่อนล็อค (default 30)
- Toggle: Auto Unlock (on/off)
- Toggle: แจ้ง LINE (on/off)
- Save button
- Settings read/write via Integration Hub config: `GET /integrations/mdm/config`, `PUT /integrations/mdm/config`

Use existing patterns: useQuery, useMutation, toast, Button, Badge, Card.

- [ ] **Step 2: Add route**

```typescript
const MdmTestPage = lazy(() => import('./pages/MdmTestPage'));
<Route path="/settings/mdm-test" element={<ProtectedRoute roles={['OWNER']}><MdmTestPage /></ProtectedRoute>} />
```

- [ ] **Step 3: Add to OWNER menu**

In config/menu.ts, OWNER "ตั้งค่า & ระบบ" section:

```typescript
{ label: 'MDM Test', path: '/settings/mdm-test', icon: Smartphone },
```

`Smartphone` should already be imported.

- [ ] **Step 4: Type check + commit**

```bash
./tools/check-types.sh web
git commit -m "feat(web): add MDM Test page with lock/unlock and auto settings"
```

---

## Task 6: Final Type Check + Push

- [ ] **Step 1: Full type check**

```bash
./tools/check-types.sh all
```

- [ ] **Step 2: Push**

```bash
git push
```

---

## Verification

1. **TypeScript**: `./tools/check-types.sh all` — 0 errors
2. **MDM Test Page**: Login OWNER → `/settings/mdm-test` → enter IMEI → see device status
3. **Lock test**: Enter IMEI + reason → click ล็อค → device locks in PJ-Soft (needs real API key)
4. **Unlock test**: Click ปลดล็อค → device unlocks
5. **Auto settings**: Toggle auto lock on → set 30 days → save → verify in SystemConfig
6. **Auto lock cron**: Manually trigger or wait for 01:30 → contracts overdue 30+ days get locked
7. **Auto unlock**: Record payment that clears all overdue → device auto-unlocks + LINE sent
8. **Non-blocking**: If MDM API is down, payment still records successfully
