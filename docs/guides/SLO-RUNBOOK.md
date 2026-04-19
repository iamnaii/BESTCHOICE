# SLO Runbook (T7-C12)

## Overview
BESTCHOICE เปิด `/api/metrics` endpoint สำหรับ Prometheus scrape. Setup guide + target SLOs ด้านล่าง.

## Endpoint

```
GET https://api.bestchoicephone.app/api/metrics
Headers:
  X-Metrics-Token: $METRICS_SCRAPE_TOKEN
```

- **Env required**: `METRICS_SCRAPE_TOKEN` (long random string, stored in Secret Manager)
- **Env optional**: `METRICS_SCRAPE_TOKEN_PREVIOUS` — used during zero-downtime rotation (T7-C9)
- Without `METRICS_SCRAPE_TOKEN` → 503 (fails closed)
- Wrong token → 403
- Token compare uses `timingSafeEqual` (constant-time, resistant to timing attacks)
- SkipThrottle (Prometheus scrape every 15s doesn't trip global rate limit)

### Zero-downtime token rotation (T7-C9)

```
1. Generate new token N. Set METRICS_SCRAPE_TOKEN_PREVIOUS = current_token.
2. Set METRICS_SCRAPE_TOKEN = N. Deploy.
   Both old and new tokens are now accepted; requests matching PREVIOUS
   emit a WARN log ("rotate the caller to the new token…").
3. Update scrapers (Prometheus / Grafana Cloud / uptime check) to send N.
4. Watch logs for 24h. Once WARN stops firing, unset
   METRICS_SCRAPE_TOKEN_PREVIOUS and redeploy.
```

## Target SLOs

### Availability
| SLI | Target | Measurement |
|-----|--------|-------------|
| **API success rate** | 99.5% | 2xx+3xx / total, 7-day rolling |
| **Health endpoint uptime** | 99.9% | `/api/health` 2xx, 30-day rolling |
| **Deploy success rate** | 95% | GitHub Actions Deploy workflow conclusion, 30-day |

### Latency
| SLI | Target | Measurement |
|-----|--------|-------------|
| **p95 HTTP latency** | < 500ms | `http_request_duration_seconds` p95 per route |
| **p99 HTTP latency** | < 2s | same, p99 |
| **DB query p95** | < 200ms | (future — requires Prisma telemetry) |

### Business correctness
| SLI | Target | Measurement |
|-----|--------|-------------|
| **Payment recording success** | 99% | `payments_recorded_total{status="success"}` / total |
| **Refund approval lag** | p95 < 24h | (future — compute from AuditLog timestamps) |
| **Slip SLA (T4-C9)** | < 10 breaches/day | `data_audit_sla` cron output |
| **Receivable recon breach** | < 1 branch/day | `receivable_recon_logs` where breached=true |

## Counters exposed

Current (as of this commit):

| Metric | Labels | Purpose |
|--------|--------|---------|
| `http_request_duration_seconds` | method, route, status_code | Latency histogram |
| `payments_recorded_total` | method, status | Payment ingestion success |
| `refunds_requested_total` | status | Refund funnel |
| `slip_auto_approved_total` | — | Auto-approve coverage |
| `dunning_escalated_total` | stage, source | Collections pipeline |
| `ai_calls_total` | service, status | AI cost/volume tracking |
| `webhook_anomalies_total` | provider, reason | Security signal |

Plus Node defaults (event loop lag, memory, GC).

## Setup — Prometheus scraping

### Cloud Monitoring (simplest)
GCP Cloud Monitoring supports Prometheus-format scraping via "Managed Prometheus":

1. Enable Managed Service for Prometheus on the GKE/GCE cluster (or use cloudrun+sidecar pattern)
2. Add scrape config:
   ```yaml
   scrape_configs:
     - job_name: bestchoice-api
       scrape_interval: 30s
       metrics_path: /api/metrics
       scheme: https
       static_configs:
         - targets: ['api.bestchoicephone.app:443']
       bearer_token_file: /var/run/secrets/metrics-token
   ```

### Self-hosted Prometheus + Grafana
1. Deploy Prometheus container to a small VM (e1-micro works)
2. Same scrape config as above
3. Connect Grafana → Prometheus data source
4. Import dashboard (see next section)

## Grafana dashboard (initial)

Panels to create:
1. **Request rate** — `sum(rate(http_request_duration_seconds_count[5m])) by (route)`
2. **Error rate %** — `sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[5m])) / sum(rate(http_request_duration_seconds_count[5m])) * 100`
3. **p95/p99 latency** — `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))`
4. **Payments recorded/hr** — `sum(rate(payments_recorded_total[1h])) * 3600`
5. **Refund funnel** — stacked by `status` label
6. **Webhook anomalies** — table grouped by `provider, reason`
7. **AI spend proxy** — `ai_calls_total` × known cost per call
8. **Event loop lag** — `nodejs_eventloop_lag_seconds` (alert if >100ms)

Save JSON to `docs/grafana/bestchoice-slo.json` once finalized.

## Alerting rules

```yaml
groups:
  - name: bestchoice-api
    rules:
      - alert: HighErrorRate
        expr: sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[5m])) / sum(rate(http_request_duration_seconds_count[5m])) > 0.01
        for: 5m
        annotations:
          summary: "API error rate > 1% for 5 min"

      - alert: SlowP95
        expr: histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le)) > 0.5
        for: 10m
        annotations:
          summary: "API p95 latency > 500ms for 10 min"

      - alert: EventLoopStalled
        expr: nodejs_eventloop_lag_seconds > 0.1
        for: 2m
        annotations:
          summary: "Node event loop lag > 100ms"

      - alert: WebhookAnomalySpike
        expr: increase(webhook_anomalies_total[1h]) > 10
        annotations:
          summary: "Webhook anomalies > 10 in last hour — see WebhookAnomalyCron"
```

## Instrumentation guidelines

### ✅ Good metric additions
- Business events with a clear SLO target (waiver per hour, slip SLA)
- Error categories that would page the on-call
- Cost-driving signals (AI token count, SMS sends)

### ❌ Bad metric additions
- Debugging counters with no threshold
- High-cardinality labels (userId, contractId — will explode storage)
- Anything already captured in AuditLog (duplication)

New counter additions: always attach an SLO/alert rule, or skip.

## Cost estimate

- Self-hosted Prometheus on `e1-micro`: ~฿100/month
- Grafana Cloud free tier: 10k series, 50GB logs, 3 users — free
- Managed Prometheus on GCP: $0.25/million samples ingested → BESTCHOICE @ 50 series × 15s → ~$1-2/mo

## Rollback

ถ้า `/metrics` ทำงานผิดปกติ:
1. Set `METRICS_SCRAPE_TOKEN=` (empty) → endpoint returns 503 ไม่ครรลูก
2. ลบ `MetricsModule` จาก `app.module.ts` → endpoint หายไป
3. Deploy

Prometheus scraper จะ timeout → alert ที่ Grafana แต่ api ยังทำงานปกติ

## Emergency contacts
| Role | Contact |
|------|---------|
| GCP owner | เจ้าของ (พี่นาย) |
| Prometheus docs | https://prometheus.io/docs/ |
| prom-client docs | https://github.com/siimon/prom-client |
