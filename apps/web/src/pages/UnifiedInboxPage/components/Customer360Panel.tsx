import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import api from '@/lib/api';
import { displayAddress } from '@/components/ui/AddressForm';
import ProductContextCard from './ProductContextCard';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, contractStatusMap, riskLevelMap } from '@/lib/status-badges';
import ContactLogDialog from '@/pages/CollectionsPage/components/ContactLogDialog';
import LockDeviceDialog from '@/pages/CollectionsPage/components/LockDeviceDialog';
import type { ContractRow } from '@/pages/CollectionsPage/types';
import {
  User,
  FileText,
  CreditCard,
  AlertTriangle,
  Phone,
  MessageSquare,
  Smartphone,
  Link2,
  Lock,
  ExternalLink,
  Zap,
  Shield,
  ChevronRight,
  Banknote,
  Landmark,
  QrCode,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format, isPast, differenceInDays } from 'date-fns';
import { th } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type DialogView = null | 'send-link';

interface ContractSummaryItem {
  id: string;
  contractNumber: string;
  status: string;
  product?: { name?: string; brand?: string; model?: string; warrantyExpireDate?: string };
  serialNumber?: string;
  paidInstallments: number;
  totalInstallments: number;
  monthlyPayment: number | string;
  nextDueDate?: string;
  mdmLockedAt?: string;
  shopWarrantyEndDate?: string;
}

interface PaymentPartial {
  id: string;
  receiptNumber: string;
  amount: number | string;
  paidDate: string;
  paymentMethod: string | null;
}

interface PaymentSummaryItem {
  id: string;
  contract?: { contractNumber: string };
  installmentNo: number;
  amountDue: number | string;
  amountPaid: number | string;
  status: string;
  partials: PaymentPartial[];
}

interface ChatSessionItem {
  id: string;
  channel: string;
  sessionStatus: string;
  totalMessages: number;
  lastMessageAt: string;
}

interface CallLogItem {
  id: string;
  caller?: { name: string };
  calledAt: string;
  notes?: string;
}

interface CrossRoomItem {
  id: string;
  channel: string;
  lastMessageAt?: string;
  messages?: { text: string }[];
}

interface InternalNoteItem {
  id: string;
  content: string;
  createdAt: string;
  staff?: { name: string };
}

interface StaffItem {
  id: string;
  name: string;
}

interface Customer360PanelProps {
  customerId: string | null;
  activeRoomId?: string | null;
  onSelectRoom?: (roomId: string) => void;
}

const channelLabel: Record<string, string> = {
  LINE_FINANCE: 'LINE Finance',
  LINE_SHOP: 'LINE Shop',
  FACEBOOK: 'Facebook',
  TIKTOK: 'TikTok',
  WEB: 'เว็บ',
};

const channelColor: Record<string, string> = {
  LINE_FINANCE: 'bg-success/10 text-success',
  LINE_SHOP: 'bg-success/10 text-success',
  FACEBOOK: 'bg-info/10 text-info',
  TIKTOK: 'bg-primary/10 text-primary',
  WEB: 'bg-muted text-muted-foreground',
};

const localContractStatusMap: Record<string, string> = {
  ACTIVE: 'ใช้งาน',
  OVERDUE: 'ค้างชำระ',
  DEFAULT: 'ผิดนัด',
  COMPLETED: 'ปิดแล้ว',
  CLOSED_EARLY: 'ปิดก่อน',
  CLOSED_BAD_DEBT: 'หนี้สูญ',
};

const sessionStatusLabel: Record<string, string> = {
  OPEN: 'เปิด',
  PENDING: 'รอ',
  HANDOFF: 'ส่งต่อ',
  RESOLVED: 'จบ',
  ARCHIVED: 'เก็บ',
};

export default function Customer360Panel({ customerId, activeRoomId, onSelectRoom }: Customer360PanelProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialogView, setDialogView] = useState<DialogView>(null);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  // Both ContactLog + MDM lock dialogs reuse Collections components and need
  // a full ContractRow shape — fetched on demand via /overdue/queue-row
  const [contactLogContract, setContactLogContract] = useState<ContractRow | null>(null);
  const [mdmLockContract, setMdmLockContract] = useState<ContractRow | null>(null);
  // Signed contract PDF preview
  const [pdfPreview, setPdfPreview] = useState<{ url: string; contractNumber: string } | null>(null);
  const [customerInfoOpen, setCustomerInfoOpen] = useState(false);
  const [callStatus, setCallStatus] = useState<'idle' | 'calling'>('idle');

  const originateCall = useMutation({
    mutationFn: ({ contractId }: { contractId: string }) =>
      api.post('/yeastar/call/originate', { customerId, contractId }).then((r) => r.data),
    onMutate: () => setCallStatus('calling'),
    onSuccess: () => {
      toast.success('กำลังโทรออก — รับสายจากโทรศัพท์ของคุณ');
      setTimeout(() => setCallStatus('idle'), 10_000);
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setCallStatus('idle');
      toast.error(err?.response?.data?.message ?? 'โทรออกไม่สำเร็จ');
    },
  });

  const originatePhoneCall = useMutation({
    mutationFn: (phone: string) =>
      api.post('/yeastar/call/originate-phone', { phone }).then((r) => r.data),
    onSuccess: () => toast.success('กำลังโทรออก — รับสายจากโทรศัพท์ของคุณ'),
    onError: (err: { response?: { data?: { message?: string } } }) =>
      toast.error(err?.response?.data?.message ?? 'โทรออกไม่สำเร็จ'),
  });

  const handleCall = () => {
    const contracts = (summary?.activeContracts ?? []) as ContractSummaryItem[];
    if (!customerId) return;
    if (contracts.length === 0) {
      toast.error('ไม่มีสัญญาที่ใช้งาน — โทรออกผ่าน Yeastar ต้องระบุสัญญา');
      return;
    }
    originateCall.mutate({ contractId: contracts[0].id });
  };

  // ─── Customer basic info ──────────────────────────────
  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer-360', customerId],
    queryFn: () => api.get(`/customers/${customerId}`).then((r) => r.data?.data ?? r.data),
    enabled: !!customerId,
  });

  // ─── Risk flag ────────────────────────────────────────
  const { data: riskData } = useQuery({
    queryKey: ['customer-risk', customerId],
    queryFn: () => api.get(`/customers/${customerId}/risk-flag`).then((r) => r.data?.data ?? r.data),
    enabled: !!customerId,
  });

  // ─── Chat summary (payments, contracts, call logs, sessions) ──
  const { data: summary } = useQuery({
    queryKey: ['customer-chat-summary', customerId],
    queryFn: () => api.get(`/customers/${customerId}/chat-summary`).then((r) => r.data?.data ?? r.data),
    enabled: !!customerId,
    staleTime: 30_000,
  });

  // ─── Notes ──────────────────────────────────────────
  const { data: notesData } = useQuery({
    queryKey: ['customer-notes', activeRoomId],
    queryFn: () => api.get(`/staff-chat/rooms/${activeRoomId}/notes`).then((r) => r.data?.data ?? r.data),
    enabled: !!activeRoomId,
  });

  // ─── Cross-channel rooms ─────────────────────────────
  const { data: crossRooms } = useQuery({
    queryKey: ['cross-channel-rooms', activeRoomId],
    queryFn: () => api.get(`/staff-chat/rooms/${activeRoomId}/cross-channel`).then((r) => r.data?.data ?? r.data),
    enabled: !!activeRoomId,
  });

  // ─── Send payment Flex card via LINE Finance ──────────
  const sendPaymentFlex = useMutation({
    mutationFn: (contractId: string) =>
      api.post('/line-oa/payment-flex', { contractId }).then((r) => r.data),
    onSuccess: (data: { type?: 'reminder' | 'overdue' }) => {
      toast.success(
        data?.type === 'overdue'
          ? 'ส่ง Flex Card (แจ้งค้างชำระ) แล้ว'
          : 'ส่ง Flex Card (เตือนค่างวด) แล้ว',
      );
      closeDialog();
    },
    onError: (err: { response?: { data?: { message?: string; error?: string } } }) => {
      toast.error(
        err?.response?.data?.message ?? err?.response?.data?.error ?? 'ส่ง Flex Card ไม่สำเร็จ',
      );
    },
  });

  const closeDialog = () => {
    setDialogView(null);
    setSelectedContractId(null);
  };

  const sendPaymentLink = () => {
    const contracts = (summary?.activeContracts ?? []) as ContractSummaryItem[];
    if (contracts.length === 0) {
      toast.error('ไม่มีสัญญาที่ใช้งาน');
      return;
    }
    if (contracts.length === 1) {
      sendPaymentFlex.mutate(contracts[0].id);
      return;
    }
    // Multi-contract: open lightweight picker
    setDialogView('send-link');
  };

  const fetchAndOpenContactLog = useMutation({
    mutationFn: (contractId: string) =>
      api.get(`/overdue/contracts/${contractId}/queue-row`).then((r) => r.data?.data ?? r.data),
    onSuccess: (row: ContractRow | null) => {
      if (!row) {
        toast.error('ไม่พบข้อมูลสัญญา');
        return;
      }
      setContactLogContract(row);
    },
    onError: () => toast.error('ไม่สามารถโหลดข้อมูลสัญญาได้'),
  });

  const openContactLog = () => {
    const contracts = (summary?.activeContracts ?? []) as ContractSummaryItem[];
    if (contracts.length === 0) {
      toast.error('ไม่มีสัญญาที่ใช้งาน');
      return;
    }
    if (contracts.length === 1) {
      fetchAndOpenContactLog.mutate(contracts[0].id);
      return;
    }
    // Multi: prompt user — for now, use first; could add picker later
    fetchAndOpenContactLog.mutate(contracts[0].id);
  };

  const fetchAndOpenMdmLock = useMutation({
    mutationFn: (contractId: string) =>
      api.get(`/overdue/contracts/${contractId}/queue-row`).then((r) => r.data?.data ?? r.data),
    onSuccess: (row: ContractRow | null) => {
      if (!row) {
        toast.error('ไม่พบข้อมูลสัญญา');
        return;
      }
      setMdmLockContract(row);
    },
    onError: () => toast.error('ไม่สามารถโหลดข้อมูลสัญญาได้'),
  });

  const openMdmLock = () => {
    const contracts = (summary?.activeContracts ?? []) as ContractSummaryItem[];
    if (contracts.length === 0) {
      toast.error('ไม่มีสัญญาที่ใช้งาน');
      return;
    }
    fetchAndOpenMdmLock.mutate(contracts[0].id);
  };

  const openContractPdf = useMutation({
    mutationFn: async (contract: ContractSummaryItem) => {
      const { data: docs } = await api.get(`/contracts/${contract.id}/documents`);
      const list: { id: string; documentType: string; createdAt: string }[] = docs?.data ?? docs ?? [];
      // Pick the most recent signed contract PDF
      const signedContract = list
        .filter((d) => d.documentType === 'CONTRACT')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      if (!signedContract) {
        throw new Error('ยังไม่มีไฟล์สัญญา PDF — สัญญานี้อาจยังไม่ได้สร้างเอกสาร');
      }
      const { data } = await api.get(`/documents/${signedContract.id}/signed-url`);
      return { url: data.url as string, contractNumber: contract.contractNumber };
    },
    onSuccess: (result) => setPdfPreview(result),
    onError: (err: Error) => toast.error(err.message ?? 'ไม่สามารถเปิดสัญญาได้'),
  });

  const openContractPage = () => {
    const contracts = (summary?.activeContracts ?? []) as ContractSummaryItem[];
    if (contracts.length === 0) {
      toast.error('ไม่มีสัญญาที่ใช้งาน');
      return;
    }
    openContractPdf.mutate(contracts[0]);
  };

  if (!customerId) {
    return (
      <div className="w-80 border-l border-border flex flex-col items-center justify-center text-center p-6">
        <div className="relative mb-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
            <User className="w-7 h-7 text-muted-foreground/30" />
          </div>
        </div>
        <p className="text-xs font-semibold text-foreground/50 leading-snug">ข้อมูลลูกค้า</p>
        <p className="text-[11px] text-muted-foreground/50 mt-1 max-w-[180px] leading-relaxed">
          เลือกแชทเพื่อดูข้อมูลลูกค้า สัญญา และประวัติ
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="w-80 border-l border-border p-4">
        <div className="animate-pulse space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 bg-muted rounded" />
              <div className="h-2.5 w-16 bg-muted rounded" />
            </div>
          </div>
          <div className="h-20 bg-muted rounded-lg" />
          <div className="h-28 bg-muted rounded-lg" />
          <div className="h-16 bg-muted rounded-lg" />
        </div>
      </div>
    );
  }

  const riskLevel = riskData?.riskLevel ?? 'NONE';

  // Derive contract + product from summary for MDM/Warranty sections
  const firstContract = summary?.activeContracts?.[0];
  const firstProduct = firstContract?.product;

  return (
    <div className="w-80 flex-shrink-0 border-l border-border flex flex-col h-full">
      {/* ─── 1. Customer Profile (sticky) ──────────────── */}
      <div className="p-4 border-b border-border shrink-0 bg-card">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
            {customer?.avatarUrl || customer?.lineAvatarUrl ? (
              <img
                src={customer.avatarUrl || customer.lineAvatarUrl}
                alt={customer?.name ?? ''}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-muted-foreground text-lg font-bold">{(customer?.name ?? '?')[0]}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm text-foreground truncate">{customer?.name}</h3>
            {customer?.phone && (
              <button
                type="button"
                onClick={handleCall}
                disabled={originateCall.isPending || callStatus === 'calling'}
                className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1 transition-colors disabled:opacity-60"
                title="คลิกเพื่อโทรออกผ่าน Yeastar"
              >
                <Phone className="w-3 h-3" />
                {customer.phone}
              </button>
            )}
          </div>
          {(() => {
            const riskCfg = getStatusBadgeProps(riskLevel, riskLevelMap);
            return (
              <Badge variant={riskCfg.variant} appearance={riskCfg.appearance} className="text-[10px] px-1.5 py-0.5">
                {riskLevel === 'HIGH' ? 'เสี่ยงสูง' : riskLevel === 'MEDIUM' ? 'เฝ้าระวัง' : 'ปกติ'}
              </Badge>
            );
          })()}
        </div>

        {customer?.email && (
          <p className="text-[11px] text-muted-foreground ml-14">{customer.email}</p>
        )}

        {/* Overdue alert */}
        {summary && summary.overdueCount > 0 && (
          <div className="mt-2 p-2 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
            <div className="text-xs">
              <span className="font-semibold text-destructive">ค้าง {summary.overdueCount} งวด</span>
              <span className="text-destructive ml-1">
                ({Number(summary.totalOutstanding).toLocaleString()} บ.)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ─── Scrollable content ──────────────────────── */}
      <div className="flex-1 overflow-y-auto">
      {/* ─── 1b. Product Context (detected from chat) ────── */}
      <ProductContextCard roomId={activeRoomId ?? ''} />

      {/* ─── 1c. Cross-Channel Rooms ─────────────────────── */}
      {crossRooms && crossRooms.length > 0 && (
        <div className="border-b border-border">
          <div className="px-4 pt-4 pb-2">
            <SectionHeader icon={MessageSquare} label="ห้องแชททั้งหมด" />
          </div>
          {(crossRooms as CrossRoomItem[]).map((r) => (
            <button
              key={r.id}
              onClick={() => onSelectRoom?.(r.id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-muted/50 transition-colors',
                r.id === activeRoomId && 'bg-primary/5 border-l-2 border-primary',
              )}
            >
              <ChannelBadge channel={r.channel} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] truncate">{r.messages?.[0]?.text ?? '...'}</p>
                <p className="text-[10px] text-muted-foreground">
                  {r.lastMessageAt
                    ? format(new Date(r.lastMessageAt), 'dd MMM HH:mm', { locale: th })
                    : ''}
                </p>
              </div>
              {r.id === activeRoomId && (
                <span className="text-[9px] text-primary font-bold">กำลังคุย</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ─── 1d. MDM Status ──────────────────────────────── */}
      <div className="p-4 border-b border-border">
        <SectionHeader icon={Smartphone} label="สถานะ MDM" />
        {firstContract?.mdmLockedAt ? (
          <div className="px-0 py-0 text-[12px]">
            <span className="text-destructive font-medium">🔒 ล็อคอยู่</span>
            <span className="text-muted-foreground ml-2">
              ตั้งแต่ {format(new Date(firstContract.mdmLockedAt), 'dd MMM yyyy', { locale: th })}
            </span>
          </div>
        ) : (
          <div className="text-[12px] text-success font-medium">🔓 ไม่ได้ล็อค</div>
        )}
      </div>

      {/* ─── 1e. Warranty (2-tier: manufacturer + shop) ─── */}
      <div className="p-4 border-b border-border">
        <SectionHeader icon={Shield} label="การรับประกัน" />
        {summary?.activeContracts?.length > 0 ? (
          <div className="space-y-3">
            {(summary.activeContracts as ContractSummaryItem[]).map((c) => {
              const product = c.product;
              const productName = product?.name ?? `${product?.brand ?? ''} ${product?.model ?? ''}`.trim() ?? 'สินค้า';
              const isUsed = !!c.shopWarrantyEndDate;
              const conditionLabel = isUsed ? 'มือสอง' : 'ใหม่';

              // Manufacturer warranty
              const mfrDate = product?.warrantyExpireDate ? new Date(product.warrantyExpireDate) : null;
              const mfrExpired = mfrDate ? isPast(mfrDate) : true;
              const mfrDays = mfrDate && !mfrExpired ? differenceInDays(mfrDate, new Date()) : 0;

              // Shop warranty
              const shopDate = c.shopWarrantyEndDate ? new Date(c.shopWarrantyEndDate) : null;
              const shopExpired = shopDate ? isPast(shopDate) : false;
              const shopDays = shopDate && !shopExpired ? differenceInDays(shopDate, new Date()) : 0;

              return (
                <div key={c.id} className="text-[12px]">
                  <p className="font-medium text-foreground/80 mb-1">
                    📱 {productName}{' '}
                    <span className="text-[10px] text-muted-foreground font-normal">({conditionLabel})</span>
                  </p>

                  {/* Manufacturer warranty */}
                  {mfrDate ? (
                    mfrExpired ? (
                      <p className="text-destructive ml-3">❌ ศูนย์: หมดแล้ว</p>
                    ) : (
                      <p className="text-success ml-3">
                        ✅ ศูนย์: ถึง {format(mfrDate, 'dd MMM yyyy', { locale: th })}{' '}
                        <span className="text-muted-foreground">(เหลือ {mfrDays} วัน)</span>
                      </p>
                    )
                  ) : (
                    <p className="text-destructive ml-3">❌ ศูนย์: หมดแล้ว</p>
                  )}

                  {/* Shop warranty — only show when exists */}
                  {shopDate && (
                    shopExpired ? (
                      <p className="text-destructive ml-3">❌ ร้าน: หมดแล้ว</p>
                    ) : (
                      <p className="text-success ml-3">
                        ✅ ร้าน: ถึง {format(shopDate, 'dd MMM yyyy', { locale: th })}{' '}
                        <span className="text-muted-foreground">(เหลือ {shopDays} วัน)</span>
                      </p>
                    )
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">ไม่มีข้อมูลประกัน</p>
        )}
      </div>

      {/* ─── 2. Active Contracts + Product/IMEI ─────────── */}
      <div className="p-4 border-b border-border">
        <SectionHeader icon={FileText} label="สัญญา" />

        {summary?.activeContracts?.length > 0 ? (
          <div className="space-y-2">
            {(summary.activeContracts as ContractSummaryItem[]).map((c) => (
              <div key={c.id} className="p-2.5 bg-muted rounded-lg text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-foreground/90">{c.contractNumber}</span>
                  {(() => {
                    const sCfg = getStatusBadgeProps(c.status, contractStatusMap);
                    return (
                      <Badge variant={sCfg.variant} appearance={sCfg.appearance} className="text-[10px] px-1.5 py-0.5">
                        {localContractStatusMap[c.status] ?? sCfg.label}
                      </Badge>
                    );
                  })()}
                </div>

                {/* Product info */}
                <div className="flex items-center gap-1 text-muted-foreground mb-1">
                  <Smartphone className="w-3 h-3" />
                  <span>{c.product?.name ?? `${c.product?.brand} ${c.product?.model}`}</span>
                </div>
                {c.serialNumber && (
                  <p className="text-[10px] text-muted-foreground ml-4">IMEI: {c.serialNumber}</p>
                )}

                {/* Payment progress */}
                <div className="mt-1.5">
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                    <span>ชำระแล้ว {c.paidInstallments}/{c.totalInstallments} งวด</span>
                    <span>{Number(c.monthlyPayment).toLocaleString()} บ./งวด</span>
                  </div>
                  <div className="w-full bg-border rounded-full h-1.5">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all"
                      style={{ width: `${(c.paidInstallments / c.totalInstallments) * 100}%` }}
                    />
                  </div>
                  {c.nextDueDate && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      ถัดไป: {format(new Date(c.nextDueDate), 'dd/MM/yyyy')}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">ไม่มีสัญญาที่ใช้งาน</p>
        )}
      </div>

      {/* ─── 3. Recent Payments ──────────────────────────── */}
      <div className="p-4 border-b border-border">
        <SectionHeader icon={CreditCard} label="การชำระล่าสุด" />

        {summary?.recentPayments?.length > 0 ? (
          <div className="space-y-1.5">
            {(summary.recentPayments as PaymentSummaryItem[]).map((p) => (
              <RecentPaymentGroup key={p.id} payment={p} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">ยังไม่มีการชำระ</p>
        )}
      </div>

      {/* ─── 4. Chat History (all channels) ──────────────── */}
      <div className="p-4 border-b border-border">
        <SectionHeader icon={MessageSquare} label="ประวัติแชท" />

        {summary?.chatSessions?.length > 0 ? (
          <div className="space-y-1.5">
            {(summary.chatSessions as ChatSessionItem[]).map((s) => (
              <div
                key={s.id}
                className={`flex items-center gap-2 p-1.5 rounded text-xs ${
                  s.id === activeRoomId ? 'bg-primary/5 border border-primary/20' : 'hover:bg-muted/50'
                }`}
              >
                <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${channelColor[s.channel] ?? 'bg-muted'}`}>
                  {channelLabel[s.channel] ?? s.channel}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-muted-foreground">{sessionStatusLabel[s.sessionStatus] ?? s.sessionStatus}</span>
                  <span className="text-muted-foreground/50 mx-1">·</span>
                  <span className="text-muted-foreground">{s.totalMessages} ข้อความ</span>
                </div>
                <span className="text-[10px] text-muted-foreground flex-shrink-0">
                  {format(new Date(s.lastMessageAt), 'dd/MM')}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">ไม่มีประวัติแชท</p>
        )}
      </div>

      {/* ─── 5. Call Logs ────────────────────────────────── */}
      {summary?.callLogs?.length > 0 && (
        <div className="p-4 border-b border-border">
          <SectionHeader icon={Phone} label="ประวัติโทร" />
          <div className="space-y-1.5">
            {(summary.callLogs as CallLogItem[]).map((log) => (
              <div key={log.id} className="text-xs">
                <div className="flex justify-between">
                  <span className="text-foreground/80">{log.caller?.name ?? 'ระบบ'}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {format(new Date(log.calledAt), 'dd/MM HH:mm')}
                  </span>
                </div>
                {log.notes && <p className="text-muted-foreground truncate">{log.notes}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 6. Internal Notes ──────────────────────────── */}
      {activeRoomId && (
        <InternalNotesSection
          roomId={activeRoomId}
          notes={notesData ?? []}
        />
      )}

      {/* ─── 7. Quick Actions ────────────────────────────── */}
      <div className="p-4">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Zap className="w-3.5 h-3.5" />
              <span className="text-xs font-semibold">ดำเนินการ</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" side="top" className="w-60 p-2">
              <div className="flex flex-col gap-1">
                <QuickActionBtn
                  icon={<Phone className="w-3.5 h-3.5 flex-shrink-0" />}
                  label={
                    originateCall.isPending || callStatus === 'calling'
                      ? 'กำลังโทร...'
                      : 'โทรออก (Yeastar)'
                  }
                  onClick={handleCall}
                />
                <div className="h-px bg-border my-1" />
                <QuickActionBtn
                  icon={<Link2 className="w-3.5 h-3.5 flex-shrink-0" />}
                  label={sendPaymentFlex.isPending ? 'กำลังส่ง...' : 'ส่งลิงก์ชำระ'}
                  onClick={sendPaymentLink}
                />
                <QuickActionBtn
                  icon={<Phone className="w-3.5 h-3.5 flex-shrink-0" />}
                  label="บันทึกติดต่อ + นัดชำระ"
                  onClick={openContactLog}
                />
                <QuickActionBtn
                  icon={<Lock className="w-3.5 h-3.5 flex-shrink-0" />}
                  label="ส่งคำสั่งล็อกเครื่อง (MDM)"
                  onClick={openMdmLock}
                />
                <div className="h-px bg-border my-1" />
                <QuickActionBtn
                  icon={<FileText className="w-3.5 h-3.5 flex-shrink-0" />}
                  label={openContractPdf.isPending ? 'กำลังโหลดสัญญา...' : 'ดูสัญญา PDF'}
                  onClick={openContractPage}
                />
                <QuickActionBtn
                  icon={<User className="w-3.5 h-3.5 flex-shrink-0" />}
                  label="ดูข้อมูลลูกค้า"
                  onClick={() => setCustomerInfoOpen(true)}
                />
              </div>
            </PopoverContent>
          </Popover>
      </div>
      </div>{/* end scrollable */}

      {/* ─── Quick Action Dialogs ──────────────────────── */}

      {/* Send Payment Link — multi-contract picker (auto-sends Flex on click) */}
      <Dialog open={dialogView === 'send-link'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-4 h-4" /> เลือกสัญญาที่จะส่งลิงก์ชำระ
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {((summary?.activeContracts ?? []) as ContractSummaryItem[]).map((c) => {
              const productName = c.product?.name ?? `${c.product?.brand ?? ''} ${c.product?.model ?? ''}`.trim() ?? 'สินค้า';
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={sendPaymentFlex.isPending}
                  onClick={() => sendPaymentFlex.mutate(c.id)}
                  className="w-full text-left p-3 rounded-lg border border-border hover:bg-accent text-sm transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-medium text-foreground">{c.contractNumber}</span>
                    <span className="text-xs text-muted-foreground">{Number(c.monthlyPayment).toLocaleString()} บ./งวด</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{productName}</p>
                </button>
              );
            })}
            <p className="text-[11px] text-muted-foreground text-center pt-1">
              เลือก template อัตโนมัติตามสถานะค้างชำระ
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Contact Log + Settlement — reuses CollectionsPage dialog for full UI parity */}
      <ContactLogDialog
        open={!!contactLogContract}
        contract={contactLogContract}
        onClose={() => setContactLogContract(null)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['customer-chat-summary', customerId] });
          setContactLogContract(null);
        }}
      />

      {/* MDM Lock — reuses CollectionsPage dialog for full UI parity */}
      {mdmLockContract && (
        <LockDeviceDialog
          open={!!mdmLockContract}
          onOpenChange={(o) => !o && setMdmLockContract(null)}
          contractId={mdmLockContract.id}
          customerName={mdmLockContract.customer.name}
          daysOverdue={mdmLockContract.daysOverdue}
        />
      )}

      {/* Customer info preview */}
      <Dialog open={customerInfoOpen} onOpenChange={setCustomerInfoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="w-4 h-4" /> ข้อมูลลูกค้า
            </DialogTitle>
          </DialogHeader>
          {customer && (
            <div className="space-y-3 text-sm max-h-[70vh] overflow-y-auto pr-1">
              <div className="flex items-center gap-3 pb-3 border-b border-border">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                  {customer?.avatarUrl || customer?.lineAvatarUrl ? (
                    <img
                      src={customer.avatarUrl || customer.lineAvatarUrl}
                      alt={customer?.name ?? ''}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-muted-foreground text-base font-bold">{(customer?.name ?? '?')[0]}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground truncate">{customer.name}</p>
                  {customer.nickname && (
                    <p className="text-xs text-muted-foreground">ชื่อเล่น: {customer.nickname}</p>
                  )}
                </div>
              </div>

              {/* ─── ติดต่อ ─── */}
              <CustomerInfoSection title="ติดต่อ">
                <CustomerInfoRow label="โทรศัพท์" value={customer.phone} />
                <CustomerInfoRow label="โทรสำรอง" value={customer.phoneSecondary} />
                <CustomerInfoRow label="อีเมล" value={customer.email} />
                <CustomerInfoRow label="LINE ID" value={customer.lineId} />
                <CustomerInfoRow label="Facebook" value={customer.facebookName} />
              </CustomerInfoSection>

              {/* ─── ข้อมูลส่วนตัว ─── */}
              <CustomerInfoSection title="ข้อมูลส่วนตัว">
                <CustomerInfoRow label="เลขบัตรปชช." value={customer.idCard} />
                <CustomerInfoRow
                  label="วันเกิด"
                  value={customer.birthDate ? format(new Date(customer.birthDate), 'dd MMM yyyy', { locale: th }) : null}
                />
                <CustomerInfoRow label="ที่อยู่ตามบัตร" value={displayAddress(customer.addressIdCard) || customer.addressIdCard} />
                <CustomerInfoRow label="ที่อยู่ปัจจุบัน" value={displayAddress(customer.addressCurrent) || customer.addressCurrent} />
              </CustomerInfoSection>

              {/* ─── งาน ─── */}
              <CustomerInfoSection title="ข้อมูลที่ทำงาน">
                <CustomerInfoRow label="ที่ทำงาน" value={customer.workplace} />
                <CustomerInfoRow label="อาชีพ" value={customer.occupation} />
                <CustomerInfoRow label="รายละเอียดงาน" value={customer.occupationDetail} />
                <CustomerInfoRow
                  label="เงินเดือน"
                  value={customer.salary ? `${Number(customer.salary).toLocaleString()} บ./เดือน` : null}
                />
                <CustomerInfoRow label="ที่อยู่ที่ทำงาน" value={displayAddress(customer.addressWork) || customer.addressWork} />
              </CustomerInfoSection>

              {/* ─── บุคคลอ้างอิง ─── */}
              {(() => {
                type Ref = { prefix?: string; firstName?: string; lastName?: string; phone?: string; relationship?: string };
                const rawRefs: Ref[] = Array.isArray(customer.references)
                  ? (customer.references as unknown[]).filter(
                      (r): r is Ref => r !== null && typeof r === 'object' && !Array.isArray(r),
                    ) as Ref[]
                  : [];
                // Drop empty placeholder objects (detail page pads to length 4 on save)
                const refs = rawRefs.filter(
                  (r) => (r.firstName || r.lastName || r.phone || r.relationship || r.prefix),
                );
                if (refs.length === 0) return null;
                return (
                  <CustomerInfoSection title={`บุคคลอ้างอิง (${refs.length})`}>
                    <div className="space-y-2">
                      {refs.map((ref, idx) => {
                        const fullName = [ref.prefix, ref.firstName, ref.lastName].filter(Boolean).join(' ').trim();
                        return (
                          <div key={idx} className="p-2.5 bg-muted rounded-lg text-xs space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-foreground">{fullName || '—'}</span>
                              {ref.relationship && (
                                <Badge variant="secondary" appearance="light" className="text-[10px]">{ref.relationship}</Badge>
                              )}
                            </div>
                            {ref.phone && (
                              <button
                                type="button"
                                onClick={() => originatePhoneCall.mutate(ref.phone!)}
                                disabled={originatePhoneCall.isPending}
                                className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors disabled:opacity-60"
                                title={`โทร ${ref.phone}`}
                              >
                                <Phone className="w-3 h-3" />
                                {ref.phone}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CustomerInfoSection>
                );
              })()}

              {summary?.overduePayments > 0 && (
                <div className="flex items-center gap-2 p-2.5 bg-destructive/10 rounded-lg text-destructive text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>ค้างชำระ {summary.overduePayments} งวด · ยอดรวม {Number(summary.totalOutstanding ?? 0).toLocaleString()} บ.</span>
                </div>
              )}

              <div className="pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setCustomerInfoOpen(false);
                    navigate(`/customers/${customerId}`);
                  }}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-sm border border-border rounded-lg hover:bg-accent transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  เปิดหน้าเต็ม / แก้ไขข้อมูล
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Signed contract PDF preview */}
      <Dialog open={!!pdfPreview} onOpenChange={(o) => !o && setPdfPreview(null)}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
            <DialogTitle className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                สัญญา {pdfPreview?.contractNumber}
              </span>
              {pdfPreview?.url && (
                <a
                  href={pdfPreview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors mr-6"
                >
                  เปิดในแท็บใหม่
                </a>
              )}
            </DialogTitle>
          </DialogHeader>
          {pdfPreview?.url && (
            <iframe
              src={pdfPreview.url}
              title={`สัญญา ${pdfPreview.contractNumber}`}
              className="flex-1 w-full border-0"
            />
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

// ─── InternalNotesSection ─────────────────────────────────

function InternalNotesSection({ roomId, notes }: { roomId: string; notes: InternalNoteItem[] }) {
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [noteText, setNoteText] = useState('');
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionStart, setMentionStart] = useState(-1);

  const { data: onlineStaff } = useQuery({
    queryKey: ['online-staff'],
    queryFn: () => api.get('/staff-chat/staff/online').then((r) => r.data?.data ?? r.data),
    staleTime: 30_000,
  });

  const addNote = useMutation({
    mutationFn: (content: string) =>
      api.post(`/staff-chat/rooms/${roomId}/notes`, { content }).then((r) => r.data),
    onSuccess: () => {
      setNoteText('');
      queryClient.invalidateQueries({ queryKey: ['customer-notes', roomId] });
      toast.success('บันทึกโน้ตแล้ว');
    },
    onError: () => toast.error('ไม่สามารถบันทึกโน้ตได้'),
  });

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNoteText(val);

    // Detect @mention: find last @ before cursor
    const cursor = e.target.selectionStart ?? val.length;
    const textBefore = val.slice(0, cursor);
    const lastAt = textBefore.lastIndexOf('@');

    if (lastAt !== -1) {
      const afterAt = textBefore.slice(lastAt + 1);
      // Only show if no space after @
      if (!afterAt.includes(' ')) {
        setMentionStart(lastAt);
        setMentionFilter(afterAt.toLowerCase());
        setShowMentionDropdown(true);
        return;
      }
    }
    setShowMentionDropdown(false);
    setMentionFilter('');
    setMentionStart(-1);
  };

  const handleSelectMention = (staffName: string) => {
    if (mentionStart === -1) return;
    const before = noteText.slice(0, mentionStart);
    const cursor = textareaRef.current?.selectionStart ?? noteText.length;
    const after = noteText.slice(cursor);
    const inserted = `@${staffName} `;
    setNoteText(before + inserted + after);
    setShowMentionDropdown(false);
    setMentionFilter('');
    setMentionStart(-1);
    // Refocus textarea
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        const pos = before.length + inserted.length;
        ta.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const filteredStaff = (Array.isArray(onlineStaff) ? (onlineStaff as StaffItem[]) : []).filter((s) =>
    s.name?.toLowerCase().includes(mentionFilter),
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setShowMentionDropdown(false);
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (showMentionDropdown) return;
      if (noteText.trim()) addNote.mutate(noteText.trim());
    }
  };

  return (
    <div className="p-4 border-b border-border">
      <SectionHeader icon={FileText} label="บันทึกภายใน" />

      {/* Existing notes */}
      {notes.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {notes.slice(0, 5).map((note) => (
            <div key={note.id} className="p-2 bg-warning/10 rounded text-xs border border-warning/20">
              <p className="text-foreground/80 whitespace-pre-wrap">{note.content}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {note.staff?.name} · {format(new Date(note.createdAt), 'dd/MM HH:mm')}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Note input with @mention */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={noteText}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="เพิ่มโน้ต... (@ แท็กสมาชิก · Shift+Enter ขึ้นบรรทัด)"
          rows={2}
          className="w-full text-xs rounded-lg border border-border px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/50"
        />

        {/* @mention dropdown */}
        {showMentionDropdown && filteredStaff.length > 0 && (
          <div className="absolute bottom-full left-0 mb-1 w-full bg-card border border-border rounded-lg shadow-lg z-50 max-h-36 overflow-y-auto">
            {filteredStaff.map((s: any) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent textarea blur
                  handleSelectMention(s.name);
                }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2"
              >
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                  {s.name?.[0]?.toUpperCase() ?? '?'}
                </span>
                <span className="truncate">{s.name}</span>
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => { if (noteText.trim()) addNote.mutate(noteText.trim()); }}
          disabled={!noteText.trim() || addNote.isPending}
          className="mt-1.5 w-full text-xs bg-foreground/90 hover:bg-foreground/80 disabled:opacity-40 text-white rounded-lg py-1.5 transition-colors"
        >
          {addNote.isPending ? 'กำลังบันทึก...' : 'บันทึกโน้ต'}
        </button>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────

const paymentMethodMeta: Record<string, { label: string; icon: typeof Banknote; className: string }> = {
  CASH:           { label: 'เงินสด', icon: Banknote,   className: 'bg-success/10 text-success' },
  BANK_TRANSFER:  { label: 'โอน',    icon: Landmark,   className: 'bg-info/10 text-info' },
  QR_EWALLET:     { label: 'QR',     icon: QrCode,     className: 'bg-primary/10 text-primary' },
  ONLINE_GATEWAY: { label: 'ออนไลน์', icon: CreditCard, className: 'bg-accent text-accent-foreground' },
};

function PaymentMethodChip({ method }: { method: string | null | undefined }) {
  if (!method) return <span className="text-[10px] text-muted-foreground">—</span>;
  const meta = paymentMethodMeta[method];
  if (!meta) {
    return (
      <span className="inline-flex items-center px-1 py-px rounded text-[9px] font-medium bg-muted text-muted-foreground">
        {method}
      </span>
    );
  }
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-medium ${meta.className}`}>
      <Icon className="w-2.5 h-2.5" />
      {meta.label}
    </span>
  );
}

function RecentPaymentGroup({ payment }: { payment: PaymentSummaryItem }) {
  const [open, setOpen] = useState(false);
  const isPartial = payment.status === 'PARTIALLY_PAID';
  const due = Number(payment.amountDue);
  const paid = Number(payment.amountPaid);
  const partialCount = payment.partials.length;
  const expandable = partialCount > 1 || isPartial;

  return (
    <div className="rounded-md bg-muted/30 border border-border/50 overflow-hidden">
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        className={cn(
          'w-full grid grid-cols-[12px_1fr_auto] items-center gap-2 px-2 py-1.5 text-left',
          expandable ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default',
        )}
      >
        {expandable ? (
          <ChevronRight
            className={cn(
              'w-3 h-3 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
        ) : (
          <span />
        )}
        <div className="min-w-0">
          <div className="text-[11px] text-foreground/90 truncate">
            <span className="font-mono text-info">{payment.contract?.contractNumber}</span>
            <span className="text-muted-foreground"> · งวด {payment.installmentNo}</span>
          </div>
          <div className="text-[9px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
            {partialCount > 1 && <span>{partialCount} ครั้ง</span>}
            {partialCount > 1 && (isPartial || partialCount === 1) && <span>·</span>}
            <span
              className={cn(
                'inline-flex items-center px-1 py-px rounded text-[9px] font-semibold',
                isPartial
                  ? 'bg-warning/10 text-warning'
                  : 'bg-success/10 text-success',
              )}
            >
              {isPartial ? 'ชำระบางส่วน' : 'ครบ'}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs font-semibold text-success tabular-nums">
            {paid.toLocaleString()} บ.
          </div>
          {isPartial && (
            <div className="text-[9px] text-warning tabular-nums">
              / {due.toLocaleString()}
            </div>
          )}
        </div>
      </button>

      {open && expandable && (
        <div className="border-t border-border/50 bg-background/40">
          {payment.partials.map((r, idx) => (
            <div
              key={r.id}
              className="grid grid-cols-[16px_1fr_auto] items-center gap-2 pl-6 pr-2 py-1 text-[10px] border-t border-border/30 first:border-t-0"
            >
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted text-muted-foreground text-[9px] font-semibold tabular-nums">
                {partialCount - idx}
              </span>
              <div className="flex items-center gap-1.5 min-w-0">
                <PaymentMethodChip method={r.paymentMethod} />
                <span className="text-muted-foreground truncate">
                  {format(new Date(r.paidDate), 'dd/MM HH:mm')}
                </span>
              </div>
              <span className="font-medium text-foreground tabular-nums">
                {Number(r.amount).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      <h4 className="text-[11px] font-semibold text-foreground/70 uppercase tracking-wide">{label}</h4>
    </div>
  );
}

function QuickActionBtn({
  icon,
  label,
  onClick,
  className,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2 py-2 text-[11px] bg-muted hover:bg-accent rounded-lg text-foreground/70 transition-colors',
        className,
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function CustomerInfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 text-xs">
      <span className="text-muted-foreground w-24 flex-shrink-0">{label}</span>
      <span className="text-foreground flex-1 break-words">{value}</span>
    </div>
  );
}

function CustomerInfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-foreground/70 uppercase tracking-wide">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const colors: Record<string, string> = {
    LINE_FINANCE: 'bg-success',
    LINE_SHOP: 'bg-success/80',
    FACEBOOK: 'bg-info',
    TIKTOK: 'bg-primary',
    WEB: 'bg-muted-foreground',
  };
  const labels: Record<string, string> = {
    LINE_FINANCE: 'LINE',
    LINE_SHOP: 'LINE Shop',
    FACEBOOK: 'FB',
    TIKTOK: 'TikTok',
    WEB: 'Web',
  };
  return (
    <span
      className={cn(
        'text-white text-[9px] font-bold px-1.5 py-0.5 rounded',
        colors[channel] ?? 'bg-muted-foreground/30',
      )}
    >
      {labels[channel] ?? channel}
    </span>
  );
}
