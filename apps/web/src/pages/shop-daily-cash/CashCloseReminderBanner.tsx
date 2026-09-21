import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { baht, thaiShortDate, type CashCloseReminderResponse } from './cash-close';

/**
 * แถบเตือนบนหน้าขาย (mockup CnXmYLkT กระดาน 11 ส่วน C): เมื่อวานสาขานี้มีเงินสดรับแต่ยังไม่มีใครนับปิดยอด.
 * เจ้าของเคาะ "เตือนอย่างเดียว ยังขายได้" — แถบนี้ไม่ล็อกอะไร และหายเองเมื่อมีการนับปิดยอด.
 * แสดงเฉพาะผู้ใช้ที่สังกัดสาขา (พนักงานขาย / ผู้จัดการสาขา) — เจ้าของดูภาพรวมทุกสาขาที่หน้าสรุปเงินรายวัน
 */
export default function CashCloseReminderBanner() {
  const { user } = useAuth();
  const branchId = user?.branchId ?? '';
  const query = useQuery<CashCloseReminderResponse>({
    queryKey: ['shop-tenders', 'cash-close', 'reminder', branchId],
    queryFn: async () => (await api.get('/shop-tenders/cash-close/reminder', { params: { branchId } })).data,
    enabled: !!branchId, staleTime: 60 * 1000, retry: false,
  });
  const missed = query.data?.missed;
  if (!missed) return null;

  return (
    <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3.5">
      <div className="space-y-0.5 leading-snug">
        <div className="text-[15px] font-semibold text-destructive">{missed.branchName} ยังไม่ส่งยอดของเมื่อวาน ({thaiShortDate(missed.date)})</div>
        <div className="text-sm text-destructive">
          มีเงินสดในลิ้นชักที่ยังไม่ได้นับ {baht(missed.expectedAmount)} ฿ ·{' '}
          {query.data?.canCount ? 'ส่งยอดรายวันก่อนเริ่มขายวันนี้' : 'แจ้งพนักงานขายหรือผู้จัดการสาขาให้ส่งยอดรายวัน'}
        </div>
      </div>
      <Link to="/shop/daily-cash"
        className="inline-flex min-h-11 items-center rounded-lg bg-destructive px-4 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90">
        ไปส่งยอดรายวัน
      </Link>
    </div>
  );
}
