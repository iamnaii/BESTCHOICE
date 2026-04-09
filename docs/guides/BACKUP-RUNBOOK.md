# Backup & Restore Runbook

## Overview

BESTCHOICE ใช้ **GCP Cloud SQL** automated backups + **Point-in-Time Recovery (PITR)** เป็นระบบ backup หลัก.

ไม่มี script-based backup — `scripts/backup.sh` ถูกลบใน 2026-04-09 เพราะเป็น legacy จากตอน self-hosted.

## Backup Strategy

| Layer | Method | Retention | RPO |
|-------|--------|-----------|-----|
| **Primary** | Cloud SQL automated daily backup | 7 days (configurable) | 24 hours |
| **PITR** | Cloud SQL continuous WAL archiving | 7 days | ~seconds |
| **Off-site** | Cloud SQL backup → GCS cross-region (planned) | 30 days | 24 hours |

## Cloud SQL Automated Backups

### Verify Backup Status

```bash
# List backups for the instance
gcloud sql backups list --instance=bestchoice-prod

# Describe a specific backup
gcloud sql backups describe <BACKUP_ID> --instance=bestchoice-prod
```

### Configure Backup Window

```bash
# Set backup window (recommended: 02:00-03:00 ICT = 19:00-20:00 UTC)
gcloud sql instances patch bestchoice-prod \
  --backup-start-time=19:00
```

### Enable PITR

```bash
gcloud sql instances patch bestchoice-prod \
  --enable-point-in-time-recovery \
  --retained-transaction-log-days=7
```

## Restore Procedures

### Restore from Automated Backup

```bash
# Restore to a NEW instance (recommended — don't overwrite prod)
gcloud sql instances restore-backup bestchoice-prod \
  --backup-instance=bestchoice-prod \
  --backup-id=<BACKUP_ID> \
  --restore-instance=bestchoice-restore-test

# Verify data integrity
psql -h <RESTORE_IP> -U postgres -d bestchoice -c "SELECT COUNT(*) FROM \"Contract\";"
psql -h <RESTORE_IP> -U postgres -d bestchoice -c "SELECT COUNT(*) FROM \"Payment\";"
```

### Point-in-Time Recovery

```bash
# Restore to a specific timestamp (UTC)
gcloud sql instances clone bestchoice-prod bestchoice-pitr-test \
  --point-in-time="2026-04-09T12:00:00Z"
```

## Restore Drill (Quarterly)

ทำทุก 3 เดือน เพื่อ verify backup integrity:

### Checklist

1. [ ] Pick latest automated backup
2. [ ] Restore to staging instance `bestchoice-restore-drill`
3. [ ] Verify row counts match production (within expected delta)
   ```sql
   SELECT 'Contract' AS t, COUNT(*) FROM "Contract"
   UNION ALL SELECT 'Payment', COUNT(*) FROM "Payment"
   UNION ALL SELECT 'Customer', COUNT(*) FROM "Customer"
   UNION ALL SELECT 'Product', COUNT(*) FROM "Product"
   UNION ALL SELECT 'Sale', COUNT(*) FROM "Sale";
   ```
4. [ ] Verify latest records exist (check `createdAt` of newest Contract)
5. [ ] Run API health check against restored DB
6. [ ] Document results in `docs/reports/backup-drill-YYYY-MM-DD.md`
7. [ ] Delete staging instance after verification

### Delete Staging Instance

```bash
gcloud sql instances delete bestchoice-restore-drill --quiet
```

## Off-site Replication (Planned)

### GCS Cross-Region Sync

เมื่อ implement:
1. Export Cloud SQL backup → GCS bucket `gs://bestchoice-backup-offsite/`
2. GCS bucket in different region (e.g. `asia-southeast2` if prod is `asia-southeast1`)
3. Lifecycle rule: delete after 30 days
4. Cron: Cloud Scheduler → Cloud Function → `gcloud sql export`

### Encryption

- Cloud SQL backups: encrypted at rest by default (Google-managed keys)
- GCS exports: encrypted with `BACKUP_ENCRYPTION_KEY` (AES-256)
- Key stored in Secret Manager — **never in .env or source code**

## Emergency Contacts

| Role | Contact |
|------|---------|
| DB Admin | เจ้าของ (พี่นาย) |
| GCP Console | console.cloud.google.com |
| Cloud SQL docs | cloud.google.com/sql/docs/postgres/backup-recovery |
