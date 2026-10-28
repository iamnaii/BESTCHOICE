import { NativeSelect } from '@/components/ui/native-select';
import { useState, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, commissionStatusMap, type StatusConfig } from '@/lib/status-badges';
import { formatNumberDecimal } from '@/utils/formatters';
import { toast } from 'sonner';
import {
  Banknote,
  CheckCircle,
  Clock,
  DollarSign,
  Eye,
  FileText,
  Info,
  ListOrdered,
  Sparkles,
  Undo2,
  UserX,
  type LucideIcon,
} from 'lucide-react';

/**
 * Payroll D4 ส่วนที่ 2 (Task 6, mockup กระดาน 4) — ค่าคอมจ่ายผ่านใบเงินเดือนเท่านั้น:
 * หน้านี้อนุมัติอย่างเดียว (POST) · ปุ่ม "จ่าย" / "สร้างใบจ่าย" / อนุมัติ-จ่ายใบจ่ายรายเดือน ถูกถอด (API ตอบ 410) ·
 * แต่ละรายการบอกว่าอยู่ในใบเงินเดือนไหน (`payrollLinks`) และยอดเรียกคืนที่ยังรอหัก (`clawbackOutstanding`)
 * · แบนเนอร์และลิงก์ไปใบเงินเดือนเฉพาะ OWNER / FINANCE_MANAGER — SALES เปิดหน้ารายจ่ายไม่ได้ (App.tsx /expenses)
 */

type CommissionStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'CLAWED_BACK' | 'PARTIALLY_CLAWED_BACK';

interface PayrollLink {
  documentId: string;
  documentNumber: string;
  /** สถานะของใบเงินเดือน (ExpenseDocument.status) */
  status: string;
  kind: 'PAY' | 'CLAWBACK';
}

interface Commission {
  id: string;
  salesperson: { id: string; name: string };
  contract?: { contractNumber: string } | null;
  sale?: { id: string; saleNumber?: string } | null;
  saleAmount: string;
  commissionRate: string;
  commissionAmount: string;
  status: CommissionStatus;
  createdAt: string;
  /** รายการในใบเงินเดือนที่ยังมีผล (จ่าย / หักคืน) เรียงตามลำดับที่เขียน */
  payrollLinks?: PayrollLink[];
  /** ยอดเรียกคืนที่ใบเงินเดือนถัดไปยังต้องหัก (2 ตำแหน่ง) — null = ไม่ใช่ค่าคอมที่ใบเงินเดือนหักคืนให้ */
  clawbackOutstanding?: string | null;
  salespersonResigned?: boolean;
}

interface CommissionPayout {
  id: string;
  period: string;
  salesperson: { id: string; name: string };
  totalSales: string;
  totalCommission: string;
  commissionCount: number;
  status: 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';
  approvedBy?: { name: string } | null;
  paidBy?: { name: string } | null;
  approvedAt?: string | null;
  paidAt?: string | null;
  notes?: string | null;
}

type Tab = 'commissions' | 'payouts';

/** กระดาน 4 — แบนเนอร์ (OWNER / FINANCE_MANAGER เท่านั้น — คนที่อนุมัติได้และเปิดหน้ารายจ่ายได้) */
const BANNER_TITLE = 'ค่าคอมไม่มีปุ่มจ่ายแยกแล้ว';
const BANNER_BODY =
  'อนุมัติรายการที่นี่ แล้วระบบดึงเข้าใบเงินเดือนให้เมื่อบันทึกใบ (หน้ารายจ่าย › สร้างเอกสารใหม่ › เงินเดือน (PR)) — ค่าคอมจะเป็น "จ่ายแล้ว" เมื่อใบเงินเดือนลงบัญชี';
const RESIGNED_LABEL = 'เรียกคืน — พนักงานลาออก ให้เจ้าของตัดสิน';
const outstandingLabel = (n: string) => `เรียกคืน — รอหัก ${n}`;
/** P2-R30 — ใต้ป้ายพนักงานลาออก: ยอดที่ยังค้าง (เจ้าของตัดสินจากยอดนี้) */
const resignedOutstandingLabel = (n: string) => `รอหัก ${n}`;
/** P2-R30 — การ์ดสรุปคิดจากรายการที่ได้ (เพดาน 100 ต่อหน้า) — เดือนที่มีมากกว่านั้นต้องบอกว่าตัวเลขยังไม่ครบ */
const partialListText = (shown: number, total: number) => `แสดง ${shown} จาก ${total} รายการ`;
const SUBTITLE_APPROVER = 'อนุมัติค่าคอมพนักงานขาย — จ่ายพร้อมใบเงินเดือนเท่านั้น';
const SUBTITLE_OWN = 'ค่าคอมของคุณ — จ่ายพร้อมใบเงินเดือน';

/**
 * สถานะของใบเงินเดือนบนชิป (ใบที่ปล่อยค่าคอมแล้ว — กลับรายการ/ลบ — ไม่มาถึงที่นี่: API ส่งเฉพาะรายการที่ยังมีผล) ·
 * ค่าที่ไม่รู้จัก = คำกลาง ๆ ภาษาไทย ไม่แสดงชื่อ enum (P2-R30)
 */
const PAYROLL_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'ร่าง',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  ACCRUAL: 'ตั้งค้างจ่าย',
  POSTED: 'ลงบัญชีแล้ว',
  VOIDED: 'กลับรายการแล้ว',
};
const PAYROLL_STATUS_FALLBACK = 'สถานะอื่น';
const payrollLinkText = (l: PayrollLink) =>
  l.kind === 'PAY'
    ? `อยู่ในใบเงินเดือน ${l.documentNumber} · ${PAYROLL_STATUS_LABEL[l.status] ?? PAYROLL_STATUS_FALLBACK}`
    : `หักคืนในใบ ${l.documentNumber}`;

/** ไอคอนคู่สถานะ — สถานะห้ามบอกด้วยสีอย่างเดียว */
const COMMISSION_STATUS_ICON: Record<CommissionStatus, LucideIcon> = {
  PENDING: Clock,
  APPROVED: CheckCircle,
  PAID: Banknote,
  CLAWED_BACK: Undo2,
  PARTIALLY_CLAWED_BACK: Undo2,
};

/** ใบจ่ายรายเดือนแบบเดิม (ดูอย่างเดียว) */
const payoutStatusMap: Record<string, StatusConfig> = {
  DRAFT: { variant: 'secondary', label: 'ร่าง' },
  APPROVED: { variant: 'primary', appearance: 'light', label: 'อนุมัติแล้ว' },
  PAID: { variant: 'success', appearance: 'light', label: 'จ่ายแล้ว' },
  CANCELLED: { variant: 'destructive', appearance: 'light', label: 'ยกเลิก' },
};

const baht = (v: number | string) => `${formatNumberDecimal(v, 2)} ฿`;
const ratePercent = (rate: string) => `${formatNumberDecimal(parseFloat(rate) * 100, 1)}%`;
const thisMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

// ui-ux-pro-max "Compact Label Overflow": ป้ายอยู่บรรทัดเดียวเสมอ — ตารางเลื่อนแนวนอนได้ (DataTable) แทนการตัดบรรทัด
const CHIP =
  'inline-flex w-max items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium leading-snug';

function PayrollLinkChip({ link, asLink }: { link: PayrollLink; asLink: boolean }) {
  const Icon = link.kind === 'PAY' ? FileText : Undo2;
  const tone =
    link.kind === 'PAY' ? 'border-primary/30 bg-primary/10 text-primary' : 'border-warning/40 bg-warning/10 text-warning-strong';
  const body = (
    <>
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {payrollLinkText(link)}
    </>
  );
  if (!asLink) return <span className={`${CHIP} ${tone}`}>{body}</span>;
  return (
    <Link
      to={`/expenses/${link.documentId}`}
      // ≥ 36 px ให้กดได้ (P2-R30) — ตัวป้ายยังเล็กเท่าเดิม
      className={`${CHIP} ${tone} min-h-9 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring`}
    >
      {body}
    </Link>
  );
}

/**
 * สถานะของแถว (กระดาน 4): ป้ายสถานะ + ชิปหนึ่งอันต่อรายการในใบเงินเดือน
 * - อนุมัติแล้วและอยู่ในใบเงินเดือนแล้ว → ชิป "อยู่ในใบเงินเดือน …" แทนป้าย "รอเข้าใบเงินเดือน"
 * - เรียกคืนที่ใบเงินเดือนยังต้องหัก → "เรียกคืน — รอหัก {n}" · พนักงานลาออกแล้ว → ให้เจ้าของตัดสิน (Decision 2)
 */
function CommissionStatusCell({ c, linkToPayroll }: { c: Commission; linkToPayroll: boolean }) {
  const links = c.payrollLinks ?? [];
  const outstanding = parseFloat(c.clawbackOutstanding ?? '0') || 0;
  const clawedBack = c.status === 'CLAWED_BACK' || c.status === 'PARTIALLY_CLAWED_BACK';
  let primary: ReactNode;
  if (clawedBack && outstanding > 0) {
    const resigned = c.salespersonResigned === true;
    const Icon = resigned ? UserX : Undo2;
    const amount = formatNumberDecimal(outstanding, 2);
    primary = (
      <>
        <span className={`${CHIP} border-warning/40 bg-warning/10 text-warning-strong`}>
          <Icon className="size-3 shrink-0" aria-hidden="true" />
          {resigned ? RESIGNED_LABEL : outstandingLabel(amount)}
        </span>
        {resigned && (
          <span className="text-xs font-medium text-warning-strong leading-snug">{resignedOutstandingLabel(amount)}</span>
        )}
      </>
    );
  } else if (c.status === 'APPROVED' && links.some((l) => l.kind === 'PAY')) {
    primary = null;
  } else {
    const cfg = getStatusBadgeProps(c.status, commissionStatusMap);
    const Icon = COMMISSION_STATUS_ICON[c.status];
    primary = (
      <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm" className="w-max whitespace-nowrap">
        {Icon && <Icon aria-hidden="true" />}
        {cfg.label}
      </Badge>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      {primary}
      {links.map((l, i) => (
        <PayrollLinkChip key={`${l.documentId}-${l.kind}-${i}`} link={l} asLink={linkToPayroll} />
      ))}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  iconClass,
  border,
  label,
  amount,
  note,
}: {
  icon: LucideIcon;
  iconClass: string;
  border: string;
  label: string;
  amount: number;
  note: string;
}) {
  return (
    <Card className={`hover:shadow-card-hover transition-all border-l-[3px] ${border}`}>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={`size-4 ${iconClass}`} aria-hidden="true" />
          <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">{label}</div>
        </div>
        <div className="text-2xl font-bold tabular-nums">{baht(amount)}</div>
        <div className="mt-1 text-xs text-muted-foreground leading-snug">{note}</div>
      </CardContent>
    </Card>
  );
}

export default function CommissionsPage() {
  useDocumentTitle('คอมมิชชัน');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isSales = user?.role === 'SALES';
  // อนุมัติได้ + เปิดหน้ารายจ่าย (/expenses/:id) ได้ — SALES ไม่ได้ทั้งสองอย่าง
  const canManage = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';

  const [activeTab, setActiveTab] = useState<Tab>('commissions');
  const [statusFilter, setStatusFilter] = useState('');
  const [periodMonth, setPeriodMonth] = useState(thisMonth);
  const [payoutPeriod, setPayoutPeriod] = useState(thisMonth);
  const [payoutStatusFilter, setPayoutStatusFilter] = useState('');

  const {
    data: listResp,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<{ rows: Commission[]; total: number }>({
    queryKey: ['commissions', statusFilter, periodMonth, isSales],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (isSales) params.set('salespersonId', 'me');
      if (statusFilter) params.set('status', statusFilter);
      // API อ่านเฉพาะ `period` (= SalesCommission.period 'YYYY-MM') — เดิมส่ง startDate/endDate ⇒ ได้ทุกเดือน
      if (periodMonth) params.set('period', periodMonth);
      // เพดานต่อหน้าของ API — การ์ดสรุปคิดจากรายการที่ได้ ⇒ ขอเต็มเพดาน
      params.set('limit', '100');
      const { data } = await api.get(`/commissions?${params}`);
      const rows: Commission[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      return { rows, total: typeof data?.total === 'number' ? data.total : rows.length };
    },
    enabled: activeTab === 'commissions',
  });
  const commissions = useMemo(() => listResp?.rows ?? [], [listResp]);
  const commissionTotal = listResp?.total ?? 0;

  const {
    data: payoutsResp,
    isLoading: payoutsLoading,
    isError: payoutsError,
    error: payoutsErr,
    refetch: refetchPayouts,
  } = useQuery<{ data: CommissionPayout[]; total: number }>({
    queryKey: ['commission-payouts', payoutPeriod, payoutStatusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (payoutPeriod) params.set('period', payoutPeriod);
      if (payoutStatusFilter) params.set('status', payoutStatusFilter);
      const { data } = await api.get(`/commissions/payouts?${params}`);
      return data;
    },
    enabled: activeTab === 'payouts',
  });

  const payouts = payoutsResp?.data || [];

  // POST /commissions/:id/approve (OWNER / FINANCE_MANAGER) — เดิมส่ง PATCH ⇒ 404 ทุกครั้ง
  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/commissions/${id}/approve`);
      return data;
    },
    onSuccess: () => {
      toast.success('อนุมัติคอมมิชชันสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['commissions'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // กระดาน 4 — ยอดของรายการที่ยังมีผล (เรียกคืนแล้วไม่นับในรวมเดือนนี้)
  const summary = useMemo(() => {
    const list = Array.isArray(commissions) ? commissions : [];
    const sum = (rows: Commission[]) => rows.reduce((s, c) => s + (parseFloat(c.commissionAmount) || 0), 0);
    const active = list.filter((c) => c.status === 'PENDING' || c.status === 'APPROVED' || c.status === 'PAID');
    const pending = list.filter((c) => c.status === 'PENDING');
    const approved = list.filter((c) => c.status === 'APPROVED');
    const inPayroll = approved.filter((c) => (c.payrollLinks ?? []).some((l) => l.kind === 'PAY')).length;
    const paid = list.filter((c) => c.status === 'PAID');
    return {
      total: sum(active),
      totalCount: active.length,
      pending: sum(pending),
      pendingCount: pending.length,
      approved: sum(approved),
      inPayroll,
      waiting: approved.length - inPayroll,
      paid: sum(paid),
    };
  }, [commissions]);

  const commissionColumns = useMemo(
    () => [
      ...(!isSales
        ? [
            {
              key: 'salesperson',
              label: 'พนักงานขาย',
              render: (c: Commission) => (
                <span className="text-sm font-medium leading-snug">{c.salesperson?.name || '-'}</span>
              ),
            },
          ]
        : []),
      {
        key: 'contract',
        label: 'สัญญา/ขาย',
        render: (c: Commission) => (
          <span className="text-sm font-mono">{c.contract?.contractNumber ?? c.sale?.saleNumber ?? '-'}</span>
        ),
      },
      {
        key: 'saleAmount',
        label: 'ยอดขาย',
        align: 'right' as const,
        render: (c: Commission) => <span className="text-sm tabular-nums">{baht(c.saleAmount)}</span>,
      },
      {
        key: 'commissionRate',
        label: 'อัตรา',
        align: 'right' as const,
        // เก็บเป็นสัดส่วน (0.0300 = 3%) — เดิมพิมพ์ตรง ๆ ได้ "0.0%" ทุกแถว
        render: (c: Commission) => <span className="text-sm tabular-nums">{ratePercent(c.commissionRate)}</span>,
      },
      {
        key: 'commissionAmount',
        label: 'คอมมิชชัน',
        align: 'right' as const,
        render: (c: Commission) => <span className="text-sm font-semibold tabular-nums">{baht(c.commissionAmount)}</span>,
      },
      {
        key: 'status',
        label: 'สถานะ',
        render: (c: Commission) => <CommissionStatusCell c={c} linkToPayroll={canManage} />,
      },
      ...(canManage
        ? [
            {
              key: 'actions',
              label: '',
              render: (c: Commission) =>
                c.status === 'PENDING' ? (
                  <button
                    data-ui-control="button"
                    type="button"
                    onClick={() => approveMutation.mutate(c.id)}
                    disabled={approveMutation.isPending}
                    aria-busy={approveMutation.isPending && approveMutation.variables === c.id}
                    className="min-h-9 px-3 py-1.5 text-xs font-medium leading-snug bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors disabled:opacity-50"
                  >
                    อนุมัติ
                  </button>
                ) : null,
            },
          ]
        : []),
    ],
    [isSales, canManage, approveMutation],
  );

  const payoutColumns = useMemo(
    () => [
      {
        key: 'salesperson',
        label: 'พนักงานขาย',
        render: (p: CommissionPayout) => (
          <span className="text-sm font-medium leading-snug">{p.salesperson?.name || '-'}</span>
        ),
      },
      {
        key: 'period',
        label: 'เดือน',
        render: (p: CommissionPayout) => <span className="text-sm font-mono">{p.period}</span>,
      },
      {
        key: 'commissionCount',
        label: 'จำนวนรายการ',
        render: (p: CommissionPayout) => <span className="text-sm">{p.commissionCount} รายการ</span>,
      },
      {
        key: 'totalSales',
        label: 'ยอดขายรวม',
        align: 'right' as const,
        render: (p: CommissionPayout) => <span className="text-sm tabular-nums">{baht(p.totalSales)}</span>,
      },
      {
        key: 'totalCommission',
        label: 'คอมมิชชันรวม',
        align: 'right' as const,
        render: (p: CommissionPayout) => (
          <span className="text-sm font-semibold tabular-nums text-primary">{baht(p.totalCommission)}</span>
        ),
      },
      {
        key: 'status',
        label: 'สถานะ',
        render: (p: CommissionPayout) => {
          const cfg = getStatusBadgeProps(p.status, payoutStatusMap);
          return (
            <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
              {cfg.label}
            </Badge>
          );
        },
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="คอมมิชชัน"
        // SALES อนุมัติไม่ได้ — คำบรรยายของคนที่อนุมัติได้เท่านั้นที่พูดเรื่องอนุมัติ (P2-R30)
        subtitle={canManage ? SUBTITLE_APPROVER : SUBTITLE_OWN}
        icon={<DollarSign className="size-5" />}
      />

      {canManage && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-info/40 bg-info/10 p-3">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold leading-snug">{BANNER_TITLE}</p>
            <p className="text-sm leading-snug">{BANNER_BODY}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        <button
          data-ui-control="button"
          type="button"
          onClick={() => setActiveTab('commissions')}
          aria-pressed={activeTab === 'commissions'}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium leading-snug border-b-2 transition-colors ${
            activeTab === 'commissions'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ListOrdered className="size-4" aria-hidden="true" />
          รายการคอมมิชชัน
        </button>
        {!isSales && (
          <button
            data-ui-control="button"
            type="button"
            onClick={() => setActiveTab('payouts')}
            aria-pressed={activeTab === 'payouts'}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium leading-snug border-b-2 transition-colors ${
              activeTab === 'payouts'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Sparkles className="size-4" aria-hidden="true" />
            ใบจ่ายรายเดือน
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground leading-snug">
              <Eye className="size-3 shrink-0" aria-hidden="true" />
              ดูอย่างเดียว
            </span>
          </button>
        )}
      </div>

      {/* ===== COMMISSIONS TAB ===== */}
      {activeTab === 'commissions' && (
        <>
          {commissionTotal > commissions.length && (
            <p role="status" className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground leading-snug">
              <Info className="size-3.5 shrink-0" aria-hidden="true" />
              {partialListText(commissions.length, commissionTotal)}
            </p>
          )}
          <div className="finance-card-grid grid grid-cols-2 md:grid-cols-4 gap-4 lg:gap-5 mb-6">
            <SummaryCard
              icon={DollarSign}
              iconClass="text-primary"
              border="border-l-primary"
              label="รวมเดือนนี้"
              amount={summary.total}
              note={`${summary.totalCount} รายการ`}
            />
            <SummaryCard
              icon={Clock}
              iconClass="text-warning-strong"
              border="border-l-warning"
              label="รออนุมัติ"
              amount={summary.pending}
              note={`${summary.pendingCount} รายการ — ยังไม่เข้าใบเงินเดือน`}
            />
            <SummaryCard
              icon={CheckCircle}
              iconClass="text-primary"
              border="border-l-primary"
              label="อนุมัติแล้ว"
              amount={summary.approved}
              note={`อยู่ในใบเงินเดือน ${summary.inPayroll} · รอดึง ${summary.waiting}`}
            />
            <SummaryCard
              icon={Banknote}
              iconClass="text-success"
              border="border-l-success"
              label="จ่ายแล้ว"
              amount={summary.paid}
              note="จ่ายเมื่อใบเงินเดือนลงบัญชี"
            />
          </div>

          <div className="flex gap-3 mb-4 flex-wrap">
            <input
              type="month"
              aria-label="เดือนคอมมิชชั่น"
              value={periodMonth}
              onChange={(e) => setPeriodMonth(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background focus:border-transparent"
            />
            <NativeSelect
              wrapperClassName="max-w-full w-auto"
              aria-label="สถานะ"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg text-sm"
            >
              <option value="">ทุกสถานะ</option>
              <option value="PENDING">รออนุมัติ</option>
              <option value="APPROVED">อนุมัติแล้ว</option>
              <option value="PAID">จ่ายแล้ว</option>
              <option value="PARTIALLY_CLAWED_BACK">เรียกคืนบางส่วน</option>
              <option value="CLAWED_BACK">เรียกคืน</option>
            </NativeSelect>
          </div>

          <QueryBoundary
            isLoading={isLoading}
            isError={isError}
            error={error}
            onRetry={refetch}
            errorTitle="ไม่สามารถโหลดข้อมูลคอมมิชชันได้"
          >
            <DataTable
              columns={commissionColumns}
              data={Array.isArray(commissions) ? commissions : []}
              emptyMessage="ไม่พบข้อมูลคอมมิชชัน"
            />
          </QueryBoundary>
        </>
      )}

      {/* ===== PAYOUTS TAB (ดูอย่างเดียว — ใบจ่ายรายเดือนแบบเดิม) ===== */}
      {activeTab === 'payouts' && (
        <>
          <div className="flex gap-3 mb-4 flex-wrap items-center">
            <input
              type="month"
              aria-label="เดือนของใบจ่าย"
              value={payoutPeriod}
              onChange={(e) => setPayoutPeriod(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background focus:border-transparent"
            />
            <NativeSelect
              wrapperClassName="max-w-full w-auto"
              aria-label="สถานะใบจ่าย"
              value={payoutStatusFilter}
              onChange={(e) => setPayoutStatusFilter(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg text-sm"
            >
              <option value="">ทุกสถานะ</option>
              <option value="DRAFT">ร่าง</option>
              <option value="APPROVED">อนุมัติแล้ว</option>
              <option value="PAID">จ่ายแล้ว</option>
              <option value="CANCELLED">ยกเลิก</option>
            </NativeSelect>
          </div>

          <QueryBoundary
            isLoading={payoutsLoading}
            isError={payoutsError}
            error={payoutsErr}
            onRetry={refetchPayouts}
            errorTitle="ไม่สามารถโหลดข้อมูลใบจ่ายได้"
          >
            <DataTable columns={payoutColumns} data={payouts} emptyMessage="ไม่พบข้อมูลใบจ่าย" />
          </QueryBoundary>
        </>
      )}
    </div>
  );
}
