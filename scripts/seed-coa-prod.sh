#!/usr/bin/env bash
#
# One-shot script to seed the chart_of_accounts table on production.
#
# Prerequisites:
#   1. PR #414 has been merged to main
#   2. CI deploy completed successfully (migrate-db + deploy-api jobs green)
#   3. gcloud is authenticated as a user/SA with Cloud Run + Secret Manager access
#   4. The add_chart_of_accounts migration has been applied
#      (verify: GET https://api.bestchoicephone.app/api/chart-of-accounts → 200 [])
#
# What it does:
#   - Discovers the current API image + DB config from the existing
#     bestchoice-migrate Cloud Run Job (so we always seed against the
#     same image that's running in prod)
#   - Creates (or updates) a one-shot Cloud Run Job: bestchoice-seed-coa
#   - Executes it once and waits for completion
#   - Prints the result; you can re-run safely (upsert by code)
#
# Optional cleanup after success:
#   gcloud run jobs delete bestchoice-seed-coa --region=asia-southeast1 --quiet
#
set -euo pipefail

REGION="${REGION:-asia-southeast1}"
PROJECT="${PROJECT:-bestchoice-prod}"
SOURCE_JOB="bestchoice-migrate"
SEED_JOB="bestchoice-seed-coa"

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

echo "→ Creating/updating ${SEED_JOB}..."
gcloud run jobs update "${SEED_JOB}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --set-cloudsql-instances="${CLOUDSQL}" \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --command=npx \
  --args=tsx,apps/api/prisma/seed-chart-of-accounts-only.ts \
  --max-retries=1 \
  --task-timeout=300s \
  2>/dev/null || \
gcloud run jobs create "${SEED_JOB}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --set-cloudsql-instances="${CLOUDSQL}" \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --command=npx \
  --args=tsx,apps/api/prisma/seed-chart-of-accounts-only.ts \
  --max-retries=1 \
  --task-timeout=300s

echo "→ Executing ${SEED_JOB} (waiting for completion)..."
gcloud run jobs execute "${SEED_JOB}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --wait

echo ""
echo "✅ Done. Verify with:"
echo "    curl -s https://api.bestchoicephone.app/api/chart-of-accounts -H 'Authorization: Bearer <TOKEN>' | jq 'length'"
echo ""
echo "To clean up the one-shot job:"
echo "    gcloud run jobs delete ${SEED_JOB} --region=${REGION} --project=${PROJECT} --quiet"
