import { BadRequestException } from '@nestjs/common';
import { CreatePricingTemplateDto } from './dto/pricing-template.dto';
import { PricingTemplatesService } from './pricing-templates.service';

describe('pricing templates by device origin', () => {
  const db = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    pricingTemplate: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const service = new PricingTemplatesService(db as never, { log: jest.fn() } as never);
  beforeEach(() => {
    jest.resetAllMocks();
    db.$transaction.mockImplementation((work) => work(db));
  });
  it('เครื่องนอกไม่มีแถวของตัวเอง → ถอยไปแถว "ไม่ระบุ" แต่ไม่ข้ามไปเครื่องไทย (สเปค 7.1)', async () => {
    db.pricingTemplate.findFirst.mockResolvedValue(null);
    expect(
      await service.lookup('Apple', 'iPhone 15', '128GB', 'PHONE_USED', false, 'IMPORTED'),
    ).toBeNull();
    expect(
      db.pricingTemplate.findFirst.mock.calls.map(([args]) => [args.where.deviceOrigin, args.where.storage]),
    ).toEqual([
      ['IMPORTED', '128GB'],
      ['IMPORTED', ''],
      ['UNSPECIFIED', '128GB'],
      ['UNSPECIFIED', ''],
    ]);
  });

  it('เครื่องไทยไม่มีแถวของตัวเอง → คืนแถว "ไม่ระบุ"', async () => {
    const unspecified = { id: 'u1', deviceOrigin: 'UNSPECIFIED' };
    db.pricingTemplate.findFirst.mockImplementation(async ({ where }) =>
      where.deviceOrigin === 'UNSPECIFIED' && where.storage === '128GB' ? unspecified : null,
    );
    expect(await service.lookup('Apple', 'iPhone 15', '128GB', 'PHONE_NEW', null, 'THAI')).toBe(
      unspecified,
    );
  });

  it('ขอแถว "ไม่ระบุ" ตรง ๆ → ไม่ค้นแถวของเครื่องไทย/นอก', async () => {
    db.pricingTemplate.findFirst.mockResolvedValue(null);
    await service.lookup('Apple', 'iPhone 15', null, 'PHONE_NEW', null);
    expect(db.pricingTemplate.findFirst.mock.calls.map(([args]) => args.where.deviceOrigin)).toEqual([
      'UNSPECIFIED',
    ]);
  });

  it('stores origin and keeps legacy imports unspecified', async () => {
    const item = {
      brand: 'Apple',
      model: 'iPhone 15',
      category: 'PHONE_NEW' as CreatePricingTemplateDto['category'],
      cashPrice: 20000,
      installmentBestchoicePrice: 22000,
      installmentFinancePrice: 21000,
    };
    await service.create({ ...item, deviceOrigin: 'THAI' });
    expect(db.pricingTemplate.create.mock.calls[0][0].data.deviceOrigin).toBe('THAI');
    await service.bulkImport([item, { ...item, deviceOrigin: 'IMPORTED' }]);
    expect(
      db.pricingTemplate.upsert.mock.calls.map(
        ([args]) => args.where.brand_model_storage_category_hasWarranty_deviceOrigin.deviceOrigin,
      ),
    ).toEqual(['UNSPECIFIED', 'IMPORTED']);
  });
  const ITEM = {
    brand: 'Apple',
    model: 'iPhone 17 Pro',
    storage: '256GB',
    category: 'PHONE_NEW' as CreatePricingTemplateDto['category'],
    cashPrice: 39000,
    installmentBestchoicePrice: 39000,
    installmentFinancePrice: 39000,
  };

  it('นำเข้าเขียนงวด/ดาวน์จากไฟล์ทั้งตอนสร้างและตอนแก้ · ช่องว่าง = null (สเปค 7.4)', async () => {
    await service.bulkImport([
      { ...ITEM, rate1TermMonths: 12, rate1DownPayment: 15000, rate2TermMonths: 15 },
      { ...ITEM, model: 'iPhone 16' },
    ]);
    const [first, second] = db.pricingTemplate.upsert.mock.calls.map(([args]) => args);
    expect(first.update).toMatchObject({ rate1TermMonths: 12, rate1DownPayment: 15000, rate2TermMonths: 15, isActive: true });
    expect(first.create).toMatchObject({ rate1TermMonths: 12, rate1DownPayment: 15000, rate2TermMonths: 15 });
    expect(second.update).toMatchObject({ rate1TermMonths: null, rate1DownPayment: null, rate2TermMonths: null });
    expect(first.update).not.toHaveProperty('rate2DownPayment');
  });

  it('ปิดแถวที่เปิดใช้อยู่แต่ไม่อยู่ในไฟล์ตาม id ที่ส่งมา', async () => {
    db.pricingTemplate.updateMany.mockResolvedValue({ count: 2 });
    const result = await service.bulkImport([], ['a', 'b']);
    expect(db.pricingTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, isActive: true, deletedAt: null },
      data: { isActive: false },
    });
    expect(result).toEqual({ success: 0, skipped: 0, errors: [], deactivated: 2 });
  });

  it('id ที่ถูกนำเข้าในคำขอเดียวกันไม่ถูกปิด · ไม่นับใน deactivated', async () => {
    db.pricingTemplate.upsert.mockResolvedValue({ id: 'a' });
    db.pricingTemplate.updateMany.mockResolvedValue({ count: 1 });
    const result = await service.bulkImport([ITEM], ['a', 'b']);
    expect(db.pricingTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['b'] }, isActive: true, deletedAt: null },
      data: { isActive: false },
    });
    expect(result).toMatchObject({ success: 1, deactivated: 1 });
  });

  it('ทุก id ถูกนำเข้าในคำขอเดียวกัน → ไม่เรียก updateMany', async () => {
    db.pricingTemplate.findUnique.mockResolvedValue({ id: 'a', deletedAt: null });
    db.pricingTemplate.upsert.mockResolvedValue(undefined);
    const result = await service.bulkImport([ITEM], ['a']);
    expect(db.pricingTemplate.updateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deactivated: 0 });
  });

  it('deactivateIds ซ้ำ/ว่าง → รวมเหลือค่าเดียว และเพดาน 1000 นับเฉพาะที่ไม่ซ้ำ', async () => {
    db.pricingTemplate.updateMany.mockResolvedValue({ count: 2 });
    await service.bulkImport([], ['a', 'b', 'a', '', 'b']);
    expect(db.pricingTemplate.updateMany.mock.calls[0][0].where.id).toEqual({ in: ['a', 'b'] });
    const many = Array.from({ length: 1200 }, (_, i) => `id${i % 1000}`);
    await expect(service.bulkImport([], many)).resolves.toBeDefined();
  });

  it('ไม่ส่ง deactivateIds → ไม่ปิดแถวใด และผลรูปเดิม', async () => {
    const result = await service.bulkImport([ITEM]);
    expect(db.pricingTemplate.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ success: 1, skipped: 0, errors: [] });
  });

  it('deactivateIds ผิดรูป → 400', async () => {
    await expect(service.bulkImport([], 'a')).rejects.toThrow(BadRequestException);
    await expect(service.bulkImport([], [1])).rejects.toThrow(BadRequestException);
  });
});
