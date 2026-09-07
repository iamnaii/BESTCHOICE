import { ArrowLeft, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/utils/formatters';
import type { ReceivingUnitForm } from '../types';
import { defectReasonOptions } from '../constants';
import {
  conditionLabel,
  isAccessoryUnit,
  isUsedUnit,
  tally,
  unitState,
  unitTitle,
  type ReceivingScreen,
} from '../receiving-flow.util';
import { fieldCls } from './UnitInspectScreen';

export interface ReceivingSummaryProps {
  units: ReceivingUnitForm[];
  screens: ReceivingScreen[];
  mode: 'po' | 'direct';
  notes?: string;
  setNotes?: (value: string) => void;
  /** tap a row → back to that device's screen */
  onEditScreen: (screenIdx: number) => void;
  onBack: () => void;
  onConfirm: () => void;
  confirming?: boolean;
  confirmLabel?: string;
}

const thCls = 'px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap';
const tdCls = 'px-3 py-3 align-middle text-sm whitespace-nowrap';
const none = <span className="text-xs text-muted-foreground">ไม่มี</span>;
const dash = <span className="text-muted-foreground">—</span>;
const money = (v: string) => (v.trim() && Number(v) > 0 ? <span className="font-mono tabular-nums">{formatNumber(v)}</span> : dash);
const defectLabel = (u: ReceivingUnitForm) => defectReasonOptions.find((o) => o.value === u.defectReason)?.label ?? '';

function Result({ units, screen }: { units: ReceivingUnitForm[]; screen: ReceivingScreen }) {
  if (screen.kind === 'group') {
    const rows = screen.indices.map((i) => units[i]);
    const received = rows.filter((u) => u.status === 'PASS').length;
    const rejected = rows.length - received;
    return (
      <>
        <span className="font-semibold text-success">ผ่าน {received} ชิ้น</span>
        {rejected > 0 && (
          <div className="text-xs text-destructive">
            ไม่ผ่าน {rejected} ชิ้น{defectLabel(rows[rows.length - 1]) ? ` · ${defectLabel(rows[rows.length - 1])}` : ''}
          </div>
        )}
      </>
    );
  }
  const u = units[screen.idx];
  const state = unitState(u);
  if (state === 'reject') {
    return (
      <>
        <span className="font-semibold text-destructive">ไม่ผ่าน</span>
        <div className="text-xs text-destructive">{defectLabel(u)}</div>
      </>
    );
  }
  if (state === 'done') {
    return (
      <>
        <span className="font-semibold text-success">ผ่าน</span>
        {isUsedUnit(u) && (
          <div className="text-xs text-muted-foreground">
            แบต {u.batteryHealth}% · {u.hasBox ? 'มีกล่อง' : 'ไม่มีกล่อง'}
          </div>
        )}
      </>
    );
  }
  return <span className="text-muted-foreground">ยังไม่ครบ</span>;
}

/**
 * สรุปก่อนยืนยัน — the same columns as the ordering table plus IMEI · ซีเรียล · ราคาเงินสด ·
 * ราคาผ่อน · ผลตรวจ, one row per device (an accessory line stays one counted row). Tap a row to
 * jump back to that screen. Owner picked this flat table over a grouped one (2026-09-07).
 */
export function ReceivingSummary({ units, screens, mode, notes, setNotes, onEditScreen, onBack, onConfirm, confirming, confirmLabel }: ReceivingSummaryProps) {
  const t = tally(units);
  return (
    <div className="flex flex-col" data-testid="receiving-summary">
      <div className="mx-4 mt-4 rounded-[14px] border border-border/50 bg-card p-4 shadow-sm sm:mx-6 sm:p-5">
        <div className="mb-3.5 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold leading-snug">ตรวจครบแล้ว {units.length} ชิ้น</h3>
            <div className="text-[13px] text-muted-foreground">แตะแถวเพื่อกลับไปแก้เครื่องนั้น</div>
          </div>
          <div className="flex gap-2">
            <span className="inline-flex h-[22px] items-center rounded-full bg-success/10 px-2 text-xs font-medium whitespace-nowrap text-success">ผ่าน {t.passed}</span>
            <span className="inline-flex h-[22px] items-center rounded-full bg-destructive/10 px-2 text-xs font-medium whitespace-nowrap text-destructive">ไม่ผ่าน {t.rejected}</span>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1000px] table-fixed border-collapse">
            <thead className="bg-muted/50">
              <tr>
                <th className={cn(thCls, 'w-[46px]')}>#</th>
                <th className={thCls}>รุ่น</th>
                <th className={cn(thCls, 'w-[68px]')}>สภาพ</th>
                <th className={cn(thCls, 'w-[74px]')}>ความจุ</th>
                <th className={cn(thCls, 'w-[96px]')}>สี</th>
                <th className={cn(thCls, 'w-[150px]')}>IMEI</th>
                <th className={cn(thCls, 'w-[104px]')}>ซีเรียล</th>
                <th className={cn(thCls, 'w-[92px] text-right')}>ราคาเงินสด</th>
                <th className={cn(thCls, 'w-[88px] text-right')}>ราคาผ่อน</th>
                <th className={cn(thCls, 'w-[150px] text-right')}>ผลตรวจ</th>
              </tr>
            </thead>
            <tbody>
              {screens.map((screen, sIdx) => {
                const first = units[screen.kind === 'unit' ? screen.idx : screen.indices[0]];
                const accessory = isAccessoryUnit(first);
                const { title } = unitTitle(first);
                const n =
                  screen.kind === 'unit'
                    ? String(screen.idx + 1)
                    : screen.indices.length === 1
                      ? String(screen.indices[0] + 1)
                      : `${screen.indices[0] + 1}–${screen.indices[screen.indices.length - 1] + 1}`;
                return (
                  <tr
                    key={sIdx}
                    role="button"
                    tabIndex={0}
                    aria-label={`แก้ไข ${title}`}
                    onClick={() => onEditScreen(sIdx)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onEditScreen(sIdx);
                      }
                    }}
                    className="cursor-pointer border-t border-border/50 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-hidden"
                  >
                    <td className={cn(tdCls, 'text-xs text-muted-foreground')}>{n}</td>
                    <td className={tdCls}>
                      <div className="truncate font-semibold">{title}</div>
                      <div className={cn('text-xs', accessory ? 'text-primary' : 'text-muted-foreground')}>{accessory ? 'อุปกรณ์เสริม' : first.brand || ''}</div>
                    </td>
                    {accessory ? (
                      <td className={tdCls} colSpan={3}>
                        {first.model ? (
                          <>
                            <span className="text-xs text-muted-foreground">สำหรับรุ่น</span> {first.model}
                          </>
                        ) : (
                          dash
                        )}
                      </td>
                    ) : (
                      <>
                        <td className={tdCls}>{conditionLabel(first)}</td>
                        <td className={tdCls}>{first.storage || '-'}</td>
                        <td className={tdCls}>{first.color || '-'}</td>
                      </>
                    )}
                    <td className={cn(tdCls, 'font-mono text-[13px] tracking-wide')}>{accessory ? none : first.imeiSerial || dash}</td>
                    <td className={cn(tdCls, 'font-mono text-[13px] tracking-wide')}>{accessory ? none : first.serialNumber || dash}</td>
                    <td className={cn(tdCls, 'text-right')}>{first.status === 'REJECT' && !accessory ? dash : money(first.sellingPrice)}</td>
                    <td className={cn(tdCls, 'text-right')}>{accessory || first.status === 'REJECT' ? dash : money(first.installmentPrice)}</td>
                    <td className={cn(tdCls, 'text-right')}>
                      <Result units={units} screen={screen} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_300px]">
          {setNotes ? (
            <div>
              <label htmlFor="receiving-notes" className="mb-1.5 block text-[13px] text-muted-foreground">
                หมายเหตุใบรับ
              </label>
              <textarea
                id="receiving-notes"
                value={notes ?? ''}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="เช่น กล่องบุบ 1 กล่อง แจ้งผู้ขายแล้ว"
                className={cn(fieldCls, 'min-h-14 py-2.5')}
              />
            </div>
          ) : (
            <div />
          )}
          <div className="flex flex-col gap-1.5 rounded-[10px] bg-muted/60 px-3.5 py-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">เข้าคลัง (รอถ่ายรูป/QC)</span>
              <span className="font-semibold">{t.passed} ชิ้น</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">ไม่ผ่าน · แจ้งผู้ขาย</span>
              <span className="font-semibold text-destructive">{t.rejected} ชิ้น</span>
            </div>
            {mode === 'po' && (
              <div className="flex justify-between gap-3 border-t border-border pt-1.5">
                <span className="text-muted-foreground">ค้างรับใน PO นี้</span>
                <span className="font-semibold">{t.rejected > 0 ? `${t.rejected} ชิ้น (เครื่องที่ไม่ผ่าน)` : 'ไม่มี'}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 pt-5 pb-[22px] sm:px-6">
        <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 px-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> กลับไปแก้
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirming}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <Truck className="size-[18px]" />
          {confirming ? 'กำลังรับสินค้า…' : (confirmLabel ?? `ยืนยันรับสินค้า ${units.length} ชิ้น`)}
        </button>
      </div>
    </div>
  );
}
