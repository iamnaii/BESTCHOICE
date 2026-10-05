import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { StockAdjustmentsController } from './stock-adjustments.controller';
import { StockAdjustmentsService } from './stock-adjustments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

/**
 * ก้อน 3 — สิทธิ์ตามคำตัดสินเจ้าของ 2026-10-05: ส่งคำขอ = SALES/BM/OWNER · อนุมัติ/ไม่อนุมัติ = OWNER เท่านั้น ·
 * ยกเลิก = ผู้ขอ/OWNER (controller ปล่อย SALES/BM/OWNER, service ตรวจเจ้าของใบ)
 */
describe('StockAdjustmentsController — คำขอตัดสินค้า', () => {
  let controller: StockAdjustmentsController;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;
  const user = { id: 'u1', role: 'SALES', branchId: 'b1' };

  beforeEach(async () => {
    service = {
      createRequest: jest.fn().mockResolvedValue({ id: 'adj-1' }),
      cancel: jest.fn().mockResolvedValue({}),
      approve: jest.fn().mockResolvedValue({}),
      reject: jest.fn().mockResolvedValue({}),
      lookupProduct: jest.fn().mockResolvedValue([]),
      preview: jest.fn().mockResolvedValue({}),
      pendingCount: jest.fn().mockResolvedValue({ total: 0 }),
      findAll: jest.fn().mockResolvedValue({ data: [] }),
      findOne: jest.fn().mockResolvedValue({}),
      getSummary: jest.fn().mockResolvedValue({}),
    };
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [StockAdjustmentsController],
      providers: [{ provide: StockAdjustmentsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard).useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(StockAdjustmentsController);
  });

  const roles = (method: string) => Reflect.getMetadata(ROLES_KEY, (StockAdjustmentsController.prototype as never)[method]);

  it('POST / → createRequest ส่ง dto + ไฟล์ + ผู้ใช้ทั้งก้อน · SALES/BM/OWNER', async () => {
    const dto = { productId: 'p1', reason: 'DAMAGED' };
    const files = [{ originalname: 'a.jpg' }] as never;
    await controller.createRequest(dto as never, files, user);
    expect(service.createRequest).toHaveBeenCalledWith(dto, files, user);
    expect(roles('createRequest')).toEqual(['OWNER', 'BRANCH_MANAGER', 'SALES']);
  });

  it('POST / ไม่มีไฟล์ → ส่ง [] ไม่ใช่ undefined', async () => {
    await controller.createRequest({ productId: 'p1', reason: 'LOST' } as never, undefined as never, user);
    expect(service.createRequest.mock.calls[0][1]).toEqual([]);
  });

  it('POST :id/approve และ :id/reject → OWNER เท่านั้น', async () => {
    await controller.approve('adj-1', user);
    expect(service.approve).toHaveBeenCalledWith('adj-1', user);
    await controller.reject('adj-1', { reason: 'ยังไม่ชัดเจน ขอรูปเพิ่ม' }, user);
    expect(service.reject).toHaveBeenCalledWith('adj-1', { reason: 'ยังไม่ชัดเจน ขอรูปเพิ่ม' }, user);
    expect(roles('approve')).toEqual(['OWNER']);
    expect(roles('reject')).toEqual(['OWNER']);
  });

  it('POST :id/cancel → SALES/BM/OWNER (service ตรวจว่าเป็นผู้ขอหรือเจ้าของ)', async () => {
    await controller.cancel('adj-1', user);
    expect(service.cancel).toHaveBeenCalledWith('adj-1', user);
    expect(roles('cancel')).toEqual(['OWNER', 'BRANCH_MANAGER', 'SALES']);
  });

  it('GET lookup / preview → ผู้ขอ (SALES/BM/OWNER)', async () => {
    await controller.lookup('350000000000001', undefined, 'LOST', user);
    expect(service.lookupProduct).toHaveBeenCalledWith({ imei: '350000000000001', search: undefined, reason: 'LOST' }, user);
    await controller.preview('p1', 'WRITE_OFF', user);
    expect(service.preview).toHaveBeenCalledWith('p1', 'WRITE_OFF', user);
    expect(roles('lookup')).toEqual(['OWNER', 'BRANCH_MANAGER', 'SALES']);
    expect(roles('preview')).toEqual(['OWNER', 'BRANCH_MANAGER', 'SALES']);
  });

  it('GET preview เหตุผลผิดรูป → 400', async () => {
    await expect(controller.preview('p1', 'HACK', user)).rejects.toThrow(/เหตุผล/);
    expect(service.preview).not.toHaveBeenCalled();
  });

  it('GET pending-count / list / :id → ทุก role ที่เห็นหน้าคลัง (รวม SALES) · summary ไม่รวม SALES', async () => {
    await controller.pendingCount(user);
    expect(service.pendingCount).toHaveBeenCalledWith(user);
    await controller.findAll(user, undefined, undefined, 'PENDING_APPROVAL', 'true');
    expect(service.findAll).toHaveBeenCalledWith(expect.objectContaining({ status: 'PENDING_APPROVAL', mine: true }), user);
    await controller.findOne('adj-1', user);
    expect(service.findOne).toHaveBeenCalledWith('adj-1', user);
    for (const m of ['pendingCount', 'findAll', 'findOne']) {
      expect(roles(m)).toEqual(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']);
    }
    expect(roles('getSummary')).toEqual(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']);
  });

  it('ทุก handler มี @Roles', () => {
    const handlers = Object.getOwnPropertyNames(StockAdjustmentsController.prototype).filter(
      (n) => n !== 'constructor' && typeof (StockAdjustmentsController.prototype as never)[n] === 'function',
    );
    expect(handlers.length).toBeGreaterThanOrEqual(10);
    for (const h of handlers) expect(roles(h)).toBeDefined();
  });
});
