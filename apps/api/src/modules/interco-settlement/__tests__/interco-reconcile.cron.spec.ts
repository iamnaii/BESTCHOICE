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
  ShopReceivableAgingRow,
  ShopReceivableAgingResult,
  PayablePairRow,
  TypedAccountDriftRow,
} from '../interco-aging.service';
import { IntercoPendingService } from '../interco-pending.service';
import {
  IntercoReconcileCron,
  RECONCILE_TODO_TAG,
  ReconcileFinding,
  ReconcileFindingKind,
} from '../crons/interco-reconcile.cron';

const D = (v: string | number) => new Prisma.Decimal(v);

const RECONCILE_MSG = 'Interco monthly reconcile mismatches';

function kinds(findings: ReconcileFinding[]): ReconcileFindingKind[] {
  return findings.map((f) => f.kind);
}

function ofKind(findings: ReconcileFinding[], kind: ReconcileFindingKind): ReconcileFinding[] {
  return findings.filter((f) => f.kind === kind);
}

/** แถวอายุลูกหนี้เปล่า — เทสต์เติมเฉพาะฟิลด์ที่สนใจ (ทุกยอด 0 = ปกติ) */
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

function makePair(partial: Partial<PayablePairRow>): PayablePairRow {
  const financedGl = partial.financedGl ?? D(0);
  const commissionGl = partial.commissionGl ?? D(0);
  const shopFinancedGl = partial.shopFinancedGl ?? D(0);
  const shopCommissionGl = partial.shopCommissionGl ?? D(0);
  const financedDiff = financedGl.minus(shopFinancedGl);
  const commissionDiff = commissionGl.minus(shopCommissionGl);
  const diff = financedDiff.plus(commissionDiff);
  const legacyNoShop =
    partial.legacyNoShop ?? (shopFinancedGl.abs().lte('0.01') && shopCommissionGl.abs().lte('0.01'));
  return {
    contractId: 'p-0',
    contractNumber: 'CT-P0',
    customerName: 'ลูกค้าทดสอบ',
    financedGl,
    commissionGl,
    shopFinancedGl,
    shopCommissionGl,
    legacyNoShop,
    financedDiff,
    commissionDiff,
    diff,
    mismatch: !legacyNoShop && diff.abs().gt('0.01'),
    ...partial,
  };
}

function makeAgingResult(rows: ShopReceivableAgingRow[]): ShopReceivableAgingResult {
  const zero = D(0);
  const nonLegacy = rows.filter((r) => !r.legacyOneBook);
  const legacy = rows.filter((r) => r.legacyOneBook);
  return {
    rows,
    asOf: new Date('2026-09-01T01:00:00.000Z'),
    totals: {
      intercoNet: nonLegacy.reduce((s, r) => s.plus(r.intercoNet), zero),
      shopCollect: nonLegacy.reduce((s, r) => s.plus(r.shopCollect), zero),
      overdueCount: 0,
      legacyOneBookNet: legacy.reduce((s, r) => s.plus(r.intercoNet).plus(r.shopCollect), zero),
    },
  };
}

/** drift row ที่ "ไม่เพี้ยน" (ยอดบัญชีอธิบายได้ครบด้วยเลนส์ − deduction) */
function cleanDrift(accountCode: string): TypedAccountDriftRow {
  return {
    accountCode,
    label: accountCode,
    accountTotal: D('3000.00'),
    lensTotal: D('11000.00'),
    settledDeduction: D('8000.00'),
    expected: D('3000.00'),
    drift: D(0),
    mismatch: false,
  };
}

describe('IntercoReconcileCron', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let aging: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pending: any;
  let cron: IntercoReconcileCron;
  let configValues: Record<string, string>;

  /** ตั้งข้อมูลของ tick หนึ่งรอบ (ค่า default = ทุกอย่างปกติ) */
  function setup(opts: {
    rows?: ShopReceivableAgingRow[];
    /** แถวติดลบ — คนละแหล่งกับ `rows` โดยเจตนา (ดู getNegativeTypedRows) */
    negatives?: ShopReceivableAgingRow[];
    pairs?: PayablePairRow[];
    phase2?: string[];
    drifts?: TypedAccountDriftRow[];
    pendingDrift?: Prisma.Decimal;
    openBatchGross?: Prisma.Decimal;
  }) {
    aging.getShopReceivableAging.mockResolvedValue(makeAgingResult(opts.rows ?? []));
    aging.getNegativeTypedRows.mockResolvedValue(opts.negatives ?? []);
    aging.getOpenBatchPayableGross.mockResolvedValue(opts.openBatchGross ?? D(0));
    aging.getPayablePairing.mockResolvedValue(opts.pairs ?? []);
    aging.getPhase2SwapContractIds.mockResolvedValue(new Set(opts.phase2 ?? []));
    aging.getTypedAccountDrift.mockResolvedValue(
      opts.drifts ?? [cleanDrift('11-2107'), cleanDrift('S21-3001')],
    );
    pending.getReconcileTotals.mockResolvedValue({
      pendingTotal: D('11000.00'),
      glFinanceTotal: D('11000.00'),
      glShopTotal: D('11000.00'),
      drift: opts.pendingDrift ?? D(0),
      glSwapCreditTotal: D(0),
      glRecallTotal: D(0),
      glShopBuybackTotal: D(0),
    });
  }

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
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'u-system' }) },
      todo: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'todo-1' }),
      },
    };

    aging = {
      getShopReceivableAging: jest.fn(),
      getNegativeTypedRows: jest.fn(),
      getOpenBatchPayableGross: jest.fn(),
      getPayablePairing: jest.fn(),
      getPhase2SwapContractIds: jest.fn(),
      getTypedAccountDrift: jest.fn(),
    };
    pending = { getReconcileTotals: jest.fn() };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        IntercoReconcileCron,
        { provide: PrismaService, useValue: prisma },
        { provide: IntercoAgingService, useValue: aging },
        { provide: IntercoPendingService, useValue: pending },
      ],
    }).compile();
    cron = mod.get(IntercoReconcileCron);

    setup({});
  });

  it('kill switch ปิด → ไม่อ่านข้อมูล ไม่สร้าง Todo ไม่ยิง Sentry', async () => {
    configValues['interco_reconcile_enabled'] = 'false';

    const result = await cron.tick();

    expect(result).toEqual({ enabled: false, findings: [], todoCreated: false });
    expect(aging.getShopReceivableAging).not.toHaveBeenCalled();
    expect(aging.getNegativeTypedRows).not.toHaveBeenCalled();
    expect(pending.getReconcileTotals).not.toHaveBeenCalled();
    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('ไม่มี SystemConfig → default เปิด', async () => {
    const result = await cron.tick();

    expect(result.enabled).toBe(true);
    expect(aging.getShopReceivableAging).toHaveBeenCalled();
  });

  it('ทุกอย่างปกติ → findings ว่าง ไม่สร้าง Todo ไม่ยิง Sentry', async () => {
    setup({
      rows: [
        // สัญญาปกติ: สองสมุดตรง ยังไม่ถูกหัก
        makeRow({
          contractId: 'c-ok',
          contractNumber: 'CT-OK',
          swapCreditGross: D('8000.00'),
          intercoNet: D('8000.00'),
          shopMirrorGross: D('8000.00'),
          shopMirrorNet: D('8000.00'),
        }),
      ],
      pairs: [
        makePair({
          contractId: 'c-ok',
          contractNumber: 'CT-OK',
          financedGl: D('10000.00'),
          commissionGl: D('1000.00'),
          shopFinancedGl: D('10000.00'),
          shopCommissionGl: D('1000.00'),
        }),
      ],
      phase2: ['c-ok'],
    });

    const result = await cron.tick();

    expect(result.enabled).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.todoCreated).toBe(false);
    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('BOOK_MISMATCH: สองสมุดไม่ตรงต่อสัญญา (carry e)', async () => {
    setup({
      rows: [
        makeRow({
          contractId: 'c-mismatch',
          contractNumber: 'CT-MISMATCH',
          payoutRecallGross: D('11000.00'),
          intercoNet: D('11000.00'),
          shopMirrorGross: D('10500.00'),
          shopMirrorNet: D('10500.00'),
          bookMismatch: true,
        }),
      ],
    });

    const result = await cron.tick();

    const found = ofKind(result.findings, 'BOOK_MISMATCH');
    expect(found).toHaveLength(1);
    expect(found[0].contractNumber).toBe('CT-MISMATCH');
    expect(found[0].amounts.intercoNet).toBe('11000.00');
    expect(found[0].amounts.shopMirrorNet).toBe('10500.00');
    expect(found[0].detail).toContain('CT-MISMATCH');
  });

  it('SWAP_CREDIT_ONE_BOOK: A.4 ยุค Phase 2 (มี newContractId) แต่ S21-3001 = 0 (carry c)', async () => {
    setup({
      rows: [
        makeRow({
          contractId: 'c-phase2',
          contractNumber: 'CT-PHASE2',
          swapCreditGross: D('8000.00'),
          intercoNet: D('8000.00'),
          shopMirrorGross: D(0),
          shopMirrorNet: D(0),
          bookMismatch: true,
        }),
      ],
      phase2: ['c-phase2'],
    });

    const result = await cron.tick();

    const found = ofKind(result.findings, 'SWAP_CREDIT_ONE_BOOK');
    expect(found).toHaveLength(1);
    expect(found[0].contractNumber).toBe('CT-PHASE2');
    expect(found[0].amounts.swapCreditGross).toBe('8000.00');
    expect(found[0].amounts.shopMirrorGross).toBe('0.00');

    // วินิจฉัยเฉพาะเจาะจงชนะ — ไม่รายงานซ้ำเป็น BOOK_MISMATCH บนสัญญาเดียวกัน
    expect(ofKind(result.findings, 'BOOK_MISMATCH')).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
  });

  it('legacy: swap ยุคก่อน Phase 1 (ไม่มี A.4 stamp) ค้างสมุดเดียว → ไม่เป็น finding เลย', async () => {
    setup({
      rows: [
        makeRow({
          contractId: 'c-legacy',
          contractNumber: 'CT-LEGACY',
          swapCreditGross: D('8000.00'),
          legacySwapGross: D('8000.00'),
          legacyOneBook: true,
          intercoNet: D('8000.00'),
          shopMirrorGross: D(0),
          shopMirrorNet: D(0),
          bookMismatch: true,
        }),
        // legacy ที่ล้างครบผ่าน shop-collect: typed columns +8,000/−8,000 แต่ยอดจริง 0
        makeRow({
          contractId: 'c-legacy-settled',
          contractNumber: 'CT-LEGACY-SETTLED',
          swapCreditGross: D('8000.00'),
          legacySwapGross: D('8000.00'),
          legacyOneBook: true,
          intercoNet: D('8000.00'),
          shopCollect: D('-8000.00'),
          bookMismatch: true,
        }),
      ],
      phase2: [], // ไม่มี A.4 ยุค Phase 2 บนสัญญาเหล่านี้
    });

    const result = await cron.tick();

    expect(result.findings).toEqual([]);
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });

  it('PAYABLE_PAIR_MISMATCH: เจ้าหนี้ FINANCE ≠ ลูกหนี้ SHOP + ข้ามสัญญา legacyNoShop', async () => {
    setup({
      pairs: [
        makePair({
          contractId: 'c-pair',
          contractNumber: 'CT-PAIR',
          financedGl: D('10000.00'),
          commissionGl: D('1000.00'),
          shopFinancedGl: D('10000.00'),
          shopCommissionGl: D(0), // ค่าคอมฝั่ง SHOP หายไป 1,000
        }),
        // legacyNoShop (activate ก่อน 2026-06-23) — สมุด SHOP ว่างเป็นเรื่องปกติ
        makePair({
          contractId: 'c-legacy-noshop',
          contractNumber: 'CT-LEGACY-NOSHOP',
          financedGl: D('19190.00'),
          commissionGl: D(0),
        }),
      ],
    });

    const result = await cron.tick();

    const found = ofKind(result.findings, 'PAYABLE_PAIR_MISMATCH');
    expect(found).toHaveLength(1);
    expect(found[0].contractNumber).toBe('CT-PAIR');
    expect(found[0].amounts.financeTotal).toBe('11000.00');
    expect(found[0].amounts.shopTotal).toBe('10000.00');
    expect(found[0].amounts.diff).toBe('1000.00');
    // ต่างเฉพาะขาค่าคอม → ติดป้ายรูปแบบที่รู้จัก (สัญญาไม่ระบุค่าคอม: 1A ตั้ง 10%)
    expect(found[0].amounts.financedDiff).toBe('0.00');
    expect(found[0].amounts.commissionDiff).toBe('1000.00');
    expect(found[0].detail).toContain('ต่างเฉพาะขาค่าคอม');
    expect(JSON.stringify(result.findings)).not.toContain('CT-LEGACY-NOSHOP');
  });

  it('PAYABLE_PAIR_MISMATCH: ต่างที่ขายอดจัด → ไม่ติดป้าย "ต่างเฉพาะขาค่าคอม"', async () => {
    setup({
      pairs: [
        makePair({
          contractId: 'c-pair-financed',
          contractNumber: 'CT-PAIR-FIN',
          financedGl: D('10000.00'),
          commissionGl: D('1000.00'),
          shopFinancedGl: D('9000.00'),
          shopCommissionGl: D('1000.00'),
        }),
      ],
    });

    const result = await cron.tick();

    const found = ofKind(result.findings, 'PAYABLE_PAIR_MISMATCH');
    expect(found).toHaveLength(1);
    expect(found[0].amounts.financedDiff).toBe('1000.00');
    expect(found[0].amounts.commissionDiff).toBe('0.00');
    expect(found[0].detail).not.toContain('ต่างเฉพาะขาค่าคอม');
  });

  it('NEGATIVE_TYPED: หักเกินแบบสมมาตร อ่านจาก getNegativeTypedRows ไม่ใช่ rows (C1 — ตาข่ายของ carry d)', async () => {
    setup({
      // รายงานหลัก **ว่างเปล่า** — เคสหักเกินสมมาตรถูก isReportableAgingRow
      // กรองทิ้งตั้งแต่ใน service (bookMismatch = false, ไม่มียอดบวก)
      rows: [],
      negatives: [
        makeRow({
          contractId: 'c-neg',
          contractNumber: 'CT-NEG',
          payoutRecallGross: D('11000.00'),
          settledDeduction: D('14000.00'),
          intercoNet: D('-3000.00'),
          shopMirrorGross: D('11000.00'),
          shopMirrorNet: D('-3000.00'),
        }),
      ],
    });

    const result = await cron.tick();

    const found = ofKind(result.findings, 'NEGATIVE_TYPED');
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found.every((f) => f.contractNumber === 'CT-NEG')).toBe(true);
    expect(JSON.stringify(found)).toContain('-3000.00');
  });

  it('NEGATIVE_TYPED: แถว legacy ที่ล้างเกิน → จับด้วยยอดสุทธิรวม (carry ก — กันหักล้างในผลรวมรายวัน)', async () => {
    setup({
      negatives: [
        makeRow({
          contractId: 'c-legacy-over',
          contractNumber: 'CT-LEGACY-OVER',
          swapCreditGross: D('8000.00'),
          legacySwapGross: D('8000.00'),
          legacyOneBook: true,
          intercoNet: D('8000.00'),
          shopCollect: D('-13000.00'), // ล้างเกินไป 5,000
          bookMismatch: true,
        }),
      ],
    });

    const result = await cron.tick();

    const found = ofKind(result.findings, 'NEGATIVE_TYPED');
    expect(found).toHaveLength(1);
    expect(found[0].contractNumber).toBe('CT-LEGACY-OVER');
    expect(JSON.stringify(found[0].amounts)).toContain('-5000.00');
  });

  it('ACCOUNT_DRIFT: drift ของคิวรอจ่าย + ยอดบัญชี typed ที่เลนส์อธิบายไม่ได้ (carry ข)', async () => {
    setup({
      pendingDrift: D('19190.00'),
      drifts: [
        {
          accountCode: '11-2107',
          label: 'ลูกหนี้-หน้าร้าน',
          accountTotal: D('0.00'),
          lensTotal: D('8000.00'),
          settledDeduction: D('0.00'),
          expected: D('8000.00'),
          drift: D('-8000.00'),
          mismatch: true,
        },
        cleanDrift('S21-3001'),
      ],
    });

    const result = await cron.tick();

    const found = ofKind(result.findings, 'ACCOUNT_DRIFT');
    expect(found).toHaveLength(2);
    expect(found.some((f) => f.detail.includes('11-2107'))).toBe(true);
    // ขาคิวรอจ่าย: ไม่มีรอบค้างอนุมัติ ⇒ residual = drift ดิบ
    expect(found.some((f) => f.amounts.residual === '19190.00')).toBe(true);
    expect(found.some((f) => f.amounts.drift === '-8000.00')).toBe(true);
    // ระดับบัญชี — ไม่มี contractId
    expect(found.every((f) => f.contractId === undefined)).toBe(true);
  });

  it('เกณฑ์ไม่ผูกกับ threshold รายวัน (carry ค): แถวอายุ 1 วันที่ผิดปกติก็ยังเป็น finding', async () => {
    setup({
      rows: [
        makeRow({
          contractId: 'c-fresh',
          contractNumber: 'CT-FRESH',
          swapCreditGross: D('8000.00'),
          intercoNet: D('8000.00'),
          shopMirrorGross: D('7500.00'),
          shopMirrorNet: D('7500.00'),
          bookMismatch: true,
          intercoAgeDays: 1,
        }),
      ],
    });

    const result = await cron.tick();

    expect(kinds(result.findings)).toEqual(['BOOK_MISMATCH']);
    // ไม่อ่านคีย์ threshold ของ cron รายวันเลย
    const readKeys = prisma.systemConfig.findFirst.mock.calls.map(
      (c: [{ where: { key: string } }]) => c[0].where.key,
    );
    expect(readKeys).not.toContain('shop_receivable_aging_alert_days');
  });

  it('I2: drift ที่อธิบายได้ด้วยรอบค้างอนุมัติ → ไม่เป็น finding (สภาพปกติ ไม่ใช่ JE หาย)', async () => {
    // รอบ PENDING_APPROVAL จองสัญญาไว้แล้ว (หลุดจาก pendingTotal) แต่ยังไม่โพสต์ JE
    // ⇒ drift = −(ยอดของรอบนั้น) พอดี — เตือนคือเตือนเท็จ
    setup({ pendingDrift: D('-11000.00'), openBatchGross: D('11000.00') });

    const result = await cron.tick();

    expect(result.findings).toEqual([]);
    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('I2: drift ที่เหลือหลังบวกกลับรอบค้าง → เป็น finding พร้อมยอดที่บวกกลับ', async () => {
    setup({ pendingDrift: D('-15000.00'), openBatchGross: D('11000.00') });

    const result = await cron.tick();

    const found = ofKind(result.findings, 'ACCOUNT_DRIFT');
    expect(found).toHaveLength(1);
    expect(found[0].amounts.openBatchGross).toBe('11000.00');
    expect(found[0].amounts.residual).toBe('-4000.00');
    expect(found[0].amounts.rawDrift).toBe('-15000.00');
    expect(found[0].detail).toContain('รอบที่ค้างอนุมัติ');
  });

  it('I3: known-pattern (ค่าคอมสมุดเดียว) ยุบเป็นบรรทัดสรุปเดียว ไม่กินโควตา 20 บรรทัด', async () => {
    const pairs = Array.from({ length: 25 }, (_, i) =>
      makePair({
        contractId: `c-comm-${i}`,
        contractNumber: `CT-COMM-${String(i).padStart(2, '0')}`,
        financedGl: D('10000.00'),
        commissionGl: D('1000.00'),
        shopFinancedGl: D('10000.00'),
        shopCommissionGl: D(0),
      }),
    );
    setup({
      pairs,
      rows: [
        makeRow({
          contractId: 'c-real',
          contractNumber: 'CT-REAL',
          intercoNet: D('11000.00'),
          shopMirrorGross: D('10500.00'),
          shopMirrorNet: D('10500.00'),
          bookMismatch: true,
        }),
      ],
    });

    const result = await cron.tick();

    // ยังนับเป็น finding ครบทุกใบ (ห้ามซ่อน — เป็นส่วนต่างจริงตาม F4/§11)
    expect(result.findings).toHaveLength(26);
    expect(ofKind(result.findings, 'PAYABLE_PAIR_MISMATCH')).toHaveLength(25);

    const data = prisma.todo.create.mock.calls[0][0].data;
    const bullets: string[] = data.description
      .split('\n')
      .filter((l: string) => l.trim().startsWith('•'));
    // finding จริงต้องอยู่ในบรรทัดแรก ๆ ไม่ถูกดันไป "และอีก N"
    expect(bullets[0]).toContain('CT-REAL');
    // 25 ใบของรูปแบบที่รู้จักไม่กินโควตารายบรรทัด
    expect(bullets).toHaveLength(1);
    // ไม่มีการตัดบรรทัดรายการ (คนละอันกับ "และอีก N สัญญา" ของรายชื่อในบรรทัดสรุป)
    expect(data.description).not.toMatch(/และอีก \d+ รายการ/);
    expect(data.description).toContain('รูปแบบสัญญาไม่ระบุค่าคอม: 25 สัญญา');
    expect(data.description).toContain('25,000.00');

    // Sentry นับแยก ไม่ปนกับ kind ปกติ
    const opts = (Sentry.captureMessage as jest.Mock).mock.calls[0][1] as {
      extra: Record<string, unknown>;
    };
    expect(opts.extra.patternCommissionOnly).toBe(25);
    expect(opts.extra.patternCommissionOnlyTotal).toBe('25000.00');
  });

  it('I3: เรียงตามความรุนแรงก่อนตัด (ยอดติดลบขึ้นก่อนสองสมุดไม่ตรง)', async () => {
    setup({
      rows: [
        makeRow({
          contractId: 'c-mm',
          contractNumber: 'CT-MM',
          intercoNet: D('11000.00'),
          shopMirrorGross: D('10500.00'),
          shopMirrorNet: D('10500.00'),
          bookMismatch: true,
        }),
      ],
      negatives: [
        makeRow({
          contractId: 'c-neg2',
          contractNumber: 'CT-NEG2',
          // ติดลบช่องเดียว → หนึ่ง finding ต่อแถว เทียบลำดับบรรทัดได้ตรงตัว
          shopMirrorNet: D('-500.00'),
        }),
      ],
    });

    const result = await cron.tick();

    const data = prisma.todo.create.mock.calls[0][0].data;
    const bullets: string[] = data.description
      .split('\n')
      .filter((l: string) => l.trim().startsWith('•'));
    expect(bullets[0]).toContain('CT-NEG2');
    expect(bullets[1]).toContain('CT-MM');
  });

  it('minor fold: ย้ายเงินระหว่างขายอดจัด↔ค่าคอม (diff รวม = 0) ยังต้องเป็น finding', async () => {
    setup({
      pairs: [
        makePair({
          contractId: 'c-swapleg',
          contractNumber: 'CT-SWAPLEG',
          financedGl: D('11000.00'),
          commissionGl: D(0),
          shopFinancedGl: D('10000.00'),
          shopCommissionGl: D('1000.00'),
          // service คำนวณ mismatch ต่อขา — spec จำลองพฤติกรรมนั้น
          mismatch: true,
        }),
      ],
    });

    const result = await cron.tick();

    const found = ofKind(result.findings, 'PAYABLE_PAIR_MISMATCH');
    expect(found).toHaveLength(1);
    expect(found[0].amounts.diff).toBe('0.00');
    expect(found[0].amounts.financedDiff).toBe('1000.00');
    expect(found[0].amounts.commissionDiff).toBe('-1000.00');
    // ไม่ใช่รูปแบบ "ค่าคอมสมุดเดียว" → ต้องไม่ถูกยุบเป็นบรรทัดสรุป
    expect(found[0].detail).not.toContain('ต่างเฉพาะขาค่าคอม');
    const data = prisma.todo.create.mock.calls[0][0].data;
    expect(data.description).toContain('CT-SWAPLEG');
  });

  it('มี findings → Todo หนึ่งใบต่อเดือน HIGH + tag + Sentry warning สรุปต่อ kind', async () => {
    setup({
      rows: [
        makeRow({
          contractId: 'c-mismatch',
          contractNumber: 'CT-MISMATCH',
          intercoNet: D('11000.00'),
          shopMirrorGross: D('10500.00'),
          shopMirrorNet: D('10500.00'),
          bookMismatch: true,
        }),
      ],
      pendingDrift: D('19190.00'),
    });

    const result = await cron.tick();

    expect(result.findings).toHaveLength(2);
    expect(result.todoCreated).toBe(true);
    expect(prisma.todo.create).toHaveBeenCalledTimes(1);

    const data = prisma.todo.create.mock.calls[0][0].data;
    expect(data.priority).toBe('HIGH');
    expect(data.tags).toEqual([RECONCILE_TODO_TAG]);
    expect(data.createdById).toBe('u-system');
    expect(data.title).toMatch(/^กระทบยอดระหว่างกิจการ \d{4}-\d{2} พบ 2 รายการไม่ตรง$/);
    expect(data.description).toContain('CT-MISMATCH');
    expect(data.description).toContain('19,190.00');

    const calls = (Sentry.captureMessage as jest.Mock).mock.calls.filter(
      (c) => c[0] === RECONCILE_MSG,
    );
    expect(calls).toHaveLength(1);
    const opts = calls[0][1] as {
      level: string;
      tags: { subsystem: string };
      extra: Record<string, unknown>;
    };
    expect(opts.level).toBe('warning');
    expect(opts.tags.subsystem).toBe('interco-netting');
    expect(opts.extra.total).toBe(2);
    expect(opts.extra.BOOK_MISMATCH).toBe(1);
    expect(opts.extra.ACCOUNT_DRIFT).toBe(1);
  });

  it('description ตัดที่ 20 บรรทัดแรก + บอก "และอีก N รายการ"', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      makeRow({
        contractId: `c-${i}`,
        contractNumber: `CT-${String(i).padStart(2, '0')}`,
        intercoNet: D('1000.00'),
        shopMirrorGross: D('900.00'),
        shopMirrorNet: D('900.00'),
        bookMismatch: true,
      }),
    );
    setup({ rows });

    const result = await cron.tick();

    expect(result.findings).toHaveLength(25);
    const data = prisma.todo.create.mock.calls[0][0].data;
    const bullets = data.description
      .split('\n')
      .filter((l: string) => l.trim().startsWith('•'));
    expect(bullets).toHaveLength(20);
    expect(data.description).toContain('และอีก 5 รายการ');
  });

  it('dedup: มี Todo ของเดือนนี้ค้างอยู่ → ไม่สร้างซ้ำ (title contains yyyy-mm + tag + ยังไม่ DONE)', async () => {
    setup({ pendingDrift: D('100.00') });
    prisma.todo.findFirst.mockResolvedValue({ id: 'todo-existing' });

    const result = await cron.tick();

    expect(result.findings).toHaveLength(1);
    expect(result.todoCreated).toBe(false);
    expect(prisma.todo.create).not.toHaveBeenCalled();

    const where = prisma.todo.findFirst.mock.calls[0][0].where;
    expect(where.tags).toEqual({ has: RECONCILE_TODO_TAG });
    expect(where.status).toEqual({ not: 'DONE' });
    expect(where.deletedAt).toBeNull();
    expect(where.title.contains).toMatch(/^\d{4}-\d{2}$/);
    // Sentry ยังยิงแม้ dedup — ปัญหายังอยู่จริง
    expect((Sentry.captureMessage as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('ไม่มี SYSTEM user → ไม่ throw, ไม่สร้าง Todo, Sentry ยังยิง', async () => {
    setup({ pendingDrift: D('100.00') });
    prisma.user.findFirst.mockResolvedValue(null);

    const result = await cron.tick();

    expect(result.enabled).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.todoCreated).toBe(false);
    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect((Sentry.captureMessage as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('Todo สร้างไม่สำเร็จ → captureException + ไม่ throw (findings ยังคืนครบ)', async () => {
    setup({ pendingDrift: D('100.00') });
    prisma.todo.create.mockRejectedValue(new Error('db down'));

    const result = await cron.tick();

    expect(result.findings).toHaveLength(1);
    expect(result.todoCreated).toBe(false);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('service พัง → captureException + ไม่ throw ออกจาก tick', async () => {
    aging.getShopReceivableAging.mockRejectedValue(new Error('sql exploded'));

    const result = await cron.tick();

    expect(result).toEqual({ enabled: false, findings: [], todoCreated: false });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('ไม่แตะ GL — ไม่มีการเรียก journal/$transaction ใดๆ (รายงานอย่างเดียว)', async () => {
    setup({ pendingDrift: D('100.00') });

    await cron.tick();

    expect(prisma.journalEntry).toBeUndefined();
    expect(prisma.$transaction).toBeUndefined();
    // อ่านเท่าที่จำเป็น: config + system user + todo เท่านั้น
    expect(Object.keys(prisma)).toEqual(['systemConfig', 'user', 'todo']);
  });

  // ── final review Phase 4: finding ต้อง actionable (คนเอาไปทำต่อได้จริง) ──

  it('footer: มีเฉพาะ kind ที่อยู่บนแท็บ → ชี้แท็บอย่างเดียว ไม่มีคำเตือน "ไม่แสดงบนแท็บ"', async () => {
    setup({
      rows: [
        makeRow({
          contractId: 'c-mm',
          contractNumber: 'CT-MM',
          intercoNet: D('11000.00'),
          shopMirrorGross: D('10500.00'),
          shopMirrorNet: D('10500.00'),
          bookMismatch: true,
        }),
      ],
    });

    await cron.tick();

    const desc = prisma.todo.create.mock.calls[0][0].data.description as string;
    expect(desc).toContain('ตรวจที่หน้าจ่ายให้หน้าร้าน');
    expect(desc).not.toContain('ไม่แสดงบนแท็บ');
  });

  it('footer kind-aware: NEGATIVE_TYPED → ชี้แท็บ "กระทบยอด" (Phase 5 — มีหน้าจอแล้ว)', async () => {
    setup({
      negatives: [
        makeRow({
          contractId: 'c-neg',
          contractNumber: 'CT-NEG',
          intercoNet: D('-8000.00'),
          shopMirrorNet: D('-8000.00'),
        }),
      ],
    });

    const result = await cron.tick();

    expect(ofKind(result.findings, 'NEGATIVE_TYPED')).toHaveLength(2);
    const desc = prisma.todo.create.mock.calls[0][0].data.description as string;
    // Phase 5 ข้อ 1: over-settle มีหน้าจอแล้ว (แท็บ "กระทบยอด") — footer ต้องชี้
    // ให้ถูกแท็บ ไม่ใช่บอกว่า "ไม่แสดงบนแท็บ" เหมือนเดิม
    expect(desc).toContain('ตรวจที่หน้าจ่ายให้หน้าร้าน');
    expect(desc).toContain('กระทบยอด');
    expect(desc).toContain('ยอดติดลบ (ล้างเกิน)');
    expect(desc).not.toContain('ไม่แสดงบนแท็บ');
  });

  it('footer kind-aware: PAYABLE_PAIR_MISMATCH → ชี้แท็บ "กระทบยอด" (Phase 5 — มีหน้าจอแล้ว)', async () => {
    setup({
      pairs: [
        makePair({
          contractId: 'c-pair',
          contractNumber: 'CT-PAIR',
          financedGl: D('11000.00'),
          commissionGl: D(0),
          shopFinancedGl: D('10000.00'),
          shopCommissionGl: D('1000.00'),
          mismatch: true,
        }),
      ],
    });

    await cron.tick();

    const desc = prisma.todo.create.mock.calls[0][0].data.description as string;
    expect(desc).toContain('ตรวจที่หน้าจ่ายให้หน้าร้าน');
    expect(desc).toContain('กระทบยอด');
    expect(desc).toContain('เจ้าหนี้/ลูกหนี้รอบจ่ายไม่ตรงกัน');
    expect(desc).not.toContain('ไม่แสดงบนแท็บ');
  });

  it('footer kind-aware: ปนทั้งบนแท็บและนอกแท็บ (ACCOUNT_DRIFT = kind เดียวที่ไม่มีหน้าจอ) → มีทั้งสองบรรทัด', async () => {
    setup({
      rows: [
        makeRow({
          contractId: 'c-mm',
          contractNumber: 'CT-MM',
          intercoNet: D('11000.00'),
          shopMirrorGross: D('10500.00'),
          shopMirrorNet: D('10500.00'),
          bookMismatch: true,
        }),
      ],
      pendingDrift: D('19190.00'),
    });

    await cron.tick();

    const desc = prisma.todo.create.mock.calls[0][0].data.description as string;
    expect(desc).toContain('ตรวจที่หน้าจ่ายให้หน้าร้าน');
    expect(desc).toContain('ไม่แสดงบนแท็บ');
    expect(desc).toContain('ยอดบัญชีอธิบายไม่ได้');
  });

  it('กลุ่มที่ยุบ (ค่าคอมสมุดเดียว): เลขสัญญาต้องไปถึงคน — บรรทัดสรุป 10 ตัวแรก + Sentry extra', async () => {
    const pairs = Array.from({ length: 25 }, (_, i) =>
      makePair({
        contractId: `c-comm-${i}`,
        contractNumber: `CT-COMM-${String(i).padStart(2, '0')}`,
        financedGl: D('10000.00'),
        commissionGl: D('1000.00'),
        shopFinancedGl: D('10000.00'),
        shopCommissionGl: D(0),
      }),
    );
    setup({ pairs });

    await cron.tick();

    const desc = prisma.todo.create.mock.calls[0][0].data.description as string;
    expect(desc).toContain('CT-COMM-00');
    expect(desc).toContain('CT-COMM-09');
    expect(desc).not.toContain('CT-COMM-10');
    expect(desc).toContain('และอีก 15 สัญญา');
    // บรรทัดสรุปห้ามชี้ไปแท็บที่ไม่มีข้อมูลกลุ่มนี้อีกต่อไป
    expect(desc).not.toContain('ดูรายสัญญาที่แท็บ');

    const opts = (Sentry.captureMessage as jest.Mock).mock.calls[0][1] as {
      extra: Record<string, unknown>;
    };
    const numbers = opts.extra.patternCommissionOnlyContracts as string[];
    expect(numbers).toHaveLength(25);
    expect(numbers[0]).toBe('CT-COMM-00');
    expect(numbers[24]).toBe('CT-COMM-24');
  });

  it('กลุ่มที่ยุบ: ไม่เกิน 10 สัญญา → ลงครบทุกเลข ไม่มีคำว่า "และอีก"', async () => {
    const pairs = Array.from({ length: 3 }, (_, i) =>
      makePair({
        contractId: `c-comm-${i}`,
        contractNumber: `CT-COMM-${i}`,
        financedGl: D('10000.00'),
        commissionGl: D('1000.00'),
        shopFinancedGl: D('10000.00'),
        shopCommissionGl: D(0),
      }),
    );
    setup({ pairs });

    await cron.tick();

    const desc = prisma.todo.create.mock.calls[0][0].data.description as string;
    expect(desc).toContain('CT-COMM-0, CT-COMM-1, CT-COMM-2');
    expect(desc).not.toContain('และอีก');
  });
});
