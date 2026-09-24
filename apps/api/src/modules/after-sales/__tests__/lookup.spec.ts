import { HttpException, NotFoundException } from '@nestjs/common';
import { AfterSalesLookupService } from '../services/after-sales-lookup.service';

describe('AfterSalesLookupService.lookup', () => {
  const repair = { lookupByImei: jest.fn() };
  const defect = { checkEligibility: jest.fn() };
  const photos = { getPhotos: jest.fn().mockResolvedValue({ applicable: false }) };
  const prisma = {
    afterSalesCase: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const svc = new AfterSalesLookupService(
    prisma as never,
    repair as never,
    defect as never,
    photos as never,
  );
  const user = { id: 'user-1', role: 'SALES', branchId: 'branch-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    photos.getPhotos.mockResolvedValue({ applicable: false });
    prisma.afterSalesCase.findFirst.mockResolvedValue(null);
    prisma.afterSalesCase.updateMany.mockResolvedValue({ count: 1 });
  });

  it('ไม่พบ IMEI → source WALK_IN ทางออกเดียว (REPAIR) ไม่เรียก checkEligibility/getPhotos', async () => {
    repair.lookupByImei.mockResolvedValue({ found: false });

    const result = await svc.lookup({ imei: '000000000000000' }, user);

    expect(result.found).toBe(false);
    expect(result.source).toBe('WALK_IN');
    expect(result.warranty.status).toBe('WALK_IN');
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].outcome).toBe('REPAIR');
    expect(defect.checkEligibility).not.toHaveBeenCalled();
    expect(photos.getPhotos).not.toHaveBeenCalled();
  });

  it('พบ+มีสัญญา → เรียก checkEligibility และ getPhotos แล้วได้ 3 ทางออก', async () => {
    repair.lookupByImei.mockResolvedValue({
      found: true,
      product: {
        id: 'product-1',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
        imeiSerial: '359123456789012',
        category: 'PHONE_USED',
      },
      sale: null,
      customer: { id: 'customer-1', name: 'คุณทดสอบ', phone: '0812345678' },
      contract: { id: 'contract-1', contractNumber: 'CT-0001', status: 'ACTIVE' },
      warrantyStatus: 'IN_7DAY_DEFECT',
      daysRemainingIn7Day: 2,
      purchasedAt: new Date('2026-09-20T00:00:00.000Z'),
      shopWarrantyEndDate: null,
      manufacturerWarrantyEndDate: null,
    });
    defect.checkEligibility.mockResolvedValue({ eligible: true, reasons: [] });

    const result = await svc.lookup({ imei: '359123456789012' }, user);

    expect(result.source).toBe('INSTALLMENT_CONTRACT');
    expect(result.warranty.status).toBe('IN_7DAY_DEFECT');
    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.map((o) => o.outcome)).toEqual([
      'REPAIR',
      'SAME_MODEL_EXCHANGE',
      'PRICED_EXCHANGE',
    ]);
    expect(defect.checkEligibility).toHaveBeenCalledWith('contract-1');
    expect(photos.getPhotos).toHaveBeenCalledWith('product-1');
  });

  it('พบเครื่องแต่ไม่มี sale/contract → source WALK_IN และ warranty.status=WALK_IN แม้ lookupByImei คืนสถานะอื่น', async () => {
    repair.lookupByImei.mockResolvedValue({
      found: true,
      product: {
        id: 'product-2',
        brand: 'Samsung',
        model: 'Galaxy S21',
        storage: '256GB',
        imeiSerial: '359000111222333',
        category: 'PHONE_USED',
      },
      sale: null,
      customer: null,
      contract: null,
      // detectWarrantyStatus คืนค่านี้เพราะ product ที่พบทำให้เงื่อนไข walk-in ของมันไม่เข้า —
      // service ต้อง override เป็น WALK_IN เอง (Review Focus 1)
      warrantyStatus: 'OUT_OF_WARRANTY',
      daysRemainingIn7Day: 0,
      purchasedAt: null,
      shopWarrantyEndDate: null,
      manufacturerWarrantyEndDate: null,
    });

    const result = await svc.lookup({ imei: '359000111222333' }, user);

    expect(result.source).toBe('WALK_IN');
    expect(result.warranty.status).toBe('WALK_IN');
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].outcome).toBe('REPAIR');
    expect(defect.checkEligibility).not.toHaveBeenCalled();
    expect(photos.getPhotos).toHaveBeenCalledWith('product-2');
  });

  it('พบ+มีใบขายสด ไม่มีสัญญา → source CASH_SALE ไม่เรียก checkEligibility แต่เรียก getPhotos', async () => {
    repair.lookupByImei.mockResolvedValue({
      found: true,
      product: {
        id: 'product-3',
        brand: 'Apple',
        model: 'iPhone 14',
        storage: '256GB',
        imeiSerial: '359555666777888',
        category: 'PHONE_USED',
      },
      sale: { id: 's1', saleType: 'CASH' },
      customer: { id: 'customer-3', name: 'คุณเงินสด', phone: '0899999999' },
      contract: null,
      warrantyStatus: 'IN_7DAY_DEFECT',
      daysRemainingIn7Day: 3,
      purchasedAt: new Date('2026-09-21T00:00:00.000Z'),
      shopWarrantyEndDate: null,
      manufacturerWarrantyEndDate: null,
    });

    const result = await svc.lookup({ imei: '359555666777888' }, user);

    expect(result.source).toBe('CASH_SALE');
    expect(result.warranty.status).toBe('IN_7DAY_DEFECT');
    expect(defect.checkEligibility).not.toHaveBeenCalled();
    expect(photos.getPhotos).toHaveBeenCalledWith('product-3');
    expect(result.outcomes.map((o) => o.outcome)).toEqual(['REPAIR', 'CASH_SAME_MODEL_EXCHANGE']);
  });

  it('R10: checkEligibility throw ไม่ทำให้ lookup ทั้งก้อนล้ม — ปิด SAME_MODEL_EXCHANGE พร้อมเหตุผลจาก error', async () => {
    repair.lookupByImei.mockResolvedValue({
      found: true,
      product: {
        id: 'product-4',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
        imeiSerial: '359123456789099',
        category: 'PHONE_USED',
      },
      sale: null,
      customer: { id: 'customer-4', name: 'คุณผ่อน', phone: '0888888888' },
      contract: { id: 'contract-4', contractNumber: 'CT-0004', status: 'ACTIVE' },
      warrantyStatus: 'IN_7DAY_DEFECT',
      daysRemainingIn7Day: 2,
      purchasedAt: new Date('2026-09-20T00:00:00.000Z'),
      shopWarrantyEndDate: null,
      manufacturerWarrantyEndDate: null,
    });
    defect.checkEligibility.mockRejectedValue(new NotFoundException('ไม่พบสัญญา'));

    const result = await svc.lookup({ imei: '359123456789099' }, user);

    expect(result.source).toBe('INSTALLMENT_CONTRACT');
    const sameModel = result.outcomes.find((o) => o.outcome === 'SAME_MODEL_EXCHANGE')!;
    expect(sameModel).toMatchObject({ enabled: false, reason: 'ไม่พบสัญญา' });
  });

  // C7 (final-fix brief) — ข้อความเดิม "เลือกเครื่องก่อน (productId)" ชี้ทางที่ PR 1 UI ไม่มีจริง
  it('C7: ไม่ส่ง imei มาเลย → NotFoundException ข้อความจริง ไม่ชี้ productId ที่ไม่มี UI รองรับ', async () => {
    await expect(svc.lookup({} as never, user)).rejects.toThrow(
      new NotFoundException('ไม่พบเครื่องจากเลข IMEI นี้ — ตรวจเลข IMEI แล้วลองใหม่'),
    );
  });

  // C8 (final-fix brief) — R10's catch ต้อง whitelist เฉพาะ HttpException; error อื่น (เช่น
  // ข้อความ Prisma ดิบ) ต้องไม่หลุดถึง UI
  it('C8: checkEligibility throw error ธรรมดา (ไม่ใช่ HttpException) → เหตุผลทั่วไปภาษาไทย ไม่ใช่ err.message ดิบ', async () => {
    repair.lookupByImei.mockResolvedValue({
      found: true,
      product: {
        id: 'product-5',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
        imeiSerial: '359123456789100',
        category: 'PHONE_USED',
      },
      sale: null,
      customer: { id: 'customer-5', name: 'คุณทดสอบ 2', phone: '0877777777' },
      contract: { id: 'contract-5', contractNumber: 'CT-0005', status: 'ACTIVE' },
      warrantyStatus: 'IN_7DAY_DEFECT',
      daysRemainingIn7Day: 1,
      purchasedAt: new Date('2026-09-20T00:00:00.000Z'),
      shopWarrantyEndDate: null,
      manufacturerWarrantyEndDate: null,
    });
    defect.checkEligibility.mockRejectedValue(
      new Error('column "foo" of relation "bar" does not exist'),
    );

    const result = await svc.lookup({ imei: '359123456789100' }, user);

    const sameModel = result.outcomes.find((o) => o.outcome === 'SAME_MODEL_EXCHANGE')!;
    expect(sameModel).toMatchObject({ enabled: false, reason: 'ตรวจสิทธิ์เปลี่ยนเครื่องไม่สำเร็จ' });
    expect(sameModel.reason).not.toContain('relation');
  });

  it('C8: checkEligibility throw HttpException (เช่น NotFoundException) → ยังคงส่ง err.message ตามเดิม', async () => {
    repair.lookupByImei.mockResolvedValue({
      found: true,
      product: {
        id: 'product-6',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
        imeiSerial: '359123456789101',
        category: 'PHONE_USED',
      },
      sale: null,
      customer: { id: 'customer-6', name: 'คุณทดสอบ 3', phone: '0866666666' },
      contract: { id: 'contract-6', contractNumber: 'CT-0006', status: 'ACTIVE' },
      warrantyStatus: 'IN_7DAY_DEFECT',
      daysRemainingIn7Day: 1,
      purchasedAt: new Date('2026-09-20T00:00:00.000Z'),
      shopWarrantyEndDate: null,
      manufacturerWarrantyEndDate: null,
    });
    defect.checkEligibility.mockRejectedValue(new HttpException('เหตุผลจาก HttpException', 400));

    const result = await svc.lookup({ imei: '359123456789101' }, user);

    const sameModel = result.outcomes.find((o) => o.outcome === 'SAME_MODEL_EXCHANGE')!;
    expect(sameModel).toMatchObject({ enabled: false, reason: 'เหตุผลจาก HttpException' });
  });

  // A1 (final-fix brief) — openCase ต้อง reconcile ก่อนคืนค่า ไม่งั้นเคสที่ถูกปิดนอก proxy จะยัง
  // ถูกมองว่า "เปิดอยู่" และบล็อก IMEI นี้ไปตลอด (ChatGPT ของบั๊กคือ createCase's 409 ค้างถาวร)
  it('A1: มีเคสเก็บ stage เปิดอยู่ (READY_FOR_PICKUP) แต่ repairTicket จริง CLOSED → openCase เป็น null (reconcile แล้วไม่เข้าเงื่อนไข NOT IN) และเขียนกลับ DB', async () => {
    repair.lookupByImei.mockResolvedValue({
      found: true,
      product: {
        id: 'product-7',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
        imeiSerial: '359123456789102',
        category: 'PHONE_USED',
      },
      sale: { id: 's7', saleType: 'CASH' },
      customer: { id: 'customer-7', name: 'คุณทดสอบ 4', phone: '0855555555' },
      contract: null,
      warrantyStatus: 'OUT_OF_WARRANTY',
      daysRemainingIn7Day: 0,
      purchasedAt: null,
      shopWarrantyEndDate: null,
      manufacturerWarrantyEndDate: null,
    });
    // จำลอง drift: DB where กรอง stage NOT IN (CLOSED,CANCELLED) จึงยังคืนแถวนี้ เพราะสถานะที่เก็บ
    // ไว้คือ READY_FOR_PICKUP — reconcileStage ต้องคำนวณใหม่จาก repairTicket.status จริง (CLOSED)
    prisma.afterSalesCase.findFirst.mockResolvedValue({
      id: 'as-drift',
      caseNumber: 'AS-20260101-0099',
      stage: 'READY_FOR_PICKUP',
      outcome: 'REPAIR',
      cancelledAt: null,
      replacementContractId: null,
      repairTicket: { status: 'CLOSED', deletedAt: null },
    });

    const result = await svc.lookup({ imei: '359123456789102' }, user);

    expect(result.openCase).toBeNull();
    expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledWith({
      where: { id: 'as-drift', stage: 'READY_FOR_PICKUP' },
      data: { stage: 'CLOSED', closedAt: expect.any(Date) },
    });
  });
});
