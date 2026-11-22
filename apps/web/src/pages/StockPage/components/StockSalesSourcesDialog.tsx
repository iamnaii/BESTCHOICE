import { Link } from 'react-router';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { StockDashboard } from '../types';

export function StockSalesSourcesDialog({
  open,
  onOpenChange,
  analytics,
  unit,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  analytics: NonNullable<StockDashboard['salesAnalytics']>;
  unit: string;
}) {
  const a = analytics;
  const date = (value: string) =>
    new Date(value).toLocaleDateString('th-TH', {
      timeZone: 'Asia/Bangkok',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>ที่มาของยอดขาย / จ่ายเดือนนี้</DialogTitle>
        <DialogDescription>
          {date(a.startDate)} – {date(a.asOf)} · ตามหมวดและสาขาที่เลือก
        </DialogDescription>
        <dl className="space-y-3 text-sm">
          {[
            [
              'รายการใหม่ BESTCHOICE',
              a.nativeIncluded
                ? `${a.current.nativeCount.toLocaleString()} ${unit}`
                : 'ไม่มีสิทธิ์ดูยอดขาย',
            ],
            [
              'ประวัติ Tooltify',
              a.importedIncluded
                ? `${a.current.importedCount.toLocaleString()} ${unit}`
                : 'ไม่มีสิทธิ์ดูประวัติ',
            ],
            ['รวม', `${a.current.count.toLocaleString()} ${unit}`],
            ['ในจำนวนนี้เป็นของแถม', `${a.current.giftCount.toLocaleString()} ชิ้น`],
            ['ยอดขาย', `${Number(a.current.revenue).toLocaleString()} ฿`],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular-nums font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        {a.current.unknownCount > 0 && (
          <p className="text-sm text-warning-strong">
            ไม่ระบุหมวด {a.current.unknownCount} รายการ รวมอยู่ในยอดทั้งหมด
          </p>
        )}
        {a.unattributedCount > 0 && (
          <p className="text-sm text-warning-strong">
            ประวัติ {a.unattributedCount} รายการในช่วง 6 เดือนยังระบุสาขาไม่ได้ จึงยังไม่รวมในสถิติ
          </p>
        )}
        <div className="flex flex-col gap-2 text-sm">
          {a.nativeIncluded && (
            <Link
              className="text-primary underline min-h-11 flex items-center"
              to="/sales?zone=shop"
            >
              เปิดรายการขาย BESTCHOICE ทั้งหมด
            </Link>
          )}
          {a.importedIncluded && (
            <Link
              className="text-primary underline min-h-11 flex items-center"
              to="/imported-sales?zone=shop"
            >
              เปิดประวัติ Tooltify ทั้งหมด
            </Link>
          )}
          <p className="text-muted-foreground">
            หน้าประวัติแสดงรายการทั้งหมดตามสิทธิ์ กรุณาเลือกช่วงเวลาและตัวกรองในหน้านั้น
          </p>
        </div>
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          นับตามวันขายเดิม ไม่ใช่วันที่นำเข้า และนับทุกครั้งที่ขาย แม้เป็น IMEI เดิม
          ยอดเดือนนี้ยังไม่เต็มเดือน
        </p>
      </DialogContent>
    </Dialog>
  );
}
