import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExchangeReason } from './dto/create-exchange.dto';

/**
 * T5-C10 guards:
 *   - reason=DEFECT requires ≥ 3 photos
 *   - max 1 exchange per contract
 *   - ≤ 2 exchanges per customer per 12 months
 */
describe('ExchangeService.executeExchange — T5-C10 guards', () => {
  let service: ExchangeService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const activeContract = (overrides: Record<string, unknown> = {}) => ({
    id: 'c-1',
    status: 'ACTIVE',
    deletedAt: null,
    customerId: 'cust-1',
    payments: [],
    customer: { id: 'cust-1' },
    ...overrides,
  });

  const validDto = (overrides: Partial<Record<string, unknown>> = {}) => ({
    oldContractId: 'c-1',
    newProductId: 'p-1',
    newPriceId: 'pr-1',
    newDownPayment: 5000,
    newTotalMonths: 12,
    reason: ExchangeReason.UPGRADE,
    ...overrides,
  });

  beforeEach(async () => {
    tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(activeContract()),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
        create: jest.fn(),
      },
      product: { findUnique: jest.fn(), update: jest.fn() },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      payment: { createMany: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [ExchangeService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(ExchangeService);
  });

  it('DEFECT without photos → BadRequest', async () => {
    await expect(
      service.executeExchange(
        validDto({ reason: ExchangeReason.DEFECT, defectPhotos: [] }),
        'u-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('DEFECT with 2 photos → BadRequest (< 3 required)', async () => {
    await expect(
      service.executeExchange(
        validDto({
          reason: ExchangeReason.DEFECT,
          defectPhotos: ['url1', 'url2'],
        }),
        'u-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when old contract already status=EXCHANGED', async () => {
    tx.contract.findUnique.mockResolvedValue(activeContract({ status: 'EXCHANGED' }));
    await expect(service.executeExchange(validDto(), 'u-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects when another contract has this as parentContractId (already spawned exchange)', async () => {
    tx.contract.count.mockResolvedValueOnce(1); // parentContractId count
    await expect(service.executeExchange(validDto(), 'u-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects when customer has 2+ exchanges in 12 months', async () => {
    tx.contract.count
      .mockResolvedValueOnce(0) // parent count
      .mockResolvedValueOnce(2); // customer exchanges
    await expect(service.executeExchange(validDto(), 'u-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('NotFound when old contract missing', async () => {
    tx.contract.findUnique.mockResolvedValue(null);
    await expect(service.executeExchange(validDto(), 'u-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
