import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import DefectExchangePage from '@/pages/DefectExchangePage';

// ---------------------------------------------------------------------------
// Wizard state type (fields from Steps 1-3 relevant to exchange branch)
// ---------------------------------------------------------------------------

export interface ExchangeWizardState {
  customerId?: string;
  contractId?: string;
  /** Skip the 7-day window eligibility check (approved by OWNER/BM when
   *  the repair ticket has confirmed the device cannot be repaired). */
  bypassWindow?: boolean;
  /** Repair ticket ID that triggered this exchange path (required when
   *  bypassWindow = true so the backend can link the exchange audit trail). */
  originRepairTicketId?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Step 4 — exchange branch.
 *
 * Mounts the existing `DefectExchangePage` as a sub-component with pre-filled
 * wizard context. `DefectExchangePage` was refactored in commit 6aa30266 to
 * accept optional props (`presetContractId` / `bypassWindow` /
 * `originRepairTicketId`). When mounted via the legacy `/defect-exchange`
 * route (no props), its behaviour is unchanged.
 *
 * The `bypassWindow` path is only reachable when the originating repair
 * ticket has been flagged "ซ่อมไม่ได้" and an OWNER/BM has approved the
 * exchange. The amber callout below communicates this to the operator.
 */
export function ExchangeProductPickerStep({
  wizardState,
  onBack,
}: {
  wizardState: ExchangeWizardState;
  onBack: () => void;
}) {
  return (
    <Card className="p-6 space-y-4">
      <h3 className="font-medium">4. เลือกเครื่องใหม่ + เหตุผล</h3>

      {wizardState.bypassWindow && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 text-amber-700 shrink-0" />
          <div>
            <p className="font-medium text-amber-900 leading-snug">
              Window 7 วันได้รับการอนุมัติให้ผ่าน
            </p>
            <p className="text-amber-800 leading-snug">
              เครื่องเดิมซ่อมไม่ได้ — ออกเครื่องใหม่ทดแทน (OWNER/BM only)
            </p>
          </div>
        </div>
      )}

      {/* DefectExchangePage handles its own data fetching and submission.
          When presetContractId is set the contract picker is locked to that
          value; bypassWindow skips the 7-day eligibility guard on the API. */}
      <DefectExchangePage
        presetContractId={wizardState.contractId}
        bypassWindow={wizardState.bypassWindow}
        originRepairTicketId={wizardState.originRepairTicketId}
      />

      <div className="flex justify-start pt-2">
        <Button variant="outline" onClick={onBack}>
          ← ย้อน
        </Button>
      </div>
    </Card>
  );
}
