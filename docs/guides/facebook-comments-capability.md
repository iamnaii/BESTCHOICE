# Facebook comment capability evidence

Checked 2026-10-06, Asia/Bangkok. **Live receive/public reply/private reply are UNVERIFIED and disabled.** Local fixtures are not proof of Meta approval. No live subscription, comment, permission or app setting was changed. No production credential was printed or used for a probe.

## Evidence available in this checkout

- `facebook.adapter.ts` sends Messenger through Graph `v25.0`. `IntegrationConfigService` resolves the single configured `pageId` and `pageAccessToken` from the integration store, with the existing environment fallback. A comment client checks the requested page against this configuration before delegating.
- `FacebookAppReviewService` already contains a public-comment helper at `POST /{commentId}/comments`, and a comment listing helper. These source-code mappings are **not current provider documentation or proof of permission**. This feature does not invoke the App Review helper or change its behavior.
- The existing mandatory subscription list deliberately omits `feed`. It remains unchanged. Current token ownership, expiry, subscribed fields and permission inventory for a verified test app were not available in the isolated environment.
- Existing Facebook webhook HMAC verification covers the raw request bytes. Comment persistence is added behind that same verification, separately from Messenger processing. Comment author identity never becomes a Messenger PSID.

## Official documentation attempts

| Item requiring verification | Official source attempted | Result |
| --- | --- | --- |
| Page feed payload, add/edit/remove fields, delivery IDs and ordering guarantees | [Page webhook reference](https://developers.facebook.com/docs/graph-api/webhooks/reference/page/) | HTTP429 on repeated attempts |
| Public-comment endpoint, permissions, page ownership, acknowledgement/error semantics | [Pages comments](https://developers.facebook.com/docs/pages-api/comments/) | Inaccessible via browser tool |
| Private reply endpoint, eligibility and time window | [Messenger private replies](https://developers.facebook.com/documentation/business-messaging/messenger-platform/discovery/private-replies) | HTTP429 on repeated attempts |

Exact permissions, allowed live endpoints, revision fields, private reply windows and expiry/error behavior remain **UNVERIFIED**. No third-party article is used to fill these gaps. Fixtures represent local contracts only; they must not be described as verified Meta payloads.

## Enforcement

`FacebookCommentClient` has no default live transport. Missing transport, wrong configured page, missing token, unavailable evidence or `verified:false` returns all three capabilities false. UI flags cannot turn this into a live provider connection. The isolated preview may inject a synthetic transport using a dummy page/token and explicit fixture evidence; this provider is not registered in the production module.

The client only reports `CONFIRMED` with a nonempty external acknowledgement ID. A transport-certified rejection is `FAILED`; timeout or missing acknowledgement is `UNKNOWN`. It never retries a send internally. The task service must persist the attempt before dispatch, retain request identity, and block blind resend of uncertain attempts. Provider exceptions are converted to fixed codes rather than leaking raw responses/tokens.

Event timestamps are not monotonic revisions. Without a proven revision or authoritative provider read, an ambiguous edit/remove must remain marked for reconciliation; arrival order cannot resurrect a deleted comment. Unknown Page IDs are excluded. Company/branch binding is resolved on the server, not accepted from incoming comment data.

## Gate before any live enablement

1. Read the current official Graph-version documents and record exact payload/revision, endpoint, permission and private-reply rules with dates and URLs.
2. Using a designated test app/page, inspect its token ownership, expiry, granted permissions, subscribed fields and review state read-only. Never print tokens. Enabling/changing subscriptions is a separate authorized action.
3. Implement one reviewed live transport mapping after that evidence exists. Prove receive/public/private capabilities independently; private reply may remain false.
4. Run signed delivery/replay/deletion fixtures plus the designated test-app acknowledgement/rejection/timeout scenarios. Preserve all existing Messenger subscribed fields.
5. Record results and explicitly distinguish local implementation acceptance from live-provider acceptance. Deployment is separate from this evidence gate.
