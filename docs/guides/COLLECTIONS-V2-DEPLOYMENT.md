# Collections Workflow Hub v2 — Deployment Runbook

**Target release:** PRs #684 → #685 → #686 → #687 (stacked)
**Last updated:** 2026-04-24

---

## Overview

The Collections Workflow Hub is a 4-PR stacked redesign of the `/overdue` page. Each PR is individually deployable but depends on the previous PR's schema changes. Merge in order, run the seed step after Plan 1 merges, then incrementally enable feature flags as you're ready.

Customer impact is **zero** on first merge — all new behavior is gated behind feature flags that default to off.

---

## Merge order

```
main
├─ #684 feat/collections-foundation    ← merge first (schema + services)
├─ #685 feat/collections-workflow-hub  ← merge after #684
├─ #686 feat/collections-power-features ← merge after #685
└─ #687 feat/collections-legal-letters ← merge after #686
```

Each PR triggers CI → `prisma migrate deploy` on prod. Schema changes are additive — no data loss.

---

## One-time seed on production (required after PR #684)

The existing `prisma migrate deploy` handles schema but does NOT run seeds on production. You must manually invoke the production seed ONCE after PR #684 lands so the SYSTEM user, event-triggered dunning rules, and SystemConfig keys exist.

**Without this step**, the `updateContractStatuses` cron will throw at 09:00 daily (the Plan 1 C2 bug fix requires SYSTEM user for audit trail).

### Step-by-step (Cloud Run Job one-shot pattern)

Memory precedent — the project uses ephemeral Cloud Run Jobs for prod DB scripts. Apply the same pattern:

```bash
# 1. Authenticate
gcloud auth login
gcloud config set project bestchoice-prod   # actual project id

# 2. Get the deployed image URL (the same api container that's live)
gcloud run services describe bestchoice-api --region asia-southeast1 --format 'value(spec.template.spec.containers[0].image)'
# Example output: gcr.io/bestchoice-prod/bestchoice-api:abc123

# 3. Run the seed as a one-shot job
gcloud run jobs create bestchoice-seed-collections-foundation \
  --image gcr.io/bestchoice-prod/bestchoice-api:abc123 \
  --region asia-southeast1 \
  --service-account bestchoice-api-sa@bestchoice-prod.iam.gserviceaccount.com \
  --set-secrets 'DATABASE_URL=DATABASE_URL:latest' \
  --command node \
  --args -r,ts-node/register,prisma/seed-production.ts

gcloud run jobs execute bestchoice-seed-collections-foundation --region asia-southeast1 --wait

# 4. Verify in logs
gcloud run jobs executions describe <execution-id> --region asia-southeast1
# Look for: "Collections foundation: 1 system user, 8 event rules, 10 configs"

# 5. Cleanup job
gcloud run jobs delete bestchoice-seed-collections-foundation --region asia-southeast1 --quiet
```

**Idempotency:** safe to re-run. All operations are upsert-by-unique-key and preserve OWNER's manual `isActive` toggles on event rules.

### Verify seed via Prisma Studio (optional)

Open Cloud SQL Proxy and run `npx prisma studio` locally pointed at prod DATABASE_URL. Verify:
- `User` table contains `system@bestchoice.internal` with `isSystemUser=true, isActive=false`
- `DunningRule` table has 8 rows where `eventTrigger IS NOT NULL`; all `isActive=false` on first deploy
- `SystemConfig` has 10 keys prefixed `collections_`, `mdm_`, or `letter_`

---

## Backfill `noAnswerCount` (optional — only if you want the UI to show historical counts)

If you want the new "ตามต่อ" tab to surface contracts based on last-30-day call history from before this deploy:

```bash
# Same Cloud Run Job pattern, different script
gcloud run jobs create bestchoice-backfill-no-answer \
  --image gcr.io/bestchoice-prod/bestchoice-api:abc123 \
  --region asia-southeast1 \
  --service-account bestchoice-api-sa@bestchoice-prod.iam.gserviceaccount.com \
  --set-secrets 'DATABASE_URL=DATABASE_URL:latest' \
  --command npx \
  --args tsx,scripts/backfill-no-answer-count.ts

gcloud run jobs execute bestchoice-backfill-no-answer --region asia-southeast1 --wait
gcloud run jobs delete bestchoice-backfill-no-answer --region asia-southeast1 --quiet
```

Safe to skip — new call logs start accumulating immediately on merge.

---

## Feature flag progression

All flags live in `SystemConfig` and can be toggled via `PATCH /settings` (OWNER-only) or directly in DB.

Start everything **OFF**, then enable in this order as UAT completes.

| Flag | Default | What it enables | When to flip |
|---|---|---|---|
| `collections_v2_enabled` | `false` | Sidebar routes to `/collections`; otherwise `/overdue` | After #685 merges + smoke tests pass in staging |
| `mdm_auto_propose_enabled` | `true` | Daily 09:00 cron creates `MdmLockRequest` for UNCONTACTABLE_3D / NO_PROMISE_3D | Already on — disable only if cron misbehaves |
| `letter_auto_generate_enabled` | `false` | Daily 09:15 cron creates `ContractLetter` for 45d / 60d thresholds | **Only after legal review of PDF template output**; upload signature PNG first |
| Individual `DunningRule.isActive` for event rules | `false` (prod seed) | LINE auto-send on call-log events (CALL_NO_ANSWER / CALL_ANSWERED_PROMISE / CALL_REFUSED / DEVICE_LOCKED / DEVICE_UNLOCKED / BROKEN_PROMISE / LETTER_DISPATCHED / CONTRACT_TERMINATED) | Per-rule OWNER decision via `/settings/dunning` |

### Enable `collections_v2_enabled`

```bash
# Via app (OWNER only): /settings → Collections v2 → ON
# Or via DB:
UPDATE "system_config" SET value = 'true' WHERE key = 'collections_v2_enabled';
```

Effect: sidebar nav + mobile bottom nav swap `/overdue` → `/collections`. Existing `/overdue` still works via direct URL.

### Enable event rules one at a time

1. Login as OWNER, go to `/settings/dunning`
2. Under "Event-triggered rules", review each rule's message template
3. Edit template wording if needed (match your brand voice)
4. Flip rule to active via the settings DB directly OR the toggle (if exposed in UI)
5. Test by logging a NO_ANSWER call log on a test customer with `lineId` set — verify LINE arrives

Suggested activation order (least to most aggressive):
1. `dunning_on_no_answer` — soft reminder
2. `dunning_confirm_promise` — positive confirmation
3. `dunning_firm_warning` — firmer language
4. `dunning_device_locked` + `dunning_device_unlocked` — only after MDM operational
5. `dunning_broken_promise` — only after broken-promise cron tested
6. `dunning_letter_dispatched` + `dunning_contract_terminated` — paired with legal letter rollout

### Pre-activation checklist for `letter_auto_generate_enabled`

Before flipping letter cron to `true`:

- [ ] OWNER uploads signature PNG via `/settings/dunning` → Letter Settings card
- [ ] OWNER uploads letterhead PNG (optional)
- [ ] Company info verified in DB (`nameTh`, `taxId`, `address`, `directorName` must be accurate — letters are legal documents)
- [ ] Generate a test PDF for a real contract via the `/collections` approval tab → download → inspect:
  - Thai text renders correctly (not boxes)
  - Letter number format `ST-YYYY-NNNNN`
  - Company name + taxId at footer
  - Signature image positioned correctly
  - Paragraph flow reasonable
- [ ] Legal review sign-off (recommended — letters are enforceable once dispatched)

Only after all checked: flip `letter_auto_generate_enabled = 'true'`.

---

## Rollback plan

### Quick rollback (feature flag off)

If issues surface after enabling `collections_v2_enabled`:

```sql
UPDATE "system_config" SET value = 'false' WHERE key = 'collections_v2_enabled';
```

Sidebar immediately routes back to `/overdue`. Zero data loss; zero migration rollback needed.

### Schema rollback (only if absolutely required)

New columns have defaults; new tables are empty on first deploy. Reverting the migration would DROP the new tables — you'd lose any `MdmLockRequest` / `ContractLetter` rows created after deploy.

Prefer: keep the schema, disable flags, investigate. Only drop tables if data integrity was compromised.

---

## Monitoring after go-live

### Metrics to watch (first week)

| Signal | Where | Red flag |
|---|---|---|
| `updateContractStatuses` cron success | Cloud Run logs / Sentry | Any "SYSTEM user not found" error |
| `mdm-auto-propose` cron result | Cloud Run logs | Proposals count > 50/day → review threshold configs |
| `letter-auto-generate` cron (when enabled) | Cloud Run logs | Any error |
| `LETTER_DISPATCHED` event send rate | DunningAction table, status=SENT | LINE send failures surge |
| Collector login → /collections load time | Analytics / RUM | > 2s p95 |
| `executeEventTrigger` dedup skip rate | DunningAction table, status=SKIPPED | Unusually high (may indicate logic bug) |
| User feedback from แนน / กวาง / ตุ๊กตา | Chat / ticket | Any workflow friction |

### Sentry tags to filter on

- `service: DunningEngineService`
- `cron: mdm-auto-propose`
- `cron: letter-auto-generate`
- `method: executeEventTrigger.send`
- `method: executeEventTrigger.paymentLink`

---

## Communication to ทีมติดตาม (แนน / กวาง / ตุ๊กตา)

Before flipping `collections_v2_enabled`:

> ทีมครับ พรุ่งนี้จะเปิดหน้าใหม่ `/collections` ให้ลอง UI เดิม `/overdue` ยังใช้ได้ถ้าอยากกลับไป ลองทำงาน 3 วัน แล้วมาบอกปัญหา/สิ่งที่ขาดกันได้เลย

### Key changes to highlight

1. **5 tabs ใหม่** แบ่งตาม workflow ประจำวัน: คิววันนี้ / ตามต่อ / นัดชำระ / อนุมัติ / ทั้งหมด
2. **โทรแล้ว log ผลใน dialog เดียว** → ระบบส่ง LINE ถึงลูกค้าอัตโนมัติตามผลโทร (ถ้า OWNER เปิด event rules แล้ว)
3. **Customer 360** เปิดจาก ▶ ที่การ์ด → ดูประวัติ+ชำระเงินได้โดยไม่ต้องออกจากหน้า
4. **Bulk actions** เลือกหลายรายการแล้วมอบหมาย/ส่ง LINE/เสนอล็อคพร้อมกัน
5. **MDM lock proposals** ระบบเสนออัตโนมัติเมื่อติดต่อไม่ได้ 3 วัน → OWNER อนุมัติในแท็บ "อนุมัติ"
6. **หนังสือ 45/60 วัน** ระบบสร้างอัตโนมัติ OWNER generate PDF + ส่ง EMS + กรอก tracking กลับ

### Rollback promise

ถ้ารู้สึกว่า `/collections` ใหม่ยังไม่พร้อม บอก OWNER เพื่อปิด flag กลับไปใช้ `/overdue` เดิมได้ทันที

---

## FAQ

**Q: ทำไมต้อง seed บน prod?**
A: Plan 1 fix bug C2 — ถ้าไม่มี SYSTEM user, cron `updateContractStatuses` จะ throw (ตั้งใจ ป้องกัน audit log หายเงียบ ๆ)

**Q: ถ้า OWNER ลืม upload signature แล้ว cron ส่ง letter?**
A: `letter_auto_generate_enabled` default `false` → cron ไม่ฝัน. ถ้าเปิดโดยไม่ signature: PDF สร้างได้ (ไม่มีลายเซ็น) แต่หน้า generate dialog จะเตือนก่อนและขอ confirm

**Q: ทำไมเลือก client-side PDF?**
A: Matches existing project pattern (`jspdf` already in `apps/web` deps). ไม่ต้องเพิ่ม server-side PDF dep + Thai font handling fragile on Node. Client-side อาจช้ากว่าถ้า batch ใหญ่ แต่ MVP นี้ทำทีละใบ

**Q: ถ้า LINE API down วันหนึ่ง จะทำอย่างไร?**
A: `executeEventTrigger` จะ `status=FAILED` + Sentry alert. ข้อความไม่ไปถึงลูกค้า. Plan 6 (หลังจากนี้) จะเพิ่ม retry queue UI

**Q: พนักงาน SALES ที่ไม่ใช่ตัวเองจะเห็นคิวคนอื่นไหม?**
A: Branch-scoped — SALES/BRANCH_MANAGER เห็นเฉพาะสาขาตัวเอง. OWNER/FINANCE_MANAGER เห็นทุกสาขา

**Q: ถ้า customer ไม่มี lineId จะส่ง LINE ไม่ได้ใช่ไหม?**
A: ถูกต้อง. ContractCard มี chip "LINE" สีเขียวตอนที่ได้รับสาย lineId. Button "ส่ง LINE" ปุ่มจะ disabled + tooltip "ลูกค้าไม่มี LINE ID"

---

## Appendix: verify commands

Copy-paste ready to run from laptop with `cloud_sql_proxy` running:

```bash
# Count seeds
psql "$PROD_DATABASE_URL" -c "SELECT COUNT(*) FROM users WHERE is_system_user = true;"  # expect 1
psql "$PROD_DATABASE_URL" -c "SELECT COUNT(*) FROM dunning_rules WHERE event_trigger IS NOT NULL;"  # expect 8
psql "$PROD_DATABASE_URL" -c "SELECT COUNT(*) FROM system_config WHERE key LIKE 'collections_%' OR key LIKE 'mdm_%' OR key LIKE 'letter_%';"  # expect 10

# Check feature flag state
psql "$PROD_DATABASE_URL" -c "SELECT key, value FROM system_config WHERE key IN ('collections_v2_enabled','mdm_auto_propose_enabled','letter_auto_generate_enabled');"
```
