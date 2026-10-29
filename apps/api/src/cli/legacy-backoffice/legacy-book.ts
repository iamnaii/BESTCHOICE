import { Prisma } from '@prisma/client';
import { bangkokDateString, bangkokMidnight } from '../../utils/date.util';
import type { DumpRow, DumpTables } from './dump-reader';

/**
 * จัดกลุ่มแถวของ dump ระบบเก่า (backoffice) เป็นรายสัญญา — ฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล
 *
 * การเชื่อมตาราง: `contract.ref_order` = `order_product.order_id` = `order_product_detail.ref_order_id`
 * · งวด `order_product_installment.ref_contract_id` · รับเงิน `payment_installment.ref_contract` +
 * `ref_installmemnt` (สะกดตามของจริง) · ปิดก่อนกำหนด `contract_close.ref_contract`
 * · รูป/ไฟล์ของคำสั่งซื้อ `ref_order` · ไฟล์ของสัญญา (`contract_file`) `ref_contract`
 *
 * - วันที่ในระบบเก่าเป็นเวลากรุงเทพไม่มี timezone → อ่านเป็น +07:00 · ปี > 2400 = พ.ศ. → ลบ 543 + ลง `anomalies`
 * - จำนวนเงินเป็น `Prisma.Decimal` ตามที่ dump เขียน ไม่ปัด (ช่องว่าง = 0)
 * - รับเงินที่ `status = '0'` ถูกลบในระบบเก่าแล้ว ไม่อยู่ใน `receipts`
 * - แถวลูกที่อ้างสัญญาที่ไม่มี (รวม NULL / 0) ไม่ถูกอ่านค่า → ลง `anomalies` เป็นกลุ่มพร้อมจำนวนแถว
 * - ข้อมูลของสัญญาที่โครงสร้างนี้แทนไม่ได้ (คอลัมน์ไม่มี, ไม่มีคำสั่งซื้อ, เลขสัญญาซ้ำ, วันที่ผิดรูป) = throw
 *   ข้อความบอกตาราง คอลัมน์ และรหัสแถว ไม่มีค่าในแถว (dump มีข้อมูลส่วนบุคคล)
 */

type Decimal = Prisma.Decimal;

/** ชนิดไฟล์แนบ = ชื่อตารางที่ตัด `bestchoice_order_product_` / `bestchoice_` ออก */
export type LegacyFileKind =
  | 'img_contract'
  | 'img_facebook'
  | 'img_income'
  | 'img_line'
  | 'img_lock'
  | 'img_receive'
  | 'img_selfie'
  | 'order_product_file'
  | 'contract_file';

/** งวดของสัญญา — `installments` เรียงตาม `dueDate` ลำดับในอาร์เรย์ = งวดที่ 1..n */
export type LegacyInstallment = {
  legacyId: string;
  legacyCode: string;
  dueDate: Date;
  amount: Decimal;
  paid: Decimal;
  balance: Decimal;
  statusCode: string;
};

/**
 * รายการรับเงินที่ใช้ได้ (`status = '1'`) · `date` = วันโอน · `createdAt` = วันที่บันทึก
 * · `installmentLegacyId` ว่าง หรือไม่ใช่งวดของสัญญานี้ = ลง `anomalies` (รายการยังอยู่ใน `receipts`)
 */
export type LegacyReceipt = {
  legacyId: string;
  installmentLegacyId: string;
  date: Date;
  amount: Decimal;
  installment: Decimal;
  mulct: Decimal;
  discount: Decimal;
  slipPath: string | null;
  createdAt: Date;
};

export type LegacyContract = {
  contractId: string;
  /** `contract_code` · สัญญาสถานะ 0 ที่ไม่มีเลข = `contract_id=<id>` (ลง `anomalies`) */
  code: string;
  /** `contract_status` ตามระบบเก่า */
  statusCode: string;
  /** `contract.created_at` = วันที่ทำสัญญา · สัญญาสถานะ 0 ที่ไม่มีค่า = วันที่สร้างคำสั่งซื้อ (ลง `anomalies`) */
  createdAt: Date;
  order: DumpRow;
  detail: DumpRow;
  installments: LegacyInstallment[];
  receipts: LegacyReceipt[];
  close: { amount: Decimal; discount: Decimal; createdAt: Date } | null;
  files: { kind: LegacyFileKind; path: string }[];
};

export type LegacyBook = {
  contracts: LegacyContract[];
  /** ลูกค้าตาม `member_master.member_id` (= `order_product.ref_member`) */
  members: Map<string, DumpRow>;
  anomalies: string[];
};

const TABLE = {
  contract: 'bestchoice_contract',
  order: 'bestchoice_order_product',
  detail: 'bestchoice_order_product_detail',
  installment: 'bestchoice_order_product_installment',
  receipt: 'bestchoice_payment_installment',
  member: 'bestchoice_member_master',
  close: 'bestchoice_contract_close',
} as const;

/** ไฟล์แนบ — `owner` = คอลัมน์ที่อ้างถึง (`file_name` = path ทุกตาราง) */
const FILE_TABLES: readonly {
  table: string;
  kind: LegacyFileKind;
  owner: 'ref_order' | 'ref_contract';
}[] = [
  { table: 'bestchoice_order_product_img_contract', kind: 'img_contract', owner: 'ref_order' },
  { table: 'bestchoice_order_product_img_facebook', kind: 'img_facebook', owner: 'ref_order' },
  { table: 'bestchoice_order_product_img_income', kind: 'img_income', owner: 'ref_order' },
  { table: 'bestchoice_order_product_img_line', kind: 'img_line', owner: 'ref_order' },
  { table: 'bestchoice_order_product_img_lock', kind: 'img_lock', owner: 'ref_order' },
  { table: 'bestchoice_order_product_img_receive', kind: 'img_receive', owner: 'ref_order' },
  { table: 'bestchoice_order_product_img_selfie', kind: 'img_selfie', owner: 'ref_order' },
  { table: 'bestchoice_order_product_file', kind: 'order_product_file', owner: 'ref_order' },
  { table: 'bestchoice_contract_file', kind: 'contract_file', owner: 'ref_contract' },
];
const FILE_PATH = 'file_name';

/** ตารางที่ต้องอ่านจาก dump — ส่งให้ `readDumpTables(path, LEGACY_TABLES)` */
export const LEGACY_TABLES: readonly string[] = [
  ...Object.values(TABLE),
  ...FILE_TABLES.map((f) => f.table),
];

/** ชื่อคอลัมน์จริงตาม CREATE TABLE ของ dump 29/10 */
const COL = {
  contract: {
    id: 'contract_id',
    code: 'contract_code',
    order: 'ref_order',
    status: 'contract_status',
    createdAt: 'created_at',
  },
  order: { id: 'order_id', createdAt: 'created_at' },
  detail: { order: 'ref_order_id' },
  member: { id: 'member_id' },
  installment: {
    id: 'ins_id',
    code: 'ins_payment_code',
    contract: 'ref_contract_id',
    dueDate: 'ins_due_date',
    amount: 'ins_amount',
    paid: 'ins_paid',
    balance: 'ins_balance',
    status: 'ins_status',
  },
  receipt: {
    id: 'id',
    contract: 'ref_contract',
    installmentRef: 'ref_installmemnt',
    status: 'status',
    date: 'date',
    createdAt: 'created_at',
    amount: 'amount',
    installmentAmount: 'installment',
    mulct: 'mulct',
    discount: 'discount',
    slip: 'slip',
  },
  close: {
    contract: 'ref_contract',
    amount: 'amount',
    discount: 'discount',
    createdAt: 'created_at',
  },
} as const;

const ERROR_PREFIX = 'อ่านข้อมูลระบบเก่าไม่ได้';
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

/** คอลัมน์ที่ต้องใช้ต้องมีในตาราง ไม่งั้น throw พร้อมรายชื่อคอลัมน์ที่มีจริง (ตารางว่างไม่ต้องตรวจ) */
function requireColumns(table: string, rows: readonly DumpRow[], columns: readonly string[]): void {
  if (rows.length === 0) return;
  const present = Object.keys(rows[0]);
  const missing = columns.filter((c) => !present.includes(c));
  if (missing.length > 0) {
    throw new Error(
      `${ERROR_PREFIX}: ตาราง \`${table}\` ไม่มีคอลัมน์ ${missing.join(', ')} — คอลัมน์ที่มี: ${present.join(', ')}`,
    );
  }
}

/** อ่านค่าในแถวพร้อมบอกตำแหน่งเมื่ออ่านไม่ได้ (ตาราง + รหัสแถว + คอลัมน์ ไม่มีค่า) */
class RowReader {
  readonly label: string;

  constructor(
    private readonly table: string,
    private readonly row: DumpRow,
    labelColumn: string,
    private readonly anomalies: string[],
  ) {
    this.label = `${labelColumn}=${row[labelColumn] ?? 'NULL'}`;
  }

  fail(column: string, what: string): Error {
    return new Error(
      `${ERROR_PREFIX}: ตาราง \`${this.table}\` แถว ${this.label} ช่อง ${column} — ${what}`,
    );
  }

  optionalText(column: string): string | null {
    const value = this.row[column]?.trim();
    return value ? value : null;
  }

  text(column: string): string {
    const value = this.optionalText(column);
    if (value === null) throw this.fail(column, 'ไม่มีค่า');
    return value;
  }

  money(column: string): Decimal {
    const raw = this.optionalText(column);
    if (raw === null) return new Prisma.Decimal(0);
    let value: Decimal;
    try {
      value = new Prisma.Decimal(raw);
    } catch {
      throw this.fail(column, 'จำนวนเงินผิดรูปแบบ');
    }
    if (!value.isFinite()) throw this.fail(column, 'จำนวนเงินผิดรูปแบบ');
    return value;
  }

  /** วันเวลากรุงเทพไม่มี timezone (`YYYY-MM-DD` หรือ `YYYY-MM-DD HH:MM:SS`) → instant */
  date(column: string): Date {
    const raw = this.optionalText(column);
    if (raw === null || raw.startsWith('0000-00-00')) throw this.fail(column, 'ไม่มีวันที่');
    const match = DATE_PATTERN.exec(raw);
    if (!match) throw this.fail(column, 'วันที่ผิดรูปแบบ');
    const [, y, mo, d, h = '0', mi = '0', s = '0'] = match;
    let year = Number(y);
    if (year > 2400) {
      this.anomalies.push(
        `\`${this.table}\` ${this.label}: ช่อง ${column} ลงปี พ.ศ. ${year} — อ่านเป็น ค.ศ. ${year - 543}`,
      );
      year -= 543;
    }
    const [hour, minute, second] = [Number(h), Number(mi), Number(s)];
    const instant = new Date(
      bangkokMidnight(year, Number(mo) - 1, Number(d)).getTime() +
        ((hour * 60 + minute) * 60 + second) * 1000,
    );
    const sameDay = bangkokDateString(instant) === `${String(year).padStart(4, '0')}-${mo}-${d}`;
    if (!sameDay || hour > 23 || minute > 59 || second > 59) {
      throw this.fail(column, 'วันที่ไม่มีจริง');
    }
    return instant;
  }
}

/** จัดแถวเป็นกลุ่มตามค่าในคอลัมน์ — ค่าว่าง/NULL ได้คีย์ `''` */
function groupBy(rows: readonly DumpRow[], column: string): Map<string, DumpRow[]> {
  const groups = new Map<string, DumpRow[]>();
  for (const row of rows) {
    const key = row[column]?.trim() ?? '';
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/** เรียงรหัสแถวเป็นตัวเลขเมื่อเป็นตัวเลขทั้งคู่ (`'9'` ก่อน `'10'`) */
function compareIds(a: string, b: string): number {
  const [na, nb] = [Number(a), Number(b)];
  if (Number.isInteger(na) && Number.isInteger(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** จัดกลุ่มตาราง `LEGACY_TABLES` (ผลของ `readDumpTables`) เป็นรายสัญญา */
export function buildLegacyBook(t: DumpTables): LegacyBook {
  const anomalies: string[] = [];
  const rowsOf = (table: string, columns: Record<string, string>): DumpRow[] => {
    const rows = t[table];
    if (!rows) throw new Error(`${ERROR_PREFIX}: ไม่มีตาราง \`${table}\` (อ่านด้วย LEGACY_TABLES)`);
    requireColumns(table, rows, Object.values(columns));
    return rows;
  };
  const reader = (table: string, row: DumpRow, labelColumn: string) =>
    new RowReader(table, row, labelColumn, anomalies);

  const orders = new Map(
    rowsOf(TABLE.order, COL.order).map((row) => [row[COL.order.id] ?? '', row]),
  );
  const members = new Map(
    rowsOf(TABLE.member, COL.member).map((row) => [row[COL.member.id] ?? '', row]),
  );
  const detailsByOrder = groupBy(rowsOf(TABLE.detail, COL.detail), COL.detail.order);
  const installmentsByContract = groupBy(
    rowsOf(TABLE.installment, COL.installment),
    COL.installment.contract,
  );
  const closesByContract = groupBy(rowsOf(TABLE.close, COL.close), COL.close.contract);

  const validReceipts = rowsOf(TABLE.receipt, COL.receipt).filter((row) => {
    const status = row[COL.receipt.status];
    if (status === '0') return false; // ถูกลบในระบบเก่า
    if (status === '1') return true;
    anomalies.push(
      `\`${TABLE.receipt}\` ${COL.receipt.id}=${row[COL.receipt.id]}: สถานะ ${status ?? 'NULL'} ไม่ใช่ 0/1 — ไม่นำเข้า`,
    );
    return false;
  });
  const receiptsByContract = groupBy(validReceipts, COL.receipt.contract);

  // รูป/ไฟล์ของคำสั่งซื้อที่ไม่ได้ทำสัญญา (ไม่อนุมัติ/ยกเลิก) เป็นเรื่องปกติ — ไม่ลง anomalies
  const filesByOwner = {
    ref_order: new Map<string, LegacyContract['files']>(),
    ref_contract: new Map<string, LegacyContract['files']>(),
  };
  for (const { table, kind, owner } of FILE_TABLES) {
    for (const row of rowsOf(table, { owner, path: FILE_PATH })) {
      const ownerId = row[owner]?.trim();
      const path = row[FILE_PATH]?.trim();
      if (!ownerId || !path) continue;
      const files = filesByOwner[owner].get(ownerId);
      if (files) files.push({ kind, path });
      else filesByOwner[owner].set(ownerId, [{ kind, path }]);
    }
  }

  const readInstallment = (row: DumpRow): LegacyInstallment => {
    const r = reader(TABLE.installment, row, COL.installment.id);
    const legacyId = r.text(COL.installment.id);
    return {
      legacyId,
      // ins_payment_code เป็น NULL ได้ใน schema จริง → ใช้ ins_id แทน (ยังไม่ซ้ำภายในตาราง)
      legacyCode: r.optionalText(COL.installment.code) ?? legacyId,
      dueDate: r.date(COL.installment.dueDate),
      amount: r.money(COL.installment.amount),
      paid: r.money(COL.installment.paid),
      balance: r.money(COL.installment.balance),
      statusCode: r.text(COL.installment.status),
    };
  };

  const readReceipt = (row: DumpRow): LegacyReceipt => {
    const r = reader(TABLE.receipt, row, COL.receipt.id);
    return {
      legacyId: r.text(COL.receipt.id),
      installmentLegacyId: r.optionalText(COL.receipt.installmentRef) ?? '',
      date: r.date(COL.receipt.date),
      amount: r.money(COL.receipt.amount),
      installment: r.money(COL.receipt.installmentAmount),
      mulct: r.money(COL.receipt.mulct),
      discount: r.money(COL.receipt.discount),
      slipPath: r.optionalText(COL.receipt.slip),
      createdAt: r.date(COL.receipt.createdAt),
    };
  };

  const codes = new Set<string>();
  const contracts = rowsOf(TABLE.contract, COL.contract).map((row): LegacyContract => {
    const r = reader(TABLE.contract, row, COL.contract.id);
    const contractId = r.text(COL.contract.id);
    const statusCode = r.text(COL.contract.status);
    // สัญญาสถานะ 0 (ไม่มีสถานะ — classify ให้ SKIP 'status-0') ที่ไม่มีเลขสัญญาหรือวันที่ ไม่ throw:
    // ลง anomalies แล้วใช้ค่าแทน (คำตัดสินผู้คุมงาน 29/10) · สถานะอื่นยังเคร่งเหมือนเดิม
    const lenient = statusCode === '0';

    const orderId = r.text(COL.contract.order);
    const order = orders.get(orderId);
    if (!order) throw r.fail(COL.contract.order, `ไม่พบ \`${TABLE.order}\` order_id=${orderId}`);
    const details = detailsByOrder.get(orderId) ?? [];
    if (details.length !== 1) {
      throw r.fail(
        COL.contract.order,
        `\`${TABLE.detail}\` ของคำสั่งซื้อนี้มี ${details.length} แถว (ต้องมี 1)`,
      );
    }

    let code = r.optionalText(COL.contract.code);
    if (code === null) {
      if (!lenient) throw r.fail(COL.contract.code, 'ไม่มีค่า');
      code = `${COL.contract.id}=${contractId}`;
      anomalies.push(`\`${TABLE.contract}\` ${r.label}: สถานะ 0 ไม่มีเลขสัญญา — ใช้ "${code}"`);
    }
    if (codes.has(code)) throw r.fail(COL.contract.code, `เลขสัญญาซ้ำ ${code}`);
    codes.add(code);

    let createdAt: Date;
    if (lenient && r.optionalText(COL.contract.createdAt) === null) {
      createdAt = reader(TABLE.order, order, COL.order.id).date(COL.order.createdAt);
      anomalies.push(
        `\`${TABLE.contract}\` ${r.label}: สถานะ 0 ไม่มี created_at — ใช้วันที่สร้างคำสั่งซื้อ`,
      );
    } else {
      createdAt = r.date(COL.contract.createdAt);
    }

    const installments = (installmentsByContract.get(contractId) ?? [])
      .map(readInstallment)
      .sort(
        (a, b) => a.dueDate.getTime() - b.dueDate.getTime() || compareIds(a.legacyId, b.legacyId),
      );
    const installmentIds = new Set(installments.map((i) => i.legacyId));
    const receipts = (receiptsByContract.get(contractId) ?? []).map(readReceipt);
    for (const receipt of receipts) {
      if (!installmentIds.has(receipt.installmentLegacyId)) {
        anomalies.push(
          `\`${TABLE.receipt}\` ${COL.receipt.id}=${receipt.legacyId}: ${COL.receipt.installmentRef}=${receipt.installmentLegacyId || 'NULL'} ไม่ใช่งวดของสัญญา ${code}`,
        );
      }
    }

    const closeRows = closesByContract.get(contractId) ?? [];
    if (closeRows.length > 1) {
      throw r.fail(
        COL.contract.id,
        `\`${TABLE.close}\` มี ${closeRows.length} แถวของสัญญานี้ (ต้องไม่เกิน 1)`,
      );
    }
    const close = closeRows.map((closeRow) => {
      const c = reader(TABLE.close, closeRow, COL.close.contract);
      return {
        amount: c.money(COL.close.amount),
        discount: c.money(COL.close.discount),
        createdAt: c.date(COL.close.createdAt),
      };
    })[0];

    return {
      contractId,
      code,
      statusCode,
      createdAt,
      order,
      detail: details[0],
      installments,
      receipts,
      close: close ?? null,
      files: [
        ...(filesByOwner.ref_order.get(orderId) ?? []),
        ...(filesByOwner.ref_contract.get(contractId) ?? []),
      ],
    };
  });

  // แถวลูกที่อ้างสัญญาที่ไม่มี (รวม NULL/0) — ไม่ได้อ่านค่า ไม่นำเข้า ลงเป็นกลุ่ม
  const contractIds = new Set(contracts.map((c) => c.contractId));
  const orphans: [string, string, Map<string, unknown[]>, string][] = [
    [TABLE.installment, COL.installment.contract, installmentsByContract, 'งวด'],
    [TABLE.receipt, COL.receipt.contract, receiptsByContract, 'รายการรับเงิน'],
    [TABLE.close, COL.close.contract, closesByContract, 'รายการปิดก่อนกำหนด'],
    ['bestchoice_contract_file', 'ref_contract', filesByOwner.ref_contract, 'ไฟล์สัญญา'],
  ];
  for (const [table, column, groups, what] of orphans) {
    for (const [contractId, rows] of groups) {
      if (contractIds.has(contractId)) continue;
      anomalies.push(
        `\`${table}\` ${column}=${contractId || 'NULL'}: ไม่พบสัญญา — ${what} ${rows.length} แถวไม่นำเข้า`,
      );
    }
  }

  return { contracts, members, anomalies };
}
