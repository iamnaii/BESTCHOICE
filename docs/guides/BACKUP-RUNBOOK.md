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

## Quarterly Recovery Drill (T7-C4)

เป้าหมาย: พิสูจน์ว่า restore ได้จริงภายใน RTO กำหนด — ไม่ใช่ "คิดว่าน่าจะได้"

### RTO / RPO targets
- **RTO** (Recovery Time Objective): 2 ชั่วโมง จาก incident ถึง system available
- **RPO** (Recovery Point Objective): ≤ 5 นาที (Cloud SQL PITR มี granularity ~วินาที)

### Drill schedule
- **Q1 (Jan-Mar)**: วันศุกร์ที่ 2 ของเดือนมีนาคม
- **Q2 (Apr-Jun)**: วันศุกร์ที่ 2 ของเดือนมิถุนายน
- **Q3 (Jul-Sep)**: วันศุกร์ที่ 2 ของเดือนกันยายน
- **Q4 (Oct-Dec)**: วันศุกร์ที่ 2 ของเดือนธันวาคม
- เวลา: นอกเวลา business (หลัง 20:00 Asia/Bangkok)

### Drill procedure (60-90 นาที)

1. **Pre-flight** (10 นาที)
   - [ ] ประกาศใน LINE OA internal ว่ากำลังทำ drill (dev environment)
   - [ ] Snapshot prod state (count contracts, payments, users) เก็บไว้เทียบ
   - [ ] บันทึกเวลาเริ่ม: `T0`

2. **Create clone** (15-25 นาที)
   - `gcloud sql instances clone bestchoice-prod bestchoice-drill-YYYYMMDD \
       --point-in-time='YYYY-MM-DDTHH:MM:SSZ'`
   - เลือก PITR timestamp ประมาณ 1 ชั่วโมงก่อน `T0`
   - บันทึกเวลา clone เสร็จ: `T1` (ต้อง ≤ 45 นาที)

3. **Verify data integrity** (15-25 นาที)
   - Connect ไป clone instance
   - รัน verification queries:
     ```sql
     SELECT COUNT(*) FROM contracts WHERE deleted_at IS NULL;
     SELECT COUNT(*) FROM payments WHERE status = 'PAID';
     SELECT COALESCE(SUM(amount_paid), 0) FROM payments WHERE paid_at > NOW() - INTERVAL '1 day';
     ```
   - ผลต้องตรงกับ snapshot ใน step 1 (tolerance ตามช่วง PITR gap)
   - ตรวจ checksum ของ migrations: `\dt` show ทุก table ตามที่คาดหวัง

4. **Application smoke test** (10-20 นาที)
   - Deploy preview-API ชี้ไปที่ clone DB
   - Login ด้วย test account
   - ดึง contract 1 ใบ / ตรวจ payment history
   - บันทึกเวลา app ready: `T2` (ต้อง ≤ 2 ชั่วโมง จาก `T0`)

5. **Cleanup** (5 นาที)
   - Delete clone instance: `gcloud sql instances delete bestchoice-drill-YYYYMMDD`
   - ยืนยัน billing charge หยุด

6. **Document** (10 นาที)
   - บันทึก `T1-T0`, `T2-T0`, deviations ใน `docs/reports/backup-drills/YYYY-QN.md`
   - ถ้า RTO miss → สร้าง issue + assign เจ้าของ
   - Slack/LINE OA: "Drill YYYY-QN ผ่าน/ไม่ผ่าน, RTO=XXm"

### Drill evidence checklist
สิ่งที่ต้องมีเก็บในไฟล์ report:
- [ ] Timestamps T0/T1/T2
- [ ] Clone instance name + PITR target
- [ ] Verification query results
- [ ] App smoke test screenshot
- [ ] Cleanup confirmation
- [ ] Participant list

### RTO miss escalation
ถ้า drill fails RTO 2 ครั้งติดกัน:
1. Root cause analysis ภายใน 7 วัน
2. พิจารณา: warm standby, read replica, cross-region strategy
3. ปรับ RTO target ถ้าจำเป็น + แจ้ง CPA เรื่อง business continuity

## Emergency Contacts

| Role | Contact |
|------|---------|
| DB Admin | เจ้าของ (พี่นาย) |
| GCP Console | console.cloud.google.com |
| Cloud SQL docs | cloud.google.com/sql/docs/postgres/backup-recovery |
