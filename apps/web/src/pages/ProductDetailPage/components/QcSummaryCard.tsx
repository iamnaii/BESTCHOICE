import { useState } from 'react';
import { Check, ChevronRight, ClipboardList } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { conditionGradeMap, getStatusBadgeProps } from '@/lib/status-badges';
import { QcResultsList, sortInspectionResults, useInspectionResults } from './QcResultsCard';

interface Props {
  inspection: { id: string; overallGrade: string | null; isCompleted: boolean };
}

/**
 * ผลตรวจ QC แบบย่อ ("ผ่าน k / N ข้อ") + ปุ่มดูรายข้อใน dialog — แทนการ์ดเดิมที่ไล่ทุกข้อบนหน้า
 */
export default function QcSummaryCard({ inspection }: Props) {
  const [open, setOpen] = useState(false);
  const { data } = useInspectionResults(inspection.id);
  const results = sortInspectionResults(data?.results ?? []);
  // นับ "ผ่าน" แบบเดียวกับไอคอนในรายการ (QcResultsList): เฉพาะ passFail === false เท่านั้นที่ไม่ผ่าน
  const passed = results.filter((r) => r.passFail !== false).length;
  const total = results.length;
  const gradeCfg = inspection.overallGrade
    ? getStatusBadgeProps(inspection.overallGrade, conditionGradeMap)
    : null;

  return (
    <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
      <CardHeader>
        <CardTitle>ผลตรวจ QC</CardTitle>
        <Badge variant={inspection.isCompleted ? 'success' : 'warning'} appearance="light" size="sm">
          {inspection.isCompleted ? 'ตรวจเสร็จ' : 'กำลังตรวจ'}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="flex size-11 items-center justify-center rounded-lg bg-success/15 text-success">
              {total > 0 ? <Check className="size-5" aria-hidden /> : <ClipboardList className="size-5" aria-hidden />}
            </div>
            <div className="leading-snug">
              <div className="text-[15px] font-semibold">
                {total > 0 ? `ผ่าน ${passed} / ${total} ข้อ` : 'ยังไม่มีผลรายข้อ'}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {gradeCfg && (
                  <Badge variant={gradeCfg.variant} appearance={gradeCfg.appearance} size="sm">
                    {gradeCfg.label}
                  </Badge>
                )}
                {total > 0 && passed < total && (
                  <span className="text-destructive">ไม่ผ่าน {total - passed} ข้อ</span>
                )}
              </div>
            </div>
          </div>
          {total > 0 && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-0.5 text-[13px] font-medium text-primary hover:underline leading-snug"
            >
              ดูรายข้อ
              <ChevronRight className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ผลตรวจรายข้อ ({total})</DialogTitle>
          </DialogHeader>
          <QcResultsList results={results} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
