import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Decimal from 'decimal.js';
import { CalendarClock, CalendarDays, Layers, Check, AlertTriangle } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { formatThaiDate } from '@/lib/date';

interface Props {
  contractId: string;
  contractNumber: string;
  customerName: string;
  branchName?: string;
  installmentNo: number;
  currentDueDate: string;
  /** serialized Decimal — the per-installment total (incl. commission + VAT). */
  monthlyPayment: string;
  onClose: () => void;
  onSuccess: () => void;
}

const QUICK_DAYS = [7, 14, 30];

/**
 * In-modal "ปรับงวด" (reschedule) overlay — mirrors EarlyPayoffOverlay's portal pattern.
 * Reschedule is a DB-only operation (shift due dates from `installmentNo` onward by
 * `daysToShift`, then set the last installment's amountDue = monthlyPayment − fee). NO
 * journal posts at reschedule time — the JP6 JE posts later when the customer pays
 * (6b bundled / 6a fee-advance). So this overlay has no live JE preview by design.
 */
export function RescheduleOverlay({
  contractId,
  contractNumber,
  customerName,
  branchName,
  installmentNo,
  currentDueDate,
  monthlyPayment,
  onClose,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();
  const [daysToShift, setDaysToShift] = useState(7);
  const [splitMode, setSplitMode] = useState<'SINGLE' | 'SPLIT'>('SINGLE');

  const days = Math.max(0, Math.floor(daysToShift) || 0);

  // Fee = ROUND_DOWN(monthlyPayment / 30 × days, 2) — identical to RescheduleService.execute
  // and the preview service. Display-only estimate; the server recomputes authoritatively.
  const fee = useMemo(() => {
    if (days <= 0) return new Decimal(0);
    return new Decimal(monthlyPayment || 0).div(30).times(days).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  }, [monthlyPayment, days]);

  const lastInstallmentNewAmount = useMemo(() => {
    return new Decimal(monthlyPayment || 0).minus(fee).toDecimalPlaces(2);
  }, [monthlyPayment, fee]);

  const newDueDate = useMemo(() => {
    const dt = new Date(currentDueDate);
    if (Number.isNaN(dt.getTime())) return null;
    dt.setDate(dt.getDate() + days);
    return dt.toISOString().slice(0, 10);
  }, [currentDueDate, days]);

  const mutation = useMutation({
    mutationFn: async () => {
      // Reschedule posts NO JE now (DB-only). `amount`/`paymentMethod` are RecordPaymentDto
      // validation placeholders — the controller's RESCHEDULE branch returns before using them.
      // amount=0.01 is the @Min(0.01) threshold (unambiguously "required but unused").
      const { data } = await api.post('/payments/record', {
        contractId,
        installmentNo,
        amount: 0.01,
        paymentMethod: 'CASH',
        case: 'RESCHEDULE',
        daysToShift: days,
        splitMode,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('ปรับงวด (เลื่อนวันครบกำหนด) สำเร็จ');
      // Match the parent PaymentsPage query keys so the list refreshes immediately.
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['pending-payments'] });
      queryClient.invalidateQueries({ queryKey: ['pending-summary'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      onSuccess();
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const canSubmit = days >= 1 && !mutation.isPending;

  return createPortal(
    <div className="fixed inset-0 z-50 pointer-events-auto bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8">
      <div className="w-full max-w-xl bg-background rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-4rem)]">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm leading-snug text-muted-foreground hover:text-foreground transition-colors"
          >
            ← กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground leading-snug">ปรับงวด — เลื่อนวันครบกำหนด</h2>
          <div className="w-16" />
        </div>

        <div className="p-6 space-y-5">
          {/* Section 1: ข้อมูลสัญญา */}
          <Section icon={<CalendarClock className="size-4" />} title="ข้อมูลสัญญา" subtitle="เลขที่, ลูกค้า, งวดปัจจุบัน">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div><span className="text-muted-foreground">สัญญา: </span><span className="font-mono font-semibold">{contractNumber}</span></div>
              <div><span className="text-muted-foreground">ลูกค้า: </span><span className="font-medium">{customerName}</span></div>
              {branchName && <div><span className="text-muted-foreground">สาขา: </span><span className="font-medium">{branchName}</span></div>}
              <div><span className="text-muted-foreground">เลื่อนจากงวดที่: </span><span className="font-medium">{installmentNo}</span></div>
              <div className="col-span-2"><span className="text-muted-foreground">ครบกำหนดเดิม: </span><span className="font-medium">{formatThaiDate(currentDueDate)}</span></div>
            </div>
          </Section>

          {/* Section 2: เลื่อนกี่วัน */}
          <Section icon={<CalendarDays className="size-4" />} title="เลื่อนกี่วัน" subtitle="กำหนดจำนวนวันที่ต้องการเลื่อน">
            <label className="block text-xs font-medium text-foreground mb-1.5 leading-snug">จำนวนวันที่เลื่อน</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {QUICK_DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDaysToShift(d)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                    days === d
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-input hover:bg-muted'
                  }`}
                >
                  {d} วัน
                </button>
              ))}
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={daysToShift}
                  onChange={(e) => setDaysToShift(Math.max(1, Math.min(365, Number(e.target.value) || 0)))}
                  className="w-20 px-2 py-1.5 border border-input rounded-lg text-sm text-right font-mono"
                  aria-label="จำนวนวันที่เลื่อน"
                />
                <span className="text-sm text-muted-foreground">วัน</span>
              </div>
            </div>
            <div className="space-y-1.5 text-sm">
              {newDueDate && (
                <Row label="ครบกำหนดใหม่ (งวดนี้)" value={formatThaiDate(newDueDate)} bold />
              )}
              <Row label="ค่าธรรมเนียมเลื่อนงวด" value={`${fee.toFixed(2)} บาท`} />
              <p className="text-xs text-muted-foreground leading-snug">
                คำนวณจาก ค่างวด ({new Decimal(monthlyPayment || 0).toFixed(2)}) ÷ 30 × {days} วัน (ปัดลง) — ระบบคำนวณจริงตอนยืนยัน
              </p>
            </div>
          </Section>

          {/* Section 3: รูปแบบค่าธรรมเนียม (6a/6b) */}
          <Section icon={<Layers className="size-4" />} title="วิธีเก็บค่าธรรมเนียม" subtitle="เลือกรูปแบบการเก็บค่าธรรมเนียมเลื่อนงวด">
            <div className="space-y-2">
              <ModeOption
                active={splitMode === 'SINGLE'}
                onClick={() => setSplitMode('SINGLE')}
                title="รวมกับงวดถัดไป (6b)"
                desc="ลูกค้าจ่ายค่าธรรมเนียมพร้อมค่างวดถัดไปทีเดียว"
              />
              <ModeOption
                active={splitMode === 'SPLIT'}
                onClick={() => setSplitMode('SPLIT')}
                title="เก็บค่าธรรมเนียมแยกก่อน (6a)"
                desc="เก็บค่าธรรมเนียมเลื่อนงวดเป็นเงินรับล่วงหน้าตอนนี้ แล้วจ่ายค่างวดตามปกติ"
              />
            </div>
          </Section>

          {/* Section 4: สิ่งที่จะเกิดขึ้น */}
          <Section icon={<Check className="size-4" />} title="สิ่งที่จะเกิดขึ้นเมื่อยืนยัน" subtitle="ตรวจสอบก่อนปรับงวด" tone="success">
            <ul className="space-y-1.5 text-sm">
              <Effect text={`เลื่อนวันครบกำหนดงวดที่ ${installmentNo} เป็นต้นไป +${days} วัน`} />
              <Effect text={`ปรับยอดงวดสุดท้าย = ค่างวด − ค่าธรรมเนียม (${lastInstallmentNewAmount.toFixed(2)} บาท)`} />
              <Effect text={`บันทึก AuditLog (RESCHEDULE ${splitMode === 'SPLIT' ? '6a' : '6b'})`} />
              <Effect text="ยังไม่ลงบัญชีตอนนี้ — JE (JP6) จะลงตอนลูกค้าจ่ายงวดถัดไป" warning />
            </ul>
          </Section>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2.5 text-sm leading-snug border border-input rounded-lg hover:bg-muted transition-colors">
            ยกเลิก
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            className="px-6 py-2.5 text-sm leading-snug bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
          >
            {mutation.isPending ? 'กำลังปรับงวด...' : 'ยืนยันปรับงวด'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Local helpers (token-only styling, mirrors EarlyPayoffOverlay) ─────────── */
function Section({
  icon,
  title,
  subtitle,
  tone = 'primary',
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  tone?: 'primary' | 'success';
  children: React.ReactNode;
}) {
  const iconClass = tone === 'success' ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary';
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className={`flex items-center justify-center size-8 rounded-lg ${iconClass}`}>{icon}</div>
        <div>
          <h3 className="text-sm font-semibold text-foreground leading-snug">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground leading-snug">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-muted-foreground leading-snug">{label}</span>
      <span className={`leading-snug ${bold ? 'font-semibold text-foreground' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}

function ModeOption({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`w-full text-left rounded-xl border-2 px-3 py-2.5 transition-colors ${
        active
          ? 'bg-primary/5 border-primary'
          : 'bg-card border-border hover:border-primary/40 hover:bg-accent'
      }`}
    >
      <div className="text-sm font-semibold text-foreground leading-snug">{title}</div>
      <div className="text-xs text-muted-foreground leading-snug">{desc}</div>
    </button>
  );
}

function Effect({ text, warning }: { text: string; warning?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span className={warning ? 'text-warning' : 'text-success'}>
        {warning ? <AlertTriangle className="size-4 inline" /> : <Check className="size-4 inline" />}
      </span>
      <span className={warning ? 'text-warning' : 'text-foreground'}>{text}</span>
    </li>
  );
}
