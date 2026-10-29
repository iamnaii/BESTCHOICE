import { Prisma } from '@prisma/client';
import { bangkokDateString, bangkokMidnight } from '../../utils/date.util';
import type { DumpRow, DumpTables } from './dump-reader';

/**
 * จัดกลุ่มแถวของ dump ระบบเก่า (backoffice) เป็นรายสัญญา — ฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล
 *
 * การเชื่อมตาราง: `contract.ref_order` = `order_product.order_id` = `order_product_detail.ref_order_id`
 * · งวด `order_product_installment.ref_contract_id` · รับเงิน `payment_installment.ref_contract` +
 * `ref_installmemnt` (สะกดตามของจริง) · ปิดก่อนกำหนด `contract_close.ref_contract` · ไฟล์แนบอ้างคำสั่งซื้อ
 *
 * - วันที่ในระบบเก่าเป็นเวลากรุงเทพไม่มี timezone → อ่านเป็น +07:00 · ปี > 2400 = พ.ศ. → ลบ 543 + ลง `anomalies`
 * - จำนวนเงินเป็น `Prisma.Decimal` ตามที่ dump เขียน ไม่ปัด (ช่องว่าง = 0)
 * - รับเงินที่ `status = '0'` ถูกลบในระบบเก่าแล้ว ไม่อยู่ใน `receipts`
 * - แถวที่อ้างสัญญา/งวดที่ไม่มี → ลง `anomalies` (ไม่ทิ้งเงียบ)
 * - ข้อมูลที่โครงสร้างนี้แทนไม่ได้ (คอลัมน์ไม่มี, สัญญาไม่มีคำสั่งซื้อ, เลขสัญญาซ้ำ, วันที่ผิดรูป) = throw
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
  code: string;
  /** `contract_status` ตามระบบเก่า · ไม่มีสถานะ (NULL/ว่าง) = `'0'` */
  statusCode: string;
  /** `contract.created_at` = วันที่ทำสัญญา */
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
  /** ลูกค้าตาม id ของ `member_master` (= `order_product.ref_member`) */
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

const FILE_TABLES: readonly { table: string; kind: LegacyFileKind }[] = [
  { table: 'bestchoice_order_product_img_contract', kind: 'img_contract' },
  { table: 'bestchoice_order_product_img_facebook', kind: 'img_facebook' },
  { table: 'bestchoice_order_product_img_income', kind: 'img_income' },
  { table: 'bestchoice_order_product_img_line', kind: 'img_line' },
  { table: 'bestchoice_order_product_img_lock', kind: 'img_lock' },
  { table: 'bestchoice_order_product_img_receive', kind: 'img_receive' },
  { table: 'bestchoice_order_product_img_selfie', kind: 'img_selfie' },
  { table: 'bestchoice_order_product_file', kind: 'order_product_file' },
  { table: 'bestchoice_contract_file', kind: 'contract_file' },
];

/** ตารางที่ต้องอ่านจาก dump — ส่งให้ `readDumpTables(path, LEGACY_TABLES)` */
export const LEGACY_TABLES: readonly string[] = [
  ...Object.values(TABLE),
  ...FILE_TABLES.map((f) => f.table),
];

/**
 * ชื่อคอลัมน์ที่ยอมรับ ใช้ชื่อแรกที่ตารางมี — ช่องที่มีชื่อเดียวตรวจกับ dump จริงแล้ว ช่องที่มีหลายชื่อยังไม่ได้ตรวจ
 * ไม่มีสักชื่อ = throw พร้อมรายชื่อคอลัมน์ที่ตารางมีจริง ⇒ เติมชื่อที่ถูกตรงนี้ที่เดียว
 */
const COLUMNS = {
  contract: {
    id: ['contract_id', 'id'],
    code: ['contract_code'],
    order: ['ref_order'],
    status: ['contract_status'],
    createdAt: ['created_at'],
  },
  order: { id: ['order_id'] },
  detail: { order: ['ref_order_id'] },
  member: { id: ['member_id', 'id'] },
  installment: {
    id: ['ins_id', 'installment_id', 'id'],
    code: ['ins_code', 'installment_code', 'code'],
    contract: ['ref_contract_id'],
    dueDate: ['ins_due_date'],
    amount: ['ins_amount'],
    paid: ['ins_paid'],
    balance: ['ins_balance'],
    status: ['ins_status'],
  },
  receipt: {
    id: ['payment_id', 'id'],
    contract: ['ref_contract'],
    installmentRef: ['ref_installmemnt'],
    status: ['status'],
    date: ['date'],
    createdAt: ['created_at'],
    amount: ['amount', 'payment_amount'],
    installmentAmount: ['installment', 'installment_amount'],
    mulct: ['mulct', 'mulct_amount'],
    discount: ['discount', 'discount_amount'],
    slip: ['slip', 'slip_img', 'slip_image', 'img_slip', 'payment_slip', 'image', 'img', 'file'],
  },
  close: {
    contract: ['ref_contract'],
    amount: ['amount', 'close_amount', 'total'],
    discount: ['discount', 'close_discount', 'discount_amount'],
    createdAt: ['created_at'],
  },
} as const;

/** คอลัมน์ path ของไฟล์แนบ — ชื่อต่างกันในแต่ละตาราง */
function fileColumns(kind: LegacyFileKind) {
  return {
    order: ['ref_order_id', 'ref_order'],
    path: [
      kind,
      `${kind}_name`,
      `${kind}_path`,
      'img',
      'image',
      'img_name',
      'image_name',
      'img_path',
      'image_path',
      'img_url',
      'file',
      'file_name',
      'file_path',
      'filename',
      'file_url',
      'path',
    ],
  } as const;
}

const ERROR_PREFIX = 'อ่านข้อมูลระบบเก่าไม่ได้';
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

/** เลือกชื่อคอลัมน์จริงของแต่ละช่อง — ตารางว่างไม่มีแถวให้อ่าน จึงใช้ชื่อแรก */
function resolveColumns<S extends Record<string, readonly string[]>>(
  table: string,
  rows: readonly DumpRow[],
  spec: S,
): { [K in keyof S]: string } {
  const present = rows.length > 0 ? Object.keys(rows[0]) : null;
  const resolved = {} as { [K in keyof S]: string };
  for (const key of Object.keys(spec) as (keyof S)[]) {
    const candidates = spec[key];
    const found = present ? candidates.find((c) => present.includes(c)) : candidates[0];
    if (!found) {
      throw new Error(
        `${ERROR_PREFIX}: ตาราง \`${table}\` ไม่มีคอลัมน์ ${candidates.join(' / ')} — คอลัมน์ที่มี: ${present?.join(', ')}`,
      );
    }
    resolved[key] = found;
  }
  return resolved;
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
    if (!sameDay || hour > 23 || minute > 59 || second > 59)
      throw this.fail(column, 'วันที่ไม่มีจริง');
    return instant;
  }
}

function push<V>(map: Map<string, V[]>, key: string, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
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
  const rowsOf = (table: string): DumpRow[] => {
    const rows = t[table];
    if (!rows) throw new Error(`${ERROR_PREFIX}: ไม่มีตาราง \`${table}\` (อ่านด้วย LEGACY_TABLES)`);
    return rows;
  };

  const orderRows = rowsOf(TABLE.order);
  const orderCol = resolveColumns(TABLE.order, orderRows, COLUMNS.order);
  const orders = new Map(
    orderRows.map((row) => [
      new RowReader(TABLE.order, row, orderCol.id, anomalies).text(orderCol.id),
      row,
    ]),
  );

  const detailRows = rowsOf(TABLE.detail);
  const detailCol = resolveColumns(TABLE.detail, detailRows, COLUMNS.detail);
  const detailByOrder = new Map<string, DumpRow>();
  for (const row of detailRows) {
    const r = new RowReader(TABLE.detail, row, detailCol.order, anomalies);
    const orderId = r.text(detailCol.order);
    if (detailByOrder.has(orderId))
      throw r.fail(detailCol.order, 'คำสั่งซื้อมีรายละเอียดสินค้ามากกว่า 1 แถว');
    detailByOrder.set(orderId, row);
  }

  const memberRows = rowsOf(TABLE.member);
  const memberCol = resolveColumns(TABLE.member, memberRows, COLUMNS.member);
  const members = new Map(
    memberRows.map((row) => [
      new RowReader(TABLE.member, row, memberCol.id, anomalies).text(memberCol.id),
      row,
    ]),
  );

  const installmentRows = rowsOf(TABLE.installment);
  const insCol = resolveColumns(TABLE.installment, installmentRows, COLUMNS.installment);
  const installmentsByContract = new Map<string, LegacyInstallment[]>();
  for (const row of installmentRows) {
    const r = new RowReader(TABLE.installment, row, insCol.id, anomalies);
    push(installmentsByContract, r.text(insCol.contract), {
      legacyId: r.text(insCol.id),
      legacyCode: r.text(insCol.code),
      dueDate: r.date(insCol.dueDate),
      amount: r.money(insCol.amount),
      paid: r.money(insCol.paid),
      balance: r.money(insCol.balance),
      statusCode: r.text(insCol.status),
    });
  }

  const receiptRows = rowsOf(TABLE.receipt);
  const recCol = resolveColumns(TABLE.receipt, receiptRows, COLUMNS.receipt);
  const receiptsByContract = new Map<string, LegacyReceipt[]>();
  for (const row of receiptRows) {
    const r = new RowReader(TABLE.receipt, row, recCol.id, anomalies);
    const status = row[recCol.status];
    if (status === '0') continue; // ถูกลบในระบบเก่า
    if (status !== '1') {
      anomalies.push(
        `\`${TABLE.receipt}\` ${r.label}: สถานะ ${status ?? 'NULL'} ไม่ใช่ 0/1 — ไม่นำเข้า`,
      );
      continue;
    }
    push(receiptsByContract, r.text(recCol.contract), {
      legacyId: r.text(recCol.id),
      installmentLegacyId: r.optionalText(recCol.installmentRef) ?? '',
      date: r.date(recCol.date),
      amount: r.money(recCol.amount),
      installment: r.money(recCol.installmentAmount),
      mulct: r.money(recCol.mulct),
      discount: r.money(recCol.discount),
      slipPath: r.optionalText(recCol.slip),
      createdAt: r.date(recCol.createdAt),
    });
  }

  const closeRows = rowsOf(TABLE.close);
  const closeCol = resolveColumns(TABLE.close, closeRows, COLUMNS.close);
  const closeByContract = new Map<string, NonNullable<LegacyContract['close']>>();
  for (const row of closeRows) {
    const r = new RowReader(TABLE.close, row, closeCol.contract, anomalies);
    const contractId = r.text(closeCol.contract);
    if (closeByContract.has(contractId))
      throw r.fail(closeCol.contract, 'สัญญามีรายการปิดก่อนกำหนดมากกว่า 1 แถว');
    closeByContract.set(contractId, {
      amount: r.money(closeCol.amount),
      discount: r.money(closeCol.discount),
      createdAt: r.date(closeCol.createdAt),
    });
  }

  // แถวไฟล์ของคำสั่งซื้อที่ไม่ได้ทำสัญญา (ไม่อนุมัติ/ยกเลิก) เป็นเรื่องปกติ — ไม่ลง anomalies
  const filesByOrder = new Map<string, LegacyContract['files']>();
  for (const { table, kind } of FILE_TABLES) {
    const rows = rowsOf(table);
    const fileCol = resolveColumns(table, rows, fileColumns(kind));
    for (const row of rows) {
      const orderId = row[fileCol.order]?.trim();
      const path = row[fileCol.path]?.trim();
      if (orderId && path) push(filesByOrder, orderId, { kind, path });
    }
  }

  const contractRows = rowsOf(TABLE.contract);
  const conCol = resolveColumns(TABLE.contract, contractRows, COLUMNS.contract);
  const codes = new Set<string>();
  const contracts = contractRows.map((row): LegacyContract => {
    const r = new RowReader(TABLE.contract, row, conCol.id, anomalies);
    const contractId = r.text(conCol.id);
    const code = r.text(conCol.code);
    if (codes.has(code)) throw r.fail(conCol.code, `เลขสัญญาซ้ำ ${code}`);
    codes.add(code);
    const orderId = r.text(conCol.order);
    const order = orders.get(orderId);
    if (!order) throw r.fail(conCol.order, `ไม่พบ \`${TABLE.order}\` ${orderCol.id}=${orderId}`);
    const detail = detailByOrder.get(orderId);
    if (!detail)
      throw r.fail(conCol.order, `ไม่พบ \`${TABLE.detail}\` ${detailCol.order}=${orderId}`);

    const installments = (installmentsByContract.get(contractId) ?? []).sort(
      (a, b) => a.dueDate.getTime() - b.dueDate.getTime() || compareIds(a.legacyId, b.legacyId),
    );
    const installmentIds = new Set(installments.map((i) => i.legacyId));
    const receipts = receiptsByContract.get(contractId) ?? [];
    for (const receipt of receipts) {
      if (!installmentIds.has(receipt.installmentLegacyId)) {
        anomalies.push(
          `\`${TABLE.receipt}\` ${recCol.id}=${receipt.legacyId}: ${recCol.installmentRef}=${receipt.installmentLegacyId || 'NULL'} ไม่ใช่งวดของสัญญา ${code}`,
        );
      }
    }

    return {
      contractId,
      code,
      statusCode: r.optionalText(conCol.status) ?? '0',
      createdAt: r.date(conCol.createdAt),
      order,
      detail,
      installments,
      receipts,
      close: closeByContract.get(contractId) ?? null,
      files: filesByOrder.get(orderId) ?? [],
    };
  });

  const contractIds = new Set(contracts.map((c) => c.contractId));
  const orphan = (table: string, column: string, contractId: string, what: string) => {
    if (!contractIds.has(contractId)) {
      anomalies.push(`\`${table}\` ${column}=${contractId}: ไม่พบสัญญา — ${what}ไม่นำเข้า`);
    }
  };
  for (const [id, rows] of installmentsByContract) {
    orphan(TABLE.installment, insCol.contract, id, `งวด ${rows.length} แถว`);
  }
  for (const [id, rows] of receiptsByContract) {
    orphan(TABLE.receipt, recCol.contract, id, `รายการรับเงิน ${rows.length} แถว`);
  }
  for (const id of closeByContract.keys()) {
    orphan(TABLE.close, closeCol.contract, id, 'รายการปิดก่อนกำหนด 1 แถว');
  }

  return { contracts, members, anomalies };
}
