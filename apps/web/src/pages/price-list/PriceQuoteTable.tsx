import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  RATE1_TITLE,
  RATE2_TITLE,
  formatBaht,
  formatCash,
  rate1View,
  rate2View,
  rowTitle,
  type RateView,
} from './format';
import { WarrantyBadge } from './parts';
import type { PriceQuoteRow } from './types';

const MONEY = 'text-right font-mono tabular-nums';

const SUB_HEADERS = [
  ['r1-down', 'ดาวน์'],
  ['r1-monthly', 'ค่างวด'],
  ['r1-months', 'งวด'],
  ['r2-down', 'ดาวน์'],
  ['r2-monthly', 'ค่างวด'],
  ['r2-months', 'งวด'],
] as const;

/** 3 ช่องของเรทหนึ่งเรท · ไม่มีเรท = ช่องเดียวกว้าง 3 คอลัมน์พร้อมข้อความ */
function RateCells({ view }: { view: RateView }) {
  if (!view.ok) {
    return (
      <TableCell colSpan={3} className="text-center text-sm leading-snug text-muted-foreground">
        {view.text}
      </TableCell>
    );
  }
  return (
    <>
      <TableCell className={MONEY}>{formatBaht(view.terms.downAmount)}</TableCell>
      <TableCell className={cn(MONEY, 'font-semibold')}>{formatBaht(view.terms.monthly)}</TableCell>
      <TableCell className={MONEY}>{view.terms.months}</TableCell>
    </>
  );
}

/** จอ ≥ 1024px — หนึ่งแถวต่อรุ่น + ความจุ */
export default function PriceQuoteTable({ rows }: { rows: PriceQuoteRow[] }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-card">
      <Table>
        <caption className="sr-only">ตารางราคาและเรทผ่อน</caption>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead rowSpan={2} scope="col">รุ่น · ความจุ</TableHead>
            <TableHead rowSpan={2} scope="col" className="text-right">
              เงินสด
            </TableHead>
            <TableHead colSpan={3} scope="colgroup" className="text-center">
              {RATE1_TITLE}
            </TableHead>
            <TableHead colSpan={3} scope="colgroup" className="text-center">
              {RATE2_TITLE}
            </TableHead>
          </TableRow>
          <TableRow className="bg-muted/50">
            {SUB_HEADERS.map(([key, label]) => (
              <TableHead key={key} scope="col" className="text-right">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2 leading-snug">
                  <span className="font-medium text-foreground">{rowTitle(row)}</span>
                  <WarrantyBadge hasWarranty={row.hasWarranty} />
                </div>
              </TableCell>
              <TableCell className={cn(MONEY, 'font-semibold')}>{formatCash(row.cashPrice)}</TableCell>
              <RateCells view={rate1View(row.rate1)} />
              <RateCells view={rate2View(row.rate2)} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
