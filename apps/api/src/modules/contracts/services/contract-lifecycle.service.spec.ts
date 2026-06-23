/**
 * ContractLifecycleService — ShopDownPayment wiring tests (Task 6).
 *
 * Verifies that `create()` posts `ShopDownPaymentTemplate` exactly when
 * `downPayment > 0`, and skips it when `downPayment = 0`.
 *
 * The service is instantiated directly (not via NestJS DI) to match the
 * way `ContractsService` constructs it with `new ContractLifecycleService(...)`.
 */

import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ShopDownPaymentTemplate } from '../../journal/cpa-templates/shop-down-payment.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';

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
}));

jest.mock('../../../utils/sequence.util', () => ({
  generateContractNumber: jest.fn().mockResolvedValue('CN-1'),
}));

// ─── fixtures ────────────────────────────────────────────────────────────────

const mockProduct = {
  id: 'prod-1',
  status: 'IN_STOCK',
  category: 'PHONE_NEW',
  imeiSerial: '123456789012345',
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
  let shopAccountResolver: jest.Mocked<Pick<ShopAccountResolver, 'resolveBranchCashAccount'>>;
  let queryMock: any;

  beforeEach(() => {
    // Inner tx object — the callback arg when prisma.$transaction(cb) is called
    tx = {
      creditCheck: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cc-1', status: 'APPROVED', contractId: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue(mockProduct),
        update: jest.fn().mockResolvedValue({ ...mockProduct, status: 'RESERVED' }),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue(mockCustomer),
      },
      contract: {
        create: jest.fn().mockResolvedValue(mockCreatedContract),
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
    };

    // Outer prisma — $transaction passes the callback + tx
    prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([]), // no active contracts
      },
      product: {
        findUnique: jest.fn().mockResolvedValue(mockProduct),
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

    shopAccountResolver = {
      resolveBranchCashAccount: jest.fn().mockResolvedValue('S11-1102'),
    };

    service = new ContractLifecycleService(
      prisma as any,
      queryMock as any,
      undefined, // warrantyService — optional
      undefined, // audit — optional
      shopDownPaymentTemplate as any,
      shopAccountResolver as any,
    );
  });

  // ─── Task-6 core assertions ─────────────────────────────────────────────────

  it('posts ShopDownPayment when downPayment > 0', async () => {
    await service.create({ ...baseDto, downPayment: 2000, branchId: 'br-1' } as any, 'sp-1');

    expect(shopAccountResolver.resolveBranchCashAccount).toHaveBeenCalledWith('br-1', tx);

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
});
