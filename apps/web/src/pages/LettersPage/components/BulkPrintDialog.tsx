import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Printer, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { PDFDocument } from 'pdf-lib';
import api from '@/lib/api';
import type { LetterRow } from '../types';

/**
 * Fetch each letter PDF from the backend (Puppeteer-rendered), then merge
 * with pdf-lib into a single multi-page PDF Blob. The backend endpoint
 * handles font embedding + pagination — frontend just stitches the bytes.
 */
async function fetchAndMergeLetterPdfs(rows: LetterRow[]): Promise<Blob> {
  if (rows.length === 0) throw new Error('no letters');
  const merged = await PDFDocument.create();
  for (const r of rows) {
    const res = await api.get(`/overdue/letters/${r.id}/pdf`, { responseType: 'arraybuffer' });
    const doc = await PDFDocument.load(res.data as ArrayBuffer);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  const bytes = await merged.save();
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}

interface Props {
  open: boolean;
  rows: LetterRow[];
  onClose: () => void;
}

export default function BulkPrintDialog({ open, rows, onClose }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [marking, setMarking] = useState(false);
  const [printConfirmActive, setPrintConfirmActive] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
      setPrintConfirmActive(false);
      return;
    }
    setBuilding(true);
    (async () => {
      try {
        const blob = await fetchAndMergeLetterPdfs(rows);
        setBlobUrl(URL.createObjectURL(blob));
      } catch (err: any) {
        toast.error(`สร้าง PDF ล้มเหลว: ${err.message}`);
      } finally {
        setBuilding(false);
      }
    })();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const markAllPdfGenerated = async () => {
    setMarking(true);
    const results = await Promise.allSettled(
      rows.map((r) => api.post(`/overdue/letters/${r.id}/pdf-generated`, {})),
    );
    setMarking(false);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === 0) {
      toast.success(`ทำเครื่องหมายพิมพ์แล้ว ${rows.length} ฉบับ — ย้ายไปแท็บ พิมพ์แล้ว`);
    } else {
      toast.error(`สำเร็จ ${rows.length - failed.length} ฉบับ, ค้าง ${failed.length} ฉบับ`);
    }
    qc.invalidateQueries({ queryKey: ['letters'] });
    onClose();
  };

  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `letters-batch-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.pdf`;
    a.click();
    markAllPdfGenerated();
  };

  const handlePrint = () => {
    if (!blobUrl) return;
    const iframe = document.getElementById('bulk-pdf-iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.print();
    setPrintConfirmActive(true);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>พิมพ์รวม {rows.length} ฉบับ</DialogTitle>
        </DialogHeader>
        <div className="flex-1 bg-muted rounded-md overflow-hidden">
          {building ? (
            <div className="size-full flex items-center justify-center text-muted-foreground">
              กำลังสร้าง PDF...
            </div>
          ) : blobUrl ? (
            <iframe id="bulk-pdf-iframe" src={blobUrl} className="w-full h-full" title="PDF preview" />
          ) : null}
        </div>
        {printConfirmActive && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm flex items-center justify-between">
            <span>พิมพ์เสร็จแล้ว? — กดยืนยันเพื่อย้ายไปแท็บ พิมพ์แล้ว</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPrintConfirmActive(false)}>
                ยังไม่พิมพ์
              </Button>
              <Button size="sm" onClick={markAllPdfGenerated} disabled={marking}>
                <Check className="size-4 mr-1" /> ทำเครื่องหมายพิมพ์แล้ว
              </Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            <X className="size-4 mr-1" /> ปิด
          </Button>
          <Button variant="outline" onClick={handlePrint} disabled={!blobUrl || building}>
            <Printer className="size-4 mr-1" /> พิมพ์
          </Button>
          <Button onClick={handleDownload} disabled={!blobUrl || building}>
            <Download className="size-4 mr-1" /> ดาวน์โหลด PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
