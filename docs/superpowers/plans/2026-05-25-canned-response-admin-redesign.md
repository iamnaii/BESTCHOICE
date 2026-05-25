# Canned Response Admin Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace flat-table `/canned-responses` page with CHATCONE-style 2-pane tree+editor with DnD reorder, per-category actions, inline add.

**Architecture:** Master-detail React layout using @dnd-kit (already installed). Frontend computes new sortOrder/category client-side, sends bulk PATCH to new backend reorder endpoint. No schema changes.

**Tech Stack:** NestJS + Prisma (backend), React 18 + Vite + Tailwind + shadcn/ui + @dnd-kit + @tanstack/react-query (frontend), jest (backend), vitest (frontend).

**Spec:** [`docs/superpowers/specs/2026-05-25-canned-response-admin-redesign-design.md`](../specs/2026-05-25-canned-response-admin-redesign-design.md)

---

## File Structure

**Backend:**
- Modify: `apps/api/src/modules/staff-chat/services/staff-message.service.ts` — add `reorderCannedResponses(items[])`
- Modify: `apps/api/src/modules/staff-chat/staff-chat.controller.ts` — add `PATCH /canned-responses/reorder`
- Modify: `apps/api/src/modules/staff-chat/staff-chat.controller.spec.ts` — add tests for reorder

**Frontend:**
- Modify: `apps/web/src/pages/CannedResponseAdminPage.tsx` — full rewrite as orchestrator
- Create: `apps/web/src/pages/canned-response-admin/types.ts` — shared interface
- Create: `apps/web/src/pages/canned-response-admin/CategoryTreePane.tsx`
- Create: `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx`
- Create: `apps/web/src/pages/canned-response-admin/CategoryHeader.tsx`
- Create: `apps/web/src/pages/canned-response-admin/TemplateItem.tsx`
- Create: `apps/web/src/pages/canned-response-admin/useReorderMutation.ts`
- Create: `apps/web/src/pages/canned-response-admin/reorder-logic.ts` — pure functions (sortable client-side)
- Create: `apps/web/src/pages/canned-response-admin/reorder-logic.test.ts` — unit test pure logic
- Create: `apps/web/src/pages/CannedResponseAdminPage.test.tsx` — integration vitest

---

## Task 1: Backend — reorder service method + endpoint + tests

**Files:**
- `apps/api/src/modules/staff-chat/services/staff-message.service.ts`
- `apps/api/src/modules/staff-chat/staff-chat.controller.ts`
- `apps/api/src/modules/staff-chat/staff-chat.controller.spec.ts`

- [ ] **Step 1: Write the failing test (controller)**

Append to `staff-chat.controller.spec.ts`:

```typescript
describe('PATCH /staff-chat/canned-responses/reorder', () => {
  it('updates sortOrder + category for each item', async () => {
    jest.spyOn(staffMessage, 'reorderCannedResponses').mockResolvedValue({ updated: 2 });

    const body = {
      items: [
        { id: 'a', sortOrder: 10, category: 'X' },
        { id: 'b', sortOrder: 11, category: 'X' },
      ],
    };
    const result = await controller.reorderCannedResponses(body);

    expect(result).toEqual({ updated: 2 });
    expect(staffMessage.reorderCannedResponses).toHaveBeenCalledWith(body.items);
  });

  it('rejects payload with > 200 items', async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ id: `id-${i}`, sortOrder: i, category: 'X' }));
    await expect(controller.reorderCannedResponses({ items })).rejects.toThrow(/200/);
  });

  it('rejects payload with non-integer sortOrder', async () => {
    await expect(
      controller.reorderCannedResponses({ items: [{ id: 'a', sortOrder: 1.5, category: 'X' }] }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect 3 failures**

Run: `cd apps/api && npx jest src/modules/staff-chat/staff-chat.controller.spec.ts -t "reorder" --no-coverage`

Expected: FAIL — `controller.reorderCannedResponses is not a function`

- [ ] **Step 3: Add service method**

In `staff-message.service.ts`, ADD method:

```typescript
  /** Bulk reorder canned responses — used by admin drag-and-drop */
  async reorderCannedResponses(
    items: Array<{ id: string; sortOrder: number; category: string | null }>,
  ): Promise<{ updated: number }> {
    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.cannedResponse.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder, category: item.category },
        }),
      ),
    );
    return { updated: items.length };
  }
```

- [ ] **Step 4: Add controller endpoint**

In `staff-chat.controller.ts`, ADD after the existing canned-responses block (around line 270):

```typescript
  @Patch('canned-responses/reorder')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async reorderCannedResponses(
    @Body() body: { items: Array<{ id: string; sortOrder: number; category: string | null }> },
  ) {
    const items = body?.items ?? [];
    if (!Array.isArray(items)) {
      throw new BadRequestException('items ต้องเป็น array');
    }
    if (items.length > 200) {
      throw new BadRequestException('reorder รับสูงสุด 200 รายการต่อครั้ง');
    }
    for (const item of items) {
      if (typeof item.id !== 'string' || !item.id) {
        throw new BadRequestException('item.id ต้องเป็น string');
      }
      if (!Number.isInteger(item.sortOrder) || item.sortOrder < 0) {
        throw new BadRequestException('sortOrder ต้องเป็นจำนวนเต็ม >= 0');
      }
      if (item.category !== null && typeof item.category !== 'string') {
        throw new BadRequestException('category ต้องเป็น string หรือ null');
      }
      if (typeof item.category === 'string' && item.category.length > 100) {
        throw new BadRequestException('category ยาวเกิน 100 ตัวอักษร');
      }
    }
    return this.staffMessage.reorderCannedResponses(items);
  }
```

Verify imports include `BadRequestException` from `@nestjs/common` and `Patch` decorator.

- [ ] **Step 5: Run tests, expect PASS**

Run: `cd apps/api && npx jest src/modules/staff-chat/staff-chat.controller.spec.ts -t "reorder" --no-coverage`

Expected: 3/3 PASS

- [ ] **Step 6: TS check**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api`

Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/staff-message.service.ts \
        apps/api/src/modules/staff-chat/staff-chat.controller.ts \
        apps/api/src/modules/staff-chat/staff-chat.controller.spec.ts
git commit -m "feat(chat): add bulk reorder endpoint for canned responses"
```

(Use HEREDOC with Co-Authored-By trailer)

---

## Task 2: Frontend — shared types + reorder-logic pure functions + tests

**Files:**
- Create: `apps/web/src/pages/canned-response-admin/types.ts`
- Create: `apps/web/src/pages/canned-response-admin/reorder-logic.ts`
- Create: `apps/web/src/pages/canned-response-admin/reorder-logic.test.ts`

- [ ] **Step 1: Create types**

`apps/web/src/pages/canned-response-admin/types.ts`:

```typescript
export interface CannedResponse {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  category: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

export interface ReorderItem {
  id: string;
  sortOrder: number;
  category: string | null;
}

/** A grouped category in the tree */
export interface CategoryGroup {
  name: string; // "อื่นๆ" for null
  items: CannedResponse[]; // sorted by sortOrder asc
}
```

- [ ] **Step 2: Write failing tests for reorder logic**

`apps/web/src/pages/canned-response-admin/reorder-logic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { groupByCategory, moveItemInList, moveItemAcrossCategories, moveCategory, flattenToReorderItems } from './reorder-logic';
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
    const result = moveItemInList(list, 'a', 2); // move a to index 2
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
    // Move Y above X
    const result = moveCategory(list, 'Y', 0);
    const groups = groupByCategory(result);
    expect(groups.map((g) => g.name)).toEqual(['Y', 'X', 'Z']);
    // Y items keep relative order
    expect(groups[0].items.map((x) => x.id)).toEqual(['c', 'd']);
  });
});

describe('flattenToReorderItems', () => {
  it('produces a complete reorder payload with renumbered sortOrders', () => {
    const list = [t('a', 'X', 5), t('b', 'X', 7), t('c', 'Y', 3)];
    const result = flattenToReorderItems(list);
    // Expect contiguous sortOrder starting from 1
    expect(result).toEqual([
      { id: 'a', category: 'X', sortOrder: 1 },
      { id: 'b', category: 'X', sortOrder: 2 },
      { id: 'c', category: 'Y', sortOrder: 3 },
    ]);
  });
});
```

- [ ] **Step 3: Run, expect failure**

Run: `cd apps/web && npx vitest run src/pages/canned-response-admin/reorder-logic.test.ts --no-coverage`

Expected: FAIL — module not found

- [ ] **Step 4: Implement reorder-logic**

`apps/web/src/pages/canned-response-admin/reorder-logic.ts`:

```typescript
import type { CannedResponse, CategoryGroup, ReorderItem } from './types';

/** Normalize category for grouping — null becomes 'อื่นๆ' */
function categoryKey(c: string | null): string {
  return c ?? 'อื่นๆ';
}

/** Group templates by category, sort categories by min sortOrder, items by sortOrder asc */
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
    groups.push({ name, items });
  }
  groups.sort((a, b) => {
    const minA = Math.min(...a.items.map((i) => i.sortOrder));
    const minB = Math.min(...b.items.map((i) => i.sortOrder));
    if (minA !== minB) return minA - minB;
    return a.name.localeCompare(b.name, 'th');
  });
  return groups;
}

/** Move an item to a new index within the SAME category. Index is within the group. */
export function moveItemInList(list: CannedResponse[], itemId: string, toIndex: number): CannedResponse[] {
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
  // Rebuild full list preserving other categories
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

/** Move an item to a different category at given index within that category. */
export function moveItemAcrossCategories(
  list: CannedResponse[],
  itemId: string,
  toCategory: string,
  toIndex: number,
): CannedResponse[] {
  const item = list.find((x) => x.id === itemId);
  if (!item) return list;
  // Remove from old category
  const without = list.filter((x) => x.id !== itemId);
  const updated: CannedResponse = {
    ...item,
    category: toCategory === 'อื่นๆ' ? null : toCategory,
  };
  // Re-group, then insert into target group at index
  const groups = groupByCategory(without);
  const targetGroup = groups.find((g) => g.name === toCategory) ?? { name: toCategory, items: [] };
  const newItems = [...targetGroup.items];
  newItems.splice(toIndex, 0, updated);
  // Rebuild
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
    // target category didn't exist before — append at end
    result.push(...newItems);
  }
  return result;
}

/** Move a whole category to a new position (categoryIndex in group order). */
export function moveCategory(list: CannedResponse[], categoryName: string, toIndex: number): CannedResponse[] {
  const groups = groupByCategory(list);
  const fromIdx = groups.findIndex((g) => g.name === categoryName);
  if (fromIdx === -1 || fromIdx === toIndex) return list;
  const moving = groups[fromIdx];
  const rest = [...groups.slice(0, fromIdx), ...groups.slice(fromIdx + 1)];
  const reorderedGroups = [...rest.slice(0, toIndex), moving, ...rest.slice(toIndex)];
  const result: CannedResponse[] = [];
  for (const g of reorderedGroups) {
    result.push(...g.items);
  }
  return result;
}

/** Convert in-memory ordered list into a reorder API payload with contiguous sortOrders 1..N */
export function flattenToReorderItems(list: CannedResponse[]): ReorderItem[] {
  // The list is already in desired order; assign sortOrder 1..N
  return list.map((item, i) => ({
    id: item.id,
    sortOrder: i + 1,
    category: item.category,
  }));
}
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `cd apps/web && npx vitest run src/pages/canned-response-admin/reorder-logic.test.ts --no-coverage`

Expected: 5/5 PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/canned-response-admin/types.ts \
        apps/web/src/pages/canned-response-admin/reorder-logic.ts \
        apps/web/src/pages/canned-response-admin/reorder-logic.test.ts
git commit -m "feat(canned-response): add reorder logic pure functions + types"
```

---

## Task 3: Frontend — TemplateItem + CategoryHeader row components

**Files:**
- Create: `apps/web/src/pages/canned-response-admin/TemplateItem.tsx`
- Create: `apps/web/src/pages/canned-response-admin/CategoryHeader.tsx`

- [ ] **Step 1: Create TemplateItem component**

`TemplateItem.tsx`:

```tsx
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Copy, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CannedResponse } from './types';

interface Props {
  template: CannedResponse;
  isSelected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export default function TemplateItem({ template, isSelected, onSelect, onDuplicate, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: template.id,
    data: { type: 'template', categoryName: template.category ?? 'อื่นๆ' },
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex items-center gap-2 py-1.5 pr-2 cursor-pointer hover:bg-accent text-sm leading-snug',
        isSelected && 'bg-primary/10 border-l-2 border-primary',
        isDragging && 'opacity-50',
      )}
      onClick={onSelect}
    >
      <button
        {...attributes}
        {...listeners}
        className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5"
        title="ลากเพื่อย้าย"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <span className="flex-1 truncate text-foreground">{template.title}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
        <button
          onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
          title="ทำซ้ำ"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded"
          title="ลบ"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create CategoryHeader component**

`CategoryHeader.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ChevronDown, ChevronRight, Copy, Pencil, Trash2, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  name: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  onRename: (newName: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export default function CategoryHeader({ name, count, isExpanded, onToggle, onRename, onDuplicate, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `__category__${name}`,
    data: { type: 'category', categoryName: name },
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const [isRenaming, setIsRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) inputRef.current?.focus();
  }, [isRenaming]);

  const startRename = () => {
    setDraft(name);
    setIsRenaming(true);
  };

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) {
      onRename(trimmed);
    }
    setIsRenaming(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex items-center gap-2 py-2 pr-2 hover:bg-accent/60 text-sm font-medium leading-snug',
        isDragging && 'opacity-50',
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5"
        title="ลากเพื่อย้ายหมวด"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onToggle}
        className="text-muted-foreground hover:text-foreground"
        title={isExpanded ? 'ย่อ' : 'ขยาย'}
      >
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>
      {isRenaming ? (
        <div className="flex-1 flex items-center gap-1">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setIsRenaming(false);
            }}
            onBlur={commitRename}
            className="flex-1 bg-background border border-border rounded px-1.5 py-0.5 text-sm"
            aria-label="แก้ชื่อหมวด"
          />
          <button onClick={commitRename} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded" title="บันทึก">
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setIsRenaming(false)} className="p-1 text-muted-foreground hover:bg-muted rounded" title="ยกเลิก">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <>
          <span className="flex-1 text-foreground cursor-pointer" onClick={onToggle}>{name}</span>
          <span className="text-[10px] text-muted-foreground">{count}</span>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
            <button onClick={onDuplicate} className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded" title="ทำซ้ำหมวด">
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button onClick={startRename} className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded" title="แก้ชื่อ">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded" title="ลบหมวด">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: TS check**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web`

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/canned-response-admin/TemplateItem.tsx \
        apps/web/src/pages/canned-response-admin/CategoryHeader.tsx
git commit -m "feat(canned-response): add tree row components with sortable DnD"
```

---

## Task 4: Frontend — CategoryTreePane (DnD orchestrator)

**Files:**
- Create: `apps/web/src/pages/canned-response-admin/CategoryTreePane.tsx`

- [ ] **Step 1: Create CategoryTreePane**

```tsx
import { useState, useMemo } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import CategoryHeader from './CategoryHeader';
import TemplateItem from './TemplateItem';
import { groupByCategory, moveItemInList, moveItemAcrossCategories, moveCategory, flattenToReorderItems } from './reorder-logic';
import type { CannedResponse, ReorderItem } from './types';

interface Props {
  templates: CannedResponse[];
  selectedId: string | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectTemplate: (id: string) => void;
  onAddTemplate: (category: string) => void;
  onDuplicateTemplate: (id: string) => void;
  onDeleteTemplate: (id: string) => void;
  onRenameCategory: (oldName: string, newName: string) => void;
  onDuplicateCategory: (name: string) => void;
  onDeleteCategory: (name: string) => void;
  onReorder: (items: ReorderItem[]) => void;
}

export default function CategoryTreePane(props: Props) {
  const {
    templates, selectedId, searchQuery, onSearchChange,
    onSelectTemplate, onAddTemplate, onDuplicateTemplate, onDeleteTemplate,
    onRenameCategory, onDuplicateCategory, onDeleteCategory, onReorder,
  } = props;

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const filteredTemplates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.content.toLowerCase().includes(q) ||
        t.shortcut.toLowerCase().includes(q) ||
        (t.category ?? '').toLowerCase().includes(q),
    );
  }, [templates, searchQuery]);

  const groups = useMemo(() => groupByCategory(filteredTemplates), [filteredTemplates]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const toggleCategory = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleDragStart = (e: DragStartEvent) => {
    setActiveDragId(String(e.active.id));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeData = active.data.current as { type: 'category' | 'template'; categoryName: string } | undefined;
    const overData = over.data.current as { type: 'category' | 'template'; categoryName: string } | undefined;
    if (!activeData || !overData) return;

    let newList: CannedResponse[] | null = null;

    if (activeData.type === 'category') {
      // Dragging a category — overData.categoryName is the target category position
      const groupOrder = groups.map((g) => g.name);
      const toIdx = groupOrder.indexOf(overData.categoryName);
      if (toIdx >= 0) {
        newList = moveCategory(templates, activeData.categoryName, toIdx);
      }
    } else if (activeData.type === 'template') {
      const activeId = String(active.id);
      if (overData.type === 'template') {
        if (activeData.categoryName === overData.categoryName) {
          // Same category — reorder
          const group = groups.find((g) => g.name === activeData.categoryName);
          if (group) {
            const toIdx = group.items.findIndex((x) => x.id === String(over.id));
            if (toIdx >= 0) newList = moveItemInList(templates, activeId, toIdx);
          }
        } else {
          // Across categories — drop in target category at over's index
          const targetGroup = groups.find((g) => g.name === overData.categoryName);
          if (targetGroup) {
            const toIdx = targetGroup.items.findIndex((x) => x.id === String(over.id));
            newList = moveItemAcrossCategories(templates, activeId, overData.categoryName, Math.max(toIdx, 0));
          }
        }
      } else if (overData.type === 'category') {
        // Dropped on a category header — append to that category
        newList = moveItemAcrossCategories(templates, activeId, overData.categoryName, 0);
      }
    }

    if (newList) {
      onReorder(flattenToReorderItems(newList));
    }
  };

  // Build sortable IDs (categories use `__category__${name}` prefix, items use their id)
  const sortableIds = groups.flatMap((g) => [
    `__category__${g.name}`,
    ...(expanded.has(g.name) ? g.items.map((i) => i.id) : []),
  ]);

  return (
    <div className="flex flex-col h-full border-r border-border bg-card">
      <div className="px-3 py-3 border-b border-border bg-muted/30">
        <Input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="ค้นหา..."
          className="text-sm"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 && (
          <div className="px-4 py-8 text-sm text-muted-foreground text-center leading-snug">
            ยังไม่มี template
          </div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            {groups.map((group) => {
              const isExp = expanded.has(group.name);
              return (
                <div key={group.name}>
                  <CategoryHeader
                    name={group.name}
                    count={group.items.length}
                    isExpanded={isExp}
                    onToggle={() => toggleCategory(group.name)}
                    onRename={(newName) => onRenameCategory(group.name, newName)}
                    onDuplicate={() => onDuplicateCategory(group.name)}
                    onDelete={() => onDeleteCategory(group.name)}
                  />
                  {isExp && (
                    <div className="pl-5">
                      {group.items.map((item) => (
                        <TemplateItem
                          key={item.id}
                          template={item}
                          isSelected={selectedId === item.id}
                          onSelect={() => onSelectTemplate(item.id)}
                          onDuplicate={() => onDuplicateTemplate(item.id)}
                          onDelete={() => onDeleteTemplate(item.id)}
                        />
                      ))}
                      <button
                        onClick={() => onAddTemplate(group.name)}
                        className="w-full px-4 py-1.5 text-left text-sm text-primary hover:bg-primary/5 flex items-center gap-2"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        เพิ่มประเภทข้อความ
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </SortableContext>
        </DndContext>
      </div>
      {activeDragId && (
        <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
          กำลังลาก...
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TS check (will fail if components not registered correctly)**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web`

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canned-response-admin/CategoryTreePane.tsx
git commit -m "feat(canned-response): add CategoryTreePane with DnD orchestration"
```

---

## Task 5: Frontend — TemplateEditorPane (right pane form)

**Files:**
- Create: `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx`

- [ ] **Step 1: Create TemplateEditorPane**

```tsx
import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import type { CannedResponse } from './types';

interface Props {
  template: CannedResponse | null;
  existingCategories: string[];
  onSave: (patch: Partial<CannedResponse>) => Promise<void>;
}

const VARIABLES = [
  '{customerName}',
  '{customerPhone}',
  '{contractNumber}',
  '{amountDue}',
  '{dueDate}',
  '{installmentNo}',
  '{branchName}',
];

export default function TemplateEditorPane({ template, existingCategories, onSave }: Props) {
  const [form, setForm] = useState({
    title: '',
    shortcut: '',
    content: '',
    category: '',
    isActive: true,
  });
  const [saving, setSaving] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (template) {
      setForm({
        title: template.title,
        shortcut: template.shortcut,
        content: template.content,
        category: template.category ?? '',
        isActive: template.isActive,
      });
    }
  }, [template]);

  if (!template) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground leading-snug bg-muted/10">
        <div className="text-center">
          <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
          เลือก template เพื่อแก้ไข
        </div>
      </div>
    );
  }

  const isDirty =
    form.title !== template.title ||
    form.shortcut !== template.shortcut ||
    form.content !== template.content ||
    (form.category || null) !== template.category ||
    form.isActive !== template.isActive;

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error('กรุณากรอกชื่อ template');
      return;
    }
    if (!form.shortcut.trim()) {
      toast.error('กรุณากรอก shortcut');
      return;
    }
    const normalizedShortcut = form.shortcut.startsWith('/') ? form.shortcut : `/${form.shortcut}`;
    setSaving(true);
    try {
      await onSave({
        title: form.title.trim(),
        shortcut: normalizedShortcut,
        content: form.content,
        category: form.category.trim() || null,
        isActive: form.isActive,
      });
      toast.success('บันทึกแล้ว');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const insertVariable = (v: string) => {
    const ta = contentRef.current;
    if (!ta) {
      setForm({ ...form, content: form.content + v });
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = form.content.slice(0, start) + v + form.content.slice(end);
    setForm({ ...form, content: next });
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + v.length;
    });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground leading-snug">แก้ไข Template</div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => template && setForm({
              title: template.title,
              shortcut: template.shortcut,
              content: template.content,
              category: template.category ?? '',
              isActive: template.isActive,
            })}
            disabled={!isDirty || saving}
          >
            ยกเลิก
          </Button>
          <Button onClick={handleSave} disabled={!isDirty || saving} size="sm">
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="title" className="text-xs">ชื่อ Template</Label>
            <Input id="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="shortcut" className="text-xs">Shortcut</Label>
            <Input id="shortcut" value={form.shortcut} onChange={(e) => setForm({ ...form, shortcut: e.target.value })} placeholder="/example" />
          </div>
        </div>
        <div>
          <Label htmlFor="category" className="text-xs">หมวด</Label>
          <Input
            id="category"
            list="existing-categories"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="เลือกหมวดเดิมหรือพิมพ์ใหม่"
          />
          <datalist id="existing-categories">
            {existingCategories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div>
          <Label htmlFor="content" className="text-xs">เนื้อหา</Label>
          <Textarea
            id="content"
            ref={contentRef}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            className="min-h-[200px] font-mono text-sm leading-relaxed"
          />
        </div>
        <div>
          <Label className="text-xs">ตัวแปร (คลิกเพื่อใส่ที่ตำแหน่ง cursor)</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {VARIABLES.map((v) => (
              <button
                key={v}
                onClick={() => insertVariable(v)}
                className="px-2 py-1 text-[11px] font-mono bg-muted hover:bg-emerald-50 hover:text-emerald-700 rounded border border-border"
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isActive"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            className="rounded"
          />
          <Label htmlFor="isActive" className="text-sm leading-snug">เปิดใช้งาน (ปิด = ซ่อนจาก picker)</Label>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TS check**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web`

Expected: 0 errors (if Label component doesn't exist in shadcn, check and either add or replace with a `<label>` element)

- [ ] **Step 3: Verify Label component exists**

Run: `ls apps/web/src/components/ui/label.tsx 2>/dev/null && echo "OK" || echo "MISSING — replace with native <label>"`

If MISSING, swap all `<Label htmlFor=...>` with `<label htmlFor=... className="text-xs font-medium block mb-1">`. Remove the Label import.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx
git commit -m "feat(canned-response): add TemplateEditorPane form with variable insert"
```

---

## Task 6: Frontend — useReorderMutation hook

**Files:**
- Create: `apps/web/src/pages/canned-response-admin/useReorderMutation.ts`

- [ ] **Step 1: Create hook**

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { ReorderItem } from './types';

export function useReorderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: ReorderItem[]) =>
      api.patch('/staff-chat/canned-responses/reorder', { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['canned-responses-admin'] });
      queryClient.invalidateQueries({ queryKey: ['canned-responses-picker'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'เรียงลำดับไม่สำเร็จ');
    },
  });
}
```

- [ ] **Step 2: TS check**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web`

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/canned-response-admin/useReorderMutation.ts
git commit -m "feat(canned-response): add useReorderMutation hook"
```

---

## Task 7: Frontend — orchestrator CannedResponseAdminPage.tsx rewrite

**Files:**
- Modify (full rewrite): `apps/web/src/pages/CannedResponseAdminPage.tsx`

- [ ] **Step 1: Backup existing file (for diff)**

Run: `cp apps/web/src/pages/CannedResponseAdminPage.tsx /tmp/CannedResponseAdminPage.tsx.bak`

- [ ] **Step 2: Replace file content**

```tsx
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import CategoryTreePane from './canned-response-admin/CategoryTreePane';
import TemplateEditorPane from './canned-response-admin/TemplateEditorPane';
import { useReorderMutation } from './canned-response-admin/useReorderMutation';
import type { CannedResponse } from './canned-response-admin/types';

export default function CannedResponseAdminPage() {
  useDocumentTitle('ข้อความสำเร็จรูป');
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'template' | 'category'; id?: string; name?: string; count?: number } | null>(null);

  const query = useQuery<CannedResponse[]>({
    queryKey: ['canned-responses-admin'],
    queryFn: () => api.get('/staff-chat/canned-responses').then((r: any) => r.data),
  });

  const templates = query.data ?? [];
  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const existingCategories = useMemo(
    () => [...new Set(templates.map((t) => t.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'th')),
    [templates],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['canned-responses-admin'] });
    queryClient.invalidateQueries({ queryKey: ['canned-responses-picker'] });
  };

  const createMutation = useMutation({
    mutationFn: (data: Partial<CannedResponse>) =>
      api.post('/staff-chat/canned-responses', data).then((r: any) => r.data),
    onSuccess: (created: CannedResponse) => {
      invalidate();
      setSelectedId(created.id);
    },
    onError: (e: any) => toast.error(getErrorMessage(e) ?? 'สร้างไม่สำเร็จ'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CannedResponse> }) =>
      api.patch(`/staff-chat/canned-responses/${id}`, patch).then((r: any) => r.data),
    onSuccess: () => invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/staff-chat/canned-responses/${id}`),
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
      toast.success('ลบแล้ว');
    },
    onError: (e: any) => toast.error(getErrorMessage(e) ?? 'ลบไม่สำเร็จ'),
  });

  const reorderMutation = useReorderMutation();

  // Category-level operations (batch over templates in that category)
  const renameCategoryMutation = useMutation({
    mutationFn: async ({ oldName, newName }: { oldName: string; newName: string }) => {
      const inCat = templates.filter((t) => (t.category ?? 'อื่นๆ') === oldName);
      await Promise.all(
        inCat.map((t) => api.patch(`/staff-chat/canned-responses/${t.id}`, { category: newName })),
      );
    },
    onSuccess: () => {
      invalidate();
      toast.success('แก้ชื่อหมวดแล้ว');
    },
    onError: (e: any) => toast.error(getErrorMessage(e) ?? 'แก้ชื่อหมวดไม่สำเร็จ'),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const inCat = templates.filter((t) => (t.category ?? 'อื่นๆ') === name);
      await Promise.all(inCat.map((t) => api.delete(`/staff-chat/canned-responses/${t.id}`)));
    },
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
      toast.success('ลบหมวดแล้ว');
    },
    onError: (e: any) => toast.error(getErrorMessage(e) ?? 'ลบหมวดไม่สำเร็จ'),
  });

  const duplicateCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const inCat = templates.filter((t) => (t.category ?? 'อื่นๆ') === name);
      await Promise.all(
        inCat.map((t) =>
          api.post('/staff-chat/canned-responses', {
            shortcut: `${t.shortcut}-copy-${Date.now().toString(36).slice(-4)}`,
            title: `${t.title} (สำเนา)`,
            content: t.content,
            category: `${name} (สำเนา)`,
            sortOrder: t.sortOrder + 1000,
          }),
        ),
      );
    },
    onSuccess: () => {
      invalidate();
      toast.success('ทำซ้ำหมวดแล้ว');
    },
    onError: (e: any) => toast.error(getErrorMessage(e) ?? 'ทำซ้ำหมวดไม่สำเร็จ'),
  });

  const duplicateTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      const src = templates.find((t) => t.id === id);
      if (!src) throw new Error('not found');
      return api.post('/staff-chat/canned-responses', {
        shortcut: `${src.shortcut}-copy-${Date.now().toString(36).slice(-4)}`,
        title: `${src.title} (สำเนา)`,
        content: src.content,
        category: src.category,
        sortOrder: src.sortOrder + 1,
      }).then((r: any) => r.data);
    },
    onSuccess: (created: any) => {
      invalidate();
      setSelectedId(created?.id ?? null);
      toast.success('ทำซ้ำแล้ว');
    },
    onError: (e: any) => toast.error(getErrorMessage(e) ?? 'ทำซ้ำไม่สำเร็จ'),
  });

  const handleAddTemplate = (category: string) => {
    const cat = category === 'อื่นๆ' ? null : category;
    createMutation.mutate({
      shortcut: `/new-${Date.now().toString(36).slice(-4)}`,
      title: 'Template ใหม่',
      content: '',
      category: cat,
      sortOrder: Math.max(0, ...templates.map((t) => t.sortOrder)) + 1,
    });
  };

  const handleAddCategory = () => {
    const name = window.prompt('ชื่อหมวดใหม่');
    if (!name || !name.trim()) return;
    createMutation.mutate({
      shortcut: `/new-${Date.now().toString(36).slice(-4)}`,
      title: 'Template ใหม่',
      content: '',
      category: name.trim(),
      sortOrder: Math.max(0, ...templates.map((t) => t.sortOrder)) + 1,
    });
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      <PageHeader
        title="ข้อความสำเร็จรูป"
        actions={
          <Button onClick={handleAddCategory} size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            สร้างชุดข้อความ
          </Button>
        }
      />
      <QueryBoundary query={query} loadingText="กำลังโหลด...">
        <div className="flex-1 flex overflow-hidden border border-border rounded-lg m-3">
          <div className="w-96 flex-shrink-0">
            <CategoryTreePane
              templates={templates}
              selectedId={selectedId}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSelectTemplate={setSelectedId}
              onAddTemplate={handleAddTemplate}
              onDuplicateTemplate={(id) => duplicateTemplateMutation.mutate(id)}
              onDeleteTemplate={(id) => {
                const t = templates.find((x) => x.id === id);
                setConfirmDelete({ kind: 'template', id, name: t?.title });
              }}
              onRenameCategory={(oldName, newName) =>
                renameCategoryMutation.mutate({ oldName, newName })
              }
              onDuplicateCategory={(name) => duplicateCategoryMutation.mutate(name)}
              onDeleteCategory={(name) => {
                const count = templates.filter((t) => (t.category ?? 'อื่นๆ') === name).length;
                setConfirmDelete({ kind: 'category', name, count });
              }}
              onReorder={(items) => reorderMutation.mutate(items)}
            />
          </div>
          <TemplateEditorPane
            template={selected}
            existingCategories={existingCategories}
            onSave={async (patch) => {
              if (!selected) return;
              await updateMutation.mutateAsync({ id: selected.id, patch });
            }}
          />
        </div>
      </QueryBoundary>

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete?.kind === 'category' ? 'ลบหมวดทั้งหมด' : 'ลบ Template'}
        description={
          confirmDelete?.kind === 'category'
            ? `ลบหมวด "${confirmDelete.name}"? จะลบ template ${confirmDelete.count} ตัวในหมวดนี้ด้วย`
            : `ลบ template "${confirmDelete?.name}"?`
        }
        confirmText="ลบ"
        variant="destructive"
        onConfirm={() => {
          if (!confirmDelete) return;
          if (confirmDelete.kind === 'template' && confirmDelete.id) {
            deleteMutation.mutate(confirmDelete.id);
          } else if (confirmDelete.kind === 'category' && confirmDelete.name) {
            deleteCategoryMutation.mutate(confirmDelete.name);
          }
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
```

- [ ] **Step 3: TS check**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web`

Expected: 0 errors

If errors mention `ConfirmDialog` props mismatch (variant or other), read the actual component:
`cat apps/web/src/components/ui/ConfirmDialog.tsx | head -40`
and adapt accordingly.

- [ ] **Step 4: Smoke test in browser**

Visit `http://localhost:5173/canned-responses` — verify:
- Tree loads with categories from seed
- Click item → editor on right shows
- Edit content → Save button activates
- DnD: drag template within category — should reorder

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/CannedResponseAdminPage.tsx
git commit -m "feat(canned-response): wire new admin page with master-detail + DnD"
```

---

## Task 8: Frontend integration test (vitest)

**Files:**
- Create: `apps/web/src/pages/CannedResponseAdminPage.test.tsx`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import CannedResponseAdminPage from './CannedResponseAdminPage';

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: [
        { id: 't1', shortcut: '/iphone16', title: 'iPhone 16', content: 'hello {customerName}', category: 'เรทผ่อน iPhone', sortOrder: 1, isActive: true, createdAt: '' },
        { id: 't2', shortcut: '/iphone17', title: 'iPhone 17', content: 'wow', category: 'เรทผ่อน iPhone', sortOrder: 2, isActive: true, createdAt: '' },
        { id: 't3', shortcut: '/welcome', title: 'ทักทาย', content: 'hi', category: 'พูดคุย', sortOrder: 3, isActive: true, createdAt: '' },
      ],
    }),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  getErrorMessage: (e: any) => e?.message ?? 'error',
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CannedResponseAdminPage', () => {
  it('renders categories from data', async () => {
    render(wrap(<CannedResponseAdminPage />));
    expect(await screen.findByText('เรทผ่อน iPhone')).toBeInTheDocument();
    expect(screen.getByText('พูดคุย')).toBeInTheDocument();
  });

  it('expands category on click and selects template', async () => {
    render(wrap(<CannedResponseAdminPage />));
    fireEvent.click(await screen.findByText('เรทผ่อน iPhone'));
    expect(await screen.findByText('iPhone 16')).toBeInTheDocument();
    fireEvent.click(screen.getByText('iPhone 16'));
    // Editor on right pane shows form with title
    await waitFor(() => {
      const inputs = document.querySelectorAll('input');
      const titleInput = Array.from(inputs).find((i) => i.value === 'iPhone 16');
      expect(titleInput).toBeTruthy();
    });
  });

  it('shows empty state when no template selected', async () => {
    render(wrap(<CannedResponseAdminPage />));
    await screen.findByText('เรทผ่อน iPhone');
    expect(screen.getByText('เลือก template เพื่อแก้ไข')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd apps/web && npx vitest run src/pages/CannedResponseAdminPage.test.tsx --no-coverage`

Expected: PASS (may need adjustments for actual rendered DOM)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/CannedResponseAdminPage.test.tsx
git commit -m "test(canned-response): add admin page integration tests"
```

---

## Task 9: Final TS + test sweep + manual smoke

- [ ] **Step 1: TS check**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh all`

Expected: 0 errors

- [ ] **Step 2: All staff-chat tests**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/staff-chat --no-coverage`

Expected: all pass

- [ ] **Step 3: Canned-response frontend tests**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx vitest run src/pages/canned-response-admin src/pages/CannedResponseAdminPage.test.tsx --no-coverage`

Expected: all pass

- [ ] **Step 4: Manual smoke**

Open `http://localhost:5173/canned-responses`:
1. Tree shows 9 categories with counts
2. Click category → expand
3. Click item → editor form on right
4. Edit content + insert variable chip → save → toast success → tree updates
5. Drag template within category → reorder persists (refresh page, check)
6. Drag template across categories → category changes
7. Drag whole category → category order changes
8. Inline rename category → all items get new category
9. + เพิ่มประเภทข้อความ inline → new item appears, selected, editable
10. + สร้างชุดข้อความ top-right → prompt category → new category appears
11. Visit `/inbox` → 📋 picker → see updated templates

- [ ] **Step 5: Final cleanup commit if any fixes**

```bash
git add -A
git commit -m "chore(canned-response): smoke-test fixes" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- ✓ Backend reorder endpoint (Task 1)
- ✓ Pure reorder logic + types (Task 2)
- ✓ Tree row components with DnD (Task 3)
- ✓ Tree pane with DnD context (Task 4)
- ✓ Editor pane with form + variable insert (Task 5)
- ✓ Reorder mutation hook (Task 6)
- ✓ Orchestrator with all category/template mutations (Task 7)
- ✓ Integration test (Task 8)
- ✓ Final sweep (Task 9)

**Placeholder scan:** None. All code blocks complete.

**Type consistency:**
- `CannedResponse` shape used consistently across types.ts → all components → page
- `ReorderItem` shape matches between frontend hook and backend endpoint
- DnD `data` payload shape (`{ type, categoryName }`) consistent between `useSortable` calls and `handleDragEnd`

**Known limitations:**
- Category "อื่นๆ" (null category) cannot be renamed (renaming would create a new explicit category — this is intentional)
- Drag handle visible only on hover — accessible alternative: keyboard sortable from @dnd-kit works via Tab+Space+arrows
- No optimistic update on reorder (relies on invalidate). For better UX, could add optimistic updates later
- No undo for delete (relies on soft-delete on backend — could add an "undo" toast later)
