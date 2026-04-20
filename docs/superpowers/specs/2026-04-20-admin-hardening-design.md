# Admin Hardening — Design Spec (Plan C: Soft Hide + Strong Auth)

> **Created:** 2026-04-20
> **Status:** APPROVED — ready for implementation planning
> **Predecessor:** docs/superpowers/specs/2026-04-20-online-shop-design.md (mentions admin/shop separation)
> **Related:** Phase 1 PR #605 (online shop foundation)

---

## 1. Problem & Goals

### Problem
Customers visiting BESTCHOICE may discover/access admin interface unintentionally:
1. Customer types `bestchoicephone.app/admin` → sees admin login page
2. Network DevTools reveals `/api/users`, `/api/contracts` endpoints exist
3. Google indexed admin URL → searchable
4. Customer JWT (Phase 1 shop login) might be reusable on admin endpoints

### Goals
**Customers can SEE admin URL exists, can OPEN it, but CANNOT use it.**

Strong authentication wall (no IP block — practical for staff using multiple devices/locations).

### Constraints (driving design)
- ❌ **No IP allowlist** — staff use multiple computers + mobile 4G (dynamic IPs)
- ✅ Staff can login from anywhere (home, branch, mobile, customer site)
- ✅ Customer JWT (shop) cannot access admin endpoints
- ✅ Brute force protection — already partially in place (account lockout v3)
- ✅ Backward compatible — Phase 1 shop work + active Phase 2/3 dev not blocked

---

## 2. Architecture: 7 Defense Layers

```
Layer 1: Subdomain split          (URL hide)
Layer 3: robots.txt + noindex     (search engine hide)
Layer 4: API namespace separation (path hide + edge filter)
Layer 5: JWT scope + audience     (token can't be reused)
Layer 6: Mandatory 2FA            (auth wall)
Layer 7: Login device alert       (intrusion detection)
Layer 8: Login rate limit         (brute force defense — partially exists)
```

(Layer 2 = WAF IP allowlist — **dropped** per constraint.)

### Layer 1: Subdomain split
| Domain | Purpose | Audience |
|--------|---------|----------|
| `shop.bestchoicephone.app` | Public catalog (Phase 1) | Customers |
| `admin.bestchoicephone.app` | Staff admin panel | Staff (login required) |
| `bestchoicephone.app` (root) | 301 redirect → shop subdomain | Anyone typing root URL |

Customers typing `bestchoicephone.app` go to shop. Don't see admin exists at root.

### Layer 3: robots.txt + meta noindex
**On admin app only:**
```html
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
```
**`apps/web/public/robots.txt`:**
```
User-agent: *
Disallow: /
```

Google + Bing + AI crawlers will not index admin URL. Customers can't search and find it.

### Layer 4: API namespace separation
**Refactor existing endpoints:**
| Old | New |
|-----|-----|
| `/api/users` | `/api/admin/users` |
| `/api/customers` | `/api/admin/customers` |
| `/api/contracts` | `/api/admin/contracts` |
| ...50+ endpoints | `/api/admin/*` |
| `/api/shop/*` (already done in Phase 1) | unchanged |
| `/api/chatbot-finance-liff/*` | unchanged (LIFF customer endpoints) |

**Cloudflare path rules:**
- `admin.bestchoicephone.app` → only `/api/admin/*` allowed
- `shop.bestchoicephone.app` → only `/api/shop/*` allowed
- Cross-subdomain = 403 at edge

**Backward compat:** Keep `/api/*` → 301 redirect → `/api/admin/*` for 30 days post-deploy.

### Layer 5: JWT scope + audience
**Current JWT structure:**
```json
{ "sub": "userId", "role": "OWNER", "iat": ..., "exp": ... }
```

**New JWT structure:**
```json
// Admin JWT (staff login)
{ "sub": "userId", "role": "OWNER", "scope": "admin:full", "aud": "admin", ... }

// Shop customer JWT (Phase 1)
{ "sub": "customerId", "scope": "shop:customer", "aud": "shop", ... }
```

**Backend guard:** `JwtAudienceGuard` rejects mismatched `aud` claim.
- Customer logs in to shop → gets `aud: 'shop'` JWT
- Customer tries to call `/api/admin/users` with that JWT → **403** (audience mismatch)

### Layer 6: Mandatory 2FA for admin login
**Implementation:** TOTP (Time-based One-Time Password) — Google Authenticator / Authy / 1Password

**Why TOTP (not SMS/LINE):**
- ✅ Free (no SMS cost — currently SMS_PAYMENT_REMINDER_DISABLED per memory)
- ✅ Works offline (no SMS network needed)
- ✅ Industry standard (used by all banks, Google, etc.)
- ✅ Setup once, use forever (QR code scan)
- ❌ Requires staff to install app

**LINE OTP as fallback:**
- If TOTP device lost → ad-hoc OTP via LINE OA push
- OWNER can reset 2FA for other staff

**Login flow:**
```
1. Staff enters email + password → backend validates
2. If 2FA enabled → backend returns "OTP_REQUIRED" + tempToken (5min)
3. Staff opens authenticator app → enters 6-digit code
4. Backend validates TOTP + tempToken → issues full JWT
5. Login complete
```

**First-time setup:**
1. Staff logs in (no 2FA yet)
2. Backend forces "/setup-2fa" page
3. QR code shown → staff scans with authenticator app
4. Staff enters 6-digit code to confirm
5. Backup codes generated (10 codes, single-use, save somewhere safe)
6. 2FA enabled — required for next login

**Force enroll:** All admin roles (OWNER, BRANCH_MANAGER, FINANCE_MANAGER, SALES, ACCOUNTANT) must enable 2FA on next login.

### Layer 7: Login device alert
**Trigger:** Login successful from device fingerprint not seen in last 30 days.

**Action:**
- LINE OA notification to that staff member: "เข้าสู่ระบบจากอุปกรณ์ใหม่ — เวลา/IP/User-Agent"
- LINE OA notification to OWNER if staff is OWNER role
- Use existing `LoginAuditLog` (T2-C8) + new `device_fingerprint` field

**Device fingerprint:** Hash of (User-Agent + IP /24 subnet + Accept-Language).
Not perfect, but catches "new browser" / "new location" cases.

### Layer 8: Login rate limit + lockout
**Existing (already done in v3 hardening):**
- ✅ Account lockout: 5 failed → 15 min lock
- ✅ `User.failedLoginAttempts` + `lockedUntil` fields

**Add:**
- Sentry alert when single account locked > 3 times in 24 hr (suspicious — potential targeted attack)
- Rate limit per IP for login endpoint: 20 attempts / hour / IP

---

## 3. Data Model Changes

### `User` model extensions (existing)
```prisma
// === 2FA ===
twoFactorSecret     String?   @map("two_factor_secret")     // base32 TOTP secret (encrypted)
twoFactorEnabled    Boolean   @default(false) @map("two_factor_enabled")
twoFactorEnabledAt  DateTime? @map("two_factor_enabled_at")
twoFactorBackupCodes Json?    @map("two_factor_backup_codes") // [{ code: hashed, used: bool, usedAt: DateTime }]
twoFactorRequiredAfter DateTime? @map("two_factor_required_after")  // null = optional, set = mandatory by date
```

### `LoginAuditLog` extension (existing)
```prisma
// Already has: userId, ipAddress, userAgent, action, success, createdAt
// ADD:
deviceFingerprint   String?   @map("device_fingerprint")  // SHA-256(UA + IP/24 + lang)
isNewDevice         Boolean   @default(false) @map("is_new_device")
twoFactorMethod     String?   @map("two_factor_method")   // TOTP, BACKUP_CODE, LINE_OTP
```

### New model: `KnownDevice` (track approved devices per user)
```prisma
model KnownDevice {
  id                String   @id @default(uuid())
  userId            String   @map("user_id")
  user              User     @relation(fields: [userId], references: [id])
  fingerprint       String                                              // SHA-256
  firstSeenAt       DateTime @default(now()) @map("first_seen_at")
  lastSeenAt        DateTime @map("last_seen_at")
  loginCount        Int      @default(1) @map("login_count")
  userAgent         String   @db.Text @map("user_agent")
  ipPrefix          String   @map("ip_prefix")                          // /24 subnet (PDPA-friendly)
  trustedAt         DateTime? @map("trusted_at")                        // user explicitly marked trusted

  @@unique([userId, fingerprint])
  @@index([userId])
  @@index([lastSeenAt])
  @@map("known_devices")
}
```

### `OtpRequest` (for 2FA TOTP setup + recovery)
```prisma
// Or extend existing ChatbotOtpRequest model — TBD during planning
model TwoFactorOtpRequest {
  id           String   @id @default(uuid())
  userId       String   @map("user_id")
  purpose      String                                                    // SETUP, BACKUP_CODE_USE, LOGIN_OTP_FALLBACK
  codeHash     String   @map("code_hash")                                // bcrypt hash
  expiresAt    DateTime @map("expires_at")
  consumedAt   DateTime? @map("consumed_at")
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@index([expiresAt])
  @@map("two_factor_otp_requests")
}
```

---

## 4. Implementation Plan: 3 Batches

### Batch C1: Quick wins (Day 1, 2-4 hours)
**Goal:** Block Google indexing of admin + log new device logins

- robots.txt + meta noindex on admin app
- Add `device_fingerprint` field to `LoginAuditLog` (migration)
- Add device fingerprint generation on every login
- Send LINE OA alert when new device login (use existing `LoginAuditService`)

**Risk:** very low — additive only

### Batch C2: Subdomain + 2FA (Week 1, 2-3 days)
**Goal:** Move admin to dedicated subdomain + enforce 2FA

- DNS setup: `admin.bestchoicephone.app`
- Cloudflare config: routing, cookie domain
- Root domain redirect → `shop.*`
- Backend: 2FA enrollment + login flow (TOTP via `otplib` library)
- Backup codes generation
- Frontend: Setup 2FA wizard + login OTP step
- Comms staff: URL change + 2FA setup instructions
- Soak 3-5 days + force enrollment by date

**Risk:** medium — staff workflow change. Mitigation: staged rollout (announce 1 week, gentle reminder, hard cutover)

### Batch C3: API namespace + JWT scope (Week 2-3, 2-3 days)
**Goal:** Defense in depth — token + path isolation

- Refactor backend: `/api/*` → `/api/admin/*` (50+ controllers)
- Mint JWT with `aud` field
- Add `JwtAudienceGuard`
- Backward compat: `/api/*` → 301 → `/api/admin/*` (30-day grace period)
- Cloudflare path rules: subdomain → namespace mapping
- Frontend: update API base URL in apps/web (admin)
- Test + monitor 1 week
- Drop backward compat redirect

**Risk:** medium-high — touches every admin controller + frontend. Mitigation: phased rollout with backward compat.

---

## 5. Success Metrics

| Metric | Before | Target (after C complete) |
|--------|--------|---------------------------|
| Admin URL Google indexed | Unknown (likely yes) | 0 results in `site:bestchoicephone.app` for admin paths |
| Customer can guess admin URL | Yes (root domain) | No (root → shop redirect) |
| Customer JWT works on admin | Possible (single JWT) | Blocked at audience check (403) |
| Brute force protection | Account lockout 5/15min | Same + Sentry alert + per-IP rate limit |
| Stolen password attack | Account compromised | Blocked by 2FA |
| New device alerts | None | LINE OA push within 1 minute |

---

## 6. Out of Scope (defer to future)

- ❌ WAF IP allowlist (per constraint)
- ❌ Hardware token (YubiKey) support — only TOTP/LINE for v1
- ❌ SSO with Google/LINE for admin (potential v2)
- ❌ Session anomaly detection (geo-impossible travel) — needs IP geolocation infra
- ❌ Risk-based authentication (skip 2FA on trusted device for 30 days) — possible enhancement

---

## 7. Decision Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-04-20 | Drop WAF IP allowlist | Staff use multiple devices + mobile 4G — IP allowlist impractical |
| 2026-04-20 | TOTP as primary 2FA | Free, offline, industry standard. SMS costs + currently disabled per kill switch |
| 2026-04-20 | LINE OTP as 2FA fallback | Recovery option without SMS cost; staff already have LINE |
| 2026-04-20 | Backward compat 30 days for /api/* | Allow Phase 2/3 dev to migrate gracefully |
| 2026-04-20 | Force 2FA enrollment by date (not immediate) | 1-week grace for staff to set up authenticator app |

---

## 8. References

- Phase 1 PR #605 (online shop foundation)
- v3 hardening: account lockout (PR #437)
- T2-C8: LoginAuditLog (PR #542)
- T7-C2: Password reset rate limit (PR #585)
- TOTP RFC 6238
- WCAG considerations: 2FA accessibility (BACKUP_CODE option for visually impaired staff)
