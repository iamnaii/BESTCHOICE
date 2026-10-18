import { cn } from '@/lib/utils';
import type { PettyCashMonth } from '../types';
import { money, signedMoney } from '../petty-cash.util';

/** สรุปเดือนนี้ (mockup กระดาน 1 การ์ดขวา): เติม · คืน · จ่ายผู้จัดจำหน่าย · อื่น ๆ · สุทธิ */
export function MonthSummaryCard({ month }: { month: PettyCashMonth }) {
  const net = Number(month.net);
  const rows = [
    { key: 'topUps', dot: 'bg-primary', label: 'เติมจากธนาคาร', unit: 'ครั้ง', value: signedMoney(month.topUps.amount, '+'), count: month.topUps.count, muted: month.topUps.count === 0 },
    { key: 'returns', dot: 'bg-info', label: 'คืนเข้าธนาคาร', unit: 'ครั้ง', value: signedMoney(month.returns.amount, '-'), count: month.returns.count, muted: month.returns.count === 0 },
    { key: 'suppliers', dot: 'bg-warning', label: 'จ่ายผู้จัดจำหน่าย', unit: 'ใบ', value: signedMoney(month.supplierPayments.amount, '-'), count: month.supplierPayments.count, muted: month.supplierPayments.count === 0 },
    ...(month.other.count > 0
      ? [{ key: 'other', dot: 'bg-muted-foreground', label: 'รายการอื่น', unit: 'รายการ', value: money(month.other.amount), count: month.other.count, muted: false }]
      : []),
  ];
  return (
    <section aria-label="สรุปเดือนนี้" className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 rounded-xl border border-border/50 bg-card p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold">เดือนนี้</div>
        <div className="text-xs text-muted-foreground">{month.label}</div>
      </div>
      <dl className="divide-y divide-border/50 text-sm">
        {rows.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-2 py-2">
            <dt className="flex items-center gap-2">
              <span aria-hidden className={cn('inline-block size-2 rounded-full', row.dot)} />
              {row.label} <span className="text-xs text-muted-foreground">{row.count} {row.unit}</span>
            </dt>
            <dd className={cn('font-mono tabular-nums', row.muted ? 'text-muted-foreground' : 'font-medium')}>{row.muted ? '0.00' : row.value}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-2 pt-2 font-semibold">
          <dt>สุทธิเดือนนี้</dt>
          <dd className="font-mono tabular-nums">{signedMoney(Math.abs(net), net < 0 ? '-' : '+')}</dd>
        </div>
      </dl>
      <p className="text-xs leading-snug text-muted-foreground">ยอดยกมาต้นเดือน {money(month.opening)} บาท · เงินสดย่อยกองเดียวทั้งร้าน ไม่แยกสาขา ไม่ระบุผู้ถือ</p>
    </section>
  );
}
