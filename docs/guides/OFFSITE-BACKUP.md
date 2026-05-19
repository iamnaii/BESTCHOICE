# Off-site Backup Runbook (Phase 3 SP2)

> Cross-region replication of Cloud SQL exports + the GCS document bucket
> into a second-region "off-site" bucket. Designed for the case where the
> primary region (`asia-southeast1`) goes down or someone mass-deletes
> the primary bucket — without an off-site copy we'd have no recoverable
> evidence.

This document covers WHY, WHAT, HOW TO ENABLE, HOW TO RESTORE, and HOW TO
TEST. Read it end-to-end before touching production.

---

## 1. Why we need this

BESTCHOICE production runs entirely in `asia-southeast1` (Singapore):

| Component | Service | Region |
|---|---|---|
| API | Cloud Run | asia-southeast1 |
| DB | Cloud SQL Postgres + automated backups + PITR | asia-southeast1 |
| Files | GCS bucket `bestchoice-documents` | asia-southeast1 |
| Web | Firebase Hosting | global (CDN) |

Cloud SQL automated backups + PITR are managed by GCP, encrypted at rest,
and recover any point in the last 7 days. That covers normal
"oops-I-deleted-a-row" incidents. It does **not** cover:

1. **Region-wide outage** — full asia-southeast1 unavailability. Both the
   primary DB and the Cloud SQL backups live in the same region.
2. **Mass delete of the GCS document bucket** (compromised credentials,
   misconfigured retention policy, fat-fingered `gcloud storage rm -r`).
   Bucket versioning helps but versioning itself can be disabled.
3. **Auditor / legal requirement** for a copy stored outside the primary
   provider region.

The off-site backup module mirrors two data sets daily into a bucket
in a different region. The destination bucket is the OWNER's choice but
the spec uses `asia-east1` (Taiwan) for low latency + clear region
separation. `us-central1` is another reasonable pick if the priority is
maximum geographic distance.

---

## 2. What gets replicated

Two prefixes inside one off-site bucket:

```
gs://bestchoice-backups-offsite/
├── sql/
│   ├── 2026-05-18.sql.gz
│   ├── 2026-05-19.sql.gz
│   └── ...                  ← Cloud SQL daily dumps, one per day
└── docs/
    ├── contracts/<uuid>/...  ← mirror of bestchoice-documents/contracts/
    ├── slips/<uuid>/...      ← mirror of bestchoice-documents/slips/
    └── ...                   ← mirror of every other doc-bucket prefix
```

**SQL dumps** are produced by Cloud SQL's automated export job (you must
schedule one with `gcloud sql export sql`, see §5.3). They land in a
"SQL backup source" bucket; the off-site module then copies the latest
dump to `sql/YYYY-MM-DD.sql.gz` in the off-site bucket.

**Documents** are diffed for the last 26 hours of activity (the 26-hour
window adds a 2h safety buffer for clock drift across the daily 03:30
cron tick) and copied into `docs/<path>` in the off-site bucket. The
prefix is preserved so restoration is a simple `gsutil rsync` back.

The module's idempotency rule is "skip if dest object exists AND md5
matches" — so re-running the same day (manual trigger or cron retry)
costs zero egress on files that are already replicated.

### Retention

Default 30 days at the off-site bucket. The daily cron prunes anything
older than `OFFSITE_BACKUP_RETENTION_DAYS` under the `sql/` and `docs/`
prefixes. The cleanup never touches other objects in the same bucket,
so it's safe to share the bucket with non-replication artifacts.

Why 30 days? Long enough for a DR drill to discover stale data and roll
back; short enough to keep storage costs negligible (~$3/mo for ~100GB).
Lengthen via `OFFSITE_BACKUP_RETENTION_DAYS=90` (etc.) if your retention
policy requires it.

---

## 3. Topology

```
Primary region (asia-southeast1)             Off-site region (asia-east1)
─────────────────────────────────             ────────────────────────────

bestchoice-documents/         ─copy─▶       bestchoice-backups-offsite/
  contracts/<uuid>/...                         docs/contracts/<uuid>/...
  slips/<uuid>/...                             docs/slips/<uuid>/...

bestchoice-sql-exports/       ─copy─▶       bestchoice-backups-offsite/
  cloudsql-backups/                            sql/2026-05-18.sql.gz
    YYYY/MM/DD/...                             sql/2026-05-19.sql.gz
```

The Cloud Run service account (the one your API runs as) is the agent
that performs the copies. It needs:

- `storage.objects.list` on the primary buckets (already has it for the
  document bucket; needs new IAM on the SQL export bucket)
- `storage.objects.get` on the primary buckets
- `storage.objects.create` + `storage.objects.delete` + `storage.objects.list`
  on the off-site bucket

No new service account is required. No keys exit GCP.

---

## 4. Cost estimate

At ~100 GB of documents and 7 daily SQL dumps ~5 GB each:

| Item | Detail | Monthly |
|---|---|---|
| Off-site bucket storage | 100 GB · $0.020/GB (Standard, asia-east1) | $2.00 |
| Class A operations (copies) | ~10k object writes · $0.05 / 10k | $0.05 |
| Class B operations (lists) | ~1k list calls · $0.004 / 10k | <$0.01 |
| Cross-region egress (one-time bootstrap) | 100 GB · $0.08/GB | $8 (one-time) |
| Cross-region egress (daily diff ~1 GB) | 30 days · 1 GB · $0.08/GB | $2.40 |
| Cleanup deletes | free | $0 |
| **Total recurring (after bootstrap)** | | **~$4.50 / mo** |

PITR + Cloud SQL automated backups are NOT counted — those are still in
the primary region and bill separately at their existing rate.

---

## 5. How to enable

> Bucket creation and IAM granting are **OWNER deliverables**. The code
> in this repo does not auto-create buckets or grant IAM, by design.

### 5.1. Create the destination bucket

```bash
# Pick a region different from the primary.
DEST_REGION=asia-east1
DEST_BUCKET=bestchoice-backups-offsite
PROJECT_ID=$(gcloud config get-value project)

gcloud storage buckets create gs://${DEST_BUCKET} \
  --project=${PROJECT_ID} \
  --location=${DEST_REGION} \
  --uniform-bucket-level-access \
  --public-access-prevention

# Optional but recommended — object versioning + 30d soft-delete so an
# accidental cron misconfiguration cannot wipe the off-site copy.
gcloud storage buckets update gs://${DEST_BUCKET} --versioning
```

### 5.2. Grant Cloud Run service account access

```bash
# Look up the Cloud Run service account email — usually
# bestchoice-api@${PROJECT_ID}.iam.gserviceaccount.com
SA_EMAIL=$(gcloud run services describe bestchoice-api \
  --region=asia-southeast1 --format='value(spec.template.spec.serviceAccountName)')

# Write + list + delete on the off-site bucket
gcloud storage buckets add-iam-policy-binding gs://${DEST_BUCKET} \
  --member=serviceAccount:${SA_EMAIL} \
  --role=roles/storage.objectAdmin

# Read on the SQL export source bucket (if Cloud SQL writes to its own)
gcloud storage buckets add-iam-policy-binding gs://bestchoice-sql-exports \
  --member=serviceAccount:${SA_EMAIL} \
  --role=roles/storage.objectViewer
```

### 5.3. Configure Cloud SQL daily SQL export

Cloud SQL's automated backups are *not* SQL dumps — they're internal
snapshots usable only via `gcloud sql import`. For the off-site backup
we need a real `.sql.gz` file we can restore anywhere. Schedule one via
Cloud Scheduler (or your CI):

```bash
gcloud sql export sql bestchoice-prod \
  gs://bestchoice-sql-exports/cloudsql-backups/$(date +%Y/%m/%d)/dump.sql.gz \
  --database=bestchoice \
  --offload  # avoids load on the prod instance
```

Schedule this at 03:00 BKK daily so the off-site cron at 03:30 BKK has
~30 minutes of headroom for the export to finish writing.

### 5.4. Set environment variables on Cloud Run

```bash
gcloud run services update bestchoice-api \
  --region=asia-southeast1 \
  --update-env-vars \
    OFFSITE_BACKUP_ENABLED=false,\
OFFSITE_BACKUP_DEST_BUCKET=bestchoice-backups-offsite,\
OFFSITE_BACKUP_RETENTION_DAYS=30,\
OFFSITE_BACKUP_SQL_PREFIX=cloudsql-backups/,\
OFFSITE_BACKUP_SQL_SOURCE_BUCKET=bestchoice-sql-exports
```

Leave `OFFSITE_BACKUP_ENABLED=false` for now — we want to test manually
before turning the cron loose.

### 5.5. Test with a manual trigger

1. Log in as OWNER → `/settings#offsite-backup`
2. Toggle **Off-site Backup** to ON (the UI requires a 2-click confirm).
3. Click **สำรองข้อมูลตอนนี้** ("Run Now").
4. Wait — first run takes proportional to your document bucket size.
5. Verify the toast shows `สำเร็จ — N ไฟล์ / size / duration`.
6. Verify off-site bucket has objects:
   ```
   gsutil ls -lh gs://bestchoice-backups-offsite/docs/ | head -20
   gsutil ls -lh gs://bestchoice-backups-offsite/sql/
   ```
7. The history table should show 1 SUCCESS row.

### 5.6. Activate the cron

Once §5.5 passes, the toggle stays ON. The daily 03:30 BKK cron will
run automatically. No additional setup — `@nestjs/schedule` runs in the
same Cloud Run process.

If you need to disable temporarily (e.g. while debugging a region issue):
flip the toggle off in the UI. The cron will keep firing but each tick
will write a `SKIPPED` row instead of doing any GCS work.

---

## 6. How to restore from off-site

### 6.1. Restore the document bucket

```bash
# Full restore — copies every doc back into the primary bucket
gsutil -m rsync -r \
  gs://bestchoice-backups-offsite/docs/ \
  gs://bestchoice-documents/

# Partial restore — single contract directory
gsutil -m cp -r \
  gs://bestchoice-backups-offsite/docs/contracts/<uuid>/ \
  gs://bestchoice-documents/contracts/<uuid>/
```

### 6.2. Restore the database from an off-site SQL dump

```bash
# 1. Copy the dump to a bucket the destination Cloud SQL instance can read
#    (Cloud SQL import requires a bucket in the same project + region as
#    the instance; cross-region import is not supported).
gsutil cp gs://bestchoice-backups-offsite/sql/2026-05-18.sql.gz \
  gs://bestchoice-sql-import-staging/restore.sql.gz

# 2. Provision a fresh Cloud SQL instance in the recovery region
gcloud sql instances create bestchoice-recovery \
  --region=asia-east1 \
  --tier=db-custom-2-7680 \
  --database-version=POSTGRES_15

# 3. Grant the recovery instance's service account read on the staging bucket
RECOVERY_SA=$(gcloud sql instances describe bestchoice-recovery \
  --format='value(serviceAccountEmailAddress)')
gcloud storage buckets add-iam-policy-binding gs://bestchoice-sql-import-staging \
  --member=serviceAccount:${RECOVERY_SA} \
  --role=roles/storage.objectViewer

# 4. Create the empty database
gcloud sql databases create bestchoice --instance=bestchoice-recovery

# 5. Import
gcloud sql import sql bestchoice-recovery \
  gs://bestchoice-sql-import-staging/restore.sql.gz \
  --database=bestchoice

# 6. Re-point the API at the recovery instance (Cloud Run env DATABASE_URL)
gcloud run services update bestchoice-api \
  --region=asia-southeast1 \
  --update-env-vars=DATABASE_URL=postgresql://...recovery...
```

The off-site SQL dump is gzipped, so a 5 GB dump becomes ~2 GB on disk
and ~5-10 min to restore on a `db-custom-2-7680` instance.

---

## 7. How to test (monthly DR drill)

Run on the **first business day of each month**. Owner or accountant on call.

- [ ] Open `/settings#offsite-backup` — verify last cron run was SUCCESS
- [ ] Click "สำรองข้อมูลตอนนี้" — verify toast says SUCCESS within 5 min
- [ ] Inspect off-site bucket:
  ```
  gsutil du -sh gs://bestchoice-backups-offsite/sql/
  gsutil du -sh gs://bestchoice-backups-offsite/docs/
  ```
  Expect SQL count = `OFFSITE_BACKUP_RETENTION_DAYS` (rounded) and docs
  size proportional to your active document volume.
- [ ] Pick a random SQL dump from off-site → restore to a temporary
  Cloud SQL instance (steps §6.2 #1-#5). Smoke-test by querying
  `SELECT COUNT(*) FROM contracts WHERE deleted_at IS NULL`. Delete the
  temporary instance after.
- [ ] Pick a random contract directory → restore via §6.1 to a sandbox
  bucket. Verify file count + a sample file checksums match the off-site.
- [ ] Inspect history table for any FAILED runs in the last 30 days —
  if found, investigate the `errorMessage` column and Sentry tag
  `cron:offsite-backup`.
- [ ] Update this runbook if anything was unclear or wrong during the drill.

---

## 8. Operational notes

- The cron logs to Cloud Run stdout with prefix `[OffsiteBackupService]`
  and `[OffsiteBackupCron]`. Filter in Cloud Logging:
  ```
  resource.type="cloud_run_revision"
  textPayload =~ "OffsiteBackup"
  ```
- Successful runs page Sentry at `level=info` with tag
  `kind=cron-job, cron=offsite-backup` (so the success path is visible
  in Sentry's cron monitoring dashboard, not just failures).
- Failures page Sentry as exceptions with the same tag. Set an alert on
  `kind:cron-job AND cron:offsite-backup AND level:error` if you want
  a pager event on each failure.
- The `OffsiteBackupRun` table grows by ~30 rows / month at the daily
  cadence. Rows older than **1 year** are pruned daily by
  `offsite-backup-retention.cron` at **02:00 BKK** (matches AuditLog policy
  + avoids PDPA risk on stale user UUIDs after soft-delete). Adjust the
  window by editing `OffsiteBackupRetentionCron.RETENTION_DAYS`.
- The toggle is a **SystemConfig** row (`OFFSITE_BACKUP_ENABLED`) not an
  env var, so flipping it doesn't require a Cloud Run redeploy. The env
  var is a fallback for environments where SystemConfig isn't seeded
  (e.g. brand-new dev DB).
- **Concurrency safety:** `OffsiteBackupService.run` takes a PostgreSQL
  advisory lock (`pg_try_advisory_lock(hashtext('offsite-backup'))`)
  before touching GCS. A 2nd attempt while a run is in flight returns
  HTTP **409 Conflict** — the cron logs the conflict as a warning and
  exits cleanly. Lock is released in a `finally` (and auto-released by
  the database when the connection closes).
- **Manual trigger audit:** `POST /backup/offsite-now` writes an
  `OFFSITE_BACKUP_RUN_NOW` event into AuditLog (hash-chained, immutable).
  The `OffsiteBackupRun.triggeredByUserId` FK is a convenience join — the
  hash-chained AuditLog is the legal trail.
- **Bucket-name masking:** `GET /backup/offsite-status` returns
  `destBucket` and `sqlSourceBucket` only when the caller is `OWNER`.
  FM / ACC see `null` (so they can monitor the audit trail without
  learning the infra topology).

---

## 9. What's deferred

The following are out of scope for SP2 and tracked separately:

- **Restore-from-off-site UI** — currently restoration is gcloud CLI only.
  A web UI button "restore this run" is a Phase 4 candidate.
- **GCS Object Lifecycle / Bucket Lock** — the 30-day retention is
  enforced by our cron, not by GCS lifecycle rules. Adding a lifecycle
  rule "delete after 31 days" gives belt-and-suspenders protection
  against a stuck cron leaving stale data forever. Configure manually
  when you create the bucket.
- **Multi-region replication of the off-site bucket itself** — would
  require a third-region copy. Overkill at current scale.
- **PII redaction in SQL dumps** — the dump contains every customer's
  full record. PDPA-strict mode (Phase 6.5) would need a sanitized
  variant. Not addressed here.
- **Restore drill automation** — §7 is manual. A scripted drill that
  spins up a recovery instance + runs a query + tears down would catch
  regressions earlier. Phase 4 candidate.
