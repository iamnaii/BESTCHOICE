import { Decimal } from '@prisma/client/runtime/library';
import { CreditNoteDocumentService, IssueCreditNoteInput } from './credit-note-document.service';

/**
 * CPA CSV golden fixture (17,000฿ financed+commission+interest / 12 months —
 * same fixture used by seedStandard17k12m + bad-debt-writeoff.template.spec.ts):
 *   financedAmount=10,000 / storeCommission=1,000 / interestTotal=6,000 / vatAmount=1,190
 *   → installmentExclVat=1,416.66 (ROUND_DOWN) / vatPerInst=99.17 (ROUND_HALF_UP)
 *   → 3 accrued-unpaid installments: amountBeforeVat=4,249.98 / vat=297.51 / amount=4,547.49
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
  payments?: Array<{ installmentNo: number; status: string }>;
  installments?: Array<{ installmentNo: number; accrualJournalEntryId: string | null }>;
  systemUser?: { id: string } | null;
  je?: { id: string; metadata: Record<string, unknown> } | null;
  contract?: Record<string, unknown> | null;
}

function buildHarness(overrides: Overrides = {}) {
  const created: {
    receipts: Record<string, unknown>[];
    todos: Record<string, unknown>[];
    auditLogs: Record<string, unknown>[];
  } = { receipts: [], todos: [], auditLogs: [] };

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
      findMany: jest.fn().mockResolvedValue(overrides.payments ?? []),
    },
    user: {
      findFirst: jest
        .fn()
        .mockResolvedValue(overrides.systemUser === undefined ? { id: 'sys-1' } : overrides.systemUser),
    },
    todo: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        created.todos.push(args.data);
        return { id: 'todo-1', ...args.data };
      }),
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
      expect(tx.todo.create).not.toHaveBeenCalled();
      expect(created.receipts).toHaveLength(1);

      const data = created.receipts[0] as Record<string, unknown> & {
        amount: Decimal;
        vatAmount: Decimal;
        amountBeforeVat: Decimal;
        publicToken: string;
        publicTokenExpiresAt: Date;
      };
      expect((data.amount as Decimal).toFixed(2)).toBe('4547.49');
      expect((data.vatAmount as Decimal).toFixed(2)).toBe('297.51');
      expect((data.amountBeforeVat as Decimal).toFixed(2)).toBe('4249.98');
      expect(data.receiptType).toBe('CREDIT_NOTE');
      expect(data.cnSource).toBe('WRITE_OFF');
      expect(data.sourceJournalEntryId).toBe('je-1');
      expect(data.payerName).toBe('ลูกค้าทดสอบ');
      expect(data.receiverName).toBe('BESTCHOICE FINANCE');

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

  describe('dirty gate — PARTIALLY_PAID among accrued-unpaid', () => {
    it('holds for CPA review instead of issuing a receipt/number', async () => {
      const { service, tx, created } = buildHarness({
        installments: buildInstallments(3),
        payments: [{ installmentNo: 1, status: 'PARTIALLY_PAID' }],
      });

      const result = await service.issueForContract(DEFAULT_INPUT, tx as any);

      expect(result).toEqual({ outcome: 'HELD_PARTIAL_PAID', todoId: 'todo-1' });
      expect(tx.receipt.create).not.toHaveBeenCalled();
      expect(created.receipts).toHaveLength(0);

      expect(tx.todo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: expect.stringContaining('CT-0001'),
            priority: 'HIGH',
            tags: ['credit-note-review'],
            createdById: 'sys-1',
          }),
        }),
      );
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CN_HELD_PARTIAL_PAID',
            entity: 'contract',
            entityId: 'contract-1',
          }),
        }),
      );
    });

    it('throws when no SYSTEM user exists (seed collections-foundation missing)', async () => {
      const { service, tx } = buildHarness({
        installments: buildInstallments(3),
        payments: [{ installmentNo: 1, status: 'PARTIALLY_PAID' }],
        systemUser: null,
      });

      await expect(service.issueForContract(DEFAULT_INPUT, tx as any)).rejects.toThrow(
        /SYSTEM user/,
      );
      expect(tx.todo.create).not.toHaveBeenCalled();
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
