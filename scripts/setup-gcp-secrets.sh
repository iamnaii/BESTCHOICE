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
