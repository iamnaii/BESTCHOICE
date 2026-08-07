import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PriceManagementModal } from '../PriceManagementModal';
import type { StockProduct } from '../../types';

// `apiPatch`/`apiPost`/`apiDelete` are referenced only INSIDE the mock factory's
// returned arrow fns (called lazily), so they don't hit the vi.mock hoist TDZ —
// same pattern as SameModelCard.test.tsx.
const apiPatch = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();
vi.mock('@/lib/api', () => ({
  default: {
    patch: (...args: unknown[]) => apiPatch(...args),
    post: (...args: unknown[]) => apiPost(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
  getErrorMessage: () => 'error',
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

// ต้องมี braces — arrow แบบไม่มี braces จะ return ตัว mock (mockReset คืน instance
// ไว้ chain) แล้ว vitest ถือ return value ของ beforeEach เป็น cleanup fn (บั๊กเดียวกับที่
// SameModelCard.test.tsx เตือนไว้)
beforeEach(() => {
  apiPatch.mockReset();
  apiPost.mockReset();
  apiDelete.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

function makeProduct(prices: StockProduct['prices']): StockProduct {
  return {
    id: 'p-1',
    name: 'iPhone 13',
    brand: 'Apple',
    model: 'iPhone 13',
    imeiSerial: null,
    category: 'PHONE_NEW',
    costPrice: '10000',
    cashPrice: '15000',
    installmentPrice: null,
    status: 'IN_STOCK',
    color: null,
    storage: null,
    branch: { id: 'b-1', name: 'สาขา 1' },
    supplier: null,
    prices,
  };
}

// Minimal re-implementation of the price-editing slice of useStockProducts —
// PriceManagementModal is a fully props-controlled component, so an isolated
// render needs a thin harness that owns editingPriceId/priceForm state exactly
// the way the real hook does.
function Harness({ initialProduct }: { initialProduct: StockProduct }) {
  const [editingProduct, setEditingProduct] = useState<StockProduct | null>(initialProduct);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceForm, setPriceForm] = useState({ label: '', amount: '', isDefault: false });
  const [, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({
    open: false,
    message: '',
    action: () => {},
  });

  const priceMutation = useMutation({
    mutationFn: async ({
      productId,
      priceId,
      data,
    }: {
      productId: string;
      priceId?: string;
      data: { label: string; amount: number; isDefault: boolean };
    }) => {
      if (priceId) return apiPatch(`/products/${productId}/prices/${priceId}`, data);
      return apiPost(`/products/${productId}/prices`, data);
    },
    onSuccess: () => {
      setEditingPriceId(null);
      setPriceForm({ label: '', amount: '', isDefault: false });
    },
  });

  const deletePriceMutation = useMutation({
    mutationFn: async ({ productId, priceId }: { productId: string; priceId: string }) =>
      apiDelete(`/products/${productId}/prices/${priceId}`),
  });

  const startEditPrice = (price: { id: string; label: string; amount: string; isDefault: boolean }) => {
    setEditingPriceId(price.id);
    setPriceForm({ label: price.label, amount: price.amount, isDefault: price.isDefault });
  };
  const startAddPrice = () => {
    setEditingPriceId('new');
    setPriceForm({ label: '', amount: '', isDefault: false });
  };
  const cancelEditPrice = () => {
    setEditingPriceId(null);
    setPriceForm({ label: '', amount: '', isDefault: false });
  };
  const handlePriceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    priceMutation.mutate({
      productId: editingProduct.id,
      priceId: editingPriceId === 'new' ? undefined : editingPriceId || undefined,
      data: {
        label: priceForm.label,
        amount: parseFloat(priceForm.amount) || 0,
        isDefault: priceForm.isDefault,
      },
    });
  };

  return (
    <PriceManagementModal
      editingProduct={editingProduct}
      setEditingProduct={setEditingProduct}
      editingPriceId={editingPriceId}
      priceForm={priceForm}
      setPriceForm={setPriceForm}
      startEditPrice={startEditPrice}
      startAddPrice={startAddPrice}
      cancelEditPrice={cancelEditPrice}
      handlePriceSubmit={handlePriceSubmit}
      priceMutation={priceMutation}
      deletePriceMutation={deletePriceMutation}
      setConfirmDialog={setConfirmDialog}
    />
  );
}

function renderHarness(product: StockProduct) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <Harness initialProduct={product} />
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

describe('PriceManagementModal — Task 13 column-awareness', () => {
  it('(a) แก้แถว "ราคาเงินสด" → PATCH คอลัมน์ /products/:id ไม่ยิงเส้น /prices', async () => {
    apiPatch.mockResolvedValue({ data: {} });
    const product = makeProduct([{ id: 'pr-1', label: 'ราคาเงินสด', amount: '15000', isDefault: true }]);
    renderHarness(product);

    fireEvent.click(screen.getByTitle('แก้ไข'));
    const amountInput = screen.getByPlaceholderText('ราคา (บาท)');
    fireEvent.change(amountInput, { target: { value: '16000' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith('/products/p-1', { cashPrice: 16000 });
    expect(apiPatch).not.toHaveBeenCalledWith('/products/p-1/prices/pr-1', expect.anything());
  });

  it('(b) แก้แถว label อื่น → ยิงเส้น /prices เดิม ไม่แตะ PATCH คอลัมน์', async () => {
    apiPatch.mockResolvedValue({ data: {} });
    const product = makeProduct([{ id: 'pr-2', label: 'ราคาส่ง', amount: '13000', isDefault: false }]);
    renderHarness(product);

    fireEvent.click(screen.getByTitle('แก้ไข'));
    const amountInput = screen.getByPlaceholderText('ราคา (บาท)');
    fireEvent.change(amountInput, { target: { value: '13500' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith('/products/p-1/prices/pr-2', {
      label: 'ราคาส่ง',
      amount: 13500,
      isDefault: false,
    });
    expect(apiPatch).not.toHaveBeenCalledWith('/products/p-1', expect.anything());
  });

  it('(c) ปุ่มลบแถว canonical disabled; แถวอื่นลบได้ตามปกติ', () => {
    const product = makeProduct([
      { id: 'pr-1', label: 'ราคาเงินสด', amount: '15000', isDefault: true },
      { id: 'pr-2', label: 'ราคาส่ง', amount: '13000', isDefault: false },
    ]);
    renderHarness(product);

    const canonicalDeleteBtn = screen.getByTitle('ราคาหลักลบไม่ได้ — แก้ตัวเลขแทน');
    expect(canonicalDeleteBtn).toBeDisabled();
    fireEvent.click(canonicalDeleteBtn);
    expect(apiDelete).not.toHaveBeenCalled();

    const otherDeleteBtn = screen.getByTitle('ลบ');
    expect(otherDeleteBtn).not.toBeDisabled();

    // "ราคาหลัก" badge only decorates the canonical row.
    expect(screen.getByText('ราคาหลัก')).toBeInTheDocument();
  });

  it('(d) หลัง (a) สำเร็จ → invalidate ครบชุด (stock/stock-list/product/products/products-available/readiness)', async () => {
    apiPatch.mockResolvedValue({ data: {} });
    const product = makeProduct([{ id: 'pr-1', label: 'ราคาเงินสด', amount: '15000', isDefault: true }]);
    const { invalidateSpy } = renderHarness(product);

    fireEvent.click(screen.getByTitle('แก้ไข'));
    fireEvent.change(screen.getByPlaceholderText('ราคา (บาท)'), { target: { value: '16000' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(keys).toContainEqual(['stock']);
      expect(keys).toContainEqual(['stock-list']);
      expect(keys).toContainEqual(['product']);
      expect(keys).toContainEqual(['products']);
      expect(keys).toContainEqual(['products-available']);
      expect(keys).toContainEqual(['product-readiness', 'p-1']);
    });
  });

  it('(M1-a) เพิ่มราคาหลักใหม่ (เครื่องไม่มีแถว canonical เลย) → PATCH คอลัมน์ ไม่ยิง /prices, ซ่อน checkbox ค่าเริ่มต้น', async () => {
    apiPatch.mockResolvedValue({ data: {} });
    const product = makeProduct([]); // no rows at all yet
    renderHarness(product);

    fireEvent.click(screen.getByRole('button', { name: '+ เพิ่มราคาใหม่' }));

    // Before typing a canonical label the ordinary "ค่าเริ่มต้น" checkbox is
    // still there (label not yet canonical).
    expect(screen.getByText('ค่าเริ่มต้น')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('เช่น "ราคาเงินสด"'), { target: { value: 'ราคาเงินสด' } });

    // [M2] Once the typed label IS canonical, the checkbox is hidden (would
    // be a silent no-op — this label never reaches the /prices route at all).
    expect(screen.queryByText('ค่าเริ่มต้น')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('ราคา (บาท)'), { target: { value: '15000' } });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่ม' }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith('/products/p-1', { cashPrice: 15000 });
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('(C1) แถว canonical: label input read-only + routing ยึดตัวตนแถวเดิม แม้ข้อความในช่องถูกเปลี่ยน', async () => {
    apiPatch.mockResolvedValue({ data: {} });
    const product = makeProduct([{ id: 'pr-1', label: 'ราคาเงินสด', amount: '15000', isDefault: true }]);
    renderHarness(product);

    fireEvent.click(screen.getByTitle('แก้ไข'));
    const labelInput = screen.getByPlaceholderText('ชื่อราคา');
    expect(labelInput).toHaveAttribute('readonly');

    // Defense-in-depth: even if the (read-only) field's value is forced away
    // from the canonical text, routing must follow the EDITED ROW's stored
    // identity (pr-1's real label), never the live form text — this is the
    // exact bug the fix-round-1 review caught.
    fireEvent.change(labelInput, { target: { value: 'ราคาส่ง' } });
    fireEvent.change(screen.getByPlaceholderText('ราคา (บาท)'), { target: { value: '16000' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith('/products/p-1', { cashPrice: 16000 });
    expect(apiPatch).not.toHaveBeenCalledWith('/products/p-1/prices/pr-1', expect.anything());
  });

  it('(C2) เปลี่ยนชื่อแถวอื่นเป็นชื่อ canonical → ถูกบล็อก ไม่ยิงทั้งคอลัมน์และ /prices', async () => {
    const product = makeProduct([{ id: 'pr-2', label: 'ราคาส่ง', amount: '13000', isDefault: false }]);
    renderHarness(product);

    fireEvent.click(screen.getByTitle('แก้ไข'));
    fireEvent.change(screen.getByPlaceholderText('ชื่อราคา'), { target: { value: 'ราคาเงินสด' } });
    fireEvent.change(screen.getByPlaceholderText('ราคา (บาท)'), { target: { value: '13500' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('ชื่อนี้สงวนสำหรับราคาหลัก — แก้ที่แถวราคาหลักแทน'));
    expect(apiPatch).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
  });
});
