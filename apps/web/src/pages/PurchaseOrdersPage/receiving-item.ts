import { shotAnglePhotos } from '@/constants/photo-angles';
import type { ReceivingUnitForm } from './types';

export function buildReceivingItemData(i: ReceivingUnitForm) {
  const isUsed = i.category === 'PHONE_USED';
  return {
    deviceOrigin: i.deviceOrigin || null,
    shopWarrantyDays: i.shopWarrantyDays ? Number(i.shopWarrantyDays) : null,
    warrantyTerms: i.warrantyTerms?.trim() || null,
    imeiSerial: i.imeiSerial || undefined,
    serialNumber: i.serialNumber || undefined,
    status: i.status,
    rejectReason: i.status === 'REJECT' ? i.rejectReason || undefined : undefined,
    defectReason: i.status === 'REJECT' ? i.defectReason || undefined : undefined,
    photos: i.photos.length ? i.photos : undefined,
    ...(isUsed && i.status === 'PASS'
      ? {
          anglePhotos: shotAnglePhotos(i.anglePhotos),
          batteryHealth: i.batteryHealth ? Number(i.batteryHealth) : undefined,
          warrantyExpired: i.warrantyExpired,
          warrantyExpireDate:
            !i.warrantyExpired && i.warrantyExpireDate ? i.warrantyExpireDate : undefined,
          hasBox: i.hasBox,
          checklistResults: i.checklist.map(({ item, category, passed, note }) => ({
            item,
            category,
            passed,
            ...(note ? { note } : {}),
          })),
        }
      : {}),
    ...(i.status === 'PASS' && i.sellingPrice ? { sellingPrice: Number(i.sellingPrice) } : {}),
    ...(i.status === 'PASS' && i.installmentPrice
      ? { installmentPrice: Number(i.installmentPrice) }
      : {}),
  };
}
