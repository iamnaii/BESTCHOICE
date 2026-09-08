import { Prisma, Receipt } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { INSTALLMENT_MONEY_RECEIPT_TYPES } from '../receipt-types.constants';

type Source = Pick<
  Receipt,
  | 'id'
  | 'paymentId'
  | 'contractId'
  | 'receiptType'
  | 'amount'
  | 'paidDate'
  | 'createdAt'
  | 'isVoided'
  | 'sourceJournalEntryId'
  | 'installmentNo'
  | 'transactionRef'
  | 'issuedById'
  | 'paymentStatus'
  | 'installmentPartialSeq'
  | 'cnSource'
>;
export type ReceiptPaymentCase =
  | 'NORMAL'
  | 'PARTIAL'
  | 'RESCHEDULE'
  | 'EARLY_PAYOFF'
  | 'REPOSSESSION'
  | 'OVERPAY_ADVANCE';
export interface ReceiptPaymentHistory {
  /** This receipt's own Cr21-1103, even when its future installment target is unknown. */
  receiptAdvanceAmount?: string;
  /** Only supplied for a RESCHEDULE_FEE receipt with its own matched collect JE. */
  lateFeeCollected?: string;
  lateFeeWaivedThisReceipt?: string;
  paymentCase: ReceiptPaymentCase | null;
  installmentAllocations: Array<{
    installmentNo: number;
    amount: string;
    kind: 'INSTALLMENT' | 'RESCHEDULE_ADVANCE';
  }> | null;
}
const moneyTypes: readonly string[] = INSTALLMENT_MONEY_RECEIPT_TYPES;
const sourceTypes = [...INSTALLMENT_MONEY_RECEIPT_TYPES, 'RESCHEDULE_FEE'];
const object = (value: Prisma.JsonValue | null): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const day = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(date);
function decimal(value: unknown): Prisma.Decimal | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    const result = new Prisma.Decimal(value);
    return result.isFinite() ? result : null;
  } catch {
    return null;
  }
}
const positiveInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

/** Receipt-specific history only: never allocate a mutable contract balance to a receipt. */
export async function attachReceiptPaymentHistory<T extends Source>(
  prisma: PrismaService,
  receipts: T[],
): Promise<Array<T & ReceiptPaymentHistory>> {
  const eligible = receipts.filter((r) => r.paymentId && sourceTypes.includes(r.receiptType));
  const paymentIds = [...new Set(eligible.map((r) => r.paymentId!))];
  const history = new Map<string, ReceiptPaymentHistory>();
  for (const receipt of receipts) {
    history.set(receipt.id, {
      paymentCase:
        receipt.receiptType === 'EARLY_PAYOFF'
          ? 'EARLY_PAYOFF'
          : receipt.receiptType === 'CREDIT_NOTE' && receipt.cnSource === 'REPOSSESSION'
            ? 'REPOSSESSION'
            : receipt.receiptType === 'RESCHEDULE_FEE'
              ? 'RESCHEDULE'
              : null,
      installmentAllocations: null,
    });
  }
  if (!paymentIds.length)
    return receipts.map((receipt) => ({ ...receipt, ...history.get(receipt.id)! }));
  // Every sibling is needed to reject repeated-amount legacy matches on detail/paginated reads.
  const siblings = await prisma.receipt.findMany({
    where: { paymentId: { in: paymentIds }, receiptType: { in: sourceTypes }, deletedAt: null },
    select: {
      id: true,
      paymentId: true,
      contractId: true,
      receiptType: true,
      amount: true,
      paidDate: true,
      createdAt: true,
      isVoided: true,
      sourceJournalEntryId: true,
      installmentNo: true,
      transactionRef: true,
      issuedById: true,
      paymentStatus: true,
      installmentPartialSeq: true,
      cnSource: true,
    },
  });
  const sourceIds = siblings.flatMap((r) =>
    r.sourceJournalEntryId ? [r.sourceJournalEntryId] : [],
  );
  const entries = await prisma.journalEntry.findMany({
    where: {
      status: 'POSTED',
      deletedAt: null,
      OR: [
        ...(sourceIds.length ? [{ id: { in: sourceIds } }] : []),
        ...paymentIds.map((paymentId) => ({
          metadata: { path: ['paymentId'], equals: paymentId },
        })),
      ],
    },
    select: {
      id: true,
      entryNumber: true,
      postedAt: true,
      metadata: true,
      lines: {
        where: { deletedAt: null },
        select: { accountCode: true, debit: true, credit: true },
      },
    },
  });
  type Entry = (typeof entries)[number];
  const sum = (entry: Entry, accountCode: string, side: 'debit' | 'credit') =>
    entry.lines
      .filter((line) => line.accountCode === accountCode)
      .reduce((total, line) => total.plus(line[side]), new Prisma.Decimal(0));
  const compatible = (receipt: Source, entry: Entry) => {
    const meta = object(entry.metadata);
    return (
      meta.paymentId === receipt.paymentId &&
      meta.contractId === receipt.contractId &&
      !meta.originalEntryId &&
      (receipt.receiptType === 'RESCHEDULE_FEE'
        ? meta.tag === 'reschedule-collect'
        : meta.tag === 'receipt' || meta.tag === '2B')
    );
  };
  const sourceByReceipt = new Map<string, Entry>();
  const reserved = new Set(sourceIds);
  for (const receipt of siblings) {
    if (!receipt.sourceJournalEntryId) continue;
    const found = entries.find(
      (entry) => entry.id === receipt.sourceJournalEntryId && compatible(receipt, entry),
    );
    if (found && siblings.filter((r) => r.sourceJournalEntryId === found.id).length === 1)
      sourceByReceipt.set(receipt.id, found);
  }
  const candidates = new Map<string, Entry[]>();
  for (const receipt of siblings.filter((r) => !r.sourceJournalEntryId)) {
    candidates.set(
      receipt.id,
      entries.filter((entry) => {
        const meta = object(entry.metadata);
        const cash =
          receipt.receiptType === 'RESCHEDULE_FEE'
            ? decimal(meta.rescheduleFee)?.plus(decimal(meta.lateFeeCollected) ?? 0)
            : decimal(meta.deltaApplied);
        return (
          !reserved.has(entry.id) &&
          compatible(receipt, entry) &&
          cash?.eq(receipt.amount) &&
          (meta.reversed === true) === receipt.isVoided &&
          entry.postedAt &&
          day(entry.postedAt) === day(receipt.paidDate)
        );
      }),
    );
  }
  for (const [receiptId, matches] of candidates) {
    if (
      matches.length === 1 &&
      [...candidates.values()].filter((group) => group.some((entry) => entry.id === matches[0].id))
        .length === 1
    )
      sourceByReceipt.set(receiptId, matches[0]);
  }
  const needsRescheduleProof = siblings.filter((r) => {
    const source = sourceByReceipt.get(r.id);
    return source && (r.receiptType === 'RESCHEDULE_FEE' || sum(source, '21-1103', 'credit').gt(0));
  });
  const contractIds = [...new Set(needsRescheduleProof.map((r) => r.contractId))];
  const audits = contractIds.length
    ? await prisma.auditLog.findMany({
        where: {
          OR: [
            { action: 'RESCHEDULE_COLLECT', entity: 'payment', entityId: { in: paymentIds } },
            {
              action: {
                in: ['RESCHEDULE', 'RESCHEDULE_ADVANCE_PARKED', 'OVERPAY_ADVANCE_RECORDED'],
              },
              entity: 'contract',
              entityId: { in: contractIds },
            },
          ],
        },
        select: {
          id: true,
          action: true,
          entityId: true,
          userId: true,
          createdAt: true,
          newValue: true,
        },
      })
    : [];
  const legacyContractIds = [
    ...new Set(
      audits
        .filter(
          (audit) =>
            audit.action === 'RESCHEDULE_COLLECT' &&
            !positiveInteger(object(audit.newValue).parkTargetInstallmentNo),
        )
        .map((audit) => object(audit.newValue).contractId)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
  // Older audits lack a frozen park target. Resolve it only if both the current
  // term and the surviving generated schedule still agree with the old shift shape.
  const [contracts, schedules] = legacyContractIds.length
    ? await Promise.all([
        prisma.contract.findMany({
          where: { id: { in: legacyContractIds }, deletedAt: null },
          select: { id: true, totalMonths: true },
        }),
        prisma.installmentSchedule.findMany({
          where: { contractId: { in: legacyContractIds }, deletedAt: null },
          select: { contractId: true, installmentNo: true },
          orderBy: { installmentNo: 'asc' },
        }),
      ])
    : [[], []];
  const collectCandidates = new Map<string, typeof audits>();
  for (const receipt of needsRescheduleProof) {
    const source = sourceByReceipt.get(receipt.id)!;
    collectCandidates.set(
      receipt.id,
      audits.filter((audit) => {
        const meta = object(audit.newValue);
        return (
          audit.action === 'RESCHEDULE_COLLECT' &&
          audit.entityId === receipt.paymentId &&
          meta.contractId === receipt.contractId &&
          meta.installmentNo === receipt.installmentNo &&
          decimal(meta.collectAmount)?.eq(receipt.amount) &&
          (meta.transactionRef ?? null) === receipt.transactionRef &&
          (receipt.receiptType === 'RESCHEDULE_FEE'
            ? meta.variant === '6a' &&
              meta.journalEntryNo === source.entryNumber &&
              audit.userId === receipt.issuedById &&
              day(audit.createdAt) === day(receipt.createdAt)
            : meta.variant === '6b' &&
              meta.bundledPaid === true &&
              (!source.postedAt || audit.createdAt >= source.postedAt))
        );
      }),
    );
  }
  for (const receipt of eligible) {
    const source = sourceByReceipt.get(receipt.id);
    if (!source) continue;
    const advance = sum(source, '21-1103', 'credit');
    const fee = sum(source, '42-1103', 'credit').minus(sum(source, '52-1105', 'debit'));
    const currentCash = new Prisma.Decimal(receipt.amount).minus(advance).minus(fee);
    if (advance.lt(0) || fee.lt(0) || currentCash.lt(0)) continue;
    const result = history.get(receipt.id)!;
    result.receiptAdvanceAmount = advance.toFixed(2);
    if (receipt.receiptType === 'RESCHEDULE_FEE') {
      result.lateFeeCollected = fee.toFixed(2);
      result.lateFeeWaivedThisReceipt = sum(source, '52-1105', 'debit').toFixed(2);
    }
    const partial =
      receipt.paymentStatus === 'PARTIAL' ||
      (receipt.installmentPartialSeq ?? 0) > 0 ||
      siblings.some(
        (r) =>
          r.id !== receipt.id &&
          r.paymentId === receipt.paymentId &&
          moneyTypes.includes(r.receiptType) &&
          r.isVoided === receipt.isVoided &&
          r.createdAt < receipt.createdAt,
      );
    result.paymentCase =
      receipt.receiptType === 'RESCHEDULE_FEE'
        ? 'RESCHEDULE'
        : advance.gt(0)
          ? 'OVERPAY_ADVANCE'
          : partial
            ? 'PARTIAL'
            : 'NORMAL';
    if (advance.isZero()) {
      result.installmentAllocations =
        receipt.installmentNo && currentCash.gt(0)
          ? [
              {
                installmentNo: receipt.installmentNo,
                amount: currentCash.toFixed(2),
                kind: 'INSTALLMENT',
              },
            ]
          : [];
      continue;
    }
    const matched = collectCandidates.get(receipt.id) ?? [];
    if (
      matched.length !== 1 ||
      [...collectCandidates.values()].filter((group) =>
        group.some((audit) => audit.id === matched[0].id),
      ).length !== 1
    ) {
      const possibleReschedule = audits.some(
        (audit) =>
          audit.action === 'RESCHEDULE_COLLECT' &&
          audit.entityId === receipt.paymentId &&
          object(audit.newValue).contractId === receipt.contractId &&
          object(audit.newValue).variant === '6b' &&
          decimal(object(audit.newValue).collectAmount)?.eq(receipt.amount),
      );
      if ((matched.length || possibleReschedule) && receipt.receiptType !== 'RESCHEDULE_FEE')
        result.paymentCase = null;
      continue;
    }
    const collect = matched[0],
      meta = object(collect.newValue);
    result.paymentCase = 'RESCHEDULE';
    if (!decimal(meta.rescheduleFee)?.eq(advance)) continue;
    const parked = audits.filter((audit) => {
      const value = object(audit.newValue);
      return (
        audit.action ===
          (receipt.receiptType === 'RESCHEDULE_FEE'
            ? 'OVERPAY_ADVANCE_RECORDED'
            : 'RESCHEDULE_ADVANCE_PARKED') &&
        audit.entityId === receipt.contractId &&
        audit.userId === collect.userId &&
        value.paymentId === receipt.paymentId &&
        day(audit.createdAt) === day(collect.createdAt) &&
        (receipt.receiptType === 'RESCHEDULE_FEE'
          ? value.source === 'RESCHEDULE_COLLECT_6A_FEE' &&
            decimal(value.advanceCredit)?.eq(advance)
          : value.source === 'RESCHEDULE_COLLECT_6B_FEE_SWEEP' &&
            decimal(value.sweptAmount)?.eq(advance))
      );
    });
    if (parked.length !== 1) continue;
    const stampedTarget = positiveInteger(meta.parkTargetInstallmentNo);
    const parkedTarget = positiveInteger(object(parked[0].newValue).parkTargetInstallmentNo);
    let last: number | null = null;
    if (stampedTarget) {
      if (parkedTarget !== stampedTarget) continue;
      last = stampedTarget;
    } else {
      const reschedules = audits.filter((audit) => {
        const value = object(audit.newValue);
        return (
          audit.action === 'RESCHEDULE' &&
          audit.entityId === receipt.contractId &&
          audit.userId === collect.userId &&
          day(audit.createdAt) === day(collect.createdAt) &&
          value.variant === meta.variant &&
          value.daysToShift === meta.daysToShift &&
          decimal(value.rescheduleFee)?.eq(advance) &&
          value.fromInstallmentNo === receipt.installmentNo! + (meta.variant === '6b' ? 1 : 0)
        );
      });
      if (reschedules.length !== 1) continue;
      const shift = object(reschedules[0].newValue);
      const first = positiveInteger(shift.firstShiftedInstallmentNo),
        count = positiveInteger(shift.shiftedInstallmentCount);
      const term = contracts.find((contract) => contract.id === receipt.contractId)?.totalMonths;
      if (!first || !count || first + count - 1 !== term) continue;
      const surviving = schedules.filter(
        (schedule) => schedule.contractId === receipt.contractId && schedule.installmentNo >= first,
      );
      if (
        surviving.length !== count ||
        surviving.some((schedule, i) => schedule.installmentNo !== first + i)
      )
        continue;
      if (parkedTarget && parkedTarget !== term) continue;
      last = term;
    }
    if (!last || !receipt.installmentNo || last < receipt.installmentNo) continue;
    result.installmentAllocations = [
      ...(currentCash.gt(0)
        ? [
            {
              installmentNo: receipt.installmentNo,
              amount: currentCash.toFixed(2),
              kind: 'INSTALLMENT' as const,
            },
          ]
        : []),
      { installmentNo: last, amount: advance.toFixed(2), kind: 'RESCHEDULE_ADVANCE' },
    ];
  }
  return receipts.map((receipt) => ({ ...receipt, ...history.get(receipt.id)! }));
}
