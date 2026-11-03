/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/notifications/dunning-event-amount.db.spec.ts --runInBand
 *
 * Task 30 รอบ 7 I4 (ผู้คุมงานเลือกทาง ก) — ยอดในข้อความกฎทวงตามเหตุการณ์ (`DunningEngineService.executeEventTrigger`) บน Postgres จริง
 * กับแม่แบบที่ seed ไว้ในฐาน · สถานการณ์ของผู้รีวิวรอบ 6: งวด 1 จ่ายบางส่วน 1,000 จาก 1,515.83 + ค่าปรับ 100 · งวด 2 ค้างเต็ม + ค่าปรับ 100
 * ⇒ ยอดค้างที่ถึงกำหนดรวม 2,231.66 · งวด 1 เหลือค้าง 615.83 — รอบ 6 (m7) ใส่ค่างวดเต็ม 1,515.83 ให้ทุกกฎ
 *
 * รอบ 8 I5 — ลิงก์ชำระในข้อความต้อง**จ่ายได้จริง**จากหน้า `/pay/:token`: ใช้ `PaymentLinkService` + `PaySolutionsIntentService` ตัวจริง
 * (gateway จำลองหลังด่านยอดของ intent) และส่ง**สิ่งที่หน้าเว็บส่งจริง** — `liffPayIntentRequest` (`@installment/shared`) ตัวเดียวกับที่
 * `LiffPayment.tsx` เรียก กับข้อมูลจาก `resolvePaymentLink` (`GET /line-oa/pay/:token`)
 *
 * Task 39 (ทาง ก ของ I5) — หน้าเว็บตัดสินจาก**ข้อมูลของลิงก์** (`installmentBound`) ไม่ใช่จากยอด · ลิงก์ไม่ผูกงวด (แจ้งล็อก = ยอดค้างรวม ·
 * นัดชำระ = ยอดนัด) server ใช้ยอดของลิงก์เอง (ยอดจาก client ต้องตรง ไม่งั้นปฏิเสธ) ⇒ แนบลิงก์ให้สองกฎนี้แล้ว ยอดของลิงก์ = ยอดในข้อความ
 */
import { PrismaClient } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { liffPayIntentRequest, type LiffPayIntentRequest } from '@installment/shared';
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
let links: PaymentLinkService;
let intent: PaySolutionsIntentService;
/** gateway จำลอง — ถูกเรียกแปลว่าผ่านด่านยอดของ intent แล้ว · อาร์กิวเมนต์แรก = payload ที่ส่งไป Pay Solutions (มียอดที่ตัดเงินจริง) */
const createUiPayment = jest.fn(async (_payload: { amount: number }) => ({
  gatewayResponse: {},
  paymentUrl: 'https://gw.test/pay',
}));
const fixtures: InstallmentFixture[] = [];
const delivered: { to: string; text: string }[] = [];
const messageTo = (f: InstallmentFixture) =>
  delivered
    .filter((d) => d.to === f.lineUserId)
    .map((d) => d.text)
    .join('\n');
/** ลิงก์ที่ข้อความแนบ (`createPaymentLink` — token 64 ตัว) ไม่รวมแถวติดตาม intent (token = เลขอ้างอิง 12 หลัก) */
const linksOf = (f: InstallmentFixture) =>
  prisma.paymentLink.findMany({
    where: { contractId: f.contractId, NOT: { token: { in: intentRefs } } },
    include: { payment: { select: { installmentNo: true } } },
  });
const intentRefs: string[] = [];

/**
 * กดจ่ายแบบหน้า `/pay/:token`: เปิดลิงก์ (`resolvePaymentLink`) → body จาก `liffPayIntentRequest` (ตัวเดียวกับ `LiffPayment.tsx`) →
 * controller ส่งต่อ `createPaymentIntent` ตามช่องของ body · `tamper` = client แก้ body ก่อนส่ง
 */
async function payLikePayPage(
  f: InstallmentFixture,
  token: string,
  tamper: Partial<LiffPayIntentRequest> = {},
) {
  // เลขอ้างอิงของ intent มาจาก Date.now() — ใช้นาฬิกาจริง (นาฬิกาปลอมคงที่ทำให้เลขชนกับรอบก่อนบนฐานเดียวกัน)
  jest.useRealTimers();
  const view = await links.resolvePaymentLink(token);
  if (!view.valid || !view.contract) throw new Error(`ลิงก์เปิดไม่ได้: ${JSON.stringify(view)}`);
  const body = { ...liffPayIntentRequest(view, f.lineUserId), ...tamper };
  const result = await intent.createPaymentIntent(
    body.contractId,
    body.amount,
    body.description,
    body.lineId,
    body.installmentNo,
    body.paymentLinkToken,
  );
  intentRefs.push(result.gatewayRef);
  return { body, result };
}

/** ยอดที่ gateway ถูกขอให้ตัดเงิน (ครั้งล่าสุด) */
const chargedAmount = () => createUiPayment.mock.calls.at(-1)?.[0].amount;

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

/** งวดของสัญญาเพิ่มเติม (งวด 2+) — เก็บไว้ให้ retireFixtures */
async function addInstallment(
  f: InstallmentFixture,
  installmentNo: number,
  dueOffset: number,
  data: { lateFee?: string; status: 'PENDING' | 'OVERDUE' },
) {
  const p = await prisma.payment.create({
    data: {
      contractId: f.contractId,
      installmentNo,
      dueDate: dueDateBkk(day, dueOffset),
      amountDue: dec('1515.83'),
      lateFee: dec(data.lateFee ?? '0.00'),
      status: data.status,
    },
  });
  fixtures.push({ ...f, paymentId: p.id });
}

/** สัญญา DEFAULT: งวด 1 ค้างเต็ม 1,515.83 + ค่าปรับ 100 (ยอดคงค้าง 1,615.83) · งวด 2 ยังไม่ครบกำหนด — สถานการณ์ยอดนัดของผู้รีวิว */
async function overdueFirstContract(label: string) {
  const f = await createInstallmentFixture(prisma, base, {
    label,
    dueDate: dueDateBkk(day, -10),
    paymentStatus: 'OVERDUE',
    contractStatus: 'DEFAULT',
    lateFee: '100.00',
  });
  fixtures.push(f);
  await addInstallment(f, 2, 20, { status: 'PENDING' });
  return f;
}

/**
 * สัญญา DEFAULT: งวด 1 จ่ายค่างวดครบแล้ว เหลือค่าปรับ 100 · งวด 2 ค้าง 1,515.83 · งวด 3 ยังไม่ครบกำหนด ⇒ ยอดค้างที่ถึงกำหนด 1,615.83
 * — เท่าค่างวด + ค่าปรับของงวดที่ลิงก์ผูก (งวด 1) พอดี ⇒ หน้าเว็บที่เดาจากยอดคิดว่าเป็นลิงก์งวดเดียว ส่งเลขงวด 1 แล้วถูกปฏิเสธ (งวด 1 ค้างแค่ 100)
 */
async function lateFeeOnlyFirstContract(label: string) {
  const f = await createInstallmentFixture(prisma, base, {
    label,
    dueDate: dueDateBkk(day, -40),
    paymentStatus: 'PARTIALLY_PAID',
    contractStatus: 'DEFAULT',
    lateFee: '100.00',
  });
  await prisma.payment.update({ where: { id: f.paymentId }, data: { amountPaid: dec('1515.83') } });
  fixtures.push(f);
  await addInstallment(f, 2, -10, { status: 'OVERDUE' });
  await addInstallment(f, 3, 20, { status: 'PENDING' });
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
  links = new PaymentLinkService(
    config,
    prisma as never,
    // QR พร้อมเพย์บนหน้า /pay/:token — ไม่เกี่ยวกับยอดที่ส่งไปสร้างรายการ
    {
      generateQrDataUrl: async () => null,
      getAccountName: () => 'บริษัท ทดสอบ',
      getMaskedPromptPayId: () => 'xxx-xxx-0000',
    } as never,
    {} as never,
    {} as never,
  );
  engine = new DunningEngineService(
    prisma as never,
    {} as never,
    notifications,
    links,
    new DunningRuleResolverService(prisma as never),
  );
  intent = new PaySolutionsIntentService(
    // gateway — ถึงตรงนี้แปลว่าผ่านด่านยอดของ intent แล้ว
    {
      getMerchantId: jest.fn(async () => 'merchant'),
      getTerminalId: jest.fn(async () => 'terminal'),
      createUiPayment,
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

it('แจ้งล็อก (DEVICE_LOCKED "ชำระยอดค้าง … เพื่อปลดล็อค") = ยอดค้างที่ถึงกำหนดรวมของสัญญา · แนบลิงก์ยอดเดียวกัน (ไม่ผูกงวด) จ่ายได้จริง', async () => {
  const f = await partlyPaidContract('locked');

  await engine.executeEventTrigger('DEVICE_LOCKED', f.contractId, null, null);

  // 515.83 + 100 + 1,515.83 + 100 — งวด 3 ยังไม่ครบกำหนดไม่นับ
  expect(messageTo(f)).toContain('ชำระยอดค้าง 2,231.66 ฿');
  // Task 39 — ลิงก์ยอดค้างรวม = ยอดในข้อความ · ไม่ผูกงวด (ยอดไม่ใช่ยอดคงค้างของงวดเดียว)
  const [link, ...rest] = await linksOf(f);
  expect(rest).toEqual([]);
  expect([Number(link.amount), link.installmentBound]).toEqual([2231.66, false]);
  expect(messageTo(f)).toContain(`ชำระเงินออนไลน์: http://localhost:5173/pay/${link.token}`);

  const { body } = await payLikePayPage(f, link.token);
  // ไม่ส่งเลขงวด + ส่ง token ⇒ server ตรวจยอดกับลิงก์ (ไม่ใช่ทางเดิมที่ไม่ตรวจยอดเลย)
  expect(body).toMatchObject({ amount: 2231.66, paymentLinkToken: link.token });
  expect(body.installmentNo).toBeUndefined();
  expect(chargedAmount()).toBe(2231.66);
}, 60_000);

it('แจ้งล็อก ยอดค้างหลายงวด 1,615.83 = ค่าปรับที่เหลือของงวด 1 (100) + งวด 2 (1,515.83) — จ่ายได้ (เดิม 400 "ยอดชำระไม่ตรง")', async () => {
  const f = await lateFeeOnlyFirstContract('lockedMulti');

  await engine.executeEventTrigger('DEVICE_LOCKED', f.contractId, null, null);

  expect(messageTo(f)).toContain('ชำระยอดค้าง 1,615.83 ฿');
  const [link] = await linksOf(f);
  // ลิงก์ผูกแถวงวด 1 (งวดค้างแรก — ให้หน้าเว็บแสดง) แต่ไม่ผูกงวดในความหมายของยอด
  expect([link.payment?.installmentNo, Number(link.amount), link.installmentBound]).toEqual([
    1,
    1615.83,
    false,
  ]);

  const { body } = await payLikePayPage(f, link.token);
  // หน้าเว็บไม่ส่งเลขงวด ⇒ intent ไม่เทียบกับยอดคงค้างของงวด 1 (100) · gateway ตัดเงินตามยอดของลิงก์
  expect(body).toMatchObject({ amount: 1615.83, paymentLinkToken: link.token });
  expect(body.installmentNo).toBeUndefined();
  expect(chargedAmount()).toBe(1615.83);
}, 60_000);

// m11 (รีวิวรอบ 7) — ตาข่ายกรณีขอบ: แถว `lateFeeWaived = true` ที่ยังมี `lateFee` และยังค้าง ไม่เกิดจากทางปกติ (ยกเว้นค่าปรับ
// `LateFeeWaiverService` ตั้ง `lateFee = 0` · ยกเว้นตอนรับเงินตั้งงวดเป็น PAID) — ปักไว้ให้ผลตรงกับทางรับเงิน/webhook ถ้าเกิดขึ้น
it('แจ้งล็อก — ค่าปรับที่ยกเว้นแล้วไม่นับ (ข้อความและลิงก์)', async () => {
  const f = await partlyPaidContract('lockedWaived', { firstFeeWaived: true });

  await engine.executeEventTrigger('DEVICE_LOCKED', f.contractId, null, null);

  expect(messageTo(f)).toContain('ชำระยอดค้าง 2,131.66 ฿');
  expect((await linksOf(f)).map((l) => Number(l.amount))).toEqual([2131.66]);
}, 60_000);

it('ไม่รับสาย (CALL_NO_ANSWER "ชำระงวดที่ … ยอด …") = ยอดคงค้างของงวดนั้น (ค่างวด − ที่จ่าย + ค่าปรับ) · ลิงก์ผูกงวดนั้น — หน้าเว็บส่งเลขงวดเหมือนเดิม', async () => {
  const f = await partlyPaidContract('noAnswer');

  await engine.executeEventTrigger('CALL_NO_ANSWER', f.contractId, null, null);

  expect(messageTo(f)).toContain('ชำระงวดที่ 1 ยอด 615.83 ฿');
  // ข้อความระบุงวด ⇒ ลิงก์ของงวดนั้น ยอดเดียวกับข้อความ · หน้าชำระจ่ายได้ (ผ่านด่านยอดของ intent ไปถึง gateway)
  const found = await linksOf(f);
  expect(found.map((l) => [l.payment?.installmentNo, Number(l.amount), l.installmentBound])).toEqual([
    [1, 615.83, true],
  ]);
  expect(messageTo(f)).toContain('ชำระเงินออนไลน์:');

  const { body, result } = await payLikePayPage(f, found[0].token);
  // ทางลิงก์ผูกงวดไม่เปลี่ยน: ส่งเลขงวด ไม่ส่ง token · intent ผูกแถวงวด (paymentId = งวด 1)
  expect(body).toMatchObject({ amount: 615.83, installmentNo: 1 });
  expect(body.paymentLinkToken).toBeUndefined();
  expect(result.paymentId).toBe(f.paymentId);
  expect(chargedAmount()).toBe(615.83);
}, 60_000);

it('นัดชำระบางส่วน (CALL_ANSWERED_PROMISE "ชำระยอด 1,000 ภายใน …" · งวด 1 ค้าง 1,615.83) — แนบลิงก์ยอดนัด จ่ายได้ (เดิม 400)', async () => {
  const f = await overdueFirstContract('promise');

  await engine.executeEventTrigger('CALL_ANSWERED_PROMISE', f.contractId, null, 'promise-1', {
    amount: 1000,
    settlementDate: '5 พ.ย. 69',
  });

  // ข้อความตามแม่แบบที่ seed (ไม่อ้าง "ลิงก์ด้านล่าง" — migration 20261110000000) · ลิงก์ต่อท้ายเป็นบรรทัด "ชำระเงินออนไลน์:"
  expect(messageTo(f)).toContain('ชำระยอด 1,000 ฿ ภายใน 5 พ.ย. 69');
  expect(messageTo(f)).not.toContain('{{');
  expect(messageTo(f)).not.toContain('ลิงก์');
  const [link, ...rest] = await linksOf(f);
  expect(rest).toEqual([]);
  expect([Number(link.amount), link.installmentBound]).toEqual([1000, false]);
  expect(messageTo(f)).toContain(`ชำระเงินออนไลน์: http://localhost:5173/pay/${link.token}`);

  const { body } = await payLikePayPage(f, link.token);
  expect(body).toMatchObject({ amount: 1000, paymentLinkToken: link.token });
  expect(body.installmentNo).toBeUndefined();
  // ยอดนัด (บางส่วน) ถึง gateway ตามยอดของลิงก์ — webhook กระจายเข้างวด 1 เป็น PARTIALLY_PAID
  expect(chargedAmount()).toBe(1000);
}, 60_000);

it('client แก้ยอดก่อนส่ง (ลิงก์ไม่ผูกงวด) → 400 ไม่ถึง gateway ไม่สร้างรายการ — server ใช้ยอดของลิงก์', async () => {
  const f = await overdueFirstContract('tamper');
  await engine.executeEventTrigger('CALL_ANSWERED_PROMISE', f.contractId, null, 'promise-2', {
    amount: 1000,
    settlementDate: '5 พ.ย. 69',
  });
  const [link] = await linksOf(f);
  const calls = createUiPayment.mock.calls.length;

  for (const amount of [1, 999.98, 1615.83]) {
    await expect(payLikePayPage(f, link.token, { amount })).rejects.toThrow(BadRequestException);
  }
  await expect(payLikePayPage(f, link.token, { amount: 1 })).rejects.toThrow('ยอดชำระไม่ตรง');
  expect(createUiPayment.mock.calls.length).toBe(calls);
  // ไม่มีแถวติดตาม intent ของสัญญานี้ (มีแต่ลิงก์ที่ข้อความแนบ)
  expect(await prisma.paymentLink.count({ where: { contractId: f.contractId } })).toBe(1);
}, 60_000);
