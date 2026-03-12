import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

// Lazy-loaded address data (loaded only when AddressForm mounts, ~400KB separate chunk)
let cachedData: [string, string, string, string][] | null = null;

function useAddressData() {
  const [data, setData] = useState<[string, string, string, string][]>(cachedData || []);

  useEffect(() => {
    if (cachedData) return;
    import('@/data/thai-address-data').then((m) => {
      cachedData = m.THAI_ADDRESS_DATA;
      setData(cachedData);
    });
  }, []);

  return data;
}

export interface AddressData {
  houseNo: string;
  moo: string;
  village: string;
  soi: string;
  road: string;
  province: string;
  district: string;
  subdistrict: string;
  postalCode: string;
}

export const emptyAddress: AddressData = {
  houseNo: '',
  moo: '',
  village: '',
  soi: '',
  road: '',
  province: '',
  district: '',
  subdistrict: '',
  postalCode: '',
};

export function composeAddress(addr: AddressData): string {
  const parts: string[] = [];
  if (addr.houseNo) parts.push(addr.houseNo);
  if (addr.moo) parts.push(`หมู่ ${addr.moo}`);
  if (addr.village) parts.push(addr.village);
  if (addr.soi) parts.push(`ซ.${addr.soi}`);
  if (addr.road) parts.push(`ถ.${addr.road}`);
  if (addr.subdistrict) parts.push(addr.subdistrict);
  if (addr.district) parts.push(addr.district);
  if (addr.province) parts.push(addr.province);
  if (addr.postalCode) parts.push(addr.postalCode);
  return parts.join(' ');
}

export function serializeAddress(addr: AddressData): string {
  const hasData = Object.values(addr).some((v) => v.trim() !== '');
  if (!hasData) return '';
  return JSON.stringify(addr);
}

export function deserializeAddress(str: string | null | undefined): AddressData {
  if (!str) return { ...emptyAddress };
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === 'object' && parsed !== null && 'province' in parsed) {
      return {
        houseNo: parsed.houseNo || '',
        moo: parsed.moo || '',
        village: parsed.village || '',
        soi: parsed.soi || '',
        road: parsed.road || '',
        province: parsed.province || '',
        district: parsed.district || '',
        subdistrict: parsed.subdistrict || '',
        postalCode: parsed.postalCode || '',
      };
    }
  } catch {
    // Not JSON - legacy composed address format
  }
  return { ...emptyAddress };
}

export function displayAddress(str: string | null | undefined): string {
  if (!str) return '';
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === 'object' && parsed !== null && 'province' in parsed) {
      return composeAddress(parsed);
    }
  } catch {
    // Not JSON - legacy format, return as-is
  }
  return str;
}

const selectClass =
  'flex h-[34px] w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

interface Props {
  value: AddressData;
  onChange: (addr: AddressData) => void;
  label?: string;
}

export default function AddressForm({ value, onChange, label }: Props) {
  const addressData = useAddressData();
  const [selectedProvince, setSelectedProvince] = useState(value.province);
  const [selectedDistrict, setSelectedDistrict] = useState(value.district);

  useEffect(() => {
    setSelectedProvince(value.province);
    setSelectedDistrict(value.district);
  }, [value.province, value.district]);

  // Auto-fill postal code when province+district+subdistrict are set but postalCode is empty
  useEffect(() => {
    if (value.province && value.district && value.subdistrict && !value.postalCode && addressData.length > 0) {
      const match = addressData.find(
        ([p, d, s]) => p === value.province && d === value.district && s === value.subdistrict,
      );
      if (match) {
        onChange({ ...value, postalCode: match[3] });
      }
    }
  }, [value, addressData, onChange]);

  const provinces = useMemo(() => {
    return [...new Set(addressData.map(([p]) => p))].sort();
  }, [addressData]);

  const districts = useMemo(() => {
    if (!selectedProvince) return [];
    return [
      ...new Set(
        addressData.filter(([p]) => p === selectedProvince).map(([, d]) => d),
      ),
    ].sort();
  }, [addressData, selectedProvince]);

  const subdistricts = useMemo(() => {
    if (!selectedProvince || !selectedDistrict) return [];
    return addressData
      .filter(([p, d]) => p === selectedProvince && d === selectedDistrict)
      .map(([, , s, z]) => ({ name: s, zipcode: z }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [addressData, selectedProvince, selectedDistrict]);

  const update = (field: keyof AddressData, val: string) => {
    onChange({ ...value, [field]: val });
  };

  const handleProvinceChange = (province: string) => {
    setSelectedProvince(province);
    setSelectedDistrict('');
    onChange({ ...value, province, district: '', subdistrict: '', postalCode: '' });
  };

  const handleDistrictChange = (district: string) => {
    setSelectedDistrict(district);
    onChange({ ...value, district, subdistrict: '', postalCode: '' });
  };

  const handleSubdistrictChange = (subdistrictName: string) => {
    const found = subdistricts.find((s) => s.name === subdistrictName);
    onChange({
      ...value,
      subdistrict: subdistrictName,
      postalCode: found?.zipcode || value.postalCode,
    });
  };

  return (
    <div>
      {label && (
        <div className="text-sm font-medium text-foreground mb-2">{label}</div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">บ้านเลขที่</label>
          <Input
            type="text"
            value={value.houseNo}
            onChange={(e) => update('houseNo', e.target.value)}
            placeholder="123/45"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">หมู่</label>
          <Input
            type="text"
            value={value.moo}
            onChange={(e) => update('moo', e.target.value)}
            placeholder="5"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">หมู่บ้าน/อาคาร</label>
          <Input
            type="text"
            value={value.village}
            onChange={(e) => update('village', e.target.value)}
            placeholder="หมู่บ้าน/คอนโด"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">ซอย</label>
          <Input
            type="text"
            value={value.soi}
            onChange={(e) => update('soi', e.target.value)}
            placeholder="สุขุมวิท 71"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-muted-foreground mb-1">ถนน</label>
          <Input
            type="text"
            value={value.road}
            onChange={(e) => update('road', e.target.value)}
            placeholder="สุขุมวิท"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">จังหวัด *</label>
          <select
            value={value.province}
            onChange={(e) => handleProvinceChange(e.target.value)}
            className={selectClass}
          >
            <option value="">-- เลือกจังหวัด --</option>
            {provinces.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">อำเภอ/เขต *</label>
          <select
            value={value.district}
            onChange={(e) => handleDistrictChange(e.target.value)}
            className={cn(selectClass, !selectedProvince && 'opacity-50 cursor-not-allowed')}
            disabled={!selectedProvince}
          >
            <option value="">-- เลือกอำเภอ/เขต --</option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">ตำบล/แขวง *</label>
          <select
            value={value.subdistrict}
            onChange={(e) => handleSubdistrictChange(e.target.value)}
            className={cn(selectClass, !selectedDistrict && 'opacity-50 cursor-not-allowed')}
            disabled={!selectedDistrict}
          >
            <option value="">-- เลือกตำบล/แขวง --</option>
            {subdistricts.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">รหัสไปรษณีย์</label>
          <Input
            type="text"
            value={value.postalCode}
            readOnly
            className="bg-muted"
            placeholder="รหัสไปรษณีย์"
          />
        </div>
      </div>
    </div>
  );
}
