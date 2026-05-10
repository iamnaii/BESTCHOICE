import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { ArrowLeft, FileText } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Button } from '@/components/ui/button';
import { CashAccountSelect } from '@/components/CashAccountSelect';
import { formatNumberDecimal } from '@/utils/formatters';
import { useAuth } from '@/contexts/AuthContext';

interface AccrualDoc {
  id: string;
  number: string;
  vendorName: string | null;
  totalAmount: string;
  documentDate: string;
  status: string;
  branch: { id: string; name: string };
  expenseDetail: { category: string } | null;
}

interface Selection {
  docId: string;
  amount: string;
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export function SettlementForm({ onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const today = new Date();
  const [documentDate, setDocumentDate] = useState(today.toISOString().slice(0, 10));
  const [depositAccountCode, setDepositAccountCode] = useState(
    user?.defaultCashAccountCode || '11-1101',
  );
  const [paymentMethod, setPaymentMethod] = useState('BANK_TRANSFER');
  const [vendorName, setVendorName] = useState('');
  const [whtAmount, setWhtAmount] = useState('0');
  const [whtFormType, setWhtFormType] = useState<'PND3' | 'PND53' | ''>('');
  const [note, setNote] = useState('');
  const [selections, setSelections] = useState<Map<string, Selection>>(new Map());

  const { data: branches } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });
  const [branchId, setBranchId] = useState('');
  useEffect(() => {
    if (branches && branches.length > 0 && !branchId) setBranchId(branches[0].id);
  }, [branches, branchId]);

  // Fetch ACCRUAL EX docs for selected branch
  const { data: accrualList } = useQuery<{ data: AccrualDoc[] }>({
    queryKey: ['accrual-list', branchId],
    queryFn: async () => {
      if (!branchId) return { data: [] };
      const { data } = await api.get(
        `/expense-documents?type=EXPENSE&status=ACCRUAL&branchId=${branchId}&limit=100`,
      );
      return data;
    },
    enabled: !!branchId,
  });

  const toggle = (doc: AccrualDoc) => {
    const next = new Map(selections);
    if (next.has(doc.id)) next.delete(doc.id);
    else next.set(doc.id, { docId: doc.id, amount: doc.totalAmount });
    setSelections(next);
  };
  const updateAmount = (docId: string, amount: string) => {
    const next = new Map(selections);
    const sel = next.get(docId);
    if (sel) next.set(docId, { ...sel, amount });
    setSelections(next);
  };

  const sumSettled = useMemo(() => {
    return Array.from(selections.values()).reduce(
      (s, sel) => s + (parseFloat(sel.amount) || 0),
      0,
    );
  }, [selections]);
  const whtN = parseFloat(whtAmount) || 0;
  const cashLeg = sumSettled - whtN;

  const allValid =
    selections.size > 0 &&
    Array.from(selections.values()).every((s) => parseFloat(s.amount) > 0);
  const canSubmit = branchId && depositAccountCode && allValid;

  const mutation = useMutation({
    mutationFn: async (andPost: boolean) => {
      const body = {
        branchId,
        documentDate,
        vendorName: vendorName || undefined,
        depositAccountCode,
        paymentMethod,
        withholdingTax: whtN || undefined,
        whtFormType: whtFormType || undefined,
        note: note || undefined,
        lines: Array.from(selections.values()).map((s) => ({
          clearedDocumentId: s.docId,
          amountSettled: parseFloat(s.amount),
        })),
      };
      const { data } = await api.post('/expense-documents/settlement', body);
      if (andPost) await api.post(`/expense-documents/${data.id}/post`);
      return data;
    },
    onSuccess: () => {
      toast.success('สร้างเอกสารจ่ายเจ้าหนี้สำเร็จ');
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
          <h2 className="text-lg font-semibold text-foreground">จ่ายเจ้าหนี้ (SE)</h2>
          <div className="w-16" />
        </div>

        <div className="p-6 space-y-5">
          {/* Section 1: ข้อมูลการจ่าย */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5">วันที่จ่าย</label>
                <ThaiDateInput
                  value={documentDate}
                  onChange={(e) => setDocumentDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5">
                  บัญชีจ่าย <span className="text-destructive">*</span>
                </label>
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
                  onChange={(e) => {
                    setBranchId(e.target.value);
                    setSelections(new Map());
                  }}
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5">
                  ผู้รับเงิน (ถ้ารวมเจ้าหนี้คนเดียว)
                </label>
                <input
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="เช่น การไฟฟ้า"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Section 2: เลือกเจ้าหนี้คงค้าง */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <FileText className="size-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">เจ้าหนี้คงค้างของสาขา</h3>
                <p className="text-xs text-muted-foreground">
                  {accrualList?.data.length ?? 0} รายการรอจ่าย — เลือกที่ต้องการเคลียร์
                </p>
              </div>
            </div>

            {accrualList && accrualList.data.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
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
                    {accrualList?.data.map((doc) => {
                      const isSelected = selections.has(doc.id);
                      const sel = selections.get(doc.id);
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
                            />
                          </td>
                          <td className="p-2 font-mono text-warning text-sm">{doc.number}</td>
                          <td className="p-2">{doc.vendorName ?? '–'}</td>
                          <td className="p-2 text-right font-mono">
                            {formatNumberDecimal(doc.totalAmount)}
                          </td>
                          <td className="p-1.5 text-right">
                            {isSelected && (
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                max={doc.totalAmount}
                                value={sel!.amount}
                                onChange={(e) => updateAmount(doc.id, e.target.value)}
                                className={`${inputClass} text-right font-mono w-32 inline-block`}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 3: WHT + summary */}
          {selections.size > 0 && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5">หัก ณ ที่จ่าย</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={whtAmount}
                    onChange={(e) => setWhtAmount(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5">ฟอร์มภาษี</label>
                  <select
                    value={whtFormType}
                    onChange={(e) => setWhtFormType(e.target.value as 'PND3' | 'PND53' | '')}
                    className={inputClass}
                  >
                    <option value="">ไม่ระบุ</option>
                    <option value="PND3">ภงด.3 (บุคคลธรรมดา)</option>
                    <option value="PND53">ภงด.53 (นิติบุคคล)</option>
                  </select>
                </div>
              </div>
              <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">รวมยอดที่จ่าย</span>
                  <span className="font-medium font-mono">{formatNumberDecimal(sumSettled)}</span>
                </div>
                {whtN > 0 && (
                  <div className="flex justify-between text-destructive">
                    <span>หัก ณ ที่จ่าย</span>
                    <span className="font-medium font-mono">({formatNumberDecimal(whtN)})</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-primary/20 pt-2 font-bold">
                  <span className="text-primary">ตัดเงินสดสุทธิ</span>
                  <span className="text-primary font-mono">{formatNumberDecimal(cashLeg)}</span>
                </div>
              </div>
            </div>
          )}

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
