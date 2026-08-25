import { BookUser, type LucideIcon } from 'lucide-react';
import { settingsRegistry, type SettingsRole, type SettingsCategory, type SettingsItem, type SettingsGroupId } from './settings-registry';

export function visibleItems(cat: SettingsCategory, role: SettingsRole): SettingsItem[] {
  return cat.items.filter((i) => i.roles.includes(role));
}

export function visibleCategories(role: SettingsRole): SettingsCategory[] {
  return settingsRegistry.filter((c) => visibleItems(c, role).length > 0);
}

export function categoryById(id: string): SettingsCategory | undefined {
  return settingsRegistry.find((c) => c.id === id);
}

export function firstVisibleCategoryId(role: SettingsRole): string | undefined {
  return visibleCategories(role)[0]?.id;
}

export function searchSettings(
  query: string,
  role: SettingsRole,
): { category: SettingsCategory; item: SettingsItem }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: { category: SettingsCategory; item: SettingsItem }[] = [];
  for (const cat of visibleCategories(role)) {
    for (const item of visibleItems(cat, role)) {
      const hay = [item.label, ...(item.keywords ?? []), cat.label].join(' ').toLowerCase();
      if (hay.includes(q)) out.push({ category: cat, item });
    }
  }
  return out;
}

export function findItem(
  categoryId: string,
  itemId: string,
): { category: SettingsCategory; item: SettingsItem } | undefined {
  const category = categoryById(categoryId);
  const item = category?.items.find((i) => i.id === itemId);
  return category && item ? { category, item } : undefined;
}

/* ── เมนูตั้งค่า (คอลัมน์ซ้าย) ──────────────────────────
 * แหล่งเดียวของ "หมวดตั้งค่ามีอะไรบ้าง เรียงยังไง" — ทั้งเมนูแบบจัดกลุ่ม
 * (Sidebar) และเมนูแบบแบน (menu.ts › buildSettingsZoneSections ที่ resolveZoneForPath
 * ใช้ต่อ) อ่านจากฟังก์ชันคู่นี้ จะได้ไม่มีวันเรียงไม่ตรงกัน
 */

export interface SettingsNavEntry {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
}

export interface SettingsNavGroup {
  id: SettingsGroupId;
  label: string;
  entries: SettingsNavEntry[];
}

/** ลำดับกลุ่ม — ตั้งใจให้ตรงกับลำดับหมวดใน settingsRegistry เพื่อให้เมนูแบนเรียงเหมือนเดิมเป๊ะ */
export const SETTINGS_GROUP_ORDER: { id: SettingsGroupId; label: string }[] = [
  { id: 'org', label: 'องค์กร' },
  { id: 'money', label: 'การเงิน & บัญชี' },
  { id: 'sales', label: 'การขาย & ลูกค้า' },
  { id: 'system', label: 'ระบบ' },
];

/** หมวดที่ลืมใส่ group ต้องไม่หายจากเมนู — ตกมากลุ่มท้ายสุด */
const FALLBACK_GROUP: SettingsGroupId = 'system';

/** รายชื่อผู้ติดต่อเป็นหน้าแยก (party master) ไม่ใช่หมวดใน registry แต่แขวนไว้ในเมนูตั้งค่า */
const CONTACTS_ENTRY: SettingsNavEntry = {
  id: 'contacts',
  label: 'รายชื่อผู้ติดต่อ',
  path: '/contacts',
  icon: BookUser,
};

/** เมนูตั้งค่าแบบจัดกลุ่ม (กลุ่มที่ไม่มีรายการจะถูกตัดทิ้ง) */
export function settingsNavGroups(role: SettingsRole): SettingsNavGroup[] {
  const cats = visibleCategories(role);
  if (cats.length === 0) return [];

  const groups: SettingsNavGroup[] = SETTINGS_GROUP_ORDER.map((g) => ({
    id: g.id,
    label: g.label,
    entries: [],
  }));
  const bucket = (id: SettingsGroupId): SettingsNavGroup =>
    groups.find((g) => g.id === id) ?? groups[groups.length - 1];

  bucket('org').entries.push(CONTACTS_ENTRY);
  for (const c of cats) {
    bucket(c.group ?? FALLBACK_GROUP).entries.push({
      id: c.id,
      label: c.label,
      path: `/settings/${c.id}`,
      icon: c.icon,
    });
  }

  return groups.filter((g) => g.entries.length > 0);
}

/** เมนูตั้งค่าแบบแบน เรียงตามกลุ่ม — /contacts มาก่อนเสมอ */
export function settingsNavEntries(role: SettingsRole): SettingsNavEntry[] {
  return settingsNavGroups(role).flatMap((g) => g.entries);
}
