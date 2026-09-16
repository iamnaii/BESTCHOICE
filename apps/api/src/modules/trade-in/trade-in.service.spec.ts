import { TRADE_IN_DECLARATION_VERSION, TRADE_IN_DECLARATION_TEXT } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TradeInService } from './trade-in.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TradeInVoucherService } from './services/voucher.service';
import { ContactResolverService } from '../contacts/contact-resolver.service';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { ShopTradeInTemplate } from '../journal/cpa-templates/shop-trade-in.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { encryptPII } from '../../utils/crypto.util';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTradeIn(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ti-1',
    status: 'PENDING_APPRAISAL',
    customerId: 'cust-1',
    branchId: 'branch-1',
    deviceBrand: 'Samsung',
    deviceModel: 'Galaxy S22',
    deviceStorage: '256GB',
    deviceColor: 'Black',
    deviceCondition: 'B',
    imei: '123456789012345',
    estimatedValue: null,
    offeredPrice: null,
    agreedPrice: null,
    notes: null,
    sellerName: 'สมหญิง รักดี',
    sellerPhone: '0822222222',
    sellerIdCardNumber: '0000000000001', sellerAddress: 'TEST ADDRESS', serialNumber: 'TEST-SN',
    idCardPhotoUrl: null,
    idCardSource: null,
    imeiBlacklistResult: null,
    imeiBlacklistCheckedAt: null,
    sellerConsentSigned: false,
    policeReportAcknowledged: false,
    voucherNumber: null,
    voucherDate: null,
    deletedAt: null,
    customer: { id: 'cust-1', name: 'สมหญิง รักดี', phone: '0822222222' },
    branch: { id: 'branch-1', name: 'ลาดพร้าว' },
    appraisedBy: null,
    idCardVerifiedBy: null,
    product: null,
    ...overrides,
  };
}

// Valid Thai national ID used in tests (checksum verified)
const VALID_THAI_ID = '3100600717899';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('TradeInService', () => {
  let service: TradeInService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let storage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let voucher: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let contactResolver: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pii: any;
  let postBuyback: jest.Mock;

  beforeEach(async () => {
    prisma = {
      tradeIn: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      tradeInValuation: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      contact: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      customer: {
        findUnique: jest.fn().mockResolvedValue({ id: 'cust-1', phone: '0822222222', addressCurrent: null, deletedAt: null, nationalIdHash: null }),
      },
      product: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'prod-new-1' }),
      },
      // B0 §2.1: autofill hook (trade-in accept/quickBuy) queries pricingTemplate —
      // empty means NO_TEMPLATE, returns before touching product.update/systemConfig.
      pricingTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      $transaction: jest.fn().mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') return fn(prisma);
        return Promise.all(fn as Promise<unknown>[]);
      }),
    };

    storage = {
      upload: jest.fn().mockResolvedValue('trade-ins/_pending/123-id-card.jpg'),
    };

    voucher = {
      allocate: jest.fn().mockResolvedValue({
        id: 'ti-1',
        voucherNumber: 'TI-202601-0001',
        voucherDate: new Date(),
      }),
      renderPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
    };

    contactResolver = {
      findOrCreateByNaturalKey: jest
        .fn()
        .mockResolvedValue({ id: 'contact-1', name: 'สมหญิง รักดี' }),
    };

    pii = {
      hash: jest.fn().mockReturnValue(null),
    };

    postBuyback = jest.fn().mockResolvedValue({ entryNo: 'JE-001', journalEntryId: 'je-1' });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeInService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: TradeInVoucherService, useValue: voucher },
        { provide: ContactResolverService, useValue: contactResolver },
        { provide: CustomerPiiService, useValue: pii },
        { provide: ShopTradeInTemplate, useValue: { execute: postBuyback } },
        { provide: ShopAccountResolver, useValue: { resolveOutflowCashAccount: jest.fn().mockResolvedValue('S11-1101') } },
      ],
    }).compile();

    service = module.get<TradeInService>(TradeInService);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // create
  // ──────────────────────────────────────────────────────────────────────────
  describe('create', () => {
    const baseDto = {
      branchId: 'branch-1',
      deviceBrand: 'Samsung',
      deviceModel: 'Galaxy S22',
      sellerName: 'สมหญิง รักดี',
    };

    it('throws BadRequestException when neither customerId nor sellerName provided', async () => {
      await expect(
        service.create({ branchId: 'branch-1', deviceBrand: 'Samsung', deviceModel: 'Galaxy' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when customerId refers to deleted customer', async () => {
      prisma.customer.findUnique.mockResolvedValue({ deletedAt: new Date() });

      await expect(
        service.create({ ...baseDto, customerId: 'cust-deleted' } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('ผู้สนใจจากแชทที่ยังไม่มีเบอร์ (customerId + phone null) → BadRequest ก่อนอัปโหลดรูป/สร้างรายการ', async () => {
      // A12: แถวผู้สนใจจริง (ที่มา CHAT_* ไม่มีเบอร์และเลขบัตร) → ข้อความชี้ปุ่มเติมเบอร์
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-chat', phone: null, nationalId: null, acquisitionSource: 'CHAT_FACEBOOK', deletedAt: null, nationalIdHash: null,
      });

      await expect(
        service.create({ ...baseDto, customerId: 'cust-chat', idCardPhotoBase64: `data:image/jpeg;base64,${'A'.repeat(200)}` } as never),
      ).rejects.toThrow('ผู้สนใจคนนี้ยังไม่มีเบอร์ — กด "เติมเบอร์" ในหน้าลูกค้า หรือ "เพิ่มเบอร์/ข้อมูล" ในการ์ดผู้สนใจที่อินบ็อกซ์ ก่อนรับซื้อเครื่อง');
      expect(storage.upload).not.toHaveBeenCalled();
      expect(prisma.tradeIn.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for invalid Thai national ID', async () => {
      await expect(
        service.create({ ...baseDto, sellerIdCardNumber: '1234567890123' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts valid Thai national ID (checksum passes)', async () => {
      prisma.tradeIn.create.mockResolvedValue(makeTradeIn());
      prisma.tradeIn.findMany.mockResolvedValue([]); // IMEI check

      await expect(
        service.create({
          ...baseDto,
          sellerIdCardNumber: VALID_THAI_ID,
          imei: '123456789012345',
        } as never),
      ).resolves.toBeDefined();
    });

    it('creates trade-in with status PENDING_APPRAISAL', async () => {
      prisma.tradeIn.create.mockResolvedValue(makeTradeIn());
      prisma.tradeIn.findMany.mockResolvedValue([]);

      await service.create({ ...baseDto, imei: '123456789012345' } as never);

      expect(prisma.tradeIn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING_APPRAISAL' }),
        }),
      );
    });

    it('marks imeiBlacklistResult as "duplicate" when IMEI already exists', async () => {
      // IMEI check returns existing record
      prisma.tradeIn.findMany.mockResolvedValue([
        { id: 'ti-old', status: 'COMPLETED', createdAt: new Date() },
      ]);
      prisma.tradeIn.create.mockResolvedValue(makeTradeIn({ imeiBlacklistResult: 'duplicate' }));

      await service.create({ ...baseDto, imei: '123456789012345' } as never);

      expect(prisma.tradeIn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ imeiBlacklistResult: 'duplicate' }),
        }),
      );
    });

    it('uploads idCard photo to storage when base64 is provided', async () => {
      const base64 = `data:image/jpeg;base64,${'A'.repeat(200)}`; // > 100 bytes
      prisma.tradeIn.findMany.mockResolvedValue([]);
      prisma.tradeIn.create.mockResolvedValue(makeTradeIn());

      await service.create({ ...baseDto, idCardPhotoBase64: base64 } as never);

      expect(storage.upload).toHaveBeenCalled();
    });

    // ── Task 11: link Contact (TRADE_IN_SELLER) party master on create ──
    it('resolves a TRADE_IN_SELLER Contact (keyless: nationalIdHash null) and links it', async () => {
      prisma.tradeIn.findMany.mockResolvedValue([]);
      prisma.tradeIn.create.mockResolvedValue(makeTradeIn());

      await service.create({
        ...baseDto,
        sellerName: 'สมหญิง รักดี',
        sellerPhone: '0822222222',
      } as never);

      expect(contactResolver.findOrCreateByNaturalKey).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'สมหญิง รักดี',
          phone: '0822222222',
          taxId: null,
          nationalIdHash: null,
          role: 'TRADE_IN_SELLER',
        }),
      );

      const data = prisma.tradeIn.create.mock.calls[0][0].data;
      // sellerContactId may be plumbed via scalar or relation connect
      const linkedId =
        data.sellerContactId ?? data.sellerContact?.connect?.id;
      expect(linkedId).toBe('contact-1');
    });

    it('falls back to "ไม่ระบุชื่อ" when sellerName is absent (customer-only trade-in)', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        makeTradeIn().customer,
      );
      prisma.tradeIn.findMany.mockResolvedValue([]);
      prisma.tradeIn.create.mockResolvedValue(makeTradeIn());

      await service.create({
        branchId: 'branch-1',
        deviceBrand: 'Samsung',
        deviceModel: 'Galaxy S22',
        customerId: 'cust-1',
      } as never);

      expect(contactResolver.findOrCreateByNaturalKey).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'ไม่ระบุชื่อ',
          role: 'TRADE_IN_SELLER',
        }),
      );
    });

    // ── Task 3: unify trade-in seller with existing Customer/Contact ──
    it('keys trade-in seller by the customer nationalIdHash when customerId given', async () => {
      // outer guard: customer exists (มีเบอร์ — ผ่านด่านเบอร์) + inside-tx lookup returns the hash
      prisma.customer.findUnique.mockResolvedValue({ nationalIdHash: 'h1', phone: '0822222222' });
      prisma.tradeIn.findMany.mockResolvedValue([]);
      prisma.tradeIn.create.mockResolvedValue(makeTradeIn());
      contactResolver.findOrCreateByNaturalKey.mockResolvedValue({ id: 'cShared' });

      await service.create({
        branchId: 'branch-1',
        deviceBrand: 'Samsung',
        deviceModel: 'Galaxy S22',
        customerId: 'cus1',
        sellerName: 'A',
      } as never);

      expect(contactResolver.findOrCreateByNaturalKey).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ role: 'TRADE_IN_SELLER', nationalIdHash: 'h1' }),
      );
    });

    it('keys by hashed normalized sellerIdCardNumber when no customerId', async () => {
      pii.hash.mockReturnValue('hcard');
      prisma.tradeIn.findMany.mockResolvedValue([]);
      prisma.tradeIn.create.mockResolvedValue(makeTradeIn());
      contactResolver.findOrCreateByNaturalKey.mockResolvedValue({ id: 'c2' });

      // formatted ID — normalizes to the valid-checksum VALID_THAI_ID
      await service.create({
        branchId: 'branch-1',
        deviceBrand: 'Samsung',
        deviceModel: 'Galaxy S22',
        sellerName: 'B',
        sellerIdCardNumber: VALID_THAI_ID,
      } as never);

      expect(pii.hash).toHaveBeenCalledWith(VALID_THAI_ID);
      expect(contactResolver.findOrCreateByNaturalKey).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ nationalIdHash: 'hcard' }),
      );
    });

    it('normalizes sellerIdCardNumber (strip spaces/dashes, uppercase) before hashing', async () => {
      pii.hash.mockReturnValue('hcard');
      prisma.tradeIn.findMany.mockResolvedValue([]);
      prisma.tradeIn.create.mockResolvedValue(makeTradeIn());

      // sellerIdCardNumber DTO is @Length(13,13) so a formatted string can't
      // arrive here; instead assert the service-level normalization helper
      // collapses spaces/dashes + uppercases EXACTLY like CustomersService.
      const normalized = (service as any).normalizeNationalId('3-1006 00717899');
      expect(normalized).toBe(VALID_THAI_ID);
    });

    it('stays keyless (nationalIdHash null) when neither customerId nor sellerIdCardNumber', async () => {
      prisma.tradeIn.findMany.mockResolvedValue([]);
      prisma.tradeIn.create.mockResolvedValue(makeTradeIn());
      contactResolver.findOrCreateByNaturalKey.mockResolvedValue({ id: 'c3' });

      await service.create({
        branchId: 'branch-1',
        deviceBrand: 'Samsung',
        deviceModel: 'Galaxy S22',
        sellerName: 'C',
      } as never);

      expect(contactResolver.findOrCreateByNaturalKey).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ nationalIdHash: null }),
      );
    });

    it('persists sellerContactId directly when provided in DTO (skips resolver)', async () => {
      prisma.tradeIn.findMany.mockResolvedValue([]);
      prisma.tradeIn.create.mockResolvedValue(makeTradeIn());

      await service.create({
        branchId: 'branch-1',
        deviceBrand: 'Samsung',
        deviceModel: 'Galaxy S22',
        sellerName: 'สมชาย ขายมือสอง',
        sellerContactId: 'contact-known-99',
      } as never);

      // Resolver must NOT be called — caller already resolved the contact
      expect(contactResolver.findOrCreateByNaturalKey).not.toHaveBeenCalled();
      // The known contactId must be passed straight through to the DB
      expect(prisma.tradeIn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sellerContactId: 'contact-known-99' }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // appraise
  // ──────────────────────────────────────────────────────────────────────────
  describe('appraise', () => {
    it('throws BadRequestException when status is not PENDING_APPRAISAL', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue(makeTradeIn({ status: 'APPRAISED' }));

      await expect(
        service.appraise('ti-1', { offeredPrice: 5000, deviceCondition: 'B' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates status to APPRAISED and sets offeredPrice', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue(makeTradeIn({ status: 'PENDING_APPRAISAL' }));
      prisma.tradeIn.update.mockResolvedValue(makeTradeIn({ status: 'APPRAISED', offeredPrice: 5000 }));

      const result = await service.appraise(
        'ti-1',
        { offeredPrice: 5000, deviceCondition: 'B' },
        'user-1',
      );

      expect(prisma.tradeIn.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPRAISED', offeredPrice: 5000 }),
        }),
      );
      expect(result.status).toBe('APPRAISED');
    });

    describe('price ceiling guard (±15% vs TradeInValuation)', () => {
      beforeEach(() => {
        prisma.tradeIn.findUnique.mockResolvedValue(makeTradeIn({ status: 'PENDING_APPRAISAL' }));
        prisma.tradeIn.update.mockImplementation((args: { data: unknown }) =>
          Promise.resolve({ ...makeTradeIn({ status: 'APPRAISED' }), ...(args.data as object) }),
        );
      });

      it('allows price exactly within ceiling (basePrice × 1.15)', async () => {
        prisma.tradeInValuation.findFirst.mockResolvedValue({ basePrice: 10000 });
        await service.appraise(
          'ti-1',
          { offeredPrice: 11500, deviceCondition: 'B' },
          'user-1',
        );
        expect(prisma.tradeIn.update).toHaveBeenCalled();
      });

      it('rejects price above ceiling', async () => {
        prisma.tradeInValuation.findFirst.mockResolvedValue({ basePrice: 10000 });
        await expect(
          service.appraise(
            'ti-1',
            { offeredPrice: 11501, deviceCondition: 'B' },
            'user-1',
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects price below floor (basePrice × 0.85)', async () => {
        prisma.tradeInValuation.findFirst.mockResolvedValue({ basePrice: 10000 });
        await expect(
          service.appraise(
            'ti-1',
            { offeredPrice: 8499, deviceCondition: 'B' },
            'user-1',
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('snapshots basePriceAtAppraisal when valuation found', async () => {
        prisma.tradeInValuation.findFirst.mockResolvedValue({ basePrice: 10000 });
        await service.appraise(
          'ti-1',
          { offeredPrice: 10500, deviceCondition: 'B' },
          'user-1',
        );
        const data = prisma.tradeIn.update.mock.calls[0][0].data;
        expect(data.basePriceAtAppraisal).toBe(10000);
      });

      it('bypasses ceiling when no valuation row exists (unknown spec)', async () => {
        prisma.tradeInValuation.findFirst.mockResolvedValue(null);
        await service.appraise(
          'ti-1',
          { offeredPrice: 99999, deviceCondition: 'B' },
          'user-1',
        );
        // No throw; base price not snapshotted
        const data = prisma.tradeIn.update.mock.calls[0][0].data;
        expect(data.basePriceAtAppraisal).toBeUndefined();
      });
    });

    // ────────────────────────────────────────────────────────────────────────
    // T5-C17: appraisal price lock — once offeredPrice is set, subsequent
    // appraise() calls with a different price must be rejected unless OWNER
    // explicitly forces the change (audited). This prevents staff from
    // re-appraising downward until the seller accepts.
    // ────────────────────────────────────────────────────────────────────────
    describe('T5-C17 appraisal lock', () => {
      it('first appraise sets offeredPrice, firstAppraisedAt and appraisalLocked=true', async () => {
        prisma.tradeIn.findUnique.mockResolvedValue(
          makeTradeIn({ status: 'PENDING_APPRAISAL', appraisalLocked: false, firstAppraisedAt: null }),
        );
        prisma.tradeIn.update.mockResolvedValue(makeTradeIn({ status: 'APPRAISED' }));

        await service.appraise(
          'ti-1',
          { offeredPrice: 5000, deviceCondition: 'B' },
          'user-1',
        );

        const data = prisma.tradeIn.update.mock.calls[0][0].data;
        expect(data.appraisalLocked).toBe(true);
        expect(data.firstAppraisedAt).toBeInstanceOf(Date);
        expect(data.offeredPrice).toBe(5000);
      });

      it('re-appraising with the SAME price on a locked record is an idempotent no-op', async () => {
        const existingTimestamp = new Date('2026-04-01T10:00:00Z');
        const locked = makeTradeIn({
          status: 'APPRAISED',
          offeredPrice: 5000,
          appraisalLocked: true,
          firstAppraisedAt: existingTimestamp,
        });
        prisma.tradeIn.findUnique.mockResolvedValue(locked);

        const result = await service.appraise(
          'ti-1',
          { offeredPrice: 5000, deviceCondition: 'B' },
          'user-1',
        );

        // No update call, no audit log
        expect(prisma.tradeIn.update).not.toHaveBeenCalled();
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
        expect(result).toBe(locked);
      });

      it('re-appraising with a DIFFERENT price on a locked record is rejected (ForbiddenException)', async () => {
        prisma.tradeIn.findUnique.mockResolvedValue(
          makeTradeIn({
            status: 'APPRAISED',
            offeredPrice: 5000,
            appraisalLocked: true,
            firstAppraisedAt: new Date('2026-04-01T10:00:00Z'),
          }),
        );

        await expect(
          service.appraise(
            'ti-1',
            { offeredPrice: 4500, deviceCondition: 'B' },
            'user-1',
          ),
        ).rejects.toThrow(/ตีราคาไปแล้ว|ไม่สามารถแก้ราคาซ้ำ/);

        // No mutations, no audit log
        expect(prisma.tradeIn.update).not.toHaveBeenCalled();
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // accept
  // ──────────────────────────────────────────────────────────────────────────
  describe('accept', () => {
    const baseAcceptDto = {
      idCardVerified: true,
      sellerConsentSigned: true, declarationVersion: TRADE_IN_DECLARATION_VERSION, sellerSignatureBase64: 'data:image/png;base64,dGVzdA==',
      policeReportAcknowledged: true,
      paymentMethod: 'CASH' as const,
    };

    it('throws BadRequestException when status is not APPRAISED', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue(makeTradeIn({ status: 'PENDING_APPRAISAL' }));

      await expect(
        service.accept('ti-1', baseAcceptDto, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when idCard not verified', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue(makeTradeIn({ status: 'APPRAISED' }));

      await expect(
        service.accept('ti-1', { ...baseAcceptDto, idCardVerified: false }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when TRANSFER paymentMethod has no bank details', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue(makeTradeIn({ status: 'APPRAISED' }));

      await expect(
        service.accept(
          'ti-1',
          { ...baseAcceptDto, paymentMethod: 'TRANSFER' as const },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates status to ACCEPTED and copies offeredPrice to agreedPrice', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue(
        makeTradeIn({ status: 'APPRAISED', offeredPrice: 5000 }),
      );
      prisma.tradeIn.update.mockResolvedValue(
        makeTradeIn({ status: 'ACCEPTED', agreedPrice: 5000 }),
      );

      const result = await service.accept('ti-1', baseAcceptDto, 'user-1');

      expect(prisma.tradeIn.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ACCEPTED', sellerDeclarationSnapshot: {
            version: TRADE_IN_DECLARATION_VERSION, text: TRADE_IN_DECLARATION_TEXT,
            acceptedAt: expect.any(String), acceptedByUserId: 'user-1',
          } }),
        }),
      );
      expect(result.agreedPrice).toBe(5000);
    });

    it.each([
      { declarationVersion: 'obsolete' },
      { declarationVersion: undefined },
      { sellerSignatureBase64: undefined },
      { sellerSignatureBase64: '  ' },
    ])('rejects invalid signing evidence before stock or journal writes: %j', async (patch) => {
      prisma.tradeIn.findUnique.mockResolvedValue(makeTradeIn({ status: 'APPRAISED' }));
      await expect(service.accept('ti-1', { ...baseAcceptDto, ...patch } as any, 'user-1')).rejects.toThrow(BadRequestException);
      expect(prisma.product.create).not.toHaveBeenCalled();
      expect(prisma.tradeIn.update).not.toHaveBeenCalled();
      expect(postBuyback).not.toHaveBeenCalled();
    });

    it('does not replace evidence when an accepted record is forced back to APPRAISED', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue(makeTradeIn({ status: 'APPRAISED', idCardVerifiedAt: new Date() }));
      await expect(service.accept('ti-1', baseAcceptDto, 'user-1')).rejects.toThrow('มีหลักฐานการรับเครื่องแล้ว');
      expect(prisma.product.create).not.toHaveBeenCalled();
      expect(prisma.tradeIn.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when seller signature exceeds 200KB', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue(makeTradeIn({ status: 'APPRAISED' }));

      await expect(
        service.accept(
          'ti-1',
          { ...baseAcceptDto, sellerSignatureBase64: 'X'.repeat(200_001) },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // ─── T5-C12: IMEI uniqueness ignores soft-deleted products ─────────────
    describe('T5-C12 IMEI uniqueness — partial unique (deletedAt: null)', () => {
      it('filters `deletedAt: null` in the uniqueness check (query shape)', async () => {
        prisma.tradeIn.findUnique.mockResolvedValue(
          makeTradeIn({ status: 'APPRAISED', imei: '123456789012345', offeredPrice: 5000 }),
        );
        prisma.product.findFirst.mockResolvedValue(null);
        prisma.tradeIn.update.mockResolvedValue(makeTradeIn({ status: 'ACCEPTED' }));

        await service.accept('ti-1', baseAcceptDto, 'user-1');

        expect(prisma.product.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              imeiSerial: '123456789012345',
              deletedAt: null,
            }),
          }),
        );
      });

      it('rejects only when an ACTIVE product owns the IMEI', async () => {
        prisma.tradeIn.findUnique.mockResolvedValue(
          makeTradeIn({ status: 'APPRAISED', imei: '123456789012345', offeredPrice: 5000 }),
        );
        prisma.product.findFirst.mockResolvedValue({
          id: 'prod-active',
          name: 'iPhone 15 Pro',
        });

        await expect(
          service.accept('ti-1', baseAcceptDto, 'user-1'),
        ).rejects.toThrow(BadRequestException);
      });

      it('accepts when the only existing product owning the IMEI is soft-deleted (findFirst returns null)', async () => {
        prisma.tradeIn.findUnique.mockResolvedValue(
          makeTradeIn({ status: 'APPRAISED', imei: '123456789012345', offeredPrice: 5000 }),
        );
        // deletedAt: null filter means the soft-deleted row is invisible
        prisma.product.findFirst.mockResolvedValue(null);
        prisma.tradeIn.update.mockResolvedValue(makeTradeIn({ status: 'ACCEPTED' }));

        await expect(
          service.accept('ti-1', baseAcceptDto, 'user-1'),
        ).resolves.toBeDefined();
        expect(prisma.product.create).toHaveBeenCalled();
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // reject
  // ──────────────────────────────────────────────────────────────────────────
  describe('reject', () => {
    it('throws BadRequestException when status is not APPRAISED', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue(
        makeTradeIn({ status: 'PENDING_APPRAISAL' }),
      );

      await expect(service.reject('ti-1')).rejects.toThrow(BadRequestException);
    });

    it('sets status to REJECTED', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue(makeTradeIn({ status: 'APPRAISED' }));
      prisma.tradeIn.update.mockResolvedValue(makeTradeIn({ status: 'REJECTED' }));

      const result = await service.reject('ti-1');

      expect(prisma.tradeIn.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'REJECTED' } }),
      );
      expect(result.status).toBe('REJECTED');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // complete
  // ──────────────────────────────────────────────────────────────────────────
  describe('complete', () => {
    it('throws BadRequestException when status is not ACCEPTED', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue(makeTradeIn({ status: 'APPRAISED' }));

      await expect(service.complete('ti-1')).rejects.toThrow(BadRequestException);
    });

    it('transitions status to COMPLETED', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue(makeTradeIn({ status: 'ACCEPTED' }));
      prisma.tradeIn.update.mockResolvedValue(makeTradeIn({ status: 'COMPLETED' }));

      const result = await service.complete('ti-1');

      expect(prisma.tradeIn.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'COMPLETED' } }),
      );
      expect(result.status).toBe('COMPLETED');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // checkImei
  // ──────────────────────────────────────────────────────────────────────────
  describe('checkImei', () => {
    it('throws BadRequestException for non-15-digit IMEI', async () => {
      await expect(service.checkImei('12345')).rejects.toThrow(BadRequestException);
    });

    it('returns "clean" when no existing records', async () => {
      prisma.tradeIn.findMany.mockResolvedValue([]);

      const result = await service.checkImei('123456789012345');

      expect(result.result).toBe('clean');
      expect(result.occurrences).toHaveLength(0);
    });

    it('returns "duplicate" when IMEI found in existing records', async () => {
      prisma.tradeIn.findMany.mockResolvedValue([
        { id: 'ti-old', status: 'COMPLETED', createdAt: new Date() },
      ]);

      const result = await service.checkImei('123456789012345');

      expect(result.result).toBe('duplicate');
      expect(result.occurrences).toHaveLength(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PII dual-write (Phase 3)
  // ──────────────────────────────────────────────────────────────────────────
  describe('PII dual-write (Phase 3)', () => {
    beforeEach(() => {
      process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
    });

    afterEach(() => {
      delete process.env.PII_ENCRYPTION_KEY;
    });

    it('encrypts both transfer fields when paymentMethod=TRANSFER', () => {
      const result = (service as any).buildTradeInPiiEncryptedFields({
        paymentMethod: 'TRANSFER',
        transferAccountNumber: '1234567890',
        transferAccountName: 'Mr Test',
      });
      expect(result.transferAccountNumberEncrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
      expect(result.transferAccountNameEncrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    });

    it('returns null encrypted fields when paymentMethod=CASH', () => {
      const result = (service as any).buildTradeInPiiEncryptedFields({
        paymentMethod: 'CASH',
        transferAccountNumber: undefined,
        transferAccountName: undefined,
      });
      expect(result.transferAccountNumberEncrypted).toBeNull();
      expect(result.transferAccountNameEncrypted).toBeNull();
    });

    it('skips encryption when PII_ENCRYPTION_KEY missing (dev fallback)', () => {
      delete process.env.PII_ENCRYPTION_KEY;
      const result = (service as any).buildTradeInPiiEncryptedFields({
        paymentMethod: 'TRANSFER',
        transferAccountNumber: '1234567890',
        transferAccountName: 'Test',
      });
      // Falls back to plaintext when no key
      expect(result.transferAccountNumberEncrypted).toBe('1234567890');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // update — seller info guard after ACCEPTED
  // ──────────────────────────────────────────────────────────────────────────
  describe('update — seller info immutability after accept', () => {
    it('throws BadRequestException when trying to change sellerName after ACCEPTED', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue(makeTradeIn({ status: 'ACCEPTED' }));

      await expect(
        service.update('ti-1', { sellerName: 'ชื่อใหม่' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows non-seller-info fields to be updated after ACCEPTED', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue(makeTradeIn({ status: 'ACCEPTED' }));
      prisma.tradeIn.update.mockResolvedValue(makeTradeIn({ notes: 'updated notes' }));

      await expect(
        service.update('ti-1', { notes: 'updated notes' } as never),
      ).resolves.toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // quickBuy — sellerContactId threading (P2d fix)
  // ──────────────────────────────────────────────────────────────────────────
  describe('quickBuy', () => {
    const baseQuickBuyDto = {
      requestId: '91a8f927-2db2-4b8c-9b2f-1e8ef7bff005',
      sellerName: 'TEST SELLER', sellerPhone: '0000000000', sellerAddress: 'TEST ADDRESS',
      sellerIdCardNumber: '0000000000001', imei: '123456789012345', serialNumber: 'TEST-SN',
      branchId: 'branch-1',
      deviceBrand: 'Apple',
      deviceModel: 'iPhone 15',
      agreedPrice: 18000,
      idCardVerified: true,
      sellerConsentSigned: true, declarationVersion: TRADE_IN_DECLARATION_VERSION, sellerSignatureBase64: 'data:image/png;base64,dGVzdA==',
      paymentMethod: 'CASH' as const,
    };

    it('rejects a stale computed preview before creating seller, device or payout records', async () => {
      const appraisal = { prepareQuickBuy: jest.fn().mockRejectedValue(new ConflictException('price changed')) };
      await expect(service.quickBuy({ ...baseQuickBuyDto, deviceStorage: '128GB',
        answers: [{ questionKey: 'screen', choiceIds: ['intact'] }], previewToken: 'a'.repeat(64) },
      'user-1', 'branch-1', appraisal)).rejects.toThrow(ConflictException);
      expect(appraisal.prepareQuickBuy).toHaveBeenCalled();
      expect(prisma.tradeIn.create).not.toHaveBeenCalled();
      expect(contactResolver.findOrCreateByNaturalKey).not.toHaveBeenCalled();
      expect(storage.upload).not.toHaveBeenCalled();
      expect(postBuyback).not.toHaveBeenCalled();
    });

    it('replays a finished legacy request with its original hash before any price lookup', async () => {
      const payload = { ...baseQuickBuyDto, branchId: 'branch-1', userId: 'user-1' };
      const oldHash = createHash('sha256').update(JSON.stringify(payload, Object.keys(payload).sort())).digest('hex');
      prisma.tradeIn.findUnique.mockResolvedValue(makeTradeIn({ status: 'ACCEPTED', productId: 'prod-1',
        quickBuyRequestedById: 'user-1', quickBuyRequestHash: oldHash }));
      const appraisal = { prepareQuickBuy: jest.fn().mockRejectedValue(new ConflictException('price changed')) };
      await expect(service.quickBuy(baseQuickBuyDto, 'user-1', 'branch-1', appraisal)).resolves.toMatchObject({ productId: 'prod-1' });
      expect(appraisal.prepareQuickBuy).not.toHaveBeenCalled();
      expect(prisma.tradeIn.create).not.toHaveBeenCalled();
    });

    it('persists the server appraisal, buys once and detects changed nested answers on replay', async () => {
      let row: Record<string, unknown> = makeTradeIn({ customerId: null, appraisalLocked: false, updatedAt: new Date() });
      const apply = ({ data }: { data: Record<string, unknown> }) => { row = { ...row, ...data }; return row; };
      prisma.tradeIn.create.mockImplementation(async (input) => apply(input));
      prisma.tradeIn.update.mockImplementation(async (input) => apply(input));
      prisma.tradeIn.updateMany = jest.fn().mockImplementation((input) => { apply(input); return { count: 1 }; });
      prisma.tradeIn.findUnique.mockImplementation(async ({ where }: { where: { quickBuyRequestId?: string } }) =>
        where.quickBuyRequestId && !row.quickBuyRequestId ? null : row);
      const appraisal = { prepareQuickBuy: jest.fn().mockResolvedValue({
        device: { deviceBrand: 'Apple', deviceModel: 'iPhone 12', deviceStorage: '128GB' },
        data: { offeredPrice: new Prisma.Decimal(3825), estimatedValue: new Prisma.Decimal(3825), deviceCondition: 'C',
          basePriceAtAppraisal: new Prisma.Decimal(5000), quoteBreakdown: { price: '3825.00', chosenFlow: 'BUYBACK' },
          conditionAnswers: [{ questionKey: 'body', title: 'Server condition', choices: [{ choiceId: 'scratch' }] }] },
      }) };
      const dto = { ...baseQuickBuyDto, deviceModel: 'iPhone 12', deviceStorage: '128GB', agreedPrice: 3825,
        answers: [{ questionKey: 'body', choiceIds: ['scratch'] }], previewToken: 'a'.repeat(64) };
      const first = await service.quickBuy(dto, 'user-1', 'branch-1', appraisal);
      expect(row).toMatchObject({ status: 'ACCEPTED', flow: 'BUYBACK', appraisalLocked: true, deviceCondition: 'C', appraisedById: 'user-1' });
      expect(prisma.tradeIn.create.mock.calls[0][0].data).toMatchObject({ deviceCondition: 'C',
        conditionAnswers: [{ questionKey: 'body', title: 'Server condition', choices: [{ choiceId: 'scratch' }] }], quoteBreakdown: { price: '3825.00' } });
      expect(prisma.product.create.mock.calls[0][0].data.costPrice.toString()).toBe('3825');
      appraisal.prepareQuickBuy.mockRejectedValue(new ConflictException('configuration changed later'));
      await expect(service.quickBuy(dto, 'user-1', 'branch-1', appraisal)).resolves.toEqual(first);
      await expect(service.quickBuy({ ...dto, answers: [{ questionKey: 'body', choiceIds: ['intact'] }] },
        'user-1', 'branch-1', appraisal)).rejects.toThrow(ConflictException);
      await expect(service.quickBuy(dto, 'other-user', 'branch-1', appraisal)).rejects.toThrow(ConflictException);
      expect(appraisal.prepareQuickBuy).toHaveBeenCalledTimes(1);
      expect(prisma.tradeIn.create).toHaveBeenCalledTimes(1);
      expect(postBuyback).toHaveBeenCalledTimes(1);
    });

    it('records a counter payout as BUYBACK and posts the SHOP purchase journal', async () => {
      // Reproduce the schema default across the real create/appraise/accept path.
      let row: Record<string, unknown> = makeTradeIn({ customerId: null, flow: 'EXCHANGE' });
      prisma.tradeIn.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        row = { ...row, ...data, ...(data.offeredPrice != null ? { offeredPrice: new Prisma.Decimal(String(data.offeredPrice)) } : {}) };
        return row;
      });
      prisma.tradeIn.findUnique.mockImplementation(async ({ where }: { where: { quickBuyRequestId?: string } }) => where.quickBuyRequestId && !row.quickBuyRequestId ? null : row);
      prisma.tradeIn.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        row = { ...row, ...data, ...(data.offeredPrice != null ? { offeredPrice: new Prisma.Decimal(String(data.offeredPrice)) } : {}) };
        return row;
      });

      const result = await service.quickBuy(
        { ...baseQuickBuyDto, sellerName: 'ผู้ขายทดสอบ' }, 'user-1', 'branch-1',
      );

      expect(row).toMatchObject({ flow: 'BUYBACK', status: 'ACCEPTED', productId: 'prod-new-1' });
      expect(postBuyback).toHaveBeenCalledTimes(1);
      expect(postBuyback).toHaveBeenCalledWith(expect.objectContaining({
        tradeInId: row.id, cashAccountCode: 'S11-1101',
      }), prisma);
      expect(result).toMatchObject({ productId: 'prod-new-1' });
    });

    /** Wire up the 4 stages so quickBuy() can run end-to-end in tests */
    function setupQuickBuyMocks() {
      // Stage 1: create
      prisma.tradeIn.findMany.mockResolvedValue([]); // IMEI check
      prisma.tradeIn.create.mockResolvedValue(makeTradeIn({ id: 'ti-qb-1' }));
      // Stage 2: appraise — findUnique returns PENDING_APPRAISAL, update returns APPRAISED
      prisma.tradeIn.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeTradeIn({ id: 'ti-qb-1', status: 'PENDING_APPRAISAL', appraisalLocked: false, firstAppraisedAt: null }))
        .mockResolvedValueOnce(makeTradeIn({ id: 'ti-qb-1', status: 'APPRAISED', offeredPrice: 18000 }))
        // Stage 4: re-fetch for imeiBlacklistResult
        .mockResolvedValueOnce({ imeiBlacklistResult: null });
      prisma.tradeIn.update
        .mockResolvedValueOnce(makeTradeIn({ id: 'ti-qb-1', status: 'APPRAISED', offeredPrice: 18000 }))
        // Stage 3: accept
        .mockResolvedValueOnce(makeTradeIn({ id: 'ti-qb-1', status: 'ACCEPTED', agreedPrice: 18000 }));
    }

    it('threads sellerContactId into create() and does NOT call findOrCreateByNaturalKey', async () => {
      setupQuickBuyMocks();

      await service.quickBuy(
        { ...baseQuickBuyDto, sellerContactId: 'contact-known-42' },
        'user-1',
        'branch-1',
      );

      // Resolver must NOT be called — the known contactId bypasses natural-key lookup
      expect(contactResolver.findOrCreateByNaturalKey).not.toHaveBeenCalled();

      // The sellerContactId must be threaded into the DB create call
      expect(prisma.tradeIn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sellerContactId: 'contact-known-42' }),
        }),
      );
    });

    it('falls back to findOrCreateByNaturalKey when sellerContactId is absent', async () => {
      setupQuickBuyMocks();
      contactResolver.findOrCreateByNaturalKey.mockResolvedValue({ id: 'contact-new-1' });

      await service.quickBuy(
        { ...baseQuickBuyDto, sellerName: 'สมชาย ขายมือสอง' },
        'user-1',
        'branch-1',
      );

      // Resolver IS called when no sellerContactId is provided
      expect(contactResolver.findOrCreateByNaturalKey).toHaveBeenCalled();
    });

    it('throws BadRequestException when no branchId in dto and no userBranchId', async () => {
      await expect(
        service.quickBuy({ ...baseQuickBuyDto, branchId: undefined, sellerName: 'A' }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PII read decryption (Phase 5)
  // ──────────────────────────────────────────────────────────────────────────
  describe('PII read decryption (Phase 5)', () => {
    beforeEach(() => {
      process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
    });
    afterEach(() => {
      delete process.env.PII_ENCRYPTION_KEY;
    });

    it('decrypts transferAccountNumber and transferAccountName when returning trade-in', async () => {
      const key = 'a'.repeat(64);
      prisma.tradeIn.findUnique.mockResolvedValue({
        ...makeTradeIn(),
        transferAccountNumber: 'legacy-1234',
        transferAccountNumberEncrypted: encryptPII('1234567890', key),
        transferAccountName: 'legacy-name',
        transferAccountNameEncrypted: encryptPII('Mr Test', key),
      });
      const result = await service.findOne('t1');
      expect(result.transferAccountNumber).toBe('1234567890');
      expect(result.transferAccountName).toBe('Mr Test');
    });

    it('falls back to legacy plaintext when encrypted column is null', async () => {
      prisma.tradeIn.findUnique.mockResolvedValue({
        ...makeTradeIn(),
        transferAccountNumber: '0987654321',
        transferAccountNumberEncrypted: null,
        transferAccountName: 'Legacy Name',
        transferAccountNameEncrypted: null,
      });
      const result = await service.findOne('t2');
      expect(result.transferAccountNumber).toBe('0987654321');
      expect(result.transferAccountName).toBe('Legacy Name');
    });
  });
});
