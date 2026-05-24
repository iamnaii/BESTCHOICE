import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
