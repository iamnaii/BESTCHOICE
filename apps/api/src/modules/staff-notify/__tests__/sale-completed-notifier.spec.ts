import { SaleCompletedNotifier } from '../sale-completed-notifier.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

describe('SaleCompletedNotifier', () => {
  const sale = {
    id: 'sale-1', saleNumber: 'S-20261026-0012', saleType: 'CASH', netAmount: '28900', branchId: 'br-1',
    branch: { name: 'ลาดพร้าว' }, product: { brand: 'Apple', model: 'iPhone 15', storage: '128GB' }, salesperson: { name: 'เอก' },
  };
  it('SC1 loads the sale after commit and notifies sale.completed with branch, product, amount and seller', async () => {
    const prisma = { sale: { findUnique: jest.fn().mockResolvedValue(sale) } };
    const staffNotify = { notify: jest.fn().mockResolvedValue({ sent: 1 }) };
    await new SaleCompletedNotifier(prisma as never, staffNotify as never).notify('sale-1');
    expect(prisma.sale.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'sale-1' } }));
    expect(staffNotify.notify).toHaveBeenCalledWith('sale.completed', {
      title: 'ขายสดสำเร็จ S-20261026-0012',
      lines: ['สาขา ลาดพร้าว', 'Apple iPhone 15 128GB · 28,900.00 บาท', 'โดย เอก'],
      link: '/sales/sale-1',
      branchId: 'br-1',
      dedupeKey: 'sale-1',
    });
  });
  it('SC2 sale not found / no hub / hub failure → never throws, nothing sent', async () => {
    const staffNotify = { notify: jest.fn().mockRejectedValue(new Error('boom')) };
    await expect(new SaleCompletedNotifier({ sale: { findUnique: jest.fn().mockResolvedValue(null) } } as never, staffNotify as never).notify('x')).resolves.toBeUndefined();
    expect(staffNotify.notify).not.toHaveBeenCalled();
    await expect(new SaleCompletedNotifier({ sale: { findUnique: jest.fn().mockResolvedValue(sale) } } as never, undefined).notify('sale-1')).resolves.toBeUndefined();
    await expect(new SaleCompletedNotifier({ sale: { findUnique: jest.fn().mockResolvedValue(sale) } } as never, staffNotify as never).notify('sale-1')).resolves.toBeUndefined();
  });
});
