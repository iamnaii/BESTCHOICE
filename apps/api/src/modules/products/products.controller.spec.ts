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
  const transferRow = {
    id: 't-1',
    status: 'PENDING',
    product: { id: 'p-1', name: 'iPhone 13', model: 'A2482', costPrice: '12000' },
  };
  let controller: ProductsController;
  let products: { findAll: jest.Mock; findOne: jest.Mock };
  let stock: { getStock: jest.Mock; reserve: jest.Mock; unreserve: jest.Mock; getTransferById: jest.Mock };

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
      // reserve/unreserve return the raw updated Product (Prisma `include:`, not
      // `select:`) — costPrice comes back as a scalar just like findOne/findAll.
      reserve: jest.fn().mockResolvedValue({ ...productRow, status: 'RESERVED' }),
      unreserve: jest.fn().mockResolvedValue({ ...productRow, status: 'IN_STOCK' }),
      // getTransferById nests costPrice under `product` (Prisma `select`) —
      // different shape from the other 4 endpoints, must strip at the nested key.
      getTransferById: jest.fn().mockResolvedValue({ ...transferRow, product: { ...transferRow.product } }),
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

  /**
   * Fix round 1/5 (reviewer 2026-08-06): reserve/unreserve/getTransferById
   * leaked costPrice to SALES even after the first pass — they weren't in the
   * original brief's 3-endpoint list but SALES has @Roles access to all 3 and
   * their services return raw Product rows (reserve/unreserve) or a Product
   * nested under `product` (getTransferById).
   */
  it('POST /products/:id/reserve — SALES ไม่ได้ costPrice', async () => {
    const res = await controller.reserve('p-1', { reason: 'ลูกค้าจะมาซื้อ' }, sales);
    expect(res).not.toHaveProperty('costPrice');
    expect(res).toHaveProperty('status', 'RESERVED');
  });

  it('POST /products/:id/reserve — OWNER ยังได้ costPrice', async () => {
    const res = await controller.reserve('p-1', { reason: 'ลูกค้าจะมาซื้อ' }, owner);
    expect(res).toHaveProperty('costPrice', '12000');
  });

  it('POST /products/:id/unreserve — SALES ไม่ได้ costPrice', async () => {
    const res = await controller.unreserve('p-1', sales);
    expect(res).not.toHaveProperty('costPrice');
    expect(res).toHaveProperty('status', 'IN_STOCK');
  });

  it('POST /products/:id/unreserve — OWNER ยังได้ costPrice', async () => {
    const res = await controller.unreserve('p-1', owner);
    expect(res).toHaveProperty('costPrice', '12000');
  });

  it('GET /products/transfers/:transferId — SALES ไม่ได้ costPrice (nested ใต้ product)', async () => {
    const res = await controller.getTransferById('t-1', sales);
    expect(res.product).not.toHaveProperty('costPrice');
    expect(res.product).toHaveProperty('model', 'A2482');
    expect(res).toHaveProperty('status', 'PENDING');
  });

  it('GET /products/transfers/:transferId — OWNER ยังได้ costPrice (nested ใต้ product)', async () => {
    const res = await controller.getTransferById('t-1', owner);
    expect(res.product).toHaveProperty('costPrice', '12000');
  });
});

/**
 * Phase 5 Task 3 — `POST /products/:id/return-to-stock`
 * (นำเครื่องมือสองที่รับคืนกลับเข้าคลังพร้อมขาย)
 */
describe('ProductsController.returnToStock — สิทธิ์ + การส่งต่อ userId/note', () => {
  let controller: ProductsController;
  let products: { returnToStock: jest.Mock };

  beforeEach(async () => {
    products = {
      returnToStock: jest.fn().mockResolvedValue({ id: 'p-1', status: 'IN_STOCK' }),
    };
    const module = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: products },
        { provide: ProductsPricingService, useValue: {} },
        { provide: ProductsStockService, useValue: {} },
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

  it('ส่ง id + userId ของผู้กด + note ต่อให้ service (audit ต้องรู้ว่าใครยืนยัน)', async () => {
    const res = await controller.returnToStock(
      'p-1',
      { note: 'ตรวจสภาพแล้ว' },
      { id: 'user-9' },
    );
    expect(products.returnToStock).toHaveBeenCalledWith('p-1', 'user-9', 'ตรวจสภาพแล้ว');
    expect(res).toHaveProperty('status', 'IN_STOCK');
  });

  it('เปิดให้เฉพาะ OWNER กับ BRANCH_MANAGER', () => {
    const roles = Reflect.getMetadata('roles', ProductsController.prototype.returnToStock);
    expect(roles).toEqual(['OWNER', 'BRANCH_MANAGER']);
  });
});
