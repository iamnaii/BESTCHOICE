import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Upload, Loader2, ArrowLeft, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { fileToOcrBase64 } from '@/lib/compressImage';
import type { QuickIntakeForm } from '../types';

interface Props {
  form: QuickIntakeForm;
  onChange: (patch: Partial<QuickIntakeForm>) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
}

export default function PreCheckUploadStep({ form, onChange, onSubmit, onBack, isSubmitting }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const canSubmit = form.statementFiles.length > 0 && !!form.bankName && !ocrLoading;

  const handleFiles = async (files: File[]) => {
    onChange({ statementFiles: files, bankName: undefined });

    const supported = files.filter(
      (f) => f.type.startsWith('image/') || f.type === 'application/pdf',
    );
    if (supported.length === 0) {
      toast.error('กรุณาเลือกรูปภาพหรือ PDF');
      return;
    }
    if (supported.length !== files.length) {
      toast.warning('บางไฟล์ไม่รองรับ — ใช้เฉพาะรูปภาพและ PDF');
    }

    setOcrLoading(true);
    try {
      const filesBase64 = await Promise.all(supported.map(fileToOcrBase64));
      const { data } = await api.post(
        '/ocr/bank-statement',
        { filesBase64 },
        { timeout: 120000 },
      );
      if (data?.bankName) {
        onChange({ bankName: data.bankName });
        toast.success(`อ่าน statement สำเร็จ — ธนาคาร: ${data.bankName}`);
      } else {
        toast.warning('อ่าน statement สำเร็จ แต่ไม่พบชื่อธนาคาร — กรุณากรอกเอง');
      }
    } catch (err) {
      toast.error('อ่าน statement ไม่สำเร็จ — กรุณากรอกธนาคารเอง');
      void err;
    } finally {
      setOcrLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Statement ธนาคาร 3 เดือน *</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            จำเป็นสำหรับการวิเคราะห์เครดิตด้วย AI
          </p>
        </div>

        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            multiple
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              void handleFiles(files);
            }}
            className="hidden"
          />
          <div
            role="button"
            tabIndex={ocrLoading ? -1 : 0}
            aria-disabled={ocrLoading}
            onClick={() => !ocrLoading && fileRef.current?.click()}
            onKeyDown={(e) => {
              if (ocrLoading) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              if (ocrLoading) return;
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
              if (ocrLoading) return;
              const dropped = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
              if (dropped.length > 0) void handleFiles(dropped);
            }}
            className={`w-full border-2 border-dashed rounded-lg p-6 flex flex-col items-center gap-1 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
              ocrLoading
                ? 'opacity-50 cursor-not-allowed border-border'
                : isDragging
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
            }`}
          >
            <Upload className={`size-6 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
            <span className="text-sm text-foreground">
              {isDragging
                ? 'วางไฟล์ที่นี่'
                : form.statementFiles.length > 0
                  ? `เลือกแล้ว ${form.statementFiles.length} ไฟล์`
                  : 'ลากไฟล์มาวางหรือคลิกเลือก'}
            </span>
            <span className="text-xs text-muted-foreground">รูปภาพหรือ PDF หลายไฟล์ได้</span>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-foreground mb-1 flex items-center gap-1.5">
            ธนาคาร
            {ocrLoading && (
              <span className="inline-flex items-center gap-1 text-[11px] text-primary font-normal">
                <Loader2 className="size-3 animate-spin" />
                กำลังอ่านจาก statement...
              </span>
            )}
            {!ocrLoading && form.bankName && (
              <span className="inline-flex items-center gap-1 text-[11px] text-success font-normal">
                <Sparkles className="size-3" />
                อ่านจาก statement
              </span>
            )}
          </label>
          <Input
            value={form.bankName || ''}
            onChange={(e) => onChange({ bankName: e.target.value })}
            disabled={ocrLoading}
            placeholder={
              ocrLoading
                ? 'กำลังอ่าน...'
                : form.statementFiles.length === 0
                  ? 'จะแสดงหลัง upload statement'
                  : 'อ่านไม่ได้ — พิมพ์ชื่อธนาคารเอง'
            }
          />
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={isSubmitting || ocrLoading}>
          <ArrowLeft className="size-4" />
          กลับ
        </Button>
        <Button variant="primary" size="lg" onClick={onSubmit} disabled={!canSubmit || isSubmitting || ocrLoading}>
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              กำลังวิเคราะห์...
            </>
          ) : (
            'เริ่มเช็คเครดิต'
          )}
        </Button>
      </div>
    </div>
  );
}
