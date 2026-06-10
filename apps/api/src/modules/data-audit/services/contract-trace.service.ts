import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContractTraceCheck, ContractTraceResult } from '../data-audit.types';

@Injectable()
export class ContractTraceService {
  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════
  // Contract Lifecycle Trace (Phase 2)
  // ═══════════════════════════════════════════════════════════════

  async traceContract(contractId: string): Promise<ContractTraceResult> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
        product: {
          select: {
            id: true,
            name: true,
            costPrice: true,
            category: true,
            ownedByCompanyId: true,
          },
        },
        branch: { select: { id: true, name: true } },
      },
    });
    if (!contract) {
      throw new NotFoundException(`ไม่พบสัญญา ID: ${contractId}`);
    }

    // Load all journal entries for this contract (activation, COGS)
    const contractJournals = await this.prisma.journalEntry.findMany({
      where: { referenceId: contractId, deletedAt: null, status: 'POSTED' },
      include: { lines: { where: { deletedAt: null } } },
    });

    // Load payment journals.
    // PR-843/I2 Phase 3 PR 3.1: the epic posts MULTIPLE receipt JEs per Payment.
    // The canonical payment→JE key is now `metadata.paymentId` (JSON); the JE's
    // scalar `referenceId` is a fresh random UUID on new primitive receipt JEs
    // (it equals payment.id only on LEGACY 2B / split-final / credit-allocation
    // JEs). Match BOTH shapes: legacy via `referenceId in paymentIds`, new via
    // `metadata.paymentId` (one OR clause per payment — Prisma's JSON `equals`
    // can't take an array). `metadata` is selected (default scalar) so the
    // in-memory match in tracePayment / aggregations can read it.
    const paymentIds = contract.payments.map((p) => p.id);
    const paymentJournals =
      paymentIds.length > 0
        ? await this.prisma.journalEntry.findMany({
            where: {
              // Payment JEs are stored as referenceType 'AUTO' (journal-auto from
              // reference=payment.id), NOT 'PAYMENT' — the old value matched nothing.
              referenceType: 'AUTO',
              deletedAt: null,
              status: 'POSTED',
              OR: [
                { referenceId: { in: paymentIds } },
                ...paymentIds.map((pid) => ({
                  metadata: { path: ['paymentId'], equals: pid } as Prisma.JsonFilter,
                })),
              ],
            },
            include: { lines: { where: { deletedAt: null } } },
          })
        : [];

    // Load inter-company transaction
    const interCompany = await this.prisma.interCompanyTransaction.findFirst({
      where: { contractId, deletedAt: null },
    });

    // Run lifecycle checks
    const creation = this.traceCreation(contract);
    const activation = this.traceActivation(contract, contractJournals);
    const cogs = this.traceCogs(contract, contractJournals);
    const interCompanyCheck = this.traceInterCompany(contract, interCompany);
    const payments = contract.payments.map((p) => this.tracePayment(p, paymentJournals));
    const hpReceivable = this.traceHpBalance(contract, contractJournals, paymentJournals);
    const vatTotal = this.traceVatTotal(contract, paymentJournals);
    const commissionTotal = this.traceCommissionTotal(contract, paymentJournals);
    const completion = this.traceCompletion(contract);

    const allChecks = [creation, activation, cogs, interCompanyCheck, ...payments, hpReceivable, vatTotal, commissionTotal, completion];
    const passed = allChecks.filter((c) => c.status === 'PASS').length;
    const failed = allChecks.filter((c) => c.status === 'FAIL').length;
    const warnings = allChecks.filter((c) => c.status === 'WARN').length;

    return {
      contract: {
        id: contract.id,
        contractNumber: contract.contractNumber,
        status: contract.status,
      },
      checks: {
        creation,
        activation,
        cogs,
        interCompany: interCompanyCheck,
        payments,
        hpReceivable,
        vatTotal,
        commissionTotal,
        completion,
      },
      summary: {
        totalChecks: allChecks.length,
        passed,
        failed,
        warnings,
      },
    };
  }

  async traceAll(filters: { status?: string; limit?: number }): Promise<{
    total: number;
    checked: number;
    passed: number;
    failed: number;
    failures: ContractTraceResult[];
  }> {
    const statusFilter = filters.status
      ? { equals: filters.status as never }
      : { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] as never[] };

    const contracts = await this.prisma.contract.findMany({
      where: { deletedAt: null, status: statusFilter },
      select: { id: true },
      take: filters.limit || 100,
    });

    const failures: ContractTraceResult[] = [];
    for (const c of contracts) {
      const trace = await this.traceContract(c.id);
      if (trace.summary.failed > 0) {
        failures.push(trace);
      }
    }

    return {
      total: contracts.length,
      checked: contracts.length,
      passed: contracts.length - failures.length,
      failed: failures.length,
      failures,
    };
  }

  // ── Trace sub-checks ──────────────────────────────────────────

  private traceCreation(contract: { payments: unknown[]; status: string }): ContractTraceCheck {
    const hasSchedule = contract.payments.length > 0;
    const isPostDraft = contract.status !== 'DRAFT';
    if (!isPostDraft) {
      return { name: 'creation', status: 'PASS', details: 'Contract is DRAFT — no schedule expected yet' };
    }
    return {
      name: 'creation',
      status: hasSchedule ? 'PASS' : 'FAIL',
      details: hasSchedule
        ? { paymentCount: contract.payments.length }
        : 'ไม่พบตารางผ่อนชำระ (payment schedule)',
    };
  }

  private traceActivation(
    contract: { status: string },
    journals: { referenceType: string | null; lines: { debit: Prisma.Decimal; credit: Prisma.Decimal }[] }[],
  ): ContractTraceCheck {
    const activationStatuses = ['ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF', 'CLOSED_BAD_DEBT'];
    if (!activationStatuses.includes(contract.status)) {
      return { name: 'activation', status: 'PASS', details: 'สัญญายังไม่ active — ไม่ต้องมี journal' };
    }

    const activationJournal = journals.find((j) => j.referenceType === 'CONTRACT');
    if (!activationJournal) {
      return { name: 'activation', status: 'FAIL', details: 'ไม่พบ journal entry สำหรับ CONTRACT activation' };
    }

    const totalDebit = activationJournal.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredit = activationJournal.lines.reduce((sum, l) => sum + Number(l.credit), 0);
    const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

    return {
      name: 'activation',
      status: balanced ? 'PASS' : 'FAIL',
      details: { totalDebit, totalCredit, balanced },
    };
  }

  private traceCogs(
    contract: { status: string; product: { costPrice: Prisma.Decimal } | null },
    journals: { referenceType: string | null; lines: { debit: Prisma.Decimal; credit: Prisma.Decimal }[] }[],
  ): ContractTraceCheck {
    const activationStatuses = ['ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF', 'CLOSED_BAD_DEBT'];
    if (!activationStatuses.includes(contract.status)) {
      return { name: 'cogs', status: 'PASS', details: 'สัญญายังไม่ active' };
    }

    const costPrice = Number(contract.product?.costPrice ?? 0);
    if (costPrice <= 0) {
      return { name: 'cogs', status: 'PASS', details: 'costPrice = 0 — ไม่ต้องมี COGS journal' };
    }

    const cogsJournal = journals.find((j) => j.referenceType === 'CONTRACT_COGS');
    if (!cogsJournal) {
      return { name: 'cogs', status: 'FAIL', details: `costPrice = ${costPrice} แต่ไม่พบ COGS journal` };
    }

    const totalDebit = cogsJournal.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredit = cogsJournal.lines.reduce((sum, l) => sum + Number(l.credit), 0);
    const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

    return {
      name: 'cogs',
      status: balanced ? 'PASS' : 'FAIL',
      details: { costPrice, totalDebit, totalCredit, balanced },
    };
  }

  private traceInterCompany(
    contract: { status: string },
    interCompany: unknown | null,
  ): ContractTraceCheck {
    const activationStatuses = ['ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF', 'CLOSED_BAD_DEBT'];
    if (!activationStatuses.includes(contract.status)) {
      return { name: 'interCompany', status: 'PASS', details: 'สัญญายังไม่ active' };
    }
    return {
      name: 'interCompany',
      status: interCompany ? 'PASS' : 'FAIL',
      details: interCompany ? 'InterCompanyTransaction found' : 'ไม่พบ InterCompanyTransaction',
    };
  }

  private tracePayment(
    payment: { id: string; installmentNo: number; status: string; amountPaid: Prisma.Decimal },
    paymentJournals: {
      referenceId: string | null;
      metadata?: Prisma.JsonValue;
      lines: { debit: Prisma.Decimal; credit: Prisma.Decimal }[];
    }[],
  ): ContractTraceCheck {
    if (payment.status === 'PENDING' || Number(payment.amountPaid) === 0) {
      return {
        name: `payment_${payment.installmentNo}`,
        status: 'PASS',
        details: 'ยังไม่ชำระ — ไม่ต้องมี journal',
      };
    }

    // PR-843/I2 Phase 3 PR 3.1: a payment may have MULTIPLE receipt JEs sharing
    // metadata.paymentId. Match ALL of them (new shape via metadata.paymentId,
    // legacy shape via referenceId == payment.id) and aggregate across them.
    const journals = paymentJournals.filter(
      (j) =>
        (j.metadata as { paymentId?: string } | null)?.paymentId === payment.id ||
        j.referenceId === payment.id,
    );
    if (journals.length === 0) {
      return {
        name: `payment_${payment.installmentNo}`,
        status: 'FAIL',
        details: `งวดที่ ${payment.installmentNo} ชำระแล้ว (${payment.amountPaid}) แต่ไม่พบ journal`,
      };
    }

    // Aggregate Dr/Cr across ALL matching JEs — for a multi-receipt payment the
    // combined entry must still balance (each receipt JE balances individually,
    // so the sum does too).
    const allLines = journals.flatMap((j) => j.lines);
    const totalDebit = allLines.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredit = allLines.reduce((sum, l) => sum + Number(l.credit), 0);
    const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

    return {
      name: `payment_${payment.installmentNo}`,
      status: balanced ? 'PASS' : 'FAIL',
      details: { installmentNo: payment.installmentNo, journalCount: journals.length, totalDebit, totalCredit, balanced },
    };
  }

  private traceHpBalance(
    contract: { status: string; payments: { status: string; amountDue: Prisma.Decimal; amountPaid: Prisma.Decimal }[] },
    contractJournals: { lines: { accountCode: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[] }[],
    paymentJournals: { lines: { accountCode: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[] }[],
  ): ContractTraceCheck {
    const activationStatuses = ['ACTIVE', 'OVERDUE', 'DEFAULT'];
    if (!activationStatuses.includes(contract.status)) {
      return { name: 'hpReceivable', status: 'PASS', details: `สถานะ ${contract.status} — ไม่ reconcile` };
    }

    // HP Receivable from journals (debit - credit for account 11-2102)
    const allLines = [...contractJournals, ...paymentJournals].flatMap((j) => j.lines);
    const hpLines = allLines.filter((l) => l.accountCode === '11-2102');
    const journalHp = hpLines.reduce((sum, l) => sum + Number(l.debit) - Number(l.credit), 0);

    // Outstanding from payments
    const outstanding = contract.payments
      .filter((p) => ['PENDING', 'PARTIALLY_PAID'].includes(p.status))
      .reduce((sum, p) => sum + Number(p.amountDue) - Number(p.amountPaid), 0);

    const diff = Math.abs(journalHp - outstanding);
    const threshold = Math.max(outstanding * 0.001, 10);

    return {
      name: 'hpReceivable',
      status: diff < threshold ? 'PASS' : 'FAIL',
      details: { journalHpReceivable: journalHp, contractOutstanding: outstanding, diff, threshold },
    };
  }

  private traceVatTotal(
    contract: { payments: { status: string; vatAmount: Prisma.Decimal | null }[] },
    paymentJournals: { lines: { accountCode: string; credit: Prisma.Decimal }[] }[],
  ): ContractTraceCheck {
    const paidPayments = contract.payments.filter((p) => ['PAID', 'PARTIALLY_PAID'].includes(p.status));
    const paymentVat = paidPayments.reduce((sum, p) => sum + Number(p.vatAmount ?? 0), 0);

    const journalVat = paymentJournals
      .flatMap((j) => j.lines)
      .filter((l) => l.accountCode === '21-2101')
      .reduce((sum, l) => sum + Number(l.credit), 0);

    const diff = Math.abs(paymentVat - journalVat);

    return {
      name: 'vatTotal',
      status: diff < 1.0 ? 'PASS' : 'FAIL',
      details: { paymentVatSum: paymentVat, journalVatSum: journalVat, diff },
    };
  }

  private traceCommissionTotal(
    contract: { payments: { status: string; monthlyCommission: Prisma.Decimal | null }[] },
    paymentJournals: { lines: { accountCode: string; credit: Prisma.Decimal }[] }[],
  ): ContractTraceCheck {
    const paidPayments = contract.payments.filter((p) => p.status === 'PAID');
    const paymentComm = paidPayments.reduce((sum, p) => sum + Number(p.monthlyCommission ?? 0), 0);

    const journalComm = paymentJournals
      .flatMap((j) => j.lines)
      .filter((l) => l.accountCode === '42-1105')
      .reduce((sum, l) => sum + Number(l.credit), 0);

    const diff = Math.abs(paymentComm - journalComm);

    return {
      name: 'commissionTotal',
      status: diff < 1.0 ? 'PASS' : 'FAIL',
      details: { paymentCommissionSum: paymentComm, journalCommissionSum: journalComm, diff },
    };
  }

  private traceCompletion(contract: {
    status: string;
    payments: { status: string }[];
    product: { ownedByCompanyId: string | null } | null;
  }): ContractTraceCheck {
    if (contract.status !== 'COMPLETED') {
      return { name: 'completion', status: 'PASS', details: `สถานะ ${contract.status} — ยังไม่ complete` };
    }

    const allPaid = contract.payments.every((p) => p.status === 'PAID');
    if (!allPaid) {
      const unpaidCount = contract.payments.filter((p) => p.status !== 'PAID').length;
      return {
        name: 'completion',
        status: 'FAIL',
        details: `สัญญา COMPLETED แต่ยังมี ${unpaidCount} งวดที่ยังไม่จ่ายครบ`,
      };
    }

    return {
      name: 'completion',
      status: 'PASS',
      details: 'ทุกงวดชำระครบ',
    };
  }
}
