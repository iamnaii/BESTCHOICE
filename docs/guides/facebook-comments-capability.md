# Facebook comments: implementation and live acceptance

Updated 2026-10-06 (Asia/Bangkok). Production now has a Graph transport implementation in this branch. **Live Meta acceptance is still unverified.** Local HTTP mocks and signed preview fixtures do not prove App Review approval, callback delivery or successful public replies on the real Page. This implementation task has not changed any live subscription, feature switch or Meta setting, and has not sent a real comment.

## What is implemented

- Public text replies on the configured Page's own posts, signed `feed` comment ingestion, scoped work queue, assignment, explicit customer links and uncertain-send reconciliation.
- Graph API stays pinned to `v25.0`, matching the existing Messenger adapter. The transport reads encrypted integration configuration via `IntegrationConfigService`; no frontend credential is accepted.
- Read-only readiness checks verify the token's app/Page identity, validity/expiry, permissions (including Page granular grants) and this app's `feed` subscription. Cache lifetime is 30 seconds, credential changes invalidate it, and OWNER refresh bypasses it.
- Receive requires `pages_read_engagement`, `pages_read_user_content`, `pages_manage_metadata` and `feed`. Public reply also requires `pages_manage_engagement`. Each send verifies the comment's post belongs to the configured Page and `can_comment` is true. Private replies remain unsupported.
- An explicit OWNER action adds `feed`, preserving every existing field and the shared mandatory Messenger fields. The older Integration Hub subscription action uses this same read/merge/write transport, so submitting an older/default form cannot silently remove `feed`. Failure to read existing subscriptions prevents the write. Neither reading readiness nor saving the Page/branch binding subscribes automatically.
- The signed webhook route remains separate from Messenger event processing. Comment authors are never inferred to be Messenger PSIDs.
- `CONFIRMED` requires a valid provider ID. Certain authorization/rate rejections are `FAILED`; timeouts, 5xx, malformed/missing acknowledgements and ambiguous provider errors are `UNKNOWN`. There is no hidden POST retry. The durable attempt and manual proof reconciliation prevent blind resend.
- Unresolved records have a scoped **ตรวจข้อมูลจาก Meta อีกครั้ง** action; duplicate webhook deliveries also retry only the authoritative read. Both use the captured thread revision to reject stale snapshots. Missing older roots can be recovered only with matching Page/post/parent/author evidence, then their children can be checked again. Deleted children retain tombstones and record ambiguity without blocking a verified root; missing/deleted roots and unresolved live records still block replies. Recovery controls remain reachable for provider echoes without repeating a confirmed reply bubble.
- Provider `created_time` is never an edit revision. Reads verify post ownership. An inaccessible/missing Graph object does not prove deletion; ambiguous reads remain unresolved, signed REMOVE events retain their tombstones.
- Native-fetch spans and breadcrumbs for `graph.facebook.com` are excluded from Sentry instrumentation. This is necessary because `debug_token` requires an `input_token` query parameter. Credentials, proof values and provider error bodies must never be logged or returned to users.

## Owner setup

1. Inbox → **ตั้งค่างานแชท** (settings icon), accessible even while queue/comments are disabled.
2. Enable the work queue and desired work features. Reading a chat does not clear waiting; a confirmed staff reply does. Queue scope follows the current SHOP/FINANCE choice and staff grants. Existing waiting rooms can be listed; enabling alerts does not retrospectively send alerts for every old room.
3. In **ตั้งค่า Page และสาขา**, open **ตั้งค่าการเชื่อมต่อ Facebook** and configure Page ID, App ID, Page Access Token, App Secret and Webhook Verify Token. `FB_APP_ID` is the environment fallback for the new App ID field. It is required by comment readiness and by the verified subscription writer, but not by ordinary Messenger sends.
4. Choose the SHOP branch and save the Page binding. Once comment history exists, its branch attribution cannot be rewritten.
5. Refresh readiness. Obtain the required Meta permissions/review for the actual app mode and Page. Select Page/feed at the Meta app webhook configuration and point its callback at this installation's existing signed Facebook webhook route. The app-level callback cannot be verified merely from a Page subscription.
6. Click **สมัครรับคอมเมนต์จาก Facebook** only when intending to change the Page subscription. This is a real external configuration write. Then enable the comments feature in work settings. Feature flag, Page binding and provider readiness are independent gates.
7. Use an explicitly designated test Page/post for live acceptance: customer comment → signed callback → correct SHOP branch queue → explicit public reply → provider acknowledgement/visible reply. Verify edit/delete/replay, expired permissions and uncertain-send handling. Record evidence without tokens or customer data. Do not label the feature production-verified before this test.

New comment events are received after activation; there is no historical comment backfill in this release. Readiness means configuration and runtime permissions passed, **not** that a real callback/reply was observed. UI states this distinction.

## Primary-source mapping and limits

Reviewed 2026-10-06:

- Meta's [official Comment SDK source](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/comment.py) defines GET comment fields (`id`, `message`, `from`, `object`, `parent`, `created_time`, `can_comment`) and public `POST /{comment-id}/comments` with `message`.
- Meta's [official Page SDK source](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py) defines the subscribed-apps edge and `subscribed_fields`.
- Meta's [official Facebook API collection](https://www.postman.com/meta/facebook/overview) covers Page access-token acquisition and Page tasks.
- Direct developer references for [comments](https://developers.facebook.com/docs/graph-api/reference/comment/), [Page subscriptions](https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps/) and [token inspection](https://developers.facebook.com/docs/graph-api/reference/debug_token/) returned HTTP429 in this research environment. The official SDK mapping supports implementation, but does not prove v25 runtime permission approval or actual webhook payloads for this installation. No third-party article substitutes for live acceptance.

Local regression covers HTTP request/response contracts, wrong Page/app/granular grants, expiry, subscription preservation and paging, uncertain sends, scoped DB authorization/audits, signed synthetic deliveries and browser setup at desktop/mobile sizes. Run `npm run local:check` plus `CREDIT_SUITE=chat-operations bash tools/test-chat-credit.sh` before handoff; neither contacts Meta.
