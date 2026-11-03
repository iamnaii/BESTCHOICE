/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/notifications/collections-overnight-notices.db.spec.ts --runInBand
 *
 * Task 30 รอบ 3 — ข้อความทวงจากรอบกลางคืน (A3 แจ้งสถานะ 00:30 · A4 ขั้นทวง 01:00) ส่งตอนเช้าในเวลาทำการ:
 * `CollectionsNotifierService.sendOvernightCollectionsNotices` อ่านผลของคืนนั้นจาก AuditLog ของรอบระบบ บน Postgres จริง
 */
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { ComplianceService } from './compliance.service';
import { HolidayService } from './holiday.service';
import { NotificationTemplateService } from './notification-template.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { CollectionsNotifierService } from './services/collections-notifier.service';
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
let notifications: NotificationsService;
const fixtures: InstallmentFixture[] = [];
const delivered: { to: string; via: string }[] = [];
const sink = (via: string) => async (to: string) => {
  delivered.push({ to, via });
};
const receivedBy = (f: InstallmentFixture) =>
  delivered.filter((d) => d.to === f.lineUserId).map((d) => d.via);

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
  notifications = new NotificationsService(
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
    .mockImplementation(sink('dunningFlex'));
  jest.spyOn(notifications.transport, 'sendLine').mockImplementation(sink('text'));
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
  });
  expect(delivered.filter((d) => fixtures.some((f) => f.lineUserId === d.to))).toEqual([]);

  // 08:05
  jest.setSystemTime(bangkokAt(day, 0, 8, 5));
  await collections.sendOvernightCollectionsNotices();
  expect(receivedBy(flipped)).toEqual(['statusFlex']);
  expect(receivedBy(escalated)).toEqual(['dunningFlex']);
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
  expect(receivedBy(escalated)).toEqual(['dunningFlex']);
  expect(receivedBy(both)).toEqual(['statusFlex']);
}, 60_000);

it('รอบ 5 — แจ้งล็อก 01:30 (ไม่แตะ MDM) เป็นข้อความทวงของสัญญาวันนั้น: คืนเดียวกับเปลี่ยนเป็น DEFAULT → 08:05 ไม่แจ้งสถานะซ้ำ', async () => {
  const f = await overdueContract('lockNight');
  await nightAudit(f, 'STATUS_CHANGE', { from: 'OVERDUE', to: 'DEFAULT', reason: 'x' });
  // 01:30 — การเรียกเดียวกับที่ `MdmAutoService.notifyCustomerLock` ทำหลังล็อกสำเร็จ (ทาง Flex ของแม่แบบ — ลงแถว SENT หมวด DUNNING ของสัญญา)
  useFakeDate(bangkokAt(day, 0, 1, 30));
  await notifications.sendFromTemplate(
    'mdm.lock_notice',
    { name: 'ทดสอบ', contractNumber: f.contractNumber, daysOverdue: '30' },
    f.lineUserId,
    { relatedId: f.contractId, customerId: f.customerId },
  );

  jest.setSystemTime(bangkokAt(day, 0, 8, 5));
  await collections.sendOvernightCollectionsNotices();

  // วันละข้อความทวงต่อสัญญา: แจ้งล็อกตอนดึกคือข้อความของวันนั้น · แจ้งสถานะ 08:05 ถูกข้าม (คำถามเจ้าของรอบ 5)
  expect(receivedBy(f)).toEqual(['dunningFlex']);
}, 60_000);
