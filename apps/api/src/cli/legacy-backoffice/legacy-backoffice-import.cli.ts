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
 * | `report --dump --peak-ar --cutoff <yyyy-mm-dd> --out [--peak-pairs --canceled-map --money-overrides --customer-overrides --files-dir --sample-seed]` | แผนนำเข้าแบบไม่แตะฐาน → รายงานให้เจ้าของ/สำนักงานบัญชี (รายชื่อไฟล์ใน `REPORT_FILES`) |
 * | `import --dump --peak-ar --files-dir --cutoff --branch-id --out [--peak-pairs --canceled-map --money-overrides --customer-overrides --tx-timeout-min 20 --max-missing-files 10 --storage-prefix legacy-import --sample-seed --allow-blockers]` | นำเข้าในธุรกรรมเดียว — **ค่าเริ่มต้น dry-run** (เขียนแล้ว rollback) · ด่านกันและลำดับอยู่ที่ `runImport` |
 *
 * dump / CSV / โฟลเดอร์ไฟล์แนบ / โฟลเดอร์ผลลัพธ์ อยู่นอก repo เสมอ (มีข้อมูลลูกค้าจริง) — ส่งเข้ามาด้วย path เท่านั้น ·
 * `--out` และ `--files-dir` ที่อยู่ในโฟลเดอร์ของ repo ถูกปฏิเสธก่อนอ่านไฟล์ใด (`repo-guard.ts`) ·
 * ข้อความบนจอมีแต่จำนวน/รหัส ไม่มีชื่อ เบอร์ เลขบัตรของลูกค้า · error ของ Prisma พิมพ์แค่ชื่อคลาส/รหัส (ข้อความยกค่าในแถวได้)
 *
 * เพิ่มคำสั่ง: เติมรายการใน `COMMANDS` (ตัวเลือกของคำสั่งนั้น + ฟังก์ชันที่รับค่าที่อ่านแล้ว)
 */

import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { AuditService } from '../../modules/audit/audit.service';
import { CustomerPiiService } from '../../modules/customers/customer-pii.service';
import { JournalAutoService } from '../../modules/journal/journal-auto.service';
import type { StorageService } from '../../modules/storage/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { decryptPII, isEncrypted } from '../../utils/crypto.util';
import { bangkokDateString } from '../../utils/date.util';
import { hashPII } from '../../utils/pii.util';
import { normalizeThaiPhone } from '../../utils/thai-phone.util';
import { assessKeySafety } from '../repair-customer-phones.cli';
import { parseCustomerOverridesCsv } from './customer';
import { readDumpTables, type DumpRow } from './dump-reader';
import { uploadLegacyFiles, type LegacyFileStorage, type LegacyFileUploadResult } from './files';
import { buildLegacyBook, LEGACY_TABLES, type LegacyBook } from './legacy-book';
import { parseMoneyOverridesCsv } from './money';
import { GATE_LABELS, runGates, sampleForManualCheck, type GateResult } from './gates';
import {
  activeOutstandingMismatches,
  parsePeakArCsv,
  parsePeakPairsCsv,
  peakReconCsv,
  peakReconUnmatchedCsv,
  reconcileWithPeak,
  type PeakRecon,
} from './peak-recon';
import { planImport, type ImportBlocker, type ImportOptions, type ImportPlan } from './plan-import';
import { assertOutsideRepo } from './repo-guard';
import {
  blockersCsv,
  bridgeCsv,
  CANCELED_RESOLUTIONS,
  canceledCsv,
  countBy,
  customersBlockedCsv,
  gateFailuresCsv,
  missingFilesCsv,
  moneyMismatchCsv,
  oldFormCsv,
  parseCanceledMapCsv,
  planWarnings,
  sampleCsv,
  toJsonSafe,
  warningsCsv,
} from './report-files';
import {
  matchStatement,
  parseStatementCols,
  parseStatementCsv,
  statementCreditsCsv,
} from './statement-matcher';
import {
  LegacyWriteBlocked,
  legacyImportAuditEntry,
  writeLegacyImport,
  type WriteReport,
  type WriterDeps,
} from './writer';

const LOG = '[legacy-backoffice-import]';
const CONSENT = 'YES_I_AM_SURE';
/** ชื่อฐาน prod (เหมือน `repair-customer-phones.cli.ts`) — ต่อฐานนี้ต้องมี `ALLOW_PROD_LEGACY_IMPORT` แม้ไม่ได้ตั้ง NODE_ENV */
const PROD_DB_NAME = 'bestchoice';
/** ผู้ใช้ระบบ "ย้ายจากระบบเก่า" (ล็อกอินไม่ได้ — migration `20260520000000` · ซ่อนจากรายชื่อผู้ใช้ `users.service.ts`) */
export const LEGACY_SYSTEM_USER_EMAIL = 'legacy-import@bestchoice.com';
const DISABLED_PASSWORD = 'DISABLED_SERVICE_ACCOUNT_NOT_LOGIN_CAPABLE';
const DEFAULT_TX_TIMEOUT_MIN = 20;
const DEFAULT_MAX_MISSING_FILES = 10;
const DEFAULT_STORAGE_PREFIX = 'legacy-import';
const TX_MAX_WAIT_MS = 30_000;
const SAMPLE_SIZE = 20;
const PII_SAMPLE_ROWS = 100;
const PROGRESS_EVERY = 1000;

/** ไฟล์ที่คำสั่ง `report` เขียน (`missing-files.csv` เฉพาะเมื่อส่ง `--files-dir`) */
export const REPORT_FILES = [
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
] as const;

// ─── ด่านตรวจ / สุ่มเทียบ (Task 12 — `gates.ts`) ─────────────────────────────────────────────────

/** seed ของการสุ่ม 6.8 — ค่าเดียวกับที่ `sampleForManualCheck` ใช้เมื่อไม่ส่ง (ผูกกับวันตัด) · `--sample-seed` = สุ่มชุดอื่น */
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

/** เขียนไฟล์ผลลัพธ์ลง `outDir` (สร้างโฟลเดอร์ให้) — คืนชื่อไฟล์ที่เขียน */
async function writeOutputs(outDir: string, files: Record<string, string>): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(outDir, name), content, 'utf8');
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

/** `--out` / `--files-dir` ต้องอยู่นอก repo — repo เป็นสาธารณะ */
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

// ─── อ่านข้อมูลเข้า (dump · PEAK · ไฟล์ของเจ้าของ) ────────────────────────────────────────────────

export type LegacyInputs = { book: LegacyBook; contractRows: DumpRow[] };

/** dump → book + แถว `bestchoice_contract` ดิบ (ช่อง `canceled_*` ของ `canceled.csv`) */
export async function loadLegacyInputs(dumpPath: string): Promise<LegacyInputs> {
  const tables = await readDumpTables(dumpPath, LEGACY_TABLES);
  return { book: buildLegacyBook(tables), contractRows: tables.bestchoice_contract ?? [] };
}

type CommonArgs = {
  dump: string;
  peakAr: string;
  peakPairs?: string;
  cutoff: string;
  canceledMap?: string;
  moneyOverrides?: string;
  customerOverrides?: string;
  /** seed ของ `sampleForManualCheck` (ไม่ส่ง = `defaultSampleSeed(วันตัด)`) */
  sampleSeed?: string;
};

type Inputs = LegacyInputs & {
  recon: PeakRecon;
  invoiceCount: number;
  pairCount: number;
  opts: Omit<ImportOptions, 'files'>;
};

async function loadInputs(
  args: CommonArgs,
  cutoff: Date,
  loadBook: (dumpPath: string) => Promise<LegacyInputs>,
): Promise<Inputs> {
  const { book, contractRows } = await loadBook(args.dump);
  const invoices = parsePeakArCsv(await readFile(args.peakAr, 'utf8'));
  const pairs = args.peakPairs ? parsePeakPairsCsv(await readFile(args.peakPairs, 'utf8')) : [];
  const recon = reconcileWithPeak(book, invoices, pairs);
  const text = (path: string | undefined) => (path ? readFile(path, 'utf8') : null);
  const canceledText = await text(args.canceledMap);
  const moneyText = await text(args.moneyOverrides);
  const customerText = await text(args.customerOverrides);
  return {
    book,
    contractRows,
    recon,
    invoiceCount: invoices.length,
    pairCount: pairs.length,
    opts: {
      cutoff,
      peakRecon: recon,
      canceledMap: canceledText === null ? new Map() : parseCanceledMapCsv(canceledText),
      moneyOverrides: moneyText === null ? new Map() : parseMoneyOverridesCsv(moneyText),
      customerOverrides:
        customerText === null ? new Map() : parseCustomerOverridesCsv(customerText),
    },
  };
}

const attachmentPathsOf = (plan: ImportPlan) => [
  ...new Set(plan.items.flatMap((i) => i.attachmentPaths)),
];

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
 * ลง `--out` (นอก repo) · `--files-dir` = ตรวจไฟล์แนบด้วย storage ปลอม (อ่านไฟล์ ไม่อัปโหลด)
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
  const canceledCount = book.contracts.filter(
    (c) => c.statusCode === '4' || c.statusCode === '5',
  ).length;

  const summary = {
    command: 'report',
    generatedAt: d.now(),
    cutoff: plan.cutoff,
    catchUpAt: plan.catchUpAt,
    inputs: {
      peakInvoices: inputs.invoiceCount,
      peakPairs: inputs.pairCount,
      canceledMap: opts.canceledMap.size,
      moneyOverrides: opts.moneyOverrides.size,
      customerOverrides: opts.customerOverrides.size,
      filesDir: Boolean(args.filesDir),
    },
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
    skipped: { count: plan.skipped.length, byReason: countBy(plan.skipped, (s) => s.reason) },
    oldForm: plan.oldFormCodes.length,
    warnings: { count: warnings.length, byKind: countBy(warnings, (w) => w.kind) },
    canceled: {
      contracts: canceledCount,
      resolved: opts.canceledMap.size,
      resolutions: CANCELED_RESOLUTIONS,
    },
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
    'bridge.csv': bridgeCsv(book, recon, plan),
    'summary.json': `${JSON.stringify(toJsonSafe(summary), null, 2)}\n`,
    'blockers.csv': blockersCsv(plan.blockers),
    'canceled.csv': canceledCsv(book, inputs.contractRows, opts.canceledMap),
    'money-mismatch.csv': moneyMismatchCsv(book, plan, opts.moneyOverrides),
    'old-form.csv': oldFormCsv(book, plan),
    'sample.csv': sampleCsv(plan, sampleCodes),
    'customers-blocked.csv': customersBlockedCsv(plan.blockers, opts.customerOverrides),
    'warnings.csv': warningsCsv(plan),
  };
  if (upload) files['missing-files.csv'] = missingFilesCsv(plan, upload);
  const written = await writeOutputs(args.out, files);

  const t = plan.totals;
  d.log(`${LOG} report (ไม่แตะฐานข้อมูล) · วันตัด ${bangkokDateString(cutoff)}`);
  d.log(`  สัญญาในระบบเก่า            : ${book.contracts.length}`);
  d.log(
    `  นำเข้าได้                   : ${plan.items.length} (ผ่อนอยู่ ${t.contracts.active} · ประวัติ ${t.contracts.history})`,
  );
  d.log(
    `  ติดตัวบล็อก                 : ${t.contracts.blocked} สัญญา (${plan.blockers.length} แถว)`,
  );
  d.log(`  ข้าม (สถานะ 0/1)           : ${t.contracts.skipped}`);
  d.log(`  ยกเลิก/หนี้เสีย              : ${canceledCount} (ยืนยันแล้ว ${opts.canceledMap.size})`);
  d.log(`  สัญญาฉบับเก่า (ผ่อนอยู่)     : ${plan.oldFormCodes.length}`);
  d.log(`  ข้อเตือน                    : ${warnings.length}`);
  if (upload) {
    d.log(
      `  ไฟล์แนบ                    : พบ ${upload.details.size} · หาไม่เจอ ${upload.missing.length} · อ่านไม่ได้ ${upload.failed.length}`,
    );
  }
  d.log(
    `  canceled.csv ช่อง resolution: ${CANCELED_RESOLUTIONS.join(' / ')} (ว่าง = ยังไม่ยืนยัน) แล้วส่งกลับด้วย --canceled-map`,
  );
  d.log(`  เขียนไฟล์                  : ${written.join(', ')} → ${args.out}`);
  return { plan, written };
}

// ─── import ──────────────────────────────────────────────────────────────────────────────────────

export type ImportArgs = CommonArgs & {
  filesDir: string;
  branchId: string;
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

/** storage จริงของรอบเขียน — `describe()` ใช้ปฏิเสธ `none` / `local` */
export type ImportStorage = Pick<StorageService, 'upload' | 'configured' | 'describe'>;

export type ImportDeps = {
  env: Record<string, string | undefined>;
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
  now: () => Date;
};

export type ImportOutcomeKind =
  | 'COMMITTED'
  | 'DRY_RUN_ROLLED_BACK'
  | 'GATES_FAILED'
  | 'PLAN_BLOCKED'
  | 'WRITE_BLOCKED'
  | 'FILES_MISSING'
  | 'FILES_FAILED'
  | 'ERROR';

export type ImportOutcome = {
  committed: boolean;
  outcome: ImportOutcomeKind;
  gates: GateResult[];
  report: WriteReport | null;
  blockers: ImportPlan['blockers'];
  files: { uploaded: number; missing: number; failed: number };
  resultPath: string;
};

/** sentinel ให้ `$transaction` rollback — พาผลของรอบนั้นออกมา */
class Rollback extends Error {
  constructor(readonly result: { report: WriteReport; gates: GateResult[]; systemUserId: string }) {
    super('LEGACY_IMPORT_ROLLBACK');
    this.name = 'Rollback';
  }
}

/** ด่านจาก env — ก่อนแตะฐาน/ไฟล์ใด */
function importMode(env: ImportDeps['env'], allowBlockers: boolean) {
  const expectedDb = env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    throw new Error(
      'ต้องตั้ง EXPECTED_DB_NAME=<ชื่อฐานที่ตั้งใจนำเข้า> (ตรวจกับ current_database() ก่อนแตะฐาน)',
    );
  }
  const dryRun = env.CONFIRM_LEGACY_IMPORT !== CONSENT;
  if (!dryRun && allowBlockers) {
    throw new Error(
      `--allow-blockers ใช้ซ้อมแบบ dry-run เท่านั้น — เขียนจริง (CONFIRM_LEGACY_IMPORT=${CONSENT}) ต้องไม่มีตัวบล็อกเลย`,
    );
  }
  assertProdAllowed(env, env.NODE_ENV === 'production');
  return { expectedDb, dryRun };
}

function assertProdAllowed(env: ImportDeps['env'], production: boolean): void {
  if (production && env.ALLOW_PROD_LEGACY_IMPORT !== CONSENT) {
    throw new Error(
      `ฐาน production ต้องตั้ง ALLOW_PROD_LEGACY_IMPORT=${CONSENT} ด้วย — ทั้ง dry-run และเขียนจริง (dry-run บน prod ก็เขียนแล้ว rollback และล็อกเบอร์ลูกค้าระหว่างรัน)`,
    );
  }
}

/** กุญแจ/salt ของ PII ต้องมีรูปแบบถูก (แบบ `repair-customer-phones.cli.ts`) */
function piiSecrets(env: ImportDeps['env']): { key: string; salt: string } {
  const key = env.PII_ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('PII_ENCRYPTION_KEY ต้องเป็น hex 64 ตัว — กุญแจเดียวกับ API ของฐานที่นำเข้า');
  }
  const salt = env.PII_HASH_SALT ?? '';
  if (salt.length < 32) {
    throw new Error('PII_HASH_SALT ต้องยาวอย่างน้อย 32 ตัว — salt เดียวกับ API ของฐานที่นำเข้า');
  }
  return { key, salt };
}

export type PiiKeySample = {
  /** ciphertext ที่ตรวจ (เลขบัตร + เบอร์หลัก) */
  withCiphertext: number;
  decryptFailed: number;
  /** ถอดได้และมี hash */
  consistentWithHash: number;
  /** ถอดได้แต่ hash ไม่ตรงทั้งค่าเดิมและค่าที่ปรับรูป = สัญญาณ salt ผิด */
  saltSuspect: number;
};

/**
 * ด่านกุญแจ/salt (carry C-3 ของ Task 8 · แบบ `repair-customer-phones.cli.ts` `assessKeySafety`) — อ่านลูกค้าตัวอย่างที่มี
 * ciphertext + hash ถอดด้วยกุญแจที่ตั้ง แล้ว hash ค่าที่ถอดได้ด้วย salt ที่ตั้ง ต้องตรงค่าที่เก็บไว้ ·
 * อ่านอย่างเดียว ไม่พิมพ์ค่า · กุญแจ/salt ผิด = แถวที่นำเข้าใช้ร่วมกับ API ไม่ได้ (dedup ด้วย hash มองไม่เห็น ถอดไม่ออก)
 */
export async function samplePiiKeys(
  db: Pick<PrismaClient, 'customer'>,
  key: string,
  salt: string,
): Promise<PiiKeySample> {
  const rows = await db.customer.findMany({
    where: {
      deletedAt: null,
      OR: [
        { nationalIdEncrypted: { not: null }, nationalIdHash: { not: null } },
        { phoneEncrypted: { not: null }, phoneHash: { not: null } },
      ],
    },
    select: {
      nationalIdEncrypted: true,
      nationalIdHash: true,
      phoneEncrypted: true,
      phoneHash: true,
    },
    orderBy: { createdAt: 'desc' },
    take: PII_SAMPLE_ROWS,
  });
  const out: PiiKeySample = {
    withCiphertext: 0,
    decryptFailed: 0,
    consistentWithHash: 0,
    saltSuspect: 0,
  };
  const check = (
    cipher: string | null,
    hash: string | null,
    normalize: (v: string) => string | null,
  ) => {
    if (!cipher || !hash || !isEncrypted(cipher)) return;
    out.withCiphertext++;
    let plain: string;
    try {
      plain = decryptPII(cipher, key);
    } catch {
      out.decryptFailed++;
      return;
    }
    if (hash === plain) return; // plaintext หลุดในคอลัมน์ hash — ไม่ใช่สัญญาณ salt
    out.consistentWithHash++;
    const candidates = [plain, normalize(plain)].filter((v): v is string => !!v);
    if (!candidates.some((v) => hashPII(v, salt) === hash)) out.saltSuspect++;
  };
  for (const r of rows) {
    check(r.nationalIdEncrypted, r.nationalIdHash, (v) => v.replace(/\D/g, ''));
    check(r.phoneEncrypted, r.phoneHash, normalizeThaiPhone);
  }
  return out;
}

/** รหัสรอบนำเข้า (`metadata.importBatch`) — เวลากรุงเทพ · dry-run ขึ้นต้น `rehearsal-` */
function importBatchId(now: Date, dryRun: boolean): string {
  const bkk = new Date(now.getTime() + 7 * 3_600_000).toISOString().replace(/\D/g, '').slice(0, 14);
  return `${dryRun ? 'rehearsal' : 'legacy'}-${bkk}`;
}

/**
 * `import` — นำเข้าแผนทั้งชุดในธุรกรรมเดียว (Task 13) · **ค่าเริ่มต้น dry-run: เขียนแล้ว rollback เสมอ** (`committed:false`)
 *
 * ลำดับ (ทุกด่านก่อนเขียน):
 * 1. ด่าน env (ไม่แตะฐาน): `EXPECTED_DB_NAME` ต้องมี · `CONFIRM_LEGACY_IMPORT=YES_I_AM_SURE` = เขียนจริง (ไม่ตั้ง = dry-run) ·
 *    `NODE_ENV=production` ต้องมี `ALLOW_PROD_LEGACY_IMPORT=YES_I_AM_SURE` · `--allow-blockers` ใช้คู่กับเขียนจริงไม่ได้ ·
 *    `--out` / `--files-dir` อยู่นอก repo · `--files-dir` มี `uploads/` + `upload/` · กุญแจ/salt PII รูปแบบถูก
 * 2. storage: เขียนจริง → พิมพ์ `describe()` แล้วปฏิเสธ `none` / `local` (ต้องเป็น GCS/S3) · dry-run ใช้ storage ปลอม
 *    (**ไม่มีไฟล์บัตร/สลิปขึ้น bucket ระหว่างซ้อม**)
 * 3. ฐาน (อ่านอย่างเดียว): `current_database()` = `EXPECTED_DB_NAME` (ชื่อ `bestchoice` = prod ต้องมี `ALLOW_PROD_LEGACY_IMPORT`) ·
 *    ด่านกุญแจ/salt จากลูกค้าตัวอย่าง (`samplePiiKeys` — ไม่มีตัวอย่างเลย: เขียนจริงต้องตั้ง `ALLOW_UNVERIFIED_PII_KEYS`) ·
 *    บริษัท FINANCE · สาขา `--branch-id` · ผู้ใช้ระบบ `LEGACY_SYSTEM_USER_EMAIL`
 * 4. `planImport` → มีตัวบล็อก = เขียน `blockers.csv` + `customers-blocked.csv` แล้วหยุด (ไม่เรียก `$transaction`) เว้นแต่
 *    `--allow-blockers` (dry-run เท่านั้น)
 * 5. อัปโหลดไฟล์แนบ (`uploadLegacyFiles` — key คงที่ รันซ้ำทับของเดิม) · หาไม่เจอเกิน `--max-missing-files` = หยุด ·
 *    อ่าน/อัปโหลดไม่สำเร็จ (`failed`) = ด่านไม่ผ่าน (เขียนจริงหยุดก่อนธุรกรรม — รันซ้ำได้)
 * 6. ผู้ใช้ระบบยังไม่มี: เขียนจริง = สร้าง (ล็อกอินไม่ได้) ในธุรกรรมสั้นของตัวเองก่อนธุรกรรมหลัก (ธุรกรรมหลักเริ่มด้วยล็อกเบอร์
 *    ตาม `database.md`) · dry-run = สร้างในธุรกรรมหลักแล้ว rollback ไปด้วย (INSERT users ไม่ถือล็อกที่ผู้เขียนเบอร์ลูกค้าใช้)
 * 7. `$transaction`: `writeLegacyImport` (ล็อกเบอร์ลูกค้าเองเป็นคำสั่งแรก) → `runGates` (ธุรกรรมเดียวกัน · `bookContracts` =
 *    จำนวนสัญญาใน dump) → dry-run หรือด่านใดไม่ผ่าน = throw
 *    `Rollback` · `LegacyWriteBlocked` = แถวตัวบล็อกของตัวเขียนลง `blockers.csv` (rollback ทั้งก้อน)
 * 8. หลัง COMMIT เท่านั้น: `audit.log(legacyImportAuditEntry(...))` หนึ่งแถว
 * 9. `import-result.json` ทุกกรณี (ยอดนับ ด่าน ตัวบล็อก เศษปัด/เศษสตางค์ ไฟล์ ข้อเตือน seed + เลขสัญญาที่สุ่ม 6.8 — ไม่มีข้อมูล
 *    ลูกค้า) + `sample.csv` · ด่านไม่ผ่าน = `gate-failures.csv`
 */
export async function runImport(
  prisma: PrismaClient,
  args: ImportArgs,
  deps: Partial<ImportDeps> = {},
): Promise<ImportOutcome> {
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
    now: () => new Date(),
    ...deps,
  };
  const allowBlockers = args.allowBlockers === true;
  const resultPath = join(args.out, 'import-result.json');

  // ① ด่านที่ไม่แตะฐาน
  const { expectedDb, dryRun } = importMode(d.env, allowBlockers);
  assertOutDir(args.out);
  await assertFilesDir(args.filesDir);
  const cutoff = parseCutoff(args.cutoff);
  const txTimeoutMin = args.txTimeoutMin ?? DEFAULT_TX_TIMEOUT_MIN;
  const maxMissing = args.maxMissingFiles ?? DEFAULT_MAX_MISSING_FILES;
  const prefix = args.storagePrefix ?? DEFAULT_STORAGE_PREFIX;
  const { key, salt } = piiSecrets(d.env);
  d.log(`${LOG} import · โหมด ${dryRun ? 'DRY-RUN (เขียนแล้ว rollback)' : 'เขียนจริง (COMMIT)'}`);

  // ② storage
  let storage: LegacyFileStorage = DRY_RUN_STORAGE;
  let storageInfo: Record<string, string> = { backend: 'dry-run (ไม่อัปโหลด)' };
  if (!dryRun) {
    const real = await d.storage();
    const desc = real.describe();
    storageInfo = { ...desc };
    d.log(`  storage                    : ${desc.backend} ${desc.location}`);
    if (desc.backend === 'none' || desc.backend === 'local') {
      throw new Error(
        `รอบเขียนจริงต้องอัปโหลดไฟล์แนบขึ้น GCS (หรือ S3) — storage ตอนนี้เป็น ${desc.backend} · ` +
          'ไม่ตั้ง STORAGE_LOCAL_DIR แล้วตั้ง GCS_BUCKET=<bucket ของ prod> (gcloud auth application-default login ก่อน) แล้วรันใหม่',
      );
    }
    storage = real;
  }

  // ③ ฐาน (อ่านอย่างเดียว)
  const [{ current_database: actualDb }] = await prisma.$queryRaw<{ current_database: string }[]>`
    SELECT current_database()`;
  if (actualDb !== expectedDb) {
    throw new Error(
      `ฐานไม่ตรง: ต่ออยู่ "${actualDb}" แต่ EXPECTED_DB_NAME="${expectedDb}" — ยกเลิก`,
    );
  }
  assertProdAllowed(d.env, actualDb === PROD_DB_NAME);
  d.log(`  ฐานข้อมูล                  : ${actualDb}`);

  const sample = await samplePiiKeys(prisma, key, salt);
  const keyProblems = assessKeySafety({
    decryptFailedColumns: sample.decryptFailed,
    withCiphertext: sample.withCiphertext,
    saltSuspect: sample.saltSuspect,
    consistentWithHash: sample.consistentWithHash,
  });
  if (keyProblems.length > 0) {
    throw new Error(
      `ด่านกุญแจ PII ไม่ผ่าน — ${keyProblems.join(' · ')} · ห้ามนำเข้า: ตั้ง PII_ENCRYPTION_KEY / PII_HASH_SALT ให้ตรงกับ API ของฐานนี้`,
    );
  }
  if (sample.withCiphertext === 0) {
    const message =
      'ไม่มีลูกค้าที่มี ciphertext + hash ให้ตรวจกุญแจ/salt — ยืนยันว่ากุญแจตรงกับ API เองก่อน';
    if (!dryRun && d.env.ALLOW_UNVERIFIED_PII_KEYS !== CONSENT) {
      throw new Error(`${message} แล้วตั้ง ALLOW_UNVERIFIED_PII_KEYS=${CONSENT}`);
    }
    d.log(`  ⚠ ${message}`);
  } else {
    d.log(`  กุญแจ/salt PII             : ผ่าน (ตรวจ ${sample.withCiphertext} ค่า)`);
  }

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
  let systemUser = await prisma.user.findUnique({
    where: { email: LEGACY_SYSTEM_USER_EMAIL },
    select: { id: true, isActive: true },
  });
  if (systemUser?.isActive) {
    d.log(`  ⚠ ผู้ใช้ระบบ ${LEGACY_SYSTEM_USER_EMAIL} ยังล็อกอินได้ (is_active) — ควรปิด`);
  }

  // ④ แผน
  const inputs = await loadInputs(args, cutoff, d.loadBook);
  let plan = planImport(inputs.book, inputs.opts);
  const importBatch = importBatchId(d.now(), dryRun);
  const warnings = planWarnings(plan);
  let files = { uploaded: 0, missing: 0, failed: 0 };
  let gates: GateResult[] = [];
  let report: WriteReport | null = null;
  let blockers: ImportBlocker[] = plan.blockers;
  let committed = false;
  let outcome: ImportOutcomeKind = 'ERROR';
  let errorText: string | null = null;
  const extraFiles: Record<string, string> = {};
  const sampleSeed = args.sampleSeed ?? defaultSampleSeed(plan.cutoff);
  const sampleCodes = d.sampleForManualCheck(plan, SAMPLE_SIZE, sampleSeed);
  extraFiles['sample.csv'] = sampleCsv(plan, sampleCodes);

  const finish = async (): Promise<ImportOutcome> => {
    const result = {
      command: 'import',
      mode: dryRun ? 'dry-run' : 'commit',
      outcome,
      committed,
      error: errorText,
      database: actualDb,
      importBatch,
      generatedAt: d.now(),
      cutoff: plan.cutoff,
      catchUpAt: plan.catchUpAt,
      storage: storageInfo,
      plan: plan.totals,
      blockers: { ...blockerSummary(blockers), rows: blockers },
      files: { attachmentPaths: attachmentPathsOf(plan).length, ...files },
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
      gates,
      sample: { seed: sampleSeed, codes: sampleCodes },
      warnings: { count: warnings.length, byKind: countBy(warnings, (w) => w.kind) },
    };
    await writeOutputs(args.out, {
      ...extraFiles,
      'import-result.json': `${JSON.stringify(toJsonSafe(result), null, 2)}\n`,
    });
    d.log(
      `  ผล                         : ${outcome}${committed ? ' (COMMIT แล้ว)' : ' (ไม่มีอะไรถูกเขียน)'}`,
    );
    d.log(
      `  เขียนไฟล์                  : ${Object.keys(extraFiles).concat('import-result.json').join(', ')} → ${args.out}`,
    );
    return { committed, outcome, gates, report, blockers, files, resultPath };
  };

  /** แถวตัวบล็อก → `blockers.csv` + `customers-blocked.csv` (ธงลูกค้าที่ชนมีเลขบัตรหรือไม่ — อ่านฐาน ไม่อ่านค่า) */
  const blockerFiles = async (rows: readonly ImportBlocker[], withDb: boolean) => {
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
    extraFiles['blockers.csv'] = blockersCsv(rows);
    extraFiles['customers-blocked.csv'] = customersBlockedCsv(
      rows,
      inputs.opts.customerOverrides,
      relatedWithId,
    );
  };

  d.log(
    `  แผน                        : นำเข้า ${plan.items.length} · ตัวบล็อก ${plan.blockers.length} แถว · ข้าม ${plan.skipped.length}`,
  );
  if (plan.blockers.length > 0) {
    await blockerFiles(plan.blockers, false);
    if (!allowBlockers) {
      outcome = 'PLAN_BLOCKED';
      return finish();
    }
    d.log('  ⚠ --allow-blockers: ซ้อมเฉพาะสัญญาที่ผ่าน (dry-run เท่านั้น)');
  }

  try {
    // ⑤ ไฟล์แนบ
    const paths = attachmentPathsOf(plan);
    d.log(
      `  ไฟล์แนบ                    : ${paths.length} ไฟล์${dryRun ? ' (อ่านอย่างเดียว ไม่อัปโหลด)' : ''}`,
    );
    const upload = await d.uploadFiles(
      args.filesDir,
      paths,
      withProgress(storage, paths.length, d.log),
      prefix,
    );
    files = {
      uploaded: upload.details.size,
      missing: upload.missing.length,
      failed: upload.failed.length,
    };
    if (upload.missing.length > 0 || upload.failed.length > 0) {
      extraFiles['missing-files.csv'] = missingFilesCsv(plan, upload);
    }
    if (upload.missing.length > maxMissing) {
      d.log(
        `  ✗ ไฟล์แนบหาไม่เจอ ${upload.missing.length} ไฟล์ (เกิน --max-missing-files ${maxMissing}) — ตรวจว่า --files-dir ชี้โฟลเดอร์ httpdocs ของ zip ชุดเดียวกับ dump`,
      );
      outcome = 'FILES_MISSING';
      return await finish();
    }
    if (upload.failed.length > 0 && !dryRun) {
      d.log(
        `  ✗ อ่าน/อัปโหลดไม่สำเร็จ ${upload.failed.length} ไฟล์ — รันซ้ำได้ (key เดิม อัปโหลดทับ)`,
      );
      outcome = 'FILES_FAILED';
      return await finish();
    }
    plan = planImport(inputs.book, { ...inputs.opts, files: upload.details });

    // ⑥ ผู้ใช้ระบบ (เขียนจริงเท่านั้นที่สร้างนอกธุรกรรมหลัก)
    if (!systemUser && !dryRun) {
      systemUser = await prisma.user.create({
        data: legacySystemUserData(),
        select: { id: true, isActive: true },
      });
      d.log(`  สร้างผู้ใช้ระบบ ${LEGACY_SYSTEM_USER_EMAIL} (ล็อกอินไม่ได้)`);
    }
    const existingUserId = systemUser?.id ?? null;

    // ⑦ ธุรกรรม
    d.log(`  เปิดธุรกรรม (timeout ${txTimeoutMin} นาที) · รอบ ${importBatch}`);
    let systemUserId = existingUserId ?? '';
    try {
      const done = await prisma.$transaction(
        async (tx) => {
          const userId =
            existingUserId ??
            (await tx.user.create({ data: legacySystemUserData(), select: { id: true } })).id;
          const written = await d.write(tx, plan, {
            journal: d.journal,
            pii: d.pii,
            financeCompanyId: finance.id,
            branchId: branch.id,
            systemUserId: userId,
            files: upload.details,
            importBatch,
            allowPlanBlockers: allowBlockers,
          });
          const result = {
            report: written,
            gates: await d.runGates(tx, plan, written, plan.cutoff, {
              bookContracts: inputs.book.contracts.length,
            }),
            systemUserId: userId,
          };
          if (dryRun || result.gates.some((g) => !g.pass) || upload.failed.length > 0) {
            throw new Rollback(result);
          }
          return result;
        },
        { timeout: txTimeoutMin * 60_000, maxWait: TX_MAX_WAIT_MS },
      );
      ({ report, gates, systemUserId } = done);
      committed = true;
      outcome = 'COMMITTED';
    } catch (error) {
      if (error instanceof Rollback) {
        ({ report, gates } = error.result);
        outcome = !gates.every((g) => g.pass)
          ? 'GATES_FAILED'
          : upload.failed.length > 0
            ? 'FILES_FAILED'
            : 'DRY_RUN_ROLLED_BACK';
      } else if (error instanceof LegacyWriteBlocked) {
        blockers = error.rows;
        await blockerFiles(error.rows, true);
        outcome = 'WRITE_BLOCKED';
      } else {
        throw error;
      }
    }
    for (const g of gates) {
      d.log(`  ด่าน ${g.id} ${g.pass ? 'ผ่าน' : 'ไม่ผ่าน'} ${GATE_LABELS[g.id]} — ${g.detail}`);
    }
    if (allowBlockers && plan.blockers.length > 0 && gates.some((g) => g.id === '6.1' && !g.pass)) {
      d.log(
        '  ⓘ ด่าน 6.1 ไม่ผ่านโดยออกแบบเมื่อแผนมีตัวบล็อก (--allow-blockers ซ้อมเฉพาะสัญญาที่ผ่าน) — รอบเขียนจริงต้องไม่มีตัวบล็อก',
      );
    }
    if (gates.some((g) => !g.pass)) extraFiles['gate-failures.csv'] = gateFailuresCsv(gates);

    // ⑧ หลัง COMMIT เท่านั้น
    if (committed && report) {
      await d.audit.log(legacyImportAuditEntry(report, systemUserId));
    }
  } catch (error) {
    errorText = safeErrorText(error);
    outcome = 'ERROR';
    await finish();
    throw error;
  }
  return finish();
}

/** ผู้ใช้ระบบ "ย้ายจากระบบเก่า" — ล็อกอินไม่ได้ (รหัสผ่านที่ bcrypt ไม่มีทางตรง · `is_active` false · `is_system_user`) */
function legacySystemUserData(): Prisma.UserCreateInput {
  return {
    email: LEGACY_SYSTEM_USER_EMAIL,
    name: 'ย้ายจากระบบเก่า',
    password: DISABLED_PASSWORD,
    isActive: false,
    isSystemUser: true,
  };
}

async function defaultStorage(): Promise<ImportStorage> {
  const { ConfigService } = await import('@nestjs/config');
  const { StorageService } = await import('../../modules/storage/storage.service');
  return new StorageService(new ConfigService());
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
    canceledMap: optional(values, 'canceled-map'),
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
  'canceled-map',
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
        '[--canceled-map <csv>] [--money-overrides <csv>] [--customer-overrides <csv>] [--files-dir <httpdocs>] ' +
        '[--sample-seed <text>]',
      help: [
        'ไม่แตะฐานข้อมูล · --out และ --files-dir ต้องอยู่นอก repo',
        `เขียน: ${REPORT_FILES.join(', ')} (+ missing-files.csv เมื่อส่ง --files-dir)`,
        'ไฟล์ที่กรอกแล้วส่งกลับได้: canceled.csv → --canceled-map · money-mismatch.csv → --money-overrides · ' +
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
        '[--peak-pairs <csv>] [--canceled-map <csv>] [--money-overrides <csv>] [--customer-overrides <csv>] ' +
        '[--tx-timeout-min 20] [--max-missing-files 10] [--storage-prefix legacy-import] [--sample-seed <text>] ' +
        '[--allow-blockers]',
      help: [
        'ค่าเริ่มต้น = DRY-RUN (เขียนในธุรกรรมแล้ว rollback · ไฟล์แนบอ่านอย่างเดียว ไม่อัปโหลด)',
        'env: EXPECTED_DB_NAME=<ชื่อฐาน> (บังคับ) · CONFIRM_LEGACY_IMPORT=YES_I_AM_SURE (เขียนจริง) · ' +
          'ALLOW_PROD_LEGACY_IMPORT=YES_I_AM_SURE (ฐาน prod / NODE_ENV=production — ทั้ง dry-run และเขียนจริง) · ' +
          'PII_ENCRYPTION_KEY + PII_HASH_SALT (ของ API ฐานนั้น) · DATABASE_URL · เขียนจริง: GCS_BUCKET (หรือ S3_*)',
        'เขียน: import-result.json + sample.csv ทุกครั้ง · blockers.csv + customers-blocked.csv เมื่อมีตัวบล็อก · ' +
          'missing-files.csv เมื่อมีไฟล์หาไม่เจอ · gate-failures.csv เมื่อมีด่านไม่ผ่าน',
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

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  log: (line: string) => void = (line) => console.log(line),
): Promise<void> {
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
