import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

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

interface Props {
  value: AddressData;
  onChange: (addr: AddressData) => void;
  label?: string;
}

export default function AddressForm({ value, onChange, label }: Props) {
  const [selectedProvince, setSelectedProvince] = useState(value.province);
  const [selectedDistrict, setSelectedDistrict] = useState(value.district);

  useEffect(() => {
    setSelectedProvince(value.province);
    setSelectedDistrict(value.district);
  }, [value.province, value.district]);

  const { data: provinces = [] } = useQuery<string[]>({
    queryKey: ['address-provinces'],
    queryFn: async () => (await api.get('/address/provinces')).data,
    staleTime: Infinity,
  });

  const { data: districts = [] } = useQuery<string[]>({
    queryKey: ['address-districts', selectedProvince],
    queryFn: async () =>
      (await api.get('/address/districts', { params: { province: selectedProvince } })).data,
    enabled: !!selectedProvince,
    staleTime: Infinity,
  });

  const { data: subdistricts = [] } = useQuery<{ name: string; zipcode: string }[]>({
    queryKey: ['address-subdistricts', selectedDistrict],
    queryFn: async () =>
      (await api.get('/address/subdistricts', { params: { district: selectedDistrict } })).data,
    enabled: !!selectedDistrict,
    staleTime: Infinity,
  });

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

  const inputClass =
    'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm';
  const selectClass =
    'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm bg-white';

  return (
    <div>
      {label && (
        <div className="text-sm font-medium text-gray-700 mb-2">{label}</div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">บ้านเลขที่</label>
          <input
            type="text"
            value={value.houseNo}
            onChange={(e) => update('houseNo', e.target.value)}
            className={inputClass}
            placeholder="123/45"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">หมู่</label>
          <input
            type="text"
            value={value.moo}
            onChange={(e) => update('moo', e.target.value)}
            className={inputClass}
            placeholder="5"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">หมู่บ้าน/อาคาร</label>
          <input
            type="text"
            value={value.village}
            onChange={(e) => update('village', e.target.value)}
            className={inputClass}
            placeholder="หมู่บ้าน/คอนโด"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">ซอย</label>
          <input
            type="text"
            value={value.soi}
            onChange={(e) => update('soi', e.target.value)}
            className={inputClass}
            placeholder="สุขุมวิท 71"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">ถนน</label>
          <input
            type="text"
            value={value.road}
            onChange={(e) => update('road', e.target.value)}
            className={inputClass}
            placeholder="สุขุมวิท"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">จังหวัด *</label>
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
          <label className="block text-xs text-gray-500 mb-1">อำเภอ/เขต *</label>
          <select
            value={value.district}
            onChange={(e) => handleDistrictChange(e.target.value)}
            className={selectClass}
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
          <label className="block text-xs text-gray-500 mb-1">ตำบล/แขวง *</label>
          <select
            value={value.subdistrict}
            onChange={(e) => handleSubdistrictChange(e.target.value)}
            className={selectClass}
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
          <label className="block text-xs text-gray-500 mb-1">รหัสไปรษณีย์</label>
          <input
            type="text"
            value={value.postalCode}
            readOnly
            className={`${inputClass} bg-gray-50`}
            placeholder="รหัสไปรษณีย์"
          />
        </div>
      </div>
    </div>
  );
}
