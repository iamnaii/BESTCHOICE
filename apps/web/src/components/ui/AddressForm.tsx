import { useState, useEffect, useMemo, useId } from 'react';
import { Input } from '@/components/ui/input';
import { formControlClass, formLabelClass } from './form-styles';
import SearchableSelect from '@/components/ui/SearchableSelect';

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

interface Props {
  value: AddressData;
  onChange: (addr: AddressData) => void;
  label?: string;
}

export default function AddressForm({ value, onChange, label }: Props) {
  const addressData = useAddressData();
  const id = useId();
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-houseNo`} className={formLabelClass}>บ้านเลขที่</label>
          <Input
            className={formControlClass}
            type="text"
            id={`${id}-houseNo`}
            value={value.houseNo}
            onChange={(e) => update('houseNo', e.target.value)}
            placeholder="123/45"
          />
        </div>
        <div>
          <label htmlFor={`${id}-moo`} className={formLabelClass}>หมู่</label>
          <Input
            className={formControlClass}
            type="text"
            id={`${id}-moo`}
            value={value.moo}
            onChange={(e) => update('moo', e.target.value)}
            placeholder="5"
          />
        </div>
        <div>
          <label htmlFor={`${id}-village`} className={formLabelClass}>หมู่บ้าน/อาคาร</label>
          <Input
            className={formControlClass}
            type="text"
            id={`${id}-village`}
            value={value.village}
            onChange={(e) => update('village', e.target.value)}
            placeholder="หมู่บ้าน/คอนโด"
          />
        </div>
        <div>
          <label htmlFor={`${id}-soi`} className={formLabelClass}>ซอย</label>
          <Input
            className={formControlClass}
            type="text"
            id={`${id}-soi`}
            value={value.soi}
            onChange={(e) => update('soi', e.target.value)}
            placeholder="สุขุมวิท 71"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-road`} className={formLabelClass}>ถนน</label>
          <Input
            className={formControlClass}
            type="text"
            id={`${id}-road`}
            value={value.road}
            onChange={(e) => update('road', e.target.value)}
            placeholder="สุขุมวิท"
          />
        </div>
        <div>
          <label htmlFor={`${id}-province`} className={formLabelClass}>จังหวัด *</label>
          <SearchableSelect
            inputClassName={formControlClass}
            id={`${id}-province`}
            value={value.province}
            onChange={handleProvinceChange}
            options={provinces}
            placeholder="-- เลือกจังหวัด --"
            openDirection="up"
          />
        </div>
        <div>
          <label htmlFor={`${id}-district`} className={formLabelClass}>อำเภอ/เขต *</label>
          <SearchableSelect
            inputClassName={formControlClass}
            id={`${id}-district`}
            value={value.district}
            onChange={handleDistrictChange}
            options={districts}
            placeholder="-- เลือกอำเภอ/เขต --"
            disabled={!selectedProvince}
            openDirection="up"
          />
        </div>
        <div>
          <label htmlFor={`${id}-subdistrict`} className={formLabelClass}>ตำบล/แขวง *</label>
          <SearchableSelect
            inputClassName={formControlClass}
            id={`${id}-subdistrict`}
            value={value.subdistrict}
            onChange={handleSubdistrictChange}
            options={subdistricts.map((s) => s.name)}
            placeholder="-- เลือกตำบล/แขวง --"
            disabled={!selectedDistrict}
            openDirection="up"
          />
        </div>
        <div>
          <label htmlFor={`${id}-postalCode`} className={formLabelClass}>รหัสไปรษณีย์</label>
          <Input
            className={formControlClass}
            type="text"
            id={`${id}-postalCode`}
            value={value.postalCode}
            readOnly
            placeholder="รหัสไปรษณีย์"
          />
        </div>
      </div>
    </div>
  );
}
