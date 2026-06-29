import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { exportToExcel } from '@/utils/excel.util';
import { Download, ClipboardCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { formatDateShort } from '@/utils/formatters';
import { usePurchaseOrdersData } from './hooks/usePurchaseOrdersData';
import { usePOForm } from './hooks/usePOForm';
import { useCreatePoWizard } from './hooks/useCreatePoWizard';
import { computePoTotals } from './poTotals';
import { statusLabels, paymentStatusLabels } from './constants';
import { POListTab } from './components/POListTab';
import { AccountsPayableTab } from './components/AccountsPayableTab';
import { CreatePOModal } from './components/CreatePOModal';
import { PODetailModal } from './components/PODetailModal';
import { PaymentModal } from './components/PaymentModal';
import { GoodsReceivingModal } from './components/GoodsReceivingModal';
import { DirectReceiveModal } from './components/DirectReceiveModal';
import { PurchasingSummaryStrip } from './components/PurchasingSummaryStrip';
import type { SummaryFilterAction } from './summaryStrip';

export default function PurchaseOrdersPage() {
  const resetFormRef = useRef<() => void>(() => {});
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const wizardClearRef = useRef<() => void>(() => {});
  const onCreateSuccess = useCallback(() => {
    resetFormRef.current();
    wizardClearRef.current();
  }, []);

  const data = usePurchaseOrdersData({ onCreateSuccess });

  const poForm = usePOForm({
    createMutation: data.createMutation,
    suppliers: data.suppliers,
  });

  // Keep ref in sync
  resetFormRef.current = poForm.resetForm;

  const wizard = useCreatePoWizard({
    isOpen: data.isCreateModalOpen,
    form: poForm.form,
    setForm: poForm.setForm,
    items: poForm.items,
    setItems: poForm.setItems,
    selectedSupplier: poForm.selectedSupplier,
  });

  const totals = computePoTotals({
    items: poForm.items,
    discount: poForm.form.discount,
    discountAfterVat: poForm.form.discountAfterVat,
    supplierHasVat: poForm.supplierHasVat,
  });

  wizardClearRef.current = wizard.clearDraft;

  // Supplier selection handler: invalidate + refetch suppliers-for-po so a newly-created
  // supplier appears in the array, then set supplierId. The selectedSupplier/VAT/payment-method
  // computation in usePOForm keys off form.supplierId against the (refetched) suppliers array
  // so it will resolve correctly on the next render after invalidation completes.
  const onSupplierSelect = useCallback(
    async ({ childId }: { childId: string }) => {
      // Invalidate and await refetch so the refetched suppliers array includes the chosen/newly-created supplier
      await queryClient.invalidateQueries({ queryKey: ['suppliers-for-po'] });
      // After invalidation the query will refetch; grab the updated list from the cache
      const cached = queryClient.getQueryData<{ data: typeof data.suppliers }>([
        'suppliers-for-po',
      ]);
      const updatedSuppliers = cached?.data ?? data.suppliers;
      const sup = updatedSuppliers.find((s) => s.id === childId);
      const defaultPm = sup?.paymentMethods?.find((pm) => pm.isDefault) ?? sup?.paymentMethods?.[0];
      poForm.setForm((f) => ({
        ...f,
        supplierId: childId,
        paymentMethod: defaultPm?.paymentMethod ?? f.paymentMethod,
      }));
    },
    [queryClient, data.suppliers, poForm],
  );

  const onSummaryCardClick = useCallback(
    (action: SummaryFilterAction) => {
      if ('panel' in action) {
        navigate('/purchase-orders/qc'); // รอ QC → the dedicated QC center page (B4)
        return;
      }
      if (action.tab === 'payable') {
        data.setActiveTab('payable');
        return;
      }
      data.setActiveTab('list');
      data.setStatusFilter(action.status);
      data.setOverdueOnly(action.overdueOnly);
    },
    [data, navigate],
  );

  return (
    <div>
      <PageHeader
        title="ใบสั่งซื้อ (PO)"
        subtitle="จัดการการสั่งซื้อสินค้า"
        action={
          <div className="flex gap-2">
            <Link
              to="/purchase-orders/qc"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
            >
              <ClipboardCheck className="size-4" />
              ศูนย์ตรวจ QC
            </Link>
            {data.pos.length > 0 && (
              <button
                onClick={async () => {
                  try {
                    await exportToExcel({
                      columns: [
                        { header: 'เลข PO', key: 'poNumber', width: 15 },
                        { header: 'ผู้จัดจำหน่าย', key: 'supplier', width: 20 },
                        { header: 'วันที่สั่ง', key: 'orderDate', width: 15 },
                        { header: 'ยอดรวม', key: 'totalAmount', width: 15 },
                        { header: 'สถานะ', key: 'status', width: 15 },
                        { header: 'สถานะชำระเงิน', key: 'paymentStatus', width: 15 },
                      ],
                      data: data.pos.map((po) => ({
                        poNumber: po.poNumber,
                        supplier: po.supplier.name,
                        orderDate: formatDateShort(po.orderDate),
                        totalAmount: Number(po.netAmount).toLocaleString(),
                        status: statusLabels[po.status] || po.status,
                        paymentStatus: paymentStatusLabels[po.paymentStatus] || po.paymentStatus,
                      })),
                      sheetName: 'ใบสั่งซื้อ',
                      filename: `purchase_orders_${new Date().toISOString().slice(0, 10)}.xlsx`,
                    });
                    toast.success('ส่งออก Excel สำเร็จ');
                  } catch {
                    toast.error('ไม่สามารถส่งออก Excel ได้');
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
              >
                <Download className="size-4" />
                ส่งออก Excel
              </button>
            )}
            <button
              onClick={data.openDirectReceive}
              className="px-4 py-2 border border-input rounded-lg text-sm font-medium hover:bg-muted transition-colors"
            >
              รับเข้าตรง (supplier)
            </button>
            <button
              onClick={() => data.setIsCreateModalOpen(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              + สร้าง PO
            </button>
          </div>
        }
      />

      <PurchasingSummaryStrip summary={data.summary} onCardClick={onSummaryCardClick} />

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-border/60">
        <button
          onClick={() => data.setActiveTab('list')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${data.activeTab === 'list' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          รายการ PO
        </button>
        <button
          onClick={() => data.setActiveTab('payable')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${data.activeTab === 'payable' ? 'border-destructive text-destructive' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          ยอดค้างชำระ ( ผู้จัดจำหน่าย )
          {data.payableData && data.payableData.grandTotal > 0 && (
            <span className="ml-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-destructive/10 text-destructive dark:bg-destructive/15">
              {(Number(data.payableData.grandTotal) || 0).toLocaleString()}
            </span>
          )}
        </button>
      </div>

      {data.activeTab === 'list' ? (
        <POListTab
          statusFilter={data.statusFilter}
          setStatusFilter={data.setStatusFilterAndResetOverdue}
          pos={data.pos}
          isLoading={data.isLoading}
          openDetailModal={data.openDetailModal}
          openReceiveModal={data.openReceiveModal}
          openPaymentModal={data.openPaymentModal}
          approveMutation={data.approveMutation}
          orderMutation={data.orderMutation}
          rejectPOMutation={data.rejectPOMutation}
          cancelMutation={data.cancelMutation}
          setConfirmDialog={data.setConfirmDialog}
          suppliers={data.suppliers}
          overdueOnly={data.overdueOnly}
          setOverdueOnly={data.setOverdueOnly}
        />
      ) : (
        <AccountsPayableTab
          payableData={data.payableData}
          onOpenDetail={(po, detail) => {
            data.setSelectedPO(po);
            data.setPODetail(detail);
            data.setIsDetailModalOpen(true);
          }}
        />
      )}

      <CreatePOModal
        isOpen={data.isCreateModalOpen}
        onClose={() => data.setIsCreateModalOpen(false)}
        form={poForm.form}
        setForm={poForm.setForm}
        items={poForm.items}
        setItems={poForm.setItems}
        addItem={poForm.addItem}
        removeItem={poForm.removeItem}
        updateItem={poForm.updateItem}
        toggleModel={poForm.toggleModel}
        suppliers={data.suppliers}
        suppliersLoading={data.suppliersLoading}
        suppliersError={data.suppliersError}
        selectedSupplier={poForm.selectedSupplier}
        onSupplierSelect={onSupplierSelect}
        supplierHasVat={poForm.supplierHasVat}
        subtotal={poForm.subtotal}
        discountNum={poForm.discountNum}
        subtotalAfterDiscount={poForm.subtotalAfterDiscount}
        vatAmount={poForm.vatAmount}
        totalWithVat={poForm.totalWithVat}
        discountAfterVatNum={poForm.discountAfterVatNum}
        netAmount={poForm.netAmount}
        createMutation={data.createMutation}
        handleCreate={poForm.handleCreate}
        attachmentUrl={poForm.attachmentUrl}
        setAttachmentUrl={poForm.setAttachmentUrl}
        formAttachments={poForm.formAttachments}
        setFormAttachments={poForm.setFormAttachments}
        wizard={wizard}
        totals={totals}
      />

      <PODetailModal
        isOpen={data.isDetailModalOpen}
        onClose={() => {
          data.setIsDetailModalOpen(false);
          data.setPODetail(null);
        }}
        selectedPO={data.selectedPO}
        poDetail={data.poDetail}
        openReceiveModal={data.openReceiveModal}
        openPaymentModal={data.openPaymentModal}
      />

      <PaymentModal
        isOpen={data.isPaymentModalOpen}
        onClose={() => data.setIsPaymentModalOpen(false)}
        selectedPO={data.selectedPO}
        suppliers={data.suppliers}
        paymentForm={data.paymentForm}
        setPaymentForm={data.setPaymentForm}
        paymentAttachments={data.paymentAttachments}
        setPaymentAttachments={data.setPaymentAttachments}
        paymentAttachmentUrl={data.paymentAttachmentUrl}
        setPaymentAttachmentUrl={data.setPaymentAttachmentUrl}
        paymentMutation={data.paymentMutation}
        handlePaymentUpdate={data.handlePaymentUpdate}
      />

      <GoodsReceivingModal
        isOpen={data.isReceiveModalOpen}
        onClose={() => {
          data.setIsReceiveModalOpen(false);
          data.setReceivingUnits([]);
          data.setReceivingNotes('');
        }}
        selectedPO={data.selectedPO}
        receivingUnits={data.receivingUnits}
        setReceivingUnits={data.setReceivingUnits}
        receivingNotes={data.receivingNotes}
        setReceivingNotes={data.setReceivingNotes}
        goodsReceivingMutation={data.goodsReceivingMutation}
        updateReceivingUnit={data.updateReceivingUnit}
        updateChecklist={data.updateChecklist}
        handleGoodsReceiving={data.handleGoodsReceiving}
      />

      <DirectReceiveModal
        isOpen={data.isDirectReceiveOpen}
        onClose={() => data.setIsDirectReceiveOpen(false)}
        suppliers={data.suppliers}
        supplierId={data.directSupplierId}
        setSupplierId={data.setDirectSupplierId}
        lines={data.directLines}
        setLines={data.setDirectLines}
        notes={data.directNotes}
        setNotes={data.setDirectNotes}
        directReceiveMutation={data.directReceiveMutation}
      />

      <ConfirmDialog
        open={data.confirmDialog.open}
        onOpenChange={(open) => data.setConfirmDialog((prev) => ({ ...prev, open }))}
        description={data.confirmDialog.message}
        onConfirm={data.confirmDialog.action}
      />
    </div>
  );
}
