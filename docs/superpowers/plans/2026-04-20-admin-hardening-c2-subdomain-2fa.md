# Admin Hardening — Batch C2 Implementation Plan (Subdomain + 2FA)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Move admin to `admin.bestchoicephone.app` (root → shop redirect) and enforce TOTP 2FA for all staff.

**Architecture:** DNS subdomain + Cloudflare routing for admin app. Add 2FA fields to User model. Add TOTP setup wizard + login OTP step using `otplib` library. LINE OTP fallback for recovery.

**Tech Stack:** existing + `otplib` (TOTP), `qrcode` (QR generation for setup).

**Spec:** `docs/superpowers/specs/2026-04-20-admin-hardening-design.md` (Layers 1 + 6)

**Predecessor:** Batch C1 deployed (device fingerprint + LINE alert)

---

## File Structure

```
# DNS / Infrastructure (owner action)
DNS:                    CNAME admin.bestchoicephone.app → Firebase
Cloudflare:             routing + cookie domain config
Firebase:               admin app deploys to admin subdomain
Cloud Run main.ts:      add admin subdomain to CORS + cookie domain

# Backend
apps/api/prisma/schema.prisma                              # User.twoFactor* fields + TwoFactorOtpRequest
apps/api/src/modules/two-factor/                           # NEW MODULE
├── two-factor.module.ts
├── two-factor.controller.ts                                # POST /enroll, /verify, /disable, /backup-codes/regenerate
├── two-factor.service.ts                                   # TOTP gen/verify, backup codes
├── two-factor.service.spec.ts
└── dto/
    ├── enroll-2fa.dto.ts
    ├── verify-2fa.dto.ts
    └── login-2fa.dto.ts
apps/api/src/modules/auth/auth.service.ts                  # MODIFY: 2-step login
apps/api/src/modules/auth/auth.controller.ts               # MODIFY: handle OTP_REQUIRED response
apps/api/src/utils/totp.util.ts                            # NEW: otplib wrapper

# Frontend (apps/web)
apps/web/src/pages/SetupTwoFactorPage.tsx                  # NEW: TOTP enrollment wizard
apps/web/src/pages/LoginPage.tsx                           # MODIFY: 2-step (password → OTP)
apps/web/src/components/TotpInput.tsx                      # NEW: 6-digit OTP input
apps/web/src/contexts/AuthContext.tsx                      # MODIFY: handle OTP_REQUIRED state
apps/web/src/components/BackupCodesDisplay.tsx             # NEW: show + download backup codes
```

---

## OWNER ACTION ITEMS (must do BEFORE Task 1)

| # | Action | Notes |
|---|--------|-------|
| 1 | Configure DNS: `admin.bestchoicephone.app` CNAME → Firebase Hosting | Cloudflare → DNS tab |
| 2 | Firebase: add admin subdomain to hosting target | `firebase hosting:sites:create admin-bestchoice` |
| 3 | Update deploy-gcp.yml: add Firebase deploy target for admin app | (or skip if same target) |
| 4 | Cloudflare Page Rule: `admin.bestchoicephone.app` → cookie domain `.bestchoicephone.app` | enables shared cookies |

These can run in parallel with backend work but MUST complete before C2 deploy.

---

## Task 1: Schema migration — User 2FA fields + TwoFactorOtpRequest

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add User 2FA fields**

In `model User`, add BEFORE `@@map("users")`:

```prisma
  // === Batch C2: 2FA ===
  twoFactorSecret           String?    @map("two_factor_secret") @db.Text  // base32 TOTP secret (encrypted at rest via crypto.util)
  twoFactorEnabled          Boolean    @default(false) @map("two_factor_enabled")
  twoFactorEnabledAt        DateTime?  @map("two_factor_enabled_at")
  twoFactorBackupCodes      Json?      @map("two_factor_backup_codes")     // [{ codeHash, used, usedAt }]
  twoFactorRequiredAfter    DateTime?  @map("two_factor_required_after")    // null = optional, set = mandatory by date
  twoFactorOtpRequests      TwoFactorOtpRequest[]
```

- [ ] **Step 2: Add TwoFactorOtpRequest model**

```prisma
model TwoFactorOtpRequest {
  id           String    @id @default(uuid())
  userId       String    @map("user_id")
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  purpose      String                                                       // SETUP, BACKUP_CODE_USE, LOGIN_OTP_FALLBACK
  codeHash     String    @map("code_hash")                                  // bcrypt
  expiresAt    DateTime  @map("expires_at")
  consumedAt   DateTime? @map("consumed_at")
  createdAt    DateTime  @default(now()) @map("created_at")

  @@index([userId])
  @@index([expiresAt])
  @@map("two_factor_otp_requests")
}
```

- [ ] **Step 3: Generate migration + verify + commit**

```bash
cd apps/api && npx prisma migrate dev --name add_two_factor --create-only
# Verify SQL: nullable on User additions, new table created
npx prisma generate
./tools/check-types.sh api
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(admin): schema — User 2FA fields + TwoFactorOtpRequest table

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: TOTP utility

**Files:**
- Create: `apps/api/src/utils/totp.util.ts`
- Create: `apps/api/src/utils/totp.util.spec.ts`

**Install:** `npm install otplib qrcode --workspace=apps/api`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/utils/totp.util.spec.ts
import { generateTotpSecret, verifyTotp, generateOtpAuthUrl, generateBackupCodes, hashBackupCode, verifyBackupCode } from './totp.util';
import { authenticator } from 'otplib';

describe('totp.util', () => {
  describe('generateTotpSecret', () => {
    it('returns base32 secret', () => {
      const secret = generateTotpSecret();
      expect(secret).toMatch(/^[A-Z2-7]+=*$/);
      expect(secret.length).toBeGreaterThan(15);
    });
  });

  describe('verifyTotp', () => {
    it('verifies current TOTP code', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const token = authenticator.generate(secret);
      expect(verifyTotp(token, secret)).toBe(true);
    });

    it('rejects wrong code', () => {
      expect(verifyTotp('000000', 'JBSWY3DPEHPK3PXP')).toBe(false);
    });
  });

  describe('generateOtpAuthUrl', () => {
    it('returns otpauth URL with issuer + label', () => {
      const url = generateOtpAuthUrl({ secret: 'JBSWY3DPEHPK3PXP', label: 'admin@bestchoice.com' });
      expect(url).toContain('otpauth://totp/');
      expect(url).toContain('BESTCHOICE');
      expect(url).toContain('admin%40bestchoice.com');
    });
  });

  describe('backup codes', () => {
    it('generates 10 unique codes', () => {
      const codes = generateBackupCodes(10);
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      codes.forEach((c) => expect(c).toMatch(/^[A-Z0-9]{8}$/));
    });

    it('hashes + verifies backup code', async () => {
      const code = 'ABCD1234';
      const hash = await hashBackupCode(code);
      expect(await verifyBackupCode(code, hash)).toBe(true);
      expect(await verifyBackupCode('WRONG', hash)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Implement util**

```typescript
// apps/api/src/utils/totp.util.ts
import { authenticator } from 'otplib';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

authenticator.options = { window: 1 };  // allow ±30 seconds drift

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

export function generateOtpAuthUrl(input: { secret: string; label: string }): string {
  return authenticator.keyuri(input.label, 'BESTCHOICE', input.secret);
}

export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  while (codes.length < count) {
    const code = randomBytes(4).toString('hex').toUpperCase();
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

const SCRYPT_N = 16384;

export async function hashBackupCode(code: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(code, salt, 64, { N: SCRYPT_N }).toString('hex');
  return `${salt}:${hash}`;
}

export async function verifyBackupCode(code: string, stored: string): Promise<boolean> {
  const [salt, expectedHash] = stored.split(':');
  if (!salt || !expectedHash) return false;
  const computed = scryptSync(code, salt, 64, { N: SCRYPT_N });
  const expectedBuf = Buffer.from(expectedHash, 'hex');
  if (computed.length !== expectedBuf.length) return false;
  return timingSafeEqual(computed, expectedBuf);
}
```

- [ ] **Step 3: Run tests + commit**

```bash
cd apps/api && npx jest totp.util.spec
git add apps/api/src/utils/totp.util.* apps/api/package.json apps/api/package-lock.json
git commit -m "feat(admin): TOTP utility — generate, verify, OTP-auth URL, backup codes

Wraps otplib + qrcode. ±30s drift window. 10 backup codes per setup.
Backup codes scrypt-hashed (timing-safe verify).
6 unit tests cover all paths.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: TwoFactorService + module

**Files:**
- Create: `apps/api/src/modules/two-factor/two-factor.service.ts` + spec
- Create: `apps/api/src/modules/two-factor/two-factor.module.ts`

- [ ] **Step 1: Implement service**

```typescript
// apps/api/src/modules/two-factor/two-factor.service.ts
import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptPII, decryptPII } from '../../utils/crypto.util';
import {
  generateTotpSecret,
  verifyTotp,
  generateOtpAuthUrl,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
} from '../../utils/totp.util';

@Injectable()
export class TwoFactorService {
  constructor(private prisma: PrismaService) {}

  async startEnrollment(userId: string): Promise<{ secret: string; otpAuthUrl: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.twoFactorEnabled) throw new ConflictException('2FA already enabled');

    const secret = generateTotpSecret();
    const otpAuthUrl = generateOtpAuthUrl({ secret, label: user.email });

    // Store encrypted secret (not yet enabled)
    const key = process.env.PII_ENCRYPTION_KEY || '';
    const encryptedSecret = key ? encryptPII(secret, key) : secret;

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: encryptedSecret, twoFactorEnabled: false },
    });

    return { secret, otpAuthUrl };
  }

  async confirmEnrollment(userId: string, token: string): Promise<{ backupCodes: string[] }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorSecret) {
      throw new BadRequestException('Must start enrollment first');
    }
    const key = process.env.PII_ENCRYPTION_KEY || '';
    const secret = key ? decryptPII(user.twoFactorSecret, key) : user.twoFactorSecret;
    if (!verifyTotp(token, secret)) throw new BadRequestException('รหัส OTP ไม่ถูกต้อง');

    const backupCodes = generateBackupCodes(10);
    const hashedCodes = await Promise.all(
      backupCodes.map(async (code) => ({
        codeHash: await hashBackupCode(code),
        used: false,
        usedAt: null,
      }))
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorEnabledAt: new Date(),
        twoFactorBackupCodes: hashedCodes,
      },
    });

    return { backupCodes };
  }

  async verifyLogin(userId: string, token: string): Promise<{ method: 'TOTP' | 'BACKUP_CODE' }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('2FA not enabled');
    }
    const key = process.env.PII_ENCRYPTION_KEY || '';
    const secret = key ? decryptPII(user.twoFactorSecret, key) : user.twoFactorSecret;

    // Try TOTP first
    if (verifyTotp(token, secret)) return { method: 'TOTP' };

    // Try backup code
    const codes = (user.twoFactorBackupCodes as { codeHash: string; used: boolean; usedAt: Date | null }[]) ?? [];
    for (let i = 0; i < codes.length; i++) {
      if (!codes[i].used && (await verifyBackupCode(token, codes[i].codeHash))) {
        codes[i].used = true;
        codes[i].usedAt = new Date();
        await this.prisma.user.update({
          where: { id: userId },
          data: { twoFactorBackupCodes: codes },
        });
        return { method: 'BACKUP_CODE' };
      }
    }
    throw new BadRequestException('รหัส OTP ไม่ถูกต้อง');
  }

  async disable(userId: string, currentToken: string): Promise<void> {
    // Re-verify before disabling for security
    await this.verifyLogin(userId, currentToken);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorEnabledAt: null,
        twoFactorBackupCodes: null,
      },
    });
  }

  async regenerateBackupCodes(userId: string, currentToken: string): Promise<string[]> {
    await this.verifyLogin(userId, currentToken);
    const codes = generateBackupCodes(10);
    const hashed = await Promise.all(
      codes.map(async (c) => ({ codeHash: await hashBackupCode(c), used: false, usedAt: null }))
    );
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorBackupCodes: hashed },
    });
    return codes;
  }
}
```

- [ ] **Step 2: Write tests** (mirror service methods — 6+ tests)

- [ ] **Step 3: Implement controller + module + DTOs**

Create endpoints:
- `POST /api/admin/2fa/enroll` (auth required) — start enrollment, returns secret + qr
- `POST /api/admin/2fa/confirm` (auth required) — verify TOTP, returns backup codes
- `POST /api/admin/2fa/disable` (auth required) — disable
- `POST /api/admin/2fa/backup-codes` (auth required) — regenerate

- [ ] **Step 4: Register module in app.module.ts + commit**

---

## Task 4: Auth flow — 2-step login

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`

- [ ] **Step 1: Implement 2-step login**

When user has 2FA enabled, return tempToken instead of full JWT:

```typescript
// auth.service.ts — login method
async login(email: string, password: string): Promise<LoginResult> {
  const user = await this.validateCredentials(email, password);

  // 2FA enforcement
  const requires2FA = user.twoFactorEnabled ||
    (user.twoFactorRequiredAfter && new Date() > user.twoFactorRequiredAfter);

  if (requires2FA && !user.twoFactorEnabled) {
    // Force enrollment — issue temp token, FE redirects to setup
    const tempToken = await this.signTempToken(user.id, '2fa_setup');
    return { state: '2FA_SETUP_REQUIRED', tempToken };
  }

  if (user.twoFactorEnabled) {
    const tempToken = await this.signTempToken(user.id, '2fa_login');
    return { state: 'OTP_REQUIRED', tempToken };
  }

  return { state: 'AUTHENTICATED', token: await this.signFullToken(user) };
}

async loginWith2FA(tempToken: string, otp: string): Promise<LoginResult> {
  const payload = await this.verifyTempToken(tempToken, '2fa_login');
  await this.twoFactorService.verifyLogin(payload.userId, otp);
  const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
  return { state: 'AUTHENTICATED', token: await this.signFullToken(user!) };
}

private async signTempToken(userId: string, purpose: string): Promise<string> {
  return this.jwt.signAsync({ sub: userId, purpose }, { expiresIn: '5m' });
}
```

- [ ] **Step 2: Update controller**

`POST /api/auth/login` returns one of:
- `{ state: 'AUTHENTICATED', token }` — old flow
- `{ state: 'OTP_REQUIRED', tempToken }` — needs OTP
- `{ state: '2FA_SETUP_REQUIRED', tempToken }` — must set up first

Add `POST /api/auth/login/2fa` — accepts tempToken + otp, returns full JWT.

- [ ] **Step 3: Add tests + commit**

---

## Task 5: Frontend — Setup 2FA wizard

**Files:**
- Create: `apps/web/src/pages/SetupTwoFactorPage.tsx`
- Create: `apps/web/src/components/BackupCodesDisplay.tsx`
- Modify: `apps/web/src/App.tsx` (route)

- [ ] **Step 1: Implement Setup page**

3-step wizard:
1. Show QR code + manual secret → "scan with Google Authenticator"
2. Verify: enter 6-digit code from app
3. Display backup codes → user must save (download .txt button)

Use `qrcode.react` library for QR rendering.

- [ ] **Step 2: Wire route + commit**

---

## Task 6: Frontend — Login with 2FA step

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx`
- Create: `apps/web/src/components/TotpInput.tsx`

- [ ] **Step 1: Implement 2-step login UI**

State machine: `password` → (if OTP_REQUIRED) → `otp` → success.

TotpInput: 6-digit auto-advance input (UX like Apple's 2FA).

- [ ] **Step 2: Update AuthContext to handle states**

- [ ] **Step 3: Tests + commit**

---

## Task 7: Force enrollment by date

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Add: 1-time SQL to set `twoFactorRequiredAfter` for all admin users

- [ ] **Step 1: Backfill `twoFactorRequiredAfter`**

Run as one-off SQL or migration:

```sql
UPDATE users
SET two_factor_required_after = NOW() + INTERVAL '7 days'
WHERE deleted_at IS NULL AND two_factor_required_after IS NULL;
```

→ All staff have 7 days to enroll, then forced.

- [ ] **Step 2: Login enforcement (already in Task 4 logic)**

- [ ] **Step 3: Comms staff** — in-app banner "ตั้งค่า 2FA ใน 7 วัน" before deadline.

---

## Task 8: PR + soak

```bash
git push -u origin feat/admin-hardening-c2-subdomain-2fa
gh pr create --title "feat(admin): Batch C2 — admin subdomain + mandatory 2FA"
```

After merge:
- Owner action: DNS + Firebase deploy admin to subdomain
- Comms staff via LINE OA: "ตั้งค่า 2FA ภายใน 7 วัน + URL ใหม่"
- Monitor 5-7 days
- After grace period expires → all staff forced to enroll

---

## Self-Review

- ✅ Layer 1 (subdomain): Owner action + main.ts CORS
- ✅ Layer 6 (2FA): Tasks 1-7
- All other layers (3, 4, 5, 7, 8) → other batches
