# P3 — Notification Templates (B Plus)

**Date:** 2026-04-30
**Owner:** akenarin.ak@gmail.com
**Status:** Design — pending plan
**Estimated effort:** ~5-6 days
**Predecessor:** P1 PR #731 + P2 PR #732 (both shipped 2026-04-30)

## 1. Context

P1 + P2 shipped multi-OA routing + Thai-law compliance gating. Customer-facing messages currently come from **two sources**:

1. **Inline strings in `scheduler.service.ts`** — hardcoded in `stageMessages` for dunning, in flex template files for payment success/contract signed/etc. Owner cannot edit without dev + deploy.
2. **JSON blobs in `system_config` table** (key: `notification_template_${id}`) — exposed via `/notifications/templates` CRUD. UI exists (TemplateForm.tsx + TemplateManager.tsx) but no cron consumes these.

P3 consolidates: **all customer-facing messages move to a proper `NotificationTemplate` model**. Owner edits via UI → next cron run uses new wording. No deploy required.

**Hard-fail policy** (user choice): if a required template is missing, send fails with explicit error. No silent fallback to inline strings — single source of truth, no ambiguity.

## 2. Goals

- Proper `NotificationTemplate` Prisma model (replace `SystemConfig` JSON blobs)
- Migrate all current inline `stageMessages` (4 dunning stages) to DB templates
- Migrate other inline customer-facing messages (payment reminder, overdue notice, status change) to DB templates
- Cron methods look up templates by `eventType` key (e.g., `dunning.reminder`, `payment.due_in_3_days`)
- **Hard-fail on missing template** — Sentry alert, Sentry capture, throw at cron level
- **Preview** — render template with sample data in UI before save
- **Test send** — UI button "ส่งทดสอบให้ตัวเอง" sends to current admin's LINE/SMS
- Template carries `category` + `channelKey` — caller doesn't pass these
- Bootstrap seed migration — all required templates inserted on first deploy

## 3. Out of Scope (defer)

| | Phase |
|---|---|
| Version history / template diff view | P4 |
| A/B test variants per template | P4 |
| Multi-language (Thai/English templates) | P4 |
| Per-customer template overrides | P4 |
| Approval workflow (template review before publish) | P4 |
| Template marketplace / library import | never |

## 4. Architecture

### 4.1 Schema

```prisma
model NotificationTemplate {
  id              String                @id @default(uuid())

  /// Stable lookup key — matches scheduler/cron event identifiers.
  /// Examples: 'dunning.reminder', 'dunning.notice', 'payment.due_in_3_days'
  eventType       String                @unique @map("event_type")

  /// Human-readable name shown in UI list
  name            String

  /// What category this template falls under (drives compliance gating).
  category        NotificationCategory  // enum DUNNING|REMINDER|TRANSACTIONAL|STAFF|MARKETING

  /// LINE channel key — line-shop|line-finance|line-staff. Null for SMS-only templates.
  channelKey      String?               @map("channel_key")

  /// Channel: LINE | SMS | IN_APP
  channel         NotificationChannel

  /// Format: 'text' | 'flex'
  format          String                @default("text")

  /// Optional subject (for SMS, IN_APP, or analytics)
  subject         String?

  /// Plain-text message template with ${var} placeholders
  messageTemplate String                @db.Text @map("message_template")

  /// Optional Flex Message JSON (when format='flex'). Stored as text, parsed at runtime.
  flexTemplate    String?               @db.Text @map("flex_template")

  /// Free-form description for admins (what is this for?)
  description     String?               @db.Text

  /// Active flag — sends are blocked if false (Sentry warns).
  isActive        Boolean               @default(true) @map("is_active")

  /// Identification of caller that updates the template
  lastEditedBy    String?               @map("last_edited_by")  // userId

  createdAt       DateTime              @default(now()) @map("created_at")
  updatedAt       DateTime              @updatedAt @map("updated_at")
  deletedAt       DateTime?             @map("deleted_at")

  @@index([eventType])
  @@index([category])
  @@map("notification_templates")
}

// Add NotificationCategory enum to Prisma schema (currently TS-only):
enum NotificationCategory {
  DUNNING
  REMINDER
  TRANSACTIONAL
  STAFF
  MARKETING
}
```

Migration creates the table. Seed migration inserts all required templates as part of the same migration — ensures system never deploys without templates.

### 4.2 Required templates (initial seed)

These map 1:1 to current inline strings in `scheduler.service.ts` + `notifications.service.ts`:

| eventType | Category | Channel | Where used |
|---|---|---|---|
| `dunning.reminder` | DUNNING | LINE (line-finance) | handleDunningEscalation REMINDER stage |
| `dunning.notice` | DUNNING | LINE (line-finance) | handleDunningEscalation NOTICE stage |
| `dunning.final_warning` | DUNNING | LINE (line-finance) | handleDunningEscalation FINAL_WARNING stage |
| `dunning.legal_action` | DUNNING | LINE (line-finance) | handleDunningEscalation LEGAL_ACTION stage |
| `payment.due_in_3_days` | REMINDER | LINE (line-finance) | sendPaymentReminders 3-day branch |
| `payment.due_in_1_day` | REMINDER | LINE (line-finance) | sendPaymentReminders 1-day branch |
| `payment.overdue_day_1` | DUNNING | LINE (line-finance) | sendOverdueNotices day 1 |
| `payment.overdue_day_3` | DUNNING | LINE (line-finance) | sendOverdueNotices day 3 |
| `payment.overdue_day_7` | DUNNING | LINE (line-finance) | sendOverdueNotices day 7 |
| `contract.status_overdue` | DUNNING | LINE (line-finance) | notifyStatusChangedCustomers OVERDUE flex |
| `contract.status_default` | DUNNING | LINE (line-finance) | notifyStatusChangedCustomers DEFAULT flex |
| `payment.auto_link` | DUNNING | LINE (line-finance) | handleAutoPaymentLinks |
| `mdm.lock_notice` | DUNNING | LINE (line-finance) | mdm-auto auto-lock notice |
| `staff.manager_overdue_summary` | STAFF | LINE (line-staff) | handleManagerNotifications |
| `staff.owner_default_alert` | STAFF | LINE (line-staff) | handleOwnerDefaultNotifications |
| `staff.daily_report` | STAFF | LINE (line-staff) | handleDailyReport |
| `staff.weekly_report` | STAFF | LINE (line-staff) | handleWeeklyReport |
| `staff.daily_line_report` | STAFF | LINE (line-staff) | handleDailyLineReport |
| `staff.sms_credit_low` | STAFF | LINE (line-staff) | handleSmsCreditAlert |

19 templates required. Seed migration inserts all.

**TRANSACTIONAL templates (receipts, payment success, contract signed)** — defer to later wave or keep inline. Reason: these are tightly tied to Flex JSON in `apps/api/src/modules/line-oa/flex-messages/*.flex.ts` files which are TypeScript builders, not strings. Migrating those is a much larger effort. Out of scope for v1.

### 4.3 sendFromTemplate refactor

`sendFromTemplate(templateId, data, recipient, ...)` becomes:

```typescript
async sendFromTemplate(
  eventType: string,             // CHANGED: was templateId
  data: Record<string, string>,
  recipient: string,
  options: {
    relatedId?: string;
    customerId?: string;
    bypassCompliance?: boolean;
  } = {},
) {
  const template = await this.prisma.notificationTemplate.findUnique({
    where: { eventType },
  });

  if (!template) {
    Sentry.captureMessage(`Notification template missing: ${eventType}`, {
      level: 'error',
      tags: { module: 'notifications', eventType },
    });
    throw new InternalServerErrorException(`Template ${eventType} not found`);
  }

  if (!template.isActive) {
    this.logger.warn(`Template ${eventType} is inactive — send blocked`);
    Sentry.captureMessage(`Template inactive: ${eventType}`, { level: 'warning' });
    return { id: null, status: 'BLOCKED', blockReason: 'TEMPLATE_INACTIVE' };
  }

  // Use template.channel + template.channelKey + template.category
  // Don't accept caller override (template owns these)

  const message = this.replacePlaceholders(template.messageTemplate, data);

  if (template.format === 'flex' && template.flexTemplate) {
    const flexJson = JSON.parse(template.flexTemplate);
    const resolvedFlex = this.replacePlaceholdersInJson(flexJson, data) as FlexMessagePayload;
    // ... send flex via lineOaService.sendFlexMessage with template.channelKey
  } else {
    return this.send({
      channel: template.channel,
      channelKey: template.channelKey as LineChannelKey,
      recipient,
      subject: template.subject ?? template.name,
      message,
      relatedId: options.relatedId,
      customerId: options.customerId,
      category: template.category,
      bypassCompliance: options.bypassCompliance,
    });
  }
}
```

Hard-fail on missing/inactive — caller (cron) gets exception and logs to Sentry.

### 4.4 Cron migration

For each cron in scheduler.service.ts that currently has inline strings, replace with `sendFromTemplate(eventType, data, recipient, options)`. Example:

```typescript
// BEFORE — handleDunningEscalation
const stageMessages: Record<string, string> = {
  REMINDER: `[BESTCHOICE FINANCE] แจ้งเตือน: คุณ${name} มียอดค้างชำระ ${amount} บาท สัญญา ${contractNumber} กรุณาชำระโดยเร็ว`,
  // ... 3 more stages
};
const message = stageMessages[esc.to];
await this.notificationsService.send({
  channelKey: 'line-finance',
  channel: 'LINE',
  recipient: lineId,
  subject: `Dunning: ${esc.to}`,
  message,
  relatedId: contract.id,
  customerId: contract.customer.id,
  category: NotificationCategory.DUNNING,
});

// AFTER
const eventType = `dunning.${esc.to.toLowerCase()}`;  // 'dunning.reminder', etc.
await this.notificationsService.sendFromTemplate(
  eventType,
  {
    name: contract.customer.name,
    amount: totalOverdue.toLocaleString(),
    contractNumber: esc.contractNumber,
    daysOverdue: String(esc.daysOverdue),
  },
  lineId,
  {
    relatedId: contract.id,
    customerId: contract.customer.id,
  },
);
```

Caller no longer specifies category, channelKey, channel — template owns those.

### 4.5 Preview + test send

UI gains 2 features in TemplateForm:

**Preview button:**
- Reads sample data from a per-template `sampleData` JSON field (NEW field to schema, optional, JSON)
- Renders template + sampleData → shows result in modal
- Both text + flex preview (flex shows JSON visualization or rough render)

**Test send button:**
- Sends to current admin's LINE/SMS (lookup `User.lineId` and `User.phone`)
- Confirms delivery with toast
- New endpoint: `POST /notifications/templates/:eventType/test-send`
- Backend uses bypassCompliance=true for test sends + adds `[TEST]` prefix

Adding to schema:
```prisma
model NotificationTemplate {
  // ...existing
  /// Sample data for preview/test, stored as JSON: { name: 'สมหมาย', amount: '1500', ... }
  sampleData      Json?                @map("sample_data")
}
```

### 4.6 Variable handling

Free-form `${var}` substitution (existing `replacePlaceholders` pattern). Variables not in `data` are left as-is (so `${name}` becomes literal `${name}` in output if missing — visible to admin during preview).

UI shows variable hints (parsed from messageTemplate via regex) below editor:
```
Variables: ${name}, ${amount}, ${contractNumber}, ${daysOverdue}
```

No strict whitelist — keeps templates flexible. Admin can add/remove variables, dev only needs to supply matching `data` keys.

## 5. Migration Strategy

### 5.1 Schema migration
```sql
-- Create table
CREATE TABLE notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  channel_key TEXT,
  channel TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'text',
  subject TEXT,
  message_template TEXT NOT NULL,
  flex_template TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sample_data JSONB,
  last_edited_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL,
  deleted_at TIMESTAMP
);

CREATE INDEX notification_templates_event_type_idx ON notification_templates(event_type);
CREATE INDEX notification_templates_category_idx ON notification_templates(category);
```

### 5.2 Seed migration (separate file, runs after schema)

A second migration file `seed_notification_templates` inserts all 19 required templates as INSERT statements. The current inline strings copy verbatim into `messageTemplate`.

Migration includes `ON CONFLICT (event_type) DO NOTHING` so re-running is safe (idempotent).

### 5.3 Code migration
Each cron method updated to use `sendFromTemplate(eventType, ...)`. Inline strings deleted.

### 5.4 Backward compat for existing UI templates
Existing JSON blobs in `system_config` (key prefix `notification_template_`) continue to be served by old endpoints **temporarily** during transition — but new endpoints use the new model. Old endpoints removed in P4 cleanup.

## 6. API Surface

### 6.1 CRUD endpoints (replaces existing)

```
GET    /notifications/templates                      List all
GET    /notifications/templates/:eventType           Get one
POST   /notifications/templates                      Create
PATCH  /notifications/templates/:eventType           Update
DELETE /notifications/templates/:eventType           Soft delete (sets deletedAt)
POST   /notifications/templates/:eventType/preview   Render with sampleData → preview
POST   /notifications/templates/:eventType/test-send Send to current admin
```

All endpoints require OWNER or BRANCH_MANAGER role.

### 6.2 Preview endpoint

Body: optional override `{ data?: Record<string, string> }` — falls back to template's `sampleData`.
Returns: `{ rendered: string, flexJson?: object }`.

### 6.3 Test send endpoint

Body: optional override `{ data?: Record<string, string> }`.
Sends to current admin (`req.user.lineIdFinance` for LINE, `req.user.phone` for SMS).
Returns: `{ status: 'SENT' | 'FAILED', logId: string, recipient: string }`.

## 7. Frontend Changes

### 7.1 TemplateForm.tsx

Add:
- Variables hint row (parsed from messageTemplate)
- Sample data editor (JSON textarea or key-value pairs)
- Preview button → modal
- Test send button → toast feedback
- Flex JSON editor (existing) preserved
- Read-only `eventType` field (immutable post-create)

### 7.2 TemplateManager.tsx

Add:
- Filter by category (DUNNING/REMINDER/STAFF)
- "Inactive" badge on disabled templates
- Last-edited info
- Lock icon on system-required templates (marker that deletion will break crons — soft warning)

### 7.3 NotificationsPage.tsx

Templates tab: existing UI stays, just talks to new endpoints. Logic flow same.

## 8. Acceptance Criteria

- [ ] Schema migration creates `notification_templates` table
- [ ] Seed migration inserts all 19 required templates
- [ ] Templates carry category + channelKey — caller no longer passes these to sendFromTemplate
- [ ] All inline `stageMessages`, `sendPaymentReminders`, `sendOverdueNotices`, etc. removed
- [ ] Cron methods use `sendFromTemplate(eventType, data, recipient, options)`
- [ ] Hard-fail: missing template → Sentry capture + InternalServerErrorException
- [ ] Hard-fail: inactive template → BLOCKED status + Sentry warn
- [ ] Preview endpoint renders with sampleData
- [ ] Test send endpoint sends to current admin
- [ ] UI: TemplateForm has Preview + Test send buttons
- [ ] UI: TemplateManager shows category filter + inactive badge
- [ ] Type check + tests pass
- [ ] Old `system_config` endpoints still work (deferred removal)

## 9. Risks & Mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| Seed migration runs before schema migration → fails | Low | Single deploy with both migrations in correct order. Migration filename timestamps enforce order |
| Owner deletes a system-required template → cron crashes | Medium | UI warning before delete + Sentry alert + soft-delete (deletedAt) — can recover |
| Variable substitution mismatch (template uses `${amount}` but data has `${total}`) | Medium | Preview catches at template-edit time. Sentry warns at runtime if substitution leaves `${}` literals |
| Flex template JSON syntax error after edit | Low | UI validates JSON on save (existing pattern) |
| Test send to admin without LINE setup | Low | UI disables test-send button if admin has no `lineIdFinance` |
| Migration deploys but seed inserts fail (e.g., conflict with future template) | Low | `ON CONFLICT DO NOTHING` makes seed idempotent |

## 10. Rollback Plan

If P3 ships and breaks:
1. Revert squash commit on main
2. Cloud Run rolls back to previous image (still uses inline strings — works)
3. `notification_templates` table remains (no data loss; just unused)

If template seed corrupted:
1. Direct SQL UPDATE on prod — admin can paste corrected `message_template` value
2. Or re-run seed migration via Cloud Run job

## 11. Test Strategy

- **Unit tests**: NotificationTemplateService CRUD + preview + test-send. Hard-fail on missing template.
- **Integration tests**: cron method dispatches `sendFromTemplate` and gets correct rendered message. Mock prisma.notificationTemplate to return seed-equivalent rows.
- **E2E manual**: edit template via UI → click Preview → see rendered → save → cron next run uses new wording.

## 12. Estimated Effort

~5-6 days, broken across phases (per implementation plan).

---

**Ready for plan**: this spec is the source of truth for `writing-plans` skill.
