import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { calcBcInstallment } from '@installment/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router';

interface Props {
  productId: string;
  installmentPrice: number;
  hideCommission?: boolean; // SALES role
  config: {
    minDownPct: number;
    commissionPct: number;
    vatPct: number;
    ratePctByMonths: Record<number, number>;
    allowedMonths: number[];
  };
}

function formatTHB(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function BcCalculatorCard({ productId, installmentPrice, hideCommission, config }: Props) {
  const navigate = useNavigate();
  const defaultMonths = config.allowedMonths.includes(12) ? 12 : config.allowedMonths[0];
  const [months, setMonths] = useState(defaultMonths);
  const [downAmount, setDownAmount] = useState(Math.round(installmentPrice * config.minDownPct));

  const ratePctByMonths = useMemo(
    () =>
      new Map(
        Object.entries(config.ratePctByMonths).map(([k, v]) => [Number(k), new Decimal(v)]),
      ),
    [config.ratePctByMonths],
  );

  const result = useMemo(
    () =>
      calcBcInstallment({
        installmentPrice: new Decimal(installmentPrice),
        months,
        customDownAmount: new Decimal(downAmount),
        config: {
          minDownPct: new Decimal(config.minDownPct),
          commissionPct: new Decimal(config.commissionPct),
          vatPct: new Decimal(config.vatPct),
          ratePctByMonths,
          allowedMonths: config.allowedMonths,
        },
      }),
    [installmentPrice, months, downAmount, config, ratePctByMonths],
  );

  const handleUseInContract = () => {
    navigate(`/contracts/create?productId=${productId}&downAmount=${downAmount}&months=${months}`);
  };

  return (
    <Card className="border-emerald-200 dark:border-emerald-900/40">
      <CardHeader>
        <CardTitle className="text-emerald-700 dark:text-emerald-400 leading-snug">
          BESTCHOICE
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-[1fr_2fr] items-center gap-x-3 gap-y-2">
          <label className="text-sm leading-snug">เงินดาวน์ (฿)</label>
          <Input
            type="number"
            value={downAmount}
            onChange={(e) => setDownAmount(Number(e.target.value))}
            className="text-right"
          />
          <label className="text-sm leading-snug">งวด</label>
          <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {config.allowedMonths.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m} งวด
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <hr className="border-border" />
        {!result.isValid && (
          <ul className="text-destructive text-sm space-y-1 leading-snug">
            {result.errors.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        )}
        <Row label="ดาวน์" value={result.downAmount.toNumber()} />
        <Row label="ยอดจัด" value={result.financedAmount.toNumber()} />
        <Row
          label={`ดอกเบี้ย (${result.interestPct.mul(100).toFixed(0)}%)`}
          value={result.interestAmount.toNumber()}
        />
        {!hideCommission && (
          <Row
            label={`คอม (${result.commissionPct.mul(100).toFixed(0)}%)`}
            value={result.commissionAmount.toNumber()}
          />
        )}
        <Row label="VAT 7%" value={result.vatAmount.toNumber()} />
        <div className="border-t border-border pt-2 text-lg font-semibold flex justify-between leading-snug">
          <span>ค่างวด</span>
          <span className="text-emerald-700 dark:text-emerald-400">
            {formatTHB(result.monthlyPayment.toNumber())} / เดือน
          </span>
        </div>
        <Button
          className="w-full"
          variant="primary"
          disabled={!result.isValid}
          onClick={handleUseInContract}
        >
          ใช้ราคานี้ทำสัญญา
        </Button>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-sm leading-snug">
      <span className="text-muted-foreground">{label}</span>
      <span>{formatTHB(value)}</span>
    </div>
  );
}
