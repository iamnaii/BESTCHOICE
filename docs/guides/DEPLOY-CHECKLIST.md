# BESTCHOICE Production Deploy Checklist

## Pre-Deploy Verification

### Build & Tests
- [ ] `./tools/check-types.sh all` — TypeScript compile (API + Web)
- [ ] `npm run test --workspace=apps/api` — 281 unit tests pass
- [ ] `cd apps/web && npx playwright test --project=chromium` — E2E tests pass
- [ ] `npm audit` — 0 critical vulnerabilities

### Environment Variables (GCP Secret Manager)

#### Required — App will not start without these
| Variable | Example | Where |
|----------|---------|-------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/bestchoice` | Cloud SQL |
| `JWT_SECRET` | `<random 64 chars>` | Secret Manager |
| `JWT_REFRESH_SECRET` | `<random 64 chars>` | Secret Manager |
| `ENCRYPTION_KEY` | `<random 32 chars>` | Secret Manager |

#### Required — Features broken without these
| Variable | Example | Service |
|----------|---------|---------|
| `SMTP_HOST` | `smtp.resend.com` | Email (password reset, invites) |
| `SMTP_PORT` | `465` | Email |
| `SMTP_USER` | `resend` | Email |
| `SMTP_PASS` | `re_xxxx` | Email (Resend API key) |
| `LINE_CHANNEL_ACCESS_TOKEN` | `<from LINE Dev Console>` | LINE OA |
| `LINE_CHANNEL_SECRET` | `<from LINE Dev Console>` | LINE OA |
| `SMS_API_KEY` | `<from ThaiBulkSMS>` | SMS notifications |
| `SMS_API_SECRET` | `<from ThaiBulkSMS>` | SMS notifications |
| `PAYSOLUTIONS_MERCHANT_ID` | `<from Pay Solutions>` | Payment gateway |
| `PAYSOLUTIONS_SECRET_KEY` | `<from Pay Solutions>` | Payment gateway |
| `PAYSOLUTIONS_WEBHOOK_SECRET` | `<from Pay Solutions>` | Payment webhook |
| `S3_ACCESS_KEY` | `<from S3/MinIO>` | File storage |
| `S3_SECRET_KEY` | `<from S3/MinIO>` | File storage |
| `ANTHROPIC_API_KEY` | `sk-ant-xxxx` | AI credit check + OCR |
| `INTEGRATION_ENCRYPTION_KEY` | `<64 hex chars — openssl rand -hex 32>` | Integration Hub secrets encrypted at rest (API + worker) — see note below |

> **`INTEGRATION_ENCRYPTION_KEY`** — `.github/workflows/deploy-gcp.yml` pins it to **version `:1`**
> (`INTEGRATION_ENCRYPTION_KEY=INTEGRATION_ENCRYPTION_KEY:1`, not `:latest`), so version 1 must be the real key:
> `scripts/setup-gcp-secrets.sh` generates it straight into Secret Manager on a fresh project (never a PLACEHOLDER).
> Exactly 64 hex chars; any other format (base64, 32 hex) counts as **no key** — boot does not fail, but secrets
> saved in the hub are stored unencrypted and encrypted ones read as "not configured".
> **Never print it** (`versions access` only to pipe into a CLI's env — never echo it, never put it on a command line) — check
> versions with `gcloud secrets versions list INTEGRATION_ENCRYPTION_KEY --format='value(name,state)'`.
> Do not just change the pinned number: rotation is the full plan in
> `docs/runbooks/2026-10-31-integration-encryption-key.md`.

#### Optional — Falls back gracefully
| Variable | Default | Notes |
|----------|---------|-------|
| `SENTRY_DSN` | _(disabled)_ | Error monitoring |
| `VITE_SENTRY_DSN` | _(disabled)_ | Frontend error monitoring |
| `VITE_LIFF_ID` | _(empty)_ | LINE LIFF features disabled |
| `NODE_ENV` | `development` | Set to `production` |
| `PORT` | `3000` | API port |

### Infrastructure
- [ ] PostgreSQL 16 — Cloud SQL instance running
- [ ] Database migrations deployed (`npx prisma migrate deploy`)
- [ ] Seed data loaded (if fresh deploy)
- [ ] S3/MinIO bucket created and accessible
- [ ] SSL/HTTPS — Cloud Run provides auto-SSL
- [ ] DNS configured for production domain
- [ ] Backup cron running (daily 02:00, scripts/backup.sh)

### LINE Integration
- [ ] LINE LIFF ID configured (`VITE_LIFF_ID`)
- [ ] LINE webhook URL set to `https://api.yourdomain.com/api/line-oa/webhook`
- [ ] LINE channel verified in LINE Developer Console

### Payment Gateway
- [ ] Pay Solutions merchant account activated
- [ ] Webhook URL set to `https://api.yourdomain.com/api/paysolutions/webhook`
- [ ] Test transaction verified

### Monitoring
- [ ] Sentry project created (API + Web)
- [ ] SENTRY_DSN and VITE_SENTRY_DSN set
- [ ] Alert rules configured (5xx errors, slow transactions)

## Post-Deploy Verification
- [ ] `curl https://api.yourdomain.com/api/health` returns 200
- [ ] Login with admin@bestchoice.com works
- [ ] Dashboard loads with KPI data
- [ ] Create a test contract (wizard completes)
- [ ] Record a test payment
- [ ] LINE LIFF pages load in LINE app
- [ ] SMS test message received
- [ ] Sentry receives test error event
- [ ] Boot log of the new API (and worker) revision shows `integration encrypted fields: key=ok … failed=0`
      (no line = revision got no key; `key=malformed` / `failed>0` → follow
      `docs/runbooks/2026-10-31-integration-encryption-key.md` before entering credentials in the hub)
