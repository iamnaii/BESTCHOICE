# SP7 Cutover Playbook — 31 ธ.ค. 2026 → 1 ม.ค. 2027

**Estimated downtime:** 6 hours (22:00 BKK → 04:00 BKK)
**Migration script:** `apps/api/scripts/migration/cutover.sh`

## War Room

| Role | Name | Contact |
|------|------|---------|
| On-call dev | TBD | TBD |
| On-call accountant | TBD | TBD |
| Owner | TBD | TBD |

**Channel:** #cutover-2027 (Slack / LINE Staff OA)

---

## T-7 days

- [ ] Accountant final review of TB as of today's date
- [ ] Owner verifies BC SHOP tax ID received from Revenue Department (กรมสรรพากร)
- [ ] Verify both Cloud SQL instances provisioned: `bc_shop` + `bc_finance`
- [ ] Run rehearsal #2 on staging clone (full dry-run, no production touch)
- [ ] War room channel created + on-call schedule confirmed
- [ ] `npm run audit:sp7-edge-cases` run against production read replica → review CSV output with accountant

## T-1 day

- [ ] Pre-cutover audit: `npm run audit:sp7-edge-cases` → CSV reviewed and approved
- [ ] Customer deduplication CSV approved by accountant
- [ ] Fixed assets classification (SHOP vs FINANCE) approved
- [ ] Payroll classification approved
- [ ] CPA-approved opening balance transfer JE plan in writing
- [ ] Smoke test plan ready (login + 1 sale + 1 payment per entity)
- [ ] Confirm MAINTENANCE_MODE middleware deployed (SP7.10)

---

## T-0 — 31 ธ.ค. 2026

### 22:00 — Maintenance start

```bash
# Cloud Run: set env var + redeploy
gcloud run services update bestchoice-api \
  --update-env-vars MAINTENANCE_MODE=true \
  --region asia-southeast1

# All POST/PUT/PATCH/DELETE now return 503
# GET reads continue (cached dashboards stay live)
```

- [ ] Verify: `curl -X POST https://api.bestchoicephone.app/api/payments` → 503 `{ maintenance: true }`
- [ ] Verify: `curl https://api.bestchoicephone.app/api/health` → 200 (whitelisted)
- [ ] LINE OA auto-reply set: "ระบบกำลังบำรุงรักษา กลับมาเปิดบริการ 04:00 น."
- [ ] Staff notified via LINE Staff OA: "ระบบเข้า maintenance 22:00 คาดเปิดปกติ 04:00"

```bash
# Backup bc_orig BEFORE any changes
pg_dump $DATABASE_URL | gzip | \
  gpg --batch --passphrase "$BACKUP_ENCRYPTION_KEY" --symmetric \
  > pre-cutover-$(date +%Y%m%d-%H%M%S).sql.gz.gpg

# Verify backup integrity
gpg --batch --passphrase "$BACKUP_ENCRYPTION_KEY" -d pre-cutover-*.sql.gz.gpg | zcat | tail -5
```

- [ ] Backup size + hash logged to `docs/migration/2026-12-31-snapshot-manifest.md`

### 23:00 — Final accruals + year-end closing

```bash
# Run final installment accrual (in case daily cron missed edge cases)
# POST /api/cron/installment-accrual (OWNER only, non-destructive)

# Run final VAT 60-day check
# POST /api/cron/vat-60day (OWNER only, non-destructive)
```

- [ ] Year-end closing for FY2026 executed (see `sp7-year-end-closing-pre-cutover.md`)
- [ ] Post-closing TB verified: revenue/expense = 0, 33-1101 updated
- [ ] Accountant signs off final TB snapshot (PDF to audit file)

### 23:30 — Pre-split snapshot

```bash
# Final encrypted snapshot after closing, before migration
pg_dump $DATABASE_URL | gzip | \
  gpg --batch --passphrase "$BACKUP_ENCRYPTION_KEY" --symmetric \
  > pre-split-$(date +%Y%m%d-%H%M%S).sql.gz.gpg
```

- [ ] Snapshot hash + size + accountant initials → `docs/migration/2026-12-31-snapshot-manifest.md`

---

## T+0 — 1 ม.ค. 2027

### 00:00 — Migration execute

```bash
cd apps/api && bash scripts/migration/cutover.sh
```

The script runs in order:
1. **Backup** `bc_orig` (final pre-migration snapshot)
2. **Clone** `bc_orig` → `bc_finance` (pg_dump | pg_restore to new instance)
3. **Extract** SHOP-side data → `bc_shop` (selective table copy)
4. **Apply migrations** on each new DB (`prisma migrate deploy`)
5. **Opening balance transfer JE** (per CPA plan — funds move from bc_orig SHOP accounts to bc_shop opening)
6. **Audit edge cases** → CSV (`npm run audit:sp7-edge-cases --db bc_finance`)
7. **Smoke checks** — print row counts for human verification

Expected runtime: ~2 hours for a production-size DB.

### 01:00 — Validate row counts + checksums

```sql
-- bc_finance: should equal pre-split minus extracted SHOP rows
SELECT COUNT(*) FROM journal_entries;
SELECT COUNT(*) FROM contracts;
SELECT COUNT(*) FROM payments;

-- bc_shop: opening state only
SELECT COUNT(*) FROM products;
SELECT COUNT(*) FROM journal_entries; -- should be small (opening JEs only)
```

- [ ] bc_finance journal_entries count matches expectation (pre-split count - SHOP-side count)
- [ ] bc_shop opening balance JE exists + matches CPA plan
- [ ] FK integrity: `prisma migrate diff` on each DB → output EMPTY (schema in sync)
- [ ] Trial balance on bc_finance balances (Assets = Liabilities + Equity)

### 02:00 — Smoke tests

```
Login flow:
- [ ] OWNER login → pill switcher shows [หน้าร้าน] [ไฟแนนซ์]
- [ ] Switch to SHOP pill → dashboard loads, /products list shows
- [ ] Switch to FINANCE pill → /contracts list loads, 1 contract opens

Functional:
- [ ] Create test cash sale in SHOP → JE posted in bc_shop
- [ ] Record test payment for existing contract in FINANCE → JE posted in bc_finance
- [ ] Verify Sentry: 0 new critical errors in past 30 min

Outbox:
- [ ] SELECT COUNT(*) FROM outbox_events WHERE processed_at IS NULL; → 0 (or minimal)
```

### 03:00 — Internal soft-open

- [ ] Notify internal staff (LINE Staff OA): "ระบบใหม่พร้อมใช้งาน รอเปิดอย่างเป็นทางการ 04:00"
- [ ] Senior staff verify POS works at 1 branch
- [ ] Watch Sentry error rate — target 0 new critical in 30 min window
- [ ] Check Cloud Run logs: no connection errors to bc_finance or bc_shop

### 04:00 — Maintenance end

```bash
# Remove MAINTENANCE_MODE + redeploy
gcloud run services update bestchoice-api \
  --remove-env-vars MAINTENANCE_MODE \
  --region asia-southeast1
```

- [ ] Verify: `curl -X POST https://api.bestchoicephone.app/api/payments` → 401 (no longer 503)
- [ ] LINE OA auto-reply reset to normal
- [ ] LINE OA broadcast: "ระบบกลับมาใช้งานปกติแล้ว ขอบคุณที่รอคอย"
- [ ] Owner phone call: "Migration complete, smoke green"

---

## T+1 to T+7 days — Stabilization watch

- [ ] Daily reconcile cron (04:00 BKK) → 0 FAILED outbox events each morning
- [ ] Daily TB check: FINANCE and SHOP both balance independently
- [ ] Daily accountant spot-check: 1 contract + 1 payment + 1 commission per day
- [ ] Sentry: 0 critical errors related to cross-entity data access
- [ ] Any user-reported bug → on-call dev + fix within 4-hour SLA

## T+30 days — Stabilization complete

- [ ] All Phase A reports for January 2027 generated separately per entity
- [ ] ภ.พ.30 for January 2027 (FINANCE) submitted to Revenue Department
- [ ] Accountant final sign-off: "Split is stable"
- [ ] Owner decision: schedule `bc_orig` drop (after 90-day retention for forensic access)

---

## Rollback procedure

### If blocking issue found between 00:00–02:00 (before live traffic)

```bash
# 1. STOP all migration scripts immediately
# 2. Drop incomplete new DBs
dropdb bc_shop
dropdb bc_finance

# 3. Restore bc_orig from pre-split snapshot
pg_restore -d bc_orig < pre-split-YYYYMMDD.sql

# 4. Re-enable Cloud Run pointing to bc_orig (remove split env vars)
gcloud run services update bestchoice-api \
  --remove-env-vars MAINTENANCE_MODE \
  --update-env-vars DATABASE_URL=$BC_ORIG_URL \
  --region asia-southeast1

# 5. Verify: /api/health → 200, login works, 1 sale completes
```

- [ ] Announce via LINE OA: "บริการกลับมาใช้งานปกติ (cutover เลื่อน)"
- [ ] Schedule post-mortem + new cutover window

### If issue discovered AFTER 02:00 (live traffic written to new DBs)

- Identify scope of affected records (small volume during soft-open window)
- Manual reconcile each new row with accountant
- **Continue forward** — do not rollback after live transactions exist
- File correction JEs for any accounting discrepancies

---

## Communications

| Stakeholder | When | Channel | Message |
|---|---|---|---|
| Internal staff | T-7 days | LINE Staff OA | "Cutover schedule: 31 ธ.ค. 22:00 → 1 ม.ค. 04:00. Be ready for the new pill switcher (SHOP / FINANCE)." |
| Customers | T-1 day | LINE OA broadcast | "ระบบ BESTCHOICE จะปิดบำรุงรักษาชั่วคราว 22:00-04:00 คืนวันที่ 31 ธ.ค. ขออภัยในความไม่สะดวก" |
| Accountant | T-0 23:00 | Phone | "Year-end closing started — please stand by for TB sign-off" |
| Accountant | T-0 23:30 | Phone | "TB confirmed, proceeding to migration" |
| Owner | T+0 02:00 | Phone | "Migration complete, smoke tests green" |
| Owner | T+0 04:00 | Phone | "Maintenance end — system live on dual-entity" |

---

## Reference files

- Year-end closing runbook: `docs/runbooks/sp7-year-end-closing-pre-cutover.md`
- Migration script: `apps/api/scripts/migration/cutover.sh`
- Edge-case audit script: `apps/api/scripts/migration/audit-sp7-edge-cases.ts`
- Snapshot manifest: `docs/migration/2026-12-31-snapshot-manifest.md` (created during T-0)
- Maintenance middleware: `apps/api/src/middleware/maintenance-mode.middleware.ts`
