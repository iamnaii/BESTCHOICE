/**
 * PaymentJournalPreviewService — park-bucket truthfulness (final review 2026-08-16).
 *
 * Covers the two preview defects the whole-branch review raised:
 *
 *   I-4 — the 2B_ONLY "already-posted 2A context" query matched ONLY the
 *         `<instId>:advance-consume-on-accrual` reference, so on the contract's
 *         LAST installment (the only one that can carry a park relief JE) the
 *         preview showed the receivable as fully outstanding while the GL had
 *         already cleared part/all of it.
 *   M-1 — the 6a preview credited 21-1103 with the OLD description while
 *         RescheduleCollectService posts the park-aware one. This file's stated
 *         contract is preview == posted.
 *
 * Hand-mocked PrismaService (no DB): the service touches only
 * installmentSchedule.findUnique, journalEntry.findMany and
 * chartOfAccount.findMany. `journalEntry.findMany` is mocked with a real
 * OR-clause matcher over an in-memory JE set so the assertions stay behavioural
 * (what lands in `accrual2A`) rather than white-box on the query object.
 */
import { Prisma } from '@prisma/client';
import { PaymentJournalPreviewService } from './payment-journal-preview.service';

const D = (n: number | string): Prisma.Decimal => new Prisma.Decimal(n);

const INST_ID = 'is-12';
const ACCRUAL_ENTRY_NO = 'JE-ACCRUAL-12';

type StoredLine = {
  accountCode: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  description: string | null;
};
type StoredEntry = { entryNumber: string; referenceId: string | null; lines: StoredLine[] };

/** JEs "already posted" for installment #12: the 2A accrual + a park relief. */
const POSTED_ENTRIES: StoredEntry[] = [
  {
    entryNumber: ACCRUAL_ENTRY_NO,
    referenceId: INST_ID,
    lines: [
      {
        accountCode: '11-2103',
        debit: D('1515.83'),
        credit: D(0),
        description: 'ลูกหนี้ค้างชำระ (Accrual)',
      },
    ],
  },
  {
    entryNumber: 'JE-PARK-12',
    referenceId: `${INST_ID}:reschedule-park-consume`,
    lines: [
      {
        accountCode: '21-1103',
        debit: D('354.00'),
        credit: D(0),
        description: 'หักเงินพักปรับดิวเข้างวดสุดท้าย',
      },
      {
        accountCode: '11-2103',
        debit: D(0),
        credit: D('354.00'),
        description: 'ล้างลูกหนี้ค้างชำระ (จากเงินพักปรับดิว)',
      },
    ],
  },
];

/** Minimal OR-matcher mirroring what Postgres would do for the service's query. */
function matchesOr(entry: StoredEntry, or: { entryNumber?: string; referenceId?: string }[]) {
  return or.some(
    (cond) =>
      (cond.entryNumber !== undefined && cond.entryNumber === entry.entryNumber) ||
      (cond.referenceId !== undefined && cond.referenceId === entry.referenceId),
  );
}

function makeService(overrides: {
  installmentNo?: number;
  totalMonths?: number;
  accrualJournalEntryId?: string | null;
  rescheduleAdvanceBalance?: Prisma.Decimal;
}) {
  const installment = {
    id: INST_ID,
    installmentNo: overrides.installmentNo ?? 12,
    dueDate: new Date('2026-01-15'),
    accrualJournalEntryId:
      overrides.accrualJournalEntryId === undefined
        ? ACCRUAL_ENTRY_NO
        : overrides.accrualJournalEntryId,
    contract: {
      totalMonths: overrides.totalMonths ?? 12,
      interestTotal: D(6000),
      monthlyPayment: D('1515.83'),
      vatAmount: D(1190),
      advanceBalance: D(0),
      rescheduleAdvanceBalance: overrides.rescheduleAdvanceBalance ?? D(0),
    },
  };

  const prisma = {
    installmentSchedule: {
      count: jest.fn().mockResolvedValue(1),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(installment),
    },
    chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
    journalEntry: {
      findMany: jest.fn().mockImplementation((args: any) => {
        const or = args?.where?.OR ?? [];
        return Promise.resolve(POSTED_ENTRIES.filter((e) => matchesOr(e, or)));
      }),
    },
  };

  // accountRoleService intentionally undefined (@Optional) → fallback adj codes.
  return {
    service: new PaymentJournalPreviewService(prisma as any, undefined),
    prisma,
  };
}

describe('PaymentJournalPreviewService — park bucket (I-4 / M-1)', () => {
  describe('I-4 — the posted-2A context block includes the park-consume JE', () => {
    it('surfaces the park relief (Dr 21-1103 / Cr 11-2103) in accrual2A on the last installment', async () => {
      const { service } = makeService({ installmentNo: 12, totalMonths: 12 });

      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 12,
        amountReceived: 1515.83,
        depositAccountCode: '11-1101',
      });

      expect(out.accrualMode).toBe('2B_ONLY');
      expect(out.accrual2A).toBeDefined(); // posted-2A context block

      const codes = out.accrual2A!.lines.map((l) => l.accountCode);
      expect(codes).toContain('11-2103'); // the accrual itself
      // The park relief must be visible — without it the block claims the whole
      // 1,515.83 receivable is still outstanding when 354.00 is already cleared.
      expect(codes).toContain('21-1103');

      const parkDr = out.accrual2A!.lines.find((l) => l.accountCode === '21-1103')!;
      expect(parkDr.debit).toBe('354.00');
      expect(parkDr.description).toBe('หักเงินพักปรับดิวเข้างวดสุดท้าย');

      // Net 11-2103 in the 2A block = 1,515.83 Dr − 354.00 Cr = 1,161.83 still owed.
      const net11 = out
        .accrual2A!.lines.filter((l) => l.accountCode === '11-2103')
        .reduce((s, l) => s.plus(l.debit).minus(l.credit), new Prisma.Decimal(0));
      expect(net11.toFixed(2)).toBe('1161.83');
    });

    it('still includes the generic advance-consume JE (regression — the pre-existing match)', async () => {
      const { prisma, service } = makeService({ installmentNo: 12, totalMonths: 12 });

      await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 12,
        amountReceived: 1515.83,
        depositAccountCode: '11-1101',
      });

      const or = prisma.journalEntry.findMany.mock.calls[0][0].where.OR;
      const refs = or.map((c: any) => c.referenceId).filter(Boolean);
      expect(refs).toContain(`${INST_ID}:advance-consume-on-accrual`);
      expect(refs).toContain(`${INST_ID}:reschedule-park-consume`);
    });
  });

  describe('M-1 — 6a preview description matches the posted line', () => {
    it("credits 21-1103 with 'เงินรับล่วงหน้างวดสุดท้าย — ค่าธรรมเนียมปรับดิว (6a)'", async () => {
      const { service } = makeService({ installmentNo: 6, totalMonths: 12 });

      const out = await service.previewJournal({
        contractId: 'c-1',
        installmentNo: 6,
        amountReceived: 0,
        depositAccountCode: '11-1101',
        case: 'RESCHEDULE',
        splitMode: 'SPLIT',
        daysToShift: 7,
      });

      const feeLine = out.lines.find((l) => l.accountCode === '21-1103');
      expect(feeLine).toBeDefined(); // the 6a fee credit line
      // 1,515.83 / 30 × 7 = 353.70 → ROUND_UP whole baht = 354.
      expect(feeLine!.credit).toBe('354.00');
      expect(feeLine!.description).toBe('เงินรับล่วงหน้างวดสุดท้าย — ค่าธรรมเนียมปรับดิว (6a)');
    });
  });
});
