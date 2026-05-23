import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Decimal from 'decimal.js';
import api from '@/lib/api';
import { calcGfinInstallment, findGfinMapping, findGfinOverpriceRule } from '@installment/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

interface MaxPriceApi {
  id: string;
  gfinSeries: string;
  gfinVariant: string | null;
  storage: string;
  condition: 'HAND_1' | 'HAND_2';
  maxPrice: string;
  modelMatchPattern: string;
  isActive: boolean;
}
interface OverpriceApi {
  id: string;
  label: string;
  seriesPattern: string;
  condition: 'HAND_1' | 'HAND_2';
  allowance: string;
  isActive: boolean;
}
interface RateFactorApi {
  id: string;
  months: number;
  factor: string;
  feePerInstallment: string;
  isActive: boolean;
}

interface Props {
  productId: string;
  installmentPrice: number;
  product: {
    brand: string;
    model: string;
    storage: string;
    category: 'PHONE_NEW' | 'PHONE_USED';
  };
}

function formatTHB(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function GfinCalculatorCard({ productId: _productId, installmentPrice, product }: Props) {
  const [months, setMonths] = useState(12);
  const [downPct, setDownPct] = useState(0.3);

  const { data: mappings } = useQuery({
    queryKey: ['gfin-max-prices'],
    queryFn: () => api.get<MaxPriceApi[]>('/gfin-config/max-prices').then((r) => r.data),
  });
  const { data: rules } = useQuery({
    queryKey: ['gfin-overprice-rules'],
    queryFn: () => api.get<OverpriceApi[]>('/gfin-config/overprice-rules').then((r) => r.data),
  });
  const { data: factors } = useQuery({
    queryKey: ['gfin-rate-factors'],
    queryFn: () => api.get<RateFactorApi[]>('/gfin-config/rate-factors').then((r) => r.data),
  });

  const mappingObjects = useMemo(
    () => (mappings ?? []).map((m) => ({ ...m, maxPrice: new Decimal(m.maxPrice) })),
    [mappings],
  );

  const mapping = useMemo(() => {
    if (mappingObjects.length === 0) return null;
    return findGfinMapping(product, mappingObjects);
  }, [mappingObjects, product]);

  const ruleObjects = useMemo(
    () => (rules ?? []).map((r) => ({ ...r, allowance: new Decimal(r.allowance) })),
    [rules],
  );

  const factorObjects = useMemo(
    () =>
      (factors ?? []).map((f) => ({
        ...f,
        factor: new Decimal(f.factor),
        feePerInstallment: new Decimal(f.feePerInstallment),
      })),
    [factors],
  );

  const result = useMemo(() => {
    if (!mapping) return null;
    const factor = factorObjects.find((f) => f.months === months && f.isActive);
    if (!factor) return null;
    const rule = findGfinOverpriceRule(mapping, ruleObjects);
    return calcGfinInstallment({
      installmentPrice: new Decimal(installmentPrice),
      product,
      months,
      downPct: new Decimal(downPct),
      mapping,
      overpriceRule: rule,
      rateFactor: factor,
    });
  }, [mapping, ruleObjects, factorObjects, months, downPct, installmentPrice, product]);

  if (!mappings || !factors) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">กำลังโหลด...</CardContent>
      </Card>
    );
  }

  if (!mapping) {
    return (
      <Card className="border-muted">
        <CardHeader>
          <CardTitle className="text-muted-foreground leading-snug">GFIN</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-snug">
            รุ่นนี้ไม่อยู่ในตาราง GFIN — ติดต่อ OWNER เพื่อเพิ่มข้อมูลใน
            <span className="font-semibold"> ตั้งค่า → GFIN</span>
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!result) return null;

  const activeMonths = factorObjects
    .filter((f) => f.isActive)
    .map((f) => f.months)
    .sort((a, b) => a - b);

  return (
    <Card className="border-blue-200 dark:border-blue-900/40">
      <CardHeader>
        <CardTitle className="text-blue-700 dark:text-blue-400 leading-snug">GFIN</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-[1fr_2fr] items-center gap-x-3 gap-y-2">
          <label className="text-sm leading-snug">% ดาวน์</label>
          <Input
            type="number"
            value={Math.round(downPct * 100)}
            min={30}
            onChange={(e) => setDownPct(Number(e.target.value) / 100)}
            className="text-right"
          />
          <label className="text-sm leading-snug">งวด</label>
          <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {activeMonths.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m} งวด
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <hr className="border-border" />
        <Row label="ราคาส่ง GFIN" value={result.gfinSubmitPrice.toNumber()} />
        <Row label="ส่วนลดดาวน์" value={result.downDiscount.toNumber()} />
        <Row label="ดาวน์ตามสูตร" value={result.downAmountByFormula.toNumber()} />
        <Row label="ดาวน์จริง (ลูกค้าจ่าย)" value={result.downAmountActual.toNumber()} highlight />
        <Row label="ยอดจัด" value={result.financedAmount.toNumber()} />
        <Row label="ค่าธรรมเนียม / งวด" value={result.feePerInstallment.toNumber()} />
        <div className="border-t border-border pt-2 text-lg font-semibold flex justify-between leading-snug">
          <span>ค่างวด</span>
          <span className="text-blue-700 dark:text-blue-400">
            {formatTHB(result.monthlyPayment.toNumber())} / เดือน
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          ส่งให้ไฟแนนซ์ภายนอก (GFIN) — ไม่ใช่สัญญาของเรา
        </p>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className={`flex justify-between text-sm leading-snug ${highlight ? 'font-semibold' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span>{formatTHB(value)}</span>
    </div>
  );
}
