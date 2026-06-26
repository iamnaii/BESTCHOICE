# Inbox Fix E — Transfer-to-staff broken feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the broken "โอนให้พนักงาน" (transfer-to-staff) dropdown — it currently shows blank rows and transfers to an `undefined` staffId because the backend returns the wrong object shape.

**Root cause (confirmed):** `GET /staff-chat/staff/online` returns `AssignmentService.getStaffRoomCounts()` whose shape is `{ staffId: string; activeCount: number }[]` (no `id`/`name`). The frontend `SessionActions` reads `s.id` (self-filter), `staff.id` (key + `onTransfer(staff.id)`), and `staff.name ?? staff.email` (label) — all `undefined`. So the dropdown lists blank rows (only for staff that happen to have ≥1 active room) and clicking transfers `undefined`. `getStaffRoomCounts` is ALSO consumed by the auto-assign least-busy logic (`assignment.service.ts:235-236`, reads `.staffId`/`.activeCount`) so its shape must NOT change — add a new endpoint-specific method instead.

**Tech Stack:** NestJS + Prisma (api) + React 18 + @tanstack/react-query (web).

## Global Constraints
- Backend: controller → service → Prisma; reuse `getStaffRoomCounts` for counts; soft-delete `deletedAt: null`; eligible roles must match the auto-assign set (`OWNER, BRANCH_MANAGER, FINANCE_MANAGER, SALES` — NOT ACCOUNTANT).
- Frontend: design tokens only; Thai `leading-snug`; useQuery + `@/lib/api`; Prettier (semi, singleQuote, printWidth 100, tabWidth 2).
- Verify: `./tools/check-types.sh api` + `./tools/check-types.sh web`.
- Do NOT change `getStaffRoomCounts`'s shape (auto-assign depends on it). Do NOT touch the assign / resolve / take-over / return-to-AI actions.

## Verified current-state facts
- `assignment.service.ts:267-286` `getStaffRoomCounts(): Promise<{ staffId; activeCount }[]>` — groupBy ACTIVE rooms by assignedToId; only returns staff WITH ≥1 active room. Auto-assign (`235-236`) builds `new Map(counts.map(c => [c.staffId, c.activeCount]))`.
- `staff-chat.controller.ts:451-454` `@Get('staff/online')` `@Roles('OWNER','BRANCH_MANAGER','FINANCE_MANAGER','SALES')` → `return this.assignment.getStaffRoomCounts();`. Class has `@UseGuards(JwtAuthGuard, RolesGuard)`.
- `User` model: `id`, `name String`, `email String @unique`, `role UserRole`, `isActive Boolean` — all present.
- `SessionActions.tsx`: `staffQuery` (key `['staff-online']`, enabled on dropdown open) → `r.data`; `.filter((s) => s.id !== currentUserId)` (34-39, 101-116); each row `key={staff.id}`, `onClick={() => onTransfer(staff.id)}`, label `{staff.name ?? staff.email}`; green dot `title="ออนไลน์"`; empty state `"ไม่มีพนักงานออนไลน์"`. The transfer toggle (78-85) `onClick={() => setShowStaffList(v => !v)}` has no aria-expanded; the dropdown (88) is a floating `absolute ... z-20` div with no ESC / click-outside.

---

### Task 1 (backend): assignable-staff endpoint with names + counts

**Files:** Modify `apps/api/src/modules/chat-engine/services/assignment.service.ts` (+`getAssignableStaff`) + `apps/api/src/modules/staff-chat/staff-chat.controller.ts` (`/staff/online`).

**Interfaces produced:** `GET /staff-chat/staff/online` → `{ id: string; name: string; email: string; activeCount: number }[]` (all active, eligible-role staff; sorted by name).

- [ ] **Step 1: `getAssignableStaff` service method** — In `assignment.service.ts`, add after `getStaffRoomCounts` (after line 286):

```ts
/** Staff eligible to receive a transfer (active, eligible roles) joined with
 *  their active-room load. Used by GET /staff/online for the transfer picker.
 *  Distinct from getStaffRoomCounts (which only returns staff that already hold
 *  rooms and is shaped for the auto-assign load balancer). */
async getAssignableStaff(): Promise<
  { id: string; name: string; email: string; activeCount: number }[]
> {
  const [staff, counts] = await Promise.all([
    this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        role: { in: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'] },
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
    this.getStaffRoomCounts(),
  ]);
  const countMap = new Map(counts.map((c) => [c.staffId, c.activeCount]));
  return staff.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    activeCount: countMap.get(s.id) ?? 0,
  }));
}
```

(If `role: { in: [...] }` needs the `UserRole` enum import to satisfy types, import it from `@prisma/client` and use `UserRole.OWNER` etc. — mirror however `getBestAvailableStaff` at line 243 types its `role: { in: [...] }`; match that exact style.)

- [ ] **Step 2: Point the endpoint at it** — In `staff-chat.controller.ts`, change `getOnlineStaff` (453) body to `return this.assignment.getAssignableStaff();`. Keep the route + @Roles unchanged.

- [ ] **Step 3: Typecheck** — `./tools/check-types.sh api` → API OK.
- [ ] **Step 4: Commit** — `git add apps/api/src/modules/chat-engine/services/assignment.service.ts apps/api/src/modules/staff-chat/staff-chat.controller.ts && git commit -m "fix(inbox): /staff/online returns assignable staff with id+name (was groupBy counts shape)"`

---

### Task 2 (frontend): show load + correct copy + dropdown a11y

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/components/SessionActions.tsx`.

The shape fix in Task 1 already makes `staff.id`/`staff.name` resolve, so the bug is fixed. This task adds the small correctness/a11y polish that belongs in the same file.

- [ ] **Step 1: Accurate row meta (load, not a fake "online" dot)** — The green `title="ออนไลน์"` dot implies presence the endpoint doesn't actually check. Replace the per-row meta: keep a neutral dot OR show the active-room load. Change the row label block (113-115) to:

```tsx
<span className="truncate flex-1">{staff.name ?? staff.email}</span>
{typeof staff.activeCount === 'number' && staff.activeCount > 0 && (
  <span className="shrink-0 text-[10px] text-muted-foreground leading-snug">
    {staff.activeCount} ห้อง
  </span>
)}
```

(Remove the misleading green `bg-success` "ออนไลน์" dot at line 113.)

- [ ] **Step 2: Fix the empty-state copy** — line 99 `"ไม่มีพนักงานออนไลน์"` → `"ไม่มีพนักงานให้โอน"` (the list is assignable staff, not presence-online).

- [ ] **Step 3: a11y on the transfer toggle + dropdown** — On the toggle button (78-85) add `aria-haspopup="menu"` and `aria-expanded={showStaffList}`. Make the floating dropdown dismissable: add a `useEffect` (active only while `showStaffList`) that closes it on `Escape` and on click outside its container. Wrap the existing `<div className="relative">` ref:

```tsx
const transferRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  if (!showStaffList) return;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowStaffList(false); };
  const onClick = (e: MouseEvent) => {
    if (transferRef.current && !transferRef.current.contains(e.target as Node)) setShowStaffList(false);
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('mousedown', onClick);
  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('mousedown', onClick);
  };
}, [showStaffList]);
```

Attach `ref={transferRef}` to the `<div className="relative">` at line 77. Add `import { useRef, useEffect } from 'react'` (extend the existing `useState` import).

- [ ] **Step 4: Typecheck** — `./tools/check-types.sh web` → Web OK.
- [ ] **Step 5: Manual verification** — open a room → "โอนให้พนักงาน" → the dropdown lists real staff NAMES (yourself excluded), each with their room load; clicking a name transfers to that real staffId (no more undefined); ESC / click-outside closes it; empty state reads "ไม่มีพนักงานให้โอน".
- [ ] **Step 6: Commit** — `git add apps/web/src/pages/UnifiedInboxPage/components/SessionActions.tsx && git commit -m "fix(inbox): transfer dropdown shows real names + load, accurate copy, ESC/click-outside + aria"`

---

## Self-Review
**Root-cause fix:** the bug is the backend shape mismatch — Task 1 alone restores `staff.id`/`staff.name`; Task 2 is polish. **No regression:** `getStaffRoomCounts` untouched (auto-assign safe); the endpoint route + @Roles unchanged; `assign`/`resolve`/`take-over` actions untouched. **Roles:** assignable set matches the auto-assign eligible roles (no ACCOUNTANT). **Types:** the new method returns `{id,name,email,activeCount}`; the frontend already reads exactly those. **a11y:** ESC + click-outside + aria-expanded on the one genuinely-floating overlay (the transfer staff list).

## Rollout
One branch (`fix/inbox-transfer-staff`) → 2 commits → review → merge → deploy → user verifies the transfer dropdown.
