import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Undo2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';
import { useUiFlags } from '@/hooks/useUiFlags';
import { formatNumberDecimal } from '@/utils/formatters';
import type { IcabModule, IcabReverseReason } from './types';

/**
 * InternalControlActionBar — unified reverse-confirmation dialog.
 *
 * Replaces four module-specific dialogs:
 *   - ReverseModal (other-income)
 *   - ReverseDialog (expense-form-v4)
 *   - ReverseAssetDialog (assets)
 *   - ReverseDisposalDialog (assets)
 *
 * Reasons are sourced from `GET /settings/reverse-reasons/active` (admin-
 * managed via `/settings#internal-control`) and fall back to `useUiFlags`
 * defaults until the API responds — so the dropdown is never empty.
 *
 * The dialog handles UI + state only. Modules build their own JE on
 * confirm and call their existing reverse endpoint via `onConfirm`.
 */
export interface ReverseConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  module: IcabModule;
  /** Original document number — e.g. `RT-202605-00006`. */
  docNumber: string;
  /** Optional one-line subtitle (amount, vendor, etc.). */
  docSubtitle?: string;
  /** Optional amount; rendered right of the doc number when provided. */
  docAmount?: number;
  isLoading?: boolean;
  /** Caller-supplied list of consequence bullet points to surface above the form. */
  impactNotes?: string[];
  /** User confirmed — caller is responsible for actually posting the reverse. */
  onConfirm: (payload: { reasonId: string; reasonLabel: string; note: string }) => void;
}

const MODULE_LABELS: Record<IcabModule, string> = {
  other_income: 'รายได้อื่น',
  expense: 'รายจ่าย',
  asset: 'สินทรัพย์',
};

const DEFAULT_IMPACT_NOTES: Record<IcabModule, string[]> = {
  other_income: [
    'ระบบจะสร้างเอกสาร Reverse Entry — สลับ Dr↔Cr ทุกบรรทัด',
    'เอกสารต้นฉบับจะเปลี่ยน status เป็น REVERSED (read-only)',
    'ถ้างวด ภ.พ.30 ยื่นไปแล้ว — ต้องยื่นแก้ไข',
  ],
  expense: [
    'ระบบจะสร้างเอกสาร Reverse Entry — สลับ Dr↔Cr ทุกบรรทัด',
    'เอกสารต้นฉบับจะเปลี่ยน status เป็น REVERSED (read-only)',
    'WHT / VAT ที่บันทึกไว้จะถูกกลับรายการอัตโนมัติ',
  ],
  asset: [
    'ระบบจะสร้างเอกสาร Reverse Entry — สลับ Dr↔Cr ทุกบรรทัด',
    'เอกสารต้นฉบับจะเปลี่ยน status เป็น REVERSED (read-only)',
    'หากบันทึกค่าเสื่อมราคาไปแล้ว — ต้องตรวจสอบ depreciation schedule',
  ],
};

export function ReverseConfirmDialog({
  open,
  onOpenChange,
  module,
  docNumber,
  docSubtitle,
  docAmount,
  isLoading = false,
  impactNotes,
  onConfirm,
}: ReverseConfirmDialogProps) {
  const flags = useUiFlags();
  const [reasonId, setReasonId] = useState<string>('');
  const [note, setNote] = useState<string>('');

  // Reset form whenever the dialog opens for a different doc.
  useEffect(() => {
    if (open) {
      setReasonId('');
      setNote('');
    }
  }, [open, docNumber]);

  // Source the reasons from the admin-managed table; fall back to the
  // useUiFlags defaults until the network request completes.
  const reasonsQuery = useQuery<IcabReverseReason[]>({
    queryKey: ['reverse-reasons', 'active'],
    queryFn: async () =>
      (await api.get<IcabReverseReason[]>('/settings/reverse-reasons/active')).data,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const reasons: IcabReverseReason[] = useMemo(() => {
    if (reasonsQuery.data && reasonsQuery.data.length > 0) return reasonsQuery.data;
    return flags.reverseReasons.map((r) => ({ id: r.code, label: r.label }));
  }, [reasonsQuery.data, flags.reverseReasons]);

  const noteRequired = flags.reverseReasonRequired;
  const isValid = reasonId.length > 0 && (!noteRequired || note.trim().length >= 5);

  const handleConfirm = () => {
    const selected = reasons.find((r) => r.id === reasonId);
    if (!selected) return;
    onConfirm({ reasonId: selected.id, reasonLabel: selected.label, note: note.trim() });
  };

  const notesToShow = impactNotes ?? DEFAULT_IMPACT_NOTES[module];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive leading-snug">
            <AlertTriangle size={20} aria-hidden />
            ยืนยันการยกเลิก / กลับรายการ
          </DialogTitle>
          <DialogDescription className="leading-snug">
            <span className="font-mono font-semibold text-foreground">{docNumber}</span>
            {docSubtitle ? <span> · {docSubtitle}</span> : null}
            {typeof docAmount === 'number' ? (
              <span> · <span className="font-semibold text-foreground">{formatNumberDecimal(docAmount, 2)} ฿</span></span>
            ) : null}
            <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">
              {MODULE_LABELS[module]}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
            <p className="text-xs font-semibold text-warning mb-1.5 leading-snug">
              ⚠ ผลกระทบ
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground leading-snug">
              {notesToShow.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="icab-reason" className="text-sm font-medium">
              เหตุผลการยกเลิก *
            </Label>
            <select
              id="icab-reason"
              value={reasonId}
              onChange={(e) => setReasonId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-snug focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={isLoading}
            >
              <option value="">— เลือกเหตุผล —</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="icab-note" className="text-sm font-medium">
              บันทึกรายละเอียด {noteRequired ? <span className="text-destructive">*</span> : null}
            </Label>
            <textarea
              id="icab-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="เช่น บันทึกผิดบัญชี — ควรเป็น 42-1105 ไม่ใช่ 42-1102"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-snug focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={isLoading}
              maxLength={500}
            />
            {noteRequired && (
              <p className="text-xs text-muted-foreground leading-snug">
                อย่างน้อย 5 ตัวอักษร — เก็บใน audit log ถาวร
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            ยกเลิก
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!isValid || isLoading}
          >
            <Undo2 size={14} className="mr-1.5" aria-hidden />
            {isLoading ? 'กำลังกลับรายการ...' : 'ยืนยันกลับรายการ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
