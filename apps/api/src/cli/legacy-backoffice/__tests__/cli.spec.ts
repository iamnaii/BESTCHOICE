import { Prisma } from '@prisma/client';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
import { parseCustomerOverridesCsv } from '../customer';
import type { DumpRow } from '../dump-reader';
import type { GateResult } from '../gates';
import { ensureBangkokTimeZone } from '../import-preflight';
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
import { parseMoneyOverridesCsv } from '../money';
import type { ImportPlan } from '../plan-import';
import {
  BLOCKERS_CSV_HEADER,
  customersBlockedCsv,
  dedupeGates,
  parseCanceledMapCsv,
  redactDigits,
} from '../report-files';
import { LegacyWriteBlocked, LegacyWriteError, type WriteReport } from '../writer';
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
const BUCKET = 'synthetic-bucket';
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
/** 1 ธ.ค. 2569 00:30 กรุงเทพ — คืนตัด (หลังวันตัด 30 พ.ย. หนึ่งวันตามปฏิทิน) */
const NOW = new Date('2026-11-30T17:30:00Z');
const DRY_BATCH = 'rehearsal-20261201003000';
const COMMIT_BATCH = 'legacy-20261201003000';
const BOM = '\uFEFF';

const paidFirst = (n: number) =>
  standardInstallments(
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [i + 1, { paid: i === 11 ? LAST : MONTHLY }]),
    ),
  );

/** ผ่อนอยู่ ค้างงวด 6 (ครบกำหนด 20 พ.ย. 2569 — ค้าง 10 วัน ณ วันตัด) */
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

/** CSV ยอดลูกหนี้ PEAK — ยอดคงเหลือ = ยอดค้างระบบเก่า (สังเคราะห์) + ใบที่ไม่พบสัญญาหนึ่งใบ */
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
  lines.push('TEST-INV-ORPHAN,TEST-CT-9,2026-01-05,9999.00,1234.56,');
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

function fakeReport(over: Partial<WriteReport> = {}): WriteReport {
  return {
    importBatch: 'batch-from-writer',
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
    ...over,
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

const stripBom = (text: string) => text.replace(/^\uFEFF/, '');

describe('legacy-backoffice-import CLI — report / import (Task 13)', () => {
  let base: string;
  let filesDir: string;
  let out: string;
  let peakAr: string;
  let dump: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'legacy-t13-'));
    filesDir = join(base, 'httpdocs');
    out = join(base, 'out');
    peakAr = join(base, 'peak-ar.csv');
    dump = join(base, 'dump.sql');
    writeFileSync(peakAr, peakArText([ACTIVE, HISTORY, OLD_FORM]));
    writeFileSync(dump, '-- synthetic dump (book injected by the test)\n');
    materialize(filesDir, REPORT_BOOK);
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  // ─── import ──────────────────────────────────────────────────────────────────────────────────

  describe('runImport', () => {
    type Harness = ReturnType<typeof harness>;

    function harness(
      over: {
        db?: string;
        piiRows?: unknown[];
        systemUser?: unknown;
        periods?: Array<{ year: number; month: number; status: string }>;
        overdueDays?: string | null;
        auditRow?: unknown;
      } = {},
    ) {
      const txErrors: unknown[] = [];
      const order: string[] = [];
      const tx = {
        user: {
          create: jest.fn(async (_args: { data: Record<string, unknown> }) => {
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
            over.systemUser === undefined
              ? { id: 'sys-user', isActive: false, isSystemUser: false }
              : over.systemUser,
          ),
          create: jest.fn(async (_args: { data: Record<string, unknown> }) => {
            order.push('user.create');
            return { id: 'sys-user-new' };
          }),
        },
        systemConfig: {
          findUnique: jest.fn(async () =>
            over.overdueDays == null ? null : { value: over.overdueDays },
          ),
        },
        accountingPeriod: { findMany: jest.fn(async () => over.periods ?? []) },
        auditLog: {
          findFirst: jest.fn(async () =>
            over.auditRow === undefined ? { id: 'audit-1' } : over.auditRow,
          ),
        },
        $transaction: jest.fn(
          async (cb: (client: typeof tx) => Promise<unknown>, _options?: unknown) => {
            order.push('$transaction');
            try {
              const value = await cb(tx);
              order.push('$transaction:end');
              return value;
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
        describe: () => ({ backend: 'gcs', location: BUCKET }),
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
        audit: {
          log: jest.fn(async () => {
            order.push('audit');
          }),
        },
        write: jest.fn(async () => fakeReport()) as unknown as ImportDeps['write'],
        runGates: jest.fn(
          async (): Promise<GateResult[]> => [
            { id: '6.1', pass: true, detail: 'ครบ' },
            { id: '6.2', pass: true, detail: 'ตรง PEAK' },
          ],
        ),
        peakApiConfigured: jest.fn(async () => false),
        now: () => NOW,
      };
      return { prisma, tx, txErrors, order, realStorage, realUpload, deps };
    }

    /** เขียนจริง — env ที่ต้องมีครบ */
    const commit = (h: Harness) => {
      h.deps.env.CONFIRM_LEGACY_IMPORT = 'YES_I_AM_SURE';
      h.deps.env.EXPECTED_STORAGE_BUCKET = BUCKET;
      return h;
    };

    const args = (over: Partial<ImportArgs> = {}): ImportArgs => ({
      dump,
      peakAr,
      filesDir,
      cutoff: '2026-11-30',
      branchId: 'branch-1',
      out,
      ...over,
    });

    const run = (h: Harness, over: Partial<ImportArgs> = {}, deps: Partial<ImportDeps> = {}) =>
      runImport(h.prisma as never, args(over), { ...h.deps, ...deps });

    /** โฟลเดอร์ผลลัพธ์ของรอบ (หนึ่งโฟลเดอร์ย่อยใต้ --out) */
    const runDir = () => {
      const dirs = readdirSync(out);
      expect(dirs).toHaveLength(1);
      return join(out, dirs[0]);
    };
    const readOut = (name: string) => readFileSync(join(runDir(), name), 'utf8');
    const result = () => JSON.parse(readOut('import-result.json'));
    const writerCall = (h: Harness) =>
      (h.deps.write as unknown as jest.Mock).mock.calls[0] as [
        unknown,
        ImportPlan,
        Record<string, unknown>,
      ];

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
      expect(h.order).toEqual(['$transaction']); // ไม่ถึง $transaction:end และไม่มี audit
      expect(h.deps.audit.log).not.toHaveBeenCalled();
      expect(outcome.auditLogged).toBeNull();
      expect(outcome.outDir).toBe(join(out, DRY_BATCH));
      expect(outcome.resultPath).toBe(join(out, DRY_BATCH, 'import-result.json'));
      expect(result()).toMatchObject({
        mode: 'dry-run',
        committed: false,
        outcome: 'DRY_RUN_ROLLED_BACK',
        importBatch: DRY_BATCH,
        book: { contracts: 3 },
      });
      // bridge.csv จากแผนที่ส่งให้ตัวเขียน + sample.csv อยู่ในโฟลเดอร์ของรอบ
      expect(stripBom(readOut('bridge.csv'))).toMatch(/^"?# ตารางเชื่อมยอดยกมา/);
      expect(readOut('sample.csv').startsWith(BOM)).toBe(true);
    });

    it('dry-run ใช้ storage ปลอม — ไม่สร้าง/ไม่เรียก storage จริง แต่ได้ key ของทุกไฟล์ (keyed · uploadedToStorage:false)', async () => {
      const h = harness();
      const outcome = await run(h);

      expect(h.deps.storage).not.toHaveBeenCalled();
      expect(h.realUpload).not.toHaveBeenCalled();
      const total = attachmentsOf(IMPORT_BOOK).length;
      expect(outcome.files).toEqual({
        attachmentPaths: total,
        keyed: total,
        uploadedToStorage: false,
        missing: 0,
        failed: 0,
      });
      const [, , writerDeps] = writerCall(h);
      expect((writerDeps.files as Map<string, unknown>).size).toBe(total);
      expect(writerDeps).toMatchObject({
        importBatch: DRY_BATCH,
        financeCompanyId: 'finance-co',
        branchId: 'branch-1',
        systemUserId: 'sys-user',
      });
    });

    it('เขียนจริง + ด่านผ่าน → COMMIT · อัปโหลดจริง · audit หลัง $transaction จบ แล้วอ่านกลับ · เวลาแต่ละขั้น · SHA-256 ไฟล์เข้า', async () => {
      const h = commit(harness());
      const outcome = await run(h);

      expect(outcome.committed).toBe(true);
      expect(outcome.outcome).toBe('COMMITTED');
      expect(h.txErrors).toHaveLength(0);
      expect(h.order).toEqual(['$transaction', '$transaction:end', 'audit']);
      expect(h.realUpload).toHaveBeenCalledTimes(outcome.files.keyed);
      expect(outcome.files.uploadedToStorage).toBe(true);
      expect(h.realUpload.mock.calls[0][0]).toMatch(/^legacy-import\//);
      expect(h.prisma.$transaction.mock.calls[0][1]).toEqual({
        timeout: 20 * 60_000,
        maxWait: 30_000,
      });
      expect(h.deps.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LEGACY_IMPORT_COMMITTED', userId: 'sys-user' }),
      );
      expect(h.prisma.auditLog.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { action: 'LEGACY_IMPORT_COMMITTED', entityId: 'batch-from-writer' },
        }),
      );
      expect(outcome.auditLogged).toBe(true);
      expect(outcome.outDir).toBe(join(out, COMMIT_BATCH));
      const r = result();
      expect(r).toMatchObject({
        mode: 'commit',
        committed: true,
        auditLogged: true,
        storage: { backend: 'gcs', location: BUCKET },
        files: { uploadedToStorage: true },
      });
      for (const phase of ['plan', 'upload', 'write', 'gates', 'total']) {
        expect(typeof r.timings[phase]).toBe('number');
      }
      expect(r.inputs.dump).toEqual({
        file: 'dump.sql',
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(r.inputs['peak-ar'].file).toBe('peak-ar.csv');
      const printed = h.deps.log.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toMatch(/ใช้เวลา.*รวม/);
    });

    it('COMMIT แล้วอ่านแถว audit กลับไม่เจอ → auditLogged:false + คำเตือน (ยังถือว่า committed)', async () => {
      const h = commit(harness({ auditRow: null }));
      const outcome = await run(h);
      expect(outcome.committed).toBe(true);
      expect(outcome.auditLogged).toBe(false);
      expect(result().auditLogged).toBe(false);
      const printed = h.deps.log.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toMatch(/ไม่พบแถว audit LEGACY_IMPORT_COMMITTED/);
    });

    it('ด่านใดไม่ผ่าน → rollback + committed:false แม้ตั้ง CONFIRM · ไม่เขียน audit · gate-failures.csv', async () => {
      const h = commit(harness());
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
      const failures = stripBom(readOut('gate-failures.csv')).split('\n');
      expect(failures[0]).toBe('gate,label,legacy_code,detail');
      expect(failures[1]).toMatch(new RegExp(`^6\\.2,.*,${ACTIVE.code},ส่วนต่าง 1\\.00$`));
    });

    it('ผลด่าน id ซ้ำรวมเป็นแถวเดียวก่อนพิมพ์/ตัดสิน (ไม่ผ่านถ้าแถวใดไม่ผ่าน)', async () => {
      const h = harness();
      h.deps.runGates.mockResolvedValueOnce([
        { id: '6.2', pass: true, detail: 'ก' },
        { id: '6.2', pass: false, detail: 'ข', failures: [{ code: ACTIVE.code, detail: 'x' }] },
      ]);
      const outcome = await run(h);
      expect(outcome.gates).toEqual([
        { id: '6.2', pass: false, detail: 'ก · ข', failures: [{ code: ACTIVE.code, detail: 'x' }] },
      ]);
      expect(outcome.outcome).toBe('GATES_FAILED');
    });

    it('ด่านรันในธุรกรรมเดียวกับตัวเขียน พร้อม bookContracts · seed ค่าเริ่มต้น = รหัสรอบ · seed ที่ส่งมาถูกบันทึก', async () => {
      const h = harness();
      await run(h);
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
      expect(result().sample.seed).toBe(DRY_BATCH);

      rmSync(out, { recursive: true, force: true });
      await run(harness(), { sampleSeed: 'seed-t13' });
      const sample = result().sample;
      expect(sample.seed).toBe('seed-t13');
      expect([...sample.codes].sort()).toEqual([ACTIVE.code, HISTORY.code, OLD_FORM.code].sort());
      expect(stripBom(readOut('sample.csv')).trimEnd().split('\n')).toHaveLength(4);
    });

    it('เกณฑ์ OVERDUE อ่านจาก SystemConfig overdue_days_threshold แล้วส่งให้ planImport (ไม่มีแถว = 7)', async () => {
      const byDefault = harness();
      await run(byDefault);
      const statusOf = (h: Harness) =>
        Object.fromEntries(writerCall(h)[1].items.map((i) => [i.code, i.status]));
      expect(statusOf(byDefault)[ACTIVE.code]).toBe('OVERDUE'); // ค้าง 10 วัน > 7
      expect(result().overdueDaysThreshold).toBe(7);

      rmSync(out, { recursive: true, force: true });
      const lenient = harness({ overdueDays: '30' });
      await run(lenient);
      expect(statusOf(lenient)[ACTIVE.code]).toBe('ACTIVE');
      expect(statusOf(lenient)[OLD_FORM.code]).toBe('OVERDUE');
      expect(result().overdueDaysThreshold).toBe(30);
    });

    it('ไม่ตั้ง EXPECTED_DB_NAME → throw ก่อนแตะฐาน', async () => {
      const h = harness();
      delete h.deps.env.EXPECTED_DB_NAME;
      await expect(run(h)).rejects.toThrow(/EXPECTED_DB_NAME/);
      expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
      expectNoWrites(h);
    });

    it('EXPECTED_DB_NAME ไม่ตรง current_database() → throw ก่อนเขียนใด ๆ', async () => {
      const h = commit(harness({ db: 'some_other_db' }));
      await expect(run(h)).rejects.toThrow(/ฐานไม่ตรง/);
      expectNoWrites(h);
      expect(existsSync(out)).toBe(false);
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

    it('เขียนจริง: ไม่ตั้ง EXPECTED_STORAGE_BUCKET / bucket ไม่ตรง → throw ก่อนแตะฐาน', async () => {
      const missing = harness();
      missing.deps.env.CONFIRM_LEGACY_IMPORT = 'YES_I_AM_SURE';
      await expect(run(missing)).rejects.toThrow(/EXPECTED_STORAGE_BUCKET/);
      expect(missing.prisma.$queryRaw).not.toHaveBeenCalled();
      expectNoWrites(missing);

      const wrong = commit(harness());
      wrong.deps.env.EXPECTED_STORAGE_BUCKET = 'bestchoice-documents';
      await expect(run(wrong)).rejects.toThrow(/EXPECTED_STORAGE_BUCKET=bestchoice-documents/);
      expectNoWrites(wrong);
    });

    it('เขียนจริงบนฐาน bestchoice ต้องเป็น GCS — S3 ถูกปฏิเสธ', async () => {
      const h = commit(harness({ db: 'bestchoice' }));
      h.deps.env.EXPECTED_DB_NAME = 'bestchoice';
      h.deps.env.ALLOW_PROD_LEGACY_IMPORT = 'YES_I_AM_SURE';
      const s3 = {
        ...h.realStorage,
        describe: () => ({ backend: 's3' as const, location: BUCKET }),
      };
      await expect(run(h, {}, { storage: async () => s3 })).rejects.toThrow(
        /ต้องอัปโหลดไฟล์แนบขึ้น GCS/,
      );
      expectNoWrites(h);
    });

    it.each(['none', 'local'] as const)(
      'เขียนจริงปฏิเสธ storage %s ก่อนแตะฐาน (ต้องเป็น GCS/S3)',
      async (backend) => {
        const h = commit(harness());
        const storage = { ...h.realStorage, describe: () => ({ backend, location: '' }) };
        await expect(run(h, {}, { storage: async () => storage })).rejects.toThrow(/GCS/);
        expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
        expectNoWrites(h);
      },
    );

    it.each([
      ['วันตัดอยู่หลังวันนี้', new Date('2026-11-29T05:00:00Z'), /อยู่หลังวันนี้/],
      ['วันตัดเก่ากว่า 7 วัน', new Date('2026-12-10T05:00:00Z'), /เก่ากว่า 7 วัน/],
    ])('เขียนจริง: %s → throw ก่อนแตะฐาน (dry-run ไม่ตรวจ)', async (_label, now, message) => {
      const h = commit(harness());
      await expect(run(h, {}, { now: () => now })).rejects.toThrow(message);
      expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
      expectNoWrites(h);

      const dry = harness();
      expect((await run(dry, {}, { now: () => now })).outcome).toBe('DRY_RUN_ROLLED_BACK');
    });

    it.each([
      [2026, 11, 'CLOSED'],
      [2026, 12, 'SYNCED'],
    ])(
      'งวดบัญชี FINANCE %i/%i %s → throw ก่อนอัปโหลด/ธุรกรรม (ไม่มีช่วงผ่อนผัน)',
      async (year, month, status) => {
        const h = harness({ periods: [{ year, month, status }] });
        await expect(run(h)).rejects.toThrow(/งวดบัญชี FINANCE .* ปิดแล้ว/);
        expect(h.prisma.accountingPeriod.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              companyId: 'finance-co',
              OR: [
                { year: 2026, month: 11 },
                { year: 2026, month: 12 },
              ],
            },
          }),
        );
        expectNoWrites(h);
      },
    );

    it('งวดบัญชีสถานะ REVIEW / OPEN → ผ่าน', async () => {
      const h = harness({
        periods: [
          { year: 2026, month: 11, status: 'REVIEW' },
          { year: 2026, month: 12, status: 'OPEN' },
        ],
      });
      expect((await run(h)).outcome).toBe('DRY_RUN_ROLLED_BACK');
    });

    it('PEAK API ตั้งค่าอยู่: เขียนจริงปฏิเสธก่อนเขียน · dry-run เตือนแล้วไปต่อ', async () => {
      const h = commit(harness());
      h.deps.peakApiConfigured.mockResolvedValue(true);
      await expect(run(h)).rejects.toThrow(/ปิดการส่ง PEAK ทาง API ก่อน/);
      expectNoWrites(h);

      const dry = harness();
      dry.deps.peakApiConfigured.mockResolvedValue(true);
      expect((await run(dry)).outcome).toBe('DRY_RUN_ROLLED_BACK');
      const printed = dry.deps.log.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toMatch(/รอบเขียนจริงจะปฏิเสธ/);
    });

    it('แผนมีตัวบล็อก → ไม่เรียก $transaction · เขียน blockers.csv + customers-blocked.csv (มี BOM) แล้วหยุด', async () => {
      const h = harness();
      h.deps.loadBook.mockResolvedValue({ book: REPORT_BOOK, contractRows: CONTRACT_ROWS });
      const outcome = await run(h);

      expect(outcome.outcome).toBe('PLAN_BLOCKED');
      expect(outcome.committed).toBe(false);
      expect(outcome.blockers.map((b) => b.reason)).toEqual(
        expect.arrayContaining(['CANCELED_UNCONFIRMED', 'INSTALLMENT_AMOUNT_MISMATCH']),
      );
      expectNoWrites(h);
      const csv = readOut('blockers.csv');
      expect(csv.startsWith(BOM)).toBe(true);
      expect(stripBom(csv).split('\n')[0]).toBe(BLOCKERS_CSV_HEADER.join(','));
      expect(csv).toContain(`${CANCELED.code},CANCELED_UNCONFIRMED,`);
      expect(readOut('customers-blocked.csv').startsWith(BOM)).toBe(true);
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
      expect(writerCall(h)[2].allowPlanBlockers).toBe(true);
      expect(existsSync(join(runDir(), 'blockers.csv'))).toBe(true);
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
      const h = commit(harness());
      await expect(run(h, { allowBlockers: true })).rejects.toThrow(/--allow-blockers/);
      expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
      expectNoWrites(h);
    });

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

    it('--out ที่มีผลของรอบก่อน → รอบนี้ลงโฟลเดอร์ย่อยของตัวเอง (ไม่มีไฟล์ค้างจากรอบก่อน)', async () => {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'gate-failures.csv'), 'stale');
      const outcome = await run(harness());
      expect(outcome.outDir).toBe(join(out, DRY_BATCH));
      expect(existsSync(join(outcome.outDir, 'gate-failures.csv'))).toBe(false);
    });

    it.each([
      ['กุญแจไม่ตรง', () => piiRows(WRONG_KEY, SALT), /PII_ENCRYPTION_KEY/],
      [
        'salt ไม่ตรง',
        () => piiRows(KEY, 'another-salt-for-the-same-cipher-000001'),
        /PII_HASH_SALT/,
      ],
    ])('ด่านกุญแจ/salt PII: %s → หยุดก่อนเขียน', async (_label, rows, message) => {
      const h = commit(harness({ piiRows: rows() }));
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
      const blocked = commit(harness({ piiRows: [] }));
      await expect(run(blocked)).rejects.toThrow(/ALLOW_UNVERIFIED_PII_KEYS/);
      expectNoWrites(blocked);

      const dry = harness({ piiRows: [] });
      expect((await run(dry)).outcome).toBe('DRY_RUN_ROLLED_BACK');
    });

    it('--money-overrides ทศนิยมเกิน 2 ตำแหน่ง → throw บอกบรรทัด/คอลัมน์ ก่อนเขียน', async () => {
      const h = harness();
      const file = join(base, 'money.csv');
      writeFileSync(
        file,
        `legacy_code,financed_amount,store_commission,vat_amount\n${ACTIVE.code},10000.005,1000,1190\n`,
      );
      await expect(run(h, { moneyOverrides: file })).rejects.toThrow(
        /บรรทัด 2 ช่อง financed_amount — ทศนิยมเกิน 2 ตำแหน่ง/,
      );
      expectNoWrites(h);
    });

    it('ตัวเขียนพบตัวบล็อกในฐาน (LegacyWriteBlocked) → rollback · customers-blocked.csv หนึ่งแถวต่อสมาชิก + ธงเลขบัตร', async () => {
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
      const customers = stripBom(readOut('customers-blocked.csv')).split('\n');
      expect(customers[0]).toBe(
        'legacy_member_code,customer_id,legacy_codes,outcomes,related_customer_ids,related_has_national_id,phone_invalid,peak_contact_codes,other_peak_contact_codes',
      );
      expect(customers[1]).toBe(
        `MC-1301,,${ACTIVE.code},CUSTOMER_PHONE_TAKEN,cu-phone-owner,yes,,,`,
      );
      expect(readOut('blockers.csv')).toContain(`${OLD_FORM.code},CONTRACT_NUMBER_TAKEN,`);
    });

    it('ตัวเขียน throw LegacyWriteError → WRITE_FAILED · บันทึกแค่ ขั้น / เลขสัญญา / คลาส / รหัส Prisma', async () => {
      const h = commit(harness());
      (h.deps.write as unknown as jest.Mock).mockRejectedValueOnce(
        new LegacyWriteError('payments', ACTIVE.code, 'PrismaClientKnownRequestError', 'P2002'),
      );
      const outcome = await run(h);
      expect(outcome.outcome).toBe('WRITE_FAILED');
      expect(outcome.committed).toBe(false);
      expect(h.deps.audit.log).not.toHaveBeenCalled();
      expect(result().writeError).toEqual({
        step: 'payments',
        legacyCode: ACTIVE.code,
        errorClass: 'PrismaClientKnownRequestError',
        prismaCode: 'P2002',
      });
    });

    it('มีสัญญาที่นำเข้าแล้ว (skippedExisting) → เขียนจริง rollback ALREADY_IMPORTED ไม่เขียน audit', async () => {
      const h = commit(harness());
      (h.deps.write as unknown as jest.Mock).mockResolvedValueOnce(
        fakeReport({ skippedExisting: [ACTIVE.code] }),
      );
      const outcome = await run(h);
      expect(outcome.outcome).toBe('ALREADY_IMPORTED');
      expect(outcome.committed).toBe(false);
      expect((h.txErrors[0] as Error).name).toBe('Rollback');
      expect(h.deps.audit.log).not.toHaveBeenCalled();
    });

    it('ไฟล์แนบหาไม่เจอเกิน --max-missing-files → หยุดก่อนธุรกรรม · missing-files.csv มี path', async () => {
      const h = harness();
      const missing = ACTIVE.files[0].path;
      unlinkSync(join(filesDir, missing));
      const outcome = await run(h, { maxMissingFiles: 0 });

      expect(outcome.outcome).toBe('FILES_MISSING');
      expect(outcome.files.missing).toBe(1);
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
      expect(readOut('missing-files.csv')).toContain(`missing,${missing},,${ACTIVE.code}`);
    });

    it('ไฟล์แนบหาไม่เจอไม่เกินเกณฑ์ → ไปต่อ (รายงานใน missing-files.csv)', async () => {
      const h = harness();
      unlinkSync(join(filesDir, ACTIVE.files[0].path));
      const outcome = await run(h);
      expect(outcome.outcome).toBe('DRY_RUN_ROLLED_BACK');
      expect(outcome.files.missing).toBe(1);
      expect(existsSync(join(runDir(), 'missing-files.csv'))).toBe(true);
    });

    it('อัปโหลดไม่สำเร็จ (failed) ตอนเขียนจริง → หยุดก่อนธุรกรรม (รันซ้ำได้)', async () => {
      const h = commit(harness());
      h.realUpload.mockRejectedValueOnce(new Error('network'));
      const outcome = await run(h);
      expect(outcome.outcome).toBe('FILES_FAILED');
      expect(outcome.files.failed).toBe(1);
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
      expect(h.deps.audit.log).not.toHaveBeenCalled();
    });

    it('บัญชีนำเข้ายังไม่มี: สร้างด้วย isSystemUser:false · เขียนจริงก่อนธุรกรรมหลัก · dry-run ในธุรกรรม', async () => {
      const committed = commit(harness({ systemUser: null }));
      await run(committed);
      expect(committed.order).toEqual(['user.create', '$transaction', '$transaction:end', 'audit']);
      expect(committed.tx.user.create).not.toHaveBeenCalled();
      expect(committed.prisma.user.create.mock.calls[0][0].data).toMatchObject({
        email: 'legacy-import@bestchoice.com',
        isActive: false,
        isSystemUser: false,
      });
      expect(writerCall(committed)[2].systemUserId).toBe('sys-user-new');

      rmSync(out, { recursive: true, force: true });
      const dry = harness({ systemUser: null });
      await run(dry);
      expect(dry.prisma.user.create).not.toHaveBeenCalled();
      expect(dry.order).toEqual(['$transaction', 'tx.user.create']);
      expect(dry.tx.user.create.mock.calls[0][0].data).toMatchObject({ isSystemUser: false });
      expect(writerCall(dry)[2].systemUserId).toBe('sys-user-tx');
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
          { code: 'P2002', clientVersion: 'test' },
        ),
      );
      await expect(run(prismaError)).rejects.toThrow();
      expect(result().error).toBe('PrismaClientKnownRequestError P2002');
      const text = readOut('import-result.json');
      expect(text).not.toContain(SECRET_NAME);
      expect(text).not.toContain(PHONES[0]);
    });

    it('import-result.json ไม่มีข้อมูลลูกค้า · นับข้อเตือน SATANG_GAP_UNEXPLAINED / PEAK_LOWER_UNEXPLAINED', async () => {
      await run(harness());
      const text = readOut('import-result.json');
      for (const secret of [SECRET_NAME, ...PHONES, ...NIDS]) expect(text).not.toContain(secret);
      expect(JSON.parse(text).warnings.unexplained).toEqual({
        SATANG_GAP_UNEXPLAINED: 0,
        PEAK_LOWER_UNEXPLAINED: 0,
      });
    });
  });

  // ─── report ──────────────────────────────────────────────────────────────────────────────────

  describe('runReport', () => {
    const reportArgs = (over: Partial<ReportArgs> = {}): ReportArgs => ({
      dump,
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
      now: () => NOW,
    };
    const read = (name: string) => readFileSync(join(out, name), 'utf8');
    /** บรรทัดแรกที่ไม่ใช่หมายเหตุ `#` (หลังตัด BOM) */
    const header = (name: string) =>
      stripBom(read(name))
        .split('\n')
        .find((l) => !l.startsWith('#')) as string;

    it('เขียนทุกไฟล์ด้วยหัวคอลัมน์ที่กำหนด (+ missing-files.csv เมื่อส่ง --files-dir) · CSV ทุกไฟล์มี BOM', async () => {
      const outcome = await runReport(reportArgs({ filesDir }), deps as never);

      const expected = [
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
      expect([...outcome.written].sort()).toEqual([...expected].sort());
      for (const name of expected.filter((n) => n.endsWith('.csv'))) {
        expect({ name, bom: read(name).startsWith(BOM) }).toEqual({ name, bom: true });
      }
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
        /^legacy_member_code,customer_id,legacy_codes,outcomes,/,
      );
      expect(header('warnings.csv')).toBe('legacy_code,kind,message');
      expect(header('missing-files.csv')).toBe('status,path,reason,legacy_codes');

      // bridge: # อธิบายเครื่องหมาย → หัวคอลัมน์ → สัญญาผ่อนอยู่ 2 สัญญา → TOTAL → ส่วนท้ายผูกกับไฟล์ PEAK ทั้งไฟล์
      const bridge = stripBom(read('bridge.csv')).trimEnd().split('\n');
      const notes = bridge.filter((l) => /^"?#/.test(l)).join(' ');
      expect(notes).toMatch(/52-1104/);
      expect(notes).toMatch(/53-1503/);
      const body = bridge.filter((l) => !/^"?#/.test(l));
      expect(body[0]).toMatch(
        /^legacy_code,status,peak_invoice_code,legacy_outstanding,peak_adjustment,satang_gap,peak_remain,/,
      );
      const totalIndex = body.findIndex((l) => l.startsWith('TOTAL,'));
      expect(body.slice(1, totalIndex).map((l) => l.split(',')[0])).toEqual([
        ACTIVE.code,
        OLD_FORM.code,
      ]);
      const totalRemain = body[totalIndex].split(',')[6];
      const footer = Object.fromEntries(
        body.slice(totalIndex + 1).map((l) => {
          const cells = l.split(',');
          return [cells[0], { count: cells[1], amount: cells[6] }];
        }),
      );
      const activeRemain = (c: LegacyContract) =>
        Number(peakMatch(c, 'x').invoice.remainAmount.toFixed(2));
      expect(footer.PEAK_AR_ALL_INVOICES).toEqual({
        count: '4',
        amount: (activeRemain(ACTIVE) + activeRemain(OLD_FORM) + 1234.56).toFixed(2),
      });
      expect(footer.LESS_UNMATCHED_OR_AMBIGUOUS).toEqual({ count: '1', amount: '1234.56' });
      expect(footer.LESS_HISTORY_CONTRACTS).toEqual({ count: '1', amount: '0.00' });
      expect(footer.EQUALS_IMPORTED_PEAK_REMAIN).toEqual({ count: '2', amount: totalRemain });
      expect(body.at(-1)).toBe('CHECK_OK');

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
      expect(stripBom(read('sample.csv')).trimEnd().split('\n')).toHaveLength(4); // หัว + 3 สัญญาในแผน

      const summary = JSON.parse(read('summary.json'));
      expect(summary).toMatchObject({
        command: 'report',
        book: { contracts: 5 },
        plan: { contracts: { active: 2, history: 1, blocked: 2 } },
        blockers: { contracts: 2 },
        oldForm: 1,
        files: { missing: 0, failed: 0 },
        canceled: { resolutions: ['CANCELED', 'CLOSED_BAD_DEBT'] },
        overdueDaysThreshold: { value: 7, source: 'default' },
        warnings: { unexplained: { SATANG_GAP_UNEXPLAINED: 0, PEAK_LOWER_UNEXPLAINED: 0 } },
      });
      expect(summary.inputs.dump).toEqual({
        file: 'dump.sql',
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(summary.inputs['peak-ar'].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(summary.plan.outstanding).toMatch(/^\d+\.\d{2}$/);
    });

    it('canceled.csv: หมายเหตุข้อมูลส่วนบุคคล + คำแนะนำสองค่า · บนจอบอกสองค่า · ไม่มีชื่อ/เบอร์/เลขบัตร · เลขยาวถูกตัด', async () => {
      const log = jest.fn();
      await runReport(reportArgs({ filesDir }), { ...deps, log } as never);
      const canceled = stripBom(read('canceled.csv')).split('\n');
      expect(canceled[0]).toBe(
        '# ข้อมูลส่วนบุคคล — เจ้าของเท่านั้น ห้ามส่งสำนักงานบัญชี/แชท (ชื่อแอดมินและข้อความอิสระของระบบเก่า)',
      );
      expect(canceled[1]).toMatch(
        /^# กรอกช่อง resolution: CANCELED \(ยกเลิกสัญญา\) หรือ CLOSED_BAD_DEBT/,
      );
      for (const line of [canceled[1], log.mock.calls.map((c) => String(c[0])).join('\n')]) {
        expect(line).not.toMatch(/TERMINATED|EXCHANGED/);
      }
      expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
        /CANCELED \(ยกเลิกสัญญา\) หรือ CLOSED_BAD_DEBT \(ปิดเป็นหนี้สูญ\)/,
      );

      for (const name of readdirSync(out)) {
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

    it('canceled.csv (มี BOM + หมายเหตุ #) ที่เจ้าของกรอก CANCELED ส่งกลับเป็น --canceled-map ได้ → สัญญาไม่ติดตัวบล็อกอีก', async () => {
      await runReport(reportArgs(), deps as never);
      const filled = read('canceled.csv').replace(/,\n/, ',CANCELED\n');
      const map = join(base, 'canceled-filled.csv');
      writeFileSync(map, filled);
      expect(parseCanceledMapCsv(filled).get(CANCELED.code)).toBe('CANCELED');

      const outcome = await runReport(reportArgs({ canceledMap: map }), deps as never);
      expect(outcome.plan.blockers.map((b) => b.code)).not.toContain(CANCELED.code);
      expect(read('canceled.csv')).toContain(',CANCELED\n');
    });

    it('canceled.csv ที่กรอก TERMINATED → --canceled-map ปฏิเสธ บอกบรรทัดและสองค่าที่ใช้ได้', async () => {
      await runReport(reportArgs(), deps as never);
      const filled = read('canceled.csv').replace(/,\n/, ',TERMINATED\n');
      const map = join(base, 'canceled-terminated.csv');
      writeFileSync(map, filled);
      await expect(runReport(reportArgs({ canceledMap: map }), deps as never)).rejects.toThrow(
        /บรรทัด 4 ช่อง resolution — ต้องเป็น CANCELED \(ยกเลิกสัญญา\) หรือ CLOSED_BAD_DEBT \(ปิดเป็นหนี้สูญ\)/,
      );
    });

    it('money-mismatch.csv ที่กรอกยอดแล้ว (ลบแถวที่ไม่กรอก) ส่งกลับเป็น --money-overrides ได้', async () => {
      await runReport(reportArgs(), deps as never);
      const [head, ...rows] = stripBom(read('money-mismatch.csv')).trimEnd().split('\n');
      const filled = rows
        .filter((l) => l.startsWith(MISMATCH.code))
        .map((l) => l.replace(`${MISMATCH.code},,,,`, `${MISMATCH.code},10000,1000,1190,`));
      const text = `${BOM}${head}\n${filled.join('\n')}\n`;
      expect(parseMoneyOverridesCsv(text).get(MISMATCH.code)?.financedAmount.toFixed(2)).toBe(
        '10000.00',
      );
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

  describe('ตัวช่วย', () => {
    it('parseCanceledMapCsv: สองค่าเท่านั้น · ว่าง = ยังไม่ยืนยัน · ไม่สนตัวเล็กใหญ่ · ค่าผิด/ซ้ำ = throw บอกบรรทัด ไม่ยกค่า', () => {
      const map = parseCanceledMapCsv('legacy_code,resolution,extra\nA,closed_bad_debt,x\nB,,y\n');
      expect([...map]).toEqual([['A', 'CLOSED_BAD_DEBT']]);
      for (const value of ['TERMINATED', 'EXCHANGED', 'SECRET-VALUE']) {
        const text = `legacy_code,resolution\nA,${value}\n`;
        expect(() => parseCanceledMapCsv(text)).toThrow(
          /บรรทัด 2 ช่อง resolution — ต้องเป็น CANCELED .* หรือ CLOSED_BAD_DEBT/,
        );
        expect(() => parseCanceledMapCsv(text)).not.toThrow(new RegExp(value));
      }
      expect(() => parseCanceledMapCsv('legacy_code,resolution\nA,CANCELED\nA,CANCELED\n')).toThrow(
        /สัญญาซ้ำกับบรรทัด 2/,
      );
    });

    it('parseCanceledMapCsv: ข้าม BOM + หมายเหตุ # (รวมที่ Excel ครอบ ") โดยเลขบรรทัดยังตรงไฟล์', () => {
      const text = `${BOM}# หมายเหตุ\r\n"# อีกบรรทัด"\r\nlegacy_code,resolution\r\nA,CANCELED\r\nB,BAD\r\n`;
      expect(() => parseCanceledMapCsv(text)).toThrow(/บรรทัด 5 ช่อง resolution/);
      expect([...parseCanceledMapCsv(text.replace('B,BAD', 'B,'))]).toEqual([['A', 'CANCELED']]);
    });

    it('customers-blocked.csv หนึ่งแถวต่อรหัสสมาชิก (หลายสัญญา/หลายเหตุรวมกัน) → กรอกแล้วอ่านด้วย --customer-overrides ได้', () => {
      const csv = customersBlockedCsv(
        [
          { code: 'C-1', reason: 'CUSTOMER_INVALID_NATIONAL_ID', detail: { memberCode: 'MC-9' } },
          {
            code: 'C-2',
            reason: 'CUSTOMER_PHONE_TAKEN',
            detail: { memberCode: 'MC-9', relatedCustomerId: 'cu-x', phoneInvalid: 'yes' },
          },
          { code: 'C-3', reason: 'MEMBER_NOT_FOUND' },
          { code: 'C-4', reason: 'CONTRACT_NUMBER_TAKEN' },
        ],
        new Map([['MC-7', 'cu-7']]),
        new Set<string>(),
      );
      const lines = csv.trimEnd().split('\n');
      expect(lines.slice(1)).toEqual([
        ',,C-3,MEMBER_NOT_FOUND,,,,,',
        'MC-7,cu-7,,OVERRIDE_APPLIED,,,,,',
        'MC-9,,C-1 C-2,CUSTOMER_INVALID_NATIONAL_ID CUSTOMER_PHONE_TAKEN,cu-x,no,yes,,',
      ]);
      const filled = [lines[0], lines[2], lines[3].replace('MC-9,,', 'MC-9,cu-9,')].join('\n');
      expect([...parseCustomerOverridesCsv(`${BOM}${filled}\n`)]).toEqual([
        ['MC-7', 'cu-7'],
        ['MC-9', 'cu-9'],
      ]);
    });

    it('redactDigits: ขีด ช่องว่าง จุด วงเล็บ ทับ เลขไทย และ +66 · ยอดเงินสั้นคงไว้', () => {
      expect(
        redactDigits(
          'โทร 081-234-5678 · 081.234.5678 · (081)2345678 · 08/1234/5678 · ๐๘๑๒๓๔๕๖๗๘ · +66812345678 · บัตร 1 2345 67890 12 3 · ค้าง 1,500',
        ),
      ).toBe(
        'โทร [ตัดตัวเลข] · [ตัดตัวเลข] · ([ตัดตัวเลข] · [ตัดตัวเลข] · [ตัดตัวเลข] · [ตัดตัวเลข] · บัตร [ตัดตัวเลข] · ค้าง 1,500',
      );
      expect(redactDigits(null)).toBe('');
    });

    it('parseCutoff: 23:59:59 กรุงเทพ · รูปแบบผิด/ไม่มีจริง = throw', () => {
      expect(parseCutoff('2026-11-30').toISOString()).toBe('2026-11-30T16:59:59.000Z');
      expect(() => parseCutoff('30/11/2026')).toThrow(/yyyy-mm-dd/);
      expect(() => parseCutoff('2026-02-30')).toThrow(/ไม่มีจริง/);
    });

    it('dedupeGates: รวม id ซ้ำ ลำดับตามที่พบครั้งแรก', () => {
      expect(
        dedupeGates([
          { id: '6.1', pass: true, detail: 'a' },
          { id: '6.2', pass: true, detail: 'b' },
          { id: '6.1', pass: true, detail: 'a' },
        ]),
      ).toEqual([
        { id: '6.1', pass: true, detail: 'a' },
        { id: '6.2', pass: true, detail: 'b' },
      ]);
    });

    it('ensureBangkokTimeZone: ตั้ง TZ แล้วตรวจกับ Intl — ไม่ใช่กรุงเทพ = throw', () => {
      const env: Record<string, string | undefined> = {};
      expect(() => ensureBangkokTimeZone(env, () => 'Asia/Bangkok')).not.toThrow();
      expect(env.TZ).toBe('Asia/Bangkok');
      expect(() => ensureBangkokTimeZone({}, () => 'UTC')).toThrow(/UTC ไม่ใช่ Asia\/Bangkok/);
    });
  });

  // ─── main ────────────────────────────────────────────────────────────────────────────────────

  describe('main', () => {
    /** ด่านเขตเวลาตัวแทน — jest ให้สำเนา process.env การตั้ง TZ จริงจึงไม่มีผล (ตัวด่านเองทดสอบใน "ตัวช่วย") */
    const harness = () => {
      const order: string[] = [];
      const ensureTz = jest.fn(() => {
        order.push('tz');
      });
      const log = (line: string) => {
        order.push('log');
        lines.push(line);
      };
      const lines: string[] = [];
      return { order, ensureTz, log, lines };
    };

    it('ด่านเขตเวลาทำเป็นอย่างแรก · --help พิมพ์ทุกคำสั่ง · <คำสั่ง> --help พิมพ์ env และไฟล์ผลลัพธ์', async () => {
      const h = harness();
      await main(['--help'], h.log, h.ensureTz);
      expect(h.ensureTz).toHaveBeenCalledTimes(1);
      expect(h.order[0]).toBe('tz');
      expect(h.lines.join('\n')).toMatch(/report --dump/);
      expect(h.lines.join('\n')).toMatch(/import --dump/);

      const imp = harness();
      await main(['import', '--help'], imp.log, imp.ensureTz);
      expect(imp.order[0]).toBe('tz');
      const text = imp.lines.join('\n');
      for (const env of [
        'EXPECTED_DB_NAME',
        'CONFIRM_LEGACY_IMPORT',
        'ALLOW_PROD_LEGACY_IMPORT',
        'PII_ENCRYPTION_KEY',
        'ALLOW_UNVERIFIED_PII_KEYS',
        'EXPECTED_STORAGE_BUCKET',
        'STORAGE_LOCAL_DIR',
      ]) {
        expect(text).toContain(env);
      }
      expect(text).toMatch(/rollback ทิ้งแถวนี้ไว้/);

      const rep = harness();
      await main(['report', '--help'], rep.log, rep.ensureTz);
      expect(rep.order[0]).toBe('tz');
      expect(rep.lines.join('\n')).toMatch(/CANCELED \(ยกเลิกสัญญา\) หรือ CLOSED_BAD_DEBT/);
      expect(rep.lines.join('\n')).not.toMatch(/TERMINATED/);
    });

    it('ด่านเขตเวลา throw → main หยุดทันที ไม่พิมพ์/ไม่อ่านอะไร', async () => {
      const lines: string[] = [];
      await expect(
        main(
          ['--help'],
          (l) => lines.push(l),
          () => {
            throw new Error('เขตเวลาของโปรเซสเป็น UTC ไม่ใช่ Asia/Bangkok');
          },
        ),
      ).rejects.toThrow(/UTC ไม่ใช่ Asia\/Bangkok/);
      expect(lines).toEqual([]);
    });

    it('ค่าเริ่มต้นของด่านคือ ensureBangkokTimeZone (CLI จริง)', () => {
      expect(main.length).toBe(0); // ทุกพารามิเตอร์มีค่าเริ่มต้น — require.main เรียก main() ตรง ๆ
      expect(String(main)).toMatch(/ensureBangkokTimeZone/);
    });

    it('report: --out ในโฟลเดอร์ของ repo ถูกปฏิเสธก่อนอ่าน --dump (ไฟล์ไม่มีจริง)', async () => {
      const h = harness();
      const insideRepo = resolve(__dirname, '..', '__out-must-not-exist__');
      await expect(
        main(
          [
            'report',
            '--dump',
            join(base, 'missing.sql'),
            '--peak-ar',
            peakAr,
            '--cutoff',
            '2026-11-30',
            '--out',
            insideRepo,
          ],
          h.log,
          h.ensureTz,
        ),
      ).rejects.toThrow(/ห้ามเขียนผลลัพธ์ลงในโฟลเดอร์ของ repo/);
      expect(h.ensureTz).toHaveBeenCalledTimes(1);
      expect(existsSync(insideRepo)).toBe(false);
    });

    it('import: ตัวเลือกตัวเลขผิดรูป → throw ก่อนต่อฐาน', async () => {
      const h = harness();
      await expect(
        main(
          [
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
          ],
          h.log,
          h.ensureTz,
        ),
      ).rejects.toThrow(/--tx-timeout-min/);
      expect(h.ensureTz).toHaveBeenCalledTimes(1);
    });
  });
});
