export interface AccessoryDevice {
  brand: string;
  model: string;
  category: string;
}

const normalize = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** Uses the existing "สำหรับยี่ห้อ / สำหรับรุ่น" fields, never a substring of the sales name.
 * Multiple declared models are stored comma-separated by ProductCreate/PO.
 * Storage, colour and accessory manufacturer are deliberately not fit criteria.
 */
export function isAccessoryCompatible(
  accessory: AccessoryDevice,
  device: AccessoryDevice,
): boolean {
  if (
    !['PHONE_NEW', 'PHONE_USED', 'TABLET'].includes(device.category) ||
    accessory.category !== 'ACCESSORY'
  )
    return false;
  const brand = normalize(device.brand),
    model = normalize(device.model);
  if (!brand || !model || normalize(accessory.brand) !== brand) return false;
  return accessory.model.split(',').some((declared) => normalize(declared) === model);
}
