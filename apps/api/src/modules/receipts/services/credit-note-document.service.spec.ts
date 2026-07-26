import { Decimal } from '@prisma/client/runtime/library';
import { CreditNoteDocumentService, IssueCreditNoteInput } from './credit-note-document.service';

/**
 * CPA CSV golden fixture (17,000฿ financed+commission+interest / 12 months —
 * same fixture used by seedStandard17k12m + bad-debt-writeoff.template.spec.ts):
 *   financedAmount=10,000 / storeCommission=1,000 / interestTotal=6,000 / vatAmount=1,190
 *   → installmentExclVat=1,416.66 (ROUND_DOWN) / vatPerInst=99.17 (ROUND_HALF_UP)
 *   → 3 accrued-unpaid installments (fully unpaid): amountBeforeVat=4,249.98 / vat=297.51 / amount=4,547.49
 *
 * CPA pro-rate ruling (2026-07-26, docs/superpowers/plans/2026-07-26-cn-prorate-cpa.md):
 *   3 accrued installments, 1 of them PARTIALLY_PAID (paid 1,000 of 1,515.83) →
 *   totalCnVat 232.09 / totalOutstanding 3,547.49 / totalBeforeVat 3,315.40
 *   (same golden as computeCnBreakdown's "mixed" spec case).
 */
const CONTRACT_FIXTURE = {
  id: 'contract-1',
  contractNumber: 'CT-0001',
  financedAmount: new Decimal('10000.00'),
  storeCommission: new Decimal('1000.00'),
  interestTotal: new Decimal('6000.00'),
  vatAmount: new Decimal('1190.00'),
  totalMonths: 12,
  customer: { name: 'ลูกค้าทดสอบ' },
};

const DEFAULT_INPUT: IssueCreditNoteInput = {
  contractId: 'contract-1',
  source: 'WRITE_OFF',
  sourceJournalEntryNo: 'JE-202607-0001',
  actorUserId: 'user-1',
};

function buildInstallments(accruedCount: number, total = 12) {
  return Array.from({ length: total }, (_, i) => ({
    installmentNo: i + 1,
    accrualJournalEntryId: i < accruedCount ? `accr-je-${i + 1}` : null,
  }));
}

interface Overrides {
  receiptFindFirst?: unknown;
  payments?: Array<{
    installmentNo: number;
    status: string;
    amountDue?: string;
    amountPaid?: string;
  }>;
  installments?: Array<{ installmentNo: number; accrualJournalEntryId: string | null }>;
  je?: { id: string; metadata: Record<string, unknown> } | null;
  contract?: Record<string, unknown> | null;
}

function buildHarness(overrides: Overrides = {}) {
  const created: {
    receipts: Record<string, unknown>[];
    auditLogs: Record<string, unknown>[];
  } = { receipts: [], auditLogs: [] };

  const tx = {
    receipt: {
      findFirst: jest.fn().mockResolvedValue(overrides.receiptFindFirst ?? null),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        created.receipts.push(args.data);
        return { id: 'receipt-1', receiptNumber: 'RT-202607-00001', ...args.data };
      }),
    },
    contract: {
      findUnique: jest
        .fn()
        .mockResolvedValue(overrides.contract === undefined ? CONTRACT_FIXTURE : overrides.contract),
    },
    installmentSchedule: {
      findMany: jest.fn().mockResolvedValue(overrides.installments ?? buildInstallments(0)),
    },
    payment: {
      findMany: jest.fn().mockResolvedValue(
        (overrides.payments ?? []).map((p) => ({
          installmentNo: p.installmentNo,
          status: p.status,
          amountDue: p.amountDue ?? '0',
          amountPaid: p.amountPaid ?? '0',
        })),
      ),
    },
    auditLog: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        created.auditLogs.push(args.data);
        return { id: 'audit-1', ...args.data };
      }),
    },
    journalEntry: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides.je === undefined
            ? { id: 'je-1', metadata: { creditNoteVatAmount: '297.51' } }
            : overrides.je,
        ),
    },
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([]),
  };

  const prisma = {} as never;
  const service = new CreditNoteDocumentService(prisma);
  return { service, tx, created };
}

describe('CreditNoteDocumentService', () => {
  describe('clean path (no partial payment among accrued-unpaid)', () => {
    it('issues a CN receipt with the golden 3-installment numbers (17k/12 fixture)', async () => {
      const { service, tx, created } = buildHarness({
        installments: buildInstallments(3),
        payments: [],
      });

      const result = await service.issueForContract(DEFAULT_INPUT, tx as any);

      expect(result).toEqual({
        outcome: 'ISSUED',
        receiptId: 'receipt-1',
        receiptNumber: 'RT-202607-00001',
      });
      expect(created.receipts).toHaveLength(1);

      const data = created.receipts[0] as Record<string, unknown> & {
        amount: Decimal;
        vatAmount: Decimal;
        amountBeforeVat: Decimal;
        publicToken: string;
        publicTokenExpiresAt: Date;
        itemDescription: string;
      };
      expect((data.amount as Decimal).toFixed(2)).toBe('4547.49');
      expect((data.vatAmount as Decimal).toFixed(2)).toBe('297.51');
      expect((data.amountBeforeVat as Decimal).toFixed(2)).toBe('4249.98');
      expect(data.receiptType).toBe('CREDIT_NOTE');
      expect(data.cnSource).toBe('WRITE_OFF');
      expect(data.sourceJournalEntryId).toBe('je-1');
      expect(data.payerName).toBe('ลูกค้าทดสอบ');
      expect(data.receiverName).toBe('BESTCHOICE FINANCE');
      expect(data.itemDescription).toBe('ใบลดหนี้ยกเลิกงวดค้าง 3 งวด — เลิกสัญญา (ม.82/5)');
      expect(data.itemDescription).not.toContain('ลดตามสัดส่วนยอดค้างจริง');

      // Public token: present + 30-day expiry in the future
      expect(typeof data.publicToken).toBe('string');
      expect((data.publicToken as string).length).toBeGreaterThan(0);
      expect(data.publicTokenExpiresAt).toBeInstanceOf(Date);
      expect((data.publicTokenExpiresAt as Date).getTime()).toBeGreaterThan(Date.now());

      // Audit trail
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CN_ISSUED',
            entity: 'receipt',
            entityId: 'receipt-1',
          }),
        }),
      );
    });
  });

  describe('pro-rated path — partial payment among accrued-unpaid (CPA ruling 2026-07-26)', () => {
    it('auto-issues a receipt with pro-rated amounts instead of holding for review', async () => {
      const { service, tx, created } = buildHarness({
        installments: buildInstallments(3),
        payments: [
          { installmentNo: 1, status: 'PARTIALLY_PAID', amountDue: '1515.83', amountPaid: '1000' },
        ],
        je: { id: 'je-1', metadata: { creditNoteVatAmount: '232.09' } },
      });

      const result = await service.issueForContract(DEFAULT_INPUT, tx as any);

      expect(result).toEqual({
        outcome: 'ISSUED',
        receiptId: 'receipt-1',
        receiptNumber: 'RT-202607-00001',
      });
      expect(created.receipts).toHaveLength(1);

      const data = created.receipts[0] as Record<string, unknown> & {
        amount: Decimal;
        vatAmount: Decimal;
        amountBeforeVat: Decimal;
        itemDescription: string;
      };
      expect((data.amount as Decimal).toFixed(2)).toBe('3547.49');
      expect((data.vatAmount as Decimal).toFixed(2)).toBe('232.09');
      expect((data.amountBeforeVat as Decimal).toFixed(2)).toBe('3315.40');
      expect(data.itemDescription).toBe(
        'ใบลดหนี้ยกเลิกงวดค้าง 3 งวด — เลิกสัญญา (ม.82/5) (ลดตามสัดส่วนยอดค้างจริง)',
      );

      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CN_ISSUED',
            entity: 'receipt',
            entityId: 'receipt-1',
          }),
        }),
      );
    });
  });

  describe('idempotency / no-op paths', () => {
    it('returns SKIPPED_DUPLICATE when a CN receipt already exists for this (contract, source)', async () => {
      const { service, tx } = buildHarness({
        receiptFindFirst: { id: 'existing-cn' },
      });

      const result = await service.issueForContract(DEFAULT_INPUT, tx as any);

      expect(result).toEqual({ outcome: 'SKIPPED_DUPLICATE' });
      expect(tx.contract.findUnique).not.toHaveBeenCalled();
      expect(tx.receipt.create).not.toHaveBeenCalled();
    });

    it('returns SKIPPED_NO_ACCRUED when no installment has an accrual JE', async () => {
      const { service, tx } = buildHarness({
        installments: buildInstallments(0),
        payments: [],
      });

      const result = await service.issueForContract(DEFAULT_INPUT, tx as any);

      expect(result).toEqual({ outcome: 'SKIPPED_NO_ACCRUED' });
      expect(tx.journalEntry.findUnique).not.toHaveBeenCalled();
      expect(tx.receipt.create).not.toHaveBeenCalled();
    });
  });

  describe('drift guard', () => {
    it('throws when the recomputed VAT does not match the JE metadata.creditNoteVatAmount', async () => {
      const { service, tx } = buildHarness({
        installments: buildInstallments(3),
        payments: [],
        je: { id: 'je-1', metadata: { creditNoteVatAmount: '999.99' } },
      });

      await expect(service.issueForContract(DEFAULT_INPUT, tx as any)).rejects.toThrow(
        /ไม่ตรงกับ Journal Entry/,
      );
      expect(tx.receipt.create).not.toHaveBeenCalled();
    });

    it('throws when the source Journal Entry cannot be found', async () => {
      const { service, tx } = buildHarness({
        installments: buildInstallments(3),
        payments: [],
        je: null,
      });

      await expect(service.issueForContract(DEFAULT_INPUT, tx as any)).rejects.toThrow(
        /ไม่พบ Journal Entry/,
      );
    });
  });
});
