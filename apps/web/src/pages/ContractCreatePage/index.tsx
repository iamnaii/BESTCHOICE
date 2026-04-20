import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Send } from 'lucide-react';
import { STEPS } from './constants';
import { useContractCreateData } from './hooks/useContractCreateData';
import { useContractCalculation } from './hooks/useContractCalculation';
import { useOcrFlow } from './hooks/useOcrFlow';
import { StepIndicator } from './components/StepIndicator';
import { ProductSelectStep } from './components/ProductSelectStep';
import { CustomerSelectStep } from './components/CustomerSelectStep';
import { PlanDetailsStep } from './components/PlanDetailsStep';
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

  const ocrFlow = useOcrFlow({
    setSelectedCustomer: data.setSelectedCustomer,
    setCustForm: data.setCustForm,
    setCustAddrIdCard: data.setCustAddrIdCard,
  });

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

  const lastStep = STEPS.length - 1;

  const handleSubmit = () => {
    data.handleSubmit(calculation.sellingPrice);
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

      <StepIndicator steps={STEPS} currentStep={data.step} onStepClick={(s) => goToStep(s)} />

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

      {data.step === 2 && (
        <>
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

          {data.selectedProduct && data.selectedCustomer && (
            <ContractSummaryPanel
              selectedProduct={data.selectedProduct}
              selectedCustomer={data.selectedCustomer}
              sellingPrice={calculation.sellingPrice}
              downPayment={data.downPayment}
              totalMonths={data.totalMonths}
              monthlyPayment={calculation.monthlyPayment}
              interestRate={calculation.interestRate}
              interestConfig={data.interestConfig}
            />
          )}
        </>
      )}

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
        {data.step < lastStep ? (
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
          <Button
            variant="primary"
            size="lg"
            onClick={handleSubmit}
            disabled={data.createMutation.isPending}
          >
            <Send className="size-4" />
            {data.createMutation.isPending ? 'กำลังสร้าง...' : 'สร้างสัญญา'}
          </Button>
        )}
      </div>

      <EditProductModal
        isOpen={data.showEditProductModal}
        onClose={() => data.setShowEditProductModal(false)}
        editProductForm={data.editProductForm}
        setEditProductForm={data.setEditProductForm}
        editProductMutation={data.editProductMutation}
      />

      <EditCustomerModal
        isOpen={data.showEditCustomerModal}
        onClose={() => data.setShowEditCustomerModal(false)}
        editCustForm={data.editCustForm}
        setEditCustForm={data.setEditCustForm}
        editCustomerMutation={data.editCustomerMutation}
      />

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
