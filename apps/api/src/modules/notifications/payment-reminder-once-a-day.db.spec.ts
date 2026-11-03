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
import { CollectionsNotifierService } from './services/collections-notifier.service';
import {
  InstallmentFixture,
  assertTestDatabase,
  bangkokAt,
  createFinanceFixtureBase,
  createInstallmentFixture,
  dueDateBkk,
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
let collections: CollectionsNotifierService;
const pushText = jest.fn();
/** สัญญาที่สร้างลิงก์ชำระไม่ได้ (จำลอง gateway พัง) */
const failingPayLinkContracts = new Set<string>();
const fixtures: InstallmentFixture[] = [];

type Via = 'flex' | 'text' | 'bot' | 'payLink' | 'sms';
/** ข้อความที่ถึง LINE จริง (ส่งผ่าน) — Flex ของ NotificationsService (A1/A2) · ข้อความ template/คิวส่งซ้ำ (A1/A2) · ข้อความของบอท */
const delivered: { to: string; via: Via }[] = [];
/** LINE ที่ตั้งให้ส่งไม่ผ่าน (จำลอง LINE API ล่ม) */
const failingLines = new Set<string>();
const sink = (via: Via) => async (to: string) => {
  if (failingLines.has(to)) throw new Error('LINE API down');
  delivered.push({ to, via });
};

/** การ์ดลิงก์ชำระอัตโนมัติ (A6) ที่ถึง LINE นี้ */
const payLinkCards = (lineUserId: string) =>
  delivered.filter((d) => d.to === lineUserId && d.via === 'payLink').length;

function deliveredTo(lineUserId: string) {
  const count = (via: Via) => delivered.filter((d) => d.to === lineUserId && d.via === via).length;
  return { flex: count('flex'), text: count('text'), bot: count('bot') };
}

async function installment(
  label: string,
  dueInDays: number,
  opts: { consent?: boolean; linked?: boolean; phone?: string } = {},
) {
  const f = await createInstallmentFixture(prisma, base, {
    label,
    dueDate: dueDateBkk(day, dueInDays),
    consent: opts.consent,
    linkedAt: opts.linked === false ? null : undefined,
    phone: opts.phone,
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
const runPayLinksAt = async (hh: number, mm = 0) => {
  jest.setSystemTime(bangkokAt(day, 0, hh, mm));
  await collections.sendAutoPaymentLinks();
};
const runA2At = async (hh: number, mm = 0) => {
  jest.setSystemTime(bangkokAt(day, 0, hh, mm));
  return notifications.sendOverdueNotices();
};
const runBotEscalationsAt = async (hh: number, mm = 0) => {
  jest.setSystemTime(bangkokAt(day, 0, hh, mm));
  await bot.runDailyEscalations();
};
/** คิวส่งซ้ำ 5 รอบ (ถอย 5 × 3^n นาที: 5 · 15 · 45 · 135 · 405) ยังไม่ผ่าน → FAILED ถาวร · เริ่มนับจาก hh:mm */
async function exhaustRetryQueueFrom(hh: number, mm: number) {
  const offsetsMin = [6, 6 + 16, 6 + 16 + 46, 6 + 16 + 46 + 136, 6 + 16 + 46 + 136 + 406];
  for (const m of offsetsMin) {
    jest.setSystemTime(new Date(bangkokAt(day, 0, hh, mm).getTime() + m * 60_000));
    await notifications.processRetryQueue();
  }
}

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
  jest.spyOn(notifications.transport, 'sendLineFlexMessage').mockImplementation(sink('flex'));
  jest.spyOn(notifications.transport, 'sendLine').mockImplementation(sink('text'));
  jest.spyOn(notifications.transport, 'sendSms').mockImplementation(async (to: string) => {
    delivered.push({ to, via: 'sms' });
    return 'sms-id';
  });
  pushText.mockImplementation(sink('bot'));
  collections = new CollectionsNotifierService(
    prisma as never,
    { sendFlexMessage: jest.fn(sink('payLink')) } as never,
    new PDPAService(prisma as never),
    notifications,
    {
      createPaymentLink: jest.fn(async (contractId: string) => {
        if (failingPayLinkContracts.has(contractId)) throw new Error('gateway down');
        return { url: 'https://pay.test/x', token: 't', amount: 1515.83, expiresAt: new Date() };
      }),
    } as never,
  );
});

beforeEach(() => {
  useFakeDate(bangkokAt(day, 0, 7));
  failingLines.clear();
  failingPayLinkContracts.clear();
});

afterEach(async () => {
  jest.useRealTimers();
  await retireFixtures(prisma, fixtures.splice(0));
});

afterAll(async () => prisma.$disconnect());

describe('Task 30 ข้อ 1 — งวดละหนึ่งข้อความต่อวัน (A1 08:00 + บอท 09:00 วันเดียวกัน)', () => {
  // T-3 ของงวดที่ลิงก์ชำระอัตโนมัติส่ง = การ์ดลิงก์ชำระใบเดียว (รอบ 2 ข้อ 1 — describe ถัดไป)
  it.each([1, 0])(
    'T-%i: A1 08:00 ส่ง Flex → บอท 09:00 ข้าม ไม่จองแถว (ข้อความเดียว)',
    async (dueIn) => {
      const f = await installment(`a1first-${dueIn}`, dueIn);

      await runA1At(8);
      await runBotAt(9);

      expect(deliveredTo(f.lineUserId)).toEqual({ flex: 1, text: 0, bot: 0 });
      expect(await prisma.chatAutoTrigger.count({ where: { customerId: f.customerId } })).toBe(0);
    },
  );

  it('สั่งรันบอทก่อน (07:30 หลัง outage) → A1 08:00 ข้าม ทั้ง LINE และ SMS (ข้อความเดียว)', async () => {
    const f = await installment('botfirst', 3);

    await runBotAt(7, 30);
    const a1 = await runA1At(8);

    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 0, text: 0, bot: 1 });
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

    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 1, text: 0, bot: 0 });
  });

  it('บอทส่งไม่ผ่าน (FAILED) → A1 ส่งแทนได้ → บอทรันซ้ำไม่ส่งอีก', async () => {
    const f = await installment('botfailed', 1);

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

    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 1, text: 0, bot: 0 });
  });

  it('A1 ส่งไม่ผ่านชั่วคราว → อยู่ในคิวส่งซ้ำ (A1 ยังถือการส่ง) → A1 รันซ้ำ/บอทไม่ซ้อน → คิวส่งซ้ำส่งถึง (ข้อความเดียว)', async () => {
    const f = await installment('a1retry', 1);

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
    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 0, text: 0, bot: 0 });

    jest.setSystemTime(bangkokAt(day, 0, 9, 10));
    await notifications.processRetryQueue();

    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 0, text: 1, bot: 0 });
  }, 30_000);

  it('A1 ส่งไม่ผ่านจนหมดรอบส่งซ้ำ (FAILED) → บอทส่งแทน (ฝั่งแรกพังไม่กันฝั่งที่สอง)', async () => {
    const f = await installment('a1exhausted', 1);

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

    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 0, text: 0, bot: 1 });
  }, 30_000);

  it('T-5 มีแต่บอท → ส่งตามเดิม (ข้อความเดียว)', async () => {
    const f = await installment('tminus5', 5);

    await runA1At(8);
    await runBotAt(9);

    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 0, text: 0, bot: 1 });
  });

  it('ไม่มี consent PDPA → A1 ข้าม · บอทข้ามด้วยด่านเดียวกัน (Task 34 ข้อ 3 — เดิมบอทส่งแทน) · แถว SKIPPED ของทั้งคู่', async () => {
    const f = await installment('noconsent', 1, { consent: false });

    await runA1At(8);
    await runBotAt(9);

    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 0, text: 0, bot: 0 });
    expect(await prisma.chatAutoTrigger.count({ where: { customerId: f.customerId } })).toBe(0);
    expect(
      await prisma.notificationLog.count({ where: { relatedId: f.paymentId, status: 'SKIPPED' } }),
    ).toBe(2);
  });
});

describe('Task 30 รอบ 2 ข้อ 3 — ทวง T+1/T+3 งวดละหนึ่งข้อความต่อวัน (A2 09:00 + บอท 10:00 วันเดียวกัน)', () => {
  it.each([1, 3])(
    'T+%i: A2 09:00 ส่ง Flex → บอท 10:00 ข้าม ไม่จองแถว (ข้อความเดียว)',
    async (overdue) => {
      const f = await installment(`a2first-${overdue}`, -overdue);

      await runA2At(9);
      await runBotEscalationsAt(10);

      expect(deliveredTo(f.lineUserId)).toEqual({ flex: 1, text: 0, bot: 0 });
      expect(await prisma.chatAutoTrigger.count({ where: { customerId: f.customerId } })).toBe(0);
    },
  );

  it('สั่งรันบอทก่อน (08:00) → A2 09:00 ข้าม ทั้ง LINE และ SMS (ข้อความเดียว)', async () => {
    const f = await installment('esc-botfirst', -1);

    await runBotEscalationsAt(8);
    const a2 = await runA2At(9);

    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 0, text: 0, bot: 1 });
    expect(a2.dedupedByBot).toBeGreaterThanOrEqual(1);
  });

  it('สั่งรันซ้ำทั้งสองงานหลายรอบในวันเดียว → ยังข้อความเดียว', async () => {
    const f = await installment('esc-reruns', -3);

    await runA2At(9);
    await runBotEscalationsAt(10);
    await runA2At(11);
    await runBotEscalationsAt(14);

    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 1, text: 0, bot: 0 });
  });

  it('บอทส่งไม่ผ่าน (FAILED) → A2 ส่งแทน → บอทรันซ้ำไม่ส่งอีก', async () => {
    const f = await installment('esc-botfailed', -1);

    failingLines.add(f.lineUserId);
    await runBotEscalationsAt(8);
    failingLines.clear();
    await runA2At(9);
    await runBotEscalationsAt(10);

    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 1, text: 0, bot: 0 });
  });

  it('A2 ส่งไม่ผ่านชั่วคราว (คิวส่งซ้ำ) → บอท 10:00 ไม่ซ้อน · A2 ส่งไม่ผ่านจนหมดคิว → บอทส่งแทน', async () => {
    const retrying = await installment('esc-retry', -1);

    failingLines.add(retrying.lineUserId);
    await runA2At(9);
    expect(
      await prisma.notificationLog.findFirstOrThrow({
        where: { relatedId: retrying.paymentId, channel: 'LINE', category: 'DUNNING' },
        select: { status: true },
      }),
    ).toEqual({ status: 'RETRY_PENDING' });
    await runBotEscalationsAt(10);
    expect(deliveredTo(retrying.lineUserId).bot).toBe(0);

    await exhaustRetryQueueFrom(9, 0);
    expect(
      await prisma.notificationLog.findFirstOrThrow({
        where: { relatedId: retrying.paymentId, channel: 'LINE', category: 'DUNNING' },
        select: { status: true },
      }),
    ).toEqual({ status: 'FAILED' });

    failingLines.clear();
    await runBotEscalationsAt(19, 30);

    expect(deliveredTo(retrying.lineUserId)).toEqual({ flex: 0, text: 0, bot: 1 });
  }, 30_000);

  it('T+7 มีแต่ A2 → ส่งตามเดิม', async () => {
    const f = await installment('esc-tplus7', -7);

    await runA2At(9);
    await runBotEscalationsAt(10);

    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 1, text: 0, bot: 0 });
  });
});

describe('Task 30 รอบ 2 ข้อ 1 — T-3 เหลือการ์ดลิงก์ชำระ (A6 08:30) ใบเดียว', () => {
  it('A1 08:00 เว้นให้ → A6 08:30 ส่งการ์ด → บอท 09:00 ข้าม (ข้อความเดียว = การ์ดลิงก์ชำระ)', async () => {
    const f = await installment('paylink', 3);

    const a1 = await runA1At(8);
    await runPayLinksAt(8, 30);
    await runBotAt(9);
    await runA1At(11); // สั่งรันซ้ำ

    expect(a1.deferredToPayLink).toBeGreaterThanOrEqual(1);
    expect(payLinkCards(f.lineUserId)).toBe(1);
    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 0, text: 0, bot: 0 });
    expect(await prisma.chatAutoTrigger.count({ where: { customerId: f.customerId } })).toBe(0);
  });

  it('สั่งรันลิงก์ชำระซ้ำในวันเดียว → การ์ดใบเดียว (ไม่สร้างลิงก์ใหม่)', async () => {
    const f = await installment('paylink-rerun', 3);

    await runPayLinksAt(8, 30);
    await runPayLinksAt(12);

    expect(payLinkCards(f.lineUserId)).toBe(1);
  });

  it('A6 สร้างลิงก์ไม่ได้ (แถว FAILED) → บอท 09:00 ส่งเตือนแทน → A1 สั่งรันซ้ำไม่ส่งอีก (ข้อความเดียว)', async () => {
    const f = await installment('paylink-failed', 3);
    failingPayLinkContracts.add(f.contractId);

    await runA1At(8);
    await runPayLinksAt(8, 30);
    expect(
      await prisma.notificationLog.findFirstOrThrow({
        where: { relatedId: f.paymentId, subject: 'ลิงก์ชำระอัตโนมัติ' },
        select: { status: true },
      }),
    ).toEqual({ status: 'FAILED' });
    await runBotAt(9);
    await runA1At(11);

    expect(payLinkCards(f.lineUserId)).toBe(0);
    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 0, text: 0, bot: 1 });
  });

  it('A6 ส่งไม่ผ่าน + บอทส่งไม่ผ่าน → A1 ที่สั่งรันซ้ำเลิกเว้นให้ ส่ง Flex เอง (ข้อความเดียว)', async () => {
    const f = await installment('paylink-all-failed', 3);

    await runA1At(8);
    failingLines.add(f.lineUserId);
    await runPayLinksAt(8, 30);
    await runBotAt(9);
    failingLines.clear();
    await runA1At(11);
    await runBotAt(12);

    expect(payLinkCards(f.lineUserId)).toBe(0);
    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 1, text: 0, bot: 0 });
  });

  it('สั่งรันบอทก่อน (07:30) → A1 ข้าม → A6 ไม่ส่งการ์ดซ้ำ (ข้อความเดียว = ของบอท)', async () => {
    const f = await installment('paylink-botfirst', 3);

    await runBotAt(7, 30);
    await runA1At(8);
    await runPayLinksAt(8, 30);

    expect(payLinkCards(f.lineUserId)).toBe(0);
    expect(deliveredTo(f.lineUserId)).toEqual({ flex: 0, text: 0, bot: 1 });
  });

  it('ลูกค้าไม่ผูก LINE (ลิงก์ชำระไม่ส่ง) → A1 ไม่เว้น ส่ง SMS ตามเดิม', async () => {
    const phone = `08${String(Date.now()).slice(-8)}`;
    await installment('paylink-unlinked', 3, { linked: false, phone });

    await runA1At(8);
    await runPayLinksAt(8, 30);

    expect(delivered.filter((d) => d.to === phone && d.via === 'sms')).toHaveLength(1);
  });
});
