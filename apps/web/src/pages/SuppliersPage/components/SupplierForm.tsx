import AddressForm, { AddressData } from '@/components/ui/AddressForm';
import type { PaymentMethod } from './SupplierTable';

export const emptyForm = {
  name: '',
  contactName: '',
  nickname: '',
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
            {/* Supplier Info */}
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
                    <path d="M3 9 12 2l9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">ข้อมูลผู้ขาย</h3>
                  <p className="text-xs text-muted-foreground">ชื่อบริษัท, ผู้ติดต่อ, ภาษี</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    ชื่อผู้ขาย / บริษัท <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    ชื่อ - นามสกุล (ผู้ติดต่อ) <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.contactName}
                    onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อเล่น</label>
                  <input
                    type="text"
                    value={form.nickname}
                    onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                    className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
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
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">LINE ID</label>
                  <input
                    type="text"
                    value={form.lineId}
                    onChange={(e) => setForm({ ...form, lineId: e.target.value })}
                    className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    เลขประจำตัวผู้เสียภาษี (Tax ID Number)
                  </label>
                  <input
                    type="text"
                    value={form.taxId}
                    onChange={(e) => setForm({ ...form, taxId: formatTaxId(e.target.value) })}
                    placeholder="X-XXXX-XXXXX-XX-X"
                    maxLength={17}
                    className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                  />
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
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
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
              </div>
            </div>

            {/* Payment Methods */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex items-center justify-center size-8 rounded-lg bg-emerald-500/10 text-emerald-500">
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
                      className="text-red-400 hover:text-red-600 text-xs font-medium"
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
                <div className="flex items-center justify-center size-8 rounded-lg bg-violet-500/10 text-violet-500">
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
                  <h3 className="text-sm font-semibold text-foreground">ที่อยู่</h3>
                  <p className="text-xs text-muted-foreground">ที่อยู่ผู้ขาย</p>
                </div>
              </div>
              <AddressForm value={supplierAddress} onChange={setSupplierAddress} label="" />
            </div>

            {/* Notes */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-rose-500/10 text-rose-500">
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
