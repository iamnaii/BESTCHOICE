import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { compressImageForOcr } from '@/lib/compressImage';
import { Receipt, Plus, Pencil, Upload, X, ArrowLeft, ShoppingBag, Megaphone, Building2, MoreHorizontal, MoreVertical } from 'lucide-react';

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
  totalAmount: number; totalCount: number; pendingCount: number;
  byAccountType: Record<string, number>;
}

// ─── Constants ───
const accountTypeLabels: Record<string, string> = {
  COST_OF_SALES: '5100 ต้นทุนขาย', SELLING_EXPENSE: '5200 ค่าใช้จ่ายในการขาย',
  ADMINISTRATIVE_EXPENSE: '5300 ค่าใช้จ่ายในการบริหาร', OTHER_EXPENSE: '5900 ค่าใช้จ่ายอื่น',
};

const categoryLabels: Record<string, string> = {
  COGS_PRODUCT: 'ต้นทุนสินค้า', COGS_REPAIR_PARTS: 'อะไหล่/ซ่อม',
  SELL_COMMISSION: 'ค่าคอมมิชชั่น', SELL_ADVERTISING: 'ค่าโฆษณา/การตลาด',
  SELL_TRANSPORT: 'ค่าขนส่ง', SELL_PACKAGING: 'ค่าบรรจุภัณฑ์',
  ADMIN_SALARY: 'เงินเดือน/ค่าจ้าง', ADMIN_SOCIAL_SECURITY: 'ประกันสังคม',
  ADMIN_RENT: 'ค่าเช่าสถานที่', ADMIN_UTILITIES: 'ค่าน้ำ/ไฟ/เน็ต',
  ADMIN_OFFICE_SUPPLIES: 'วัสดุสำนักงาน', ADMIN_DEPRECIATION: 'ค่าเสื่อมราคา',
  ADMIN_INSURANCE: 'ค่าประกันภัย', ADMIN_TAX_FEE: 'ภาษี/ค่าธรรมเนียม',
  ADMIN_MAINTENANCE: 'ค่าซ่อมบำรุง', ADMIN_TRAVEL: 'ค่าเดินทาง',
  ADMIN_TELEPHONE: 'ค่าโทรศัพท์',
  OTHER_INTEREST: 'ดอกเบี้ยจ่าย', OTHER_LOSS: 'ขาดทุนจำหน่ายสินทรัพย์',
  OTHER_FINE: 'ค่าปรับ', OTHER_MISC: 'เบ็ดเตล็ด',
};

const statusLabels: Record<string, string> = {
  DRAFT: 'ร่าง', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ', PAID: 'จ่ายแล้ว', VOIDED: 'ยกเลิก',
};

const statusColors: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground', PENDING_APPROVAL: 'bg-yellow-100 text-yellow-700',
  APPROVED: 'bg-blue-100 text-blue-700', REJECTED: 'bg-red-100 text-red-700',
  PAID: 'bg-green-100 text-green-700', VOIDED: 'bg-muted text-muted-foreground line-through',
};

const paymentMethodLabels: Record<string, string> = {
  CASH: 'เงินสด', BANK_TRANSFER: 'โอนเงิน', QR_EWALLET: 'QR/e-Wallet',
};

const categoryGroups: Record<string, { value: string; label: string }[]> = {
  COST_OF_SALES: [
    { value: 'COGS_PRODUCT', label: '5101 ต้นทุนสินค้า' },
    { value: 'COGS_REPAIR_PARTS', label: '5102 อะไหล่/ซ่อม' },
  ],
  SELLING_EXPENSE: [
    { value: 'SELL_COMMISSION', label: '5201 ค่าคอมมิชชั่น' },
    { value: 'SELL_ADVERTISING', label: '5202 ค่าโฆษณา/การตลาด' },
    { value: 'SELL_TRANSPORT', label: '5203 ค่าขนส่ง' },
    { value: 'SELL_PACKAGING', label: '5204 ค่าบรรจุภัณฑ์' },
  ],
  ADMINISTRATIVE_EXPENSE: [
    { value: 'ADMIN_SALARY', label: '5301 เงินเดือน/ค่าจ้าง' },
    { value: 'ADMIN_SOCIAL_SECURITY', label: '5302 ประกันสังคม' },
    { value: 'ADMIN_RENT', label: '5303 ค่าเช่าสถานที่' },
    { value: 'ADMIN_UTILITIES', label: '5304 ค่าน้ำ/ไฟ/เน็ต' },
    { value: 'ADMIN_OFFICE_SUPPLIES', label: '5305 วัสดุสำนักงาน' },
    { value: 'ADMIN_DEPRECIATION', label: '5306 ค่าเสื่อมราคา' },
    { value: 'ADMIN_INSURANCE', label: '5307 ค่าประกันภัย' },
    { value: 'ADMIN_TAX_FEE', label: '5308 ภาษี/ค่าธรรมเนียม' },
    { value: 'ADMIN_MAINTENANCE', label: '5309 ค่าซ่อมบำรุง' },
    { value: 'ADMIN_TRAVEL', label: '5310 ค่าเดินทาง' },
    { value: 'ADMIN_TELEPHONE', label: '5311 ค่าโทรศัพท์' },
  ],
  OTHER_EXPENSE: [
    { value: 'OTHER_INTEREST', label: '5901 ดอกเบี้ยจ่าย' },
    { value: 'OTHER_LOSS', label: '5902 ขาดทุนจำหน่ายสินทรัพย์' },
    { value: 'OTHER_FINE', label: '5903 ค่าปรับ' },
    { value: 'OTHER_MISC', label: '5999 เบ็ดเตล็ด' },
  ],
};

const inputClass = 'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none';

function fmt(n: string | number | null | undefined): string {
  if (n == null) return '-';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const emptyForm = {
  branchId: '', accountType: 'ADMINISTRATIVE_EXPENSE', category: 'ADMIN_UTILITIES',
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

  useEffect(() => {
    if (editingExpense) {
      setForm({
        branchId: editingExpense.branch.id, accountType: editingExpense.accountType,
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
        branchId: form.branchId || branches[0]?.id, accountType: form.accountType,
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

  const availableCategories = categoryGroups[form.accountType] || [];
  const amt = parseFloat(form.amount || '0');
  const vat = parseFloat(form.vatAmount || '0');
  const wht = parseFloat(form.withholdingTax || '0');
  const total = amt + vat;
  const netPay = total - wht;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-8 pb-8">
      <div className="w-full max-w-4xl bg-background rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-4rem)]">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b px-6 py-4 flex items-center justify-between">
          <button onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> กลับ
          </button>
          <h2 className="text-lg font-semibold">{editingExpense ? 'แก้ไขรายจ่าย' : 'บันทึกรายจ่าย'}</h2>
          <div className="w-16" />
        </div>

        <div className="p-6 space-y-6">
          {/* Section: ข้อมูลเอกสาร */}
          <div className="border rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-foreground border-b pb-2">ข้อมูลเอกสาร</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">วันที่ *</label>
                <input type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} required className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">สาขา *</label>
                <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} required className={inputClass}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">สถานะ</label>
                <div className="px-3 py-2 bg-muted rounded-lg text-sm">
                  {editingExpense ? statusLabels[editingExpense.status] || editingExpense.status : 'ใหม่'}
                </div>
              </div>
            </div>
          </div>

          {/* Section: ผู้รับเงิน */}
          <div className="border rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-foreground border-b pb-2">ผู้รับเงิน / ร้านค้า</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">ชื่อผู้รับเงิน</label>
                <input type="text" value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} placeholder="เช่น การไฟฟ้านครหลวง" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">เลขผู้เสียภาษี</label>
                <input type="text" value={form.vendorTaxId} onChange={(e) => setForm({ ...form, vendorTaxId: e.target.value })} placeholder="13 หลัก" className={inputClass} />
              </div>
            </div>
          </div>

          {/* Section: รายการค่าใช้จ่าย */}
          <div className="border rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-foreground border-b pb-2">รายการค่าใช้จ่าย</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">หมวดบัญชี *</label>
                <select value={form.accountType} onChange={(e) => { const t = e.target.value; setForm({ ...form, accountType: t, category: categoryGroups[t]?.[0]?.value || '' }); }} className={inputClass}>
                  {Object.entries(accountTypeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">หมวดย่อย *</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputClass}>
                  {availableCategories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">รายละเอียด *</label>
              <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required placeholder="เช่น ค่าไฟฟ้าเดือน เม.ย. 2569" className={inputClass} />
            </div>

            {/* Amount row */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">จำนวนเงิน *</label>
                <input type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">VAT</label>
                <input type="number" step="0.01" min="0" value={form.vatAmount} onChange={(e) => { if (!includeVat) setForm({ ...form, vatAmount: e.target.value }); }}
                  readOnly={includeVat} className={`${inputClass} ${includeVat ? 'bg-muted' : ''}`} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">หัก ณ ที่จ่าย</label>
                <input type="number" step="0.01" min="0" value={form.withholdingTax} onChange={(e) => setForm({ ...form, withholdingTax: e.target.value })} className={inputClass} />
              </div>
            </div>

            {/* VAT toggle */}
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={includeVat} onChange={(e) => { setIncludeVat(e.target.checked); if (!e.target.checked) setForm(prev => ({ ...prev, vatAmount: '0' })); }} className="rounded border-input" />
              คำนวณ VAT 7% อัตโนมัติ
            </label>

            {/* Summary box */}
            {amt > 0 && (
              <div className="bg-gray-50 rounded-lg p-4 space-y-1 text-sm border-t">
                <div className="flex justify-between"><span className="text-muted-foreground">รวมก่อน VAT</span><span>{fmt(amt)}</span></div>
                {vat > 0 && <div className="flex justify-between"><span className="text-muted-foreground">VAT 7%</span><span>{fmt(vat)}</span></div>}
                {wht > 0 && <div className="flex justify-between text-red-600"><span>หัก ณ ที่จ่าย</span><span>({fmt(wht)})</span></div>}
                <div className="border-t border-dashed pt-2 mt-2 flex justify-between font-bold text-base">
                  <span>ยอดจ่ายสุทธิ</span><span className="text-foreground">{fmt(netPay)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Section: ข้อมูลการจ่ายเงิน */}
          <div className="border rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-foreground border-b pb-2">ข้อมูลการจ่ายเงิน</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">วิธีจ่ายเงิน</label>
                <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} className={inputClass}>
                  <option value="">ยังไม่จ่าย</option>
                  {Object.entries(paymentMethodLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">เลขอ้างอิง</label>
                <input type="text" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="เลขที่บิล, เลขเช็ค" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">เลขใบกำกับภาษี</label>
                <input type="text" value={form.taxInvoiceNo} onChange={(e) => setForm({ ...form, taxInvoiceNo: e.target.value })} className={inputClass} />
              </div>
            </div>
          </div>

          {/* Section: แนบไฟล์ */}
          <div className="border rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-foreground border-b pb-2">แนบไฟล์</h3>
            {form.receiptImageUrl ? (
              <div className="flex items-start gap-3">
                <img src={form.receiptImageUrl} alt="ใบเสร็จ" className="w-24 h-24 object-cover rounded-lg border" />
                <div className="flex-1">
                  <p className="text-sm text-foreground">ใบเสร็จ/ใบกำกับภาษี</p>
                  <button onClick={() => setForm(prev => ({ ...prev, receiptImageUrl: '' }))} className="text-red-500 hover:text-red-600 text-sm flex items-center gap-1 mt-1">
                    <X className="size-3" /> ลบ
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-input rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              >
                <input type="file" accept="image/*,.pdf" hidden ref={fileRef} onChange={handleFileSelect} />
                <Upload className="size-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">คลิกหรือลากไฟล์มาวาง</p>
                <p className="text-xs text-muted-foreground mt-1">JPG, PNG ไม่เกิน 5MB</p>
              </div>
            )}
          </div>

          {/* Section: หมายเหตุ */}
          <div className="border rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-foreground border-b pb-2">หมายเหตุ</h3>
            <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} placeholder="หมายเหตุเพิ่มเติม..." className={inputClass} />
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={form.isRecurring} onChange={(e) => setForm({ ...form, isRecurring: e.target.checked, recurringDay: e.target.checked ? form.recurringDay : '' })} className="rounded border-input" />
                รายจ่ายประจำ (ทุกเดือน)
              </label>
              {form.isRecurring && (
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">วันที่</span>
                  <input type="number" min="1" max="31" value={form.recurringDay} onChange={(e) => setForm({ ...form, recurringDay: e.target.value })} className={`${inputClass} w-16 text-center`} placeholder="1-31" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        <div className="sticky bottom-0 bg-background border-t px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-input rounded-lg">
            ยกเลิก
          </button>
          <button onClick={() => handleSave(false)} disabled={saveMutation.isPending}
            className="px-4 py-2 text-sm font-medium border border-input rounded-lg hover:bg-muted disabled:opacity-50">
            {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกร่าง'}
          </button>
          <button onClick={() => handleSave(true)} disabled={saveMutation.isPending}
            className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
            {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกและส่งอนุมัติ'}
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
  const statusFilter = searchParams.get('status') || '';
  const accountTypeFilter = searchParams.get('accountType') || '';
  const categoryFilter = searchParams.get('category') || '';
  const branchFilter = searchParams.get('branch') || '';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const [search, setSearch] = useState(searchParams.get('search') || '');
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

  const now = new Date();
  const quickPresets = [
    { label: 'เดือนนี้', fn: () => { setFilter('startDate', new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]); setFilter('endDate', now.toISOString().split('T')[0]); } },
    { label: '3 เดือน', fn: () => { const d = new Date(); d.setMonth(d.getMonth() - 3); setFilter('startDate', d.toISOString().split('T')[0]); setFilter('endDate', now.toISOString().split('T')[0]); } },
    { label: 'ปีนี้', fn: () => { setFilter('startDate', `${now.getFullYear()}-01-01`); setFilter('endDate', now.toISOString().split('T')[0]); } },
  ];

  const invalidateAll = () => { queryClient.invalidateQueries({ queryKey: ['expenses'] }); queryClient.invalidateQueries({ queryKey: ['expenses-summary'] }); };

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({ queryKey: ['branches'], queryFn: async () => (await api.get('/branches')).data });

  const { data: summary } = useQuery<Summary>({
    queryKey: ['expenses-summary', branchFilter, startDate, endDate],
    queryFn: async () => { const p = new URLSearchParams(); if (branchFilter) p.set('branchId', branchFilter); if (startDate) p.set('startDate', startDate); if (endDate) p.set('endDate', endDate); return (await api.get(`/expenses/summary?${p}`)).data; },
  });

  const { data: expensesData, isLoading } = useQuery<{ data: Expense[]; total: number }>({
    queryKey: ['expenses', statusFilter, accountTypeFilter, categoryFilter, branchFilter, startDate, endDate, debouncedSearch, page],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: '20', page: String(page) });
      if (statusFilter) p.set('status', statusFilter);
      if (accountTypeFilter) p.set('accountType', accountTypeFilter);
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

  const summaryCards = [
    { label: 'รายจ่ายทั้งหมด', amount: summary?.totalAmount, sub: `${summary?.totalCount || 0} รายการ | รออนุมัติ ${summary?.pendingCount || 0}`, icon: Receipt, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'ต้นทุนขาย', amount: summary?.byAccountType?.COST_OF_SALES, icon: ShoppingBag, color: 'text-orange-600', bg: 'bg-orange-50' },
    { label: 'ค่าใช้จ่ายขาย', amount: summary?.byAccountType?.SELLING_EXPENSE, icon: Megaphone, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'ค่าใช้จ่ายบริหาร', amount: summary?.byAccountType?.ADMINISTRATIVE_EXPENSE, icon: Building2, color: 'text-cyan-600', bg: 'bg-cyan-50' },
    { label: 'ค่าใช้จ่ายอื่น', amount: summary?.byAccountType?.OTHER_EXPENSE, icon: MoreHorizontal, color: 'text-gray-600', bg: 'bg-gray-100' },
  ];

  const totalPages = Math.ceil((expensesData?.total || 0) / 20);

  // Primary action per status
  const getPrimaryAction = (e: Expense) => {
    if (e.status === 'DRAFT' || e.status === 'REJECTED') return { label: 'ส่งอนุมัติ', action: 'submit', cls: 'bg-primary text-primary-foreground hover:bg-primary/90' };
    if (e.status === 'PENDING_APPROVAL' && isOwner) return { label: 'อนุมัติ', action: 'approve', cls: 'bg-green-600 text-white hover:bg-green-700' };
    if (e.status === 'APPROVED') return { label: 'จ่ายแล้ว', action: 'pay', cls: 'bg-green-600 text-white hover:bg-green-700' };
    return null;
  };

  const columns = [
    {
      key: 'expenseNumber', label: 'เลขที่',
      render: (e: Expense) => (<div className="min-w-0"><div className="font-medium">{e.expenseNumber}</div><div className="text-xs text-muted-foreground">{e.accountCode}</div></div>),
    },
    {
      key: 'description', label: 'รายละเอียด',
      render: (e: Expense) => (<div className="min-w-0"><div className="font-medium truncate">{e.description}</div><div className="text-xs text-muted-foreground">{categoryLabels[e.category] || e.category}</div></div>),
    },
    { key: 'branch', label: 'สาขา', render: (e: Expense) => e.branch.name },
    { key: 'vendorName', label: 'ผู้รับเงิน', render: (e: Expense) => e.vendorName || '-' },
    { key: 'amount', label: 'จำนวนเงิน', render: (e: Expense) => <div className="text-right text-sm">{fmt(e.amount)}</div> },
    { key: 'vatAmount', label: 'VAT', render: (e: Expense) => <div className="text-right text-sm">{Number(e.vatAmount) > 0 ? fmt(e.vatAmount) : '-'}</div> },
    { key: 'totalAmount', label: 'รวม', render: (e: Expense) => <div className="text-right font-medium">{fmt(e.totalAmount)}</div> },
    {
      key: 'expenseDate', label: 'วันที่',
      render: (e: Expense) => new Date(e.expenseDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }),
    },
    {
      key: 'status', label: 'สถานะ',
      render: (e: Expense) => (<div><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[e.status] || 'bg-muted'}`}>{statusLabels[e.status] || e.status}</span>
        {e.rejectReason && <div className="text-xs text-red-500 mt-0.5 truncate max-w-[100px]">{e.rejectReason}</div>}</div>),
    },
    {
      key: 'actions', label: '',
      render: (e: Expense) => {
        if (e.status === 'VOIDED' || e.status === 'PAID') return null;
        const primary = getPrimaryAction(e);
        return (
          <div className="flex items-center gap-1.5">
            {primary && (
              <button onClick={() => setConfirmDialog({ open: true, message: `${primary.label} "${e.expenseNumber}"?`, action: () => actionMutation.mutate({ id: e.id, action: primary.action }) })}
                className={`px-2.5 py-1 rounded text-xs font-medium ${primary.cls}`}>{primary.label}</button>
            )}
            <div className="relative">
              <button onClick={(ev) => { ev.stopPropagation(); setOpenMenuId(openMenuId === e.id ? null : e.id); }} className="p-1 hover:bg-muted rounded"><MoreVertical className="size-4 text-muted-foreground" /></button>
              {openMenuId === e.id && (
                <div className="absolute right-0 top-full mt-1 z-10 bg-background border rounded-lg shadow-lg py-1 min-w-[130px]">
                  {(e.status === 'DRAFT' || e.status === 'REJECTED') && <button onClick={() => openEdit(e)} className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted flex items-center gap-2"><Pencil className="size-3.5" /> แก้ไข</button>}
                  {e.status === 'PENDING_APPROVAL' && isOwner && <button onClick={() => { setRejectDialog({ open: true, expenseId: e.id, reason: '' }); setOpenMenuId(null); }} className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted text-red-600">ไม่อนุมัติ</button>}
                  {isOwner && <button onClick={() => { setConfirmDialog({ open: true, message: `ยกเลิก "${e.expenseNumber}"?`, action: () => actionMutation.mutate({ id: e.id, action: 'void' }) }); setOpenMenuId(null); }} className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted text-red-600">ยกเลิก</button>}
                </div>
              )}
            </div>
          </div>
        );
      },
    },
  ];

  return (
    <div onClick={() => setOpenMenuId(null)}>
      <PageHeader title="บันทึกรายจ่าย" subtitle={`ทั้งหมด ${expensesData?.total || 0} รายการ`} icon={<Receipt className="size-6" />}
        action={
          <button onClick={openCreate} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5">
            <Plus className="size-4" /> บันทึกรายจ่าย
          </button>
        }
      />

      {/* Summary Cards with icons */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {summaryCards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{card.label}</span>
                <div className={`p-2 rounded-lg ${card.bg}`}><card.icon className={`size-4 ${card.color}`} /></div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{fmt(card.amount)}</div>
              {card.sub && <div className="text-sm text-muted-foreground">{card.sub}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters with labels */}
      <div className="flex flex-wrap gap-4 mb-4">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">สถานะ</label>
          <select value={statusFilter} onChange={(e) => setFilter('status', e.target.value)} className={`${inputClass} w-auto min-w-[120px]`}>
            <option value="">ทั้งหมด</option>
            {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">หมวดบัญชี</label>
          <select value={accountTypeFilter} onChange={(e) => { setFilter('accountType', e.target.value); setFilter('category', ''); }} className={`${inputClass} w-auto min-w-[160px]`}>
            <option value="">ทั้งหมด</option>
            {Object.entries(accountTypeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">หมวดย่อย</label>
          <select value={categoryFilter} onChange={(e) => setFilter('category', e.target.value)} className={`${inputClass} w-auto min-w-[180px]`}>
            <option value="">ทั้งหมด</option>
            {Object.entries(categoryGroups).filter(([key]) => !accountTypeFilter || key === accountTypeFilter).map(([groupKey, cats]) => (
              <optgroup key={groupKey} label={accountTypeLabels[groupKey]}>{cats.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">สาขา</label>
          <select value={branchFilter} onChange={(e) => setFilter('branch', e.target.value)} className={`${inputClass} w-auto min-w-[120px]`}>
            <option value="">ทุกสาขา</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">ตั้งแต่</label>
          <input type="date" value={startDate} onChange={(e) => setFilter('startDate', e.target.value)} className={`${inputClass} w-auto`} />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">ถึง</label>
          <input type="date" value={endDate} onChange={(e) => setFilter('endDate', e.target.value)} className={`${inputClass} w-auto`} />
        </div>
        <div className="flex items-end gap-1">
          {quickPresets.map((p) => <button key={p.label} onClick={p.fn} className="px-3 py-2 text-xs border border-input rounded-lg hover:bg-muted">{p.label}</button>)}
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-muted-foreground mb-1">ค้นหา</label>
          <input type="text" placeholder="เลขที่, รายละเอียด, ผู้รับเงิน..." value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} />
        </div>
      </div>

      <DataTable columns={columns} data={expensesData?.data || []} isLoading={isLoading} emptyMessage="ไม่พบรายจ่าย" />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">หน้า {page} / {totalPages} (ทั้งหมด {expensesData?.total} รายการ)</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setFilter('page', String(page - 1))} className="px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-muted disabled:opacity-50">ก่อนหน้า</button>
            <button disabled={page >= totalPages} onClick={() => setFilter('page', String(page + 1))} className="px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-muted disabled:opacity-50">ถัดไป</button>
          </div>
        </div>
      )}

      {/* PEAK-style Form Panel */}
      {showForm && <ExpenseFormPanel editingExpense={editingExpense} branches={branches} onClose={() => { setShowForm(false); setEditingExpense(null); }} onSaved={handleFormSaved} />}

      {/* Reject Dialog */}
      <Modal isOpen={rejectDialog.open} onClose={() => setRejectDialog({ open: false, expenseId: '', reason: '' })} title="ไม่อนุมัติรายจ่าย">
        <div className="space-y-4">
          <div><label className="block text-xs text-muted-foreground mb-1">เหตุผล *</label><textarea value={rejectDialog.reason} onChange={(e) => setRejectDialog(prev => ({ ...prev, reason: e.target.value }))} rows={3} placeholder="กรุณาระบุเหตุผล..." className={inputClass} /></div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setRejectDialog({ open: false, expenseId: '', reason: '' })} className="px-4 py-2 text-sm text-muted-foreground">ยกเลิก</button>
            <button onClick={() => { if (!rejectDialog.reason.trim()) { toast.error('กรุณาระบุเหตุผล'); return; } actionMutation.mutate({ id: rejectDialog.expenseId, action: 'reject', body: { reason: rejectDialog.reason } }); setRejectDialog({ open: false, expenseId: '', reason: '' }); }}
              className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">ยืนยันไม่อนุมัติ</button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))} description={confirmDialog.message} onConfirm={confirmDialog.action} />
    </div>
  );
}
