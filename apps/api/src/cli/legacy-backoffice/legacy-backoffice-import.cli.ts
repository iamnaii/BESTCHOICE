/**
 * ตัวนำเข้าข้อมูลระบบเก่า (backoffice) — คำสั่งย่อยหนึ่งคำสั่งต่อหนึ่งงาน
 *
 *   npm --prefix apps/api run import:legacy-backoffice -- <คำสั่ง> [--ตัวเลือก ค่า ...]
 *   npm --prefix apps/api run import:legacy-backoffice -- <คำสั่ง> --help
 *
 * | คำสั่ง | ทำอะไร |
 * |---|---|
 * | `peak-recon --dump <sql> --peak-ar <csv> --out <dir> [--peak-pairs <csv>]` | จับคู่ใบแจ้งหนี้ PEAK กับสัญญา → `peak-recon.csv` + `peak-recon-unmatched.csv` (ไม่แตะฐานข้อมูล) · `--peak-pairs` = คู่ที่เจ้าของกำหนดเอง หัวคอลัมน์ `invoice_code,legacy_code` |
 * | `match-statement --dump <sql> --statement <csv> --cols date=<หัว>,amount=<หัว>[,description=<หัว>] --out <dir>` | จับคู่เงินเข้าใน statement ธนาคารกับรายการรับเงินของระบบเก่า (ยอดเท่ากัน ±3 วัน) → `unmatched.csv` + `ambiguous.csv` (ไม่แตะฐานข้อมูล) · `--cols` = ชื่อหัวคอลัมน์ในไฟล์ statement |
 * | `report --dump --peak-ar --cutoff <yyyy-mm-dd> --out [--peak-pairs --money-overrides --customer-overrides --files-dir --sample-seed]` | แผนนำเข้าแบบไม่แตะฐาน → รายงานให้เจ้าของ/สำนักงานบัญชี (รายชื่อไฟล์ใน `REPORT_FILES`) |
 * | `import --dump --peak-ar --files-dir --cutoff --branch-id --out [--peak-pairs --money-overrides --customer-overrides --tx-timeout-min 20 --max-missing-files 10 --storage-prefix legacy-import --sample-seed --allow-blockers]` | นำเข้าในธุรกรรมเดียว — **ค่าเริ่มต้น dry-run** (เขียนแล้ว rollback) · ด่านกันและลำดับอยู่ที่ `runImport` · ผลลัพธ์ลงโฟลเดอร์ย่อย `<--out>/<รหัสรอบ>/` |
 *
 * dump / CSV / โฟลเดอร์ไฟล์แนบ / โฟลเดอร์ผลลัพธ์ อยู่นอก repo เสมอ (มีข้อมูลลูกค้าจริง) — ส่งเข้ามาด้วย path เท่านั้น ·
 * `--out` และ `--files-dir` ที่อยู่ในโฟลเดอร์ของ repo ถูกปฏิเสธก่อนอ่านไฟล์ใด (`repo-guard.ts`) ·
 * ข้อความบนจอมีแต่จำนวน/รหัส ไม่มีชื่อ เบอร์ เลขบัตรของลูกค้า · error ของ Prisma พิมพ์แค่ชื่อคลาส/รหัส (ข้อความยกค่าในแถวได้) ·
 * CSV ทุกไฟล์มี UTF-8 BOM (Excel อ่านภาษาไทยได้ · ตัวอ่าน `readCsv` รับ BOM) · `main` ตั้ง `TZ=Asia/Bangkok` ก่อน `Date` ตัวแรก
 *
 * เพิ่มคำสั่ง: เติมรายการใน `COMMANDS` (ตัวเลือกของคำสั่งนั้น + ฟังก์ชันที่รับค่าที่อ่านแล้ว)
 */

import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { AuditService } from '../../modules/audit/audit.service';
import { CustomerPiiService } from '../../modules/customers/customer-pii.service';
import { JournalAutoService } from '../../modules/journal/journal-auto.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { bangkokDateString } from '../../utils/date.util';
import { parseCustomerOverridesCsv } from './customer';
import { readDumpTables } from './dump-reader';
import { uploadLegacyFiles, type LegacyFileStorage, type LegacyFileUploadResult } from './files';
import { GATE_LABELS, runGates, sampleForManualCheck, type GateResult } from './gates';
import {
  assertCommitStorage,
  assertCutoffWindow,
  assertPeriodsOpen,
  assertPiiKeys,
  assertProdAllowed,
  assertProdStorage,
  ensureBangkokTimeZone,
  importMode,
  piiSecrets,
  PROD_DB_NAME,
  readOverdueDaysThreshold,
  samplePiiKeys,
  sha256File,
  type Env,
  type ImportStorage,
} from './import-preflight';
import { buildLegacyBook, LEGACY_TABLES, type LegacyBook } from './legacy-book';
import { parseMoneyOverridesCsv } from './money';
import {
  activeOutstandingMismatches,
  parsePeakArCsv,
  parsePeakPairsCsv,
  peakReconCsv,
  peakReconUnmatchedCsv,
  reconcileWithPeak,
  type PeakInvoice,
  type PeakRecon,
} from './peak-recon';
import {
  DEFAULT_OVERDUE_DAYS_THRESHOLD,
  planImport,
  type ImportBlocker,
  type ImportOptions,
  type ImportPlan,
} from './plan-import';
import { assertOutsideRepo } from './repo-guard';
import {
  assertMoneyOverridesTwoDecimals,
  blockersCsv,
  bridgeCsv,
  countBy,
  customersBlockedCsv,
  dedupeGates,
  gateFailuresCsv,
  missingFilesCsv,
  moneyMismatchCsv,
  oldFormCsv,
  planWarnings,
  sampleCsv,
  toJsonSafe,
  warningsCsv,
  warningSummary,
} from './report-files';
import {
  matchStatement,
  parseStatementCols,
  parseStatementCsv,
  statementCreditsCsv,
} from './statement-matcher';
import {
  LegacyWriteBlocked,
  LegacyWriteError,
  legacyImportAuditEntry,
  writeLegacyImport,
  type WriteReport,
  type WriterDeps,
} from './writer';

export type { ImportStorage } from './import-preflight';

const LOG = '[legacy-backoffice-import]';
/** บัญชี "ย้ายจากระบบเก่า" (ล็อกอินไม่ได้ — migration `20260520000000` · ซ่อนจากรายชื่อผู้ใช้ด้วยอีเมล `users.service.ts`) */
export const LEGACY_SYSTEM_USER_EMAIL = 'legacy-import@bestchoice.com';
const DISABLED_PASSWORD = 'DISABLED_SERVICE_ACCOUNT_NOT_LOGIN_CAPABLE';
const AUDIT_ACTION = 'LEGACY_IMPORT_COMMITTED';
const DEFAULT_TX_TIMEOUT_MIN = 20;
const DEFAULT_MAX_MISSING_FILES = 10;
const DEFAULT_STORAGE_PREFIX = 'legacy-import';
const TX_MAX_WAIT_MS = 30_000;
const SAMPLE_SIZE = 20;
const PROGRESS_EVERY = 1000;
const BOM = '\uFEFF';

/** ไฟล์ที่คำสั่ง `report` เขียน (`missing-files.csv` เฉพาะเมื่อส่ง `--files-dir`) */
export const REPORT_FILES = [
  'peak-recon.csv',
  'peak-recon-unmatched.csv',
  'bridge.csv',
  'summary.json',
  'blockers.csv',
  'money-mismatch.csv',
  'old-form.csv',
  'sample.csv',
  'customers-blocked.csv',
  'warnings.csv',
] as const;

/** seed ของการสุ่ม 6.8 ของ `report` — ค่าเดียวกับที่ `sampleForManualCheck` ใช้เมื่อไม่ส่ง (ผูกกับวันตัด) · `import` ใช้รหัสรอบ */
export function defaultSampleSeed(cutoff: Date): string {
  return `legacy-sample:${cutoff.toISOString()}`;
}

// ─── ตัวช่วยร่วม ─────────────────────────────────────────────────────────────────────────────────

type Values = Record<string, string | boolean | undefined>;

type Command = {
  usage: string;
  /** คำอธิบายเพิ่มของ `--help` (env / ไฟล์ผลลัพธ์) */
  help?: string;
  /** ตัวเลือกแบบมีค่าทั้งหมด (`--name value`) — ตัวเลือกที่ไม่รู้จัก = error */
  options: readonly string[];
  /** ตัวเลือกแบบไม่มีค่า (`--name`) */
  flags?: readonly string[];
  run(values: Values): Promise<void>;
};

function required(values: Values, name: string): string {
  const value = values[name];
  if (typeof value !== 'string' || !value) throw new Error(`ต้องระบุ --${name}`);
  return value;
}

function optional(values: Values, name: string): string | undefined {
  const value = values[name];
  return typeof value === 'string' && value ? value : undefined;
}

/** เขียนไฟล์ผลลัพธ์ลง `outDir` (สร้างโฟลเดอร์ให้) — `.csv` ขึ้นต้นด้วย UTF-8 BOM · คืนชื่อไฟล์ที่เขียน */
async function writeOutputs(outDir: string, files: Record<string, string>): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(outDir, name), name.endsWith('.csv') ? BOM + content : content, 'utf8');
  }
  return Object.keys(files);
}

/** `--cutoff yyyy-mm-dd` → 23:59:59 ของวันนั้นตามเวลากรุงเทพ (Global Constraints) */
export function parseCutoff(text: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('--cutoff ต้องเป็น yyyy-mm-dd');
  const cutoff = new Date(`${text}T23:59:59+07:00`);
  if (Number.isNaN(cutoff.getTime()) || bangkokDateString(cutoff) !== text) {
    throw new Error('--cutoff เป็นวันที่ที่ไม่มีจริง');
  }
  return cutoff;
}

function parseIntOption(
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    throw new Error(`--${name} ต้องเป็นจำนวนเต็ม ${min}–${max}`);
  }
  return Number(raw);
}

/** `--out` ต้องอยู่นอก repo — repo เป็นสาธารณะ */
function assertOutDir(outDir: string): void {
  assertOutsideRepo(outDir);
}

/**
 * `--files-dir` = โฟลเดอร์ `httpdocs` ที่แตกจาก zip (`files.ts`) — นอก repo (รูปบัตร/สลิปของลูกค้าจริง) และต้องมีทั้ง
 * `uploads/` และ `upload/` (ส่งโฟลเดอร์ชั้นนอก/ชั้นใน = ทุกไฟล์กลายเป็น missing)
 */
export async function assertFilesDir(filesDir: string): Promise<void> {
  try {
    assertOutsideRepo(filesDir);
  } catch {
    throw new Error(
      '--files-dir ต้องอยู่นอกโฟลเดอร์ของ repo — ไฟล์แนบคือรูปบัตร/สลิปของลูกค้าจริง และ repo เป็นสาธารณะ · แตก zip ไว้นอก repo แล้วชี้โฟลเดอร์ httpdocs',
    );
  }
  for (const sub of ['uploads', 'upload']) {
    const ok = await stat(join(filesDir, sub)).then(
      (s) => s.isDirectory(),
      () => false,
    );
    if (!ok) {
      throw new Error(
        `--files-dir ต้องเป็นโฟลเดอร์ httpdocs ที่แตกจาก zip ของระบบเก่า (มีโฟลเดอร์ย่อย uploads/ และ upload/) — ไม่พบ ${sub}/`,
      );
    }
  }
}

/** storage ปลอมของ dry-run / report — ได้ key + missing ครบโดยไม่มีไฟล์ขึ้น bucket (carry C-2 ของ Task 9) */
export const DRY_RUN_STORAGE: LegacyFileStorage = {
  configured: true,
  upload: async (key: string) => key,
};

/** นับความคืบหน้าทุก `PROGRESS_EVERY` ไฟล์ (ไม่พิมพ์ path) */
function withProgress(
  storage: LegacyFileStorage,
  total: number,
  log: (line: string) => void,
): LegacyFileStorage {
  let done = 0;
  return {
    configured: storage.configured,
    upload: async (key, body, contentType) => {
      const result = await storage.upload(key, body, contentType);
      done++;
      if (done % PROGRESS_EVERY === 0 || done === total) log(`  ไฟล์แนบ ${done}/${total}`);
      return result;
    },
  };
}

/** ข้อความ error ที่พิมพ์ได้ — Prisma: ชื่อคลาส + รหัส (ข้อความยกค่าในแถว = PII) */
export function safeErrorText(error: unknown): string {
  const isPrisma =
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientInitializationError;
  if (isPrisma) {
    const code = (error as { code?: unknown }).code;
    return `${error.name}${typeof code === 'string' ? ` ${code}` : ''}`;
  }
  return error instanceof Error ? error.message : String(error);
}

const ms = (since: number) => Math.round(performance.now() - since);

// ─── อ่านข้อมูลเข้า (dump · PEAK · ไฟล์ของเจ้าของ) ────────────────────────────────────────────────

export type LegacyInputs = { book: LegacyBook };

/** dump → book */
export async function loadLegacyInputs(dumpPath: string): Promise<LegacyInputs> {
  return { book: buildLegacyBook(await readDumpTables(dumpPath, LEGACY_TABLES)) };
}

type CommonArgs = {
  dump: string;
  peakAr: string;
  peakPairs?: string;
  cutoff: string;
  moneyOverrides?: string;
  customerOverrides?: string;
  /** seed ของ `sampleForManualCheck` (report ไม่ส่ง = `defaultSampleSeed(วันตัด)` · import ไม่ส่ง = รหัสรอบ) */
  sampleSeed?: string;
};

/** ไฟล์เข้าที่ใช้ + SHA-256 (หลักฐานว่ารอบที่เขียนใช้ข้อมูลชุดเดียวกับตารางเชื่อมยอดที่เซ็นรับ) */
type InputHashes = Record<string, { file: string; sha256: string }>;

type Inputs = LegacyInputs & {
  recon: PeakRecon;
  invoices: PeakInvoice[];
  pairCount: number;
  hashes: InputHashes;
  opts: Omit<ImportOptions, 'files'>;
};

async function loadInputs(
  args: CommonArgs,
  cutoff: Date,
  loadBook: (dumpPath: string) => Promise<LegacyInputs>,
): Promise<Inputs> {
  const hashes: InputHashes = {};
  const hash = async (name: string, path: string | undefined) => {
    if (path) hashes[name] = { file: basename(path), sha256: await sha256File(path) };
  };
  await hash('dump', args.dump);
  await hash('peak-ar', args.peakAr);
  await hash('peak-pairs', args.peakPairs);
  await hash('money-overrides', args.moneyOverrides);
  await hash('customer-overrides', args.customerOverrides);

  const { book } = await loadBook(args.dump);
  const invoices = parsePeakArCsv(await readFile(args.peakAr, 'utf8'));
  const pairs = args.peakPairs ? parsePeakPairsCsv(await readFile(args.peakPairs, 'utf8')) : [];
  const recon = reconcileWithPeak(book, invoices, pairs);
  const text = (path: string | undefined) => (path ? readFile(path, 'utf8') : null);
  const moneyText = await text(args.moneyOverrides);
  if (moneyText !== null) assertMoneyOverridesTwoDecimals(moneyText);
  const customerText = await text(args.customerOverrides);
  return {
    book,
    recon,
    invoices,
    pairCount: pairs.length,
    hashes,
    opts: {
      cutoff,
      peakRecon: recon,
      moneyOverrides: moneyText === null ? new Map() : parseMoneyOverridesCsv(moneyText),
      customerOverrides:
        customerText === null ? new Map() : parseCustomerOverridesCsv(customerText),
    },
  };
}

const attachmentPathsOf = (plan: ImportPlan) => [
  ...new Set(plan.items.flatMap((i) => i.attachmentPaths)),
];

/** จำนวนสัญญาที่ข้ามตามเหตุผล เช่น `status-0 <n> · status-4-canceled <n>` */
function skippedText(byReason: Record<string, number>): string {
  return (
    Object.entries(byReason)
      .map(([reason, n]) => `${reason} ${n}`)
      .join(' · ') || '-'
  );
}

function blockerSummary(rows: readonly ImportBlocker[]) {
  return {
    count: rows.length,
    contracts: new Set(rows.map((r) => r.code)).size,
    byReason: countBy(rows, (r) => r.reason),
  };
}

// ─── report ──────────────────────────────────────────────────────────────────────────────────────

export type ReportArgs = CommonArgs & { out: string; filesDir?: string };

export type ReportDeps = {
  log: (line: string) => void;
  loadBook: (dumpPath: string) => Promise<LegacyInputs>;
  uploadFiles: typeof uploadLegacyFiles;
  sampleForManualCheck: typeof sampleForManualCheck;
  now: () => Date;
};

export type ReportOutcome = { plan: ImportPlan; written: string[] };

/**
 * `report` — แผนนำเข้าแบบไม่แตะฐานข้อมูล แล้วเขียนรายงาน (`REPORT_FILES` + `missing-files.csv` เมื่อส่ง `--files-dir`)
 * ลง `--out` (นอก repo) · `--files-dir` = ตรวจไฟล์แนบด้วย storage ปลอม (อ่านไฟล์ ไม่อัปโหลด) · ไม่อ่าน SystemConfig —
 * สถานะ OVERDUE ใช้เกณฑ์ค่าเริ่มต้น 7 วัน (`import` อ่าน `overdue_days_threshold` จากฐาน)
 */
export async function runReport(
  args: ReportArgs,
  deps: Partial<ReportDeps> = {},
): Promise<ReportOutcome> {
  const d: ReportDeps = {
    log: (line) => console.log(line),
    loadBook: loadLegacyInputs,
    uploadFiles: uploadLegacyFiles,
    sampleForManualCheck,
    now: () => new Date(),
    ...deps,
  };
  assertOutDir(args.out);
  if (args.filesDir) await assertFilesDir(args.filesDir);
  const cutoff = parseCutoff(args.cutoff);

  const inputs = await loadInputs(args, cutoff, d.loadBook);
  const { book, recon, opts } = inputs;
  let plan = planImport(book, opts);
  let upload: LegacyFileUploadResult | null = null;
  if (args.filesDir) {
    const paths = attachmentPathsOf(plan);
    d.log(`${LOG} report: ตรวจไฟล์แนบ ${paths.length} ไฟล์ (อ่านอย่างเดียว ไม่อัปโหลด)`);
    upload = await d.uploadFiles(
      args.filesDir,
      paths,
      withProgress(DRY_RUN_STORAGE, paths.length, d.log),
    );
    plan = planImport(book, { ...opts, files: upload.details });
  }
  const sampleSeed = args.sampleSeed ?? defaultSampleSeed(plan.cutoff);
  const sampleCodes = d.sampleForManualCheck(plan, SAMPLE_SIZE, sampleSeed);
  const warnings = planWarnings(plan);
  const skippedByReason = countBy(plan.skipped, (s) => s.reason);

  const summary = {
    command: 'report',
    generatedAt: d.now(),
    cutoff: plan.cutoff,
    catchUpAt: plan.catchUpAt,
    inputs: inputs.hashes,
    inputCounts: {
      peakInvoices: inputs.invoices.length,
      peakPairs: inputs.pairCount,
      moneyOverrides: opts.moneyOverrides.size,
      customerOverrides: opts.customerOverrides.size,
      filesDir: Boolean(args.filesDir),
    },
    overdueDaysThreshold: { value: DEFAULT_OVERDUE_DAYS_THRESHOLD, source: 'default' },
    book: {
      contracts: book.contracts.length,
      byLegacyStatus: countBy(book.contracts, (c) => c.statusCode),
      members: book.members.size,
      anomalies: book.anomalies.length,
    },
    peakRecon: {
      matched: recon.matched.size,
      activeOutstandingMismatches: activeOutstandingMismatches(book, recon),
      unmatchedActiveContracts: recon.unmatchedContracts.length,
      ambiguousInvoices: recon.ambiguous.length,
      unmatchedInvoices: recon.unmatchedInvoices.length,
    },
    plan: plan.totals,
    blockers: blockerSummary(plan.blockers),
    skipped: { count: plan.skipped.length, byReason: skippedByReason },
    oldForm: plan.oldFormCodes.length,
    warnings: warningSummary(warnings),
    files: upload
      ? {
          attachmentPaths: attachmentPathsOf(plan).length,
          found: upload.details.size,
          missing: upload.missing.length,
          failed: upload.failed.length,
        }
      : null,
    sample: { seed: sampleSeed, count: sampleCodes.length },
  };

  const files: Record<string, string> = {
    'peak-recon.csv': peakReconCsv(book, recon),
    'peak-recon-unmatched.csv': peakReconUnmatchedCsv(book, recon),
    'bridge.csv': bridgeCsv(book, recon, plan, inputs.invoices),
    'summary.json': `${JSON.stringify(toJsonSafe(summary), null, 2)}\n`,
    'blockers.csv': blockersCsv(plan.blockers),
    'money-mismatch.csv': moneyMismatchCsv(book, plan, opts.moneyOverrides),
    'old-form.csv': oldFormCsv(book, plan),
    'sample.csv': sampleCsv(plan, sampleCodes),
    'customers-blocked.csv': customersBlockedCsv(plan.blockers, opts.customerOverrides),
    'warnings.csv': warningsCsv(plan),
  };
  if (upload) files['missing-files.csv'] = missingFilesCsv(plan, upload);
  const written = await writeOutputs(args.out, files);

  const t = plan.totals;
  const unexplained = warningSummary(warnings).unexplained;
  d.log(`${LOG} report (ไม่แตะฐานข้อมูล) · วันตัด ${bangkokDateString(cutoff)}`);
  d.log(`  สัญญาในระบบเก่า            : ${book.contracts.length}`);
  d.log(
    `  นำเข้าได้                   : ${plan.items.length} (ผ่อนอยู่ ${t.contracts.active} · ประวัติ ${t.contracts.history})`,
  );
  d.log(
    `  ติดตัวบล็อก                 : ${t.contracts.blocked} สัญญา (${plan.blockers.length} แถว)`,
  );
  d.log(
    `  ข้าม (ไม่นำเข้า)              : ${t.contracts.skipped} (${skippedText(skippedByReason)})`,
  );
  d.log(`  สัญญาฉบับเก่า (ผ่อนอยู่)     : ${plan.oldFormCodes.length}`);
  d.log(
    `  ข้อเตือน                    : ${warnings.length} (${Object.entries(unexplained)
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ')})`,
  );
  if (upload) {
    d.log(
      `  ไฟล์แนบ                    : พบ ${upload.details.size} · หาไม่เจอ ${upload.missing.length} · อ่านไม่ได้ ${upload.failed.length}`,
    );
  }
  d.log(`  เขียนไฟล์                  : ${written.join(', ')} → ${args.out}`);
  return { plan, written };
}

// ─── import ──────────────────────────────────────────────────────────────────────────────────────

export type ImportArgs = CommonArgs & {
  filesDir: string;
  branchId: string;
  /** โฟลเดอร์แม่ — ผลลัพธ์ลง `<out>/<รหัสรอบ>/` (ไม่ทับรอบก่อน) */
  out: string;
  /** นาที (ค่าเริ่มต้น 20) */
  txTimeoutMin?: number;
  /** ไฟล์แนบหาไม่เจอเกินนี้ = หยุดก่อนเขียน (ค่าเริ่มต้น 10 — dump 29/10 หาไม่เจอ 10 ไฟล์) */
  maxMissingFiles?: number;
  /** ซ้อม dry-run ทั้งที่แผนมีตัวบล็อก (เขียนเฉพาะสัญญาที่ผ่าน) — ห้ามใช้กับ `CONFIRM_LEGACY_IMPORT` */
  allowBlockers?: boolean;
  /** prefix ของ key ไฟล์แนบใน storage (ค่าเริ่มต้น `legacy-import`) */
  storagePrefix?: string;
};

export type ImportDeps = {
  env: Env;
  log: (line: string) => void;
  loadBook: (dumpPath: string) => Promise<LegacyInputs>;
  /** storage จริง — ใช้เฉพาะรอบเขียนจริง (dry-run ใช้ `DRY_RUN_STORAGE` เสมอ) · ไม่ส่ง = `StorageService` จาก env */
  storage: () => Promise<ImportStorage>;
  uploadFiles: typeof uploadLegacyFiles;
  journal: WriterDeps['journal'];
  pii: WriterDeps['pii'];
  audit: Pick<AuditService, 'log'>;
  write: typeof writeLegacyImport;
  runGates: typeof runGates;
  sampleForManualCheck: typeof sampleForManualCheck;
  /** การส่งรายการไป PEAK ทาง API ตั้งค่าอยู่หรือไม่ (`PeakService.isConfigured`) — เขียนจริงต้องปิด */
  peakApiConfigured: () => Promise<boolean>;
  now: () => Date;
};

export type ImportOutcomeKind =
  | 'COMMITTED'
  | 'DRY_RUN_ROLLED_BACK'
  | 'GATES_FAILED'
  | 'ALREADY_IMPORTED'
  | 'PLAN_BLOCKED'
  | 'WRITE_BLOCKED'
  | 'WRITE_FAILED'
  | 'FILES_MISSING'
  | 'FILES_FAILED'
  | 'ERROR';

/** ไฟล์แนบ — `keyed` = ไฟล์ที่ได้ key (dry-run อ่านอย่างเดียว · `uploadedToStorage` = ขึ้น storage จริงหรือไม่) */
export type ImportFiles = {
  attachmentPaths: number;
  keyed: number;
  uploadedToStorage: boolean;
  missing: number;
  failed: number;
};

/** `LegacyWriteError` ของตัวเขียน — สี่ช่องเท่านั้น (ไม่มีข้อความ error เดิม) */
export type ImportWriteError = Pick<
  LegacyWriteError,
  'step' | 'legacyCode' | 'errorClass' | 'prismaCode'
>;

/**
 * ผลของ `runImport` — **`committed` คือคำตอบที่เชื่อได้ว่าเขียนลงฐานแล้วหรือไม่** (`outcome: 'ERROR'` คู่กับ
 * `committed: true` เกิดได้เมื่อมีอะไรพังหลัง COMMIT เช่นเขียนไฟล์ผลลัพธ์)
 */
export type ImportOutcome = {
  committed: boolean;
  outcome: ImportOutcomeKind;
  gates: GateResult[];
  report: WriteReport | null;
  blockers: ImportPlan['blockers'];
  files: ImportFiles;
  /** อ่านแถว audit `LEGACY_IMPORT_COMMITTED` กลับมาได้หลัง COMMIT (ไม่ commit = null) */
  auditLogged: boolean | null;
  /** `<--out>/<รหัสรอบ>/` */
  outDir: string;
  resultPath: string;
};

/** sentinel ให้ `$transaction` rollback — พาผลของรอบนั้นออกมา */
class Rollback extends Error {
  constructor(readonly result: { report: WriteReport; gates: GateResult[]; systemUserId: string }) {
    super('LEGACY_IMPORT_ROLLBACK');
    this.name = 'Rollback';
  }
}

/** รหัสรอบนำเข้า (`metadata.importBatch` · ชื่อโฟลเดอร์ผลลัพธ์ · seed ของการสุ่ม) — เวลากรุงเทพ · dry-run ขึ้นต้น `rehearsal-` */
function importBatchId(now: Date, dryRun: boolean): string {
  const bkk = new Date(now.getTime() + 7 * 3_600_000).toISOString().replace(/\D/g, '').slice(0, 14);
  return `${dryRun ? 'rehearsal' : 'legacy'}-${bkk}`;
}

/**
 * บัญชี "ย้ายจากระบบเก่า" — ล็อกอินไม่ได้ (รหัสผ่านที่ bcrypt ไม่มีทางตรง · `is_active` false) · **`isSystemUser: false`**
 * (คำตัดสิน I-1: ระบบหา actor ของงานอัตโนมัติด้วย `findFirst({ isSystemUser: true })` ไม่มี orderBy — แถวที่สองทำให้งานของ
 * ระบบไปลงชื่อบัญชีนี้ได้) · ซ่อนจากรายชื่อผู้ใช้ด้วยอีเมล (`users.service.ts` `SYSTEM_USER_EMAILS`)
 */
export function legacySystemUserData(): Prisma.UserCreateInput {
  return {
    email: LEGACY_SYSTEM_USER_EMAIL,
    name: 'ย้ายจากระบบเก่า',
    password: DISABLED_PASSWORD,
    isActive: false,
    isSystemUser: false,
  };
}

type ImportContext = {
  args: ImportArgs;
  dryRun: boolean;
  allowBlockers: boolean;
  importBatch: string;
  outDir: string;
  txTimeoutMin: number;
  maxMissing: number;
  prefix: string;
  storage: LegacyFileStorage;
  storageInfo: Record<string, string>;
  actualDb: string;
  financeCompanyId: string;
  branch: { id: string; name: string };
  systemUser: { id: string } | null;
  overdueDaysThreshold: number;
  inputs: Inputs;
  plan: ImportPlan;
  sampleSeed: string;
  sampleCodes: string[];
};

type ImportState = {
  outcome: ImportOutcomeKind;
  committed: boolean;
  error: string | null;
  writeError: ImportWriteError | null;
  files: ImportFiles;
  gates: GateResult[];
  report: WriteReport | null;
  blockers: ImportBlocker[];
  auditLogged: boolean | null;
  timings: Record<string, number>;
  extraFiles: Record<string, string>;
};

/**
 * ①–④ ด่านทั้งหมดก่อนเขียน (ไม่เขียนฐาน ไม่อัปโหลด) — throw = ไม่มีอะไรเกิดขึ้น (ยังไม่เขียนไฟล์ผลลัพธ์)
 */
async function preflightImport(
  prisma: PrismaClient,
  args: ImportArgs,
  d: ImportDeps,
  timings: Record<string, number>,
): Promise<ImportContext> {
  const allowBlockers = args.allowBlockers === true;
  const now = d.now();

  // ① ไม่แตะฐาน
  const { expectedDb, dryRun } = importMode(d.env, allowBlockers);
  assertOutDir(args.out);
  await assertFilesDir(args.filesDir);
  const cutoff = parseCutoff(args.cutoff);
  if (!dryRun) assertCutoffWindow(cutoff, now);
  const { key, salt } = piiSecrets(d.env);
  const importBatch = importBatchId(now, dryRun);
  d.log(
    `${LOG} import · โหมด ${dryRun ? 'DRY-RUN (เขียนแล้ว rollback)' : 'เขียนจริง (COMMIT)'} · รอบ ${importBatch}`,
  );

  // ② storage
  let storage: LegacyFileStorage = DRY_RUN_STORAGE;
  let storageInfo: Record<string, string> = { backend: 'dry-run (ไม่อัปโหลด)', location: '' };
  if (!dryRun) {
    const real = await d.storage();
    const desc = real.describe();
    d.log(`  storage                    : ${desc.backend} ${desc.location}`);
    assertCommitStorage(desc, d.env);
    storage = real;
    storageInfo = { ...desc };
  }

  // ③ ฐาน (อ่านอย่างเดียว)
  const [{ current_database: actualDb }] = await prisma.$queryRaw<
    { current_database: string }[]
  >`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    throw new Error(
      `ฐานไม่ตรง: ต่ออยู่ "${actualDb}" แต่ EXPECTED_DB_NAME="${expectedDb}" — ยกเลิก`,
    );
  }
  assertProdAllowed(d.env, actualDb === PROD_DB_NAME);
  if (!dryRun) {
    assertProdStorage(storageInfo as ReturnType<ImportStorage['describe']>, actualDb);
  }
  d.log(`  ฐานข้อมูล                  : ${actualDb}`);
  const keys = assertPiiKeys(await samplePiiKeys(prisma, key, salt), dryRun, d.env);
  d.log(`  กุญแจ/salt PII             : ${keys}`);

  const finance = await prisma.companyInfo.findFirst({
    where: { companyCode: 'FINANCE', deletedAt: null },
    select: { id: true },
  });
  if (!finance) throw new Error('ไม่พบบริษัท FINANCE (company_info) ในฐานนี้');
  const branch = await prisma.branch.findFirst({
    where: { id: args.branchId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!branch) throw new Error('ไม่พบสาขาตาม --branch-id (หรือถูกลบแล้ว)');
  d.log(`  สาขาที่ผูกสัญญา              : ${branch.name}`);
  const systemUser = await prisma.user.findUnique({
    where: { email: LEGACY_SYSTEM_USER_EMAIL },
    select: { id: true, isActive: true, isSystemUser: true },
  });
  if (systemUser?.isActive) {
    d.log(`  ⚠ บัญชี ${LEGACY_SYSTEM_USER_EMAIL} ยังล็อกอินได้ (is_active) — ควรปิด`);
  }
  if (systemUser?.isSystemUser) {
    d.log(
      `  ⚠ บัญชี ${LEGACY_SYSTEM_USER_EMAIL} มี is_system_user = true — งานอัตโนมัติอาจลงชื่อบัญชีนี้ (ตรวจกับผู้ดูแลระบบ)`,
    );
  }
  const overdueDaysThreshold = await readOverdueDaysThreshold(prisma);
  d.log(`  เกณฑ์ OVERDUE              : ${overdueDaysThreshold} วัน (overdue_days_threshold)`);
  if (await d.peakApiConfigured()) {
    const message =
      'ปิดการส่ง PEAK ทาง API ก่อน — ยังไม่มีตัวกรองดอกเบี้ย legacy (ล้าง PEAK User Token / Connect ID / Secret Key ที่ ตั้งค่า › เชื่อมต่อ › การเชื่อมต่อ และ env PEAK_* ของ API)';
    if (!dryRun) throw new Error(message);
    d.log(`  ⚠ ${message} — รอบเขียนจริงจะปฏิเสธ`);
  }

  // ④ แผน + งวดบัญชี
  const planStarted = performance.now();
  const inputs = await loadInputs(args, cutoff, d.loadBook);
  const plan = planImport(inputs.book, { ...inputs.opts, overdueDaysThreshold });
  timings.plan = ms(planStarted);
  await assertPeriodsOpen(prisma, finance.id, [plan.cutoff, plan.catchUpAt]);
  const sampleSeed = args.sampleSeed ?? importBatch;

  return {
    args,
    dryRun,
    allowBlockers,
    importBatch,
    outDir: join(args.out, importBatch),
    txTimeoutMin: args.txTimeoutMin ?? DEFAULT_TX_TIMEOUT_MIN,
    maxMissing: args.maxMissingFiles ?? DEFAULT_MAX_MISSING_FILES,
    prefix: args.storagePrefix ?? DEFAULT_STORAGE_PREFIX,
    storage,
    storageInfo,
    actualDb,
    financeCompanyId: finance.id,
    branch,
    systemUser: systemUser ? { id: systemUser.id } : null,
    overdueDaysThreshold,
    inputs,
    plan,
    sampleSeed,
    sampleCodes: d.sampleForManualCheck(plan, SAMPLE_SIZE, sampleSeed),
  };
}

/**
 * แถวตัวบล็อก → `blockers.csv` + `customers-blocked.csv` · `withDb` = ธงลูกค้าที่ชนมีเลขบัตรหรือไม่ (เลือกแค่ id — ไม่อ่านค่า)
 */
async function blockerFiles(
  prisma: PrismaClient,
  rows: readonly ImportBlocker[],
  overrides: ReadonlyMap<string, string>,
  withDb: boolean,
): Promise<Record<string, string>> {
  let relatedWithId: Set<string> | undefined;
  if (withDb) {
    const related = [
      ...new Set(rows.map((r) => r.detail?.relatedCustomerId).filter((v): v is string => !!v)),
    ];
    relatedWithId = new Set(
      related.length === 0
        ? []
        : (
            await prisma.customer.findMany({
              where: {
                id: { in: related },
                OR: [
                  { nationalIdHash: { not: null } },
                  { AND: [{ nationalId: { not: null } }, { nationalId: { not: '' } }] },
                ],
              },
              select: { id: true },
            })
          ).map((c) => c.id),
    );
  }
  return {
    'blockers.csv': blockersCsv(rows),
    'customers-blocked.csv': customersBlockedCsv(rows, overrides, relatedWithId),
  };
}

/** ⑤ อัปโหลดไฟล์แนบ — คืน null เมื่อหยุด (หาไม่เจอเกินเกณฑ์ / อัปโหลดไม่สำเร็จตอนเขียนจริง) */
async function uploadPhase(
  ctx: ImportContext,
  state: ImportState,
  d: ImportDeps,
): Promise<LegacyFileUploadResult | null> {
  const paths = attachmentPathsOf(ctx.plan);
  d.log(
    `  ไฟล์แนบ                    : ${paths.length} ไฟล์${ctx.dryRun ? ' (อ่านอย่างเดียว ไม่อัปโหลด)' : ''}`,
  );
  const started = performance.now();
  const upload = await d.uploadFiles(
    ctx.args.filesDir,
    paths,
    withProgress(ctx.storage, paths.length, d.log),
    ctx.prefix,
  );
  state.timings.upload = ms(started);
  state.files = {
    attachmentPaths: paths.length,
    keyed: upload.details.size,
    uploadedToStorage: !ctx.dryRun,
    missing: upload.missing.length,
    failed: upload.failed.length,
  };
  if (upload.missing.length > 0 || upload.failed.length > 0) {
    state.extraFiles['missing-files.csv'] = missingFilesCsv(ctx.plan, upload);
  }
  if (upload.missing.length > ctx.maxMissing) {
    d.log(
      `  ✗ ไฟล์แนบหาไม่เจอ ${upload.missing.length} ไฟล์ (เกิน --max-missing-files ${ctx.maxMissing}) — ตรวจว่า --files-dir ชี้โฟลเดอร์ httpdocs ของ zip ชุดเดียวกับ dump`,
    );
    state.outcome = 'FILES_MISSING';
    return null;
  }
  if (upload.failed.length > 0 && !ctx.dryRun) {
    d.log(
      `  ✗ อ่าน/อัปโหลดไม่สำเร็จ ${upload.failed.length} ไฟล์ — รันซ้ำได้ (key เดิม อัปโหลดทับ)`,
    );
    state.outcome = 'FILES_FAILED';
    return null;
  }
  return upload;
}

/** ⑥–⑦ ผู้ใช้ระบบ + ธุรกรรม (ตัวเขียน → ด่าน → rollback เว้นแต่เขียนจริงและผ่านทุกด่าน) */
async function transactPhase(
  prisma: PrismaClient,
  ctx: ImportContext,
  state: ImportState,
  d: ImportDeps,
  upload: LegacyFileUploadResult,
): Promise<string> {
  // เขียนจริง: สร้างบัญชีนำเข้าในธุรกรรมสั้นของตัวเองก่อน (ธุรกรรมหลักเริ่มด้วยล็อกเบอร์ตาม database.md) — ด่านไม่ผ่าน
  // แล้ว rollback แถวนี้ยังอยู่ (ล็อกอินไม่ได้) · dry-run สร้างในธุรกรรมหลักแล้ว rollback ไปด้วย
  let existingUserId = ctx.systemUser?.id ?? null;
  if (!existingUserId && !ctx.dryRun) {
    existingUserId = (
      await prisma.user.create({ data: legacySystemUserData(), select: { id: true } })
    ).id;
    d.log(`  สร้างบัญชี ${LEGACY_SYSTEM_USER_EMAIL} (ล็อกอินไม่ได้ · ไม่ใช่ system user)`);
  }

  d.log(`  เปิดธุรกรรม (timeout ${ctx.txTimeoutMin} นาที)`);
  let systemUserId = existingUserId ?? '';
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await fn();
    } finally {
      state.timings[name] = ms(started);
    }
  };
  try {
    const done = await prisma.$transaction(
      async (tx) => {
        const userId =
          existingUserId ??
          (await tx.user.create({ data: legacySystemUserData(), select: { id: true } })).id;
        const written = await timed('write', () =>
          d.write(tx, ctx.plan, {
            journal: d.journal,
            pii: d.pii,
            financeCompanyId: ctx.financeCompanyId,
            branchId: ctx.branch.id,
            systemUserId: userId,
            files: upload.details,
            importBatch: ctx.importBatch,
            allowPlanBlockers: ctx.allowBlockers,
          }),
        );
        const gates = await timed('gates', async () =>
          dedupeGates(
            await d.runGates(tx, ctx.plan, written, ctx.plan.cutoff, {
              bookContracts: ctx.inputs.book.contracts.length,
            }),
          ),
        );
        const result = { report: written, gates, systemUserId: userId };
        if (
          ctx.dryRun ||
          gates.some((g) => !g.pass) ||
          upload.failed.length > 0 ||
          written.skippedExisting.length > 0
        ) {
          throw new Rollback(result);
        }
        return result;
      },
      { timeout: ctx.txTimeoutMin * 60_000, maxWait: TX_MAX_WAIT_MS },
    );
    state.report = done.report;
    state.gates = done.gates;
    systemUserId = done.systemUserId;
    state.committed = true;
    state.outcome = 'COMMITTED';
  } catch (error) {
    if (error instanceof Rollback) {
      state.report = error.result.report;
      state.gates = error.result.gates;
      state.outcome = !state.gates.every((g) => g.pass)
        ? 'GATES_FAILED'
        : error.result.report.skippedExisting.length > 0
          ? 'ALREADY_IMPORTED'
          : upload.failed.length > 0
            ? 'FILES_FAILED'
            : 'DRY_RUN_ROLLED_BACK';
    } else if (error instanceof LegacyWriteBlocked) {
      state.blockers = error.rows;
      Object.assign(
        state.extraFiles,
        await blockerFiles(prisma, error.rows, ctx.inputs.opts.customerOverrides, true),
      );
      state.outcome = 'WRITE_BLOCKED';
    } else if (error instanceof LegacyWriteError) {
      state.writeError = {
        step: error.step,
        legacyCode: error.legacyCode,
        errorClass: error.errorClass,
        prismaCode: error.prismaCode,
      };
      state.outcome = 'WRITE_FAILED';
      d.log(
        `  ✗ เขียนไม่สำเร็จ สัญญา ${error.legacyCode} ขั้น ${error.step} — ${error.errorClass}${error.prismaCode ? ` ${error.prismaCode}` : ''} (rollback ทั้งก้อน)`,
      );
    } else {
      throw error;
    }
  }

  for (const g of state.gates) {
    d.log(`  ด่าน ${g.id} ${g.pass ? 'ผ่าน' : 'ไม่ผ่าน'} ${GATE_LABELS[g.id]} — ${g.detail}`);
  }
  if (
    ctx.allowBlockers &&
    ctx.plan.blockers.length > 0 &&
    state.gates.some((g) => g.id === '6.1' && !g.pass)
  ) {
    d.log(
      '  ⓘ ด่าน 6.1 ไม่ผ่านโดยออกแบบเมื่อแผนมีตัวบล็อก (--allow-blockers ซ้อมเฉพาะสัญญาที่ผ่าน) — รอบเขียนจริงต้องไม่มีตัวบล็อก',
    );
  }
  if (state.gates.some((g) => !g.pass)) {
    state.extraFiles['gate-failures.csv'] = gateFailuresCsv(state.gates);
  }
  const existing = state.report?.skippedExisting.length ?? 0;
  if (existing > 0) {
    d.log(
      `  ✗ มีสัญญาที่นำเข้าแล้ว ${existing} สัญญา (skippedExisting) — รอบเขียนจริงปฏิเสธ (ตรวจว่ารันซ้ำกับฐานที่นำเข้าไปแล้วหรือไม่)`,
    );
  }
  return systemUserId;
}

/** ⑧ หลัง COMMIT: audit หนึ่งแถว แล้วอ่านกลับ (`AuditService.log` กลืน error) */
async function auditPhase(
  prisma: PrismaClient,
  state: ImportState,
  d: ImportDeps,
  systemUserId: string,
): Promise<void> {
  const report = state.report as WriteReport;
  await d.audit.log(legacyImportAuditEntry(report, systemUserId));
  const row = await prisma.auditLog.findFirst({
    where: { action: AUDIT_ACTION, entityId: report.importBatch },
    select: { id: true },
  });
  state.auditLogged = row !== null;
  if (!state.auditLogged) {
    d.log(
      `  ⚠ COMMIT แล้วแต่ไม่พบแถว audit ${AUDIT_ACTION} ของรอบ ${report.importBatch} — บันทึกผลรอบนี้ (import-result.json) ไว้เป็นหลักฐาน`,
    );
  }
}

/** ⑨ `import-result.json` + `bridge.csv` + `sample.csv` (+ ไฟล์ของสถานะ) ลง `<out>/<รหัสรอบ>/` */
async function finishImport(
  ctx: ImportContext,
  state: ImportState,
  d: ImportDeps,
  started: number,
): Promise<ImportOutcome> {
  state.timings.total = ms(started);
  const { plan, inputs } = ctx;
  const warnings = planWarnings(plan);
  const report = state.report;
  const result = {
    command: 'import',
    mode: ctx.dryRun ? 'dry-run' : 'commit',
    outcome: state.outcome,
    committed: state.committed,
    error: state.error,
    writeError: state.writeError,
    database: ctx.actualDb,
    importBatch: ctx.importBatch,
    generatedAt: d.now(),
    cutoff: plan.cutoff,
    catchUpAt: plan.catchUpAt,
    overdueDaysThreshold: ctx.overdueDaysThreshold,
    book: { contracts: inputs.book.contracts.length },
    inputs: inputs.hashes,
    storage: ctx.storageInfo,
    plan: plan.totals,
    blockers: { ...blockerSummary(state.blockers), rows: state.blockers },
    skipped: { count: plan.skipped.length, byReason: countBy(plan.skipped, (s) => s.reason) },
    files: state.files,
    write: report
      ? {
          created: report.created,
          skippedExisting: report.skippedExisting,
          journalEntries: countBy(report.journalEntries, (j) => j.kind),
          customers: countBy(report.customers, (c) => c.outcome),
          customersPhoneInvalid: report.customers.filter((c) => c.phoneInvalid).length,
          missingAttachments: report.missingAttachments.reduce((n, m) => n + m.paths.length, 0),
        }
      : null,
    gates: state.gates,
    auditLogged: state.auditLogged,
    sample: { seed: ctx.sampleSeed, codes: ctx.sampleCodes },
    warnings: warningSummary(warnings),
    timings: state.timings,
  };
  const written = await writeOutputs(ctx.outDir, {
    ...state.extraFiles,
    'bridge.csv': bridgeCsv(inputs.book, inputs.recon, plan, inputs.invoices),
    'sample.csv': sampleCsv(plan, ctx.sampleCodes),
    'import-result.json': `${JSON.stringify(toJsonSafe(result), null, 2)}\n`,
  });
  const sec = (name: string) =>
    state.timings[name] === undefined ? '–' : `${(state.timings[name] / 1000).toFixed(1)}s`;
  d.log(
    `  ใช้เวลา                     : แผน ${sec('plan')} · ไฟล์แนบ ${sec('upload')} · เขียน ${sec('write')} · ด่าน ${sec('gates')} · รวม ${sec('total')}`,
  );
  d.log(
    `  ผล                         : ${state.outcome}${state.committed ? ' (COMMIT แล้ว)' : ' (ไม่มีอะไรถูกเขียน)'}`,
  );
  d.log(`  เขียนไฟล์                  : ${written.join(', ')} → ${ctx.outDir}`);
  return {
    committed: state.committed,
    outcome: state.outcome,
    gates: state.gates,
    report: state.report,
    blockers: state.blockers,
    files: state.files,
    auditLogged: state.auditLogged,
    outDir: ctx.outDir,
    resultPath: join(ctx.outDir, 'import-result.json'),
  };
}

/**
 * `import` — นำเข้าแผนทั้งชุดในธุรกรรมเดียว (Task 13) · **ค่าเริ่มต้น dry-run: เขียนแล้ว rollback เสมอ** (`committed:false`)
 *
 * ลำดับ (ทุกด่านก่อนเขียน — `preflightImport` · ฟังก์ชันตรวจอยู่ใน `import-preflight.ts`):
 * 1. ด่าน env (ไม่แตะฐาน): `EXPECTED_DB_NAME` ต้องมี · `CONFIRM_LEGACY_IMPORT=YES_I_AM_SURE` = เขียนจริง (ไม่ตั้ง = dry-run) ·
 *    `NODE_ENV=production` ต้องมี `ALLOW_PROD_LEGACY_IMPORT=YES_I_AM_SURE` · `--allow-blockers` ใช้คู่กับเขียนจริงไม่ได้ ·
 *    `--out` / `--files-dir` อยู่นอก repo · `--files-dir` มี `uploads/` + `upload/` · เขียนจริง: วันตัดไม่อยู่หลังวันนี้และไม่เก่า
 *    กว่า 7 วัน · กุญแจ/salt PII รูปแบบถูก
 * 2. storage: เขียนจริง → พิมพ์ `describe()` · ปฏิเสธ `none` / `local` · bucket ต้องเท่า `EXPECTED_STORAGE_BUCKET` · dry-run ใช้
 *    storage ปลอม (**ไม่มีไฟล์บัตร/สลิปขึ้น bucket ระหว่างซ้อม**)
 * 3. ฐาน (อ่านอย่างเดียว): `current_database()` = `EXPECTED_DB_NAME` (ชื่อ `bestchoice` = prod ต้องมี `ALLOW_PROD_LEGACY_IMPORT`
 *    และเขียนจริงต้องเป็น GCS) · ด่านกุญแจ/salt จากลูกค้าตัวอย่าง · บริษัท FINANCE · สาขา · บัญชีนำเข้า ·
 *    `overdue_days_threshold` · PEAK API ตั้งค่าอยู่ = เขียนจริงปฏิเสธ
 * 4. `planImport` (เกณฑ์ OVERDUE จาก SystemConfig) · งวดบัญชี FINANCE ของเดือนวันตัดและเดือน `catchUpAt` ต้องไม่ CLOSED/SYNCED ·
 *    มีตัวบล็อก = เขียน `blockers.csv` + `customers-blocked.csv` แล้วหยุด (ไม่เรียก `$transaction`) เว้นแต่ `--allow-blockers`
 * 5. อัปโหลดไฟล์แนบ (key คงที่ รันซ้ำทับของเดิม) · หาไม่เจอเกิน `--max-missing-files` = หยุด · `failed` = เขียนจริงหยุดก่อนธุรกรรม
 * 6. บัญชีนำเข้ายังไม่มี: เขียนจริง = สร้าง (ล็อกอินไม่ได้ · `isSystemUser: false`) ก่อนธุรกรรมหลัก — **รอบเขียนจริงที่ rollback
 *    ทิ้งแถวนี้ไว้** · dry-run = สร้างในธุรกรรมหลักแล้ว rollback ไปด้วย
 * 7. `$transaction`: `writeLegacyImport` (ล็อกเบอร์ลูกค้าเองเป็นคำสั่งแรก) → `runGates` (ธุรกรรมเดียวกัน · `bookContracts`) →
 *    dry-run / ด่านใดไม่ผ่าน / มีสัญญานำเข้าแล้ว (`skippedExisting`) / ไฟล์ไม่สำเร็จ = throw `Rollback` ·
 *    `LegacyWriteBlocked` → `blockers.csv` · `LegacyWriteError` → บันทึกแค่ ขั้น / เลขสัญญา / คลาส / รหัส Prisma
 * 8. หลัง COMMIT เท่านั้น: `audit.log(legacyImportAuditEntry(...))` หนึ่งแถว แล้วอ่านกลับ (`auditLogged`)
 * 9. `<out>/<รหัสรอบ>/import-result.json` ทุกกรณีหลังมีแผน (ยอดนับ ด่าน ตัวบล็อก เศษปัด/เศษสตางค์ ไฟล์ ข้อเตือน SHA-256 ของไฟล์เข้า
 *    เวลาแต่ละขั้น seed + เลขสัญญาที่สุ่ม 6.8 — ไม่มีข้อมูลลูกค้า) + `bridge.csv` + `sample.csv` · ด่านไม่ผ่าน = `gate-failures.csv`
 */
export async function runImport(
  prisma: PrismaClient,
  args: ImportArgs,
  deps: Partial<ImportDeps> = {},
): Promise<ImportOutcome> {
  const started = performance.now();
  const prismaService = prisma as unknown as PrismaService;
  const d: ImportDeps = {
    env: process.env,
    log: (line) => console.log(line),
    loadBook: loadLegacyInputs,
    storage: defaultStorage,
    uploadFiles: uploadLegacyFiles,
    journal: deps.journal ?? new JournalAutoService(prismaService),
    pii: deps.pii ?? new CustomerPiiService(prismaService),
    audit: deps.audit ?? new AuditService(prismaService),
    write: writeLegacyImport,
    runGates,
    sampleForManualCheck,
    peakApiConfigured: () => defaultPeakApiConfigured(prisma),
    now: () => new Date(),
    ...deps,
  };
  const timings: Record<string, number> = {};
  const ctx = await preflightImport(prisma, args, d, timings);
  const state: ImportState = {
    outcome: 'ERROR',
    committed: false,
    error: null,
    writeError: null,
    files: {
      attachmentPaths: attachmentPathsOf(ctx.plan).length,
      keyed: 0,
      uploadedToStorage: false,
      missing: 0,
      failed: 0,
    },
    gates: [],
    report: null,
    blockers: ctx.plan.blockers,
    auditLogged: null,
    timings,
    extraFiles: {},
  };
  const plan = ctx.plan;
  d.log(
    `  แผน                        : นำเข้า ${plan.items.length} · ตัวบล็อก ${plan.blockers.length} แถว · ข้าม ${plan.skipped.length} (${skippedText(countBy(plan.skipped, (s) => s.reason))})`,
  );

  try {
    if (plan.blockers.length > 0) {
      Object.assign(
        state.extraFiles,
        await blockerFiles(prisma, plan.blockers, ctx.inputs.opts.customerOverrides, false),
      );
      if (!ctx.allowBlockers) {
        state.outcome = 'PLAN_BLOCKED';
        return await finishImport(ctx, state, d, started);
      }
      d.log('  ⚠ --allow-blockers: ซ้อมเฉพาะสัญญาที่ผ่าน (dry-run เท่านั้น)');
    }

    const upload = await uploadPhase(ctx, state, d);
    if (!upload) return await finishImport(ctx, state, d, started);
    ctx.plan = planImport(ctx.inputs.book, {
      ...ctx.inputs.opts,
      overdueDaysThreshold: ctx.overdueDaysThreshold,
      files: upload.details,
    });

    const systemUserId = await transactPhase(prisma, ctx, state, d, upload);
    if (state.committed && state.report) await auditPhase(prisma, state, d, systemUserId);
  } catch (error) {
    state.error = safeErrorText(error);
    if (!state.committed) state.outcome = 'ERROR';
    await finishImport(ctx, state, d, started);
    throw error;
  }
  return finishImport(ctx, state, d, started);
}

async function defaultStorage(): Promise<ImportStorage> {
  const { ConfigService } = await import('@nestjs/config');
  const { StorageService } = await import('../../modules/storage/storage.service');
  return new StorageService(new ConfigService());
}

/** `PeakService.isConfigured` (ค่าจาก SystemConfig หรือ env PEAK_*) — ค่าเข้ารหัสที่ถอดไม่ได้นับว่าตั้งค่าอยู่ (ปลอดภัยไว้ก่อน) */
async function defaultPeakApiConfigured(prisma: PrismaClient): Promise<boolean> {
  const { ConfigService } = await import('@nestjs/config');
  const { IntegrationConfigService } =
    await import('../../modules/integrations/integration-config.service');
  const { CompanyResolverService } = await import('../../modules/journal/company-resolver.service');
  const { PeakService } = await import('../../modules/peak/peak.service');
  const service = prisma as unknown as PrismaService;
  const config = new ConfigService();
  return new PeakService(
    service,
    config,
    new IntegrationConfigService(service, config),
    new CompanyResolverService(service),
  ).isConfigured();
}

// ─── คำสั่งเดิม ──────────────────────────────────────────────────────────────────────────────────

async function peakRecon(values: Values): Promise<void> {
  const [dumpPath, peakArPath, outDir] = ['dump', 'peak-ar', 'out'].map((n) => required(values, n));
  assertOutDir(outDir);
  const book = buildLegacyBook(await readDumpTables(dumpPath, LEGACY_TABLES));
  const invoices = parsePeakArCsv(await readFile(peakArPath, 'utf8'));
  const pairsPath = optional(values, 'peak-pairs');
  const pairs = pairsPath ? parsePeakPairsCsv(await readFile(pairsPath, 'utf8')) : [];
  const recon = reconcileWithPeak(book, invoices, pairs);

  const written = await writeOutputs(outDir, {
    'peak-recon.csv': peakReconCsv(book, recon),
    'peak-recon-unmatched.csv': peakReconUnmatchedCsv(book, recon),
  });

  const mismatched = [...recon.matched.values()].filter((m) => m.note === 'imei-mismatch').length;
  console.log(`${LOG} peak-recon`);
  console.log(`  สัญญาในระบบเก่า            : ${book.contracts.length}`);
  console.log(`  ใบแจ้งหนี้ PEAK            : ${invoices.length}`);
  console.log(
    `  จับคู่ได้                   : ${recon.matched.size} ` +
      `(ผ่อนอยู่ที่ยอดค้างไม่ตรง ${activeOutstandingMismatches(book, recon)})`,
  );
  console.log(`  คู่ที่กำหนดเอง              : ${pairs.length} (IMEI ไม่ตรง ${mismatched})`);
  console.log(`  สัญญาผ่อนอยู่ที่ไม่มีคู่       : ${recon.unmatchedContracts.length}`);
  console.log(`  ใบแจ้งหนี้กำกวม             : ${recon.ambiguous.length}`);
  console.log(`  ใบแจ้งหนี้ที่ไม่พบสัญญา       : ${recon.unmatchedInvoices.length}`);
  console.log(`  เขียนไฟล์                  : ${written.join(', ')} → ${outDir}`);
}

async function matchStatementCommand(values: Values): Promise<void> {
  const [dumpPath, statementPath, colsSpec, outDir] = ['dump', 'statement', 'cols', 'out'].map(
    (n) => required(values, n),
  );
  assertOutDir(outDir);
  const cols = parseStatementCols(colsSpec);
  const book = buildLegacyBook(await readDumpTables(dumpPath, LEGACY_TABLES));
  const credits = parseStatementCsv(await readFile(statementPath, 'utf8'), cols);
  const receipts = book.contracts.flatMap((c) => c.receipts);
  const result = matchStatement(credits, receipts);

  const written = await writeOutputs(outDir, {
    'unmatched.csv': statementCreditsCsv(result.unmatched),
    'ambiguous.csv': statementCreditsCsv(result.ambiguous),
  });

  console.log(`${LOG} match-statement`);
  console.log(`  เงินเข้าใน statement          : ${credits.length}`);
  console.log(`  รายการรับเงินในระบบเก่า        : ${receipts.length}`);
  console.log(`  จับคู่ได้                      : ${result.matched.length}`);
  console.log(`  ไม่พบในระบบเก่า               : ${result.unmatched.length}`);
  console.log(`  กำกวม (ยอดและวันเดียวกัน)      : ${result.ambiguous.length}`);
  console.log(`  เขียนไฟล์                     : ${written.join(', ')} → ${outDir}`);
}

// ─── คำสั่ง report / import ──────────────────────────────────────────────────────────────────────

function commonArgs(values: Values): CommonArgs {
  return {
    dump: required(values, 'dump'),
    peakAr: required(values, 'peak-ar'),
    peakPairs: optional(values, 'peak-pairs'),
    cutoff: required(values, 'cutoff'),
    moneyOverrides: optional(values, 'money-overrides'),
    customerOverrides: optional(values, 'customer-overrides'),
    sampleSeed: optional(values, 'sample-seed'),
  };
}

async function reportCommand(values: Values): Promise<void> {
  await runReport({
    ...commonArgs(values),
    out: required(values, 'out'),
    filesDir: optional(values, 'files-dir'),
  });
}

async function importCommand(values: Values): Promise<void> {
  const args: ImportArgs = {
    ...commonArgs(values),
    filesDir: required(values, 'files-dir'),
    branchId: required(values, 'branch-id'),
    out: required(values, 'out'),
    txTimeoutMin: parseIntOption(
      optional(values, 'tx-timeout-min'),
      'tx-timeout-min',
      DEFAULT_TX_TIMEOUT_MIN,
      1,
      120,
    ),
    maxMissingFiles: parseIntOption(
      optional(values, 'max-missing-files'),
      'max-missing-files',
      DEFAULT_MAX_MISSING_FILES,
      0,
      1_000_000,
    ),
    storagePrefix: optional(values, 'storage-prefix'),
    allowBlockers: values['allow-blockers'] === true,
  };
  // StorageService เขียน log หนึ่งบรรทัดต่อไฟล์ (~19k บรรทัด) — เหลือแค่ warn/error · ความคืบหน้ามาจาก withProgress
  Logger.overrideLogger(['warn', 'error']);
  const prisma = new PrismaClient();
  try {
    const result = await runImport(prisma, args);
    const ok = result.committed || result.outcome === 'DRY_RUN_ROLLED_BACK';
    if (!ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

const COMMON_OPTIONS = [
  'dump',
  'peak-ar',
  'peak-pairs',
  'cutoff',
  'out',
  'money-overrides',
  'customer-overrides',
  'sample-seed',
] as const;

const COMMANDS = new Map<string, Command>([
  [
    'peak-recon',
    {
      usage: 'peak-recon --dump <sql> --peak-ar <csv> --out <dir> [--peak-pairs <csv>]',
      options: ['dump', 'peak-ar', 'out', 'peak-pairs'],
      run: peakRecon,
    },
  ],
  [
    'match-statement',
    {
      usage:
        'match-statement --dump <sql> --statement <csv> ' +
        '--cols date=<หัว>,amount=<หัว>[,description=<หัว>] --out <dir>',
      options: ['dump', 'statement', 'cols', 'out'],
      run: matchStatementCommand,
    },
  ],
  [
    'report',
    {
      usage:
        'report --dump <sql> --peak-ar <csv> --cutoff <yyyy-mm-dd> --out <dir> [--peak-pairs <csv>] ' +
        '[--money-overrides <csv>] [--customer-overrides <csv>] [--files-dir <httpdocs>] ' +
        '[--sample-seed <text>]',
      help: [
        'ไม่แตะฐานข้อมูล · --out และ --files-dir ต้องอยู่นอก repo · เกณฑ์ OVERDUE = 7 วัน (import อ่าน overdue_days_threshold จากฐาน)',
        `เขียน: ${REPORT_FILES.join(', ')} (+ missing-files.csv เมื่อส่ง --files-dir) · CSV มี UTF-8 BOM`,
        'สัญญายกเลิก (สถานะ 4) ไม่นำเข้า — นับใน summary.json skipped.byReason (status-4-canceled)',
        'ไฟล์ที่กรอกแล้วส่งกลับได้: money-mismatch.csv → --money-overrides · ' +
          'customers-blocked.csv → --customer-overrides (ลบแถวที่ไม่ได้กรอกก่อน)',
      ].join('\n'),
      options: [...COMMON_OPTIONS, 'files-dir'],
      run: reportCommand,
    },
  ],
  [
    'import',
    {
      usage:
        'import --dump <sql> --peak-ar <csv> --files-dir <httpdocs> --cutoff <yyyy-mm-dd> --branch-id <id> --out <dir> ' +
        '[--peak-pairs <csv>] [--money-overrides <csv>] [--customer-overrides <csv>] ' +
        '[--tx-timeout-min 20] [--max-missing-files 10] [--storage-prefix legacy-import] [--sample-seed <text>] ' +
        '[--allow-blockers]',
      help: [
        'ค่าเริ่มต้น = DRY-RUN (เขียนในธุรกรรมแล้ว rollback · ไฟล์แนบอ่านอย่างเดียว ไม่อัปโหลด)',
        'env บังคับ: EXPECTED_DB_NAME=<ชื่อฐาน> · PII_ENCRYPTION_KEY + PII_HASH_SALT (ของ API ฐานนั้น) · DATABASE_URL',
        'เขียนจริง: CONFIRM_LEGACY_IMPORT=YES_I_AM_SURE · GCS_BUCKET=<bucket> (หรือ S3_*) และไม่ตั้ง STORAGE_LOCAL_DIR · ' +
          'EXPECTED_STORAGE_BUCKET=<bucket เดียวกัน> · ฐาน bestchoice ต้องเป็น GCS · วันตัดไม่อยู่หลังวันนี้และไม่เก่ากว่า 7 วัน · ' +
          'ปิด PEAK API (PEAK User Token / Connect ID / Secret Key)',
        'ALLOW_PROD_LEGACY_IMPORT=YES_I_AM_SURE: ฐาน bestchoice หรือ NODE_ENV=production — ทั้ง dry-run และเขียนจริง',
        'ALLOW_UNVERIFIED_PII_KEYS=YES_I_AM_SURE: เขียนจริงบนฐานที่ไม่มีลูกค้าให้ตรวจกุญแจ/salt (ตรวจกุญแจเองก่อน)',
        'งวดบัญชี FINANCE ของเดือนวันตัดและเดือนถัดไป (รายการไล่ VAT) ต้องไม่ปิด (CLOSED/SYNCED) · เกณฑ์ OVERDUE จาก overdue_days_threshold',
        `บัญชี ${LEGACY_SYSTEM_USER_EMAIL} (ล็อกอินไม่ได้ · ไม่ใช่ system user): ถ้ายังไม่มี รอบเขียนจริงสร้างก่อนเปิดธุรกรรม — ` +
          'รอบเขียนจริงที่ rollback ทิ้งแถวนี้ไว้ (ใช้ซ้ำรอบถัดไป)',
        'ผลลัพธ์ลง <--out>/<รหัสรอบ>/: import-result.json + bridge.csv + sample.csv ทุกครั้ง · blockers.csv + customers-blocked.csv ' +
          'เมื่อมีตัวบล็อก · missing-files.csv เมื่อมีไฟล์หาไม่เจอ · gate-failures.csv เมื่อมีด่านไม่ผ่าน · ' +
          'committed ใน import-result.json คือคำตอบว่าเขียนลงฐานแล้วหรือไม่',
        '--allow-blockers (dry-run เท่านั้น): ด่าน 6.1 ไม่ผ่านโดยออกแบบเพราะแผนมีตัวบล็อก',
      ].join('\n'),
      options: [
        ...COMMON_OPTIONS,
        'files-dir',
        'branch-id',
        'tx-timeout-min',
        'max-missing-files',
        'storage-prefix',
      ],
      flags: ['allow-blockers'],
      run: importCommand,
    },
  ],
]);

function usage(): string {
  const lines = [...COMMANDS.values()].map((c) => `  ${c.usage}`);
  return ['ใช้: npm --prefix apps/api run import:legacy-backoffice -- <คำสั่ง>', ...lines].join(
    '\n',
  );
}

const isHelp = (arg: string | undefined) => arg === '--help' || arg === '-h' || arg === 'help';

/**
 * จุดเข้าของ CLI · `ensureTz` = ด่านเขตเวลา ทำเป็นอย่างแรก (ค่าเริ่มต้น `ensureBangkokTimeZone` — ตั้ง `TZ` แล้วตรวจกับ Intl) ·
 * เทสต์ส่งตัวแทน: jest ให้แต่ละไฟล์ใช้สำเนาของ `process.env` การตั้ง `TZ` ในเทสต์จึงไม่เปลี่ยนเขตเวลาจริงของโปรเซส
 * (เครื่อง UTC เช่น CI = ด่าน throw) — พฤติกรรมของด่านเองทดสอบผ่านตัวอ่านเขตเวลาที่ส่งเข้าไป (`import-preflight.ts`)
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  log: (line: string) => void = (line) => console.log(line),
  ensureTz: () => void = ensureBangkokTimeZone,
): Promise<void> {
  // ก่อน Date ตัวแรก — เลขที่รายการบัญชี/งวดบัญชีอ่านเดือนตามเขตเวลาของโปรเซส (คำตัดสิน I-2)
  ensureTz();
  const [name, ...rest] = argv;
  if (isHelp(name)) {
    log(usage());
    return;
  }
  const command = name === undefined ? undefined : COMMANDS.get(name);
  if (!command) {
    throw new Error(
      `${name === undefined ? 'ไม่ได้ระบุคำสั่ง' : `ไม่รู้จักคำสั่ง ${name}`}\n${usage()}`,
    );
  }
  if (rest.some(isHelp)) {
    log(
      [
        `ใช้: npm --prefix apps/api run import:legacy-backoffice -- ${command.usage}`,
        command.help ?? '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    return;
  }
  const { values } = parseArgs({
    args: [...rest],
    options: Object.fromEntries([
      ...command.options.map((o) => [o, { type: 'string' as const }]),
      ...(command.flags ?? []).map((f) => [f, { type: 'boolean' as const }]),
    ]),
    strict: true,
    allowPositionals: false,
  });
  await command.run(values as Values);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`${LOG} ERROR:`, safeErrorText(err));
    process.exit(1);
  });
}
