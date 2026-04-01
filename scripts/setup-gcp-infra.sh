#!/bin/bash
set -euo pipefail

# =============================================================================
# GCP Infrastructure Setup — One-time setup for BESTCHOICE on GCP
# Prerequisites: gcloud CLI, firebase CLI, gh CLI
# Usage: ./scripts/setup-gcp-infra.sh <GCP_PROJECT_ID> [REGION]
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# --- Args ---
if [ -z "${1:-}" ]; then
  echo "Usage: $0 <GCP_PROJECT_ID> [REGION]"
  echo "Example: $0 bestchoice-prod asia-southeast1"
  exit 1
fi

PROJECT_ID="$1"
REGION="${2:-asia-southeast1}"
DB_INSTANCE="bestchoice-db"
DB_NAME="bestchoice"
DB_USER="bestchoice"
REPO_NAME="bestchoice"
SERVICE_ACCOUNT="bestchoice-cicd"
SA_EMAIL="${SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com"
GITHUB_REPO="iamnaii/BESTCHOICE"

echo ""
echo "============================================"
echo "  BESTCHOICE — GCP Infrastructure Setup"
echo "============================================"
echo "  Project:  ${PROJECT_ID}"
echo "  Region:   ${REGION}"
echo "============================================"
echo ""

# --- Check prerequisites ---
info "Checking prerequisites..."
for cmd in gcloud firebase gh openssl; do
  if ! command -v "$cmd" &>/dev/null; then
    error "$cmd is not installed. Please install it first."
    exit 1
  fi
done
ok "All CLI tools found"

# --- Step 1: Set project + enable APIs ---
info "Step 1/8: Setting project and enabling APIs..."
gcloud config set project "$PROJECT_ID" 2>/dev/null

APIS=(
  "run.googleapis.com"
  "artifactregistry.googleapis.com"
  "secretmanager.googleapis.com"
  "sqladmin.googleapis.com"
  "cloudbuild.googleapis.com"
  "iam.googleapis.com"
  "firebase.googleapis.com"
  "firebasehosting.googleapis.com"
)
gcloud services enable "${APIS[@]}" --project="$PROJECT_ID"
ok "APIs enabled"

# --- Step 2: Artifact Registry ---
info "Step 2/8: Creating Artifact Registry repository..."
if gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  ok "Artifact Registry repo already exists"
else
  gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --project="$PROJECT_ID" \
    --description="BESTCHOICE Docker images"
  ok "Artifact Registry repo created"
fi

# --- Step 3: Cloud SQL ---
info "Step 3/8: Creating Cloud SQL instance (this may take 5-10 minutes)..."
if gcloud sql instances describe "$DB_INSTANCE" --project="$PROJECT_ID" &>/dev/null; then
  ok "Cloud SQL instance already exists"
else
  gcloud sql instances create "$DB_INSTANCE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --database-version=POSTGRES_16 \
    --tier=db-f1-micro \
    --storage-size=10GB \
    --storage-auto-increase \
    --backup-start-time=03:00 \
    --availability-type=zonal
  ok "Cloud SQL instance created"
fi

# Create database
if gcloud sql databases describe "$DB_NAME" --instance="$DB_INSTANCE" --project="$PROJECT_ID" &>/dev/null; then
  ok "Database '$DB_NAME' already exists"
else
  gcloud sql databases create "$DB_NAME" --instance="$DB_INSTANCE" --project="$PROJECT_ID"
  ok "Database '$DB_NAME' created"
fi

# Create user + generate password
DB_PASSWORD=$(openssl rand -base64 24)
if gcloud sql users list --instance="$DB_INSTANCE" --project="$PROJECT_ID" --format="value(name)" | grep -q "^${DB_USER}$"; then
  warn "User '$DB_USER' already exists — password NOT changed. Reset manually if needed."
else
  gcloud sql users create "$DB_USER" \
    --instance="$DB_INSTANCE" \
    --project="$PROJECT_ID" \
    --password="$DB_PASSWORD"
  ok "User '$DB_USER' created"
  echo ""
  warn "SAVE THIS — Database password: ${DB_PASSWORD}"
  echo ""
fi

CLOUD_SQL_CONNECTION="${PROJECT_ID}:${REGION}:${DB_INSTANCE}"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${CLOUD_SQL_CONNECTION}"

# --- Step 4: Service Account for CI/CD ---
info "Step 4/8: Creating CI/CD service account..."
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" &>/dev/null; then
  ok "Service account already exists"
else
  gcloud iam service-accounts create "$SERVICE_ACCOUNT" \
    --project="$PROJECT_ID" \
    --display-name="BESTCHOICE CI/CD"
  ok "Service account created"
fi

# Grant required roles
ROLES=(
  "roles/run.admin"
  "roles/artifactregistry.writer"
  "roles/secretmanager.secretAccessor"
  "roles/cloudsql.client"
  "roles/iam.serviceAccountUser"
  "roles/storage.admin"
)
for role in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$role" \
    --quiet &>/dev/null
done
ok "IAM roles granted"

# Generate SA key
SA_KEY_FILE="/tmp/bestchoice-sa-key.json"
gcloud iam service-accounts keys create "$SA_KEY_FILE" \
  --iam-account="$SA_EMAIL" \
  --project="$PROJECT_ID"
ok "Service account key saved to $SA_KEY_FILE"

# --- Step 5: Secret Manager ---
info "Step 5/8: Setting up Secret Manager..."

# Generate fresh secrets
NEW_JWT_SECRET=$(openssl rand -base64 32)
NEW_JWT_REFRESH_SECRET=$(openssl rand -base64 32)
NEW_ENCRYPTION_KEY=$(openssl rand -hex 16)

declare -A SECRET_VALUES=(
  ["JWT_SECRET"]="$NEW_JWT_SECRET"
  ["JWT_REFRESH_SECRET"]="$NEW_JWT_REFRESH_SECRET"
  ["ENCRYPTION_KEY"]="$NEW_ENCRYPTION_KEY"
  ["DATABASE_URL"]="$DATABASE_URL"
)

# Critical secrets with generated values
for secret in JWT_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY DATABASE_URL; do
  if gcloud secrets describe "$secret" --project="$PROJECT_ID" &>/dev/null; then
    echo -n "${SECRET_VALUES[$secret]}" | gcloud secrets versions add "$secret" \
      --project="$PROJECT_ID" --data-file=-
    ok "$secret updated with new value"
  else
    echo -n "${SECRET_VALUES[$secret]}" | gcloud secrets create "$secret" \
      --project="$PROJECT_ID" --replication-policy="automatic" --data-file=-
    ok "$secret created"
  fi
done

# Integration secrets (placeholder — user fills in later)
INTEGRATION_SECRETS=(
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
for secret in "${INTEGRATION_SECRETS[@]}"; do
  if gcloud secrets describe "$secret" --project="$PROJECT_ID" &>/dev/null; then
    ok "$secret already exists"
  else
    echo -n "PLACEHOLDER" | gcloud secrets create "$secret" \
      --project="$PROJECT_ID" --replication-policy="automatic" --data-file=-
    ok "$secret created (placeholder — update with real value)"
  fi
done

# Grant Cloud Run access to secrets
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet &>/dev/null
ok "Cloud Run service account can access secrets"

# --- Step 6: Firebase Hosting ---
info "Step 6/8: Setting up Firebase Hosting..."
if firebase projects:list 2>/dev/null | grep -q "$PROJECT_ID"; then
  ok "Firebase already linked to project"
else
  firebase projects:addfirebase "$PROJECT_ID" 2>/dev/null || warn "Firebase may need manual setup — run: firebase projects:addfirebase $PROJECT_ID"
fi

# Generate Firebase CI token (service account key)
# The SA key can be used for firebase deploy via FIREBASE_SERVICE_ACCOUNT
ok "Firebase will use the SA key for CI deploy"

# --- Step 7: GitHub Secrets ---
info "Step 7/8: Setting GitHub repository secrets..."

GCP_SA_KEY=$(cat "$SA_KEY_FILE")
API_URL="https://bestchoice-api-$(echo $PROJECT_ID | tr '[:upper:]' '[:lower:]' | head -c 10)-${REGION}.a.run.app"

gh secret set GCP_PROJECT_ID --repo="$GITHUB_REPO" --body="$PROJECT_ID"
gh secret set GCP_REGION --repo="$GITHUB_REPO" --body="$REGION"
gh secret set GCP_SA_KEY --repo="$GITHUB_REPO" --body="$GCP_SA_KEY"
gh secret set CLOUD_SQL_CONNECTION_NAME --repo="$GITHUB_REPO" --body="$CLOUD_SQL_CONNECTION"
gh secret set FIREBASE_SERVICE_ACCOUNT --repo="$GITHUB_REPO" --body="$GCP_SA_KEY"
gh secret set DATABASE_URL --repo="$GITHUB_REPO" --body="$DATABASE_URL"

ok "GitHub secrets set"

# --- Step 8: Cleanup ---
info "Step 8/8: Cleaning up..."
rm -f "$SA_KEY_FILE"
ok "Removed temporary SA key file"

# --- Summary ---
echo ""
echo "============================================"
echo "  Setup Complete!"
echo "============================================"
echo ""
echo "  Cloud SQL:    ${CLOUD_SQL_CONNECTION}"
echo "  DB User:      ${DB_USER}"
echo "  Registry:     ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}"
echo "  SA:           ${SA_EMAIL}"
echo ""
echo "  Generated secrets (saved to Secret Manager):"
echo "    JWT_SECRET:         ${NEW_JWT_SECRET}"
echo "    JWT_REFRESH_SECRET: ${NEW_JWT_REFRESH_SECRET}"
echo "    ENCRYPTION_KEY:     ${NEW_ENCRYPTION_KEY}"
echo ""
warn "SAVE the secrets above! They won't be shown again."
echo ""
echo "  Next steps:"
echo "    1. Update placeholder secrets (ANTHROPIC_API_KEY, LINE_*, SMS_*, etc.):"
echo "       echo -n 'REAL_VALUE' | gcloud secrets versions add SECRET_NAME --project=$PROJECT_ID --data-file=-"
echo ""
echo "    2. Update FRONTEND_URL + API_URL after first deploy:"
echo "       gh secret set FRONTEND_URL --repo=$GITHUB_REPO --body='https://YOUR_DOMAIN'"
echo "       gh secret set API_URL --repo=$GITHUB_REPO --body='https://YOUR_API_URL'"
echo ""
echo "    3. Merge the PR and push to main to trigger deploy!"
echo ""
echo "    4. [CRITICAL] Scrub old secrets from git history:"
echo "       git filter-repo --path .do/app.yaml --invert-paths"
echo "       git push --force --all  # Coordinate with team first!"
echo ""
