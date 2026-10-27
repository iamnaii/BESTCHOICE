import { BookingsService } from '../bookings.service';

/** ก้อน 7 A16 — แปลงใบจองเป็นใบขาย = ขายสดสำเร็จ → แจ้งหลัง commit */
describe('BookingsService.convertToSale → SaleCompletedNotifier', () => {
  it('notifies the sale after the transaction commits; failure never breaks the conversion', async () => {
    const prisma = { $transaction: jest.fn().mockResolvedValue({ sale: { id: 'sale-9' }, bookingId: 'b1' }) };
    const saleCompleted = { notify: jest.fn().mockRejectedValue(new Error('boom')) };
    const stub = {} as never;
    const service = new BookingsService(prisma as never, stub, stub, stub, stub, stub, stub, saleCompleted as never);
    const result = await service.convertToSale('b1', {} as never, 'sp-1', { id: 'u1', role: 'OWNER' } as never);
    expect(result).toEqual({ sale: { id: 'sale-9' }, bookingId: 'b1' });
    await new Promise((r) => setImmediate(r));
    expect(saleCompleted.notify).toHaveBeenCalledWith('sale-9');
  });
});
