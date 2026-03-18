import { useState } from 'react';
import ProgressStepper from './ProgressStepper';
import StepKycVerification from './StepKycVerification';
import StepPdpaConsent from './StepPdpaConsent';
import StepContractReview from './StepContractReview';
import StepSignature from './StepSignature';
import StepComplete from './StepComplete';

type SignerType = 'CUSTOMER' | 'COMPANY' | 'WITNESS_1' | 'WITNESS_2' | 'GUARDIAN';

interface ContractData {
  id: string;
  contractNumber: string;
  status: string;
  workflowStatus: string;
  pdpaConsentId: string | null;
  customer?: {
    id: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    birthDate?: string;
  };
  product?: {
    name?: string;
  };
  totalMonths?: number;
  monthlyPayment?: number;
}

interface SigningWizardProps {
  contract: ContractData;
  previewHtml: string | null;
  lessorSignatureImage: string;
  lessorSignerName: string;
}

const STEPS = [
  { label: 'ยืนยันตัวตน', key: 'kyc' },
  { label: 'PDPA', key: 'pdpa' },
  { label: 'อ่านสัญญา', key: 'review' },
  { label: 'เซ็นสัญญา', key: 'sign' },
  { label: 'สำเร็จ', key: 'complete' },
];

export default function SigningWizard({ contract, previewHtml, lessorSignatureImage, lessorSignerName }: SigningWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);

  // Determine required signers
  const requiresGuardian = (() => {
    if (!contract.customer?.birthDate) return false;
    const birth = new Date(contract.customer.birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age >= 17 && age < 20;
  })();

  const REQUIRED_SIGNERS: SignerType[] = ['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2'];
  const requiredSigners = requiresGuardian
    ? [...REQUIRED_SIGNERS, 'GUARDIAN' as SignerType]
    : REQUIRED_SIGNERS;

  const customerName = contract.customer?.name || [contract.customer?.firstName, contract.customer?.lastName].filter(Boolean).join(' ') || '';
  const customerPhone = contract.customer?.phone || '';
  const hasPdpaConsent = !!contract.pdpaConsentId;

  const goNext = () => setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1));
  const goBack = () => setCurrentStep(prev => Math.max(prev - 1, 0));

  return (
    <div className="min-h-[80vh] flex flex-col" style={{ overscrollBehavior: 'contain' }}>
      {/* Progress stepper */}
      <ProgressStepper steps={STEPS} currentStep={currentStep} />

      {/* Step content */}
      <div className="flex-1">
        {currentStep === 0 && (
          <StepKycVerification
            contractId={contract.id}
            customerName={customerName}
            customerPhone={customerPhone}
            onComplete={goNext}
          />
        )}
        {currentStep === 1 && (
          <StepPdpaConsent
            contractId={contract.id}
            alreadyConsented={hasPdpaConsent}
            onComplete={goNext}
          />
        )}
        {currentStep === 2 && (
          <StepContractReview
            contractId={contract.id}
            previewHtml={previewHtml}
            onComplete={goNext}
            onBack={goBack}
          />
        )}
        {currentStep === 3 && (
          <StepSignature
            contractId={contract.id}
            requiredSigners={requiredSigners}
            customerName={customerName}
            lessorSignatureImage={lessorSignatureImage}
            lessorSignerName={lessorSignerName}
            onAllSigned={goNext}
            onBack={goBack}
          />
        )}
        {currentStep === 4 && (
          <StepComplete
            contractId={contract.id}
            contractNumber={contract.contractNumber}
            productName={contract.product?.name}
            totalMonths={contract.totalMonths}
            monthlyPayment={contract.monthlyPayment}
          />
        )}
      </div>
    </div>
  );
}
