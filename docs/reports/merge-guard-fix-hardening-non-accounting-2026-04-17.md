# Pre-Merge Guard Report — `fix/hardening-non-accounting`

**Date**: 2026-04-17  
**Branch**: `fix/hardening-non-accounting`  
**Author**: Akenarin Kongdach  
**Reviewer**: Pre-Merge Guard (automated)

---

## Branch Summary

- **Unique commits (not in main)**: 2 commits at tip
- **Behind main by**: 50 commits (Facebook integration, inbox redesign, and other changes)
- **Key changes**: Phase 2 WS events + file upload + read receipts + KB suggestions; security hardening (LiffTokenGuard, webhook raw-body enforcement, DTOs, FINANCE_MANAGER role additions, SMS retry fix, Dashboard MoM KPIs)

### Top Unique Commits
| Commit | Message |
|--------|---------|
| `16a18376` | feat(chat): complete Phase 2 — WS events, file upload, read receipts, KB suggestions |
| `17c1c9f9` | fix: hardening — security, DTOs, FINANCE_MANAGER, SMS retry, Dashboard MoM |

### File Changes Summary (unique commits)
**`17c1c9f9` — hardening:**
- `chatbot-finance-liff.controller.ts` — added `LiffTokenGuard` (P0 security fix)
- `line-finance-webhook.guard.ts` — reject webhook without `rawBody` in production
- `slip-review.controller.ts` — throw `BadRequestException` instead of returning `{ error }`
- DTOs added: `LiffNotificationPreferencesDto`, `SlipUploadBodyDto`, `ApproveEvidenceDto`, `BatchApproveEvidenceDto`, `BatchRejectEvidenceDto`
- 19 `@Roles` decorators updated to include `FINANCE_MANAGER`
- `dashboard.service.ts` — added `contractsMoM`, `overdueMoM`, `stockMoM`
- `sms-history.service.ts` — force-fail orphaned `RETRY_PENDING` + 24h max age

**`16a18376` — Phase 2 chat:**
- `staff-chat.controller.ts` — `POST /sessions/:id/upload` (S3 upload, 10MB, guarded)
- `staff-chat.gateway.ts` — WS emit for assign/transfer/resolve via `IChatGateway` interface
- `session-manager.service.ts` — `markMessagesRead()` for read receipts
- `chatbot-finance-admin.controller.ts` — list/approve/reject KB suggestion endpoints
- `ChatbotFinanceKnowledgePage.tsx` — "ข้อเสนอแนะ" tab with approve/reject UI
- `UnifiedInboxPage/index.tsx` — wire `onSendFile` prop to `ChatPanel`

---

## Issues Found

### 🔴 Critical

None found.

---

### 🟡 Warning

#### W-1: Branch is 50 commits behind `main`
The branch diverged before:
- Facebook Messenger integration and webhook endpoints
- Inbox full-bleed redesign
- Integration Hub / SMS consolidation
- `IntegrationConfigService` migration for LINE and Anthropic config

These changes touch the same files modified in `17c1c9f9` and `16a18376` (chatbot-finance module, inbox pages), so merge conflicts are expected. Rebase required.

---

### 🔵 Info

#### I-1: `overdueRate: Number(overdueRate)` in `dashboard.service.ts`
This converts a computed ratio `overdueContracts / totalContracts`, not a Prisma Decimal field. The conversion is safe here.

#### I-2: `IChatGateway` interface introduced to break circular dependency
Good pattern — avoids importing the gateway module directly into the service layer.

#### I-3: File upload limited to 10MB via `@UseInterceptors(FileSizeValidationInterceptor)`
Appropriate limit. Uploads route through `StorageService` (S3-compatible) as per project conventions.

#### I-4: TikTok adapter remains scaffold
Commit note acknowledges TikTok requires partner-level API access. The stub is intentional.

---

## Verdict

**🟡 REVIEW — Rebase required before merge**

The 2 unique commits are well-structured and contain important security hardening (LiffTokenGuard, raw-body enforcement, batch DTO validation). No blocking issues. Branch is 50 commits behind main — rebase onto `main`, resolve conflicts in chatbot-finance and inbox modules, run `./tools/check-types.sh all`, then merge.

The `17c1c9f9` hardening commit in particular should land quickly as it fixes P0 security issues (LIFF token verification server-side).
