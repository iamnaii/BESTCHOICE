import { toast } from 'sonner';
import { Copy, Link2 } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

interface Props {
  summaryText: string;
  shareUrl: string;
  isReady: boolean;
}

export default function CustomerSummaryActions({ summaryText, shareUrl, isReady }: Props) {
  const { copy } = useCopyToClipboard();

  const handleCopy = async (text: string, okMessage: string) => {
    const ok = await copy(text);
    if (ok) toast.success(okMessage);
    else toast.error('คัดลอกไม่สำเร็จ — กดค้างเพื่อคัดลอกเองได้');
  };

  return (
    <div className="flex gap-2 flex-wrap">
      <button
        type="button"
        onClick={() => handleCopy(summaryText, 'คัดลอกสรุปแล้ว — วางในแชทได้เลย')}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 leading-snug min-h-11"
      >
        <Copy className="size-4" aria-hidden />
        คัดลอกสรุปส่งลูกค้า
      </button>
      <button
        type="button"
        disabled={!isReady}
        title={isReady ? 'คัดลอกลิงก์หน้าสินค้าฝั่งลูกค้า' : 'เครื่องนี้ยังไม่ขึ้นเว็บ — ลิงก์จะเปิดไม่เจอ'}
        onClick={() => handleCopy(shareUrl, 'คัดลอกลิงก์แล้ว')}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-primary border border-input rounded-lg hover:bg-muted/50 disabled:opacity-50 disabled:pointer-events-none leading-snug min-h-11"
      >
        <Link2 className="size-4" aria-hidden />
        คัดลอกลิงก์
      </button>
    </div>
  );
}
