import { Plus, Trash2, Users } from 'lucide-react';
import { PettyCashFormFields, newPettyCashLine } from './types';
import { formatNumberDecimal } from '@/utils/formatters';

interface Props {
  value: PettyCashFormFields;
  onChange: (v: PettyCashFormFields) => void;
}

/**
 * C1.6 — Petty Cash Reimbursement form section.
 *
 * Mockup 04B layout. Per-line: supplier name, category, description, amount,
 * VAT%, tax invoice no. NO WHT (small-cash scope — vendors with WHT use
 * regular EXPENSE flow). Limit + cash account live in CashAccountVisualPicker
 * + system_config.
 */
export function PettyCashLinesSection({ value, onChange }: Props) {
  const updateField = (patch: Partial<PettyCashFormFields>) => onChange({ ...value, ...patch });

  const updateLine = (uid: string, p: Partial<(typeof value.lines)[number]>) => {
    onChange({ ...value, lines: value.lines.map((l) => (l.uid === uid ? { ...l, ...p } : l)) });
  };
  const removeLine = (uid: string) => {
    if (value.lines.length === 1) return;
    onChange({ ...value, lines: value.lines.filter((l) => l.uid !== uid) });
  };
  const addLine = () => onChange({ ...value, lines: [...value.lines, newPettyCashLine()] });

  const computed = value.lines.map((l) => {
    const base = parseFloat(l.amount) || 0;
    const vatPct = parseFloat(l.vatPercent) || 0;
    const vat = Math.round(base * vatPct) / 100;
    return { ...l, baseN: base, vatN: vat, totalN: base + vat };
  });
  const sumBase = computed.reduce((s, l) => s + l.baseN, 0);
  const sumVat = computed.reduce((s, l) => s + l.vatN, 0);
  const sumTotal = sumBase + sumVat;

  // Distinct supplier count — surfaced in the JE metadata + voucher PDF.
  const supplierCount = new Set(
    value.lines.map((l) => l.supplierName.trim()).filter(Boolean),
  ).size;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1 text-muted-foreground">
            ผู้ดูแลเงินสดย่อย (custodian) — ทางเลือก
          </label>
          <div className="relative">
            <Users className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              value={value.custodianName}
              onChange={(e) => updateField({ custodianName: e.target.value })}
              placeholder="ชื่อพนักงานที่ดูแลเงินสดย่อย"
              className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
        <div className="flex items-end text-xs text-muted-foreground">
          <span>
            {value.lines.length} รายการ · {supplierCount} ผู้ขาย · รวม {formatNumberDecimal(sumTotal.toString(), 2)} ฿
          </span>
        </div>
      </div>

      {/* Lines */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-2 py-2 w-8">#</th>
              <th className="px-2 py-2 min-w-[160px]">ผู้ขาย/ผู้รับเงิน</th>
              <th className="px-2 py-2 min-w-[110px]">หมวดบัญชี</th>
              <th className="px-2 py-2 min-w-[140px]">รายละเอียด</th>
              <th className="px-2 py-2 min-w-[100px] text-right">จำนวน</th>
              <th className="px-2 py-2 w-[80px] text-right">VAT %</th>
              <th className="px-2 py-2 min-w-[120px]">เลขใบกำกับฯ</th>
              <th className="px-2 py-2 w-[100px] text-right">รวม</th>
              <th className="px-2 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {computed.map((l, idx) => (
              <tr key={l.uid} className="border-t border-border">
                <td className="px-2 py-1.5 text-xs text-muted-foreground tabular-nums">{idx + 1}</td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={l.supplierName}
                    onChange={(e) => updateLine(l.uid, { supplierName: e.target.value })}
                    placeholder="ชื่อผู้ขาย/ผู้รับเงิน"
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={l.category}
                    onChange={(e) => updateLine(l.uid, { category: e.target.value })}
                    placeholder="53-1xxx"
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={l.description}
                    onChange={(e) => updateLine(l.uid, { description: e.target.value })}
                    placeholder="รายละเอียด"
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={l.amount}
                    onChange={(e) => updateLine(l.uid, { amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={l.vatPercent}
                    onChange={(e) => updateLine(l.uid, { vatPercent: e.target.value })}
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="0">0</option>
                    <option value="7">7</option>
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={l.taxInvoiceNo}
                    onChange={(e) => updateLine(l.uid, { taxInvoiceNo: e.target.value })}
                    placeholder="ทางเลือก"
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </td>
                <td className="px-2 py-1.5 text-right text-sm tabular-nums text-muted-foreground">
                  {formatNumberDecimal(l.totalN.toString(), 2)}
                </td>
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => removeLine(l.uid)}
                    disabled={value.lines.length === 1}
                    aria-label={`ลบรายการ #${idx + 1}`}
                    className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-muted/20">
            <tr className="text-sm">
              <td colSpan={4} className="px-2 py-2 text-right text-muted-foreground">
                รวม
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {formatNumberDecimal(sumBase.toString(), 2)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                {formatNumberDecimal(sumVat.toString(), 2)}
              </td>
              <td></td>
              <td className="px-2 py-2 text-right tabular-nums font-medium">
                {formatNumberDecimal(sumTotal.toString(), 2)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div>
        <button
          type="button"
          onClick={addLine}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          <Plus size={14} />
          เพิ่มรายการ
        </button>
      </div>
    </div>
  );
}
