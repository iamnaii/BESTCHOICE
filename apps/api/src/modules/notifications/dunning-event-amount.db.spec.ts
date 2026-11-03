/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/notifications/dunning-event-amount.db.spec.ts --runInBand
 *
 * Task 30 รอบ 7 I4 (ผู้คุมงานเลือกทาง ก) — ยอดในข้อความกฎทวงตามเหตุการณ์ (`DunningEngineService.executeEventTrigger`) บน Postgres จริง
 * กับแม่แบบที่ seed ไว้ในฐาน · สถานการณ์ของผู้รีวิวรอบ 6: งวด 1 จ่ายบางส่วน 1,000 จาก 1,515.83 + ค่าปรับ 100 · งวด 2 ค้างเต็ม + ค่าปรับ 100
 * ⇒ ยอดค้างที่ถึงกำหนดรวม 2,231.66 · งวด 1 เหลือค้าง 615.83 — รอบ 6 (m7) ใส่ค่างวดเต็ม 1,515.83 ให้ทุกกฎ
 */
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { ComplianceService } from './compliance.service';
import { HolidayService } from './holiday.service';
import { NotificationTemplateService } from './notification-template.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { DunningEngineService } from '../overdue/dunning-engine.service';
import { DunningRuleResolverService } from '../overdue/dunning-rule-resolver.service';
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
const stamp = `t30e-${Date.now()}`;
const day = realBangkokDate();
let base: FinanceFixtureBase;
let engine: DunningEngineService;
const createPaymentLink = jest.fn(
  async (_contractId: string, installmentNo?: number, overrideAmount?: number) => ({
    url: `https://pay.test/${installmentNo ?? 'all'}/${overrideAmount ?? 'default'}`,
    token: 't',
    amount: overrideAmount ?? 0,
    expiresAt: new Date(),
  }),
);
const fixtures: InstallmentFixture[] = [];
const delivered: { to: string; text: string }[] = [];
const messageTo = (f: InstallmentFixture) =>
  delivered
    .filter((d) => d.to === f.lineUserId)
    .map((d) => d.text)
    .join('\n');
const linkCallsFor = (f: InstallmentFixture) =>
  createPaymentLink.mock.calls.filter(([contractId]) => contractId === f.contractId);

/** สัญญา DEFAULT: งวด 1 จ่ายบางส่วน 1,000 + ค่าปรับ 100 · งวด 2 ค้างเต็ม + ค่าปรับ 100 · งวด 3 ยังไม่ครบกำหนด */
async function partlyPaidContract(label: string, opts: { firstFeeWaived?: boolean } = {}) {
  const f = await createInstallmentFixture(prisma, base, {
    label,
    dueDate: dueDateBkk(day, -40),
    paymentStatus: 'PARTIALLY_PAID',
    contractStatus: 'DEFAULT',
    lateFee: '100.00',
  });
  await prisma.payment.update({
    where: { id: f.paymentId },
    data: { amountPaid: dec('1000.00'), lateFeeWaived: opts.firstFeeWaived ?? false },
  });
  for (const [installmentNo, dueOffset, lateFee, status] of [
    [2, -10, '100.00', 'OVERDUE'],
    [3, 20, '0.00', 'PENDING'],
  ] as const) {
    const p = await prisma.payment.create({
      data: {
        contractId: f.contractId,
        installmentNo,
        dueDate: dueDateBkk(day, dueOffset),
        amountDue: dec('1515.83'),
        lateFee: dec(lateFee),
        status,
      },
    });
    fixtures.push({ ...f, paymentId: p.id });
  }
  fixtures.push(f);
  return f;
}

beforeAll(async () => {
  assertTestDatabase();
  base = await createFinanceFixtureBase(prisma, stamp);
  const notifications = new NotificationsService(
    prisma as never,
    { get: jest.fn() } as never,
    {} as never,
    {} as never,
    { getValue: jest.fn().mockResolvedValue('') } as never,
    new ComplianceService(prisma as never, new PDPAService(prisma as never), new HolidayService()),
    new NotificationTemplateService(prisma as never),
  );
  jest.spyOn(notifications.transport, 'sendLine').mockImplementation((async (
    to: string,
    text: string,
  ) => {
    delivered.push({ to, text });
  }) as never);
  engine = new DunningEngineService(
    prisma as never,
    {} as never,
    notifications,
    { createPaymentLink } as never,
    new DunningRuleResolverService(prisma as never),
  );
});

beforeEach(() => useFakeDate(bangkokAt(day, 0, 10, 0)));
afterEach(() => jest.useRealTimers());

afterAll(async () => {
  await retireFixtures(prisma, fixtures);
  await prisma.$disconnect();
});

it('แจ้งล็อก (DEVICE_LOCKED "ชำระยอดค้าง … เพื่อปลดล็อค") = ยอดค้างที่ถึงกำหนดรวมของสัญญา · ลิงก์ชำระครอบยอดนั้น', async () => {
  const f = await partlyPaidContract('locked');

  await engine.executeEventTrigger('DEVICE_LOCKED', f.contractId, null, null);

  // 515.83 + 100 + 1,515.83 + 100 — งวด 3 ยังไม่ครบกำหนดไม่นับ
  expect(messageTo(f)).toContain('ชำระยอดค้าง 2,231.66 ฿');
  // ลิงก์ไม่ผูกงวดเดียว · ยอดของลิงก์ = ยอดในข้อความ (ทางรับเงินกระจายเข้างวดค้างตามลำดับ)
  expect(linkCallsFor(f)).toEqual([[f.contractId, undefined, 2231.66]]);
}, 60_000);

it('แจ้งล็อก — ค่าปรับที่ยกเว้นแล้วไม่นับ', async () => {
  const f = await partlyPaidContract('lockedWaived', { firstFeeWaived: true });

  await engine.executeEventTrigger('DEVICE_LOCKED', f.contractId, null, null);

  expect(messageTo(f)).toContain('ชำระยอดค้าง 2,131.66 ฿');
}, 60_000);

it('ไม่รับสาย (CALL_NO_ANSWER "ชำระงวดที่ … ยอด …") = ยอดคงค้างของงวดนั้น (ค่างวด − ที่จ่าย + ค่าปรับ) · ลิงก์ของงวดนั้นยอดเดียวกัน', async () => {
  const f = await partlyPaidContract('noAnswer');

  await engine.executeEventTrigger('CALL_NO_ANSWER', f.contractId, null, null);

  expect(messageTo(f)).toContain('ชำระงวดที่ 1 ยอด 615.83 ฿');
  expect(linkCallsFor(f)).toEqual([[f.contractId, 1, 615.83]]);
}, 60_000);

it('นัดชำระ (CALL_ANSWERED_PROMISE "ชำระยอด … ภายใน …") = ยอดและวันที่ลูกค้านัด จากผู้เรียก · ลิงก์ครอบยอดนัด', async () => {
  const f = await partlyPaidContract('promise');

  await engine.executeEventTrigger('CALL_ANSWERED_PROMISE', f.contractId, null, 'promise-1', {
    amount: 1500,
    settlementDate: '5 พ.ย. 69',
  });

  expect(messageTo(f)).toContain('ชำระยอด 1,500 ฿ ภายใน 5 พ.ย. 69');
  expect(messageTo(f)).not.toContain('{{');
  expect(linkCallsFor(f)).toEqual([[f.contractId, undefined, 1500]]);
}, 60_000);
