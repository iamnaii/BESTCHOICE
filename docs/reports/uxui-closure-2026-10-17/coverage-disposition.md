# Disposition of the 12 baseline API-error entries

Twelve inventory rows represent eleven unique paths. This table separates actual defects from absent capability/data and older evidence. A source test reference alone does not prove a current runtime pass.

| Entries | Disposition |
| --- | --- |
| ADMIN-010 `/verify/contracts/:id` | Confirmed 403 bug, fixed. New isolated public verification tests cover valid/missing/wrong/Unicode/repeated hash, protected-read denial, minimal response and mobile UI; retry covers simulated transport failure followed by real API |
| ADMIN-011, ADMIN-093 voucher | Missing-number baseline404; prior actual voucher/auth evidence in expense-vouchers.docs-spec.ts (exact number and guest→login→voucher). Full browser interaction matrix still partial |
| ADMIN-012 `/cn/:token` | Actual CN token PDF issuance/download covered by receipts.docs-spec.ts; browser success through this viewer route is still not established |
| ADMIN-013 `/visit` | Earlier managed appointments acceptance covers booking/reschedule/cancel/conflict/check-in/service/complete/revoke. Baseline without token410 is a negative case, not provider/device verification |
| ADMIN-062 related inbox room | Service company/owner isolation and managed read/retry/work-queue cases exist. Exact related-room UI allowed+denied pairing is not established; baseline403 cannot simply be called expected |
| ADMIN-102 receipt verify | Receipt service/auth cases exist, prior browser routing uses mock data. Real receipt→canonical public verification UI still lacks a dedicated success artifact |
| ADMIN-116 legacy insurance detail | Real after-sales repair500→return→close/OI flow covered elsewhere; legacy redirect itself has unit coverage, not populated real-browser evidence |
| ADMIN-195, ADMIN-196, SET-033 LINE settings | Draft layout/action controls and synthetic service tests exist. Complete save/reload/publish/default/link/delete browser flow and real LINE remain unverified. SET-033 duplicates ADMIN-195; alias landing on rich-menu400 does not prove greeting is broken |
| ADMIN-197 profile | Confirmed missing read-error feedback/preferences hydration; fixed. New unique-user scenario covers PBX503/retry/empty/configured mocks and real extension/default-account PATCH+reload at320/root20. Real PBX remains unverified |

Additional risk areas for ongoing QA: deep MDM approval/action failures, repossession and exchange variants, role/company/branch combinations. Several legacy browser smoke tests only assert content/absence of errors; even zero skipped tests does not turn them into exhaustive transaction acceptance.
