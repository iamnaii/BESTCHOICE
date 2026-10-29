import { Prisma } from '@prisma/client';
import { bangkokDateString } from '../../utils/date.util';
import type { CanceledResolution } from './classify';
import { csvLine, csvText, formatMoney, readCsv } from './csv';
import type { DumpRow } from './dump-reader';
import type { LegacyFileUploadResult } from './files';
import type { LegacyBook, LegacyContract } from './legacy-book';
import {
  checkInstallmentAmounts,
  mapContractMoney,
  type AmountMismatch,
  type MoneyOverride,
} from './money';
import { CARRY_FORWARD_ACCOUNTS, OPENING_EQUITY_ACCOUNT } from './opening';
import { GATE_LABELS, type GateResult } from './gates';
import type { PeakRecon } from './peak-recon';
import {
  BLOCKER_REASON_TEXT,
  type ImportBlocker,
  type ImportBlockerReason,
  type ImportPlan,
  type PlannedContract,
} from './plan-import';

/**
 * ไฟล์ผลลัพธ์ของคำสั่ง `report` / `import` (Task 13) — ฟังก์ชันบริสุทธิ์ คืนข้อความของไฟล์ ไม่เขียนไฟล์เอง
 *
 * **ไม่มีข้อมูลส่วนบุคคลของลูกค้า:** มีแค่เลขสัญญาเดิม รหัสสมาชิก รหัส/ยอดของ PEAK id ลูกค้าใน BESTCHOICE เลขงวด path
 * ไฟล์แนบ (ชื่อสุ่ม) และยอดเงิน · ไม่อ่านชื่อ เบอร์ เลขบัตร ที่อยู่ ของสมาชิก · ช่องข้อความอิสระของระบบเก่า
 * (`canceled_remark` / `baddebt_remark`) ตัดเลขยาวออกก่อน (`redactDigits` — เบอร์/เลขบัตรที่แอดมินพิมพ์ไว้) — ชื่อคนในข้อความ
 * อิสระตัดอัตโนมัติไม่ได้ ไฟล์จึงอยู่นอก repo เสมอ (`repo-guard.ts`)
 *
 * ไฟล์ที่เจ้าของกรอกแล้วส่งกลับเป็นตัวเลือกของคำสั่งได้ตรง ๆ (คอลัมน์อื่นไม่อ่าน):
 * `canceled.csv` → `--canceled-map` · `money-mismatch.csv` → `--money-overrides` · `customers-blocked.csv` →
 * `--customer-overrides` — แต่ละไฟล์มีแถวของค่าที่ส่งมารอบก่อนอยู่ด้วย (ส่งกลับแล้วค่าเดิมไม่หาย)
 */

type Decimal = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);

// ─── --canceled-map ──────────────────────────────────────────────────────────────────────────────

/** ผลที่เจ้าของเลือกได้ (`classify.ts` `CanceledResolution`) */
export const CANCELED_RESOLUTIONS: readonly CanceledResolution[] = [
  'TERMINATED',
  'CANCELED',
  'CLOSED_BAD_DEBT',
  'EXCHANGED',
];

/** หัวคอลัมน์ที่ต้องมีในไฟล์ `--canceled-map` (= `canceled.csv` ที่กรอกแล้ว) */
export const CANCELED_MAP_COLUMNS = ['legacy_code', 'resolution'] as const;

const CANCELED_MAP_ERROR = 'อ่านไฟล์ --canceled-map ไม่ได้';

/**
 * อ่าน `--canceled-map` → เลขสัญญาเดิม → ผลที่เจ้าของยืนยัน · `resolution` ว่าง = ยังไม่ยืนยัน (ข้าม — สัญญายังเป็นตัวบล็อก)
 * · ค่าไม่อยู่ใน `CANCELED_RESOLUTIONS` (ไม่สนตัวเล็ก/ใหญ่) หรือเลขสัญญาซ้ำ = throw บอกบรรทัด (ไม่ยกค่าในช่อง)
 */
export function parseCanceledMapCsv(text: string): Map<string, CanceledResolution> {
  const out = new Map<string, CanceledResolution>();
  const lineOfCode = new Map<string, number>();
  for (const row of readCsv(text, CANCELED_MAP_COLUMNS, CANCELED_MAP_ERROR)) {
    const code = row.text('legacy_code');
    const previous = lineOfCode.get(code);
    if (previous !== undefined) throw row.fail('legacy_code', `สัญญาซ้ำกับบรรทัด ${previous}`);
    lineOfCode.set(code, row.line);
    const raw = row.cell('resolution').toUpperCase();
    if (raw === '') continue;
    if (!(CANCELED_RESOLUTIONS as readonly string[]).includes(raw)) {
      throw row.fail('resolution', `ต้องเป็น ${CANCELED_RESOLUTIONS.join(' / ')} หรือเว้นว่าง`);
    }
    out.set(code, raw as CanceledResolution);
  }
  return out;
}

// ─── ตัวช่วย ─────────────────────────────────────────────────────────────────────────────────────

const byCodeAsc = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** ตัวเลขยาว 9 หลักขึ้นไป (มีขีด/ช่องว่างคั่นได้) ในข้อความอิสระ → `[ตัดตัวเลข]` — เบอร์ / เลขบัตร / เลขบัญชี */
export function redactDigits(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/\d(?:[\s-]*\d){8,}/g, '[ตัดตัวเลข]');
}

/** ค่าที่ JSON.stringify ได้ตรง ๆ — Decimal → สตริง 2 ตำแหน่ง · Map → object · Date → ISO */
export function toJsonSafe(value: unknown): unknown {
  if (Prisma.Decimal.isDecimal(value)) return formatMoney(value as Decimal);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([k, v]) => [String(k), toJsonSafe(v)]));
  }
  if (value instanceof Set) return [...value].map(toJsonSafe);
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}

/** จำนวนต่อค่า เรียงตามชื่อ */
export function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => byCodeAsc(a, b)));
}

const sum = (values: readonly Decimal[]) => values.reduce((s, v) => s.plus(v), ZERO);

// ─── blockers.csv ────────────────────────────────────────────────────────────────────────────────

/** ช่องของ `ImportBlocker.detail` ที่มีคอลัมน์ของตัวเอง — ช่องอื่นรวมใน `detail` (`key=value; …`) */
const BLOCKER_DETAIL_COLUMNS = [
  ['memberCode', 'member_code'],
  ['invoiceCode', 'invoice_code'],
  ['installmentNos', 'installment_nos'],
  ['diff', 'diff'],
  ['expectedRoundingDiff', 'expected_rounding_diff'],
  ['mismatch', 'mismatch'],
  ['relatedCustomerId', 'related_customer_id'],
] as const;

export const BLOCKERS_CSV_HEADER = [
  'legacy_code',
  'reason',
  'reason_th',
  ...BLOCKER_DETAIL_COLUMNS.map(([, column]) => column),
  'detail',
];

/**
 * `blockers.csv` — หนึ่งแถวต่อแถวตัวบล็อก (แผน `planImport` หรือตัวเขียน `LegacyWriteBlocked.rows`) เรียงตามเลขสัญญา ·
 * `reason_th` = `BLOCKER_REASON_TEXT` · error ของฐานข้อมูลมีแค่ชื่อคลาส/รหัส (ตัวเขียนตัดข้อความออกแล้ว)
 */
export function blockersCsv(rows: readonly ImportBlocker[]): string {
  const known = new Set<string>(BLOCKER_DETAIL_COLUMNS.map(([key]) => key));
  const sorted = [...rows].sort(
    (a, b) => byCodeAsc(a.code, b.code) || byCodeAsc(a.reason, b.reason),
  );
  return csvText(
    BLOCKERS_CSV_HEADER,
    sorted.map((row) => {
      const detail = row.detail ?? {};
      const rest = Object.entries(detail)
        .filter(([key]) => !known.has(key))
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
      return [
        row.code,
        row.reason,
        BLOCKER_REASON_TEXT[row.reason] ?? '',
        ...BLOCKER_DETAIL_COLUMNS.map(([key]) => detail[key] ?? ''),
        rest,
      ];
    }),
  );
}

// ─── customers-blocked.csv ───────────────────────────────────────────────────────────────────────

/** ตัวบล็อกฝั่งลูกค้า — แก้ด้วย `--customer-overrides` (หรือแก้ข้อมูลใน BESTCHOICE) */
export const CUSTOMER_BLOCKER_REASONS: ReadonlySet<ImportBlockerReason> = new Set([
  'MEMBER_NOT_FOUND',
  'CUSTOMER_INPUT_INVALID',
  'CUSTOMER_INVALID_NATIONAL_ID',
  'CUSTOMER_PEAK_CODE_CONFLICT',
  'CUSTOMER_OVERRIDE_UNKNOWN_MEMBER',
  'CUSTOMER_PHONE_TAKEN',
  'CUSTOMER_NATIONAL_ID_CONFLICT',
  'CUSTOMER_LINK_ERROR',
]);

/**
 * `customers-blocked.csv` — หัว `legacy_member_code,customer_id` ตรงกับ `--customer-overrides` (คอลัมน์อื่นไม่อ่าน):
 * เจ้าของกรอก `customer_id` (ลูกค้าใน BESTCHOICE ที่จะผูก) แล้ว**ลบแถวที่ไม่ได้กรอก**ก่อนส่งกลับ (ช่องว่าง = ไฟล์อ่านไม่ผ่าน) ·
 * override ที่ส่งมารอบนี้อยู่ด้วย (`outcome` `OVERRIDE_APPLIED`) — ส่งกลับแล้วไม่หาย (เลขบัตรผิดที่ผูกเองต้องอยู่ทุกรอบ)
 *
 * มีแค่รหัส ผล และธง — `related_customer_id` = ลูกค้าใน BESTCHOICE ที่ชน (เจ้าของเบอร์ / ผู้ถือเลขบัตร) ·
 * `related_has_national_id` (เฉพาะคำสั่ง `import` ที่เห็นฐาน) = ลูกค้าที่ชนมีเลขบัตรแล้วหรือไม่ (ธงเท่านั้น ไม่มีค่า)
 */
export function customersBlockedCsv(
  rows: readonly ImportBlocker[],
  overrides: ReadonlyMap<string, string>,
  relatedWithNationalId?: ReadonlySet<string>,
): string {
  const lines: string[][] = [];
  for (const row of rows) {
    if (!CUSTOMER_BLOCKER_REASONS.has(row.reason)) continue;
    const d = row.detail ?? {};
    const memberCode =
      row.reason === 'CUSTOMER_OVERRIDE_UNKNOWN_MEMBER' ? row.code : (d.memberCode ?? '');
    const related = d.relatedCustomerId ?? '';
    lines.push([
      memberCode,
      overrides.get(memberCode) ?? '',
      row.reason === 'CUSTOMER_OVERRIDE_UNKNOWN_MEMBER' ? '' : row.code,
      row.reason,
      related,
      related && relatedWithNationalId ? (relatedWithNationalId.has(related) ? 'yes' : 'no') : '',
      d.phoneInvalid === 'yes' ? 'yes' : '',
      d.peakContactCode ?? '',
      d.otherPeakContactCode ?? '',
    ]);
  }
  const listed = new Set(lines.map((l) => l[0]));
  for (const [memberCode, customerId] of overrides) {
    if (!listed.has(memberCode)) {
      lines.push([memberCode, customerId, '', 'OVERRIDE_APPLIED', '', '', '', '', '']);
    }
  }
  lines.sort((a, b) => byCodeAsc(a[0], b[0]) || byCodeAsc(a[2], b[2]));
  return csvText(
    [
      'legacy_member_code',
      'customer_id',
      'legacy_code',
      'outcome',
      'related_customer_id',
      'related_has_national_id',
      'phone_invalid',
      'peak_contact_code',
      'other_peak_contact_code',
    ],
    lines,
  );
}

// ─── bridge.csv ──────────────────────────────────────────────────────────────────────────────────

const BRIDGE_ACCOUNTS = [...CARRY_FORWARD_ACCOUNTS, OPENING_EQUITY_ACCOUNT] as const;

/** ยอดสุทธิ Dr − Cr ต่อบัญชีของรายการยกมาของสัญญา */
function openingNet(item: PlannedContract): Record<string, Decimal> {
  const out: Record<string, Decimal> = Object.fromEntries(BRIDGE_ACCOUNTS.map((a) => [a, ZERO]));
  for (const line of item.opening?.openingLines ?? []) {
    out[line.accountCode] = (out[line.accountCode] ?? ZERO).plus(line.dr).minus(line.cr);
  }
  return out;
}

/**
 * `bridge.csv` ตารางเชื่อมยอด (ส่งสำนักงานบัญชีเซ็นรับ) — หนึ่งแถวต่อสัญญาผ่อนอยู่ในแผน + แถว `TOTAL` ·
 * บรรทัด `#` ด้านบนอธิบายเครื่องหมาย · ยอดบัญชี = Dr − Cr (ติดลบ = ฝั่งเครดิต)
 */
export function bridgeCsv(book: LegacyBook, recon: PeakRecon, plan: ImportPlan): string {
  const byCode = new Map(book.contracts.map((c) => [c.code, c]));
  const items = plan.items
    .filter((i) => i.kind === 'ACTIVE' && i.opening && i.peak)
    .sort((a, b) => byCodeAsc(a.code, b.code));
  const money = items.map((item) => {
    const peak = item.peak as NonNullable<PlannedContract['peak']>;
    const net = openingNet(item);
    const markers = sum((item.opening?.priorReceiptMarkers ?? []).map((m) => m.amount));
    const catchUp = sum(
      (item.opening?.catchUpLines ?? [])
        .filter((l) => l.accountCode === '21-2101')
        .map((l) => l.cr),
    );
    const receivable = net['11-2101'].plus(net['11-2103']).plus(net['11-2105']).minus(markers);
    const contract = byCode.get(item.code);
    const legacy = contract ? recon.matched.get(contract.contractId)?.legacyOutstanding : undefined;
    return {
      item,
      values: [
        legacy ?? ZERO,
        peak.adjustment,
        peak.satangGap,
        peak.remain,
        net['11-2101'],
        net['11-2103'],
        net['11-2105'],
        markers,
        receivable,
        item.roundingDiff,
        net['11-2106'],
        net['21-2102'],
        catchUp,
        net['21-2102'].plus(catchUp),
        net[OPENING_EQUITY_ACCOUNT],
      ],
    };
  });
  const totals = money[0]
    ? money[0].values.map((_, i) => sum(money.map((m) => m.values[i])))
    : Array.from({ length: 15 }, () => ZERO);
  const notes = [
    `# ตารางเชื่อมยอดยกมา (บัญชี BESTCHOICE ฝั่ง FINANCE) กับยอดคงเหลือใบแจ้งหนี้ PEAK (113101) ณ วันตัด ${bangkokDateString(plan.cutoff)} — ยอดบัญชี = Dr − Cr (ติดลบ = ฝั่งเครดิต) · แถว TOTAL = ผลรวมทุกสัญญา`,
    '# rounding_diff = receivable_after_markers − peak_remain (เศษปัดค่างวด): บวก → ลูกค้าจ่ายตาม PEAK แล้วลูกหนี้ในบัญชียังเหลือเศษ ระบบลง 52-1104 ส่วนลดเศษสตางค์ตอนรับงวดนั้น · ลบ → ลง 53-1503 กำไรจากการปัดเศษ',
    '# legacy_outstanding = ยอดค้างระบบเก่าก่อนปรับ · peak_adjustment (≤ 0) = ส่วนที่ PEAK ค้างน้อยกว่า (ลงเป็นยอดจ่าย) · satang_gap (≥ 0) = เศษสตางค์ที่ PEAK สูงกว่า บวกเข้างวดสุดท้ายที่ค้าง',
    '# 21-2102_after_catch_up เทียบ 215102 ของ PEAK — catch_up_vat = Dr 21-2102 / Cr 21-2101 ลงวันถัดจากวันตัด 00:05 (VAT ของงวดที่ถึงกำหนดแล้วยังไม่ได้รับเงิน)',
  ];
  return (
    notes.map((n) => csvLine([n])).join('\n') +
    '\n' +
    csvText(
      [
        'legacy_code',
        'status',
        'peak_invoice_code',
        'legacy_outstanding',
        'peak_adjustment',
        'satang_gap',
        'peak_remain',
        'opening_11_2101',
        'opening_11_2103',
        'opening_11_2105',
        'prior_receipt_markers',
        'receivable_after_markers',
        'rounding_diff',
        'opening_11_2106',
        'opening_21_2102',
        'catch_up_vat',
        '21_2102_after_catch_up',
        'opening_32_1101',
      ],
      [
        ...money.map(({ item, values }) => [
          item.code,
          item.status,
          item.peak?.invoiceCode ?? '',
          ...values.map(formatMoney),
        ]),
        ['TOTAL', String(items.length), '', ...totals.map(formatMoney)],
      ],
    )
  );
}

// ─── canceled.csv ────────────────────────────────────────────────────────────────────────────────

const CANCELED_FIELDS = [
  'canceled_return_phone',
  'canceled_refund',
  'canceled_must_pay',
  'canceled_paid',
  'canceled_slip',
  'canceled_by',
  'canceled_at',
] as const;

/**
 * `canceled.csv` — สัญญายกเลิก (4) / หนี้เสีย (5) ทุกสัญญา + ช่อง `canceled_*` ของระบบเก่า (`canceled_ip` ไม่ใส่) ·
 * `resolution` = ค่าใน `--canceled-map` รอบนี้ (ว่าง = ยังไม่ยืนยัน — เจ้าของกรอก `CANCELED_RESOLUTIONS`) ·
 * ข้อความอิสระตัดตัวเลขยาวออก (`redactDigits`)
 */
export function canceledCsv(
  book: LegacyBook,
  contractRows: readonly DumpRow[],
  canceledMap: ReadonlyMap<string, CanceledResolution>,
): string {
  const rowById = new Map(contractRows.map((r) => [r.contract_id ?? '', r]));
  const rows = book.contracts
    .filter((c) => c.statusCode === '4' || c.statusCode === '5')
    .sort((a, b) => byCodeAsc(a.code, b.code))
    .map((c) => {
      const raw = rowById.get(c.contractId) ?? {};
      return [
        c.code,
        c.statusCode,
        bangkokDateString(c.createdAt),
        ...CANCELED_FIELDS.map((f) => raw[f] ?? ''),
        redactDigits(raw.canceled_remark),
        raw.baddebt_at ?? '',
        redactDigits(raw.baddebt_remark),
        canceledMap.get(c.code) ?? '',
      ];
    });
  return csvText(
    [
      'legacy_code',
      'legacy_status',
      'contract_date',
      ...CANCELED_FIELDS,
      'canceled_remark',
      'baddebt_at',
      'baddebt_remark',
      'resolution',
    ],
    rows,
  );
}

// ─── money-mismatch.csv ──────────────────────────────────────────────────────────────────────────

const MONEY_BLOCKER_REASONS: ReadonlySet<ImportBlockerReason> = new Set([
  'LEGACY_MONEY_INVALID',
  'MONEY_READ_ERROR',
  'INSTALLMENT_AMOUNT_MISMATCH',
]);

/** งวดที่ไม่ตรง `เลขงวด:ระบบเก่า/คำนวณ` — อ่านยอดไม่ได้ = ว่าง */
function mismatchText(c: LegacyContract, override: MoneyOverride | undefined): string {
  let mismatches: AmountMismatch[];
  try {
    mismatches = checkInstallmentAmounts(mapContractMoney(c, override), c.installments);
  } catch {
    return '';
  }
  return mismatches
    .map((m) => `${m.installmentNo}:${formatMoney(m.legacy)}/${formatMoney(m.computed)}`)
    .join('; ');
}

/**
 * `money-mismatch.csv` — สัญญาที่ติดตัวบล็อกเรื่องยอดเงิน + ทุกสัญญาที่มี `--money-overrides` รอบนี้ (`OVERRIDE_APPLIED`)
 * · หัว `legacy_code,financed_amount,store_commission,vat_amount` ตรงกับ `--money-overrides`: กรอกยอดที่ถูก แล้ว**ลบแถวที่
 * ไม่ได้กรอก**ก่อนส่งกลับ (ทุกช่องต้องมีค่า) · `legacy_*` = ค่าในระบบเก่า · `mismatches` = `งวด:ระบบเก่า/คำนวณ`
 */
export function moneyMismatchCsv(
  book: LegacyBook,
  plan: ImportPlan,
  overrides: ReadonlyMap<string, MoneyOverride>,
): string {
  const byCode = new Map(book.contracts.map((c) => [c.code, c]));
  const reasonOf = new Map<string, ImportBlockerReason>();
  for (const b of plan.blockers) {
    if (MONEY_BLOCKER_REASONS.has(b.reason) && !reasonOf.has(b.code))
      reasonOf.set(b.code, b.reason);
  }
  const codes = [...new Set([...reasonOf.keys(), ...overrides.keys()])].sort(byCodeAsc);
  const rows = codes.map((code) => {
    const c = byCode.get(code);
    const override = overrides.get(code);
    const reason = reasonOf.get(code);
    const d = c?.detail ?? {};
    return [
      code,
      override ? formatMoney(override.financedAmount) : '',
      override ? formatMoney(override.storeCommission) : '',
      override ? formatMoney(override.vatAmount) : '',
      reason ?? 'OVERRIDE_APPLIED',
      reason ? BLOCKER_REASON_TEXT[reason] : '',
      d.installment_number ?? '',
      d.finance ?? '',
      d.commission_admin ?? '',
      d.sales_tax ?? '',
      d.installment_amount ?? '',
      c ? mismatchText(c, override) : '',
    ];
  });
  return csvText(
    [
      'legacy_code',
      'financed_amount',
      'store_commission',
      'vat_amount',
      'reason',
      'reason_th',
      'legacy_total_months',
      'legacy_financed_amount',
      'legacy_store_commission',
      'legacy_vat_amount',
      'legacy_monthly',
      'mismatches',
    ],
    rows,
  );
}

// ─── old-form.csv · sample.csv · warnings.csv · missing-files.csv ───────────────────────────────

/** `old-form.csv` — สัญญาผ่อนอยู่ฉบับเก่า (ค่าปรับตามสัญญาเดิม) ให้พนักงานเทียบกระดาษ · `in_plan` = no เมื่อติดตัวบล็อก */
export function oldFormCsv(book: LegacyBook, plan: ImportPlan): string {
  const byCode = new Map(book.contracts.map((c) => [c.code, c]));
  const itemOf = new Map(plan.items.map((i) => [i.code, i]));
  return csvText(
    ['legacy_code', 'contract_date', 'in_plan', 'status'],
    [...plan.oldFormCodes].sort(byCodeAsc).map((code) => {
      const c = byCode.get(code);
      const item = itemOf.get(code);
      return [
        code,
        c ? bangkokDateString(c.createdAt) : '',
        item ? 'yes' : 'no',
        item?.status ?? '',
      ];
    }),
  );
}

/**
 * `sample.csv` — สัญญาที่สุ่มให้เทียบกับระบบเก่า/กระดาษด้วยตา (สเปก 6.8) · `checked` / `note` ว่างให้ผู้ตรวจกรอก ·
 * `codes` จาก `sampleForManualCheck` (เลขสัญญาเดิม — ตัวที่ไม่อยู่ในแผนถูกข้าม)
 */
export function sampleCsv(plan: ImportPlan, codes: readonly string[]): string {
  const itemOf = new Map(plan.items.map((i) => [i.code, i]));
  const rows: string[][] = [];
  for (const code of codes) {
    const item = itemOf.get(code);
    if (!item) continue;
    const paid = item.payments.filter((p) => p.status === 'PAID').length;
    const overdue = item.payments.filter(
      (p) => p.status !== 'PAID' && p.dueDate.getTime() < plan.cutoff.getTime(),
    ).length;
    const outstanding = sum(item.payments.map((p) => p.amountDue.minus(p.amountPaid)));
    rows.push([
      code,
      item.kind,
      item.status,
      item.oldForm ? 'yes' : '',
      bangkokDateString(item.contractDate),
      String(item.money.totalMonths),
      String(paid),
      String(overdue),
      item.kind === 'ACTIVE' ? formatMoney(outstanding) : '',
      item.peak?.invoiceCode ?? '',
      item.peak ? formatMoney(item.peak.remain) : '',
      '',
      '',
    ]);
  }
  return csvText(
    [
      'legacy_code',
      'kind',
      'status',
      'old_form',
      'contract_date',
      'total_months',
      'paid_installments',
      'overdue_installments',
      'outstanding',
      'peak_invoice_code',
      'peak_remain',
      'checked',
      'note',
    ],
    rows,
  );
}

/**
 * ชนิดของข้อเตือน (ข้อความจาก `payments.ts` / `plan-import.ts`) — "ยอดจ่ายของงวดมากกว่าใบรับเงิน" ของสัญญาที่ปรับยอดตาม PEAK
 * แยกเป็น `PAID_ABOVE_RECEIPTS_PEAK_ADJUSTED` (ยอดจ่ายเพิ่มมาจาก PEAK ไม่ใช่ระบบเก่าผิด — carry ของ Task 5)
 */
export function warningKind(message: string, item: PlannedContract): string {
  if (message.includes('มียอดจ่ายในระบบเก่าแต่ไม่มีใบรับเงิน')) return 'PAID_WITHOUT_RECEIPT';
  if (message.includes('มากกว่ายอดจ่ายของงวด')) return 'RECEIPTS_ABOVE_PAID';
  if (message.includes('มากกว่าใบรับเงิน')) {
    return item.peak && !item.peak.adjustment.isZero()
      ? 'PAID_ABOVE_RECEIPTS_PEAK_ADJUSTED'
      : 'PAID_ABOVE_RECEIPTS';
  }
  if (message.includes('ชี้งวดที่ไม่มีในสัญญา')) return 'RECEIPT_UNKNOWN_INSTALLMENT';
  if (message.includes('ไม่มียอดค่างวด')) return 'RECEIPT_WITHOUT_INSTALLMENT_AMOUNT';
  if (message.includes('เบอร์')) return 'PHONE_INVALID';
  if (message.includes('ไม่มี IMEI')) return 'NO_IMEI';
  if (message.includes('product_type')) return 'PRODUCT_TYPE';
  if (message.includes('IMEI ไม่ตรงกัน')) return 'PEAK_PAIR_IMEI_MISMATCH';
  if (message.includes('ยอดคงเหลือติดลบ')) return 'HISTORY_PEAK_NEGATIVE';
  return 'OTHER';
}

/** ข้อเตือนทุกสัญญาในแผน + ชนิด */
export function planWarnings(
  plan: ImportPlan,
): Array<{ code: string; kind: string; message: string }> {
  return plan.items.flatMap((item) =>
    item.warnings.map((message) => ({
      code: item.code,
      kind: warningKind(message, item),
      message,
    })),
  );
}

/** `warnings.csv` — ข้อเตือน (ไม่ใช่ตัวบล็อก) เรียงตามเลขสัญญา */
export function warningsCsv(plan: ImportPlan): string {
  return csvText(
    ['legacy_code', 'kind', 'message'],
    planWarnings(plan)
      .sort((a, b) => byCodeAsc(a.code, b.code))
      .map((w) => [w.code, w.kind, w.message]),
  );
}

/**
 * `missing-files.csv` — path ไฟล์แนบ/สลิปที่หาไม่เจอ (`missing`) หรืออ่าน/อัปโหลดไม่สำเร็จ (`failed`) + เลขสัญญาที่อ้างถึง ·
 * มีแค่ path (ชื่อไฟล์สุ่ม) ไม่มีเนื้อไฟล์
 */
export function missingFilesCsv(
  plan: ImportPlan,
  upload: Pick<LegacyFileUploadResult, 'missing' | 'failed'>,
): string {
  const codesOf = new Map<string, string[]>();
  for (const item of plan.items) {
    for (const path of item.attachmentPaths) {
      const list = codesOf.get(path);
      if (list) list.push(item.code);
      else codesOf.set(path, [item.code]);
    }
  }
  const codes = (path: string) => (codesOf.get(path) ?? []).sort(byCodeAsc).join(' ');
  return csvText(
    ['status', 'path', 'reason', 'legacy_codes'],
    [
      ...upload.missing.map((path) => ['missing', path, '', codes(path)]),
      ...upload.failed.map((f) => ['failed', f.path, f.reason, codes(f.path)]),
    ],
  );
}

/**
 * `gate-failures.csv` — ด่านที่ไม่ผ่าน หนึ่งแถวต่อสัญญาที่ด่านชี้ (`failures`) · ด่านที่ไม่มีรายสัญญา = หนึ่งแถวไม่มีเลขสัญญา ·
 * `detail` มาจาก `gates.ts` (รหัส/ยอดเท่านั้น)
 */
export function gateFailuresCsv(gates: readonly GateResult[]): string {
  const rows: string[][] = [];
  for (const g of gates) {
    if (g.pass) continue;
    const failures = g.failures ?? [];
    if (failures.length === 0) rows.push([g.id, GATE_LABELS[g.id], '', g.detail]);
    for (const f of failures) rows.push([g.id, GATE_LABELS[g.id], f.code, f.detail]);
  }
  return csvText(['gate', 'label', 'legacy_code', 'detail'], rows);
}
