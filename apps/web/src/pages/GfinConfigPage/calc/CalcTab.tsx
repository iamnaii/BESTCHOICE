import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/NumberInput';
import { useGfinTables } from '@/pages/ProductDetailPage/hooks/useGfinTables';
import { gfinProductOf, gfinQuoteAt } from '../gfinQuoteAt';
import { HAND_LABEL, HANDS, rowKeyOf, type Hand } from '../terms/modelTerms';
import { buildCalcLines, calcSeriesOptions, unavailableText } from './calcModel';

const fmt = (n: number) => n.toLocaleString('th-TH');

const Toggle = (p: { pressed: boolean; disabled?: boolean; onClick: () => void; children: string }) => (
  <Button variant={p.pressed ? 'primary' : 'outline'} size="sm" aria-pressed={p.pressed} disabled={p.disabled} onClick={p.onClick}>
    {p.children}
  </Button>
);

/** แท็บ "ทดลองคำนวณ" (สเปก §6.4) — สูตรเดียวกับหน้าสินค้า (resolveGfinQuote) */
export function CalcTab() {
  const { tables, isLoading, isError, retry } = useGfinTables();
  const [, setSearchParams] = useSearchParams();
  const options = useMemo(() => (tables ? calcSeriesOptions(tables) : []), [tables]);
  const [series, setSeries] = useState<string | null>(null);
  const [hand, setHand] = useState<Hand>('HAND_2');
  const [storage, setStorage] = useState<string | null>(null);
  const [origin, setOrigin] = useState<'THAI' | 'IMPORTED'>('THAI');
  const [sale, setSale] = useState('');

  if (isLoading) return <div className="p-4 text-muted-foreground leading-snug">กำลังโหลด...</div>;
  if (isError || !tables)
    return (
      <div className="space-y-2 p-4">
        <p className="text-destructive leading-snug">โหลดข้อมูล GFIN ไม่สำเร็จ</p>
        <Button variant="outline" onClick={retry}>
          ลองใหม่
        </Button>
      </div>
    );
  if (options.length === 0) return <p className="p-4 text-muted-foreground leading-snug">ยังไม่มีราคาในใบราคา GFIN</p>;

  const opt = options.find((o) => o.series === series) ?? options[0];
  const handNow: Hand = opt.hands[hand] ? hand : HANDS.find((h) => opt.hands[h])!;
  const storages = opt.hands[handNow]!;
  const storageNow = storage && storages.includes(storage) ? storage : storages[0];
  const saleNum = sale === '' ? NaN : Number(sale);
  // ≤ 0 หรือไม่ใช่ตัวเลข = เว้นว่าง (ขายเท่าราคาส่ง)
  const salePrice = Number.isFinite(saleNum) && saleNum > 0 ? saleNum : null;
  const resolved = gfinQuoteAt(tables, gfinProductOf(opt.series, storageNow, handNow, origin), salePrice);
  const input = { series: opt.series, storage: storageNow, condition: handNow, deviceOrigin: origin };
  const lines = buildCalcLines(input, resolved, tables.settings.minDownPct);
  const reason = unavailableText(resolved);
  const editKey = rowKeyOf(opt.series, handNow);
  const goEdit = () => setSearchParams(new URLSearchParams({ tab: 'terms', edit: editKey }));
  const q = resolved.quote;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-lg font-semibold leading-snug">เครื่องที่จะลองคิด</h2>
        <div className="space-y-1">
          <p className="text-sm font-medium">รุ่น</p>
          <div className="flex flex-wrap gap-1" role="group" aria-label="รุ่น">
            {options.map((o) => (
              <Toggle key={o.series} pressed={o.series === opt.series} onClick={() => setSeries(o.series)}>
                {o.series}
              </Toggle>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">สภาพ</p>
          <div className="flex gap-1" role="group" aria-label="สภาพ">
            {HANDS.map((h) => (
              <Toggle key={h} pressed={h === handNow} disabled={!opt.hands[h]} onClick={() => setHand(h)}>
                {HAND_LABEL[h]}
              </Toggle>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">ความจุ</p>
          <div className="flex flex-wrap gap-1" role="group" aria-label="ความจุ">
            {storages.map((s) => (
              <Toggle key={s} pressed={s === storageNow} onClick={() => setStorage(s)}>
                {s}
              </Toggle>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">เครื่องไทย / เครื่องนอก</p>
          <div className="flex gap-1" role="group" aria-label="ที่มาเครื่อง">
            <Toggle pressed={origin === 'THAI'} onClick={() => setOrigin('THAI')}>
              ไทย
            </Toggle>
            <Toggle pressed={origin === 'IMPORTED'} onClick={() => setOrigin('IMPORTED')}>
              นอก
            </Toggle>
          </div>
        </div>
        <div>
          <label htmlFor="gfin-calc-sale" className="text-sm font-medium leading-snug">
            ราคาขาย GFIN ของร้าน (บาท)
          </label>
          <NumberInput id="gfin-calc-sale" min="0" step="0.01" value={sale} placeholder="เว้นว่าง = ขายเท่าราคาส่ง" onChange={(e) => setSale(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground leading-snug">
            ราคาที่จะตั้งขายลูกค้าผ่อน GFIN · ต่ำกว่าราคาส่ง = ร้านช่วยออกดาวน์ส่วนต่าง
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-live="polite">
        {!q.available ? (
          <div className="space-y-2">
            <p className="flex items-start gap-2 text-warning-strong leading-snug">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {reason}
            </p>
            {q.reason === 'no_rule' && (
              <Button variant="outline" size="sm" onClick={goEdit}>
                แก้รุ่นนี้
              </Button>
            )}
          </div>
        ) : (
          <>
            <div>
              <p className="text-sm text-muted-foreground leading-snug">ผลคำนวณ · ดาวน์ลูกค้า</p>
              <p className="text-3xl font-semibold tabular-nums">
                {fmt(q.result.downAmountActual.toNumber())} <span className="text-base font-normal">บาท</span>
              </p>
              <p className="text-sm leading-snug">
                ผ่อนสูงสุด {resolved.months} งวด · เดือนละ {fmt(q.result.monthlyPayment.toNumber())} บาท
              </p>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {lines.map((l) => (
                  <tr key={l.label} className="border-t border-border align-top">
                    <td className="py-1.5 pr-2 leading-snug">
                      {l.label}
                      {l.source && <span className="block text-xs text-muted-foreground">{l.source}</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(l.amount)}</td>
                    <td className="py-1.5 pl-2 text-right">
                      {l.editKey && l.label === '+ OVER' && (
                        <Button variant="ghost" size="sm" onClick={goEdit}>
                          แก้รุ่นนี้
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-1 text-left font-medium">จำนวนงวด</th>
                    <th className="py-1 text-right font-medium">ผ่อนเดือนละ</th>
                  </tr>
                </thead>
                <tbody>
                  {q.monthsOptions.map((o) => (
                    <tr key={o.months} className={o.months === resolved.months ? 'font-semibold' : ''}>
                      <td className="py-1">{o.months} งวด</td>
                      <td className="py-1 text-right tabular-nums">{fmt(o.monthly)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-muted-foreground leading-snug">
                ข้อ 4 · ตารางค่างวด คอม {resolved.commissionPct}% · รวมค่าธรรมเนียม {fmt(q.result.feePerInstallment.toNumber())} บาท/งวด ·
                ตัวเลขชุดเดียวกับหน้าเพิ่มสินค้าและหน้าสินค้า
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
