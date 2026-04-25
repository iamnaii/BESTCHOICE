import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { postPreCheck, type PreCheckResponse } from '@/lib/api/customer-precheck';
import type { IntakeStep, QuickIntakeForm, WizardState } from '../types';

const emptyQuick: QuickIntakeForm = {
  nationalId: '',
  phone: '',
  firstName: '',
  lastName: '',
  prefix: '',
  bankName: '',
  statementFiles: [],
};

async function filesToBase64(files: File[]): Promise<string[]> {
  const results: string[] = [];
  for (const file of files) {
    const result = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
      reader.readAsDataURL(file);
    });
    results.push(result);
  }
  return results;
}

export function useCustomerIntake() {
  const [state, setState] = useState<WizardState>({
    step: 'quick',
    quickForm: emptyQuick,
    preCheckResult: null,
    fullForm: null,
  });

  const goTo = useCallback((step: IntakeStep) => {
    setState((prev) => ({ ...prev, step }));
  }, []);

  const updateQuick = useCallback((patch: Partial<QuickIntakeForm>) => {
    setState((prev) => ({ ...prev, quickForm: { ...prev.quickForm, ...patch } }));
  }, []);

  const preCheckMutation = useMutation<PreCheckResponse, unknown, void>({
    mutationFn: async () => {
      const { quickForm } = state;
      const statementBase64 =
        quickForm.statementFiles.length > 0
          ? await filesToBase64(quickForm.statementFiles)
          : undefined;
      return postPreCheck({
        nationalId: quickForm.nationalId,
        phone: quickForm.phone,
        bankName: quickForm.bankName || undefined,
        statementFiles: statementBase64,
      });
    },
    onSuccess: (result) => {
      // Result is shown by PreCheckResultStep — no toast (it duplicates the banner).
      setState((prev) => ({ ...prev, preCheckResult: result }));
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });

  // If pre-check just minted a placeholder customer and the user backs out
  // before filling the full form, ask the API to soft-delete it so the DB
  // doesn't accumulate "ลูกค้าใหม่ (Pre-check)" rows. Fire-and-forget — the
  // endpoint is idempotent and refuses to delete anything that has grown
  // into a real customer (contracts, name changed, etc).
  const abandonPlaceholder = (result: PreCheckResponse | null) => {
    if (!result?.isNewCustomer || !result.customerId) return;
    void api.post(`/customers/pre-check/${result.customerId}/abandon`).catch(() => {});
  };

  const resetPreCheck = useCallback(() => {
    setState((prev) => {
      abandonPlaceholder(prev.preCheckResult);
      return { ...prev, preCheckResult: null, step: 'quick' };
    });
  }, []);

  const cancelIntake = useCallback(() => {
    setState((prev) => {
      abandonPlaceholder(prev.preCheckResult);
      return prev;
    });
  }, []);

  const proceedToFull = useCallback(() => {
    if (!state.preCheckResult) return;
    if (state.preCheckResult.decision === 'FAIL') return; // no progress
    // Pre-fill full form from quick form
    setState((prev) => ({
      ...prev,
      step: 'full',
      fullForm: {
        prefix: prev.quickForm.prefix,
        firstName: prev.quickForm.firstName,
        lastName: prev.quickForm.lastName,
        nationalId: prev.quickForm.nationalId,
        phone: prev.quickForm.phone,
        references: [
          { firstName: '', lastName: '', phone: '', relationship: '' },
          { firstName: '', lastName: '', phone: '', relationship: '' },
          { firstName: '', lastName: '', phone: '', relationship: '' },
          { firstName: '', lastName: '', phone: '', relationship: '' },
        ],
      },
    }));
  }, [state.preCheckResult]);

  const reset = useCallback(() => {
    setState({
      step: 'quick',
      quickForm: emptyQuick,
      preCheckResult: null,
      fullForm: null,
    });
  }, []);

  return {
    state,
    goTo,
    updateQuick,
    runPreCheck: () => preCheckMutation.mutate(),
    isPreChecking: preCheckMutation.isPending,
    resetPreCheck,
    cancelIntake,
    proceedToFull,
    reset,
  };
}
