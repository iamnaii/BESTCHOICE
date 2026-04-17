import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Package,
  FileCheck,
  ImageIcon,
} from 'lucide-react';

/* ─── Types ─── */

export interface KPIs {
  contracts: { total: number; active: number; overdue: number; default: number; completed: number };
  products: { total: number; inStock: number };
  financial: { totalReceivable: number; totalLateFees: number; todayPayments: number; todayPaymentCount: number };
  overdueRate: number;
  contractsMoM?: number | null;
  overdueMoM?: number | null;
  stockMoM?: number | null;
}

export interface MonthlyTrend {
  month: string;
  newContracts: number;
  paymentsReceived: number;
}

export interface TopOverdue {
  contractNumber: string;
  customer: { id: string; name: string; phone: string };
  totalOutstanding: number;
  daysOverdue: number;
}

export interface StatusDistribution {
  status: string;
  count: number;
}

export interface BranchComparison {
  id: string;
  name: string;
  contracts: number;
  products: number;
  users: number;
  overdueContracts: number;
  monthlyPayments: number;
}

export interface MonthlyRevenue {
  totalPayments: number;
  interestIncome: number;
  lateFeeIncome: number;
  paymentCount: number;
}

export interface AgingSummary {
  buckets: { range: string; count: number; amount: number; color: string }[];
  total: { count: number; amount: number };
}

export interface StaffSalesMetric {
  salespersonId: string;
  name: string;
  branch: string;
  totalContracts: number;
  totalSales: number;
  overdueCount: number;
  overdueRate: number;
}

export interface StaffActivity {
  id: string;
  type: 'contract_created' | 'payment_recorded';
  userName: string;
  description: string;
  amount: number;
  createdAt: string;
}

export interface StaffPerformance {
  salesMetrics: StaffSalesMetric[];
  recentActivity: StaffActivity[];
}

export interface CollectionPipelineStage {
  stage: string;
  label: string;
  count: number;
  totalAmount: number;
}

export interface CollectionPipeline {
  stages: CollectionPipelineStage[];
  totalContracts: number;
  totalAmount: number;
}

export interface DashboardAlert {
  type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  link: string;
  count: number;
}

export interface UpsellCandidate {
  contractId: string;
  contractNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  totalMonths: number;
  paidCount: number;
  paidRatio: number;
  contractStatus: string;
  hasExchangeHistory: boolean;
  productModel: string | null;
  monthlyPayment: number;
  reason: string;
}

export interface UpsellCandidates {
  total: number;
  candidates: UpsellCandidate[];
}

export interface WatchListEntry {
  customerId: string;
  customerName: string;
  customerPhone: string;
  contractId: string;
  contractNumber: string;
  riskScore: number;
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: string[];
  latePaymentCount: number;
  partialPaymentCount: number;
  hadDunningReset: boolean;
  nextDueDate: string | null;
  nextAmountDue: number | null;
}

export interface WatchList {
  total: number;
  highCount: number;
  mediumCount: number;
  watchList: WatchListEntry[];
}

export interface EntityProfit {
  shop: { revenue: number; costOfGoods: number; commission: number; profit: number; transactionCount: number };
  finance: { interestIncome: number; commissionExpense: number; lateFeeIncome: number; profit: number; transactionCount: number };
  combined: { totalProfit: number; totalVat: number };
}

export interface ComparativePL {
  current: { revenue: { totalRevenue: number }; grossProfit: number; netProfit: number };
  previousMonth: { revenue: { totalRevenue: number }; grossProfit: number; netProfit: number };
  lastYear: { revenue: { totalRevenue: number }; grossProfit: number; netProfit: number };
  momChange: { revenue: number; grossProfit: number; netProfit: number };
  yoyChange: { revenue: number; grossProfit: number; netProfit: number };
}

/* ─── Constants ─── */

export const statusLabels: Record<string, string> = {
  ACTIVE: 'ปกติ',
  OVERDUE: 'ค้างชำระ',
  DEFAULT: 'ผิดนัด',
  COMPLETED: 'ปิดสัญญา',
  EXCHANGED: 'เปลี่ยนเครื่อง',
  CLOSED_BAD_DEBT: 'หนี้สูญ',
};

export const statusColors: Record<string, string> = {
  ACTIVE: 'bg-success',
  OVERDUE: 'bg-warning',
  DEFAULT: 'bg-destructive',
  COMPLETED: 'bg-primary',
  EXCHANGED: 'bg-primary',
  CLOSED_BAD_DEBT: 'bg-muted-foreground',
};

export const agingBarColors: Record<string, string> = {
  green: 'bg-success',
  yellow: 'bg-warning',
  orange: 'bg-warning',
  red: 'bg-destructive',
};

export const agingTextColors: Record<string, string> = {
  green: 'text-success',
  yellow: 'text-warning',
  orange: 'text-warning',
  red: 'text-destructive',
};

/* Pie chart colors — use chart CSS variables so colors respect theme tokens */
export const pieColors: Record<string, string> = {
  ACTIVE: 'hsl(var(--chart-1))',
  OVERDUE: 'hsl(var(--chart-2))',
  DEFAULT: 'hsl(var(--chart-3))',
  COMPLETED: 'hsl(var(--chart-4))',
  EXCHANGED: 'hsl(var(--chart-5))',
  CLOSED_BAD_DEBT: 'hsl(var(--muted-foreground))',
};

/* ─── Alert Icon Map ─── */
export const alertIconMap: Record<string, LucideIcon> = {
  overdue: AlertTriangle,
  low_stock: Package,
  pending_contracts: FileCheck,
  payment_mismatch: ImageIcon,
};

export const alertSeverityStyles = {
  critical: {
    container: 'border-destructive/30 bg-destructive/5',
    icon: 'bg-destructive/10 text-destructive',
    badge: 'bg-destructive/10 text-destructive',
    count: 'text-destructive',
  },
  warning: {
    container: 'border-warning/30 bg-warning/5',
    icon: 'bg-warning/10 text-warning',
    badge: 'bg-warning/10 text-warning',
    count: 'text-warning',
  },
  info: {
    container: 'border-primary/20 bg-primary/5',
    icon: 'bg-primary/10 text-primary',
    badge: 'bg-primary/10 text-primary',
    count: 'text-primary',
  },
} as const;

/* ─── Helper Components ─── */

export function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-center py-8">
      <p className="text-sm text-destructive mb-2">{message}</p>
      <button onClick={onRetry} className="text-xs text-primary hover:underline">ลองใหม่</button>
    </div>
  );
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ชม.ที่แล้ว`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} วันที่แล้ว`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} เดือนที่แล้ว`;
  const years = Math.floor(months / 12);
  return `${years} ปีที่แล้ว`;
}
