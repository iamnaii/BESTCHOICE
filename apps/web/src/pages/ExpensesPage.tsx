import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import { useCoaGroups } from '@/hooks/useCoa';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import Modal from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { compressImageForOcr } from '@/lib/compressImage';
import { Receipt, Plus, Pencil, Upload, X, ArrowLeft, MoreVertical, FileText, Store, Layers, CreditCard, Paperclip, StickyNote, Bookmark, Wallet, BarChart3, Search, SlidersHorizontal, Eye, ArrowRight, UserCircle2 } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Button } from '@/components/ui/button';
import { formatDateShortThai } from '@/utils/formatters';

// ─── Types ───
interface Expense {
  id: string; expenseNumber: string; accountType: string; category: string;
  accountCode: string | null; description: string; amount: string; vatAmount: string;
  totalAmount: string; withholdingTax: string; expenseDate: string;
  paymentMethod: string | null; paymentDate: string | null; reference: string | null;
  vendorName: string | null; vendorTaxId: string | null; receiptImageUrl: string | null;
  taxInvoiceNo: string | null; status: string; rejectReason: string | null;
  note: string | null; isRecurring: boolean; createdAt: string;
  branch: { id: string; name: string }; createdBy: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
}

interface Summary {
  totalAmount: number;
  totalCount: number;
  pendingCount: number;
  byAccountType: Record<string, number>;
  byStatus?: Record<string, number>;
  accrualUnpaidCount?: number;
  accrualUnpaidTotal?: number;
}

// Map document number prefix + paymentDate to display "type"
function getDocumentType(e: Expense): { label: string; cls: string } {
  const num = e.expenseNumber || '';
  if (num.startsWith('CN')) return { label: 'ใบลดหนี้', cls: 'bg-destructive/10 text-destructive border-destructive/20' };
  if (num.startsWith('PR')) return { label: 'เงินเดือน', cls: 'bg-info/10 text-info border-info/20' };
  if (num.startsWith('SE')) return { label: 'จ่ายเจ้าหนี้', cls: 'bg-muted text-muted-foreground border-border' };
  // EX prefix or default — derive from paymentDate
  return e.paymentDate
    ? { label: 'Same-day', cls: 'bg-success/10 text-success border-success/20' }
    : { label: 'ตั้งหนี้', cls: 'bg-warning/10 text-warning border-warning/20' };
}

// Derived status badge — simplifies 6 internal statuses to 3 user-facing
function getStatusBadge(e: Expense): { label: string; cls: string } {
  if (e.status === 'DRAFT') return { label: 'DRAFT', cls: 'bg-muted text-muted-foreground border-border' };
  if (e.status === 'REJECTED') return { label: 'REJECTED', cls: 'bg-destructive/10 text-destructive border-destructive/20' };
  if (e.status === 'VOIDED') return { label: 'VOIDED', cls: 'bg-muted text-muted-foreground border-border' };
  if (e.status === 'PAID') return { label: 'POSTED', cls: 'bg-success/10 text-success border-success/20' };
  // APPROVED / PENDING_APPROVAL: split by paymentDate
  return e.paymentDate
    ? { label: 'POSTED', cls: 'bg-success/10 text-success border-success/20' }
    : { label: 'ACCRUAL', cls: 'bg-success/10 text-success border-success/20' };
}

// ─── Constants ───

const statusLabels: Record<string, string> = {
  DRAFT: 'ร่าง', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ', PAID: 'จ่ายแล้ว', VOIDED: 'ยกเลิก',
};


const paymentMethodLabels: Record<string, string> = {
  CASH: 'เงินสด', BANK_TRANSFER: 'โอนเงิน', QR_EWALLET: 'QR/e-Wallet',
};

const inputClass = 'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

function fmt(n: string | number | null | undefined): string {
  if (n == null) return '-';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const emptyForm = {
  branchId: '', category: '',
  description: '', amount: '', vatAmount: '0', withholdingTax: '0',
  expenseDate: new Date().toISOString().split('T')[0], paymentMethod: '',
  vendorName: '', vendorTaxId: '', reference: '', taxInvoiceNo: '', note: '',
  isRecurring: false, recurringDay: '', receiptImageUrl: '',
};

// ─── PEAK-style Form Panel ───
function ExpenseFormPanel({ editingExpense, branches, onClose, onSaved }: {
  editingExpense: Expense | null;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const [includeVat, setIncludeVat] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: coaData } = useCoaGroups({ type: 'ค่าใช้จ่าย' });
  const groups = coaData?.groups ?? [];

  useEffect(() => {
    if (editingExpense) {
      setForm({
        branchId: editingExpense.branch.id,
        category: editingExpense.category, description: editingExpense.description,
        amount: editingExpense.amount, vatAmount: editingExpense.vatAmount,
        withholdingTax: editingExpense.withholdingTax, expenseDate: editingExpense.expenseDate.slice(0, 10),
        paymentMethod: editingExpense.paymentMethod || '', vendorName: editingExpense.vendorName || '',
        vendorTaxId: editingExpense.vendorTaxId || '', reference: editingExpense.reference || '',
        taxInvoiceNo: editingExpense.taxInvoiceNo || '', note: editingExpense.note || '',
        isRecurring: editingExpense.isRecurring, recurringDay: '',
        receiptImageUrl: editingExpense.receiptImageUrl || '',
      });
      setIncludeVat(Number(editingExpense.vatAmount) > 0);
    } else {
      setForm({ ...emptyForm, branchId: branches[0]?.id || '' });
      setIncludeVat(false);
    }
  }, [editingExpense, branches]);

  // Set initial category once CoA groups load (new form only)
  useEffect(() => {
    if (groups.length > 0 && !form.category && !editingExpense) {
      setForm((f) => ({ ...f, category: groups[0].accounts[0]?.code ?? '' }));
    }
  }, [groups, form.category, editingExpense]);

  useEffect(() => {
    if (includeVat) {
      const vat = Math.round(parseFloat(form.amount || '0') * 0.07 * 100) / 100;
      setForm(prev => ({ ...prev, vatAmount: vat.toString() }));
    }
  }, [includeVat, form.amount]);

  const saveMutation = useMutation({
    mutationFn: async ({ data, andSubmit }: { data: Record<string, unknown>; andSubmit: boolean }) => {
      const res = editingExpense
        ? await api.patch(`/expenses/${editingExpense.id}`, data)
        : await api.post('/expenses', data);
      if (andSubmit) {
        const id = editingExpense?.id || res.data.id;
        await api.post(`/expenses/${id}/submit`);
      }
      return res;
    },
    onSuccess: (_, { andSubmit }) => {
      toast.success(andSubmit ? 'บันทึกและส่งอนุมัติสำเร็จ' : 'บันทึกร่างสำเร็จ');
      onSaved();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('ไฟล์ต้องไม่เกิน 5MB'); return; }
    try {
      const compressed = await compressImageForOcr(file, 800, 0.8);
      setForm(prev => ({ ...prev, receiptImageUrl: compressed }));
    } catch { toast.error('ไม่สามารถอ่านไฟล์ได้'); }
    e.target.value = '';
  };

  const handleSave = (andSubmit: boolean) => {
    if (!form.description || !form.amount) { toast.error('กรุณากรอกรายละเอียดและจำนวนเงิน'); return; }
    const amount = parseFloat(form.amount);
    const vatAmount = parseFloat(form.vatAmount) || 0;
    const withholdingTax = parseFloat(form.withholdingTax) || 0;
    saveMutation.mutate({
      data: {
        branchId: form.branchId || branches[0]?.id,
        category: form.category, description: form.description, amount, vatAmount,
        withholdingTax, includeVat, expenseDate: form.expenseDate,
        paymentMethod: form.paymentMethod || undefined, vendorName: form.vendorName || undefined,
        vendorTaxId: form.vendorTaxId || undefined, reference: form.reference || undefined,
        taxInvoiceNo: form.taxInvoiceNo || undefined, note: form.note || undefined,
        isRecurring: form.isRecurring || undefined,
        recurringDay: form.recurringDay ? parseInt(form.recurringDay) : undefined,
        receiptImageUrl: form.receiptImageUrl || undefined,
      },
      andSubmit,
    });
  };
  const amt = parseFloat(form.amount || '0');
  const vat = parseFloat(form.vatAmount || '0');
  const wht = parseFloat(form.withholdingTax || '0');
  const total = amt + vat;
  const netPay = total - wht;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8">
      <div className="w-full max-w-4xl bg-background rounded-xl shadow-modal overflow-y-auto max-h-[calc(100vh-4rem)]">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
          <button onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="size-4" /> กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">{editingExpense ? 'แก้ไขรายจ่าย' : 'บันทึกรายจ่าย'}</h2>
          <div className="w-16" />
        </div>

        <div className="p-6 space-y-5">
          {/* Section: ข้อมูลเอกสาร */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <FileText className="size-4" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลเอกสาร</h3>
                <p className="text-xs text-muted-foreground">วันที่, สาขา, สถานะ</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">วันที่ <span className="text-destructive">*</span></label>
                <ThaiDateInput value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} required className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">สาขา <span className="text-destructive">*</span></label>
                <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} required className={inputClass}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">สถานะ</label>
                <div className="px-3 py-2 bg-muted rounded-lg text-sm font-medium">
                  {editingExpense ? statusLabels[editingExpense.status] || editingExpense.status : 'ใหม่'}
                </div>
              </div>
            </div>
          </div>

          {/* Section: ผู้รับเงิน */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-muted text-muted-foreground">
                <Store className="size-4" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ผู้รับเงิน / ร้านค้า</h3>
                <p className="text-xs text-muted-foreground">ข้อมูลผู้ออกใบเสร็จ</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อผู้รับเงิน</label>
                <input type="text" value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} placeholder="เช่น การไฟฟ้านครหลวง" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">เลขผู้เสียภาษี</label>
                <input type="text" value={form.vendorTaxId} onChange={(e) => setForm({ ...form, vendorTaxId: e.target.value })} placeholder="13 หลัก" className={`${inputClass} font-mono`} />
              </div>
            </div>
          </div>

          {/* Section: รายการค่าใช้จ่าย */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-muted text-muted-foreground">
                <Layers className="size-4" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">รายการค่าใช้จ่าย</h3>
                <p className="text-xs text-muted-foreground">หมวดบัญชี, จำนวนเงิน, ภาษี</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">หมวดบัญชี <span className="text-destructive">*</span></label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputClass}>
                  {groups.map((g) => (
                    <optgroup key={g.category} label={g.category}>
                      {g.accounts.map((a) => (
                        <option key={a.code} value={a.code}>{a.code} {a.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">รายละเอียด <span className="text-destructive">*</span></label>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required placeholder="เช่น ค่าไฟฟ้าเดือน เม.ย. 2569" className={inputClass} />
              </div>

              {/* Amount row */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">จำนวนเงิน <span className="text-destructive">*</span></label>
                  <input type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">VAT</label>
                  <input type="number" step="0.01" min="0" value={form.vatAmount} onChange={(e) => { if (!includeVat) setForm({ ...form, vatAmount: e.target.value }); }}
                    readOnly={includeVat} className={`${inputClass} ${includeVat ? 'bg-muted' : ''}`} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">หัก ณ ที่จ่าย</label>
                  <input type="number" step="0.01" min="0" value={form.withholdingTax} onChange={(e) => setForm({ ...form, withholdingTax: e.target.value })} className={inputClass} />
                </div>
              </div>

              {/* VAT toggle */}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={includeVat} onChange={(e) => { setIncludeVat(e.target.checked); if (!e.target.checked) setForm(prev => ({ ...prev, vatAmount: '0' })); }} className="rounded border-input text-primary" />
                <span className="text-muted-foreground">คำนวณ VAT 7% อัตโนมัติ</span>
              </label>

              {/* Summary box */}
              {amt > 0 && (
                <div className="bg-linear-to-br from-primary/5 to-primary/10 dark:from-primary/10 dark:to-primary/15 rounded-xl p-4 space-y-2 text-sm border border-primary/15">
                  <div className="flex justify-between"><span className="text-muted-foreground">รวมก่อน VAT</span><span className="font-medium">{fmt(amt)}</span></div>
                  {vat > 0 && <div className="flex justify-between"><span className="text-muted-foreground">VAT 7%</span><span className="font-medium">{fmt(vat)}</span></div>}
                  {wht > 0 && <div className="flex justify-between text-destructive"><span>หัก ณ ที่จ่าย</span><span className="font-medium">({fmt(wht)})</span></div>}
                  <div className="border-t border-primary/20 pt-2.5 mt-1 flex justify-between font-bold text-lg">
                    <span className="text-primary">ยอดจ่ายสุทธิ</span><span className="text-primary">{fmt(netPay)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section: ข้อมูลการจ่ายเงิน */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-muted text-muted-foreground">
                <CreditCard className="size-4" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลการจ่ายเงิน</h3>
                <p className="text-xs text-muted-foreground">วิธีชำระ, เลขอ้างอิง</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">วิธีจ่ายเงิน</label>
                <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} className={inputClass}>
                  <option value="">ยังไม่จ่าย</option>
                  {Object.entries(paymentMethodLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">เลขอ้างอิง</label>
                <input type="text" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="เลขที่บิล, เลขเช็ค" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">เลขใบกำกับภาษี</label>
                <input type="text" value={form.taxInvoiceNo} onChange={(e) => setForm({ ...form, taxInvoiceNo: e.target.value })} className={inputClass} />
              </div>
            </div>
          </div>

          {/* Section: แนบไฟล์ */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-muted text-muted-foreground">
                <Paperclip className="size-4" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">แนบไฟล์</h3>
                <p className="text-xs text-muted-foreground">ใบเสร็จ, ใบกำกับภาษี</p>
              </div>
            </div>
            {form.receiptImageUrl ? (
              <div className="flex items-start gap-4 p-3 rounded-lg border border-border bg-muted/30">
                <img src={form.receiptImageUrl} alt="ใบเสร็จ" className="w-20 h-20 object-cover rounded-lg border shadow-sm" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">ใบเสร็จ/ใบกำกับภาษี</p>
                  <p className="text-xs text-muted-foreground mt-0.5">อัพโหลดเรียบร้อย</p>
                  <button onClick={() => setForm(prev => ({ ...prev, receiptImageUrl: '' }))} className="text-destructive hover:text-destructive/80 text-xs font-medium flex items-center gap-1 mt-2">
                    <X className="size-3" /> ลบไฟล์
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-input rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all"
              >
                <input type="file" accept="image/*,.pdf" hidden ref={fileRef} onChange={handleFileSelect} />
                <div className="flex items-center justify-center size-12 rounded-full bg-muted mx-auto mb-3">
                  <Upload className="size-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground">คลิกหรือลากไฟล์มาวาง</p>
                <p className="text-xs text-muted-foreground mt-1">JPG, PNG ไม่เกิน 5MB</p>
              </button>
            )}
          </div>

          {/* Section: หมายเหตุ */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-muted text-muted-foreground">
                <StickyNote className="size-4" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">หมายเหตุ</h3>
                <p className="text-xs text-muted-foreground">บันทึกเพิ่มเติม, รายจ่ายประจำ</p>
              </div>
            </div>
            <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} placeholder="หมายเหตุเพิ่มเติม..." className={`${inputClass} resize-none`} />
            <div className="flex items-center gap-4 mt-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.isRecurring} onChange={(e) => setForm({ ...form, isRecurring: e.target.checked, recurringDay: e.target.checked ? form.recurringDay : '' })} className="rounded border-input text-primary" />
                <span className="text-muted-foreground">รายจ่ายประจำ (ทุกเดือน)</span>
              </label>
              {form.isRecurring && (
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">ทุกวันที่</span>
                  <input type="number" min="1" max="31" value={form.recurringDay} onChange={(e) => setForm({ ...form, recurringDay: e.target.value })} className={`${inputClass} w-16 text-center`} placeholder="1-31" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        <div className="sticky bottom-0 bg-background border-t border-border px-6 py-4 flex items-center justify-end gap-3">
          <Button variant="ghost" size="md" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button variant="outline" size="md" onClick={() => handleSave(false)} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกร่าง'}
          </Button>
          <button onClick={() => handleSave(true)} disabled={saveMutation.isPending}
            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold shadow-sm hover:shadow-md hover:bg-primary/90 transition-all disabled:opacity-50 inline-flex items-center gap-2">
            {saveMutation.isPending ? (
              <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" /> กำลังบันทึก...</>
            ) : 'บันทึกและส่งอนุมัติ'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───
export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const isOwner = currentUser?.role === 'OWNER';
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFilter = searchParams.get('tab') || 'all';
  const statusFilter = searchParams.get('status') || '';
  const categoryFilter = searchParams.get('category') || '';
  const branchFilter = searchParams.get('branch') || '';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const debouncedSearch = useDebounce(search, 300);
  const [showForm, setShowForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; expenseId: string; reason: string }>({ open: false, expenseId: '', reason: '' });

  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value); else params.delete(key);
    if (key !== 'page') params.delete('page');
    setSearchParams(params, { replace: true });
  };

  const setTab = (tab: string) => {
    const params = new URLSearchParams(searchParams);
    if (tab === 'all') params.delete('tab'); else params.set('tab', tab);
    params.delete('page');
    params.delete('status'); // tab supersedes manual status filter
    setSearchParams(params, { replace: true });
  };

  const now = new Date();
  const quickPresets = [
    { label: 'เดือนนี้', fn: () => { setFilter('startDate', new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]); setFilter('endDate', now.toISOString().split('T')[0]); } },
    { label: '3 เดือน', fn: () => { const d = new Date(); d.setMonth(d.getMonth() - 3); setFilter('startDate', d.toISOString().split('T')[0]); setFilter('endDate', now.toISOString().split('T')[0]); } },
    { label: 'ปีนี้', fn: () => { setFilter('startDate', `${now.getFullYear()}-01-01`); setFilter('endDate', now.toISOString().split('T')[0]); } },
  ];

  const invalidateAll = () => { queryClient.invalidateQueries({ queryKey: ['expenses'] }); queryClient.invalidateQueries({ queryKey: ['expenses-summary'] }); };

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({ queryKey: ['branches'], queryFn: async () => (await api.get('/branches')).data });

  const { data: coaData } = useCoaGroups({ type: 'ค่าใช้จ่าย' });
  const coaGroups = coaData?.groups ?? [];
  const codeToName = useMemo(() => {
    const m = new Map<string, string>();
    coaGroups.forEach((g) => g.accounts.forEach((a) => m.set(a.code, a.name)));
    return m;
  }, [coaGroups]);

  const { data: summary } = useQuery<Summary>({
    queryKey: ['expenses-summary', branchFilter, startDate, endDate],
    queryFn: async () => { const p = new URLSearchParams(); if (branchFilter) p.set('branchId', branchFilter); if (startDate) p.set('startDate', startDate); if (endDate) p.set('endDate', endDate); return (await api.get(`/expenses/summary?${p}`)).data; },
  });

  const {
    data: expensesData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<{ data: Expense[]; total: number }>({
    queryKey: ['expenses', tabFilter, statusFilter, categoryFilter, branchFilter, startDate, endDate, debouncedSearch, page],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: '20', page: String(page) });
      if (tabFilter && tabFilter !== 'all') p.set('tab', tabFilter);
      if (statusFilter) p.set('status', statusFilter);
      if (categoryFilter) p.set('category', categoryFilter);
      if (branchFilter) p.set('branchId', branchFilter);
      if (startDate) p.set('startDate', startDate);
      if (endDate) p.set('endDate', endDate);
      if (debouncedSearch) p.set('search', debouncedSearch);
      return (await api.get(`/expenses?${p}`)).data;
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action, body }: { id: string; action: string; body?: Record<string, unknown> }) =>
      api.post(`/expenses/${id}/${action}`, body || {}),
    onSuccess: () => { invalidateAll(); toast.success('อัปเดตสถานะสำเร็จ'); },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const openCreate = () => { setEditingExpense(null); setShowForm(true); };
  const openEdit = (e: Expense) => { setEditingExpense(e); setShowForm(true); setOpenMenuId(null); };
  const handleFormSaved = () => { setShowForm(false); setEditingExpense(null); invalidateAll(); };

  const totalPages = Math.ceil((expensesData?.total || 0) / 20);

  // Tab counts derived from summary endpoint
  const totalCount = summary?.totalCount ?? 0;
  const draftCount = summary?.byStatus?.DRAFT ?? 0;
  const unpaidCount = summary?.accrualUnpaidCount ?? 0;
  const unpaidTotal = summary?.accrualUnpaidTotal ?? 0;
  const paidCount = summary?.byStatus?.PAID ?? 0;
  const recordedCount = totalCount - draftCount;

  const tabs = [
    { id: 'all', label: 'ทั้งหมด', count: totalCount, icon: Receipt },
    { id: 'draft', label: 'ฉบับร่าง', count: draftCount, icon: FileText },
    { id: 'unpaid', label: 'รอจ่าย', count: unpaidCount, sub: unpaidTotal > 0 ? `รวม ${fmt(unpaidTotal)} B` : undefined, icon: Wallet },
    { id: 'recorded', label: 'บันทึกแล้ว', count: recordedCount, icon: CreditCard },
    { id: 'paid', label: 'จ่ายแล้ว', count: paidCount, icon: Receipt },
    { id: 'favorites', label: 'รายการโปรด', count: 0, sub: 'ใช้บันทึกซ้ำ', icon: Bookmark },
    { id: 'daily-summary', label: 'สรุปรายวัน', icon: BarChart3, isAction: true },
  ] as const;

  const columns = [
    {
      key: 'expenseNumber',
      label: 'เลขเอกสาร',
      render: (e: Expense) => <span className="font-mono text-sm font-medium text-warning">{e.expenseNumber}</span>,
    },
    {
      key: 'vendorName',
      label: 'ผู้ขาย',
      render: (e: Expense) => <span className="text-sm">{e.vendorName || '–'}</span>,
    },
    {
      key: 'category',
      label: 'บัญชี',
      render: (e: Expense) =>
        e.category ? (
          <div className="min-w-0">
            <div className="font-mono text-sm font-medium text-warning">{e.category}</div>
            <div className="text-xs text-muted-foreground truncate">{codeToName.get(e.category) || e.category}</div>
          </div>
        ) : (
          <span className="text-muted-foreground">–</span>
        ),
    },
    {
      key: 'totalAmount',
      label: 'ยอดรวม',
      render: (e: Expense) => {
        const amt = parseFloat(e.totalAmount || '0');
        const isCredit = (e.expenseNumber || '').startsWith('CN');
        const isUnpaid = !e.paymentDate && (e.status === 'APPROVED' || e.status === 'PENDING_APPROVAL');
        return (
          <div className="text-right">
            <div className={`font-mono font-medium text-sm ${isCredit ? 'text-destructive' : ''}`}>
              {isCredit ? '-' : ''}
              {fmt(Math.abs(amt))}
            </div>
            {isUnpaid && (
              <div className="text-xs text-muted-foreground">
                คงค้าง <span className="font-mono">{fmt(amt)}</span>
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'expenseDate',
      label: 'วันที่ใบกำกับ',
      render: (e: Expense) => <span className="text-sm">{formatDateShortThai(e.expenseDate)}</span>,
    },
    {
      key: 'docType',
      label: 'ประเภท',
      render: (e: Expense) => {
        const t = getDocumentType(e);
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border font-medium leading-snug ${t.cls}`}>
            {t.label}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (e: Expense) => {
        const s = getStatusBadge(e);
        return (
          <div>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border font-semibold uppercase tracking-wide leading-snug ${s.cls}`}>
              {s.label}
            </span>
            {e.rejectReason && <div className="text-xs text-destructive mt-0.5 truncate max-w-[120px]">{e.rejectReason}</div>}
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: 'ACTION',
      render: (e: Expense) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(ev) => { ev.stopPropagation(); openEdit(e); }}
            className="p-1.5 hover:bg-muted rounded transition-colors"
            title="ดู / แก้ไข"
          >
            <Eye className="size-4 text-muted-foreground" />
          </button>
          {(e.status === 'DRAFT' || e.status === 'REJECTED' || e.status === 'PENDING_APPROVAL' || e.status === 'APPROVED') && (
            <div className="relative">
              <button
                onClick={(ev) => { ev.stopPropagation(); setOpenMenuId(openMenuId === e.id ? null : e.id); }}
                className="p-1.5 hover:bg-muted rounded transition-colors"
              >
                <MoreVertical className="size-4 text-muted-foreground" />
              </button>
              {openMenuId === e.id && (
                <div className="absolute right-0 top-full mt-1 z-10 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[140px]">
                  {(e.status === 'DRAFT' || e.status === 'REJECTED') && (
                    <>
                      <button onClick={() => openEdit(e)} className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted flex items-center gap-2">
                        <Pencil className="size-3.5" /> แก้ไข
                      </button>
                      <button
                        onClick={() => setConfirmDialog({ open: true, message: `ส่งอนุมัติ "${e.expenseNumber}"?`, action: () => actionMutation.mutate({ id: e.id, action: 'submit' }) })}
                        className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted"
                      >
                        ส่งอนุมัติ
                      </button>
                    </>
                  )}
                  {e.status === 'PENDING_APPROVAL' && isOwner && (
                    <>
                      <button
                        onClick={() => setConfirmDialog({ open: true, message: `อนุมัติ "${e.expenseNumber}"?`, action: () => actionMutation.mutate({ id: e.id, action: 'approve' }) })}
                        className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted"
                      >
                        อนุมัติ
                      </button>
                      <button
                        onClick={() => { setRejectDialog({ open: true, expenseId: e.id, reason: '' }); setOpenMenuId(null); }}
                        className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted text-destructive"
                      >
                        ไม่อนุมัติ
                      </button>
                    </>
                  )}
                  {e.status === 'APPROVED' && (
                    <button
                      onClick={() => setConfirmDialog({ open: true, message: `บันทึกจ่าย "${e.expenseNumber}"?`, action: () => actionMutation.mutate({ id: e.id, action: 'pay' }) })}
                      className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted"
                    >
                      จ่ายแล้ว
                    </button>
                  )}
                  {isOwner && (
                    <button
                      onClick={() => { setConfirmDialog({ open: true, message: `ยกเลิก "${e.expenseNumber}"?`, action: () => actionMutation.mutate({ id: e.id, action: 'void' }) }); setOpenMenuId(null); }}
                      className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted text-destructive"
                    >
                      ยกเลิก
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div onClick={() => setOpenMenuId(null)} onKeyDown={(e) => { if (e.key === 'Escape') setOpenMenuId(null); }}>
      {/* Compact branded header */}
      <div className="flex items-center justify-between gap-4 pb-4 mb-5 border-b border-border flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Receipt className="size-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-snug text-foreground truncate">ระบบบันทึกค่าใช้จ่ายกิจการ</h1>
            <p className="text-xs text-muted-foreground leading-snug">Business Expense Module · v1.0</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="px-3 py-1.5 rounded-lg border border-border text-xs flex items-center gap-1.5 hover:bg-muted transition-colors">
            <Bookmark className="size-3.5 text-muted-foreground" />
            <span className="text-foreground">รายการโปรด</span>
            <span className="text-primary font-semibold ml-0.5 font-mono">0</span>
          </button>
          <button className="px-3 py-1.5 rounded-lg border border-border text-xs flex items-center gap-1.5 hover:bg-muted transition-colors">
            <Wallet className="size-3.5 text-muted-foreground" />
            <span className="text-foreground">เจ้าหนี้คงค้าง</span>
            <span className="text-primary font-semibold ml-0.5 font-mono">{fmt(unpaidTotal)}</span>
          </button>
          <button className="px-3 py-1.5 rounded-lg border border-border text-xs flex items-center gap-1.5 hover:bg-muted transition-colors">
            <BarChart3 className="size-3.5 text-muted-foreground" />
            <span className="text-foreground">สรุปรายวัน</span>
          </button>
          {currentUser && (
            <div className="px-3 py-1.5 rounded-lg border border-border text-xs flex items-center gap-1.5 bg-card">
              <UserCircle2 className="size-3.5 text-muted-foreground" />
              <span className="font-medium text-foreground">{currentUser.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Filter tabs — 7 cards mirror screenshot */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-5">
        {tabs.map((tab) => {
          const isActive = (tabFilter || 'all') === tab.id;
          const Icon = tab.icon;
          const isAction = 'isAction' in tab && tab.isAction;
          const hasCount = 'count' in tab && tab.count !== undefined;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => { if (isAction) return; setTab(tab.id); }}
              className={cn(
                'rounded-xl border p-4 text-left transition-all hover:bg-muted/30',
                isActive
                  ? 'border-foreground/30 bg-card shadow-sm ring-1 ring-foreground/10'
                  : 'border-border bg-card/40',
              )}
            >
              <div className="flex items-start justify-between mb-1.5">
                <Icon className={cn('size-4', isActive ? 'text-foreground' : 'text-muted-foreground')} />
                {hasCount ? (
                  <span className={cn(
                    'text-2xl font-bold leading-none tabular-nums',
                    tab.id === 'paid' || tab.id === 'recorded' || tab.id === 'unpaid'
                      ? 'text-success'
                      : 'text-foreground',
                  )}>
                    {tab.count}
                  </span>
                ) : isAction ? (
                  <ArrowRight className="size-4 text-muted-foreground" />
                ) : null}
              </div>
              <div className="text-xs font-medium text-foreground leading-snug">{tab.label}</div>
              {'sub' in tab && tab.sub && (
                <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{tab.sub}</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Search + filter toggle + type select + create */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex-1 min-w-[260px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาเลขเอกสาร / ผู้ขาย / เลขใบกำกับ..."
            className="w-full pl-10 pr-3 py-2.5 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden bg-background"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowAdvancedFilters((v) => !v)}
          className={cn(
            'size-10 shrink-0 rounded-lg border flex items-center justify-center transition-colors',
            showAdvancedFilters ? 'bg-primary/10 border-primary text-primary' : 'border-input hover:bg-muted text-muted-foreground',
          )}
          title="ตัวกรองเพิ่มเติม"
        >
          <SlidersHorizontal className="size-4" />
        </button>
        <select
          value={categoryFilter}
          onChange={(e) => setFilter('category', e.target.value)}
          className="px-3 py-2.5 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden bg-background min-w-[150px]"
        >
          <option value="">ทุกประเภท</option>
          {coaGroups.map((g) => (
            <optgroup key={g.category} label={g.category}>
              {g.accounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} {a.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <Button variant="primary" size="md" onClick={openCreate}>
          <Plus className="size-4" /> สร้างเอกสารใหม่
        </Button>
      </div>

      {/* Advanced filters drawer */}
      {showAdvancedFilters && (
        <div className="flex flex-wrap gap-4 mb-5 bg-card rounded-xl border border-border/50 shadow-sm p-5">
          <div>
            <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สถานะ (ละเอียด)</label>
            <select value={statusFilter} onChange={(e) => setFilter('status', e.target.value)} className={`${inputClass} w-auto min-w-[120px]`}>
              <option value="">ตามแถบที่เลือก</option>
              {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สาขา</label>
            <select value={branchFilter} onChange={(e) => setFilter('branch', e.target.value)} className={`${inputClass} w-auto min-w-[120px]`}>
              <option value="">ทุกสาขา</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ตั้งแต่</label>
            <ThaiDateInput value={startDate} onChange={(e) => setFilter('startDate', e.target.value)} className={`${inputClass} w-auto`} />
          </div>
          <div>
            <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ถึง</label>
            <ThaiDateInput value={endDate} onChange={(e) => setFilter('endDate', e.target.value)} className={`${inputClass} w-auto`} />
          </div>
          <div className="flex items-end gap-1">
            {quickPresets.map((p) => <button key={p.label} onClick={p.fn} className="px-3 py-2 text-xs border border-input rounded-lg hover:bg-muted">{p.label}</button>)}
          </div>
        </div>
      )}

      <QueryBoundary
        isLoading={isLoading && !expensesData}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายการรายจ่ายได้"
      >
        <DataTable columns={columns} data={expensesData?.data || []} isLoading={isLoading} emptyMessage="ไม่พบรายจ่าย" />
      </QueryBoundary>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">หน้า {page} / {totalPages} (ทั้งหมด {expensesData?.total} รายการ)</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setFilter('page', String(page - 1))}>ก่อนหน้า</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setFilter('page', String(page + 1))}>ถัดไป</Button>
          </div>
        </div>
      )}

      {/* PEAK-style Form Panel */}
      {showForm && <ExpenseFormPanel editingExpense={editingExpense} branches={branches} onClose={() => { setShowForm(false); setEditingExpense(null); }} onSaved={handleFormSaved} />}

      {/* Reject Dialog */}
      <Modal isOpen={rejectDialog.open} onClose={() => setRejectDialog({ open: false, expenseId: '', reason: '' })} title="ไม่อนุมัติรายจ่าย">
        <div className="space-y-4">
          <div><label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เหตุผล *</label><textarea value={rejectDialog.reason} onChange={(e) => setRejectDialog(prev => ({ ...prev, reason: e.target.value }))} rows={3} placeholder="กรุณาระบุเหตุผล..." className={inputClass} /></div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setRejectDialog({ open: false, expenseId: '', reason: '' })} className="px-4 py-2 text-sm text-muted-foreground">ยกเลิก</button>
            <button onClick={() => { if (!rejectDialog.reason.trim()) { toast.error('กรุณาระบุเหตุผล'); return; } actionMutation.mutate({ id: rejectDialog.expenseId, action: 'reject', body: { reason: rejectDialog.reason } }); setRejectDialog({ open: false, expenseId: '', reason: '' }); }}
              className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg text-sm font-medium hover:bg-destructive/90">ยืนยันไม่อนุมัติ</button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))} description={confirmDialog.message} onConfirm={confirmDialog.action} />
    </div>
  );
}
