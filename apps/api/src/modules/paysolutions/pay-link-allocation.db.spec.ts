/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npm test --workspace=apps/api -- src/modules/paysolutions/pay-link-allocation.db.spec.ts (แบบ CI — node --experimental-vm-modules)
 *
 * Task 42 (คำตัดสินเจ้าของ #44) บน Postgres จริง (ฐานที่สร้างด้วย `prisma migrate deploy` อย่างเดียว — กฎทวง/ผู้ใช้ระบบสร้างเอง):
 * - ลิงก์แจ้งล็อก: **ยอดรวมต่องวด**ของแถว "นำไปชำระ (งวดเก่าก่อน)" ของหน้า `/pay/:token` (`GET /line-oa/pay/:token`) = ยอดที่ webhook PaySolutions
 *   ลงแต่ละงวดจริงหลังลูกค้าจ่าย (กดจ่ายผ่าน intent ตัวจริง → webhook ตัวจริง เขียนแถวงวดจริง) — สเปคนี้ตั้ง `amountPaid` ของ fixture ตรง ๆ และจำลอง
 *   ใบรับชำระ จึง**ไม่ได้**พิสูจน์การแบ่งค่างวด/ค่าปรับ: การแบ่งเทียบรายการบัญชีจริงอยู่ที่
 *   `payments/services/pay-link-preview-ledger.integration.spec.ts` (รีวิว I1)
 * - ลิงก์ยอดนัด: วันนัด + แถวชำระบางส่วน / ยังค้างหลังชำระ ตรงกับงวดหลังจ่ายจริง
 * - เงินของลิงก์แจ้งล็อกเข้าแล้ว → งานปลดล็อคหนึ่งงาน (webhook ส่งซ้ำ / เรียกซ้ำไม่สร้างเพิ่ม) · ลิงก์ยอดนัดไม่มีงาน
 */
import { PrismaClient } from '@prisma/client';
import { liffPayIntentRequest } from '@installment/shared';
import type { LiffPayAllocationLine } from '@installment/shared';
import { NotificationsService } from '../notifications/notifications.service';
import { ComplianceService } from '../notifications/compliance.service';
import { HolidayService } from '../notifications/holiday.service';
import { NotificationTemplateService } from '../notifications/notification-template.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { DunningEngineService } from '../overdue/dunning-engine.service';
import { DunningRuleResolverService } from '../overdue/dunning-rule-resolver.service';
import { PaymentLinkService } from '../line-oa/payment-links/payment-link.service';
import { PaySolutionsIntentService } from './services/paysolutions-intent.service';
import { PaySolutionsWebhookService } from './services/paysolutions-webhook.service';
import {
  LOCK_PAID_UNLOCK_TODO_TAG,
  createLockPaidUnlockTodo,
  lockPaidUnlockTodoKey,
} from './services/lock-paid-unlock-todo';
import {
  FinanceFixtureBase,
  InstallmentFixture,
  assertTestDatabase,
  createFinanceFixtureBase,
  createInstallmentFixture,
  dec,
  dueDateBkk,
  realBangkokDate,
  retireFixtures,
} from '../notifications/__tests__/finance-line-fixtures';
import { useSeededEventDunningRules } from '../notifications/__tests__/event-dunning-rules';
import { upsertSystemUser } from '../../../prisma/seeds/collections-foundation.seed';
import { formatDateShort } from '../../utils/thai-date.util';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const stamp = `t42-${Date.now()}`;
const day = realBangkokDate();
let base: FinanceFixtureBase;
let restoreEventRules: () => Promise<void> = async () => {};
let systemUserId: string;
let engine: DunningEngineService;
let links: PaymentLinkService;
let intent: PaySolutionsIntentService;
let webhook: PaySolutionsWebhookService;
const fixtures: InstallmentFixture[] = [];

/** งวดของสัญญาเพิ่มเติม (งวด 2+) */
async function addInstallment(
  f: InstallmentFixture,
  installmentNo: number,
  dueOffset: number,
  lateFee: string,
  status: 'PENDING' | 'OVERDUE',
) {
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

/** สัญญา DEFAULT: งวด 1 จ่ายบางส่วน 1,000 + ค่าปรับ 100 · งวด 2 ค้างเต็ม + ค่าปรับ 100 · งวด 3 ยังไม่ครบกำหนด ⇒ ยอดค้างที่ถึงกำหนด 2,231.66 */
async function lockedContract(label: string) {
  const f = await createInstallmentFixture(prisma, base, {
    label,
    dueDate: dueDateBkk(day, -40),
    paymentStatus: 'PARTIALLY_PAID',
    contractStatus: 'DEFAULT',
    lateFee: '100.00',
  });
  await prisma.payment.update({ where: { id: f.paymentId }, data: { amountPaid: dec('1000.00') } });
  fixtures.push(f);
  await addInstallment(f, 2, -10, '100.00', 'OVERDUE');
  await addInstallment(f, 3, 20, '0.00', 'PENDING');
  return f;
}

/** สัญญา DEFAULT: งวด 1 ค้างเต็ม 1,515.83 + ค่าปรับ 100 · งวด 2 ยังไม่ครบกำหนด */
async function overdueFirstContract(label: string) {
  const f = await createInstallmentFixture(prisma, base, {
    label,
    dueDate: dueDateBkk(day, -10),
    paymentStatus: 'OVERDUE',
    contractStatus: 'DEFAULT',
    lateFee: '100.00',
  });
  fixtures.push(f);
  await addInstallment(f, 2, 20, '0.00', 'PENDING');
  return f;
}

/** ลิงก์ที่ข้อความแนบ (`createPaymentLink`) — แถวติดตาม intent ของลิงก์ AMOUNT ชี้ลิงก์ต้นทางเสมอ จึงไม่ปน */
const messageLink = async (f: InstallmentFixture) => {
  const [link, ...rest] = await prisma.paymentLink.findMany({
    where: { contractId: f.contractId, sourceLinkId: null },
  });
  expect(rest).toEqual([]);
  return link;
};

/** กดจ่ายแบบหน้า `/pay/:token` แล้วผู้ให้บริการยืนยันเงินเข้า (webhook ตัวจริง) — คืน refno ของรายการ */
async function payAndConfirm(f: InstallmentFixture, token: string) {
  const view = await links.resolvePaymentLink(token);
  if (!view.valid || !view.contract) throw new Error(`ลิงก์เปิดไม่ได้: ${JSON.stringify(view)}`);
  const body = liffPayIntentRequest(view, f.lineUserId);
  const result = await intent.createPaymentIntent(
    body.contractId,
    body.amount,
    body.description,
    body.lineId,
    body.installmentNo,
    body.paymentLinkToken,
  );
  const callback = {
    refno: result.gatewayRef,
    result_code: '00',
    order_no: 'o-1',
    transaction_id: `tx-${result.gatewayRef}`,
    total: String(body.amount),
  };
  await webhook.handlePaymentCallback(callback);
  return callback;
}

/** ยอดที่ webhook ลงแต่ละงวดจริง (amountPaid หลัง − ก่อน) + งวดที่ยังค้างหลังจ่าย */
async function snapshot(contractId: string) {
  const rows = await prisma.payment.findMany({
    where: { contractId, deletedAt: null },
    orderBy: { installmentNo: 'asc' },
    select: { installmentNo: true, amountDue: true, amountPaid: true, lateFee: true, status: true },
  });
  return new Map(rows.map((r) => [r.installmentNo, r]));
}

/** แถวนำไปชำระ → ยอดต่องวดที่หน้าเว็บบอกว่าเงินจะลง + ยอดที่บอกว่างวดนั้นยังค้างหลังจ่าย */
function previewByInstallment(lines: LiffPayAllocationLine[]) {
  const applied = new Map<number, number>();
  const leftAfter = new Map<number, number>();
  for (const line of lines) {
    if (line.kind === 'SURPLUS') continue;
    if (line.kind === 'LEFT_AFTER') {
      leftAfter.set(line.installmentNo, line.amount);
      continue;
    }
    applied.set(
      line.installmentNo,
      Number(((applied.get(line.installmentNo) ?? 0) + line.amount).toFixed(2)),
    );
  }
  return { applied, leftAfter };
}

beforeAll(async () => {
  assertTestDatabase();
  base = await createFinanceFixtureBase(prisma, stamp);
  systemUserId = (await upsertSystemUser(prisma)).id;
  restoreEventRules = await useSeededEventDunningRules(prisma, stamp, [
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
  jest.spyOn(notifications.transport, 'sendLine').mockResolvedValue(undefined as never);
  const config = { get: (_key: string, fallback?: unknown) => fallback } as never;
  links = new PaymentLinkService(
    config,
    prisma as never,
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
  const gateway = {
    getMerchantId: jest.fn(async () => 'merchant'),
    getTerminalId: jest.fn(async () => 'terminal'),
    createUiPayment: jest.fn(async () => ({
      gatewayResponse: {},
      paymentUrl: 'https://gw.test/pay',
    })),
  };
  intent = new PaySolutionsIntentService(gateway as never, prisma as never, {} as never, config);
  // webhook ตัวจริง (การกระจายเงิน + เขียนแถวงวด + ปิดลิงก์) · รายการบัญชี/ใบเสร็จ/ข้อความลูกค้าเป็นตัวจำลอง (ไม่ใช่เรื่องของสเปคนี้)
  webhook = new PaySolutionsWebhookService(
    gateway as never,
    prisma as never,
    {} as never,
    { transferOwnership: jest.fn() } as never,
    { createAndPost: jest.fn(async () => ({ entryNumber: 'JE-T42-SURPLUS' })) } as never,
    { execute: jest.fn(async () => ({ entryNo: 'JE-T42', warnings: [] })) } as never,
    { execute: jest.fn() } as never,
    { reverseStageOnPayment: jest.fn() } as never,
    {
      handlePartialPaymentCallback: jest.fn(),
      confirmSavingPlanPayment: jest.fn(),
      confirmOnlineOrderPayment: jest.fn(),
      sendPaymentSuccessNotification: jest.fn(),
      sendEarlyPayoffSuccessNotification: jest.fn(),
    },
  );
});

afterAll(async () => {
  await retireFixtures(prisma, fixtures);
  await restoreEventRules();
  await prisma.$disconnect();
});

describe('ลิงก์แจ้งล็อก (ยอดค้างรวม 2,231.66)', () => {
  it('หน้า /pay/:token: หัว "ยอดค้างชำระ" · ยอดรวมต่องวดของแถวนำไปชำระ = ยอดที่ webhook ลงแต่ละงวดจริงหลังจ่าย · ไม่มีเงินเกิน', async () => {
    const f = await lockedContract('lock');
    await engine.executeEventTrigger('DEVICE_LOCKED', f.contractId, null, null);
    const link = await messageLink(f);
    expect([Number(link.amount), link.purpose, link.sourceEvent, link.promiseDate]).toEqual([
      2231.66,
      'AMOUNT',
      'DEVICE_LOCKED',
      null,
    ]);

    const view = await links.resolvePaymentLink(link.token);
    if (!view.valid) throw new Error('ลิงก์เปิดไม่ได้');
    expect(view.amountKind).toBe('OUTSTANDING');
    expect(view.promiseDate).toBeNull();
    expect(view.allocation).toEqual([
      { kind: 'INSTALLMENT_REMAINING', installmentNo: 1, amount: 515.83 },
      { kind: 'LATE_FEE', installmentNo: 1, amount: 100 },
      { kind: 'INSTALLMENT', installmentNo: 2, amount: 1515.83 },
      { kind: 'LATE_FEE', installmentNo: 2, amount: 100 },
    ]);

    const before = await snapshot(f.contractId);
    await payAndConfirm(f, link.token);
    const after = await snapshot(f.contractId);

    const actual = new Map<number, number>();
    for (const [no, row] of after) {
      const delta = Number(row.amountPaid.sub(before.get(no)!.amountPaid).toFixed(2));
      if (delta !== 0) actual.set(no, delta);
    }
    const preview = previewByInstallment(view.allocation!);
    expect(actual).toEqual(preview.applied);
    // ทุกงวดที่หน้าเว็บบอกว่าปิดครบ = PAID จริง · งวดที่ไม่อยู่ในแถว = ไม่ถูกแตะ
    expect([...after].map(([no, r]) => [no, r.status])).toEqual([
      [1, 'PAID'],
      [2, 'PAID'],
      [3, 'PENDING'],
    ]);
    const contract = await prisma.contract.findUniqueOrThrow({
      where: { id: f.contractId },
      select: { advanceBalance: true },
    });
    expect(Number(contract.advanceBalance)).toBe(0);
  }, 60_000);

  it('เงินเข้าแล้ว → งานปลดล็อคหนึ่งงาน (HIGH · ผู้ใช้ระบบ · สาขาของสัญญา) · webhook ส่งซ้ำ / เรียกซ้ำไม่สร้างเพิ่ม', async () => {
    const f = await lockedContract('lockTodo');
    await engine.executeEventTrigger('DEVICE_LOCKED', f.contractId, null, null);
    const link = await messageLink(f);

    const todoCount = () =>
      prisma.todo.count({ where: { requestKey: lockPaidUnlockTodoKey(link.id) } });
    const callback = await payAndConfirm(f, link.token);
    // webhook ครั้งแรกสร้างงานเอง (หลัง commit)
    expect(await todoCount()).toBe(1);
    // ผู้ให้บริการส่ง webhook ซ้ำ (ลิงก์ USED แล้ว — จบที่ด่าน idempotency)
    await webhook.handlePaymentCallback(callback);
    expect(await todoCount()).toBe(1);
    // เรียกซ้ำตรง ๆ (เช่น งานในอนาคตที่ยิงซ้ำ) — upsert ด้วย requestKey เดิม
    await createLockPaidUnlockTodo(
      prisma as never,
      { sourceLinkId: link.id },
      {
        paidAmount: link.amount,
        refno: callback.refno,
        paidAt: new Date(),
      },
    );

    const todos = await prisma.todo.findMany({
      where: { requestKey: lockPaidUnlockTodoKey(link.id) },
    });
    // รีวิว M2 — ผู้รับ = เจ้าของที่ active คนแรก (ผู้ใช้ระบบ isActive = false ไม่นับ)
    const firstOwner = await prisma.user.findFirst({
      where: { role: 'OWNER', isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    expect(firstOwner).not.toBeNull();
    expect(firstOwner!.id).not.toBe(systemUserId);
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({
      title: `ลูกค้าชำระยอดค้างผ่าน LINE แล้ว — ตรวจยอดแล้วปลดล็อคเครื่อง สัญญา ${f.contractNumber}`,
      priority: 'HIGH',
      status: 'TODO',
      tags: [LOCK_PAID_UNLOCK_TODO_TAG],
      createdById: systemUserId,
      assigneeId: firstOwner!.id,
      branchId: base.branchId,
      roomId: null,
    });
    expect(todos[0].description).toContain('2,231.66 บาท');
    expect(todos[0].description).toContain(callback.refno);
    // ลิงก์ต้นทางจ่ายแล้ว (กดจ่ายซ้ำไม่ได้)
    await expect(
      prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } }),
    ).resolves.toMatchObject({
      status: 'USED',
    });
  }, 60_000);
});

describe('ลิงก์ยอดนัด (1,000 · งวด 1 ค้าง 1,615.83)', () => {
  it('หน้า /pay/:token: หัว "ยอดนัดชำระ" · วันนัด · ชำระบางส่วน + ยังค้างหลังชำระ = งวดหลังจ่ายจริง · ไม่มีงานปลดล็อค', async () => {
    const f = await overdueFirstContract('promise');
    const promiseDate = dueDateBkk(day, 2);
    await engine.executeEventTrigger('CALL_ANSWERED_PROMISE', f.contractId, null, 'promise-t42', {
      amount: 1000,
      settlementDate: formatDateShort(promiseDate),
      promiseDate,
    });
    const link = await messageLink(f);
    expect([Number(link.amount), link.purpose, link.sourceEvent]).toEqual([
      1000,
      'AMOUNT',
      'CALL_ANSWERED_PROMISE',
    ]);
    expect(link.promiseDate?.toISOString()).toBe(promiseDate.toISOString());

    const view = await links.resolvePaymentLink(link.token);
    if (!view.valid) throw new Error('ลิงก์เปิดไม่ได้');
    expect(view.amountKind).toBe('PROMISE');
    expect(view.promiseDate?.toISOString()).toBe(promiseDate.toISOString());
    expect(view.allocation).toEqual([
      { kind: 'PARTIAL', installmentNo: 1, amount: 1000 },
      { kind: 'LEFT_AFTER', installmentNo: 1, amount: 615.83 },
    ]);

    await payAndConfirm(f, link.token);

    const after = await snapshot(f.contractId);
    const first = after.get(1)!;
    expect([Number(first.amountPaid), first.status]).toEqual([1000, 'PARTIALLY_PAID']);
    // ยอดที่หน้าเว็บบอกว่า "ยังค้างหลังชำระ" = ยอดค้างจริงของงวดหลังจ่าย
    expect(Number(first.amountDue.add(first.lateFee).sub(first.amountPaid).toFixed(2))).toBe(
      615.83,
    );
    expect(after.get(2)!.status).toBe('PENDING');
    expect(await prisma.todo.count({ where: { requestKey: lockPaidUnlockTodoKey(link.id) } })).toBe(
      0,
    );
  }, 60_000);
});
