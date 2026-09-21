import { useState } from 'react';
import { Link } from 'react-router';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EvidenceImageLink } from './EvidenceImage';
import {
  baht, dayTimeOf, DESTINATION_LABEL, timeOf, toSatang, varianceLabel, varianceTone,
  type CashClose, type CashCloseStatusResponse, type CashHolding,
} from './cash-close';

/**
 * กล่องปิดยอด — ปุ่มใหญ่ปุ่มเดียว + แถบขั้นตอนเล็ก (mockup CnXmYLkT กระดาน 14 — เจ้าของ: "เพิ่มเป็นปุ่ม แล้วกดให้เป็น pop up
 * ขึ้นมาให้กดบันทึก ส่งยอดรายวันดีกว่า"). คำที่ใช้กับผู้ใช้ = "ส่งยอดรายวัน" (เดิม "นับเงินปิดยอด") — กติกาเดิมไม่เปลี่ยน:
 * ผู้ส่งยอด = พนักงานขาย/ผจก.สาขาของสาขานั้น · ผู้ยืนยันรับเงิน ≠ ผู้ส่งยอด · วันที่ไม่มีเงินสดไม่ต้องส่งยอด.
 * รายละเอียด 3 ขั้นแบบเต็ม (กระดาน 12) ยังอยู่ — กด "ดูรายละเอียด" ถึงจะกาง
 */
type Tone = 'done' | 'act' | 'wait' | 'idle';

const BOX: Record<Tone, string> = {
  done: 'border border-primary/20 bg-primary/5',
  act: 'border-2 border-primary bg-primary/5',
  wait: 'border-2 border-warning bg-warning/5',
  idle: 'border border-border',
};
const DOT: Record<Tone, string> = {
  done: 'bg-primary text-primary-foreground',
  act: 'bg-primary text-primary-foreground',
  wait: 'bg-warning text-foreground',
  idle: 'bg-muted text-muted-foreground',
};
const CHIP: Record<Tone, string> = {
  done: 'border-primary/20 bg-primary/5 text-primary',
  act: 'border-primary bg-primary/5 font-semibold text-primary',
  wait: 'border-warning bg-warning/5 font-semibold text-foreground',
  idle: 'border-border text-muted-foreground',
};

const ROLE_LABEL: Record<string, string> = { BRANCH_MANAGER: 'ผู้จัดการสาขา', SALES: 'พนักงานขาย' };
export const CONFIRMERS = 'เจ้าของ ผู้จัดการการเงิน หรือผู้จัดการสาขา';
export const BIG_BUTTON = 'h-14 px-7 text-[17px]';

export const counterNames = (readiness: CashCloseStatusResponse['readiness']) =>
  readiness.counters.map((person) => `${person.name} (${ROLE_LABEL[person.role] ?? person.role})`).join(' · ');

/** แถบขั้นตอนเล็กใต้ปุ่ม: 1 ส่งยอด → 2 ยืนยันรับเงิน → 3 เงินถึงบริษัท */
function ProgressChips({ steps }: { steps: [Tone, string][] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] leading-snug" aria-label="ขั้นตอนการปิดยอด">
      {steps.map(([tone, label], index) => (
        <li key={label} className="flex items-center gap-2">
          {index > 0 && <span aria-hidden className="text-muted-foreground">→</span>}
          <span className={`rounded-full border px-3 py-0.5 ${CHIP[tone]}`}>{index + 1} {label}</span>
        </li>
      ))}
    </ol>
  );
}

/** การส่งยอดหนึ่งครั้ง — แถบ/การ์ดย่อ พร้อมปุ่มของขั้นที่ถึงตา · "ดูรายละเอียด" กางกล่อง 3 ขั้นแบบเต็ม */
export function CloseCompact({ close, permissions, safeHolding, onConfirm, onDeposit, compact = false }: {
  close: CashClose; permissions: CashCloseStatusResponse['permissions']; safeHolding: CashHolding | null;
  /** แถวรองใต้กล่องสถานะ — ปุ่มขนาดปกติ (ปุ่มใหญ่ของหน้ามีได้ปุ่มเดียว) */
  compact?: boolean;
  onConfirm: (close: CashClose) => void; onDeposit: (holding: CashHolding) => void;
}) {
  const [open, setOpen] = useState(false);
  const confirmed = close.status === 'CONFIRMED';
  const isSender = close.countedBy.id === permissions.viewerId;
  const canConfirmThis = permissions.canConfirm && !isSender;
  const atBranch = close.moneyState === 'AT_BRANCH';
  const reached = confirmed && !atBranch;
  const buttonSize = compact ? { size: 'md' as const } : { size: 'lg' as const, className: BIG_BUTTON };
  const detailToggle = (
    <button type="button" className="inline-flex min-h-11 items-center text-[13px] text-primary underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'}
    </button>
  );
  const variance = (
    <><span className={`font-semibold ${varianceTone(close.varianceAmount)}`}>{varianceLabel(close.varianceAmount)}</span>{close.varianceReason ? ` — “${close.varianceReason}”` : ''}</>
  );

  return (
    <div className={`space-y-3 rounded-lg border p-3.5 sm:p-4 ${reached ? 'border-primary/20 bg-primary/5' : 'border-warning/30 bg-warning/5'}`}>
      {reached ? (
        <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-0.5 leading-snug">
            <div className="text-[15px] font-semibold text-primary">ส่งยอดครบแล้ว · เงินถึงบริษัท {baht(close.receivedAmount ?? 0)} ฿</div>
            <div className="text-[13px] text-foreground">
              {close.countedBy.name} ส่ง {timeOf(close.countedAt)} · {close.confirmedBy?.name ?? '-'} รับ {close.confirmedAt ? timeOf(close.confirmedAt) : ''} ·{' '}
              {close.destination ? DESTINATION_LABEL[close.destination] : 'ปิดยอดแล้ว'}{close.destination === 'BRANCH_SAFE' ? ' (นำฝากครบแล้ว)' : ''}
              {close.depositReference && <> · อ้างอิงสลิป {close.depositReference}</>}
              {close.hasDepositSlip && <> · <EvidenceImageLink path={`/shop-tenders/cash-close/${close.id}/deposit-slip`} title={`สลิปฝากเงิน ${close.branchName}`} /></>}
            </div>
            {toSatang(close.varianceAmount) !== 0 && <div className="text-[13px]">ส่วนต่างตอนนับ {variance}</div>}
          </div>
          <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-0">
            <span className="rounded-full bg-primary/10 px-3 py-0.5 text-xs font-semibold leading-snug text-primary">ถึงบริษัทแล้ว</span>
            {detailToggle}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-0.5 leading-snug">
              <div className="text-base font-semibold">{confirmed ? 'รับเงินแล้ว เงินยังอยู่ที่สาขา' : 'ส่งยอดแล้ว รอยืนยันรับเงิน'}</div>
              <div className="text-[13px] text-foreground">
                {close.countedBy.name} ส่งยอด {dayTimeOf(close.countedAt)}{close.attemptNo > 1 ? ` (ครั้งที่ ${close.attemptNo})` : ''} · นับได้ {baht(close.countedAmount)} · {variance}
              </div>
              <div className="text-[26px] font-bold tabular-nums">{confirmed ? `อยู่ในตู้เซฟสาขา ${baht(close.receivedAmount ?? 0)} ฿` : `ยอดที่ส่ง ${baht(close.sendAmount)} ฿`}</div>
            </div>
            <div className="flex flex-col gap-1 leading-snug sm:items-end sm:text-right">
              {!confirmed && canConfirmThis && <Button variant={compact ? 'outline' : 'primary'} {...buttonSize} onClick={() => onConfirm(close)}>ยืนยันรับเงิน</Button>}
              {!confirmed && !canConfirmThis && (
                <span className="text-[13px] font-semibold text-foreground">
                  {isSender && permissions.canConfirm ? `คุณเป็นผู้ส่งยอด — ต้องให้${CONFIRMERS}คนอื่นเป็นผู้ยืนยัน` : `รอ${CONFIRMERS}ยืนยันรับเงิน`}
                </span>
              )}
              {confirmed && (safeHolding?.canDeposit
                ? <Button variant="outline" {...buttonSize} onClick={() => onDeposit(safeHolding)}>บันทึกนำฝาก</Button>
                : <span className="text-[13px] font-semibold text-foreground">รอ{CONFIRMERS}บันทึกนำฝาก</span>)}
              {detailToggle}
            </div>
          </div>
          <ProgressChips steps={confirmed
            ? [['done', 'ส่งยอดแล้ว'], ['done', 'ยืนยันรับเงินแล้ว'], ['wait', 'เงินยังไม่ถึงบริษัท — รอบันทึกนำฝาก']]
            : [['done', 'ส่งยอดแล้ว'], [canConfirmThis ? 'act' : 'wait', canConfirmThis ? 'ยืนยันรับเงิน — ถึงตาคุณ' : 'รอยืนยันรับเงิน'], ['idle', 'เงินถึงบริษัท']]} />
        </>
      )}
      {open && <CloseSteps close={close} />}
    </div>
  );
}

function Step({ no, tone, title, children }: { no: number; tone: Tone; title: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1.5 rounded-lg bg-card p-3.5 leading-snug ${BOX[tone]}`}>
      <div className="flex items-center gap-2">
        <span aria-hidden className={`inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${DOT[tone]}`}>
          {tone === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : no}
        </span>
        <h3 className={`text-[15px] font-semibold ${tone === 'idle' ? 'text-muted-foreground' : 'text-foreground'}`}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

const Line = ({ children, className = 'text-muted-foreground' }: { children: React.ReactNode; className?: string }) =>
  <p className={`text-[13px] ${className}`}>{children}</p>;

/** รายละเอียด 3 ขั้นแบบเต็มของการส่งยอดหนึ่งครั้ง (อ่านอย่างเดียว — ปุ่มอยู่ที่การ์ดย่อ) */
export function CloseSteps({ close }: { close: CashClose }) {
  const confirmed = close.status === 'CONFIRMED';
  const atBranch = close.moneyState === 'AT_BRANCH';
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Step no={1} tone="done" title="ส่งยอดแล้ว">
        <Line className="text-foreground">{close.countedBy.name} ส่งยอด {dayTimeOf(close.countedAt)}{close.attemptNo > 1 ? ` · ครั้งที่ ${close.attemptNo}` : ''}</Line>
        <Line className="text-foreground tabular-nums">ต้องมี {baht(close.expectedAmount)} · นับได้ {baht(close.countedAmount)}</Line>
        <Line className="text-foreground"><span className={`font-semibold ${varianceTone(close.varianceAmount)}`}>{varianceLabel(close.varianceAmount)}</span>{close.varianceReason ? ` — “${close.varianceReason}”` : ''}</Line>
        <Line className="font-semibold text-foreground tabular-nums">ยอดที่ส่ง {baht(close.sendAmount)} (เหลือเงินทอน {baht(close.floatAmount)})</Line>
      </Step>
      {confirmed ? (
        <Step no={2} tone="done" title="ยืนยันรับเงินแล้ว">
          <Line className="text-foreground">{close.confirmedBy?.name ?? '-'} รับ {close.confirmedAt ? dayTimeOf(close.confirmedAt) : ''}</Line>
          <Line className="font-semibold text-foreground tabular-nums">รับจริง {baht(close.receivedAmount ?? 0)}</Line>
          {close.receiveVariance != null && toSatang(close.receiveVariance) !== 0 && (
            <Line className="text-destructive">ต่างจากยอดที่ส่ง {varianceLabel(close.receiveVariance)} — “{close.receiveNote}”</Line>
          )}
        </Step>
      ) : (
        <Step no={2} tone="wait" title="รอยืนยันรับเงิน">
          <Line>ส่งเงิน {baht(close.sendAmount)} ให้ผู้รับ แล้วให้เขาเปิดหน้านี้กด “ยืนยันรับเงิน” — ผู้รับต้องไม่ใช่คนที่ส่งยอด</Line>
        </Step>
      )}
      {!confirmed ? (
        <Step no={3} tone="idle" title="เงินถึงบริษัท"><Line>ขึ้นกับปลายทางที่ผู้รับเลือกตอนยืนยัน</Line></Step>
      ) : atBranch ? (
        <Step no={3} tone="wait" title="เงินยังไม่ถึงบริษัท">
          <Line className="text-foreground">อยู่ในตู้เซฟสาขา {baht(close.receivedAmount ?? 0)} — นำไปฝากเมื่อไรให้บันทึกพร้อมสลิป</Line>
        </Step>
      ) : (
        <Step no={3} tone="done" title="เงินถึงบริษัทแล้ว">
          <Line className="text-foreground">
            {close.destination ? DESTINATION_LABEL[close.destination] : 'ปิดยอดแล้ว'}{close.confirmedAt ? ` ${timeOf(close.confirmedAt)}` : ''}
            {close.destination === 'BRANCH_SAFE' && ' — นำฝากครบแล้ว'}
          </Line>
          {close.depositReference && <Line className="text-foreground">อ้างอิงสลิป {close.depositReference}</Line>}
        </Step>
      )}
    </div>
  );
}

/** สาขายังปิดยอดไม่ได้ — บอกสิ่งที่ขาด · ปุ่มไปตั้งค่าเฉพาะเจ้าของ (หน้า /branches และ /users เปิดได้เฉพาะ OWNER) */
export function ReadinessChecklist({ status }: { status: CashCloseStatusResponse }) {
  const { readiness, permissions } = status;
  const owner = permissions.viewerRole === 'OWNER';
  const missing = Number(!readiness.hasDrawerAccount) + Number(readiness.counters.length === 0);
  const link = (to: string, label: string) => owner && (
    <Link to={to} className="inline-flex min-h-11 items-center rounded-lg border border-input bg-background px-3.5 text-sm font-semibold text-foreground hover:bg-accent">{label}</Link>
  );
  const Item = ({ state, title, hint, action }: { state: 'missing' | 'optional' | 'ok'; title: string; hint: string; action?: React.ReactNode }) => (
    <li className={`grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-lg border p-3 leading-snug sm:grid-cols-[28px_minmax(0,1fr)_auto] ${state === 'missing' ? 'border-destructive/30 bg-destructive/5' : state === 'ok' ? 'border-primary/20 bg-primary/5' : 'border-border'}`}>
      <span aria-hidden className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${state === 'ok' ? 'bg-primary text-primary-foreground' : state === 'missing' ? 'border-2 border-destructive' : 'border-2 border-border'}`}>
        {state === 'ok' && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
      <span className="flex flex-col gap-0.5"><span className="text-sm font-semibold">{title}</span><span className="text-xs text-muted-foreground">{hint}</span></span>
      {action && <span className="col-start-2 sm:col-start-3">{action}</span>}
    </li>
  );
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold leading-snug text-warning-strong">
        สาขานี้ยังปิดยอดไม่ได้ — เหลือ {missing} อย่างที่ต้องตั้งก่อน{owner ? '' : ' · แจ้งเจ้าของให้ตั้งค่า'}
      </p>
      <ul className="space-y-2">
        {readiness.hasDrawerAccount
          ? <Item state="ok" title="ตั้งลิ้นชักเงินสดของสาขาแล้ว" hint="หน้าขายรับเงินสดได้ และยอดจะขึ้นในกล่องนี้" />
          : <Item state="missing" title="ยังไม่ได้ตั้งลิ้นชักเงินสดของสาขา" hint="ยังไม่ตั้ง = หน้าขายรับเงินสดไม่ได้ จึงไม่มียอดให้ส่ง" action={link('/branches', 'ไปตั้งค่าสาขา')} />}
        {readiness.floatAmount > 0
          ? <Item state="ok" title={`เงินทอนตั้งต้น ${baht(readiness.floatAmount)}`} hint="ปิดยอดแล้วเหลือเงินก้อนนี้ไว้ในลิ้นชัก ที่เหลือส่งทั้งหมด" />
          : <Item state="optional" title="เงินทอนตั้งต้นยังเป็น 0.00" hint="ไม่บังคับ — ถ้าเป็น 0 ระบบจะให้ส่งเงินทั้งหมดที่นับได้ ไม่เหลือเงินทอนในลิ้นชัก" action={link('/branches', 'ไปตั้งค่าสาขา')} />}
        {readiness.counters.length > 0
          ? <Item state="ok" title={`มีคนที่ส่งยอดได้ ${readiness.counters.length} คน: ${counterNames(readiness)}`} hint="ผู้ส่งยอด = พนักงานขายหรือผู้จัดการสาขาของสาขานี้ (บัญชีเจ้าของเป็นผู้ยืนยันรับเงิน ส่งยอดเองไม่ได้)" action={link('/users/new', 'เพิ่มพนักงาน')} />
          : <Item state="missing" title="ยังไม่มีบัญชีที่ส่งยอดได้ของสาขานี้" hint="ต้องมีบัญชีพนักงานขายหรือผู้จัดการสาขาที่ผูกกับสาขานี้ — บัญชีเจ้าของเป็นผู้ยืนยันรับเงิน ส่งยอดเองไม่ได้" action={link('/users/new', 'เพิ่มพนักงาน')} />}
      </ul>
    </div>
  );
}
