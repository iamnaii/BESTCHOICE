import { AlertTriangle, ArrowRightLeft, Clock, Camera, ShieldAlert, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { StockDashboard } from '../types';
import { formatDateShort } from '@/utils/formatters';

export interface StockActionZoneProps {
  dashboard: StockDashboard | undefined;
  warrantyExpiring: { id: string; name: string; brand: string; model: string; warrantyExpireDate: string }[];
  onNavigateToList: (status?: string) => void;
}

interface ActionCard {
  key: string;
  count: number;
  label: string;
  hint: string;
  icon: React.ReactNode;
  tone: 'warning' | 'destructive' | 'primary' | 'info';
  onClick: () => void;
}

const TONE_STYLES = {
  warning: {
    border: 'border-warning/40 hover:border-warning',
    bg: 'bg-warning/5 hover:bg-warning/10',
    accent: 'bg-warning/15 text-warning',
    text: 'text-warning',
    badge: 'bg-warning text-warning-foreground',
  },
  destructive: {
    border: 'border-destructive/40 hover:border-destructive',
    bg: 'bg-destructive/5 hover:bg-destructive/10',
    accent: 'bg-destructive/15 text-destructive',
    text: 'text-destructive',
    badge: 'bg-destructive text-destructive-foreground',
  },
  primary: {
    border: 'border-primary/40 hover:border-primary',
    bg: 'bg-primary/5 hover:bg-primary/10',
    accent: 'bg-primary/15 text-primary',
    text: 'text-primary',
    badge: 'bg-primary text-primary-foreground',
  },
  info: {
    border: 'border-info/40 hover:border-info',
    bg: 'bg-info/5 hover:bg-info/10',
    accent: 'bg-info/15 text-info',
    text: 'text-info',
    badge: 'bg-info text-info-foreground',
  },
} as const;

export function StockActionZone({ dashboard, warrantyExpiring, onNavigateToList }: StockActionZoneProps) {
  const navigate = useNavigate();

  if (!dashboard) return null;

  const a = dashboard.actionRequired;
  const total = a.inspection + (a.photoPending || 0) + a.pendingTransfers + a.repossessed + a.agingOver90;

  if (total === 0 && warrantyExpiring.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-4 mb-6 flex items-center gap-3">
        <div className="size-9 rounded-lg bg-success/15 text-success flex items-center justify-center">
          <ShieldAlert className="size-4" strokeWidth={1.5} />
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">ไม่มีรายการต้องทำ</div>
          <div className="text-xs text-muted-foreground">คลังสินค้าทั้งหมดอยู่ในสถานะปกติ</div>
        </div>
      </div>
    );
  }

  const cards: ActionCard[] = [];

  if (a.agingOver90 > 0) {
    cards.push({
      key: 'aging',
      count: a.agingOver90,
      label: 'ค้างสต็อค 90+ วัน',
      hint: 'ทุนจม — ต้องเร่งระบาย',
      icon: <Clock className="size-5" strokeWidth={1.5} />,
      tone: 'warning',
      onClick: () => onNavigateToList('IN_STOCK'),
    });
  }

  if (a.repossessed > 0) {
    cards.push({
      key: 'repo',
      count: a.repossessed,
      label: 'ยึดคืน รอปรับสภาพ',
      hint: 'ส่งซ่อม → QC → กลับเข้าคลัง',
      icon: <ShieldAlert className="size-5" strokeWidth={1.5} />,
      tone: 'destructive',
      onClick: () => onNavigateToList('REPOSSESSED'),
    });
  }

  if (a.pendingTransfers > 0) {
    cards.push({
      key: 'transfer',
      count: a.pendingTransfers,
      label: 'รอยืนยันโอน',
      hint: 'สาขาปลายทางต้องตรวจรับ',
      icon: <ArrowRightLeft className="size-5" strokeWidth={1.5} />,
      tone: 'primary',
      onClick: () => navigate('/stock/transfers'),
    });
  }

  if (a.inspection > 0) {
    cards.push({
      key: 'inspect',
      count: a.inspection,
      label: 'รอตรวจสอบ (QC)',
      hint: 'ตรวจสภาพก่อนเข้าคลัง',
      icon: <ShieldAlert className="size-5" strokeWidth={1.5} />,
      tone: 'warning',
      onClick: () => onNavigateToList('INSPECTION'),
    });
  }

  if ((a.photoPending || 0) > 0) {
    cards.push({
      key: 'photo',
      count: a.photoPending,
      label: 'รอถ่ายรูป',
      hint: 'ถ่าย 6 มุม → พร้อมขาย',
      icon: <Camera className="size-5" strokeWidth={1.5} />,
      tone: 'info',
      onClick: () => onNavigateToList('PHOTO_PENDING'),
    });
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold flex items-center gap-2">
          <AlertTriangle className="size-4 text-warning" strokeWidth={1.75} />
          ต้องทำเลย
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            ({total + warrantyExpiring.length})
          </span>
        </h2>
      </div>

      {/* Action cards grid */}
      {cards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
          {cards.map((card) => {
            const t = TONE_STYLES[card.tone];
            return (
              <button
                key={card.key}
                onClick={card.onClick}
                className={`relative text-left rounded-xl border p-3.5 transition-all group ${t.border} ${t.bg}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`size-10 shrink-0 rounded-lg flex items-center justify-center ${t.accent}`}>
                    {card.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <span className={`text-2xl font-bold tabular-nums leading-none ${t.text}`}>
                        {card.count}
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                    </div>
                    <div className="text-[13px] font-semibold text-foreground leading-tight">
                      {card.label}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{card.hint}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Warranty list — compact strip */}
      {warrantyExpiring.length > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-3.5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-warning" strokeWidth={1.75} />
              <span className="text-[13px] font-semibold text-warning">
                รับประกันใกล้หมด ({warrantyExpiring.length})
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
            {warrantyExpiring.slice(0, 6).map((p) => (
              <div key={p.id} className="flex items-center justify-between text-[12px] gap-2">
                <span className="text-foreground/90 truncate">
                  {p.brand} {p.model}
                </span>
                <span className="font-mono tabular-nums text-warning shrink-0">
                  {formatDateShort(p.warrantyExpireDate)}
                </span>
              </div>
            ))}
          </div>
          {warrantyExpiring.length > 6 && (
            <div className="text-[11px] text-warning/80 mt-1.5">
              + อีก {warrantyExpiring.length - 6} รายการ
            </div>
          )}
        </div>
      )}
    </div>
  );
}
