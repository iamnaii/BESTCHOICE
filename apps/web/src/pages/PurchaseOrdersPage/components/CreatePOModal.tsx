import { UseMutationResult } from '@tanstack/react-query';
import { brands, getModels, getModelInfo } from '@/data/productCatalog';
import { ItemForm } from '../types';
import { accessoryTypes, chargerConnectorTypes } from '../constants';
import ThaiDateInput from '@/components/ui/ThaiDateInput';

export interface CreatePOModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: {
    supplierId: string;
    orderDate: string;
    expectedDate: string;
    notes: string;
    discount: string;
    paymentStatus: string;
    paymentMethod: string;
    paidAmount: string;
    paymentNotes: string;
  };
  setForm: React.Dispatch<React.SetStateAction<CreatePOModalProps['form']>>;
  items: ItemForm[];
  setItems: React.Dispatch<React.SetStateAction<ItemForm[]>>;
  addItem: () => void;
  removeItem: (idx: number) => void;
  updateItem: (idx: number, field: string, value: string) => void;
  toggleModel: (idx: number, modelName: string) => void;
  suppliers: { id: string; name: string; contactName: string; hasVat: boolean; paymentMethods: { paymentMethod: string; bankName?: string; bankAccountName?: string; bankAccountNumber?: string; creditTermDays?: number; isDefault: boolean }[] }[];
  suppliersLoading: boolean;
  suppliersError: boolean;
  selectedSupplier: CreatePOModalProps['suppliers'][number] | undefined;
  supplierHasVat: boolean;
  subtotal: number;
  discountNum: number;
  subtotalAfterDiscount: number;
  vatAmount: number;
  netAmount: number;
  createMutation: UseMutationResult<unknown, unknown, Record<string, unknown>, unknown>;
  handleCreate: (e: React.FormEvent) => void;
  attachmentUrl: string;
  setAttachmentUrl: (value: string) => void;
  formAttachments: string[];
  setFormAttachments: React.Dispatch<React.SetStateAction<string[]>>;
}

export function CreatePOModal({
  isOpen,
  onClose,
  form,
  setForm,
  items,
  setItems,
  addItem,
  removeItem,
  updateItem,
  toggleModel,
  suppliers,
  suppliersLoading,
  suppliersError,
  selectedSupplier,
  supplierHasVat,
  subtotal,
  discountNum,
  subtotalAfterDiscount,
  vatAmount,
  netAmount,
  createMutation,
  handleCreate,
  attachmentUrl,
  setAttachmentUrl,
  formAttachments,
  setFormAttachments,
}: CreatePOModalProps) {
  if (!isOpen) return null;

  const selectClass = 'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';
  const inputClass = selectClass;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label="สร้างใบสั่งซื้อ">
      <div className="w-full max-w-3xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">

        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">สร้างใบสั่งซื้อ</h2>
          <div className="w-16" />
        </div>

        {/* Scrollable Content */}
        <form onSubmit={handleCreate} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-5">

            {/* Section 1: Supplier Info (emerald) */}
            <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-emerald-500/10 text-emerald-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">ข้อมูลผู้ขาย</h3>
                  <p className="text-xs text-muted-foreground">เลือกผู้ขายและวันที่สั่งซื้อ</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ผู้ขาย <span className="text-destructive">*</span></label>
                  <select
                    value={form.supplierId}
                    onChange={(e) => {
                      const sid = e.target.value;
                      const sup = suppliers.find((s) => s.id === sid);
                      const defaultPm = sup?.paymentMethods?.find((pm) => pm.isDefault) || sup?.paymentMethods?.[0];
                      setForm({
                        ...form,
                        supplierId: sid,
                        paymentMethod: defaultPm?.paymentMethod || form.paymentMethod,
                      });
                    }}
                    className={selectClass}
                    required
                  >
                    <option value="">{suppliersLoading ? 'กำลังโหลด...' : suppliersError ? '⚠ โหลดข้อมูลไม่ได้' : '-- เลือกผู้ขาย --'}</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.contactName}){s.hasVat ? ' [VAT]' : ''}</option>
                    ))}
                  </select>
                  {selectedSupplier && (
                    <div className="mt-1 flex gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          supplierHasVat ? 'bg-primary-100 text-primary-700' : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {supplierHasVat ? 'ผู้ขายมี VAT - จะคำนวณ VAT 7% อัตโนมัติ' : 'ผู้ขายไม่มี VAT'}
                      </span>
                      {selectedSupplier.paymentMethods?.length > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                          ชำระ: {selectedSupplier.paymentMethods.map((pm) => {
                            const labels: Record<string, string> = { CASH: 'เงินสด', BANK_TRANSFER: 'โอนธนาคาร', CHECK: 'เช็ค', CREDIT: 'เครดิต' };
                            return labels[pm.paymentMethod] || pm.paymentMethod;
                          }).join(', ')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">วันที่สั่ง <span className="text-destructive">*</span></label>
                    <ThaiDateInput
                      value={form.orderDate}
                      onChange={(e) => setForm({ ...form, orderDate: e.target.value })}
                      className={inputClass}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">วันที่คาดรับสินค้า</label>
                    <ThaiDateInput
                      value={form.expectedDate}
                      onChange={(e) => setForm({ ...form, expectedDate: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Section 2: Items/Products (primary/blue) */}
            <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-foreground">รายการสินค้า</h3>
                  <p className="text-xs text-muted-foreground">เพิ่มสินค้าที่ต้องการสั่งซื้อ</p>
                </div>
                <button type="button" onClick={addItem} className="text-sm text-primary hover:text-primary/90 font-medium">
                  + เพิ่มรายการ
                </button>
              </div>

              <div className="space-y-4">
                {items.map((item, idx) => {
                  const isAccessory = item.category === 'ACCESSORY';
                  const isCharger = isAccessory && item.accessoryType === 'ชุดชาร์จ';
                  const availableModels = item.brand ? getModels(item.brand, isAccessory ? 'ACCESSORY' : (item.category || undefined)) : [];
                  const modelInfo = item.brand && item.model ? getModelInfo(item.brand, item.model) : undefined;
                  const availableColors = modelInfo?.colors || [];
                  const availableStorage = modelInfo?.storage || [];
                  const selectedModels = isAccessory && item.model ? item.model.split(', ').filter(Boolean) : [];

                  const accessoryAutoName = isAccessory ? (() => {
                    if (isCharger) {
                      return [item.accessoryType, item.accessoryBrand, item.model].filter(Boolean).join(' ');
                    }
                    const accParts = [item.accessoryType, item.accessoryBrand].filter(Boolean);
                    const modelStr = item.model;
                    return modelStr
                      ? `${accParts.join(' ')} สำหรับ ${modelStr}`
                      : accParts.join(' ');
                  })() : '';

                  return (
                    <div key={idx} className={`border rounded-lg p-3 space-y-2 relative ${isAccessory ? 'border-primary-200 bg-primary-50' : 'border-border bg-muted'}`}>
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="absolute top-2 right-2 text-red-400 hover:text-red-600 text-lg leading-none"
                        >
                          &times;
                        </button>
                      )}
                      <div className="text-xs font-medium text-muted-foreground mb-1">
                        รายการ #{idx + 1}
                        {isAccessory && <span className="ml-2 px-1.5 py-0.5 bg-primary-200 text-primary-700 rounded text-xs">อุปกรณ์เสริม</span>}
                      </div>

                      {/* Row 1: Category FIRST, then Brand/Model or AccessoryType */}
                      <div className={`grid ${isAccessory ? 'grid-cols-3' : 'grid-cols-3'} gap-2`}>
                        <div>
                          <label className="block text-xs text-muted-foreground mb-0.5">ประเภท <span className="text-destructive">*</span></label>
                          <select
                            value={item.category}
                            onChange={(e) => updateItem(idx, 'category', e.target.value)}
                            className={selectClass}
                          >
                            <option value="">-- เลือกประเภท --</option>
                            <option value="PHONE_NEW">โทรศัพท์ (ใหม่)</option>
                            <option value="PHONE_USED">โทรศัพท์ (มือสอง)</option>
                            <option value="TABLET">แท็บเล็ต</option>
                            <option value="ACCESSORY">อุปกรณ์เสริม</option>
                          </select>
                        </div>

                        {isAccessory ? (
                          <>
                            <div>
                              <label className="block text-xs text-muted-foreground mb-0.5">ประเภทอุปกรณ์ <span className="text-destructive">*</span></label>
                              <select
                                value={item.accessoryType}
                                onChange={(e) => updateItem(idx, 'accessoryType', e.target.value)}
                                className={selectClass}
                                required
                              >
                                <option value="">-- เลือก --</option>
                                {accessoryTypes.map((t) => (
                                  <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                              </select>
                            </div>

                            {isCharger ? (
                              <div>
                                <label className="block text-xs text-muted-foreground mb-0.5">ชนิด <span className="text-destructive">*</span></label>
                                <select
                                  value={item.model}
                                  onChange={(e) => { const ni = [...items]; ni[idx] = { ...ni[idx], model: e.target.value }; setItems(ni); }}
                                  className={selectClass}
                                  required
                                >
                                  <option value="">-- เลือก --</option>
                                  {chargerConnectorTypes.map((t) => (
                                    <option key={t.value} value={t.value}>{t.label}</option>
                                  ))}
                                </select>
                              </div>
                            ) : (
                              <div>
                                <label className="block text-xs text-muted-foreground mb-0.5">สำหรับยี่ห้อ</label>
                                <select
                                  value={item.brand}
                                  onChange={(e) => updateItem(idx, 'brand', e.target.value)}
                                  className={selectClass}
                                >
                                  <option value="">-- เลือกยี่ห้อโทรศัพท์ --</option>
                                  {brands.map((b) => (
                                    <option key={b} value={b}>{b}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div>
                              <label className="block text-xs text-muted-foreground mb-0.5">ยี่ห้อ <span className="text-destructive">*</span></label>
                              <select
                                value={item.brand}
                                onChange={(e) => updateItem(idx, 'brand', e.target.value)}
                                className={selectClass}
                                required
                                disabled={!item.category}
                              >
                                <option value="">-- เลือกยี่ห้อ --</option>
                                {brands.map((b) => (
                                  <option key={b} value={b}>{b}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-muted-foreground mb-0.5">รุ่น <span className="text-destructive">*</span></label>
                              <select
                                value={item.model}
                                onChange={(e) => updateItem(idx, 'model', e.target.value)}
                                className={selectClass}
                                required
                                disabled={!item.brand}
                              >
                                <option value="">-- เลือกรุ่น --</option>
                                {availableModels.map((m) => (
                                  <option key={m.name} value={m.name}>{m.name}</option>
                                ))}
                              </select>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Multi-model selection for accessories (non-charger) */}
                      {isAccessory && !isCharger && item.accessoryType && item.brand && availableModels.length > 0 && (
                        <div>
                          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สำหรับรุ่น (เลือกได้หลายรุ่น)</label>
                          <div className="flex flex-wrap gap-1.5">
                            {availableModels.map((m) => {
                              const isSelected = selectedModels.includes(m.name);
                              return (
                                <button
                                  key={m.name}
                                  type="button"
                                  onClick={() => toggleModel(idx, m.name)}
                                  className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                                    isSelected
                                      ? 'bg-primary text-primary-foreground border-primary'
                                      : 'bg-background text-muted-foreground border-input hover:border-primary-400 hover:text-primary'
                                  }`}
                                >
                                  {m.name}
                                </button>
                              );
                            })}
                          </div>
                          {selectedModels.length > 0 && (
                            <div className="text-xs text-primary-500 mt-1">เลือกแล้ว {selectedModels.length} รุ่น</div>
                          )}
                        </div>
                      )}

                      {isAccessory ? (
                        <>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-xs text-muted-foreground mb-0.5">ยี่ห้ออุปกรณ์</label>
                              <input
                                type="text"
                                value={item.accessoryBrand}
                                onChange={(e) => updateItem(idx, 'accessoryBrand', e.target.value)}
                                className={inputClass}
                                placeholder="เช่น Spigen, Anker"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-muted-foreground mb-0.5">จำนวน <span className="text-destructive">*</span></label>
                              <input
                                type="number"
                                value={item.quantity}
                                onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                                className={inputClass}
                                min="1"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-muted-foreground mb-0.5">ราคา/ชิ้น <span className="text-destructive">*</span></label>
                              <input
                                type="number"
                                value={item.unitPrice}
                                onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)}
                                className={inputClass}
                                required
                              />
                            </div>
                          </div>
                          {accessoryAutoName && (
                            <div className="text-xs text-primary bg-primary-100 rounded px-2 py-1">
                              ชื่อสินค้า: {accessoryAutoName}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="grid grid-cols-4 gap-2">
                          <div>
                            <label className="block text-xs text-muted-foreground mb-0.5">สี</label>
                            <select
                              value={item.color}
                              onChange={(e) => updateItem(idx, 'color', e.target.value)}
                              className={selectClass}
                              disabled={availableColors.length === 0}
                            >
                              <option value="">-- เลือกสี --</option>
                              {availableColors.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-muted-foreground mb-0.5">ความจุ</label>
                            <select
                              value={item.storage}
                              onChange={(e) => updateItem(idx, 'storage', e.target.value)}
                              className={selectClass}
                              disabled={availableStorage.length === 0}
                            >
                              <option value="">-- เลือกความจุ --</option>
                              {availableStorage.map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-muted-foreground mb-0.5">จำนวน <span className="text-destructive">*</span></label>
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                              className={inputClass}
                              min="1"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-muted-foreground mb-0.5">ราคา/ชิ้น <span className="text-destructive">*</span></label>
                            <input
                              type="number"
                              value={item.unitPrice}
                              onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)}
                              className={inputClass}
                              required
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Section 3: Summary/Pricing (violet) */}
            <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-violet-500/10 text-violet-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">สรุปยอด</h3>
                  <p className="text-xs text-muted-foreground">ยอดรวม ส่วนลด และ VAT</p>
                </div>
              </div>

              <div className="bg-muted rounded-lg p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ยอดรวมสินค้า</span>
                  <span className="font-medium tabular-nums font-mono">{subtotal.toLocaleString()} บาท</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">ส่วนลด</span>
                  <input
                    type="number"
                    value={form.discount}
                    onChange={(e) => setForm({ ...form, discount: e.target.value })}
                    className="w-32 px-2 py-1 border border-input rounded text-sm text-right focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                    min="0"
                    placeholder="0"
                  />
                </div>
                {discountNum > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>หลังหักส่วนลด</span>
                    <span>{subtotalAfterDiscount.toLocaleString()} บาท</span>
                  </div>
                )}
                {supplierHasVat && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>VAT 7%</span>
                    <span>{vatAmount.toLocaleString()} บาท</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-1 mt-1 font-semibold text-base">
                  <span>ยอดสุทธิ</span>
                  <span className="text-primary tabular-nums font-mono">{netAmount.toLocaleString()} บาท</span>
                </div>
              </div>
            </div>

            {/* Section 4: Payment (orange) */}
            <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-orange-500/10 text-orange-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">การจ่ายเงิน</h3>
                  <p className="text-xs text-muted-foreground">สถานะและวิธีการชำระเงิน</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-0.5">สถานะ</label>
                  <select
                    value={form.paymentStatus}
                    onChange={(e) => {
                      const newStatus = e.target.value;
                      setForm({
                        ...form,
                        paymentStatus: newStatus,
                        paidAmount: newStatus === 'FULLY_PAID' ? String(Math.round(netAmount * 100) / 100) : newStatus === 'UNPAID' ? '' : form.paidAmount,
                      });
                    }}
                    className={selectClass}
                  >
                    <option value="UNPAID">ยังไม่จ่าย</option>
                    <option value="DEPOSIT_PAID">จ่ายมัดจำ</option>
                    <option value="PARTIALLY_PAID">จ่ายบางส่วน</option>
                    <option value="FULLY_PAID">จ่ายครบแล้ว</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-0.5">วิธีจ่ายเงิน</label>
                  <select
                    value={form.paymentMethod}
                    onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                    className={selectClass}
                    disabled={form.paymentStatus === 'UNPAID'}
                  >
                    <option value="">-- เลือก --</option>
                    {selectedSupplier?.paymentMethods?.length ? (
                      selectedSupplier.paymentMethods.map((pm, idx) => {
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
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-0.5">จำนวนที่จ่าย (บาท)</label>
                  <input
                    type="number"
                    value={form.paidAmount}
                    onChange={(e) => setForm({ ...form, paidAmount: e.target.value })}
                    className={inputClass}
                    min="0"
                    step="0.01"
                    disabled={form.paymentStatus === 'UNPAID'}
                    placeholder={form.paymentStatus === 'UNPAID' ? '-' : '0'}
                  />
                  {form.paymentStatus !== 'UNPAID' && form.paymentStatus !== 'FULLY_PAID' && netAmount > 0 && (
                    <div className="flex gap-2 mt-1">
                      <button type="button" onClick={() => setForm({ ...form, paidAmount: String(Math.round(netAmount * 0.3)) })} className="text-xs text-primary hover:underline">30%</button>
                      <button type="button" onClick={() => setForm({ ...form, paidAmount: String(Math.round(netAmount * 0.5)) })} className="text-xs text-primary hover:underline">50%</button>
                    </div>
                  )}
                </div>
              </div>
              {form.paymentStatus !== 'UNPAID' && (
                <div className="mt-2">
                  <label className="block text-xs text-muted-foreground mb-0.5">หมายเหตุการจ่ายเงิน</label>
                  <input
                    type="text"
                    value={form.paymentNotes}
                    onChange={(e) => setForm({ ...form, paymentNotes: e.target.value })}
                    className={inputClass}
                    placeholder="เช่น เลขอ้างอิง, ชื่อบัญชี"
                  />
                </div>
              )}
            </div>

            {/* Section 5: Attachments (sky) - only shown when payment is not UNPAID */}
            {form.paymentStatus !== 'UNPAID' && (
              <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="flex items-center justify-center size-8 rounded-lg bg-sky-500/10 text-sky-500">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">แนบสลิป/เอกสาร</h3>
                    <p className="text-xs text-muted-foreground">แนบหลักฐานการชำระเงิน</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <label className="flex items-center gap-1 px-3 py-2 bg-primary-50 text-primary-700 border border-primary-200 rounded-lg text-xs cursor-pointer hover:bg-primary-100 whitespace-nowrap">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
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
                            setFormAttachments((prev) => [...prev, reader.result as string]);
                          };
                          reader.readAsDataURL(file);
                        });
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <input
                    type="text"
                    value={attachmentUrl}
                    onChange={(e) => setAttachmentUrl(e.target.value)}
                    className={inputClass}
                    placeholder="หรือวาง URL"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (attachmentUrl.trim()) {
                        setFormAttachments([...formAttachments, attachmentUrl.trim()]);
                        setAttachmentUrl('');
                      }
                    }}
                    className="px-3 py-2 bg-secondary rounded-lg text-sm hover:bg-muted/50 whitespace-nowrap"
                  >
                    + เพิ่ม
                  </button>
                </div>
                {formAttachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {formAttachments.map((att, idx) => (
                      <div key={idx} className="relative group">
                        {att.startsWith('data:image') ? (
                          <img src={att} alt={`แนบ ${idx + 1}`} className="h-16 w-16 object-cover rounded-lg border" />
                        ) : (
                          <div className="h-16 w-16 flex items-center justify-center bg-primary-50 rounded-lg border text-2xs text-primary p-1 break-all overflow-hidden">
                            <a href={att} target="_blank" rel="noopener noreferrer" className="hover:underline">{att.length > 20 ? att.slice(0, 20) + '...' : att}</a>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setFormAttachments(formAttachments.filter((_, i) => i !== idx))}
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-2xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Notes - simple field at the bottom */}
            <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex items-center justify-center size-8 rounded-lg bg-muted text-muted-foreground">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">หมายเหตุ</h3>
                  <p className="text-xs text-muted-foreground">บันทึกเพิ่มเติมสำหรับใบสั่งซื้อ</p>
                </div>
              </div>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className={inputClass}
              />
            </div>

          </div>

          {/* Sticky Footer */}
          <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-end gap-3 shrink-0">
            <button type="button" onClick={onClose} className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
            >
              {createMutation.isPending ? 'กำลังสร้าง...' : 'สร้าง PO'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
