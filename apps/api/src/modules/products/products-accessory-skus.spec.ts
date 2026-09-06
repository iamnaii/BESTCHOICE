import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * GET /products/accessory-skus — one row per accessory "SKU" (grouped by name) so a PO can
 * re-order an existing accessory by its old Tooltify code (F1601, CCCT01 — stored in
 * Product.accessoryType by the importer) or by name. Rows carry the raw fields the PO line
 * copies (accessoryType / accessoryBrand / model) plus stock + last cost for the picker.
 */
describe('ProductsService.findAccessorySkus', () => {
  let service: ProductsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ProductsService);
  });

  it('maps grouped rows: imported code → code, PO-created label → no code, numbers as numbers', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { name: 'ฟิล์มกระจก iPhone 16 - iStar', accessory_type: 'F1601', accessory_brand: 'iStar', model: 'ฟิล์มกระจก iPhone 16 - iStar', in_stock: 13n, last_cost: '35.00' },
      { name: 'เคส Spigen สำหรับ iPhone 16 Pro', accessory_type: 'เคส', accessory_brand: 'Spigen', model: 'iPhone 16 Pro', in_stock: 0n, last_cost: '150.00' },
    ]);
    const rows = await service.findAccessorySkus('16');
    expect(rows).toEqual([
      { code: 'F1601', name: 'ฟิล์มกระจก iPhone 16 - iStar', accessoryType: 'F1601', accessoryBrand: 'iStar', model: 'ฟิล์มกระจก iPhone 16 - iStar', inStock: 13, lastCost: 35 },
      { code: null, name: 'เคส Spigen สำหรับ iPhone 16 Pro', accessoryType: 'เคส', accessoryBrand: 'Spigen', model: 'iPhone 16 Pro', inStock: 0, lastCost: 150 },
    ]);
  });

  it('searches name and code with a contains pattern, capped at the limit', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await service.findAccessorySkus('  f16 ', 5);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = prisma.$queryRaw.mock.calls[0][0];
    // Prisma.sql template: values carry the bound parameters
    expect(sql.values).toEqual(expect.arrayContaining(['%f16%', 5]));
  });

  it('empty search lists every SKU (still capped)', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await service.findAccessorySkus('');
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.values).toEqual(expect.arrayContaining(['%%', 20]));
  });
});
