# Customer Intake Wizard UI (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Build a new `/customer-intake` page that walks sales through Quick Intake → Pre-check Gate → Full Intake. Calls Phase 2 endpoint. Full Intake step reuses fields from existing customer create flow. Outputs a `customerId` + status that Phase 4 (integration) will use to wire into `/contracts/create`.

**Architecture:** Single page with multi-step wizard state managed by a hook. Components are presentational + driven by hook. Uses existing smart-card reader + OCR infrastructure.

**Tech Stack:** React 18, Vite, shadcn/ui, Tailwind v4 (semantic tokens), React Query, react-hook-form + zod.

**Spec reference:** [docs/superpowers/specs/2026-04-20-customer-intake-credit-check-redesign-design.md](../specs/2026-04-20-customer-intake-credit-check-redesign-design.md) section 5 (flow), section 7 (components).

---

## File Structure

### Created
- `apps/web/src/pages/CustomerIntakePage/index.tsx` — page container + route
- `apps/web/src/pages/CustomerIntakePage/hooks/useCustomerIntake.ts` — wizard state + navigation + mutations
- `apps/web/src/pages/CustomerIntakePage/components/QuickIntakeStep.tsx` — step 1
- `apps/web/src/pages/CustomerIntakePage/components/PreCheckResultStep.tsx` — step 2
- `apps/web/src/pages/CustomerIntakePage/components/FullIntakeStep.tsx` — step 3
- `apps/web/src/pages/CustomerIntakePage/components/IntakeStepIndicator.tsx` — top progress bar
- `apps/web/src/pages/CustomerIntakePage/types.ts` — wizard state types
- `apps/web/src/pages/CustomerIntakePage/constants.ts` — step labels
- `apps/web/src/lib/api/customer-precheck.ts` — API client helpers

### Modified
- `apps/web/src/App.tsx` — register route `/customer-intake`
- `apps/web/src/config/menu.ts` — add menu entry "เช็คเครดิตก่อนทำสัญญา" under "ขาย" section

---

## Task 1: API client helpers + types

**Files:**
- Create: `apps/web/src/lib/api/customer-precheck.ts`
- Create: `apps/web/src/pages/CustomerIntakePage/types.ts`
- Create: `apps/web/src/pages/CustomerIntakePage/constants.ts`

- [ ] **Step 1: Create API helper**

`apps/web/src/lib/api/customer-precheck.ts`:

```typescript
import api from '@/lib/api';
import type { CustomerTier } from '@/types/customer-tier';

export type PreCheckDecision = 'PASS' | 'FAIL' | 'REVIEW';

export interface PreCheckRequest {
  nationalId: string;
  phone: string;
  bankName?: string;
  statementFiles?: string[];
}

export interface PreCheckResponse {
  customerId: string;
  isNewCustomer: boolean;
  tier: CustomerTier;
  decision: PreCheckDecision;
  reasons: { code: string; message: string }[];
  aiScore?: number;
  creditCheckId?: string;
}

export async function postPreCheck(body: PreCheckRequest): Promise<PreCheckResponse> {
  const { data } = await api.post<PreCheckResponse>('/customers/pre-check', body);
  return data;
}
```

- [ ] **Step 2: Create wizard types**

`apps/web/src/pages/CustomerIntakePage/types.ts`:

```typescript
import type { PreCheckResponse } from '@/lib/api/customer-precheck';

export type IntakeStep = 'quick' | 'precheck' | 'full' | 'done';

export interface QuickIntakeForm {
  nationalId: string;
  phone: string;
  firstName: string;
  lastName: string;
  prefix?: string;
  bankName?: string;
  statementFiles: File[];
}

export interface FullIntakeForm {
  // Identity (pre-filled from quick)
  prefix?: string;
  firstName: string;
  lastName: string;
  nickname?: string;
  nationalId: string;
  birthDate?: string;
  // Contact
  phone: string;
  phoneSecondary?: string;
  email?: string;
  lineId?: string;
  facebookLink?: string;
  facebookName?: string;
  // Work
  occupation?: string;
  salary?: string;
  workplace?: string;
  // References (4 people)
  references: {
    prefix?: string;
    firstName: string;
    lastName: string;
    phone: string;
    relationship: string;
  }[];
}

export interface WizardState {
  step: IntakeStep;
  quickForm: QuickIntakeForm;
  preCheckResult: PreCheckResponse | null;
  fullForm: FullIntakeForm | null;
}
```

- [ ] **Step 3: Create constants**

`apps/web/src/pages/CustomerIntakePage/constants.ts`:

```typescript
export const STEPS = [
  { key: 'quick', label: 'ข้อมูลเบื้องต้น' },
  { key: 'precheck', label: 'เช็คเครดิต' },
  { key: 'full', label: 'ข้อมูลเต็ม' },
  { key: 'done', label: 'เสร็จสิ้น' },
] as const;
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api/customer-precheck.ts apps/web/src/pages/CustomerIntakePage/
git commit -m "feat(customer-intake): add API client + wizard types + constants"
```

---

## Task 2: useCustomerIntake hook

**Files:**
- Create: `apps/web/src/pages/CustomerIntakePage/hooks/useCustomerIntake.ts`

- [ ] **Step 1: Implement hook**

```typescript
import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/api';
import { postPreCheck, type PreCheckResponse } from '@/lib/api/customer-precheck';
import type { IntakeStep, QuickIntakeForm, WizardState } from '../types';

const emptyQuick: QuickIntakeForm = {
  nationalId: '',
  phone: '',
  firstName: '',
  lastName: '',
  prefix: '',
  bankName: '',
  statementFiles: [],
};

async function filesToBase64(files: File[]): Promise<string[]> {
  const results: string[] = [];
  for (const file of files) {
    const result = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
      reader.readAsDataURL(file);
    });
    results.push(result);
  }
  return results;
}

export function useCustomerIntake() {
  const [state, setState] = useState<WizardState>({
    step: 'quick',
    quickForm: emptyQuick,
    preCheckResult: null,
    fullForm: null,
  });

  const goTo = useCallback((step: IntakeStep) => {
    setState((prev) => ({ ...prev, step }));
  }, []);

  const updateQuick = useCallback((patch: Partial<QuickIntakeForm>) => {
    setState((prev) => ({ ...prev, quickForm: { ...prev.quickForm, ...patch } }));
  }, []);

  const preCheckMutation = useMutation<PreCheckResponse, unknown, void>({
    mutationFn: async () => {
      const { quickForm } = state;
      const statementBase64 =
        quickForm.statementFiles.length > 0
          ? await filesToBase64(quickForm.statementFiles)
          : undefined;
      return postPreCheck({
        nationalId: quickForm.nationalId,
        phone: quickForm.phone,
        bankName: quickForm.bankName || undefined,
        statementFiles: statementBase64,
      });
    },
    onSuccess: (result) => {
      setState((prev) => ({ ...prev, preCheckResult: result, step: 'precheck' }));
      if (result.decision === 'PASS') {
        toast.success('ผ่านการตรวจเครดิตเบื้องต้น');
      } else if (result.decision === 'FAIL') {
        toast.error('ไม่ผ่านการตรวจเครดิต');
      } else {
        toast.warning('ต้องให้ผู้จัดการตรวจเพิ่ม');
      }
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });

  const proceedToFull = useCallback(() => {
    if (!state.preCheckResult) return;
    if (state.preCheckResult.decision === 'FAIL') return; // no progress
    // Pre-fill full form from quick form
    setState((prev) => ({
      ...prev,
      step: 'full',
      fullForm: {
        prefix: prev.quickForm.prefix,
        firstName: prev.quickForm.firstName,
        lastName: prev.quickForm.lastName,
        nationalId: prev.quickForm.nationalId,
        phone: prev.quickForm.phone,
        references: [
          { firstName: '', lastName: '', phone: '', relationship: '' },
          { firstName: '', lastName: '', phone: '', relationship: '' },
          { firstName: '', lastName: '', phone: '', relationship: '' },
          { firstName: '', lastName: '', phone: '', relationship: '' },
        ],
      },
    }));
  }, [state.preCheckResult]);

  const reset = useCallback(() => {
    setState({
      step: 'quick',
      quickForm: emptyQuick,
      preCheckResult: null,
      fullForm: null,
    });
  }, []);

  return {
    state,
    goTo,
    updateQuick,
    runPreCheck: () => preCheckMutation.mutate(),
    isPreChecking: preCheckMutation.isPending,
    proceedToFull,
    reset,
  };
}
```

- [ ] **Step 2: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/CustomerIntakePage/hooks/
git commit -m "feat(customer-intake): add useCustomerIntake hook

Wizard navigation + mutation for POST /customers/pre-check. Handles
base64 conversion of statement files before posting."
```

---

## Task 3: QuickIntakeStep + IntakeStepIndicator

**Files:**
- Create: `apps/web/src/pages/CustomerIntakePage/components/IntakeStepIndicator.tsx`
- Create: `apps/web/src/pages/CustomerIntakePage/components/QuickIntakeStep.tsx`

- [ ] **Step 1: IntakeStepIndicator**

```typescript
import { Check } from 'lucide-react';
import { STEPS } from '../constants';
import type { IntakeStep } from '../types';

interface Props {
  current: IntakeStep;
}

export default function IntakeStepIndicator({ current }: Props) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-2 mb-6 px-2">
      {STEPS.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={step.key} className="flex items-center gap-2 flex-1">
            <div
              className={`flex items-center justify-center size-8 rounded-full text-xs font-semibold ${
                done
                  ? 'bg-success text-success-foreground'
                  : active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {done ? <Check className="size-4" /> : i + 1}
            </div>
            <span
              className={`text-xs ${active ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 ${i < currentIdx ? 'bg-success' : 'bg-border'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: QuickIntakeStep**

```typescript
import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Upload, CreditCard, Loader2 } from 'lucide-react';
import { checkCardReaderStatus, readSmartCard } from '@/lib/cardReader';
import { toast } from 'sonner';
import type { QuickIntakeForm } from '../types';

interface Props {
  form: QuickIntakeForm;
  onChange: (patch: Partial<QuickIntakeForm>) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

export default function QuickIntakeStep({ form, onChange, onSubmit, isSubmitting }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cardReaderLoading, setCardReaderLoading] = useState(false);

  const handleSmartCard = async () => {
    setCardReaderLoading(true);
    try {
      const status = await checkCardReaderStatus();
      if (!status || status.status !== 'ready') {
        toast.error('กรุณาเสียบเครื่องอ่านบัตรและใส่บัตรประชาชน');
        return;
      }
      const card = await readSmartCard();
      onChange({
        nationalId: card.nationalId || form.nationalId,
        prefix: card.prefix || form.prefix,
        firstName: card.firstName || form.firstName,
        lastName: card.lastName || form.lastName,
      });
      toast.success('อ่านบัตรสำเร็จ');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'อ่านบัตรไม่สำเร็จ');
    } finally {
      setCardReaderLoading(false);
    }
  };

  const canSubmit =
    /^\d{13}$/.test(form.nationalId) &&
    /^0\d{8,9}$/.test(form.phone) &&
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    form.statementFiles.length > 0;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">ข้อมูลเบื้องต้น</h3>
          <Button variant="outline" size="sm" onClick={handleSmartCard} disabled={cardReaderLoading}>
            {cardReaderLoading ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
            อ่านบัตร (Smart Card)
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">คำนำหน้า</label>
            <Input
              value={form.prefix || ''}
              onChange={(e) => onChange({ prefix: e.target.value })}
              placeholder="นาย / นาง / น.ส."
            />
          </div>
          <div />
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">ชื่อ *</label>
            <Input
              value={form.firstName}
              onChange={(e) => onChange({ firstName: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">นามสกุล *</label>
            <Input
              value={form.lastName}
              onChange={(e) => onChange({ lastName: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">เลขบัตรประชาชน *</label>
            <Input
              value={form.nationalId}
              onChange={(e) => onChange({ nationalId: e.target.value.replace(/\D/g, '').slice(0, 13) })}
              placeholder="1234567890123"
              maxLength={13}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">เบอร์โทร *</label>
            <Input
              value={form.phone}
              onChange={(e) => onChange({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              placeholder="0812345678"
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Statement ธนาคาร 3 เดือน *</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              จำเป็นสำหรับการวิเคราะห์เครดิตด้วย AI
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-foreground mb-1">ธนาคาร</label>
          <Input
            value={form.bankName || ''}
            onChange={(e) => onChange({ bankName: e.target.value })}
            placeholder="เช่น กสิกรไทย"
          />
        </div>

        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            multiple
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              onChange({ statementFiles: files });
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-border hover:border-primary/50 rounded-lg p-6 flex flex-col items-center gap-1 transition"
          >
            <Upload className="size-6 text-muted-foreground" />
            <span className="text-sm text-foreground">
              {form.statementFiles.length > 0
                ? `เลือกแล้ว ${form.statementFiles.length} ไฟล์`
                : 'ลากไฟล์หรือคลิกเลือก'}
            </span>
            <span className="text-xs text-muted-foreground">รูปภาพหรือ PDF หลายไฟล์ได้</span>
          </button>
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" size="lg" onClick={onSubmit} disabled={!canSubmit || isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              กำลังเช็คเครดิต...
            </>
          ) : (
            'เช็คเครดิตเบื้องต้น'
          )}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/CustomerIntakePage/components/IntakeStepIndicator.tsx apps/web/src/pages/CustomerIntakePage/components/QuickIntakeStep.tsx
git commit -m "feat(customer-intake): add QuickIntakeStep + step indicator

Smart card reader integration + statement file upload + basic validation.
Submit button disabled until nationalId (13 digits) + phone + name +
statement files all present."
```

---

## Task 4: PreCheckResultStep

**Files:**
- Create: `apps/web/src/pages/CustomerIntakePage/components/PreCheckResultStep.tsx`

- [ ] **Step 1: Implement**

```typescript
import { Button } from '@/components/ui/button';
import CustomerTierBadge from '@/components/customer/CustomerTierBadge';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { PreCheckResponse } from '@/lib/api/customer-precheck';

interface Props {
  result: PreCheckResponse;
  onProceed: () => void;
  onCancel: () => void;
}

export default function PreCheckResultStep({ result, onProceed, onCancel }: Props) {
  const Icon =
    result.decision === 'PASS' ? CheckCircle2 : result.decision === 'FAIL' ? XCircle : AlertTriangle;
  const tone =
    result.decision === 'PASS'
      ? 'text-success'
      : result.decision === 'FAIL'
        ? 'text-destructive'
        : 'text-warning';
  const title =
    result.decision === 'PASS'
      ? 'ผ่านการตรวจเครดิตเบื้องต้น'
      : result.decision === 'FAIL'
        ? 'ไม่ผ่านการตรวจเครดิต'
        : 'ต้องให้ผู้จัดการตรวจเพิ่ม';

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-start gap-4">
          <Icon className={`size-10 ${tone} shrink-0`} />
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className={`text-lg font-semibold ${tone}`}>{title}</h3>
              <CustomerTierBadge tier={result.tier} size="md" />
            </div>
            <p className="text-sm text-muted-foreground">
              {result.isNewCustomer ? 'ลูกค้าใหม่ในระบบ' : 'พบลูกค้าเดิม'}
              {result.aiScore !== undefined && ` · คะแนน AI: ${result.aiScore}/100`}
            </p>
          </div>
        </div>

        <div className="border-t border-border pt-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            เหตุผล
          </h4>
          <ul className="space-y-1.5">
            {result.reasons.map((r, i) => (
              <li key={i} className="text-sm text-foreground flex items-start gap-2">
                <span className="text-muted-foreground mt-0.5">•</span>
                {r.message}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onCancel}>
          กลับ
        </Button>
        {result.decision !== 'FAIL' && (
          <Button variant="primary" size="lg" onClick={onProceed}>
            {result.decision === 'PASS' ? 'กรอกข้อมูลเต็ม' : 'ส่งให้ผู้จัดการ + กรอกข้อมูลเต็ม'}
          </Button>
        )}
        {result.decision === 'FAIL' && (
          <Button variant="outline" onClick={onCancel}>
            เริ่มใหม่
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/CustomerIntakePage/components/PreCheckResultStep.tsx
git commit -m "feat(customer-intake): add PreCheckResultStep

Visual result of pre-check with tier badge, AI score, reasons list,
and appropriate action button per decision (PASS / REVIEW / FAIL)."
```

---

## Task 5: FullIntakeStep (minimal v1 — phone2/email/occupation/salary/references)

**Files:**
- Create: `apps/web/src/pages/CustomerIntakePage/components/FullIntakeStep.tsx`

Note: This is a v1 — does NOT re-implement all 20+ fields of existing CustomerCreateModal. For Phase 3 we keep it minimal (required fields only) and let Phase 4 integrate with the full existing form. User can always edit more on CustomerDetailPage later.

- [ ] **Step 1: Implement**

```typescript
import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Save } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import type { FullIntakeForm } from '../types';

interface Props {
  customerId: string;
  initial: FullIntakeForm;
  onDone: () => void;
}

export default function FullIntakeStep({ customerId, initial, onDone }: Props) {
  const [form, setForm] = useState<FullIntakeForm>(initial);
  useEffect(() => setForm(initial), [initial]);

  const patch = (p: Partial<FullIntakeForm>) => setForm((prev) => ({ ...prev, ...p }));
  const patchRef = (idx: number, p: Partial<FullIntakeForm['references'][number]>) =>
    setForm((prev) => ({
      ...prev,
      references: prev.references.map((r, i) => (i === idx ? { ...r, ...p } : r)),
    }));

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name: `${form.firstName} ${form.lastName}`.trim(),
      };
      if (form.prefix) payload.prefix = form.prefix;
      if (form.nickname) payload.nickname = form.nickname;
      if (form.birthDate) payload.birthDate = new Date(form.birthDate).toISOString();
      if (form.phoneSecondary) payload.phoneSecondary = form.phoneSecondary;
      if (form.email) payload.email = form.email;
      if (form.lineId) payload.lineId = form.lineId;
      if (form.facebookLink) payload.facebookLink = form.facebookLink;
      if (form.facebookName) payload.facebookName = form.facebookName;
      if (form.occupation) payload.occupation = form.occupation;
      if (form.salary && !isNaN(parseFloat(form.salary))) payload.salary = parseFloat(form.salary);
      if (form.workplace) payload.workplace = form.workplace;
      const validRefs = form.references.filter((r) => r.firstName || r.lastName || r.phone);
      if (validRefs.length > 0) payload.references = validRefs;
      await api.patch(`/customers/${customerId}`, payload);
    },
    onSuccess: () => {
      toast.success('บันทึกข้อมูลลูกค้าสำเร็จ');
      onDone();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const canSave =
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-foreground">ข้อมูลติดต่อเพิ่มเติม</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">เบอร์โทรสำรอง</label>
            <Input value={form.phoneSecondary || ''} onChange={(e) => patch({ phoneSecondary: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">อีเมล</label>
            <Input type="email" value={form.email || ''} onChange={(e) => patch({ email: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">LINE ID</label>
            <Input value={form.lineId || ''} onChange={(e) => patch({ lineId: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Facebook</label>
            <Input value={form.facebookName || ''} onChange={(e) => patch({ facebookName: e.target.value })} placeholder="ชื่อ/ลิงก์" />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-foreground">อาชีพ</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">อาชีพ</label>
            <Input value={form.occupation || ''} onChange={(e) => patch({ occupation: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">เงินเดือน (บาท)</label>
            <Input type="number" value={form.salary || ''} onChange={(e) => patch({ salary: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-foreground mb-1">สถานที่ทำงาน</label>
            <Input value={form.workplace || ''} onChange={(e) => patch({ workplace: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-foreground">ผู้อ้างอิง (4 คน)</h3>
        {form.references.map((ref, i) => (
          <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-2 pb-3 border-b border-border last:border-0">
            <Input placeholder="ชื่อ" value={ref.firstName} onChange={(e) => patchRef(i, { firstName: e.target.value })} />
            <Input placeholder="นามสกุล" value={ref.lastName} onChange={(e) => patchRef(i, { lastName: e.target.value })} />
            <Input placeholder="เบอร์" value={ref.phone} onChange={(e) => patchRef(i, { phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
            <Input placeholder="ความสัมพันธ์" value={ref.relationship} onChange={(e) => patchRef(i, { relationship: e.target.value })} />
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="primary" size="lg" onClick={() => saveMut.mutate()} disabled={!canSave || saveMut.isPending}>
          {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          บันทึก
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/CustomerIntakePage/components/FullIntakeStep.tsx
git commit -m "feat(customer-intake): add FullIntakeStep (v1 — contact/work/refs)

Minimal version — only contact, work, references. Address + DOB skip
for v1 (keep forms short). User can edit more on CustomerDetailPage."
```

---

## Task 6: CustomerIntakePage container + route + menu

**Files:**
- Create: `apps/web/src/pages/CustomerIntakePage/index.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 1: Container page**

`apps/web/src/pages/CustomerIntakePage/index.tsx`:

```typescript
import { useNavigate } from 'react-router';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';
import { useCustomerIntake } from './hooks/useCustomerIntake';
import IntakeStepIndicator from './components/IntakeStepIndicator';
import QuickIntakeStep from './components/QuickIntakeStep';
import PreCheckResultStep from './components/PreCheckResultStep';
import FullIntakeStep from './components/FullIntakeStep';

export default function CustomerIntakePage() {
  useDocumentTitle('เช็คเครดิตลูกค้าใหม่');
  const navigate = useNavigate();
  const intake = useCustomerIntake();

  return (
    <div>
      <PageHeader
        title="เช็คเครดิตลูกค้า + รับข้อมูล"
        subtitle="scan บัตร → อัพ statement → เช็คเครดิต → กรอกข้อมูลเต็ม"
        action={
          <button
            onClick={() => navigate('/customers')}
            className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg"
          >
            ยกเลิก
          </button>
        }
      />

      <IntakeStepIndicator current={intake.state.step} />

      {intake.state.step === 'quick' && (
        <QuickIntakeStep
          form={intake.state.quickForm}
          onChange={intake.updateQuick}
          onSubmit={intake.runPreCheck}
          isSubmitting={intake.isPreChecking}
        />
      )}

      {intake.state.step === 'precheck' && intake.state.preCheckResult && (
        <PreCheckResultStep
          result={intake.state.preCheckResult}
          onProceed={intake.proceedToFull}
          onCancel={() => intake.goTo('quick')}
        />
      )}

      {intake.state.step === 'full' && intake.state.fullForm && intake.state.preCheckResult && (
        <FullIntakeStep
          customerId={intake.state.preCheckResult.customerId}
          initial={intake.state.fullForm}
          onDone={() => intake.goTo('done')}
        />
      )}

      {intake.state.step === 'done' && intake.state.preCheckResult && (
        <div className="max-w-2xl mx-auto text-center py-12 space-y-4">
          <CheckCircle2 className="size-16 text-success mx-auto" />
          <h2 className="text-xl font-semibold text-foreground">บันทึกข้อมูลเรียบร้อย</h2>
          <p className="text-sm text-muted-foreground">
            ลูกค้าพร้อมทำสัญญาแล้ว
          </p>
          <div className="flex justify-center gap-2 pt-2">
            <Button
              variant="primary"
              onClick={() =>
                navigate(`/contracts/create?customerId=${intake.state.preCheckResult!.customerId}`)
              }
            >
              สร้างสัญญาเลย
            </Button>
            <Button variant="outline" onClick={intake.reset}>
              รับลูกค้าคนต่อไป
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register route**

In `apps/web/src/App.tsx`:
1. Add lazy import (near other `const ... = lazy(...)` lines):
   ```typescript
   const CustomerIntakePage = lazy(() => import('@/pages/CustomerIntakePage'));
   ```
2. Add route inside `<Routes>`, near `/customers/:id`:
   ```tsx
   <Route path="/customer-intake" element={<ProtectedRoute><CustomerIntakePage /></ProtectedRoute>} />
   ```
   (Match the pattern of existing protected routes for the file. If routes use `<Route path="/customers" element={<CustomersPage />} />` without ProtectedRoute wrapper, follow that same pattern.)

- [ ] **Step 3: Add menu entry**

In `apps/web/src/config/menu.ts`, find the SALES and BRANCH_MANAGER "ขาย" sections (around lines 76-88 and 139-144). Add `{ label: 'เช็คเครดิตลูกค้าใหม่', path: '/customer-intake', icon: UserSearch }` after the "ลูกค้า" entry. Re-add the `UserSearch` import at top if it was removed.

- [ ] **Step 4: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/CustomerIntakePage/index.tsx apps/web/src/App.tsx apps/web/src/config/menu.ts
git commit -m "feat(customer-intake): add /customer-intake route + menu entry

Container orchestrates 4 steps. Done step offers 'สร้างสัญญาเลย'
button that links to /contracts/create?customerId=... (Phase 4
will read that param to pre-select customer)."
```

---

## Task 7: E2E smoke + PR

**Files:**
- Create: `apps/web/e2e/customer-intake.spec.ts`

- [ ] **Step 1: E2E smoke**

```typescript
import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

test.describe('Customer Intake wizard', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('loads intake page', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/customer-intake');
    if (!ok) return;
    await expect(page.getByText(/ข้อมูลเบื้องต้น/).first()).toBeVisible({ timeout: 15000 });
    expect(await hasErrorBoundary(page)).toBe(false);
  });

  test('step indicator shows 4 steps', async ({ page }) => {
    await gotoWithRetry(page, '/customer-intake');
    await expect(page.getByText('เช็คเครดิต').first()).toBeVisible();
    await expect(page.getByText('ข้อมูลเต็ม').first()).toBeVisible();
    await expect(page.getByText('เสร็จสิ้น').first()).toBeVisible();
  });
});
```

- [ ] **Step 2: Commit + push + PR**

```bash
git add apps/web/e2e/customer-intake.spec.ts
git commit -m "test(customer-intake): E2E smoke"
git push -u origin feat/customer-intake-wizard-phase3
gh pr create --base main --title "feat(customer): Intake Wizard UI (Phase 3)" --body "..."
```

---

## Self-Review

Spec coverage:
- Section 5 flow (steps 1-5) — Tasks 3-6
- Section 7 components list — all delivered
- Section 8 endpoint usage — Task 2 hook
- Section 9 UX details — step indicator, auto-fill from quick, thai labels

Types consistent. No placeholders.

Scope kept tight: FullIntakeStep is v1 minimal — does NOT re-implement address form. Phase 4 will either wire full ContractCreatePage CustomerCreateModal or extend this step.
