import { productCatalog, type ModelInfo } from '@/data/productCatalog';
import type { ItemForm } from './types';

/**
 * Catalog helpers for the PO "เพิ่มรายการ" picker. The static catalog is one brand
 * (Apple) × ~50 models, so a single search box over the flattened list beats the
 * old ประเภท → ยี่ห้อ → รุ่น dropdown cascade.
 */
export type CatalogKind = 'PHONE' | 'TABLET';
export type DeviceCategory = 'PHONE_NEW' | 'PHONE_USED' | 'TABLET';
export type PhoneMode = 'PHONE_NEW' | 'PHONE_USED';

export interface CatalogEntry extends ModelInfo {
  brand: string;
}

let entriesCache: CatalogEntry[] | null = null;

/** Flattened catalog, catalog order preserved (newest generation first). */
export function catalogEntries(): CatalogEntry[] {
  if (!entriesCache) {
    entriesCache = productCatalog.flatMap((b) => b.models.map((m) => ({ ...m, brand: b.brand })));
  }
  return entriesCache;
}

export const kindOf = (entry: Pick<CatalogEntry, 'category'>): CatalogKind =>
  entry.category === 'TABLET' ? 'TABLET' : 'PHONE';

/** ItemForm.category → what kind of product the row is; ใหม่/มือสอง are the same kind (a phone). */
export const categoryKind = (category: string): string =>
  category === 'PHONE_NEW' || category === 'PHONE_USED' ? 'PHONE' : category;

const compact = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/**
 * Token search over "brand name": every whitespace token must appear, or the
 * space-stripped query must appear ("16pro" → iPhone 16 Pro). Shorter names rank
 * first so "16 pro" lists iPhone 16 Pro before iPhone 16 Pro Max; ties keep
 * catalog order. An empty query returns the whole kind (catalog order, no cap).
 */
export function searchCatalog(query: string, kind?: CatalogKind, limit = 12): CatalogEntry[] {
  const pool = catalogEntries().filter((e) => !kind || kindOf(e) === kind);
  const q = query.trim().toLowerCase();
  if (!q) return pool;
  const tokens = q.split(/\s+/);
  const compactQ = compact(q);
  return pool
    .map((entry, order) => ({ entry, order, hay: `${entry.brand} ${entry.name}`.toLowerCase() }))
    .filter(({ hay }) => tokens.every((t) => hay.includes(t)) || compact(hay).includes(compactQ))
    .sort((a, b) => a.entry.name.length - b.entry.name.length || a.order - b.order)
    .slice(0, limit)
    .map((h) => h.entry);
}

/** First `n` models of a kind in catalog order — the "รุ่นล่าสุด" one-click chips. */
export function latestModels(kind: CatalogKind, n: number): CatalogEntry[] {
  return catalogEntries().filter((e) => kindOf(e) === kind).slice(0, n);
}

/** "256GB – 1TB" hint for a result row. */
export function storageRange(storage: string[]): string {
  if (storage.length === 0) return '';
  if (storage.length === 1) return storage[0];
  return `${storage[0]} – ${storage[storage.length - 1]}`;
}

/** Tablets are always TABLET; phones take the picker's ใหม่/มือสอง mode. */
export function resolveCategory(entry: Pick<CatalogEntry, 'category'>, phoneMode: PhoneMode): DeviceCategory {
  return entry.category === 'TABLET' ? 'TABLET' : phoneMode;
}

/**
 * Accessory types a PO line can carry. Anything else in `accessoryType` is an EXISTING
 * product's code (Tooltify import stored codes like F1601 there). Mirror of
 * apps/api/src/utils/accessory-type.util.ts — keep both lists identical.
 */
export const KNOWN_ACCESSORY_TYPES = ['ฟิล์ม', 'ชุดชาร์จ', 'หูฟัง', 'เคส', 'อื่นๆ'];
export const isAccessoryProductCode = (accessoryType: string): boolean =>
  !!accessoryType && !KNOWN_ACCESSORY_TYPES.includes(accessoryType);

/** One accessory SKU from GET /products/accessory-skus. */
export interface AccessorySku {
  code: string | null;
  name: string;
  accessoryType: string | null;
  accessoryBrand: string | null;
  model: string;
  inStock: number;
  lastCost: number | null;
}

/** Every row can be sent: a category, a quantity > 0 and a unit price > 0 (PO wizard gate + รับเข้าตรง). */
export const allItemsComplete = (items: ItemForm[]): boolean =>
  items.length > 0 && items.every((i) => !!i.category && Number(i.quantity) > 0 && Number(i.unitPrice) > 0);

/**
 * Human label for a line — shared by the item rows and the summary step, and the same
 * rule the API's buildProductName() uses for the received units.
 */
export function itemLabel(i: ItemForm): string {
  if (i.category === 'ACCESSORY') {
    if (isAccessoryProductCode(i.accessoryType)) {
      return i.sourceName || i.model || [i.accessoryType, i.accessoryBrand].filter(Boolean).join(' ');
    }
    if (i.accessoryType === 'ฟิล์ม' || i.accessoryType === 'เคส') {
      const parts = [i.accessoryType, i.accessoryBrand].filter(Boolean).join(' ');
      return i.model ? `${parts} สำหรับ ${i.model}` : parts;
    }
    return [i.accessoryType, i.accessoryBrand, i.model].filter(Boolean).join(' ');
  }
  return [i.brand, i.model, i.color, i.storage].filter(Boolean).join(' ');
}
