import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { statusLabels, categoryLabels } from '@/lib/constants';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StockProduct } from './types';
import { useStockData, useEditingProductSync } from './hooks/useStockData';
import { useStockFilters } from './hooks/useStockFilters';
import { BranchSummaryCards } from './components/BranchSummaryCards';
import { StockDashboardTab } from './components/StockDashboardTab';
import { StockListTab } from './components/StockListTab';
import { BulkTransferModal } from './components/BulkTransferModal';
import { PriceManagementModal } from './components/PriceManagementModal';

export default function StockPage() {
  const navigate = useNavigate();
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });

  const filters = useStockFilters();
  const {
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
  } = filters;

  const stockData = useStockData(filterBranch, () => setSelectedIds(new Set()));
  const {
    dashboard,
    branches,
    warrantyExpiring,
    summary,
    totalInStock,
    totalValue,
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
    showBulkTransfer,
    setShowBulkTransfer,
    transferBranchId,
    setTransferBranchId,
    transferNotes,
    setTransferNotes,
    bulkTransferMutation,
  } = stockData;

  // Paginated product list for the list tab (uses /products API)
  const { data: listResult, isLoading: listLoading } = useQuery<{ data: StockProduct[]; total: number; page: number; totalPages: number }>({
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
    enabled: activeTab === 'list',
  });

  const listProducts = listResult?.data ?? [];

  // Keep editingProduct in sync when product data refreshes after mutations
  useEditingProductSync(editingProduct, listProducts, setEditingProduct);

  const handleBulkTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIds.size === 0 || !transferBranchId) return;
    bulkTransferMutation.mutate({
      productIds: Array.from(selectedIds),
      toBranchId: transferBranchId,
      notes: transferNotes || undefined,
    });
  };

  // --- Table columns ---

  const navigateToProduct = useCallback((id: string) => navigate(`/products/${id}`), [navigate]);

  const columns = useMemo(() => [
    ...(isManager ? [{
      key: 'select',
      label: (
        <input
          type="checkbox"
          checked={listProducts.length > 0 && selectedIds.size === listProducts.length}
          onChange={() => toggleSelectAll(listProducts)}
          className="rounded text-primary"
        />
      ) as unknown as string,
      render: (p: StockProduct) => (
        <input
          type="checkbox"
          checked={selectedIds.has(p.id)}
          onChange={(e) => { e.stopPropagation(); toggleSelect(p.id); }}
          className="rounded text-primary"
        />
      ),
    }] : []),
    {
      key: 'name',
      label: 'สินค้า',
      render: (p: StockProduct) => (
        <button
          onClick={() => navigateToProduct(p.id)}
          className="text-left hover:underline"
        >
          <div className="text-primary font-medium">{p.brand} {p.model}</div>
          {p.imeiSerial && <div className="text-xs text-muted-foreground font-mono">{p.imeiSerial}</div>}
        </button>
      ),
    },
    {
      key: 'category',
      label: 'ประเภท',
      render: (p: StockProduct) => <span className="text-xs">{categoryLabels[p.category] || p.category}</span>,
    },
    {
      key: 'color',
      label: 'สี',
      render: (p: StockProduct) => <span className="text-sm">{p.color || '-'}</span>,
    },
    {
      key: 'storage',
      label: 'ความจุ',
      render: (p: StockProduct) => <span className="text-sm">{p.storage || '-'}</span>,
    },
    {
      key: 'prices',
      label: 'ราคา',
      render: (p: StockProduct) => {
        const defaultPrice = p.prices?.find((pr) => pr.isDefault) || p.prices?.[0];
        return (
          <div className="flex items-center gap-1.5">
            <div>
              {defaultPrice ? (
                <div className="font-medium">{parseFloat(defaultPrice.amount).toLocaleString()} ฿</div>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
              {isManager && <div className="text-xs text-muted-foreground">ทุน: {parseFloat(p.costPrice).toLocaleString()} ฿</div>}
            </div>
            {isManager && (
              <button
                onClick={(e) => { e.stopPropagation(); openPriceEdit(p); }}
                className="text-muted-foreground hover:text-primary transition-colors"
                title="จัดการราคา"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (p: StockProduct) => {
        const s = statusLabels[p.status] || { label: p.status, className: 'bg-muted text-foreground' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
      },
    },
    {
      key: 'branch',
      label: 'สาขา',
      render: (p: StockProduct) => <span className="text-xs font-medium">{p.branch.name}</span>,
    },
  ], [navigateToProduct, openPriceEdit, isManager, selectedIds, listProducts]);

  const actionTotal = dashboard
    ? dashboard.actionRequired.inspection + (dashboard.actionRequired.photoPending || 0) + dashboard.actionRequired.pendingTransfers + dashboard.actionRequired.repossessed + dashboard.actionRequired.agingOver90
    : 0;

  return (
    <div>
      <PageHeader
        title="คลังสินค้า"
        subtitle={`พร้อมขาย ${totalInStock} ชิ้น | มูลค่ารวม ${totalValue.toLocaleString()} ฿`}
        action={
          isManager && activeTab === 'list' ? (
            <div className="flex gap-2">
              {selectedIds.size > 0 && (
                <button
                  onClick={() => setShowBulkTransfer(true)}
                  className="px-4 py-2 border border-primary-300 text-primary rounded-lg text-sm font-medium hover:bg-primary-50 transition-colors"
                >
                  โอนสินค้า ({selectedIds.size})
                </button>
              )}
              <button
                onClick={() => handleExport(listProducts)}
                className="px-4 py-2 border border-input rounded-lg text-sm font-medium hover:bg-muted/50 transition-colors"
              >
                {selectedIds.size > 0 ? `Export (${selectedIds.size})` : 'Export CSV'}
              </button>
              <button
                onClick={() => navigate('/products/create')}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                + เพิ่มสินค้า
              </button>
            </div>
          ) : undefined
        }
      />

      <BranchSummaryCards
        summary={summary}
        filterBranch={filterBranch}
        setFilterBranch={setFilterBranch}
      />

      {/* Tabs: Dashboard / List */}
      <div className="flex gap-1 mb-6 bg-muted rounded-lg p-1 w-fit">
        <button
          onClick={() => handleTabChange('dashboard')}
          className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${
            activeTab === 'dashboard' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => handleTabChange('list')}
          className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${
            activeTab === 'list' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          รายการสินค้า {listResult ? `(${listResult.total})` : ''}
        </button>
      </div>

      {activeTab === 'dashboard' && (
        <StockDashboardTab
          dashboard={dashboard}
          isManager={isManager}
          actionTotal={actionTotal}
          warrantyExpiring={warrantyExpiring}
        />
      )}

      {activeTab === 'list' && (
        <StockListTab
          search={search}
          setSearch={setSearch}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterBranch={filterBranch}
          setFilterBranch={setFilterBranch}
          branches={branches}
          columns={columns}
          listProducts={listProducts}
          listLoading={listLoading}
          listResult={listResult}
          page={page}
          setPage={setPage}
        />
      )}

      <BulkTransferModal
        isOpen={showBulkTransfer}
        onClose={() => setShowBulkTransfer(false)}
        selectedIds={selectedIds}
        listProducts={listProducts}
        branches={branches}
        transferBranchId={transferBranchId}
        setTransferBranchId={setTransferBranchId}
        transferNotes={transferNotes}
        setTransferNotes={setTransferNotes}
        bulkTransferMutation={bulkTransferMutation}
        onSubmit={handleBulkTransfer}
      />

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

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        description={confirmDialog.message}
        onConfirm={confirmDialog.action}
      />
    </div>
  );
}
