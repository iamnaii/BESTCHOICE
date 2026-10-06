import { ConflictException } from '@nestjs/common';
import { StockReservationService } from '../stock-reservation.service';

describe('StockReservationService.unreserve — เครื่องที่ใบจองล็อก (PR 2)', () => {
  const prisma = {
    booking: { findFirst: jest.fn() },
    product: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  } as any;
  const service = new StockReservationService(prisma);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.product.updateMany.mockResolvedValue({ count: 1 });
    prisma.product.findUniqueOrThrow.mockResolvedValue({ id: 'prod-1' });
  });

  it('มีใบจอง PAID ล็อกเครื่องอยู่ → 409 พร้อมเลขใบ และไม่แตะสถานะเครื่อง', async () => {
    prisma.booking.findFirst.mockResolvedValue({ id: 'bk-1', bookingNumber: 'BK-20260517-0001' });
    await expect(service.unreserve('prod-1')).rejects.toThrow(ConflictException);
    await expect(service.unreserve('prod-1')).rejects.toThrow('BK-20260517-0001');
    expect(prisma.booking.findFirst).toHaveBeenCalledWith({
      where: { lockedProductId: 'prod-1', status: 'PAID', deletedAt: null },
      select: { id: true, bookingNumber: true },
    });
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('ไม่มีใบจองล็อก → ปลดจองตามเดิม', async () => {
    prisma.booking.findFirst.mockResolvedValue(null);
    await service.unreserve('prod-1');
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'prod-1', deletedAt: null, status: 'RESERVED' },
      data: { status: 'IN_STOCK' },
    });
  });
});
