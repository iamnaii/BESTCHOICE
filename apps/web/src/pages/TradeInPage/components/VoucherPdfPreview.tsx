import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { buttonVariants } from '@/components/ui/button';

/** Keep the authenticated PDF alive while previewing; download the same bytes with its name. */
export default function VoucherPdfPreview({
  blob,
  filename,
  onClose,
}: {
  blob: Blob;
  filename: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return (
    <Modal isOpen title="ตัวอย่างเอกสารรับเครื่อง" onClose={onClose} size="xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 break-all text-sm text-muted-foreground">{filename}</p>
        {url && (
          <a href={url} download={filename} className={buttonVariants({ variant: 'primary' })}>
            <Download className="size-4" /> ดาวน์โหลด PDF
          </a>
        )}
      </div>
      {url && (
        <iframe
          src={`${url}#toolbar=0&view=FitH`}
          title={filename}
          className="h-[60vh] w-full rounded-md border border-border bg-muted"
        />
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        ดาวน์โหลดไฟล์เพื่อส่งต่อหรือพิมพ์เอกสาร หากมือถือไม่แสดงตัวอย่าง
        สามารถดาวน์โหลดเพื่อเปิดดูได้
      </p>
    </Modal>
  );
}
