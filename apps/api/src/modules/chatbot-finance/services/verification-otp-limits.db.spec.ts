/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/chatbot-finance/services/verification-otp-limits.db.spec.ts --runInBand
 *
 * Task 20 I1 + fix round 1 (I-B, M1) — พิสูจน์บน Postgres จริง (mock มองไม่เห็นการแข่งกันของคำสั่งขนาน):
 *   1. ยิง verify ผิดพร้อมกัน 10 ครั้ง → กิน attempt ได้แค่ 3 · หลังจากนั้นรหัสที่ถูกก็ใช้ไม่ได้
 *   2. LINE เดียวยิงขอ OTP พร้อมกัน 5 คำขอ → ผ่าน cooldown ตัวเดียว · SMS ≤ 1 (cooldown atomic)
 *   3. LINE ผู้โจมตี 3 บัญชีเผาได้ไม่เกินเพดานย่อย (2 ต่อบัญชี) → LINE เจ้าของเบอร์ยังได้ SMS
 *   4. LINE 10 บัญชีขอเบอร์เดียว → SMS เท่าเพดานต่อลูกค้า (8)
 *   5. LINE เดียวขอ 6 เบอร์ในวันเดียว → ครั้งที่ 6 ไม่ส่ง SMS แม้เป็นเบอร์ลูกค้าจริง (เพดานต่อ LINE)
 *   6. ส่ง SMS ไม่สำเร็จ → คืนโควตา + ขอใหม่ได้ทันที
 *   7. ขอใหม่ในช่วงเวลาเดิมไม่รีเซ็ต attempts
 *
 * Task 21 (R-1, R-2):
 *   8. SMS ล้มหลังรหัสถูกเดาไปแล้ว → ไม่คืนโควตา (ขอบเขต ≤ 24 ครั้ง/ลูกค้า/วัน จริงทุกกรณี) · รหัสยังถูกทิ้ง
 *   9. มีคำขอของ LINE เดียวกันถือล็อกอยู่ → คำขอที่ซ้อนตอบ cooldown ทันที ไม่เข้าคิวถือ connection
 *  10. cron ล้างแถวหมดอายุข้ามแถวที่ทรานแซกชันอื่นล็อกอยู่ (SKIP LOCKED) แทนการรอ
 */
import { PrismaClient } from '@prisma/client';
import {
  OTP_QUOTA_KEY_PREFIX,
  OTP_REQUEST_LOCK_PREFIX,
  VerificationService,
} from './verification.service';

/** Task 33 — หน้า LIFF ส่งความยินยอมมาพร้อมรหัสเสมอ (DTO บังคับ) · ความยินยอมถูกบันทึกใน tx ของ bind */
const GRANTED_CONSENT = { granted: true } as const;

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const tag = `t20-${Date.now()}`;
const digits = String(Date.now()).slice(-8);
const PHONE = `09${digits}`;
const line = (name: string) => `U${tag}-${name}`;
let customerId = '';

const sms = { sendSmsFromQueue: jest.fn().mockResolvedValue(undefined) };
let verification: VerificationService;

const lastOtp = () => (sms.sendSmsFromQueue.mock.calls.at(-1)?.[1] as string).match(/(\d{6})/)![1];
const wrongOf = (otp: string) => String((Number(otp) + 1) % 1_000_000).padStart(6, '0');
const resetCooldown = (lineUserId: string) =>
  prisma.chatbotOtpRequest.updateMany({
    where: { lineUserId },
    data: { lastRequestAt: new Date(Date.now() - 120_000) },
  });
/** ปล่อยงานส่ง SMS ที่ไม่ได้ await (fire-and-forget) ให้จบ */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
/** ผลของ promise ภายในเวลาที่กำหนด — ยังไม่จบ = 'still-waiting' (ไม่รอให้เทสค้าง) */
async function within<T>(p: Promise<T>, ms: number): Promise<T | 'still-waiting'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'still-waiting'>((r) => {
    timer = setTimeout(() => r('still-waiting'), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
/** ทรานแซกชันที่ถือล็อกไว้จนกว่าจะเรียก release() — ใช้จำลองคำขอ/คำสั่งอื่นที่กำลังทำงานอยู่ */
async function holdInTransaction(
  lock: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<unknown>,
): Promise<{ release: () => Promise<void> }> {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => (locked = r));
  const done = prisma.$transaction(
    async (tx) => {
      await lock(tx);
      locked();
      await released;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  await isLocked;
  return {
    release: async () => {
      release();
      await done;
    },
  };
}
const myRows = () => ({
  OR: [{ lineUserId: { contains: tag } }, { lineUserId: { contains: customerId } }],
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
  // เวลาตอบขั้นต่ำ (M1) — ปิดในสเปคนี้ (ทดสอบแยกใน unit spec)
  (
    verification as unknown as { _setResponseFloorForTests?: (ms: number) => void }
  )._setResponseFloorForTests?.(0);
});

beforeEach(async () => {
  sms.sendSmsFromQueue.mockReset().mockResolvedValue(undefined);
  await prisma.chatbotOtpRequest.deleteMany({ where: myRows() });
});

afterAll(async () => {
  await prisma.chatbotOtpRequest.deleteMany({ where: myRows() });
  await prisma.customerLineLink.deleteMany({ where: { customerId } });
  await prisma.pDPAConsent.deleteMany({ where: { customerId } });
  await prisma.chatRoom.deleteMany({ where: { lineUserId: { contains: tag } } });
  await prisma.customer.delete({ where: { id: customerId } });
  await prisma.$disconnect();
});

describe('OTP limits on real Postgres (Task 20 I1 + fix round 1)', () => {
  it('1. 10 parallel wrong guesses consume exactly 3 attempts; the right code is then refused', async () => {
    const lineUserId = line('guess');
    await verification.requestOtp({ lineUserId, phone: PHONE });
    const otp = lastOtp();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        verification.verifyOtp({ lineUserId, otp: wrongOf(otp), consent: GRANTED_CONSENT }),
      ),
    );
    const messages = results.map((r) =>
      r.status === 'rejected' ? (r.reason as Error).message : 'OK',
    );
    expect(messages.filter((m) => m === 'OK')).toHaveLength(0);
    expect(messages.filter((m) => m.startsWith('OTP ไม่ถูกต้อง'))).toHaveLength(2);
    const row = await prisma.chatbotOtpRequest.findUniqueOrThrow({ where: { lineUserId } });
    expect(row.attempts).toBe(3);

    await expect(
      verification.verifyOtp({ lineUserId, otp, consent: GRANTED_CONSENT }),
    ).rejects.toThrow('ใส่ OTP ผิดครบ 3 ครั้งแล้ว');
    expect(await prisma.customerLineLink.count({ where: { customerId } })).toBe(0);

    // ล็อกค้างจนหมดช่วง — ขอใหม่ (พ้น cooldown แล้ว) ก็ไม่ได้รหัสใหม่ ไม่ส่ง SMS
    await resetCooldown(lineUserId);
    sms.sendSmsFromQueue.mockClear();
    await expect(verification.requestOtp({ lineUserId, phone: PHONE })).rejects.toThrow(
      /ขอรหัสใหม่ได้ในอีก \d+ นาที/,
    );
    expect(sms.sendSmsFromQueue).not.toHaveBeenCalled();
  });

  it('2. one LINE firing 5 requests at once passes the cooldown once → at most 1 SMS', async () => {
    const lineUserId = line('burst');
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => verification.requestOtp({ lineUserId, phone: PHONE })),
    );
    await settle();

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(sms.sendSmsFromQueue.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('3. three attacker LINE accounts burn at most 2 each — the owner LINE still gets an SMS', async () => {
    for (const name of ['atk-a', 'atk-b', 'atk-c']) {
      const lineUserId = line(name);
      for (let i = 0; i < 4; i++) {
        await verification.requestOtp({ lineUserId, phone: PHONE });
        await resetCooldown(lineUserId);
      }
    }
    await settle();
    expect(sms.sendSmsFromQueue.mock.calls.length).toBeLessThanOrEqual(6);

    sms.sendSmsFromQueue.mockClear();
    const owner = line('owner');
    await verification.requestOtp({ lineUserId: owner, phone: PHONE });
    await settle();
    expect(sms.sendSmsFromQueue).toHaveBeenCalledTimes(1);
    const row = await prisma.chatbotOtpRequest.findUniqueOrThrow({ where: { lineUserId: owner } });
    expect(row.customerId).toBe(customerId);
  });

  it('4. ten LINE accounts asking for the same phone → SMS capped at 8 per customer per day', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        verification.requestOtp({ lineUserId: line(`many-${i}`), phone: PHONE }),
      ),
    );
    await settle();

    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1); // M4: ทุกคนได้คำตอบเดียวกัน
    expect(sms.sendSmsFromQueue).toHaveBeenCalledTimes(8);
    const quota = await prisma.chatbotOtpRequest.findUniqueOrThrow({
      where: { lineUserId: `${OTP_QUOTA_KEY_PREFIX}${customerId}` },
    });
    expect(quota.attempts).toBe(8);
  });

  it('5. one LINE asking for 6 numbers in a day — the 6th sends nothing even for a real customer', async () => {
    const lineUserId = line('prober');
    for (let i = 0; i < 5; i++) {
      await verification.requestOtp({ lineUserId, phone: `0810000${String(i).padStart(3, '0')}` });
      await resetCooldown(lineUserId);
    }
    await verification.requestOtp({ lineUserId, phone: PHONE });
    await settle();

    expect(sms.sendSmsFromQueue).not.toHaveBeenCalled();
    const row = await prisma.chatbotOtpRequest.findUniqueOrThrow({ where: { lineUserId } });
    expect(row.customerId).toBe(''); // decoy
  });

  it('6. SMS provider failure refunds the quota and allows an immediate retry', async () => {
    const lineUserId = line('smsfail');
    sms.sendSmsFromQueue.mockRejectedValueOnce(new Error('provider down'));

    await expect(verification.requestOtp({ lineUserId, phone: PHONE })).resolves.toBeDefined();
    await settle();

    const quota = await prisma.chatbotOtpRequest.findUniqueOrThrow({
      where: { lineUserId: `${OTP_QUOTA_KEY_PREFIX}${customerId}` },
    });
    expect(quota.attempts).toBe(0);
    // ขอใหม่ได้ทันที (ไม่ติด cooldown) และรอบนี้ส่งได้
    await expect(verification.requestOtp({ lineUserId, phone: PHONE })).resolves.toBeDefined();
    await settle();
    expect(sms.sendSmsFromQueue).toHaveBeenCalledTimes(2);
    await expect(
      verification.verifyOtp({ lineUserId, otp: lastOtp(), consent: GRANTED_CONSENT }),
    ).resolves.toMatchObject({
      customerId,
    });
    await prisma.customerLineLink.deleteMany({ where: { customerId } });
    await prisma.customer.update({ where: { id: customerId }, data: { lineIdFinance: null } });
  });

  it('7. re-request inside the window keeps attempts; the new code still verifies', async () => {
    const lineUserId = line('rereq');
    await verification.requestOtp({ lineUserId, phone: PHONE });
    await settle();
    await expect(
      verification.verifyOtp({ lineUserId, otp: wrongOf(lastOtp()), consent: GRANTED_CONSENT }),
    ).rejects.toThrow('เหลือ 2 ครั้ง');

    await resetCooldown(lineUserId);
    await verification.requestOtp({ lineUserId, phone: PHONE });
    await settle();
    const row = await prisma.chatbotOtpRequest.findUniqueOrThrow({ where: { lineUserId } });
    expect(row.attempts).toBe(1);

    await expect(
      verification.verifyOtp({ lineUserId, otp: lastOtp(), consent: GRANTED_CONSENT }),
    ).resolves.toMatchObject({
      customerId,
    });
  });

  it('8. R-1: SMS failure after the issued code was guessed does not refund the quota (code still dropped)', async () => {
    const lineUserId = line('guessed-then-fail');
    let failSms!: (err: Error) => void;
    sms.sendSmsFromQueue.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (failSms = reject)),
    );
    await verification.requestOtp({ lineUserId, phone: PHONE });
    const otp = lastOtp();
    // ผู้ถือ LINE เดาไปแล้วหนึ่งครั้งก่อนที่ provider จะตอบว่าส่งไม่สำเร็จ
    await expect(
      verification.verifyOtp({ lineUserId, otp: wrongOf(otp), consent: GRANTED_CONSENT }),
    ).rejects.toThrow('เหลือ 2 ครั้ง');
    failSms(new Error('provider down'));
    await settle();

    const customerQuota = await prisma.chatbotOtpRequest.findUniqueOrThrow({
      where: { lineUserId: `${OTP_QUOTA_KEY_PREFIX}${customerId}` },
    });
    const pairQuota = await prisma.chatbotOtpRequest.findUniqueOrThrow({
      where: { lineUserId: `${OTP_QUOTA_KEY_PREFIX}${customerId}:line:${lineUserId}` },
    });
    expect(customerQuota.attempts).toBe(1);
    expect(pairQuota.attempts).toBe(1);
    // รหัสที่ออกยังถูกทิ้ง (SMS ไม่ถึงเจ้าของเบอร์) — รหัสที่ถูกใช้ไม่ได้อีก
    await expect(
      verification.verifyOtp({ lineUserId, otp, consent: GRANTED_CONSENT }),
    ).rejects.toThrow('OTP ไม่ถูกต้อง');
  });

  it('9. R-2: a request that finds its LINE lock taken answers the cooldown at once instead of queueing', async () => {
    const lineUserId = line('trylock');
    const holder = await holdInTransaction(
      (tx) =>
        tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${OTP_REQUEST_LOCK_PREFIX + lineUserId}))`,
    );
    const pending = verification.requestOtp({ lineUserId, phone: PHONE }).then(
      () => 'issued',
      (err: Error) => err.message,
    );
    const outcome = await within(pending, 2_000);
    await holder.release();
    await pending; // โค้ดเดิมรอคิวจนผู้ถือปล่อย — เก็บให้จบก่อนตรวจ
    await settle();

    expect(outcome).toMatch(/^รบกวนรอ \d+ วินาทีก่อนขอ OTP ใหม่$/);
    expect(sms.sendSmsFromQueue).not.toHaveBeenCalled();
    expect(await prisma.chatbotOtpRequest.count({ where: { lineUserId } })).toBe(0);
  });

  it('10. R-2: OTP cleanup skips expired rows another transaction holds instead of waiting on them', async () => {
    const expiredAt = new Date(Date.now() - 60_000);
    const row = (name: string) => ({
      lineUserId: line(name),
      customerId: '',
      phone: '',
      hash: '',
      expiresAt: expiredAt,
      attempts: 0,
      lastRequestAt: expiredAt,
    });
    await prisma.chatbotOtpRequest.createMany({
      data: [
        row('expired-held'),
        row('expired-free'),
        // ยังไม่หมดอายุ (อีก 1 ชม.) — ต้องรอดเสมอ ไม่ว่า timezone ของ session ฐานข้อมูลจะเป็นอะไร
        { ...row('fresh'), expiresAt: new Date(Date.now() + 3_600_000) },
      ],
    });
    const holder = await holdInTransaction(
      (tx) =>
        tx.$queryRaw`SELECT id FROM chatbot_otp_requests WHERE line_user_id = ${line('expired-held')} FOR UPDATE`,
    );

    const outcome = await within(
      verification.cleanupExpiredOtps().then(() => 'done'),
      2_000,
    );
    const afterFirstPass = await prisma.chatbotOtpRequest.findMany({
      where: { lineUserId: { in: [line('expired-held'), line('expired-free')] } },
      select: { lineUserId: true },
    });
    await holder.release();
    await verification.cleanupExpiredOtps();

    expect(outcome).toBe('done');
    expect(afterFirstPass.map((r) => r.lineUserId)).toEqual([line('expired-held')]);
    expect(
      await prisma.chatbotOtpRequest.count({
        where: { lineUserId: { in: [line('expired-held'), line('expired-free')] } },
      }),
    ).toBe(0);
    expect(await prisma.chatbotOtpRequest.count({ where: { lineUserId: line('fresh') } })).toBe(1);
  });
});
