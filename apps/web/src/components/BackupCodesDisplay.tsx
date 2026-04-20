import { useState } from 'react';
import { Copy, Download, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface BackupCodesDisplayProps {
  codes: string[];
}

export default function BackupCodesDisplay({ codes }: BackupCodesDisplayProps) {
  const [copied, setCopied] = useState(false);

  function handleCopyAll() {
    const text = codes.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success('คัดลอก backup codes แล้ว');
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDownload() {
    const lines = [
      'BESTCHOICE - Backup Codes สำหรับ 2FA',
      '=======================================',
      'เก็บรหัสเหล่านี้ไว้ในที่ปลอดภัย',
      'รหัสแต่ละชุดใช้ได้ครั้งเดียวเท่านั้น',
      '',
      ...codes,
      '',
      `สร้างเมื่อ: ${new Date().toLocaleString('th-TH')}`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'bestchoice-backup-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
    toast.success('ดาวน์โหลด backup codes แล้ว');
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg border border-border">
        {codes.map((code) => (
          <code
            key={code}
            className="text-sm font-mono text-center py-1.5 px-2 bg-background rounded border border-border text-foreground tracking-widest"
          >
            {code}
          </code>
        ))}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={handleCopyAll}
        >
          {copied ? (
            <>
              <Check className="size-4 mr-2 text-primary" />
              คัดลอกแล้ว
            </>
          ) : (
            <>
              <Copy className="size-4 mr-2" />
              คัดลอกทั้งหมด
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={handleDownload}
        >
          <Download className="size-4 mr-2" />
          ดาวน์โหลด .txt
        </Button>
      </div>
    </div>
  );
}
