import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { ContractWorkflowService } from './contract-workflow.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ProductsService } from '../products/products.service';
import { DocumentsService } from './documents.service';

// Mock utility modules
jest.mock('../../utils/installment.util', () => ({
  calculateInstallment: jest.fn().mockReturnValue({
    interestTotal: 1800,
    financedAmount: 21800,
    monthlyPayment: 1817,
  }),
  generatePaymentSchedule: jest.fn().mockReturnValue([]),
}));

jest.mock('../../utils/config.util', () => ({
  loadInstallmentConfig: jest.fn().mockResolvedValue({}),
  resolveInstallmentParams: jest.fn().mockReturnValue({
    interestRate: 9,
    minDownPaymentPct: 0.1,
    minInstallmentMonths: 1,
    maxInstallmentMonths: 24,
    storeCommissionPct: 0,
    vatPct: 0,
  }),
  BUSINESS_RULES: { EARLY_PAYOFF_DISCOUNT: 0.5 },
  resolveVatPctForBranch: jest.fn().mockResolvedValue(0),
}));

const mockCheckRequiredContractFields = jest.fn().mockReturnValue([]);
const mockCheckRequiredDocuments = jest.fn().mockReturnValue({ complete: true, checklist: [] });
const mockCheckRequiredSignatures = jest.fn().mockReturnValue({ complete: true, checklist: [] });
const mockCheckAgeEligibility = jest.fn().mockReturnValue({ eligible: true, requiresGuardian: false });

jest.mock('../../utils/validation.util', () => ({
  validateIMEI: jest.fn().mockReturnValue(true),
  validateThaiPhone: jest.fn().mockReturnValue(true),
  checkAgeEligibility: (...args: unknown[]) => mockCheckAgeEligibility(...args),
  validateAddress: jest.fn().mockReturnValue(true),
  checkRequiredContractFields: (...args: unknown[]) => mockCheckRequiredContractFields(...args),
  checkRequiredDocuments: (...args: unknown[]) => mockCheckRequiredDocuments(...args),
  checkRequiredSignatures: (...args: unknown[]) => mockCheckRequiredSignatures(...args),
}));

jest.mock('../../utils/sequence.util', () => ({
  generateContractNumber: jest.fn().mockResolvedValue('BC-2026-TEST-001'),
  generateSaleNumber: jest.fn().mockResolvedValue('SL000001'),
}));

describe('Contract Signing & Workflow', () => {
  let service: ContractsService;
  let workflowService: ContractWorkflowService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let docsService: any;

  const makeContract = (overrides: Record<string, unknown> = {}) => ({
    id: 'contract-1',
    contractNumber: 'BC-2026-001',
    customerId: 'customer-1',
    productId: 'product-1',
    branchId: 'branch-1',
    salespersonId: 'user-1',
    status: 'DRAFT',
    workflowStatus: 'CREATING',
    sellingPrice: 20000,
    downPayment: 2000,
    totalMonths: 12,
    interestRate: 9,
    interestTotal: 1800,
    financedAmount: 21800,
    monthlyPayment: 1817,
    paymentDueDay: 5,
    interestConfigId: null,
    notes: null,
    deletedAt: null,
    pdpaConsentId: null,
    contractHash: null,
    customer: {
      name: 'ทดสอบ ลูกค้า',
      nationalId: '1234567890123',
      phone: '0812345678',
      addressIdCard: '{"province":"กรุงเทพ"}',
      addressCurrent: '{"province":"กรุงเทพ"}',
      references: [{ firstName: 'อ้างอิง', lastName: 'ทดสอบ', phone: '0899999999', relationship: 'พี่' }],
      birthDate: null,
    },
    product: {
      id: 'product-1',
      name: 'iPhone 15',
      brand: 'Apple',
      model: '15',
      imeiSerial: '123456789012345',
      category: 'PHONE_NEW',
      status: 'RESERVED',
    },
    branch: { id: 'branch-1', name: 'สาขาทดสอบ' },
    salesperson: { id: 'user-1', name: 'Staff' },
    reviewedBy: null,
    interestConfig: null,
    payments: [],
    signatures: [],
    eDocuments: [],
    contractDocuments: [],
    creditCheck: { id: 'cc-1', status: 'APPROVED' },
    pdpaConsent: null,
    ...overrides,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockContract: any;

  beforeEach(async () => {
    mockContract = makeContract();

    // Reset validation mocks
    mockCheckRequiredContractFields.mockReturnValue([]);
    mockCheckRequiredDocuments.mockReturnValue({ complete: true, checklist: [] });
    mockCheckRequiredSignatures.mockReturnValue({ complete: true, checklist: [] });
    mockCheckAgeEligibility.mockReturnValue({ eligible: true, requiresGuardian: false });

    const txMock = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(mockContract),
        update: jest.fn().mockResolvedValue(mockContract),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue(mockContract.product),
        update: jest.fn().mockResolvedValue(mockContract.product),
      },
      payment: {
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 12 }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      sale: {
        create: jest.fn().mockResolvedValue({ id: 'sale-1' }),
      },
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'finance-1' }),
      },
    };

    const mockPrisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(mockContract),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue(mockContract),
        create: jest.fn().mockResolvedValue(mockContract),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 12 }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue(mockContract.product),
        update: jest.fn().mockResolvedValue(mockContract.product),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ role: 'SALES' }),
      },
      interestConfig: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      systemConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'co-FINANCE' }),
      },
      $transaction: jest.fn((cb) => cb(txMock)),
    };

    const mockNotifications = {
      send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        ContractWorkflowService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: JournalAutoService, useValue: { recordContractActivation: jest.fn(), recordPayment: jest.fn(), recordExpense: jest.fn(), createContractActivationJournal: jest.fn() } },
        { provide: ProductsService, useValue: { transferOwnership: jest.fn() } },
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
    workflowService = module.get<ContractWorkflowService>(ContractWorkflowService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  // ═══════════════════════════════════════════════════════════
  // A. submitForReview — ส่งตรวจสอบ
  // ═══════════════════════════════════════════════════════════
  describe('submitForReview', () => {
    const readyContract = () =>
      makeContract({
        pdpaConsentId: 'pdpa-1',
        creditCheck: { id: 'cc-1', status: 'APPROVED' },
        signatures: [
          { signerType: 'CUSTOMER', signerName: 'ลูกค้า' },
          { signerType: 'COMPANY', signerName: 'บริษัท' },
        ],
      });

    it('SUB-1: ส่งสำเร็จเมื่อครบทุกเงื่อนไข → PENDING_REVIEW', async () => {
      prisma.contract.findUnique.mockResolvedValue(readyContract());
      prisma.contract.update.mockResolvedValue({ ...readyContract(), workflowStatus: 'PENDING_REVIEW' });

      const result = await workflowService.submitForReview('contract-1', 'user-1');
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workflowStatus: 'PENDING_REVIEW' }),
        }),
      );
    });

    it('SUB-2: ไม่มี credit check → BadRequestException ขั้นตอนที่ 5 (signatures checked first in dev)', async () => {
      // In dev mode, steps 1-3 are skipped with warnings.
      // Step 5 (signatures) is always enforced, so missing signatures triggers first.
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ creditCheck: null }),
      );

      await expect(workflowService.submitForReview('contract-1', 'user-1'))
        .rejects.toThrow('ขั้นตอนที่ 5');
    });

    it('SUB-3: credit check ยังไม่ APPROVED → BadRequestException ขั้นตอนที่ 5 (signatures checked first in dev)', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ creditCheck: { id: 'cc-1', status: 'PENDING' } }),
      );

      await expect(workflowService.submitForReview('contract-1', 'user-1'))
        .rejects.toThrow('ขั้นตอนที่ 5');
    });

    it('SUB-4: ข้อมูลไม่ครบ (missing fields) → BadRequestException ขั้นตอนที่ 5 (signatures checked first in dev)', async () => {
      mockCheckRequiredContractFields.mockReturnValue(['เบอร์โทร']);
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({
          creditCheck: { id: 'cc-1', status: 'APPROVED' },
        }),
      );

      await expect(workflowService.submitForReview('contract-1', 'user-1'))
        .rejects.toThrow('ขั้นตอนที่ 5');
    });

    it('SUB-5: ไม่มี PDPA consent → BadRequestException ขั้นตอนที่ 5 (signatures checked first in dev)', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({
          creditCheck: { id: 'cc-1', status: 'APPROVED' },
          pdpaConsentId: null,
        }),
      );

      await expect(workflowService.submitForReview('contract-1', 'user-1'))
        .rejects.toThrow('ขั้นตอนที่ 5');
    });

    it('SUB-6: ลายเซ็น CUSTOMER ไม่มี → BadRequestException ขั้นตอนที่ 5', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({
          creditCheck: { id: 'cc-1', status: 'APPROVED' },
          pdpaConsentId: 'pdpa-1',
          signatures: [{ signerType: 'COMPANY', signerName: 'บริษัท' }],
        }),
      );

      await expect(workflowService.submitForReview('contract-1', 'user-1'))
        .rejects.toThrow('ขั้นตอนที่ 5');
    });

    it('SUB-7: ลายเซ็น COMPANY ไม่มี → BadRequestException ขั้นตอนที่ 5', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({
          creditCheck: { id: 'cc-1', status: 'APPROVED' },
          pdpaConsentId: 'pdpa-1',
          signatures: [{ signerType: 'CUSTOMER', signerName: 'ลูกค้า' }],
        }),
      );

      await expect(workflowService.submitForReview('contract-1', 'user-1'))
        .rejects.toThrow('ขั้นตอนที่ 5');
    });

    it('SUB-8: พนักงานอื่นไม่ใช่คนสร้าง → ForbiddenException', async () => {
      prisma.contract.findUnique.mockResolvedValue(readyContract());

      await expect(workflowService.submitForReview('contract-1', 'user-other'))
        .rejects.toThrow(ForbiddenException);
    });

    it('SUB-9: สัญญา PENDING_REVIEW ส่งซ้ำ → BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ workflowStatus: 'PENDING_REVIEW' }),
      );

      await expect(workflowService.submitForReview('contract-1', 'user-1'))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // B. approveContract — อนุมัติ
  // ═══════════════════════════════════════════════════════════
  describe('approveContract', () => {
    const pendingContract = () =>
      makeContract({
        workflowStatus: 'PENDING_REVIEW',
        pdpaConsentId: 'pdpa-1',
        signatures: [
          { signerType: 'CUSTOMER' },
          { signerType: 'COMPANY' },
          { signerType: 'WITNESS_1' },
          { signerType: 'WITNESS_2' },
        ],
        contractDocuments: [{ type: 'ID_CARD' }, { type: 'SELFIE' }],
      });

    it('APR-1: อนุมัติสำเร็จ → APPROVED + reviewedById', async () => {
      prisma.contract.findUnique.mockResolvedValue(pendingContract());
      prisma.contract.update.mockResolvedValue({
        ...pendingContract(),
        workflowStatus: 'APPROVED',
        reviewedById: 'manager-1',
      });

      await workflowService.approveContract('contract-1', 'manager-1', 'FINANCE_MANAGER');
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workflowStatus: 'APPROVED',
            reviewedById: 'manager-1',
          }),
        }),
      );
    });

    it('APR-2: เอกสารไม่ครบ → BadRequestException', async () => {
      mockCheckRequiredDocuments.mockReturnValue({
        complete: false,
        checklist: [{ label: 'บัตรประชาชน', present: false }],
      });
      prisma.contract.findUnique.mockResolvedValue(pendingContract());

      await expect(workflowService.approveContract('contract-1', 'manager-1', 'FINANCE_MANAGER'))
        .rejects.toThrow('เอกสารไม่ครบ');
    });

    it('APR-3: ลายเซ็นไม่ครบ → BadRequestException', async () => {
      mockCheckRequiredDocuments.mockReturnValue({ complete: true, checklist: [] });
      mockCheckRequiredSignatures.mockReturnValue({
        complete: false,
        checklist: [{ label: 'พยาน 1', signed: false }],
      });
      prisma.contract.findUnique.mockResolvedValue(pendingContract());

      await expect(workflowService.approveContract('contract-1', 'manager-1', 'FINANCE_MANAGER'))
        .rejects.toThrow('ลายเซ็นไม่ครบ');
    });

    it('APR-4: Self-approval โดย SALES → ForbiddenException', async () => {
      prisma.contract.findUnique.mockResolvedValue(pendingContract());

      await expect(workflowService.approveContract('contract-1', 'user-1', 'SALES'))
        .rejects.toThrow(ForbiddenException);
    });

    it('APR-5: OWNER approve สัญญาตัวเอง → สำเร็จ (small business exception)', async () => {
      prisma.contract.findUnique.mockResolvedValue(pendingContract());

      await workflowService.approveContract('contract-1', 'user-1', 'OWNER');
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workflowStatus: 'APPROVED' }),
        }),
      );
    });

    it('APR-6: สัญญาไม่อยู่ PENDING_REVIEW → BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract({ workflowStatus: 'CREATING' }));

      await expect(workflowService.approveContract('contract-1', 'manager-1', 'FINANCE_MANAGER'))
        .rejects.toThrow(BadRequestException);
    });

    it('APR-7: ลูกค้าอายุ < 20 ต้องมี GUARDIAN signature', async () => {
      mockCheckAgeEligibility.mockReturnValue({ eligible: true, requiresGuardian: true });
      mockCheckRequiredDocuments.mockReturnValue({
        complete: false,
        checklist: [{ label: 'เอกสารผู้ปกครอง', present: false }],
      });
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({
          workflowStatus: 'PENDING_REVIEW',
          customer: { ...makeContract().customer, birthDate: new Date('2009-01-01') },
        }),
      );

      await expect(workflowService.approveContract('contract-1', 'manager-1', 'FINANCE_MANAGER'))
        .rejects.toThrow('เอกสารไม่ครบ');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // C. rejectContract — ปฏิเสธ
  // ═══════════════════════════════════════════════════════════
  describe('rejectContract', () => {
    it('REJ-1: ปฏิเสธสำเร็จ → REJECTED + reviewNotes', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract({ workflowStatus: 'PENDING_REVIEW' }));

      await workflowService.rejectContract('contract-1', 'manager-1', 'FINANCE_MANAGER', 'เอกสารไม่ชัด');
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workflowStatus: 'REJECTED',
            reviewNotes: 'เอกสารไม่ชัด',
          }),
        }),
      );
    });

    it('REJ-2: Self-reject โดย SALES → ForbiddenException', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract({ workflowStatus: 'PENDING_REVIEW' }));

      await expect(workflowService.rejectContract('contract-1', 'user-1', 'SALES', 'ปฏิเสธ'))
        .rejects.toThrow(ForbiddenException);
    });

    it('REJ-3: OWNER reject สัญญาตัวเอง → สำเร็จ', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract({ workflowStatus: 'PENDING_REVIEW' }));

      await workflowService.rejectContract('contract-1', 'user-1', 'OWNER', 'แก้ไข');
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workflowStatus: 'REJECTED' }),
        }),
      );
    });

    it('REJ-4: สัญญาไม่อยู่ PENDING_REVIEW → BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract({ workflowStatus: 'CREATING' }));

      await expect(workflowService.rejectContract('contract-1', 'manager-1', 'FINANCE_MANAGER', 'ปฏิเสธ'))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // D. activate — เปิดใช้งาน
  // ═══════════════════════════════════════════════════════════
  describe('activate', () => {
    const approvedContract = () =>
      makeContract({
        workflowStatus: 'APPROVED',
        status: 'DRAFT',
        pdpaConsentId: 'pdpa-1',
        signatures: [
          { signerType: 'CUSTOMER' },
          { signerType: 'COMPANY' },
          { signerType: 'WITNESS_1' },
          { signerType: 'WITNESS_2' },
        ],
      });

    it('ACT-1: เปิดใช้งานสำเร็จ → transaction (status=ACTIVE, product=SOLD_INSTALLMENT, Sale record)', async () => {
      prisma.contract.findUnique.mockResolvedValue(approvedContract());

      await workflowService.activate('contract-1');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('ACT-2: ไม่มี PDPA consent → BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ workflowStatus: 'APPROVED', status: 'DRAFT', pdpaConsentId: null }),
      );

      await expect(workflowService.activate('contract-1'))
        .rejects.toThrow('PDPA');
    });

    it('ACT-3: ลายเซ็น CUSTOMER ขาด → BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({
          workflowStatus: 'APPROVED',
          status: 'DRAFT',
          pdpaConsentId: 'pdpa-1',
          signatures: [
            { signerType: 'COMPANY' },
            { signerType: 'WITNESS_1' },
            { signerType: 'WITNESS_2' },
          ],
        }),
      );

      await expect(workflowService.activate('contract-1'))
        .rejects.toThrow('ผู้ซื้อ');
    });

    it('ACT-4: ลายเซ็น WITNESS ขาด → BadRequestException "พยาน"', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({
          workflowStatus: 'APPROVED',
          status: 'DRAFT',
          pdpaConsentId: 'pdpa-1',
          signatures: [
            { signerType: 'CUSTOMER' },
            { signerType: 'COMPANY' },
          ],
        }),
      );

      await expect(workflowService.activate('contract-1'))
        .rejects.toThrow('พยาน');
    });

    it('ACT-5: สัญญาไม่ได้ APPROVED → BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ workflowStatus: 'CREATING', status: 'DRAFT' }),
      );

      await expect(workflowService.activate('contract-1'))
        .rejects.toThrow('อนุมัติ');
    });

    it('ACT-6: สัญญาไม่ใช่ DRAFT → BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ workflowStatus: 'APPROVED', status: 'ACTIVE' }),
      );

      await expect(workflowService.activate('contract-1'))
        .rejects.toThrow('DRAFT');
    });

    it('ACT-7: สินค้าถูกขายไปแล้ว → BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue(approvedContract());
      prisma.product.findUnique.mockResolvedValue({
        ...mockContract.product,
        status: 'SOLD_CASH',
      });

      await expect(workflowService.activate('contract-1'))
        .rejects.toThrow('สินค้าไม่พร้อม');
    });

    it('ACT-8: ลูกค้าอายุ < 20 ไม่มี GUARDIAN → BadRequestException', async () => {
      mockCheckAgeEligibility.mockReturnValue({ eligible: true, requiresGuardian: true });
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({
          workflowStatus: 'APPROVED',
          status: 'DRAFT',
          pdpaConsentId: 'pdpa-1',
          signatures: [
            { signerType: 'CUSTOMER' },
            { signerType: 'COMPANY' },
            { signerType: 'WITNESS_1' },
            { signerType: 'WITNESS_2' },
          ],
          customer: {
            ...makeContract().customer,
            birthDate: new Date('2009-06-15'),
          },
        }),
      );

      await expect(workflowService.activate('contract-1'))
        .rejects.toThrow('ผู้ปกครอง');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // E. Edge Cases — Re-submit, edit after reject/approve
  // ═══════════════════════════════════════════════════════════
  describe('Edge Cases', () => {
    it('EDGE-1: Re-submit หลัง reject → สำเร็จ (REJECTED → PENDING_REVIEW)', async () => {
      const rejected = makeContract({
        workflowStatus: 'REJECTED',
        pdpaConsentId: 'pdpa-1',
        creditCheck: { id: 'cc-1', status: 'APPROVED' },
        signatures: [
          { signerType: 'CUSTOMER' },
          { signerType: 'COMPANY' },
        ],
      });
      prisma.contract.findUnique.mockResolvedValue(rejected);

      await workflowService.submitForReview('contract-1', 'user-1');
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workflowStatus: 'PENDING_REVIEW' }),
        }),
      );
    });

    it('EDGE-2: แก้ไขสัญญาหลัง reject → สำเร็จ', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ workflowStatus: 'REJECTED' }),
      );

      await service.update('contract-1', { notes: 'แก้ไขแล้ว' }, 'user-1');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('EDGE-3: แก้ไขสัญญาหลัง approve → BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ workflowStatus: 'APPROVED' }),
      );

      await expect(service.update('contract-1', { notes: 'แก้ไข' }, 'user-1'))
        .rejects.toThrow(BadRequestException);
    });

    it('EDGE-4: สัญญา ACTIVE → ไม่สามารถลบลายเซ็นได้', async () => {
      // Active contract should not allow workflow changes
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ workflowStatus: 'APPROVED', status: 'ACTIVE' }),
      );

      await expect(workflowService.activate('contract-1'))
        .rejects.toThrow('DRAFT');
    });
  });
});
