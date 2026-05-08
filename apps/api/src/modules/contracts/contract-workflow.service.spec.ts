import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ContractWorkflowService } from './contract-workflow.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ProductsService } from '../products/products.service';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';

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
        update: jest.fn().mockResolvedValue({ ...mockContract, status: 'ACTIVE' }),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractWorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsMock },
        { provide: JournalAutoService, useValue: journalAutoMock },
        { provide: ProductsService, useValue: productsMock },
        { provide: ContractActivation1ATemplate, useValue: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK' }) } },
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
  });
});
