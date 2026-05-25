# Canned Response Admin — CHATCONE-style Redesign

**Date:** 2026-05-25
**Owner ask:** "เอาหน้าตั้งค่า แบบนี้" — owner showed CHATCONE's "ชุดข้อความ" page as reference, wants `/canned-responses` to match

## Problem

Current [`CannedResponseAdminPage.tsx`](apps/web/src/pages/CannedResponseAdminPage.tsx) is a flat table with hardcoded category enum (greeting/payment/sales/general/closing). It doesn't match the categories actually used in data (เรทผ่อน iPhone / Samsung / iPad / etc. seeded in commit `3613b882`), has no per-category actions, no drag-to-reorder, no master-detail editing.

Owner wants CHATCONE-style UX:
- Tree on left grouped by category, click to expand
- Master-detail: select template → edit form on right
- Drag-and-drop reorder (within group + across groups + reorder categories)
- Per-category actions: rename, duplicate, delete-all
- Per-item actions: duplicate, delete
- Inline "+ เพิ่มประเภทข้อความ" inside each category
- Top-right "+ สร้างชุดข้อความ" creates new category

## Goal

Replace `CannedResponseAdminPage.tsx` with `CannedResponseAdminPage.tsx` (overwrite) implementing CHATCONE-style master-detail tree-with-DnD. Drop the hardcoded `CATEGORIES` enum — categories are free-text strings derived from existing data.

## Non-Goals

- ไม่สร้าง `Category` model (categories ยังเป็น free-text บน `CannedResponse.category`)
- ไม่ทำ multi-select / bulk delete
- ไม่ทำ import/export CSV
- ไม่ทำ template versioning / history
- ไม่ทำ per-role visibility (templates ยัง global)

## Architecture

### Schema

**No schema changes.** `CannedResponse.category String?` + `sortOrder Int` already support what we need.

### Sort order semantics

- `sortOrder` is **globally unique-ish** (low number = top). Categories don't have their own sort order field — category position is derived from `min(sortOrder)` of items in that category (already implemented in MessageTemplatePicker — keep same convention).
- DnD reorder produces a NEW global `sortOrder` for affected items.
- Across-category drag also updates `category` field.

### Reorder API

**New endpoint**: `PATCH /staff-chat/canned-responses/reorder`

**Request**: `{ items: [{ id, sortOrder, category }] }`

**Behavior**:
- Wraps in `prisma.$transaction`
- For each item, `update({ where: { id }, data: { sortOrder, category } })`
- Returns 204 on success, 400 on validation error (missing id, etc.)
- Roles: `OWNER, BRANCH_MANAGER`
- Validation: array max 200 items, sortOrder must be integer >= 0, category length <= 100

**Why bulk PATCH not individual**: a single drag can rearrange dozens of items (e.g., drag category top→bottom rearranges sortOrders of every item in every category). Bulk avoids N round trips.

### Frontend

#### File structure
- **Modify**: [`apps/web/src/pages/CannedResponseAdminPage.tsx`](apps/web/src/pages/CannedResponseAdminPage.tsx) — full rewrite as orchestrator
- **Create**: `apps/web/src/pages/CannedResponseAdminPage/components/CategoryTreePane.tsx` — left pane (DnD tree)
- **Create**: `apps/web/src/pages/CannedResponseAdminPage/components/TemplateEditorPane.tsx` — right pane (form)
- **Create**: `apps/web/src/pages/CannedResponseAdminPage/components/CategoryHeader.tsx` — row component with collapse + actions
- **Create**: `apps/web/src/pages/CannedResponseAdminPage/components/TemplateItem.tsx` — leaf row with actions
- **Create**: `apps/web/src/pages/CannedResponseAdminPage/hooks/useReorderMutation.ts` — react-query mutation for reorder
- **Create**: `apps/web/src/pages/CannedResponseAdminPage/CannedResponseAdminPage.test.tsx` — vitest
- **Delete**: old monolithic content of `CannedResponseAdminPage.tsx` (since we're moving file to `CannedResponseAdminPage/index.tsx` style)

**Decision**: keep `CannedResponseAdminPage.tsx` as the entry file (preserves route registration in App.tsx without changes). Place sub-components in sibling `apps/web/src/pages/CannedResponseAdminPage/components/` directory.

Wait — that creates ambiguity (both a file `CannedResponseAdminPage.tsx` and a directory `CannedResponseAdminPage/`). React/Vite is fine with this but it's ugly. Alternative: move to `apps/web/src/pages/CannedResponseAdminPage/index.tsx` and update App.tsx import. But then App.tsx import path changes.

**Final decision**: Keep `CannedResponseAdminPage.tsx` as file at original path (App.tsx import stays `@/pages/CannedResponseAdminPage`). Put helper components in `apps/web/src/pages/CannedResponseAdminPage/components/` as siblings (TS auto-resolves `.tsx` extension before directories with no `index.tsx`).

Even simpler: put helper components in `apps/web/src/pages/canned-response-admin/` directory and import from there. This avoids the file/dir ambiguity.

```
apps/web/src/pages/
  CannedResponseAdminPage.tsx        ← stays, route entry
  canned-response-admin/
    CategoryTreePane.tsx
    TemplateEditorPane.tsx
    CategoryHeader.tsx
    TemplateItem.tsx
    useReorderMutation.ts
    types.ts                          ← shared CannedResponse interface
```

### DnD library

**@dnd-kit** (already widely used in BESTCHOICE — check first). If not present, install `@dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`.

Verify before assuming: `grep -r "@dnd-kit" apps/web/package.json`. If missing, add to deps.

### State management

Local component state (no Zustand). Tree state:
```ts
{
  expandedCategories: Set<string>      // collapsed/expanded state
  selectedTemplateId: string | null     // for right pane
  formDirty: boolean                    // confirm-leave
}
```

React-query handles server state:
- `useQuery(['canned-responses-admin'])` — full list (refetchOnWindowFocus default)
- `useMutation(createTemplate)`
- `useMutation(updateTemplate)`
- `useMutation(deleteTemplate)`
- `useMutation(reorderItems)` — uses new bulk endpoint
- `useMutation(renameCategory)` — convenience mutation = bulk patch all templates where category === old
- `useMutation(deleteCategory)` — soft-delete all templates where category === target

## UI/UX

### Top bar
- Title "ข้อความสำเร็จรูป" (page header)
- Right: `[+ สร้างชุดข้อความ]` button — opens prompt for new category name, then creates first empty template in it (or opens right-pane with form pre-filled `category=newName`)

### Layout
- 2-pane horizontal split: left tree (w-96 = 24rem) + right editor (flex-1)
- Border between
- Top of left: search bar
- Below search: tree (overflow-y-auto)
- Right: form when item selected, else empty state with "Setting reply message" icon (CHATCONE pattern)

### Tree (left pane)
- Each row: drag handle (⋮⋮ icon, GripVertical from lucide) + chevron + label + count + actions
- Category row:
  - Drag handle (hover-only visible)
  - ▼/▶ chevron (click to toggle expand)
  - Category name (click to also toggle expand)
  - Count badge (right side, muted)
  - Actions on hover: copy icon (duplicate category w/ all templates), pencil (rename inline), trash (delete all)
- Template item (when category expanded):
  - Drag handle (hover-only)
  - Item title (click to select for editor)
  - Selected = left border emerald + bg emerald-50
  - Actions on hover: copy (duplicate template), trash (delete)
- After all items in a category: inline `+ เพิ่มประเภทข้อความ` button (red text + plus icon, CHATCONE style)
  - Click → adds new template in this category, selects it, focuses title input in right pane

### Editor (right pane)
- Empty state: centered icon + "เลือก template เพื่อแก้ไข"
- When template selected:
  - Form fields:
    - Title (text input)
    - Shortcut (text input, leading `/` required — validation)
    - Category (select from existing categories OR free-text input)
    - Sort Order (number input, read-only display — actual reorder via DnD)
    - Content (textarea, ~12 rows, monospace-ish, with variable hints below)
  - Below: list of available variables as chips (click to insert at cursor in textarea):
    `{customerName} {customerPhone} {contractNumber} {amountDue} {dueDate} {installmentNo} {branchName}`
  - Live preview panel (collapsed by default, expand to show — uses existing preview endpoint with `roomId=null` so variables stay as `{placeholder}` since there's no chat context here)
  - Footer: `Cancel` (revert form to last saved) + `Save` (button disabled when not dirty)

### DnD behaviors
- Drag template within category: reorder, sortOrder updates
- Drag template into another category: category changes, sortOrder updates to fall in target group
- Drag category (drag the category row itself): all templates in that category reorder en-masse
- Drag preview: ghost element showing dragged item title
- Drop target indicator: thin emerald line between rows
- Smooth animations via `@dnd-kit/sortable`'s default

### Confirmation dialogs
- Delete template: "ลบ {title}?" + "ยกเลิก/ลบ"
- Delete category: "ลบหมวด '{name}'? จะลบ template ทั้งหมด N ตัวในหมวดนี้" + "ยกเลิก/ลบทั้งหมด"
- Rename category: inline edit on category name (Enter to save, Esc to cancel)
- Leave with unsaved changes: "มีการแก้ไขที่ยังไม่บันทึก — ออกจริงหรือไม่?" before switching template

## Error handling

| Scenario | Behavior |
|---|---|
| API down | Toast error + retry button in tree |
| Reorder fails | Revert optimistic UI + toast "เรียงลำดับไม่สำเร็จ" |
| Save validation fails | Inline error under field, toast warn |
| Shortcut duplicate (server returns 409) | Inline error on Shortcut field |
| Variable preview API error | Hide preview pane, fallback to raw content |

## Testing

### Unit (vitest)
- `CannedResponseAdminPage.test.tsx`:
  - Renders tree grouped by category
  - Click category → expand/collapse
  - Click item → loads form in right pane
  - Edit + save → mutation called with patched fields
  - Empty state when no template selected
  - Search filters across title/content/shortcut/category
  - DnD reorder triggers reorder mutation with correct payload (use @dnd-kit testing utilities OR skip behavioral DnD tests, just unit-test the reorder hook logic)
- `useReorderMutation.test.ts`:
  - Computes correct sortOrder updates when dragging within category
  - Computes correct sortOrder + category updates when dragging across categories
  - Computes correct bulk updates when dragging a whole category

### Integration (jest, API)
- `staff-chat.controller.spec.ts`: add tests for new `reorder` endpoint
  - Happy path: bulk updates applied
  - Validation: rejects > 200 items
  - Validation: rejects non-integer sortOrder
  - Roles: 403 for SALES/ACCOUNTANT

### Manual smoke
1. เปิด `/canned-responses` → เห็น tree categorized (8+ categories from seed)
2. คลิก "เรทผ่อน iPhone" → expand เห็น 5 รายการ
3. คลิก "iPhone 16 Pro 256GB" → form ขวาขึ้น content
4. แก้ Content → ปุ่ม Save activate → กด Save → toast success
5. กดปุ่ม `+เพิ่มประเภทข้อความ` ใต้ category → row ใหม่โผล่, selected, focus title input
6. กรอกข้อมูล + Save → row updates in tree
7. Drag "iPhone 17" จาก iPhone group ไป iPad group → category เปลี่ยน
8. Drag whole "เรทผ่อน Samsung" category ลงล่างสุด → ลำดับเปลี่ยน
9. กดปุ่ม pencil บน category → inline rename → ทุก templates ในหมวดนั้น category field เปลี่ยน
10. กดปุ่ม trash บน category → confirm dialog → delete all
11. กดปุ่ม `+สร้างชุดข้อความ` ขวาบน → prompt category name → category ใหม่โผล่
12. กลับมาเปิดหน้า `/inbox` → กดปุ่ม 📋 → modal picker เห็น templates ตามที่แก้แล้ว

## Open questions

- **Q1**: Inline rename on category — Enter saves immediately or wait for explicit save button?
  - **Default**: Enter saves immediately (auto-save). Esc cancels. Less clicks.
- **Q2**: Drag handle visibility — always visible or hover-only?
  - **Default**: hover-only (cleaner default state). Drag handle appears on row hover.
- **Q3**: When dragging a category, do all items keep their relative order within the category?
  - **Default**: YES. Only the category's position in the global sortOrder changes; items inside keep relative order.
- **Q4**: Should the right pane scroll independently from the left tree?
  - **Default**: YES — both panes have own `overflow-y-auto`.
