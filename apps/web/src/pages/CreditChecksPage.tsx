import { useState } from 'react';
import { useNavigate } from 'react-router';
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

interface CreditCheckRow {
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
    avgScore: number;
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

export default function CreditChecksPage() {
  useDocumentTitle('ตรวจเครดิต');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canDecide = DECIDE_ROLES.includes(user?.role ?? '');

  // ค่าเริ่มต้นคือคิวที่ต้องทำ ไม่ใช่ "ทั้งหมด" — หน้านี้มีไว้เคลียร์งานค้าง
  const [status, setStatus] = useState('MANUAL_REVIEW');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [target, setTarget] = useState<{ row: CreditCheckRow; next: 'APPROVED' | 'REJECTED' } | null>(
    null,
  );
  const [reason, setReason] = useState('');

  const query = useQuery<CreditCheckResponse>({
    queryKey: ['credit-checks', status, debouncedSearch],
    queryFn: async () => {
      const params: Record<string, string> = { limit: '50' };
      if (status !== 'ALL') params.status = status;
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get('/credit-checks', { params });
      return data;
    },
  });

  const decideMutation = useMutation({
    mutationFn: async () => {
      if (!target?.row.customer) throw new Error('รายการนี้ไม่มีลูกค้าผูกอยู่');
      await api.post(
        `/customers/${target.row.customer.id}/credit-check/${target.row.id}/override`,
        { status: target.next, overrideReason: reason, attachmentIds: [] },
      );
    },
    onSuccess: () => {
      toast.success(target?.next === 'APPROVED' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว');
      queryClient.invalidateQueries({ queryKey: ['credit-checks'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
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
      render: (c: CreditCheckRow) => (
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
          <Badge variant={meta.variant} appearance="light" size="sm">
            {meta.label}
          </Badge>
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
              // ตัดสินได้เฉพาะรายการที่ยังรออยู่ และต้องมีลูกค้าผูกอยู่
              // (endpoint override เป็น /customers/:customerId/... จึงต้องมี id)
              c.customer && (c.status === 'MANUAL_REVIEW' || c.status === 'PENDING') ? (
                <div className="flex gap-1.5 justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTarget({ row: c, next: 'APPROVED' });
                    }}
                  >
                    อนุมัติ
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTarget({ row: c, next: 'REJECTED' });
                    }}
                  >
                    ไม่อนุมัติ
                  </Button>
                </div>
              ) : null,
          },
        ]
      : []),
  ];

  const summary = query.data?.summary;
  const reasonTooShort = reason.trim().length < MIN_REASON_LENGTH;

  return (
    <div>
      <PageHeader
        title="ตรวจเครดิต"
        subtitle="คิวผลตรวจเครดิตที่รอผู้จัดการตัดสิน"
      />

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {[
            { label: 'รอตรวจ', value: summary.pendingCount, tone: 'text-warning' },
            { label: 'ผ่าน', value: summary.approvedCount, tone: 'text-success' },
            { label: 'ไม่ผ่าน', value: summary.rejectedCount, tone: 'text-destructive' },
            { label: 'คะแนนเฉลี่ย', value: summary.avgScore, tone: 'text-foreground' },
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
            c.customer && navigate(`/customers/${c.customer.id}`)
          }
          toolbar={
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                placeholder="ค้นหาชื่อลูกค้า..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="px-3 py-2 border border-input rounded-lg text-sm bg-background outline-hidden focus:ring-2 focus:ring-ring/30 min-w-56"
              />
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
            </div>
          }
        />
      </QueryBoundary>

      <Dialog open={!!target} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {target?.next === 'APPROVED' ? 'อนุมัติผลตรวจเครดิต' : 'ไม่อนุมัติผลตรวจเครดิต'}
            </DialogTitle>
            <DialogDescription className="leading-snug">
              {target?.row.customer?.name}
              {target?.row.aiScore !== null && target?.row.aiScore !== undefined
                ? ` · คะแนน AI ${target.row.aiScore}`
                : ' · ไม่มีคะแนน AI'}
            </DialogDescription>
          </DialogHeader>

          {target?.row.aiRecommendation && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm leading-snug">
              <div className="text-xs text-muted-foreground mb-1">คำแนะนำจาก AI</div>
              {target.row.aiRecommendation}
            </div>
          )}

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
              placeholder="เช่น ลูกค้านำสลิปเงินเดือนเพิ่มมาแสดง รายได้เพียงพอต่อค่างวด"
            />
            <p className="text-xs text-muted-foreground mt-1 tabular-nums">
              {reason.trim().length}/{MIN_REASON_LENGTH}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              ยกเลิก
            </Button>
            <Button
              variant="primary"
              disabled={reasonTooShort || decideMutation.isPending}
              onClick={() => decideMutation.mutate()}
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
