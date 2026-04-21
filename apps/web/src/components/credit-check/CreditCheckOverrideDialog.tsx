import { useMemo } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  aiDecision: string; // current CreditCheck.status — what AI decided
  aiSummary: string | null;
  status: string;
  onStatusChange: (v: string) => void;
  reasonCategory: string;
  onReasonCategoryChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;
  isPending: boolean;
  onConfirm: () => void;
}

interface ReasonOption {
  value: string;
  label: string;
  /** If true, label alone is not enough — require textarea ≥ 10 chars */
  requiresDetail: boolean;
  detailLabel?: string;
  detailPlaceholder?: string;
}

const REASON_OPTIONS: ReasonOption[] = [
  {
    value: 'EXISTING_CUSTOMER',
    label: 'ลูกค้าเก่าผ่อนจบแล้ว',
    requiresDetail: true,
    detailLabel: 'เลขสัญญาเก่า',
    detailPlaceholder: 'เช่น BC-2024-00123',
  },
  {
    value: 'PERSONAL_VOUCH',
    label: 'พนักงาน/คนรู้จัก/ลูกหลาน',
    requiresDetail: true,
    detailLabel: 'ชื่อ + ความสัมพันธ์',
    detailPlaceholder: 'เช่น น้องสาวคุณสมชาย (พนง.สาขาลาดพร้าว)',
  },
  {
    value: 'GUARANTOR',
    label: 'มีผู้ค้ำประกัน',
    requiresDetail: true,
    detailLabel: 'ชื่อผู้ค้ำ + เอกสาร',
    detailPlaceholder: 'เช่น บิดาค้ำ (นายสมบัติ) แนบสำเนาบัตร+สลิป',
  },
  {
    value: 'HIGH_DOWN',
    label: 'ดาวน์/จ่ายสด ≥ 50%',
    requiresDetail: false,
  },
  {
    value: 'CASH_INCOME',
    label: 'รายได้เงินสด (AI อ่านไม่ครอบคลุม)',
    requiresDetail: true,
    detailLabel: 'อาชีพ + รายได้ประมาณ',
    detailPlaceholder: 'เช่น ค้าขายตลาด รายได้ 25,000/เดือน',
  },
  {
    value: 'EXTRA_EVIDENCE',
    label: 'เอกสารรายได้เพิ่มเติม',
    requiresDetail: true,
    detailLabel: 'ระบุเอกสาร',
    detailPlaceholder: 'เช่น สลิปเงินเดือน 3 เดือน + ใบรับรองเงินเดือน',
  },
  {
    value: 'MGR_RISK',
    label: 'Manager/Owner รับความเสี่ยง',
    requiresDetail: true,
    detailLabel: 'ผู้อนุมัติ',
    detailPlaceholder: 'เช่น approve โดยคุณ... (ระบุความสัมพันธ์)',
  },
  {
    value: 'OTHER',
    label: 'อื่นๆ',
    requiresDetail: true,
    detailLabel: 'เหตุผล',
    detailPlaceholder: 'ระบุเหตุผลให้ชัดเจน',
  },
];

function compileReason(categoryValue: string, detail: string): string {
  const opt = REASON_OPTIONS.find((o) => o.value === categoryValue);
  const trimmed = detail.trim();
  if (!opt) return trimmed;
  if (opt.value === 'OTHER') return trimmed;
  return trimmed ? `${opt.label}: ${trimmed}` : opt.label;
}

function decisionLabel(decision: string): string {
  if (decision === 'APPROVED') return 'อนุมัติ';
  if (decision === 'REJECTED') return 'ปฏิเสธ';
  if (decision === 'MANUAL_REVIEW') return 'ต้องตรวจเพิ่ม';
  return decision;
}

export default function CreditCheckOverrideDialog({
  open,
  onClose,
  aiDecision,
  aiSummary,
  status,
  onStatusChange,
  reasonCategory,
  onReasonCategoryChange,
  notes,
  onNotesChange,
  isPending,
  onConfirm,
}: Props) {
  const agreesWithAi = !!status && status === aiDecision;
  const currentOption = REASON_OPTIONS.find((o) => o.value === reasonCategory);
  const compiled = useMemo(() => compileReason(reasonCategory, notes), [reasonCategory, notes]);

  // Validation — only when disagreeing with AI
  const needsReason = !!status && status !== aiDecision;
  const reasonValid = agreesWithAi
    ? true
    : !!reasonCategory &&
      (!currentOption?.requiresDetail || notes.trim().length >= 10) &&
      compiled.length <= 2000;
  const disabled = !status || !reasonValid || isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ปรับแก้สถานะเครดิตเช็ค</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* AI context — read before deciding */}
          {aiDecision && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Sparkles className="size-3.5 text-primary" />
                ผลจาก AI: <span className="text-primary">{decisionLabel(aiDecision)}</span>
              </div>
              {aiSummary && (
                <div className="text-xs text-muted-foreground leading-snug">{aiSummary}</div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">
              สถานะใหม่ <span className="text-destructive">*</span>
            </label>
            <select
              value={status}
              onChange={(e) => onStatusChange(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
            >
              <option value="">-- เลือกสถานะ --</option>
              <option value="APPROVED">ผ่าน</option>
              <option value="REJECTED">ไม่ผ่าน</option>
              <option value="MANUAL_REVIEW">ต้องตรวจเพิ่ม</option>
            </select>
          </div>

          {/* Agrees with AI → no reason needed */}
          {agreesWithAi && (
            <div className="rounded-lg border border-success/30 bg-success/5 p-3 flex items-start gap-2">
              <CheckCircle2 className="size-4 text-success shrink-0 mt-0.5" />
              <div className="text-xs text-foreground leading-snug">
                เห็นด้วยกับ AI — ไม่ต้องใส่เหตุผลเพิ่ม กดยืนยันได้เลย
              </div>
            </div>
          )}

          {/* Disagrees with AI → require reason */}
          {needsReason && (
            <>
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 flex items-start gap-2">
                <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
                <div className="text-xs text-foreground leading-snug">
                  คุณกำลัง override ผล AI — ต้องระบุเหตุผลเพื่อ audit
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  เหตุผล <span className="text-destructive">*</span>
                </label>
                <select
                  value={reasonCategory}
                  onChange={(e) => onReasonCategoryChange(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                >
                  <option value="">-- เลือกเหตุผล --</option>
                  {REASON_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}{opt.requiresDetail ? '' : ' ✓'}
                    </option>
                  ))}
                </select>
              </div>

              {currentOption?.requiresDetail && (
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    {currentOption.detailLabel} <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => onNotesChange(e.target.value)}
                    rows={3}
                    placeholder={currentOption.detailPlaceholder}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
                  />
                  <div className="flex justify-between text-[11px] mt-1">
                    <span
                      className={
                        notes.trim().length < 10 ? 'text-destructive' : 'text-muted-foreground'
                      }
                    >
                      {notes.trim().length < 10
                        ? `ต้อง ≥ 10 ตัวอักษร (ตอนนี้ ${notes.trim().length})`
                        : 'พอดีแล้ว'}
                    </span>
                    <span className="text-muted-foreground">{notes.length}/2000</span>
                  </div>
                </div>
              )}

              {currentOption && !currentOption.requiresDetail && (
                <div className="text-[11px] text-muted-foreground px-1">
                  ตัวเลือกนี้อธิบายในตัวเองแล้ว — ไม่ต้องใส่รายละเอียดเพิ่ม
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={disabled}>
            {isPending ? 'กำลังบันทึก...' : 'ยืนยัน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { compileReason, REASON_OPTIONS };
