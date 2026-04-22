import { useMemo } from 'react';

const CATALOG: Record<string, Record<string, string[]>> = {
  Apple: {
    'iPhone 11': ['64GB', '128GB', '256GB'],
    'iPhone 12': ['64GB', '128GB', '256GB'],
    'iPhone 13': ['128GB', '256GB', '512GB'],
    'iPhone 14': ['128GB', '256GB', '512GB'],
    'iPhone 15': ['128GB', '256GB', '512GB'],
  },
  Samsung: {
    'Galaxy S23': ['128GB', '256GB'],
    'Galaxy S24': ['128GB', '256GB'],
  },
};

export interface DeviceSelectorValue {
  brand: string;
  model: string;
  storage: string;
}

interface Props {
  value: DeviceSelectorValue;
  onChange: (v: DeviceSelectorValue) => void;
}

export default function DeviceSelector({ value, onChange }: Props) {
  const models = useMemo(
    () => (value.brand ? Object.keys(CATALOG[value.brand] ?? {}) : []),
    [value.brand],
  );
  const storages = useMemo(
    () => (value.brand && value.model ? (CATALOG[value.brand]?.[value.model] ?? []) : []),
    [value.brand, value.model],
  );

  return (
    <div className="grid sm:grid-cols-3 gap-4 leading-snug">
      <select
        className="rounded-md border border-input bg-background px-3 py-2"
        value={value.brand}
        onChange={(e) => onChange({ brand: e.target.value, model: '', storage: '' })}
        aria-label="ยี่ห้อ"
      >
        <option value="">ยี่ห้อ</option>
        {Object.keys(CATALOG).map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
      <select
        className="rounded-md border border-input bg-background px-3 py-2"
        value={value.model}
        onChange={(e) => onChange({ ...value, model: e.target.value, storage: '' })}
        disabled={!value.brand}
        aria-label="รุ่น"
      >
        <option value="">รุ่น</option>
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select
        className="rounded-md border border-input bg-background px-3 py-2"
        value={value.storage}
        onChange={(e) => onChange({ ...value, storage: e.target.value })}
        disabled={!value.model}
        aria-label="ความจุ"
      >
        <option value="">ความจุ</option>
        {storages.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}
