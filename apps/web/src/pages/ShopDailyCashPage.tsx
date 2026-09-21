import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { tenderMethodLabel } from '@/components/tender/tender-utils';
import { useAuth } from '@/contexts/AuthContext';
import CashCloseCard, { cashCloseKey } from './shop-daily-cash/CashCloseCard';
import CashCloseHistory from './shop-daily-cash/CashCloseHistory';
import CashDayStrip from './shop-daily-cash/CashDayStrip';
import CashHoldingsCard from './shop-daily-cash/CashHoldingsCard';
import CashCloseOverview from './shop-daily-cash/CashCloseOverview';
import { latestEffectiveClose, varianceLabel, type CashCloseStatusResponse } from './shop-daily-cash/cash-close';
import { shiftDate } from './shop-daily-cash/cash-hero';

/**
 * สรุปเงินหน้าร้านรายวัน (mockup CnXmYLkT กระดาน 1-3, 5 → ออกแบบใหม่ทั้งหน้า กระดาน 15–17) — อ่านจาก GET /shop-tenders/daily-summary
 * เรียงบนลงล่างตามคำถามของเจ้าของ: วันไหน → เงินสดอยู่ไหน/รอใคร/ต้องกดอะไร → เงินค้าง + วันที่ต้องตามดู → รับทางไหนเท่าไร → ใครรับ → รายการ
 */

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
const thaiLongDate = (date: string) =>
  new Date(`${date}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });

type RowFilter = 'ALL' | 'CASH' | 'NON_CASH' | 'OUT';

function MethodBadge({ method }: { method: string }) {
  const tone = method === 'CASH' ? 'bg-warning/10 text-foreground' : method === 'QR_EWALLET' ? 'bg-muted text-foreground' : 'bg-primary/10 text-primary';
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
  const [kindOpen, setKindOpen] = useState(false);

  const query = useQuery<DailySummary>({
    queryKey: ['shop-tenders', 'daily-summary', date, branchId],
    queryFn: async () => (await api.get('/shop-tenders/daily-summary', { params: { date, branchId: branchId || undefined } })).data,
    // ยอดเงินสดต้องสดเสมอ: ขายเงินสด/ตั้งค่าสาขาแล้วกลับมาหน้านี้ ต้องไม่เห็นของเก่าจาก cache 3 นาทีของแอป
    staleTime: 0, refetchOnMount: 'always',
  });
  const data = query.data;
  const own = data?.scope === 'OWN';

  // ร้านที่มีสาขาเดียว: เลือกสาขานั้นให้เองครั้งแรก — เปิดหน้ามาต้องเจอกล่องปิดยอดทันที (เดิมค้างที่ "ทุกสาขา" จึงไม่เห็นกล่องเลย)
  const [autoPicked, setAutoPicked] = useState(false);
  useEffect(() => {
    if (autoPicked || data?.scope !== 'ALL') return;
    setAutoPicked(true);
    if (data.branches.length === 1) setBranchId(data.branches[0].id);
  }, [autoPicked, data]);

  // กล่องปิดยอดผูกกับ "สาขาเดียว": เจ้าของ/การเงิน/บัญชี = สาขาที่เลือก · ผจก.สาขา = สาขาตัวเอง · พนักงานขาย = สาขาที่สังกัด
  const { user } = useAuth();
  const [tab, setTab] = useState<'DAILY' | 'HISTORY'>('DAILY');
  const closeBranchId = data?.scope === 'ALL' ? branchId : data?.scope === 'BRANCH' ? (data.branchId ?? '') : (user?.branchId ?? '');
  const isToday = date === todayBangkok();
  // key เดียวกับ CashCloseCard ⇒ React Query ยิงครั้งเดียว — ใช้หาขอบ "หลังปิดยอด" ของตารางรายการ
  const closeStatus = useQuery<CashCloseStatusResponse>({
    queryKey: cashCloseKey(closeBranchId, date),
    queryFn: async () => (await api.get('/shop-tenders/cash-close/status', { params: { branchId: closeBranchId, date } })).data,
    // ยอดเงินสดต้องสดเสมอ: ขายเงินสด/ตั้งค่าสาขาแล้วกลับมาหน้านี้ ต้องไม่เห็นของเก่าจาก cache 3 นาทีของแอป
    staleTime: 0, refetchOnMount: 'always',
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

  // จำนวนรายการรับเข้าต่อวิธี — ของแถบ "เงินเข้า-ออกของวัน" (ยอดเงินมาจาก totals ของ API)
  const methodCounts = useMemo(() => {
    const incoming = (data?.rows ?? []).filter((r) => r.direction === 'IN');
    return {
      transfer: incoming.filter((r) => r.method !== 'CASH' && r.method !== 'QR_EWALLET').length,
      qr: incoming.filter((r) => r.method === 'QR_EWALLET').length,
    };
  }, [data]);

  const openDay = (day: string) => setDate(day);

  return (
    <div className="space-y-4">
      {/* แถวบนแถวเดียว: ชื่อหน้า + เลื่อนวัน + สาขา + สลับมุมมอง (mockup CnXmYLkT กระดาน 15) */}
      <PageHeader title="สรุปเงินหน้าร้านรายวัน" className="mb-0 pb-4"
        subtitle={own ? 'ยอดที่ฉันรับและจ่ายในวันนี้' : 'เงินที่รับและจ่ายจริงที่หน้าร้าน · เงินสดถึงบริษัทหรือยัง'}
        action={(
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {/* แท็บประวัติเลือกเป็นเดือนของตัวเอง — วันที่ใช้เฉพาะมุมมองรายวัน */}
            {(tab === 'DAILY' || own) && (
              <div className="flex h-11 w-full items-center justify-between rounded-lg border border-input bg-background sm:w-auto">
                <button type="button" aria-label="วันก่อนหน้า" onClick={() => setDate(shiftDate(date, -1))}
                  className="grid h-11 w-11 place-items-center rounded-l-lg text-muted-foreground hover:bg-accent hover:text-foreground"><ChevronLeft aria-hidden className="h-[18px] w-[18px]" /></button>
                <div className="flex items-center gap-1.5">
                  {isToday && <span className="whitespace-nowrap pl-1 text-sm font-semibold leading-snug">วันนี้ ·</span>}
                  <ThaiDateInput value={date} max={todayBangkok()} aria-label="วันที่" onChange={(e) => e.target.value && setDate(e.target.value)}
                    className="h-[42px] w-[128px] border-0 bg-transparent pl-1 font-semibold" />
                </div>
                <button type="button" aria-label="วันถัดไป" disabled={isToday} onClick={() => setDate(shiftDate(date, 1))}
                  className="grid h-11 w-11 place-items-center rounded-r-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"><ChevronRight aria-hidden className="h-[18px] w-[18px]" /></button>
              </div>
            )}
            {data?.scope === 'ALL' && (
              <select id="daily-cash-branch" aria-label="สาขา" value={branchId} onChange={(e) => setBranchId(e.target.value)}
                className="h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm sm:w-48">
                <option value="">ทุกสาขา</option>
                {data.branches.map((b) => <option key={b.id} value={b.id}>สาขา {b.name}</option>)}
              </select>
            )}
            {data && !own && (
              <div role="tablist" aria-label="มุมมองของหน้าสรุปเงิน" className="flex w-full rounded-lg border border-border bg-muted p-[3px] sm:h-11 sm:w-auto">
                {([['DAILY', 'รายวัน'], ['HISTORY', 'ประวัติการส่งยอด']] as const).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                    className={`min-h-11 flex-1 rounded-md px-4 text-sm leading-snug sm:min-h-0 sm:flex-none ${tab === key ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )} />

      {tab === 'HISTORY' && data && !own && <CashCloseHistory branchId={closeBranchId} branches={data.branches} />}

      {/* กดช่องในแถบ 14 วันแล้ว = ดูวันย้อนหลัง — ต้องบอกให้ชัดและมีทางกลับ (เจ้าของเคยค้างอยู่วันที่ 8 แล้วหาปุ่มนับไม่เจอ) */}
      {(tab === 'DAILY' || own) && !isToday && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted px-4 py-3">
          <div className="space-y-0.5 leading-snug">
            <div className="text-sm font-semibold">กำลังดูวันที่ {thaiLongDate(date)} (ย้อนหลัง)</div>
            <div className="text-[13px] text-muted-foreground">การส่งยอดรายวันของรอบใหม่ทำได้เฉพาะวันนี้ · ยอดที่รอยืนยันรับเงินค้างอยู่ยังกดยืนยันได้จากหน้านี้</div>
          </div>
          <button type="button" onClick={() => setDate(todayBangkok())}
            className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">กลับมาวันนี้</button>
        </div>
      )}

      {(tab === 'DAILY' || own) && (
      <QueryBoundary isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={query.refetch}>
        {data && (
          <div className="space-y-4">
            {/* สาขาเดียว: แถบ 14 วัน (ตัวเลือกวัน) → กล่องสถานะเดียว + การ์ดเงินค้าง · ทุกสาขา: ตารางสถานะของวัน (กระดาน 10) */}
            {closeBranchId ? (
              <>
                {!own && <CashDayStrip date={date} branchId={closeBranchId} onPick={openDay} />}
                <div className={own ? '' : 'grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_330px]'}>
                  <CashCloseCard branchId={closeBranchId} date={date} isToday={isToday} />
                  {!own && <CashHoldingsCard date={date} branchId={closeBranchId} onPick={openDay} />}
                </div>
              </>
            ) : !own && (
              <CashCloseOverview date={date} branchId="" showTable
                onOpen={(openBranchId, openDate) => {
                  if (data.scope === 'ALL') setBranchId(openBranchId);
                  if (openDate) setDate(openDate);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }} />
            )}

            {own && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-snug text-foreground">
                คุณเห็นเฉพาะรายการที่คุณเป็นผู้รับหรือผู้จ่ายเงิน — ใช้ตรวจยอดของตัวเองก่อนส่งเงินให้ผู้จัดการ
              </div>
            )}

            {/* เงินเข้า-ออกของวัน: แถบเดียว 4 ช่อง — ไม่มีกล่องสีทึบแข่งกับปุ่มของกล่องสถานะ */}
            <section aria-label="เงินเข้า-ออกของวัน" className="grid overflow-hidden grid-cols-1 divide-y divide-border/70 rounded-xl border border-border bg-card sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-[1.25fr_1fr_1fr_1.1fr]">
              <MethodCell label="เงินสด" icon value={`${baht(data.totals.expectedCashInDrawer)} ฿`}
                lines={[<>รับ {baht(data.totals.cashIn)} · จ่ายออก <span className="text-destructive">−{baht(data.totals.cashOut)}</span></>,
                  own ? 'เงินสดที่ฉันรับสุทธิ — ตรวจก่อนส่งยอด' : 'ผ่านมือพนักงาน → ต้องส่งยอด']} />
              <MethodCell label="รับโอน" value={`${baht(data.totals.transferIn)} ฿`} className="sm:border-l sm:border-border/70"
                lines={[`${methodCounts.transfer} รายการ · เข้าบัญชีร้านโดยตรง`, 'เทียบกับสเตทเมนต์']} />
              <MethodCell label="รับ QR / e-Wallet" value={`${baht(data.totals.qrIn)} ฿`} className="sm:border-t sm:border-border/70 lg:border-l lg:border-t-0"
                lines={[`${methodCounts.qr} รายการ · เข้าบัญชีร้านโดยตรง`, 'เทียบกับสเตทเมนต์']} />
              <MethodCell label="รวมทั้งวัน" value={`รับ ${baht(data.totals.totalIn)} ฿`} className="bg-muted/50 sm:border-l sm:border-t sm:border-border/70 lg:border-t-0"
                lines={[<span className={Number(data.totals.totalOut) > 0 ? 'text-destructive' : ''}>จ่ายออก {Number(data.totals.totalOut) > 0 ? '−' : ''}{baht(data.totals.totalOut)} · {data.totals.outCount} รายการ{Number(data.totals.nonCashOut) > 0 ? ` (โอนออก ${baht(data.totals.nonCashOut)})` : ''}</span>,
                  `รับเข้า ${data.totals.inCount} รายการ`]} />
            </section>

            {!own && data.byStaff.length > 0 && (
              <Section title="แยกตามพนักงาน (ผู้รับ / ผู้จ่ายเงิน)" actions={<span className="text-xs text-muted-foreground leading-snug">เงินสดสุทธิ = รับเงินสด − จ่ายเงินสดออก ของคนนั้น</span>}>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="py-2 text-left font-normal">พนักงาน</th><th className="py-2 text-right font-normal">รับเงินสด</th>
                      <th className="py-2 text-right font-normal">รับโอน</th><th className="py-2 text-right font-normal">รับ QR</th>
                      <th className="py-2 text-right font-normal">จ่ายเงินสดออก</th><th className="px-3 py-2 text-right font-semibold text-foreground">เงินสดสุทธิ</th>
                      <th className="py-2 text-right font-normal">รายการ</th>
                    </tr></thead>
                    <tbody>{data.byStaff.map((s) => (
                      <tr key={s.actorId} className="border-b border-border/60 last:border-0">
                        <td className="py-2.5 font-medium">{s.name}</td>
                        <td className="py-2.5 text-right tabular-nums">{dash(s.cashIn)}</td>
                        <td className="py-2.5 text-right tabular-nums">{dash(s.transferIn)}</td>
                        <td className="py-2.5 text-right tabular-nums">{dash(s.qrIn)}</td>
                        <td className="py-2.5 text-right tabular-nums text-destructive">{Number(s.cashOut) === 0 ? '—' : `−${baht(s.cashOut)}`}</td>
                        <td className="bg-muted/50 px-3 py-2.5 text-right font-bold tabular-nums">{baht(s.netCash)}</td>
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
              {/* คำเตือนเลขอ้างอิงซ้ำอยู่ติดกับตารางที่ต้องไปไล่ดู */}
              {data.duplicateReferences.length > 0 && (
                <div role="alert" className="mb-2 mt-1.5 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[13px] leading-snug text-foreground">
                  <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="space-y-1">
                    {data.duplicateReferences.map((d) => (
                      <p key={d.reference}>
                        <span className="font-semibold">เลขอ้างอิง {d.reference} ถูกใช้กับ {d.documents.length} บิล</span>
                        {' — '}{d.documents.join(' และ ')} ตรวจสเตทเมนต์ว่าเงินเข้าจริงครบทุกยอดหรือไม่
                      </p>
                    ))}
                  </div>
                </div>
              )}
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
                            — ส่งยอด {timeOf(cutoff.countedAt)} · ต้องมี {baht(cutoff.expectedAmount)} · นับได้ {baht(cutoff.countedAmount)} · {varianceLabel(cutoff.varianceAmount)} —
                          </td></tr>
                        )}
                        <tr className={`border-b border-border/60 last:border-0 ${r.direction === 'OUT' ? 'bg-destructive/5' : ''}`}>
                          <td className="py-2.5 pr-3 text-muted-foreground tabular-nums">{timeOf(r.occurredAt)}</td>
                          <td className="py-2.5 pr-3">{KIND_LABEL[r.kind]}
                            {isAfterClose(r.occurredAt) && <span className="ml-2 inline-block rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold leading-snug text-foreground">หลังส่งยอด นับรวมรอบถัดไป</span>}
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
                    <div key={r.id} className={`rounded-lg border p-3 text-sm ${r.direction === 'OUT' ? 'border-destructive/30 bg-destructive/5' : 'border-border'}`}>
                      <div className="flex justify-between gap-2"><span className="font-medium">{KIND_LABEL[r.kind]}</span>
                        <span className={`font-semibold tabular-nums ${r.direction === 'OUT' ? 'text-destructive' : ''}`}>{r.direction === 'OUT' ? '−' : ''}{baht(r.amount)}</span></div>
                      <div className="mt-1 text-xs text-muted-foreground leading-snug">
                        {timeOf(r.occurredAt)} · <Link to={DOC_PATH[r.docType](r.docId)} className="text-primary">{r.docNumber}</Link>
                        {!own && <> · {r.direction === 'OUT' ? 'ผู้จ่าย' : 'ผู้รับ'} {r.actorName}</>}
                        {r.seqTotal > 1 && <> · จ่ายผสม {r.seq}/{r.seqTotal}</>}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5"><MethodBadge method={r.method} />
                        {r.reference && <span className="text-xs text-foreground">อ้างอิง {r.reference}</span>}{r.duplicateReference && <DuplicateBadge />}
                        {isAfterClose(r.occurredAt) && <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold leading-snug text-foreground">หลังส่งยอด</span>}</div>
                    </div>
                  ))}</div>
                </>
              )}

              {/* แยกตามประเภท: ยุบเป็นบรรทัดสรุป กดแล้วกางเป็นตารางเดิม (เจ้าของเคาะ 2026-09-21) */}
              {!own && data.byKind.length > 0 && (
                <div className="mt-2 border-t border-border/70 pt-2">
                  <button type="button" aria-expanded={kindOpen} aria-controls="daily-cash-by-kind" onClick={() => setKindOpen(!kindOpen)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left text-[13px] leading-snug text-foreground hover:bg-accent">
                    <ChevronRight aria-hidden className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${kindOpen ? 'rotate-90' : ''}`} />
                    <span><span className="font-semibold">แยกตามประเภท</span> — {data.byKind.map((k) => `${KIND_LABEL[k.kind]} ${k.count}`).join(' · ')}</span>
                  </button>
                  {kindOpen && (
                    <div id="daily-cash-by-kind" className="overflow-x-auto">
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
                  )}
                </div>
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

function MethodCell({ label, value, lines, icon, className = '' }: { label: string; value: string; lines: React.ReactNode[]; icon?: boolean; className?: string }) {
  return (
    <div className={`space-y-0.5 px-4 py-3.5 leading-snug sm:px-5 ${className}`}>
      <div className="flex items-center gap-1.5 text-[13px] font-semibold">{icon && <Banknote aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />}{label}</div>
      <div className="text-[22px] font-bold tabular-nums">{value}</div>
      {lines.map((line, index) => <div key={index} className="text-xs text-muted-foreground tabular-nums">{line}</div>)}
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
