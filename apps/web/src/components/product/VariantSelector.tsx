import { cn } from '@/lib/utils';

/* ─── Predefined variants for Apple products (BESTCHOICE) ─── */

export const IPHONE_COLORS = [
  { value: 'Black', label: 'ดำ', hex: '#1d1d1f' },
  { value: 'White', label: 'ขาว', hex: '#f5f5f7' },
  { value: 'Blue', label: 'น้ำเงิน', hex: '#4169a5' },
  { value: 'Red', label: 'แดง', hex: '#c41e3a' },
  { value: 'Green', label: 'เขียว', hex: '#4a6741' },
  { value: 'Purple', label: 'ม่วง', hex: '#7b6e8d' },
  { value: 'Yellow', label: 'เหลือง', hex: '#f9e200' },
  { value: 'Pink', label: 'ชมพู', hex: '#f9c2cb' },
  { value: 'Natural Titanium', label: 'ไทเทเนียม', hex: '#a8a49d' },
  { value: 'Blue Titanium', label: 'ไทเทเนียมน้ำเงิน', hex: '#3d4654' },
  { value: 'Black Titanium', label: 'ไทเทเนียมดำ', hex: '#3a3a3c' },
  { value: 'White Titanium', label: 'ไทเทเนียมขาว', hex: '#e3dcd2' },
  { value: 'Desert Titanium', label: 'ไทเทเนียมทะเลทราย', hex: '#c4a882' },
];

export const STORAGE_OPTIONS = [
  '64GB', '128GB', '256GB', '512GB', '1TB',
];

export const IPAD_STORAGE_OPTIONS = [
  '64GB', '128GB', '256GB', '512GB', '1TB', '2TB',
];

/* ─── Color Selector ─── */

interface ColorSelectorProps {
  value: string;
  onChange: (value: string) => void;
  colors?: typeof IPHONE_COLORS;
}

export function ColorSelector({ value, onChange, colors = IPHONE_COLORS }: ColorSelectorProps) {
  const isCustom = value && !colors.some((c) => c.value === value);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {colors.map((color) => (
          <button
            key={color.value}
            type="button"
            onClick={() => onChange(color.value)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
              value === color.value
                ? 'border-primary bg-primary/5 text-primary ring-2 ring-primary/20'
                : 'border-border hover:border-input text-foreground',
            )}
          >
            <span
              className="size-4 rounded-full border border-border/50 shrink-0"
              style={{ backgroundColor: color.hex }}
            />
            {color.label}
          </button>
        ))}
      </div>
      {/* Custom input fallback */}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="หรือพิมพ์สีเอง..."
        className={cn(
          'w-full px-3 py-2 border border-input rounded-lg text-sm placeholder:text-muted-foreground/60',
          isCustom && 'border-primary ring-2 ring-primary/20',
        )}
      />
    </div>
  );
}

/* ─── Storage Selector ─── */

interface StorageSelectorProps {
  value: string;
  onChange: (value: string) => void;
  options?: string[];
}

export function StorageSelector({ value, onChange, options = STORAGE_OPTIONS }: StorageSelectorProps) {
  const isCustom = value && !options.includes(value);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              'px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
              value === opt
                ? 'border-primary bg-primary/5 text-primary ring-2 ring-primary/20'
                : 'border-border hover:border-input text-foreground',
            )}
          >
            {opt}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="หรือพิมพ์ความจุเอง..."
        className={cn(
          'w-full px-3 py-2 border border-input rounded-lg text-sm placeholder:text-muted-foreground/60',
          isCustom && 'border-primary ring-2 ring-primary/20',
        )}
      />
    </div>
  );
}
