import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Upload, Loader2, ArrowLeft, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
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

  const canSubmit = form.statementFiles.length > 0 && !!form.bankName && !ocrLoading;

  const handleFiles = async (files: File[]) => {
    onChange({ statementFiles: files });

    const firstImage = files.find((f) => f.type.startsWith('image/'));
    if (!firstImage) return;

    setOcrLoading(true);
    try {
      const imageBase64 = await compressImageForOcr(firstImage);
      const { data } = await api.post(
        '/ocr/bank-statement',
        { imageBase64 },
        { timeout: 90000 },
      );
      if (data?.bankName) {
        onChange({ bankName: data.bankName });
        toast.success(`อ่าน statement สำเร็จ — ธนาคาร: ${data.bankName}`);
      } else {
        toast.warning('อ่าน statement สำเร็จ แต่ไม่พบชื่อธนาคาร — กรุณากรอกเอง');
      }
    } catch (err) {
      toast.error('อ่าน statement ไม่สำเร็จ — กรุณากรอกธนาคารเอง');
      // Silent: OCR is best-effort. User can still type bank name manually.
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
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={ocrLoading}
            className="w-full border-2 border-dashed border-border hover:border-primary/50 rounded-lg p-6 flex flex-col items-center gap-1 transition disabled:opacity-50"
          >
            <Upload className="size-6 text-muted-foreground" />
            <span className="text-sm text-foreground">
              {form.statementFiles.length > 0
                ? `เลือกแล้ว ${form.statementFiles.length} ไฟล์`
                : 'ลากไฟล์หรือคลิกเลือก'}
            </span>
            <span className="text-xs text-muted-foreground">รูปภาพหรือ PDF หลายไฟล์ได้</span>
          </button>
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
            readOnly
            placeholder={
              ocrLoading
                ? 'กำลังอ่าน...'
                : form.statementFiles.length === 0
                  ? 'จะแสดงหลัง upload statement'
                  : 'ไม่สามารถอ่านได้ — กรุณา upload ใหม่'
            }
            className="bg-muted/50 cursor-not-allowed"
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
