import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

describe('VerificationService', () => {
  let service: VerificationService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notifications: any;

  beforeEach(async () => {
    prisma = {
      chatbotOtpRequest: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'otp-1' }),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn(),
      },
      customer: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      customerLineLink: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
      },
      chatRoom: {
        updateMany: jest.fn().mockResolvedValue({}),
      },
      // Separate tx mock to verify service uses tx inside transaction, not this.prisma
      $transaction: jest.fn().mockImplementation((cb) => {
        const tx = {
          customerLineLink: { upsert: jest.fn().mockResolvedValue({}) },
          chatRoom: { updateMany: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      }),
    };
    notifications = {
      sendSmsFromQueue: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(VerificationService);
  });

  describe('requestOtp', () => {
    it('returns masked phone for known customer and sends SMS', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'สมชาย', phone: '0891234567' });

      const result = await service.requestOtp({ lineUserId: 'U123', phone: '0891234567' });

      expect(result.maskedPhone).toBe('089-***-4567');
      expect(result.expiresInSeconds).toBe(300);
      expect(notifications.sendSmsFromQueue).toHaveBeenCalled();
    });

    it('throws for unknown phone with helpful message', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.requestOtp({ lineUserId: 'U123', phone: '0899999999' }),
      ).rejects.toThrow('ไม่พบเบอร์โทรนี้ในระบบ');
      expect(notifications.sendSmsFromQueue).not.toHaveBeenCalled();
    });

    it('throws on invalid phone format', async () => {
      await expect(
        service.requestOtp({ lineUserId: 'U123', phone: '12345' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('normalizes +66 format phone number', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'สมชาย', phone: '0891234567' });

      await service.requestOtp({ lineUserId: 'U123', phone: '66891234567' });

      expect(prisma.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { phone: { in: ['0891234567', '089-123-4567', '089-1234567'] }, deletedAt: null } }),
      );
    });

    it('enforces cooldown (60s)', async () => {
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue({
        lastRequestAt: new Date(), // just now
      });

      await expect(
        service.requestOtp({ lineUserId: 'U123', phone: '0891234567' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyOtp', () => {
    const makeRecord = (hash: string, attempts = 0) => ({
      id: 'otp-1',
      lineUserId: 'U123',
      customerId: 'c1',
      hash,
      expiresAt: new Date(Date.now() + 300_000),
      attempts,
    });

    it('verifies correct OTP and binds customer', async () => {
      // Request OTP first to get the real hash stored by the service
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'สมชาย', phone: '0891234567' });
      await service.requestOtp({ lineUserId: 'U123', phone: '0891234567' });

      // Extract the hash that was actually stored by the service
      const upsertCall = prisma.chatbotOtpRequest.upsert.mock.calls[0][0];
      const storedHash = upsertCall.create.hash;

      // Now mock findUnique to return that hash
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue(makeRecord(storedHash));
      prisma.customer.findUnique.mockResolvedValue({ id: 'c1', name: 'สมชาย' });

      // Extract the OTP that was sent via SMS
      const smsCall = notifications.sendSmsFromQueue.mock.calls[0][1] as string;
      const otpMatch = smsCall.match(/(\d{6})/);
      const otp = otpMatch![1];

      const result = await service.verifyOtp({ lineUserId: 'U123', otp });

      expect(result.customerId).toBe('c1');
      expect(result.customerName).toBe('สมชาย');
      expect(prisma.chatbotOtpRequest.delete).toHaveBeenCalled();
    });

    it('throws on expired OTP', async () => {
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue({
        id: 'otp-1',
        expiresAt: new Date(Date.now() - 1000), // expired
        attempts: 0,
      });

      await expect(
        service.verifyOtp({ lineUserId: 'U123', otp: '123456' }),
      ).rejects.toThrow('หมดอายุ');
    });

    it('throws on max attempts exceeded', async () => {
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue({
        id: 'otp-1',
        expiresAt: new Date(Date.now() + 300_000),
        attempts: 3, // max
      });

      await expect(
        service.verifyOtp({ lineUserId: 'U123', otp: '123456' }),
      ).rejects.toThrow('เกินจำนวนครั้ง');
    });

    it('increments attempts on wrong OTP', async () => {
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue(makeRecord('wrong-hash', 0));
      prisma.chatbotOtpRequest.update.mockResolvedValue({ attempts: 1 });

      await expect(
        service.verifyOtp({ lineUserId: 'U123', otp: '999999' }),
      ).rejects.toThrow('ไม่ถูกต้อง');
      expect(prisma.chatbotOtpRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { attempts: { increment: 1 } } }),
      );
    });

    it('throws when no OTP record exists', async () => {
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyOtp({ lineUserId: 'U123', otp: '123456' }),
      ).rejects.toThrow('ขอ OTP ใหม่');
    });
  });

  describe('isLinked', () => {
    it('returns linked=true for active link', async () => {
      prisma.customerLineLink.findUnique.mockResolvedValue({
        unlinkedAt: null,
        customer: { id: 'c1', name: 'สมชาย' },
      });

      const result = await service.isLinked('U123');
      expect(result.linked).toBe(true);
      expect(result.customerId).toBe('c1');
    });

    it('returns linked=false for unlinked record', async () => {
      prisma.customerLineLink.findUnique.mockResolvedValue({
        unlinkedAt: new Date(),
        customer: { id: 'c1', name: 'สมชาย' },
      });

      const result = await service.isLinked('U123');
      expect(result.linked).toBe(false);
    });

    it('returns linked=false when no record', async () => {
      prisma.customerLineLink.findUnique.mockResolvedValue(null);
      const result = await service.isLinked('U123');
      expect(result.linked).toBe(false);
    });
  });
});
