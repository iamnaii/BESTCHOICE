import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import CashCloseConfirmDialog from './CashCloseConfirmDialog';
import CashDepositDialog from './CashDepositDialog';
import { EvidenceImageLink } from './EvidenceImage';
import {
  baht, DAY_STATE_BADGE, DAY_STATE_CELL, DAY_STATE_LABEL, daysSince, DESTINATION_LABEL, thaiShortDate, timeOf, varianceLabel, varianceTone,
  type CashClose, type CashCloseDayState, type CashCloseOverviewResponse, type CashCloseOverviewRow, type CashHolding,
} from './cash-close';

/**
 * มุมมองเจ้าของ (mockup CnXmYLkT กระดาน 10): ตารางสถานะปิดยอดของวัน (ทุกสาขา) + แถบ 14 วัน "ปิดยอดครบทุกวันไหม" +
 * เงินที่รับจากพนักงานแล้วแต่ยังไม่ถึงบริษัท. เมื่อเลือกสาขาเดียว หน้าแสดงกล่องปิดยอดของสาขาแทนตาราง (`showTable = false`)
 */
export const cashCloseOverviewKey = (date: string, branchId: string) => ['shop-tenders', 'cash-close', 'overview', date, branchId];

const LEGEND: { state: CashCloseDayState; label: string }[] = [
  { state: 'REACHED', label: 'ถึงบริษัทแล้ว' },
  { state: 'AWAITING_CONFIRM', label: 'รอยืนยัน / ยังอยู่ที่สาขา' },
  { state: 'MISSED', label: 'มีเงินสดแต่ไม่ปิดยอด' },
  { state: 'NOT_COUNTED', label: 'วันนี้ยังไม่นับ' },
  { state: 'NO_CASH', label: 'ไม่มีเงินสด' },
];

interface Props {
  date: string;
  branchId: string;
  showTable: boolean;
  /** เปิดสาขา (และวันที่) นั้นในหน้าเดียวกัน — กดแถวของตารางหรือช่องของแถบ 14 วัน */
  onOpen: (branchId: string, date?: string) => void;
}

export default function CashCloseOverview({ date, branchId, showTable, onOpen }: Props) {
  const [deciding, setDeciding] = useState<CashClose | null>(null);
  const [depositing, setDepositing] = useState<CashHolding | null>(null);
  const query = useQuery<CashCloseOverviewResponse>({
    queryKey: cashCloseOverviewKey(date, branchId),
    queryFn: async () => (await api.get('/shop-tenders/cash-close/overview', { params: { date, branchId: branchId || undefined } })).data,
  });
  const data = query.data;

  if (query.isLoading) return <div className="h-40 animate-pulse rounded-xl border border-border bg-card" />;
  if (query.isError || !data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-snug text-destructive">
        โหลดสถานะปิดยอดไม่สำเร็จ: {getErrorMessage(query.error)}{' '}
        <button type="button" className="underline" onClick={() => query.refetch()}>ลองอีกครั้ง</button>
      </div>
    );
  }

  const { summary } = data;
  const notReached = data.holdings.filter((row) => !row.reachedCompany);
  const ownerHeld = data.holdings.filter((row) => row.reachedCompany);

  return (
    <div className="space-y-5">
      {showTable && (
        <section className="rounded-xl border border-border bg-card" aria-label="สถานะปิดยอดของวัน">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
            <h2 className="text-[15px] font-semibold leading-snug">ปิดยอดประจำวัน · {thaiShortDate(data.date)}</h2>
            <span className="text-xs text-muted-foreground leading-snug">
              ถึงบริษัทแล้ว {summary.reached} สาขา · ยังอยู่ที่สาขา {summary.atBranch} · รอยืนยันรับเงิน {summary.awaitingConfirm} · ยังไม่นับ {summary.notCounted} · ไม่มีเงินสด {summary.noCash}
            </span>
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm leading-snug">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-normal">สาขา</th>
                  <th className="px-3 py-3 text-right font-normal">ต้องมีในลิ้นชัก</th>
                  <th className="px-3 py-3 text-right font-normal">นับได้</th>
                  <th className="px-3 py-3 text-right font-normal">ส่วนต่าง</th>
                  <th className="px-3 py-3 text-right font-normal">ส่งเข้าบริษัท</th>
                  <th className="px-3 py-3 font-normal">สถานะ</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.branchId} className={`border-b border-border/60 last:border-0 ${isAlarm(row.state) ? 'bg-destructive/5' : ''}`}>
                    <td className="px-5 py-3 font-semibold">{row.branchName}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(expectedOf(row))}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(row.close?.countedAmount)}</td>
                    <td className={`px-3 py-3 text-right font-semibold tabular-nums ${row.close ? varianceTone(row.close.varianceAmount) : ''}`}>
                      {row.close ? varianceLabel(row.close.varianceAmount) : <Dash />}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums"><SentCell row={row} /></td>
                    <td className="px-3 py-3"><StateCell row={row} /></td>
                    <td className="px-5 py-3 text-right"><RowAction row={row} onConfirm={setDeciding} onOpen={onOpen} date={data.date} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 p-4 md:hidden">
            {data.rows.map((row) => (
              <div key={row.branchId} className={`rounded-lg border border-border p-3 text-sm leading-snug ${isAlarm(row.state) ? 'bg-destructive/5' : ''}`}>
                <div className="flex items-baseline justify-between gap-2"><span className="font-semibold">{row.branchName}</span><span className="tabular-nums text-muted-foreground">ต้องมี {money(expectedOf(row))}</span></div>
                <div className="mt-1.5"><StateCell row={row} /></div>
                {row.close && (
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">นับได้</dt><dd className="text-right tabular-nums">{baht(row.close.countedAmount)}</dd>
                    <dt className="text-muted-foreground">ส่วนต่าง</dt><dd className={`text-right font-semibold tabular-nums ${varianceTone(row.close.varianceAmount)}`}>{varianceLabel(row.close.varianceAmount)}</dd>
                    <dt className="text-muted-foreground">ส่งเข้าบริษัท</dt><dd className="text-right tabular-nums"><SentCell row={row} /></dd>
                  </dl>
                )}
                <div className="mt-3"><RowAction row={row} onConfirm={setDeciding} onOpen={onOpen} date={data.date} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-card" aria-label="ปิดยอดครบทุกวันไหม">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
          <h2 className="text-[15px] font-semibold leading-snug">ปิดยอดครบทุกวันไหม · {data.strip.dates.length} วันล่าสุด</h2>
          <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-foreground leading-snug">
            {LEGEND.map((item) => (
              <li key={item.state} className="inline-flex items-center gap-1.5"><span aria-hidden className={`inline-block h-3 w-3 rounded-[3px] ${DAY_STATE_CELL[item.state]}`} />{item.label}</li>
            ))}
          </ul>
        </div>
        <div className="space-y-2.5 px-4 py-4 sm:px-5">
          <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1 text-center text-[11px] text-muted-foreground sm:grid-cols-[110px_repeat(14,minmax(0,1fr))] sm:gap-1.5">
            <span className="hidden sm:block" />
            {data.strip.dates.map((day) => <span key={day} className={day === data.today ? 'font-bold text-foreground' : ''}>{Number(day.slice(8))}</span>)}
          </div>
          {data.strip.rows.map((row) => (
            <div key={row.branchId} className="grid grid-cols-[repeat(14,minmax(0,1fr))] items-center gap-1 sm:grid-cols-[110px_repeat(14,minmax(0,1fr))] sm:gap-1.5">
              <span className="col-span-full truncate text-sm font-semibold leading-snug sm:col-span-1">{row.branchName}</span>
              {row.cells.map((state, index) => {
                const day = data.strip.dates[index];
                return (
                  <button key={day} type="button" onClick={() => onOpen(row.branchId, day)}
                    title={`${row.branchName} · ${thaiShortDate(day)} · ${DAY_STATE_LABEL[state]}`}
                    aria-label={`${row.branchName} ${thaiShortDate(day)} ${DAY_STATE_LABEL[state]}`}
                    className={`h-7 rounded-md outline-offset-2 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${DAY_STATE_CELL[state]}`} />
                );
              })}
            </div>
          ))}
          <p className="text-xs text-muted-foreground leading-snug">
            กดช่อง = เปิดวันนั้นของสาขานั้น · สีแดง = สิ้นวันยังมีเงินสดรับที่ไม่มีใครนับ (เงินจะไปรวมกับการนับครั้งถัดไป แต่ช่องยังแดงเป็นประวัติ)
          </p>
        </div>
      </section>

      {notReached.length > 0 && (
        <section className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3.5 sm:px-5" aria-label="เงินที่ยังไม่ถึงบริษัท">
          <h2 className="text-[15px] font-semibold leading-snug text-foreground">
            เงินที่รับจากพนักงานแล้ว แต่ยังไม่ถึงบริษัท · รวม {baht(notReached.reduce((sum, row) => sum + row.outstanding, 0))} ฿
          </h2>
          {notReached.map((row) => <HoldingRow key={`${row.branchId}-${row.source}`} holding={row} onDeposit={setDepositing} />)}
        </section>
      )}
      {ownerHeld.length > 0 && (
        <section className="space-y-2 rounded-xl border border-border bg-card px-4 py-3.5 sm:px-5" aria-label="เงินที่เจ้าของเก็บไว้">
          <h2 className="text-[15px] font-semibold leading-snug">เงินที่เจ้าของเก็บไว้ ยังไม่ได้นำฝากธนาคาร · รวม {baht(ownerHeld.reduce((sum, row) => sum + row.outstanding, 0))} ฿</h2>
          {ownerHeld.map((row) => <HoldingRow key={`${row.branchId}-${row.source}`} holding={row} onDeposit={setDepositing} />)}
        </section>
      )}

      {deciding && <CashCloseConfirmDialog close={deciding} viewerRole={data.viewerRole} onClose={() => setDeciding(null)} />}
      {depositing && <CashDepositDialog holding={depositing} onClose={() => setDepositing(null)} />}
    </div>
  );
}

const Dash = () => <span className="text-muted-foreground">—</span>;
const money = (value: number | null | undefined) => (value == null ? <Dash /> : baht(value));
const isAlarm = (state: CashCloseDayState) => state === 'NOT_COUNTED' || state === 'MISSED';
const expectedOf = (row: CashCloseOverviewRow) => row.close?.expectedAmount ?? row.round?.expectedAmount ?? null;

function SentCell({ row }: { row: CashCloseOverviewRow }) {
  const close = row.close;
  if (!close) return <Dash />;
  if (close.moneyState === 'AWAITING_CONFIRM') return <span className="text-muted-foreground">แจ้งส่ง {baht(close.sendAmount)}</span>;
  if (close.moneyState === 'AT_BRANCH') return <span className="text-muted-foreground">อยู่ที่สาขา {baht(close.receivedAmount ?? 0)}</span>;
  return <span className="font-semibold">{baht(close.receivedAmount ?? 0)}</span>;
}

function StateCell({ row }: { row: CashCloseOverviewRow }) {
  const close = row.close;
  return (
    <div className="flex flex-col items-start gap-1">
      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold leading-snug ${DAY_STATE_BADGE[row.state]}`}>{DAY_STATE_LABEL[row.state]}</span>
      <span className={`text-xs leading-snug ${isAlarm(row.state) ? 'text-destructive' : 'text-muted-foreground'}`}>
        {close && close.moneyState === 'AWAITING_CONFIRM' && <>นับ {close.countedBy.name} {timeOf(close.countedAt)}</>}
        {close && close.moneyState !== 'AWAITING_CONFIRM' && (
          <>
            {close.destination ? DESTINATION_LABEL[close.destination] : 'ปิดยอดแล้ว'}{close.confirmedAt ? ` ${timeOf(close.confirmedAt)}` : ''} · นับ {close.countedBy.name} · รับ {close.confirmedBy?.name ?? '-'}
            {close.moneyState === 'AT_BRANCH' && ' — รอบันทึกนำฝาก'}
            {close.hasDepositSlip && <> · <EvidenceImageLink path={`/shop-tenders/cash-close/${close.id}/deposit-slip`} title={`สลิปฝากเงิน ${close.branchName}`} label="มีสลิป" /></>}
          </>
        )}
        {!close && row.state === 'NOT_COUNTED' && (
          <>มีเงินสดรับ {baht(row.round?.cashIn ?? row.dayCashIn)} {row.round?.periodStart ? 'ตั้งแต่ปิดยอดครั้งก่อน' : 'ที่ยังไม่เคยถูกนับ'}{row.lastCashInAt ? ` · รายการล่าสุด ${timeOf(row.lastCashInAt)}` : ''}</>
        )}
        {!close && row.state === 'MISSED' && (row.dayCashIn > 0 ? <>วันนั้นรับเงินสด {baht(row.dayCashIn)} · ไม่มีการนับปิดยอด</> : <>มีเงินสดค้างจากวันก่อนหน้าที่ยังไม่มีใครนับ</>)}
        {!close && row.state === 'NO_CASH' && <>ไม่มีเงินสดรับที่ต้องปิดยอด</>}
        {row.closeCount > 1 && <> · ปิดยอด {row.closeCount} ครั้งในวันนี้</>}
      </span>
    </div>
  );
}

function RowAction({ row, date, onConfirm, onOpen }: { row: CashCloseOverviewRow; date: string; onConfirm: (close: CashClose) => void; onOpen: Props['onOpen'] }) {
  if (row.canConfirm && row.close) return <Button variant="primary" size="md" onClick={() => onConfirm(row.close!)}>ยืนยันรับเงิน</Button>;
  if (row.state === 'NO_CASH') return null;
  return <Button variant="ghost" size="md" className="text-primary" onClick={() => onOpen(row.branchId, date)}>{row.close ? 'ดูรายละเอียด' : 'เปิดสาขานี้'}</Button>;
}

function HoldingRow({ holding, onDeposit }: { holding: CashHolding; onDeposit: (holding: CashHolding) => void }) {
  const age = holding.oldestConfirmedAt ? daysSince(holding.oldestConfirmedAt) : 0;
  return (
    <div className="grid grid-cols-2 items-center gap-x-3 gap-y-1 text-sm leading-snug sm:grid-cols-[110px_130px_120px_minmax(0,1fr)_auto]">
      <span className="font-semibold">{holding.branchName}</span>
      <span>{holding.sourceLabel}</span>
      <span className="font-semibold tabular-nums sm:text-right">{baht(holding.outstanding)}</span>
      <span className="col-span-2 text-xs text-muted-foreground sm:col-span-1">
        จากการปิดยอด {holding.closeCount} ครั้ง{age > 0 ? ` · เก่าสุดค้างมา ${age} วัน` : ' · รับวันนี้'}
      </span>
      <span className="col-span-2 sm:col-span-1 sm:text-right">
        {holding.canDeposit
          ? <Button variant="outline" size="md" onClick={() => onDeposit(holding)}>บันทึกนำฝาก</Button>
          : <span className="text-xs text-muted-foreground">รอเจ้าของหรือผู้จัดการการเงินบันทึกนำฝาก</span>}
      </span>
    </div>
  );
}
