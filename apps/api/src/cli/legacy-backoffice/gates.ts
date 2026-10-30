import { Prisma } from '@prisma/client';
import type { JournalEntryStatus } from '@prisma/client';
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
import { legacyOpeningReference } from '../../modules/journal/legacy-import-journal';
import {
  accrual2AInputOf,
  accruedSoFarOf,
  buildRemainderAccrual2ALines,
} from '../../modules/journal/build-accrual-2a-lines';
import { bangkokDateString, bangkokStartOfDay } from '../../utils/date.util';
import { seededShuffle } from '../../utils/shuffle.util';
import { formatMoney } from './csv';
import { CARRY_FORWARD_ACCOUNTS, OPENING_EQUITY_ACCOUNT } from './opening';
import type { ImportPlan, PlannedContract } from './plan-import';
import type { WriteReport } from './writer';

/**
 * ด่านตรวจก่อนเปิดใช้ (Task 12 · สเปก §6) — รันใน**ธุรกรรมนำเข้าเดียวกับตัวเขียน** (`writeLegacyImport`) ก่อน commit ·
 * อ่านทุกอย่างผ่าน `tx` (แถวที่ยังไม่ commit มองเห็นเฉพาะใน `tx`) · ไม่เขียนอะไรเลย · ผู้เรียก (Task 13) rollback เมื่อด่านใดไม่ผ่าน
 *
 * | ด่าน | ผ่านเมื่อ |
 * |---|---|
 * | 6.1 | `cutoff` = `plan.cutoff` · แผน (`plan.totals` = ผลรวมรายสัญญา · ไม่มีตัวบล็อก · ครบจำนวนสัญญาใน dump ถ้าส่ง `bookContracts`) = รายงานตัวเขียน = ฐาน **ต่อสัญญาที่นำเข้า**: สัญญา (เลขเดิม / เลขสัญญา / สถานะ / ช่องเงินที่รอบ 2A อ่าน) · **งวดรายแถว** (`dueDate` / `amountDue` / `amountPaid` / `status` / รหัสงวดเดิม · ยอดแยกเมื่อแผนมี) · จำนวนแถวตารางงวด · สลิป / เอกสาร (หักไฟล์ที่ไม่ได้อัปโหลด — แผนเป็นตัวตั้งเมื่อแผนรู้ผลอัปโหลด) · รายการบัญชีตาม flow · ลูกค้า (หนึ่งสมาชิก = หนึ่งลูกค้า) · ต้นทางสิทธิ์ (`accessCompanyCode` / `accessBranchId`) ของลูกค้า `CREATED` รอบนี้ — และ Contact ที่สร้างให้ (`contactCreated`) — = `report.customerOrigin` (แก้ภายหลังไม่ได้ — trigger `immutable_party_access_origin`) |
 * | 6.2 | สัญญาผ่อนอยู่ทุกสัญญา: Σ(`amountDue − amountPaid`) ของ Payment = ยอดคงเหลือใบแจ้งหนี้ PEAK (`plan.items[].peak.remain`) ตรงทุกสตางค์ — ส่วนต่างกับระบบเก่า (ปรับลดตาม PEAK / เศษสตางค์) และงวดที่ยังไม่ PAID ของสัญญาประวัติ รายงานอย่างเดียว |
 * | 6.3 | ไม่มีรายการบัญชีของสัญญาที่นำเข้าลงวันที่ถึงวันตัด (`entryDate` หรือ `postedAt` ≤ วันตัด) นอกจาก flow `legacy-opening` / `legacy-prior-receipt` |
 * | 6.4 | ต่อสัญญา (GL ความหมายเดียวกับ `glContractBalance`): `CARRY_FORWARD_ACCOUNTS` = บรรทัดรายการยกมาของ `computeOpening` + marker + รายการไล่ VAT · ลูกหนี้ใน GL (11-2101 + 11-2103 + 11-2105) = ยอดค้างตามแถวงวด + `roundingDiff` · **GL 11-2101 / 11-2105 / 11-2106 / 21-2102 + Σ บรรทัด 2A ที่รอบกลางคืนจะลงให้ทุกแถวที่ยังไม่ตั้งครบ (`buildRemainderAccrual2ALines(accrual2AInputOf(สัญญาในฐาน), accruedSoFarOf(แถว))`) = 0** · **marker ทุกรายการชี้แถวงวดของ (สัญญา, งวด) ที่แผนมี marker และ Cr 11-2103 = Dr 32-1101 = ยอด marker ในแผน = `amountPaid` ของงวดนั้น** · สัญญาประวัติไม่มียอด · รายงาน Σ `roundingDiff` / เศษสตางค์ PEAK |
 * | 6.5 | เงื่อนไขเดียวกับรอบตั้งลูกหนี้งวด 2A (`installment-accrual.cron.ts`) จำกัดเฉพาะสัญญาที่นำเข้า ไม่เจองวดที่ครบกำหนดถึงวันตัด (รอบภาษีขาย 60 วันเป็นเซตย่อยของเงื่อนไขนี้) · **แถวตารางงวดรายแถว** = แผน (`dueDate` / `amountDue` / `principal` / `interest`) · `accrualJournalEntryId` = เลขที่รายการยกมา **เมื่อและเฉพาะเมื่อ** stamp `accrued` · `accrued*` = stamp · ไม่มี `vat60dayJournalEntryId` |
 * | 6.6 | ทุกรายการของสัญญาที่นำเข้าที่ลงวันที่ถึงวันตัด `isExcludedFromPeakExport(entry, original)` และมี `peakSyncedAt` · รายการยกมา / marker มี `peakSyncedAt` เสมอ · รายการไล่ VAT ลงหลังวันตัด **ไม่**ถูกตัดและไม่มี `peakSyncedAt` (ต้องเข้า PEAK) — ห้ามเรียก `exportJournalWithPeakCodes` ในธุรกรรม (อ่านด้วย `this.prisma` จึงไม่เห็นแถวที่ยังไม่ commit) ไฟล์ส่งออกจริงตรวจตอนซ้อม (Task 14) |
 * | 6.7 | ไม่มีบรรทัด 21-1101 / 21-1102 ของสัญญาที่นำเข้า (คิวรอจ่ายร้านฝั่ง FINANCE อ่านจากสองบัญชีนี้) |
 * | 6.9 | สัญญาผ่อนอยู่ทุกสัญญา: `customer.contact.peakContactCode` ไม่ว่าง และ = รหัสผู้ติดต่อของใบแจ้งหนี้ PEAK ที่จับคู่ |
 * | 6.10 | ทุกบรรทัด 11-2106 / 41-1101 ของสัญญาที่นำเข้า: `isExcludedFromPeakExport(entry, original) \|\| isExcludedLegacyInterestLine(line, สัญญาจาก peakExportContractId)` (ตัวกรองชุดเดียวกับไฟล์ส่งออก CSV — การส่งผ่าน PEAK API ยังไม่กรอง) · ทุกสัญญาที่นำเข้ามี `legacyContractCode` · `interestTotal` = ดอกเบี้ยตามสัญญาเดิมในแผน · รายงานจำนวนสัญญาผ่อนอยู่ที่ถ้าเปลี่ยนเครื่อง รายการปิดสัญญาเดิมจะส่งออกไม่ดุล (รอสำนักงานบัญชี — ไม่ใช่เงื่อนไขผ่าน) |
 *
 * 6.8 (สุ่มเทียบด้วยตา) = `sampleForManualCheck` — คนเทียบกับ PEAK / หน้าจอระบบเก่าในคืนตัด
 *
 * **สัญญาที่นำเข้า** = id ใน `report.contractIds` (สร้างรอบนี้ — ยังเจอแม้ `legacyContractCode` ถูกล้าง) ∪ สัญญาที่
 * `legacyContractCode` อยู่ในแผน (`report.skippedExisting`) — ตรวจรายสัญญา / รายแถวเหมือนกันทั้งสองกลุ่ม ·
 * **รายการบัญชีของสัญญา** = รายการที่ไม่ถูกลบ (ทุกสถานะ) ที่ `peakExportContractId(entry, original)` ชี้สัญญาเหล่านั้น — รวม
 * รายการกลับ / กระจกที่สืบสัญญาจากรายการต้นฉบับ แบบเดียวกับไฟล์ส่งออก
 *
 * **วันตัด** = `plan.cutoff` เสมอ (พารามิเตอร์ `cutoff` ใช้ตรวจใน 6.1 ว่าผู้เรียกส่งค่าเดียวกัน)
 *
 * **6.4 ใช้ได้ ณ คืนตัดเท่านั้น** (GL ไม่กรองวันที่ เหมือน `glContractBalance`) — รันซ้ำหลังรอบกลางคืนลง 2A แล้ว (ซ้อม Task 14)
 * 6.4 จะไม่ผ่านเพราะ GL เดินต่อ
 *
 * **แยกกันทุกด่าน:** แต่ละด่านอยู่ใน SAVEPOINT ของตัวเอง — ด่านที่ throw (รวม error ของ Postgres ที่ทำให้ธุรกรรมใช้ต่อไม่ได้) =
 * `pass: false` พร้อมชื่อคลาส/รหัสของ error แล้ว rollback ถึง savepoint ด่านถัดไปยังรันได้ · `tx` ที่ไม่ใช่ธุรกรรม (SAVEPOINT ไม่ได้)
 * = รันต่อโดยไม่มี savepoint · ผลหนึ่งรายการต่อหนึ่งด่านเสมอ
 *
 * `detail` / `failures` มีแค่จำนวน ยอดเงิน วันที่ เลขสัญญาเดิม เลขงวด เลขที่รายการบัญชี รหัสบัญชี และเลขใบแจ้งหนี้ PEAK — ไม่มีชื่อ
 * เบอร์ เลขบัตร รหัสสมาชิก id ลูกค้า id สัญญา หรือรหัสผู้ติดต่อ PEAK
 */

type Decimal = Prisma.Decimal;

const ZERO = new Prisma.Decimal(0);
const DAY_MS = 86_400_000;
const RECEIVABLE_ACCOUNTS = ['11-2101', '11-2103', '11-2105'] as const;
/** บัญชีที่รอบ 2A ล้างจนเป็นศูนย์เมื่อทุกงวดตั้งลูกหนี้ครบ */
const ACCRUAL_RUNOFF_ACCOUNTS = ['11-2101', '11-2105', '11-2106', '21-2102'] as const;
const SHOP_PAYABLE_ACCOUNTS: ReadonlySet<string> = new Set(['21-1101', '21-1102']);
const PEAK_EXCLUDED_IMPORT_FLOWS: ReadonlySet<string> = new Set([
  LEGACY_OPENING_FLOW,
  LEGACY_PRIOR_RECEIPT_FLOW,
]);

export const GATE_IDS = ['6.1', '6.2', '6.3', '6.4', '6.5', '6.6', '6.7', '6.9', '6.10'] as const;
export type GateId = (typeof GATE_IDS)[number];

/** `code` = เลขสัญญาเดิม (แถวของแผนที่ไม่ผูกสัญญา = รหัสในแผน / `plan` / `report`) */
export type GateFailure = { code: string; detail: string };
export type GateResult = { id: GateId; pass: boolean; detail: string; failures?: GateFailure[] };

export type GateOptions = {
  /** จำนวนสัญญาใน dump (`book.contracts.length`) — ส่งมา = 6.1 ตรวจว่าแผนนับครบ (นำเข้า + ข้าม + ตัวบล็อก) */
  bookContracts?: number;
  /**
   * `planImport` ได้ `files` (ผลอัปโหลด) — true = `item.missingAttachments` เป็นตัวตั้งของทุกสัญญา: ไฟล์ที่ตัวเขียนรายงานว่าหาย
   * ต้องตรงกับแผน และสลิป / เอกสารของสัญญาที่มีอยู่แล้วก็ตรวจจำนวนได้ · ไม่ส่ง = ใช้แผนเป็นตัวตั้งเมื่อแผนพบไฟล์หายอย่างน้อยหนึ่งไฟล์
   */
  planFiles?: boolean;
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
  financedAmount: true,
  storeCommission: true,
  interestTotal: true,
  vatAmount: true,
  totalMonths: true,
  monthlyPayment: true,
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

const SCHEDULE_SELECT = {
  id: true,
  contractId: true,
  installmentNo: true,
  dueDate: true,
  amountDue: true,
  principal: true,
  interest: true,
  accrualJournalEntryId: true,
  accruedAmount: true,
  accruedVat: true,
  accruedInterest: true,
  vat60dayJournalEntryId: true,
} satisfies Prisma.InstallmentScheduleSelect;
type ScheduleRow = Prisma.InstallmentScheduleGetPayload<{ select: typeof SCHEDULE_SELECT }>;

const PAYMENT_SELECT = {
  contractId: true,
  installmentNo: true,
  dueDate: true,
  amountDue: true,
  amountPaid: true,
  status: true,
  legacyInstallmentCode: true,
  monthlyPrincipal: true,
  monthlyInterest: true,
  monthlyCommission: true,
  vatAmount: true,
} satisfies Prisma.PaymentSelect;
type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

/** แถวที่ไม่ถูกลบของสัญญาที่นำเข้า จัดตาม id สัญญา (เรียงตามงวด) */
function byContract<T extends { contractId: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(row.contractId);
    if (list) list.push(row);
    else out.set(row.contractId, [row]);
  }
  return out;
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

/** `metadata.contractId` ของรายการเอง = สัญญาที่สืบได้ (ไม่ใช่กระจกที่สืบจากต้นฉบับ) */
const isOwnEntry = (entry: ContractEntry) =>
  metaString(entry.metadata, 'contractId') === entry.contractId;

/**
 * ยอด Dr − Cr ต่อสัญญาต่อบัญชี — ความหมายเดียวกับ `glContractBalance(…, 'dr')`: รายการ `POSTED` ที่ไม่ถูกลบ และ
 * `metadata.contractId` ของรายการเอง = สัญญา (ไม่สืบจากต้นฉบับ) · นับทุกบรรทัด (`glContractBalance` ไม่กรอง `deletedAt` ของบรรทัด)
 */
function glByContract(entries: readonly ContractEntry[]): Map<string, Map<string, Decimal>> {
  const out = new Map<string, Map<string, Decimal>>();
  for (const entry of entries) {
    if (entry.status !== ('POSTED' satisfies JournalEntryStatus)) continue;
    if (!isOwnEntry(entry)) continue;
    const accounts = out.get(entry.contractId) ?? new Map<string, Decimal>();
    out.set(entry.contractId, accounts);
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
const money = (value: Decimal | null | undefined) => (value == null ? 'ว่าง' : formatMoney(value));
const day = (value: Date | null | undefined) => (value ? bangkokDateString(value) : 'ว่าง');
const sameMoney = (a: Decimal | null | undefined, b: Decimal | null | undefined) =>
  a == null || b == null ? a == null && b == null : a.eq(b);
const isOnOrBefore = (entry: Pick<EntryRow, 'entryDate' | 'postedAt'>, cutoff: Date) =>
  entry.entryDate.getTime() <= cutoff.getTime() ||
  (entry.postedAt !== null && entry.postedAt.getTime() <= cutoff.getTime());
const liveLines = (entry: EntryRow) => entry.lines.filter((l) => l.deletedAt === null);
const entryLabel = (entry: EntryRow) =>
  `รายการ ${entry.entryNumber} (flow ${metaString(entry.metadata, 'flow') ?? '-'} · ลงวันที่ ${bangkokDateString(entry.entryDate)})`;
/** Σ(Dr − Cr) ของบรรทัดที่ยังไม่ถูกลบของบัญชีหนึ่งในรายการ */
const lineNet = (entry: EntryRow, account: string) =>
  sumOf(
    liveLines(entry)
      .filter((l) => l.accountCode === account)
      .map((l) => l.debit.minus(l.credit)),
  );

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

type GateBody = { detail: string; failures: GateFailure[] };

function result(id: GateId, body: GateBody): GateResult {
  return body.failures.length > 0
    ? { id, pass: false, detail: body.detail, failures: body.failures }
    : { id, pass: true, detail: body.detail };
}

/** ยอดแยกของงวดที่แผนของ Task 10 เพิ่ม (`PlannedPayment`) — แผนรุ่นก่อนไม่มี = ไม่ตรวจ */
type PlannedBreakdown = {
  monthlyPrincipal: Decimal;
  monthlyInterest: Decimal;
  monthlyCommission: Decimal;
  vatAmount: Decimal;
};
function plannedBreakdown(payment: object): PlannedBreakdown | null {
  const p = payment as Partial<Record<keyof PlannedBreakdown, unknown>>;
  return Prisma.Decimal.isDecimal(p.monthlyPrincipal) &&
    Prisma.Decimal.isDecimal(p.monthlyInterest) &&
    Prisma.Decimal.isDecimal(p.monthlyCommission) &&
    Prisma.Decimal.isDecimal(p.vatAmount)
    ? (p as PlannedBreakdown)
    : null;
}

// ── ด่าน ──────────────────────────────────────────────────────────────────────────────────────

type Ctx = {
  tx: Prisma.TransactionClient;
  plan: ImportPlan;
  report: WriteReport;
  /** = `plan.cutoff` */
  cutoff: Date;
  /** ค่าที่ผู้เรียกส่งมา — 6.1 ตรวจว่า = `plan.cutoff` */
  callerCutoff: Date;
  opts: GateOptions;
  imported: () => Promise<Imported>;
  entries: () => Promise<ContractEntry[]>;
  schedules: () => Promise<ScheduleRow[]>;
  payments: () => Promise<PaymentRow[]>;
};

async function gate61(ctx: Ctx): Promise<GateBody> {
  const { tx, plan, report } = ctx;
  const failures: GateFailure[] = [];
  const fail = (code: string, detail: string) => failures.push({ code, detail });
  const items = plan.items;
  const active = items.filter((i) => i.kind === 'ACTIVE');
  const t = plan.totals;

  if (ctx.callerCutoff.getTime() !== plan.cutoff.getTime()) {
    fail(
      'plan',
      `วันตัดที่ส่งมา ${ctx.callerCutoff.toISOString()} ≠ วันตัดของแผน ${plan.cutoff.toISOString()} — ด่านใช้วันตัดของแผน`,
    );
  }

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

  const imported = await ctx.imported();
  const ids = imported.ids;
  const where = { contractId: { in: ids }, deletedAt: null };
  const schedules = byContract(await ctx.schedules());
  const payments = byContract(await ctx.payments());
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
    if (flow && isOwnEntry(e)) {
      const key = flowKey(e.contractId, flow);
      flowCount.set(key, (flowCount.get(key) ?? 0) + 1);
    }
  }
  const writerMissing = new Map(report.missingAttachments.map((m) => [m.code, new Set(m.paths)]));
  const planKnowsFiles = ctx.opts.planFiles === true || t.missingAttachments > 0;
  const customerByCode = new Map(report.customers.map((c) => [c.code, c]));
  const kindFlow = {
    opening: LEGACY_OPENING_FLOW,
    marker: LEGACY_PRIOR_RECEIPT_FLOW,
    'catch-up': LEGACY_VAT_CATCHUP_FLOW,
  } as const;

  const byStatus: Record<string, number> = {};
  const exp = {
    schedules: 0,
    payments: 0,
    evidences: 0,
    documents: 0,
    opening: 0,
    marker: 0,
    catchUp: 0,
    missingFiles: 0,
    attachmentsUnchecked: 0,
  };
  for (const item of items) {
    const row = imported.byCode.get(item.code);
    if (!row) {
      fail(item.code, 'ไม่พบสัญญาในฐาน');
      continue;
    }
    const id = row.id;
    const isCreated = report.contractIds.has(item.code);
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;

    // สัญญา — รวมช่องเงินที่รอบ 2A / ใบรับชำระอ่าน (`accrual2AInputOf`)
    if (row.deletedAt) fail(item.code, 'สัญญาถูกลบ (deletedAt)');
    if (row.legacyContractCode !== item.code) fail(item.code, 'legacyContractCode ≠ เลขสัญญาเดิม');
    if (row.contractNumber !== item.code) fail(item.code, 'เลขสัญญา ≠ เลขสัญญาเดิม');
    if (row.status !== item.status) fail(item.code, `สถานะ ${row.status} ≠ แผน ${item.status}`);
    const m = item.money;
    const moneyChecks: Array<[string, Decimal | null, Decimal]> = [
      ['financedAmount', row.financedAmount, m.financedAmount],
      ['storeCommission', row.storeCommission, m.storeCommission],
      ['interestTotal', row.interestTotal, m.interestTotal],
      ['vatAmount', row.vatAmount, m.vatAmount],
      ['monthlyPayment', row.monthlyPayment, m.monthlyPayment],
    ];
    for (const [field, db, want] of moneyChecks) {
      if (!sameMoney(db, want)) fail(item.code, `${field} ในฐาน ${money(db)} ≠ แผน ${money(want)}`);
    }
    if (row.totalMonths !== m.totalMonths) {
      fail(item.code, `totalMonths ในฐาน ${row.totalMonths} ≠ แผน ${m.totalMonths}`);
    }

    // งวดรายแถว
    const dbPayments = new Map((payments.get(id) ?? []).map((p) => [p.installmentNo, p]));
    for (const p of item.payments) {
      const dbRow = dbPayments.get(p.installmentNo);
      dbPayments.delete(p.installmentNo);
      const at = `งวด ${p.installmentNo}`;
      if (!dbRow) {
        fail(item.code, `${at}: ไม่มีแถว Payment`);
        continue;
      }
      if (dbRow.dueDate.getTime() !== p.dueDate.getTime()) {
        fail(item.code, `${at}: dueDate ในฐาน ${day(dbRow.dueDate)} ≠ แผน ${day(p.dueDate)}`);
      }
      if (!dbRow.amountDue.eq(p.amountDue)) {
        fail(
          item.code,
          `${at}: amountDue ในฐาน ${money(dbRow.amountDue)} ≠ แผน ${money(p.amountDue)}`,
        );
      }
      if (!dbRow.amountPaid.eq(p.amountPaid)) {
        fail(
          item.code,
          `${at}: amountPaid ในฐาน ${money(dbRow.amountPaid)} ≠ แผน ${money(p.amountPaid)}`,
        );
      }
      if (dbRow.status !== p.status) {
        fail(item.code, `${at}: status ในฐาน ${dbRow.status} ≠ แผน ${p.status}`);
      }
      if (dbRow.legacyInstallmentCode !== p.legacyInstallmentCode) {
        fail(item.code, `${at}: รหัสงวดเดิมในฐานไม่ตรงแผน`);
      }
      const breakdown = plannedBreakdown(p);
      if (breakdown) {
        const parts: Array<[string, Decimal | null, Decimal]> = [
          ['monthlyPrincipal', dbRow.monthlyPrincipal, breakdown.monthlyPrincipal],
          ['monthlyInterest', dbRow.monthlyInterest, breakdown.monthlyInterest],
          ['monthlyCommission', dbRow.monthlyCommission, breakdown.monthlyCommission],
          ['vatAmount', dbRow.vatAmount, breakdown.vatAmount],
        ];
        for (const [field, db, want] of parts) {
          if (!sameMoney(db, want)) {
            fail(item.code, `${at}: ${field} ในฐาน ${money(db)} ≠ แผน ${money(want)}`);
          }
        }
        const sum = parts.every(([, db]) => db != null)
          ? sumOf(parts.map(([, db]) => db as Decimal))
          : null;
        if (!sum || !sum.eq(dbRow.amountDue)) {
          fail(
            item.code,
            `${at}: ยอดแยก (ต้น + ดอก + ค่าคอม + VAT) ${money(sum)} ≠ amountDue ${money(dbRow.amountDue)}`,
          );
        }
      }
    }
    for (const extra of dbPayments.keys())
      fail(item.code, `งวด ${extra}: แถว Payment ไม่อยู่ในแผน`);

    // จำนวนแถวตารางงวด (ค่าในแถว — 6.5)
    const scheduleCount = schedules.get(id)?.length ?? 0;
    if (scheduleCount !== item.schedule.length) {
      fail(item.code, `แถวตารางงวดในฐาน ${scheduleCount} ≠ แผน ${item.schedule.length}`);
    }

    // สลิป / เอกสาร — ไฟล์ที่ไม่ได้อัปโหลด = ไม่มีแถว · แผนเป็นตัวตั้งเมื่อแผนรู้ผลอัปโหลด
    const planMissing = new Set(item.missingAttachments);
    const written = writerMissing.get(item.code) ?? new Set<string>();
    if (
      planKnowsFiles &&
      isCreated &&
      (written.size !== planMissing.size || [...written].some((p) => !planMissing.has(p)))
    ) {
      fail(
        item.code,
        `ไฟล์ที่ตัวเขียนไม่ได้สร้างแถว ${written.size} ไฟล์ ≠ ไฟล์ที่แผนพบว่าหาย ${planMissing.size} ไฟล์`,
      );
    }
    const missing: Set<string> | null = planKnowsFiles ? planMissing : isCreated ? written : null;
    const opening = item.opening && item.opening.openingLines.length > 0 ? 1 : 0;
    const markers = item.opening?.priorReceiptMarkers.length ?? 0;
    const catchUp = item.opening && item.opening.catchUpLines.length > 0 ? 1 : 0;
    exp.schedules += item.schedule.length;
    exp.payments += item.payments.length;
    exp.opening += opening;
    exp.marker += markers;
    exp.catchUp += catchUp;
    if (missing) {
      const ev = item.evidences.filter((e) => !missing.has(e.slipPath));
      const docs = item.documents.filter((d) => !missing.has(d.path));
      exp.missingFiles += missing.size;
      exp.evidences += ev.length;
      exp.documents += docs.length;
      const e = evidences.get(id);
      const attachmentChecks: Array<[string, string, string]> = [
        ['สลิป', String(e?._count._all ?? 0), String(ev.length)],
        ['ยอดสลิปรวม', money(e?._sum.amount ?? ZERO), money(sumOf(ev.map((x) => x.amount)))],
        ['เอกสาร', String(documents.get(id) ?? 0), String(docs.length)],
      ];
      for (const [label, db, want] of attachmentChecks) {
        if (db !== want) fail(item.code, `${label} ในฐาน ${db} ≠ แผน ${want}`);
      }
    } else exp.attachmentsUnchecked++;

    // รายการบัญชีตาม flow
    const flowChecks: Array<[string, string, number]> = [
      ['รายการยกมา', LEGACY_OPENING_FLOW, opening],
      ['marker', LEGACY_PRIOR_RECEIPT_FLOW, markers],
      ['รายการไล่ VAT', LEGACY_VAT_CATCHUP_FLOW, catchUp],
    ];
    for (const [label, flow, want] of flowChecks) {
      const db = flowCount.get(flowKey(id, flow)) ?? 0;
      if (db !== want) fail(item.code, `${label} ในฐาน ${db} ≠ แผน ${want}`);
    }

    if (isCreated) {
      const customer = customerByCode.get(item.code);
      if (!customer) fail(item.code, 'ไม่มีผลผูกลูกค้าในรายงานตัวเขียน');
      else if (customer.customerId !== row.customerId) {
        fail(item.code, 'ลูกค้าของสัญญาในฐาน ≠ รายงานตัวเขียน');
      }
    }
  }

  // ยอดรวมของรายงานตัวเขียน = แผนของสัญญาที่สร้างรอบนี้
  const createdItems = items.filter((i) => report.contractIds.has(i.code));
  const createdMissing = (i: PlannedContract) => writerMissing.get(i.code) ?? new Set<string>();
  const totalChecks: Array<[string, number, number]> = [
    ['แถวตารางงวด', created.schedules, createdItems.reduce((n, i) => n + i.schedule.length, 0)],
    ['งวด', created.payments, createdItems.reduce((n, i) => n + i.payments.length, 0)],
    [
      'สลิป',
      created.evidences,
      createdItems.reduce(
        (n, i) => n + i.evidences.filter((e) => !createdMissing(i).has(e.slipPath)).length,
        0,
      ),
    ],
    [
      'เอกสาร',
      created.documents,
      createdItems.reduce(
        (n, i) => n + i.documents.filter((d) => !createdMissing(i).has(d.path)).length,
        0,
      ),
    ],
    [
      'รายการบัญชี',
      created.journalEntries,
      createdItems.reduce(
        (n, i) =>
          n +
          (i.opening && i.opening.openingLines.length > 0 ? 1 : 0) +
          (i.opening?.priorReceiptMarkers.length ?? 0) +
          (i.opening && i.opening.catchUpLines.length > 0 ? 1 : 0),
        0,
      ),
    ],
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
    const mc = membersOfCustomer.get(row.customerId) ?? new Set<string>();
    mc.add(item.memberCode);
    membersOfCustomer.set(row.customerId, mc);
  }
  for (const item of items) {
    if ((customersOfMember.get(item.memberCode)?.size ?? 0) > 1) {
      fail(item.code, 'สมาชิกระบบเก่าคนเดียวผูกลูกค้ามากกว่าหนึ่งคน');
    }
  }
  const shared = [...membersOfCustomer.values()].filter((s) => s.size > 1).length;

  // ต้นทางสิทธิ์ของลูกค้าที่สร้างรอบนี้ (+ Contact ที่สร้างให้) = ค่าที่ตัวเขียนรายงาน — แก้ภายหลังไม่ได้ (trigger
  // `immutable_party_access_origin`) ⇒ ทางสร้างลูกค้าที่ลืมส่ง origin ต้องหยุดที่นี่ · LINKED ไม่ตรวจ (ตัวนำเข้าไม่แตะต้นทางเดิม)
  const origin = report.customerOrigin;
  const originText = (company: string | null, branchId: string | null) =>
    `${company ?? 'ว่าง'}/${
      branchId === null
        ? 'ไม่มีสาขา'
        : branchId === origin.accessBranchId
          ? 'สาขาที่รายงาน'
          : 'สาขาอื่น'
    }`;
  type Party = { accessCompanyCode: string | null; accessBranchId: string | null };
  const createdCustomers = report.customers.filter((x) => x.outcome === 'CREATED');
  const originRows = new Map(
    createdCustomers.length === 0
      ? []
      : (
          await tx.customer.findMany({
            where: { id: { in: createdCustomers.map((x) => x.customerId) } },
            select: {
              id: true,
              accessCompanyCode: true,
              accessBranchId: true,
              contact: { select: { accessCompanyCode: true, accessBranchId: true } },
            },
          })
        ).map((r) => [r.id, r]),
  );
  for (const x of createdCustomers) {
    const row = originRows.get(x.customerId);
    if (!row) {
      fail(x.code, 'ไม่พบลูกค้าที่ตัวเขียนรายงานว่าสร้างรอบนี้');
      continue;
    }
    const parties: Array<[label: string, party: Party | null]> = [['ลูกค้า', row]];
    if (x.writes.includes('contactCreated')) parties.push(['Contact', row.contact]);
    for (const [label, party] of parties) {
      if (
        party?.accessCompanyCode !== origin.accessCompanyCode ||
        party.accessBranchId !== origin.accessBranchId
      ) {
        fail(
          x.code,
          `ต้นทางสิทธิ์ของ${label}ที่สร้างรอบนี้ในฐาน ${party ? originText(party.accessCompanyCode, party.accessBranchId) : 'ไม่มีแถว'} ≠ รายงานตัวเขียน ${originText(origin.accessCompanyCode, origin.accessBranchId)}`,
        );
      }
    }
  }

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
      ` · ตารางงวด ${exp.schedules} · งวด ${exp.payments} (ตรวจรายแถว) · สลิป ${exp.evidences} · เอกสาร ${exp.documents}` +
      ` (ไฟล์ไม่ได้อัปโหลด ${exp.missingFiles}${planKnowsFiles ? ' ตามแผน' : ' ตามตัวเขียน'}` +
      `${exp.attachmentsUnchecked > 0 ? ` · ไม่ได้ตรวจสลิป/เอกสาร ${exp.attachmentsUnchecked} สัญญา` : ''})` +
      ` · รายการบัญชี: ยกมา ${exp.opening} · marker ${exp.marker} · ไล่ VAT ${exp.catchUp}` +
      ` · ลูกค้า ${membersOfCustomer.size} จากสมาชิก ${customersOfMember.size}` +
      ` (สร้างใหม่ ${created.customers} · ลูกค้าที่ถือหลายสมาชิก ${shared}) · ต้นทางสิทธิ์ลูกค้าใหม่ ` +
      `${origin.accessCompanyCode}${origin.companyFallback ? ' (สาขาไม่ผูกบริษัท — ค่าแทน)' : ''}`,
    failures,
  };
}

/** Σ(amountDue − amountPaid) ต่อสัญญาจากแถว Payment ที่ไม่ถูกลบ */
function outstandingByContract(payments: readonly PaymentRow[]): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  for (const p of payments) {
    out.set(p.contractId, (out.get(p.contractId) ?? ZERO).plus(p.amountDue).minus(p.amountPaid));
  }
  return out;
}

async function gate62(ctx: Ctx): Promise<GateBody> {
  const failures: GateFailure[] = [];
  const imported = await ctx.imported();
  const payments = await ctx.payments();
  const outstanding = outstandingByContract(payments);
  const active = ctx.plan.items.filter((i) => i.kind === 'ACTIVE');
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
    if (!item.peak.satangGap.isZero()) satangContracts++;
    if (!due.eq(item.peak.remain)) {
      failures.push({
        code: item.code,
        detail: `ยอดค้างตามงวด ${money(due)} ≠ คงเหลือใบแจ้งหนี้ PEAK ${item.peak.invoiceCode} ${money(
          item.peak.remain,
        )} (BESTCHOICE − PEAK ${money(due.minus(item.peak.remain))})`,
      });
    }
  }
  // งวดที่ยังไม่ PAID ของสัญญาประวัติ (เช่น PARTIALLY_PAID) — คิวทวงถาม / รอบค่าปรับอาจหยิบ (รายงานอย่างเดียว)
  const historyIds = new Set(
    ctx.plan.items
      .filter((i) => i.kind !== 'ACTIVE')
      .flatMap((i) => imported.byCode.get(i.code)?.id ?? []),
  );
  const openHistory = payments.filter(
    (p) => historyIds.has(p.contractId) && p.status !== 'PAID',
  ).length;
  return {
    detail:
      `สัญญาผ่อนอยู่ ${active.length} · ยอดค้างตามงวดรวม ${money(total)} · คงเหลือ PEAK รวม ${money(remain)}` +
      ` · ต่างกับระบบเก่า (รายงานอย่างเดียว): ปรับลดตาม PEAK ${money(adjustment)} (${adjusted} สัญญา)` +
      ` · เศษสตางค์ PEAK ปรับเข้างวดสุดท้าย ${money(satang)} (${satangContracts} สัญญา)` +
      ` · สัญญาประวัติไม่ตรวจยอด ${ctx.plan.items.length - active.length}` +
      ` (งวดที่ยังไม่ PAID ${openHistory} — รายงานอย่างเดียว)`,
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
  const fail = (code: string, detail: string) => failures.push({ code, detail });
  const imported = await ctx.imported();
  const entries = await ctx.entries();
  const gl = glByContract(entries);
  const payments = await ctx.payments();
  const outstanding = outstandingByContract(payments);
  const paidOf = new Map(payments.map((p) => [`${p.contractId}:${p.installmentNo}`, p.amountPaid]));
  const schedules = await ctx.schedules();
  const scheduleById = new Map(schedules.map((s) => [s.id, s]));
  const schedulesOf = byContract(schedules);
  const markersOf = new Map<string, ContractEntry[]>();
  for (const entry of entries) {
    if (metaString(entry.metadata, 'flow') !== LEGACY_PRIOR_RECEIPT_FLOW || !isOwnEntry(entry)) {
      continue;
    }
    const list = markersOf.get(entry.contractId) ?? [];
    list.push(entry);
    markersOf.set(entry.contractId, list);
  }

  const totals = new Map<string, Decimal>(CARRY_FORWARD_ACCOUNTS.map((a) => [a, ZERO]));
  let rounding = ZERO;
  let roundingContracts = 0;
  let satang = ZERO;
  let satangContracts = 0;
  let unaccruedRows = 0;
  for (const item of ctx.plan.items) {
    const row = imported.byCode.get(item.code);
    if (!row) {
      fail(item.code, 'ไม่พบสัญญาในฐาน');
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
          fail(item.code, `สัญญาประวัติมียอด ${account} ใน GL ${money(at(account))}`);
        }
      }
      continue;
    }
    if (!item.opening) {
      fail(item.code, 'แผนไม่มีรายการยกมาของสัญญาผ่อนอยู่');
      continue;
    }
    rounding = rounding.plus(item.roundingDiff);
    if (!item.roundingDiff.isZero()) roundingContracts++;
    if (item.peak && !item.peak.satangGap.isZero()) {
      satang = satang.plus(item.peak.satangGap);
      satangContracts++;
    }

    // ① GL = รายการยกมา + marker (Cr 11-2103) + ไล่ VAT (Dr 21-2102) — ลงในธุรกรรมเดียวกันทั้งหมด
    const expected = new Map<string, Decimal>();
    const add = (account: string, net: Decimal) =>
      expected.set(account, (expected.get(account) ?? ZERO).plus(net));
    for (const line of item.opening.openingLines) add(line.accountCode, line.dr.minus(line.cr));
    for (const marker of item.opening.priorReceiptMarkers) add('11-2103', marker.amount.negated());
    for (const line of item.opening.catchUpLines) add(line.accountCode, line.dr.minus(line.cr));
    for (const account of CARRY_FORWARD_ACCOUNTS) {
      const want = expected.get(account) ?? ZERO;
      if (!at(account).eq(want)) {
        fail(
          item.code,
          `${account} ใน GL ${money(at(account))} ≠ ยกมา (หลัง marker / ไล่ VAT) ${money(want)} (Dr − Cr)`,
        );
      }
    }

    // ② ลูกหนี้ใน GL = ยอดค้างตามแถวงวด + เศษปัด (บัญชี − ยอดเรียกเก็บ)
    const receivable = sumOf(RECEIVABLE_ACCOUNTS.map((a) => at(a)));
    const register = outstanding.get(row.id) ?? ZERO;
    if (!receivable.eq(register.plus(item.roundingDiff))) {
      fail(
        item.code,
        `ลูกหนี้ใน GL (11-2101 + 11-2103 + 11-2105) ${money(receivable)} ≠ ยอดค้างตามงวด ${money(
          register,
        )} + เศษปัด ${money(item.roundingDiff)}`,
      );
    }

    // ③ GL วิ่งถึงศูนย์เมื่อรอบ 2A ตั้งงวดที่เหลือครบ — ตัวสร้างบรรทัดตัวเดียวกับรอบกลางคืน ข้อมูลจากสัญญาและแถวงวดในฐาน
    const runoff = new Map<string, Decimal>();
    for (const sched of schedulesOf.get(row.id) ?? []) {
      if (sched.accrualJournalEntryId !== null) continue;
      unaccruedRows++;
      try {
        const part = buildRemainderAccrual2ALines(
          accrual2AInputOf(row, sched.installmentNo),
          accruedSoFarOf(sched),
        );
        for (const line of part.lines) {
          runoff.set(
            line.accountCode,
            (runoff.get(line.accountCode) ?? ZERO).plus(line.dr).minus(line.cr),
          );
        }
      } catch (error) {
        fail(
          item.code,
          `งวด ${sched.installmentNo}: คำนวณ 2A ส่วนที่เหลือไม่ได้ (${errorLabel(error)})`,
        );
      }
    }
    for (const account of ACCRUAL_RUNOFF_ACCOUNTS) {
      const after = at(account).plus(runoff.get(account) ?? ZERO);
      if (!after.isZero()) {
        fail(
          item.code,
          `${account}: GL ${money(at(account))} + 2A ที่รอบกลางคืนจะลง (งวดที่ยังตั้งไม่ครบ) ${money(
            runoff.get(account) ?? ZERO,
          )} = ${money(after)} ≠ 0`,
        );
      }
    }

    // ④ marker: ชี้แถวงวดของ (สัญญา, งวด) ที่แผนมี marker · ยอด = แผน = amountPaid ของงวด
    const plannedMarkers = new Map(
      item.opening.priorReceiptMarkers.map((mk) => [mk.installmentNo, mk.amount]),
    );
    const seen = new Set<number>();
    for (const marker of markersOf.get(row.id) ?? []) {
      const sched = scheduleById.get(metaString(marker.metadata, 'installmentScheduleId') ?? '');
      const label = `marker ${marker.entryNumber}`;
      if (!sched || sched.contractId !== row.id) {
        fail(item.code, `${label}: ไม่ได้ชี้แถวตารางงวดของสัญญานี้`);
        continue;
      }
      const no = sched.installmentNo;
      const want = plannedMarkers.get(no);
      if (want === undefined) {
        fail(item.code, `${label}: ชี้งวด ${no} ซึ่งแผนไม่มี marker`);
        continue;
      }
      if (seen.has(no)) fail(item.code, `${label}: งวด ${no} มี marker มากกว่าหนึ่งรายการ`);
      seen.add(no);
      const cr = lineNet(marker, '11-2103').negated();
      const dr = lineNet(marker, OPENING_EQUITY_ACCOUNT);
      if (!cr.eq(want) || !dr.eq(want)) {
        fail(
          item.code,
          `${label} งวด ${no}: Cr 11-2103 ${money(cr)} / Dr ${OPENING_EQUITY_ACCOUNT} ${money(dr)} ≠ แผน ${money(want)}`,
        );
      }
      const paid = paidOf.get(`${row.id}:${no}`);
      if (!paid || !paid.eq(want)) {
        fail(
          item.code,
          `${label} งวด ${no}: ยอด ${money(want)} ≠ amountPaid ของงวด ${money(paid)}`,
        );
      }
    }
    for (const no of plannedMarkers.keys()) {
      if (!seen.has(no)) fail(item.code, `งวด ${no}: ไม่มี marker ที่ชี้แถวงวดนี้`);
    }
  }
  const glText = CARRY_FORWARD_ACCOUNTS.map((a) => `${a} ${money(totals.get(a) as Decimal)}`).join(
    ' · ',
  );
  return {
    detail:
      `GL ของสัญญาที่นำเข้า (Dr − Cr): ${glText}` +
      ` · งวดที่ยังตั้งลูกหนี้ไม่ครบ ${unaccruedRows} (GL 11-2101 / 11-2105 / 11-2106 / 21-2102 วิ่งถึงศูนย์เมื่อรอบ 2A ตั้งครบ)` +
      ` · เศษปัดบัญชี − PEAK รวม ${money(rounding)} (${roundingContracts} สัญญา — บวก: งวดสุดท้ายลง 52-1104 · ลบ: ลง 53-1503)` +
      ` · เศษสตางค์ PEAK ปรับเข้างวดสุดท้าย ${money(satang)} (${satangContracts} สัญญา)`,
    failures,
  };
}

async function gate65(ctx: Ctx): Promise<GateBody> {
  const { tx } = ctx;
  const failures: GateFailure[] = [];
  const fail = (code: string, detail: string) => failures.push({ code, detail });
  const imported = await ctx.imported();
  const ids = imported.ids;
  // รอบ 2A ที่ทำงาน ณ วันตัดเลือก dueDate < เที่ยงคืนวันถัดไป (กรุงเทพ) — ครอบงวดที่ครบกำหนดถึงวันตัด ·
  // รอบภาษีขาย 60 วันเลือกจากแถวที่ไม่มี accrualJournalEntryId เช่นกัน (+ ยอดสะสม 0 + ไม่ PAID) ⇒ เป็นเซตย่อยของคิวรีนี้
  const dueBefore = new Date(bangkokStartOfDay(ctx.cutoff).getTime() + DAY_MS);
  const accrual = await tx.installmentSchedule.findMany({
    where: {
      contractId: { in: ids },
      dueDate: { lt: dueBefore },
      accrualJournalEntryId: null,
      deletedAt: null,
      contract: { status: { notIn: [...ACCRUAL_EXCLUDED_CONTRACT_STATUSES] }, deletedAt: null },
    },
    select: { contractId: true, installmentNo: true },
    orderBy: [{ contractId: 'asc' }, { installmentNo: 'asc' }],
  });
  for (const r of accrual) {
    fail(
      imported.codeOf.get(r.contractId) ?? '?',
      `งวด ${r.installmentNo}: รอบตั้งลูกหนี้งวด (2A) จะหยิบ — ครบกำหนดถึงวันตัดแต่ไม่มี accrualJournalEntryId`,
    );
  }

  // แถวตารางงวดรายแถว = แผน · ลิงก์ = เลขที่รายการยกมา เมื่อและเฉพาะเมื่อ stamp accrued · accrued* = stamp
  // รายการยกมาหาด้วย reference (`legacy-opening:<เลขเดิม>`) ไม่ใช่ flow — flow ตรวจที่ 6.1 / 6.6
  const entries = await ctx.entries();
  const schedules = byContract(await ctx.schedules());
  let rows = 0;
  let linked = 0;
  let partial = 0;
  let vat60 = 0;
  for (const item of ctx.plan.items) {
    const row = imported.byCode.get(item.code);
    if (!row) continue;
    const dbRows = new Map((schedules.get(row.id) ?? []).map((s) => [s.installmentNo, s]));
    const stamps = new Map((item.opening?.stamps ?? []).map((s) => [s.installmentNo, s]));
    const openings = entries.filter(
      (e) =>
        isOwnEntry(e) &&
        e.contractId === row.id &&
        e.referenceType === 'AUTO' &&
        e.referenceId === legacyOpeningReference(item.code),
    );
    const openingNo = openings.length === 1 ? openings[0].entryNumber : null;
    for (const planned of item.schedule) {
      const sched = dbRows.get(planned.installmentNo);
      dbRows.delete(planned.installmentNo);
      const at = `งวด ${planned.installmentNo}`;
      if (!sched) {
        fail(item.code, `${at}: ไม่มีแถวตารางงวด`);
        continue;
      }
      rows++;
      if (sched.dueDate.getTime() !== planned.dueDate.getTime()) {
        fail(item.code, `${at}: dueDate ในฐาน ${day(sched.dueDate)} ≠ แผน ${day(planned.dueDate)}`);
      }
      const fields: Array<[string, Decimal | null, Decimal | null]> = [
        ['amountDue', sched.amountDue, planned.amountDue],
        ['principal', sched.principal, planned.principal],
        ['interest', sched.interest, planned.interest],
      ];
      for (const [field, db, want] of fields) {
        if (!sameMoney(db, want)) {
          fail(item.code, `${at}: ${field} ในฐาน ${money(db)} ≠ แผน ${money(want)}`);
        }
      }
      if (sched.vat60dayJournalEntryId !== null) {
        vat60++;
        fail(item.code, `${at}: มี vat60dayJournalEntryId (ตัวนำเข้าห้ามผูก)`);
      }
      const stamp = stamps.get(planned.installmentNo);
      if (!stamp) {
        fail(item.code, `${at}: แผนไม่มี stamp ของงวดนี้`);
        continue;
      }
      if (stamp.accrued) {
        linked++;
        if (!openingNo || sched.accrualJournalEntryId !== openingNo) {
          fail(
            item.code,
            `${at}: ตั้งลูกหนี้ครบแล้วแต่ accrualJournalEntryId ไม่ใช่เลขที่รายการยกมาของสัญญา`,
          );
        }
      } else if (sched.accrualJournalEntryId !== null) {
        fail(
          item.code,
          `${at}: ยังตั้งลูกหนี้ไม่ครบแต่มี accrualJournalEntryId — รอบ 2A จะไม่หยิบงวดนี้`,
        );
      }
      if (!stamp.accrued && !stamp.accruedAmount.isZero()) partial++;
      const accrued: Array<[string, Decimal, Decimal]> = [
        ['accruedAmount', sched.accruedAmount, stamp.accruedAmount],
        ['accruedVat', sched.accruedVat, stamp.accruedVat],
        ['accruedInterest', sched.accruedInterest, stamp.accruedInterest],
      ];
      for (const [field, db, want] of accrued) {
        if (!db.eq(want))
          fail(item.code, `${at}: ${field} ในฐาน ${money(db)} ≠ แผน ${money(want)}`);
      }
    }
    for (const extra of dbRows.keys()) fail(item.code, `งวด ${extra}: แถวตารางงวดไม่อยู่ในแผน`);
  }
  return {
    detail:
      `งวดที่ครบกำหนดก่อน ${bangkokDateString(dueBefore)} (กรุงเทพ) ของ ${ids.length} สัญญา: รอบ 2A จะหยิบ ${accrual.length}` +
      ` (รอบภาษีขาย 60 วันเป็นเซตย่อย) · แถวตารางงวด ${rows}: ตั้งลูกหนี้ครบ (ลิงก์รายการยกมา) ${linked}` +
      ` · ตั้งบางส่วน ${partial} · ผูก VAT 60 วัน ${vat60}`,
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
      ` (Dr 11-2106 ไม่มีคู่ 41-1101) ส่งออก PEAK ไม่ดุล รอสำนักงานบัญชี` +
      ` · ตรวจตามตัวกรองไฟล์ส่งออก CSV — การส่งผ่าน PEAK API ยังไม่กรอง`,
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
 * รันทุกด่าน (ตามลำดับ `GATE_IDS`) ใน `tx` ของการนำเข้า — ดูหัวไฟล์ · คืนผลหนึ่งรายการต่อด่านเสมอ (ไม่ throw)
 * @param cutoff ต้องเท่า `plan.cutoff` (ด่านใช้วันตัดของแผน — ค่าอื่นทำให้ 6.1 ไม่ผ่าน)
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
    cutoff: plan.cutoff,
    callerCutoff: cutoff,
    opts,
    imported,
    entries: once(async () => loadContractEntries(tx, (await imported()).ids)),
    schedules: once(async () =>
      tx.installmentSchedule.findMany({
        where: { contractId: { in: (await imported()).ids }, deletedAt: null },
        select: SCHEDULE_SELECT,
        orderBy: [{ contractId: 'asc' }, { installmentNo: 'asc' }],
      }),
    ),
    payments: once(async () =>
      tx.payment.findMany({
        where: { contractId: { in: (await imported()).ids }, deletedAt: null },
        select: PAYMENT_SELECT,
        orderBy: [{ contractId: 'asc' }, { installmentNo: 'asc' }],
      }),
    ),
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
    let outcome: GateResult;
    try {
      const body = await GATES[id](ctx);
      if (inSavepoint) await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
      outcome = result(id, body);
    } catch (error) {
      if (inSavepoint) {
        try {
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
        } catch {
          // ธุรกรรมใช้ต่อไม่ได้ — ด่านถัดไปจะรายงาน error ของตัวเอง
        }
      }
      outcome = { id, pass: false, detail: `ตรวจไม่สำเร็จ (${errorLabel(error)}) — ถือว่าไม่ผ่าน` };
    }
    results.push(outcome);
  }
  return results;
}

// ── 6.8 สุ่มเทียบด้วยตา ───────────────────────────────────────────────────────────────────────────

/** ชั้นของการสุ่ม (สเปก 6.8) — ลำดับ = ลำดับที่เลือก */
const SAMPLE_STRATA: ReadonlyArray<(item: PlannedContract) => boolean> = [
  (i) => i.kind === 'ACTIVE' && i.status === 'OVERDUE',
  (i) => i.kind === 'HISTORY' && i.status === 'EARLY_PAYOFF',
  (i) => i.oldForm,
];
/**
 * โควตาต่อชั้น = `⌊n/5⌋` คงเดิมตั้งแต่ยังมีชั้น "ยกเลิก/หนี้เสีย" (ถอดแล้ว — สัญญายกเลิกไม่นำเข้า คำตัดสินเจ้าของ 30/10) ·
 * ชั้นนั้นว่างในทุกรอบซ้อมก่อนถอด ⇒ คงตัวหาร 5 ให้แผนและ seed เดิมได้รายชื่อเดิม
 */
const SAMPLE_QUOTA_DIVISOR = 5;

/**
 * เลขสัญญาเดิม `n` สัญญาให้คนเทียบกับ PEAK / หน้าจอระบบเก่าทีละช่องในคืนตัด (สเปก 6.8) — ครอบทุกชั้น: ค้างชำระ ·
 * ปิดก่อนกำหนด · ฉบับเก่า (แต่ละชั้นได้ `max(1, ⌊n/5⌋)` สัญญาเท่าที่มี) แล้วสุ่มส่วนที่เหลือจากทุกสัญญา ·
 * ผลเดิมทุกครั้งสำหรับแผนและ `seed` เดียวกัน (ไม่ส่ง = ผูกกับวันตัดของแผน — ผู้เรียกควรส่งรหัสรอบนำเข้า)
 */
export function sampleForManualCheck(plan: ImportPlan, n = 20, seed?: string): string[] {
  if (n <= 0) return [];
  const order = seededShuffle(plan.items, seed ?? `legacy-sample:${plan.cutoff.toISOString()}`);
  const quota = Math.max(1, Math.floor(n / SAMPLE_QUOTA_DIVISOR));
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
