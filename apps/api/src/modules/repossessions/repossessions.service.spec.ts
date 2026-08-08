import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RepossessionsService } from './repossessions.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RepossessionJP5Template } from '../journal/cpa-templates/repossession-jp5.template';
import { CreditNoteDocumentService } from '../receipts/services/credit-note-document.service';
import { CreditNoteDeliveryService } from '../receipts/services/credit-note-delivery.service';
import { computePayoffQuote } from '../contracts/compute-payoff-quote';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const decimal = (v: number | string) => new Prisma.Decimal(v);

function makeContract(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'contract-1',
    contractNumber: 'BC-202601-0001',
    status: 'DEFAULT',
    deletedAt: null,
    totalMonths: 12,
    financedAmount: decimal(10000),
    storeCommission: decimal(500),
    monthlyPayment: decimal(1000),
    sellingPrice: decimal(12000),
    // computePayoffQuote inputs (สูตรเดียวกับปิดยอดก่อนกำหนด):
    // ต้นทุน = (sellingPrice − downPayment) + commission = 10000 + 500 = 10500
    downPayment: decimal(2000),
    vatPct: decimal(0.07),
    creditBalance: decimal(0),
    productId: 'product-1',
    product: {
      id: 'product-1',
      name: 'iPhone 14',
      brand: 'Apple',
      model: 'iPhone 14',
      costPrice: decimal(8000),
      status: 'INSTALLMENT',
    },
    customer: { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0811111111' },
    payments: [
      {
        id: 'pay-1',
        installmentNo: 1,
        status: 'PAID',
        amountDue: decimal(1000),
        amountPaid: decimal(1000),
        lateFee: decimal(0),
        lateFeeWaived: false,
      },
      {
        id: 'pay-2',
        installmentNo: 2,
        status: 'OVERDUE',
        amountDue: decimal(1000),
        amountPaid: decimal(0),
        lateFee: decimal(100),
        lateFeeWaived: false,
      },
      {
        id: 'pay-3',
        installmentNo: 3,
        status: 'PENDING',
        amountDue: decimal(1000),
        amountPaid: decimal(0),
        lateFee: decimal(0),
        lateFeeWaived: false,
      },
    ],
    ...overrides,
  };
}

function makeRepossession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'repo-1',
    contractId: 'contract-1',
    productId: 'product-1',
    status: 'REPOSSESSED',
    conditionGrade: 'B',
    appraisalPrice: decimal(6000),
    repairCost: decimal(500),
    resellPrice: null,
    marketValue: 6000,
    remainingMonths: 2,
    financeCost: 10500,
    remainingCost: 1750,
    discountPct: 50,
    discountAmount: 500,
    closingAmount: 1000,
    customerRefundEnabled: false,
    customerRefund: 0,
    profitLoss: 4250,
    createdAt: new Date('2026-01-01'),
    product: {
      id: 'product-1',
      name: 'iPhone 14',
      brand: 'Apple',
      model: 'iPhone 14',
    },
    contract: {
      contractNumber: 'BC-202601-0001',
      customer: { name: 'สมชาย ใจดี' },
      branch: { id: 'branch-1', name: 'ลาดพร้าว' },
    },
    appraisedBy: { id: 'user-1', name: 'ผู้ใช้ทดสอบ' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('RepossessionsService', () => {
  let service: RepossessionsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let jp5: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let creditNoteService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cnDeliveryServiceMock: any;

  beforeEach(async () => {
    prisma = {
      repossession: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn(),
      },
      contract: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      product: {
        update: jest.fn(),
      },
      branch: {
        findFirst: jest.fn().mockResolvedValue({ id: 'branch-1', isMainWarehouse: true }),
      },
      productPrice: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      // Phase 3 Task 6 — findAll's batched CN lookup (creditNote attach).
      receipt: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      notificationLog: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      auditLog: {
        create: jest.fn(),
      },
      // Task 5 (2026-07-26) — repossessions.service marks BadDebtProvision
      // rows REVERSED right after JP5 posts (GL 11-2102 released to 51-1103).
      badDebtProvision: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null), // strict mode off by default
      },
      companyInfo: {
        // FINANCE companyId for the period-lock guard (validatePeriodOpen
        // no-ops in unit tests because the mock has no accountingPeriod)
        findFirst: jest.fn().mockResolvedValue({ id: 'company-finance' }),
      },
      $transaction: jest.fn().mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') return fn(prisma);
        return Promise.all(fn as Promise<unknown>[]);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepossessionsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JournalAutoService,
          useValue: {
            createBadDebtWriteOffJournal: jest.fn().mockResolvedValue('je-bd-1'),
            createRepossessionResaleJournal: jest.fn().mockResolvedValue('je-repo-1'),
          },
        },
        {
          provide: RepossessionJP5Template,
          useValue: (jp5 = {
            execute: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK' }),
            previewJe: jest.fn().mockResolvedValue({
              lines: [
                { accountCode: '11-1201', accountName: 'ธนาคาร KBank', debit: '6000.00', credit: '0.00', description: 'ราคากลางเครื่อง' },
                { accountCode: '11-2103', accountName: 'ลูกหนี้ค้างชำระ', debit: '0.00', credit: '6000.00', description: 'ล้างลูกหนี้' },
              ],
              totalDebit: '6000.00',
              totalCredit: '6000.00',
              isBalanced: true,
            }),
          }),
        },
        {
          provide: CreditNoteDocumentService,
          useValue: (creditNoteService = {
            issueForContract: jest.fn().mockResolvedValue({
              outcome: 'ISSUED',
              receiptId: 'r1',
              receiptNumber: 'RT-x',
            }),
          }),
        },
        {
          provide: CreditNoteDeliveryService,
          useValue: (cnDeliveryServiceMock = {
            deliver: jest.fn().mockResolvedValue({ delivered: true }),
          }),
        },
      ],
    }).compile();

    service = module.get<RepossessionsService>(RepossessionsService);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // findAll
  // ──────────────────────────────────────────────────────────────────────────
  describe('findAll', () => {
    it('returns paginated list with defaults', async () => {
      const repo = makeRepossession();
      prisma.repossession.findMany.mockResolvedValue([repo]);
      prisma.repossession.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(prisma.repossession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null } }),
      );
    });

    it('passes status filter through to query', async () => {
      prisma.repossession.findMany.mockResolvedValue([]);
      prisma.repossession.count.mockResolvedValue(0);

      await service.findAll({ status: 'UNDER_REPAIR' });

      expect(prisma.repossession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null, status: 'UNDER_REPAIR' } }),
      );
    });

    it('caps limit at 200 and minimum at 1', async () => {
      prisma.repossession.findMany.mockResolvedValue([]);
      prisma.repossession.count.mockResolvedValue(0);

      await service.findAll({ limit: 9999, page: 0 });

      const call = prisma.repossession.findMany.mock.calls[0][0];
      expect(call.take).toBe(200);
      expect(call.skip).toBe(0); // page clamped to 1 → skip = 0
    });

    it('attaches creditNote (with lastDeliveryStatus) when a REPOSSESSION CN receipt exists for the contract', async () => {
      const repo = makeRepossession({ contract: { ...makeRepossession().contract, id: 'contract-1' } });
      prisma.repossession.findMany.mockResolvedValue([repo]);
      prisma.repossession.count.mockResolvedValue(1);
      prisma.receipt.findMany.mockResolvedValue([
        { id: 'rcpt-1', receiptNumber: 'RT-202607-00001', contractId: 'contract-1' },
      ]);
      prisma.notificationLog.findMany.mockResolvedValue([
        { relatedId: 'rcpt-1', status: 'SENT' },
      ]);

      const result = await service.findAll({});

      expect(prisma.receipt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { contractId: { in: ['contract-1'] }, cnSource: 'REPOSSESSION', deletedAt: null },
        }),
      );
      expect(result.data[0].creditNote).toEqual({
        receiptId: 'rcpt-1',
        receiptNumber: 'RT-202607-00001',
        lastDeliveryStatus: 'SENT',
      });
    });

    it('creditNote is null when no CN receipt exists for the contract', async () => {
      const repo = makeRepossession({ contract: { ...makeRepossession().contract, id: 'contract-2' } });
      prisma.repossession.findMany.mockResolvedValue([repo]);
      prisma.repossession.count.mockResolvedValue(1);
      prisma.receipt.findMany.mockResolvedValue([]);

      const result = await service.findAll({});

      expect(result.data[0].creditNote).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // previewCalculation
  // ──────────────────────────────────────────────────────────────────────────
  describe('previewCalculation', () => {
    it('throws NotFoundException when contract does not exist', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(
        service.previewCalculation('no-contract', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns correct outstanding balance using Decimal arithmetic (late fee separated)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', {});

      // ยอดค้าง = ค่างวด 1000 × 2 งวดค้าง = 2000 — ค่าปรับ 100 แยกออกมาต่างหาก
      // (ไม่รวมในฐาน VAT/ส่วนลด ตามสูตรปิดยอดก่อนกำหนด)
      expect(result.calculation.outstandingBalance).toBeCloseTo(2000, 2);
      expect(result.calculation.unpaidLateFees).toBeCloseTo(100, 2);
      expect(result.calculation.remainingMonths).toBe(2);
    });

    it('calculates principalExVat by dividing by 1.07 (VAT back-out, excl. late fee)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', {});

      const expectedPrincipalExVat = Math.round((2000 / 1.07) * 100) / 100;
      expect(result.calculation.principalExVat).toBeCloseTo(expectedPrincipalExVat, 1);
    });

    it('applies custom discountPct correctly', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', { discountPct: 0 });

      // discountPct = 0 → discountAmount = 0
      expect(result.calculation.discountAmount).toBe(0);
    });

    it('calculates customerRefund only when customerRefundEnabled=true', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const noRefund = await service.previewCalculation('contract-1', {
        customerRefundEnabled: false,
        marketValue: 5000,
      });
      expect(noRefund.calculation.customerRefund).toBe(0);

      const withRefund = await service.previewCalculation('contract-1', {
        customerRefundEnabled: true,
        marketValue: 5000,
      });
      // customerRefund = max(0, marketValue - closingAmount)
      expect(withRefund.calculation.customerRefund).toBeGreaterThanOrEqual(0);
    });

    it('falls back to costPrice when marketValue is not provided', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', {});

      // costPrice = 8000
      expect(result.calculation.marketValue).toBeCloseTo(8000, 2);
    });

    it('prefers appraisalPrice over costPrice as the marketValue fallback', async () => {
      // Placeholder promises "ใช้ราคาประเมินถ้าเว้นว่าง" — and create() falls
      // back to dto.appraisalPrice, so preview must match or the confirmed
      // figures diverge from the previewed ones.
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', { appraisalPrice: 6500 });

      expect(result.calculation.marketValue).toBeCloseTo(6500, 2);
    });

    it('computes profitLoss = ราคากลาง − ยอดปิดสัญญา (owner rule 2026-07-09)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', { marketValue: 5000 });

      // สูตรเดียวกับปิดยอดก่อนกำหนด (owner 2026-07-20):
      // ยอดค้าง 2000 (รวม VAT) → exVat 1869.16; ต้นทุน 1750;
      // ส่วนลด 50% × (1869.16 − 1750) = ROUND_DOWN(59.58) = 59.58;
      // ยอดปิด = 2000 − 59.58 + ค่าปรับ 100 = 2040.42
      expect(result.calculation.closingAmount).toBeCloseTo(2040.42, 2);
      expect(result.calculation.profitLoss).toBeCloseTo(5000 - 2040.42, 2);
    });

    it('refunding the full excess drives profitLoss to 0 (ราคากลาง > ยอดปิด + คืนเงิน)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', {
        marketValue: 5000,
        customerRefundEnabled: true,
      });

      // refund = marketValue − closingAmount → profit = market − closing − refund = 0
      expect(result.calculation.customerRefund).toBeCloseTo(5000 - 2040.42, 2);
      expect(result.calculation.profitLoss).toBeCloseTo(0, 2);
    });

    it('anti-drift: closingAmount ตรงกับ computePayoffQuote (สูตรปิดยอดก่อนกำหนด) เสมอ', async () => {
      const contract = makeContract();
      prisma.contract.findUnique.mockResolvedValue(contract);

      const result = await service.previewCalculation('contract-1', { discountPct: 30 });

      const expected = computePayoffQuote({
        monthlyPayment: contract.monthlyPayment as Prisma.Decimal,
        remainingMonths: 2,
        totalMonths: contract.totalMonths as number,
        creditBalance: contract.creditBalance as Prisma.Decimal,
        vatPct: contract.vatPct as Prisma.Decimal,
        sellingPrice: contract.sellingPrice as Prisma.Decimal,
        downPayment: contract.downPayment as Prisma.Decimal,
        storeCommission: contract.storeCommission as Prisma.Decimal,
        discountPctInput: 30,
        payments: contract.payments as never,
      });
      expect(result.calculation.closingAmount).toBe(expected.totalPayoff);
      expect(result.calculation.discountAmount).toBe(expected.discountAmount);
    });

    it('includes journalPreview (dry-run JP5) — mirror create(): repoValue = appraisalPrice, 11-2107 เมื่อ collectedByShop', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', {
        appraisalPrice: 6000,
        collectedByShop: true,
      });

      expect(result.journalPreview?.isBalanced).toBe(true);
      expect(jp5.previewJe).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          depositAccountCode: '11-2107',
          collectedByShop: true,
        }),
      );
      expect(jp5.previewJe.mock.calls[0][0].repossessionValue.toFixed(2)).toBe('6000.00');
    });

    it('default deposit = 11-1201 (KBank) เมื่อไม่ส่ง depositAccountCode', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      await service.previewCalculation('contract-1', {});

      expect(jp5.previewJe).toHaveBeenCalledWith(
        expect.objectContaining({ depositAccountCode: '11-1201', collectedByShop: false }),
      );
    });

    it('journalPreview = null เมื่อ previewJe ล้มเหลว — ไม่ล้มทั้ง response', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      jp5.previewJe.mockRejectedValueOnce(new Error('boom'));

      const result = await service.previewCalculation('contract-1', {});

      expect(result.journalPreview).toBeNull();
      expect(result.calculation.closingAmount).toBeGreaterThan(0);
    });

    it('journalPreview gate ตรงกับ create(): งวดค้างสถานะแต่จ่ายครบแล้ว (outstanding = 0) → ไม่โชว์ JE card', async () => {
      // create() ลง JE เฉพาะเมื่อ outstanding > 0 — preview ต้องใช้เงื่อนไขเดียวกัน
      // ไม่งั้น UI โชว์ JE ที่กดยืนยันแล้วไม่ถูก post จริง (review 2026-07-20)
      const contract = makeContract({
        payments: [
          {
            id: 'pay-1',
            installmentNo: 1,
            status: 'PENDING', // ค้างสถานะ แต่เงินครบแล้ว (processing lag)
            amountDue: decimal(1000),
            amountPaid: decimal(1000),
            lateFee: decimal(0),
            lateFeeWaived: false,
          },
        ],
      });
      prisma.contract.findUnique.mockResolvedValue(contract);

      const result = await service.previewCalculation('contract-1', {});

      expect(result.journalPreview).toBeNull();
      expect(jp5.previewJe).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // create (createRepossession)
  // ──────────────────────────────────────────────────────────────────────────
  describe('create', () => {
    const baseDto = {
      contractId: 'contract-1',
      conditionGrade: 'B',
      appraisalPrice: 6000,
      repossessedDate: '2026-01-15',
      marketValue: 6000,
    };

    it('throws BadRequestException for invalid condition grade', async () => {
      await expect(
        service.create({ ...baseDto, conditionGrade: 'Z' } as never, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when contract is not found', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(
        service.create(baseDto as never, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when contract status is ACTIVE (no termination)', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ status: 'ACTIVE' }),
      );

      await expect(
        service.create(baseDto as never, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows JP5 when contract status is LEGAL (termination letter dispatched)', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ status: 'TERMINATED' }),
      );
      prisma.repossession.create.mockResolvedValue(makeRepossession({ id: 'repo-legal' }));
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});

      const result = await service.create(baseDto as never, 'user-1');
      expect(result).toBeDefined();
    });

    it('strict mode: rejects DEFAULT status when jp5_require_terminated_status=true', async () => {
      // CPA Manual Termination Policy: enforce TERMINATED-only via SystemConfig
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 'true' });
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ status: 'DEFAULT' }),
      );

      await expect(
        service.create(baseDto as never, 'user-1'),
      ).rejects.toThrow(/strict mode|หนังสือบอกเลิก/);
    });

    it('throws BadRequestException when product is already repossessed', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ product: { ...makeContract().product, status: 'REPOSSESSED' } }),
      );

      await expect(
        service.create(baseDto as never, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a future paymentDate (BKK calendar day)', async () => {
      const tomorrow = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);

      await expect(
        service.create({ ...baseDto, paymentDate: tomorrow } as never, 'user-1'),
      ).rejects.toThrow(/อนาคต/);
    });

    it('create() ปฏิเสธ paymentDate เดือนก่อนหน้า (ห้ามข้ามเดือน — คำสั่งเจ้าของ 2026-08-08 ข้อ 3)', async () => {
      const prevMonth = new Date();
      prevMonth.setDate(1);
      prevMonth.setDate(0); // วันสุดท้ายของเดือนก่อน
      await expect(
        service.create(
          {
            contractId: 'contract-1',
            repossessedDate: '2026-08-01',
            conditionGrade: 'B',
            appraisalPrice: 5000,
            paymentDate: prevMonth.toISOString(),
          },
          'user-1',
        ),
      ).rejects.toThrow('วันที่รับเงินย้อนหลังได้เฉพาะภายในเดือนปัจจุบัน');
    });

    it('create() ผ่านเมื่อ paymentDate อยู่ภายในเดือนปัจจุบัน (ไม่ปฏิเสธด้วยข้อความ "ห้ามข้ามเดือน")', async () => {
      // ให้ payments ทั้งหมด PAID → outstandingBalance = 0 → ข้าม JP5/CN path ทั้งชุด
      // (มิเรอร์ pattern ของเทสต์ 'create() โหลด payments เฉพาะ deletedAt:null' ด้านล่าง)
      const allPaid = makeContract({ status: 'TERMINATED' }).payments.map((p) => ({
        ...p,
        status: 'PAID',
        amountPaid: p.amountDue,
      }));
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ status: 'TERMINATED', payments: allPaid }),
      );
      prisma.repossession.create.mockResolvedValue(makeRepossession());
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      await expect(
        service.create(
          {
            contractId: 'contract-1',
            repossessedDate: '2026-08-01',
            conditionGrade: 'B',
            appraisalPrice: 5000,
            paymentDate: new Date().toISOString(),
          },
          'user-1',
        ),
      ).resolves.toBeDefined();
    });

    it('ยอมรับ paymentDate ในงวดที่ CLOSED แต่ยังอยู่ใน grace window (validatePeriodOpen ของจริง)', async () => {
      // Task 1 (คำสั่งเจ้าของ 2026-08-08 ข้อ 3) บังคับ paymentDate ให้อยู่ภายในเดือน
      // ปัจจุบันเท่านั้น (guard ใหม่ทำงานก่อน validatePeriodOpen เสมอ) — ผลคือกิ่ง
      // "CLOSED + เลย grace window" ของ validatePeriodOpen เป็นไปไม่ได้อีกต่อไปทาง
      // คณิตศาสตร์ที่ default grace_days >= 1 (default 5): graceEnd = วันสุดท้ายของ
      // เดือนปัจจุบัน + graceDays ซึ่ง >= "วันนี้" เสมอตราบใดที่ "วันนี้" ยังอยู่ในเดือน
      // นั้น จึง `now > graceEnd` เป็นเท็จเสมอ (กิ่งนี้ยังมี unit test ครบที่
      // period-lock.util.spec.ts ซึ่งไม่ผ่าน guard เดือนของ repossessions เลย — ไม่
      // ได้รับผลกระทบ). กิ่งที่ยัง reachable จริงคือ "CLOSED แต่ยังอยู่ใน grace" —
      // เทสต์นี้เรียก validatePeriodOpen ของจริง (ไม่ mock reject) เพื่อพิสูจน์ integration
      // ตรงนี้ยังทำงานถูกต้อง: closed-but-within-grace ต้องผ่าน ไม่ throw
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.repossession.create.mockResolvedValue(makeRepossession());
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      const now = new Date();
      // realistic AccountingPeriod row shape (period-lock.util.ts only reads
      // .status, but mirror the real Prisma model shape for clarity/honesty)
      prisma.accountingPeriod = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'period-1',
          companyId: 'company-finance',
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          status: 'CLOSED',
        }),
      };
      // prisma.systemConfig.findUnique is already mocked to resolve null in
      // beforeEach ("strict mode off by default") — getGraceDays() falls back
      // to the documented default of 5 days when the row is missing, so "now"
      // (always inside the current month, per the Task 1 guard above) is
      // always within the grace window.

      await expect(
        service.create({ ...baseDto, paymentDate: now.toISOString() } as never, 'user-1'),
      ).resolves.toBeDefined();
      expect(prisma.accountingPeriod.findUnique).toHaveBeenCalled();
    });

    it('fails loud when FINANCE company is not configured (period guard must not silently no-op)', async () => {
      prisma.companyInfo.findFirst.mockResolvedValue(null);

      await expect(service.create(baseDto as never, 'user-1')).rejects.toThrow(
        'FINANCE company not configured',
      );
    });

    it('threads paymentDate through to JP5 postedAt (JE entryDate)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.repossession.create.mockResolvedValue(makeRepossession());
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});

      // วันที่ 1 ของเดือนปัจจุบัน (ไม่ใช่วันในอนาคต, ไม่ข้ามเดือน) แทนค่า hardcode
      // เดิม '2026-01-10' ที่ตกเป็นเดือนก่อนหน้าเมื่อรันหลัง 2026-08-08 (task-1 guard)
      const now = new Date();
      const paymentDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

      await service.create({ ...baseDto, paymentDate: paymentDateStr } as never, 'user-1');

      expect(jp5.execute).toHaveBeenCalledWith(
        expect.objectContaining({ postedAt: new Date(paymentDateStr) }),
        prisma,
      );
    });

    it('stores profitLoss = ราคากลาง − ยอดปิดสัญญา on the repossession row', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.repossession.create.mockResolvedValue(makeRepossession());
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});

      await service.create(baseDto as never, 'user-1');

      const data = prisma.repossession.create.mock.calls[0][0].data;
      // สูตรเดียวกับ preview + ปิดยอดก่อนกำหนด: ยอดค้าง 2000 − ส่วนลด 59.58
      // + ค่าปรับ 100 = closing 2040.42; marketValue 6000 → profit 3959.58
      expect(Number(data.closingAmount)).toBeCloseTo(2040.42, 2);
      expect(Number(data.profitLoss)).toBeCloseTo(6000 - 2040.42, 2);
    });

    it('creates repossession, updates contract to CLOSED_BAD_DEBT, and sets product to REPOSSESSED', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      const createdRepo = { ...makeRepossession(), id: 'repo-new' };
      prisma.repossession.create.mockResolvedValue(createdRepo);
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      const result = await service.create(baseDto as never, 'user-1');

      expect(prisma.repossession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REPOSSESSED', conditionGrade: 'B' }),
        }),
      );
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CLOSED_BAD_DEBT' } }),
      );
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REPOSSESSED' }) }),
      );
      expect(result).toMatchObject({ id: 'repo-new' });
    });

    it('passes tx to JP5 template (atomic — JE inside outer $transaction)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.repossession.create.mockResolvedValue({ ...makeRepossession(), id: 'repo-new' });
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      await service.create(baseDto as never, 'user-1');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const template = (service as any).repossessionJP5Template;
      expect(template.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          // Owner rule 2026-07-08: direct FINANCE receipt = KBank only —
          // the fallback is 11-1201, never a cash account / user default.
          depositAccountCode: '11-1201',
          collectedByShop: false,
        }),
        prisma, // tx (mock $transaction passes prisma itself as tx)
      );
    });

    it('issues CN inside the same tx as JP5, with source=REPOSSESSION and the entryNo JP5 just returned', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.repossession.create.mockResolvedValue({ ...makeRepossession(), id: 'repo-new' });
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});
      jp5.execute.mockResolvedValueOnce({ entryNo: 'JE-JP5-123' });

      const result = await service.create(baseDto as never, 'user-1');

      expect(creditNoteService.issueForContract).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          source: 'REPOSSESSION',
          sourceJournalEntryNo: 'JE-JP5-123',
          actorUserId: 'user-1',
        }),
        prisma, // same tx JP5 was called with — atomic
      );
      expect(result.creditNote).toEqual({ outcome: 'ISSUED', receiptId: 'r1' });
    });

    it('marks BadDebtProvision rows REVERSED right after JP5 posts (Task 5, 2026-07-26)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.repossession.create.mockResolvedValue({ ...makeRepossession(), id: 'repo-new' });
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      await service.create(baseDto as never, 'user-1');

      expect(prisma.badDebtProvision.updateMany).toHaveBeenCalledWith({
        where: { status: 'ACTIVE', contractId: 'contract-1', deletedAt: null },
        data: { status: 'REVERSED' },
      });
    });

    it('does not issue a CN when there is no outstanding balance (JP5 itself is skipped)', async () => {
      const paidUpContract = makeContract({
        payments: [
          {
            id: 'pay-1',
            installmentNo: 1,
            status: 'PAID',
            amountDue: decimal(1000),
            amountPaid: decimal(1000),
            lateFee: decimal(0),
            lateFeeWaived: false,
          },
        ],
      });
      prisma.contract.findUnique.mockResolvedValue(paidUpContract);
      prisma.repossession.create.mockResolvedValue({ ...makeRepossession(), id: 'repo-new' });
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      const result = await service.create(baseDto as never, 'user-1');

      expect(jp5.execute).not.toHaveBeenCalled();
      expect(creditNoteService.issueForContract).not.toHaveBeenCalled();
      // No JP5 → no provision to release either (outstanding balance was 0).
      expect(prisma.badDebtProvision.updateMany).not.toHaveBeenCalled();
      expect(result.creditNote).toBeUndefined();
    });

    it('rolls back the whole repossession when CN issuance throws (atomicity)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.repossession.create.mockResolvedValue({ ...makeRepossession(), id: 'repo-new' });
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});
      creditNoteService.issueForContract.mockRejectedValueOnce(new Error('CN fail'));

      await expect(service.create(baseDto as never, 'user-1')).rejects.toThrow('CN fail');
      expect(creditNoteService.issueForContract).toHaveBeenCalled();
    });

    // Phase 3 Task 5 — post-commit LINE delivery hook.
    describe('CreditNoteDeliveryService post-commit hook', () => {
      it('fires deliver(receiptId) AFTER the $transaction resolves, with the ISSUED receiptId', async () => {
        prisma.contract.findUnique.mockResolvedValue(makeContract());
        prisma.repossession.create.mockResolvedValue({ ...makeRepossession(), id: 'repo-new' });
        prisma.contract.update.mockResolvedValue({});
        prisma.product.update.mockResolvedValue({});
        prisma.auditLog.create.mockResolvedValue({});

        await service.create(baseDto as never, 'user-1');

        expect(cnDeliveryServiceMock.deliver).toHaveBeenCalledWith('r1');
        // Ordering proof: deliver's global invocation index must come AFTER
        // $transaction's — i.e. the hook runs post-commit, never from inside
        // the transaction callback.
        const txOrder = prisma.$transaction.mock.invocationCallOrder[0];
        const deliverOrder = cnDeliveryServiceMock.deliver.mock.invocationCallOrder[0];
        expect(deliverOrder).toBeGreaterThan(txOrder);
      });

      it('does NOT call deliver when there is no outstanding balance (no CN issued)', async () => {
        const paidUpContract = makeContract({
          payments: [
            {
              id: 'pay-1',
              installmentNo: 1,
              status: 'PAID',
              amountDue: decimal(1000),
              amountPaid: decimal(1000),
              lateFee: decimal(0),
              lateFeeWaived: false,
            },
          ],
        });
        prisma.contract.findUnique.mockResolvedValue(paidUpContract);
        prisma.repossession.create.mockResolvedValue({ ...makeRepossession(), id: 'repo-new' });
        prisma.contract.update.mockResolvedValue({});
        prisma.product.update.mockResolvedValue({});
        prisma.auditLog.create.mockResolvedValue({});

        await service.create(baseDto as never, 'user-1');

        expect(cnDeliveryServiceMock.deliver).not.toHaveBeenCalled();
      });

    });

    it('collectedByShop books the JP5 deposit leg to 11-2107 + writes SHOP_COLLECT_REPOSSESSION audit', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.repossession.create.mockResolvedValue({ ...makeRepossession(), id: 'repo-new' });
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      await service.create({ ...baseDto, collectedByShop: true } as never, 'user-1');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const template = (service as any).repossessionJP5Template;
      expect(template.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          depositAccountCode: '11-2107',
          collectedByShop: true,
        }),
        prisma,
      );
      // Forensic trail mirrors SHOP_COLLECT_PAYOFF (JP4).
      const auditActions = prisma.auditLog.create.mock.calls.map(
        (c: any[]) => c[0].data.action,
      );
      expect(auditActions).toContain('SHOP_COLLECT_REPOSSESSION');
      const scAudit = prisma.auditLog.create.mock.calls.find(
        (c: any[]) => c[0].data.action === 'SHOP_COLLECT_REPOSSESSION',
      )![0].data;
      expect(scAudit.newValue.shopReceivable).toBe('11-2107');
      expect(scAudit.newValue.repossessionValue).toBe('6000.00');
    });

    it('ignores a caller-sent depositAccountCode when collectedByShop=true (server substitution wins)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.repossession.create.mockResolvedValue({ ...makeRepossession(), id: 'repo-new' });
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      await service.create(
        { ...baseDto, collectedByShop: true, depositAccountCode: '11-1201' } as never,
        'user-1',
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const template = (service as any).repossessionJP5Template;
      expect(template.execute).toHaveBeenCalledWith(
        expect.objectContaining({ depositAccountCode: '11-2107' }),
        prisma,
      );
    });

    it('rolls back contract+product update when JP5 throws (atomicity)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.repossession.create.mockResolvedValue({ ...makeRepossession(), id: 'repo-new' });
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      // Mock JP5 to reject — should propagate up through $transaction (no fire-and-forget)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const template = (service as any).repossessionJP5Template;
      template.execute.mockRejectedValueOnce(new Error('JE fail'));

      await expect(service.create(baseDto as never, 'user-1')).rejects.toThrow('JE fail');

      // JP5 was awaited — error propagated (proves no .catch() fire-and-forget remains)
      expect(template.execute).toHaveBeenCalled();
    });

    it('create() โหลด payments เฉพาะ deletedAt:null (เหมือน previewCalculation)', async () => {
      // ทุกงวด PAID → outstandingBalance = 0 → ข้าม JP5/CN path ทั้งชุด — test นี้
      // สนแค่ shape ของ include จึงไม่ต้องพึ่ง mock ของ jp5/creditNoteService เลย
      const allPaid = makeContract({ status: 'TERMINATED' }).payments.map((p) => ({
        ...p,
        status: 'PAID',
        amountPaid: p.amountDue,
      }));
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ status: 'TERMINATED', payments: allPaid }),
      );
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.repossession.create.mockResolvedValue(makeRepossession());
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});
      await service.create(
        {
          contractId: 'contract-1',
          repossessedDate: '2026-08-07',
          conditionGrade: 'B',
          appraisalPrice: 5000,
        } as never,
        'user-1',
      );
      expect(prisma.contract.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
          }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // update — status transitions
  // ──────────────────────────────────────────────────────────────────────────
  describe('update — status transitions', () => {
    it('throws BadRequestException for invalid transition REPOSSESSED → SOLD', async () => {
      prisma.repossession.findUnique.mockResolvedValue(makeRepossession({ status: 'REPOSSESSED' }));

      await expect(
        service.update('repo-1', { status: 'SOLD' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when moving to READY_FOR_SALE without resellPrice', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ status: 'UNDER_REPAIR', resellPrice: null }),
      );

      await expect(
        service.update('repo-1', { status: 'READY_FOR_SALE' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates product status to REFURBISHED when moving to READY_FOR_SALE', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ status: 'UNDER_REPAIR' }),
      );
      prisma.product.update.mockResolvedValue({});
      prisma.repossession.update.mockResolvedValue(makeRepossession({ status: 'READY_FOR_SALE' }));

      await service.update('repo-1', { status: 'READY_FOR_SALE', resellPrice: 7000 } as never);

      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REFURBISHED' }),
        }),
      );
    });

    it('adjusts costPrice to appraisalPrice (TAS 2) when marking READY_FOR_SALE', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ status: 'UNDER_REPAIR', appraisalPrice: decimal(6000) }),
      );
      prisma.product.update.mockResolvedValue({});
      prisma.repossession.update.mockResolvedValue({});

      await service.update('repo-1', { status: 'READY_FOR_SALE', resellPrice: 7500 } as never);

      // Wave 3 / Task 4 (W-2): costPrice now passed as Prisma.Decimal to
      // preserve precision. Compare via Decimal.eq instead of numeric equality.
      // Task 4 (R-007/TAS 2, Phase 1): costPrice = appraisalPrice (6000), NOT
      // resellPrice (7500) — using the resale price as costPrice would zero out
      // margin when the item is actually sold.
      expect(prisma.product.update).toHaveBeenCalledTimes(1);
      const call = prisma.product.update.mock.calls[0][0];
      expect(call.data.status).toBe('REFURBISHED');
      expect(new Prisma.Decimal(call.data.costPrice).eq(6000)).toBe(true);
    });

    it('READY_FOR_SALE ตั้ง costPrice = ราคาประเมิน ไม่ใช่ราคาขายต่อ (R-007/TAS 2)', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ status: 'REPOSSESSED', appraisalPrice: decimal(3000) }),
      );
      prisma.repossession.update.mockResolvedValue(makeRepossession({ status: 'READY_FOR_SALE' }));
      prisma.product.update.mockResolvedValue({});
      await service.update(
        'repo-1',
        { status: 'READY_FOR_SALE', resellPrice: 5500 } as never,
        { id: 'user-1', role: 'OWNER' },
      );
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ costPrice: new Prisma.Decimal(3000) }),
        }),
      );
    });

    it('READY_FOR_SALE falls back to resellPrice when appraisalPrice is 0/null', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ status: 'UNDER_REPAIR', appraisalPrice: null }),
      );
      prisma.product.update.mockResolvedValue({});
      prisma.repossession.update.mockResolvedValue({});

      await service.update('repo-1', { status: 'READY_FOR_SALE', resellPrice: 4200 } as never);

      const call = prisma.product.update.mock.calls[0][0];
      expect(new Prisma.Decimal(call.data.costPrice).eq(4200)).toBe(true);
    });

    it('updates repossession to SOLD status and returns updated record (Phase A.5 JE deferred)', async () => {
      // Phase A.4b: repossession resale JE is deferred to Phase A.5 (SHOP-side accounting).
      // Until then, the service logs a warning and proceeds without a JE.
      const repoWithPrice = makeRepossession({
        status: 'READY_FOR_SALE',
        resellPrice: decimal(7000),
        repairCost: decimal(500),
        product: {
          id: 'product-1',
          name: 'iPhone 14',
          brand: 'Apple',
          model: 'iPhone 14',
          costPrice: decimal(6000),
        },
      });
      prisma.repossession.findUnique.mockResolvedValue(repoWithPrice);
      prisma.product.update.mockResolvedValue({});
      const updatedRepo = makeRepossession({ status: 'SOLD', resellPrice: decimal(7000) });
      prisma.repossession.update.mockResolvedValue(updatedRepo);

      const result = await service.update('repo-1', { status: 'SOLD', resellPrice: 7000 } as never, {
        id: 'user-1',
        role: 'OWNER',
      });

      // Repossession was updated to SOLD
      expect(result.status).toBe('SOLD');
      // RepossessionJP5Template.execute was NOT called for resale (deferred to Phase A.5)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const template = (service as any).repossessionJP5Template;
      expect(template.execute).not.toHaveBeenCalled();
    });
  });

  describe('update self-transition & SOLD lock', () => {
    const owner = { id: 'user-1', role: 'OWNER' as const };

    it('status เดิม (REPOSSESSED→REPOSSESSED) + แก้ค่าซ่อม → ไม่ throw, ไม่ส่ง status ใน data', async () => {
      prisma.repossession.findUnique.mockResolvedValue(makeRepossession({ status: 'REPOSSESSED' }));
      prisma.repossession.update.mockResolvedValue(makeRepossession());
      await service.update('repo-1', { repairCost: 500, status: 'REPOSSESSED' } as never, owner);
      expect(prisma.repossession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ status: expect.anything() }),
        }),
      );
    });

    it('SOLD + แก้ repairCost → BadRequestException ภาษาไทย', async () => {
      prisma.repossession.findUnique.mockResolvedValue(makeRepossession({ status: 'SOLD' }));
      await expect(
        service.update('repo-1', { repairCost: 999, status: 'SOLD' } as never, owner),
      ).rejects.toThrow(BadRequestException);
    });

    it('SOLD + แก้เฉพาะ notes → สำเร็จ', async () => {
      prisma.repossession.findUnique.mockResolvedValue(makeRepossession({ status: 'SOLD' }));
      prisma.repossession.update.mockResolvedValue(makeRepossession({ status: 'SOLD' }));
      await expect(
        service.update('repo-1', { notes: 'ขายผ่าน Facebook', status: 'SOLD' } as never, owner),
      ).resolves.toBeTruthy();
    });

    it('transition ผิด (REPOSSESSED→SOLD) ยัง reject เหมือนเดิม', async () => {
      prisma.repossession.findUnique.mockResolvedValue(makeRepossession({ status: 'REPOSSESSED' }));
      await expect(
        service.update('repo-1', { status: 'SOLD' } as never, owner),
      ).rejects.toThrow(BadRequestException);
    });

    // Finding 2 (WARNING): self-transition/plain PATCH must not silently
    // clear resellPrice to 0 on a row already READY_FOR_SALE.
    it('READY_FOR_SALE + self-transition resellPrice=0 → BadRequestException (กันล้างราคาขาย)', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ status: 'READY_FOR_SALE', resellPrice: decimal(6000) }),
      );
      await expect(
        service.update('repo-1', { status: 'READY_FOR_SALE', resellPrice: 0 } as never, owner),
      ).rejects.toThrow(BadRequestException);
    });

    it('READY_FOR_SALE + PATCH resellPrice=0 โดยไม่ส่ง status → BadRequestException', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ status: 'READY_FOR_SALE', resellPrice: decimal(6000) }),
      );
      await expect(
        service.update('repo-1', { resellPrice: 0 } as never, owner),
      ).rejects.toThrow(BadRequestException);
    });

    it('READY_FOR_SALE + self-transition resellPrice=6000 (>0) → สำเร็จ', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ status: 'READY_FOR_SALE', resellPrice: decimal(5000) }),
      );
      prisma.repossession.update.mockResolvedValue(
        makeRepossession({ status: 'READY_FOR_SALE', resellPrice: decimal(6000) }),
      );
      await expect(
        service.update('repo-1', { status: 'READY_FOR_SALE', resellPrice: 6000 } as never, owner),
      ).resolves.toBeTruthy();
    });

    // Finding 3 (WARNING): costBasis fallback should use the stored
    // repo.resellPrice, not drop to 0, when dto.resellPrice is omitted.
    it('READY_FOR_SALE costBasis fallback = repo.resellPrice เมื่อไม่มี appraisalPrice และไม่ส่ง dto.resellPrice ใหม่', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({
          status: 'UNDER_REPAIR',
          appraisalPrice: decimal(0),
          resellPrice: decimal(7000),
        }),
      );
      prisma.product.update.mockResolvedValue({});
      prisma.repossession.update.mockResolvedValue({});

      await service.update('repo-1', { status: 'READY_FOR_SALE' } as never, owner);

      const call = prisma.product.update.mock.calls[0][0];
      expect(new Prisma.Decimal(call.data.costPrice).eq(7000)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // branch scoping
  // ──────────────────────────────────────────────────────────────────────────
  describe('branch scoping', () => {
    it('findAll: BRANCH_MANAGER ถูกบังคับ filter สาขาตัวเอง แม้ client ส่ง branchId อื่นมา', async () => {
      prisma.repossession.findMany.mockResolvedValue([]);
      prisma.repossession.count.mockResolvedValue(0);
      await service.findAll(
        { branchId: 'branch-OTHER' },
        { id: 'u1', role: 'BRANCH_MANAGER', branchId: 'branch-A' },
      );
      expect(prisma.repossession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ contract: { branchId: 'branch-A' } }),
        }),
      );
    });

    it('findAll: BM ที่ไม่มี branchId → คืนหน้าว่าง ไม่ query DB', async () => {
      const res = await service.findAll({}, { id: 'u1', role: 'BRANCH_MANAGER', branchId: null });
      expect(res).toEqual({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
      expect(prisma.repossession.findMany).not.toHaveBeenCalled();
    });

    it('findAll: OWNER (cross-branch) ใช้ branchId จาก query param ได้ตามเดิม', async () => {
      prisma.repossession.findMany.mockResolvedValue([]);
      prisma.repossession.count.mockResolvedValue(0);
      await service.findAll({ branchId: 'branch-B' }, { id: 'u1', role: 'OWNER', branchId: null });
      expect(prisma.repossession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ contract: { branchId: 'branch-B' } }),
        }),
      );
    });

    it('findOne: BM ข้ามสาขา → NotFoundException (ไม่ leak ว่ามีอยู่)', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({
          contract: {
            branchId: 'branch-1',
            contractNumber: 'BC-202601-0001',
            customer: { name: 'สมชาย ใจดี' },
            branch: { id: 'branch-1', name: 'ลาดพร้าว' },
            payments: [],
          },
        }),
      );
      await expect(
        service.findOne('repo-1', { id: 'u1', role: 'BRANCH_MANAGER', branchId: 'branch-2' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('findOne: BM สาขาเดียวกัน → ผ่าน', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({
          contract: {
            branchId: 'branch-1',
            contractNumber: 'BC-202601-0001',
            customer: { name: 'สมชาย ใจดี' },
            branch: { id: 'branch-1', name: 'ลาดพร้าว' },
            payments: [],
          },
        }),
      );
      await expect(
        service.findOne('repo-1', { id: 'u1', role: 'BRANCH_MANAGER', branchId: 'branch-1' }),
      ).resolves.toBeTruthy();
    });

    // Finding 1 (CRITICAL): preview endpoint must not leak cross-branch data.
    it('previewCalculation: BM ข้ามสาขา → NotFoundException (ไม่ leak ว่ามีสัญญาของสาขาอื่น)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract({ branchId: 'branch-1' }));

      await expect(
        service.previewCalculation('contract-1', {}, {
          id: 'u1',
          role: 'BRANCH_MANAGER',
          branchId: 'branch-2',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('previewCalculation: BM สาขาเดียวกัน → ผ่าน', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract({ branchId: 'branch-1' }));

      await expect(
        service.previewCalculation('contract-1', {}, {
          id: 'u1',
          role: 'BRANCH_MANAGER',
          branchId: 'branch-1',
        }),
      ).resolves.toBeTruthy();
    });
  });
});
