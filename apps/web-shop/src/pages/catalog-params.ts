import type { CatalogFilters } from '@/components/catalog/FilterSidebar';

export interface CatalogQuery {
  filters: CatalogFilters;
  sort: string;
  /** เงินดาวน์ที่ลูกค้าพิมพ์ (บาทเต็ม) — null = ไม่ได้ใส่ ให้ API ใช้ดาวน์ขั้นต่ำของแต่ละเครื่อง */
  downAmount: number | null;
  months: number | null;
  /** ติ๊ก "ฟรีดาวน์" — ขอเฉพาะเครื่องที่ไม่ต้องวางดาวน์ */
  freeDown: boolean;
  page: number;
}

/** อ่าน `?down=` (หน้ารวมและหน้ารายละเอียด): จำนวนเต็มบาท ≥ 0 ไม่เกิน 7 หลัก · อย่างอื่น = null */
export function parseDownParam(raw: string | null): number | null {
  if (raw == null || !/^\d{1,7}$/.test(raw)) return null;
  return Number(raw);
}

/** query string ของ GET /api/shop/products — ที่เดียว ให้หน้ารวมกับเทสต์ใช้ร่วมกัน */
export function buildCatalogParams(q: CatalogQuery): URLSearchParams {
  const { filters } = q;
  const params = new URLSearchParams();
  if (filters.deviceOrigin) params.set('deviceOrigin', filters.deviceOrigin);
  if (filters.condition) params.set('condition', filters.condition);
  if (filters.model) params.set('model', filters.model);
  if (filters.conditionGrade) params.set('conditionGrade', filters.conditionGrade);
  if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice));
  if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
  if (filters.search) params.set('search', filters.search);
  params.set('sort', q.sort);
  if (q.months != null) params.set('months', String(q.months));
  // ฟรีดาวน์ชนะเงินดาวน์ (กติกาเดียวกับ API) · เว็บรุ่นนี้เลิกส่ง downPct — API ยังรับไว้ให้เว็บรุ่นเก่า
  if (q.freeDown) params.set('freeDown', 'true');
  else if (q.downAmount != null && q.downAmount > 0) {
    params.set('downAmount', String(q.downAmount));
  }
  params.set('page', String(q.page));
  return params;
}
