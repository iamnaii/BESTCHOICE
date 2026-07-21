import { Test } from '@nestjs/testing';
import { ShopInstallmentApplyService } from './shop-installment-apply.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import type { CreateApplicationDto } from './dto/create-application.dto';

type PrismaMock = {
  product: { findUnique: jest.Mock };
  onlineInstallmentApplication: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
  };
};

const prismaMock: PrismaMock = {
  product: { findUnique: jest.fn() },
  onlineInstallmentApplication: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
};

const lineMock = { sendFlexMessage: jest.fn() };

const baseDto: CreateApplicationDto = {
  productId: 'p1',
  fullName: 'บีม',
  phone: '0812345678',
  nationalId: '1234567890123',
  proposedDownPayment: 2000,
  proposedTotalMonths: 12,
};

describe('ShopInstallmentApplyService', () => {
  let service: ShopInstallmentApplyService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        ShopInstallmentApplyService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: LineOaService, useValue: lineMock },
      ],
    }).compile();
    service = mod.get(ShopInstallmentApplyService);
  });

  it('computes monthly payment from installmentPrice, never costPrice', async () => {
    // costPrice is the internal cost and must never leak into the customer-facing quote.
    prismaMock.product.findUnique.mockResolvedValue({
      id: 'p1',
      costPrice: 5000,
      installmentPrice: 20000,
      cashPrice: 18000,
      deletedAt: null,
    });
    prismaMock.onlineInstallmentApplication.findFirst.mockResolvedValue(null);
    prismaMock.onlineInstallmentApplication.create.mockResolvedValue({
      id: 'app1',
      applicationNumber: 'APP-260421-123',
      status: 'SUBMITTED',
    });

    const res = await service.submit({ ...baseDto }, undefined);

    expect(res.applicationNumber).toMatch(/^APP-/);
    const createArgs = prismaMock.onlineInstallmentApplication.create.mock.calls[0][0];
    expect(createArgs.data.status).toBe('SUBMITTED');
    expect(createArgs.data.proposedMonthlyPayment).toBeGreaterThan(0);
    // financed = 20000 - 2000 = 18000; interest = 18000 * 0.013 * 12 = 2808
    // monthly = ceil((18000 + 2808) / 12) = 1734
    expect(createArgs.data.proposedMonthlyPayment).toBe(1734);
    expect(res.proposedMonthlyPayment).toBe(1734);

    // Sanity check: this must NOT be the value computed from costPrice (5000).
    // financed = 5000 - 2000 = 3000; interest = 3000 * 0.013 * 12 = 468; monthly = ceil(3468/12) = 289
    expect(createArgs.data.proposedMonthlyPayment).not.toBe(289);
  });

  it('falls back to cashPrice when installmentPrice is unset', async () => {
    prismaMock.product.findUnique.mockResolvedValue({
      id: 'p1',
      costPrice: 5000,
      installmentPrice: null,
      cashPrice: 18000,
      deletedAt: null,
    });
    prismaMock.onlineInstallmentApplication.findFirst.mockResolvedValue(null);
    prismaMock.onlineInstallmentApplication.create.mockResolvedValue({
      id: 'app1',
      applicationNumber: 'APP-260421-124',
      status: 'SUBMITTED',
    });

    const res = await service.submit({ ...baseDto }, undefined);

    const createArgs = prismaMock.onlineInstallmentApplication.create.mock.calls[0][0];
    // financed = 18000 - 2000 = 16000; interest = 16000 * 0.013 * 12 = 2496
    // monthly = ceil((16000 + 2496) / 12) = 1542
    expect(createArgs.data.proposedMonthlyPayment).toBe(1542);
    expect(res.proposedMonthlyPayment).toBe(1542);
  });

  it('rejects duplicate active applications for same phone + product', async () => {
    prismaMock.product.findUnique.mockResolvedValue({
      id: 'p1',
      costPrice: 12000,
      deletedAt: null,
    });
    prismaMock.onlineInstallmentApplication.findFirst.mockResolvedValue({
      id: 'dup',
      status: 'SUBMITTED',
    });

    await expect(service.submit({ ...baseDto }, undefined)).rejects.toThrow(/ใบสมัคร/);
    expect(prismaMock.onlineInstallmentApplication.create).not.toHaveBeenCalled();
  });

  it('returns NotFound when product is missing or soft-deleted', async () => {
    prismaMock.product.findUnique.mockResolvedValue(null);
    await expect(service.submit({ ...baseDto }, undefined)).rejects.toThrow(/ไม่พบสินค้า/);

    prismaMock.product.findUnique.mockResolvedValue({
      id: 'p1',
      costPrice: 12000,
      deletedAt: new Date(),
    });
    await expect(service.submit({ ...baseDto }, undefined)).rejects.toThrow(/ไม่พบสินค้า/);
  });

  it('sends Flex message when lineUserId provided (non-fatal on failure)', async () => {
    prismaMock.product.findUnique.mockResolvedValue({
      id: 'p1',
      costPrice: 12000,
      deletedAt: null,
    });
    prismaMock.onlineInstallmentApplication.findFirst.mockResolvedValue(null);
    prismaMock.onlineInstallmentApplication.create.mockResolvedValue({
      id: 'app1',
      applicationNumber: 'APP-260421-999',
      status: 'SUBMITTED',
    });
    lineMock.sendFlexMessage.mockRejectedValueOnce(new Error('network'));

    const res = await service.submit({ ...baseDto, lineUserId: 'U123' }, undefined);

    expect(res.applicationNumber).toBe('APP-260421-999');
    expect(lineMock.sendFlexMessage).toHaveBeenCalledWith(
      'U123',
      expect.objectContaining({ type: 'flex' }),
      'line-shop',
    );
  });

  describe('admin actions', () => {
    it('schedules an application with reviewer metadata', async () => {
      const when = new Date('2026-05-01T10:00:00Z');
      prismaMock.onlineInstallmentApplication.update.mockResolvedValue({
        id: 'a1',
        status: 'SCHEDULED',
      });
      await service.schedule('a1', when, 'user-1');
      const args = prismaMock.onlineInstallmentApplication.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'a1' });
      expect(args.data.status).toBe('SCHEDULED');
      expect(args.data.scheduledAt).toBe(when);
      expect(args.data.reviewedById).toBe('user-1');
      expect(args.data.reviewedAt).toBeInstanceOf(Date);
    });

    it('rejects an application and attempts Flex notification', async () => {
      prismaMock.onlineInstallmentApplication.update.mockResolvedValue({
        id: 'a1',
        applicationNumber: 'APP-260421-001',
        status: 'REJECTED',
        lineUserId: 'U999',
      });

      await service.reject('a1', 'user-1', 'เครดิตไม่ผ่าน');
      const args = prismaMock.onlineInstallmentApplication.update.mock.calls[0][0];
      expect(args.data.status).toBe('REJECTED');
      expect(args.data.rejectReason).toBe('เครดิตไม่ผ่าน');
      expect(lineMock.sendFlexMessage).toHaveBeenCalledWith(
        'U999',
        expect.objectContaining({ type: 'flex' }),
        'line-shop',
      );
    });

    it('links a contract and marks CONTRACT_SIGNED', async () => {
      prismaMock.onlineInstallmentApplication.update.mockResolvedValue({
        id: 'a1',
        status: 'CONTRACT_SIGNED',
      });
      await service.linkContract('a1', 'contract-1');
      const args = prismaMock.onlineInstallmentApplication.update.mock.calls[0][0];
      expect(args.data).toEqual({ status: 'CONTRACT_SIGNED', contractId: 'contract-1' });
    });
  });
});
