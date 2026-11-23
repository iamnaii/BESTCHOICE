# Sell summary and 24-hour reference window

Owner-approved white/mint summary, with a prominent inspection/erase/iCloud condition banner. No long repeated terms block at the card bottom. Device, cash/credit context, real selected answers and assessment/expiry times share one card. Bangkok time is displayed; API timestamps are UTC ISO strings.

## Window behavior

- Public quote issues assessedAt, expiresAt (exactly +24 hours), serverNow and a signed quoteToken. HMAC is domain-separated from authentication and uses the existing required JWT_SECRET. No new secret or schema migration.
- Token binds model, storage, answer IDs and eligibility confirmation. It contains an input digest and timestamps, no seller identity. It is not a price lock or a customer-facing reference number.
- Public submit requires and validates this token, including at the deadline; checks again after pricing reads before creating the record. Original assessedAt/expiresAt are saved in existing quoteBreakdown JSON. Server recalculates current estimated values; final purchase price still requires physical inspection.
- Internal staff/service callers retain their legacy interface. The public controller always enables window enforcement.
- The client anchors elapsed time to serverNow and compares wall and monotonic elapsed time. Expiry/server rejection stays latched until explicit reassessment or changed inputs. A successful new quote resets the latch.
- Cash/credit switching and viewing unchanged review answers retain the same quote/window. Actual answer/device changes invalidate it. LINE omits the price while reviewing/editing and includes dates plus expiry warning when sharing the result.
- No browser persistence is added. Refresh starts the questionnaire again, as before; it does not restore an old quote or renew its timestamp. A fresh completed assessment issues a new window.
- Deploy API and storefront together. A cached old frontend without quoteToken cannot submit to the new public endpoint and must reload/reassess. JWT secret rotation invalidates outstanding windows and requires reassessment.

## Browser-storage audit (2026-11-21)

Read-only audit of source and a fresh anonymous Chromium visit to https://www.bestchoicephone.com/sell/quote, without login or form submission:

- No cookies or Set-Cookie responses observed in that session. This is scoped to that visit, not all routes or authenticated states.
- localStorage shop_session_id stores a random visitor identifier with no application-set expiry. First-party page tracking sends this ID, path, referrer and campaign parameters. The API implementation also records device/browser metadata and a hash of IP.
- Authenticated users have shop_auth_token and shop_auth_customer in sessionStorage; logout removes them. Anonymous live audit did not log in to test this state.
- Public analytics configuration returned null GA4 and Meta Pixel IDs; no Google/Meta script requests observed. Code supports build-time and runtime configuration, so this is the current observed state, not a permanent guarantee.
- No consent gate/banner was observed in the audited flow or relevant startup code. First-party page tracking runs on page navigation.
- No analytics/cookie/consent changes are included in this implementation.

Evidence: apps/web-shop/src/lib/session.ts, tracking.ts, analytics.ts; contexts/AuthContext.tsx; App.tsx; apps/api/src/modules/shop-tracking/shop-tracking.service.ts.
