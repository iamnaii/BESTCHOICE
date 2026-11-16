import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { NumberInput } from '@/components/ui/NumberInput';
import { NameAutocomplete } from '@/components/ui/NameAutocomplete';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { formControlClass } from '@/components/ui/form-styles';
import { AccountSearchDropdown } from '@/pages/other-income/components/AccountSearchDropdown';
import { useUserNames } from '@/hooks/useUserNames';
import { formatNumberDecimal } from '@/utils/formatters';
import { cn } from '@/lib/utils';
import { PettyCashFormFields, newPettyCashLine } from './types';
import { pettyCashTotals } from './petty-cash-totals';
import { VendorCombobox } from './VendorCombobox';

interface Props {
  value: PettyCashFormFields;
  onChange: (v: PettyCashFormFields) => void;
}

/** ผู้ดูแลเงินสดย่อย — แถวของตัวเองในหน้า (ชื่อแถวเป็นป้ายที่มองเห็น) */
export function PettyCashCustodianField({ value, onChange }: Props) {
  const custodianId = useId();
  const custodianNames = useUserNames();
  return (
    <div className="w-full sm:max-w-md">
      <label htmlFor={custodianId} className="sr-only">ผู้ดูแลเงินสดย่อย</label>
      <NameAutocomplete
        id={custodianId}
        value={value.custodianName}
        onChange={(v) => onChange({ ...value, custodianName: v })}
        options={custodianNames}
        placeholder="ชื่อพนักงานที่ดูแลเงินสดย่อย"
      />
      <p className="mt-1.5 text-xs leading-snug text-muted-foreground">ไม่บังคับ</p>
    </div>
  );
}

/**
 * C1.6 — รายการเงินสดย่อย · ต่อบรรทัด: ผู้ขาย, หมวดบัญชี, รายละเอียด, จำนวน, VAT %, เลขใบกำกับฯ
 * ไม่มีภาษีหัก ณ ที่จ่าย (ผู้ขายที่ต้องหักใช้เอกสารรายจ่ายปกติ)
 * สัดส่วนคอลัมน์แบบตารางรายจ่าย: ตัวเลขแถวบน · เลขใบกำกับฯ กับรายละเอียดอยู่แถวล่าง
 */
export function PettyCashLinesSection({ value, onChange }: Props) {
  const updateLine = (uid: string, p: Partial<(typeof value.lines)[number]>) => {
    onChange({ ...value, lines: value.lines.map((l) => (l.uid === uid ? { ...l, ...p } : l)) });
  };
  const removeLine = (uid: string) => {
    if (value.lines.length === 1) return;
    onChange({ ...value, lines: value.lines.filter((l) => l.uid !== uid) });
  };
  const addLine = () => onChange({ ...value, lines: [...value.lines, newPettyCashLine()] });

  const totals = pettyCashTotals(value);
  const money = (n: number) => formatNumberDecimal(n.toString(), 2);

  const cell = 'px-[3px] py-1.5 align-top';
  const head = 'px-2 py-2.5 text-xs font-semibold leading-snug text-muted-foreground whitespace-nowrap';
  const foot = 'px-2 py-2.5 text-right tabular-nums';

  return (
    <div className="space-y-3">
      {/* relative: ทุกอย่างในตารางต้องถูกตัดอยู่ในกล่องเลื่อนนี้ (จอเล็กเลื่อนแนวนอน) */}
      <div className="relative overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[52rem] table-fixed text-sm">
          <colgroup>
            <col className="w-6" />
            <col className="w-52" />
            <col />
            <col className="w-28" />
            <col className="w-20" />
            <col className="w-24" />
            <col className="w-11" />
          </colgroup>
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className={cn(head, 'text-center')}>#</th>
              <th scope="col" className={cn(head, 'text-left')}>ผู้ขาย/ผู้รับเงิน / เลขใบกำกับฯ</th>
              <th scope="col" className={cn(head, 'text-left')}>หมวดบัญชี / รายละเอียด</th>
              <th scope="col" className={cn(head, 'text-right')}>จำนวน</th>
              <th scope="col" className={cn(head, 'text-right')}>VAT %</th>
              <th scope="col" className={cn(head, 'text-right')}>รวม</th>
              <th scope="col" aria-label="ลบ" className={head} />
            </tr>
          </thead>
          {value.lines.map((l, idx) => (
            <tbody key={l.uid} className="border-t border-border">
              <tr>
                <td rowSpan={2} className={cn(cell, 'pt-4 text-center text-xs tabular-nums text-muted-foreground')}>
                  {idx + 1}
                </td>
                <td className={cell}>
                  <VendorCombobox
                    value={l.supplierName}
                    onSelectSupplier={(s) => updateLine(l.uid, { supplierName: s.name, supplierId: s.supplierId })}
                  />
                </td>
                <td className={cell}>
                  <AccountSearchDropdown
                    aria-label="หมวดบัญชี"
                    value={l.category}
                    onChange={(code) => updateLine(l.uid, { category: code })}
                    filter={(a) => a.code.startsWith('53-')}
                    placeholder="เลือกหมวดบัญชี"
                  />
                </td>
                <td className={cell}>
                  <NumberInput unstyled
                    aria-label="จำนวน"
                    step="0.01"
                    min="0"
                    value={l.amount}
                    onChange={(e) => updateLine(l.uid, { amount: e.target.value })}
                    placeholder="0.00"
                    className={cn(formControlClass, 'px-2 text-right tabular-nums')}
                  />
                </td>
                <td className={cell}>
                  <Select value={l.vatPercent} onValueChange={(v) => updateLine(l.uid, { vatPercent: v })}>
                    <SelectTrigger aria-label="VAT %" className="h-11 w-full px-2">
                      <span className="tabular-nums">{l.vatPercent}%</span>
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="0">0%</SelectItem>
                      <SelectItem value="7">7%</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className={cn(cell, 'px-2 pt-4 text-right font-medium tabular-nums')}>
                  {money(totals.lines[idx].total)}
                </td>
                <td rowSpan={2} className={cn(cell, 'px-0')}>
                  <button data-ui-control="button" data-ui-icon="true"
                    type="button"
                    onClick={() => removeLine(l.uid)}
                    disabled={value.lines.length === 1}
                    aria-label={`ลบรายการ #${idx + 1}`}
                    className="flex min-h-11 w-full items-center justify-center rounded-md text-muted-foreground hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>
              <tr>
                <td className={cn(cell, 'pt-0 pb-2.5')}>
                  <input
                    type="text"
                    aria-label="เลขใบกำกับฯ"
                    value={l.taxInvoiceNo}
                    onChange={(e) => updateLine(l.uid, { taxInvoiceNo: e.target.value })}
                    placeholder="เลขใบกำกับฯ"
                    className={formControlClass}
                  />
                </td>
                <td className={cn(cell, 'pt-0 pb-2.5')}>
                  <input
                    type="text"
                    aria-label="รายละเอียด"
                    value={l.description}
                    onChange={(e) => updateLine(l.uid, { description: e.target.value })}
                    placeholder="รายละเอียด"
                    className={formControlClass}
                  />
                </td>
                <td colSpan={3} />
              </tr>
            </tbody>
          ))}
          <tfoot className="border-t border-border bg-muted/30">
            <tr>
              <td colSpan={3} className="px-2 py-2.5 text-right leading-snug text-muted-foreground">รวม</td>
              <td className={foot}>{money(totals.sumBase)}</td>
              <td className={cn(foot, 'text-muted-foreground')}>{money(totals.sumVat)}</td>
              <td className={cn(foot, 'font-medium')}>{money(totals.sumTotal)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <button data-ui-control="button"
        type="button"
        onClick={addLine}
        className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border py-3 text-sm leading-snug text-muted-foreground hover:border-primary hover:text-foreground lg:w-auto lg:px-6"
      >
        <Plus className="size-4" aria-hidden="true" /> เพิ่มรายการ
      </button>
    </div>
  );
}
