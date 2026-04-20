import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Upload, CreditCard, Loader2 } from 'lucide-react';
import { checkCardReaderStatus, readSmartCard } from '@/lib/cardReader';
import { toast } from 'sonner';
import type { QuickIntakeForm } from '../types';

interface Props {
  form: QuickIntakeForm;
  onChange: (patch: Partial<QuickIntakeForm>) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

export default function QuickIntakeStep({ form, onChange, onSubmit, isSubmitting }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cardReaderLoading, setCardReaderLoading] = useState(false);

  const handleSmartCard = async () => {
    setCardReaderLoading(true);
    try {
      const status = await checkCardReaderStatus();
      if (!status || status.status !== 'card_inserted') {
        toast.error('กรุณาเสียบเครื่องอ่านบัตรและใส่บัตรประชาชน');
        return;
      }
      const card = await readSmartCard();
      onChange({
        nationalId: card.nationalId || form.nationalId,
        prefix: card.prefix || form.prefix,
        firstName: card.firstName || form.firstName,
        lastName: card.lastName || form.lastName,
      });
      toast.success('อ่านบัตรสำเร็จ');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'อ่านบัตรไม่สำเร็จ');
    } finally {
      setCardReaderLoading(false);
    }
  };

  const canSubmit =
    /^\d{13}$/.test(form.nationalId) &&
    /^0\d{8,9}$/.test(form.phone) &&
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    form.statementFiles.length > 0;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">ข้อมูลเบื้องต้น</h3>
          <Button variant="outline" size="sm" onClick={handleSmartCard} disabled={cardReaderLoading}>
            {cardReaderLoading ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
            อ่านบัตร (Smart Card)
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">คำนำหน้า</label>
            <Input
              value={form.prefix || ''}
              onChange={(e) => onChange({ prefix: e.target.value })}
              placeholder="นาย / นาง / น.ส."
            />
          </div>
          <div />
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">ชื่อ *</label>
            <Input
              value={form.firstName}
              onChange={(e) => onChange({ firstName: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">นามสกุล *</label>
            <Input
              value={form.lastName}
              onChange={(e) => onChange({ lastName: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">เลขบัตรประชาชน *</label>
            <Input
              value={form.nationalId}
              onChange={(e) => onChange({ nationalId: e.target.value.replace(/\D/g, '').slice(0, 13) })}
              placeholder="1234567890123"
              maxLength={13}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">เบอร์โทร *</label>
            <Input
              value={form.phone}
              onChange={(e) => onChange({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              placeholder="0812345678"
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Statement ธนาคาร 3 เดือน *</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              จำเป็นสำหรับการวิเคราะห์เครดิตด้วย AI
            </p>
          </div>
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

      <div className="flex justify-end">
        <Button variant="primary" size="lg" onClick={onSubmit} disabled={!canSubmit || isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              กำลังเช็คเครดิต...
            </>
          ) : (
            'เช็คเครดิตเบื้องต้น'
          )}
        </Button>
      </div>
    </div>
  );
}
