import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { ArrowLeft, Plus, Trash2, Users, Calendar } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Button } from '@/components/ui/button';
import { CashAccountSelect } from '@/components/CashAccountSelect';
import { formatNumberDecimal } from '@/utils/formatters';
import { useAuth } from '@/contexts/AuthContext';

interface PayrollLine {
  id: string; // local UUID for keying
  employeeName: string;
  employeeTaxId: string;
  baseSalary: string;
  ssoEmployee: string;
  whtAmount: string;
}

const newLine = (): PayrollLine => ({
  id: Math.random().toString(36).slice(2),
  employeeName: '',
  employeeTaxId: '',
  baseSalary: '',
  ssoEmployee: '0',
  whtAmount: '0',
});

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export function PayrollForm({ onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Default = current Buddhist year + month
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear() + 543);
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [documentDate, setDocumentDate] = useState(today.toISOString().slice(0, 10));
  const [depositAccountCode, setDepositAccountCode] = useState(
    user?.defaultCashAccountCode || '11-1101',
  );
  const [paymentMethod, setPaymentMethod] = useState('BANK_TRANSFER');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<PayrollLine[]>([newLine()]);

  // Fetch branches for branchId (use first one or user's default)
  const { data: branches } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });
  const [branchId, setBranchId] = useState('');
  useEffect(() => {
    if (branches && branches.length > 0 && !branchId) setBranchId(branches[0].id);
  }, [branches, branchId]);

  // Compute per-line netPaid + sums
  const computed = useMemo(() => {
    const rows = lines.map((l) => {
      const base = parseFloat(l.baseSalary) || 0;
      const sso = parseFloat(l.ssoEmployee) || 0;
      const wht = parseFloat(l.whtAmount) || 0;
      return { ...l, netPaid: base - sso - wht, baseN: base, ssoN: sso, whtN: wht };
    });
    return {
      rows,
      sumBase: rows.reduce((s, r) => s + r.baseN, 0),
      sumSso: rows.reduce((s, r) => s + r.ssoN, 0),
      sumWht: rows.reduce((s, r) => s + r.whtN, 0),
      sumNet: rows.reduce((s, r) => s + r.netPaid, 0),
    };
  }, [lines]);

  const updateLine = (i: number, patch: Partial<PayrollLine>) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, newLine()]);
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const allLinesValid = computed.rows.every(
    (r) => r.employeeName.trim().length >= 2 && r.baseN > 0 && r.netPaid >= 0,
  );
  const canSubmit = branchId.length > 0 && lines.length > 0 && allLinesValid;

  const mutation = useMutation({
    mutationFn: async (andPost: boolean) => {
      // Convert Buddhist year → Western for payrollPeriod
      const westernYear = year - 543;
      const payrollPeriod = `${westernYear}-${String(month).padStart(2, '0')}`;
      const body = {
        branchId,
        documentDate,
        payrollPeriod,
        depositAccountCode,
        paymentMethod,
        note: note || undefined,
        lines: computed.rows.map((r) => ({
          employeeName: r.employeeName,
          employeeTaxId: r.employeeTaxId || undefined,
          baseSalary: r.baseN,
          ssoEmployee: r.ssoN || undefined,
          whtAmount: r.whtN || undefined,
        })),
      };
      const { data } = await api.post('/expense-documents/payroll', body);
      if (andPost) await api.post(`/expense-documents/${data.id}/post`);
      return data;
    },
    onSuccess: () => {
      toast.success('สร้างเงินเดือนสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-summary'] });
      onSaved();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const inputClass =
    'w-full px-2 py-1.5 border border-input rounded text-sm outline-hidden bg-background';

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8">
      <div className="w-full max-w-5xl bg-background rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-4rem)]">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">บันทึกเงินเดือน (PR)</h2>
          <div className="w-16" />
        </div>

        <div className="p-6 space-y-5">
          {/* Section 1: ข้อมูลงวด */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <Calendar className="size-4" />
              </div>
              <h3 className="text-sm font-semibold">งวดเงินเดือน</h3>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5">ปี (พ.ศ.)</label>
                <select
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className={inputClass}
                >
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((offset) => {
                    const y = today.getFullYear() + 543 - offset;
                    return (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5">เดือน</label>
                <select
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  className={inputClass}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5">วันที่จ่ายเงิน</label>
                <ThaiDateInput
                  value={documentDate}
                  onChange={(e) => setDocumentDate(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5">บัญชีจ่าย</label>
                <CashAccountSelect value={depositAccountCode} onChange={setDepositAccountCode} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5">วิธีจ่าย</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className={inputClass}
                >
                  <option value="BANK_TRANSFER">โอนธนาคาร</option>
                  <option value="CASH">เงินสด</option>
                  <option value="QR_EWALLET">QR/E-Wallet</option>
                </select>
              </div>
            </div>
            {branches && branches.length > 1 && (
              <div>
                <label className="block text-xs font-medium mb-1.5">สาขา</label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className={inputClass}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Section 2: พนักงาน */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                  <Users className="size-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">รายชื่อพนักงาน</h3>
                  <p className="text-xs text-muted-foreground">{computed.rows.length} คน</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={addLine}>
                <Plus className="size-3.5" /> เพิ่มพนักงาน
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left p-2">
                      ชื่อ <span className="text-destructive">*</span>
                    </th>
                    <th className="text-left p-2">เลขบัตร</th>
                    <th className="text-right p-2">
                      ฐาน <span className="text-destructive">*</span>
                    </th>
                    <th className="text-right p-2">SSO</th>
                    <th className="text-right p-2">WHT</th>
                    <th className="text-right p-2">สุทธิ</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {computed.rows.map((r, i) => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="p-1.5">
                        <input
                          value={r.employeeName}
                          onChange={(e) => updateLine(i, { employeeName: e.target.value })}
                          placeholder="ชื่อ-สกุล"
                          className={inputClass}
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          value={r.employeeTaxId}
                          onChange={(e) => updateLine(i, { employeeTaxId: e.target.value })}
                          placeholder="13 หลัก"
                          className={`${inputClass} font-mono`}
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={r.baseSalary}
                          onChange={(e) => updateLine(i, { baseSalary: e.target.value })}
                          className={`${inputClass} text-right font-mono`}
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={r.ssoEmployee}
                          onChange={(e) => updateLine(i, { ssoEmployee: e.target.value })}
                          className={`${inputClass} text-right font-mono`}
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={r.whtAmount}
                          onChange={(e) => updateLine(i, { whtAmount: e.target.value })}
                          className={`${inputClass} text-right font-mono`}
                        />
                      </td>
                      <td
                        className={`p-2 text-right font-mono font-medium ${
                          r.netPaid < 0 ? 'text-destructive' : 'text-success'
                        }`}
                      >
                        {r.netPaid.toFixed(2)}
                      </td>
                      <td className="p-1.5">
                        <button
                          onClick={() => removeLine(i)}
                          disabled={lines.length === 1}
                          className="p-1 text-destructive hover:bg-destructive/10 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/50 font-semibold text-sm">
                    <td colSpan={2} className="p-2 text-right text-muted-foreground">
                      รวม
                    </td>
                    <td className="p-2 text-right font-mono">
                      {formatNumberDecimal(computed.sumBase)}
                    </td>
                    <td className="p-2 text-right font-mono">
                      {formatNumberDecimal(computed.sumSso)}
                    </td>
                    <td className="p-2 text-right font-mono">
                      {formatNumberDecimal(computed.sumWht)}
                    </td>
                    <td className="p-2 text-right font-mono text-success">
                      {formatNumberDecimal(computed.sumNet)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Section 3: หมายเหตุ */}
          <div className="rounded-xl border border-border bg-card p-5">
            <label className="block text-xs font-medium mb-1.5">หมายเหตุ</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden bg-background resize-none"
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-background border-t px-6 py-4 flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            variant="outline"
            onClick={() => mutation.mutate(false)}
            disabled={!canSubmit || mutation.isPending}
          >
            บันทึกร่าง
          </Button>
          <Button
            variant="primary"
            onClick={() => mutation.mutate(true)}
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึก + โพสต์'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
