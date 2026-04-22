# Pre-Merge Guard Report

**Branch:** `feat/admin-hardening-c1`  
**Date:** 2026-04-22  
**Reviewer:** Pre-Merge Guard Agent (automated)  
**Recommendation:** ✅ APPROVE

---

## Branch Summary

| Field | Value |
|-------|-------|
| Unique commits | 15+ |
| Files changed (TS/TSX) | 60+ |
| New utility files | 4 |
| Modified core services | 5 |
| New tests | 27 |

### Commits Reviewed (top layer — most impactful)
1. `f2caabef` feat(admin-c1-t4): wire device fingerprinting into LoginAuditService + new-device LINE alert
2. `41d92d59` feat(admin-c1-t3): device-fingerprint util — computeDeviceFingerprint, computeIpPrefix, humanReadableDeviceLabel
3. `255cf2aa` feat(admin-c1): add device fingerprint schema + KnownDevice model
4. `e65c1931` security(admin-c1): block all crawlers + meta noindex on admin app
5. `0a681bb9` feat(pii): Phase 5 — switch reads to encrypted + role-based mask + audit log
6. `a01fea4e` feat(pii): Phase 3 — dual-write encrypted columns + backfill script
7. `0ab607b0` feat(pii): Phase 2 — schema migration adds nullable encrypted + hash columns
8. `ff7c09c1` feat(pii): Phase 1 foundation — utilities + env validation + audit service

---

## Issues Found

### Critical — 0 issues

No critical issues detected.

### Warning — 1 issue

**W-001: User lookup in LoginAuditService missing explicit `deletedAt: null` filter**
- **File:** `apps/api/src/modules/auth/login-audit.service.ts` ~line 125
- **Pattern:**
  ```typescript
  const user = await this.prisma.user.findUnique({
    where: { id: params.userId },
    select: { email: true, name: true, role: true },
  });
  ```
- **Risk:** Violates codebase convention of always filtering `deletedAt: null`. Not a security vulnerability — a deleted user cannot pass prior auth checks — but inconsistent with database rules.
- **Recommendation:** Change to `where: { id: params.userId, deletedAt: null }` for defensive consistency.

### Info — 4 items

**I-001: Large pre-existing files modified**
- `customers.service.ts` — 957 lines (pre-existing; PII additions are incremental)
- `trade-in.service.ts` — 893 lines (pre-existing; PII additions are incremental)
- No splitting required; additions are appropriate.

**I-002: Encryption key length check is permissive in development**
- **File:** `apps/api/src/utils/crypto.util.ts` line 12
- Pattern `key.length < 32` check allows undersized keys in dev (production validates 64 hex chars).
- Intentional dev-mode graceful degradation. No change needed.

**I-003: Device fingerprint data minimization — VERIFIED CLEAN**
- Components: User-Agent, IP prefix (/24 IPv4, /48 IPv6), Accept-Language
- SHA-256 hashed — non-reversible
- No full IP addresses stored, no PII in fingerprint

**I-004: `any` in test mocks**
- Test files use `any` for mock objects. Acceptable for test code.

---

## Security-Specific Assessment

| Check | Result |
|-------|--------|
| PII encryption: random IV per operation | ✅ Pass |
| PII encryption: algorithm (AES-256-CBC) | ✅ Pass |
| PII_ENCRYPTION_KEY never logged | ✅ Pass |
| PII_HASH_SALT never logged | ✅ Pass |
| Env vars validated at startup | ✅ Pass |
| Device fingerprint minimal data | ✅ Pass |
| KnownDevice model — no sensitive PII | ✅ Pass |
| Backfill script safe (explicit dry-run flag) | ✅ Pass |
| New device LINE alert: Thai message | ✅ Pass (`[แจ้งเตือน] พบการเข้าสู่ระบบจากอุปกรณ์ใหม่`) |

---

## Positive Findings

- ✅ All new/modified controllers retain `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)`
- ✅ All endpoint methods have `@Roles()` decorators
- ✅ No `Number()` on financial fields
- ✅ No hardcoded secrets — all env vars via Secret Manager
- ✅ No unparameterized `$queryRaw`
- ✅ PII audit logging never blocks request path (fire-and-forget pattern)
- ✅ Graceful decryption fallback (returns plaintext on failure, logs error)
- ✅ 27 new tests covering encryption, masking, device fingerprinting, login audit
- ✅ All tests pass

---

## Pre-Merge Checklist

- [ ] Run `npx prisma migrate dev` (KnownDevice model + PII columns)
- [ ] Run backfill script with `--dry-run` to verify scope before production
- [ ] Add `PII_ENCRYPTION_KEY` and `PII_HASH_SALT` to all environment configs (CI already updated per commit 6940fad3)
- [ ] Fix W-001: add `deletedAt: null` to user findUnique in login-audit.service.ts (optional but recommended)
- [ ] Run `./tools/check-types.sh all`
