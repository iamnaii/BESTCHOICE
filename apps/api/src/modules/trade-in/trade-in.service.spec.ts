import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TradeInService } from './trade-in.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TradeInVoucherService } from './services/voucher.service';

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
    sellerIdCardNumber: null,
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

  beforeEach(async () => {
    prisma = {
      tradeIn: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      customer: {
        findUnique: jest.fn(),
      },
      product: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'prod-new-1' }),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeInService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: TradeInVoucherService, useValue: voucher },
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
  });

  // ──────────────────────────────────────────────────────────────────────────
  // accept
  // ──────────────────────────────────────────────────────────────────────────
  describe('accept', () => {
    const baseAcceptDto = {
      idCardVerified: true,
      sellerConsentSigned: true,
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
          data: expect.objectContaining({ status: 'ACCEPTED' }),
        }),
      );
      expect(result.agreedPrice).toBe(5000);
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
});
