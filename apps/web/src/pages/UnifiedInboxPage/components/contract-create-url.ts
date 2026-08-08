/**
 * URL ของ wizard สร้างสัญญาพร้อม prefill.
 * useContractCreateData.ts:15-19 อ่านแค่ customerId / productId / downAmount / months
 * — param อื่น (เช่น suggestedProducts) เป็น no-op จึงไม่ส่งไป
 */
export function buildContractCreateUrl(customerId: string, productId?: string | null): string {
  const params = new URLSearchParams({ customerId });
  if (productId) params.set('productId', productId);
  return `/contracts/create?${params.toString()}`;
}
