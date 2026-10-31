/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/notifications/legacy-link-grace.db.spec.ts --runInBand
 *
 * Task 30 ข้อ 2 (เจ้าของตัดสิน 31 ต.ค. 2026) — **ผ่อนผัน 7 วันหลังผูก LINE สำหรับสัญญาที่นำเข้าจากระบบเดิม** บน Postgres จริง
 * (คำถามจริงคือ relation filter `legacyContractCode` + `customer.lineLinks.linkedAt` ซึ่ง mock มองไม่เห็น):
 *   สัญญานำเข้า + ผูก 3 วันก่อน → ไม่โดนทวงทาง LINE (ทุกผู้ส่งหมวดทวง) · ผูก 8 วันก่อน → ทวงตามเดิม · ผูกครบ 7 วันพอดี → พ้นช่วง ·
 *   สัญญาที่ไม่ได้นำเข้า → ทวงตามเดิม · ลูกค้าคนเดียวมีทั้งสองแบบ → ระงับเฉพาะสัญญานำเข้า · เตือนค่างวดยังส่งระหว่างผ่อนผัน ·
 *   SMS ทวงไม่เปลี่ยน
 *
 * ปลายทางจริงถูก stub (transport ของ NotificationsService · LineOaService · LineFinanceClient) — นับข้อความต่อ LINE ที่ส่งผ่าน
 */
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { ComplianceService } from './compliance.service';
import { HolidayService } from './holiday.service';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationCategory } from './notification-category.enum';
import { CollectionsNotifierService } from './services/collections-notifier.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { AutoTriggerService } from '../chatbot-finance/services/auto-trigger.service';
import { DunningEngineService } from '../overdue/dunning-engine.service';
import { VerificationService } from '../chatbot-finance/services/verification.service';
import { OverdueBulkService } from '../overdue/bulk.service';
import { LiffApiService } from '../line-oa/liff-api.service';
import {
  FinanceFixtureBase,
  InstallmentFixture,
  assertTestDatabase,
  bangkokAt,
  createFinanceFixtureBase,
  createInstallmentFixture,
  dueDateBkk,
  realBangkokDate,
  retireFixtures,
  useFakeDate,
} from './__tests__/finance-line-fixtures';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));
jest.mock('@sentry/node', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const stamp = `t30b-${Date.now()}`;
const day = realBangkokDate();
const DAY_MS = 24 * 60 * 60 * 1000;
/** เวลาปลอมของทุกเคส — 10:00 น. ไทย (ในเวลาทำการทั้งวันธรรมดาและวันหยุด) */
const NOW = bangkokAt(day, 0, 10);
let base: FinanceFixtureBase;
let notifications: NotificationsService;
let collections: CollectionsNotifierService;
let bot: AutoTriggerService;
let engine: DunningEngineService;
let verification: VerificationService;
let liff: LiffApiService;
let collectionsQueue: OverdueBulkService;
const sms = { sendSmsFromQueue: jest.fn().mockResolvedValue(undefined) };

/** ทางผูกจริง: ขอ OTP ไปเบอร์ของลูกค้า แล้วยืนยันด้วยรหัสที่ส่งทาง SMS (VerificationService.bind) */
async function verifyWithOtp(lineUserId: string, phone: string) {
  await verification.requestOtp({ lineUserId, phone });
  const otp = (sms.sendSmsFromQueue.mock.calls.at(-1)?.[1] as string).match(/(\d{6})/)![1];
  return verification.verifyOtp({ lineUserId, otp });
}
const fixtures: InstallmentFixture[] = [];
let seq = 0;

type Via = 'flex' | 'text' | 'sms' | 'oaFlex' | 'bot';
const delivered: { to: string; via: Via }[] = [];
const sink = (via: Via) => async (to: string) => {
  delivered.push({ to, via });
};
const lineDeliveries = (lineUserId: string) =>
  delivered.filter((d) => d.to === lineUserId && d.via !== 'sms').length;

/** สามสัญญาที่ค้างชำระงวดเดียวกัน: นำเข้า+ผูก 3 วัน · นำเข้า+ผูก 8 วัน · ไม่ได้นำเข้า+ผูก 3 วัน (+ นำเข้า+ผูกครบ 7 วันพอดี) */
async function trio(dueInDays: number) {
  const make = (label: string, linkedDaysAgo: number, legacy: boolean) =>
    createInstallmentFixture(prisma, base, {
      label: `${label}-${++seq}`,
      dueDate: dueDateBkk(day, dueInDays),
      linkedAt: new Date(NOW.getTime() - linkedDaysAgo * DAY_MS),
      legacyCode: legacy ? `${stamp}-LG-${seq}` : null,
    });
  const legacy3 = await make('legacy3', 3, true);
  const legacy8 = await make('legacy8', 8, true);
  const legacy7 = await make('legacy7', 7, true);
  const native3 = await make('native3', 3, false);
  fixtures.push(legacy3, legacy8, legacy7, native3);
  return { legacy3, legacy8, legacy7, native3 };
}

const graceBlocks = (relatedId: string) =>
  prisma.notificationLog.count({
    where: { relatedId, status: 'BLOCKED', blockReason: 'LEGACY_LINK_GRACE', category: 'DUNNING' },
  });

beforeAll(async () => {
  assertTestDatabase();
  base = await createFinanceFixtureBase(prisma, stamp);
  const pdpa = new PDPAService(prisma as never);
  const compliance = new ComplianceService(prisma as never, pdpa, new HolidayService());
  notifications = new NotificationsService(
    prisma as never,
    { get: jest.fn() } as never,
    {
      paymentReminder: jest.fn(() => ({ type: 'flex', altText: 'เตือน', contents: {} })),
      overdueNotice: jest.fn(() => ({ type: 'flex', altText: 'ค้างชำระ', contents: {} })),
    } as never,
    { afterPayment: jest.fn(() => []) } as never,
    { getValue: jest.fn().mockResolvedValue('') } as never,
    compliance,
    new NotificationTemplateService(prisma as never),
  );
  jest.spyOn(notifications.transport, 'sendLineFlexMessage').mockImplementation(sink('flex'));
  jest.spyOn(notifications.transport, 'sendLine').mockImplementation(sink('text'));
  jest.spyOn(notifications.transport, 'sendSms').mockImplementation(async (to: string) => {
    delivered.push({ to, via: 'sms' });
    return 'sms-id';
  });
  collections = new CollectionsNotifierService(
    prisma as never,
    { sendFlexMessage: jest.fn(sink('oaFlex')) } as never,
    pdpa,
    notifications,
    {} as never,
  );
  bot = new AutoTriggerService(
    prisma as never,
    { pushText: jest.fn(sink('bot')) } as never,
    {
      getOrCreate: jest.fn().mockResolvedValue({ id: 'room' }),
      saveMessage: jest.fn().mockResolvedValue({ id: 'msg' }),
    } as never,
    { bankInfoBlock: '🏦 ทดสอบ' } as never,
  );
  verification = new VerificationService(
    prisma as never,
    sms as never,
    { isEnabled: jest.fn().mockResolvedValue(false) } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    undefined,
    undefined,
    { get: jest.fn(() => ({ switchRichMenu: jest.fn().mockResolvedValue(undefined) })) } as never,
  );
  verification._setResponseFloorForTests(0);
  liff = new LiffApiService(prisma as never);
  collectionsQueue = new OverdueBulkService(prisma as never, {} as never, notifications);
  engine = new DunningEngineService(
    prisma as never,
    { findAllActiveRules: jest.fn().mockResolvedValue([]) } as never,
    notifications,
    { createPaymentLink: jest.fn().mockResolvedValue({ url: 'https://pay.test/x' }) } as never,
    {
      fetchTagsForCustomer: jest.fn().mockResolvedValue([]),
      resolve: jest.fn().mockReturnValue({ action: 'send', delayDays: 0, skipSoft: false }),
    } as never,
  );
});

beforeEach(() => useFakeDate(NOW));

afterEach(async () => {
  jest.useRealTimers();
  await retireFixtures(prisma, fixtures.splice(0));
});

afterAll(async () => prisma.$disconnect());

describe('Task 30 ข้อ 2 — ผ่อนผัน 7 วันหลังผูก LINE (สัญญานำเข้าจากระบบเดิม)', () => {
  it('A2 แจ้งค้างชำระ T+1: นำเข้า+ผูก 3 วัน → ไม่ส่ง (แถว BLOCKED) · ผูก 8 วัน / ครบ 7 วันพอดี / ไม่ได้นำเข้า → ส่งตามเดิม', async () => {
    const t = await trio(-1);

    await notifications.sendOverdueNotices();

    expect(lineDeliveries(t.legacy3.lineUserId)).toBe(0);
    expect(await graceBlocks(t.legacy3.paymentId)).toBe(1);
    expect(lineDeliveries(t.legacy8.lineUserId)).toBe(1);
    expect(lineDeliveries(t.legacy7.lineUserId)).toBe(1);
    expect(lineDeliveries(t.native3.lineUserId)).toBe(1);
    // ไม่ส่ง SMS แทนระหว่างผ่อนผัน
    expect(delivered.filter((d) => d.via === 'sms')).toHaveLength(0);
  });

  it('รอบ 2 ข้อ 5 — สั่งรัน A2 / บอททวง / A3 ซ้ำในวันเดียว → แถว BLOCKED ต่อข้อความไม่ซ้ำ', async () => {
    const t = await trio(-1);

    await notifications.sendOverdueNotices();
    await notifications.sendOverdueNotices();
    await bot.runDailyEscalations();
    await bot.runDailyEscalations();
    await collections.notifyStatusChangedCustomers([t.legacy3.contractId]);
    await collections.notifyStatusChangedCustomers([t.legacy3.contractId]);

    const rows = await prisma.notificationLog.findMany({
      where: {
        relatedId: { in: [t.legacy3.paymentId, t.legacy3.contractId] },
        blockReason: 'LEGACY_LINK_GRACE',
      },
      select: { subject: true },
    });
    // A2 หนึ่งแถว · บอทหนึ่งแถว · A3 หนึ่งแถว
    expect(rows.map((r) => r.subject).sort()).toEqual(
      ['AutoTrigger ESCALATION_T_PLUS_1', 'แจ้งค้างชำระ', 'แจ้งสถานะสัญญาค้างชำระ'].sort(),
    );
    expect(lineDeliveries(t.legacy3.lineUserId)).toBe(0);
  });

  it('A8 บอททวง T+1: นำเข้า+ผูก 3 วัน → ไม่ส่ง ไม่จองแถว · อื่น ๆ ส่งตามเดิม', async () => {
    const t = await trio(-1);

    await bot.runDailyEscalations();

    expect(lineDeliveries(t.legacy3.lineUserId)).toBe(0);
    expect(
      await prisma.chatAutoTrigger.count({ where: { customerId: t.legacy3.customerId } }),
    ).toBe(0);
    expect(await graceBlocks(t.legacy3.paymentId)).toBe(1);
    expect(lineDeliveries(t.legacy8.lineUserId)).toBe(1);
    expect(lineDeliveries(t.native3.lineUserId)).toBe(1);
  });

  it('A3 แจ้งสถานะสัญญา (ACTIVE→OVERDUE): นำเข้า+ผูก 3 วัน → ไม่ส่ง · อื่น ๆ ส่งตามเดิม', async () => {
    const t = await trio(-10);
    const all = [t.legacy3, t.legacy8, t.native3];

    await collections.notifyStatusChangedCustomers(all.map((f) => f.contractId));

    expect(lineDeliveries(t.legacy3.lineUserId)).toBe(0);
    expect(await graceBlocks(t.legacy3.contractId)).toBe(1);
    expect(lineDeliveries(t.legacy8.lineUserId)).toBe(1);
    expect(lineDeliveries(t.native3.lineUserId)).toBe(1);
  });

  it('รอบ 3 M5 — แจ้งล็อกเครื่อง (mdm.lock_notice) ถึงลูกค้าแม้อยู่ในช่วงผ่อนผัน', async () => {
    const t = await trio(-30);

    const result = await notifications.sendFromTemplate(
      'mdm.lock_notice',
      { name: 'ทดสอบ', contractNumber: t.legacy3.contractNumber, daysOverdue: '30' },
      t.legacy3.lineUserId,
      { relatedId: t.legacy3.contractId, customerId: t.legacy3.customerId },
    );

    expect(result.status).toBe('SENT');
    expect(lineDeliveries(t.legacy3.lineUserId)).toBe(1);
    expect(await graceBlocks(t.legacy3.contractId)).toBe(0);
  });

  it('A4 ขั้นทวง dunning.* (template Flex): นำเข้า+ผูก 3 วัน → ไม่ส่ง · อื่น ๆ ส่งตามเดิม', async () => {
    const t = await trio(-10);
    const all = [t.legacy3, t.legacy8, t.native3];

    await collections.notifyEscalatedDunning({
      escalated: all.map((f) => ({
        contractId: f.contractId,
        contractNumber: f.contractNumber,
        daysOverdue: 10,
        to: 'REMINDER',
      })),
    });

    expect(lineDeliveries(t.legacy3.lineUserId)).toBe(0);
    expect(await graceBlocks(t.legacy3.contractId)).toBe(1);
    expect(lineDeliveries(t.legacy8.lineUserId)).toBe(1);
    expect(lineDeliveries(t.native3.lineUserId)).toBe(1);
  });

  it('กฎทวงตามเหตุการณ์ (ไม่รับสาย → LINE อัตโนมัติ): นำเข้า+ผูก 3 วัน → DunningAction SKIPPED ไม่ส่ง · อื่น ๆ SENT', async () => {
    const t = await trio(-10);
    // กฎของสเปคนี้ตัวเดียว: กฎ seed ที่ eventTrigger เดียวกันถูกพักไว้ระหว่างเคส · กฎของสเปคถูกลบทิ้งหลังเคส
    // (สเปค seed `collections-foundation.seed.spec.ts` นับกฎที่มี eventTrigger ทั้งตาราง)
    const rule = await prisma.dunningRule.create({
      data: {
        name: `${stamp} ไม่รับสาย`,
        eventTrigger: 'CALL_NO_ANSWER',
        channel: 'LINE',
        messageTemplate: '[BESTCHOICE FINANCE] เรียน {{customerName}} กรุณาติดต่อกลับ',
        includePaymentLink: true,
        autoExecute: true,
        isActive: true,
        sortOrder: 999,
      },
    });
    const seeded = await prisma.dunningRule.findMany({
      where: { eventTrigger: 'CALL_NO_ANSWER', isActive: true, id: { not: rule.id } },
      select: { id: true },
    });
    await prisma.dunningRule.updateMany({
      where: { id: { in: seeded.map((r) => r.id) } },
      data: { isActive: false },
    });
    let actions: { contractId: string; status: string; result: string | null }[] = [];
    try {
      for (const f of [t.legacy3, t.legacy8, t.native3]) {
        await engine.executeEventTrigger('CALL_NO_ANSWER', f.contractId, f.paymentId, null);
      }
      actions = await prisma.dunningAction.findMany({
        where: { dunningRuleId: rule.id },
        select: { contractId: true, status: true, result: true },
      });
    } finally {
      await prisma.dunningRule.updateMany({
        where: { id: { in: seeded.map((r) => r.id) } },
        data: { isActive: true },
      });
      await prisma.dunningAction.deleteMany({ where: { dunningRuleId: rule.id } });
      await prisma.dunningRule.delete({ where: { id: rule.id } });
    }

    const action = (contractId: string) => actions.find((a) => a.contractId === contractId);
    expect(action(t.legacy3.contractId)).toEqual({
      contractId: t.legacy3.contractId,
      status: 'SKIPPED',
      result: expect.stringMatching(/^LEGACY_LINK_GRACE notificationId:/),
    });
    expect(action(t.legacy8.contractId)?.status).toBe('SENT');
    expect(action(t.native3.contractId)?.status).toBe('SENT');
    expect(lineDeliveries(t.legacy3.lineUserId)).toBe(0);
    expect(lineDeliveries(t.legacy8.lineUserId)).toBe(1);
    expect(lineDeliveries(t.native3.lineUserId)).toBe(1);
  });

  it('รอบ 2 ข้อ 2 — พนักงานกด "ส่ง LINE" จากคิวทวงถาม → ส่งถึงแม้อยู่ในช่วงผ่อนผัน · ข้อความทวงที่ระบบส่งเองยังถูกระงับ · SMS ไม่เปลี่ยน', async () => {
    const t = await trio(-10);
    const owner = { id: base.salespersonId, role: 'OWNER' as const, branchId: null };

    await expect(
      collectionsQueue.sendLineAdhoc(
        t.legacy3.contractId,
        { customMessage: '[BESTCHOICE FINANCE] กรุณาชำระค่างวดที่ค้าง' },
        owner,
      ),
    ).resolves.toEqual({ sent: 1, failed: 0, total: 1 });
    expect(lineDeliveries(t.legacy3.lineUserId)).toBe(1);
    expect(
      await prisma.notificationLog.count({
        where: { relatedId: t.legacy3.contractId, status: 'SENT', channel: 'LINE' },
      }),
    ).toBe(1);

    const automated = (f: InstallmentFixture, channel: 'LINE' | 'SMS') =>
      notifications.send({
        channel,
        channelKey: channel === 'LINE' ? 'line-finance' : undefined,
        recipient: channel === 'LINE' ? f.lineUserId : `sms-${f.lineUserId}`,
        message: '[BESTCHOICE FINANCE] แจ้งค้างชำระ',
        relatedId: f.contractId,
        customerId: f.customerId,
        category: NotificationCategory.DUNNING,
      });
    expect(await automated(t.legacy8, 'LINE')).toMatchObject({ status: 'SENT' });
    // สัญญาเดียวกับที่พนักงานเพิ่งส่ง — ระบบส่งเองถูกระงับ (ก่อนเพดานความถี่ ⇒ เหตุผลคือช่วงผ่อนผัน)
    expect(await automated(t.legacy3, 'LINE')).toMatchObject({
      status: 'BLOCKED',
      blockReason: 'LEGACY_LINK_GRACE',
    });
    expect((await automated(t.native3, 'SMS')).status).toBe('SENT');
    expect(delivered).toContainEqual({ to: `sms-${t.native3.lineUserId}`, via: 'sms' });
    expect(lineDeliveries(t.legacy3.lineUserId)).toBe(1);
  });

  it('ลูกค้าคนเดียวมีสัญญานำเข้า + สัญญาใหม่ (ผูก 3 วัน) → ระงับเฉพาะสัญญานำเข้า', async () => {
    const legacy = await createInstallmentFixture(prisma, base, {
      label: `mixed-legacy-${++seq}`,
      dueDate: dueDateBkk(day, -1),
      linkedAt: new Date(NOW.getTime() - 3 * DAY_MS),
      legacyCode: `${stamp}-LG-${seq}`,
    });
    const native = await createInstallmentFixture(prisma, base, {
      label: `mixed-native-${++seq}`,
      dueDate: dueDateBkk(day, -1),
      customer: { customerId: legacy.customerId, lineUserId: legacy.lineUserId },
    });
    fixtures.push(legacy, native);

    await notifications.sendOverdueNotices();

    expect(await graceBlocks(legacy.paymentId)).toBe(1);
    expect(
      await prisma.notificationLog.count({
        where: { relatedId: native.paymentId, status: 'SENT', channel: 'LINE' },
      }),
    ).toBe(1);
    expect(lineDeliveries(legacy.lineUserId)).toBe(1);
  });

  it('เตือนค่างวดยังส่งระหว่างผ่อนผัน (T-1: A1 08:00 · บอท 09:00 ข้ามตามกติกาหนึ่งข้อความต่อวัน)', async () => {
    const legacy3 = await createInstallmentFixture(prisma, base, {
      label: `reminder-${++seq}`,
      dueDate: dueDateBkk(day, 1),
      linkedAt: new Date(NOW.getTime() - 3 * DAY_MS),
      legacyCode: `${stamp}-LG-${seq}`,
    });
    fixtures.push(legacy3);

    jest.setSystemTime(bangkokAt(day, 0, 8));
    await notifications.sendPaymentReminders();
    jest.setSystemTime(bangkokAt(day, 0, 9));
    await bot.runDailyReminders();

    expect(delivered.filter((d) => d.to === legacy3.lineUserId)).toEqual([
      { to: legacy3.lineUserId, via: 'flex' },
    ]);
    expect(await graceBlocks(legacy3.paymentId)).toBe(0);
  });
});

describe('Task 30 รอบ 2 ข้อ 4 — ช่วงผ่อนผันนับจากการผูก LINE การเงินครั้งแรกของลูกค้า', () => {
  /** สัญญานำเข้าค้างชำระ T+1 ของลูกค้าที่มีเบอร์ (ยังไม่ผูก — ผูกด้วย OTP จริงในเคส) */
  async function legacyCustomer(label: string) {
    const phone = `08${String(Date.now() + ++seq).slice(-8)}`;
    const f = await createInstallmentFixture(prisma, base, {
      label: `${label}-${++seq}`,
      dueDate: dueDateBkk(day, -1),
      linkedAt: null,
      legacyCode: `${stamp}-LG-${seq}`,
      phone,
    });
    fixtures.push(f);
    return { f, phone };
  }
  const backdateFirstLink = (customerId: string, daysAgo: number) => {
    const at = new Date(NOW.getTime() - daysAgo * DAY_MS);
    return prisma.customerLineLink.updateMany({
      where: { customerId },
      data: { linkedAt: at, createdAt: at },
    });
  };
  const linkRow = (customerId: string) =>
    prisma.customerLineLink.findFirstOrThrow({
      where: { customerId },
      select: { linkedAt: true, unlinkedAt: true },
    });

  it('ผูกครั้งแรก 10 วันก่อน → ยกเลิกผูก → ผูกใหม่ด้วย OTP (linkedAt ใหม่) → ไม่อยู่ในช่วง: A2 แจ้งค้างชำระตามเดิม', async () => {
    jest.useRealTimers(); // ทาง OTP เทียบเวลาหมดอายุกับนาฬิกาฐานข้อมูล
    const { f, phone } = await legacyCustomer('relinked');
    await verifyWithOtp(f.lineUserId, phone);
    await backdateFirstLink(f.customerId, 10);
    await expect(liff.unlinkLineAccount(f.lineUserId)).resolves.toEqual({ success: true });
    expect((await linkRow(f.customerId)).unlinkedAt).not.toBeNull();
    await verifyWithOtp(f.lineUserId, phone);
    const relinked = await linkRow(f.customerId);
    expect(relinked.unlinkedAt).toBeNull();
    // ผูกใหม่ตั้ง linkedAt เป็นตอนนี้ — นับจากแถวปัจจุบันจะได้ช่วงผ่อนผันใหม่
    expect(relinked.linkedAt.getTime()).toBeGreaterThan(NOW.getTime() - DAY_MS);

    useFakeDate(NOW);
    await notifications.sendOverdueNotices();

    expect(await graceBlocks(f.paymentId)).toBe(0);
    expect(lineDeliveries(f.lineUserId)).toBe(1);
  });

  it('ยืนยัน OTP ซ้ำกับลูกค้าเดิม (ผูกครั้งแรก 8 วันก่อน) → ไม่เริ่มนับใหม่: ทวงตามเดิม', async () => {
    jest.useRealTimers();
    const { f, phone } = await legacyCustomer('reverified');
    await verifyWithOtp(f.lineUserId, phone);
    await backdateFirstLink(f.customerId, 8);
    await verifyWithOtp(f.lineUserId, phone);
    expect((await linkRow(f.customerId)).linkedAt.getTime()).toBeGreaterThan(
      NOW.getTime() - DAY_MS,
    );

    useFakeDate(NOW);
    await bot.runDailyEscalations();

    expect(await graceBlocks(f.paymentId)).toBe(0);
    expect(lineDeliveries(f.lineUserId)).toBe(1);
  });

  it('ผูกครั้งแรก 3 วันก่อน แล้วยืนยัน OTP ซ้ำวันนี้ → ยังอยู่ในช่วง (นับจากครั้งแรก)', async () => {
    jest.useRealTimers();
    const { f, phone } = await legacyCustomer('fresh');
    await verifyWithOtp(f.lineUserId, phone);
    await backdateFirstLink(f.customerId, 3);
    await verifyWithOtp(f.lineUserId, phone);

    useFakeDate(NOW);
    await notifications.sendOverdueNotices();

    expect(await graceBlocks(f.paymentId)).toBe(1);
    expect(lineDeliveries(f.lineUserId)).toBe(0);
  });
});
