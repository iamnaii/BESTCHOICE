import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreditApprovalPayload } from '@/components/credit-check/CreditAffordabilityForm';
import CreditCheckCard from '@/components/credit-check/CreditCheckCard';
import CreditCheckOverrideDialog, { compileReason } from '@/components/credit-check/CreditCheckOverrideDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { openCreditDocument } from '@/lib/credit-document';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import type { CreditCheckItem, CustomerDetail } from '../types';

interface CreditTabProps {
  customer: CustomerDetail;
  creditChecks: CreditCheckItem[];
  canStartCredit: boolean;
  canReviewCredit: boolean;
  onOpenCreate: () => void;
}

export default function CreditTab({ customer, creditChecks, canStartCredit, canReviewCredit, onOpenCreate }: CreditTabProps) {
  const queryClient = useQueryClient();
  const id = customer.id;

  const [overrideId, setOverrideId] = useState<string | null>(null);
  const [overrideAiDecision, setOverrideAiDecision] = useState<string>('');
  const [overrideAiSummary, setOverrideAiSummary] = useState<string | null>(null);
  const [overrideStatus, setOverrideStatus] = useState('');
  const [overrideReasonCategory, setOverrideReasonCategory] = useState('');
  const [overrideNotes, setOverrideNotes] = useState('');

  const analyzeCreditMutation = useMutation({
    mutationFn: async (creditCheckId: string) => {
      const { data } = await api.post(`/customers/${id}/credit-check/${creditCheckId}/analyze`);
      return data;
    },
    onSuccess: () => {
      toast.success('วิเคราะห์เครดิตเสร็จสิ้น');
      queryClient.invalidateQueries({ queryKey: ['customer-credit-checks', id] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const overrideCreditMutation = useMutation({
    mutationFn: async (affordability?: CreditApprovalPayload | null) => {
      if (!overrideId) return;
      // Dialog blocks same-status selection (backend rejects no-ops), so by
      // the time we reach here overrideStatus !== current, and a reason
      // category + detail are required.
      const { data } = await api.post(`/customers/${id}/credit-check/${overrideId}/override`, {
        status: overrideStatus,
        overrideReason: compileReason(overrideReasonCategory, overrideNotes),
        ...(affordability ? { affordability } : {}),
      });
      return data;
    },
    onSuccess: () => {
      toast.success('อัปเดตสถานะเครดิตเช็คแล้ว');
      queryClient.invalidateQueries({ queryKey: ['customer-credit-checks', id] });
      queryClient.invalidateQueries({ queryKey: ['customer-latest-credit', id] });
      queryClient.invalidateQueries({ queryKey: ['credit-checks'] });
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setOverrideId(null);
      setOverrideStatus('');
      setOverrideReasonCategory('');
      setOverrideNotes('');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  return (
    <>
      {/* Credit Check */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>ตรวจสอบเครดิต</CardTitle>
          {canStartCredit && (
            <Button variant="primary" size="sm" onClick={onOpenCreate}>
              + ตรวจเครดิตใหม่
            </Button>
          )}
        </CardHeader>
        <CardContent>

        {/* Credit check history */}
        {creditChecks.length > 0 ? (
          <div className="space-y-3">
            {creditChecks.map((cc) => (
              <CreditCheckCard
                key={cc.id}
                cc={cc}
                canOverride={canReviewCredit}
                canAnalyze={canStartCredit}
                isAnalyzing={analyzeCreditMutation.isPending}
                onAnalyze={(ccId) => analyzeCreditMutation.mutate(ccId)}
                onOverride={(ccId) => {
                  setOverrideId(ccId);
                  setOverrideAiDecision(cc.status);
                  setOverrideAiSummary(cc.aiSummary);
                  setOverrideStatus('');
                  setOverrideReasonCategory('');
                  setOverrideNotes('');
                }}
                onViewStatement={(url) => void openCreditDocument(url)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-sm text-muted-foreground">ยังไม่มีประวัติการตรวจเครดิต</div>
        )}
        </CardContent>
      </Card>

      <CreditCheckOverrideDialog
        key={overrideId ?? 'closed'}
        creditCheckId={overrideId ?? undefined}
        checkType={creditChecks.find(check => check.id === overrideId)?.checkType}
        open={!!overrideId}
        onClose={() => {
          setOverrideId(null);
          setOverrideStatus('');
          setOverrideReasonCategory('');
          setOverrideNotes('');
        }}
        aiDecision={overrideAiDecision}
        aiSummary={overrideAiSummary}
        status={overrideStatus}
        onStatusChange={setOverrideStatus}
        reasonCategory={overrideReasonCategory}
        onReasonCategoryChange={(v) => {
          setOverrideReasonCategory(v);
          setOverrideNotes(''); // clear stale detail when switching category
        }}
        notes={overrideNotes}
        onNotesChange={setOverrideNotes}
        isPending={overrideCreditMutation.isPending}
        onConfirm={(affordability) => overrideCreditMutation.mutate(affordability)}
      />
    </>
  );
}
