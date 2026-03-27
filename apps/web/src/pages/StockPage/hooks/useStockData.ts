import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { StockProduct, BranchSummary, StockDashboard } from '../types';

export function useStockData(filterBranch: string, onBulkTransferSuccess?: () => void) {
  const queryClient = useQueryClient();

  // Price management modal state (multi-price CRUD)
  const [editingProduct, setEditingProduct] = useState<StockProduct | null>(null);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceForm, setPriceForm] = useState({ label: '', amount: '', isDefault: false });

  // Bulk transfer modal state
  const [showBulkTransfer, setShowBulkTransfer] = useState(false);
  const [transferBranchId, setTransferBranchId] = useState('');
  const [transferNotes, setTransferNotes] = useState('');

  // --- Mutations ---

  const priceMutation = useMutation({
    mutationFn: async ({ productId, priceId, data }: { productId: string; priceId?: string; data: { label: string; amount: number; isDefault: boolean } }) => {
      if (priceId) {
        return api.patch(`/products/${productId}/prices/${priceId}`, data);
      }
      return api.post(`/products/${productId}/prices`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-list'] });
      toast.success('บันทึกราคาสำเร็จ');
      setEditingPriceId(null);
      setPriceForm({ label: '', amount: '', isDefault: false });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const deletePriceMutation = useMutation({
    mutationFn: async ({ productId, priceId }: { productId: string; priceId: string }) => {
      return api.delete(`/products/${productId}/prices/${priceId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-list'] });
      toast.success('ลบราคาสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const bulkTransferMutation = useMutation({
    mutationFn: async (data: { productIds: string[]; toBranchId: string; notes?: string }) => {
      return api.post('/products/bulk-transfer', data);
    },
    onSuccess: (res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-list'] });
      queryClient.invalidateQueries({ queryKey: ['stock-dashboard'] });
      const batchNumber = res.data?.batchNumber;
      toast.success(`โอนสินค้า ${variables.productIds.length} รายการสำเร็จ${batchNumber ? ` (${batchNumber})` : ''}`);
      setShowBulkTransfer(false);
      setTransferBranchId('');
      setTransferNotes('');
      onBulkTransferSuccess?.();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const openPriceEdit = useCallback((product: StockProduct) => {
    setEditingProduct(product);
    setEditingPriceId(null);
    setPriceForm({ label: '', amount: '', isDefault: false });
  }, []);

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

  // --- Queries ---

  // Summary data for branch cards (always loaded)
  const { data: summaryData } = useQuery<{ products: StockProduct[]; summary: BranchSummary[] }>({
    queryKey: ['stock', filterBranch],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filterBranch) params.branchId = filterBranch;
      const { data } = await api.get('/products/stock', { params });
      return data;
    },
  });

  // Dashboard analytics
  const { data: dashboard } = useQuery<StockDashboard>({
    queryKey: ['stock-dashboard', filterBranch],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filterBranch) params.branchId = filterBranch;
      const { data } = await api.get('/products/stock/dashboard', { params });
      return data;
    },
  });

  // Branches list for dropdown
  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
  });

  // Warranty expiring alerts
  const { data: warrantyExpiring = [] } = useQuery<{ id: string; name: string; brand: string; model: string; warrantyExpireDate: string }[]>({
    queryKey: ['warranty-expiring'],
    queryFn: async () => { const { data } = await api.get('/products/warranty/expiring'); return data; },
  });

  const summary = summaryData?.summary || [];
  const totalInStock = summary.reduce((sum, s) => sum + s.inStock, 0);
  const totalValue = summary.reduce((sum, s) => sum + s.totalValue, 0);

  return {
    // Queries
    summaryData,
    dashboard,
    branches,
    warrantyExpiring,
    // Derived
    summary,
    totalInStock,
    totalValue,
    // Price management
    editingProduct,
    setEditingProduct,
    editingPriceId,
    priceForm,
    setPriceForm,
    openPriceEdit,
    startEditPrice,
    startAddPrice,
    cancelEditPrice,
    handlePriceSubmit,
    priceMutation,
    deletePriceMutation,
    // Bulk transfer
    showBulkTransfer,
    setShowBulkTransfer,
    transferBranchId,
    setTransferBranchId,
    transferNotes,
    setTransferNotes,
    bulkTransferMutation,
  };
}

export function useEditingProductSync(
  editingProduct: StockProduct | null,
  listProducts: StockProduct[],
  setEditingProduct: (p: StockProduct | null) => void,
) {
  const editingProductId = editingProduct?.id;
  useEffect(() => {
    if (editingProductId && listProducts.length > 0) {
      const updated = listProducts.find(p => p.id === editingProductId);
      if (updated) setEditingProduct(updated);
    }
  }, [listProducts, editingProductId]);
}

