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

/** Human label for a line — shared by the item rows and the review step. */
export function itemLabel(i: ItemForm): string {
  if (i.category === 'ACCESSORY') {
    const isCharger = i.accessoryType === 'ชุดชาร์จ';
    return isCharger
      ? [i.accessoryType, i.accessoryBrand, i.model].filter(Boolean).join(' ')
      : [i.accessoryType, i.accessoryBrand, i.model ? `สำหรับ ${i.model}` : '']
          .filter(Boolean)
          .join(' ');
  }
  return [i.brand, i.model, i.color, i.storage].filter(Boolean).join(' ');
}
