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
            <div key={index} className="flex items-center gap-3">
              <input
                type="text"
                placeholder="ชื่อราคา เช่น ราคาผ่อน"
                value={price.label}
                onChange={(e) => onUpdate(index, 'label', e.target.value)}
                className="flex-1 px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden text-sm"
              />
              <input
                type="number"
                step="0.01"
                placeholder="จำนวนเงิน"
                value={price.amount}
                onChange={(e) => onUpdate(index, 'amount', e.target.value)}
                className="w-40 px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden text-sm"
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
                  className="text-red-400 hover:text-red-600 text-lg"
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
