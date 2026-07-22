#!/usr/bin/env bash
#
# One-shot: seed สินค้า DEMO ของเว็บ shop บน production (iPhone 7 เครื่อง / 6 รุ่น + รูป+ราคา).
# Pattern mirrors scripts/seed-sell-prod.sh — image + DATABASE_URL secret + Cloud SQL
# ถูก inherit จาก bestchoice-migrate job; secret ไม่ออกจาก GCP
#
# Prerequisites:
#   - PR ที่มี apps/api/prisma/seed-demo-products.ts merged + deploy เขียวแล้ว
#   - gcloud authenticated (Cloud Run admin + Secret Manager access)
#
# Usage:   bash scripts/seed-demo-products-prod.sh           # ลงสินค้า demo
#          CLEAN=1 bash scripts/seed-demo-products-prod.sh   # ลบสินค้า demo ทั้งชุด (ก่อน launch จริง)
# Cleanup: gcloud run jobs delete bestchoice-seed-demo --region=asia-southeast1 --quiet
#
set -euo pipefail

REGION="${REGION:-asia-southeast1}"
PROJECT="${PROJECT:-bestchoice-prod}"
SOURCE_JOB="bestchoice-migrate"
SEED_JOB="bestchoice-seed-demo"
SEED_FILE="${SEED_FILE:-apps/api/prisma/seed-demo-products.ts}"

ARGS="tsx,${SEED_FILE}"
if [[ "${CLEAN:-0}" == "1" ]]; then
  ARGS="${ARGS},--clean"
  echo "→ CLEAN mode: จะ soft-delete สินค้า demo ทั้งชุด"
fi

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
  --args="${ARGS}" \
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
  --args="${ARGS}" \
  --max-retries=1 \
  --task-timeout=300s

echo "→ Executing ${SEED_JOB} (waiting for completion)..."
gcloud run jobs execute "${SEED_JOB}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --wait

echo ""
echo "✅ Done. Verify:"
echo "    curl -s -H 'X-Requested-With: XMLHttpRequest' 'https://bestchoicephone-shop.web.app/api/shop/products?limit=10' | head -c 400"
