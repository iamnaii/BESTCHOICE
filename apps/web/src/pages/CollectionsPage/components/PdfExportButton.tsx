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
import { useUiFlags } from '@/hooks/useUiFlags';
import { useGeneratePdf } from '../hooks/usePdfExport';

/**
 * PDF export button (P3 D1).
 * Click → opens dialog → choose date range → POST /reporting/pdf streams blob.
 * Hidden while `export_enabled` is off (D1.3.3.1) — the server's ExportEnabledGuard
 * still answers 403 to any stale tab or script.
 */
export default function PdfExportButton() {
  const { exportEnabled } = useUiFlags();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRangeValue>(() => {
    const now = new Date();
    return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
  });
  const generate = useGeneratePdf(() => setOpen(false));

  if (!exportEnabled) return null;

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
      <Dialog open={open} onOpenChange={(next) => { if (!next) generate.cancel(); setOpen(next); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>ส่งออกรายงาน PDF</DialogTitle>
            <DialogDescription>เลือกช่วงวันที่สำหรับรายงานติดตามหนี้</DialogDescription>
          </DialogHeader>
          <fieldset className="py-2" disabled={generate.isPending}>
            <DateRangePicker value={range} onChange={setRange} />
          </fieldset>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { generate.cancel(); setOpen(false); }}>
              ยกเลิก
            </Button>
            <Button
              disabled={!range.from || !range.to || generate.isPending}
              onClick={() => {
                if (!range.from || !range.to) return;
                generate.generate({ from: range.from, to: range.to });
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
