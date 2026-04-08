import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import { RefreshCw, Plus, Search, CheckCircle, XCircle, FileText, CreditCard, Upload, AlertTriangle, Zap } from 'lucide-react';
import { brands, getModels } from '@/data/productCatalog';
import SignaturePadFull from '@/components/signing/SignaturePadFull';
import QuickBuyModal from '@/components/trade-in/QuickBuyModal';

/** Map color name (English/Thai) to a hex value for preview swatches */
function colorNameToHex(name: string): string {
  const n = name.toLowerCase().trim();
  const map: Record<string, string> = {
    black: '#1a1a1a', 'space black': '#1c1c1e', 'black titanium': '#3a3a3c',
    'jet black': '#0a0a0a', 'midnight': '#171821', graphite: '#54524f',
    white: '#f5f5f7', 'cloud white': '#f8f8f8', 'white titanium': '#e8e8e8',
    silver: '#c0c0c0', 'starlight': '#faf6ef',
    gold: '#f7e7ce', 'light gold': '#fce8c8', rose: '#f7d4d4', 'rose gold': '#e8b4a8',
    blue: '#5b8def', 'sky blue': '#87ceeb', 'pacific blue': '#2e4a6b',
    'deep blue': '#1e3a8a', 'mist blue': '#a8c5d6', 'sierra blue': '#a7c1d9',
    'desert titanium': '#cdb692', 'natural titanium': '#a39a8e',
    purple: '#a78bfa', 'deep purple': '#5d4e7b', lavender: '#c8b2dd',
    pink: '#ffb6c1', 'cosmic orange': '#ff6b35', orange: '#ff9500',
    red: '#ff3b30', 'product red': '#cc0000',
    green: '#34c759', sage: '#bcd5ba', mint: '#a8e6cf', 'alpine green': '#576856',
    yellow: '#ffd60a', teal: '#5ac8fa', ultramarine: '#5e60ce',
  };
  for (const [key, val] of Object.entries(map)) {
    if (n.includes(key)) return val;
  }
  return '#9ca3af'; // gray fallback
}

/* ─── Types ─── */

interface TradeIn {
  id: string;
  status: string;
  deviceBrand: string;
  deviceModel: string;
  deviceStorage: string | null;
  deviceColor?: string | null;
  deviceCondition: string | null;
  imei: string | null;
  estimatedValue: number | null;
  offeredPrice: number | null;
  agreedPrice: number | null;
  sellerName: string | null;
  sellerPhone: string | null;
  voucherNumber: string | null;
  voucherPdfUrl: string | null;
  createdAt: string;
  customer: { id: string; name: string } | null;
}

interface TradeInsResponse {
  data: TradeIn[];
  total: number;
  page: number;
  limit: number;
}

const statusConfig: Record<string, { label: string; variant: 'primary' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' }> = {
  PENDING_APPRAISAL: { label: 'รอประเมิน', variant: 'warning' },
  APPRAISED: { label: 'ประเมินแล้ว', variant: 'primary' },
  ACCEPTED: { label: 'ยอมรับ', variant: 'success' },
  REJECTED: { label: 'ปฏิเสธ', variant: 'destructive' },
  COMPLETED: { label: 'เสร็จสิ้น', variant: 'secondary' },
};

const conditionOptions = [
  { value: 'A', label: 'A — ดีเยี่ยม' },
  { value: 'B', label: 'B — ดี' },
  { value: 'C', label: 'C — พอใช้' },
  { value: 'D', label: 'D — ไม่ดี' },
];

/* ─── Component ─── */

export default function TradeInPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);
  const [showCreate, setShowCreate] = useState(false);
  const [showQuickBuy, setShowQuickBuy] = useState(false);
  const [appraiseModal, setAppraiseModal] = useState<TradeIn | null>(null);
  const [appraiseValue, setAppraiseValue] = useState('');
  const [appraiseCondition, setAppraiseCondition] = useState('B');
  const [acceptModal, setAcceptModal] = useState<TradeIn | null>(null);
  const [acceptForm, setAcceptForm] = useState({
    idCardVerified: false,
    sellerConsentSigned: false,
    policeReportAcknowledged: false,
    paymentMethod: 'CASH' as 'CASH' | 'TRANSFER',
    transferBankName: '',
    transferAccountNumber: '',
    transferAccountName: '',
    sellerSignatureBase64: '',
  });
  const [imeiCheckResult, setImeiCheckResult] = useState<{ result: 'clean' | 'duplicate'; count: number } | null>(null);

  // Seller mode: existing customer หรือ walk-in
  const [sellerMode, setSellerMode] = useState<'customer' | 'walkin'>('customer');

  // Form state
  const [form, setForm] = useState({
    customerId: '',
    deviceBrand: '',
    deviceModel: '',
    deviceStorage: '',
    deviceColor: '',
    deviceCondition: '',
    imei: '',
    estimatedValue: '',
    // Walk-in seller
    sellerName: '',
    sellerPhone: '',
    sellerIdCardNumber: '',
    sellerAddress: '',
    idCardPhotoBase64: '',
    idCardSource: '' as '' | 'card_reader' | 'upload',
  });

  // Customer search for create form
  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedCustomerSearch = useDebounce(customerSearch);
  const { data: customers = [] } = useQuery<{ id: string; name: string; phone: string }[]>({
    queryKey: ['trade-in-customers', debouncedCustomerSearch],
    queryFn: async () => {
      if (!debouncedCustomerSearch || debouncedCustomerSearch.length < 2) return [];
      const res = await api.get('/customers', {
        params: { search: debouncedCustomerSearch, limit: 10, page: 1 },
      });
      return res.data.data || [];
    },
    enabled: debouncedCustomerSearch.length >= 2,
  });

  /* ─── Queries ─── */

  const { data, isLoading } = useQuery<TradeInsResponse>({
    queryKey: ['trade-ins', page, debouncedSearch],
    queryFn: async () => {
      const res = await api.get('/trade-ins', {
        params: {
          page,
          limit: 50,
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
        },
      });
      return res.data;
    },
  });

  /* ─── Mutations ─── */

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        deviceBrand: form.deviceBrand,
        deviceModel: form.deviceModel,
        deviceStorage: form.deviceStorage || undefined,
        deviceColor: form.deviceColor || undefined,
        deviceCondition: form.deviceCondition || undefined,
        imei: form.imei || undefined,
        estimatedValue: form.estimatedValue ? parseFloat(form.estimatedValue) : undefined,
      };
      if (sellerMode === 'customer') {
        payload.customerId = form.customerId;
      } else {
        payload.sellerName = form.sellerName;
        payload.sellerPhone = form.sellerPhone || undefined;
        payload.sellerIdCardNumber = form.sellerIdCardNumber || undefined;
        payload.sellerAddress = form.sellerAddress || undefined;
        payload.idCardPhotoBase64 = form.idCardPhotoBase64 || undefined;
        payload.idCardSource = form.idCardSource || undefined;
      }
      return api.post('/trade-ins', payload);
    },
    onSuccess: () => {
      toast.success('สร้างรายการรับซื้อเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
      setShowCreate(false);
      resetForm();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const appraiseMutation = useMutation({
    mutationFn: async ({ id, value, condition }: { id: string; value: number; condition: string }) => {
      // Backend uses PATCH /:id/appraise with { offeredPrice, deviceCondition }
      return api.patch(`/trade-ins/${id}/appraise`, {
        offeredPrice: value,
        deviceCondition: condition,
      });
    },
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
    mutationFn: async ({ id, body }: { id: string; body: typeof acceptForm }) =>
      api.post(`/trade-ins/${id}/accept`, body),
    onSuccess: () => {
      toast.success('ยอมรับการรับซื้อเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
      setAcceptModal(null);
      setAcceptForm({ idCardVerified: false, sellerConsentSigned: false, policeReportAcknowledged: false, paymentMethod: 'CASH', transferBankName: '', transferAccountNumber: '', transferAccountName: '', sellerSignatureBase64: '' });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // ดาวน์โหลด PDF เป็น blob (ผ่าน axios — ส่ง JWT แนบ) แล้วเปิดในแท็บใหม่
  async function openVoucherPdf(id: string) {
    try {
      const res = await api.get(`/trade-ins/${id}/voucher.pdf`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // revoke ภายหลัง 60 วิ ให้แท็บใหม่โหลดเสร็จก่อน
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  const generateVoucherMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/trade-ins/${id}/voucher`),
    onSuccess: async (res, id) => {
      toast.success(`ออกใบสำคัญเลขที่ ${res.data.voucherNumber}`);
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
      await openVoucherPdf(id);
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

  /* ─── Helpers ─── */

  function resetForm() {
    setForm({
      customerId: '', deviceBrand: '', deviceModel: '', deviceStorage: '', deviceColor: '',
      deviceCondition: '', imei: '', estimatedValue: '',
      sellerName: '', sellerPhone: '', sellerIdCardNumber: '', sellerAddress: '',
      idCardPhotoBase64: '', idCardSource: '',
    });
    setCustomerSearch('');
    setSellerMode('customer');
    setImeiCheckResult(null);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (sellerMode === 'customer' && !form.customerId) {
      toast.error('กรุณาเลือกลูกค้า');
      return;
    }
    if (sellerMode === 'walkin' && !form.sellerName.trim()) {
      toast.error('กรุณาระบุชื่อผู้ขาย');
      return;
    }
    if (sellerMode === 'walkin' && form.sellerIdCardNumber && form.sellerIdCardNumber.length !== 13) {
      toast.error('เลขบัตรประชาชนต้อง 13 หลัก');
      return;
    }
    if (!form.deviceBrand || !form.deviceModel) {
      toast.error('กรุณาระบุยี่ห้อและรุ่น');
      return;
    }
    if (form.imei && !/^\d{15}$/.test(form.imei)) {
      toast.error('IMEI ต้องเป็นตัวเลข 15 หลัก');
      return;
    }
    createMutation.mutate();
  }

  // IMEI duplicate check (anti-stolen-goods)
  async function checkImeiDuplicate() {
    if (!form.imei || !/^\d{15}$/.test(form.imei)) {
      setImeiCheckResult(null);
      return;
    }
    try {
      const res = await api.get(`/trade-ins/check-imei/${form.imei}`);
      const cnt = res.data.occurrences?.length ?? 0;
      setImeiCheckResult({ result: res.data.result, count: cnt });
      if (res.data.result === 'duplicate') {
        toast.error(`⚠️ IMEI นี้เคยถูกรับซื้อแล้ว ${cnt} ครั้ง — โปรดตรวจสอบที่มา`);
      }
    } catch {
      // silent
    }
  }

  // อ่านบัตรจากเครื่องอ่านบัตร (card-reader service @ port 3457)
  async function readFromCardReader() {
    try {
      const res = await fetch('http://localhost:3457/api/read-card');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.message || 'อ่านบัตรไม่สำเร็จ — กรุณาลองอีกครั้ง');
        return;
      }
      const json = await res.json();
      if (!json.success || !json.data) {
        toast.error('ไม่พบข้อมูลบัตร');
        return;
      }
      const d = json.data;
      const fullName = `${d.prefix || ''}${d.firstName || ''} ${d.lastName || ''}`.trim();
      setForm((f) => ({
        ...f,
        sellerName: fullName,
        sellerIdCardNumber: d.nationalId || '',
        sellerAddress: d.address || '',
        idCardSource: 'card_reader',
      }));
      toast.success('อ่านบัตรเรียบร้อย');
    } catch {
      toast.error('ไม่พบเครื่องอ่านบัตร — ตรวจสอบว่า card-reader service รันอยู่ที่ port 3457');
    }
  }

  // อัปโหลดรูปบัตรประชาชน (fallback)
  function handleIdCardUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('ไฟล์ต้องไม่เกิน 5MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setForm((f) => ({
        ...f,
        idCardPhotoBase64: reader.result as string,
        idCardSource: 'upload',
      }));
      toast.success('อัปโหลดรูปบัตรเรียบร้อย');
    };
    reader.readAsDataURL(file);
  }

  /* ─── Columns ─── */

  const columns: Column<TradeIn>[] = [
    {
      key: 'customer',
      label: 'ผู้ขาย',
      sortable: true,
      render: (item) => (
        <div>
          <div className="font-medium text-foreground">
            {item.customer?.name || item.sellerName || '-'}
          </div>
          {!item.customer && item.sellerPhone && (
            <div className="text-xs text-muted-foreground">{item.sellerPhone}</div>
          )}
          {!item.customer && (
            <Badge variant="outline" className="mt-0.5 text-[10px]">walk-in</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'device',
      label: 'อุปกรณ์',
      render: (item) => (
        <span>
          {item.deviceBrand} {item.deviceModel}
          {item.deviceStorage && <span className="text-muted-foreground ml-1">({item.deviceStorage})</span>}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (item) => {
        const cfg = statusConfig[item.status] || { label: item.status, variant: 'outline' as const };
        return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
      },
    },
    {
      key: 'estimatedValue',
      label: 'ราคา',
      sortable: true,
      render: (item) => {
        const value = item.agreedPrice ?? item.offeredPrice ?? item.estimatedValue;
        return value != null ? (
          <span className="font-medium">฿{Number(value).toLocaleString()}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
    },
    {
      key: 'createdAt',
      label: 'วันที่',
      sortable: true,
      render: (item) => new Date(item.createdAt).toLocaleDateString('th-TH'),
    },
    {
      key: 'actions',
      label: '',
      render: (item) => (
        <div className="flex items-center gap-1">
          {item.status === 'PENDING_APPRAISAL' && canManage && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); setAppraiseModal(item); }}
            >
              ประเมิน
            </Button>
          )}
          {item.status === 'APPRAISED' && canManage && (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={(e) => { e.stopPropagation(); setAcceptModal(item); }}
              >
                <CheckCircle className="size-3.5 mr-1" />
                ยอมรับ
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={(e) => { e.stopPropagation(); rejectMutation.mutate(item.id); }}
                disabled={rejectMutation.isPending}
              >
                <XCircle className="size-3.5 mr-1" />
                ปฏิเสธ
              </Button>
            </>
          )}
          {(item.status === 'ACCEPTED' || item.status === 'COMPLETED') && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                if (item.voucherNumber) {
                  openVoucherPdf(item.id);
                } else {
                  generateVoucherMutation.mutate(item.id);
                }
              }}
              disabled={generateVoucherMutation.isPending}
            >
              <FileText className="size-3.5 mr-1" />
              {item.voucherNumber ? 'พิมพ์ใบสำคัญ' : 'ออกใบสำคัญ'}
            </Button>
          )}
        </div>
      ),
    },
  ];

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
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Plus className="size-4 mr-1.5" />
            รับซื้อเครื่อง
          </Button>
        }
      />

      {/* Quick Buy Modal */}
      <QuickBuyModal
        open={showQuickBuy}
        onClose={() => setShowQuickBuy(false)}
        onSuccess={(id) => {
          queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
          // เปิด PDF ทันที
          openVoucherPdf(id);
        }}
      />

      <Card>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={data?.data || []}
            isLoading={isLoading}
            emptyMessage="ไม่พบรายการรับซื้อ"
            emptyIcon={RefreshCw}
            searchable
            searchPlaceholder="ค้นหาลูกค้า, ยี่ห้อ, รุ่น..."
            pagination={data ? {
              page: data.page,
              totalPages: Math.ceil(data.total / 50),
              total: data.total,
              onPageChange: setPage,
            } : undefined}
          />
        </CardContent>
      </Card>


      {/* Appraise Modal */}
      <Modal isOpen={!!appraiseModal} onClose={() => { setAppraiseModal(null); setAppraiseValue(''); }} title="ประเมินราคาเครื่อง" size="sm">
        {appraiseModal && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              <p><strong>อุปกรณ์:</strong> {appraiseModal.deviceBrand} {appraiseModal.deviceModel}</p>
              <p><strong>ผู้ขาย:</strong> {appraiseModal.customer?.name || appraiseModal.sellerName || '-'}</p>
              {appraiseModal.estimatedValue != null && (
                <p><strong>ราคาประเมินเบื้องต้น:</strong> ฿{Number(appraiseModal.estimatedValue).toLocaleString()}</p>
              )}
            </div>
            <div>
              <Label>สภาพเครื่อง *</Label>
              <select
                className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm"
                value={appraiseCondition}
                onChange={(e) => setAppraiseCondition(e.target.value)}
              >
                <option value="A">A — ดีเยี่ยม</option>
                <option value="B">B — ดี</option>
                <option value="C">C — พอใช้</option>
                <option value="D">D — ไม่ดี</option>
              </select>
            </div>
            <div>
              <Label>ราคาที่เสนอ (บาท) *</Label>
              <Input
                className="mt-1"
                type="number"
                placeholder="0"
                value={appraiseValue}
                onChange={(e) => setAppraiseValue(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setAppraiseModal(null); setAppraiseValue(''); }}>
                ยกเลิก
              </Button>
              <Button
                onClick={() => {
                  if (!appraiseValue || parseFloat(appraiseValue) <= 0) {
                    toast.error('กรุณาระบุราคาประเมิน');
                    return;
                  }
                  appraiseMutation.mutate({
                    id: appraiseModal.id,
                    value: parseFloat(appraiseValue),
                    condition: appraiseCondition,
                  });
                }}
                disabled={appraiseMutation.isPending}
              >
                {appraiseMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันประเมิน'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Accept Modal — anti-stolen-goods gate */}
      <Modal
        isOpen={!!acceptModal}
        onClose={() => { setAcceptModal(null); setAcceptForm({ idCardVerified: false, sellerConsentSigned: false, policeReportAcknowledged: false, paymentMethod: 'CASH', transferBankName: '', transferAccountNumber: '', transferAccountName: '', sellerSignatureBase64: '' }); }}
        title="ยืนยันการรับซื้อเครื่อง"
        size="md"
      >
        {acceptModal && (
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 p-3 text-xs text-amber-700 dark:text-amber-400 flex gap-2">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>กรุณายืนยันตามขั้นตอนป้องกันการรับซื้อของโจรก่อนกดยอมรับ</div>
            </div>
            <div className="text-sm">
              <p><strong>อุปกรณ์:</strong> {acceptModal.deviceBrand} {acceptModal.deviceModel}</p>
              <p><strong>ผู้ขาย:</strong> {acceptModal.customer?.name || acceptModal.sellerName || '-'}</p>
              <p><strong>ราคาตกลง:</strong> ฿{Number(acceptModal.offeredPrice ?? 0).toLocaleString()}</p>
            </div>
            <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted">
              <input
                type="checkbox"
                className="mt-1"
                checked={acceptForm.idCardVerified}
                onChange={(e) => setAcceptForm((f) => ({ ...f, idCardVerified: e.target.checked }))}
              />
              <span className="text-sm">ตรวจบัตรประชาชนผู้ขายแล้วและตรงกับใบหน้า</span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted">
              <input
                type="checkbox"
                className="mt-1"
                checked={acceptForm.sellerConsentSigned}
                onChange={(e) => setAcceptForm((f) => ({ ...f, sellerConsentSigned: e.target.checked }))}
              />
              <span className="text-sm">ผู้ขายเซ็นยืนยันว่าเป็นเจ้าของเครื่องโดยชอบด้วยกฎหมาย</span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted">
              <input
                type="checkbox"
                className="mt-1"
                checked={acceptForm.policeReportAcknowledged}
                onChange={(e) => setAcceptForm((f) => ({ ...f, policeReportAcknowledged: e.target.checked }))}
              />
              <span className="text-sm">แจ้งผู้ขายแล้วว่าหากเป็นของโจรจะถูกดำเนินคดีตามกฎหมาย</span>
            </label>

            {/* Payment method */}
            <div className="border-t pt-3 mt-2">
              <Label>วิธีชำระเงินให้ผู้ขาย *</Label>
              <div className="flex gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={() => setAcceptForm((f) => ({ ...f, paymentMethod: 'CASH' }))}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${acceptForm.paymentMethod === 'CASH' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-300'}`}
                >
                  เงินสด
                </button>
                <button
                  type="button"
                  onClick={() => setAcceptForm((f) => ({ ...f, paymentMethod: 'TRANSFER' }))}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${acceptForm.paymentMethod === 'TRANSFER' ? 'bg-sky-500 text-white border-sky-500' : 'bg-white text-slate-700 border-slate-200 hover:border-sky-300'}`}
                >
                  โอน
                </button>
              </div>
              {acceptForm.paymentMethod === 'TRANSFER' && (
                <div className="space-y-2 mt-3">
                  <Input
                    placeholder="ธนาคาร เช่น กสิกรไทย"
                    value={acceptForm.transferBankName}
                    onChange={(e) => setAcceptForm((f) => ({ ...f, transferBankName: e.target.value }))}
                  />
                  <Input
                    placeholder="เลขบัญชีผู้รับโอน"
                    value={acceptForm.transferAccountNumber}
                    onChange={(e) => setAcceptForm((f) => ({ ...f, transferAccountNumber: e.target.value.replace(/[^\d-]/g, '') }))}
                  />
                  <Input
                    placeholder="ชื่อบัญชี"
                    value={acceptForm.transferAccountName}
                    onChange={(e) => setAcceptForm((f) => ({ ...f, transferAccountName: e.target.value }))}
                  />
                </div>
              )}
            </div>

            {/* ลายเซ็นผู้ขาย */}
            <div className="border-t pt-3">
              <Label>ลายเซ็นผู้ขาย *</Label>
              <p className="text-xs text-muted-foreground mb-2">ผู้ขายลงนามยืนยันการขายและความเป็นเจ้าของ</p>
              <SignaturePadFull
                onSign={() => { /* handled by submit button */ }}
                onDraftChange={(dataUrl) =>
                  setAcceptForm((f) => ({ ...f, sellerSignatureBase64: dataUrl || '' }))
                }
                buttonText=""
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setAcceptModal(null); setAcceptForm({ idCardVerified: false, sellerConsentSigned: false, policeReportAcknowledged: false, paymentMethod: 'CASH', transferBankName: '', transferAccountNumber: '', transferAccountName: '', sellerSignatureBase64: '' }); }}>
                ยกเลิก
              </Button>
              <Button
                onClick={() => {
                  if (!acceptForm.idCardVerified || !acceptForm.sellerConsentSigned) {
                    toast.error('กรุณายืนยันการตรวจบัตรและความยินยอมก่อน');
                    return;
                  }
                  if (acceptForm.paymentMethod === 'TRANSFER') {
                    if (!acceptForm.transferBankName || !acceptForm.transferAccountNumber || !acceptForm.transferAccountName) {
                      toast.error('กรุณากรอกข้อมูลการโอนให้ครบ');
                      return;
                    }
                  }
                  if (!acceptForm.sellerSignatureBase64) {
                    toast.error('กรุณาให้ผู้ขายลงลายเซ็นก่อน');
                    return;
                  }
                  acceptMutation.mutate({ id: acceptModal.id, body: acceptForm });
                }}
                disabled={acceptMutation.isPending}
              >
                {acceptMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันรับซื้อ'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
