#!/usr/bin/env bash
#
# Asset Module post-merge prod verification + backfill (PRs #845/#846/#847, 2026-05-15).
#
# Runs 2 one-shot Cloud Run Jobs against bestchoice-prod, inheriting DATABASE_URL
# secret + Cloud SQL connection from the existing `bestchoice-migrate` job:
#
#   1. bestchoice-verify-asset-orphans → READ-ONLY orphan check (closes Sign-off #3)
#   2. bestchoice-backfill-permission-config → WRITES permission_config from legacy approverId (closes PR #846 I2)
#
# Pattern mirrors scripts/seed-coa-prod.sh.
#
# Prerequisites:
#   - gcloud authenticated as a user/SA with Cloud Run admin + Secret Manager access
#   - PRs #845/#846/#847 already merged + deployed (image tag = current main HEAD)
#
# Usage:
#   bash scripts/verify-and-backfill-prod.sh
#
# Optional cleanup after success:
#   gcloud run jobs delete bestchoice-verify-asset-orphans --region=asia-southeast1 --quiet
#   gcloud run jobs delete bestchoice-backfill-permission-config --region=asia-southeast1 --quiet
#
set -euo pipefail

REGION="${REGION:-asia-southeast1}"
PROJECT="${PROJECT:-bestchoice-prod}"
SOURCE_JOB="bestchoice-migrate"

# Upsert a Cloud Run Job — try update, fall back to create on first run.
upsert_job() {
  local job_name="$1"
  local job_args="$2"
  gcloud run jobs update "${job_name}" \
    --project="${PROJECT}" \
    --region="${REGION}" \
    --image="${IMAGE}" \
    --set-cloudsql-instances="${CLOUDSQL}" \
    --set-secrets=DATABASE_URL=DATABASE_URL:latest \
    --command=npx \
    --args="${job_args}" \
    --max-retries=1 \
    --task-timeout=300s \
    2>/dev/null && return 0
  gcloud run jobs create "${job_name}" \
    --project="${PROJECT}" \
    --region="${REGION}" \
    --image="${IMAGE}" \
    --set-cloudsql-instances="${CLOUDSQL}" \
    --set-secrets=DATABASE_URL=DATABASE_URL:latest \
    --command=npx \
    --args="${job_args}" \
    --max-retries=1 \
    --task-timeout=300s
}

echo "→ Discovering image + Cloud SQL config from ${SOURCE_JOB}..."
IMAGE=$(gcloud run jobs describe "${SOURCE_JOB}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format='value(spec.template.spec.template.spec.containers[0].image)')

CLOUDSQL=$(gcloud run jobs describe "${SOURCE_JOB}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format='value(spec.template.metadata.annotations["run.googleapis.com/cloudsql-instances"])')

if [[ -z "${IMAGE}" || -z "${CLOUDSQL}" ]]; then
  echo "✗ Failed to discover image or Cloud SQL connection from ${SOURCE_JOB}" >&2
  exit 1
fi

echo "  image:     ${IMAGE}"
echo "  cloud sql: ${CLOUDSQL}"
echo ""

# ─────────────────────────────────────────────────────────────
# Step 1 — READ-ONLY verify (closes Sign-off Criteria #3)
# ─────────────────────────────────────────────────────────────

VERIFY_JOB="bestchoice-verify-asset-orphans"
echo "→ [1/2] Creating/updating ${VERIFY_JOB}..."
upsert_job "${VERIFY_JOB}" "tsx,apps/api/scripts/verify-asset-orphans.ts"

echo "→ Executing ${VERIFY_JOB} (waiting for completion)..."
gcloud run jobs execute "${VERIFY_JOB}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --wait

# Fetch the execution logs (last 50 lines) so user sees the verdict
EXEC_NAME=$(gcloud run jobs executions list \
  --job="${VERIFY_JOB}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --limit=1 \
  --format='value(name)')

echo ""
echo "→ Execution logs from ${EXEC_NAME}:"
gcloud beta run jobs executions logs read "${EXEC_NAME}" \
  --project="${PROJECT}" \
  --region="${REGION}" 2>/dev/null \
  || gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=${VERIFY_JOB}" \
       --project="${PROJECT}" \
       --limit=50 \
       --format='value(textPayload)' | tac

echo ""
echo "✅ [1/2] Verify done. Expected JSON output above with 'verdict: CLEAN' and 'orphans: []'."
echo "    If orphans > 0, STOP and read docs/superpowers/specs/2026-05-13-asset-bug-report-v2-fix-design.md §5.B.2"
echo ""

# ─────────────────────────────────────────────────────────────
# Step 2 — WRITES backfill (closes PR #846 I2)
# ─────────────────────────────────────────────────────────────

read -p "→ Proceed with backfill (Step 2)? [y/N] " -n 1 -r
echo ""
if [[ ! ${REPLY} =~ ^[Yy]$ ]]; then
  echo "Skipping backfill. Re-run script to continue."
  exit 0
fi

BACKFILL_JOB="bestchoice-backfill-permission-config"
SQL_FILE="apps/api/prisma/migrations-manual/2026-05-15-backfill-fixed-asset-permission-config-from-approver.sql"

# Sanity check — file must exist locally (matches the deployed image's checkout).
if [[ ! -f "${SQL_FILE}" ]]; then
  echo "✗ SQL file not found locally: ${SQL_FILE}" >&2
  echo "  The Cloud Run job runs from the deployed image, but a missing local file means it likely isn't committed/deployed either." >&2
  exit 1
fi

echo ""
echo "→ [2/2] Creating/updating ${BACKFILL_JOB}..."
upsert_job "${BACKFILL_JOB}" "prisma,db,execute,--file=${SQL_FILE},--schema=apps/api/prisma/schema.prisma"

echo "→ Executing ${BACKFILL_JOB} (waiting for completion)..."
gcloud run jobs execute "${BACKFILL_JOB}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --wait

echo ""
echo "✅ [2/2] Backfill done."
echo ""
echo "Verification (re-run on owner request):"
echo "    cat <<'SQL' | gcloud sql connect bestchoice-db --user=postgres --database=bestchoice --project=${PROJECT} --quiet"
echo "    SELECT COUNT(*) FROM fixed_assets WHERE approver_id IS NOT NULL AND permission_config = '[]'::jsonb;"
echo "    SQL"
echo "    -- Expected: 0 rows"
echo ""
echo "✅ All done. Sign-off Criteria #3 + PR #846 I2 closed. Take screenshots of this output for accountant."
echo ""
echo "Optional cleanup:"
echo "    gcloud run jobs delete ${VERIFY_JOB} --project=${PROJECT} --region=${REGION} --quiet"
echo "    gcloud run jobs delete ${BACKFILL_JOB} --project=${PROJECT} --region=${REGION} --quiet"
