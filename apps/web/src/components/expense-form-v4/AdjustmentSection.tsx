// Section 5 — Multi-line Adjustment (Fix Report v1.0 P0-4).
//
// Renders when the user wants to reconcile a `amountPaid ≠ totalAmount − wht`
// diff with explicit per-account Dr/Cr postings (rounding tolerance, overpay,
// underpay, small vendor discounts). Each row carries its own `side`.
//
// Server-side V12/V13/V14 enforce that Σ signed(adjustments) closes the gap.
// This component shows the live signed sum + diff so the user can self-check
// before POST.

import { Plus, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { ExpenseAdjustmentForm } from './types';
import { newAdjustment } from './types';

interface Props {
  /** Reconciliation diff = amountPaid − (totalAmount − wht). Sign decides side. */
  diff: string;
  amountPaid: string;
  onAmountPaidChange: (value: string) => void;
  adjustments: ExpenseAdjustmentForm[];
  onChange: (rows: ExpenseAdjustmentForm[]) => void;
  /** Suggested account codes (rounding-tolerance + discount accounts, etc.) */
  suggestedAccounts?: Array<{ code: string; name: string; defaultSide: 'DR' | 'CR' }>;
  /** Sum of items + VAT − WHT — shown for context */
  netExpected: string;
}

const DEFAULT_SUGGESTED: Array<{ code: string; name: string; defaultSide: 'DR' | 'CR' }> = [
  { code: '53-1503', name: 'กำไร/ขาดทุน-สุทธิปัดเศษ', defaultSide: 'CR' },
  { code: '52-1104', name: 'ส่วนลดไม่จ่ายเศษสตางค์', defaultSide: 'DR' },
];

const D = (s: string) => {
  const n = parseFloat(s || '0');
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function AdjustmentSection({
  diff,
  amountPaid,
  onAmountPaidChange,
  adjustments,
  onChange,
  suggestedAccounts = DEFAULT_SUGGESTED,
  netExpected,
}: Props) {
  const diffNum = D(diff);
  const adjustmentsActive = adjustments.length > 0 || Math.abs(diffNum) > 0.005;

  // Signed sum: side='CR' → +amount, side='DR' → −amount. This must equal diff.
  const signedSum = adjustments.reduce<number>(
    (s, a) => (a.side === 'CR' ? s + D(a.amount) : s - D(a.amount)),
    0,
  );
  const reconciled = round2(Math.abs(signedSum - diffNum)) < 0.005;
  const remaining = round2(diffNum - signedSum);

  const addRow = () => {
    // Pre-fill side based on diff sign: positive diff (overpay) → Cr suggested.
    const suggested = diffNum >= 0 ? 'CR' : 'DR';
    onChange([...adjustments, newAdjustment({ side: suggested })]);
  };

  const updateRow = (uid: string, patch: Partial<ExpenseAdjustmentForm>) => {
    onChange(adjustments.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  };

  const removeRow = (uid: string) => {
    onChange(adjustments.filter((r) => r.uid !== uid));
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3 mb-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary text-sm font-bold">
          5
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">บัญชีปรับผลต่าง (Multi-line)</h2>
          <p className="text-xs text-muted-foreground">
            ใช้เมื่อจำนวนเงินที่จ่ายจริงไม่ตรงกับยอดที่ใบกำกับฯ ระบุ (ปัดเศษ / ส่วนลดเล็กน้อย / จ่ายเกิน / จ่ายน้อย)
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            ยอดที่จ่ายจริง (amount paid)
          </label>
          <input
            type="number"
            step="0.01"
            value={amountPaid}
            onChange={(e) => onAmountPaidChange(e.target.value)}
            placeholder={netExpected}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="mt-1 text-xs text-muted-foreground">ปล่อยว่าง = ใช้ค่า default {netExpected}</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            ยอดที่ใบกำกับฯ ระบุ (net expected = total − WHT)
          </label>
          <div className="rounded-md bg-muted px-3 py-2 text-sm font-mono tabular-nums text-foreground">
            {netExpected || '0.00'}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            ผลต่างที่ต้องปรับ (diff)
          </label>
          <div
            className={`rounded-md px-3 py-2 text-sm font-mono tabular-nums ${
              Math.abs(diffNum) < 0.005
                ? 'bg-muted text-muted-foreground'
                : diffNum > 0
                  ? 'bg-success/10 text-success'
                  : 'bg-warning/10 text-warning'
            }`}
          >
            {diffNum >= 0 ? '+' : ''}
            {diffNum.toFixed(2)}
            {diffNum > 0.005 && ' (จ่ายเกิน → Cr)'}
            {diffNum < -0.005 && ' (จ่ายน้อย → Dr)'}
          </div>
        </div>
      </div>

      {adjustmentsActive && (
        <>
          <div className="space-y-2 mb-3">
            {adjustments.map((row, idx) => (
              <div
                key={row.uid}
                className="grid grid-cols-12 gap-2 items-start rounded-lg border border-border bg-muted/30 p-3"
              >
                <div className="col-span-12 md:col-span-5">
                  <label className="block text-xs text-muted-foreground mb-1">
                    บัญชี #{idx + 1}
                  </label>
                  <select
                    value={row.accountCode}
                    onChange={(e) => {
                      const code = e.target.value;
                      const match = suggestedAccounts.find((s) => s.code === code);
                      updateRow(row.uid, {
                        accountCode: code,
                        side: match?.defaultSide ?? row.side,
                      });
                    }}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">— เลือกบัญชี —</option>
                    {suggestedAccounts.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-4 md:col-span-2">
                  <label className="block text-xs text-muted-foreground mb-1">Dr/Cr</label>
                  <select
                    value={row.side}
                    onChange={(e) =>
                      updateRow(row.uid, { side: e.target.value as 'DR' | 'CR' })
                    }
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="DR">Dr</option>
                    <option value="CR">Cr</option>
                  </select>
                </div>
                <div className="col-span-4 md:col-span-2">
                  <label className="block text-xs text-muted-foreground mb-1">จำนวน</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.amount}
                    onChange={(e) => updateRow(row.uid, { amount: e.target.value })}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="col-span-3 md:col-span-2">
                  <label className="block text-xs text-muted-foreground mb-1">หมายเหตุ</label>
                  <input
                    type="text"
                    value={row.note}
                    onChange={(e) => updateRow(row.uid, { note: e.target.value })}
                    placeholder="ปัดเศษ / ส่วนลด..."
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="col-span-1 flex items-end justify-end pt-5">
                  <button
                    type="button"
                    onClick={() => removeRow(row.uid)}
                    aria-label={`ลบบัญชีปรับ #${idx + 1}`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              <Plus size={14} />
              เพิ่มบัญชีปรับ
            </button>
            <div
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ${
                reconciled
                  ? 'bg-success/10 text-success'
                  : 'bg-destructive/10 text-destructive'
              }`}
              role="status"
              aria-live="polite"
            >
              {reconciled ? (
                <>
                  <CheckCircle2 size={14} />
                  ผลต่างปรับครบ ({signedSum >= 0 ? '+' : ''}
                  {signedSum.toFixed(2)} = {diffNum.toFixed(2)})
                </>
              ) : (
                <>
                  <AlertCircle size={14} />
                  V12: ยังขาด {remaining >= 0 ? '+' : ''}
                  {remaining.toFixed(2)} (ผลรวม signed = {signedSum.toFixed(2)})
                </>
              )}
            </div>
          </div>
        </>
      )}

      {!adjustmentsActive && (
        <div className="flex items-center justify-between rounded-md border border-dashed border-border bg-muted/20 px-4 py-3 text-sm">
          <span className="text-muted-foreground">ไม่มีผลต่าง — ไม่ต้องเพิ่มบัญชีปรับ</span>
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1 text-xs hover:bg-accent"
          >
            <Plus size={12} />
            เพิ่มแบบ manual
          </button>
        </div>
      )}
    </section>
  );
}
