import { formControlClass } from '@/components/ui/form-styles';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';

export interface PriceRow {
  label: string;
  amount: string;
  isDefault: boolean;
}

interface PriceCardProps {
  prices: PriceRow[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof PriceRow, value: string | boolean) => void;
}

export default function PriceCard({ prices, onAdd, onRemove, onUpdate }: PriceCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>ราคาขาย</CardTitle>
        <button
          type="button"
          onClick={onAdd}
          className="text-sm text-primary hover:text-primary/80 font-medium"
        >
          + เพิ่มราคา
        </button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {prices.map((price, index) => (
            <div key={index} className="flex min-w-0 flex-wrap items-center gap-3">
              <input
                type="text"
                placeholder="ชื่อราคา เช่น ราคาผ่อน"
                aria-label={`ชื่อราคา ${index + 1}`}
                value={price.label}
                onChange={(e) => onUpdate(index, 'label', e.target.value)}
                className={cn(formControlClass, 'sm:flex-1 sm:basis-40')}
              />
              <input
                type="number"
                step="0.01"
                placeholder="จำนวนเงิน"
                aria-label={`จำนวนเงินราคา ${index + 1}`}
                value={price.amount}
                onChange={(e) => onUpdate(index, 'amount', e.target.value)}
                className={cn(formControlClass, 'sm:w-40')}
              />
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground whitespace-nowrap cursor-pointer">
                <input
                  type="radio"
                  name="defaultPrice"
                  checked={price.isDefault}
                  onChange={() => onUpdate(index, 'isDefault', true)}
                  className="text-primary"
                />
                ค่าเริ่มต้น
              </label>
              {prices.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  aria-label={`ลบราคา ${index + 1}`}
                  className="min-h-11 min-w-11 text-destructive/70 hover:text-destructive text-lg"
                >
                  &times;
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          ราคา "ค่าเริ่มต้น" จะถูกใช้ตอนสร้างสัญญาผ่อน (พนักงานสามารถเปลี่ยนได้)
        </p>
      </CardContent>
    </Card>
  );
}
