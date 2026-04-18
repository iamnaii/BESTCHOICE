import React, { useRef } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Save, Send } from 'lucide-react';
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
  useDocumentTitle('สร้างสัญญา');
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

      {/* Step indicator — Metronic style */}
      <StepIndicator steps={STEPS} currentStep={data.step} onStepClick={(s) => goToStep(s)} />

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
          overrideActiveContractCheck={data.overrideActiveContractCheck}
          setOverrideActiveContractCheck={data.setOverrideActiveContractCheck}
        />
      )}

      {/* Step 3: Plan Details */}
      {data.step === 2 && (
        <PlanDetailsStep
          selectedProduct={data.selectedProduct}
          interestConfig={data.interestConfig}
          selectedCustomer={data.selectedCustomer}
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
      <div className="flex justify-between mt-8 pt-6 border-t border-border/60">
        <Button
          variant="outline"
          size="lg"
          onClick={() => data.step > 0 && goToStep(data.step - 1)}
          className={data.step === 0 ? 'invisible' : ''}
        >
          <ArrowLeft className="size-4" />
          ย้อนกลับ
        </Button>
        {data.step < 3 ? (
          <Button
            variant="primary"
            size="lg"
            onClick={() => canNext() && goToStep(data.step + 1)}
            disabled={!canNext()}
          >
            ถัดไป
            <ArrowRight className="size-4" />
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="lg"
              onClick={() => handleSubmit(false)}
              disabled={data.createMutation.isPending}
            >
              <Save className="size-4" />
              {data.createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกร่าง'}
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={() => handleSubmit(true)}
              disabled={data.createMutation.isPending}
              className="bg-success text-success-foreground hover:bg-success/90"
            >
              <Send className="size-4" />
              {data.createMutation.isPending ? 'กำลังส่ง...' : 'สร้าง + ส่งตรวจสอบ'}
            </Button>
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
