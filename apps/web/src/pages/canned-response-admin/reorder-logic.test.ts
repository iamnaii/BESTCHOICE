import { describe, it, expect } from 'vitest';
import {
  groupByCategory,
  moveItemInList,
  moveItemAcrossCategories,
  moveCategory,
  flattenToReorderItems,
} from './reorder-logic';
import type { CannedResponse } from './types';

const t = (id: string, category: string | null, sortOrder: number): CannedResponse => ({
  id,
  title: `t-${id}`,
  shortcut: `/${id}`,
  content: '',
  category,
  sortOrder,
  isActive: true,
  createdAt: '',
});

describe('groupByCategory', () => {
  it('groups templates by category and sorts by min(sortOrder)', () => {
    const list = [t('a', 'X', 5), t('b', 'X', 1), t('c', 'Y', 2), t('d', null, 10)];
    const groups = groupByCategory(list);
    expect(groups.map((g) => g.name)).toEqual(['X', 'Y', 'อื่นๆ']);
    expect(groups[0].items.map((x) => x.id)).toEqual(['b', 'a']);
    expect(groups[2].items.map((x) => x.id)).toEqual(['d']);
  });
});

describe('moveItemInList', () => {
  it('reorders within same category', () => {
    const list = [t('a', 'X', 1), t('b', 'X', 2), t('c', 'X', 3)];
    const result = moveItemInList(list, 'a', 2);
    expect(result.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('moveItemAcrossCategories', () => {
  it('moves item to a new category at given index', () => {
    const list = [t('a', 'X', 1), t('b', 'X', 2), t('c', 'Y', 3), t('d', 'Y', 4)];
    const result = moveItemAcrossCategories(list, 'a', 'Y', 0);
    const yGroup = result.filter((x) => x.category === 'Y');
    expect(yGroup.map((x) => x.id)).toEqual(['a', 'c', 'd']);
    const xGroup = result.filter((x) => x.category === 'X');
    expect(xGroup.map((x) => x.id)).toEqual(['b']);
  });
});

describe('moveCategory', () => {
  it('moves all items in a category to a new position', () => {
    const list = [
      t('a', 'X', 1), t('b', 'X', 2),
      t('c', 'Y', 3), t('d', 'Y', 4),
      t('e', 'Z', 5),
    ];
    const result = moveCategory(list, 'Y', 0);
    const groups = groupByCategory(result);
    expect(groups.map((g) => g.name)).toEqual(['Y', 'X', 'Z']);
    expect(groups[0].items.map((x) => x.id)).toEqual(['c', 'd']);
  });
});

describe('flattenToReorderItems', () => {
  it('produces a complete reorder payload with renumbered sortOrders', () => {
    const list = [t('a', 'X', 5), t('b', 'X', 7), t('c', 'Y', 3)];
    const result = flattenToReorderItems(list);
    expect(result).toEqual([
      { id: 'a', category: 'X', sortOrder: 1 },
      { id: 'b', category: 'X', sortOrder: 2 },
      { id: 'c', category: 'Y', sortOrder: 3 },
    ]);
  });
});
