import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { tenderMethodLabel } from '@/components/tender/tender-utils';
import { useAuth } from '@/contexts/AuthContext';
import CashCloseCard, { cashCloseKey } from './shop-daily-cash/CashCloseCard';
import CashCloseHistory from './shop-daily-cash/CashCloseHistory';
import { latestEffectiveClose, varianceLabel, type CashCloseStatusResponse } from './shop-daily-cash/cash-close';

/** สรุปเงินหน้าร้านรายวัน (mockup CnXmYLkT กระดาน 1-3, 5) — อ่านจาก GET /shop-tenders/daily-summary */

type Scope = 'ALL' | 'BRANCH' | 'OWN';
type Kind =
  | 'CASH_SALE' | 'EXTERNAL_FINANCE_DOWN' | 'CONTRACT_DOWN' | 'BOOKING_DEPOSIT'
  | 'TRADE_IN_PAYOUT' | 'SALE_VOID_REFUND' | 'CONTRACT_DOWN_REFUND' | 'BOOKING_DEPOSIT_REFUND';

interface SummaryRow {
  id: string; occurredAt: string; kind: Kind; direction: 'IN' | 'OUT';
  docType: 'sale' | 'contract' | 'booking' | 'tradeIn'; docId: string; docNumber: string;
  customerName: string | null; method: string; reference: string | null; amount: string;
  seq: number; seqTotal: number; actorId: string; actorName: string; branchName: string; duplicateReference: boolean;
}
interface DailySummary {
  date: string; scope: Scope; branchId: string | null; branches: { id: string; name: string }[];
  totals: { cashIn: string; transferIn: string; qrIn: string; totalIn: string; cashOut: string; nonCashOut: string;
    totalOut: string; expectedCashInDrawer: string; inCount: number; outCount: number };
  byStaff: { actorId: string; name: string; cashIn: string; transferIn: string; qrIn: string; cashOut: string; nonCashOut: string; netCash: string; count: number }[];
  byKind: { kind: Kind; direction: 'IN' | 'OUT'; cash: string; transfer: string; qr: string; total: string; count: number }[];
  rows: SummaryRow[];
  duplicateReferences: { reference: string; documents: string[] }[];
}

const KIND_LABEL: Record<Kind, string> = {
  CONTRACT_DOWN: 'เงินดาวน์สัญญาผ่อน',
  CASH_SALE: 'ขายเงินสด',
  EXTERNAL_FINANCE_DOWN: 'เงินดาวน์ไฟแนนซ์นอก',
  BOOKING_DEPOSIT: 'มัดจำใบจอง',
  TRADE_IN_PAYOUT: 'จ่ายรับซื้อมือสอง',
  SALE_VOID_REFUND: 'คืนเงิน ยกเลิกใบขาย',
  CONTRACT_DOWN_REFUND: 'คืนเงินดาวน์ ลบร่างสัญญา',
  BOOKING_DEPOSIT_REFUND: 'คืนมัดจำ ยกเลิกใบจอง',
};

const DOC_PATH: Record<SummaryRow['docType'], (id: string) => string> = {
  sale: () => '/sales',
  contract: (id) => `/contracts/${id}`,
  booking: () => '/bookings',
  tradeIn: () => '/trade-in',
};

const baht = (value: string | number) =>
  Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dash = (value: string) => (Number(value) === 0 ? '—' : baht(value));
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' });
const todayBangkok = () => new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

type RowFilter = 'ALL' | 'CASH' | 'NON_CASH' | 'OUT';

function MethodBadge({ method }: { method: string }) {
  const tone = method === 'CASH' ? 'bg-warning/10 text-warning' : method === 'QR_EWALLET' ? 'bg-muted text-foreground' : 'bg-primary/10 text-primary';
  const label = method === 'CASH' ? 'เงินสด' : method === 'QR_EWALLET' ? 'QR' : 'โอน';
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold leading-snug ${tone}`} title={tenderMethodLabel(method)}>{label}</span>;
}

function DuplicateBadge() {
  return <span className="inline-block rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold leading-snug text-destructive">เลขอ้างอิงซ้ำ</span>;
}

export default function ShopDailyCashPage() {
  useDocumentTitle('สรุปเงินรายวัน');
  const [date, setDate] = useState(todayBangkok);
  const [branchId, setBranchId] = useState('');
  const [filter, setFilter] = useState<RowFilter>('ALL');

  const query = useQuery<DailySummary>({
    queryKey: ['shop-tenders', 'daily-summary', date, branchId],
    queryFn: async () => (await api.get('/shop-tenders/daily-summary', { params: { date, branchId: branchId || undefined } })).data,
  });
  const data = query.data;
  const own = data?.scope === 'OWN';

  // กล่องปิดยอดผูกกับ "สาขาเดียว": เจ้าของ/การเงิน/บัญชี = สาขาที่เลือก · ผจก.สาขา = สาขาตัวเอง · พนักงานขาย = สาขาที่สังกัด
  const { user } = useAuth();
  const [tab, setTab] = useState<'DAILY' | 'HISTORY'>('DAILY');
  const closeBranchId = data?.scope === 'ALL' ? branchId : data?.scope === 'BRANCH' ? (data.branchId ?? '') : (user?.branchId ?? '');
  const isToday = date === todayBangkok();
  // key เดียวกับ CashCloseCard ⇒ React Query ยิงครั้งเดียว — ใช้หาขอบ "หลังปิดยอด" ของตารางรายการ
  const closeStatus = useQuery<CashCloseStatusResponse>({
    queryKey: cashCloseKey(closeBranchId, date),
    queryFn: async () => (await api.get('/shop-tenders/cash-close/status', { params: { branchId: closeBranchId, date } })).data,
    enabled: !!closeBranchId,
  });
  const cutoff = closeBranchId ? latestEffectiveClose(closeStatus.data?.closes ?? []) : null;
  const isAfterClose = (occurredAt: string) => !!cutoff && new Date(occurredAt).getTime() > new Date(cutoff.countedAt).getTime();

  const rows = useMemo(() => (data?.rows ?? []).filter((r) =>
    filter === 'ALL' ? true
      : filter === 'OUT' ? r.direction === 'OUT'
        : filter === 'CASH' ? r.direction === 'IN' && r.method === 'CASH'
          : r.direction === 'IN' && r.method !== 'CASH'), [data, filter]);

  const counts = useMemo(() => {
    const all = data?.rows ?? [];
    return {
      ALL: all.length,
      CASH: all.filter((r) => r.direction === 'IN' && r.method === 'CASH').length,
      NON_CASH: all.filter((r) => r.direction === 'IN' && r.method !== 'CASH').length,
      OUT: all.filter((r) => r.direction === 'OUT').length,
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <PageHeader title="สรุปเงินหน้าร้านรายวัน"
        subtitle={own ? 'ยอดที่ฉันรับและจ่ายในวันนี้' : 'เงินที่รับและจ่ายจริงที่หน้าร้าน แยกวิธีรับและผู้รับ'} />

      <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end">
        {/* แท็บประวัติเลือกเป็นเดือนของตัวเอง — วันที่ใช้เฉพาะแท็บสรุปรายวัน */}
        <div className={`sm:w-48 ${tab === 'HISTORY' && !own ? 'hidden' : ''}`}>
          <span className="mb-1 block text-xs text-muted-foreground leading-snug">วันที่</span>
          <ThaiDateInput value={date} max={todayBangkok()} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-11 w-full" />
        </div>
        {data?.scope === 'ALL' && (
          <div className="sm:w-56">
            <label htmlFor="daily-cash-branch" className="mb-1 block text-xs text-muted-foreground leading-snug">สาขา</label>
            <select id="daily-cash-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm">
              <option value="">ทุกสาขา</option>
              {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {data && !own && (
        <div role="tablist" aria-label="มุมมองของหน้าสรุปเงิน" className="flex gap-2">
          {([['DAILY', 'สรุปรายวัน'], ['HISTORY', 'ประวัติการปิดยอด']] as const).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
              className={`min-h-11 rounded-full border px-4 text-sm leading-snug ${tab === key ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-border bg-card text-foreground hover:bg-accent'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === 'HISTORY' && data && !own && <CashCloseHistory branchId={closeBranchId} branches={data.branches} />}

      {(tab === 'DAILY' || own) && (
      <QueryBoundary isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={query.refetch}>
        {data && (
          <div className="space-y-5">
            {closeBranchId
              ? <CashCloseCard branchId={closeBranchId} date={date} isToday={isToday} />
              : data.scope === 'ALL' && (
                <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground leading-snug">
                  เลือกสาขาเดียวเพื่อดูกล่องปิดยอดของสาขานั้น (ยอดที่ต้องมีในลิ้นชัก · นับเงิน · ยืนยันรับเงิน)
                </p>
              )}

            {own && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-snug text-foreground">
                คุณเห็นเฉพาะรายการที่คุณเป็นผู้รับหรือผู้จ่ายเงิน — ใช้ตรวจยอดของตัวเองก่อนส่งเงินให้ผู้จัดการ
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-primary px-5 py-4 text-primary-foreground sm:col-span-2 lg:col-span-1">
                <div className="text-sm font-medium leading-snug">{own ? 'เงินสดที่ฉันต้องส่งวันนี้' : 'เงินสดที่ต้องมีในลิ้นชัก'}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{baht(data.totals.expectedCashInDrawer)} ฿</div>
                <div className="mt-1 text-xs leading-snug">รับเงินสด {baht(data.totals.cashIn)} − จ่ายเงินสดออก {baht(data.totals.cashOut)}</div>
              </div>
              <StatCard label="รับโอน" value={data.totals.transferIn} hint="เข้าบัญชีร้านโดยตรง เทียบกับสเตทเมนต์" />
              <StatCard label="รับ QR / e-Wallet" value={data.totals.qrIn} hint="เข้าบัญชีร้านโดยตรง เทียบกับสเตทเมนต์" />
              <StatCard label="จ่ายออกทั้งหมด" value={data.totals.totalOut} negative hint={`${data.totals.outCount} รายการ · รับเข้า ${data.totals.inCount} รายการ`} />
            </div>

            {data.duplicateReferences.length > 0 && (
              <div role="alert" className="space-y-1 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-snug text-foreground">
                {data.duplicateReferences.map((d) => (
                  <p key={d.reference}>
                    <span className="font-semibold">เลขอ้างอิง {d.reference} ถูกใช้กับ {d.documents.length} บิล</span>
                    {' — '}{d.documents.join(' และ ')} ตรวจสเตทเมนต์ว่าเงินเข้าจริงครบทุกยอดหรือไม่
                  </p>
                ))}
              </div>
            )}

            {!own && data.byStaff.length > 0 && (
              <Section title="แยกตามพนักงาน (ผู้รับ / ผู้จ่ายเงิน)">
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="py-2 text-left font-normal">พนักงาน</th><th className="py-2 text-right font-normal">รับเงินสด</th>
                      <th className="py-2 text-right font-normal">รับโอน</th><th className="py-2 text-right font-normal">รับ QR</th>
                      <th className="py-2 text-right font-normal">จ่ายเงินสดออก</th><th className="py-2 text-right font-normal">เงินสดสุทธิ</th>
                      <th className="py-2 text-right font-normal">รายการ</th>
                    </tr></thead>
                    <tbody>{data.byStaff.map((s) => (
                      <tr key={s.actorId} className="border-b border-border/60 last:border-0">
                        <td className="py-2.5 font-medium">{s.name}</td>
                        <td className="py-2.5 text-right tabular-nums">{dash(s.cashIn)}</td>
                        <td className="py-2.5 text-right tabular-nums">{dash(s.transferIn)}</td>
                        <td className="py-2.5 text-right tabular-nums">{dash(s.qrIn)}</td>
                        <td className="py-2.5 text-right tabular-nums text-destructive">{Number(s.cashOut) === 0 ? '—' : `−${baht(s.cashOut)}`}</td>
                        <td className="py-2.5 text-right font-semibold tabular-nums">{baht(s.netCash)}</td>
                        <td className="py-2.5 text-right tabular-nums text-muted-foreground">{s.count}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className="space-y-3 md:hidden">{data.byStaff.map((s) => (
                  <div key={s.actorId} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex items-baseline justify-between"><span className="font-semibold">{s.name}</span><span className="text-xs text-muted-foreground">{s.count} รายการ</span></div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                      <dt className="text-muted-foreground">รับเงินสด</dt><dd className="text-right tabular-nums">{dash(s.cashIn)}</dd>
                      <dt className="text-muted-foreground">รับโอน + QR</dt><dd className="text-right tabular-nums">{dash(String(Number(s.transferIn) + Number(s.qrIn)))}</dd>
                      <dt className="text-muted-foreground">จ่ายเงินสดออก</dt><dd className="text-right tabular-nums text-destructive">{Number(s.cashOut) === 0 ? '—' : `−${baht(s.cashOut)}`}</dd>
                    </dl>
                    <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold"><span>เงินสดสุทธิ</span><span className="tabular-nums">{baht(s.netCash)}</span></div>
                  </div>
                ))}</div>
              </Section>
            )}

            {!own && data.byKind.length > 0 && (
              <Section title="แยกตามประเภท">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead><tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="py-2 text-left font-normal">ประเภท</th><th className="py-2 text-right font-normal">เงินสด</th>
                      <th className="py-2 text-right font-normal">โอน</th><th className="py-2 text-right font-normal">QR</th>
                      <th className="py-2 text-right font-normal">รวม</th><th className="py-2 text-right font-normal">รายการ</th>
                    </tr></thead>
                    <tbody>{data.byKind.map((k) => (
                      <tr key={k.kind} className="border-b border-border/60 last:border-0">
                        <td className="py-2.5">{KIND_LABEL[k.kind]}</td>
                        <td className="py-2.5 text-right tabular-nums">{dash(k.cash)}</td>
                        <td className="py-2.5 text-right tabular-nums">{dash(k.transfer)}</td>
                        <td className="py-2.5 text-right tabular-nums">{dash(k.qr)}</td>
                        <td className={`py-2.5 text-right font-semibold tabular-nums ${k.direction === 'OUT' ? 'text-destructive' : ''}`}>{k.direction === 'OUT' ? '−' : ''}{baht(k.total)}</td>
                        <td className="py-2.5 text-right tabular-nums text-muted-foreground">{k.count}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </Section>
            )}

            <Section title={own ? 'รายการของฉัน' : 'รายการทั้งหมดของวัน'}
              actions={(
                <div className="flex flex-wrap gap-2">
                  {([['ALL', 'ทั้งหมด'], ['CASH', 'เงินสด'], ['NON_CASH', 'โอน + QR'], ['OUT', 'จ่ายออก']] as const).map(([key, label]) => (
                    <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}
                      className={`min-h-11 rounded-full border px-3.5 text-sm leading-snug ${filter === key ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-border bg-card text-foreground hover:bg-accent'}`}>
                      {label} {counts[key]}
                    </button>
                  ))}
                </div>
              )}>
              {rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground leading-snug">ไม่มีรายการรับหรือจ่ายเงินในวันนี้</p>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="py-2 text-left font-normal">เวลา</th><th className="py-2 text-left font-normal">ประเภท</th>
                        <th className="py-2 text-left font-normal">เอกสาร</th><th className="py-2 text-left font-normal">ลูกค้า</th>
                        <th className="py-2 text-left font-normal">วิธี</th><th className="py-2 text-left font-normal">เลขอ้างอิง</th>
                        {!own && <th className="py-2 text-left font-normal">ผู้รับ / ผู้จ่าย</th>}
                        <th className="py-2 text-right font-normal">จำนวนเงิน</th>
                      </tr></thead>
                      <tbody>{rows.map((r, index) => (
                        <Fragment key={r.id}>
                        {cutoff && isAfterClose(r.occurredAt) && (index === 0 || !isAfterClose(rows[index - 1].occurredAt)) && (
                          <tr><td colSpan={own ? 7 : 8} className="py-2 text-center text-xs text-muted-foreground leading-snug">
                            — ปิดยอด {timeOf(cutoff.countedAt)} · ต้องมี {baht(cutoff.expectedAmount)} · นับได้ {baht(cutoff.countedAmount)} · {varianceLabel(cutoff.varianceAmount)} —
                          </td></tr>
                        )}
                        <tr className={`border-b border-border/60 last:border-0 ${r.direction === 'OUT' ? 'bg-destructive/5' : ''}`}>
                          <td className="py-2.5 pr-3 text-muted-foreground tabular-nums">{timeOf(r.occurredAt)}</td>
                          <td className="py-2.5 pr-3">{KIND_LABEL[r.kind]}
                            {isAfterClose(r.occurredAt) && <span className="ml-2 inline-block rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold leading-snug text-warning">หลังปิดยอด นับรวมรอบถัดไป</span>}
                            {r.seqTotal > 1 && <span className="block text-xs text-muted-foreground leading-snug">จ่ายผสม {r.seq} จาก {r.seqTotal}</span>}</td>
                          <td className="py-2.5 pr-3"><Link to={DOC_PATH[r.docType](r.docId)} className="text-primary hover:underline">{r.docNumber}</Link></td>
                          <td className="py-2.5 pr-3">{r.customerName ?? '—'}</td>
                          <td className="py-2.5 pr-3"><MethodBadge method={r.method} /></td>
                          <td className="py-2.5 pr-3">{r.reference
                            ? <span className="flex flex-col items-start gap-1"><span className="text-[13px]">{r.reference}</span>{r.duplicateReference && <DuplicateBadge />}</span>
                            : <span className="text-muted-foreground">—</span>}</td>
                          {!own && <td className="py-2.5 pr-3">{r.actorName}</td>}
                          <td className={`py-2.5 text-right font-medium tabular-nums ${r.direction === 'OUT' ? 'text-destructive' : ''}`}>{r.direction === 'OUT' ? '−' : ''}{baht(r.amount)}</td>
                        </tr>
                        </Fragment>
                      ))}</tbody>
                    </table>
                  </div>
                  <div className="space-y-2 md:hidden">{rows.map((r) => (
                    <div key={r.id} className="rounded-lg border border-border p-3 text-sm">
                      <div className="flex justify-between gap-2"><span className="font-medium">{KIND_LABEL[r.kind]}</span>
                        <span className={`font-semibold tabular-nums ${r.direction === 'OUT' ? 'text-destructive' : ''}`}>{r.direction === 'OUT' ? '−' : ''}{baht(r.amount)}</span></div>
                      <div className="mt-1 text-xs text-muted-foreground leading-snug">
                        {timeOf(r.occurredAt)} · <Link to={DOC_PATH[r.docType](r.docId)} className="text-primary">{r.docNumber}</Link>
                        {!own && <> · {r.direction === 'OUT' ? 'ผู้จ่าย' : 'ผู้รับ'} {r.actorName}</>}
                        {r.seqTotal > 1 && <> · จ่ายผสม {r.seq}/{r.seqTotal}</>}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5"><MethodBadge method={r.method} />
                        {r.reference && <span className="text-xs text-foreground">อ้างอิง {r.reference}</span>}{r.duplicateReference && <DuplicateBadge />}
                        {isAfterClose(r.occurredAt) && <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold leading-snug text-warning">หลังปิดยอด</span>}</div>
                    </div>
                  ))}</div>
                </>
              )}
            </Section>

            <p className="text-xs text-muted-foreground leading-snug">
              ค่างวดที่ลูกค้าจ่ายให้ FINANCE ไม่รวมในหน้านี้ — ดูที่เมนู รับชำระค่างวด แท็บ สรุปรายวัน · หน้านี้เริ่มนับตั้งแต่วันที่เปิดใช้ระบบบันทึกรับเงินแบบใหม่
            </p>
          </div>
        )}
      </QueryBoundary>
      )}
    </div>
  );
}

function StatCard({ label, value, hint, negative }: { label: string; value: string; hint: string; negative?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="text-sm text-muted-foreground leading-snug">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${negative && Number(value) > 0 ? 'text-destructive' : 'text-foreground'}`}>
        {negative && Number(value) > 0 ? '−' : ''}{baht(value)} ฿
      </div>
      <div className="mt-1 text-xs text-muted-foreground leading-snug">{hint}</div>
    </div>
  );
}

function Section({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-[15px] font-semibold leading-snug">{title}</h2>
        {actions}
      </div>
      <div className="px-4 py-2 sm:px-5">{children}</div>
    </section>
  );
}
