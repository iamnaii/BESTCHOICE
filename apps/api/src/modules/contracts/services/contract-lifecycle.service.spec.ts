import { Prisma } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { getRateForMonths } from '../../../utils/get-rate-for-months.util';
import * as creditApproval from '../../credit-check/services/credit-approval';
/**
 * ContractLifecycleService — ShopDownPayment wiring tests (Task 6 + Task 7).
 *
 * Task 6: `create()` posts `ShopDownPaymentTemplate` exactly when
 * `downPayment > 0`, and skips it when `downPayment = 0`.
 *
 * Task 7: `softDelete()` posts `ShopDownPaymentReversalTemplate` when
 * `downPayment > 0` AND a down JE exists, and skips it when no down JE exists.
 *
 * The service is instantiated directly (not via NestJS DI) to match the
 * way `ContractsService` constructs it with `new ContractLifecycleService(...)`.
 */

import { Decimal } from '@prisma/client/runtime/library';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ShopDownPaymentTemplate } from '../../journal/cpa-templates/shop-down-payment.template';
import { ShopDownPaymentReversalTemplate } from '../../journal/cpa-templates/shop-down-payment-reversal.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { TEST_CUSTOMER_ADDRESS } from '../../../utils/test-data-markers';

// ─── module-level mocks (must be hoisted before imports are used) ─────────────

jest.mock('../../../utils/installment.util', () => ({
  calculateInstallmentWithInterest: jest.fn().mockReturnValue({
    principal: 17000,
    interestTotal: 1632,
    storeCommission: 1700,
    vatAmount: 213.78,
    financedAmount: 20545.78,
    monthlyPayment: 1712,
  }),
  roundBaht: jest.fn().mockImplementation((v: number) => Math.round(v * 100) / 100),
  generatePaymentSchedule: jest.fn().mockReturnValue([
    { contractId: 'c-1', installmentNo: 1, amountDue: 1712, dueDate: new Date(), status: 'PENDING' },
  ]),
}));

jest.mock('../../../utils/get-rate-for-months.util', () => ({
  getRateForMonths: jest.fn().mockResolvedValue(0.96),
}));

jest.mock('../../../utils/config.util', () => ({
  loadInstallmentConfig: jest.fn().mockResolvedValue({}),
  resolveInstallmentParams: jest.fn().mockReturnValue({
    interestRate: 0.08,
    minDownPaymentPct: 0.05,
    minInstallmentMonths: 6,
    maxInstallmentMonths: 24,
    storeCommissionPct: 0.10,
    vatPct: 0.07,
  }),
  resolveVatPctForBranch: jest.fn().mockResolvedValue(0.07),
  resolveBranchVat: jest.fn().mockResolvedValue({ vatPct: 0.07, source: 'BRANCH_COMPANY' }),
}));

jest.mock('../../../utils/sequence.util', () => ({
  generateContractNumber: jest.fn().mockResolvedValue('CN-1'),
}));

// ─── fixtures ────────────────────────────────────────────────────────────────

const mockProduct = {
  id: 'prod-1',
  branchId: 'br-1', wasPreviouslyDamaged: false,
  status: 'IN_STOCK',
  category: 'PHONE_NEW',
  imeiSerial: '123456789012345',
  name: 'iPhone 15',
  po: null,
  deletedAt: null,
};

const mockCustomer = {
  id: 'cust-1',
  name: 'ทดสอบ',
  prefix: 'นาย',
  nickname: null,
  nationalId: '1234567890123',
  phone: '0891234567',
  phoneSecondary: null,
  email: null,
  lineIdFinance: null,
  lineIdShop: null,
  occupation: null,
  salary: null,
  workplace: null,
  addressIdCard: 'กรุงเทพ',
  addressCurrent: 'กรุงเทพ',
  addressWork: null,
  references: [],
  birthDate: null,
  facebookLink: null,
  facebookName: null,
  googleMapLink: null,
  deletedAt: null,
};

const mockCreatedContract = {
  id: 'c-1',
  contractNumber: 'CN-1',
  customerId: 'cust-1',
  productId: 'prod-1',
  branchId: 'br-1',
  salespersonId: 'sp-1',
  status: 'DRAFT',
  workflowStatus: 'CREATING',
  sellingPrice: new Decimal(20000),
  downPayment: new Decimal(2000),
  totalMonths: 12,
  interestConfigId: null,
  deletedAt: null,
};

/** Base DTO used across tests — individual tests override as needed. */
const baseDto = {
  customerId: 'cust-1',
  productId: 'prod-1',
  branchId: 'br-1',
  sellingPrice: 20000,
  downPayment: 2000,
  totalMonths: 12,
  paymentDueDay: 5,
  planType: 'STORE_DIRECT' as const,
  notes: null,
  interestRate: undefined,
  overrideActiveContractCheck: false,
};

// ─── suite ───────────────────────────────────────────────────────────────────

describe('ContractLifecycleService — ShopDownPayment wiring', () => {
  let service: ContractLifecycleService;
  let prisma: any;
  let tx: any;
  let shopDownPaymentTemplate: jest.Mocked<Pick<ShopDownPaymentTemplate, 'execute'>>;
  let shopDownPaymentReversalTemplate: jest.Mocked<Pick<ShopDownPaymentReversalTemplate, 'execute'>>;
  let shopAccountResolver: jest.Mocked<Pick<ShopAccountResolver, 'resolveBranchCashAccount' | 'resolveInflowCashAccount'>>;
  let queryMock: any;

  beforeEach(() => {
    jest.spyOn(creditApproval, 'claimCreditApproval').mockResolvedValue({ id: 'approved-cap' } as never);

    // Inner tx object — the callback arg when prisma.$transaction(cb) is called
    tx = {
      interestConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      creditCheck: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cc-1', status: 'APPROVED', contractId: null }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue(mockProduct),
        // Phase 5 fix round 1 [Important 3]: re-check ใน tx ใช้ findFirst (+ deletedAt: null)
        findFirst: jest.fn().mockResolvedValue(mockProduct),
        update: jest.fn().mockResolvedValue({ ...mockProduct, status: 'RESERVED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      productReservation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue(mockCustomer),
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(async () => ({ ...await queryMock.findOne(), signatures: [] })),
        create: jest.fn().mockResolvedValue(mockCreatedContract),
        update: jest.fn().mockResolvedValue(mockCreatedContract),
      },
      payment: {
        createMany: jest.fn().mockResolvedValue({ count: 12 }),
      },
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      branch: {
        findUnique: jest.fn().mockResolvedValue({ shopCashAccountCode: 'S11-1102' }),
      },
      signature: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      kycVerification: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    // Outer prisma — $transaction passes the callback + tx
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'SALES', branchId: 'br-1' }) },
      contract: {
        findMany: jest.fn().mockResolvedValue([]), // no active contracts
      },
      product: {
        findUnique: jest.fn().mockResolvedValue(mockProduct),
        // Phase 5 fix round 1 [Important 3]: re-check ใน tx ใช้ findFirst (+ deletedAt: null)
        findFirst: jest.fn().mockResolvedValue(mockProduct),
      },
      interestConfig: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      systemConfig: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockImplementation(async (cb: (tx: any) => Promise<any>) => cb(tx)),
    };

    // Mocked query service — only needs `isTestModeEnabled` and `findOne`
    queryMock = {
      isTestModeEnabled: jest.fn().mockResolvedValue(false),
      findOne: jest.fn().mockResolvedValue({ ...mockCreatedContract, signatures: [], payments: [] }),
    };

    shopDownPaymentTemplate = {
      execute: jest.fn().mockResolvedValue({ entryNo: 'JE-001', journalEntryId: 'je-1' }),
    };

    shopDownPaymentReversalTemplate = {
      execute: jest.fn().mockResolvedValue({ entryNo: 'JE-REV-001', journalEntryId: 'je-rev-1' }),
    };

    shopAccountResolver = {
      resolveBranchCashAccount: jest.fn().mockResolvedValue('S11-1102'),
      resolveInflowCashAccount: jest.fn(async (_branch, method) => method === 'CASH' ? 'S11-1102' : 'S11-1201'),
    };

    service = new ContractLifecycleService(
      prisma as any,
      queryMock as any,
      shopDownPaymentTemplate as any,
      shopDownPaymentReversalTemplate as any,
      shopAccountResolver as any,
      undefined, // warrantyService — optional
      undefined, // audit — optional
    );
  });

  // ─── Task-6 core assertions ─────────────────────────────────────────────────

  it.each(['P2034', 'P2010'])('returns 409 after three exhausted %s contention attempts', async code => {
    const error = new Prisma.PrismaClientKnownRequestError('contention', { code, clientVersion: 'test', meta: { code: '40P01' } });
    prisma.$transaction.mockRejectedValue(error);
    await expect(service.create({ ...baseDto, notes: undefined }, 'sp-1')).rejects.toMatchObject({ status: 409 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it('returns the missing-rate error before any contract or credit write', async () => {
    tx.interestConfig.findFirst.mockResolvedValue({ id: 'config' });
    (getRateForMonths as jest.Mock).mockRejectedValueOnce(new NotFoundException('ไม่พบอัตราดอกเบี้ย'));
    await expect(service.create({ ...baseDto, notes: undefined }, 'sp-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.contract.create).not.toHaveBeenCalled();
    expect(creditApproval.claimCreditApproval).not.toHaveBeenCalled();
    expect(shopDownPaymentTemplate.execute).not.toHaveBeenCalled();
  });

  it('persists the actual bank-transfer down tender at creation', async () => {
    await service.create({ ...baseDto, downPaymentMethod: 'BANK_TRANSFER', downPaymentReference: 'SYNTHETIC-TRANSFER' } as any, 'sp-1');
    expect(tx.contract.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      downPaymentMethod: 'BANK_TRANSFER', downPaymentReference: 'SYNTHETIC-TRANSFER', downPaymentReceivedAt: expect.any(Date),
    }) }));
    expect(shopDownPaymentTemplate.execute).toHaveBeenCalledWith(expect.objectContaining({ cashAccountCode: 'S11-1201' }), tx);
  });

  it('posts ShopDownPayment when downPayment > 0', async () => {
    await service.create({ ...baseDto, downPayment: 2000, branchId: 'br-1' } as any, 'sp-1');

    expect(shopAccountResolver.resolveInflowCashAccount).toHaveBeenCalledWith('br-1', 'CASH', tx);

    const input = (shopDownPaymentTemplate.execute as jest.Mock).mock.calls[0][0];
    expect(input).toMatchObject({
      idempotencyKey: expect.stringContaining('shop-down-payment:'),
      cashAccountCode: 'S11-1102',
    });
    expect(input.downAmount.toString()).toBe('2000');

    // Confirm the idempotency key encodes the contract id
    expect(input.idempotencyKey).toBe(`shop-down-payment:${mockCreatedContract.id}`);

    // Confirm template was called with the tx (atomic)
    expect(shopDownPaymentTemplate.execute).toHaveBeenCalledWith(input, tx);
  });

  it('skips ShopDownPayment when downPayment = 0', async () => {
    // A contract with zero down-payment — update the tx.contract.create return value
    const contractWithZeroDown = { ...mockCreatedContract, downPayment: new Decimal(0) };
    tx.contract.create.mockResolvedValue(contractWithZeroDown);
    queryMock.findOne.mockResolvedValue({ ...contractWithZeroDown, signatures: [], payments: [] });

    // Need minDownPaymentPct=0 to allow 0 down
    const { resolveInstallmentParams } = jest.requireMock('../../../utils/config.util');
    resolveInstallmentParams.mockReturnValueOnce({
      interestRate: 0.08,
      minDownPaymentPct: 0,
      minInstallmentMonths: 6,
      maxInstallmentMonths: 24,
      storeCommissionPct: 0.10,
      vatPct: 0.07,
    });

    await service.create({ ...baseDto, downPayment: 0 } as any, 'sp-1');

    expect(shopDownPaymentTemplate.execute).not.toHaveBeenCalled();
  });

  // ─── test-data fence (spec 2026-09-05 §5.1) ────────────────────────────────

  describe('test-data fence', () => {
    it('re-check ใน tx โหลด po.poNumber มาด้วย (ชนิดของ isTestProduct บังคับ)', async () => {
      await service.create({ ...baseDto } as any, 'sp-1');
      expect(tx.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ include: { po: { select: { poNumber: true } } } }),
      );
    });

    it('เครื่อง TEST- → ลูกค้าจริง: BadRequest ก่อนสร้างสัญญา', async () => {
      tx.product.findFirst.mockResolvedValue({ ...mockProduct, imeiSerial: 'TEST-0001' });
      await expect(service.create({ ...baseDto } as any, 'sp-1')).rejects.toThrow(
        /เครื่องทดสอบระบบ/,
      );
      expect(tx.contract.create).not.toHaveBeenCalled();
    });

    it('เครื่องจริง → ลูกค้าทดสอบ (ที่อยู่ = marker): BadRequest', async () => {
      tx.customer.findUnique.mockResolvedValue({
        ...mockCustomer,
        addressCurrent: TEST_CUSTOMER_ADDRESS,
      });
      await expect(service.create({ ...baseDto } as any, 'sp-1')).rejects.toThrow(
        /ลูกค้าทดสอบระบบ/,
      );
      expect(tx.contract.create).not.toHaveBeenCalled();
    });

    it('ทดสอบ ↔ ทดสอบ ผ่าน — สัญญาถูกสร้าง', async () => {
      tx.product.findFirst.mockResolvedValue({ ...mockProduct, imeiSerial: 'TEST-0001' });
      tx.customer.findUnique.mockResolvedValue({ ...mockCustomer, phone: 'TEST-0000001' });
      await service.create({ ...baseDto } as any, 'sp-1');
      expect(tx.contract.create).toHaveBeenCalledTimes(1);
    });
  });

  // ─── ด่านเบอร์ (spec 2026-09-13-chat-prospects) ──────────────────────────────

  it('ผู้สนใจจากแชทที่ยังไม่มีเบอร์ (phone null) → BadRequest ชี้ปุ่มเติมเบอร์ ไม่สร้างสัญญา', async () => {
    // A12: ข้อความแยกตาม isChatPlaceholder — ต้องเป็นแถวผู้สนใจจริง (ที่มา CHAT_* ไม่มีเบอร์และเลขบัตร)
    tx.customer.findUnique.mockResolvedValue({ ...mockCustomer, phone: null, nationalId: null, acquisitionSource: 'CHAT_FACEBOOK' });
    await expect(service.create({ ...baseDto } as never, 'sp-1')).rejects.toThrow(
      'ผู้สนใจคนนี้ยังไม่มีเบอร์ — กด "เติมเบอร์" ในหน้าลูกค้า หรือ "เพิ่มเบอร์/ข้อมูล" ในการ์ดผู้สนใจที่อินบ็อกซ์ ก่อนทำสัญญา (ถ้าห้องแชทของผู้สนใจคนนี้มีพนักงานคนอื่นดูแลอยู่ ให้คนดูแลห้อง หรือเจ้าของ/ผู้จัดการสาขา/ผู้จัดการการเงิน เติมให้)',
    );
    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it('ลูกค้าที่มีเลขบัตรแต่ไม่มีเบอร์ → BadRequest ชี้ "แก้ไขข้อมูล" ของเจ้าของ/ผู้จัดการสาขา ไม่สร้างสัญญา', async () => {
    tx.customer.findUnique.mockResolvedValue({ ...mockCustomer, phone: null, acquisitionSource: null });
    await expect(service.create({ ...baseDto } as never, 'sp-1')).rejects.toThrow(
      'ลูกค้ายังไม่มีเบอร์โทร — ให้เจ้าของหรือผู้จัดการสาขากด "แก้ไขข้อมูล" ในหน้าลูกค้าเพื่อเติมเบอร์ก่อนทำสัญญา',
    );
    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  // ─── Task-7 reversal assertions ──────────────────────────────────────────────

  it('reverses the SHOP down payment when voiding a DRAFT contract that had a down JE', async () => {
    // query.findOne returns DRAFT/CREATING contract with downPayment 2000, branchId 'br-1'
    queryMock.findOne.mockResolvedValue({
      ...mockCreatedContract,
      downPayment: new Decimal(2000),
      branchId: 'br-1',
      signatures: [],
      payments: [],
    });
    // a shop-down-payment JE exists for this contract:
    tx.journalEntry.findFirst.mockResolvedValue({ id: 'down-je-1', lines: [{ accountCode: 'S11-1102', debit: new Decimal(2000) }] });
    shopAccountResolver.resolveBranchCashAccount.mockResolvedValue('S11-1102');

    await service.softDelete('c-1', 'user-1');

    const input = (shopDownPaymentReversalTemplate.execute as jest.Mock).mock.calls[0][0];
    expect(input).toMatchObject({
      idempotencyKey: 'shop-down-payment-reversal:c-1',
      refundAccountCode: 'S11-1102',
      originalJournalEntryId: 'down-je-1',
    });
    expect(input.downAmount.toString()).toBe('2000');
    // Confirm template was called with tx as 2nd arg (atomic)
    expect(shopDownPaymentReversalTemplate.execute).toHaveBeenCalledWith(input, tx);
  });

  it('does NOT reverse when no down JE was posted', async () => {
    queryMock.findOne.mockResolvedValue({
      ...mockCreatedContract,
      downPayment: new Decimal(2000),
      branchId: 'br-1',
      signatures: [],
      payments: [],
    });
    // No down JE found
    tx.journalEntry.findFirst.mockResolvedValue(null);

    await service.softDelete('c-1', 'user-1');

    expect(shopDownPaymentReversalTemplate.execute).not.toHaveBeenCalled();
  });

  // ─── Task-6 (B5) web-hold preemption ─────────────────────────────────────────

  it('B5: create() ตัด hold ของเว็บใน tx เดียวกับที่ flip เครื่องเป็น RESERVED (ไม่กระทบ JE ดาวน์)', async () => {
    tx.productReservation.updateMany.mockResolvedValue({ count: 1 });

    // เรียกด้วย 2 args เหมือนเทสต์เดิมทั้งไฟล์ — signature จริงคือ
    // create(dto, salespersonId, salespersonRole?) และไม่ต้องส่ง role เพราะ
    // prisma.contract.findMany คืน [] อยู่แล้ว = ไม่มีสัญญา active ให้ override
    await service.create({ ...baseDto } as any, 'sp-1');

    const call = tx.productReservation.updateMany.mock.calls.at(-1)[0];
    expect(call.where.productId).toEqual({ in: ['prod-1'] });
    expect(call.where.status).toBe('ACTIVE');
    expect(call.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(call.data).toEqual({ status: 'PREEMPTED' });
    // red line: JE เงินดาวน์ยังยิงเหมือนเดิมทุกประการ
    expect(shopDownPaymentTemplate.execute).toHaveBeenCalledTimes(1);
    // cast แบบเดียวกับเทสต์เดิมในไฟล์ (shopDownPaymentTemplate ถูก type เป็น
    // jest.Mocked<Pick<…,'execute'>> — เข้า .mock ตรงๆ ไม่ผ่าน tsc)
    const input = (shopDownPaymentTemplate.execute as jest.Mock).mock.calls[0][0];
    expect(input.idempotencyKey).toBe('shop-down-payment:c-1');
    expect(input.downAmount.toString()).toBe('2000');
  });

  it('B5: ไม่มี hold ค้าง → updateMany คืน count 0 และไม่มีใคร throw', async () => {
    tx.productReservation.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.create({ ...baseDto } as any, 'sp-1')).resolves.toBeDefined();
    expect(shopDownPaymentTemplate.execute).toHaveBeenCalledTimes(1);
  });
  it('does not delete a draft that activated while waiting for the customer lock', async () => {
    tx.contract.findUnique = jest.fn().mockResolvedValue({ ...mockCreatedContract, status: 'ACTIVE' });
    await expect(service.softDelete('c-1', 'user-1')).rejects.toThrow(/สถานะ/);
    expect(tx.contract.update).not.toHaveBeenCalled();
    expect(shopDownPaymentReversalTemplate.execute).not.toHaveBeenCalled();
  });

});

afterEach(() => jest.restoreAllMocks());
