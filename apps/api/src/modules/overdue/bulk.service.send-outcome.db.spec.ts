/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/overdue/bulk.service.send-outcome.db.spec.ts --runInBand
 *
 * Task 34 ข้อ 2 — ปุ่ม "ส่ง LINE" / ส่งรวดของคิวทวงถาม คืนผลแยก "ส่งแล้ว" กับ "ไม่ได้ส่ง พร้อมเหตุผล" บน Postgres จริง
 * (ด่านจริงของ `ComplianceService.canSend` — ความยินยอม PDPA · เพดานวันละครั้ง · เวลาทำการ — อ่านแถวในฐาน ซึ่ง mock มองไม่เห็น):
 * เดิมทุกครั้งที่ `send()` ไม่ throw นับเป็นส่งแล้ว ⇒ ลูกค้าไม่มีความยินยอม / ส่งซ้ำวันเดียวกัน / กดนอกเวลา ขึ้นว่าส่งสำเร็จบนหน้าเว็บ
 *
 * ปลายทางจริงถูก stub (transport ของ NotificationsService) — นับข้อความต่อ LINE ที่ส่งผ่าน
 */
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { ComplianceService } from '../notifications/compliance.service';
import { HolidayService } from '../notifications/holiday.service';
import { NotificationTemplateService } from '../notifications/notification-template.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { OverdueBulkService } from './bulk.service';
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
} from '../notifications/__tests__/finance-line-fixtures';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));
jest.mock('@sentry/node', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const stamp = `t34b-${Date.now()}`;
const day = realBangkokDate();
let base: FinanceFixtureBase;
let notifications: NotificationsService;
let queue: OverdueBulkService;
let seq = 0;
const fixtures: InstallmentFixture[] = [];
const delivered: string[] = [];
const msg = { customMessage: '[BESTCHOICE FINANCE] กรุณาชำระค่างวดที่ค้าง' };

async function overdue(label: string, opts: { consent?: boolean } = {}) {
  const f = await createInstallmentFixture(prisma, base, {
    label: `${label}-${++seq}`,
    dueDate: dueDateBkk(day, -5),
    contractStatus: 'OVERDUE',
    paymentStatus: 'OVERDUE',
    consent: opts.consent,
  });
  fixtures.push(f);
  return f;
}

const owner = () => ({ id: base.salespersonId, role: 'OWNER' as const, branchId: null });

beforeAll(async () => {
  assertTestDatabase();
  base = await createFinanceFixtureBase(prisma, stamp);
  const compliance = new ComplianceService(
    prisma as never,
    new PDPAService(prisma as never),
    new HolidayService(),
  );
  notifications = new NotificationsService(
    prisma as never,
    { get: jest.fn() } as never,
    {} as never,
    { afterPayment: jest.fn(() => []) } as never,
    { getValue: jest.fn().mockResolvedValue('') } as never,
    compliance,
    new NotificationTemplateService(prisma as never),
  );
  jest.spyOn(notifications.transport, 'sendLine').mockImplementation(async (to: string) => {
    delivered.push(to);
  });
  jest.spyOn(notifications.transport, 'sendSms').mockResolvedValue('sms-id');
  queue = new OverdueBulkService(prisma as never, {} as never, notifications);
});

afterEach(async () => {
  jest.useRealTimers();
  delivered.splice(0);
  await retireFixtures(prisma, fixtures.splice(0));
});

afterAll(async () => prisma.$disconnect());

describe('Task 34 ข้อ 2 — คิวทวงถามส่ง LINE: ส่งแล้ว / ไม่ได้ส่งพร้อมเหตุผล (ด่านจริงบน Postgres)', () => {
  it('ส่งรวด: มีความยินยอม → ส่งแล้ว · ไม่มีความยินยอม → ไม่ได้ส่ง (NO_CONSENT) ไม่ถึง LINE', async () => {
    useFakeDate(bangkokAt(day, 0, 10));
    const ok = await overdue('consent');
    const none = await overdue('noconsent', { consent: false });

    const res = await queue.bulkSendLine(
      { contractIds: [ok.contractId, none.contractId], ...msg },
      owner(),
    );

    expect(res).toEqual({
      sent: 1,
      failed: 1,
      total: 2,
      notSent: [
        {
          contractId: none.contractId,
          contractNumber: none.contractNumber,
          reason: 'NO_CONSENT',
          reasonText: expect.stringContaining('ความยินยอม PDPA'),
        },
      ],
    });
    expect(delivered).toEqual([ok.lineUserId]);
  });

  it('ส่งเดี่ยวซ้ำสัญญาเดิมวันเดียวกัน → ครั้งที่สองไม่ได้ส่ง (FREQUENCY_CAP วันละครั้ง)', async () => {
    useFakeDate(bangkokAt(day, 0, 10));
    const f = await overdue('twice');

    await expect(queue.sendLineAdhoc(f.contractId, msg, owner())).resolves.toMatchObject({
      sent: 1,
      notSent: [],
    });
    const second = await queue.sendLineAdhoc(f.contractId, msg, owner());

    expect(second.sent).toBe(0);
    expect(second.notSent.map((n) => n.reason)).toEqual(['FREQUENCY_CAP']);
    expect(delivered).toEqual([f.lineUserId]);
  });

  it('กดส่งนอกเวลาทำการ (21:00) → ยังไม่ได้ส่ง (OUTSIDE_HOURS) · แถว DELAYED ให้คิวส่งซ้ำส่งเอง', async () => {
    useFakeDate(bangkokAt(day, 0, 21));
    const f = await overdue('night');

    const res = await queue.sendLineAdhoc(f.contractId, msg, owner());

    expect(res.sent).toBe(0);
    expect(res.notSent.map((n) => n.reason)).toEqual(['OUTSIDE_HOURS']);
    expect(delivered).toEqual([]);
    expect(
      await prisma.notificationLog.count({
        where: { relatedId: f.contractId, status: 'DELAYED' },
      }),
    ).toBe(1);
  });
});
