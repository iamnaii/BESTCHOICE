import { useNavigate } from 'react-router';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';
import { useCustomerIntake } from './hooks/useCustomerIntake';
import IntakeStepIndicator from './components/IntakeStepIndicator';
import QuickIntakeStep from './components/QuickIntakeStep';
import PreCheckUploadStep from './components/PreCheckUploadStep';
import PreCheckResultStep from './components/PreCheckResultStep';
import FullIntakeStep from './components/FullIntakeStep';

export default function CustomerIntakePage() {
  useDocumentTitle('เช็คเครดิตลูกค้าใหม่');
  const navigate = useNavigate();
  const intake = useCustomerIntake();

  return (
    <div>
      <PageHeader
        title="เช็คเครดิตลูกค้า + รับข้อมูล"
        subtitle="scan บัตร → อัพ statement → เช็คเครดิต → กรอกข้อมูลเต็ม"
        action={
          <button
            onClick={() => {
              intake.cancelIntake();
              navigate('/customers');
            }}
            className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg"
          >
            ยกเลิก
          </button>
        }
      />

      <IntakeStepIndicator current={intake.state.step} />

      {intake.state.step === 'quick' && (
        <QuickIntakeStep
          form={intake.state.quickForm}
          onChange={intake.updateQuick}
          onNext={() => intake.goTo('precheck')}
        />
      )}

      {intake.state.step === 'precheck' && !intake.state.preCheckResult && (
        <PreCheckUploadStep
          form={intake.state.quickForm}
          onChange={intake.updateQuick}
          onSubmit={intake.runPreCheck}
          onBack={() => intake.goTo('quick')}
          isSubmitting={intake.isPreChecking}
        />
      )}

      {intake.state.step === 'precheck' && intake.state.preCheckResult && (
        <PreCheckResultStep
          result={intake.state.preCheckResult}
          onProceed={intake.proceedToFull}
          onCancel={intake.resetPreCheck}
        />
      )}

      {intake.state.step === 'full' && intake.state.fullForm && intake.state.preCheckResult && (
        <FullIntakeStep
          customerId={intake.state.preCheckResult.customerId}
          initial={intake.state.fullForm}
          onDone={() => intake.goTo('done')}
        />
      )}

      {intake.state.step === 'done' && intake.state.preCheckResult && (
        <div className="max-w-2xl mx-auto text-center py-12 space-y-4">
          <CheckCircle2 className="size-16 text-success mx-auto" />
          <h2 className="text-xl font-semibold text-foreground">บันทึกข้อมูลเรียบร้อย</h2>
          <p className="text-sm text-muted-foreground">
            ลูกค้าพร้อมทำสัญญาแล้ว
          </p>
          <div className="flex justify-center gap-2 pt-2">
            <Button
              variant="primary"
              onClick={() =>
                navigate(`/contracts/create?customerId=${intake.state.preCheckResult!.customerId}`)
              }
            >
              สร้างสัญญาเลย
            </Button>
            <Button variant="outline" onClick={intake.reset}>
              รับลูกค้าคนต่อไป
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
