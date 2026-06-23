import { settingsRegistry, type SettingsRole, type SettingsCategory, type SettingsItem } from './settings-registry';

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
