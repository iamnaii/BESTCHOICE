import { BadRequestException, ConflictException } from '@nestjs/common';
import { AfterSalesCaseService, MAX_INTAKE_PHOTOS } from '../services/after-sales-case.service';

jest.mock('../../../utils/upload-image.util', () => ({
  ...jest.requireActual('../../../utils/upload-image.util'),
  assertEvidenceImage: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { assertEvidenceImage } = jest.requireMock('../../../utils/upload-image.util') as {
  assertEvidenceImage: jest.Mock;
};

const USER = { id: 'u-1', role: 'SALES', branchId: 'b-1' };

const BASE_DTO = {
  imei: '359123456789012',
  symptom: 'จอแตกและเปิดไม่ติด',
  accessories: { box: true },
  unlockConfirmed: true,
  outcome: 'REPAIR' as const,
  branchId: 'b-1',
};

function mockFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    mimetype: 'image/jpeg',
    size: 4,
    originalname: 'a.jpg',
    ...overrides,
  } as Express.Multer.File;
}

const ALL_ANGLES_PRESENT = {
  front: 'data:image/jpeg;base64,AAAA',
  back: 'data:image/jpeg;base64,AAAA',
  left: 'data:image/jpeg;base64,AAAA',
  right: 'data:image/jpeg;base64,AAAA',
  top: 'data:image/jpeg;base64,AAAA',
  bottom: 'data:image/jpeg;base64,AAAA',
};

function buildLookupResult(overrides: Record<string, unknown> = {}) {
  return {
    found: true,
    source: 'INSTALLMENT_CONTRACT',
    product: {
      id: 'p-1',
      brand: 'Apple',
      model: 'iPhone 13',
      storage: '128GB',
      imeiSerial: BASE_DTO.imei,
    },
    customer: { id: 'cust-1', name: 'นาย ก', phone: '0800000000' },
    contract: { id: 'ct-1', contractNumber: 'CN-1', status: 'ACTIVE' },
    sale: null,
    warranty: {
      status: 'IN_SHOP_WARRANTY',
      daysRemainingIn7Day: 0,
      purchasedAt: '2026-01-01T00:00:00.000Z',
      shopWarrantyEndDate: '2027-01-01T00:00:00.000Z',
      manufacturerWarrantyEndDate: null,
      checkedAt: '2026-09-24T00:00:00.000Z',
    },
    purchasePhotos: ALL_ANGLES_PRESENT,
    openCase: null,
    outcomes: [{ outcome: 'REPAIR', enabled: true, implemented: true, payerDefault: 'SHOP' }],
    ...overrides,
  };
}

describe('AfterSalesCaseService.createCase', () => {
  let prisma: any;
  let tx: any;
  let storage: any;
  let audit: any;
  let repair: any;
  let docNumber: any;
  let lookupSvc: any;
  let svc: AfterSalesCaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    assertEvidenceImage.mockImplementation(() => undefined);

    tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      afterSalesCase: {
        findFirst: jest.fn().mockResolvedValue(null), // R12: re-check ใน tx ก่อนสร้าง — ไม่มีเคสซ้ำโดย default
        create: jest.fn().mockResolvedValue({
          id: 'as-1',
          caseNumber: 'AS-20260924-0001',
          repairTicketId: 'rt-1',
        }),
      },
    };
    prisma = { $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)) };
    storage = {
      upload: jest.fn().mockImplementation((key: string) => Promise.resolve(key)),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    repair = {
      createInTx: jest.fn().mockResolvedValue({
        ticket: {
          id: 'rt-1',
          deviceBrand: 'Apple',
          deviceModel: 'iPhone 13',
          deviceImei: BASE_DTO.imei,
          deviceSerial: null,
          payer: 'SHOP',
          repairSupplierId: null,
        },
      }),
    };
    docNumber = { nextCaseNumber: jest.fn().mockResolvedValue('AS-20260924-0001') };
    lookupSvc = { lookup: jest.fn().mockResolvedValue(buildLookupResult()) };

    svc = new AfterSalesCaseService(
      prisma as never,
      storage as never,
      audit as never,
      repair as never,
      docNumber as never,
      lookupSvc as never,
    );
  });

  // (a) พบ IMEI มีสัญญา
  it('พบ IMEI มีสัญญา → createInTx ด้วย customerId ที่พบ, source=INSTALLMENT_CONTRACT, purchasePhotoKeys 6 รายการ, photoKeys=จำนวนไฟล์, events RECEIVED+OUTCOME_SET, audit.log หลัง tx resolve', async () => {
    const files = [mockFile({ originalname: 'front.jpg' }), mockFile({ originalname: 'back.jpg' })];

    const result = await svc.createCase(BASE_DTO as never, files, USER);

    expect(result).toEqual({ id: 'as-1', caseNumber: 'AS-20260924-0001', repairTicketId: 'rt-1' });

    // repair.createInTx เรียกด้วย customerId ของลูกค้าที่ lookup เจอ + สัญญา/สินค้า/IMEI ที่ค้นเจอ
    expect(repair.createInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        branchId: BASE_DTO.branchId,
        contractId: 'ct-1',
        productId: 'p-1',
        deviceImei: BASE_DTO.imei,
      }),
      USER,
      tx,
    );

    // สร้างเคส source=INSTALLMENT_CONTRACT
    const createArg = tx.afterSalesCase.create.mock.calls[0][0];
    expect(createArg.data.source).toBe('INSTALLMENT_CONTRACT');
    expect(createArg.data.photoKeys).toHaveLength(2); // จำนวนไฟล์
    expect(createArg.data.purchasePhotoKeys).toHaveLength(6); // ทั้ง 6 มุม
    expect(createArg.data.events.create).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'RECEIVED' }),
        expect.objectContaining({ kind: 'OUTCOME_SET' }),
      ]),
    );

    // audit.log ถูกเรียกหลัง $transaction resolve
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      audit.log.mock.invocationCallOrder[0],
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        action: 'AFTER_SALES_CASE_CREATED',
        entity: 'after_sales_case',
        entityId: 'as-1',
      }),
    );
  });

  // (b) ไม่มีไฟล์
  it('ไม่มีไฟล์ → BadRequestException และไม่แตะ storage/lookup', async () => {
    await expect(svc.createCase(BASE_DTO as never, [], USER)).rejects.toThrow(
      new BadRequestException('ต้องมีรูปตอนรับฝากอย่างน้อย 1 รูป'),
    );

    expect(storage.upload).not.toHaveBeenCalled();
    expect(lookupSvc.lookup).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // (c) 7 ไฟล์ — เกิน MAX_INTAKE_PHOTOS
  it('เกิน 6 รูป (7 ไฟล์) → BadRequestException', async () => {
    const files = Array.from({ length: MAX_INTAKE_PHOTOS + 1 }, (_, i) =>
      mockFile({ originalname: `${i}.jpg` }),
    );

    await expect(svc.createCase(BASE_DTO as never, files, USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  // (d) มีเคสเปิดอยู่ของ IMEI เดิม
  it('มีเคสเปิดอยู่ของ IMEI เดิม → ConflictException ข้อความมีเลขเคสเดิม', async () => {
    lookupSvc.lookup.mockResolvedValue(
      buildLookupResult({
        openCase: { id: 'as-open', caseNumber: 'AS-20260101-0002', stage: 'IN_REPAIR' },
      }),
    );

    let err: unknown;
    try {
      await svc.createCase(BASE_DTO as never, [mockFile()], USER);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toContain('AS-20260101-0002');
    expect(storage.upload).not.toHaveBeenCalled();
  });

  // (e) tx โยน error หลังอัปโหลด — ต้องลบ key ที่อัปโหลดไปแล้วทุกตัว
  it('tx โยน error หลังอัปโหลดสำเร็จ → storage.delete ถูกเรียกครบทุก key ที่อัปโหลดไป', async () => {
    const files = [mockFile({ originalname: 'front.jpg' }), mockFile({ originalname: 'back.jpg' })];
    prisma.$transaction.mockRejectedValue(new Error('DB ล่ม'));

    await expect(svc.createCase(BASE_DTO as never, files, USER)).rejects.toThrow('DB ล่ม');

    // 2 รูปตอนรับฝาก + 6 รูปตอนซื้อ = 8 key ถูกอัปโหลดก่อน tx พัง
    expect(storage.upload).toHaveBeenCalledTimes(8);
    expect(storage.delete).toHaveBeenCalledTimes(8);
    const uploadedKeys = storage.upload.mock.calls.map((c: any) => c[0]).sort();
    const deletedKeys = storage.delete.mock.calls.map((c: any) => c[0]).sort();
    expect(deletedKeys).toEqual(uploadedKeys);
    expect(audit.log).not.toHaveBeenCalled();
  });

  // (f) R12 — TOCTOU: pre-tx lookup ไม่เจอเคสเปิดค้าง แต่ re-check ใน tx (advisory lock) เจอ
  it('R12: pre-tx lookup ไม่เจอเคสซ้ำ แต่ in-tx re-check เจอ → ConflictException + ลบรูปที่อัปโหลดไปแล้วครบ', async () => {
    const files = [mockFile({ originalname: 'front.jpg' }), mockFile({ originalname: 'back.jpg' })];
    // pre-tx lookup (fast path) ไม่เจอเคสเปิดค้าง — ผ่านด่านแรกไปอัปโหลดรูป
    lookupSvc.lookup.mockResolvedValue(buildLookupResult({ openCase: null }));
    // แต่พอเข้า tx (หลัง advisory lock) มีอีกคำขอคอมมิตเคสไปก่อนแล้ว
    tx.afterSalesCase.findFirst.mockResolvedValue({ caseNumber: 'AS-20260924-0009' });

    let err: unknown;
    try {
      await svc.createCase(BASE_DTO as never, files, USER);
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toContain('AS-20260924-0009');
    // advisory lock ถูกล็อกก่อนเช็คซ้ำ (ในเทสนี้เรียกครั้งเดียวพอดี — ไม่มี nextCaseNumber เพราะ throw ก่อน)
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
    );
    expect(docNumber.nextCaseNumber).not.toHaveBeenCalled();
    expect(repair.createInTx).not.toHaveBeenCalled();
    expect(tx.afterSalesCase.create).not.toHaveBeenCalled();

    // 2 รูปตอนรับฝาก + 6 รูปตอนซื้อ = 8 key ถูกอัปโหลดไปแล้วก่อน tx พัง — ต้องลบครบทุกตัว
    expect(storage.upload).toHaveBeenCalledTimes(8);
    expect(storage.delete).toHaveBeenCalledTimes(8);
    const uploadedKeys = storage.upload.mock.calls.map((c: any) => c[0]).sort();
    const deletedKeys = storage.delete.mock.calls.map((c: any) => c[0]).sort();
    expect(deletedKeys).toEqual(uploadedKeys);
    expect(audit.log).not.toHaveBeenCalled();
  });
});
