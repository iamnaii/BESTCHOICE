import { getProtectedDocumentResponse, getDocumentErrorMessage } from '@/lib/document-download';
import { useState, useEffect, useRef } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { RefreshCw, Plus, Search, X } from 'lucide-react';
import TradeInProductHandoff from '@/components/trade-in/TradeInProductHandoff';
import Modal from '@/components/ui/Modal';
import QuickBuyModal from '@/components/trade-in/QuickBuyModal';
import TradeInTable from './components/TradeInTable';
import AppraisalModal from './components/AppraisalModal';
import AcceptModal from './components/AcceptModal';
import ValuationsTab from './components/ValuationsTab';
import QuestionnaireTab from './components/QuestionnaireTab';
import TradeInDetailDialog from './components/TradeInDetailDialog';
import OnlineAppraiseModal from './components/OnlineAppraiseModal';
import VoucherPdfPreview from './components/VoucherPdfPreview';
import type {
  TradeIn,
  TradeInsResponse,
  AcceptFormState,
  AcceptRequest,
  TradeInSubmissionSource,
  TradeInFlow,
} from './types';
import { EMPTY_ACCEPT_FORM } from './types';

type SourceFilter = 'ALL' | TradeInSubmissionSource;
type FlowFilter = 'ALL' | TradeInFlow;

/**
 * Segmented control — one visual container with an inset active pill, instead of
 * loose pills that read as N independent buttons.
 * Radio semantics (not tabs): each group is "pick one of N", and the panels these
 * drive aren't wired as tabpanels.
 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  label,
  ariaLabel,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** Visible caption to the left of the group. */
  label?: string;
  /** Accessible name when there is no visible caption. */
  ariaLabel?: string;
}) {
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      {label && <span className="text-xs leading-snug text-muted-foreground">{label}</span>}
      <div
        role="radiogroup"
        aria-label={ariaLabel ?? label}
        className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5"
      >
        {options.map(([key, text]) => {
          const active = value === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(key)}
              className={cn(
                'rounded-md leading-snug whitespace-nowrap transition-colors',
                size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-1.5 text-sm',
                active
                  ? 'bg-card font-medium text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const TAB_OPTIONS = [
  ['list', 'รายการรับซื้อ'],
  ['valuations', 'ตารางราคากลาง'],
  ['questions', 'แบบตรวจสภาพ'],
] as const;

const SOURCE_OPTIONS = [
  ['ALL', 'ทั้งหมด'],
  ['ONLINE', 'ออนไลน์'],
  ['OFFLINE', 'หน้าร้าน'],
] as const;

const FLOW_OPTIONS = [
  ['ALL', 'ทั้งหมด'],
  ['EXCHANGE', 'เทิร์นเครื่อง'],
  ['BUYBACK', 'รับซื้อ'],
] as const;

export default function TradeInPage() {
  useDocumentTitle('รับซื้อเครื่อง');
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');

  const [tab, setTab] = useState<'list' | 'valuations' | 'questions'>('list');

  const [page, setPage] = useState(1);
  const [showQuickBuy, setShowQuickBuy] = useState(false);
  const [received, setReceived] = useState<{ id: string; productId: string; voucherNumber?: string } | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('ALL');
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('ALL');

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 400);
  // ค่า search เปลี่ยน → กลับหน้า 1 เสมอ (กันหน้าเกินจำนวนผลลัพธ์ใหม่)
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  // Appraise modal state
  const [appraiseModal, setAppraiseModal] = useState<TradeIn | null>(null);

  // Accept modal state
  const [acceptModal, setAcceptModal] = useState<TradeIn | null>(null);
  const [acceptForm, setAcceptForm] = useState<AcceptFormState>(EMPTY_ACCEPT_FORM);

  // Detail dialog + online-appraise modal state
  const [detailId, setDetailId] = useState<string | null>(null);
  const [onlineAppraise, setOnlineAppraise] = useState<TradeIn | null>(null);

  /* ─── Query ─── */

  const { data, isLoading, isError, error, refetch } = useQuery<TradeInsResponse>({
    queryKey: ['trade-ins', page, sourceFilter, flowFilter, debouncedSearch],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 50 };
      if (sourceFilter !== 'ALL') params.submissionSource = sourceFilter;
      if (flowFilter !== 'ALL') params.flow = flowFilter;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      const res = await api.get('/trade-ins', { params });
      return res.data;
    },
  });

  /* ─── Mutations ─── */

  const acceptMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: AcceptRequest }) =>
      api.post(`/trade-ins/${id}/accept`, { ...body, deviceOrigin: body.deviceOrigin || null }),
    onSuccess: (res) => {
      if (res.data.productId) setReceived(res.data);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['qc-pending-count'] });
      toast.success('ยอมรับการรับซื้อเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
      queryClient.invalidateQueries({ queryKey: ['trade-in-detail'] });
      setAcceptModal(null);
      setAcceptForm(EMPTY_ACCEPT_FORM);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/trade-ins/${id}/reject`),
    onSuccess: () => {
      toast.success('ปฏิเสธการรับซื้อ');
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
      queryClient.invalidateQueries({ queryKey: ['trade-in-detail'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // Track ว่ากำลังเปิด PDF ใบไหนอยู่ — โชว์ spinner ที่ปุ่มนั้น
  const [voucherLoadingId, setVoucherLoadingId] = useState<string | null>(null);
  const [voucherPreview, setVoucherPreview] = useState<{ blob: Blob; filename: string; requestId: number } | null>(null);
  const voucherRequest = useRef(0);
  useEffect(() => () => { voucherRequest.current += 1; }, []);

  function closeVoucherPreview() {
    voucherRequest.current += 1;
    setVoucherLoadingId(null);
    setVoucherPreview(null);
  }

  const generateVoucherMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/trade-ins/${id}/voucher`),
    onMutate: (id) => {
      setVoucherLoadingId(id);
      return { requestId: ++voucherRequest.current };
    },
    onSuccess: async (res, id, context) => {
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
      queryClient.invalidateQueries({ queryKey: ['trade-in-detail'] });
      if (context.requestId !== voucherRequest.current) return;
      toast.success(`ออกใบสำคัญเลขที่ ${res.data.voucherNumber}`);
      await openVoucherPdf(id, context.requestId);
    },
    onError: (err, _id, context) => {
      if (context?.requestId !== voucherRequest.current) return;
      setVoucherLoadingId(null);
      toast.error(getErrorMessage(err));
    },
  });

  /* ─── Helpers ─── */

  // Keep JWT/company scope and the server filename when previewing the authenticated PDF.
  async function openVoucherPdf(id: string, requestId = ++voucherRequest.current) {
    setVoucherLoadingId(id);
    try {
      const res = await getProtectedDocumentResponse(`/trade-ins/${id}/voucher.pdf`);
      if (requestId !== voucherRequest.current) return;
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const disposition = String(res.headers['content-disposition'] || '');
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const filename = encodedName ? decodeURIComponent(encodedName)
        : disposition.match(/filename="([^"]+)"/i)?.[1] || 'ใบสำคัญรับเครื่อง.pdf';
      setVoucherPreview({ blob, filename, requestId });
    } catch (err) {
      if (requestId === voucherRequest.current) toast.error(getDocumentErrorMessage(err));
    } finally {
      if (requestId === voucherRequest.current) setVoucherLoadingId(null);
    }
  }

  function handleVoucher(item: TradeIn) {
    if (item.voucherNumber) {
      openVoucherPdf(item.id);
    } else {
      generateVoucherMutation.mutate(item.id);
    }
  }

  const hasActiveFilters =
    sourceFilter !== 'ALL' || flowFilter !== 'ALL' || searchInput.trim() !== '';

  function clearFilters() {
    setSourceFilter('ALL');
    setFlowFilter('ALL');
    setSearchInput('');
    setPage(1);
  }

  function handleCloseAccept() {
    setAcceptModal(null);
    setAcceptForm(EMPTY_ACCEPT_FORM);
  }

  /* ─── Render ─── */

  return (
    <div>
      <PageHeader
        title="รับซื้อเครื่อง"
        subtitle="จัดการรายการรับซื้อเครื่องมือถือ / อุปกรณ์"
        icon={<RefreshCw className="size-5" />}
        action={
          <Button
            onClick={() => setShowQuickBuy(true)}
            className="bg-success hover:bg-success/90 text-success-foreground"
          >
            <Plus className="size-4 mr-1.5" />
            รับซื้อเครื่อง
          </Button>
        }
      />

      <QuickBuyModal
        open={showQuickBuy}
        onClose={() => setShowQuickBuy(false)}
        onIncomplete={(id) => {
          queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
          queryClient.invalidateQueries({ queryKey: ['trade-in-detail'] });
          setDetailId(id);
        }}
        onSuccess={(result) => {
          queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
          queryClient.invalidateQueries({ queryKey: ['trade-in-detail'] });
          queryClient.invalidateQueries({ queryKey: ['products'] });
          queryClient.invalidateQueries({ queryKey: ['qc-pending-count'] });
          setReceived(result);
        }}
      />

      <Modal isOpen={!!received} onClose={() => setReceived(null)} title="รับเครื่องเรียบร้อย" size="md">
        {received && <div className="space-y-4">
          <TradeInProductHandoff productId={received.productId} />
          <Button variant="outline" disabled={voucherLoadingId === received.id || generateVoucherMutation.isPending}
            onClick={() => received.voucherNumber ? openVoucherPdf(received.id) : generateVoucherMutation.mutate(received.id)}>
            พิมพ์เอกสารรับเครื่อง
          </Button>
        </div>}
      </Modal>

      {canManage && (
        <div className="mb-4">
          <Segmented
            value={tab}
            options={TAB_OPTIONS}
            onChange={setTab}
            ariaLabel="มุมมองหน้ารับซื้อเครื่อง"
          />
        </div>
      )}
      {tab === 'valuations' && <ValuationsTab />}
      {tab === 'questions' && <QuestionnaireTab />}

      {tab === 'list' && (
        <>
          <TradeInTable
            /* Filters live in the table's own toolbar so the list reads as one
               surface instead of three stacked bars. */
            filters={
              <div className="flex w-full min-w-0 flex-wrap items-center gap-3">
                <div className="relative w-full sm:w-72">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="ค้นหา ชื่อ/เบอร์ผู้ขาย, IMEI, รุ่น, เลขใบสำคัญ..."
                    className="h-8 w-full pl-9"
                    aria-label="ค้นหารายการรับซื้อ"
                  />
                </div>
                <Segmented
                  label="ที่มา"
                  size="sm"
                  value={sourceFilter}
                  options={SOURCE_OPTIONS}
                  onChange={(v) => {
                    setSourceFilter(v);
                    setPage(1);
                  }}
                />
                <Segmented
                  label="ประเภท"
                  size="sm"
                  value={flowFilter}
                  options={FLOW_OPTIONS}
                  onChange={(v) => {
                    setFlowFilter(v);
                    setPage(1);
                  }}
                />
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    <X className="size-3.5" />
                    ล้างตัวกรอง
                  </Button>
                )}
              </div>
            }
            data={data?.data}
            total={data?.total}
            page={page}
            isLoading={isLoading}
            isError={isError}
            error={error}
            canManage={canManage}
            onRefetch={refetch}
            onPageChange={setPage}
            onAppraise={(item) => {
              if (item.quoteBreakdown) { setOnlineAppraise(item); return; }
              setAppraiseModal(item);
            }}
            onAccept={setAcceptModal}
            onReject={(id) => rejectMutation.mutate(id)}
            onVoucher={handleVoucher}
            onDetail={(item) => setDetailId(item.id)}
            isRejectPending={rejectMutation.isPending}
            voucherLoadingId={voucherLoadingId ?? (generateVoucherMutation.isPending ? (generateVoucherMutation.variables ?? null) : null)}
          />

          <AppraisalModal item={appraiseModal} onClose={() => setAppraiseModal(null)} />

          <AcceptModal
            item={acceptModal}
            form={acceptForm}
            isPending={acceptMutation.isPending}
            onChange={(patch) => setAcceptForm((f) => ({ ...f, ...patch }))}
            onConfirm={(id, body) => acceptMutation.mutate({ id, body })}
            onClose={handleCloseAccept}
          />

          <TradeInDetailDialog id={detailId} onClose={() => setDetailId(null)} onVoucher={handleVoucher}
            voucherLoading={voucherLoadingId === detailId || generateVoucherMutation.isPending} />
          <OnlineAppraiseModal item={onlineAppraise} onClose={() => setOnlineAppraise(null)} />
        </>
      )}
      {voucherPreview && <VoucherPdfPreview key={voucherPreview.requestId} {...voucherPreview} onClose={closeVoucherPreview} />}
    </div>
  );
}
