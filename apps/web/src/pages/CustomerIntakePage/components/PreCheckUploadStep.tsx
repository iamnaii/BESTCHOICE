import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Upload, Loader2, ArrowLeft } from 'lucide-react';
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

  const canSubmit = form.statementFiles.length > 0;

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
          <label className="block text-xs font-medium text-foreground mb-1">ธนาคาร</label>
          <Input
            value={form.bankName || ''}
            onChange={(e) => onChange({ bankName: e.target.value })}
            placeholder="เช่น กสิกรไทย"
          />
        </div>

        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            multiple
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              onChange({ statementFiles: files });
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-border hover:border-primary/50 rounded-lg p-6 flex flex-col items-center gap-1 transition"
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
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={isSubmitting}>
          <ArrowLeft className="size-4" />
          กลับ
        </Button>
        <Button variant="primary" size="lg" onClick={onSubmit} disabled={!canSubmit || isSubmitting}>
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
