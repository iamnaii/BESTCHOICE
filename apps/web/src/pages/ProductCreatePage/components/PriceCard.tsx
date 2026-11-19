import { useId, type ReactNode } from 'react';
import { CheckCircle2, Info, PencilLine, TrendingDown, TrendingUp } from 'lucide-react';
import { formatBahtPlain, type ModelQuote } from '@installment/shared';
import { NumberInput } from '@/components/ui/NumberInput';
import { formControlClass } from '@/components/ui/form-styles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { editedKeys, type PriceFields, type PriceKey } from '../utils/priceCard';

/** สเปคข้อ 3.4 — ชุดเดียวกับ GfinPanel ของหน้าสินค้า ท่อนชี้ทางชี้มาที่ฟอร์มนี้ */
export const GFIN_ORIGIN_NOTE =
  'ยังไม่ระบุเครื่องไทย/เครื่องนอก — คิด OVER ครึ่งเดียวไว้ก่อน (ราคาส่งที่ GFIN รับแน่นอน) · ถ้าเป็นเครื่องไทย เลือกเครื่องไทยในฟอร์มนี้ ราคาส่งจะได้ OVER เต็ม';
const NO_GFIN = 'GFIN ไม่รับรุ่นนี้ — ขายได้แค่เงินสดและผ่อน BESTCHOICE';
const NOT_FOUND = 'ไม่พบรุ่นนี้ในตารางราคากลาง — กรอกราคาเอง';

export interface PriceCardProps {
  category: string;
  fields: PriceFields;
  onFieldChange: (key: PriceKey, value: string) => void;
  /** ราคากลางที่ใช้เติม — null = ยังไม่เลือกรุ่น / ไม่พบ */
  templatePrices: PriceFields | null;
  /** "iPhone 15 128GB มือ 1" — แสดงเมื่อมีราคากลาง */
  templateLabel: string;
  templateNotFound: boolean;
  /** ค้นราคากลางไม่สำเร็จ (เครือข่าย/เซิร์ฟเวอร์) — ไม่ใช่ "ไม่พบรุ่น" · ช่องราคาคงเดิม */
  templateFailed: boolean;
  onUseTemplate: () => void;
  /** โหลดราคากลาง / ตั้งค่าดอกเบี้ยที่ล้มใหม่ */
  onRetry: () => void;
  /** null = อุปกรณ์เสริม / ยังไม่เลือกยี่ห้อและรุ่น */
  quote: ModelQuote | null;
  /** รุ่นนี้ไม่มีในใบราคา GFIN (`gfinBlocked` จากตารางรุ่น ไม่ขึ้นกับช่องราคา) — ช่อง GFIN ปิดและบันทึกเป็นค่าว่าง */
  gfinBlocked: boolean;
  /** หมวดนี้ไม่มีตั้งค่าดอกเบี้ย (เช่น แท็บเล็ต) — เรท 1 คิดไม่ได้ */
  bcConfigMissing: boolean;
  /** โหลดตั้งค่าดอกเบี้ยไม่สำเร็จ — ไม่ใช่ "ยังไม่มีตั้งค่า" */
  bcConfigFailed: boolean;
  accessoryProfit: number | null;
  costEntered: boolean;
}

function ProfitBadge({ profit }: { profit: number | null }) {
  if (profit == null) return null;
  const loss = profit < 0;
  const Icon = loss ? TrendingDown : TrendingUp;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium leading-snug tabular-nums',
        loss ? 'bg-destructive/10 text-destructive dark:bg-destructive/15' : 'bg-success/10 text-success dark:bg-success/15',
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {loss ? `ขาดทุน ${formatBahtPlain(-profit)}` : `กำไร ${formatBahtPlain(profit)}`}
    </span>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-snug text-muted-foreground">{children}</p>;
}

/** "โหลดราคากลางไม่สำเร็จ — ลองใหม่" — ปุ่มลองใหม่อยู่ในประโยค */
function RetryNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <p className="text-xs leading-snug text-warning-strong">
      โหลดราคากลางไม่สำเร็จ —{' '}
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center font-medium text-primary underline underline-offset-2 max-lg:min-h-11 lg:min-h-8"
      >
        ลองใหม่
      </button>
    </p>
  );
}

function Plan({ down, monthly, months }: { down: number; monthly: number; months: number }) {
  return (
    <p className="leading-snug">
      ดาวน์ <b className="font-semibold">{formatBahtPlain(down)}</b> · ผ่อน{' '}
      <b className="font-semibold">{formatBahtPlain(monthly)}</b> × {months} งวด
    </p>
  );
}

function PriceRow({
  id,
  label,
  sub,
  ariaLabel,
  value,
  onChange,
  disabled = false,
  placeholder,
  edited,
  templateValue,
  profit,
  children,
}: {
  id: string;
  label: string;
  sub?: string;
  /** ชื่อช่อง — ขึ้นต้นด้วยคำบนป้าย (WCAG 2.5.3) */
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  edited: boolean;
  templateValue?: string;
  profit: number | null | undefined;
  children: ReactNode;
}) {
  const hintId = `${id}-template`;
  const showHint = edited && !!templateValue;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)] items-start gap-x-3 gap-y-2 border-b border-border/60 px-4 py-3 last:border-b-0 sm:grid-cols-[9.5rem_10rem_minmax(0,1fr)_auto] sm:items-center sm:px-5">
      <label htmlFor={id} className="pt-2.5 text-sm font-medium leading-snug text-foreground sm:pt-0">
        {label}
        {sub && <span className="block text-xs font-normal text-muted-foreground">{sub}</span>}
      </label>
      <div className="min-w-0">
        <NumberInput
          unstyled
          id={id}
          aria-label={ariaLabel}
          aria-describedby={showHint ? hintId : undefined}
          min={1}
          step="0.01"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            formControlClass,
            'text-right tabular-nums',
            edited && 'border-warning ring-1 ring-warning/30',
            disabled && 'cursor-not-allowed bg-muted text-muted-foreground',
          )}
        />
        {showHint && (
          <p id={hintId} className="mt-1 text-right text-xs leading-snug text-warning-strong">
            ราคากลาง {formatBahtPlain(Number(templateValue))}
          </p>
        )}
      </div>
      <div className="col-span-2 min-w-0 space-y-0.5 text-[13px] tabular-nums text-foreground sm:col-span-1">{children}</div>
      <div className="col-span-2 sm:col-span-1 sm:justify-self-end">
        <ProfitBadge profit={profit ?? null} />
      </div>
    </div>
  );
}

/**
 * การ์ด "ราคาขาย" แบบ D (สเปค 2026-11-19 ข้อ 5) — มือถือ/แท็บเล็ต 3 แถวตายตัว · อุปกรณ์เสริมแถวเดียว
 * ค่าที่คิดให้มาจาก `buildModelQuote` (ส่งมาเป็น `quote`) · กำไรแสดงเมื่อกรอกทุนในฟอร์มนี้
 */
export default function PriceCard({
  category,
  fields,
  onFieldChange,
  templatePrices,
  templateLabel,
  templateNotFound,
  templateFailed,
  onUseTemplate,
  onRetry,
  quote,
  gfinBlocked: blocked,
  bcConfigMissing,
  bcConfigFailed,
  accessoryProfit,
  costEntered,
}: PriceCardProps) {
  const baseId = useId();
  const accessory = category === 'ACCESSORY';
  // ช่อง GFIN ที่ปิดอยู่ไม่นับเป็น "แก้จากราคากลาง" (ค่าในช่องไม่ถูกบันทึก)
  const edited = editedKeys(fields, templatePrices).filter((k) => !(blocked && k === 'finance'));
  const isEdited = (k: PriceKey) => edited.includes(k);
  const rate1 = quote?.rate1 ?? null;
  const rate2 = quote?.rate2 ?? null;
  const waiting = <Muted>เลือกยี่ห้อและรุ่นก่อน ระบบจะเติมราคาให้</Muted>;

  return (
    <Card>
      <CardHeader className="flex-wrap gap-2">
        <CardTitle>ราคาขาย</CardTitle>
        {!accessory && templatePrices && (
          <div className="flex flex-wrap items-center gap-2">
            {edited.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-xs leading-snug text-success dark:bg-success/15">
                <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                ตามตารางราคากลาง · {templateLabel}
              </span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs leading-snug text-warning-strong dark:bg-warning/15">
                  <PencilLine className="size-3.5 shrink-0" aria-hidden="true" />
                  แก้ {edited.length} ราคาจากตารางราคากลาง
                </span>
                <button
                  type="button"
                  onClick={onUseTemplate}
                  className="inline-flex items-center text-xs font-medium leading-snug text-primary underline-offset-2 hover:underline max-lg:min-h-11 lg:min-h-8"
                >
                  ใช้ราคากลางทั้งหมด
                </button>
              </>
            )}
          </div>
        )}
        {!accessory && templateFailed && <RetryNotice onRetry={onRetry} />}
      </CardHeader>
      <CardContent className="p-0">
        {accessory ? (
          <PriceRow
            id={`${baseId}-cash`}
            label="ราคาขาย"
            sub="อุปกรณ์เสริม"
            ariaLabel="ราคาขาย"
            value={fields.cash}
            onChange={(v) => onFieldChange('cash', v)}
            edited={false}
            profit={accessoryProfit}
          >
            <Muted>มีช่องเดียว ไม่มีผ่อน</Muted>
          </PriceRow>
        ) : (
          <>
            <PriceRow
              id={`${baseId}-cash`}
              label="เงินสด"
              ariaLabel="เงินสด"
              value={fields.cash}
              onChange={(v) => onFieldChange('cash', v)}
              edited={isEdited('cash')}
              templateValue={templatePrices?.cash}
              profit={quote?.cash?.profit}
            >
              <Muted>{templateNotFound ? NOT_FOUND : 'จ่ายครั้งเดียว'}</Muted>
            </PriceRow>
            <PriceRow
              id={`${baseId}-bc`}
              label="ผ่อน BESTCHOICE"
              sub="เรท 1"
              ariaLabel="ผ่อน BESTCHOICE"
              value={fields.bc}
              onChange={(v) => onFieldChange('bc', v)}
              edited={isEdited('bc')}
              templateValue={templatePrices?.bc}
              profit={rate1?.profit}
            >
              {!quote ? (
                waiting
              ) : rate1 ? (
                <>
                  <Plan down={rate1.downAmount} monthly={rate1.monthlyDisplay} months={rate1.months} />
                  <Muted>ยอดจัด {formatBahtPlain(rate1.price - rate1.downAmount)}</Muted>
                </>
              ) : bcConfigFailed ? (
                <RetryNotice onRetry={onRetry} />
              ) : (
                <Muted>
                  {bcConfigMissing ? 'ยังไม่มีตั้งค่าดอกเบี้ยของหมวดนี้ — คิดค่างวดไม่ได้' : 'กรอกราคาเพื่อดูดาวน์และค่างวด'}
                </Muted>
              )}
            </PriceRow>
            <PriceRow
              id={`${baseId}-finance`}
              label="ผ่อน GFIN"
              sub="เรท 2 · ราคาขาย"
              ariaLabel="ผ่อน GFIN ราคาขาย"
              value={blocked ? '' : fields.finance}
              onChange={(v) => onFieldChange('finance', v)}
              disabled={blocked}
              placeholder={blocked ? undefined : 'เท่าราคาผ่อน'}
              edited={isEdited('finance')}
              templateValue={templatePrices?.finance}
              profit={rate2?.available ? rate2.profit : null}
            >
              {blocked ? (
                <Muted>{NO_GFIN}</Muted>
              ) : !quote || !rate2 ? (
                waiting
              ) : rate2.available ? (
                <>
                  <Plan down={rate2.downAmount} monthly={rate2.monthly} months={rate2.months} />
                  <Muted>ส่ง GFIN {formatBahtPlain(rate2.submitPrice)}</Muted>
                  {rate2.originNote && (
                    <p className="flex items-start gap-1.5 pt-1 text-xs leading-snug text-muted-foreground">
                      <Info className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden="true" />
                      <span>{GFIN_ORIGIN_NOTE}</span>
                    </p>
                  )}
                </>
              ) : (
                <Muted>{rate2.message}</Muted>
              )}
            </PriceRow>
          </>
        )}
        <p className="border-t border-border/60 bg-muted/40 px-4 py-2.5 text-xs leading-snug text-muted-foreground sm:px-5">
          {costEntered ? 'กำไรคิดจากช่อง "ราคาทุน" ในฟอร์มนี้ · เห็นเฉพาะคนที่เห็นทุน' : 'กรอกราคาทุนเพื่อดูกำไร'}
        </p>
      </CardContent>
    </Card>
  );
}
