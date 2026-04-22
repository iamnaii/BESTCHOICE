import { useMemo } from 'react';

// Mirrors the rows in prisma/seeds/trade-in-valuations.ts — keep in sync when
// new models are added to the valuation table, or replace with an API lookup.
const CATALOG: Record<string, Record<string, string[]>> = {
  Apple: {
    'iPhone 13': ['128GB'],
    'iPhone 13 Pro': ['128GB'],
    'iPhone 13 Pro Max': ['256GB'],
    'iPhone 14': ['128GB'],
    'iPhone 14 Pro': ['128GB'],
    'iPhone 14 Pro Max': ['256GB'],
    'iPhone 15': ['128GB', '256GB'],
    'iPhone 15 Pro': ['256GB'],
    'iPhone 15 Pro Max': ['256GB'],
    'iPhone 16': ['128GB', '256GB'],
    'iPhone 16 Plus': ['128GB'],
    'iPhone 16 Pro': ['256GB', '512GB'],
    'iPhone 16 Pro Max': ['256GB', '512GB'],
  },
  Samsung: {
    'Galaxy A35': ['128GB'],
    'Galaxy A55': ['128GB'],
    'Galaxy S23': ['128GB'],
    'Galaxy S23+': ['256GB'],
    'Galaxy S23 Ultra': ['256GB'],
    'Galaxy S24': ['128GB', '256GB'],
    'Galaxy S24+': ['256GB'],
    'Galaxy S24 Ultra': ['256GB', '512GB'],
  },
  OPPO: {
    'Find X8 Pro': ['256GB'],
    'Reno12 Pro': ['256GB'],
  },
  vivo: {
    'V30 Pro': ['256GB'],
    'X100 Pro': ['256GB'],
  },
  Xiaomi: {
    'POCO X6 Pro': ['256GB'],
    'Redmi Note 13 Pro': ['256GB'],
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
