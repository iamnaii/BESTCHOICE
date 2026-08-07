export interface EditForm {
  name: string;
  brand: string;
  model: string;
  color: string;
  storage: string;
  imeiSerial: string;
  serialNumber: string;
  category: string;
  costPrice: string;
  status: string;
  batteryHealth: string;
  warrantyExpired: boolean;
  warrantyExpireDate: string;
  hasBox: boolean;
  accessoryType: string;
  accessoryBrand: string;
  conditionGrade: string;
  shopWarrantyDays: string;
  accessoriesIncluded: string;
  cosmeticNotes: string;
}

/**
 * Builds the `PATCH /products/:id` payload from `EditProductModal`'s form state.
 *
 * final-review N2 (2026-08-07): extracted out of `index.tsx`'s `handleEditSubmit` so the
 * `costPrice` fix below is independently testable, same pattern as
 * `buildSellingPricePayload.ts` (Task 11).
 *
 * `costPrice` used to be `parseFloat(editForm.costPrice) || 0` — a blank field (`''`) silently
 * became `0`. That's fine when the form is always prefilled from a real `product.costPrice`,
 * but Task 1 made `costPrice` optional on the wire (server strips it for roles that can't see
 * cost) — the ONLY thing stopping a role that CAN open this modal (`canEditProduct`/`isManager`)
 * but CANNOT see cost from silently zeroing out the real cost is the unwritten invariant
 * `canEditProduct ⊆ canSeeCost`. Every other optional field on this form (`conditionGrade`,
 * `shopWarrantyDays`, `cosmeticNotes`, ...) already treats blank as "don't touch" (`undefined`
 * — DTO's 3-state PATCH semantics: undefined = don't send, number = set). `costPrice` now
 * follows the same convention instead of being the one field that guesses `0`.
 */
export function buildEditProductPayload(editForm: EditForm): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: editForm.name,
    brand: editForm.brand,
    model: editForm.model,
    color: editForm.color || undefined,
    storage: editForm.storage || undefined,
    imeiSerial: editForm.imeiSerial || undefined,
    serialNumber: editForm.serialNumber || undefined,
    category: editForm.category,
    status: editForm.status,
  };
  // final-review N2: blank = omit the key entirely = don't touch (was `|| 0`, which overwrote
  // real cost with 0 for any role that can edit but can't see cost). Omitted (not `undefined`)
  // so the guarantee is visible to `in`/hasOwnProperty checks too, not just after JSON.stringify.
  if (editForm.costPrice.trim() !== '') {
    payload.costPrice = parseFloat(editForm.costPrice);
  }
  if (editForm.category === 'PHONE_USED') {
    payload.batteryHealth = editForm.batteryHealth ? Number(editForm.batteryHealth) : undefined;
    payload.warrantyExpired = editForm.warrantyExpired;
    payload.warrantyExpireDate =
      !editForm.warrantyExpired && editForm.warrantyExpireDate ? editForm.warrantyExpireDate : undefined;
    payload.hasBox = editForm.hasBox;
  }
  if (editForm.category === 'ACCESSORY') {
    payload.accessoryType = editForm.accessoryType || undefined;
    payload.accessoryBrand = editForm.accessoryBrand || undefined;
  }
  // ค่าว่าง → undefined = "ไม่แก้" (DTO @IsIn ปฏิเสธ '' อยู่แล้ว);
  // accessoriesIncluded ส่งเสมอ (array ว่าง = ล้างรายการอุปกรณ์ ซึ่งตั้งใจให้ทำได้)
  payload.conditionGrade = editForm.conditionGrade || undefined;
  payload.shopWarrantyDays = editForm.shopWarrantyDays !== '' ? Number(editForm.shopWarrantyDays) : undefined;
  payload.accessoriesIncluded = editForm.accessoriesIncluded
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  payload.cosmeticNotes = editForm.cosmeticNotes || undefined;
  return payload;
}
