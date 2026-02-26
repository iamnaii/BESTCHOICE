#!/bin/bash
# Database backup script
# Usage: ./scripts/backup.sh
# Cron: 0 2 * * * /opt/installment-system/scripts/backup.sh

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups/installment}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/installment_${TIMESTAMP}.sql.gz"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting database backup..."

# Dump database using docker compose
docker compose -f /opt/installment-system/docker-compose.prod.yml exec -T db \
  pg_dump -U "${DB_USER:-installment}" "${DB_NAME:-installment_db}" \
  | gzip > "$BACKUP_FILE"

FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$(date)] Backup created: $BACKUP_FILE ($FILE_SIZE)"

# Cleanup old backups
DELETED=$(find "$BACKUP_DIR" -name "installment_*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date)] Cleaned up $DELETED old backup(s)"
fi

echo "[$(date)] Backup complete"
