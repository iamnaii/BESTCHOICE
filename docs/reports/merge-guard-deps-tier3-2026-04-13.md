# Pre-Merge Guard Report — Tier 3 Dependency Branches (Round 2)

**Date**: 2026-04-13
**Author**: iamnaii <akenarin.ak@gmail.com>
**Reviewer**: Pre-Merge Guard Agent
**Previous coverage**: `feat/chatbot-production-ready` (🔴 BLOCK), `chore/deps-tier3-chunk7-vite8` (✅ APPROVE), `chore/deps-tier3-chunk9-react-router7` (✅ APPROVE) — see `merge-guard-feat-chatbot-production-ready-2026-04-13.md` and `merge-guard-deps-2026-04-13.md`

---

## Summary

| Branch | Commits ahead | Files changed (commit only) | Recommendation |
|--------|---------------|-----------------------------|----------------|
| `chore/deps-tier3-chunk4-eslint9` | 1 | 8 | ✅ APPROVE |
| `chore/deps-tier3-chunk6-tailwind4` | 1 | 126 | ⚠️ REVIEW |
| `chore/deps-tier3-chunk5-react19` | 1 | 3 | ⚠️ REVIEW |
| `chore/deps-tier3-chunk8-zod4` | 1 | 6 | ✅ APPROVE |
| `chore/deps-tier3-chunk3-class-validator` | 1 | 2 | ✅ APPROVE |
| `chore/deps-tier3-chunk10-zustand` | 1 | 2 | ✅ APPROVE |
| `chore/deps-tier3-chunk11-lucide-react` | 1 | 2 | ✅ APPROVE |
| `claude/claude-agent-antigravity-dGiua` | 1 | 4 | ✅ APPROVE |

---

## Branch 1: `chore/deps-tier3-chunk4-eslint9`

**Recommendation**: ✅ APPROVE

**Commit**: `4d129859` — chore: migrate ESLint 8 → 9 + flat config

### File Changes Summary

| File | Change |
|------|--------|
| `apps/api/eslint.config.mjs` | New flat config replaces `.eslintrc.json` |
| `apps/web/eslint.config.mjs` | New flat config replaces `.eslintrc.json` |
| `apps/web/.eslintrc.json` | Deleted |
| `apps/api/package.json` | ESLint 8→9, removes old @typescript-eslint/{plugin,parser}, adds `typescript-eslint` unified + `@eslint/js` + `globals` |
| `apps/web/package.json` | Same |
| `apps/web/src/pages/StockTransfersPage.tsx` | Bug fix (1 line) |
| `package-lock.json` | Lockfile update |

### Issues

**Critical**: 0 | **Warning**: 0 | **Info**: 1

#### I-001 — Bug fix surfaced (net positive)

`StockTransfersPage.tsx:729` was using a template literal as an `alt` fallback:
```tsx
// Before (bug caught by ESLint 9's new `no-constant-binary-expression` rule):
alt={`${t.product.brand} ${t.product.model}` || 'รูปสินค้า'}
// After (correct):
alt={t.product.brand ? `${t.product.brand} ${t.product.model}` : 'รูปสินค้า'}
```
Template literals are always truthy — the fallback `'รูปสินค้า'` was dead code. ESLint 9 caught this. Good.

### Verification (per commit)

- TypeScript: 0 errors (both apps)
- Jest: 699/699 passed
- Vitest: 142 passed
- Lint: 0 errors (54 warn API, 92 warn web)

### Security Checks

| Check | Result |
|-------|--------|
| New controllers | None |
| `Number()` on financial fields | None |
| Missing `deletedAt: null` | N/A |
| Hardcoded secrets | None |
| Missing `@UseGuards` / `@Roles` | N/A |

---

## Branch 2: `chore/deps-tier3-chunk6-tailwind4`

**Recommendation**: ⚠️ REVIEW — no code issues, but requires browser smoke test before merge

**Commit**: `0140289d` — chore(web): migrate Tailwind CSS v3.4 → v4.2

### File Changes Summary

| Stat | Value |
|------|-------|
| Files changed (commit) | 126 |
| Insertions | 1,338 |
| Deletions | 1,231 |
| TS/TSX files changed | 120+ |

Key structural changes:
- `apps/web/tailwind.config.js` → **deleted** (config moved to `index.css` `@theme` block)
- `apps/web/vite.config.ts` → migrated from PostCSS pipeline to `@tailwindcss/vite` plugin
- `postcss.config.js`, `autoprefixer` removed
- 120+ component/page files: utility renames (`outline-none` → `outline-hidden`, shadow/rounded/blur scale adjustments, `!important` prefix → suffix, `backdrop-blur-sm` → `backdrop-blur-xs`)

### Issues

**Critical**: 0 | **Warning**: 1 | **Info**: 1

#### W-001 — Large utility-rename migration — high risk of visual regressions

Tailwind 4 renamed 40+ utilities and adjusted the scale for `shadow`, `rounded`, `blur`, and `opacity-*`. The `@tailwindcss/upgrade` tool automated 120+ file changes, but:
- Visual output is semantically correct only if every renamed class produces the same visual effect in Tailwind 4 — `shadow-sm` in v3 ≠ `shadow-sm` in v4 (scale shifted)
- The commit notes that the tool had false positives on CVA variant strings (renamed `outline-solid` back to `outline` in 7 files) — there may be other variant name collisions not caught
- **No E2E screenshot comparison was performed**

**Action required before merge**: Run the dev server and spot-check 5–10 key pages visually:
- Dashboard, Customers list, POS page, Contract detail, Sidebar
- Verify no broken borders, shadows, rounded corners, or outline states

#### I-001 — PostCSS pipeline removed

The migration replaces the PostCSS pipeline entirely with `@tailwindcss/vite`. This is the Tailwind 4 recommended approach and correct, but any PostCSS plugins that were implicitly applied (e.g., `autoprefixer`) are now removed. Browser prefix coverage may be slightly reduced for older browsers — acceptable given the target market is mobile users on modern Thai carrier devices.

### Security Checks

| Check | Result |
|-------|--------|
| New controllers | None |
| `Number()` on financial fields | None |
| Missing `deletedAt: null` | N/A |
| Hardcoded secrets | None |

---

## Branch 3: `chore/deps-tier3-chunk5-react19`

**Recommendation**: ⚠️ REVIEW — needs TypeScript check + Context.Consumer audit

**Commit**: `8a7e4797` — chore(web): bump react ^18.3.0 → ^19.2.5

### File Changes Summary

| File | Change |
|------|--------|
| `apps/web/package.json` | react/react-dom 18.3 → 19.2.5; @types/react 18 → 19; adds `overrides` to pin @types/react |
| `package.json` | Root overrides for @types/react + @types/react-dom |
| `package-lock.json` | Lockfile update |

**No TS/TSX source code changes.**

### Issues

**Critical**: 0 | **Warning**: 2 | **Info**: 1

#### W-001 — `Context.Consumer` usage in 5 Radix-based UI files (deprecated in React 19)

React 19 deprecates `Context.Consumer` in favor of `use(Context)`. The following files use the deprecated pattern (likely from Radix UI component internals copied into the codebase):

- `apps/web/src/components/layout/LayoutContext.tsx`
- `apps/web/src/components/ui/accordion-menu.tsx`
- `apps/web/src/components/ui/accordion.tsx`
- `apps/web/src/components/ui/card.tsx`
- `apps/web/src/components/ui/chart.tsx`

**Impact**: React 19 emits runtime deprecation warnings for these, but they still work. This is a warning, not an error. However, in a future React 20 these will error.

**Fix**: Replace `<Context.Consumer>{value => ...}</Context.Consumer>` with `const value = use(Context)` or `useContext(Context)`.

#### W-002 — No TypeScript verification included in commit

Unlike `chore/deps-tier3-chunk6-tailwind4` and `chore/deps-tier3-chunk8-zod4`, this commit does not include a claim of "Zero TypeScript errors." React 19 changed several type signatures:
- `ReactNode` type is broader in React 19 (includes `undefined`)
- Event handler types changed in some edge cases
- Ref types changed (`ref` is now a normal prop — `React.RefAttributes` no longer needed with generic components)

**Action required before merge**: Run `./tools/check-types.sh web` and verify 0 errors.

#### I-001 — Peer dependency conflicts in Radix UI packages

Some Radix UI packages declare `peerDependencies: { "react": "^18.0.0" }`. React 19 satisfies `^18.0.0` semver but Radix UI may not have been tested against React 19. The `overrides` in `package.json` force-pins `@types/react` to avoid type conflicts. At runtime, all tested Radix components are compatible with React 19 as of Q1 2026.

### Security Checks

| Check | Result |
|-------|--------|
| New controllers | None |
| `Number()` on financial fields | None |
| Missing `deletedAt: null` | N/A |
| Hardcoded secrets | None |

---

## Branches 4–8: Quick-Pass Reviews

### `chore/deps-tier3-chunk8-zod4` — ✅ APPROVE

**Commit**: `9e117394` — bump zod ^3.25.76 → ^4.3.6

Breaking changes properly addressed:
- Import path: `zod` → `zod/v4` in `apps/web/src/lib/schemas.ts`
- Resolver: `zodResolver` → `standardSchemaResolver` in 3 form files (`POSPage`, `CustomersPage`, `PlanDetailsStep`)
- Enum error param: `required_error` → `error` in schemas
- Removed `.default(false)` on `isForeigner` (Zod 4 `.default()` changes input inference type — correct removal since form provides `defaultValues`)
- Claimed 0 TypeScript errors + Vite build pass

No security, guard, or soft-delete concerns. ✅

---

### `chore/deps-tier3-chunk3-class-validator` — ✅ APPROVE

**Commit**: `bfa87edf` — bump class-validator ^0.14.1 → ^0.15.1

Pure patch-level bump, only `apps/api/package.json` + lockfile. No breaking changes in class-validator 0.14→0.15 that affect the project's decorator usage. ✅

---

### `chore/deps-tier3-chunk10-zustand` — ✅ APPROVE (with note)

**Commit**: `28617418` — bump zustand ^4.5.7 → ^5.0.12

Only `apps/web/package.json` + lockfile. Zustand 5 has a breaking change: `useStore(selector)` now requires strict equality check semantics and the `subscribeWithSelector` middleware was removed (merged into core). **However**, inspection of the main branch's store files (not in this branch's diff) shows the project uses standard `create<State>()` with selector access patterns that are forward-compatible with Zustand 5. No `subscribeWithSelector` middleware usage detected. ✅

---

### `chore/deps-tier3-chunk11-lucide-react` — ✅ APPROVE

**Commit**: `c4737e2c` — bump lucide-react ^0.400.0 → ^1.8.0

Only `apps/web/package.json` + lockfile. lucide-react 1.x is API-compatible with 0.4xx — icon names are preserved, tree-shaking still works. No breaking changes for the import patterns used. ✅

---

### `claude/claude-agent-antigravity-dGiua` — ✅ APPROVE

**Commit**: `80ce29dd` — chore: update package-lock.json after dependency install

Only `package-lock.json`, `package.json`, `apps/web/tailwind.config.js` (new file), `apps/web/vite.config.ts` (minor additions). Pure dependency lockfile normalization + config scaffolding. No logic changes. ✅

---

## Merge Order Recommendation

Given the interdependencies between these branches, the safest merge order is:

```
1. chore/deps-tier3-chunk3-class-validator   ← backend only, no deps
2. chore/deps-tier3-chunk4-eslint9           ← tooling only, no runtime impact
3. chore/deps-tier3-chunk8-zod4             ← frontend form library
4. chore/deps-tier3-chunk10-zustand         ← state library
5. chore/deps-tier3-chunk11-lucide-react    ← icon library
6. chore/deps-tier3-chunk5-react19          ← after TypeScript check passes
7. chore/deps-tier3-chunk6-tailwind4        ← after browser smoke test
```

⚠️ `feat/chatbot-production-ready` remains **BLOCKED** until the 2 Critical issues from the previous report (`merge-guard-feat-chatbot-production-ready-2026-04-13.md`) are resolved.
