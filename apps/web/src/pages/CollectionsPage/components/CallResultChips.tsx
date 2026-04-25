/**
 * Call result quick-tag chips for ContactLogDialog (Task 12).
 *
 * Two chip rows:
 *   1. ผลการโทร  — รับสาย / ไม่รับสาย / สายไม่ว่าง / ปิดเครื่อง / เบอร์ไม่ติดต่อ
 *   2. ผลการเจรจา — ขอผ่อน / จะจ่าย / ปฏิเสธ / ขอคืนเครื่อง / กำลังเจรจา
 *
 * The negotiation row is disabled when the call result is a "no contact"
 * type (NO_ANSWER / BUSY / DEVICE_OFF / UNREACHABLE) — you cannot negotiate
 * with someone you didn't reach. ANSWERED is the only call result that
 * unlocks negotiation chips.
 *
 * Selections are auto-saved to CallLog when the parent ContactLogDialog
 * submits (the dialog passes them as `callResult` + `negotiationResult`
 * fields in the LogContact payload).
 */

export type CallResultTag =
  | 'ANSWERED'
  | 'NO_ANSWER'
  | 'BUSY'
  | 'DEVICE_OFF'
  | 'UNREACHABLE';

export type NegotiationResultTag =
  | 'REQUESTED_EXTENSION'
  | 'WILL_PAY'
  | 'REFUSED'
  | 'REQUESTED_RETURN'
  | 'NEGOTIATING'
  | 'NOT_APPLICABLE';

const CALL_RESULTS: { value: CallResultTag; label: string }[] = [
  { value: 'ANSWERED', label: 'รับสาย' },
  { value: 'NO_ANSWER', label: 'ไม่รับสาย' },
  { value: 'BUSY', label: 'สายไม่ว่าง' },
  { value: 'DEVICE_OFF', label: 'ปิดเครื่อง' },
  { value: 'UNREACHABLE', label: 'เบอร์ไม่ติดต่อ' },
];

const NEGOTIATION_RESULTS: { value: NegotiationResultTag; label: string }[] = [
  { value: 'REQUESTED_EXTENSION', label: 'ขอผ่อน' },
  { value: 'WILL_PAY', label: 'จะจ่าย' },
  { value: 'REFUSED', label: 'ปฏิเสธ' },
  { value: 'REQUESTED_RETURN', label: 'ขอคืนเครื่อง' },
  { value: 'NEGOTIATING', label: 'กำลังเจรจา' },
];

const NO_CONTACT_TYPES: CallResultTag[] = [
  'NO_ANSWER',
  'BUSY',
  'DEVICE_OFF',
  'UNREACHABLE',
];

interface Props {
  callResult: CallResultTag | null;
  negotiationResult: NegotiationResultTag | null;
  onCallResultChange: (v: CallResultTag | null) => void;
  onNegotiationResultChange: (v: NegotiationResultTag | null) => void;
}

export default function CallResultChips({
  callResult,
  negotiationResult,
  onCallResultChange,
  onNegotiationResultChange,
}: Props) {
  const negotiationDisabled = !callResult || NO_CONTACT_TYPES.includes(callResult);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1.5 leading-snug">
          ผลการโทร
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CALL_RESULTS.map((opt) => {
            const active = callResult === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() =>
                  onCallResultChange(active ? null : opt.value)
                }
                aria-pressed={active}
                className={`rounded-full border px-3 py-1 text-xs leading-snug transition-colors ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-card text-foreground hover:bg-accent'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1.5 leading-snug">
          ผลการเจรจา
          {negotiationDisabled && (
            <span className="ml-1 text-2xs text-muted-foreground/80">
              (ติดต่อลูกค้าได้ก่อนถึงจะเลือกได้)
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {NEGOTIATION_RESULTS.map((opt) => {
            const active = negotiationResult === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={negotiationDisabled}
                onClick={() =>
                  onNegotiationResultChange(active ? null : opt.value)
                }
                aria-pressed={active}
                className={`rounded-full border px-3 py-1 text-xs leading-snug transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  active
                    ? 'border-success bg-success text-success-foreground'
                    : 'border-input bg-card text-foreground hover:bg-accent'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
