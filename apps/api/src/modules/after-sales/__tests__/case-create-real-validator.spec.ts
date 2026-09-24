import { BadRequestException } from '@nestjs/common';
import { AfterSalesCaseService } from '../services/after-sales-case.service';

/**
 * C9 / Review Focus 3 test gap (final-fix brief) — `case-create.spec.ts` mocks
 * `assertEvidenceImage` out entirely, so the fake-extension / non-image-bytes rejection
 * path (the REAL `isEvidenceImage` magic-byte check in `utils/upload-image.util.ts`) has
 * never actually been exercised by a test. This spec deliberately does NOT mock it.
 */
const USER = { id: 'u-1', role: 'SALES', branchId: 'b-1' };

const BASE_DTO = {
  imei: '359123456789012',
  symptom: 'จอแตกและเปิดไม่ติด',
  accessories: { box: true },
  unlockConfirmed: true,
  outcome: 'REPAIR' as const,
  branchId: 'b-1',
};

function fakeJpegNamedButNotAnImage(): Express.Multer.File {
  // ชื่อไฟล์ + mimetype ประกาศเป็น JPEG แต่เนื้อไฟล์เป็นข้อความล้วน — ไม่มี magic bytes
  // 0xFF 0xD8 0xFF ของ JPEG จริง ⇒ isEvidenceImage ต้องคืน false
  const buf = Buffer.from('this is definitely not a jpeg image, just plain text bytes');
  return {
    buffer: buf,
    mimetype: 'image/jpeg',
    size: buf.length,
    originalname: 'evil.jpg',
  } as Express.Multer.File;
}

function buildLookupResult() {
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
    purchasePhotos: null,
    openCase: null,
    outcomes: [{ outcome: 'REPAIR', enabled: true, implemented: true, payerDefault: 'SHOP' }],
  };
}

describe('AfterSalesCaseService.createCase — real assertEvidenceImage validator (C9)', () => {
  let prisma: any;
  let storage: any;
  let audit: any;
  let repair: any;
  let docNumber: any;
  let lookupSvc: any;
  let svc: AfterSalesCaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = { $transaction: jest.fn() };
    storage = {
      upload: jest.fn().mockImplementation((key: string) => Promise.resolve(key)),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    repair = { createInTx: jest.fn() };
    docNumber = { nextCaseNumber: jest.fn() };
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

  it('ไฟล์ชื่อ .jpg + mimetype image/jpeg แต่เนื้อไฟล์ไม่ใช่รูปจริง → BadRequestException (400) และไม่แตะ storage/lookup/tx เลย', async () => {
    const files = [fakeJpegNamedButNotAnImage()];

    await expect(svc.createCase(BASE_DTO as never, files, USER)).rejects.toThrow(
      BadRequestException,
    );

    // ด่านรูปทำงานก่อนแตะ lookup/tx/storage ใดๆ ทั้งสิ้น (createCase เช็ค assertEvidenceImage
    // ทุกไฟล์ก่อนเรียก lookupSvc.lookup)
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(lookupSvc.lookup).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
