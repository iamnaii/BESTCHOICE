import { Building2, User2 } from 'lucide-react';
import AddressForm, { AddressData } from '@/components/ui/AddressForm';
import { cn } from '@/lib/utils';
import type { PaymentMethod } from './SupplierTable';

export type SupplierType = 'INDIVIDUAL' | 'JURISTIC';

export const emptyForm = {
  type: 'JURISTIC' as SupplierType,
  name: '',
  titleName: '',
  contactName: '',
  contactPhone: '',
  contactPosition: '',
  nickname: '',
  branchCode: '',
  phone: '',
  phoneSecondary: '',
  lineId: '',
  taxId: '',
  hasVat: false,
  notes: '',
};

export type SupplierFormData = typeof emptyForm;

export const emptyPaymentMethod: PaymentMethod = {
  paymentMethod: '',
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  creditTermDays: '',
  isDefault: false,
};

const TITLE_OPTIONS = ['นาย', 'นาง', 'นางสาว', 'คุณ'];

export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function formatTaxId(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 1) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 1)}-${digits.slice(1)}`;
  if (digits.length <= 10)
    return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5)}`;
  if (digits.length <= 12)
    return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10)}`;
  return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
}

export function formatBranchCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 5);
}

interface SupplierFormProps {
  isEditing: boolean;
  form: SupplierFormData;
  setForm: (form: SupplierFormData) => void;
  paymentMethods: PaymentMethod[];
  setPaymentMethods: (methods: PaymentMethod[]) => void;
  supplierAddress: AddressData;
  setSupplierAddress: (address: AddressData) => void;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export default function SupplierForm({
  isEditing,
  form,
  setForm,
  paymentMethods,
  setPaymentMethods,
  supplierAddress,
  setSupplierAddress,
  isPending,
  onClose,
  onSubmit,
}: SupplierFormProps) {
  const isJuristic = form.type === 'JURISTIC';

  const changeType = (nextType: SupplierType) => {
    if (nextType === form.type) return;
    setForm({
      ...form,
      type: nextType,
      // reset type-specific fields so stale data ไม่ค้าง
      titleName: nextType === 'INDIVIDUAL' ? form.titleName : '',
      nickname: nextType === 'INDIVIDUAL' ? form.nickname : '',
      branchCode: nextType === 'JURISTIC' ? form.branchCode : '',
      contactName: nextType === 'JURISTIC' ? form.contactName : '',
      contactPhone: nextType === 'JURISTIC' ? form.contactPhone : '',
      contactPosition: nextType === 'JURISTIC' ? form.contactPosition : '',
      hasVat: nextType === 'JURISTIC' ? form.hasVat : false,
    });
  };

  const addPaymentMethod = () => {
    setPaymentMethods([
      ...paymentMethods,
      { ...emptyPaymentMethod, isDefault: paymentMethods.length === 0 },
    ]);
  };

  const removePaymentMethod = (index: number) => {
    const updated = paymentMethods.filter((_, i) => i !== index);
    if (updated.length > 0 && !updated.some((pm) => pm.isDefault)) {
      updated[0] = { ...updated[0], isDefault: true };
    }
    setPaymentMethods(updated);
  };

  const updatePaymentMethod = (
    index: number,
    field: keyof PaymentMethod,
    value: string | number | boolean,
  ) => {
    const updated = paymentMethods.map((pm, i) => {
      if (field === 'isDefault' && value === true) {
        return { ...pm, isDefault: i === index };
      }
      if (i === index) {
        return { ...pm, [field]: value };
      }
      return pm;
    });
    setPaymentMethods(updated);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8"
      role="dialog"
      aria-modal="true"
      aria-label={isEditing ? 'แก้ไขผู้ขาย' : 'เพิ่มผู้ขายใหม่'}
    >
      <div className="w-full max-w-2xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">
            {isEditing ? 'แก้ไขผู้ขาย' : 'เพิ่มผู้ขายใหม่'}
          </h2>
          <div className="w-16" />
        </div>

        <form onSubmit={onSubmit} className="flex-1 overflow-y-auto flex flex-col">
          <div className="p-6 space-y-5 flex-1">
            {/* Type Selector */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-foreground">ประเภทผู้ขาย</h3>
                <p className="text-xs text-muted-foreground">
                  เลือกให้ตรงกับเอกสารประกอบใบกำกับภาษี
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => changeType('JURISTIC')}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                    isJuristic
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-input hover:border-primary/40 hover:bg-muted',
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center justify-center size-9 rounded-lg shrink-0',
                      isJuristic
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    <Building2 className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">นิติบุคคล</div>
                    <div className="text-xs text-muted-foreground leading-snug">
                      บริษัท, ห้างหุ้นส่วน, ร้านค้าจดทะเบียน
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => changeType('INDIVIDUAL')}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                    !isJuristic
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-input hover:border-primary/40 hover:bg-muted',
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center justify-center size-9 rounded-lg shrink-0',
                      !isJuristic
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    <User2 className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">บุคคลธรรมดา</div>
                    <div className="text-xs text-muted-foreground leading-snug">
                      ขายของมือสอง, freelancer, รายย่อย
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Main Info */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                  {isJuristic ? <Building2 className="size-4" /> : <User2 className="size-4" />}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {isJuristic ? 'ข้อมูลบริษัท' : 'ข้อมูลผู้ขาย'}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {isJuristic
                      ? 'ชื่อบริษัท, เลขผู้เสียภาษี, รหัสสาขา'
                      : 'คำนำหน้า, ชื่อ-นามสกุล, เลขประชาชน'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {!isJuristic && (
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      คำนำหน้า
                    </label>
                    <select
                      value={form.titleName}
                      onChange={(e) => setForm({ ...form, titleName: e.target.value })}
                      className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="">-- เลือก --</option>
                      {TITLE_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className={cn(isJuristic ? 'col-span-2' : 'col-span-1')}>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    {isJuristic ? 'ชื่อบริษัท' : 'ชื่อ - นามสกุล'}{' '}
                    <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={isJuristic ? 'บริษัท ... จำกัด' : 'เช่น สมชาย ใจดี'}
                    className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    เบอร์โทรศัพท์ <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })}
                    placeholder="0XX-XXX-XXXX"
                    maxLength={12}
                    className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">เบอร์โทรสำรอง</label>
                  <input
                    type="text"
                    value={form.phoneSecondary}
                    onChange={(e) =>
                      setForm({ ...form, phoneSecondary: formatPhone(e.target.value) })
                    }
                    placeholder="0XX-XXX-XXXX"
                    maxLength={12}
                    className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div className={cn(isJuristic ? 'col-span-2' : 'col-span-1')}>
                  <label className="block text-xs font-medium text-foreground mb-1.5">LINE ID</label>
                  <input
                    type="text"
                    value={form.lineId}
                    onChange={(e) => setForm({ ...form, lineId: e.target.value })}
                    className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                {!isJuristic && (
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อเล่น</label>
                    <input
                      type="text"
                      value={form.nickname}
                      onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                      className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                )}
                <div className="col-span-2 border-t pt-4">
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    {isJuristic ? 'เลขประจำตัวผู้เสียภาษี' : 'เลขประจำตัวประชาชน'}{' '}
                    <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.taxId}
                    onChange={(e) => setForm({ ...form, taxId: formatTaxId(e.target.value) })}
                    placeholder="X-XXXX-XXXXX-XX-X"
                    maxLength={17}
                    className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>
                {isJuristic && (
                  <>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-foreground mb-1.5">
                        รหัสสาขา (5 หลัก) <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        value={form.branchCode}
                        onChange={(e) =>
                          setForm({ ...form, branchCode: formatBranchCode(e.target.value) })
                        }
                        placeholder="00000 = สำนักงานใหญ่"
                        maxLength={5}
                        inputMode="numeric"
                        className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm font-mono transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                        required
                      />
                      <p className="mt-1 text-2xs text-muted-foreground">
                        "00000" สำหรับสำนักงานใหญ่ — ใช้ในใบกำกับภาษีของผู้จด VAT
                      </p>
                    </div>
                    <div className="col-span-2">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <span className="text-sm font-medium text-foreground">จดทะเบียน VAT</span>
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, hasVat: !form.hasVat })}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            form.hasVat ? 'bg-primary' : 'bg-border'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                              form.hasVat ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                        <span
                          className={`text-sm font-medium ${form.hasVat ? 'text-primary' : 'text-muted-foreground'}`}
                        >
                          {form.hasVat ? 'มี VAT (7%)' : 'ไม่มี VAT'}
                        </span>
                      </label>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Contact Person (JURISTIC only) */}
            {isJuristic && (
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                    <User2 className="size-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">ผู้ติดต่อ</h3>
                    <p className="text-xs text-muted-foreground">
                      ชื่อพนักงาน/ฝ่ายที่ติดต่อกับเรา (ไม่บังคับ)
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      ชื่อ - นามสกุล
                    </label>
                    <input
                      type="text"
                      value={form.contactName}
                      onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                      placeholder="เช่น สมหญิง ทองคำ"
                      className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      เบอร์โทร
                    </label>
                    <input
                      type="text"
                      value={form.contactPhone}
                      onChange={(e) =>
                        setForm({ ...form, contactPhone: formatPhone(e.target.value) })
                      }
                      placeholder="0XX-XXX-XXXX"
                      maxLength={12}
                      className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      ตำแหน่ง
                    </label>
                    <input
                      type="text"
                      value={form.contactPosition}
                      onChange={(e) => setForm({ ...form, contactPosition: e.target.value })}
                      placeholder="เช่น เซลส์, บัญชี, จัดซื้อ"
                      className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Payment Methods */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex items-center justify-center size-8 rounded-lg bg-success/10 text-success">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect width="20" height="14" x="2" y="5" rx="2" />
                      <line x1="2" x2="22" y1="10" y2="10" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">ข้อมูลการชำระเงิน</h3>
                    <p className="text-xs text-muted-foreground">วิธีรับชำระเงินจากผู้ขาย</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addPaymentMethod}
                  className="px-3 py-1 text-xs bg-primary/5 dark:bg-primary/10 text-primary rounded-lg hover:bg-primary/15 transition-colors font-medium"
                >
                  + เพิ่มวิธีชำระเงิน
                </button>
              </div>

              {paymentMethods.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-3 bg-muted rounded-lg">
                  ยังไม่มีข้อมูลการชำระเงิน กดปุ่ม "เพิ่มวิธีชำระเงิน" เพื่อเพิ่ม
                </p>
              )}

              {paymentMethods.map((pm, index) => (
                <div key={index} className="border border-border rounded-lg p-3 mb-3 bg-muted">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">
                        วิธีที่ {index + 1}
                      </span>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="defaultPayment"
                          checked={pm.isDefault}
                          onChange={() => updatePaymentMethod(index, 'isDefault', true)}
                          className="text-primary"
                        />
                        <span className="text-xs text-muted-foreground">ค่าเริ่มต้น</span>
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => removePaymentMethod(index)}
                      className="text-destructive/80 hover:text-destructive text-xs font-medium"
                    >
                      ลบ
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                        วิธีชำระเงิน *
                      </label>
                      <select
                        value={pm.paymentMethod}
                        onChange={(e) => updatePaymentMethod(index, 'paymentMethod', e.target.value)}
                        className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                        required
                      >
                        <option value="">-- เลือก --</option>
                        <option value="CASH">เงินสด</option>
                        <option value="BANK_TRANSFER">โอนธนาคาร</option>
                        <option value="CHECK">เช็ค</option>
                        <option value="CREDIT">เครดิต</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                        เครดิต (วัน)
                      </label>
                      <input
                        type="number"
                        value={pm.creditTermDays}
                        onChange={(e) =>
                          updatePaymentMethod(index, 'creditTermDays', e.target.value)
                        }
                        placeholder="เช่น 30"
                        min={0}
                        className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    {(pm.paymentMethod === 'BANK_TRANSFER' || pm.paymentMethod === 'CHECK') && (
                      <>
                        <div>
                          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                            ธนาคาร
                          </label>
                          <input
                            type="text"
                            value={pm.bankName}
                            onChange={(e) => updatePaymentMethod(index, 'bankName', e.target.value)}
                            placeholder="เช่น กสิกรไทย, กรุงเทพ"
                            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                        <div>
                          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                            ชื่อบัญชี
                          </label>
                          <input
                            type="text"
                            value={pm.bankAccountName}
                            onChange={(e) =>
                              updatePaymentMethod(index, 'bankAccountName', e.target.value)
                            }
                            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                            เลขบัญชี
                          </label>
                          <input
                            type="text"
                            value={pm.bankAccountNumber}
                            onChange={(e) =>
                              updatePaymentMethod(index, 'bankAccountNumber', e.target.value)
                            }
                            placeholder="XXX-X-XXXXX-X"
                            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Address */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {isJuristic ? 'ที่อยู่จดทะเบียน' : 'ที่อยู่ตามบัตรประชาชน'}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {isJuristic
                      ? 'ที่อยู่บริษัทสำหรับใบกำกับภาษี'
                      : 'ที่อยู่ผู้ขาย'}
                  </p>
                </div>
              </div>
              <AddressForm value={supplierAddress} onChange={setSupplierAddress} label="" />
            </div>

            {/* Notes */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-destructive/10 text-destructive">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">หมายเหตุ</h3>
                  <p className="text-xs text-muted-foreground">ข้อมูลเพิ่มเติม</p>
                </div>
              </div>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20 resize-none"
              />
            </div>
          </div>

          <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
            >
              {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
