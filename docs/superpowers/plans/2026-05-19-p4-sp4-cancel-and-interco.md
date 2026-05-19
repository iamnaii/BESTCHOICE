# P4-SP4: ยกเลิกสัญญา + Inter-co Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Build (a) contract cancellation page with JE reversal flow and (b) Inter-co receivable report showing FINANCE ↔ SHOP balances.

**Architecture:** Cancellation = new approval workflow on Contract (DRAFT → CANCEL_PENDING → CANCELED). On approval, post `ContractCancellationTemplate` JE that reverses `ContractActivation1A` lines. Inter-co Report aggregates JournalLine where accountCode in (`21-1101`, `21-1102`) — FINANCE's payable to SHOP (down-payment relay + commission).

**Tech Stack:** React 18 + TypeScript + NestJS + Prisma + existing JE template framework

**Dependency:** Wait for P4-SP1 to ship `getGeneralJournal` + `getGeneralLedger` — Inter-co report deep-links to them.

---

## File Structure

**Backend:**
- Modify: `apps/api/prisma/schema.prisma` — add `CANCEL_PENDING`, `CANCELED` to `ContractStatus` enum (or use existing); add `ContractCancellation` table
- Create: `apps/api/prisma/migrations/<ts>_contract_cancellation/migration.sql`
- Create: `apps/api/src/modules/journal/cpa-templates/contract-cancellation.template.ts`
- Modify: `apps/api/src/modules/contracts/contracts.service.ts` — `requestCancellation`, `approveCancellation`, `rejectCancellation`
- Modify: `apps/api/src/modules/contracts/contracts.controller.ts` — 3 endpoints
- Create: `apps/api/src/modules/accounting/intercompany-report.service.ts`
- Modify: `apps/api/src/modules/accounting/accounting.controller.ts` — add `/inter-co/report` endpoint

**Frontend:**
- Create: `apps/web/src/pages/finance/ContractCancellationPage.tsx`
- Create: `apps/web/src/pages/finance/IntercompanyReportPage.tsx`

---

## Task 1: Schema — ContractCancellation table

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1.1: Add new model + enum value**

```prisma
enum ContractCancellationStatus {
  PENDING
  APPROVED
  REJECTED
}

model ContractCancellation {
  id                     String   @id @default(uuid())
  contractId             String
  contract               Contract @relation(fields: [contractId], references: [id])
  requestedById          String
  requestedBy            User     @relation("CancellationRequester", fields: [requestedById], references: [id])
  reason                 String
  refundAmount           Decimal  @db.Decimal(12, 2)
  status                 ContractCancellationStatus @default(PENDING)
  approvedById           String?
  approvedBy             User?    @relation("CancellationApprover", fields: [approvedById], references: [id])
  approvedAt             DateTime?
  reversalJournalEntryId String?  @unique
  reversalJournalEntry   JournalEntry? @relation("CancellationReversal", fields: [reversalJournalEntryId], references: [id])
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  deletedAt              DateTime?

  @@index([contractId])
  @@index([status])
}
```

Add inverse relations in `Contract`, `User`, `JournalEntry` models.

- [ ] **Step 1.2: Generate + apply migration**

```bash
cd apps/api && npx prisma migrate dev --name contract_cancellation
```

- [ ] **Step 1.3: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(p4-sp4): ContractCancellation model + migration"
```

---

## Task 2: JE Template — ContractCancellationTemplate

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/contract-cancellation.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/contract-cancellation.template.spec.ts`

- [ ] **Step 2.1: Write failing test (reversal balance check)**

```typescript
import { ContractCancellationTemplate } from './contract-cancellation.template';

describe('ContractCancellationTemplate', () => {
  it('produces balanced JE that reverses ContractActivation1A', () => {
    const tmpl = new ContractCancellationTemplate();
    const lines = tmpl.build({
      contractId: 'c1',
      originalActivation: {
        grossReceivable: 18190,    // 11-2101 was debited
        shopVendorPayable: 15000,  // 21-1101 was credited
        shopCommissionPayable: 1000, // 21-1102 was credited
        deferredVat: 1190,         // 21-2102 was credited
        unearnedInterest: 1000,    // 11-2106 was credited
      },
      refundAmount: 0,
    });
    const totalDr = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
    const totalCr = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
    expect(Math.abs(totalDr - totalCr)).toBeLessThan(0.01);
    expect(lines.find((l) => l.accountCode === '11-2101')?.credit).toBeCloseTo(18190);
    expect(lines.find((l) => l.accountCode === '21-1101')?.debit).toBeCloseTo(15000);
  });
});
```

- [ ] **Step 2.2: Implement template**

```typescript
import { JournalTemplateBase, BuiltJournalLine } from './base';

export interface CancellationInput {
  contractId: string;
  originalActivation: {
    grossReceivable: number;
    shopVendorPayable: number;
    shopCommissionPayable: number;
    deferredVat: number;
    unearnedInterest: number;
  };
  refundAmount: number;
}

export class ContractCancellationTemplate extends JournalTemplateBase {
  build(input: CancellationInput): BuiltJournalLine[] {
    const { originalActivation: o, refundAmount } = input;
    const lines: BuiltJournalLine[] = [];

    // Reverse the activation entry (Dr was 11-2101, now Cr it)
    lines.push({ accountCode: '21-1101', accountName: 'เจ้าหนี้-หน้าร้าน (ยอดจัด)', debit: o.shopVendorPayable, credit: 0, description: 'ยกเลิกสัญญา — กลับรายการ' });
    lines.push({ accountCode: '21-1102', accountName: 'เจ้าหนี้ค่าคอม-หน้าร้าน', debit: o.shopCommissionPayable, credit: 0, description: 'ยกเลิกสัญญา — กลับรายการ' });
    lines.push({ accountCode: '21-2102', accountName: 'ภาษีขายรอเรียกเก็บ (VAT Deferred)', debit: o.deferredVat, credit: 0, description: 'ยกเลิกสัญญา — กลับรายการ VAT รอเรียกเก็บ' });
    lines.push({ accountCode: '11-2106', accountName: 'รายได้รอตัดบัญชี-ดอกเบี้ย', debit: o.unearnedInterest, credit: 0, description: 'ยกเลิกสัญญา — กลับรายการ' });
    lines.push({ accountCode: '11-2101', accountName: 'ลูกหนี้ผ่อนชำระ', debit: 0, credit: o.grossReceivable, description: 'ยกเลิกสัญญา — กลับรายการ' });

    // If refund > 0, customer is owed back. Pull from cash.
    if (refundAmount > 0) {
      lines.push({ accountCode: '52-1106', accountName: 'ส่วนลดดอกเบี้ย/ยกเลิก', debit: refundAmount, credit: 0, description: 'ค่าใช้จ่ายจากการยกเลิก' });
      lines.push({ accountCode: '11-1201', accountName: 'ธนาคาร KBank', debit: 0, credit: refundAmount, description: 'คืนเงินลูกค้า' });
    }

    return lines;
  }
}
```

- [ ] **Step 2.3: Run + commit**

```bash
cd apps/api && npx jest contract-cancellation.template.spec
git add apps/api/src/modules/journal/cpa-templates/contract-cancellation.template{,.spec}.ts
git commit -m "feat(p4-sp4): ContractCancellationTemplate — reversal JE template"
```

---

## Task 3: Backend — Contracts service: request/approve/reject cancellation

**Files:**
- Modify: `apps/api/src/modules/contracts/contracts.service.ts`
- Modify: `apps/api/src/modules/contracts/contracts.controller.ts`

- [ ] **Step 3.1: Add 3 service methods**

```typescript
async requestCancellation(contractId: string, userId: string, reason: string, refundAmount: number) {
  const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new NotFoundException('ไม่พบสัญญา');
  if (contract.status === 'CANCELED') throw new BadRequestException('สัญญานี้ถูกยกเลิกแล้ว');

  const existing = await this.prisma.contractCancellation.findFirst({
    where: { contractId, status: 'PENDING', deletedAt: null },
  });
  if (existing) throw new ConflictException('มีคำขอยกเลิกที่ยังรอการอนุมัติอยู่');

  return this.prisma.contractCancellation.create({
    data: { contractId, requestedById: userId, reason, refundAmount, status: 'PENDING' },
  });
}

async approveCancellation(cancellationId: string, approverId: string) {
  return this.prisma.$transaction(async (tx) => {
    const c = await tx.contractCancellation.findUnique({ where: { id: cancellationId }, include: { contract: { include: { activationJournalEntry: { include: { lines: true } } } } } });
    if (!c) throw new NotFoundException();
    if (c.status !== 'PENDING') throw new BadRequestException('คำขอนี้ถูกประมวลผลแล้ว');

    const activation = c.contract.activationJournalEntry;
    if (!activation) throw new BadRequestException('ไม่พบ JE การเปิดสัญญา');

    const originalActivation = {
      grossReceivable: Number(activation.lines.find((l) => l.accountCode === '11-2101')?.debitAmount ?? 0),
      shopVendorPayable: Number(activation.lines.find((l) => l.accountCode === '21-1101')?.creditAmount ?? 0),
      shopCommissionPayable: Number(activation.lines.find((l) => l.accountCode === '21-1102')?.creditAmount ?? 0),
      deferredVat: Number(activation.lines.find((l) => l.accountCode === '21-2102')?.creditAmount ?? 0),
      unearnedInterest: Number(activation.lines.find((l) => l.accountCode === '11-2106')?.creditAmount ?? 0),
    };

    const tmpl = new ContractCancellationTemplate();
    const lines = tmpl.build({ contractId: c.contractId, originalActivation, refundAmount: Number(c.refundAmount) });
    const je = await this.journalService.postJournalEntry({
      lines,
      sourceType: 'CONTRACT_CANCELLATION',
      sourceId: c.contractId,
      description: `ยกเลิกสัญญา ${c.contract.contractNumber} — ${c.reason}`,
    }, tx);

    await tx.contractCancellation.update({
      where: { id: cancellationId },
      data: { status: 'APPROVED', approvedById: approverId, approvedAt: new Date(), reversalJournalEntryId: je.id },
    });
    await tx.contract.update({ where: { id: c.contractId }, data: { status: 'CANCELED', canceledAt: new Date() } });

    await this.auditService.log({ userId: approverId, action: 'CONTRACT_CANCELED', entity: 'contract', entityId: c.contractId, newValue: { cancellationId, refundAmount: c.refundAmount } });
    return { ok: true, journalEntryId: je.id };
  });
}

async rejectCancellation(cancellationId: string, approverId: string, reason: string) {
  return this.prisma.contractCancellation.update({
    where: { id: cancellationId },
    data: { status: 'REJECTED', approvedById: approverId, approvedAt: new Date() },
  });
}

async listPendingCancellations() {
  return this.prisma.contractCancellation.findMany({
    where: { status: 'PENDING', deletedAt: null },
    include: { contract: { include: { customer: true } }, requestedBy: true },
    orderBy: { createdAt: 'desc' },
  });
}
```

- [ ] **Step 3.2: Add 4 controller endpoints**

```typescript
@Post(':id/request-cancellation')
@Roles('OWNER', 'FINANCE_MANAGER', 'SALES')
requestCancellation(@Param('id') id: string, @Body() dto: { reason: string; refundAmount: number }, @CurrentUser() user: User) {
  return this.service.requestCancellation(id, user.id, dto.reason, dto.refundAmount);
}

@Post('cancellations/:id/approve')
@Roles('OWNER', 'FINANCE_MANAGER')
approveCancellation(@Param('id') id: string, @CurrentUser() user: User) {
  return this.service.approveCancellation(id, user.id);
}

@Post('cancellations/:id/reject')
@Roles('OWNER', 'FINANCE_MANAGER')
rejectCancellation(@Param('id') id: string, @Body() dto: { reason: string }, @CurrentUser() user: User) {
  return this.service.rejectCancellation(id, user.id, dto.reason);
}

@Get('cancellations/pending')
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
listPendingCancellations() {
  return this.service.listPendingCancellations();
}
```

- [ ] **Step 3.3: Commit**

```bash
git add apps/api/src/modules/contracts
git commit -m "feat(p4-sp4): contracts service — request/approve/reject cancellation"
```

---

## Task 4: Frontend — ContractCancellationPage

**Files:**
- Create: `apps/web/src/pages/finance/ContractCancellationPage.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/config/menu.ts`

- [ ] **Step 4.1: Create page**

```tsx
// apps/web/src/pages/finance/ContractCancellationPage.tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Lock, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Link } from 'react-router';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useState } from 'react';
import { formatTHB, formatDateMedium } from '@/utils/formatters';

interface PendingCancellation {
  id: string;
  contractId: string;
  contract: { contractNumber: string; customer: { firstName: string; lastName: string } };
  requestedBy: { firstName: string; lastName: string };
  reason: string;
  refundAmount: number;
  createdAt: string;
}

export default function ContractCancellationPage() {
  const qc = useQueryClient();
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);

  const query = useQuery({
    queryKey: ['cancellations-pending'],
    queryFn: () => api.get<PendingCancellation[]>('/contracts/cancellations/pending').then((r) => r.data),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/contracts/cancellations/${id}/approve`),
    onSuccess: () => { toast.success('อนุมัติยกเลิกสัญญาสำเร็จ — JE reversal บันทึกแล้ว'); qc.invalidateQueries({ queryKey: ['cancellations-pending'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'อนุมัติล้มเหลว'),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/contracts/cancellations/${id}/reject`, { reason }),
    onSuccess: () => { toast.success('ปฏิเสธคำขอยกเลิก'); qc.invalidateQueries({ queryKey: ['cancellations-pending'] }); },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="เอกสารยกเลิกสัญญา" icon={Lock} />
      <Card>
        <CardContent>
          <QueryBoundary query={query}>
            {(items) => items.length === 0 ? (
              <div className="text-center text-muted-foreground py-12">ไม่มีคำขอรอการอนุมัติ</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>วันที่ขอ</TableHead>
                    <TableHead>สัญญา</TableHead>
                    <TableHead>ลูกค้า</TableHead>
                    <TableHead>ผู้ขอ</TableHead>
                    <TableHead>เหตุผล</TableHead>
                    <TableHead className="text-right">คืนเงิน</TableHead>
                    <TableHead className="text-right">การกระทำ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{formatDateMedium(c.createdAt)}</TableCell>
                      <TableCell><Link to={`/contracts/${c.contractId}`} className="text-primary hover:underline">{c.contract.contractNumber}</Link></TableCell>
                      <TableCell>{c.contract.customer.firstName} {c.contract.customer.lastName}</TableCell>
                      <TableCell className="text-sm">{c.requestedBy.firstName} {c.requestedBy.lastName}</TableCell>
                      <TableCell className="text-sm max-w-xs truncate" title={c.reason}>{c.reason}</TableCell>
                      <TableCell className="text-right font-mono">{formatTHB(c.refundAmount)}</TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="primary" onClick={() => setConfirmTarget({ id: c.id, action: 'approve' })}><Check className="size-4" /></Button>
                        <Button size="sm" variant="destructive" onClick={() => setConfirmTarget({ id: c.id, action: 'reject' })}><X className="size-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => !open && setConfirmTarget(null)}
        title={confirmTarget?.action === 'approve' ? 'อนุมัติยกเลิกสัญญา?' : 'ปฏิเสธคำขอ?'}
        description={confirmTarget?.action === 'approve' ? 'จะมีการบันทึก JE reversal ทันที — กลับรายการ ContractActivation' : 'คำขอจะถูกปฏิเสธและสัญญาเดิมยังคงใช้งานได้'}
        onConfirm={() => {
          if (!confirmTarget) return;
          if (confirmTarget.action === 'approve') approve.mutate(confirmTarget.id);
          else reject.mutate({ id: confirmTarget.id, reason: 'ผู้อนุมัติปฏิเสธ' });
          setConfirmTarget(null);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4.2: Wire + commit**

```bash
git add apps/web/src/{pages/finance/ContractCancellationPage.tsx,App.tsx,config/menu.ts}
git commit -m "feat(p4-sp4): ContractCancellationPage — approval queue"
```

---

## Task 5: Backend — Inter-co Report service

**Files:**
- Create: `apps/api/src/modules/accounting/intercompany-report.service.ts`
- Modify: `apps/api/src/modules/accounting/accounting.module.ts`
- Modify: `apps/api/src/modules/accounting/accounting.controller.ts`

- [ ] **Step 5.1: Create service**

```typescript
// intercompany-report.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class IntercompanyReportService {
  constructor(private prisma: PrismaService) {}

  async getReport(periodStart: Date, periodEnd: Date) {
    // FINANCE-side: Cr 21-1101 (เจ้าหนี้-หน้าร้าน) + Cr 21-1102 (ค่าคอม)
    // Subsequent settlements: Dr 21-1101 + 21-1102 / Cr 11-1201 (bank)
    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountCode: { in: ['21-1101', '21-1102'] },
        journalEntry: {
          postedAt: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
        },
      },
      include: {
        journalEntry: { select: { id: true, documentNumber: true, postedAt: true, description: true, sourceType: true, sourceId: true } },
      },
      orderBy: { journalEntry: { postedAt: 'asc' } },
    });

    let openingBalance21_1101 = 0;
    let openingBalance21_1102 = 0;
    // Compute opening balance (everything before periodStart)
    const opening = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        accountCode: { in: ['21-1101', '21-1102'] },
        journalEntry: { postedAt: { lt: periodStart }, deletedAt: null },
      },
      _sum: { creditAmount: true, debitAmount: true },
    });
    for (const o of opening) {
      const balance = Number(o._sum.creditAmount ?? 0) - Number(o._sum.debitAmount ?? 0);
      if (o.accountCode === '21-1101') openingBalance21_1101 = balance;
      if (o.accountCode === '21-1102') openingBalance21_1102 = balance;
    }

    let accruals21_1101 = 0; let settlements21_1101 = 0;
    let accruals21_1102 = 0; let settlements21_1102 = 0;
    const rows = lines.map((l) => {
      const cr = Number(l.creditAmount);
      const dr = Number(l.debitAmount);
      if (l.accountCode === '21-1101') { accruals21_1101 += cr; settlements21_1101 += dr; }
      if (l.accountCode === '21-1102') { accruals21_1102 += cr; settlements21_1102 += dr; }
      return {
        accountCode: l.accountCode,
        accountName: l.accountName,
        journalEntryId: l.journalEntry.id,
        documentNumber: l.journalEntry.documentNumber,
        postedAt: l.journalEntry.postedAt,
        description: l.description ?? l.journalEntry.description,
        sourceType: l.journalEntry.sourceType,
        sourceId: l.journalEntry.sourceId,
        debit: dr,
        credit: cr,
      };
    });

    return {
      period: { start: periodStart, end: periodEnd },
      summary: {
        '21-1101': { opening: openingBalance21_1101, accruals: accruals21_1101, settlements: settlements21_1101, closing: openingBalance21_1101 + accruals21_1101 - settlements21_1101 },
        '21-1102': { opening: openingBalance21_1102, accruals: accruals21_1102, settlements: settlements21_1102, closing: openingBalance21_1102 + accruals21_1102 - settlements21_1102 },
      },
      lines: rows,
    };
  }
}
```

- [ ] **Step 5.2: Register + controller endpoint**

```typescript
// accounting.controller.ts
@Get('inter-co/report')
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
getInterCoReport(@Query('start') start: string, @Query('end') end: string) {
  return this.intercoService.getReport(new Date(start), new Date(end));
}
```

In `accounting.module.ts` add `IntercompanyReportService` to providers + inject in controller.

- [ ] **Step 5.3: Commit**

```bash
git add apps/api/src/modules/accounting
git commit -m "feat(p4-sp4): IntercompanyReportService — FINANCE↔SHOP per period"
```

---

## Task 6: Frontend — IntercompanyReportPage

**Files:**
- Create: `apps/web/src/pages/finance/IntercompanyReportPage.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/config/menu.ts`

- [ ] **Step 6.1: Create page**

```tsx
// apps/web/src/pages/finance/IntercompanyReportPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Building2 } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Link } from 'react-router';
import { formatTHB, formatDateMedium } from '@/utils/formatters';

interface InterCoData {
  period: { start: string; end: string };
  summary: Record<'21-1101' | '21-1102', { opening: number; accruals: number; settlements: number; closing: number }>;
  lines: { accountCode: string; accountName: string; journalEntryId: string; documentNumber: string; postedAt: string; description: string; sourceType: string; debit: number; credit: number }[];
}

export default function IntercompanyReportPage() {
  const [start, setStart] = useState<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [end, setEnd] = useState<Date>(new Date());

  const query = useQuery({
    queryKey: ['inter-co-report', start.toISOString(), end.toISOString()],
    queryFn: () => api.get<InterCoData>(`/accounting/inter-co/report?start=${start.toISOString()}&end=${end.toISOString()}`).then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="รายงานลูกหนี้/เจ้าหนี้ Inter-co (FINANCE ↔ SHOP)" icon={Building2} />
      <Card>
        <CardHeader className="flex flex-row gap-4 items-end">
          <ThaiDateInput value={start} onChange={setStart} label="ตั้งแต่" />
          <ThaiDateInput value={end} onChange={setEnd} label="ถึง" />
        </CardHeader>
        <CardContent>
          <QueryBoundary query={query}>
            {(data) => (
              <>
                <div className="grid md:grid-cols-2 gap-4 mb-6">
                  <SummaryCard code="21-1101" label="เจ้าหนี้-หน้าร้าน (ยอดจัด)" data={data.summary['21-1101']} />
                  <SummaryCard code="21-1102" label="เจ้าหนี้ค่าคอม-หน้าร้าน" data={data.summary['21-1102']} />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>วันที่</TableHead>
                      <TableHead>เลขเอกสาร</TableHead>
                      <TableHead>บัญชี</TableHead>
                      <TableHead>คำอธิบาย</TableHead>
                      <TableHead>ที่มา</TableHead>
                      <TableHead className="text-right">Dr (settle)</TableHead>
                      <TableHead className="text-right">Cr (accrue)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.lines.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>{formatDateMedium(l.postedAt)}</TableCell>
                        <TableCell className="font-mono text-xs"><Link to={`/finance/general-journal?je=${l.journalEntryId}`} className="text-primary hover:underline">{l.documentNumber}</Link></TableCell>
                        <TableCell className="font-mono text-xs">{l.accountCode}</TableCell>
                        <TableCell className="text-sm">{l.description}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{l.sourceType}</TableCell>
                        <TableCell className="text-right font-mono">{l.debit ? formatTHB(l.debit) : '—'}</TableCell>
                        <TableCell className="text-right font-mono">{l.credit ? formatTHB(l.credit) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ code, label, data }: { code: string; label: string; data: { opening: number; accruals: number; settlements: number; closing: number } }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-mono text-muted-foreground">{code}</div>
        <div className="font-semibold mb-3">{label}</div>
        <Row label="ยอดต้นงวด" value={data.opening} />
        <Row label="+ ตั้งหนี้" value={data.accruals} positive />
        <Row label="− จ่ายแล้ว" value={data.settlements} negative />
        <Row label="ยอดสิ้นงวด" value={data.closing} bold />
      </CardContent>
    </Card>
  );
}

function Row({ label, value, bold, positive, negative }: { label: string; value: number; bold?: boolean; positive?: boolean; negative?: boolean }) {
  const cls = bold ? 'font-semibold border-t border-border/40 pt-2 mt-2' : '';
  const color = positive ? 'text-emerald-600' : negative ? 'text-red-600' : '';
  return (
    <div className={`flex justify-between text-sm py-1 ${cls}`}>
      <span>{label}</span>
      <span className={`font-mono ${color}`}>{formatTHB(value)}</span>
    </div>
  );
}
```

- [ ] **Step 6.2: Wire + commit**

```bash
git add apps/web/src/{pages/finance/IntercompanyReportPage.tsx,App.tsx,config/menu.ts}
git commit -m "feat(p4-sp4): IntercompanyReportPage — FINANCE↔SHOP balance + drill-down"
```

---

## Task 7: Final verification + version bump

- [ ] **Step 7.1: TS + tests + build**

```bash
cd apps/api && npx tsc --noEmit && npx jest contract-cancellation intercompany
cd apps/web && npx tsc --noEmit && npm run lint && npm run build && npx vitest run
```

- [ ] **Step 7.2: Bump version + PR**

```bash
git commit -am "chore: bump web for P4-SP4 deploy"
gh pr create --base main --title "feat(p4-sp4): ยกเลิกสัญญา + Inter-co Report"
```

---

## Acceptance Criteria

- [ ] `ContractCancellation` Prisma model migration applied
- [ ] `ContractCancellationTemplate` JE balanced; spec passes
- [ ] Cancellation approval flow: PENDING → APPROVED (with JE reversal posted) or REJECTED
- [ ] Contract status updates to `CANCELED` on approval; AuditLog `CONTRACT_CANCELED` written
- [ ] ContractCancellationPage shows queue; approve/reject works with ConfirmDialog
- [ ] IntercompanyReportPage shows opening/accrual/settlement/closing for 21-1101 + 21-1102
- [ ] Deep-link to general-journal works from Inter-co line click
- [ ] TypeScript: 0 errors · Build: success
- [ ] All tests pass
- [ ] Web version bumped

---

## Dependencies

**Depends on:**
- P4-SP1 (`/finance/general-journal` deep-link target)
- Existing `Contract`, `JournalEntry`, `JournalService`, `AuditService`
- Existing `ContractActivation1A` template (we read its output)

**Provides:**
- Contract cancellation flow (used by SALES/FM)
- Inter-co report for monthly reconciliation

## Estimated Effort

3-4 days. 7 tasks. Schema migration + JE template are the largest tasks. Wait for P4-SP1 to merge first to avoid conflict on App.tsx routes.
