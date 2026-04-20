import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CreditCard, Loader2, ArrowRight } from 'lucide-react';
import { checkCardReaderStatus, readSmartCard } from '@/lib/cardReader';
import { toast } from 'sonner';
import { THAI_NAME_PREFIXES } from '@/lib/constants';
import type { QuickIntakeForm } from '../types';

function formatNationalId(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 13);
  if (d.length <= 1) return d;
  if (d.length <= 5) return `${d.slice(0, 1)}-${d.slice(1)}`;
  if (d.length <= 10) return `${d.slice(0, 1)}-${d.slice(1, 5)}-${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 1)}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10)}`;
  return `${d.slice(0, 1)}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d.slice(12)}`;
}

function formatPhone(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

interface Props {
  form: QuickIntakeForm;
  onChange: (patch: Partial<QuickIntakeForm>) => void;
  onNext: () => void;
}

export default function QuickIntakeStep({ form, onChange, onNext }: Props) {
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

  const canNext =
    /^\d{13}$/.test(form.nationalId) &&
    /^0\d{8,9}$/.test(form.phone) &&
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0;

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
            <select
              value={form.prefix || ''}
              onChange={(e) => onChange({ prefix: e.target.value })}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">-- เลือก --</option>
              {THAI_NAME_PREFIXES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
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
              value={formatNationalId(form.nationalId)}
              onChange={(e) => onChange({ nationalId: e.target.value.replace(/\D/g, '').slice(0, 13) })}
              placeholder="1-2345-67890-12-3"
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">เบอร์โทร *</label>
            <Input
              value={formatPhone(form.phone)}
              onChange={(e) => onChange({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              placeholder="081-234-5678"
              inputMode="tel"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" size="lg" onClick={onNext} disabled={!canNext}>
          ถัดไป: เช็คเครดิต
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
