import { canEditTaxInvoice, canRecordTaxInvoice } from '@/lib/input-vat';
import type { GoodsReceivingRecord } from './types';

// ก้อน 5 — ใบกำกับภาษีของใบรับของ (Q1: OWNER/BM/ACCOUNTANT บันทึก · แก้ได้เฉพาะ OWNER/ACCOUNTANT) — กติกาตรงกับ API
// `goods-receiving-tax-invoice.service.ts`

export type TaxInvoiceBadge = { text: 'มีใบกำกับภาษี' | 'รอใบกำกับภาษี' | 'ไม่มี VAT'; variant: 'success' | 'warning' | 'secondary' };

const hasInvoice = (r: GoodsReceivingRecord) => r.supplierDocType === 'TAX_INVOICE' || !!r.taxInvoice;

export function taxInvoiceBadge(r: GoodsReceivingRecord, supplierHasVat: boolean): TaxInvoiceBadge {
  if (hasInvoice(r)) return { text: 'มีใบกำกับภาษี', variant: 'success' };
  if (!supplierHasVat) return { text: 'ไม่มี VAT', variant: 'secondary' };
  return { text: 'รอใบกำกับภาษี', variant: 'warning' };
}

/** ปุ่มแสดงเมื่อ: ผู้จัดจำหน่ายจด VAT · ใบไม่ได้รับด้วย TAX_INVOICE · role บันทึกได้ · (ถ้าบันทึกแล้ว ต้อง canEditTaxInvoice) */
export function taxInvoiceAction(r: GoodsReceivingRecord, supplierHasVat: boolean, role?: string | null): 'RECORD' | 'EDIT' | null {
  if (!supplierHasVat || r.supplierDocType === 'TAX_INVOICE' || !canRecordTaxInvoice(role)) return null;
  if (r.taxInvoice) return canEditTaxInvoice(role) ? 'EDIT' : null;
  return 'RECORD';
}

export function buildTaxInvoiceFormData(form: { number: string; date: string }, photo: File | null): FormData {
  const fd = new FormData();
  fd.append('number', form.number.trim());
  fd.append('date', form.date);
  if (photo) fd.append('photo', photo, photo.name);
  return fd;
}

export interface TaxInvoiceRecordResult {
  receiving: { id: string; grNumber: string; taxInvoice: { number: string; date: string; source: 'RECEIVING' | 'LATER' } };
  /** amount = null เมื่อผู้บันทึกไม่มีสิทธิ์เห็นยอด (Q5 — BM บันทึกได้แต่ไม่เห็นยอด) */
  claimed: { contractId: string; contractNumber: string; journalEntryNo: string; amount: string | null; postedOnInvoiceDate: boolean }[];
  accountingNotified: boolean;
}

export function taxInvoiceResultMessage(r: TaxInvoiceRecordResult): string {
  if (r.claimed.length === 0) return 'บันทึกใบกำกับภาษีแล้ว — ยังไม่มีสัญญาที่รอเคลมในใบรับของนี้';
  const base = `บันทึกใบกำกับภาษีแล้ว · เคลมภาษีซื้อย้อนให้ ${r.claimed.length} สัญญา (${r.claimed.map((c) => c.contractNumber).join(', ')})`;
  return r.accountingNotified ? `${base} · ส่งงานแจ้งฝ่ายบัญชีแล้ว (ลงวันนี้แทนวันเปิดสัญญา)` : base;
}
