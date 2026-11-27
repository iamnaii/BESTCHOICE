import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/format';

/** เงินดาวน์ต่ำสุดที่ลูกค้าเลือกได้จริงจากเครื่องที่ขายอยู่ตอนนี้ (บาท) */
export type DownFloor = { amount: number };

type CatalogDownMeta = { freeDownCount?: unknown; nextDownFrom?: unknown } | null | undefined;

export const DOWN_FLOOR_QUERY_KEY = ['shop', 'down-floor'] as const;

/** แถบโปรเขียนยอดนี้ลง HTML ที่ prerender — ให้หน้าที่โหลดครั้งแรกเริ่มจากยอดเดียวกับ snapshot */
export const DOWN_FLOOR_ATTR = 'data-down-floor';

/**
 * มีเครื่องฟรีดาวน์อย่างน้อย 1 เครื่อง = 0 บาท · ไม่มี = ดาวน์ต่ำสุดของเครื่องที่เหลือ
 * · ไม่รู้ (API รุ่นเก่าไม่ส่งช่อง / ไม่มีเครื่องที่คิดดาวน์ได้) = null — ห้ามเดาตัวเลข
 */
export function toDownFloor(meta: CatalogDownMeta): DownFloor | null {
  if (!meta) return null;
  if (typeof meta.freeDownCount === 'number' && meta.freeDownCount > 0) return { amount: 0 };
  if (typeof meta.nextDownFrom === 'number' && meta.nextDownFrom > 0)
    return { amount: meta.nextDownFrom };
  return null;
}

/**
 * ข้อความเดียวที่ทุกจุดใช้ (แถบโปร · พาดหัวหน้าแรก · การ์ดจุดเด่น)
 * ตัวเลขกับ "บาท" ติดกันด้วยช่องว่างไม่ตัดบรรทัด — การ์ดแคบบนมือถือห้ามเหลือ "บาท" โดด ๆ บรรทัดเดียว
 */
export function downFloorText(floor: DownFloor): string {
  return `ดาวน์เริ่ม ${formatNumber(floor.amount)} บาท`;
}

/**
 * ถามรายการสินค้าหน้าร้านแบบเบาที่สุด: 1 การ์ด + งบดาวน์ 1 บาท (เจ้าของ 2026-11-27 "ทำแถบให้เปลี่ยนเองตามสต๊อค"
 * แล้วตามด้วย "ใช้หัวพาดกับการ์ด ตามสต๊อค") — `freeDownCount` นับทั้งสต๊อก (ไม่ขึ้นกับการแบ่งหน้า/งบ)
 * และงบ 1 บาททำให้ API คืน `nextDownFrom` = ดาวน์น้อยสุดของการ์ดที่ต้องวางดาวน์ (นิยามเดียวกับตัวกรอง
 * "เงินดาวน์ที่มี" ในหน้าสินค้า). ไม่ต้องมี endpoint ใหม่ ตัวกรองซ่อนเครื่องสาธิตเป็นชุดเดียวกับที่ลูกค้าเห็น.
 * ทุกจุดใช้ query key เดียวกัน = ยิงครั้งเดียวต่อหน้า.
 */
export function useDownFloor() {
  return useQuery({
    queryKey: DOWN_FLOOR_QUERY_KEY,
    queryFn: () =>
      api
        .get('/api/shop/products', { params: { limit: 1, downAmount: 1 } })
        .then((r) => toDownFloor(r.data)),
    staleTime: 5 * 60 * 1000,
  });
}

/** ยอดที่พูดได้ตอนนี้ — กำลังโหลด / ดึงไม่ได้ / ไม่รู้ = null (ผู้เรียกแสดงข้อความที่ไม่มีตัวเลขดาวน์) */
export function useKnownDownFloor(): DownFloor | null {
  const { data, isError } = useDownFloor();
  return isError ? null : (data ?? null);
}

/**
 * เรียกก่อน React mount: อ่านยอดที่แถบโปรเขียนไว้ใน HTML ที่ prerender แล้วตั้งเป็นค่าเริ่มของ query
 * → render แรกตรงกับ snapshot (พาดหัวใหญ่ไม่กะพริบ) และ `updatedAt: 0` = ถือว่าเก่า → ดึงยอดสดทันทีหลัง mount.
 * ไม่มี attribute / ค่าเพี้ยน = ไม่ตั้งอะไร (หน้า spa-shell เริ่มจากยังไม่รู้ตามปกติ).
 */
export function seedDownFloorFromSnapshot(client: QueryClient, root: ParentNode = document): void {
  const raw = root.querySelector(`[${DOWN_FLOOR_ATTR}]`)?.getAttribute(DOWN_FLOOR_ATTR);
  if (raw == null || raw.trim() === '') return;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return;
  client.setQueryData<DownFloor | null>(DOWN_FLOOR_QUERY_KEY, { amount }, { updatedAt: 0 });
}
