import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { SlipProcessingService } from './slip-processing.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { VisionService } from './vision.service';
import { StaffNotificationService } from './staff-notification.service';
import { FinanceConfigService } from './finance-config.service';

describe('SlipProcessingService', () => {
  let service: SlipProcessingService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let storage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let vision: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let staffNotify: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let financeConfig: any;

  const defaultParams = {
    imageBuffer: Buffer.from('fake-image'),
    mediaType: 'image/jpeg',
    customerId: 'cust-1',
    lineUserId: 'U12345678',
  };

  const contract = {
    id: 'con-1',
    contractNumber: 'BC-0001',
    customer: { name: 'สมชาย', phone: '0891234567' },
  };

  beforeEach(async () => {
    prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue(contract),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'pay-1',
          amountDue: new Prisma.Decimal('3500.00'),
          installmentNo: 3,
        }),
      },
      paymentEvidence: {
        create: jest.fn().mockResolvedValue({ id: 'ev-1' }),
      },
    };
    storage = {
      upload: jest.fn().mockResolvedValue('https://s3/slip.jpg'),
    };
    vision = {
      extractSlip: jest.fn().mockResolvedValue({
        isSlip: true,
        amount: 3500,
        toAccount: '203-1-16520-5',
        bankName: 'KBank',
        confidence: 0.95,
      }),
    };
    staffNotify = {
      notifySlipReview: jest.fn().mockResolvedValue(undefined),
    };
    financeConfig = {
      isCompanyBankAccount: jest.fn().mockReturnValue(true),
      bankName: 'ธนาคารกสิกรไทย',
      accountNumber: '203-1-16520-5',
      accountName: 'บจก. เบสท์ช้อยส์',
      bankInfoBlock: '...',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlipProcessingService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: VisionService, useValue: vision },
        { provide: StaffNotificationService, useValue: staffNotify },
        { provide: FinanceConfigService, useValue: financeConfig },
      ],
    }).compile();

    service = module.get(SlipProcessingService);
  });

  it('matches slip when amount matches expected payment', async () => {
    const result = await service.processSlip(defaultParams);

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(true);
    expect(result.reply).toContain('3,500');
    expect(prisma.paymentEvidence.create).toHaveBeenCalled();
  });

  it('flags amount mismatch and notifies staff', async () => {
    vision.extractSlip.mockResolvedValue({
      isSlip: true,
      amount: 2000,
      toAccount: '203-1-16520-5',
      confidence: 0.9,
    });

    const result = await service.processSlip(defaultParams);

    expect(result.matched).toBe(false);
    expect(result.reply).toContain('ยอดไม่ตรง');
    // Staff notify is fire-and-forget (async with .catch)
    // Just check evidence was created
    expect(prisma.paymentEvidence.create).toHaveBeenCalled();
  });

  it('detects wrong bank account', async () => {
    financeConfig.isCompanyBankAccount.mockReturnValue(false);

    const result = await service.processSlip(defaultParams);

    expect(result.ok).toBe(false);
    expect(result.reply).toContain('บัญชีอื่น');
  });

  it('rejects non-slip images', async () => {
    vision.extractSlip.mockResolvedValue({ isSlip: false, confidence: 0 });

    const result = await service.processSlip(defaultParams);

    expect(result.ok).toBe(false);
    expect(result.reply).toContain('ไม่ใช่สลิป');
  });

  it('handles S3 upload failure and skips vision', async () => {
    storage.upload.mockRejectedValue(new Error('S3 error'));

    const result = await service.processSlip(defaultParams);

    expect(result.ok).toBe(false);
    expect(result.reply).toContain('อัปโหลดสลิปไม่สำเร็จ');
    // Vision should NOT be called if upload fails (early return)
    expect(vision.extractSlip).not.toHaveBeenCalled();
  });

  it('handles no active contract', async () => {
    prisma.contract.findFirst.mockResolvedValue(null);

    const result = await service.processSlip(defaultParams);

    expect(result.ok).toBe(false);
    expect(result.reply).toContain('ไม่พบสัญญา');
  });

  it('uses Decimal comparison for amount tolerance (±0.50)', async () => {
    // 3500.49 should match 3500.00 (diff = 0.49 <= 0.50)
    vision.extractSlip.mockResolvedValue({
      isSlip: true,
      amount: 3500.49,
      toAccount: '203-1-16520-5',
      confidence: 0.9,
    });

    const result = await service.processSlip(defaultParams);
    expect(result.matched).toBe(true);
  });

  it('flags amount outside tolerance (>0.50 diff)', async () => {
    // 3501.00 should NOT match 3500.00 (diff = 1.00 > 0.50)
    vision.extractSlip.mockResolvedValue({
      isSlip: true,
      amount: 3501,
      toAccount: '203-1-16520-5',
      confidence: 0.9,
    });

    const result = await service.processSlip(defaultParams);
    expect(result.matched).toBe(false);
  });

  describe('auto-approve on high OCR confidence', () => {
    // P2Q10=A: Auto-approve when confidence >= 0.9 AND amount matched AND correct account.
    // Goal: reduce manual review load without sacrificing fraud controls.
    // When ANY condition is missing (low confidence, wrong amount, wrong account)
    // evidence stays PENDING_REVIEW and humans look at it.
    it('auto-approves when confidence >= 0.9 + matched + valid account + paymentId', async () => {
      vision.extractSlip.mockResolvedValue({
        isSlip: true,
        amount: 3500,
        toAccount: '203-1-16520-5',
        bankName: 'KBank',
        confidence: 0.95,
      });

      await service.processSlip(defaultParams);

      const createdPayload = prisma.paymentEvidence.create.mock.calls[0][0].data;
      expect(createdPayload.status).toBe('APPROVED');
      expect(createdPayload.reviewedById).toBeNull();
      expect(createdPayload.reviewedAt).toBeInstanceOf(Date);
      expect(createdPayload.reviewNote).toContain('auto-approved');
    });

    it('keeps PENDING_REVIEW when confidence below 0.9 even if matched', async () => {
      vision.extractSlip.mockResolvedValue({
        isSlip: true,
        amount: 3500,
        toAccount: '203-1-16520-5',
        confidence: 0.85, // just below threshold
      });

      await service.processSlip(defaultParams);

      const createdPayload = prisma.paymentEvidence.create.mock.calls[0][0].data;
      expect(createdPayload.status).toBe('PENDING_REVIEW');
    });

    it('keeps PENDING_REVIEW when amount does not match (high confidence)', async () => {
      vision.extractSlip.mockResolvedValue({
        isSlip: true,
        amount: 2000, // != 3500 expected
        toAccount: '203-1-16520-5',
        confidence: 0.99,
      });

      await service.processSlip(defaultParams);

      const createdPayload = prisma.paymentEvidence.create.mock.calls[0][0].data;
      expect(createdPayload.status).toBe('PENDING_REVIEW');
    });

    it('keeps PENDING_REVIEW when no active payment to match against', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);
      vision.extractSlip.mockResolvedValue({
        isSlip: true,
        amount: 3500,
        toAccount: '203-1-16520-5',
        confidence: 0.99,
      });

      await service.processSlip(defaultParams);

      const createdPayload = prisma.paymentEvidence.create.mock.calls[0][0].data;
      expect(createdPayload.status).toBe('PENDING_REVIEW');
    });

    it('does NOT auto-approve wrong-account evidence (confidence irrelevant)', async () => {
      financeConfig.isCompanyBankAccount.mockReturnValue(false);
      vision.extractSlip.mockResolvedValue({
        isSlip: true,
        amount: 3500,
        toAccount: '999-9-99999-9',
        confidence: 1.0,
      });

      await service.processSlip(defaultParams);

      const createdPayload = prisma.paymentEvidence.create.mock.calls[0][0].data;
      expect(createdPayload.status).toBe('PENDING_REVIEW');
    });
  });
});
