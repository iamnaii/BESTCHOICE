import { Prisma } from '@prisma/client';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { bangkokDateString } from '../../../utils/date.util';
import { encryptPII } from '../../../utils/crypto.util';
import { hashPII } from '../../../utils/pii.util';
import type { DumpRow } from '../dump-reader';
import type { LegacyBook, LegacyContract } from '../legacy-book';
import {
  main,
  parseCutoff,
  runImport,
  runReport,
  type ImportArgs,
  type ImportDeps,
  type ImportStorage,
  type LegacyInputs,
  type ReportArgs,
} from '../legacy-backoffice-import.cli';
import { BLOCKERS_CSV_HEADER, parseCanceledMapCsv, redactDigits } from '../report-files';
import type { GateResult } from '../gates';
import { LegacyWriteBlocked, type WriteReport } from '../writer';
import {
  LAST,
  MONTHLY,
  peakMatch,
  standardInstallments,
  syntheticBook,
  syntheticContract,
  syntheticMember,
  thaiId,
} from './synthetic-book';

/**
 * คำสั่ง `report` / `import` (Task 13) — ข้อมูลสังเคราะห์ทั้งหมด (`synthetic-book.ts`) · ฐานข้อมูลเป็น mock (แบบ
 * `backfill-orphan-partial-receipts.cli.spec.ts`) — ตัวเขียนและด่านจริงทดสอบใน `writer.db.spec.ts` / `gates.db.spec.ts` ·
 * ไฟล์ผลลัพธ์และโฟลเดอร์ไฟล์แนบอยู่ใน tmp ของระบบ (นอก repo)
 */

const KEY = 'c7'.repeat(32);
const WRONG_KEY = 'd8'.repeat(32);
const SALT = 'legacy-t13-cli-spec-salt-00000000001';
const DB = 'bestchoice_t13_test';
const SECRET_NAME = 'ชื่อลับสังเคราะห์';
const NIDS = [thaiId('091300000001'), thaiId('091300000002'), thaiId('091300000003')];
const PHONES = ['0977130001', '0977130002', '0977130003'];
const MEMBERS = [
  syntheticMember({
    id: 'M1301',
    code: 'MC-1301',
    nationalId: NIDS[0],
    phone: PHONES[0],
    name: SECRET_NAME,
  }),
  syntheticMember({
    id: 'M1302',
    code: 'MC-1302',
    nationalId: NIDS[1],
    phone: PHONES[1],
    name: SECRET_NAME,
  }),
  syntheticMember({
    id: 'M1303',
    code: 'MC-1303',
    nationalId: NIDS[2],
    phone: PHONES[2],
    name: SECRET_NAME,
  }),
];

const paidFirst = (n: number) =>
  standardInstallments(
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [i + 1, { paid: i === 11 ? LAST : MONTHLY }]),
    ),
  );

/** ผ่อนอยู่ ค้างงวด 6 (ครบกำหนด 20 พ.ย. 2569) */
const ACTIVE = syntheticContract({
  id: '1301',
  imei: '130113011301130',
  code: 'TEST-C13-A1',
  date: '2026-05-20',
  memberId: 'M1301',
  firstDue: [2026, 5, 20],
  installments: paidFirst(5),
});
/** ผ่อนครบแล้ว (ประวัติ) */
const HISTORY = syntheticContract({
  id: '1302',
  imei: '130213021302130',
  code: 'TEST-C13-H1',
  statusCode: '3',
  date: '2025-02-10',
  memberId: 'M1302',
  firstDue: [2025, 2, 10],
  installments: paidFirst(12),
});
/** สัญญาฉบับเก่า (ทำสัญญาก่อน 2025-11-14) ผ่อนอยู่ ค้างงวดสุดท้าย */
const OLD_FORM = syntheticContract({
  id: '1303',
  imei: '130313031303130',
  code: 'TEST-C13-O1',
  date: '2025-09-10',
  memberId: 'M1303',
  firstDue: [2025, 9, 10],
  installments: paidFirst(11),
});
/** ยกเลิก — เจ้าของยังไม่ยืนยัน (ตัวบล็อก) */
const CANCELED = syntheticContract({
  id: '1304',
  imei: '130413041304130',
  code: 'TEST-C13-X1',
  statusCode: '4',
  date: '2025-12-01',
  memberId: 'M1301',
  firstDue: [2026, 0, 1],
});
/** ค่างวดระบบเก่าไม่ตรงตัวคำนวณ (ตัวบล็อก) */
const MISMATCH = syntheticContract({
  id: '1305',
  imei: '130513051305130',
  code: 'TEST-C13-M1',
  date: '2026-04-01',
  memberId: 'M1302',
  firstDue: [2026, 4, 1],
  installments: Array.from({ length: 12 }, () => ({ amount: '1600.00' })),
});

const CONTRACT_ROWS: DumpRow[] = [
  {
    contract_id: '1304',
    contract_code: 'TEST-C13-X1',
    canceled_return_phone: '1',
    canceled_refund: '0',
    canceled_must_pay: '500',
    canceled_paid: '0',
    canceled_slip: null,
    canceled_by: 'แอดมิน',
    canceled_at: '2026-01-15 10:00:00',
    canceled_ip: '10.0.0.1',
    canceled_remark: 'ลูกค้าขอยกเลิก โทร 081-234-5678',
    baddebt_at: null,
    baddebt_remark: null,
  },
];

const IMPORT_BOOK = syntheticBook([ACTIVE, HISTORY, OLD_FORM], MEMBERS);
const REPORT_BOOK = syntheticBook([ACTIVE, HISTORY, OLD_FORM, CANCELED, MISMATCH], MEMBERS);

/** CSV ยอดลูกหนี้ PEAK — ยอดคงเหลือ = ยอดค้างระบบเก่า (สังเคราะห์) */
function peakArText(contracts: LegacyContract[]): string {
  const lines = ['invoice_code,contact_code,issued_date,net_amount,remain_amount,imei'];
  contracts.forEach((c, i) => {
    const m = peakMatch(c, `TEST-CT-${i + 1}`);
    lines.push(
      [
        m.invoice.invoiceCode,
        m.invoice.contactCode,
        bangkokDateString(c.createdAt),
        m.invoice.netAmount.toFixed(2),
        m.invoice.remainAmount.toFixed(2),
        c.detail.mobile_imei ?? '',
      ].join(','),
    );
  });
  return `${lines.join('\n')}\n`;
}

/** path ไฟล์แนบ + สลิปทุกไฟล์ของ book (ไม่ซ้ำ) */
function attachmentsOf(book: LegacyBook): string[] {
  return [
    ...new Set(
      book.contracts.flatMap((c) => [
        ...c.files.map((f) => f.path),
        ...c.receipts.map((r) => r.slipPath).filter((p): p is string => !!p),
      ]),
    ),
  ];
}

/** สร้างไฟล์แนบ + สลิปทุกไฟล์ของ book ในโฟลเดอร์ httpdocs สังเคราะห์ */
function materialize(filesDir: string, book: LegacyBook): string[] {
  const paths = attachmentsOf(book);
  mkdirSync(join(filesDir, 'uploads'), { recursive: true });
  mkdirSync(join(filesDir, 'upload'), { recursive: true });
  for (const p of paths) {
    mkdirSync(dirname(join(filesDir, p)), { recursive: true });
    writeFileSync(join(filesDir, p), `synthetic ${p}`);
  }
  return paths;
}

function fakeReport(): WriteReport {
  return {
    importBatch: 'rehearsal-test',
    created: {
      customers: 3,
      products: 3,
      contracts: 3,
      schedules: 24,
      payments: 36,
      evidences: 28,
      documents: 3,
      journalEntries: 4,
    },
    skippedExisting: [],
    contractIds: new Map([[ACTIVE.code, 'ct-1']]),
    customers: [
      {
        code: ACTIVE.code,
        legacyMemberCode: 'MC-1301',
        customerId: 'cu-1',
        outcome: 'CREATED',
        writes: ['customerCreated'],
        phoneInvalid: false,
      },
    ],
    journalEntries: [
      { code: ACTIVE.code, contractId: 'ct-1', kind: 'opening', id: 'je-1', entryNumber: 'JE-1' },
    ],
    missingAttachments: [],
  };
}

/** ลูกค้าตัวอย่างของด่านกุญแจ — ciphertext/hash ด้วยกุญแจและ salt ที่ให้ */
function piiRows(key = KEY, salt = SALT) {
  return NIDS.map((nid, i) => ({
    nationalIdEncrypted: encryptPII(nid, key),
    nationalIdHash: hashPII(nid, salt),
    phoneEncrypted: encryptPII(PHONES[i], key),
    phoneHash: hashPII(PHONES[i], salt),
  }));
}

describe('legacy-backoffice-import CLI — report / import (Task 13)', () => {
  let base: string;
  let filesDir: string;
  let out: string;
  let peakAr: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'legacy-t13-'));
    filesDir = join(base, 'httpdocs');
    out = join(base, 'out');
    peakAr = join(base, 'peak-ar.csv');
    writeFileSync(peakAr, peakArText([ACTIVE, HISTORY, OLD_FORM]));
    materialize(filesDir, REPORT_BOOK);
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  // ─── import ──────────────────────────────────────────────────────────────────────────────────

  describe('runImport', () => {
    type Harness = ReturnType<typeof harness>;

    function harness(over: { db?: string; piiRows?: unknown[]; systemUser?: unknown } = {}) {
      const txErrors: unknown[] = [];
      const order: string[] = [];
      const tx = {
        user: {
          create: jest.fn(async () => {
            order.push('tx.user.create');
            return { id: 'sys-user-tx' };
          }),
        },
      };
      const customerFindMany = jest.fn(async (args: { where: Record<string, unknown> }) => {
        if ('id' in args.where) return [{ id: 'cu-phone-owner' }]; // ลูกค้าที่ชนและมีเลขบัตร
        return over.piiRows ?? piiRows();
      });
      const prisma = {
        $queryRaw: jest.fn(async () => [{ current_database: over.db ?? DB }]),
        customer: { findMany: customerFindMany },
        companyInfo: { findFirst: jest.fn(async () => ({ id: 'finance-co' })) },
        branch: { findFirst: jest.fn(async () => ({ id: 'branch-1', name: 'สาขาสังเคราะห์' })) },
        user: {
          findUnique: jest.fn(async () =>
            over.systemUser === undefined ? { id: 'sys-user', isActive: false } : over.systemUser,
          ),
          create: jest.fn(async () => {
            order.push('user.create');
            return { id: 'sys-user-new', isActive: false };
          }),
        },
        $transaction: jest.fn(
          async (cb: (client: typeof tx) => Promise<unknown>, _options?: unknown) => {
            order.push('$transaction');
            try {
              return await cb(tx);
            } catch (error) {
              txErrors.push(error);
              throw error;
            }
          },
        ),
      };
      const realUpload = jest.fn(async (key: string) => key);
      const realStorage: ImportStorage = {
        configured: true,
        describe: () => ({ backend: 'gcs', location: 'synthetic-bucket' }),
        upload: realUpload,
      };
      const deps = {
        env: { EXPECTED_DB_NAME: DB, PII_ENCRYPTION_KEY: KEY, PII_HASH_SALT: SALT } as Record<
          string,
          string | undefined
        >,
        log: jest.fn(),
        loadBook: jest.fn(
          async (): Promise<LegacyInputs> => ({ book: IMPORT_BOOK, contractRows: [] }),
        ),
        storage: jest.fn(async () => realStorage),
        journal: {} as ImportDeps['journal'],
        pii: {} as ImportDeps['pii'],
        audit: { log: jest.fn(async () => undefined) },
        write: jest.fn(async () => fakeReport()) as unknown as ImportDeps['write'],
        runGates: jest.fn(
          async (): Promise<GateResult[]> => [
            { id: '6.1', pass: true, detail: 'ครบ' },
            { id: '6.2', pass: true, detail: 'ตรง PEAK' },
          ],
        ),
        now: () => new Date('2026-11-30T17:30:00Z'),
      };
      return { prisma, tx, txErrors, order, realStorage, realUpload, deps };
    }

    const args = (over: Partial<ImportArgs> = {}): ImportArgs => ({
      dump: join(base, 'dump.sql'),
      peakAr,
      filesDir,
      cutoff: '2026-11-30',
      branchId: 'branch-1',
      out,
      ...over,
    });

    const run = (h: Harness, over: Partial<ImportArgs> = {}, deps: Partial<ImportDeps> = {}) =>
      runImport(h.prisma as never, args(over), { ...h.deps, ...deps });

    const result = () => JSON.parse(readFileSync(join(out, 'import-result.json'), 'utf8'));

    /** ไม่มีการเขียนใด ๆ: ไม่เปิดธุรกรรม ไม่สร้างผู้ใช้ ไม่อัปโหลด ไม่เขียน audit */
    const expectNoWrites = (h: Harness) => {
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
      expect(h.prisma.user.create).not.toHaveBeenCalled();
      expect(h.realUpload).not.toHaveBeenCalled();
      expect(h.deps.write).not.toHaveBeenCalled();
      expect(h.deps.audit.log).not.toHaveBeenCalled();
    };

    it('ไม่มี CONFIRM_LEGACY_IMPORT → dry-run: เขียนในธุรกรรมแล้ว throw Rollback · committed:false แม้ด่านผ่านทุกด่าน', async () => {
      const h = harness();
      const outcome = await run(h);

      expect(outcome.committed).toBe(false);
      expect(outcome.outcome).toBe('DRY_RUN_ROLLED_BACK');
      expect(outcome.gates.every((g) => g.pass)).toBe(true);
      expect(outcome.report?.created.contracts).toBe(3);
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(h.deps.write).toHaveBeenCalledTimes(1);
      expect(h.txErrors).toHaveLength(1);
      expect((h.txErrors[0] as Error).name).toBe('Rollback');
      expect(h.deps.audit.log).not.toHaveBeenCalled();
      expect(result()).toMatchObject({
        mode: 'dry-run',
        committed: false,
        outcome: 'DRY_RUN_ROLLED_BACK',
      });
      expect(outcome.resultPath).toBe(join(out, 'import-result.json'));
    });

    it('dry-run ใช้ storage ปลอม — ไม่สร้าง/ไม่เรียก storage จริง แต่ได้ key ของทุกไฟล์ส่งให้ตัวเขียน', async () => {
      const h = harness();
      const outcome = await run(h);

      expect(h.deps.storage).not.toHaveBeenCalled();
      expect(h.realUpload).not.toHaveBeenCalled();
      // ทุกสัญญาในแผน → ไฟล์แนบ + สลิปทุกไฟล์ของ book ได้ key (ไม่มีไฟล์ขึ้น bucket)
      expect(outcome.files).toEqual({
        uploaded: attachmentsOf(IMPORT_BOOK).length,
        missing: 0,
        failed: 0,
      });
      const writerDeps = (h.deps.write as unknown as jest.Mock).mock.calls[0][2];
      expect(writerDeps.files.size).toBe(outcome.files.uploaded);
      expect(writerDeps.importBatch).toMatch(/^rehearsal-/);
      expect(writerDeps).toMatchObject({
        financeCompanyId: 'finance-co',
        branchId: 'branch-1',
        systemUserId: 'sys-user',
      });
    });

    it('CONFIRM_LEGACY_IMPORT + ด่านผ่าน → COMMIT · อัปโหลดจริง · audit หนึ่งแถวหลัง commit · timeout 20 นาที', async () => {
      const h = harness();
      h.deps.env.CONFIRM_LEGACY_IMPORT = 'YES_I_AM_SURE';
      const outcome = await run(h);

      expect(outcome.committed).toBe(true);
      expect(outcome.outcome).toBe('COMMITTED');
      expect(h.txErrors).toHaveLength(0);
      expect(h.realUpload).toHaveBeenCalledTimes(outcome.files.uploaded);
      expect(h.realUpload.mock.calls[0][0]).toMatch(/^legacy-import\//);
      expect(h.prisma.$transaction.mock.calls[0][1]).toEqual({
        timeout: 20 * 60_000,
        maxWait: 30_000,
      });
      expect(h.deps.audit.log).toHaveBeenCalledTimes(1);
      expect(h.deps.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LEGACY_IMPORT_COMMITTED', userId: 'sys-user' }),
      );
      expect(result()).toMatchObject({
        mode: 'commit',
        committed: true,
        storage: { backend: 'gcs' },
      });
    });

    it('ด่านใดไม่ผ่าน → rollback + committed:false แม้ตั้ง CONFIRM · ไม่เขียน audit', async () => {
      const h = harness();
      h.deps.env.CONFIRM_LEGACY_IMPORT = 'YES_I_AM_SURE';
      h.deps.runGates.mockResolvedValueOnce([
        { id: '6.1', pass: true, detail: 'ครบ' },
        {
          id: '6.2',
          pass: false,
          detail: 'ไม่ตรง PEAK 1 สัญญา',
          failures: [{ code: ACTIVE.code, detail: 'ส่วนต่าง 1.00' }],
        },
      ]);
      const outcome = await run(h);

      expect(outcome.committed).toBe(false);
      expect(outcome.outcome).toBe('GATES_FAILED');
      expect((h.txErrors[0] as Error).name).toBe('Rollback');
      expect(h.deps.audit.log).not.toHaveBeenCalled();
      expect(result().gates).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: '6.2', pass: false })]),
      );
      const failures = readFileSync(join(out, 'gate-failures.csv'), 'utf8').split('\n');
      expect(failures[0]).toBe('gate,label,legacy_code,detail');
      expect(failures[1]).toMatch(new RegExp(`^6\\.2,.*,${ACTIVE.code},ส่วนต่าง 1\\.00$`));
    });

    it('ด่านรันในธุรกรรมเดียวกับตัวเขียน พร้อม bookContracts · seed + เลขสัญญาที่สุ่มอยู่ใน import-result.json + sample.csv', async () => {
      const h = harness();
      await run(h, { sampleSeed: 'seed-t13' });
      const [tx, plan, report, cutoff, opts] = h.deps.runGates.mock.calls[0] as unknown as [
        unknown,
        { items: unknown[] },
        WriteReport,
        Date,
        unknown,
      ];
      expect(tx).toBe(h.tx);
      expect(plan.items).toHaveLength(3);
      expect(report.created.contracts).toBe(3);
      expect(cutoff.toISOString()).toBe('2026-11-30T16:59:59.000Z');
      expect(opts).toEqual({ bookContracts: 3 });
      const sample = result().sample;
      expect(sample.seed).toBe('seed-t13');
      expect([...sample.codes].sort()).toEqual([ACTIVE.code, HISTORY.code, OLD_FORM.code].sort());
      expect(readFileSync(join(out, 'sample.csv'), 'utf8').trimEnd().split('\n')).toHaveLength(4);
    });

    it('ไม่ตั้ง EXPECTED_DB_NAME → throw ก่อนแตะฐาน', async () => {
      const h = harness();
      delete h.deps.env.EXPECTED_DB_NAME;
      await expect(run(h)).rejects.toThrow(/EXPECTED_DB_NAME/);
      expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
      expectNoWrites(h);
    });

    it('EXPECTED_DB_NAME ไม่ตรง current_database() → throw ก่อนเขียนใด ๆ', async () => {
      const h = harness({ db: 'some_other_db' });
      h.deps.env.CONFIRM_LEGACY_IMPORT = 'YES_I_AM_SURE';
      await expect(run(h)).rejects.toThrow(/ฐานไม่ตรง/);
      expectNoWrites(h);
      expect(existsSync(join(out, 'import-result.json'))).toBe(false);
    });

    it('NODE_ENV=production ไม่มี ALLOW_PROD_LEGACY_IMPORT → throw (ทั้ง dry-run) ก่อนต่อฐาน', async () => {
      const h = harness();
      h.deps.env.NODE_ENV = 'production';
      await expect(run(h)).rejects.toThrow(/ALLOW_PROD_LEGACY_IMPORT/);
      expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
      expectNoWrites(h);
    });

    it('ต่อฐานชื่อ bestchoice (prod) ไม่มี ALLOW_PROD_LEGACY_IMPORT → throw แม้ไม่ได้ตั้ง NODE_ENV', async () => {
      const h = harness({ db: 'bestchoice' });
      h.deps.env.EXPECTED_DB_NAME = 'bestchoice';
      await expect(run(h)).rejects.toThrow(/ALLOW_PROD_LEGACY_IMPORT/);
      expectNoWrites(h);
    });

    it('NODE_ENV=production + ALLOW_PROD_LEGACY_IMPORT → ผ่านด่านนี้ (dry-run ยังไม่ commit)', async () => {
      const h = harness();
      h.deps.env.NODE_ENV = 'production';
      h.deps.env.ALLOW_PROD_LEGACY_IMPORT = 'YES_I_AM_SURE';
      const outcome = await run(h);
      expect(outcome.committed).toBe(false);
      expect(outcome.outcome).toBe('DRY_RUN_ROLLED_BACK');
    });

    it('แผนมีตัวบล็อก → ไม่เรียก $transaction · เขียน blockers.csv + customers-blocked.csv แล้วหยุด', async () => {
      const h = harness();
      h.deps.loadBook.mockResolvedValue({ book: REPORT_BOOK, contractRows: CONTRACT_ROWS });
      const outcome = await run(h);

      expect(outcome.outcome).toBe('PLAN_BLOCKED');
      expect(outcome.committed).toBe(false);
      expect(outcome.blockers.map((b) => b.reason)).toEqual(
        expect.arrayContaining(['CANCELED_UNCONFIRMED', 'INSTALLMENT_AMOUNT_MISMATCH']),
      );
      expectNoWrites(h);
      const csv = readFileSync(join(out, 'blockers.csv'), 'utf8');
      expect(csv.split('\n')[0]).toBe(BLOCKERS_CSV_HEADER.join(','));
      expect(csv).toContain(`${CANCELED.code},CANCELED_UNCONFIRMED,`);
      expect(existsSync(join(out, 'customers-blocked.csv'))).toBe(true);
      expect(result()).toMatchObject({
        outcome: 'PLAN_BLOCKED',
        blockers: { count: outcome.blockers.length },
      });
    });

    it('--allow-blockers (dry-run) ซ้อมสัญญาที่ผ่าน — ส่ง allowPlanBlockers ให้ตัวเขียน · ยังไม่ commit', async () => {
      const h = harness();
      h.deps.loadBook.mockResolvedValue({ book: REPORT_BOOK, contractRows: CONTRACT_ROWS });
      const outcome = await run(h, { allowBlockers: true });
      expect(outcome.committed).toBe(false);
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect((h.deps.write as unknown as jest.Mock).mock.calls[0][2].allowPlanBlockers).toBe(true);
      expect(existsSync(join(out, 'blockers.csv'))).toBe(true);
    });

    it('--allow-blockers: ด่าน 6.1 ไม่ผ่านโดยออกแบบ → พิมพ์คำอธิบาย · ผล GATES_FAILED ไม่ commit', async () => {
      const h = harness();
      h.deps.loadBook.mockResolvedValue({ book: REPORT_BOOK, contractRows: CONTRACT_ROWS });
      h.deps.runGates.mockResolvedValueOnce([
        { id: '6.1', pass: false, detail: 'แผนมีตัวบล็อก 2 แถว' },
        { id: '6.2', pass: true, detail: 'ตรง PEAK' },
      ]);
      const outcome = await run(h, { allowBlockers: true });
      expect(outcome.outcome).toBe('GATES_FAILED');
      expect(outcome.committed).toBe(false);
      const printed = h.deps.log.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toMatch(/ด่าน 6\.1 ไม่ผ่านโดยออกแบบ/);
    });

    it('--allow-blockers คู่กับ CONFIRM_LEGACY_IMPORT → throw ก่อนแตะฐาน', async () => {
      const h = harness();
      h.deps.env.CONFIRM_LEGACY_IMPORT = 'YES_I_AM_SURE';
      await expect(run(h, { allowBlockers: true })).rejects.toThrow(/--allow-blockers/);
      expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
      expectNoWrites(h);
    });

    it.each(['none', 'local'] as const)(
      'เขียนจริงปฏิเสธ storage %s ก่อนแตะฐาน (ต้องเป็น GCS/S3)',
      async (backend) => {
        const h = harness();
        h.deps.env.CONFIRM_LEGACY_IMPORT = 'YES_I_AM_SURE';
        const storage = { ...h.realStorage, describe: () => ({ backend, location: '' }) };
        await expect(run(h, {}, { storage: async () => storage })).rejects.toThrow(/GCS/);
        expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
        expectNoWrites(h);
      },
    );

    it('--files-dir ในโฟลเดอร์ของ repo → ปฏิเสธก่อนอ่านไฟล์', async () => {
      const h = harness();
      const insideRepo = resolve(__dirname, '..', '__files-must-not-exist__');
      await expect(run(h, { filesDir: insideRepo })).rejects.toThrow(/--files-dir ต้องอยู่นอก/);
      expect(h.deps.loadBook).not.toHaveBeenCalled();
      expectNoWrites(h);
    });

    it('--files-dir ไม่มี uploads/ + upload/ (ส่งโฟลเดอร์ผิดชั้น) → ปฏิเสธ', async () => {
      const h = harness();
      await expect(run(h, { filesDir: join(filesDir, 'uploads') })).rejects.toThrow(/httpdocs/);
      expectNoWrites(h);
    });

    it('--out ในโฟลเดอร์ของ repo → ปฏิเสธ', async () => {
      const h = harness();
      const insideRepo = resolve(__dirname, '..', '__out-must-not-exist__');
      await expect(run(h, { out: insideRepo })).rejects.toThrow(
        /ห้ามเขียนผลลัพธ์ลงในโฟลเดอร์ของ repo/,
      );
      expect(existsSync(insideRepo)).toBe(false);
      expectNoWrites(h);
    });

    it.each([
      ['กุญแจไม่ตรง', () => piiRows(WRONG_KEY, SALT), /PII_ENCRYPTION_KEY/],
      [
        'salt ไม่ตรง',
        () => piiRows(KEY, 'another-salt-for-the-same-cipher-000001'),
        /PII_HASH_SALT/,
      ],
    ])('ด่านกุญแจ/salt PII: %s → หยุดก่อนเขียน', async (_label, rows, message) => {
      const h = harness({ piiRows: rows() });
      h.deps.env.CONFIRM_LEGACY_IMPORT = 'YES_I_AM_SURE';
      await expect(run(h)).rejects.toThrow(/ด่านกุญแจ PII ไม่ผ่าน/);
      await expect(run(harness({ piiRows: rows() }))).rejects.toThrow(message);
      expectNoWrites(h);
    });

    it('กุญแจรูปแบบผิด → throw ก่อนต่อฐาน', async () => {
      const h = harness();
      h.deps.env.PII_ENCRYPTION_KEY = 'short';
      await expect(run(h)).rejects.toThrow(/PII_ENCRYPTION_KEY/);
      expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('ไม่มีลูกค้าให้ตรวจกุญแจ: เขียนจริงต้องมี ALLOW_UNVERIFIED_PII_KEYS · dry-run ไปต่อได้', async () => {
      const blocked = harness({ piiRows: [] });
      blocked.deps.env.CONFIRM_LEGACY_IMPORT = 'YES_I_AM_SURE';
      await expect(run(blocked)).rejects.toThrow(/ALLOW_UNVERIFIED_PII_KEYS/);
      expectNoWrites(blocked);

      const dry = harness({ piiRows: [] });
      expect((await run(dry)).outcome).toBe('DRY_RUN_ROLLED_BACK');
    });

    it('ตัวเขียนพบตัวบล็อกในฐาน (LegacyWriteBlocked) → rollback · blockers.csv + ธงลูกค้าที่ชนมีเลขบัตร', async () => {
      const h = harness();
      (h.deps.write as unknown as jest.Mock).mockRejectedValueOnce(
        new LegacyWriteBlocked([
          {
            code: ACTIVE.code,
            reason: 'CUSTOMER_PHONE_TAKEN',
            detail: { memberCode: 'MC-1301', relatedCustomerId: 'cu-phone-owner' },
          },
          { code: OLD_FORM.code, reason: 'CONTRACT_NUMBER_TAKEN' },
        ]),
      );
      const outcome = await run(h);

      expect(outcome.outcome).toBe('WRITE_BLOCKED');
      expect(outcome.committed).toBe(false);
      expect(outcome.blockers).toHaveLength(2);
      expect(h.deps.runGates).not.toHaveBeenCalled();
      const customers = readFileSync(join(out, 'customers-blocked.csv'), 'utf8').split('\n');
      expect(customers[0]).toBe(
        'legacy_member_code,customer_id,legacy_code,outcome,related_customer_id,related_has_national_id,phone_invalid,peak_contact_code,other_peak_contact_code',
      );
      expect(customers[1]).toBe(
        `MC-1301,,${ACTIVE.code},CUSTOMER_PHONE_TAKEN,cu-phone-owner,yes,,,`,
      );
      expect(readFileSync(join(out, 'blockers.csv'), 'utf8')).toContain(
        `${OLD_FORM.code},CONTRACT_NUMBER_TAKEN,`,
      );
    });

    it('ไฟล์แนบหาไม่เจอเกิน --max-missing-files → หยุดก่อนธุรกรรม · missing-files.csv มี path', async () => {
      const h = harness();
      const missing = ACTIVE.files[0].path;
      unlinkSync(join(filesDir, missing));
      const outcome = await run(h, { maxMissingFiles: 0 });

      expect(outcome.outcome).toBe('FILES_MISSING');
      expect(outcome.files.missing).toBe(1);
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
      expect(readFileSync(join(out, 'missing-files.csv'), 'utf8')).toContain(
        `missing,${missing},,${ACTIVE.code}`,
      );
    });

    it('ไฟล์แนบหาไม่เจอไม่เกินเกณฑ์ → ไปต่อ (รายงานใน missing-files.csv)', async () => {
      const h = harness();
      unlinkSync(join(filesDir, ACTIVE.files[0].path));
      const outcome = await run(h);
      expect(outcome.outcome).toBe('DRY_RUN_ROLLED_BACK');
      expect(outcome.files.missing).toBe(1);
      expect(existsSync(join(out, 'missing-files.csv'))).toBe(true);
    });

    it('อัปโหลดไม่สำเร็จ (failed) ตอนเขียนจริง → หยุดก่อนธุรกรรม (รันซ้ำได้)', async () => {
      const h = harness();
      h.deps.env.CONFIRM_LEGACY_IMPORT = 'YES_I_AM_SURE';
      h.realUpload.mockRejectedValueOnce(new Error('network'));
      const outcome = await run(h);
      expect(outcome.outcome).toBe('FILES_FAILED');
      expect(outcome.files.failed).toBe(1);
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
      expect(h.deps.audit.log).not.toHaveBeenCalled();
    });

    it('ผู้ใช้ระบบยังไม่มี: เขียนจริงสร้างก่อนเปิดธุรกรรมหลัก · dry-run สร้างในธุรกรรม (rollback ไปด้วย)', async () => {
      const commit = harness({ systemUser: null });
      commit.deps.env.CONFIRM_LEGACY_IMPORT = 'YES_I_AM_SURE';
      await run(commit);
      expect(commit.order).toEqual(['user.create', '$transaction']);
      expect(commit.tx.user.create).not.toHaveBeenCalled();
      expect((commit.deps.write as unknown as jest.Mock).mock.calls[0][2].systemUserId).toBe(
        'sys-user-new',
      );

      const dry = harness({ systemUser: null });
      await run(dry);
      expect(dry.prisma.user.create).not.toHaveBeenCalled();
      expect(dry.order).toEqual(['$transaction', 'tx.user.create']);
      expect((dry.deps.write as unknown as jest.Mock).mock.calls[0][2].systemUserId).toBe(
        'sys-user-tx',
      );
    });

    it('error อื่นในธุรกรรม → import-result.json บันทึก error แล้ว throw ต่อ · error ของ Prisma = ชื่อคลาส + รหัสเท่านั้น', async () => {
      const plain = harness();
      (plain.deps.write as unknown as jest.Mock).mockRejectedValueOnce(new Error('boom'));
      await expect(run(plain)).rejects.toThrow('boom');
      expect(result()).toMatchObject({ outcome: 'ERROR', committed: false, error: 'boom' });

      const prismaError = harness();
      (prismaError.deps.write as unknown as jest.Mock).mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError(
          `Unique constraint failed: ${SECRET_NAME} ${PHONES[0]}`,
          {
            code: 'P2002',
            clientVersion: 'test',
          },
        ),
      );
      await expect(run(prismaError)).rejects.toThrow();
      expect(result().error).toBe('PrismaClientKnownRequestError P2002');
      const text = readFileSync(join(out, 'import-result.json'), 'utf8');
      expect(text).not.toContain(SECRET_NAME);
      expect(text).not.toContain(PHONES[0]);
    });

    it('import-result.json ไม่มีข้อมูลลูกค้า (ชื่อ เบอร์ เลขบัตร)', async () => {
      const h = harness();
      await run(h);
      const text = readFileSync(join(out, 'import-result.json'), 'utf8');
      for (const secret of [SECRET_NAME, ...PHONES, ...NIDS]) expect(text).not.toContain(secret);
    });
  });

  // ─── report ──────────────────────────────────────────────────────────────────────────────────

  describe('runReport', () => {
    const reportArgs = (over: Partial<ReportArgs> = {}): ReportArgs => ({
      dump: join(base, 'dump.sql'),
      peakAr,
      cutoff: '2026-11-30',
      out,
      ...over,
    });
    const deps = {
      log: jest.fn(),
      loadBook: async (): Promise<LegacyInputs> => ({
        book: REPORT_BOOK,
        contractRows: CONTRACT_ROWS,
      }),
      now: () => new Date('2026-11-30T17:30:00Z'),
    };
    const read = (name: string) => readFileSync(join(out, name), 'utf8');
    const header = (name: string) => read(name).split('\n')[0];

    it('เขียนทุกไฟล์ด้วยหัวคอลัมน์ที่กำหนด (+ missing-files.csv เมื่อส่ง --files-dir)', async () => {
      const outcome = await runReport(reportArgs({ filesDir }), deps as never);

      expect(outcome.written.sort()).toEqual(
        [
          'peak-recon.csv',
          'peak-recon-unmatched.csv',
          'bridge.csv',
          'summary.json',
          'blockers.csv',
          'canceled.csv',
          'money-mismatch.csv',
          'old-form.csv',
          'sample.csv',
          'customers-blocked.csv',
          'warnings.csv',
          'missing-files.csv',
        ].sort(),
      );
      expect(header('peak-recon.csv')).toMatch(/^legacy_code,invoice_code,peak_contact_code,/);
      expect(header('blockers.csv')).toBe(
        'legacy_code,reason,reason_th,member_code,invoice_code,installment_nos,diff,expected_rounding_diff,mismatch,related_customer_id,detail',
      );
      expect(header('canceled.csv')).toBe(
        'legacy_code,legacy_status,contract_date,canceled_return_phone,canceled_refund,canceled_must_pay,canceled_paid,canceled_slip,canceled_by,canceled_at,canceled_remark,baddebt_at,baddebt_remark,resolution',
      );
      expect(header('money-mismatch.csv')).toMatch(
        /^legacy_code,financed_amount,store_commission,vat_amount,reason,reason_th,/,
      );
      expect(header('old-form.csv')).toBe('legacy_code,contract_date,in_plan,status');
      expect(header('sample.csv')).toMatch(/^legacy_code,kind,status,old_form,contract_date,/);
      expect(header('customers-blocked.csv')).toMatch(
        /^legacy_member_code,customer_id,legacy_code,outcome,/,
      );
      expect(header('warnings.csv')).toBe('legacy_code,kind,message');
      expect(header('missing-files.csv')).toBe('status,path,reason,legacy_codes');

      // bridge: บรรทัด # อธิบายเครื่องหมาย → หัวคอลัมน์ → สัญญาผ่อนอยู่ 2 สัญญา → TOTAL
      const bridge = read('bridge.csv').trimEnd().split('\n');
      const notes = bridge.filter((l) => l.startsWith('#'));
      expect(notes.join(' ')).toMatch(/52-1104/);
      expect(notes.join(' ')).toMatch(/53-1503/);
      const body = bridge.filter((l) => !l.startsWith('#'));
      expect(body[0]).toMatch(
        /^legacy_code,status,peak_invoice_code,legacy_outstanding,peak_adjustment,satang_gap,peak_remain,/,
      );
      expect(body[0]).toContain('rounding_diff');
      expect(body.slice(1, -1).map((l) => l.split(',')[0])).toEqual([ACTIVE.code, OLD_FORM.code]);
      expect(body.at(-1)).toMatch(/^TOTAL,2,/);

      expect(read('blockers.csv')).toContain(`${CANCELED.code},CANCELED_UNCONFIRMED,`);
      expect(read('blockers.csv')).toContain(`${MISMATCH.code},INSTALLMENT_AMOUNT_MISMATCH,`);
      expect(read('money-mismatch.csv')).toContain(
        `${MISMATCH.code},,,,INSTALLMENT_AMOUNT_MISMATCH,`,
      );
      expect(read('money-mismatch.csv')).toContain('1:1600.00/1515.83');
      expect(read('old-form.csv')).toContain(`${OLD_FORM.code},2025-09-10,yes,OVERDUE`);
      expect(read('canceled.csv')).toContain(
        `${CANCELED.code},4,2025-12-01,1,0,500,0,,แอดมิน,2026-01-15 10:00:00,`,
      );
      expect(read('canceled.csv')).not.toContain('10.0.0.1'); // canceled_ip ไม่ใส่
      expect(read('sample.csv').trimEnd().split('\n')).toHaveLength(4); // หัว + 3 สัญญาในแผน

      const summary = JSON.parse(read('summary.json'));
      expect(summary).toMatchObject({
        command: 'report',
        book: { contracts: 5 },
        plan: { contracts: { active: 2, history: 1, blocked: 2 } },
        blockers: { contracts: 2 },
        oldForm: 1,
        files: { missing: 0, failed: 0 },
      });
      expect(summary.plan.outstanding).toMatch(/^\d+\.\d{2}$/);
    });

    it('ไม่มีชื่อ เบอร์ เลขบัตรของลูกค้าในไฟล์ใด · เลขยาวในหมายเหตุยกเลิกถูกตัด', async () => {
      await runReport(reportArgs({ filesDir }), deps as never);
      const names = [
        'peak-recon.csv',
        'peak-recon-unmatched.csv',
        'bridge.csv',
        'summary.json',
        'blockers.csv',
        'canceled.csv',
        'money-mismatch.csv',
        'old-form.csv',
        'sample.csv',
        'customers-blocked.csv',
        'warnings.csv',
        'missing-files.csv',
      ];
      for (const name of names) {
        const text = read(name);
        for (const secret of [SECRET_NAME, ...PHONES, ...NIDS, '081-234-5678']) {
          expect({ name, leaked: text.includes(secret) }).toEqual({ name, leaked: false });
        }
      }
      expect(read('canceled.csv')).toContain('ลูกค้าขอยกเลิก โทร [ตัดตัวเลข]');
    });

    it('ไม่ส่ง --files-dir → ไม่มี missing-files.csv และไม่อ่านไฟล์แนบ', async () => {
      const uploadFiles = jest.fn();
      const outcome = await runReport(reportArgs(), { ...deps, uploadFiles } as never);
      expect(outcome.written).not.toContain('missing-files.csv');
      expect(uploadFiles).not.toHaveBeenCalled();
      expect(JSON.parse(read('summary.json')).files).toBeNull();
    });

    it('canceled.csv ที่เจ้าของกรอก resolution ส่งกลับเป็น --canceled-map ได้ → สัญญาไม่ติดตัวบล็อกอีก', async () => {
      await runReport(reportArgs(), deps as never);
      const filled = read('canceled.csv').replace(/,\n/, ',TERMINATED\n');
      const map = join(base, 'canceled-filled.csv');
      writeFileSync(map, filled);
      expect(parseCanceledMapCsv(filled).get(CANCELED.code)).toBe('TERMINATED');

      const outcome = await runReport(reportArgs({ canceledMap: map }), deps as never);
      expect(outcome.plan.blockers.map((b) => b.code)).not.toContain(CANCELED.code);
      expect(read('canceled.csv')).toContain(',TERMINATED\n');
    });

    it('--out ในโฟลเดอร์ของ repo → ปฏิเสธก่อนอ่าน dump', async () => {
      const loadBook = jest.fn();
      const insideRepo = resolve(__dirname, '..', '__out-must-not-exist__');
      await expect(
        runReport(reportArgs({ out: insideRepo }), { ...deps, loadBook } as never),
      ).rejects.toThrow(/ห้ามเขียนผลลัพธ์ลงในโฟลเดอร์ของ repo/);
      expect(loadBook).not.toHaveBeenCalled();
      expect(existsSync(insideRepo)).toBe(false);
    });
  });

  // ─── ตัวช่วย ─────────────────────────────────────────────────────────────────────────────────

  describe('parseCanceledMapCsv / parseCutoff / redactDigits', () => {
    it('ว่าง = ยังไม่ยืนยัน · ไม่สนตัวเล็กใหญ่ · ค่าผิด/ซ้ำ = throw บอกบรรทัด ไม่ยกค่า', () => {
      const map = parseCanceledMapCsv('legacy_code,resolution,extra\nA,closed_bad_debt,x\nB,,y\n');
      expect([...map]).toEqual([['A', 'CLOSED_BAD_DEBT']]);
      expect(() => parseCanceledMapCsv('legacy_code,resolution\nA,SECRET-VALUE\n')).toThrow(
        /บรรทัด 2 ช่อง resolution/,
      );
      expect(() => parseCanceledMapCsv('legacy_code,resolution\nA,SECRET-VALUE\n')).not.toThrow(
        /SECRET-VALUE/,
      );
      expect(() => parseCanceledMapCsv('legacy_code,resolution\nA,CANCELED\nA,CANCELED\n')).toThrow(
        /สัญญาซ้ำกับบรรทัด 2/,
      );
    });

    it('วันตัด = 23:59:59 กรุงเทพ · รูปแบบผิด/ไม่มีจริง = throw', () => {
      expect(parseCutoff('2026-11-30').toISOString()).toBe('2026-11-30T16:59:59.000Z');
      expect(() => parseCutoff('30/11/2026')).toThrow(/yyyy-mm-dd/);
      expect(() => parseCutoff('2026-02-30')).toThrow(/ไม่มีจริง/);
    });

    it('ตัดเลขยาว ≥ 9 หลัก (มีขีด/ช่องว่างคั่น) · ยอดเงินสั้นคงไว้', () => {
      expect(redactDigits('โทร 081-234-5678 บัตร 1 2345 67890 12 3 ค้าง 1,500')).toBe(
        'โทร [ตัดตัวเลข] บัตร [ตัดตัวเลข] ค้าง 1,500',
      );
      expect(redactDigits(null)).toBe('');
    });
  });

  // ─── main ────────────────────────────────────────────────────────────────────────────────────

  describe('main', () => {
    it('--help พิมพ์ทุกคำสั่ง · <คำสั่ง> --help พิมพ์ env และไฟล์ผลลัพธ์ · ไม่แตะอะไร', async () => {
      const lines: string[] = [];
      await main(['--help'], (l) => lines.push(l));
      expect(lines.join('\n')).toMatch(/report --dump/);
      expect(lines.join('\n')).toMatch(/import --dump/);

      lines.length = 0;
      await main(['import', '--help'], (l) => lines.push(l));
      const text = lines.join('\n');
      for (const env of [
        'EXPECTED_DB_NAME',
        'CONFIRM_LEGACY_IMPORT',
        'ALLOW_PROD_LEGACY_IMPORT',
        'PII_ENCRYPTION_KEY',
      ]) {
        expect(text).toContain(env);
      }
    });

    it('report: --out ในโฟลเดอร์ของ repo ถูกปฏิเสธก่อนอ่าน --dump (ไฟล์ไม่มีจริง)', async () => {
      const insideRepo = resolve(__dirname, '..', '__out-must-not-exist__');
      await expect(
        main([
          'report',
          '--dump',
          join(base, 'missing.sql'),
          '--peak-ar',
          peakAr,
          '--cutoff',
          '2026-11-30',
          '--out',
          insideRepo,
        ]),
      ).rejects.toThrow(/ห้ามเขียนผลลัพธ์ลงในโฟลเดอร์ของ repo/);
      expect(existsSync(insideRepo)).toBe(false);
    });

    it('import: ตัวเลือกตัวเลขผิดรูป → throw ก่อนต่อฐาน', async () => {
      await expect(
        main([
          'import',
          '--dump',
          'd.sql',
          '--peak-ar',
          'p.csv',
          '--files-dir',
          filesDir,
          '--cutoff',
          '2026-11-30',
          '--branch-id',
          'b',
          '--out',
          out,
          '--tx-timeout-min',
          '0',
        ]),
      ).rejects.toThrow(/--tx-timeout-min/);
    });
  });
});
