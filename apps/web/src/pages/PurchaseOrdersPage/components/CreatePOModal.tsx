import { UseMutationResult } from '@tanstack/react-query';
import Modal from '@/components/ui/Modal';
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
  const selectClass = 'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none';
  const inputClass = selectClass;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="สร้างใบสั่งซื้อ" size="xl">
      <form onSubmit={handleCreate} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">ผู้ขาย *</label>
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
            <label className="block text-sm font-medium text-foreground mb-1">วันที่สั่ง *</label>
            <ThaiDateInput
              value={form.orderDate}
              onChange={(e) => setForm({ ...form, orderDate: e.target.value })}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">วันที่คาดรับสินค้า</label>
            <ThaiDateInput
              value={form.expectedDate}
              onChange={(e) => setForm({ ...form, expectedDate: e.target.value })}
              className={inputClass}
            />
          </div>
        </div>

        {/* Items with cascade dropdowns */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-foreground">รายการสินค้า</label>
            <button type="button" onClick={addItem} className="text-sm text-primary hover:text-primary/90">
              + เพิ่มรายการ
            </button>
          </div>
          <div className="space-y-4">
            {items.map((item, idx) => {
              const isAccessory = item.category === 'ACCESSORY';
              const isCharger = isAccessory && item.accessoryType === 'ชุดชาร์จ';
              // For accessories, show all phone/tablet models for "compatible model"
              const availableModels = item.brand ? getModels(item.brand, isAccessory ? 'ACCESSORY' : (item.category || undefined)) : [];
              const modelInfo = item.brand && item.model ? getModelInfo(item.brand, item.model) : undefined;
              const availableColors = modelInfo?.colors || [];
              const availableStorage = modelInfo?.storage || [];
              // For multi-select: parse comma-separated model string
              const selectedModels = isAccessory && item.model ? item.model.split(', ').filter(Boolean) : [];

              // Auto name for accessories
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
                      <label className="block text-xs text-muted-foreground mb-0.5">ประเภท *</label>
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
                        {/* Accessory Type */}
                        <div>
                          <label className="block text-xs text-muted-foreground mb-0.5">ประเภทอุปกรณ์ *</label>
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
                          /* Charger: connector type */
                          <div>
                            <label className="block text-xs text-muted-foreground mb-0.5">ชนิด *</label>
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
                          /* Non-charger accessory: compatible phone brand */
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
                        {/* Normal: Brand, Model */}
                        <div>
                          <label className="block text-xs text-muted-foreground mb-0.5">ยี่ห้อ *</label>
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
                          <label className="block text-xs text-muted-foreground mb-0.5">รุ่น *</label>
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
                      {/* Accessory Row: Accessory Brand, Quantity, Price */}
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
                          <label className="block text-xs text-muted-foreground mb-0.5">จำนวน *</label>
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
                          <label className="block text-xs text-muted-foreground mb-0.5">ราคา/ชิ้น *</label>
                          <input
                            type="number"
                            value={item.unitPrice}
                            onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)}
                            className={inputClass}
                            required
                          />
                        </div>
                      </div>
                      {/* Auto name preview */}
                      {accessoryAutoName && (
                        <div className="text-xs text-primary bg-primary-100 rounded px-2 py-1">
                          ชื่อสินค้า: {accessoryAutoName}
                        </div>
                      )}
                    </>
                  ) : (
                    /* Normal Row 2: Color, Storage, Quantity, Price */
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
                        <label className="block text-xs text-muted-foreground mb-0.5">จำนวน *</label>
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
                        <label className="block text-xs text-muted-foreground mb-0.5">ราคา/ชิ้น *</label>
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

        {/* Summary Section */}
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium text-foreground mb-2">สรุปยอด</h4>
          <div className="bg-muted rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">ยอดรวมสินค้า (Subtotal)</span>
              <span className="font-medium">{subtotal.toLocaleString()} บาท</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">ส่วนลด</span>
              <input
                type="number"
                value={form.discount}
                onChange={(e) => setForm({ ...form, discount: e.target.value })}
                className="w-32 px-2 py-1 border border-input rounded text-sm text-right focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
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
              <span className="text-primary-700">{netAmount.toLocaleString()} บาท</span>
            </div>
          </div>
        </div>

        {/* Payment Section */}
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium text-foreground mb-2">การจ่ายเงิน</h4>
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
          {/* Attachments */}
          {form.paymentStatus !== 'UNPAID' && (
            <div className="mt-3">
              <label className="block text-xs text-muted-foreground mb-0.5">แนบสลิป/เอกสาร</label>
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
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            className={inputClass}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground">
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {createMutation.isPending ? 'กำลังสร้าง...' : 'สร้าง PO'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
