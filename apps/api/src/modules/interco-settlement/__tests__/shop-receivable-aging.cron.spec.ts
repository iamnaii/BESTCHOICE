import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));
import * as Sentry from '@sentry/nestjs';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  IntercoAgingService,
  MISSING_CONTRACT_LABEL,
  ShopReceivableAgingRow,
  ShopReceivableAgingResult,
  isShopReceivableOverdue,
} from '../interco-aging.service';
import { ShopReceivableAgingCron, AGING_TODO_TAG } from '../crons/shop-receivable-aging.cron';

const D = (v: string | number) => new Prisma.Decimal(v);

const ROW_ALERT_MSG = 'Shop receivable aged past threshold';
const LEGACY_ALERT_MSG = 'Legacy one-book shop receivable outstanding';

/** แยกอีเวนต์ Sentry ตามข้อความ — alert รายแถว vs อีเวนต์รวมของ legacy */
function sentryCalls(message: string): unknown[][] {
  return (Sentry.captureMessage as jest.Mock).mock.calls.filter((c) => c[0] === message);
}

/** แถวเปล่า — เทสต์เติมเฉพาะฟิลด์ที่สนใจ (ยอด 0 / ไม่มีอายุ = ไม่ overdue) */
function makeRow(partial: Partial<ShopReceivableAgingRow>): ShopReceivableAgingRow {
  return {
    contractId: 'c-0',
    contractNumber: 'CT-0',
    customerName: 'ลูกค้าทดสอบ',
    swapCreditGross: D(0),
    payoutRecallGross: D(0),
    settledDeduction: D(0),
    intercoNet: D(0),
    shopCollect: D(0),
    shopMirrorGross: D(0),
    shopMirrorNet: D(0),
    intercoOldestPostedAt: null,
    intercoAgeDays: null,
    shopCollectOldestPostedAt: null,
    shopCollectAgeDays: null,
    bookMismatch: false,
    legacySwapGross: D(0),
    legacyOneBook: false,
    ...partial,
  };
}

/**
 * Fixture ที่สะท้อนของจริง: 2 แถวเกินเกณฑ์ (คนละแขน), 1 แถวใหม่, 1 แถว legacy
 * ที่ค้างนานมาก (ห้าม alert — spec §11.4), 1 แถวอายุมากแต่ยอดเป็นศูนย์.
 */
function fixtureRows(): ShopReceivableAgingRow[] {
  return [
    makeRow({
      contractId: 'c-interco',
      contractNumber: 'CT-INTERCO-OLD',
      swapCreditGross: D('8000.00'),
      payoutRecallGross: D('11000.00'),
      settledDeduction: D('16000.00'),
      intercoNet: D('3000.00'),
      shopMirrorNet: D('3000.00'),
      intercoAgeDays: 45,
      intercoOldestPostedAt: new Date('2026-07-07T00:00:00.000Z'),
    }),
    makeRow({
      contractId: 'c-collect',
      contractNumber: 'CT-COLLECT-OLD',
      shopCollect: D('1771.00'),
      shopCollectAgeDays: 60,
      shopCollectOldestPostedAt: new Date('2026-06-22T00:00:00.000Z'),
    }),
    makeRow({
      contractId: 'c-fresh',
      contractNumber: 'CT-FRESH',
      swapCreditGross: D('8000.00'),
      intercoNet: D('8000.00'),
      shopMirrorNet: D('8000.00'),
      intercoAgeDays: 10,
      intercoOldestPostedAt: new Date('2026-08-11T00:00:00.000Z'),
    }),
    // legacy สมุดเดียว (spec §11.4) — ค้าง 400 วันทั้งสองแขน แต่ต้องเงียบ
    makeRow({
      contractId: 'c-legacy',
      contractNumber: 'CT-LEGACY',
      swapCreditGross: D('8000.00'),
      intercoNet: D('8000.00'),
      legacySwapGross: D('8000.00'),
      legacyOneBook: true,
      bookMismatch: true,
      intercoAgeDays: 400,
      shopCollect: D('1771.00'),
      shopCollectAgeDays: 400,
    }),
    // อายุมากแต่ไม่มียอด (แถวโผล่เพราะ bookMismatch) → ไม่ใช่หนี้ค้าง
    makeRow({
      contractId: 'c-zero',
      contractNumber: 'CT-ZERO',
      intercoNet: D('0.00'),
      shopMirrorNet: D('500.00'),
      bookMismatch: true,
      intercoAgeDays: 120,
    }),
  ];
}

/**
 * ประกอบ result เหมือน service จริง — `totals` คำนวณด้วย predicate ตัวเดียวกับที่
 * service ใช้ (`isShopReceivableOverdue` ที่ export ออกมา) และ **กันแถว legacy ออก**
 * ⇒ เทสต์ anti-drift ด้านล่างจับได้ทันทีถ้า cron ไปเขียนสูตรของตัวเอง.
 */
function buildResult(rows: ShopReceivableAgingRow[], thresholdDays: number): ShopReceivableAgingResult {
  const nonLegacy = rows.filter((r) => !r.legacyOneBook);
  const legacy = rows.filter((r) => r.legacyOneBook);
  const zero = D(0);
  return {
    rows,
    asOf: new Date('2026-08-21T02:07:00.000Z'),
    totals: {
      intercoNet: nonLegacy.reduce((s, r) => s.plus(r.intercoNet), zero),
      shopCollect: nonLegacy.reduce((s, r) => s.plus(r.shopCollect), zero),
      overdueCount: nonLegacy.filter((r) => isShopReceivableOverdue(r, thresholdDays)).length,
      legacyOneBookNet: legacy.reduce((s, r) => s.plus(r.intercoNet).plus(r.shopCollect), zero),
    },
  };
}

describe('ShopReceivableAgingCron', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let aging: any;
  let cron: ShopReceivableAgingCron;
  let configValues: Record<string, string>;

  beforeEach(async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    (Sentry.captureException as jest.Mock).mockClear();
    configValues = {};

    prisma = {
      systemConfig: {
        findFirst: jest.fn(async ({ where }: { where: { key: string } }) =>
          configValues[where.key] != null ? { value: configValues[where.key] } : null,
        ),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'u-system' }),
      },
      todo: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'todo-1' }),
      },
    };

    aging = {
      getShopReceivableAging: jest
        .fn()
        .mockImplementation(async (_asOf: Date, thresholdDays = 30) =>
          buildResult(fixtureRows(), thresholdDays),
        ),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        ShopReceivableAgingCron,
        { provide: PrismaService, useValue: prisma },
        { provide: IntercoAgingService, useValue: aging },
      ],
    }).compile();
    cron = mod.get(ShopReceivableAgingCron);
  });

  it('kill switch ปิด → ไม่ทำอะไร (enabled: false)', async () => {
    configValues['shop_receivable_aging_alerts_enabled'] = 'false';

    const result = await cron.tick();

    expect(result).toEqual({ enabled: false, flagged: 0, todosCreated: 0, skipped: 0 });
    expect(aging.getShopReceivableAging).not.toHaveBeenCalled();
    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('ไม่มี SystemConfig → default เปิด + threshold 30 วัน', async () => {
    const result = await cron.tick();

    expect(result.enabled).toBe(true);
    expect(aging.getShopReceivableAging).toHaveBeenCalledWith(expect.any(Date), 30);
  });

  it('อ่าน threshold จาก SystemConfig แล้วส่งให้ service (เกณฑ์เดียวกับ totals)', async () => {
    configValues['shop_receivable_aging_alert_days'] = '45';

    await cron.tick();

    expect(aging.getShopReceivableAging).toHaveBeenCalledWith(expect.any(Date), 45);
  });

  it('แถวเกิน threshold → สร้าง Todo MEDIUM tag interco-aging + Sentry warning', async () => {
    const result = await cron.tick();

    expect(result.enabled).toBe(true);
    expect(result.flagged).toBe(2);
    expect(result.todosCreated).toBe(2);
    expect(result.skipped).toBe(0);
    expect(prisma.todo.create).toHaveBeenCalledTimes(2);

    const titles = prisma.todo.create.mock.calls.map(
      (c: [{ data: { title: string } }]) => c[0].data.title,
    );
    expect(titles.some((t: string) => t.includes('CT-INTERCO-OLD'))).toBe(true);
    expect(titles.some((t: string) => t.includes('CT-COLLECT-OLD'))).toBe(true);

    const data = prisma.todo.create.mock.calls[0][0].data;
    expect(data.tags).toEqual([AGING_TODO_TAG]);
    expect(data.priority).toBe('MEDIUM');
    expect(data.createdById).toBe('u-system');
    expect(data.description).toContain('contractId');

    // Sentry warning หนึ่งใบต่อแถวที่เกินเกณฑ์ (นับเฉพาะข้อความของ alert รายแถว)
    const rowAlerts = sentryCalls(ROW_ALERT_MSG);
    expect(rowAlerts).toHaveLength(2);
    const opts = rowAlerts[0][1] as {
      level: string;
      tags: { subsystem: string };
      extra: { contractNumber?: string };
    };
    expect(opts.level).toBe('warning');
    expect(opts.tags.subsystem).toBe('interco-netting');
    expect(opts.extra.contractNumber).toBeDefined();
  });

  it('description บอกวิธีล้างตามกลุ่ม (หักกลบรอบจ่าย / รับเงินสดคืน / รับโอนจากหน้าร้าน)', async () => {
    await cron.tick();

    const byContract = new Map<string, string>(
      prisma.todo.create.mock.calls.map(
        (c: [{ data: { title: string; description: string } }]) =>
          [c[0].data.title, c[0].data.description] as [string, string],
      ),
    );
    const intercoDesc = [...byContract.entries()].find(([t]) => t.includes('CT-INTERCO-OLD'))?.[1];
    const collectDesc = [...byContract.entries()].find(([t]) => t.includes('CT-COLLECT-OLD'))?.[1];

    expect(intercoDesc).toContain('หักกลบ');
    expect(intercoDesc).toContain('รับเงินสดคืน');
    expect(collectDesc).toContain('รับโอนจากหน้าร้าน');
  });

  it('แถว legacyOneBook ไม่ถูก alert แม้ค้าง 400 วัน (spec §11.4 = สภาพปกติ)', async () => {
    await cron.tick();

    const allText = JSON.stringify([
      ...prisma.todo.create.mock.calls,
      ...(Sentry.captureMessage as jest.Mock).mock.calls,
    ]);
    expect(allText).not.toContain('CT-LEGACY');
    expect(allText).not.toContain('c-legacy');
  });

  it('แถวยอด 0 (โผล่เพราะ bookMismatch) ไม่นับเป็นค้างชำระ', async () => {
    await cron.tick();

    const allText = JSON.stringify(prisma.todo.create.mock.calls);
    expect(allText).not.toContain('CT-ZERO');
  });

  it('anti-drift: จำนวนแถวที่ cron ถือว่า overdue == totals.overdueCount ของ service', async () => {
    const expected = buildResult(fixtureRows(), 30).totals.overdueCount;

    const result = await cron.tick();

    expect(expected).toBe(2); // ปักความหมายของ fixture ไว้ด้วย
    expect(result.flagged).toBe(expected);
  });

  it('dedup: รันซ้ำไม่สร้าง Todo ซ้ำ (มี Todo ที่ยังไม่ DONE ของสัญญานั้น)', async () => {
    prisma.todo.findFirst.mockImplementation(
      async ({ where }: { where: { title: { contains: string } } }) =>
        where.title.contains === 'CT-INTERCO-OLD' ? { id: 'todo-existing' } : null,
    );

    const result = await cron.tick();

    expect(result.flagged).toBe(2);
    expect(result.todosCreated).toBe(1);
    expect(result.skipped).toBe(1);
    expect(prisma.todo.create).toHaveBeenCalledTimes(1);
    const dedupArgs = prisma.todo.findFirst.mock.calls[0][0];
    expect(dedupArgs.where.tags).toEqual({ has: AGING_TODO_TAG });
    expect(dedupArgs.where.status).toEqual({ not: 'DONE' });
    expect(dedupArgs.where.deletedAt).toBeNull();
  });

  // Phase 5 Task 6 (Task 5 review, minor): แถวที่ hydrate สัญญาไม่ได้ทุกแถวมี
  // contractNumber เดียวกัน ('(ไม่พบสัญญา)') ⇒ dedup ที่ค้นด้วยเลขสัญญาตรง ๆ จะ
  // ยุบแถวผีที่สองเข้ากับใบแรก และเพราะ alarm อยู่หลัง dedup probe (Phase 4)
  // แถวที่ถูกยุบจะเงียบทั้ง Todo และ Sentry
  it('แถวผี (ไม่พบสัญญา) หลายแถว → คนละใบงาน ไม่ยุบเข้ากัน (dedup ต้องแยกด้วย contractId)', async () => {
    const ghost = (id: string) =>
      makeRow({
        contractId: id,
        contractNumber: MISSING_CONTRACT_LABEL,
        customerName: '',
        payoutRecallGross: D('5000.00'),
        intercoNet: D('5000.00'),
        intercoOldestPostedAt: new Date('2026-01-01T00:00:00.000Z'),
        intercoAgeDays: 200,
      });
    aging.getShopReceivableAging.mockImplementation(async (_asOf: Date, thresholdDays = 30) =>
      buildResult([ghost('ghost-a'), ghost('ghost-b')], thresholdDays),
    );

    const result = await cron.tick();

    expect(result.flagged).toBe(2);
    expect(result.todosCreated).toBe(2);
    expect(prisma.todo.create).toHaveBeenCalledTimes(2);
    expect(sentryCalls(ROW_ALERT_MSG)).toHaveLength(2);

    // คีย์ dedup ต้องแยกกันจริง (ไม่ใช่ '(ไม่พบสัญญา)' ทั้งคู่)
    const probes = prisma.todo.findFirst.mock.calls.map(
      (c: [{ where: { title: { contains: string } } }]) => c[0].where.title.contains,
    );
    expect(new Set(probes).size).toBe(2);
    expect(probes[0]).toContain('ghost-a');
    expect(probes[1]).toContain('ghost-b');

    // และหัวเรื่องต้องแยกกันด้วย ไม่งั้นรอบถัดไป dedup ก็ยังหากันไม่เจอ
    const titles = prisma.todo.create.mock.calls.map(
      (c: [{ data: { title: string } }]) => c[0].data.title,
    );
    expect(new Set(titles).size).toBe(2);
  });

  it('แถวผีใบเดิมค้างอยู่ → รอบถัดไป dedup เจอ ไม่สร้างซ้ำ', async () => {
    aging.getShopReceivableAging.mockImplementation(async (_asOf: Date, thresholdDays = 30) =>
      buildResult(
        [
          makeRow({
            contractId: 'ghost-a',
            contractNumber: MISSING_CONTRACT_LABEL,
            customerName: '',
            payoutRecallGross: D('5000.00'),
            intercoNet: D('5000.00'),
            intercoOldestPostedAt: new Date('2026-01-01T00:00:00.000Z'),
            intercoAgeDays: 200,
          }),
        ],
        thresholdDays,
      ),
    );
    prisma.todo.findFirst.mockImplementation(
      async ({ where }: { where: { title: { contains: string } } }) =>
        where.title.contains.includes('ghost-a') ? { id: 'todo-existing' } : null,
    );

    const result = await cron.tick();

    expect(result.todosCreated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(sentryCalls(ROW_ALERT_MSG)).toHaveLength(0);
  });

  it('ไม่มี SYSTEM user → log + ไม่ throw (Sentry ยังยิงเตือน)', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    const result = await cron.tick();

    expect(result.enabled).toBe(true);
    expect(result.flagged).toBe(2);
    expect(result.todosCreated).toBe(0);
    expect(result.skipped).toBe(2);
    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(sentryCalls(ROW_ALERT_MSG)).toHaveLength(2);
  });

  it('Todo แถวเดียวพัง → นับ skipped + แถวอื่นยังทำงาน + ไม่ throw', async () => {
    prisma.todo.create
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ id: 'todo-2' });

    const result = await cron.tick();

    expect(result.flagged).toBe(2);
    expect(result.todosCreated).toBe(1);
    expect(result.skipped).toBe(1);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('service พัง → Sentry.captureException + ไม่ throw', async () => {
    aging.getShopReceivableAging.mockRejectedValue(new Error('sql exploded'));

    const result = await cron.tick();

    expect(result).toEqual({ enabled: false, flagged: 0, todosCreated: 0, skipped: 0 });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const opts = (Sentry.captureException as jest.Mock).mock.calls[0][1];
    expect(opts.tags.cron).toBe('shop-receivable-aging');
  });

  it('ไม่มีแถวเกินเกณฑ์ (และไม่มีหนี้ legacy) → ไม่สร้าง Todo ไม่ยิง Sentry', async () => {
    aging.getShopReceivableAging.mockResolvedValue(buildResult([fixtureRows()[2]], 30));

    const result = await cron.tick();

    expect(result).toEqual({ enabled: true, flagged: 0, todosCreated: 0, skipped: 0 });
    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    // SYSTEM user ไม่ต้องถูก query เมื่อไม่มีงาน
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('legacy ที่ล้างครบ (net = 0) → เงียบสนิท ไม่มี Sentry', async () => {
    // ขาล้างเครดิตอยู่คอลัมน์ SHOP_COLLECT ⇒ typed ค้าง +8,000/−8,000 แต่ net = 0
    const settledLegacy = makeRow({
      contractId: 'c-legacy-settled',
      contractNumber: 'CT-LEGACY-SETTLED',
      swapCreditGross: D('8000.00'),
      intercoNet: D('8000.00'),
      legacySwapGross: D('8000.00'),
      legacyOneBook: true,
      bookMismatch: true,
      intercoAgeDays: 400,
      shopCollect: D('-8000.00'),
      shopCollectAgeDays: 400,
    });
    aging.getShopReceivableAging.mockResolvedValue(buildResult([settledLegacy], 30));

    const result = await cron.tick();

    expect(result).toEqual({ enabled: true, flagged: 0, todosCreated: 0, skipped: 0 });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });

  it('legacy ที่ยังค้างจริง (net > 0) → Sentry รวมหนึ่งอีเวนต์ ไม่มี Todo รายแถว', async () => {
    // fixture มีแถว legacy ค้าง 8,000 + 1,771 = 9,771
    const result = await cron.tick();

    const legacyAlerts = sentryCalls(LEGACY_ALERT_MSG);
    expect(legacyAlerts).toHaveLength(1); // หนึ่งอีเวนต์ต่อ tick ไม่ใช่ต่อแถว
    const opts = legacyAlerts[0][1] as {
      level: string;
      tags: { subsystem: string };
      extra: { legacyRows: number; legacyOneBookNet: string };
    };
    expect(opts.level).toBe('warning');
    expect(opts.tags.subsystem).toBe('interco-netting');
    expect(opts.extra.legacyRows).toBe(1);
    expect(opts.extra.legacyOneBookNet).toBe('9771.00');

    // ยังไม่มี Todo ของแถว legacy (Todo ที่สร้าง = 2 แถว non-legacy เท่านั้น)
    expect(result.todosCreated).toBe(2);
    expect(JSON.stringify(prisma.todo.create.mock.calls)).not.toContain('CT-LEGACY');
  });

  it('Todo description ระบุวันที่ข้อมูล (BKK)', async () => {
    await cron.tick();

    const desc = prisma.todo.create.mock.calls[0][0].data.description as string;
    expect(desc).toContain('ข้อมูล ณ 2026-08-21');
  });

  it('threshold นอกช่วง 1-365 (ตรงกับ endpoint) → fallback 30', async () => {
    configValues['shop_receivable_aging_alert_days'] = '400';

    await cron.tick();

    expect(aging.getShopReceivableAging).toHaveBeenCalledWith(expect.any(Date), 30);
  });

  // ── final review Phase 4: Sentry ต้องเป็น alert ไม่ใช่ heartbeat รายวัน ──

  it('dedup hit → ไม่ยิง Sentry รายแถวซ้ำ (ลูกหนี้ที่รอรอบจ่ายตามปกติต้องไม่เตือนทุกวัน)', async () => {
    prisma.todo.findFirst.mockImplementation(
      async ({ where }: { where: { title: { contains: string } } }) =>
        where.title.contains === 'CT-INTERCO-OLD' ? { id: 'todo-existing' } : null,
    );

    const result = await cron.tick();

    expect(result.todosCreated).toBe(1);
    expect(result.skipped).toBe(1);
    const rowAlerts = sentryCalls(ROW_ALERT_MSG);
    expect(rowAlerts).toHaveLength(1);
    const text = JSON.stringify(rowAlerts);
    expect(text).not.toContain('CT-INTERCO-OLD');
    expect(text).toContain('CT-COLLECT-OLD');
  });

  it('ทุกแถวถูก dedup → ไม่มี Sentry รายแถวเลย (reconcile รายเดือนเป็นช่องทาง "ยังไม่หาย")', async () => {
    prisma.todo.findFirst.mockResolvedValue({ id: 'todo-existing' });

    const result = await cron.tick();

    expect(result.flagged).toBe(2);
    expect(result.todosCreated).toBe(0);
    expect(result.skipped).toBe(2);
    expect(sentryCalls(ROW_ALERT_MSG)).toHaveLength(0);
  });

  // ── แขน SHOP_COLLECT: กลุ่มที่จะยิงก่อนจริงบน prod ──

  it('แขน SHOP_COLLECT อย่างเดียว → flagged + Sentry ระบุแขน + วิธีล้างของแขนนั้น', async () => {
    const row = makeRow({
      contractId: 'c-collect-only',
      contractNumber: 'CT-COLLECT-ONLY',
      shopCollect: D('1771.00'),
      shopCollectAgeDays: 31,
      shopCollectOldestPostedAt: new Date('2026-07-21T00:00:00.000Z'),
    });
    aging.getShopReceivableAging.mockResolvedValue(buildResult([row], 30));

    const result = await cron.tick();

    expect(result.flagged).toBe(1);
    expect(result.todosCreated).toBe(1);

    const data = prisma.todo.create.mock.calls[0][0].data;
    expect(data.title).toContain('CT-COLLECT-ONLY');
    expect(data.title).toContain('หน้าร้านรับเงินแทน');
    expect(data.title).toContain('ค้างเกิน 31 วัน');
    expect(data.description).toContain('รับโอนจากหน้าร้าน');
    // ไม่มีแขน interco → ห้ามแนะนำวิธีล้างของแขนที่ไม่ได้ค้าง
    expect(data.description).not.toContain('หักกลบในรอบจ่าย');

    const rowAlerts = sentryCalls(ROW_ALERT_MSG);
    expect(rowAlerts).toHaveLength(1);
    const opts = rowAlerts[0][1] as {
      extra: { overdueArms: string; shopCollect: string; shopCollectAgeDays: number };
    };
    expect(opts.extra.overdueArms).toBe('SHOP_COLLECT');
    expect(opts.extra.shopCollect).toBe('1771.00');
    expect(opts.extra.shopCollectAgeDays).toBe(31);
  });

  it('แขน SHOP_COLLECT: อายุ = เกณฑ์พอดี → ค้าง, น้อยกว่าเกณฑ์ 1 วัน → ไม่ค้าง', async () => {
    const atThreshold = makeRow({
      contractId: 'c-at',
      contractNumber: 'CT-COLLECT-AT',
      shopCollect: D('1000.00'),
      shopCollectAgeDays: 30,
    });
    aging.getShopReceivableAging.mockResolvedValue(buildResult([atThreshold], 30));
    expect((await cron.tick()).flagged).toBe(1);

    prisma.todo.create.mockClear();
    const belowThreshold = makeRow({
      contractId: 'c-below',
      contractNumber: 'CT-COLLECT-BELOW',
      shopCollect: D('1000.00'),
      shopCollectAgeDays: 29,
    });
    aging.getShopReceivableAging.mockResolvedValue(buildResult([belowThreshold], 30));
    expect((await cron.tick()).flagged).toBe(0);
  });

  it('แขน SHOP_COLLECT: ยอด 0 แม้อายุเกินเกณฑ์ → ไม่ค้าง (อายุอย่างเดียวไม่ใช่หนี้)', async () => {
    const zeroAmount = makeRow({
      contractId: 'c-collect-zero',
      contractNumber: 'CT-COLLECT-ZERO',
      shopCollect: D('0.00'),
      shopCollectAgeDays: 120,
    });
    aging.getShopReceivableAging.mockResolvedValue(buildResult([zeroAmount], 30));

    const result = await cron.tick();

    expect(result.flagged).toBe(0);
    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(sentryCalls(ROW_ALERT_MSG)).toHaveLength(0);
  });
});
