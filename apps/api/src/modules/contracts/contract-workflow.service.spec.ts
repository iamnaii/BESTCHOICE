import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ContractWorkflowService } from './contract-workflow.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ProductsService } from '../products/products.service';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { ContractExchangeService } from '../contract-exchange/contract-exchange.service';
import { TestModeService } from '../test-mode/test-mode.service';
import { ShopInventoryTransferTemplate } from '../journal/cpa-templates/shop-inventory-transfer.template';
import { ShopDownPaymentTemplate } from '../journal/cpa-templates/shop-down-payment.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { BadRequestException } from '@nestjs/common';

/**
 * ContractWorkflowService unit tests.
 *
 * Initial coverage focuses on the activate() path and the F-1-002 / F-2-003
 * audit finding: a try/catch around createContractActivationJournal used to
 * swallow JE failures, leaving the contract ACTIVE without any ledger entry.
 * The fix removes that try/catch so the entire $transaction rolls back when
 * the JE fails — atomic with contract activation.
 */

jest.mock('../../utils/sequence.util', () => ({
  generateSaleNumber: jest.fn().mockResolvedValue('SL000001'),
}));

jest.mock('../../utils/validation.util', () => ({
  checkAgeEligibility: jest.fn().mockReturnValue({ eligible: true, requiresGuardian: false }),
  checkRequiredContractFields: jest.fn().mockReturnValue([]),
  checkRequiredDocuments: jest.fn().mockReturnValue({ complete: true, checklist: [] }),
  checkRequiredSignatures: jest.fn().mockReturnValue({ complete: true, checklist: [] }),
}));

jest.mock('../../utils/thai-date.util', () => ({
  formatDateShort: jest.fn().mockReturnValue('1 พ.ค. 2026'),
}));

describe('ContractWorkflowService', () => {
  let service: ContractWorkflowService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let journalAutoMock: { createContractActivationJournal: jest.Mock };
  let contractActivationTemplateMock: { execute: jest.Mock };
  let productsMock: { transferOwnership: jest.Mock };
  let notificationsMock: { send: jest.Mock };
  let exchangeServiceMock: { finalizeAfterActivation: jest.Mock };
  let testModeMock: { isEnabled: jest.Mock };
  // Task 5: SHOP JE wiring mocks
  let shopInventoryTransferTemplate: { execute: jest.Mock };
  let shopDownPaymentTemplate: { execute: jest.Mock };
  let shopAccountResolver: { resolveProductAccounts: jest.Mock; resolveBranchCashAccount: jest.Mock };

  const mockProduct = {
    id: 'product-1',
    name: 'iPhone 15',
    brand: 'Apple',
    model: 'iPhone 15',
    category: 'SMARTPHONE',
    status: 'RESERVED',
    imeiSerial: '123456789012345',
    costPrice: new Prisma.Decimal(20000),
    deletedAt: null,
    prices: [],
  };

  const mockCustomer = {
    id: 'customer-1',
    name: 'สมชาย ใจดี',
    phone: '0891234567',
    nationalId: '1234567890123',
    lineIdFinance: null,
    lineIdShop: null,
    birthDate: null,
    deletedAt: null,
    references: [],
  };

  // Approved DRAFT contract with full signature set + PDPA consent.
  const mockContract = {
    id: 'contract-1',
    contractNumber: 'BC-2026-001',
    customerId: 'customer-1',
    productId: 'product-1',
    branchId: 'branch-1',
    salespersonId: 'user-1',
    status: 'DRAFT',
    workflowStatus: 'APPROVED',
    sellingPrice: new Prisma.Decimal(20000),
    downPayment: new Prisma.Decimal(3000),
    totalMonths: 12,
    interestRate: new Prisma.Decimal(0.08),
    interestTotal: new Prisma.Decimal(1728),
    financedAmount: new Prisma.Decimal(21754.08),
    storeCommission: new Prisma.Decimal(1800),
    vatAmount: new Prisma.Decimal(226.08),
    vatPct: new Prisma.Decimal(0.07),
    monthlyPayment: new Prisma.Decimal(1813),
    paymentDueDay: 5,
    notes: null,
    deletedAt: null,
    pdpaConsentId: 'pdpa-1',
    contractHash: null, // legacy contract — verifyContractHash short-circuits
    customer: mockCustomer,
    product: { ...mockProduct, prices: [] },
    branch: { id: 'branch-1', name: 'สาขาลาดพร้าว' },
    salesperson: { id: 'user-1', name: 'พนักงาน 1' },
    reviewedBy: null,
    interestConfig: null,
    payments: [],
    signatures: [
      { id: 's1', signerType: 'CUSTOMER', signedAt: new Date(), staffUserId: null, deletedAt: null },
      { id: 's2', signerType: 'COMPANY', signedAt: new Date(), staffUserId: 'user-1', deletedAt: null },
      { id: 's3', signerType: 'WITNESS_1', signedAt: new Date(), staffUserId: 'user-1', deletedAt: null },
      { id: 's4', signerType: 'WITNESS_2', signedAt: new Date(), staffUserId: 'user-1', deletedAt: null },
    ],
    eDocuments: [],
    contractDocuments: [],
    creditCheck: { id: 'cc-1', status: 'APPROVED' },
  };

  // Tx mock — runs the callback with prisma itself.
  // Critically: if the callback throws, $transaction re-throws (real Prisma
  // behavior), so the test can assert that errors propagate out of activate().
  const makeTxMock = () =>
    jest.fn().mockImplementation(async (fnOrArray: unknown) => {
      if (typeof fnOrArray === 'function') {
        return (fnOrArray as (tx: unknown) => Promise<unknown>)(prisma);
      }
      return Promise.all(fnOrArray as Promise<unknown>[]);
    });

  beforeEach(async () => {
    prisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(mockContract),
        findUniqueOrThrow: jest.fn().mockResolvedValue(mockContract),
        update: jest.fn().mockResolvedValue({ ...mockContract, status: 'ACTIVE' }),
      },
      installmentSchedule: {
        // generateInstallmentSchedules now runs inside the activation tx. These
        // activate() tests don't exercise schedule math (covered by
        // contract-workflow.schedule.spec.ts) — report existing rows so it takes
        // the idempotent skip path.
        count: jest.fn().mockResolvedValue(1),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue(mockProduct),
        update: jest.fn().mockResolvedValue({ ...mockProduct, status: 'SOLD_INSTALLMENT' }),
      },
      sale: {
        create: jest.fn().mockResolvedValue({ id: 'sale-1' }),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      journalEntry: {
        // Default: a prior down JE exists → catch-up skipped in existing tests.
        findFirst: jest.fn().mockResolvedValue({ id: 'down-je-1' }),
      },
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'finance-co-1' }),
      },
      $transaction: makeTxMock(),
    };

    journalAutoMock = {
      createContractActivationJournal: jest.fn().mockResolvedValue(undefined),
    };
    productsMock = {
      transferOwnership: jest.fn().mockResolvedValue(undefined),
    };
    notificationsMock = {
      send: jest.fn().mockResolvedValue(undefined),
    };
    exchangeServiceMock = {
      finalizeAfterActivation: jest.fn().mockResolvedValue({
        je1aId: 'je-a1', je2Id: 'je-a2', je3Id: 'je-a3', je4Id: 'je-a4',
      }),
    };
    // Default: test-mode OFF.
    testModeMock = { isEnabled: jest.fn().mockResolvedValue(false) };

    // Task 5: SHOP wiring mocks
    shopInventoryTransferTemplate = {
      execute: jest.fn().mockResolvedValue({
        batchId: 'b', cogsEntryNo: 'c', cogsJournalEntryId: 'cj',
        revenueEntryNo: 'r', revenueJournalEntryId: 'rj',
      }),
    };
    shopDownPaymentTemplate = { execute: jest.fn().mockResolvedValue({ entryNo: 'dp', journalEntryId: 'dpj' }) };
    shopAccountResolver = {
      resolveProductAccounts: jest.fn().mockReturnValue({
        inventoryAccountCode: 'S11-2001',
        cogsAccountCode: 'S50-1101',
        revenueAccountCode: 'S41-1101',
      }),
      resolveBranchCashAccount: jest.fn().mockResolvedValue('S11-1102'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractWorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsMock },
        { provide: JournalAutoService, useValue: journalAutoMock },
        { provide: ProductsService, useValue: productsMock },
        { provide: ContractActivation1ATemplate, useValue: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK' }) } },
        { provide: ContractExchangeService, useValue: exchangeServiceMock },
        { provide: TestModeService, useValue: testModeMock },
        { provide: ShopInventoryTransferTemplate, useValue: shopInventoryTransferTemplate },
        { provide: ShopDownPaymentTemplate, useValue: shopDownPaymentTemplate },
        { provide: ShopAccountResolver, useValue: shopAccountResolver },
      ],
    }).compile();

    contractActivationTemplateMock = module.get(ContractActivation1ATemplate);
    service = module.get<ContractWorkflowService>(ContractWorkflowService);
  });

  describe('activate', () => {
    it('activates a fully-approved DRAFT contract and writes the activation JE', async () => {
      await service.activate('contract-1');

      // Contract status flipped to ACTIVE
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'contract-1' },
          data: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
      // Wave 1 / Task 4: JE posted via ContractActivation1ATemplate
      // INSIDE the outer $transaction (tx is passed as 2nd arg).
      expect(contractActivationTemplateMock.execute).toHaveBeenCalledTimes(1);
      expect(contractActivationTemplateMock.execute).toHaveBeenCalledWith(
        'contract-1',
        expect.anything(), // tx client
      );
    });

    it('passes contractId + tx to ContractActivation1ATemplate on activation', async () => {
      // Wave 1 / Task 4: template now runs inside outer $transaction so it
      // receives tx as its 2nd argument. If 1A throws, the whole activation
      // (contract status + product ownership transfer + sale row) rolls back.
      await service.activate('contract-1');

      expect(contractActivationTemplateMock.execute).toHaveBeenCalledWith(
        'contract-1',
        expect.anything(),
      );
    });

    it('rolls back contract activation when 1A JE throws (Wave 1 P0 W-1 atomicity)', async () => {
      // Wave 1 / Task 4: 1A is now inside outer $transaction. Mocked tx
      // re-throws callback errors so service.activate() must reject.
      contractActivationTemplateMock.execute.mockRejectedValueOnce(
        new Error('1A fail'),
      );

      await expect(service.activate('contract-1')).rejects.toThrow('1A fail');

      // The 1A template was still called once before rejecting
      expect(contractActivationTemplateMock.execute).toHaveBeenCalledTimes(1);
      // Atomicity assertion: in real Prisma the $transaction would roll back
      // every prior write. We can't assert against a real DB here, but we do
      // confirm the error escapes activate() rather than being swallowed.
    });

    // SP2 sign-then-activate: when a contract was born from an exchange request,
    // activate() must call ContractExchangeService.finalizeAfterActivation()
    // INSTEAD OF the standard ContractActivation1ATemplate (and skip Sale row).
    describe('exchange contract branch (SP2 sign-then-activate)', () => {
      const exchangeContract = {
        ...mockContract,
        id: 'contract-exch',
        contractNumber: 'EXCH-20260524-0001',
        exchangedFromContractId: 'contract-original',
      };

      beforeEach(() => {
        prisma.contract.findUnique.mockResolvedValue(exchangeContract);
      });

      it('calls finalizeAfterActivation with the contract identity + plan numbers', async () => {
        await service.activate('contract-exch');

        expect(exchangeServiceMock.finalizeAfterActivation).toHaveBeenCalledTimes(1);
        const [arg, tx] = exchangeServiceMock.finalizeAfterActivation.mock.calls[0];
        expect(arg).toMatchObject({
          id: 'contract-exch',
          productId: 'product-1',
          exchangedFromContractId: 'contract-original',
        });
        // Plan numbers are passed through so the finalize step can build A.3
        // without re-querying the contract row.
        expect(arg.financedAmount).toBeDefined();
        expect(arg.storeCommission).toBeDefined();
        // tx is the prisma transaction client
        expect(tx).toBeDefined();
      });

      it('does NOT call the standard ContractActivation1ATemplate for exchange contracts', async () => {
        await service.activate('contract-exch');
        expect(contractActivationTemplateMock.execute).not.toHaveBeenCalled();
      });

      it('does NOT create a Sale row for exchange contracts', async () => {
        await service.activate('contract-exch');
        expect(prisma.sale.create).not.toHaveBeenCalled();
      });

      it('still flips the new contract to ACTIVE + transfers product ownership to FINANCE', async () => {
        await service.activate('contract-exch');
        expect(prisma.contract.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'contract-exch' },
            data: expect.objectContaining({ status: 'ACTIVE' }),
          }),
        );
        expect(prisma.product.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'product-1' },
            data: expect.objectContaining({ status: 'SOLD_INSTALLMENT' }),
          }),
        );
        expect(productsMock.transferOwnership).toHaveBeenCalledWith(
          'product-1',
          'finance-co-1',
          expect.anything(),
        );
      });

      it('rolls back activation when finalizeAfterActivation throws', async () => {
        exchangeServiceMock.finalizeAfterActivation.mockRejectedValueOnce(
          new Error('finalize fail'),
        );
        await expect(service.activate('contract-exch')).rejects.toThrow('finalize fail');
        // standard 1A path was not used here
        expect(contractActivationTemplateMock.execute).not.toHaveBeenCalled();
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Task 5: SHOP inventory-transfer JE wiring (standard branch only)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('SHOP inventory-transfer wiring (Task 5 / D-1)', () => {
    // Contract with the exact values from the brief:
    // sellingPrice 20000, downPayment 2000, financedAmount 18000, storeCommission 1500
    // product category PHONE_NEW, costPrice 15000
    const shopProduct = {
      id: 'product-shop',
      name: 'Samsung A55',
      brand: 'Samsung',
      model: 'A55',
      category: 'PHONE_NEW',
      status: 'RESERVED',
      imeiSerial: '111222333444555',
      costPrice: new Prisma.Decimal(15000),
      deletedAt: null,
      prices: [],
    };
    const shopContract = {
      id: 'c-1',
      contractNumber: 'BC-2026-SHOP',
      customerId: 'customer-1',
      productId: 'product-shop',
      branchId: 'branch-1',
      salespersonId: 'user-1',
      status: 'DRAFT',
      workflowStatus: 'APPROVED',
      sellingPrice: new Prisma.Decimal(20000),
      downPayment: new Prisma.Decimal(2000),
      totalMonths: 12,
      interestRate: new Prisma.Decimal(0.08),
      interestTotal: new Prisma.Decimal(1440),
      financedAmount: new Prisma.Decimal(18000),
      storeCommission: new Prisma.Decimal(1500),
      vatAmount: new Prisma.Decimal(0),
      vatPct: new Prisma.Decimal(0.07),
      monthlyPayment: new Prisma.Decimal(1620),
      paymentDueDay: 5,
      notes: null,
      deletedAt: null,
      pdpaConsentId: 'pdpa-shop-1',
      contractHash: null,
      customer: mockCustomer,
      product: { ...shopProduct, prices: [] },
      branch: { id: 'branch-1', name: 'สาขาลาดพร้าว' },
      salesperson: { id: 'user-1', name: 'พนักงาน 1' },
      reviewedBy: null,
      interestConfig: null,
      payments: [],
      signatures: [
        { id: 's1', signerType: 'CUSTOMER', signedAt: new Date(), staffUserId: null, deletedAt: null },
        { id: 's2', signerType: 'COMPANY', signedAt: new Date(), staffUserId: 'user-1', deletedAt: null },
        { id: 's3', signerType: 'WITNESS_1', signedAt: new Date(), staffUserId: 'user-1', deletedAt: null },
        { id: 's4', signerType: 'WITNESS_2', signedAt: new Date(), staffUserId: 'user-1', deletedAt: null },
      ],
      eDocuments: [],
      contractDocuments: [],
      creditCheck: { id: 'cc-shop', status: 'APPROVED' },
    };

    beforeEach(() => {
      prisma.contract.findUnique.mockResolvedValue(shopContract);
      prisma.product.findUnique.mockResolvedValue(shopProduct);
      // Default: down JE already exists → catch-up skipped.
      prisma.journalEntry.findFirst.mockResolvedValue({ id: 'down-je-1' });
    });

    it('posts ShopInventoryTransfer with salePrice = down + financed at activation', async () => {
      await service.activate('c-1');
      const input = shopInventoryTransferTemplate.execute.mock.calls[0][0];
      // D-8: salePrice must be down + financed (2000 + 18000 = 20000), NOT raw sellingPrice
      expect(input.salePrice.toString()).toBe('20000');
      expect(input.downAmount.toString()).toBe('2000');
      expect(input.financedAmount.toString()).toBe('18000');
      expect(input.commission.toString()).toBe('1500');
      expect(input.costPrice.toString()).toBe('15000');
      expect(input).toMatchObject({
        inventoryAccountCode: 'S11-2001',
        cogsAccountCode: 'S50-1101',
        revenueAccountCode: 'S41-1101',
        idempotencyKey: 'shop-inventory-transfer:c-1',
      });
      // Called with the outer tx as second argument (atomicity guarantee)
      expect(shopInventoryTransferTemplate.execute.mock.calls[0][1]).toBeDefined();
    });

    it('posts a catch-up ShopDownPayment for in-flight contract with down but no down JE', async () => {
      // No prior down JE → pre-Task-6 in-flight contract → catch-up fires
      prisma.journalEntry.findFirst.mockResolvedValue(null);
      shopAccountResolver.resolveBranchCashAccount.mockResolvedValue('S11-1102');
      await service.activate('c-1');
      expect(shopDownPaymentTemplate.execute).toHaveBeenCalledTimes(1);
      expect(shopDownPaymentTemplate.execute.mock.calls[0][0]).toMatchObject({
        idempotencyKey: 'shop-down-payment:c-1',
        cashAccountCode: 'S11-1102',
      });
    });

    it('skips the catch-up when a down JE already exists (post-Task-6 contract)', async () => {
      prisma.journalEntry.findFirst.mockResolvedValue({ id: 'down-je-1' });
      await service.activate('c-1');
      expect(shopDownPaymentTemplate.execute).not.toHaveBeenCalled();
    });

    it('does NOT post SHOP JEs for exchange contracts (exchange branch only)', async () => {
      const exchangeShopContract = {
        ...shopContract,
        id: 'c-exch',
        exchangedFromContractId: 'c-original',
      };
      prisma.contract.findUnique.mockResolvedValue(exchangeShopContract);
      await service.activate('c-exch');
      expect(shopInventoryTransferTemplate.execute).not.toHaveBeenCalled();
      expect(shopDownPaymentTemplate.execute).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // submitForReview — Step 1 credit gate (test-mode aware)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('submitForReview — credit gate (Step 1)', () => {
    const submittable = {
      ...mockContract,
      workflowStatus: 'CREATING',
      creditCheck: null, // no approved credit check → gate would normally fire
    };

    const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    });

    it('throws the credit error in production when test-mode is OFF', async () => {
      process.env.NODE_ENV = 'production';
      testModeMock.isEnabled.mockResolvedValue(false);
      prisma.contract.findUnique.mockResolvedValue(submittable);

      await expect(service.submitForReview('contract-1', 'user-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('skips the credit error in production when test-mode is ON', async () => {
      process.env.NODE_ENV = 'production';
      testModeMock.isEnabled.mockResolvedValue(true);
      prisma.contract.findUnique.mockResolvedValue(submittable);

      // Should NOT throw the credit-gate error and should proceed to update.
      await service.submitForReview('contract-1', 'user-1');
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'contract-1' },
          data: expect.objectContaining({ workflowStatus: 'PENDING_REVIEW' }),
        }),
      );
    });
  });
});
