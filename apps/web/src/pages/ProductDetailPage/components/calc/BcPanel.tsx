import { useState, type ReactNode } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { ResolvedBc } from '../../utils/resolveQuotes';
import { MonthsSelect } from './MonthsSelect';
import { DetailRow, HintLine, ResultBox, formatBaht, formatTHB } from './CalcRows';

interface Props {
  bc: ResolvedBc;
  /** % ดาวน์ขั้นต่ำจากตารางดอกเบี้ย เช่น 15 */
  minDownPct: number;
  /** SALES ไม่เห็นแถวคอม (เหมือน hideCommission เดิม) */
  hideCommission: boolean;
  /** FM/ACCOUNTANT เข้า /contracts/create ไม่ได้ → ซ่อนปุ่ม */
  canCreateContract: boolean;
  onMonthsChange: (months: number) => void;
  onDownChange: (amount: number | null) => void;
  onCreateContract: () => void;
  /** บรรทัดเทียบ GFIN งวดเดียวกัน (หรือข้อความว่าทำไมไม่มี) */
  compare: ReactNode;
}

/** ฝั่ง BESTCHOICE (สัญญาของเรา) — สูตรเดียวกับสัญญาจริง (calcBcInstallment) */
export function BcPanel({
  bc,
  minDownPct,
  hideCommission,
  canCreateContract,
  onMonthsChange,
  onDownChange,
  onCreateContract,
  compare,
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const r = bc.quote.result;

  return (
    <div className="space-y-4">
      <MonthsSelect
        id="calc-bc-months"
        label="งวด"
        value={bc.months}
        options={bc.quote.monthsOptions}
        onChange={onMonthsChange}
        format={formatTHB}
      />

      <div className="space-y-1.5">
        <Label htmlFor="calc-bc-down" className="text-[13px] text-muted-foreground leading-snug">
          เงินดาวน์ (฿)
        </Label>
        <Input
          id="calc-bc-down"
          type="number"
          min="0"
          value={bc.downAmount}
          onChange={(e) => onDownChange(e.target.value === '' ? null : Number(e.target.value))}
          className="text-right font-mono tabular-nums"
        />
        <HintLine>
          ดาวน์ขั้นต่ำ {minDownPct}% = {formatBaht(bc.minDownAmount)} ฿ · พิมพ์ทับได้
        </HintLine>
      </div>

      {!r.isValid && (
        <ul className="space-y-1 text-[13px] text-destructive leading-snug">
          {r.errors.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      )}

      <ResultBox
        label="ค่างวด BESTCHOICE"
        amount={formatTHB(r.monthlyPayment.toNumber())}
        sub={`ดาวน์ ${formatBaht(r.downAmount.toNumber())} · ยอดจัด ${formatBaht(r.financedAmount.toNumber())} · ${bc.months} งวด`}
        tone="primary"
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
            label={`ดอกเบี้ย (${r.interestPct.mul(100).toFixed(0)}%)`}
            value={formatTHB(r.interestAmount.toNumber())}
          />
          {!hideCommission && (
            <DetailRow
              label={`คอม (${r.commissionPct.mul(100).toFixed(0)}%)`}
              value={formatTHB(r.commissionAmount.toNumber())}
            />
          )}
          <DetailRow label="VAT 7%" value={formatTHB(r.vatAmount.toNumber())} />
          <DetailRow label="รวมที่ต้องผ่อน" value={formatTHB(r.totalWithVat.toNumber())} bold />
        </CollapsibleContent>
      </Collapsible>

      {compare}

      {canCreateContract && (
        <Button
          className="w-full"
          size="lg"
          variant="primary"
          disabled={!r.isValid}
          onClick={onCreateContract}
        >
          ใช้ราคานี้ทำสัญญา
          <ArrowRight aria-hidden />
        </Button>
      )}

      <p className="text-center text-xs text-muted-foreground leading-snug">
        "คัดลอกสรุปส่งลูกค้า" จะใช้ {bc.months} งวด · ดาวน์ {formatBaht(bc.downAmount)} ตามที่เลือกอยู่ตรงนี้
      </p>
    </div>
  );
}
