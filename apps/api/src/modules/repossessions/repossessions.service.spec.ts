import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RepossessionsService } from './repossessions.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RepossessionJP5Template } from '../journal/cpa-templates/repossession-jp5.template';
import { RefundPayoutTemplate } from '../journal/cpa-templates/refund-payout.template';
import { RefundWaiveTemplate } from '../journal/cpa-templates/refund-waive.template';
import { CreditNoteDocumentService } from '../receipts/services/credit-note-document.service';
import { CreditNoteDeliveryService } from '../receipts/services/credit-note-delivery.service';
import { computePayoffQuote } from '../contracts/compute-payoff-quote';
import * as periodLockUtil from '../../utils/period-lock.util';
import { bkkYearMonth } from '../../utils/date.util';

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
  let journalAuto: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let refundPayoutTemplate: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let refundWaiveTemplate: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let creditNoteService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cnDeliveryServiceMock: any;

  beforeEach(async () => {
    prisma = {
      repossession: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        // ด่าน "เครื่องเคยมีแถวยึด" (productId @unique) — ค่าเริ่มต้น = ไม่เคย
        findFirst: jest.fn().mockResolvedValue(null),
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
      // 2026-09-07 — "พร้อมขาย" ล้างรูป 6 มุมชุดเก่าก่อนส่งเข้าคิวรอถ่ายรูป
      productPhoto: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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
        findFirst: jest
          .fn()
          .mockImplementation(async (args?: { where?: { companyCode?: string } }) =>
            args?.where?.companyCode === 'SHOP' ? { id: 'company-shop' } : { id: 'company-finance' },
          ),
      },
      $transaction: jest.fn().mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') return fn(prisma);
        return Promise.all(fn as Promise<unknown>[]);
      }),
      // shopCollectTypedBalance (findAll ปุ่มรับโอนหน้าร้าน) อ่านผ่าน $queryRaw
      $queryRaw: jest.fn().mockResolvedValue([{ balance: '0' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepossessionsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JournalAutoService,
          useValue: (journalAuto = {
            createBadDebtWriteOffJournal: jest.fn().mockResolvedValue('je-bd-1'),
            createRepossessionResaleJournal: jest.fn().mockResolvedValue('je-repo-1'),
            // ขาคู่ SHOP ตอนยึด (2026-09-05) — ShopCollectShopLegs.postRepossessionIntake
            createAndPost: jest.fn().mockResolvedValue({ id: 'je-shop-1', entryNumber: 'JE-SHOP-1' }),
          }),
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
          provide: RefundPayoutTemplate,
          useValue: (refundPayoutTemplate = {
            execute: jest.fn().mockResolvedValue({ entryNo: 'JE-REFUND-MOCK', deduped: false }),
          }),
        },
        {
          provide: RefundWaiveTemplate,
          useValue: (refundWaiveTemplate = {
            execute: jest.fn().mockResolvedValue({
              entryNo: 'JE-WAIVE-MOCK',
              waivedAmount: '1810.00',
              deduped: false,
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

    it('customerRefund is always 0 — no-refund policy (คำตัดสินเจ้าของ 2026-09-05)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', {
        customerRefundEnabled: true,
        appraisalPrice: 5000,
      });
      expect(result.calculation.customerRefund).toBe(0);
      expect(result.calculation.customerRefundEnabled).toBe(false);
    });

    it('does NOT fall back to costPrice — no market/appraisal input = marketValue 0 + source null', async () => {
      // 2026-09-05: costPrice (ต้นทุนซื้อเข้า) ไม่ใช่ราคากลาง และ create() ไม่มี fallback นี้
      // ⇒ preview เคยโชว์กำไร/ขาดทุนจากเลขที่ไม่มีวันถูกบันทึกจริง. ตอนนี้บอกตรงๆ ว่ายังคำนวณไม่ได้
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', {});

      expect(result.calculation.marketValue).toBe(0);
      expect(result.calculation.marketValueSource).toBeNull();
      expect(result.valuation).toBeNull();
    });

    it('looks up the trade-in valuation table for the chosen grade (brand+model+storage+grade)', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({
          product: {
            id: 'product-1',
            name: 'iPhone 14',
            brand: 'Apple',
            model: 'iPhone 14',
            storage: '128GB',
            costPrice: decimal(8000),
            status: 'INSTALLMENT',
          },
        }),
      );
      prisma.tradeInValuation = {
        findFirst: jest.fn().mockResolvedValue({ basePrice: decimal(6500), note: 'ตัวเครื่องอย่างเดียว' }),
      };

      const result = await service.previewCalculation('contract-1', { conditionGrade: 'B' });

      expect(prisma.tradeInValuation.findFirst).toHaveBeenCalledWith({
        where: {
          brand: { equals: 'Apple', mode: 'insensitive' },
          model: { equals: 'iPhone 14', mode: 'insensitive' },
          storage: { equals: '128GB', mode: 'insensitive' },
          condition: 'B',
          deletedAt: null,
        },
      });
      expect(result.valuation).toEqual({
        grade: 'B',
        found: true,
        suggestedPrice: 6500,
        note: 'ตัวเครื่องอย่างเดียว',
      });
      // การแนะนำไม่ได้แปลว่าใช้เป็นราคากลางโดยอัตโนมัติ — หน้าจอเป็นคนเติมลงช่อง แล้วส่งกลับมา
      expect(result.calculation.marketValueSource).toBeNull();
    });

    it('reports found=false when the model/grade is missing from the valuation table', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.tradeInValuation = { findFirst: jest.fn().mockResolvedValue(null) };

      const result = await service.previewCalculation('contract-1', { conditionGrade: 'D' });

      expect(result.valuation).toEqual({ grade: 'D', found: false, suggestedPrice: null, note: null });
    });

    it('prefers appraisalPrice over costPrice as the marketValue fallback', async () => {
      // Placeholder promises "ใช้ราคาประเมินถ้าเว้นว่าง" — and create() falls
      // back to dto.appraisalPrice, so preview must match or the confirmed
      // figures diverge from the previewed ones.
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', { appraisalPrice: 6500 });

      expect(result.calculation.marketValue).toBeCloseTo(6500, 2);
      expect(result.calculation.marketValueSource).toBe('APPRAISAL');
    });

    it('computes profitLoss = ราคากลาง − ยอดปิดสัญญา (owner rule 2026-07-09)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', { appraisalPrice: 5000 });

      // สูตรเดียวกับปิดยอดก่อนกำหนด (owner 2026-07-20):
      // ยอดค้าง 2000 (รวม VAT) → exVat 1869.16; ต้นทุน 1750;
      // ส่วนลด 50% × (1869.16 − 1750) = ROUND_DOWN(59.58) = 59.58;
      // ยอดปิด = 2000 − 59.58 + ค่าปรับ 100 = 2040.42
      expect(result.calculation.closingAmount).toBeCloseTo(2040.42, 2);
      expect(result.calculation.profitLoss).toBeCloseTo(5000 - 2040.42, 2);
    });

    it('profitLoss ignores the (retired) refund flag — market − closing even when customerRefundEnabled=true', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', {
        appraisalPrice: 5000,
        customerRefundEnabled: true,
      });

      expect(result.calculation.customerRefund).toBe(0);
      expect(result.calculation.profitLoss).toBeCloseTo(5000 - 2040.42, 2);
    });

    it('eligibility: strict mode + DEFAULT contract → canRepossess=false with the letter hint', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 'true' });
      prisma.contract.findUnique.mockResolvedValue(makeContract({ status: 'DEFAULT' }));

      const result = await service.previewCalculation('contract-1', {});

      expect(result.eligibility.canRepossess).toBe(false);
      expect(result.eligibility.reason).toMatch(/หนังสือบอกเลิก/);
    });

    it('eligibility: TERMINATED contract is repossessable even under strict mode; ACTIVE never is', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 'true' });
      prisma.contract.findUnique.mockResolvedValue(makeContract({ status: 'TERMINATED' }));
      expect((await service.previewCalculation('contract-1', {})).eligibility).toEqual({
        canRepossess: true,
        reason: null,
      });

      prisma.systemConfig.findUnique.mockResolvedValue(null);
      prisma.contract.findUnique.mockResolvedValue(makeContract({ status: 'ACTIVE' }));
      expect((await service.previewCalculation('contract-1', {})).eligibility.canRepossess).toBe(
        false,
      );
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
      // ต้องสร้าง "วันสุดท้ายของเดือนก่อน" บนปฏิทิน **เวลาไทย** ให้ตรงกับ `bkkYearMonth`
      // ที่ service ใช้ตัดสิน — เดิมใช้ `new Date()` + setDate ซึ่งเป็นเวลาเครื่อง ⇒ บน CI
      // (TZ=UTC) วันที่ได้จะเป็น "วันสุดท้ายของเดือนก่อน เวลา <เวลาปัจจุบัน> UTC" ซึ่งเมื่อ
      // แปลงเป็นเวลาไทย (+7) จะข้ามไปเป็นวันที่ 1 ของเดือนปัจจุบันทันทีที่รันหลัง 17:00 UTC
      // (= หลังเที่ยงคืนเวลาไทย) ⇒ guard ไม่ยิง แล้วโค้ดไหลไปตกที่ 'ไม่พบสัญญา' แทน
      // (เทสล้มจริงบน CI 2026-08-23 17:57Z, ผ่านตอน 14:10Z — ดู bkkYearMonth ใน date.util)
      // ตรึงเวลาไว้เที่ยงวันไทยเพื่อให้ห่างจากขอบเดือนทั้งสองฝั่ง ไม่ว่าเครื่องจะอยู่ TZ ไหน
      const [y, m] = bkkYearMonth(new Date()).split('-').map(Number);
      const prevMonth = new Date(Date.UTC(y, m - 1, 1, 5, 0, 0)); // 12:00 ไทย ของวันที่ 1 เดือนนี้
      prevMonth.setUTCDate(0); // ถอย 1 วัน → วันสุดท้ายของเดือนก่อน (ยังเป็นเที่ยงวันไทย)
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
      // สัญญามีงวดค้าง (default ของ makeContract) — เดินเส้น JP5 ตามปกติด้วย mock template
      prisma.contract.findUnique.mockResolvedValue(makeContract({ status: 'TERMINATED' }));
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

    it('rejects a contract with no outstanding balance before JP5/CN (ผ่อนครบ = เครื่องเป็นของลูกค้า — review 2026-09-05)', async () => {
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

      await expect(service.create(baseDto as never, 'user-1')).rejects.toThrow(/ไม่มียอดค้างชำระ/);

      expect(jp5.execute).not.toHaveBeenCalled();
      expect(creditNoteService.issueForContract).not.toHaveBeenCalled();
      expect(prisma.badDebtProvision.updateMany).not.toHaveBeenCalled();
      expect(prisma.repossession.create).not.toHaveBeenCalled();
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('rejects customerRefundEnabled=true outright — no-refund policy (คำตัดสินเจ้าของ 2026-09-05)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract({ status: 'TERMINATED' }));

      await expect(
        service.create({ ...baseDto, customerRefundEnabled: true } as never, 'user-1'),
      ).rejects.toThrow(/ไม่มีเงินคืนส่วนต่าง/);

      expect(prisma.repossession.create).not.toHaveBeenCalled();
      expect(jp5.execute).not.toHaveBeenCalled();
    });

    describe('ขาคู่ฝั่ง SHOP ตอนยึด + กรรมสิทธิ์/หมวดสินค้า (2026-09-05)', () => {
      const runCreate = async (dto: Record<string, unknown>) => {
        prisma.contract.findUnique.mockResolvedValue(makeContract({ status: 'TERMINATED' }));
        prisma.tradeInValuation = { findFirst: jest.fn().mockResolvedValue(null) };
        prisma.repossession.create.mockResolvedValue(makeRepossession());
        prisma.contract.update.mockResolvedValue({});
        prisma.product.update.mockResolvedValue({});
        await service.create({ ...baseDto, ...dto } as never, 'user-1');
        const shopCalls = journalAuto.createAndPost.mock.calls.filter(
          ([input]: [Record<string, unknown>]) =>
            (input.metadata as Record<string, unknown>)?.flow === 'shop-repossession-intake',
        );
        return shopCalls.map(([input]: [Record<string, unknown>]) => input);
      };

      it('appraisal 0 (DTO allows it) → JP5 still posts, SHOP intake skipped — no zero-value stock entry', async () => {
        const shopCalls = await runCreate({ appraisalPrice: 0, collectedByShop: true });
        expect(shopCalls).toHaveLength(0);
        expect(jp5.execute).toHaveBeenCalledTimes(1);
      });

      it('device already has a Repossession row (productId @unique) → 409 Thai before any JE', async () => {
        prisma.repossession.findFirst.mockResolvedValueOnce({ id: 'repo-old' });
        await expect(runCreate({ collectedByShop: true })).rejects.toThrow(/เคยถูกยึดคืนมาแล้ว/);
        expect(jp5.execute).not.toHaveBeenCalled();
        expect(prisma.repossession.create).not.toHaveBeenCalled();
      });

      it('P2002 from the unique index (lost race) → same 409 Thai, never a raw 500', async () => {
        prisma.repossession.create.mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
        );
        await expect(runCreate({ collectedByShop: true })).rejects.toThrow(/เคยถูกยึดคืนมาแล้ว/);
      });

      it('collectedByShop → SHOP books Dr S11-2002 / Cr S21-1104 (typed SHOP_COLLECT) at the appraisal, same tx as JP5', async () => {
        const [je] = await runCreate({ collectedByShop: true });
        expect(je).toBeDefined();
        expect(je.companyId).toBe('company-shop'); // สมุด SHOP — companyInfo mock แยก id ตาม companyCode
        const lines = je.lines as Array<{ accountCode: string; dr: Prisma.Decimal; cr: Prisma.Decimal }>;
        expect(lines.map((l) => [l.accountCode, l.dr.toString(), l.cr.toString()])).toEqual([
          ['S11-2002', '6000', '0'],
          ['S21-1104', '0', '6000'],
        ]);
        const meta = je.metadata as Record<string, unknown>;
        expect(meta.shopReceivableType).toBe('SHOP_COLLECT');
        expect(meta.contractId).toBe('contract-1');
        expect(meta.idempotencyKey).toBe('shop-repossession-intake:contract-1');
        expect(jp5.execute).toHaveBeenCalledTimes(1);
      });

      it('paid straight to FINANCE KBank → SHOP books Cr S11-1202 instead, with no interco stamp', async () => {
        const [je] = await runCreate({ collectedByShop: false, depositAccountCode: '11-1201' });
        const lines = je.lines as Array<{ accountCode: string }>;
        expect(lines.map((l) => l.accountCode)).toEqual(['S11-2002', 'S11-1202']);
        expect((je.metadata as Record<string, unknown>).shopReceivableType).toBeUndefined();
      });

      it('flips ownership to SHOP and PHONE_NEW → PHONE_USED on the repossessed product', async () => {
        await runCreate({});
        const productData = prisma.product.update.mock.calls[0][0].data;
        expect(productData.status).toBe('REPOSSESSED');
        expect(productData.ownedByCompanyId).toBe('company-shop'); // companyInfo mock แยก id ตาม companyCode
        expect(productData.category).toBeUndefined(); // fixture product has no category → untouched
      });

      it('validates the SHOP accounting period too (validatePeriodOpen called for both companies)', async () => {
        const spy = jest.spyOn(periodLockUtil, 'validatePeriodOpen');
        spy.mockClear();
        await runCreate({});
        expect(spy).toHaveBeenCalledTimes(2);
      });
    });

    describe('ราคาเดียว + ตารางรับซื้อเป็นตัวเทียบ (2026-09-05)', () => {
      const tableRow = (basePrice: number) => ({
        findFirst: jest.fn().mockResolvedValue({ basePrice: decimal(basePrice), note: null }),
      });

      it('requires a note when the appraisal deviates more than 15% from the valuation table', async () => {
        prisma.contract.findUnique.mockResolvedValue(makeContract({ status: 'TERMINATED' }));
        prisma.tradeInValuation = tableRow(8000); // appraisal 6000 = −25%

        await expect(
          service.create({ ...baseDto, notes: '   ' } as never, 'user-1'),
        ).rejects.toThrow(/เกิน 15%/);

        expect(prisma.repossession.create).not.toHaveBeenCalled();
        expect(jp5.execute).not.toHaveBeenCalled();
      });

      it('stores the table price as the marketValue snapshot when a note explains the deviation', async () => {
        prisma.contract.findUnique.mockResolvedValue(makeContract({ status: 'TERMINATED' }));
        prisma.tradeInValuation = tableRow(8000);
        prisma.repossession.create.mockResolvedValue(makeRepossession());
        prisma.contract.update.mockResolvedValue({});
        prisma.product.update.mockResolvedValue({});

        await service.create({ ...baseDto, notes: 'จอแตก กระจกหลังร้าว' } as never, 'user-1');

        const data = prisma.repossession.create.mock.calls[0][0].data;
        expect(String(data.marketValue)).toBe('8000');
        expect(data.customerRefundEnabled).toBe(false);
        expect(String(data.customerRefund)).toBe('0');
        // กำไร/ขาดทุนบนจอ = ราคาประเมิน − ยอดปิด (ไม่ใช่ราคาตาราง)
        expect(Number(data.profitLoss)).toBeCloseTo(6000 - Number(data.closingAmount), 2);
      });

      it('within ±15% needs no note; marketValue falls back to the appraisal when the model is not in the table', async () => {
        prisma.contract.findUnique.mockResolvedValue(makeContract({ status: 'TERMINATED' }));
        prisma.tradeInValuation = { findFirst: jest.fn().mockResolvedValue(null) };
        prisma.repossession.create.mockResolvedValue(makeRepossession());
        prisma.contract.update.mockResolvedValue({});
        prisma.product.update.mockResolvedValue({});

        await service.create(baseDto as never, 'user-1');

        const data = prisma.repossession.create.mock.calls[0][0].data;
        expect(String(data.marketValue)).toBe('6000');
      });
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

        // review 2026-09-05: ไม่มียอดค้าง → ปฏิเสธก่อน JP5/CN — deliver ต้องไม่ถูกเรียกเช่นเดิม
        await expect(service.create(baseDto as never, 'user-1')).rejects.toThrow(/ไม่มียอดค้างชำระ/);

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
      // ทุกงวด PAID → outstandingBalance = 0 → ตั้งแต่ review 2026-09-05 create() ปฏิเสธ (หลังโหลดสัญญา)
      // — test นี้สนแค่ shape ของ include ซึ่งถูกเรียกก่อนด่านนั้น จึงไม่ต้องพึ่ง mock ของ jp5/CN เลย
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
      await expect(
        service.create(
          {
            contractId: 'contract-1',
            repossessedDate: '2026-08-07',
            conditionGrade: 'B',
            appraisalPrice: 5000,
          } as never,
          'user-1',
        ),
      ).rejects.toThrow(/ไม่มียอดค้างชำระ/);
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
  // refundPayment (Task 2 — คำสั่งเจ้าของ 2026-08-08 ข้อ 2)
  // ──────────────────────────────────────────────────────────────────────────
  describe('refundPayment', () => {
    const owner = { id: 'user-1', role: 'OWNER' as const };
    const dto = { depositAccountCode: '11-1201', amount: 1810, requestId: 'req-1' };

    it('throws BadRequestException when customerRefundEnabled is false (ไม่ได้ติ๊กตอนยึด)', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ customerRefundEnabled: false }),
      );

      await expect(service.refundPayment('repo-1', owner, dto)).rejects.toThrow(BadRequestException);
      expect(refundPayoutTemplate.execute).not.toHaveBeenCalled();
    });

    it('calls RefundPayoutTemplate.execute with contractId from the repossession + dto fields, inside $transaction', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ customerRefundEnabled: true, contractId: 'contract-1' }),
      );

      await service.refundPayment('repo-1', owner, dto);

      expect(refundPayoutTemplate.execute).toHaveBeenCalledWith(
        {
          contractId: 'contract-1',
          depositAccountCode: '11-1201',
          amount: 1810,
          postedById: 'user-1',
          requestId: 'req-1',
        },
        prisma, // tx (mock $transaction passes prisma itself as tx)
      );
      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
    });

    it('writes a REFUND_PAYOUT audit log with amount (2dp Decimal string, matches JE metadata shape)/depositAccountCode/requestId/deduped (M3 review)', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ customerRefundEnabled: true, contractId: 'contract-1' }),
      );
      refundPayoutTemplate.execute.mockResolvedValueOnce({ entryNo: 'JE-X', deduped: true });

      await service.refundPayment('repo-1', owner, dto);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          action: 'REFUND_PAYOUT',
          entity: 'repossession',
          entityId: 'repo-1',
          newValue: {
            amount: '1810.00',
            depositAccountCode: '11-1201',
            requestId: 'req-1',
            deduped: true,
          },
        },
      });
    });

    it('returns success + entryNo/deduped from the template result', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ customerRefundEnabled: true, contractId: 'contract-1' }),
      );
      refundPayoutTemplate.execute.mockResolvedValueOnce({ entryNo: 'JE-Y', deduped: false });

      const result = await service.refundPayment('repo-1', owner, dto);

      expect(result).toEqual({
        success: true,
        repossessionId: 'repo-1',
        entryNo: 'JE-Y',
        deduped: false,
      });
    });

    it('BM ข้ามสาขา → NotFoundException (findOne branch scope) ก่อนถึง template', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({
          customerRefundEnabled: true,
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
        service.refundPayment('repo-1', { id: 'u1', role: 'BRANCH_MANAGER', branchId: 'branch-2' }, dto),
      ).rejects.toThrow(NotFoundException);
      expect(refundPayoutTemplate.execute).not.toHaveBeenCalled();
    });

    // I3 (review, Task 2): refundPayment must not post an accounting entry
    // into a CLOSED FINANCE period. Note on determinism: unlike create(),
    // refundPayment always books to `new Date()` (today) — the transaction
    // date can never fall in a past/CLOSED-and-past-grace month by
    // construction, so a real "CLOSED + past grace window" rejection cannot
    // be reproduced deterministically through validatePeriodOpen's actual
    // date math (mirrors the reasoning already documented on create()'s
    // grace-window test above). Strongest deterministic option: spy on
    // validatePeriodOpen to force the throw, which simultaneously proves (a)
    // the guard is wired with the correct (prisma, date≈now, FINANCE
    // companyId) args, (b) the real BadRequestException propagates out of
    // refundPayment, and (c) the guard runs BEFORE the $transaction/template
    // (proven by RefundPayoutTemplate.execute never being called).
    it('period guard rejects when validatePeriodOpen throws (CLOSED period past grace) — runs BEFORE the transaction', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ customerRefundEnabled: true, contractId: 'contract-1' }),
      );
      const spy = jest
        .spyOn(periodLockUtil, 'validatePeriodOpen')
        .mockRejectedValueOnce(
          new BadRequestException('ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว (2026/07 สถานะ: CLOSED)'),
        );

      await expect(service.refundPayment('repo-1', owner, dto)).rejects.toThrow(
        'ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว',
      );

      expect(spy).toHaveBeenCalledWith(prisma, expect.any(Date), 'company-finance');
      expect(refundPayoutTemplate.execute).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();

      spy.mockRestore();
    });

    it('fails loud when FINANCE company is not configured (period guard must not silently no-op)', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ customerRefundEnabled: true, contractId: 'contract-1' }),
      );
      prisma.companyInfo.findFirst.mockResolvedValueOnce(null);

      await expect(service.refundPayment('repo-1', owner, dto)).rejects.toThrow(
        'FINANCE company not configured',
      );
      expect(refundPayoutTemplate.execute).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // waiveRefund (คำสั่งเจ้าของ 2026-08-08 เพิ่มเติม — ไม่คืนเงิน)
  // ──────────────────────────────────────────────────────────────────────────
  describe('waiveRefund', () => {
    const owner = { id: 'user-1', role: 'OWNER' as const };
    const dto = { requestId: 'req-waive-1' };

    it('throws BadRequestException when customerRefundEnabled is false (ไม่ได้ติ๊กตอนยึด)', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ customerRefundEnabled: false }),
      );

      await expect(service.waiveRefund('repo-1', owner, dto)).rejects.toThrow(BadRequestException);
      expect(refundWaiveTemplate.execute).not.toHaveBeenCalled();
    });

    it('calls RefundWaiveTemplate.execute with contractId from the repossession + requestId, inside $transaction', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ customerRefundEnabled: true, contractId: 'contract-1' }),
      );

      await service.waiveRefund('repo-1', owner, dto);

      expect(refundWaiveTemplate.execute).toHaveBeenCalledWith(
        {
          contractId: 'contract-1',
          postedById: 'user-1',
          requestId: 'req-waive-1',
        },
        prisma, // tx (mock $transaction passes prisma itself as tx)
      );
      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
    });

    it('writes a REFUND_WAIVED audit log with contractId/waivedAmount/requestId/deduped', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ customerRefundEnabled: true, contractId: 'contract-1' }),
      );
      refundWaiveTemplate.execute.mockResolvedValueOnce({
        entryNo: 'JE-X',
        waivedAmount: '900.00',
        deduped: true,
      });

      await service.waiveRefund('repo-1', owner, dto);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          action: 'REFUND_WAIVED',
          entity: 'repossession',
          entityId: 'repo-1',
          newValue: {
            contractId: 'contract-1',
            waivedAmount: '900.00',
            requestId: 'req-waive-1',
            deduped: true,
          },
        },
      });
    });

    it('returns success + entryNo/waivedAmount/deduped from the template result', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ customerRefundEnabled: true, contractId: 'contract-1' }),
      );
      refundWaiveTemplate.execute.mockResolvedValueOnce({
        entryNo: 'JE-Y',
        waivedAmount: '1810.00',
        deduped: false,
      });

      const result = await service.waiveRefund('repo-1', owner, dto);

      expect(result).toEqual({
        success: true,
        repossessionId: 'repo-1',
        entryNo: 'JE-Y',
        waivedAmount: '1810.00',
        deduped: false,
      });
    });

    it('BM ข้ามสาขา → NotFoundException (findOne branch scope) ก่อนถึง template', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({
          customerRefundEnabled: true,
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
        service.waiveRefund('repo-1', { id: 'u1', role: 'BRANCH_MANAGER', branchId: 'branch-2' }, dto),
      ).rejects.toThrow(NotFoundException);
      expect(refundWaiveTemplate.execute).not.toHaveBeenCalled();
    });

    // Mirrors refundPayment's period-guard test above — same rationale: waiveRefund
    // always books to `new Date()` (today), so a real CLOSED-past-grace rejection
    // cannot be reproduced deterministically; spy on validatePeriodOpen instead.
    it('period guard rejects when validatePeriodOpen throws (CLOSED period past grace) — runs BEFORE the transaction', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ customerRefundEnabled: true, contractId: 'contract-1' }),
      );
      const spy = jest
        .spyOn(periodLockUtil, 'validatePeriodOpen')
        .mockRejectedValueOnce(
          new BadRequestException('ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว (2026/07 สถานะ: CLOSED)'),
        );

      await expect(service.waiveRefund('repo-1', owner, dto)).rejects.toThrow(
        'ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว',
      );

      expect(spy).toHaveBeenCalledWith(prisma, expect.any(Date), 'company-finance');
      expect(refundWaiveTemplate.execute).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();

      spy.mockRestore();
    });

    it('fails loud when FINANCE company is not configured (period guard must not silently no-op)', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ customerRefundEnabled: true, contractId: 'contract-1' }),
      );
      prisma.companyInfo.findFirst.mockResolvedValueOnce(null);

      await expect(service.waiveRefund('repo-1', owner, dto)).rejects.toThrow(
        'FINANCE company not configured',
      );
      expect(refundWaiveTemplate.execute).not.toHaveBeenCalled();
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

    it('PATCH สถานะเป็น READY_FOR_SALE ถูกปฏิเสธ — ต้องผ่านปุ่ม "พร้อมขาย" (สองราคา + คิวรอถ่ายรูป)', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({ status: 'UNDER_REPAIR' }),
      );

      await expect(
        service.update('repo-1', { status: 'READY_FOR_SALE', resellPrice: 7000 } as never),
      ).rejects.toThrow(/พร้อมขาย/);
      expect(prisma.product.update).not.toHaveBeenCalled();
      expect(prisma.repossession.update).not.toHaveBeenCalled();
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

      // 2026-09-05: "ขายแล้ว" ตั้งด้วยมือไม่ได้อีกต่อไป — ขายผ่าน POS แล้ว SaleWriterService ปิดให้เอง
      await expect(
        service.update('repo-1', { status: 'SOLD', resellPrice: 7000 } as never, {
          id: 'user-1',
          role: 'OWNER',
        }),
      ).rejects.toThrow(/POS/);
      expect(prisma.repossession.update).not.toHaveBeenCalled();
      // RepossessionJP5Template.execute was NOT called for resale (deferred to Phase A.5)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const template = (service as any).repossessionJP5Template;
      expect(template.execute).not.toHaveBeenCalled();
    });
  });

  describe('markReadyForSale — พร้อมขาย = สองราคา + เข้าคิวรอถ่ายรูป (2026-09-07)', () => {
    const repoRow = (over: Record<string, unknown> = {}) => ({
      id: 'r1',
      status: 'REPOSSESSED',
      appraisalPrice: null,
      product: { id: 'prod-1', prices: [] },
      deletedAt: null,
      ...over,
    });
    const arm = () => {
      prisma.repossession.update.mockResolvedValue({ id: 'r1', status: 'READY_FOR_SALE' });
      prisma.product.update.mockResolvedValue({ id: 'prod-1' });
      // beforeEach เดิมมีแค่ productPrice.{findFirst,create,update} — util ใช้ findMany + updateMany
      prisma.productPrice.findMany = jest.fn().mockResolvedValue([]);
      prisma.productPrice.updateMany = jest.fn().mockResolvedValue({ count: 0 });
      prisma.productPrice.create.mockResolvedValue({ id: 'row-1' });
    };

    it('เขียนราคาเงินสด + ราคาผ่อนลงคอลัมน์ และสร้างแถวราคาทั้งสอง', async () => {
      prisma.repossession.findUnique.mockResolvedValue(repoRow());
      arm();

      await service.markReadyForSale('r1', { resellPrice: 21000, installmentPrice: 23900 });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const priceUpdate = prisma.product.update.mock.calls.find(
        (c: any[]) => c[0].data.cashPrice !== undefined,
      );
      expect(priceUpdate).toBeDefined();
      expect(priceUpdate[0].data.cashPrice.toString()).toBe('21000');
      expect(priceUpdate[0].data.installmentPrice.toString()).toBe('23900');
      const labels = prisma.productPrice.create.mock.calls.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any[]) => c[0].data.label,
      );
      expect(labels).toEqual(expect.arrayContaining(['ราคาเงินสด', 'ราคาผ่อน BESTCHOICE']));
      expect(prisma.repossession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'READY_FOR_SALE', resellPrice: 21000 } }),
      );
    });

    it('เครื่องเข้าคิวรอถ่ายรูป (PHOTO_PENDING ไม่ใช่ REFURBISHED) กลับคลังหลัก และรูป 6 มุมชุดเก่าถูกล้าง', async () => {
      prisma.repossession.findUnique.mockResolvedValue(repoRow());
      arm();

      await service.markReadyForSale('r1', { resellPrice: 5000, installmentPrice: 5900 });

      const statusUpdate = prisma.product.update.mock.calls[0][0];
      expect(statusUpdate.data.status).toBe('PHOTO_PENDING');
      expect(statusUpdate.data.branchId).toBe('branch-1');
      expect(prisma.productPhoto.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productId: 'prod-1' },
          data: expect.objectContaining({ front: null, bottom: null, isCompleted: false }),
        }),
      );
    });

    it('costPrice = ราคาประเมิน (R-007/TAS 2) ไม่ใช่ราคาขายต่อ', async () => {
      prisma.repossession.findUnique.mockResolvedValue(repoRow({ appraisalPrice: decimal(6000) }));
      arm();

      await service.markReadyForSale('r1', { resellPrice: 7500, installmentPrice: 8500 });

      const statusUpdate = prisma.product.update.mock.calls[0][0];
      expect(new Prisma.Decimal(statusUpdate.data.costPrice).eq(6000)).toBe(true);
    });

    it('ไม่มีราคาประเมิน → costPrice ถอยไปใช้ราคาขายต่อ', async () => {
      prisma.repossession.findUnique.mockResolvedValue(repoRow({ appraisalPrice: null }));
      arm();

      await service.markReadyForSale('r1', { resellPrice: 4200, installmentPrice: 4900 });

      const statusUpdate = prisma.product.update.mock.calls[0][0];
      expect(new Prisma.Decimal(statusUpdate.data.costPrice).eq(4200)).toBe(true);
    });

    it('ต้องมีทั้งสองราคา — ขาดราคาผ่อน → BadRequestException', async () => {
      prisma.repossession.findUnique.mockResolvedValue(repoRow());
      arm();

      await expect(
        service.markReadyForSale('r1', { resellPrice: 4200, installmentPrice: 0 }),
      ).rejects.toThrow(/ราคาผ่อน/);
      await expect(
        service.markReadyForSale('r1', { resellPrice: 0, installmentPrice: 4900 }),
      ).rejects.toThrow(/ราคาขายต่อ/);
      expect(prisma.product.update).not.toHaveBeenCalled();
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

    // 2026-09-07: PATCH ไปสถานะพร้อมขายถูกปิดทุกกรณี (แม้แถวมีราคาขายต่อค้างอยู่แล้ว) —
    // costBasis fallback ของเส้นทางนี้จึงไม่มีอีก (ดู markReadyForSale ซึ่งบังคับส่งสองราคา)
    it('READY_FOR_SALE ผ่าน PATCH ถูกปฏิเสธแม้แถวมี resellPrice อยู่แล้ว', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({
          status: 'UNDER_REPAIR',
          appraisalPrice: decimal(0),
          resellPrice: decimal(7000),
        }),
      );

      await expect(
        service.update('repo-1', { status: 'READY_FOR_SALE' } as never, owner),
      ).rejects.toThrow(/พร้อมขาย/);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    // Phase 2 review follow-up (Item 1): costBasis = appraisal>0 ? appraisal : fallback
    // (fallback = dto.resellPrice ?? repo.resellPrice ?? 0) can only reach 0 when BOTH
    // appraisalPrice and resellPrice are unset — but the READY_FOR_SALE/SOLD resell-price
    // guard above (line ~653-659) already throws BadRequestException in that exact case,
    // using the identical `dto.resellPrice ?? repo.resellPrice ?? 0` fallback. So the
    // both-zero costPrice branch is UNREACHABLE by construction: this test proves the
    // guard fires first, so productUpdateData.costPrice can never be silently left unset.
    it('appraisalPrice=0 + ไม่มีราคาขายทั้งจาก dto/repo → BadRequestException ก่อนถึง costPrice branch (พิสูจน์ unreachable)', async () => {
      prisma.repossession.findUnique.mockResolvedValue(
        makeRepossession({
          status: 'UNDER_REPAIR',
          appraisalPrice: decimal(0),
          resellPrice: null,
        }),
      );

      await expect(
        service.update('repo-1', { status: 'READY_FOR_SALE' } as never, owner),
      ).rejects.toThrow('กรุณาระบุราคาขายต่อก่อนเปลี่ยนสถานะ');

      expect(prisma.product.update).not.toHaveBeenCalled();
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
