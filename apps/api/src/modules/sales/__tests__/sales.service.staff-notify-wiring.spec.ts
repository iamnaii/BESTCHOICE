import { SalesService } from '../sales.service';

/** รีวิว I1 — SalesService `new SaleCreationService(...)` เอง (ไม่ผ่าน DI) จึงต้องส่ง SaleCompletedNotifier ต่อให้ ไม่งั้น POS ไม่แจ้ง sale.completed */
describe('SalesService — staff LINE wiring', () => {
  it('forwards SaleCompletedNotifier into the internally constructed SaleCreationService', () => {
    const saleCompleted = { notify: jest.fn() };
    const svc = new SalesService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, undefined, saleCompleted as never);
    expect((svc as unknown as { creation: { saleCompleted?: unknown } }).creation.saleCompleted).toBe(saleCompleted);
  });
});
