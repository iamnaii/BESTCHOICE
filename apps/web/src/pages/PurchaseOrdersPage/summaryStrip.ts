import type { LucideIcon } from 'lucide-react';
import {
  FileClock,
  ShoppingCart,
  Truck,
  AlertTriangle,
  PackageCheck,
  ClipboardCheck,
  Wallet,
} from 'lucide-react';

/**
 * Compute-on-read purchasing counts from GET /purchase-orders/summary (B0).
 * Keys MUST stay identical to po-query.service.ts getSummary() return shape.
 */
export interface PurchasingSummary {
  pendingApproval: number;
  toOrder: number;
  incoming: number;
  overdue: number;
  receiving: number;
  waitingQc: number;
  unpaid: number;
}

/** What clicking a card does to the page. */
export type SummaryFilterAction =
  | { tab: 'list'; status: string; overdueOnly: boolean }
  | { tab: 'payable' }
  | { panel: 'qc' };

export type SummaryTone = 'primary' | 'warning' | 'destructive' | 'success' | 'info';

export interface SummaryCardDef {
  key: keyof PurchasingSummary;
  label: string;
  icon: LucideIcon;
  tone: SummaryTone;
  action: SummaryFilterAction;
}

/** Display order matches the spec's summary-strip zone. */
export const SUMMARY_CARDS: SummaryCardDef[] = [
  {
    key: 'pendingApproval',
    label: 'รออนุมัติ',
    icon: FileClock,
    tone: 'warning',
    action: { tab: 'list', status: 'DRAFT', overdueOnly: false },
  },
  {
    key: 'toOrder',
    label: 'รอสั่งซื้อ',
    icon: ShoppingCart,
    tone: 'primary',
    action: { tab: 'list', status: 'APPROVED', overdueOnly: false },
  },
  {
    key: 'incoming',
    label: 'กำลังมา',
    icon: Truck,
    tone: 'info',
    action: { tab: 'list', status: 'ORDERED', overdueOnly: false },
  },
  {
    key: 'overdue',
    label: 'เลยกำหนดส่ง',
    icon: AlertTriangle,
    tone: 'destructive',
    action: { tab: 'list', status: 'ORDERED', overdueOnly: true },
  },
  {
    key: 'receiving',
    label: 'รับบางส่วน',
    icon: PackageCheck,
    tone: 'warning',
    action: { tab: 'list', status: 'PARTIALLY_RECEIVED', overdueOnly: false },
  },
  {
    key: 'waitingQc',
    label: 'รอตรวจ QC',
    icon: ClipboardCheck,
    tone: 'warning',
    action: { panel: 'qc' },
  },
  {
    key: 'unpaid',
    label: 'ค้างจ่าย',
    icon: Wallet,
    tone: 'destructive',
    action: { tab: 'payable' },
  },
];

/**
 * Token-only Tailwind classes per tone — mirrors the DashboardKPIs card anatomy
 * (left border-strip, size-10 rounded icon box, count pill). No hex, no gray, no bg-white.
 */
export const TONE_STYLES: Record<SummaryTone, { border: string; iconBox: string; icon: string; pill: string }> = {
  primary: {
    border: 'bg-primary',
    iconBox: 'bg-primary/10 group-hover:bg-primary/20',
    icon: 'text-primary',
    pill: 'text-primary bg-primary/10',
  },
  warning: {
    border: 'bg-warning',
    iconBox: 'bg-warning/10 group-hover:bg-warning/20',
    icon: 'text-warning',
    pill: 'text-warning bg-warning/10',
  },
  destructive: {
    border: 'bg-destructive',
    iconBox: 'bg-destructive/10 group-hover:bg-destructive/20',
    icon: 'text-destructive',
    pill: 'text-destructive bg-destructive/10',
  },
  success: {
    border: 'bg-success',
    iconBox: 'bg-success/10 group-hover:bg-success/20',
    icon: 'text-success',
    pill: 'text-success bg-success/10',
  },
  info: {
    border: 'bg-info',
    iconBox: 'bg-info/10 group-hover:bg-info/20',
    icon: 'text-info',
    pill: 'text-info bg-info/10',
  },
};
