import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2, Printer, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { DocumentRequestError, getDocumentErrorMessage, getProtectedDocument } from '@/lib/document-download';
import { getCompanyScopeRevision } from '@/lib/company-scope';

type Props = { title: string; filename: string; onClose: () => void } & (
  { path: string; blob?: never } | { blob: Blob; path?: never }
);

/** Fetch only while open, preserve the server bytes, and release them on close. */
export default function PdfPreview({ title, filename, onClose, path, blob }: Props) {
  const instance = useId();
  const [returnFocus] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [scope] = useState(getCompanyScopeRevision);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const query = useQuery({
    queryKey: ['document-preview', instance, scope, path],
    queryFn: ({ signal }) => {
      if (scope !== getCompanyScopeRevision()) throw new DocumentRequestError('เปลี่ยนบริษัทแล้ว กรุณาเปิดเอกสารใหม่');
      return getProtectedDocument(path!, { signal });
    },
    enabled: !!path,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const data = blob ?? query.data;
  useEffect(() => {
    if (!data) return;
    const url = URL.createObjectURL(data);
    setPreview({ blob: data, url });
    return () => URL.revokeObjectURL(url);
  }, [data]);
  const scopeChanged = scope !== getCompanyScopeRevision();
  const url = !scopeChanged && preview?.blob === data ? preview?.url : undefined;
  const error = scopeChanged ? 'เปลี่ยนบริษัทแล้ว กรุณาเปิดเอกสารใหม่' : query.isError ? getDocumentErrorMessage(query.error) : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined}
        className="w-[calc(100%-2rem)] max-w-4xl max-h-[calc(100dvh-2rem)]"
        onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus(); }}>
        <DialogHeader className="pr-12 mb-0"><DialogTitle>{title}</DialogTitle></DialogHeader>
        <DialogClose asChild><Button variant="ghost" className="absolute right-3 top-3 size-11" aria-label="ปิดตัวอย่าง"><X className="size-4" aria-hidden /></Button></DialogClose>
        <div className="min-h-0 overflow-y-auto py-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 break-all text-sm text-muted-foreground">{filename}</p>
        {url && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11" disabled={loadedUrl !== url} onClick={() => {
              try { iframe.current?.contentWindow?.print(); }
              catch { toast.error('เปิดหน้าพิมพ์ไม่ได้ กรุณาดาวน์โหลด PDF เพื่อพิมพ์'); }
            }}><Printer className="size-4" aria-hidden /> พิมพ์</Button>
            <a href={url} download={filename} className={buttonVariants({ variant: 'primary', className: 'min-h-11' })}>
              <Download className="size-4" aria-hidden /> ดาวน์โหลด PDF
            </a>
          </div>
        )}
      </div>
      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-medium">เปิด PDF ไม่สำเร็จ</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          {!scopeChanged && <Button variant="outline" className="mt-3 min-h-11" onClick={() => { void query.refetch(); }}><RotateCcw className="size-4" aria-hidden /> ลองใหม่</Button>}
        </div>
      ) : url ? (
        <iframe key={url} ref={iframe} src={`${url}#toolbar=0&view=FitH`} title={filename}
          onLoad={() => setLoadedUrl(url)} className="h-[60vh] w-full rounded-md border border-border bg-muted" />
      ) : (
        <div role="status" aria-busy="true" className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden /> กำลังเตรียมเอกสาร…
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">หากมือถือไม่แสดงตัวอย่าง สามารถดาวน์โหลด PDF เพื่อเปิดดูหรือพิมพ์ได้</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
