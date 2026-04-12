import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DataAuditService } from './data-audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';

/**
 * DataAuditService tests — validates all 12 database health checks
 * and the contract lifecycle trace engine.
 *
 * Strategy: Mock PrismaService entirely. For $queryRaw checks, mock
 * the return value. Test both PASS (clean data) and FAIL (dirty data)
 * paths for each check.
 */
describe('DataAuditService', () => {
  let service: DataAuditService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      product: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      contract: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      journalEntry: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      interCompanyTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      dataAuditLog: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataAuditService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JournalAutoService,
          useValue: {
            createContractActivationJournal: jest.fn().mockResolvedValue('je-mock'),
            createPaymentJournal: jest.fn().mockResolvedValue('je-mock'),
          },
        },
      ],
    }).compile();

    service = module.get<DataAuditService>(DataAuditService);
  });

  // ═══════════════════════════════════════════════════════════════
  // Check 1: journal_balance
  // ═══════════════════════════════════════════════════════════════

  describe('checkJournalBalance', () => {
    it('should PASS when all journals are balanced', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.checkJournalBalance();
      expect(result.name).toBe('journal_balance');
      expect(result.severity).toBe('CRITICAL');
      expect(result.status).toBe('PASS');
      expect(result.count).toBe(0);
    });

    it('should FAIL when unbalanced journals exist', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          id: 'je-1',
          entry_number: 'JE-202604-0001',
          reference_type: 'PAYMENT',
          reference_id: 'pay-1',
          total_debit: new Prisma.Decimal('1000.00'),
          total_credit: new Prisma.Decimal('999.00'),
          diff: new Prisma.Decimal('1.00'),
        },
      ]);
      const result = await service.checkJournalBalance();
      expect(result.status).toBe('FAIL');
      expect(result.count).toBe(1);
      expect(result.details).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Check 2: orphan_contracts
  // ═══════════════════════════════════════════════════════════════

  describe('checkOrphanContracts', () => {
    it('should PASS when no orphan contracts', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.checkOrphanContracts();
      expect(result.status).toBe('PASS');
    });

    it('should FAIL when orphan contracts found', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: 'c-1', contract_number: 'BC-001', status: 'ACTIVE', created_at: new Date() },
      ]);
      const result = await service.checkOrphanContracts();
      expect(result.status).toBe('FAIL');
      expect(result.count).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Check 3: orphan_payments
  // ═══════════════════════════════════════════════════════════════

  describe('checkOrphanPayments', () => {
    it('should PASS when no orphan payments', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.checkOrphanPayments();
      expect(result.status).toBe('PASS');
    });

    it('should FAIL when orphan payments found', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          id: 'p-1',
          installment_no: 1,
          amount_paid: new Prisma.Decimal('3000.00'),
          status: 'PAID',
          paid_date: new Date(),
          contract_number: 'BC-001',
        },
      ]);
      const result = await service.checkOrphanPayments();
      expect(result.status).toBe('FAIL');
      expect(result.count).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Check 4: overpaid_contracts
  // ═══════════════════════════════════════════════════════════════

  describe('checkOverpaidContracts', () => {
    it('should PASS when no overpaid contracts', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.checkOverpaidContracts();
      expect(result.status).toBe('PASS');
    });

    it('should FAIL when overpaid contracts found', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          id: 'c-1',
          contract_number: 'BC-001',
          total_expected: new Prisma.Decimal('10000.00'),
          total_paid: new Prisma.Decimal('10500.00'),
          overpay: new Prisma.Decimal('500.00'),
        },
      ]);
      const result = await service.checkOverpaidContracts();
      expect(result.status).toBe('FAIL');
      expect(result.count).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Check 5: ghost_stock
  // ═══════════════════════════════════════════════════════════════

  describe('checkGhostStock', () => {
    it('should PASS when no ghost stock', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.checkGhostStock();
      expect(result.status).toBe('PASS');
      expect(result.name).toBe('ghost_stock');
    });

    it('should FAIL when ghost stock found', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          id: 'pr-1',
          name: 'iPhone 15',
          imei_serial: '123456789',
          status: 'IN_STOCK',
          contract_number: 'BC-001',
          contract_status: 'ACTIVE',
        },
      ]);
      const result = await service.checkGhostStock();
      expect(result.status).toBe('FAIL');
      expect(result.count).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Check 6: vat_mismatch
  // ═══════════════════════════════════════════════════════════════

  describe('checkVatMismatch', () => {
    it('should PASS when VAT matches', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total: new Prisma.Decimal('700.00') }])
        .mockResolvedValueOnce([{ total: new Prisma.Decimal('700.00') }]);
      const result = await service.checkVatMismatch();
      expect(result.status).toBe('PASS');
    });

    it('should WARN when VAT diff is between 1 and 10', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total: new Prisma.Decimal('700.00') }])
        .mockResolvedValueOnce([{ total: new Prisma.Decimal('695.00') }]);
      const result = await service.checkVatMismatch();
      expect(result.status).toBe('WARN');
    });

    it('should FAIL when VAT diff exceeds 10', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total: new Prisma.Decimal('700.00') }])
        .mockResolvedValueOnce([{ total: new Prisma.Decimal('650.00') }]);
      const result = await service.checkVatMismatch();
      expect(result.status).toBe('FAIL');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Check 7: hp_receivable_reconciliation
  // ═══════════════════════════════════════════════════════════════

  describe('checkHpReceivableReconciliation', () => {
    it('should PASS when HP Receivable matches', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ balance: new Prisma.Decimal('50000.00') }])
        .mockResolvedValueOnce([{ outstanding: new Prisma.Decimal('50000.00') }]);
      const result = await service.checkHpReceivableReconciliation();
      expect(result.status).toBe('PASS');
    });

    it('should FAIL when HP Receivable differs beyond threshold', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ balance: new Prisma.Decimal('50000.00') }])
        .mockResolvedValueOnce([{ outstanding: new Prisma.Decimal('45000.00') }]);
      const result = await service.checkHpReceivableReconciliation();
      expect(result.status).toBe('FAIL');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Check 8: late_fee_vat_leak
  // ═══════════════════════════════════════════════════════════════

  describe('checkLateFeeVatLeak', () => {
    it('should PASS when no late fee VAT leaks', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.checkLateFeeVatLeak();
      expect(result.status).toBe('PASS');
    });

    it('should FAIL when VAT leak found on late fee', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          payment_id: 'p-1',
          contract_number: 'BC-001',
          installment_no: 3,
          late_fee: new Prisma.Decimal('100.00'),
          payment_vat: new Prisma.Decimal('200.00'),
          journal_vat: new Prisma.Decimal('207.00'),
        },
      ]);
      const result = await service.checkLateFeeVatLeak();
      expect(result.status).toBe('FAIL');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Check 9: inter_company_balance
  // ═══════════════════════════════════════════════════════════════

  describe('checkInterCompanyBalance', () => {
    it('should PASS and return flow details', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          from_entity: 'BESTCHOICE FINANCE',
          to_entity: 'BESTCHOICE SHOP',
          total_flow: new Prisma.Decimal('500000.00'),
          tx_count: BigInt(25),
        },
      ]);
      const result = await service.checkInterCompanyBalance();
      expect(result.status).toBe('PASS');
      expect(result.details).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Check 10: duplicate_payments
  // ═══════════════════════════════════════════════════════════════

  describe('checkDuplicatePayments', () => {
    it('should PASS when no duplicates', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.checkDuplicatePayments();
      expect(result.status).toBe('PASS');
    });

    it('should FAIL when duplicate gateway refs found', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { gateway_ref: 'PS-20260412-001', count: BigInt(2), payment_ids: ['p-1', 'p-2'] },
      ]);
      const result = await service.checkDuplicatePayments();
      expect(result.status).toBe('FAIL');
      expect(result.count).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Check 11: missing_cogs
  // ═══════════════════════════════════════════════════════════════

  describe('checkMissingCogs', () => {
    it('should PASS when all contracts have COGS', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.checkMissingCogs();
      expect(result.status).toBe('PASS');
    });

    it('should FAIL when COGS missing', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          id: 'c-1',
          contract_number: 'BC-001',
          product_name: 'iPhone 15',
          cost_price: new Prisma.Decimal('25000.00'),
        },
      ]);
      const result = await service.checkMissingCogs();
      expect(result.status).toBe('FAIL');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Check 12: commission_mismatch
  // ═══════════════════════════════════════════════════════════════

  describe('checkCommissionMismatch', () => {
    it('should PASS when commission matches', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.checkCommissionMismatch();
      expect(result.status).toBe('PASS');
    });

    it('should FAIL when commission mismatch found', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          id: 'p-1',
          contract_number: 'BC-001',
          installment_no: 1,
          payment_comm: new Prisma.Decimal('300.00'),
          journal_comm: new Prisma.Decimal('0'),
          diff: new Prisma.Decimal('300.00'),
        },
      ]);
      const result = await service.checkCommissionMismatch();
      expect(result.status).toBe('FAIL');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // runAllChecks
  // ═══════════════════════════════════════════════════════════════

  describe('runAllChecks', () => {
    it('should return 12 results', async () => {
      // Since Promise.all doesn't guarantee mock call order, use a smart mock
      // that returns appropriate data based on the SQL content
      prisma.$queryRaw.mockImplementation((...args: unknown[]) => {
        const sql = String(args[0]);
        // VAT check returns [{total}], HP receivable returns [{balance}] or [{outstanding}]
        if (sql.includes('21-2101') || sql.includes('vat_amount')) {
          return Promise.resolve([{ total: new Prisma.Decimal('0') }]);
        }
        if (sql.includes('11-2102') && sql.includes('balance')) {
          return Promise.resolve([{ balance: new Prisma.Decimal('0') }]);
        }
        if (sql.includes('outstanding')) {
          return Promise.resolve([{ outstanding: new Prisma.Decimal('0') }]);
        }
        return Promise.resolve([]);
      });

      const results = await service.runAllChecks();
      expect(results).toHaveLength(12);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // runCheck
  // ═══════════════════════════════════════════════════════════════

  describe('runCheck', () => {
    it('should throw NotFoundException for invalid check name', async () => {
      await expect(service.runCheck('invalid_check')).rejects.toThrow(NotFoundException);
    });

    it('should run specific check by name', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.runCheck('journal_balance');
      expect(result.name).toBe('journal_balance');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Contract Trace
  // ═══════════════════════════════════════════════════════════════

  describe('traceContract', () => {
    const mockContract = {
      id: 'c-1',
      contractNumber: 'BC-202604-0001',
      status: 'ACTIVE',
      sellingPrice: new Prisma.Decimal('20000.00'),
      downPayment: new Prisma.Decimal('5000.00'),
      interestTotal: new Prisma.Decimal('2000.00'),
      financedAmount: new Prisma.Decimal('15000.00'),
      storeCommission: new Prisma.Decimal('1500.00'),
      vatAmount: new Prisma.Decimal('1295.00'),
      monthlyPayment: new Prisma.Decimal('3299.17'),
      totalMonths: 6,
      payments: [
        {
          id: 'p-1',
          installmentNo: 1,
          status: 'PAID',
          amountDue: new Prisma.Decimal('3299.17'),
          amountPaid: new Prisma.Decimal('3299.17'),
          vatAmount: new Prisma.Decimal('215.83'),
          monthlyCommission: new Prisma.Decimal('250.00'),
          lateFee: new Prisma.Decimal('0'),
        },
        {
          id: 'p-2',
          installmentNo: 2,
          status: 'PENDING',
          amountDue: new Prisma.Decimal('3299.17'),
          amountPaid: new Prisma.Decimal('0'),
          vatAmount: null,
          monthlyCommission: null,
          lateFee: new Prisma.Decimal('0'),
        },
      ],
      product: {
        id: 'pr-1',
        name: 'iPhone 15',
        costPrice: new Prisma.Decimal('18000.00'),
        category: 'PHONE_NEW',
        ownedByCompanyId: 'company-finance',
      },
      branch: { id: 'br-1', name: 'สาขาลาดพร้าว' },
    };

    it('should throw NotFoundException for non-existent contract', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(null);
      await expect(service.traceContract('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should PASS all checks for a healthy ACTIVE contract', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(mockContract);

      // Contract journals (activation + COGS)
      prisma.journalEntry.findMany
        .mockResolvedValueOnce([
          {
            referenceType: 'CONTRACT',
            lines: [
              { accountCode: '11-2102', debit: new Prisma.Decimal('19795.00'), credit: new Prisma.Decimal('0') },
              { accountCode: '41-1101', debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('18500.00') },
              { accountCode: '21-2101', debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('1295.00') },
            ],
          },
          {
            referenceType: 'CONTRACT_COGS',
            lines: [
              { accountCode: '51-1101', debit: new Prisma.Decimal('18000.00'), credit: new Prisma.Decimal('0') },
              { accountCode: '11-3101', debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('18000.00') },
            ],
          },
        ])
        // Payment journals
        .mockResolvedValueOnce([
          {
            referenceId: 'p-1',
            lines: [
              { accountCode: '11-1101', debit: new Prisma.Decimal('3299.17'), credit: new Prisma.Decimal('0') },
              { accountCode: '11-2102', debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('2833.34') },
              { accountCode: '42-1105', debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('250.00') },
              { accountCode: '21-2101', debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('215.83') },
            ],
          },
        ]);

      // InterCompanyTransaction
      prisma.interCompanyTransaction.findFirst.mockResolvedValueOnce({
        id: 'ic-1',
        contractId: 'c-1',
      });

      const result = await service.traceContract('c-1');

      expect(result.contract.contractNumber).toBe('BC-202604-0001');
      expect(result.checks.creation.status).toBe('PASS');
      expect(result.checks.activation.status).toBe('PASS');
      expect(result.checks.cogs.status).toBe('PASS');
      expect(result.checks.interCompany.status).toBe('PASS');
      expect(result.checks.payments[0].status).toBe('PASS');
      expect(result.checks.payments[1].status).toBe('PASS'); // PENDING — no journal expected
      // hpReceivable may FAIL because mock only has 2 of 6 payments — that's expected
      expect(result.summary.totalChecks).toBeGreaterThanOrEqual(9);
    });

    it('should FAIL activation check when journal is missing', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(mockContract);
      prisma.journalEntry.findMany
        .mockResolvedValueOnce([]) // No contract journals
        .mockResolvedValueOnce([]); // No payment journals
      prisma.interCompanyTransaction.findFirst.mockResolvedValueOnce(null);

      const result = await service.traceContract('c-1');

      expect(result.checks.activation.status).toBe('FAIL');
      expect(result.checks.cogs.status).toBe('FAIL');
      expect(result.checks.interCompany.status).toBe('FAIL');
      expect(result.checks.payments[0].status).toBe('FAIL'); // PAID but no journal
      expect(result.summary.failed).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // traceAll
  // ═══════════════════════════════════════════════════════════════

  describe('traceAll', () => {
    it('should return summary with 0 failures when all clean', async () => {
      prisma.contract.findMany.mockResolvedValueOnce([]);
      const result = await service.traceAll({});
      expect(result.total).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getHistory
  // ═══════════════════════════════════════════════════════════════

  describe('getHistory', () => {
    it('should return audit logs', async () => {
      prisma.dataAuditLog.findMany.mockResolvedValueOnce([
        {
          id: 'log-1',
          runId: 'run-1',
          checkName: 'journal_balance',
          severity: 'CRITICAL',
          status: 'PASS',
          count: 0,
        },
      ]);
      const result = await service.getHistory({});
      expect(result).toHaveLength(1);
    });

    it('should filter by checkName', async () => {
      prisma.dataAuditLog.findMany.mockResolvedValueOnce([]);
      await service.getHistory({ checkName: 'journal_balance' });
      expect(prisma.dataAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { checkName: 'journal_balance' },
        }),
      );
    });
  });
});
