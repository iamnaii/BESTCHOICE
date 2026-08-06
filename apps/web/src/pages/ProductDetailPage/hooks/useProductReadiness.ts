import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export type ProductReadinessCheckSeverity = 'blocking' | 'info';

export interface ProductReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  /**
   * 'blocking' = นับเป็นเงื่อนไข isReady (render ✓/✗), 'info' = ข้อมูลประกอบเฉยๆ
   * (เช่น isDemo) — render เป็น note ไม่มี ✓/✗ และไม่กระทบสถานะพร้อม/ไม่พร้อม
   */
  severity: ProductReadinessCheckSeverity;
  hint?: string;
}

export interface ProductReadinessResponse {
  productId: string;
  isReady: boolean;
  isOnlineVisible: boolean;
  checks: ProductReadinessCheck[];
}

/**
 * Adapter จุดเดียวที่ผูกกับ shape ของ GET /products/:id/readiness (B0 §2.3).
 * response จริงของ B0 มีฟิลด์เพิ่ม (isDemo, priceAutofilledAt, hasInstallmentPrice) ที่
 * B1 ไม่ใช้ผ่านทางนี้ — การ์ดราคา (Task 7) อ่าน product.priceAutofilledAt จาก
 * GET /products/:id ตรงๆ อยู่แล้ว จึงตัดทิ้งตรงนี้ได้. checks[] ยาว 7 หรือ 8 ไม่คงที่
 * (แถว isDemo push เฉพาะเครื่อง demo) — ReadinessCard ต้อง render จาก checks[] แบบ
 * generic (ห้าม hardcode ชื่อ key/ความยาว) ถ้า B0 เปลี่ยนชื่อ field ให้แก้ที่นี่เท่านั้น.
 */
export function useProductReadiness(productId: string | undefined) {
  return useQuery<ProductReadinessResponse>({
    queryKey: ['product-readiness', productId],
    queryFn: async () => {
      const { data } = await api.get(`/products/${productId}/readiness`);
      const rawChecks = Array.isArray(data.checks) ? data.checks : [];
      const checks: ProductReadinessCheck[] = rawChecks.map((c: Record<string, unknown>) => ({
        key: typeof c?.key === 'string' ? c.key : '',
        label: typeof c?.label === 'string' ? c.label : '',
        ok: Boolean(c?.ok),
        // เผื่อ server ไม่ส่ง severity มา (หรือส่งค่าที่ไม่รู้จัก) → default เป็น 'blocking'
        // (แสดง ✓/✗ ตามปกติ) แทนที่จะเงียบๆ ตกไปเป็น note ที่แอดมินอาจมองข้าม
        severity: c?.severity === 'info' ? 'info' : 'blocking',
        hint: typeof c?.hint === 'string' ? c.hint : undefined,
      }));
      return {
        productId: typeof data.productId === 'string' ? data.productId : (productId ?? ''),
        isReady: Boolean(data.isReady),
        isOnlineVisible: Boolean(data.isOnlineVisible),
        checks,
      };
    },
    enabled: !!productId,
    retry: false,
  });
}
