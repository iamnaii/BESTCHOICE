import { UseMutationResult } from '@tanstack/react-query';
import Modal from '@/components/ui/Modal';
import { StockProduct } from '../types';

export interface PriceManagementModalProps {
  editingProduct: StockProduct | null;
  setEditingProduct: (product: StockProduct | null) => void;
  editingPriceId: string | null;
  priceForm: { label: string; amount: string; isDefault: boolean };
  setPriceForm: (form: { label: string; amount: string; isDefault: boolean }) => void;
  startEditPrice: (price: { id: string; label: string; amount: string; isDefault: boolean }) => void;
  startAddPrice: () => void;
  cancelEditPrice: () => void;
  handlePriceSubmit: (e: React.FormEvent) => void;
  priceMutation: UseMutationResult<unknown, unknown, { productId: string; priceId?: string; data: { label: string; amount: number; isDefault: boolean } }>;
  deletePriceMutation: UseMutationResult<unknown, unknown, { productId: string; priceId: string }>;
  setConfirmDialog: (dialog: { open: boolean; message: string; action: () => void }) => void;
}

export function PriceManagementModal({
  editingProduct,
  setEditingProduct,
  editingPriceId,
  priceForm,
  setPriceForm,
  startEditPrice,
  startAddPrice,
  cancelEditPrice,
  handlePriceSubmit,
  priceMutation,
  deletePriceMutation,
  setConfirmDialog,
}: PriceManagementModalProps) {
  return (
    <Modal
      isOpen={!!editingProduct}
      onClose={() => setEditingProduct(null)}
      title={editingProduct ? `จัดการราคา — ${editingProduct.brand} ${editingProduct.model}` : 'จัดการราคา'}
      size="sm"
    >
      {editingProduct && (
        <div className="space-y-4">
          {/* Cost price reference */}
          <div className="text-xs text-muted-foreground bg-muted rounded-lg p-3">
            ราคาทุน: <span className="font-medium text-foreground">{parseFloat(editingProduct.costPrice).toLocaleString()} ฿</span>
          </div>

          {/* Existing prices list */}
          <div className="space-y-2">
            {editingProduct.prices.map((price) => (
              <div key={price.id}>
                {editingPriceId === price.id ? (
                  /* Inline edit form */
                  <form onSubmit={handlePriceSubmit} className="border-2 border-primary/20 rounded-lg p-3 bg-primary/5 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={priceForm.label}
                        onChange={(e) => setPriceForm({ ...priceForm, label: e.target.value })}
                        placeholder="ชื่อราคา"
                        className="px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                        required
                      />
                      <input
                        type="number"
                        step="0.01"
                        value={priceForm.amount}
                        onChange={(e) => setPriceForm({ ...priceForm, amount: e.target.value })}
                        placeholder="ราคา (บาท)"
                        className="px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                        required
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={priceForm.isDefault}
                          onChange={(e) => setPriceForm({ ...priceForm, isDefault: e.target.checked })}
                          className="rounded text-primary"
                        />
                        ค่าเริ่มต้น
                      </label>
                      <div className="flex gap-2">
                        <button type="button" onClick={cancelEditPrice} className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                          ยกเลิก
                        </button>
                        <button
                          type="submit"
                          disabled={priceMutation.isPending}
                          className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
                        >
                          {priceMutation.isPending ? 'บันทึก...' : 'บันทึก'}
                        </button>
                      </div>
                    </div>
                    {priceForm.amount && (
                      <div className={`text-xs ${parseFloat(priceForm.amount) - parseFloat(editingProduct.costPrice) > 0 ? 'text-success' : 'text-destructive'}`}>
                        กำไร: {(parseFloat(priceForm.amount) - parseFloat(editingProduct.costPrice)).toLocaleString()} ฿
                      </div>
                    )}
                  </form>
                ) : (
                  /* Display row */
                  <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 border border-transparent hover:border-border">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{price.label}</span>
                      {price.isDefault && (
                        <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-xs rounded font-medium">
                          ค่าเริ่มต้น
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold">{parseFloat(price.amount).toLocaleString()} ฿</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => startEditPrice(price)}
                          className="p-1 text-muted-foreground hover:text-primary transition-colors"
                          title="แก้ไข"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            setConfirmDialog({ open: true, message: 'ต้องการลบราคานี้?', action: () => deletePriceMutation.mutate({ productId: editingProduct.id, priceId: price.id }) });
                          }}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                          title="ลบ"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {editingProduct.prices.length === 0 && !editingPriceId && (
              <p className="text-sm text-muted-foreground text-center py-3">ยังไม่มีราคาขาย</p>
            )}
          </div>

          {/* Add new price form */}
          {editingPriceId === 'new' ? (
            <form onSubmit={handlePriceSubmit} className="border-2 border-success/20 rounded-lg p-3 bg-success/5 space-y-2">
              <div className="text-xs font-medium text-success mb-1">เพิ่มราคาใหม่</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={priceForm.label}
                  onChange={(e) => setPriceForm({ ...priceForm, label: e.target.value })}
                  placeholder='เช่น "ราคาเงินสด"'
                  className="px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                  required
                />
                <input
                  type="number"
                  step="0.01"
                  value={priceForm.amount}
                  onChange={(e) => setPriceForm({ ...priceForm, amount: e.target.value })}
                  placeholder="ราคา (บาท)"
                  className="px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                  required
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={priceForm.isDefault}
                    onChange={(e) => setPriceForm({ ...priceForm, isDefault: e.target.checked })}
                    className="rounded text-primary"
                  />
                  ค่าเริ่มต้น
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={cancelEditPrice} className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={priceMutation.isPending}
                    className="px-3 py-1 bg-success text-success-foreground rounded text-xs font-medium hover:bg-success/90 disabled:opacity-50"
                  >
                    {priceMutation.isPending ? 'เพิ่ม...' : 'เพิ่ม'}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={startAddPrice}
              className="w-full py-2 border-2 border-dashed border-input rounded-lg text-sm text-muted-foreground hover:border-primary/60 hover:text-primary transition-colors"
            >
              + เพิ่มราคาใหม่
            </button>
          )}

          {/* Close button */}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setEditingProduct(null)}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              ปิด
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
