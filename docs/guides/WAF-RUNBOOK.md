# Cloud Armor WAF Runbook (T7-C8)

## Overview
BESTCHOICE API อยู่บน Cloud Run with `--allow-unauthenticated` (ต้องเป็น public เพื่อรับ webhook จาก LINE/PaySolutions/SMS). ป้องกันระดับ network = Cloud Armor edge policy ต้องเปิดใช้.

ปัจจุบัน (pre-T7-C8): ไม่มี Cloud Armor — defense in depth เหลือแต่ app-level auth + NestJS rate limiter. DDoS / credential stuffing / geo-probe เข้าถึง app ได้ตรง.

## Target policy

### Rate limits
| Path | Unauth limit | Auth limit | Action |
|------|--------------|------------|--------|
| `/api/auth/login` | 30/min per IP | — | throttle 429 |
| `/api/auth/login/2fa` | 15/min per IP | — | throttle 429 |
| `/api/paysolutions/webhook` | 120/min per IP | — | throttle 429 |
| `/api/line-oa/webhook` | 300/min per IP | — | throttle 429 |
| `/api/*` (catchall) | 300/min per IP | 1200/min per user | throttle 429 |

### Geo restrictions
- Allow: Thailand (TH) + บริษัท VPN egress IPs
- Block + alert: China (CN), Russia (RU), North Korea (KP)
- Log only: everywhere else — collect 30 days data, decide if need broader block

### Bot detection
- reCAPTCHA integration บน `/api/auth/login` (score < 0.3 = block)
- Known bot headers (scrapers) → block
- Missing `Accept-Language` header on `/api/auth/*` → challenge

## Setup checklist

1. **GCP Console → Security → Cloud Armor**
   - Create security policy `bestchoice-api-edge`
   - Adaptive protection: layer 7 DDoS enabled
   - Log sampling: 100% (log everything เริ่มต้น 30 วัน แล้วลดลง 10%)

2. **Attach to backend**
   - `gcloud compute backend-services update bestchoice-api-backend \
       --security-policy=bestchoice-api-edge`

3. **Rules priority order** (ต่ำ = เลือกก่อน)
   ```
   1000 - allowlist (internal IPs) → allow
   2000 - denylist (known bad IPs) → deny(403)
   3000 - geo restrictions → deny(403)
   4000 - rate limits per path → throttle
   5000 - bot detection → challenge
   9000 - default → allow
   ```

4. **Logging → BigQuery**
   - Export `compute.googleapis.com/security_policy_blocks` → `bestchoice-ops.waf_logs`
   - Dashboard ใน Grafana/Metabase: top blocked IPs, top rate-limited paths

## Monitoring

### Alerts (Sentry / PagerDuty)
- > 1000 blocks/hour per IP → page on-call
- > 100 rate-limit hits/hour on auth endpoints → Sentry warning
- Geo-block spike > 50/hour → Sentry info

### Daily review (manual 5 min)
- GCP Console → Cloud Armor → Policy → Logs
- Look for: new blocked IP ranges, unusual path patterns, 429 spike

## Incident playbook

### Suspected DDoS (429 rate > 10k/min)
1. Enable Adaptive Protection response action (if not already)
2. Manually add `block-all-non-TH` rule priority 500 (temporary)
3. Notify customer via LINE OA broadcast: "ระบบรัก busy ขอเวลา 10-30 นาที"
4. Post-incident: review blocked ranges, update denylist permanently

### Legitimate customer blocked
1. Customer contacts sales with 403 error
2. Get their IP (send `curl ifconfig.me`)
3. Check logs → confirm geo or rate-limit block
4. Temporary allowlist entry priority 900
5. If recurring: review geo policy

## Cost estimate
- Cloud Armor standard: $5/month fixed + $1/policy/month × rules (~15 rules = $15)
- Adaptive Protection: $1/million requests evaluated
- Expected BESTCHOICE volume: 2-5M req/mo → ~$25-45/mo total

## Rollback
ถ้า WAF block legit traffic มากเกินไป:
```
gcloud compute backend-services update bestchoice-api-backend \
    --no-security-policy
```
แล้ว debug logs หาว่า rule ไหน match → แก้ rule แล้ว re-attach

## Emergency Contacts
| Role | Contact |
|------|---------|
| GCP owner | เจ้าของ (พี่นาย) |
| Cloud Armor docs | https://cloud.google.com/armor/docs |
| Related: rate limit at app-level | `apps/api/src/guards/user-throttler.guard.ts` |
