import type { SignatureRequirements } from '@installment/shared';
import { useState } from 'react';
import ProgressStepper from './ProgressStepper';
import StepKycVerification from './StepKycVerification';
import StepPdpaConsent from './StepPdpaConsent';
import StepContractReview, { type ContractPreviewState } from './StepContractReview';
import StepSignature from './StepSignature';
import StepComplete from './StepComplete';

type SignerType = 'CUSTOMER' | 'COMPANY' | 'WITNESS_1' | 'WITNESS_2' | 'GUARDIAN';

interface CustomerReference {
  prefix?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  relationship?: string;
}

interface ContractData {
  signatureRequirements?: SignatureRequirements;
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
    references?: CustomerReference[];
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
  previewState: ContractPreviewState;
  onRetryPreview: () => void;
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

export default function SigningWizard(props: SigningWizardProps) {
  return <ContractSigningFlow key={props.contract.id} {...props} />;
}

function ContractSigningFlow({ contract, previewHtml, previewState, onRetryPreview, lessorSignatureImage, lessorSignerName }: SigningWizardProps) {
  const requiredSigners = contract.signatureRequirements?.checklist.map(row => row.type) ?? [];
  const requirementsReady = requiredSigners.length >= 4;

  const requirementsKey = requiredSigners.join('|');
  const [flow, setFlow] = useState<{ step: number; reviewedHtml: string | null; revision: number; requirementsKey: string }>({
    step: 0, reviewedHtml: null, revision: 0, requirementsKey,
  });
  const { step: currentStep, reviewedHtml } = flow;
  const previewReady = previewState === 'ready' && Boolean(previewHtml?.trim());
  const reviewValid = previewReady && reviewedHtml !== null && reviewedHtml === previewHtml;

  // Revoke consent before rendering the signature controls. A failed refresh
  // must also require new consent if the same HTML subsequently returns.
  if (flow.requirementsKey !== requirementsKey || (reviewedHtml !== null && !reviewValid)) {
    setFlow({ step: currentStep >= 3 ? 2 : currentStep, reviewedHtml: null, revision: flow.revision + 1, requirementsKey });
  }

  const customerName = contract.customer?.name || [contract.customer?.firstName, contract.customer?.lastName].filter(Boolean).join(' ') || '';
  const customerPhone = contract.customer?.phone || '';
  const hasPdpaConsent = !!contract.pdpaConsentId;

  // Extract witness default names from customer references
  const refs = contract.customer?.references || [];
  const witness1Name = refs[0] ? `${refs[0].prefix || ''}${refs[0].firstName || ''} ${refs[0].lastName || ''}`.trim() : '';
  const witness2Name = refs[1] ? `${refs[1].prefix || ''}${refs[1].firstName || ''} ${refs[1].lastName || ''}`.trim() : '';

  const goNext = () => setFlow(prev => ({ ...prev, step: Math.min(prev.step + 1, STEPS.length - 1) }));
  const goBack = () => setFlow(prev => ({ ...prev, step: Math.max(prev.step - 1, 0), revision: prev.revision + 1 }));

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
            previewState={previewState}
            onRetryPreview={onRetryPreview}
            onComplete={() => {
              if (previewReady) {
                setFlow(prev => ({ step: 3, reviewedHtml: previewHtml, revision: prev.revision + 1, requirementsKey }));
              }
            }}
            onBack={goBack}
          />
        )}
        {currentStep === 3 && reviewValid && !requirementsReady && <p role="alert">โหลดรายการผู้ลงนามไม่ครบ กรุณาโหลดรายละเอียดสัญญาอีกครั้ง</p>}
        {currentStep === 3 && reviewValid && requirementsReady && (
          <StepSignature
            contractId={contract.id}
            requiredSigners={requiredSigners}
            customerName={customerName}
            lessorSignatureImage={lessorSignatureImage}
            lessorSignerName={lessorSignerName}
            witness1Name={witness1Name}
            witness2Name={witness2Name}
            onAllSigned={() => setFlow(prev => requirementsReady && prev.requirementsKey === requirementsKey && prev.step === 3 && prev.revision === flow.revision
              ? { ...prev, step: 4 } : prev)}
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
