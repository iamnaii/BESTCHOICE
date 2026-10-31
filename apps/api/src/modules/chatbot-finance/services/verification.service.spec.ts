import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  VerificationService,
  CUSTOMER_LINKED_TO_OTHER_LINE_MESSAGE,
  LINE_LINK_NEEDS_STAFF_MESSAGE,
} from './verification.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { TestModeService } from '../../test-mode/test-mode.service';
import { AuditService } from '../../audit/audit.service';
import { CustomerMergeService } from '../../chat-prospects/customer-merge.service';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { RichMenuService } from '../../line-oa/rich-menu/rich-menu.service';
import { FinanceLineLockSetUnstableError } from '../../line-oa/services/finance-line-link';

/** Task 33 — หน้า LIFF ส่งความยินยอมมาพร้อมรหัสเสมอ (DTO บังคับ) · bind บันทึก pdpa_consents ใน tx เดียวกัน */
const GRANTED_CONSENT = { granted: true } as const;
const CONSENT_GRANTED_AT = new Date('2026-10-31T03:00:00.000Z');
const CONSENT_TX_MOCK = () => ({
  findFirst: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockResolvedValue({ id: 'consent-1', grantedAt: CONSENT_GRANTED_AT }),
});

type OtpRowMock = {
  [method: string]: jest.Mock | undefined;
  findUnique: jest.Mock;
  updateManyAndReturn?: jest.Mock;
  updateMany?: jest.Mock;
  createMany?: jest.Mock;
  deleteMany?: jest.Mock;
};

/**
 * Task 20 I1 — ทำให้ mock ของ chatbotOtpRequest ตอบแบบ Postgres:
 * - `updateManyAndReturn` = UPDATE … SET attempts+1 WHERE attempts < max AND expires_at > now RETURNING
 *   (อ่านแถวจาก findUnique mock ของเทสนั้น ๆ)
 * - `createMany` / `updateMany` / `deleteMany` = แถวนับเพดานขอ OTP ต่อลูกค้า (ค่าเริ่มต้น: ยังไม่ถึงเพดาน)
 */
function withOtpRowMocks<T extends OtpRowMock>(otp: T): T {
  otp.updateManyAndReturn = jest.fn(
    async (args: {
      where: { lineUserId: string; attempts: { lt: number }; expiresAt: { gt: Date } };
    }) => {
      const row = await otp.findUnique({ where: { lineUserId: args.where.lineUserId } });
      if (!row || row.attempts >= args.where.attempts.lt) return [];
      if (!(row.expiresAt > args.where.expiresAt.gt)) return [];
      return [{ ...row, attempts: row.attempts + 1 }];
    },
  );
  otp.updateMany = otp.updateMany ?? jest.fn().mockResolvedValue({ count: 1 });
  otp.createMany = otp.createMany ?? jest.fn().mockResolvedValue({ count: 1 });
  otp.deleteMany = otp.deleteMany ?? jest.fn().mockResolvedValue({ count: 0 });
  return otp;
}

type LockSeam = {
  withOtpRequestLock: (id: string, fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
};

/**
 * Task 20 fix round 1 — unit spec ไม่มี Postgres: ข้าม advisory lock (I-B — พิสูจน์ใน
 * verification-otp-limits.db.spec.ts) โดยส่ง mock prisma เป็น tx · ปิดเวลาตอบขั้นต่ำ (M1 — มีเทสแยก)
 */
function useUnitSeams(service: VerificationService, prisma: unknown): void {
  jest
    .spyOn(service as unknown as LockSeam, 'withOtpRequestLock')
    .mockImplementation((_id, fn) => fn(prisma));
  service._setResponseFloorForTests(0);
}

/** ปล่อยงานส่ง SMS ที่ไม่ได้ await (M1) ให้จบก่อนตรวจ */
async function flushSmsDispatch(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

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
      chatbotOtpRequest: withOtpRowMocks({
        findUnique: jest.fn().mockResolvedValue(null),
        // upsert … RETURNING — writeOtpRow อ่าน attempts ของแถวหลังเขียน (Task 21 R-1)
        upsert: jest.fn().mockResolvedValue({ id: 'otp-1', attempts: 0 }),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn(),
      }),
      customer: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      customerLineLink: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
      },
      chatRoom: {
        updateMany: jest.fn().mockResolvedValue({}),
      },
      // Separate tx mock to verify service uses tx inside transaction, not this.prisma
      $transaction: jest.fn().mockImplementation((cb) => {
        const tx = {
          customerLineLink: {
            upsert: jest.fn().mockResolvedValue({}),
            findUnique: jest.fn().mockResolvedValue(null),
          },
          chatRoom: { updateMany: jest.fn().mockResolvedValue({}) },
          pDPAConsent: CONSENT_TX_MOCK(),
          // Task 29 — bind ล็อกแถวลูกค้าก่อน (lockCustomersForFinanceLineBind)
          $queryRaw: jest.fn().mockResolvedValue([]),
          customer: {
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
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
    useUnitSeams(service, prisma);
  });

  describe('requestOtp', () => {
    it('returns masked phone for known customer and sends SMS', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'สมชาย', phone: '0891234567' });

      const result = await service.requestOtp({ lineUserId: 'U123', phone: '0891234567' });

      expect(result.maskedPhone).toBe('089-***-4567');
      expect(result.expiresInSeconds).toBe(300);
      expect(notifications.sendSmsFromQueue).toHaveBeenCalled();
    });

    it('M4: unknown phone → same response as a real customer (no enumeration) · decoy row · no SMS', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      const result = await service.requestOtp({ lineUserId: 'U123', phone: '0899999999' });

      expect(result).toEqual({ maskedPhone: '089-***-9999', expiresInSeconds: 300 });
      expect(notifications.sendSmsFromQueue).not.toHaveBeenCalled();
      const upsert = prisma.chatbotOtpRequest.upsert.mock.calls[0][0];
      expect(upsert.create.customerId).toBe('');
      expect(upsert.create.hash).not.toMatch(/^[0-9a-f]{64}$/); // ไม่ใช่ sha256 ของรหัสใด ๆ
      // กินแค่เพดานต่อ LINE (นับทั้งเบอร์จริงและ decoy) — ไม่แตะเพดานของลูกค้าคนไหน
      const quotaKeys = prisma.chatbotOtpRequest.updateMany.mock.calls.map(
        (c: [{ where: { lineUserId: string } }]) => c[0].where.lineUserId,
      );
      expect(quotaKeys).toEqual(['otp-quota:line:U123']);
    });

    it('M4: known and unknown phones return byte-identical responses', async () => {
      prisma.customer.findFirst.mockResolvedValueOnce({
        id: 'c1',
        name: 'สมชาย',
        phone: '089-123-4567',
      });
      const known = await service.requestOtp({ lineUserId: 'U-a', phone: '0891234567' });
      prisma.customer.findFirst.mockResolvedValueOnce(null);
      const unknown = await service.requestOtp({ lineUserId: 'U-b', phone: '0891234567' });

      expect(unknown).toEqual(known);
    });

    it('แถวที่คืนมาไม่มีเบอร์ (ผู้สนใจจากแชท) → ตอบเหมือนเบอร์ที่ไม่พบ (decoy) ไม่ออก OTP ไม่ส่ง SMS', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'c-chat',
        name: 'Facebook #a1b2',
        phone: null,
      });

      const result = await service.requestOtp({ lineUserId: 'U123', phone: '0891234567' });

      expect(result).toEqual({ maskedPhone: '089-***-4567', expiresInSeconds: 300 });
      expect(prisma.chatbotOtpRequest.upsert.mock.calls[0][0].create.customerId).toBe('');
      expect(notifications.sendSmsFromQueue).not.toHaveBeenCalled();
    });

    it('throws on invalid phone format', async () => {
      await expect(service.requestOtp({ lineUserId: 'U123', phone: '12345' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('normalizes +66 format phone number', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'สมชาย', phone: '0891234567' });

      await service.requestOtp({ lineUserId: 'U123', phone: '66891234567' });

      expect(prisma.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { phone: { in: ['0891234567', '089-123-4567', '089-1234567'] }, deletedAt: null },
        }),
      );
    });

    it('enforces cooldown (60s)', async () => {
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue({
        lastRequestAt: new Date(), // just now
      });

      await expect(service.requestOtp({ lineUserId: 'U123', phone: '0891234567' })).rejects.toThrow(
        BadRequestException,
      );
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
    it('Task 33 — ไม่มีความยินยอม (เรียก service ตรงโดยไม่ผ่าน DTO) → 400 ไทย ไม่กิน attempt ไม่ผูก', async () => {
      for (const consent of [undefined, { granted: false }, {}]) {
        await expect(
          service.verifyOtp({ lineUserId: 'U123', otp: '123456', consent: consent as never }),
        ).rejects.toThrow('ติ๊กยินยอมรับแจ้งเตือนทาง LINE');
      }
      expect(prisma.chatbotOtpRequest.updateManyAndReturn).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

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

      const result = await service.verifyOtp({ lineUserId: 'U123', otp, consent: GRANTED_CONSENT });

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

      await expect(service.verifyOtp({ lineUserId: 'U123', otp: '123456', consent: GRANTED_CONSENT })).rejects.toThrow(
        'หมดอายุ',
      );
    });

    it('throws on max attempts exceeded', async () => {
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue({
        id: 'otp-1',
        expiresAt: new Date(Date.now() + 300_000),
        attempts: 3, // max
      });

      await expect(service.verifyOtp({ lineUserId: 'U123', otp: '123456', consent: GRANTED_CONSENT })).rejects.toThrow(
        'ใส่ OTP ผิดครบ 3 ครั้งแล้ว',
      );
    });

    it('increments attempts on wrong OTP (atomic conditional UPDATE … RETURNING)', async () => {
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue(makeRecord('wrong-hash', 0));

      await expect(service.verifyOtp({ lineUserId: 'U123', otp: '999999', consent: GRANTED_CONSENT })).rejects.toThrow(
        'OTP ไม่ถูกต้อง (เหลือ 2 ครั้ง)',
      );
      expect(prisma.chatbotOtpRequest.updateManyAndReturn).toHaveBeenCalledWith({
        where: { lineUserId: 'U123', attempts: { lt: 3 }, expiresAt: { gt: expect.any(Date) } },
        data: { attempts: { increment: 1 } },
      });
    });

    it('throws when no OTP record exists', async () => {
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue(null);

      await expect(service.verifyOtp({ lineUserId: 'U123', otp: '123456', consent: GRANTED_CONSENT })).rejects.toThrow(
        'ขอ OTP ใหม่',
      );
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

        const result = await service.verifyOtp({ lineUserId: 'U123', otp: '999999', consent: GRANTED_CONSENT });

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
        expect(prisma.chatbotOtpRequest.updateManyAndReturn).not.toHaveBeenCalled();
      });

      it('ON: still requires an existing pending OTP session', async () => {
        testMode.isEnabled.mockResolvedValue(true);
        prisma.chatbotOtpRequest.findUnique.mockResolvedValue(null);

        await expect(service.verifyOtp({ lineUserId: 'U123', otp: '999999', consent: GRANTED_CONSENT })).rejects.toThrow(
          'ขอ OTP ใหม่',
        );
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(audit.log).not.toHaveBeenCalled();
      });

      it('OFF: wrong OTP still fails (existing validation unchanged)', async () => {
        testMode.isEnabled.mockResolvedValue(false);
        prisma.chatbotOtpRequest.findUnique.mockResolvedValue(makeRecord('wrong-hash', 0));
        prisma.chatbotOtpRequest.update.mockResolvedValue({ attempts: 1 });

        await expect(service.verifyOtp({ lineUserId: 'U123', otp: '999999', consent: GRANTED_CONSENT })).rejects.toThrow(
          'ไม่ถูกต้อง',
        );
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

      const result = await service.verifyOtp({ lineUserId: 'U123', otp, consent: GRANTED_CONSENT });

      expect(result.customerId).toBe('c1');
      expect(prisma.$transaction).toHaveBeenCalled(); // bind() รันจริง
      expect(prisma.chatbotOtpRequest.delete).toHaveBeenCalled();
    });

    describe('Fix round 1 — R11: absorbRoomsOfLineUser called before bind()', () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      let mergedPrisma: any;
      let mergedNotifications: any;
      let mergedTestMode: any;
      let mergedAudit: any;
      let merge: any;
      /* eslint-enable @typescript-eslint/no-explicit-any */
      let mergedService: VerificationService;

      beforeEach(async () => {
        mergedPrisma = {
          chatbotOtpRequest: withOtpRowMocks({
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({ id: 'otp-1' }),
            delete: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            update: jest.fn(),
          }),
          customer: { findFirst: jest.fn(), findUnique: jest.fn() },
          customerLineLink: { findUnique: jest.fn(), upsert: jest.fn().mockResolvedValue({}) },
          chatRoom: { updateMany: jest.fn().mockResolvedValue({}) },
          pDPAConsent: CONSENT_TX_MOCK(),
          $transaction: jest.fn().mockImplementation((cb) => {
            const tx = {
              customerLineLink: {
                upsert: jest.fn().mockResolvedValue({}),
                findUnique: jest.fn().mockResolvedValue(null),
              },
              chatRoom: { updateMany: jest.fn().mockResolvedValue({}) },
              pDPAConsent: CONSENT_TX_MOCK(),
              // Task 29 — bind ล็อกแถวลูกค้าก่อน (lockCustomersForFinanceLineBind)
              $queryRaw: jest.fn().mockResolvedValue([]),
              customer: {
                findMany: jest.fn().mockResolvedValue([]),
                update: jest.fn().mockResolvedValue({}),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
              },
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
        useUnitSeams(mergedService, mergedPrisma);
      });

      it('real-verify branch: เรียก absorbRoomsOfLineUser(lineUserId, LINE_FINANCE, customerId, SYSTEM_ACTOR) ก่อน bind() เสมอ', async () => {
        mergedPrisma.customer.findFirst.mockResolvedValue({
          id: 'c1',
          name: 'สมชาย',
          phone: '0891234567',
        });
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
        mergedPrisma.$transaction.mockImplementation((cb: (client: unknown) => unknown) => {
          callOrder.push('bind');
          const tx = {
            customerLineLink: {
              upsert: jest.fn().mockResolvedValue({}),
              findUnique: jest.fn().mockResolvedValue(null),
            },
            chatRoom: { updateMany: jest.fn().mockResolvedValue({}) },
            pDPAConsent: CONSENT_TX_MOCK(),
            // Task 29 — bind ล็อกแถวลูกค้าก่อน (lockCustomersForFinanceLineBind)
            $queryRaw: jest.fn().mockResolvedValue([]),
            customer: {
              findMany: jest.fn().mockResolvedValue([]),
              update: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
          };
          return cb(tx);
        });

        await mergedService.verifyOtp({ lineUserId: 'U123', otp, consent: GRANTED_CONSENT });

        expect(merge.absorbRoomsOfLineUser).toHaveBeenCalledWith('U123', 'LINE_FINANCE', 'c1', {
          id: 'system',
          role: 'SYSTEM',
        });
        expect(callOrder).toEqual(['absorb', 'bind']); // absorb ก่อน bind() เสมอ ไม่ใช่ทีหลัง
      });

      it('test-mode-bypass branch: absorb ล้ม (เช่น placeholder มีเอกสารพ่วง) → ยัง bind() สำเร็จ (best-effort)', async () => {
        mergedTestMode.isEnabled.mockResolvedValue(true);
        mergedPrisma.chatbotOtpRequest.findUnique.mockResolvedValue(makeRecord('wrong-hash'));
        mergedPrisma.customer.findUnique.mockResolvedValue({ id: 'c1', name: 'สมชาย' });
        merge.absorbRoomsOfLineUser.mockRejectedValue(
          new Error('รวมไม่ได้: ผู้สนใจคนนี้มีใบจอง 1 รายการ'),
        );

        const result = await mergedService.verifyOtp({ lineUserId: 'U123', otp: '999999', consent: GRANTED_CONSENT });

        expect(result.customerId).toBe('c1');
        expect(merge.absorbRoomsOfLineUser).toHaveBeenCalledWith('U123', 'LINE_FINANCE', 'c1', {
          id: 'system',
          role: 'SYSTEM',
        });
        expect(mergedPrisma.$transaction).toHaveBeenCalled(); // bind() ยังรันต่อแม้ absorb ล้ม
        expect(mergedPrisma.chatbotOtpRequest.delete).toHaveBeenCalled();
      });
    });

    describe('LINE_LINKED หลัง bind() commit', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          $transaction: jest.fn().mockImplementation(async (cb: (client: unknown) => unknown) => {
            const result = await cb({
              customerLineLink: { upsert, findUnique: jest.fn().mockResolvedValue(null) },
              chatRoom: { updateMany: jest.fn().mockResolvedValue({}) },
              pDPAConsent: CONSENT_TX_MOCK(),
              // Task 29 — bind ล็อกแถวลูกค้าก่อน (lockCustomersForFinanceLineBind)
              $queryRaw: jest.fn().mockResolvedValue([]),
              customer: {
                findMany: jest.fn().mockResolvedValue([]),
                update: jest.fn().mockResolvedValue({}),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
              },
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
            {
              provide: TestModeService,
              useValue: { isEnabled: jest.fn().mockResolvedValue(true) },
            },
            { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
            { provide: JourneyEntryWriter, useValue: journey },
          ],
        }).compile();
        jService = module.get(VerificationService);
      });

      it('ยืนยันสำเร็จ → LINE_LINKED {FINANCE, VERIFICATION} หลัง transaction commit · linkedAt ตรงกับ occurredAt · ไม่มี LINE user id ในแถว', async () => {
        await jService.verifyOtp({ lineUserId: 'U123', otp: '999999', consent: GRANTED_CONSENT });

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
        // แถวเดียวกันตอบทั้งค้นด้วย LINE และด้วยลูกค้า (planLink อ่านด้วยลูกค้าก่อน)
        jPrisma.customerLineLink.findUnique.mockResolvedValue({
          id: 'link-1',
          customerId: 'c1',
          lineUserId: 'U123',
          unlinkedAt: null,
          deletedAt: null,
        });
        await jService.verifyOtp({ lineUserId: 'U123', otp: '999999', consent: GRANTED_CONSENT });
        expect(order).toEqual(['commit']);
        expect(journey.recordAfterCommit).not.toHaveBeenCalled();
      });

      it('LINE นี้เคยผูกลูกค้าคนอื่น หรือเคยถูกยกเลิก → นับเป็นการผูกใหม่', async () => {
        // ค้นด้วยลูกค้า (planLink) → ลูกค้า c1 ยังไม่มีแถว · ค้นด้วย LINE (bind) → แถวของลูกค้าเดิม
        jPrisma.customerLineLink.findUnique.mockImplementation(
          async (args: { where: Record<string, unknown> }) =>
            'lineUserId_channel' in args.where
              ? { customerId: 'c-old', unlinkedAt: null, deletedAt: null }
              : null,
        );
        await jService.verifyOtp({ lineUserId: 'U123', otp: '999999', consent: GRANTED_CONSENT });
        // ยกเลิกผูกแล้ว (LIFF unlink ปิดแถว) → ผูกกลับด้วย OTP = แถวเดิมของ LINE นี้ + ลูกค้าเดิม
        jPrisma.customerLineLink.findUnique.mockResolvedValue({
          id: 'link-1',
          customerId: 'c1',
          lineUserId: 'U123',
          unlinkedAt: new Date('2026-09-01T00:00:00.000Z'),
          deletedAt: null,
        });
        await jService.verifyOtp({ lineUserId: 'U123', otp: '999999', consent: GRANTED_CONSENT });
        expect(journey.recordAfterCommit).toHaveBeenCalledTimes(2);
        expect(upsert).toHaveBeenCalledTimes(2);
        expect(upsert.mock.calls[1][0].update).toMatchObject({
          customerId: 'c1',
          unlinkedAt: null,
        });
      });

      it('transaction ของ bind() ล้ม → ไม่บันทึก และ verifyOtp โยนต่อ', async () => {
        jPrisma.$transaction.mockRejectedValue(new Error('deadlock'));
        await expect(jService.verifyOtp({ lineUserId: 'U123', otp: '999999', consent: GRANTED_CONSENT })).rejects.toThrow(
          'deadlock',
        );
        expect(journey.recordAfterCommit).not.toHaveBeenCalled();
      });
    });
  });

  describe('isLinked', () => {
    it('returns linked=true for active link', async () => {
      prisma.customerLineLink.findFirst.mockResolvedValue({
        unlinkedAt: null,
        customer: { id: 'c1', name: 'สมชาย' },
      });

      const result = await service.isLinked('U123');
      expect(result.linked).toBe(true);
      expect(result.customerId).toBe('c1');
    });

    // Task 24 fix round 1 M-1 — เกณฑ์เดียวกับ findOtpVerifiedCustomerId: แถวที่ยังผูก (unlinked/deleted ว่าง) ของลูกค้าที่ยังไม่ถูกลบ
    it('ค้นด้วยเกณฑ์เดียว VERIFIED_FINANCE_LINK_WHERE (แถวยกเลิก/ลบ หรือลูกค้าถูกลบ = ไม่พบ)', async () => {
      prisma.customerLineLink.findFirst.mockResolvedValue(null);

      await expect(service.isLinked('U123')).resolves.toEqual({ linked: false });
      expect(prisma.customerLineLink.findFirst).toHaveBeenCalledWith({
        where: {
          lineUserId: 'U123',
          channel: 'FINANCE',
          unlinkedAt: null,
          deletedAt: null,
          customer: { deletedAt: null },
        },
        include: { customer: { select: { id: true, name: true } } },
      });
    });

    it('returns linked=false when no record', async () => {
      prisma.customerLineLink.findFirst.mockResolvedValue(null);
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

    it('locks lineUserId after 3 malformed phone inputs', async () => {
      for (let i = 0; i < 3; i++) {
        await expect(service.requestOtp({ lineUserId: 'U-bad', phone: '12345' })).rejects.toThrow(
          'เบอร์โทรไม่ถูกต้อง',
        );
      }

      // 4th attempt — locked message ("รออีก … วินาที")
      await expect(
        service.requestOtp({ lineUserId: 'U-bad', phone: '0810000000' }),
      ).rejects.toThrow(/รออีก/);
    });

    it('M4: unknown phones never count toward the lock (the lock must not be an oracle)', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      for (let i = 0; i < 5; i++) {
        await expect(
          service.requestOtp({ lineUserId: 'U-probe', phone: `081000000${i}` }),
        ).resolves.toEqual({ maskedPhone: `081-***-000${i}`, expiresInSeconds: 300 });
        prisma.chatbotOtpRequest.findUnique.mockResolvedValue(null); // ข้าม cooldown ของรอบก่อน
      }
    });

    it('lock expires after 30 minutes (jest fake timers)', async () => {
      jest.useFakeTimers();
      try {
        for (let i = 0; i < 3; i++) {
          await expect(service.requestOtp({ lineUserId: 'U-exp', phone: '12345' })).rejects.toThrow(
            BadRequestException,
          );
        }

        // Immediately locked
        await expect(service.requestOtp({ lineUserId: 'U-exp', phone: '12345' })).rejects.toThrow(
          /รออีก/,
        );

        // Advance 31 minutes — lock should be released
        jest.advanceTimersByTime(31 * 60 * 1000);

        // Now we're back to the normal format error
        await expect(service.requestOtp({ lineUserId: 'U-exp', phone: '12345' })).rejects.toThrow(
          'เบอร์โทรไม่ถูกต้อง',
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Task 20 I1 — OTP เดาไม่ได้: กิน attempt แบบ atomic ก่อนเทียบรหัส · ขอใหม่ในช่วงเวลาเดิมไม่รีเซ็ต
  // attempts · ล็อกค้างจนหมดอายุ · เพดานขอ OTP ต่อลูกค้าต่อวันใน DB (ทุกบัญชี LINE รวมกัน)
  // ─────────────────────────────────────────────────────────────
  describe('Task 20 I1 — OTP brute-force limits', () => {
    const KNOWN = { id: 'c1', name: 'สมชาย', phone: '0891234567' };
    const row = (over: Record<string, unknown> = {}) => ({
      id: 'otp-1',
      lineUserId: 'U123',
      customerId: 'c1',
      phone: '0891234567',
      hash: 'h',
      expiresAt: new Date(Date.now() + 240_000),
      attempts: 0,
      lastRequestAt: new Date(Date.now() - 120_000),
      ...over,
    });

    it('the correct code is rejected when the atomic UPDATE finds no attempt left (lost the race)', async () => {
      prisma.customer.findFirst.mockResolvedValue(KNOWN);
      await service.requestOtp({ lineUserId: 'U123', phone: '0891234567' });
      const storedHash = prisma.chatbotOtpRequest.upsert.mock.calls[0][0].create.hash;
      const otp = (notifications.sendSmsFromQueue.mock.calls[0][1] as string).match(/(\d{6})/)![1];
      // คำขอขนานกินครั้งที่ 3 ไปก่อน — UPDATE … WHERE attempts < 3 ได้ 0 แถว แม้รหัสจะถูก
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue(row({ hash: storedHash, attempts: 3 }));
      prisma.chatbotOtpRequest.updateManyAndReturn.mockResolvedValue([]);
      prisma.customer.findUnique.mockResolvedValue({ id: 'c1', name: 'สมชาย' });

      await expect(service.verifyOtp({ lineUserId: 'U123', otp, consent: GRANTED_CONSENT })).rejects.toThrow(
        'ใส่ OTP ผิดครบ 3 ครั้งแล้ว',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('exhausted attempts keep the row until it expires (no delete → no fresh attempts via re-request)', async () => {
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue(row({ attempts: 3 }));

      await expect(service.verifyOtp({ lineUserId: 'U123', otp: '123456', consent: GRANTED_CONSENT })).rejects.toThrow(
        'ใส่ OTP ผิดครบ 3 ครั้งแล้ว',
      );
      expect(prisma.chatbotOtpRequest.delete).not.toHaveBeenCalled();
    });

    it('the last wrong attempt tells the user when they may request again', async () => {
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue(row({ attempts: 2 }));

      await expect(service.verifyOtp({ lineUserId: 'U123', otp: '123456', consent: GRANTED_CONSENT })).rejects.toThrow(
        /ใส่ OTP ผิดครบ 3 ครั้งแล้ว — ขอรหัสใหม่ได้ในอีก \d+ นาที/,
      );
      expect(prisma.chatbotOtpRequest.delete).not.toHaveBeenCalled();
    });

    it('re-request inside the window keeps the attempt counter (no reset)', async () => {
      prisma.customer.findFirst.mockResolvedValue(KNOWN);
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue(row({ attempts: 2 }));

      await service.requestOtp({ lineUserId: 'U123', phone: '0891234567' });

      const upsert = prisma.chatbotOtpRequest.upsert.mock.calls[0][0];
      expect(upsert.update).not.toHaveProperty('attempts');
      expect(notifications.sendSmsFromQueue).toHaveBeenCalledTimes(1);
    });

    it('re-request after the window expired starts a fresh counter', async () => {
      prisma.customer.findFirst.mockResolvedValue(KNOWN);
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue(
        row({ attempts: 3, expiresAt: new Date(Date.now() - 1_000) }),
      );

      await service.requestOtp({ lineUserId: 'U123', phone: '0891234567' });

      expect(prisma.chatbotOtpRequest.upsert.mock.calls[0][0].update.attempts).toBe(0);
    });

    it('re-request while locked out inside the window → refused, no new code, no SMS', async () => {
      prisma.customer.findFirst.mockResolvedValue(KNOWN);
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue(row({ attempts: 3 }));

      await expect(service.requestOtp({ lineUserId: 'U123', phone: '0891234567' })).rejects.toThrow(
        /ขอรหัสใหม่ได้ในอีก \d+ นาที/,
      );
      expect(prisma.chatbotOtpRequest.upsert).not.toHaveBeenCalled();
      expect(notifications.sendSmsFromQueue).not.toHaveBeenCalled();
    });

    it('each real OTP consumes three daily quota rows in order: LINE (5) → customer+LINE (2) → customer (8)', async () => {
      prisma.customer.findFirst.mockResolvedValue(KNOWN);

      await service.requestOtp({ lineUserId: 'U123', phone: '0891234567' });

      expect(prisma.chatbotOtpRequest.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            lineUserId: 'otp-quota:customer:c1',
            customerId: 'c1',
            attempts: 0,
            expiresAt: expect.any(Date),
          }),
        ],
        skipDuplicates: true,
      });
      expect(prisma.chatbotOtpRequest.updateMany.mock.calls.map((c: [unknown]) => c[0])).toEqual([
        {
          where: { lineUserId: 'otp-quota:line:U123', attempts: { lt: 5 } },
          data: { attempts: { increment: 1 }, lastRequestAt: expect.any(Date) },
        },
        {
          where: { lineUserId: 'otp-quota:customer:c1:line:U123', attempts: { lt: 2 } },
          data: { attempts: { increment: 1 }, lastRequestAt: expect.any(Date) },
        },
        {
          where: { lineUserId: 'otp-quota:customer:c1', attempts: { lt: 8 } },
          data: { attempts: { increment: 1 }, lastRequestAt: expect.any(Date) },
        },
      ]);
    });

    it.each([
      ['otp-quota:line:U-6th', 'LINE'],
      ['otp-quota:customer:c1:line:U-6th', 'customer+LINE'],
      ['otp-quota:customer:c1', 'customer'],
    ])('quota row %s full (%s) → identical response, no SMS, decoy row', async (fullKey) => {
      prisma.customer.findFirst.mockResolvedValue(KNOWN);
      prisma.chatbotOtpRequest.updateMany.mockImplementation(
        async (args: { where: { lineUserId: string } }) => ({
          count: args.where.lineUserId === fullKey ? 0 : 1,
        }),
      );

      const result = await service.requestOtp({ lineUserId: 'U-6th', phone: '0891234567' });
      await flushSmsDispatch();

      expect(result).toEqual({ maskedPhone: '089-***-4567', expiresInSeconds: 300 });
      expect(notifications.sendSmsFromQueue).not.toHaveBeenCalled();
      expect(prisma.chatbotOtpRequest.upsert.mock.calls[0][0].create.customerId).toBe('');
    });

    it('M1: SMS is not awaited — a slow provider does not delay the answer, both paths wait the same floor', async () => {
      service._setResponseFloorForTests(60);
      notifications.sendSmsFromQueue.mockReturnValue(new Promise(() => undefined)); // ไม่จบเลย

      prisma.customer.findFirst.mockResolvedValueOnce(KNOWN);
      let t0 = Date.now();
      await service.requestOtp({ lineUserId: 'U-real', phone: '0891234567' });
      const realMs = Date.now() - t0;

      prisma.customer.findFirst.mockResolvedValueOnce(null);
      t0 = Date.now();
      await service.requestOtp({ lineUserId: 'U-fake', phone: '0899999999' });
      const decoyMs = Date.now() - t0;

      expect(notifications.sendSmsFromQueue).toHaveBeenCalledTimes(1);
      expect(realMs).toBeGreaterThanOrEqual(55);
      expect(decoyMs).toBeGreaterThanOrEqual(55);
      expect(realMs).toBeLessThan(1000);
    });

    it('daily quota reached → identical response, no SMS, no usable code (decoy row)', async () => {
      prisma.customer.findFirst.mockResolvedValue(KNOWN);
      prisma.chatbotOtpRequest.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.requestOtp({ lineUserId: 'U-6th', phone: '0891234567' });

      expect(result).toEqual({ maskedPhone: '089-***-4567', expiresInSeconds: 300 });
      expect(notifications.sendSmsFromQueue).not.toHaveBeenCalled();
      const upsert = prisma.chatbotOtpRequest.upsert.mock.calls[0][0];
      expect(upsert.create.customerId).toBe('');
      expect(upsert.create.hash).not.toMatch(/^[0-9a-f]{64}$/);
    });

    it('decoy row behaves like a real one on verify (wrong code, attempts counted)', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      await service.requestOtp({ lineUserId: 'U123', phone: '0899999999' });
      const decoy = prisma.chatbotOtpRequest.upsert.mock.calls[0][0].create;
      prisma.chatbotOtpRequest.findUnique.mockResolvedValue(row({ ...decoy, attempts: 0 }));

      await expect(service.verifyOtp({ lineUserId: 'U123', otp: '123456', consent: GRANTED_CONSENT })).rejects.toThrow(
        'OTP ไม่ถูกต้อง (เหลือ 2 ครั้ง)',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('SMS failure (after answering) invalidates only the issued code, frees the cooldown and refunds the customer quotas', async () => {
      prisma.customer.findFirst.mockResolvedValue(KNOWN);
      notifications.sendSmsFromQueue.mockRejectedValue(new Error('provider down'));

      // M1: ไม่รอผลส่ง ⇒ คำตอบเหมือนสำเร็จ (ไม่มี 400 เฉพาะเบอร์จริง)
      await expect(
        service.requestOtp({ lineUserId: 'U123', phone: '0891234567' }),
      ).resolves.toEqual({ maskedPhone: '089-***-4567', expiresInSeconds: 300 });
      const issuedHash = prisma.chatbotOtpRequest.upsert.mock.calls[0][0].create.hash;
      await flushSmsDispatch();

      expect(prisma.chatbotOtpRequest.delete).not.toHaveBeenCalled();
      // 3 แถวแรกคือการกินเพดาน (LINE → ลูกค้า+LINE → ลูกค้า) · ที่เหลือคือการเก็บกวาดหลังส่งไม่สำเร็จ
      const calls = prisma.chatbotOtpRequest.updateMany.mock.calls
        .map((c: [unknown]) => c[0])
        .slice(3);
      // R-1: ทิ้งรหัส + คืนโควตาเฉพาะเมื่อ attempts ยังเท่าตอนออกรหัส (ยังไม่มีใครเดา)
      expect(calls[0]).toStrictEqual({
        where: { lineUserId: 'U123', hash: issuedHash, attempts: 0 },
        data: { hash: expect.stringMatching(/^decoy:/), lastRequestAt: new Date(0) },
      });
      expect(calls.slice(1)).toEqual([
        {
          where: { lineUserId: 'otp-quota:customer:c1:line:U123', attempts: { gt: 0 } },
          data: { attempts: { decrement: 1 } },
        },
        {
          where: { lineUserId: 'otp-quota:customer:c1', attempts: { gt: 0 } },
          data: { attempts: { decrement: 1 } },
        },
      ]);
    });

    it('R-1: SMS failure after the issued code was guessed drops the code but refunds nothing', async () => {
      prisma.customer.findFirst.mockResolvedValue(KNOWN);
      prisma.chatbotOtpRequest.upsert.mockResolvedValue({ id: 'otp-1', attempts: 1 });
      let failSms!: (err: Error) => void;
      notifications.sendSmsFromQueue.mockReturnValue(
        new Promise((_resolve, reject) => (failSms = reject)),
      );

      await service.requestOtp({ lineUserId: 'U123', phone: '0891234567' });
      const issuedHash = prisma.chatbotOtpRequest.upsert.mock.calls[0][0].create.hash;
      // ระหว่างรอ provider มีการเดารหัส ⇒ attempts ไม่เท่าตอนออก ⇒ UPDATE แบบมีเงื่อนไขไม่โดนแถวไหน
      prisma.chatbotOtpRequest.updateMany.mockResolvedValueOnce({ count: 0 });
      failSms(new Error('provider down'));
      await flushSmsDispatch();

      const calls = prisma.chatbotOtpRequest.updateMany.mock.calls
        .map((c: [unknown]) => c[0])
        .slice(3);
      expect(calls).toStrictEqual([
        {
          where: { lineUserId: 'U123', hash: issuedHash, attempts: 1 },
          data: { hash: expect.stringMatching(/^decoy:/), lastRequestAt: new Date(0) },
        },
        {
          where: { lineUserId: 'U123', hash: issuedHash },
          data: { hash: expect.stringMatching(/^decoy:/), lastRequestAt: new Date(0) },
        },
      ]);
    });

    it('R-3: a logger that throws in the SMS callback does not leave an unhandled rejection', async () => {
      prisma.customer.findFirst.mockResolvedValue(KNOWN);
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      const logger = (service as unknown as { logger: { log: jest.Mock; error: jest.Mock } })
        .logger;
      const logSpy = jest.spyOn(logger, 'log').mockImplementation(() => {
        throw new Error('logger down');
      });
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {
        throw new Error('logger down');
      });
      try {
        // ทางส่งสำเร็จ (logger.log โยน) และทางส่งไม่สำเร็จ (logger.error โยนก่อนเก็บกวาด)
        await service.requestOtp({ lineUserId: 'U-ok', phone: '0891234567' });
        notifications.sendSmsFromQueue.mockRejectedValueOnce(new Error('provider down'));
        await service.requestOtp({ lineUserId: 'U-fail', phone: '0891234567' });
        await flushSmsDispatch();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
        logSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });

    it('SMS that throws synchronously is still cleaned up (never escapes requestOtp)', async () => {
      prisma.customer.findFirst.mockResolvedValue(KNOWN);
      notifications.sendSmsFromQueue.mockImplementation(() => {
        throw new Error('sync boom');
      });

      await expect(
        service.requestOtp({ lineUserId: 'U123', phone: '0891234567' }),
      ).resolves.toBeDefined();
      await flushSmsDispatch();
      expect(
        prisma.chatbotOtpRequest.updateMany.mock.calls.some(
          (c: [{ data: { lastRequestAt?: Date } }]) => c[0].data.lastRequestAt?.getTime() === 0,
        ),
      ).toBe(true);
    });

    it('test mode does not consume the daily quota (UAT skips SMS anyway)', async () => {
      testMode.isEnabled.mockResolvedValue(true);
      prisma.customer.findFirst.mockResolvedValue(KNOWN);

      await service.requestOtp({ lineUserId: 'U123', phone: '0891234567' });

      expect(prisma.chatbotOtpRequest.updateMany).not.toHaveBeenCalled();
      expect(prisma.chatbotOtpRequest.upsert.mock.calls[0][0].create.customerId).toBe('c1');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Task 19 — /liff/finance-verify เป็นทางผูก LINE การเงินทางเดียว (liff/register ตอบ 410)
  // ต้องทำผลข้างเคียงครบที่ทางเดิมเคยทำ: ดูดห้องผู้สนใจ · customer_line_links · line_id_finance ·
  // LINE_LINKED หลัง commit · สลับ rich menu FINANCE เป็น "ยืนยันแล้ว" (ทางเดิมทำ ทางนี้เคยขาด — G8)
  // ─────────────────────────────────────────────────────────────
  describe('Task 19 — ทางผูกทางเดียว (linkVerifiedLine)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tPrisma: any;
    let tx: {
      $queryRaw: jest.Mock;
      customerLineLink: { upsert: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
      chatRoom: { updateMany: jest.Mock };
      customer: { findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
      pDPAConsent: { findFirst: jest.Mock; create: jest.Mock };
    };
    let order: string[];
    let rows: { byCustomer: unknown; byLine: unknown };
    let columnHolders: { id: string }[];
    let merge: { absorbRoomsOfLineUser: jest.Mock };
    let journey: { recordAfterCommit: jest.Mock };
    let richMenu: { switchRichMenu: jest.Mock };
    let testModeOn: jest.Mock;
    let tNotifications: { sendSmsFromQueue: jest.Mock };
    let tService: VerificationService;

    const build = async (opts: { withRichMenu?: boolean } = {}) => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          VerificationService,
          { provide: PrismaService, useValue: tPrisma },
          { provide: NotificationsService, useValue: tNotifications },
          { provide: TestModeService, useValue: { isEnabled: testModeOn } },
          { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
          { provide: CustomerMergeService, useValue: merge },
          { provide: JourneyEntryWriter, useValue: journey },
          ...(opts.withRichMenu === false
            ? []
            : [{ provide: RichMenuService, useValue: richMenu }]),
        ],
      }).compile();
      tService = module.get(VerificationService);
      useUnitSeams(tService, tPrisma);
    };

    /** ขอ OTP จริงแล้วคืนรหัสที่ส่งทาง SMS — เส้นยืนยันจริง (ไม่ใช่ test-mode) */
    const requestRealOtp = async (): Promise<string> => {
      await tService.requestOtp({ lineUserId: 'U123', phone: '0891234567' });
      const stored = tPrisma.chatbotOtpRequest.upsert.mock.calls.at(-1)[0].create.hash;
      tPrisma.chatbotOtpRequest.findUnique.mockResolvedValue({
        id: 'otp-1',
        lineUserId: 'U123',
        customerId: 'c1',
        hash: stored,
        expiresAt: new Date(Date.now() + 300_000),
        attempts: 0,
      });
      const sms = tNotifications.sendSmsFromQueue.mock.calls.at(-1)[1] as string;
      return sms.match(/(\d{6})/)![1];
    };

    const LINK_SEQUENCE = [
      'absorb',
      'lock-customers', // Task 29 — แถวลูกค้าก่อนแถว link/ห้อง (ลำดับเดียวกับทางยกเลิกผูก — กัน deadlock 40P01)
      'link-upsert',
      'rooms',
      'clear-others', // Task 22 I-1 (ข) — ล้าง U-id นี้ออกจากคอลัมน์ของลูกค้าคนอื่นก่อนเขียนของลูกค้าคนนี้
      'line_id_finance',
      'consent', // Task 33 — pdpa_consents GRANTED ในทรานแซกชันเดียวกับการผูก (ก่อน commit)
      'commit',
      'journey',
      'rich-menu',
      'otp-delete',
    ];

    beforeEach(async () => {
      order = [];
      rows = { byCustomer: null, byLine: null };
      columnHolders = [];
      const step = (name: string, value: unknown = {}) =>
        jest.fn(async () => {
          order.push(name);
          return value;
        });
      tx = {
        $queryRaw: step('lock-customers', []),
        customerLineLink: {
          upsert: step('link-upsert'),
          update: step('link-repoint'),
          // bind อ่านแถวของ LINE นี้ในทรานแซกชัน (Task 24 M-8 — ย้ายจากลูกค้าอื่นไหม) — ไม่นับเป็นขั้นใน LINK_SEQUENCE
          findUnique: jest.fn(async () => rows.byLine),
        },
        chatRoom: { updateMany: step('rooms') },
        customer: {
          // ผู้ถือคอลัมน์ line_id_finance = LINE นี้ (ชุดที่ bind ล็อกก่อน — Task 29) · ไม่นับเป็นขั้น
          findMany: jest.fn(async () => columnHolders),
          update: step('line_id_finance'),
          updateMany: step('clear-others'),
        },
        pDPAConsent: {
          // แถว GRANTED ของวัตถุประสงค์เดียวกันที่มีอยู่ (ครั้งเดียวต่อลูกค้า) — ไม่นับเป็นขั้น
          findFirst: jest.fn(async () => null),
          create: step('consent', { id: 'consent-1', grantedAt: CONSENT_GRANTED_AT }),
        },
      };
      tPrisma = {
        chatbotOtpRequest: withOtpRowMocks({
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn().mockResolvedValue({ id: 'otp-1' }),
          delete: step('otp-delete'),
          update: jest.fn(),
        }),
        customer: {
          findFirst: jest.fn().mockResolvedValue({ id: 'c1', name: 'สมชาย', phone: '0891234567' }),
          findUnique: jest.fn().mockResolvedValue({ id: 'c1', name: 'สมชาย' }),
        },
        customerLineLink: {
          findUnique: jest.fn(async (args: { where: Record<string, unknown> }) =>
            'customerId_channel' in args.where ? rows.byCustomer : rows.byLine,
          ),
        },
        $transaction: jest.fn(async (cb: (client: typeof tx) => unknown) => {
          const result = await cb(tx);
          order.push('commit');
          return result;
        }),
      };
      merge = { absorbRoomsOfLineUser: step('absorb', { absorbed: 1, linked: 0 }) };
      journey = { recordAfterCommit: step('journey', undefined) };
      richMenu = { switchRichMenu: step('rich-menu', undefined) };
      testModeOn = jest.fn().mockResolvedValue(false);
      tNotifications = { sendSmsFromQueue: jest.fn().mockResolvedValue(undefined) };
      await build();
    });

    it('(d) OTP ถูกต้อง → ผูกครบ: ดูดห้อง → link row + ห้อง + line_id_finance ใน tx เดียว → journey → rich menu "ยืนยันแล้ว" → ลบ OTP', async () => {
      const otp = await requestRealOtp();

      await expect(tService.verifyOtp({ lineUserId: 'U123', otp, consent: GRANTED_CONSENT })).resolves.toEqual({
        customerId: 'c1',
        customerName: 'สมชาย',
        consentRecordedAt: CONSENT_GRANTED_AT.toISOString(),
      });

      expect(order).toEqual(LINK_SEQUENCE);
      // Task 33 — ความยินยอมของลูกค้าที่ผูก: ข้อความ/วัตถุประสงค์ของหน้า LIFF · GRANTED · ไม่มีพนักงานผู้บันทึก
      expect(tx.pDPAConsent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerId: 'c1',
          status: 'GRANTED',
          purposes: ['แจ้งเตือนค่างวด ใบเสร็จ และข้อมูลสัญญาทาง LINE'],
          privacyNoticeText: 'ยินยอมให้บริษัทส่งแจ้งเตือนค่างวด ใบเสร็จ และข้อมูลสัญญาทาง LINE',
        }),
        select: { id: true, grantedAt: true },
      });
      expect(merge.absorbRoomsOfLineUser).toHaveBeenCalledWith('U123', 'LINE_FINANCE', 'c1', {
        id: 'system',
        role: 'SYSTEM',
      });
      expect(tx.customerLineLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { lineUserId_channel: { lineUserId: 'U123', channel: 'FINANCE' } },
          create: { customerId: 'c1', lineUserId: 'U123', channel: 'FINANCE' },
        }),
      );
      expect(tx.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { lineIdFinance: 'U123' },
      });
      // Task 22 I-1 (ข) — LINE ที่ย้ายมาหาลูกค้าคนนี้ต้องไม่ค้างบนคอลัมน์ของลูกค้าคนอื่น (รวมแถวที่ถูกลบ — ไม่กรอง deletedAt)
      expect(tx.customer.updateMany).toHaveBeenCalledWith({
        where: { lineIdFinance: 'U123', id: { not: 'c1' } },
        data: { lineIdFinance: null },
      });
      expect(journey.recordAfterCommit.mock.calls[0][0]).toMatchObject({
        customerId: 'c1',
        kind: 'LINE_LINKED',
        data: { channel: 'FINANCE', via: 'VERIFICATION' },
      });
      expect(richMenu.switchRichMenu).toHaveBeenCalledWith('U123', true, 'finance');
    });

    it.each([
      [
        'deadlock',
        new Prisma.PrismaClientKnownRequestError('deadlock detected', {
          code: 'P2034',
          clientVersion: 'test',
        }),
      ],
      ['ชุดลูกค้าที่ต้องล็อกไม่นิ่ง (review M-2)', new FinanceLineLockSetUnstableError()],
    ])(
      'Task 29 fix round 1: ทรานแซกชันของ bind โดน %s → ลองทั้งก้อนใหม่ (ตาข่าย) · ผูกครั้งเดียว (error อื่นไม่ลองซ้ำ — transaction-retry.util.spec)',
      async (_label, failure) => {
        const otp = await requestRealOtp();
        const calls = tPrisma.$transaction.mock.calls.length;
        tPrisma.$transaction.mockRejectedValueOnce(failure);

        await expect(tService.verifyOtp({ lineUserId: 'U123', otp, consent: GRANTED_CONSENT })).resolves.toMatchObject({
          customerId: 'c1',
        });

        expect(tPrisma.$transaction.mock.calls.length - calls).toBe(2);
        expect(order.filter((step) => step === 'commit')).toHaveLength(1);
        expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
      },
    );

    it('(d) test-mode bypass ใช้ helper เดียวกัน → สลับ rich menu ด้วย', async () => {
      testModeOn.mockResolvedValue(true);
      tPrisma.chatbotOtpRequest.findUnique.mockResolvedValue({
        id: 'otp-1',
        lineUserId: 'U123',
        customerId: 'c1',
        hash: 'x',
        expiresAt: new Date(Date.now() + 300_000),
        attempts: 0,
      });

      await tService.verifyOtp({ lineUserId: 'U123', otp: '000000', consent: GRANTED_CONSENT });

      expect(order).toEqual(LINK_SEQUENCE);
    });

    it('สลับ rich menu ล้ม (LINE API) → การยืนยันยังสำเร็จ (best-effort เหมือนทางเดิม)', async () => {
      richMenu.switchRichMenu.mockRejectedValue(new Error('LINE API error 500'));
      const otp = await requestRealOtp();

      await expect(tService.verifyOtp({ lineUserId: 'U123', otp, consent: GRANTED_CONSENT })).resolves.toMatchObject({
        customerId: 'c1',
      });
      expect(tx.customer.update).toHaveBeenCalled();
      expect(tPrisma.chatbotOtpRequest.delete).toHaveBeenCalled();
    });

    it('ไม่มี RichMenuService ใน DI (spec / โมดูลถูกแยก) → ข้ามการสลับเมนู ผูกสำเร็จตามปกติ', async () => {
      await build({ withRichMenu: false });
      const otp = await requestRealOtp();

      await expect(tService.verifyOtp({ lineUserId: 'U123', otp, consent: GRANTED_CONSENT })).resolves.toMatchObject({
        customerId: 'c1',
      });
      expect(order).toContain('commit');
      expect(richMenu.switchRichMenu).not.toHaveBeenCalled();
    });

    it('ลูกค้ายังผูกกับ LINE อื่นอยู่ → 409 ไทย (เดิมชน unique เป็น 500) · ไม่ดูดห้อง ไม่เขียนอะไร ไม่สลับเมนู', async () => {
      rows.byCustomer = { id: 'link-old', lineUserId: 'U_OLD', unlinkedAt: null, deletedAt: null };
      const otp = await requestRealOtp();

      const err = await tService.verifyOtp({ lineUserId: 'U123', otp, consent: GRANTED_CONSENT }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(CUSTOMER_LINKED_TO_OTHER_LINE_MESSAGE);
      expect(merge.absorbRoomsOfLineUser).not.toHaveBeenCalled();
      expect(tPrisma.$transaction).not.toHaveBeenCalled();
      expect(richMenu.switchRichMenu).not.toHaveBeenCalled();
      expect(journey.recordAfterCommit).not.toHaveBeenCalled();
    });

    it('ลูกค้ายกเลิกผูก LINE เดิมแล้ว → ผูก LINE ใหม่ได้ โดยชี้แถวเดิมของลูกค้ามาที่ LINE ใหม่ (ไม่สร้างแถวชน unique)', async () => {
      rows.byCustomer = {
        id: 'link-old',
        lineUserId: 'U_OLD',
        unlinkedAt: new Date('2026-10-01T00:00:00.000Z'),
        deletedAt: null,
      };
      const otp = await requestRealOtp();

      await expect(tService.verifyOtp({ lineUserId: 'U123', otp, consent: GRANTED_CONSENT })).resolves.toMatchObject({
        customerId: 'c1',
      });

      expect(tx.customerLineLink.upsert).not.toHaveBeenCalled();
      expect(tx.customerLineLink.update).toHaveBeenCalledWith({
        where: { id: 'link-old' },
        data: { lineUserId: 'U123', unlinkedAt: null, deletedAt: null, linkedAt: expect.any(Date) },
      });
      expect(tx.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { lineIdFinance: 'U123' },
      });
      expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
      expect(richMenu.switchRichMenu).toHaveBeenCalledWith('U123', true, 'finance');
      // Task 24 M-8 — ห้องการเงินของ LINE เดิมที่ยังค้าง verified ถูกล้างก่อนตั้งห้องของ LINE ใหม่ (ทรานแซกชันเดียวกัน)
      expect(tx.chatRoom.updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          channel: 'LINE_FINANCE',
          verifiedAt: { not: null },
          OR: [{ lineUserId: { in: ['U_OLD'] } }],
        },
        // Task 33 — ห้องที่หลุดจากการยืนยันจำเวลาไว้ (ป้าย "ยกเลิกผูกแล้ว" ในอินบ็อกซ์)
        data: { verifiedAt: null, financeLineUnlinkedAt: expect.any(Date) },
      });
      expect(tx.chatRoom.updateMany).toHaveBeenNthCalledWith(2, {
        where: { lineUserId: 'U123', channel: 'LINE_FINANCE' },
        // Task 33 — ยืนยันแล้ว = ล้างเวลาที่เคยหลุด
        data: {
          customerId: 'c1',
          verifiedAt: expect.any(Date),
          verificationAttempts: 0,
          financeLineUnlinkedAt: null,
        },
      });
    });

    it('Task 24 M-8: LINE นี้ย้ายมาจากลูกค้าอื่น → ห้องการเงินของลูกค้าเดิมที่ค้าง verified ถูกล้าง แล้วห้องของ LINE นี้ verified ให้ลูกค้าใหม่', async () => {
      rows.byLine = { id: 'link-other', customerId: 'c-other', unlinkedAt: null, deletedAt: null };
      const otp = await requestRealOtp();

      await expect(tService.verifyOtp({ lineUserId: 'U123', otp, consent: GRANTED_CONSENT })).resolves.toMatchObject({
        customerId: 'c1',
      });

      expect(tx.chatRoom.updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          channel: 'LINE_FINANCE',
          verifiedAt: { not: null },
          OR: [{ customerId: { in: ['c-other'] } }],
        },
        // Task 33 — ห้องที่หลุดจากการยืนยันจำเวลาไว้ (ป้าย "ยกเลิกผูกแล้ว" ในอินบ็อกซ์)
        data: { verifiedAt: null, financeLineUnlinkedAt: expect.any(Date) },
      });
      expect(tx.chatRoom.updateMany).toHaveBeenNthCalledWith(2, {
        where: { lineUserId: 'U123', channel: 'LINE_FINANCE' },
        // Task 33 — ยืนยันแล้ว = ล้างเวลาที่เคยหลุด
        data: {
          customerId: 'c1',
          verifiedAt: expect.any(Date),
          verificationAttempts: 0,
          financeLineUnlinkedAt: null,
        },
      });
    });

    it('Task 29: ล็อกแถวลูกค้าทุกคนที่ bind จะแตะ (ลูกค้าที่ผูก + ผู้ถือแถว link + ผู้ถือคอลัมน์) ในคำสั่งเดียวเรียง id ก่อนเขียนแถว link/ห้อง', async () => {
      rows.byLine = { id: 'link-other', customerId: 'c-other', unlinkedAt: null, deletedAt: null };
      columnHolders = [{ id: 'c-other' }, { id: 'c-stale' }];
      const otp = await requestRealOtp();

      await tService.verifyOtp({ lineUserId: 'U123', otp, consent: GRANTED_CONSENT });

      // ชุดไม่เปลี่ยนเมื่ออ่านซ้ำใต้ล็อก ⇒ ล็อกครั้งเดียว
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      const [strings, ids] = tx.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        { values: string[] },
      ];
      expect(strings.join('?')).toContain('ORDER BY id FOR NO KEY UPDATE');
      expect([...ids.values].sort()).toEqual(['c-other', 'c-stale', 'c1']);
      expect(order.indexOf('lock-customers')).toBeLessThan(order.indexOf('link-upsert'));
      expect(order.indexOf('lock-customers')).toBeLessThan(order.indexOf('rooms'));
    });

    it('ลูกค้ายกเลิกผูก LINE เดิมแล้ว แต่ LINE นี้ก็มีแถวของลูกค้าอื่น → 409 ให้พนักงานดู (รวมสองแถวไม่ได้)', async () => {
      rows.byCustomer = {
        id: 'link-old',
        lineUserId: 'U_OLD',
        unlinkedAt: new Date('2026-10-01T00:00:00.000Z'),
        deletedAt: null,
      };
      rows.byLine = { id: 'link-other', customerId: 'c-other', unlinkedAt: null, deletedAt: null };
      const otp = await requestRealOtp();

      await expect(tService.verifyOtp({ lineUserId: 'U123', otp, consent: GRANTED_CONSENT })).rejects.toThrow(
        LINE_LINK_NEEDS_STAFF_MESSAGE,
      );
      expect(merge.absorbRoomsOfLineUser).not.toHaveBeenCalled();
      expect(tPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
