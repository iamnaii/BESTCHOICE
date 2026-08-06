import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProductDto } from './update-product.dto';

/**
 * หน้าสินค้า B1 เขียน 6 ฟิลด์นี้ผ่าน PATCH /products/:id — ถ้า DTO ไม่รับ
 * (whitelist ตัดทิ้งเงียบ) ผู้ใช้จะกดบันทึกแล้วค่าไม่เปลี่ยนโดยไม่มี error.
 */
describe('UpdateProductDto — ฟิลด์ที่หน้าสินค้า B1 แก้', () => {
  it('รับ cashPrice/installmentPrice/conditionGrade/shopWarrantyDays/accessoriesIncluded/cosmeticNotes', async () => {
    const dto = plainToInstance(UpdateProductDto, {
      cashPrice: 15900,
      installmentPrice: 17900,
      conditionGrade: 'A',
      shopWarrantyDays: 30,
      accessoriesIncluded: ['สายชาร์จ', 'กล่อง'],
      cosmeticNotes: 'รอยขีดข่วนมุมล่างซ้าย',
    });
    const errors = await validate(dto);
    expect(errors).toEqual([]);
    expect(dto.cashPrice).toBe(15900);
    expect(dto.accessoriesIncluded).toEqual(['สายชาร์จ', 'กล่อง']);
  });

  it('ปฏิเสธ cashPrice ที่ไม่ใช่ตัวเลข', async () => {
    const dto = plainToInstance(UpdateProductDto, { cashPrice: 'ถูกมาก' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('cashPrice');
  });

  it('ปฏิเสธ cosmeticNotes ยาวเกิน 500 ตัวอักษร', async () => {
    const dto = plainToInstance(UpdateProductDto, { cosmeticNotes: 'ก'.repeat(501) });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('cosmeticNotes');
  });

  // เพิ่มเติมนอกเหนือ brief — ปิด edge cases ที่ B0 มีอยู่แล้ว (3 สถานะ + ฟิลด์ที่เหลือ)
  // และปิดช่องโหว่ที่การแก้ accessoriesIncluded จาก Record → string[] อาจพลาด (object เก่าต้อง reject)

  it('รับ cashPrice/installmentPrice เป็น null (ล้างราคา — สถานะที่ 3 นอกเหนือ undefined/value)', async () => {
    const dto = plainToInstance(UpdateProductDto, { cashPrice: null, installmentPrice: null });
    const errors = await validate(dto);
    expect(errors).toEqual([]);
    expect(dto.cashPrice).toBeNull();
    expect(dto.installmentPrice).toBeNull();
  });

  it('ปฏิเสธ cashPrice ที่น้อยกว่า 1 (0 หรือติดลบ)', async () => {
    const dto = plainToInstance(UpdateProductDto, { cashPrice: 0 });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('cashPrice');
  });

  it('ปฏิเสธ conditionGrade ที่ไม่ใช่ A/B/C/D', async () => {
    const dto = plainToInstance(UpdateProductDto, { conditionGrade: 'S' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('conditionGrade');
  });

  it('ปฏิเสธ shopWarrantyDays ติดลบ', async () => {
    const dto = plainToInstance(UpdateProductDto, { shopWarrantyDays: -1 });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('shopWarrantyDays');
  });

  it('ปฏิเสธ shopWarrantyDays ที่ไม่ใช่จำนวนเต็ม', async () => {
    const dto = plainToInstance(UpdateProductDto, { shopWarrantyDays: 1.5 });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('shopWarrantyDays');
  });

  it('รับ accessoriesIncluded เป็น array ว่าง (ล้างรายการอุปกรณ์ — ตั้งใจให้ทำได้)', async () => {
    const dto = plainToInstance(UpdateProductDto, { accessoriesIncluded: [] });
    const errors = await validate(dto);
    expect(errors).toEqual([]);
    expect(dto.accessoriesIncluded).toEqual([]);
  });

  it('ปฏิเสธ accessoriesIncluded ที่เป็น object แทน array (B0 เดิมเคยรับ — พลิกเป็นปฏิเสธ)', async () => {
    const dto = plainToInstance(UpdateProductDto, {
      accessoriesIncluded: { charger: true, box: true },
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('accessoriesIncluded');
  });

  it('ปฏิเสธ accessoriesIncluded ที่มี element ไม่ใช่ string', async () => {
    const dto = plainToInstance(UpdateProductDto, { accessoriesIncluded: ['สายชาร์จ', 123] });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('accessoriesIncluded');
  });

  it('ทุกฟิลด์เป็น optional — ไม่ส่งอะไรมาเลยต้องผ่าน', async () => {
    const dto = plainToInstance(UpdateProductDto, {});
    const errors = await validate(dto);
    expect(errors).toEqual([]);
  });
});
