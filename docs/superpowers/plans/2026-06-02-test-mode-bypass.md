# Test-Mode Bypass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OWNER-controlled SystemConfig toggle `TEST_MODE_BYPASS` that, when on, skips 4 friction controls (credit precheck, KYC OTP, LIFF OTP, login 2FA) for pre-go-live UAT — with a loud app-wide banner + audit on every bypass.

**Architecture:** A `TestModeService` reads/writes SystemConfig `TEST_MODE_BYPASS` (mirrors `CustomerPiiService.isStrictMode/setStrictMode`, read-fresh no-cache). Each of the 4 control points injects it and, when enabled, short-circuits with an audit marker; when disabled, behaves exactly as today. Frontend shows a banner + an OWNER settings toggle.

**Tech Stack:** NestJS + Prisma + Jest (api), React + react-query + Vitest (web)

**Spec:** `docs/superpowers/specs/2026-06-02-test-mode-bypass-design.md`

**Security note:** This deliberately overrides the in-code comment in `kyc.service.ts` that forbids OTP bypass (it feared an env-based bypass mis-set in prod). Owner approved. Our toggle is safer than that feared case: SystemConfig (not NODE_ENV), default OFF, OWNER-only, audited, app-wide banner, documented go-live runbook. When editing kyc.service, REPLACE the old "must always validate" comment with one explaining the intentional OWNER-gated test-mode bypass.

---

## File Structure
- Create: `apps/api/src/modules/test-mode/test-mode.service.ts` + `.module.ts` + `__tests__/test-mode.service.spec.ts` — the toggle
- Create: `apps/api/src/modules/test-mode/test-mode.controller.ts` — GET/PUT /settings/test-mode
- Modify: `apps/api/src/app.module.ts` — register TestModeModule
- Modify: 4 control points (customer-precheck, kyc, liff verification, auth) — inject + bypass
- Create: `apps/web/src/lib/api/test-mode.ts`
- Create: `apps/web/src/components/layout/TestModeBanner.tsx` + wire into MainLayout
- Modify: a Settings page — OWNER toggle

---

## Task 1: TestModeService (SystemConfig toggle)

**Files:**
- Create: `apps/api/src/modules/test-mode/test-mode.service.ts`
- Create: `apps/api/src/modules/test-mode/test-mode.module.ts`
- Test: `apps/api/src/modules/test-mode/__tests__/test-mode.service.spec.ts`

- [ ] **Step 1: Failing test**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { TestModeService } from '../test-mode.service';

describe('TestModeService', () => {
  let svc: TestModeService;
  let prisma: any;
  beforeEach(async () => {
    prisma = { systemConfig: { findFirst: jest.fn(), upsert: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [TestModeService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = mod.get(TestModeService);
  });
  it('isEnabled true only when config value is "true"', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
    expect(await svc.isEnabled()).toBe(true);
  });
  it('isEnabled false when missing', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue(null);
    expect(await svc.isEnabled()).toBe(false);
  });
  it('isEnabled false on db error (fail-safe)', async () => {
    prisma.systemConfig.findFirst.mockRejectedValue(new Error('db down'));
    expect(await svc.isEnabled()).toBe(false);
  });
  it('setEnabled upserts the flag', async () => {
    prisma.systemConfig.upsert.mockResolvedValue({});
    await svc.setEnabled(true);
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'TEST_MODE_BYPASS' },
    }));
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd apps/api && npx jest test-mode.service --silent`

- [ ] **Step 3: Implement** (mirror `CustomerPiiService.isStrictMode/setStrictMode`)

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TestModeService {
  static readonly KEY = 'TEST_MODE_BYPASS';
  constructor(private readonly prisma: PrismaService) {}

  /** Read fresh (no cache) — cross-pod consistency. Fail-safe to false. */
  async isEnabled(): Promise<boolean> {
    try {
      const row = await this.prisma.systemConfig.findFirst({
        where: { key: TestModeService.KEY, deletedAt: null },
        select: { value: true },
      });
      return row?.value?.trim().toLowerCase() === 'true';
    } catch {
      return false;
    }
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    await this.prisma.systemConfig.upsert({
      where: { key: TestModeService.KEY },
      update: { value: enabled ? 'true' : 'false', updatedAt: new Date(), deletedAt: null },
      create: {
        key: TestModeService.KEY,
        value: enabled ? 'true' : 'false',
        label: 'โหมดทดสอบ — ปิดเช็คเครดิต/OTP/2FA (ห้ามเปิดบน prod ที่มีลูกค้าจริง)',
      },
    });
    return enabled;
  }
}
```
`test-mode.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { TestModeService } from './test-mode.service';
@Module({ providers: [TestModeService], exports: [TestModeService] })
export class TestModeModule {}
```
> Confirm `SystemConfig` has `key`/`value`/`label`/`deletedAt` and PrismaModule is global (it is). Mirror exact field usage from `customer-pii.service.ts` setStrictMode.

- [ ] **Step 4: Run, expect PASS** — `cd apps/api && npx jest test-mode.service --silent`
- [ ] **Step 5: Commit** — `git add apps/api/src/modules/test-mode && git commit -m "feat(test-mode): TestModeService toggle (SystemConfig, fail-safe)"`

---

## Task 2: Settings endpoint (GET status + PUT OWNER toggle + audit)

**Files:**
- Create: `apps/api/src/modules/test-mode/test-mode.controller.ts`
- Modify: `apps/api/src/modules/test-mode/test-mode.module.ts` (add controller)
- Modify: `apps/api/src/app.module.ts` (register TestModeModule)
- Test: `apps/api/src/modules/test-mode/__tests__/test-mode.controller.spec.ts`

- [ ] **Step 1: Failing controller test**

```typescript
import { Test } from '@nestjs/testing';
import { TestModeController } from '../test-mode.controller';
import { TestModeService } from '../test-mode.service';

describe('TestModeController', () => {
  let ctrl: TestModeController;
  const svc = { isEnabled: jest.fn(), setEnabled: jest.fn() };
  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      controllers: [TestModeController],
      providers: [{ provide: TestModeService, useValue: svc }],
    }).compile();
    ctrl = mod.get(TestModeController);
  });
  it('GET returns status', async () => {
    svc.isEnabled.mockResolvedValue(true);
    expect(await ctrl.get()).toEqual({ enabled: true });
  });
  it('PUT sets + returns status', async () => {
    svc.setEnabled.mockResolvedValue(false);
    expect(await ctrl.set({ enabled: false })).toEqual({ enabled: false });
    expect(svc.setEnabled).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd apps/api && npx jest test-mode.controller --silent`

- [ ] **Step 3: Implement controller** (copy guard/Roles/Audit imports verbatim from `customers.controller.ts`)

```typescript
import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TestModeService } from './test-mode.service';

class SetTestModeDto { @IsBoolean() enabled!: boolean; }

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('settings/test-mode')
export class TestModeController {
  constructor(private readonly testMode: TestModeService) {}

  @Get()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')
  async get() { return { enabled: await this.testMode.isEnabled() }; }

  @Put()
  @Roles('OWNER')
  async set(@Body() dto: SetTestModeDto) {
    return { enabled: await this.testMode.setEnabled(dto.enabled) };
  }
}
```
GET allows all roles (banner needs to read it); PUT OWNER-only. The global AuditInterceptor records the PUT (audit string `TEST_MODE_TOGGLED` is emitted by the interceptor for mutating endpoints — confirm interceptor covers PUT; if a custom action string is needed, add an `@AuditAction('TEST_MODE_TOGGLED')` per the codebase's audit decorator pattern — check how other OWNER toggles like MakerCheckerToggle audit).

Add controller to `test-mode.module.ts` (`controllers: [TestModeController]`) and register `TestModeModule` in `app.module.ts` imports.

- [ ] **Step 4: Run PASS + type-check** — `cd apps/api && npx jest test-mode --silent && cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api`
- [ ] **Step 5: Commit** — `git add apps/api/src/modules/test-mode apps/api/src/app.module.ts && git commit -m "feat(test-mode): GET/PUT settings/test-mode (OWNER toggle)"`

---

## Task 3: Bypass — customer credit precheck

**Files:**
- Modify: `apps/api/src/modules/customers/customer-precheck.service.ts`
- Modify: `apps/api/src/modules/customers/customers.module.ts` (import TestModeModule)
- Test: `apps/api/src/modules/customers/customer-precheck.service.spec.ts`

- [ ] **Step 1: Failing test** — when test-mode on, precheck returns `decision: 'PASS'` without running checks + writes audit.

```typescript
it('returns PASS (bypass) when test-mode enabled', async () => {
  testMode.isEnabled.mockResolvedValue(true);
  const res = await service.<precheckMethod>(<minimal valid input>);
  expect(res.decision).toBe('PASS');
  expect(res.reasons).toContain('TEST_MODE_BYPASS');
});
```
> Read the file to get the exact public method name + input shape (it returns `{ decision: 'PASS'|'REVIEW'|'FAIL', reasons: string[] }`). Inject a mocked `TestModeService`.

- [ ] **Step 2: Run, expect FAIL** — `cd apps/api && npx jest customer-precheck --silent`

- [ ] **Step 3: Implement** — inject `TestModeService`; at the TOP of the precheck method:
```typescript
if (await this.testMode.isEnabled()) {
  // Test-mode UAT bypass (OWNER-gated, audited). Turn off before go-live.
  await this.audit.log({ action: 'CREDIT_PRECHECK_BYPASSED_TEST_MODE', entity: 'customer', /* entityId if available */ });
  return { decision: 'PASS', reasons: ['TEST_MODE_BYPASS'] };
}
```
Use the audit service the module already uses (check how customers writes audit; if precheck has no audit dep, use AuditService or AuditInterceptor-compatible call — match existing pattern). Add `imports: [TestModeModule]` to `customers.module.ts`.

- [ ] **Step 4: Run PASS + type-check** — `cd apps/api && npx jest customer-precheck --silent && ./tools/check-types.sh api` (from repo root)
- [ ] **Step 5: Commit** — `git add apps/api/src/modules/customers && git commit -m "feat(test-mode): bypass credit precheck when test-mode on"`

---

## Task 4: Bypass — KYC OTP (contract signing)

**Files:**
- Modify: `apps/api/src/modules/kyc/kyc.service.ts` (`verifyOtp`, ~line 136) + `kyc.module.ts`
- Test: kyc service spec (find existing or create)

- [ ] **Step 1: Failing test** — `verifyOtp` succeeds without a valid OTP when test-mode on.
```typescript
it('passes verifyOtp without checking code when test-mode on', async () => {
  testMode.isEnabled.mockResolvedValue(true);
  // arrange minimal contract/kyc mocks as the success path needs
  const res = await service.verifyOtp('contract-1', '000000');
  expect(res).toBeTruthy(); // matches the method's success return shape
});
```
> Inspect `verifyOtp`'s success return + what it mutates (it likely marks kyc VERIFIED + advances contract). The bypass must produce the SAME success side-effects (mark verified) so the contract flow proceeds — not just return early. Read the success branch and replicate its state changes in the bypass.

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — at top of `verifyOtp`, REPLACE the existing "OTP must always be validated…" comment with:
```typescript
// Test-mode UAT bypass (OWNER-gated SystemConfig TEST_MODE_BYPASS, default off,
// audited, app-wide banner). Replaces the former always-validate stance per
// owner decision for pre-go-live testing. MUST be off before go-live.
if (await this.testMode.isEnabled()) {
  // perform the SAME success side-effects as a real verify (mark kyc verified,
  // advance contract) then audit + return the success shape
  ...replicate success path mutations...
  await this.audit.log({ action: 'KYC_OTP_BYPASSED_TEST_MODE', entity: 'contract', entityId: contractId });
  return <success shape>;
}
```
Inject `TestModeService`, add `imports: [TestModeModule]` to kyc.module.ts.

- [ ] **Step 4: Run PASS + type-check**
- [ ] **Step 5: Commit** — `git commit -m "feat(test-mode): bypass KYC OTP when test-mode on (replaces always-validate per owner)"`

---

## Task 5: Bypass — LIFF OTP

**Files:**
- Modify: `apps/api/src/modules/chatbot-finance/services/verification.service.ts` (`verifyOtp`, ~line 208) + its module
- Test: verification service spec

- [ ] **Step 1: Failing test** — verifyOtp returns success without valid code when test-mode on (replicate success side-effects). Same shape as Task 4.
- [ ] **Step 2: Run FAIL**
- [ ] **Step 3: Implement** — inject TestModeService; at top of verifyOtp, if enabled → replicate the success path's state changes + `audit.log({ action: 'LIFF_OTP_BYPASSED_TEST_MODE', ... })` + return success. Add TestModeModule import.
- [ ] **Step 4: Run PASS + type-check**
- [ ] **Step 5: Commit** — `git commit -m "feat(test-mode): bypass LIFF OTP when test-mode on"`

---

## Task 6: Bypass — login 2FA

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts` (`login`, the 2FA branch) + auth.module.ts
- Test: auth service spec

- [ ] **Step 1: Failing test** — when a 2FA-enabled user logs in with correct password and test-mode on, `login` returns full tokens directly (no `requiresTwoFactor`/temp-token step).
> Read `login()` (~line 149): it currently, for a 2FA user, returns a temp token + `requiresTwoFactor: true`. The bypass: when test-mode on, skip that branch and issue the full session as if 2FA passed.
- [ ] **Step 2: Run FAIL**
- [ ] **Step 3: Implement** — inject TestModeService; in `login`, guard the 2FA branch: `if (user.twoFactorEnabled && !(await this.testMode.isEnabled())) { ...existing temp-token 2FA path... }` else issue full tokens. When bypassing, `loginAudit.record({... twoFactorUsed: false})` + audit `LOGIN_2FA_BYPASSED_TEST_MODE`. Add TestModeModule import to auth.module.ts (watch for circular dep — TestModeModule only depends on global Prisma, safe).
- [ ] **Step 4: Run PASS + type-check** (run full auth suite — auth is sensitive)
- [ ] **Step 5: Commit** — `git commit -m "feat(test-mode): bypass login 2FA when test-mode on"`

---

## Task 7: Frontend — banner + settings toggle

**Files:**
- Create: `apps/web/src/lib/api/test-mode.ts`
- Create: `apps/web/src/components/layout/TestModeBanner.tsx`
- Modify: `apps/web/src/components/layout/MainLayout.tsx` (render banner)
- Modify: a Settings page/tab (OWNER) — add the toggle
- Test: `apps/web/src/components/layout/__tests__/TestModeBanner.test.tsx`

- [ ] **Step 1: api client**
```typescript
import api from '@/lib/api';
export const testModeKeys = { status: ['test-mode-status'] as const };
export const testModeApi = {
  get: () => api.get<{ enabled: boolean }>('/settings/test-mode').then((r) => r.data),
  set: (enabled: boolean) => api.put<{ enabled: boolean }>('/settings/test-mode', { enabled }).then((r) => r.data),
};
```

- [ ] **Step 2: Failing banner test**
```tsx
it('shows banner when test-mode enabled', async () => {
  (testModeApi.get as any).mockResolvedValue({ enabled: true });
  // render TestModeBanner inside QueryClientProvider
  await waitFor(() => expect(screen.getByText(/โหมดทดสอบ/)).toBeInTheDocument());
});
it('hides banner when disabled', async () => {
  (testModeApi.get as any).mockResolvedValue({ enabled: false });
  // render → expect no banner text
});
```

- [ ] **Step 3: Implement banner** — `useQuery(testModeKeys.status, testModeApi.get)`; if `data?.enabled` render a `bg-destructive text-destructive-foreground` strip (semantic tokens) "⚠️ โหมดทดสอบ — เช็คเครดิต/OTP/2FA ถูกปิด ห้ามใช้กับลูกค้าจริง" + (OWNER) link to settings. Render `<TestModeBanner />` at top of MainLayout. Thai `leading-snug`.

- [ ] **Step 4: Settings toggle** — in the OWNER settings page (e.g. `/settings#users` hub or GeneralSettings), add a toggle "โหมดทดสอบ (ปิดเช็คเครดิต/OTP)" calling `testModeApi.set`, with a confirm dialog (ConfirmDialog, NOT window.confirm) when turning ON, then `queryClient.invalidateQueries(testModeKeys.status)` + toast. Match how MakerCheckerToggle is built (reference).

- [ ] **Step 5: Run tests + type-check** — `cd apps/web && npx vitest run TestModeBanner --silent && cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web`
- [ ] **Step 6: Commit** — `git add apps/web && git commit -m "feat(test-mode): app-wide banner + OWNER settings toggle"`

---

## Task 8: Verify

- [ ] `./tools/check-types.sh all` → 0 errors
- [ ] `cd apps/api && npx jest test-mode customer-precheck kyc verification auth --silent` → green (incl. existing control tests when flag off)
- [ ] `cd apps/web && npx vitest run TestModeBanner --silent` → green
- [ ] Manual: PUT /settings/test-mode as non-OWNER → 403

---

## Self-Review
- **Spec coverage:** toggle service (T1) ✓; endpoint+audit (T2) ✓; 4 bypass points (T3-T6) ✓; banner+settings toggle (T7) ✓; off=unchanged behaviour asserted in each bypass task ✓; runbook in spec ✓.
- **Security override (kyc):** T4 explicitly replaces the always-validate comment with the gated-bypass rationale, per owner decision.
- **Placeholders:** bypass tasks reference "the success path side-effects" which the implementer must read from each method (OTP verify mutates state) — this is a read-the-method instruction, not a vague requirement; behavior (replicate success + audit + return success shape) is specified. Exact method names/lines to be confirmed by implementer against cited files.
- **Type consistency:** `TestModeService.isEnabled()/setEnabled()` + `KEY='TEST_MODE_BYPASS'` used consistently; audit action strings consistent (`*_BYPASSED_TEST_MODE`, `TEST_MODE_TOGGLED`).
- **Circular deps:** TestModeModule depends only on global PrismaModule → safe to import anywhere.
