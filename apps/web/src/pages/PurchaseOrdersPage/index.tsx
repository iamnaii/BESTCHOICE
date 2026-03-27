import { useCallback, useRef } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { usePurchaseOrdersData } from './hooks/usePurchaseOrdersData';
import { usePOForm } from './hooks/usePOForm';
import { QcPendingPanel } from './components/QcPendingPanel';
import { POListTab } from './components/POListTab';
import { AccountsPayableTab } from './components/AccountsPayableTab';
import { CreatePOModal } from './components/CreatePOModal';
import { PODetailModal } from './components/PODetailModal';
import { PaymentModal } from './components/PaymentModal';
import { GoodsReceivingModal } from './components/GoodsReceivingModal';

export default function PurchaseOrdersPage() {
  const resetFormRef = useRef<() => void>(() => {});

  const onCreateSuccess = useCallback(() => {
    resetFormRef.current();
  }, []);

  const data = usePurchaseOrdersData({ onCreateSuccess });

  const poForm = usePOForm({
    createMutation: data.createMutation,
    suppliers: data.suppliers,
  });

  // Keep ref in sync
  resetFormRef.current = poForm.resetForm;

  return (
    <div>
      <PageHeader
        title="ใบสั่งซื้อ (PO)"
        subtitle="จัดการการสั่งซื้อสินค้า"
        action={
          <button
            onClick={() => data.setIsCreateModalOpen(true)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            + สร้าง PO
          </button>
        }
      />

      <QcPendingPanel
        qcPendingItems={data.qcPendingItems}
        showQcPanel={data.showQcPanel}
        setShowQcPanel={data.setShowQcPanel}
        qcNotes={data.qcNotes}
        setQcNotes={data.setQcNotes}
        qcConfirmMutation={data.qcConfirmMutation}
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b">
        <button
          onClick={() => data.setActiveTab('list')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${data.activeTab === 'list' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          รายการ PO
        </button>
        <button
          onClick={() => data.setActiveTab('payable')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${data.activeTab === 'payable' ? 'border-red-600 text-red-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          ยอดค้างจ่ายผู้ขาย
          {data.payableData && data.payableData.grandTotal > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">{(Number(data.payableData.grandTotal) || 0).toLocaleString()}</span>
          )}
        </button>
      </div>

      {data.activeTab === 'list' ? (
        <POListTab
          statusFilter={data.statusFilter}
          setStatusFilter={data.setStatusFilter}
          pos={data.pos}
          isLoading={data.isLoading}
          openDetailModal={data.openDetailModal}
          openReceiveModal={data.openReceiveModal}
          openPaymentModal={data.openPaymentModal}
          approveMutation={data.approveMutation}
          rejectPOMutation={data.rejectPOMutation}
          cancelMutation={data.cancelMutation}
          setConfirmDialog={data.setConfirmDialog}
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
        supplierHasVat={poForm.supplierHasVat}
        subtotal={poForm.subtotal}
        discountNum={poForm.discountNum}
        subtotalAfterDiscount={poForm.subtotalAfterDiscount}
        vatAmount={poForm.vatAmount}
        netAmount={poForm.netAmount}
        createMutation={data.createMutation}
        handleCreate={poForm.handleCreate}
        attachmentUrl={poForm.attachmentUrl}
        setAttachmentUrl={poForm.setAttachmentUrl}
        formAttachments={poForm.formAttachments}
        setFormAttachments={poForm.setFormAttachments}
      />

      <PODetailModal
        isOpen={data.isDetailModalOpen}
        onClose={() => { data.setIsDetailModalOpen(false); data.setPODetail(null); }}
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
        onClose={() => { data.setIsReceiveModalOpen(false); data.setReceivingUnits([]); data.setReceivingNotes(''); }}
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

      <ConfirmDialog
        open={data.confirmDialog.open}
        onOpenChange={(open) => data.setConfirmDialog((prev) => ({ ...prev, open }))}
        description={data.confirmDialog.message}
        onConfirm={data.confirmDialog.action}
      />
    </div>
  );
}
