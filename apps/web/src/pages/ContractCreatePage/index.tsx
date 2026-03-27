import React, { useRef } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { STEPS } from './constants';
import type { PendingDoc } from './types';
import { useContractCreateData } from './hooks/useContractCreateData';
import { useContractCalculation } from './hooks/useContractCalculation';
import { useOcrFlow } from './hooks/useOcrFlow';
import { useDocumentUpload } from './hooks/useDocumentUpload';
import { StepIndicator } from './components/StepIndicator';
import { ProductSelectStep } from './components/ProductSelectStep';
import { CustomerSelectStep } from './components/CustomerSelectStep';
import { PlanDetailsStep } from './components/PlanDetailsStep';
import { DocumentUploadStep } from './components/DocumentUploadStep';
import { ContractSummaryPanel } from './components/ContractSummaryPanel';
import { CustomerCreateModal } from './components/CustomerCreateModal';
import { EditProductModal } from './components/EditProductModal';
import { EditCustomerModal } from './components/EditCustomerModal';

export default function ContractCreatePage() {
  const data = useContractCreateData();

  const calculation = useContractCalculation({
    selectedProduct: data.selectedProduct,
    interestConfig: data.interestConfig,
    posConfig: data.posConfig,
    downPayment: data.downPayment,
    setDownPayment: data.setDownPayment,
    totalMonths: data.totalMonths,
    setTotalMonths: data.setTotalMonths,
  });

  // Use a ref to break the circular dependency between useOcrFlow and useDocumentUpload
  const setPendingDocsRef = useRef<React.Dispatch<React.SetStateAction<PendingDoc[]>>>(() => {});

  const ocrFlow = useOcrFlow({
    setSelectedCustomer: data.setSelectedCustomer,
    setPendingDocs: (updater) => setPendingDocsRef.current(updater),
    setCustForm: data.setCustForm,
    setCustAddrIdCard: data.setCustAddrIdCard,
  });

  const docUpload = useDocumentUpload({
    ocrLoading: ocrFlow.ocrLoading,
    setOcrLoading: (v) => ocrFlow.setOcrLoading(v),
    setOcrResult: ocrFlow.setOcrResult,
    setShowOcrPanel: ocrFlow.setShowOcrPanel,
    setShowCreateCustomer: ocrFlow.setShowCreateCustomer,
  });

  // Wire the ref to the actual setter after initialization
  setPendingDocsRef.current = docUpload.setPendingDocs;

  const goToStep = (nextStep: number) => {
    ocrFlow.setShowOcrPanel(false);
    ocrFlow.setShowCreateCustomer(false);
    ocrFlow.setOcrLoading(false);
    data.goToStep(nextStep);
  };

  const canNext = () => {
    return data.canNext(
      calculation.sellingPrice,
      calculation.minDownPct,
      calculation.minMonths,
      calculation.maxMonths,
    );
  };

  const handleSubmit = (submitForReview: boolean) => {
    data.handleSubmit(submitForReview, docUpload.pendingDocs, calculation.sellingPrice);
  };

  return (
    <div>
      <PageHeader
        title="สร้างสัญญาผ่อนชำระ"
        subtitle={STEPS[data.step]}
        action={
          <button onClick={() => data.navigate('/contracts')} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg">
            ยกเลิก
          </button>
        }
      />

      {/* Step indicator */}
      <StepIndicator steps={STEPS} currentStep={data.step} />

      {/* Step 1: Select Product */}
      {data.step === 0 && (
        <ProductSelectStep
          products={data.products}
          productSearch={data.productSearch}
          setProductSearch={data.setProductSearch}
          selectedProduct={data.selectedProduct}
          setSelectedProduct={data.setSelectedProduct}
          onNext={() => goToStep(1)}
        />
      )}

      {/* Step 2: Select Customer */}
      {data.step === 1 && (
        <CustomerSelectStep
          customers={data.customers}
          customerSearch={data.customerSearch}
          setCustomerSearch={data.setCustomerSearch}
          selectedCustomer={data.selectedCustomer}
          setSelectedCustomer={data.setSelectedCustomer}
          onNext={() => goToStep(2)}
          latestCreditCheck={data.latestCreditCheck}
          customerCreditApproved={data.customerCreditApproved}
          navigate={data.navigate}
          onOpenCustomerModal={() => { data.resetCustForm(); data.setShowCustomerModal(true); }}
        />
      )}

      {/* Step 3: Plan Details */}
      {data.step === 2 && (
        <PlanDetailsStep
          selectedProduct={data.selectedProduct}
          interestConfig={data.interestConfig}
          sellingPrice={calculation.sellingPrice}
          downPayment={data.downPayment}
          setDownPayment={data.setDownPayment}
          setDownPaymentTouched={calculation.setDownPaymentTouched}
          totalMonths={data.totalMonths}
          setTotalMonths={data.setTotalMonths}
          minDownPct={calculation.minDownPct}
          minMonths={calculation.minMonths}
          maxMonths={calculation.maxMonths}
          notes={data.notes}
          setNotes={data.setNotes}
          paymentDueDay={data.paymentDueDay}
          setPaymentDueDay={data.setPaymentDueDay}
          interestRate={calculation.interestRate}
          storeCommPct={calculation.storeCommPct}
          vatPct={calculation.vatPct}
          principal={calculation.principal}
          storeCommission={calculation.storeCommission}
          interestTotal={calculation.interestTotal}
          vatAmount={calculation.vatAmount}
          financedAmount={calculation.financedAmount}
          monthlyPayment={calculation.monthlyPayment}
          monthOptions={calculation.monthOptions}
        />
      )}

      {/* Step 4: Document Attachments */}
      {data.step === 3 && (
        <DocumentUploadStep
          pendingDocs={docUpload.pendingDocs}
          dragOverType={docUpload.dragOverType}
          setDragOverType={docUpload.setDragOverType}
          fileInputRefs={docUpload.fileInputRefs}
          handleDropForType={docUpload.handleDropForType}
          handleFileInputForType={docUpload.handleFileInputForType}
          handleRemoveDoc={docUpload.handleRemoveDoc}
          ocrLoading={ocrFlow.ocrLoading}
          showOcrPanel={ocrFlow.showOcrPanel}
          ocrResult={ocrFlow.ocrResult}
          setShowOcrPanel={ocrFlow.setShowOcrPanel}
          updateCustomerFromOcr={ocrFlow.updateCustomerFromOcr}
          selectedCustomer={data.selectedCustomer}
        />
      )}

      {/* Summary panel (embedded in Step 4 Documents) */}
      {data.step === 3 && data.selectedProduct && data.selectedCustomer && (
        <ContractSummaryPanel
          selectedProduct={data.selectedProduct}
          selectedCustomer={data.selectedCustomer}
          sellingPrice={calculation.sellingPrice}
          downPayment={data.downPayment}
          totalMonths={data.totalMonths}
          monthlyPayment={calculation.monthlyPayment}
          interestRate={calculation.interestRate}
          interestConfig={data.interestConfig}
          pendingDocs={docUpload.pendingDocs}
        />
      )}

      {/* Navigation buttons */}
      <div className="flex justify-between mt-6">
        <button
          onClick={() => data.step > 0 && goToStep(data.step - 1)}
          className={`px-6 py-2 text-sm rounded-lg border ${data.step === 0 ? 'invisible' : 'border-input text-muted-foreground hover:bg-muted'}`}
        >
          ย้อนกลับ
        </button>
        {data.step < 3 ? (
          <button
            onClick={() => canNext() && goToStep(data.step + 1)}
            disabled={!canNext()}
            className="px-6 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ถัดไป
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => handleSubmit(false)}
              disabled={data.createMutation.isPending}
              className="px-6 py-2 text-sm border border-input text-foreground rounded-lg hover:bg-muted disabled:opacity-50"
            >
              {data.createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกร่าง'}
            </button>
            <button
              onClick={() => handleSubmit(true)}
              disabled={data.createMutation.isPending}
              className="px-6 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {data.createMutation.isPending ? 'กำลังส่ง...' : 'สร้าง + ส่งตรวจสอบ'}
            </button>
          </div>
        )}
      </div>

      {/* Edit product modal */}
      <EditProductModal
        isOpen={data.showEditProductModal}
        onClose={() => data.setShowEditProductModal(false)}
        editProductForm={data.editProductForm}
        setEditProductForm={data.setEditProductForm}
        editProductMutation={data.editProductMutation}
      />

      {/* Edit customer modal */}
      <EditCustomerModal
        isOpen={data.showEditCustomerModal}
        onClose={() => data.setShowEditCustomerModal(false)}
        editCustForm={data.editCustForm}
        setEditCustForm={data.setEditCustForm}
        editCustomerMutation={data.editCustomerMutation}
      />

      {/* Customer creation modal */}
      <CustomerCreateModal
        isOpen={data.showCustomerModal}
        onClose={() => data.setShowCustomerModal(false)}
        custForm={data.custForm}
        setCustForm={data.setCustForm}
        custAddrIdCard={data.custAddrIdCard}
        setCustAddrIdCard={data.setCustAddrIdCard}
        custAddrCurrent={data.custAddrCurrent}
        setCustAddrCurrent={data.setCustAddrCurrent}
        custSameAddress={data.custSameAddress}
        setCustSameAddress={data.setCustSameAddress}
        custAddrWork={data.custAddrWork}
        setCustAddrWork={data.setCustAddrWork}
        custReferences={data.custReferences}
        updateCustRef={data.updateCustRef}
        createCustomerMutation={data.createCustomerMutation}
        handleSmartCardForModal={ocrFlow.handleSmartCardForModal}
        cardReaderLoading={ocrFlow.cardReaderLoading}
      />
    </div>
  );
}
