# Collections — Plan 6/N: Remaining Backlog

> Close the 5 deferred backlog items from Plan 5 audit. UI tasks invoke `frontend-design` skill.

**Depends on:** Plan 5 branch `feat/collections-hardening`.

## Tasks

### Task 1: Slip upload enforcement on PaymentRecordDialog
**Why:** PaymentRecordDialog auto-allocate path accepts notes but not slip. Non-cash (BANK_TRANSFER / QR_EWALLET) should require slip for evidence + compliance.

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/components/PaymentRecordDialog.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/hooks/useRecordPayment.ts`

**Behavior:**
- Add `evidenceUrl?: string` to payload.
- When method is `BANK_TRANSFER` or `QR_EWALLET`, show slip upload field (reuse `LETTER_EVIDENCE` UploadKind or add `PAYMENT_SLIP`).
- Submit button disabled until slip uploaded when method requires it.
- Backend `/payments/auto-allocate` may not accept evidenceUrl — check. If not, use `/payments/record` with installmentNo picked from `contract.payments[0]` (oldest unpaid).

**Approach:** Inspect `BulkRecordPaymentDto` (used by auto-allocate) — if it has `evidenceUrl`, great. If not, pass `evidenceUrl` inline via mutation anyway and let backend ignore, OR route non-cash through `/payments/record`. Simplest for MVP: extend `BulkRecordPaymentDto` server-side to accept optional `evidenceUrl` and have service persist it on the first allocated payment.

Actually cleanest: since slip is per-payment (one slip, one physical transfer), we can just pass it through auto-allocate and have the service attach it to the first created Payment row. Small backend change.

**Commit:** `feat(collections): slip upload enforcement on non-cash payments`

---

### Task 2: LINE retry queue UI + backend retry endpoint
**Why:** If LINE API is down when `executeEventTrigger` runs, the `DunningAction` row persists with `status=FAILED`. No UI surfaces these; admin has no visible recovery path except DB query.

**Files:**
- Modify: `apps/api/src/modules/overdue/overdue.controller.ts` — add 2 endpoints
- Create: `apps/api/src/modules/overdue/dunning-retry.service.ts` — retry logic
- Create: `apps/web/src/pages/CollectionsPage/components/LineRetryQueueSection.tsx` — UI in ApprovalTab
- Create: `apps/web/src/pages/CollectionsPage/hooks/useLineRetry.ts`

**Backend endpoints:**
- `GET /overdue/line-retries?limit=100` — lists DunningAction where status=FAILED ordered by createdAt desc (roles: OWNER / FM / BM)
- `POST /overdue/line-retries/:id/retry` — retry send; reuse NotificationsService.send with the same message + recipient (OWNER / FM)

**Retry service logic:**
```typescript
async retry(actionId: string, userId: string) {
  const action = await prisma.dunningAction.findUnique({
    where: { id: actionId },
    include: { contract: { include: { customer: true } } },
  });
  if (!action) throw NotFoundException;
  if (action.status !== 'FAILED') throw BadRequestException('Action ไม่ได้อยู่สถานะ FAILED');

  const recipient = action.channel === 'LINE'
    ? action.contract.customer.lineId
    : action.contract.customer.phone;
  if (!recipient) throw BadRequestException('ไม่พบช่องทางติดต่อ');

  try {
    const result = await this.notifications.send({
      channel: action.channel, recipient,
      message: action.messageContent ?? '', relatedId: action.contractId,
    });
    return prisma.dunningAction.update({
      where: { id: actionId },
      data: {
        status: result.status === 'SENT' ? 'SENT' : 'FAILED',
        result: `retry by ${userId}: notificationId:${result.id}`,
        executedAt: result.status === 'SENT' ? new Date() : null,
      },
    });
  } catch (err) {
    // Log retry attempt but keep FAILED
    return prisma.dunningAction.update({
      where: { id: actionId },
      data: { result: `retry failed: ${err instanceof Error ? err.message : err}` },
    });
  }
}
```

**Frontend:**
- Section in ApprovalTab (4th card): title "ส่งไม่สำเร็จ รอลองใหม่", FileText/AlertTriangle icon, list of failed actions
- Each row: customer name + channel + message preview + [ลองอีกครั้ง] button
- Success toast after retry, list refetches

**Commit:** `feat(collections): LINE retry queue UI + backend retry endpoint`

---

### Task 3: Collections analytics (charts)
**Why:** OWNER needs trend visibility — "Is our collection rate improving? Are promises being kept more?"

**Files:**
- Modify: `apps/api/src/modules/overdue/kpi.service.ts` — add `getAnalytics(params: { range: '30d'|'90d' })` method
- Modify: controller — add `GET /overdue/analytics`
- Create: `apps/web/src/pages/CollectionsPage/components/CollectionsAnalyticsSection.tsx` (renders inside AllTab or separately)

**Backend analytics response shape:**
```typescript
{
  range: '30d' | '90d';
  weeklyCollectionRate: Array<{ weekStart: string; paidCount: number; dueCount: number; rate: number }>;
  promiseKeptTrend: Array<{ weekStart: string; kept: number; broken: number }>;
  dunningActionVolume: Array<{ date: string; sent: number; failed: number }>;
  letterDispatchByType: Array<{ type: 'RETURN_DEVICE_45D' | 'CONTRACT_TERMINATION_60D'; month: string; count: number }>;
  mdmLockVolume: Array<{ date: string; proposed: number; approved: number }>;
}
```

Each series aggregated server-side from existing tables (Payment, CallLog, DunningAction, ContractLetter, MdmLockRequest). Cache 5min.

**Frontend:**
- Recharts already in deps — use `LineChart`, `BarChart` components
- New tab on CollectionsPage? Or a section in AllTab? → Add as 6th tab **📊 วิเคราะห์** visible OWNER + FM only
- 5 chart cards, 2-col grid on desktop

**Commit:** `feat(collections): analytics tab with weekly collection/promise/dunning/letter/MDM trends`

---

### Task 4: Audit log filter for collections actions
**Why:** AuditLogsPage exists but user has to filter manually through all audit logs. Add collections quick-filter.

**Files:**
- Modify: `apps/web/src/pages/AuditLogsPage.tsx`

**Behavior:**
- Add a quick-filter dropdown "Collections" with presets: all collections actions, MDM only, letters only, dunning escalations only
- Filter actions: `STATUS_CHANGE` (contract), `DUNNING_ESCALATION_*`, `MDM_LOCK_*`, `MDM_UNLOCK`, `LETTER_*`, `CONTRACT_STATUS_LEGAL`, `BULK_ASSIGN`, `CREATE_CALL_LOG`
- Use existing filter infra if possible; add as preset button row above the table

**Commit:** `feat(audit): quick-filter presets for collections-related audit actions`

---

### Task 5: Bulk slip upload for dispatched letters
**Why:** If OWNER mails 10 letters in one batch, they have 10 tracking slips to match back. Current flow requires opening each letter's dialog one at a time.

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/components/BulkSlipUploadDialog.tsx`
- Modify: `LetterQueueSection.tsx` — add "อัปโหลดสลิปชุด" button when ≥2 DISPATCHED letters present

**Behavior:**
- Dialog shows list of DISPATCHED letters missing `evidencePhotoUrl`
- For each row: letter number + tracking# + file input
- Upload all files in parallel via existing LETTER_EVIDENCE presigned URL endpoint, then PATCH each letter with its evidence URL

**Note:** No new backend — reuses existing `/overdue/letters/:id/dispatch` to re-set evidencePhotoUrl (actually dispatch locks status to DISPATCHED; need a dedicated `PATCH /overdue/letters/:id/evidence` endpoint that only updates the photo URL post-dispatch).

Add small backend endpoint:
```typescript
@Patch('letters/:id/evidence')
@Roles('OWNER', 'FINANCE_MANAGER')
updateLetterEvidence(
  @Param('id') id: string,
  @Body() body: { evidencePhotoUrl: string },
  @CurrentUser() user: { id: string },
) {
  return this.contractLetterService.updateEvidence(id, body.evidencePhotoUrl, user.id);
}
```

With service method:
```typescript
async updateEvidence(letterId: string, evidencePhotoUrl: string, userId: string) {
  const letter = await prisma.contractLetter.findUnique({ where: { id: letterId } });
  if (!letter) throw NotFoundException;
  if (!['DISPATCHED','DELIVERED'].includes(letter.status)) throw BadRequestException;
  return prisma.$transaction([
    prisma.contractLetter.update({ where: { id: letterId }, data: { evidencePhotoUrl } }),
    prisma.auditLog.create({ data: { userId, action: 'LETTER_EVIDENCE_UPDATED', entity: 'contract_letter', entityId: letterId, newValue: { evidencePhotoUrl } } }),
  ]).then(([l]) => l);
}
```

**Commit:** `feat(collections): bulk slip upload for dispatched letters`

---

### Task 6: Final sweep + PR

```bash
./tools/check-types.sh all
cd apps/api && npx jest --testPathPattern='overdue|dunning|mdm-lock|contract-letter|collections|queue|kpi|timeline|bulk|letter|broken-promise|retry'
cd apps/web && npm test -- --run
```

Then push + PR stacked on `feat/collections-hardening`.
