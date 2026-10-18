import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { bangkokCalendarParts, bangkokMidnight } from '../../utils/date.util';
import { formatMonthName } from '../../utils/thai-date.util';
import { SHOP_PETTY_CASH_DEFAULT_LIMIT, shopPettyCashBankLabel } from './shop-petty-cash.constants';

/** บรรทัดบัญชี S11-1106 หนึ่งบรรทัดพร้อมหัวรายการ — รูปที่ service อ่านจาก journalLine.findMany({ include: { journalEntry } }) */
export interface PettyCashLedgerLine {
  id: string;
  debit: Decimal;
  credit: Decimal;
  entry: {
    id: string;
    entryNumber: string;
    entryDate: Date;
    description: string;
    metadata: unknown;
    createdById: string | null;
  };
}

export type PettyCashRowKind = 'TOP_UP' | 'RETURN' | 'SUPPLIER_PAYMENT' | 'SUPPLIER_PAYMENT_REVERSAL' | 'OTHER';

export interface PettyCashRowClass {
  kind: PettyCashRowKind;
  label: string;
  bankAccountCode: string | null;
  movementId: string | null;
  po: { id: string; number: string; supplierName: string } | null;
}

const SUPPLIER_KIND_LABEL: Record<string, string> = {
  SETTLEMENT: 'ชำระค่าสินค้า',
  DEPOSIT: 'มัดจำ',
  DEPOSIT_APPLIED: 'หักมัดจำ',
  DEPOSIT_REFUND: 'รับมัดจำคืน',
  DEPOSIT_FORFEIT: 'ริบมัดจำ',
};

const meta = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/** ชนิดของบรรทัดในตารางเคลื่อนไหว — รายการจากเมนูนี้ · จ่ายผู้จัดจำหน่าย (+ ยกเลิก) · อื่น ๆ (JE มือ / flow ที่ไม่รู้จัก) ไม่ทิ้งบรรทัดใด */
export function classifyPettyCashLine(line: PettyCashLedgerLine): PettyCashRowClass {
  const m = meta(line.entry.metadata);
  const flow = str(m.flow);
  const none = { bankAccountCode: null, movementId: null, po: null };
  if (flow === 'shop-petty-cash') {
    const bank = str(m.bankAccountCode);
    const kind: PettyCashRowKind = m.kind === 'RETURN' ? 'RETURN' : 'TOP_UP';
    return {
      kind,
      label: kind === 'TOP_UP' ? `เติมจาก ${shopPettyCashBankLabel(bank)}` : `คืนเข้า ${shopPettyCashBankLabel(bank)}`,
      bankAccountCode: bank,
      movementId: str(m.movementId),
      po: null,
    };
  }
  if (flow === 'shop-supplier-payment') {
    const reversal = m.tag === 'SHOP_SUPPLIER_PAYMENT_REVERSAL';
    const kindLabel = SUPPLIER_KIND_LABEL[String(m.kind ?? '')] ?? String(m.kind ?? '');
    const poId = str(m.poId);
    const poNumber = str(m.poNumber);
    return {
      kind: reversal ? 'SUPPLIER_PAYMENT_REVERSAL' : 'SUPPLIER_PAYMENT',
      label: `${reversal ? 'ยกเลิกจ่ายผู้จัดจำหน่าย' : 'จ่ายผู้จัดจำหน่าย'}${kindLabel ? ` · ${kindLabel}` : ''}`,
      bankAccountCode: null,
      movementId: null,
      po: poId && poNumber ? { id: poId, number: poNumber, supplierName: str(m.supplierName) ?? '' } : null,
    };
  }
  return { kind: 'OTHER', label: line.entry.description.trim() || 'รายการบัญชีอื่น', ...none };
}

export interface RunningBalanceInput {
  date: Date;
  /** ลำดับภายในวันเดียวกัน (createdAt ของบรรทัด) */
  seq: number;
  inAmount: Decimal;
  outAmount: Decimal;
}

/** เรียงเก่า→ใหม่ สะสมจากยอดยกมา แล้วคืนใหม่สุดก่อน (ตารางบนหน้า) พร้อมยอดปิดของช่วง */
export function withRunningBalance<T extends RunningBalanceInput>(
  opening: Decimal,
  rows: readonly T[],
): { rows: (T & { balanceAfter: Decimal })[]; closing: Decimal } {
  const asc = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime() || a.seq - b.seq);
  let running = new Decimal(opening.toString());
  const out = asc.map((row) => {
    running = running.add(row.inAmount).sub(row.outAmount);
    return { ...row, balanceAfter: running };
  });
  return { rows: out.reverse(), closing: running };
}

/** เติมได้อีก = วงเงิน − คงเหลือ (ไม่ติดลบ) · เกินวงเงิน = คงเหลือ − วงเงิน (ไม่ติดลบ) */
export function computeHeadroom(limit: Decimal, balance: Decimal): { headroom: Decimal; overLimit: Decimal } {
  const zero = new Decimal(0);
  const diff = new Decimal(limit.toString()).sub(balance);
  return { headroom: diff.gt(0) ? diff : zero, overLimit: diff.lt(0) ? diff.neg() : zero };
}

/** ค่าตั้งค่า `shop_petty_cash_limit`: ไม่มี/เพี้ยน/ติดลบ = ค่าเริ่มต้น (DEFAULT) · ตัวเลข ≥ 0 = ที่เจ้าของตั้ง (SET) */
export function resolveLimit(raw: string | null | undefined): { value: Decimal; source: 'DEFAULT' | 'SET' } {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length > 0 && /^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { value: new Decimal(trimmed), source: 'SET' };
  }
  return { value: new Decimal(SHOP_PETTY_CASH_DEFAULT_LIMIT), source: 'DEFAULT' };
}

export interface ThaiMonthRange {
  year: number;
  /** 1–12 */
  month: number;
  /** YYYY-MM */
  key: string;
  /** "ตุลาคม 2569" */
  label: string;
  /** เที่ยงคืนไทยของวันที่ 1 */
  start: Date;
  /** เที่ยงคืนไทยของวันที่ 1 เดือนถัดไป (ไม่รวม) */
  end: Date;
}

/** ช่วงเดือนตามปฏิทินไทย — ไม่ส่ง = เดือนปัจจุบัน · `YYYY-MM` = เดือนนั้น */
export function thaiMonthRange(month?: string | null, now: Date = new Date()): ThaiMonthRange {
  let year: number;
  let monthIndex: number;
  if (month == null || month === '') {
    const parts = bangkokCalendarParts(now);
    year = parts.year;
    monthIndex = parts.month;
  } else {
    const match = /^(\d{4})-(\d{2})$/.exec(month.trim());
    const m = match ? Number(match[2]) : NaN;
    if (!match || m < 1 || m > 12) throw new BadRequestException('เดือนไม่ถูกต้อง (YYYY-MM)');
    year = Number(match[1]);
    monthIndex = m - 1;
  }
  const start = bangkokMidnight(year, monthIndex, 1);
  const end = bangkokMidnight(year, monthIndex + 1, 1);
  return {
    year,
    month: monthIndex + 1,
    key: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
    label: `${formatMonthName(start)} ${year + 543}`,
    start,
    end,
  };
}
