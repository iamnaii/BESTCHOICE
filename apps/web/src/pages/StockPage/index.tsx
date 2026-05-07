import { useState, useMemo, useCallback } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { statusLabels, categoryLabels } from '@/lib/constants';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ArrowRightLeft, Check, Copy, Download, Eye, Plus, Printer } from 'lucide-react';
import { StockProduct } from './types';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { useStockData, useEditingProductSync } from './hooks/useStockData';
import { useStockFilters } from './hooks/useStockFilters';
import QueryBoundary from '@/components/QueryBoundary';
import { BranchSummaryCards } from './components/BranchSummaryCards';
import { StockHeroKpi } from './components/StockHeroKpi';
import { StockActionZone } from './components/StockActionZone';
import { StockDashboardTab } from './components/StockDashboardTab';
import { StockListTab } from './components/StockListTab';
import { BulkTransferModal } from './components/BulkTransferModal';
import { PriceManagementModal } from './components/PriceManagementModal';

function ImeiCopyBadge({ imei }: { imei: string }) {
  const { copy, copied } = useCopyToClipboard();
  return (
    <span className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground font-mono">{imei}</span>
      <button
        onClick={(e) => { e.stopPropagation(); copy(imei); }}
        className="text-muted-foreground/60 hover:text-primary transition-colors"
        title="คัดลอก IMEI/Serial"
      >
        {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
      </button>
    </span>
  );
}

export default function StockPage() {
  useDocumentTitle('สต็อกสินค้า');
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
  const { data: listResult, isLoading: listLoading, isError: listError, error: listErrorObj, refetch: listRefetch } = useQuery<{ data: StockProduct[]; total: number; page: number; totalPages: number }>({
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
      sortable: false,
      hideable: false,
      render: (p: StockProduct) => (
        <div>
          <button
            onClick={() => navigateToProduct(p.id)}
            className="text-left hover:underline"
          >
            <div className="text-primary font-medium">{p.brand} {p.model}</div>
          </button>
          {p.imeiSerial && <ImeiCopyBadge imei={p.imeiSerial} />}
        </div>
      ),
    },
    {
      key: 'category',
      label: 'ประเภท',
      sortable: true,
      hideable: true,
      render: (p: StockProduct) => <span className="text-xs">{categoryLabels[p.category] || p.category}</span>,
    },
    {
      key: 'color',
      label: 'สี',
      sortable: true,
      hideable: true,
      render: (p: StockProduct) => <span className="text-sm">{p.color || <span className="text-muted-foreground">—</span>}</span>,
    },
    {
      key: 'storage',
      label: 'ความจุ',
      sortable: true,
      hideable: true,
      render: (p: StockProduct) => <span className="text-sm">{p.storage || <span className="text-muted-foreground">—</span>}</span>,
    },
    {
      key: 'prices',
      label: 'ราคา',
      sortable: false,
      hideable: false,
      render: (p: StockProduct) => {
        const defaultPrice = p.prices?.find((pr) => pr.isDefault) || p.prices?.[0];
        const priceValue = defaultPrice ? parseFloat(defaultPrice.amount) : 0;
        const costValue = parseFloat(p.costPrice);
        return (
          <div className="flex items-center gap-1.5">
            <div>
              {priceValue > 0 ? (
                <div className="font-medium">{priceValue.toLocaleString()} ฿</div>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              {isManager && costValue > 0 && (
                <div className="text-xs text-muted-foreground">ทุน: {costValue.toLocaleString()} ฿</div>
              )}
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
      sortable: true,
      hideable: false,
      render: (p: StockProduct) => {
        const s = statusLabels[p.status] || { label: p.status, className: 'bg-muted text-foreground' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
      },
    },
    {
      key: 'branch',
      label: 'สาขา',
      sortable: false,
      hideable: true,
      render: (p: StockProduct) => <span className="text-xs font-medium">{p.branch.name}</span>,
    },
    {
      key: 'actions',
      label: '',
      render: (p: StockProduct) => (
        <button
          onClick={(e) => { e.stopPropagation(); navigateToProduct(p.id); }}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
          title="ดูรายละเอียดสินค้า"
        >
          <Eye className="size-3.5" />
          ดูรายละเอียด
        </button>
      ),
    },
  ], [navigateToProduct, openPriceEdit, isManager, selectedIds, listProducts]);

  const handleActionZoneNav = useCallback(
    (status?: string) => {
      handleTabChange('list');
      if (status) setFilterStatus(status);
    },
    [handleTabChange, setFilterStatus],
  );

  return (
    <div>
      <PageHeader
        title="คลังสินค้า"
        subtitle="จัดการคลังสินค้าและดูภาพรวมสต๊อค"
        action={
          isManager ? (
            <div className="flex gap-2 flex-wrap">
              {activeTab === 'list' && selectedIds.size > 0 && (
                <>
                  <Button variant="outline" size="md" onClick={() => setShowBulkTransfer(true)}>
                    <ArrowRightLeft className="size-4" />
                    โอน ({selectedIds.size})
                  </Button>
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() =>
                      navigate(
                        `/stickers?productIds=${encodeURIComponent(Array.from(selectedIds).join(','))}`,
                      )
                    }
                  >
                    <Printer className="size-4" />
                    พิมพ์ ({selectedIds.size})
                  </Button>
                </>
              )}
              {activeTab !== 'list' && (
                <Button variant="outline" size="md" onClick={() => navigate('/stickers')}>
                  <Printer className="size-4" />
                  พิมพ์สติกเกอร์
                </Button>
              )}
              {activeTab === 'list' && (
                <Button variant="outline" size="md" onClick={() => handleExport(listProducts)}>
                  <Download className="size-4" />
                  {selectedIds.size > 0 ? `ส่งออก (${selectedIds.size})` : 'ส่งออก CSV'}
                </Button>
              )}
              <Button variant="primary" size="md" onClick={() => navigate('/products/create')}>
                <Plus className="size-4" />
                เพิ่มสินค้า
              </Button>
            </div>
          ) : undefined
        }
      />

      <StockHeroKpi
        totalInStock={totalInStock}
        totalValue={totalValue}
        dashboard={dashboard}
        isManager={isManager}
      />

      <StockActionZone
        dashboard={dashboard}
        warrantyExpiring={warrantyExpiring}
        onNavigateToList={handleActionZoneNav}
      />

      <BranchSummaryCards
        summary={summary}
        filterBranch={filterBranch}
        setFilterBranch={setFilterBranch}
      />

      {/* Tabs: Dashboard / List */}
      <div className="flex gap-1 mb-5 bg-muted rounded-lg p-1 w-fit">
        <button
          onClick={() => handleTabChange('dashboard')}
          className={`px-4 py-1.5 text-[13px] rounded-md font-semibold transition-all ${
            activeTab === 'dashboard' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          ภาพรวม
        </button>
        <button
          onClick={() => handleTabChange('list')}
          className={`px-4 py-1.5 text-[13px] rounded-md font-semibold transition-all ${
            activeTab === 'list' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          รายการสินค้า
          {listResult ? (
            <span className="ml-1.5 font-mono tabular-nums text-muted-foreground/80">
              ({listResult.total})
            </span>
          ) : ''}
        </button>
      </div>

      {activeTab === 'dashboard' && (
        <StockDashboardTab
          dashboard={dashboard}
          isManager={isManager}
        />
      )}

      {activeTab === 'list' && (
        <QueryBoundary
          isLoading={listLoading && !listResult}
          isError={listError}
          error={listErrorObj}
          onRetry={listRefetch}
          errorTitle="ไม่สามารถโหลดคลังสินค้าได้"
        >
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
        </QueryBoundary>
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
