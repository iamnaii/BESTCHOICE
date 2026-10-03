# Storefront typography

Applies only to `apps/web-shop` (www.bestchoicephone.com).

## Decision — 2026-09-30

Use **Prompt** for all storefront text: Thai, Latin, prices, navigation, form controls,
dialogs and notifications. The owner referenced the CapCut font “เปลือก”, then explicitly
accepted a similar web font. Prompt was selected for its loopless shapes and its fit with
the existing storefront headings. It is an alternative, not an identification of that font.

Previously body text used Sarabun, display/UI text used Prompt, and Sonner notifications
used its system font. The existing brand artwork remains artwork.

## Implementation

- `src/styles/tokens.css`: `--font-sans` is the single family definition; `--font-head`
  aliases it so existing utility classes remain consistent.
- `src/styles/fonts.css`: local Prompt WOFF2 faces, with Thai and Latin unicode ranges.
- `public/fonts/prompt`: original Google Fonts v12 assets, OFL license and source details.
  Normal weights 400/500/600/700/800; italic 800 is used for the existing wordmark.
- `index.html`: preload the regular Thai face. Other subsets/weights load on demand.
- `src/main.tsx`: explicitly pass the shared family to Sonner, which otherwise overrides
  inheritance with its own system stack.

## Scale

| Role | Size | Weight |
| --- | --- | --- |
| Supporting text, product metadata | 12px minimum | 400–500 |
| Labels, navigation, buttons | 14px | 500–600 |
| Body and mobile form controls | 16px | 400 |
| Card titles | 16px | 700 |
| Card prices | 20px mobile / 24px desktop | 700 |
| Section headings | 24px mobile / 30px desktop | 700 |
| Main hero | 30px mobile / 36–48px desktop | 700 |

Sizes are expressed in rem through Tailwind tokens. Body leading is 1.7; compact Thai UI
leading is at least 1.5; large display type uses 1.35–1.4. Do not use `leading-none` for Thai.
Decorative text inside the aria-hidden phone illustration is intentionally smaller.

Allow installment details and product tags to wrap, including 320px layouts. Do not shrink
price conditions to fit a card. Mobile text inputs, selects and textarea use 16px, with
compact desktop controls at 14px where appropriate.

## Verification

Run `npm run local:check` from this checkout. Its backend preview is synthetic and separate
from the storefront; storefront interaction checks must run separately.

For this change, temporary checks and reports live under `.tmp/typography/`:
17 public routes at 320/375/390/768/1024/1440px, font loading/families, minimum text sizes,
page overflow, mobile menu/search/filter dialog, form sizing, notification font and larger
browser text. The existing four catalog/warranty Playwright cases run against local fixtures.

The local storefront preview uses synthetic product/pricing data, includes an explicit demo
notice, and never forwards API requests to production. It does not validate live transactions,
LINE authentication, real stock, or pricing rules.
