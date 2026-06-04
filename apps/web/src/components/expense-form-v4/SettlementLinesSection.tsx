import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { SettlementFormFields } from './types';
import { formatNumberDecimal } from '@/utils/formatters';
import { useUiFlags } from '@/hooks/useUiFlags';
import { VendorCombobox } from './VendorCombobox';

/**
 * D1.3.6.2 — A bill is treated as "overdue" if its `documentDate` is older
 * than 30 days from now. ExpenseDocument has no per-row due-date column, so
 * this single net-30 heuristic is the best proxy without a schema change.
 * The threshold lives here (not SystemConfig) because it's a UI-only sort
 * hint — server doesn't act on it.
 */
const OVERDUE_DAYS = 30;

interface AccrualDoc {
  id: string;
  number: string;
  vendorName: string | null;
  totalAmount: string;
  documentDate: string;
  status: string;
  branch: { id: string; name: string };
}

interface Props {
  branchId: string;
  value: SettlementFormFields;
  onChange: (v: SettlementFormFields) => void;
}

export function SettlementLinesSection({ branchId, value, onChange }: Props) {
  // D1.3.6.2 — OWNER-configurable pre-tick preference.
  // D1.3.6.1 — `settlement_max_bills_per_doc` (default 100). One fetch limit
  // matches the server-enforced cap so the user can never tick a doc the
  // server would reject. UI also surfaces a soft warning before the cap.
  // D1.3.6.3 — when partial-payment is disabled, the user can only clear
  // each bill at its full totalAmount. Force the input read-only + reset
  // the per-row amount when ticked.
  const { settlementDefaultTick, settlementMaxBillsPerDoc, settlementPartialPaymentEnabled } =
    useUiFlags();
  const { data: accrualList } = useQuery<{ data: AccrualDoc[] }>({
    queryKey: ['accrual-list', branchId, settlementMaxBillsPerDoc],
    queryFn: async () => {
      if (!branchId) return { data: [] };
      const res = await api.get(
        `/expense-documents?type=EXPENSE&status=ACCRUAL&branchId=${branchId}&limit=${settlementMaxBillsPerDoc}`,
      );
      return res.data;
    },
    enabled: !!branchId,
  });

  const docs = accrualList?.data ?? [];
  // D1.3.6.1 — warn at 80% of cap to give the user a heads-up before hitting
  // the hard limit. Threshold floor of 1 ensures the warning never fires at
  // capacity = 1 (the legitimate min).
  const selectedCount = value.selections.size;
  const warnThreshold = Math.max(1, Math.floor(settlementMaxBillsPerDoc * 0.8));
  const showApproachingCap = selectedCount >= warnThreshold && selectedCount <= settlementMaxBillsPerDoc;
  const exceedsCap = selectedCount > settlementMaxBillsPerDoc;

  // D1.3.6.2 — pre-tick the bill list according to the OWNER's preference.
  // Runs once per (branch + docs payload) so it doesn't fight the user's
  // manual toggles afterwards. `appliedKeyRef` stores the last (branchId,
  // mode, docs-hash) signature; we only auto-tick when that signature
  // changes, never when `value.selections` mutates.
  //
  // `docsKey` is a stable hash of doc IDs (not `docs.length`) so a same-
  // length swap (e.g. one bill paid + one new bill arrives) still re-runs
  // the auto-tick logic against the new set. Otherwise the ref short-
  // circuits and newly-arrived overdue bills would silently skip pre-tick.
  const docsKey = useMemo(() => docs.map((d) => d.id).join('|'), [docs]);
  const appliedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!branchId) return;
    if (docs.length === 0) return;
    const key = `${branchId}|${settlementDefaultTick}|${docsKey}`;
    if (appliedKeyRef.current === key) return;
    appliedKeyRef.current = key;
    if (settlementDefaultTick === 'none') {
      return; // 'none' means caller-supplied default (empty Map) stays
    }
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - OVERDUE_DAYS);
    const pre = new Map(value.selections);
    let added = 0;
    for (const doc of docs) {
      if (pre.has(doc.id)) continue;
      const shouldTick =
        settlementDefaultTick === 'all' ||
        (settlementDefaultTick === 'overdue_only' && new Date(doc.documentDate) < cutoff);
      if (shouldTick) {
        pre.set(doc.id, { docId: doc.id, amount: doc.totalAmount });
        added += 1;
      }
    }
    if (added > 0) onChange({ ...value, selections: pre });
    // We intentionally exclude `value` + `onChange` from deps: the effect
    // should only re-fire on docs/branch/preference change, not when the
    // user toggles a row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, settlementDefaultTick, docsKey]);

  // D1.3.6.3 — when partial-payment is OFF, force every selected line back to
  // its full `totalAmount`. Handles the corner case where the form already
  // held partials (flag was on earlier) and the OWNER flipped the policy
  // mid-session — without this snap the disabled input + persisted value
  // could disagree.
  useEffect(() => {
    if (settlementPartialPaymentEnabled) return;
    if (docs.length === 0 || value.selections.size === 0) return;
    let mutated = false;
    const next = new Map(value.selections);
    for (const doc of docs) {
      const sel = next.get(doc.id);
      if (sel && sel.amount !== doc.totalAmount) {
        next.set(doc.id, { ...sel, amount: doc.totalAmount });
        mutated = true;
      }
    }
    if (mutated) onChange({ ...value, selections: next });
    // Excludes `value`/`onChange` so this only fires on flag/docs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlementPartialPaymentEnabled, docs]);

  const toggle = (doc: AccrualDoc) => {
    const next = new Map(value.selections);
    if (next.has(doc.id)) {
      next.delete(doc.id);
    } else {
      next.set(doc.id, { docId: doc.id, amount: doc.totalAmount });
    }
    onChange({ ...value, selections: next });
  };

  const updateAmount = (docId: string, amount: string) => {
    const next = new Map(value.selections);
    const cur = next.get(docId);
    if (cur) next.set(docId, { ...cur, amount });
    onChange({ ...value, selections: next });
  };

  const sumSelected = [...value.selections.values()].reduce(
    (s, sel) => s + (parseFloat(sel.amount) || 0),
    0,
  );
  const whtN = parseFloat(value.whtAmount) || 0;
  const cashLeg = sumSelected - whtN;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">
            ผู้รับเงิน (ถ้ารวมเจ้าหนี้คนเดียว)
          </label>
          <VendorCombobox
            value={value.vendorName}
            onSelectSupplier={(s) => onChange({ ...value, vendorName: s.name })}
            onTypeName={(name) => onChange({ ...value, vendorName: name })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">หัก ณ ที่จ่าย</label>
          <div className="flex gap-2">
            <select
              value={value.whtFormType}
              onChange={(e) =>
                onChange({ ...value, whtFormType: e.target.value as 'PND3' | 'PND53' | '' })
              }
              className="px-3 py-2 border border-input rounded-lg text-sm bg-background"
            >
              <option value="">ไม่ระบุ</option>
              <option value="PND53">ภงด.53</option>
              <option value="PND3">ภงด.3</option>
            </select>
            <input
              type="number"
              step="0.01"
              value={value.whtAmount}
              onChange={(e) => onChange({ ...value, whtAmount: e.target.value })}
              placeholder="ยอด WHT"
              className="flex-1 px-3 py-2 border border-input rounded-lg text-sm bg-background text-right font-mono"
            />
          </div>
        </div>
      </div>

      {!settlementPartialPaymentEnabled && (
        <div
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-snug text-amber-700"
          role="status"
          aria-live="polite"
        >
          การชำระบางส่วนถูกปิดในการตั้งค่าระบบ — ทุกใบที่เลือกจะถูกล็อกที่ยอดเต็ม
        </div>
      )}

      {(showApproachingCap || exceedsCap) && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs leading-snug ${
            exceedsCap
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-700'
          }`}
          role="status"
          aria-live="polite"
        >
          {exceedsCap
            ? `เลือกใบเกินจำกัด ${settlementMaxBillsPerDoc} ใบต่อเอกสาร (เลือก ${selectedCount}) — กรุณาแยกเป็นหลายเอกสาร`
            : `ใกล้ถึงจำกัด ${settlementMaxBillsPerDoc} ใบต่อเอกสาร (เลือกแล้ว ${selectedCount})`}
        </div>
      )}

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="bg-muted/50 px-4 py-2 text-xs font-medium border-b border-border">
          เจ้าหนี้คงค้างของสาขา ({docs.length} รายการรอจ่าย — เลือกที่ต้องการเคลียร์ สูงสุด {settlementMaxBillsPerDoc} ใบ/เอกสาร)
        </div>
        {docs.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            ไม่มีเจ้าหนี้คงค้างในสาขานี้
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="w-10 p-2"></th>
                  <th className="text-left p-2">เลขเอกสาร</th>
                  <th className="text-left p-2">ผู้ขาย</th>
                  <th className="text-right p-2">ยอดรวม</th>
                  <th className="text-right p-2">จำนวนที่จ่าย</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => {
                  const isSelected = value.selections.has(doc.id);
                  const sel = value.selections.get(doc.id);
                  return (
                    <tr
                      key={doc.id}
                      className={`border-b border-border/50 ${isSelected ? 'bg-primary/5' : ''}`}
                    >
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(doc)}
                          className="size-4 accent-primary"
                        />
                      </td>
                      <td className="p-2 font-mono text-sm">{doc.number}</td>
                      <td className="p-2">{doc.vendorName ?? '—'}</td>
                      <td className="p-2 text-right font-mono">
                        {formatNumberDecimal(doc.totalAmount)}
                      </td>
                      <td className="p-1.5 text-right">
                        {isSelected &&
                          (settlementPartialPaymentEnabled ? (
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              value={sel!.amount}
                              onChange={(e) => updateAmount(doc.id, e.target.value)}
                              className="w-32 px-2 py-1 border border-input rounded text-sm bg-background text-right font-mono inline-block"
                            />
                          ) : (
                            // D1.3.6.3 OFF — locked to full totalAmount. Show as
                            // disabled input + matching value so the column lines
                            // up with the unlocked layout. Title surfaces the policy
                            // reason for keyboard / a11y users.
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              value={doc.totalAmount}
                              readOnly
                              disabled
                              title="การชำระบางส่วนถูกปิดในการตั้งค่าระบบ — ต้องชำระเต็มจำนวน"
                              aria-label={`ยอดที่จ่ายของ ${doc.number} ล็อกที่ยอดเต็ม`}
                              className="w-32 px-2 py-1 border border-input rounded text-sm bg-muted text-right font-mono inline-block cursor-not-allowed opacity-70"
                            />
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {value.selections.size > 0 && (
          <div className="bg-muted/30 px-4 py-3 border-t border-border space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">รวมยอดที่จ่าย</span>
              <span className="font-mono font-medium">{formatNumberDecimal(sumSelected)}</span>
            </div>
            {whtN > 0 && (
              <div className="flex items-center justify-between text-destructive">
                <span>หัก ณ ที่จ่าย</span>
                <span className="font-mono font-medium">({formatNumberDecimal(whtN)})</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-primary/20 pt-2 font-bold">
              <span className="text-primary">ตัดเงินสดสุทธิ</span>
              <span className="text-primary font-mono">{formatNumberDecimal(cashLeg)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
