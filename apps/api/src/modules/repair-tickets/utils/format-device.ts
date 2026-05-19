type ProductLike = { brand?: string | null; model?: string | null; storage?: string | null };

export interface FormatDeviceInput {
  product?: ProductLike | null;
  contract?: { product?: ProductLike | null } | null;
  deviceBrand?: string | null;
  deviceModel?: string | null;
  deviceImei?: string | null;
  deviceSerial?: string | null;
}

/**
 * Formats a human-readable device label for a repair ticket.
 *
 * Priority:
 *   1. `product` (directly linked inventory item — brand/model/storage)
 *   2. `contract.product` (linked via contract — brand/model/storage)
 *   3. Free-text fields `deviceBrand` / `deviceModel` with optional IMEI or SN
 *   4. Fallback: 'ไม่ระบุเครื่อง'
 */
export function formatDevice(input: FormatDeviceInput): string {
  const p = input.product ?? input.contract?.product;
  if (p?.brand || p?.model) {
    const parts = [p.brand, p.model, p.storage].filter(Boolean);
    return parts.join(' ');
  }

  if (input.deviceBrand || input.deviceModel) {
    const main = [input.deviceBrand, input.deviceModel].filter(Boolean).join(' ');
    if (input.deviceImei) return `${main} (IMEI: ${input.deviceImei})`;
    if (input.deviceSerial) return `${main} (SN: ${input.deviceSerial})`;
    return main;
  }

  return 'ไม่ระบุเครื่อง';
}
