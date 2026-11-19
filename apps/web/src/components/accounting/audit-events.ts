import type { IcabAuditEvent } from './types';

/**
 * Raw audit-log row as returned by the per-document audit endpoints
 * (`GET /other-income/:id/audit`, `GET /expense-documents/:id/audit`,
 * `POST /assets/:id/audit`). Only the fields the timeline needs are typed;
 * `newValue` is an opaque JSON blob the reverse/void mutations stamp.
 */
export interface RawAuditEntry {
  id: string;
  action: string;
  createdAt: string;
  user: { id: string; name: string } | null;
  oldValue?: unknown;
  newValue?: unknown;
}

/** ชื่อช่องที่ผู้ใช้เห็น (ประวัติ "แก้ไขเอกสาร") — คีย์ที่ไม่รู้จักแสดงตามชื่อคีย์ */
const FIELD_LABELS: Record<string, string> = {
  documentDate: 'วันที่เอกสาร',
  vendorName: 'ผู้ขาย',
  vendorTaxId: 'เลขผู้เสียภาษี',
  vendorSupplierId: 'ผู้ขายในทะเบียน',
  taxInvoiceNo: 'เลขใบกำกับภาษี',
  description: 'รายละเอียด',
  whtFormType: 'แบบ ภ.ง.ด.',
  paymentMethod: 'วิธีจ่าย',
  depositAccountCode: 'บัญชีที่จ่าย',
  reference: 'เลขอ้างอิง',
  receiptImageUrl: 'รูปใบเสร็จ',
  note: 'หมายเหตุ',
  taxDisallowed: 'ภาษีต้องห้าม',
  lines: 'รายการ',
  priceType: 'ประเภทราคา',
  payroll: 'รายการเงินเดือน',
};

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : null;

const money = (v: unknown): string | null => {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  return Number.isFinite(n)
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;
};

function updatedChanges(oldValue: unknown, newValue: unknown): string | undefined {
  const nv = asRecord(newValue);
  const fields = Array.isArray(nv?.changedFields) ? (nv!.changedFields as unknown[]) : [];
  const labels = fields.filter((f): f is string => typeof f === 'string').map((f) => FIELD_LABELS[f] ?? f);
  const before = money(asRecord(oldValue)?.totalAmount);
  const after = money(nv?.totalAmount);
  const parts = [...labels];
  if (before && after && before !== after) parts.push(`ยอดรวม ${before} → ${after}`);
  return parts.length ? `แก้: ${parts.join(' · ')}` : undefined;
}

/**
 * เอกสารที่ไม่มีแถว CREATED ในประวัติ (สร้างก่อนเริ่มบันทึก หรือทางสร้างที่ไม่เขียน audit) —
 * เติม "สร้างเอกสาร" จากผู้สร้าง/เวลาสร้างของตัวเอกสารเอง ⇒ ประวัติเริ่มที่การสร้างเสมอ
 */
export function withCreatedEvent(
  events: IcabAuditEvent[],
  creator: { userId?: string | null; userName?: string | null; timestamp?: string | null },
): IcabAuditEvent[] {
  if (!creator.timestamp || events.some((e) => e.event === 'CREATED')) return events;
  return [
    {
      event: 'CREATED',
      userId: creator.userId ?? 'unknown',
      userName: creator.userName ?? 'ระบบ',
      timestamp: creator.timestamp,
    },
    ...events,
  ];
}

/** N เหตุการณ์ล่าสุดตามเวลา (API ส่งใหม่ → เก่า — ตัดท้ายอาร์เรย์ตรง ๆ ได้ของเก่าสุด) */
export function latestEvents(events: IcabAuditEvent[], n: number): IcabAuditEvent[] {
  return [...events]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-n);
}

/**
 * Map server-side AuditLog rows to the `IcabAuditEvent` shape consumed by the
 * shared InternalControlActionBar timeline. Shared across all three accounting
 * modules so the reason-extraction precedence stays identical.
 *
 * The server `action` strings (CREATED / POSTED / VOIDED / REVERSED / ...) are
 * preserved verbatim — the timeline's label registry handles the canonical set
 * and falls back gracefully for unknown values.
 *
 * `reason` precedence: structured `reverseReasonLabel` (+ `reverseNote`) →
 * free-form `reverseNote` → enum `reverseReason`. The asset module historically
 * stamps `reversalReason`, so that key is honoured too.
 */
export function mapAuditEvents(entries: RawAuditEntry[]): IcabAuditEvent[] {
  return entries.map((e) => {
    const nv =
      e.newValue && typeof e.newValue === 'object'
        ? (e.newValue as Record<string, unknown>)
        : null;
    const str = (key: string): string | undefined => {
      const v = nv?.[key];
      return typeof v === 'string' && v.length > 0 ? v : undefined;
    };
    const label = str('reverseReasonLabel');
    const note = str('reverseNote');
    const enumFallback = str('reverseReason') ?? str('reversalReason');
    const reason =
      label && note && label !== note ? `${label} — ${note}` : (label ?? note ?? enumFallback);
    return {
      event: e.action,
      userId: e.user?.id ?? 'unknown',
      userName: e.user?.name ?? 'ระบบ',
      timestamp: e.createdAt,
      reason,
      ...(e.action === 'UPDATED' ? { changes: updatedChanges(e.oldValue, e.newValue) } : {}),
    };
  });
}
