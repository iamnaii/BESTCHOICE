import { statusLabels } from '@/lib/constants';
import { formatDateShortThai, formatDateTime } from '@/utils/formatters';
import type { Product } from './types';

/**
 * ยิง QR / IMEI ที่หน้าขาย (A4 · 2026-10-22) — ถ้อยคำของแถบเขียว/แถบแดง · pure ไม่มี DOM
 * ข้อเท็จจริงมาจาก `GET /products/scan` (ใครจอง ขายเมื่อไร อยู่สาขาไหน) ที่นี่แค่แปลงเป็นประโยค + ปุ่มพาไปต่อ
 * ลิงก์ทุกตัวตรวจแล้วว่า SALES เข้าถึงได้: `/bookings?bookingId=` · `/contracts/:id` · `/sales?saleId=` · `/stock?q=`
 */

export type ScanReason =
  | 'SELLABLE'
  | 'NOT_FOUND'
  | 'DELETED'
  | 'OTHER_BRANCH'
  | 'BOOKED'
  | 'DRAFT_CONTRACT'
  | 'WEB_RESERVED'
  | 'RESERVED'
  | 'ON_CONTRACT'
  | 'SOLD'
  | 'NOT_READY';

export interface ScanOutcome {
  code: string;
  reason: ScanReason;
  sellable: boolean;
  product: (Product & { status?: string }) | null;
  branch: { id: string; name: string } | null;
  booking: { id: string; bookingNumber: string; customerName: string; expireDate: string } | null;
  contract: { id: string; contractNumber: string; customerName: string; status: string } | null;
  sale: { id: string; saleNumber: string; customerName: string; soldAt: string } | null;
  reservation: { expiresAt: string } | null;
}

export interface ScanBlockMessage {
  title: string;
  detail: string | null;
  link: { label: string; to: string } | null;
}

const BLOCK = 'เครื่องนี้ขายไม่ได้ตอนนี้ · ';
const ID_TEXT_LENGTH = 8;

/** Enter นับเป็นการยิงเมื่อค่าไม่มีช่องว่างและยาวพอ — "iPhone 15" + Enter คือค้นหาชื่อรุ่นตามเดิม */
export function isScanCandidate(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 3 && !/\s/.test(trimmed);
}

/** ป้ายรหัสบนแถบเขียว — ลำดับเดียวกับที่สติกเกอร์ (A5) เข้ารหัสลง QR */
export function scanIdLabel(
  product: Pick<Product, 'id' | 'imeiSerial' | 'legacyProductCode'>,
): { label: 'IMEI' | 'รหัส' | 'ID'; text: string } {
  const imei = (product.imeiSerial ?? '').trim();
  if (imei) return { label: 'IMEI', text: imei };
  const code = (product.legacyProductCode ?? '').trim();
  if (code) return { label: 'รหัส', text: code };
  return { label: 'ID', text: product.id.slice(0, ID_TEXT_LENGTH) };
}

/** เติม "คุณ" เฉพาะชื่อที่ยังไม่มีคำนำหน้า (บางแถวเก็บ นาย/นาง/นางสาว ไว้ในชื่อแล้ว) */
export function honorific(name: string): string {
  const trimmed = name.trim();
  if (/^(นาย|นางสาว|นาง|คุณ)/.test(trimmed)) return trimmed;
  return `คุณ${trimmed}`;
}

function stockLink(code: string): ScanBlockMessage['link'] {
  return { label: 'ดูในคลังสินค้า', to: `/stock?q=${encodeURIComponent(code)}` };
}

export function describeScanBlock(outcome: ScanOutcome): ScanBlockMessage {
  const { code } = outcome;
  switch (outcome.reason) {
    case 'NOT_FOUND':
      return {
        title: `ไม่พบรหัส “${code}” ในระบบ`,
        detail: 'ถ้าพิมพ์ชื่อรุ่น ให้เลือกจากรายการด้านล่าง · ถ้ายิงจากสติกเกอร์ ลองยิงใหม่อีกครั้ง',
        link: null,
      };
    case 'DELETED':
      return {
        title: `เครื่องรหัส ${code} ถูกลบออกจากระบบแล้ว`,
        detail: 'ถ้าเครื่องยังอยู่จริง ให้ผู้จัดการตรวจสอบก่อนขาย',
        link: null,
      };
    case 'OTHER_BRANCH':
      return {
        title: `${BLOCK}อยู่สาขาอื่น`,
        detail: `เครื่องอยู่ที่ ${outcome.branch?.name ?? 'สาขาอื่น'} — ต้องโอนมาสาขานี้ก่อน`,
        link: stockLink(code),
      };
    case 'BOOKED': {
      const b = outcome.booking;
      return {
        title: `${BLOCK}จองไว้แล้ว`,
        detail: b ? `ใบจอง ${b.bookingNumber} ของ${honorific(b.customerName)} หมดอายุ ${formatDateShortThai(b.expireDate)}` : null,
        link: b ? { label: `เปิดใบจอง ${b.bookingNumber}`, to: `/bookings?bookingId=${b.id}` } : stockLink(code),
      };
    }
    case 'DRAFT_CONTRACT': {
      const c = outcome.contract;
      return {
        title: `${BLOCK}ติดร่างสัญญา`,
        detail: c ? `ร่างสัญญา ${c.contractNumber} ของ${honorific(c.customerName)}` : null,
        link: c ? { label: `เปิดร่างสัญญา ${c.contractNumber}`, to: `/contracts/${c.id}` } : stockLink(code),
      };
    }
    case 'ON_CONTRACT': {
      const c = outcome.contract;
      return {
        title: `${BLOCK}ติดสัญญาผ่อน`,
        detail: c ? `สัญญา ${c.contractNumber} ของ${honorific(c.customerName)}` : null,
        link: c ? { label: `เปิดสัญญา ${c.contractNumber}`, to: `/contracts/${c.id}` } : stockLink(code),
      };
    }
    case 'WEB_RESERVED':
      return {
        title: `${BLOCK}ลูกค้าจองผ่านเว็บ`,
        detail: outcome.reservation ? `หมดเวลาจอง ${formatDateTime(outcome.reservation.expiresAt)}` : null,
        link: stockLink(code),
      };
    case 'RESERVED':
      return {
        title: `${BLOCK}ติดจอง`,
        detail: 'ระบบไม่พบว่าใครถือเครื่องนี้ — ให้ผู้จัดการตรวจสถานะในคลังสินค้า',
        link: stockLink(code),
      };
    case 'SOLD': {
      const s = outcome.sale;
      return {
        title: `${BLOCK}ขายไปแล้ว`,
        detail: s
          ? `ใบขาย ${s.saleNumber} ของ${honorific(s.customerName)} เมื่อ ${formatDateShortThai(s.soldAt)}`
          : 'ไม่พบใบขายของเครื่องนี้ — ให้ผู้จัดการตรวจประวัติการขาย',
        link: s ? { label: `เปิดใบขาย ${s.saleNumber}`, to: `/sales?saleId=${s.id}` } : null,
      };
    }
    case 'NOT_READY': {
      const status = outcome.product?.status ?? '';
      return {
        title: `${BLOCK}${statusLabels[status]?.label ?? status}`,
        detail: 'เครื่องยังไม่ผ่านขั้นตอนเข้าคลัง — ต้องเป็น “พร้อมขาย” ก่อนจึงขายได้',
        link: stockLink(code),
      };
    }
    case 'SELLABLE':
      return { title: '', detail: null, link: null };
  }
}
