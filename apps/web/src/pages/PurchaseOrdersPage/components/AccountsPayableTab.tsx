import { BookOpenText, ChevronRight, ExternalLink, Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateShort, formatNumberDecimal } from '@/utils/formatters';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, poPaymentStatusMap } from '@/lib/status-badges';
import type { SupplierLedgerMovements, SupplierLedgerResponse, SupplierLedgerRow } from '../types';
import { fieldCls } from './wizard/chrome';

export interface AccountsPayableTabProps {
  ledger: SupplierLedgerResponse | undefined;
  isLoading: boolean;
  /** YYYY-MM */
  month: string;
  setMonth: (month: string) => void;
  selectedSupplierId: string | null;
  onSelectSupplier: (supplierId: string | null) => void;
  movements: SupplierLedgerMovements | undefined;
  movementsLoading: boolean;
  /** เปิดใบสั่งซื้อ (หน้ารายละเอียดมีปุ่มบันทึกการจ่าย) */
  onOpenPo: (poId: string) => void;
}

const money = (v: string | number) => formatNumberDecimal(Number(v) || 0, 2);
const KIND_LABEL: Record<string, string> = {
  RECEIVING: 'รับของ',
  DEPOSIT: 'มัดจำ',
  SETTLEMENT: 'ชำระค่าสินค้า',
  DEPOSIT_APPLIED: 'หักมัดจำเข้าเจ้าหนี้',
  DEPOSIT_REFUND: 'รับเงินมัดจำคืน',
  DEPOSIT_FORFEIT: 'มัดจำไม่ได้คืน',
};
const kindLabel = (kind: string) =>
  KIND_LABEL[kind] ?? (kind.endsWith('_REVERSAL') ? `กลับรายการ ${KIND_LABEL[kind.replace(/_REVERSAL$/, '')] ?? ''}`.trim() : kind);

const DUE_CHIP: Record<SupplierLedgerRow['dueState'], { label: string; cls: string } | null> = {
  OVERDUE: { label: 'เลยกำหนด', cls: 'bg-destructive/10 text-destructive' },
  DUE_SOON: { label: 'ใกล้ครบ', cls: 'bg-warning/10 text-warning-strong' },
  OK: null,
  NONE: null,
};

function Tile({ label, value, hint, tone, testId }: { label: string; value: string; hint: string; tone?: string; testId: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 shadow-sm" data-testid={testId}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn('font-mono text-2xl font-bold tabular-nums', tone)}>{value}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

const thCls = 'px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground';
const tdCls = 'px-3 py-2.5 align-middle';

/**
 * เจ้าหนี้รายผู้จัดจำหน่ายจากสมุดบัญชี (ก้อน 2 · กระดาน 5 · คำตัดสินเจ้าของ 2026-10-05 ข้อ 2): ยอดอ่านจากบรรทัดรายการบัญชี
 * S21-1101 / S21-1102 / S11-4201 ตาม supplierId — ไม่ใช่จากช่อง "จ่ายแล้ว" ของใบ · กดชื่อเพื่อดูรายการเคลื่อนไหว + ใบค้างจ่าย
 */
export function AccountsPayableTab({ ledger, isLoading, month, setMonth, selectedSupplierId, onSelectSupplier, movements, movementsLoading, onOpenPo }: AccountsPayableTabProps) {
  const selected = ledger?.suppliers.find((r) => r.supplier.id === selectedSupplierId) ?? null;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">เจ้าหนี้รายผู้จัดจำหน่าย</h2>
          <p className="text-xs text-muted-foreground">ยอดจากสมุดบัญชีหน้าร้าน (S21-1101 มือถือ · S21-1102 อุปกรณ์เสริม · S11-4201 มัดจำ) — ตรงกับบัญชีแยกประเภททุกบาท</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="ap-month" className="text-xs text-muted-foreground">เดือน</label>
          <input id="ap-month" type="month" className={cn(fieldCls, 'w-44')} value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile testId="tile-closing" label="เจ้าหนี้คงเหลือรวม" value={money(ledger?.totals.closing ?? 0)} tone="text-destructive" hint={`${ledger?.totals.supplierCount ?? 0} ผู้จัดจำหน่าย · ${ledger?.totals.openPoCount ?? 0} ใบค้างจ่าย`} />
        <Tile testId="tile-deposits" label="มัดจำค้าง (ยังไม่รับของ)" value={money(ledger?.totals.depositsOutstanding ?? 0)} tone="text-warning-strong" hint="หักเข้าเจ้าหนี้อัตโนมัติตอนรับของ" />
        <Tile testId="tile-due-soon" label="ครบกำหนดใน 7 วัน" value={money(ledger?.totals.dueWithin7Days ?? 0)} hint="ตามวันครบกำหนดของใบที่ยังจ่ายไม่ครบ" />
        <Tile testId="tile-overdue" label="เลยกำหนด" value={money(ledger?.totals.overdue ?? 0)} tone={Number(ledger?.totals.overdue) > 0 ? 'text-destructive' : 'text-success'} hint={Number(ledger?.totals.overdue) > 0 ? 'ต้องจ่าย' : '—'} />
      </div>

      {isLoading && !ledger && <div className="py-12 text-center text-muted-foreground">กำลังอ่านสมุดบัญชี…</div>}

      {ledger && ledger.suppliers.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">ไม่มีรายการเจ้าหนี้ในเดือนนี้ — ยังไม่มีการรับของหรือจ่ายเงินผู้จัดจำหน่ายในสมุดบัญชี</div>
      )}

      {ledger && ledger.suppliers.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border/50 bg-card shadow-sm">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className={thCls}>ผู้จัดจำหน่าย</th>
                <th className={cn(thCls, 'text-right')}>ยกมาต้นเดือน</th>
                <th className={cn(thCls, 'text-right')}>รับของ (+)</th>
                <th className={cn(thCls, 'text-right')}>จ่าย (−)</th>
                <th className={cn(thCls, 'text-right')}>เจ้าหนี้คงเหลือ</th>
                <th className={cn(thCls, 'text-right')}>มัดจำค้าง</th>
                <th className={cn(thCls, 'text-right')}>PO ค้าง</th>
                <th className={thCls}>ครบกำหนดถัดไป</th>
                <th className={thCls}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {ledger.suppliers.map((row) => {
                const chip = DUE_CHIP[row.dueState];
                const active = row.supplier.id === selectedSupplierId;
                return (
                  <tr key={row.supplier.id} aria-label={row.supplier.name} className={cn('hover:bg-muted/30', active && 'bg-primary/5')}>
                    <td className={tdCls}>
                      <button type="button" onClick={() => onSelectSupplier(active ? null : row.supplier.id)} className="text-left font-semibold text-primary hover:underline">
                        {row.supplier.name}
                      </button>
                      <div className="text-xs text-muted-foreground">
                        {row.supplier.hasVat ? 'จด VAT' : 'ไม่จด VAT'}
                        {Object.keys(row.payableByAccount).length > 0 && ` · ${Object.keys(row.payableByAccount).join(' / ')}`}
                      </div>
                    </td>
                    <td className={cn(tdCls, 'text-right font-mono tabular-nums')}>{money(row.opening)}</td>
                    <td className={cn(tdCls, 'text-right font-mono tabular-nums')}>{money(row.receipts)}</td>
                    <td className={cn(tdCls, 'text-right font-mono tabular-nums')}>{money(row.payments)}</td>
                    <td className={cn(tdCls, 'text-right font-mono font-semibold tabular-nums', Number(row.closing) > 0 ? 'text-destructive' : 'text-success')}>{money(row.closing)}</td>
                    <td className={cn(tdCls, 'text-right font-mono tabular-nums', Number(row.depositsOutstanding) > 0 && 'text-warning-strong')}>{money(row.depositsOutstanding)}</td>
                    <td className={cn(tdCls, 'text-right font-mono tabular-nums')}>{row.openPoCount}</td>
                    <td className={tdCls}>
                      {row.nextDue ? (
                        <span className="inline-flex items-center gap-1.5">
                          {formatDateShort(row.nextDue)}
                          {chip && <span className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-semibold', chip.cls)}>{chip.label}</span>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className={cn(tdCls, 'text-right')}>
                      <button type="button" onClick={() => onSelectSupplier(active ? null : row.supplier.id)} aria-label={`ดูรายการ ${row.supplier.name}`} className="rounded-lg border border-border bg-card p-1.5 text-muted-foreground hover:bg-accent">
                        <ChevronRight className={cn('size-4 transition-transform', active && 'rotate-90')} aria-hidden />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="grid gap-4 lg:grid-cols-5">
          <section className="rounded-xl border border-border/50 bg-card p-4 shadow-sm lg:col-span-3" aria-label={`รายการเคลื่อนไหว · ${selected.supplier.name}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BookOpenText className="size-4 text-info" aria-hidden />
                <span className="text-sm font-semibold">รายการเคลื่อนไหว · {selected.supplier.name}</span>
              </div>
              <span className="text-xs text-muted-foreground">ยกมา {money(movements?.opening ?? selected.opening)}</span>
            </div>
            {movementsLoading && !movements && <p className="text-xs text-muted-foreground">กำลังอ่าน…</p>}
            {movements && movements.rows.length === 0 && <p className="text-xs text-muted-foreground">ไม่มีรายการในเดือนนี้</p>}
            {movements && movements.rows.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="py-1.5 text-left font-medium">วันที่</th>
                    <th className="py-1.5 text-left font-medium">รายการ</th>
                    <th className="py-1.5 text-left font-medium">อ้างอิง</th>
                    <th className="py-1.5 text-right font-medium">เพิ่มเจ้าหนี้</th>
                    <th className="py-1.5 text-right font-medium">ลดเจ้าหนี้</th>
                    <th className="py-1.5 text-right font-medium">คงเหลือ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {movements.rows.map((r) => (
                    <tr key={r.journalEntryId}>
                      <td className="py-1.5 font-mono text-xs tabular-nums">{formatDateShort(r.entryDate)}</td>
                      <td className="py-1.5">
                        <div className="font-medium">{kindLabel(r.kind)}</div>
                        <div className="text-xs text-muted-foreground">{[r.poNumber, r.grNumber].filter(Boolean).join(' · ')}{Number(r.depositChange) !== 0 ? ` · มัดจำ ${Number(r.depositChange) > 0 ? '+' : ''}${money(r.depositChange)}` : ''}</div>
                      </td>
                      <td className="py-1.5 font-mono text-xs">{r.entryNumber}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{Number(r.payableIncrease) > 0 ? money(r.payableIncrease) : ''}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{Number(r.payableDecrease) > 0 ? money(r.payableDecrease) : ''}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{money(r.running)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mt-3 text-right text-sm font-semibold">คงเหลือ {money(movements?.closing ?? selected.closing)}</div>
          </section>

          <section className="rounded-xl border border-border/50 bg-card p-4 shadow-sm lg:col-span-2" aria-label={`ใบสั่งซื้อค้างจ่าย · ${selected.supplier.name}`}>
            <div className="mb-3 flex items-center gap-2">
              <Landmark className="size-4 text-success" aria-hidden />
              <span className="text-sm font-semibold">ใบสั่งซื้อค้างจ่าย</span>
            </div>
            {selected.openPos.length === 0 && <p className="text-xs text-muted-foreground">ไม่มีใบค้างจ่าย</p>}
            <ul className="divide-y divide-border/40">
              {selected.openPos.map((po) => {
                const cfg = getStatusBadgeProps(po.paymentStatus, poPaymentStatusMap);
                return (
                  <li key={po.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <div className="font-mono text-sm font-semibold">{po.poNumber}</div>
                      <div className="text-xs text-muted-foreground">
                        คงค้าง <span className="font-mono tabular-nums text-destructive">{money(po.remaining)}</span> / {money(po.netAmount)}
                        {po.dueDate ? ` · ครบกำหนด ${formatDateShort(po.dueDate)}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={cfg.variant} appearance={cfg.appearance}>{cfg.label}</Badge>
                      <button type="button" onClick={() => onOpenPo(po.id)} className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium hover:bg-accent" aria-label={`เปิดใบ ${po.poNumber}`}>
                        <ExternalLink className="size-3.5" aria-hidden />
                        เปิดใบ
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">บันทึกการจ่ายจากปุ่ม "บันทึกการจ่าย" ในใบ — ทุกการจ่ายลงบัญชีและกลับมาแสดงที่นี่</p>
          </section>
        </div>
      )}
    </div>
  );
}
