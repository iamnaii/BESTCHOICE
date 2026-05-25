import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Upload } from 'lucide-react';
import api from '@/lib/api';
import type { CannedResponseBubble } from '../types';

interface Props {
  bubble: CannedResponseBubble;
  onChange: (patch: Partial<CannedResponseBubble>) => void;
}

export default function ImageBubbleEditor({ bubble, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ใหญ่เกิน 10 MB');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res: any = await api.post('/line-oa/broadcast/upload-image', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url = res?.data?.url ?? res?.url;
      if (url) {
        onChange({ mediaUrl: url });
        toast.success('อัพโหลดแล้ว');
      } else {
        toast.error('ไม่ได้ URL กลับมา');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'อัพโหลดไม่สำเร็จ');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <Input
        value={bubble.mediaUrl ?? ''}
        onChange={(e) => onChange({ mediaUrl: e.target.value })}
        placeholder="URL รูป หรือ อัพโหลด"
      />
      <div className="flex items-center gap-2">
        <input type="file" accept="image/*" ref={fileRef} onChange={handleFile} className="hidden" />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Upload className="w-3.5 h-3.5 mr-1.5" />
          {uploading ? 'กำลังอัพ...' : 'อัพโหลดรูป'}
        </Button>
        {bubble.mediaUrl && (
          <span className="text-xs text-muted-foreground truncate flex-1">{bubble.mediaUrl}</span>
        )}
      </div>
      {bubble.mediaUrl && (
        <img src={bubble.mediaUrl} alt="preview" className="max-w-xs max-h-48 rounded border border-border" />
      )}
    </div>
  );
}
