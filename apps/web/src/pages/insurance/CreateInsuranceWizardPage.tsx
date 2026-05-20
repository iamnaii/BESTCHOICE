import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';
import api, { getErrorMessage } from '@/lib/api';
import { CustomerPickerStep, type CustomerStepValue } from './WizardSteps/CustomerPickerStep';
import { DevicePickerStep, type DeviceStepValue } from './WizardSteps/DevicePickerStep';
import { WarrantyPreviewStep, type WizardFlow } from './WizardSteps/WarrantyPreviewStep';
import { DefectDescriptionStep } from './WizardSteps/DefectDescriptionStep';
import { ExchangeProductPickerStep } from './WizardSteps/ExchangeProductPickerStep';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

type Step = 1 | 2 | 3 | 4;

export default function CreateInsuranceWizardPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // ── URL search-param pre-fill ─────────────────────────────────────────────
  const presetCustomerId = params.get('customerId') ?? undefined;
  const presetContractId = params.get('contractId') ?? undefined;
  const presetProductId = params.get('productId') ?? undefined;
  const intent = params.get('intent');
  const originRepairTicketId = params.get('originRepairTicketId') ?? undefined;
  const bypassWindowParam = params.get('bypassWindow') === 'true';

  // Bypass is only effective for OWNER / BRANCH_MANAGER — defence-in-depth (server also enforces)
  const bypassWindow =
    bypassWindowParam &&
    (user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER');

  // When bypassing: no warranty check is needed — jump straight from step 2 to step 4
  const skipWarrantyPreview = bypassWindow && intent === 'exchange';

  // ── Initial step ──────────────────────────────────────────────────────────
  // If customerId is pre-filled skip step 1.
  // If also bypass+exchange preset, jump directly to step 4 (device locked, flow set).
  function calcInitialStep(): Step {
    if (!presetCustomerId) return 1;
    if (skipWarrantyPreview && presetContractId) return 4;
    return 2;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(calcInitialStep);
  const [customer, setCustomer] = useState<CustomerStepValue>({
    customerId: presetCustomerId,
  });
  const [device, setDevice] = useState<DeviceStepValue>({
    contractId: presetContractId,
    productId: presetProductId,
  });
  const [chosenFlow, setChosenFlow] = useState<WizardFlow | null>(
    skipWarrantyPreview ? 'exchange' : null,
  );

  // Walk-in customer creation status (prevents double-fire)
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  // ── Walk-in customer creation ─────────────────────────────────────────────
  // When the wizard reaches Step 4 without a customerId (walk-in mode), we
  // create the customer record first so DefectDescriptionStep / ExchangeProductPickerStep
  // can pass a valid customerId to POST /repair-tickets.
  //
  // Required fields per CreateCustomerDto: name + phone (nationalId is @IsString but
  // walk-in customer won't have it yet — the DTO marks it required, so we pass a
  // placeholder value "0000000000000" per business rule for walk-in quick-create;
  // a proper KYC update can happen later from the customer detail page).
  useEffect(() => {
    if (
      step === 4 &&
      !customer.customerId &&
      customer.customerName &&
      customer.customerPhone &&
      !creatingCustomer
    ) {
      setCreatingCustomer(true);
      api
        .post('/customers', {
          name: customer.customerName,
          phone: customer.customerPhone,
          // Walk-in placeholder — staff can update national ID later
          nationalId: '0000000000000',
        })
        .then(({ data }) => {
          setCustomer((prev) => ({ ...prev, customerId: data.id }));
        })
        .catch((err) => {
          toast.error(getErrorMessage(err) || 'สร้างลูกค้าใหม่ไม่สำเร็จ');
          // Drop back to Step 1 so staff can retry or select an existing customer
          setStep(1);
        })
        .finally(() => {
          setCreatingCustomer(false);
        });
    }
  }, [step, customer.customerId, customer.customerName, customer.customerPhone, creatingCustomer]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const reset = () => {
    setStep(1);
    setCustomer({});
    setDevice({});
    setChosenFlow(null);
  };

  const goNext = (from: Step) => {
    if (from === 2 && skipWarrantyPreview) {
      setStep(4);
    } else if (from === 3 || from === 2) {
      setStep((from + 1) as Step);
    } else {
      setStep((from + 1) as Step);
    }
  };

  const goBack = (from: Step) => {
    if (from === 4 && skipWarrantyPreview) {
      setStep(2);
    } else {
      setStep(Math.max(1, from - 1) as Step);
    }
  };

  // ── Progress indicator ────────────────────────────────────────────────────
  const progressSubtitle = (
    <div className="flex gap-2 text-sm flex-wrap">
      <span className={cn(step >= 1 ? 'font-medium text-foreground' : 'text-muted-foreground')}>
        1. ลูกค้า
      </span>
      <span className="text-muted-foreground">→</span>
      <span className={cn(step >= 2 ? 'font-medium text-foreground' : 'text-muted-foreground')}>
        2. เครื่อง
      </span>
      {!skipWarrantyPreview && (
        <>
          <span className="text-muted-foreground">→</span>
          <span className={cn(step >= 3 ? 'font-medium text-foreground' : 'text-muted-foreground')}>
            3. ตรวจประกัน
          </span>
        </>
      )}
      <span className="text-muted-foreground">→</span>
      <span className={cn(step >= 4 ? 'font-medium text-foreground' : 'text-muted-foreground')}>
        {skipWarrantyPreview ? '3' : '4'}. ยืนยัน
      </span>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 p-4 md:p-6 max-w-3xl">
      <PageHeader
        title="รับเครื่องใหม่"
        subtitle={undefined}
        breadcrumb={progressSubtitle}
        action={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              เริ่มใหม่
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/insurance')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              กลับ
            </Button>
          </div>
        }
      />

      {/* Step 1 — Customer */}
      {step === 1 && (
        <CustomerPickerStep
          value={customer}
          onChange={setCustomer}
          onNext={() => goNext(1)}
          presetCustomerId={presetCustomerId}
        />
      )}

      {/* Step 2 — Device */}
      {step === 2 && (
        <DevicePickerStep
          customerId={customer.customerId}
          value={device}
          onChange={setDevice}
          onNext={() => goNext(2)}
          onBack={() => goBack(2)}
          presetContractId={presetContractId}
          presetProductId={presetProductId}
        />
      )}

      {/* Step 3 — Warranty preview (skipped when bypass+exchange) */}
      {step === 3 && !skipWarrantyPreview && (
        <WarrantyPreviewStep
          customerId={customer.customerId}
          contractId={device.contractId}
          productId={device.productId}
          chosenFlow={chosenFlow}
          onChoose={setChosenFlow}
          onNext={() => goNext(3)}
          onBack={() => goBack(3)}
        />
      )}

      {/* Step 4 — loading while walk-in customer is being created */}
      {step === 4 && creatingCustomer && (
        <div className="p-8 text-center text-muted-foreground text-sm">
          กำลังสร้างข้อมูลลูกค้า...
        </div>
      )}

      {/* Step 4 — Repair branch */}
      {step === 4 && !creatingCustomer && chosenFlow === 'repair' && (
        <DefectDescriptionStep
          wizardState={{
            customerId: customer.customerId,
            customerName: customer.customerName,
            customerPhone: customer.customerPhone,
            contractId: device.contractId,
            productId: device.productId,
            deviceBrand: device.deviceBrand,
            deviceModel: device.deviceModel,
            deviceImei: device.deviceImei,
            deviceSerial: device.deviceSerial,
          }}
          onBack={() => goBack(4)}
        />
      )}

      {/* Step 4 — Exchange branch */}
      {step === 4 && !creatingCustomer && chosenFlow === 'exchange' && (
        <ExchangeProductPickerStep
          wizardState={{
            customerId: customer.customerId,
            contractId: device.contractId,
            bypassWindow: bypassWindow || undefined,
            originRepairTicketId,
          }}
          onBack={() => goBack(4)}
        />
      )}

      {/* Step 4 — flow not yet chosen (should not normally reach here, but defensive) */}
      {step === 4 && !creatingCustomer && !chosenFlow && (
        <div className="p-8 text-center text-muted-foreground text-sm">
          กลับไปเลือกประเภทการดำเนินการ
          <div className="mt-4">
            <Button variant="outline" onClick={() => goBack(4)}>
              ← กลับ
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
