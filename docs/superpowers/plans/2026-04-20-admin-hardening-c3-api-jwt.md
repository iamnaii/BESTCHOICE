# Admin Hardening — Batch C3 Implementation Plan (API namespace + JWT scope)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Refactor admin endpoints to `/api/admin/*` namespace + add JWT audience claim. Customer JWT (shop) cannot access admin endpoints even if leaked.

**Architecture:** Mass-rename existing controllers (~50) to `/admin` prefix. Mint JWTs with `aud` claim. Add `JwtAudienceGuard` to enforce. Backward compat: `/api/*` → 301 → `/api/admin/*` for 30 days.

**Tech Stack:** existing.

**Spec:** `docs/superpowers/specs/2026-04-20-admin-hardening-design.md` (Layers 4 + 5)

**Predecessor:** Batch C2 deployed (2FA enforced + admin subdomain live)

⚠️ **High risk:** This refactor touches every admin endpoint. Phase 2/3 e-commerce dev should pause briefly during rollout, OR rebase on this PR.

---

## File Structure

```
# Backend
apps/api/src/modules/auth/auth.service.ts                  # MODIFY: add 'aud' to JWT
apps/api/src/modules/auth/strategies/jwt.strategy.ts       # MODIFY: validate 'aud'
apps/api/src/modules/auth/guards/jwt-audience.guard.ts     # NEW
apps/api/src/modules/*/[name].controller.ts                # MODIFY ~50 files: prefix '/admin'
apps/api/src/main.ts                                       # MODIFY: backward compat redirect
apps/api/src/common/middleware/api-redirect.middleware.ts  # NEW: /api/* → /api/admin/*

# Frontend (apps/web — admin only)
apps/web/src/lib/api.ts                                    # MODIFY: baseURL append /admin

# Cloudflare (manual config)
shop.bestchoicephone.app                                   # only allow /api/shop/*
admin.bestchoicephone.app                                  # only allow /api/admin/*
```

---

## Task 1: Add JWT audience claim + guard

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts` (sign with aud)
- Modify: `apps/api/src/modules/auth/strategies/jwt.strategy.ts` (verify aud)
- Create: `apps/api/src/modules/auth/guards/jwt-audience.guard.ts`
- Create: `apps/api/src/modules/auth/guards/jwt-audience.guard.spec.ts`

- [ ] **Step 1: Add aud to admin JWT signing**

```typescript
// auth.service.ts
private async signFullToken(user: User): Promise<string> {
  return this.jwt.signAsync({
    sub: user.id,
    role: user.role,
    aud: 'admin',          // NEW
    scope: 'admin:full',   // NEW
  }, { expiresIn: '15m' });
}
```

Update shop-auth-social.service.ts (Phase 1) to sign with `aud: 'shop'`:

```typescript
// shop-auth-social.service.ts
private async signToken(customerId: string): Promise<string> {
  return this.jwt.signAsync({
    sub: customerId,
    role: 'CUSTOMER',
    aud: 'shop',           // NEW
    scope: 'shop:customer', // NEW
  }, { expiresIn: '7d' });
}
```

- [ ] **Step 2: Add JwtAudienceGuard**

```typescript
// jwt-audience.guard.ts
import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const REQUIRED_AUDIENCE = 'requiredAudience';
export const RequireAudience = (aud: string) => Reflect.metadata(REQUIRED_AUDIENCE, aud);

@Injectable()
export class JwtAudienceGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string>(REQUIRED_AUDIENCE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;  // no requirement = allow

    const req = context.switchToHttp().getRequest();
    const aud = req.user?.aud;
    if (aud !== required) {
      throw new ForbiddenException(`This endpoint requires audience: ${required}`);
    }
    return true;
  }
}
```

- [ ] **Step 3: Apply RequireAudience('admin') to all admin controllers**

Add to base admin controllers + use class-level decorator. Will be batched with Task 2.

- [ ] **Step 4: Tests + commit**

---

## Task 2: Refactor /api/* → /api/admin/* (mass rename)

**Files:**
- Modify: ~50 controllers in `apps/api/src/modules/*/[name].controller.ts`

- [ ] **Step 1: List all controllers**

```bash
grep -rE "@Controller\(['\"]" apps/api/src/modules --include="*.controller.ts" | grep -v "shop-\|chatbot-finance-liff\|sms-webhook\|paysolutions\|address" > /tmp/admin-controllers.txt
wc -l /tmp/admin-controllers.txt
```

Should show ~50 controllers.

- [ ] **Step 2: Update each controller decorator**

Use sed pattern for mass update:

```bash
for f in $(grep -rl "@Controller(['\"]" apps/api/src/modules --include="*.controller.ts" | xargs grep -l "@UseGuards(JwtAuthGuard"); do
  # Skip shop / liff / public endpoints
  if grep -qE "shop-|chatbot-finance-liff|sms-webhook|paysolutions|address" <<< "$f"; then continue; fi
  # Add 'admin/' prefix to controller path
  sed -i.bak "s|@Controller(['\"]\\([^'\"]*\\)['\"])|@Controller('admin/\\1')|g" "$f"
  rm "$f.bak"
done
```

⚠️ This is rough — implementer should:
1. Inspect each file manually
2. Adjust pattern per controller
3. Add `@RequireAudience('admin')` to each controller class
4. Verify tests still pass

Realistic approach: do this per-module group (auth, customers, contracts, payments, etc.) over multiple commits.

- [ ] **Step 3: Update e2e tests** that hardcode URLs

```bash
grep -rE "/api/(users|customers|contracts|...)" apps/web/e2e --include="*.ts" | head -20
# update to /api/admin/*
```

- [ ] **Step 4: Update apps/web frontend api.ts baseURL**

```typescript
// apps/web/src/lib/api.ts
const ADMIN_API_BASE = (import.meta.env.PROD ? 'https://admin.bestchoicephone.app' : '') + '/api/admin';
```

Then update all `api.get('/users/...')` → either keep relative (already prefixed) or update calls.

Easier: keep call sites unchanged, change baseURL only.

- [ ] **Step 5: Run all tests, type check, commit per module group**

---

## Task 3: Backward compat — /api/* → /api/admin/* redirect

**Files:**
- Create: `apps/api/src/common/middleware/api-redirect.middleware.ts`

- [ ] **Step 1: Implement middleware**

```typescript
// api-redirect.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

const SHOP_PATHS = /^\/api\/(shop|chatbot-finance-liff|sms-webhook|paysolutions|address)(\/.*)?$/;
const ALREADY_ADMIN = /^\/api\/admin\//;

@Injectable()
export class ApiRedirectMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (req.path.startsWith('/api/') &&
        !SHOP_PATHS.test(req.path) &&
        !ALREADY_ADMIN.test(req.path)) {
      const newUrl = req.path.replace(/^\/api\//, '/api/admin/') + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
      res.redirect(301, newUrl);
      return;
    }
    next();
  }
}
```

- [ ] **Step 2: Register in app.module.ts**

Apply middleware globally (or per /api/ namespace).

- [ ] **Step 3: Tests + commit**

---

## Task 4: Cloudflare path rules (manual config)

OWNER ACTION:

```
shop.bestchoicephone.app/api/admin/* → 403 Forbidden
admin.bestchoicephone.app/api/shop/* → 403 Forbidden
```

Both subdomains share same Cloud Run backend, but Cloudflare blocks cross-subdomain paths at edge.

---

## Task 5: PR + monitor + drop backward compat

- [ ] **Step 1: Push + open PR**

```bash
git push -u origin feat/admin-hardening-c3-api-jwt
gh pr create --title "feat(admin): Batch C3 — API namespace + JWT audience"
```

- [ ] **Step 2: Monitor 30 days**

- Check Cloudflare logs for hits to old `/api/users` etc.
- If hits = old client, identify + update
- After 30 days clean → drop redirect middleware

- [ ] **Step 3: Drop backward compat (separate PR)**

```bash
git checkout -b chore/drop-api-backward-compat
# Remove ApiRedirectMiddleware
git commit -m "chore(admin): drop /api/* → /api/admin/* backward compat after 30-day grace"
```

---

## Self-Review

- ✅ Layer 4 (API namespace): Tasks 2 + 3
- ✅ Layer 5 (JWT scope/aud): Task 1

**Risk acknowledged:** Mass refactor touches ~50 files + Phase 2/3 e-commerce active dev. Coordinate timing.

---

## Execution Handoff

**Plan complete.** Use subagent-driven-development. Recommend per-module-group commits to keep PR reviewable.

After C3: admin hardening complete (all 7 layers).
