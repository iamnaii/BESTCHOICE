import { UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Modal from '@/components/ui/Modal';
import api, { getErrorMessage } from '@/lib/api';
import { CANONICAL_PRICE_LABELS, CASH_LABEL } from '@/utils/getDisplayPrices';
import { PRODUCT_READINESS_QUERY_KEY } from '@/pages/ProductDetailPage/hooks/useProductReadiness';
import { StockProduct } from '../types';

/**
 * Task 13 — is this the label `syncPriceRowsFromColumns` (apps/api) write-through
 * targets? If so the row mirrors `Product.cashPrice`/`installmentPrice` (source
 * of truth) and must be edited via the column PATCH, never the row-level
 * `/products/:id/prices` CRUD.
 */
function isCanonicalLabel(label: string): boolean {
  return (CANONICAL_PRICE_LABELS as readonly string[]).includes(label.trim());
}

function canonicalLabelToField(label: string): 'cashPrice' | 'installmentPrice' {
  return label.trim() === CASH_LABEL ? 'cashPrice' : 'installmentPrice';
}

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
  const queryClient = useQueryClient();

  // Task 13 — canonical rows (ราคาเงินสด / ราคาผ่อน BESTCHOICE) mirror
  // Product.cashPrice/installmentPrice (source of truth). Editing/adding one
  // must PATCH the column, never the row-level /products/:id/prices CRUD —
  // otherwise the next column write-through (`syncPriceRowsFromColumns`)
  // silently overwrites whatever was typed here.
  const columnPriceMutation = useMutation({
    mutationFn: async ({
      productId,
      field,
      amount,
    }: {
      productId: string;
      field: 'cashPrice' | 'installmentPrice';
      amount: number;
    }) => api.patch(`/products/${productId}`, { [field]: amount }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-list'] });
      queryClient.invalidateQueries({ queryKey: ['product'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
      queryClient.invalidateQueries({ queryKey: PRODUCT_READINESS_QUERY_KEY(variables.productId) });
      toast.success('บันทึกราคาสำเร็จ');
      cancelEditPrice();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const onPriceFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;

    const trimmedLabel = priceForm.label.trim();
    const isAddingNew = editingPriceId === 'new';
    // Fix round 1 [C1] — the row being EDITED (its stored `price.label`
    // identity) decides routing, never the live text in the label input.
    // The label input is read-only for an existing canonical row (see JSX
    // below) so `trimmedLabel` should always agree with `originalPrice.label`
    // there anyway, but we still key off the identity defensively. Only a
    // brand-new row (no identity yet) may route off typed text.
    const originalPrice = !isAddingNew
      ? editingProduct.prices.find((p) => p.id === editingPriceId)
      : undefined;
    const isCanonicalRow = originalPrice
      ? isCanonicalLabel(originalPrice.label)
      : isAddingNew && isCanonicalLabel(trimmedLabel);

    if (!isCanonicalRow) {
      // Fix round 1 [C2] — block renaming a non-canonical row (or creating a
      // fresh one) INTO a reserved canonical label. The server's
      // write-through does `rows.find(r => r.label === CASH_LABEL)` — a
      // second row sharing that label would silently collide with (or get
      // shadowed by) the real canonical row on the next column PATCH.
      if (isCanonicalLabel(trimmedLabel)) {
        toast.error('ชื่อนี้สงวนสำหรับราคาหลัก — แก้ที่แถวราคาหลักแทน');
        return;
      }
      handlePriceSubmit(e);
      return;
    }

    const newAmount = parseFloat(priceForm.amount);
    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      toast.error('กรุณาระบุราคามากกว่า 0');
      return;
    }

    const amountChanged = !originalPrice || newAmount !== parseFloat(originalPrice.amount);
    const isDefaultChanged = !!originalPrice && priceForm.isDefault !== originalPrice.isDefault;

    // Fix round 1 [I1] — sequential, not fire-and-forget: the column PATCH
    // must land before the /prices isDefault call, otherwise the two
    // mutations race and can interleave in either order. Only proceed to the
    // isDefault step once the money write actually succeeded.
    if (amountChanged) {
      try {
        await columnPriceMutation.mutateAsync({
          productId: editingProduct.id,
          field: canonicalLabelToField(originalPrice ? originalPrice.label : trimmedLabel),
          amount: newAmount,
        });
      } catch {
        // columnPriceMutation's own onError already toasted the failure —
        // stop here so a failed money write never chains into isDefault.
        return;
      }
    }

    if (isDefaultChanged && originalPrice) {
      // isDefault isn't a column — the existing /prices route still manages
      // it, but now resends `newAmount` (the value just PATCHed onto the
      // column, write-through already made the DB row match it) instead of
      // the stale original amount, per fix round 1 [I1].
      try {
        await priceMutation.mutateAsync({
          productId: editingProduct.id,
          priceId: originalPrice.id,
          data: { label: originalPrice.label, amount: newAmount, isDefault: priceForm.isDefault },
        });
      } catch (err) {
        toast.error(`บันทึกราคาสำเร็จแล้ว แต่ตั้งค่าเริ่มต้นไม่สำเร็จ: ${getErrorMessage(err)}`);
        return;
      }
    }

    if (!amountChanged && !isDefaultChanged) {
      // Nothing actually changed — just close the edit row.
      cancelEditPrice();
    }
  };

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
                  <form onSubmit={onPriceFormSubmit} className="border-2 border-primary/20 rounded-lg p-3 bg-primary/5 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={priceForm.label}
                        onChange={(e) => setPriceForm({ ...priceForm, label: e.target.value })}
                        placeholder="ชื่อราคา"
                        readOnly={isCanonicalLabel(price.label)}
                        className={`px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden ${isCanonicalLabel(price.label) ? 'bg-muted text-muted-foreground cursor-not-allowed' : ''}`}
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
                    {isCanonicalLabel(price.label) && (
                      <p className="text-[0.6875rem] text-muted-foreground leading-snug">
                        ชื่อผูกกับคอลัมน์ราคา แก้ไม่ได้ — แก้ตัวเลขได้ตามปกติ
                      </p>
                    )}
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
                          disabled={priceMutation.isPending || columnPriceMutation.isPending}
                          className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
                        >
                          {priceMutation.isPending || columnPriceMutation.isPending ? 'บันทึก...' : 'บันทึก'}
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
                      {isCanonicalLabel(price.label) && (
                        <span className="px-1.5 py-0.5 bg-success/10 text-success text-xs rounded font-medium leading-snug">
                          ราคาหลัก
                        </span>
                      )}
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
                          disabled={isCanonicalLabel(price.label)}
                          onClick={() => {
                            if (isCanonicalLabel(price.label)) return;
                            setConfirmDialog({ open: true, message: 'ต้องการลบราคานี้?', action: () => deletePriceMutation.mutate({ productId: editingProduct.id, priceId: price.id }) });
                          }}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40 disabled:pointer-events-none disabled:hover:text-muted-foreground"
                          title={isCanonicalLabel(price.label) ? 'ราคาหลักลบไม่ได้ — แก้ตัวเลขแทน' : 'ลบ'}
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
            <form onSubmit={onPriceFormSubmit} className="border-2 border-success/20 rounded-lg p-3 bg-success/5 space-y-2">
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
                {isCanonicalLabel(priceForm.label) ? (
                  // Fix round 1 [M2] — this label routes straight to the
                  // column PATCH (no /prices call at all), so an isDefault
                  // checkbox here would be a silent no-op. Hide it instead of
                  // shipping dead UI; the server's write-through decides the
                  // default (cash always wins when present).
                  <p className="text-xs text-muted-foreground leading-snug">
                    ราคาหลัก — ระบบจัดการค่าเริ่มต้นให้อัตโนมัติ
                  </p>
                ) : (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={priceForm.isDefault}
                      onChange={(e) => setPriceForm({ ...priceForm, isDefault: e.target.checked })}
                      className="rounded text-primary"
                    />
                    ค่าเริ่มต้น
                  </label>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={cancelEditPrice} className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={priceMutation.isPending || columnPriceMutation.isPending}
                    className="px-3 py-1 bg-success text-success-foreground rounded text-xs font-medium hover:bg-success/90 disabled:opacity-50"
                  >
                    {priceMutation.isPending || columnPriceMutation.isPending ? 'เพิ่ม...' : 'เพิ่ม'}
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
