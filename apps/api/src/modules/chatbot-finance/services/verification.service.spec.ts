import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { TestModeService } from '../../test-mode/test-mode.service';
import { AuditService } from '../../audit/audit.service';
import { CustomerMergeService } from '../../chat-prospects/customer-merge.service';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';

describe('VerificationService', () => {
  let service: VerificationService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notifications: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let testMode: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;

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
          customer: { update: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      }),
    };
    notifications = {
      sendSmsFromQueue: jest.fn().mockResolvedValue(undefined),
    };
    testMode = {
      // Default OFF — existing tests assert byte-for-byte existing behavior.
      isEnabled: jest.fn().mockResolvedValue(false),
    };
    audit = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: TestModeService, useValue: testMode },
        { provide: AuditService, useValue: audit },
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

    it('แถวที่คืนมาไม่มีเบอร์ (ผู้สนใจจากแชท) → ปฏิเสธเหมือนไม่พบ ไม่ออก OTP ไม่ส่ง SMS', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c-chat', name: 'Facebook #a1b2', phone: null });

      await expect(
        service.requestOtp({ lineUserId: 'U123', phone: '0891234567' }),
      ).rejects.toThrow('ไม่พบเบอร์โทรนี้ในระบบ');
      expect(prisma.chatbotOtpRequest.upsert).not.toHaveBeenCalled();
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

    // ─── test-mode skips real SMS send (OWNER-gated UAT) ───
    describe('test-mode skip-send', () => {
      it('ON: skips the real SMS send but still upserts the OTP row and returns success', async () => {
        testMode.isEnabled.mockResolvedValue(true);
        prisma.customer.findFirst.mockResolvedValue({
          id: 'c1',
          name: 'สมชาย',
          phone: '0891234567',
        });

        const result = await service.requestOtp({ lineUserId: 'U123', phone: '0891234567' });

        // No real SMS during UAT.
        expect(notifications.sendSmsFromQueue).not.toHaveBeenCalled();
        // Pending OTP row MUST still be created (verify-bypass precondition + UI countdown).
        expect(prisma.chatbotOtpRequest.upsert).toHaveBeenCalled();
        // Success return preserved.
        expect(result.maskedPhone).toBe('089-***-4567');
        expect(result.expiresInSeconds).toBe(300);
      });

      it('OFF: sends SMS normally (existing behavior)', async () => {
        testMode.isEnabled.mockResolvedValue(false);
        prisma.customer.findFirst.mockResolvedValue({
          id: 'c1',
          name: 'สมชาย',
          phone: '0891234567',
        });

        await service.requestOtp({ lineUserId: 'U123', phone: '0891234567' });

        expect(notifications.sendSmsFromQueue).toHaveBeenCalled();
        expect(prisma.chatbotOtpRequest.upsert).toHaveBeenCalled();
      });
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

    // ─────────────────────────────────────────────────────────────
    // Test-mode bypass (Task 5 — test-mode-bypass feature)
    // ─────────────────────────────────────────────────────────────
    describe('test-mode bypass', () => {
      it('ON: succeeds with wrong OTP, replicates success mutations, writes audit', async () => {
        testMode.isEnabled.mockResolvedValue(true);
        // Pending OTP session exists (wrong hash — would normally fail).
        prisma.chatbotOtpRequest.findUnique.mockResolvedValue(makeRecord('wrong-hash'));
        prisma.customer.findUnique.mockResolvedValue({ id: 'c1', name: 'สมชาย' });

        const result = await service.verifyOtp({ lineUserId: 'U123', otp: '999999' });

        // Same success return shape as the real success branch.
        expect(result.customerId).toBe('c1');
        expect(result.customerName).toBe('สมชาย');
        // Success mutations replicated: bind (transaction) + delete OTP row.
        expect(prisma.$transaction).toHaveBeenCalled();
        expect(prisma.chatbotOtpRequest.delete).toHaveBeenCalled();
        // Audit written with the bypass action.
        expect(audit.log).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'LIFF_OTP_BYPASSED_TEST_MODE' }),
        );
        // The wrong-OTP attempt increment must NOT run (code check skipped).
        expect(prisma.chatbotOtpRequest.update).not.toHaveBeenCalled();
      });

      it('ON: still requires an existing pending OTP session', async () => {
        testMode.isEnabled.mockResolvedValue(true);
        prisma.chatbotOtpRequest.findUnique.mockResolvedValue(null);

        await expect(
          service.verifyOtp({ lineUserId: 'U123', otp: '999999' }),
        ).rejects.toThrow('ขอ OTP ใหม่');
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(audit.log).not.toHaveBeenCalled();
      });

      it('OFF: wrong OTP still fails (existing validation unchanged)', async () => {
        testMode.isEnabled.mockResolvedValue(false);
        prisma.chatbotOtpRequest.findUnique.mockResolvedValue(makeRecord('wrong-hash', 0));
        prisma.chatbotOtpRequest.update.mockResolvedValue({ attempts: 1 });

        await expect(
          service.verifyOtp({ lineUserId: 'U123', otp: '999999' }),
        ).rejects.toThrow('ไม่ถูกต้อง');
        expect(audit.log).not.toHaveBeenCalled();
      });
    });

    // ─────────────────────────────────────────────────────────────
    // Fix round 1 — Finding I1 / Ruling R11: absorbRoomsOfLineUser before bind()
    // ─────────────────────────────────────────────────────────────
    it('ไม่มี CustomerMergeService ต่อสาย (@Optional เป็น undefined) → verifyOtp ยัง bind() สำเร็จตามปกติ', async () => {
      // ใช้ service/prisma จาก beforeEach หลักของไฟล์นี้ตรงๆ — ไม่ได้ provide CustomerMergeService
      // เลย ⇒ @Optional() ทำให้ merge = undefined ข้างใน service — พิสูจน์ absorbRoomsBeforeBind
      // ไม่ throw เมื่อไม่มี merge และ bind() ยังรันต่อเหมือนก่อน Task 10 ทุกประการ
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'สมชาย', phone: '0891234567' });
      await service.requestOtp({ lineUserId: 'U123', phone: '0891234567' });
      const upsertCall = prisma.chatbotOtpRequest.upsert.mock.calls[0][0];
      const storedHash = upsertCall.create.hash;
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue(makeRecord(storedHash));
      prisma.customer.findUnique.mockResolvedValue({ id: 'c1', name: 'สมชาย' });
      const smsCall = notifications.sendSmsFromQueue.mock.calls[0][1] as string;
      const otp = smsCall.match(/(\d{6})/)![1];

      const result = await service.verifyOtp({ lineUserId: 'U123', otp });

      expect(result.customerId).toBe('c1');
      expect(prisma.$transaction).toHaveBeenCalled(); // bind() รันจริง
      expect(prisma.chatbotOtpRequest.delete).toHaveBeenCalled();
    });

    describe('Fix round 1 — R11: absorbRoomsOfLineUser called before bind()', () => {
      let mergedPrisma: any;
      let mergedNotifications: any;
      let mergedTestMode: any;
      let mergedAudit: any;
      let merge: any;
      let mergedService: VerificationService;

      beforeEach(async () => {
        mergedPrisma = {
          chatbotOtpRequest: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({ id: 'otp-1' }),
            delete: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            update: jest.fn(),
          },
          customer: { findFirst: jest.fn(), findUnique: jest.fn() },
          customerLineLink: { findUnique: jest.fn(), upsert: jest.fn().mockResolvedValue({}) },
          chatRoom: { updateMany: jest.fn().mockResolvedValue({}) },
          $transaction: jest.fn().mockImplementation((cb) => {
            const tx = {
              customerLineLink: { upsert: jest.fn().mockResolvedValue({}) },
              chatRoom: { updateMany: jest.fn().mockResolvedValue({}) },
              customer: { update: jest.fn().mockResolvedValue({}) },
            };
            return cb(tx);
          }),
        };
        mergedNotifications = { sendSmsFromQueue: jest.fn().mockResolvedValue(undefined) };
        mergedTestMode = { isEnabled: jest.fn().mockResolvedValue(false) };
        mergedAudit = { log: jest.fn().mockResolvedValue(undefined) };
        merge = { absorbRoomsOfLineUser: jest.fn().mockResolvedValue({ absorbed: 1, linked: 0 }) };

        const module: TestingModule = await Test.createTestingModule({
          providers: [
            VerificationService,
            { provide: PrismaService, useValue: mergedPrisma },
            { provide: NotificationsService, useValue: mergedNotifications },
            { provide: TestModeService, useValue: mergedTestMode },
            { provide: AuditService, useValue: mergedAudit },
            { provide: CustomerMergeService, useValue: merge },
          ],
        }).compile();

        mergedService = module.get(VerificationService);
      });

      it('real-verify branch: เรียก absorbRoomsOfLineUser(lineUserId, LINE_FINANCE, customerId, SYSTEM_ACTOR) ก่อน bind() เสมอ', async () => {
        mergedPrisma.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'สมชาย', phone: '0891234567' });
        await mergedService.requestOtp({ lineUserId: 'U123', phone: '0891234567' });
        const upsertCall = mergedPrisma.chatbotOtpRequest.upsert.mock.calls[0][0];
        const storedHash = upsertCall.create.hash;
        mergedPrisma.chatbotOtpRequest.findUnique.mockResolvedValue(makeRecord(storedHash));
        mergedPrisma.customer.findUnique.mockResolvedValue({ id: 'c1', name: 'สมชาย' });
        const smsCall = mergedNotifications.sendSmsFromQueue.mock.calls[0][1] as string;
        const otp = smsCall.match(/(\d{6})/)![1];

        const callOrder: string[] = [];
        merge.absorbRoomsOfLineUser.mockImplementation(async () => {
          callOrder.push('absorb');
          return { absorbed: 1, linked: 0 };
        });
        mergedPrisma.$transaction.mockImplementation((cb: any) => {
          callOrder.push('bind');
          const tx = {
            customerLineLink: { upsert: jest.fn().mockResolvedValue({}) },
            chatRoom: { updateMany: jest.fn().mockResolvedValue({}) },
            customer: { update: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        });

        await mergedService.verifyOtp({ lineUserId: 'U123', otp });

        expect(merge.absorbRoomsOfLineUser).toHaveBeenCalledWith(
          'U123', 'LINE_FINANCE', 'c1', { id: 'system', role: 'SYSTEM' },
        );
        expect(callOrder).toEqual(['absorb', 'bind']); // absorb ก่อน bind() เสมอ ไม่ใช่ทีหลัง
      });

      it('test-mode-bypass branch: absorb ล้ม (เช่น placeholder มีเอกสารพ่วง) → ยัง bind() สำเร็จ (best-effort)', async () => {
        mergedTestMode.isEnabled.mockResolvedValue(true);
        mergedPrisma.chatbotOtpRequest.findUnique.mockResolvedValue(makeRecord('wrong-hash'));
        mergedPrisma.customer.findUnique.mockResolvedValue({ id: 'c1', name: 'สมชาย' });
        merge.absorbRoomsOfLineUser.mockRejectedValue(new Error('รวมไม่ได้: ผู้สนใจคนนี้มีใบจอง 1 รายการ'));

        const result = await mergedService.verifyOtp({ lineUserId: 'U123', otp: '999999' });

        expect(result.customerId).toBe('c1');
        expect(merge.absorbRoomsOfLineUser).toHaveBeenCalledWith(
          'U123', 'LINE_FINANCE', 'c1', { id: 'system', role: 'SYSTEM' },
        );
        expect(mergedPrisma.$transaction).toHaveBeenCalled(); // bind() ยังรันต่อแม้ absorb ล้ม
        expect(mergedPrisma.chatbotOtpRequest.delete).toHaveBeenCalled();
      });
    });

    describe('LINE_LINKED หลัง bind() commit', () => {
      let jPrisma: any;
      let upsert: jest.Mock;
      let journey: { recordAfterCommit: jest.Mock };
      let jService: VerificationService;
      let order: string[];

      beforeEach(async () => {
        order = [];
        upsert = jest.fn().mockResolvedValue({});
        jPrisma = {
          chatbotOtpRequest: {
            findUnique: jest.fn().mockResolvedValue(makeRecord('ignored-in-test-mode')),
            delete: jest.fn().mockResolvedValue({}),
          },
          customer: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', name: 'สมชาย' }) },
          customerLineLink: { findUnique: jest.fn().mockResolvedValue(null) },
          $transaction: jest.fn().mockImplementation(async (cb: any) => {
            const result = await cb({
              customerLineLink: { upsert },
              chatRoom: { updateMany: jest.fn().mockResolvedValue({}) },
              customer: { update: jest.fn().mockResolvedValue({}) },
            });
            order.push('commit');
            return result;
          }),
        };
        journey = {
          recordAfterCommit: jest.fn().mockImplementation(async () => {
            order.push('journey');
          }),
        };
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            VerificationService,
            { provide: PrismaService, useValue: jPrisma },
            { provide: NotificationsService, useValue: { sendSmsFromQueue: jest.fn() } },
            // test-mode bypass: ข้ามการเทียบ hash แต่ผ่าน bind() เส้นเดียวกับยืนยันจริง
            { provide: TestModeService, useValue: { isEnabled: jest.fn().mockResolvedValue(true) } },
            { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
            { provide: JourneyEntryWriter, useValue: journey },
          ],
        }).compile();
        jService = module.get(VerificationService);
      });

      it('ยืนยันสำเร็จ → LINE_LINKED {FINANCE, VERIFICATION} หลัง transaction commit · linkedAt ตรงกับ occurredAt · ไม่มี LINE user id ในแถว', async () => {
        await jService.verifyOtp({ lineUserId: 'U123', otp: '999999' });

        expect(order).toEqual(['commit', 'journey']);
        const entry = journey.recordAfterCommit.mock.calls[0][0];
        expect(entry).toMatchObject({
          customerId: 'c1',
          kind: 'LINE_LINKED',
          actorType: 'CUSTOMER',
          actorUserId: null,
          data: { channel: 'FINANCE', via: 'VERIFICATION' },
        });
        expect(entry.dedupeKey).toBe(`LINE_LINKED:FINANCE:c1:${entry.occurredAt.getTime()}`);
        expect(upsert.mock.calls[0][0].update.linkedAt).toEqual(entry.occurredAt);
        expect(JSON.stringify(entry)).not.toContain('U123');
        expect(jPrisma.customerLineLink.findUnique).toHaveBeenCalledWith({
          where: { lineUserId_channel: { lineUserId: 'U123', channel: 'FINANCE' } },
          select: { customerId: true, unlinkedAt: true, deletedAt: true },
        });
      });

      it('ยืนยันซ้ำกับลูกค้าคนเดิมที่ยังผูกอยู่ → ไม่นับเป็นการผูกใหม่ ไม่บันทึก', async () => {
        jPrisma.customerLineLink.findUnique.mockResolvedValue({ customerId: 'c1', unlinkedAt: null, deletedAt: null });
        await jService.verifyOtp({ lineUserId: 'U123', otp: '999999' });
        expect(order).toEqual(['commit']);
        expect(journey.recordAfterCommit).not.toHaveBeenCalled();
      });

      it('LINE นี้เคยผูกลูกค้าคนอื่น หรือเคยถูกยกเลิก → นับเป็นการผูกใหม่', async () => {
        jPrisma.customerLineLink.findUnique.mockResolvedValueOnce({ customerId: 'c-old', unlinkedAt: null, deletedAt: null });
        await jService.verifyOtp({ lineUserId: 'U123', otp: '999999' });
        jPrisma.customerLineLink.findUnique.mockResolvedValueOnce({ customerId: 'c1', unlinkedAt: new Date('2026-09-01T00:00:00.000Z'), deletedAt: null });
        await jService.verifyOtp({ lineUserId: 'U123', otp: '999999' });
        expect(journey.recordAfterCommit).toHaveBeenCalledTimes(2);
      });

      it('transaction ของ bind() ล้ม → ไม่บันทึก และ verifyOtp โยนต่อ', async () => {
        jPrisma.$transaction.mockRejectedValue(new Error('deadlock'));
        await expect(jService.verifyOtp({ lineUserId: 'U123', otp: '999999' })).rejects.toThrow('deadlock');
        expect(journey.recordAfterCommit).not.toHaveBeenCalled();
      });
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

  // ─────────────────────────────────────────────────────────────
  // T4-C9: per-lineUserId lookup rate limit
  // ─────────────────────────────────────────────────────────────
  describe('T4-C9 per-lineUserId lookup rate limit', () => {
    beforeEach(() => {
      service._resetLookupTrackerForTests();
    });

    it('allows 3 successful lookups in a row (counter clears on success)', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'c1',
        name: 'สมชาย',
        phone: '0891234567',
      });

      for (let i = 0; i < 3; i++) {
        await expect(
          service.requestOtp({ lineUserId: 'U-success', phone: '0891234567' }),
        ).resolves.toBeDefined();
        // reset cooldown row so next iteration isn't blocked by it
        prisma.chatbotOtpRequest.findUnique.mockResolvedValue(null);
      }
      expect(notifications.sendSmsFromQueue).toHaveBeenCalledTimes(3);
    });

    it('locks lineUserId after 3 failed lookups', async () => {
      // Unknown phone — service throws on each call
      prisma.customer.findFirst.mockResolvedValue(null);

      // 3 failing lookups
      for (let i = 0; i < 3; i++) {
        await expect(
          service.requestOtp({ lineUserId: 'U-bad', phone: '0810000000' }),
        ).rejects.toThrow(BadRequestException);
      }

      // 4th attempt — locked message ("รออีก … วินาที")
      await expect(
        service.requestOtp({ lineUserId: 'U-bad', phone: '0810000000' }),
      ).rejects.toThrow(/รออีก/);
    });

    it('lock expires after 30 minutes (jest fake timers)', async () => {
      jest.useFakeTimers();
      try {
        prisma.customer.findFirst.mockResolvedValue(null);
        for (let i = 0; i < 3; i++) {
          await expect(
            service.requestOtp({ lineUserId: 'U-exp', phone: '0810000000' }),
          ).rejects.toThrow(BadRequestException);
        }

        // Immediately locked
        await expect(
          service.requestOtp({ lineUserId: 'U-exp', phone: '0810000000' }),
        ).rejects.toThrow(/รออีก/);

        // Advance 31 minutes — lock should be released
        jest.advanceTimersByTime(31 * 60 * 1000);

        // Now we're back to "normal not-found" behavior
        await expect(
          service.requestOtp({ lineUserId: 'U-exp', phone: '0810000000' }),
        ).rejects.toThrow(/ไม่พบเบอร์โทรนี้ในระบบ/);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
