import type { ChatAnalyticsMeta } from '@installment/shared';
import { analyticsDate } from './analytics-format';
export default function AnalyticsCoverage({ data }: { data: ChatAnalyticsMeta }) {
  return (
    <details className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
      <summary className="min-h-6 cursor-pointer font-medium">
        ขอบเขตและความครบถ้วนของข้อมูล
      </summary>
      <div className="mt-3 space-y-2 text-muted-foreground leading-relaxed">
        <p>เริ่มมีรอบที่แยกคน/บอท: {analyticsDate(data.coverage.from)}</p>
        <p>
          ประวัติเก่าที่ไม่รวม: {data.coverage.legacyExcluded} รอบ · ไม่ทราบผู้ตอบ:{' '}
          {data.coverage.unknownStaffCycles} รอบ · ไม่ทราบนโยบายเวลา:{' '}
          {data.coverage.unknownPolicyCycles} รอบ · รอบที่ถูกรวม: {data.coverage.mergedExcluded} รอบ
        </p>
        <p>{data.cohortDefinition}</p>
        <p>
          งานค้างเป็นยอดปัจจุบัน ไม่ใช่ snapshot ย้อนหลัง และแต่ละการเปิดรายการอ่านข้อมูลใหม่
          ดูเวลาอัปเดตประกอบ
        </p>
      </div>
    </details>
  );
}
