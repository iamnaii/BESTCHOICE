import { Link } from 'react-router';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EvidenceImageLink } from './EvidenceImage';
import {
  baht, dayTimeOf, DESTINATION_LABEL, timeOf, toSatang, varianceLabel, varianceTone,
  type CashClose, type CashCloseStatusResponse, type CashHolding,
} from './cash-close';

/**
 * 3 ขั้นของการปิดยอด (mockup CnXmYLkT กระดาน 12–13 — เจ้าของถามว่า "กดทำรายการส่งเงินยังไง"):
 * นับเงินและแจ้งยอดส่ง → ยืนยันรับเงิน → เงินถึงบริษัท. ไม่มีปุ่ม "ส่งเงิน" แยก — ปุ่มอยู่ในขั้นที่คนเปิดดูทำได้
 * ถ้าทำไม่ได้ ขั้นนั้นบอกว่ารอใคร. กติกาเดิมไม่เปลี่ยน (ผู้นับ = พนักงานขาย/ผจก.สาขา · ผู้ยืนยัน ≠ ผู้นับ)
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

const ROLE_LABEL: Record<string, string> = { BRANCH_MANAGER: 'ผู้จัดการสาขา', SALES: 'พนักงานขาย' };
const CONFIRMERS = 'เจ้าของ ผู้จัดการการเงิน หรือผู้จัดการสาขา';

function Step({ no, tone, title, children }: { no: number; tone: Tone; title: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1.5 rounded-lg p-3.5 leading-snug ${BOX[tone]}`}>
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

const counterNames = (readiness: CashCloseStatusResponse['readiness']) =>
  readiness.counters.map((person) => `${person.name} (${ROLE_LABEL[person.role] ?? person.role})`).join(' · ');

/** รอบปัจจุบันที่ยังไม่มีใครนับ — ขั้นที่ 1 ถึงตา */
export function RoundSteps({ status, nothingNew, onCount }: { status: CashCloseStatusResponse; nothingNew: boolean; onCount: () => void }) {
  const { round, permissions, readiness } = status;
  const noCash = round.movementCount === 0;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-lg bg-muted/60 p-3 text-sm leading-snug sm:p-4">
        <dt className="text-muted-foreground">เงินทอนตั้งต้นของสาขา</dt><dd className="text-right tabular-nums">{baht(round.floatAmount)}</dd>
        <dt className="text-muted-foreground">+ รับเงินสด</dt><dd className="text-right tabular-nums">{baht(round.cashIn)}</dd>
        <dt className="text-muted-foreground">− จ่ายเงินสดออก</dt><dd className="text-right tabular-nums text-destructive">{baht(round.cashOut)}</dd>
        <dt className="border-t border-border pt-1.5 font-semibold">= ต้องมีในลิ้นชักตอนนี้</dt>
        <dd className="border-t border-border pt-1.5 text-right text-lg font-bold tabular-nums">{baht(round.expectedAmount)} ฿</dd>
      </dl>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {permissions.canCount ? (
          <Step no={1} tone="act" title="นับเงินและแจ้งยอดส่ง">
            <Line className="text-foreground">ถึงตาคุณ — นับเงินในลิ้นชัก ระบบคิดยอดที่ต้องส่งให้เอง (นับได้ − เงินทอนตั้งต้น)</Line>
            <Button variant="primary" size="md" disabled={nothingNew} onClick={onCount}>นับเงินปิดยอดวันนี้</Button>
            <Line>
              {nothingNew ? 'ยังไม่มีรายการเงินสดใหม่ตั้งแต่ปิดยอดครั้งก่อน'
                : `นับตั้งแต่${round.periodStart ? `ปิดยอดครั้งก่อน (${dayTimeOf(round.periodStart)})` : 'เริ่มใช้สมุดเงินหน้าร้าน'} ถึงตอนนี้`}
            </Line>
          </Step>
        ) : (
          <Step no={1} tone={noCash ? 'idle' : 'wait'} title="นับเงินและแจ้งยอดส่ง">
            <Line className={noCash ? 'text-muted-foreground' : 'font-semibold text-foreground'}>
              {noCash ? 'ยังไม่มีรายการเงินสดในรอบนี้ — เมื่อหน้าขายรับเงินสด ยอดจะขึ้นที่นี่' : 'ตอนนี้รอขั้นนี้ — รอพนักงานนับเงิน'}
            </Line>
            <Line className="text-foreground">ผู้ที่นับได้ของสาขานี้: {counterNames(readiness) || 'ยังไม่มี'}</Line>
            <Line>ผู้นับ = พนักงานขายหรือผู้จัดการสาขาของสาขานี้{permissions.canConfirm ? ' — คุณเป็นผู้ยืนยันรับเงินในขั้นที่ 2' : ''}</Line>
          </Step>
        )}
        <Step no={2} tone="idle" title="ยืนยันรับเงิน">
          <Line>{permissions.canCount ? `หลังบันทึกยอดนับ ส่งเงินให้${CONFIRMERS}คนอื่น แล้วให้เขากดยืนยัน` : `${CONFIRMERS} — ต้องไม่ใช่คนที่นับ`}</Line>
          {!permissions.canCount && <Line>ปุ่มจะขึ้นตรงนี้เมื่อมีคนนับแล้ว</Line>}
        </Step>
        <Step no={3} tone="idle" title="เงินถึงบริษัท">
          <Line>นำฝากธนาคาร (แนบสลิป) หรือเจ้าของเก็บไว้ = ถึงแล้ว · ตู้เซฟสาขา = รอบันทึกนำฝาก</Line>
        </Step>
      </div>
      {round.floatAmount === 0 && <Line>ยังไม่ได้ตั้งเงินทอนตั้งต้น (ตั้งได้ที่หน้าจัดการสาขา) — ระบบจะให้ส่งเงินทั้งหมดที่นับได้</Line>}
    </div>
  );
}

/** การนับหนึ่งครั้ง (รอยืนยัน หรือยืนยันแล้ว) — ขั้นที่ 1 จบแล้วเสมอ */
export function CloseSteps({ close, permissions, safeHolding, onConfirm, onDeposit }: {
  close: CashClose; permissions: CashCloseStatusResponse['permissions']; safeHolding: CashHolding | null;
  onConfirm: (close: CashClose) => void; onDeposit: (holding: CashHolding) => void;
}) {
  const confirmed = close.status === 'CONFIRMED';
  const isCounter = close.countedBy.id === permissions.viewerId;
  const canConfirmThis = permissions.canConfirm && !isCounter;
  const atBranch = close.moneyState === 'AT_BRANCH';
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Step no={1} tone="done" title="นับเงินแล้ว">
        <Line className="text-foreground">{close.countedBy.name} นับ {dayTimeOf(close.countedAt)}{close.attemptNo > 1 ? ` · นับครั้งที่ ${close.attemptNo}` : ''}</Line>
        <Line className="text-foreground tabular-nums">ต้องมี {baht(close.expectedAmount)} · นับได้ {baht(close.countedAmount)}</Line>
        <Line className="text-foreground"><span className={`font-semibold ${varianceTone(close.varianceAmount)}`}>{varianceLabel(close.varianceAmount)}</span>{close.varianceReason ? ` — “${close.varianceReason}”` : ''}</Line>
        <Line className="font-semibold text-foreground tabular-nums">แจ้งส่ง {baht(close.sendAmount)} (เหลือเงินทอน {baht(close.floatAmount)})</Line>
      </Step>

      {confirmed ? (
        <Step no={2} tone="done" title="ยืนยันรับเงินแล้ว">
          <Line className="text-foreground">{close.confirmedBy?.name ?? '-'} รับ {close.confirmedAt ? dayTimeOf(close.confirmedAt) : ''}</Line>
          <Line className="font-semibold text-foreground tabular-nums">รับจริง {baht(close.receivedAmount ?? 0)}</Line>
          {close.receiveVariance != null && toSatang(close.receiveVariance) !== 0 && (
            <Line className="text-destructive">ต่างจากยอดที่แจ้งส่ง {varianceLabel(close.receiveVariance)} — “{close.receiveNote}”</Line>
          )}
        </Step>
      ) : canConfirmThis ? (
        <Step no={2} tone="act" title="ยืนยันรับเงิน">
          <Line className="text-foreground">ถึงตาคุณ — นับเงินที่รับมาจริง แล้วเลือกว่านำเงินไปไว้ที่ไหน</Line>
          <Button variant="primary" size="md" onClick={() => onConfirm(close)}>ยืนยันรับเงิน {baht(close.sendAmount)}</Button>
        </Step>
      ) : (
        <Step no={2} tone="wait" title="รอยืนยันรับเงิน">
          <Line className="font-semibold text-foreground">
            {isCounter && permissions.canConfirm ? `คุณเป็นผู้นับ — ต้องให้${CONFIRMERS}คนอื่นเป็นผู้ยืนยัน` : `รอ${CONFIRMERS}ยืนยันรับเงิน`}
          </Line>
          <Line>ส่งเงิน {baht(close.sendAmount)} ให้ผู้รับ แล้วให้เขาเปิดหน้านี้กด “ยืนยันรับเงิน”</Line>
        </Step>
      )}

      {!confirmed ? (
        <Step no={3} tone="idle" title="เงินถึงบริษัท"><Line>ขึ้นกับปลายทางที่ผู้รับเลือกตอนยืนยัน</Line></Step>
      ) : atBranch ? (
        <Step no={3} tone="wait" title="เงินยังไม่ถึงบริษัท">
          <Line className="text-foreground">อยู่ในตู้เซฟสาขา {baht(close.receivedAmount ?? 0)} — นำไปฝากเมื่อไรให้บันทึกพร้อมสลิป</Line>
          {safeHolding?.canDeposit
            ? <Button variant="outline" size="md" onClick={() => onDeposit(safeHolding)}>บันทึกนำฝาก</Button>
            : <Line>รอ{CONFIRMERS}บันทึกนำฝาก</Line>}
        </Step>
      ) : (
        <Step no={3} tone="done" title="เงินถึงบริษัทแล้ว">
          <Line className="text-foreground">
            {close.destination ? DESTINATION_LABEL[close.destination] : 'ปิดยอดแล้ว'}{close.confirmedAt ? ` ${timeOf(close.confirmedAt)}` : ''}
            {close.destination === 'BRANCH_SAFE' && ' — นำฝากครบแล้ว'}
          </Line>
          {close.depositReference && <Line className="text-foreground">อ้างอิงสลิป {close.depositReference}</Line>}
          {close.hasDepositSlip && <Line><EvidenceImageLink path={`/shop-tenders/cash-close/${close.id}/deposit-slip`} title={`สลิปฝากเงิน ${close.branchName}`} /></Line>}
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
      <p className="text-sm font-semibold leading-snug text-warning">
        สาขานี้ยังปิดยอดไม่ได้ — เหลือ {missing} อย่างที่ต้องตั้งก่อน{owner ? '' : ' · แจ้งเจ้าของให้ตั้งค่า'}
      </p>
      <ul className="space-y-2">
        {readiness.hasDrawerAccount
          ? <Item state="ok" title="ตั้งลิ้นชักเงินสดของสาขาแล้ว" hint="หน้าขายรับเงินสดได้ และยอดจะขึ้นในกล่องนี้" />
          : <Item state="missing" title="ยังไม่ได้ตั้งลิ้นชักเงินสดของสาขา" hint="ยังไม่ตั้ง = หน้าขายรับเงินสดไม่ได้ จึงไม่มีเงินให้นับ" action={link('/branches', 'ไปตั้งค่าสาขา')} />}
        {readiness.floatAmount > 0
          ? <Item state="ok" title={`เงินทอนตั้งต้น ${baht(readiness.floatAmount)}`} hint="ปิดยอดแล้วเหลือเงินก้อนนี้ไว้ในลิ้นชัก ที่เหลือส่งทั้งหมด" />
          : <Item state="optional" title="เงินทอนตั้งต้นยังเป็น 0.00" hint="ไม่บังคับ — ถ้าเป็น 0 ระบบจะให้ส่งเงินทั้งหมดที่นับได้ ไม่เหลือเงินทอนในลิ้นชัก" action={link('/branches', 'ไปตั้งค่าสาขา')} />}
        {readiness.counters.length > 0
          ? <Item state="ok" title={`มีคนที่นับเงินได้ ${readiness.counters.length} คน: ${counterNames(readiness)}`} hint="ผู้นับ = พนักงานขายหรือผู้จัดการสาขาของสาขานี้ (บัญชีเจ้าของนับเองไม่ได้)" action={link('/users/new', 'เพิ่มพนักงาน')} />
          : <Item state="missing" title="ยังไม่มีบัญชีที่นับเงินได้ของสาขานี้" hint="ต้องมีบัญชีพนักงานขายหรือผู้จัดการสาขาที่ผูกกับสาขานี้ — บัญชีเจ้าของนับเองไม่ได้" action={link('/users/new', 'เพิ่มพนักงาน')} />}
      </ul>
    </div>
  );
}
