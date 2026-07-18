#!/usr/bin/env bash
#
# One-shot: seed แบบประเมินรับซื้อ/เทิร์น (buyback questions) บน production.
# Pattern mirrors scripts/seed-coa-prod.sh — image + DATABASE_URL secret + Cloud SQL
# ถูก inherit จาก bestchoice-migrate job; secret ไม่ออกจาก GCP
#
# Prerequisites:
#   - PR ที่มี apps/api/prisma/seed-sell-questions-only.ts merged + deploy เขียวแล้ว
#   - gcloud authenticated (Cloud Run admin + Secret Manager access)
#
# Usage:   bash scripts/seed-sell-prod.sh
# Cleanup: gcloud run jobs delete bestchoice-seed-sell --region=asia-southeast1 --quiet
#
set -euo pipefail

REGION="${REGION:-asia-southeast1}"
PROJECT="${PROJECT:-bestchoice-prod}"
SOURCE_JOB="bestchoice-migrate"
SEED_JOB="bestchoice-seed-sell"
SEED_FILE="${SEED_FILE:-apps/api/prisma/seed-sell-questions-only.ts}"

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
  --args=tsx,${SEED_FILE} \
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
  --args=tsx,${SEED_FILE} \
  --max-retries=1 \
  --task-timeout=300s

echo "→ Executing ${SEED_JOB} (waiting for completion)..."
gcloud run jobs execute "${SEED_JOB}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --wait

echo ""
echo "✅ Done. Verify:"
echo "    curl -s https://bestchoicephone-shop.web.app/api/shop/buyback/questions | head -c 300"
