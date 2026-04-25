import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import ProductContextCard from './ProductContextCard';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, contractStatusMap, riskLevelMap } from '@/lib/status-badges';
import {
  User,
  FileText,
  CreditCard,
  AlertTriangle,
  Clock,
  Phone,
  MessageSquare,
  Smartphone,
  Link2,
  QrCode,
  Zap,
  Send,
  Shield,
  Copy,
  Check,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import QRCodeSVG from 'react-qr-code';
import { format, isPast, differenceInDays } from 'date-fns';
import { th } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type DialogView = null | 'contracts' | 'payments' | 'customer' | 'send-link' | 'send-qr';

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

interface PaymentSummaryItem {
  id: string;
  contract?: { contractNumber: string };
  installmentNo: number;
  amountPaid: number | string;
  paidDate?: string;
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
  const [dialogView, setDialogView] = useState<DialogView>(null);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [paymentLinkUrl, setPaymentLinkUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  // ─── Payment link creation ────────────────────────────
  const createPaymentLink = useMutation({
    mutationFn: (contractId: string) =>
      api.post('/line-oa/payment-link', { contractId }).then((r) => r.data),
    onSuccess: (data) => {
      setPaymentLinkUrl(data.url ?? data.data?.url ?? null);
    },
    onError: () => toast.error('ไม่สามารถสร้างลิงก์ชำระได้'),
  });

  // ─── Send message to customer LINE ───────────────────
  const sendLineMessage = useMutation({
    mutationFn: (text: string) =>
      api.post(`/staff-chat/customer/${customerId}/messages`, { text }).then((r) => r.data),
    onSuccess: () => {
      toast.success('ส่งลิงก์ทาง LINE แล้ว');
      closeDialog();
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err?.response?.data?.error ?? 'ไม่สามารถส่งได้');
    },
  });

  const closeDialog = () => {
    setDialogView(null);
    setSelectedContractId(null);
    setPaymentLinkUrl(null);
    setCopied(false);
  };

  const handleSelectContract = (contractId: string, view: 'send-link' | 'send-qr') => {
    setSelectedContractId(contractId);
    setPaymentLinkUrl(null);
    createPaymentLink.mutate(contractId);
    // view stays as-is (send-link or send-qr) — just update selected contract
    void view;
  };

  const handleCopyLink = () => {
    if (!paymentLinkUrl) return;
    navigator.clipboard.writeText(paymentLinkUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
            <p className="text-xs text-muted-foreground">{customer?.phone}</p>
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
              <div key={p.id} className="flex items-center justify-between text-xs">
                <div>
                  <span className="text-foreground/80">{p.contract?.contractNumber}</span>
                  <span className="text-muted-foreground ml-1">งวด {p.installmentNo}</span>
                </div>
                <div className="text-right">
                  <span className="font-medium text-success">
                    {Number(p.amountPaid).toLocaleString()} บ.
                  </span>
                  {p.paidDate && (
                    <p className="text-[10px] text-muted-foreground">
                      {format(new Date(p.paidDate), 'dd/MM/yy')}
                    </p>
                  )}
                </div>
              </div>
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
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Send className="w-3.5 h-3.5 text-muted-foreground" />
            <h4 className="text-[11px] font-semibold text-foreground/70 uppercase tracking-wide">ดำเนินการ</h4>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors"
                title="ดำเนินการ"
              >
                <Zap className="w-3.5 h-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" side="top" className="w-56 p-2">
              <div className="grid grid-cols-2 gap-1.5">
                <QuickActionBtn
                  icon={<Link2 className="w-3.5 h-3.5 flex-shrink-0" />}
                  label="ส่งลิงก์ชำระ"
                  onClick={() => setDialogView('send-link')}
                />
                <QuickActionBtn
                  icon={<QrCode className="w-3.5 h-3.5 flex-shrink-0" />}
                  label="ส่ง QR ชำระ"
                  onClick={() => setDialogView('send-qr')}
                />
                <QuickActionBtn
                  icon={<FileText className="w-3.5 h-3.5 flex-shrink-0" />}
                  label="ดูสัญญา"
                  onClick={() => setDialogView('contracts')}
                />
                <QuickActionBtn
                  icon={<Clock className="w-3.5 h-3.5 flex-shrink-0" />}
                  label="ประวัติชำระ"
                  onClick={() => setDialogView('payments')}
                />
                <QuickActionBtn
                  icon={<User className="w-3.5 h-3.5 flex-shrink-0" />}
                  label="ดูข้อมูลลูกค้า"
                  onClick={() => setDialogView('customer')}
                  className="col-span-2"
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      </div>{/* end scrollable */}

      {/* ─── Quick Action Dialogs ──────────────────────── */}

      {/* Contracts */}
      <Dialog open={dialogView === 'contracts'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4" /> สัญญาที่ใช้งาน
            </DialogTitle>
          </DialogHeader>
          {summary?.activeContracts?.length > 0 ? (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {(summary.activeContracts as ContractSummaryItem[]).map((c) => {
                const sCfg = getStatusBadgeProps(c.status, contractStatusMap);
                const productName = c.product?.name ?? (`${c.product?.brand ?? ''} ${c.product?.model ?? ''}`.trim() || 'สินค้า');
                return (
                  <div key={c.id} className="p-3 bg-muted rounded-lg text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-foreground">{c.contractNumber}</span>
                      <Badge variant={sCfg.variant} appearance={sCfg.appearance} className="text-[10px]">
                        {localContractStatusMap[c.status] ?? sCfg.label}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-xs mb-2">{productName}</p>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>ชำระแล้ว {c.paidInstallments}/{c.totalInstallments} งวด</span>
                      <span>{Number(c.monthlyPayment).toLocaleString()} บ./งวด</span>
                    </div>
                    <div className="w-full bg-border rounded-full h-1.5">
                      <div className="bg-primary h-1.5 rounded-full" style={{ width: `${(c.paidInstallments / c.totalInstallments) * 100}%` }} />
                    </div>
                    {c.nextDueDate && (
                      <p className="text-xs text-muted-foreground mt-1">ถัดไป: {format(new Date(c.nextDueDate), 'dd/MM/yyyy')}</p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">ไม่มีสัญญาที่ใช้งาน</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Payment History */}
      <Dialog open={dialogView === 'payments'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-4 h-4" /> ประวัติการชำระ
            </DialogTitle>
          </DialogHeader>
          {summary?.recentPayments?.length > 0 ? (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {(summary.recentPayments as PaymentSummaryItem[]).map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-border last:border-0 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{p.contract?.contractNumber ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">งวดที่ {p.installmentNo}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-success">{Number(p.amountPaid).toLocaleString()} บ.</p>
                    {p.paidDate && (
                      <p className="text-xs text-muted-foreground">{format(new Date(p.paidDate), 'dd MMM yyyy', { locale: th })}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">ยังไม่มีประวัติการชำระ</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Customer Info */}
      <Dialog open={dialogView === 'customer'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="w-4 h-4" /> ข้อมูลลูกค้า
            </DialogTitle>
          </DialogHeader>
          {customer && (
            <div className="space-y-3 text-sm max-h-[60vh] overflow-y-auto pr-1">
              <InfoRow label="ชื่อ" value={customer.name} />
              <InfoRow label="โทรศัพท์" value={customer.phone} />
              {customer.email && <InfoRow label="อีเมล" value={customer.email} />}
              {customer.idCard && <InfoRow label="เลขบัตร" value={customer.idCard} />}
              {customer.occupation && <InfoRow label="อาชีพ" value={customer.occupation} />}
              {customer.address && <InfoRow label="ที่อยู่" value={customer.address} />}
              {summary?.overduePayments > 0 && (
                <div className="flex items-center gap-2 p-2 bg-destructive/10 rounded-lg text-destructive text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>ค้างชำระ {summary.overduePayments} งวด · ยอดรวม {Number(summary.totalOutstanding ?? 0).toLocaleString()} บ.</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Send Payment Link */}
      <Dialog open={dialogView === 'send-link'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-4 h-4" /> ส่งลิงก์ชำระเงิน
            </DialogTitle>
          </DialogHeader>
          <PaymentActionDialogBody
            contracts={summary?.activeContracts ?? []}
            selectedContractId={selectedContractId}
            paymentLinkUrl={paymentLinkUrl}
            loading={createPaymentLink.isPending}
            copied={copied}
            onSelectContract={(id: string) => handleSelectContract(id, 'send-link')}
            onCopy={handleCopyLink}
            onSendLine={() => paymentLinkUrl && sendLineMessage.mutate(paymentLinkUrl)}
            sendingLine={sendLineMessage.isPending}
            mode="link"
          />
        </DialogContent>
      </Dialog>

      {/* Send QR */}
      <Dialog open={dialogView === 'send-qr'} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="w-4 h-4" /> ส่ง QR ชำระเงิน
            </DialogTitle>
          </DialogHeader>
          <PaymentActionDialogBody
            contracts={summary?.activeContracts ?? []}
            selectedContractId={selectedContractId}
            paymentLinkUrl={paymentLinkUrl}
            loading={createPaymentLink.isPending}
            copied={copied}
            onSelectContract={(id: string) => handleSelectContract(id, 'send-qr')}
            onCopy={handleCopyLink}
            onSendLine={() => paymentLinkUrl && sendLineMessage.mutate(paymentLinkUrl)}
            sendingLine={sendLineMessage.isPending}
            mode="qr"
          />
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

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-20 flex-shrink-0">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function PaymentActionDialogBody({
  contracts,
  selectedContractId,
  paymentLinkUrl,
  loading,
  copied,
  onSelectContract,
  onCopy,
  onSendLine,
  sendingLine,
  mode,
}: {
  contracts: ContractSummaryItem[];
  selectedContractId: string | null;
  paymentLinkUrl: string | null;
  loading: boolean;
  copied: boolean;
  onSelectContract: (id: string) => void;
  onCopy: () => void;
  onSendLine: () => void;
  sendingLine: boolean;
  mode: 'link' | 'qr';
}) {
  return (
    <div className="space-y-4">
      {/* Contract picker */}
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">เลือกสัญญา:</p>
        {contracts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">ไม่มีสัญญาที่ใช้งาน</p>
        ) : (
          contracts.map((c) => {
            const productName = c.product?.name ?? (`${c.product?.brand ?? ''} ${c.product?.model ?? ''}`.trim() || 'สินค้า');
            const isSelected = c.id === selectedContractId;
            return (
              <button
                key={c.id}
                onClick={() => onSelectContract(c.id)}
                className={cn(
                  'w-full text-left p-2.5 rounded-lg border text-sm transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border hover:bg-accent text-muted-foreground',
                )}
              >
                <span className="font-medium">{c.contractNumber}</span>
                <span className="ml-2 text-xs">{productName}</span>
              </button>
            );
          })
        )}
      </div>

      {/* Result: loading */}
      {loading && (
        <p className="text-sm text-muted-foreground text-center py-2">กำลังสร้างลิงก์...</p>
      )}

      {/* Result: link mode */}
      {!loading && paymentLinkUrl && mode === 'link' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-2 bg-muted rounded-lg text-xs break-all">
            <span className="flex-1 text-foreground">{paymentLinkUrl}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCopy}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm border border-border rounded-lg hover:bg-accent transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
            </button>
            <button
              onClick={onSendLine}
              disabled={sendingLine}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              {sendingLine ? 'กำลังส่ง...' : 'ส่งผ่าน LINE'}
            </button>
          </div>
        </div>
      )}

      {/* Result: QR mode */}
      {!loading && paymentLinkUrl && mode === 'qr' && (
        <div className="space-y-3 flex flex-col items-center">
          <div className="p-4 bg-white rounded-xl border border-border inline-block">
            <QRCodeSVG value={paymentLinkUrl} size={180} level="M" />
          </div>
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 px-4 py-2 text-sm border border-border rounded-lg hover:bg-accent transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
          </button>
        </div>
      )}
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
