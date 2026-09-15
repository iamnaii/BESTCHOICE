import {
  backfillExitCode,
  checkPurchasedParity,
  runJourneyBackfill,
  unlinkedRoomsGate,
  UNLINKED_ROOMS_MAX_RATIO,
} from './backfill-customer-journey.cli';

const CUSTOMER_SELECT = { id: true, createdAt: true };
const ORDER = [{ createdAt: 'asc' }, { id: 'asc' }];

describe('unlinkedRoomsGate', () => {
  it('ไม่มีห้องแชทเลย → ผ่าน ratio 0 (ไม่หารด้วยศูนย์)', () => {
    expect(unlinkedRoomsGate({ liveRooms: 0, unlinkedRooms: 0 })).toEqual({ ok: true, ratio: 0 });
  });

  it('เท่ากับ 1% พอดี → ผ่าน (หยุดเฉพาะ "เกิน" 1%)', () => {
    expect(UNLINKED_ROOMS_MAX_RATIO).toBe(0.01);
    expect(unlinkedRoomsGate({ liveRooms: 100, unlinkedRooms: 1 })).toEqual({ ok: true, ratio: 0.01 });
  });

  it('เกิน 1% → ไม่ผ่าน · ตัวเลข prod ก่อนรัน backfill:chat-prospects (8,991/8,992) ต้องโดนหยุด', () => {
    expect(unlinkedRoomsGate({ liveRooms: 10_000, unlinkedRooms: 101 }).ok).toBe(false);
    expect(unlinkedRoomsGate({ liveRooms: 8_992, unlinkedRooms: 8_991 }).ok).toBe(false);
  });
});

describe('backfillExitCode', () => {
  const plan = { customers: 3 };
  const result = { processed: 3, batches: 1, failedBatches: 0, failedCustomers: 0 };
  const parity = { boughtCustomers: 1, purchasedStates: 1, ok: true };

  it('ครบทุกคน ไม่มีชุดล้ม parity ตรง → 0', () => {
    expect(backfillExitCode({ plan, result, parity })).toBe(0);
  });

  it('PURCHASED ≠ BOUGHT_WHERE → 2', () => {
    expect(backfillExitCode({ plan, result, parity: { boughtCustomers: 2, purchasedStates: 1, ok: false } })).toBe(2);
  });

  it('recompute ล้มอย่างน้อยหนึ่งชุด → 2', () => {
    expect(backfillExitCode({ plan, result: { ...result, failedBatches: 1, failedCustomers: 1 }, parity })).toBe(2);
  });

  it('processed ≠ plan.customers → 2', () => {
    expect(backfillExitCode({ plan, result: { ...result, processed: 2 }, parity })).toBe(2);
  });
});

describe('checkPurchasedParity', () => {
  it('แปลงผลของ JourneyStateService.purchasedParity (ตัวเดียวกับ cron journey:recompute) เป็นผลของ CLI', async () => {
    const stateService = { purchasedParity: jest.fn().mockResolvedValue({ purchasedStates: 4, bought: 5 }) };
    await expect(checkPurchasedParity(stateService)).resolves.toEqual({ boughtCustomers: 5, purchasedStates: 4, ok: false });
    stateService.purchasedParity.mockResolvedValueOnce({ purchasedStates: 5, bought: 5 });
    await expect(checkPurchasedParity(stateService)).resolves.toEqual({ boughtCustomers: 5, purchasedStates: 5, ok: true });
  });
});

describe('runJourneyBackfill keyset (Ruling R20 แบบเดียวกับ backfill-chat-prospects)', () => {
  const c1 = { id: 'c1', createdAt: new Date('2026-05-01T00:00:00.000Z') };
  const c2 = { id: 'c2', createdAt: new Date('2026-05-02T00:00:00.000Z') };
  const c3 = { id: 'c3', createdAt: new Date('2026-05-03T00:00:00.000Z') };

  it('ชุดแรกกรองแค่ deletedAt null · ชุดถัดไป (createdAt,id) > ตัวสุดท้ายของชุดก่อน · ไม่มี cursor/skip · recompute ได้ id ทีละชุด', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock เฉพาะ customer.findMany
    const prisma: any = { customer: { findMany: jest.fn().mockResolvedValueOnce([c1, c2]).mockResolvedValueOnce([c3]).mockResolvedValueOnce([]) } };
    const stateService = { recompute: jest.fn().mockResolvedValue(undefined) };
    const log = jest.fn();

    await expect(runJourneyBackfill(prisma, stateService, { batchSize: 2, log })).resolves.toEqual({
      processed: 3, batches: 2, failedBatches: 0, failedCustomers: 0,
    });
    expect(stateService.recompute.mock.calls).toEqual([[['c1', 'c2']], [['c3']]]);
    expect(prisma.customer.findMany).toHaveBeenNthCalledWith(1, { where: { deletedAt: null }, select: CUSTOMER_SELECT, orderBy: ORDER, take: 2 });
    expect(prisma.customer.findMany).toHaveBeenNthCalledWith(2, {
      where: { AND: [{ deletedAt: null }, { OR: [{ createdAt: { gt: c2.createdAt } }, { createdAt: c2.createdAt, id: { gt: 'c2' } }] }] },
      select: CUSTOMER_SELECT,
      orderBy: ORDER,
      take: 2,
    });
    expect(prisma.customer.findMany.mock.calls[1][0]).not.toHaveProperty('cursor');
    expect(prisma.customer.findMany.mock.calls[1][0]).not.toHaveProperty('skip');
  });

  it('recompute ล้มทั้งชุด → นับ failed แล้วขยับ keyset ต่อ ไม่วนซ้ำชุดเดิม · log มีแค่ id (PDPA)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock เฉพาะ customer.findMany
    const prisma: any = { customer: { findMany: jest.fn().mockResolvedValueOnce([c1, c2]).mockResolvedValueOnce([]) } };
    const stateService = { recompute: jest.fn().mockRejectedValue(new Error('boom')) };
    const log = jest.fn();

    await expect(runJourneyBackfill(prisma, stateService, { batchSize: 2, log })).resolves.toEqual({
      processed: 2, batches: 1, failedBatches: 1, failedCustomers: 2,
    });
    expect(prisma.customer.findMany).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('FAILED batch first=c1 last=c2 size=2: boom');
  });
});
