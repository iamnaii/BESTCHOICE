import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import QueryBoundary from '@/components/QueryBoundary';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { statusLabels, categoryLabels } from '@/lib/constants';
import { ArrowRightLeft, BarChart3, Check, Copy, Download, Eye, Plus, Printer } from 'lucide-react';
import { getDisplayPrices } from '@/utils/getDisplayPrices';
import { StockProduct } from './types';
import { useStockProducts, useEditingProductSync } from './hooks/useStockProducts';
import { StockListTab } from './components/StockListTab';
import { BulkTransferModal } from './components/BulkTransferModal';
import { PriceManagementModal } from './components/PriceManagementModal';

function ImeiCopyBadge({ imei }: { imei: string }) {
  const { copy, copied } = useCopyToClipboard();
  return (
    <span className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground font-mono">{imei}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          copy(imei);
        }}
        className="text-muted-foreground/60 hover:text-primary transition-colors"
        title="คัดลอก IMEI/Serial"
      >
        {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
      </button>
    </span>
  );
}

export default function StockProductsPage() {
  useDocumentTitle('รายการสินค้า');
  const navigate = useNavigate();
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    message: string;
    action: () => void;
  }>({ open: false, message: '', action: () => {} });

  const products = useStockProducts();
  const {
    isManager,
    search,
    setSearch,
    filterStatus,
    setFilterStatus,
    filterCategory,
    setFilterCategory,
    filterBranch,
    setFilterBranch,
    page,
    setPage,
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    listResult,
    listLoading,
    listError,
    listErrorObj,
    listRefetch,
    listProducts,
    branches,
    handleExport,
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
  } = products;

  useEditingProductSync(editingProduct, listProducts, setEditingProduct);

  const navigateToProduct = useCallback((id: string) => navigate(`/products/${id}`), [navigate]);

  const handleBulkTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIds.size === 0 || !transferBranchId) return;
    bulkTransferMutation.mutate({
      productIds: Array.from(selectedIds),
      toBranchId: transferBranchId,
      notes: transferNotes || undefined,
    });
  };

  const columns = useMemo(
    () => [
      ...(isManager
        ? [
            {
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
                  onChange={(e) => {
                    e.stopPropagation();
                    toggleSelect(p.id);
                  }}
                  className="rounded text-primary"
                />
              ),
            },
          ]
        : []),
      {
        key: 'name',
        label: 'สินค้า',
        sortable: false,
        hideable: false,
        render: (p: StockProduct) => (
          <div>
            <button onClick={() => navigateToProduct(p.id)} className="text-left hover:underline">
              <div className="text-primary font-medium">
                {p.brand} {p.model}
              </div>
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
        render: (p: StockProduct) => (
          <span className="text-xs">{categoryLabels[p.category] || p.category}</span>
        ),
      },
      {
        key: 'color',
        label: 'สี',
        sortable: true,
        hideable: true,
        render: (p: StockProduct) => (
          <span className="text-sm">
            {p.color || <span className="text-muted-foreground">—</span>}
          </span>
        ),
      },
      {
        key: 'storage',
        label: 'ความจุ',
        sortable: true,
        hideable: true,
        render: (p: StockProduct) => (
          <span className="text-sm">
            {p.storage || <span className="text-muted-foreground">—</span>}
          </span>
        ),
      },
      {
        key: 'prices',
        label: 'ราคา',
        sortable: false,
        hideable: false,
        render: (p: StockProduct) => {
          const { installment, cash } = getDisplayPrices({ prices: p.prices ?? [] });
          const priceValue = installment ?? cash ?? 0;
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
                  <div className="text-xs text-muted-foreground">
                    ทุน: {costValue.toLocaleString()} ฿
                  </div>
                )}
              </div>
              {isManager && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openPriceEdit(p);
                  }}
                  className="text-muted-foreground hover:text-primary transition-colors"
                  title="จัดการราคา"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
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
          const s = statusLabels[p.status] || {
            label: p.status,
            className: 'bg-muted text-foreground',
          };
          return (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>
              {s.label}
            </span>
          );
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
            onClick={(e) => {
              e.stopPropagation();
              navigateToProduct(p.id);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
            title="ดูรายละเอียดสินค้า"
          >
            <Eye className="size-3.5" />
            ดูรายละเอียด
          </button>
        ),
      },
    ],
    [navigateToProduct, openPriceEdit, isManager, selectedIds, listProducts, toggleSelect, toggleSelectAll],
  );

  return (
    <div>
      <PageHeader
        title="รายการสินค้า"
        subtitle={
          listResult ? `ทั้งหมด ${listResult.total.toLocaleString()} ชิ้น` : 'ค้นหา/แก้ไข/โอน/พิมพ์สติกเกอร์'
        }
        action={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="md" onClick={() => navigate('/stock')}>
              <BarChart3 className="size-4" />
              ภาพรวม
            </Button>
            {isManager && selectedIds.size > 0 && (
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
            {isManager && (
              <Button variant="outline" size="md" onClick={() => handleExport(listProducts)}>
                <Download className="size-4" />
                {selectedIds.size > 0 ? `ส่งออก (${selectedIds.size})` : 'ส่งออก CSV'}
              </Button>
            )}
            {isManager && (
              <Button variant="primary" size="md" onClick={() => navigate('/products/create')}>
                <Plus className="size-4" />
                เพิ่มสินค้า
              </Button>
            )}
          </div>
        }
      />

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
