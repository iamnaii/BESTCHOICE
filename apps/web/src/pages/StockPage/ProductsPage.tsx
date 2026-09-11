import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  ArrowRightLeft,
  BarChart3,
  ChevronDown,
  MoreHorizontal,
  Download,
  Globe,
  Plus,
  Printer,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { buildStockColumns, type StockColumn } from './components/stockColumns';
import { useStockProducts, useEditingProductSync } from './hooks/useStockProducts';
import { useStockInstallments } from './hooks/useStockInstallments';
import { StockListTab } from './components/StockListTab';
import { BulkTransferModal } from './components/BulkTransferModal';
import { PriceManagementModal } from './components/PriceManagementModal';

export default function StockProductsPage() {
  useDocumentTitle('รายการสินค้า');
  const navigate = useNavigate();
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    message: string;
    action: () => void;
  }>({ open: false, message: '', action: () => {} });

  const [bulkResult, setBulkResult] = useState<{
    matched: number;
    changed: number;
    alreadySet: number;
    willAppear: number;
    blockedBy: Array<{ reason: string; count: number }>;
  } | null>(null);

  const products = useStockProducts();
  const {
    isManager,
    view,
    setView,
    viewCounts,
    sort,
    setSort,
    search,
    setSearch,
    clearFilters,
    filterStatus,
    setFilterStatus,
    filterCategory,
    setFilterCategory,
    accessoryGroupId,
    setAccessoryGroupId,
    filterBranch,
    setFilterBranch,
    page,
    setPage,
    selectedIds,
    setSelectedIds,
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
  const installmentPlans = useStockInstallments(listProducts);
  const isMobile = useIsMobile();
  const selectableProducts = useMemo(
    () => listProducts.filter((product) => !product.stockGroup),
    [listProducts],
  );
  useEditingProductSync(editingProduct, listProducts, setEditingProduct);

  const navigateToProduct = useCallback((id: string) => navigate(`/products/${id}`), [navigate]);

  const publishMutation = useMutation({
    mutationFn: async (vars: { scope: 'SELECTED' | 'ALL_IN_STOCK'; productIds?: string[] }) =>
      (
        await api.post('/products/online-listing/bulk-visibility', {
          isOnlineVisible: true,
          ...vars,
        })
      ).data,
    onSuccess: (res) => {
      setBulkResult(res);
      // ตัวเลขสองอันนี้ไม่เท่ากันเป็นเรื่องปกติ — สวิตช์เปิดได้ทุกเครื่อง แต่จะโผล่
      // หน้าร้านเฉพาะเครื่องที่ข้อมูลครบ พูดให้ชัดตั้งแต่ toast
      toast.success(
        res.willAppear === res.matched
          ? `ส่งขึ้นเว็บแล้ว ${res.matched} เครื่อง`
          : `เปิดแสดงบนเว็บ ${res.matched} เครื่อง — ขึ้นหน้าร้านจริง ${res.willAppear} เครื่อง`,
      );
      listRefetch();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const askPublish = (scope: 'SELECTED' | 'ALL_IN_STOCK') =>
    setConfirmDialog({
      open: true,
      message:
        (scope === 'SELECTED'
          ? `ส่ง ${selectedIds.size} เครื่องที่เลือกขึ้นเว็บ?`
          : 'ส่งสินค้าในสต็อกขึ้นเว็บทั้งหมด?') +
        ' เครื่องที่ยังไม่มีราคาขายสดหรือยังไม่มีรูป จะถูกเปิดสวิตช์ไว้ให้แต่ยังไม่ขึ้นหน้าร้าน พอเติมข้อมูลครบจะขึ้นเอง',
      action: () =>
        publishMutation.mutate(
          scope === 'SELECTED' ? { scope, productIds: Array.from(selectedIds) } : { scope },
        ),
    });

  const handleBulkTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIds.size === 0 || !transferBranchId) return;
    bulkTransferMutation.mutate({
      productIds: Array.from(selectedIds),
      toBranchId: transferBranchId,
      notes: transferNotes || undefined,
    });
  };

  // คอลัมน์ทั้งหมดอยู่ใน components/stockColumns.tsx (ตารางคอมกับการ์ดมือถือใช้ชุดเดียวกัน)
  const columns = useMemo<StockColumn[]>(
    () =>
      buildStockColumns({
        isManager,
        view,
        filterCategory,
        showNameCaption: !isMobile,
        listProducts,
        selectableProducts,
        selectedIds,
        toggleSelectAll,
        toggleSelect,
        navigateToProduct,
        openPriceEdit,
        setAccessoryGroupId,
        installments: installmentPlans.installments,
      }),
    [
      isManager,
      view,
      filterCategory,
      isMobile,
      listProducts,
      selectableProducts,
      selectedIds,
      toggleSelectAll,
      toggleSelect,
      navigateToProduct,
      openPriceEdit,
      setAccessoryGroupId,
      installmentPlans.installments,
    ],
  );

  return (
    <div>
      {/* pt-5 ให้ห่างจากแถบบนเท่ากับ PageHeader ของหน้าอื่น (เจ้าของ 2026-09-11: "ชิดขอบบนไป") */}
      <header className="mb-5 flex items-center justify-between gap-3 pt-5">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground leading-snug sm:text-2xl">
            รายการสินค้า
          </h1>
          <p className="mt-1 hidden text-sm text-muted-foreground leading-snug sm:block">
            ดูราคาและสินค้าคงเหลือของแต่ละสาขา
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="size-11 rounded-lg p-0 sm:w-auto sm:px-3"
                aria-label="เครื่องมือ"
              >
                <MoreHorizontal aria-hidden="true" className="size-4 sm:hidden" />
                <span className="hidden sm:inline">เครื่องมือ</span>
                <ChevronDown aria-hidden="true" className="hidden size-4 sm:block" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem
                className="min-h-11 cursor-pointer"
                onSelect={() => navigate('/stock')}
              >
                <BarChart3 aria-hidden="true" />
                ดูภาพรวมคลัง
              </DropdownMenuItem>
              {isManager && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="min-h-11 cursor-pointer"
                    disabled={listLoading || !listProducts.length}
                    onSelect={() => handleExport(listProducts)}
                  >
                    <Download aria-hidden="true" />
                    {selectedIds.size > 0
                      ? `ส่งออกที่เลือก (${selectedIds.size})`
                      : 'ส่งออกหน้านี้เป็น CSV'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="min-h-11 cursor-pointer"
                    disabled={publishMutation.isPending}
                    onSelect={() => askPublish('ALL_IN_STOCK')}
                  >
                    <Globe aria-hidden="true" />
                    ส่งขึ้นเว็บทั้งสต็อก
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {isManager && (
            <Button
              variant="primary"
              className="h-11 shrink-0 rounded-lg px-3 shadow-xs"
              aria-label="เพิ่มสินค้า"
              onClick={() => navigate('/products/create')}
            >
              <Plus aria-hidden="true" className="size-4" />
              <span className="sm:hidden">เพิ่ม</span>
              <span className="hidden sm:inline">เพิ่มสินค้า</span>
            </Button>
          )}
        </div>
      </header>

      {/* สรุปหลังกดส่งขึ้นเว็บ — บอกตรง ๆ ว่าเหลือกี่เครื่องที่ยังไม่โผล่ และติดอะไร
          ถ้าไม่บอก เจ้าของจะนึกว่าเปิดแล้วต้องขึ้นครบ แล้วไปงงที่หน้าเว็บแทน */}
      {bulkResult && (
        <div className="mb-4 rounded-lg border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground leading-snug">
                เปิดแสดงบนเว็บ {bulkResult.matched.toLocaleString()} เครื่อง — ขึ้นหน้าร้านจริง{' '}
                <span className="text-primary">{bulkResult.willAppear.toLocaleString()}</span>{' '}
                เครื่อง
              </p>
              {bulkResult.alreadySet > 0 && (
                <p className="text-xs text-muted-foreground leading-snug">
                  ในจำนวนนี้เปิดไว้อยู่แล้ว {bulkResult.alreadySet.toLocaleString()} เครื่อง
                </p>
              )}
              {bulkResult.blockedBy.length > 0 && (
                <div className="pt-1">
                  <p className="text-xs text-muted-foreground leading-snug">
                    ที่ยังไม่ขึ้นหน้าร้าน เพราะยังขาด:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {bulkResult.blockedBy.map((b) => (
                      <li key={b.reason} className="text-xs text-foreground leading-snug">
                        • {b.reason} — {b.count.toLocaleString()} เครื่อง
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-xs text-muted-foreground leading-snug">
                    เติมข้อมูลได้ที่หน้าสินค้า แท็บ “ขึ้นเว็บ” แล้วเครื่องจะขึ้นเองโดยไม่ต้องกดซ้ำ
                  </p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setBulkResult(null)}
              aria-label="ปิดสรุป"
              className="p-1 rounded hover:bg-accent shrink-0"
            >
              <X className="size-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      )}

      {installmentPlans.isError && (
        <div
          role="alert"
          className="mb-3 flex items-center gap-2 text-sm leading-snug text-destructive"
        >
          โหลดเงื่อนไขผ่อนไม่สำเร็จ จึงยังแสดงดาวน์และค่างวดบางรายการไม่ได้
          <button
            type="button"
            className="underline"
            onClick={installmentPlans.retry}
            disabled={installmentPlans.isFetching}
          >
            ลองใหม่
          </button>
        </div>
      )}
      {accessoryGroupId && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button variant="outline" className="min-h-11" onClick={() => setAccessoryGroupId('')}>
            กลับไปดูแบบรวม
          </Button>
          <p className="text-sm text-muted-foreground leading-snug">
            รายการแต่ละชิ้นในกลุ่มอุปกรณ์ · เลือกชิ้นที่ต้องการจัดการ
          </p>
        </div>
      )}
      <StockListTab
        accessoryGroupId={accessoryGroupId}
        search={search}
        setSearch={setSearch}
        clearFilters={clearFilters}
        view={view}
        setView={setView}
        viewCounts={viewCounts}
        filterStatus={filterStatus}
        setFilterStatus={setFilterStatus}
        filterCategory={filterCategory}
        setFilterCategory={setFilterCategory}
        filterBranch={filterBranch}
        setFilterBranch={setFilterBranch}
        branches={branches}
        columns={columns}
        sort={sort}
        onSortChange={setSort}
        listProducts={listProducts}
        listLoading={listLoading}
        listError={listError}
        listErrorObj={listErrorObj}
        listRefetch={listRefetch}
        listResult={listResult}
        page={page}
        isManager={isManager}
        selectedIds={selectedIds}
        onSelectAll={() => toggleSelectAll(listProducts)}
        bulkActions={
          isManager && selectedIds.size > 0 ? (
            <div
              className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2"
              role="region"
              aria-label="จัดการสินค้าที่เลือก"
            >
              <span className="mr-auto text-sm font-medium leading-snug">
                เลือก {selectedIds.size} รายการ
              </span>
              <Button variant="outline" className="h-11" onClick={() => setShowBulkTransfer(true)}>
                <ArrowRightLeft aria-hidden="true" className="size-4" />
                โอนสาขา
              </Button>
              <Button
                variant="outline"
                className="h-11"
                onClick={() =>
                  navigate(
                    `/stickers?productIds=${encodeURIComponent(Array.from(selectedIds).join(','))}`,
                  )
                }
              >
                <Printer aria-hidden="true" className="size-4" />
                พิมพ์สติกเกอร์
              </Button>
              <Button
                variant="outline"
                className="h-11"
                disabled={publishMutation.isPending}
                onClick={() => askPublish('SELECTED')}
              >
                <Globe aria-hidden="true" className="size-4" />
                ส่งขึ้นเว็บ
              </Button>
              <Button
                variant="ghost"
                mode="icon"
                className="size-11"
                aria-label="ยกเลิกการเลือกทั้งหมด"
                onClick={() => setSelectedIds(new Set())}
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </div>
          ) : undefined
        }
        setPage={setPage}
      />

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
