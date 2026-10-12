import { GoneException } from '@nestjs/common';
import { ContractExchangeController } from './contract-exchange.controller';
import { DEVICE_SWAP_CLOSED_MESSAGE } from './device-swap-closed.policy';

/**
 * คำตัดสินเจ้าของ 2026-10-06 — เส้นทางเดิม `insurance/exchange-requests`: ยื่น/preview/อนุมัติ ต้อง 410 พร้อมข้อความ
 * ชี้ทาง (ไม่ใช่ 404 เงียบ) โดยไม่แตะ service · เส้นทางที่ใช้ปิดคำขอค้าง (pending/recent/cancel/reject) ยังส่งต่อ service ตามเดิม
 */
describe('ContractExchangeController — เมนูเปลี่ยนเครื่องแบบมีราคาปิดใช้ (410)', () => {
  const svc = {
    submit: jest.fn(),
    buildPreview: jest.fn(),
    approve: jest.fn(),
    listPending: jest.fn().mockResolvedValue(['pending']),
    listRecent: jest.fn().mockResolvedValue(['recent']),
    reject: jest.fn().mockResolvedValue({ id: 'req-1', status: 'REJECTED' }),
  };
  const cancelSvc = { cancel: jest.fn().mockResolvedValue({ id: 'req-1', status: 'CANCELED' }) };
  const req = { user: { id: 'u-owner', role: 'OWNER', branchId: null } };
  const controller = new ContractExchangeController(svc as never, cancelSvc as never);

  beforeEach(() => jest.clearAllMocks());

  it.each(['submit', 'preview', 'approve'] as const)('%s → GoneException พร้อม DEVICE_SWAP_CLOSED_MESSAGE · ไม่เรียก service', (method) => {
    expect(() => (controller as unknown as Record<string, () => never>)[method]()).toThrow(GoneException);
    expect(() => (controller as unknown as Record<string, () => never>)[method]()).toThrow(
      new GoneException(DEVICE_SWAP_CLOSED_MESSAGE),
    );
    expect(svc.submit).not.toHaveBeenCalled();
    expect(svc.buildPreview).not.toHaveBeenCalled();
    expect(svc.approve).not.toHaveBeenCalled();
  });

  it('pending / recent / cancel / reject ยังส่งต่อ service ตามเดิม (ทางปิดคำขอที่ค้างก่อนปิดเมนู)', async () => {
    await expect(controller.listPending(req)).resolves.toEqual(['pending']);
    expect(svc.listPending).toHaveBeenCalledWith(req.user);
    await expect(controller.listRecent(req)).resolves.toEqual(['recent']);
    expect(svc.listRecent).toHaveBeenCalledWith(req.user);
    await controller.cancel('req-1', { reason: 'ลูกค้าคืนเครื่องใหม่ — ยกเลิก swap' } as never, req);
    expect(cancelSvc.cancel).toHaveBeenCalledWith('req-1', 'ลูกค้าคืนเครื่องใหม่ — ยกเลิก swap', req.user);
    await controller.reject('req-1', { reason: 'ปิดเมนูแล้ว — ปิดคำขอค้าง' } as never, req);
    expect(svc.reject).toHaveBeenCalledWith('req-1', 'ปิดเมนูแล้ว — ปิดคำขอค้าง', 'u-owner');
  });
});
