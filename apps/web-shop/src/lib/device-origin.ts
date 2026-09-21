export type DeviceOrigin = 'THAI' | 'IMPORTED';

export function parseDeviceOrigin(value: string | null): DeviceOrigin | undefined {
  return value === 'THAI' || value === 'IMPORTED' ? value : undefined;
}

export function deviceOriginLabel(value?: DeviceOrigin | null): string {
  if (value === 'THAI') return 'เครื่องไทย';
  if (value === 'IMPORTED') return 'เครื่องนอก';
  return 'ยังไม่ระบุไทย/นอก';
}
