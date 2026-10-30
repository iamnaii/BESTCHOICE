import { randomBytes } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { CARRY_FORWARD_ACCOUNTS } from '../opening';
import { CustomerPiiService } from '../../../modules/customers/customer-pii.service';
import { glContractBalance } from '../../../modules/journal/gl-contract-balance';
import { JournalAutoService } from '../../../modules/journal/journal-auto.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import { hashPII } from '../../../utils/pii.util';
import { TEST_NAME_PREFIX } from '../../../utils/test-data-markers';
import { legacyFileContentType, type LegacyFileDetail } from '../files';
import type { DumpRow } from '../dump-reader';
import type { LegacyContract } from '../legacy-book';
import type { PeakMatch } from '../peak-recon';
import { planImport, type ImportPlan } from '../plan-import';
import { writeLegacyImport, type WriteReport, type WriterDeps } from '../writer';
import {
  GATE_IDS,
  GATE_LABELS,
  loadContractGl,
  runGates,
  sampleForManualCheck,
  type GateOptions,
  type GateResult,
} from '../gates';
import {
  CUTOFF,
  MONTHLY,
  peakMatch,
  standardInstallments,
  syntheticBook,
  syntheticContract,
  syntheticMember,
  syntheticRecon,
  thaiId,
} from './synthetic-book';

/**
 * ด่านตรวจก่อนเปิดใช้ (Task 12 + รอบแก้ 1) — ข้อมูลสังเคราะห์ทั้งหมด (เลขสัญญา TEST-T12-<stamp>-…, เลขบัตรขึ้นต้น 09 ที่คำนวณหลักตรวจเอง,
 * เบอร์ 0975…, IMEI 35997…) · ทุกเทสต์เขียนแผนด้วย `writeLegacyImport` ในธุรกรรมแล้ว rollback (ไม่มีแถวค้าง) ·
 * แถวนอกธุรกรรมมีแค่สาขา + ผู้ใช้ระบบ (ลบใน afterAll)
 *
 * รัน: DATABASE_URL=<ฐานทดสอบ test_db หรือ *_test> npx jest <ไฟล์นี้> --runInBand · PII_* สุ่มในสเปค · ไม่มี DATABASE_URL = ข้ามส่วนฐาน
 */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const TX = { timeout: 120_000, maxWait: 20_000 };
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

class Rollback extends Error {
  constructor(readonly value: unknown) {
    super('rollback');
  }
}

const failing = (results: GateResult[]) => results.filter((r) => !r.pass).map((r) => r.id);
const gate = (results: GateResult[], id: GateResult['id']) =>
  results.find((r) => r.id === id) as GateResult;

/** สัญญาสังเคราะห์สำหรับแผนใหญ่ (ด่าน 6.8 สุ่ม) — ไม่แตะฐาน */
function samplingPlan(): ImportPlan {
  const contracts: LegacyContract[] = [];
  const members: DumpRow[] = [];
  const recon: Array<[LegacyContract, ReturnType<typeof peakMatch>]> = [];
  const full = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, { paid: MONTHLY }]));
  let seq = 0;
  const add = (kind: 'overdue' | 'regular' | 'payoff' | 'canceled' | 'old', count: number) => {
    for (let k = 0; k < count; k++) {
      const n = ++seq;
      const id = String(1000 + n);
      const code = `TEST-T12S-${kind}-${n}`;
      const memberId = `M${n}`;
      members.push(
        syntheticMember({
          id: memberId,
          code: `TEST-T12SM-${n}`,
          nationalId: thaiId(`0912${String(n).padStart(8, '0')}`),
          phone: `0975${String(n).padStart(6, '0')}`,
        }),
      );
      let c: LegacyContract;
      if (kind === 'overdue') {
        c = syntheticContract({
          id,
          code,
          date: '2026-01-05',
          memberId,
          firstDue: [2026, 1, 5],
          installments: standardInstallments(full(8)),
        });
      } else if (kind === 'regular') {
        c = syntheticContract({
          id,
          code,
          date: '2026-08-10',
          memberId,
          firstDue: [2026, 8, 10],
          installments: standardInstallments(full(3)),
        });
      } else if (kind === 'payoff') {
        c = syntheticContract({
          id,
          code,
          statusCode: '3',
          date: '2025-06-01',
          memberId,
          firstDue: [2025, 6, 1],
          installments: standardInstallments(full(6)),
          close: { amount: '7500', discount: '1595', date: new Date('2026-01-15T11:00:00+07:00') },
        });
      } else if (kind === 'canceled') {
        c = syntheticContract({
          id,
          code,
          statusCode: '4',
          date: '2026-01-01',
          memberId,
          firstDue: [2026, 0, 1],
          installments: standardInstallments(full(2)),
        });
      } else {
        c = syntheticContract({
          id,
          code,
          date: '2025-10-20',
          memberId,
          firstDue: [2025, 10, 20],
          installments: standardInstallments(full(11)),
        });
      }
      contracts.push(c);
      if (kind === 'overdue' || kind === 'regular' || kind === 'old') {
        recon.push([c, peakMatch(c, `T12S${n}`)]);
      }
    }
  };
  add('overdue', 8);
  add('regular', 8);
  add('payoff', 5);
  add('canceled', 5);
  add('old', 5);
  const plan = planImport(syntheticBook(contracts, members), {
    cutoff: CUTOFF,
    peakRecon: syntheticRecon(recon),
    moneyOverrides: new Map(),
    customerOverrides: new Map(),
  });
  expect(plan.blockers).toEqual([]);
  // สัญญายกเลิก (สถานะ 4) ไม่นำเข้า — ไม่อยู่ในแผน จึงสุ่มไม่ถึง
  expect(plan.skipped.map((x) => x.reason)).toEqual(Array(5).fill('status-4-canceled'));
  return plan;
}

describe('sampleForManualCheck (6.8 — pure)', () => {
  let plan: ImportPlan;
  beforeAll(() => {
    plan = samplingPlan();
  });
  const kindOf = (code: string) => code.split('-')[2];
  const strata = {
    overdue: (code: string) =>
      plan.items.some((i) => i.code === code && i.kind === 'ACTIVE' && i.status === 'OVERDUE'),
    payoff: (code: string) => kindOf(code) === 'payoff',
    old: (code: string) => plan.items.some((i) => i.code === code && i.oldForm),
  };

  it('20 unique plan codes, deterministic for a seed, covering every stratum, never a canceled contract', () => {
    expect(plan.items).toHaveLength(26);
    const a = sampleForManualCheck(plan, 20, 'seed-a');
    expect(a).toHaveLength(20);
    expect(new Set(a).size).toBe(20);
    expect(a.every((code) => plan.items.some((i) => i.code === code))).toBe(true);
    expect(sampleForManualCheck(plan, 20, 'seed-a')).toEqual(a);
    for (const test of Object.values(strata)) {
      expect(a.filter(test).length).toBeGreaterThanOrEqual(4);
    }
    expect(a.some((code) => kindOf(code) === 'canceled')).toBe(false);
    expect(sampleForManualCheck(plan, 20, 'seed-b')).not.toEqual(a);
  });

  it('n = 4 still covers every stratum · default seed is deterministic · n ≥ plan = all · n ≤ 0 = none', () => {
    for (const seed of ['x', 'y', 'z']) {
      const four = sampleForManualCheck(plan, 4, seed);
      expect(four).toHaveLength(4);
      for (const test of Object.values(strata)) expect(four.some(test)).toBe(true);
    }
    expect(sampleForManualCheck(plan)).toEqual(sampleForManualCheck(plan));
    expect(sampleForManualCheck(plan)).toHaveLength(20);
    expect(sampleForManualCheck(plan, 100, 's').sort()).toEqual(
      plan.items.map((i) => i.code).sort(),
    );
    expect(sampleForManualCheck(plan, 0, 's')).toEqual([]);
  });
});

describe('gate ids and labels', () => {
  it('every gate has a Thai label; 6.8 is the manual sample (not a DB gate)', () => {
    expect([...GATE_IDS]).toEqual(['6.1', '6.2', '6.3', '6.4', '6.5', '6.6', '6.7', '6.9', '6.10']);
    for (const id of GATE_IDS) expect(GATE_LABELS[id]).toMatch(/[ก-๙]/);
  });
});

describeDb('runGates (real DB, inside the import transaction)', () => {
  let prisma: PrismaClient;
  let pii: CustomerPiiService;
  const saved = { key: process.env.PII_ENCRYPTION_KEY, salt: process.env.PII_HASH_SALT };
  const KEY = randomBytes(32).toString('hex');
  const SALT = randomBytes(16).toString('hex');
  const stamp = Date.now().toString(36).toUpperCase();
  const code = (n: number) => `TEST-T12-${stamp}-${n}`;

  let financeCompanyId = '';
  let createdCompanyId: string | null = null;
  let branchId = '';
  let userId = '';

  let plan: ImportPlan;
  let planWithFiles: ImportPlan;
  const peakCodes: string[] = [];
  let files: Map<string, LegacyFileDetail>;
  let missingPath = '';
  const phones: string[] = [];
  const nationalIds: string[] = [];
  const c: Record<
    'overdue' | 'payoff' | 'prepaid' | 'old' | 'completed' | 'canceled',
    LegacyContract
  > = {} as never;

  beforeAll(async () => {
    const dbName = new URL(process.env.DATABASE_URL as string).pathname.slice(1);
    if (!/^test_db$|_test$/.test(dbName)) {
      throw new Error(
        `สเปคนี้เขียนแถวจริง — ต้องรันกับฐานทดสอบ (test_db หรือ *_test) แต่ได้ "${dbName}"`,
      );
    }
    process.env.PII_ENCRYPTION_KEY = KEY;
    process.env.PII_HASH_SALT = SALT;
    prisma = new PrismaClient();
    await prisma.$connect();
    pii = new CustomerPiiService(prisma as unknown as PrismaService);

    await seedFinanceCoa(prisma);
    const finance = await prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (finance) financeCompanyId = finance.id;
    else {
      const created = await prisma.companyInfo.create({
        data: {
          nameTh: `${TEST_NAME_PREFIX} FINANCE T12`,
          taxId: '0000000000000',
          companyCode: 'FINANCE',
          address: '1 Test Rd.',
          directorName: `${TEST_NAME_PREFIX} กรรมการ`,
        },
      });
      financeCompanyId = created.id;
      createdCompanyId = created.id;
    }
    branchId = (
      await prisma.branch.create({
        data: { name: `${TEST_NAME_PREFIX} T12 ${stamp}`, companyId: financeCompanyId },
      })
    ).id;
    userId = (
      await prisma.user.create({
        data: {
          email: `t12-${stamp.toLowerCase()}@bestchoice-test.internal`,
          password: 'hashed_placeholder',
          name: `${TEST_NAME_PREFIX} ย้ายจากระบบเก่า T12`,
          role: 'OWNER',
          branchId,
        },
      })
    ).id;

    const hash = (v: string) => hashPII(v, SALT);
    for (let i = 0; i < 5; i++) {
      let phone = '';
      for (let t = 0; t < 20 && !phone; t++) {
        const p = `0975${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
        const taken = await prisma.customer.count({
          where: { OR: [{ phone: p }, { phoneHash: hash(p) }] },
        });
        if (taken === 0 && !phones.includes(p)) phone = p;
      }
      let nid = '';
      for (let t = 0; t < 20 && !nid; t++) {
        const id = thaiId(`09${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`);
        const taken =
          (await prisma.customer.count({
            where: { OR: [{ nationalId: id }, { nationalIdHash: hash(id) }] },
          })) + (await prisma.contact.count({ where: { nationalIdHash: hash(id) } }));
        if (taken === 0 && !nationalIds.includes(id)) nid = id;
      }
      if (!phone || !nid) throw new Error('หาเบอร์/เลขบัตรทดสอบที่ว่างไม่ได้');
      phones.push(phone);
      nationalIds.push(nid);
    }
    const members = Array.from({ length: 5 }, (_, i) =>
      syntheticMember({
        id: `12${i + 1}`,
        code: `TEST-T12M-${stamp}-${i + 1}`,
        nationalId: nationalIds[i],
        phone: phones[i],
        name: `${TEST_NAME_PREFIX} T12 สมาชิก`,
      }),
    );
    const imei = () => `35997${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`;
    const full = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, { paid: MONTHLY }]));
    // (1) ผ่อนอยู่ ค้าง: งวด 1–8 ครบ · 9 จ่ายบางส่วน (ถึงกำหนด) · 10 ค้าง · 11 จ่ายล่วงหน้าบางส่วน · 12 ยังไม่ถึง
    c.overdue = syntheticContract({
      id: '1201',
      code: code(1),
      date: '2026-01-05',
      memberId: '121',
      firstDue: [2026, 1, 5],
      imei: imei(),
      installments: standardInstallments({
        ...full(8),
        9: { paid: '300' },
        11: { paid: '500', paidOn: new Date('2026-11-20T09:00:00+07:00') },
      }),
    });
    // (2) ปิดก่อนกำหนด (ประวัติ)
    c.payoff = syntheticContract({
      id: '1202',
      code: code(2),
      statusCode: '3',
      date: '2025-06-01',
      memberId: '122',
      firstDue: [2025, 6, 1],
      imei: imei(),
      installments: standardInstallments(full(6)),
      close: { amount: '7500', discount: '1595', date: new Date('2026-01-15T11:00:00+07:00') },
    });
    // (3) ผ่อนอยู่ จ่ายล่วงหน้าครบงวด — PEAK สูงกว่า 0.37 (เศษสตางค์บวกเข้างวด 12)
    c.prepaid = syntheticContract({
      id: '1203',
      code: code(3),
      date: '2026-08-10',
      memberId: '123',
      firstDue: [2026, 8, 10],
      imei: imei(),
      installments: standardInstallments(full(4)),
    });
    // (4) ฉบับเก่า ค้างงวดสุดท้าย — PEAK ต่ำกว่า 15.87 (ปรับลดตาม PEAK เป็นยอดจ่ายบางส่วน)
    c.old = syntheticContract({
      id: '1204',
      code: code(4),
      date: '2025-10-20',
      memberId: '124',
      firstDue: [2025, 10, 20],
      imei: imei(),
      installments: standardInstallments(full(11)),
    });
    // (5) ผ่อนจบ (ประวัติ) ไม่มีคู่ PEAK
    c.completed = syntheticContract({
      id: '1205',
      code: code(5),
      statusCode: '3',
      date: '2026-01-01',
      memberId: '125',
      firstDue: [2026, 0, 1],
      imei: imei(),
      installments: standardInstallments(full(2)),
    });
    // (6) ยกเลิก (สถานะ 4) ของสมาชิกที่ไม่มีสัญญาอื่น — ไม่นำเข้า (ข้าม) · สมาชิกนี้ไม่ได้แถวลูกค้า
    c.canceled = syntheticContract({
      id: '1206',
      code: code(6),
      statusCode: '4',
      date: '2026-02-01',
      memberId: '126',
      firstDue: [2026, 2, 1],
      imei: imei(),
      installments: standardInstallments(full(1)),
    });
    const outstanding = (x: LegacyContract) =>
      x.installments.reduce((s, i) => (i.balance.gt(0) ? s.plus(i.balance) : s), D(0));
    /** ยอดใบแจ้งหนี้ PEAK สูงกว่าผลรวมค่างวดเท่าเศษ (เศษของยอดผ่อนรวม — อธิบายเศษสตางค์ที่บวกเข้างวดสุดท้ายได้) */
    const withGross = (m: PeakMatch, extra: string): PeakMatch => ({
      ...m,
      invoice: { ...m.invoice, netAmount: m.invoice.netAmount.plus(extra) },
      grossDiff: m.grossDiff.plus(extra),
    });
    peakCodes.push(...['A', 'B', 'C', 'D'].map((x) => `T12${x}${stamp}`));
    const canceledMember = syntheticMember({
      id: '126',
      code: `TEST-T12M-${stamp}-6`,
      nationalId: null,
      phone: null,
      name: `${TEST_NAME_PREFIX} T12 สมาชิก`,
    });
    const book = syntheticBook(
      [c.overdue, c.payoff, c.prepaid, c.old, c.completed, c.canceled],
      [...members, canceledMember],
    );
    const opts: Parameters<typeof planImport>[1] = {
      cutoff: CUTOFF,
      peakRecon: syntheticRecon([
        [c.overdue, peakMatch(c.overdue, peakCodes[0])],
        [c.payoff, peakMatch(c.payoff, peakCodes[1], '0')],
        [
          c.prepaid,
          withGross(
            peakMatch(c.prepaid, peakCodes[2], outstanding(c.prepaid).plus('0.37')),
            '0.37',
          ),
        ],
        [c.old, peakMatch(c.old, peakCodes[3], outstanding(c.old).minus('15.87'))],
      ]),
      moneyOverrides: new Map(),
      customerOverrides: new Map(),
    };
    plan = planImport(book, opts);
    expect(plan.blockers).toEqual([]);
    expect(plan.items.map((i) => [i.code, i.kind, i.status])).toEqual(
      expect.arrayContaining([
        [c.overdue.code, 'ACTIVE', 'OVERDUE'],
        [c.payoff.code, 'HISTORY', 'EARLY_PAYOFF'],
        [c.prepaid.code, 'ACTIVE', 'ACTIVE'],
        [c.old.code, 'ACTIVE', 'OVERDUE'],
        [c.completed.code, 'HISTORY', 'COMPLETED'],
      ]),
    );
    expect(plan.skipped).toEqual([{ code: c.canceled.code, reason: 'status-4-canceled' }]);
    expect(plan.items.some((i) => i.memberCode === canceledMember.member_code)).toBe(false);
    expect(plan.totals.satangGap.toFixed(2)).toBe('0.37');
    expect(plan.totals.peakAdjustment.toFixed(2)).toBe('-15.87');

    missingPath = `uploads/contract/TEST-${code(3)}.jpg`;
    files = new Map();
    for (const path of plan.items.flatMap((i) => i.attachmentPaths)) {
      if (path === missingPath) continue;
      files.set(path, {
        key: `legacy-import-test/${path}`,
        size: 2048,
        sha256: 'c'.repeat(64),
        contentType: legacyFileContentType(path),
      });
    }
    // แผนที่รู้ผลอัปโหลด (Task 13 ส่ง `files` ให้ planImport) — สัญญา 3 ขาดไฟล์สัญญาหนึ่งไฟล์
    planWithFiles = planImport(book, { ...opts, files });
    expect(planWithFiles.items.flatMap((i) => i.missingAttachments)).toEqual([missingPath]);
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    // ทุกอย่างของแผนถูก rollback — เหลือแค่ผู้ใช้/สาขา/บริษัทที่สร้างนอกธุรกรรม
    expect(
      await prisma.contract.count({
        where: { legacyContractCode: { startsWith: `TEST-T12-${stamp}` } },
      }),
    ).toBe(0);
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.branch.deleteMany({ where: { id: branchId } });
    if (createdCompanyId) await prisma.companyInfo.deleteMany({ where: { id: createdCompanyId } });
    await prisma.$disconnect();
    if (saved.key === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = saved.key;
    if (saved.salt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = saved.salt;
  }, 120_000);

  const journal = () => new JournalAutoService(prisma as unknown as PrismaService);

  function deps(override: Partial<WriterDeps> = {}): WriterDeps {
    return {
      journal: journal(),
      pii,
      financeCompanyId,
      branchId,
      systemUserId: userId,
      files,
      importBatch: `t12-${stamp.toLowerCase()}`,
      ...override,
    };
  }

  /** เขียนแผนในธุรกรรม → `fn` → rollback เสมอ · คืนค่าที่ `fn` คืน */
  async function inImport<T>(
    fn: (tx: Prisma.TransactionClient, report: WriteReport) => Promise<T>,
    setup: { plan?: ImportPlan; deps?: Partial<WriterDeps> } = {},
  ): Promise<T> {
    const outcome = await prisma
      .$transaction(async (tx) => {
        const report = await writeLegacyImport(tx, setup.plan ?? plan, deps(setup.deps));
        throw new Rollback(await fn(tx, report));
      }, TX)
      .then(
        () => new Error('expected a rollback'),
        (e: unknown) => e,
      );
    if (!(outcome instanceof Rollback)) throw outcome;
    return outcome.value as T;
  }

  /** ผลของด่านต้องไม่มีข้อมูลลูกค้า / id / รหัสผู้ติดต่อ PEAK / รหัสสมาชิก (ตรวจทุกเทสต์ รวม failures) */
  function expectNoCustomerData(results: GateResult[], report: WriteReport, extra: string[] = []) {
    const text = JSON.stringify(results);
    const forbidden = [
      ...phones,
      ...nationalIds,
      ...peakCodes,
      ...plan.items.map((i) => i.memberCode),
      ...report.customers.map((x) => x.customerId),
      ...report.contractIds.values(),
      TEST_NAME_PREFIX,
      ...extra,
    ];
    for (const value of forbidden) expect(text).not.toContain(value);
  }

  /**
   * เขียนแผน → `mutate` → `runGates` → rollback · ตรวจว่าผลไม่มีข้อมูลลูกค้า แล้วคืนผล
   * (`gateOpts.cutoff` = วันตัดที่ส่งให้ runGates — ค่าเริ่มต้น `CUTOFF`)
   */
  async function gatesAfter(
    mutate: (tx: Prisma.TransactionClient, report: WriteReport) => Promise<unknown>,
    setup: {
      plan?: ImportPlan;
      deps?: Partial<WriterDeps>;
      cutoff?: Date;
      gateOpts?: GateOptions;
      forbidden?: string[];
    } = {},
  ): Promise<GateResult[]> {
    const { results, report } = await inImport(async (tx, report) => {
      await mutate(tx, report);
      return {
        report,
        results: await runGates(
          tx,
          setup.plan ?? plan,
          report,
          setup.cutoff ?? CUTOFF,
          setup.gateOpts,
        ),
      };
    }, setup);
    expect(results.map((r) => r.id)).toEqual([...GATE_IDS]);
    expectNoCustomerData(results, report, setup.forbidden);
    return results;
  }

  const idOf = (report: WriteReport, legacy: LegacyContract) =>
    report.contractIds.get(legacy.code) as string;

  const scheduleRow = (tx: Prisma.TransactionClient, contractId: string, installmentNo: number) =>
    tx.installmentSchedule.findFirstOrThrow({ where: { contractId, installmentNo } });

  const post = (
    tx: Prisma.TransactionClient,
    contractId: string,
    postedAt: Date,
    metadata: Record<string, string>,
    lines: Array<[account: string, dr: string, cr: string]>,
  ) =>
    journal().createAndPost(
      {
        description: `${TEST_NAME_PREFIX} T12 รายการทดสอบ`,
        metadata: { contractId, ...metadata },
        lines: lines.map(([accountCode, dr, cr]) => ({ accountCode, dr: D(dr), cr: D(cr) })),
        postedAt,
        companyId: financeCompanyId,
        createdById: userId,
      },
      tx,
    );

  const codesOf = (results: GateResult[], id: GateResult['id']) =>
    [...new Set((gate(results, id).failures ?? []).map((f) => f.code))].sort();
  const detailsOf = (results: GateResult[], id: GateResult['id']) =>
    (gate(results, id).failures ?? []).map((f) => f.detail).join('\n');

  // ── ผ่านทุกด่าน ──────────────────────────────────────────────────────────────────────────────

  it('every gate passes on the freshly written book; details carry no customer data or ids', async () => {
    const results = await gatesAfter(async () => undefined, { gateOpts: { bookContracts: 6 } });
    expect(results.filter((r) => !r.pass)).toEqual([]);
    expect(gate(results, '6.1').detail).toMatch(/ข้าม 1 · ตัวบล็อก 0 · dump 6 · สร้าง 5 /);
    expect(results.every((r) => r.failures === undefined)).toBe(true);
    expect(gate(results, '6.2').detail).toContain('0.37');
    expect(gate(results, '6.2').detail).toContain('-15.87');
    expect(gate(results, '6.4').detail).toContain('0.37');
    expect(gate(results, '6.5').detail).toMatch(/ตั้งบางส่วน 1/);
    expect(gate(results, '6.10').detail).toMatch(/ผ่อนอยู่ 3 สัญญา/);
    expect(gate(results, '6.10').detail).toContain('การส่งผ่าน PEAK API ยังไม่กรอง');
  }, 120_000);

  it('6.1 — dump count ≠ plan count, or a cutoff other than plan.cutoff', async () => {
    expect(
      failing(await gatesAfter(async () => undefined, { gateOpts: { bookContracts: 7 } })),
    ).toEqual(['6.1']);
    const later = await gatesAfter(async () => undefined, {
      cutoff: new Date(CUTOFF.getTime() + 86_400_000),
    });
    expect(failing(later)).toEqual(['6.1']);
    expect(detailsOf(later, '6.1')).toContain('วันตัด');
  }, 120_000);

  it('a plan that knows the uploaded files: passes with planFiles; a file the writer dropped but the plan did not → 6.1', async () => {
    expect(
      failing(
        await gatesAfter(async () => undefined, {
          plan: planWithFiles,
          gateOpts: { planFiles: true },
        }),
      ),
    ).toEqual([]);
    const slip = c.overdue.receipts[0].slipPath as string;
    const dropped = new Map(files);
    dropped.delete(slip);
    const results = await gatesAfter(async () => undefined, {
      plan: planWithFiles,
      deps: { files: dropped },
      gateOpts: { planFiles: true },
    });
    expect(failing(results)).toEqual(['6.1']);
    expect(codesOf(results, '6.1')).toEqual([c.overdue.code]);
    expect(detailsOf(results, '6.1')).toMatch(/ไฟล์ที่แผนพบว่าหาย/);
  }, 120_000);

  it('a rerun report (every contract skippedExisting) passes; drifted rows of an existing contract still fail 6.1', async () => {
    const { again, clean, drifted } = await inImport(async (tx) => {
      const again = await writeLegacyImport(tx, plan, deps({ importBatch: 't12-rerun' }));
      const clean = await runGates(tx, plan, again, CUTOFF);
      const id = (
        await tx.contract.findUniqueOrThrow({ where: { legacyContractCode: c.overdue.code } })
      ).id;
      await tx.payment.updateMany({
        where: { contractId: id, installmentNo: 12 },
        data: { dueDate: new Date('2027-06-05T00:00:00+07:00') },
      });
      return { again, clean, drifted: await runGates(tx, plan, again, CUTOFF) };
    });
    expect(again.created.contracts).toBe(0);
    expect(again.skippedExisting.sort()).toEqual(plan.items.map((i) => i.code).sort());
    expect(clean.filter((r) => !r.pass)).toEqual([]);
    expect(gate(clean, '6.1').detail).toContain('มีอยู่แล้ว 5');
    expect(failing(drifted)).toEqual(['6.1']);
    expect(detailsOf(drifted, '6.1')).toContain('งวด 12: dueDate');
    expectNoCustomerData(drifted, again);
  }, 120_000);

  it('loadContractGl matches glContractBalance for every imported contract and carry-forward account', async () => {
    const mismatches = await inImport(async (tx, report) => {
      const ids = [...report.contractIds.values()];
      const gl = await loadContractGl(tx, ids);
      const out: string[] = [];
      for (const id of ids) {
        for (const account of [...CARRY_FORWARD_ACCOUNTS, '32-1101', '21-2101']) {
          const expected = await glContractBalance(tx, id, account, 'dr');
          const got = gl.get(id)?.get(account) ?? D(0);
          if (!got.eq(expected)) out.push(`${id} ${account} ${got} ≠ ${expected}`);
        }
      }
      return out;
    });
    expect(mismatches).toEqual([]);
  }, 120_000);

  // ── review probes P1–P7 (ข้อมูลรายแถวที่รอบกลางคืน / ใบรับชำระหลังวันตัดอ่าน) ────────────────────────

  it('P1 — accrued* of the partially prepaid future installment cleared → 6.5 (stamp) + 6.4 (2A run-off)', async () => {
    const results = await gatesAfter(async (tx, report) => {
      const row = await scheduleRow(tx, idOf(report, c.overdue), 11);
      await tx.installmentSchedule.update({
        where: { id: row.id },
        data: { accruedAmount: 0, accruedVat: 0, accruedInterest: 0 },
      });
    });
    expect(failing(results)).toEqual(['6.4', '6.5']);
    expect(detailsOf(results, '6.5')).toContain('งวด 11: accruedAmount');
    expect(codesOf(results, '6.4')).toEqual([c.overdue.code]);
  }, 120_000);

  it('P2 — accrualJournalEntryId stamped on a future unpaid installment → 6.5 (link iff accrued) + 6.4', async () => {
    const results = await gatesAfter(async (tx, report) => {
      const opening = report.journalEntries.find(
        (e) => e.kind === 'opening' && e.code === c.overdue.code,
      )!;
      const row = await scheduleRow(tx, idOf(report, c.overdue), 12);
      await tx.installmentSchedule.update({
        where: { id: row.id },
        data: { accrualJournalEntryId: opening.entryNumber },
      });
    });
    expect(failing(results)).toEqual(['6.4', '6.5']);
    expect(detailsOf(results, '6.5')).toMatch(
      /งวด 12: ยังตั้งลูกหนี้ไม่ครบแต่มี accrualJournalEntryId/,
    );
  }, 120_000);

  it('P3 — contract vatAmount +1.00 and storeCommission +5.00 → 6.1 (contract money) + 6.4 (2A run-off)', async () => {
    const results = await gatesAfter(async (tx, report) => {
      await tx.contract.update({
        where: { id: idOf(report, c.prepaid) },
        data: { vatAmount: { increment: 1 }, storeCommission: { increment: 5 } },
      });
    });
    expect(failing(results)).toEqual(['6.1', '6.4']);
    expect(detailsOf(results, '6.1')).toMatch(/vatAmount ในฐาน/);
    expect(detailsOf(results, '6.1')).toMatch(/storeCommission ในฐาน/);
    expect(codesOf(results, '6.4')).toEqual([c.prepaid.code]);
  }, 120_000);

  it('P4 — a marker pointing at another installment row → 6.4', async () => {
    const results = await gatesAfter(async (tx, report) => {
      const marker = report.journalEntries.find(
        (e) => e.kind === 'marker' && e.code === c.overdue.code && e.installmentNo === 9,
      )!;
      const other = await scheduleRow(tx, idOf(report, c.overdue), 10);
      const je = await tx.journalEntry.findUniqueOrThrow({ where: { id: marker.id } });
      await tx.journalEntry.update({
        where: { id: marker.id },
        data: { metadata: { ...(je.metadata as object), installmentScheduleId: other.id } },
      });
    });
    expect(failing(results)).toEqual(['6.4']);
    expect(detailsOf(results, '6.4')).toMatch(/ชี้งวด 10 ซึ่งแผนไม่มี marker/);
    expect(detailsOf(results, '6.4')).toMatch(/งวด 9: ไม่มี marker/);
  }, 120_000);

  it('P5 — 300 paid moved from installment 9 to 10 (sums unchanged) → 6.1 (payment rows) + 6.4 (marker ≠ amountPaid)', async () => {
    const results = await gatesAfter(async (tx, report) => {
      const id = idOf(report, c.overdue);
      await tx.payment.updateMany({
        where: { contractId: id, installmentNo: 9 },
        data: { amountPaid: { decrement: 300 }, status: 'OVERDUE' },
      });
      await tx.payment.updateMany({
        where: { contractId: id, installmentNo: 10 },
        data: { amountPaid: { increment: 300 }, status: 'PARTIALLY_PAID' },
      });
    });
    expect(failing(results)).toEqual(['6.1', '6.4']);
    expect(detailsOf(results, '6.1')).toMatch(/งวด 9: amountPaid/);
    expect(detailsOf(results, '6.1')).toMatch(/งวด 10: status/);
    expect(detailsOf(results, '6.4')).toMatch(/งวด 9: ยอด 300.00 ≠ amountPaid/);
  }, 120_000);

  it('P6 — principal / interest split of a schedule row changed → 6.5', async () => {
    const results = await gatesAfter(async (tx, report) => {
      const row = await scheduleRow(tx, idOf(report, c.prepaid), 12);
      await tx.installmentSchedule.update({
        where: { id: row.id },
        data: { interest: { increment: 50 }, principal: { decrement: 50 } },
      });
    });
    expect(failing(results)).toEqual(['6.5']);
    expect(detailsOf(results, '6.5')).toMatch(/งวด 12: principal/);
    expect(detailsOf(results, '6.5')).toMatch(/งวด 12: interest/);
  }, 120_000);

  it('P7 — Payment.dueDate of an installment ≠ the schedule row → 6.1', async () => {
    const results = await gatesAfter(async (tx, report) => {
      await tx.payment.updateMany({
        where: { contractId: idOf(report, c.overdue), installmentNo: 12 },
        data: { dueDate: new Date('2027-06-05T00:00:00+07:00') },
      });
    });
    expect(failing(results)).toEqual(['6.1']);
    expect(detailsOf(results, '6.1')).toContain('งวด 12: dueDate');
  }, 120_000);

  it('Payment breakdown columns (when the plan carries them): monthlyInterest off by 1.00 → 6.1', async () => {
    const carries = plan.items.some((i) =>
      i.payments.some((p) => 'monthlyInterest' in (p as object)),
    );
    const results = await gatesAfter(async (tx, report) => {
      await tx.payment.updateMany({
        where: { contractId: idOf(report, c.prepaid), installmentNo: 5 },
        data: { monthlyInterest: { increment: 1 } },
      });
    });
    // แผนก่อน Task 10 รอบแก้ไม่มียอดแยก — ตัวเขียนไม่เขียนคอลัมน์เหล่านี้และด่านไม่ตรวจ
    expect(failing(results)).toEqual(carries ? ['6.1'] : []);
  }, 120_000);

  // ── mutation ต่อด่าน ─────────────────────────────────────────────────────────────────────────

  it('6.2 — a Payment row off by 1.00 fails 6.2 (and 6.1 payment rows, 6.4 register / run-off)', async () => {
    const results = await gatesAfter(async (tx, report) => {
      await tx.payment.updateMany({
        where: { contractId: idOf(report, c.overdue), installmentNo: 10 },
        data: { amountPaid: { increment: 1 } },
      });
    });
    expect(failing(results)).toEqual(['6.1', '6.2', '6.4']);
    expect(gate(results, '6.2').failures).toEqual([
      { code: c.overdue.code, detail: expect.stringContaining('-1.00') },
    ]);
  }, 120_000);

  it('6.1 — a soft-deleted Payment row of a history contract, and a soft-deleted slip', async () => {
    const payment = await gatesAfter(async (tx, report) => {
      await tx.payment.updateMany({
        where: { contractId: idOf(report, c.payoff), installmentNo: 1 },
        data: { deletedAt: new Date() },
      });
    });
    expect(failing(payment)).toEqual(['6.1']);
    expect(detailsOf(payment, '6.1')).toContain('งวด 1: ไม่มีแถว Payment');
    const slip = await gatesAfter(async (tx, report) => {
      const evidence = await tx.paymentEvidence.findFirstOrThrow({
        where: { contractId: idOf(report, c.completed) },
      });
      await tx.paymentEvidence.update({
        where: { id: evidence.id },
        data: { deletedAt: new Date() },
      });
    });
    expect(failing(slip)).toEqual(['6.1']);
    expect(codesOf(slip, '6.1')).toEqual([c.completed.code]);
  }, 120_000);

  it('6.5 — clearing accrualJournalEntryId of a due row: the 2A cron would pick it', async () => {
    const results = await gatesAfter(async (tx, report) => {
      await tx.installmentSchedule.updateMany({
        where: { contractId: idOf(report, c.overdue), installmentNo: 10 },
        data: { accrualJournalEntryId: null },
      });
    });
    // แถวงวด 10 ไม่มีลิงก์ = รอบ 2A หยิบ + ไม่ตรง stamp · ยอดสะสมยังเต็มงวด ⇒ ส่วนที่เหลือ 0 (6.4 ไม่กระทบ)
    expect(failing(results)).toEqual(['6.5']);
    expect(detailsOf(results, '6.5')).toMatch(/งวด 10: รอบตั้งลูกหนี้งวด \(2A\) จะหยิบ/);
    expect(codesOf(results, '6.5')).toEqual([c.overdue.code]);
  }, 120_000);

  it('6.5 — a schedule row linked to a VAT-60 entry', async () => {
    const results = await gatesAfter(async (tx, report) => {
      await tx.installmentSchedule.updateMany({
        where: { contractId: idOf(report, c.old), installmentNo: 12 },
        data: { vat60dayJournalEntryId: 'JE-202611-99999' },
      });
    });
    expect(failing(results)).toEqual(['6.5']);
    expect(detailsOf(results, '6.5')).toContain('งวด 12: มี vat60dayJournalEntryId');
  }, 120_000);

  it('6.9 — a blank peakContactCode, and a non-empty code that is not the invoice contact', async () => {
    const contactOf = async (tx: Prisma.TransactionClient, report: WriteReport) =>
      (
        await tx.contract.findUniqueOrThrow({
          where: { id: idOf(report, c.prepaid) },
          select: { customer: { select: { contactId: true } } },
        })
      ).customer.contactId as string;
    const blank = await gatesAfter(async (tx, report) => {
      await tx.contact.update({
        where: { id: await contactOf(tx, report) },
        data: { peakContactCode: '  ' },
      });
    });
    expect(failing(blank)).toEqual(['6.9']);
    expect(codesOf(blank, '6.9')).toEqual([c.prepaid.code]);
    const other = `T12X${stamp}`;
    const wrong = await gatesAfter(
      async (tx, report) => {
        await tx.contact.update({
          where: { id: await contactOf(tx, report) },
          data: { peakContactCode: other },
        });
      },
      { forbidden: [other] },
    );
    expect(failing(wrong)).toEqual(['6.9']);
    expect(detailsOf(wrong, '6.9')).toMatch(/≠ ผู้ติดต่อของใบแจ้งหนี้/);
  }, 120_000);

  it('6.6 + 6.3 — an opening entry without metadata.flow is no longer excluded from the PEAK export', async () => {
    const results = await gatesAfter(async (tx, report) => {
      const opening = report.journalEntries.find(
        (e) => e.kind === 'opening' && e.code === c.overdue.code,
      )!;
      const row = await tx.journalEntry.findUniqueOrThrow({ where: { id: opening.id } });
      const metadata = { ...(row.metadata as Record<string, string>) };
      delete metadata.flow;
      await tx.journalEntry.update({ where: { id: opening.id }, data: { metadata } });
    });
    // 6.1 นับรายการยกมาตาม flow ไม่ครบด้วย
    expect(failing(results)).toEqual(['6.1', '6.3', '6.6']);
    expect(codesOf(results, '6.6')).toEqual([c.overdue.code]);
    expect(codesOf(results, '6.3')).toEqual([c.overdue.code]);
  }, 120_000);

  it('6.6 — a marker moved after cutoff without peakSyncedAt', async () => {
    const results = await gatesAfter(async (tx, report) => {
      const marker = report.journalEntries.find(
        (e) => e.kind === 'marker' && e.code === c.old.code,
      )!;
      const later = new Date('2026-12-05T10:00:00+07:00');
      await tx.journalEntry.update({
        where: { id: marker.id },
        data: { entryDate: later, postedAt: later, peakSyncedAt: null },
      });
    });
    expect(failing(results)).toEqual(['6.6']);
    expect(detailsOf(results, '6.6')).toContain('รายการยกมา / marker ไม่มี peakSyncedAt');
  }, 120_000);

  it('6.6 — the VAT catch-up entry stamped peakSyncedAt (it must reach PEAK)', async () => {
    const results = await gatesAfter(async (tx) => {
      await tx.journalEntry.updateMany({
        where: { referenceType: 'AUTO', referenceId: `legacy-vat-catchup:${c.overdue.code}` },
        data: { peakSyncedAt: CUTOFF },
      });
    });
    expect(failing(results)).toEqual(['6.6']);
    expect(gate(results, '6.6').failures).toEqual([
      { code: c.overdue.code, detail: expect.stringContaining('peakSyncedAt') },
    ]);
  }, 120_000);

  it('6.10 — a 2A-shaped entry after cutoff passes while the contract keeps its legacy code; nulling the code fails 6.10', async () => {
    const { kept, nulled, report } = await inImport(async (tx, report) => {
      const contractId = idOf(report, c.prepaid);
      await post(tx, contractId, new Date('2026-12-10T00:00:00+07:00'), { tag: '2A' }, [
        ['11-2103', '1515.83', '0'],
        ['11-2106', '500.00', '0'],
        ['11-2101', '0', '1416.66'],
        ['11-2105', '0', '99.17'],
        ['41-1101', '0', '500.00'],
      ]);
      const kept = await runGates(tx, plan, report, CUTOFF);
      await tx.contract.update({ where: { id: contractId }, data: { legacyContractCode: null } });
      return { kept, nulled: await runGates(tx, plan, report, CUTOFF), report };
    });
    expectNoCustomerData(kept, report);
    expectNoCustomerData(nulled, report);
    // GL ต่างจากยอดยกมาแล้ว (6.4 ตรวจ ณ คืนตัดเท่านั้น) แต่ดอกเบี้ยยังถูกตัด
    expect(failing(kept)).toEqual(['6.4']);
    expect(failing(nulled)).toEqual(['6.1', '6.4', '6.10']);
    expect(codesOf(nulled, '6.10')).toEqual([c.prepaid.code]);
    expect(detailsOf(nulled, '6.10')).toMatch(/11-2106/);
    expect(detailsOf(nulled, '6.10')).toMatch(/41-1101/);
    expect(detailsOf(nulled, '6.10')).toMatch(/legacyContractCode/);
  }, 120_000);

  it('6.10 — interestTotal ≠ the legacy interest (also 6.1 contract money and the 6.4 run-off)', async () => {
    const results = await gatesAfter(async (tx, report) => {
      await tx.contract.update({
        where: { id: idOf(report, c.prepaid) },
        data: { interestTotal: { increment: 1 } },
      });
    });
    expect(failing(results)).toEqual(['6.1', '6.4', '6.10']);
    expect(detailsOf(results, '6.10')).toMatch(
      /interestTotal 6001.00 ≠ ดอกเบี้ยตามสัญญาเดิม 6000.00/,
    );
  }, 120_000);

  it('6.4 — a history contract with a carry-forward balance in the GL', async () => {
    const results = await gatesAfter(async (tx, report) => {
      await post(tx, idOf(report, c.payoff), new Date('2026-12-03T10:00:00+07:00'), {}, [
        ['11-2101', '100.00', '0'],
        ['32-1101', '0', '100.00'],
      ]);
    });
    expect(failing(results)).toEqual(['6.4']);
    expect(gate(results, '6.4').failures).toEqual([
      { code: c.payoff.code, detail: expect.stringContaining('สัญญาประวัติมียอด 11-2101') },
    ]);
  }, 120_000);

  it('6.7 — a 21-1101 line on an imported contract (shop payable queue)', async () => {
    const results = await gatesAfter(async (tx, report) => {
      await post(
        tx,
        idOf(report, c.overdue),
        new Date('2026-12-03T10:00:00+07:00'),
        { flow: 'test-shop-payable' },
        [
          ['21-1101', '100.00', '0'],
          ['11-1201', '0', '100.00'],
        ],
      );
    });
    expect(failing(results)).toEqual(['6.7']);
    expect(gate(results, '6.7').failures).toEqual([
      { code: c.overdue.code, detail: expect.stringContaining('21-1101') },
    ]);
  }, 120_000);

  it('6.3 — an extra entry dated before cutoff with another flow (also reaches the PEAK export → 6.6)', async () => {
    const results = await gatesAfter(async (tx, report) => {
      await post(
        tx,
        idOf(report, c.old),
        new Date('2026-11-15T10:00:00+07:00'),
        { flow: 'test-backdated' },
        [
          ['11-1201', '50.00', '0'],
          ['42-1103', '0', '50.00'],
        ],
      );
    });
    expect(failing(results)).toEqual(['6.3', '6.6']);
    expect(gate(results, '6.3').failures).toEqual([
      { code: c.old.code, detail: expect.stringContaining('test-backdated') },
    ]);
  }, 120_000);

  it('a gate whose query fails is reported once as not passing (error class only) and the later gates still run', async () => {
    const results = await inImport(async (tx, report) => {
      const bind = (target: object, prop: string | symbol) => {
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      };
      // คิวรีเงื่อนไขรอบ 2A ของด่าน 6.5 (where.accrualJournalEntryId = null) → คำสั่ง SQL ที่ผิด ทำให้ธุรกรรมของ Postgres
      // ใช้ต่อไม่ได้จนกว่าจะ rollback ถึง savepoint
      const failingTx = new Proxy(tx, {
        get(target, prop) {
          if (prop !== 'installmentSchedule') return bind(target, prop);
          const delegate = target.installmentSchedule;
          return new Proxy(delegate, {
            get(d, p) {
              if (p !== 'findMany') return bind(d, p);
              return async (args: { where?: { accrualJournalEntryId?: unknown } }) => {
                if (args?.where?.accrualJournalEntryId === null) {
                  await target.$queryRawUnsafe('SELECT 1/0');
                }
                return d.findMany(args as Prisma.InstallmentScheduleFindManyArgs);
              };
            },
          });
        },
      });
      return runGates(failingTx, plan, report, CUTOFF);
    });
    expect(results.map((r) => r.id)).toEqual([...GATE_IDS]);
    expect(failing(results)).toEqual(['6.5']);
    expect(gate(results, '6.5').detail).toMatch(/PrismaClient\w*Error/);
    expect(gate(results, '6.5').detail).not.toMatch(/division/i);
  }, 120_000);
});
