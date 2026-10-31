import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DataAuditService } from './data-audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { DataAuditChecksService } from './services/data-audit-checks.service';
import { ContractTraceService } from './services/contract-trace.service';
import { AuditFindingsService } from './services/audit-findings.service';
import { AuditBackfillService } from './services/audit-backfill.service';

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
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataAuditService,
        DataAuditChecksService,
        ContractTraceService,
        AuditFindingsService,
        AuditBackfillService,
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

    it('Task 23 — the nightly run caps details at 50; the contract trace reads every row of its scope (same SQL, no LIMIT)', async () => {
      await service.checkOrphanPayments();
      expect(JSON.stringify(prisma.$queryRaw.mock.calls[0])).toContain('LIMIT 50');

      prisma.contract.findUnique.mockResolvedValueOnce({
        id: 'c-1',
        contractNumber: 'BC-1',
        status: 'ACTIVE',
        legacyContractCode: null,
        payments: [],
        product: null,
        branch: null,
      });
      await service.traceContract('c-1');
      const traceCall = prisma.$queryRaw.mock.calls
        .slice(1)
        .find((c: unknown[]) => JSON.stringify(c).includes('backed_payment'));
      expect(JSON.stringify(traceCall)).not.toContain('LIMIT');
      expect(traceCall).toEqual(
        expect.arrayContaining([expect.objectContaining({ values: ['c-1'] })]),
      );
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

    const candidate = (amountPaid: string) => ({
      payment_id: 'p-1',
      contract_id: 'c-1',
      contract_number: 'BC-001',
      installment_no: 3,
      amount_due: new Prisma.Decimal('1515.83'),
      amount_paid: new Prisma.Decimal(amountPaid),
    });

    it('should FAIL when an installment is paid beyond its billing + 1.00 and no fee explains it', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([candidate('1600.00')]);
      const result = await service.checkOverpaidContracts();
      expect(result.status).toBe('FAIL');
      expect(result.count).toBe(1);
      expect(result.details).toEqual([
        { id: 'c-1', contract_number: 'BC-001', installment_nos: [3], overpay: '84.17' },
      ]);
    });

    it('should PASS when the excess is the late fee received on that installment (amountPaid includes fees)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([candidate('1615.83')]);
      prisma.journalEntry.findMany.mockResolvedValueOnce([
        {
          status: 'POSTED',
          deletedAt: null,
          metadata: { tag: 'receipt', paymentId: 'p-1' },
          lines: [
            {
              accountCode: '42-1103',
              debit: new Prisma.Decimal(0),
              credit: new Prisma.Decimal(100),
              deletedAt: null,
            },
          ],
        },
      ]);
      const result = await service.checkOverpaidContracts();
      expect(result.status).toBe('PASS');
      expect(result.count).toBe(0);
    });

    it('excludes imported rows untouched since the cutover in SQL', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      await service.checkOverpaidContracts();
      const sql = JSON.stringify(prisma.$queryRaw.mock.calls[0]);
      expect(sql).toContain('legacy_installment_code IS NOT NULL');
      expect(sql).toContain('legacy-import@bestchoice.com');
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
    const vatRow = (vatReceivable: string, vatDeferred: string) => ({
      contract_id: 'c-1',
      contract_number: 'BC-001',
      vat_receivable: new Prisma.Decimal(vatReceivable),
      vat_deferred: new Prisma.Decimal(vatDeferred),
    });

    it('should PASS when no contract has the deferred VAT legs apart', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.checkVatMismatch();
      expect(result.status).toBe('PASS');
      expect(result.count).toBe(0);
    });

    it('should FAIL when 11-2105 and 21-2102 differ and no advance VAT explains it', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([vatRow('793.32', '693.32')]);
      const result = await service.checkVatMismatch();
      expect(result.status).toBe('FAIL');
      expect(result.count).toBe(1);
      expect(result.details[0]).toMatchObject({ contractId: 'c-1', diff: '100.00' });
    });

    it('should PASS when the gap equals the VAT of customer advances still outstanding', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([vatRow('793.32', '760.61')]);
      prisma.journalEntry.findMany.mockResolvedValueOnce([
        { metadata: { contractId: 'c-1', advanceVatPark: '32.71' } },
      ]);
      const result = await service.checkVatMismatch();
      expect(result.status).toBe('PASS');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Check 7: hp_receivable_reconciliation
  // ═══════════════════════════════════════════════════════════════

  describe('checkHpReceivableReconciliation', () => {
    const gapRow = (id: string, gl: string, register: string) => ({
      contract_id: id,
      contract_number: `BC-${id}`,
      branch_id: 'b-1',
      gl_receivable: new Prisma.Decimal(gl),
      register_outstanding: new Prisma.Decimal(register),
    });

    it('should PASS when every contract is within 1.00 (rounding)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        gapRow('1', '12849.19', '12849.19'),
        gapRow('2', '9093.00', '9092.00'),
      ]);
      const result = await service.checkHpReceivableReconciliation();
      expect(result.status).toBe('PASS');
      expect(result.details[0]).toMatchObject({ contractsChecked: 2, gap: '1.00', breaches: [] });
    });

    it('should FAIL per contract beyond 1.00 even when the company total nets out', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        gapRow('1', '1100.00', '1000.00'),
        gapRow('2', '1000.00', '1100.00'),
      ]);
      const result = await service.checkHpReceivableReconciliation();
      expect(result.status).toBe('FAIL');
      expect(result.count).toBe(2);
      expect(result.details[0]).toMatchObject({ gap: '0.00' });
    });

    it('reads the receivable accounts, never the allowance 11-2102', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      await service.checkHpReceivableReconciliation();
      const sql = JSON.stringify(prisma.$queryRaw.mock.calls[0]);
      expect(sql).toContain('11-2103');
      expect(sql).not.toContain('11-2102');
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

    const receiptVatRow = (
      outputVat: string,
      park: string | null = null,
      consume: string | null = null,
    ) => ({
      payment_id: 'p-1',
      contract_number: 'BC-001',
      installment_no: 3,
      late_fee: new Prisma.Decimal('100.00'),
      entry_number: 'JE-202605-00001',
      output_vat: new Prisma.Decimal(outputVat),
      advance_vat_park: park,
      advance_vat_consume: consume,
    });

    it('Task 18 — should FAIL when a receipt entry of a late-fee row books 21-2101 beyond its stamped advance VAT (VAT on the fee)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([receiptVatRow('6.54')]);
      const result = await service.checkLateFeeVatLeak();
      expect(result.status).toBe('FAIL');
      expect(result.count).toBe(1);
      expect(result.details[0]).toMatchObject({
        payment_id: 'p-1',
        installment_no: 3,
        output_vat: '6.54',
        advance_vat: '0.00',
        unexplained_vat: '6.54',
      });
    });

    it('Task 18 — should PASS when the receipt entry moves 21-2101 only by its stamped advance VAT (park − consume)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        receiptVatRow('32.71', '32.71'),
        receiptVatRow('-16.36', null, '16.36'),
        receiptVatRow('16.35', '32.71', '16.36'),
      ]);
      const result = await service.checkLateFeeVatLeak();
      expect(result.status).toBe('PASS');
      expect(result.count).toBe(0);
    });

    it('Task 18 — reads the receipt entries bound by metadata.paymentId (not Payment.vatAmount) and exempts imported rows untouched since the cutover', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      await service.checkLateFeeVatLeak();
      const sql = JSON.stringify(prisma.$queryRaw.mock.calls[0]);
      expect(sql).toContain("je.metadata->>'paymentId' = p.id");
      expect(sql).toContain("jl.account_code = '21-2101'");
      expect(sql).not.toContain('vat_amount');
      expect(sql).toContain('legacy_installment_code IS NOT NULL');
      expect(prisma.$queryRaw.mock.calls[0]).toEqual(
        expect.arrayContaining(['advanceVatPark', 'advanceVatConsume']),
      );
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

    it('Task 18 — looks for the SHOP COGS entry of activation by metadata.contractId (never reference_type CONTRACT_COGS) and exempts imported legacy contracts', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      await service.checkMissingCogs();
      const sql = JSON.stringify(prisma.$queryRaw.mock.calls[0]);
      expect(sql).toContain("metadata->>'contractId' = c.id");
      expect(sql).toContain("metadata->>'flow' = ");
      expect(prisma.$queryRaw.mock.calls[0]).toContain('shop-inventory-transfer-cogs');
      expect(sql).toContain('c.legacy_contract_code IS NULL');
      expect(sql).not.toContain('CONTRACT_COGS');
      expect(sql).not.toContain('reference_type');
    });

    // Task 23 (Task 18 review m-3) — contracts opened before the SHOP leg was wired (2026-06-23) carry no SHOP
    // activation leg by design: exempt by the inter-co `legacyNoShop` rule (S11-3001 + S11-3002 of the contract = 0)
    // AND an opening entry posted before the wiring day ended — never by one half alone.
    const cogsCandidate = (id: string) => ({
      id,
      contract_number: `BC-${id}`,
      product_name: 'iPhone 15',
      cost_price: new Prisma.Decimal('9000.00'),
    });
    const routeCogs = (rows: { candidates: unknown[]; lens?: unknown[]; opened?: unknown[] }) =>
      prisma.$queryRaw.mockImplementation(async (...args: unknown[]) => {
        const sql = JSON.stringify(args);
        if (sql.includes('shop-inventory-transfer-cogs')) return rows.candidates;
        if (sql.includes('S11-3001')) return rows.lens ?? [];
        if (sql.includes('MIN(je.posted_at)')) return rows.opened ?? [];
        return [];
      });

    it('Task 23 — exempts a contract opened before the SHOP wiring whose SHOP book has no FINANCE receivable (legacyNoShop)', async () => {
      routeCogs({
        candidates: [cogsCandidate('c-1')],
        opened: [{ contract_id: 'c-1', activated_at: new Date('2026-06-23T10:00:00+07:00') }],
      });
      const result = await service.checkMissingCogs();
      expect([result.status, result.count]).toEqual(['PASS', 0]);
      const lensSql = JSON.stringify(
        prisma.$queryRaw.mock.calls.find((c: unknown[]) => JSON.stringify(c).includes('S11-3001')),
      );
      expect(lensSql).toContain("je.metadata->>'contractId' IN ("); // scoped to the candidates
    });

    it('Task 23 — still FAIL when only one half holds: SHOP leg exists (pre-wiring) · opened after the wiring · no opening entry', async () => {
      routeCogs({
        candidates: [cogsCandidate('c-shop'), cogsCandidate('c-late'), cogsCandidate('c-none')],
        lens: [{ contract_id: 'c-shop', financed: '10000.00', commission: '1000.00' }],
        opened: [
          { contract_id: 'c-shop', activated_at: new Date('2025-01-05T10:00:00+07:00') },
          { contract_id: 'c-late', activated_at: new Date('2026-06-24T00:00:00+07:00') },
        ],
      });
      const result = await service.checkMissingCogs();
      expect(result.status).toBe('FAIL');
      expect((result.details as { id: string }[]).map((r) => r.id)).toEqual([
        'c-shop',
        'c-late',
        'c-none',
      ]);
    });

    it('Task 23 — exemption is decided after an uncapped candidate query (exempt rows cannot hide a failing one); details stay capped at 50', async () => {
      const candidates = Array.from({ length: 60 }, (_, i) => cogsCandidate(`c-${i}`));
      routeCogs({ candidates });
      const result = await service.checkMissingCogs();
      expect([result.count, result.details.length]).toEqual([60, 50]);
      const candidateSql = JSON.stringify(
        prisma.$queryRaw.mock.calls.find((c: unknown[]) =>
          JSON.stringify(c).includes('shop-inventory-transfer-cogs'),
        ),
      );
      expect(candidateSql).not.toContain('LIMIT');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Check 12: commission_mismatch
  // ═══════════════════════════════════════════════════════════════

  describe('checkCommissionMismatch', () => {
    it('Task 18 — SKIPPED with a dated reason (commission is booked once at activation, not per receipt) — never a FAIL, reads nothing', async () => {
      const result = await service.checkCommissionMismatch();
      expect(result).toMatchObject({
        name: 'commission_mismatch',
        severity: 'MEDIUM',
        status: 'SKIPPED',
        count: 0,
      });
      expect(result.details[0]).toMatchObject({ skippedSince: '2026-10-30' });
      expect(JSON.stringify(result.details)).toContain('21-1102');
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // runAllChecks
  // ═══════════════════════════════════════════════════════════════

  describe('runAllChecks', () => {
    it('should return 12 results', async () => {
      // Every check reads a row list (none indexes [0] any more) — an empty DB passes all of them;
      // commission_mismatch is SKIPPED (Task 18), not a finding.
      prisma.$queryRaw.mockResolvedValue([]);

      const results = await service.runAllChecks();
      expect(results).toHaveLength(12);
      expect(results.filter((r) => r.status !== 'PASS').map((r) => [r.name, r.status])).toEqual([
        ['commission_mismatch', 'SKIPPED'],
      ]);
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
    // Task 18 — the trace reads today's ledger model (Phase A.4): opening entry 1A / A.1 / legacy opening by
    // metadata.contractId · SHOP activation legs (COGS + inter-company receivable) by flow · payments backed
    // the way orphan_payments backs them · HP receivable / VAT = the nightly checks scoped to the contract ·
    // commission SKIPPED (booked once at activation, never per receipt).
    const D = (v: string) => new Prisma.Decimal(v);
    const line = (accountCode: string, debit: string, credit: string) => ({
      accountCode,
      debit: D(debit),
      credit: D(credit),
    });
    const mockContract = (overrides: Record<string, unknown> = {}) => ({
      id: 'c-1',
      contractNumber: 'BC-202604-0001',
      status: 'ACTIVE',
      legacyContractCode: null,
      payments: [
        {
          id: 'p-1',
          installmentNo: 1,
          status: 'PAID',
          amountDue: D('1515.83'),
          amountPaid: D('1515.83'),
          vatAmount: D('99.17'),
          monthlyCommission: D('83.33'),
          lateFee: D('0'),
        },
        {
          // paid by the nightly 2A advance consumption — no entry carries its paymentId
          id: 'p-2',
          installmentNo: 2,
          status: 'PAID',
          amountDue: D('1515.83'),
          amountPaid: D('1515.83'),
          vatAmount: D('99.17'),
          monthlyCommission: D('83.33'),
          lateFee: D('0'),
        },
        {
          id: 'p-3',
          installmentNo: 3,
          status: 'PENDING',
          amountDue: D('1515.83'),
          amountPaid: D('0'),
          vatAmount: D('99.17'),
          monthlyCommission: D('83.33'),
          lateFee: D('0'),
        },
      ],
      product: {
        id: 'pr-1',
        name: 'iPhone 15',
        costPrice: D('9000.00'),
        category: 'PHONE_USED',
        ownedByCompanyId: 'company-finance',
      },
      branch: { id: 'br-1', name: 'สาขาลาดพร้าว' },
      ...overrides,
    });
    const opening1A = {
      metadata: { tag: '1A', contractId: 'c-1' },
      lines: [
        line('11-2101', '17000.00', '0'),
        line('11-2105', '1190.00', '0'),
        line('21-1101', '0', '10000.00'),
        line('21-1102', '0', '1000.00'),
        line('11-2106', '0', '6000.00'),
        line('21-2102', '0', '1190.00'),
      ],
    };
    const shopCogs = {
      metadata: { flow: 'shop-inventory-transfer-cogs', contractId: 'c-1' },
      lines: [line('S50-1102', '9000.00', '0'), line('S11-2002', '0', '9000.00')],
    };
    const shopRevenue = {
      metadata: { flow: 'shop-inventory-transfer-revenue', contractId: 'c-1' },
      lines: [
        line('S11-3001', '10000.00', '0'),
        line('S11-3002', '1000.00', '0'),
        line('S21-2001', '2000.00', '0'),
        line('S41-1102', '0', '12000.00'),
        line('S41-1201', '0', '1000.00'),
      ],
    };
    const receiptP1 = (extra: Record<string, unknown> = {}) => ({
      referenceId: 'random-uuid-not-the-payment-id',
      metadata: { paymentId: 'p-1', tag: 'receipt', flow: 'payment-receipt' },
      lines: [line('11-1101', '1515.83', '0'), line('11-2103', '0', '1515.83')],
      ...extra,
    });
    /** $queryRaw of the scoped nightly checks the trace reuses — routed by the SQL they send */
    const routeChecks = (rows: {
      orphanContracts?: unknown[];
      missingCogs?: unknown[];
      orphanPayments?: unknown[];
      vat?: unknown[];
      gaps?: unknown[];
    }) =>
      prisma.$queryRaw.mockImplementation(async (...args: unknown[]) => {
        const sql = JSON.stringify(args);
        if (sql.includes('c.status, c.created_at')) return rows.orphanContracts ?? [];
        if (sql.includes('shop-inventory-transfer-cogs')) return rows.missingCogs ?? [];
        if (sql.includes('backed_payment')) return rows.orphanPayments ?? [];
        if (sql.includes('vat_receivable')) return rows.vat ?? [];
        if (sql.includes('register_outstanding')) return rows.gaps ?? [];
        return [];
      });
    const orphanContractRow = { id: 'c-1', contract_number: 'BC-202604-0001', status: 'ACTIVE' };
    const missingCogsRow = {
      id: 'c-1',
      contract_number: 'BC-202604-0001',
      product_name: 'iPhone 15',
      cost_price: D('9000.00'),
    };
    const gapRow = (gl: string, register: string) => ({
      contract_id: 'c-1',
      contract_number: 'BC-202604-0001',
      branch_id: 'br-1',
      gl_receivable: D(gl),
      register_outstanding: D(register),
    });

    it('should throw NotFoundException for non-existent contract', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(null);
      await expect(service.traceContract('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('Task 18 — a healthy A.4 contract passes every check (1A by tag · SHOP legs by flow · a row paid without a paymentId entry is backed) and commission is SKIPPED', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(mockContract());
      prisma.journalEntry.findMany
        .mockResolvedValueOnce([opening1A, shopCogs, shopRevenue])
        .mockResolvedValueOnce([receiptP1()]);
      routeChecks({ gaps: [gapRow('1515.83', '1515.83')] });

      const result = await service.traceContract('c-1');

      expect(result.contract.contractNumber).toBe('BC-202604-0001');
      const statuses = Object.fromEntries(
        Object.entries(result.checks).map(([name, check]) => [
          name,
          Array.isArray(check) ? check.map((c) => c.status) : check.status,
        ]),
      );
      expect(statuses).toEqual({
        creation: 'PASS',
        activation: 'PASS',
        cogs: 'PASS',
        interCompany: 'PASS',
        payments: ['PASS', 'PASS', 'PASS'],
        hpReceivable: 'PASS',
        vatTotal: 'PASS',
        commissionTotal: 'SKIPPED',
        completion: 'PASS',
      });
      expect(result.summary).toMatchObject({ failed: 0, skipped: 1 });
      expect(result.checks.payments[1].details).toMatchObject({ backedWithoutPaymentId: true });
    });

    it('Task 18 — reads the contract entries by metadata.contractId (never reference_type CONTRACT / CONTRACT_COGS)', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(mockContract());
      routeChecks({});
      await service.traceContract('c-1');
      expect(prisma.journalEntry.findMany.mock.calls[0][0].where).toEqual({
        metadata: { path: ['contractId'], equals: 'c-1' },
        deletedAt: null,
        status: 'POSTED',
      });
      expect(JSON.stringify(prisma.journalEntry.findMany.mock.calls)).not.toContain('CONTRACT');
    });

    it('Task 18 — missing opening / SHOP legs / payment backing / receivable gap all FAIL', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(mockContract());
      prisma.journalEntry.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      routeChecks({
        orphanContracts: [orphanContractRow],
        missingCogs: [missingCogsRow],
        orphanPayments: [
          { id: 'p-1', installment_no: 1 },
          { id: 'p-2', installment_no: 2 },
        ],
        gaps: [gapRow('3031.66', '1515.83')],
      });

      const result = await service.traceContract('c-1');

      expect([
        result.checks.activation.status,
        result.checks.cogs.status,
        result.checks.interCompany.status,
        result.checks.payments.map((p) => p.status),
        result.checks.hpReceivable.status,
      ]).toEqual(['FAIL', 'FAIL', 'FAIL', ['FAIL', 'FAIL', 'PASS'], 'FAIL']);
      expect(result.checks.hpReceivable.details).toMatchObject({ gap: '1515.83' });
      expect(result.summary.failed).toBe(6);
    });

    it('Task 18 — VAT is the per-contract deferred-VAT identity (vat_mismatch scoped to the contract), not 21-2101 vs Payment.vatAmount', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(mockContract());
      prisma.journalEntry.findMany
        .mockResolvedValueOnce([opening1A, shopCogs, shopRevenue])
        .mockResolvedValueOnce([receiptP1()]);
      routeChecks({
        vat: [
          {
            contract_id: 'c-1',
            contract_number: 'BC-202604-0001',
            vat_receivable: D('1190.00'),
            vat_deferred: D('1090.00'),
          },
        ],
      });

      const result = await service.traceContract('c-1');

      expect(result.checks.vatTotal.status).toBe('FAIL');
      expect(result.checks.vatTotal.details).toMatchObject([{ contractId: 'c-1', diff: '100.00' }]);
      const vatCall = prisma.$queryRaw.mock.calls.find((c: unknown[]) =>
        JSON.stringify(c).includes('vat_receivable'),
      );
      expect(JSON.stringify(vatCall)).toContain('c-1'); // scope.contractIds = [this contract]
    });

    it('Task 18 — an imported legacy history contract (no schedule, PEAK holds its books) is not flagged for opening / SHOP legs', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(
        mockContract({
          status: 'COMPLETED',
          legacyContractCode: 'LEG-0001',
          payments: [
            {
              id: 'p-1',
              installmentNo: 1,
              status: 'PAID',
              amountDue: D('1515.83'),
              amountPaid: D('1515.83'),
              vatAmount: D('99.17'),
              monthlyCommission: D('83.33'),
              lateFee: D('0'),
            },
            {
              // the old system's last installment received a few satang short ⇒ PARTIALLY_PAID on a COMPLETED contract
              id: 'p-2',
              installmentNo: 2,
              status: 'PARTIALLY_PAID',
              amountDue: D('1515.87'),
              amountPaid: D('1515.83'),
              vatAmount: D('99.17'),
              monthlyCommission: D('83.33'),
              lateFee: D('0'),
            },
          ],
          product: {
            id: 'pr-1',
            name: 'iPhone 11',
            costPrice: D('0'),
            category: 'PHONE_USED',
            ownedByCompanyId: null,
          },
        }),
      );
      routeChecks({}); // orphan_contracts exempts the history contract · orphan_payments the untouched imported row

      const result = await service.traceContract('c-1');

      expect([
        result.checks.activation.status,
        result.checks.cogs.status,
        result.checks.interCompany.status,
        result.checks.payments.map((p) => p.status),
        result.checks.completion.status,
      ]).toEqual(['PASS', 'PASS', 'PASS', ['PASS', 'PASS'], 'PASS']);
      expect(result.summary.failed).toBe(0);
    });

    it('Task 23 (m-4) — opening / COGS verdicts are the nightly checks scoped to the contract (one rule, the nightly status set) — an EARLY_PAYOFF contract without entries is out of scope', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(
        mockContract({ status: 'EARLY_PAYOFF', payments: [] }),
      );
      prisma.journalEntry.findMany.mockResolvedValueOnce([]);
      routeChecks({});

      const result = await service.traceContract('c-1');

      // เดิม trace เขียนเงื่อนไขซ้ำด้วยชุดสถานะของตัวเอง (รวม EARLY_PAYOFF / CLOSED_BAD_DEBT) ⇒ FAIL ทั้งสามข้อ
      expect([
        result.checks.activation.status,
        result.checks.cogs.status,
        result.checks.interCompany.status,
      ]).toEqual(['PASS', 'PASS', 'PASS']);
      expect(result.checks.activation.details).toContain('นอกขอบเขตของ orphan_contracts');
      for (const marker of ['c.status, c.created_at', 'shop-inventory-transfer-cogs']) {
        const call = prisma.$queryRaw.mock.calls.find((c: unknown[]) =>
          JSON.stringify(c).includes(marker),
        );
        expect(JSON.stringify(call)).toContain('c-1'); // scope.contractIds = [this contract]
        expect(JSON.stringify(call)).toContain('c.status::text IN ('); // ACTIVATED_CONTRACT_STATUSES
      }
    });

    it('Task 23 (m-4) — the opening / COGS verdict is the check row, not a TS re-derivation: entries found but the check flags the contract ⇒ FAIL', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(mockContract());
      prisma.journalEntry.findMany
        .mockResolvedValueOnce([opening1A, shopCogs, shopRevenue])
        .mockResolvedValueOnce([receiptP1()]);
      routeChecks({ orphanContracts: [orphanContractRow], missingCogs: [missingCogsRow] });

      const result = await service.traceContract('c-1');

      expect([result.checks.activation.status, result.checks.cogs.status]).toEqual([
        'FAIL',
        'FAIL',
      ]);
    });

    it('Task 23 review nit — an in-scope contract the receivable recon has no row for (deleted) says so, not "out of scope by status"', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(mockContract());
      prisma.journalEntry.findMany
        .mockResolvedValueOnce([opening1A, shopCogs, shopRevenue])
        .mockResolvedValueOnce([receiptP1()]);
      routeChecks({}); // no gap row

      const result = await service.traceContract('c-1');

      expect(result.checks.hpReceivable.status).toBe('PASS');
      expect(result.checks.hpReceivable.details).toContain('ไม่มีแถวของสัญญานี้');
    });

    it('Task 23 (m-4) — an entry off by exactly 0.01 is balanced (journal_balance flags > 0.01)', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(mockContract());
      const offByOneSatang = {
        ...opening1A,
        lines: [...opening1A.lines.slice(0, -1), line('21-2102', '0', '1190.01')],
      };
      prisma.journalEntry.findMany
        .mockResolvedValueOnce([offByOneSatang, shopCogs, shopRevenue])
        .mockResolvedValueOnce([receiptP1()]);
      routeChecks({});

      const result = await service.traceContract('c-1');

      expect(result.checks.activation).toMatchObject({
        status: 'PASS',
        details: { totalDebit: '18190.00', totalCredit: '18190.01', balanced: true },
      });
    });

    // ── PR-843/I2 Phase 3 PR 3.1 — receipt-JE shapes ───────────────────────
    // The primitive posts receipt JEs whose scalar `referenceId` is a fresh random UUID (NOT payment.id);
    // the payment→JE link lives in metadata.paymentId. A payment may have MULTIPLE such JEs.

    it('NEW shape — payment JE keyed by metadata.paymentId (referenceId is a UUID) is NOT a false orphan', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(mockContract());
      prisma.journalEntry.findMany
        .mockResolvedValueOnce([opening1A, shopCogs, shopRevenue])
        .mockResolvedValueOnce([receiptP1()]);
      routeChecks({});

      const result = await service.traceContract('c-1');

      expect(result.checks.payments[0].status).toBe('PASS');
      expect((result.checks.payments[0].details as { journalCount: number }).journalCount).toBe(1);
    });

    it('LEGACY shape — payment JE keyed by referenceId == payment.id still matches (backward-compat)', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(mockContract());
      prisma.journalEntry.findMany
        .mockResolvedValueOnce([opening1A])
        .mockResolvedValueOnce([
          receiptP1({ referenceId: 'p-1', metadata: { tag: '2B', paymentId: 'p-1' } }),
        ]);
      routeChecks({});

      const result = await service.traceContract('c-1');
      expect(result.checks.payments[0].status).toBe('PASS');
    });

    it('MULTI-RECEIPT — two receipt JEs share metadata.paymentId; the aggregate balances', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(mockContract());
      prisma.journalEntry.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          referenceId: 'uuid-receipt-1',
          metadata: { paymentId: 'p-1', tag: 'receipt' },
          lines: [line('11-1101', '1000.00', '0'), line('11-2103', '0', '1000.00')],
        },
        {
          referenceId: 'uuid-receipt-2',
          metadata: { paymentId: 'p-1', tag: 'receipt' },
          lines: [line('11-1101', '515.83', '0'), line('11-2103', '0', '515.83')],
        },
      ]);
      routeChecks({});

      const result = await service.traceContract('c-1');

      expect(result.checks.payments[0].status).toBe('PASS');
      // BOTH receipt JEs matched · Decimal sums reported as 2dp strings
      expect(result.checks.payments[0].details).toEqual({
        installmentNo: 1,
        journalCount: 2,
        totalDebit: '1515.83',
        totalCredit: '1515.83',
        balanced: true,
      });
    });

    it('MULTI-RECEIPT — broadened query passes referenceType AUTO + OR(referenceId, metadata.paymentId) for every payment', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(mockContract());
      prisma.journalEntry.findMany.mockResolvedValue([]);
      routeChecks({});

      await service.traceContract('c-1');

      // 2nd journalEntry.findMany call = the payment-journals query.
      const where = prisma.journalEntry.findMany.mock.calls[1][0].where;
      expect(where.referenceType).toBe('AUTO');
      expect(where.status).toBe('POSTED');
      expect(where.deletedAt).toBeNull();
      expect(where.OR[0]).toEqual({ referenceId: { in: ['p-1', 'p-2', 'p-3'] } });
      expect(where.OR.slice(1)).toEqual(
        expect.arrayContaining([
          { metadata: { path: ['paymentId'], equals: 'p-1' } },
          { metadata: { path: ['paymentId'], equals: 'p-2' } },
        ]),
      );
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

    it('Task 23 (m-5) — runs each nightly check ONCE for the whole batch (scoped by every contractId), not per contract; response shape unchanged', async () => {
      const ids = ['c-1', 'c-2', 'c-3'];
      prisma.contract.findMany.mockResolvedValueOnce(ids.map((id) => ({ id })));
      prisma.contract.findUnique.mockImplementation(
        async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          contractNumber: `BC-${where.id}`,
          status: 'ACTIVE',
          legacyContractCode: null,
          payments: [
            {
              id: `p-${where.id}`,
              installmentNo: 1,
              status: 'PENDING',
              amountPaid: new Prisma.Decimal(0),
            },
          ],
          product: null,
          branch: null,
        }),
      );
      // every contract carries its balanced SHOP receivable leg (JE B) — only the opening verdict differs
      prisma.journalEntry.findMany.mockResolvedValue([
        {
          metadata: { flow: 'shop-inventory-transfer-revenue' },
          lines: [
            {
              accountCode: 'S11-3001',
              debit: new Prisma.Decimal(100),
              credit: new Prisma.Decimal(0),
            },
            {
              accountCode: 'S41-1101',
              debit: new Prisma.Decimal(0),
              credit: new Prisma.Decimal(100),
            },
          ],
        },
      ]);
      const markers = {
        orphanContracts: 'c.status, c.created_at',
        missingCogs: 'shop-inventory-transfer-cogs',
        orphanPayments: 'backed_payment',
        vat: 'vat_receivable',
        gaps: 'register_outstanding',
      };
      prisma.$queryRaw.mockImplementation(async (...args: unknown[]) => {
        const sql = JSON.stringify(args);
        // c-2 has no opening entry — only orphan_contracts says so
        if (sql.includes(markers.orphanContracts)) return [{ id: 'c-2' }];
        return [];
      });

      const result = await service.traceAll({});

      const callsOf = (marker: string) =>
        prisma.$queryRaw.mock.calls.filter((c: unknown[]) => JSON.stringify(c).includes(marker));
      for (const marker of Object.values(markers)) {
        const calls = callsOf(marker);
        expect([marker, calls.length]).toEqual([marker, 1]); // once per batch (was once per contract)
        for (const id of ids) expect(JSON.stringify(calls[0])).toContain(`"${id}"`);
      }
      expect(result).toMatchObject({ total: 3, checked: 3, passed: 2, failed: 1 });
      expect(result.failures.map((f) => [f.contract.id, f.checks.activation.status])).toEqual([
        ['c-2', 'FAIL'],
      ]);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // backfillJournals (dry-run stub)
  // ═══════════════════════════════════════════════════════════════

  describe('backfillJournals', () => {
    it('Task 18 — lists contracts without an opening entry by metadata.contractId (orphan_contracts rule), not reference_type CONTRACT', async () => {
      prisma.user = { findFirst: jest.fn().mockResolvedValue({ id: 'u-owner' }) };
      prisma.companyInfo = { findFirst: jest.fn().mockResolvedValue({ id: 'co-finance' }) };
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.backfillJournals({ dryRun: true, limit: 10 });

      expect(result.contracts.total).toBe(0);
      const sql = JSON.stringify(prisma.$queryRaw.mock.calls[0]);
      expect(sql).toContain("je.metadata->>'contractId' = c.id");
      expect(sql).toContain('c.legacy_contract_code IS NOT NULL');
      expect(sql).not.toContain('reference_type');
      expect(prisma.$queryRaw.mock.calls[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ values: expect.arrayContaining(['1A']) }),
        ]),
      );
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

  // ═══════════════════════════════════════════════════════════════
  // T2-C7: Acknowledgement + SLA
  // ═══════════════════════════════════════════════════════════════

  describe('acknowledgement workflow', () => {
    it('getUnacknowledgedFindings defaults to CRITICAL/HIGH', async () => {
      prisma.dataAuditLog.findMany.mockResolvedValue([]);
      await service.getUnacknowledgedFindings();
      const where = prisma.dataAuditLog.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('FAIL');
      expect(where.acknowledgedAt).toBeNull();
      expect(where.severity.in).toEqual(['CRITICAL', 'HIGH']);
    });

    it('getUnacknowledgedFindings respects severity override', async () => {
      await service.getUnacknowledgedFindings('medium');
      const where = prisma.dataAuditLog.findMany.mock.calls[0][0].where;
      expect(where.severity.in).toEqual(['MEDIUM']);
    });

    it('acknowledgeFinding is idempotent (already-ack returns existing row)', async () => {
      const existing = {
        id: 'da-1',
        status: 'FAIL',
        severity: 'HIGH',
        acknowledgedAt: new Date('2026-04-10'),
      };
      prisma.dataAuditLog.findUnique.mockResolvedValue(existing);
      const result = await service.acknowledgeFinding('da-1', 'u-1');
      expect(result).toBe(existing);
      expect(prisma.dataAuditLog.update).not.toHaveBeenCalled();
    });

    it('acknowledgeFinding rejects non-FAIL rows', async () => {
      prisma.dataAuditLog.findUnique.mockResolvedValue({
        id: 'da-1',
        status: 'PASS',
        acknowledgedAt: null,
      });
      await expect(service.acknowledgeFinding('da-1', 'u-1')).rejects.toThrow();
    });

    it('acknowledgeFinding writes acknowledgedBy + At + notes', async () => {
      prisma.dataAuditLog.findUnique.mockResolvedValue({
        id: 'da-1',
        status: 'FAIL',
        severity: 'CRITICAL',
        acknowledgedAt: null,
      });
      prisma.dataAuditLog.update.mockResolvedValue({ id: 'da-1' });
      await service.acknowledgeFinding('da-1', 'u-accountant', 'fixed in PR #XXX');
      expect(prisma.dataAuditLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            acknowledgedById: 'u-accountant',
            acknowledgeNotes: 'fixed in PR #XXX',
          }),
        }),
      );
    });

    it('scanForSlaBreaches returns 0 when no overdue findings', async () => {
      prisma.dataAuditLog.findMany.mockResolvedValue([]);
      const result = await service.scanForSlaBreaches();
      expect(result.breached).toBe(0);
    });

    it('scanForSlaBreaches flags findings older than 24h', async () => {
      prisma.dataAuditLog.findMany.mockResolvedValue([
        { id: 'da-1', checkName: 'journal_balance', severity: 'CRITICAL', executedAt: new Date() },
        { id: 'da-2', checkName: 'orphan_contracts', severity: 'HIGH', executedAt: new Date() },
      ]);
      const result = await service.scanForSlaBreaches();
      expect(result.breached).toBe(2);
      const where = prisma.dataAuditLog.findMany.mock.calls[0][0].where;
      expect(where.acknowledgedAt).toBeNull();
      expect(where.severity.in).toEqual(['CRITICAL', 'HIGH']);
    });
  });
});
