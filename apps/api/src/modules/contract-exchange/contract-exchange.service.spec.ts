import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContractExchangeService } from './contract-exchange.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ExchangeNewContract1ATemplate } from '../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeClearVendor21_1106Template } from '../journal/cpa-templates/exchange-clear-vendor-21-1106.template';
import { ShopExchangeReturnTemplate } from '../journal/cpa-templates/shop-exchange-return.template';
import { CompanyResolverService } from '../journal/company-resolver.service';

// Default user shape used by submit() tests after Fix 2 (issue #1086 item 2).
// SALES_BR1 matches the mock contract's branchId ('br-1') so legacy tests
// pass the in-service branch check. Specific tests override as needed.
const SALES_BR1 = { id: 'u-1', role: 'SALES', branchId: 'br-1' };
const SALES_BR2 = { id: 'u-2', role: 'SALES', branchId: 'br-2' };
const OWNER_USER = { id: 'owner-1', role: 'OWNER', branchId: null };

describe('ContractExchangeService.submit', () => {
  let service: ContractExchangeService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      contract: { findUnique: jest.fn() },
      product: { findUnique: jest.fn() },
      contractExchangeRequest: { create: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ContractExchangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { write: jest.fn() } },
        { provide: ExchangeNewContract1ATemplate, useValue: {} },
        { provide: ExchangeCloseOld21_1106Template, useValue: {} },
        { provide: ExchangeClearVendor21_1106Template, useValue: {} },
        { provide: ShopExchangeReturnTemplate, useValue: {} },
        { provide: CompanyResolverService, useValue: { getShopCompanyId: jest.fn() } },
      ],
    }).compile();
    service = mod.get(ContractExchangeService);
  });

  it('NotFoundException when old contract does not exist', async () => {
    prisma.contract.findUnique.mockResolvedValue(null);
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR1),
    ).rejects.toThrow(NotFoundException);
  });

  it('BadRequestException when old contract is not ACTIVE', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', branchId: 'br-1', status: 'CANCELED', deletedAt: null });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR1),
    ).rejects.toThrow(BadRequestException);
  });

  it('BadRequestException when new product is not IN_STOCK', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', branchId: 'br-1', status: 'ACTIVE', productId: 'op', deletedAt: null });
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', brand: 'A', model: 'X', storage: '256', sellingPrice: '28000', status: 'SOLD_INSTALLMENT' })
      .mockResolvedValueOnce({ id: 'np', brand: 'A', model: 'X', storage: '256', sellingPrice: '28000', status: 'SOLD_INSTALLMENT' });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR1),
    ).rejects.toThrow(/IN_STOCK/);
  });

  it('BadRequestException when brand differs', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', branchId: 'br-1', status: 'ACTIVE', productId: 'op', deletedAt: null });
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: '28000' })
      .mockResolvedValueOnce({ id: 'np', brand: 'Samsung', model: 'iPhone 15', storage: '256', sellingPrice: '28000', status: 'IN_STOCK' });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR1),
    ).rejects.toThrow(/รุ่นเดียวกัน/);
  });

  it('BadRequestException when sellingPrice differs', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', branchId: 'br-1', status: 'ACTIVE', productId: 'op', deletedAt: null });
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: '28000' })
      .mockResolvedValueOnce({ id: 'np', brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: '30000', status: 'IN_STOCK' });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR1),
    ).rejects.toThrow(/ราคา/);
  });

  // Issue #1086 item 1 — silent same-price bypass when prices are null
  it('BadRequestException when new product has BOTH sellingPrice and installmentPrice null (no silent same-price bypass)', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', branchId: 'br-1', status: 'ACTIVE', productId: 'op', deletedAt: null });
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: '28000', installmentPrice: '28000' })
      .mockResolvedValueOnce({ id: 'np', brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: null, installmentPrice: null, status: 'IN_STOCK' });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR1),
    ).rejects.toThrow(/ราคาเครื่องไม่ถูกตั้งค่า/);
  });

  it('BadRequestException when OLD product has BOTH sellingPrice and installmentPrice null', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', branchId: 'br-1', status: 'ACTIVE', productId: 'op', deletedAt: null });
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: null, installmentPrice: null })
      .mockResolvedValueOnce({ id: 'np', brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: '28000', installmentPrice: '28000', status: 'IN_STOCK' });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR1),
    ).rejects.toThrow(/ราคาเครื่องไม่ถูกตั้งค่า/);
  });

  // Issue #1086 item 2 — in-service branch check
  it('ForbiddenException when SALES user from another branch tries to submit', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', branchId: 'br-1', status: 'ACTIVE', productId: 'op', deletedAt: null });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, SALES_BR2),
    ).rejects.toThrow(ForbiddenException);
  });

  it('OWNER (cross-branch role) can submit for a contract in any branch', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', branchId: 'br-1', status: 'ACTIVE', productId: 'op', deletedAt: null });
    const same = { brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: '28000' };
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', ...same })
      .mockResolvedValueOnce({ id: 'np', ...same, status: 'IN_STOCK' });
    prisma.contractExchangeRequest.create.mockResolvedValue({ id: 'req-owner', status: 'PENDING' });

    const result = await service.submit(
      { oldContractId: 'old', oldProductId: 'op', newProductId: 'np' },
      OWNER_USER,
    );
    expect(result.id).toBe('req-owner');
  });

  it('creates PENDING request when all checks pass', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', branchId: 'br-1', status: 'ACTIVE', productId: 'op', deletedAt: null });
    const same = { brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: '28000' };
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', ...same })
      .mockResolvedValueOnce({ id: 'np', ...same, status: 'IN_STOCK' });
    prisma.contractExchangeRequest.create.mockResolvedValue({ id: 'req-1', status: 'PENDING' });

    const result = await service.submit(
      { oldContractId: 'old', oldProductId: 'op', newProductId: 'np', conditionNote: 'good' },
      SALES_BR1,
    );

    expect(result.id).toBe('req-1');
    expect(prisma.contractExchangeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        oldContractId: 'old',
        oldProductId: 'op',
        newProductId: 'np',
        status: 'PENDING',
        requestedById: 'u-1',
        conditionNote: 'good',
      }),
    }));
  });
});

// ============================================================================
// approve() — SP2 v2 sign-then-activate flow
// approve() ONLY creates a DRAFT contract + reserves the new product + flips
// the request to APPROVED. It does NOT post JEs or flip the old contract /
// product. The JE chain + old-side flips are tested under finalizeAfterActivation
// below.
// ============================================================================
describe('ContractExchangeService.approve (sign-then-activate)', () => {
  let service: ContractExchangeService;
  let prisma: any;
  let templates: any;
  let audit: any;
  let companyResolver: any;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      contractExchangeRequest: {
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      contract: {
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null), // for nextExchangeContractNumber
        create: jest.fn(),
        update: jest.fn(),
      },
      payment: { count: jest.fn() },
      product: {
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn(),
      },
      journalLine: { findMany: jest.fn().mockResolvedValue([]) },
    };
    templates = {
      t1a: { execute: jest.fn() },
      t2: { execute: jest.fn() },
      t3: { execute: jest.fn() },
      t4: { execute: jest.fn() },
    };
    audit = { log: jest.fn() };
    companyResolver = { getShopCompanyId: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        ContractExchangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: ExchangeNewContract1ATemplate, useValue: templates.t1a },
        { provide: ExchangeCloseOld21_1106Template, useValue: templates.t2 },
        { provide: ExchangeClearVendor21_1106Template, useValue: templates.t3 },
        { provide: ShopExchangeReturnTemplate, useValue: templates.t4 },
        { provide: CompanyResolverService, useValue: companyResolver },
      ],
    }).compile();
    service = mod.get(ContractExchangeService);
  });

  it('throws ConflictException when lock returns count=0', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.approve('r1', 'u1')).rejects.toThrow(/อาจถูกอนุมัติแล้ว/);
  });

  it('creates DRAFT new contract + reserves new product + APPROVED workflow + audit (no JE, no old-side flips)', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'r1', oldContractId: 'old-c', oldProductId: 'old-p', newProductId: 'new-p',
      oldContract: makeOldContract(12, 4),
    });
    prisma.payment.count.mockResolvedValue(4);
    prisma.contract.create.mockResolvedValue({ id: 'new-c', contractNumber: 'EXCH-20260524-0001' });

    const result = await service.approve('r1', 'owner-1');

    // New contract created as DRAFT + workflowStatus APPROVED (sign-then-activate gate)
    const createData = prisma.contract.create.mock.calls[0][0].data;
    expect(createData.status).toBe('DRAFT');
    expect(createData.workflowStatus).toBe('APPROVED');
    expect(createData.exchangedFromContractId).toBe('old-c');

    // New product reserved
    expect(prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'new-p' },
      data: expect.objectContaining({ status: 'RESERVED' }),
    }));

    // Request linked to new contract
    expect(prisma.contractExchangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1' },
      data: expect.objectContaining({ newContractId: 'new-c' }),
    }));

    // NO JE posted, NO old contract flip, NO old product flip
    expect(templates.t1a.execute).not.toHaveBeenCalled();
    expect(templates.t2.execute).not.toHaveBeenCalled();
    expect(templates.t3.execute).not.toHaveBeenCalled();
    expect(templates.t4.execute).not.toHaveBeenCalled();
    expect(prisma.contract.update).not.toHaveBeenCalled();
    // Only the new-product update fired; old product should NOT have been touched.
    const updatedProductIds = (prisma.product.update.mock.calls as any[]).map(
      (c) => c[0]?.where?.id,
    );
    expect(updatedProductIds).not.toContain('old-p');

    // Audit log — phase tag highlights "no money has moved yet"
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'EXCHANGE_REQUEST_APPROVED',
      newValue: expect.objectContaining({
        phase: 'awaiting-sign-then-activate',
      }),
    }));

    expect(result).toEqual({ id: 'r1', newContractId: 'new-c' });
  });

  it('carries pdpaConsentId from old contract onto new contract', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    const old = { ...makeOldContract(12, 4), pdpaConsentId: 'pdpa-old-123' };
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'r1', oldContractId: 'old', oldProductId: 'op', newProductId: 'np',
      oldContract: old,
    });
    prisma.payment.count.mockResolvedValue(4);
    prisma.contract.create.mockResolvedValue({ id: 'nc', contractNumber: 'EXCH-20260524-0001' });

    await service.approve('r1', 'u1');

    const createData = prisma.contract.create.mock.calls[0][0].data;
    expect(createData.pdpaConsentId).toBe('pdpa-old-123');
  });

  it('creates new contract with remaining-installment plan (8 of 12)', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'r1', oldContractId: 'old', oldProductId: 'op', newProductId: 'np',
      oldContract: makeOldContract(12, 4),
    });
    prisma.payment.count.mockResolvedValue(4);
    prisma.contract.create.mockResolvedValue({ id: 'nc', contractNumber: 'EXCH-20260524-0001' });

    await service.approve('r1', 'u1');

    const createData = prisma.contract.create.mock.calls[0][0].data;
    expect(createData.totalMonths).toBe(8);
  });

  it('throws when old contract fully paid (remaining <= 0)', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'r1', oldContractId: 'old', oldProductId: 'op', newProductId: 'np',
      oldContract: makeOldContract(12, 12),
    });
    prisma.payment.count.mockResolvedValue(12);

    await expect(service.approve('r1', 'u1')).rejects.toThrow(/จ่ายครบงวด/);
  });

  // Issue #1086 item 5 — new contract must have downPayment=0
  it('new contract is created with downPayment=0 even when old contract had a non-zero downPayment', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'r1', oldContractId: 'old', oldProductId: 'op', newProductId: 'np',
      oldContract: makeOldContract(12, 4), // makeOldContract sets downPayment=4000
    });
    prisma.payment.count.mockResolvedValue(4);
    prisma.contract.create.mockResolvedValue({ id: 'nc', contractNumber: 'EXCH-20260524-0001' });

    await service.approve('r1', 'u1');

    const createData = prisma.contract.create.mock.calls[0][0].data;
    // The new contract's downPayment must be a zero Decimal, not the old 4000.
    expect(createData.downPayment.toString()).toBe('0');
  });

  // Issue #1086 item 4 — EXCH-YYYYMMDD-NNNN doc number (no EX-${Date.now()} collision)
  describe('contract number (Issue #1086 item 4)', () => {
    beforeEach(() => {
      prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'r1', oldContractId: 'old', oldProductId: 'op', newProductId: 'np',
        oldContract: makeOldContract(12, 4),
      });
      prisma.payment.count.mockResolvedValue(4);
      prisma.contract.create.mockImplementation(async ({ data }: any) => ({ id: 'nc', contractNumber: data.contractNumber }));
    });

    it('uses EXCH-YYYYMMDD-NNNN format (NOT EX-<timestamp>)', async () => {
      prisma.contract.findFirst.mockResolvedValue(null); // first of the day
      const result = await service.approve('r1', 'u1');
      const createData = prisma.contract.create.mock.calls[0][0].data;
      expect(createData.contractNumber).toMatch(/^EXCH-\d{8}-\d{4}$/);
      // Must NOT collide with ExpenseDocument EX- prefix:
      expect(createData.contractNumber).not.toMatch(/^EX-\d+$/);
      expect(result.newContractId).toBe('nc');
    });

    it('acquires advisory lock per BKK day', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);
      await service.approve('r1', 'u1');
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
      );
    });

    it('increments sequence within the same BKK day', async () => {
      // Simulate three sequential approvals on the same day:
      const seqs: string[] = [];
      let pretendCount = 0;
      prisma.contract.findFirst.mockImplementation(async () =>
        pretendCount === 0
          ? null
          : { contractNumber: `EXCH-${todayBkk()}-${String(pretendCount).padStart(4, '0')}` },
      );
      prisma.contract.create.mockImplementation(async ({ data }: any) => {
        pretendCount += 1;
        seqs.push(data.contractNumber);
        return { id: `nc-${pretendCount}`, contractNumber: data.contractNumber };
      });

      await service.approve('r1', 'u1');
      await service.approve('r1', 'u1');
      await service.approve('r1', 'u1');

      expect(seqs[0]).toMatch(/^EXCH-\d{8}-0001$/);
      expect(seqs[1]).toMatch(/^EXCH-\d{8}-0002$/);
      expect(seqs[2]).toMatch(/^EXCH-\d{8}-0003$/);
    });

    it('pads sequence to 4 digits past 99', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        contractNumber: `EXCH-${todayBkk()}-0099`,
      });
      await service.approve('r1', 'u1');
      const createData = prisma.contract.create.mock.calls[0][0].data;
      expect(createData.contractNumber).toMatch(/^EXCH-\d{8}-0100$/);
    });
  });
});

// ============================================================================
// finalizeAfterActivation() — SP2 v2 sign-then-activate flow
// Triggered by ContractWorkflowService.activate() when the contract being
// activated has exchangedFromContractId non-null. This is where the JE chain
// posts + the old-side status flips happen.
// ============================================================================
describe('ContractExchangeService.finalizeAfterActivation', () => {
  let service: ContractExchangeService;
  let tx: any;
  let templates: any;
  let audit: any;
  let companyResolver: any;

  // Make a typical exchange-contract object to pass through.
  const newContract = {
    id: 'new-c',
    productId: 'new-p',
    exchangedFromContractId: 'old-c',
    financedAmount: '10000',
    storeCommission: '1000',
  };

  beforeEach(async () => {
    tx = {
      contractExchangeRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'r1',
          oldContractId: 'old-c',
          oldProductId: 'old-p',
          newContractId: 'new-c',
        }),
        update: jest.fn(),
      },
      contract: {
        update: jest.fn(),
      },
      product: {
        update: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'old-p', costPrice: '15000' }),
      },
      journalLine: { findMany: jest.fn().mockResolvedValue([]) },
    };
    templates = {
      t1a: { execute: jest.fn().mockResolvedValue({ id: 'je1-id', entryNumber: 'JV-A1' }) },
      t2: { execute: jest.fn().mockResolvedValue({ id: 'je2-id', entryNumber: 'JV-A2' }) },
      t3: { execute: jest.fn().mockResolvedValue({ id: 'je3-id', entryNumber: 'JV-A3' }) },
      t4: { execute: jest.fn().mockResolvedValue({ id: 'je4-id', entryNumber: 'JV-A4' }) },
    };
    audit = { log: jest.fn() };
    companyResolver = { getShopCompanyId: jest.fn().mockResolvedValue('shop-co-id') };
    const mod = await Test.createTestingModule({
      providers: [
        ContractExchangeService,
        { provide: PrismaService, useValue: {} },
        { provide: AuditService, useValue: audit },
        { provide: ExchangeNewContract1ATemplate, useValue: templates.t1a },
        { provide: ExchangeCloseOld21_1106Template, useValue: templates.t2 },
        { provide: ExchangeClearVendor21_1106Template, useValue: templates.t3 },
        { provide: ShopExchangeReturnTemplate, useValue: templates.t4 },
        { provide: CompanyResolverService, useValue: companyResolver },
      ],
    }).compile();
    service = mod.get(ContractExchangeService);
  });

  it('runs A.1 → A.2 → A.3 → A.4 in order + flips old contract + old product + returns ids', async () => {
    const callOrder: string[] = [];
    templates.t1a.execute.mockImplementation(async () => {
      callOrder.push('t1a');
      return { id: 'je1-id' };
    });
    templates.t2.execute.mockImplementation(async () => {
      callOrder.push('t2');
      return { id: 'je2-id' };
    });
    templates.t3.execute.mockImplementation(async () => {
      callOrder.push('t3');
      return { id: 'je3-id' };
    });
    templates.t4.execute.mockImplementation(async () => {
      callOrder.push('t4');
      return { id: 'je4-id' };
    });

    const result = await service.finalizeAfterActivation(newContract, tx);

    expect(callOrder).toEqual(['t1a', 't2', 't3', 't4']);
    expect(templates.t1a.execute).toHaveBeenCalledWith('new-c', tx);

    // Old contract flip
    expect(tx.contract.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old-c' },
      data: expect.objectContaining({ status: 'EXCHANGED' }),
    }));
    // Old product flip — REFURBISHED + ownedByCompanyId = SHOP
    expect(tx.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old-p' },
      data: expect.objectContaining({ status: 'REFURBISHED', ownedByCompanyId: 'shop-co-id' }),
    }));

    // Return shape
    expect(result).toEqual({
      je1aId: 'je1-id',
      je2Id: 'je2-id',
      je3Id: 'je3-id',
      je4Id: 'je4-id',
    });
  });

  it('throws InternalServerErrorException when no exchange request matches the new contract', async () => {
    tx.contractExchangeRequest.findFirst.mockResolvedValue(null);
    await expect(service.finalizeAfterActivation(newContract, tx)).rejects.toThrow(
      InternalServerErrorException,
    );
    expect(templates.t1a.execute).not.toHaveBeenCalled();
  });

  it('throws InternalServerErrorException when old product costPrice is null', async () => {
    tx.product.findUniqueOrThrow.mockResolvedValue({ id: 'old-p', costPrice: null });
    await expect(service.finalizeAfterActivation(newContract, tx)).rejects.toThrow(
      InternalServerErrorException,
    );
    // A.4 must NOT have fired when cost is missing
    expect(templates.t4.execute).not.toHaveBeenCalled();
    // But A.1-A.3 already ran (no rollback at unit level — that's the caller's $tx job)
    expect(templates.t1a.execute).toHaveBeenCalled();
  });

  it('passes costPrice to A.4 template', async () => {
    tx.product.findUniqueOrThrow.mockResolvedValue({ id: 'old-p', costPrice: '12345.67' });
    await service.finalizeAfterActivation(newContract, tx);
    const t4Call = templates.t4.execute.mock.calls[0][0];
    expect(t4Call.oldProductId).toBe('old-p');
    expect(t4Call.oldContractId).toBe('old-c');
    expect(t4Call.cost.toString()).toBe('12345.67');
  });

  it('stores je*Id refs on the exchange request', async () => {
    await service.finalizeAfterActivation(newContract, tx);
    expect(tx.contractExchangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1' },
      data: expect.objectContaining({
        je1aId: 'je1-id',
        je2Id: 'je2-id',
        je3Id: 'je3-id',
        je4Id: 'je4-id',
      }),
    }));
  });

  it('writes EXCHANGE_FINALIZED + EXCHANGE_DEVICE_RETURNED_TO_SHOP audit logs', async () => {
    await service.finalizeAfterActivation(newContract, tx);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'EXCHANGE_FINALIZED',
      entity: 'contract_exchange_request',
      entityId: 'r1',
      newValue: expect.objectContaining({
        oldContractId: 'old-c',
        newContractId: 'new-c',
        jeIds: expect.objectContaining({ je4Id: 'je4-id' }),
      }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'EXCHANGE_DEVICE_RETURNED_TO_SHOP',
      entity: 'product',
      entityId: 'old-p',
      newValue: expect.objectContaining({
        exchangeRequestId: 'r1',
        oldContractId: 'old-c',
        jeId: 'je4-id',
        ownedByCompanyId: 'shop-co-id',
      }),
    }));
  });

  // Issue #1086 item 3 — aggregate from journal_lines, not straight-line proration
  describe('computeOldOutstanding from journal_lines', () => {
    it('queries journalLine.findMany for the 4 relevant accounts', async () => {
      await service.finalizeAfterActivation(newContract, tx);
      expect(tx.journalLine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            accountCode: { in: ['11-2101', '11-2105', '11-2106', '21-2102'] },
            deletedAt: null,
            journalEntry: expect.objectContaining({
              deletedAt: null,
              status: 'POSTED',
              OR: expect.any(Array),
            }),
          }),
        }),
      );
    });

    it('queries by BOTH referenceId AND metadata.contractId', async () => {
      await service.finalizeAfterActivation(newContract, tx);
      const call = tx.journalLine.findMany.mock.calls[0][0];
      const or = call.where.journalEntry.OR;
      expect(or).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ referenceId: 'old-c' }),
          expect.objectContaining({
            metadata: expect.objectContaining({ path: ['contractId'], equals: 'old-c' }),
          }),
        ]),
      );
    });

    it('aggregates Dr-Cr per account into expected outstanding figures', async () => {
      // Realistic 5-line ledger:
      //  11-2101: Dr 20000, Cr 3000  → net Dr 17000 (gross outstanding)
      //  11-2105: Dr 1400,  Cr 200   → net Dr 1200  (vat receivable outstanding)
      //  11-2106: Dr 1000,  Cr 5000  → net Cr 4000  (unearned interest remaining)
      //  21-2102: Dr 100,   Cr 1300  → net Cr 1200  (deferred VAT outstanding)
      tx.journalLine.findMany.mockResolvedValue([
        { accountCode: '11-2101', debit: new Prisma.Decimal(20000), credit: new Prisma.Decimal(0) },
        { accountCode: '11-2101', debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(3000) },
        { accountCode: '11-2105', debit: new Prisma.Decimal(1400), credit: new Prisma.Decimal(200) },
        { accountCode: '11-2106', debit: new Prisma.Decimal(1000), credit: new Prisma.Decimal(5000) },
        { accountCode: '21-2102', debit: new Prisma.Decimal(100), credit: new Prisma.Decimal(1300) },
      ]);
      await service.finalizeAfterActivation(newContract, tx);
      const t2Call = templates.t2.execute.mock.calls[0][0];
      expect(t2Call.oldGrossOutstanding.toString()).toBe('17000');
      expect(t2Call.oldVatReceivableOutstanding.toString()).toBe('1200');
      expect(t2Call.oldUnearnedInterestOutstanding.toString()).toBe('4000');
      expect(t2Call.oldDeferredVatOutstanding.toString()).toBe('1200');
    });

    it('returns all zeroes when contract has no journal lines yet', async () => {
      tx.journalLine.findMany.mockResolvedValue([]);
      await service.finalizeAfterActivation(newContract, tx);
      const t2Call = templates.t2.execute.mock.calls[0][0];
      expect(t2Call.oldGrossOutstanding.toString()).toBe('0');
    });
  });
});

describe('ContractExchangeService.reject', () => {
  let service: ContractExchangeService;
  let prisma: any;
  let audit: any;

  beforeEach(async () => {
    audit = { log: jest.fn() };
    prisma = {
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      contractExchangeRequest: {
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'r1', status: 'REJECTED' }),
      },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ContractExchangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: ExchangeNewContract1ATemplate, useValue: {} },
        { provide: ExchangeCloseOld21_1106Template, useValue: {} },
        { provide: ExchangeClearVendor21_1106Template, useValue: {} },
        { provide: ShopExchangeReturnTemplate, useValue: {} },
        { provide: CompanyResolverService, useValue: { getShopCompanyId: jest.fn() } },
      ],
    }).compile();
    service = mod.get(ContractExchangeService);
  });

  it('rejects with reason min length enforced', async () => {
    await expect(service.reject('r1', 'too short', 'u1')).rejects.toThrow(/อย่างน้อย 10/);
  });

  it('throws ConflictException when lock count = 0', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.reject('r1', 'reason with enough chars', 'u1')).rejects.toThrow(/อาจถูกตอบกลับ/);
  });

  it('rejects + writes audit log', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    await service.reject('r1', 'เหตุผลปฏิเสธชัดเจน', 'u1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'EXCHANGE_REQUEST_REJECTED',
    }));
  });
});

function makeOldContract(totalMonths: number, _paid: number) {
  return {
    id: 'old-c',
    customerId: 'cust',
    productId: 'old-p',
    branchId: 'br',
    salespersonId: 'sp',
    pdpaConsentId: null,
    planType: 'STORE_DIRECT',
    totalMonths,
    monthlyPayment: { toString: () => '1416.66' } as any,
    financedAmount: { toString: () => '10000' } as any,
    storeCommission: { toString: () => '1000' } as any,
    interestRate: { toString: () => '16' } as any,
    interestTotal: { toString: () => '4000' } as any,
    vatAmount: { toString: () => '1190' } as any,
    sellingPrice: { toString: () => '28000' } as any,
    downPayment: { toString: () => '4000' } as any,
    creditBalance: { toString: () => '0' } as any,
  };
}

function todayBkk(): string {
  const parts = new Date().toLocaleString('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = parts.split('-').map((s) => parseInt(s, 10));
  return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}
