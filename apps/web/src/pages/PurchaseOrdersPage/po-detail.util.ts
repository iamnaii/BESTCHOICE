/**
 * PO detail helpers (redesign 2026-09-06, owner-approved canvas 7768f1d0).
 *
 * The old 5-dot timeline (รออนุมัติ → อนุมัติ → สั่งแล้ว → รับเข้า → รับครบ) forced an
 * owner-created PO — which is ordered the moment it is created — through two approval
 * steps it never had, and it lined up receiving and paying as if one followed the other.
 * The detail view now shows two independent progress tiles (goods / money) and a single
 * chronological history built only from events that actually carry a timestamp.
 */
import type { GoodsReceivingRecord, POItem, PurchaseOrder } from './types';

export type HistoryTone = 'info' | 'success' | 'muted' | 'destructive';

export interface POHistoryEvent {
  key: string;
  /** ISO timestamp; null when the system never recorded one (e.g. a cancel — no cancelledAt column). */
  at: string | null;
  title: string;
  by: string | null;
  detail: string | null;
  tone: HistoryTone;
  /** Present on รับสินค้า events so the view can list IMEIs and offer the GR print. */
  receiving?: GoodsReceivingRecord;
}

const ONE_MINUTE_MS = 60 * 1000;

const toMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Chronological events, newest first. Created + ordered collapse into one
 * "สร้างและสั่งซื้อ" when the PO was ordered on creation (OWNER path: no approver, ordered
 * within a minute of creation).
 */
export function poHistory(
  po: Pick<PurchaseOrder, 'status' | 'orderDate' | 'orderedAt' | 'createdBy' | 'approvedBy'> & { createdAt?: string | null },
  receivings: GoodsReceivingRecord[] = [],
): POHistoryEvent[] {
  const events: POHistoryEvent[] = [];
  const createdAt = po.createdAt ?? po.orderDate;
  const createdMs = toMs(createdAt);
  const orderedMs = toMs(po.orderedAt);
  const selfOrdered =
    orderedMs !== null &&
    createdMs !== null &&
    Math.abs(orderedMs - createdMs) <= ONE_MINUTE_MS &&
    (!po.approvedBy || po.approvedBy.id === po.createdBy.id);

  if (selfOrdered) {
    events.push({
      key: 'created-ordered',
      at: po.orderedAt,
      title: 'สร้างและสั่งซื้อ',
      by: po.createdBy.name,
      detail: 'สั่งซื้อทันทีโดยไม่ต้องอนุมัติ',
      tone: 'info',
    });
  } else {
    events.push({
      key: 'created',
      at: createdAt,
      title: po.status === 'DRAFT' ? 'สร้างใบสั่งซื้อ (รออนุมัติ)' : 'สร้างใบสั่งซื้อ',
      by: po.createdBy.name,
      detail: null,
      tone: 'muted',
    });
    if (po.orderedAt) {
      events.push({
        key: 'ordered',
        at: po.orderedAt,
        title: po.approvedBy ? 'อนุมัติและสั่งซื้อ' : 'สั่งซื้อ',
        by: po.approvedBy?.name ?? po.createdBy.name,
        detail: null,
        tone: 'info',
      });
    } else if (po.status === 'APPROVED' && po.approvedBy) {
      // Legacy two-step rows: approved but never ordered — no approvedAt exists, so no time.
      events.push({ key: 'approved', at: null, title: 'อนุมัติ', by: po.approvedBy.name, detail: null, tone: 'info' });
    }
  }

  [...receivings]
    .sort((a, b) => (toMs(a.createdAt) ?? 0) - (toMs(b.createdAt) ?? 0))
    .forEach((gr) => {
      const passed = gr.items.filter((i) => i.status === 'PASS').length;
      const rejected = gr.items.filter((i) => i.status === 'REJECT').length;
      events.push({
        key: `gr:${gr.id}`,
        at: gr.createdAt,
        title: `รับสินค้า ${gr.grNumber}`,
        by: gr.receivedBy.name,
        detail: rejected > 0 ? `ผ่าน ${passed} ชิ้น · ไม่ผ่าน ${rejected} ชิ้น` : `ผ่าน ${passed} ชิ้น`,
        tone: rejected > 0 && passed === 0 ? 'destructive' : 'success',
        receiving: gr,
      });
    });

  if (po.status === 'CANCELLED') {
    events.push({ key: 'cancelled', at: null, title: 'ยกเลิกใบสั่งซื้อ', by: null, detail: null, tone: 'destructive' });
  }

  return events.reverse();
}

export interface ReceivingProgress {
  received: number;
  total: number;
  remaining: number;
  pct: number;
}

export function receivingProgress(po: { items: Pick<POItem, 'quantity' | 'receivedQty'>[] }): ReceivingProgress {
  const total = po.items.reduce((s, i) => s + i.quantity, 0);
  const received = po.items.reduce((s, i) => s + Math.min(i.receivedQty, i.quantity), 0);
  return {
    received,
    total,
    remaining: Math.max(total - received, 0),
    pct: total > 0 ? Math.min(Math.round((received / total) * 100), 100) : 0,
  };
}

export interface PaymentProgress {
  paid: number;
  net: number;
  remaining: number;
  pct: number;
}

export function paymentProgress(po: Pick<PurchaseOrder, 'paidAmount' | 'netAmount' | 'totalAmount'>): PaymentProgress {
  const net = Number(po.netAmount ?? po.totalAmount) || 0;
  const paid = Number(po.paidAmount) || 0;
  return {
    paid,
    net,
    remaining: Math.max(net - paid, 0),
    pct: net > 0 ? Math.min(Math.round((paid / net) * 100), 100) : 0,
  };
}

export interface DueStatus {
  /** 'อีก 12 วัน' | 'ครบกำหนดวันนี้' | 'เลยกำหนด 3 วัน' — null when there is no due date. */
  text: string | null;
  /** Past the due date while money is still owed. */
  overdue: boolean;
}

export function dueStatus(dueDate: string | null, paymentStatus: string, now: Date = new Date()): DueStatus {
  if (!dueDate) return { text: null, overdue: false };
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return { text: null, overdue: false };
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(due) - startOf(now)) / (24 * 60 * 60 * 1000));
  const unpaid = paymentStatus !== 'FULLY_PAID';
  if (days > 0) return { text: `อีก ${days} วัน`, overdue: false };
  if (days === 0) return { text: 'ครบกำหนดวันนี้', overdue: false };
  return { text: unpaid ? `เลยกำหนด ${-days} วัน` : null, overdue: unpaid };
}

/** สภาพ column — mirrors the wizard's ใหม่/มือสอง select. */
export function itemCondition(item: Pick<POItem, 'category'>): string {
  if (item.category === 'PHONE_NEW') return 'ใหม่';
  if (item.category === 'PHONE_USED') return 'มือสอง';
  return '-';
}

export const isAccessory = (item: Pick<POItem, 'category'>) => item.category === 'ACCESSORY';

/** "เคส Spigen" — the accessory row's title, same order the wizard shows it. */
export function accessoryTitle(item: Pick<POItem, 'accessoryType' | 'accessoryBrand'>): string {
  return [item.accessoryType ?? 'อุปกรณ์เสริม', item.accessoryBrand].filter(Boolean).join(' ');
}

/** What the accessory is for: a charger's model is its own spec; anything else is "สำหรับรุ่น X". */
export function accessoryFor(item: Pick<POItem, 'accessoryType' | 'model'>): string | null {
  if (!item.model) return null;
  return item.accessoryType === 'ชุดชาร์จ' ? item.model : `สำหรับรุ่น ${item.model}`;
}

export const canReceive = (po: { status: string }) =>
  ['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status);
