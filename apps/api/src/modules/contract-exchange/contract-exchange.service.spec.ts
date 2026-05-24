import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ContractExchangeService } from './contract-exchange.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ExchangeNewContract1ATemplate } from '../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeClearVendor21_1106Template } from '../journal/cpa-templates/exchange-clear-vendor-21-1106.template';

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
      ],
    }).compile();
    service = mod.get(ContractExchangeService);
  });

  it('NotFoundException when old contract does not exist', async () => {
    prisma.contract.findUnique.mockResolvedValue(null);
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, 'u-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('BadRequestException when old contract is not ACTIVE', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', status: 'CANCELED', deletedAt: null });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, 'u-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('BadRequestException when new product is not IN_STOCK', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', status: 'ACTIVE', productId: 'op', deletedAt: null });
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', brand: 'A', model: 'X', storage: '256', sellingPrice: '28000', status: 'SOLD_INSTALLMENT' })
      .mockResolvedValueOnce({ id: 'np', brand: 'A', model: 'X', storage: '256', sellingPrice: '28000', status: 'SOLD_INSTALLMENT' });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, 'u-1'),
    ).rejects.toThrow(/IN_STOCK/);
  });

  it('BadRequestException when brand differs', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', status: 'ACTIVE', productId: 'op', deletedAt: null });
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: '28000' })
      .mockResolvedValueOnce({ id: 'np', brand: 'Samsung', model: 'iPhone 15', storage: '256', sellingPrice: '28000', status: 'IN_STOCK' });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, 'u-1'),
    ).rejects.toThrow(/รุ่นเดียวกัน/);
  });

  it('BadRequestException when sellingPrice differs', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', status: 'ACTIVE', productId: 'op', deletedAt: null });
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: '28000' })
      .mockResolvedValueOnce({ id: 'np', brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: '30000', status: 'IN_STOCK' });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, 'u-1'),
    ).rejects.toThrow(/ราคา/);
  });

  it('creates PENDING request when all checks pass', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', status: 'ACTIVE', productId: 'op', deletedAt: null });
    const same = { brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: '28000' };
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', ...same })
      .mockResolvedValueOnce({ id: 'np', ...same, status: 'IN_STOCK' });
    prisma.contractExchangeRequest.create.mockResolvedValue({ id: 'req-1', status: 'PENDING' });

    const result = await service.submit(
      { oldContractId: 'old', oldProductId: 'op', newProductId: 'np', conditionNote: 'good' },
      'u-1',
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

describe('ContractExchangeService.approve', () => {
  let service: ContractExchangeService;
  let prisma: any;
  let templates: any;
  let audit: any;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      contractExchangeRequest: {
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      contract: {
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      payment: { count: jest.fn() },
      product: { update: jest.fn() },
    };
    templates = {
      t1a: { execute: jest.fn().mockResolvedValue({ id: 'je1-id', entryNumber: 'JV-A1' }) },
      t2: { execute: jest.fn().mockResolvedValue({ id: 'je2-id', entryNumber: 'JV-A2' }) },
      t3: { execute: jest.fn().mockResolvedValue({ id: 'je3-id', entryNumber: 'JV-A3' }) },
    };
    audit = { log: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        ContractExchangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: ExchangeNewContract1ATemplate, useValue: templates.t1a },
        { provide: ExchangeCloseOld21_1106Template, useValue: templates.t2 },
        { provide: ExchangeClearVendor21_1106Template, useValue: templates.t3 },
      ],
    }).compile();
    service = mod.get(ContractExchangeService);
  });

  it('throws ConflictException when lock returns count=0', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.approve('r1', 'u1')).rejects.toThrow(/อาจถูกอนุมัติแล้ว/);
  });

  it('runs A.1 → A.2 → A.3 atomically + flips statuses + audit', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'r1', oldContractId: 'old-c', oldProductId: 'old-p', newProductId: 'new-p',
      oldContract: makeOldContract(12, 4),
    });
    prisma.payment.count.mockResolvedValue(4);
    prisma.contract.findUniqueOrThrow.mockResolvedValue(makeOldContract(12, 4));
    prisma.contract.create.mockResolvedValue({ id: 'new-c', contractNumber: 'EX-001' });

    const result = await service.approve('r1', 'owner-1');

    expect(templates.t1a.execute).toHaveBeenCalledWith('new-c', expect.anything());
    expect(templates.t2.execute).toHaveBeenCalled();
    expect(templates.t3.execute).toHaveBeenCalled();
    expect(prisma.contract.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old-c' }, data: expect.objectContaining({ status: 'EXCHANGED' }),
    }));
    expect(prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old-p' }, data: expect.objectContaining({ status: 'REFURBISHED' }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'EXCHANGE_REQUEST_APPROVED',
    }));
    expect(result).toMatchObject({ id: 'r1', newContractId: 'new-c' });
  });

  it('creates new contract with remaining-installment plan (8 of 12)', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'r1', oldContractId: 'old', oldProductId: 'op', newProductId: 'np',
      oldContract: makeOldContract(12, 4),
    });
    prisma.payment.count.mockResolvedValue(4);
    prisma.contract.findUniqueOrThrow.mockResolvedValue(makeOldContract(12, 4));
    prisma.contract.create.mockResolvedValue({ id: 'nc', contractNumber: 'EX' });

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
