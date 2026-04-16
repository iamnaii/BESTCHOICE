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
  ExternalLink,
  Link2,
  Send,
  Shield,
} from 'lucide-react';
import { format, isPast, differenceInDays } from 'date-fns';
import { th } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

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
  LINE_FINANCE: 'bg-green-100 text-green-700',
  LINE_SHOP: 'bg-lime-100 text-lime-700',
  FACEBOOK: 'bg-blue-100 text-blue-700',
  TIKTOK: 'bg-pink-100 text-pink-700',
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
  // ─── Customer basic info ──────────────────────────────
  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer-360', customerId],
    queryFn: () => api.get(`/customers/${customerId}`).then((r: any) => r.data?.data ?? r.data),
    enabled: !!customerId,
  });

  // ─── Risk flag ────────────────────────────────────────
  const { data: riskData } = useQuery({
    queryKey: ['customer-risk', customerId],
    queryFn: () => api.get(`/customers/${customerId}/risk-flag`).then((r: any) => r.data?.data ?? r.data),
    enabled: !!customerId,
  });

  // ─── Chat summary (payments, contracts, call logs, sessions) ──
  const { data: summary } = useQuery({
    queryKey: ['customer-chat-summary', customerId],
    queryFn: () => api.get(`/customers/${customerId}/chat-summary`).then((r: any) => r.data?.data ?? r.data),
    enabled: !!customerId,
    staleTime: 30_000,
  });

  // ─── Notes ──────────────────────────────────────────
  const { data: notesData } = useQuery({
    queryKey: ['customer-notes', activeRoomId],
    queryFn: () => api.get(`/staff-chat/rooms/${activeRoomId}/notes`).then((r: any) => r.data?.data ?? r.data),
    enabled: !!activeRoomId,
  });

  // ─── Cross-channel rooms ─────────────────────────────
  const { data: crossRooms } = useQuery({
    queryKey: ['cross-channel-rooms', activeRoomId],
    queryFn: () => api.get(`/staff-chat/rooms/${activeRoomId}/cross-channel`).then((r: any) => r.data?.data ?? r.data),
    enabled: !!activeRoomId,
  });

  if (!customerId) {
    return (
      <div className="w-72 border-l border-border hidden lg:flex items-center justify-center text-muted-foreground text-sm p-4">
        เลือกการสนทนาเพื่อดูข้อมูลลูกค้า
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="w-80 border-l border-border hidden lg:flex items-center justify-center text-muted-foreground text-sm">
        <div className="animate-pulse space-y-3 w-full p-4">
          <div className="h-16 bg-muted rounded-lg" />
          <div className="h-24 bg-muted rounded-lg" />
          <div className="h-32 bg-muted rounded-lg" />
        </div>
      </div>
    );
  }

  const riskLevel = riskData?.riskLevel ?? 'NONE';

  // Derive contract + product from summary for MDM/Warranty sections
  const firstContract = summary?.activeContracts?.[0];
  const firstProduct = firstContract?.product;

  return (
    <div className="w-72 flex-shrink-0 border-l border-border hidden lg:block overflow-y-auto h-full">
      {/* ─── 1. Customer Profile ────────────────────────── */}
      <div className="p-4 border-b border-border">
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
          <div className="mt-2 p-2 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <div className="text-xs">
              <span className="font-semibold text-red-700">ค้าง {summary.overdueCount} งวด</span>
              <span className="text-red-500 ml-1">
                ({Number(summary.totalOutstanding).toLocaleString()} บ.)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ─── 1b. Product Context (detected from chat) ────── */}
      <ProductContextCard roomId={activeRoomId ?? ''} />

      {/* ─── 1c. Cross-Channel Rooms ─────────────────────── */}
      {crossRooms && crossRooms.length > 0 && (
        <div className="border-b border-border">
          <div className="px-4 pt-4 pb-2">
            <SectionHeader icon={MessageSquare} label="ห้องแชททั้งหมด" />
          </div>
          {crossRooms.map((r: any) => (
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
            <span className="text-red-600 font-medium">🔒 ล็อคอยู่</span>
            <span className="text-muted-foreground ml-2">
              ตั้งแต่ {format(new Date(firstContract.mdmLockedAt), 'dd MMM yyyy', { locale: th })}
            </span>
          </div>
        ) : (
          <div className="text-[12px] text-green-600 font-medium">🔓 ไม่ได้ล็อค</div>
        )}
      </div>

      {/* ─── 1e. Warranty (2-tier: manufacturer + shop) ─── */}
      <div className="p-4 border-b border-border">
        <SectionHeader icon={Shield} label="การรับประกัน" />
        {summary?.activeContracts?.length > 0 ? (
          <div className="space-y-3">
            {summary.activeContracts.map((c: any) => {
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
                      <p className="text-red-500 ml-3">❌ ศูนย์: หมดแล้ว</p>
                    ) : (
                      <p className="text-green-600 ml-3">
                        ✅ ศูนย์: ถึง {format(mfrDate, 'dd MMM yyyy', { locale: th })}{' '}
                        <span className="text-muted-foreground">(เหลือ {mfrDays} วัน)</span>
                      </p>
                    )
                  ) : (
                    <p className="text-red-500 ml-3">❌ ศูนย์: หมดแล้ว</p>
                  )}

                  {/* Shop warranty — only show when exists */}
                  {shopDate && (
                    shopExpired ? (
                      <p className="text-red-500 ml-3">❌ ร้าน: หมดแล้ว</p>
                    ) : (
                      <p className="text-green-600 ml-3">
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
            {summary.activeContracts.map((c: any) => (
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
                      className="bg-blue-500 h-1.5 rounded-full transition-all"
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
            {summary.recentPayments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between text-xs">
                <div>
                  <span className="text-foreground/80">{p.contract?.contractNumber}</span>
                  <span className="text-muted-foreground ml-1">งวด {p.installmentNo}</span>
                </div>
                <div className="text-right">
                  <span className="font-medium text-green-600">
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
            {summary.chatSessions.map((s: any) => (
              <div
                key={s.id}
                className={`flex items-center gap-2 p-1.5 rounded text-xs ${
                  s.id === activeRoomId ? 'bg-blue-50 border border-blue-200' : 'hover:bg-muted/50'
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
            {summary.callLogs.map((log: any) => (
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
        <SectionHeader icon={Send} label="ดำเนินการ" />
        <div className="grid grid-cols-2 gap-2">
          <QuickActionBtn
            icon={<Link2 className="w-3.5 h-3.5" />}
            label="ส่งลิงก์ชำระ"
            onClick={() => toast.info('เลือกสัญญาก่อนส่งลิงก์')}
          />
          <QuickActionBtn
            icon={<FileText className="w-3.5 h-3.5" />}
            label="สร้างสัญญา"
            onClick={() => window.open(`/contracts/create`, '_blank')}
          />
          <QuickActionBtn
            icon={<ExternalLink className="w-3.5 h-3.5" />}
            label="ดูข้อมูลลูกค้า"
            onClick={() => window.open(`/customers/${customerId}`, '_blank')}
          />
          <QuickActionBtn
            icon={<Clock className="w-3.5 h-3.5" />}
            label="ประวัติชำระ"
            onClick={() => window.open(`/payments?search=${customer?.phone}`, '_blank')}
          />
        </div>
      </div>
    </div>
  );
}

// ─── InternalNotesSection ─────────────────────────────────

function InternalNotesSection({ roomId, notes }: { roomId: string; notes: any[] }) {
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [noteText, setNoteText] = useState('');
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionStart, setMentionStart] = useState(-1);

  const { data: onlineStaff } = useQuery({
    queryKey: ['online-staff'],
    queryFn: () => api.get('/staff-chat/staff/online').then((r: any) => r.data?.data ?? r.data),
    staleTime: 30_000,
  });

  const addNote = useMutation({
    mutationFn: (content: string) =>
      api.post(`/staff-chat/rooms/${roomId}/notes`, { content }).then((r: any) => r.data),
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

  const filteredStaff = (Array.isArray(onlineStaff) ? onlineStaff : []).filter((s: any) =>
    s.name?.toLowerCase().includes(mentionFilter),
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setShowMentionDropdown(false);
    }
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      if (noteText.trim()) addNote.mutate(noteText.trim());
    }
  };

  return (
    <div className="p-4 border-b border-border">
      <SectionHeader icon={FileText} label="บันทึกภายใน" />

      {/* Existing notes */}
      {notes.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {notes.slice(0, 5).map((note: any) => (
            <div key={note.id} className="p-2 bg-yellow-50 rounded text-xs border border-yellow-100">
              <p className="text-foreground/80 whitespace-pre-wrap">{note.content}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {note.author?.name} · {format(new Date(note.createdAt), 'dd/MM HH:mm')}
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
          placeholder="เพิ่มโน้ต... (พิมพ์ @ เพื่อแท็กสมาชิก, Ctrl+Enter บันทึก)"
          rows={2}
          className="w-full text-xs rounded-lg border border-border px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300 placeholder:text-muted-foreground/50"
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
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-2"
              >
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[9px] font-bold flex-shrink-0">
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
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-2 text-[11px] bg-muted hover:bg-accent rounded-lg text-foreground/70 transition-colors"
    >
      {icon}
      {label}
    </button>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const colors: Record<string, string> = {
    LINE_FINANCE: 'bg-green-500',
    LINE_SHOP: 'bg-emerald-400',
    FACEBOOK: 'bg-blue-600',
    TIKTOK: 'bg-pink-500',
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
