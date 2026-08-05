import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ProductsService — คอลัมน์ราคา (B0)', () => {
  let service: ProductsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  beforeEach(async () => {
    tx = {
      product: {
        create: jest.fn().mockResolvedValue({ id: 'p1' }),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', deletedAt: null }),
      },
      productPrice: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'row-1' }),
        update: jest.fn().mockResolvedValue({ id: 'row-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pricingTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', deletedAt: null }) },
    };
    const module = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ProductsService);
  });

  it('create: เขียน cashPrice/installmentPrice เป็น Decimal ลงคอลัมน์', async () => {
    await service.create({
      name: 'iPhone 15', brand: 'Apple', model: '15', category: 'PHONE_NEW',
      costPrice: 15000, branchId: 'b1', cashPrice: 18000, installmentPrice: 20000,
    } as never);
    const data = tx.product.create.mock.calls[0][0].data;
    expect(data.cashPrice).toBeInstanceOf(Prisma.Decimal);
    expect(data.cashPrice.toString()).toBe('18000');
    expect(data.installmentPrice.toString()).toBe('20000');
  });

  it('create: write-through สร้างแถว ProductPrice ให้อัตโนมัติ', async () => {
    await service.create({
      name: 'iPhone 15', brand: 'Apple', model: '15', category: 'PHONE_NEW',
      costPrice: 15000, branchId: 'b1', cashPrice: 18000,
    } as never);
    // util สร้างแถวใหม่ด้วย isDefault:false ก่อนเสมอ (phase 1) แล้วค่อยปลด default เดิม +
    // ตั้งแถวนี้เป็น default ทีหลัง (phase 2) — ห้ามชนกับแถว default เก่าที่ยังไม่ถูกปลด
    expect(tx.productPrice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ label: 'ราคาเงินสด' }),
      }),
    );
    expect(tx.productPrice.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { isDefault: true },
    });
  });

  it('create: prices[] มี isDefault:true มากกว่า 1 รายการ → BadRequestException ภาษาไทย', async () => {
    await expect(
      service.create({
        name: 'iPhone 15', brand: 'Apple', model: '15', category: 'PHONE_NEW',
        costPrice: 15000, branchId: 'b1',
        prices: [
          { label: 'ราคา A', amount: 10000, isDefault: true },
          { label: 'ราคา B', amount: 12000, isDefault: true },
        ],
      } as never),
    ).rejects.toThrow(new BadRequestException('ตั้งราคา default ได้เพียงรายการเดียว'));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // Fix round 1 [Important]: guard เดิมนับเฉพาะ isDefault===true ตรงๆ พลาดเคส element 0
  // ที่ไม่ได้ระบุ isDefault แล้ว fallback เป็น true โดยปริยาย (`isDefault ?? (i===0)` ที่ :118)
  // payload นี้ reviewer reproduce แล้วว่าชน DB partial unique index เป็น P2002/500 ดิบ ถ้า
  // guard ไม่คำนวณ "effective default" หลัง apply fallback ก่อนนับ
  it('create: element แรกไม่ระบุ isDefault (fallback=true) + element ถัดไป isDefault:true ตรงๆ → BadRequestException ไทย เช่นกัน', async () => {
    await expect(
      service.create({
        name: 'iPhone 15', brand: 'Apple', model: '15', category: 'PHONE_NEW',
        costPrice: 15000, branchId: 'b1',
        prices: [
          { label: 'ราคาขาย', amount: 17000 },
          { label: 'ราคาโปร', amount: 15000, isDefault: true },
        ],
      } as never),
    ).rejects.toThrow(new BadRequestException('ตั้งราคา default ได้เพียงรายการเดียว'));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('create: element เดียวไม่ระบุ isDefault (fallback=true) → ผ่าน guard ปกติ', async () => {
    await expect(
      service.create({
        name: 'iPhone 15', brand: 'Apple', model: '15', category: 'PHONE_NEW',
        costPrice: 15000, branchId: 'b1',
        prices: [{ label: 'ราคาขาย', amount: 17000 }],
      } as never),
    ).resolves.toBeDefined();
  });

  // Fix round 1 [Minor]: accessoriesIncluded เป็น Json? column — ส่ง JS null ตรงๆ เขียนเป็น
  // JSON literal null (SQL column ไม่เป็น NULL จริง, `IS NULL` filter หาไม่เจอ) ต้องแปลงเป็น
  // Prisma.DbNull เมื่อต้องการเคลียร์คอลัมน์จริงๆ
  it('create: accessoriesIncluded: null → เขียนเป็น Prisma.DbNull (ไม่ใช่ JSON null)', async () => {
    await service.create({
      name: 'iPhone 15', brand: 'Apple', model: '15', category: 'PHONE_NEW',
      costPrice: 15000, branchId: 'b1', accessoriesIncluded: null,
    } as never);
    const data = tx.product.create.mock.calls[0][0].data;
    expect(data.accessoriesIncluded).toBe(Prisma.DbNull);
  });

  it('update: accessoriesIncluded: null → เขียนเป็น Prisma.DbNull (ไม่ใช่ JSON null)', async () => {
    await service.update('p1', { accessoriesIncluded: null } as never);
    const data = tx.product.update.mock.calls[0][0].data;
    expect(data.accessoriesIncluded).toBe(Prisma.DbNull);
  });

  it('update: แก้ราคามือ → เคลียร์ priceAutofilledAt เป็น null', async () => {
    await service.update('p1', { cashPrice: 19000 } as never);
    const data = tx.product.update.mock.calls[0][0].data;
    expect(data.priceAutofilledAt).toBeNull();
    expect(data.cashPrice.toString()).toBe('19000');
  });

  it('update: ไม่แตะราคา → ไม่เคลียร์ priceAutofilledAt', async () => {
    await service.update('p1', { cosmeticNotes: 'มีรอยขอบล่าง' } as never);
    const data = tx.product.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('priceAutofilledAt');
    expect(tx.productPrice.create).not.toHaveBeenCalled();
  });

  // BLOCKER regression: `new Prisma.Decimal(null)` throw ภายใน $transaction
  // → rollback การแก้ฟิลด์อื่นทั้งคำขอ (ฟอร์มของ B1 กดล้างราคาแล้ว 500)
  it('update: ส่ง cashPrice: null → เคลียร์คอลัมน์ ไม่ throw และไม่ลบแถวราคาเดิม', async () => {
    await expect(
      service.update('p1', { cashPrice: null, cosmeticNotes: 'ไม่ระบุราคา' } as never),
    ).resolves.toBeDefined();
    const data = tx.product.update.mock.calls[0][0].data;
    expect(data.cashPrice).toBeNull();
    expect(data.priceAutofilledAt).toBeNull(); // null ก็นับว่า "แตะราคา"
    // util ข้ามฟิลด์ที่เป็น null → ไม่สร้าง/ไม่ลบแถว
    expect(tx.productPrice.create).not.toHaveBeenCalled();
    expect(tx.productPrice.update).not.toHaveBeenCalled();
  });
});
