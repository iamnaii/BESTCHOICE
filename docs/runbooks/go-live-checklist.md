# Go-Live Checklist (real นิติบุคคล cutover)

> Generated 2026-06-22. Context: current prod is **throwaway test data, wiped before real go-live**
> (see memory `prod-is-testing-phase-data-wiped`). This checklist is the set of **manual ops steps**
> that are NOT wired into the deploy pipeline (`deploy-gcp.yml` only runs `prisma migrate deploy`).
> Code/engineering go-live blockers are tracked as PRs, not here.

## 0. Pre-cutover code gates (must be merged to `main` first)

- [ ] **PR #1265** — `chat_snoozes` / `chat_side_messages` migration. **CRITICAL**: a freshly-migrated
      go-live DB is missing both tables → snooze cron `P2021` every minute + staff-chat snooze/side
      endpoints 500. Must land before the real DB is built.
- [ ] **PR #1264** — users/employees merge (no schema/data impact; ship when green).
- [ ] Confirm `main` Deploy-to-GCP is green after merges.

## 1. Build the go-live database

`deploy-gcp.yml` Job `migrate-db` runs `prisma migrate deploy` against prod Cloud SQL. After it succeeds:

- [ ] Seed the FINANCE + SHOP chart of accounts (non-destructive upsert):
  ```bash
  EXPECTED_DB_NAME=<prod-db> npm --prefix apps/api run seed:coa
  ```
- [ ] Verify CoA counts (per `.claude/rules/accounting.md`):
  - `SELECT COUNT(*) FROM chart_of_accounts WHERE code NOT LIKE 'S%';` → **99** (FINANCE)
  - `SELECT COUNT(*) FROM chart_of_accounts WHERE code LIKE 'S%';` → **~56** (SHOP)
- [ ] Confirm `chat_snoozes` + `chat_side_messages` exist (`\d chat_snoozes`) — i.e. PR #1265 applied.

## 2. Run the run-once backfill CLIs (in order)

> All are **dry-run by default**; pass `APPLY=true` (or `--apply`) to write, plus
> `ALLOW_PROD_BACKFILL=YES_I_AM_SURE` on prod. Idempotent. On a freshly-seeded DB with few/no legacy
> rows these are near no-ops, **but still run them** so FKs are populated for any pre-existing rows.
> Run order matters where noted. Prefer Cloud Run Jobs for prod.

- [ ] **A — Party-master contacts** (creates `Contact` rows from Customer/Supplier/TradeIn/ExtFinance + sets `contact_id` FKs):
  ```bash
  CONFIRM_BACKFILL=YES_I_AM_SURE EXPECTED_DB_NAME=<prod-db> ALLOW_PROD_BACKFILL=YES_I_AM_SURE \
    npm --prefix apps/api run backfill:contacts
  ```
- [ ] **B — Employee profiles** (provision `EmployeeProfile` per active non-system User) — **run before C**:
  ```bash
  EXPECTED_DB_NAME=<prod-db> APPLY=true ALLOW_PROD_BACKFILL=YES_I_AM_SURE \
    npm --prefix apps/api run backfill:employee-profiles
  ```
- [ ] **C — Payroll → user FK** (link `payroll_lines.user_id`) — **after B**. Tier-1 by default; tier-2 does name-matching + audit:
  ```bash
  EXPECTED_DB_NAME=<prod-db> APPLY=true ALLOW_PROD_BACKFILL=YES_I_AM_SURE \
    npm --prefix apps/api run backfill:payroll-user-fk
  # optional tier-2: add --tier=2 BACKFILL_ACTOR_USER_ID=<owner-uuid>
  ```
- [ ] **(only if PII encryption is enabled for go-live)** `backfill:encrypt-pii` — needs `PII_ENCRYPTION_KEY` (64 hex) + `PII_HASH_SALT` (≥32 chars). See `backfill:encrypt-pii:help`.
- [ ] Record the date/operator of each run (no run-record is auto-kept).

## 3. Runtime smoke (post-deploy, ~5 min)

- [ ] **Staff login is single-step** (2FA removed in #1169) — log in as `admin@bestchoice.com`, confirm no OTP step. (Customer LIFF/KYC OTP is a separate system, expected to remain.)
- [ ] **Staff-chat snooze/side** — open a chat room, create a snooze + a side message → no 500; confirm Sentry has no `P2021` `chat_snoozes` spam after a few minutes.
- [ ] One contract end-to-end via UI; run Trial Balance `scope=FINANCE` and confirm it balances.
- [ ] `/users` — create a user with an HR block, edit across the 3 tabs (single save), remove-from-payroll (validates PR #1264 in prod).

## 4. LINE OA configuration (ops + design — done in LINE OA Manager, not code)

> The code side (`line-oa/rich-menu/rich-menu.service.ts`) exists; these are manual console steps.

- [ ] Upload Rich Menu artwork + set default rich menu (per `docs/sales/line-oa-deployment-plan.md`).
- [ ] Configure auto-reply / keyword / quick-reply.
- [ ] Point the FINANCE + SHOP LINE OA webhooks at the prod API; verify a test message routes.

## 5. Integrations (only if enabled for go-live)

- [ ] **PEAK** — set `PEAK_USER_TOKEN` / `PEAK_CONNECT_ID` / `PEAK_SECRET_KEY` (currently unset → sync is a no-op). If enabling, see the owner-decision brief re: PEAK retry/backoff (T6-C5).
- [ ] **MDM PJ-Soft** — confirm `mdm` credentials in IntegrationConfig.
- [ ] **PaySolutions** — confirm merchant credentials + webhook URL.

---

**Owner-gated items that are NOT go-live blockers** (SHOP-side JE wiring, Tier-8 partials, multi-entity
split) are tracked separately in [`docs/ceo-review/owner-decisions-pending-2026-06-22.md`](../ceo-review/owner-decisions-pending-2026-06-22.md).
