import { UseMutationResult } from '@tanstack/react-query';
import { formatDateMedium } from '@/utils/formatters';
import { PurchaseOrder } from '../types';

export interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPO: PurchaseOrder | null;
  suppliers: { id: string; name: string; contactName: string; hasVat: boolean; paymentMethods: { paymentMethod: string; bankName?: string; bankAccountName?: string; bankAccountNumber?: string; creditTermDays?: number; isDefault: boolean }[] }[];
  paymentForm: { paymentStatus: string; paymentMethod: string; paidAmount: string; paymentNotes: string };
  setPaymentForm: React.Dispatch<React.SetStateAction<PaymentModalProps['paymentForm']>>;
  paymentAttachments: string[];
  setPaymentAttachments: React.Dispatch<React.SetStateAction<string[]>>;
  paymentAttachmentUrl: string;
  setPaymentAttachmentUrl: (value: string) => void;
  paymentMutation: UseMutationResult<unknown, unknown, { poId: string; data: Record<string, unknown> }, unknown>;
  handlePaymentUpdate: (e: React.FormEvent) => void;
}

export function PaymentModal({
  isOpen,
  onClose,
  selectedPO,
  suppliers,
  paymentForm,
  setPaymentForm,
  paymentAttachments,
  setPaymentAttachments,
  paymentAttachmentUrl,
  setPaymentAttachmentUrl,
  paymentMutation,
  handlePaymentUpdate,
}: PaymentModalProps) {
  const selectClass = 'w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20';
  const inputClass = selectClass;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label={`อัปเดตการจ่ายเงิน - ${selectedPO?.poNumber || ''}`}>
      <div className="w-full max-w-2xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">อัปเดตการจ่ายเงิน {selectedPO?.poNumber || ''}</h2>
          <div className="w-16" />
        </div>
      {selectedPO && (
        <form onSubmit={handlePaymentUpdate} className="flex-1 overflow-y-auto flex flex-col">
          <div className="p-6 space-y-5 flex-1">
          <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">สรุปใบสั่งซื้อ</h3>
                <p className="text-xs text-muted-foreground">ยอดรวมและสถานะการชำระ</p>
              </div>
            </div>
          <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">ยอดรวมสินค้า:</span>
              <span className="tabular-nums font-mono">{Number(selectedPO.totalAmount).toLocaleString()} บาท</span>
            </div>
            {Number(selectedPO.discount) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">ส่วนลด:</span>
                <span className="text-destructive">-{Number(selectedPO.discount).toLocaleString()} บาท</span>
              </div>
            )}
            {Number(selectedPO.vatAmount) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">VAT 7%:</span>
                <span>{Number(selectedPO.vatAmount).toLocaleString()} บาท</span>
              </div>
            )}
            <div className="flex justify-between font-medium border-t pt-1">
              <span>ยอดสุทธิ:</span>
              <span>{Number(selectedPO.netAmount ?? selectedPO.totalAmount).toLocaleString()} บาท</span>
            </div>
            {Number(selectedPO.paidAmount) > 0 && (
              <>
                <div className="flex justify-between text-success">
                  <span>จ่ายแล้วก่อนหน้า:</span>
                  <span>{Number(selectedPO.paidAmount).toLocaleString()} บาท</span>
                </div>
                <div className="flex justify-between font-semibold text-warning">
                  <span>คงเหลือ:</span>
                  <span>{(Number(selectedPO.netAmount ?? selectedPO.totalAmount) - Number(selectedPO.paidAmount)).toLocaleString()} บาท</span>
                </div>
              </>
            )}
            {selectedPO.dueDate && (
              <div className={`flex justify-between border-t pt-1 ${new Date(selectedPO.dueDate) < new Date() && paymentForm.paymentStatus !== 'FULLY_PAID' ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                <span>ครบกำหนดชำระ:</span>
                <span>
                  {formatDateMedium(selectedPO.dueDate)}
                  {new Date(selectedPO.dueDate) < new Date() && paymentForm.paymentStatus !== 'FULLY_PAID' && ' (เลยกำหนด)'}
                </span>
              </div>
            )}
          </div>
          </div>

          <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-success/10 text-success">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">รายละเอียดการชำระ</h3>
                <p className="text-xs text-muted-foreground">สถานะ วิธี และจำนวนเงิน</p>
              </div>
            </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">สถานะ <span className="text-destructive">*</span></label>
              <select
                value={paymentForm.paymentStatus}
                onChange={(e) => {
                  const newStatus = e.target.value;
                  const netAmt = Number(selectedPO.netAmount ?? selectedPO.totalAmount);
                  setPaymentForm({
                    ...paymentForm,
                    paymentStatus: newStatus,
                    paidAmount: newStatus === 'FULLY_PAID' ? String(netAmt) : newStatus === 'UNPAID' ? '0' : paymentForm.paidAmount,
                  });
                }}
                className={selectClass}
                required
              >
                <option value="UNPAID">ยังไม่จ่าย</option>
                <option value="DEPOSIT_PAID">จ่ายมัดจำ</option>
                <option value="PARTIALLY_PAID">จ่ายบางส่วน</option>
                <option value="FULLY_PAID">จ่ายครบแล้ว</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">วิธีจ่ายเงิน</label>
              {(() => {
                const poSupplier = suppliers.find((s) => s.id === selectedPO?.supplier.id);
                const pmList = poSupplier?.paymentMethods;
                return (
                  <select
                    value={paymentForm.paymentMethod}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                    className={selectClass}
                  >
                    <option value="">-- เลือก --</option>
                    {pmList?.length ? (
                      pmList.map((pm, idx) => {
                        const labels: Record<string, string> = { CASH: 'เงินสด', BANK_TRANSFER: 'โอนธนาคาร', CHECK: 'เช็ค', CREDIT: 'เครดิต' };
                        const label = labels[pm.paymentMethod] || pm.paymentMethod;
                        const detail = pm.bankName ? ` - ${pm.bankName}${pm.bankAccountNumber ? ` (${pm.bankAccountNumber})` : ''}` : '';
                        const credit = pm.creditTermDays ? ` ${pm.creditTermDays} วัน` : '';
                        return <option key={idx} value={pm.paymentMethod}>{label}{detail}{credit}{pm.isDefault ? ' (ค่าเริ่มต้น)' : ''}</option>;
                      })
                    ) : (
                      <>
                        <option value="CASH">เงินสด</option>
                        <option value="BANK_TRANSFER">โอนธนาคาร</option>
                        <option value="CHECK">เช็ค</option>
                        <option value="CREDIT">เครดิต</option>
                      </>
                    )}
                  </select>
                );
              })()}
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-xs font-medium text-foreground mb-1.5">จำนวนเงินที่จ่ายแล้ว (บาท) <span className="text-destructive">*</span></label>
            <input
              type="number"
              value={paymentForm.paidAmount}
              onChange={(e) => setPaymentForm({ ...paymentForm, paidAmount: e.target.value })}
              className={inputClass}
              min="0"
              step="0.01"
              required
            />
            {Number(selectedPO.netAmount ?? selectedPO.totalAmount) > 0 && paymentForm.paymentStatus !== 'UNPAID' && paymentForm.paymentStatus !== 'FULLY_PAID' && (
              <div className="flex gap-2 mt-1">
                <button type="button" onClick={() => setPaymentForm({ ...paymentForm, paidAmount: String(Math.round(Number(selectedPO.netAmount ?? selectedPO.totalAmount) * 0.3)) })} className="text-xs text-primary hover:underline">30%</button>
                <button type="button" onClick={() => setPaymentForm({ ...paymentForm, paidAmount: String(Math.round(Number(selectedPO.netAmount ?? selectedPO.totalAmount) * 0.5)) })} className="text-xs text-primary hover:underline">50%</button>
              </div>
            )}
            {(() => {
              const netAmt = Number(selectedPO.netAmount ?? selectedPO.totalAmount);
              const paid = Number(paymentForm.paidAmount) || 0;
              const remaining = netAmt - paid;
              if (paid > 0 && remaining > 0) {
                return (
                  <div className="mt-2 p-2 bg-warning/10 border border-warning/20 rounded-lg text-sm">
                    <div className="flex justify-between text-warning">
                      <span>ยอดคงเหลือที่ต้องจ่าย:</span>
                      <span className="font-semibold">{remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>
                    </div>
                  </div>
                );
              }
              if (paid > netAmt && netAmt > 0) {
                return (
                  <div className="mt-2 p-2 bg-destructive/5 dark:bg-destructive/10 border border-destructive/20 rounded-lg text-sm">
                    <span className="text-destructive">จำนวนที่จ่ายเกินยอดสุทธิ {(paid - netAmt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>
                  </div>
                );
              }
              return null;
            })()}
          </div>

          </div>

          <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-info/10 text-info">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">หมายเหตุ</h3>
                <p className="text-xs text-muted-foreground">ข้อมูลเพิ่มเติมเกี่ยวกับการชำระ</p>
              </div>
            </div>
            <textarea
              value={paymentForm.paymentNotes}
              onChange={(e) => setPaymentForm({ ...paymentForm, paymentNotes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
              placeholder="เช่น เลขอ้างอิง, ชื่อบัญชี"
            />
          </div>

          {/* Attachments - File upload + URL */}
          <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-destructive/10 text-destructive">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">แนบสลิป/เอกสาร</h3>
                <p className="text-xs text-muted-foreground">รูปภาพหรือลิงก์เอกสาร</p>
              </div>
            </div>
            <div className="flex gap-2">
              <label className="flex items-center gap-1.5 px-3 py-2 bg-primary-50 text-primary-700 border border-primary-200 rounded-lg text-sm cursor-pointer hover:bg-primary-100 whitespace-nowrap">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                เลือกรูป
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    files.forEach((file) => {
                      const reader = new FileReader();
                      reader.onload = () => {
                        setPaymentAttachments((prev) => [...prev, reader.result as string]);
                      };
                      reader.readAsDataURL(file);
                    });
                    e.target.value = '';
                  }}
                />
              </label>
              <input
                type="text"
                value={paymentAttachmentUrl}
                onChange={(e) => setPaymentAttachmentUrl(e.target.value)}
                className={inputClass}
                placeholder="หรือวาง URL"
              />
              <button
                type="button"
                onClick={() => {
                  if (paymentAttachmentUrl.trim()) {
                    setPaymentAttachments([...paymentAttachments, paymentAttachmentUrl.trim()]);
                    setPaymentAttachmentUrl('');
                  }
                }}
                className="px-3 py-2 bg-secondary rounded-lg text-sm hover:bg-muted/50 whitespace-nowrap"
              >
                + เพิ่ม
              </button>
            </div>
            {paymentAttachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {paymentAttachments.map((att, idx) => (
                  <div key={idx} className="relative group">
                    {att.startsWith('data:image') ? (
                      <img src={att} alt={`สลิป ${idx + 1}`} className="h-20 w-20 object-cover rounded-lg border" />
                    ) : (
                      <div className="h-20 w-20 flex items-center justify-center bg-primary-50 rounded-lg border text-xs text-primary p-1 break-all overflow-hidden">
                        <a href={att} target="_blank" rel="noopener noreferrer" className="hover:underline">{att.length > 30 ? att.slice(0, 30) + '...' : att}</a>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setPaymentAttachments(paymentAttachments.filter((_, i) => i !== idx))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-destructive-foreground rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          </div>
          <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-end gap-3 shrink-0">
            <button type="button" onClick={onClose} className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={paymentMutation.isPending}
              className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
            >
              {paymentMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      )}
      </div>
    </div>
  );
}
