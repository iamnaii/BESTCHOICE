import { useEffect, useId, useMemo, useState } from 'react';
import { ArrowDownToLine, Paperclip, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { formControlClass, formLabelClass } from '@/components/ui/form-styles';
import { cn } from '@/lib/utils';
import { toBangkokDateString } from '@/lib/date';
import type { PettyCashMovementKind, PettyCashMovementPayload, PettyCashSummary } from '../types';
import { EVIDENCE_IMAGE_ACCEPT, EVIDENCE_IMAGE_MAX_BYTES, hasMoreThanTwoDecimals, money, newRequestId, parseAmount } from '../petty-cash.util';

export interface MovementDialogProps {
  kind: PettyCashMovementKind;
  open: boolean;
  summary: PettyCashSummary;
  pending: boolean;
  onClose: () => void;
  onSubmit: (payload: PettyCashMovementPayload) => void;
}

const COPY = {
  TOP_UP: {
    title: 'เติมเงินสดย่อย',
    amountLabel: 'จำนวนเงินที่เติม (บาท)',
    bankLabel: 'ถอน/โอนจากบัญชี',
    bankHint: 'ค่าเริ่มต้นคือบัญชีจ่ายออก เหมือนเมนูจ่ายผู้จัดจำหน่าย · เปลี่ยนได้ทุกครั้ง',
    dateLabel: 'วันที่ถอน/โอน',
    quick: 'เติมให้เต็มวงเงิน',
    submit: 'บันทึกการเติม',
    after: 'คงเหลือหลังเติม',
    evidenceHint: 'สลิปถอน/โอน — เงินสดไม่บังคับหลักฐาน',
  },
  RETURN: {
    title: 'คืนเงินสดย่อยเข้าธนาคาร',
    amountLabel: 'จำนวนเงินที่คืน (บาท)',
    bankLabel: 'ฝากเข้าบัญชี',
    bankHint: 'ค่าเริ่มต้นคือบัญชีรับเข้า (ที่เงินจากหน้าร้านฝากเข้าอยู่แล้ว)',
    dateLabel: 'วันที่ฝาก',
    quick: 'คืนทั้งหมด',
    submit: 'บันทึกการคืน',
    after: 'คงเหลือหลังคืน',
    evidenceHint: 'สลิปฝาก — ไม่บังคับ',
  },
} as const;

/**
 * กล่องเติม/คืนเงินสดย่อย (mockup Q9YhHKUhw7kkawVfcu6yZz กระดาน 2–3): เติม ≤ วงเงิน − คงเหลือ · คืน ≤ คงเหลือ ·
 * ธนาคารเลือกได้ 2 บัญชี · วันที่ย้อนหลังได้ไม่เกินวันนี้ · หลักฐาน/หมายเหตุไม่บังคับ · แสดงรายการบัญชีที่จะลงก่อนกด
 */
export function MovementDialog({ kind, open, summary, pending, onClose, onSubmit }: MovementDialogProps) {
  const copy = COPY[kind];
  const ids = { amount: useId(), bank: useId(), date: useId(), note: useId(), file: useId() };
  const today = toBangkokDateString();
  // ย้อนหลังได้ไม่เกิน 365 วัน (กติกาเดียวกับจ่ายผู้จัดจำหน่าย — server ตรวจซ้ำ)
  const earliest = toBangkokDateString(new Date(Date.now() - 365 * 86_400_000));
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState(summary.defaultBank[kind]);
  const [movedAt, setMovedAt] = useState(today);
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState('');

  // รีเซ็ตเฉพาะตอนเปิดกล่อง/เปลี่ยนชนิด — ผูกกับสตริงรหัสธนาคาร ไม่ใช่ object summary (refetch ระหว่างพิมพ์ต้องไม่ล้างฟอร์ม)
  const defaultBank = summary.defaultBank[kind];
  useEffect(() => {
    if (!open) return;
    setAmount('');
    setBank(defaultBank);
    setMovedAt(toBangkokDateString());
    setNote('');
    setEvidence(null);
    setFileError(null);
    setRequestId(newRequestId());
  }, [open, kind, defaultBank]);

  const balance = Number(summary.balance);
  const limit = Number(summary.limit.value);
  const headroom = Number(summary.headroom);
  const cap = kind === 'TOP_UP' ? headroom : balance;
  const parsed = parseAmount(amount);

  const amountError = useMemo(() => {
    if (amount.trim() === '') return null;
    if (parsed == null) return 'จำนวนเงินไม่ถูกต้อง';
    if (parsed <= 0) return 'จำนวนเงินต้องมากกว่า 0';
    if (hasMoreThanTwoDecimals(amount)) return 'ทศนิยมได้ไม่เกิน 2 ตำแหน่ง';
    if (kind === 'TOP_UP' && parsed > headroom + 1e-9) {
      return headroom <= 0
        ? 'ยอดถึงวงเงินแล้ว — ตั้งวงเงินใหม่หรือคืนเงินเข้าธนาคารก่อน'
        : `เกินยอดที่เติมได้ (${money(headroom)} บาท) — ลดยอดหรือตั้งวงเงินใหม่ก่อน`;
    }
    if (kind === 'RETURN' && parsed > balance + 1e-9) return `คืนได้ไม่เกินยอดคงเหลือ ${money(balance)} บาท — เงินสดย่อยติดลบไม่ได้`;
    return null;
  }, [amount, parsed, kind, headroom, balance]);

  const dateError = movedAt > today ? 'วันที่ต้องไม่เกินวันนี้' : movedAt < earliest ? 'ย้อนหลังได้ไม่เกิน 365 วัน' : null;
  const valid = parsed != null && parsed > 0 && !amountError && !dateError && !!bank;
  const after = parsed != null && valid ? (kind === 'TOP_UP' ? balance + parsed : balance - parsed) : null;
  const bankLabel = summary.banks.find((b) => b.code === bank)?.label ?? bank;

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!EVIDENCE_IMAGE_ACCEPT.split(',').includes(file.type)) { setFileError('รองรับเฉพาะรูป JPEG, PNG หรือ WEBP'); setEvidence(null); return; }
    if (file.size > EVIDENCE_IMAGE_MAX_BYTES) { setFileError('รูปมีขนาดเกิน 5MB'); setEvidence(null); return; }
    setFileError(null);
    setEvidence(file);
  };

  const Icon = kind === 'TOP_UP' ? Plus : ArrowDownToLine;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg gap-0 overflow-hidden p-0">
        <DialogHeader className="mb-0 shrink-0 border-b border-border/50 px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Icon className={cn('size-5', kind === 'TOP_UP' ? 'text-primary' : 'text-info')} aria-hidden />
            {copy.title}
          </DialogTitle>
          <DialogDescription className="text-xs leading-snug">
            {kind === 'TOP_UP' ? 'ถอน/โอนจากธนาคารหน้าร้านเข้าเงินสดย่อย S11-1106' : 'นำเงินสดย่อยไปฝากคืนธนาคารหน้าร้าน'} · คงเหลือ {money(balance)} · วงเงิน {money(limit)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-4">
          <div>
            <label className={formLabelClass} htmlFor={ids.amount}>{copy.amountLabel}</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={ids.amount}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={!!amountError}
                aria-describedby={`${ids.amount}-hint`}
                className={cn(formControlClass, 'min-w-0 flex-1 text-right font-mono text-lg tabular-nums', amountError && 'border-destructive')}
              />
              <Button type="button" variant="outline" size="sm" className="min-h-11 whitespace-nowrap text-primary" onClick={() => setAmount(cap.toFixed(2))} disabled={cap <= 0}>
                {copy.quick} {money(cap)}
              </Button>
            </div>
            <p id={`${ids.amount}-hint`} className={cn('mt-1 text-xs leading-snug', amountError ? 'text-destructive' : 'text-muted-foreground')}>
              {amountError
                ?? (kind === 'TOP_UP'
                  ? headroom <= 0
                    ? 'ยอดถึงวงเงินแล้ว — ตั้งวงเงินใหม่หรือคืนเงินเข้าธนาคารก่อน'
                    : `เติมได้อีกไม่เกิน ${money(headroom)} บาท (วงเงิน − คงเหลือ)`
                  : `คืนได้ไม่เกินยอดคงเหลือ ${money(balance)} บาท`)}
            </p>
          </div>

          <div>
            <label className={formLabelClass} htmlFor={ids.bank}>{copy.bankLabel}</label>
            <NativeSelect id={ids.bank} value={bank} onChange={(e) => setBank(e.target.value)} className={formControlClass} aria-describedby={`${ids.bank}-hint`}>
              {summary.banks.map((b) => (
                <option key={b.code} value={b.code}>{b.label} · {b.code}</option>
              ))}
            </NativeSelect>
            <p id={`${ids.bank}-hint`} className="mt-1 text-xs leading-snug text-muted-foreground">{copy.bankHint}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>div]:min-w-0">
            <div>
              <label className={formLabelClass} htmlFor={ids.date}>{copy.dateLabel}</label>
              <ThaiDateInput id={ids.date} value={movedAt} min={earliest} max={today} onChange={(e) => setMovedAt(e.target.value)} className={formControlClass} />
              <p className="mt-1 text-xs leading-snug text-muted-foreground">{dateError ?? 'ย้อนหลังได้ · งวดบัญชีที่ปิดแล้วจะลงวันที่บันทึกแทน'}</p>
            </div>
            <div>
              <span className={formLabelClass}>หลักฐาน <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span></span>
              <label htmlFor={ids.file} className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent">
                <Paperclip className="size-4" aria-hidden />
                <span className="truncate">{evidence ? evidence.name : 'แนบสลิป / รูป'}</span>
                <input id={ids.file} type="file" accept={EVIDENCE_IMAGE_ACCEPT} aria-label="แนบรูปหลักฐาน" className="sr-only"
                  onChange={(event) => { pickFile(event.target.files?.[0]); event.target.value = ''; }} />
              </label>
              <p className={cn('mt-1 text-xs leading-snug', fileError ? 'text-destructive' : 'text-muted-foreground')}>{fileError ?? copy.evidenceHint}</p>
            </div>
          </div>

          <div>
            <label className={formLabelClass} htmlFor={ids.note}>หมายเหตุ <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span></label>
            <textarea id={ids.note} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={kind === 'TOP_UP' ? 'เช่น ถอน ATM สาขาโลตัส · เตรียมจ่ายของเข้าสัปดาห์หน้า' : 'เช่น เงินสดเหลือเกินจำเป็น · แก้รายการเติมผิด'}
              className={cn(formControlClass, 'h-auto min-h-16 resize-y py-2')} />
          </div>

          <section aria-label="รายการบัญชีที่จะลง" className="rounded-xl border border-border/50 bg-muted/40 p-3 text-xs leading-snug">
            <div className="mb-1 flex justify-between font-medium text-muted-foreground"><span>ลงบัญชี SHOP เมื่อบันทึก</span><span>{movedAt}</span></div>
            {kind === 'TOP_UP' ? (
              <>
                <div className="flex justify-between gap-2"><span className="text-primary">{`Dr S11-1106 เงินสด - เงินสดย่อย`}</span><span className="font-mono tabular-nums">{valid ? money(parsed) : '—'}</span></div>
                <div className="flex justify-between gap-2"><span className="text-warning-strong">{`Cr ${bank} ${bankLabel}`}</span><span className="font-mono tabular-nums">{valid ? money(parsed) : '—'}</span></div>
              </>
            ) : (
              <>
                <div className="flex justify-between gap-2"><span className="text-primary">{`Dr ${bank} ${bankLabel}`}</span><span className="font-mono tabular-nums">{valid ? money(parsed) : '—'}</span></div>
                <div className="flex justify-between gap-2"><span className="text-warning-strong">{`Cr S11-1106 เงินสด - เงินสดย่อย`}</span><span className="font-mono tabular-nums">{valid ? money(parsed) : '—'}</span></div>
              </>
            )}
            <div className="mt-1 border-t border-border/50 pt-1 text-muted-foreground">
              {after != null
                ? `${copy.after} ${money(after)} บาท${limit > 0 ? ` · ${((after / limit) * 100).toFixed(1)}% ของวงเงิน` : ''}`
                : 'กรอกจำนวนเงินก่อน'}
            </div>
          </section>
        </div>

        <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-end gap-2 border-t border-border/50 px-6 py-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>ยกเลิก</Button>
          <Button
            type="button"
            variant="primary"
            disabled={!valid || pending}
            onClick={() => valid && parsed != null && onSubmit({ amount: Number(parsed.toFixed(2)), bankAccountCode: bank, movedAt, note: note.trim() || undefined, requestId, evidence })}
          >
            {pending ? 'กำลังบันทึก…' : valid && parsed != null ? `${copy.submit} ${money(parsed)} บาท` : copy.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
