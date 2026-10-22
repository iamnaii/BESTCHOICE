import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ShopHomeController } from './shop-home.controller';
import { ShopHomeService } from './shop-home.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import type { ShopHomeResponse } from './shop-home.types';

/**
 * GET /shop-home — เปิดให้ครบ 5 บทบาท (อยู่นอก /dashboard ที่ปฏิเสธ SALES) แต่:
 * - บทบาทประจำสาขา (BM, SALES) ถูกบังคับสาขาตัวเองเสมอ ไม่มีสาขา → 403
 * - SALES ไม่ได้แถว PO_APPROVAL และถูกตัดต้นทุน/กำไรด้วย redactShopHome (owner decision 2026-08-04 §1.4)
 */
describe('ShopHomeController', () => {
  const full = (): ShopHomeResponse => ({
    generatedAt: '2026-10-22T01:12:00.000Z',
    branch: { id: null, name: 'ทุกสาขา' },
    today: {
      sales: { count: 6, netAmount: 48900, cash: 3, installment: 2, externalFinance: 1 },
      cashDrawer: { balance: 12450, closedToday: false, lastClosedAt: null },
      bookingsExpiringToday: { count: 2, depositTotal: 4000, reservedUnits: 2 },
      afterSales: { waitingPickup: 3, overdue: 1 },
    },
    watch: [
      { key: 'AGING_90', count: 7, severity: 'urgent', detail: null, costValue: 61200 },
      { key: 'PO_APPROVAL', count: 1, severity: 'info', detail: 'PO-2610-014', costValue: null },
    ],
    monthly: [{ month: '2026-10', sales: 384400, cost: 266000, grossProfit: 118400 }],
    thisMonth: { sales: 384400, salesMomPct: null, cost: 266000, grossProfit: 118400, grossMarginPct: 31, grossProfitMomPct: null },
    topSellers30d: { byModel: [], byCategory: [] },
    slowMovers: [{ name: 'Apple iPhone 14 Plus', days: 164, costPrice: 18900 }],
    stockAging: [{ label: '0-30 วัน', count: 21 }],
  });

  let controller: ShopHomeController;
  let service: { build: jest.Mock };

  beforeEach(async () => {
    service = { build: jest.fn().mockResolvedValue(full()) };
    const module = await Test.createTestingModule({
      controllers: [ShopHomeController],
      providers: [{ provide: ShopHomeService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(ShopHomeController);
  });

  const owner = { id: 'o', role: 'OWNER', branchId: null };
  const bm = { id: 'm', role: 'BRANCH_MANAGER', branchId: 'b-1' };
  const sales = { id: 's', role: 'SALES', branchId: 'b-1' };

  it('@Roles ครบ 5 บทบาทรวม SALES', () => {
    expect(Reflect.getMetadata('roles', ShopHomeController.prototype.get)).toEqual([
      'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES',
    ]);
  });

  it('OWNER ได้ response เต็ม และ branchId ส่งต่อตามที่ขอ', async () => {
    const res = await controller.get(owner, 'b-2');
    expect(service.build).toHaveBeenCalledWith(owner, 'b-2');
    expect(res).toEqual(full());
  });

  it('OWNER ไม่ส่ง branchId → ทุกสาขา (undefined)', async () => {
    await controller.get(owner, undefined);
    expect(service.build).toHaveBeenCalledWith(owner, undefined);
  });

  it('BRANCH_MANAGER และ SALES ถูกบังคับ branchId ของตัวเอง แม้ไม่ส่งหรือส่ง branchId อื่น', async () => {
    await controller.get(bm, 'b-9');
    expect(service.build).toHaveBeenLastCalledWith(bm, 'b-1');
    await controller.get(sales, undefined);
    expect(service.build).toHaveBeenLastCalledWith(sales, 'b-1');
  });

  it('SALES ที่ไม่มีสาขาผูก → ForbiddenException และไม่เรียก service', async () => {
    await expect(controller.get({ id: 's', role: 'SALES', branchId: null }, undefined)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.build).not.toHaveBeenCalled();
  });

  it('SALES ได้ response ที่ผ่าน redactShopHome และไม่มีแถว PO_APPROVAL', async () => {
    const res = await controller.get(sales, undefined);
    expect(res.watch.map((w) => w.key)).toEqual(['AGING_90']);
    expect(res.watch[0].costValue).toBeNull();
    expect(res.monthly[0]).toEqual({ month: '2026-10', sales: 384400, cost: null, grossProfit: null });
    expect(res.thisMonth.cost).toBeNull();
    expect(res.slowMovers[0]).not.toHaveProperty('costPrice');
    expect(res.today.sales.netAmount).toBe(48900);
  });

  it('OWNER ยังได้แถว PO_APPROVAL และต้นทุนครบ', async () => {
    const res = await controller.get(owner, undefined);
    expect(res.watch.map((w) => w.key)).toEqual(['AGING_90', 'PO_APPROVAL']);
    expect(res.slowMovers[0]).toHaveProperty('costPrice', 18900);
  });
});
