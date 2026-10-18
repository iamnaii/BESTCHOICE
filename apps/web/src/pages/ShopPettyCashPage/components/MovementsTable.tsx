import { useMemo, useState } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { EvidenceImageLink } from '@/pages/shop-daily-cash/EvidenceImage';
import type { PettyCashMovementsPage, PettyCashRow, PettyCashRowKind } from '../types';
import { money, monthOptions } from '../petty-cash.util';

type Filter = 'ALL' | 'TOP_UP' | 'RETURN' | 'SUPPLIER';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'ALL', label: 'ทั้งหมด' },
  { key: 'TOP_UP', label: 'เติม' },
  { key: 'RETURN', label: 'คืน' },
  { key: 'SUPPLIER', label: 'จ่ายผู้จัดจำหน่าย' },
];
const matches = (kind: PettyCashRowKind, filter: Filter) =>
  filter === 'ALL' || (filter === 'SUPPLIER' ? kind === 'SUPPLIER_PAYMENT' || kind === 'SUPPLIER_PAYMENT_REVERSAL' : kind === filter);

const CHIP: Record<PettyCashRowKind, { label: string; cls: string }> = {
  TOP_UP: { label: 'เติม', cls: 'bg-primary/10 text-primary' },
  RETURN: { label: 'คืน', cls: 'bg-info/10 text-info' },
  SUPPLIER_PAYMENT: { label: 'จ่ายผู้จัดจำหน่าย', cls: 'bg-warning/10 text-warning-strong' },
  SUPPLIER_PAYMENT_REVERSAL: { label: 'ยกเลิกจ่าย', cls: 'bg-muted text-muted-foreground' },
  OTHER: { label: 'อื่น ๆ', cls: 'bg-muted text-muted-foreground' },
};

const thDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${String(Number(get('year')) + 543).slice(-2)}`;
};

export interface MovementsTableProps {
  month: string;
  onMonthChange: (month: string) => void;
  page: PettyCashMovementsPage | undefined;
  loading: boolean;
}

function Description({ row }: { row: PettyCashRow }) {
  const chip = CHIP[row.kind];
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', chip.cls)}>{chip.label}</span>
        {row.po ? (
          <>
            <span className="font-mono text-sm font-medium">{row.po.number}</span>
            <span className="text-muted-foreground">{row.po.supplierName}</span>
          </>
        ) : (
          <span className="font-medium">{row.label}</span>
        )}
        {row.bankAccountCode && <span className="font-mono text-xs text-muted-foreground">{row.bankAccountCode}</span>}
      </div>
      {(row.po || row.note || row.hasEvidence) && (
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {row.po && <span>{row.label}</span>}
          {row.note && <span>หมายเหตุ: {row.note}</span>}
          {row.hasEvidence && row.movementId && (
            <EvidenceImageLink path={`/shop/petty-cash/movements/${row.movementId}/evidence`} label="ดูหลักฐาน" title={`หลักฐาน ${row.label}`} />
          )}
        </div>
      )}
    </div>
  );
}

/** ตารางเคลื่อนไหวของ S11-1106 ทั้งบัญชี (mockup กระดาน 1): ตัวกรองชนิด · เลือกเดือน · ยอดสะสม · รายการจากที่อื่นไม่หาย */
export function MovementsTable({ month, onMonthChange, page, loading }: MovementsTableProps) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const options = useMemo(() => monthOptions(month), [month]);
  const rows = (page?.rows ?? []).filter((row) => matches(row.kind, filter));
  const totalIn = rows.reduce((sum, r) => sum + Number(r.inAmount), 0);
  const totalOut = rows.reduce((sum, r) => sum + Number(r.outAmount), 0);
  return (
    <section id="movements" aria-label="รายการเคลื่อนไหวเงินสดย่อย" className="rounded-xl border border-border/50 bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-5 py-4">
        <h2 className="text-sm font-semibold">รายการเคลื่อนไหว</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="ประเภทรายการ" className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
                className={cn('min-h-9 rounded-lg px-3 text-sm transition-colors', filter === f.key ? 'bg-card font-semibold text-foreground shadow-sm' : 'font-medium text-muted-foreground hover:text-foreground')}>
                {f.label}
              </button>
            ))}
          </div>
          <NativeSelect aria-label="เดือน" wrapperClassName="w-auto max-w-full" value={month} onChange={(e) => onMonthChange(e.target.value)} className="h-11 rounded-lg border border-input bg-background px-3 text-sm">
            {options.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
              <th scope="col" className="w-[110px] border-b border-border px-4 py-2.5 font-medium">วันที่</th>
              <th scope="col" className="border-b border-border px-4 py-2.5 font-medium">รายการ</th>
              <th scope="col" className="w-[170px] border-b border-border px-4 py-2.5 font-medium">เลขที่รายการ</th>
              <th scope="col" className="w-[120px] border-b border-border px-4 py-2.5 text-right font-medium">เข้า</th>
              <th scope="col" className="w-[120px] border-b border-border px-4 py-2.5 text-right font-medium">ออก</th>
              <th scope="col" className="w-[130px] border-b border-border px-4 py-2.5 text-right font-medium">คงเหลือ</th>
              <th scope="col" className="w-[110px] border-b border-border px-4 py-2.5 font-medium">ผู้ทำ</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">กำลังอ่านสมุดบัญชี…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">{page ? `ไม่มีรายการ${filter === 'ALL' ? '' : 'ชนิดนี้'}ใน${page.month.label}` : 'ไม่มีข้อมูล'}</td></tr>
            )}
            {!loading && rows.map((row) => (
              <tr key={row.id} className="border-b border-border/50 align-top">
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{thDate(row.date)}</td>
                <td className="px-4 py-3"><Description row={row} /></td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">{row.journalEntryNo}</td>
                <td className={cn('px-4 py-3 text-right font-mono tabular-nums', Number(row.inAmount) > 0 ? 'font-medium text-primary' : 'text-muted-foreground')}>{Number(row.inAmount) > 0 ? money(row.inAmount) : '—'}</td>
                <td className={cn('px-4 py-3 text-right font-mono tabular-nums', Number(row.outAmount) > 0 ? '' : 'text-muted-foreground')}>{Number(row.outAmount) > 0 ? money(row.outAmount) : '—'}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">{money(row.balanceAfter)}</td>
                <td className="whitespace-nowrap px-4 py-3">{row.createdByName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
          {page && !loading && (
            <tfoot>
              <tr className="bg-muted/50 text-xs">
                <td colSpan={3} className="px-4 py-2.5 text-muted-foreground">{filter === 'ALL' ? 'รวมเดือนนี้' : 'รวมตามตัวกรอง'} · {rows.length} รายการ · ยอดยกมาต้นเดือน {money(page.opening)}</td>
                <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">{money(totalIn)}</td>
                <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">{money(totalOut)}</td>
                <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">{money(page.closing)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="px-5 py-3 text-xs leading-snug text-muted-foreground">
        ทุกช่องอ่านจากสมุดบัญชี SHOP บัญชี S11-1106 (รายการที่ลงแล้ว) — เท่ากับงบทดลอง (SHOP) · รายการที่ลงแล้วแก้ไม่ได้ ถ้าเติมผิดให้กด "คืนเงินเข้าธนาคาร" ยอดเท่ากัน
      </p>
    </section>
  );
}
