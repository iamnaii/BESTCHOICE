#!/bin/bash
# Database backup script — encrypted with AES-256
# Usage: ./scripts/backup.sh
# Cron: 0 2 * * * /opt/installment-system/scripts/backup.sh
#
# Required environment:
#   BACKUP_ENCRYPTION_KEY  Passphrase for openssl AES-256. MUST be set in
#                          production or the script refuses to run.
#                          Recommended: 32+ random bytes from `openssl rand -hex 32`,
#                          stored in GCP Secret Manager / Vault, NEVER in git.
#
# Optional environment:
#   BACKUP_DIR             default /opt/backups/installment
#   RETENTION_DAYS         default 30
#   DB_USER                default installment
#   DB_NAME                default installment_db
#
# Restore (manual):
#   openssl enc -d -aes-256-cbc -pbkdf2 -in installment_YYYYMMDD_HHMMSS.sql.gz.enc \
#     -pass env:BACKUP_ENCRYPTION_KEY | gunzip | psql -U installment installment_db
#
# Why encryption matters: backups previously sat as plain gzip on the
# same disk as the DB. Disk theft, ransomware, or shared-host backup
# misconfiguration would expose the entire database (PII, passwords,
# financial records). PDPA Section 37 requires "appropriate security
# measures" and unencrypted backups don't qualify.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups/installment}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/installment_${TIMESTAMP}.sql.gz.enc"

# Refuse to run without an encryption key — fail loud, not silently
if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  echo "[$(date)] ERROR: BACKUP_ENCRYPTION_KEY is not set — refusing to write unencrypted backup" >&2
  exit 1
fi

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting database backup..."

# Dump → gzip → encrypt in one stream so the plaintext never touches disk
docker compose -f /opt/installment-system/docker-compose.prod.yml exec -T db \
  pg_dump -U "${DB_USER:-installment}" "${DB_NAME:-installment_db}" \
  | gzip \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY \
  > "$BACKUP_FILE"

FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$(date)] Encrypted backup created: $BACKUP_FILE ($FILE_SIZE)"

# Cleanup old backups (cover both new .enc and legacy .gz files)
DELETED=$(find "$BACKUP_DIR" \( -name "installment_*.sql.gz.enc" -o -name "installment_*.sql.gz" \) -mtime +${RETENTION_DAYS} -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date)] Cleaned up $DELETED old backup(s)"
fi

echo "[$(date)] Backup complete"
