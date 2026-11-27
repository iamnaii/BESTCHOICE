# Shop cookie consent + GA4 / Meta Pixel gate + privacy page — plan

Branch `feat/shop-cookie-consent` (worktree `.worktrees/shop-cookie-consent`, base `origin/main` @ `dac08e1e3`).
Owner brief: 2026-11-27. Mockup + policy draft: https://claude.ai/artifact/J4oRjKjTKiLJedQW93x9LG

## Owner decisions (2026-11-27)

1. Shop's own visit counter (`POST /api/shop/track`, `lib/tracking.ts`, `lib/session.ts`) **runs for everyone, unchanged** — classified "necessary", disclosed in the policy. No code change.
2. Trackers: GA4 (analytics category) + Facebook Pixel, TikTok Pixel, LINE Tag (marketing category).
3. Homepage Google Maps iframe → click-to-load button (Phase 2, copy needs approval).
4. Legal entity: บริษัท เบสท์ช้อยส์โฟน จำกัด.

## Global Constraints

- **No `git commit`, no `git push`, no PR, no deploy.** Leave all work uncommitted in the working tree. The owner orders commits explicitly.
- Touch only `apps/web-shop/**` (and, in Phase 2 only, `apps/api/src/modules/shop-public-config/**`). Do not touch `apps/web`, `apps/api` elsewhere, or `packages/**`.
- Phase 1 adds **no customer-visible text**. No banner, dialog, page or toast copy.
- Before the visitor consents to a category, and after they decline it, the app must make **no request** to: `googletagmanager.com`, `google-analytics.com`, `connect.facebook.net`, `facebook.com/tr`. Tracker `<script>` tags are created only inside the consent-gated install path.
- Consent is stored in `localStorage` under the key `bc_cookie_consent` as JSON `{ "version": 1, "analytics": boolean, "marketing": boolean, "decidedAt": "<ISO string>" }`. A stored value whose `version` differs from the current policy version counts as "not decided".
- `track()` in `apps/web-shop/src/lib/analytics.ts` is the only function in the app that sends an event to a third-party tracker.
- Official-doc facts to follow exactly (read 2026-11-27):
  - Google: `gtag('consent','default',{...})` must run before `gtag('js', …)` / `gtag('config', …)`. v2 keys: `ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`, values `'granted' | 'denied'`. Changes use `gtag('consent','update',{...})`. "Basic" consent mode = do not load the Google tag until the user consents.
  - Meta: `fbq('consent','revoke')` / `fbq('consent','grant')`; standard events are sent with `fbq('track', '<Name>', {...})` — `ViewContent` (`content_ids`, `content_type`, `content_name`, `value`, `currency`), `Contact`, `Lead`.
- Code style: Prettier (semi, singleQuote, printWidth 100, tabWidth 2). `@/` alias inside `apps/web-shop/src`. No raw `fetch`/`axios` — use `api` from `@/lib/api`.
- Verification commands (run from the repo root of this worktree):
  - Unit tests: `npm run test --workspace=apps/web-shop -- <path-to-test-file>`
  - Types: `npx tsc --noEmit -p apps/web-shop/tsconfig.json`
  - Lint (no autofix noise outside your files): `npx eslint "apps/web-shop/src/lib/**/*.{ts,tsx}" "apps/web-shop/src/hooks/**/*.{ts,tsx}"`

---

## Task 1: Consent store

**Files (create):** `apps/web-shop/src/lib/consent.ts`, `apps/web-shop/src/lib/consent.test.ts`, `apps/web-shop/src/hooks/useConsent.ts`

A framework-free store for the visitor's cookie choice, plus a thin React hook. Nothing here renders UI or loads a tracker.

### `lib/consent.ts` — exact public API

```ts
export const CONSENT_POLICY_VERSION = 1;
export const CONSENT_STORAGE_KEY = 'bc_cookie_consent';

export type ConsentCategory = 'analytics' | 'marketing';
export interface ConsentChoice {
  analytics: boolean;
  marketing: boolean;
}
export interface ConsentState extends ConsentChoice {
  /** false until the visitor has chosen under the current policy version */
  decided: boolean;
}

/** Current state. Returns the SAME object reference until the state changes. */
export function getConsentState(): ConsentState;
/** Persist a choice (stamps version + decidedAt), update state, notify listeners. */
export function saveConsent(choice: ConsentChoice): void;
/** Subscribe to changes; returns an unsubscribe function. */
export function subscribeConsent(listener: (state: ConsentState) => void): () => void;
/** True when the given category is currently consented. */
export function hasConsent(category: ConsentCategory): boolean;
/** Test-only: drop the in-memory state so the next read re-reads storage. */
export function __resetConsentForTest(): void;
```

### Behaviour

- First call to `getConsentState()` reads `localStorage[CONSENT_STORAGE_KEY]` once and caches the result in module memory. Later calls return the cached object (stable reference — required by `useSyncExternalStore`).
- Undecided state is `{ analytics: false, marketing: false, decided: false }`.
- Stored value is treated as undecided when: the key is missing; the JSON does not parse; it is not an object; `version !== CONSENT_POLICY_VERSION`; `analytics` or `marketing` is not a boolean; or `localStorage` access throws.
- `saveConsent` writes `{ version: CONSENT_POLICY_VERSION, analytics, marketing, decidedAt: new Date().toISOString() }`. If the write throws (private mode / blocked storage) the in-memory state still updates and listeners still fire — the choice then lasts for the page session only. It must never throw.
- `saveConsent` always replaces the state object with a new one and notifies every listener once, synchronously, even when the values are unchanged (the banner relies on `decided` flipping to true).
- Cross-tab sync: on the first read, when `window` exists, add one `storage` event listener. When an event arrives with `key === CONSENT_STORAGE_KEY` (or `key === null`, i.e. storage cleared), re-read storage, replace the state object and notify listeners.
- Safe without `window` (`typeof window === 'undefined'` → undecided state, no listeners attached).
- A listener that throws must not stop the other listeners.

### `hooks/useConsent.ts`

```ts
import { useSyncExternalStore } from 'react';
import { getConsentState, subscribeConsent, type ConsentState } from '@/lib/consent';

export function useConsent(): ConsentState {
  return useSyncExternalStore(subscribeConsent, getConsentState, getConsentState);
}
```

### Tests (`lib/consent.test.ts`, vitest + jsdom)

Call `__resetConsentForTest()` and `localStorage.clear()` in `beforeEach`. Cover at least:

1. No stored value → `{ analytics: false, marketing: false, decided: false }`.
2. Valid stored value with the current version → values returned, `decided: true`.
3. Stored value with `version: 0` → undecided.
4. Malformed JSON, a JSON array, and a value with a non-boolean `analytics` → each undecided.
5. `saveConsent({ analytics: true, marketing: false })` → storage contains `version: 1`, both flags and an ISO `decidedAt`; `getConsentState()` is `{ analytics: true, marketing: false, decided: true }`; `hasConsent('analytics')` true, `hasConsent('marketing')` false.
6. `getConsentState()` returns the identical reference on consecutive calls, and a different reference after `saveConsent`.
7. A subscribed listener is called once per `saveConsent` with the new state; after unsubscribing it is not called.
8. `localStorage.setItem` throwing (`vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); })`) → `saveConsent` does not throw and state still updates.
9. `localStorage.getItem` throwing → undecided, no throw.
10. Dispatching `new StorageEvent('storage', { key: CONSENT_STORAGE_KEY })` after writing a new value directly to `localStorage` → state reflects the new value and listeners fire.
11. A listener that throws does not prevent a second listener from being called.

---

## Task 2: Consent-gated trackers and a single `track()`

**Files:** rewrite `apps/web-shop/src/lib/analytics.ts`; create `apps/web-shop/src/lib/analytics.test.ts`. `apps/web-shop/src/main.tsx` keeps its single `initAnalytics()` call (no change expected).

Depends on Task 1's `lib/consent.ts` (API above — already in the tree).

### What exists today

`initAnalytics()` installs GA4 and the Meta Pixel as soon as an ID is known (env `VITE_GA4_ID` / `VITE_FB_PIXEL_ID`, then runtime `GET /api/shop/public-config/analytics` → `{ ga4MeasurementId, fbPixelId }`). `track(event, params)` calls `gtag('event', …)` and `fbq('trackCustom', …)` unconditionally. Keep the ID resolution (env first, runtime config after, runtime value wins when present; a failed config fetch is silent). Keep the existing GA4 and Meta loader snippets' behaviour (script URLs `https://www.googletagmanager.com/gtag/js?id=<ID>` and `https://connect.facebook.net/en_US/fbevents.js`).

### New public API

```ts
export type ContactChannel = 'line' | 'phone' | 'messenger';

export type ShopEvent =
  | { name: 'view_product'; productId: string; productName?: string; price?: number }
  | { name: 'contact'; channel: ContactChannel }
  | { name: 'sell_lead'; flow: string; model?: string; storage?: string; grade?: string };

/** Resolve tracker IDs, subscribe to consent, install the contact-click listener. Idempotent. */
export function initAnalytics(): void;
/** The only exit to third-party trackers. Sends to each installed tracker whose category is consented. Never throws. */
export function track(event: ShopEvent): void;
/** Maps an anchor href to a contact channel, or null. Exported for tests. */
export function contactChannelFromHref(href: string): ContactChannel | null;
```

### Gating rules

- GA4 belongs to category `analytics`; Meta Pixel belongs to `marketing`.
- A tracker is installed only when **both** its ID is known **and** `hasConsent(category)` is true. Evaluate this whenever either changes (consent subscription fires, env ID read at init, runtime config resolves).
- Never create a tracker `<script>` element, `window.gtag`, `window.dataLayer`, or `window.fbq` outside the install path.
- Install is idempotent per tracker (no second `<script>`).

### GA4 install (Consent Mode v2, basic)

In this order:

1. `window.dataLayer = window.dataLayer || []` and define `window.gtag` pushing `arguments`-style arrays (keep the existing stub shape).
2. `gtag('consent', 'default', { ad_storage, ad_user_data, ad_personalization, analytics_storage: 'granted' })` where the three `ad_*` values are `'granted'` when `hasConsent('marketing')`, else `'denied'`.
3. Append the gtag.js `<script async>` to `document.head`.
4. `gtag('js', new Date())`, then `gtag('config', measurementId)`.

While GA4 is installed and still consented: when marketing consent changes, call `gtag('consent', 'update', { ad_storage, ad_user_data, ad_personalization })` with the new values.

### Meta Pixel install

Existing loader, then `fbq('init', pixelId)` and `fbq('track', 'PageView')`.

### Withdrawal

When consent changes and an **installed** tracker's category is no longer consented:

1. Call the vendor's documented revoke: GA4 → `gtag('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })`; Meta → `fbq('consent', 'revoke')`.
2. Expire that tracker's first-party cookies, best effort: GA4 → every cookie named `_ga` or starting with `_ga_`; Meta → `_fbp`, `_fbc`. For each, write an expired cookie for `path=/` on the current hostname and on the registrable parent (hostname with a leading dot, and the hostname minus its first label with a leading dot when it has more than two labels).
3. After handling all trackers for that consent change, reload the page **once**: call `reloadPage()`. Export a mutable seam for tests:
   ```ts
   export const analyticsRuntime = { reload: () => window.location.reload() };
   ```
   and call `analyticsRuntime.reload()`. Rationale to put in a code comment: vendor docs do not guarantee an already-loaded tag stops all requests, and a reload under a denied choice guarantees the script is never loaded.

A tracker that was never installed needs no revoke and no reload.

### `track(event)` mapping

Send only to trackers that are installed **and** whose category is consented at call time. Wrap the whole body in try/catch (telemetry must never break the page).

| `event.name` | GA4 (`gtag('event', …)`) | Meta (`fbq('track', …)`) |
|---|---|---|
| `view_product` | `'view_item'`, `{ items: [{ item_id: productId, item_name: productName, price }], currency: 'THB', value: price }` — include `item_name` only when given; include `price`, `currency`, `value` only when `price` is a finite number | `'ViewContent'`, `{ content_ids: [productId], content_type: 'product', content_name: productName, value: price, currency: 'THB' }` — same optional-field rule |
| `contact` | `'contact'`, `{ method: channel }` (GA4 has no recommended contact event; this is a custom event) | `'Contact'` with no params object |
| `sell_lead` | `'generate_lead'`, `{ lead_source: 'sell_form', flow, model, storage, grade }` — omit undefined keys | `'Lead'` with no params object |

`fbq('trackCustom', …)` is no longer used anywhere.

### Contact-click listener

`initAnalytics()` adds one capture-phase `click` listener on `document` (once). On click, find `event.target.closest('a[href]')`; pass its `href` attribute to `contactChannelFromHref`; when non-null call `track({ name: 'contact', channel })`. The listener must not call `preventDefault` or otherwise alter navigation.

`contactChannelFromHref(href)`:
- starts with `tel:` → `'phone'`
- parses as a URL whose hostname is exactly `line.me` or `lin.ee` → `'line'` (`access.line.me` — the LINE Login authorize host — must return `null`)
- hostname exactly `m.me`, `www.messenger.com` or `messenger.com` → `'messenger'`
- anything else, including unparsable strings, `mailto:` and `https://www.facebook.com/...` → `null`

### Tests (`lib/analytics.test.ts`)

The module holds state, so load it fresh per test: `vi.resetModules()` then `await import('./analytics')` (and import `./consent` from the same fresh graph). Stub env IDs with `vi.stubEnv('VITE_GA4_ID', 'G-TEST')` / `vi.stubEnv('VITE_FB_PIXEL_ID', '123')` before importing. Mock `./api` so `api.get` rejects unless a test needs runtime config. In `beforeEach`: clear `localStorage`, remove all `<script>` elements from `document.head`/`document.body`, delete `window.gtag`, `window.dataLayer`, `window.fbq`, `window._fbq`; `vi.unstubAllEnvs()` in `afterEach`. Note: the Meta loader inserts before the first `<script>` in the document — add a dummy `<script>` to `document.head` in `beforeEach` so `getElementsByTagName('script')[0]` exists.

Cover at least:

1. IDs present, no decision → after `initAnalytics()` there is no `<script>` whose `src` contains `googletagmanager.com` or `connect.facebook.net`, and `window.gtag` / `window.fbq` are undefined.
2. Decision `{ analytics: false, marketing: false }` stored before init → same as 1.
3. Stored `{ analytics: true, marketing: false }` → gtag script present, fbevents script absent; `window.dataLayer` entries in order: `['consent','default',{ ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied', analytics_storage:'granted' }]` before `['js', …]` before `['config','G-TEST']`.
4. Stored `{ analytics: false, marketing: true }` → fbevents script present, gtag absent; the fbq queue contains `['init','123']` then `['track','PageView']`.
5. Undecided at init, then `saveConsent({ analytics: true, marketing: true })` → both scripts appear; calling `saveConsent` with the same values again does not add a second script of either kind.
6. GA4 installed with marketing denied, then `saveConsent({ analytics: true, marketing: true })` → `dataLayer` gains `['consent','update',{ ad_storage:'granted', ad_user_data:'granted', ad_personalization:'granted' }]`.
7. Both installed, then `saveConsent({ analytics: false, marketing: true })` → `dataLayer` gains a `consent update` with all four keys `'denied'`; `analyticsRuntime.reload` (replace with `vi.fn()`) called exactly once; a `_ga` cookie set beforehand is gone.
8. Both installed, then `saveConsent({ analytics: true, marketing: false })` → fbq queue gains `['consent','revoke']`; reload called once.
9. Undecided → `saveConsent({ analytics: false, marketing: false })` → reload not called.
10. Runtime config: no env IDs, `api.get` resolves `{ data: { ga4MeasurementId: 'G-RT', fbPixelId: null } }`, consent all true → after awaiting the microtask queue the gtag script `src` contains `id=G-RT`; no fbevents script.
11. `track({ name: 'view_product', productId: 'p1', productName: 'iPhone 15', price: 15900 })` with both installed → `dataLayer` contains `['event','view_item',{ items:[{ item_id:'p1', item_name:'iPhone 15', price:15900 }], currency:'THB', value:15900 }]` and the fbq queue contains `['track','ViewContent',{ content_ids:['p1'], content_type:'product', content_name:'iPhone 15', value:15900, currency:'THB' }]`.
12. `track({ name: 'view_product', productId: 'p1' })` → GA4 params are exactly `{ items: [{ item_id: 'p1' }] }`; Meta params exactly `{ content_ids: ['p1'], content_type: 'product' }`.
13. `track({ name: 'contact', channel: 'line' })` → GA4 `['event','contact',{ method:'line' }]`; fbq `['track','Contact']`.
14. `track({ name: 'sell_lead', flow: 'BUYBACK', model: 'iPhone 13' })` → GA4 `['event','generate_lead',{ lead_source:'sell_form', flow:'BUYBACK', model:'iPhone 13' }]`; fbq `['track','Lead']`.
15. Only analytics consented → `track` reaches GA4, and `window.fbq` is undefined. No decision → `track(...)` does not throw and creates neither global.
16. `contactChannelFromHref`: `tel:+66955678887` → phone; `https://line.me/R/ti/p/@bestchoice` → line; `https://line.me/R/oaMessage/%40bestchoice/?hi` → line; `https://lin.ee/abc` → line; `https://m.me/bestchoicelopburi?ref=p:1` → messenger; `https://access.line.me/oauth2/v2.1/authorize?x=1` → null; `https://www.facebook.com/bestchoicelopburi` → null; `mailto:a@b.c` → null; `'not a url'` → null.
17. After `initAnalytics()` with marketing consented, clicking an `<a href="tel:+66955678887">` appended to `document.body` (dispatch a bubbling `click` on a child `<span>` inside it) → fbq queue contains `['track','Contact']`. Calling `initAnalytics()` twice and clicking once still yields exactly one `Contact`.

In jsdom the fbq stub queues calls on `window.fbq.queue` (arguments arrays); `dataLayer` holds the argument arrays pushed by the gtag stub. Compare with `Array.from(entry)` when entries are `arguments` objects.

---

## Task 3: Wire events and add the prerender tripwire

**Files (modify):** `apps/web-shop/src/pages/ProductDetailPage.tsx`, `apps/web-shop/src/pages/CatalogPage.tsx`, `apps/web-shop/src/pages/sell/SellQuotePage.tsx`, `apps/web-shop/scripts/prerender.mjs`. `apps/web-shop/src/hooks/useTrackEvent.ts` stays as is (it returns `track`).

Depends on Task 2's `track(event: ShopEvent)` signature (already in the tree).

### Call sites

- `ProductDetailPage.tsx` (the effect that currently calls `track('ViewContent', { content_type: 'product', content_ids: [id] })`): replace with `track({ name: 'view_product', productId: id, productName, price })`. Use the product's display name and cash price **as already present on the loaded `data` object** — read the `ProductDetail` type in that file to find the right fields; pass `price` only when it is a finite number greater than 0, and omit `productName` when no name field exists. Keep the effect's dependency list correct so the event fires once per product load, not on every render.
- `CatalogPage.tsx`: remove the `track('ViewContent', { content_type: 'catalog' })` effect and the now-unused `useTrackEvent` import and `track` constant. Page views of `/products` are already recorded by each tracker's own page-view hit; a second event added nothing.
- `SellQuotePage.tsx` (`onSuccess` of the submit mutation): replace `track('Lead', { type: 'buyback', model, storage, grade: quote?.grade, flow })` with `track({ name: 'sell_lead', flow, model, storage, grade: quote?.grade })`. Coerce to the event's types without changing runtime values (e.g. `grade: quote?.grade ?? undefined`).

After this task `npx tsc --noEmit -p apps/web-shop/tsconfig.json` must pass with zero errors — the old `track(string, object)` call shape no longer type-checks, so any call site missed shows up there. Run the existing test files for the three pages if they exist (`npm run test --workspace=apps/web-shop -- src/pages`), and fix any test that asserted the old `track` arguments.

### Prerender tripwire (`scripts/prerender.mjs`)

In `captureRoute`, next to the existing sanity gates (the block that throws on a bad title / empty `#root` / wrong canonical), add a gate that throws `Error(`${route}: snapshot มีร่องรอย tracker หรือแบนเนอร์คุกกี้ ("${marker}")`)` when the captured `html` contains any of:

```
googletagmanager.com
google-analytics.com
connect.facebook.net
facebook.com/tr
analytics.tiktok.com
line-scdn.net
data-consent-ui
```

`data-consent-ui` is the attribute the Phase 2 banner and settings dialog will carry on their root elements; it must never reach a prerendered snapshot. Keep the list in one `const` array near the other constants at the top of the file, with a one-line comment saying why each group is there. Update the file-header comment that describes the analytics handling so it mentions the tripwire.

Do **not** run `npm run build:prerender` in this task if it needs network access to production and fails for that reason — report that instead. Do run `node --check apps/web-shop/scripts/prerender.mjs`.

---

## Phase 2 — owner approved the mockup v2 copy (2026-11-27)

**Copy source of truth:** `.superpowers/sdd/approved-mockup-v2.html` (copy of artifact J4oRjKjTKiLJedQW93x9LG v2). Use its Thai text **verbatim** except the deviations listed per task below. Yellow `<span class="fill">` placeholders in it are owner inputs that are still missing.

**Phase 2 global rules (in addition to the Global Constraints above):**
- UI rules: `.claude/rules/frontend.md` — use the shop's own components (`@/components`, `@/components/ui/*`), tokens only (no hex), `leading-snug` on Thai text, multi-sentence paragraphs use `reading-block`, icons from `@/lib/icons`.
- TikTok Pixel and LINE Tag are **not installed in this round** (Task 7 blocked). Customer-visible text must name only trackers that actually run: the marketing category names **Facebook และ Instagram** only. Keep the vendor names in one exported constant so Task 7 can extend it (adding a vendor to an existing category is a material change — Task 7 will bump `CONSENT_POLICY_VERSION`).
- Owner inputs still missing — render nothing rather than a placeholder: privacy e-mail, visit-data retention period, sell-form retention period, policy effective date. Keep them as `null` constants in one file with a `TODO(owner)` comment; the list items/lines that depend on them are omitted while `null`.
- The banner and the settings dialog root elements carry `data-consent-ui`. They must never render during prerender: `scripts/prerender.mjs` sets `window.__BC_PRERENDER__ = true` via `context.addInitScript` and the consent UI renders nothing when that flag is true (Task 3's tripwire then proves it).

## Task 4: Cookie banner, settings dialog, footer links

**Files:** create `apps/web-shop/src/components/consent/` (banner, settings dialog, a small zustand UI store `useConsentUi` with `settingsOpen` / `openSettings()` / `closeSettings()`, a shared marketing-vendor constant), tests next to them; modify `apps/web-shop/src/App.tsx` (mount the consent UI once at the root so every route has it), `apps/web-shop/src/components/layout/ShopFooter.tsx`, `apps/web-shop/scripts/prerender.mjs` (the `__BC_PRERENDER__` init script only).

Behaviour (mockup section "แบบแบนเนอร์" + its notes column):
- Banner shows when `useConsent().decided === false` and not prerendering. Fixed to the bottom edge, full width on phones, centred card on desktop (mockup "บนจอคอมพิวเตอร์"), respects `env(safe-area-inset-bottom)`, does not block scrolling or the rest of the page (no overlay), `role="region"` with `aria-label="การใช้คุกกี้"`, stacks above the floating chat button.
- Banner text: title "เว็บไซต์นี้ใช้คุกกี้", body exactly as the mockup, link "นโยบายความเป็นส่วนตัว" → `/privacy`. Three buttons of **identical width and height** in one row: "ยอมรับทั้งหมด" and "ปฏิเสธ" share the same filled style; "ตั้งค่า" is the outlined style. Accept → `saveConsent({ analytics: true, marketing: true })`; Reject → both false; Settings → `openSettings()`.
- Settings dialog (Radix dialog from `@/components/ui/dialog`, title "ตั้งค่าคุกกี้"): intro text + policy link; three rows exactly as the mockup — necessary ("เปิดเสมอ", no switch; text **includes** "และการนับจำนวนผู้เข้าชมของร้าน"), analytics switch, marketing switch. Marketing row text: "ใช้วัดผลโฆษณา และแสดงโฆษณาของร้านที่ตรงกับความสนใจของคุณบน Facebook และ Instagram" (deviation from mockup: TikTok/LINE removed until Task 7). Switches are `role="switch"` buttons with `aria-checked`, labelled by their row title, ≥ 44px touch target. When opened, switches start from the current consent state (both off when undecided). Buttons: "ยอมรับทั้งหมด" · "ปฏิเสธทั้งหมด" · "บันทึกที่เลือก" (equal size).
- Every save (banner or dialog) calls `saveConsent`, closes the dialog, and shows `toast.success('บันทึกการตั้งค่าคุกกี้แล้ว')` (sonner, already mounted in `main.tsx`).
- Footer: add `{ to: '/privacy', label: 'นโยบายความเป็นส่วนตัว' }` to the "ข้อมูล" column; append ` · ` and a text-styled `<button type="button">ตั้งค่าคุกกี้</button>` after "© 2026 BESTCHOICE Phone Shop — ลพบุรี" that calls `openSettings()`. The footer button must not carry `data-consent-ui` (the footer is prerendered).
- Tests (vitest + Testing Library): banner hidden when decided / visible when undecided / hidden when `window.__BC_PRERENDER__`; each banner button saves the right choice and hides the banner; dialog opens from the banner and from the footer button with switches reflecting current state; "บันทึกที่เลือก" saves the switch values; toast called; buttons equal-size is a visual check (e2e/screenshot), not a unit test.

## Task 5: Privacy & cookie policy page

**Files:** create `apps/web-shop/src/pages/PrivacyPage.tsx` (+ a facts/constants module for owner inputs and the vendor list if not already created in Task 4); modify `apps/web-shop/src/App.tsx` (route `/privacy`), `apps/web-shop/scripts/prerender.mjs` (`ROUTES` + the "13 หน้า" comments → 14), `apps/web-shop/scripts/prerender-products.mjs` (comments that say 13 pages), `apps/web-shop/public/sitemap.xml` (add `/privacy`, `changefreq` yearly, priority 0.3; header comment count), `apps/web-shop/public/llms.txt` (one line under the existing policy links).

- Content: the mockup section "ร่างหน้านโยบาย" verbatim, with: legal name "บริษัท เบสท์ช้อยส์โฟน จำกัด"; contact block "บริษัท เบสท์ช้อยส์โฟน จำกัด (ร้าน BESTCHOICE ผ่อนไอโฟนลพบุรี)" + address/phone/LINE from `shopInfo` in `@/lib/copy` (do not retype them); e-mail line only when the e-mail constant is set; "ฉบับที่ 1" and the "· มีผลตั้งแต่ …" part only when the date constant is set; retention list items for visit data and sell forms only when their constants are set (the account/order item always shows); the cookie table **without** the TikTok and LINE rows; section 2 marketing row "ข้อมูลการเข้าชมที่ส่งให้ Meta"; section 4 "Meta (Facebook และ Instagram) เมื่อคุณยอมรับคุกกี้เพื่อการตลาด". Add a "ตั้งค่าคุกกี้" button in section 3 next to the sentence that mentions it (calls `openSettings()`).
- Page shell like `ReturnsPage.tsx`: `ShopLayout`, `CategoryHero` with breadcrumbs, `usePageMeta('นโยบายความเป็นส่วนตัวและคุกกี้', '<one-sentence description>')`. Tables in an `overflow-x-auto` wrapper; paragraphs `reading-block`.
- Tests: the page renders the legal name and the cookie names `bc_cookie_consent`, `_ga`, `_fbp`; does not mention TikTok; omits the e-mail line while the constant is null.

## Task 6: Homepage map click-to-load

**Files:** modify `apps/web-shop/src/pages/HomePage.tsx` (the `<iframe>` under "แผนที่จริงแบบฝัง"); create a small component + test.

- Before click: a box with the same size classes as the current iframe (`h-64 md:h-80 w-full`), muted token background, one outlined button "แสดงแผนที่" and the small line "แผนที่มาจาก Google Maps เมื่อกดแสดง Google จะได้รับข้อมูลการใช้งานของคุณ". No request to any Google host before the click.
- After click: the existing iframe (same `src`, `title`, attributes) replaces the box in place; focus moves to the iframe. Not tied to the cookie choice.
- The address, hours, navigate button and LINE button above it are unchanged.
- Test: no `<iframe>` before click; iframe with the Google src after click.

## Task 7: TikTok Pixel + LINE Tag — BLOCKED

Needs the base code copied from TikTok Events Manager and the LINE Tag admin screen, plus owner permission to add two entries to `apps/api/src/modules/integrations/integration-registry.ts`; `shop-public-config` returns the two new IDs; bump `CONSENT_POLICY_VERSION`; add the vendors to the marketing text and the policy.

## Task 8: End-to-end proof + prerender build

**Files:** create `apps/web-shop/e2e/consent.config.ts` + `apps/web-shop/e2e/consent.spec.ts` (pattern: `e2e/ui-followup.config.ts` / `ui-followup.spec.ts`, API stubbed with `e2e/fixtures/shop-api.ts`).

- Web server started with `VITE_GA4_ID=G-E2ETEST` and `VITE_FB_PIXEL_ID=000000000000000` env.
- Record every request whose host is `googletagmanager.com`, `google-analytics.com`, `connect.facebook.net`, or `facebook.com` and fulfil it with an empty `200` JavaScript body (no real network). Any other non-local request is aborted.
- Cases: (1) first visit → banner visible, zero tracker requests after load + navigation to a product page; (2) "ปฏิเสธ" → zero tracker requests, banner gone, reload → banner still gone and zero requests; (3) "ยอมรับทั้งหมด" → requests to `googletagmanager.com/gtag/js?id=G-E2ETEST` and `connect.facebook.net/…/fbevents.js`; on a product page `window.dataLayer` has `view_item` and the `fbq` queue has `['track','ViewContent',…]`; reload → no banner; (4) settings dialog: analytics only → gtag requested, fbevents not; (5) withdrawal: accept all → footer "ตั้งค่าคุกกี้" → "ปฏิเสธทั้งหมด" → page reloads → zero tracker requests afterwards; (6) footer link `/privacy` opens the policy page.
- Then run `npm run build:prerender --workspace=apps/web-shop` and confirm the tripwire passes and `dist/privacy/index.html` exists.
