import type { CannedResponse, CategoryGroup, ReorderItem } from './types';

// Display label shown to the user for templates with no category.
const NULL_CATEGORY_LABEL = 'อื่นๆ';
// Internal sentinel — zero-width-space wrapped, user input can never produce this.
const NULL_CATEGORY_KEY = '​__null__​';

function categoryKey(c: string | null): string {
  return c ?? NULL_CATEGORY_KEY;
}

export function groupByCategory(list: CannedResponse[]): CategoryGroup[] {
  const map = new Map<string, CannedResponse[]>();
  for (const t of list) {
    const key = categoryKey(t.category);
    const bucket = map.get(key) ?? [];
    bucket.push(t);
    map.set(key, bucket);
  }
  const groups: CategoryGroup[] = [];
  for (const [name, items] of map) {
    items.sort((a, b) => a.sortOrder - b.sortOrder);
    // Render the null-bucket under the user-facing label so the rest of the
    // tree (drag handlers + display) can still reason about it by name.
    groups.push({ name: name === NULL_CATEGORY_KEY ? NULL_CATEGORY_LABEL : name, items });
  }
  groups.sort((a, b) => {
    const minA = Math.min(...a.items.map((i) => i.sortOrder));
    const minB = Math.min(...b.items.map((i) => i.sortOrder));
    if (minA !== minB) return minA - minB;
    return a.name.localeCompare(b.name, 'th');
  });
  return groups;
}

export function moveItemInList(
  list: CannedResponse[],
  itemId: string,
  toIndex: number,
): CannedResponse[] {
  const item = list.find((x) => x.id === itemId);
  if (!item) return list;
  const groups = groupByCategory(list);
  const group = groups.find((g) => g.items.some((x) => x.id === itemId));
  if (!group) return list;
  const idx = group.items.findIndex((x) => x.id === itemId);
  if (idx === toIndex) return list;
  const reordered = [...group.items];
  reordered.splice(idx, 1);
  reordered.splice(toIndex, 0, item);
  const result: CannedResponse[] = [];
  for (const g of groups) {
    if (g.name === group.name) {
      result.push(...reordered);
    } else {
      result.push(...g.items);
    }
  }
  return result;
}

export function moveItemAcrossCategories(
  list: CannedResponse[],
  itemId: string,
  toCategory: string,
  toIndex: number,
): CannedResponse[] {
  const item = list.find((x) => x.id === itemId);
  if (!item) return list;
  const without = list.filter((x) => x.id !== itemId);
  const updated: CannedResponse = {
    ...item,
    // The displayed group "อื่นๆ" represents `category === null`. Anything
    // else (even a user-created category literally named "อื่นๆ" — though we
    // discourage that) routes by its actual string key.
    category: toCategory === NULL_CATEGORY_LABEL ? null : toCategory,
  };
  const groups = groupByCategory(without);
  const targetGroup =
    groups.find((g) => g.name === toCategory) ?? { name: toCategory, items: [] };
  const newItems = [...targetGroup.items];
  newItems.splice(toIndex, 0, updated);
  const result: CannedResponse[] = [];
  let inserted = false;
  for (const g of groups) {
    if (g.name === toCategory) {
      result.push(...newItems);
      inserted = true;
    } else {
      result.push(...g.items);
    }
  }
  if (!inserted) {
    result.push(...newItems);
  }
  return result;
}

export function moveCategory(
  list: CannedResponse[],
  categoryName: string,
  toIndex: number,
): CannedResponse[] {
  const groups = groupByCategory(list);
  const fromIdx = groups.findIndex((g) => g.name === categoryName);
  if (fromIdx === -1 || fromIdx === toIndex) return list;
  const moving = groups[fromIdx];
  const rest = [...groups.slice(0, fromIdx), ...groups.slice(fromIdx + 1)];
  const reorderedGroups = [...rest.slice(0, toIndex), moving, ...rest.slice(toIndex)];
  const result: CannedResponse[] = [];
  let nextOrder = 1;
  for (const g of reorderedGroups) {
    for (const item of g.items) {
      result.push({ ...item, sortOrder: nextOrder++ });
    }
  }
  return result;
}

export function flattenToReorderItems(list: CannedResponse[]): ReorderItem[] {
  return list.map((item, i) => ({
    id: item.id,
    sortOrder: i + 1,
    category: item.category,
  }));
}
