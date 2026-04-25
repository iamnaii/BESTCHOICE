import { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';
import { useContactLog } from '../hooks/useContactLog';
import CallResultChips, {
  type CallResultTag,
  type NegotiationResultTag,
} from './CallResultChips';
import VoiceMemoRecorder from './VoiceMemoRecorder';
import type { ContractRow, CallResult } from '../types';

interface Props {
  open: boolean;
  contract: ContractRow | null;
  onClose: () => void;
}

const CALL_RESULT_LABELS: Record<CallResult, string> = {
  NO_ANSWER: 'ไม่รับสาย',
  ANSWERED: 'รับสาย',
  PROMISED: 'นัดชำระ',
  REFUSED: 'ปฏิเสธ',
  WRONG_NUMBER: 'เบอร์ผิด',
  OTHER: 'อื่น ๆ',
};

const LINE_NOTIFY_RESULTS: CallResult[] = ['NO_ANSWER', 'PROMISED', 'REFUSED'];

const defaultForm = {
  result: 'NO_ANSWER' as CallResult,
  notes: '',
  collectionNotes: '',
  settlementDate: '',
  settlementNotes: '',
  // P1 Task 12 — quick-tag chip selections
  callResult: null as CallResultTag | null,
  negotiationResult: null as NegotiationResultTag | null,
  // P2 Task 4 — voice memo S3 URL (set after upload completes)
  voiceMemoUrl: null as string | null,
};

// Derive tomorrow's date for min= on settlement date input
function getTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

export default function ContactLogDialog({ open, contract, onClose }: Props) {
  const [form, setForm] = useState(defaultForm);
  const mutation = useContactLog();

  // Reset form whenever dialog opens for a new contract
  useEffect(() => {
    if (open) {
      setForm(defaultForm);
    }
  }, [open, contract?.id]);

  function handleClose() {
    if (mutation.isPending) return;
    onClose();
  }

  function handleSubmit() {
    if (!contract) return;
    const payload = {
      contractId: contract.id,
      result: form.result,
      notes: form.notes || undefined,
      collectionNotes: form.collectionNotes || undefined,
      settlementDate: form.result === 'PROMISED' ? form.settlementDate || undefined : undefined,
      settlementNotes:
        form.result === 'PROMISED' ? form.settlementNotes || undefined : undefined,
      // Auto-save the quick-tag enum selections (Task 12). null → omit
      // so the back-end stores null and the existing free-string `result`
      // remains the legacy source of truth.
      callResult: form.callResult ?? undefined,
      negotiationResult: form.negotiationResult ?? undefined,
      // Voice memo URL (Task 4) — uploaded to S3 ahead of submit; null/undefined
      // when no recording was made.
      voiceMemoUrl: form.voiceMemoUrl ?? undefined,
    };
    mutation.mutate(payload, {
      onSuccess: () => {
        handleClose();
      },
    });
  }

  const showLineNotify = LINE_NOTIFY_RESULTS.includes(form.result as CallResult);
  const showSettlement = form.result === 'PROMISED';

  return (
    <Modal
      isOpen={open}
      onClose={handleClose}
      title={`บันทึกการติดต่อ — ${contract?.customer.name ?? ''}`}
      size="md"
    >
      <div className="space-y-4">
        {/* Contract summary */}
        {contract && (
          <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground leading-snug">
            <span className="font-mono text-primary font-medium">{contract.contractNumber}</span>
            {' · '}ค้าง{' '}
            <span className="tabular-nums font-medium text-destructive">
              {contract.outstanding.toLocaleString()}
            </span>{' '}
            ฿ · {contract.daysOverdue} วัน
          </div>
        )}

        {/* Result select */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block leading-snug">
            ผลการติดต่อ <span className="text-destructive">*</span>
          </label>
          <select
            value={form.result}
            onChange={(e) => setForm({ ...form, result: e.target.value as CallResult })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug"
          >
            {(Object.keys(CALL_RESULT_LABELS) as CallResult[]).map((k) => (
              <option key={k} value={k}>
                {CALL_RESULT_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        {/* Settlement fields (shown only for PROMISED) */}
        {showSettlement && (
          <div className="space-y-3 rounded-lg border border-border/50 bg-card p-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block leading-snug">
                วันที่นัดชำระ <span className="text-destructive">*</span>
              </label>
              <input
                type="date"
                min={getTomorrow()}
                value={form.settlementDate}
                onChange={(e) => setForm({ ...form, settlementDate: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block leading-snug">
                รายละเอียดการนัด
              </label>
              <textarea
                value={form.settlementNotes}
                onChange={(e) => setForm({ ...form, settlementNotes: e.target.value })}
                placeholder="ระบุจำนวนเงินที่นัดจ่าย, ช่องทางการชำระ..."
                rows={2}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm resize-none leading-snug"
              />
            </div>
          </div>
        )}

        {/* Quick-tag chips (Task 12) — captured into CallLog.callResult +
            CallLog.negotiationResult for analytics. Independent from the
            legacy free-string `result` select above. */}
        <CallResultChips
          callResult={form.callResult}
          negotiationResult={form.negotiationResult}
          onCallResultChange={(v) => setForm({ ...form, callResult: v })}
          onNegotiationResultChange={(v) =>
            setForm({ ...form, negotiationResult: v })
          }
        />

        {/* Notes */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block leading-snug">
            หมายเหตุการโทร
          </label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="รายละเอียดการสนทนา..."
            rows={2}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm resize-none leading-snug"
          />
        </div>

        {/* Voice memo recorder (Task 4) — optional evidence; URL persisted on
            CallLog.voiceMemoUrl alongside the notes above. */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block leading-snug">
            เสียงบันทึก (ทางเลือก)
          </label>
          <VoiceMemoRecorder
            disabled={mutation.isPending}
            uploadedUrl={form.voiceMemoUrl}
            onUploaded={(url) => setForm((prev) => ({ ...prev, voiceMemoUrl: url }))}
            onCleared={() => setForm((prev) => ({ ...prev, voiceMemoUrl: null }))}
          />
        </div>

        {/* Collection notes */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block leading-snug">
            บันทึกผู้ติดตาม (อัปเดตบนสัญญา)
          </label>
          <textarea
            value={form.collectionNotes}
            onChange={(e) => setForm({ ...form, collectionNotes: e.target.value })}
            placeholder="บันทึกสถานะการติดตาม..."
            rows={2}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm resize-none leading-snug"
          />
        </div>

        {/* LINE notify banner */}
        {showLineNotify && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary leading-snug">
            แจ้งเตือน: ระบบจะส่ง LINE ทันทีหลังบันทึก
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={handleClose}
            disabled={mutation.isPending}
            className="px-4 py-2 text-sm border border-input rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSubmit}
            disabled={
              mutation.isPending ||
              (showSettlement && !form.settlementDate)
            }
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
