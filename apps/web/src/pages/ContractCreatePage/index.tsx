import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import TradeInCreditPicker from '@/components/trade-in/TradeInCreditPicker';
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
import { contractCreditIssue, contractCreditSchedule } from './credit-approval';

export default function ContractCreatePage() {
  useDocumentTitle('สร้างสัญญา');
  const data = useContractCreateData();

  const calculation = useContractCalculation({
    tradeInBaseAmount: Number(data.tradeInCredit?.baseAmount ?? 0),
    tradeInBonusAmount: Number(data.tradeInCredit?.bonusAmount ?? 0),
    selectedProduct: data.selectedProduct,
    preserveDownPayment: data.preserveDownPayment,
    configPending: data.configPending,
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
    return (data.step !== 2 || !creditIssue) && data.canNext(
      calculation.sellingPrice,
      calculation.minDownPct,
      calculation.minMonths,
      calculation.maxMonths,
    );
  };

  const lastStep = STEPS.length - 1;

  const creditPlan = { monthlyPayment: calculation.monthlyPayment, financedAmount: calculation.financedAmount,
    totalMonths: data.totalMonths, paymentDueDay: data.paymentDueDay };
  const creditIssue = contractCreditIssue(data.creditApproval, creditPlan);
  const creditSchedule = contractCreditSchedule(creditPlan);

  const handleSubmit = () => {
    data.handleSubmit(calculation.grossSellingPrice, creditPlan);
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
      <div className="my-4"><TradeInCreditPicker customerId={data.selectedCustomer?.id} branchId={data.selectedProduct?.branchId}
        productId={data.selectedProduct?.id} value={data.tradeInCreditId} disabled={data.createMutation.isPending}
        onChange={(id) => { data.setTradeInCreditId(id); data.setTradeInCredit(null); }} onResolved={data.setTradeInCredit} /></div>
      {data.tradeInCredit && <div className="mb-4 rounded-lg bg-primary/5 p-3 text-sm space-y-1">
        <p>ราคาสินค้า {calculation.grossSellingPrice.toLocaleString()} − โบนัสเทิร์น {Number(data.tradeInCredit.bonusAmount).toLocaleString()} = {calculation.sellingPrice.toLocaleString()} บาท</p>
        <p>มูลค่าเครื่อง {Number(data.tradeInCredit.baseAmount).toLocaleString()} + เงินดาวน์สด/โอน {data.downPayment.toLocaleString()} = ชำระล่วงหน้ารวม {calculation.totalDownPayment.toLocaleString()} บาท</p>
      </div>}

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
          onOpenCredit={data.openCustomerCredit}
          onOpenCustomerModal={() => { data.resetCustForm(); data.setShowCustomerModal(true); }}
          overrideActiveContractCheck={data.overrideActiveContractCheck}
          setOverrideActiveContractCheck={data.setOverrideActiveContractCheck}
        />
      )}

      {data.step === 2 && (
        <>
          <PlanDetailsStep
            tradeInBaseAmount={Number(data.tradeInCredit?.baseAmount ?? 0)}
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

          {data.selectedCustomer && <div className="my-4 max-w-xl space-y-2 rounded-xl border border-border p-4 text-sm">
            {data.creditApproval && <>
              <p className="font-semibold">ยอดที่ผู้จัดการอนุมัติ: ไม่เกิน {Number(data.creditApproval.approvedMonthlyPayment).toLocaleString('th-TH')} บาท/เดือน</p>
              <p>ชำระ{data.creditApproval.salaryPayDay === 31 ? 'ทุกสิ้นเดือน' : `วันที่ ${data.creditApproval.salaryPayDay} ของเดือน`}</p>
              {creditSchedule[0] && <p>งวดแรก: {creditSchedule[0].dueDate.toLocaleDateString('th-TH')} · {creditSchedule[0].amount.toLocaleString('th-TH')} บาท</p>}
              <details><summary className="cursor-pointer text-primary">ดูตารางงวดก่อนสร้างสัญญา</summary>
                <table className="mt-2 w-full text-left"><thead><tr><th>งวด</th><th>ครบกำหนด</th><th className="text-right">บาท</th></tr></thead>
                  <tbody>{creditSchedule.map(row => <tr key={row.installmentNo}><td>{row.installmentNo}</td><td>{row.dueDate.toLocaleDateString('th-TH')}</td><td className="text-right">{row.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td></tr>)}</tbody>
                </table>
              </details>
            </>}
            {creditIssue && <p role="alert" className="text-destructive">{creditIssue}</p>}
            <button type="button" className="text-primary underline" onClick={data.openCustomerCredit}>เปิดประวัติและพิจารณายอดผ่อน</button>
          </div>}

          {data.selectedProduct && data.selectedCustomer && (
            <ContractSummaryPanel
              tradeInBaseAmount={Number(data.tradeInCredit?.baseAmount ?? 0)}
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
            disabled={data.createMutation.isPending || !!creditIssue || !data.tradeInCreditReady || calculation.totalDownPayment >= calculation.sellingPrice}
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
