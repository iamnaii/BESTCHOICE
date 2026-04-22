# Shop v2 — Design System + Full Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `apps/web-shop` visual identity end-to-end — design tokens, 22 shared components, 28 pages — shipped as one big-bang PR from `.worktrees/shop-v2-design/`, verified by Playwright smoke + visual regression and Lighthouse mobile.

**Architecture:** Four sequential phases. Phase 0 creates the isolated worktree + baseline snapshots. Phase 1 adds design tokens + 7 primitives (2 new, 5 refreshed from shadcn/ui base). Phase 2 builds 8 composites, 4 layout primitives, 3 motion helpers + locks public component APIs. Phase 3 dispatches 5 parallel subagents to redesign 28 pages against the frozen library. Phase 4 runs full QA, opens the PR, and ships.

**Tech Stack:** React 19 + Vite 6 + TypeScript + Tailwind CSS v4 + shadcn/ui primitives + Radix UI + `lucide-react` + IntersectionObserver (no framer-motion). Playwright for visual regression + smoke. `@lhci/cli` for Lighthouse budget.

**Spec:** [docs/superpowers/specs/2026-04-22-shop-v2-design-system.md](../specs/2026-04-22-shop-v2-design-system.md)
**References:** [docs/design/SHOP-REFERENCES.md](../../design/SHOP-REFERENCES.md)

---

## Phase 0 — Worktree + baseline

Isolates the redesign from concurrent branches and captures a visual baseline of the current live shop so we can compare before/after (expecting different visuals but same form behavior).

### Task 0.1: Create worktree + install deps

**Files:**
- Create: `.worktrees/shop-v2-design/` (entire tree)

- [ ] **Step 1: Cleanup any stale state**

Run:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git worktree list | grep shop-v2 || echo "no existing shop-v2 worktree"
git branch -D feature/shop-v2-design 2>/dev/null || true
```

- [ ] **Step 2: Create worktree from current main**

```bash
git fetch origin main
git worktree add .worktrees/shop-v2-design -b feature/shop-v2-design origin/main
```

Expected: worktree at `.worktrees/shop-v2-design/` on branch `feature/shop-v2-design`.

- [ ] **Step 3: Install deps + generate Prisma client**

```bash
cd .worktrees/shop-v2-design
cp ../../apps/api/.env apps/api/.env 2>/dev/null || true
npm install --no-audit --no-fund
npx prisma generate --schema=apps/api/prisma/schema.prisma
```

Expected: `node_modules/` populated, Prisma client generated in `node_modules/@prisma/client`.

- [ ] **Step 4: Baseline type check (must pass — starting from green)**

```bash
./tools/check-types.sh all 2>&1 | tail -10
```

Expected: `API: OK`, `Web: OK`, `TypeScript check passed!`

- [ ] **Step 5: Baseline web-shop build**

```bash
cd apps/web-shop && npm run build 2>&1 | tail -5
```

Expected: `✓ built in X.Xs`, bundle ~573 KB.

- [ ] **Step 6: Commit the branch marker (empty commit so the first redesign commit has a clean parent)**

Run from `.worktrees/shop-v2-design/`:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git -c commit.gpgsign=false commit --allow-empty -m "chore(shop-v2): open redesign branch from main baseline

Starting point: design system rebuild + 28-page redesign per
docs/superpowers/specs/2026-04-22-shop-v2-design-system.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 0.2: Baseline Playwright snapshot of live shop

**Files:**
- Create: `apps/web/e2e/shop-v2-baseline.spec.ts`

- [ ] **Step 1: Write the baseline spec**

Create `apps/web/e2e/shop-v2-baseline.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';

const PAGES = [
  '/',
  '/products',
  '/cart',
  '/account',
  '/account/addresses',
  '/account/saving-plans',
  '/orders',
  '/apply/placeholder-product-id',
  '/apply/success/APP-000000-000',
  '/trade-in',
  '/trade-in/submit',
  '/buyback',
  '/buyback/quote',
  '/buyback/submit',
  '/saving-plan',
  '/saving-plan/create',
  '/how-it-works',
  '/shipping',
  '/returns',
  '/about',
  '/contact',
];

test.describe('shop v2 baseline snapshot', () => {
  test.use({
    baseURL: 'https://bestchoicephone-shop.web.app',
    screenshot: 'only-on-failure',
  });

  for (const path of PAGES) {
    for (const viewport of [
      { name: 'mobile', width: 390, height: 844 },
      { name: 'desktop', width: 1440, height: 900 },
    ]) {
      test(`${viewport.name} ${path}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(path, { waitUntil: 'networkidle', timeout: 15000 });
        const hasRoot = await page.locator('#root > *').count();
        expect(hasRoot).toBeGreaterThan(0);
        await page.screenshot({
          path: `apps/web/e2e/snapshots/shop-v2-baseline/${viewport.name}${path.replace(/\//g, '_') || '_home'}.png`,
          fullPage: true,
        });
      });
    }
  }
});
```

- [ ] **Step 2: Run the baseline suite**

```bash
cd apps/web && npx playwright test e2e/shop-v2-baseline.spec.ts --reporter=list 2>&1 | tail -20
```

Expected: 42 passing tests (21 paths × 2 viewports).

If some paths return a white screen (this indicates a regression before v2 even starts — out of scope; accept the snapshot), the test still asserts the React tree mounted but the visual may be blank. That's OK — we want the baseline exactly as prod is today.

- [ ] **Step 3: Commit the baseline snapshots**

```bash
git add apps/web/e2e/shop-v2-baseline.spec.ts apps/web/e2e/snapshots/shop-v2-baseline/
git -c commit.gpgsign=false commit -m "test(shop-v2): baseline visual snapshot of live shop

42 screenshots (21 pages × mobile/desktop) of the current production
shop before v2 redesign. Used as the reference for:
1. Confirming no flow breaks (pages still render)
2. Side-by-side comparison in the PR description.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1 — Tokens + 7 primitives

Tokens first, then each primitive gets a **demo story page** (plain HTML rendered by a dev route) that exercises every variant. Demo stories double as visual QA targets.

### Task 1.1: Expand Tailwind config + tokens CSS

**Files:**
- Modify: `apps/web-shop/tailwind.config.js` (or `.ts`)
- Create: `apps/web-shop/src/styles/tokens.css`
- Create: `apps/web-shop/src/styles/motion.css`
- Modify: `apps/web-shop/src/index.css` (import the two new files)

- [ ] **Step 1: Inspect current Tailwind config**

```bash
cat apps/web-shop/tailwind.config.js 2>/dev/null || cat apps/web-shop/tailwind.config.ts 2>/dev/null
cat apps/web-shop/src/index.css
```

Note the existing theme customizations (primary color, font family). The plan EXTENDS, doesn't replace.

- [ ] **Step 2: Write `src/styles/tokens.css`**

```css
/*
 * Shop v2 design tokens — add semantic variables on top of the
 * existing `:root` Tailwind theme. Numeric values target the
 * hybrid aesthetic: iStudio warmth + Gazelle trust + Apple TH
 * installment clarity + LINE-OA local character.
 */

:root {
  /* Emerald scale (primary brand) */
  --color-emerald-50:  #ECFDF5;
  --color-emerald-100: #D1FAE5;
  --color-emerald-200: #A7F3D0;
  --color-emerald-300: #6EE7B7;
  --color-emerald-400: #34D399;
  --color-emerald-500: #1DB446; /* brand primary */
  --color-emerald-600: #158C36;
  --color-emerald-700: #0E6B29;
  --color-emerald-800: #0A5423;
  --color-emerald-900: #064E3B;

  /* Zinc neutrals (greys) — complete scale */
  --color-zinc-50:  #FAFAFA;
  --color-zinc-100: #F4F4F5;
  --color-zinc-200: #E4E4E7;
  --color-zinc-300: #D4D4D8;
  --color-zinc-400: #A1A1AA;
  --color-zinc-500: #71717A;
  --color-zinc-600: #52525B;
  --color-zinc-700: #3F3F46;
  --color-zinc-800: #27272A;
  --color-zinc-900: #18181B;

  /* Sand — warm accent for "local shop" sections (testimonial, footer) */
  --color-sand-50:  #FDF9F3;
  --color-sand-100: #FAF0E1;
  --color-sand-500: #C9A876;
  --color-sand-900: #5C4A2F;

  /* Condition badges (used iPhone grading) */
  --color-condition-a: #10B981; /* สภาพดีมาก — เขียว */
  --color-condition-b: #F59E0B; /* สภาพใช้งาน — เหลือง */
  --color-condition-c: #F97316; /* สภาพมีรอย — ส้ม */

  /* Emerald-tinted shadows (not pure black drop) */
  --shadow-sm:  0 1px 2px 0 rgb(29 180 70 / 0.04), 0 1px 2px -1px rgb(29 180 70 / 0.04);
  --shadow-md:  0 2px 6px 0 rgb(29 180 70 / 0.06), 0 2px 4px -2px rgb(29 180 70 / 0.04);
  --shadow-lg:  0 6px 16px 0 rgb(29 180 70 / 0.08), 0 4px 6px -4px rgb(29 180 70 / 0.04);
  --shadow-xl:  0 12px 32px 0 rgb(29 180 70 / 0.10), 0 8px 16px -8px rgb(29 180 70 / 0.06);
  --shadow-2xl: 0 24px 64px 0 rgb(29 180 70 / 0.14);

  /* Motion durations */
  --duration-fast:   150ms;
  --duration-base:   200ms;
  --duration-medium: 300ms;
  --duration-slow:   500ms;

  /* Easing */
  --ease-out-quad:     cubic-bezier(0.25, 0.46, 0.45, 0.94);
  --ease-in-out-quint: cubic-bezier(0.86, 0, 0.07, 1);
}
```

- [ ] **Step 3: Write `src/styles/motion.css`**

```css
/*
 * Motion system — CSS-only (no framer-motion). Uses the duration +
 * easing tokens from tokens.css.
 */

@keyframes shop-reveal-up {
  from { opacity: 0; transform: translate3d(0, 12px, 0); }
  to   { opacity: 1; transform: translate3d(0, 0, 0); }
}

@keyframes shop-reveal-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.reveal {
  opacity: 0;
  transform: translate3d(0, 12px, 0);
  transition: opacity var(--duration-slow) var(--ease-out-quad),
              transform var(--duration-slow) var(--ease-out-quad);
}
.reveal.in-view {
  opacity: 1;
  transform: translate3d(0, 0, 0);
}

/* Stagger children — parent applies .stagger, children get increasing delay */
.stagger > * { transition-delay: calc(50ms * var(--stagger-index, 0)); }

/* Respect reduced motion — disable ALL transitions/animations */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
  .reveal { opacity: 1 !important; transform: none !important; }
}
```

- [ ] **Step 4: Extend `tailwind.config.ts`**

Find the config file (`tailwind.config.js` or `tailwind.config.ts`) and add to `theme.extend`:

```typescript
{
  theme: {
    extend: {
      colors: {
        condition: {
          a: 'var(--color-condition-a)',
          b: 'var(--color-condition-b)',
          c: 'var(--color-condition-c)',
        },
        sand: {
          50: 'var(--color-sand-50)',
          100: 'var(--color-sand-100)',
          500: 'var(--color-sand-500)',
          900: 'var(--color-sand-900)',
        },
      },
      boxShadow: {
        sm:  'var(--shadow-sm)',
        md:  'var(--shadow-md)',
        lg:  'var(--shadow-lg)',
        xl:  'var(--shadow-xl)',
        '2xl': 'var(--shadow-2xl)',
      },
      transitionDuration: {
        fast:   'var(--duration-fast)',
        base:   'var(--duration-base)',
        medium: 'var(--duration-medium)',
        slow:   'var(--duration-slow)',
      },
      transitionTimingFunction: {
        'out-quad':     'var(--ease-out-quad)',
        'in-out-quint': 'var(--ease-in-out-quint)',
      },
    },
  },
}
```

- [ ] **Step 5: Import tokens + motion in `index.css`**

Add to the TOP of `apps/web-shop/src/index.css`:
```css
@import './styles/tokens.css';
@import './styles/motion.css';
```

- [ ] **Step 6: Type check + build + commit**

```bash
cd .worktrees/shop-v2-design
./tools/check-types.sh all 2>&1 | tail -3
cd apps/web-shop && npm run build 2>&1 | tail -5
```

Expected: type check passes, build succeeds. Bundle should be ≤ current (tokens add bytes but are shared).

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web-shop/tailwind.config.* apps/web-shop/src/styles/ apps/web-shop/src/index.css
git -c commit.gpgsign=false commit -m "feat(shop-v2): design tokens — emerald/zinc/sand scales + shadows + motion

Adds a full color scale (emerald 50-900, zinc 50-900, sand accents),
condition badges (A/B/C for used-iPhone grading), emerald-tinted
shadows (5 levels), and CSS-only motion tokens + reveal keyframes
that respect prefers-reduced-motion.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.2: Badge primitive (NEW)

**Files:**
- Create: `apps/web-shop/src/components/ui/badge.tsx`
- Create: `apps/web-shop/src/stories/badge.story.tsx` (demo; served via dev route)

- [ ] **Step 1: Write the Badge component**

```tsx
// apps/web-shop/src/components/ui/badge.tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full font-medium leading-snug whitespace-nowrap',
  {
    variants: {
      variant: {
        default:  'bg-zinc-100 text-zinc-800',
        primary:  'bg-emerald-100 text-emerald-900',
        success:  'bg-emerald-500 text-white',
        warning:  'bg-amber-100 text-amber-900',
        danger:   'bg-red-100 text-red-900',
        outline:  'bg-transparent border border-zinc-300 text-zinc-700',
        'condition-a': 'bg-emerald-500 text-white',
        'condition-b': 'bg-amber-500 text-white',
        'condition-c': 'bg-orange-500 text-white',
      },
      size: {
        sm: 'text-xs px-2 py-0.5',
        md: 'text-xs px-2.5 py-1',
        lg: 'text-sm px-3 py-1',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { badgeVariants };
```

- [ ] **Step 2: Write the demo story**

```tsx
// apps/web-shop/src/stories/badge.story.tsx
import { Badge } from '@/components/ui/badge';

export default function BadgeStory() {
  return (
    <div className="p-8 space-y-6">
      <section className="space-y-2">
        <h2 className="text-xl font-bold">Variants</h2>
        <div className="flex flex-wrap gap-2">
          <Badge>default</Badge>
          <Badge variant="primary">primary</Badge>
          <Badge variant="success">success</Badge>
          <Badge variant="warning">warning</Badge>
          <Badge variant="danger">danger</Badge>
          <Badge variant="outline">outline</Badge>
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-bold">Condition (used-iPhone)</h2>
        <div className="flex flex-wrap gap-2">
          <Badge variant="condition-a">A — สภาพดีมาก</Badge>
          <Badge variant="condition-b">B — ใช้งาน</Badge>
          <Badge variant="condition-c">C — มีรอย</Badge>
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-bold">Sizes</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <Badge size="sm" variant="primary">sm</Badge>
          <Badge size="md" variant="primary">md</Badge>
          <Badge size="lg" variant="primary">lg</Badge>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Type check**

```bash
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web-shop/src/components/ui/badge.tsx apps/web-shop/src/stories/badge.story.tsx
git -c commit.gpgsign=false commit -m "feat(shop-v2): Badge primitive + demo story

9 variants (default, primary, success, warning, danger, outline,
condition-a/b/c) × 3 sizes. Used across product cards, order
status, review badges, application status, and trust strip.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.3: Skeleton primitive (NEW)

**Files:**
- Create: `apps/web-shop/src/components/ui/skeleton.tsx`
- Create: `apps/web-shop/src/stories/skeleton.story.tsx`

- [ ] **Step 1: Write Skeleton component**

```tsx
// apps/web-shop/src/components/ui/skeleton.tsx
import { cn } from '@/lib/utils';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  /** Pre-shaped variants for common use cases. */
  shape?: 'line' | 'avatar' | 'card' | 'thumbnail' | 'custom';
}

export function Skeleton({ shape = 'custom', className, ...props }: Props) {
  const shapeClass = {
    line: 'h-4 w-full rounded-md',
    avatar: 'h-10 w-10 rounded-full',
    card: 'h-40 w-full rounded-2xl',
    thumbnail: 'aspect-square w-full rounded-xl',
    custom: '',
  }[shape];
  return (
    <div
      className={cn(
        'animate-pulse bg-zinc-100 dark:bg-zinc-800',
        shapeClass,
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  );
}
```

- [ ] **Step 2: Demo story**

```tsx
// apps/web-shop/src/stories/skeleton.story.tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function SkeletonStory() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h3 className="font-semibold mb-2">Line</h3>
        <Skeleton shape="line" />
        <Skeleton shape="line" className="mt-2 w-3/4" />
      </div>
      <div>
        <h3 className="font-semibold mb-2">Avatar</h3>
        <Skeleton shape="avatar" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="font-semibold mb-2">Card</h3>
          <Skeleton shape="card" />
        </div>
        <div>
          <h3 className="font-semibold mb-2">Thumbnail</h3>
          <Skeleton shape="thumbnail" />
        </div>
      </div>
      <div>
        <h3 className="font-semibold mb-2">Product card (composed)</h3>
        <div className="rounded-2xl border border-zinc-200 p-4 space-y-3">
          <Skeleton shape="thumbnail" />
          <Skeleton shape="line" />
          <Skeleton shape="line" className="w-2/3" />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type check + commit**

```bash
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web-shop/src/components/ui/skeleton.tsx apps/web-shop/src/stories/skeleton.story.tsx
git -c commit.gpgsign=false commit -m "feat(shop-v2): Skeleton primitive with 5 shape presets

line/avatar/card/thumbnail/custom. Used by StatefulList loading state
and direct imports in page-level skeletons (ProductCard placeholder,
order row placeholder).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.4: Button refresh (existing — minor polish only)

**Files:**
- Modify: `apps/web-shop/src/components/ui/button.tsx` (keep existing rich variants; add `fullWidth` prop + loading slot; confirm `rounded-xl` default)
- Create: `apps/web-shop/src/stories/button.story.tsx`

- [ ] **Step 1: Read current Button**

```bash
grep -n "variant\|size" apps/web-shop/src/components/ui/button.tsx | head -20
```

The existing component already has rich variants and modes. We:
- Add a `loading` prop that shows `<Loader2 className="animate-spin" />` + disables click
- Add a `fullWidth` variant (sets `w-full`)
- Change default `rounded-md` → `rounded-xl` on `lg`/`md` sizes (soft-round brand style)

- [ ] **Step 2: Apply minimal edits (keep all existing variants — don't break callers)**

Edit `button.tsx`:
- In `size` variants, change `rounded-md` to `rounded-xl` for `lg`, `md` (keep `sm` at `rounded-lg`)
- Add compound variant for `loading: true`:

```typescript
// In cva variants block add:
loading: {
  true:  'pointer-events-none',
  false: '',
},

// defaultVariants add:
loading: false,
```

Then in the `Button` function body, when `loading === true`, render `<Loader2 className="animate-spin mr-2 size-4" />` before children.

Add `fullWidth` similarly — a new variant key that maps `true → 'w-full'`.

- [ ] **Step 3: Demo story**

```tsx
// apps/web-shop/src/stories/button.story.tsx
import { Button } from '@/components/ui/button';
import { ArrowRight, LogIn } from 'lucide-react';

export default function ButtonStory() {
  return (
    <div className="p-8 space-y-6">
      <section className="space-y-2">
        <h2 className="text-xl font-bold">Variants</h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">primary</Button>
          <Button variant="mono">mono</Button>
          <Button variant="outline">outline</Button>
          <Button variant="ghost">ghost</Button>
          <Button variant="destructive">destructive</Button>
          <Button variant="dim">dim</Button>
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-bold">Sizes</h2>
        <div className="flex flex-wrap gap-3 items-center">
          <Button size="sm">small</Button>
          <Button size="md">medium</Button>
          <Button size="lg">large</Button>
          <Button size="icon" aria-label="next"><ArrowRight /></Button>
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-bold">States</h2>
        <div className="flex flex-wrap gap-3">
          <Button>default</Button>
          <Button disabled>disabled</Button>
          <Button loading>loading</Button>
          <Button fullWidth>full width</Button>
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-bold">With icons</h2>
        <div className="flex flex-wrap gap-3">
          <Button><LogIn /> Sign in</Button>
          <Button variant="outline">Continue <ArrowRight /></Button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Type check + commit**

```bash
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web-shop/src/components/ui/button.tsx apps/web-shop/src/stories/button.story.tsx
git -c commit.gpgsign=false commit -m "feat(shop-v2): Button — add loading/fullWidth + rounded-xl default

Existing 10 variants × 4 sizes preserved. Adds:
- loading prop (spinner + pointer-events:none)
- fullWidth prop
- rounded-xl on md/lg (was rounded-md) to match brand soft-round aesthetic

No caller breakage — all new props default false, rounded-lg kept on sm.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.5: Input + Label refresh

**Files:**
- Modify: `apps/web-shop/src/components/ui/input.tsx` (add InputAddon slot + clear button)
- Modify: `apps/web-shop/src/components/ui/label.tsx` (add required marker + help/error text slots)
- Create: `apps/web-shop/src/stories/input.story.tsx`

- [ ] **Step 1: Read current Input + Label**

```bash
cat apps/web-shop/src/components/ui/input.tsx
cat apps/web-shop/src/components/ui/label.tsx
```

- [ ] **Step 2: Extend Input — add addon support**

Add to `input.tsx`:

```typescript
// New exported helper alongside Input
interface InputAddonProps extends React.HTMLAttributes<HTMLSpanElement> {
  side?: 'start' | 'end';
}
export function InputAddon({ side = 'start', className, children, ...props }: InputAddonProps) {
  return (
    <span
      className={cn(
        'flex items-center px-3 text-sm text-muted-foreground bg-muted border border-input',
        side === 'start' ? 'rounded-l-lg border-r-0' : 'rounded-r-lg border-l-0',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

// InputGroup wrapper
export function InputGroup({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-stretch', className)} {...props}>
      {children}
    </div>
  );
}
```

When used as `<InputGroup><InputAddon>฿</InputAddon><Input className="rounded-l-none border-l-0" /></InputGroup>`, the ฿ prefix is visually attached.

- [ ] **Step 3: Extend Label — add required + help + error**

Replace `label.tsx` body:

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  help?: React.ReactNode;
  error?: React.ReactNode;
}

export function Label({ className, required, help, error, children, ...props }: LabelProps) {
  return (
    <div className="space-y-1">
      <label
        className={cn(
          'text-sm font-medium text-foreground leading-snug inline-flex items-center gap-1',
          className,
        )}
        {...props}
      >
        {children}
        {required && <span className="text-destructive" aria-hidden="true">*</span>}
      </label>
      {help && !error && (
        <p className="text-xs text-muted-foreground leading-snug">{help}</p>
      )}
      {error && (
        <p className="text-xs text-destructive leading-snug" role="alert">{error}</p>
      )}
    </div>
  );
}
```

Note: existing callers that pass just `<label>text</label>` get a wrapping `<div>` — that's fine for layout.

- [ ] **Step 4: Demo story**

```tsx
// apps/web-shop/src/stories/input.story.tsx
import { Input } from '@/components/ui/input';
import { InputAddon, InputGroup } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function InputStory() {
  return (
    <div className="p-8 space-y-6 max-w-md">
      <div>
        <Label htmlFor="name">ชื่อ-นามสกุล</Label>
        <Input id="name" placeholder="บีม ทดสอบ" />
      </div>
      <div>
        <Label htmlFor="phone" required help="เบอร์ 10 หลัก">เบอร์โทรศัพท์</Label>
        <Input id="phone" placeholder="0812345678" />
      </div>
      <div>
        <Label htmlFor="id" required error="เลขบัตรประชาชน 13 หลัก">เลขบัตรประชาชน</Label>
        <Input id="id" defaultValue="12345" aria-invalid="true" />
      </div>
      <div>
        <Label htmlFor="amount">จำนวนเงิน</Label>
        <InputGroup>
          <InputAddon>฿</InputAddon>
          <Input id="amount" type="number" className="rounded-l-none border-l-0" placeholder="9000" />
        </InputGroup>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Type check + commit**

```bash
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web-shop/src/components/ui/input.tsx apps/web-shop/src/components/ui/label.tsx apps/web-shop/src/stories/input.story.tsx
git -c commit.gpgsign=false commit -m "feat(shop-v2): Input addon/group + Label required/help/error

- Adds <InputAddon /> + <InputGroup /> so we can build '฿ price'
  prefixed inputs without hacks.
- Label grows a required marker (*), help text (muted), error text
  (destructive + role=alert). Existing callers still work — label
  was previously just a className passthrough.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.6: Card refresh — 4 patterns

**Files:**
- Modify: `apps/web-shop/src/components/ui/card.tsx`
- Create: `apps/web-shop/src/stories/card.story.tsx`

- [ ] **Step 1: Read current Card**

```bash
cat apps/web-shop/src/components/ui/card.tsx
```

- [ ] **Step 2: Expand Card with `variant` prop**

Replace the existing export with:

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

type CardVariant = 'plain' | 'elevated' | 'outlined' | 'interactive';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const variantClass: Record<CardVariant, string> = {
  plain:       'bg-card',
  elevated:    'bg-card shadow-md',
  outlined:    'bg-card border border-zinc-200',
  interactive: 'bg-card border border-zinc-200 hover:shadow-lg hover:border-emerald-200 transition-all duration-base cursor-pointer',
};

export function Card({ variant = 'outlined', className, ...props }: CardProps) {
  return (
    <div
      className={cn('rounded-2xl overflow-hidden', variantClass[variant], className)}
      data-slot="card"
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 md:p-6 border-b border-zinc-200', className)} {...props} />;
}
export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 md:p-6', className)} {...props} />;
}
export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 md:p-6 border-t border-zinc-200 bg-zinc-50', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-xl font-semibold leading-snug', className)} {...props} />;
}
```

- [ ] **Step 3: Demo story + commit (follows same pattern as above)**

```tsx
// apps/web-shop/src/stories/card.story.tsx
import { Card, CardHeader, CardBody, CardFooter, CardTitle } from '@/components/ui/card';

export default function CardStory() {
  return (
    <div className="p-8 grid md:grid-cols-2 gap-4">
      {(['plain','elevated','outlined','interactive'] as const).map((v) => (
        <Card key={v} variant={v}>
          <CardHeader><CardTitle>{v} card</CardTitle></CardHeader>
          <CardBody>
            <p className="text-sm text-muted-foreground leading-snug">
              ตัวอย่าง body ข้อความภาษาไทย สระ ิ ี ุ ูู ้  ป็ ก็
            </p>
          </CardBody>
          <CardFooter>footer</CardFooter>
        </Card>
      ))}
    </div>
  );
}
```

```bash
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web-shop/src/components/ui/card.tsx apps/web-shop/src/stories/card.story.tsx
git -c commit.gpgsign=false commit -m "feat(shop-v2): Card — 4 variants + Header/Body/Footer/Title slots

plain | elevated | outlined (default) | interactive (hover emerald ring).
rounded-2xl + overflow-hidden. Consistent padding across slots.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.7: Dialog refresh (minor — transition polish)

**Files:**
- Modify: `apps/web-shop/src/components/ui/dialog.tsx`

- [ ] **Step 1: Read current Dialog**

```bash
cat apps/web-shop/src/components/ui/dialog.tsx
```

- [ ] **Step 2: Ensure transition uses new tokens**

The Radix Dialog likely already has mount animations. Update the `DialogOverlay` / `DialogContent` classNames to:
- Use `duration-medium` for enter/exit
- Use `ease-out-quad` for enter, `ease-in-out-quint` for exit
- `rounded-2xl` on content

If the existing component is already solid, just check it compiles and commit as a no-op or small tweak.

- [ ] **Step 3: Type check + commit (may be a no-op if dialog is already healthy)**

```bash
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git diff --exit-code apps/web-shop/src/components/ui/dialog.tsx && echo "no change — skip commit" || {
  git add apps/web-shop/src/components/ui/dialog.tsx
  git -c commit.gpgsign=false commit -m "feat(shop-v2): Dialog — align transitions with motion tokens

rounded-2xl content, duration-medium enter/exit using ease-out-quad +
ease-in-out-quint respectively. Respects prefers-reduced-motion
globally via the motion.css rule.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
}
```

### Task 1.8: Phase 1 checkpoint

- [ ] **Step 1: Full type + build**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
./tools/check-types.sh all 2>&1 | tail -3
cd apps/web-shop && npm run build 2>&1 | tail -5
```

Expected: all green. Bundle size reported.

- [ ] **Step 2: Log Phase 1 complete**

```bash
git log --oneline origin/main..HEAD
```

Expected: 7-8 commits — tokens + 6 primitives (Badge, Skeleton, Button-refresh, Input/Label-refresh, Card-refresh, Dialog-refresh).

---

## Phase 2 — Composites + layouts + motion

Build composites + lock their public APIs. After this phase, Phase 3 subagents can only import from these — they cannot edit them.

### Task 2.1: Layout primitives (Container, Stack, Row, Section)

**Files:**
- Create: `apps/web-shop/src/components/layout/Container.tsx`
- Create: `apps/web-shop/src/components/layout/Stack.tsx`
- Create: `apps/web-shop/src/components/layout/Row.tsx`
- Create: `apps/web-shop/src/components/layout/Section.tsx`
- Create: `apps/web-shop/src/components/layout/StickyBottomBar.tsx`
- Create: `apps/web-shop/src/components/layout/SectionHeader.tsx`

- [ ] **Step 1: Container**

```tsx
// apps/web-shop/src/components/layout/Container.tsx
import { cn } from '@/lib/utils';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  narrow?: boolean;
}

export function Container({ size = 'xl', narrow, className, ...props }: Props) {
  const max = narrow ? 'max-w-xl' : {
    sm: 'max-w-2xl',
    md: 'max-w-4xl',
    lg: 'max-w-5xl',
    xl: 'max-w-7xl',
    full: 'max-w-none',
  }[size];
  return <div className={cn('mx-auto w-full px-4 md:px-6', max, className)} {...props} />;
}
```

- [ ] **Step 2: Stack**

```tsx
// apps/web-shop/src/components/layout/Stack.tsx
import { cn } from '@/lib/utils';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  gap?: 1 | 2 | 3 | 4 | 6 | 8 | 12 | 16;
}
const gapClass = { 1: 'gap-1', 2: 'gap-2', 3: 'gap-3', 4: 'gap-4', 6: 'gap-6', 8: 'gap-8', 12: 'gap-12', 16: 'gap-16' } as const;

export function Stack({ gap = 4, className, ...props }: Props) {
  return <div className={cn('flex flex-col', gapClass[gap], className)} {...props} />;
}
```

- [ ] **Step 3: Row**

```tsx
// apps/web-shop/src/components/layout/Row.tsx
import { cn } from '@/lib/utils';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  gap?: 1 | 2 | 3 | 4 | 6 | 8;
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between';
  wrap?: boolean;
}
const gapClass = { 1: 'gap-1', 2: 'gap-2', 3: 'gap-3', 4: 'gap-4', 6: 'gap-6', 8: 'gap-8' };

export function Row({ gap = 4, align = 'center', justify = 'start', wrap, className, ...props }: Props) {
  return (
    <div
      className={cn(
        'flex',
        `items-${align}`,
        `justify-${justify}`,
        gapClass[gap],
        wrap && 'flex-wrap',
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 4: Section**

```tsx
// apps/web-shop/src/components/layout/Section.tsx
import { cn } from '@/lib/utils';

interface Props extends React.HTMLAttributes<HTMLElement> {
  tone?: 'default' | 'muted' | 'emerald' | 'sand';
  padding?: 'sm' | 'md' | 'lg';
}
const toneClass = {
  default: '',
  muted: 'bg-muted/40',
  emerald: 'bg-emerald-50',
  sand: 'bg-sand-50',
};
const padClass = { sm: 'py-8 md:py-10', md: 'py-12 md:py-16', lg: 'py-16 md:py-24' };

export function Section({ tone = 'default', padding = 'md', className, ...props }: Props) {
  return <section className={cn(toneClass[tone], padClass[padding], className)} {...props} />;
}
```

- [ ] **Step 5: StickyBottomBar (mobile thumb-zone CTA)**

```tsx
// apps/web-shop/src/components/layout/StickyBottomBar.tsx
import { cn } from '@/lib/utils';

export function StickyBottomBar({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'md:hidden fixed inset-x-0 bottom-0 z-30',
        'bg-background/95 backdrop-blur border-t border-zinc-200',
        'px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Use inside page layouts to reserve space for the fixed bar so content
    isn't hidden behind it on mobile. */
export function StickyBottomBarSpacer() {
  return <div className="md:hidden h-20" aria-hidden="true" />;
}
```

- [ ] **Step 6: SectionHeader**

```tsx
// apps/web-shop/src/components/layout/SectionHeader.tsx
import { cn } from '@/lib/utils';
import { Link } from 'react-router';

interface Props {
  title: string;
  description?: string;
  cta?: { label: string; to: string };
  align?: 'left' | 'center';
  className?: string;
}

export function SectionHeader({ title, description, cta, align = 'left', className }: Props) {
  return (
    <div
      className={cn(
        'mb-6 md:mb-8 flex gap-4',
        align === 'center' ? 'flex-col items-center text-center' : 'items-end justify-between',
        className,
      )}
    >
      <div className="space-y-1">
        <h2 className="text-2xl md:text-3xl font-bold leading-snug">{title}</h2>
        {description && (
          <p className="text-sm md:text-base text-muted-foreground leading-snug">{description}</p>
        )}
      </div>
      {cta && (
        <Link
          to={cta.to}
          className="text-sm font-medium text-emerald-600 hover:text-emerald-700 leading-snug whitespace-nowrap"
        >
          {cta.label} →
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Type check + commit**

```bash
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web-shop/src/components/layout/Container.tsx apps/web-shop/src/components/layout/Stack.tsx apps/web-shop/src/components/layout/Row.tsx apps/web-shop/src/components/layout/Section.tsx apps/web-shop/src/components/layout/StickyBottomBar.tsx apps/web-shop/src/components/layout/SectionHeader.tsx
git -c commit.gpgsign=false commit -m "feat(shop-v2): layout primitives — Container/Stack/Row/Section + StickyBottomBar + SectionHeader

Core scaffolding every page composes with. Container has 5 widths +
narrow override for forms. Stack (vertical) and Row (horizontal) take
gap/align/justify props so pages don't reinvent flex wrappers.
StickyBottomBar implements the mobile thumb-zone pattern + spacer
helper to prevent content overlap. SectionHeader pairs heading with
optional CTA link.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.2: Motion helpers

**Files:**
- Create: `apps/web-shop/src/components/motion/useMotionPrefs.ts`
- Create: `apps/web-shop/src/components/motion/Reveal.tsx`
- Create: `apps/web-shop/src/components/motion/StaggerChildren.tsx`

- [ ] **Step 1: useMotionPrefs**

```typescript
// apps/web-shop/src/components/motion/useMotionPrefs.ts
import { useEffect, useState } from 'react';

export function useMotionPrefs() {
  const [reduce, setReduce] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => setReduce(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return { reduce };
}
```

- [ ] **Step 2: Reveal (IntersectionObserver-triggered fade-up)**

```tsx
// apps/web-shop/src/components/motion/Reveal.tsx
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  once?: boolean;
  rootMargin?: string;
}

export function Reveal({ once = true, rootMargin = '0px 0px -10% 0px', className, children, ...props }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          if (once) io.disconnect();
        } else if (!once) {
          setVisible(false);
        }
      },
      { rootMargin },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [once, rootMargin]);

  return (
    <div ref={ref} className={cn('reveal', visible && 'in-view', className)} {...props}>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: StaggerChildren**

```tsx
// apps/web-shop/src/components/motion/StaggerChildren.tsx
import { Children, cloneElement, isValidElement } from 'react';
import { cn } from '@/lib/utils';
import { Reveal } from './Reveal';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  stagger?: number;
}

export function StaggerChildren({ stagger = 50, className, children, ...props }: Props) {
  return (
    <div className={cn('stagger', className)} {...props}>
      {Children.map(children, (child, i) => (
        <div style={{ ['--stagger-index' as string]: i }}>
          {isValidElement(child) ? cloneElement(child) : child}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Type check + commit**

```bash
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web-shop/src/components/motion/
git -c commit.gpgsign=false commit -m "feat(shop-v2): motion helpers — useMotionPrefs + Reveal + StaggerChildren

CSS-only (no framer-motion). Reveal uses IntersectionObserver + a
.in-view class toggle on the .reveal base, mapped to opacity + translateY
in motion.css. StaggerChildren sets --stagger-index on each child so the
transition-delay cascades 50ms. All respect prefers-reduced-motion via
the global @media rule in motion.css.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.3: States — Empty/Loading/Error + StatefulList

**Files:**
- Create: `apps/web-shop/src/components/states/EmptyState.tsx`
- Create: `apps/web-shop/src/components/states/ErrorState.tsx`
- Create: `apps/web-shop/src/components/states/LoadingState.tsx`
- Create: `apps/web-shop/src/components/states/StatefulList.tsx`

- [ ] **Step 1: EmptyState**

```tsx
// apps/web-shop/src/components/states/EmptyState.tsx
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

interface Props {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  cta?: { label: string; to: string };
}

export function EmptyState({ icon, title, description, cta }: Props) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4 leading-snug">
      {icon && <div className="text-5xl text-zinc-300 mb-4" aria-hidden="true">{icon}</div>}
      <h3 className="text-xl font-semibold">{title}</h3>
      {description && <p className="mt-2 text-sm text-muted-foreground max-w-sm">{description}</p>}
      {cta && (
        <Button asChild variant="primary" className="mt-6" size="lg">
          <Link to={cta.to}>{cta.label}</Link>
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: ErrorState**

```tsx
// apps/web-shop/src/components/states/ErrorState.tsx
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'เกิดข้อผิดพลาด',
  description = 'ลองกดโหลดใหม่อีกครั้ง หรือเปิดหน้านี้ใหม่',
  onRetry,
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4 leading-snug">
      <AlertCircle className="size-12 text-destructive mb-4" aria-hidden="true" />
      <h3 className="text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm">{description}</p>
      {onRetry && (
        <Button variant="outline" className="mt-6" onClick={onRetry} size="lg">
          <RefreshCw className="size-4" /> โหลดใหม่
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: LoadingState**

```tsx
// apps/web-shop/src/components/states/LoadingState.tsx
import { Skeleton } from '@/components/ui/skeleton';

interface Props {
  rows?: number;
  variant?: 'card-grid' | 'list' | 'detail';
}

export function LoadingState({ rows = 6, variant = 'card-grid' }: Props) {
  if (variant === 'card-grid') {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton shape="thumbnail" />
            <Skeleton shape="line" />
            <Skeleton shape="line" className="w-2/3" />
          </div>
        ))}
      </div>
    );
  }
  if (variant === 'list') {
    return (
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} shape="line" className="h-16" />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <Skeleton shape="thumbnail" className="aspect-video max-w-2xl" />
      <div className="space-y-2">
        <Skeleton shape="line" />
        <Skeleton shape="line" className="w-3/4" />
        <Skeleton shape="line" className="w-1/2" />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: StatefulList — generic renderer**

```tsx
// apps/web-shop/src/components/states/StatefulList.tsx
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';

interface StatefulListProps<T> {
  isLoading: boolean;
  isError: boolean;
  data: T[] | undefined;
  renderItem: (item: T, index: number) => React.ReactNode;
  emptyState: Omit<React.ComponentProps<typeof EmptyState>, 'children'>;
  onRetry?: () => void;
  loadingVariant?: 'card-grid' | 'list' | 'detail';
  wrapperClassName?: string;
}

export function StatefulList<T>({
  isLoading,
  isError,
  data,
  renderItem,
  emptyState,
  onRetry,
  loadingVariant = 'card-grid',
  wrapperClassName,
}: StatefulListProps<T>) {
  if (isLoading) return <LoadingState variant={loadingVariant} />;
  if (isError) return <ErrorState onRetry={onRetry} />;
  if (!data || data.length === 0) return <EmptyState {...emptyState} />;
  return <div className={wrapperClassName}>{data.map((item, i) => renderItem(item, i))}</div>;
}
```

- [ ] **Step 5: Type check + commit**

```bash
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web-shop/src/components/states/
git -c commit.gpgsign=false commit -m "feat(shop-v2): state components — Empty/Error/Loading + StatefulList

Pages that render lists now wrap their useQuery with <StatefulList>
and never worry about the four states (loading/error/empty/data).
LoadingState has three variants matching the common shapes
(card-grid, list, detail). ErrorState has a retry CTA; EmptyState
has an optional action CTA.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.4: TrustStrip

**Files:**
- Create: `apps/web-shop/src/components/shop/TrustStrip.tsx`

- [ ] **Step 1: Component**

```tsx
// apps/web-shop/src/components/shop/TrustStrip.tsx
import { ShieldCheck, Wallet, MessageCircle, BadgeCheck } from 'lucide-react';

interface Item {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const DEFAULT_ITEMS: Item[] = [
  {
    icon: <ShieldCheck className="size-6" />,
    title: 'รับประกันร้าน 30 วัน',
    description: 'ครอบคลุมปัญหาการใช้งานปกติ',
  },
  {
    icon: <BadgeCheck className="size-6" />,
    title: 'ตรวจสอบ 30 จุด',
    description: 'เครื่องทุกเครื่องผ่านเช็คมาตรฐาน',
  },
  {
    icon: <Wallet className="size-6" />,
    title: 'ผ่อนได้บัตร ปชช. ใบเดียว',
    description: '3-12 งวด ไม่ต้องใช้บัตรเครดิต',
  },
  {
    icon: <MessageCircle className="size-6" />,
    title: 'ติดต่อผ่าน LINE',
    description: 'ทีมงานตอบไวในเวลาทำการ',
  },
];

interface Props {
  items?: Item[];
  className?: string;
}

export function TrustStrip({ items = DEFAULT_ITEMS, className }: Props) {
  return (
    <div className={className}>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3 leading-snug">
            <span className="text-emerald-500 shrink-0">{item.icon}</span>
            <div className="space-y-0.5">
              <div className="text-sm font-semibold">{item.title}</div>
              <div className="text-xs text-muted-foreground">{item.description}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Type check + commit**

```bash
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web-shop/src/components/shop/TrustStrip.tsx
git -c commit.gpgsign=false commit -m "feat(shop-v2): TrustStrip — 4 warranty + payment + support cues

Default items cover the four value props from the spec: 30-day
shop warranty, 30-point inspection (Gazelle-inspired), national-ID
installment (our core differentiator), LINE contact. Items prop lets
pages override when a different story fits (e.g. checkout page).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.5: Hero variants

**Files:**
- Create: `apps/web-shop/src/components/hero/HomeHero.tsx`
- Create: `apps/web-shop/src/components/hero/CategoryHero.tsx`
- Create: `apps/web-shop/src/components/hero/LandingHero.tsx`

- [ ] **Step 1: HomeHero (staff photo + headline + CTA)**

```tsx
// apps/web-shop/src/components/hero/HomeHero.tsx
import { Link } from 'react-router';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/layout/Container';
import { media } from '@/lib/media-placeholders';
import { Reveal } from '@/components/motion/Reveal';

export function HomeHero() {
  return (
    <section className="relative overflow-hidden bg-emerald-50">
      {/* soft background gradient */}
      <div
        className="absolute inset-0 opacity-60 pointer-events-none"
        style={{
          background:
            'radial-gradient(1200px 500px at 20% 0%, rgba(29,180,70,0.15), transparent 60%)',
        }}
      />
      <Container>
        <div className="relative grid md:grid-cols-2 gap-8 items-center py-10 md:py-16">
          <Reveal>
            <div className="space-y-5 leading-snug">
              <h1 className="text-4xl md:text-5xl font-bold text-zinc-900">
                iPhone มือสองคุณภาพ<br />
                <span className="text-emerald-600">ผ่อนได้บัตร ปชช. ใบเดียว</span>
              </h1>
              <p className="text-base md:text-lg text-zinc-700 max-w-md">
                ร้านมือถือลพบุรี ของแท้ 100% รับประกันร้าน 30 วัน
                ตรวจสอบ 30 จุดก่อนส่งมอบ
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Button asChild size="lg" variant="primary">
                  <Link to="/products">ดูสินค้าทั้งหมด <ArrowRight className="size-4" /></Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <a href="https://line.me/R/ti/p/@bestchoice" target="_blank" rel="noopener">
                    <MessageCircle className="size-4" /> ทักไลน์
                  </a>
                </Button>
              </div>
            </div>
          </Reveal>
          <Reveal className="hidden md:block">
            <img
              src={media('hero.home')}
              alt="ร้าน BESTCHOICE ลพบุรี"
              className="rounded-3xl shadow-xl w-full object-cover aspect-square bg-white"
              loading="eager"
            />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
```

- [ ] **Step 2: CategoryHero (thinner, title + breadcrumb)**

```tsx
// apps/web-shop/src/components/hero/CategoryHero.tsx
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { Container } from '@/components/layout/Container';

interface Breadcrumb { label: string; to?: string; }
interface Props {
  title: string;
  description?: string;
  breadcrumbs?: Breadcrumb[];
}

export function CategoryHero({ title, description, breadcrumbs }: Props) {
  return (
    <section className="bg-zinc-50 border-b border-zinc-200">
      <Container>
        <div className="py-6 md:py-8 space-y-2 leading-snug">
          {breadcrumbs && (
            <nav className="text-xs text-muted-foreground flex items-center flex-wrap">
              {breadcrumbs.map((b, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  {b.to ? (
                    <Link to={b.to} className="hover:text-emerald-600">{b.label}</Link>
                  ) : (
                    <span>{b.label}</span>
                  )}
                  {i < breadcrumbs.length - 1 && <ChevronRight className="size-3" />}
                </span>
              ))}
            </nav>
          )}
          <h1 className="text-2xl md:text-3xl font-bold">{title}</h1>
          {description && <p className="text-sm md:text-base text-muted-foreground max-w-2xl">{description}</p>}
        </div>
      </Container>
    </section>
  );
}
```

- [ ] **Step 3: LandingHero (service explainer for trade-in/buyback/saving-plan)**

```tsx
// apps/web-shop/src/components/hero/LandingHero.tsx
import { Container } from '@/components/layout/Container';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router';
import { Reveal } from '@/components/motion/Reveal';

interface Step { icon: React.ReactNode; title: string; description: string; }
interface Props {
  eyebrow?: string;
  title: string;
  description: string;
  cta: { label: string; to: string };
  steps?: Step[];
}

export function LandingHero({ eyebrow, title, description, cta, steps }: Props) {
  return (
    <section className="bg-gradient-to-b from-emerald-50 to-background">
      <Container>
        <div className="py-10 md:py-16 space-y-10 leading-snug">
          <Reveal>
            <div className="space-y-4 text-center md:text-left max-w-2xl">
              {eyebrow && <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">{eyebrow}</span>}
              <h1 className="text-3xl md:text-4xl font-bold">{title}</h1>
              <p className="text-base md:text-lg text-muted-foreground">{description}</p>
              <Button asChild size="lg" variant="primary">
                <Link to={cta.to}>{cta.label}</Link>
              </Button>
            </div>
          </Reveal>
          {steps && (
            <div className="grid md:grid-cols-3 gap-4">
              {steps.map((s, i) => (
                <Reveal key={i}>
                  <div className="rounded-2xl bg-card border border-zinc-200 p-4 shadow-sm space-y-2">
                    <div className="text-emerald-500">{s.icon}</div>
                    <div className="font-semibold">{s.title}</div>
                    <p className="text-sm text-muted-foreground">{s.description}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </Container>
    </section>
  );
}
```

- [ ] **Step 4: Type check + commit**

```bash
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web-shop/src/components/hero/
git -c commit.gpgsign=false commit -m "feat(shop-v2): Hero variants — Home/Category/Landing

HomeHero pairs staff photo (from media-placeholders) with headline +
LINE CTA. CategoryHero gives lists a breadcrumb + title header.
LandingHero wraps service explainers (trade-in / buyback / saving-plan)
with 3-step optional cards.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.6: ProductCard (refresh existing)

**Files:**
- Modify: `apps/web-shop/src/components/catalog/ProductCard.tsx` (rewrite to use new primitives)

- [ ] **Step 1: Inspect current**

```bash
cat apps/web-shop/src/components/catalog/ProductCard.tsx
```

- [ ] **Step 2: Rewrite with condition badge + monthly installment**

```tsx
// apps/web-shop/src/components/catalog/ProductCard.tsx
import { Link } from 'react-router';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface ProductGroup {
  brand: string;
  model: string;
  minPrice: number;
  stockCount: number;
  thumbnailUrl?: string;
  monthlyPaymentFrom: number;
  conditionGrades: string[];
  stock: { display: string; tone: string };
}

interface Props {
  product: ProductGroup;
}

function conditionVariant(g: string) {
  return g === 'A' ? 'condition-a' : g === 'B' ? 'condition-b' : 'condition-c';
}

export function ProductCard({ product: p }: Props) {
  const to = `/products?brand=${p.brand}&model=${encodeURIComponent(p.model)}`;
  return (
    <Card variant="interactive" className="flex flex-col">
      <Link to={to} className="flex flex-col h-full">
        <div className="relative bg-zinc-50 aspect-square flex items-center justify-center">
          {p.thumbnailUrl ? (
            <img
              src={p.thumbnailUrl}
              alt={`${p.brand} ${p.model}`}
              className="max-h-full max-w-full object-contain"
              loading="lazy"
            />
          ) : (
            <div className="text-zinc-400 text-sm">ไม่มีรูป</div>
          )}
          {p.conditionGrades.length > 0 && (
            <div className="absolute top-3 left-3 flex gap-1">
              {p.conditionGrades.map((g) => (
                <Badge key={g} variant={conditionVariant(g)} size="sm">{g}</Badge>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 flex-1 flex flex-col gap-1 leading-snug">
          <div className="font-semibold text-zinc-900">
            {p.brand} {p.model}
          </div>
          <div className="text-emerald-600 font-bold text-lg">
            เริ่มต้น ฿{p.minPrice.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground">
            ผ่อนเริ่ม ฿{p.monthlyPaymentFrom.toLocaleString()}/เดือน
          </div>
          <div
            className={cn(
              'text-xs mt-auto pt-2',
              p.stock.tone === 'urgent' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {p.stock.display}
          </div>
        </div>
      </Link>
    </Card>
  );
}
```

- [ ] **Step 3: Type check + commit**

```bash
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web-shop/src/components/catalog/ProductCard.tsx
git -c commit.gpgsign=false commit -m "feat(shop-v2): ProductCard — condition badge + monthly installment + interactive Card

Uses Card variant=interactive (emerald hover ring), shows condition
grade badges (A/B/C) top-left, emerald minPrice, muted monthly from
line, urgent red stock line when tone=urgent. No ad-hoc borders or
hex colors.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.7: FloatingLineButton + ReviewCard refresh (delegated to subagent)

**Files:**
- Modify: `apps/web-shop/src/components/layout/FloatingLineButton.tsx`
- Modify: `apps/web-shop/src/components/reviews/ReviewCard.tsx`

- [ ] **Step 1: Dispatch 1 subagent for these two refreshes**

Use the Agent tool with subagent_type `general-purpose`. Prompt:

```
You are implementing two small component refreshes in the shop-v2 worktree at
/Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design/.
CWD is set there.

Refresh these two components to match the shop-v2 design system from
docs/superpowers/specs/2026-04-22-shop-v2-design-system.md §5.1 tokens
and §5.2 composites:

1) apps/web-shop/src/components/layout/FloatingLineButton.tsx
   - Desktop: bottom-left side rail (not just icon — include "ทักไลน์"
     label when viewport ≥ md), rounded-full bg-emerald-500 text-white
     shadow-xl hover:bg-emerald-600 transition-transform hover:scale-105
   - Mobile: bottom-left FAB (48x48), rounded-full, emerald bg, LINE icon
     from lucide-react (MessageCircle or custom SVG — use MessageCircle),
     positions above StickyBottomBar (use `bottom-20` to leave space)
   - aria-label="ติดต่อผ่าน LINE"
   - Links to https://line.me/R/ti/p/@bestchoice
   - Uses leading-snug, rounded-xl, respects prefers-reduced-motion

2) apps/web-shop/src/components/reviews/ReviewCard.tsx
   - Card variant=outlined
   - Row layout: avatar (stub if no photo — zinc-100 circle with first-letter)
     + name + verified Badge (variant=success, small) + date
   - Stars row (reuse the existing ReviewStars component)
   - Title (semibold if present)
   - Comment body (text-sm, max 4 lines mobile, full desktop)
   - Optional LINE-chat-screenshot slot — if review has a photoUrl
     field, render as <img className="rounded-lg mt-2 max-h-64 object-contain"/>
   - Use leading-snug on all Thai text

Verify:
- cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3 → 0 errors
- No raw hex colors
- No emoji

Commit each component separately:
- feat(shop-v2): FloatingLineButton — label on desktop, FAB on mobile
- feat(shop-v2): ReviewCard — outlined + verified badge + optional LINE screenshot

Both commits get:
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

Report in <200 words: files modified, 2 commit SHAs, any deviations.
```

- [ ] **Step 2: Verify after subagent returns**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git log --oneline -3
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
```

### Task 2.8: Stepper extraction

**Files:**
- Create: `apps/web-shop/src/components/ui/Stepper.tsx` (extract + polish)
- Modify: `apps/web-shop/src/components/checkout/CheckoutStepper.tsx` (delegate to new Stepper)

- [ ] **Step 1: Read current inline stepper**

```bash
cat apps/web-shop/src/components/checkout/CheckoutStepper.tsx
```

- [ ] **Step 2: Create reusable Stepper primitive**

```tsx
// apps/web-shop/src/components/ui/Stepper.tsx
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StepperStep {
  label: string;
  description?: string;
}

interface Props {
  steps: StepperStep[];
  current: number; // 1-indexed
  className?: string;
}

export function Stepper({ steps, current, className }: Props) {
  return (
    <ol className={cn('flex items-start', className)}>
      {steps.map((step, i) => {
        const idx = i + 1;
        const state = idx < current ? 'done' : idx === current ? 'active' : 'future';
        return (
          <li key={i} className="flex-1 flex flex-col items-center text-center relative">
            {i > 0 && (
              <div
                className={cn(
                  'absolute top-4 -left-1/2 right-1/2 h-0.5',
                  idx <= current ? 'bg-emerald-500' : 'bg-zinc-200',
                )}
                aria-hidden="true"
              />
            )}
            <div
              className={cn(
                'relative size-8 rounded-full flex items-center justify-center font-semibold text-sm z-10',
                state === 'done' && 'bg-emerald-500 text-white',
                state === 'active' && 'bg-emerald-500 text-white ring-4 ring-emerald-100',
                state === 'future' && 'bg-zinc-100 text-zinc-400',
              )}
            >
              {state === 'done' ? <Check className="size-4" /> : idx}
            </div>
            <div className="mt-2 space-y-0.5 leading-snug">
              <div className={cn('text-xs font-medium', state === 'future' ? 'text-muted-foreground' : 'text-foreground')}>
                {step.label}
              </div>
              {step.description && <div className="text-xs text-muted-foreground hidden md:block">{step.description}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 3: Rewrite CheckoutStepper to delegate**

```tsx
// apps/web-shop/src/components/checkout/CheckoutStepper.tsx
import { Stepper } from '@/components/ui/Stepper';

interface Props { current: 1 | 2 | 3; }

const STEPS = [
  { label: 'ที่อยู่', description: 'ข้อมูลจัดส่ง' },
  { label: 'จัดส่ง', description: 'เลือกวิธีจัดส่ง' },
  { label: 'ชำระเงิน', description: 'เลือกช่องทาง' },
];

export default function CheckoutStepper({ current }: Props) {
  return <Stepper steps={STEPS} current={current} />;
}
```

- [ ] **Step 4: Type check + commit**

```bash
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web-shop/src/components/ui/Stepper.tsx apps/web-shop/src/components/checkout/CheckoutStepper.tsx
git -c commit.gpgsign=false commit -m "feat(shop-v2): extract Stepper primitive + refactor CheckoutStepper

Reusable for other multi-step flows (trade-in submit, saving-plan
create, etc.). Rings around active step for extra emphasis. Checkmark
on completed. Labels always visible; descriptions hidden on mobile
to keep the stepper single-row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.9: Shared modules — media-placeholders + copy

**Files:**
- Create: `apps/web-shop/src/lib/media-placeholders.ts`
- Create: `apps/web-shop/src/lib/copy.ts`
- Create: `apps/web-shop/public/media/` (directory with placeholder assets — small files)

- [ ] **Step 1: media-placeholders.ts (URL map — real assets dropped in Step 2)**

```typescript
// apps/web-shop/src/lib/media-placeholders.ts
/**
 * Central photo/illustration URL map. Swap entries here to upgrade
 * from placeholders to real photography — no component change needed.
 *
 * All /media/*.jpg assets are committed under apps/web-shop/public/media/
 * (small AI-abstract + Unsplash placeholders). Apple press photos link
 * out to apple.com's CDN (license: authorized reseller use).
 */

export const mediaPlaceholders = {
  // Hero + branding
  'hero.home':      '/media/hero-home.jpg',
  'hero.catalog':   '/media/hero-catalog.jpg',
  'hero.apply':     '/media/hero-apply.jpg',
  'hero.trade-in':  '/media/hero-trade-in.jpg',
  'hero.buyback':   '/media/hero-buyback.jpg',
  'hero.saving':    '/media/hero-saving.jpg',
  'og.default':     '/media/og-default.jpg',

  // Staff + shop
  'staff.owner':    '/media/staff-owner.jpg',
  'staff.team':     '/media/staff-team.jpg',
  'shop.interior':  '/media/shop-interior.jpg',
  'shop.map':       '/media/shop-map.jpg',

  // Product placeholders (fallbacks when DB.gallery is empty)
  'product.placeholder': '/media/product-placeholder.jpg',
} as const;

export type MediaKey = keyof typeof mediaPlaceholders;
export function media(key: MediaKey): string {
  return mediaPlaceholders[key];
}
```

- [ ] **Step 2: Drop placeholder assets into public/media/**

Create the directory and put a 1×1 transparent PNG as a stand-in so the first build doesn't 404. Real placeholder JPEGs will be added in a separate commit once we select a source.

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
mkdir -p apps/web-shop/public/media
# Generate a 1x1 transparent PNG as a multi-use placeholder
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x35\x81\x84\x00\x00\x00\x00IEND\xaeB`\x82' > apps/web-shop/public/media/placeholder.png

# For every key in media-placeholders.ts, create a symlink OR copy to placeholder.png
for f in hero-home hero-catalog hero-apply hero-trade-in hero-buyback hero-saving og-default staff-owner staff-team shop-interior shop-map product-placeholder; do
  cp apps/web-shop/public/media/placeholder.png "apps/web-shop/public/media/${f}.jpg"
done
ls apps/web-shop/public/media/ | head
```

Note: these are **intentionally blank transparent pixels** for now. The real hero/staff images get swapped in a follow-up commit (see Phase 4 or post-merge — not a blocker).

- [ ] **Step 3: copy.ts — Thai microcopy constants**

```typescript
// apps/web-shop/src/lib/copy.ts
/**
 * Thai user-facing microcopy. Centralizing makes tone consistent and
 * eases future i18n. Keys follow <page>.<element> naming.
 */

export const copy = {
  common: {
    loading: 'กำลังโหลด...',
    error: 'เกิดข้อผิดพลาด',
    retry: 'ลองใหม่',
    cancel: 'ยกเลิก',
    save: 'บันทึก',
    confirm: 'ยืนยัน',
    close: 'ปิด',
    next: 'ถัดไป',
    back: 'กลับ',
    viewAll: 'ดูทั้งหมด',
    contactLine: 'ทักไลน์',
  },

  home: {
    heroTitle: 'iPhone มือสองคุณภาพ\nผ่อนได้บัตร ปชช. ใบเดียว',
    heroDescription: 'ร้านมือถือลพบุรี ของแท้ 100% รับประกันร้าน 30 วัน ตรวจสอบ 30 จุดก่อนส่งมอบ',
    featuredTitle: 'รุ่นยอดนิยม',
    whyUsTitle: 'ทำไมเลือก BESTCHOICE',
    testimonialsTitle: 'ลูกค้าพูดถึงเรา',
  },

  catalog: {
    pageTitle: 'สินค้าทั้งหมด',
    filterBrand: 'ยี่ห้อ',
    filterCondition: 'สภาพ',
    filterPrice: 'ราคา',
    sortPopular: 'ยอดนิยม',
    sortPriceAsc: 'ราคาต่ำ → สูง',
    sortPriceDesc: 'ราคาสูง → ต่ำ',
    emptyTitle: 'ไม่พบสินค้าตามตัวกรอง',
    emptyDescription: 'ลองเปลี่ยนยี่ห้อหรือช่วงราคา',
  },

  product: {
    reserveCta: 'จองเครื่องนี้ 15 นาที',
    specTitle: 'รายละเอียดสินค้า',
    conditionAFull: 'เกรด A — สภาพดีมาก เหมือนใหม่',
    conditionBFull: 'เกรด B — สภาพใช้งาน มีรอยเล็กน้อย',
    conditionCFull: 'เกรด C — สภาพมีรอย หรือตำหนิ',
  },

  cart: {
    pageTitle: 'ตะกร้าของคุณ',
    emptyTitle: 'ตะกร้าว่าง',
    emptyDescription: 'ลองเลือกสินค้าจากหน้ารุ่นยอดนิยม',
    emptyCta: 'ดูสินค้าทั้งหมด',
    proceedCta: 'ไปชำระเงิน',
    reservationExpireSoon: 'การจองจะหมดอายุในไม่ช้า',
    reservationExpired: 'การจองหมดอายุแล้ว — กรุณาจองใหม่',
  },

  checkout: {
    stepAddress: 'ที่อยู่',
    stepShipping: 'จัดส่ง',
    stepPayment: 'ชำระเงิน',
    placeOrderCta: 'ยืนยันสั่งซื้อ',
  },

  apply: {
    pageTitle: 'สมัครผ่อน',
    fullName: 'ชื่อ-นามสกุล',
    phone: 'เบอร์โทร',
    nationalId: 'เลขบัตรประชาชน',
    downPayment: 'จำนวนเงินดาวน์',
    totalMonths: 'จำนวนงวด (เดือน)',
    notes: 'หมายเหตุ (ถ้ามี)',
    submitCta: 'ส่งใบสมัคร',
    pdpaNotice: 'ข้อมูลของคุณถูกเก็บภายใต้นโยบาย PDPA — ใช้เพื่อประเมินสินเชื่อเท่านั้น',
    successTitle: 'ส่งใบสมัครแล้ว',
    successDescription: 'ทีมงานจะติดต่อกลับภายใน 2 ชั่วโมง (เวลาทำการ 09:00–20:00)',
  },

  tradeIn: {
    pageTitle: 'เก่าแลกใหม่',
    description: 'ตีราคามือถือเก่าสูงสุด ฿15,000 พร้อมซื้อเครื่องใหม่ในร้าน',
    submitCta: 'เริ่มทำเรื่อง',
  },

  buyback: {
    pageTitle: 'รับซื้อมือถือ',
    description: 'รับซื้อมือถือมือสองของแท้ พร้อมจ่ายเงินสดหรือโอนทันที',
    quoteCta: 'ตีราคาเบื้องต้น',
  },

  savingPlan: {
    pageTitle: 'ออมดาวน์',
    description: 'เก็บเงินดาวน์ทีละน้อย เริ่ม ฿500/เดือน',
    createCta: 'สร้างแผน',
  },

  review: {
    verifiedBadge: 'ซื้อจริง',
    writeCta: 'เขียนรีวิว',
    emptyTitle: 'ยังไม่มีรีวิว',
    emptyDescription: 'เป็นคนแรกที่รีวิวสินค้านี้',
  },
} as const;
```

- [ ] **Step 4: Type check + commit**

```bash
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web-shop/src/lib/media-placeholders.ts apps/web-shop/src/lib/copy.ts apps/web-shop/public/media/
git -c commit.gpgsign=false commit -m "feat(shop-v2): shared modules — media() resolver + Thai copy constants

Every page imports imagery via media('key') so swapping placeholders
for real photos later is a one-file change. Every Thai user-facing
string lives in copy.ts keyed by page.element — makes tone consistent
+ eases future i18n.

The /public/media/*.jpg files are currently 1x1 transparent PNGs —
real AI-abstract + Unsplash placeholders are swapped in a follow-up
commit without code changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.10: Phase 2 checkpoint — API freeze + barrel export

**Files:**
- Create: `apps/web-shop/src/components/index.ts` (barrel export; lockfile for subagents)

- [ ] **Step 1: Barrel export of the public surface Phase 3 can use**

```typescript
// apps/web-shop/src/components/index.ts
/**
 * FROZEN API for Phase 3 subagents. Add nothing else to this file.
 * Subagents compose pages from ONLY these exports; they may NOT
 * import anything else from the library (e.g. cva variants internals).
 */

// UI primitives
export { Button } from './ui/button';
export { Input, InputAddon, InputGroup } from './ui/input';
export { Label } from './ui/label';
export { Card, CardHeader, CardBody, CardFooter, CardTitle } from './ui/card';
export { Badge } from './ui/badge';
export { Skeleton } from './ui/skeleton';
export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
export { Stepper, type StepperStep } from './ui/Stepper';

// Layout
export { Container } from './layout/Container';
export { Stack } from './layout/Stack';
export { Row } from './layout/Row';
export { Section } from './layout/Section';
export { StickyBottomBar, StickyBottomBarSpacer } from './layout/StickyBottomBar';
export { SectionHeader } from './layout/SectionHeader';

// Shop composites
export { TrustStrip } from './shop/TrustStrip';
export { ProductCard, type ProductGroup } from './catalog/ProductCard';

// Hero
export { HomeHero } from './hero/HomeHero';
export { CategoryHero } from './hero/CategoryHero';
export { LandingHero } from './hero/LandingHero';

// States
export { EmptyState } from './states/EmptyState';
export { ErrorState } from './states/ErrorState';
export { LoadingState } from './states/LoadingState';
export { StatefulList } from './states/StatefulList';

// Motion
export { Reveal } from './motion/Reveal';
export { StaggerChildren } from './motion/StaggerChildren';
export { useMotionPrefs } from './motion/useMotionPrefs';

// Reviews
export { default as ReviewStars } from './reviews/ReviewStars';
export { default as ReviewCard } from './reviews/ReviewCard';
export { default as ReviewsSection } from './reviews/ReviewsSection';
export { default as CreateReviewForm } from './reviews/CreateReviewForm';
```

- [ ] **Step 2: Type check + build + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
./tools/check-types.sh all 2>&1 | tail -3
cd apps/web-shop && npm run build 2>&1 | tail -5
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web-shop/src/components/index.ts
git -c commit.gpgsign=false commit -m "feat(shop-v2): freeze Phase 2 API via components/index.ts barrel

This barrel is the ONLY surface Phase 3 subagents may import from.
Adding more to it later is allowed; removing is not. Locks the
component contract for parallel page redesigns.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Phase 2 diff summary**

```bash
git log --oneline origin/main..HEAD
```

Expected: ~17-18 commits total (Phase 1's 8 + Phase 2's ~10).

---

## Phase 3 — Parallel page redesign (5 subagent clusters)

Five subagents run in parallel. Each gets an identical *context* block + a cluster-specific *tasks* block. They commit to dedicated branches; orchestrator fast-forward merges into the main redesign branch.

### Task 3.0: Shared context block (referenced in every dispatch)

**This is the context every subagent needs. Do not inline it five times — each subagent dispatch in the tasks below references this section.**

```
You are a subagent redesigning one cluster of pages in the shop-v2 worktree
at /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design/. CWD is
set there; use absolute paths when you cd.

CRITICAL CONSTRAINTS:
1. Import ONLY from the frozen barrel at '@/components' (or './components/...'
   when editing). Do NOT reach into @/components/ui/button and similar —
   everything you need is exported at the top level.
2. Do NOT create new components, new CSS files, new Tailwind config entries,
   or new colors. If you need one, STOP and report to the orchestrator.
3. All user-facing Thai strings must use copy from '@/lib/copy'. If a string
   is missing, add it to copy.ts and note it in your report.
4. All images must use media('key') from '@/lib/media-placeholders'. Never
   hardcode URLs. If a needed key is missing, add it and note it.
5. Thai text blocks must have leading-snug (no exceptions — vowels clip otherwise).
6. No raw hex colors. No emoji. Use lucide-react icons only.
7. Preserve every existing data-testid attribute on interactive elements —
   Playwright smoke tests depend on them. Do not rename.
8. Preserve every existing form-validation rule and onSubmit behavior.
   You may reorganize visually, but the form's fields, names, and submit
   URL/body MUST NOT change.
9. Every page must wrap in <ShopLayout>. Every form page must include
   <StickyBottomBar> on mobile with the primary CTA, plus <StickyBottomBarSpacer/>
   before </ShopLayout>.
10. Every query that returns a list must wrap with <StatefulList> —
    no manual isLoading/isError/empty branches.

DESIGN LANGUAGE (Hybrid — iStudio warmth + Gazelle trust + Apple TH installment
transparency + LINE-OA local character):
- bg-background or bg-zinc-50 sections; bg-emerald-50 for callouts
- rounded-2xl cards, rounded-xl buttons/inputs
- emerald-500 primary; condition-a/b/c badges for used-iPhone grades
- generous whitespace, 1 primary action per page (mobile bottom bar)
- floating LINE button already in ShopLayout — don't re-add

VERIFY before committing:
- cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3   → 0 errors
- Visit the page in the dev server (if set up) OR do a visual mental walkthrough

COMMIT each completed page as its own commit on your branch:
- Branch name: shop-v2-cluster-<X>   (X = A/B/C/D/E as assigned)
- Message: feat(shop-v2): redesign <PageName>
- Every commit includes:
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

REPORT back in under 300 words:
- (a) files modified with brief rationale per page
- (b) any added keys to copy.ts or media-placeholders.ts
- (c) any deviations from design language
- (d) branch name + N commit SHAs
- (e) anything the orchestrator should double-check
```

### Task 3.A: Cluster A — Browse (Home + Catalog + ProductDetail)

- [ ] **Step 1: Dispatch subagent A**

Use the Agent tool with subagent_type `general-purpose`, name `shop-v2-A-browse`, prompt:

```
[Include the full context block from Task 3.0 above]

YOUR CLUSTER — Browse (3 pages, ~3h):

Create branch `shop-v2-cluster-A` off the current feature/shop-v2-design HEAD.

Files to edit:
1) apps/web-shop/src/pages/HomePage.tsx
   - Replace the existing hero with <HomeHero /> (from @/components)
   - Add a <TrustStrip /> Section between hero and featured products
   - Featured products: use existing useQuery, wrap with <StatefulList>,
     render <ProductCard /> grid (2 col mobile, 4 col desktop)
   - Add a "Why us" Section with 3-4 value prop cards (use Card outlined +
     lucide icons). Copy from copy.home.whyUsTitle + custom list.
   - Add a testimonials Section — placeholder <div>สามรีวิวจากลูกค้า</div>
     grid — we'll fill real reviews via ReviewsSection later. For now,
     just a 3-column grid of ReviewCard with 3 fake examples from copy.

2) apps/web-shop/src/pages/CatalogPage.tsx
   - Use <CategoryHero title={copy.catalog.pageTitle} breadcrumbs=[{label:'หน้าแรก',to:'/'},{label:copy.catalog.pageTitle}] />
   - Filter sidebar: keep existing <FilterSidebar /> on desktop (md:col-span-1);
     on mobile, render as a <Dialog> trigger "ตัวกรอง" button at top of list
   - Sort dropdown stays as-is
   - Product grid wrapped in <StatefulList loadingVariant="card-grid"
     emptyState={{icon:<Search/>, title:copy.catalog.emptyTitle,
     description:copy.catalog.emptyDescription}}>
   - Apply analytics on mount: track('ViewContent',{content_type:'catalog'}) — existing logic

3) apps/web-shop/src/pages/ProductDetailPage.tsx
   - Photo gallery: main image + thumbnail row — use media('product.placeholder')
     as fallback when p.gallery is empty
   - Desktop 2-column: [gallery, details]; mobile stacked
   - Details column: model name (2xl), condition Badge row, spec list,
     price tier display (reuse existing tier logic but render with emerald-600
     font-bold text-3xl + monthly "฿X/เดือน" muted), reserve CTA
   - Reserve CTA: on mobile place in <StickyBottomBar>
   - Countdown Badge (existing ReservationCountdownBadge): top-right of details
   - <ReviewsSection /> below the main grid
   - <TrustStrip /> above the fold (below details, above ReviewsSection)
   - Track ViewContent + AddToCart exactly as existing code

Per-page commits on branch shop-v2-cluster-A. Merge nothing — orchestrator merges.
```

- [ ] **Step 2: After subagent reports, verify + fast-forward merge**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git fetch . shop-v2-cluster-A:shop-v2-cluster-A 2>&1 || git branch -f shop-v2-cluster-A shop-v2-cluster-A
git log --oneline feature/shop-v2-design..shop-v2-cluster-A
git merge --ff-only shop-v2-cluster-A 2>&1 | tail -3 || {
  echo "ff-only failed — inspect conflict"
  git status
}
cd apps/web-shop && npx tsc --noEmit 2>&1 | tail -3
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git branch -d shop-v2-cluster-A
```

### Task 3.B: Cluster B — Purchase (Cart + Checkout + OrderSuccess + Orders list/detail)

- [ ] **Step 1: Dispatch subagent B**

Subagent B prompt (context block + cluster):

```
[context block from Task 3.0]

YOUR CLUSTER — Purchase (5 pages, ~3h):

Create branch `shop-v2-cluster-B`.

1) apps/web-shop/src/pages/CartPage.tsx
   - <CategoryHero title={copy.cart.pageTitle} breadcrumbs=[{label:'หน้าแรก',to:'/'},{label:copy.cart.pageTitle}] />
   - Empty state: <EmptyState icon={<ShoppingCart/>} title={copy.cart.emptyTitle}
     description={copy.cart.emptyDescription} cta={{label:copy.cart.emptyCta,to:'/products'}} />
   - Item row: use <Card variant=outlined> with 3-column: thumbnail,
     name+price+reservation countdown, qty/remove
   - Sticky <OrderSummaryCard> on right (desktop); on mobile, total bar at top
   - Checkout CTA in <StickyBottomBar> on mobile

2) apps/web-shop/src/pages/CheckoutPage.tsx
   - <CheckoutStepper current={step} />
   - Step body inside <Card variant=elevated>
   - Right column (desktop): <OrderSummaryCard sticky>
   - Mobile: collapsible summary accordion at top using <Dialog> trigger
   - Next button in <StickyBottomBar> on mobile
   - Preserve all form fields + validations from existing AddressStep /
     ShippingStep / PaymentStep

3) apps/web-shop/src/pages/OrderSuccessPage.tsx
   - Centered illustration (use <CheckCircle2 className="size-20 text-emerald-500"/> — inline)
   - Big "สั่งซื้อสำเร็จ" (text-3xl font-bold)
   - <OrderStatusBadge status={data.status} /> row
   - Order info <Card>: order number, total, payment channel
   - Next steps list (3 items)
   - CTAs: "ดูคำสั่งซื้อ" (link to detail) + "กลับไปซื้อเพิ่ม" (link to /)
   - Keep the existing polling + Purchase analytics event

4) apps/web-shop/src/pages/OrdersPage.tsx
   - <CategoryHero title="คำสั่งซื้อของฉัน" />
   - <StatefulList loadingVariant="list" emptyState={{icon:<Package/>,title:'ยังไม่มีคำสั่งซื้อ',description:'ลองดูสินค้าและสั่งซื้อดูครับ',cta:{label:copy.common.viewAll,to:'/products'}}}>
     renders OrderCard rows (update existing OrderCard to use new Card variant=outlined + timeline mini)

5) apps/web-shop/src/pages/OrderDetailPage.tsx
   - <CategoryHero title={'คำสั่งซื้อ '+orderNumber} breadcrumbs=[{label:'คำสั่งซื้อของฉัน',to:'/orders'},{label:orderNumber}] />
   - Order timeline (vertical stepper) — use <Stepper> with steps matching status
   - Product card (Card variant=outlined)
   - Shipping address card
   - Payment info card
   - Actions bar (cancel / refund) if status allows — Button variant=destructive outline

Commit each page separately on shop-v2-cluster-B.
```

- [ ] **Step 2: Verify + merge (same pattern as Task 3.A)**

### Task 3.C: Cluster C — Account + Saving plans customer pages (6 pages)

- [ ] **Step 1: Dispatch subagent C**

```
[context block from Task 3.0]

YOUR CLUSTER — Account (6 pages, ~3h):

Create branch `shop-v2-cluster-C`.

1) apps/web-shop/src/pages/account/AccountPage.tsx
   - <CategoryHero title={customer.name} description={'สมาชิกตั้งแต่ '+joinedDate} />
   - Loyalty balance Card (elevated, emerald gradient bg)
   - Grid of 5 hub Cards (interactive, linked): ออเดอร์, ที่อยู่, แผนออมดาวน์, ใบสมัครผ่อน, ออกจากระบบ
   - Each hub card: icon + title + short description

2) apps/web-shop/src/pages/account/AddressBookPage.tsx
   - <StatefulList> rendering Card per address with default-pinned badge
   - "+ เพิ่มที่อยู่" button opens existing AddressForm in <Dialog>

3) apps/web-shop/src/pages/account/SavingPlansPage.tsx (account list)
   - <StatefulList> rendering Card per plan with PlanProgressBar
   - Empty state links to /saving-plan (landing)

4) apps/web-shop/src/pages/saving-plan/SavingPlanLandingPage.tsx
   - <LandingHero eyebrow="บริการเสริม" title={copy.savingPlan.pageTitle} description={copy.savingPlan.description} cta={{label:copy.savingPlan.createCta,to:'/saving-plan/create'}} steps=[3 steps] />

5) apps/web-shop/src/pages/saving-plan/SavingPlanCreatePage.tsx
   - Form in Card elevated
   - target amount Input with ฿ InputAddon
   - PlanCalculator component (existing)
   - Submit in StickyBottomBar on mobile

6) apps/web-shop/src/pages/saving-plan/SavingPlanDetailPage.tsx
   - Header with planNumber
   - PlanProgressBar + totals card
   - Pay CTA Button primary lg
   - PaymentHistoryTable
   - Use StatefulList if loading

Commits per page on shop-v2-cluster-C.
```

- [ ] **Step 2: Verify + merge**

### Task 3.D: Cluster D — Apply + Trade-in + Buyback (9 pages)

- [ ] **Step 1: Dispatch subagent D**

```
[context block from Task 3.0]

YOUR CLUSTER — Apply/Services (9 pages, ~3h):

Create branch `shop-v2-cluster-D`.

1) apps/web-shop/src/pages/apply/InstallmentApplyPage.tsx
   - <CategoryHero title={copy.apply.pageTitle} breadcrumbs=[...] />
   - Product recap card (if productId query returns data)
   - Form in Card elevated: use copy.apply.* labels
   - Right column (desktop): live monthly calc preview card
   - Submit in StickyBottomBar on mobile
   - PDPA notice muted at bottom

2) apps/web-shop/src/pages/apply/ApplySuccessPage.tsx
   - Centered <CheckCircle2 size 20 emerald-500>
   - copy.apply.successTitle + successDescription
   - 3-step "next steps" list
   - "ทักไลน์" CTA prominent
   - "กลับหน้าแรก" secondary

3) apps/web-shop/src/pages/trade-in/TradeInLandingPage.tsx
   - <LandingHero eyebrow="บริการเสริม" title={copy.tradeIn.pageTitle} description={copy.tradeIn.description} cta={{label:copy.tradeIn.submitCta,to:'/trade-in/submit'}} steps=[3 steps] />

4) apps/web-shop/src/pages/trade-in/TradeInSubmitPage.tsx
   - Stepper (4 steps: device / spec / photos / seller)
   - Form wrapped in Card elevated
   - DeviceSelector + DeviceSpecForm + PhotoUploadGrid + seller fields
   - ValuationDisplay shown as user completes device + spec
   - Submit in StickyBottomBar on mobile

5) apps/web-shop/src/pages/trade-in/TradeInStatusPage.tsx
   - Stepper horizontal showing status
   - Offered price card (emerald emphasis)
   - Device photos gallery
   - Actions: "ยอมรับราคา" / "ปฏิเสธ" Buttons

6) apps/web-shop/src/pages/buyback/BuybackLandingPage.tsx
   - Mirror trade-in landing with copy.buyback.*

7) apps/web-shop/src/pages/buyback/BuybackQuickQuotePage.tsx
   - DeviceSelector + condition radio in Card
   - Quote button -> ValuationDisplay
   - "ส่งรูปเพื่อราคาจริง" CTA to /buyback/submit

8) apps/web-shop/src/pages/buyback/BuybackSubmitPage.tsx
   - Same as TradeInSubmitPage but POST to /api/shop/buyback/submit
   - No target product field

9) apps/web-shop/src/pages/buyback/BuybackStatusPage.tsx
   - Mirror TradeInStatusPage with buyback endpoint

Commits per page on shop-v2-cluster-D.
```

- [ ] **Step 2: Verify + merge**

### Task 3.E: Cluster E — Info pages (5 pages)

- [ ] **Step 1: Dispatch subagent E**

```
[context block from Task 3.0]

YOUR CLUSTER — Info (5 pages, ~1h):

Create branch `shop-v2-cluster-E`.

Template for ALL 5 pages: <CategoryHero> + <Container> + <Stack> of
content <Card variant=outlined> blocks + closing <TrustStrip /> on Home/Shipping/Returns.

1) apps/web-shop/src/pages/HowItWorksPage.tsx
   - Hero: title "วิธีซื้อและผ่อน"
   - Stepper-style list (visual, not interactive) of 6 steps:
     เลือกเครื่อง -> จอง 15 นาที -> กรอกใบสมัคร -> นัดหมายที่สาขา -> ชำระดาวน์ -> รับเครื่อง + เริ่มผ่อน
   - "คำถามที่พบบ่อย" Section — 5 cards

2) apps/web-shop/src/pages/ShippingPage.tsx
   - Hero: title "การจัดส่ง"
   - Card per shipping method (5 methods) — reuse the shop-shipping service data
   - Card: "รับเองที่สาขา" — hours + address + map placeholder

3) apps/web-shop/src/pages/ReturnsPage.tsx
   - Hero: title "การคืน/เปลี่ยนสินค้า"
   - Cards: "รับประกันร้าน 30 วัน" + "นโยบายคืนเงิน" + "วิธีติดต่อ"

4) apps/web-shop/src/pages/AboutPage.tsx
   - Hero: title "เกี่ยวกับเรา"
   - Staff photo (media('staff.team')) + story copy
   - Timeline card: ก่อตั้ง / จำนวนลูกค้า / สาขา

5) apps/web-shop/src/pages/ContactPage.tsx
   - Hero: title "ติดต่อเรา"
   - LINE + phone Cards with big CTAs
   - Existing /shop/contact form stays; wrap with Card elevated + stickyBottomBar submit

Commits per page on shop-v2-cluster-E.
```

- [ ] **Step 2: Verify + merge**

### Task 3.F: Integration checkpoint

- [ ] **Step 1: Full type check across entire redesign**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
./tools/check-types.sh all 2>&1 | tail -5
cd apps/web-shop && npm run build 2>&1 | tail -10
```

Expected: 0 TS errors, build succeeds, bundle ≤ 750 KB gzipped.

- [ ] **Step 2: Log Phase 3 commits**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git log --oneline origin/main..HEAD | wc -l
git log --oneline origin/main..HEAD
```

Expected: ~45-50 total commits (Phase 1: 8 + Phase 2: 10 + Phase 3: 28).

---

## Phase 4 — QA + PR

### Task 4.1: Smoke test suite

**Files:**
- Create: `apps/web/e2e/shop-v2-smoke.spec.ts`

- [ ] **Step 1: Write smoke spec**

```typescript
// apps/web/e2e/shop-v2-smoke.spec.ts
import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.SHOP_URL || 'http://localhost:5174';

async function waitLoad(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' });
}

test.describe('shop v2 smoke', () => {
  test('home shows product cards', async ({ page }) => {
    await waitLoad(page, BASE + '/');
    const cards = await page.locator('[data-slot="card"]').count();
    expect(cards).toBeGreaterThan(0);
  });

  test('catalog loads + filter renders', async ({ page }) => {
    await waitLoad(page, BASE + '/products');
    await expect(page.locator('h1')).toContainText('สินค้าทั้งหมด');
  });

  test('checkout redirects to login if not authed', async ({ page }) => {
    await waitLoad(page, BASE + '/checkout');
    // should navigate to /login or /cart depending on flow
    expect(page.url()).toMatch(/login|cart|checkout/);
  });

  test('apply form validates phone', async ({ page }) => {
    await waitLoad(page, BASE + '/apply/00000000-0000-0000-0000-000000000000');
    // missing product should render graceful error or still show form — either is fine
    // key: page mounts, no JS error
    await expect(page).toHaveTitle(/BESTCHOICE/);
  });

  test('trade-in landing has CTA to submit', async ({ page }) => {
    await waitLoad(page, BASE + '/trade-in');
    const cta = page.getByRole('link', { name: /เริ่มทำเรื่อง/ });
    await expect(cta).toBeVisible();
  });

  test('saving plan landing has CTA', async ({ page }) => {
    await waitLoad(page, BASE + '/saving-plan');
    await expect(page.getByRole('link', { name: /สร้างแผน/ })).toBeVisible();
  });

  test('floating LINE button present on every page', async ({ page }) => {
    for (const path of ['/', '/products', '/apply/x', '/trade-in', '/saving-plan']) {
      await waitLoad(page, BASE + path);
      await expect(page.getByLabel('ติดต่อผ่าน LINE')).toBeVisible();
    }
  });

  test('reduced motion respected', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await waitLoad(page, BASE + '/');
    const reveal = page.locator('.reveal').first();
    if (await reveal.count()) {
      const style = await reveal.evaluate((el) => getComputedStyle(el).transitionDuration);
      expect(style === '0.001ms' || style === '0s').toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run against local dev server**

In two terminals:
```bash
# terminal 1 — serve
cd .worktrees/shop-v2-design/apps/web-shop && npm run dev

# terminal 2 — test
cd .worktrees/shop-v2-design/apps/web
SHOP_URL=http://localhost:5174 npx playwright test e2e/shop-v2-smoke.spec.ts --reporter=list 2>&1 | tail -20
```

Expected: 8 passed.

- [ ] **Step 3: Commit the spec**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git add apps/web/e2e/shop-v2-smoke.spec.ts
git -c commit.gpgsign=false commit -m "test(shop-v2): smoke suite — 8 critical flows

home/catalog/checkout/apply/trade-in/saving-plan/LINE-button/reduced-motion.
Skipped in CI until prod URL is set; run locally against npm run dev.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.2: Lighthouse mobile audit

- [ ] **Step 1: Install lhci (root)**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
npx --yes @lhci/cli@0.14 --version 2>&1 | tail -2
```

- [ ] **Step 2: Run Lighthouse against dev**

With dev server running on 5174:
```bash
npx --yes @lhci/cli@0.14 autorun \
  --collect.url=http://localhost:5174/ \
  --collect.url=http://localhost:5174/products \
  --collect.settings.preset=mobile \
  --assert.preset=lighthouse:recommended \
  --upload.target=filesystem \
  --upload.outputDir=./lhci-report 2>&1 | tail -30
```

Expected: performance ≥ 90, accessibility ≥ 95. If below, note failing audits and iterate on the top 3.

- [ ] **Step 3: Do NOT commit lhci-report (add to .gitignore locally, inspect then remove)**

```bash
echo "lhci-report/" >> apps/web-shop/.gitignore
git add apps/web-shop/.gitignore
rm -rf apps/web-shop/lhci-report
```

### Task 4.3: Bundle size check

- [ ] **Step 1: Measure gzipped bundle**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design/apps/web-shop
npm run build 2>&1 | grep -E "gzip|CSS|JS" | tail -10
```

Read the "gzip:" column of `dist/assets/index-*.js` — must be ≤ 250 KB (current baseline was 168 KB + new components).

- [ ] **Step 2: If exceeds budget, identify contributors**

```bash
npx --yes source-map-explorer dist/assets/index-*.js --html /tmp/bundle.html
open /tmp/bundle.html
```

Then code-split or remove bloat.

### Task 4.4: Manual a11y pass

- [ ] **Step 1: Tab-through every page**

Open the dev server, for each of these pages:
- `/`, `/products`, `/cart`, `/checkout`, `/account`, `/apply/<id>`, `/trade-in`, `/saving-plan`

Press Tab continuously — every interactive element should receive a visible focus ring. Nothing should be reachable via keyboard that shouldn't be, and vice versa.

- [ ] **Step 2: Zoom 200%**

Zoom in Chrome DevTools to 200% on mobile frame (390px). Verify no horizontal scroll, no overlap, Thai vowel marks not clipped.

- [ ] **Step 3: Reduced motion**

DevTools → Rendering → Emulate CSS media feature prefers-reduced-motion → reduce. Reload. Reveal components should render instantly, no fade.

- [ ] **Step 4: Note issues and fix inline (commit each fix)**

### Task 4.5: Push + open PR

- [ ] **Step 1: Push the branch**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/shop-v2-design
git push -u origin feature/shop-v2-design 2>&1 | tail -3
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --base main --head feature/shop-v2-design \
  --title "feat(shop-v2): full redesign — design system + 28 pages" \
  --body "$(cat <<'EOF'
## Summary
Big-bang visual redesign of `apps/web-shop`. Rebuilds the design system from scratch (tokens, 22 shared components) and applies it to all 28 pages in a single PR from an isolated worktree.

**Spec:** [docs/superpowers/specs/2026-04-22-shop-v2-design-system.md](docs/superpowers/specs/2026-04-22-shop-v2-design-system.md)
**Plan:** [docs/superpowers/plans/2026-04-22-shop-v2-implementation.md](docs/superpowers/plans/2026-04-22-shop-v2-implementation.md)

Decisions locked in brainstorming:
- Phasing **A** — design system first
- Aesthetic **1** — Hybrid (iStudio + Gazelle + Apple TH + LINE-OA)
- Photography **E** — phased placeholders, real shoot later (swap via `media-placeholders.ts`)
- Ship **B** — big-bang PR from worktree

## Changes
- Design tokens: emerald + zinc + sand scales, emerald-tinted shadows, motion tokens
- 7 primitives (5 refresh + 2 new: Badge, Skeleton)
- 8 composites (Hero × 3, ProductCard, TrustStrip, Stepper, FloatingLineButton, ReviewCard, SectionHeader)
- 4 layout primitives (Container, Stack, Row, Section) + StickyBottomBar helper
- 3 motion helpers (useMotionPrefs, Reveal, StaggerChildren) — CSS-only, no framer-motion
- Shared modules: `media-placeholders.ts`, `copy.ts`
- 28 pages rebuilt against the frozen component library

## Verification
- API TypeScript: 0 errors
- Web TypeScript: 0 errors
- web-shop TypeScript: 0 errors
- web-shop build: bundle XXX KB gzipped (target ≤ 250 KB)
- Playwright smoke: 8/8 passed
- Lighthouse mobile: perf YY / a11y ZZ
- Manual a11y: tab-through clean, no focus traps, reduced-motion honored

## Deferred (post-merge)
- Real photography (swap `media-placeholders.ts`)
- 360° spinner on ProductDetailPage
- Dark mode token pass
- i18n (Thai + English)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" 2>&1 | tail -3
```

- [ ] **Step 3: Owner reviews + merges**

Wait for owner to review. On approval, they merge via the GitHub UI (or ask me and I'll run `gh pr merge <n> --merge` if authorized).

- [ ] **Step 4: Cleanup worktree after merge**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git worktree remove .worktrees/shop-v2-design --force
git branch -D feature/shop-v2-design 2>/dev/null || true
```

---

## Self-review checklist (for the implementer before merging)

- [ ] All 28 pages render without JS errors (open dev server, click every link)
- [ ] Form submissions still POST to the correct API endpoints with the same bodies
- [ ] Thai vowel marks not clipped anywhere (spot-check words: ที่ ปี่ ่ ็ ื)
- [ ] No raw hex colors in the diff (grep: `grep -rE "#[0-9a-fA-F]{3,8}" apps/web-shop/src/`)
- [ ] No emoji in the diff (grep for common emoji ranges)
- [ ] Every page has `<ShopLayout>` wrapper
- [ ] Every form page has `<StickyBottomBar>` on mobile with primary CTA
- [ ] Every list has `<StatefulList>` (no ad-hoc loading/empty/error branches)
- [ ] `lib/copy.ts` is the sole source for Thai user-facing strings (no raw Thai in JSX except micro-text)
- [ ] `lib/media-placeholders.ts` is the sole source for imagery (no hardcoded URLs)
- [ ] Bundle size ≤ 750 KB / 250 KB gzipped
- [ ] Lighthouse mobile ≥ 90 perf, ≥ 95 a11y
