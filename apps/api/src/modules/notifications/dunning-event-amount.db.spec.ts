/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/notifications/dunning-event-amount.db.spec.ts --runInBand
 *
 * Task 30 รอบ 7 I4 (ผู้คุมงานเลือกทาง ก) — ยอดในข้อความกฎทวงตามเหตุการณ์ (`DunningEngineService.executeEventTrigger`) บน Postgres จริง
 * กับแม่แบบที่ seed ไว้ในฐาน · สถานการณ์ของผู้รีวิวรอบ 6: งวด 1 จ่ายบางส่วน 1,000 จาก 1,515.83 + ค่าปรับ 100 · งวด 2 ค้างเต็ม + ค่าปรับ 100
 * ⇒ ยอดค้างที่ถึงกำหนดรวม 2,231.66 · งวด 1 เหลือค้าง 615.83 — รอบ 6 (m7) ใส่ค่างวดเต็ม 1,515.83 ให้ทุกกฎ
 *
 * รอบ 8 I5 (ผู้คุมงานเลือกทาง ข) — ลิงก์ชำระในข้อความต้อง**จ่ายได้จริง**จากหน้า `/pay/:token`: ใช้ `PaymentLinkService` + `PaySolutionsIntentService`
 * ตัวจริง และส่งค่าแบบที่หน้าเว็บ (`LiffPayment.tsx`) ส่ง · หน้าเว็บตัดสินว่าลิงก์ผูกงวดจาก**ยอด** แล้ว intent บังคับยอด = ยอดคงค้างของงวด ⇒ ลิงก์ที่ยอดไม่ใช่
 * ยอดคงค้างของงวดเดียว (แจ้งล็อก · นัดชำระ) จ่ายไม่ได้ ⇒ ไม่แนบลิงก์ (ข้อความยังบอกยอดที่ถูก)
 */
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { ComplianceService } from './compliance.service';
import { HolidayService } from './holiday.service';
import { NotificationTemplateService } from './notification-template.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { DunningEngineService } from '../overdue/dunning-engine.service';
import { DunningRuleResolverService } from '../overdue/dunning-rule-resolver.service';
import { PaymentLinkService } from '../line-oa/payment-links/payment-link.service';
import { PaySolutionsIntentService } from '../paysolutions/services/paysolutions-intent.service';
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
import { useSeededEventDunningRules } from './__tests__/event-dunning-rules';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const stamp = `t30e-${Date.now()}`;
const day = realBangkokDate();
let base: FinanceFixtureBase;
/** กฎทวงตามเหตุการณ์ของสเปค (ข้อความจาก seed) — CI ไม่ seed ฐาน */
let restoreEventRules: () => Promise<void> = async () => {};
let engine: DunningEngineService;
let intent: PaySolutionsIntentService;
const fixtures: InstallmentFixture[] = [];
const delivered: { to: string; text: string }[] = [];
const messageTo = (f: InstallmentFixture) =>
  delivered
    .filter((d) => d.to === f.lineUserId)
    .map((d) => d.text)
    .join('\n');
const linksOf = (f: InstallmentFixture) =>
  prisma.paymentLink.findMany({
    where: { contractId: f.contractId },
    include: { payment: { select: { installmentNo: true, amountDue: true, lateFee: true } } },
  });

/** สิ่งที่หน้า `/pay/:token` (`LiffPayment.tsx`) ส่งไป `POST /paysolutions/create-intent` — ส่งเลขงวดเมื่อยอดไม่เกินงวดที่ผูก + ค่าปรับ + 0.5 */
async function payLikePayPage(f: InstallmentFixture, link: Awaited<ReturnType<typeof linksOf>>[0]) {
  const amount = Number(link.amount);
  const p = link.payment!;
  const isMulti = amount > Number(p.amountDue) + Number(p.lateFee) + 0.5;
  // เลขอ้างอิงของ intent มาจาก Date.now() — ใช้นาฬิกาจริง (นาฬิกาปลอมคงที่ทำให้เลขชนกับรอบก่อนบนฐานเดียวกัน)
  jest.useRealTimers();
  return intent.createPaymentIntent(
    f.contractId,
    amount,
    'ทดสอบ',
    f.lineUserId,
    isMulti ? undefined : p.installmentNo,
  );
}

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
  restoreEventRules = await useSeededEventDunningRules(prisma, stamp, [
    'CALL_NO_ANSWER',
    'CALL_ANSWERED_PROMISE',
    'DEVICE_LOCKED',
  ]);
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
  const config = { get: (_key: string, fallback?: unknown) => fallback } as never;
  engine = new DunningEngineService(
    prisma as never,
    {} as never,
    notifications,
    new PaymentLinkService(config, prisma as never, {} as never, {} as never, {} as never),
    new DunningRuleResolverService(prisma as never),
  );
  intent = new PaySolutionsIntentService(
    // gateway — ถึงตรงนี้แปลว่าผ่านด่านยอดของ intent แล้ว
    {
      getMerchantId: jest.fn(async () => 'merchant'),
      getTerminalId: jest.fn(async () => 'terminal'),
      createUiPayment: jest.fn(async () => ({
        gatewayResponse: {},
        paymentUrl: 'https://gw.test/pay',
      })),
    } as never,
    prisma as never,
    {} as never,
    config,
  );
});

beforeEach(() => useFakeDate(bangkokAt(day, 0, 10, 0)));
afterEach(() => jest.useRealTimers());

afterAll(async () => {
  await retireFixtures(prisma, fixtures);
  await restoreEventRules();
  await prisma.$disconnect();
});

it('แจ้งล็อก (DEVICE_LOCKED "ชำระยอดค้าง … เพื่อปลดล็อค") = ยอดค้างที่ถึงกำหนดรวมของสัญญา · ไม่แนบลิงก์ (รอบ 8 I5)', async () => {
  const f = await partlyPaidContract('locked');

  await engine.executeEventTrigger('DEVICE_LOCKED', f.contractId, null, null);

  // 515.83 + 100 + 1,515.83 + 100 — งวด 3 ยังไม่ครบกำหนดไม่นับ
  expect(messageTo(f)).toContain('ชำระยอดค้าง 2,231.66 ฿');
  // รอบ 8 I5 — ยอดค้างรวมไม่ใช่ยอดคงค้างของงวดเดียว ⇒ หน้าชำระจ่ายลิงก์แบบนี้ไม่ได้ ⇒ ไม่แนบลิงก์ (ไม่มีลิงก์ว่าง)
  expect(await linksOf(f)).toEqual([]);
  expect(messageTo(f)).not.toContain('ชำระเงินออนไลน์');
}, 60_000);

// m11 (รีวิวรอบ 7) — ตาข่ายกรณีขอบ: แถว `lateFeeWaived = true` ที่ยังมี `lateFee` และยังค้าง ไม่เกิดจากทางปกติ (ยกเว้นค่าปรับ
// `LateFeeWaiverService` ตั้ง `lateFee = 0` · ยกเว้นตอนรับเงินตั้งงวดเป็น PAID) — ปักไว้ให้ผลตรงกับทางรับเงิน/webhook ถ้าเกิดขึ้น
it('แจ้งล็อก — ค่าปรับที่ยกเว้นแล้วไม่นับ', async () => {
  const f = await partlyPaidContract('lockedWaived', { firstFeeWaived: true });

  await engine.executeEventTrigger('DEVICE_LOCKED', f.contractId, null, null);

  expect(messageTo(f)).toContain('ชำระยอดค้าง 2,131.66 ฿');
}, 60_000);

it('ไม่รับสาย (CALL_NO_ANSWER "ชำระงวดที่ … ยอด …") = ยอดคงค้างของงวดนั้น (ค่างวด − ที่จ่าย + ค่าปรับ) · ลิงก์ของงวดนั้นยอดเดียวกัน จ่ายได้จริง', async () => {
  const f = await partlyPaidContract('noAnswer');

  await engine.executeEventTrigger('CALL_NO_ANSWER', f.contractId, null, null);

  expect(messageTo(f)).toContain('ชำระงวดที่ 1 ยอด 615.83 ฿');
  // ข้อความระบุงวด ⇒ ลิงก์ของงวดนั้น ยอดเดียวกับข้อความ · หน้าชำระจ่ายได้ (ผ่านด่านยอดของ intent ไปถึง gateway)
  const links = await linksOf(f);
  expect(links.map((l) => [l.payment?.installmentNo, Number(l.amount)])).toEqual([[1, 615.83]]);
  expect(messageTo(f)).toContain('ชำระเงินออนไลน์:');
  await expect(payLikePayPage(f, links[0])).resolves.toBeDefined();
}, 60_000);

it('นัดชำระ (CALL_ANSWERED_PROMISE "ชำระยอด … ภายใน …") = ยอดและวันที่ลูกค้านัด จากผู้เรียก · ไม่แนบลิงก์ (รอบ 8 I5)', async () => {
  const f = await partlyPaidContract('promise');

  await engine.executeEventTrigger('CALL_ANSWERED_PROMISE', f.contractId, null, 'promise-1', {
    amount: 1500,
    settlementDate: '5 พ.ย. 69',
  });

  expect(messageTo(f)).toContain('ชำระยอด 1,500 ฿ ภายใน 5 พ.ย. 69');
  expect(messageTo(f)).not.toContain('{{');
  // รอบ 8 I5 — ยอดนัด (มักเป็นบางส่วน) ไม่ใช่ยอดคงค้างของงวดเดียว ⇒ ไม่แนบลิงก์ · ข้อความไม่อ้าง "ลิงก์ด้านล่าง" (แม่แบบที่ seed)
  expect(await linksOf(f)).toEqual([]);
  expect(messageTo(f)).not.toContain('ลิงก์');
}, 60_000);
