import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AfterSalesCaseService, MAX_INTAKE_PHOTOS } from '../services/after-sales-case.service';
import { CreateCaseDto } from '../dto/create-case.dto';

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

const REPLACEMENT_PRODUCT = {
  brand: 'Apple',
  model: 'iPhone 13',
  storage: '128GB',
  imeiSerial: '359999999999999',
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

function buildExchangeLookup(
  outcome: 'SAME_MODEL_EXCHANGE' | 'PRICED_EXCHANGE',
  overrides: Record<string, unknown> = {},
) {
  return buildLookupResult({
    outcomes: [
      { outcome: 'REPAIR', enabled: true, implemented: true, payerDefault: 'SHOP' },
      { outcome, enabled: true, implemented: true },
    ],
    ...overrides,
  });
}

describe('AfterSalesCaseService.createCase', () => {
  let prisma: any;
  let tx: any;
  let storage: any;
  let audit: any;
  let repair: any;
  let docNumber: any;
  let lookupSvc: any;
  let contractExchange: any;
  let defect: any;
  let line: any;
  let svc: AfterSalesCaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    assertEvidenceImage.mockImplementation(() => undefined);

    tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      afterSalesCase: {
        findFirst: jest.fn().mockResolvedValue(null), // R12: re-check ใน tx ก่อนสร้าง — ไม่มีเคสซ้ำโดย default
        findMany: jest.fn().mockResolvedValue([]), // A1: ผู้สมัคร stored-open ของ IMEI นี้ — ว่างโดย default
        updateMany: jest.fn().mockResolvedValue({ count: 1 }), // A1: reconcileStage CAS write
        create: jest.fn().mockResolvedValue({
          id: 'as-1',
          caseNumber: 'AS-20260924-0001',
          repairTicketId: 'rt-1',
        }),
      },
    };
    prisma = {
      $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'b-1' }) },
      product: { findUnique: jest.fn().mockResolvedValue(REPLACEMENT_PRODUCT) },
      afterSalesCase: {
        update: jest.fn().mockResolvedValue(undefined),
        // M13 — หลังผูก exchangeRequestId: โหลดแถวมา reconcile (null = ข้ามขั้นนี้ใน test เก่า)
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
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
    contractExchange = { submit: jest.fn() };
    defect = { checkEligibility: jest.fn() };
    line = { notifyMoment: jest.fn().mockResolvedValue({ status: 'SENT' }) };

    svc = new AfterSalesCaseService(
      prisma as never,
      storage as never,
      audit as never,
      repair as never,
      docNumber as never,
      lookupSvc as never,
      contractExchange as never,
      defect as never,
      line as never,
    );
  });

  // (a) พบ IMEI มีสัญญา
  it('พบ IMEI มีสัญญา → createInTx ด้วย customerId ที่พบ, source=INSTALLMENT_CONTRACT, purchasePhotoKeys 6 รายการ, photoKeys=จำนวนไฟล์, events RECEIVED+OUTCOME_SET, audit.log หลัง tx resolve', async () => {
    const files = [mockFile({ originalname: 'front.jpg' }), mockFile({ originalname: 'back.jpg' })];

    const result = await svc.createCase(BASE_DTO as never, files, USER);

    expect(result).toEqual({
      id: 'as-1',
      caseNumber: 'AS-20260924-0001',
      repairTicketId: 'rt-1',
      outcome: 'REPAIR',
      exchangeRequestId: null,
      stage: 'RECEIVED',
    });

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

    // Task 3 (a) — notifyMoment(id,'RECEIVED', actorId) ถูกเรียกหลัง audit.log (ลำดับ invocation)
    expect(line.notifyMoment).toHaveBeenCalledWith('as-1', 'RECEIVED', 'u-1');
    expect(audit.log.mock.invocationCallOrder[0]).toBeLessThan(
      line.notifyMoment.mock.invocationCallOrder[0],
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
    // แต่พอเข้า tx (หลัง advisory lock) มีอีกคำขอคอมมิตเคสไปก่อนแล้ว (ยังไม่ปิด — reconcile แล้วยังเปิดอยู่จริง)
    tx.afterSalesCase.findMany.mockResolvedValue([
      {
        id: 'as-9',
        caseNumber: 'AS-20260924-0009',
        stage: 'IN_REPAIR',
        outcome: 'REPAIR',
        cancelledAt: null,
        replacementContractId: null,
        repairTicket: { status: 'IN_PROGRESS', deletedAt: null },
      },
    ]);

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

  // (h) A1 (final-fix brief) — ผู้สมัคร stored-open มีอยู่จริงแต่ derived stage ปิดแล้ว (ใบซ่อมถูกปิด
  // นอก proxy) → reconcile ทำให้ไม่ถือว่า "เปิดอยู่" อีกต่อไป ⇒ สร้างเคสใหม่ได้ ไม่ 409
  it('A1: ผู้สมัคร stored-open ของ IMEI เดียวกัน แต่ derived stage ปิดแล้ว (ใบซ่อมถูกปิดนอก proxy) → สร้างเคสใหม่สำเร็จ ไม่ ConflictException', async () => {
    const files = [mockFile({ originalname: 'front.jpg' })];
    lookupSvc.lookup.mockResolvedValue(buildLookupResult({ openCase: null }));
    tx.afterSalesCase.findMany.mockResolvedValue([
      {
        id: 'as-drift',
        caseNumber: 'AS-20260101-0099',
        stage: 'READY_FOR_PICKUP', // เก็บไว้ว่ายังเปิด
        outcome: 'REPAIR',
        cancelledAt: null,
        replacementContractId: null,
        repairTicket: { status: 'CLOSED', deletedAt: null }, // แต่ใบซ่อมจริงถูกปิดนอก proxy แล้ว
      },
    ]);

    const result = await svc.createCase(BASE_DTO as never, files, USER);

    expect(result).toEqual({
      id: 'as-1',
      caseNumber: 'AS-20260924-0001',
      repairTicketId: 'rt-1',
      outcome: 'REPAIR',
      exchangeRequestId: null,
      stage: 'RECEIVED',
    });
    // แถวเก่าต้องถูกเขียนกลับเป็น CLOSED ระหว่างทาง (CAS ผ่าน reconcileStage)
    expect(tx.afterSalesCase.updateMany).toHaveBeenCalledWith({
      where: { id: 'as-drift', stage: 'READY_FOR_PICKUP' },
      data: { stage: 'CLOSED', closedAt: expect.any(Date) },
    });
    expect(docNumber.nextCaseNumber).toHaveBeenCalled();
    expect(tx.afterSalesCase.create).toHaveBeenCalled();
  });

  // (g) R16 — fix round 1 Critical: BranchGuard มองไม่เห็น branchId ใน multipart body (guards รัน
  // ก่อน FilesInterceptor แกะฟอร์ม) ⇒ ต้องบังคับ scope สาขาที่ service เอง ก่อนแตะ storage/lookup/tx
  it('SALES ของสาขาอื่นส่ง dto.branchId ต่างจาก user.branchId → ForbiddenException ไม่แตะ storage/lookup/tx', async () => {
    const otherBranchUser = { id: 'u-2', role: 'SALES', branchId: 'br-A' };
    const dto = { ...BASE_DTO, branchId: 'br-B' };

    await expect(svc.createCase(dto as never, [mockFile()], otherBranchUser)).rejects.toThrow(
      ForbiddenException,
    );

    expect(storage.upload).not.toHaveBeenCalled();
    expect(lookupSvc.lookup).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // (h) branchId ไม่บังคับ UUID แล้ว (seed ใช้ `branch-001`) — role ข้ามสาขาส่งรหัสสาขาที่ไม่มีจริง
  // ต้องได้ 400 "ไม่พบสาขา" ก่อนแตะ storage/lookup/tx (ไม่ใช่ FK error ตอนสร้างแถว)
  it('OWNER ส่ง branchId ที่ไม่มีจริง → BadRequestException "ไม่พบสาขา" ไม่แตะ storage/lookup/tx', async () => {
    prisma.branch.findFirst.mockResolvedValue(null);
    const owner = { id: 'u-o', role: 'OWNER', branchId: null };
    const dto = { ...BASE_DTO, branchId: 'branch-ghost' };

    await expect(svc.createCase(dto as never, [mockFile()], owner)).rejects.toThrow('ไม่พบสาขา');
    expect(prisma.branch.findFirst).toHaveBeenCalledWith({
      where: { id: 'branch-ghost', deletedAt: null },
      select: { id: true },
    });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(lookupSvc.lookup).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('ทางออกเปลี่ยนเครื่อง (PR 2)', () => {
    // (a) SAME_MODEL_EXCHANGE + replacementProductId ของเครื่อง IN_STOCK รุ่น/ความจุตรง
    it('(a) SAME_MODEL_EXCHANGE + replacementProductId ตรงรุ่น/ความจุ+IN_STOCK → สร้างเคส stage AWAITING_APPROVAL ไม่เรียก repair.createInTx', async () => {
      const dto = {
        ...BASE_DTO,
        outcome: 'SAME_MODEL_EXCHANGE' as const,
        replacementProductId: 'p-2',
      };
      lookupSvc.lookup.mockResolvedValue(buildExchangeLookup('SAME_MODEL_EXCHANGE'));
      defect.checkEligibility.mockResolvedValue({
        eligible: true,
        reasons: [],
        newProduct: {
          id: 'p-2',
          brand: 'Apple',
          model: 'iPhone 13',
          storage: '128GB',
          category: 'PHONE_NEW',
          status: 'IN_STOCK',
        },
      });
      tx.afterSalesCase.create.mockResolvedValue({ id: 'as-2', caseNumber: 'AS-20260924-0002' });

      const result = await svc.createCase(dto as never, [mockFile()], USER);

      expect(result).toEqual({
        id: 'as-2',
        caseNumber: 'AS-20260924-0002',
        repairTicketId: null,
        outcome: 'SAME_MODEL_EXCHANGE',
        exchangeRequestId: null,
        stage: 'AWAITING_APPROVAL',
      });
      expect(defect.checkEligibility).toHaveBeenCalledWith('ct-1', 'p-2');
      expect(repair.createInTx).not.toHaveBeenCalled();

      const createArg = tx.afterSalesCase.create.mock.calls[0][0];
      expect(createArg.data).toMatchObject({
        outcome: 'SAME_MODEL_EXCHANGE',
        repairTicketId: null,
        replacementProductId: 'p-2',
        stage: 'AWAITING_APPROVAL',
      });
      expect(createArg.data.events.create).toEqual([
        expect.objectContaining({ kind: 'RECEIVED' }),
        expect.objectContaining({
          kind: 'OUTCOME_SET',
          note: 'เปลี่ยนรุ่นเดิม · รอ ผจก.สาขา ยืนยัน · เครื่องทดแทน Apple iPhone 13 128GB IMEI 359999999999999',
        }),
      ]);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          newValue: expect.objectContaining({ outcome: 'SAME_MODEL_EXCHANGE' }),
        }),
      );
    });

    // (b) SAME_MODEL_EXCHANGE ไม่ส่ง replacementProductId
    it('(b) SAME_MODEL_EXCHANGE ไม่ส่ง replacementProductId → 400 ก่อนอัปโหลดรูป', async () => {
      const dto = { ...BASE_DTO, outcome: 'SAME_MODEL_EXCHANGE' as const };
      lookupSvc.lookup.mockResolvedValue(buildExchangeLookup('SAME_MODEL_EXCHANGE'));

      await expect(svc.createCase(dto as never, [mockFile()], USER)).rejects.toThrow(
        new BadRequestException('ต้องเลือกเครื่องทดแทนจากสต๊อก'),
      );
      expect(storage.upload).not.toHaveBeenCalled();
      expect(defect.checkEligibility).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // (c) เครื่องทดแทนไม่ IN_STOCK/รุ่นไม่ตรง → 400 เสมอ (ไม่ว่า role ไหน) ·
    // BM/OWNER ที่ข้ามกรอบ 7 วัน (เหตุผลเป็นเรื่องกรอบเวลา ไม่ใช่ตัวเครื่อง) → สร้างได้
    it('(c) เครื่องทดแทนไม่ IN_STOCK/รุ่นไม่ตรง → 400 พร้อม reasons[0]; เหตุผลเรื่องกรอบ 7 วัน (ไม่ใช่ตัวเครื่อง) → สร้างได้ (bypass ตัดสินตอนยืนยัน)', async () => {
      const dto = {
        ...BASE_DTO,
        outcome: 'SAME_MODEL_EXCHANGE' as const,
        replacementProductId: 'p-2',
      };
      lookupSvc.lookup.mockResolvedValue(buildExchangeLookup('SAME_MODEL_EXCHANGE'));

      // เครื่องทดแทนไม่พร้อมขาย — บล็อกเสมอไม่ว่า role ไหน
      defect.checkEligibility.mockResolvedValue({
        eligible: false,
        reasons: ['สินค้าใหม่ไม่พร้อมจำหน่าย'],
        newProduct: null,
      });
      await expect(svc.createCase(dto as never, [mockFile()], USER)).rejects.toThrow(
        new BadRequestException('สินค้าใหม่ไม่พร้อมจำหน่าย'),
      );
      expect(storage.upload).not.toHaveBeenCalled();

      // BM ข้ามกรอบ 7 วัน — เหตุผลที่ checkEligibility คืนมาเป็นเรื่องกรอบเวลา (contract-level)
      // ไม่ใช่เรื่องตัวเครื่องทดแทน ⇒ regex ไม่จับ ⇒ ไม่บล็อกตรงนี้ (ผจก.ตัดสินตอนยืนยันแทน)
      const bmUser = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'b-1' };
      defect.checkEligibility.mockResolvedValue({
        eligible: false,
        reasons: ['พ้นกำหนด 7 วันแล้ว (รับเครื่องเมื่อ 2026-09-01)'],
        newProduct: {
          id: 'p-2',
          brand: 'Apple',
          model: 'iPhone 13',
          storage: '128GB',
          category: 'PHONE_NEW',
          status: 'IN_STOCK',
        },
      });
      tx.afterSalesCase.create.mockResolvedValue({ id: 'as-3', caseNumber: 'AS-20260924-0003' });

      const result = await svc.createCase(dto as never, [mockFile()], bmUser);
      expect(result.id).toBe('as-3');
      expect(tx.afterSalesCase.create).toHaveBeenCalled();
    });

    // I1 (final fix wave) — ผจก. ข้ามได้เฉพาะกรอบ 7 วัน: เหตุผลอื่นของ engine ต้องบล็อกเสมอ
    it.each([
      ['PHONE_NEW (เปลี่ยนเครื่องได้เฉพาะมือสอง)', 'เปลี่ยนเครื่องได้เฉพาะมือสอง (PHONE_USED)'],
      ['สัญญาไม่ ACTIVE', 'สัญญาต้องอยู่ในสถานะ ACTIVE เท่านั้น'],
    ])(
      'I1: SAME_MODEL + เหตุผล %s (แม้มีกรอบ 7 วันร่วมด้วย) โดย BM → 400 ด้วยเหตุผลนั้น ไม่อัปโหลด/ไม่สร้างเคส',
      async (_label, reason) => {
        const dto = {
          ...BASE_DTO,
          outcome: 'SAME_MODEL_EXCHANGE' as const,
          replacementProductId: 'p-2',
        };
        lookupSvc.lookup.mockResolvedValue(buildExchangeLookup('SAME_MODEL_EXCHANGE'));
        defect.checkEligibility.mockResolvedValue({
          eligible: false,
          reasons: ['พ้นกำหนด 7 วันแล้ว (รับเครื่องเมื่อ 2026-09-01)', reason],
          newProduct: { id: 'p-2', brand: 'Apple', model: 'iPhone 13', storage: '128GB' },
        });
        const bmUser = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'b-1' };
        await expect(svc.createCase(dto as never, [mockFile()], bmUser)).rejects.toThrow(
          new BadRequestException(reason),
        );
        expect(storage.upload).not.toHaveBeenCalled();
        expect(tx.afterSalesCase.create).not.toHaveBeenCalled();
      },
    );

    // (d) PRICED_EXCHANGE — submit สำเร็จ
    it('(d) PRICED_EXCHANGE: tx สร้างเคส AWAITING_APPROVAL แล้ว submit สำเร็จ → update exchangeRequestId + event OUTCOME_SET', async () => {
      const dto = {
        ...BASE_DTO,
        outcome: 'PRICED_EXCHANGE' as const,
        replacementProductId: 'p-2',
        buybackPrice: '5000',
        deviceCondition: 'B' as const,
        newTotalMonths: 10,
        newInterestRate: '0.02',
      };
      lookupSvc.lookup.mockResolvedValue(buildExchangeLookup('PRICED_EXCHANGE'));
      tx.afterSalesCase.create.mockResolvedValue({ id: 'as-4', caseNumber: 'AS-20260924-0004' });
      contractExchange.submit.mockResolvedValue({
        id: 'req-1',
        mode: 'PRICED',
        approvalTier: 'REVIEW',
      });

      const result = await svc.createCase(dto as never, [mockFile()], USER);

      expect(defect.checkEligibility).not.toHaveBeenCalled();
      expect(repair.createInTx).not.toHaveBeenCalled();
      expect(contractExchange.submit).toHaveBeenCalledWith(
        {
          oldContractId: 'ct-1',
          oldProductId: 'p-1',
          newProductId: 'p-2',
          conditionNote: dto.symptom, // conditionNote ไม่ได้ส่งมา → fallback เป็นอาการที่แจ้ง
          buybackPrice: '5000',
          deviceCondition: 'B',
          newTotalMonths: 10,
          newInterestRate: '0.02',
        },
        USER,
      );
      expect(prisma.afterSalesCase.update).toHaveBeenCalledWith({
        where: { id: 'as-4' },
        data: {
          exchangeRequestId: 'req-1',
          events: {
            create: {
              kind: 'OUTCOME_SET',
              actorId: USER.id,
              note: 'เปลี่ยนแบบมีราคา · PRICED · tier REVIEW',
            },
          },
        },
      });
      expect(result).toEqual({
        id: 'as-4',
        caseNumber: 'AS-20260924-0004',
        repairTicketId: null,
        outcome: 'PRICED_EXCHANGE',
        exchangeRequestId: 'req-1',
        stage: 'AWAITING_APPROVAL',
      });
      // Task 3 — PRICED ที่ submit สำเร็จ (link/compensation ผ่าน) ก็ยังไปถึง audit.log ปกติ ⇒
      // ยังส่ง RECEIVED (ต่างจาก (b) ที่ submit ล้ม)
      expect(line.notifyMoment).toHaveBeenCalledWith('as-4', 'RECEIVED', USER.id);
    });

    // M13 — AUTO tier: submit() อนุมัติคำขอให้ทันที → คืน stage ที่ reconcile แล้ว + event APPROVED
    it('M13: PRICED AUTO tier (คำขอ APPROVED แล้ว) → reconcile → READY_FOR_PICKUP, เขียน approvedAt/APPROVED event, audit มี exchangeRequestId', async () => {
      const dto = {
        ...BASE_DTO,
        outcome: 'PRICED_EXCHANGE' as const,
        replacementProductId: 'p-2',
        buybackPrice: '5000',
        deviceCondition: 'A' as const,
        newTotalMonths: 10,
      };
      lookupSvc.lookup.mockResolvedValue(buildExchangeLookup('PRICED_EXCHANGE'));
      tx.afterSalesCase.create.mockResolvedValue({ id: 'as-9', caseNumber: 'AS-20260924-0009' });
      contractExchange.submit.mockResolvedValue({
        id: 'req-9',
        mode: 'PRICED',
        approvalTier: 'AUTO',
      });
      prisma.afterSalesCase.findFirst.mockResolvedValue({
        id: 'as-9',
        stage: 'AWAITING_APPROVAL',
        outcome: 'PRICED_EXCHANGE',
        cancelledAt: null,
        closedAt: null,
        replacementContractId: null,
        repairTicket: null,
        exchangeRequest: {
          status: 'APPROVED',
          mode: 'PRICED',
          memoAppliedAt: null,
          rejectionReason: null,
          cancelReason: null,
          newContract: { status: 'DRAFT' },
        },
      });

      const result = await svc.createCase(dto as never, [mockFile()], USER);

      expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledWith({
        where: { id: 'as-9', stage: 'AWAITING_APPROVAL' },
        data: { stage: 'READY_FOR_PICKUP' },
      });
      expect(prisma.afterSalesCase.update).toHaveBeenCalledWith({
        where: { id: 'as-9' },
        data: expect.objectContaining({
          approvedAt: expect.any(Date),
          approvedById: USER.id,
          events: { create: expect.objectContaining({ kind: 'APPROVED', actorId: USER.id }) },
        }),
      });
      expect(result.stage).toBe('READY_FOR_PICKUP');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          newValue: expect.objectContaining({ exchangeRequestId: 'req-9' }),
        }),
      );
    });

    // (d) PRICED_EXCHANGE — submit throw → compensation
    it('(d) PRICED_EXCHANGE: submit throw → เคสถูกอัปเดตเป็น CANCELLED พร้อมเหตุผล + rethrow · รูปที่อัปโหลดไม่ถูกลบ', async () => {
      const dto = {
        ...BASE_DTO,
        outcome: 'PRICED_EXCHANGE' as const,
        replacementProductId: 'p-2',
        buybackPrice: '5000',
        deviceCondition: 'B' as const,
        newTotalMonths: 10,
      };
      lookupSvc.lookup.mockResolvedValue(buildExchangeLookup('PRICED_EXCHANGE'));
      tx.afterSalesCase.create.mockResolvedValue({ id: 'as-5', caseNumber: 'AS-20260924-0005' });
      contractExchange.submit.mockRejectedValue(
        new BadRequestException('เครื่องใหม่ต้องอยู่ในสต็อก (IN_STOCK)'),
      );

      await expect(svc.createCase(dto as never, [mockFile()], USER)).rejects.toThrow(
        'เครื่องใหม่ต้องอยู่ในสต็อก (IN_STOCK)',
      );

      expect(prisma.afterSalesCase.update).toHaveBeenCalledWith({
        where: { id: 'as-5' },
        data: {
          stage: 'CANCELLED',
          cancelledAt: expect.any(Date),
          cancelReason: 'ยื่นคำขอไม่สำเร็จ: เครื่องใหม่ต้องอยู่ในสต็อก (IN_STOCK)',
          events: {
            create: {
              kind: 'CANCELLED',
              actorId: USER.id,
              note: 'ยื่นคำขอไม่สำเร็จ: เครื่องใหม่ต้องอยู่ในสต็อก (IN_STOCK)',
            },
          },
        },
      });
      // รูปที่อัปโหลดไว้ต้องไม่ถูกลบ — เคสยังอยู่เป็นประวัติ (คนละ catch กับ tx)
      expect(storage.delete).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
      // Task 3 (b) — submit ล้ม → throw ก่อนถึง audit.log/notifyMoment เสมอ ไม่ส่ง LINE
      expect(line.notifyMoment).not.toHaveBeenCalled();
    });

    // (d) fix round 1, Important — submit สำเร็จ (คำขอเปลี่ยนเครื่องถูกสร้างจริงแล้ว) แต่ update
    // เชื่อมโยง exchangeRequestId พังทีหลัง: ต้อง "ปล่อยผ่านตามจริง" ไม่ใช่ยกเลิกเป็น CANCELLED
    // (ไม่งั้นคำขอที่สร้างไปแล้วกลายเป็นคำขอกำพร้า + IMEI เปิดใหม่ได้ทั้งที่มีคำขอค้างอยู่จริง)
    it('(d) fix round 1: submit สำเร็จ แต่ update เชื่อมโยง exchangeRequestId throw → error หลุดตรงๆ ไม่ถูกเปลี่ยนเป็น CANCELLED (กันคำขอกำพร้า)', async () => {
      const dto = {
        ...BASE_DTO,
        outcome: 'PRICED_EXCHANGE' as const,
        replacementProductId: 'p-2',
        buybackPrice: '5000',
        deviceCondition: 'B' as const,
        newTotalMonths: 10,
      };
      lookupSvc.lookup.mockResolvedValue(buildExchangeLookup('PRICED_EXCHANGE'));
      tx.afterSalesCase.create.mockResolvedValue({ id: 'as-6', caseNumber: 'AS-20260924-0006' });
      contractExchange.submit.mockResolvedValue({
        id: 'req-2',
        mode: 'PRICED',
        approvalTier: 'REVIEW',
      });
      prisma.afterSalesCase.update.mockRejectedValueOnce(new Error('DB ล่มตอนเชื่อมโยง'));

      await expect(svc.createCase(dto as never, [mockFile()], USER)).rejects.toThrow(
        'DB ล่มตอนเชื่อมโยง',
      );

      // update ถูกเรียกครั้งเดียว (เชื่อมโยง exchangeRequestId) — ไม่มีการเรียกซ้ำเพื่อยกเลิกเป็น
      // CANCELLED (คำขอเปลี่ยนเครื่อง req-2 ยังอยู่จริง การยกเลิกเคสจะทำให้มันกลายเป็นคำขอกำพร้า)
      expect(prisma.afterSalesCase.update).toHaveBeenCalledTimes(1);
      expect(prisma.afterSalesCase.update).toHaveBeenCalledWith({
        where: { id: 'as-6' },
        data: expect.objectContaining({ exchangeRequestId: 'req-2' }),
      });
      expect(audit.log).not.toHaveBeenCalled();
    });

    // (e) outcome นอก enum → 400 จาก DTO
    describe('CreateCaseDto.outcome', () => {
      const validPayload = {
        imei: '359123456789012',
        symptom: 'จอแตกและเปิดไม่ติด',
        accessories: {},
        unlockConfirmed: true,
        branchId: 'branch-002', // seed ใช้รหัสสาขาแบบ literal — ไม่ต้องเป็น UUID
      };

      it('รับ REPAIR / SAME_MODEL_EXCHANGE / PRICED_EXCHANGE', async () => {
        for (const outcome of ['REPAIR', 'SAME_MODEL_EXCHANGE', 'PRICED_EXCHANGE']) {
          const errors = await validate(
            plainToInstance(CreateCaseDto, { ...validPayload, outcome }),
          );
          expect(errors.filter((e) => e.property === 'outcome')).toEqual([]);
        }
      });

      it('ปฏิเสธ outcome นอก enum (เช่น CASH_SAME_MODEL_EXCHANGE) ด้วยข้อความ "ทางออกไม่ถูกต้อง"', async () => {
        const errors = await validate(
          plainToInstance(CreateCaseDto, { ...validPayload, outcome: 'CASH_SAME_MODEL_EXCHANGE' }),
        );
        const outcomeError = errors.find((e) => e.property === 'outcome');
        expect(outcomeError).toBeDefined();
        expect(Object.values(outcomeError!.constraints ?? {})).toContain('ทางออกไม่ถูกต้อง');
      });
    });
  });
});
