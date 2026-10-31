/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/notifications/collections-overnight-notices.db.spec.ts --runInBand
 *
 * Task 30 รอบ 3 — ข้อความทวงจากรอบกลางคืน (A3 แจ้งสถานะ 00:30 · A4 ขั้นทวง 01:00) ส่งตอนเช้าในเวลาทำการ:
 * `CollectionsNotifierService.sendOvernightCollectionsNotices` อ่านผลของคืนนั้นจาก AuditLog ของรอบระบบ บน Postgres จริง ·
 * รอบ 4 m1 — แจ้งล็อกเครื่องของล็อกอัตโนมัติ (`MdmAutoService` 01:30) ส่งในรอบเดียวกัน
 */
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { ComplianceService } from './compliance.service';
import { HolidayService } from './holiday.service';
import { NotificationTemplateService } from './notification-template.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { CollectionsNotifierService } from './services/collections-notifier.service';
import { MdmAutoService } from '../mdm/mdm-auto.service';
import {
  FinanceFixtureBase,
  InstallmentFixture,
  assertTestDatabase,
  bangkokAt,
  createFinanceFixtureBase,
  createInstallmentFixture,
  dec,
  dueDateBkk,
  realBangkokDate,
  retireFixtures,
  useFakeDate,
} from './__tests__/finance-line-fixtures';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const stamp = `t30d-${Date.now()}`;
const day = realBangkokDate();
let base: FinanceFixtureBase;
let collections: CollectionsNotifierService;
let compliance: ComplianceService;
const fixtures: InstallmentFixture[] = [];
const delivered: { to: string; via: string }[] = [];
const sink = (via: string) => async (to: string) => {
  delivered.push({ to, via });
};
const receivedBy = (f: InstallmentFixture) =>
  delivered.filter((d) => d.to === f.lineUserId).map((d) => d.via);
/** แม่แบบที่ `sendFromTemplate` กำลังส่ง (ขั้นทวง / แจ้งล็อก) — ทาง Flex ของแม่แบบใช้ transport ตัวเดียวกัน */
let templateInFlight: string | null = null;

async function overdueContract(label: string) {
  const f = await createInstallmentFixture(prisma, base, {
    label,
    dueDate: dueDateBkk(day, -10),
    paymentStatus: 'OVERDUE',
    contractStatus: 'OVERDUE',
  });
  fixtures.push(f);
  return f;
}
/** แถว audit แบบที่รอบกลางคืนเขียน (`overdue-lifecycle-cron.service.ts`) */
const nightAudit = (f: InstallmentFixture, action: string, newValue: object) =>
  prisma.auditLog.create({
    data: {
      userId: base.salespersonId,
      action,
      entity: 'contract',
      entityId: f.contractId,
      newValue,
      ipAddress: 'system-cron',
    },
  });

beforeAll(async () => {
  assertTestDatabase();
  base = await createFinanceFixtureBase(prisma, stamp);
  compliance = new ComplianceService(
    prisma as never,
    new PDPAService(prisma as never),
    new HolidayService(),
  );
  const notifications = new NotificationsService(
    prisma as never,
    { get: jest.fn() } as never,
    {} as never,
    {} as never,
    { getValue: jest.fn().mockResolvedValue('') } as never,
    compliance,
    new NotificationTemplateService(prisma as never),
  );
  jest
    .spyOn(notifications.transport, 'sendLineFlexMessage')
    .mockImplementation(async (to: string) =>
      sink(templateInFlight ? `tpl:${templateInFlight}` : 'flex')(to),
    );
  jest.spyOn(notifications.transport, 'sendLine').mockImplementation(sink('text'));
  const sendFromTemplate = notifications.sendFromTemplate.bind(notifications);
  jest.spyOn(notifications, 'sendFromTemplate').mockImplementation(async (eventType, ...rest) => {
    templateInFlight = eventType;
    try {
      return await sendFromTemplate(eventType, ...rest);
    } finally {
      templateInFlight = null;
    }
  });
  collections = new CollectionsNotifierService(
    prisma as never,
    { sendFlexMessage: jest.fn(sink('statusFlex')) } as never,
    new PDPAService(prisma as never),
    notifications,
    {} as never,
  );
});

afterEach(() => jest.useRealTimers());

afterAll(async () => {
  await retireFixtures(prisma, fixtures);
  await prisma.$disconnect();
});

it('รอบกลางคืน → ไม่มีอะไรส่งตอนดึก · 08:05 ส่งข้อความเดียวต่อสัญญา · สั่งรันซ้ำไม่ส่งซ้ำ · จ่ายแล้วระหว่างคืนไม่แจ้ง', async () => {
  const flipped = await overdueContract('flipped');
  const escalated = await overdueContract('escalated');
  const both = await overdueContract('both');
  const paidOvernight = await overdueContract('paid');
  const paidEscalated = await overdueContract('paidEsc');
  await nightAudit(flipped, 'STATUS_CHANGE', { from: 'ACTIVE', to: 'OVERDUE', reason: 'x' });
  await nightAudit(escalated, 'DUNNING_ESCALATION', { dunningStage: 'REMINDER', daysOverdue: 10 });
  await nightAudit(both, 'STATUS_CHANGE', { from: 'ACTIVE', to: 'OVERDUE', reason: 'x' });
  await nightAudit(both, 'DUNNING_ESCALATION', { dunningStage: 'REMINDER', daysOverdue: 10 });
  await nightAudit(paidOvernight, 'STATUS_CHANGE', { from: 'ACTIVE', to: 'OVERDUE', reason: 'x' });
  await nightAudit(paidEscalated, 'DUNNING_ESCALATION', {
    dunningStage: 'REMINDER',
    daysOverdue: 10,
  });
  // จ่ายระหว่างคืนแบบที่ระบบทำจริง: งวดเป็น PAID แต่สัญญายังเป็น OVERDUE (ไม่มีทางไหนคืนสถานะสัญญาเป็น ACTIVE —
  // `overdue-lifecycle-cron.service.ts` เปลี่ยนได้ทางเดียว · รีวิวรอบ 3 I1: เดิมสเปคจำลองด้วยสถานะ ACTIVE ที่ไม่มีบนข้อมูลจริง)
  await prisma.payment.update({
    where: { id: paidOvernight.paymentId },
    data: { status: 'PAID', amountPaid: dec('1515.83'), paidDate: new Date() },
  });
  await prisma.payment.update({
    where: { id: paidEscalated.paymentId },
    data: { status: 'PAID', amountPaid: dec('1515.83'), paidDate: new Date() },
  });

  // เรียกตอนดึก (สั่งรันมือ) — นอกเวลาทำการ ไม่ส่ง
  useFakeDate(bangkokAt(day, 0, 1));
  await expect(collections.sendOvernightCollectionsNotices()).resolves.toEqual({
    statusNotices: 0,
    dunningNotices: 0,
    lockNotices: 0,
  });
  expect(delivered.filter((d) => fixtures.some((f) => f.lineUserId === d.to))).toEqual([]);

  // 08:05
  jest.setSystemTime(bangkokAt(day, 0, 8, 5));
  await collections.sendOvernightCollectionsNotices();
  expect(receivedBy(flipped)).toEqual(['statusFlex']);
  expect(receivedBy(escalated)).toEqual(['tpl:dunning.reminder']);
  expect(receivedBy(both)).toEqual(['statusFlex']); // หนึ่งข้อความทวงต่อสัญญา
  expect(receivedBy(paidOvernight)).toEqual([]);
  expect(receivedBy(paidEscalated)).toEqual([]);

  // รอบ 4 m4 — เพดานความถี่ DUNNING วันละครั้งของ `ComplianceService` (พนักงานกดส่ง · กฎ CALL_NO_ANSWER / DEVICE_LOCKED) เท่าก่อนย้ายเวลา:
  // เดิมแจ้งสถานะ (00:30) ไม่ลงแถว ⇒ ไม่นับ · ขั้นทวง (01:00) ลงแถว ⇒ นับ · แจ้งสถานะที่ส่ง**แทน**ขั้นทวง = นับเหมือนแถวขั้นทวงที่มันแทน
  const capOf = (f: InstallmentFixture) =>
    compliance.canSend({
      channel: 'LINE',
      customerId: f.customerId,
      contractId: f.contractId,
      category: 'DUNNING',
    });
  expect(await capOf(flipped)).toEqual({ allowed: true });
  expect(await capOf(escalated)).toMatchObject({ allowed: false, reason: 'FREQUENCY_CAP' });
  expect(await capOf(both)).toMatchObject({ allowed: false, reason: 'FREQUENCY_CAP' });

  // สั่งรันซ้ำ
  jest.setSystemTime(bangkokAt(day, 0, 9, 30));
  await collections.sendOvernightCollectionsNotices();
  expect(receivedBy(flipped)).toEqual(['statusFlex']);
  expect(receivedBy(escalated)).toEqual(['tpl:dunning.reminder']);
  expect(receivedBy(both)).toEqual(['statusFlex']);
}, 60_000);

/**
 * รอบล็อกอัตโนมัติ (`MdmAutoService.autoLockOverdueContracts`) ตัวจริงบน Postgres — เลือกเฉพาะสัญญาของสเปคนี้ (ฐานทดสอบมีสัญญาค้างของสเปคอื่น ·
 * รอบล็อกเว้น 1 วินาทีระหว่างเครื่อง) · ส่วนอื่นเป็นของจริงทั้งหมด
 */
function scopedLockPrisma(contractIds: string[]) {
  return {
    contract: {
      findMany: (args: { where: object }) =>
        prisma.contract.findMany({
          ...(args as object),
          where: { ...args.where, id: { in: contractIds } },
        } as never),
      update: (args: unknown) => prisma.contract.update(args as never),
    },
    auditLog: { create: (args: unknown) => prisma.auditLog.create(args as never) },
    user: prisma.user,
    $transaction: (ops: never) => prisma.$transaction(ops),
  };
}

it('รอบ 4 m1 — ล็อกอัตโนมัติ 01:30 ไม่แจ้งตอนดึก · 08:05 แจ้งเครื่องที่ยังล็อก · ปลดก่อนเช้าไม่แจ้ง · ลูกค้านำเข้าช่วงผ่อนผันยังได้ · สั่งรันซ้ำไม่ส่งซ้ำ', async () => {
  const lockCandidate = async (label: string, extra: object = {}) => {
    const f = await createInstallmentFixture(prisma, base, {
      label,
      dueDate: dueDateBkk(day, -31),
      paymentStatus: 'OVERDUE',
      contractStatus: 'OVERDUE',
      ...extra,
    });
    fixtures.push(f);
    return f;
  };
  const locked = await lockCandidate('lock');
  const unlockedBeforeMorning = await lockCandidate('unlock');
  const legacyInGrace = await lockCandidate('lockGrace', { legacyCode: `LEG-${stamp}` });
  const lockedAndDefault = await lockCandidate('lockDefault');
  await nightAudit(lockedAndDefault, 'STATUS_CHANGE', {
    from: 'OVERDUE',
    to: 'DEFAULT',
    reason: 'x',
  });
  const mine = [locked, unlockedBeforeMorning, legacyInGrace, lockedAndDefault];

  // 01:30 รอบล็อก — ล็อกครบ ไม่มีข้อความ
  useFakeDate(bangkokAt(day, 0, 1, 30));
  const mdmAuto = new MdmAutoService(
    scopedLockPrisma(mine.map((f) => f.contractId)) as never,
    { lockDeviceByImei: jest.fn(async () => ({ success: true })) } as never,
    {} as never,
  );
  jest.spyOn(mdmAuto, 'getSettings').mockResolvedValue({
    autoLockEnabled: true,
    autoLockDays: 30,
    autoUnlockEnabled: false,
    notifyLine: true,
  });
  await expect(mdmAuto.autoLockOverdueContracts()).resolves.toEqual({
    locked: 4,
    skipped: 0,
    failed: 0,
  });
  expect(mine.flatMap(receivedBy)).toEqual([]);

  // พนักงานปลดล็อกก่อนรอบเช้า (สิ่งที่ `MdmService.unlockContract` เขียน)
  await prisma.contract.update({
    where: { id: unlockedBeforeMorning.contractId },
    data: { mdmLockedAt: null, deviceLocked: false },
  });

  // 08:05
  jest.setSystemTime(bangkokAt(day, 0, 8, 5));
  const morning = await collections.sendOvernightCollectionsNotices();
  expect(morning.lockNotices).toBe(3);
  expect(receivedBy(locked)).toEqual(['tpl:mdm.lock_notice']);
  expect(receivedBy(unlockedBeforeMorning)).toEqual([]);
  expect(receivedBy(legacyInGrace)).toEqual(['tpl:mdm.lock_notice']); // ยกเว้นช่วงผ่อนผัน (รอบ 3 M5)
  // ล็อกคืนเดียวกับเปลี่ยนเป็น DEFAULT: แจ้งสถานะ + แจ้งล็อก (เหมือนก่อนย้ายเวลา — คำถามเจ้าของ)
  expect(receivedBy(lockedAndDefault)).toEqual(['statusFlex', 'tpl:mdm.lock_notice']);

  // สั่งรันซ้ำ
  jest.setSystemTime(bangkokAt(day, 0, 9, 30));
  await expect(collections.sendOvernightCollectionsNotices()).resolves.toMatchObject({
    lockNotices: 0,
  });
  expect(receivedBy(locked)).toEqual(['tpl:mdm.lock_notice']);
  expect(receivedBy(lockedAndDefault)).toEqual(['statusFlex', 'tpl:mdm.lock_notice']);
}, 60_000);
