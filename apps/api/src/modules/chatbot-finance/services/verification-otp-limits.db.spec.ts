/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/chatbot-finance/services/verification-otp-limits.db.spec.ts --runInBand
 *
 * Task 20 I1 — พิสูจน์บน Postgres จริง (mock มองไม่เห็นการแข่งกันของคำสั่งขนาน):
 *   1. ยิง verify ผิดพร้อมกัน 10 ครั้ง → กิน attempt ได้แค่ 3 · หลังจากนั้นรหัสที่ถูกก็ใช้ไม่ได้
 *   2. LINE 8 บัญชีขอ OTP เบอร์เดียวพร้อมกัน → SMS ออกไม่เกินเพดานต่อลูกค้าต่อวัน (5)
 *   3. ขอใหม่ในช่วงเวลาเดิมไม่รีเซ็ต attempts · ผิดครบแล้วขอใหม่ไม่ได้จนหมดช่วง
 */
import { PrismaClient } from '@prisma/client';
import {
  OTP_DAILY_REQUESTS_PER_CUSTOMER,
  OTP_QUOTA_KEY_PREFIX,
  VerificationService,
} from './verification.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const tag = `t20-${Date.now()}`;
const digits = String(Date.now()).slice(-8);
const PHONE = `09${digits}`;
const lines = Array.from({ length: 8 }, (_, i) => `U${tag}-${i}`);
let customerId = '';

const sms = { sendSmsFromQueue: jest.fn().mockResolvedValue(undefined) };
let verification: VerificationService;

const lastOtp = () => (sms.sendSmsFromQueue.mock.calls.at(-1)?.[1] as string).match(/(\d{6})/)![1];
const wrongOf = (otp: string) => String((Number(otp) + 1) % 1_000_000).padStart(6, '0');
const resetCooldown = (lineUserId: string) =>
  prisma.chatbotOtpRequest.update({
    where: { lineUserId },
    data: { lastRequestAt: new Date(Date.now() - 120_000) },
  });

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียน/ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
  const customer = await prisma.customer.create({ data: { name: `ทดสอบ ${tag}`, phone: PHONE } });
  customerId = customer.id;
  verification = new VerificationService(
    prisma as never,
    sms as never,
    { isEnabled: jest.fn().mockResolvedValue(false) } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
  );
});

beforeEach(async () => {
  sms.sendSmsFromQueue.mockClear();
  await prisma.chatbotOtpRequest.deleteMany({
    where: { lineUserId: { in: [...lines, `${OTP_QUOTA_KEY_PREFIX}${customerId}`] } },
  });
});

afterAll(async () => {
  await prisma.chatbotOtpRequest.deleteMany({
    where: { lineUserId: { in: [...lines, `${OTP_QUOTA_KEY_PREFIX}${customerId}`] } },
  });
  await prisma.customerLineLink.deleteMany({ where: { customerId } });
  await prisma.chatRoom.deleteMany({ where: { lineUserId: { in: lines } } });
  await prisma.customer.delete({ where: { id: customerId } });
  await prisma.$disconnect();
});

describe('OTP limits on real Postgres (Task 20 I1)', () => {
  it('1. 10 parallel wrong guesses consume exactly 3 attempts; the right code is then refused', async () => {
    await verification.requestOtp({ lineUserId: lines[0], phone: PHONE });
    const otp = lastOtp();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        verification.verifyOtp({ lineUserId: lines[0], otp: wrongOf(otp) }),
      ),
    );
    const messages = results.map((r) => (r.status === 'rejected' ? (r.reason as Error).message : 'OK'));
    expect(messages.filter((m) => m === 'OK')).toHaveLength(0);
    // ครั้งที่ 1–2 บอกจำนวนที่เหลือ ครั้งที่ 3 + ที่เหลือทั้งหมด = ล็อก (ไม่มีการเทียบรหัสเกิน 3 ครั้ง)
    expect(messages.filter((m) => m.startsWith('OTP ไม่ถูกต้อง'))).toHaveLength(2);
    const row = await prisma.chatbotOtpRequest.findUniqueOrThrow({ where: { lineUserId: lines[0] } });
    expect(row.attempts).toBe(3);

    await expect(verification.verifyOtp({ lineUserId: lines[0], otp })).rejects.toThrow(
      'ใส่ OTP ผิดครบ 3 ครั้งแล้ว',
    );
    expect(await prisma.customerLineLink.count({ where: { customerId } })).toBe(0);

    // ล็อกค้างจนหมดช่วง — ขอใหม่ (พ้น cooldown แล้ว) ก็ไม่ได้รหัสใหม่ ไม่ส่ง SMS
    await resetCooldown(lines[0]);
    sms.sendSmsFromQueue.mockClear();
    await expect(verification.requestOtp({ lineUserId: lines[0], phone: PHONE })).rejects.toThrow(
      /ขอรหัสใหม่ได้ในอีก \d+ นาที/,
    );
    expect(sms.sendSmsFromQueue).not.toHaveBeenCalled();
  });

  it('2. 8 LINE accounts requesting the same phone at once → at most 5 SMS (per-customer daily cap)', async () => {
    const results = await Promise.all(
      lines.map((lineUserId) => verification.requestOtp({ lineUserId, phone: PHONE })),
    );

    // ทุกคำขอได้คำตอบเหมือนกัน (M4) แต่ SMS ออกแค่เพดาน
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(sms.sendSmsFromQueue).toHaveBeenCalledTimes(OTP_DAILY_REQUESTS_PER_CUSTOMER);
    const quota = await prisma.chatbotOtpRequest.findUniqueOrThrow({
      where: { lineUserId: `${OTP_QUOTA_KEY_PREFIX}${customerId}` },
    });
    expect(quota.attempts).toBe(OTP_DAILY_REQUESTS_PER_CUSTOMER);
    expect(quota.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // แถวของบัญชีที่เกินเพดาน = decoy (ไม่ผูกลูกค้า)
    const decoys = await prisma.chatbotOtpRequest.count({
      where: { lineUserId: { in: lines }, customerId: '' },
    });
    expect(decoys).toBe(lines.length - OTP_DAILY_REQUESTS_PER_CUSTOMER);
  });

  it('3. re-request inside the window keeps attempts; the new code still verifies', async () => {
    await verification.requestOtp({ lineUserId: lines[1], phone: PHONE });
    await expect(
      verification.verifyOtp({ lineUserId: lines[1], otp: wrongOf(lastOtp()) }),
    ).rejects.toThrow('เหลือ 2 ครั้ง');

    await resetCooldown(lines[1]);
    await verification.requestOtp({ lineUserId: lines[1], phone: PHONE });
    const row = await prisma.chatbotOtpRequest.findUniqueOrThrow({ where: { lineUserId: lines[1] } });
    expect(row.attempts).toBe(1);

    await expect(
      verification.verifyOtp({ lineUserId: lines[1], otp: lastOtp() }),
    ).resolves.toMatchObject({ customerId });
  });
});
