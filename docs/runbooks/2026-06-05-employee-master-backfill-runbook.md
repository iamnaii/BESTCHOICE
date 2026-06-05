# Runbook — Employee Master backfill (prod, manual)

_2026-06-05. Run the two PR-D backfill CLIs in production via Cloud Run Job. Both are **dry-run by default + idempotent** — safe to re-run. Run **CLI A first**, then **CLI B**._

## Why / order
- **CLI A `backfill:employee-profiles`** provisions an `EmployeeProfile` for every active non-system `User`. **Run this first** — the new payroll picker (`/employees/pickable`) only lists users *with* a profile, and the picker has no free-text fallback, so until profiles exist, nobody can be picked when creating payroll.
- **CLI B `backfill:payroll-user-fk`** links *historical* `PayrollLine` rows to a `User` (tier-1 taxId auto, tier-2 name → manual review + audited). Improves reporting on old payroll; does **not** block creating new payroll.

## Prerequisites
- **PR-D (#1154) deploy must be COMPLETE** — its image is the one containing the CLIs (`dist/src/cli/backfill-*.cli.js`). Confirm the `:latest` API image is from the #1154 build before running. Check: `gh run list --branch main --limit 3` → the PR-D "Deploy to GCP" run is `success`.
- `gcloud` authenticated to the prod project; you can create/execute Cloud Run Jobs.
- Fill these in (mirror the values from `.github/workflows/deploy-gcp.yml` secrets):

```bash
export PROJECT_ID=<GCP_PROJECT_ID e.g. bestchoice-prod>
export REGION=asia-southeast1
export API_IMAGE=asia-southeast1-docker.pkg.dev/$PROJECT_ID/bestchoice/api:latest
export CLOUD_SQL=<CLOUD_SQL_CONNECTION_NAME>          # e.g. bestchoice-prod:asia-southeast1:bestchoice
export PROD_DB_NAME=bestchoice_prod                   # must equal current_database() — confirm
```
> The CLIs read all flags from ENV (no argv needed in a Job): `EXPECTED_DB_NAME`, `APPLY`, `ALLOW_PROD_BACKFILL`, `TIER2`, `BACKFILL_ACTOR_USER_ID`. They connect via `DATABASE_URL` (from Secret Manager, same as the migrate job). The DB-name guard (`EXPECTED_DB_NAME` must equal `current_database()`) + a 5s cooldown protect against wrong-DB / accidental applies.

## Reading output
Each execution prints a full summary (and, for CLI B, the **entire** `matched-by-name.csv`) to stdout → **Cloud Logging**. After `... execute --wait`, view logs in the Console (Cloud Run → Jobs → the job → Executions → Logs) or:
```bash
gcloud run jobs executions list --job=<job> --project=$PROJECT_ID --region=$REGION --limit=1
gcloud beta run jobs executions logs read <execution-id> --project=$PROJECT_ID --region=$REGION
```

---

## CLI A — `backfill:employee-profiles`

### A0. Create the job (once) — dry-run env
```bash
gcloud run jobs create bestchoice-backfill-emp-profiles \
  --project=$PROJECT_ID --region=$REGION \
  --image=$API_IMAGE \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --set-cloudsql-instances=$CLOUD_SQL \
  --command=node \
  --args=apps/api/dist/src/cli/backfill-employee-profiles.cli.js \
  --set-env-vars=EXPECTED_DB_NAME=$PROD_DB_NAME \
  --max-retries=0 --task-timeout=600s
```
(If it already exists, swap `create` → `update`.)

### A1. DRY-RUN → execute → READ LOGS
```bash
gcloud run jobs execute bestchoice-backfill-emp-profiles --project=$PROJECT_ID --region=$REGION --wait
```
Confirm the summary: `eligible users`, `already have a profile`, `to provision`. Sanity-check the "to provision" count vs your headcount.

### A2. APPLY → execute → READ LOGS
```bash
gcloud run jobs update bestchoice-backfill-emp-profiles \
  --project=$PROJECT_ID --region=$REGION \
  --update-env-vars=APPLY=true,ALLOW_PROD_BACKFILL=YES_I_AM_SURE
gcloud run jobs execute bestchoice-backfill-emp-profiles --project=$PROJECT_ID --region=$REGION --wait
```
Confirm `Done. created=N`. Re-running is safe (already-provisioned users are skipped → `created=0`).

---

## CLI B — `backfill:payroll-user-fk` (run after CLI A)

### B0. Create the job (once) — dry-run env
```bash
gcloud run jobs create bestchoice-backfill-payroll-fk \
  --project=$PROJECT_ID --region=$REGION \
  --image=$API_IMAGE \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --set-cloudsql-instances=$CLOUD_SQL \
  --command=node \
  --args=apps/api/dist/src/cli/backfill-payroll-user-fk.cli.js \
  --set-env-vars=EXPECTED_DB_NAME=$PROD_DB_NAME \
  --max-retries=0 --task-timeout=600s
```

### B1. DRY-RUN → execute → READ LOGS
```bash
gcloud run jobs execute bestchoice-backfill-payroll-fk --project=$PROJECT_ID --region=$REGION --wait
```
Review the classification: `tier-1 (taxId, auto)`, `tier-2 (name, manual review)`, `tier-2 ambiguous`, `unmatched`. The **full `matched-by-name.csv`** is dumped between `BEGIN/END matched-by-name.csv` markers in the logs — **review every tier-2 (name-matched) row** before applying tier-2.

### B2. APPLY tier-1 (auto, confident taxId match) → execute → READ LOGS
```bash
gcloud run jobs update bestchoice-backfill-payroll-fk \
  --project=$PROJECT_ID --region=$REGION \
  --update-env-vars=APPLY=true,ALLOW_PROD_BACKFILL=YES_I_AM_SURE
gcloud run jobs execute bestchoice-backfill-payroll-fk --project=$PROJECT_ID --region=$REGION --wait
```
Confirm `tier-1 linked: N`. (tier-2 is SKIPPED here — it needs `--tier=2`.)

### B3. (Only after reviewing the CSV) APPLY tier-2 (name matches, audited)
Pick a real OWNER/admin user UUID as the audit actor:
```bash
export ACTOR_UUID=<an existing user uuid — the person running this>
gcloud run jobs update bestchoice-backfill-payroll-fk \
  --project=$PROJECT_ID --region=$REGION \
  --update-env-vars=APPLY=true,ALLOW_PROD_BACKFILL=YES_I_AM_SURE,TIER2=true,BACKFILL_ACTOR_USER_ID=$ACTOR_UUID
gcloud run jobs execute bestchoice-backfill-payroll-fk --project=$PROJECT_ID --region=$REGION --wait
```
Confirm `tier-2 linked: N  (audit rows written this run: N)` with **no `WARN`** (a WARN means linked ≠ audit-written → investigate). Every tier-2 link writes a `PAYROLL_FK_MATCHED_BY_NAME` audit row (Merkle-chained) for traceability/rollback.

`tier-2-ambiguous` and `unmatched` rows are **left null** by design (legacy free-text rows keep working). Resolve ambiguous ones by hand if desired.

---

## Notes / safety
- **Idempotent:** every CLI only touches rows that still need it (`updateMany WHERE userId IS NULL`, profile set-difference). Re-runs are no-ops on already-done rows.
- **Snapshots never change:** CLI B only fills `userId`; `employeeName`/`employeeTaxId` (the historical record) are never written.
- **`User.nationalId` is not DB-unique:** if two active users share a national ID (data-entry error), CLI B safely demotes that row to name-matching (never a wrong tier-1 auto-link) — eyeball the dry-run tier-1 count.
- **Cleanup (optional):** `gcloud run jobs delete bestchoice-backfill-emp-profiles` / `...-payroll-fk` after you're done.
- Plan reference: `docs/superpowers/plans/2026-06-04-employee-master-prD-backfill.md`.
