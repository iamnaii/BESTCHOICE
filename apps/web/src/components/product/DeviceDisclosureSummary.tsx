export interface DeviceDisclosureInfo {
  deviceOrigin?: 'THAI' | 'IMPORTED' | null;
  shopWarrantyDays?: number | null;
  effectiveShopWarrantyDays?: number | null;
  warrantyTerms?: string | null;
}

export function deviceOriginLabel(origin?: string | null) {
  return origin === 'THAI' ? 'เครื่องไทย' : origin === 'IMPORTED' ? 'เครื่องนอก' : 'ยังไม่ระบุไทย/นอก';
}

export function DeviceDisclosureSummary({ product }: { product: DeviceDisclosureInfo }) {
  const days = product.effectiveShopWarrantyDays !== undefined ? product.effectiveShopWarrantyDays : product.shopWarrantyDays;
  return <div className="mt-1 space-y-1 text-xs text-muted-foreground">
    <div><span className="font-medium text-foreground">{deviceOriginLabel(product.deviceOrigin)}</span> · {days == null ? 'ประกันตามเงื่อนไขร้าน' : days === 0 ? 'ไม่มีประกันร้าน' : `ประกันร้าน ${days} วัน`}</div>
    {product.warrantyTerms && <p className="whitespace-pre-wrap break-words">{product.warrantyTerms}</p>}
  </div>;
}
