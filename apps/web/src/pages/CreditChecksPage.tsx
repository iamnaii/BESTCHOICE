import ResponsiveFilterPanel from '@/components/ui/ResponsiveFilterPanel';
import { usePaginationParams } from '@/hooks/usePaginationParams';
import { PaginationBar } from '@/components/ui/PaginationBar';
import ContractReturnNotice from '@/components/credit-check/ContractReturnNotice';
import { customerCreditUrl } from '@/lib/contract-return';
import { creditHeadline, type StatementResult } from '@/pages/UnifiedInboxPage/components/credit-statement';
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDateShort } from '@/utils/formatters';
import { ShieldCheck, Loader2 } from 'lucide-react';
import CreditAffordabilityForm, { type CreditApprovalPayload, type CreditApprovalSnapshot } from '@/components/credit-check/CreditAffordabilityForm';

interface CreditCheckRow {
  approvals?: CreditApprovalSnapshot[];
  aiAnalysis?: StatementResult | null;
  id: string;
  status: string;
  checkType: string;
  aiScore: number | null;
  aiSummary: string | null;
  aiRecommendation: string | null;
  bankName: string | null;
  createdAt: string;
  customer: { id: string; name: string; phone: string | null; occupation: string | null } | null;
  contract: { id: string; contractNumber: string } | null;
  checkedBy: { id: string; name: string } | null;
}

interface CreditCheckResponse {
  data: CreditCheckRow[];
  total: number;
  page: number;
  totalPages: number;
  summary: {
    totalCount: number;
    pendingCount: number;
    approvedCount: number;
    rejectedCount: number;
    avgScore: number | null;
  };
}

const STATUS_META: Record<
  string,
  { label: string; variant: 'success' | 'destructive' | 'warning' | 'secondary' }
> = {
  APPROVED: { label: 'ผ่าน', variant: 'success' },
  REJECTED: { label: 'ไม่ผ่าน', variant: 'destructive' },
  MANUAL_REVIEW: { label: 'รอผู้จัดการตรวจ', variant: 'warning' },
  PENDING: { label: 'รอผลวิเคราะห์', variant: 'secondary' },
};

/** ต้องตรงกับ @Roles ของ POST /customers/:customerId/credit-check/:id/override */
const DECIDE_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'];

/** ต้องตรงกับ OverrideCreditCheckDto — เหตุผลสั้นกว่านี้ API ปฏิเสธ */
const MIN_REASON_LENGTH = 20;
const MAX_REASON_LENGTH = 2000;

export default function CreditChecksPage() {
  useDocumentTitle('ตรวจเครดิต');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const creditUrl = (customerId: string) => customerCreditUrl(customerId, searchParams.get('returnTo'));
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canDecide = DECIDE_ROLES.includes(user?.role ?? '');

  // ค่าเริ่มต้นคือคิวที่ต้องทำ ไม่ใช่ "ทั้งหมด" — หน้านี้มีไว้เคลียร์งานค้าง
  const [status, setStatus] = useState('MANUAL_REVIEW');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const { page, size, setPage, setSize } = usePaginationParams();
  const previousFilters = useRef([status, debouncedSearch].join('|'));
  useEffect(() => {
    const next = [status, debouncedSearch].join('|');
    if (previousFilters.current !== next) { previousFilters.current = next; setPage(1); }
  }, [status, debouncedSearch, setPage]);
  const [target, setTarget] = useState<{ row: CreditCheckRow; next: 'APPROVED' | 'REJECTED' } | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const [affordability, setAffordability] = useState<CreditApprovalPayload | null>(null);

  const query = useQuery<CreditCheckResponse>({
    queryKey: ['credit-checks', status, debouncedSearch, page, size],
    queryFn: async () => {
      const params: Record<string, string> = { page: String(page), limit: String(size) };
      if (status !== 'ALL') params.status = status;
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get('/credit-checks', { params });
      return data;
    },
  });

  useEffect(() => {
    if (query.data && page > Math.max(1, query.data.totalPages)) setPage(Math.max(1, query.data.totalPages));
  }, [query.data, page, setPage]);
  const decideMutation = useMutation({
    mutationFn: async ({ decision, overrideReason, approval }: {
      decision: NonNullable<typeof target>; overrideReason: string; approval: CreditApprovalPayload | null;
    }) => {
      if (!decision.row.customer) throw new Error('รายการนี้ไม่มีลูกค้าผูกอยู่');
      if (decision.next === 'APPROVED' && decision.row.checkType === 'FULL' && !approval) throw new Error('กรุณายืนยันยอดผ่อนก่อนอนุมัติ');
      await api.post(
        `/customers/${decision.row.customer.id}/credit-check/${decision.row.id}/override`,
        { status: decision.next, overrideReason, attachmentIds: [],
          ...(decision.next === 'APPROVED' && decision.row.checkType === 'FULL' ? { affordability: approval } : {}) },
      );
    },
    onSuccess: (_data, { decision }) => {
      toast.success(decision.next === 'APPROVED' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว');
      queryClient.invalidateQueries({ queryKey: ['credit-checks'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer'] });
      queryClient.invalidateQueries({ queryKey: ['customer-credit-checks'] });
      queryClient.invalidateQueries({ queryKey: ['customer-latest-credit'] });
      setAffordability(null);
      setTarget(null);
      setReason('');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const columns = [
    {
      key: 'customer',
      label: 'ลูกค้า',
      render: (c: CreditCheckRow) => (
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground leading-snug truncate">
            {c.customer?.name ?? '—'}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {c.customer?.phone ?? ''}
            {c.customer?.occupation ? ` · ${c.customer.occupation}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'aiScore',
      label: 'คะแนน AI',
      render: (c: CreditCheckRow) =>
        c.aiScore === null ? (
          // ยังไม่มีคะแนน = ยังไม่ได้อ่าน statement หรือ AI ล้มเหลว — ไม่ใช่คะแนน 0
          <span className="text-xs text-muted-foreground">ไม่มีคะแนน</span>
        ) : (
          <span
            className={`text-sm font-semibold tabular-nums ${
              c.aiScore >= 50 ? 'text-success' : c.aiScore >= 40 ? 'text-warning' : 'text-destructive'
            }`}
          >
            {c.aiScore}
          </span>
        ),
    },
    {
      key: 'aiSummary',
      label: 'AI ว่าอย่างไร',
      render: (c: CreditCheckRow) => c.aiAnalysis?.source === 'chat-statement' ? (
        <div className="space-y-1 text-sm leading-snug">
          {(() => { const headline = creditHeadline(c.aiAnalysis!); return headline ? <p className="font-medium text-primary">{headline.label} · {headline.amount.toLocaleString('th-TH')} บาท</p> : <p>อ่านสเตทเม้นแล้ว</p>; })()}
          {typeof c.aiAnalysis.roomId === 'string' && <a href={`/inbox/${c.aiAnalysis.roomId}`} onClick={event => event.stopPropagation()} className="text-xs text-primary underline">เปิดแชทต้นทาง</a>}
        </div>
      ) : (
        <span className="text-sm text-muted-foreground leading-snug line-clamp-2 max-w-md">
          {c.aiSummary ?? '—'}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (c: CreditCheckRow) => {
        const meta = STATUS_META[c.status] ?? { label: c.status, variant: 'secondary' as const };
        return (
          <div className="space-y-2">
            <Badge variant={meta.variant} appearance="light" size="sm">{meta.label}</Badge>
            {c.approvals?.[0] && <div className="text-xs space-y-1">
              <p className="font-medium">อนุมัติค่างวดไม่เกิน {Number(c.approvals[0].approvedMonthlyPayment).toLocaleString('th-TH')} บาท/เดือน</p>
              <p>ชำระ{c.approvals[0].salaryPayDay === 31 ? 'ทุกสิ้นเดือน' : `วันที่ ${c.approvals[0].salaryPayDay} ของเดือน`}</p>
              <p className="text-muted-foreground">{c.approvals[0].supersededAt ? 'ผลนี้ถูกแทนที่แล้ว' : c.approvals[0].usedByContractId ? 'นำไปใช้กับสัญญาแล้ว' : 'สำหรับสัญญาใหม่หนึ่งฉบับ'}</p>
            </div>}
          </div>
        );
      },
    },
    {
      key: 'createdAt',
      label: 'วันที่ตรวจ',
      render: (c: CreditCheckRow) => (
        <span className="text-sm">{formatDateShort(c.createdAt)}</span>
      ),
    },
    ...(canDecide
      ? [
          {
            key: 'actions',
            label: '',
            render: (c: CreditCheckRow) =>
              // Keep available transitions aligned with the override endpoint and role policy.
              c.customer && ['MANUAL_REVIEW', 'PENDING', 'APPROVED', 'REJECTED'].includes(c.status) ? (
                <div className="flex gap-1.5 justify-end">
                  {!(c.status === 'REJECTED' && user?.role === 'BRANCH_MANAGER') &&
                    !(c.status === 'APPROVED' && c.checkType !== 'FULL') && <Button
                    disabled={decideMutation.isPending}
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAffordability(null); setReason('');
                      setTarget({ row: c, next: 'APPROVED' });
                    }}
                  >
                    {c.status === 'APPROVED' ? 'ทบทวนยอดอนุมัติ' : 'อนุมัติ'}
                  </Button>}
                  {c.status !== 'REJECTED' && <Button
                    disabled={decideMutation.isPending}
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAffordability(null); setReason('');
                      setTarget({ row: c, next: 'REJECTED' });
                    }}
                  >
                    ไม่อนุมัติ
                  </Button>}
                </div>
              ) : null,
          },
        ]
      : []),
  ];

  const summary = query.data?.summary;
  const reasonInvalid = reason.trim().length < MIN_REASON_LENGTH || reason.trim().length > MAX_REASON_LENGTH;

  return (
    <div>
      <PageHeader
        title="ตรวจเครดิต"
        subtitle="คิวผลตรวจเครดิตที่รอผู้จัดการตัดสิน"
      />

      <ContractReturnNotice />

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {[
            { label: 'รอตรวจ', value: summary.pendingCount, tone: 'text-warning' },
            { label: 'ผ่าน', value: summary.approvedCount, tone: 'text-success' },
            { label: 'ไม่ผ่าน', value: summary.rejectedCount, tone: 'text-destructive' },
            { label: 'คะแนนเฉลี่ย', value: summary.avgScore ?? 'ยังไม่มีคะแนน', tone: 'text-foreground' },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1 leading-snug">{s.label}</div>
                <div className={`text-2xl font-bold tabular-nums ${s.tone}`}>{s.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}


            <ResponsiveFilterPanel search={
              <input
                type="text"
                placeholder="ค้นหาชื่อลูกค้า..."
                aria-label="ค้นหารายการตรวจเครดิต" value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="px-3 py-2 border border-input rounded-lg text-sm bg-background outline-hidden focus:ring-2 focus:ring-ring/30 w-full min-w-0"
              />
            }>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-10 w-auto min-w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANUAL_REVIEW">รอผู้จัดการตรวจ</SelectItem>
                  <SelectItem value="PENDING">รอผลวิเคราะห์</SelectItem>
                  <SelectItem value="APPROVED">ผ่าน</SelectItem>
                  <SelectItem value="REJECTED">ไม่ผ่าน</SelectItem>
                  <SelectItem value="ALL">ทั้งหมด</SelectItem>
                </SelectContent>
              </Select>
            </ResponsiveFilterPanel>

      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        <DataTable
          columns={columns}
          data={query.data?.data ?? []}
          emptyIcon={ShieldCheck}
          emptyMessage={
            status === 'MANUAL_REVIEW'
              ? 'ไม่มีรายการรอตรวจ — เคลียร์หมดแล้ว'
              : 'ไม่พบรายการตรวจเครดิต'
          }
          onRowClick={(c: CreditCheckRow) =>
            c.customer && navigate(creditUrl(c.customer.id))
          }

        />
        {query.data && <PaginationBar total={query.data.total} page={page} size={size} onPageChange={setPage} onSizeChange={setSize} />}
      </QueryBoundary>

      <Dialog open={!!target} onOpenChange={(open) => !open && !decideMutation.isPending && setTarget(null)}>
        <DialogContent showCloseButton={!decideMutation.isPending} className="flex max-w-[calc(100%-2rem)] flex-col sm:max-w-2xl max-h-[90dvh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {target?.next === 'APPROVED' ? 'อนุมัติผลตรวจเครดิต' : 'ไม่อนุมัติผลตรวจเครดิต'}
            </DialogTitle>
            <DialogDescription className="leading-snug">
              {target?.row.customer?.name}
              {target?.row.checkType === 'FULL' ? ' · ตรวจเต็ม' : ' · ตรวจเบื้องต้น'}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto space-y-4">
          {target?.row.customer && <a className="text-sm text-primary underline" href={creditUrl(target.row.customer.id)} target="_blank" rel="noopener noreferrer">เปิดหลักฐานและประวัติเครดิต</a>}
          {target?.next === 'APPROVED' && target.row.checkType !== 'FULL' && <p className="text-sm text-muted-foreground">ผลตรวจเบื้องต้นยังไม่ใช่ยอดผ่อนที่ใช้เปิดสัญญา ต้องตรวจเต็มและยืนยันยอดผ่อนก่อนสร้างสัญญา</p>}
          <fieldset disabled={decideMutation.isPending} className="min-w-0 space-y-4">
          {target?.row.aiRecommendation && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm leading-snug">
              <div className="text-xs text-muted-foreground mb-1">คำแนะนำจาก AI</div>
              {target.row.aiRecommendation}
            </div>
          )}

          {target?.next === 'APPROVED' && target.row.checkType === 'FULL' && <CreditAffordabilityForm
            key={target.row.id} creditCheckId={target.row.id} onChange={setAffordability} />}

          <div>
            <label
              htmlFor="override-reason"
              className="block text-sm font-medium text-foreground mb-1.5 leading-snug"
            >
              เหตุผล (อย่างน้อย {MIN_REASON_LENGTH} ตัวอักษร)
            </label>
            <Textarea
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={MAX_REASON_LENGTH}
              placeholder="เช่น ลูกค้านำสลิปเงินเดือนเพิ่มมาแสดง รายได้เพียงพอต่อค่างวด"
            />
            <p className="text-xs text-muted-foreground mt-1 tabular-nums">
              {reason.trim().length}/{MIN_REASON_LENGTH}
            </p>
          </div>

          </fieldset>
          </div>
          {target?.next === 'APPROVED' && target.row.checkType === 'FULL' && !affordability && <p className="text-xs text-muted-foreground">กรอกตัวเลขและหลักฐาน คำนวณเพดาน แล้วติ๊กยืนยันก่อนบันทึก</p>}
          <DialogFooter className="shrink-0">
            <Button variant="outline" disabled={decideMutation.isPending} onClick={() => setTarget(null)}>
              ยกเลิก
            </Button>
            <Button
              variant="primary"
              disabled={reasonInvalid || decideMutation.isPending || (target?.next === 'APPROVED' && target.row.checkType === 'FULL' && !affordability)}
              onClick={() => target && decideMutation.mutate({ decision: target, overrideReason: reason.trim(), approval: affordability })}
            >
              {decideMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              ยืนยัน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
