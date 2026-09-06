export const EXPECTED_DATE_ERROR = 'วันที่คาดรับสินค้าต้องไม่ก่อนวันที่สั่ง';

/**
 * วันที่คาดรับสินค้าต้องไม่ก่อนวันที่สั่ง.
 * Both args are YYYY-MM-DD (CE) exactly as the PO form holds them, so a lexical
 * compare is calendar order. Either side empty = nothing to check (expectedDate
 * is optional). Mirrors the API guard in po-lifecycle.service.ts.
 */
export function getExpectedDateError(orderDate: string, expectedDate: string): string | null {
  if (!orderDate || !expectedDate) return null;
  return expectedDate < orderDate ? EXPECTED_DATE_ERROR : null;
}

/**
 * เปลี่ยนวันที่สั่งแล้วต้องเลือกวันที่คาดรับใหม่ (owner decision 2026-09-06):
 * a *different* orderDate clears expectedDate so the user re-picks it against the
 * new minimum; re-picking the same day leaves the form untouched.
 */
export function withOrderDate<T extends { orderDate: string; expectedDate: string }>(form: T, orderDate: string): T {
  if (orderDate === form.orderDate) return form;
  return { ...form, orderDate, expectedDate: '' };
}
