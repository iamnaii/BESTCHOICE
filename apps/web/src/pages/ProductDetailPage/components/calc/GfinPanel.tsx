import { useState, type ReactNode } from 'react';
import { ChevronDown, Lock } from 'lucide-react';
import { gfinDownPctOptions } from '@installment/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { GfinQuote, GfinSettingsApi } from '../../utils/gfinQuote';
import type { ResolvedGfin } from '../../utils/resolveQuotes';
import { MonthsSelect } from './MonthsSelect';
import {
  DetailRow,
  DownCallout,
  HintLine,
  NoticeBox,
  ResultBox,
  formatBaht,
  formatTHB,
} from './CalcRows';

type AvailableQuote = Extract<GfinQuote, { available: true }>;

interface Props {
  gfin: ResolvedGfin & { months: number; quote: AvailableQuote };
  settings: GfinSettingsApi;
  installmentPrice: number;
  /** เจ้าของ/ผู้จัดการ/บัญชี เห็นช่อง % คอมมิชชั่น + แผงเฉพาะร้านค้า · SALES ไม่เห็น */
  isManager: boolean;
  commissionOptions: number[];
  onMonthsChange: (months: number) => void;
  onDownPctChange: (pct: number) => void;
  onCommissionChange: (pct: number) => void;
  /** บรรทัดเทียบ BESTCHOICE งวดเดียวกัน */
  compare: ReactNode;
}

function clampPct(pct: number, min: number, max: number): number {
  if (!Number.isFinite(pct)) return min;
  return Math.min(max, Math.max(0, Math.round(pct * 100) / 100));
}

/**
 * ฝั่ง GFIN — ชื่อช่องและสูตรตามหน้าขอสินเชื่อของ GFIN (ดาวน์ (%) · จำนวนเงินดาวน์ · % คอมมิชชั่น ·
 * ผ่อนชำระ · ยอดจัดสินเชื่อหลังหักเงินดาวน์ · รวมเงินผ่อนต่องวด · แผงเฉพาะร้านค้า)
 */
export function GfinPanel({
  gfin,
  settings,
  installmentPrice,
  isManager,
  commissionOptions,
  onMonthsChange,
  onDownPctChange,
  onCommissionChange,
  compare,
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { quote, months, downPct, commissionPct } = gfin;
  const r = quote.result;
  const submit = r.gfinSubmitPrice.toNumber();

  const downOptions = gfinDownPctOptions(
    settings.minDownPct,
    settings.maxDownPct,
    settings.downStepPct,
  );
  if (!downOptions.includes(downPct)) downOptions.push(downPct);
  downOptions.sort((a, b) => a - b);

  const conditionLabel = quote.mapping.condition === 'HAND_1' ? 'มือ 1' : 'มือ 2';
  const allowance = quote.rule ? Number(quote.rule.allowance) : 0;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="calc-gfin-down-pct" className="text-[13px] text-muted-foreground leading-snug">
              ดาวน์ (%)
            </Label>
            <Select value={String(downPct)} onValueChange={(v) => onDownPctChange(Number(v))}>
              <SelectTrigger id="calc-gfin-down-pct" aria-label="ดาวน์ (%)">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {downOptions.map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {p} %
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="calc-gfin-down-amount" className="text-[13px] text-muted-foreground leading-snug">
              จำนวนเงินดาวน์
            </Label>
            <Input
              id="calc-gfin-down-amount"
              type="number"
              min="0"
              value={Math.round(r.downAmountByFormula.toNumber())}
              onChange={(e) => {
                const amount = Number(e.target.value);
                if (!Number.isFinite(amount) || submit <= 0) return;
                onDownPctChange(clampPct((amount / submit) * 100, 0, settings.maxDownPct));
              }}
              className="text-right font-mono tabular-nums"
            />
          </div>
        </div>
        <HintLine>
          เริ่มจากขั้นต่ำที่ GFIN ตั้งให้ร้าน {settings.minDownPct}% ถึง {settings.maxDownPct}% ขั้นละ{' '}
          {settings.downStepPct}% · พิมพ์ทับได้ · คิดจากราคาส่ง GFIN {formatBaht(submit)}
        </HintLine>
      </div>

      <DownCallout
        downPct={downPct}
        declared={r.downAmountByFormula.toNumber()}
        actual={r.downAmountActual.toNumber()}
        submit={submit}
        ourPrice={installmentPrice}
        discount={r.downDiscount.toNumber()}
      />

      {r.priceAboveSubmit && (
        <NoticeBox tone="warning">
          ราคาผ่อนที่ต้องการ {formatBaht(installmentPrice)} สูงกว่าราคาส่งสูงสุด GFIN {formatBaht(submit)} —
          ไม่มีส่วนลดดาวน์ และร้านจะได้รับน้อยกว่าราคาผ่อน
        </NoticeBox>
      )}

      <div className="space-y-1.5">
        <div className="grid grid-cols-2 gap-3">
          {isManager ? (
            <div className="space-y-1.5">
              <Label htmlFor="calc-gfin-commission" className="text-[13px] text-muted-foreground leading-snug">
                % คอมมิชชั่น
              </Label>
              <Select
                value={String(commissionPct)}
                onValueChange={(v) => onCommissionChange(Number(v))}
              >
                <SelectTrigger id="calc-gfin-commission" aria-label="% คอมมิชชั่น">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {commissionOptions.map((p) => (
                    <SelectItem key={p} value={String(p)}>
                      {p}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-[13px] text-muted-foreground leading-snug">ราคาส่ง GFIN</div>
              <div className="flex h-[34px] items-center rounded-md border border-border/60 bg-muted/40 px-3 font-mono text-[13px] tabular-nums">
                {formatBaht(submit)} ฿
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <div className="text-[13px] text-muted-foreground leading-snug">ผ่อนได้สูงสุด</div>
            <div className="flex h-[34px] items-center rounded-md border border-border/60 bg-muted/40 px-3 text-[13px] text-muted-foreground leading-snug">
              {quote.maxMonths != null ? `${quote.maxMonths} งวด · ตาราง GFIN` : 'ไม่จำกัด'}
            </div>
          </div>
        </div>
        {isManager && (
          <HintLine>
            คอมตั้งให้ตามประเภทสินค้า: มือถือ {settings.commissionPctByCategory.PHONE}% · iPad{' '}
            {settings.commissionPctByCategory.TABLET}% (แก้รายเครื่องได้ · พนักงานขายไม่เห็นช่องนี้)
          </HintLine>
        )}
      </div>

      <MonthsSelect
        id="calc-gfin-months"
        label="ผ่อนชำระ"
        value={months}
        options={quote.monthsOptions}
        onChange={onMonthsChange}
        format={formatBaht}
      />

      <ResultBox
        label="รวมเงินผ่อนต่องวด (GFIN ปัดขึ้นเป็นบาท)"
        amount={formatBaht(r.monthlyPayment.toNumber())}
        sub={`ลูกค้าดาวน์จริง ${formatBaht(r.downAmountActual.toNumber())} · ยอดจัดหลังหักดาวน์ ${formatBaht(r.financedAmount.toNumber())} · ${months} งวด`}
        tone="info"
      />

      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground leading-snug">
          <ChevronDown
            className={cn('size-3.5 transition-transform', detailsOpen && 'rotate-180')}
            aria-hidden
          />
          รายละเอียดการคำนวณ
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-1.5">
          <DetailRow
            label={`ราคาส่ง GFIN (${conditionLabel} ${formatBaht(Number(quote.mapping.maxPrice))} + OVER ${formatBaht(allowance)})`}
            value={formatTHB(submit)}
          />
          <DetailRow
            label="ส่วนลดดาวน์ (ราคาส่ง − ราคาผ่อนที่ต้องการ)"
            value={formatTHB(r.downDiscount.toNumber())}
          />
          <DetailRow
            label={`ดาวน์ตามสูตร ${downPct}%`}
            value={formatTHB(r.downAmountByFormula.toNumber())}
          />
          <DetailRow
            label="ดาวน์จริง (ลูกค้าจ่าย)"
            value={formatTHB(r.downAmountActual.toNumber())}
            bold
          />
          <DetailRow
            label="ยอดจัดสินเชื่อหลังหักเงินดาวน์"
            value={formatTHB(r.financedAmount.toNumber())}
          />
          <DetailRow label={`เรท ${months} งวด · คอม ${commissionPct}%`} value={quote.factor.factor} />
          <DetailRow
            label="ยอดจัด × เรท (ปัดขึ้น)"
            value={formatTHB(r.monthlyPayment.sub(r.feePerInstallment).toNumber())}
          />
          <DetailRow label="ค่าล็อกเครื่อง / งวด" value={formatTHB(r.feePerInstallment.toNumber())} />
          <DetailRow
            label={`รวม ${months} งวด (ค่างวด × ${months})`}
            value={formatTHB(r.totalPayback.toNumber())}
            bold
          />
        </CollapsibleContent>
      </Collapsible>

      {isManager && (
        <div className="space-y-1.5 rounded-lg border border-border/70 bg-muted/45 px-3.5 py-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground leading-snug">
            <Lock className="size-3" aria-hidden />
            <span>เฉพาะร้านค้า</span>
            <span className="font-normal">· เจ้าของ/ผู้จัดการเห็น</span>
          </div>
          <DetailRow
            label={`ค่าคอมมิชชั่นสุทธิ (${commissionPct}% ของยอดจัด)`}
            value={formatTHB(r.shopCommissionAmount.toNumber())}
          />
          <DetailRow label="ค่าทำสัญญา" value={`−${formatTHB(r.contractFee.toNumber())}`} />
          <DetailRow
            label="ยอดโอนให้ร้านค้าสุทธิ"
            value={formatTHB(r.netTransferToShop.toNumber())}
            bold
            valueClassName="text-success"
          />
          <DetailRow
            label={`ร้านรับรวม (ดาวน์ ${formatBaht(r.downAmountActual.toNumber())} + ยอดโอน)`}
            value={formatTHB(r.shopTotalReceived.toNumber())}
          />
        </div>
      )}

      {compare}

      <NoticeBox>
        ชื่อช่องและสูตรตามหน้าขอสินเชื่อของ GFIN (ยอดโอนให้ร้าน = ยอดจัด + คอม − ค่าทำสัญญา) ·
        ส่งให้ไฟแนนซ์ภายนอก ไม่ใช่สัญญาของเรา จึงไม่มีปุ่มทำสัญญา
      </NoticeBox>
    </div>
  );
}
