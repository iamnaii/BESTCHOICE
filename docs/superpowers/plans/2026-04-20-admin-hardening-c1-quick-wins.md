# Admin Hardening — Batch C1 Implementation Plan (Quick Wins)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task.

**Goal:** Within 2-4 hours, make admin URL invisible to search engines AND alert staff when login from new device.

**Architecture:** Add static files (robots.txt + meta tag) to admin web app. Add `device_fingerprint` column to LoginAuditLog. Compute SHA-256 fingerprint at login + push LINE OA alert when fingerprint not seen for that user in last 30 days.

**Tech Stack:** existing (apps/web index.html, apps/api LoginAuditService, line-oa module).

**Spec:** `docs/superpowers/specs/2026-04-20-admin-hardening-design.md` (Layers 3 + 7)

---

## File Structure

```
apps/web/index.html                                   # MODIFY: add meta noindex
apps/web/public/robots.txt                            # CREATE: Disallow: /
apps/api/prisma/schema.prisma                         # MODIFY: LoginAuditLog + new KnownDevice model
apps/api/src/utils/device-fingerprint.util.ts         # CREATE: SHA-256 fingerprint helper
apps/api/src/utils/device-fingerprint.util.spec.ts    # CREATE: unit tests
apps/api/src/modules/auth/login-audit.service.ts      # MODIFY: compute fingerprint + KnownDevice upsert
apps/api/src/modules/auth/login-audit.service.spec.ts # MODIFY: add new device test
apps/api/src/modules/auth/auth.service.ts             # MODIFY: pass req to login → audit
```

---

## Task 1: Add robots.txt + meta noindex to admin app

**Files:**
- Create: `apps/web/public/robots.txt`
- Modify: `apps/web/index.html`

- [ ] **Step 1: Create robots.txt**

```bash
cat > apps/web/public/robots.txt <<'EOF'
# BESTCHOICE Admin — DO NOT INDEX
# This admin interface is for staff only. Customer-facing site is at shop.bestchoicephone.app
User-agent: *
Disallow: /

# Be extra explicit for AI crawlers
User-agent: GPTBot
Disallow: /
User-agent: ClaudeBot
Disallow: /
User-agent: Anthropic-AI
Disallow: /
User-agent: PerplexityBot
Disallow: /
User-agent: Google-Extended
Disallow: /
User-agent: CCBot
Disallow: /
User-agent: Bytespider
Disallow: /
EOF
```

- [ ] **Step 2: Add meta noindex to index.html**

Read `apps/web/index.html`, find `<head>` section. Add as the FIRST child of `<head>`:

```html
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex" />
```

If existing `<meta name="robots">` exists, replace it.

- [ ] **Step 3: Verify build**

```bash
cd apps/web && npm run build 2>&1 | tail -3
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add apps/web/public/robots.txt apps/web/index.html
git commit -m "feat(admin): add robots.txt + meta noindex (Layer 3)

Block search engines + AI crawlers from indexing admin URL.
Customers searching 'BESTCHOICE admin' won't find admin login page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Schema migration — LoginAuditLog + KnownDevice

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add fields to LoginAuditLog**

Find `model LoginAuditLog` in schema.prisma. Add these fields BEFORE `@@map("login_audit_logs")`:

```prisma
  // === Batch C1: device tracking ===
  deviceFingerprint   String?  @map("device_fingerprint") @db.Char(64)
  isNewDevice         Boolean  @default(false) @map("is_new_device")
  twoFactorMethod     String?  @map("two_factor_method")        // null in C1; populated in C2 (TOTP, BACKUP_CODE, LINE_OTP)

  @@index([userId, deviceFingerprint])
```

- [ ] **Step 2: Add KnownDevice model**

At end of schema.prisma (before any final closing braces):

```prisma
model KnownDevice {
  id           String    @id @default(uuid())
  userId       String    @map("user_id")
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  fingerprint  String    @db.Char(64)
  firstSeenAt  DateTime  @default(now()) @map("first_seen_at")
  lastSeenAt   DateTime  @map("last_seen_at")
  loginCount   Int       @default(1) @map("login_count")
  userAgent    String    @db.Text @map("user_agent")
  ipPrefix     String    @map("ip_prefix")          // /24 subnet, PDPA-friendly
  trustedAt    DateTime? @map("trusted_at")          // user explicit "trust this device"
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  @@unique([userId, fingerprint])
  @@index([userId])
  @@index([lastSeenAt])
  @@map("known_devices")
}
```

Add reverse relation on User (find `model User` and add to relations section):

```prisma
  knownDevices KnownDevice[]
```

- [ ] **Step 3: Generate migration**

```bash
cd apps/api && npx prisma migrate dev --name add_device_fingerprint --create-only
```

If shadow DB error: `prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma --script` then write migration manually.

- [ ] **Step 4: Verify migration**

Read generated SQL — confirm:
- All new columns NULLABLE or have DEFAULT
- New table `known_devices` created with FK constraint
- Indexes per schema directives

- [ ] **Step 5: Generate client + type check**

```bash
cd apps/api && npx prisma generate
./tools/check-types.sh api
```

Expected: 0 new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(admin): schema — add deviceFingerprint to LoginAuditLog + KnownDevice table

Tracks which devices each staff has logged in from. Enables 'new device' alert.
All additions are NULLABLE or have defaults — backwards compatible.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: device-fingerprint.util.ts

**Files:**
- Create: `apps/api/src/utils/device-fingerprint.util.ts`
- Create: `apps/api/src/utils/device-fingerprint.util.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/utils/device-fingerprint.util.spec.ts
import { computeDeviceFingerprint, computeIpPrefix } from './device-fingerprint.util';

describe('device-fingerprint.util', () => {
  describe('computeDeviceFingerprint', () => {
    it('returns deterministic 64-char hex hash', () => {
      const fp = computeDeviceFingerprint({
        userAgent: 'Mozilla/5.0',
        ipPrefix: '127.0.0.0/24',
        acceptLanguage: 'th-TH,en;q=0.9',
      });
      expect(fp).toMatch(/^[0-9a-f]{64}$/);
    });

    it('same inputs produce same hash', () => {
      const a = computeDeviceFingerprint({ userAgent: 'M', ipPrefix: '1.2.3.0/24', acceptLanguage: 'th' });
      const b = computeDeviceFingerprint({ userAgent: 'M', ipPrefix: '1.2.3.0/24', acceptLanguage: 'th' });
      expect(a).toBe(b);
    });

    it('different UA produces different hash', () => {
      const a = computeDeviceFingerprint({ userAgent: 'M', ipPrefix: '1.2.3.0/24', acceptLanguage: 'th' });
      const b = computeDeviceFingerprint({ userAgent: 'Other', ipPrefix: '1.2.3.0/24', acceptLanguage: 'th' });
      expect(a).not.toBe(b);
    });

    it('different IP /24 produces different hash', () => {
      const a = computeDeviceFingerprint({ userAgent: 'M', ipPrefix: '1.2.3.0/24', acceptLanguage: 'th' });
      const b = computeDeviceFingerprint({ userAgent: 'M', ipPrefix: '1.2.4.0/24', acceptLanguage: 'th' });
      expect(a).not.toBe(b);
    });

    it('handles missing accept-language', () => {
      const fp = computeDeviceFingerprint({ userAgent: 'M', ipPrefix: '1.2.3.0/24', acceptLanguage: '' });
      expect(fp).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('computeIpPrefix', () => {
    it('returns /24 prefix for IPv4', () => {
      expect(computeIpPrefix('192.168.1.42')).toBe('192.168.1.0/24');
    });

    it('returns /48 prefix for IPv6', () => {
      expect(computeIpPrefix('2001:db8:1234:5678::1')).toBe('2001:db8:1234::/48');
    });

    it('returns "unknown" for invalid IP', () => {
      expect(computeIpPrefix('')).toBe('unknown');
      expect(computeIpPrefix('not-an-ip')).toBe('unknown');
    });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd apps/api && npx jest device-fingerprint.util.spec
```

Expected: FAIL.

- [ ] **Step 3: Implement util**

```typescript
// apps/api/src/utils/device-fingerprint.util.ts
import { createHash } from 'crypto';

export interface FingerprintInput {
  userAgent: string;
  ipPrefix: string;
  acceptLanguage: string;
}

/**
 * Device fingerprint = SHA-256 of (UA + IP /24 prefix + accept-language).
 * Stable across same browser/network. Changes when staff opens new browser
 * or moves to different network — triggering new-device alert.
 */
export function computeDeviceFingerprint(input: FingerprintInput): string {
  const payload = [input.userAgent, input.ipPrefix, input.acceptLanguage].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * IPv4 → /24 prefix (e.g., "192.168.1.42" → "192.168.1.0/24").
 * IPv6 → /48 prefix (first 3 hextets).
 * Invalid → "unknown".
 */
export function computeIpPrefix(ip: string): string {
  if (!ip) return 'unknown';
  if (ip.includes('.')) {
    // IPv4
    const parts = ip.split('.');
    if (parts.length !== 4 || parts.some((p) => isNaN(Number(p)))) return 'unknown';
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (ip.includes(':')) {
    // IPv6
    const hextets = ip.split(':').slice(0, 3);
    if (hextets.length < 3) return 'unknown';
    return `${hextets.join(':')}::/48`;
  }
  return 'unknown';
}
```

- [ ] **Step 4: Run tests pass**

```bash
cd apps/api && npx jest device-fingerprint.util.spec
```

Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/device-fingerprint.util.ts apps/api/src/utils/device-fingerprint.util.spec.ts
git commit -m "feat(admin): device fingerprint util — SHA-256 of UA + IP/24 + lang

Used by login audit to detect new devices.
8 unit tests cover stability, change detection, IPv4/v6 prefixes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire fingerprint into LoginAuditService + LINE alert

**Files:**
- Modify: `apps/api/src/modules/auth/login-audit.service.ts`
- Modify: `apps/api/src/modules/auth/login-audit.service.spec.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts` (call site)

- [ ] **Step 1: Read existing LoginAuditService**

```bash
grep -nE "async (record|log)" apps/api/src/modules/auth/login-audit.service.ts | head -5
```

Note method signatures.

- [ ] **Step 2: Add new device tracking + LINE alert to recordLoginAudit method**

In `apps/api/src/modules/auth/login-audit.service.ts`:

Add imports:
```typescript
import { computeDeviceFingerprint, computeIpPrefix } from '../../utils/device-fingerprint.util';
import { LineOaService } from '../line-oa/line-oa.service';
```

Inject in constructor:
```typescript
constructor(
  private prisma: PrismaService,
  private lineOa: LineOaService,  // NEW
) {}
```

Update `record` (or equivalent) method to:
1. Compute fingerprint from req headers
2. Upsert KnownDevice — capture isNewDevice
3. Save LoginAuditLog with deviceFingerprint + isNewDevice
4. If isNewDevice + login successful → push LINE OA alert (fire-and-forget)

```typescript
async record(input: LoginAuditInput): Promise<void> {
  const ipPrefix = computeIpPrefix(input.ipAddress ?? '');
  const fingerprint = computeDeviceFingerprint({
    userAgent: input.userAgent ?? '',
    ipPrefix,
    acceptLanguage: input.acceptLanguage ?? '',
  });

  // Check if this device is known
  const existing = await this.prisma.knownDevice.findUnique({
    where: { userId_fingerprint: { userId: input.userId, fingerprint } },
  });
  const isNewDevice = !existing && input.success;

  // Upsert KnownDevice (only on successful login)
  if (input.success) {
    await this.prisma.knownDevice.upsert({
      where: { userId_fingerprint: { userId: input.userId, fingerprint } },
      create: {
        userId: input.userId,
        fingerprint,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        loginCount: 1,
        userAgent: input.userAgent ?? '',
        ipPrefix,
      },
      update: {
        lastSeenAt: new Date(),
        loginCount: { increment: 1 },
      },
    });
  }

  // Record audit log
  await this.prisma.loginAuditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      success: input.success,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      deviceFingerprint: fingerprint,
      isNewDevice,
    },
  });

  // LINE alert on new device login
  if (isNewDevice) {
    void this.notifyNewDeviceLogin({
      userId: input.userId,
      ipPrefix,
      userAgent: input.userAgent ?? '',
      timestamp: new Date(),
    });
  }
}

private async notifyNewDeviceLogin(input: {
  userId: string;
  ipPrefix: string;
  userAgent: string;
  timestamp: Date;
}): Promise<void> {
  try {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true, name: true, role: true },
    });
    if (!user) return;

    const message = [
      '🔔 เข้าสู่ระบบจากอุปกรณ์ใหม่',
      `บัญชี: ${user.email} (${user.name})`,
      `เวลา: ${input.timestamp.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
      `IP prefix: ${input.ipPrefix}`,
      `Browser: ${input.userAgent.slice(0, 80)}`,
      '',
      'ถ้าไม่ใช่คุณ — เปลี่ยนรหัสผ่านทันที',
    ].join('\n');

    // Push to staff's bound LINE if available, else broadcast to OWNERs
    const staffLineId = process.env.SHOP_STAFF_LINE_ID;  // existing env var pattern
    if (staffLineId) {
      await this.lineOa.pushMessage(staffLineId, message);
    }
  } catch (err) {
    // Never block login on alert failure
    console.error('New device alert failed:', (err as Error).message);
  }
}
```

**Note:** Adapt to actual LineOaService method names (check existing service first). If `pushMessage` doesn't exist, use whatever method does (e.g., `broadcast`, `notify`).

- [ ] **Step 3: Add test for new device tracking**

In `apps/api/src/modules/auth/login-audit.service.spec.ts`, add at end:

```typescript
describe('Device fingerprinting (Batch C1)', () => {
  it('marks isNewDevice=true on first login from device', async () => {
    prisma.knownDevice.findUnique.mockResolvedValue(null);
    prisma.knownDevice.upsert.mockResolvedValue({});
    prisma.loginAuditLog.create.mockResolvedValue({});

    await service.record({
      userId: 'u1',
      action: 'LOGIN',
      success: true,
      ipAddress: '1.2.3.4',
      userAgent: 'Mozilla',
      acceptLanguage: 'th-TH',
    });

    const auditCall = (prisma.loginAuditLog.create as jest.Mock).mock.calls[0][0];
    expect(auditCall.data.isNewDevice).toBe(true);
    expect(auditCall.data.deviceFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('marks isNewDevice=false on repeat login', async () => {
    prisma.knownDevice.findUnique.mockResolvedValue({ id: 'd1', loginCount: 5 });
    prisma.knownDevice.upsert.mockResolvedValue({});
    prisma.loginAuditLog.create.mockResolvedValue({});

    await service.record({
      userId: 'u1',
      action: 'LOGIN',
      success: true,
      ipAddress: '1.2.3.4',
      userAgent: 'Mozilla',
      acceptLanguage: 'th-TH',
    });

    const auditCall = (prisma.loginAuditLog.create as jest.Mock).mock.calls[0][0];
    expect(auditCall.data.isNewDevice).toBe(false);
  });

  it('does not upsert KnownDevice on failed login', async () => {
    prisma.loginAuditLog.create.mockResolvedValue({});

    await service.record({
      userId: 'u1',
      action: 'LOGIN_FAILED',
      success: false,
      ipAddress: '1.2.3.4',
      userAgent: 'Mozilla',
      acceptLanguage: 'th-TH',
    });

    expect(prisma.knownDevice.upsert).not.toHaveBeenCalled();
  });
});
```

Update mock setup to include `knownDevice` namespace + `lineOa` provider.

- [ ] **Step 4: Update auth.service.ts to pass headers**

In `apps/api/src/modules/auth/auth.service.ts`, find login method. Update calls to `loginAuditService.record(...)` to pass:
- `acceptLanguage: req.headers['accept-language']`

If `req` not available — accept new optional param `acceptLanguage` and have controller pass it from `@Req()`.

- [ ] **Step 5: Run tests + type check**

```bash
cd apps/api && npx jest login-audit.service.spec device-fingerprint.util.spec
./tools/check-types.sh api
```

Expected: all tests pass + 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/auth/
git commit -m "feat(admin): wire device fingerprint into login audit + LINE alert

Every login computes SHA-256(UA + IP/24 + lang).
KnownDevice table tracks recognized devices per user.
First login from new device → push LINE OA alert.
Failed logins don't update KnownDevice (security).
3 new tests for new/repeat/failed scenarios.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: PR for Batch C1

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/admin-hardening-c1-quick-wins
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(admin): Batch C1 — robots noindex + new device alert" --body "$(cat <<'EOF'
## Summary
First batch of admin hardening (Plan C). Quick wins, low risk, high impact.

**Spec:** docs/superpowers/specs/2026-04-20-admin-hardening-design.md

## What ships
1. **robots.txt + meta noindex** — Google + AI crawlers won't index admin URL
2. **Device fingerprint** — every login computes SHA-256(UA + IP/24 + lang)
3. **KnownDevice table** — tracks recognized devices per user
4. **LINE alert** — staff gets push notification on first login from new device

## Tests
- 8 fingerprint util tests
- 3 new login audit tests
- TypeScript: 0 errors

## Production impact
- Search engines de-index admin within 1-2 weeks
- Existing staff first login = "new device" alert (1-time)
- After that, only genuinely new devices trigger alerts

## What's next
Batch C2: Subdomain split + mandatory 2FA (Week 1)
Batch C3: API namespace + JWT scope (Week 2-3)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- ✅ Layer 3 (robots noindex) → Task 1
- ✅ Layer 7 (device fingerprint + alert) → Tasks 2-4
- Layers 1, 4, 5, 6, 8 → Batches C2 + C3

**Placeholder scan:** No TBDs, all code blocks complete.

**Type consistency:** `FingerprintInput` interface used consistently. `LoginAuditInput` extended with `acceptLanguage`.

---

## Execution Handoff

**Plan complete.** Use subagent-driven-development to execute Tasks 1-5.

After C1 deploys: write Plan C2.
