import { useState, useEffect } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RefreshCw, Plus } from 'lucide-react';
import QuickBuyModal from '@/components/trade-in/QuickBuyModal';
import TradeInTable from './components/TradeInTable';
import AppraisalModal from './components/AppraisalModal';
import AcceptModal from './components/AcceptModal';
import ValuationsTab from './components/ValuationsTab';
import QuestionnaireTab from './components/QuestionnaireTab';
import TradeInDetailDialog from './components/TradeInDetailDialog';
import OnlineAppraiseModal from './components/OnlineAppraiseModal';
import type {
  TradeIn,
  TradeInsResponse,
  AcceptFormState,
  TradeInSubmissionSource,
  TradeInFlow,
} from './types';
import { EMPTY_ACCEPT_FORM } from './types';

type SourceFilter = 'ALL' | TradeInSubmissionSource;
type FlowFilter = 'ALL' | TradeInFlow;

export default function TradeInPage() {
  useDocumentTitle('รับซื้อเครื่อง');
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');

  const [tab, setTab] = useState<'list' | 'valuations' | 'questions'>('list');

  const [page, setPage] = useState(1);
  const [showQuickBuy, setShowQuickBuy] = useState(false);
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
  const [appraiseValue, setAppraiseValue] = useState('');
  const [appraiseCondition, setAppraiseCondition] = useState('B');

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

  const appraiseMutation = useMutation({
    mutationFn: async ({
      id,
      value,
      condition,
    }: {
      id: string;
      value: number;
      condition: string;
    }) =>
      api.patch(`/trade-ins/${id}/appraise`, {
        offeredPrice: value,
        deviceCondition: condition,
      }),
    onSuccess: () => {
      toast.success('ประเมินราคาเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
      setAppraiseModal(null);
      setAppraiseValue('');
      setAppraiseCondition('B');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const acceptMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: AcceptFormState & { branchId?: string } }) =>
      api.post(`/trade-ins/${id}/accept`, body),
    onSuccess: () => {
      toast.success('ยอมรับการรับซื้อเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
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
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // Track ว่ากำลังเปิด PDF ใบไหนอยู่ — โชว์ spinner ที่ปุ่มนั้น
  const [voucherLoadingId, setVoucherLoadingId] = useState<string | null>(null);

  const generateVoucherMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/trade-ins/${id}/voucher`),
    onSuccess: async (res, id) => {
      toast.success(`ออกใบสำคัญเลขที่ ${res.data.voucherNumber}`);
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
      await openVoucherPdf(id);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  /* ─── Helpers ─── */

  // ดาวน์โหลด PDF เป็น blob (ผ่าน axios — ส่ง JWT แนบ) แล้วเปิดในแท็บใหม่
  async function openVoucherPdf(id: string) {
    setVoucherLoadingId(id);
    try {
      const res = await api.get(`/trade-ins/${id}/voucher.pdf`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // revoke ภายหลัง 60 วิ ให้แท็บใหม่โหลดเสร็จก่อน
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setVoucherLoadingId(null);
    }
  }

  function handleVoucher(item: TradeIn) {
    if (item.voucherNumber) {
      openVoucherPdf(item.id);
    } else {
      generateVoucherMutation.mutate(item.id);
    }
  }

  function handleCloseAppraise() {
    setAppraiseModal(null);
    setAppraiseValue('');
    setAppraiseCondition('B');
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
        onSuccess={(id) => {
          queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
          openVoucherPdf(id);
        }}
      />

      {canManage && (
        <div className="flex items-center gap-1.5 mb-4">
          {(
            [
              ['list', 'รายการรับซื้อ'],
              ['valuations', 'ตารางราคากลาง'],
              ['questions', 'แบบประเมินออนไลน์'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-md text-sm leading-snug transition-colors ${
                tab === key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === 'valuations' && <ValuationsTab />}
      {tab === 'questions' && <QuestionnaireTab />}

      {tab === 'list' && (
        <>
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="ค้นหา ชื่อ/เบอร์ผู้ขาย, IMEI, รุ่น, เลขใบสำคัญ..."
              className="h-8 w-full sm:w-72"
            />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground leading-snug">ที่มา:</span>
              {(['ALL', 'ONLINE', 'OFFLINE'] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => {
                    setSourceFilter(opt);
                    setPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs leading-snug transition-colors ${
                    sourceFilter === opt
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {opt === 'ALL' ? 'ทั้งหมด' : opt === 'ONLINE' ? 'ออนไลน์' : 'หน้าร้าน'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground leading-snug">ประเภท:</span>
              {(['ALL', 'EXCHANGE', 'BUYBACK'] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => {
                    setFlowFilter(opt);
                    setPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs leading-snug transition-colors ${
                    flowFilter === opt
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {opt === 'ALL' ? 'ทั้งหมด' : opt === 'EXCHANGE' ? 'เทิร์นเครื่อง' : 'รับซื้อ'}
                </button>
              ))}
            </div>
          </div>

          <TradeInTable
            data={data?.data}
            total={data?.total}
            page={page}
            isLoading={isLoading}
            isError={isError}
            error={error}
            canManage={canManage}
            onRefetch={refetch}
            onPageChange={setPage}
            onAppraise={(item) => (item.quoteBreakdown ? setOnlineAppraise(item) : setAppraiseModal(item))}
            onAccept={setAcceptModal}
            onReject={(id) => rejectMutation.mutate(id)}
            onVoucher={handleVoucher}
            onDetail={(item) => setDetailId(item.id)}
            isRejectPending={rejectMutation.isPending}
            voucherLoadingId={voucherLoadingId ?? (generateVoucherMutation.isPending ? (generateVoucherMutation.variables ?? null) : null)}
          />

          <AppraisalModal
            item={appraiseModal}
            value={appraiseValue}
            condition={appraiseCondition}
            isPending={appraiseMutation.isPending}
            onValueChange={setAppraiseValue}
            onConditionChange={setAppraiseCondition}
            onConfirm={(id, value, condition) => appraiseMutation.mutate({ id, value, condition })}
            onClose={handleCloseAppraise}
          />

          <AcceptModal
            item={acceptModal}
            form={acceptForm}
            isPending={acceptMutation.isPending}
            onChange={(patch) => setAcceptForm((f) => ({ ...f, ...patch }))}
            onConfirm={(id, body) => acceptMutation.mutate({ id, body })}
            onClose={handleCloseAccept}
          />

          <TradeInDetailDialog id={detailId} onClose={() => setDetailId(null)} />
          <OnlineAppraiseModal item={onlineAppraise} onClose={() => setOnlineAppraise(null)} />
        </>
      )}
    </div>
  );
}
