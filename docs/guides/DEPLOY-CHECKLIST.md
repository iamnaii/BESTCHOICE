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
