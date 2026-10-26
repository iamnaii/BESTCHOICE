import * as Sentry from '@sentry/nestjs';
import { CashCloseAlertsCron } from '../cash-close-alerts.cron';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const NOW = new Date('2026-10-26T03:00:00.000Z'); // 26 ต.ค. 2569 10:00 ไทย → "เมื่อวาน" = 2026-10-25

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makePrisma = (over: Record<string, any> = {}) => ({
  shopTender: { groupBy: jest.fn().mockResolvedValue([]) },
  shopCashClose: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) },
  branch: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({ name: `สาขา ${where.id}` })) },
  ...over,
});

describe('CashCloseAlertsCron (ก้อน 7 A16 — เงินสดหน้าร้าน 10:00)', () => {
  const staffNotify = { notify: jest.fn().mockResolvedValue({ recipients: 1, sent: 1, deduped: 0, failed: 0, quotaSkipped: 0 }) };

  beforeEach(() => jest.clearAllMocks());

  it('CC1: สองสาขาไม่ปิดยอดเมื่อวาน → แจ้ง cash_close.missed สาขาละครั้ง dedupe สาขา:วันที่', async () => {
    const prisma = makePrisma();
    prisma.shopTender.groupBy.mockResolvedValue([
      { branchId: 'br-1', _sum: { amount: 3500 }, _max: { occurredAt: new Date('2026-10-25T08:00:00.000Z') } },
      { branchId: 'br-2', _sum: { amount: 1200.5 }, _max: { occurredAt: new Date('2026-10-25T09:00:00.000Z') } },
    ]);
    const cron = new CashCloseAlertsCron(prisma as never, staffNotify as never);

    const result = await cron.tick(NOW);

    expect(result).toEqual({ missed: 2, awaiting: 0 });
    expect(staffNotify.notify).toHaveBeenCalledTimes(2);
    expect(staffNotify.notify).toHaveBeenNthCalledWith(1, 'cash_close.missed', expect.objectContaining({
      title: 'สาขา br-1 ยังไม่ปิดยอดเงินสดของเมื่อวาน',
      lines: [expect.stringMatching(/เงินสดเข้า 3,500\.00 บาท แต่ไม่มีใบปิดยอด/)],
      link: '/shop/daily-cash?branch=br-1',
      branchId: 'br-1',
      dedupeKey: 'br-1:2026-10-25',
    }));
    expect(staffNotify.notify).toHaveBeenNthCalledWith(2, 'cash_close.missed', expect.objectContaining({
      branchId: 'br-2', dedupeKey: 'br-2:2026-10-25', lines: [expect.stringMatching(/1,200\.50/)],
    }));
  });

  it('CC2: ทุกสาขาปิดยอดแล้วและไม่มียอดค้างยืนยัน → ไม่แจ้งอะไร', async () => {
    const cron = new CashCloseAlertsCron(makePrisma() as never, staffNotify as never);
    await expect(cron.tick(NOW)).resolves.toEqual({ missed: 0, awaiting: 0 });
    expect(staffNotify.notify).not.toHaveBeenCalled();
  });

  it('CC3: ยอดนับแล้วรอยืนยันเกิน 1 วัน 3 ใบ → แจ้ง cash_close.awaiting ครั้งเดียว dedupe วันที่ไทย', async () => {
    const prisma = makePrisma();
    prisma.shopCashClose.count.mockResolvedValue(3);
    const cron = new CashCloseAlertsCron(prisma as never, staffNotify as never);

    const result = await cron.tick(NOW);

    expect(result).toEqual({ missed: 0, awaiting: 3 });
    expect(staffNotify.notify).toHaveBeenCalledTimes(1);
    expect(staffNotify.notify).toHaveBeenCalledWith('cash_close.awaiting', expect.objectContaining({
      title: 'มี 3 ยอดเงินสดที่นับแล้ว รอยืนยันรับเงินเกิน 1 วัน',
      link: '/shop/daily-cash',
      dedupeKey: '2026-10-26',
    }));
    const where = prisma.shopCashClose.count.mock.calls[0][0].where;
    expect(where.status).toBe('PENDING_CONFIRM');
    expect(where.countedAt.lt).toEqual(new Date('2026-10-25T03:00:00.000Z'));
  });

  it('CC4: helper พัง → ไม่ throw, ส่ง Sentry, คืนศูนย์', async () => {
    const prisma = makePrisma();
    prisma.shopTender.groupBy.mockRejectedValue(new Error('db down'));
    const cron = new CashCloseAlertsCron(prisma as never, staffNotify as never);

    await expect(cron.tick(NOW)).resolves.toEqual({ missed: 0, awaiting: 0 });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(staffNotify.notify).not.toHaveBeenCalled();
  });

  it('CC5: ไม่มี StaffNotifyService (optional) → ข้ามเงียบ ไม่พัง', async () => {
    const prisma = makePrisma();
    prisma.shopCashClose.count.mockResolvedValue(2);
    const cron = new CashCloseAlertsCron(prisma as never);
    await expect(cron.tick(NOW)).resolves.toEqual({ missed: 0, awaiting: 2 });
  });
});
