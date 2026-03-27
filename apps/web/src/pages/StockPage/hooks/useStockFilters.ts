import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import { statusLabels, categoryLabels } from '@/lib/constants';
import { StockProduct } from '../types';

export function useStockFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  // Support ?tab=list from redirect
  const initialTab = searchParams.get('tab') === 'list' ? 'list' : 'dashboard';
  const [activeTab, setActiveTab] = useState<'dashboard' | 'list'>(initialTab);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [filterBranch, setFilterBranch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [debouncedSearch, filterStatus, filterCategory, filterBranch]);

  const handleTabChange = (tab: 'dashboard' | 'list') => {
    setActiveTab(tab);
    // Update URL without full navigation
    if (tab === 'list') {
      setSearchParams({ tab: 'list' }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (listProducts: StockProduct[]) => {
    if (selectedIds.size === listProducts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(listProducts.map((p) => p.id)));
    }
  };

  const handleExport = (listProducts: StockProduct[]) => {
    const items = selectedIds.size > 0 ? listProducts.filter((p) => selectedIds.has(p.id)) : listProducts;
    if (items.length === 0) { toast.error('ไม่มีข้อมูลให้ส่งออก'); return; }
    const headers = isManager
      ? ['สินค้า', 'แบรนด์', 'รุ่น', 'IMEI/Serial', 'ประเภท', 'สี', 'ความจุ', 'ราคาทุน', 'ราคาขาย', 'สถานะ', 'สาขา']
      : ['สินค้า', 'แบรนด์', 'รุ่น', 'IMEI/Serial', 'ประเภท', 'สี', 'ความจุ', 'ราคาขาย', 'สถานะ', 'สาขา'];
    const rows = items.map((p) => {
      const dp = p.prices?.find((pr) => pr.isDefault) || p.prices?.[0];
      return isManager
        ? [p.name, p.brand, p.model, p.imeiSerial || '', categoryLabels[p.category] || p.category, p.color || '', p.storage || '', Number(p.costPrice || 0).toLocaleString(), dp ? Number(dp.amount).toLocaleString() : '', statusLabels[p.status]?.label || p.status, p.branch.name]
        : [p.name, p.brand, p.model, p.imeiSerial || '', categoryLabels[p.category] || p.category, p.color || '', p.storage || '', dp ? Number(dp.amount).toLocaleString() : '', statusLabels[p.status]?.label || p.status, p.branch.name];
    });
    const esc = (c: unknown) => `"${String(c ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return {
    isManager,
    activeTab,
    handleTabChange,
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
    selectedIds,
    setSelectedIds,
    toggleSelect,
    toggleSelectAll,
    handleExport,
  };
}
