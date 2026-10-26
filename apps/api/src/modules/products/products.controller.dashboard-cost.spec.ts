import { Test } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsPricingService } from './products-pricing.service';
import { ProductsStockService } from './products-stock.service';
import { ProductsOnlineListingService } from './products-online-listing.service';
import { ProductScanService } from './services/product-scan.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';

/**
 * GET /products/stock/dashboard เคยส่งต้นทุนให้ SALES ทั้งก้อน (aging value =
 * Σ costPrice, valueByStatus, breakdown value, slowMovers.costPrice,
 * marginOverview) เพราะ endpoint นี้ถูกเพิ่มทีหลังโดยไม่ผ่าน canSeeCost
 * เหมือนพี่น้อง GET /products/stock — owner decision 2026-08-04 §1.4:
 * SALES ต้องไม่เห็นราคาทุน/กำไร และต้องบังคับที่ฝั่ง server.
 */
describe('ProductsController — GET /products/stock/dashboard cost visibility', () => {
  const dashboard = () => ({
    stockAging: [
      { label: '0-30 วัน', min: 0, max: 30, count: 2, value: 24000 },
      { label: '90+ วัน', min: 91, max: Infinity, count: 1, value: 9000 },
    ],
    actionRequired: { inspection: 0, qcPending: 1, photoPending: 0, pendingTransfers: 0, repossessed: 0, agingOver90: 1 },
    valueByStatus: [{ status: 'IN_STOCK', count: 3, value: 33000 }],
    byCategory: [{ name: 'PHONE_NEW', count: 3, value: 33000 }],
    byBrand: [{ name: 'Apple', count: 3, value: 33000 }],
    byColor: [{ name: 'Black', count: 3, value: 33000 }],
    byStorage: [{ name: '128GB', count: 3, value: 33000 }],
    stockMovement: [{ month: 'ต.ค. 69', in: 3, out: 1 }],
    stockTurnover: { avgDaysInStock: 40, soldThisMonth: 1, soldLastMonth: 0, currentStock: 3 },
    topSellers: [{ name: 'Apple iPhone 13', count: 1 }],
    slowMovers: [{ name: 'Apple iPhone 13', days: 95, costPrice: 9000 }],
    marginOverview: { totalCost: 33000, totalSell: 45000, totalMargin: 12000, avgMarginPct: 36, avgMarginPerUnit: 4000, itemsWithPrice: 3 },
  });
  let controller: ProductsController;
  let stock: { getStockDashboard: jest.Mock };

  beforeEach(async () => {
    stock = { getStockDashboard: jest.fn().mockResolvedValue(dashboard()) };
    const module = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: {} },
        { provide: ProductsPricingService, useValue: {} },
        { provide: ProductsStockService, useValue: stock },
        { provide: ProductsOnlineListingService, useValue: {} },
        // POS scan (#1727) added a 5th controller dependency — stub it so this DI graph still resolves.
        { provide: ProductScanService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(ProductsController);
  });

  const sales = { role: 'SALES', branchId: 'b-1' };
  const owner = { role: 'OWNER', branchId: null };

  it('SALES — ทุกตัวเลขที่คิดจาก costPrice ถูกตัดออก แต่ count/วัน/การเคลื่อนไหวยังครบ', async () => {
    const res = await controller.getStockDashboard(sales, 'b-1');
    expect(stock.getStockDashboard).toHaveBeenCalledWith('b-1');

    expect(res.stockAging.map((b) => b.value)).toEqual([null, null]);
    expect(res.stockAging.map((b) => b.count)).toEqual([2, 1]);
    expect(res.valueByStatus[0]).toEqual({ status: 'IN_STOCK', count: 3, value: null });
    for (const key of ['byCategory', 'byBrand', 'byColor', 'byStorage'] as const) {
      expect(res[key][0].value).toBeNull();
      expect(res[key][0].count).toBe(3);
    }
    expect(res.slowMovers[0]).not.toHaveProperty('costPrice');
    expect(res.slowMovers[0]).toMatchObject({ name: 'Apple iPhone 13', days: 95 });
    expect(res.marginOverview).toBeNull();

    expect(res.actionRequired.agingOver90).toBe(1);
    expect(res.stockTurnover).toEqual({ avgDaysInStock: 40, soldThisMonth: 1, soldLastMonth: 0, currentStock: 3 });
    expect(res.stockMovement).toEqual([{ month: 'ต.ค. 69', in: 3, out: 1 }]);
    expect(res.topSellers).toEqual([{ name: 'Apple iPhone 13', count: 1 }]);
  });

  it('OWNER — ได้ก้อนเดิมครบ ไม่ถูกแตะ', async () => {
    const res = await controller.getStockDashboard(owner, undefined);
    expect(res).toEqual(dashboard());
  });

  it('endpoint ยังเปิดให้ SALES เข้า (ตัดเฉพาะต้นทุน ไม่ได้ปิดหน้า)', () => {
    const roles = Reflect.getMetadata('roles', ProductsController.prototype.getStockDashboard);
    expect(roles).toContain('SALES');
  });
});
