import { BadRequestException } from '@nestjs/common';
import { SupplierDocType } from '@prisma/client';
import { bangkokDateString, bangkokMidnight, isFutureBkkDay } from '../../../utils/date.util';
import { formatDateShort } from '../../../utils/thai-date.util';
import { validatePeriodOpen } from '../../../utils/period-lock.util';

/**
 * เอกสารจากผู้จัดจำหน่ายบนใบรับของ (ข3 — แบบหน้าจอที่เจ้าของเคาะ 2026-10-01):
 *   1. เลขที่ + วันที่ในเอกสารบังคับ ยกเว้น "ไม่มีเอกสาร"
 *   2. ไม่มีเอกสาร → ลงบัญชีวันที่รับของ และต้องเขียนเหตุผลในหมายเหตุใบรับ
 *   3. วันที่ในเอกสารอยู่ในงวดที่ปิดแล้ว → รับได้ ลงวันที่รับของแทน + แจ้งฝ่ายบัญชี (แบบ ข)
 *   5. เลขที่ซ้ำกับใบรับของเดิมของผู้จัดจำหน่ายเดียวกัน → เตือนบนจอ แต่รับได้
 */
export const SUPPLIER_DOC_LABEL: Record<SupplierDocType, string> = {
  TAX_INVOICE: 'ใบกำกับภาษี',
  DELIVERY_NOTE: 'ใบส่งของ / ใบแจ้งหนี้',
  CASH_BILL: 'บิลเงินสด',
  NONE: 'ไม่มีเอกสาร',
};

export const SUPPLIER_DOC_NUMBER_MAX = 64;

export interface SupplierDocInput {
  supplierDocType?: SupplierDocType | null;
  supplierDocNumber?: string | null;
  supplierDocDate?: string | null;
  notes?: string | null;
}

export interface SupplierDoc {
  /** null = ผู้เรียกภายใน (seed/เทส) ที่ไม่ส่งประเภท — ลงบัญชีวันที่รับของแบบเดิม */
  type: SupplierDocType | null;
  number: string | null;
  /** วันที่ในเอกสาร = เที่ยงคืนเวลาไทย · null เมื่อไม่มีเอกสาร */
  date: Date | null;
}

/** ตัดช่องว่างหัวท้าย และยุบช่องว่างซ้อนกลางเลขที่ */
export function normalizeDocNumber(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

/** `YYYY-MM-DD` (ปฏิทินไทย) → เที่ยงคืนเวลาไทยของวันนั้น · วันที่ที่ไม่มีจริง (30 ก.พ.) = 400 */
export function parseSupplierDocDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
    const probe = new Date(Date.UTC(year, month, day));
    if (probe.getUTCFullYear() === year && probe.getUTCMonth() === month && probe.getUTCDate() === day) {
      return bangkokMidnight(year, month, day);
    }
  }
  throw new BadRequestException('วันที่ในเอกสารไม่ถูกต้อง');
}

/**
 * ตรวจและจัดรูปช่องเอกสารก่อนเปิดธุรกรรมรับของ — ไม่ผ่าน = 400 ไทย ไม่มีอะไรถูกบันทึก.
 * ประเภทบังคับที่ DTO (เส้นทาง HTTP) — ที่นี่ไม่บังคับ เพื่อให้ผู้เรียกภายในที่ไม่มีเอกสารใช้แบบเดิมได้
 */
export function normalizeSupplierDoc(input: SupplierDocInput, now: Date = new Date()): SupplierDoc {
  const type = input.supplierDocType ?? null;
  if (type === null) return { type: null, number: null, date: null };
  if (!(type in SUPPLIER_DOC_LABEL)) throw new BadRequestException('ประเภทเอกสารของผู้จัดจำหน่ายไม่ถูกต้อง');

  if (type === 'NONE') {
    if (!input.notes?.trim()) {
      throw new BadRequestException('กรุณาเขียนเหตุผลที่ไม่มีเอกสารในหมายเหตุใบรับ เช่น ร้านไม่ออกบิล');
    }
    return { type, number: null, date: null };
  }

  const number = normalizeDocNumber(input.supplierDocNumber);
  if (!number) throw new BadRequestException('กรุณากรอกเลขที่เอกสาร');
  if (number.length > SUPPLIER_DOC_NUMBER_MAX) {
    throw new BadRequestException(`เลขที่เอกสารยาวเกิน ${SUPPLIER_DOC_NUMBER_MAX} ตัวอักษร`);
  }
  if (!input.supplierDocDate?.trim()) throw new BadRequestException('กรุณาเลือกวันที่ในเอกสาร');
  const date = parseSupplierDocDate(input.supplierDocDate);
  if (isFutureBkkDay(date, now)) {
    throw new BadRequestException(`วันที่ในเอกสารต้องไม่เกินวันนี้ (${formatDateShort(now)})`);
  }
  return { type, number, date };
}

/** "ใบกำกับภาษี IV2610-0123" — null เมื่อไม่มีเลขที่ */
export function supplierDocRef(doc: Pick<SupplierDoc, 'type' | 'number'>): string | null {
  return doc.type && doc.number ? `${SUPPLIER_DOC_LABEL[doc.type]} ${doc.number}` : null;
}

/** ข้อมูลเอกสารที่ stamp ลง metadata ของรายการบัญชีรับสินค้า */
export function supplierDocMetadata(doc: SupplierDoc): Record<string, string | null> {
  if (!doc.type) return {};
  return {
    supplierDocType: doc.type,
    supplierDocNumber: doc.number,
    supplierDocDate: doc.date ? bangkokDateString(doc.date) : null,
  };
}

/** งวดบัญชีของวันนั้นยังรับรายการได้ไหม — ตัวตัดสินเดียวกับตอนลงบัญชี (`validatePeriodOpen` รวมช่วงผ่อนผัน) */
export async function isPeriodOpenFor(
  client: Parameters<typeof validatePeriodOpen>[0],
  date: Date,
  companyId: string,
): Promise<boolean> {
  try {
    await validatePeriodOpen(client, date, companyId);
    return true;
  } catch (e) {
    if (e instanceof BadRequestException) return false;
    throw e;
  }
}
