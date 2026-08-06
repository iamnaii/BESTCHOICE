import { Test } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsPricingService } from './products-pricing.service';
import { ProductsStockService } from './products-stock.service';
import { ProductsOnlineListingService } from './products-online-listing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';

/**
 * Owner decision 2026-08-04 §1.4: ซ่อนราคาทุน/กำไรจาก SALES ต้องบังคับที่ฝั่ง
 * server ไม่ใช่แค่ซ่อน DOM. precedent = staff-chat.controller.ts:126-135
 * (SALES → nationalId: null).
 */
describe('ProductsController — cost visibility by role', () => {
  const productRow = { id: 'p-1', name: 'iPhone 13', costPrice: '12000', cashPrice: '15900' };
  let controller: ProductsController;
  let products: { findAll: jest.Mock; findOne: jest.Mock };
  let stock: { getStock: jest.Mock };

  beforeEach(async () => {
    products = {
      findAll: jest.fn().mockResolvedValue({
        data: [{ ...productRow }],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      }),
      findOne: jest.fn().mockResolvedValue({ ...productRow }),
    };
    stock = {
      getStock: jest.fn().mockResolvedValue({
        products: [{ ...productRow }],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
        summary: [{ branch: { id: 'b-1', name: 'ลาดพร้าว' }, total: 3, inStock: 2, totalValue: 24000 }],
      }),
    };

    const module = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: products },
        { provide: ProductsPricingService, useValue: {} },
        { provide: ProductsStockService, useValue: stock },
        { provide: ProductsOnlineListingService, useValue: {} },
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

  it('GET /products — SALES ไม่ได้ costPrice, ฟิลด์อื่นครบ', async () => {
    const res = await controller.findAll({ page: 1, limit: 50 }, sales);
    expect(res.data[0]).not.toHaveProperty('costPrice');
    expect(res.data[0].cashPrice).toBe('15900');
    expect(res.total).toBe(1);
  });

  it('GET /products — OWNER ยังได้ costPrice', async () => {
    const res = await controller.findAll({ page: 1, limit: 50 }, owner);
    expect(res.data[0]).toHaveProperty('costPrice', '12000');
  });

  it('GET /products/:id — SALES ไม่ได้ costPrice / OWNER ได้', async () => {
    expect(await controller.findOne('p-1', sales)).not.toHaveProperty('costPrice');
    expect(await controller.findOne('p-1', owner)).toHaveProperty('costPrice', '12000');
  });

  it('GET /products/stock — SALES ไม่ได้ costPrice และ summary.totalValue เป็น null', async () => {
    const res = await controller.getStock({ page: 1, limit: 50 }, sales);
    expect(res.products[0]).not.toHaveProperty('costPrice');
    expect(res.summary[0].totalValue).toBeNull();
    expect(res.summary[0].inStock).toBe(2);
  });

  it('GET /products/stock — OWNER ได้ทั้ง costPrice และ totalValue', async () => {
    const res = await controller.getStock({ page: 1, limit: 50 }, owner);
    expect(res.products[0]).toHaveProperty('costPrice', '12000');
    expect(res.summary[0].totalValue).toBe(24000);
  });
});
