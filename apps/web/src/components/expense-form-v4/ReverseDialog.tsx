import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { useUiFlags } from '@/hooks/useUiFlags';

/**
 * C3.2 — Reverse Dialog modal (mockup 02E).
 *
 * Replaces the generic ConfirmDialog for the void path on expense documents.
 * Captures the C3 backend's `VoidExpenseDocumentDto` fields:
 *   - reasonCode (required) — 6 canonical options
 *   - reasonDetail (required only when reasonCode === 'other'; optional otherwise)
 *   - reverseDate (defaults to today; user-pickable for back-date / forward-date)
 *
 * Server-side V19 (period-open guard) re-validates; this dialog is best-effort.
 * Server-side cascade check (C3.4) rejects the void if active SE references
 * this doc — error propagates via `onError` upstream.
 */

/**
 * D1.2.7.2 — reasons now come from `useUiFlags().reverseReasons` (default
 * matches the 6 canonical codes; OWNER may extend/override via SystemConfig).
 * `ReverseReasonCode` kept as a string alias for caller compat — runtime
 * validation happens on the server against the configured whitelist.
 */
export type ReverseReasonCode = string;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docNumber: string;
  loading?: boolean;
  /** Called with the void payload when user confirms. Caller dispatches the API. */
  onConfirm: (payload: {
    reasonCode: ReverseReasonCode;
    reasonDetail?: string;
    reverseDate: string;
  }) => void;
}

const todayBkk = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

export function ReverseDialog({ open, onOpenChange, docNumber, loading, onConfirm }: Props) {
  // D1.2.7.1/2/3 + D1.2.6.3/4 — reverse + backdate settings from
  // /settings/ui-flags. Defaults preserve pre-D1 strict UX.
  const {
    reverseReasonRequired,
    reverseReasons,
    reverseManagerApprovalDays,
    paymentDateWarningBackdate,
    paymentDateAllowFuture,
  } = useUiFlags();
  const [reasonCode, setReasonCode] = useState<ReverseReasonCode | ''>('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [reverseDate, setReverseDate] = useState(todayBkk());

  // Reset on close so reopening starts fresh
  useEffect(() => {
    if (!open) {
      setReasonCode('');
      setReasonDetail('');
      setReverseDate(todayBkk());
    }
  }, [open]);

  // ม.42-style soft warning when backdate > threshold (default 30)
  const daysBackdate = (() => {
    if (!reverseDate) return 0;
    const today = new Date(todayBkk());
    const chosen = new Date(reverseDate);
    return Math.floor((today.getTime() - chosen.getTime()) / 86400000);
  })();
  // D1.2.6.4 — disallow forward-dated reverse when OWNER turns flag off.
  // Negative daysBackdate = future date.
  const isFutureDate = daysBackdate < 0;
  const futureBlocked = isFutureDate && !paymentDateAllowFuture;

  const otherDetailRequired = reasonCode === 'other';
  const detailMissing = otherDetailRequired && reasonDetail.trim().length === 0;
  // D1.2.7.1 — only enforce reasonCode-required when the flag is on.
  const reasonOk = reverseReasonRequired ? !!reasonCode : true;
  const canSubmit = reasonOk && !detailMissing && !!reverseDate && !loading && !futureBlocked;

  const handleConfirm = () => {
    if (!canSubmit) return;
    onConfirm({
      reasonCode: reasonCode as ReverseReasonCode,
      reasonDetail: reasonDetail.trim() || undefined,
      reverseDate,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            กลับรายการเอกสาร {docNumber}
          </DialogTitle>
          <DialogDescription>
            ระบุเหตุผลและวันที่กลับรายการ — ระบบจะสร้าง JE กลับรายการอัตโนมัติ
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              เหตุผล {reverseReasonRequired && <span className="text-destructive">*</span>}
            </label>
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value as ReverseReasonCode | '')}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              aria-required={reverseReasonRequired}
            >
              <option value="">{reverseReasonRequired ? '— เลือกเหตุผล —' : '— ไม่ระบุ —'}</option>
              {reverseReasons.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              รายละเอียดเพิ่มเติม
              {otherDetailRequired && <span className="text-destructive"> *</span>}
              <span className="text-xs text-muted-foreground ml-2">
                (สูงสุด 500 ตัวอักษร)
              </span>
            </label>
            <textarea
              value={reasonDetail}
              onChange={(e) => setReasonDetail(e.target.value.slice(0, 500))}
              rows={3}
              placeholder={
                otherDetailRequired
                  ? 'จำเป็นต้องระบุเมื่อเลือก "อื่นๆ"'
                  : 'ทางเลือก — บันทึกใน audit log'
              }
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
            {detailMissing && (
              <p className="text-xs text-destructive mt-1">
                ต้องระบุรายละเอียดเมื่อเลือก "อื่นๆ"
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              วันที่กลับรายการ <span className="text-destructive">*</span>
            </label>
            <ThaiDateInput
              value={reverseDate}
              onChange={(e) => setReverseDate(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              JE กลับรายการจะ post ในวันที่นี้ (server ตรวจ V19 ว่างวดยังเปิดอยู่)
            </p>
            {/* D1.2.7.3 — manager-approval soft warning at configurable threshold
                (default 7d). Only shows when backdate ≤ paymentDateWarningBackdate
                (the broader warning supersedes for big backdates). */}
            {daysBackdate > reverseManagerApprovalDays &&
              daysBackdate <= paymentDateWarningBackdate && (
                <p className="text-xs text-warning mt-1 flex items-start gap-1">
                  <AlertTriangle className="size-3 mt-0.5 shrink-0" />
                  ย้อนหลัง {daysBackdate} วัน (เกิน {reverseManagerApprovalDays} วัน) —
                  ควรมีอนุมัติจากผู้จัดการก่อน
                </p>
              )}
            {/* D1.2.6.3 — broader backdate warning at configurable threshold
                (default 30d). */}
            {daysBackdate > paymentDateWarningBackdate && (
              <p className="text-xs text-warning mt-1 flex items-start gap-1">
                <AlertTriangle className="size-3 mt-0.5 shrink-0" />
                เลือกย้อนหลัง {daysBackdate} วัน — ตรวจสอบให้แน่ใจว่างวดยังเปิด
              </p>
            )}
            {/* D1.2.6.4 — block future-dated reverse when flag is off. */}
            {futureBlocked && (
              <p className="text-xs text-destructive mt-1 flex items-start gap-1">
                <AlertTriangle className="size-3 mt-0.5 shrink-0" />
                ไม่อนุญาตให้ระบุวันที่ในอนาคต — กรุณาเลือกวันที่ไม่เกินวันนี้
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            ยกเลิก
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!canSubmit}>
            {loading ? 'กำลังกลับรายการ...' : 'ยืนยันกลับรายการ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
