import { useId } from 'react';
import { formLabelClass, formTextareaClass } from '@/components/ui/form-styles';
import { cn } from '@/lib/utils';
import FormSection from './FormSection';

interface WarrantyOption {
  value: string;
  title: string;
  sub: string;
}

/**
 * ตัวเลือกประกันร้านตามประเภท
 * - มือสอง: ค่าเริ่มต้น 60 วัน (นโยบายเดิม `DEFAULT_SHOP_WARRANTY_DAYS`) · "ไม่มี" = 0 (ขายตามสภาพ)
 * - มือถือใหม่/แท็บเล็ต: ค่าเริ่มต้นไม่มีประกันร้าน (ค่าว่าง = ใช้ประกันศูนย์อย่างเดียว ตามนโยบายเดิม)
 */
export function shopWarrantyOptions(category: string): WarrantyOption[] {
  if (category === 'PHONE_USED') {
    return [
      { value: '30', title: '30 วัน', sub: 'ประกันร้าน' },
      { value: '60', title: '60 วัน', sub: 'ค่าเริ่มต้น' },
      { value: '0', title: 'ไม่มี', sub: 'ขายตามสภาพ' },
    ];
  }
  return [
    { value: '30', title: '30 วัน', sub: 'ประกันร้าน' },
    { value: '60', title: '60 วัน', sub: 'ประกันร้าน' },
    { value: '', title: 'ไม่มี', sub: 'ใช้ประกันศูนย์อย่างเดียว' },
  ];
}

/** ค่าเริ่มต้นของช่องประกันร้านเมื่อเปลี่ยนประเภท */
export function defaultShopWarrantyDays(category: string): string {
  return category === 'PHONE_USED' ? '60' : '';
}

export default function ShopWarrantySection({
  number,
  category,
  days,
  onDaysChange,
  terms,
  termsEdited,
  onTermsChange,
  onUseDefaultTerms,
}: {
  number: number;
  category: string;
  days: string;
  onDaysChange: (days: string) => void;
  /** ข้อความในช่อง (ค่าเริ่มต้นของร้านเมื่อยังไม่แก้) */
  terms: string;
  termsEdited: boolean;
  onTermsChange: (terms: string) => void;
  onUseDefaultTerms: () => void;
}) {
  const id = useId();
  const hasShopWarranty = Number(days) > 0;
  const options = shopWarrantyOptions(category);
  return (
    <FormSection
      number={number}
      title="ประกันร้าน"
      subtitle="พิมพ์บนใบเสร็จ ใบสัญญา และส่งให้ลูกค้าทาง LINE"
    >
      <div className="space-y-5">
        <div role="group" aria-labelledby={`${id}-days`}>
          <span id={`${id}-days`} className={formLabelClass}>
            ระยะประกันร้าน
          </span>
          <div className="grid grid-cols-3 gap-2">
            {options.map((opt) => {
              const on = opt.value === days;
              return (
                <button
                  key={opt.value || 'none'}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onDaysChange(opt.value)}
                  className={cn(
                    'flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
                    on
                      ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
                      : 'border-input bg-card text-foreground hover:border-primary/60',
                  )}
                >
                  <span className="text-base font-semibold leading-snug">{opt.title}</span>
                  <span
                    className={cn(
                      'text-xs leading-snug',
                      on ? 'font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {opt.sub}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor={`${id}-terms`} className={formLabelClass}>
            ผู้รับประกันและเงื่อนไขความคุ้มครอง
          </label>
          <textarea
            id={`${id}-terms`}
            rows={4}
            maxLength={2000}
            className={cn(formTextareaClass, 'leading-relaxed')}
            value={terms}
            placeholder={hasShopWarranty ? undefined : 'ไม่บังคับ — เช่น ประกันศูนย์ถึงวันที่ …'}
            aria-describedby={`${id}-terms-hint`}
            onChange={(e) => onTermsChange(e.target.value)}
          />
          <p id={`${id}-terms-hint`} className="mt-1.5 text-xs leading-snug text-muted-foreground">
            {!hasShopWarranty ? (
              'ไม่มีประกันร้าน — ใส่เงื่อนไขประกันศูนย์ได้ถ้ามี'
            ) : termsEdited ? (
              <>
                แก้เฉพาะเครื่องนี้แล้ว ·{' '}
                <button
                  type="button"
                  onClick={onUseDefaultTerms}
                  className="inline-flex items-center font-medium text-primary underline-offset-2 hover:underline max-lg:min-h-11"
                >
                  ใช้ข้อความเริ่มต้น
                </button>
              </>
            ) : (
              'เติมจากข้อความมาตรฐานของร้าน (เจ้าของแก้ได้ที่ ตั้งค่า › สินค้า & การขาย › ใบเสร็จขายสด) · แก้เฉพาะเครื่องนี้ได้'
            )}
          </p>
        </div>
      </div>
    </FormSection>
  );
}
