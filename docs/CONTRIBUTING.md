# Contributing / Team Onboarding

Welcome. This repo is a Thai installment-payment + accounting system (SHOP retail + FINANCE financing). Read these before touching code:
- `.claude/CLAUDE.md` — architecture, business model, WAT framework, key routes, roles.
- `.claude/rules/` — `backend.md`, `frontend.md`, `database.md`, `security.md`, `accounting.md`, `coding-standards.md`. **`accounting.md` is mandatory before touching any journal/JE/money code.**

## Local setup

```bash
# 1. Node 20+, then install (npm workspaces — run at repo root)
npm install

# 2. Local Postgres (DB name `bestchoice`). Create the DB, then:
cp .env.example .env        # fill in DATABASE_URL etc. — see "Secrets" below
cd apps/api
npx prisma generate         # generates the Prisma client(s)
npx prisma migrate deploy   # apply all migrations to your local DB
npm run seed:coa            # seed FINANCE + SHOP chart of accounts (idempotent)

# 3. Run
cd ../.. && npm run dev      # API :3000 + Web :5173
```

Test accounts (dev) are listed in `.claude/CLAUDE.md` (admin@bestchoice.com / admin1234, etc.).

### Secrets
- **Never commit `.env`** (it's gitignored). Get real values (DB URL, S3, integration keys) from the lead via a secure channel — not chat/email/PR.
- GCP / deploy secrets live in GitHub Actions secrets; you do not need them locally.

## Running checks (match CI before pushing)

```bash
# API: typecheck + tests (jest runs SERIAL — always --runInBand)
cd apps/api && npx tsc --noEmit -p tsconfig.json
npm --prefix apps/api test -- <path/to/file.spec.ts>      # single suite while iterating
# Web
cd apps/web && npx tsc --noEmit && npx vitest run
```

- `apps/api` jest is `jest --runInBand --forceExit`. **DB-backed specs are flaky under parallel multi-module runs** — always single-suite or `--runInBand`, never the raw parallel batch.
- The **E2E** workflow is known-flaky infra (dashboard spec times out). The authoritative gate is **`Lint & Test`** (jest + tsc), not E2E.

## Branch & PR workflow (main is PROTECTED)

`main` is protected: **PR required**, **`Lint & Test` must pass**, branch must be **up to date**, **1 approving review**, linear history, no force-push/deletion.

> ⚠️ **Merging to `main` auto-deploys to production** (`deploy-gcp.yml` on push to `main` → GCP Cloud Run + Firebase + `prisma migrate deploy`). Prod is currently throwaway test data (wiped before real go-live), but treat every merge as a real deploy.

1. Branch off the latest `main`: `git fetch origin main && git checkout -b feat/<thing> origin/main`.
2. **One PR per task.** Keep PRs small and reviewable. `base = main` always.
3. Commit messages: conventional (`feat(scope): ...`, `fix(scope): ...`). End AI-assisted commits with the `Co-Authored-By` trailer.
4. Open the PR, wait for **`Lint & Test`** green + **1 review**, then **squash-merge** + delete branch.
5. After merge, `git fetch && git checkout main && git pull` before starting the next branch (up-to-date is enforced).

### Hard rules (learned from past incidents)
- **Never push directly to `main`.** Use a PR.
- **Never merge stacked/dependent PRs without retargeting `base → main` first**, and **always verify the content actually landed on `main` after merge** (don't trust the "MERGED" badge alone). A past incident merged stacked PRs and the content landed on parent branches, not main.
- **Money-path code (journal/JE/accounting)** gets extra scrutiny — request an adversarial review, lean on the golden specs in `apps/api/src/modules/journal/**/__tests__`.
- Don't disable global guards (Throttler/Csrf/Audit) or commit secrets.

## Working in parallel (two independent workstreams)

Two people work different, unrelated areas in this one repo. Keep the code from tangling:

- **Stay in your lane.** Each person owns module(s)/folders agreed up front. **No cross-imports between lanes** — if you need something from the other lane, ask first and consume it through a clear public interface; never reach in and edit its internals.
- **Ownership is enforced by `.github/CODEOWNERS`** + branch protection "require code-owner review". A PR touching an area auto-requests that area's owner. Add your lane to CODEOWNERS so you own it.
- **Small, short-lived branches; rebase often.** Long branches drift and conflict. One PR per logical change.

### Prisma migrations — the #1 two-dev hazard
`schema.prisma` is a single shared file and migrations are timestamp-ordered, so uncoordinated changes collide. Rules:
- **`git fetch origin main && git rebase origin/main` *before* creating a migration**, every time.
- Migration dir timestamp must be **greater than the latest on `main`** (synthetic monotonic `2026097N000000_*`, not wall-clock).
- **One migration per PR.** Don't edit the same model concurrently with the other person — coordinate schema edits.
- After the other person's migration merges, rebase and `npx prisma generate` before continuing.

### Shared files (expect occasional trivial conflicts)
`apps/api/src/app.module.ts` (module registration), `package.json` (deps) — resolve by rebase. Branch protection no longer requires "up to date before merge" (`strict=false`) so unrelated lanes don't force each other to rebase on every merge — but still rebase when you touch a shared file.

## Current work

- Active spec: `docs/superpowers/specs/2026-06-23-shop-je-wiring-design.md`
- Active plan: `docs/superpowers/plans/2026-06-23-shop-je-wiring-p0-p1.md` (8 tasks, TDD, dependency-ordered)
- Tasks are tracked as GitHub issues — grab one that's unblocked, assign yourself, branch, PR.
- **X5 (PEAK FINANCE-filter, plan Tasks 1-2) is a hard gate — it must merge before any SHOP-JE wiring task.**
