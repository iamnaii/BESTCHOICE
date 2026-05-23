# Insurance Wizard SP1 — IMEI UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4-step `/insurance/new` wizard with a 2-step IMEI-driven flow that auto-detects sale channel and routes "เปลี่ยนเครื่อง" appropriately.

**Architecture:** Add one new GET endpoint that looks up Product by IMEI, joins Sale + Contract, returns shape including `saleType`. Refactor frontend wizard to use this as Step 1; Step 2 stays as DefectDescriptionStep for repair, or redirects out for exchange (existing pages unchanged).

**Tech Stack:** NestJS + Prisma (backend), React + TypeScript + Vite (frontend), Jest (API tests), Vitest (web tests), Playwright (E2E).

**Spec:** [2026-05-23-insurance-wizard-sp1-imei-ux-design.md](../specs/2026-05-23-insurance-wizard-sp1-imei-ux-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/api/src/modules/repair-tickets/dto/lookup-by-imei.dto.ts` | Create | DTO for query param validation |
| `apps/api/src/modules/repair-tickets/repair-tickets.service.ts` | Modify | Add `lookupByImei()` method |
| `apps/api/src/modules/repair-tickets/repair-tickets.controller.ts` | Modify | Add `GET /lookup-by-imei` route |
| `apps/api/src/modules/repair-tickets/__tests__/lookup-by-imei.spec.ts` | Create | Service unit tests |
| `apps/web/src/pages/insurance/WizardSteps/ImeiLookupStep.tsx` | Create | Single-field input + preview card + action buttons |
| `apps/web/src/pages/insurance/CreateInsuranceWizardPage.tsx` | Modify | Reduce to 2 steps; route exchange to existing pages |
| `apps/web/src/pages/insurance/__tests__/ImeiLookupStep.test.tsx` | Create | Component unit tests |
| `apps/web/e2e/insurance-imei-wizard.spec.ts` | Create | E2E happy path |

No new modules. No schema changes. No DB migration.

---

## Task 1: Backend — IMEI lookup endpoint DTO

**Files:**
- Create: `apps/api/src/modules/repair-tickets/dto/lookup-by-imei.dto.ts`

- [ ] **Step 1.1: Create the DTO**

```ts
// apps/api/src/modules/repair-tickets/dto/lookup-by-imei.dto.ts
import { IsString, MinLength } from 'class-validator';

export class LookupByImeiDto {
  @IsString({ message: 'imei ต้องเป็น string' })
  @MinLength(4, { message: 'imei ต้องมีอย่างน้อย 4 ตัวอักษร' })
  imei!: string;
}
```

- [ ] **Step 1.2: Commit**

```bash
git add apps/api/src/modules/repair-tickets/dto/lookup-by-imei.dto.ts
git commit -m "feat(insurance): add LookupByImeiDto"
```

---

## Task 2: Backend — service method (test first)

**Files:**
- Create: `apps/api/src/modules/repair-tickets/__tests__/lookup-by-imei.spec.ts`
- Modify: `apps/api/src/modules/repair-tickets/repair-tickets.service.ts`

- [ ] **Step 2.1: Write the failing test**

```ts
// apps/api/src/modules/repair-tickets/__tests__/lookup-by-imei.spec.ts
import { Test } from '@nestjs/testing';
import { RepairTicketsService } from '../repair-tickets.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('RepairTicketsService.lookupByImei', () => {
  let service: RepairTicketsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: { findFirst: jest.fn() },
      sale: { findFirst: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        RepairTicketsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(RepairTicketsService);
  });

  it('returns { found: false } when product not in DB', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    const result = await service.lookupByImei('UNKNOWN_IMEI');
    expect(result).toEqual({ found: false });
  });

  it('returns INSTALLMENT branch when Sale.saleType=INSTALLMENT', async () => {
    const productMock = {
      id: 'prod-1', brand: 'iPhone', model: '15 Pro', storage: '256GB',
      imeiSerial: '359123456789012',
    };
    const saleMock = {
      id: 'sale-1', saleType: 'INSTALLMENT', customerId: 'cust-1',
      contractId: 'ctr-1',
      customer: { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0891234567' },
      contract: {
        id: 'ctr-1', contractNumber: 'BC-2026-04-0123', status: 'ACTIVE',
        deviceReceivedAt: new Date('2026-05-20'),
        shopWarrantyEndDate: new Date('2026-05-27'),
      },
    };
    prisma.product.findFirst.mockResolvedValue(productMock);
    prisma.sale.findFirst.mockResolvedValue(saleMock);

    const result = await service.lookupByImei('359123456789012');

    expect(result.found).toBe(true);
    expect(result.sale?.saleType).toBe('INSTALLMENT');
    expect(result.contract?.contractNumber).toBe('BC-2026-04-0123');
    expect(result.customer?.name).toBe('สมชาย ใจดี');
    expect(result.product?.id).toBe('prod-1');
  });

  it('returns CASH branch with no contract', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'prod-2', brand: 'Samsung', model: 'S24', storage: '128GB',
      imeiSerial: '359000111222333',
    });
    prisma.sale.findFirst.mockResolvedValue({
      id: 'sale-2', saleType: 'CASH', customerId: 'cust-2', contractId: null,
      customer: { id: 'cust-2', name: 'สมหญิง', phone: '0812345678' },
      contract: null,
    });

    const result = await service.lookupByImei('359000111222333');

    expect(result.sale?.saleType).toBe('CASH');
    expect(result.contract).toBeNull();
  });

  it('treats missing Sale record as EXTERNAL_FINANCE (block exchange path)', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'prod-3', imeiSerial: 'X' });
    prisma.sale.findFirst.mockResolvedValue(null);

    const result = await service.lookupByImei('X');

    expect(result.found).toBe(true);
    expect(result.sale).toBeNull();
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
cd apps/api && npx jest src/modules/repair-tickets/__tests__/lookup-by-imei.spec.ts -v
```

Expected: FAIL with `service.lookupByImei is not a function`.

- [ ] **Step 2.3: Implement the service method**

Add this method to `apps/api/src/modules/repair-tickets/repair-tickets.service.ts` (near `warrantyLookup`):

```ts
async lookupByImei(imei: string) {
  const product = await this.prisma.product.findFirst({
    where: { imeiSerial: imei, deletedAt: null },
    select: {
      id: true, brand: true, model: true, storage: true,
      imeiSerial: true, category: true,
    },
  });

  if (!product) return { found: false } as const;

  // Find the latest non-deleted Sale for this product
  const sale = await this.prisma.sale.findFirst({
    where: { productId: product.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      saleType: true,
      customer: { select: { id: true, name: true, phone: true } },
      contract: {
        select: {
          id: true, contractNumber: true, status: true,
          deviceReceivedAt: true, shopWarrantyEndDate: true,
        },
      },
    },
  });

  // Compute warranty status (reuse logic style from DefectExchangePage eligibility)
  const warrantyStatus = this.computeWarrantyStatus(sale?.contract);

  return {
    found: true,
    product,
    sale: sale
      ? { id: sale.id, saleType: sale.saleType }
      : null,
    customer: sale?.customer ?? null,
    contract: sale?.contract
      ? {
          id: sale.contract.id,
          contractNumber: sale.contract.contractNumber,
          status: sale.contract.status,
        }
      : null,
    warrantyStatus,
    daysRemainingIn7Day: this.computeDaysRemainingIn7Day(sale?.contract),
  } as const;
}

private computeWarrantyStatus(contract: any): string | null {
  if (!contract?.deviceReceivedAt) return null;
  const now = new Date();
  const received = new Date(contract.deviceReceivedAt);
  const sevenDayEnd = new Date(received.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (now <= sevenDayEnd) return 'IN_7DAY_DEFECT';
  if (contract.shopWarrantyEndDate && now <= new Date(contract.shopWarrantyEndDate)) {
    return 'IN_SHOP_WARRANTY';
  }
  return 'OUT_OF_WARRANTY';
}

private computeDaysRemainingIn7Day(contract: any): number | null {
  if (!contract?.deviceReceivedAt) return null;
  const now = new Date();
  const sevenDayEnd = new Date(
    new Date(contract.deviceReceivedAt).getTime() + 7 * 24 * 60 * 60 * 1000,
  );
  const diffMs = sevenDayEnd.getTime() - now.getTime();
  if (diffMs < 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
cd apps/api && npx jest src/modules/repair-tickets/__tests__/lookup-by-imei.spec.ts -v
```

Expected: PASS all 4 tests.

- [ ] **Step 2.5: Commit**

```bash
git add apps/api/src/modules/repair-tickets/repair-tickets.service.ts apps/api/src/modules/repair-tickets/__tests__/lookup-by-imei.spec.ts
git commit -m "feat(insurance): RepairTicketsService.lookupByImei"
```

---

## Task 3: Backend — controller endpoint

**Files:**
- Modify: `apps/api/src/modules/repair-tickets/repair-tickets.controller.ts`

- [ ] **Step 3.1: Add the endpoint**

Locate the controller's `warranty-lookup` block. Add immediately below it:

```ts
@Get('lookup-by-imei')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
lookupByImei(@Query() dto: LookupByImeiDto) {
  return this.svc.lookupByImei(dto.imei);
}
```

Also add import at the top:
```ts
import { LookupByImeiDto } from './dto/lookup-by-imei.dto';
```

- [ ] **Step 3.2: Verify build**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3.3: Smoke test endpoint locally**

```bash
cd apps/api && npm run dev
```

In another terminal:
```bash
curl -s "http://localhost:3000/api/repair-tickets/lookup-by-imei?imei=DOES_NOT_EXIST" \
  -H "Cookie: $(...session cookie...)"
```

Expected: `{"found":false}` (401 without auth — that's also acceptable; the point is the endpoint exists).

- [ ] **Step 3.4: Commit**

```bash
git add apps/api/src/modules/repair-tickets/repair-tickets.controller.ts
git commit -m "feat(insurance): expose GET /repair-tickets/lookup-by-imei"
```

---

## Task 4: Frontend — ImeiLookupStep component

**Files:**
- Create: `apps/web/src/pages/insurance/WizardSteps/ImeiLookupStep.tsx`

- [ ] **Step 4.1: Create the component**

```tsx
// apps/web/src/pages/insurance/WizardSteps/ImeiLookupStep.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Lock, ShieldCheck, Wrench, ArrowLeftRight, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type LookupResult =
  | { found: false }
  | {
      found: true;
      product: { id: string; brand: string; model: string; storage: string | null; imeiSerial: string };
      sale: { id: string; saleType: 'CASH' | 'INSTALLMENT' | 'EXTERNAL_FINANCE' } | null;
      customer: { id: string; name: string; phone: string } | null;
      contract: { id: string; contractNumber: string; status: string } | null;
      warrantyStatus: string | null;
      daysRemainingIn7Day: number | null;
    };

export interface ImeiLookupStepProps {
  onRepairChosen: (result: Extract<LookupResult, { found: true }>) => void;
  presetImei?: string;
}

export function ImeiLookupStep({ onRepairChosen, presetImei }: ImeiLookupStepProps) {
  const [imei, setImei] = useState(presetImei ?? '');
  const [result, setResult] = useState<LookupResult | null>(null);
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: async (q: string) => {
      const { data } = await api.get<LookupResult>('/repair-tickets/lookup-by-imei', {
        params: { imei: q },
      });
      return data;
    },
    onSuccess: (data) => setResult(data),
    onError: () => toast.error('ค้นหาไม่สำเร็จ ลองอีกครั้ง'),
  });

  const handleLookup = () => {
    if (imei.trim().length < 4) {
      toast.error('IMEI ต้องอย่างน้อย 4 ตัวอักษร');
      return;
    }
    mutation.mutate(imei.trim());
  };

  const handleExchange = () => {
    if (!result || !result.found || !result.sale) return;
    if (result.sale.saleType === 'CASH') {
      navigate(`/trade-in/new?customerId=${result.customer?.id}&productId=${result.product.id}`);
    } else if (result.sale.saleType === 'INSTALLMENT' && result.contract) {
      navigate(`/defect-exchange?contractId=${result.contract.id}`);
    }
    // EXTERNAL_FINANCE handled by disabled button
  };

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-2">
        <ScanLine className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold leading-snug">สแกน IMEI / Serial</h2>
      </div>
      <div className="flex gap-2">
        <Input
          value={imei}
          onChange={(e) => setImei(e.target.value)}
          placeholder="359123456789012"
          className="font-mono"
          onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
        />
        <Button onClick={handleLookup} disabled={mutation.isPending}>
          {mutation.isPending ? 'กำลังค้น…' : 'ค้นหา'}
        </Button>
      </div>

      {result && !result.found && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 p-6 text-center">
          <Lock className="size-8 mx-auto mb-2 text-destructive" />
          <p className="font-medium text-destructive">ไม่พบเครื่องในระบบ</p>
          <p className="text-sm text-muted-foreground mt-1">
            เครื่องนี้ไม่ได้ขายจากร้าน — รับซ่อมเฉพาะเครื่องที่ขายจาก BESTCHOICE
          </p>
        </div>
      )}

      {result && result.found && (
        <>
          <PreviewCard result={result} />
          <ActionButtons
            result={result}
            onRepair={() => onRepairChosen(result)}
            onExchange={handleExchange}
          />
        </>
      )}
    </Card>
  );
}

function PreviewCard({ result }: { result: Extract<LookupResult, { found: true }> }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-3">
      <Field label="ลูกค้า" value={result.customer?.name ?? '—'} subvalue={result.customer?.phone} />
      <Field
        label="สัญญา"
        value={result.contract?.contractNumber ?? '—'}
        subvalue={result.contract?.status}
      />
      <Field
        label="เครื่อง"
        value={`${result.product.brand} ${result.product.model}`}
        subvalue={`${result.product.storage ?? ''} · ${result.product.imeiSerial}`}
      />
      <Field
        label="ประกัน"
        value={warrantyLabel(result.warrantyStatus)}
        subvalue={
          result.daysRemainingIn7Day != null
            ? `เหลือ ${result.daysRemainingIn7Day} วัน (ประกันร้าน 7 วัน)`
            : undefined
        }
      />
      <Field
        label="ช่องทาง"
        value={channelLabel(result.sale?.saleType)}
        subvalue={channelSubtitle(result.sale?.saleType)}
      />
    </div>
  );
}

function Field({ label, value, subvalue }: { label: string; value: string; subvalue?: string | null }) {
  return (
    <div className="rounded-md bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium leading-snug">{value}</div>
      {subvalue && <div className="text-xs text-muted-foreground leading-snug mt-0.5">{subvalue}</div>}
    </div>
  );
}

function ActionButtons({
  result,
  onRepair,
  onExchange,
}: {
  result: Extract<LookupResult, { found: true }>;
  onRepair: () => void;
  onExchange: () => void;
}) {
  const exchangeDisabled =
    !result.sale ||
    result.sale.saleType === 'EXTERNAL_FINANCE';

  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      <Button onClick={onRepair} className="flex items-center gap-2">
        <Wrench className="size-4" /> รับเข้าซ่อม
      </Button>
      <Button
        variant="outline"
        onClick={onExchange}
        disabled={exchangeDisabled}
        title={exchangeDisabled ? 'ผ่อนกับ GFIN — ติดต่อ GFIN เพื่อปิดสัญญาก่อน' : undefined}
        className="flex items-center gap-2"
      >
        <ArrowLeftRight className="size-4" /> เปลี่ยนเครื่อง
      </Button>
    </div>
  );
}

function warrantyLabel(status: string | null): string {
  switch (status) {
    case 'IN_7DAY_DEFECT': return 'ประกันร้าน 7 วัน';
    case 'IN_SHOP_WARRANTY': return 'ประกันร้าน';
    case 'IN_MANUFACTURER': return 'ประกันโรงงาน';
    case 'OUT_OF_WARRANTY': return 'หมดประกัน';
    default: return '—';
  }
}

function channelLabel(saleType?: string | null): string {
  switch (saleType) {
    case 'CASH': return 'ซื้อสด';
    case 'INSTALLMENT': return 'BC FINANCE';
    case 'EXTERNAL_FINANCE': return 'GFIN';
    default: return 'ไม่ระบุ';
  }
}

function channelSubtitle(saleType?: string | null): string | undefined {
  if (saleType === 'EXTERNAL_FINANCE') return 'ผ่อนภายนอก — exchange ไม่ได้';
  return undefined;
}
```

- [ ] **Step 4.2: Verify build**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors related to the new file.

- [ ] **Step 4.3: Commit**

```bash
git add apps/web/src/pages/insurance/WizardSteps/ImeiLookupStep.tsx
git commit -m "feat(insurance): add ImeiLookupStep component"
```

---

## Task 5: Frontend — refactor wizard to 2-step

**Files:**
- Modify: `apps/web/src/pages/insurance/CreateInsuranceWizardPage.tsx`

- [ ] **Step 5.1: Replace wizard body**

Open the file and replace its `Render` section's step routing. Keep the existing imports, walk-in customer creation, and DefectDescriptionStep. Simplify to:

```tsx
// Inside CreateInsuranceWizardPage, replace step routing:
const [imeiResult, setImeiResult] = useState<
  Parameters<ImeiLookupStepProps['onRepairChosen']>[0] | null
>(null);

// Render
return (
  <div className="space-y-4 p-4 md:p-6 max-w-3xl">
    <PageHeader
      title="รับเครื่องเข้าซ่อม"
      action={
        <Button variant="ghost" onClick={() => navigate('/insurance')} size="sm">
          <ArrowLeft className="size-4 mr-1" /> กลับ
        </Button>
      }
    />

    {!imeiResult && (
      <ImeiLookupStep onRepairChosen={setImeiResult} presetImei={undefined} />
    )}

    {imeiResult && (
      <DefectDescriptionStep
        wizardState={{
          customerId: imeiResult.customer?.id,
          customerName: imeiResult.customer?.name,
          customerPhone: imeiResult.customer?.phone,
          contractId: imeiResult.contract?.id,
          productId: imeiResult.product.id,
          deviceBrand: imeiResult.product.brand,
          deviceModel: imeiResult.product.model,
          deviceImei: imeiResult.product.imeiSerial,
        }}
        defaultPayer={derivePayer(imeiResult.warrantyStatus)}
        onBack={() => setImeiResult(null)}
      />
    )}
  </div>
);

function derivePayer(status: string | null): 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM' {
  if (status === 'IN_7DAY_DEFECT' || status === 'IN_SHOP_WARRANTY') return 'SHOP';
  if (status === 'IN_MANUFACTURER') return 'SUPPLIER_CLAIM';
  return 'CUSTOMER';
}
```

Add import at top of file:
```tsx
import { ImeiLookupStep, type ImeiLookupStepProps } from './WizardSteps/ImeiLookupStep';
```

Remove old step routing (CustomerPickerStep / DevicePickerStep / WarrantyPreviewStep / ExchangeProductPickerStep — keep imports but they no longer render). Mark them with `// SP1: retained for SP2 reuse — not in active flow` comment.

- [ ] **Step 5.2: Handle preset URL params (from WarrantyCheckPage etc.)**

If `presetContractId` or `presetCustomerId` already in URL, skip the IMEI input by fetching the lookup result first. Add this useEffect inside the page component:

```tsx
useEffect(() => {
  // If preset IDs supplied (from WarrantyCheckPage / external link), do an
  // implicit lookup to populate the preview without manual IMEI entry.
  if (presetContractId && !imeiResult) {
    api.get(`/contracts/${presetContractId}`).then(({ data }) => {
      const ctr = data;
      if (ctr?.product?.imeiSerial) {
        api.get('/repair-tickets/lookup-by-imei', { params: { imei: ctr.product.imeiSerial } })
          .then(({ data: lookup }) => {
            if (lookup.found) setImeiResult(lookup);
          });
      }
    });
  }
}, [presetContractId, imeiResult]);
```

- [ ] **Step 5.3: Type-check + verify**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5.4: Commit**

```bash
git add apps/web/src/pages/insurance/CreateInsuranceWizardPage.tsx
git commit -m "feat(insurance): refactor wizard to 2-step IMEI-driven flow"
```

---

## Task 6: Frontend — component unit tests

**Files:**
- Create: `apps/web/src/pages/insurance/__tests__/ImeiLookupStep.test.tsx`

- [ ] **Step 6.1: Write tests**

```tsx
// apps/web/src/pages/insurance/__tests__/ImeiLookupStep.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ImeiLookupStep } from '../WizardSteps/ImeiLookupStep';
import api from '@/lib/api';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function renderWith(props: Partial<React.ComponentProps<typeof ImeiLookupStep>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onRepairChosen = vi.fn();
  return {
    onRepairChosen,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ImeiLookupStep onRepairChosen={onRepairChosen} {...props} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe('ImeiLookupStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks lookup when IMEI < 4 chars', async () => {
    renderWith();
    fireEvent.change(screen.getByPlaceholderText(/359/), { target: { value: 'abc' } });
    fireEvent.click(screen.getByText('ค้นหา'));
    await waitFor(() => expect(api.get).not.toHaveBeenCalled());
  });

  it('shows block message when IMEI not found', async () => {
    (api.get as any).mockResolvedValue({ data: { found: false } });
    renderWith();
    fireEvent.change(screen.getByPlaceholderText(/359/), { target: { value: '999999' } });
    fireEvent.click(screen.getByText('ค้นหา'));
    expect(await screen.findByText(/ไม่พบเครื่องในระบบ/)).toBeInTheDocument();
  });

  it('shows preview + active buttons when CASH sale found', async () => {
    (api.get as any).mockResolvedValue({
      data: {
        found: true,
        product: { id: 'p1', brand: 'iPhone', model: '15', storage: '256GB', imeiSerial: '123456' },
        sale: { id: 's1', saleType: 'CASH' },
        customer: { id: 'c1', name: 'สมชาย', phone: '0800000000' },
        contract: null,
        warrantyStatus: 'OUT_OF_WARRANTY',
        daysRemainingIn7Day: null,
      },
    });
    renderWith();
    fireEvent.change(screen.getByPlaceholderText(/359/), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('ค้นหา'));
    expect(await screen.findByText('สมชาย')).toBeInTheDocument();
    expect(screen.getByText('ซื้อสด')).toBeInTheDocument();
    expect(screen.getByText('เปลี่ยนเครื่อง').closest('button')).not.toBeDisabled();
  });

  it('disables เปลี่ยนเครื่อง for GFIN (EXTERNAL_FINANCE)', async () => {
    (api.get as any).mockResolvedValue({
      data: {
        found: true,
        product: { id: 'p1', brand: 'X', model: 'Y', storage: null, imeiSerial: '999' },
        sale: { id: 's1', saleType: 'EXTERNAL_FINANCE' },
        customer: null,
        contract: null,
        warrantyStatus: null,
        daysRemainingIn7Day: null,
      },
    });
    renderWith();
    fireEvent.change(screen.getByPlaceholderText(/359/), { target: { value: '999' } });
    fireEvent.click(screen.getByText('ค้นหา'));
    await screen.findByText('GFIN');
    expect(screen.getByText('เปลี่ยนเครื่อง').closest('button')).toBeDisabled();
  });

  it('calls onRepairChosen when repair button clicked', async () => {
    (api.get as any).mockResolvedValue({
      data: {
        found: true,
        product: { id: 'p1', brand: 'X', model: 'Y', storage: null, imeiSerial: '12345' },
        sale: { id: 's1', saleType: 'INSTALLMENT' },
        customer: { id: 'c1', name: 'A', phone: '0' },
        contract: { id: 'ctr', contractNumber: 'BC-1', status: 'ACTIVE' },
        warrantyStatus: 'IN_7DAY_DEFECT',
        daysRemainingIn7Day: 5,
      },
    });
    const { onRepairChosen } = renderWith();
    fireEvent.change(screen.getByPlaceholderText(/359/), { target: { value: '12345' } });
    fireEvent.click(screen.getByText('ค้นหา'));
    await screen.findByText('BC-1');
    fireEvent.click(screen.getByText('รับเข้าซ่อม'));
    expect(onRepairChosen).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 6.2: Run tests**

```bash
cd apps/web && npx vitest run src/pages/insurance/__tests__/ImeiLookupStep.test.tsx
```

Expected: 5 PASS.

- [ ] **Step 6.3: Commit**

```bash
git add apps/web/src/pages/insurance/__tests__/ImeiLookupStep.test.tsx
git commit -m "test(insurance): ImeiLookupStep component tests"
```

---

## Task 7: E2E happy path

**Files:**
- Create: `apps/web/e2e/insurance-imei-wizard.spec.ts`

- [ ] **Step 7.1: Write the E2E test**

```ts
// apps/web/e2e/insurance-imei-wizard.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Insurance wizard — IMEI-driven flow (SP1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name="email"]', 'manager.ladprao@bestchoice.com');
    await page.fill('[name="password"]', 'admin1234');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(dashboard|finance-portfolio)/);
  });

  test('block message when IMEI not in DB', async ({ page }) => {
    await page.goto('/insurance/new');
    await page.fill('input[placeholder*="359"]', 'NOT_A_REAL_IMEI_999');
    await page.click('button:has-text("ค้นหา")');
    await expect(page.locator('text=ไม่พบเครื่องในระบบ')).toBeVisible();
  });

  test('found IMEI shows preview + active buttons', async ({ page }) => {
    // Assumes seed data has at least one device sold via Sale with IMEI present
    // Skip if no seed — get the IMEI from the contracts list
    await page.goto('/contracts');
    const firstImei = await page.locator('[data-imei]').first().getAttribute('data-imei');
    test.skip(!firstImei, 'No seed IMEI to test against');

    await page.goto('/insurance/new');
    await page.fill('input[placeholder*="359"]', firstImei!);
    await page.click('button:has-text("ค้นหา")');
    await expect(page.locator('button:has-text("รับเข้าซ่อม")')).toBeEnabled();
  });
});
```

- [ ] **Step 7.2: Run E2E locally**

```bash
cd apps/web && npx playwright test e2e/insurance-imei-wizard.spec.ts --headed
```

Expected: 2 PASS (or skip the second if no seed data).

- [ ] **Step 7.3: Commit**

```bash
git add apps/web/e2e/insurance-imei-wizard.spec.ts
git commit -m "test(e2e): IMEI wizard happy path"
```

---

## Task 8: Verify backwards compatibility

- [ ] **Step 8.1: Verify `/defect-exchange` redirect still works**

```bash
cd apps/web && npm run dev
```

In browser: open http://localhost:5173/defect-exchange?contractId=ANY_ID — should redirect to `/insurance/new?intent=exchange&contractId=…`. With the new wizard, this routes to the IMEI lookup preset path (Task 5 Step 5.2).

- [ ] **Step 8.2: Verify WarrantyCheckPage shortcut**

In browser: open http://localhost:5173/insurance/warranty-check → enter a known IMEI → click ลัด → wizard pre-fills.

- [ ] **Step 8.3: Run all checks**

```bash
./tools/check-types.sh all
cd apps/api && npx jest src/modules/repair-tickets/__tests__/lookup-by-imei.spec.ts
cd apps/web && npx vitest run src/pages/insurance/__tests__/ImeiLookupStep.test.tsx
```

Expected: all green.

- [ ] **Step 8.4: Bump web version**

```bash
# apps/web/package.json: 26.5.17 → 26.5.18
```

- [ ] **Step 8.5: Commit + push + PR**

```bash
git add apps/web/package.json
git commit -m "chore: bump web version 26.5.17 → 26.5.18"
git push -u origin <branch>
gh pr create --title "feat(insurance): IMEI-driven wizard (SP1)" --body "..."
```

---

## Self-Review Notes

- [x] Spec coverage: every spec section traceable to a task
- [x] No placeholders ("TODO", "TBD") in plan
- [x] Types consistent: `LookupResult` shape used by both component + tests + service response
- [x] Service method `lookupByImei` returns same shape mocked in tests
- [x] DefectDescriptionStep `wizardState` type matches its existing interface (verified in spec)
- [x] All 5 sale-type branches handled: CASH, INSTALLMENT, EXTERNAL_FINANCE, null Sale, no Product

## Out of scope (defer to SP2)

- Case 8 JE chain (separate plan)
- ContractExchangeRequest table + approval queue
- Device condition photo upload
- Buyback price form with ±20% variance
