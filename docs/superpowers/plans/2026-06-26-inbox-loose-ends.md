# Inbox Fix K — loose ends (soft-deleted preview + WS auth hardening) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the two real-but-minor remaining audit items: (1) the room-list last-message preview shows soft-deleted (retention-purged) messages; (2) the WebSocket gateway authenticates the JWT signature but — unlike the REST path — never re-checks `isActive` in the DB, so a deactivated user with a still-valid token can connect + send.

**Tech Stack:** NestJS + Prisma (api). Backend-only.

## Global Constraints
- Backend: controller/gateway → service → Prisma; soft-delete `deletedAt: null`. Prettier (semi, singleQuote, printWidth 100, tabWidth 2).
- Verify: `./tools/check-types.sh api`.
- Do NOT change the inbox UI, filtering, pagination, send idempotency, or the message THREAD query (getRecentMessages already filters deletedAt). Scope = the two fixes only.

## Verified current-state facts
- `room-manager.service.ts` `listRooms` `$transaction` findMany `include.messages` (438-442): `{ orderBy: { createdAt: 'desc' }, take: 1, select: { text, role, createdAt } }` — NO `where: { deletedAt: null }`, so the last-message preview can be a soft-deleted row. (A second `messages` include exists at ~810 — inspect whether it's also an unfiltered preview.)
- `staff-chat.gateway.ts` `handleConnection` (70-111): `jwtService.verify(token, {secret})` → `userId = payload.sub`, `userName = payload.name` → attaches to socket + joins rooms. NO DB lookup, NO `isActive` check. The constructor (60-68) injects messageRouter/roomManager/presenceService/collisionDetectionService/jwtService/configService/leadScoring — NOT PrismaService.
- `jwt.strategy.ts` `validate` (83-97): `user = prisma.user.findUnique({ where:{id:payload.sub}, select:{... isActive } })` then `if (!user || !user.isActive) throw UnauthorizedException` — the REST path the WS should mirror. (`PrismaService` is global — injectable into the gateway; match the import path used by `room-manager.service.ts` or another staff-chat file.)

---

### Task 1: filter soft-deleted messages out of the room-list preview

**Files:** Modify `apps/api/src/modules/chat-engine/services/room-manager.service.ts`.

- [ ] **Step 1: Add the deletedAt filter to the listRooms preview** — In the `listRooms` `include.messages` (438-442), add `where: { deletedAt: null }`:

```ts
messages: {
  where: { deletedAt: null },
  orderBy: { createdAt: 'desc' },
  take: 1,
  select: { text: true, role: true, createdAt: true },
},
```

- [ ] **Step 2: Check the second include (~810)** — Read the `messages` include around line 810. If it is also a last-message PREVIEW (take:1, for display) lacking `where: { deletedAt: null }`, add the same filter. If it's a different query that already filters deletedAt elsewhere or intentionally includes all, leave it + note why in the commit.

- [ ] **Step 3: Typecheck** — `./tools/check-types.sh api` → API OK.
- [ ] **Step 4: Commit** — `git add apps/api/src/modules/chat-engine/services/room-manager.service.ts && git commit -m "fix(inbox): exclude soft-deleted messages from the room-list preview"`

---

### Task 2: re-check isActive on WebSocket connect (mirror the REST JwtStrategy)

**Files:** Modify `apps/api/src/modules/staff-chat/staff-chat.gateway.ts`.

- [ ] **Step 1: Inject PrismaService** — Add the import (match the path used by a sibling staff-chat/chat-engine file, e.g. `import { PrismaService } from '<correct-relative-path>/prisma/prisma.service';`) and add `private prisma: PrismaService,` to the constructor (60-68).

- [ ] **Step 2: DB-verify the user on connect** — In `handleConnection`, after the JWT `try { ... payload = jwtService.verify(...) ; userId = payload.sub; userName = payload.name ... } catch { disconnect }` block succeeds, add a DB check that mirrors the REST strategy (reject deactivated/missing users):

```ts
// Mirror the REST JwtStrategy: a valid signature is not enough — reject
// deactivated/deleted users (whose token may still be unexpired).
const user = await this.prisma.user.findUnique({
  where: { id: userId },
  select: { isActive: true, name: true, role: true },
});
if (!user || !user.isActive) {
  this.logger.warn(`[WS] Connection rejected — user ${userId} missing or inactive`);
  client.disconnect();
  return;
}
userName = user.name ?? userName;
(client as any).role = user.role;
```

Place it AFTER `userId`/`userName` are assigned from the payload and BEFORE `presenceService.setOnline` / the room joins (so an inactive user never registers presence or joins). Keep the existing `(client as any).userId = userId; (client as any).userName = userName;` assignments (update userName from the DB value).

- [ ] **Step 3: Typecheck** — `./tools/check-types.sh api` → API OK.
- [ ] **Step 4: Commit** — `git add apps/api/src/modules/staff-chat/staff-chat.gateway.ts && git commit -m "fix(inbox): WS gateway re-checks isActive on connect (mirror REST JwtStrategy)"`

---

## Self-Review
**Coverage:** soft-deleted preview filter (T1) + WS isActive re-check (T2). **Correctness:** the preview now excludes deletedAt rows (the thread view already did); the WS connect now rejects deactivated users like REST does (a real, if narrow, parity gap — a deactivated user with a live token could previously connect + send). **No regression:** only the listRooms preview include + the gateway connect flow change; the message thread query, send, filters, pagination untouched. **Placement:** the isActive check runs before presence/room-join so an inactive user never registers. **DB cost:** one indexed `user.findUnique` per WS connect (cheap, once per socket — same as REST does per request).

## Rollout
One branch (`fix/inbox-loose-ends`) → 2 commits → review → merge → deploy.
