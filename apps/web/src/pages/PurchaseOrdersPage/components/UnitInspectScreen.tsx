import { useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, ListChecks, ScanLine, Smartphone, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import UsedDeviceDetailsFields from '@/components/product/UsedDeviceDetailsFields';
import { formatNumber } from '@/utils/formatters';
import type { DefectReasonValue, ReceivingUnitForm } from '../types';
import { checklistCategories, defectReasonOptions } from '../constants';
import { conditionLabel, isUsedUnit, unitTitle } from '../receiving-flow.util';
import { PHOTO_ANGLES, PHOTO_ANGLE_LABELS, anglesShot, type PhotoAngle } from '@/constants/photo-angles';

export interface UnitInspectScreenProps {
  unit: ReceivingUnitForm;
  idx: number;
  /** 1-based piece number shown as "เครื่องที่ n จาก total" */
  ordinal: number;
  total: number;
  isDuplicate: boolean;
  /** "ราคาสั่งซื้อ" on a PO receive, "ราคาทุน" on a direct receive */
  costLabel: string;
  onChange: (idx: number, patch: Partial<ReceivingUnitForm>) => void;
  onChecklist: (idx: number, checkIdx: number, field: 'passed' | 'note', value: boolean | string) => void;
  onAddPhotos: (idx: number, files: FileList) => void;
  onRemovePhoto: (idx: number, photoIdx: number) => void;
  /** รูปสินค้า 6 มุม (มือสอง) — หนึ่งช่องหนึ่งรูป */
  onAnglePhoto: (idx: number, angle: PhotoAngle, file: File) => void;
  onRemoveAnglePhoto: (idx: number, angle: PhotoAngle) => void;
  /**
   * Enter on the serial field = "ผ่าน" + next device (two scans, no tap). Receives the unit as it
   * will be after this keystroke, because the parent's state has not re-rendered yet.
   */
  onAdvance: (next: ReceivingUnitForm) => void;
}

// Shared field chrome — 44px tall, tokens only; labels keep a fixed height so a pair of Thai labels
// side by side (upper vowels raise the line box) never pushes one field below the other.
export const fieldCls =
  'w-full min-h-11 px-3 border border-input rounded-lg bg-card text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';
export const labelCls = 'block h-[18px] leading-[18px] whitespace-nowrap text-[13px] text-muted-foreground mb-2';
export const Req = () => <span className="text-destructive"> *</span>;
const segBtn = 'min-h-11 px-4 rounded-md text-sm font-medium transition-colors';

export function SpecStrip({ unit, costLabel }: { unit: ReceivingUnitForm; costLabel: string }) {
  const cells: [string, string][] = [
    ['สภาพ', conditionLabel(unit)],
    ['ความจุ', unit.storage || '-'],
    ['สี', unit.color || '-'],
    [costLabel, unit.costPrice && Number(unit.costPrice) > 0 ? `${formatNumber(unit.costPrice)} บาท` : '-'],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 rounded-[10px] bg-muted/60 px-3.5 py-3 sm:grid-cols-4">
      {cells.map(([k, v]) => (
        <div key={k}>
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{k}</div>
          <div className="mt-0.5 text-sm font-medium">{v}</div>
        </div>
      ))}
    </div>
  );
}

function PhotoStrip({
  unit,
  idx,
  label,
  onAddPhotos,
  onRemovePhoto,
}: Pick<UnitInspectScreenProps, 'unit' | 'idx' | 'onAddPhotos' | 'onRemovePhoto'> & { label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {unit.photos.map((p, pIdx) => (
        <div key={pIdx} className="relative size-14 overflow-hidden rounded-lg border border-border">
          <img src={p} alt={`รูป ${pIdx + 1}`} className="size-full object-cover" />
          <button
            type="button"
            onClick={() => onRemovePhoto(idx, pIdx)}
            aria-label={`ลบรูป ${pIdx + 1}`}
            className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-[10px] border border-border bg-card px-3 text-[13px] font-medium hover:bg-muted/60">
        <Camera className="size-3.5" />
        {unit.photos.length ? `${label} ${unit.photos.length}` : label}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          aria-label={label}
          onChange={(e) => {
            if (e.target.files?.length) onAddPhotos(idx, e.target.files);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

/**
 * รูปสินค้า 6 มุม (owner 2026-09-07 "ตอนรับเครื่องหน้า PO ด้วย ให้มี 6 มุม"): the same six fixed
 * slots the photo queue and the product page use. Complete + priced = the unit goes on sale the
 * moment the receive is confirmed; anything less and it waits in the "รอถ่ายรูป" queue with the
 * angles already shot kept. Never blocks the next button.
 */
function AnglePhotoGrid({
  unit,
  idx,
  onAnglePhoto,
  onRemoveAnglePhoto,
}: Pick<UnitInspectScreenProps, 'unit' | 'idx' | 'onAnglePhoto' | 'onRemoveAnglePhoto'>) {
  const shot = anglesShot(unit.anglePhotos);
  return (
    <div className="flex flex-col gap-3.5 rounded-xl border border-info/30 bg-info/5 p-4" data-testid="angle-panel">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-info">รูปสินค้า 6 มุม — ใช้ขึ้นขายหน้าร้านออนไลน์</span>
        <span className="text-[13px] whitespace-nowrap text-muted-foreground">
          ถ่ายแล้ว <span className="font-semibold text-foreground">{shot}/6</span> มุม
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
        {PHOTO_ANGLES.map((angle) => {
          const src = unit.anglePhotos[angle];
          const label = PHOTO_ANGLE_LABELS[angle];
          return (
            <div key={angle} className="flex min-w-0 flex-col items-center gap-1.5">
              {src ? (
                <div className="relative h-[84px] w-full overflow-hidden rounded-[10px] border border-border">
                  <img src={src} alt={`รูปด้าน${label}`} className="size-full object-cover" />
                  <span className="absolute top-1.5 left-1.5 grid size-[18px] place-items-center rounded-full bg-success text-success-foreground">
                    <Check className="size-3" />
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveAnglePhoto(idx, angle)}
                    aria-label={`ลบรูปด้าน${label}`}
                    className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ) : (
                <label className="grid h-[84px] w-full cursor-pointer place-items-center rounded-[10px] border-2 border-dashed border-info/50 bg-card text-info hover:bg-info/10">
                  <Camera className="size-6" />
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    aria-label={`ถ่ายรูปด้าน${label}`}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onAnglePhoto(idx, angle, file);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
              <div className={cn('text-xs font-medium whitespace-nowrap', src ? 'text-foreground' : 'text-info')}>
                {label}
                {src ? '' : ' · แตะถ่าย'}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-xs leading-snug text-muted-foreground">
        ครบ 6 มุม + มีราคา = เข้าคลังพร้อมขายทันที · ถ่ายไม่ครบไปต่อได้ เครื่องนี้จะไปอยู่ในคิว "รอถ่ายรูป" แทน
      </div>
    </div>
  );
}

/**
 * One device per screen (owner-approved mockup 2026-09-07): the ordering facts on top, IMEI and
 * serial side by side, an explicit ผ่าน | ไม่ผ่าน pair, then only the panel that result needs —
 * the red reject box, the yellow used-phone box, both selling prices — the six-angle grid on a
 * used phone, and a free camera only where evidence is worth keeping (damage, blemishes).
 */
export function UnitInspectScreen({
  unit,
  idx,
  ordinal,
  total,
  isDuplicate,
  costLabel,
  onChange,
  onChecklist,
  onAddPhotos,
  onRemovePhoto,
  onAnglePhoto,
  onRemoveAnglePhoto,
  onAdvance,
}: UnitInspectScreenProps) {
  const serialRef = useRef<HTMLInputElement>(null);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const used = isUsedUnit(unit);
  const { title, subtitle } = unitTitle(unit);
  const set = (patch: Partial<ReceivingUnitForm>) => onChange(idx, patch);

  const onSerialEnter = () => {
    const next: ReceivingUnitForm = unit.status === '' ? { ...unit, status: 'PASS' } : unit;
    if (next !== unit) set({ status: 'PASS' });
    onAdvance(next);
  };

  const checklistPassed = unit.checklist.filter((c) => c.passed).length;

  return (
    <div className="flex flex-col gap-[18px]" data-testid="unit-screen">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            เครื่องที่ {ordinal} จาก {total}
            {used ? ' · มือสอง' : ''}
          </div>
          <h3 className="mt-1 text-xl font-semibold leading-snug">{title}</h3>
          {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
        </div>
        <div
          className={cn(
            'grid size-[52px] shrink-0 place-items-center rounded-[14px]',
            used ? 'bg-warning/10 text-warning' : 'bg-info/10 text-info',
          )}
        >
          <Smartphone className="size-6" />
        </div>
      </div>

      <SpecStrip unit={unit} costLabel={costLabel} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`imei-${idx}`} className={labelCls}>
            IMEI
            <Req />
          </label>
          <div className="relative">
            <ScanLine className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground" />
            <input
              id={`imei-${idx}`}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={unit.imeiSerial}
              onChange={(e) => set({ imeiSerial: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  serialRef.current?.focus();
                }
              }}
              placeholder="สแกนหรือพิมพ์"
              className={cn(fieldCls, 'min-h-[52px] pl-11 font-mono text-lg tracking-wide', isDuplicate && 'border-warning')}
            />
          </div>
          {isDuplicate && (
            <p className="mt-1.5 flex items-center gap-1 text-xs leading-snug text-warning">
              <AlertTriangle className="size-3.5 shrink-0" /> IMEI ซ้ำกับเครื่องอื่นในรายการนี้
            </p>
          )}
        </div>
        <div>
          <label htmlFor={`serial-${idx}`} className={labelCls}>
            หมายเลขซีเรียล
            <Req />
          </label>
          <input
            ref={serialRef}
            id={`serial-${idx}`}
            type="text"
            autoComplete="off"
            value={unit.serialNumber}
            onChange={(e) => set({ serialNumber: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSerialEnter();
              }
            }}
            placeholder="พิมพ์หรือสแกน"
            className={cn(fieldCls, 'min-h-[52px] font-mono text-lg tracking-wide')}
          />
        </div>
      </div>

      <div>
        <div className={labelCls}>
          ผลตรวจ
          <Req />
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            aria-pressed={unit.status === 'PASS'}
            onClick={() => set({ status: 'PASS' })}
            className={cn(
              'inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-[10px] border text-base font-semibold transition-colors',
              unit.status === 'PASS'
                ? 'border-success bg-success text-success-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-success/60 hover:text-success',
            )}
          >
            <Check className="size-[18px]" /> ผ่าน
          </button>
          <button
            type="button"
            aria-pressed={unit.status === 'REJECT'}
            onClick={() => set({ status: 'REJECT' })}
            className={cn(
              'inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-[10px] border text-base font-semibold transition-colors',
              unit.status === 'REJECT'
                ? 'border-destructive bg-destructive text-destructive-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-destructive/60 hover:text-destructive',
            )}
          >
            <X className="size-[18px]" /> ไม่ผ่าน
          </button>
        </div>
      </div>

      {unit.status === 'REJECT' && (
        <div className="flex flex-col gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4" data-testid="reject-panel">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-destructive">
            <AlertTriangle className="size-[18px]" /> เครื่องนี้ไม่ผ่าน
          </div>
          <div>
            <label htmlFor={`defect-${idx}`} className={labelCls}>
              สาเหตุ
              <Req />
            </label>
            <select
              id={`defect-${idx}`}
              value={unit.defectReason}
              onChange={(e) => set({ defectReason: e.target.value as DefectReasonValue | '' })}
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
            <label htmlFor={`reject-detail-${idx}`} className={labelCls}>
              รายละเอียด (ถ้ามี)
            </label>
            <input
              id={`reject-detail-${idx}`}
              type="text"
              value={unit.rejectReason}
              onChange={(e) => set({ rejectReason: e.target.value })}
              placeholder="เช่น มุมขวาบนแตกร้าว แจ้งผู้ขายแล้ว"
              className={fieldCls}
            />
          </div>
          <PhotoStrip unit={unit} idx={idx} label="ถ่ายรูปความเสียหาย" onAddPhotos={onAddPhotos} onRemovePhoto={onRemovePhoto} />
        </div>
      )}

      {unit.status === 'PASS' && used && (
        <div className="flex flex-col gap-3.5 rounded-xl border border-warning/25 bg-warning/5 p-4" data-testid="used-panel">
          <div className="text-[13px] font-semibold text-warning">ข้อมูลมือสอง — ต้องกรอกก่อนผ่าน</div>
          <UsedDeviceDetailsFields value={unit} onChange={set} idPrefix={String(idx)} showRequired />
          <div className="flex items-center justify-between gap-3 border-t border-warning/25 pt-3">
            <span className="text-sm">
              เช็คลิสต์ตรวจเครื่อง
              <span className="text-muted-foreground">
                {' '}
                · ผ่าน <span className="font-semibold text-foreground">{checklistPassed}/{unit.checklist.length}</span> รายการ
              </span>
            </span>
            <button
              type="button"
              aria-expanded={checklistOpen}
              onClick={() => setChecklistOpen((o) => !o)}
              className="inline-flex min-h-9 items-center gap-2 rounded-[10px] border border-border bg-card px-3 text-[13px] font-medium hover:bg-muted/60"
            >
              <ListChecks className="size-3.5" /> {checklistOpen ? 'ปิดเช็คลิสต์' : 'เปิดเช็คลิสต์'}
            </button>
          </div>
          {checklistOpen && (
            <div className="space-y-3" data-testid="checklist">
              {checklistCategories.map((cat) => (
                <div key={cat}>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">{cat}</div>
                  <div className="space-y-1">
                    {unit.checklist.map((c, checkIdx) =>
                      c.category !== cat ? null : (
                        <div key={checkIdx} className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-pressed={c.passed}
                            aria-label={c.item}
                            onClick={() => onChecklist(idx, checkIdx, 'passed', !c.passed)}
                            className={cn(
                              'flex size-7 items-center justify-center rounded text-xs font-bold transition-colors',
                              c.passed ? 'bg-success text-success-foreground' : 'bg-destructive text-destructive-foreground',
                            )}
                          >
                            {c.passed ? '✓' : '✗'}
                          </button>
                          <span className={cn('flex-1 text-sm leading-snug', c.passed ? 'text-foreground' : 'font-medium text-destructive')}>{c.item}</span>
                          {!c.passed && (
                            <input
                              type="text"
                              placeholder="หมายเหตุ"
                              value={c.note}
                              onChange={(e) => onChecklist(idx, checkIdx, 'note', e.target.value)}
                              className="w-32 rounded border border-destructive/30 px-2 py-1.5 text-xs outline-hidden focus-visible:ring-1 focus-visible:ring-ring/30"
                            />
                          )}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {unit.status === 'PASS' && (
        <div className="flex flex-col gap-2.5 rounded-[10px] border border-primary/25 bg-primary/5 p-3.5" data-testid="price-panel">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`cash-${idx}`} className={labelCls}>
                ราคาเงินสด (บาท)
                <Req />
              </label>
              <input
                id={`cash-${idx}`}
                type="number"
                inputMode="decimal"
                min={0}
                value={unit.sellingPrice}
                onChange={(e) => set({ sellingPrice: e.target.value })}
                placeholder="เช่น 45900"
                className={cn(fieldCls, 'text-right font-mono tabular-nums')}
              />
            </div>
            <div>
              <label htmlFor={`installment-${idx}`} className={labelCls}>
                ราคาผ่อน (บาท)
                <Req />
              </label>
              <input
                id={`installment-${idx}`}
                type="number"
                inputMode="decimal"
                min={0}
                value={unit.installmentPrice}
                onChange={(e) => set({ installmentPrice: e.target.value })}
                placeholder="เช่น 49900"
                className={cn(fieldCls, 'text-right font-mono tabular-nums')}
              />
            </div>
          </div>
          <div className="text-xs leading-snug text-muted-foreground">
            ค่าตั้งต้นมาจากตารางราคากลางหรือเครื่องก่อนหน้าของรุ่นนี้ · แก้ได้ถ้าเครื่องนี้ขายคนละราคา
          </div>
        </div>
      )}

      {unit.status === 'PASS' && used && (
        <>
          <AnglePhotoGrid unit={unit} idx={idx} onAnglePhoto={onAnglePhoto} onRemoveAnglePhoto={onRemoveAnglePhoto} />
          <PhotoStrip unit={unit} idx={idx} label="รูปตำหนิ/ความเสียหาย" onAddPhotos={onAddPhotos} onRemovePhoto={onRemovePhoto} />
        </>
      )}
    </div>
  );
}
