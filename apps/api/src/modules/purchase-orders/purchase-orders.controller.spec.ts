import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RecordSupplierPaymentDto, SupplierLedgerQueryDto, VoidSupplierPaymentDto } from './dto/supplier-payment.dto';

/**
 * ก้อน 2 — endpoint จ่ายเงินผู้จัดจำหน่าย: สิทธิ์ตามคำตัดสินเจ้าของ 2026-10-05 (บันทึก = OWNER+BM · ยกเลิกรายการ = OWNER)
 * + DTO กันค่าผิดก่อนถึง service
 */
describe('PurchaseOrdersController — จ่ายเงินผู้จัดจำหน่าย', () => {
  let controller: PurchaseOrdersController;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;

  beforeEach(async () => {
    service = {
      recordSupplierPayment: jest.fn().mockResolvedValue({ payments: [] }),
      voidSupplierPayment: jest.fn().mockResolvedValue({}),
      listSupplierPayments: jest.fn().mockResolvedValue({ summary: {}, payments: [] }),
      getSupplierLedger: jest.fn().mockResolvedValue({ suppliers: [] }),
      getSupplierLedgerMovements: jest.fn().mockResolvedValue({ rows: [] }),
      cancel: jest.fn().mockResolvedValue({}),
    };
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [PurchaseOrdersController],
      providers: [{ provide: PurchaseOrdersService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard).useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(PurchaseOrdersController);
  });

  const roles = (method: string) => Reflect.getMetadata(ROLES_KEY, (PurchaseOrdersController.prototype as never)[method]);

  it('POST :id/payments → บันทึกจ่าย (OWNER + BRANCH_MANAGER) ส่งผู้กดไปด้วย', async () => {
    const dto = { paidAt: '2026-10-05', amount: 10729, slipUrl: 'data:image/png;base64,x', reference: 'TXN', note: 'งวดสุดท้าย' };
    await controller.recordSupplierPayment('po-1', dto as never, { id: 'bm-1' });
    expect(service.recordSupplierPayment).toHaveBeenCalledWith('po-1', dto, 'bm-1');
    expect(roles('recordSupplierPayment')).toEqual(['OWNER', 'BRANCH_MANAGER']);
  });

  it('POST :id/payments/:paymentId/void → เจ้าของเท่านั้น พร้อมเหตุผล', async () => {
    await controller.voidSupplierPayment('po-1', 'pay-1', { reason: 'กรอกยอดผิด' } as never, { id: 'owner-1' });
    expect(service.voidSupplierPayment).toHaveBeenCalledWith('po-1', 'pay-1', 'owner-1', 'กรอกยอดผิด');
    expect(roles('voidSupplierPayment')).toEqual(['OWNER']);
  });

  it('GET :id/payments และ GET payables/ledger → อ่านได้ถึงบัญชี', async () => {
    await controller.listSupplierPayments('po-1');
    expect(service.listSupplierPayments).toHaveBeenCalledWith('po-1');
    await controller.getSupplierLedger({ month: '2026-10' } as never);
    expect(service.getSupplierLedger).toHaveBeenCalledWith('2026-10');
    await controller.getSupplierLedgerMovements('sup-1', { month: '2026-10' } as never);
    expect(service.getSupplierLedgerMovements).toHaveBeenCalledWith('sup-1', '2026-10');
    for (const method of ['listSupplierPayments', 'getSupplierLedger', 'getSupplierLedgerMovements']) {
      expect(roles(method)).toEqual(expect.arrayContaining(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']));
    }
  });

  it('POST :id/cancel ส่งผลมัดจำต่อเมื่อระบุ', async () => {
    await controller.cancel('po-1', { depositOutcome: 'FORFEITED', reason: 'ริบ' } as never, { id: 'owner-1' });
    expect(service.cancel).toHaveBeenCalledWith('po-1', 'owner-1', { depositOutcome: 'FORFEITED', reason: 'ริบ' });
    await controller.cancel('po-2', {} as never, { id: 'owner-1' });
    expect(service.cancel).toHaveBeenLastCalledWith('po-2', 'owner-1', undefined);
  });

  describe('DTO', () => {
    const errorsOf = async (cls: new () => object, body: object) => (await validate(plainToInstance(cls, body))).map((e) => e.property);

    it('RecordSupplierPaymentDto: วันที่ต้อง YYYY-MM-DD · จำนวน > 0 · สลิปบังคับ', async () => {
      expect(await errorsOf(RecordSupplierPaymentDto, { paidAt: '2026-10-05', amount: 100, slipUrl: 'data:x' })).toEqual([]);
      expect(await errorsOf(RecordSupplierPaymentDto, { paidAt: '05/10/2569', amount: 100, slipUrl: 'data:x' })).toContain('paidAt');
      expect(await errorsOf(RecordSupplierPaymentDto, { paidAt: '2026-10-05', amount: 0, slipUrl: 'data:x' })).toContain('amount');
      expect(await errorsOf(RecordSupplierPaymentDto, { paidAt: '2026-10-05', amount: 100 })).toContain('slipUrl');
      expect(await errorsOf(RecordSupplierPaymentDto, { paidAt: '2026-10-05', amount: 100, slipUrl: '' })).toContain('slipUrl');
    });

    it('VoidSupplierPaymentDto: เหตุผลบังคับ · SupplierLedgerQueryDto: เดือน YYYY-MM หรือว่าง', async () => {
      expect(await errorsOf(VoidSupplierPaymentDto, { reason: 'กรอกผิด' })).toEqual([]);
      expect(await errorsOf(VoidSupplierPaymentDto, { reason: '' })).toContain('reason');
      expect(await errorsOf(SupplierLedgerQueryDto, {})).toEqual([]);
      expect(await errorsOf(SupplierLedgerQueryDto, { month: '2026-10' })).toEqual([]);
      expect(await errorsOf(SupplierLedgerQueryDto, { month: '10/2569' })).toContain('month');
    });
  });
});
