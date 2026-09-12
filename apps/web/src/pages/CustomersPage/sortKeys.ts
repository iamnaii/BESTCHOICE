import { CUSTOMER_SORT_KEYS, PROSPECT_SORT_KEYS } from '@installment/shared';

/**
 * คีย์เรียงที่ **API ทำตามจริง** — แคบกว่า `CUSTOMER_SORT_KEYS`/`PROSPECT_SORT_KEYS`
 * ของ `packages/shared`
 *
 * 🔴 `lastPurchaseAt` และ `lastContactAt` อยู่ในรายการของ shared แต่ `findAll` **ไม่เรียงให้**:
 * ทั้งคู่เป็น aggregate ของ relation (`MAX(sales.created_at)` / `MAX(chat_rooms.last_customer_at)`)
 * ซึ่ง Prisma `orderBy` ทำไม่ได้ และ `sortBy` ที่ไม่รู้จักถูกปล่อยผ่านเงียบ ๆ แล้วตกไปเรียง
 * `createdAt desc` ⇒ หัวคอลัมน์จะมีลูกศรที่กดได้แต่ไม่เกิดอะไรเลย
 *
 * แหล่งความจริงฝั่งเซิร์ฟเวอร์คือ `HONOURED_CUSTOMER_SORT_KEYS` ใน
 * `apps/api/src/modules/customers/dto/customers-list-query.dto.ts` (import ข้าม workspace
 * ไม่ได้) — **แก้ที่นั่นแล้วต้องแก้ที่นี่ด้วย** และกติกาคือเพิ่มเข้ามาได้เฉพาะคีย์ที่
 * เรียงได้จริงที่ฐานข้อมูล
 */
const HONOURED = ['name', 'createdAt', 'contractCount', 'creditScore'] as const;

function intersect(keys: readonly string[]): string[] {
  return keys.filter((key) => (HONOURED as readonly string[]).includes(key));
}

/** แท็บลูกค้า: name · createdAt · contractCount · creditScore */
export const CUSTOMER_HONOURED_SORT_KEYS = intersect(CUSTOMER_SORT_KEYS);
/** แท็บผู้สนใจ: name · createdAt · creditScore */
export const PROSPECT_HONOURED_SORT_KEYS = intersect(PROSPECT_SORT_KEYS);

export function honouredSortKeys(isBuyers: boolean): string[] {
  return isBuyers ? CUSTOMER_HONOURED_SORT_KEYS : PROSPECT_HONOURED_SORT_KEYS;
}

/**
 * ── แปลงคีย์คอลัมน์ ⇄ คีย์เรียงของ API (ที่เดียวในหน้านี้) ────────────────────
 *
 * 🔴 `DataTable` รายงานการเรียงเป็น **คีย์ของคอลัมน์** ไม่ใช่ `sortKey`:
 * มันสร้างคอลัมน์ด้วย `id: col.key` แล้วส่ง `next[0].id` ออกมาใน `onSortChange`
 * ⇒ คอลัมน์ที่ `key !== sortKey` (เช่น `purchase` → `contractCount`,
 * `credit` → `creditScore`) จะส่งคีย์ที่ `setSort` ไม่รู้จัก ตกไปสาขา else
 * แล้ว **ลบ `sortBy`/`sortDirection` ที่ตั้งไว้ทิ้ง** (กดแล้วการเรียงหาย)
 *
 * ห้ามแปลงที่อื่นอีก — ขาเขียนใช้ `toApiSort` ขาอ่านใช้ `toColumnSort` เท่านั้น
 */
export interface SortableColumn {
  key: string;
  sortKey?: string;
}

export interface ColumnSort {
  key: string;
  direction: 'asc' | 'desc';
}

/** ขาเขียน: คีย์คอลัมน์ที่ DataTable ส่งมา → คีย์ที่ API เรียงจริง */
export function toApiSort(
  columns: readonly SortableColumn[],
  next: ColumnSort | null,
): ColumnSort | null {
  if (!next) return null;
  const hit = columns.find((column) => column.key === next.key);
  return { key: hit?.sortKey ?? next.key, direction: next.direction };
}

/** ขาอ่าน: `?sortBy=contractCount` → ลูกศรไปขึ้นบนหัวคอลัมน์ `purchase` */
export function toColumnSort(
  columns: readonly SortableColumn[],
  sort: ColumnSort | null,
): ColumnSort | null {
  if (!sort) return null;
  const hit = columns.find((column) => (column.sortKey ?? column.key) === sort.key);
  return hit ? { key: hit.key, direction: sort.direction } : null;
}

/**
 * ถ้อยคำทิศทางการเรียง **ต่อชนิดคอลัมน์** — "ใหม่ → เก่า" กับคอลัมน์ชื่อไม่มีความหมาย
 * คีย์ที่ไม่รู้จักคืน `null` ⇒ ผู้เรียกตัดวรรคทิศทางทิ้งไปเลย (ดีกว่าบอกผิด)
 */
const SORT_DIRECTION_WORDS: Record<string, { asc: string; desc: string }> = {
  name: { asc: 'ก → ฮ', desc: 'ฮ → ก' },
  contractCount: { asc: 'น้อย → มาก', desc: 'มาก → น้อย' },
  creditScore: { asc: 'น้อย → มาก', desc: 'มาก → น้อย' },
  createdAt: { asc: 'เก่า → ใหม่', desc: 'ใหม่ → เก่า' },
};

export function sortDirectionLabel(sortKey: string, direction: 'asc' | 'desc'): string | null {
  return SORT_DIRECTION_WORDS[sortKey]?.[direction] ?? null;
}
