# Notifications — Compliance Runbook

## Overview

P2 implements Thai legal compliance for notification sends:
- พ.ร.บ.การทวงถามหนี้ พ.ศ. 2558 (debt collection law)
- พ.ร.บ.PDPA พ.ศ. 2562 (data protection)

Hard-blocked failure modes:
- `OUTSIDE_HOURS` — sent outside 08:00–20:00 weekday or 08:00–18:00 weekend/holiday
- `FREQUENCY_CAP` — 2nd dunning to same (customer + contract) same day
- `NO_CONSENT` — customer revoked PDPA consent
- `HOLIDAY_BLOCK` — Thai public holiday (currently subsumed by `OUTSIDE_HOURS`)

`OUTSIDE_HOURS` sends auto-route to retry queue → fire at next legal window.
`FREQUENCY_CAP` / `NO_CONSENT` — hard block (no auto-retry).

## Updating Thai holidays (yearly task)

When ครม. announces next year's holidays (typically Q4):

1. Edit `apps/api/src/data/thai-holidays.json`
2. Add `"YYYY": [...]` array with all dates
3. PR + deploy
4. Document the source in commit body

## Override via bypassCompliance

Setting `bypassCompliance: true` in `SendNotificationDto` bypasses ALL gates. Use only for:

- Receipt sends (already use `TRANSACTIONAL` category — bypass is automatic)
- Account verification (`TRANSACTIONAL`)
- Critical security alerts to staff (`STAFF` — bypass is automatic)

Never use `bypassCompliance` for customer-facing dunning/marketing.

## Why is my dunning notification not sending?

Check NotificationLog:

```sql
SELECT status, block_reason, created_at, message
FROM notification_logs
WHERE customer_id = '<customer-id>' AND related_id = '<contract-id>'
ORDER BY created_at DESC LIMIT 5;
```

| status | block_reason | meaning |
|---|---|---|
| `SENT` | null | delivered |
| `FAILED` | null | provider error (see `error_msg`) |
| `BLOCKED` | `FREQUENCY_CAP` | already sent today — wait until tomorrow |
| `BLOCKED` | `NO_CONSENT` | customer revoked PDPA — re-obtain consent first |
| `DELAYED` | `OUTSIDE_HOURS` | queued, will fire at 08:00 ICT next legal window |
| `DELAYED` | (`next_retry_at` past) | retry queue stuck — check cron is running |

## Cron timezone audit

All crons in `scheduler.service.ts` use `{ timeZone: 'Asia/Bangkok' }`. Verify:

```bash
grep -c "timeZone: 'Asia/Bangkok'" apps/api/src/modules/notifications/scheduler.service.ts
# Expected: ≥ 20
```

If a cron is off-window for compliance, `ComplianceService` routes to `DELAYED` queue automatically. Cron itself runs anyway (e.g. status calculation at 00:30 ICT) — the customer-facing send is what gets delayed.

## Auditing block patterns

Dashboard at `/notifications` shows last-7-day compliance blocks. Investigate:

- High `OUTSIDE_HOURS` — cron schedule wrong; review Task 8 of P2 plan
- High `FREQUENCY_CAP` — multiple cron methods sending to same customer/contract; need consolidation
- High `NO_CONSENT` — customers revoking; investigate why (intrusive content?)
- High `HOLIDAY_BLOCK` — currently same as `OUTSIDE_HOURS`

API endpoint backing the card: `GET /notifications/compliance/stats` (last 7 days, grouped by `blockReason`).

## Retention policy

`notification_logs` retention is category-aware (see `scheduler.service.ts` `handleDataRetention`, runs Sun 09:00 ICT):

| category | retention | basis |
|---|---|---|
| `DUNNING` / `REMINDER` / `TRANSACTIONAL` | 5 years | พ.ร.บ.ทวงถามหนี้ มาตรา 16 + Revenue Code |
| `STAFF` / `MARKETING` / null (legacy) | 1 year | delivery report only |

`AuditLog` retention remains 7 years (independent — handled in same cron via `archivedAt`).

## Related

- Spec: `docs/superpowers/specs/2026-04-30-notifications-p2-compliance-design.md`
- Incident: `docs/runbooks/notifications-incident.md`
- P1 Setup: `docs/runbooks/notifications-p1-go-live-checklist.md`
- Credential rotation: `docs/runbooks/notifications-credential-rotation.md`
