# Notifications — Credential Rotation Runbook

## When to rotate

| Credential | Frequency | Trigger |
|---|---|---|
| LINE channel access token (long-lived) | every 12 months | calendar OR leak/incident |
| LINE channel secret | only on incident | leak detected — also requires webhook URL recheck |
| ThaiBulkSMS API Key + Secret | every 6 months | calendar OR leak/incident |
| LIFF ID | not rotated | only when creating new LIFF app |

## Pre-flight checklist

- [ ] Notify team via LINE staff group — "rotation in progress, brief outage possible"
- [ ] Have new credential ready in 1Password / secure note (not in chat)
- [ ] Confirm time window — preferred after 20:00 ICT (no customer cron impact)
- [ ] Verify `git status` clean on production deployment branch (no pending changes)

## LINE channel access token rotation

We have **3 LINE channels** — `line-shop`, `line-finance`, `line-staff` — each with its own token. Rotate them independently.

### 1. Generate new token at LINE Developers Console

1. Login https://developers.line.biz/console
2. Select provider → channel (line-shop / line-finance / line-staff)
3. Messaging API tab → Channel access token (long-lived)
4. Click **Reissue** — copy new token immediately (UI shows once)
5. **Do NOT click Revoke on old token yet** — keep both valid temporarily

### 2. Update via UI (preferred — no downtime)

1. Login BESTCHOICE admin → Settings → Integrations
2. Find the integration row (line-shop / line-finance / line-staff) → **แก้ไข**
3. Paste new `channelToken` → click **ทดสอบเชื่อมต่อ** → expect "Connection successful"
4. Save

### 3. Verify

Run this query in prod DB:

```sql
SELECT channel, status, COUNT(*)
FROM notification_logs
WHERE created_at > now() - interval '15 minutes'
GROUP BY 1, 2
ORDER BY 1, 2;
```

Expected: `LINE | SENT | n` (n > 0 in any 15-min window with active cron). If `FAILED` with "Invalid token" → cache issue → restart Cloud Run service.

### 4. Revoke old token at LINE Console

After 24 hours of clean SENT traffic, return to LINE Console and revoke the old token.

### 5. Rollback procedure

If new token fails at "ทดสอบเชื่อมต่อ":
1. Re-paste old token (still valid until revoked) — system continues
2. Investigate why new token doesn't work (check LINE Console for status of new token)

## ThaiBulkSMS API Key rotation

### 1. Generate new key

1. Login https://account.thaibulksms.com
2. Setting → API Setting → Generate new API Key + Secret
3. Old key remains valid for 24 hours grace period

### 2. Update via UI

1. BESTCHOICE → Settings → Integrations → SMS row → แก้ไข
2. Paste new `apiKey` + `apiSecret` → ทดสอบ → save

### 3. Verify credit balance fetch works

- Go to **Integrations** page → SMS card
- "เครดิตเหลือ" shows current balance — proves new key authenticates correctly
- Or query: `GET /api/notifications/sms/credit` — expect `{ configured: true, credit: 800 }`

### 4. Rollback

If new key fails: revert in UI (old key valid 24h grace).

## LINE channel secret rotation (rare)

Only on suspected leak. Channel secret is used for webhook signature verification.

1. LINE Console → Messaging API → Channel secret → click **Reissue**
2. **DOWNTIME EXPECTED** — webhook signature check will fail until secret updated
3. Update via Integrations UI immediately
4. Verify webhook returns 200 by sending test message to OA

## SMS Sender ID approval

Sender ID `BESTCHOICE` should be approved at ThaiBulkSMS dashboard. Status:

- Login → Sender Names — check status (Pending / Approved / Rejected)
- Pending: 3-7 business days
- Rejected: read reason, resubmit corrected
- Approved: set `sender = BESTCHOICE` in IntegrationConfig

If sender becomes "expired" or status changes:
1. Resubmit at dashboard
2. While pending, fall back to "default" sender (still works, less branded)

## Post-rotation

- [ ] Update password manager / 1Password vault
- [ ] Document rotation in `docs/audit-log/credential-rotations.md` (date, who, channel)
- [ ] Schedule next rotation in calendar (12 months for LINE, 6 months for SMS)
- [ ] Confirm SMS credit alert cron working (next 09:00 ICT run should not alert if credit OK)

## Related

- Spec: `docs/superpowers/specs/2026-04-30-notifications-p1-operational-readiness-design.md`
- Incident response: `docs/runbooks/notifications-incident.md`
