import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, ListChecks, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReceivingUnitForm } from '../types';
import {
  buildScreens,
  isAccessoryUnit,
  receivingBlockers,
  screenHint,
  screenState,
  setGroupField,
  setGroupReceived,
  tally,
  unitState,
  unitTitle,
  withPriceDefaults,
  type ReceivingScreen,
} from '../receiving-flow.util';
import { useReceivingDuplicates } from './useReceivingDuplicates';
import { UnitInspectScreen } from './UnitInspectScreen';
import { AccessoryGroupScreen } from './AccessoryGroupScreen';
import { ReceivingSummary } from './ReceivingSummary';

const MAX_PHOTOS_PER_UNIT = 6;

export interface ReceivingFlowProps {
  units: ReceivingUnitForm[];
  setUnits: React.Dispatch<React.SetStateAction<ReceivingUnitForm[]>>;
  /** PO receive: "ราคาสั่งซื้อ" + the summary's ค้างรับ line; direct receive: "ราคาทุน" */
  mode: 'po' | 'direct';
  /** GR-level note — PO receive only */
  notes?: string;
  setNotes?: (value: string) => void;
  /**
   * The summary's confirm button. Omitted = no summary view and no footer: the ซื้อสินค้า wizard
   * hosts the screens inside its own step and carries its own ถัดไป / ย้อนกลับ.
   */
  onConfirm?: () => void;
  confirming?: boolean;
  confirmLabel?: string;
  onCancel?: () => void;
  /** the summary table is wider than a device screen — the host can widen its frame */
  onViewChange?: (view: 'screens' | 'summary') => void;
}

const firstOpenScreen = (units: ReceivingUnitForm[], screens: ReceivingScreen[]) => {
  const i = screens.findIndex((s) => screenState(units, s) === 'todo');
  return i < 0 ? 0 : i;
};

/**
 * รับสินค้าทีละเครื่อง — the chip strip on top jumps to any piece, one device (or one accessory
 * line) fills the card, the next button below it only opens once that screen is complete, and the
 * summary table comes last. Used by GoodsReceivingModal (PO receive) and by the ซื้อสินค้า
 * wizard's ตรวจรับ step (direct receive).
 */
export function ReceivingFlow({ units, setUnits, mode, notes, setNotes, onConfirm, confirming, confirmLabel, onCancel, onViewChange }: ReceivingFlowProps) {
  const screens = useMemo(() => buildScreens(units), [units]);
  const [screenIdx, setScreenIdx] = useState(() => firstOpenScreen(units, screens));
  const [view, setViewState] = useState<'screens' | 'summary'>('screens');
  const setView = (v: 'screens' | 'summary') => {
    setViewState(v);
    onViewChange?.(v);
  };
  const dupIndices = useReceivingDuplicates(units);
  const current = Math.min(screenIdx, Math.max(0, screens.length - 1));
  const screen = screens[current];
  const costLabel = mode === 'po' ? 'ราคาสั่งซื้อ' : 'ราคาทุน';

  // a device whose prices are blank inherits the prices keyed in on an earlier device of its line
  useEffect(() => {
    if (screen?.kind === 'unit') setUnits((prev) => withPriceDefaults(prev, screen.idx));
  }, [current, screen?.kind]);

  const goTo = (i: number) => {
    setScreenIdx(i);
    setView('screens');
  };
  const patch = (idx: number, p: Partial<ReceivingUnitForm>) =>
    setUnits((prev) => prev.map((u, i) => (i === idx ? { ...u, ...p } : u)));
  const onChecklist = (unitIdx: number, checkIdx: number, field: 'passed' | 'note', value: boolean | string) =>
    setUnits((prev) =>
      prev.map((u, i) =>
        i !== unitIdx ? u : { ...u, checklist: u.checklist.map((c, ci) => (ci === checkIdx ? { ...c, [field]: value } : c)) },
      ),
    );
  const onAddPhotos = (idx: number, files: FileList) =>
    Array.from(files)
      .slice(0, MAX_PHOTOS_PER_UNIT)
      .forEach((file) => {
        const reader = new FileReader();
        reader.onload = () =>
          setUnits((prev) =>
            prev.map((u, i) =>
              i === idx && u.photos.length < MAX_PHOTOS_PER_UNIT ? { ...u, photos: [...u.photos, reader.result as string] } : u,
            ),
          );
        reader.readAsDataURL(file);
      });
  const onRemovePhoto = (idx: number, photoIdx: number) =>
    setUnits((prev) => prev.map((u, i) => (i === idx ? { ...u, photos: u.photos.filter((_, p) => p !== photoIdx) } : u)));

  const hint = screen ? screenHint(units, screen) : null;
  const isLast = current >= screens.length - 1;
  const ready = receivingBlockers(units).length === 0;
  const t = tally(units);
  const phones = units.filter((u) => !isAccessoryUnit(u));
  const scanned = phones.filter((u) => unitState(u) !== 'todo').length;

  // `latest` lets a keystroke that just changed a unit advance before React re-renders
  const advanceFrom = (latest: ReceivingUnitForm[]) => {
    if (!screen || screenHint(latest, screen)) return;
    if (!isLast) goTo(current + 1);
    else if (onConfirm) setView('summary');
  };
  const advance = () => advanceFrom(units);

  if (units.length === 0) {
    return <div className="py-10 text-center text-sm text-muted-foreground">ไม่มีรายการที่รอรับสินค้า</div>;
  }

  if (view === 'summary' && onConfirm) {
    return (
      <ReceivingSummary
        units={units}
        screens={screens}
        mode={mode}
        notes={notes}
        setNotes={setNotes}
        onEditScreen={goTo}
        onBack={() => setView('screens')}
        onConfirm={onConfirm}
        confirming={confirming}
        confirmLabel={confirmLabel}
      />
    );
  }

  // ---- next button copy ----
  let nextLabel: string | null;
  if (!screen) nextLabel = null;
  else if (screen.kind === 'group') {
    const received = screen.indices.filter((i) => units[i].status === 'PASS').length;
    const { title } = unitTitle(units[screen.indices[0]]);
    nextLabel = isLast && !onConfirm ? null : `รับ${title} ${received} ชิ้น · ${isLast ? 'ไปสรุป' : 'ไปเครื่องถัดไป'}`;
  } else {
    const rejected = units[screen.idx].status === 'REJECT';
    if (isLast) nextLabel = onConfirm ? (rejected ? 'บันทึกแล้วดูสรุป' : 'ดูสรุปก่อนยืนยัน') : null;
    else nextLabel = rejected ? 'บันทึกแล้วไปเครื่องถัดไป' : 'ไปเครื่องถัดไป';
  }
  const lastHint = isLast && !onConfirm && !hint ? 'ครบทุกชิ้นแล้ว — กด "ถัดไป: สรุป + จ่ายเงิน" ด้านล่าง' : hint;

  return (
    <div className="flex flex-col" data-testid="receiving-flow">
      {/* chip strip: one per phone, one per accessory line */}
      <div className="flex items-center justify-between gap-4 px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="รายการที่รับ">
          {screens.map((s, i) => {
            const state = screenState(units, s);
            const isCurrent = i === current;
            const label = s.kind === 'unit' ? String(s.idx + 1) : `${unitTitle(units[s.indices[0]]).title} ×${s.indices.length}`;
            const name = s.kind === 'unit' ? `ชิ้นที่ ${s.idx + 1}` : `${unitTitle(units[s.indices[0]]).title} ${s.indices.length} ชิ้น`;
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={isCurrent}
                aria-label={name}
                onClick={() => goTo(i)}
                className={cn(
                  'grid h-9 min-w-9 place-items-center rounded-lg px-0 text-[13px] font-semibold transition-colors',
                  s.kind === 'group' && 'px-2.5',
                  isCurrent
                    ? 'border-2 border-primary bg-card text-primary ring-[3px] ring-ring/30'
                    : state === 'done'
                      ? 'bg-success text-success-foreground'
                      : state === 'reject'
                        ? 'bg-destructive text-destructive-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70',
                )}
              >
                {!isCurrent && s.kind === 'unit' && state === 'done' ? (
                  <Check className="size-[18px]" />
                ) : !isCurrent && s.kind === 'unit' && state === 'reject' ? (
                  <X className="size-[18px]" />
                ) : (
                  label
                )}
              </button>
            );
          })}
        </div>
        {phones.length > 0 && (
          <span className="text-[13px] whitespace-nowrap text-muted-foreground">
            สแกนแล้ว {scanned} / {phones.length} เครื่อง
          </span>
        )}
      </div>

      {/* one device per card — keyed so the IMEI field takes focus on every new device */}
      <div key={current} className="mx-4 mt-5 rounded-[14px] border border-border/50 bg-card p-4 shadow-sm sm:mx-6 sm:p-6">
        {screen?.kind === 'unit' && (
          <UnitInspectScreen
            unit={units[screen.idx]}
            idx={screen.idx}
            ordinal={screen.idx + 1}
            total={units.length}
            isDuplicate={dupIndices.has(screen.idx)}
            costLabel={costLabel}
            onChange={patch}
            onChecklist={onChecklist}
            onAddPhotos={onAddPhotos}
            onRemovePhoto={onRemovePhoto}
            onAdvance={(next) => advanceFrom(units.map((u, i) => (i === screen.idx ? next : u)))}
          />
        )}
        {screen?.kind === 'group' && (
          <AccessoryGroupScreen
            units={units}
            indices={screen.indices}
            ordinalRange={
              screen.indices.length === 1
                ? String(screen.indices[0] + 1)
                : `${screen.indices[0] + 1}–${screen.indices[screen.indices.length - 1] + 1}`
            }
            total={units.length}
            costLabel={costLabel}
            onSetReceived={(n) => setUnits((prev) => setGroupReceived(prev, screen.indices, n))}
            onGroupChange={(p) =>
              setUnits((prev) =>
                (Object.keys(p) as (keyof ReceivingUnitForm)[]).reduce((acc, k) => setGroupField(acc, screen.indices, k, p[k] as never), prev),
              )
            }
          />
        )}
      </div>

      {/* next — opens once the screen is complete; the hint says what is still missing */}
      <div className="flex flex-col gap-2 px-4 pt-5 sm:px-6">
        {nextLabel && (
          <button
            type="button"
            onClick={advance}
            disabled={!!hint}
            className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-primary px-5 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <ArrowRight className="size-[18px]" />
            {nextLabel}
          </button>
        )}
        {lastHint && (
          <div className="text-center text-xs leading-snug text-muted-foreground" data-testid="next-hint">
            {lastHint}
          </div>
        )}
      </div>

      {onConfirm && (
        <div className="flex items-center justify-between gap-3 px-4 pt-5 pb-[22px] sm:px-6">
          <button type="button" onClick={onCancel} className="min-h-10 px-2 text-sm text-muted-foreground hover:text-foreground">
            ยกเลิก
          </button>
          <div className="flex items-center gap-3">
            <span className="hidden text-[13px] text-muted-foreground sm:inline">
              ผ่าน {t.passed} · ไม่ผ่าน {t.rejected} · เหลือ {t.pending} ชิ้น
            </span>
            <button
              type="button"
              onClick={() => setView('summary')}
              disabled={!ready}
              className="inline-flex min-h-10 items-center gap-2 rounded-[10px] border border-border bg-card px-4 text-sm font-medium hover:bg-muted/60 disabled:opacity-50"
            >
              <ListChecks className="size-4" /> ดูสรุปทั้งหมด
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
