import { useState } from 'react';
import { AlertTriangle, Banknote, Check, CheckCircle2, Clock, Lock, Minus, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EvidenceImageLink } from './EvidenceImage';
import { BIG_BUTTON, CloseCompact, CloseSteps, CONFIRMERS, counterNames, ReadinessChecklist } from './CashCloseSteps';
import { pickHero, type HeroKind } from './cash-hero';
import {
  baht, dayTimeOf, DESTINATION_LABEL, thaiShortDate, timeOf, toSatang, varianceLabel, varianceTone,
  type CashClose, type CashCloseStatusResponse, type CashHolding,
} from './cash-close';

/**
 * กล่องสถานะเดียว (mockup CnXmYLkT กระดาน 15–16): บอก 3 อย่างเสมอ — ตอนนี้เงินสดอยู่ไหน · รอใคร · ต้องกดอะไร
 * พื้นเหลือง = ถึงตาผู้เปิดดู (ปุ่มใหญ่ปุ่มเดียว) · พื้นขาว = รอคนอื่น (ไม่มีปุ่ม) · พื้นเขียว = เงินถึงบริษัทแล้ว
 * ทุกสถานะมีไอคอน + ข้อความ ไม่บอกด้วยสีอย่างเดียว. กติกาเดิมไม่เปลี่ยน — เลือกเรื่องหลักที่ `pickHero`
 */
type Tone = 'act' | 'wait' | 'done';
type StepTone = 'done' | 'now' | 'idle';
interface StepView { tone: StepTone; title: string; hint?: string }

const FRAME: Record<Tone, string> = {
  act: 'border-warning/40 bg-warning/10',
  wait: 'border-border bg-card',
  done: 'border-primary/20 bg-primary/5',
};
const HEAD_ICON: Record<Tone, string> = { act: 'text-warning', wait: 'text-muted-foreground', done: 'text-primary' };

const KIND_ICON: Record<HeroKind, LucideIcon> = {
  SEND: Banknote, WAIT_SEND: Clock, CONFIRM: Clock, WAIT_CONFIRM: Clock, DEPOSIT: Lock, DONE: CheckCircle2,
  NO_CASH: Minus, EMPTY_DAY: Minus, NOT_READY: AlertTriangle,
};

const STEP_DOT: Record<StepTone, string> = {
  done: 'bg-primary text-primary-foreground',
  now: 'border-2 border-warning bg-warning/10 text-foreground',
  idle: 'border-2 border-dashed border-border text-muted-foreground',
};

const PROOF_HINT = 'ฝากธนาคาร = แนบสลิป + เลขอ้างอิง';
const NOT_SENDER_HINT = 'ผู้รับต้องไม่ใช่คนที่ส่งยอด';

function HeroSteps({ steps }: { steps: StepView[] }) {
  return (
    <ol aria-label="ขั้นตอนการปิดยอด" className="grid grid-cols-1 gap-y-2.5 rounded-lg border border-border/70 bg-card px-1.5 py-3 sm:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.title} className={`flex items-start gap-2.5 px-3 leading-snug ${index > 0 ? 'sm:border-l sm:border-border/70' : ''}`}>
          <span aria-hidden className={`inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-xs font-bold ${STEP_DOT[step.tone]}`}>
            {step.tone === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}
          </span>
          <span className="flex min-w-0 flex-col text-[13px]">
            <span className={`font-semibold ${step.tone === 'idle' ? 'text-muted-foreground' : 'text-foreground'}`}>{step.title}</span>
            {step.hint && <span className="text-muted-foreground">{step.hint}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

const sentLine = (close: CashClose) =>
  `ยอดที่ ${close.countedBy.name} ส่ง ${dayTimeOf(close.countedAt)}${close.attemptNo > 1 ? ` (ครั้งที่ ${close.attemptNo})` : ''} · นับได้ ${baht(close.countedAmount)}`;

function VarianceLine({ close, prefix }: { close: CashClose; prefix: string }) {
  if (toSatang(close.varianceAmount) === 0) return <div className="text-[13px] text-muted-foreground">{prefix}ตรงกับยอดที่ต้องมี</div>;
  return (
    <div className={`flex items-start gap-1.5 text-[13px] font-semibold ${varianceTone(close.varianceAmount)}`}>
      <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{prefix}{varianceLabel(close.varianceAmount)}{close.varianceReason ? ` — “${close.varianceReason}”` : ''}</span>
    </div>
  );
}

interface Props {
  status: CashCloseStatusResponse;
  date: string;
  isToday: boolean;
  onSend: () => void;
  onConfirm: (close: CashClose) => void;
  onDeposit: (holding: CashHolding) => void;
}

export default function CashStatusHero({ status, date, isToday, onSend, onConfirm, onDeposit }: Props) {
  const [open, setOpen] = useState(false);
  const pick = pickHero(status, isToday);
  const { kind, close } = pick;
  const { round, permissions, readiness } = status;
  const safeHolding = status.holdings.find((holding) => holding.source === 'BRANCH_SAFE') ?? null;
  const sentBack = status.closes.filter((item) => item.status === 'SENT_BACK');
  const closedToday = status.closes.some((item) => item.status !== 'SENT_BACK');
  // บอกผู้ส่งยอดว่ารอบใหม่ยังไม่มีอะไรให้ส่ง — ผู้ที่ส่งยอดไม่ได้ (เจ้าของ) ไม่ต้องเห็น
  const quietRound = closedToday && isToday && permissions.canCount && round.movementCount === 0 && kind !== 'NO_CASH';
  const tone: Tone = pick.viewerActs ? 'act' : kind === 'DONE' ? 'done' : 'wait';
  const Icon = KIND_ICON[kind];
  const zone = `เงินสดหน้าร้าน${isToday ? 'วันนี้' : `วันที่ ${thaiShortDate(date)}`} · ${status.branchName}`;
  const isSender = !!close && close.countedBy.id === permissions.viewerId;
  const sentStep: StepView | null = close ? { tone: 'done', title: '1 ส่งยอดแล้ว', hint: `${close.countedBy.name} · ${timeOf(close.countedAt)}` } : null;
  const receivedStep: StepView | null = close?.confirmedAt
    ? { tone: 'done', title: '2 รับเงินแล้ว', hint: `${close.confirmedBy?.name ?? '-'} · ${timeOf(close.confirmedAt)}` } : null;

  let head = '';
  let amount: number | null = null;
  let body: React.ReactNode = null;
  let action: React.ReactNode = null;
  let steps: StepView[] = [];

  if (kind === 'SEND') {
    head = pick.resend ? 'ถึงตาคุณส่งยอดอีกครั้ง' : 'ถึงตาคุณส่งยอด';
    amount = round.expectedAmount;
    body = <div className="text-[13px] text-foreground">ต้องมีในลิ้นชักตอนนี้ — นับเงินจริงแล้วกดส่งยอด</div>;
    action = <Button variant="primary" size="lg" className={`${BIG_BUTTON} w-full sm:w-auto`} onClick={onSend}>ส่งยอดรายวัน</Button>;
    steps = [{ tone: 'now', title: '1 ส่งยอด — ถึงตาคุณ', hint: 'นับเงินจริงในลิ้นชักแล้วกดส่งยอด' }, { tone: 'idle', title: '2 ยืนยันรับเงิน', hint: NOT_SENDER_HINT }, { tone: 'idle', title: '3 เงินถึงบริษัท', hint: PROOF_HINT }];
  } else if (kind === 'WAIT_SEND') {
    head = 'รอพนักงานส่งยอด';
    amount = round.expectedAmount;
    body = (
      <>
        <div className="text-[13px] text-muted-foreground">ต้องมีในลิ้นชักตอนนี้</div>
        <div className="text-[13px] text-muted-foreground">ผู้ส่งยอดของสาขานี้: {counterNames(readiness) || 'ยังไม่มี'}</div>
      </>
    );
    steps = [{ tone: 'now', title: '1 ส่งยอด — รอพนักงาน' }, { tone: 'idle', title: permissions.canConfirm ? '2 ยืนยันรับเงิน — ขั้นของคุณ' : '2 ยืนยันรับเงิน', hint: NOT_SENDER_HINT }, { tone: 'idle', title: '3 เงินถึงบริษัท', hint: PROOF_HINT }];
  } else if ((kind === 'CONFIRM' || kind === 'WAIT_CONFIRM') && close) {
    head = kind === 'CONFIRM' ? 'รอคุณยืนยันรับเงิน' : 'ส่งยอดแล้ว รอยืนยันรับเงิน';
    amount = close.sendAmount;
    body = (
      <>
        <div className="text-[13px] text-foreground">{sentLine(close)}</div>
        <VarianceLine close={close} prefix="เงิน" />
        {kind === 'WAIT_CONFIRM' && (
          <div className="text-[13px] font-semibold text-foreground">
            {isSender && permissions.canConfirm ? `คุณเป็นผู้ส่งยอด — ต้องให้${CONFIRMERS}คนอื่นเป็นผู้ยืนยัน` : `รอ${CONFIRMERS}ยืนยันรับเงิน`}
          </div>
        )}
      </>
    );
    action = kind === 'CONFIRM' && (
      <div className="flex flex-col gap-1.5">
        <Button variant="primary" size="lg" className={`${BIG_BUTTON} w-full sm:w-auto`} onClick={() => onConfirm(close)}>ยืนยันรับเงิน</Button>
        <span className="text-center text-xs text-muted-foreground">นับผิด? ตีกลับได้ในหน้าต่างถัดไป</span>
      </div>
    );
    steps = [sentStep!, kind === 'CONFIRM' ? { tone: 'now', title: '2 ยืนยันรับเงิน — ถึงตาคุณ', hint: NOT_SENDER_HINT } : { tone: 'now', title: '2 รอยืนยันรับเงิน', hint: NOT_SENDER_HINT }, { tone: 'idle', title: '3 เงินถึงบริษัท', hint: PROOF_HINT }];
  } else if (kind === 'DEPOSIT' && close) {
    head = 'เงินยังอยู่ที่ตู้เซฟสาขา';
    amount = close.receivedAmount ?? 0;
    body = (
      <>
        <div className="text-[13px] text-foreground">{close.confirmedBy?.name ?? '-'} รับ {close.confirmedAt ? dayTimeOf(close.confirmedAt) : ''} · ฝากธนาคารแล้วกดบันทึกนำฝาก (แนบสลิป + เลขอ้างอิง)</div>
        {!safeHolding?.canDeposit && <div className="text-[13px] font-semibold text-foreground">รอ{CONFIRMERS}บันทึกนำฝาก</div>}
      </>
    );
    action = safeHolding?.canDeposit && <Button variant="primary" size="lg" className={`${BIG_BUTTON} w-full sm:w-auto`} onClick={() => onDeposit(safeHolding)}>บันทึกนำฝาก</Button>;
    steps = [sentStep!, receivedStep ?? { tone: 'done', title: '2 รับเงินแล้ว' }, { tone: 'now', title: '3 เงินถึงบริษัท — รอนำฝาก', hint: 'ตอนนี้อยู่ในตู้เซฟสาขา' }];
  } else if (kind === 'DONE' && close) {
    head = 'เงินถึงบริษัทครบแล้ว';
    amount = close.receivedAmount ?? 0;
    body = (
      <>
        <div className="text-[13px] text-foreground">
          {close.countedBy.name} ส่ง {timeOf(close.countedAt)} · {close.confirmedBy?.name ?? '-'} รับ {close.confirmedAt ? timeOf(close.confirmedAt) : ''} ·{' '}
          {close.destination ? DESTINATION_LABEL[close.destination] : 'ปิดยอดแล้ว'}{close.destination === 'BRANCH_SAFE' ? ' (นำฝากครบแล้ว)' : ''}
          {close.depositReference && <> · อ้างอิงสลิป {close.depositReference}</>}
          {close.hasDepositSlip && <> · <EvidenceImageLink path={`/shop-tenders/cash-close/${close.id}/deposit-slip`} title={`สลิปฝากเงิน ${close.branchName}`} /></>}
        </div>
        {toSatang(close.varianceAmount) !== 0 && <VarianceLine close={close} prefix="ส่วนต่างตอนนับ " />}
      </>
    );
    steps = [sentStep!, receivedStep ?? { tone: 'done', title: '2 รับเงินแล้ว' }, { tone: 'done', title: '3 ถึงบริษัทแล้ว', hint: close.destination ? DESTINATION_LABEL[close.destination] : undefined }];
  } else if (kind === 'NO_CASH') {
    head = 'ยังไม่มีเงินสดในรอบนี้';
    amount = round.expectedAmount;
    body = (
      <>
        <div className="text-[13px] text-muted-foreground">{round.periodStart ? 'ยังไม่มีรายการเงินสดใหม่ตั้งแต่ส่งยอดครั้งก่อน' : 'ในลิ้นชักมีแต่เงินทอนตั้งต้น'}</div>
        <div className="text-[13px] text-muted-foreground">{permissions.canCount ? 'ยังไม่ต้องส่งยอด — รับเงินสดเมื่อไรปุ่มส่งยอดจะขึ้นเอง' : 'ยังไม่ต้องส่งยอด'}</div>
      </>
    );
    steps = [{ tone: 'idle', title: '1 ส่งยอด' }, { tone: 'idle', title: '2 ยืนยันรับเงิน' }, { tone: 'idle', title: '3 เงินถึงบริษัท' }];
  } else if (kind === 'EMPTY_DAY') {
    head = 'วันที่เลือกไม่มีการส่งยอด';
    body = <div className="text-[13px] text-muted-foreground">การส่งยอดรายวันของรอบใหม่ทำได้เฉพาะวันนี้</div>;
  }

  const equation = close ?? (kind === 'SEND' || kind === 'WAIT_SEND' || kind === 'NO_CASH' ? round : null);

  return (
    <section className={`flex flex-col gap-4 rounded-xl border p-4 sm:p-5 ${FRAME[tone]}`} aria-label="ปิดยอดลิ้นชักสาขา">
      {pick.resend && sentBack.map((item) => (
        <div key={item.id} role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] leading-snug text-foreground">
          <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <span>ส่งยอดครั้งที่ {item.attemptNo} เวลา {timeOf(item.countedAt)} ({baht(item.countedAmount)}) ถูกตีกลับโดย {item.sentBackBy?.name ?? '-'}: “{item.sentBackReason}”</span>
        </div>
      ))}

      {kind === 'NOT_READY' ? (
        <div className="space-y-3">
          <div className="text-[11px] font-semibold tracking-wide text-muted-foreground">{zone}</div>
          <ReadinessChecklist status={status} />
        </div>
      ) : (
        <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-5">
          <div className="space-y-1 leading-snug">
            <div className="text-[11px] font-semibold tracking-wide text-muted-foreground">{zone}</div>
            <h2 className={`flex items-center gap-2 text-lg font-semibold ${tone === 'done' ? 'text-primary' : 'text-foreground'}`}>
              <Icon aria-hidden className={`h-[22px] w-[22px] shrink-0 ${HEAD_ICON[tone]}`} />{head}
            </h2>
            {amount != null && (
              <div className={`text-[32px] font-bold leading-tight tabular-nums ${tone === 'done' ? 'text-primary' : kind === 'NO_CASH' ? 'text-muted-foreground' : 'text-foreground'}`}>{baht(amount)} ฿</div>
            )}
            {body}
          </div>
          {action}
        </div>
      )}

      {steps.length > 0 && <HeroSteps steps={steps} />}

      {equation && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] leading-snug text-muted-foreground tabular-nums">
          <span>เงินทอนตั้งต้น {baht(equation.floatAmount)} + รับเงินสด {baht(equation.cashIn)} − จ่ายเงินสดออก {baht(equation.cashOut)} =</span>
          <span className="font-semibold text-foreground">ต้องมีในลิ้นชัก{close ? 'ตอนส่งยอด' : ''} {baht(equation.expectedAmount)}</span>
          {close && (
            <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
              className="ml-auto inline-flex min-h-11 items-center text-[13px] text-primary underline-offset-2 hover:underline">
              {open ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียดการส่งยอด'}
            </button>
          )}
        </div>
      )}
      {!close && equation && round.floatAmount === 0 && (
        <p className="text-xs leading-snug text-muted-foreground">ยังไม่ได้ตั้งเงินทอนตั้งต้น (ตั้งได้ที่หน้าจัดการสาขา) — ระบบจะให้ส่งเงินทั้งหมดที่นับได้</p>
      )}
      {open && close && <CloseSteps close={close} />}

      {(pick.roundPending || pick.rest.length > 0 || (!pick.resend && sentBack.length > 0) || quietRound) && (
        <div className="space-y-3 border-t border-border/70 pt-4">
          {pick.roundPending && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3.5 leading-snug">
              <div>
                <div className="text-sm font-semibold">รอบใหม่หลังส่งยอด</div>
                <div className="text-[13px] text-muted-foreground tabular-nums">ต้องมีในลิ้นชักตอนนี้ {baht(round.expectedAmount)} ฿</div>
              </div>
              {permissions.canCount
                ? <Button variant="outline" size="md" onClick={onSend}>ส่งยอดรายวัน</Button>
                : <span className="text-[13px] font-semibold text-foreground">รอพนักงานส่งยอด</span>}
            </div>
          )}
          {quietRound && (
            <p className="text-xs leading-snug text-muted-foreground">รอบใหม่หลังส่งยอด: ยังไม่มีรายการเงินสดใหม่ตั้งแต่ส่งยอดครั้งก่อน</p>
          )}
          {pick.rest.map((item) => (
            <CloseCompact key={item.id} compact close={item} permissions={permissions} safeHolding={safeHolding} onConfirm={onConfirm} onDeposit={onDeposit} />
          ))}
          {!pick.resend && sentBack.map((item) => (
            <p key={item.id} className="text-xs leading-snug text-muted-foreground">
              ส่งยอดครั้งที่ {item.attemptNo} เวลา {timeOf(item.countedAt)} โดย {item.countedBy.name} ({baht(item.countedAmount)}) ถูกตีกลับโดย {item.sentBackBy?.name ?? '-'}: “{item.sentBackReason}”
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
