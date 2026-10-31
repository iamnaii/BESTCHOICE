/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/notifications/payment-reminder-once-a-day.db.spec.ts --runInBand
 *
 * Task 30 ข้อ 1 (เจ้าของตัดสิน 31 ต.ค. 2026) — เตือนค่างวด **งวดละหนึ่งข้อความต่อวัน** บน Postgres จริง:
 * A1 (`NotificationReminderService.sendPaymentReminders` — cron 08:00) กับบอทการเงิน A8 (`AutoTriggerService.runDailyReminders` —
 * cron 09:00) รันวันเดียวกันกับงวดเดียวกัน — ทุกลำดับ (A1 ก่อน / บอทก่อน) สั่งรันซ้ำ และฝั่งแรกส่งไม่ผ่าน
 * คำถามจริงอยู่ที่ where ของ `notification_logs` + `chat_auto_triggers` (mock มองไม่เห็น)
 *
 * ปลายทางจริงถูก stub ทั้งหมด (transport ของ NotificationsService + `LineFinanceClientService.pushText`) — นับข้อความต่อ LINE
 */
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { ComplianceService } from './compliance.service';
import { HolidayService } from './holiday.service';
import { NotificationTemplateService } from './notification-template.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { AutoTriggerService } from '../chatbot-finance/services/auto-trigger.service';
import {
  InstallmentFixture,
  assertTestDatabase,
  bangkokAt,
  createFinanceFixtureBase,
  createInstallmentFixture,
  dueDateUtc,
  realBangkokDate,
  retireFixtures,
  useFakeDate,
  FinanceFixtureBase,
} from './__tests__/finance-line-fixtures';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const stamp = `t30a-${Date.now()}`;
const day = realBangkokDate();
let base: FinanceFixtureBase;
let notifications: NotificationsService;
let bot: AutoTriggerService;
const pushText = jest.fn();
const fixtures: InstallmentFixture[] = [];

type Via = 'a1Flex' | 'a1Text' | 'bot';
/** ข้อความที่ถึง LINE จริง (ส่งผ่าน) — Flex ของ A1 · ข้อความ template/คิวส่งซ้ำของ A1 · ข้อความของบอท */
const delivered: { to: string; via: Via }[] = [];
/** LINE ที่ตั้งให้ส่งไม่ผ่าน (จำลอง LINE API ล่ม) */
const failingLines = new Set<string>();
const sink = (via: Via) => async (to: string) => {
  if (failingLines.has(to)) throw new Error('LINE API down');
  delivered.push({ to, via });
};

function deliveredTo(lineUserId: string) {
  const count = (via: Via) => delivered.filter((d) => d.to === lineUserId && d.via === via).length;
  return { a1Flex: count('a1Flex'), a1Text: count('a1Text'), bot: count('bot') };
}

async function installment(label: string, dueInDays: number, opts: { consent?: boolean } = {}) {
  const f = await createInstallmentFixture(prisma, base, {
    label,
    dueDate: dueDateUtc(day, dueInDays),
    consent: opts.consent,
  });
  fixtures.push(f);
  return f;
}

const runA1At = async (hh: number, mm = 0) => {
  jest.setSystemTime(bangkokAt(day, 0, hh, mm));
  return notifications.sendPaymentReminders();
};
const runBotAt = async (hh: number, mm = 0) => {
  jest.setSystemTime(bangkokAt(day, 0, hh, mm));
  await bot.runDailyReminders();
};

beforeAll(async () => {
  assertTestDatabase();
  base = await createFinanceFixtureBase(prisma, stamp);
  const flex = {
    paymentReminder: jest.fn(() => ({ type: 'flex', altText: 'เตือนค่างวด', contents: {} })),
    overdueNotice: jest.fn(() => ({ type: 'flex', altText: 'ค้างชำระ', contents: {} })),
  };
  const compliance = new ComplianceService(
    prisma as never,
    new PDPAService(prisma as never),
    new HolidayService(),
  );
  notifications = new NotificationsService(
    prisma as never,
    { get: jest.fn() } as never,
    flex as never,
    { afterPayment: jest.fn(() => []) } as never,
    { getValue: jest.fn().mockResolvedValue('') } as never,
    compliance,
    new NotificationTemplateService(prisma as never),
  );
  bot = new AutoTriggerService(
    prisma as never,
    { pushText } as never,
    {
      getOrCreate: jest.fn().mockResolvedValue({ id: 'room' }),
      saveMessage: jest.fn().mockResolvedValue({ id: 'msg' }),
    } as never,
    { bankInfoBlock: '🏦 ทดสอบ' } as never,
  );
  jest.spyOn(notifications.transport, 'sendLineFlexMessage').mockImplementation(sink('a1Flex'));
  jest.spyOn(notifications.transport, 'sendLine').mockImplementation(sink('a1Text'));
  jest.spyOn(notifications.transport, 'sendSms').mockResolvedValue(undefined);
  pushText.mockImplementation(sink('bot'));
});

beforeEach(() => {
  useFakeDate(bangkokAt(day, 0, 7));
  failingLines.clear();
});

afterEach(async () => {
  jest.useRealTimers();
  await retireFixtures(prisma, fixtures.splice(0));
});

afterAll(async () => prisma.$disconnect());

describe('Task 30 ข้อ 1 — งวดละหนึ่งข้อความต่อวัน (A1 08:00 + บอท 09:00 วันเดียวกัน)', () => {
  it.each([3, 1, 0])(
    'T-%i: A1 08:00 ส่ง Flex → บอท 09:00 ข้าม ไม่จองแถว (ข้อความเดียว)',
    async (dueIn) => {
      const f = await installment(`a1first-${dueIn}`, dueIn);

      await runA1At(8);
      await runBotAt(9);

      expect(deliveredTo(f.lineUserId)).toEqual({ a1Flex: 1, a1Text: 0, bot: 0 });
      expect(await prisma.chatAutoTrigger.count({ where: { customerId: f.customerId } })).toBe(0);
    },
  );

  it('สั่งรันบอทก่อน (07:30 หลัง outage) → A1 08:00 ข้าม ทั้ง LINE และ SMS (ข้อความเดียว)', async () => {
    const f = await installment('botfirst', 3);

    await runBotAt(7, 30);
    const a1 = await runA1At(8);

    expect(deliveredTo(f.lineUserId)).toEqual({ a1Flex: 0, a1Text: 0, bot: 1 });
    expect(a1.dedupedByBot).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.notificationLog.count({
        where: { relatedId: f.paymentId, status: { in: ['SENT', 'RETRY_PENDING'] } },
      }),
    ).toBe(0);
  });

  it('สั่งรันซ้ำทั้งสองงานหลายรอบในวันเดียว → ยังข้อความเดียว', async () => {
    const f = await installment('reruns', 1);

    await runA1At(8);
    await runBotAt(9);
    await runA1At(11);
    await runBotAt(14);

    expect(deliveredTo(f.lineUserId)).toEqual({ a1Flex: 1, a1Text: 0, bot: 0 });
  });

  it('บอทส่งไม่ผ่าน (FAILED) → A1 ส่งแทนได้ → บอทรันซ้ำไม่ส่งอีก', async () => {
    const f = await installment('botfailed', 3);

    failingLines.add(f.lineUserId);
    await runBotAt(7, 30);
    expect(
      await prisma.chatAutoTrigger.findFirst({
        where: { customerId: f.customerId },
        select: { status: true },
      }),
    ).toEqual({ status: 'FAILED' });

    failingLines.clear();
    await runA1At(8);
    await runBotAt(9);

    expect(deliveredTo(f.lineUserId)).toEqual({ a1Flex: 1, a1Text: 0, bot: 0 });
  });

  it('A1 ส่งไม่ผ่านชั่วคราว → อยู่ในคิวส่งซ้ำ (A1 ยังถือการส่ง) → A1 รันซ้ำ/บอทไม่ซ้อน → คิวส่งซ้ำส่งถึง (ข้อความเดียว)', async () => {
    const f = await installment('a1retry', 3);

    failingLines.add(f.lineUserId);
    await runA1At(8);
    const log = await prisma.notificationLog.findFirstOrThrow({
      where: { relatedId: f.paymentId, channel: 'LINE' },
      select: { status: true, category: true },
    });
    expect(log).toEqual({ status: 'RETRY_PENDING', category: 'REMINDER' });

    // LINE กลับมาแล้ว — แต่แถวของ A1 ยังรอคิวส่งซ้ำ ⇒ สั่งรัน A1 ซ้ำ (หัวข้อของทางสำรองไม่ใช่หัวข้อ Flex) และบอท ไม่ส่งซ้อน
    failingLines.clear();
    await runA1At(8, 30);
    await runBotAt(9);
    expect(deliveredTo(f.lineUserId)).toEqual({ a1Flex: 0, a1Text: 0, bot: 0 });

    jest.setSystemTime(bangkokAt(day, 0, 9, 10));
    await notifications.processRetryQueue();

    expect(deliveredTo(f.lineUserId)).toEqual({ a1Flex: 0, a1Text: 1, bot: 0 });
  }, 30_000);

  it('A1 ส่งไม่ผ่านจนหมดรอบส่งซ้ำ (FAILED) → บอทส่งแทน (ฝั่งแรกพังไม่กันฝั่งที่สอง)', async () => {
    const f = await installment('a1exhausted', 3);

    failingLines.add(f.lineUserId);
    await runA1At(8, 30);
    // คิวส่งซ้ำ 5 รอบ (ถอย 5 × 3^n นาที: 5 · 15 · 45 · 135 · 405) ยังไม่ผ่าน → FAILED ถาวร ~18:40 น. — ยังเป็นวันเดียวกัน
    const offsetsMin = [6, 6 + 16, 6 + 16 + 46, 6 + 16 + 46 + 136, 6 + 16 + 46 + 136 + 406];
    for (const m of offsetsMin) {
      jest.setSystemTime(new Date(bangkokAt(day, 0, 8, 30).getTime() + m * 60_000));
      await notifications.processRetryQueue();
    }
    expect(
      await prisma.notificationLog.findFirstOrThrow({
        where: { relatedId: f.paymentId, channel: 'LINE' },
        select: { status: true },
      }),
    ).toEqual({ status: 'FAILED' });

    failingLines.clear();
    await runBotAt(18, 45);

    expect(deliveredTo(f.lineUserId)).toEqual({ a1Flex: 0, a1Text: 0, bot: 1 });
  }, 30_000);

  it('T-5 มีแต่บอท → ส่งตามเดิม (ข้อความเดียว)', async () => {
    const f = await installment('tminus5', 5);

    await runA1At(8);
    await runBotAt(9);

    expect(deliveredTo(f.lineUserId)).toEqual({ a1Flex: 0, a1Text: 0, bot: 1 });
  });

  it('ไม่มี consent PDPA → A1 ข้าม (แถว SKIPPED) → บอทส่ง — พฤติกรรมเดิมของบอท (ด่าน consent ของบอทรองาน "ยินยอมตอนผูก")', async () => {
    const f = await installment('noconsent', 3, { consent: false });

    await runA1At(8);
    await runBotAt(9);

    expect(deliveredTo(f.lineUserId)).toEqual({ a1Flex: 0, a1Text: 0, bot: 1 });
    expect(
      await prisma.notificationLog.count({ where: { relatedId: f.paymentId, status: 'SKIPPED' } }),
    ).toBe(1);
  });
});
