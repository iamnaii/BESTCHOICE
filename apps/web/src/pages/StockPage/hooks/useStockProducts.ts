import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import api, { getErrorMessage } from '@/lib/api';
import { statusLabels, categoryLabels } from '@/lib/constants';
import type { BranchSummary, StockProduct } from '../types';

export function useStockProducts() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  const filterBranch = searchParams.get('branchId') ?? '';
  const filterStatus = searchParams.get('status') ?? '';
  const filterCategory = searchParams.get('category') ?? '';

  const setFilterBranch = useCallback(
    (v: string) => {
      const next = new URLSearchParams(searchParams);
      if (v) next.set('branchId', v);
      else next.delete('branchId');
      next.delete('page');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setFilterStatus = useCallback(
    (v: string) => {
      const next = new URLSearchParams(searchParams);
      if (v) next.set('status', v);
      else next.delete('status');
      next.delete('page');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setFilterCategory = useCallback(
    (v: string) => {
      const next = new URLSearchParams(searchParams);
      if (v) next.set('category', v);
      else next.delete('category');
      next.delete('page');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const debouncedSearch = useDebounce(search);

  const page = Number(searchParams.get('page') ?? '1');
  const setPage = useCallback(
    (v: number) => {
      const next = new URLSearchParams(searchParams);
      if (v > 1) next.set('page', String(v));
      else next.delete('page');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // Sync debounced search to URL `q` param
  useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (current === debouncedSearch) return;
    const next = new URLSearchParams(searchParams);
    if (debouncedSearch) next.set('q', debouncedSearch);
    else next.delete('q');
    next.delete('page');
    setSearchParams(next, { replace: true });
  }, [debouncedSearch, searchParams, setSearchParams]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset selection when filters change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterBranch, filterStatus, filterCategory, debouncedSearch]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(
    (listProducts: StockProduct[]) => {
      if (selectedIds.size === listProducts.length) setSelectedIds(new Set());
      else setSelectedIds(new Set(listProducts.map((p) => p.id)));
    },
    [selectedIds.size],
  );

  // --- Queries ---

  const summaryQuery = useQuery<{ products: StockProduct[]; summary: BranchSummary[] }>({
    queryKey: ['stock', filterBranch],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filterBranch) params.branchId = filterBranch;
      const { data } = await api.get('/products/stock', { params });
      return data;
    },
  });

  const branchesQuery = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
  });

  const listQuery = useQuery<{
    data: StockProduct[];
    total: number;
    page: number;
    totalPages: number;
  }>({
    queryKey: ['stock-list', debouncedSearch, filterStatus, filterCategory, filterBranch, page],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterStatus) params.status = filterStatus;
      if (filterCategory) params.category = filterCategory;
      if (filterBranch) params.branchId = filterBranch;
      params.page = String(page);
      const { data } = await api.get('/products', { params });
      return data;
    },
  });

  // --- Modals ---

  const [editingProduct, setEditingProduct] = useState<StockProduct | null>(null);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceForm, setPriceForm] = useState({ label: '', amount: '', isDefault: false });

  const [showBulkTransfer, setShowBulkTransfer] = useState(false);
  const [transferBranchId, setTransferBranchId] = useState('');
  const [transferNotes, setTransferNotes] = useState('');

  // --- Mutations ---

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
      if (priceId) return api.patch(`/products/${productId}/prices/${priceId}`, data);
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
    mutationFn: async ({ productId, priceId }: { productId: string; priceId: string }) =>
      api.delete(`/products/${productId}/prices/${priceId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-list'] });
      toast.success('ลบราคาสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const bulkTransferMutation = useMutation({
    mutationFn: async (data: { productIds: string[]; toBranchId: string; notes?: string }) =>
      api.post('/products/bulk-transfer', data),
    onSuccess: (res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-list'] });
      queryClient.invalidateQueries({ queryKey: ['stock-dashboard'] });
      const batchNumber = res.data?.batchNumber;
      toast.success(
        `โอนสินค้า ${variables.productIds.length} รายการสำเร็จ${batchNumber ? ` (${batchNumber})` : ''}`,
      );
      setShowBulkTransfer(false);
      setTransferBranchId('');
      setTransferNotes('');
      setSelectedIds(new Set());
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // --- Helpers ---

  const openPriceEdit = useCallback((product: StockProduct) => {
    setEditingProduct(product);
    setEditingPriceId(null);
    setPriceForm({ label: '', amount: '', isDefault: false });
  }, []);

  const startEditPrice = useCallback(
    (price: { id: string; label: string; amount: string; isDefault: boolean }) => {
      setEditingPriceId(price.id);
      setPriceForm({ label: price.label, amount: price.amount, isDefault: price.isDefault });
    },
    [],
  );

  const startAddPrice = useCallback(() => {
    setEditingPriceId('new');
    setPriceForm({ label: '', amount: '', isDefault: false });
  }, []);

  const cancelEditPrice = useCallback(() => {
    setEditingPriceId(null);
    setPriceForm({ label: '', amount: '', isDefault: false });
  }, []);

  const handlePriceSubmit = useCallback(
    (e: React.FormEvent) => {
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
    },
    [editingProduct, editingPriceId, priceForm, priceMutation],
  );

  const handleExport = useCallback(
    (listProducts: StockProduct[]) => {
      const items =
        selectedIds.size > 0 ? listProducts.filter((p) => selectedIds.has(p.id)) : listProducts;
      if (items.length === 0) {
        toast.error('ไม่มีข้อมูลให้ส่งออก');
        return;
      }
      const headers = isManager
        ? ['สินค้า', 'แบรนด์', 'รุ่น', 'IMEI/Serial', 'ประเภท', 'สี', 'ความจุ', 'ราคาทุน', 'ราคาขาย', 'สถานะ', 'สาขา']
        : ['สินค้า', 'แบรนด์', 'รุ่น', 'IMEI/Serial', 'ประเภท', 'สี', 'ความจุ', 'ราคาขาย', 'สถานะ', 'สาขา'];
      const rows = items.map((p) => {
        const dp = p.prices?.find((pr) => pr.isDefault) || p.prices?.[0];
        return isManager
          ? [
              p.name,
              p.brand,
              p.model,
              p.imeiSerial || '',
              categoryLabels[p.category] || p.category,
              p.color || '',
              p.storage || '',
              Number(p.costPrice || 0).toLocaleString(),
              dp ? Number(dp.amount).toLocaleString() : '',
              statusLabels[p.status]?.label || p.status,
              p.branch.name,
            ]
          : [
              p.name,
              p.brand,
              p.model,
              p.imeiSerial || '',
              categoryLabels[p.category] || p.category,
              p.color || '',
              p.storage || '',
              dp ? Number(dp.amount).toLocaleString() : '',
              statusLabels[p.status]?.label || p.status,
              p.branch.name,
            ];
      });
      const esc = (c: unknown) => `"${String(c ?? '').replace(/"/g, '""')}"`;
      const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stock-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [isManager, selectedIds],
  );

  const summary = useMemo(() => summaryQuery.data?.summary ?? [], [summaryQuery.data]);

  return {
    isManager,
    // filters (URL-backed)
    search,
    setSearch,
    debouncedSearch,
    filterBranch,
    setFilterBranch,
    filterStatus,
    setFilterStatus,
    filterCategory,
    setFilterCategory,
    page,
    setPage,
    // selection
    selectedIds,
    setSelectedIds,
    toggleSelect,
    toggleSelectAll,
    // queries
    listResult: listQuery.data,
    listLoading: listQuery.isLoading,
    listError: listQuery.isError,
    listErrorObj: listQuery.error,
    listRefetch: listQuery.refetch,
    listProducts: listQuery.data?.data ?? [],
    summary,
    branches: branchesQuery.data ?? [],
    // export
    handleExport,
    // price modal
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
    // bulk transfer
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
      const updated = listProducts.find((p) => p.id === editingProductId);
      if (updated) setEditingProduct(updated);
    }
  }, [listProducts, editingProductId, setEditingProduct]);
}
