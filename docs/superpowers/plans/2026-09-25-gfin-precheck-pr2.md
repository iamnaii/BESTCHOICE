# ยื่น GFIN PR 2 — บอท OA ไฟแนนซ์ส่งชุดเช็คเข้ากลุ่มไลน์ + ตั้งค่ากลุ่ม/แม่แบบ + webhook เข้า/ออกกลุ่ม Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปุ่ม "ส่งเช็ค GFIN" ในแท็บ GFIN ให้บอท OA ไฟแนนซ์ push ข้อความ 12 ข้อ + ลิงก์เข้ากลุ่มไลน์ GFIN ได้เอง (ปุ่มคัดลอกยังอยู่เป็นทางถอย) · เจ้าของ/ผจก.การเงินผูกกลุ่มปลายทางและแก้แม่แบบข้อความได้ที่ ตั้งค่า › การเงิน › GFIN · webhook ไฟแนนซ์จดว่าบอทเข้า/ออกกลุ่มไหน และเตือน OWNER/FM เมื่อบอทถูกเตะออกจากกลุ่มที่ผูกไว้

**Architecture:** ต่อยอดโมดูล `external-finance-application` (PR 1) — เพิ่ม `GfinLineGroupService` (สถานะกลุ่มปลายทาง · ตั้งค่า · push ผ่าน `LineFinanceClientService`) และ controller ตั้งค่า `gfin-precheck-settings` · `send`/`resend` รับ `via: 'BOT'` แล้ว push **ภายใน `$transaction`** เดียวกับ CAS สถานะ (LINE ล้ม = rollback ทั้งก้อน ⇒ สถานะ/โทเคนไม่เปลี่ยน ตามสเปก §5.1) · ฝั่ง `chatbot-finance` เพิ่ม `LineGroupMembershipService` รับ `join`/`leave` จาก webhook เดิม (`handleEvent`) upsert ตาราง `line_group_memberships` · ฝั่งเว็บ: hook `useFinanceApplication` ได้ `lineGroup` (สถานะพร้อมส่ง) → เปิดปุ่มบอทในขั้น 4 และปุ่ม "ส่งเพิ่ม" · แท็บใหม่ "กลุ่มไลน์ & ข้อความ" ใน `GfinConfigPage`

**Tech Stack:** NestJS 10 + Prisma 6 + PostgreSQL (jest unit ด้วย mock · `*.db.spec.ts` บน test_db) · `packages/shared` (validator แม่แบบ) · React 18 + Vite + Tailwind + shadcn (RadioGroup/Textarea/Tabs) + lucide-react + @tanstack/react-query (vitest + testing-library) · LINE Messaging API: `POST /v2/bot/message/push`, `GET /v2/bot/group/{groupId}/summary`, `GET /v2/bot/group/{groupId}/members/count`

**Spec:** `docs/superpowers/specs/2026-09-24-gfin-precheck-package-design.md` — §3 แถว PR 2 · §4.1 `LineGroupMembership` · §4.2 คอลัมน์ `ExternalFinanceCompany` · §5.1 `send` (`via: BOT`) · §6.1 "กลุ่มไลน์ปลายทาง" · §6.5 หน้าตั้งค่า (mockup บอร์ด 9 https://claude.ai/artifact/U3DMgJ3SWb8whpiiuLYPsa) · §10 LINE · §11 สิทธิ์ · §13 แจ้งเตือนบอทถูกเตะ · §14 เทสต์ PR 2 · §17 validate `{{link}}`

## Global Constraints

- Branch `feat/gfin-precheck-pr2` แตกจาก `origin/main` `ecf691229` (PR 1 #1637 + fix #1638 อยู่บน prod แล้ว web 26.9.55 · migration ล่าสุด `20261010000000_external_finance_application`) · migration ใหม่ชื่อ `20261011000000_line_group_membership` ไฟล์เดียว additive
- Prisma: UUID id · `createdAt/updatedAt/deletedAt` ทุก model · ห้าม hard delete · query กรอง `deletedAt: null` · enum ใช้ `LineChannelType` ที่มีอยู่ (type Postgres สร้างไว้ตั้งแต่ `20260408100000_add_chatbot_finance`) · prod ใช้ `prisma migrate deploy` (`.claude/rules/database.md`)
- **LINE client = `LineFinanceClientService`** (โมดูล chatbot-finance, token จาก IntegrationConfig `line-finance/channelToken`) — สเปก §10 เขียนว่า `LineApiClientService` แต่คลาสนั้น**ไม่ได้ export จาก `LineOaModule`** และ PR 1 ใช้ `LineFinanceClientService` สำหรับดึงรูปอยู่แล้ว ⇒ เบี่ยงจากสเปกโดยตั้งใจ (บันทึกลง spec ใน Task 7) · ห้ามใช้ OA ร้าน (`line-shop`) เด็ดขาด (§10)
- push = ข้อความ `text` เดียว ≤ 5,000 ตัวอักษร (`LINE_TEXT_MAX = 5000`) · เก็บ `x-line-request-id` ใน `ExternalFinanceApplication.lineRequestId` · LINE ล้มเหลว → **502 `BadGatewayException`** และ**สถานะ/โทเคนต้องไม่เปลี่ยน** · ไม่มี token → 400 · กลุ่มไม่พร้อม (ยังไม่ผูก/บอทออกแล้ว) → 400 ชี้ทางแก้ + บอกให้ใช้ปุ่มคัดลอก
- webhook ไฟแนนซ์ (`POST /chatbot/finance/webhook`) มี `LineFinanceWebhookGuard` + dedup อยู่แล้ว — **ไม่มี endpoint สาธารณะใหม่** จึงไม่ต้องแก้ `.claude/rules/security.md` · controller ตั้งค่าใหม่ต้อง `@UseGuards(JwtAuthGuard, RolesGuard)` ระดับ class + `@Roles(...)` ทุก method · roles ตั้งค่า/ส่งข้อความทดสอบ = `'OWNER', 'FINANCE_MANAGER'` (§11) · roles ใบยื่น = `FINANCE_APP_ROLES` เดิม
- ห้าม `await this.audit.log(...)` ใน `$transaction` (โมดูลนี้ไม่เขียน AuditLog เอง — `AuditInterceptor` global จดทุก mutating route)
- **ห้ามรัน `npm run lint` ใน apps/api (มี `--fix`)** — ตรวจ lint ด้วย `cd apps/api && npx eslint <ไฟล์ที่แตะ>` (ไม่มี `--fix`) ต้อง **0 errors** (deploy #1637 เคยแดงเพราะ `require()` ใน spec — กฎ `@typescript-eslint/no-require-imports`) · type-check `./tools/check-types.sh api` / `web` / `all` (build shared ก่อน: `npm run build --workspace=packages/shared`) · jest: `cd apps/api && npx jest <ไฟล์> --runInBand` · DB spec ต้องรันกับ `DATABASE_URL` ฐานทดสอบ (`test_db` หรือ `*_test`) ล้างแถวที่สร้างใน `afterAll` และ**ห้ามพึ่ง env นอก** (CI job Test API ส่งแค่ `DATABASE_URL` + `JWT_SECRET`)
- เว็บ: `useQuery`/`useMutation` เท่านั้น · `api` จาก `@/lib/api` · ห้าม hex/`text-gray-*`/`bg-white` · ตัวอักษรบน `bg-primary` = `text-primary-foreground` · เหลือง `text-warning-strong` · แดง `text-destructive` · ไทย `leading-snug` · สถานะต้องมีไอคอน/ข้อความ ไม่ใช่สีอย่างเดียว · `toast` จาก `sonner` · ไอคอน lucide-react
- ถ้อยคำ: ปุ่มหลัก "ส่งเช็ค GFIN" · ทางถอย "คัดลอกข้อความ + ลิงก์" · แท็บตั้งค่า "กลุ่มไลน์ & ข้อความ" · แม่แบบ = ข้อความ 12 ข้อ §7 ต้องมี `{{link}}` เสมอ · ห้ามเรียกปุ่มตอบของ GFIN ว่า "อนุมัติทางการ"
- ทุก deploy ต้อง bump `version` ใน `apps/web/package.json` → PR นี้ **`26.9.56`**
- MCP (`.claude/mcp/sql/policy.mjs`): ตารางใหม่ `line_group_memberships` ไม่ต้องเข้า allowlist — กฎชื่อคอลัมน์เดิมกัน `group_name` (`/name/i`) และ `picture_url` (`/picture/i`) ให้เอง ส่วน `group_id`/`member_count`/`line_group_id`/`precheck_template` เปิดได้ (ไม่ใช่ข้อมูลส่วนบุคคล) · หลัง migration ต้อง `npm run grants` แล้ว apply บน prod (ขั้นเจ้าของ เหมือน PR 1)

## Review Focus

1. **บอทถูกเตะออกจากกลุ่มขณะพนักงานเปิดแท็บค้างไว้แล้วกด "ส่งเช็ค GFIN"** — ต้องได้ 400 ข้อความชี้ทางแก้ ไม่ใช่ 502/500 และใบยัง DRAFT ไม่มีโทเคน (เทสต์ Task 3 `requireSendTarget`, Task 4 `send BOT ไม่พร้อม`)
2. **LINE ตอบ 429/500/timeout ตอนส่ง** — 502 + ใบยัง DRAFT + ไม่มีแถว event SENT + `shareTokenHash` ไม่ถูกเขียน (เทสต์ Task 3 `pushText`, Task 4 `push ล้ม = rollback`)
3. **แม่แบบถูกแก้จนไม่มี `{{link}}` หรือพิมพ์ตัวแปรผิด `{{cusomerName}}`** — บันทึกไม่ผ่าน บอกตัวแปรที่ผิดชัด ๆ (เทสต์ Task 3 shared validator + `updateSettings`, Task 6 ฝั่งเว็บ)
4. **webhook `join` มาซ้ำ / บอทเข้า → ออก → เข้าใหม่** — แถวเดียวต่อกลุ่ม `leftAt` ถูกล้าง ชื่อกลุ่มล่าสุด และ `join` ยังถูกจดแม้ `LINE_FINANCE_BOT_DISABLED=true` (เทสต์ Task 2 db spec + service spec)
5. **GFIN ตั้งกลุ่มใหม่แล้วเชิญบอท แต่ระบบยังผูกกลุ่มเก่าที่บอทออกไปแล้ว** — หน้าตั้งค่าแสดงทั้งสองกลุ่ม กลุ่มที่บอทออกแล้วเลือกไม่ได้ และแท็บ GFIN ขึ้น "บอทไม่อยู่ในกลุ่มแล้ว" จนกว่าจะเปลี่ยน (เทสต์ Task 5 `GfinLineGroupLine`, Task 6 panel)
6. **push สำเร็จแต่ commit ล้ม** (หายาก) — GFIN ถือลิงก์ที่ตอบ 410 ⇒ ต้องมี Sentry error ระบุ `applicationId` + `requestId` ให้ตามแก้ (เทสต์ Task 4)

## File Structure

API (`apps/api`):
- `prisma/schema.prisma` — model `LineGroupMembership` + 2 คอลัมน์บน `ExternalFinanceCompany` (Task 1)
- `prisma/migrations/20261011000000_line_group_membership/migration.sql` (Task 1)
- `src/modules/chatbot-finance/services/line-finance-client.service.ts` — `pushMessageStrict` · `getGroupSummary` · `getGroupMemberCount` · `LineFinanceNotConfiguredError` (Task 1)
- `src/modules/chatbot-finance/dto/line-webhook.dto.ts` — `LineJoinEvent` / `LineLeaveEvent` (Task 2)
- `src/modules/chatbot-finance/services/line-group-membership.service.ts` — onJoin/onLeave/list/find + แจ้ง OWNER/FM (Task 2)
- `src/modules/chatbot-finance/services/chatbot-finance.service.ts` — `handleEvent` เพิ่ม join/leave (Task 2)
- `src/modules/chatbot-finance/chatbot-finance.module.ts` — provider + export (Task 2)
- `src/modules/external-finance-application/services/gfin-line-group.service.ts` — status · settings · pushText · test message (Task 3)
- `src/modules/external-finance-application/gfin-precheck-settings.controller.ts` + `dto/gfin-precheck-settings.dto.ts` (Task 3)
- `src/modules/external-finance-application/constants.ts` — `LINE_TEXT_MAX`, `GFIN_SETTINGS_ROLES` (Task 3)
- `src/modules/external-finance-application/services/finance-application.service.ts` — send/resend BOT · แม่แบบบริษัท · `lineGroup` ในรายการห้อง (Task 4)
- `src/modules/external-finance-application/finance-applications.controller.ts` + `dto/finance-application.dto.ts` — `ResendFinanceApplicationDto` (Task 4)
- `src/modules/external-finance-application/finance-share-public.controller.ts` — ชื่อกลุ่มจริงท้ายหน้าลิงก์ (Task 4)
- `src/modules/external-finance-application/external-finance-application.module.ts` — provider/controller ใหม่ (Task 3)
- `__tests__/*.spec.ts` ที่แตะ: `line-finance-client.service.group.spec.ts` (ใหม่, Task 1) · `chatbot-finance.service.spec.ts` (Task 2) · `line-group-membership.service.spec.ts` + `line-group-membership.db.spec.ts` (ใหม่, Task 2) · `gfin-line-group.service.spec.ts` (ใหม่, Task 3) · `finance-application-controllers.spec.ts` (Task 3, 4) · `finance-application.service.spec.ts` + `finance-application-flow.db.spec.ts` (Task 4)

Shared (`packages/shared/src`):
- `finance-precheck-message.ts` + `.spec.ts` — `PRECHECK_TEMPLATE_PLACEHOLDERS` · `validatePrecheckTemplate` · `PRECHECK_TEMPLATE_ERROR_LABEL` (Task 3)

Web (`apps/web/src`):
- `pages/UnifiedInboxPage/components/gfin/gfin.ts` — `GfinLineGroupStatus` + ป้ายเหตุผล (Task 5)
- `pages/UnifiedInboxPage/hooks/useFinanceApplication.ts` + `.test.tsx` — `lineGroup` · `resend(via)` (Task 5)
- `pages/UnifiedInboxPage/components/gfin/GfinLineGroupLine.tsx` (ใหม่) · `GfinTab.tsx` · `GfinStepMessage.tsx` · `GfinStatusCard.tsx` + `GfinTab.test.tsx` (Task 5)
- `pages/GfinConfigPage/GfinPrecheckSettingsPanel.tsx` (ใหม่) + `__tests__/GfinPrecheckSettingsPanel.test.tsx` · `index.tsx` (Task 6)
- `config/settings-registry.tsx` — roles ของ item `gfin` (Task 6)
- `apps/web/package.json` version (Task 7)

Docs: `docs/superpowers/specs/2026-09-24-gfin-precheck-package-design.md` หัวข้อ "สถานะ" (Task 7)

---

### Task 1: Prisma schema + migration + LINE client แบบเข้มงวด (push คืน request id · group summary · member count)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `ExternalFinanceCompany` — เพิ่ม 2 คอลัมน์ · model ใหม่ `LineGroupMembership` ต่อท้าย `ExternalFinanceApplicationEvent`)
- Create: `apps/api/prisma/migrations/20261011000000_line_group_membership/migration.sql`
- Modify: `apps/api/src/modules/chatbot-finance/services/line-finance-client.service.ts` (เมธอดใหม่ 3 ตัว + error class + แยก `postJson` ออกจาก `callApi`)
- Test: `apps/api/src/modules/chatbot-finance/services/line-finance-client.service.group.spec.ts` (ใหม่)

**Interfaces:**
- Consumes: enum `LineChannelType { SHOP FINANCE STAFF }` (มีอยู่) · `IntegrationConfigService.getValue('line-finance', 'channelToken')`
- Produces: model `LineGroupMembership` (Task 2, 3 ใช้) · `ExternalFinanceCompany.lineGroupId` / `.precheckTemplate` (Task 3, 4) · `LineFinanceClientService.pushMessageStrict(to, messages): Promise<{ requestId: string | null }>` · `.getGroupSummary(groupId): Promise<{ groupId; groupName; pictureUrl? } | null>` · `.getGroupMemberCount(groupId): Promise<number | null>` · `export class LineFinanceNotConfiguredError extends Error` (Task 2, 3)

- [ ] **Step 1: เพิ่ม 2 คอลัมน์ใน `model ExternalFinanceCompany`** (วางต่อจากบรรทัด `applications ExternalFinanceApplication[]`)

```prisma
  // ยื่น GFIN PR 2 (spec §4.2) — กลุ่มไลน์ปลายทางของบอท + แม่แบบข้อความ 12 ข้อ (null = DEFAULT_PRECHECK_TEMPLATE ในโค้ด)
  lineGroupId      String? @map("line_group_id")
  precheckTemplate String? @map("precheck_template") @db.Text
```

- [ ] **Step 2: เพิ่ม model ใหม่ต่อท้าย `model ExternalFinanceApplicationEvent`**

```prisma
/// สมาชิกภาพของบอท OA ในกลุ่มไลน์ — จดจาก webhook join/leave (ยื่น GFIN PR 2, spec §4.1) · แถวเดียวต่อ (channel, groupId)
model LineGroupMembership {
  id          String          @id @default(uuid())
  channel     LineChannelType
  groupId     String          @map("group_id")
  groupName   String?         @map("group_name")     // จาก GET /v2/bot/group/{id}/summary — ดึงไม่ได้ = null
  pictureUrl  String?         @map("picture_url")
  memberCount Int?            @map("member_count")
  joinedAt    DateTime        @map("joined_at")      // เข้าครั้งล่าสุด (เข้าใหม่หลังถูกเตะ = อัปเดต)
  leftAt      DateTime?       @map("left_at")        // null = บอทยังอยู่ในกลุ่ม
  createdAt   DateTime        @default(now()) @map("created_at")
  updatedAt   DateTime        @updatedAt @map("updated_at")
  deletedAt   DateTime?       @map("deleted_at")

  @@unique([channel, groupId])
  @@index([channel, leftAt])
  @@map("line_group_memberships")
}
```

- [ ] **Step 3: migration (เขียนมือ additive)**

```sql
-- ยื่น GFIN PR 2 — บอทส่งเข้ากลุ่ม (spec 2026-09-24 §4.1/§4.2). Additive only.
CREATE TABLE "line_group_memberships" (
  "id" TEXT NOT NULL, "channel" "LineChannelType" NOT NULL, "group_id" TEXT NOT NULL,
  "group_name" TEXT, "picture_url" TEXT, "member_count" INTEGER,
  "joined_at" TIMESTAMP(3) NOT NULL, "left_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "deleted_at" TIMESTAMP(3),
  CONSTRAINT "line_group_memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "line_group_memberships_channel_group_id_key" ON "line_group_memberships"("channel", "group_id");
CREATE INDEX "line_group_memberships_channel_left_at_idx" ON "line_group_memberships"("channel", "left_at");

ALTER TABLE "external_finance_companies"
  ADD COLUMN "line_group_id" TEXT,
  ADD COLUMN "precheck_template" TEXT;
```

- [ ] **Step 4: ตรวจ schema + generate**

Run: `cd apps/api && npx prisma validate && npx prisma generate && npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$DATABASE_URL"` (ใช้ฐานทดสอบ `bestchoice_gfin_test`)
Expected: `No difference detected` (ถ้ามี diff = migration ไม่ตรง schema แก้ให้ตรงก่อนไปต่อ) · จากนั้น `DATABASE_URL=<ฐานทดสอบ> npx prisma migrate deploy` ผ่าน

- [ ] **Step 5: เขียน spec ของ client ก่อน (fetch mock)**

```ts
// apps/api/src/modules/chatbot-finance/services/line-finance-client.service.group.spec.ts
import { LineFinanceClientService, LineFinanceNotConfiguredError } from './line-finance-client.service';

const jsonRes = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({ ok: status >= 200 && status < 300, status, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

describe('LineFinanceClientService — group + strict push (GFIN PR 2)', () => {
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
  let token: string | undefined = 'tok-1';
  const service = new LineFinanceClientService({ getValue: jest.fn(async () => token) } as never);
  beforeEach(() => { fetchMock.mockReset(); token = 'tok-1'; global.fetch = fetchMock as unknown as typeof fetch; });

  it('pushMessageStrict posts to /message/push with the finance token and returns x-line-request-id', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, {}, { 'x-line-request-id': 'req-9' }));
    const r = await service.pushMessageStrict('Cgroup1', [{ type: 'text', text: 'hi' }]);
    expect(r).toEqual({ requestId: 'req-9' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(init?.body as string)).toEqual({ to: 'Cgroup1', messages: [{ type: 'text', text: 'hi' }] });
  });
  it('pushMessageStrict throws LineFinanceNotConfiguredError (never silently skips) when the token is missing', async () => {
    token = '';
    await expect(service.pushMessageStrict('C1', [{ type: 'text', text: 'x' }])).rejects.toBeInstanceOf(LineFinanceNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('pushMessageStrict rethrows LINE API errors with the status (caller maps to 502)', async () => {
    fetchMock.mockResolvedValue(jsonRes(429, { message: 'rate' }));
    await expect(service.pushMessageStrict('C1', [{ type: 'text', text: 'x' }])).rejects.toThrow(/LINE API 429/);
  });
  it('pushMessage (legacy, lenient) still skips silently without a token — existing callers unchanged', async () => {
    token = '';
    await expect(service.pushMessage('U1', [{ type: 'text', text: 'x' }])).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('getGroupSummary GETs /group/{id}/summary and returns the body; null on non-2xx or missing token', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { groupId: 'C1', groupName: 'GFIN : BESTCHOICE', pictureUrl: 'https://p' }));
    await expect(service.getGroupSummary('C1')).resolves.toEqual({ groupId: 'C1', groupName: 'GFIN : BESTCHOICE', pictureUrl: 'https://p' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.line.me/v2/bot/group/C1/summary');
    fetchMock.mockResolvedValue(jsonRes(404, {}));
    await expect(service.getGroupSummary('C1')).resolves.toBeNull();
    token = '';
    await expect(service.getGroupSummary('C1')).resolves.toBeNull();
  });
  it('getGroupMemberCount returns count, null on failure', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { count: 7 }));
    await expect(service.getGroupMemberCount('C1')).resolves.toBe(7);
    fetchMock.mockRejectedValue(new Error('net'));
    await expect(service.getGroupMemberCount('C1')).resolves.toBeNull();
  });
});
```

- [ ] **Step 6: รันให้แดง** — `cd apps/api && npx jest src/modules/chatbot-finance/services/line-finance-client.service.group.spec.ts --runInBand` → FAIL (`pushMessageStrict is not a function`)

- [ ] **Step 7: แก้ `line-finance-client.service.ts`** — (ก) เพิ่ม error class ก่อน `@Injectable()`; (ข) เพิ่ม 3 เมธอดสาธารณะ + `getJson` ต่อจาก `getUserProfile`; (ค) แทนที่ `callApi` ทั้งเมธอด (บรรทัด ~153–190) ด้วย `callApi` บาง ๆ ที่เรียก `postJson` ใหม่ — พฤติกรรมเดิม (ไม่มี token = warn + return · error = Sentry + throw · timeout = throw) ต้องเหมือนเดิมทุกประการ

```ts
/** โยนเมื่อไม่มี Channel Access Token ของ OA ไฟแนนซ์ — ทางเข้มงวด (ยื่น GFIN) ต้องรู้ ไม่ใช่ข้ามเงียบแบบ callApi */
export class LineFinanceNotConfiguredError extends Error {
  constructor() { super('LINE Finance access token not configured'); this.name = 'LineFinanceNotConfiguredError'; }
}
```

```ts
  /** push แบบเข้มงวด (ยื่น GFIN PR 2): ไม่มี token = โยน · LINE error = โยน · คืน x-line-request-id ไว้เก็บเป็นหลักฐานการส่ง */
  async pushMessageStrict(to: string, messages: LineMessage[]): Promise<{ requestId: string | null }> {
    const token = await this.getAccessToken();
    if (!token) throw new LineFinanceNotConfiguredError();
    const res = await this.postJson(token, `${this.apiBase}/message/push`, { to, messages });
    this.logger.log(`[LINE Finance] push(strict) → ${to.slice(0, 8)}…`);
    return { requestId: res.headers.get('x-line-request-id') };
  }

  /** ชื่อ/รูปกลุ่ม — https://developers.line.biz/en/reference/messaging-api/#get-group-summary · ดึงไม่ได้ = null (ไม่บล็อก webhook) */
  async getGroupSummary(groupId: string): Promise<{ groupId: string; groupName: string; pictureUrl?: string } | null> {
    return this.getJson(`${this.apiBase}/group/${groupId}/summary`, 'group summary');
  }

  async getGroupMemberCount(groupId: string): Promise<number | null> {
    const r = await this.getJson<{ count: number }>(`${this.apiBase}/group/${groupId}/members/count`, 'group member count');
    return typeof r?.count === 'number' ? r.count : null;
  }

  private async getJson<T>(url: string, what: string): Promise<T | null> {
    const token = await this.getAccessToken();
    if (!token) return null;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) { this.logger.warn(`[LINE Finance] ${what} API ${res.status}`); return null; }
      return (await res.json()) as T;
    } catch (err) {
      this.logger.warn(`[LINE Finance] ${what} fetch failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private async callApi(url: string, body: unknown): Promise<void> {
    const token = await this.getAccessToken();
    if (!token) {
      this.logger.warn('[LINE Finance] access token not configured — skipping send');
      return;
    }
    await this.postJson(token, url, body);
  }

  /** POST JSON → คืน Response เมื่อสำเร็จ · ไม่สำเร็จ = log + Sentry + throw (semantics เดิมของ callApi) */
  private async postJson(token: string, url: string, body: unknown): Promise<Response> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const errBody = await res.text();
        this.logger.error(`[LINE Finance] API error ${res.status}: ${errBody}`);
        const err = new Error(`LINE API ${res.status}: ${errBody}`);
        Sentry.captureException(err, { tags: { module: 'chatbot-finance', action: 'line_finance_api' }, extra: { url, status: res.status } });
        throw err;
      }
      return res;
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        this.logger.error(`[LINE Finance] API timeout after 10s: ${url}`);
        Sentry.captureException(err, { tags: { module: 'chatbot-finance', action: 'line_finance_api', reason: 'timeout' }, extra: { url } });
        throw new Error('LINE Finance API timeout');
      }
      throw err;
    }
  }
```

- [ ] **Step 8: รันให้เขียว + regression ของ spec เดิมที่แตะ client** — `npx jest src/modules/chatbot-finance --runInBand` → ทุก suite ผ่าน · `npx eslint src/modules/chatbot-finance/services/line-finance-client.service.ts src/modules/chatbot-finance/services/line-finance-client.service.group.spec.ts` → 0 errors

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261011000000_line_group_membership apps/api/src/modules/chatbot-finance/services/line-finance-client.service.ts apps/api/src/modules/chatbot-finance/services/line-finance-client.service.group.spec.ts
git commit -m "feat(gfin): PR2 T1 — ตาราง line_group_memberships + คอลัมน์กลุ่ม/แม่แบบบน GFIN + LINE finance client แบบเข้มงวด (push คืน request id, group summary)"
```

### Task 2: webhook ไฟแนนซ์รับ `join`/`leave` → `LineGroupMembershipService` + แจ้ง OWNER/FM เมื่อบอทถูกเตะจากกลุ่มที่ผูกไว้

**Files:**
- Modify: `apps/api/src/modules/chatbot-finance/dto/line-webhook.dto.ts` (union + 2 interface)
- Create: `apps/api/src/modules/chatbot-finance/services/line-group-membership.service.ts`
- Modify: `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` (constructor + `handleEvent` บรรทัด ~132–158)
- Modify: `apps/api/src/modules/chatbot-finance/chatbot-finance.module.ts` (providers + exports)
- Test: `apps/api/src/modules/chatbot-finance/services/line-group-membership.service.spec.ts` (ใหม่, mock) · `apps/api/src/modules/chatbot-finance/services/line-group-membership.db.spec.ts` (ใหม่, DB จริง) · `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts` (เพิ่ม provider stub + 4 เทสต์)

**Interfaces:**
- Consumes: `LineFinanceClientService.getGroupSummary/getGroupMemberCount` (Task 1) · `NotificationsService.send({ channel: 'IN_APP', recipient, subject, message })` · `GFIN_COMPANY_NAME` จาก `../../external-finance-application/constants` (ไฟล์ค่าคงที่ ไม่ใช่ DI — ไม่เกิดวงจรโมดูล)
- Produces: `LineGroupMembershipService.onJoin(channel: LineChannelType, groupId: string): Promise<void>` · `.onLeave(channel, groupId): Promise<void>` · `.list(channel): Promise<LineGroupMembership[]>` (บอทยังอยู่ก่อน แล้วเรียงเข้าล่าสุดก่อน) · `.find(channel, groupId): Promise<LineGroupMembership | null>` — export จาก `ChatbotFinanceModule` ให้ Task 3 ใช้

- [ ] **Step 1: DTO — เพิ่ม event 2 ชนิดใน `line-webhook.dto.ts`**

```ts
export type LineFinanceWebhookEvent =
  | LineMessageEvent
  | LineFollowEvent
  | LineUnfollowEvent
  | LinePostbackEvent
  | LineJoinEvent
  | LineLeaveEvent;

/** บอทถูกเชิญเข้ากลุ่ม/ห้องแชทหลายคน — https://developers.line.biz/en/reference/messaging-api/#join-event */
export interface LineJoinEvent extends LineEventBase {
  type: 'join';
  replyToken: string;
}

/** บอทถูกนำออกจากกลุ่ม (หรือกลุ่มถูกยุบ) — ไม่มี replyToken */
export interface LineLeaveEvent extends LineEventBase {
  type: 'leave';
}
```

- [ ] **Step 2: spec ของ service ใหม่ (mock) — เขียนก่อน**

```ts
// apps/api/src/modules/chatbot-finance/services/line-group-membership.service.spec.ts
import { LineGroupMembershipService } from './line-group-membership.service';

function make(over: { linkedCompany?: unknown; row?: unknown } = {}) {
  const prisma: any = {
    lineGroupMembership: {
      upsert: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(over.row ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    externalFinanceCompany: { findFirst: jest.fn().mockResolvedValue(over.linkedCompany ?? null) },
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: 'u-owner' }, { id: 'u-fm' }]),
      findFirst: jest.fn().mockResolvedValue({ id: 'u-system' }),
    },
    todo: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 't1' }) },
  };
  const lineClient = { getGroupSummary: jest.fn().mockResolvedValue({ groupId: 'C1', groupName: 'GFIN : BESTCHOICE', pictureUrl: 'https://p' }), getGroupMemberCount: jest.fn().mockResolvedValue(5) };
  const notifications = { send: jest.fn().mockResolvedValue({ id: 'n', status: 'SENT' }) };
  return { prisma, lineClient, notifications, service: new LineGroupMembershipService(prisma, lineClient as never, notifications as never) };
}

describe('LineGroupMembershipService.onJoin', () => {
  it('upserts one row per (channel, groupId) with summary + member count, clearing leftAt', async () => {
    const { prisma, service } = make();
    await service.onJoin('FINANCE', 'C1');
    expect(prisma.lineGroupMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { channel_groupId: { channel: 'FINANCE', groupId: 'C1' } },
      create: expect.objectContaining({ channel: 'FINANCE', groupId: 'C1', groupName: 'GFIN : BESTCHOICE', pictureUrl: 'https://p', memberCount: 5, leftAt: null }),
      update: expect.objectContaining({ groupName: 'GFIN : BESTCHOICE', memberCount: 5, leftAt: null, deletedAt: null }),
    }));
  });
  it('summary/count unavailable → still records the join, keeps the previous name (update omits groupName)', async () => {
    const { prisma, lineClient, service } = make();
    lineClient.getGroupSummary.mockResolvedValue(null);
    lineClient.getGroupMemberCount.mockResolvedValue(null);
    await service.onJoin('FINANCE', 'C2');
    const arg = prisma.lineGroupMembership.upsert.mock.calls[0][0];
    expect(arg.create).toEqual(expect.objectContaining({ groupName: null, memberCount: null }));
    expect(arg.update).not.toHaveProperty('groupName');
    expect(arg.update).not.toHaveProperty('memberCount');
  });
});

describe('LineGroupMembershipService.onLeave', () => {
  it('stamps leftAt and does NOT notify when the group is not linked to GFIN', async () => {
    const { prisma, notifications, service } = make({ row: { id: 'm1', groupName: 'อื่น ๆ' } });
    await service.onLeave('FINANCE', 'C9');
    expect(prisma.lineGroupMembership.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { leftAt: expect.any(Date) } });
    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(notifications.send).not.toHaveBeenCalled();
  });
  it('linked group → HIGH todo tagged gfin for every active OWNER/FINANCE_MANAGER + IN_APP each (spec §13)', async () => {
    const { prisma, notifications, service } = make({ row: { id: 'm1', groupName: 'GFIN : BESTCHOICE' }, linkedCompany: { id: 'gfin-1', name: 'GFIN' } });
    await service.onLeave('FINANCE', 'C1');
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ role: { in: ['OWNER', 'FINANCE_MANAGER'] }, isActive: true, deletedAt: null }) }));
    expect(prisma.todo.create).toHaveBeenCalledTimes(2);
    expect(prisma.todo.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assigneeId: 'u-owner', createdById: 'u-system', priority: 'HIGH', tags: ['gfin'], title: expect.stringContaining('GFIN : BESTCHOICE') }) }));
    expect(notifications.send).toHaveBeenCalledTimes(2);
    expect(notifications.send).toHaveBeenCalledWith(expect.objectContaining({ channel: 'IN_APP', recipient: 'u-fm' }));
  });
  it('dedups: an open todo with the same title for that user → no second todo (IN_APP still sent)', async () => {
    const { prisma, service } = make({ row: { id: 'm1', groupName: 'G' }, linkedCompany: { id: 'gfin-1', name: 'GFIN' } });
    prisma.todo.findFirst.mockResolvedValue({ id: 'open' });
    await service.onLeave('FINANCE', 'C1');
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });
  it('unknown group (no row) → logs and returns without throwing', async () => {
    const { prisma, service } = make();
    await expect(service.onLeave('FINANCE', 'Cx')).resolves.toBeUndefined();
    expect(prisma.lineGroupMembership.update).not.toHaveBeenCalled();
  });
  it('notification failures never propagate (webhook must stay 200)', async () => {
    const { prisma, notifications, service } = make({ row: { id: 'm1', groupName: 'G' }, linkedCompany: { id: 'gfin-1', name: 'GFIN' } });
    prisma.todo.create.mockRejectedValue(new Error('db'));
    notifications.send.mockRejectedValue(new Error('down'));
    await expect(service.onLeave('FINANCE', 'C1')).resolves.toBeUndefined();
  });
});

describe('LineGroupMembershipService.list', () => {
  it('orders groups the bot is still in first, then most recently joined', async () => {
    const { prisma, service } = make();
    prisma.lineGroupMembership.findMany.mockResolvedValue([
      { id: 'a', joinedAt: new Date('2026-09-01'), leftAt: new Date('2026-09-10') },
      { id: 'b', joinedAt: new Date('2026-09-02'), leftAt: null },
      { id: 'c', joinedAt: new Date('2026-09-05'), leftAt: null },
    ]);
    expect((await service.list('FINANCE')).map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(prisma.lineGroupMembership.findMany).toHaveBeenCalledWith({ where: { channel: 'FINANCE', deletedAt: null } });
  });
});
```

- [ ] **Step 3: รันให้แดง** — `npx jest src/modules/chatbot-finance/services/line-group-membership.service.spec.ts --runInBand` → FAIL (module not found)

- [ ] **Step 4: เขียน service**

```ts
// apps/api/src/modules/chatbot-finance/services/line-group-membership.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { LineChannelType, LineGroupMembership } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { LineFinanceClientService } from './line-finance-client.service';

const TODO_TAG = 'gfin';

/**
 * สมาชิกภาพของบอท OA ไฟแนนซ์ในกลุ่มไลน์ (ยื่น GFIN PR 2, spec §4.1/§10/§13)
 * webhook เรียก onJoin/onLeave · หน้าตั้งค่า GFIN อ่าน list/find · ห้าม throw ออกจาก onJoin/onLeave (LINE ต้องได้ 200)
 */
@Injectable()
export class LineGroupMembershipService {
  private readonly logger = new Logger(LineGroupMembershipService.name);
  constructor(
    private prisma: PrismaService,
    private lineClient: LineFinanceClientService,
    private notifications: NotificationsService,
  ) {}

  /** บอทถูกเชิญเข้ากลุ่ม (รวมกลับเข้ามาใหม่หลังถูกเตะ) — แถวเดียวต่อ (channel, groupId) · ชื่อ/จำนวนสมาชิกดึงไม่ได้ = คงค่าเดิม */
  async onJoin(channel: LineChannelType, groupId: string): Promise<void> {
    const [summary, memberCount] = await Promise.all([
      this.lineClient.getGroupSummary(groupId),
      this.lineClient.getGroupMemberCount(groupId),
    ]);
    const now = new Date();
    await this.prisma.lineGroupMembership.upsert({
      where: { channel_groupId: { channel, groupId } },
      create: { channel, groupId, groupName: summary?.groupName ?? null, pictureUrl: summary?.pictureUrl ?? null, memberCount, joinedAt: now, leftAt: null },
      update: {
        ...(summary ? { groupName: summary.groupName, pictureUrl: summary.pictureUrl ?? null } : {}),
        ...(memberCount !== null ? { memberCount } : {}),
        joinedAt: now, leftAt: null, deletedAt: null,
      },
    });
    this.logger.log(`[LINE ${channel}] joined group ${groupId.slice(0, 8)}… (${summary?.groupName ?? 'ไม่ทราบชื่อ'})`);
  }

  /** บอทถูกนำออก/กลุ่มถูกยุบ — stamp leftAt · กลุ่มที่ผูกกับบริษัทไฟแนนซ์อยู่ → แจ้ง OWNER/FM (spec §13) */
  async onLeave(channel: LineChannelType, groupId: string): Promise<void> {
    const row = await this.prisma.lineGroupMembership.findFirst({ where: { channel, groupId, deletedAt: null } });
    if (!row) { this.logger.warn(`[LINE ${channel}] leave for unknown group ${groupId.slice(0, 8)}…`); return; }
    await this.prisma.lineGroupMembership.update({ where: { id: row.id }, data: { leftAt: new Date() } });
    const linked = await this.prisma.externalFinanceCompany.findFirst({ where: { lineGroupId: groupId, deletedAt: null }, select: { id: true, name: true } });
    if (linked) await this.notifyBotLeft(linked.name, row.groupName ?? groupId);
  }

  /** กลุ่มที่บอทเคยเข้าใน channel นั้น — ยังอยู่ก่อน แล้วเรียงเข้าล่าสุดก่อน (เรียงใน JS: Prisma nulls-ordering ไม่คุ้มเปิดใช้เพื่อลิสต์สั้น ๆ) */
  async list(channel: LineChannelType): Promise<LineGroupMembership[]> {
    const rows = await this.prisma.lineGroupMembership.findMany({ where: { channel, deletedAt: null } });
    return rows.sort((a, b) => (a.leftAt ? 1 : 0) - (b.leftAt ? 1 : 0) || b.joinedAt.getTime() - a.joinedAt.getTime());
  }

  find(channel: LineChannelType, groupId: string): Promise<LineGroupMembership | null> {
    return this.prisma.lineGroupMembership.findFirst({ where: { channel, groupId, deletedAt: null } });
  }

  private async notifyBotLeft(companyName: string, groupName: string): Promise<void> {
    const title = `บอท OA ไฟแนนซ์ถูกนำออกจากกลุ่มไลน์ "${groupName}" ที่ผูกกับ ${companyName}`;
    const description = [
      'ส่งเช็ค GFIN ด้วยบอทไม่ได้จนกว่าจะเชิญ OA กลับเข้ากลุ่ม — ระหว่างนี้ทีมใช้ปุ่ม "คัดลอกข้อความ + ลิงก์" ได้ตามเดิม',
      'ตรวจ/เปลี่ยนกลุ่มที่ ตั้งค่า › การเงิน › GFIN › กลุ่มไลน์ & ข้อความ',
    ].join('\n');
    const [admins, system] = await Promise.all([
      this.prisma.user.findMany({ where: { role: { in: ['OWNER', 'FINANCE_MANAGER'] }, isActive: true, deletedAt: null }, select: { id: true } }),
      this.prisma.user.findFirst({ where: { isSystemUser: true, deletedAt: null }, select: { id: true } }),
    ]);
    for (const admin of admins) {
      try {
        const open = await this.prisma.todo.findFirst({ where: { assigneeId: admin.id, tags: { has: TODO_TAG }, title, status: { not: 'DONE' }, deletedAt: null }, select: { id: true } });
        if (!open) await this.prisma.todo.create({ data: { title, description, priority: 'HIGH', createdById: system?.id ?? admin.id, assigneeId: admin.id, tags: [TODO_TAG] } });
      } catch (err) {
        this.logger.warn(`todo create failed user=${admin.id}: ${(err as Error).message}`);
      }
      try {
        await this.notifications.send({ channel: 'IN_APP', recipient: admin.id, subject: title, message: description });
      } catch (err) {
        this.logger.warn(`IN_APP notify failed user=${admin.id}: ${(err as Error).message}`);
      }
    }
  }
}
```

- [ ] **Step 5: รันให้เขียว** — `npx jest src/modules/chatbot-finance/services/line-group-membership.service.spec.ts --runInBand` → PASS

- [ ] **Step 6: เทสต์ DB จริง (unique + rejoin)** — สร้าง `line-group-membership.db.spec.ts` (ไม่มี PII ไม่ต้องตั้งคีย์ · ฐานทดสอบ · ล้างใน afterAll)

```ts
// apps/api/src/modules/chatbot-finance/services/line-group-membership.db.spec.ts
/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/chatbot-finance/services/line-group-membership.db.spec.ts --runInBand
 * ไม่ต้องตั้ง PII env (ตารางนี้ไม่มีคอลัมน์เข้ารหัส) · สร้างบริษัทไฟแนนซ์ทดสอบของตัวเองแล้วลบทิ้ง
 */
import { PrismaClient } from '@prisma/client';
import { LineGroupMembershipService } from './line-group-membership.service';

const prisma = new PrismaClient();
const tag = `gfin-group-db-${Date.now()}`;
const groupId = `C${tag}`;
const lineClient = { getGroupSummary: jest.fn(), getGroupMemberCount: jest.fn().mockResolvedValue(3) };
const notifications = { send: jest.fn().mockResolvedValue({ id: 'n', status: 'SENT' }) };
let companyId = '';
let service: LineGroupMembershipService;

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) throw new Error(`สเปคนี้ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  const company = await prisma.externalFinanceCompany.create({ data: { name: `TEST-${tag}`, isActive: true } });
  companyId = company.id;
  service = new LineGroupMembershipService(prisma as never, lineClient as never, notifications as never);
});
afterAll(async () => {
  await prisma.todo.deleteMany({ where: { title: { contains: tag } } });
  await prisma.lineGroupMembership.deleteMany({ where: { groupId } });
  await prisma.externalFinanceCompany.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('LineGroupMembership บน DB จริง', () => {
  it('join → one row; join again with a new name → same row, name updated; leave → leftAt; rejoin → leftAt cleared', async () => {
    lineClient.getGroupSummary.mockResolvedValue({ groupId, groupName: `${tag} v1` });
    await service.onJoin('FINANCE', groupId);
    lineClient.getGroupSummary.mockResolvedValue({ groupId, groupName: `${tag} v2` });
    await service.onJoin('FINANCE', groupId);
    const rows = await prisma.lineGroupMembership.findMany({ where: { groupId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ channel: 'FINANCE', groupName: `${tag} v2`, memberCount: 3, leftAt: null }));

    await prisma.externalFinanceCompany.update({ where: { id: companyId }, data: { lineGroupId: groupId } });
    await service.onLeave('FINANCE', groupId);
    expect((await service.find('FINANCE', groupId))?.leftAt).toBeInstanceOf(Date);
    const owners = await prisma.user.count({ where: { role: { in: ['OWNER', 'FINANCE_MANAGER'] }, isActive: true, deletedAt: null } });
    expect(await prisma.todo.count({ where: { title: { contains: `${tag} v2` }, tags: { has: 'gfin' } } })).toBe(owners);
    expect(notifications.send).toHaveBeenCalledTimes(owners);

    await service.onJoin('FINANCE', groupId);
    expect((await service.find('FINANCE', groupId))?.leftAt).toBeNull();
    expect((await service.list('FINANCE')).some((r) => r.groupId === groupId)).toBe(true);
  });
});
```

Run: `DATABASE_URL='postgresql://iamnaii@localhost:5432/bestchoice_gfin_test?schema=public' npx jest src/modules/chatbot-finance/services/line-group-membership.db.spec.ts --runInBand` → PASS (ฐานทดสอบต้องผ่าน `prisma migrate deploy` ของ Task 1 แล้ว)

- [ ] **Step 7: ต่อเข้า `ChatbotFinanceService.handleEvent`** — เพิ่ม constructor param ท้ายสุด `private groups: LineGroupMembershipService` และวาง branch นี้**ก่อน** kill switch (`LINE_FINANCE_BOT_DISABLED`) เพราะการจดสมาชิกภาพไม่ใช่การตอบ

```ts
  async handleEvent(event: LineFinanceWebhookEvent): Promise<void> {
    // ยื่น GFIN PR 2 (spec §10): เข้า/ออกกลุ่ม = งานบัญชีสมาชิกภาพ ไม่ใช่การตอบ → จดก่อน kill switch เสมอ · 'room' (แชทหลายคน) ไม่นับ
    if ((event.type === 'join' || event.type === 'leave') && event.source.type === 'group' && event.source.groupId) {
      return event.type === 'join'
        ? this.groups.onJoin('FINANCE', event.source.groupId)
        : this.groups.onLeave('FINANCE', event.source.groupId);
    }

    // Owner-controlled kill switch — drop all events without reply when paused
    if (this.configService.get<string>('LINE_FINANCE_BOT_DISABLED') === 'true') {
      return;
    }
```

- [ ] **Step 8: เพิ่ม provider stub + เทสต์ใน `chatbot-finance.service.spec.ts`** — ใน `beforeEach` เพิ่ม `groups = { onJoin: jest.fn().mockResolvedValue(undefined), onLeave: jest.fn().mockResolvedValue(undefined) }` (ประกาศ `let groups: any` ด้านบน) และ `{ provide: LineGroupMembershipService, useValue: groups }` ใน providers · เพิ่มเทสต์ท้าย describe หลัก

```ts
  const makeGroupEvent = (type: 'join' | 'leave', sourceType: 'group' | 'room' = 'group') => ({
    type, mode: 'active', timestamp: Date.now(), webhookEventId: `evt-${type}`, deliveryContext: { isRedelivery: false },
    source: sourceType === 'group' ? { type: 'group' as const, groupId: 'Cgroup1', userId: 'U1' } : { type: 'room' as const, roomId: 'R1' },
    ...(type === 'join' ? { replyToken: 'rt-join' } : {}),
  }) as any;

  describe('เข้า/ออกกลุ่ม (ยื่น GFIN PR 2)', () => {
    it('join จากกลุ่ม → LineGroupMembershipService.onJoin(FINANCE, groupId) และไม่ตอบข้อความ', async () => {
      await service.handleEvent(makeGroupEvent('join'));
      expect(groups.onJoin).toHaveBeenCalledWith('FINANCE', 'Cgroup1');
      expect(lineClient.replyText).not.toHaveBeenCalled();
      expect(lineClient.replyMessage).not.toHaveBeenCalled();
    });
    it('leave จากกลุ่ม → onLeave', async () => {
      await service.handleEvent(makeGroupEvent('leave'));
      expect(groups.onLeave).toHaveBeenCalledWith('FINANCE', 'Cgroup1');
    });
    it('join จากห้องแชทหลายคน (room) → ไม่จด', async () => {
      await service.handleEvent(makeGroupEvent('join', 'room'));
      expect(groups.onJoin).not.toHaveBeenCalled();
    });
    it('LINE_FINANCE_BOT_DISABLED=true → ยังจด join (kill switch หยุดเฉพาะการตอบ)', async () => {
      const config = (service as any).configService as { get: jest.Mock };
      config.get.mockImplementation((k: string) => (k === 'LINE_FINANCE_BOT_DISABLED' ? 'true' : undefined));
      await service.handleEvent(makeGroupEvent('join'));
      expect(groups.onJoin).toHaveBeenCalledWith('FINANCE', 'Cgroup1');
      await service.handleEvent(makeTextEvent('สวัสดี'));
      expect(sessions.saveMessage).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 9: module** — `chatbot-finance.module.ts` providers เพิ่ม `LineGroupMembershipService` และ exports เพิ่ม `LineGroupMembershipService` (คอมเมนต์: `// ยื่น GFIN PR 2 — สถานะกลุ่มปลายทาง (ExternalFinanceApplicationModule)`)

- [ ] **Step 10: รันทั้งชุด + lint** — `npx jest src/modules/chatbot-finance --runInBand` → PASS ทุก suite · `npx eslint src/modules/chatbot-finance/services/line-group-membership.service.ts src/modules/chatbot-finance/services/line-group-membership.service.spec.ts src/modules/chatbot-finance/services/line-group-membership.db.spec.ts src/modules/chatbot-finance/services/chatbot-finance.service.ts src/modules/chatbot-finance/dto/line-webhook.dto.ts` → 0 errors · `./tools/check-types.sh api` → 0 errors

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/chatbot-finance
git commit -m "feat(gfin): PR2 T2 — webhook ไฟแนนซ์จด join/leave กลุ่มไลน์ (line_group_memberships) + เตือน OWNER/FM เมื่อบอทถูกเตะจากกลุ่ม GFIN"
```

### Task 3: validator แม่แบบ (shared) + `GfinLineGroupService` (สถานะกลุ่ม · ตั้งค่า · push · ข้อความทดสอบ) + controller `gfin-precheck-settings`

**Files:**
- Modify: `packages/shared/src/finance-precheck-message.ts` + `finance-precheck-message.spec.ts`
- Modify: `apps/api/src/modules/external-finance-application/constants.ts` (`LINE_TEXT_MAX`, `GFIN_SETTINGS_ROLES`)
- Create: `apps/api/src/modules/external-finance-application/services/gfin-line-group.service.ts`
- Create: `apps/api/src/modules/external-finance-application/dto/gfin-precheck-settings.dto.ts`
- Create: `apps/api/src/modules/external-finance-application/gfin-precheck-settings.controller.ts`
- Modify: `apps/api/src/modules/external-finance-application/external-finance-application.module.ts`
- Test: `packages/shared/src/finance-precheck-message.spec.ts` · `apps/api/src/modules/external-finance-application/__tests__/gfin-line-group.service.spec.ts` (ใหม่) · `__tests__/finance-application-controllers.spec.ts` (เพิ่ม controller ใหม่ในตาราง roles)

**Interfaces:**
- Consumes: `LineGroupMembershipService.list/find` (Task 2) · `LineFinanceClientService.pushMessageStrict/isConfigured` + `LineFinanceNotConfiguredError` (Task 1) · `DEFAULT_PRECHECK_TEMPLATE` (shared)
- Produces (shared): `PRECHECK_TEMPLATE_PLACEHOLDERS`, `PRECHECK_TEMPLATE_MAX_LENGTH = 4000`, `validatePrecheckTemplate(template): { errors: PrecheckTemplateError[]; unknown: string[] }`, `PRECHECK_TEMPLATE_ERROR_LABEL` (Task 3 API + Task 6 เว็บ)
- Produces (API): `GfinLineGroupStatus = { groupId: string | null; groupName: string | null; botInGroup: boolean; tokenConfigured: boolean; ready: boolean; reason: 'NOT_LINKED' | 'BOT_LEFT' | 'NO_TOKEN' | null }` · `GfinLineGroupService.status(): Promise<GfinLineGroupStatus>` · `.requireSendTarget(): Promise<{ groupId: string; groupName: string | null }>` (400 เมื่อไม่พร้อม) · `.pushText(groupId, text): Promise<{ requestId: string | null }>` (400 ไม่มี token · 400 ยาวเกิน · 502 LINE ล้ม) · `.getSettings()` · `.updateSettings(dto)` · `.sendTestMessage(actor)` · routes `GET/PUT /gfin-precheck-settings`, `POST /gfin-precheck-settings/test-message` (Task 4, 5, 6 ใช้)

- [ ] **Step 1: เทสต์ validator ใน shared (เขียนก่อน)** — เพิ่มท้าย `packages/shared/src/finance-precheck-message.spec.ts`

```ts
import { validatePrecheckTemplate, PRECHECK_TEMPLATE_MAX_LENGTH, DEFAULT_PRECHECK_TEMPLATE } from './finance-precheck-message';

describe('validatePrecheckTemplate', () => {
  it('default template passes', () => {
    expect(validatePrecheckTemplate(DEFAULT_PRECHECK_TEMPLATE)).toEqual({ errors: [], unknown: [] });
  });
  it('missing {{link}} is an error (spec §17)', () => {
    expect(validatePrecheckTemplate('เช็ค {{customerName}}').errors).toContain('MISSING_LINK');
  });
  it('unknown placeholders are listed once each', () => {
    const r = validatePrecheckTemplate('{{cusomerName}} {{cusomerName}} {{phone}} {{link}}');
    expect(r.errors).toEqual(['UNKNOWN_PLACEHOLDER']);
    expect(r.unknown).toEqual(['cusomerName']);
  });
  it('empty and too long', () => {
    expect(validatePrecheckTemplate('   ').errors).toEqual(expect.arrayContaining(['EMPTY', 'MISSING_LINK']));
    expect(validatePrecheckTemplate('{{link}}' + 'x'.repeat(PRECHECK_TEMPLATE_MAX_LENGTH)).errors).toContain('TOO_LONG');
  });
});
```

- [ ] **Step 2: รันให้แดง** — `cd packages/shared && npx vitest run src/finance-precheck-message.spec.ts` → FAIL (`validatePrecheckTemplate` is not exported)

- [ ] **Step 3: เพิ่มใน `finance-precheck-message.ts` (ท้ายไฟล์)**

```ts
/** ตัวแปรที่แม่แบบใช้ได้ — ต้องตรงกับคีย์ใน buildPrecheckMessage ทุกตัว */
export const PRECHECK_TEMPLATE_PLACEHOLDERS = ['customerName', 'occupation', 'model', 'hand', 'imei', 'phone', 'age', 'staffName', 'fileCount', 'link'] as const;
/** LINE รับข้อความ 5,000 ตัวอักษร — กันที่ 4,000 เผื่อค่าจริงที่ยาวกว่าตัวแปร (ชื่อรุ่นเต็ม ลิงก์ 80+ ตัว) */
export const PRECHECK_TEMPLATE_MAX_LENGTH = 4000;
export type PrecheckTemplateError = 'EMPTY' | 'TOO_LONG' | 'MISSING_LINK' | 'UNKNOWN_PLACEHOLDER';
export const PRECHECK_TEMPLATE_ERROR_LABEL: Record<PrecheckTemplateError, string> = {
  EMPTY: 'แม่แบบว่าง',
  TOO_LONG: `แม่แบบยาวเกิน ${PRECHECK_TEMPLATE_MAX_LENGTH} ตัวอักษร`,
  MISSING_LINK: 'ต้องมี {{link}} เพื่อวางลิงก์ชุดเอกสาร',
  UNKNOWN_PLACEHOLDER: 'มีตัวแปรที่ระบบไม่รู้จัก',
};

/** ตรวจแม่แบบก่อนบันทึก (spec §17 "แม่แบบถูกแก้จนไม่มี {{link}}") — errors ว่าง = ผ่าน · unknown = ชื่อตัวแปรที่ผิด (ไม่ซ้ำ) */
export function validatePrecheckTemplate(template: string): { errors: PrecheckTemplateError[]; unknown: string[] } {
  const t = template.trim();
  const errors: PrecheckTemplateError[] = [];
  if (!t) errors.push('EMPTY');
  if (t.length > PRECHECK_TEMPLATE_MAX_LENGTH) errors.push('TOO_LONG');
  if (!/\{\{link\}\}/.test(t)) errors.push('MISSING_LINK');
  const known: readonly string[] = PRECHECK_TEMPLATE_PLACEHOLDERS;
  const unknown = [...new Set([...t.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).filter((k) => !known.includes(k)))];
  if (unknown.length) errors.push('UNKNOWN_PLACEHOLDER');
  return { errors, unknown };
}
```

Run: `npx vitest run src/finance-precheck-message.spec.ts` → PASS · `npm run build --workspace=packages/shared` (api/web import ผ่าน dist)

- [ ] **Step 4: ค่าคงที่ใน `constants.ts` (API)**

```ts
/** LINE Messaging API: text message สูงสุด 5,000 ตัวอักษร (spec §10) */
export const LINE_TEXT_MAX = 5000;
/** ตั้งค่ากลุ่มไลน์/แม่แบบ/ส่งข้อความทดสอบ (spec §11) */
export const GFIN_SETTINGS_ROLES = ['OWNER', 'FINANCE_MANAGER'] as const;
```

- [ ] **Step 5: spec ของ `GfinLineGroupService` (เขียนก่อน)**

```ts
// apps/api/src/modules/external-finance-application/__tests__/gfin-line-group.service.spec.ts
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { GfinLineGroupService } from '../services/gfin-line-group.service';
import { LineFinanceNotConfiguredError } from '../../chatbot-finance/services/line-finance-client.service';

const company = { id: 'gfin-1', name: 'GFIN', lineGroupId: 'C1', precheckTemplate: null };
function make(over: { company?: unknown; row?: unknown; configured?: boolean } = {}) {
  const prisma: any = {
    externalFinanceCompany: { findFirst: jest.fn().mockResolvedValue(over.company === undefined ? company : over.company), update: jest.fn().mockResolvedValue({}) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'สมชาย' }) },
  };
  const lineFinance = { isConfigured: jest.fn().mockResolvedValue(over.configured ?? true), pushMessageStrict: jest.fn().mockResolvedValue({ requestId: 'req-1' }) };
  const memberships = {
    find: jest.fn().mockResolvedValue(over.row === undefined ? { groupId: 'C1', groupName: 'GFIN : BESTCHOICE', leftAt: null } : over.row),
    list: jest.fn().mockResolvedValue([{ groupId: 'C1', groupName: 'GFIN : BESTCHOICE', pictureUrl: null, memberCount: 4, joinedAt: new Date('2026-09-25'), leftAt: null }]),
  };
  return { prisma, lineFinance, memberships, service: new GfinLineGroupService(prisma, lineFinance as never, memberships as never) };
}

describe('GfinLineGroupService.status', () => {
  it('linked + bot in group + token → ready', async () => {
    await expect(make().service.status()).resolves.toEqual({ groupId: 'C1', groupName: 'GFIN : BESTCHOICE', botInGroup: true, tokenConfigured: true, ready: true, reason: null });
  });
  it('no lineGroupId → NOT_LINKED', async () => {
    await expect(make({ company: { ...company, lineGroupId: null } }).service.status()).resolves.toEqual(expect.objectContaining({ ready: false, reason: 'NOT_LINKED', groupId: null }));
  });
  it('bot left → BOT_LEFT (name still shown)', async () => {
    await expect(make({ row: { groupId: 'C1', groupName: 'เก่า', leftAt: new Date() } }).service.status()).resolves.toEqual(expect.objectContaining({ ready: false, reason: 'BOT_LEFT', groupName: 'เก่า', botInGroup: false }));
  });
  it('no token → NO_TOKEN', async () => {
    await expect(make({ configured: false }).service.status()).resolves.toEqual(expect.objectContaining({ ready: false, reason: 'NO_TOKEN' }));
  });
});

describe('GfinLineGroupService.requireSendTarget / pushText', () => {
  it('not ready → 400 with the reason and the copy fallback hint', async () => {
    await expect(make({ row: { leftAt: new Date(), groupName: 'x' } }).service.requireSendTarget()).rejects.toThrow(/บอท OA ไฟแนนซ์ไม่อยู่ในกลุ่มแล้ว.*คัดลอกข้อความ/);
  });
  it('pushText sends one text message and returns the request id', async () => {
    const { lineFinance, service } = make();
    await expect(service.pushText('C1', 'สวัสดี')).resolves.toEqual({ requestId: 'req-1' });
    expect(lineFinance.pushMessageStrict).toHaveBeenCalledWith('C1', [{ type: 'text', text: 'สวัสดี' }]);
  });
  it('pushText: over 5,000 chars → 400 before calling LINE', async () => {
    const { lineFinance, service } = make();
    await expect(service.pushText('C1', 'x'.repeat(5001))).rejects.toBeInstanceOf(BadRequestException);
    expect(lineFinance.pushMessageStrict).not.toHaveBeenCalled();
  });
  it('pushText: LINE error → 502 · missing token → 400', async () => {
    const { lineFinance, service } = make();
    lineFinance.pushMessageStrict.mockRejectedValueOnce(new Error('LINE API 500: boom'));
    await expect(service.pushText('C1', 'x')).rejects.toBeInstanceOf(BadGatewayException);
    lineFinance.pushMessageStrict.mockRejectedValueOnce(new LineFinanceNotConfiguredError());
    await expect(service.pushText('C1', 'x')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GfinLineGroupService.updateSettings', () => {
  it('links a group the bot is in and stores a valid template', async () => {
    const { prisma, service } = make();
    await service.updateSettings({ lineGroupId: 'C1', precheckTemplate: 'เช็ค {{customerName}} {{link}}' });
    expect(prisma.externalFinanceCompany.update).toHaveBeenCalledWith({ where: { id: 'gfin-1' }, data: { lineGroupId: 'C1', precheckTemplate: 'เช็ค {{customerName}} {{link}}' } });
  });
  it('unknown group → 400 · group the bot left → 400', async () => {
    await expect(make({ row: null }).service.updateSettings({ lineGroupId: 'Cx' })).rejects.toThrow(/ไม่พบกลุ่มนี้/);
    await expect(make({ row: { leftAt: new Date() } }).service.updateSettings({ lineGroupId: 'C1' })).rejects.toThrow(/ออกจากกลุ่มนี้แล้ว/);
  });
  it('template without {{link}} / with a typo placeholder → 400 naming the problem', async () => {
    await expect(make().service.updateSettings({ precheckTemplate: 'ไม่มีลิงก์' })).rejects.toThrow(/\{\{link\}\}/);
    await expect(make().service.updateSettings({ precheckTemplate: '{{cusomerName}} {{link}}' })).rejects.toThrow(/\{\{cusomerName\}\}/);
  });
  it('empty template → null (back to the built-in default) · lineGroupId null → unlink', async () => {
    const { prisma, service } = make();
    await service.updateSettings({ lineGroupId: null, precheckTemplate: '   ' });
    expect(prisma.externalFinanceCompany.update).toHaveBeenCalledWith({ where: { id: 'gfin-1' }, data: { lineGroupId: null, precheckTemplate: null } });
  });
});

describe('GfinLineGroupService.sendTestMessage', () => {
  it('pushes a test text naming the staff member to the linked group', async () => {
    const { lineFinance, service } = make();
    await expect(service.sendTestMessage({ id: 'u1', role: 'OWNER', name: null })).resolves.toEqual({ ok: true, groupName: 'GFIN : BESTCHOICE', requestId: 'req-1' });
    expect(lineFinance.pushMessageStrict.mock.calls[0][1][0].text).toMatch(/ทดสอบการเชื่อมต่อจาก BESTCHOICE[\s\S]*ส่งโดย สมชาย/);
  });
});
```

- [ ] **Step 6: รันให้แดง** — `cd apps/api && npx jest src/modules/external-finance-application/__tests__/gfin-line-group.service.spec.ts --runInBand` → FAIL

- [ ] **Step 7: DTO + service + controller**

```ts
// dto/gfin-precheck-settings.dto.ts
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PRECHECK_TEMPLATE_MAX_LENGTH } from '@installment/shared';

/** PUT /gfin-precheck-settings — ส่งเฉพาะช่องที่จะเปลี่ยน · null = ล้าง (ไม่ผูกกลุ่ม / กลับไปใช้แม่แบบในโค้ด) */
export class UpdateGfinPrecheckSettingsDto {
  @IsOptional() @IsString({ message: 'รหัสกลุ่มไม่ถูกต้อง' }) @MaxLength(64) lineGroupId?: string | null;
  @IsOptional() @IsString({ message: 'แม่แบบต้องเป็นข้อความ' }) @MaxLength(PRECHECK_TEMPLATE_MAX_LENGTH + 200, { message: 'แม่แบบยาวเกินไป' }) precheckTemplate?: string | null;
}
```

```ts
// services/gfin-line-group.service.ts
import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_PRECHECK_TEMPLATE, PRECHECK_TEMPLATE_ERROR_LABEL, validatePrecheckTemplate } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineFinanceClientService, LineFinanceNotConfiguredError } from '../../chatbot-finance/services/line-finance-client.service';
import { LineGroupMembershipService } from '../../chatbot-finance/services/line-group-membership.service';
import { FinanceActor, GFIN_COMPANY_NAME, LINE_TEXT_MAX } from '../constants';
import { UpdateGfinPrecheckSettingsDto } from '../dto/gfin-precheck-settings.dto';

export type GfinLineGroupReason = 'NOT_LINKED' | 'BOT_LEFT' | 'NO_TOKEN';
export interface GfinLineGroupStatus {
  groupId: string | null; groupName: string | null; botInGroup: boolean; tokenConfigured: boolean; ready: boolean; reason: GfinLineGroupReason | null;
}
/** ข้อความชี้ทางแก้ — เขียนหลังเปิดหน้าปลายทางแล้ว: ตั้งค่า › การเงิน › GFIN (แท็บ "กลุ่มไลน์ & ข้อความ") และ ตั้งค่า › เชื่อมต่อ › LINE FINANCE */
export const GFIN_LINE_GROUP_REASON_LABEL: Record<GfinLineGroupReason, string> = {
  NOT_LINKED: 'ยังไม่ได้ผูกกลุ่มไลน์ GFIN — ตั้งค่า › การเงิน › GFIN › กลุ่มไลน์ & ข้อความ',
  BOT_LEFT: 'บอท OA ไฟแนนซ์ไม่อยู่ในกลุ่มแล้ว — เชิญ OA กลับเข้ากลุ่ม แล้วเลือกกลุ่มอีกครั้งในตั้งค่า',
  NO_TOKEN: 'ยังไม่ได้ตั้ง Channel Access Token ของ LINE FINANCE — ตั้งค่า › เชื่อมต่อ',
};
const COPY_HINT = 'ระหว่างนี้ใช้ "คัดลอกข้อความ + ลิงก์" ได้ตามเดิม';

/** กลุ่มไลน์ปลายทางของชุดเช็ค GFIN + แม่แบบข้อความ (spec §6.5, §10) */
@Injectable()
export class GfinLineGroupService {
  constructor(
    private prisma: PrismaService,
    private lineFinance: LineFinanceClientService,
    private memberships: LineGroupMembershipService,
  ) {}

  private company() {
    return this.prisma.externalFinanceCompany.findFirst({
      where: { name: GFIN_COMPANY_NAME, deletedAt: null },
      select: { id: true, name: true, lineGroupId: true, precheckTemplate: true },
    });
  }

  async status(): Promise<GfinLineGroupStatus> {
    const [company, tokenConfigured] = await Promise.all([this.company(), this.lineFinance.isConfigured()]);
    if (!company?.lineGroupId) return { groupId: null, groupName: null, botInGroup: false, tokenConfigured, ready: false, reason: 'NOT_LINKED' };
    const row = await this.memberships.find('FINANCE', company.lineGroupId);
    const botInGroup = !!row && !row.leftAt;
    const reason: GfinLineGroupReason | null = !botInGroup ? 'BOT_LEFT' : !tokenConfigured ? 'NO_TOKEN' : null;
    return { groupId: company.lineGroupId, groupName: row?.groupName ?? null, botInGroup, tokenConfigured, ready: reason === null, reason };
  }

  /** เป้าหมายส่งด้วยบอท — ไม่พร้อม = 400 ชี้ทางแก้ (ปุ่มคัดลอกยังใช้ได้เสมอ) · ตรวจก่อนออกโทเคน/แตะสถานะ */
  async requireSendTarget(): Promise<{ groupId: string; groupName: string | null }> {
    const s = await this.status();
    if (!s.ready || !s.groupId) throw new BadRequestException(`${GFIN_LINE_GROUP_REASON_LABEL[s.reason ?? 'NOT_LINKED']} · ${COPY_HINT}`);
    return { groupId: s.groupId, groupName: s.groupName };
  }

  /** push ข้อความเดียว ≤ 5,000 ตัว (spec §10) — LINE ล้ม = 502 · ไม่มี token = 400 */
  async pushText(groupId: string, text: string): Promise<{ requestId: string | null }> {
    if (text.length > LINE_TEXT_MAX) throw new BadRequestException(`ข้อความยาว ${text.length} ตัวอักษร เกินที่ LINE รับ (${LINE_TEXT_MAX}) — ตัดแม่แบบให้สั้นลง`);
    try {
      return await this.lineFinance.pushMessageStrict(groupId, [{ type: 'text', text }]);
    } catch (err) {
      if (err instanceof LineFinanceNotConfiguredError) throw new BadRequestException(`${GFIN_LINE_GROUP_REASON_LABEL.NO_TOKEN} · ${COPY_HINT}`);
      throw new BadGatewayException(`ส่งเข้ากลุ่มไลน์ไม่สำเร็จ — ลองใหม่อีกครั้ง หรือใช้ "คัดลอกข้อความ + ลิงก์" ไปก่อน`);
    }
  }

  async getSettings() {
    const [company, groups, status] = await Promise.all([this.company(), this.memberships.list('FINANCE'), this.status()]);
    return {
      company: { lineGroupId: company?.lineGroupId ?? null, precheckTemplate: company?.precheckTemplate ?? null },
      groups: groups.map((g) => ({ groupId: g.groupId, groupName: g.groupName, pictureUrl: g.pictureUrl, memberCount: g.memberCount, joinedAt: g.joinedAt, leftAt: g.leftAt })),
      defaultTemplate: DEFAULT_PRECHECK_TEMPLATE,
      status,
    };
  }

  async updateSettings(dto: UpdateGfinPrecheckSettingsDto) {
    const company = await this.company();
    if (!company) throw new NotFoundException('ไม่พบบริษัท GFIN ในระบบ');
    const data: Prisma.ExternalFinanceCompanyUpdateInput = {};
    if (dto.lineGroupId !== undefined) {
      if (dto.lineGroupId === null) data.lineGroupId = null;
      else {
        const row = await this.memberships.find('FINANCE', dto.lineGroupId);
        if (!row) throw new BadRequestException('ไม่พบกลุ่มนี้ในรายการที่บอทเคยเข้า — เชิญ OA ไฟแนนซ์เข้ากลุ่มก่อน แล้วรีเฟรชหน้านี้');
        if (row.leftAt) throw new BadRequestException('บอทออกจากกลุ่มนี้แล้ว — เชิญกลับเข้ากลุ่มก่อนจึงผูกได้');
        data.lineGroupId = dto.lineGroupId;
      }
    }
    if (dto.precheckTemplate !== undefined) {
      const t = dto.precheckTemplate?.trim() ?? '';
      if (!t) data.precheckTemplate = null;
      else {
        const v = validatePrecheckTemplate(t);
        if (v.errors.length) {
          throw new BadRequestException(v.errors.map((e) => (e === 'UNKNOWN_PLACEHOLDER' ? `${PRECHECK_TEMPLATE_ERROR_LABEL[e]}: ${v.unknown.map((u) => `{{${u}}}`).join(', ')}` : PRECHECK_TEMPLATE_ERROR_LABEL[e])).join(' · '));
        }
        data.precheckTemplate = t;
      }
    }
    await this.prisma.externalFinanceCompany.update({ where: { id: company.id }, data });
    return this.getSettings();
  }

  /** ปุ่ม "ส่งข้อความทดสอบ" ในหน้าตั้งค่า (spec §6.5) */
  async sendTestMessage(actor: FinanceActor) {
    const target = await this.requireSendTarget();
    const name = actor.name ?? (await this.prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? 'พนักงาน';
    const text = `ทดสอบการเชื่อมต่อจาก BESTCHOICE ✅\nระบบพร้อมส่งชุดเช็ค GFIN เข้ากลุ่มนี้แล้ว (ข้อความ 12 ข้อ + ลิงก์เอกสาร)\nส่งโดย ${name} · ข้อความนี้ไม่ต้องตอบ`;
    const r = await this.pushText(target.groupId, text);
    return { ok: true as const, groupName: target.groupName, requestId: r.requestId };
  }
}
```

```ts
// gfin-precheck-settings.controller.ts
import { Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FinanceActor, GFIN_SETTINGS_ROLES } from './constants';
import { GfinLineGroupService } from './services/gfin-line-group.service';
import { UpdateGfinPrecheckSettingsDto } from './dto/gfin-precheck-settings.dto';

/** ตั้งค่า › การเงิน › GFIN › กลุ่มไลน์ & ข้อความ (spec §6.5, §11: OWNER/FINANCE_MANAGER) — path แยกจาก finance-applications/:id กันชน route */
@Controller('gfin-precheck-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...GFIN_SETTINGS_ROLES)
export class GfinPrecheckSettingsController {
  constructor(private lineGroup: GfinLineGroupService) {}

  @Get() @Roles(...GFIN_SETTINGS_ROLES)
  get() { return this.lineGroup.getSettings(); }

  @Put() @Roles(...GFIN_SETTINGS_ROLES)
  update(@Body() dto: UpdateGfinPrecheckSettingsDto) { return this.lineGroup.updateSettings(dto); }

  @Post('test-message') @HttpCode(200) @Roles(...GFIN_SETTINGS_ROLES)
  testMessage(@Req() req: { user: FinanceActor }) { return this.lineGroup.sendTestMessage(req.user); }
}
```

(ตรวจ path ของ guard/decorator ให้ตรงกับที่ `finance-applications.controller.ts` import อยู่ — `'../auth/guards/jwt-auth.guard'` ฯลฯ — คัดลอกบรรทัด import จากไฟล์นั้น)

- [ ] **Step 8: module** — `external-finance-application.module.ts`: controllers เพิ่ม `GfinPrecheckSettingsController` · providers เพิ่ม `GfinLineGroupService` · exports เพิ่ม `GfinLineGroupService` (ChatbotFinanceModule ถูก import แบบ forwardRef อยู่แล้ว จึงเห็น `LineGroupMembershipService` ที่ Task 2 export)

- [ ] **Step 9: เทสต์ roles ของ controller ใหม่** — ใน `finance-application-controllers.spec.ts` เพิ่ม describe ที่สอง

```ts
import { GfinPrecheckSettingsController } from '../gfin-precheck-settings.controller';
import { GFIN_SETTINGS_ROLES } from '../constants';

describe('GfinPrecheckSettingsController — OWNER/FINANCE_MANAGER on class and every route (spec §11)', () => {
  it('has method-level @Roles equal to GFIN_SETTINGS_ROLES', () => {
    expect(Reflect.getMetadata(ROLES_KEY, GfinPrecheckSettingsController)).toEqual([...GFIN_SETTINGS_ROLES]);
    const methods = Object.getOwnPropertyNames(GfinPrecheckSettingsController.prototype).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(['get', 'testMessage', 'update']);
    for (const method of methods) {
      const handler = (GfinPrecheckSettingsController.prototype as unknown as Record<string, unknown>)[method];
      expect({ method, roles: Reflect.getMetadata(ROLES_KEY, handler as object) }).toEqual({ method, roles: [...GFIN_SETTINGS_ROLES] });
    }
  });
});
```

- [ ] **Step 10: รันให้เขียว + lint + types** — `npx jest src/modules/external-finance-application --runInBand` → PASS (db spec ข้ามได้ถ้าไม่ตั้ง DATABASE_URL ทดสอบ — รันแยกใน Task 4) · `npx eslint src/modules/external-finance-application` → 0 errors · `./tools/check-types.sh api` → 0

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/finance-precheck-message.ts packages/shared/src/finance-precheck-message.spec.ts apps/api/src/modules/external-finance-application
git commit -m "feat(gfin): PR2 T3 — GfinLineGroupService (สถานะกลุ่ม/ตั้งค่า/push/ข้อความทดสอบ) + controller gfin-precheck-settings + validator แม่แบบใน shared"
```

### Task 4: `send`/`resend` ด้วยบอท (push ใน transaction · ล้ม = rollback) + แม่แบบของบริษัท + `lineGroup` ในรายการห้อง + ชื่อกลุ่มจริงท้ายหน้าลิงก์

**Files:**
- Modify: `apps/api/src/modules/external-finance-application/services/finance-application.service.ts` (`applicationInclude` · constructor · `renderText` · `send` · `resend` · `listForRoom`)
- Modify: `apps/api/src/modules/external-finance-application/dto/finance-application.dto.ts` (`ResendFinanceApplicationDto`)
- Modify: `apps/api/src/modules/external-finance-application/finance-applications.controller.ts` (`resend` รับ body)
- Modify: `apps/api/src/modules/external-finance-application/finance-share-public.controller.ts` (`lineGroupName` จากกลุ่มที่ผูกจริง)
- Test: `__tests__/finance-application.service.spec.ts` (แก้ `makeService` + 6 เทสต์ใหม่) · `__tests__/finance-application-flow.db.spec.ts` (แก้ constructor + 1 เทสต์ template) · `__tests__/finance-share-public.controller.spec.ts` (stub `GfinLineGroupService`)

**Interfaces:**
- Consumes: `GfinLineGroupService.requireSendTarget/pushText/status` (Task 3) · `DEFAULT_PRECHECK_TEMPLATE`, `buildPrecheckMessage` (shared)
- Produces: `POST /finance-applications/:id/send {via}` เมื่อ `BOT` → push แล้วคืน `{ application, messageText, shareUrl, pushed: true, groupName }` · `POST /finance-applications/:id/resend {via?}` (default `COPY`) → `{ …, rotated, pushed, groupName }` · `GET /staff-chat/rooms/:roomId/finance-applications` → `{ current, history, lineGroup: GfinLineGroupStatus }` (Task 5 ใช้) · `messageText` เรนเดอร์จาก `financeCompany.precheckTemplate ?? DEFAULT_PRECHECK_TEMPLATE` (ยกเว้นใบที่มี `messageOverride`)

- [ ] **Step 1: เทสต์ใน `finance-application.service.spec.ts` (เขียนก่อน)** — แก้ `makeService` ให้รับ `lineGroup` (พารามิเตอร์ที่ 4 ของ helper · ตัวที่ 7 ของ constructor) และเพิ่ม describe ใหม่

```ts
const makeLineGroup = (over: Partial<{ requireSendTarget: jest.Mock; pushText: jest.Mock; status: jest.Mock }> = {}) => ({
  requireSendTarget: jest.fn().mockResolvedValue({ groupId: 'Cgfin', groupName: 'GFIN : BESTCHOICE' }),
  pushText: jest.fn().mockResolvedValue({ requestId: 'req-77' }),
  status: jest.fn().mockResolvedValue({ groupId: 'Cgfin', groupName: 'GFIN : BESTCHOICE', botInGroup: true, tokenConfigured: true, ready: true, reason: null }),
  ...over,
});
function makeService(prisma: any, storage = makeStorage(), customers = makeCustomers(), lineGroup = makeLineGroup()) {
  return new FinanceApplicationService(prisma, numbers, pii, config, storage as any, customers as any, lineGroup as any);
}
```

(ดูว่าเทสต์ `send` เดิมในไฟล์นี้ตั้ง `externalFinanceApplication.findFirst` เป็นใบพร้อมส่งอย่างไร — ใช้ helper เดียวกัน เรียกว่า `readyApp()` ด้านล่างแทนชื่อจริงในไฟล์)

```ts
describe('FinanceApplicationService.send via BOT (PR 2)', () => {
  it('pushes the rendered text (with the share link) to the linked group inside the transaction and records lineRequestId + event meta', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { ...makePrisma().externalFinanceApplication, findFirst: jest.fn().mockResolvedValue(readyApp()) } });
    const lineGroup = makeLineGroup();
    const service = makeService(prisma, makeStorage(), makeCustomers(), lineGroup);
    const r = await service.send('app-1', { via: 'BOT' }, owner);
    expect(lineGroup.requireSendTarget).toHaveBeenCalled();
    expect(lineGroup.pushText).toHaveBeenCalledWith('Cgfin', expect.stringMatching(/เอกสารทั้งหมด \d+ ไฟล์: https:\/\/bestchoicephone\.app\/api\/g\/[A-Za-z0-9_-]{43}/));
    expect(prisma.externalFinanceApplication.update).toHaveBeenCalledWith({ where: { id: 'app-1' }, data: { lineRequestId: 'req-77' } });
    expect(prisma.externalFinanceApplicationEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'SENT', meta: expect.objectContaining({ via: 'BOT', lineRequestId: 'req-77', groupName: 'GFIN : BESTCHOICE' }) }) }));
    expect(r).toEqual(expect.objectContaining({ pushed: true, groupName: 'GFIN : BESTCHOICE' }));
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 20000 });
  });
  it('group not ready → 400 from requireSendTarget BEFORE any status/token write', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { ...makePrisma().externalFinanceApplication, findFirst: jest.fn().mockResolvedValue(readyApp()) } });
    const lineGroup = makeLineGroup({ requireSendTarget: jest.fn().mockRejectedValue(new BadRequestException('ยังไม่ได้ผูกกลุ่ม')) });
    await expect(makeService(prisma, makeStorage(), makeCustomers(), lineGroup).send('app-1', { via: 'BOT' }, owner)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.externalFinanceApplication.updateMany).not.toHaveBeenCalled();
  });
  it('LINE failure (502 from pushText) propagates and the transaction body throws → no SENT event, no lineRequestId', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { ...makePrisma().externalFinanceApplication, findFirst: jest.fn().mockResolvedValue(readyApp()) } });
    const lineGroup = makeLineGroup({ pushText: jest.fn().mockRejectedValue(new BadGatewayException('LINE ล่ม')) });
    await expect(makeService(prisma, makeStorage(), makeCustomers(), lineGroup).send('app-1', { via: 'BOT' }, owner)).rejects.toBeInstanceOf(BadGatewayException);
    expect(prisma.externalFinanceApplicationEvent.create).not.toHaveBeenCalled();
    expect(prisma.externalFinanceApplication.update).not.toHaveBeenCalled();
  });
  it('push succeeded but the commit failed → Sentry error with applicationId + requestId, error still propagates (Review Focus 6)', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { ...makePrisma().externalFinanceApplication, findFirst: jest.fn().mockResolvedValue(readyApp()) } });
    prisma.externalFinanceApplicationEvent.create.mockRejectedValue(new Error('db gone'));
    const capture = jest.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'evt');
    const lineGroup = makeLineGroup();
    await expect(makeService(prisma, makeStorage(), makeCustomers(), lineGroup).send('app-1', { via: 'BOT' }, owner)).rejects.toThrow('db gone');
    expect(lineGroup.pushText).toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith(expect.stringContaining('push succeeded'), expect.objectContaining({ level: 'error', extra: expect.objectContaining({ applicationId: 'app-1', requestId: 'req-77' }) }));
    capture.mockRestore();
  });
  it('COPY still never touches the line group', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { ...makePrisma().externalFinanceApplication, findFirst: jest.fn().mockResolvedValue(readyApp()) } });
    const lineGroup = makeLineGroup();
    await makeService(prisma, makeStorage(), makeCustomers(), lineGroup).send('app-1', { via: 'COPY' }, owner);
    expect(lineGroup.requireSendTarget).not.toHaveBeenCalled();
    expect(lineGroup.pushText).not.toHaveBeenCalled();
  });
  it('renders the company template when set (messageOverride still wins)', async () => {
    const app = readyApp({ financeCompany: { id: 'gfin-1', name: 'GFIN', lineGroupId: 'Cgfin', precheckTemplate: 'เช็คด่วน {{customerName}} · {{link}}' } });
    const prisma = makePrisma({ externalFinanceApplication: { ...makePrisma().externalFinanceApplication, findFirst: jest.fn().mockResolvedValue(app) } });
    const r = await makeService(prisma).send('app-1', { via: 'COPY' }, owner);
    expect(r.messageText).toMatch(/^เช็คด่วน .+ · https:\/\/bestchoicephone\.app\/api\/g\//);
    const overridden = readyApp({ messageOverride: 'ถ้อยคำเฉพาะใบ', financeCompany: app.financeCompany });
    prisma.externalFinanceApplication.findFirst.mockResolvedValue(overridden);
    expect((await makeService(prisma).send('app-1', { via: 'COPY' }, owner)).messageText).toMatch(/^ถ้อยคำเฉพาะใบ\nเอกสารทั้งหมด/);
  });
});

describe('FinanceApplicationService.resend via BOT (PR 2)', () => {
  it('pushes the short "ส่งเอกสารเพิ่ม" text and stamps lineRequestId', async () => {
    const app = readyApp({ status: 'MORE_INFO', shareTokenHash: hashShareToken('tok'), shareTokenEnc: encryptPII('tok', KEY), messageText: 'old', files: [{ id: 'f1', sentAt: null, slot: 'ID_CARD' }] });
    const prisma = makePrisma({ externalFinanceApplication: { ...makePrisma().externalFinanceApplication, findFirst: jest.fn().mockResolvedValue(app) } });
    const lineGroup = makeLineGroup();
    const r = await makeService(prisma, makeStorage(), makeCustomers(), lineGroup).resend('app-1', { via: 'BOT' }, owner);
    expect(lineGroup.pushText).toHaveBeenCalledWith('Cgfin', expect.stringMatching(/^ส่งเอกสารเพิ่ม 1 ไฟล์/));
    expect(r.pushed).toBe(true);
    expect(prisma.externalFinanceApplicationEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'RESENT', meta: expect.objectContaining({ via: 'BOT', lineRequestId: 'req-77' }) }) }));
  });
  it('resend without body defaults to COPY (web before PR 2 sends no body)', async () => {
    const app = readyApp({ status: 'MORE_INFO', shareTokenHash: hashShareToken('tok'), shareTokenEnc: encryptPII('tok', KEY), files: [{ id: 'f1', sentAt: null, slot: 'ID_CARD' }] });
    const prisma = makePrisma({ externalFinanceApplication: { ...makePrisma().externalFinanceApplication, findFirst: jest.fn().mockResolvedValue(app) } });
    const lineGroup = makeLineGroup();
    await makeService(prisma, makeStorage(), makeCustomers(), lineGroup).resend('app-1', {}, owner);
    expect(lineGroup.pushText).not.toHaveBeenCalled();
  });
});

describe('listForRoom (PR 2)', () => {
  it('includes lineGroup status for the tab', async () => {
    const r = await makeService(makePrisma()).listForRoom('room-1', owner);
    expect(r.lineGroup).toEqual(expect.objectContaining({ ready: true, groupName: 'GFIN : BESTCHOICE' }));
  });
});
```

(เพิ่ม `import { BadGatewayException } from '@nestjs/common'` และ `import * as Sentry from '@sentry/nestjs'` ด้านบน · `readyApp(over)` = helper ของไฟล์นี้ที่คืนใบ DRAFT ที่มีลูกค้า+เครื่อง+ไฟล์บังคับครบ และ `financeCompany: null` เป็นค่าตั้งต้น — ถ้ายังไม่มี helper รูปนี้ ให้สร้างจากใบที่เทสต์ `send` เดิมใช้)

- [ ] **Step 2: รันให้แดง** — `npx jest src/modules/external-finance-application/__tests__/finance-application.service.spec.ts --runInBand` → FAIL

- [ ] **Step 3: แก้ service**

(ก) `applicationInclude` เพิ่ม `financeCompany: { select: { id: true, name: true, lineGroupId: true, precheckTemplate: true } },` (ก่อน `sentBy`) · (ข) constructor เพิ่ม `private lineGroup: GfinLineGroupService,` ท้ายสุด · (ค) import `GfinLineGroupService` และ `import * as Sentry from '@sentry/nestjs';`

```ts
  private renderText(app: { messageOverride: string | null; financeCompany?: { precheckTemplate: string | null } | null }, values: PrecheckValues): string {
    const linkLine = `เอกสารทั้งหมด ${values.fileCount} ไฟล์: ${values.link ?? '{{link}}'}`;
    if (app.messageOverride?.trim()) return `${app.messageOverride.trim()}\n${linkLine}`;
    // PR 2 (spec §4.2): แม่แบบของบริษัทที่ตั้งในหน้าตั้งค่า — ว่าง = แม่แบบในโค้ด §7
    return buildPrecheckMessage(app.financeCompany?.precheckTemplate?.trim() || DEFAULT_PRECHECK_TEMPLATE, values);
  }
```

```ts
  async send(id: string, dto: SendFinanceApplicationDto, actor: FinanceActor) {
    const app = await this.load(id, actor); // access() ก่อนเสมอ — กัน SALES ข้ามห้องโผล่ผ่านทาง via:'BOT' (review fix round 1)
    // PR 2: ตรวจกลุ่มปลายทางก่อนแตะอะไร — ไม่พร้อม = 400 ชี้ทางแก้ (ใบยัง DRAFT ไม่มีโทเคน)
    const target = dto.via === 'BOT' ? await this.lineGroup.requireSendTarget() : null;
    const values = await this.buildValues(app, await this.staffName(actor), null);
    const r = this.readiness(app, values);
    if (!r.canSend) throw new BadRequestException(`ยังส่งไม่ได้: ${r.blockers.join(' · ')}`);
    const nextStatus = applyTransition(app.status, 'SEND');
    const token = newShareToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SHARE_TTL_DAYS * DAY_MS);
    const shareUrl = this.shareUrl(token.raw);
    const messageText = this.renderText(app, { ...values, link: shareUrl });
    const summary = { customerName: values.customerName, occupation: values.occupation, model: values.model, hand: values.hand, imei: values.imei, phone: values.phone, age: values.age, fileCount: values.fileCount };
    const pushedRef: { value: { requestId: string | null } | null } = { value: null };
    try {
      const application = await this.prisma.$transaction(async (tx) => {
        // CAS บนสถานะที่อ่านมา (minor 9) — กดส่งซ้ำ/ยกเลิกพร้อมกันต้องได้ 409 ไม่ใช่ออกโทเคนทับกัน
        const cas = await tx.externalFinanceApplication.updateMany({
          where: { id: app.id, status: app.status, deletedAt: null },
          data: {
            status: nextStatus, sentAt: now, sentById: actor.id, sentVia: dto.via, messageText, summary,
            shareTokenHash: token.hash, shareTokenEnc: encryptPII(token.raw, this.piiKey()), shareExpiresAt: expiresAt, shareRevokedAt: null,
          },
        });
        if (cas.count === 0) throw new ConflictException(STALE_STATUS_MSG);
        await tx.externalFinanceApplicationFile.updateMany({ where: { applicationId: app.id, deletedAt: null, sentAt: null }, data: { sentAt: now } });
        if (target) {
          // push ใน tx (spec §5.1 "push ล้มเหลว ไม่เปลี่ยนสถานะ"): LINE โยน → rollback ทั้งก้อน = สถานะ/โทเคน/ไฟล์ไม่ขยับ
          // row lock ค้างไม่เกิน timeout ของ LINE client (10s) — ปริมาณต่ำ (ไม่กี่ใบ/วัน) ยอมรับได้ · precedent: PaySolutions gateway+DB ใน $transaction
          pushedRef.value = await this.lineGroup.pushText(target.groupId, messageText);
          await tx.externalFinanceApplication.update({ where: { id: app.id }, data: { lineRequestId: pushedRef.value.requestId } });
        }
        await this.addEvent(tx, app.id, 'SENT', 'STAFF', {
          actorUserId: actor.id,
          meta: { via: dto.via, fileCount: values.fileCount, ...(pushedRef.value ? { lineRequestId: pushedRef.value.requestId, groupName: target?.groupName ?? null } : {}) },
        });
        return this.reloadView(tx, app.id);
      }, { timeout: 20_000 });
      return { application, messageText, shareUrl, pushed: !!pushedRef.value, groupName: target?.groupName ?? null };
    } catch (err) {
      if (pushedRef.value) {
        // push ถึง GFIN แล้วแต่ commit ล้ม — GFIN ถือลิงก์ที่ตอบ 410 · ต้องมีคนตามแก้ (Review Focus 6)
        Sentry.captureMessage('[gfin] LINE push succeeded but the send transaction failed — partner holds a link that now resolves to 410', {
          level: 'error', tags: { subsystem: 'gfin' }, extra: { applicationId: app.id, requestId: pushedRef.value.requestId },
        });
      }
      throw err;
    }
  }
```

```ts
  /** ส่งเพิ่มเฉพาะไฟล์ที่ยังไม่เคยส่ง — ลิงก์เดิม ต่ออายุ 7 วัน (spec §5.1) · ลิงก์ถูกยกเลิกไว้ = ออกลิงก์ใหม่ (I2) · PR 2: via BOT = push ข้อความสั้นเข้ากลุ่ม */
  async resend(id: string, dto: ResendFinanceApplicationDto, actor: FinanceActor) {
    const app = await this.load(id, actor);
    const via = dto.via ?? 'COPY';
    const target = via === 'BOT' ? await this.lineGroup.requireSendTarget() : null;
    const nextStatus = applyTransition(app.status, 'RESEND');
    const pending = app.files.filter((f) => !f.sentAt);
    if (!pending.length) throw new BadRequestException('ไม่มีไฟล์ใหม่ให้ส่งเพิ่ม');
    if (!app.shareTokenEnc) throw new NotFoundException('ใบยื่นนี้ยังไม่ได้ส่ง จึงยังไม่มีลิงก์');
    const rotation = app.shareRevokedAt ? this.rotateShare(app) : null;
    const url = rotation?.url ?? this.shareUrl(decryptPII(app.shareTokenEnc, this.piiKey()));
    const now = new Date();
    const messageText = rotation
      ? `ส่งเอกสารเพิ่ม ${pending.length} ไฟล์ (ใบยื่น ${app.number}) ลิงก์ใหม่ (ลิงก์เดิมถูกยกเลิกแล้ว): ${url}`
      : `ส่งเอกสารเพิ่ม ${pending.length} ไฟล์ (ใบยื่น ${app.number}) ลิงก์เดิม: ${url}`;
    const pushedRef: { value: { requestId: string | null } | null } = { value: null };
    try {
      const application = await this.prisma.$transaction(async (tx) => {
        const cas = await tx.externalFinanceApplication.updateMany({
          where: { id: app.id, status: app.status, shareTokenHash: app.shareTokenHash, deletedAt: null },
          data: { status: nextStatus, shareExpiresAt: new Date(now.getTime() + SHARE_TTL_DAYS * DAY_MS), ...(rotation?.data ?? {}) },
        });
        if (cas.count === 0) throw new ConflictException(STALE_STATUS_MSG);
        await tx.externalFinanceApplicationFile.updateMany({ where: { applicationId: app.id, deletedAt: null, sentAt: null }, data: { sentAt: now } });
        if (target) {
          pushedRef.value = await this.lineGroup.pushText(target.groupId, messageText);
          await tx.externalFinanceApplication.update({ where: { id: app.id }, data: { lineRequestId: pushedRef.value.requestId } });
        }
        await this.addEvent(tx, app.id, 'RESENT', 'STAFF', {
          actorUserId: actor.id,
          meta: { via, fileCount: pending.length, ...(rotation ? { rotated: true } : {}), ...(pushedRef.value ? { lineRequestId: pushedRef.value.requestId, groupName: target?.groupName ?? null } : {}) },
        });
        return this.reloadView(tx, app.id);
      }, { timeout: 20_000 });
      return { application, messageText, shareUrl: url, rotated: !!rotation, pushed: !!pushedRef.value, groupName: target?.groupName ?? null };
    } catch (err) {
      if (pushedRef.value) {
        Sentry.captureMessage('[gfin] LINE push succeeded but the resend transaction failed', { level: 'error', tags: { subsystem: 'gfin' }, extra: { applicationId: app.id, requestId: pushedRef.value.requestId } });
      }
      throw err;
    }
  }
```

`listForRoom` — เปลี่ยน `return { current, history }` เป็น

```ts
    return {
      current: current ? toApplicationView(current) : null,
      history: rows.filter((r) => r.id !== current?.id).map(toApplicationView),
      // PR 2 (spec §6.1 "กลุ่มไลน์ปลายทาง"): แท็บโชว์ชื่อกลุ่ม + พร้อมส่ง/บอทไม่อยู่ในกลุ่ม
      lineGroup: await this.lineGroup.status(),
    };
```

- [ ] **Step 4: DTO + controller**

```ts
// dto/finance-application.dto.ts — ต่อจาก SendFinanceApplicationDto
/** PR 2: ส่งเพิ่มด้วยบอทได้ · ไม่ส่ง body = COPY (เว็บก่อน PR 2 ไม่ส่ง body) */
export class ResendFinanceApplicationDto {
  @IsOptional() @IsIn(['COPY', 'BOT'], { message: 'วิธีส่งไม่ถูกต้อง' }) via?: 'COPY' | 'BOT';
}
```

`finance-applications.controller.ts` — เมธอด `resend` เพิ่ม `@Body() dto: ResendFinanceApplicationDto` แล้วส่งต่อ `this.applications.resend(id, dto, req.user)` (ดูลายเซ็นของ `send` ในไฟล์เดียวกันแล้วทำให้เหมือน)

- [ ] **Step 5: หน้าลิงก์สาธารณะใช้ชื่อกลุ่มจริง** — `finance-share-public.controller.ts`: inject `private lineGroup: GfinLineGroupService` และที่บรรทัด `lineGroupName: LINE_GROUP_NAME` เปลี่ยนเป็น `lineGroupName: (await this.lineGroup.status()).groupName ?? LINE_GROUP_NAME` (คงค่าคงที่เป็น fallback — หน้า 410 ยังใช้ค่าคงที่ตามเดิม) · ใน `finance-share-public.controller.spec.ts` เพิ่ม provider/argument stub `{ status: jest.fn().mockResolvedValue({ groupName: null }) }` ตามวิธีที่ spec นั้นสร้าง controller (ดูว่าเป็น `new Controller(...)` หรือ `Test.createTestingModule`)

- [ ] **Step 6: DB spec** — `finance-application-flow.db.spec.ts`: constructor เพิ่ม arg ที่ 7 = `lineGroupStub` (`{ status: async () => ({ groupId: null, groupName: null, botInGroup: false, tokenConfigured: false, ready: false, reason: 'NOT_LINKED' }), requireSendTarget: async () => { throw new Error('not in db spec'); } } as any`) · เพิ่มเทสต์หลัง "send(COPY) persists a hash…": ตั้ง `precheckTemplate = 'เช็คด่วน {{customerName}} {{link}}'` บนแถว GFIN ด้วย `prisma.externalFinanceCompany.update` → สร้างใบใหม่ในห้องใหม่ → `send COPY` → `messageText` ขึ้นต้น "เช็คด่วน" → คืนค่า `precheckTemplate: null` ใน `finally` (แถว GFIN ใช้ร่วมกับเทสต์อื่น)

Run: `DATABASE_URL='postgresql://iamnaii@localhost:5432/bestchoice_gfin_test?schema=public' npx jest src/modules/external-finance-application/__tests__/finance-application-flow.db.spec.ts --runInBand` → PASS (spec ตั้ง PII env เองอยู่แล้ว)

- [ ] **Step 7: รันทั้งโมดูล + lint + types** — `npx jest src/modules/external-finance-application --runInBand` → PASS · `npx eslint src/modules/external-finance-application` → 0 errors · `./tools/check-types.sh api` → 0

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/external-finance-application
git commit -m "feat(gfin): PR2 T4 — send/resend ด้วยบอท (push ใน tx, LINE ล้ม = rollback + 502) · แม่แบบของบริษัท · lineGroup ในรายการห้อง · ชื่อกลุ่มจริงท้ายหน้าลิงก์"
```

### Task 5: เว็บ — hook ได้ `lineGroup` · ปุ่ม "ส่งเช็ค GFIN" ทำงานจริง · "ส่งเพิ่ม" ด้วยบอท · กล่อง "กลุ่มไลน์ปลายทาง" บอกสถานะ

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/gfin/gfin.ts` (types + ป้ายเหตุผล)
- Modify: `apps/web/src/pages/UnifiedInboxPage/hooks/useFinanceApplication.ts` + `useFinanceApplication.test.tsx`
- Create: `apps/web/src/pages/UnifiedInboxPage/components/gfin/GfinLineGroupLine.tsx`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/gfin/GfinTab.tsx` · `GfinStepMessage.tsx` · `GfinStatusCard.tsx`
- Test: `apps/web/src/pages/UnifiedInboxPage/components/gfin/GfinTab.test.tsx` (แก้ `model()` + 5 เทสต์ใหม่)

**Interfaces:**
- Consumes: `GET /staff-chat/rooms/:roomId/finance-applications` → `{ current, history, lineGroup }` · `POST …/send {via}` → `{ …, pushed, groupName }` · `POST …/resend {via}` (Task 4)
- Produces: `FinanceApplicationModel.lineGroup: GfinLineGroupStatus | null` · `.resend(via?: 'COPY' | 'BOT')` · `SendResult.pushed?: boolean; groupName?: string | null` · component `GfinLineGroupLine` (Task 6 ไม่ใช้ — หน้าตั้งค่ามีป้ายของตัวเอง)

- [ ] **Step 1: types ใน `gfin.ts`** (ต่อจาก `GFIN_WEB_FORM_URL`)

```ts
/** สถานะกลุ่มไลน์ปลายทาง — ชุดเดียวกับ GfinLineGroupStatus ฝั่ง API (gfin-line-group.service.ts) */
export type GfinLineGroupReason = 'NOT_LINKED' | 'BOT_LEFT' | 'NO_TOKEN';
export interface GfinLineGroupStatus { groupId: string | null; groupName: string | null; botInGroup: boolean; tokenConfigured: boolean; ready: boolean; reason: GfinLineGroupReason | null }
/** ข้อความชี้ทางแก้ — ปลายทางมีจริง: ตั้งค่า › การเงิน › GFIN › แท็บ "กลุ่มไลน์ & ข้อความ" (OWNER/ผจก.การเงิน) · ตั้งค่า › เชื่อมต่อ */
export const LINE_GROUP_REASON_LABEL: Record<GfinLineGroupReason, string> = {
  NOT_LINKED: 'ยังไม่ได้ผูกกลุ่มไลน์ — เจ้าของ/ผจก.การเงินตั้งได้ที่ ตั้งค่า › การเงิน › GFIN',
  BOT_LEFT: 'บอทไม่อยู่ในกลุ่มแล้ว — เชิญ OA ไฟแนนซ์กลับเข้ากลุ่ม แล้วเลือกกลุ่มใหม่ในตั้งค่า',
  NO_TOKEN: 'ยังไม่ได้ตั้ง token LINE FINANCE — ตั้งค่า › เชื่อมต่อ',
};
/** ชื่อกลุ่มที่โชว์ — จากระบบก่อน ไม่มีค่อยถอยไปชื่อที่ทีมใช้อยู่วันนี้ */
export const lineGroupLabel = (s: GfinLineGroupStatus | null | undefined): string => s?.groupName ?? GFIN_LINE_GROUP;
```

- [ ] **Step 2: hook** — `useFinanceApplication.ts`

```ts
import { gfinStep, SLOT_LABELS, PARTNER_WAIT_STATUSES, type FinanceApplication, type FinancePreview, type FinanceSlot, type GfinLineGroupStatus } from '../components/gfin/gfin';

interface RoomFinanceData { current: FinanceApplication | null; history: FinanceApplication[]; lineGroup: GfinLineGroupStatus | null }
/** `rotated` = ลิงก์เดิมถูกยกเลิกไว้ ระบบออกลิงก์ใหม่ให้ · `pushed` = บอทส่งเข้ากลุ่มแล้ว (via BOT) · `groupName` = กลุ่มที่ส่ง */
export interface SendResult { application: FinanceApplication; messageText: string; shareUrl: string; rotated?: boolean; pushed?: boolean; groupName?: string | null }
```

ใน `FinanceApplicationModel`: เพิ่ม `lineGroup: GfinLineGroupStatus | null;` (หลัง `preview`) และเปลี่ยน `resend(): Promise<SendResult>` → `resend(via?: 'COPY' | 'BOT'): Promise<SendResult>` · ใน object ที่ return: `lineGroup: query.data?.lineGroup ?? null,` และ `resend: (via = 'COPY') => run(async () => (await api.post(`${base()}/resend`, { via })).data),`

เทสต์ใน `useFinanceApplication.test.tsx` (ดู pattern mock `api` ในไฟล์นั้น): เพิ่ม 2 เคส — `lineGroup` สะท้อนจาก response · `resend('BOT')` POST `/finance-applications/<id>/resend` ด้วย `{ via: 'BOT' }` และ `resend()` ส่ง `{ via: 'COPY' }`

- [ ] **Step 3: เทสต์ใน `GfinTab.test.tsx` (เขียนก่อน)** — แก้ `model()` ให้มี `lineGroup: null` (และ `resend: vi.fn().mockResolvedValue({ application: {}, messageText: 'MORE', shareUrl: 'https://x/api/g/t', pushed: false })`) แล้วเพิ่ม

```ts
const readyGroup = { groupId: 'C1', groupName: 'GFIN : BESTCHOICE (67301219)', botInGroup: true, tokenConfigured: true, ready: true, reason: null } as const;
const leftGroup = { ...readyGroup, botInGroup: false, ready: false, reason: 'BOT_LEFT' as const };

describe('GfinTab — กลุ่มไลน์ปลายทาง + ส่งด้วยบอท (PR 2)', () => {
  it('empty state: ยังไม่ผูกกลุ่ม → แสดงเหตุผล + ทางถอยคัดลอก', () => {
    renderTab(model({ lineGroup: { groupId: null, groupName: null, botInGroup: false, tokenConfigured: true, ready: false, reason: 'NOT_LINKED' } }));
    expect(screen.getByText(/ยังไม่ได้ผูกกลุ่มไลน์/)).toBeInTheDocument();
    expect(screen.getByText(/คัดลอกข้อความ \+ ลิงก์/)).toBeInTheDocument();
  });
  it('empty state: พร้อม → ชื่อกลุ่ม + "พร้อมส่งด้วยบอท"', () => {
    renderTab(model({ lineGroup: readyGroup }));
    expect(screen.getByText(/GFIN : BESTCHOICE \(67301219\) · พร้อมส่งด้วยบอท/)).toBeInTheDocument();
  });
  it('ขั้น 4: บอทไม่อยู่ในกลุ่ม → ปุ่ม "ส่งเช็ค GFIN" ปิด พร้อม title เหตุผล · ปุ่มคัดลอกยังกดได้', () => {
    const gfin = model({ current: app({ customerId: 'c1', productId: 'p1' }), preview: { text: 'TXT', values: {}, missingFields: [], missingRequiredSlots: [], warnings: [], canSend: true }, step: 4, lineGroup: leftGroup });
    renderTab(gfin, 'c1');
    const bot = screen.getByRole('button', { name: 'ส่งเช็ค GFIN' });
    expect(bot).toBeDisabled();
    expect(bot).toHaveAttribute('title', expect.stringContaining('บอทไม่อยู่ในกลุ่มแล้ว'));
    expect(screen.getByRole('button', { name: 'คัดลอกข้อความ + ลิงก์' })).toBeEnabled();
  });
  it('ขั้น 4: พร้อม → กด "ส่งเช็ค GFIN" → กล่องยืนยันบอทที่ต้องติ๊ก → send("BOT") + toast ชื่อกลุ่ม', async () => {
    const gfin = model({ current: app({ customerId: 'c1', productId: 'p1', files: [] }), preview: { text: 'TXT', values: {}, missingFields: [], missingRequiredSlots: [], warnings: [], canSend: true }, step: 4, lineGroup: readyGroup });
    (gfin.send as ReturnType<typeof vi.fn>).mockResolvedValue({ application: {}, messageText: 'TXT', shareUrl: 'https://x/api/g/t', pushed: true, groupName: 'GFIN : BESTCHOICE (67301219)' });
    renderTab(gfin, 'c1');
    fireEvent.click(screen.getByRole('button', { name: 'ส่งเช็ค GFIN' }));
    expect(screen.getByText(/ส่งเข้ากลุ่ม "GFIN : BESTCHOICE \(67301219\)" ด้วยบอท\?/)).toBeInTheDocument();
    const go = screen.getByRole('button', { name: 'ส่งเข้ากลุ่มเลย' });
    expect(go).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(go);
    await waitFor(() => expect(gfin.send).toHaveBeenCalledWith('BOT'));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('ส่งเข้ากลุ่ม "GFIN : BESTCHOICE (67301219)" แล้ว'));
  });
  it('การ์ดสถานะ: ส่งเพิ่มเมื่อกลุ่มพร้อม → resend("BOT") ไม่แตะคลิปบอร์ด · แสดง "ส่งด้วยบอท"', async () => {
    const gfin = model({ current: app({ status: 'MORE_INFO', sentVia: 'BOT', sentAt: '2026-09-25T10:00:00Z', messageText: 'OLD', files: [{ id: 'f1', slot: 'INCOME', sourceMessageId: null, mimeType: 'image/jpeg', size: 1, originalName: null, source: 'UPLOAD', sourceAngle: null, sortOrder: 0, sentAt: null, createdAt: '' }] }), lineGroup: readyGroup });
    (gfin.resend as ReturnType<typeof vi.fn>).mockResolvedValue({ application: {}, messageText: 'MORE', shareUrl: 'https://x/api/g/t', pushed: true, groupName: 'GFIN : BESTCHOICE (67301219)' });
    renderTab(gfin, 'c1');
    expect(screen.getByText(/ส่งด้วยบอท/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรูปแล้วส่งเพิ่ม' }));
    fireEvent.click(screen.getByRole('button', { name: /ส่งเพิ่ม \(1 ไฟล์ใหม่\)/ }));
    await waitFor(() => expect(gfin.resend).toHaveBeenCalledWith('BOT'));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('ส่งเพิ่มเข้ากลุ่ม'));
  });
});
```

(ถ้า `renderTab` ในไฟล์นี้ไม่ได้ mock `navigator.clipboard` ให้เพิ่ม `Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })` ใน `beforeEach` — เทสต์ COPY เดิมอาจพึ่งอยู่แล้ว)

- [ ] **Step 4: รันให้แดง** — `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/gfin/GfinTab.test.tsx` → FAIL

- [ ] **Step 5: `GfinLineGroupLine.tsx`**

```tsx
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { LINE_GROUP_REASON_LABEL, lineGroupLabel, type GfinLineGroupStatus } from './gfin';

/** บรรทัดสถานะกลุ่มไลน์ปลายทาง — สถานะต้องมีไอคอน+ข้อความ ไม่ใช่สีอย่างเดียว (frontend.md) */
export default function GfinLineGroupLine({ status }: { status: GfinLineGroupStatus | null }) {
  const name = lineGroupLabel(status);
  if (status?.ready) {
    return <p className="m-0 flex items-center gap-1 text-xs leading-snug"><CheckCircle2 className="size-3.5 shrink-0 text-primary" aria-hidden />{name} · พร้อมส่งด้วยบอท</p>;
  }
  const reason = status?.reason ?? 'NOT_LINKED';
  return (
    <>
      <p className="m-0 flex items-center gap-1 text-xs leading-snug"><AlertTriangle className="size-3.5 shrink-0 text-warning-strong" aria-hidden />{name}</p>
      <p className="m-0 mt-0.5 text-xs leading-snug text-warning-strong">{LINE_GROUP_REASON_LABEL[reason]} · ใช้ "คัดลอกข้อความ + ลิงก์" ไปก่อนได้</p>
    </>
  );
}
```

- [ ] **Step 6: `GfinTab.tsx`** — import `GfinLineGroupLine` · แทนที่ `<Group label="กลุ่มไลน์ปลายทาง">…</Group>` ใน empty state ด้วย `<Group label="กลุ่มไลน์ปลายทาง"><GfinLineGroupLine status={gfin.lineGroup} /></Group>` · ลบ import `GFIN_LINE_GROUP` ถ้าไม่ได้ใช้ที่อื่นในไฟล์

- [ ] **Step 7: `GfinStepMessage.tsx`** — เปลี่ยนเป็นสองโหมดในกล่องยืนยันเดียว

```tsx
import { LINE_GROUP_REASON_LABEL, lineGroupLabel, editableMessageText, productLabel, imeiTail, quietly } from './gfin';
// …ใน component:
  const [mode, setMode] = useState<'BOT' | 'COPY'>('COPY');
  const group = gfin.lineGroup;
  const botReady = !!group?.ready;
  const groupName = lineGroupLabel(group);
  const openConfirm = (m: 'BOT' | 'COPY') => { setMode(m); setConfirm(true); };
  const sendBot = async () => {
    let r: Awaited<ReturnType<FinanceApplicationModel['send']>>;
    try { r = await gfin.send('BOT'); } catch { return; /* toast จาก hook (400 เหตุผล / 502 ให้ใช้คัดลอก) */ }
    setConfirm(false);
    toast.success(`ส่งเข้ากลุ่ม "${r.groupName ?? groupName}" แล้ว · GFIN เปิดลิงก์ได้ทันที`);
  };
```

ปุ่ม + ข้อความใต้ปุ่ม (แทนสองบรรทัดเดิม `ส่งเช็ค GFIN` ที่ disabled และ `<p>บอทส่งเข้ากลุ่มจะพร้อมในเฟสถัดไป…`):

```tsx
      <div className="mt-2.5 grid gap-1.5">
        <Button size="sm" disabled={!botReady || !preview?.canSend || gfin.busy} title={!botReady ? LINE_GROUP_REASON_LABEL[group?.reason ?? 'NOT_LINKED'] : undefined} onClick={() => openConfirm('BOT')}>ส่งเช็ค GFIN</Button>
        <Button size="sm" variant="outline" disabled={!preview?.canSend || gfin.busy} onClick={() => openConfirm('COPY')}>คัดลอกข้อความ + ลิงก์</Button>
        <Button size="sm" variant="ghost" onClick={onBack}>ย้อนกลับ</Button>
      </div>
      {botReady
        ? <p className="m-0 mt-1 text-xs leading-snug text-muted-foreground">บอท OA ไฟแนนซ์ส่งเข้ากลุ่ม "{groupName}" ให้ · คัดลอกยังใช้ได้เป็นทางสำรอง</p>
        : <p className="m-0 mt-1 text-xs leading-snug text-warning-strong">{LINE_GROUP_REASON_LABEL[group?.reason ?? 'NOT_LINKED']} · ตอนนี้คัดลอกแล้ววางในกลุ่ม "{groupName}" เอง</p>}
```

กล่องยืนยัน: `DialogTitle` = `{mode === 'BOT' ? `ส่งเข้ากลุ่ม "${groupName}" ด้วยบอท?` : `ทำเครื่องหมายว่าส่งเข้ากลุ่ม "${groupName}"?`}` · ปุ่มหลักใน `DialogFooter` = `{mode === 'BOT' ? <Button disabled={!checked || gfin.busy} onClick={sendBot}>ส่งเข้ากลุ่มเลย</Button> : <Button disabled={!checked || gfin.busy} onClick={copyAndSend}>คัดลอกและทำเครื่องหมายว่าส่งแล้ว</Button>}` · แถว "จะส่ง" เพิ่มท้ายว่า `{mode === 'BOT' ? ' · บอท OA ไฟแนนซ์เป็นผู้ส่ง' : ' · คุณวางในไลน์เอง'}` · เช็กบ็อกซ์ "ตรวจแล้วว่าไฟล์ทุกใบเป็นของลูกค้าคนนี้" ใช้ร่วมทั้งสองโหมด (spec §6.2 บอร์ด 6)

- [ ] **Step 8: `GfinStatusCard.tsx`** — บรรทัดหัวการ์ด (`ข้อความ 12 ข้อ + ลิงก์ · N ไฟล์ · M ช่อง`) ต่อท้ายด้วย `{app.sentVia ? ` · ${app.sentVia === 'BOT' ? 'ส่งด้วยบอท' : 'ส่งแบบคัดลอก'}` : ''}` · `resend` เปลี่ยนเป็น

```tsx
  const resend = async () => {
    const via = gfin.lineGroup?.ready ? 'BOT' : 'COPY';
    let r: Awaited<ReturnType<FinanceApplicationModel['resend']>>;
    try { r = await gfin.resend(via); } catch { return; /* toast จาก hook */ }
    setLastResend({ appId: app.id, text: r.messageText });
    onCloseFiles();
    if (r.pushed) { toast.success(`ส่งเพิ่มเข้ากลุ่ม "${r.groupName ?? lineGroupLabel(gfin.lineGroup)}" แล้ว${r.rotated ? ' (ลิงก์ใหม่ — ลิงก์เดิมถูกยกเลิกไว้)' : ''}`); return; }
    try {
      await navigator.clipboard.writeText(r.messageText);
      toast.success(r.rotated ? 'ส่งเพิ่มด้วยลิงก์ใหม่ (ลิงก์เดิมถูกยกเลิกไว้) — คัดลอกข้อความแล้ว วางในกลุ่มไลน์ได้เลย' : 'คัดลอกข้อความ "ส่งเพิ่ม" แล้ว วางในกลุ่มไลน์ได้เลย');
    } catch {
      toast.error('บันทึกส่งเพิ่มแล้ว แต่คัดลอกอัตโนมัติไม่ได้ — กด "คัดลอกข้อความอีกครั้ง" แล้ววางในกลุ่มไลน์');
    }
  };
```

ปุ่ม "ส่งเพิ่ม (N ไฟล์ใหม่)" เพิ่ม `title={gfin.lineGroup?.ready ? 'บอทส่งเข้ากลุ่มให้' : 'บอทไม่พร้อม — จะคัดลอกข้อความให้วางเอง'}` · import `lineGroupLabel` จาก `./gfin`

- [ ] **Step 9: รันให้เขียว** — `npx vitest run src/pages/UnifiedInboxPage/components/gfin src/pages/UnifiedInboxPage/hooks` → PASS ทั้งหมด (รวมเทสต์ COPY เดิม) · `./tools/check-types.sh web` → 0 · `npx eslint src/pages/UnifiedInboxPage/components/gfin src/pages/UnifiedInboxPage/hooks/useFinanceApplication.ts` → 0 errors

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage
git commit -m "feat(gfin): PR2 T5 — แท็บ GFIN ส่งด้วยบอท (ปุ่มส่งเช็ค GFIN + ส่งเพิ่ม) และกล่องกลุ่มไลน์ปลายทางบอกสถานะพร้อม/บอทไม่อยู่"
```

### Task 6: เว็บ — แท็บ "กลุ่มไลน์ & ข้อความ" ใน ตั้งค่า › การเงิน › GFIN (เลือกกลุ่ม · ส่งข้อความทดสอบ · แม่แบบ)

**Files:**
- Create: `apps/web/src/pages/GfinConfigPage/GfinPrecheckSettingsPanel.tsx`
- Create: `apps/web/src/pages/GfinConfigPage/__tests__/GfinPrecheckSettingsPanel.test.tsx`
- Modify: `apps/web/src/pages/GfinConfigPage/index.tsx` (แท็บใหม่ · role อื่นที่ไม่ใช่ OWNER เห็นเฉพาะแท็บนี้)
- Modify: `apps/web/src/config/settings-registry.tsx` (item `gfin` roles เพิ่ม `'FINANCE_MANAGER'`)

**Interfaces:**
- Consumes: `GET /gfin-precheck-settings` → `{ company: { lineGroupId, precheckTemplate }, groups: [{ groupId, groupName, pictureUrl, memberCount, joinedAt, leftAt }], defaultTemplate, status: GfinLineGroupStatus }` · `PUT /gfin-precheck-settings { lineGroupId?, precheckTemplate? }` · `POST /gfin-precheck-settings/test-message` → `{ ok, groupName, requestId }` (Task 3) · `validatePrecheckTemplate`, `PRECHECK_TEMPLATE_ERROR_LABEL`, `PRECHECK_TEMPLATE_PLACEHOLDERS` (shared) · `GfinLineGroupStatus`, `LINE_GROUP_REASON_LABEL` (Task 5)
- Produces: หน้าจอตาม mockup บอร์ด 9 — ส่วน "กลุ่มไลน์ที่รับชุดเช็ค" (3 ขั้นตอน + รายการกลุ่ม + ส่งข้อความทดสอบ) และ "ข้อความ 12 ข้อ (แม่แบบ)" (textarea + ใช้ค่าเริ่มต้น)

- [ ] **Step 1: เทสต์ (เขียนก่อน)** — pattern เดียวกับ `GfinSettingsPanel.test.tsx` (mock `@/contexts/AuthContext` + `@/lib/api` ด้วย `get/put/post`)

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const authState = vi.hoisted(() => ({ role: 'OWNER' as string }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: authState.role } }) }));
const apiGet = vi.fn(); const apiPut = vi.fn(); const apiPost = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), default: { get: (...a: unknown[]) => apiGet(...a), put: (...a: unknown[]) => apiPut(...a), post: (...a: unknown[]) => apiPost(...a) } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { GfinPrecheckSettingsPanel } from '../GfinPrecheckSettingsPanel';

const DEFAULT_TEMPLATE = 'รายละเอียดที่ต้องแจ้งเช็คค่ะ\n1.ชื่อลูกค้า : {{customerName}}\nเอกสารทั้งหมด {{fileCount}} ไฟล์: {{link}}';
const settings = {
  company: { lineGroupId: 'C1', precheckTemplate: null },
  groups: [
    { groupId: 'C1', groupName: 'GFIN : BESTCHOICE (67301219)', pictureUrl: null, memberCount: 6, joinedAt: '2026-09-25T09:00:00Z', leftAt: null },
    { groupId: 'C0', groupName: 'กลุ่มเก่า', pictureUrl: null, memberCount: 3, joinedAt: '2026-08-01T09:00:00Z', leftAt: '2026-09-20T09:00:00Z' },
  ],
  defaultTemplate: DEFAULT_TEMPLATE,
  status: { groupId: 'C1', groupName: 'GFIN : BESTCHOICE (67301219)', botInGroup: true, tokenConfigured: true, ready: true, reason: null },
};
function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
beforeEach(() => { authState.role = 'OWNER'; apiGet.mockReset(); apiPut.mockReset(); apiPost.mockReset(); apiGet.mockResolvedValue({ data: settings }); apiPut.mockResolvedValue({ data: settings }); apiPost.mockResolvedValue({ data: { ok: true, groupName: 'GFIN : BESTCHOICE (67301219)', requestId: 'r1' } }); vi.mocked(toast.error).mockClear(); vi.mocked(toast.success).mockClear(); });

describe('GfinPrecheckSettingsPanel', () => {
  it('lists groups: the linked one checked, the one the bot left disabled with a badge; status line says ready', async () => {
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    expect(await screen.findByRole('radio', { name: /GFIN : BESTCHOICE \(67301219\)/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /กลุ่มเก่า/ })).toBeDisabled();
    expect(screen.getByText('บอทออกจากกลุ่มแล้ว')).toBeInTheDocument();
    expect(screen.getByText(/พร้อมส่งด้วยบอท/)).toBeInTheDocument();
  });
  it('no groups yet → 3-step instructions and no radio list', async () => {
    apiGet.mockResolvedValue({ data: { ...settings, groups: [], company: { lineGroupId: null, precheckTemplate: null }, status: { ...settings.status, groupId: null, groupName: null, ready: false, reason: 'NOT_LINKED' } } });
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    expect(await screen.findByText(/เชิญ OA ไฟแนนซ์เข้ากลุ่ม/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });
  it('save PUTs lineGroupId + template; empty template → null', async () => {
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    await screen.findByRole('radio', { name: /GFIN : BESTCHOICE/ });
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/gfin-precheck-settings', { lineGroupId: 'C1', precheckTemplate: null }));
    expect(toast.success).toHaveBeenCalled();
  });
  it('template without {{link}} is blocked client-side with the shared error label', async () => {
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    const ta = await screen.findByLabelText('แม่แบบข้อความ 12 ข้อ');
    await userEvent.clear(ta);
    await userEvent.type(ta, 'เช็ค {{{{customerName}}}}');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('{{link}}'));
    expect(apiPut).not.toHaveBeenCalled();
  });
  it('"ใช้ค่าเริ่มต้น" fills the textarea with the default template', async () => {
    apiGet.mockResolvedValue({ data: { ...settings, company: { lineGroupId: 'C1', precheckTemplate: 'เก่า {{link}}' } } });
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    const ta = await screen.findByLabelText('แม่แบบข้อความ 12 ข้อ');
    expect(ta).toHaveValue('เก่า {{link}}');
    await userEvent.click(screen.getByRole('button', { name: 'ใช้ค่าเริ่มต้น' }));
    expect(ta).toHaveValue(DEFAULT_TEMPLATE);
  });
  it('"ส่งข้อความทดสอบ" POSTs and toasts the group name', async () => {
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    await userEvent.click(await screen.findByRole('button', { name: 'ส่งข้อความทดสอบ' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/gfin-precheck-settings/test-message'));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('GFIN : BESTCHOICE (67301219)'));
  });
  it('FINANCE_MANAGER can edit; SALES is read-only', async () => {
    authState.role = 'FINANCE_MANAGER';
    const { unmount } = render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    expect(await screen.findByRole('button', { name: 'บันทึก' })).toBeInTheDocument();
    unmount();
    authState.role = 'SALES';
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    expect(await screen.findByRole('radio', { name: /GFIN : BESTCHOICE/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'บันทึก' })).toBeNull();
  });
});
```

- [ ] **Step 2: รันให้แดง** — `cd apps/web && npx vitest run src/pages/GfinConfigPage/__tests__/GfinPrecheckSettingsPanel.test.tsx` → FAIL

- [ ] **Step 3: component**

```tsx
// apps/web/src/pages/GfinConfigPage/GfinPrecheckSettingsPanel.tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Send } from 'lucide-react';
import { PRECHECK_TEMPLATE_ERROR_LABEL, PRECHECK_TEMPLATE_PLACEHOLDERS, validatePrecheckTemplate } from '@installment/shared';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { formatThaiDateShort } from '@/lib/date';
import { LINE_GROUP_REASON_LABEL, type GfinLineGroupStatus } from '@/pages/UnifiedInboxPage/components/gfin/gfin';

/** shape ของ GET /gfin-precheck-settings */
export interface GfinPrecheckSettingsApi {
  company: { lineGroupId: string | null; precheckTemplate: string | null };
  groups: Array<{ groupId: string; groupName: string | null; pictureUrl: string | null; memberCount: number | null; joinedAt: string; leftAt: string | null }>;
  defaultTemplate: string;
  status: GfinLineGroupStatus;
}
export const GFIN_PRECHECK_SETTINGS_QUERY_KEY = ['gfin-precheck-settings'] as const;
const EDIT_ROLES = ['OWNER', 'FINANCE_MANAGER'];

/** ตั้งค่า › การเงิน › GFIN › กลุ่มไลน์ & ข้อความ (spec §6.5, mockup บอร์ด 9) — OWNER/ผจก.การเงินแก้ได้ role อื่นดูอย่างเดียว */
export function GfinPrecheckSettingsPanel() {
  const { user } = useAuth();
  const canEdit = EDIT_ROLES.includes(user?.role ?? '');
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<GfinPrecheckSettingsApi>({
    queryKey: GFIN_PRECHECK_SETTINGS_QUERY_KEY,
    queryFn: async () => (await api.get<GfinPrecheckSettingsApi>('/gfin-precheck-settings')).data,
  });
  const [groupId, setGroupId] = useState<string | null>(null);
  const [template, setTemplate] = useState('');
  useEffect(() => { if (data) { setGroupId(data.company.lineGroupId); setTemplate(data.company.precheckTemplate ?? ''); } }, [data]);

  const save = useMutation({
    mutationFn: (payload: { lineGroupId: string | null; precheckTemplate: string | null }) => api.put('/gfin-precheck-settings', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: GFIN_PRECHECK_SETTINGS_QUERY_KEY }); qc.invalidateQueries({ queryKey: ['room-gfin'] }); toast.success('บันทึกกลุ่มไลน์และแม่แบบแล้ว'); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const test = useMutation({
    mutationFn: async () => (await api.post('/gfin-precheck-settings/test-message')).data as { ok: boolean; groupName: string | null; requestId: string | null },
    onSuccess: (r) => toast.success(`ส่งข้อความทดสอบเข้ากลุ่ม "${r.groupName ?? 'GFIN'}" แล้ว — เปิดไลน์ดูได้เลย`),
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  if (isLoading) return <div className="p-4 text-muted-foreground leading-snug">กำลังโหลด...</div>;
  if (error || !data) return <div className="p-4 text-destructive leading-snug">เกิดข้อผิดพลาด — โปรดลองรีเฟรช</div>;

  const handleSave = () => {
    const t = template.trim();
    if (t) {
      const v = validatePrecheckTemplate(t);
      if (v.errors.length) {
        toast.error(v.errors.map((e) => (e === 'UNKNOWN_PLACEHOLDER' ? `${PRECHECK_TEMPLATE_ERROR_LABEL[e]}: ${v.unknown.map((u) => `{{${u}}}`).join(', ')}` : PRECHECK_TEMPLATE_ERROR_LABEL[e])).join(' · '));
        return;
      }
    }
    save.mutate({ lineGroupId: groupId, precheckTemplate: t || null });
  };
  const status = data.status;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-base font-semibold leading-snug">กลุ่มไลน์ที่รับชุดเช็ค</h2>
        {status.ready
          ? <p className="m-0 flex items-center gap-1 text-sm leading-snug"><CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden />{status.groupName ?? status.groupId} · พร้อมส่งด้วยบอท</p>
          : <p className="m-0 flex items-center gap-1 text-sm leading-snug text-warning-strong"><AlertTriangle className="size-4 shrink-0" aria-hidden />{LINE_GROUP_REASON_LABEL[status.reason ?? 'NOT_LINKED']}</p>}
        <ol className="m-0 list-decimal space-y-1 pl-5 text-sm leading-snug text-muted-foreground">
          <li>LINE Official Account Manager ของ OA ไฟแนนซ์ (น้องเบส): เปิด "อนุญาตให้เข้าร่วมกลุ่มและแชทหลายคน" และปิดข้อความทักทายเมื่อเข้ากลุ่ม</li>
          <li>เชิญ OA ไฟแนนซ์เข้ากลุ่ม GFIN : BESTCHOICE — บอทจะจดชื่อกลุ่มให้อัตโนมัติภายในไม่กี่วินาที</li>
          <li>เลือกกลุ่มด้านล่าง กด "บันทึก" แล้ว "ส่งข้อความทดสอบ" ให้เจ้าหน้าที่ GFIN เห็นก่อนใช้จริง</li>
        </ol>
        {data.groups.length === 0
          ? <p className="m-0 rounded-lg border border-border bg-muted/40 p-3 text-sm leading-snug">ยังไม่มีกลุ่มที่บอทเคยเข้า — ทำข้อ 1–2 ก่อน แล้วรีเฟรชหน้านี้</p>
          : (
            <RadioGroup value={groupId ?? ''} onValueChange={(v) => setGroupId(v || null)} disabled={!canEdit} aria-label="กลุ่มไลน์ปลายทาง">
              {data.groups.map((g) => {
                const label = g.groupName ?? g.groupId;
                return (
                  <label key={g.groupId} className={`flex items-start gap-2 rounded-lg border border-border p-2 text-sm leading-snug ${g.leftAt ? 'opacity-70' : ''}`}>
                    <RadioGroupItem value={g.groupId} disabled={!canEdit || !!g.leftAt} aria-label={label} className="mt-0.5" />
                    <span className="flex-1">
                      <span className="block font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">เข้ากลุ่ม {formatThaiDateShort(g.joinedAt)}{g.memberCount !== null ? ` · สมาชิก ${g.memberCount} คน` : ''}</span>
                      {g.leftAt && <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning-strong"><AlertTriangle className="size-3" aria-hidden />บอทออกจากกลุ่มแล้ว</span>}
                    </span>
                  </label>
                );
              })}
            </RadioGroup>
          )}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={handleSave} disabled={save.isPending}>บันทึก</Button>
            <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !status.ready} title={!status.ready ? 'บันทึกกลุ่มที่บอทอยู่ก่อน' : undefined}><Send className="mr-1 size-4" aria-hidden />ส่งข้อความทดสอบ</Button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold leading-snug">ข้อความ 12 ข้อ (แม่แบบ)</h2>
        <p className="m-0 text-sm leading-snug text-muted-foreground">ว่าง = ใช้ถ้อยคำมาตรฐานของระบบ · ตัวแปรที่ใช้ได้: {PRECHECK_TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(' ')} · ต้องมี {'{{link}}'} เสมอ</p>
        <label htmlFor="gfin-precheck-template" className="text-sm font-medium leading-snug">แม่แบบข้อความ 12 ข้อ</label>
        <Textarea id="gfin-precheck-template" rows={16} className="font-sans text-sm leading-snug" value={template} placeholder={data.defaultTemplate} disabled={!canEdit} onChange={(e) => setTemplate(e.target.value)} />
        {canEdit && <Button variant="ghost" size="sm" onClick={() => setTemplate(data.defaultTemplate)}>ใช้ค่าเริ่มต้น</Button>}
      </section>
    </div>
  );
}
```

(ตรวจว่า `Button` มี `variant="primary"` เหมือน `GfinSettingsPanel` — ถ้าไม่มีใช้ค่า default · `RadioGroupItem` ของ shadcn รับ `disabled` และ `aria-label` ได้ · ถ้า `formatThaiDateShort` ไม่ได้ export จาก `@/lib/date` ให้ใช้ตัวที่ `GfinTab.tsx` import)

- [ ] **Step 4: `index.tsx`** — เพิ่มแท็บและซ่อนแท็บ OWNER-only จาก role อื่น (FM เพิ่งเข้าถึงหน้านี้ได้ — แท็บราคา/เรทมี PATCH ที่ API เปิดเฉพาะ OWNER จะได้ 403 เปล่า ๆ)

```tsx
import { useAuth } from '@/contexts/AuthContext';
import { GfinPrecheckSettingsPanel } from './GfinPrecheckSettingsPanel';
// …
export default function GfinConfigPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [tab, setTab] = useState(isOwner ? 'max-prices' : 'line-group');
  return (
    <div className="container mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">ตั้งค่า GFIN</h1>
        <p className="text-sm text-muted-foreground leading-snug">
          {isOwner ? 'ตารางราคาสูงสุด, Over Price rules (+ ผ่อนสูงสุด), เรทต่อ (งวด, % คอมมิชชั่น), ค่าตั้งต้น และกลุ่มไลน์/แม่แบบชุดเช็ค' : 'กลุ่มไลน์ที่รับชุดเช็ค GFIN และแม่แบบข้อความ 12 ข้อ'}
        </p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {isOwner && (<><TabsTrigger value="max-prices">ราคาสูงสุด</TabsTrigger><TabsTrigger value="overprice">Over Price</TabsTrigger><TabsTrigger value="rate-factors">ตารางค่างวด</TabsTrigger><TabsTrigger value="settings">ค่าตั้งต้น</TabsTrigger><TabsTrigger value="match-preview">ทดสอบ Match</TabsTrigger></>)}
          <TabsTrigger value="line-group">กลุ่มไลน์ &amp; ข้อความ</TabsTrigger>
        </TabsList>
        <TabsContent value="line-group" className="mt-4"><GfinPrecheckSettingsPanel /></TabsContent>
        {/* แท็บเดิม 5 แท็บ คงไว้ตามเดิม */}
```

- [ ] **Step 5: registry** — `settings-registry.tsx` บรรทัด item `gfin`: `roles: ['OWNER', 'FINANCE_MANAGER']` (หมวด `finance` มี FM อยู่แล้ว) · เพิ่ม `keywords: ['gfin', 'กลุ่มไลน์', 'ชุดเช็ค', 'แม่แบบ', 'บอท']` ให้ค้นจาก CommandPalette เจอ

- [ ] **Step 6: รันให้เขียว** — `npx vitest run src/pages/GfinConfigPage` → PASS (รวมเทสต์เดิม 3 ไฟล์) · `./tools/check-types.sh web` → 0 · `npx eslint src/pages/GfinConfigPage src/config/settings-registry.tsx` → 0 errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/GfinConfigPage apps/web/src/config/settings-registry.tsx
git commit -m "feat(gfin): PR2 T6 — ตั้งค่า › การเงิน › GFIN แท็บ \"กลุ่มไลน์ & ข้อความ\" (เลือกกลุ่ม ส่งข้อความทดสอบ แม่แบบ 12 ข้อ) · ผจก.การเงินเข้าถึงได้"
```

### Task 7: ปิดท้าย — version 26.9.56 · สถานะสเปก · MCP grants · ตรวจทั้งชุด (types/jest/vitest/eslint) · e2e เดิมต้องยังเขียว

**Files:**
- Modify: `apps/web/package.json` (`"version": "26.9.56"`)
- Modify: `docs/superpowers/specs/2026-09-24-gfin-precheck-package-design.md` (หัวข้อ "สถานะ" ท้ายไฟล์ + บรรทัดสถานะบรรทัด 4)
- Modify: `.claude/mcp/sql/policy.mjs` (คอมเมนต์บันทึกการตัดสินใจ) · `.claude/mcp/sql/grants.sql` + `grants-report.md` (regenerate)
- Modify: `.claude/rules/security.md` — **ไม่แตะ** (ไม่มี endpoint สาธารณะใหม่) ยืนยันด้วย grep ว่า controller ใหม่มี guard

**Interfaces:** — (งานตรวจ/เอกสาร)

- [ ] **Step 1: bump version** — `apps/web/package.json` `"version": "26.9.55"` → `"26.9.56"`

- [ ] **Step 2: สถานะสเปก** — บรรทัด 4 เปลี่ยน "PR 2 ยังไม่เริ่ม" → "PR 2 ทำแล้วบน `feat/gfin-precheck-pr2`" · ท้ายหัวข้อ "สถานะ (2026-09-25)" เพิ่ม

```md
- PR 2 (2026-09-25, แผน `docs/superpowers/plans/2026-09-25-gfin-precheck-pr2.md`): บอท OA ไฟแนนซ์ push ข้อความ+ลิงก์เข้ากลุ่ม (`via: BOT` ใน send/resend — push ภายใน `$transaction` เดียวกับ CAS สถานะ LINE ล้ม = rollback + 502) · ตาราง `line_group_memberships` จาก webhook `join`/`leave` (จดก่อน kill switch `LINE_FINANCE_BOT_DISABLED`) · หน้าตั้งค่า ตั้งค่า › การเงิน › GFIN › "กลุ่มไลน์ & ข้อความ" (OWNER/FM) ผูกกลุ่ม + ส่งข้อความทดสอบ + แม่แบบ (`precheckTemplate` ต้องมี `{{link}}` — validator ใน shared) · บอทถูกเตะจากกลุ่มที่ผูก → Todo HIGH + IN_APP ถึง OWNER/FM
- เบี่ยงจากสเปกใน PR 2: §10 ใช้ `LineFinanceClientService` (โมดูล chatbot-finance) แทน `LineApiClientService` ซึ่งไม่ได้ export จาก `LineOaModule` — token เดียวกัน (`line-finance/channelToken`) · §5.1 `resend` รับ `{via}` ด้วย (default COPY) · §6.5 หน้าตั้งค่าเป็นแท็บใน `GfinConfigPage` เดิม ไม่ใช่หน้าใหม่ · เจ้าของ role อื่นที่ไม่ใช่ OWNER เห็นเฉพาะแท็บนี้ (แท็บราคา/เรทมี PATCH เฉพาะ OWNER)
- ยังไม่ทำ (ตามสเปก §15/§16): บอทอ่านคำตอบในกลุ่ม · เติมฟอร์มเว็บ GFIN · งานเจ้าของ: เปิดอนุญาตเข้ากลุ่มใน OA Manager + เชิญ OA เข้ากลุ่ม GFIN : BESTCHOICE + ส่งข้อความทดสอบจริง + บอกเจ้าหน้าที่ GFIN
```

- [ ] **Step 3: MCP** — ใน `.claude/mcp/sql/policy.mjs` ใต้บล็อกคอมเมนต์ของ `external_finance_application_events` เพิ่มคอมเมนต์ (ไม่เพิ่ม allowlist):

```js
  // ── กลุ่มไลน์ของบอท (PR 2 migration 20261011000000_line_group_membership) — ไม่เข้า allowlist โดยตั้งใจ:
  //    กฎชื่อคอลัมน์กัน group_name (/name/i) และ picture_url (/picture/i) ให้เอง · group_id/member_count/joined_at/left_at
  //    และ external_finance_companies.line_group_id / precheck_template ไม่ใช่ข้อมูลส่วนบุคคล ปล่อยตามกฎ
```

แล้ว `cd .claude/mcp && PGURL='postgresql://iamnaii@localhost:5432/bestchoice_gfin_test?schema=public' npm run grants` (ฐานทดสอบที่รัน migration Task 1 แล้ว) → ตรวจ `git diff .claude/mcp/sql/grants.sql` ว่ามี `line_group_memberships` และ**ไม่มี** `group_name`/`picture_url` ใน GRANT ของมัน · commit ทั้ง `grants.sql` + `grants-report.md` (apply บน prod = ขั้นเจ้าของหลัง deploy เหมือน PR 1)

- [ ] **Step 4: ยืนยันไม่มี endpoint สาธารณะใหม่** — `grep -rn "@Controller" apps/api/src/modules/external-finance-application/*.controller.ts` แล้วตรวจว่า `gfin-precheck-settings.controller.ts` มี `@UseGuards(JwtAuthGuard, RolesGuard)` ระดับ class (เทสต์ roles ใน Task 3 ครอบ method แล้ว) — ไม่ต้องแก้ `.claude/rules/security.md`

- [ ] **Step 5: ตรวจทั้งชุด** (ทุกข้อต้องผ่านก่อน commit)

```bash
npm run build --workspace=packages/shared && ./tools/check-types.sh all
cd packages/shared && npx vitest run && cd ../..
cd apps/api && npx jest --runInBand 2>&1 | tail -5            # Test Suites: N passed · Tests: all passed
cd apps/api && DATABASE_URL='postgresql://iamnaii@localhost:5432/bestchoice_gfin_test?schema=public' npx jest src/modules/external-finance-application/__tests__/finance-application-flow.db.spec.ts src/modules/chatbot-finance/services/line-group-membership.db.spec.ts --runInBand
cd apps/api && npx eslint src/modules/external-finance-application src/modules/chatbot-finance/services/line-finance-client.service.ts src/modules/chatbot-finance/services/line-finance-client.service.group.spec.ts src/modules/chatbot-finance/services/line-group-membership.service.ts src/modules/chatbot-finance/services/line-group-membership.service.spec.ts src/modules/chatbot-finance/services/line-group-membership.db.spec.ts src/modules/chatbot-finance/services/chatbot-finance.service.ts src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts src/modules/chatbot-finance/dto/line-webhook.dto.ts   # 0 errors (warnings เดิมไม่นับ)
cd apps/web && npx vitest run && npm run lint                  # lint ของ web ไม่มี --fix ใช้ได้
cd apps/web && npx playwright test e2e/gfin-precheck.spec.ts --project=chromium   # smoke เดิมยังเขียว (แท็บ/ร่าง/ยกเลิก/410)
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json docs/superpowers/specs/2026-09-24-gfin-precheck-package-design.md .claude/mcp/sql
git commit -m "chore(gfin): PR2 T7 — web 26.9.56 · สถานะสเปก PR 2 · MCP grants ครอบ line_group_memberships"
```

จากนั้นใช้ superpowers:finishing-a-development-branch (push + PR → main; merge = CI deploy prod) · หลัง deploy เขียว: เจ้าของ apply `.claude/mcp/sql/grants.sql` บน prod → ทำข้อ 1–2 ของ §16 ใน LINE OA Manager → เชิญ OA เข้ากลุ่ม → กด "ส่งข้อความทดสอบ" ในหน้าตั้งค่า → ค่อยบอกทีมใช้ปุ่ม "ส่งเช็ค GFIN"
