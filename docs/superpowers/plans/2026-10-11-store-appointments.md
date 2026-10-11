# Store appointments implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** ลูกค้าที่ผ่านเครดิตเบื้องต้นและพนักงานจองคิวเดียวกันตามตารางพนักงานได้ พร้อมจัดการนัดและประวัติใน SHOP/Inbox

**Architecture:** NestJS module owns availability, eligibility, transactional mutations and capability links. Prisma/PostgreSQL enforces durable appointments and credit decision memory. React Query powers staff and public pages and shared appointment summaries in existing customer/chat screens.

**Tech Stack:** Existing NestJS, Prisma, PostgreSQL, React, Tailwind, React Query, Jest, Vitest and Playwright; no new product dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-store-appointments-design.md`

## Global Constraints

- 45 minutes per appointment, 30-minute lead, 14 Bangkok calendar days including today.
- Booking capability 30 days; appointment management capability endsAt + 24 hours.
- At most one open appointment per customer; no overlapping active appointment per employee.
- SHOP only, existing company/branch/room grants apply. No messages, production DB writes, merge or deploy.
- Closing employee accounts remains possible immediately; existing appointments require reassignment.
- Local isolated PostgreSQL and checkout-owned preview; `npm run local:check` before handing back code.
- Native execution authorized by user's “เริ่มทำเลยไหม”; proceed without another implementation-permission round. Fresh read-only review before completion.

## Review Focus

- Credit rejected then reset to pending cannot resurrect an older approval: Task 1/2 persisted decision tests.
- Simultaneous staff/public final-slot booking must have exactly one winner: Task 2 database race test.
- Account disabled while a booking commits preserves the appointment and flags reassignment: Task 2 race test.
- Link booking privilege expires before its booked appointment: Task 3 day-29/day-39 capability test.
- Customers with multiple rooms and appointments without sourceRoomId: Task 5 summary/journey dedupe test.

### Task 1: Policy, persistence and credit decision memory

**Files:** create `apps/api/src/modules/store-appointments/appointment-policy.ts`, `appointment-policy.spec.ts`; modify Prisma schema; create additive migration; modify credit-check writers (or equivalent atomic database enforcement).

**Interfaces:** policy exports `SLOT_MS`, `OPEN_STATUSES`, Bangkok date bounds, slot generation, effective decision and transition validators. Database exposes staff windows, appointments, links/access, events and request deduplication; CreditCheck persists latest decisive status.

- [x] Write policy tests, including adjacent windows, past/closing times and UNKNOWN decisions. Example: `expect(availableSlots(windows, busy, day, now)).toEqual([{ startsAt, endsAt, available: 1 }])` for one uninterrupted 45-minute window.
- [x] Run `npm test --workspace=apps/api -- --runInBand appointment-policy.spec.ts`; observe missing behavior failure.
- [x] Implement typed pure policy, schema and migration. Preserve previous credit decision when status returns to pending; initialize legacy unresolved records UNKNOWN. Use real PostgreSQL enforcement to keep every writer atomic if narrower and safer than patching each writer.
- [x] Generate both Prisma clients, run policy tests and schema validation; expected pass. Commit task.

### Task 2: Staff schedule and transactional appointment service

**Files:** create module DTO, access, schedule, appointment query/mutation services and controller under `apps/api/src/modules/store-appointments/`; register AppModule; create `apps/api/e2e/store-appointments.e2e-spec.ts` and isolated runner.

**Interfaces:** `/store-appointments/options`, `/windows`, `/availability`, `/eligibility/:customerId`, collection/detail, `/:id/reschedule`, `/:id/reassign`, `/:id/status`. Staff actor is `{ id, role, branchId, accessibleCompanies }`. Mutations carry requestId and existing appointment version; availability returns startsAt/endsAt/available.

- [x] Write real-DB tests before service implementation: credit pass, three staff/four concurrent requests, same customer/two requests, overlapping shifted slots, failed move rollback, deactivation/reassignment, branch and room denial.
- [x] Run isolated runner and observe failures from missing behavior.
- [x] Implement customer/employee locks, revalidation, partial unique index, CAS/version, idempotent mutations and immutable events. Schedule delete/edit checks affected appointments; account updates do not depend on appointments. Reject malformed dates, cross-midnight windows, ranges outside the horizon and unscoped actors.
- [x] Run database tests and API typecheck; expected pass. Commit task.

### Task 3: Customer capability access

**Files:** create public/link service and controller under module; update public security registry, token redaction as needed; extend real-DB/HTTP tests.

**Interfaces:** staff `/links` issue/revoke; public `/store-appointments-public/context`, `/availability`, `/book`, `/:id/reschedule`, `/:id/cancel` use `X-Appointment-Token` and return allow-listed appointment/branch data only.

- [x] Write tests: day 29 book day 39, creation expiry still permits bound management; revoke blocks both; idempotent retry; unbound appointment and branch substitution denied; issuer account disabled does not revoke customer capability.
- [x] Run isolated tests and observe new cases fail.
- [x] Implement random token/hash, booking/access expiry separation, redacted header, transaction-bound link access, request validation and throttling. Use explicit CSRF exception on token-only public routes.
- [x] Run isolated suite and API typecheck; expected pass. Commit task.

### Task 4: Staff and public pages

**Files:** create `apps/web/src/pages/StoreAppointmentsPage/`, `apps/web/src/pages/PublicAppointmentPage/`, shared `apps/web/src/components/appointments/`; update App, Sidebar/navigation, public route handling and API public instance.

**Interfaces:** components consume Task 2/3 APIs; public route `/visit#token`, staff route `/appointments?customerId=...&roomId=...`.

- [x] Add UI tests for schedule creation, selected time reset after branch/date changes, empty/full/error states, booking confirmation, conflict retry and cancel/reschedule. Example: render page with rejected availability request and assert visible retry instead of empty slots.
- [x] Run focused Vitest tests, observe failure before creating components.
- [x] Implement approved mobile design with real server state, scoped staff schedule/list lifecycle, copy link without sending, version-safe mutations and accessible inputs. Public uses memory-only fragment token; no auth refresh or analytics leakage.
- [x] Run focused tests and web typecheck; expected pass. Commit task.

### Task 5: Customer, Inbox and journey integration

**Files:** customer detail, RoomDossier/ChatSalesContext, room-manager summaries, ConversationItem/ChatPanel/Inbox, AppointmentAlertBar, customer-journey source; shared appointment summary component/hooks.

**Interfaces:** appointment summaries include kind and allowed actions; never PATCH Todo for a store appointment. Summary queries use linked customerId with actor branch scope; events dedupe by event ID.

- [x] Add tests for a public booking without sourceRoomId appearing in linked rooms, room/scope denial, check-in routing and journey event dedupe.
- [x] Run tests and observe failure; implement shared summary queries/batched projections, entry points, due alerts and journey source.
- [x] Run focused web/API tests; expected pass. Commit task.

### Task 6: Preview, browser acceptance and review

**Files:** isolated test/preview harness extension, feature browser tests, `.tmp/local-preview` evidence (ignored).

- [x] Extend checkout-owned local preview with real appointment controllers/services on synthetic PostgreSQL. Seed synthetic credit-approved customers/staff windows, no outbound messages.
- [x] Run isolated database/HTTP suite and `npm run local:check` on an available port; expected no failing required checks.
- [x] Browser-test staff schedule → staff booking/link → public booking/conflict/reschedule/cancel → staff check-in/completion at desktop and mobile sizes; inspect screenshots and errors.
- [x] Request fresh read-only whole-branch review; address material findings with regression tests. Re-run affected checks after fixes.
- [x] Leave verified local preview running and report URL, test evidence and any material limitations accurately. Do not deploy or merge.
