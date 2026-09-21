import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { EvidenceImageLink } from './EvidenceImage';
import {
  baht, dayTimeOf, DESTINATION_LABEL, STATUS_LABEL, toSatang, varianceLabel, varianceTone,
  type CashClose, type CashCloseHistoryResponse, type CashCloseStatus,
} from './cash-close';

/** ประวัติการปิดยอด + แถบเตือนเจ้าของ (mockup CnXmYLkT กระดาน 9) — แท็บที่สองของหน้าสรุปเงินรายวัน */

const STATUS_TONE: Record<CashCloseStatus, string> = {
  CONFIRMED: 'bg-primary/10 text-primary',
  PENDING_CONFIRM: 'bg-warning/10 text-warning',
  SENT_BACK: 'bg-muted text-muted-foreground',
};

const thisMonth = () => new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 7);
const thaiDate = (date: string) => new Date(`${date}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });

export default function CashCloseHistory({ branchId, branches }: { branchId: string; branches: { id: string; name: string }[] }) {
  const [month, setMonth] = useState(thisMonth);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useQuery<CashCloseHistoryResponse>({
    queryKey: ['shop-tenders', 'cash-close', 'history', branchId, month],
    queryFn: async () => (await api.get('/shop-tenders/cash-close/history', { params: { branchId: branchId || undefined, month } })).data,
  });
  const data = query.data;
  const alerts = data?.alerts;
  const hasAlerts = !!alerts && (alerts.unclosedYesterday.length > 0 || alerts.monthShortage.length > 0 || alerts.awaitingOverOneDay.length > 0);
  const showBranch = !branchId && branches.length !== 1;

  return (
    <div className="space-y-4">
      <div className="sm:w-48">
        <label htmlFor="cash-close-month" className="mb-1 block text-xs text-muted-foreground leading-snug">เดือน</label>
        <input id="cash-close-month" type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)}
          className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" />
      </div>

      <QueryBoundary isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={query.refetch}>
        {data && (
          <div className="space-y-4">
            {hasAlerts && (
              <div role="alert" className="space-y-1 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-snug text-destructive">
                {alerts.unclosedYesterday.map((row) => (
                  <div key={row.branchId}><span className="font-semibold">{row.branchName} ยังไม่ปิดยอดของวันที่ {thaiDate(row.date)}</span> — มีเงินสดรับ {baht(row.cashIn)} ฿ ที่ยังไม่ได้นับ</div>
                ))}
                {alerts.awaitingOverOneDay.map((row) => (
                  <div key={row.id}><span className="font-semibold">{row.branchName} มียอดที่รอยืนยันรับเงินเกิน 1 วัน</span> — นับเมื่อ {dayTimeOf(row.countedAt)} ส่งเงิน {baht(row.sendAmount)} ฿</div>
                ))}
                {alerts.monthShortage.length > 0 && (
                  <div>
                    <span className="font-semibold">
                      เดือนนี้เงินขาดสะสม {baht(alerts.monthShortage.reduce((sum, row) => sum + toSatang(row.amount), 0) / 100)} ฿ จาก {alerts.monthShortage.reduce((sum, row) => sum + row.count, 0)} ครั้ง
                    </span>{' '}— {alerts.monthShortage.map((row) => `${row.branchName} ${row.count} ครั้ง`).join(' · ')}
                  </div>
                )}
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-[860px] text-sm leading-snug">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">วันที่ปิด</th>
                    {showBranch && <th className="px-3 py-3 font-medium">สาขา</th>}
                    <th className="px-3 py-3 text-right font-medium">ต้องมี</th>
                    <th className="px-3 py-3 text-right font-medium">นับได้</th>
                    <th className="px-3 py-3 text-right font-medium">ส่วนต่าง</th>
                    <th className="px-3 py-3 text-right font-medium">รับเงินจริง</th>
                    <th className="px-3 py-3 font-medium">ผู้ส่งยอด</th>
                    <th className="px-3 py-3 font-medium">ผู้รับ</th>
                    <th className="px-4 py-3 font-medium">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 && (
                    <tr><td colSpan={showBranch ? 9 : 8} className="px-4 py-10 text-center text-muted-foreground">เดือนนี้ยังไม่มีการปิดยอด</td></tr>
                  )}
                  {data.rows.map((row) => (
                    <Fragment key={row.id}>
                      <tr className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-accent/50"
                        onClick={() => setOpenId(openId === row.id ? null : row.id)} aria-expanded={openId === row.id}>
                        <td className="px-4 py-3 tabular-nums">{dayTimeOf(row.countedAt)}</td>
                        {showBranch && <td className="px-3 py-3">{row.branchName}</td>}
                        <td className="px-3 py-3 text-right tabular-nums">{baht(row.expectedAmount)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{baht(row.countedAmount)}</td>
                        <td className={`px-3 py-3 text-right font-semibold tabular-nums ${varianceTone(row.varianceAmount)}`}>{varianceLabel(row.varianceAmount)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{row.receivedAmount == null ? <span className="text-muted-foreground">—</span> : baht(row.receivedAmount)}</td>
                        <td className="px-3 py-3">{row.countedBy.name}</td>
                        <td className="px-3 py-3">{row.confirmedBy?.name ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold leading-snug ${STATUS_TONE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                          {row.status === 'CONFIRMED' && (
                            <div className={`mt-0.5 text-xs ${row.moneyState === 'AT_BRANCH' ? 'font-semibold text-warning' : 'text-muted-foreground'}`}>
                              {row.moneyState === 'AT_BRANCH' ? 'เงินยังอยู่ที่สาขา' : 'เงินถึงบริษัทแล้ว'}
                            </div>
                          )}
                          {row.attemptNo > 1 && <div className="mt-0.5 text-xs text-muted-foreground">นับครั้งที่ {row.attemptNo}</div>}
                        </td>
                      </tr>
                      {openId === row.id && (
                        <tr className="border-b border-border/60 bg-muted/40 last:border-0">
                          <td colSpan={showBranch ? 9 : 8} className="px-4 py-3"><CloseDetail close={row} /></td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">กดแถว = เปิดรายละเอียดการปิดยอดครั้งนั้น · ระบบลงบัญชีให้ตอนยืนยันรับเงิน: ย้ายเงินออกจากลิ้นชักไปปลายทางที่เลือก และเงินขาด/เกินเข้าบัญชี “เงินขาด-เกินบัญชี”</p>

            {data.deposits.length > 0 && (
              <section className="rounded-xl border border-border bg-card" aria-label="รายการนำฝากของเดือน">
                <h2 className="border-b border-border px-4 py-3 text-[15px] font-semibold leading-snug">รายการนำฝากของเดือน (เงินจากตู้เซฟสาขา / เงินที่เจ้าของเก็บไว้)</h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm leading-snug">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="px-4 py-3 font-medium">วันที่ฝาก</th>
                        {showBranch && <th className="px-3 py-3 font-medium">สาขา</th>}
                        <th className="px-3 py-3 font-medium">ที่มาของเงิน</th>
                        <th className="px-3 py-3 text-right font-medium">ยอดนำฝาก</th>
                        <th className="px-3 py-3 font-medium">เลขอ้างอิง</th>
                        <th className="px-3 py-3 font-medium">ผู้บันทึก</th>
                        <th className="px-4 py-3 font-medium">หลักฐาน</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.deposits.map((row) => (
                        <tr key={row.id} className="border-b border-border/60 last:border-0">
                          <td className="px-4 py-3 tabular-nums">{dayTimeOf(row.depositedAt)}</td>
                          {showBranch && <td className="px-3 py-3">{row.branchName}</td>}
                          <td className="px-3 py-3">{row.sourceLabel}</td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums">{baht(row.amount)}</td>
                          <td className="px-3 py-3">{row.reference}</td>
                          <td className="px-3 py-3">{row.depositedBy.name}</td>
                          <td className="px-4 py-3">
                            <EvidenceImageLink path={`/shop-tenders/cash-deposits/${row.id}/slip`} title={`สลิปนำฝาก ${row.branchName}`} />
                            {!row.journalPosted && <div className="mt-0.5 text-xs text-muted-foreground">ไม่ได้ลงบัญชี</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}

function CloseDetail({ close }: { close: CashClose }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs leading-snug sm:grid-cols-2">
      <div><dt className="inline text-muted-foreground">รอบ: </dt><dd className="inline">{close.periodStart ? `หลัง ${dayTimeOf(close.periodStart)}` : 'ตั้งแต่เริ่มใช้สมุดเงิน'} ถึง {dayTimeOf(close.countedAt)}</dd></div>
      <div><dt className="inline text-muted-foreground">เงินทอนตั้งต้น / รับสด / จ่ายสด: </dt><dd className="inline tabular-nums">{baht(close.floatAmount)} / {baht(close.cashIn)} / {baht(close.cashOut)}</dd></div>
      <div><dt className="inline text-muted-foreground">เงินที่แจ้งส่ง: </dt><dd className="inline tabular-nums">{baht(close.sendAmount)}</dd></div>
      {close.varianceReason && <div><dt className="inline text-muted-foreground">เหตุผลส่วนต่าง: </dt><dd className="inline">{close.varianceReason}</dd></div>}
      {close.destination && <div><dt className="inline text-muted-foreground">นำเงินไปไว้ที่: </dt><dd className="inline">{DESTINATION_LABEL[close.destination]}</dd></div>}
      {(close.depositReference || close.hasDepositSlip) && (
        <div><dt className="inline text-muted-foreground">สลิปฝากเงิน: </dt><dd className="inline">
          {close.depositReference ? `อ้างอิง ${close.depositReference}` : ''}{close.depositReference && close.hasDepositSlip ? ' · ' : ''}
          {close.hasDepositSlip && <EvidenceImageLink path={`/shop-tenders/cash-close/${close.id}/deposit-slip`} title={`สลิปฝากเงิน ${close.branchName}`} />}
        </dd></div>
      )}
      {close.receiveVariance != null && toSatang(close.receiveVariance) !== 0 && (
        <div className="text-destructive"><dt className="inline">รับจริงต่างจากที่แจ้งส่ง: </dt><dd className="inline">{varianceLabel(close.receiveVariance)} — {close.receiveNote}</dd></div>
      )}
      {close.status === 'CONFIRMED' && (
        <div><dt className="inline text-muted-foreground">ลงบัญชี: </dt><dd className="inline">{close.journalPosted ? 'ลงแล้ว' : 'ไม่ได้ลง — ไม่มียอดให้ลง หรือสาขายังไม่ตั้งลิ้นชักเงินสด'}</dd></div>
      )}
      {close.status === 'SENT_BACK' && (
        <div><dt className="inline text-muted-foreground">ตีกลับโดย: </dt><dd className="inline">{close.sentBackBy?.name ?? '-'} {close.sentBackAt ? dayTimeOf(close.sentBackAt) : ''} — {close.sentBackReason}</dd></div>
      )}
    </dl>
  );
}
