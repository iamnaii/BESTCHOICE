import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
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
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface Customer360PanelProps {
  customerId: string | null;
  activeRoomId?: string | null;
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
  WEB: 'bg-gray-100 text-gray-600',
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

export default function Customer360Panel({ customerId, activeRoomId }: Customer360PanelProps) {
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

  if (!customerId) {
    return (
      <div className="w-72 border-l border-gray-200 hidden lg:flex items-center justify-center text-gray-400 text-sm p-4">
        เลือกการสนทนาเพื่อดูข้อมูลลูกค้า
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="w-80 border-l border-gray-200 hidden lg:flex items-center justify-center text-gray-400 text-sm">
        <div className="animate-pulse space-y-3 w-full p-4">
          <div className="h-16 bg-gray-100 rounded-lg" />
          <div className="h-24 bg-gray-100 rounded-lg" />
          <div className="h-32 bg-gray-100 rounded-lg" />
        </div>
      </div>
    );
  }

  const riskLevel = riskData?.riskLevel ?? 'NONE';

  return (
    <div className="w-72 flex-shrink-0 border-l border-gray-200 hidden lg:block overflow-y-auto h-full">
      {/* ─── 1. Customer Profile ────────────────────────── */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <User className="w-5 h-5 text-blue-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm text-gray-900 truncate">{customer?.name}</h3>
            <p className="text-xs text-gray-500">{customer?.phone}</p>
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
          <p className="text-[11px] text-gray-400 ml-14">{customer.email}</p>
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
      {activeRoomId && <ProductContextCard roomId={activeRoomId} />}

      {/* ─── 2. Active Contracts + Product/IMEI ─────────── */}
      <div className="p-4 border-b border-gray-100">
        <SectionHeader icon={FileText} label="สัญญา" />

        {summary?.activeContracts?.length > 0 ? (
          <div className="space-y-2">
            {summary.activeContracts.map((c: any) => (
              <div key={c.id} className="p-2.5 bg-gray-50 rounded-lg text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-800">{c.contractNumber}</span>
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
                <div className="flex items-center gap-1 text-gray-500 mb-1">
                  <Smartphone className="w-3 h-3" />
                  <span>{c.product?.name ?? `${c.product?.brand} ${c.product?.model}`}</span>
                </div>
                {c.serialNumber && (
                  <p className="text-[10px] text-gray-400 ml-4">IMEI: {c.serialNumber}</p>
                )}

                {/* Payment progress */}
                <div className="mt-1.5">
                  <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
                    <span>ชำระแล้ว {c.paidInstallments}/{c.totalInstallments} งวด</span>
                    <span>{Number(c.monthlyPayment).toLocaleString()} บ./งวด</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${(c.paidInstallments / c.totalInstallments) * 100}%` }}
                    />
                  </div>
                  {c.nextDueDate && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      ถัดไป: {format(new Date(c.nextDueDate), 'dd/MM/yyyy')}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">ไม่มีสัญญาที่ใช้งาน</p>
        )}
      </div>

      {/* ─── 3. Recent Payments ──────────────────────────── */}
      <div className="p-4 border-b border-gray-100">
        <SectionHeader icon={CreditCard} label="การชำระล่าสุด" />

        {summary?.recentPayments?.length > 0 ? (
          <div className="space-y-1.5">
            {summary.recentPayments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between text-xs">
                <div>
                  <span className="text-gray-700">{p.contract?.contractNumber}</span>
                  <span className="text-gray-400 ml-1">งวด {p.installmentNo}</span>
                </div>
                <div className="text-right">
                  <span className="font-medium text-green-600">
                    {Number(p.amountPaid).toLocaleString()} บ.
                  </span>
                  {p.paidDate && (
                    <p className="text-[10px] text-gray-400">
                      {format(new Date(p.paidDate), 'dd/MM/yy')}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">ยังไม่มีการชำระ</p>
        )}
      </div>

      {/* ─── 4. Chat History (all channels) ──────────────── */}
      <div className="p-4 border-b border-gray-100">
        <SectionHeader icon={MessageSquare} label="ประวัติแชท" />

        {summary?.chatSessions?.length > 0 ? (
          <div className="space-y-1.5">
            {summary.chatSessions.map((s: any) => (
              <div
                key={s.id}
                className={`flex items-center gap-2 p-1.5 rounded text-xs ${
                  s.id === activeRoomId ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
                }`}
              >
                <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${channelColor[s.channel] ?? 'bg-gray-100'}`}>
                  {channelLabel[s.channel] ?? s.channel}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-gray-500">{sessionStatusLabel[s.sessionStatus] ?? s.sessionStatus}</span>
                  <span className="text-gray-300 mx-1">·</span>
                  <span className="text-gray-400">{s.totalMessages} ข้อความ</span>
                </div>
                <span className="text-[10px] text-gray-400 flex-shrink-0">
                  {format(new Date(s.lastMessageAt), 'dd/MM')}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">ไม่มีประวัติแชท</p>
        )}
      </div>

      {/* ─── 5. Call Logs ────────────────────────────────── */}
      {summary?.callLogs?.length > 0 && (
        <div className="p-4 border-b border-gray-100">
          <SectionHeader icon={Phone} label="ประวัติโทร" />
          <div className="space-y-1.5">
            {summary.callLogs.map((log: any) => (
              <div key={log.id} className="text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-700">{log.caller?.name ?? 'ระบบ'}</span>
                  <span className="text-[10px] text-gray-400">
                    {format(new Date(log.calledAt), 'dd/MM HH:mm')}
                  </span>
                </div>
                {log.notes && <p className="text-gray-400 truncate">{log.notes}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 6. Internal Notes ──────────────────────────── */}
      {notesData?.length > 0 && (
        <div className="p-4 border-b border-gray-100">
          <SectionHeader icon={FileText} label="บันทึกภายใน" />
          <div className="space-y-1.5">
            {notesData.slice(0, 5).map((note: any) => (
              <div key={note.id} className="p-2 bg-yellow-50 rounded text-xs border border-yellow-100">
                <p className="text-gray-700">{note.content}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {note.author?.name} · {format(new Date(note.createdAt), 'dd/MM HH:mm')}
                </p>
              </div>
            ))}
          </div>
        </div>
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

// ─── Sub-components ───────────────────────────────────────

function SectionHeader({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon className="w-3.5 h-3.5 text-gray-400" />
      <h4 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">{label}</h4>
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
      className="flex items-center gap-1.5 px-2 py-2 text-[11px] bg-gray-50 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"
    >
      {icon}
      {label}
    </button>
  );
}
