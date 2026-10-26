# Mobile density follow-up

The user asked for a closer mobile-screen review and UI UX Pro Max design input after the Noto change. This is an incremental layout pass on the existing uncommitted branch, not a deployment.

## Evidence and design decisions

- Visually reviewed the existing 320px captures for 30 representative routes: dashboard, stock, POS, customers, contracts, payments, finance, expenses, collections, letters, bookings, repossessions, reports, trade-in, assets, other income and settings categories. Reproduced the crowded cases in the current synthetic preview.
- UI UX Pro Max `mobile touch target spacing --domain ux` matched touch spacing and mobile web target guidance. Use 44px as this product's comfortable mobile target, not as a universal WCAG minimum. Keep 8px spacing between distinct controls where practical.
- `responsive layout spacing --stack html-tailwind` matched consistent spacing and grid gaps. Reuse existing tokens and responsive utilities.
- The information-density query and its narrower disclosure retry did not return applicable guidance. Density decisions below come from observed screenshots and the user's minimal/readable preference, not a claimed database recommendation.
- Preserve Noto UI fonts, document typography, brand colors, financial values, permissions and filter semantics. Do not hide essential information or reduce body text to make it fit.

## Implementation

- [x] Other income: remove the second mobile page inset; give status labels their own full-width row; remove redundant English status labels; keep every count/filter and accessible selected state.
- [x] Letters: separate title and export on small screens so the heading is not squeezed into multiple lines; preserve all filters and export scope.
- [x] Table toolbars / trade-in: give search and custom filters a full mobile row, with column options after them; keep segmented choices comfortably tappable.
- [x] Customers: reduce padding and decorative space in count-filter cards on mobile while retaining all six filters, complete labels and counts.
- [x] Expenses: shorten the heading and remove module/version and duplicated user identity; keep visible business actions and verify their destinations. Prevent search being squeezed beside controls.
- [x] Storefront: increase catalog control touch height; separate model name and device identifier; align card actions; reduce excessive hero inset on phones.

## Verification and handoff

- [x] Capture baseline and after at 320px, then verify after at 375, 390 and 430px; check light/dark where supported, desktop layout, long values, touch targets, filter interaction and horizontal overflow.
- [x] Run relevant existing unit/browser tests and independent read-only code review. Fix substantive findings.
- [x] Run `npm run local:check` after the last source edit; verify same-checkout preview and document isolation.
- [x] Save findings and exact coverage in the mobile review report. Keep local previews running; no automatic commit, merge or deployment. Physical devices remain unverified.
