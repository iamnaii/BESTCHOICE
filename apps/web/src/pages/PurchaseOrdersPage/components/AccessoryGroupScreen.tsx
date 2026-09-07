import { AlertTriangle, Minus, Package, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DefectReasonValue, ReceivingUnitForm } from '../types';
import { defectReasonOptions } from '../constants';
import { unitTitle } from '../receiving-flow.util';
import { fieldCls, labelCls, Req } from './UnitInspectScreen';

export interface AccessoryGroupScreenProps {
  units: ReceivingUnitForm[];
  indices: number[];
  /** "5–6" — the piece numbers this line covers */
  ordinalRange: string;
  total: number;
  costLabel: string;
  onSetReceived: (received: number) => void;
  /** one value for every piece of the line (price, reject reason) */
  onGroupChange: (patch: Partial<ReceivingUnitForm>) => void;
}

/** Accessories have no IMEI — one screen per PO line counts what arrived in good shape. */
export function AccessoryGroupScreen({ units, indices, ordinalRange, total, costLabel, onSetReceived, onGroupChange }: AccessoryGroupScreenProps) {
  const first = units[indices[0]];
  const { title, subtitle } = unitTitle(first);
  const received = indices.filter((i) => units[i].status === 'PASS').length;
  const rejected = indices.length - received;
  const cost = first.costPrice && Number(first.costPrice) > 0 ? Number(first.costPrice).toLocaleString('th-TH') : '-';

  return (
    <div className="flex flex-col gap-[18px]" data-testid="group-screen">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            ชิ้นที่ {ordinalRange} จาก {total}
          </div>
          <h3 className="mt-1 text-xl font-semibold leading-snug">{title}</h3>
          <div className="text-sm text-muted-foreground">{subtitle}</div>
        </div>
        <div className="grid size-[52px] shrink-0 place-items-center rounded-[14px] bg-primary/10 text-primary">
          <Package className="size-6" />
        </div>
      </div>

      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <span className="inline-flex h-[22px] items-center rounded-full bg-primary/10 px-2 text-xs font-medium whitespace-nowrap text-primary">อุปกรณ์เสริม</span>
        ไม่มี IMEI/ซีเรียล — นับจำนวนที่รับได้ · {costLabel} {cost} บาท/ชิ้น
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/60 p-4">
        <div>
          <div className="text-[13px] text-muted-foreground">รับได้ (สภาพดี)</div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tabular-nums" data-testid="received-count">
              {received}
            </span>
            <span className="text-sm text-muted-foreground">/ {indices.length} ชิ้น</span>
          </div>
        </div>
        <div className="inline-flex h-12 items-stretch overflow-hidden rounded-[10px] border border-border bg-card">
          <button
            type="button"
            aria-label="ลดจำนวนที่รับได้"
            disabled={received <= 0}
            onClick={() => onSetReceived(received - 1)}
            className="grid w-12 place-items-center text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <Minus className="size-[18px]" />
          </button>
          <div className="grid w-14 place-items-center border-x border-border text-lg font-semibold tabular-nums">{received}</div>
          <button
            type="button"
            aria-label="เพิ่มจำนวนที่รับได้"
            disabled={received >= indices.length}
            onClick={() => onSetReceived(received + 1)}
            className="grid w-12 place-items-center text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <Plus className="size-[18px]" />
          </button>
        </div>
      </div>
      <div className="text-[13px] text-muted-foreground">ลดจำนวน = ชิ้นที่เหลือถือว่าไม่ผ่าน (ถามสาเหตุด้านล่าง)</div>

      {rejected > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4" data-testid="group-reject-panel">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-destructive">
            <AlertTriangle className="size-[18px]" /> ไม่ผ่าน {rejected} ชิ้น
          </div>
          <div>
            <label htmlFor="group-defect" className={labelCls}>
              สาเหตุ
              <Req />
            </label>
            <select
              id="group-defect"
              value={units[indices[indices.length - 1]].defectReason}
              onChange={(e) => onGroupChange({ defectReason: e.target.value as DefectReasonValue | '' })}
              className={fieldCls}
            >
              <option value="">เลือกสาเหตุ…</option>
              {defectReasonOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="group-reject-detail" className={labelCls}>
              รายละเอียด (ถ้ามี)
            </label>
            <input
              id="group-reject-detail"
              type="text"
              value={units[indices[indices.length - 1]].rejectReason}
              onChange={(e) => onGroupChange({ rejectReason: e.target.value })}
              placeholder="เช่น ซองฉีก 1 ชิ้น แจ้งผู้ขายแล้ว"
              className={fieldCls}
            />
          </div>
        </div>
      )}

      {received > 0 && (
        <div className="flex flex-col gap-2.5 rounded-[10px] border border-primary/25 bg-primary/5 p-3.5" data-testid="price-panel">
          <div className="sm:w-[calc(50%-6px)]">
            <label htmlFor="group-cash" className={labelCls}>
              ราคาเงินสด (บาท)
              <Req />
            </label>
            <input
              id="group-cash"
              type="number"
              inputMode="decimal"
              min={0}
              value={first.sellingPrice}
              onChange={(e) => onGroupChange({ sellingPrice: e.target.value })}
              placeholder="เช่น 590"
              className={cn(fieldCls, 'text-right font-mono tabular-nums')}
            />
          </div>
          <div className="text-xs leading-snug text-muted-foreground">อุปกรณ์เสริมมีแค่ราคาเงินสด · ใช้กับทุกชิ้นในกลุ่มนี้</div>
        </div>
      )}
    </div>
  );
}
