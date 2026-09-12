import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Printer, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { getCompanyScopeRevision } from '@/lib/company-scope';
import { useLetterPdf } from '@/hooks/useLetterPdf';
import type { LetterRow } from '../types';

interface Props { open: boolean; rows: LetterRow[]; onClose: () => void }

export default function BulkPrintDialog({ open, rows, onClose }: Props) {
  // Freeze the selection so the PDF and subsequent status update refer to the same letters.
  const [batch] = useState(() => rows.map(({ id, status, pdfUrl }) => ({ id, status, pdfUrl })));
  const [scope] = useState(getCompanyScopeRevision);
  const pdf = useLetterPdf(batch.map(row => row.id), open, Object.fromEntries(batch.filter(row => row.pdfUrl).map(row => [row.id, row.pdfUrl!])));
  const missingOriginals = batch.filter(row => row.status !== 'PENDING_DISPATCH' && !row.pdfUrl).length;
  const [pendingIds, setPendingIds] = useState(() => batch.filter(row => row.status === 'PENDING_DISPATCH').map(row => row.id));
  const [marking, setMarking] = useState(false);
  const [confirmActive, setConfirmActive] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const qc = useQueryClient();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && scope === getCompanyScopeRevision();

  const markPrinted = async () => {
    if (!current() || busy.current || !pdf.url || !pendingIds.length) return;
    busy.current = true;
    setMarking(true);
    setMarkError(null);
    const ids = [...pendingIds];
    const results = await Promise.allSettled(ids.map(id => api.post('/overdue/letters/' + id + '/pdf-generated', {})));
    if (!current()) return;
    busy.current = false;
    setMarking(false);
    const failed = ids.filter((_, index) => results[index].status === 'rejected');
    setPendingIds(failed);
    for (const key of ['letters', 'letters-counts', 'letter-queue']) void qc.invalidateQueries({ queryKey: [key] });
    if (failed.length) {
      setMarkError('บันทึกสำเร็จ ' + (ids.length - failed.length) + ' ฉบับ ยังไม่สำเร็จ ' + failed.length + ' ฉบับ กดลองใหม่เฉพาะฉบับที่ค้างได้');
    } else {
      toast.success('บันทึกพิมพ์แล้ว ' + ids.length + ' ฉบับ');
      onClose();
    }
  };

  const handleDownload = () => {
    if (!current() || !pdf.url || marking) return;
    const anchor = document.createElement('a');
    anchor.href = pdf.url;
    anchor.download = 'letters-batch-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.pdf';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setConfirmActive(true);
  };

  const handlePrint = () => {
    if (!current() || !pdf.url || loadedUrl !== pdf.url || marking) return;
    try {
      if (!frame.current?.contentWindow) throw new Error('PDF not ready');
      frame.current.contentWindow.print();
      setConfirmActive(true);
    } catch {
      toast.error('เปิดหน้าพิมพ์ไม่ได้ กรุณาดาวน์โหลด PDF แล้วพิมพ์จากไฟล์');
    }
  };

  return (
    <Dialog open={open} onOpenChange={value => { if (!value && !marking) onClose(); }}>
      <DialogContent className="max-w-4xl w-[calc(100vw-2rem)] h-[85dvh] flex flex-col" showCloseButton={!marking}>
        <DialogHeader>
          <DialogTitle>พิมพ์รวม {batch.length} ฉบับ</DialogTitle>
          <DialogDescription>ดาวน์โหลดเก็บไว้ได้ เมื่อพิมพ์เสร็จแล้วจึงยืนยันสถานะ</DialogDescription>
          {missingOriginals > 0 && <p className="text-sm text-muted-foreground">{missingOriginals} ฉบับไม่มีไฟล์เดิมเก็บไว้ จึงสร้าง PDF จากวันที่และข้อมูลปัจจุบัน โปรดตรวจสอบก่อนใช้</p>}
        </DialogHeader>
        <div className="flex-1 min-h-0 bg-muted rounded-md overflow-hidden" aria-busy={pdf.loading}>
          {pdf.loading ? (
            <div role="status" className="size-full flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> กำลังสร้าง PDF...
            </div>
          ) : pdf.error ? (
            <div role="alert" className="h-full flex flex-col items-center justify-center gap-3 p-4 text-center">
              <p>สร้าง PDF ไม่สำเร็จ: {pdf.error}</p>
              <Button variant="outline" onClick={pdf.retry}>ลองใหม่</Button>
            </div>
          ) : pdf.url ? (
            <iframe ref={frame} src={pdf.url} className="w-full h-full" title="ตัวอย่างจดหมายรวม" onLoad={() => setLoadedUrl(pdf.url)} />
          ) : null}
        </div>
        {confirmActive && pendingIds.length > 0 && (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-3">
            <p>พิมพ์เสร็จแล้วจึงกดยืนยันเพื่อย้ายไปแท็บ พิมพ์แล้ว</p>
            {markError && <p role="alert" className="text-destructive">{markError}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={marking} onClick={() => setConfirmActive(false)}>ยังไม่พิมพ์</Button>
              <Button onClick={markPrinted} disabled={marking}>
                {marking ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {marking ? 'กำลังบันทึก...' : markError ? 'ลองบันทึกอีกครั้ง ' + pendingIds.length + ' ฉบับ' : 'ยืนยันพิมพ์แล้ว'}
              </Button>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" disabled={marking} onClick={onClose}>ปิด</Button>
          <Button variant="outline" onClick={handlePrint} disabled={!pdf.url || loadedUrl !== pdf.url || marking}>
            <Printer className="size-4" /> พิมพ์
          </Button>
          <Button onClick={handleDownload} disabled={!pdf.url || marking}>
            <Download className="size-4" /> ดาวน์โหลด PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
