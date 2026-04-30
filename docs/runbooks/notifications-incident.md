# Notifications — Incident Response Runbook

## Symptom: Failure rate spike

### Detection

- Sentry alert: `notification.failed > 10/hour`
- Manual: `/notifications` page → channel card shows high `failed` count
- User report: "ลูกค้าไม่ได้รับแจ้งเตือน"

### Investigation

```sql
SELECT channel, error_msg, COUNT(*)
FROM notification_logs
WHERE created_at > now() - interval '1 hour' AND status = 'FAILED'
GROUP BY 1, 2
ORDER BY 3 DESC LIMIT 20;
```

### Common causes + fixes

| `error_msg` pattern | Cause | Fix |
|---|---|---|
| `not configured` | IntegrationConfig missing `channelToken`/`apiKey` | Settings → Integrations → fill credentials → ทดสอบ |
| `Invalid token` | Token rotated externally / expired | Run `notifications-credential-rotation.md` |
| `400 The request body has 1 error(s)` | LINE user ID invalid (lineIdFinance from wrong OA?) | Check customer record + manually re-link |
| `403 Forbidden` (LINE) | Token revoked at LINE Console | Re-issue token, update UI |
| `Cannot read property 'getValue'` | Service crash / Prisma disconnected | Check Cloud Run logs → restart |
| `credentials invalid` (SMS) | API key rotated externally / wrong | Run rotation runbook |
| `number invalid` (SMS) | Customer phone format bad | Update customer record (must be `0xxx-xxx-xxxx`) |
| Timeout / ECONNRESET | Network blip OR provider issue | Wait 5 min — retry queue will pick up |

## Symptom: SMS credit exhausted

### Detection

- Cron alert at 09:00 ICT in `line-staff` group: "เครดิต SMS ใกล้หมด"
- IntegrationHubPage SMS card shows credit = 0 or low number
- Customers report SMS not received but app shows SENT

### Action

1. Top up at https://account.thaibulksms.com → Top Up
2. Verify new balance — Settings → Integrations → SMS card refresh, or query `/api/notifications/sms/credit`
3. Manually trigger SMS retry queue if there are failed-from-no-credit logs:

```sql
UPDATE notification_logs
SET status = 'RETRY_PENDING', next_retry_at = now()
WHERE channel = 'SMS'
  AND status = 'FAILED'
  AND error_msg ILIKE '%credit%'
  AND created_at > now() - interval '24 hours';
```

4. Cron `handleNotificationRetryQueue` runs every 5 mins — pending will be retried automatically

### Prevention

- Keep credit > 1000 baseline
- Monitor monthly burn rate via the IntegrationHubPage SMS card

## Symptom: LINE Sender ID rejected (SMS only)

### Detection

- All SMS attempts fail with `sender invalid`
- ThaiBulkSMS dashboard shows sender as **Pending** or **Rejected**

### Action

1. Login ThaiBulkSMS → Sender Names → check status
2. **Pending** (3-7 business days): wait, escalate via ThaiBulkSMS support if past 7 days
3. **Rejected**: read rejection reason
   - Common: "name too generic / similar to bank" → try variation
   - Common: "missing use-case description" → add detailed sample message
   Resubmit
4. **While pending/rejected**: temporarily change Settings → Integrations → SMS → `sender = default` (works but uses generic sender)

## Symptom: Customer reports no LINE notification but log shows SENT

### Investigation

1. Check `notification_logs.recipient` — is it a valid LINE user ID format `Uxxxx...`?
2. Cross-check: which LINE OA? Check `customer.lineIdFinance` vs `lineIdShop` — verify the recipient came from the correct field (was channelKey routing correct?)
3. **LINE Messaging API has no DLR webhook for push messages** → status SENT means LINE accepted, NOT user received

### Possible causes

| Cause | Action |
|---|---|
| User blocked the OA | Cannot detect from API. Ask user to unblock. |
| User unfollowed OA | Ask user to re-add OA via QR / LIFF link |
| User ID belongs to different OA (bug from data quality issue) | Manually fix `customer.lineIdFinance` / `lineIdShop` — verify which OA they actually follow |
| LINE app not installed / signed out | User must reinstall + login |

### Manual remediation

If lineId field has wrong-OA value:

```sql
-- Customer's lineIdFinance was actually a shop OA ID:
UPDATE customers
SET lineId_finance = NULL,
    lineId_shop = 'Uxxxxx_correct_shop_id'
WHERE id = '<customer-id>';
```

Then ask customer to re-verify finance OA via LIFF / chat.

## Symptom: All cron jobs silent (no notification logs at all)

### Investigation

```sql
SELECT MAX(created_at) FROM notification_logs;
```

If last entry > 1 hour old:

1. Check Cloud Run service is running
2. Check scheduler.service logs for errors
3. Verify `@nestjs/schedule` cron decorator working (look for "Starting daily..." log lines)
4. Check Sentry for any cron failures (`reportCronFailure` calls)

### Action

If cron itself has stopped:
1. Restart Cloud Run service
2. Check that BullMQ Redis connection is alive (queue worker depends on it)
3. If still stuck, escalate to L2

## Symptom: Test connection fails for line-finance / line-staff but line-shop works

This is the bug we fixed in P1 — `NotificationsService` previously hardcoded shop token. Verify:

```typescript
// apps/api/src/modules/notifications/notifications.service.ts
private async getLineToken(channelKey: LineChannelKey): Promise<string> {
  return (await this.integrationConfig.getValue(channelKey, 'channelToken')) || '';
}
```

If you see `getValue('line-shop', ...)` hardcoded → revert to channelKey param.

## Escalation

| Level | Who | When |
|---|---|---|
| L1 | Owner / dev on call | Per runbook fix |
| L2 | Provider support | Provider-side issue (LINE blocked OA, ThaiBulkSMS API down) |
| L3 | Disable affected cron | Comment out @Cron decorator + redeploy. Track as incident. |

### Provider contacts

- LINE: https://developers.line.biz/en/docs/contact/ (slow response, prefer LINE official customer support for OA issues)
- ThaiBulkSMS: support@thaibulksms.com / 02-119-2300

## Post-incident

- [ ] Document root cause in `docs/audit-log/incidents-<year>.md`
- [ ] If runbook missed the case, update this doc
- [ ] If a code change is needed, open PR and link to incident report

## P2 Compliance failure modes

### Symptom: status='BLOCKED' or status='DELAYED' in notification_logs

These are EXPECTED, not failures — they are compliance enforcement.

| status | block_reason | action |
|---|---|---|
| `BLOCKED` | `FREQUENCY_CAP` | wait — only 1 dunning per (customer+contract) per day allowed |
| `BLOCKED` | `NO_CONSENT` | re-obtain PDPA consent from customer |
| `DELAYED` | `OUTSIDE_HOURS` | none — retry queue auto-resumes at 08:00 ICT next window |
| `DELAYED` | `HOLIDAY_BLOCK` | none — auto-resumes after holiday |

### Symptom: Dunning queue accumulating (DELAYED count rising)

Likely cause: too many crons firing outside business hours, OR retry queue cron not running.

Action:
1. Check cron status: `grep "handleNotificationRetryQueue" apps/api/src/modules/notifications/scheduler.service.ts`
2. Cloud Run logs: search for "retry queue" entries — should appear every 5 min
3. If retry queue stuck, restart Cloud Run service

### Symptom: Sentry warns about content guardrails

`Notification content review needed: <reasons>` warnings — review the template that produced this message. May contain forbidden words. Update template to use compliant wording.

See `notifications-compliance.md` for full guidance.

## Related

- Spec: `docs/superpowers/specs/2026-04-30-notifications-p1-operational-readiness-design.md`
- Compliance: `docs/runbooks/notifications-compliance.md`
- Credential rotation: `docs/runbooks/notifications-credential-rotation.md`
