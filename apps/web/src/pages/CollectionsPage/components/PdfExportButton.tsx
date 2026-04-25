import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { subDays, startOfDay, endOfDay } from 'date-fns';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DateRangePicker, type DateRangeValue } from '@/components/ui/DateRangePicker';
import { useGeneratePdf } from '../hooks/usePdfExport';

/**
 * PDF export button (P3 D1).
 * Click → opens dialog → choose date range → POST /reporting/pdf streams blob.
 */
export default function PdfExportButton() {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRangeValue>(() => {
    const now = new Date();
    return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
  });
  const generate = useGeneratePdf();

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2"
        aria-label="ส่งออกรายงาน PDF"
      >
        <Download className="h-4 w-4" />
        ส่งออก PDF
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>ส่งออกรายงาน PDF</DialogTitle>
            <DialogDescription>เลือกช่วงวันที่สำหรับรายงานติดตามหนี้</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <DateRangePicker value={range} onChange={setRange} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              disabled={!range.from || !range.to || generate.isPending}
              onClick={() => {
                if (!range.from || !range.to) return;
                generate.mutate(
                  { from: range.from, to: range.to },
                  { onSuccess: () => setOpen(false) },
                );
              }}
              className="gap-2"
            >
              {generate.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              ดาวน์โหลด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
