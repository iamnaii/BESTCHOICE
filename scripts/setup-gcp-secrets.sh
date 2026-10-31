#!/bin/bash
set -euo pipefail

# =============================================================================
# GCP Secret Manager Setup + Cloud Run Environment Mapping
# Usage: ./scripts/setup-gcp-secrets.sh <GCP_PROJECT_ID>
# =============================================================================

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <GCP_PROJECT_ID>"
  echo "Example: $0 bestchoice-prod"
  exit 1
fi

GCP_PROJECT_ID="$1"
echo "Setting up Secret Manager for project: ${GCP_PROJECT_ID}"
echo ""

# --- Secrets (store in Secret Manager) ---
SECRETS=(
  "JWT_SECRET"
  "JWT_REFRESH_SECRET"
  "ENCRYPTION_KEY"
  "DATABASE_URL"
  "ANTHROPIC_API_KEY"
  "S3_ACCESS_KEY"
  "S3_SECRET_KEY"
  "LINE_CHANNEL_ACCESS_TOKEN"
  "LINE_CHANNEL_SECRET"
  "SMS_API_KEY"
  "SMS_API_SECRET"
  "SMTP_PASS"
  "PAYSOLUTIONS_SECRET_KEY"
  "PAYSOLUTIONS_WEBHOOK_SECRET"
)

# Create secrets (idempotent — skip if already exists)
for secret in "${SECRETS[@]}"; do
  if gcloud secrets describe "$secret" --project="$GCP_PROJECT_ID" &>/dev/null; then
    echo "  [exists] $secret"
  else
    echo -n "PLACEHOLDER" | gcloud secrets create "$secret" \
      --project="$GCP_PROJECT_ID" \
      --replication-policy="automatic" \
      --data-file=-
    echo "  [created] $secret"
  fi
done

# --- INTEGRATION_ENCRYPTION_KEY (Integration Hub credentials at rest) ---
# Not in SECRETS: .github/workflows/deploy-gcp.yml pins it to version 1
# (INTEGRATION_ENCRYPTION_KEY:1, not :latest), so version 1 must BE the real key —
# a PLACEHOLDER v1 would be "malformed" = no key, and later versions are never read.
# Format: exactly 64 hex chars (openssl rand -hex 32); anything else counts as no key.
# The value is generated straight into Secret Manager and never printed.
# Runbook (post-deploy check, rotation): docs/runbooks/2026-10-31-integration-encryption-key.md
INTEGRATION_KEY_SECRET="INTEGRATION_ENCRYPTION_KEY"
if gcloud secrets describe "$INTEGRATION_KEY_SECRET" --project="$GCP_PROJECT_ID" &>/dev/null; then
  # Metadata only — never `versions access` here.
  V1_STATE=$(gcloud secrets versions describe 1 --secret="$INTEGRATION_KEY_SECRET" \
    --project="$GCP_PROJECT_ID" --format='value(state)' 2>/dev/null || true)
  if [ "$V1_STATE" = "ENABLED" ]; then
    echo "  [exists] $INTEGRATION_KEY_SECRET (left untouched — version 1 ENABLED, pinned by deploy-gcp.yml)"
  else
    echo "  [WARN] $INTEGRATION_KEY_SECRET exists but version 1 is ${V1_STATE:-missing} —" \
      "deploy-gcp.yml pins :1; see docs/runbooks/2026-10-31-integration-encryption-key.md"
  fi
else
  command -v openssl >/dev/null || {
    echo "openssl not found — needed to generate $INTEGRATION_KEY_SECRET" >&2
    exit 1
  }
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets create "$INTEGRATION_KEY_SECRET" \
    --project="$GCP_PROJECT_ID" \
    --replication-policy="automatic" \
    --data-file=-
  echo "  [created] $INTEGRATION_KEY_SECRET (version 1 = random 64-hex key, value not printed)"
fi

echo ""
echo "============================================"
echo "NEXT STEPS"
echo "============================================"
echo ""
echo "1. Update each secret with the real value:"
echo ""
for secret in "${SECRETS[@]}"; do
  echo "   echo -n 'REAL_VALUE' | gcloud secrets versions add $secret --project=$GCP_PROJECT_ID --data-file=-"
done
echo ""
echo "2. Generate new JWT/Encryption secrets:"
echo "   openssl rand -base64 32   # JWT_SECRET"
echo "   openssl rand -base64 32   # JWT_REFRESH_SECRET"
echo "   openssl rand -hex 16      # ENCRYPTION_KEY"
echo "   ($INTEGRATION_KEY_SECRET was generated above as version 1 — do NOT add versions or"
echo "    print it; rotating = full plan in docs/runbooks/2026-10-31-integration-encryption-key.md)"
echo ""
echo "3. Deploy Cloud Run with secrets + env vars:"
echo ""
cat <<'DEPLOY'
gcloud run deploy bestchoice-api \
  --project=PROJECT_ID \
  --region=asia-southeast1 \
  --image=REGION-docker.pkg.dev/PROJECT_ID/bestchoice/api:latest \
  --platform=managed \
  --port=3000 \
  --min-instances=1 \
  --max-instances=10 \
  --memory=512Mi \
  --cpu=1 \
  --set-secrets="\
JWT_SECRET=JWT_SECRET:latest,\
JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:latest,\
ENCRYPTION_KEY=ENCRYPTION_KEY:latest,\
INTEGRATION_ENCRYPTION_KEY=INTEGRATION_ENCRYPTION_KEY:1,\
DATABASE_URL=DATABASE_URL:latest,\
ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,\
S3_ACCESS_KEY=S3_ACCESS_KEY:latest,\
S3_SECRET_KEY=S3_SECRET_KEY:latest,\
LINE_CHANNEL_ACCESS_TOKEN=LINE_CHANNEL_ACCESS_TOKEN:latest,\
LINE_CHANNEL_SECRET=LINE_CHANNEL_SECRET:latest,\
SMS_API_KEY=SMS_API_KEY:latest,\
SMS_API_SECRET=SMS_API_SECRET:latest,\
SMTP_PASS=SMTP_PASS:latest,\
PAYSOLUTIONS_SECRET_KEY=PAYSOLUTIONS_SECRET_KEY:latest,\
PAYSOLUTIONS_WEBHOOK_SECRET=PAYSOLUTIONS_WEBHOOK_SECRET:latest" \
  --set-env-vars="\
NODE_ENV=production,\
PORT=3000,\
SKIP_MIGRATION=true,\
FRONTEND_URL=https://bestchoice-prod.web.app,\
JWT_EXPIRATION=15m,\
JWT_REFRESH_EXPIRATION=7d,\
COOKIE_CROSS_DOMAIN=true,\
DATABASE_CONNECTION_LIMIT=10,\
DATABASE_POOL_TIMEOUT=15,\
S3_ENDPOINT=,\
S3_BUCKET=,\
S3_REGION=,\
SMTP_HOST=,\
SMTP_PORT=587,\
SMTP_USER=,\
SMTP_FROM=BESTCHOICE <noreply@bestchoice.com>,\
SMS_SENDER=BESTCHOICE,\
PROMPTPAY_ID=,\
PROMPTPAY_ACCOUNT_NAME=,\
PAYSOLUTIONS_MERCHANT_ID=,\
PAYSOLUTIONS_API_URL=https://api.paysolutions.asia,\
PAYMENT_LINK_BASE_URL=https://bestchoice-prod.web.app" \
  --add-cloudsql-instances=PROJECT_ID:asia-southeast1:bestchoice-db \
  --allow-unauthenticated
DEPLOY

echo ""
echo "Replace PROJECT_ID, REGION, and placeholder values with actual values."
echo "Done!"
