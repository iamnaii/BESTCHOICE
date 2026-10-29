import { Prisma } from '@prisma/client';
import type { ContractStatus, JournalEntryStatus } from '@prisma/client';
import {
  LEGACY_OPENING_FLOW,
  LEGACY_PRIOR_RECEIPT_FLOW,
  LEGACY_VAT_CATCHUP_FLOW,
  isExcludedFromPeakExport,
  isExcludedLegacyInterestLine,
  isLegacyInterestAccount,
  peakExportContractId,
  peakExportOriginalEntryId,
} from '../../modules/accounting/peak-export-exclusion';
import { ACCRUAL_EXCLUDED_CONTRACT_STATUSES } from '../../modules/journal/accrual-contract-status';
import { bangkokDateString, bangkokStartOfDay } from '../../utils/date.util';
import { seededShuffle } from '../../utils/shuffle.util';
import { formatMoney } from './csv';
import { CARRY_FORWARD_ACCOUNTS } from './opening';
import type { ImportPlan, PlannedContract } from './plan-import';
import type { WriteReport } from './writer';

/**
 * ด่านตรวจก่อนเปิดใช้ (Task 12 · สเปก §6) — รันใน**ธุรกรรมนำเข้าเดียวกับตัวเขียน** (`writeLegacyImport`) ก่อน commit ·
 * อ่านทุกอย่างผ่าน `tx` (แถวที่ยังไม่ commit มองเห็นเฉพาะใน `tx`) · ไม่เขียนอะไรเลย · ผู้เรียก (Task 13) rollback เมื่อด่านใดไม่ผ่าน
 *
 * | ด่าน | ผ่านเมื่อ |
 * |---|---|
 * | 6.1 | แผน (`plan.totals` = ผลรวมรายสัญญา · ไม่มีตัวบล็อก · ครบจำนวนสัญญาใน dump ถ้าส่ง `bookContracts`) = รายงานตัวเขียน (`report.created`) = แถวในฐาน ต่อสัญญา: สัญญา (เลขเดิม / เลขสัญญา / สถานะ) · ตารางงวด · งวด (จำนวน + ยอด) · สลิป · เอกสาร (หักไฟล์ที่ไม่ได้อัปโหลด) · รายการบัญชีตาม flow · ลูกค้า (หนึ่งสมาชิก = หนึ่งลูกค้า) |
 * | 6.2 | สัญญาผ่อนอยู่ทุกสัญญา: Σ(`amountDue − amountPaid`) ของ Payment = ยอดคงเหลือใบแจ้งหนี้ PEAK (`plan.items[].peak.remain`) ตรงทุกสตางค์ — ส่วนต่างกับระบบเก่า (ปรับลดตาม PEAK / เศษสตางค์) รายงานอย่างเดียว · สัญญาประวัติไม่ตรวจ |
 * | 6.3 | ไม่มีรายการบัญชีของสัญญาที่นำเข้าลงวันที่ถึงวันตัด (`entryDate` หรือ `postedAt` ≤ `cutoff`) นอกจาก flow `legacy-opening` / `legacy-prior-receipt` |
 * | 6.4 | GL ต่อสัญญา (ความหมายเดียวกับ `glContractBalance`) ของ `CARRY_FORWARD_ACCOUNTS` = บรรทัดรายการยกมาของ `computeOpening` + marker + รายการไล่ VAT (ลงในธุรกรรมเดียวกัน ⇒ 21-2102 = ยกมา − ไล่ VAT) · ลูกหนี้ใน GL (11-2101 + 11-2103 + 11-2105) = ยอดค้างตามแถวงวด + `roundingDiff` · สัญญาประวัติไม่มียอด · รายงาน Σ `roundingDiff` / เศษสตางค์ PEAK |
 * | 6.5 | เงื่อนไขเดียวกับรอบตั้งลูกหนี้งวด 2A (`installment-accrual.cron.ts`) และรอบภาษีขาย 60 วัน (`vat-60day.cron.ts`) จำกัดเฉพาะสัญญาที่นำเข้า ไม่เจองวดที่ครบกำหนดถึงวันตัด · ไม่มีแถวงวดที่ผูก `vat60dayJournalEntryId` |
 * | 6.6 | ทุกรายการของสัญญาที่นำเข้าที่ลงวันที่ถึงวันตัด `isExcludedFromPeakExport(entry, original)` และมี `peakSyncedAt` · รายการไล่ VAT ลงหลังวันตัด **ไม่**ถูกตัดและไม่มี `peakSyncedAt` (ต้องเข้า PEAK) — ห้ามเรียก `exportJournalWithPeakCodes` ในธุรกรรม (อ่านด้วย `this.prisma` จึงไม่เห็นแถวที่ยังไม่ commit) ไฟล์ส่งออกจริงตรวจตอนซ้อม (Task 14) |
 * | 6.7 | ไม่มีบรรทัด 21-1101 / 21-1102 ของสัญญาที่นำเข้า (คิวรอจ่ายร้านฝั่ง FINANCE อ่านจากสองบัญชีนี้) |
 * | 6.9 | สัญญาผ่อนอยู่ทุกสัญญา: `customer.contact.peakContactCode` ไม่ว่าง และ = รหัสผู้ติดต่อของใบแจ้งหนี้ PEAK ที่จับคู่ |
 * | 6.10 | ทุกบรรทัด 11-2106 / 41-1101 ของสัญญาที่นำเข้า: `isExcludedFromPeakExport(entry, original) \|\| isExcludedLegacyInterestLine(line, สัญญาจาก peakExportContractId)` (ตัวกรองชุดเดียวกับไฟล์ส่งออก) · ทุกสัญญาที่นำเข้ามี `legacyContractCode` · `interestTotal` = ดอกเบี้ยตามสัญญาเดิมในแผน · รายงานจำนวนสัญญาผ่อนอยู่ที่ถ้าเปลี่ยนเครื่อง รายการปิดสัญญาเดิมจะส่งออกไม่ดุล (รอสำนักงานบัญชี — ไม่ใช่เงื่อนไขผ่าน) |
 *
 * 6.8 (สุ่มเทียบด้วยตา) = `sampleForManualCheck` — คนเทียบกับ PEAK / หน้าจอระบบเก่าในคืนตัด
 *
 * **สัญญาที่นำเข้า** = id ใน `report.contractIds` (สร้างรอบนี้ — ยังเจอแม้ `legacyContractCode` ถูกล้าง) ∪ สัญญาที่
 * `legacyContractCode` อยู่ในแผน (`report.skippedExisting`) · **รายการบัญชีของสัญญา** = รายการที่ไม่ถูกลบ (ทุกสถานะ) ที่
 * `peakExportContractId(entry, original)` ชี้สัญญาเหล่านั้น — รวมรายการกลับ / กระจกที่สืบสัญญาจากรายการต้นฉบับ แบบเดียวกับไฟล์ส่งออก
 *
 * **6.4 ใช้ได้ ณ คืนตัดเท่านั้น** (GL ไม่กรองวันที่ เหมือน `glContractBalance`) — รันซ้ำหลังรอบกลางคืนลง 2A แล้ว (ซ้อม Task 14)
 * 6.4 จะไม่ผ่านเพราะ GL เดินต่อ · ด่านอื่นรันซ้ำได้
 *
 * **แยกกันทุกด่าน:** แต่ละด่านอยู่ใน SAVEPOINT ของตัวเอง — ด่านที่ throw (รวม error ของ Postgres ที่ทำให้ธุรกรรมใช้ต่อไม่ได้) =
 * `pass: false` พร้อมชื่อคลาส/รหัสของ error แล้ว rollback ถึง savepoint ด่านถัดไปยังรันได้ · `tx` ที่ไม่ใช่ธุรกรรม (SAVEPOINT ไม่ได้)
 * = รันต่อโดยไม่มี savepoint
 *
 * `detail` / `failures` มีแค่จำนวน ยอดรวม เลขสัญญาเดิม เลขงวด เลขที่รายการบัญชี รหัสบัญชี และเลขใบแจ้งหนี้ PEAK — ไม่มีชื่อ เบอร์
 * เลขบัตร id ลูกค้า id สัญญา หรือรหัสผู้ติดต่อ PEAK
 */

type Decimal = Prisma.Decimal;

const ZERO = new Prisma.Decimal(0);
const DAY_MS = 86_400_000;
const RECEIVABLE_ACCOUNTS = ['11-2101', '11-2103', '11-2105'] as const;
const SHOP_PAYABLE_ACCOUNTS: ReadonlySet<string> = new Set(['21-1101', '21-1102']);
const PEAK_EXCLUDED_IMPORT_FLOWS: ReadonlySet<string> = new Set([
  LEGACY_OPENING_FLOW,
  LEGACY_PRIOR_RECEIPT_FLOW,
]);
/** ผลยกเลิก/หนี้เสียที่เจ้าของยืนยัน (`CanceledResolution`) — ชั้นของการสุ่ม 6.8 */
const CANCELED_STATUSES: ReadonlySet<ContractStatus> = new Set<ContractStatus>([
  'TERMINATED',
  'CANCELED',
  'CLOSED_BAD_DEBT',
  'EXCHANGED',
]);

export const GATE_IDS = ['6.1', '6.2', '6.3', '6.4', '6.5', '6.6', '6.7', '6.9', '6.10'] as const;
export type GateId = (typeof GATE_IDS)[number];

/** `code` = เลขสัญญาเดิม (แถวของแผนที่ไม่ผูกสัญญา = รหัสในแผน / `plan`) */
export type GateFailure = { code: string; detail: string };
export type GateResult = { id: GateId; pass: boolean; detail: string; failures?: GateFailure[] };

export type GateOptions = {
  /** จำนวนสัญญาใน dump (`book.contracts.length`) — ส่งมา = 6.1 ตรวจว่าแผนนับครบ (นำเข้า + ข้าม + ตัวบล็อก) */
  bookContracts?: number;
};

/** ชื่อด่านภาษาไทย — ให้ Task 13 พิมพ์ในรายงาน */
export const GATE_LABELS: Record<GateId, string> = {
  '6.1': 'จำนวนตรง — แผน · รายงานตัวเขียน · ฐานข้อมูล',
  '6.2': 'ยอดค้างตรง PEAK ทุกสัญญาผ่อนอยู่ (ส่วนต่าง 0 บาท)',
  '6.3': 'ไม่มีรายการบัญชีย้อนหลัง นอกจากรายการยกมา',
  '6.4': 'ยอดบัญชียกมาตรงทะเบียนสัญญา',
  '6.5': 'รอบกลางคืนไม่หยิบงวดที่ถึงกำหนดก่อนวันตัด',
  '6.6': 'ยอดยกมาไม่หลุดเข้า PEAK',
  '6.7': 'ไม่มีคิวจ่ายร้านของสัญญาที่นำเข้า',
  '6.9': 'รหัสลูกค้า PEAK ครบและตรงใบแจ้งหนี้',
  '6.10': 'ดอกเบี้ยสัญญาเก่าไม่หลุดเข้า PEAK',
};

// ── อ่านข้อมูล ──────────────────────────────────────────────────────────────────────────────────

const CONTRACT_SELECT = {
  id: true,
  contractNumber: true,
  legacyContractCode: true,
  status: true,
  interestTotal: true,
  customerId: true,
  deletedAt: true,
  customer: { select: { contact: { select: { peakContactCode: true } } } },
} satisfies Prisma.ContractSelect;
type ContractRow = Prisma.ContractGetPayload<{ select: typeof CONTRACT_SELECT }>;

type Imported = {
  /** เลขสัญญาเดิมในแผน → สัญญา */
  byCode: Map<string, ContractRow>;
  /** id สัญญา → เลขสัญญาเดิมในแผน */
  codeOf: Map<string, string>;
  ids: string[];
};

async function loadImported(
  tx: Prisma.TransactionClient,
  plan: ImportPlan,
  report: WriteReport,
): Promise<Imported> {
  const codes = plan.items.map((i) => i.code);
  const rows = await tx.contract.findMany({
    where: {
      OR: [{ id: { in: [...report.contractIds.values()] } }, { legacyContractCode: { in: codes } }],
    },
    select: CONTRACT_SELECT,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const planCodes = new Set(codes);
  const byCode = new Map<string, ContractRow>();
  for (const [code, id] of report.contractIds) {
    const row = byId.get(id);
    if (row) byCode.set(code, row);
  }
  for (const row of rows) {
    const code = row.legacyContractCode;
    if (code && planCodes.has(code) && !byCode.has(code)) byCode.set(code, row);
  }
  const codeOf = new Map([...byCode].map(([code, row]) => [row.id, code]));
  return { byCode, codeOf, ids: [...codeOf.keys()] };
}

const ENTRY_SELECT = {
  id: true,
  entryNumber: true,
  status: true,
  entryDate: true,
  postedAt: true,
  peakSyncedAt: true,
  metadata: true,
  referenceType: true,
  referenceId: true,
  lines: { select: { accountCode: true, debit: true, credit: true, deletedAt: true } },
} satisfies Prisma.JournalEntrySelect;
type EntryRow = Prisma.JournalEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

type ContractEntry = EntryRow & {
  /** รายการต้นฉบับ (รายการกลับ / กระจก) — `null` = ไม่ใช่รายการกลับ หรือหาไม่เจอ */
  original: { metadata: unknown } | null;
  /** `peakExportContractId(entry, original)` — อยู่ในสัญญาที่นำเข้าเสมอ */
  contractId: string;
};

function metaString(metadata: unknown, key: string): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** รายการที่ไม่ถูกลบของสัญญา (ของตัวเอง + กระจกที่สืบสัญญาจากต้นฉบับ) พร้อมบรรทัดทุกบรรทัด (มี `deletedAt`) */
async function loadContractEntries(
  tx: Prisma.TransactionClient,
  contractIds: readonly string[],
): Promise<ContractEntry[]> {
  if (contractIds.length === 0) return [];
  const ids = [...contractIds];
  const own = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM journal_entries
    WHERE deleted_at IS NULL AND metadata->>'contractId' = ANY(${ids}::text[])`);
  const ownIds = own.map((r) => r.id);
  const mirrors =
    ownIds.length === 0
      ? []
      : await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM journal_entries
          WHERE deleted_at IS NULL
            AND (metadata->>'originalEntryId' = ANY(${ownIds}::text[])
              OR (reference_type = 'REVERSAL' AND reference_id = ANY(${ownIds}::text[])))`);
  const entryIds = [...new Set([...ownIds, ...mirrors.map((r) => r.id)])];
  if (entryIds.length === 0) return [];
  const rows = await tx.journalEntry.findMany({
    where: { id: { in: entryIds } },
    select: ENTRY_SELECT,
    orderBy: { entryNumber: 'asc' },
  });

  // ต้นฉบับของรายการกลับ: อ่านทุกสถานะ / แม้ถูกลบ (แบบไฟล์ส่งออก) · ชั้นเดียว
  const originals = new Map<string, { metadata: unknown }>(
    rows.map((r) => [r.id, { metadata: r.metadata }]),
  );
  const missing = [
    ...new Set(rows.map((r) => peakExportOriginalEntryId(r)).filter((id): id is string => !!id)),
  ].filter((id) => !originals.has(id));
  if (missing.length > 0) {
    for (const o of await tx.journalEntry.findMany({
      where: { id: { in: missing } },
      select: { id: true, metadata: true },
    })) {
      originals.set(o.id, { metadata: o.metadata });
    }
  }
  const wanted = new Set(ids);
  return rows.flatMap((row) => {
    const originalId = peakExportOriginalEntryId(row);
    const original = originalId ? (originals.get(originalId) ?? null) : null;
    const contractId = peakExportContractId(row, original);
    return contractId && wanted.has(contractId) ? [{ ...row, original, contractId }] : [];
  });
}

/**
 * ยอด Dr − Cr ต่อสัญญาต่อบัญชี — ความหมายเดียวกับ `glContractBalance(…, 'dr')`: รายการ `POSTED` ที่ไม่ถูกลบ และ
 * `metadata.contractId` ของรายการเอง = สัญญา (ไม่สืบจากต้นฉบับ) · นับทุกบรรทัด (`glContractBalance` ไม่กรอง `deletedAt` ของบรรทัด)
 */
function glByContract(entries: readonly ContractEntry[]): Map<string, Map<string, Decimal>> {
  const out = new Map<string, Map<string, Decimal>>();
  for (const entry of entries) {
    if (entry.status !== ('POSTED' satisfies JournalEntryStatus)) continue;
    const contractId = metaString(entry.metadata, 'contractId');
    if (!contractId || contractId !== entry.contractId) continue;
    const accounts = out.get(contractId) ?? new Map<string, Decimal>();
    out.set(contractId, accounts);
    for (const line of entry.lines) {
      accounts.set(
        line.accountCode,
        (accounts.get(line.accountCode) ?? ZERO).plus(line.debit).minus(line.credit),
      );
    }
  }
  return out;
}

/** GL (Dr − Cr) ต่อสัญญาต่อบัญชีของสัญญาที่ส่งมา — ตัวเดียวกับที่ด่าน 6.4 ใช้ (เทสต์เทียบกับ `glContractBalance`) */
export async function loadContractGl(
  tx: Prisma.TransactionClient,
  contractIds: readonly string[],
): Promise<Map<string, Map<string, Decimal>>> {
  return glByContract(await loadContractEntries(tx, contractIds));
}

// ── ตัวช่วย ────────────────────────────────────────────────────────────────────────────────────

const sumOf = (values: readonly Decimal[]) => values.reduce((s, v) => s.plus(v), ZERO);
const money = (value: Decimal) => formatMoney(value);
const isOnOrBefore = (entry: Pick<EntryRow, 'entryDate' | 'postedAt'>, cutoff: Date) =>
  entry.entryDate.getTime() <= cutoff.getTime() ||
  (entry.postedAt !== null && entry.postedAt.getTime() <= cutoff.getTime());
const liveLines = (entry: EntryRow) => entry.lines.filter((l) => l.deletedAt === null);
const entryLabel = (entry: EntryRow) =>
  `รายการ ${entry.entryNumber} (flow ${metaString(entry.metadata, 'flow') ?? '-'} · ลงวันที่ ${bangkokDateString(entry.entryDate)})`;

/** ชื่อคลาส/รหัสของ error — ไม่ใช้ข้อความ (อาจมีค่าในแถว) */
function errorLabel(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const name = error instanceof Error ? error.name || error.constructor?.name : 'Error';
  return typeof code === 'string' ? `${name}:${code}` : name;
}

/** memo เฉพาะผลที่สำเร็จ — อ่านพลาดในด่านหนึ่ง ด่านถัดไปอ่านใหม่ (หลัง rollback ถึง savepoint) */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = load().catch((error: unknown) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
}

type GateBody = { pass?: boolean; detail: string; failures: GateFailure[] };

function result(id: GateId, body: GateBody): GateResult {
  const pass = body.pass ?? body.failures.length === 0;
  return body.failures.length > 0
    ? { id, pass, detail: body.detail, failures: body.failures }
    : { id, pass, detail: body.detail };
}

// ── ด่าน ──────────────────────────────────────────────────────────────────────────────────────

type Ctx = {
  tx: Prisma.TransactionClient;
  plan: ImportPlan;
  report: WriteReport;
  cutoff: Date;
  opts: GateOptions;
  imported: () => Promise<Imported>;
  entries: () => Promise<ContractEntry[]>;
};

async function gate61(ctx: Ctx): Promise<GateBody> {
  const { tx, plan, report } = ctx;
  const failures: GateFailure[] = [];
  const fail = (code: string, detail: string) => failures.push({ code, detail });
  const items = plan.items;
  const active = items.filter((i) => i.kind === 'ACTIVE');
  const t = plan.totals;

  // แผน: ยอดรวมของแผน = ผลรวมรายสัญญา · ไม่มีตัวบล็อก · ครบจำนวนใน dump
  const count = (f: (i: PlannedContract) => number) => items.reduce((n, i) => n + f(i), 0);
  const planChecks: Array<[string, number, number]> = [
    ['สัญญาผ่อนอยู่', t.contracts.active, active.length],
    ['สัญญาประวัติ', t.contracts.history, items.length - active.length],
    ['แถวตารางงวด', t.schedules, count((i) => i.schedule.length)],
    ['งวด', t.payments, count((i) => i.payments.length)],
    ['สลิป', t.evidences, count((i) => i.evidences.length)],
    ['เอกสาร', t.documents, count((i) => i.documents.length)],
    ['marker', t.markers, count((i) => i.opening?.priorReceiptMarkers.length ?? 0)],
  ];
  for (const [label, total, actual] of planChecks) {
    if (total !== actual) fail('plan', `ยอดรวมของแผน ${label} ${total} ≠ ผลรวมรายสัญญา ${actual}`);
  }
  for (const b of plan.blockers) fail(b.code, `แผนมีตัวบล็อก ${b.reason}`);
  const planned =
    t.contracts.active + t.contracts.history + t.contracts.skipped + t.contracts.blocked;
  if (ctx.opts.bookContracts !== undefined && planned !== ctx.opts.bookContracts) {
    fail('plan', `แผนนับสัญญาได้ ${planned} ≠ สัญญาใน dump ${ctx.opts.bookContracts}`);
  }

  // รายงานตัวเขียน
  const planCodes = new Set(items.map((i) => i.code));
  const created = report.created;
  if (created.contracts + report.skippedExisting.length !== items.length) {
    fail(
      'report',
      `สร้าง ${created.contracts} + มีอยู่แล้ว ${report.skippedExisting.length} ≠ สัญญาในแผน ${items.length}`,
    );
  }
  if (report.contractIds.size !== created.contracts) {
    fail('report', `contractIds ${report.contractIds.size} ≠ สัญญาที่สร้าง ${created.contracts}`);
  }
  for (const code of [...report.contractIds.keys(), ...report.skippedExisting]) {
    if (!planCodes.has(code)) fail(code, 'สัญญาในรายงานตัวเขียนไม่อยู่ในแผน');
  }

  // สัญญาในฐาน
  const imported = await ctx.imported();
  const byStatus: Record<string, number> = {};
  for (const item of items) {
    const row = imported.byCode.get(item.code);
    if (!row) {
      fail(item.code, 'ไม่พบสัญญาในฐาน');
      continue;
    }
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    if (row.deletedAt) fail(item.code, 'สัญญาถูกลบ (deletedAt)');
    if (row.legacyContractCode !== item.code) fail(item.code, 'legacyContractCode ≠ เลขสัญญาเดิม');
    if (row.contractNumber !== item.code) fail(item.code, 'เลขสัญญา ≠ เลขสัญญาเดิม');
    if (row.status !== item.status) fail(item.code, `สถานะ ${row.status} ≠ แผน ${item.status}`);
  }

  // แถวของสัญญาที่สร้างรอบนี้ — ต่อสัญญา (ไฟล์ที่ไม่ได้อัปโหลด = ไม่มีแถว)
  const createdItems = items.filter((i) => report.contractIds.has(i.code));
  const createdIds = createdItems.flatMap((i) => {
    const id = imported.byCode.get(i.code)?.id;
    return id ? [id] : [];
  });
  const where = { contractId: { in: createdIds }, deletedAt: null };
  const schedules = new Map(
    (
      await tx.installmentSchedule.groupBy({ by: ['contractId'], where, _count: { _all: true } })
    ).map((g) => [g.contractId, g._count._all]),
  );
  const payments = new Map(
    (
      await tx.payment.groupBy({
        by: ['contractId'],
        where,
        _count: { _all: true },
        _sum: { amountDue: true, amountPaid: true },
      })
    ).map((g) => [g.contractId, g]),
  );
  const evidences = new Map(
    (
      await tx.paymentEvidence.groupBy({
        by: ['contractId'],
        where,
        _count: { _all: true },
        _sum: { amount: true },
      })
    ).map((g) => [g.contractId, g]),
  );
  const documents = new Map(
    (await tx.contractDocument.groupBy({ by: ['contractId'], where, _count: { _all: true } })).map(
      (g) => [g.contractId, g._count._all],
    ),
  );
  const entries = await ctx.entries();
  const flowCount = new Map<string, number>();
  const flowKey = (contractId: string, flow: string) => `${contractId}|${flow}`;
  const ownFlowById = new Map<string, string | null>();
  for (const e of entries) {
    const flow = metaString(e.metadata, 'flow');
    ownFlowById.set(e.id, flow);
    if (flow && metaString(e.metadata, 'contractId') === e.contractId) {
      const key = flowKey(e.contractId, flow);
      flowCount.set(key, (flowCount.get(key) ?? 0) + 1);
    }
  }
  const missingByCode = new Map(report.missingAttachments.map((m) => [m.code, new Set(m.paths)]));
  const customerByCode = new Map(report.customers.map((c) => [c.code, c]));
  const kindFlow = {
    opening: LEGACY_OPENING_FLOW,
    marker: LEGACY_PRIOR_RECEIPT_FLOW,
    'catch-up': LEGACY_VAT_CATCHUP_FLOW,
  } as const;

  const exp = {
    schedules: 0,
    payments: 0,
    evidences: 0,
    documents: 0,
    opening: 0,
    marker: 0,
    catchUp: 0,
    missingFiles: 0,
  };
  for (const item of createdItems) {
    const row = imported.byCode.get(item.code);
    if (!row) continue;
    const id = row.id;
    const missing = missingByCode.get(item.code) ?? new Set<string>();
    exp.missingFiles += missing.size;
    const ev = item.evidences.filter((e) => !missing.has(e.slipPath));
    const docs = item.documents.filter((d) => !missing.has(d.path));
    const opening = item.opening && item.opening.openingLines.length > 0 ? 1 : 0;
    const markers = item.opening?.priorReceiptMarkers.length ?? 0;
    const catchUp = item.opening && item.opening.catchUpLines.length > 0 ? 1 : 0;
    exp.schedules += item.schedule.length;
    exp.payments += item.payments.length;
    exp.evidences += ev.length;
    exp.documents += docs.length;
    exp.opening += opening;
    exp.marker += markers;
    exp.catchUp += catchUp;

    const p = payments.get(id);
    const e = evidences.get(id);
    const checks: Array<[string, string, string]> = [
      ['แถวตารางงวด', String(schedules.get(id) ?? 0), String(item.schedule.length)],
      ['งวด', String(p?._count._all ?? 0), String(item.payments.length)],
      [
        'ยอดเรียกเก็บรวม',
        money(p?._sum.amountDue ?? ZERO),
        money(sumOf(item.payments.map((x) => x.amountDue))),
      ],
      [
        'ยอดจ่ายรวม',
        money(p?._sum.amountPaid ?? ZERO),
        money(sumOf(item.payments.map((x) => x.amountPaid))),
      ],
      ['สลิป', String(e?._count._all ?? 0), String(ev.length)],
      ['ยอดสลิปรวม', money(e?._sum.amount ?? ZERO), money(sumOf(ev.map((x) => x.amount)))],
      ['เอกสาร', String(documents.get(id) ?? 0), String(docs.length)],
      ['รายการยกมา', String(flowCount.get(flowKey(id, LEGACY_OPENING_FLOW)) ?? 0), String(opening)],
      [
        'marker',
        String(flowCount.get(flowKey(id, LEGACY_PRIOR_RECEIPT_FLOW)) ?? 0),
        String(markers),
      ],
      [
        'รายการไล่ VAT',
        String(flowCount.get(flowKey(id, LEGACY_VAT_CATCHUP_FLOW)) ?? 0),
        String(catchUp),
      ],
    ];
    for (const [label, db, want] of checks) {
      if (db !== want) fail(item.code, `${label} ในฐาน ${db} ≠ แผน ${want}`);
    }
    const customer = customerByCode.get(item.code);
    if (!customer) fail(item.code, 'ไม่มีผลผูกลูกค้าในรายงานตัวเขียน');
    else if (customer.customerId !== row.customerId) {
      fail(item.code, 'ลูกค้าของสัญญาในฐาน ≠ รายงานตัวเขียน');
    }
  }
  const totalChecks: Array<[string, number, number]> = [
    ['แถวตารางงวด', created.schedules, exp.schedules],
    ['งวด', created.payments, exp.payments],
    ['สลิป', created.evidences, exp.evidences],
    ['เอกสาร', created.documents, exp.documents],
    ['รายการบัญชี', created.journalEntries, exp.opening + exp.marker + exp.catchUp],
    ['ผลผูกลูกค้า', report.customers.length, created.contracts],
  ];
  for (const [label, reported, want] of totalChecks) {
    if (reported !== want) fail('report', `รายงานตัวเขียน ${label} ${reported} ≠ แผน ${want}`);
  }
  for (const je of report.journalEntries) {
    const flow = ownFlowById.get(je.id);
    if (flow === undefined) fail(je.code, `รายการ ${je.entryNumber} ในรายงานตัวเขียนไม่อยู่ในฐาน`);
    else if (flow !== kindFlow[je.kind]) {
      fail(je.code, `รายการ ${je.entryNumber} (${je.kind}) flow ในฐาน ${flow ?? '-'}`);
    }
  }

  // ลูกค้า: หนึ่งสมาชิก = หนึ่งลูกค้า · ลูกค้าคนเดียวถือหลายสมาชิก = รายงาน (ผูกด้วยเลขบัตร/override)
  const customersOfMember = new Map<string, Set<string>>();
  const membersOfCustomer = new Map<string, Set<string>>();
  for (const item of items) {
    const row = imported.byCode.get(item.code);
    if (!row) continue;
    const c = customersOfMember.get(item.memberCode) ?? new Set<string>();
    c.add(row.customerId);
    customersOfMember.set(item.memberCode, c);
    const m = membersOfCustomer.get(row.customerId) ?? new Set<string>();
    m.add(item.memberCode);
    membersOfCustomer.set(row.customerId, m);
  }
  for (const item of items) {
    if ((customersOfMember.get(item.memberCode)?.size ?? 0) > 1) {
      fail(item.code, 'สมาชิกระบบเก่าคนเดียวผูกลูกค้ามากกว่าหนึ่งคน');
    }
  }
  const shared = [...membersOfCustomer.values()].filter((s) => s.size > 1).length;

  const statusText = Object.entries(byStatus)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([s, n]) => `${s} ${n}`)
    .join(' · ');
  return {
    detail:
      `แผน ${items.length} สัญญา (ผ่อนอยู่ ${active.length} · ประวัติ ${items.length - active.length}) · ` +
      `ข้าม ${t.contracts.skipped} · ตัวบล็อก ${plan.blockers.length}` +
      (ctx.opts.bookContracts === undefined ? '' : ` · dump ${ctx.opts.bookContracts}`) +
      ` · สร้าง ${created.contracts} · มีอยู่แล้ว ${report.skippedExisting.length} · สถานะในฐาน ${statusText || '-'}` +
      ` · ตารางงวด ${exp.schedules} · งวด ${exp.payments} · สลิป ${exp.evidences} · เอกสาร ${exp.documents}` +
      ` (ไฟล์ไม่ได้อัปโหลด ${exp.missingFiles})` +
      ` · รายการบัญชี: ยกมา ${exp.opening} · marker ${exp.marker} · ไล่ VAT ${exp.catchUp}` +
      ` · ลูกค้า ${membersOfCustomer.size} จากสมาชิก ${customersOfMember.size}` +
      ` (สร้างใหม่ ${created.customers} · ลูกค้าที่ถือหลายสมาชิก ${shared})`,
    failures,
  };
}

/** Σ(amountDue − amountPaid) ต่อสัญญาจากแถว Payment ที่ไม่ถูกลบ */
async function outstandingByContract(
  tx: Prisma.TransactionClient,
  ids: readonly string[],
): Promise<Map<string, Decimal>> {
  const groups = await tx.payment.groupBy({
    by: ['contractId'],
    where: { contractId: { in: [...ids] }, deletedAt: null },
    _sum: { amountDue: true, amountPaid: true },
  });
  return new Map(
    groups.map((g) => [g.contractId, (g._sum.amountDue ?? ZERO).minus(g._sum.amountPaid ?? ZERO)]),
  );
}

async function gate62(ctx: Ctx): Promise<GateBody> {
  const failures: GateFailure[] = [];
  const imported = await ctx.imported();
  const active = ctx.plan.items.filter((i) => i.kind === 'ACTIVE');
  const outstanding = await outstandingByContract(
    ctx.tx,
    active.flatMap((i) => imported.byCode.get(i.code)?.id ?? []),
  );
  let total = ZERO;
  let remain = ZERO;
  let adjustment = ZERO;
  let adjusted = 0;
  let satang = ZERO;
  let satangContracts = 0;
  for (const item of active) {
    const row = imported.byCode.get(item.code);
    if (!item.peak) {
      failures.push({ code: item.code, detail: 'แผนไม่มีคู่ใบแจ้งหนี้ PEAK' });
      continue;
    }
    if (!row) {
      failures.push({ code: item.code, detail: 'ไม่พบสัญญาในฐาน' });
      continue;
    }
    const due = outstanding.get(row.id) ?? ZERO;
    total = total.plus(due);
    remain = remain.plus(item.peak.remain);
    adjustment = adjustment.plus(item.peak.adjustment);
    if (!item.peak.adjustment.isZero()) adjusted++;
    satang = satang.plus(item.peak.satangGap);
    if (item.peak.satangGap.gt(0)) satangContracts++;
    if (!due.eq(item.peak.remain)) {
      failures.push({
        code: item.code,
        detail: `ยอดค้างตามงวด ${money(due)} ≠ คงเหลือใบแจ้งหนี้ PEAK ${item.peak.invoiceCode} ${money(
          item.peak.remain,
        )} (BESTCHOICE − PEAK ${money(due.minus(item.peak.remain))})`,
      });
    }
  }
  return {
    detail:
      `สัญญาผ่อนอยู่ ${active.length} · ยอดค้างตามงวดรวม ${money(total)} · คงเหลือ PEAK รวม ${money(remain)}` +
      ` · ต่างกับระบบเก่า (รายงานอย่างเดียว): ปรับลดตาม PEAK ${money(adjustment)} (${adjusted} สัญญา)` +
      ` · เศษสตางค์ PEAK บวกเข้างวดสุดท้าย ${money(satang)} (${satangContracts} สัญญา)` +
      ` · สัญญาประวัติไม่ตรวจ ${ctx.plan.items.length - active.length}`,
    failures,
  };
}

async function gate63(ctx: Ctx): Promise<GateBody> {
  const imported = await ctx.imported();
  const failures: GateFailure[] = [];
  let allowed = 0;
  for (const entry of await ctx.entries()) {
    if (!isOnOrBefore(entry, ctx.cutoff)) continue;
    const flow = metaString(entry.metadata, 'flow');
    if (flow && PEAK_EXCLUDED_IMPORT_FLOWS.has(flow)) {
      allowed++;
      continue;
    }
    failures.push({
      code: imported.codeOf.get(entry.contractId) ?? '?',
      detail: `${entryLabel(entry)} ลงถึงวันตัดแต่ไม่ใช่รายการยกมา / marker`,
    });
  }
  return {
    detail: `รายการของสัญญาที่นำเข้าที่ลงถึงวันตัด ${bangkokDateString(ctx.cutoff)} (รวมวันตัด) ${allowed + failures.length} · เป็นรายการยกมา + marker ${allowed}`,
    failures,
  };
}

async function gate64(ctx: Ctx): Promise<GateBody> {
  const failures: GateFailure[] = [];
  const imported = await ctx.imported();
  const gl = glByContract(await ctx.entries());
  const outstanding = await outstandingByContract(ctx.tx, imported.ids);
  const totals = new Map<string, Decimal>(CARRY_FORWARD_ACCOUNTS.map((a) => [a, ZERO]));
  let rounding = ZERO;
  let roundingContracts = 0;
  let satang = ZERO;
  let satangContracts = 0;
  for (const item of ctx.plan.items) {
    const row = imported.byCode.get(item.code);
    if (!row) {
      failures.push({ code: item.code, detail: 'ไม่พบสัญญาในฐาน' });
      continue;
    }
    const ledger = gl.get(row.id) ?? new Map<string, Decimal>();
    const at = (account: string) => ledger.get(account) ?? ZERO;
    for (const account of CARRY_FORWARD_ACCOUNTS) {
      totals.set(account, (totals.get(account) as Decimal).plus(at(account)));
    }
    if (item.kind !== 'ACTIVE') {
      for (const account of CARRY_FORWARD_ACCOUNTS) {
        if (!at(account).isZero()) {
          failures.push({
            code: item.code,
            detail: `สัญญาประวัติมียอด ${account} ใน GL ${money(at(account))}`,
          });
        }
      }
      continue;
    }
    if (!item.opening) {
      failures.push({ code: item.code, detail: 'แผนไม่มีรายการยกมาของสัญญาผ่อนอยู่' });
      continue;
    }
    rounding = rounding.plus(item.roundingDiff);
    if (!item.roundingDiff.isZero()) roundingContracts++;
    if (item.peak?.satangGap.gt(0)) {
      satang = satang.plus(item.peak.satangGap);
      satangContracts++;
    }
    // ยกมา + marker (Cr 11-2103) + ไล่ VAT (Dr 21-2102) — ลงในธุรกรรมเดียวกันทั้งหมด
    const expected = new Map<string, Decimal>();
    const add = (account: string, net: Decimal) =>
      expected.set(account, (expected.get(account) ?? ZERO).plus(net));
    for (const line of item.opening.openingLines) add(line.accountCode, line.dr.minus(line.cr));
    for (const marker of item.opening.priorReceiptMarkers) add('11-2103', marker.amount.negated());
    for (const line of item.opening.catchUpLines) add(line.accountCode, line.dr.minus(line.cr));
    for (const account of CARRY_FORWARD_ACCOUNTS) {
      const want = expected.get(account) ?? ZERO;
      if (!at(account).eq(want)) {
        failures.push({
          code: item.code,
          detail: `${account} ใน GL ${money(at(account))} ≠ ยกมา (หลัง marker / ไล่ VAT) ${money(want)} (Dr − Cr)`,
        });
      }
    }
    // ลูกหนี้ใน GL = ยอดค้างตามแถวงวด + เศษปัด (บัญชี − ยอดเรียกเก็บ)
    const receivable = sumOf(RECEIVABLE_ACCOUNTS.map(at));
    const register = outstanding.get(row.id) ?? ZERO;
    if (!receivable.eq(register.plus(item.roundingDiff))) {
      failures.push({
        code: item.code,
        detail: `ลูกหนี้ใน GL (11-2101 + 11-2103 + 11-2105) ${money(receivable)} ≠ ยอดค้างตามงวด ${money(
          register,
        )} + เศษปัด ${money(item.roundingDiff)}`,
      });
    }
  }
  const glText = CARRY_FORWARD_ACCOUNTS.map((a) => `${a} ${money(totals.get(a) as Decimal)}`).join(
    ' · ',
  );
  return {
    detail:
      `GL ของสัญญาที่นำเข้า (Dr − Cr): ${glText}` +
      ` · เศษปัดบัญชี − PEAK รวม ${money(rounding)} (${roundingContracts} สัญญา — บวก: งวดสุดท้ายลง 52-1104 · ลบ: ลง 53-1503)` +
      ` · เศษสตางค์ PEAK บวกเข้างวดสุดท้าย ${money(satang)} (${satangContracts} สัญญา)`,
    failures,
  };
}

async function gate65(ctx: Ctx): Promise<GateBody> {
  const { tx } = ctx;
  const imported = await ctx.imported();
  // รอบ 2A ที่ทำงาน ณ วันตัดเลือก dueDate < เที่ยงคืนวันถัดไป (กรุงเทพ) — ครอบงวดที่ครบกำหนดถึงวันตัด
  const dueBefore = new Date(bangkokStartOfDay(ctx.cutoff).getTime() + DAY_MS);
  const contract = {
    status: { notIn: [...ACCRUAL_EXCLUDED_CONTRACT_STATUSES] },
    deletedAt: null,
  };
  const ids = imported.ids;
  const accrual = await tx.installmentSchedule.findMany({
    where: {
      contractId: { in: ids },
      dueDate: { lt: dueBefore },
      accrualJournalEntryId: null,
      deletedAt: null,
      contract,
    },
    select: { contractId: true, installmentNo: true },
    orderBy: [{ contractId: 'asc' }, { installmentNo: 'asc' }],
  });
  // รอบ VAT 60 วัน: เงื่อนไขเดียวกับ cron (ยังไม่ตั้งลูกหนี้งวดเลย · ไม่มีงวด PAID) — หน้าต่างวันที่กว้างเป็นทุกงวดที่ถึงวันตัด
  // (cron เลือก dueDate < วันนี้ − 60 วัน ⇒ งวดที่ไม่ถูกหยิบวันนี้แต่จะถูกหยิบภายหลังก็ไม่ผ่าน)
  const vatCandidates = await tx.installmentSchedule.findMany({
    where: {
      contractId: { in: ids },
      dueDate: { lt: dueBefore },
      vat60dayJournalEntryId: null,
      deletedAt: null,
      accrualJournalEntryId: null,
      accruedAmount: { lte: 0 },
      accruedVat: { lte: 0 },
      contract,
    },
    select: { contractId: true, installmentNo: true },
    orderBy: [{ contractId: 'asc' }, { installmentNo: 'asc' }],
  });
  const paid =
    vatCandidates.length === 0
      ? new Set<string>()
      : new Set(
          (
            await tx.payment.findMany({
              where: {
                contractId: { in: [...new Set(vatCandidates.map((c) => c.contractId))] },
                installmentNo: { in: [...new Set(vatCandidates.map((c) => c.installmentNo))] },
                status: 'PAID',
                deletedAt: null,
              },
              select: { contractId: true, installmentNo: true },
            })
          ).map((p) => `${p.contractId}:${p.installmentNo}`),
        );
  const vat60 = vatCandidates.filter((c) => !paid.has(`${c.contractId}:${c.installmentNo}`));
  // ตัวนำเข้าไม่เคยผูก VAT 60 วัน (คำตัดสิน C2) — ลิงก์ที่มี = ใบรับชำระถัดไปจะกลับ VAT ที่ไม่เคยลง
  const linked = await tx.installmentSchedule.findMany({
    where: { contractId: { in: ids }, vat60dayJournalEntryId: { not: null }, deletedAt: null },
    select: { contractId: true, installmentNo: true },
    orderBy: [{ contractId: 'asc' }, { installmentNo: 'asc' }],
  });
  const failures: GateFailure[] = [
    ...accrual.map((r) => ({
      code: imported.codeOf.get(r.contractId) ?? '?',
      detail: `งวด ${r.installmentNo}: รอบตั้งลูกหนี้งวด (2A) จะหยิบ — ครบกำหนดถึงวันตัดแต่ไม่มี accrualJournalEntryId`,
    })),
    ...vat60.map((r) => ({
      code: imported.codeOf.get(r.contractId) ?? '?',
      detail: `งวด ${r.installmentNo}: รอบภาษีขาย 60 วันจะหยิบ — ยังไม่ตั้งลูกหนี้งวดและยังไม่ชำระครบ`,
    })),
    ...linked.map((r) => ({
      code: imported.codeOf.get(r.contractId) ?? '?',
      detail: `งวด ${r.installmentNo}: มี vat60dayJournalEntryId (ตัวนำเข้าห้ามผูก)`,
    })),
  ];
  return {
    detail:
      `งวดที่ครบกำหนดก่อน ${bangkokDateString(dueBefore)} (กรุงเทพ) ของ ${ids.length} สัญญา: ` +
      `รอบ 2A จะหยิบ ${accrual.length} · รอบภาษีขาย 60 วันจะหยิบ ${vat60.length} · ผูก VAT 60 วันอยู่ ${linked.length}`,
    failures,
  };
}

async function gate66(ctx: Ctx): Promise<GateBody> {
  const imported = await ctx.imported();
  const failures: GateFailure[] = [];
  const fail = (entry: ContractEntry, detail: string) =>
    failures.push({
      code: imported.codeOf.get(entry.contractId) ?? '?',
      detail: `${entryLabel(entry)} ${detail}`,
    });
  let pre = 0;
  let catchUp = 0;
  for (const entry of await ctx.entries()) {
    const flow = metaString(entry.metadata, 'flow');
    const excluded = isExcludedFromPeakExport(entry, entry.original);
    if (flow === LEGACY_VAT_CATCHUP_FLOW) {
      catchUp++;
      if (excluded) fail(entry, 'รายการไล่ VAT ถูกตัวกรองไฟล์ส่งออกตัด — ต้องเข้า PEAK');
      if (entry.peakSyncedAt) fail(entry, 'รายการไล่ VAT มี peakSyncedAt — ต้องเข้า PEAK');
      if (isOnOrBefore(entry, ctx.cutoff)) fail(entry, 'รายการไล่ VAT ต้องลงหลังวันตัด');
      continue;
    }
    if (isOnOrBefore(entry, ctx.cutoff)) {
      pre++;
      if (!excluded) fail(entry, 'ลงถึงวันตัดแต่ตัวกรองไฟล์ส่งออกไม่ตัด — จะเข้า PEAK ซ้ำ');
      if (!entry.peakSyncedAt) fail(entry, 'ลงถึงวันตัดแต่ไม่มี peakSyncedAt');
    } else if (flow && PEAK_EXCLUDED_IMPORT_FLOWS.has(flow) && !entry.peakSyncedAt) {
      fail(entry, 'รายการยกมา / marker ไม่มี peakSyncedAt');
    }
  }
  return {
    detail:
      `รายการของสัญญาที่นำเข้าที่ลงถึงวันตัด ${pre} (ต้องถูกตัดออกจากไฟล์ส่งออกและมี peakSyncedAt ทุกรายการ)` +
      ` · รายการไล่ VAT ${catchUp} (ต้องเข้า PEAK) · ไฟล์ส่งออกจริงตรวจตอนซ้อมหลัง commit`,
    failures,
  };
}

async function gate67(ctx: Ctx): Promise<GateBody> {
  const imported = await ctx.imported();
  const failures: GateFailure[] = [];
  for (const entry of await ctx.entries()) {
    for (const line of liveLines(entry)) {
      if (!SHOP_PAYABLE_ACCOUNTS.has(line.accountCode)) continue;
      failures.push({
        code: imported.codeOf.get(entry.contractId) ?? '?',
        detail: `${entryLabel(entry)} มีบรรทัด ${line.accountCode} — สัญญาจะเข้าคิวรอจ่ายร้าน`,
      });
    }
  }
  return {
    detail: `บรรทัด 21-1101 / 21-1102 ของ ${imported.ids.length} สัญญาที่นำเข้า ${failures.length}`,
    failures,
  };
}

async function gate69(ctx: Ctx): Promise<GateBody> {
  const imported = await ctx.imported();
  const failures: GateFailure[] = [];
  let active = 0;
  let historyWithout = 0;
  for (const item of ctx.plan.items) {
    const row = imported.byCode.get(item.code);
    const code = row?.customer?.contact?.peakContactCode?.trim() ?? '';
    if (item.kind !== 'ACTIVE') {
      if (!code) historyWithout++;
      continue;
    }
    active++;
    if (!row) failures.push({ code: item.code, detail: 'ไม่พบสัญญาในฐาน' });
    else if (!code) failures.push({ code: item.code, detail: 'ลูกค้าไม่มีรหัสผู้ติดต่อ PEAK' });
    else if (!item.peak) failures.push({ code: item.code, detail: 'แผนไม่มีคู่ใบแจ้งหนี้ PEAK' });
    else if (code !== item.peak.contactCode) {
      failures.push({
        code: item.code,
        detail: `รหัสผู้ติดต่อ PEAK ของลูกค้า ≠ ผู้ติดต่อของใบแจ้งหนี้ ${item.peak.invoiceCode}`,
      });
    }
  }
  return {
    detail: `สัญญาผ่อนอยู่ ${active} · สัญญาประวัติที่ลูกค้าไม่มีรหัส PEAK ${historyWithout} (รายงานอย่างเดียว)`,
    failures,
  };
}

async function gate610(ctx: Ctx): Promise<GateBody> {
  const imported = await ctx.imported();
  const failures: GateFailure[] = [];
  const contractById = new Map([...imported.byCode.values()].map((r) => [r.id, r]));
  let lines = 0;
  let byEntry = 0;
  let byLine = 0;
  for (const entry of await ctx.entries()) {
    const wholeEntry = isExcludedFromPeakExport(entry, entry.original);
    const contractId = peakExportContractId(entry, entry.original);
    const contract = contractId ? contractById.get(contractId) : undefined;
    for (const line of liveLines(entry)) {
      if (!isLegacyInterestAccount(line.accountCode)) continue;
      lines++;
      if (wholeEntry) byEntry++;
      else if (isExcludedLegacyInterestLine(line, contract ?? null)) byLine++;
      else {
        failures.push({
          code: imported.codeOf.get(entry.contractId) ?? '?',
          detail: `${entryLabel(entry)} บรรทัด ${line.accountCode} จะถูกส่งเข้า PEAK`,
        });
      }
    }
  }
  let interest = ZERO;
  let active = 0;
  for (const item of ctx.plan.items) {
    const row = imported.byCode.get(item.code);
    if (!row) {
      failures.push({ code: item.code, detail: 'ไม่พบสัญญาในฐาน' });
      continue;
    }
    if (item.kind === 'ACTIVE') active++;
    interest = interest.plus(item.money.interestTotal);
    if (!row.legacyContractCode?.trim()) {
      failures.push({
        code: item.code,
        detail: 'legacyContractCode ว่าง — ดอกเบี้ยของสัญญานี้จะหลุดเข้า PEAK',
      });
    }
    if (!row.interestTotal.eq(item.money.interestTotal)) {
      failures.push({
        code: item.code,
        detail: `interestTotal ${money(row.interestTotal)} ≠ ดอกเบี้ยตามสัญญาเดิม ${money(item.money.interestTotal)}`,
      });
    }
  }
  return {
    detail:
      `บรรทัด 11-2106 / 41-1101 ของสัญญาที่นำเข้า ${lines} (ตัดทั้งรายการ ${byEntry} · ตัดเป็นบรรทัดดอกเบี้ย ${byLine})` +
      ` · ดอกเบี้ยตามสัญญาเดิมรวม ${money(interest)}` +
      ` · ข้อจำกัดที่รู้ (ไม่ใช่เงื่อนไขผ่าน): สัญญาผ่อนอยู่ ${active} สัญญา — ถ้าเปลี่ยนเครื่อง รายการปิดสัญญาเดิม` +
      ` (Dr 11-2106 ไม่มีคู่ 41-1101) ส่งออก PEAK ไม่ดุล รอสำนักงานบัญชี`,
    failures,
  };
}

const GATES: Record<GateId, (ctx: Ctx) => Promise<GateBody>> = {
  '6.1': gate61,
  '6.2': gate62,
  '6.3': gate63,
  '6.4': gate64,
  '6.5': gate65,
  '6.6': gate66,
  '6.7': gate67,
  '6.9': gate69,
  '6.10': gate610,
};

/**
 * รันทุกด่าน (ตามลำดับ `GATE_IDS`) ใน `tx` ของการนำเข้า — ดูหัวไฟล์ · คืนผลทุกด่านเสมอ (ไม่ throw)
 * @param cutoff วันตัด (2026-11-30 23:59:59 กรุงเทพ — ค่าเดียวกับ `plan.cutoff`)
 */
export async function runGates(
  tx: Prisma.TransactionClient,
  plan: ImportPlan,
  report: WriteReport,
  cutoff: Date,
  opts: GateOptions = {},
): Promise<GateResult[]> {
  const imported = once(() => loadImported(tx, plan, report));
  const ctx: Ctx = {
    tx,
    plan,
    report,
    cutoff,
    opts,
    imported,
    entries: once(async () => loadContractEntries(tx, (await imported()).ids)),
  };
  let savepoints = true;
  const results: GateResult[] = [];
  for (const id of GATE_IDS) {
    const name = `legacy_gate_${id.replace('.', '_')}`;
    let inSavepoint = false;
    if (savepoints) {
      try {
        await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
        inSavepoint = true;
      } catch {
        savepoints = false; // ไม่ใช่ธุรกรรม — แต่ละคำสั่ง commit เอง error ไม่ลามไปด่านถัดไป
      }
    }
    try {
      results.push(result(id, await GATES[id](ctx)));
      if (inSavepoint) await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
    } catch (error) {
      if (inSavepoint) {
        try {
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
        } catch {
          // ธุรกรรมใช้ต่อไม่ได้ — ด่านถัดไปจะรายงาน error ของตัวเอง
        }
      }
      results.push({
        id,
        pass: false,
        detail: `ตรวจไม่สำเร็จ (${errorLabel(error)}) — ถือว่าไม่ผ่าน`,
      });
    }
  }
  return results;
}

// ── 6.8 สุ่มเทียบด้วยตา ───────────────────────────────────────────────────────────────────────────

/** ชั้นของการสุ่ม (สเปก 6.8) — ลำดับ = ลำดับที่เลือก */
const SAMPLE_STRATA: ReadonlyArray<(item: PlannedContract) => boolean> = [
  (i) => i.kind === 'ACTIVE' && i.status === 'OVERDUE',
  (i) => i.kind === 'HISTORY' && i.status === 'EARLY_PAYOFF',
  (i) => i.kind === 'HISTORY' && CANCELED_STATUSES.has(i.status),
  (i) => i.oldForm,
];

/**
 * เลขสัญญาเดิม `n` สัญญาให้คนเทียบกับ PEAK / หน้าจอระบบเก่าทีละช่องในคืนตัด (สเปก 6.8) — ครอบทุกชั้น: ค้างชำระ ·
 * ปิดก่อนกำหนด · ยกเลิก/หนี้เสีย · ฉบับเก่า (แต่ละชั้นได้ `max(1, ⌊n/5⌋)` สัญญาเท่าที่มี) แล้วสุ่มส่วนที่เหลือจากทุกสัญญา ·
 * ผลเดิมทุกครั้งสำหรับแผนและ `seed` เดียวกัน (ไม่ส่ง = ผูกกับวันตัดของแผน)
 */
export function sampleForManualCheck(plan: ImportPlan, n = 20, seed?: string): string[] {
  if (n <= 0) return [];
  const order = seededShuffle(plan.items, seed ?? `legacy-sample:${plan.cutoff.toISOString()}`);
  const quota = Math.max(1, Math.floor(n / (SAMPLE_STRATA.length + 1)));
  const chosen = new Set<PlannedContract>();
  for (const inStratum of SAMPLE_STRATA) {
    let taken = 0;
    for (const item of order) {
      if (chosen.size >= n || taken >= quota) break;
      if (!chosen.has(item) && inStratum(item)) {
        chosen.add(item);
        taken++;
      }
    }
  }
  for (const item of order) {
    if (chosen.size >= n) break;
    chosen.add(item);
  }
  return [...chosen].map((i) => i.code);
}
