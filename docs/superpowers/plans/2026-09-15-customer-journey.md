# การเดินทางของลูกค้า — เฟส 1 บันทึกอัตโนมัติ (Plan 2 ของ 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เก็บและแสดงการเดินทางของลูกค้าแต่ละคน — ทักเข้ามา → รู้ตัวตน → สนใจจริง → ตรวจเครดิต → ซื้อแล้ว — จากข้อมูลที่ระบบมีอยู่แล้ว บวกบันทึกช่วงเวลาที่วันนี้ถูกเขียนทับจนหาย โดยพนักงานไม่ต้องกรอกอะไรเพิ่ม และแสดงเป็นแท็บ "การเดินทาง" · แถบขั้น · การ์ด "กิจกรรมล่าสุด" บนหน้ารายละเอียดลูกค้าที่ Plan 1 สร้าง

**Architecture:** แบบ C ผสม (ชนะกรรมการ 3 มุม: ความถูกต้องข้อมูล · แรงงานในโค้ดเบสนี้ · ประโยชน์ต่อร้าน) — (1) เหตุการณ์อัตโนมัติอ่านสดจากตารางต้นทางผ่าน `sources/*.source.ts` ต่อกลุ่ม (2) ตาราง `customer_journey_entries` ต่อท้ายอย่างเดียว เก็บช่วงเวลาที่ถูกเขียนทับ มีจุดเขียน ~9 จุด ทุกจุดเขียนหลัง commit และไม่อยู่ในทรานแซกชันเงิน (3) แคช 1:1 `customer_journey_states` คำนวณด้วย `journey-state.sql` ไฟล์เดียวที่ใช้ทั้งรายคน cron และ backfill (4) `customers.merged_into_id` ตั้งในทรานแซกชันของ `absorbPlaceholder` ทำให้ประวัติของผู้สนใจจากแชทรอดเมื่อถูกรวมเข้าลูกค้าจริง

**Tech Stack:** NestJS 10 + Prisma 6 + PostgreSQL (`apps/api`, jest `--runInBand`, spec `*.db.spec.ts` บน Postgres จริง) · zod (whitelist ของ `data`) · `@installment/shared` (`packages/shared`) · React 18 + TS + Vite + Tailwind + shadcn + React Query `useInfiniteQuery` (`apps/web`, vitest)

**Spec:** `docs/superpowers/specs/2026-09-15-customer-journey-design.md` (ผลสังเคราะห์ของ workflow ออกแบบ: data model · ขั้นและกฎเข้าขั้น · รายการเหตุการณ์ 40 ชนิด · API · การรอดการรวม · สิ่งที่ระบบยังไม่บันทึก · เฟส) · ต่อยอด `docs/superpowers/plans/2026-09-15-customer-detail-redesign.md` (Plan 1)

## Global Constraints

- **ทุกข้อใน Global Constraints ของ Plan 1 ใช้กับแผนนี้ด้วย** (worktree/branch เดียวกัน · คำสั่งเทสเว็บและ API · ฐาน `bc_journey_test` · 🚨 ห้าม `npm run lint` ใน apps/api · design tokens เท่านั้น · `leading-snug` · vitest hook ห้าม return ค่า · ห้าม hardcode วันที่ · commit ภาษาไทยทีละ task ด้วย `git add <ไฟล์>` ห้าม `git add -A` · trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` · ห้าม push · ห้ามฆ่า process ด้วย pattern)
- **ชื่อที่ใช้ร่วมกันข้าม task ห้ามเปลี่ยน:** model `CustomerJourneyEntry` (`customer_journey_entries`) · `CustomerJourneyState` (`customer_journey_states`) · `Customer.mergedIntoId` (`merged_into_id`, relation `CustomerMergedInto`) · migration `apps/api/prisma/migrations/20261002100000_customer_journey/` · shared `packages/shared/src/customer-journey.ts` (`JOURNEY_STAGES`, `JourneyStage`, `JOURNEY_ENTRY_KINDS`, `JourneyEntryKind`, `JOURNEY_EVENT_GROUPS`, `JourneyEventGroup`, `JourneyEvent`, `JourneySummary`, `STAGE_LABELS`, `JOURNEY_DEFAULT_GROUPS`, `JOURNEY_HIDDEN_GROUPS`, `JOURNEY_LOST_REASON_LABELS`, `JOURNEY_HEARD_FROM_LABELS`) · โมดูล `apps/api/src/modules/customer-journey/` (`JourneyEntryWriter.recordAfterCommit/recordInTx`, `JourneyEntryInput`, `JOURNEY_DATA_SCHEMAS`, `JourneyStateService.recompute(customerIds)`, `CustomerJourneyService.list/summary`, `sources/*.source.ts`, `customer-journey.controller.ts`) · `apps/api/src/modules/overdue/contract-event-sources.ts` (`contractEventSources`) · เว็บ `components/timeline/EventTimeline.tsx` · `TimelineFilterChips` prop `chips` · `CustomerDetailPage/tabs/JourneyTab.tsx` · `components/JourneyStageStrip.tsx` · `hooks/useCustomerJourney.ts` (queryKey `['customer-journey', id, groups]`, `['customer-journey-summary', id]`)
- **PDPA:** ห้ามคัดลอกข้อความแชท, `messageContent`, `callLog.notes`, `reviewNotes`, เบอร์, เลขบัตร, ที่อยู่ ลง `customer_journey_entries.data` หรือ `JourneyEvent` · `data` ผ่าน `JOURNEY_DATA_SCHEMAS[kind]` ทุกครั้ง · API มี snapshot spec ยืนยันว่าไม่มีคีย์ต้องห้าม · DSAR ลบประวัติการเดินทางของคนนั้น · MCP อ่านได้แต่ไม่ได้คอลัมน์ `note`
- **ตัวเขียนบันทึก:** `recordAfterCommit` ห้ามโยน error (catch → `Logger.warn` + Sentry) และห้ามถูกเรียกในทรานแซกชันของเงิน · ข้อยกเว้นเดียว: `PLACEHOLDER_MERGED` เขียนด้วย `recordInTx` ในทรานแซกชันของ `absorbPlaceholder` · `dedupeKey` ผูกกับเอกสาร/เหตุการณ์ต้นทาง ไม่ผูกกับลูกค้า (ย้ายเจ้าของตอนรวมได้โดยไม่ชน unique)
- **ขั้น "ซื้อแล้ว"** ใช้ predicate เดียวกับ `BOUGHT_WHERE` ของ `customer-query.service.ts` เสมอ (export ออกมาใช้ ห้ามลอกซ้ำ) และตรวจสดทุกครั้งที่อ่าน summary
- **สมมติฐานแทนเจ้าของ (ยังไม่ได้ตัดสิน):** (a) ขั้นที่ 2 = "รู้ตัวตน" (มีเบอร์/เลขบัตร · ผูก LINE · เป็นปลายทางของการรวม) ไม่ใช่ "คุยแล้ว" (b) SALES ไม่เห็นกลุ่ม payment และ collections ในแท็บการเดินทาง (c) ไม่ไล่รวมผู้ซื้อเก่ากับประวัติแชทด้วยมือ — ตัวเลขช่องทางแชทนับตั้งแต่วันเปิดใช้
- **migration** รันได้เฉพาะ `bc_journey_test` ด้วย `npx prisma migrate deploy` (env `DATABASE_URL` ตาม Plan 1) · 🚨 ห้ามรันคำสั่งใดกับ prod (migrate / backfill / MCP เขียน) — เฟส 0 และการ deploy เป็นงานของเจ้าของ แผนนี้เขียนแค่ runbook ใน task ปิดท้าย
- **zod** เพิ่มเป็น dependency ตรงของ `apps/api` เวอร์ชันเดียวกับที่ hoist อยู่แล้ว (ตรวจด้วย `npm ls zod`) และ commit `apps/api/package.json` + `package-lock.json` เฉพาะส่วนที่เปลี่ยน
- **นอกขอบเขตแผนนี้ (เฟส 2-4):** บันทึกมือ (`POST/DELETE /customers/:id/journey/entries`, sheet บันทึกการติดต่อ, ชิป "รู้จักร้านจากไหน"), funnel `GET /customers/journey/funnel`, ตัวกรองขั้นในหน้ารายชื่อ, `messaging_referrals` / `markConversion`, เปลี่ยนเวลา PAYMENT เป็น `paidDate` — kind MANUAL ประกาศใน shared types ได้แต่ไม่มีทางเขียนในแผนนี้
- ห้ามแก้ `apps/web/package.json` version ยกเว้น task ปิดท้าย (bump **26.9.28** หรือเลขถัดจาก `origin/main` ณ ตอนนั้น)

---

## ลำดับ task (13)

| # | งาน | ต่อยอดจาก |
|---|---|---|
| 1 | ฐานข้อมูล: `merged_into_id` + ตาราง entries/states + ชนิดร่วมใน shared | — |
| 2 | โมดูล customer-journey + `JourneyEntryWriter` + `JOURNEY_DATA_SCHEMAS` | 1 |
| 3 | `journey-state.sql` + `JourneyStateService.recompute` | 1, 2 |
| 4 | รวมผู้สนใจแล้วการเดินทางไม่หาย (`absorbPlaceholder`) | 1–3 |
| 5 | จุดบันทึกระบบ A: เปิดสัญญา · ตรวจสัญญาทุกรอบ · ผู้เปิดตรวจเครดิต · AI ประเมินเครดิต | 2 |
| 6 | จุดบันทึกระบบ B: บอทส่งต่อ · ได้เบอร์ · ผูก LINE · กดมาจากสินค้า | 2 |
| 7 | แยก `contract-event-sources.ts` ออกจากไทม์ไลน์ติดตามหนี้ (golden test ก่อน) | — |
| 8 | `CustomerJourneyService.list` + sources + `GET /customers/:id/journey` | 1–3, 7 |
| 9 | summary + `GET /customers/:id/journey/summary` + cron recompute/entry-guard | 3, 8 |
| 10 | CLI `backfill:customer-journey` | 3 |
| 11 | เว็บ `EventTimeline` กลาง + ชิปกรองรับชุดชิป | — |
| 12 | เว็บ แท็บการเดินทาง · แถบขั้น · การ์ดกิจกรรมล่าสุด | 8, 9, 11 + Plan 1 |
| 13 | ปิดงาน: สิทธิ์ MCP · DSAR · ตรวจรวม · bump 26.9.28 · runbook เจ้าของ | ทั้งหมด |

---

### Task 1: ฐานข้อมูลการเดินทางของลูกค้า — `merged_into_id` + ตาราง `customer_journey_entries` / `customer_journey_states` + ชนิดร่วมใน shared

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (เลขบรรทัดก่อนแก้ — แก้จากล่างขึ้นบนเพื่อไม่ให้เลขเลื่อน)
  - model ใหม่ 2 ตัว ต่อท้าย `model CustomerTag` ซึ่งปิดที่บรรทัด 6830
  - `model Customer`: relation ใหม่หลังบรรทัด 1040 (`contact   Contact? @relation(...)`) และ `@@index([mergedIntoId])` หลังบรรทัด 1048 (`@@index([contactId])`)
  - `model User`: back-relation หลังบรรทัด 842 (`equityDocsApproved EquityDocument[] @relation("EquityDocApprover")`) ก่อน `@@index([branchId])` บรรทัด 844
- Create: `apps/api/prisma/migrations/20261002100000_customer_journey/migration.sql` (เรียงหลัง `20261001100000_chat_prospects_phone_nullable`)
- Create: `apps/api/src/modules/customer-journey/customer-journey-schema.db.spec.ts` (โฟลเดอร์ใหม่ของโมดูล)
- Modify: `apps/api/src/cli/factory-reset-tables.ts:284-285` (`WIPE_TABLES` ระหว่าง `'customer_access_tokens'` กับ `'customer_scores'`) — ไม่งั้น factory reset หยุดที่ "ด่าน 1: ทุกตารางใน DB ต้องถูกจำแนกแล้ว" (`factory-reset.cli.ts:130-140`)
- Create: `packages/shared/src/customer-journey.ts`
- Create: `packages/shared/src/customer-journey.spec.ts`
- Modify: `packages/shared/src/index.ts:21` (ต่อจาก `export * from './customer-sort';`)

**Interfaces:**
- Consumes:
  - audit ที่ `CustomerMergeService.absorbPlaceholder` เขียน (`apps/api/src/modules/chat-prospects/customer-merge.service.ts:216-223`) = `{ action: 'CUSTOMER_PLACEHOLDER_MERGED', entity: 'customer', entityId: targetId, oldValue: { placeholderId }, newValue: { roomIds, movedCreditChecks, sourceCopied } }`
  - `audit_logs.old_value` เป็น `jsonb` · trigger `audit_logs_no_delete` กัน DELETE
  - audit ถูกข้ามทั้งใบเมื่อหา system user ไม่เจอ (R12)
  - `KEEP_TABLES` / `WIPE_TABLES` จาก `apps/api/src/cli/factory-reset-tables.ts`
- Produces:
  - **Prisma — `Customer`:**
    - `mergedIntoId: string | null` (`merged_into_id`, FK self ON DELETE SET NULL, index)
    - `mergedInto: Customer | null` / `absorbed: Customer[]` (relation `"CustomerMergedInto"`)
    - `journeyEntries: CustomerJourneyEntry[]` · `journeyState: CustomerJourneyState | null`
  - **Prisma — `User`:** `journeyEntriesActed: CustomerJourneyEntry[]` (relation `"JourneyEntryActor"`)
  - **Prisma — `prisma.customerJourneyEntry`** (`@@map("customer_journey_entries")`)
    - unique `dedupe_key` · FK `customer_id` → customers **RESTRICT** · FK `actor_user_id` → users SET NULL
    - index `(customer_id, occurred_at DESC, id)` และ `(kind, occurred_at)`
  - **Prisma — `prisma.customerJourneyState`** (`@@map("customer_journey_states")`)
    - PK `customer_id` · FK → customers **CASCADE**
    - index `(stage, stage_entered_at)`, `(first_source, contacted_at)`, `(first_channel, contacted_at)`
  - **migration.sql:** มีช่วง `-- journey-backfill:start` … `-- journey-backfill:end` = 2 คำสั่ง (เติมจาก audit · ยุบ chain) รันซ้ำได้ 0 แถว
  - **`@installment/shared` — ค่าคงที่และฟังก์ชัน:**
    - `JOURNEY_STAGES` (readonly `['CONTACTED','IDENTIFIED','INTERESTED','CREDIT','PURCHASED']`)
    - `STAGE_LABELS: Record<JourneyStage, string>`
    - `JOURNEY_ENTRY_KINDS` (`{ SYSTEM: readonly [...9], MANUAL: readonly [...4] }`)
    - `journeyEntryOriginOf(kind: JourneyEntryKind): JourneyEntryOrigin`
    - `JOURNEY_EVENT_GROUPS` (readonly `['chat','credit','sale','payment','collections','service','points','system']`)
    - `JOURNEY_ACTOR_TYPES` (readonly `['STAFF','CUSTOMER','BOT','SYSTEM']`)
    - `JOURNEY_DEFAULT_GROUPS: readonly JourneyEventGroup[]` (`['chat','credit','sale','collections','service']` — ไม่ส่ง `groups` = กลุ่มเหล่านี้ · API Task 8/9 ตัดสินด้วยตัวนี้ · เว็บ Task 12 ใช้บอกกลุ่มที่ชิป "ทั้งหมด" ไม่รวม)
    - `JOURNEY_HIDDEN_GROUPS: Readonly<Record<string, readonly JourneyEventGroup[]>>` (`{ ACCOUNTANT: ['chat'], SALES: ['payment','collections'] }` — API ตัดข้อมูลจริง · เว็บซ่อนชิปตามชุดเดียวกัน)
    - `JOURNEY_LOST_REASON_LABELS: Readonly<Record<string, string>>` (รหัส `lost_reason` 5 ตัวตามคอมเมนต์ schema → ป้ายไทย · รหัสที่ไม่รู้จัก ผู้แสดงใช้คำกลางเอง)
    - `JOURNEY_HEARD_FROM_LABELS: Readonly<Record<string, string>>` (รหัส `heard_from` 9 ตัวตามคอมเมนต์ schema → ป้ายไทย)
    - ผู้ใช้: Task 8 (`resolveJourneyGroups` · `entries.source.ts`) · Task 9 (`customer-journey.service.ts` · `journey-summary.builder.ts`) · Task 12 (`journeyGroups.ts` · `JourneyStageStrip`) — ห้ามลอกไปประกาศซ้ำ
  - **`@installment/shared` — type:**
    - `JourneyStage` · `JourneyEntryOrigin` (`'SYSTEM'|'MANUAL'`) · `JourneySystemEntryKind` · `JourneyManualEntryKind` · `JourneyEntryKind`
    - `JourneyEventGroup` · `JourneyActorType` · `JourneyReliability` · `JourneyEventOrigin`
    - `interface JourneyEventActor` · `interface JourneyEvent`
    - `JourneyPath` · `JourneyStepState` · `interface JourneyStep` · `interface JourneySummary` · `interface JourneyListResponse`
    - `interface JourneyRedirect { redirectToCustomerId: string }` — คำตอบของ `GET /customers/:id/journey` และ `/summary` เมื่อ id เป็นผู้สนใจที่ถูกรวมแล้ว (Task 8 · Task 9 · เว็บ Task 12 ใช้ตัวนี้ตัวเดียว ห้ามประกาศซ้ำ)

- [ ] **Step 1: เทสแดง — ชนิดร่วมใน shared**

สร้าง `packages/shared/src/customer-journey.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as shared from './index';
import {
  JOURNEY_ACTOR_TYPES,
  JOURNEY_DEFAULT_GROUPS,
  JOURNEY_ENTRY_KINDS,
  JOURNEY_EVENT_GROUPS,
  JOURNEY_HEARD_FROM_LABELS,
  JOURNEY_HIDDEN_GROUPS,
  JOURNEY_LOST_REASON_LABELS,
  JOURNEY_STAGES,
  STAGE_LABELS,
  journeyEntryOriginOf,
  type JourneyEntryKind,
  type JourneyListResponse,
  type JourneyRedirect,
} from './customer-journey';

describe('customer-journey — สัญญาร่วม API/เว็บ', () => {
  it('ขั้นเรียงตามลำดับจริง และทุกขั้นมีป้ายไทย (ขั้น 2 = รู้ตัวตน)', () => {
    expect(JOURNEY_STAGES).toEqual(['CONTACTED', 'IDENTIFIED', 'INTERESTED', 'CREDIT', 'PURCHASED']);
    expect(Object.keys(STAGE_LABELS)).toEqual([...JOURNEY_STAGES]);
    expect(STAGE_LABELS.IDENTIFIED).toBe('รู้ตัวตน');
    for (const stage of JOURNEY_STAGES) {
      expect(STAGE_LABELS[stage].trim().length).toBeGreaterThan(0);
      expect(stage.length).toBeLessThanOrEqual(12); // customer_journey_states.stage VARCHAR(12)
    }
  });

  it('ชนิดแถว SYSTEM 9 · MANUAL 4 ไม่ซ้ำกัน และยาวไม่เกิน kind VARCHAR(40)', () => {
    expect(JOURNEY_ENTRY_KINDS.SYSTEM).toEqual([
      'CONTRACT_ACTIVATED',
      'CONTRACT_REVIEWED',
      'CREDIT_CHECK_OPENED_BY',
      'CREDIT_AI_SCORED',
      'BOT_HANDOFF',
      'CONTACT_ADDED',
      'LINE_LINKED',
      'PRODUCT_LINK_CLICK',
      'PLACEHOLDER_MERGED',
    ]);
    expect(JOURNEY_ENTRY_KINDS.MANUAL).toEqual(['TOUCHPOINT', 'HEARD_FROM', 'MARKED_LOST', 'REOPENED']);
    const all: string[] = [...JOURNEY_ENTRY_KINDS.SYSTEM, ...JOURNEY_ENTRY_KINDS.MANUAL];
    expect(new Set(all).size).toBe(all.length);
    for (const kind of all) expect(kind.length).toBeLessThanOrEqual(40);
  });

  it('journeyEntryOriginOf แยก SYSTEM/MANUAL ตามรายการ', () => {
    const cases: [JourneyEntryKind, 'SYSTEM' | 'MANUAL'][] = [
      ['CONTRACT_ACTIVATED', 'SYSTEM'],
      ['PLACEHOLDER_MERGED', 'SYSTEM'],
      ['TOUCHPOINT', 'MANUAL'],
      ['REOPENED', 'MANUAL'],
    ];
    for (const [kind, origin] of cases) expect(journeyEntryOriginOf(kind)).toBe(origin);
  });

  it('กลุ่มเหตุการณ์ 8 กลุ่มตามลำดับชิปกรอง · actor type ยาวไม่เกิน VARCHAR(10)', () => {
    expect(JOURNEY_EVENT_GROUPS).toEqual(['chat', 'credit', 'sale', 'payment', 'collections', 'service', 'points', 'system']);
    expect(JOURNEY_ACTOR_TYPES).toEqual(['STAFF', 'CUSTOMER', 'BOT', 'SYSTEM']);
    for (const actor of JOURNEY_ACTOR_TYPES) expect(actor.length).toBeLessThanOrEqual(10);
  });

  it('กลุ่มค่าตั้งต้น + กลุ่มที่บทบาทไม่เห็น — ชุดเดียวที่ API (Task 8/9) และเว็บ (Task 12) ใช้ร่วมกัน', () => {
    expect(JOURNEY_DEFAULT_GROUPS).toEqual(['chat', 'credit', 'sale', 'collections', 'service']);
    expect(JOURNEY_HIDDEN_GROUPS).toEqual({ ACCOUNTANT: ['chat'], SALES: ['payment', 'collections'] });
    const known: readonly string[] = JOURNEY_EVENT_GROUPS;
    for (const group of [...JOURNEY_DEFAULT_GROUPS, ...Object.values(JOURNEY_HIDDEN_GROUPS).flat()]) expect(known).toContain(group);
  });

  it('ป้ายเหตุผลหลุดและที่มาที่ลูกค้าบอก ครบตามรหัสในคอมเมนต์ schema · รหัสยาวไม่เกินคอลัมน์', () => {
    expect(Object.keys(JOURNEY_LOST_REASON_LABELS)).toEqual(['NOT_INTERESTED', 'BOUGHT_ELSEWHERE', 'CREDIT_FAILED', 'UNREACHABLE', 'OTHER']);
    expect(Object.keys(JOURNEY_HEARD_FROM_LABELS)).toEqual(['FB_AD', 'FB_PAGE', 'TIKTOK', 'LINE', 'GOOGLE', 'FRIEND', 'WALK_BY', 'OLD_CUSTOMER', 'OTHER']);
    for (const code of Object.keys(JOURNEY_LOST_REASON_LABELS)) expect(code.length).toBeLessThanOrEqual(20); // lost_reason VARCHAR(20)
    for (const code of Object.keys(JOURNEY_HEARD_FROM_LABELS)) expect(code.length).toBeLessThanOrEqual(16); // heard_from VARCHAR(16)
    for (const label of [...Object.values(JOURNEY_LOST_REASON_LABELS), ...Object.values(JOURNEY_HEARD_FROM_LABELS)]) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
    expect(JOURNEY_LOST_REASON_LABELS.BOUGHT_ELSEWHERE).toBe('ซื้อที่อื่น');
    expect(JOURNEY_HEARD_FROM_LABELS.FRIEND).toBe('เพื่อนแนะนำ');
  });

  it('รูปคำตอบของ GET /customers/:id/journey: หน้าไทม์ไลน์ หรือ redirect ของผู้สนใจที่ถูกรวมแล้ว', () => {
    const page: JourneyListResponse = { customerId: 'c1', mergedCustomerIds: ['p1'], events: [], nextCursor: null, notRecorded: [] };
    const redirect: JourneyRedirect = { redirectToCustomerId: 'c1' };
    const answers: Array<JourneyListResponse | JourneyRedirect> = [page, redirect];
    expect(answers.map((answer) => ('redirectToCustomerId' in answer ? 'redirect' : 'page'))).toEqual(['page', 'redirect']);
  });

  it('ส่งออกผ่าน index ของแพ็กเกจ (@installment/shared)', () => {
    expect(shared.JOURNEY_STAGES).toBe(JOURNEY_STAGES);
    expect(shared.STAGE_LABELS).toBe(STAGE_LABELS);
    expect(shared.JOURNEY_ENTRY_KINDS).toBe(JOURNEY_ENTRY_KINDS);
    expect(shared.JOURNEY_EVENT_GROUPS).toBe(JOURNEY_EVENT_GROUPS);
    expect(shared.journeyEntryOriginOf).toBe(journeyEntryOriginOf);
    expect(shared.JOURNEY_DEFAULT_GROUPS).toBe(JOURNEY_DEFAULT_GROUPS);
    expect(shared.JOURNEY_HIDDEN_GROUPS).toBe(JOURNEY_HIDDEN_GROUPS);
    expect(shared.JOURNEY_LOST_REASON_LABELS).toBe(JOURNEY_LOST_REASON_LABELS);
    expect(shared.JOURNEY_HEARD_FROM_LABELS).toBe(JOURNEY_HEARD_FROM_LABELS);
  });
});
```
Run (จาก `packages/shared`): `npx vitest run src/customer-journey.spec.ts` → Expected: FAIL `Error: Cannot find module './customer-journey' imported from …/src/customer-journey.spec.ts`

- [ ] **Step 2: ชนิดร่วม + ส่งออกผ่าน index**

สร้าง `packages/shared/src/customer-journey.ts`:
```ts
/**
 * การเดินทางของลูกค้า (docs/superpowers/plans/2026-09-15-customer-journey.md)
 * สัญญาร่วมระหว่าง API (โมดูล customer-journey) กับเว็บ (แท็บการเดินทาง · แถบขั้น · การ์ดกิจกรรมล่าสุด)
 * เพื่อไม่ให้สองฝั่งหลุดจากกัน — ค่าในไฟล์นี้ตรงกับคอลัมน์ VARCHAR ของ customer_journey_entries / customer_journey_states
 *
 * 🔴 PDPA: JourneyEvent และแถว entries ห้ามพกข้อความแชท · callLog.notes · เบอร์ · เลขบัตร · ที่อยู่
 */

/** 5 ขั้นของเส้นทาง เรียงตามลำดับจริง — ขั้น 2 = รู้ตัวตน (ได้เบอร์/เลขบัตร/ผูก LINE แล้ว) ไม่ใช่ "คุยแล้ว" */
export const JOURNEY_STAGES = ['CONTACTED', 'IDENTIFIED', 'INTERESTED', 'CREDIT', 'PURCHASED'] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

/** ป้ายไทยของแต่ละขั้น — แถบขั้นใต้หัวหน้ารายละเอียดลูกค้าใช้ชุดนี้ */
export const STAGE_LABELS: Record<JourneyStage, string> = {
  CONTACTED: 'ทักเข้ามา',
  IDENTIFIED: 'รู้ตัวตน',
  INTERESTED: 'สนใจจริง / นัด-จอง',
  CREDIT: 'ตรวจเครดิต',
  PURCHASED: 'ซื้อแล้ว',
};

/**
 * ชนิดแถวของ customer_journey_entries.kind แยกตาม origin
 * SYSTEM = ช่วงเวลาที่ตารางต้นทางเขียนทับจนหาย (เขียนหลัง commit ด้วย dedupe_key) · MANUAL = บันทึกมือ (เฟส 3)
 */
export const JOURNEY_ENTRY_KINDS = {
  SYSTEM: [
    'CONTRACT_ACTIVATED',
    'CONTRACT_REVIEWED',
    'CREDIT_CHECK_OPENED_BY',
    'CREDIT_AI_SCORED',
    'BOT_HANDOFF',
    'CONTACT_ADDED',
    'LINE_LINKED',
    'PRODUCT_LINK_CLICK',
    'PLACEHOLDER_MERGED',
  ],
  MANUAL: ['TOUCHPOINT', 'HEARD_FROM', 'MARKED_LOST', 'REOPENED'],
} as const;
export type JourneyEntryOrigin = keyof typeof JOURNEY_ENTRY_KINDS;
export type JourneySystemEntryKind = (typeof JOURNEY_ENTRY_KINDS)['SYSTEM'][number];
export type JourneyManualEntryKind = (typeof JOURNEY_ENTRY_KINDS)['MANUAL'][number];
export type JourneyEntryKind = JourneySystemEntryKind | JourneyManualEntryKind;

/** origin ของ kind — ตัวเขียนใช้ตั้งคอลัมน์ origin โดยไม่ต้องให้ผู้เรียกส่งมาเอง */
export function journeyEntryOriginOf(kind: JourneyEntryKind): JourneyEntryOrigin {
  return (JOURNEY_ENTRY_KINDS.MANUAL as readonly string[]).includes(kind) ? 'MANUAL' : 'SYSTEM';
}

/** กลุ่มของเหตุการณ์ในไทม์ไลน์ — ลำดับนี้คือลำดับชิปกรองในแท็บการเดินทาง */
export const JOURNEY_EVENT_GROUPS = ['chat', 'credit', 'sale', 'payment', 'collections', 'service', 'points', 'system'] as const;
export type JourneyEventGroup = (typeof JOURNEY_EVENT_GROUPS)[number];

/**
 * ไม่ส่ง groups (ชิป "ทั้งหมด") = กลุ่มเหล่านี้ — GET /customers/:id/journey ใช้ตัดสิน · เว็บใช้บอกว่าชิป "ทั้งหมด" ไม่รวมกลุ่มไหน
 * ชนิดกว้าง (readonly JourneyEventGroup[]) เพื่อให้ .includes(group) รับ JourneyEventGroup ใดก็ได้
 */
export const JOURNEY_DEFAULT_GROUPS: readonly JourneyEventGroup[] = ['chat', 'credit', 'sale', 'collections', 'service'];

/**
 * กลุ่มที่บทบาทไม่เห็น — API ตัดข้อมูลจริง (Task 8/9) · เว็บซ่อนชิปตามชุดเดียวกัน (Task 12) ห้ามลอกไปประกาศซ้ำ
 * ACCOUNTANT ไม่เห็นแชท · SALES ไม่เห็นยอดชำระ/ติดตามหนี้ (สมมติฐานเจ้าของข้อ b — เคาะเปลี่ยนที่นี่ที่เดียว)
 */
export const JOURNEY_HIDDEN_GROUPS: Readonly<Record<string, readonly JourneyEventGroup[]>> = {
  ACCOUNTANT: ['chat'],
  SALES: ['payment', 'collections'],
};

/** ป้ายเหตุผล "หลุด" — รหัสตาม lost_reason VARCHAR(20) ของ entries/states · รหัสที่ไม่มีในนี้ ผู้แสดงใช้คำกลางเอง (ห้ามแสดงค่าดิบ) */
export const JOURNEY_LOST_REASON_LABELS: Readonly<Record<string, string>> = {
  NOT_INTERESTED: 'ไม่สนใจ',
  BOUGHT_ELSEWHERE: 'ซื้อที่อื่น',
  CREDIT_FAILED: 'เครดิตไม่ผ่าน',
  UNREACHABLE: 'ติดต่อไม่ได้',
  OTHER: 'อื่น ๆ',
};

/** ป้าย "ลูกค้าบอกว่ารู้จักร้านจาก" — รหัสตาม heard_from VARCHAR(16) (บันทึกมือเฟส 3 + first_source `HEARD:<รหัส>`) */
export const JOURNEY_HEARD_FROM_LABELS: Readonly<Record<string, string>> = {
  FB_AD: 'โฆษณา FB',
  FB_PAGE: 'เพจ/โพสต์',
  TIKTOK: 'TikTok',
  LINE: 'LINE',
  GOOGLE: 'Google',
  FRIEND: 'เพื่อนแนะนำ',
  WALK_BY: 'ผ่านหน้าร้าน',
  OLD_CUSTOMER: 'ลูกค้าเก่า',
  OTHER: 'อื่น ๆ',
};

/** ผู้ทำให้เกิดเหตุการณ์ — ตรงกับ customer_journey_entries.actor_type VARCHAR(10) */
export const JOURNEY_ACTOR_TYPES = ['STAFF', 'CUSTOMER', 'BOT', 'SYSTEM'] as const;
export type JourneyActorType = (typeof JOURNEY_ACTOR_TYPES)[number];

/** exact = เวลาจริงจากแถวต้นทาง · approximate = เวลาประมาณ (ย้อนหลังจาก updated_at / นำเข้า) เว็บติดป้าย "ประมาณ" */
export type JourneyReliability = 'exact' | 'approximate';
/** SOURCE = อ่านสดจากตารางโดเมน · SYSTEM_ENTRY = แถว entries origin SYSTEM · MANUAL = บันทึกมือ */
export type JourneyEventOrigin = 'SOURCE' | 'SYSTEM_ENTRY' | 'MANUAL';

export interface JourneyEventActor {
  type: JourneyActorType;
  id?: string;
  name?: string;
}

/** หนึ่งแถวในไทม์ไลน์ — ต่อยอดรูปเดียวกับ TimelineEvent ของ overdue/timeline.service.ts (type เป็น string กว้างกว่า) */
export interface JourneyEvent {
  /** `<source>-<rowId>` เช่น `contract-<uuid>` — ไม่ซ้ำภายในคำตอบเดียว ใช้เป็น tie-break ของ cursor */
  id: string;
  type: string;
  group: JourneyEventGroup;
  stage: JourneyStage | null;
  /** ISO 8601 */
  timestamp: string;
  title: string;
  subtitle?: string;
  actor: JourneyEventActor | null;
  reliability: JourneyReliability;
  origin: JourneyEventOrigin;
  /** ลิงก์ภายในเว็บ เช่น /inbox/:roomId · /contracts/:id · /sales/:id · /bookings/:id */
  href?: string;
  /** เฉพาะคีย์ที่ผ่าน whitelist ของ source นั้น — ห้ามข้อความแชท/โน้ตโทร/เบอร์/เลขบัตร/ที่อยู่ */
  metadata?: Record<string, unknown>;
}

/** เส้นทางการซื้อ — ตรงกับ customer_journey_states.path VARCHAR(18) */
export type JourneyPath = 'UNKNOWN' | 'INSTALLMENT' | 'CASH' | 'EXTERNAL_FINANCE';
export type JourneyStepState = 'done' | 'current' | 'skipped' | 'todo';

export interface JourneyStep {
  stage: JourneyStage;
  label: string;
  /** ISO เวลาเข้าขั้น · null = ยังไม่ถึง/ข้าม */
  at: string | null;
  state: JourneyStepState;
  /** MANUAL = ขั้นนี้มาจากบันทึกมือ (เว็บติดป้าย "พนักงานบันทึก") */
  evidence: 'SYSTEM' | 'MANUAL';
}

/** GET /customers/:id/journey/summary — แถบขั้นใต้หัวหน้า + ตัวเลขที่มา */
export interface JourneySummary {
  stage: JourneyStage;
  stageLabel: string;
  stageEnteredAt: string;
  daysInStage: number;
  path: JourneyPath;
  steps: JourneyStep[];
  firstChannel: string;
  firstSource: string;
  firstSourceLabel: string;
  firstAd: { id: string; name: string } | null;
  heardFrom: string | null;
  contactedAt: string;
  firstStaffReplyAt: string | null;
  firstPurchaseAt: string | null;
  lastCustomerAt: string | null;
  lastTouchAt: string | null;
  /** ยังไม่ซื้อและเงียบเกิน 30 วัน = จำนวนวัน · อื่น ๆ = null (คำนวณตอนอ่าน ไม่เก็บ) */
  silentDays: number | null;
  lost: { at: string; reason: string } | null;
  postSaleBadges: string[];
  creditRejected: boolean;
}

/** GET /customers/:id/journey — หน้าละ limit แถว เรียง timestamp desc, id desc · ผู้สนใจที่ถูกรวมแล้วได้ JourneyRedirect แทน */
export interface JourneyListResponse {
  customerId: string;
  /** id ของผู้สนใจที่ถูกรวมเข้าคนนี้ (merged_into_id = customerId) */
  mergedCustomerIds: string[];
  summary?: JourneySummary;
  events: JourneyEvent[];
  /** base64('isoTs|eventId') · null = หมดแล้ว */
  nextCursor: string | null;
  /** เฉพาะหน้าแรก */
  counts?: Partial<Record<JourneyEventGroup, number>>;
  /** ข้อความ "ระบบยังไม่เก็บ" ท้ายแท็บ */
  notRecorded: string[];
}

/** id ที่ขอเป็นผู้สนใจที่ถูกรวมเข้าลูกค้าคนอื่นแล้ว (customers.merged_into_id) — ทั้ง list และ summary ตอบรูปนี้ เว็บพาไปหน้าลูกค้าจริงแบบ replace */
export interface JourneyRedirect {
  redirectToCustomerId: string;
}
```
`packages/shared/src/index.ts` ต่อจากบรรทัด 21 `export * from './customer-sort';` เพิ่ม
```ts
export * from './customer-journey';
```
Run (จาก `packages/shared`):
- `npx vitest run src/customer-journey.spec.ts` → Expected: PASS `Tests  8 passed (8)`
- `npx tsc -p tsconfig.json --noEmit` → Expected: ไม่มี error
- `npx eslint src/customer-journey.ts src/customer-journey.spec.ts` → Expected: ไม่มี output

Run (จาก `apps/api`): `npm run build --workspace=@installment/shared` → Expected: จบโดยไม่มี error และมีไฟล์ `../../packages/shared/dist/customer-journey.d.ts`
- API อ่าน shared จาก `dist` (`packages/shared/package.json` → `"types": "./dist/index.d.ts"`) task ถัดไปจึง import ได้
- เว็บอ่านจาก `src` ผ่าน alias ใน `vite.config.ts:25`
- `dist/` อยู่ใน `.gitignore` — ห้าม commit

- [ ] **Step 3: เทสแดง — db spec พิสูจน์ว่า migration ใช้งานได้**

สร้าง `apps/api/src/modules/customer-journey/customer-journey-schema.db.spec.ts`:
```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

/**
 * พิสูจน์ migration 20261002100000_customer_journey กับ Postgres จริง (Plan 2 Task 1):
 * ตารางใหม่ใช้งานได้ · dedupe_key กันเขียนซ้ำ (createMany skipDuplicates ได้ 0 แถว / create ตรง = P2002)
 * · entries → customers = RESTRICT · states → customers = CASCADE · merged_into_id + absorbed
 * · SQL เติมย้อนหลังในไฟล์ migration เติมจาก audit จริง ยุบ chain และรันซ้ำแล้วไม่เปลี่ยนอะไร
 * รัน (จาก apps/api): DATABASE_URL=<ฐานทดสอบตาม Global Constraints> npx jest <ไฟล์นี้> --runInBand
 */
const MIGRATION_SQL = join(__dirname, '../../../prisma/migrations/20261002100000_customer_journey/migration.sql');

/** ตัดช่วง journey-backfill ของ migration แล้วแยกทีละคำสั่ง — $executeRawUnsafe รับครั้งละหนึ่งคำสั่ง */
function backfillStatements(): string[] {
  const sql = readFileSync(MIGRATION_SQL, 'utf8');
  const start = sql.indexOf('-- journey-backfill:start');
  const end = sql.indexOf('-- journey-backfill:end');
  if (start < 0 || end < start) throw new Error('migration ไม่มีช่วง journey-backfill:start/end');
  return sql
    .slice(start, end)
    .split(/;\s*\n/)
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((statement) => statement.length > 0);
}

/** โยนออกจาก interactive transaction เพื่อ rollback — audit_logs ลบไม่ได้ (trigger audit_logs_no_delete) */
class RollbackProbe extends Error {}

describe('migration 20261002100000_customer_journey (real DB)', () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const customerIds: string[] = [];

  async function createCustomer(label: string) {
    const customer = await prisma.customer.create({ data: { name: `journey schema ${label} ${stamp}`, phone: null } });
    customerIds.push(customer.id);
    return customer;
  }

  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
  });

  it('entries: dedupe_key ซ้ำ → createMany skipDuplicates ได้ 0 แถว · create ตรง = P2002 · MANUAL (dedupe_key null) ซ้ำได้ · note เกิน 140 = P2000', async () => {
    const customer = await createCustomer('dedupe');
    const system = {
      customerId: customer.id,
      originCustomerId: customer.id,
      origin: 'SYSTEM',
      kind: 'CONTRACT_ACTIVATED',
      occurredAt: new Date('2026-09-15T03:00:00.000Z'),
      actorType: 'STAFF',
      refType: 'contract',
      refId: `contract-${stamp}`,
      data: { contractNumber: 'CT-2569-0001' },
      dedupeKey: `CONTRACT_ACTIVATED:contract-${stamp}`,
    };
    expect((await prisma.customerJourneyEntry.createMany({ data: [system], skipDuplicates: true })).count).toBe(1);
    expect((await prisma.customerJourneyEntry.createMany({ data: [system], skipDuplicates: true })).count).toBe(0);
    await expect(prisma.customerJourneyEntry.create({ data: system })).rejects.toMatchObject({ code: 'P2002' });

    const manual = {
      customerId: customer.id,
      originCustomerId: customer.id,
      origin: 'MANUAL',
      kind: 'TOUCHPOINT',
      occurredAt: new Date('2026-09-15T04:00:00.000Z'),
      actorType: 'STAFF',
      channel: 'PHONE',
      outcome: 'THINKING',
    };
    await prisma.customerJourneyEntry.create({ data: manual });
    await prisma.customerJourneyEntry.create({ data: manual });
    await expect(prisma.customerJourneyEntry.create({ data: { ...manual, note: 'ก'.repeat(141) } })).rejects.toMatchObject({
      code: 'P2000',
    });

    const rows = await prisma.customerJourneyEntry.findMany({
      where: { customerId: customer.id },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { kind: true, origin: true, dedupeKey: true, actorUserId: true, data: true, deletedAt: true },
    });
    expect(rows.map((row) => row.kind)).toEqual(['TOUCHPOINT', 'TOUCHPOINT', 'CONTRACT_ACTIVATED']);
    expect(rows[2]).toEqual({
      kind: 'CONTRACT_ACTIVATED',
      origin: 'SYSTEM',
      dedupeKey: `CONTRACT_ACTIVATED:contract-${stamp}`,
      actorUserId: null,
      data: { contractNumber: 'CT-2569-0001' },
      deletedAt: null,
    });
  });

  it('ลบลูกค้าที่มี entries ไม่ได้ (RESTRICT) · state 1:1 ต่อคนและหายตามลูกค้า (CASCADE)', async () => {
    const withEntry = await createCustomer('restrict');
    await prisma.customerJourneyEntry.create({
      data: {
        customerId: withEntry.id,
        originCustomerId: withEntry.id,
        origin: 'MANUAL',
        kind: 'HEARD_FROM',
        occurredAt: new Date('2026-09-15T05:00:00.000Z'),
        actorType: 'STAFF',
        heardFrom: 'FB_AD',
      },
    });
    await expect(prisma.customer.delete({ where: { id: withEntry.id } })).rejects.toMatchObject({ code: 'P2003' });

    const withState = await createCustomer('cascade');
    const state = {
      customerId: withState.id,
      stage: 'CONTACTED',
      stageEnteredAt: new Date('2026-09-01T02:00:00.000Z'),
      path: 'UNKNOWN',
      contactedAt: new Date('2026-09-01T02:00:00.000Z'),
      firstChannel: 'CHAT_FACEBOOK',
      firstSource: 'CHAT_FACEBOOK',
      computedAt: new Date('2026-09-15T05:00:00.000Z'),
    };
    await prisma.customerJourneyState.create({ data: state });
    await expect(prisma.customerJourneyState.create({ data: state })).rejects.toMatchObject({ code: 'P2002' });
    await prisma.customer.delete({ where: { id: withState.id } });
    expect(await prisma.customerJourneyState.count({ where: { customerId: withState.id } })).toBe(0);
  });

  it('merged_into_id ชี้ลูกค้าปลายทาง และอ่านย้อนได้ผ่าน absorbed', async () => {
    const target = await createCustomer('merge-target');
    const placeholder = await createCustomer('merge-placeholder');
    await prisma.customer.update({
      where: { id: placeholder.id },
      data: { deletedAt: new Date('2026-09-15T06:00:00.000Z'), mergedIntoId: target.id },
    });

    const read = await prisma.customer.findUniqueOrThrow({
      where: { id: target.id },
      select: { mergedIntoId: true, absorbed: { select: { id: true } } },
    });
    expect(read).toEqual({ mergedIntoId: null, absorbed: [{ id: placeholder.id }] });
  });

  it('SQL เติมย้อนหลังใน migration: เติมจาก audit CUSTOMER_PLACEHOLDER_MERGED · ยุบ chain A→B→ลูกค้าจริง · รันซ้ำได้ 0 แถว', async () => {
    const statements = backfillStatements();
    expect(statements).toHaveLength(2);

    const created: Record<'target' | 'placeholderA' | 'placeholderB' | 'unrelated', string> = {
      target: '',
      placeholderA: '',
      placeholderB: '',
      unrelated: '',
    };
    let mergedAfterFirstRun: Record<string, string | null> = {};
    const secondRun: number[] = [];

    const run = prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email: `journey-backfill-${stamp}@spec.local`, password: 'not-a-real-hash', name: 'journey backfill spec' },
        });
        const target = await tx.customer.create({ data: { name: 'journey backfill ลูกค้าจริง', phone: null } });
        const placeholderB = await tx.customer.create({
          data: { name: 'journey backfill B', phone: null, acquisitionSource: 'CHAT_FACEBOOK', deletedAt: new Date('2026-09-10T02:00:00.000Z') },
        });
        const placeholderA = await tx.customer.create({
          data: { name: 'journey backfill A', phone: null, acquisitionSource: 'CHAT_LINE_SHOP', deletedAt: new Date('2026-09-09T02:00:00.000Z') },
        });
        const unrelated = await tx.customer.create({
          data: { name: 'journey backfill ลบด้วยเหตุอื่น', phone: null, deletedAt: new Date('2026-09-09T02:00:00.000Z') },
        });
        Object.assign(created, { target: target.id, placeholderA: placeholderA.id, placeholderB: placeholderB.id, unrelated: unrelated.id });

        // รูปแถวเดียวกับ CustomerMergeService.absorbPlaceholder (customer-merge.service.ts:216-223)
        // A → B ก่อน (รวมห้องแชทระหว่างผู้สนใจสองคน) แล้ว B → ลูกค้าจริง
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'CUSTOMER_PLACEHOLDER_MERGED',
            entity: 'customer',
            entityId: placeholderB.id,
            oldValue: { placeholderId: placeholderA.id },
            newValue: { roomIds: [], movedCreditChecks: 0, sourceCopied: false },
            createdAt: new Date('2026-09-09T02:00:00.000Z'),
          },
        });
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'CUSTOMER_PLACEHOLDER_MERGED',
            entity: 'customer',
            entityId: target.id,
            oldValue: { placeholderId: placeholderB.id },
            newValue: { roomIds: [], movedCreditChecks: 0, sourceCopied: false },
            createdAt: new Date('2026-09-10T02:00:00.000Z'),
          },
        });

        for (const statement of statements) await tx.$executeRawUnsafe(statement);
        const rows = await tx.customer.findMany({
          where: { id: { in: Object.values(created) } },
          select: { id: true, mergedIntoId: true },
        });
        mergedAfterFirstRun = Object.fromEntries(rows.map((row) => [row.id, row.mergedIntoId]));

        for (const statement of statements) secondRun.push(await tx.$executeRawUnsafe(statement));
        throw new RollbackProbe('rollback');
      },
      { timeout: 20_000 },
    );

    await expect(run).rejects.toBeInstanceOf(RollbackProbe);
    expect(mergedAfterFirstRun).toEqual({
      [created.target]: null,
      [created.placeholderB]: created.target,
      [created.placeholderA]: created.target,
      [created.unrelated]: null,
    });
    expect(secondRun).toEqual([0, 0]);
    expect(await prisma.customer.count({ where: { id: { in: Object.values(created) } } })).toBe(0);
  }, 30_000);
});
```
Run (จาก `apps/api`): `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/customer-journey-schema.db.spec.ts --runInBand` → Expected: FAIL `Test suite failed to run` · `TS2339: Property 'customerJourneyEntry' does not exist on type 'PrismaClient<…>'`

- [ ] **Step 4: แก้ `schema.prisma`**

ใช้เลขบรรทัดก่อนแก้ และแก้จากล่างขึ้นบน

(ก) หลังบรรทัด 6830 (`}` ที่ปิด `model CustomerTag` ต่อจาก `@@map("customer_tags")`) เพิ่ม
```prisma

/// การเดินทางของลูกค้า (Plan 2 · 2026-09-15-customer-journey) — แถวต่อท้ายอย่างเดียว
/// SYSTEM = ช่วงเวลาที่ตารางต้นทางเขียนทับจนหาย · MANUAL = บันทึกมือของพนักงาน
/// PDPA: ห้ามเก็บข้อความแชท · callLog.notes · เบอร์ · เลขบัตร · ที่อยู่ ใน data หรือ note
model CustomerJourneyEntry {
  id               String    @id @default(uuid())
  customerId       String    @map("customer_id") // เจ้าของปัจจุบัน — ย้ายตามตอนรวมผู้สนใจ
  customer         Customer  @relation(fields: [customerId], references: [id], onDelete: Restrict)
  originCustomerId String    @map("origin_customer_id") // id ตอนเขียน — ไม่เปลี่ยน
  origin           String    @db.VarChar(8) // SYSTEM | MANUAL
  kind             String    @db.VarChar(40) // JourneyEntryKind (packages/shared/src/customer-journey.ts)
  occurredAt       DateTime  @map("occurred_at")
  actorType        String    @map("actor_type") @db.VarChar(10) // STAFF | CUSTOMER | BOT | SYSTEM
  actorUserId      String?   @map("actor_user_id") // null = ระบบ/ลูกค้า/บอท — ห้ามใส่ 'system' (Ruling R12)
  actorUser        User?     @relation("JourneyEntryActor", fields: [actorUserId], references: [id])
  roomId           String?   @map("room_id") // อ้างห้องเท่านั้น ไม่มีข้อความ
  refType          String?   @map("ref_type") @db.VarChar(24) // contract | sale | credit_check | booking | product | audit_log
  refId            String?   @map("ref_id")
  data             Json? // ผ่าน JOURNEY_DATA_SCHEMAS[kind] (zod whitelist)
  // เฉพาะ MANUAL
  channel          String?   @db.VarChar(16) // PHONE | FB_APP | LINE_APP | WALK_IN | OTHER
  outcome          String?   @db.VarChar(20) // APPOINTED | VISITED | THINKING | BUDGET | NO_ANSWER | BOUGHT_ELSEWHERE | NOT_INTERESTED
  lostReason       String?   @map("lost_reason") @db.VarChar(20) // NOT_INTERESTED | BOUGHT_ELSEWHERE | CREDIT_FAILED | UNREACHABLE | OTHER
  heardFrom        String?   @map("heard_from") @db.VarChar(16) // FB_AD | FB_PAGE | TIKTOK | LINE | GOOGLE | FRIEND | WALK_BY | OLD_CUSTOMER | OTHER
  note             String?   @db.VarChar(140) // DTO ปฏิเสธเลขยาว · ไม่ grant ให้ MCP · ไม่ส่งออก Excel
  dedupeKey        String?   @unique @map("dedupe_key") // SYSTEM: `${kind}:${sourceRowOrAuditId}` · MANUAL: null
  createdAt        DateTime  @default(now()) @map("created_at")
  deletedAt        DateTime? @map("deleted_at") // "เลิกทำ" ของ MANUAL เท่านั้น
  deletedById      String?   @map("deleted_by_id")

  @@index([customerId, occurredAt(sort: Desc), id])
  @@index([kind, occurredAt])
  @@map("customer_journey_entries")
}

/// แคชสรุปการเดินทาง 1:1 ต่อลูกค้า — คำนวณใหม่ได้ทั้งหมดจาก journey-state.sql ห้ามแก้มือ
model CustomerJourneyState {
  customerId        String    @id @map("customer_id")
  customer          Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
  stage             String    @db.VarChar(12) // CONTACTED | IDENTIFIED | INTERESTED | CREDIT | PURCHASED
  stageEnteredAt    DateTime  @map("stage_entered_at")
  path              String    @db.VarChar(18) // UNKNOWN | INSTALLMENT | CASH | EXTERNAL_FINANCE
  contactedAt       DateTime  @map("contacted_at") // แช่แข็ง — รวมผู้สนใจแล้วเลือกค่าเก่ากว่า
  identifiedAt      DateTime? @map("identified_at")
  interestedAt      DateTime? @map("interested_at")
  creditAt          DateTime? @map("credit_at")
  firstPurchaseAt   DateTime? @map("first_purchase_at")
  firstPurchaseKind String?   @map("first_purchase_kind") @db.VarChar(18)
  firstStaffReplyAt DateTime? @map("first_staff_reply_at") // แช่แข็ง · ค่าประมาณ
  firstChannel      String    @map("first_channel") @db.VarChar(20) // CHAT_FACEBOOK… | WALK_IN | REFERRAL | UNKNOWN
  firstSource       String    @map("first_source") @db.VarChar(30) // แช่แข็ง: AD:<campaignId> > CHAT_* > REFERRAL > HEARD:<x> > WALK_IN
  firstAdCampaignId String?   @map("first_ad_campaign_id")
  heardFrom         String?   @map("heard_from") @db.VarChar(16)
  lastCustomerAt    DateTime? @map("last_customer_at")
  lastTouchAt       DateTime? @map("last_touch_at")
  lostAt            DateTime? @map("lost_at")
  lostReason        String?   @map("lost_reason") @db.VarChar(20)
  computedAt        DateTime  @map("computed_at")

  @@index([stage, stageEnteredAt])
  @@index([firstSource, contactedAt])
  @@index([firstChannel, contactedAt])
  @@map("customer_journey_states")
}
```
(ข) `model Customer` หลังบรรทัด 1048 `  @@index([contactId])` เพิ่ม
```prisma
  @@index([mergedIntoId])
```
(ค) `model Customer` หลังบรรทัด 1040 `  contact   Contact? @relation(fields: [contactId], references: [id])` เพิ่ม
```prisma

  // การเดินทางของลูกค้า — ติดตัวตนข้ามการรวมผู้สนใจ: ตั้งใน tx ของ CustomerMergeService.absorbPlaceholder
  // คู่กับ deletedAt · chain ถูกยุบเหลือชั้นเดียวเสมอ (ปลายทางของทุกแถวคือลูกค้าที่ยังไม่ถูกรวม)
  mergedIntoId   String?                @map("merged_into_id")
  mergedInto     Customer?              @relation("CustomerMergedInto", fields: [mergedIntoId], references: [id])
  absorbed       Customer[]             @relation("CustomerMergedInto")
  journeyEntries CustomerJourneyEntry[]
  journeyState   CustomerJourneyState?
```
(ง) `model User` หลังบรรทัด 842 `  equityDocsApproved EquityDocument[] @relation("EquityDocApprover")` เพิ่ม
```prisma

  // การเดินทางของลูกค้า — พนักงานที่ทำให้เกิดช่วงเวลา/บันทึกมือ (null = ระบบ/ลูกค้า/บอท)
  journeyEntriesActed CustomerJourneyEntry[] @relation("JourneyEntryActor")
```

- [ ] **Step 5: เขียน migration**

SQL ส่วนสร้างตาราง/index/FK คือผลของ `prisma migrate diff --from-schema-datamodel <ก่อนแก้> --to-schema-datamodel <หลังแก้> --script` ทุกตัวอักษร จึงไม่เกิด drift

สร้าง `apps/api/prisma/migrations/20261002100000_customer_journey/migration.sql`:
```sql
-- การเดินทางของลูกค้า (docs/superpowers/plans/2026-09-15-customer-journey.md · Task 1)
-- 1) customers.merged_into_id — ติดตัวตนข้ามการรวมผู้สนใจ (ตั้งใน tx ของ CustomerMergeService.absorbPlaceholder)
-- 2) customer_journey_entries — แถวต่อท้ายอย่างเดียว (SYSTEM + MANUAL) · dedupe_key unique กันเขียนซ้ำ
-- 3) customer_journey_states — แคชสรุป 1:1 ต่อลูกค้า คำนวณใหม่ได้ทั้งหมด
-- 4) เติม merged_into_id ย้อนหลังจาก audit CUSTOMER_PLACEHOLDER_MERGED แล้วยุบ chain — รันซ้ำได้

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "merged_into_id" TEXT;

-- CreateTable
CREATE TABLE "customer_journey_entries" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "origin_customer_id" TEXT NOT NULL,
    "origin" VARCHAR(8) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "actor_type" VARCHAR(10) NOT NULL,
    "actor_user_id" TEXT,
    "room_id" TEXT,
    "ref_type" VARCHAR(24),
    "ref_id" TEXT,
    "data" JSONB,
    "channel" VARCHAR(16),
    "outcome" VARCHAR(20),
    "lost_reason" VARCHAR(20),
    "heard_from" VARCHAR(16),
    "note" VARCHAR(140),
    "dedupe_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" TEXT,

    CONSTRAINT "customer_journey_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_journey_states" (
    "customer_id" TEXT NOT NULL,
    "stage" VARCHAR(12) NOT NULL,
    "stage_entered_at" TIMESTAMP(3) NOT NULL,
    "path" VARCHAR(18) NOT NULL,
    "contacted_at" TIMESTAMP(3) NOT NULL,
    "identified_at" TIMESTAMP(3),
    "interested_at" TIMESTAMP(3),
    "credit_at" TIMESTAMP(3),
    "first_purchase_at" TIMESTAMP(3),
    "first_purchase_kind" VARCHAR(18),
    "first_staff_reply_at" TIMESTAMP(3),
    "first_channel" VARCHAR(20) NOT NULL,
    "first_source" VARCHAR(30) NOT NULL,
    "first_ad_campaign_id" TEXT,
    "heard_from" VARCHAR(16),
    "last_customer_at" TIMESTAMP(3),
    "last_touch_at" TIMESTAMP(3),
    "lost_at" TIMESTAMP(3),
    "lost_reason" VARCHAR(20),
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_journey_states_pkey" PRIMARY KEY ("customer_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_journey_entries_dedupe_key_key" ON "customer_journey_entries"("dedupe_key");

-- CreateIndex
CREATE INDEX "customer_journey_entries_customer_id_occurred_at_id_idx" ON "customer_journey_entries"("customer_id", "occurred_at" DESC, "id");

-- CreateIndex
CREATE INDEX "customer_journey_entries_kind_occurred_at_idx" ON "customer_journey_entries"("kind", "occurred_at");

-- CreateIndex
CREATE INDEX "customer_journey_states_stage_stage_entered_at_idx" ON "customer_journey_states"("stage", "stage_entered_at");

-- CreateIndex
CREATE INDEX "customer_journey_states_first_source_contacted_at_idx" ON "customer_journey_states"("first_source", "contacted_at");

-- CreateIndex
CREATE INDEX "customer_journey_states_first_channel_contacted_at_idx" ON "customer_journey_states"("first_channel", "contacted_at");

-- CreateIndex
CREATE INDEX "customers_merged_into_id_idx" ON "customers"("merged_into_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_journey_entries" ADD CONSTRAINT "customer_journey_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_journey_entries" ADD CONSTRAINT "customer_journey_entries_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_journey_states" ADD CONSTRAINT "customer_journey_states_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- journey-backfill:start
-- 4.1 audit ของ CustomerMergeService.absorbPlaceholder — entity 'customer' · entity_id = ลูกค้าปลายทาง
--     old_value = {"placeholderId": "<id>"} · แตะเฉพาะ placeholder ที่ถูก soft-delete แล้วและยังไม่มีค่า
--     ปลายทางต้องยังมีแถวอยู่ (กัน FK ข้างบนล้ม) · ไม่แตะ updated_at เพราะขั้นรู้ตัวตนย้อนหลังใช้ค่านั้น
UPDATE "customers" AS c
SET "merged_into_id" = m.target_id
FROM (
  SELECT DISTINCT ON (a."old_value"->>'placeholderId')
         a."old_value"->>'placeholderId' AS placeholder_id,
         a."entity_id" AS target_id
  FROM "audit_logs" AS a
  JOIN "customers" AS t ON t."id" = a."entity_id"
  WHERE a."action" = 'CUSTOMER_PLACEHOLDER_MERGED'
    AND a."entity" = 'customer'
    AND a."old_value"->>'placeholderId' IS NOT NULL
    AND a."old_value"->>'placeholderId' <> a."entity_id"
  ORDER BY a."old_value"->>'placeholderId', a."created_at" DESC
) AS m
WHERE c."id" = m.placeholder_id
  AND c."deleted_at" IS NOT NULL
  AND c."merged_into_id" IS NULL;

-- 4.2 ยุบ chain เหลือชั้นเดียว — A→B (รวมห้องแชทระหว่างผู้สนใจสองคน) แล้ว B→ลูกค้าจริง ⇒ A→ลูกค้าจริง
--     depth < 32 กันวนไม่รู้จบ (วงปิดเกิดไม่ได้เพราะรวมได้เฉพาะปลายทางที่ยังไม่ถูกลบ แต่กันไว้)
WITH RECURSIVE chain AS (
  SELECT c."id", c."merged_into_id" AS root_id, 1 AS depth
  FROM "customers" AS c
  WHERE c."merged_into_id" IS NOT NULL
  UNION ALL
  SELECT chain."id", p."merged_into_id", chain.depth + 1
  FROM chain
  JOIN "customers" AS p ON p."id" = chain.root_id
  WHERE p."merged_into_id" IS NOT NULL
    AND chain.depth < 32
)
UPDATE "customers" AS c
SET "merged_into_id" = f.root_id
FROM (
  SELECT DISTINCT ON (chain."id") chain."id", chain.root_id
  FROM chain
  ORDER BY chain."id", chain.depth DESC
) AS f
WHERE c."id" = f."id"
  AND c."merged_into_id" IS DISTINCT FROM f.root_id;
-- journey-backfill:end
```
🚨 คอมเมนต์ในช่วง `journey-backfill` ห้ามมีเครื่องหมาย `;` เพราะ db spec แยกคำสั่งด้วย `;` ท้ายบรรทัด

- [ ] **Step 6: validate + generate + apply ลงฐานทดสอบเท่านั้น**

Run ทั้งหมดจาก `apps/api` 🚨 ทุกคำสั่งที่ต่อฐานต้องใส่ `DATABASE_URL` ของฐานทดสอบตรง ๆ ห้ามพึ่งค่าใน `.env` ของ worktree (อาจชี้ prod ผ่าน cloud-sql-proxy)

- `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" npx prisma validate` → Expected: `The schema at prisma/schema.prisma is valid 🚀`
- `npx prisma generate` → Expected: `✔ Generated Prisma Client (v6.19.3)`
- `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" npx prisma migrate deploy` → Expected:
  - `325 migrations found in prisma/migrations`
  - ``Applying migration `20261002100000_customer_journey` ``
  - `All migrations have been successfully applied.`
  - ถ้า migration ล้มครึ่งทาง (P3018): ตรวจ error แล้วแก้ SQL · ลบแถว `20261002100000_customer_journey` ออกจาก `_prisma_migrations` ของ **bc_journey_test เท่านั้น** แล้วรันใหม่

- [ ] **Step 7: รัน db spec อีกครั้ง**

Run (จาก `apps/api`): `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/customer-journey-schema.db.spec.ts --runInBand` → Expected: PASS `Tests: 4 passed, 4 total`

ถ้าเทสที่ 4 ล้มที่ `expect(statements).toHaveLength(2)` แปลว่าคอมเมนต์ในช่วง backfill มี `;`

- [ ] **Step 8: จำแนกตารางใหม่ให้ factory reset**

`apps/api/src/cli/factory-reset-tables.ts` ใน `WIPE_TABLES` แทนบรรทัด 284-285
```ts
  'customer_access_tokens',
  'customer_scores',
```
ด้วย
```ts
  'customer_access_tokens',
  'customer_journey_entries',  // log การเดินทาง (Plan 2) — อ้างสัญญา/ใบขายที่ถูกล้างไปพร้อมกัน
  'customer_journey_states',   // แคชสรุป คำนวณใหม่ได้จาก journey-state.sql
  'customer_scores',
```
(กติกาไฟล์: "ล้าง = log · ของที่คำนวณจากรายการ" แบบเดียวกับ `crm_notes` / `customer_scores` — `customers` อยู่ใน KEEP และ FK ชี้จากลูกไปแม่ จึงล้างได้โดยไม่ต้องแตะ `FK_DROP_RECREATE`)

- [ ] **Step 9: typecheck + lint**

Run (จาก `apps/api`):
- `npx tsc --noEmit -p tsconfig.json` → Expected: 0 error (relation ใหม่เป็น optional ทั้งหมด โค้ดเดิมไม่ต้องแก้)
- `npx eslint src/modules/customer-journey/customer-journey-schema.db.spec.ts src/cli/factory-reset-tables.ts` → Expected: ไม่มี error

- [ ] **Step 10: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261002100000_customer_journey/migration.sql apps/api/src/modules/customer-journey/customer-journey-schema.db.spec.ts apps/api/src/cli/factory-reset-tables.ts packages/shared/src/customer-journey.ts packages/shared/src/customer-journey.spec.ts packages/shared/src/index.ts
git commit -m "feat(customer-journey): merged_into_id + ตาราง customer_journey_entries/states + ชนิดร่วมใน shared

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

**หมายเหตุถึง task ถัดไป / deploy:**
- `actor_user_id` มี FK จริงไป `users`
  - `customer-merge.service.db.spec.ts:57`, `:87`, `:102` เรียก `absorbPlaceholder(..., { id: 'staff-1', role: 'SALES' })` ด้วย id ปลอม
  - Task 4 เขียน `PLACEHOLDER_MERGED` ด้วย `recordInTx` ใน tx ของการรวม: ถ้าส่ง `actorUserId: 'staff-1'` จะชน FK (P2003) แล้วการรวมทั้งก้อน rollback
  - ต้องสร้าง user จริงในเทสนั้น หรือส่ง `actorUserId: null` เมื่อหา user ไม่เจอ
- `customers.merged_into_id` เป็นคอลัมน์ใหม่ใน `customers` ที่ `findUnique` แบบไม่ระบุ `select` จะคืนมาด้วย (ไม่ใช่ PII)
- รูป `dedupe_key` ในสเปคนี้ (`CONTRACT_ACTIVATED:contract-…`) คือรูปเดียวกับ `journeyDedupeKey(kind, ...parts)` ที่ Task 2 สร้าง — ทุก hook ใน Task 4-6 ต้องใช้ตัวช่วยนั้น
- ก่อน deploy prod ให้นับผ่าน MCP: `SELECT count(*) FROM customers WHERE acquisition_source LIKE 'CHAT_%' AND deleted_at IS NOT NULL AND merged_into_id IS NULL`
  - นับหลัง migrate — เป็นการรวมที่ audit ถูกข้าม (R12)
  - วันที่ 15 ก.ย. audit merge บน prod = 0 จึงคาดว่า 0
  - ใส่ตัวเลขนี้ใน PR body

---

### Task 2: โมดูล `customer-journey` + ตัวเขียนบันทึก `JourneyEntryWriter` + whitelist `data` ต่อ kind (กัน PII)

**Files:**
- Modify: `apps/api/package.json` (บล็อก `"dependencies"` บรรทัด 102 — เพิ่ม `"zod": "^3.25.76"` · วันนี้ zod 3.25.76 อยู่ใน root `node_modules` เพราะ `@anthropic-ai/sdk` ลากมา ไม่ได้ประกาศเอง)
- Modify: `package-lock.json` (npm เขียนให้ — เพิ่ม zod ใต้ `packages["apps/api"].dependencies` เท่านั้น)
- Create: `apps/api/src/modules/customer-journey/journey-data-schemas.ts`
- Create: `apps/api/src/modules/customer-journey/journey-data-schemas.spec.ts`
- Create: `apps/api/src/modules/customer-journey/journey-entry-writer.service.ts`
- Create: `apps/api/src/modules/customer-journey/journey-entry-writer.service.db.spec.ts`
- Create: `apps/api/src/modules/customer-journey/customer-journey.module.ts`
- Modify: `apps/api/src/app.module.ts:145` (import ถัดจาก `ImportedSalesModule`) และ `apps/api/src/app.module.ts:400-401` (ต่อท้าย array `imports` ถัดจาก `ImportedSalesModule,`)

**Interfaces:**
- Consumes (จาก Task 1 — ต้องลงแล้ว):
  - Prisma model `CustomerJourneyEntry` → delegate `prisma.customerJourneyEntry` / `tx.customerJourneyEntry` · type `Prisma.CustomerJourneyEntryCreateManyInput` · `dedupeKey String? @unique` · FK `customer_id` → `customers` (onDelete Restrict) · migration `20261002100000_customer_journey` apply บน `bc_journey_test` แล้ว
  - `@installment/shared` (build `dist` แล้ว — Task 1): `JourneySystemEntryKind` · `JOURNEY_ENTRY_KINDS: { readonly SYSTEM: readonly ['CONTRACT_ACTIVATED','CONTRACT_REVIEWED','CREDIT_CHECK_OPENED_BY','CREDIT_AI_SCORED','BOT_HANDOFF','CONTACT_ADDED','LINE_LINKED','PRODUCT_LINK_CLICK','PLACEHOLDER_MERGED']; readonly MANUAL: readonly ['TOUCHPOINT','HEARD_FROM','MARKED_LOST','REOPENED'] }` · `type JourneyEntryKind`
  - `PrismaService` จาก `apps/api/src/prisma/prisma.service.ts` (`PrismaModule` เป็น `@Global`) · `captureException` / `captureMessage` จาก `@sentry/nestjs`
- Produces:
  - `export class CustomerJourneyModule` (`customer-journey.module.ts`) — providers/exports `[JourneyEntryWriter]` · ไม่ import โมดูลอื่น · Task 3 เพิ่ม `JourneyStateService` ลง providers+exports · Task 8 เพิ่ม `CustomerJourneyService` + controller · Task 9 เพิ่ม `JourneySummaryService` + `CustomerJourneyCron`
  - `export interface JourneyEntryInput { customerId: string; kind: JourneyEntryKind; occurredAt: Date; actorType: 'STAFF' | 'CUSTOMER' | 'BOT' | 'SYSTEM'; actorUserId?: string | null; roomId?: string | null; refType?: string | null; refId?: string | null; data?: Record<string, unknown>; dedupeKey: string }`
  - `export class JourneyEntryWriter { recordAfterCommit(entry: JourneyEntryInput): Promise<void>; recordInTx(tx: Prisma.TransactionClient, entry: JourneyEntryInput): Promise<void> }` — เขียนเฉพาะ kind ใน `JOURNEY_ENTRY_KINDS.SYSTEM` · `origin='SYSTEM'` · `originCustomerId = customerId` · `createMany({ skipDuplicates: true })` · `recordAfterCommit` ไม่โยนเด็ดขาด (warn + Sentry) · `recordInTx` โยน error ของฐานข้อมูลต่อ (ใช้ได้ที่เดียว: `absorbPlaceholder` ใน Task 4)
  - `export const JOURNEY_DATA_SCHEMAS: Readonly<Record<JourneyEntryKind, z.ZodTypeAny>>` · `export type JourneyDataSanitizeResult = { ok: true; data: Record<string, unknown> } | { ok: false; issues: string[] }` · `export function sanitizeJourneyData(kind: string, raw: unknown): JourneyDataSanitizeResult` (issues = `"<path>:<zod code>"` ไม่มีค่าจริง)
  - `export function journeyDedupeKey(kind: JourneySystemEntryKind, ...parts: Array<string | number>): string` → `${kind}:${parts.join(':')}` · ไม่มีส่วนอ้างอิงหรือมีส่วนว่าง = โยน `Error('journeyDedupeKey(<kind>): …')` · **ทุก hook ใน Task 4-6 และ seed ในเทสของ Task 3/8/9 สร้าง dedupeKey ด้วยตัวนี้เท่านั้น**
  - รายการปิดที่ hook import ไปใช้ (ค่าตรงกับ `z.enum` ใน schema ตัวต่อตัว):
    - `HANDOFF_PRIORITIES = ['low','normal','high','critical']` · `type HandoffPriority`
    - `HANDOFF_REASON_CODES = ['BOT_SEND_FAILED','LOW_CONFIDENCE','AI_ERROR','CUSTOMER_REQUEST','OTHER']` · `type HandoffReasonCode`
    - `CONTACT_FIELDS = ['phone','nationalId']` · `type ContactField` · `CONTACT_ADDED_VIA = ['UPDATE','FILL_CONTACT','CAPTURE_LEAD']` · `type ContactAddedVia` (`CAPTURE_LEAD` สงวนไว้ให้ hook ของบอทขายเมื่อเจ้าของสั่งเปิด — เฟส 1 ไม่มีผู้เขียนค่านี้ ดูขอบเขตใน Task 13)
    - `LINE_LINK_CHANNELS = ['FINANCE','SHOP']` · `type LineLinkChannel` · `LINE_LINKED_VIA = ['VERIFICATION','LIFF','SELF_LINK_PHONE']` · `type LineLinkedVia`
    - `CREDIT_CHECK_OPENED_VIA = ['CONTRACT','CUSTOMER']` · `type CreditCheckOpenedVia` · `CONTRACT_REVIEW_DECISIONS = ['APPROVED','REJECTED']` · `CREDIT_AI_STATUSES = ['APPROVED','MANUAL_REVIEW','REJECTED']`
  - **สัญญา `data` + `dedupeKey` ฉบับเดียวของทั้งแผน** (ทุกคีย์ใน `data` บังคับ · คีย์อื่นถูกตัดทิ้ง · ไม่ผ่าน = แถวลงฐานแต่ `data` เป็น null + Sentry warning):

| kind | ผู้เขียน | `data` | `dedupeKey` | อ้างเอกสาร | ห้ามส่ง |
|---|---|---|---|---|---|
| `CONTRACT_ACTIVATED` | Task 5 | `{ contractNumber: string (A-Z a-z 0-9 . _ / - ยาว 1-40), totalMonths: int 1-120, monthlyPayment: number 0-10,000,000 }` | `CONTRACT_ACTIVATED:<contractId>` | `refType:'contract'` | ข้อมูลลูกค้า |
| `CONTRACT_REVIEWED` | Task 5 | `{ decision: 'APPROVED' \| 'REJECTED', contractNumber }` | `CONTRACT_REVIEWED:<contractId>:<reviewedAt ISO>` | `refType:'contract'` | `reviewNotes` |
| `CREDIT_CHECK_OPENED_BY` | Task 5 | `{ via: 'CONTRACT' \| 'CUSTOMER' }` | `CREDIT_CHECK_OPENED_BY:<creditCheckId>` | `refType:'credit_check'` | `bankName`, `notes`, `statementFiles` |
| `CREDIT_AI_SCORED` | Task 5 | `{ score: int 0-100 \| null, status: 'APPROVED' \| 'MANUAL_REVIEW' \| 'REJECTED' }` | `CREDIT_AI_SCORED:<creditCheckId>:<updatedAt ISO>` | `refType:'credit_check'` | `aiSummary`, `aiRecommendation`, `aiAnalysis` |
| `BOT_HANDOFF` | Task 6 | `{ priority: HandoffPriority, reasonCode: HandoffReasonCode }` | `BOT_HANDOFF:<roomId>:<handoffTaggedAt ms>` | `roomId` | `reason` (ข้อความ), `summary` (= ข้อความลูกค้า), `tags` |
| `CONTACT_ADDED` | Task 6 | `{ fields: ('phone' \| 'nationalId')[] 1-2 ตัว, via: ContactAddedVia }` | `CONTACT_ADDED:<customerId ตอนเขียน>:<fields เรียงแล้วคั่น +>` | — | ค่าเบอร์/เลขบัตร |
| `LINE_LINKED` | Task 6 | `{ channel: LineLinkChannel, via: LineLinkedVia }` | `LINE_LINKED:<channel>:<customerId ตอนเขียน>:<linkedAt ms>` | — | `lineUserId`, `phone` |
| `PRODUCT_LINK_CLICK` | Task 6 | `{ productId: uuid }` | `PRODUCT_LINK_CLICK:<roomId>:<productId>:<เวลา event ms>` | `refType:'product'`, `roomId` | ref ดิบ / PSID / ข้อความโน้ต |
| `PLACEHOLDER_MERGED` | Task 4 | `{ roomCount: int 0-1000 }` | `PLACEHOLDER_MERGED:<placeholderId>` | — | — |
| `TOUCHPOINT` `HEARD_FROM` `MARKED_LOST` `REOPENED` | เฟส 3 | `{}` — writer **ข้ามทั้งแถว** (บันทึกมือเขียนผ่าน endpoint เฟส 3 ลงคอลัมน์ของตัวเอง) | `null` | — | — |

  - `customerId` ในคีย์ = `originCustomerId` ตอนเขียน ไม่เปลี่ยนเมื่อ Task 4 ย้ายแถวไปลูกค้าจริง จึงไม่ชน unique · ห้ามใส่เบอร์/LINE user id/PSID ในคีย์

- [ ] **Step 1: ตรวจว่า Task 1 ลงครบก่อนเริ่ม**

Run (จาก root worktree): `npm run build -w packages/shared && node -e "console.log(require('@installment/shared').JOURNEY_ENTRY_KINDS.SYSTEM.length, require('@installment/shared').JOURNEY_ENTRY_KINDS.MANUAL.length)"` → Expected: build จบไม่มี error แล้วพิมพ์ `9 4`

Run (จาก `apps/api`): `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" npx prisma migrate deploy && npx prisma generate` → Expected: `No pending migrations to apply.` (หรือ apply `20261002100000_customer_journey` ถ้า Task 1 ยังไม่ได้ลงฐานนี้) แล้ว `Generated Prisma Client`

Run: `psql -h /tmp/bc-chat-prospects-pg/socket -p 55491 -U prospects_test -d bc_journey_test -Atc "select to_regclass('public.customer_journey_entries')"` → Expected: `customer_journey_entries` (ถ้าได้บรรทัดว่าง = Task 1 ยังไม่เสร็จ หยุด task นี้)

- [ ] **Step 2: ประกาศ zod เป็น dependency ของ API**

Run (จาก root worktree): `npm install zod@^3.25.76 -w apps/api --no-audit --no-fund`
Run: `git diff --stat -- apps/api/package.json package-lock.json && node -e "console.log(require('zod/package.json').version)"` → Expected: เปลี่ยน 2 ไฟล์ · `apps/api/package.json` +1 บรรทัด `"zod": "^3.25.76"` · `package-lock.json` เพิ่มบรรทัดเดียวกันใต้ `"apps/api"` (ไม่เกิน ~3 บรรทัด) · พิมพ์ `3.25.76`
ถ้า diff ของ `package-lock.json` เกิน 10 บรรทัด: `git checkout -- package-lock.json apps/api/package.json` แล้วเพิ่มบรรทัด `"zod": "^3.25.76",` ในบล็อก `"dependencies"` ของ `apps/api/package.json` (เรียงตามตัวอักษร) ด้วยมือ และรัน `npm install --package-lock-only --no-audit --no-fund`

- [ ] **Step 3: เทสแดง — whitelist ของ data**

สร้าง `apps/api/src/modules/customer-journey/journey-data-schemas.spec.ts`:
```ts
import { JOURNEY_ENTRY_KINDS, type JourneySystemEntryKind } from '@installment/shared';
import { JOURNEY_DATA_SCHEMAS, journeyDedupeKey, sanitizeJourneyData } from './journey-data-schemas';

const PRODUCT_ID = '3f0c2b7e-9a41-4c55-8d2e-6b1f0a9c7d21';

/** รูป data ที่ hook ของ Task 4-6 ส่งจริง — ถ้า hook เปลี่ยนรูป ต้องแก้ตารางใน Task 2 และที่นี่พร้อมกัน */
const HOOK_DATA: Record<JourneySystemEntryKind, Record<string, unknown>> = {
  CONTRACT_ACTIVATED: { contractNumber: 'BCP2609-00042', totalMonths: 12, monthlyPayment: 1813 },
  CONTRACT_REVIEWED: { decision: 'REJECTED', contractNumber: 'BCP2609-00042' },
  CREDIT_CHECK_OPENED_BY: { via: 'CUSTOMER' },
  CREDIT_AI_SCORED: { score: 95, status: 'APPROVED' },
  BOT_HANDOFF: { priority: 'normal', reasonCode: 'LOW_CONFIDENCE' },
  CONTACT_ADDED: { fields: ['nationalId', 'phone'], via: 'FILL_CONTACT' },
  LINE_LINKED: { channel: 'FINANCE', via: 'VERIFICATION' },
  PRODUCT_LINK_CLICK: { productId: PRODUCT_ID },
  PLACEHOLDER_MERGED: { roomCount: 2 },
};

describe('JOURNEY_DATA_SCHEMAS', () => {
  it('มี schema ครบทุก kind ใน JOURNEY_ENTRY_KINDS (SYSTEM + MANUAL) ไม่ขาดไม่เกิน', () => {
    const expected = [...JOURNEY_ENTRY_KINDS.SYSTEM, ...JOURNEY_ENTRY_KINDS.MANUAL].sort();
    expect(Object.keys(JOURNEY_DATA_SCHEMAS).sort()).toEqual(expected);
  });

  it('รูป data ที่ hook ของ Task 4-6 ส่งจริงผ่านครบทุกคีย์ · คะแนน AI เป็น null ได้', () => {
    for (const [kind, data] of Object.entries(HOOK_DATA)) {
      expect(sanitizeJourneyData(kind, data)).toEqual({ ok: true, data });
    }
    expect(sanitizeJourneyData('CREDIT_AI_SCORED', { score: null, status: 'MANUAL_REVIEW' })).toEqual({
      ok: true,
      data: { score: null, status: 'MANUAL_REVIEW' },
    });
  });

  it('ตัดคีย์ที่ไม่อยู่ใน whitelist ทิ้ง — เบอร์ เลขบัตร lineUserId ข้อความเหตุผล/ลูกค้า โน้ตผู้ตรวจ ไม่หลุดเข้าแถว', () => {
    expect(
      sanitizeJourneyData('CONTACT_ADDED', { fields: ['phone'], via: 'UPDATE', phone: '0812345678', nationalId: '1103700012345' }),
    ).toEqual({ ok: true, data: { fields: ['phone'], via: 'UPDATE' } });
    expect(
      sanitizeJourneyData('LINE_LINKED', { channel: 'SHOP', via: 'SELF_LINK_PHONE', lineUserId: 'U1234abcd', phone: '0812345678' }),
    ).toEqual({ ok: true, data: { channel: 'SHOP', via: 'SELF_LINK_PHONE' } });
    expect(
      sanitizeJourneyData('BOT_HANDOFF', {
        priority: 'normal',
        reasonCode: 'CUSTOMER_REQUEST',
        reason: 'ลูกค้าขอคุยกับพนักงาน',
        summary: 'เบอร์ผม 0812345678',
        tags: ['slip'],
      }),
    ).toEqual({ ok: true, data: { priority: 'normal', reasonCode: 'CUSTOMER_REQUEST' } });
    expect(
      sanitizeJourneyData('CREDIT_AI_SCORED', { score: 72, status: 'APPROVED', aiSummary: 'รายได้ประจำ', aiRecommendation: 'แนะนำอนุมัติ' }),
    ).toEqual({ ok: true, data: { score: 72, status: 'APPROVED' } });
    expect(
      sanitizeJourneyData('CONTRACT_REVIEWED', { decision: 'REJECTED', contractNumber: 'BCP2609-00042', reviewNotes: 'บัตรหมดอายุ' }),
    ).toEqual({ ok: true, data: { decision: 'REJECTED', contractNumber: 'BCP2609-00042' } });
    expect(
      sanitizeJourneyData('CONTRACT_ACTIVATED', { contractNumber: 'BCP2609-00042', totalMonths: 12, monthlyPayment: 1813, customer: { phone: '0812345678' } }),
    ).toEqual({ ok: true, data: { contractNumber: 'BCP2609-00042', totalMonths: 12, monthlyPayment: 1813 } });
    expect(sanitizeJourneyData('TOUCHPOINT', { note: 'โทรกลับ 0812345678' })).toEqual({ ok: true, data: {} });
  });

  it('ค่านอกรายการปิด / ชนิดผิด → ok:false พร้อม path:code และ issues ไม่มีค่าจริงติดออกไป', () => {
    const leaked = sanitizeJourneyData('BOT_HANDOFF', { priority: 'high', reasonCode: 'โทร 0812345678' });
    expect(leaked).toEqual({ ok: false, issues: ['reasonCode:invalid_enum_value'] });
    expect(JSON.stringify(leaked)).not.toContain('5678');
    expect(sanitizeJourneyData('CONTACT_ADDED', { fields: ['phone'], via: 'STAFF_EDIT' })).toEqual({
      ok: false,
      issues: ['via:invalid_enum_value'],
    });
    expect(sanitizeJourneyData('LINE_LINKED', { channel: 'SHOP', via: 'OTP_VERIFY' })).toEqual({
      ok: false,
      issues: ['via:invalid_enum_value'],
    });
    expect(sanitizeJourneyData('PRODUCT_LINK_CLICK', { productId: 'p:ลูกค้ากดลิงก์' })).toEqual({
      ok: false,
      issues: ['productId:invalid_string'],
    });
    expect(sanitizeJourneyData('CREDIT_AI_SCORED', { score: 101, status: 'APPROVED' })).toEqual({ ok: false, issues: ['score:too_big'] });
    expect(sanitizeJourneyData('CONTACT_ADDED', { fields: [], via: 'UPDATE' })).toEqual({ ok: false, issues: ['fields:too_small'] });
    expect(
      sanitizeJourneyData('CONTRACT_ACTIVATED', { contractNumber: 'สัญญา 0812345678', totalMonths: 12, monthlyPayment: 1 }),
    ).toEqual({ ok: false, issues: ['contractNumber:invalid_string'] });
  });

  it('kind ที่ไม่รู้จัก → ok:false ไม่โยน', () => {
    expect(sanitizeJourneyData('SOMETHING_ELSE', { a: 1 })).toEqual({ ok: false, issues: ['kind:unknown'] });
  });

  it('journeyDedupeKey = `${kind}:${ส่วนอ้างอิง}` · ไม่มีส่วนอ้างอิงหรือส่วนว่าง → โยน', () => {
    expect(journeyDedupeKey('CONTRACT_ACTIVATED', 'k1')).toBe('CONTRACT_ACTIVATED:k1');
    expect(journeyDedupeKey('BOT_HANDOFF', 'r1', 1790000000000)).toBe('BOT_HANDOFF:r1:1790000000000');
    expect(journeyDedupeKey('CONTRACT_REVIEWED', 'k1', '2026-09-15T03:00:00.000Z')).toBe('CONTRACT_REVIEWED:k1:2026-09-15T03:00:00.000Z');
    expect(journeyDedupeKey('CONTACT_ADDED', 'c1', 'nationalId+phone')).toBe('CONTACT_ADDED:c1:nationalId+phone');
    expect(() => journeyDedupeKey('PLACEHOLDER_MERGED')).toThrow('journeyDedupeKey(PLACEHOLDER_MERGED)');
    expect(() => journeyDedupeKey('PLACEHOLDER_MERGED', ' ')).toThrow('journeyDedupeKey(PLACEHOLDER_MERGED)');
  });
});
```
Run (จาก `apps/api`): `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-data-schemas.spec.ts --runInBand` → Expected: FAIL มีข้อความ `Cannot find module './journey-data-schemas'`

- [ ] **Step 4: `journey-data-schemas.ts`**

สร้าง `apps/api/src/modules/customer-journey/journey-data-schemas.ts`:
```ts
import { z } from 'zod';
import type { JourneyEntryKind, JourneySystemEntryKind } from '@installment/shared';

/**
 * whitelist ของคอลัมน์ `customer_journey_entries.data` ต่อ kind (PDPA) — สัญญากลางฉบับเดียวของแผน การเดินทางของลูกค้า
 * - คีย์ที่ไม่ประกาศถูกตัดทิ้ง (z.object ค่าตั้งต้น = strip) ⇒ ผู้เรียกส่งของเกินมาก็ไม่ลงฐาน
 * - ห้ามมีช่องข้อความอิสระ: ใช้รายการปิด (enum) · ตัวเลข · uuid · เลขเอกสารเท่านั้น
 * - ห้ามเก็บข้อความแชท, เหตุผลส่งต่อแบบข้อความ, callLog.notes, เบอร์, เลขบัตร, ที่อยู่, lineUserId/PSID, reviewNotes, aiSummary/aiRecommendation
 * - เอกสารอ้างผ่าน refType/refId ของแถว ไม่ใช่ data
 * บันทึกมือ (MANUAL) เก็บค่าในคอลัมน์ channel/outcome/lostReason/heardFrom/note ของตัวเอง ⇒ data ว่าง
 */

export const HANDOFF_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type HandoffPriority = (typeof HANDOFF_PRIORITIES)[number];
/** เหตุผลส่งต่อแบบรหัสปิด — Task 6 แปลงข้อความจากโค้ดเป็นรหัส ข้อความที่ไม่รู้จัก = OTHER (ไม่เก็บข้อความเด็ดขาด) */
export const HANDOFF_REASON_CODES = ['BOT_SEND_FAILED', 'LOW_CONFIDENCE', 'AI_ERROR', 'CUSTOMER_REQUEST', 'OTHER'] as const;
export type HandoffReasonCode = (typeof HANDOFF_REASON_CODES)[number];
export const CONTACT_FIELDS = ['phone', 'nationalId'] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];
/** UPDATE = PATCH /customers/:id · FILL_CONTACT = POST /customers/:id/fill-contact · CAPTURE_LEAD = สงวนไว้ให้ hook ของบอทขาย (capture_lead) ตอนเปิดบอท — เฟส 1 ไม่มีผู้เขียน */
export const CONTACT_ADDED_VIA = ['UPDATE', 'FILL_CONTACT', 'CAPTURE_LEAD'] as const;
export type ContactAddedVia = (typeof CONTACT_ADDED_VIA)[number];
export const LINE_LINK_CHANNELS = ['FINANCE', 'SHOP'] as const;
export type LineLinkChannel = (typeof LINE_LINK_CHANNELS)[number];
/** VERIFICATION = OTP ของบอทการเงิน · LIFF = ลงทะเบียน LINE การเงินผ่าน LIFF · SELF_LINK_PHONE = พิมพ์เบอร์ใน LINE ร้าน */
export const LINE_LINKED_VIA = ['VERIFICATION', 'LIFF', 'SELF_LINK_PHONE'] as const;
export type LineLinkedVia = (typeof LINE_LINKED_VIA)[number];
export const CREDIT_CHECK_OPENED_VIA = ['CONTRACT', 'CUSTOMER'] as const;
export type CreditCheckOpenedVia = (typeof CREDIT_CHECK_OPENED_VIA)[number];
export const CONTRACT_REVIEW_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export const CREDIT_AI_STATUSES = ['APPROVED', 'MANUAL_REVIEW', 'REJECTED'] as const;

/** เลขสัญญา (BCP2609-00042 จาก utils/sequence.util.ts:19 · เลขนำเข้าเดิม) — ไม่ใช่ข้อมูลส่วนบุคคล แต่ห้ามช่องว่าง/ภาษาไทย กันข้อความอิสระ */
const contractNumber = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/);

const noData = z.object({});

export const JOURNEY_DATA_SCHEMAS: Readonly<Record<JourneyEntryKind, z.ZodTypeAny>> = {
  // SYSTEM
  CONTRACT_ACTIVATED: z.object({
    contractNumber,
    totalMonths: z.number().int().min(1).max(120),
    monthlyPayment: z.number().min(0).max(10_000_000),
  }),
  CONTRACT_REVIEWED: z.object({ decision: z.enum(CONTRACT_REVIEW_DECISIONS), contractNumber }),
  CREDIT_CHECK_OPENED_BY: z.object({ via: z.enum(CREDIT_CHECK_OPENED_VIA) }),
  CREDIT_AI_SCORED: z.object({
    score: z.number().int().min(0).max(100).nullable(),
    status: z.enum(CREDIT_AI_STATUSES),
  }),
  BOT_HANDOFF: z.object({
    priority: z.enum(HANDOFF_PRIORITIES),
    reasonCode: z.enum(HANDOFF_REASON_CODES),
  }),
  CONTACT_ADDED: z.object({
    fields: z.array(z.enum(CONTACT_FIELDS)).min(1).max(2),
    via: z.enum(CONTACT_ADDED_VIA),
  }),
  LINE_LINKED: z.object({
    channel: z.enum(LINE_LINK_CHANNELS),
    via: z.enum(LINE_LINKED_VIA),
  }),
  PRODUCT_LINK_CLICK: z.object({ productId: z.string().uuid() }),
  PLACEHOLDER_MERGED: z.object({ roomCount: z.number().int().min(0).max(1000) }),
  // MANUAL
  TOUCHPOINT: noData,
  HEARD_FROM: noData,
  MARKED_LOST: noData,
  REOPENED: noData,
};

export type JourneyDataSanitizeResult = { ok: true; data: Record<string, unknown> } | { ok: false; issues: string[] };

/** ตรวจ + ตัด data ตาม kind · issues เป็น "path:code" เท่านั้น (ห้ามพาค่าจริงไป log/Sentry) · ไม่โยน */
export function sanitizeJourneyData(kind: string, raw: unknown): JourneyDataSanitizeResult {
  if (!Object.prototype.hasOwnProperty.call(JOURNEY_DATA_SCHEMAS, kind)) {
    return { ok: false, issues: ['kind:unknown'] };
  }
  const parsed = JOURNEY_DATA_SCHEMAS[kind as JourneyEntryKind].safeParse(raw ?? {});
  if (parsed.success) {
    return { ok: true, data: parsed.data as Record<string, unknown> };
  }
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}:${issue.code}`),
  };
}

/**
 * รูป dedupe_key เดียวทั้งระบบ: `${kind}:${ส่วนอ้างอิง…}` (ตาราง "สัญญา data + dedupeKey" ใน Task 2)
 * ส่วนอ้างอิง = id เอกสาร/ห้อง/ลูกค้าตอนเขียน + เวลาของเหตุการณ์เมื่อเกิดซ้ำได้หลายรอบ · ห้ามใส่เบอร์ LINE user id หรือ PSID
 */
export function journeyDedupeKey(kind: JourneySystemEntryKind, ...parts: Array<string | number>): string {
  const texts = parts.map((part) => String(part));
  if (texts.length === 0 || texts.some((part) => part.trim() === '')) {
    throw new Error(`journeyDedupeKey(${kind}): ต้องมีส่วนอ้างอิงที่ไม่ว่างอย่างน้อยหนึ่งส่วน`);
  }
  return [kind, ...texts].join(':');
}
```
Run เทส Step 3 อีกครั้ง → Expected: PASS 6 tests

- [ ] **Step 5: เทสแดง — ตัวเขียนกับ Postgres จริง (skipDuplicates · ไม่โยน · อยู่ในทรานแซกชัน)**

สร้าง `apps/api/src/modules/customer-journey/journey-entry-writer.service.db.spec.ts`:
```ts
import { randomUUID } from 'crypto';
import { Global, Logger, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import type { JourneySystemEntryKind } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerJourneyModule } from './customer-journey.module';
import { journeyDedupeKey } from './journey-data-schemas';
import { JourneyEntryWriter, type JourneyEntryInput } from './journey-entry-writer.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * พิสูจน์กับ Postgres จริง: dedupe_key unique + skipDuplicates ได้แถวเดียว · recordAfterCommit ไม่โยนแม้ FK ล้ม ·
 * recordInTx อยู่ในทรานแซกชันของผู้เรียก (rollback แล้วแถวหาย, ซ้ำไม่ทำให้ทรานแซกชันพัง) · data ผ่าน whitelist ก่อนลงคอลัมน์ json
 * · รูป data ที่ hook ของ Task 4-6 ส่งจริงลงคอลัมน์ครบทุกคีย์ (ไม่มี kind ไหนกลายเป็น null เงียบ ๆ)
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest <ไฟล์นี้> --runInBand
 */
const prisma = new PrismaClient();

/** ชุดเดียวกับ HOOK_DATA ใน journey-data-schemas.spec.ts */
const HOOK_DATA: Record<JourneySystemEntryKind, Record<string, unknown>> = {
  CONTRACT_ACTIVATED: { contractNumber: 'BCP2609-00042', totalMonths: 12, monthlyPayment: 1813 },
  CONTRACT_REVIEWED: { decision: 'REJECTED', contractNumber: 'BCP2609-00042' },
  CREDIT_CHECK_OPENED_BY: { via: 'CUSTOMER' },
  CREDIT_AI_SCORED: { score: null, status: 'MANUAL_REVIEW' },
  BOT_HANDOFF: { priority: 'normal', reasonCode: 'LOW_CONFIDENCE' },
  CONTACT_ADDED: { fields: ['nationalId', 'phone'], via: 'FILL_CONTACT' },
  LINE_LINKED: { channel: 'SHOP', via: 'SELF_LINK_PHONE' },
  PRODUCT_LINK_CLICK: { productId: '3f0c2b7e-9a41-4c55-8d2e-6b1f0a9c7d21' },
  PLACEHOLDER_MERGED: { roomCount: 2 },
};

@Global()
@Module({ providers: [{ provide: PrismaService, useValue: prisma }], exports: [PrismaService] })
class TestPrismaModule {}

describe('JourneyEntryWriter (real DB)', () => {
  const stamp = Date.now();
  const customerIds: string[] = [];
  let writer: JourneyEntryWriter;
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestPrismaModule, CustomerJourneyModule] }).compile();
    writer = moduleRef.get(JourneyEntryWriter);
  });

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.mocked(Sentry.captureException).mockClear();
    jest.mocked(Sentry.captureMessage).mockClear();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
  });

  async function customer(label: string) {
    const row = await prisma.customer.create({ data: { name: `journey writer spec ${label} ${stamp}`, phone: null } });
    customerIds.push(row.id);
    return row;
  }

  function entry(customerId: string, overrides: Partial<JourneyEntryInput> = {}): JourneyEntryInput {
    const refId = randomUUID();
    return {
      customerId,
      kind: 'CONTRACT_REVIEWED',
      occurredAt: new Date('2026-09-15T03:00:00.000Z'),
      actorType: 'STAFF',
      actorUserId: null,
      roomId: null,
      refType: 'contract',
      refId,
      data: { decision: 'APPROVED', contractNumber: 'BCP2609-00042' },
      dedupeKey: journeyDedupeKey('CONTRACT_REVIEWED', refId, '2026-09-15T03:00:00.000Z'),
      ...overrides,
    };
  }

  it('เขียนแถว SYSTEM: originCustomerId = customerId · คีย์นอก whitelist ถูกตัดก่อนลงฐาน', async () => {
    const c = await customer('write');
    const e = entry(c.id, { data: { decision: 'APPROVED', contractNumber: 'BCP2609-00042', reviewNotes: 'โทร 0812345678' } });

    await expect(writer.recordAfterCommit(e)).resolves.toBeUndefined();

    const rows = await prisma.customerJourneyEntry.findMany({ where: { customerId: c.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      customerId: c.id,
      originCustomerId: c.id,
      origin: 'SYSTEM',
      kind: 'CONTRACT_REVIEWED',
      actorType: 'STAFF',
      actorUserId: null,
      roomId: null,
      refType: 'contract',
      refId: e.refId,
      dedupeKey: e.dedupeKey,
      data: { decision: 'APPROVED', contractNumber: 'BCP2609-00042' },
      channel: null,
      outcome: null,
      note: null,
      deletedAt: null,
    });
    expect(rows[0].occurredAt.toISOString()).toBe('2026-09-15T03:00:00.000Z');
    expect(JSON.stringify(rows[0])).not.toContain('0812345678');
  });

  it('dedupeKey ซ้ำ → แถวเดียว ค่าแรกคงอยู่ ไม่โยน ไม่แจ้ง Sentry (skipDuplicates)', async () => {
    const c = await customer('dup');
    const e = entry(c.id);

    await writer.recordAfterCommit(e);
    await writer.recordAfterCommit({ ...e, occurredAt: new Date('2026-09-15T04:00:00.000Z') });
    await writer.recordAfterCommit(e);

    expect(await prisma.customerJourneyEntry.count({ where: { dedupeKey: e.dedupeKey } })).toBe(1);
    const row = await prisma.customerJourneyEntry.findUniqueOrThrow({ where: { dedupeKey: e.dedupeKey } });
    expect(row.occurredAt.toISOString()).toBe('2026-09-15T03:00:00.000Z');
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('ฐานข้อมูลปฏิเสธ (ลูกค้าไม่มีอยู่ → FK) → recordAfterCommit ไม่โยน · Logger.warn + Sentry.captureException', async () => {
    const e = entry(randomUUID());

    await expect(writer.recordAfterCommit(e)).resolves.toBeUndefined();

    expect(await prisma.customerJourneyEntry.count({ where: { dedupeKey: e.dedupeKey } })).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CONTRACT_REVIEWED'));
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(jest.mocked(Sentry.captureException).mock.calls[0][1]).toMatchObject({
      tags: { module: 'customer-journey', action: 'record_after_commit' },
    });
  });

  it('data ไม่ผ่าน whitelist (reasonCode เป็นข้อความหน้าตาเหมือนเบอร์) → ยังเก็บแถว แต่ data เป็น null · captureMessage ระดับ warning ไม่มีค่าจริง', async () => {
    const c = await customer('pii');
    const e = entry(c.id, {
      kind: 'BOT_HANDOFF',
      actorType: 'BOT',
      refType: null,
      refId: null,
      data: { priority: 'high', reasonCode: '0812345678' },
      dedupeKey: journeyDedupeKey('BOT_HANDOFF', randomUUID(), stamp),
    });

    await writer.recordAfterCommit(e);

    const row = await prisma.customerJourneyEntry.findUniqueOrThrow({ where: { dedupeKey: e.dedupeKey } });
    expect(row.kind).toBe('BOT_HANDOFF');
    expect(row.data).toBeNull();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ level: 'warning', extra: { kind: 'BOT_HANDOFF', issues: ['reasonCode:invalid_enum_value'] } }),
    );
    expect(JSON.stringify(jest.mocked(Sentry.captureMessage).mock.calls)).not.toContain('0812345678');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('0812345678');
  });

  it('kind บันทึกมือ / dedupeKey ว่าง / วันที่เสีย / actorType แปลก / refType ยาวเกินคอลัมน์ → ข้าม ไม่เขียน ไม่โยน', async () => {
    const c = await customer('skip');
    const bad: JourneyEntryInput[] = [
      entry(c.id, { kind: 'TOUCHPOINT', data: {} }),
      entry(c.id, { dedupeKey: '   ' }),
      entry(c.id, { occurredAt: new Date('not a date') }),
      entry(c.id, { actorType: 'ROBOT' as JourneyEntryInput['actorType'] }),
      entry(c.id, { refType: 'x'.repeat(25) }),
    ];

    for (const e of bad) {
      await expect(writer.recordAfterCommit(e)).resolves.toBeUndefined();
    }

    expect(await prisma.customerJourneyEntry.count({ where: { customerId: c.id } })).toBe(0);
    expect(Sentry.captureException).toHaveBeenCalledTimes(bad.length);
  });

  it('recordInTx อยู่ในทรานแซกชันของผู้เรียก — rollback แล้วแถวหาย · บันทึกซ้ำในทรานแซกชันไม่ทำให้คำสั่งถัดไปล้ม', async () => {
    const c = await customer('tx');
    const rolledBack = entry(c.id, {
      kind: 'PLACEHOLDER_MERGED',
      actorType: 'SYSTEM',
      refType: null,
      refId: null,
      data: { roomCount: 1 },
      dedupeKey: journeyDedupeKey('PLACEHOLDER_MERGED', randomUUID()),
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await writer.recordInTx(tx, rolledBack);
        throw new Error('rollback-spec');
      }),
    ).rejects.toThrow('rollback-spec');
    expect(await prisma.customerJourneyEntry.count({ where: { dedupeKey: rolledBack.dedupeKey } })).toBe(0);

    const committed = { ...rolledBack, dedupeKey: journeyDedupeKey('PLACEHOLDER_MERGED', randomUUID()) };
    await prisma.$transaction(async (tx) => {
      await writer.recordInTx(tx, committed);
      await writer.recordInTx(tx, committed);
      await tx.customer.update({ where: { id: c.id }, data: { nickname: 'หลังบันทึกซ้ำ' } });
    });

    expect(await prisma.customerJourneyEntry.count({ where: { dedupeKey: committed.dedupeKey } })).toBe(1);
    expect((await prisma.customerJourneyEntry.findUniqueOrThrow({ where: { dedupeKey: committed.dedupeKey } })).data).toEqual({ roomCount: 1 });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).nickname).toBe('หลังบันทึกซ้ำ');
  });

  it('recordInTx: ฐานข้อมูลปฏิเสธ → โยนต่อให้ทรานแซกชันของผู้เรียก rollback (ไม่กลืน)', async () => {
    const ghost = entry(randomUUID(), {
      kind: 'PLACEHOLDER_MERGED',
      actorType: 'SYSTEM',
      refType: null,
      refId: null,
      data: { roomCount: 0 },
      dedupeKey: journeyDedupeKey('PLACEHOLDER_MERGED', randomUUID()),
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await writer.recordInTx(tx, ghost);
      }),
    ).rejects.toThrow();
    expect(await prisma.customerJourneyEntry.count({ where: { dedupeKey: ghost.dedupeKey } })).toBe(0);
  });

  it('ทุก SYSTEM kind ด้วยรูป data ที่ hook ของ Task 4-6 ส่งจริง → คอลัมน์ data เท่ากับที่ส่งทุกคีย์ ไม่มี warning', async () => {
    const c = await customer('contract');
    for (const [kind, data] of Object.entries(HOOK_DATA) as [JourneySystemEntryKind, Record<string, unknown>][]) {
      const e = entry(c.id, { kind, data, dedupeKey: journeyDedupeKey(kind, randomUUID()) });
      await writer.recordAfterCommit(e);
      const row = await prisma.customerJourneyEntry.findUniqueOrThrow({ where: { dedupeKey: e.dedupeKey } });
      expect({ kind: row.kind, data: row.data }).toEqual({ kind, data });
    }
    expect(await prisma.customerJourneyEntry.count({ where: { customerId: c.id } })).toBe(9);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
```
Run (จาก `apps/api`): `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-entry-writer.service.db.spec.ts --runInBand` → Expected: FAIL มีข้อความ `Cannot find module './customer-journey.module'`

- [ ] **Step 6: ตัวเขียน + โมดูล**

สร้าง `apps/api/src/modules/customer-journey/journey-entry-writer.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { JOURNEY_ENTRY_KINDS, type JourneyEntryKind } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeJourneyData } from './journey-data-schemas';

/** แถว SYSTEM หนึ่งแถว — ห้ามใส่ข้อความแชท, callLog.notes, เบอร์, เลขบัตร, ที่อยู่ (data ผ่าน JOURNEY_DATA_SCHEMAS อีกชั้น) */
export interface JourneyEntryInput {
  customerId: string;
  kind: JourneyEntryKind;
  occurredAt: Date;
  actorType: 'STAFF' | 'CUSTOMER' | 'BOT' | 'SYSTEM';
  actorUserId?: string | null;
  roomId?: string | null;
  refType?: string | null;
  refId?: string | null;
  data?: Record<string, unknown>;
  /** สร้างด้วย journeyDedupeKey(kind, ...) เท่านั้น — unique ทั้งตาราง ⇒ hook ที่ยิงซ้ำ (retry, webhook ซ้ำ) ได้แถวเดียว */
  dedupeKey: string;
}

const SYSTEM_KINDS: ReadonlySet<string> = new Set<string>(JOURNEY_ENTRY_KINDS.SYSTEM);
const ACTOR_TYPES: ReadonlySet<string> = new Set<JourneyEntryInput['actorType']>(['STAFF', 'CUSTOMER', 'BOT', 'SYSTEM']);
/** ความยาวคอลัมน์ ref_type @db.VarChar(24) — เกินแล้ว INSERT ล้มกลางทรานแซกชันของ absorbPlaceholder */
const REF_TYPE_MAX = 24;
const DEDUPE_KEY_MAX = 200;
const SENTRY_TAGS = { module: 'customer-journey' } as const;

/**
 * ตัวเขียน customer_journey_entries (origin=SYSTEM) — ผู้เรียกอยู่ในเส้นทางธุรกิจ (สัญญา เครดิต แชท) จึงแยกสองทาง:
 * - recordAfterCommit: เรียก **หลัง** ทรานแซกชันของโดเมน commit แล้ว ใช้ this.prisma ของตัวเอง ห้ามส่ง tx ของโดเมนเงินเข้ามา
 *   ไม่โยนเด็ดขาด (ล้ม = Logger.warn + Sentry) เพราะประวัติการเดินทางต้องไม่ทำให้การขาย/รับเงินล้ม
 * - recordInTx: ใช้ได้ที่เดียวคือ CustomerMergeService.absorbPlaceholder — error ของฐานข้อมูลโยนต่อ
 *   เพราะ Postgres ยกเลิกทรานแซกชันทั้งก้อนอยู่แล้ว กลืนไว้ก็แค่ทำให้คำสั่งถัดไปล้มแบบหาสาเหตุไม่เจอ
 * ทั้งสองทาง: createMany + skipDuplicates (ON CONFLICT DO NOTHING บน dedupe_key) ⇒ ยิงซ้ำได้แถวเดียวและไม่ทำให้ทรานแซกชันพัง
 * แถวที่ข้อมูลบังคับไม่ครบ/ไม่ใช่ kind ของ SYSTEM ถูกข้าม (warn + Sentry) · data ไม่ผ่าน whitelist → เก็บแถวโดยไม่มี data
 */
@Injectable()
export class JourneyEntryWriter {
  private readonly logger = new Logger(JourneyEntryWriter.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordAfterCommit(entry: JourneyEntryInput): Promise<void> {
    try {
      const row = this.toRow(entry);
      if (!row) return;
      await this.prisma.customerJourneyEntry.createMany({ data: [row], skipDuplicates: true });
    } catch (err) {
      this.logger.warn(
        `[journey] เขียน ${entry.kind} ไม่สำเร็จ (customer ${entry.customerId}): ${err instanceof Error ? err.message : String(err)}`,
      );
      Sentry.captureException(err, {
        tags: { ...SENTRY_TAGS, action: 'record_after_commit' },
        extra: { kind: entry.kind, dedupeKey: entry.dedupeKey },
      });
    }
  }

  async recordInTx(tx: Prisma.TransactionClient, entry: JourneyEntryInput): Promise<void> {
    const row = this.toRow(entry);
    if (!row) return;
    await tx.customerJourneyEntry.createMany({ data: [row], skipDuplicates: true });
  }

  private toRow(entry: JourneyEntryInput): Prisma.CustomerJourneyEntryCreateManyInput | null {
    const problem = this.invalidReason(entry);
    if (problem) {
      this.logger.warn(`[journey] ข้ามแถว ${entry.kind}: ${problem}`);
      Sentry.captureException(new Error(`customer-journey: ${problem}`), {
        tags: { ...SENTRY_TAGS, action: 'reject_entry' },
        extra: { kind: entry.kind, dedupeKey: entry.dedupeKey },
      });
      return null;
    }

    const sanitized = sanitizeJourneyData(entry.kind, entry.data ?? {});
    if (!sanitized.ok) {
      this.logger.warn(`[journey] ${entry.kind} data ไม่ผ่าน whitelist ถูกตัดทิ้ง: ${sanitized.issues.join(', ')}`);
      Sentry.captureMessage('customer-journey: data ไม่ผ่าน JOURNEY_DATA_SCHEMAS — เก็บแถวโดยไม่มี data', {
        level: 'warning',
        tags: { ...SENTRY_TAGS, action: 'strip_data' },
        extra: { kind: entry.kind, issues: sanitized.issues },
      });
    }
    const data =
      sanitized.ok && Object.keys(sanitized.data).length > 0 ? (sanitized.data as Prisma.InputJsonObject) : undefined;

    return {
      customerId: entry.customerId,
      originCustomerId: entry.customerId,
      origin: 'SYSTEM',
      kind: entry.kind,
      occurredAt: entry.occurredAt,
      actorType: entry.actorType,
      actorUserId: entry.actorUserId ?? null,
      roomId: entry.roomId ?? null,
      refType: entry.refType ?? null,
      refId: entry.refId ?? null,
      data,
      dedupeKey: entry.dedupeKey.trim(),
    };
  }

  private invalidReason(entry: JourneyEntryInput): string | null {
    if (!SYSTEM_KINDS.has(entry.kind)) return `kind ${entry.kind} ไม่ใช่ SYSTEM (บันทึกมือเขียนผ่าน endpoint ของตัวเอง)`;
    if (!entry.customerId) return 'ไม่มี customerId';
    if (!(entry.occurredAt instanceof Date) || Number.isNaN(entry.occurredAt.getTime())) return 'occurredAt ไม่ใช่วันที่ที่ถูกต้อง';
    if (!ACTOR_TYPES.has(entry.actorType)) return `actorType ${entry.actorType} ไม่รู้จัก`;
    const key = typeof entry.dedupeKey === 'string' ? entry.dedupeKey.trim() : '';
    if (!key) return 'ไม่มี dedupeKey';
    if (key.length > DEDUPE_KEY_MAX) return `dedupeKey ยาวเกิน ${DEDUPE_KEY_MAX}`;
    if (entry.refType && entry.refType.length > REF_TYPE_MAX) return `refType ยาวเกิน ${REF_TYPE_MAX}`;
    return null;
  }
}
```

สร้าง `apps/api/src/modules/customer-journey/customer-journey.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { JourneyEntryWriter } from './journey-entry-writer.service';

/**
 * การเดินทางของลูกค้า — ไม่ import โมดูลอื่น (PrismaModule เป็น @Global)
 * ⇒ ChatProspectsModule (CustomerMergeService) และโมดูลที่มี hook import โมดูลนี้ได้โดยไม่เกิดวงจร
 * Task 3 เพิ่ม JourneyStateService (providers + exports) · Task 8 เพิ่ม CustomerJourneyService + controller · Task 9 เพิ่ม JourneySummaryService + CustomerJourneyCron
 */
@Module({
  providers: [JourneyEntryWriter],
  exports: [JourneyEntryWriter],
})
export class CustomerJourneyModule {}
```
Run เทส Step 5 อีกครั้ง → Expected: PASS 8 tests (มีบรรทัด `prisma:error` ของ FK จากเคส ghost ได้ — เป็นผลที่ตั้งใจ)

- [ ] **Step 7: ลงทะเบียนใน `app.module.ts` + ตรวจทั้งชุด**

ใน `apps/api/src/app.module.ts` บรรทัด 145 แทน:
```ts
import { ImportedSalesModule } from './modules/imported-sales/imported-sales.module';
```
ด้วย:
```ts
import { ImportedSalesModule } from './modules/imported-sales/imported-sales.module';
import { CustomerJourneyModule } from './modules/customer-journey/customer-journey.module';
```
และบรรทัด 400-401 (ท้าย array `imports`) แทน:
```ts
    // Tooltify import flow — read-only imported sales stats (Excel import)
    ImportedSalesModule,
```
ด้วย:
```ts
    // Tooltify import flow — read-only imported sales stats (Excel import)
    ImportedSalesModule,
    // การเดินทางของลูกค้า (Plan 2 2026-09-15) — ตัวเขียนบันทึก SYSTEM · แคชขั้น · GET /customers/:id/journey
    CustomerJourneyModule,
```
Run (จาก `apps/api`): `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey --runInBand` → Expected: `Test Suites: 3 passed, 3 total` · `Tests: 18 passed, 18 total` (schema ของ Task 1 = 4 · whitelist 6 · writer 8)
Run: `npx tsc --noEmit -p tsconfig.json` → Expected: 0 error
Run: `npx eslint src/app.module.ts src/modules/customer-journey/customer-journey.module.ts src/modules/customer-journey/journey-data-schemas.ts src/modules/customer-journey/journey-data-schemas.spec.ts src/modules/customer-journey/journey-entry-writer.service.ts src/modules/customer-journey/journey-entry-writer.service.db.spec.ts` → Expected: 0 error (🚨 ห้าม `npm run lint`)

- [ ] **Step 8: Commit**

Run (จาก root worktree):
```bash
git add apps/api/package.json package-lock.json apps/api/src/app.module.ts apps/api/src/modules/customer-journey/customer-journey.module.ts apps/api/src/modules/customer-journey/journey-data-schemas.ts apps/api/src/modules/customer-journey/journey-data-schemas.spec.ts apps/api/src/modules/customer-journey/journey-entry-writer.service.ts apps/api/src/modules/customer-journey/journey-entry-writer.service.db.spec.ts
git commit -m "feat(customer-journey): ตัวเขียนบันทึกการเดินทาง (หลัง commit ไม่โยน / ในทรานแซกชันของการรวม) + whitelist data ต่อ kind กัน PII

- createMany skipDuplicates บน dedupe_key ⇒ hook ยิงซ้ำได้แถวเดียว
- data ตัดคีย์นอก whitelist · ช่องรหัสเป็นรายการปิด (ไม่มีข้อความอิสระ) · log/Sentry มีแค่ path:code
- journeyDedupeKey รูป `${kind}:${ส่วนอ้างอิง}` เดียวทั้งระบบ
- ประกาศ zod เป็น dependency ของ API (เดิมพึ่ง hoist จาก @anthropic-ai/sdk)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: แคชขั้นการเดินทาง `journey-state.sql` + `JourneyStateService.recompute(customerIds)` + โมดูล export ตัวคำนวณแคช

งานนี้คือครึ่ง "แคช" ที่แยกออกมาก่อน เพราะ Task 4 (รวมผู้สนใจ) เรียก `recompute` หลัง commit และ import `JourneyStateService` ผ่าน `CustomerJourneyModule` · ส่วน summary endpoint, ตัวตรวจความเคลื่อนไหว และ cron อยู่ใน Task 9

> กติกาเวลา: ฐานเก็บ `timestamp without time zone` เป็น UTC และ session ของฐานทดสอบเป็น `Asia/Bangkok` ⇒ SQL รับเวลาเป็นสตริง ISO แล้ว `::timestamp` ห้าม `now()`/`timestamptz` · PDPA: SQL ไม่อ่าน `chat_messages.content`/`text`, `note`, `call_logs.notes` · ใช้ `phone`/`national_id` แค่ `IS NOT NULL`

**Files:**
- Create: `apps/api/src/modules/customer-journey/sql/journey-state.sql`
- Create: `apps/api/src/modules/customer-journey/journey-state.service.ts`
- Create: `apps/api/src/modules/customer-journey/journey-state.service.spec.ts` (unit — แบ่งชุด/keyset)
- Create: `apps/api/src/modules/customer-journey/journey-state.service.db.spec.ts`
- Create: `apps/api/src/modules/customer-journey/customer-journey.module.spec.ts` (สัญญา DI ที่ Task 4 พึ่ง)
- Modify: `apps/api/src/modules/customer-journey/customer-journey.module.ts` (ไฟล์ของ Task 2 — เขียนทับทั้งไฟล์)
- Modify: `apps/api/src/modules/customers/services/customer-query.service.ts:43` (`const BOUGHT_WHERE` → `export const BOUGHT_WHERE` — predicate ตัวเดียวกับแท็บลูกค้า/ผู้สนใจ ห้ามลอกซ้ำ)
- Modify: `apps/api/nest-cli.json:13` (asset `.sql` ให้ถูกคัดลอกเข้า `dist/src`)
- Modify: `apps/api/package.json:8` (`verify:assets` ตรวจ `journey-state.sql` ด้วย)

**Interfaces:**
- Consumes:
  - Task 1: Prisma `customerJourneyState` (PK `customer_id` · FK → customers CASCADE) · `customerJourneyEntry` (`kind`, `occurredAt`, `outcome`, `heardFrom`, `lostReason`, `refId`, `deletedAt`) · `Customer.mergedIntoId` · migration `20261002100000_customer_journey` บน `bc_journey_test`
  - Task 2: `CustomerJourneyModule` (providers/exports `[JourneyEntryWriter]`) · `journeyDedupeKey(kind, ...parts)` (ใช้ใน seed ของเทส)
  - ของเดิม: `CUSTOMER_BOUGHT_CONTRACT_STATUSES` (`packages/shared/src/customer-sort.ts:61`) · `CUSTOMER_BOUGHT_SALE_TYPES` (`:73`) · `BOUGHT_WHERE` (`customer-query.service.ts:43` ใช้สองชุดข้างบน) · `PrismaService`
- Produces:
  - `export class JourneyStateService { constructor(prisma: PrismaService); recompute(customerIds: string[]): Promise<void>; recomputeAll(): Promise<number>; purchasedParity(): Promise<{ purchasedStates: number; bought: number }> }`
    - `recompute`: ตัด id ว่าง/ซ้ำ · ทีละ 500 · คำนวณเฉพาะลูกค้า `deleted_at IS NULL` · ลบแคชของ id ที่ถูกลบแล้ว · `contacted_at`/`first_channel`/`first_source`/`first_ad_campaign_id`/`identified_at`/`first_staff_reply_at` เลื่อนได้เฉพาะไปค่าที่เก่ากว่า · ขั้น PURCHASED ใช้ predicate เดียวกับ `BOUGHT_WHERE`
    - Task 9 เพิ่ม `hasActivitySince` · `activeCustomerIdsSince` · `contractsMissingActivationEntry` ในคลาสเดียวกัน (สัญญาสามเมธอดข้างบนคงเดิม)
  - `sql/journey-state.sql` — `$1 text[]` id ลูกค้า · `$2 text[]` สถานะสัญญาที่นับว่าซื้อ · `$3 text[]` ชนิดใบขายที่นับว่าซื้อ · `$4 text` เวลาคำนวณ ISO UTC
  - `CustomerJourneyModule` providers/exports = `[JourneyEntryWriter, JourneyStateService]` · ไม่มี `imports`
  - `export const BOUGHT_WHERE: Prisma.CustomerWhereInput` จาก `customer-query.service.ts`
  - asset `modules/customer-journey/sql/*.sql` → `dist/src/modules/customer-journey/sql/`

- [ ] **Step 1: ตรวจของจาก Task 1-2**

Run (จาก `apps/api`):
```bash
ls src/modules/customer-journey/customer-journey.module.ts src/modules/customer-journey/journey-entry-writer.service.ts src/modules/customer-journey/journey-data-schemas.ts
grep -n "journeyDedupeKey" src/modules/customer-journey/journey-data-schemas.ts
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" npx prisma migrate deploy
grep -n "^const BOUGHT_WHERE" src/modules/customers/services/customer-query.service.ts
```
Expected:
- `ls` พบครบ 3 ไฟล์ · grep เจอ `export function journeyDedupeKey` (ไม่เจอ = Task 2 ยังไม่ลง หยุดก่อน)
- `No pending migrations to apply.` หรือ apply `20261002100000_customer_journey`
- `43:const BOUGHT_WHERE: Prisma.CustomerWhereInput = {`

- [ ] **Step 2: เทสแดง — unit ของการแบ่งชุด + สัญญา DI ของโมดูล**

สร้าง `apps/api/src/modules/customer-journey/journey-state.service.spec.ts`:
```ts
import { CUSTOMER_BOUGHT_CONTRACT_STATUSES, CUSTOMER_BOUGHT_SALE_TYPES } from '@installment/shared';
import { JourneyStateService } from './journey-state.service';

/** การแบ่งชุดและ keyset — ตัว SQL พิสูจน์ใน journey-state.service.db.spec.ts */
describe('JourneyStateService (unit)', () => {
  function build(customers: string[] = []) {
    const prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      customerJourneyState: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      customer: {
        findMany: jest.fn(async (args: { where: { id?: { gt: string } }; take: number }) => {
          const after = args.where.id?.gt;
          return customers
            .filter((id) => !after || id > after)
            .slice(0, args.take)
            .map((id) => ({ id }));
        }),
      },
    };
    return { prisma, service: new JourneyStateService(prisma as never) };
  }

  it('recompute: ตัด id ว่าง/ซ้ำ · ทีละ 500 · ส่งรายการสถานะซื้อจาก shared + เวลาคำนวณ ISO · ลบแคชของคนที่ถูกลบในชุดเดียวกัน', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `c${String(i).padStart(4, '0')}`);
    const { prisma, service } = build();

    await service.recompute([...ids, ids[0], '']);

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    const [sql, batch, statuses, saleTypes, computedAt] = prisma.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('INSERT INTO customer_journey_states');
    expect(batch).toHaveLength(500);
    expect(statuses).toEqual([...CUSTOMER_BOUGHT_CONTRACT_STATUSES]);
    expect(saleTypes).toEqual([...CUSTOMER_BOUGHT_SALE_TYPES]);
    expect(new Date(computedAt).toISOString()).toBe(computedAt);
    expect(prisma.$executeRawUnsafe.mock.calls[2][1]).toEqual(['c1000']);
    expect(prisma.customerJourneyState.deleteMany).toHaveBeenNthCalledWith(1, {
      where: { customerId: { in: batch }, customer: { deletedAt: { not: null } } },
    });
  });

  it('recompute([]) ไม่ยิงฐาน', async () => {
    const { prisma, service } = build();
    await service.recompute([]);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.customerJourneyState.deleteMany).not.toHaveBeenCalled();
  });

  it('recomputeAll เดิน keyset ตาม id ทีละ 500 จนหมด และคืนจำนวนทั้งหมด', async () => {
    const customers = Array.from({ length: 1200 }, (_, i) => `c${String(i).padStart(4, '0')}`);
    const { prisma, service } = build(customers);

    await expect(service.recomputeAll()).resolves.toBe(1200);

    expect(prisma.customer.findMany.mock.calls.map(([args]) => args.where.id?.gt ?? null)).toEqual([null, 'c0499', 'c0999']);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
  });
});
```

สร้าง `apps/api/src/modules/customer-journey/customer-journey.module.spec.ts`:
```ts
import { CustomerJourneyModule } from './customer-journey.module';
import { JourneyEntryWriter } from './journey-entry-writer.service';
import { JourneyStateService } from './journey-state.service';

describe('CustomerJourneyModule — สัญญา DI ที่โมดูลอื่นพึ่ง (Task 4-6 import โมดูลนี้)', () => {
  it('provide + export JourneyEntryWriter และ JourneyStateService · ไม่ import โมดูลใดเลย (กันวงจรกับ ChatProspects/Customers/LineOa/ChatEngine)', () => {
    expect(Reflect.getMetadata('providers', CustomerJourneyModule)).toEqual(expect.arrayContaining([JourneyEntryWriter, JourneyStateService]));
    expect(Reflect.getMetadata('exports', CustomerJourneyModule)).toEqual(expect.arrayContaining([JourneyEntryWriter, JourneyStateService]));
    expect(Reflect.getMetadata('imports', CustomerJourneyModule) ?? []).toEqual([]);
  });
});
```
Run (จาก `apps/api`): `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-state.service.spec.ts src/modules/customer-journey/customer-journey.module.spec.ts --runInBand` → Expected: FAIL ทั้งสองไฟล์ `Cannot find module './journey-state.service'`

- [ ] **Step 3: เทสแดง — `journey-state.sql` บน Postgres จริง**

สร้าง `apps/api/src/modules/customer-journey/journey-state.service.db.spec.ts`:
```ts
import { Prisma, PrismaClient } from '@prisma/client';
import { JourneyStateService } from './journey-state.service';
import { journeyDedupeKey } from './journey-data-schemas';
import { BOUGHT_WHERE } from '../customers/services/customer-query.service';

/**
 * journey-state.sql กับ Postgres จริง (Plan 2 Task 3) — session timezone ของฐานทดสอบ = Asia/Bangkok จึงจับบั๊ก now()/timestamptz ได้
 * AuditLog ลบไม่ได้ (trigger audit_logs_no_delete) ⇒ ผู้ใช้ของ spec ถูกปล่อยไว้ ตามแบบ customer-merge.service.db.spec.ts
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest <ไฟล์นี้> --runInBand
 */
describe('JourneyStateService (real DB)', () => {
  const prisma = new PrismaClient();
  const service = new JourneyStateService(prisma as any);
  const stamp = Date.now();
  const tail = String(stamp).slice(-7);
  const at = (value: string) => new Date(value);
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const saleIds: string[] = [];
  const contractIds: string[] = [];
  const todoIds: string[] = [];
  let branchId: string;
  let productId: string;
  let userId: string;

  const stateOf = (customerId: string) => prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId } });
  const boughtLive = async (customerId: string) => (await prisma.customer.count({ where: { AND: [{ id: customerId }, BOUGHT_WHERE] } })) > 0;

  async function customer(data: Prisma.CustomerUncheckedCreateInput) {
    const row = await prisma.customer.create({ data });
    customerIds.push(row.id);
    return row;
  }
  async function room(customerId: string, label: string, createdAt: string, channel: 'FACEBOOK' | 'LINE_SHOP' = 'FACEBOOK') {
    const row = await prisma.chatRoom.create({ data: { channel, externalUserId: `journey-${label}-${stamp}`, customerId, createdAt: at(createdAt) } });
    roomIds.push(row.id);
    return row;
  }
  async function entry(customerId: string, kind: string, occurredAt: string, extra: Partial<Prisma.CustomerJourneyEntryUncheckedCreateInput> = {}) {
    await prisma.customerJourneyEntry.create({
      data: { customerId, originCustomerId: customerId, origin: 'MANUAL', kind, occurredAt: at(occurredAt), actorType: 'STAFF', ...extra },
    });
  }
  async function sale(customerId: string, saleType: 'CASH' | 'INSTALLMENT', createdAt: string, contractId: string | null = null) {
    const row = await prisma.sale.create({
      data: { saleNumber: `JS-${tail}-${saleIds.length}`, saleType, customerId, productId, branchId, salespersonId: userId, sellingPrice: 25000, netAmount: 25000, contractId, createdAt: at(createdAt) },
    });
    saleIds.push(row.id);
    return row;
  }
  async function contract(customerId: string, status: 'ACTIVE' | 'OVERDUE', createdAt: string) {
    const row = await prisma.contract.create({
      data: {
        contractNumber: `JC-${tail}-${contractIds.length}`, customerId, productId, branchId, salespersonId: userId, planType: 'STORE_WITH_INTEREST',
        sellingPrice: 25000, downPayment: 5000, interestRate: 0.02, totalMonths: 10, interestTotal: 4000, financedAmount: 20000, monthlyPayment: 2400,
        status, createdAt: at(createdAt),
      },
    });
    contractIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `journey spec ${stamp}` } })).id;
    userId = (await prisma.user.create({ data: { email: `journey-state-${stamp}@spec.local`, password: 'x', name: 'journey spec' } })).id;
    productId = (await prisma.product.create({ data: { name: 'journey spec phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: 20000, branchId } })).id;
  });

  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.todo.deleteMany({ where: { id: { in: todoIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.$disconnect();
  });

  it('ลูกค้าหน้าร้านมีเบอร์ → IDENTIFIED · ทักเข้ามา = created_at · WALK_IN · computedAt ไม่เลื่อน 7 ชม.', async () => {
    const c = await customer({ name: 'journey walkin', phone: `081${tail}`, createdAt: at('2026-09-01T03:00:00.000Z') });
    const before = Date.now();
    await service.recompute([c.id]);
    const s = await stateOf(c.id);
    expect(s).toMatchObject({ stage: 'IDENTIFIED', path: 'UNKNOWN', firstChannel: 'WALK_IN', firstSource: 'WALK_IN', lostAt: null, firstPurchaseAt: null });
    expect(s.contactedAt.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(s.identifiedAt?.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(s.stageEnteredAt.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(Math.abs(s.computedAt.getTime() - before)).toBeLessThan(60_000);
  });

  it('ผู้สนใจจากแชท: ทักเข้ามา = ข้อความลูกค้าแรก (รวมแถว soft-delete) ก่อนเวลาสร้างห้อง · ข้ามข้อความทักทายภายใน 60 วิ', async () => {
    const c = await customer({ name: 'journey chat', phone: null, acquisitionSource: 'CHAT_FACEBOOK', createdAt: at('2026-09-10T00:00:00.000Z') });
    const r = await room(c.id, 'chat', '2026-09-10T00:00:00.000Z');
    await prisma.chatMessage.createMany({
      data: [
        { roomId: r.id, role: 'CUSTOMER', createdAt: at('2026-09-05T02:00:00.000Z'), deletedAt: at('2026-09-12T00:00:00.000Z') },
        { roomId: r.id, role: 'STAFF', createdAt: at('2026-09-05T02:00:30.000Z'), outboundSentAt: at('2026-09-05T02:00:30.000Z') },
        { roomId: r.id, role: 'CUSTOMER', createdAt: at('2026-09-05T02:05:00.000Z') },
        { roomId: r.id, role: 'STAFF', createdAt: at('2026-09-05T03:10:00.000Z'), outboundSentAt: at('2026-09-05T03:10:00.000Z') },
        { roomId: r.id, role: 'CUSTOMER', createdAt: at('2026-09-11T09:00:00.000Z') },
      ],
    });
    await service.recompute([c.id]);
    const s = await stateOf(c.id);
    expect(s).toMatchObject({ stage: 'CONTACTED', firstChannel: 'CHAT_FACEBOOK', firstSource: 'CHAT_FACEBOOK', identifiedAt: null });
    expect(s.contactedAt.toISOString()).toBe('2026-09-05T02:00:00.000Z');
    expect(s.stageEnteredAt.toISOString()).toBe('2026-09-05T02:00:00.000Z');
    expect(s.firstStaffReplyAt?.toISOString()).toBe('2026-09-05T03:10:00.000Z');
    expect(s.lastCustomerAt?.toISOString()).toBe('2026-09-11T09:00:00.000Z');
  });

  it('ทักเข้ามาแช่แข็ง: ห้องถูกนำเข้าใหม่ (created_at ใหม่กว่า ไม่มีข้อความ) → คำนวณใหม่ไม่เลื่อนไปข้างหลัง · CONTACT_ADDED → IDENTIFIED', async () => {
    const c = await customer({ name: 'journey frozen', phone: null, acquisitionSource: 'CHAT_LINE_SHOP', createdAt: at('2026-08-01T00:00:00.000Z') });
    const r = await room(c.id, 'frozen', '2026-08-01T00:00:00.000Z', 'LINE_SHOP');
    await service.recompute([c.id]);
    await prisma.chatRoom.update({ where: { id: r.id }, data: { createdAt: at('2026-09-01T00:00:00.000Z') } });
    await entry(c.id, 'CONTACT_ADDED', '2026-09-02T00:00:00.000Z', { origin: 'SYSTEM', dedupeKey: journeyDedupeKey('CONTACT_ADDED', c.id, 'phone') });
    await service.recompute([c.id]);
    const s = await stateOf(c.id);
    expect(s.contactedAt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(s).toMatchObject({ stage: 'IDENTIFIED', firstChannel: 'CHAT_LINE_SHOP' });
    expect(s.identifiedAt?.toISOString()).toBe('2026-09-02T00:00:00.000Z');
  });

  it('HEARD_FROM ยกที่มาจาก WALK_IN · MARKED_LOST ติดป้าย · TOUCHPOINT หลังหลุดล้างป้าย', async () => {
    const c = await customer({ name: 'journey lost', phone: null, createdAt: at('2026-09-01T00:00:00.000Z') });
    await service.recompute([c.id]);
    expect((await stateOf(c.id)).firstSource).toBe('WALK_IN');
    await entry(c.id, 'HEARD_FROM', '2026-09-01T01:00:00.000Z', { heardFrom: 'FRIEND' });
    await entry(c.id, 'MARKED_LOST', '2026-09-03T00:00:00.000Z', { lostReason: 'UNREACHABLE' });
    await service.recompute([c.id]);
    const lost = await stateOf(c.id);
    expect(lost).toMatchObject({ firstSource: 'HEARD:FRIEND', heardFrom: 'FRIEND', lostReason: 'UNREACHABLE', stage: 'CONTACTED' });
    expect(lost.lostAt?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    await entry(c.id, 'TOUCHPOINT', '2026-09-04T00:00:00.000Z', { channel: 'PHONE', outcome: 'THINKING' });
    await service.recompute([c.id]);
    const back = await stateOf(c.id);
    expect(back).toMatchObject({ lostAt: null, lostReason: null, stage: 'CONTACTED' });
    expect(back.lastTouchAt?.toISOString()).toBe('2026-09-04T00:00:00.000Z');
  });

  it('นัด (todo ในห้อง) → INTERESTED · ใบตรวจเครดิต → CREDIT/INSTALLMENT · ใบขายสด → PURCHASED/CASH ตรงกับ BOUGHT_WHERE · ยกเลิกใบขาย → ถอยกลับ', async () => {
    const c = await customer({ name: 'journey buyer', phone: `082${tail}`, createdAt: at('2026-09-01T00:00:00.000Z') });
    const r = await room(c.id, 'buyer', '2026-09-01T01:00:00.000Z');
    const todo = await prisma.todo.create({ data: { title: 'นัดดูเครื่อง', createdById: userId, roomId: r.id, dueDate: at('2026-09-06T03:00:00.000Z'), createdAt: at('2026-09-02T00:00:00.000Z') } });
    todoIds.push(todo.id);
    await prisma.creditCheck.create({ data: { customerId: c.id, createdAt: at('2026-09-03T00:00:00.000Z') } });
    await service.recompute([c.id]);
    const credit = await stateOf(c.id);
    expect(credit).toMatchObject({ stage: 'CREDIT', path: 'INSTALLMENT' });
    expect(credit.interestedAt?.toISOString()).toBe('2026-09-02T00:00:00.000Z');
    expect(credit.stageEnteredAt.toISOString()).toBe('2026-09-03T00:00:00.000Z');

    const parityBefore = await service.purchasedParity();
    const cash = await sale(c.id, 'CASH', '2026-09-04T00:00:00.000Z');
    await service.recompute([c.id]);
    const bought = await stateOf(c.id);
    expect(bought).toMatchObject({ stage: 'PURCHASED', path: 'CASH', firstPurchaseKind: 'CASH' });
    expect(bought.firstPurchaseAt?.toISOString()).toBe('2026-09-04T00:00:00.000Z');
    expect(await boughtLive(c.id)).toBe(true);
    expect(await service.purchasedParity()).toEqual({ purchasedStates: parityBefore.purchasedStates + 1, bought: parityBefore.bought + 1 });

    await prisma.sale.update({ where: { id: cash.id }, data: { deletedAt: at('2026-09-05T00:00:00.000Z') } });
    await service.recompute([c.id]);
    expect(await stateOf(c.id)).toMatchObject({ stage: 'CREDIT', firstPurchaseAt: null, firstPurchaseKind: null, path: 'INSTALLMENT' });
    expect(await boughtLive(c.id)).toBe(false);
  });

  it('สัญญาผ่อน: firstPurchaseAt = entry CONTRACT_ACTIVATED ถ้าเก่ากว่าใบขาย · สัญญาที่ไม่มี entry ใช้เวลาใบขาย', async () => {
    const c = await customer({ name: 'journey installment', phone: `083${tail}`, createdAt: at('2031-01-01T00:00:00.000Z') });
    const k1 = await contract(c.id, 'ACTIVE', '2031-01-01T01:00:00.000Z');
    const k2 = await contract(c.id, 'OVERDUE', '2031-01-01T02:00:00.000Z');
    await sale(c.id, 'INSTALLMENT', '2031-01-01T05:00:00.000Z', k1.id);
    await sale(c.id, 'INSTALLMENT', '2031-01-01T06:00:00.000Z', k2.id);
    await entry(c.id, 'CONTRACT_ACTIVATED', '2031-01-01T04:59:00.000Z', { origin: 'SYSTEM', refType: 'contract', refId: k1.id, dedupeKey: journeyDedupeKey('CONTRACT_ACTIVATED', k1.id) });
    await service.recompute([c.id]);
    const s = await stateOf(c.id);
    expect(s).toMatchObject({ stage: 'PURCHASED', path: 'INSTALLMENT', firstPurchaseKind: 'INSTALLMENT' });
    expect(s.firstPurchaseAt?.toISOString()).toBe('2031-01-01T04:59:00.000Z');
  });

  it('placeholder ที่รวมแล้ว: ห้อง/AI_LEAD_CAPTURED ขึ้นใต้คนจริง · ไม่มีแคชของ placeholder', async () => {
    const target = await customer({ name: 'journey target', phone: `084${tail}`, createdAt: at('2026-09-08T00:00:00.000Z') });
    const placeholder = await customer({
      name: 'journey placeholder', phone: null, acquisitionSource: 'CHAT_LINE_SHOP', createdAt: at('2026-09-02T00:00:00.000Z'),
      deletedAt: at('2026-09-09T00:00:00.000Z'), mergedIntoId: target.id,
    });
    await room(target.id, 'merged', '2026-09-02T00:00:00.000Z', 'LINE_SHOP');
    await prisma.auditLog.create({ data: { userId, action: 'AI_LEAD_CAPTURED', entity: 'customer', entityId: placeholder.id, createdAt: at('2026-09-03T05:00:00.000Z') } });
    await service.recompute([target.id, placeholder.id]);
    const s = await stateOf(target.id);
    expect(s).toMatchObject({ stage: 'INTERESTED', firstChannel: 'CHAT_LINE_SHOP', firstSource: 'CHAT_LINE_SHOP' });
    expect(s.contactedAt.toISOString()).toBe('2026-09-02T00:00:00.000Z');
    expect(s.interestedAt?.toISOString()).toBe('2026-09-03T05:00:00.000Z');
    expect(s.identifiedAt?.toISOString()).toBe('2026-09-08T00:00:00.000Z');
    expect(await prisma.customerJourneyState.count({ where: { customerId: placeholder.id } })).toBe(0);
  });

  it('ลูกค้าที่ถูกลบ/ถูกรวมแล้ว: recompute ไม่สร้างแคชและลบแคชเดิม · id ว่าง/ซ้ำไม่พัง (สัญญาที่ Task 4 พึ่ง)', async () => {
    const c = await customer({ name: 'journey removed', phone: null, createdAt: at('2026-09-01T00:00:00.000Z') });
    await service.recompute([c.id]);
    expect(await prisma.customerJourneyState.count({ where: { customerId: c.id } })).toBe(1);
    await prisma.customer.update({ where: { id: c.id }, data: { deletedAt: at('2026-09-02T00:00:00.000Z') } });
    await service.recompute([c.id, c.id, '']);
    expect(await prisma.customerJourneyState.count({ where: { customerId: c.id } })).toBe(0);
    await expect(service.recompute([])).resolves.toBeUndefined();
  });
});
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-state.service.db.spec.ts --runInBand` → Expected: FAIL `Cannot find module './journey-state.service'`

- [ ] **Step 4: export `BOUGHT_WHERE` + SQL + `JourneyStateService` + โมดูล + asset**

(4.1) `apps/api/src/modules/customers/services/customer-query.service.ts:43` เปลี่ยน `const BOUGHT_WHERE: Prisma.CustomerWhereInput = {` เป็น:
```ts
export const BOUGHT_WHERE: Prisma.CustomerWhereInput = {
```

(4.2) สร้าง `apps/api/src/modules/customer-journey/sql/journey-state.sql`:
```sql
-- journey-state.sql — คำนวณแคช customer_journey_states ใหม่ทั้งแถวของลูกค้าชุดหนึ่ง (recompute / cron / CLI backfill ใช้ไฟล์เดียวนี้)
-- $1 text[] id ลูกค้า (แถวที่ถูกลบถูกข้าม) · $2 text[] CUSTOMER_BOUGHT_CONTRACT_STATUSES · $3 text[] CUSTOMER_BOUGHT_SALE_TYPES · $4 text เวลาคำนวณ ISO UTC
-- 🚨 คอลัมน์เวลาเป็น timestamp without time zone เก็บ UTC และ session อาจเป็น Asia/Bangkok ⇒ ห้าม now()/timestamptz
-- 🚨 PDPA: ไม่อ่าน content ของ chat_messages / note ของ entries · phone, national_id ใช้แค่ IS NOT NULL
WITH target AS (
  SELECT c.id, c.created_at, c.updated_at, c.acquisition_source, c.referred_by_id,
         (c.phone IS NOT NULL OR c.national_id IS NOT NULL) AS has_contact,
         CASE WHEN left(c.acquisition_source, 5) = 'CHAT_' THEN NULL ELSE c.created_at END AS walk_in_at
  FROM customers c
  WHERE c.id = ANY($1::text[]) AND c.deleted_at IS NULL
),
family AS (
  SELECT t.id AS customer_id, t.id AS member_id FROM target t
  UNION ALL
  SELECT m.merged_into_id, m.id FROM customers m JOIN target t ON m.merged_into_id = t.id
),
rooms AS (
  SELECT f.customer_id, r.id AS room_id, r.channel::text AS channel, r.created_at, r.attribution_id,
         cm.first_customer_at, cm.last_customer_at
  FROM family f
  JOIN chat_rooms r ON r.customer_id = f.member_id
  LEFT JOIN LATERAL (
    SELECT MIN(m.created_at) AS first_customer_at, MAX(m.created_at) AS last_customer_at
    FROM chat_messages m
    WHERE m.room_id = r.id AND m.role = 'CUSTOMER'
  ) cm ON true
),
earliest_room AS (
  SELECT DISTINCT ON (ro.customer_id)
         ro.customer_id, ro.channel, LEAST(ro.created_at, ro.first_customer_at) AS first_at,
         ac.id AS ad_campaign_id, ac.campaign_id AS ad_platform_campaign_id
  FROM rooms ro
  LEFT JOIN ads_attributions aa ON aa.id = ro.attribution_id
  LEFT JOIN ads_campaigns ac ON ac.id = aa.campaign_id
  ORDER BY ro.customer_id, LEAST(ro.created_at, ro.first_customer_at), ro.room_id
),
room_agg AS (
  SELECT ro.customer_id, MAX(ro.last_customer_at) AS last_customer_at FROM rooms ro GROUP BY ro.customer_id
),
staff_reply AS (
  -- กติกาเดียวกับ RoomManagerService.shouldSkipFirstOutboundClear: คำตอบใบแรกของห้องที่ออกภายใน 60 วินาทีหลังข้อความลูกค้า = ข้อความทักทาย
  SELECT ro.customer_id, MIN(m.created_at) AS first_staff_reply_at
  FROM rooms ro
  JOIN chat_messages m ON m.room_id = ro.room_id AND m.role = 'STAFF' AND m.outbound_sent_at IS NOT NULL
  WHERE NOT (
    NOT EXISTS (
      SELECT 1 FROM chat_messages p
      WHERE p.room_id = m.room_id AND p.role IN ('STAFF', 'BOT') AND (p.created_at, p.id) < (m.created_at, m.id)
    )
    AND EXISTS (
      SELECT 1 FROM chat_messages c
      WHERE c.room_id = m.room_id AND c.role = 'CUSTOMER'
        AND c.created_at <= m.created_at AND c.created_at >= m.created_at - interval '60 seconds'
    )
  )
  GROUP BY ro.customer_id
),
entry_agg AS (
  SELECT e.customer_id,
         MIN(e.occurred_at) FILTER (WHERE e.kind IN ('CONTACT_ADDED', 'LINE_LINKED', 'PLACEHOLDER_MERGED')) AS identified_entry_at,
         MIN(e.occurred_at) FILTER (WHERE e.kind = 'TOUCHPOINT' AND e.outcome IN ('APPOINTED', 'VISITED')) AS manual_interest_at,
         MAX(e.occurred_at) FILTER (WHERE e.kind = 'TOUCHPOINT') AS last_touch_at
  FROM customer_journey_entries e
  JOIN target t ON t.id = e.customer_id
  WHERE e.deleted_at IS NULL
  GROUP BY e.customer_id
),
activated AS (
  SELECT e.customer_id, MIN(e.occurred_at) AS at
  FROM customer_journey_entries e
  JOIN target t ON t.id = e.customer_id
  JOIN contracts k ON k.id = e.ref_id AND k.deleted_at IS NULL
  WHERE e.kind = 'CONTRACT_ACTIVATED' AND e.deleted_at IS NULL
  GROUP BY e.customer_id
),
heard AS (
  SELECT DISTINCT ON (e.customer_id) e.customer_id, e.heard_from
  FROM customer_journey_entries e
  JOIN target t ON t.id = e.customer_id
  WHERE e.kind = 'HEARD_FROM' AND e.deleted_at IS NULL AND e.heard_from IS NOT NULL
  ORDER BY e.customer_id, e.occurred_at DESC, e.id DESC
),
lost_mark AS (
  SELECT DISTINCT ON (e.customer_id) e.customer_id, e.kind, e.occurred_at, e.lost_reason
  FROM customer_journey_entries e
  JOIN target t ON t.id = e.customer_id
  WHERE e.kind IN ('MARKED_LOST', 'REOPENED') AND e.deleted_at IS NULL
  ORDER BY e.customer_id, e.occurred_at DESC, e.id DESC
),
line_agg AS (
  SELECT f.customer_id, MIN(l.linked_at) AS linked_at
  FROM family f JOIN customer_line_links l ON l.customer_id = f.member_id
  WHERE l.unlinked_at IS NULL AND l.deleted_at IS NULL
  GROUP BY f.customer_id
),
merged_agg AS (
  SELECT m.merged_into_id AS customer_id, MIN(m.deleted_at) AS merged_at
  FROM customers m JOIN target t ON t.id = m.merged_into_id
  GROUP BY m.merged_into_id
),
interest_agg AS (
  SELECT f.customer_id, MIN(x.at) AS at
  FROM family f
  CROSS JOIN LATERAL (
    SELECT b.created_at AS at FROM bookings b WHERE b.customer_id = f.member_id AND b.deleted_at IS NULL
    UNION ALL
    SELECT a.created_at FROM online_installment_applications a WHERE a.customer_id = f.member_id AND a.deleted_at IS NULL
    UNION ALL
    SELECT pr.reserved_at FROM product_reservations pr WHERE pr.customer_id = f.member_id
    UNION ALL
    SELECT ti.created_at FROM trade_ins ti WHERE ti.customer_id = f.member_id AND ti.deleted_at IS NULL
    UNION ALL
    SELECT al.created_at FROM audit_logs al WHERE al.entity = 'customer' AND al.entity_id = f.member_id AND al.action = 'AI_LEAD_CAPTURED'
  ) x
  GROUP BY f.customer_id
),
todo_agg AS (
  SELECT ro.customer_id, MIN(td.created_at) AS at
  FROM rooms ro JOIN todos td ON td.room_id = ro.room_id
  WHERE td.due_date IS NOT NULL AND td.deleted_at IS NULL
  GROUP BY ro.customer_id
),
credit_agg AS (
  SELECT f.customer_id, MIN(x.at) AS at
  FROM family f
  CROSS JOIN LATERAL (
    SELECT cc.created_at AS at FROM credit_checks cc WHERE cc.customer_id = f.member_id AND cc.deleted_at IS NULL
    UNION ALL
    SELECT k.created_at FROM contracts k WHERE k.customer_id = f.member_id AND k.deleted_at IS NULL
  ) x
  GROUP BY f.customer_id
),
room_credit_agg AS (
  SELECT ro.customer_id, MIN(rca.created_at) AS at
  FROM rooms ro JOIN room_credit_analyses rca ON rca.room_id = ro.room_id
  WHERE rca.status = 'COMPLETED' AND rca.deleted_at IS NULL
  GROUP BY ro.customer_id
),
purchase AS (
  -- predicate เดียวกับ BOUGHT_WHERE (customer-query.service.ts) — รายการสถานะฉีดจาก @installment/shared
  SELECT t.id AS customer_id,
         (EXISTS (SELECT 1 FROM contracts k WHERE k.customer_id = t.id AND k.deleted_at IS NULL AND k.status::text = ANY($2::text[]))
          OR EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = t.id AND s.deleted_at IS NULL AND s.sale_type::text = ANY($3::text[]))) AS bought,
         (SELECT MIN(s.created_at) FROM sales s
           WHERE s.customer_id = t.id AND s.deleted_at IS NULL AND s.sale_type = 'CASH' AND s.sale_type::text = ANY($3::text[])) AS cash_at,
         (SELECT MIN(s.created_at) FROM sales s
           WHERE s.customer_id = t.id AND s.deleted_at IS NULL AND s.sale_type = 'EXTERNAL_FINANCE' AND s.sale_type::text = ANY($3::text[])) AS external_at,
         (SELECT MIN(s.created_at) FROM sales s JOIN contracts k ON k.id = s.contract_id AND k.deleted_at IS NULL
           WHERE s.customer_id = t.id AND s.deleted_at IS NULL AND s.sale_type = 'INSTALLMENT') AS installment_sale_at,
         (SELECT MIN(k.created_at) FROM contracts k
           WHERE k.customer_id = t.id AND k.deleted_at IS NULL AND k.status::text = ANY($2::text[])) AS bought_contract_at
  FROM target t
),
base AS (
  SELECT t.id AS customer_id,
         COALESCE(LEAST(er.first_at, t.walk_in_at), t.created_at) AS contacted_at,
         (er.first_at IS NOT NULL AND (t.walk_in_at IS NULL OR er.first_at <= t.walk_in_at)) AS chat_first,
         er.channel AS first_room_channel, er.ad_campaign_id, er.ad_platform_campaign_id,
         t.acquisition_source, t.referred_by_id,
         CASE WHEN t.has_contact OR la.linked_at IS NOT NULL OR ma.merged_at IS NOT NULL OR ea.identified_entry_at IS NOT NULL
              THEN LEAST(ea.identified_entry_at,
                         CASE WHEN t.has_contact THEN COALESCE(t.walk_in_at, t.updated_at) END,
                         la.linked_at, ma.merged_at)
         END AS identified_at,
         LEAST(ia.at, ta.at, ea.manual_interest_at) AS interested_at,
         LEAST(ca.at, rca.at) AS credit_at,
         p.bought, p.cash_at, p.external_at,
         COALESCE(LEAST(act.at, p.installment_sale_at), p.bought_contract_at) AS installment_at,
         sr.first_staff_reply_at, ra.last_customer_at, ea.last_touch_at, h.heard_from,
         lm.kind AS lost_kind, lm.occurred_at AS lost_mark_at, lm.lost_reason AS lost_mark_reason
  FROM target t
  JOIN purchase p ON p.customer_id = t.id
  LEFT JOIN earliest_room er ON er.customer_id = t.id
  LEFT JOIN room_agg ra ON ra.customer_id = t.id
  LEFT JOIN staff_reply sr ON sr.customer_id = t.id
  LEFT JOIN entry_agg ea ON ea.customer_id = t.id
  LEFT JOIN activated act ON act.customer_id = t.id
  LEFT JOIN heard h ON h.customer_id = t.id
  LEFT JOIN lost_mark lm ON lm.customer_id = t.id
  LEFT JOIN line_agg la ON la.customer_id = t.id
  LEFT JOIN merged_agg ma ON ma.customer_id = t.id
  LEFT JOIN interest_agg ia ON ia.customer_id = t.id
  LEFT JOIN todo_agg ta ON ta.customer_id = t.id
  LEFT JOIN credit_agg ca ON ca.customer_id = t.id
  LEFT JOIN room_credit_agg rca ON rca.customer_id = t.id
),
shaped AS (
  SELECT b.*,
         CASE WHEN b.bought THEN LEAST(b.cash_at, b.external_at, b.installment_at) END AS first_purchase_at,
         CASE WHEN NOT b.bought THEN NULL
              WHEN b.installment_at IS NOT NULL AND b.installment_at <= COALESCE(LEAST(b.cash_at, b.external_at), b.installment_at) THEN 'INSTALLMENT'
              WHEN b.cash_at IS NOT NULL AND b.cash_at <= COALESCE(b.external_at, b.cash_at) THEN 'CASH'
              ELSE 'EXTERNAL_FINANCE' END AS first_purchase_kind,
         CASE WHEN b.chat_first THEN 'CHAT_' || b.first_room_channel
              WHEN left(b.acquisition_source, 5) = 'CHAT_' THEN left(b.acquisition_source, 20)
              WHEN b.referred_by_id IS NOT NULL THEN 'REFERRAL'
              ELSE 'WALK_IN' END AS first_channel,
         CASE WHEN b.chat_first THEN b.ad_campaign_id END AS first_ad_campaign_id
  FROM base b
),
resolved AS (
  SELECT s.*,
         CASE WHEN s.first_ad_campaign_id IS NOT NULL THEN left('AD:' || s.ad_platform_campaign_id, 30)
              WHEN left(s.first_channel, 5) = 'CHAT_' THEN s.first_channel
              WHEN s.referred_by_id IS NOT NULL THEN 'REFERRAL'
              WHEN s.heard_from IS NOT NULL THEN left('HEARD:' || s.heard_from, 30)
              ELSE 'WALK_IN' END AS first_source,
         CASE WHEN s.bought THEN 'PURCHASED'
              WHEN s.credit_at IS NOT NULL THEN 'CREDIT'
              WHEN s.interested_at IS NOT NULL THEN 'INTERESTED'
              WHEN s.identified_at IS NOT NULL THEN 'IDENTIFIED'
              ELSE 'CONTACTED' END AS stage,
         CASE WHEN s.bought THEN s.first_purchase_kind
              WHEN s.credit_at IS NOT NULL THEN 'INSTALLMENT'
              ELSE 'UNKNOWN' END AS path,
         CASE WHEN s.lost_kind = 'MARKED_LOST' AND NOT s.bought
                   AND (s.last_customer_at IS NULL OR s.last_customer_at <= s.lost_mark_at)
                   AND (s.last_touch_at IS NULL OR s.last_touch_at <= s.lost_mark_at)
              THEN s.lost_mark_at END AS lost_at
  FROM shaped s
)
INSERT INTO customer_journey_states (
  customer_id, stage, stage_entered_at, path, contacted_at, identified_at, interested_at, credit_at,
  first_purchase_at, first_purchase_kind, first_staff_reply_at, first_channel, first_source, first_ad_campaign_id,
  heard_from, last_customer_at, last_touch_at, lost_at, lost_reason, computed_at
)
SELECT r.customer_id, r.stage,
       CASE r.stage WHEN 'PURCHASED' THEN r.first_purchase_at WHEN 'CREDIT' THEN r.credit_at
                    WHEN 'INTERESTED' THEN r.interested_at WHEN 'IDENTIFIED' THEN r.identified_at
                    ELSE r.contacted_at END,
       r.path, r.contacted_at, r.identified_at, r.interested_at, r.credit_at,
       r.first_purchase_at, r.first_purchase_kind, r.first_staff_reply_at, r.first_channel, r.first_source, r.first_ad_campaign_id,
       r.heard_from, r.last_customer_at, r.last_touch_at, r.lost_at,
       CASE WHEN r.lost_at IS NOT NULL THEN r.lost_mark_reason END,
       $4::timestamp
FROM resolved r
ON CONFLICT (customer_id) DO UPDATE SET
  -- แช่แข็ง: เวลาเริ่มต้นไม่มีทางเลื่อนไปข้างหลัง (ข้อความ retention/ห้องนำเข้าใหม่/merge)
  contacted_at = LEAST(customer_journey_states.contacted_at, EXCLUDED.contacted_at),
  identified_at = LEAST(customer_journey_states.identified_at, EXCLUDED.identified_at),
  first_staff_reply_at = LEAST(customer_journey_states.first_staff_reply_at, EXCLUDED.first_staff_reply_at),
  stage_entered_at = CASE EXCLUDED.stage
    WHEN 'CONTACTED' THEN LEAST(customer_journey_states.contacted_at, EXCLUDED.contacted_at)
    WHEN 'IDENTIFIED' THEN LEAST(customer_journey_states.identified_at, EXCLUDED.identified_at)
    ELSE EXCLUDED.stage_entered_at END,
  first_channel = CASE WHEN EXCLUDED.contacted_at < customer_journey_states.contacted_at
    THEN EXCLUDED.first_channel ELSE customer_journey_states.first_channel END,
  first_ad_campaign_id = CASE WHEN EXCLUDED.contacted_at < customer_journey_states.contacted_at
    THEN EXCLUDED.first_ad_campaign_id ELSE customer_journey_states.first_ad_campaign_id END,
  first_source = CASE
    WHEN EXCLUDED.contacted_at < customer_journey_states.contacted_at THEN EXCLUDED.first_source
    -- ชั้น "ลูกค้าบอก/หน้าร้าน" อัปเดตได้เมื่อจุดเริ่มเดิม (HEARD_FROM มาทีหลังได้)
    WHEN (customer_journey_states.first_source IN ('WALK_IN', 'REFERRAL') OR customer_journey_states.first_source LIKE 'HEARD:%')
     AND (EXCLUDED.first_source IN ('WALK_IN', 'REFERRAL') OR EXCLUDED.first_source LIKE 'HEARD:%')
    THEN EXCLUDED.first_source
    ELSE customer_journey_states.first_source END,
  stage = EXCLUDED.stage,
  path = EXCLUDED.path,
  interested_at = EXCLUDED.interested_at,
  credit_at = EXCLUDED.credit_at,
  first_purchase_at = EXCLUDED.first_purchase_at,
  first_purchase_kind = EXCLUDED.first_purchase_kind,
  heard_from = EXCLUDED.heard_from,
  last_customer_at = EXCLUDED.last_customer_at,
  last_touch_at = EXCLUDED.last_touch_at,
  lost_at = EXCLUDED.lost_at,
  lost_reason = EXCLUDED.lost_reason,
  computed_at = EXCLUDED.computed_at
```

(4.3) สร้าง `apps/api/src/modules/customer-journey/journey-state.service.ts`:
```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { CUSTOMER_BOUGHT_CONTRACT_STATUSES, CUSTOMER_BOUGHT_SALE_TYPES } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { BOUGHT_WHERE } from '../customers/services/customer-query.service';

const RECOMPUTE_BATCH = 500;
/** ไฟล์ SQL ถูกคัดลอกเข้า dist ผ่าน nest-cli.json assets และตรวจใน verify:assets */
const loadSql = (name: string) => readFileSync(join(__dirname, 'sql', name), 'utf8');

/**
 * แคช customer_journey_states — คำนวณได้ใหม่ทั้งหมดจากตารางต้นทาง ห้ามแก้มือ
 * ผู้เรียก: CustomerMergeService หลัง commit (Task 4) · JourneySummaryService ในคำขอ + CustomerJourneyCron (Task 9) · CLI backfill (Task 10)
 * สัญญา: ลูกค้าที่ deleted_at ไม่ว่าง (รวมผู้สนใจที่ถูกรวมแล้ว) ไม่มีแคชของตัวเองเสมอ · contactedAt/firstChannel/firstSource/firstAdCampaignId
 * เลื่อนได้เฉพาะไปค่าที่เก่ากว่า (ON CONFLICT ใน journey-state.sql)
 */
@Injectable()
export class JourneyStateService {
  private readonly stateSql = loadSql('journey-state.sql');

  constructor(private readonly prisma: PrismaService) {}

  async recompute(customerIds: string[]): Promise<void> {
    const ids = [...new Set(customerIds.filter(Boolean))];
    const computedAt = new Date().toISOString();
    for (let i = 0; i < ids.length; i += RECOMPUTE_BATCH) {
      const batch = ids.slice(i, i + RECOMPUTE_BATCH);
      await this.prisma.$executeRawUnsafe(
        this.stateSql,
        batch,
        [...CUSTOMER_BOUGHT_CONTRACT_STATUSES],
        [...CUSTOMER_BOUGHT_SALE_TYPES],
        computedAt,
      );
      // placeholder ที่รวมแล้ว / ลูกค้าที่ถูกลบ ไม่มีแคชของตัวเอง
      await this.prisma.customerJourneyState.deleteMany({
        where: { customerId: { in: batch }, customer: { deletedAt: { not: null } } },
      });
    }
  }

  /** ทุกลูกค้าที่ยังไม่ถูกลบ ทีละ 500 (keyset ตาม id) — cron วันอาทิตย์ของ Task 9 */
  async recomputeAll(): Promise<number> {
    let total = 0;
    let cursor: string | undefined;
    let more = true;
    while (more) {
      const rows = await this.prisma.customer.findMany({
        where: { deletedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: RECOMPUTE_BATCH,
        select: { id: true },
      });
      if (rows.length > 0) {
        await this.recompute(rows.map((row) => row.id));
        total += rows.length;
        cursor = rows[rows.length - 1].id;
      }
      more = rows.length === RECOMPUTE_BATCH;
    }
    return total;
  }

  /** ด่านความถูกต้อง: แคช PURCHASED ต้องเท่ากับจำนวนลูกค้าที่ BOUGHT_WHERE เป็นจริง */
  async purchasedParity(): Promise<{ purchasedStates: number; bought: number }> {
    const [purchasedStates, bought] = await Promise.all([
      this.prisma.customerJourneyState.count({ where: { stage: 'PURCHASED', customer: { deletedAt: null } } }),
      this.prisma.customer.count({ where: { AND: [{ deletedAt: null }, BOUGHT_WHERE] } }),
    ]);
    return { purchasedStates, bought };
  }
}
```

(4.4) เขียนทับ `apps/api/src/modules/customer-journey/customer-journey.module.ts` ทั้งไฟล์:
```ts
import { Module } from '@nestjs/common';
import { JourneyEntryWriter } from './journey-entry-writer.service';
import { JourneyStateService } from './journey-state.service';

/**
 * การเดินทางของลูกค้า — ไม่ import โมดูลอื่น (PrismaModule เป็น @Global)
 * ⇒ ChatProspectsModule (CustomerMergeService) และโมดูลที่มี hook import โมดูลนี้ได้โดยไม่เกิดวงจร
 * Task 8 เพิ่ม CustomerJourneyService + controller · Task 9 เพิ่ม JourneySummaryService + CustomerJourneyCron
 */
@Module({
  providers: [JourneyEntryWriter, JourneyStateService],
  exports: [JourneyEntryWriter, JourneyStateService],
})
export class CustomerJourneyModule {}
```

(4.5) `apps/api/nest-cli.json` บรรทัด 13 เปลี่ยนเป็นสองบรรทัด:
```json
      { "include": "assets/fonts/*.{ttf,otf,woff2}", "outDir": "dist/src" },
      { "include": "modules/customer-journey/sql/*.sql", "outDir": "dist/src" }
```

(4.6) `apps/api/package.json` บรรทัด 8 แทนทั้งบรรทัดด้วย:
```json
    "verify:assets": "node -e \"const fs=require('fs');for(const f of ['dist/src/modules/contracts/templates/hire-purchase-contract.html','dist/src/modules/customer-journey/sql/journey-state.sql']){if(!fs.existsSync(f)){console.error('❌ Missing critical asset:',f);process.exit(1)}}console.log('✓ Assets verified')\"",
```

Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-state.service.spec.ts src/modules/customer-journey/customer-journey.module.spec.ts src/modules/customer-journey/journey-state.service.db.spec.ts --runInBand` → Expected: `Test Suites: 3 passed, 3 total` · `Tests: 12 passed, 12 total` (unit 3 · DI 1 · db 8)

- [ ] **Step 5: ตรวจทั้งโมดูล + typecheck + lint + build asset**

Run (จาก `apps/api`):
- `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey src/modules/customers/services --runInBand` → Expected: PASS ทุก suite · ในโฟลเดอร์ customer-journey ได้ `Tests: 30 passed` (Task 1 = 4 · Task 2 = 14 · Task นี้ = 12)
- `npx tsc --noEmit -p tsconfig.json` → Expected: 0 error
- `npx eslint src/modules/customer-journey/journey-state.service.ts src/modules/customer-journey/journey-state.service.spec.ts src/modules/customer-journey/journey-state.service.db.spec.ts src/modules/customer-journey/customer-journey.module.ts src/modules/customer-journey/customer-journey.module.spec.ts src/modules/customers/services/customer-query.service.ts` → Expected: 0 error (🚨 ห้าม `npm run lint`)
- `npm run build` → Expected: จบด้วย `✓ Assets verified` · `ls dist/src/modules/customer-journey/sql` แสดง `journey-state.sql`

- [ ] **Step 6: Commit**

Run (จาก root worktree):
```bash
git add apps/api/src/modules/customer-journey/sql/journey-state.sql apps/api/src/modules/customer-journey/journey-state.service.ts apps/api/src/modules/customer-journey/journey-state.service.spec.ts apps/api/src/modules/customer-journey/journey-state.service.db.spec.ts apps/api/src/modules/customer-journey/customer-journey.module.ts apps/api/src/modules/customer-journey/customer-journey.module.spec.ts apps/api/src/modules/customers/services/customer-query.service.ts apps/api/nest-cli.json apps/api/package.json
git commit -m "feat(customer-journey): แคชขั้นการเดินทาง journey-state.sql + JourneyStateService.recompute และโมดูล export ตัวคำนวณแคช

- ขั้นซื้อแล้วใช้ BOUGHT_WHERE ตัวเดียวกับหน้ารายชื่อ (export ออกมา ไม่ลอกซ้ำ)
- จุดเริ่มต้นการเดินทางแช่แข็ง เลื่อนได้เฉพาะไปค่าที่เก่ากว่า · ลูกค้าที่ถูกลบ/ถูกรวมไม่มีแคช

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

---

### Task 4: API รวมผู้สนใจแล้วการเดินทางไม่หาย — `absorbPlaceholder` ย้ายบันทึก · ยุบ chain · `merged_into_id` · `PLACEHOLDER_MERGED` ใน tx · แช่แข็งจุดเริ่มต้น · recompute หลัง commit

ทุกทางที่รวมผู้สนใจเข้าลูกค้าผ่าน `CustomerMergeService.absorbPlaceholder` ทางเดียว: ผูกห้อง (`RoomManagerService.linkCustomer`), `POST /customers/:id/absorb-into/:targetId`, รวมห้องแชท (`session-ops`, `allowPlaceholderTarget`), `absorbRoomsOfLineUser` (OTP/LIFF/พิมพ์เบอร์ใน LINE ร้าน) และ `chat-room.service` จึงแก้ที่เดียวแล้วครอบทุกทาง ลำดับงานในทรานแซกชันเดิมยึดตาม synthesis `mergeSurvival` ข้อ 1-6

> **ข้อค้นพบก่อนเริ่ม (ตรวจ 2026-09-15):** บน `bc_journey_test` เทส R12 เดิมใน `customer-merge.service.db.spec.ts` **แดงอยู่แล้ว** เพราะฐานนี้ไม่มีแถว `users.is_system_user = true` (ส่วน unit spec เขียวครบ) Step 1 จึงต้อง seed system user ก่อน baseline จึงจะเขียว

**Files:**
- Modify: `apps/api/src/modules/chat-prospects/customer-merge.service.ts`
  - import: แทรกหลังบรรทัด 13
  - `earliest()`: เพิ่มหลังบรรทัด 40
  - doc ของคลาส: บรรทัด 45-46
  - constructor: บรรทัด 53
  - ใน tx: แทรกหลัง `adsAttribution.updateMany` บรรทัด 162
  - soft-delete: บรรทัด 201
  - recompute: แทรกหลังบล็อก audit บรรทัด 214-228 ก่อน `this.logger.log` บรรทัด 229
  - `freezeJourneyOrigin()`: เมธอดใหม่ ต่อจาก `}` ที่ปิด `absorbPlaceholder` บรรทัด 233
- Modify: `apps/api/src/modules/chat-prospects/chat-prospects.module.ts:1-11` (import `CustomerJourneyModule`)
- Modify: `apps/api/src/modules/line-oa/line-oa.module.ts:49` (คอมเมนต์ "ChatProspectsModule ไม่ import โมดูลอื่นเลย" จะไม่จริงอีกต่อไป)
- Modify: `apps/api/src/modules/chat-prospects/customer-merge.service.spec.ts`
  - import: บรรทัด 1-3
  - `makeTx`: บรรทัด 29-53
  - คำสั่งสร้าง service: บรรทัด 61, 177, 190, 231, 273
  - assertion soft-delete: บรรทัด 88
  - describe ใหม่: ต่อท้ายหลังบรรทัด 283
- Modify: `apps/api/src/modules/chat-prospects/customer-merge.service.db.spec.ts:1-149` (แทนทั้งไฟล์ เพราะต้องใช้พนักงานจริง เคลียร์ FK ของ entries/merged_into_id และเพิ่ม describe ใหม่)

**Interfaces:**
- Consumes:
  - Task 1 — Prisma: `Customer.mergedIntoId String? @map("merged_into_id")` (self-relation `"CustomerMergedInto"`) · delegate `tx.customerJourneyEntry` / `tx.customerJourneyState` ฟิลด์ตาม synthesis `dataModel` · migration `20261002100000_customer_journey` apply บนฐานทดสอบแล้ว
  - Task 2 — `JourneyEntryWriter` จาก `apps/api/src/modules/customer-journey/journey-entry-writer.service.ts`
    - constructor `(prisma: PrismaService)`
    - `recordInTx(tx: Prisma.TransactionClient, entry: JourneyEntryInput): Promise<void>` เขียน `origin='SYSTEM'` ด้วย `tx.customerJourneyEntry.createMany({ skipDuplicates: true })` ของ tx ที่ส่งเข้ามา
    - ตรวจ `data` ด้วย `JOURNEY_DATA_SCHEMAS.PLACEHOLDER_MERGED = z.object({ roomCount: z.number().int().min(0).max(1000) })`
    - ถ้าล้มต้อง **throw** ออกมา เพื่อให้ทรานแซกชันการรวม rollback
  - Task 2 — `journeyDedupeKey(kind: JourneySystemEntryKind, ...parts: Array<string | number>): string` จาก `apps/api/src/modules/customer-journey/journey-data-schemas.ts` → `PLACEHOLDER_MERGED:<placeholderId>`
  - Task 3 — `JourneyStateService` จาก `apps/api/src/modules/customer-journey/journey-state.service.ts`
    - `recompute(customerIds: string[]): Promise<void>` คำนวณเฉพาะลูกค้าที่ `deleted_at IS NULL` และไม่ทิ้งแถวแคชไว้ให้ id ที่ถูกลบแล้ว
    - `contactedAt`/`firstChannel`/`firstSource`/`firstAdCampaignId` เป็นค่าแช่แข็ง: คำนวณใหม่ได้เฉพาะค่าที่เก่ากว่าแคช
  - Task 3 — `CustomerJourneyModule` จาก `apps/api/src/modules/customer-journey/customer-journey.module.ts` (สัญญานี้มี `customer-journey.module.spec.ts` ของ Task 3 ล็อกไว้)
    - `exports: [JourneyEntryWriter, JourneyStateService]`
    - **ห้าม** import `ChatProspectsModule`, `CustomersModule`, `LineOaModule`, `ChatEngineModule`, `ChatbotFinanceModule`, `StaffChatModule` (กันวงจร)
  - ของเดิม: `lockCreditCustomer(tx, id)` · `SYSTEM_ACTOR` · `resolveSystemActorUserId()` (private, R12)
- Produces:
  - `new CustomerMergeService(prisma: PrismaService, audit: AuditService, journeyEntries: JourneyEntryWriter, journeyState: JourneyStateService)` (`AbsorbResult` คงเดิม และข้อความ 400/404/409 เดิมทุกตัวอักษร)
  - ในทรานแซกชันของ `absorbPlaceholder(placeholderId, targetId, actor, opts)`:
    - `customer_journey_entries.customer_id` ของ placeholder ย้ายไป target (`origin_customer_id` คงเดิม)
    - `customers.merged_into_id` ที่ชี้ placeholder ชี้ target แทน ⇒ ความลึกเป็นชั้นเดียวเสมอ
    - placeholder ถูกตั้ง `{ deletedAt: mergedAt, mergedIntoId: targetId }`
    - entry `PLACEHOLDER_MERGED` = `{ customerId: targetId, occurredAt: mergedAt, actorType: 'SYSTEM'|'STAFF', actorUserId: null|actor.id, data: { roomCount }, dedupeKey: journeyDedupeKey('PLACEHOLDER_MERGED', placeholderId) }` (= `'PLACEHOLDER_MERGED:<placeholderId>'`)
    - แคชของ target รับ `contactedAt/firstChannel/firstSource/firstAdCampaignId` ของ placeholder เมื่อ placeholder ทักก่อน (ถ้า target ยังไม่มีแคช สร้างจากแถวของ placeholder) · `firstStaffReplyAt` = ค่าเก่าสุดที่ไม่ว่าง
    - แคชของ placeholder ถูกลบ
  - หลัง commit: `journeyState.recompute([targetId, placeholderId])` ใน try/catch + `Logger.warn` + `Sentry.captureException(err, { tags: { kind: 'customer-journey' } })` · ถ้าล้ม การรวมยังสำเร็จ
  - `ChatProspectsModule.imports = [CustomerJourneyModule]`

- [ ] **Step 1: ตรวจของจาก task ก่อนหน้า + เตรียมฐานทดสอบ + baseline**

รันจาก `apps/api`:
```bash
ls src/modules/customer-journey/customer-journey.module.ts src/modules/customer-journey/journey-entry-writer.service.ts src/modules/customer-journey/journey-state.service.ts ../../packages/shared/src/customer-journey.ts prisma/migrations/20261002100000_customer_journey/migration.sql
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" npx prisma migrate status
npx prisma generate
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" node -e 'const { PrismaClient } = require("@prisma/client"); const p = new PrismaClient(); p.user.upsert({ where: { email: "system@bestchoice.internal" }, update: { isSystemUser: true, isActive: false }, create: { email: "system@bestchoice.internal", name: "SYSTEM", role: "OWNER", password: "__NO_LOGIN__", accessibleCompanies: ["SHOP", "FINANCE"], primaryCompany: "SHOP", isActive: false, isSystemUser: true } }).then((u) => { console.log(u.id); return p.$disconnect(); });'
```
Expected:
- `ls` พบครบ 5 ไฟล์ ถ้าไม่ครบ **หยุด** แล้วทำ task ที่สร้างไฟล์นั้นก่อน (`journey-state.service.ts` = Task 3 · writer/module = Task 2 · shared/migration = Task 1)
- `migrate status` → `Database schema is up to date!` ถ้ามี migration ค้าง ให้รัน `npx prisma migrate deploy` ด้วย `DATABASE_URL` เดียวกัน
- `node -e` พิมพ์ uuid ของ system user ออกมา (ค่าเดียวกับ `seedCollectionsFoundation` ใน `prisma/seeds/collections-foundation.seed.ts:22-38`)

Baseline: `npx jest src/modules/chat-prospects/customer-merge.service.spec.ts src/modules/chat-prospects/customer-merge.service.db.spec.ts --runInBand` (env ตาม Global Constraints) → Expected: PASS `Tests: 23 passed, 23 total`

- [ ] **Step 2: เทสแดง — unit spec (`customer-merge.service.spec.ts`)**

(2.1) แทนบรรทัด 1-3:
```ts
import { ConflictException, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { CustomerMergeService } from './customer-merge.service';
import { ChatProspectsModule } from './chat-prospects.module';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { JourneyStateService } from '../customer-journey/journey-state.service';
```

(2.2) แทนบรรทัด 29-53 (`makeTx` ทั้งฟังก์ชัน) แล้วเพิ่ม `makeJourney` + `newService` ต่อท้าย:
```ts
function makeTx(overrides: { placeholder?: any; target?: any; counts?: Partial<typeof ZERO_COUNTS>; states?: Record<string, any> } = {}) {
  const placeholder = { ...PLACEHOLDER, _count: { ...ZERO_COUNTS, ...(overrides.counts ?? {}) }, ...(overrides.placeholder ?? {}) };
  const target = { ...TARGET, ...(overrides.target ?? {}) };
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    customer: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(where.id === 'p1' ? placeholder : where.id === 't1' ? target : null)),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    chatRoom: { findMany: jest.fn().mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]), updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    creditCheck: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    customerTag: {
      findMany: jest.fn(({ where }: any) => Promise.resolve(where.customerId === 'p1' ? [{ id: 'tag-a', tag: 'VIP' }, { id: 'tag-b', tag: 'HOT' }] : [{ tag: 'HOT' }])),
      update: jest.fn().mockResolvedValue({}),
    },
    crmLead: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    adsAttribution: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    chatAutoTrigger: {
      findMany: jest.fn(({ where }: any) => Promise.resolve(where.customerId === 'p1' ? [{ id: 'tr-1', referenceKey: 'k1' }, { id: 'tr-2', referenceKey: 'k2' }] : [{ referenceKey: 'k2' }])),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    customerScore: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    customerJourneyEntry: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    customerJourneyState: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(overrides.states?.[where.customerId] ?? null)),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

/** JourneyEntryWriter / JourneyStateService ปลอม — unit spec ตรวจแค่ว่าเรียกอะไร ด้วยค่าอะไร (ของจริงอยู่ใน db spec) */
function makeJourney() {
  return {
    entries: { recordInTx: jest.fn().mockResolvedValue(undefined), recordAfterCommit: jest.fn().mockResolvedValue(undefined) },
    state: { recompute: jest.fn().mockResolvedValue(undefined) },
  };
}

function newService(prisma: any, audit: any): CustomerMergeService {
  const journey = makeJourney();
  return new CustomerMergeService(prisma, audit, journey.entries as any, journey.state as any);
}
```

(2.3) แทนคำสั่งสร้าง service เดิม 5 จุด:
- บรรทัด 61 `    return new CustomerMergeService(prisma, audit);` → `    return newService(prisma, audit);`
- บรรทัด 177 `    const service = new CustomerMergeService(prisma, audit as any);` → `    const service = newService(prisma, audit);`
- บรรทัด 190 `    return { service: new CustomerMergeService(prisma, audit as any), audit, prisma };` → `    return { service: newService(prisma, audit), audit, prisma };`
- บรรทัด 231 `    return { service: new CustomerMergeService(prisma, { log: jest.fn() } as any), prisma };` → `    return { service: newService(prisma, { log: jest.fn() }), prisma };`
- บรรทัด 273 `    const service = new CustomerMergeService(prisma, { log: jest.fn() } as any);` → `    const service = newService(prisma, { log: jest.fn() });`

(2.4) แทนบรรทัด 88:
```ts
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { deletedAt: expect.any(Date), mergedIntoId: 't1' } });
```

(2.5) ต่อท้ายไฟล์ หลังบรรทัด 283:
```ts

// การเดินทางของลูกค้า (Plan 2 Task 4) — ทุกทางรวมผ่าน absorbPlaceholder จึงตรวจที่เดียว
describe('CustomerMergeService.absorbPlaceholder — การเดินทางของลูกค้า', () => {
  const actor = { id: 'staff-1', role: 'SALES' };
  const PH_STATE = {
    customerId: 'p1', stage: 'INTERESTED', stageEnteredAt: new Date('2026-08-02T03:00:00Z'), path: 'UNKNOWN',
    contactedAt: new Date('2026-08-01T03:00:00Z'), firstChannel: 'CHAT_FACEBOOK', firstSource: 'CHAT_FACEBOOK',
    firstAdCampaignId: null, firstStaffReplyAt: new Date('2026-08-01T04:00:00Z'), computedAt: new Date('2026-08-03T03:00:00Z'),
  };
  const TG_STATE = {
    customerId: 't1', stage: 'PURCHASED', stageEnteredAt: new Date('2026-09-10T03:00:00Z'), path: 'CASH',
    contactedAt: new Date('2026-09-10T03:00:00Z'), firstChannel: 'WALK_IN', firstSource: 'WALK_IN',
    firstAdCampaignId: null, firstStaffReplyAt: null, computedAt: new Date('2026-09-10T03:05:00Z'),
  };

  const setup = (tx: any, opts: { commitFails?: boolean; systemUser?: { id: string } | null } = {}) => {
    const journey = makeJourney();
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const commitSeenByRecompute: boolean[] = [];
    let committed = false;
    const prisma: any = {
      $transaction: jest.fn(async (fn: any) => {
        const out = await fn(tx);
        if (opts.commitFails) throw new Error('commit failed');
        committed = true;
        return out;
      }),
      user: { findFirst: jest.fn().mockResolvedValue(opts.systemUser === undefined ? { id: 'sys-user-real-id' } : opts.systemUser) },
    };
    journey.state.recompute.mockImplementation(async () => {
      commitSeenByRecompute.push(committed);
    });
    const service = new CustomerMergeService(prisma, audit as any, journey.entries as any, journey.state as any);
    return { service, journey, audit, commitSeenByRecompute };
  };

  it('ใน tx: ย้าย entries · ยุบ chain · soft-delete คู่ mergedIntoId · PLACEHOLDER_MERGED ผ่าน recordInTx (occurredAt = เวลาลบ · data มีแค่จำนวนห้อง)', async () => {
    const tx = makeTx();
    const { service, journey } = setup(tx);
    await service.absorbPlaceholder('p1', 't1', actor);

    expect(tx.customerJourneyEntry.updateMany).toHaveBeenCalledWith({ where: { customerId: 'p1' }, data: { customerId: 't1' } });
    expect(tx.customer.updateMany).toHaveBeenCalledWith({ where: { mergedIntoId: 'p1' }, data: { mergedIntoId: 't1' } });
    const softDelete = tx.customer.update.mock.calls.map(([arg]: any[]) => arg).find((arg: any) => arg.where.id === 'p1');
    expect(softDelete).toEqual({ where: { id: 'p1' }, data: { deletedAt: expect.any(Date), mergedIntoId: 't1' } });
    expect(journey.entries.recordInTx).toHaveBeenCalledTimes(1);
    expect(journey.entries.recordInTx).toHaveBeenCalledWith(tx, {
      customerId: 't1',
      kind: 'PLACEHOLDER_MERGED',
      occurredAt: softDelete.data.deletedAt,
      actorType: 'STAFF',
      actorUserId: 'staff-1',
      data: { roomCount: 2 },
      dedupeKey: 'PLACEHOLDER_MERGED:p1',
    });
    expect(journey.entries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('actor SYSTEM ที่หา system user ไม่เจอ → audit ถูกข้าม แต่ PLACEHOLDER_MERGED ยังเขียน (actorType SYSTEM · actorUserId null ไม่ติด FK)', async () => {
    const tx = makeTx();
    const { service, journey, audit } = setup(tx, { systemUser: null });
    await service.absorbPlaceholder('p1', 't1', { id: 'system', role: 'SYSTEM' });
    expect(audit.log).not.toHaveBeenCalled();
    expect(journey.entries.recordInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ kind: 'PLACEHOLDER_MERGED', actorType: 'SYSTEM', actorUserId: null, dedupeKey: 'PLACEHOLDER_MERGED:p1' }),
    );
  });

  it('recompute([ปลายทาง, placeholder]) หลัง commit เท่านั้น · commit ล้ม → ไม่ recompute', async () => {
    const ok = setup(makeTx());
    await ok.service.absorbPlaceholder('p1', 't1', actor);
    expect(ok.journey.state.recompute).toHaveBeenCalledWith(['t1', 'p1']);
    expect(ok.commitSeenByRecompute).toEqual([true]);

    const failed = setup(makeTx(), { commitFails: true });
    await expect(failed.service.absorbPlaceholder('p1', 't1', actor)).rejects.toThrow('commit failed');
    expect(failed.journey.state.recompute).not.toHaveBeenCalled();
  });

  it('recompute ล้ม → การรวมยังสำเร็จ + Sentry (summary endpoint และ cron ซ่อมแคชเอง)', async () => {
    (Sentry.captureException as jest.Mock).mockClear();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, journey } = setup(makeTx());
    journey.state.recompute.mockRejectedValueOnce(new Error('recompute down'));
    await expect(service.absorbPlaceholder('p1', 't1', actor)).resolves.toEqual({
      placeholderId: 'p1', targetId: 't1', movedRooms: 2, movedCreditChecks: 1,
    });
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'recompute down' }),
      { tags: { kind: 'customer-journey' } },
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('journey recompute failed'));
  });

  it('แช่แข็ง: placeholder ทักก่อน + ปลายทางมีแคช → update เฉพาะช่องจุดเริ่มต้น แล้วลบแคช placeholder', async () => {
    const tx = makeTx({ states: { p1: PH_STATE, t1: TG_STATE } });
    await setup(tx).service.absorbPlaceholder('p1', 't1', actor);
    expect(tx.customerJourneyState.upsert).toHaveBeenCalledWith({
      where: { customerId: 't1' },
      update: {
        contactedAt: PH_STATE.contactedAt,
        firstChannel: 'CHAT_FACEBOOK',
        firstSource: 'CHAT_FACEBOOK',
        firstAdCampaignId: null,
        firstStaffReplyAt: PH_STATE.firstStaffReplyAt,
      },
      create: expect.objectContaining({ customerId: 't1', contactedAt: PH_STATE.contactedAt }),
    });
    expect(tx.customerJourneyState.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'p1' } });
  });

  it('แช่แข็ง: ปลายทางยังไม่มีแคช → create จากแคช placeholder (ขั้น/path ให้ recompute แก้หลัง commit)', async () => {
    const tx = makeTx({ states: { p1: PH_STATE } });
    await setup(tx).service.absorbPlaceholder('p1', 't1', actor);
    expect(tx.customerJourneyState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: {
        customerId: 't1',
        stage: 'INTERESTED',
        stageEnteredAt: PH_STATE.stageEnteredAt,
        path: 'UNKNOWN',
        computedAt: PH_STATE.computedAt,
        contactedAt: PH_STATE.contactedAt,
        firstChannel: 'CHAT_FACEBOOK',
        firstSource: 'CHAT_FACEBOOK',
        firstAdCampaignId: null,
        firstStaffReplyAt: PH_STATE.firstStaffReplyAt,
      },
    }));
  });

  it('แช่แข็ง: ปลายทางทักก่อน หรือ placeholder ไม่มีแคช → ไม่ upsert แต่ยังลบแคช placeholder', async () => {
    const olderTarget = makeTx({ states: { p1: PH_STATE, t1: { ...TG_STATE, contactedAt: new Date('2026-07-01T03:00:00Z') } } });
    await setup(olderTarget).service.absorbPlaceholder('p1', 't1', actor);
    expect(olderTarget.customerJourneyState.upsert).not.toHaveBeenCalled();
    expect(olderTarget.customerJourneyState.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'p1' } });

    const noCache = makeTx({ states: { t1: TG_STATE } });
    await setup(noCache).service.absorbPlaceholder('p1', 't1', actor);
    expect(noCache.customerJourneyState.upsert).not.toHaveBeenCalled();
    expect(noCache.customerJourneyState.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'p1' } });
  });

  it('แช่แข็ง: placeholder ยังไม่เคยมีร้านตอบ → firstStaffReplyAt ใช้ของปลายทาง (ค่าเก่าสุดที่ไม่ว่าง)', async () => {
    const tx = makeTx({
      states: {
        p1: { ...PH_STATE, firstStaffReplyAt: null },
        t1: { ...TG_STATE, firstStaffReplyAt: new Date('2026-09-10T03:30:00Z') },
      },
    });
    await setup(tx).service.absorbPlaceholder('p1', 't1', actor);
    expect(tx.customerJourneyState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ firstStaffReplyAt: new Date('2026-09-10T03:30:00Z') }),
    }));
  });

  it('409 เอกสารพ่วง → ไม่แตะ entries / chain / แคช / recordInTx / recompute', async () => {
    const tx = makeTx({ counts: { bookings: 1 } });
    const { service, journey } = setup(tx);
    await expect(service.absorbPlaceholder('p1', 't1', actor)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.customerJourneyEntry.updateMany).not.toHaveBeenCalled();
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
    expect(tx.customerJourneyState.deleteMany).not.toHaveBeenCalled();
    expect(journey.entries.recordInTx).not.toHaveBeenCalled();
    expect(journey.state.recompute).not.toHaveBeenCalled();
  });

  it('DI: CustomerMergeService ขอ JourneyEntryWriter + JourneyStateService ตามชนิด · ChatProspectsModule import CustomerJourneyModule ที่ export ทั้งสอง', () => {
    expect(Reflect.getMetadata('design:paramtypes', CustomerMergeService)).toEqual([
      PrismaService, AuditService, JourneyEntryWriter, JourneyStateService,
    ]);
    expect(Reflect.getMetadata('imports', ChatProspectsModule)).toContain(CustomerJourneyModule);
    expect(Reflect.getMetadata('exports', CustomerJourneyModule)).toEqual(
      expect.arrayContaining([JourneyEntryWriter, JourneyStateService]),
    );
  });
});
```

- [ ] **Step 3: เทสแดง — db spec (แทนทั้งไฟล์ `customer-merge.service.db.spec.ts`)**

เทสเดิม 4 ตัวคงเจตนาเดิมทุกข้อ แต่ต้องแก้ 3 จุด:
- actor `'staff-1'` เปลี่ยนเป็นพนักงานจริง เพราะ `actor_user_id` มี FK ไป `users`
- `afterAll` ต้องเคลียร์ entries (FK Restrict) และ `merged_into_id` ก่อนลบลูกค้า
- เพิ่ม describe ใหม่ 7 เทส
```ts
import { ConflictException, Logger } from '@nestjs/common';
import { ChatChannel, PrismaClient } from '@prisma/client';
import { CustomerMergeService, MergeActor, SYSTEM_ACTOR } from './customer-merge.service';
import { AuditService } from '../audit/audit.service';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';

/**
 * พนักงานจริงหนึ่งคนต่อ describe — PLACEHOLDER_MERGED เก็บ actorUserId ที่มี FK ไป users
 * จึงใช้ id ปลอมอย่าง 'staff-1' ไม่ได้ (ทรานแซกชันการรวมจะชน FK แล้ว rollback ทั้งใบ)
 */
async function createStaff(prisma: PrismaClient, key: string): Promise<MergeActor> {
  const user = await prisma.user.create({
    data: { email: `${key}@merge-spec.test`, name: 'merge spec staff', password: '__NO_LOGIN__', role: 'SALES', isActive: false },
  });
  return { id: user.id, role: 'SALES' };
}

/** entries มี FK Restrict ไป customers และ placeholder ชี้ merged_into_id ไปปลายทาง — เคลียร์ก่อนลบลูกค้าเสมอ */
async function clearJourney(prisma: PrismaClient, customerIds: string[]): Promise<void> {
  await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
}

/**
 * พิสูจน์กับ Postgres จริง (สเปค §3.3): ชื่อ relation ใน `_count` ถูกต้อง · trigger ที่ referenceKey ชนกับปลายทาง
 * ถูกลบก่อนย้าย (ไม่ชน unique [customerId, referenceKey] จนทรานแซกชันถูกยกเลิก) · placeholder ถูก soft-delete
 * ต้องรันกับฐานที่ apply migration แล้ว: DATABASE_URL=<ฐานทดสอบ> npx jest <ไฟล์นี้> --runInBand
 */
describe('CustomerMergeService.absorbPlaceholder (real DB)', () => {
  const prisma = new PrismaClient();
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const journeyState = { recompute: jest.fn().mockResolvedValue(undefined) };
  const service = new CustomerMergeService(prisma as any, audit as any, new JourneyEntryWriter(prisma as any), journeyState as any);
  const stamp = Date.now();
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  let staff: MergeActor;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    staff = await createStaff(prisma, `merge-spec-${stamp}`);
  });

  afterAll(async () => {
    await clearJourney(prisma, customerIds);
    await prisma.chatAutoTrigger.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerTag.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerLineLink.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.user.delete({ where: { id: staff.id } });
    await prisma.$disconnect();
    jest.restoreAllMocks();
  });

  async function createPlaceholder(label: string) {
    const placeholder = await prisma.customer.create({
      data: { name: `merge spec ${label}`, phone: null, acquisitionSource: 'CHAT_FACEBOOK', creditCheckStatus: 'PRE_CHECK_PASSED' },
    });
    customerIds.push(placeholder.id);
    const room = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `merge-spec-${label}-${stamp}`, customerId: placeholder.id },
    });
    roomIds.push(room.id);
    return { placeholder, room };
  }

  it('ย้ายห้อง/ผลเช็คเครดิต/แท็ก/trigger (k2 ชนปลายทาง → ลบของ placeholder) แล้ว soft-delete placeholder', async () => {
    const target = await prisma.customer.create({ data: { name: 'merge spec target', phone: `09${String(stamp).slice(-8)}` } });
    customerIds.push(target.id);
    const { placeholder, room } = await createPlaceholder('ok');
    const check = await prisma.creditCheck.create({ data: { customerId: placeholder.id } });
    await prisma.customerTag.create({ data: { customerId: placeholder.id, tag: 'VIP', source: 'MANUAL' } });
    await prisma.customerTag.create({ data: { customerId: placeholder.id, tag: 'NEW', source: 'AUTO' } });
    await prisma.customerTag.create({ data: { customerId: target.id, tag: 'VIP', source: 'MANUAL' } });
    const trigger = { triggerType: 'RECEIPT_DELIVERY' as const, scheduledFor: new Date(), payload: {} };
    await prisma.chatAutoTrigger.create({ data: { ...trigger, customerId: placeholder.id, referenceKey: `k1-${stamp}` } });
    await prisma.chatAutoTrigger.create({ data: { ...trigger, customerId: placeholder.id, referenceKey: `k2-${stamp}` } });
    await prisma.chatAutoTrigger.create({ data: { ...trigger, customerId: target.id, referenceKey: `k2-${stamp}` } });

    await expect(service.absorbPlaceholder(placeholder.id, target.id, staff)).resolves.toEqual({
      placeholderId: placeholder.id, targetId: target.id, movedRooms: 1, movedCreditChecks: 1,
    });

    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).customerId).toBe(target.id);
    expect((await prisma.creditCheck.findUniqueOrThrow({ where: { id: check.id } })).customerId).toBe(target.id);
    const liveTargetTags = await prisma.customerTag.findMany({ where: { customerId: target.id, deletedAt: null }, select: { tag: true } });
    expect(liveTargetTags.map((t) => t.tag).sort()).toEqual(['NEW', 'VIP']);
    expect(await prisma.customerTag.count({ where: { customerId: placeholder.id, deletedAt: null } })).toBe(0);
    const targetKeys = await prisma.chatAutoTrigger.findMany({ where: { customerId: target.id }, select: { referenceKey: true } });
    expect(targetKeys.map((t) => t.referenceKey).sort()).toEqual([`k1-${stamp}`, `k2-${stamp}`]);
    expect(await prisma.chatAutoTrigger.count({ where: { customerId: placeholder.id } })).toBe(0);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: placeholder.id } })).deletedAt).not.toBeNull();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: target.id } })).creditCheckStatus).toBe('PRE_CHECK_PASSED');
    // ปลายทางถูกสร้างก่อน placeholder (ซื้อก่อน ผูกห้องทีหลัง) → ที่มาไม่ถูกยก (Ruling R24)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: target.id } })).acquisitionSource).toBeNull();
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  // Ruling R24 (แก้สเปค §3.3) — พิสูจน์บนคอลัมน์จริง: ทักมาก่อน แล้วพนักงานสร้างลูกค้าจากกล่องข้อความทีหลัง
  it('แชทมาก่อนและปลายทางไม่มีที่มา → ยกที่มา CHAT_* + PSID ไปให้ปลายทาง (KPI มาจากแชทยังนับคนนี้)', async () => {
    const { placeholder, room } = await createPlaceholder('source-carry');
    await prisma.customer.update({
      where: { id: placeholder.id },
      data: { facebookUserId: `psid-carry-${stamp}`, facebookName: 'ชื่อจากเฟซ' },
    });
    // ปลายทางถูกสร้างหลัง placeholder — CreateCustomerDto ไม่มีช่อง acquisitionSource จึงเป็น null เสมอ
    const target = await prisma.customer.create({ data: { name: 'merge spec target 3', phone: `06${String(stamp).slice(-8)}` } });
    customerIds.push(target.id);

    await service.absorbPlaceholder(placeholder.id, target.id, staff);

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.acquisitionSource).toBe('CHAT_FACEBOOK');
    expect(after.facebookUserId).toBe(`psid-carry-${stamp}`);
    expect(after.facebookName).toBe('ชื่อจากเฟซ');
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).customerId).toBe(target.id);
  });

  it('placeholder มีการผูก LINE → 409 บอกชื่อรายการ และห้องยังอยู่กับ placeholder', async () => {
    const target = await prisma.customer.create({ data: { name: 'merge spec target 2', phone: `08${String(stamp).slice(-8)}` } });
    customerIds.push(target.id);
    const { placeholder, room } = await createPlaceholder('blocked');
    await prisma.customerLineLink.create({ data: { customerId: placeholder.id, lineUserId: `Umerge-spec-${stamp}`, channel: 'FINANCE' } });

    await expect(service.absorbPlaceholder(placeholder.id, target.id, staff)).rejects.toThrow(
      new ConflictException('รวมไม่ได้: ผู้สนใจคนนี้มีการผูก LINE 1 รายการ — ให้แก้ที่รายการนั้นก่อน'),
    );
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).customerId).toBe(placeholder.id);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: placeholder.id } })).deletedAt).toBeNull();
  });
});

/**
 * Ruling R12, ต่อจริงกับ Postgres (ไม่ใช่ audit mock แบบ describe ด้านบน) — พิสูจน์ว่า
 * audit_logs_user_id_fkey ไม่พังเงียบอีกต่อไปเมื่อ actor เป็น SYSTEM_ACTOR: ต้อง resolve
 * เป็นแถว User ที่ isSystemUser=true จริง (seed โดย collections-foundation.seed.ts) แล้ว
 * เขียนแถว AuditLog สำเร็จจริงด้วย userId นั้น
 */
describe('CustomerMergeService.absorbPlaceholder — R12 SYSTEM actor audit (real DB + real AuditService)', () => {
  const prisma = new PrismaClient();
  const realAudit = new AuditService(prisma as any);
  const service = new CustomerMergeService(
    prisma as any,
    realAudit,
    new JourneyEntryWriter(prisma as any),
    { recompute: jest.fn().mockResolvedValue(undefined) } as any,
  );
  const stamp = Date.now();
  const customerIds: string[] = [];

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    // AuditLog เป็น immutable (DB trigger T2-C4 บล็อก DELETE) — ปล่อยแถว audit ของเทสไว้ตามปกติ
    await clearJourney(prisma, customerIds);
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
    jest.restoreAllMocks();
  });

  it('actor SYSTEM_ACTOR → เขียน AuditLog สำเร็จจริงผ่าน FK ด้วย userId ของแถว isSystemUser=true', async () => {
    const sysUser = await prisma.user.findFirstOrThrow({ where: { isSystemUser: true }, select: { id: true } });
    const target = await prisma.customer.create({ data: { name: 'r12 db target', phone: `07${String(stamp).slice(-8)}` } });
    customerIds.push(target.id);
    const placeholder = await prisma.customer.create({
      data: { name: 'r12 db placeholder', phone: null, acquisitionSource: 'CHAT_FACEBOOK' },
    });
    customerIds.push(placeholder.id);

    await service.absorbPlaceholder(placeholder.id, target.id, SYSTEM_ACTOR);

    const rows = await prisma.auditLog.findMany({
      where: { action: 'CUSTOMER_PLACEHOLDER_MERGED', entity: 'customer', entityId: target.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(sysUser.id);
  });
});

/**
 * การเดินทางของลูกค้า (Plan 2 Task 4) บน Postgres จริง — writer ของจริง (เขียนใน tx ของการรวม)
 * ส่วน JourneyStateService เป็น mock เพื่อไม่ผูกผลเทสนี้กับ journey-state.sql
 */
describe('CustomerMergeService.absorbPlaceholder — การเดินทางของลูกค้า (real DB)', () => {
  const prisma = new PrismaClient();
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const journeyState = { recompute: jest.fn().mockResolvedValue(undefined) };
  const writer = new JourneyEntryWriter(prisma as any);
  const service = new CustomerMergeService(prisma as any, audit as any, writer, journeyState as any);
  const stamp = Date.now();
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  let staff: MergeActor;
  let phoneSeq = 0;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    staff = await createStaff(prisma, `journey-spec-${stamp}`);
  });

  beforeEach(() => {
    journeyState.recompute.mockReset();
    journeyState.recompute.mockResolvedValue(undefined);
    audit.log.mockClear();
  });

  afterAll(async () => {
    await clearJourney(prisma, customerIds);
    await prisma.customerLineLink.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.user.delete({ where: { id: staff.id } });
    await prisma.$disconnect();
    jest.restoreAllMocks();
  });

  async function placeholder(label: string) {
    const customer = await prisma.customer.create({
      data: { name: `journey spec ${label}`, phone: null, acquisitionSource: 'CHAT_FACEBOOK' },
    });
    customerIds.push(customer.id);
    const room = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `journey-spec-${label}-${stamp}`, customerId: customer.id },
    });
    roomIds.push(room.id);
    return { customer, room };
  }

  async function realCustomer(label: string) {
    const customer = await prisma.customer.create({
      data: { name: `journey spec ${label}`, phone: `05${phoneSeq++}${String(stamp).slice(-7)}` },
    });
    customerIds.push(customer.id);
    return customer;
  }

  function seedHandoff(customerId: string, dedupeKey: string) {
    return prisma.customerJourneyEntry.create({
      data: {
        customerId, originCustomerId: customerId, origin: 'SYSTEM', kind: 'BOT_HANDOFF',
        occurredAt: new Date('2026-09-01T03:00:00.000Z'), actorType: 'BOT', dedupeKey,
      },
    });
  }

  function seedState(customerId: string, contactedAtIso: string, channel: string, stage = 'CONTACTED') {
    const at = new Date(contactedAtIso);
    return prisma.customerJourneyState.create({
      data: { customerId, stage, stageEnteredAt: at, path: 'UNKNOWN', contactedAt: at, firstChannel: channel, firstSource: channel, computedAt: at },
    });
  }

  it('ย้าย entries ของ placeholder ไปปลายทาง (origin คงเดิม) · soft-delete คู่ merged_into_id · PLACEHOLDER_MERGED 1 แถวไม่มี PII · recompute หลัง commit', async () => {
    const target = await realCustomer('move-target');
    const { customer: ph, room } = await placeholder('move');
    const handoff = await seedHandoff(ph.id, `BOT_HANDOFF:${room.id}:${stamp}`);

    await service.absorbPlaceholder(ph.id, target.id, staff);

    expect(await prisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: handoff.id } })).toMatchObject({
      customerId: target.id, originCustomerId: ph.id,
    });
    const gone = await prisma.customer.findUniqueOrThrow({ where: { id: ph.id } });
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.mergedIntoId).toBe(target.id);
    const merged = await prisma.customerJourneyEntry.findMany({ where: { customerId: target.id, kind: 'PLACEHOLDER_MERGED' } });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      origin: 'SYSTEM', actorType: 'STAFF', actorUserId: staff.id, dedupeKey: `PLACEHOLDER_MERGED:${ph.id}`,
      data: { roomCount: 1 }, roomId: null, note: null,
    });
    expect(Object.keys(merged[0].data as object)).toEqual(['roomCount']);
    expect(merged[0].occurredAt.getTime()).toBe(gone.deletedAt?.getTime());
    expect(journeyState.recompute).toHaveBeenCalledWith([target.id, ph.id]);
  });

  it('chain: A → B (รวมห้องแชท) แล้ว B → C · merged_into_id ของ A ถูกยุบมาที่ C · ids ชั้นเดียว = BFS ของ merged_into_id ∪ audit', async () => {
    const chainService = new CustomerMergeService(prisma as any, new AuditService(prisma as any), writer, journeyState as any);
    const a = (await placeholder('chain-a')).customer;
    const b = (await placeholder('chain-b')).customer;
    const c = await realCustomer('chain-c');

    await chainService.absorbPlaceholder(a.id, b.id, SYSTEM_ACTOR, { allowPlaceholderTarget: true });
    await chainService.absorbPlaceholder(b.id, c.id, SYSTEM_ACTOR);

    const oneLevel = (await prisma.customer.findMany({ where: { mergedIntoId: c.id }, select: { id: true } }))
      .map((r) => r.id)
      .sort();
    expect(oneLevel).toEqual([a.id, b.id].sort());

    // oracle อิสระ: เดินกราฟทุกชั้นจาก merged_into_id และ audit CUSTOMER_PLACEHOLDER_MERGED (oldValue.placeholderId → entityId)
    const seen = new Set<string>();
    const queue: string[] = [c.id];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      const viaColumn = await prisma.customer.findMany({ where: { mergedIntoId: id }, select: { id: true } });
      const viaAudit = await prisma.auditLog.findMany({
        where: { action: 'CUSTOMER_PLACEHOLDER_MERGED', entity: 'customer', entityId: id },
        select: { oldValue: true },
      });
      const children = [
        ...viaColumn.map((r) => r.id),
        ...viaAudit.map((r) => String((r.oldValue as Record<string, unknown>).placeholderId)),
      ];
      for (const child of children) {
        if (!seen.has(child)) {
          seen.add(child);
          queue.push(child);
        }
      }
    }
    expect([...seen].sort()).toEqual(oneLevel);

    const mergedEntries = await prisma.customerJourneyEntry.findMany({
      where: { customerId: c.id, kind: 'PLACEHOLDER_MERGED' },
      select: { dedupeKey: true, actorType: true, actorUserId: true },
    });
    expect(mergedEntries.map((e) => e.dedupeKey).sort()).toEqual([`PLACEHOLDER_MERGED:${a.id}`, `PLACEHOLDER_MERGED:${b.id}`].sort());
    expect(mergedEntries.every((e) => e.actorType === 'SYSTEM' && e.actorUserId === null)).toBe(true);
  });

  it('แช่แข็ง: placeholder ทักก่อนปลายทาง → ปลายทางได้ contactedAt/firstChannel/firstSource ของ placeholder แต่ขั้นเดิมไม่เปลี่ยน · แคช placeholder ถูกลบ', async () => {
    const target = await realCustomer('freeze-target');
    const { customer: ph } = await placeholder('freeze');
    await seedState(ph.id, '2026-03-01T03:00:00.000Z', 'CHAT_FACEBOOK');
    await seedState(target.id, '2026-09-10T03:00:00.000Z', 'WALK_IN', 'PURCHASED');

    await service.absorbPlaceholder(ph.id, target.id, staff);

    expect(await prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId: target.id } })).toMatchObject({
      stage: 'PURCHASED',
      contactedAt: new Date('2026-03-01T03:00:00.000Z'),
      firstChannel: 'CHAT_FACEBOOK',
      firstSource: 'CHAT_FACEBOOK',
    });
    expect(await prisma.customerJourneyState.findUnique({ where: { customerId: ph.id } })).toBeNull();
  });

  it('แช่แข็ง: ปลายทางยังไม่มีแคช → สร้างจากแคช placeholder · ปลายทางทักก่อน → ค่าเดิมของปลายทางคงอยู่', async () => {
    const fresh = await realCustomer('freeze-fresh');
    const { customer: ph1 } = await placeholder('freeze-fresh');
    await seedState(ph1.id, '2026-04-01T03:00:00.000Z', 'CHAT_LINE_SHOP', 'INTERESTED');
    await service.absorbPlaceholder(ph1.id, fresh.id, staff);
    expect(await prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId: fresh.id } })).toMatchObject({
      stage: 'INTERESTED',
      contactedAt: new Date('2026-04-01T03:00:00.000Z'),
      firstChannel: 'CHAT_LINE_SHOP',
      firstSource: 'CHAT_LINE_SHOP',
    });

    const older = await realCustomer('freeze-older');
    const { customer: ph2 } = await placeholder('freeze-older');
    await seedState(ph2.id, '2026-05-01T03:00:00.000Z', 'CHAT_FACEBOOK');
    await seedState(older.id, '2026-01-15T03:00:00.000Z', 'WALK_IN');
    await service.absorbPlaceholder(ph2.id, older.id, staff);
    expect(await prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId: older.id } })).toMatchObject({
      contactedAt: new Date('2026-01-15T03:00:00.000Z'),
      firstChannel: 'WALK_IN',
      firstSource: 'WALK_IN',
    });
    expect(await prisma.customerJourneyState.count({ where: { customerId: { in: [ph1.id, ph2.id] } } })).toBe(0);
  });

  it('actor SYSTEM ที่หา system user ไม่เจอ → audit ถูกข้ามทั้งใบ แต่ PLACEHOLDER_MERGED ยังถูกเขียน (actorType SYSTEM · actorUserId null)', async () => {
    const lonely = new CustomerMergeService(prisma as any, audit as any, writer, journeyState as any);
    jest.spyOn(lonely as any, 'resolveSystemActorUserId').mockResolvedValue(null);
    const target = await realCustomer('system-target');
    const { customer: ph } = await placeholder('system');

    await lonely.absorbPlaceholder(ph.id, target.id, SYSTEM_ACTOR);

    expect(audit.log).not.toHaveBeenCalled();
    const merged = await prisma.customerJourneyEntry.findMany({ where: { customerId: target.id, kind: 'PLACEHOLDER_MERGED' } });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ actorType: 'SYSTEM', actorUserId: null, dedupeKey: `PLACEHOLDER_MERGED:${ph.id}` });
  });

  it('recordInTx ล้มกลางทรานแซกชัน → rollback ทั้งใบ: ห้อง/entry กลับอยู่กับ placeholder · ไม่ถูกลบ · merged_into_id ว่าง · ไม่ audit · ไม่ recompute', async () => {
    const target = await realCustomer('rollback-target');
    const { customer: ph, room } = await placeholder('rollback');
    const handoff = await seedHandoff(ph.id, `BOT_HANDOFF:${room.id}:rollback-${stamp}`);
    jest.spyOn(writer, 'recordInTx').mockRejectedValueOnce(new Error('journey write failed'));

    await expect(service.absorbPlaceholder(ph.id, target.id, staff)).rejects.toThrow('journey write failed');

    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).customerId).toBe(ph.id);
    expect((await prisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: handoff.id } })).customerId).toBe(ph.id);
    const still = await prisma.customer.findUniqueOrThrow({ where: { id: ph.id } });
    expect(still.deletedAt).toBeNull();
    expect(still.mergedIntoId).toBeNull();
    expect(await prisma.customerJourneyEntry.count({ where: { dedupeKey: `PLACEHOLDER_MERGED:${ph.id}` } })).toBe(0);
    expect(audit.log).not.toHaveBeenCalled();
    expect(journeyState.recompute).not.toHaveBeenCalled();
  });

  it('recompute หลัง commit ล้ม → การรวมยังสำเร็จ และ PLACEHOLDER_MERGED ถูก commit แล้ว', async () => {
    journeyState.recompute.mockRejectedValueOnce(new Error('recompute down'));
    const target = await realCustomer('recompute-target');
    const { customer: ph } = await placeholder('recompute');

    await expect(service.absorbPlaceholder(ph.id, target.id, staff)).resolves.toMatchObject({ placeholderId: ph.id, targetId: target.id });

    expect(await prisma.customerJourneyEntry.count({ where: { dedupeKey: `PLACEHOLDER_MERGED:${ph.id}` } })).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: ph.id } })).mergedIntoId).toBe(target.id);
  });
});
```

- [ ] **Step 4: รันให้เห็นแดง**

Run: `npx jest src/modules/chat-prospects/customer-merge.service.spec.ts src/modules/chat-prospects/customer-merge.service.db.spec.ts --runInBand` (env ตาม Global Constraints) → Expected: FAIL ทั้งสองไฟล์ `Test suite failed to run` · `TS2554: Expected 2 arguments, but got 4.` (constructor ยังรับแค่ `prisma, audit`)

- [ ] **Step 5: แก้ `customer-merge.service.ts`**

(5.1) แทรกหลังบรรทัด 13 (`import { lockCreditCustomer } ...`):
```ts
import { journeyDedupeKey } from '../customer-journey/journey-data-schemas';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { JourneyStateService } from '../customer-journey/journey-state.service';
```

(5.2) แทรกหลังบรรทัด 40 (`} as const;` ของ `SOURCE_COPY_SELECT`):
```ts

/** เวลาเก่าสุดที่ไม่ว่าง — ใช้กับค่าแช่แข็งของแคชการเดินทาง */
function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}
```

(5.3) แทนบรรทัด 45-46 (doc ของคลาส):
```ts
 * ย้ายเฉพาะ: ห้องแชท · CreditCheck ที่ import จากห้อง (updateMany ตรง — linkRoomCreditHistory ย้ายเฉพาะ
 * ผลที่ยังไม่ import) · แท็ก · crmLeads · adsAttributions · chatAutoTriggers · บันทึกการเดินทาง (customer_journey_entries)
 * แล้ว soft-delete placeholder คู่ merged_into_id — ทุกทางรวม (ผูกห้อง / absorb-into / รวมห้องแชท / OTP / LIFF /
 * พิมพ์เบอร์ใน LINE) มาที่เมธอดนี้ จึงแก้การเดินทางที่เดียวครอบทุกทาง
```

(5.4) แทนบรรทัด 53:
```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journeyEntries: JourneyEntryWriter,
    private readonly journeyState: JourneyStateService,
  ) {}
```

(5.5) แทรกหลังบรรทัด 162 (`await tx.adsAttribution.updateMany(...)`):
```ts

      // การเดินทางของลูกค้า — ล็อกสองฝั่งแล้วข้างบน
      // (1) บันทึกของ placeholder ย้ายตามเจ้าของ · originCustomerId คงเดิม · dedupeKey ผูกกับเอกสาร ไม่ผูกลูกค้า จึงไม่ชน unique
      await tx.customerJourneyEntry.updateMany({ where: { customerId: placeholderId }, data: { customerId: targetId } });
      // (2) ยุบ chain: คนที่เคยถูกรวมเข้า placeholder ตัวนี้ (รวมห้องแชท placeholder→placeholder) ชี้ไปปลายทางใหม่
      //     ⇒ ตัวอ่านหา ids ได้ชั้นเดียวเสมอ: [customerId, ...customers.where({ mergedIntoId: customerId })]
      await tx.customer.updateMany({ where: { mergedIntoId: placeholderId }, data: { mergedIntoId: targetId } });
      // (4) แช่แข็งจุดเริ่มต้นของการเดินทางลงแคชของปลายทาง — ไม่ขึ้นกับ R24 ข้างล่าง (R24 ยกเฉพาะ acquisitionSource ที่ปลายทางยังว่าง)
      await this.freezeJourneyOrigin(tx, placeholderId, targetId);
```

(5.6) แทนบรรทัด 201 (`await tx.customer.update({ where: { id: placeholderId }, data: { deletedAt: new Date() } });`):
```ts
      const mergedAt = new Date();
      // (3) merged_into_id คู่ deletedAt — ลิงก์เก่าที่ชี้ placeholder ตามไปหาลูกค้าจริงได้
      await tx.customer.update({ where: { id: placeholderId }, data: { deletedAt: mergedAt, mergedIntoId: targetId } });
      // (5) PLACEHOLDER_MERGED เขียนใน tx เดียวกับการรวม (ต่างจาก audit ที่ลงหลัง commit) — actorUserId เป็น null ได้
      //     จึงไม่ติด FK และไม่ถูกข้ามแบบ audit R12 · ล้มตรงไหน = rollback พร้อมกันทั้งใบ
      //     data มีแค่จำนวนห้อง — ห้ามใส่ข้อความแชท / เบอร์ / เลขบัตร / ที่อยู่ (PDPA)
      await this.journeyEntries.recordInTx(tx, {
        customerId: targetId,
        kind: 'PLACEHOLDER_MERGED',
        occurredAt: mergedAt,
        actorType: actor.role === 'SYSTEM' ? 'SYSTEM' : 'STAFF',
        actorUserId: actor.role === 'SYSTEM' ? null : actor.id,
        data: { roomCount: rooms.length },
        dedupeKey: journeyDedupeKey('PLACEHOLDER_MERGED', placeholderId),
      });
```

(5.7) แทรกหลังบรรทัด 228 (`}` ที่ปิด `else` ของบล็อก audit) และก่อน `this.logger.log(` บรรทัด 229:
```ts
    // (6) แคชสรุปคำนวณใหม่หลัง commit — ส่ง placeholderId ด้วย เพื่อเก็บแถวแคชที่ cron อาจเขียนแทรกระหว่างทรานแซกชัน
    //     ล้มแล้วการรวมไม่ล้ม: summary endpoint ตรวจสดแล้วคำนวณใหม่ในคำขอ + cron journey:recompute คืนนั้นซ่อมเอง (Plan 2 Task 9)
    try {
      await this.journeyState.recompute([targetId, placeholderId]);
    } catch (err) {
      this.logger.warn(`[merge] journey recompute failed for ${targetId}: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'customer-journey' } });
    }
```

(5.8) แทรกหลังบรรทัด 233 (`}` ที่ปิด `absorbPlaceholder`) เป็นเมธอดใหม่:
```ts

  /**
   * (4) แช่แข็งจุดเริ่มต้นของการเดินทาง — contactedAt / firstChannel / firstSource / firstAdCampaignId เป็นค่าแช่แข็ง
   * (recompute เลือกได้แค่ค่าที่เก่ากว่า) · placeholder ทักมาก่อน ⇒ ปลายทางรับชุดจุดเริ่มต้นของ placeholder ทั้งชุด
   * ปลายทางยังไม่มีแคช ⇒ สร้างจากแถวของ placeholder (stage/path ถูกแก้โดย recompute หลัง commit)
   * แคชของ placeholder ถูกลบเสมอ — ลูกค้าที่ถูกรวมแล้วไม่มีแคชของตัวเอง
   */
  private async freezeJourneyOrigin(tx: Prisma.TransactionClient, placeholderId: string, targetId: string): Promise<void> {
    const [from, into] = await Promise.all([
      tx.customerJourneyState.findUnique({ where: { customerId: placeholderId } }),
      tx.customerJourneyState.findUnique({ where: { customerId: targetId } }),
    ]);
    if (from && (!into || from.contactedAt < into.contactedAt)) {
      const origin = {
        contactedAt: from.contactedAt,
        firstChannel: from.firstChannel,
        firstSource: from.firstSource,
        firstAdCampaignId: from.firstAdCampaignId,
        firstStaffReplyAt: earliest(from.firstStaffReplyAt, into?.firstStaffReplyAt ?? null),
      };
      await tx.customerJourneyState.upsert({
        where: { customerId: targetId },
        update: origin,
        create: {
          customerId: targetId,
          stage: from.stage,
          stageEnteredAt: from.stageEnteredAt,
          path: from.path,
          computedAt: from.computedAt,
          ...origin,
        },
      });
    }
    await tx.customerJourneyState.deleteMany({ where: { customerId: placeholderId } });
  }
```

- [ ] **Step 6: ต่อสาย DI + คอมเมนต์ที่ไม่จริงแล้ว**

แทนทั้งไฟล์ `apps/api/src/modules/chat-prospects/chat-prospects.module.ts` (บรรทัด 1-11):
```ts
import { Module } from '@nestjs/common';
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';
import { ChatProspectService } from './chat-prospect.service';
import { CustomerMergeService } from './customer-merge.service';
import { SamePersonService } from './same-person.service';

/**
 * ผู้สนใจจากแชท — PrismaModule/AuditModule เป็น @Global
 * CustomerJourneyModule ให้ JourneyEntryWriter + JourneyStateService แก่ CustomerMergeService
 * (โมดูลนั้นห้าม import ChatProspectsModule หรือโมดูลที่ import ChatProspectsModule กลับมา — กันวงจร)
 */
@Module({
  imports: [CustomerJourneyModule],
  providers: [ChatProspectService, CustomerMergeService, SamePersonService],
  exports: [ChatProspectService, CustomerMergeService, SamePersonService],
})
export class ChatProspectsModule {}
```

แทน `apps/api/src/modules/line-oa/line-oa.module.ts:49`:
```ts
    // (ChatProspectsModule import แค่ CustomerJourneyModule ที่ไม่ import อะไรกลับมาหา line-oa — ไม่มีวงจร ไม่ต้อง forwardRef)
```

- [ ] **Step 7: รันให้เขียว + regression + typecheck + lint**

Run: `npx jest src/modules/chat-prospects/customer-merge.service.spec.ts src/modules/chat-prospects/customer-merge.service.db.spec.ts --runInBand` (env ตาม Global Constraints) → Expected: PASS `Tests: 40 passed, 40 total` (unit 29 · db 11)

Run: `npx jest src/modules/chat-prospects src/modules/customers/customers.controller.spec.ts src/modules/chat-engine/services/room-manager.service.spec.ts src/modules/line-oa/liff-api.service.spec.ts src/modules/chatbot-finance/services/verification.service.spec.ts --runInBand` → Expected: PASS ทุก suite (ไฟล์เหล่านี้ mock `CustomerMergeService` ด้วย `useValue` ไม่กระทบ constructor)

Run: `npx tsc --noEmit -p tsconfig.json` → Expected: 0 error

Run: `npx eslint src/modules/chat-prospects/customer-merge.service.ts src/modules/chat-prospects/chat-prospects.module.ts src/modules/chat-prospects/customer-merge.service.spec.ts src/modules/chat-prospects/customer-merge.service.db.spec.ts src/modules/line-oa/line-oa.module.ts` → Expected: 0 error (warning `no-explicit-any` ในไฟล์เทสยอมรับได้ ตามแบบเดิมของไฟล์) · 🚨 ห้าม `npm run lint`

- [ ] **Step 8: Commit**

รันจาก root ของ worktree:
```bash
git add apps/api/src/modules/chat-prospects/customer-merge.service.ts apps/api/src/modules/chat-prospects/chat-prospects.module.ts apps/api/src/modules/chat-prospects/customer-merge.service.spec.ts apps/api/src/modules/chat-prospects/customer-merge.service.db.spec.ts apps/api/src/modules/line-oa/line-oa.module.ts
git commit -m "feat(chat-prospects): รวมผู้สนใจแล้วการเดินทางของลูกค้าไม่หาย — ย้ายบันทึก ยุบ chain ตั้ง merged_into_id เขียน PLACEHOLDER_MERGED ใน tx แช่แข็งจุดเริ่มต้น และ recompute หลัง commit

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

---

### Task 5: บันทึกเหตุการณ์ระบบหลัง commit — เปิดสัญญา · ตรวจสัญญาทุกรอบ · ผู้เปิดตรวจเครดิต · ผล AI ประเมินเครดิต

**Files:**
- Create: `apps/api/src/modules/contracts/contracts.controller.journey.spec.ts`
- Create: `apps/api/src/modules/contracts/contract-workflow.journey.spec.ts`
- Create: `apps/api/src/modules/credit-check/credit-check.controller.journey.spec.ts`
- Create: `apps/api/src/modules/credit-check/services/credit-check-ai-analysis.journey.spec.ts`
- Modify: `apps/api/src/modules/contracts/contracts.controller.ts` (import ต่อจากบรรทัด 20 · constructor บรรทัด 27-34 · handler `activate` บรรทัด 176-185)
- Modify: `apps/api/src/modules/contracts/contract-quote.http.spec.ts` (import ต่อจากบรรทัด 15 · รายการ stub บรรทัด 31-32)
- Modify: `apps/api/src/modules/contracts/contracts.module.ts` (import ต่อจากบรรทัด 22 · array `imports` บรรทัด 25-44)
- Modify: `apps/api/src/modules/contracts/contract-workflow.service.ts` (import ต่อจากบรรทัด 32 · constructor บรรทัด 47 · `approveContract` update บรรทัด 310-320 · `rejectContract` update บรรทัด 336-346 · เมธอดใหม่ `recordReviewRound` ก่อน `async activate` บรรทัด 349)
- Modify: `apps/api/src/modules/credit-check/credit-check.controller.ts` (import บรรทัด 1-10 · helper ใหม่ก่อนบรรทัด 12 · `CreditCheckController` constructor บรรทัด 100 + `create` บรรทัด 108-116 · `CustomerCreditCheckController` constructor บรรทัด 139 + `create` บรรทัด 153-161)
- Modify: `apps/api/src/modules/credit-check/credit-check.module.ts` (ทั้งไฟล์ 12 บรรทัด)
- Modify: `apps/api/src/modules/credit-check/credit-check.service.ts` (import บรรทัด 1 และต่อจากบรรทัด 10 · constructor บรรทัด 31-40)
- Modify: `apps/api/src/modules/credit-check/services/credit-check-ai-analysis.service.ts` (import ต่อจากบรรทัด 4 · constructor บรรทัด 18-22 · `analyzeForCustomer` update บรรทัด 62-75 · `analyze` บรรทัด 114-129 · เมธอดใหม่ `recordAiScored` ต่อจากบรรทัด 130)

**Interfaces:**
- Consumes:
  - Task 2 — `JourneyEntryWriter` จาก `apps/api/src/modules/customer-journey/journey-entry-writer.service.ts` — `recordAfterCommit(entry: JourneyEntryInput): Promise<void>` (ไม่โยน error: catch + `Logger.warn` + `Sentry.captureException`, `createMany({ skipDuplicates: true })`) · `recordInTx(tx, entry)` (task นี้ไม่ใช้)
  - Task 2 — `JourneyEntryInput = { customerId: string; kind: JourneyEntryKind; occurredAt: Date; actorType: 'STAFF'|'CUSTOMER'|'BOT'|'SYSTEM'; actorUserId?: string|null; roomId?: string|null; refType?: string|null; refId?: string|null; data?: Record<string, unknown>; dedupeKey: string }`
  - Task 3 — `CustomerJourneyModule` จาก `apps/api/src/modules/customer-journey/customer-journey.module.ts` (exports `JourneyEntryWriter`, `JourneyStateService`; ไม่ import `ContractsModule`/`CreditCheckModule`/`CustomersModule` — ถ้า import จะเกิดวงจร)
  - Task 2 — `JOURNEY_DATA_SCHEMAS` (`journey-data-schemas.ts`) ของ 4 kind นี้ ลอกคำต่อคำ (`contractNumber = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/)`):
    - `CONTRACT_ACTIVATED: z.object({ contractNumber, totalMonths: z.number().int().min(1).max(120), monthlyPayment: z.number().min(0).max(10_000_000) })`
    - `CONTRACT_REVIEWED: z.object({ decision: z.enum(CONTRACT_REVIEW_DECISIONS), contractNumber })`
    - `CREDIT_CHECK_OPENED_BY: z.object({ via: z.enum(CREDIT_CHECK_OPENED_VIA) })` (`'CONTRACT' | 'CUSTOMER'`)
    - `CREDIT_AI_SCORED: z.object({ score: z.number().int().min(0).max(100).nullable(), status: z.enum(CREDIT_AI_STATUSES) })`
  - Task 2 — `sanitizeJourneyData(kind, raw)` (เทสใน task นี้ใช้ยืนยันว่า data ที่ส่งให้ writer ผ่าน whitelist ครบทุกคีย์ — writer เก็บ `sanitized.data` ลงคอลัมน์ ตามที่เทส db ของ Task 2 พิสูจน์แล้ว) · `journeyDedupeKey(kind, ...parts)`
- Produces:
  - `ContractsController` constructor เพิ่มพารามิเตอร์ที่ 7 `journeyEntries: JourneyEntryWriter` (บังคับ) · `POST /contracts/:id/activate` คืนผลเดิม + เขียน entry `CONTRACT_ACTIVATED` (`actorType 'STAFF'`, `actorUserId = user.id`, `refType 'contract'`, `dedupeKey = journeyDedupeKey('CONTRACT_ACTIVATED', contractId)` (`'CONTRACT_ACTIVATED:<contractId>'`), `occurredAt` = เวลาหลัง `activate` คืนผล)
  - `ContractWorkflowService` constructor เพิ่มพารามิเตอร์ที่ 11 `@Optional() journeyEntries?: JourneyEntryWriter` · `approveContract`/`rejectContract` เขียน `CONTRACT_REVIEWED` ทุกรอบ (`dedupeKey = 'CONTRACT_REVIEWED:<contractId>:<reviewedAt ISO>'`, `occurredAt` = ค่า `reviewedAt` ตัวเดียวกับที่เขียนลงสัญญา) · ไม่คัดลอก `reviewNotes`
  - `CreditCheckController(service, journeyEntries: JourneyEntryWriter)` · `CustomerCreditCheckController(service, journeyEntries: JourneyEntryWriter)` · `create` ทั้งสองเป็น `async` เขียน `CREDIT_CHECK_OPENED_BY` (`dedupeKey = 'CREDIT_CHECK_OPENED_BY:<creditCheckId>'`, `occurredAt = creditCheck.createdAt`, `data.via`) เฉพาะใบที่ `createdAt` ไม่เก่ากว่าเวลาเริ่มคำขอเกิน 60 วินาที
  - `CreditCheckService` constructor เพิ่มพารามิเตอร์ที่ 4 `@Optional() journeyEntries?: JourneyEntryWriter` · `CreditCheckAiAnalysisService` constructor เพิ่มพารามิเตอร์ที่ 4 `journeyEntries?: JourneyEntryWriter` · `analyze`/`analyzeForCustomer` เขียน `CREDIT_AI_SCORED` (`actorType 'SYSTEM'`, `actorUserId null`, `refType 'credit_check'`, `occurredAt = updatedAt` ของแถวที่เพิ่ง update, `dedupeKey = 'CREDIT_AI_SCORED:<creditCheckId>:<updatedAt ISO>'`)
  - `ContractsModule` และ `CreditCheckModule` import `CustomerJourneyModule`
  - ไม่มี query DB ใหม่ใน task นี้ (แถวถูกเขียนโดย writer ที่มี `*.db.spec.ts` ของตัวเองแล้ว) ⇒ เทส unit ที่ mock writer ตาม scope · `src/cli/test-pack/_drive.ts:203` เรียก `workflow.activate` ตรง = ไม่มี entry (ข้อมูลทดสอบเท่านั้น; cron `journey:entry-guard` ของ Task 9 รายงานช่องโหว่)

- [ ] **Step 1: เทสแดง — `CONTRACT_ACTIVATED` ใน controller**

สร้าง `apps/api/src/modules/contracts/contracts.controller.journey.spec.ts`:
```ts
import { Prisma } from '@prisma/client';
import { ContractsController } from './contracts.controller';
import type { ContractsService } from './contracts.service';
import type { ContractWorkflowService } from './contract-workflow.service';
import type { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { sanitizeJourneyData } from '../customer-journey/journey-data-schemas';

const USER = { id: 'fm-1', role: 'FINANCE_MANAGER', branchId: 'branch-1' };
const ACTIVATED = {
  id: 'contract-1',
  contractNumber: 'BC-2026-001',
  customerId: 'customer-1',
  status: 'ACTIVE',
  totalMonths: 12,
  monthlyPayment: new Prisma.Decimal('1813.00'),
  customer: { phone: '0812345678', nationalId: '1234567890123', addressCurrent: 'บ้านเลขที่ 9 ถนนพหลโยธิน' },
};

function build() {
  const contractsService = { findOne: jest.fn().mockResolvedValue({ id: 'contract-1' }) };
  const workflowService = { activate: jest.fn().mockResolvedValue(ACTIVATED) };
  const journeyEntries = { recordAfterCommit: jest.fn().mockResolvedValue(undefined), recordInTx: jest.fn() };
  const controller = new ContractsController(
    contractsService as unknown as ContractsService,
    workflowService as unknown as ContractWorkflowService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    journeyEntries as unknown as JourneyEntryWriter,
  );
  return { controller, contractsService, workflowService, journeyEntries };
}

describe('ContractsController.activate — บันทึก CONTRACT_ACTIVATED หลัง commit', () => {
  it('เปิดสัญญาสำเร็จ → เขียน entry หนึ่งแถว ผูกผู้กดเปิด และคืนผลของ activate เดิม', async () => {
    const { controller, contractsService, workflowService, journeyEntries } = build();
    const before = Date.now();

    const res = await controller.activate('contract-1', USER);

    expect(res).toBe(ACTIVATED);
    expect(contractsService.findOne).toHaveBeenCalledWith('contract-1', USER);
    expect(workflowService.activate).toHaveBeenCalledWith('contract-1');
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledTimes(1);
    const entry = journeyEntries.recordAfterCommit.mock.calls[0][0];
    expect(entry).toEqual({
      customerId: 'customer-1',
      kind: 'CONTRACT_ACTIVATED',
      occurredAt: expect.any(Date),
      actorType: 'STAFF',
      actorUserId: 'fm-1',
      refType: 'contract',
      refId: 'contract-1',
      data: { contractNumber: 'BC-2026-001', totalMonths: 12, monthlyPayment: 1813 },
      dedupeKey: 'CONTRACT_ACTIVATED:contract-1',
    });
    expect(sanitizeJourneyData(entry.kind, entry.data)).toEqual({ ok: true, data: entry.data });
    expect(entry.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(entry.occurredAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(workflowService.activate.mock.invocationCallOrder[0]).toBeLessThan(
      journeyEntries.recordAfterCommit.mock.invocationCallOrder[0],
    );
  });

  it('PDPA — entry ไม่มีเบอร์ เลขบัตร หรือที่อยู่ของลูกค้า', async () => {
    const { controller, journeyEntries } = build();
    await controller.activate('contract-1', USER);
    const serialized = JSON.stringify(journeyEntries.recordAfterCommit.mock.calls[0][0]);
    expect(serialized).not.toContain('0812345678');
    expect(serialized).not.toContain('1234567890123');
    expect(serialized).not.toContain('บ้านเลขที่');
  });

  it('activate ล้ม (เช่นสัญญายังไม่อนุมัติ) → ไม่เขียน entry และโยน error เดิม', async () => {
    const { controller, workflowService, journeyEntries } = build();
    workflowService.activate.mockRejectedValue(new Error('สัญญาต้องได้รับการอนุมัติก่อนเปิดใช้งาน'));
    await expect(controller.activate('contract-1', USER)).rejects.toThrow('สัญญาต้องได้รับการอนุมัติก่อนเปิดใช้งาน');
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('ด่านสาขาไม่ผ่าน → ไม่เรียก activate และไม่เขียน entry', async () => {
    const { controller, contractsService, workflowService, journeyEntries } = build();
    contractsService.findOne.mockRejectedValue(new Error('ไม่พบสัญญา'));
    await expect(controller.activate('contract-1', USER)).rejects.toThrow('ไม่พบสัญญา');
    expect(workflowService.activate).not.toHaveBeenCalled();
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: รันให้แดง**

จาก `apps/api`:
```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/contracts/contracts.controller.journey.spec.ts --runInBand
```
Expected: FAIL — `error TS2554: Expected 6 arguments, but got 7.`

- [ ] **Step 3: เขียน `CONTRACT_ACTIVATED` ใน `contracts.controller.ts`**

ต่อจากบรรทัด 20 (`import { CurrentUser } ...`) เพิ่ม:
```ts
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { journeyDedupeKey } from '../customer-journey/journey-data-schemas';
import { d } from '../../utils/decimal.util';
```
แทน constructor บรรทัด 27-34 ด้วย:
```ts
  constructor(
    private contractsService: ContractsService,
    private workflowService: ContractWorkflowService,
    private paymentService: ContractPaymentService,
    private documentService: ContractDocumentService,
    private snapshotService: ContractSnapshotService,
    private contractJournalQuery: ContractJournalQueryService,
    private journeyEntries: JourneyEntryWriter,
  ) {}
```
แทน handler บรรทัด 176-185 ด้วย:
```ts
  @Post(':id/activate')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async activate(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    // Enforce branch-level access before activation
    await this.contractsService.findOne(id, user);
    const activated = await this.workflowService.activate(id);
    // การเดินทางของลูกค้า: contracts ไม่มี activatedAt และ activate(id) ไม่รับผู้ใช้ ⇒ บันทึกที่นี่หลัง tx ของ activate commit แล้ว
    // recordAfterCommit ไม่โยน error — สัญญาเปิดสำเร็จแล้วต้องคืนผลเสมอ · ไม่คัดลอกข้อมูลลูกค้า (PDPA)
    await this.journeyEntries.recordAfterCommit({
      customerId: activated.customerId,
      kind: 'CONTRACT_ACTIVATED',
      occurredAt: new Date(),
      actorType: 'STAFF',
      actorUserId: user.id,
      refType: 'contract',
      refId: activated.id,
      data: {
        contractNumber: activated.contractNumber,
        totalMonths: activated.totalMonths,
        monthlyPayment: d(activated.monthlyPayment).toDecimalPlaces(2).toNumber(),
      },
      dedupeKey: journeyDedupeKey('CONTRACT_ACTIVATED', activated.id),
    });
    return activated;
  }
```

- [ ] **Step 4: รันให้เขียว + เห็นว่าเทส HTTP เดิมพังเพราะ DI**

```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/contracts/contracts.controller.journey.spec.ts --runInBand
```
Expected: PASS 4 tests
```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/contracts/contract-quote.http.spec.ts --runInBand
```
Expected: FAIL — `Nest can't resolve dependencies of the ContractsController (ContractsService, ContractWorkflowService, ContractPaymentService, ContractDocumentService, ContractSnapshotService, ContractJournalQueryService, ?)`

- [ ] **Step 5: stub ใน `contract-quote.http.spec.ts` + ผูกโมดูลใน `contracts.module.ts`**

`contract-quote.http.spec.ts` ต่อจากบรรทัด 15 (`import { BranchGuard } ...`) เพิ่ม:
```ts
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
```
แทนบรรทัด 31-32 ด้วย:
```ts
      ...[ContractWorkflowService, ContractPaymentService, ContractDocumentService, ContractSnapshotService, ContractJournalQueryService, JourneyEntryWriter]
        .map(provide => ({ provide, useValue: {} })),
```
`contracts.module.ts` ต่อจากบรรทัด 22 (`import { ReceiptsModule } ...`) เพิ่ม:
```ts
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';
```
แทนบรรทัด 41-44 (ท้าย array `imports`) ด้วย:
```ts
    // EARLY_PAYOFF receipt generation. forwardRef breaks the
    // Contracts → Receipts → LineOa → Contracts module cycle.
    forwardRef(() => ReceiptsModule),
    // การเดินทางของลูกค้า: ContractsController เขียน CONTRACT_ACTIVATED และ ContractWorkflowService
    // เขียน CONTRACT_REVIEWED ผ่าน JourneyEntryWriter — CustomerJourneyModule ไม่ import โมดูลโดเมน จึงไม่มีวงจร
    CustomerJourneyModule,
  ],
```
Run:
```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/contracts/contract-quote.http.spec.ts src/modules/contracts/contracts.controller.spec.ts --runInBand
```
Expected: PASS ทั้ง 2 suite

- [ ] **Step 6: เทสแดง — `CONTRACT_REVIEWED` ทุกรอบ**

สร้าง `apps/api/src/modules/contracts/contract-workflow.journey.spec.ts`:
```ts
import { ContractWorkflowService } from './contract-workflow.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { sanitizeJourneyData } from '../customer-journey/journey-data-schemas';

jest.mock('../../utils/validation.util', () => ({
  ...jest.requireActual('../../utils/validation.util'),
  checkAgeEligibility: jest.fn().mockReturnValue({ eligible: true, requiresGuardian: false }),
  checkRequiredDocuments: jest.fn().mockReturnValue({ complete: true, checklist: [] }),
  checkRequiredSignatures: jest.fn().mockReturnValue({ complete: true, checklist: [] }),
}));

const REVIEW_NOTE = 'บัตรไม่ชัด โทรกลับ 081-234-5678';

function pendingContract() {
  return {
    id: 'contract-1',
    contractNumber: 'BC-2026-001',
    customerId: 'customer-1',
    salespersonId: 'sales-1',
    workflowStatus: 'PENDING_REVIEW',
    status: 'DRAFT',
    contractHash: null,
    deletedAt: null,
    customer: { birthDate: null, phone: '0812345678', nationalId: '1234567890123' },
    signatures: [],
    contractDocuments: [],
    creditCheck: null,
  };
}

function build(withWriter = true) {
  const prisma = {
    contract: {
      findUnique: jest.fn().mockResolvedValue(pendingContract()),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const journeyEntries = { recordAfterCommit: jest.fn().mockResolvedValue(undefined), recordInTx: jest.fn() };
  const stub = {} as never;
  const service = new ContractWorkflowService(
    prisma as unknown as PrismaService,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    undefined,
    withWriter ? (journeyEntries as unknown as JourneyEntryWriter) : undefined,
  );
  return { service, prisma, journeyEntries };
}

describe('ContractWorkflowService — CONTRACT_REVIEWED ทุกรอบ', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date('2026-09-15T03:00:00.000Z'),
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('อนุมัติ → entry ใช้ reviewedAt ตัวเดียวกับที่เขียนลงสัญญา ผู้ตรวจเป็น STAFF และเขียนหลัง update', async () => {
    const { service, prisma, journeyEntries } = build();

    await service.approveContract('contract-1', 'fm-1', 'FINANCE_MANAGER', 'เอกสารครบ');

    const reviewedAt: Date = prisma.contract.update.mock.calls[0][0].data.reviewedAt;
    expect(reviewedAt.toISOString()).toBe('2026-09-15T03:00:00.000Z');
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledTimes(1);
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledWith({
      customerId: 'customer-1',
      kind: 'CONTRACT_REVIEWED',
      occurredAt: reviewedAt,
      actorType: 'STAFF',
      actorUserId: 'fm-1',
      refType: 'contract',
      refId: 'contract-1',
      data: { decision: 'APPROVED', contractNumber: 'BC-2026-001' },
      dedupeKey: 'CONTRACT_REVIEWED:contract-1:2026-09-15T03:00:00.000Z',
    });
    const reviewed = journeyEntries.recordAfterCommit.mock.calls[0][0];
    expect(sanitizeJourneyData(reviewed.kind, reviewed.data)).toEqual({ ok: true, data: reviewed.data });
    expect(prisma.contract.update.mock.invocationCallOrder[0]).toBeLessThan(
      journeyEntries.recordAfterCommit.mock.invocationCallOrder[0],
    );
  });

  it('ตีกลับ → decision REJECTED และไม่คัดลอกหมายเหตุ (ข้อความอิสระอาจมีเบอร์)', async () => {
    const { service, journeyEntries } = build();

    await service.rejectContract('contract-1', 'fm-1', 'FINANCE_MANAGER', REVIEW_NOTE);

    const entry = journeyEntries.recordAfterCommit.mock.calls[0][0];
    expect(entry).toMatchObject({
      kind: 'CONTRACT_REVIEWED',
      actorType: 'STAFF',
      actorUserId: 'fm-1',
      data: { decision: 'REJECTED', contractNumber: 'BC-2026-001' },
      dedupeKey: 'CONTRACT_REVIEWED:contract-1:2026-09-15T03:00:00.000Z',
    });
    expect(Object.keys(entry.data).sort()).toEqual(['contractNumber', 'decision']);
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('081-234-5678');
    expect(serialized).not.toContain('0812345678');
    expect(serialized).not.toContain('1234567890123');
  });

  it('ตีกลับ แล้วส่งใหม่ แล้วอนุมัติ → 2 entry คนละ dedupeKey (skipDuplicates ไม่กลืนรอบหลัง)', async () => {
    const { service, journeyEntries } = build();

    await service.rejectContract('contract-1', 'fm-1', 'FINANCE_MANAGER', 'แก้ที่อยู่ตามบัตร');
    jest.setSystemTime(new Date('2026-09-16T08:30:00.000Z'));
    await service.approveContract('contract-1', 'owner-1', 'OWNER');

    const keys = journeyEntries.recordAfterCommit.mock.calls.map(([entry]) => entry.dedupeKey);
    expect(keys).toEqual(['CONTRACT_REVIEWED:contract-1:2026-09-15T03:00:00.000Z', 'CONTRACT_REVIEWED:contract-1:2026-09-16T08:30:00.000Z']);
    expect(journeyEntries.recordAfterCommit.mock.calls[1][0]).toMatchObject({ actorUserId: 'owner-1', data: { decision: 'APPROVED' } });
  });

  it('ผู้ขายตีกลับสัญญาตัวเอง (Forbidden) → ไม่ update และไม่เขียน entry', async () => {
    const { service, prisma, journeyEntries } = build();
    await expect(service.rejectContract('contract-1', 'sales-1', 'SALES', 'ขอแก้')).rejects.toThrow('ไม่สามารถปฏิเสธสัญญาที่ตัวเองสร้างได้');
    expect(prisma.contract.update).not.toHaveBeenCalled();
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('เขียนสัญญาไม่สำเร็จ → ไม่เขียน entry', async () => {
    const { service, prisma, journeyEntries } = build();
    prisma.contract.update.mockRejectedValue(new Error('db down'));
    await expect(service.approveContract('contract-1', 'fm-1', 'FINANCE_MANAGER')).rejects.toThrow('db down');
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('ไม่มี JourneyEntryWriter (เทสเดิมที่ประกอบ service เอง) → อนุมัติได้ตามเดิม', async () => {
    const { service, prisma } = build(false);
    await expect(service.approveContract('contract-1', 'fm-1', 'FINANCE_MANAGER')).resolves.toBeDefined();
    expect(prisma.contract.update).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 7: รันให้แดง**

```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/contracts/contract-workflow.journey.spec.ts --runInBand
```
Expected: FAIL — `error TS2554: Expected 9-10 arguments, but got 11.`

- [ ] **Step 8: เขียน `CONTRACT_REVIEWED` ใน `contract-workflow.service.ts`**

ต่อจากบรรทัด 32 (`import { lockCreditCustomer } ...`) เพิ่ม (import แบบค่า ห้าม `import type` — Nest อ่าน `design:paramtypes` เป็น token ถ้าเป็น type-only จะได้ `Object` แล้ว `@Optional` ฉีด `undefined` เงียบ ๆ):
```ts
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { journeyDedupeKey } from '../customer-journey/journey-data-schemas';
```
แทนบรรทัด 47 (`@Optional() private testMode?: TestModeService,`) ด้วย:
```ts
    @Optional() private testMode?: TestModeService,
    // การเดินทางของลูกค้า (CONTRACT_REVIEWED) — @Optional: เทสเดิมประกอบ service ด้วย 9-10 อาร์กิวเมนต์
    // ContractsModule import CustomerJourneyModule อยู่แล้ว (ContractsController ฉีดแบบบังคับ ถ้าลืม import แอปจะบูตไม่ขึ้น)
    @Optional() private journeyEntries?: JourneyEntryWriter,
```
ใน `approveContract` แทนบรรทัด 310-320:
```ts
    await this.prisma.contract.update({
      where: { id },
      data: {
        workflowStatus: 'APPROVED',
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNotes,
      },
    });

    return this.findOne(id);
```
ด้วย:
```ts
    const reviewedAt = new Date();
    await this.prisma.contract.update({
      where: { id },
      data: {
        workflowStatus: 'APPROVED',
        reviewedById: userId,
        reviewedAt,
        reviewNotes,
      },
    });
    await this.recordReviewRound(contract, 'APPROVED', userId, reviewedAt);

    return this.findOne(id);
```
ใน `rejectContract` แทนบรรทัด 336-346:
```ts
    await this.prisma.contract.update({
      where: { id },
      data: {
        workflowStatus: 'REJECTED',
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNotes,
      },
    });

    return this.findOne(id);
```
ด้วย:
```ts
    const reviewedAt = new Date();
    await this.prisma.contract.update({
      where: { id },
      data: {
        workflowStatus: 'REJECTED',
        reviewedById: userId,
        reviewedAt,
        reviewNotes,
      },
    });
    await this.recordReviewRound(contract, 'REJECTED', userId, reviewedAt);

    return this.findOne(id);
```
เพิ่มเมธอดใหม่ระหว่างวงเล็บปิดของ `rejectContract` กับ `async activate(id: string) {` (บรรทัด 349):
```ts
  /**
   * การเดินทางของลูกค้า — contracts.reviewedAt/workflowStatus ถูกเขียนทับทุกรอบ เหลือแค่รอบล่าสุด
   * ⇒ เก็บทุกรอบเป็น entry หลัง update สำเร็จ (update เดี่ยว = commit แล้ว) · dedupeKey ผูกเวลาของรอบ
   * ไม่คัดลอก reviewNotes: ข้อความอิสระอาจมีเบอร์/ที่อยู่ และคอลัมน์ data ถูก grant ให้ MCP
   * recordAfterCommit ไม่โยน error ⇒ การอนุมัติ/ตีกลับไม่มีทางล้มเพราะบันทึกนี้
   */
  private async recordReviewRound(
    contract: { id: string; customerId: string; contractNumber: string },
    decision: 'APPROVED' | 'REJECTED',
    userId: string,
    reviewedAt: Date,
  ): Promise<void> {
    if (!this.journeyEntries) return;
    await this.journeyEntries.recordAfterCommit({
      customerId: contract.customerId,
      kind: 'CONTRACT_REVIEWED',
      occurredAt: reviewedAt,
      actorType: 'STAFF',
      actorUserId: userId,
      refType: 'contract',
      refId: contract.id,
      data: { decision, contractNumber: contract.contractNumber },
      dedupeKey: journeyDedupeKey('CONTRACT_REVIEWED', contract.id, reviewedAt.toISOString()),
    });
  }

```

- [ ] **Step 9: รันให้เขียว**

```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/contracts/contract-workflow.journey.spec.ts --runInBand
```
Expected: PASS 6 tests

- [ ] **Step 10: เทสแดง — `CREDIT_CHECK_OPENED_BY` ใน controller ตรวจเครดิต**

สร้าง `apps/api/src/modules/credit-check/credit-check.controller.journey.spec.ts`:
```ts
import { CreditCheckController, CustomerCreditCheckController } from './credit-check.controller';
import type { CreditCheckService } from './credit-check.service';
import type { CreateCreditCheckDto } from './dto/credit-check.dto';
import type { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { sanitizeJourneyData } from '../customer-journey/journey-data-schemas';

const DTO: CreateCreditCheckDto = { bankName: 'KBank', statementFiles: ['data:image/png;base64,QUJD'], statementMonths: 3 };
const USER = { id: 'sales-1' };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cc-1',
    customerId: 'customer-1',
    contractId: null,
    status: 'PENDING',
    createdAt: new Date(),
    customer: { id: 'customer-1', name: 'สมชาย ใจดี', phone: '0812345678', salary: 30000, occupation: 'พนักงาน' },
    ...overrides,
  };
}

function build() {
  const service = { create: jest.fn(), createForCustomer: jest.fn() };
  const journeyEntries = { recordAfterCommit: jest.fn().mockResolvedValue(undefined), recordInTx: jest.fn() };
  const svc = service as unknown as CreditCheckService;
  const writer = journeyEntries as unknown as JourneyEntryWriter;
  return {
    service,
    journeyEntries,
    contractController: new CreditCheckController(svc, writer),
    customerController: new CustomerCreditCheckController(svc, writer),
  };
}

describe('CREDIT_CHECK_OPENED_BY — ผู้เปิดตรวจเครดิต (service ทิ้ง _userId)', () => {
  it('POST /customers/:id/credit-check → entry ผูกพนักงานที่เปิด เวลา = createdAt ของใบ', async () => {
    const { service, journeyEntries, customerController } = build();
    const created = row();
    service.createForCustomer.mockResolvedValue(created);

    const res = await customerController.create('customer-1', DTO, USER);

    expect(res).toBe(created);
    expect(service.createForCustomer).toHaveBeenCalledWith('customer-1', DTO, 'sales-1');
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledTimes(1);
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledWith({
      customerId: 'customer-1',
      kind: 'CREDIT_CHECK_OPENED_BY',
      occurredAt: created.createdAt,
      actorType: 'STAFF',
      actorUserId: 'sales-1',
      refType: 'credit_check',
      refId: 'cc-1',
      data: { via: 'CUSTOMER' },
      dedupeKey: 'CREDIT_CHECK_OPENED_BY:cc-1',
    });
    const opened = journeyEntries.recordAfterCommit.mock.calls[0][0];
    expect(sanitizeJourneyData(opened.kind, opened.data)).toEqual({ ok: true, data: opened.data });
  });

  it('POST /contracts/:id/credit-check สร้างใบใหม่ → via CONTRACT และ customerId มาจากใบที่สร้าง', async () => {
    const { service, journeyEntries, contractController } = build();
    const created = row({ id: 'cc-2', customerId: 'customer-9', contractId: 'contract-1' });
    service.create.mockResolvedValue(created);

    await expect(contractController.create('contract-1', DTO, USER)).resolves.toBe(created);

    expect(service.create).toHaveBeenCalledWith('contract-1', DTO, 'sales-1');
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'customer-9',
        kind: 'CREDIT_CHECK_OPENED_BY',
        actorUserId: 'sales-1',
        refId: 'cc-2',
        data: { via: 'CONTRACT' },
        dedupeKey: 'CREDIT_CHECK_OPENED_BY:cc-2',
      }),
    );
  });

  it('อัปโหลดสเตทเม้นใหม่ให้ใบเดิมของสัญญา (createdAt เก่า) → ไม่ใช่การเปิดตรวจ ไม่เขียน entry', async () => {
    const { service, journeyEntries, contractController } = build();
    const existing = row({ contractId: 'contract-1', createdAt: new Date(Date.now() - 10 * 60_000) });
    service.create.mockResolvedValue(existing);

    await expect(contractController.create('contract-1', DTO, USER)).resolves.toBe(existing);
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('service ล้ม (ไม่พบลูกค้า) → โยน error เดิม ไม่เขียน entry', async () => {
    const { service, journeyEntries, customerController } = build();
    service.createForCustomer.mockRejectedValue(new Error('ไม่พบลูกค้า'));
    await expect(customerController.create('nope', DTO, USER)).rejects.toThrow('ไม่พบลูกค้า');
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('PDPA — entry ไม่มีชื่อ เบอร์ หรือเงินเดือนของลูกค้า', async () => {
    const { service, journeyEntries, customerController } = build();
    service.createForCustomer.mockResolvedValue(row());
    await customerController.create('customer-1', DTO, USER);
    const entry = journeyEntries.recordAfterCommit.mock.calls[0][0];
    expect(Object.keys(entry.data)).toEqual(['via']);
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('0812345678');
    expect(serialized).not.toContain('สมชาย');
    expect(serialized).not.toContain('salary');
  });
});
```

- [ ] **Step 11: รันให้แดง**

```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/credit-check/credit-check.controller.journey.spec.ts --runInBand
```
Expected: FAIL — `error TS2554: Expected 1 arguments, but got 2.`

- [ ] **Step 12: เขียน `CREDIT_CHECK_OPENED_BY` ใน `credit-check.controller.ts` + ผูกโมดูล**

ต่อจากบรรทัด 10 (`import { CreditAffordabilityDto } ...`) เพิ่ม import และ helper (วางก่อนบรรทัด 12 `// === Global credit check list ===`):
```ts
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { journeyDedupeKey } from '../customer-journey/journey-data-schemas';

/**
 * การเดินทางของลูกค้า — ผู้เปิดตรวจเครดิต: CreditCheckService.create/createForCustomer ทิ้ง _userId
 * ⇒ บันทึกที่ controller หลัง service คืนผล (tx ของ service commit แล้ว) โดยไม่แก้ service
 * บันทึกเฉพาะใบที่เพิ่งเกิดในคำขอนี้: POST /contracts/:id/credit-check กับใบเดิมคือการอัปโหลดใหม่ ไม่ใช่การเปิดตรวจ
 * เผื่อเวลา DB (created_at DEFAULT now()) กับเครื่องแอปคลาดกัน 60 วินาที · กดซ้ำภายใน 30 วินาทีได้ใบเดิม → dedupeKey กันแถวซ้ำ
 */
const OPENED_IN_REQUEST_TOLERANCE_MS = 60_000;

async function recordCreditCheckOpened(
  writer: JourneyEntryWriter,
  check: { id: string; customerId: string; createdAt: Date },
  userId: string,
  via: 'CONTRACT' | 'CUSTOMER',
  requestStartedAt: Date,
): Promise<void> {
  if (check.createdAt.getTime() < requestStartedAt.getTime() - OPENED_IN_REQUEST_TOLERANCE_MS) return;
  await writer.recordAfterCommit({
    customerId: check.customerId,
    kind: 'CREDIT_CHECK_OPENED_BY',
    occurredAt: check.createdAt,
    actorType: 'STAFF',
    actorUserId: userId,
    refType: 'credit_check',
    refId: check.id,
    data: { via },
    dedupeKey: journeyDedupeKey('CREDIT_CHECK_OPENED_BY', check.id),
  });
}
```
`CreditCheckController` แทนบรรทัด 100 ด้วย:
```ts
  constructor(private service: CreditCheckService, private journeyEntries: JourneyEntryWriter) {}
```
แทนบรรทัด 108-116 ด้วย:
```ts
  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  async create(
    @Param('contractId') contractId: string,
    @Body() dto: CreateCreditCheckDto,
    @CurrentUser() user: { id: string },
  ) {
    const startedAt = new Date();
    const creditCheck = await this.service.create(contractId, dto, user.id);
    await recordCreditCheckOpened(this.journeyEntries, creditCheck, user.id, 'CONTRACT', startedAt);
    return creditCheck;
  }
```
`CustomerCreditCheckController` แทนบรรทัด 139 ด้วย:
```ts
  constructor(private service: CreditCheckService, private journeyEntries: JourneyEntryWriter) {}
```
แทนบรรทัด 153-161 ด้วย:
```ts
  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  async create(
    @Param('customerId') customerId: string,
    @Body() dto: CreateCreditCheckDto,
    @CurrentUser() user: { id: string },
  ) {
    const startedAt = new Date();
    const creditCheck = await this.service.createForCustomer(customerId, dto, user.id);
    await recordCreditCheckOpened(this.journeyEntries, creditCheck, user.id, 'CUSTOMER', startedAt);
    return creditCheck;
  }
```
แทนทั้งไฟล์ `credit-check.module.ts` ด้วย:
```ts
import { Module } from '@nestjs/common';
import { GlobalCreditCheckController, CreditCheckController, CustomerCreditCheckController } from './credit-check.controller';
import { CreditCheckService } from './credit-check.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';

@Module({
  // CustomerJourneyModule — ผู้เปิดตรวจเครดิต (controller) + ผล AI ประเมินเครดิต (service) ของการเดินทางลูกค้า
  // โมดูลนั้นไม่ import โมดูลโดเมน จึงไม่มีวงจรกับ CustomersModule ที่ import ทั้งสองโมดูล
  imports: [IntegrationsModule, CustomerJourneyModule],
  controllers: [GlobalCreditCheckController, CreditCheckController, CustomerCreditCheckController],
  providers: [CreditCheckService],
  exports: [CreditCheckService],
})
export class CreditCheckModule {}
```

- [ ] **Step 13: รันให้เขียว**

```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/credit-check/credit-check.controller.journey.spec.ts --runInBand
```
Expected: PASS 5 tests

- [ ] **Step 14: เทสแดง — `CREDIT_AI_SCORED`**

สร้าง `apps/api/src/modules/credit-check/services/credit-check-ai-analysis.journey.spec.ts`:
```ts
import { CreditCheckAiAnalysisService } from './credit-check-ai-analysis.service';
import { CreditCheckService } from '../credit-check.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { IntegrationConfigService } from '../../integrations/integration-config.service';
import { AiProviderService } from '../../ai-usage/ai-provider.service';
import type { AiUsageService } from '../../ai-usage/ai-usage.service';
import type { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { sanitizeJourneyData } from '../../customer-journey/journey-data-schemas';

const UPDATED_AT = new Date('2026-09-15T04:12:30.456Z');

function creditCheckRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cc-1',
    customerId: 'customer-1',
    deletedAt: null,
    aiAnalysis: null,
    bankName: 'KBank',
    statementMonths: 3,
    statementFiles: ['a.jpg', 'b.jpg', 'c.jpg'],
    customer: { name: 'สมชาย ใจดี', salary: 30000, occupation: 'พนักงาน', occupationDetail: null },
    contract: { monthlyPayment: 6000, totalMonths: 12, financedAmount: 60000 },
    ...overrides,
  };
}

function build(options: { writer?: boolean; row?: unknown } = {}) {
  const db = {
    creditCheck: {
      findUnique: jest.fn().mockResolvedValue(options.row === undefined ? creditCheckRow() : options.row),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'cc-1',
        customerId: 'customer-1',
        ...data,
        updatedAt: UPDATED_AT,
      })),
    },
  };
  // getValue → null ⇒ ไม่มี Claude client ⇒ ทาง rule-based (ไม่ยิงเครือข่าย)
  const config = { getValue: jest.fn().mockResolvedValue(null) } as unknown as IntegrationConfigService;
  const provider = new AiProviderService({ record: jest.fn() } as unknown as AiUsageService);
  const journeyEntries = { recordAfterCommit: jest.fn().mockResolvedValue(undefined), recordInTx: jest.fn() };
  const writer = options.writer === false ? undefined : (journeyEntries as unknown as JourneyEntryWriter);
  const service = new CreditCheckAiAnalysisService(db as unknown as PrismaService, config, provider, writer);
  return { service, db, config, provider, writer, journeyEntries };
}

const EXPECTED_ENTRY = {
  customerId: 'customer-1',
  kind: 'CREDIT_AI_SCORED',
  occurredAt: UPDATED_AT,
  actorType: 'SYSTEM',
  actorUserId: null,
  refType: 'credit_check',
  refId: 'cc-1',
  // rule-based: 50 + ค่างวด 6000/30000 = 20% (+30) + statement 3 ไฟล์ (+10) + มีอาชีพ (+5) = 95 → APPROVED
  data: { score: 95, status: 'APPROVED' },
  dedupeKey: 'CREDIT_AI_SCORED:cc-1:2026-09-15T04:12:30.456Z',
};

type Variant = { label: string; run: (service: CreditCheckAiAnalysisService) => Promise<unknown> };
const VARIANTS: Variant[] = [
  { label: 'analyzeForCustomer', run: (service) => service.analyzeForCustomer('cc-1', 'sales-1') },
  { label: 'analyze', run: (service) => service.analyze('contract-1', 'sales-1') },
];

describe('CREDIT_AI_SCORED — ผล AI ประเมินเครดิตแต่ละรอบ', () => {
  it.each(VARIANTS)('$label → entry หลังเขียน status · เวลา = updatedAt ของรอบนี้ · ผู้กระทำ = ระบบ', async ({ run }) => {
    const { service, db, journeyEntries } = build();

    const res = await run(service);

    expect(res).toMatchObject({ id: 'cc-1', status: 'APPROVED', aiScore: 95 });
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledTimes(1);
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledWith(EXPECTED_ENTRY);
    expect(sanitizeJourneyData(EXPECTED_ENTRY.kind, EXPECTED_ENTRY.data)).toEqual({ ok: true, data: EXPECTED_ENTRY.data });
    expect(db.creditCheck.update.mock.invocationCallOrder[0]).toBeLessThan(
      journeyEntries.recordAfterCommit.mock.invocationCallOrder[0],
    );
  });

  it('PDPA/การเงิน — data มีแค่คะแนนกับผล ไม่มีสรุป AI ชื่อ หรือรายได้', async () => {
    const { service, journeyEntries } = build();
    await service.analyzeForCustomer('cc-1', 'sales-1');
    const entry = journeyEntries.recordAfterCommit.mock.calls[0][0];
    expect(Object.keys(entry.data).sort()).toEqual(['score', 'status']);
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('สมชาย');
    expect(serialized).not.toContain('รายได้');
    expect(serialized).not.toContain('30,000');
  });

  it('วิเคราะห์ใหม่คนละรอบ → dedupeKey ต่างกันตาม updatedAt', async () => {
    const { service, db, journeyEntries } = build();
    await service.analyzeForCustomer('cc-1', 'sales-1');
    db.creditCheck.update.mockImplementationOnce(async ({ data }) => ({
      id: 'cc-1',
      customerId: 'customer-1',
      ...data,
      updatedAt: new Date('2026-09-16T01:00:00.000Z'),
    }));
    await service.analyzeForCustomer('cc-1', 'sales-1');
    expect(journeyEntries.recordAfterCommit.mock.calls.map(([entry]) => entry.dedupeKey)).toEqual([
      'CREDIT_AI_SCORED:cc-1:2026-09-15T04:12:30.456Z',
      'CREDIT_AI_SCORED:cc-1:2026-09-16T01:00:00.000Z',
    ]);
  });

  it('update ล้ม → ไม่เขียน entry', async () => {
    const { service, db, journeyEntries } = build();
    db.creditCheck.update.mockRejectedValueOnce(new Error('db down'));
    await expect(service.analyzeForCustomer('cc-1', 'sales-1')).rejects.toThrow('db down');
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('ใบจากสเตทเม้นในแชทถูกปฏิเสธก่อนวิเคราะห์ → ไม่เขียน entry', async () => {
    const { service, journeyEntries } = build({ row: creditCheckRow({ aiAnalysis: { source: 'chat-statement' } }) });
    await expect(service.analyzeForCustomer('cc-1', 'sales-1')).rejects.toThrow('รายการนี้อ่านจากสเตทเม้นในแชท');
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('ไม่ส่ง writer (เทสเดิมที่ประกอบ 3 อาร์กิวเมนต์) → วิเคราะห์ได้ตามเดิม', async () => {
    const { service, db } = build({ writer: false });
    await expect(service.analyze('contract-1')).resolves.toMatchObject({ status: 'APPROVED' });
    expect(db.creditCheck.update).toHaveBeenCalledTimes(1);
  });

  it('CreditCheckService ส่ง writer ที่ Nest ฉีดให้ต่อไปยัง sub-service', async () => {
    const { db, config, provider, writer, journeyEntries } = build();
    const facade = new CreditCheckService(db as unknown as PrismaService, config, provider, writer);
    await facade.analyzeForCustomer('cc-1', 'sales-1');
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledWith(EXPECTED_ENTRY);
  });
});
```

- [ ] **Step 15: รันให้แดง**

```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/credit-check/services/credit-check-ai-analysis.journey.spec.ts --runInBand
```
Expected: FAIL — `error TS2554: Expected 3 arguments, but got 4.`

- [ ] **Step 16: เขียน `CREDIT_AI_SCORED` ใน `credit-check-ai-analysis.service.ts` + ส่ง writer จาก facade**

`credit-check-ai-analysis.service.ts` ต่อจากบรรทัด 4 (`import { IntegrationConfigService } ...`) เพิ่ม (คลาสนี้ไม่มี decorator จึงใช้ `import type` ได้):
```ts
import type { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { journeyDedupeKey } from '../../customer-journey/journey-data-schemas';
```
แทน constructor บรรทัด 18-22 ด้วย:
```ts
  constructor(
    private prisma: PrismaService,
    private integrationConfig: IntegrationConfigService,
    private provider: AiProviderService,
    // การเดินทางของลูกค้า (CREDIT_AI_SCORED) — ไม่บังคับ: เทสเดิมประกอบด้วย 3 อาร์กิวเมนต์
    private journeyEntries?: JourneyEntryWriter,
  ) {}
```
ใน `analyzeForCustomer` แทนบรรทัด 62-75:
```ts
    return this.prisma.creditCheck.update({
      where: { id: creditCheckId },
      data: {
        aiAnalysis: aiAnalysis.analysis,
        aiScore: aiAnalysis.score,
        aiSummary: aiAnalysis.summary,
        aiRecommendation: aiAnalysis.recommendation,
        status: aiAnalysis.score >= 60 ? 'APPROVED' : aiAnalysis.score >= 40 ? 'MANUAL_REVIEW' : 'REJECTED',
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
```
ด้วย:
```ts
    const updated = await this.prisma.creditCheck.update({
      where: { id: creditCheckId },
      data: {
        aiAnalysis: aiAnalysis.analysis,
        aiScore: aiAnalysis.score,
        aiSummary: aiAnalysis.summary,
        aiRecommendation: aiAnalysis.recommendation,
        status: aiAnalysis.score >= 60 ? 'APPROVED' : aiAnalysis.score >= 40 ? 'MANUAL_REVIEW' : 'REJECTED',
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
    await this.recordAiScored(updated);
    return updated;
```
ใน `analyze` แทนบรรทัด 128-129:
```ts

    return updatedCheck;
```
ด้วย:
```ts
    await this.recordAiScored(updatedCheck);

    return updatedCheck;
```
ต่อจากวงเล็บปิดของ `analyze` (บรรทัด 130) เพิ่ม:
```ts

  /**
   * การเดินทางของลูกค้า — credit_checks.status ถูกเขียนทับทุกรอบ และ updatedAt ขยับทุกครั้งที่แก้แถว (ใช้ย้อนหลังไม่ได้)
   * ⇒ เก็บผลของรอบนี้เป็น entry หลัง update สำเร็จ · occurredAt = updatedAt ที่ update นี้เพิ่งเขียน
   * เก็บแค่คะแนนกับผล ไม่เก็บ aiSummary/aiAnalysis (มีรายได้ ยอดคงเหลือ ชื่อนายจ้าง) · ผู้กระทำ = ระบบ
   */
  private async recordAiScored(check: {
    id: string;
    customerId: string;
    aiScore: number | null;
    status: string;
    updatedAt: Date;
  }): Promise<void> {
    if (!this.journeyEntries) return;
    await this.journeyEntries.recordAfterCommit({
      customerId: check.customerId,
      kind: 'CREDIT_AI_SCORED',
      occurredAt: check.updatedAt,
      actorType: 'SYSTEM',
      actorUserId: null,
      refType: 'credit_check',
      refId: check.id,
      data: { score: check.aiScore, status: check.status },
      dedupeKey: journeyDedupeKey('CREDIT_AI_SCORED', check.id, check.updatedAt.toISOString()),
    });
  }
```
`credit-check.service.ts` แทนบรรทัด 1 ด้วย:
```ts
import { Injectable, Optional } from '@nestjs/common';
```
ต่อจากบรรทัด 10 (`import { CreditHistoryActor } ...`) เพิ่ม (import แบบค่า — ต้องมี `design:paramtypes` จริงให้ Nest ฉีด):
```ts
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
```
แทน constructor บรรทัด 31-40 ด้วย:
```ts
  constructor(
    private prisma: PrismaService,
    private integrationConfig: IntegrationConfigService,
    private provider: AiProviderService,
    // การเดินทางของลูกค้า (CREDIT_AI_SCORED) — @Optional: เทสเดิมประกอบ facade ด้วย 3 อาร์กิวเมนต์
    @Optional() private journeyEntries?: JourneyEntryWriter,
  ) {
    this.risk = new CreditCheckRiskService(this.prisma);
    this.ai = new CreditCheckAiAnalysisService(this.prisma, this.integrationConfig, this.provider, this.journeyEntries);
    this.crud = new CreditCheckCrudService(this.prisma, this.risk); // crud needs risk for background auto-score
    this.override_ = new CreditCheckOverrideService(this.prisma);
  }
```

- [ ] **Step 17: รันให้เขียว**

```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/credit-check/services/credit-check-ai-analysis.journey.spec.ts --runInBand
```
Expected: PASS 8 tests

- [ ] **Step 18: เทสเดิมทั้งสองโมดูล + typecheck + lint + ตรวจการผูกโมดูล**

จาก `apps/api`:
```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/contracts src/modules/credit-check --runInBand
```
Expected: PASS ทุก suite (รวม `contract-workflow.service.spec.ts`, `contract-signing-workflow.spec.ts`, `contract-workflow.schedule.spec.ts`, `contract-hash.spec.ts`, `contract-quote.http.spec.ts`, `credit-check.analyze.spec.ts`, `credit-check.ai-analysis.spec.ts`, `services/credit-affordable-prompt.spec.ts` ที่ไม่ได้ส่ง writer) · ไฟล์ `*.integration.spec.ts` ถูก jest config ข้ามอยู่แล้ว
```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: 0 error
```bash
npx eslint src/modules/contracts/contracts.controller.ts src/modules/contracts/contracts.controller.journey.spec.ts src/modules/contracts/contract-quote.http.spec.ts src/modules/contracts/contracts.module.ts src/modules/contracts/contract-workflow.service.ts src/modules/contracts/contract-workflow.journey.spec.ts src/modules/credit-check/credit-check.controller.ts src/modules/credit-check/credit-check.controller.journey.spec.ts src/modules/credit-check/credit-check.module.ts src/modules/credit-check/credit-check.service.ts src/modules/credit-check/services/credit-check-ai-analysis.service.ts src/modules/credit-check/services/credit-check-ai-analysis.journey.spec.ts
```
Expected: 0 error (🚨 ห้าม `npm run lint` — สคริปต์มี `--fix`)
```bash
grep -n "CustomerJourneyModule" src/modules/contracts/contracts.module.ts src/modules/credit-check/credit-check.module.ts
```
Expected: ไฟล์ละ 2 บรรทัด (import + ใน array `imports`) — `ContractWorkflowService`/`CreditCheckService` ฉีดแบบ `@Optional` ถ้าโมดูลไม่ import จะเงียบ แต่ controller ที่ฉีดแบบบังคับทำให้แอปบูตไม่ขึ้นทันที

- [ ] **Step 19: Commit**

จาก root ของ worktree:
```bash
git add apps/api/src/modules/contracts/contracts.controller.ts apps/api/src/modules/contracts/contracts.controller.journey.spec.ts apps/api/src/modules/contracts/contract-quote.http.spec.ts apps/api/src/modules/contracts/contracts.module.ts apps/api/src/modules/contracts/contract-workflow.service.ts apps/api/src/modules/contracts/contract-workflow.journey.spec.ts apps/api/src/modules/credit-check/credit-check.controller.ts apps/api/src/modules/credit-check/credit-check.controller.journey.spec.ts apps/api/src/modules/credit-check/credit-check.module.ts apps/api/src/modules/credit-check/credit-check.service.ts apps/api/src/modules/credit-check/services/credit-check-ai-analysis.service.ts apps/api/src/modules/credit-check/services/credit-check-ai-analysis.journey.spec.ts
git commit -m "feat(customer-journey): บันทึกเปิดสัญญา ตรวจสัญญาทุกรอบ ผู้เปิดตรวจเครดิต และผล AI ประเมินเครดิต หลัง commit

- CONTRACT_ACTIVATED เขียนใน ContractsController.activate (มีผู้ใช้จาก request ไม่แก้ลายเซ็น activate)
- CONTRACT_REVIEWED ต่อรอบใน approveContract/rejectContract ใช้ reviewedAt ตัวเดียวกับที่เขียนลงสัญญา ไม่คัดลอก reviewNotes
- CREDIT_CHECK_OPENED_BY ใน controller ตรวจเครดิตทั้งทางสัญญาและทางลูกค้า เฉพาะใบที่เพิ่งสร้างในคำขอ
- CREDIT_AI_SCORED หลัง update status ใน analyze/analyzeForCustomer เก็บแค่คะแนนกับผล

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: จุดบันทึกอัตโนมัติฝั่งแชทและตัวตน — BOT_HANDOFF · CONTACT_ADDED · LINE_LINKED · PRODUCT_LINK_CLICK

task นี้เพิ่มจุดเขียนแถว SYSTEM 4 ชนิดที่วันนี้ระบบไม่ได้เก็บเป็นโครงสร้าง (synthesis.json `notRecordedToday`) ทุกจุดเป็นแบบ best-effort คือเรียก `JourneyEntryWriter.recordAfterCommit` **หลัง** การเขียนหลักสำเร็จ และเรียกนอก transaction เสมอ (writer รับประกันว่าไม่โยน error) แถวที่เขียนประกอบจากฟังก์ชันบริสุทธิ์ไฟล์เดียว `chat-identity-entries.ts` เพื่อให้รูป dedupeKey และ data อยู่ที่เดียวและเทสกับ zod whitelist ได้

- เก็บค่า exact ตั้งแต่ deploy **ไม่ย้อนหลัง** (ย้อนหลังเป็นงานของ journey-state.sql ที่ใช้ค่าประมาณ)
- PDPA: ห้ามส่งข้อความแชท (`summary` ของ handoff), ข้อความเหตุผลส่งต่อ (`reason` — เก็บเป็นรหัสปิดแทน), เบอร์, เลขบัตร, ที่อยู่, LINE user id หรือ Facebook PSID เข้าแถว · dedupeKey สร้างด้วย `journeyDedupeKey` ผูกกับห้อง/ลูกค้า + เวลา ไม่ผูกกับค่า PII
- ห้องแชทที่ยังไม่มีเจ้าของ (`chat_rooms.customer_id` เป็น null) ไม่มีลูกค้าให้ผูก จึงข้าม
- ไม่อยู่ใน task นี้: การยกเลิกผูก LINE · handoff ที่บอทขายปักธงเองโดยไม่ผ่าน `HandoffManagerService` (`handoff_to_human` tool และธง `lead_captured` ของเครื่องมือเก็บ lead) · **CONTACT_ADDED จากเครื่องมือเก็บเบอร์ของบอทขาย — ตั้งใจไม่ต่อในเฟสนี้** เพราะบอทขายยังไม่เปิดให้ลูกค้าจริง (ค่า `CAPTURE_LEAD` ใน `CONTACT_ADDED_VIA` สงวนไว้ · ดูขอบเขตใน Task 13) ⇒ task นี้ไม่แตะโมดูลบอทขาย
- บรรทัดที่อ้างอิงนับจาก base `f76582a52` · Plan 1 Task 1 เพิ่ม `findDetail` ใน `customers.service.ts` และ `customers.controller.spec.ts` ทำให้บรรทัดในสองไฟล์นั้นเลื่อน ⇒ หาจุดแก้จากชื่อเมธอด/ข้อความ ไม่ใช่เลขบรรทัด

**Files:**
- Create: `apps/api/src/modules/customer-journey/chat-identity-entries.ts`
- Create: `apps/api/src/modules/customer-journey/chat-identity-entries.spec.ts`
- Create: `apps/api/src/modules/chat-engine/services/handoff-manager.service.spec.ts`
- Create: `apps/api/src/modules/customers/services/customer-write.journey.spec.ts`
- Modify: `apps/api/src/modules/chat-engine/services/handoff-manager.service.ts:1-4` (import) · `:31-34` (constructor) · `:37-60` (`initiateHandoff`)
- Modify: `apps/api/src/modules/chat-engine/chat-engine.module.ts:1-10` (import) · `:24` (imports)
- Modify: `apps/api/src/modules/customers/services/customer-write.service.ts:1-12` (import) · `:30-36` (constructor) · `:355-405` (`update`) · `:526-535` (ท้าย `fillPlaceholderContact`)
- Modify: `apps/api/src/modules/customers/services/customer-write.fill-contact.db.spec.ts:15-17` · `:35` · เทสใหม่ต่อจาก `:59`
- Modify: `apps/api/src/modules/customers/customers.service.ts:74-76` (`update` facade)
- Modify: `apps/api/src/modules/customers/customers.controller.ts:261-265` (`@Patch(':id')`)
- Modify: `apps/api/src/modules/customers/customers.controller.spec.ts` (Plan 1 ทำให้บรรทัดเลื่อน — หาจุดด้วยข้อความ): การประกาศ `let service: { … }` · object `service = { … }` ใน `beforeEach` · describe ใหม่ถัดจาก `});` ที่ปิด `describe('POST /customers/:id/fill-contact')`
- Modify: `apps/api/src/modules/customers/customers.module.ts:16` (import) · `:23` (imports)
- Modify: `apps/api/src/modules/line-oa/services/line-customer-link.service.ts:1-7` · `:13-17` · `:73-95`
- Modify: `apps/api/src/modules/line-oa/services/line-customer-link.service.spec.ts:1` (import) · describe ใหม่ต่อจาก `:56`
- Modify: `apps/api/src/modules/line-oa/line-oa.service.ts:6` (import) · `:31-42`
- Modify: `apps/api/src/modules/line-oa/liff-api.service.ts:7` (import) · `:21-24` · `:194-215`
- Modify: `apps/api/src/modules/line-oa/liff-api.service.spec.ts:4` (import) · `:12` · `:35` · `:41` · เทสใหม่ต่อจาก `:273`
- Modify: `apps/api/src/modules/line-oa/line-oa.module.ts:33` (import) · `:50` (imports)
- Modify: `apps/api/src/modules/chatbot-finance/services/verification.service.ts:11` (import) · `:51-57` · `:396-425` (`bind`)
- Modify: `apps/api/src/modules/chatbot-finance/services/verification.service.spec.ts:8` (import) · describe ใหม่ต่อจาก `:415` (ยังอยู่ใน `describe('verifyOtp')`)
- Modify: `apps/api/src/modules/chatbot-finance/chatbot-finance.module.ts:33` (import) · `:53` (imports)
- Modify: `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts:1-27` (import) · `:74-81` (constructor) · `:257-262` · `:306` · `:332` · `:372-374` · `:445-498` (`handleProductReferral` + `buildReferralNote`)
- Modify: `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts:12` (import) · `:397` · `:439` · `:447` · เทสใหม่ต่อจาก `:695`
- Modify: `apps/api/src/modules/chat-adapters/chat-adapters.module.ts:17` (import) · `:29-38` (imports)

**Interfaces:**
- Consumes:
  - Task 2 — `JourneyEntryWriter` จาก `apps/api/src/modules/customer-journey/journey-entry-writer.service.ts` — `recordAfterCommit(entry: JourneyEntryInput): Promise<void>` ไม่โยน error (catch + Logger.warn + Sentry) ใช้ `createMany({ skipDuplicates: true })`
  - Task 2 — `export interface JourneyEntryInput { customerId: string; kind: JourneyEntryKind; occurredAt: Date; actorType: 'STAFF'|'CUSTOMER'|'BOT'|'SYSTEM'; actorUserId?: string|null; roomId?: string|null; refType?: string|null; refId?: string|null; data?: Record<string, unknown>; dedupeKey: string }`
  - Task 3 — `CustomerJourneyModule` จาก `apps/api/src/modules/customer-journey/customer-journey.module.ts` — export `JourneyEntryWriter` (+ `JourneyStateService`) และไม่ import โมดูลใดเลย (ล็อกด้วย `customer-journey.module.spec.ts`) ⇒ ChatEngineModule / ChatAdaptersModule / LineOaModule / ChatbotFinanceModule / CustomersModule import ได้โดยไม่เกิดวงจร
  - Task 2 — `apps/api/src/modules/customer-journey/journey-data-schemas.ts` ลอกคำต่อคำ (สัญญากลางฉบับเดียว — ห้ามประกาศรูปของตัวเอง):
    - `BOT_HANDOFF: z.object({ priority: z.enum(HANDOFF_PRIORITIES), reasonCode: z.enum(HANDOFF_REASON_CODES) })` · `HANDOFF_PRIORITIES = ['low','normal','high','critical']` · `HANDOFF_REASON_CODES = ['BOT_SEND_FAILED','LOW_CONFIDENCE','AI_ERROR','CUSTOMER_REQUEST','OTHER']`
    - `CONTACT_ADDED: z.object({ fields: z.array(z.enum(CONTACT_FIELDS)).min(1).max(2), via: z.enum(CONTACT_ADDED_VIA) })` · `CONTACT_FIELDS = ['phone','nationalId']` · `CONTACT_ADDED_VIA = ['UPDATE','FILL_CONTACT','CAPTURE_LEAD']`
    - `LINE_LINKED: z.object({ channel: z.enum(LINE_LINK_CHANNELS), via: z.enum(LINE_LINKED_VIA) })` · `LINE_LINK_CHANNELS = ['FINANCE','SHOP']` · `LINE_LINKED_VIA = ['VERIFICATION','LIFF','SELF_LINK_PHONE']`
    - `PRODUCT_LINK_CLICK: z.object({ productId: z.string().uuid() })`
    - type `HandoffPriority` · `HandoffReasonCode` · `ContactField` · `ContactAddedVia` · `LineLinkChannel` · `LineLinkedVia` · `journeyDedupeKey(kind: JourneySystemEntryKind, ...parts: Array<string | number>): string` · `sanitizeJourneyData(kind: string, raw: unknown): JourneyDataSanitizeResult`
  - Task 1 — `JourneyEntryKind` จาก `@installment/shared` (มี `BOT_HANDOFF`, `CONTACT_ADDED`, `LINE_LINKED`, `PRODUCT_LINK_CLICK`)
  - ของเดิม: ข้อความเหตุผลที่ `MessageRouterService` ส่งเข้า `initiateHandoff` — `message-router.service.ts:390-395` `'ส่งคำตอบบอทไม่สำเร็จ — ให้พนักงานติดต่อลูกค้า'` · `:449-454` `'AI ไม่มั่นใจในการตอบ — ส่งต่อให้พนักงาน'` · `:482-487` `'ระบบ AI ขัดข้อง — ส่งต่อให้พนักงาน'` · `:546-551` `result.handoffReason ?? 'ลูกค้าขอพูดกับพนักงาน'` · `isChatPlaceholder` (`chat-prospects/chat-placeholder.ts:16` = ที่มา `CHAT_*` และไม่มีทั้งเบอร์และเลขบัตร)
- Produces:
  - `chat-identity-entries.ts`:
    - `HANDOFF_REASON_CODE_BY_TEXT: Readonly<Record<string, HandoffReasonCode>>` · `handoffReasonCode(reason: string): HandoffReasonCode` (ไม่รู้จัก = `'OTHER'`)
    - `isBlankContact(value: string | null | undefined): boolean`
    - `botHandoffEntry(input: { customerId: string; roomId: string; reason: string; priority: HandoffPriority; taggedAt: Date }): JourneyEntryInput` → data `{ priority, reasonCode }` เท่านั้น
    - `contactAddedEntry(input: { customerId: string; fields: ContactField[]; via: ContactAddedVia; actorUserId: string | null; occurredAt: Date }): JourneyEntryInput` (via `CAPTURE_LEAD` → actorType `BOT` + actorUserId `null` — สงวนไว้ เฟสนี้ไม่มีผู้เรียกด้วยค่านี้ · อื่น ๆ = `STAFF`)
    - `lineLinkedEntry(input: { customerId: string; channel: LineLinkChannel; via: LineLinkedVia; occurredAt: Date }): JourneyEntryInput`
    - `productLinkClickEntry(input: { customerId: string; roomId: string; productId: string; occurredAt: Date }): JourneyEntryInput`
  - dedupeKey ตามตารางของ Task 2: `BOT_HANDOFF:<roomId>:<handoffTaggedAt ms>` · `CONTACT_ADDED:<customerId>:<fields เรียงแล้วคั่น +>` · `LINE_LINKED:<channel>:<customerId>:<linkedAt ms>` · `PRODUCT_LINK_CLICK:<roomId>:<productId>:<event ms>`
  - ลายเซ็นที่เปลี่ยน: `CustomerWriteService.update(id, dto, actor?: { id: string; role: string })` · `CustomersService.update(id, dto, actor?)` · `CustomersController.update(id, dto, req)` · constructor รับ `@Optional() journey?: JourneyEntryWriter` เพิ่มท้ายสุดใน `HandoffManagerService`, `CustomerWriteService`, `LineCustomerLinkService`, `LineOaService`, `LiffApiService`, `VerificationService`, `FacebookWebhookController` · `FacebookWebhookController.handleProductReferral(senderId, ref, occurredAt: Date)` (private)
  - LINE_LINKED เขียนเฉพาะการผูกที่เปลี่ยนจริง: `selfLinkByPhone` (คนที่ผูก LINE นี้อยู่แล้ว return ก่อนถึงจุดบันทึก) · `confirmLinkLine` (`lineIdFinance` เดิมไม่เท่ากับ LINE นี้) · `VerificationService.bind` (แถว `customer_line_links` เดิมไม่มี / เป็นลูกค้าคนอื่น / ถูกยกเลิกหรือลบแล้ว)
  - โมดูลที่ import `CustomerJourneyModule` เพิ่ม: `ChatEngineModule` · `CustomersModule` · `LineOaModule` · `ChatbotFinanceModule` · `ChatAdaptersModule`

- [ ] **Step 1: เทสแดง — ตัวประกอบแถว (ฟังก์ชันบริสุทธิ์)**

สร้าง `apps/api/src/modules/customer-journey/chat-identity-entries.spec.ts`:
```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { sanitizeJourneyData } from './journey-data-schemas';
import type { JourneyEntryInput } from './journey-entry-writer.service';
import {
  HANDOFF_REASON_CODE_BY_TEXT,
  botHandoffEntry,
  contactAddedEntry,
  handoffReasonCode,
  isBlankContact,
  lineLinkedEntry,
  productLinkClickEntry,
} from './chat-identity-entries';

const AT = new Date('2026-10-02T03:04:05.000Z');
const CUSTOMER = 'c0ffee00-1111-4222-8333-444455556666';
const ROOM = '7d0c2a9b-aaaa-4bbb-8ccc-dddd00001111';
const PRODUCT = '11111111-2222-3333-4444-555555555555';

/** writer เก็บ sanitized.data ลงคอลัมน์ (พิสูจน์ใน db spec ของ Task 2) ⇒ data ของทุกแถวต้องผ่าน whitelist ครบทุกคีย์ */
function expectWhitelisted(entry: JourneyEntryInput): void {
  expect(sanitizeJourneyData(entry.kind, entry.data)).toEqual({ ok: true, data: entry.data });
}

describe('chat-identity-entries — แถว SYSTEM ฝั่งแชทและตัวตน', () => {
  describe('botHandoffEntry', () => {
    it('ผู้ทำ = บอท · ผูกห้อง · data มีแค่ priority + reasonCode · dedupe BOT_HANDOFF:<roomId>:<ms>', () => {
      const entry = botHandoffEntry({
        customerId: CUSTOMER,
        roomId: ROOM,
        reason: 'AI ไม่มั่นใจในการตอบ — ส่งต่อให้พนักงาน',
        priority: 'normal',
        taggedAt: AT,
      });
      expect(entry).toEqual({
        customerId: CUSTOMER,
        kind: 'BOT_HANDOFF',
        occurredAt: AT,
        actorType: 'BOT',
        actorUserId: null,
        roomId: ROOM,
        refType: null,
        refId: null,
        data: { priority: 'normal', reasonCode: 'LOW_CONFIDENCE' },
        dedupeKey: `BOT_HANDOFF:${ROOM}:${AT.getTime()}`,
      });
      expect(Object.keys(entry.data ?? {}).sort()).toEqual(['priority', 'reasonCode']);
      expectWhitelisted(entry);
    });

    it('PDPA: เหตุผลที่ไม่รู้จัก (อาจเป็นข้อความที่ AI เขียน มีชื่อ/เบอร์/ที่อยู่) → OTHER และข้อความไม่หลุดเข้าแถว', () => {
      const entry = botHandoffEntry({
        customerId: CUSTOMER,
        roomId: ROOM,
        reason: 'คุณสมชายให้โทรกลับ 081-234-5678 ที่บ้านเลขที่ 9',
        priority: 'high',
        taggedAt: AT,
      });
      expect(entry.data).toEqual({ priority: 'high', reasonCode: 'OTHER' });
      const json = JSON.stringify(entry);
      for (const secret of ['สมชาย', '081-234-5678', 'บ้านเลขที่']) expect(json).not.toContain(secret);
      expectWhitelisted(entry);
    });
  });

  describe('handoffReasonCode', () => {
    it.each([
      ['ส่งคำตอบบอทไม่สำเร็จ — ให้พนักงานติดต่อลูกค้า', 'BOT_SEND_FAILED'],
      ['AI ไม่มั่นใจในการตอบ — ส่งต่อให้พนักงาน', 'LOW_CONFIDENCE'],
      ['ระบบ AI ขัดข้อง — ส่งต่อให้พนักงาน', 'AI_ERROR'],
      ['ลูกค้าขอพูดกับพนักงาน', 'CUSTOMER_REQUEST'],
      ['  ลูกค้าขอพูดกับพนักงาน  ', 'CUSTOMER_REQUEST'],
      ['เหตุผลใหม่จาก domain handler', 'OTHER'],
      ['constructor', 'OTHER'],
    ])('%p → %p', (reason, code) => {
      expect(handoffReasonCode(reason)).toBe(code);
    });

    it('กันข้อความในผู้เรียกเปลี่ยนแล้วรหัสกลายเป็น OTHER เงียบ ๆ — ทุกข้อความในตารางต้องยังอยู่ใน message-router.service.ts', () => {
      const source = readFileSync(join(__dirname, '../chat-engine/services/message-router.service.ts'), 'utf8');
      for (const text of Object.keys(HANDOFF_REASON_CODE_BY_TEXT)) {
        expect(source).toContain(`'${text}'`);
      }
    });
  });

  describe('contactAddedEntry', () => {
    it('เก็บแค่ชื่อช่องที่ได้มา ไม่เก็บค่า · ตัดซ้ำและเรียงคงที่ · dedupe CONTACT_ADDED:<customerId>:<fields>', () => {
      const entry = contactAddedEntry({
        customerId: CUSTOMER,
        fields: ['phone', 'nationalId', 'phone'],
        via: 'FILL_CONTACT',
        actorUserId: 'user-1',
        occurredAt: AT,
      });
      expect(entry).toEqual({
        customerId: CUSTOMER,
        kind: 'CONTACT_ADDED',
        occurredAt: AT,
        actorType: 'STAFF',
        actorUserId: 'user-1',
        roomId: null,
        refType: null,
        refId: null,
        data: { fields: ['nationalId', 'phone'], via: 'FILL_CONTACT' },
        dedupeKey: `CONTACT_ADDED:${CUSTOMER}:nationalId+phone`,
      });
      expectWhitelisted(entry);
    });

    it('แก้ในหน้าลูกค้าโดยไม่มีผู้ทำ → actorUserId null แต่ยังเป็น STAFF', () => {
      const entry = contactAddedEntry({ customerId: CUSTOMER, fields: ['phone'], via: 'UPDATE', actorUserId: null, occurredAt: AT });
      expect(entry.actorType).toBe('STAFF');
      expect(entry.actorUserId).toBeNull();
      expect(entry.dedupeKey).toBe(`CONTACT_ADDED:${CUSTOMER}:phone`);
      expectWhitelisted(entry);
    });

    it('via CAPTURE_LEAD (สงวนไว้ตอนเปิดบอทขาย — เฟสนี้ไม่มีผู้เรียก) → ผู้ทำ = บอท actorUserId null เสมอ', () => {
      const entry = contactAddedEntry({ customerId: CUSTOMER, fields: ['phone'], via: 'CAPTURE_LEAD', actorUserId: 'ignored', occurredAt: AT });
      expect(entry).toMatchObject({ actorType: 'BOT', actorUserId: null, data: { fields: ['phone'], via: 'CAPTURE_LEAD' } });
      expectWhitelisted(entry);
    });
  });

  describe('lineLinkedEntry', () => {
    it('ผู้ทำ = ลูกค้า · data มีแค่ช่องทาง + วิธีผูก · dedupe LINE_LINKED:<channel>:<customerId>:<ms>', () => {
      const entry = lineLinkedEntry({ customerId: CUSTOMER, channel: 'FINANCE', via: 'VERIFICATION', occurredAt: AT });
      expect(entry).toEqual({
        customerId: CUSTOMER,
        kind: 'LINE_LINKED',
        occurredAt: AT,
        actorType: 'CUSTOMER',
        actorUserId: null,
        roomId: null,
        refType: null,
        refId: null,
        data: { channel: 'FINANCE', via: 'VERIFICATION' },
        dedupeKey: `LINE_LINKED:FINANCE:${CUSTOMER}:${AT.getTime()}`,
      });
      expectWhitelisted(entry);
    });
  });

  describe('productLinkClickEntry', () => {
    it('อ้างสินค้าด้วย refType product · ผูกห้อง · dedupe PRODUCT_LINK_CLICK:<roomId>:<productId>:<ms>', () => {
      const entry = productLinkClickEntry({ customerId: CUSTOMER, roomId: ROOM, productId: PRODUCT, occurredAt: AT });
      expect(entry).toEqual({
        customerId: CUSTOMER,
        kind: 'PRODUCT_LINK_CLICK',
        occurredAt: AT,
        actorType: 'CUSTOMER',
        actorUserId: null,
        roomId: ROOM,
        refType: 'product',
        refId: PRODUCT,
        data: { productId: PRODUCT },
        dedupeKey: `PRODUCT_LINK_CLICK:${ROOM}:${PRODUCT}:${AT.getTime()}`,
      });
      expectWhitelisted(entry);
    });
  });

  describe('isBlankContact', () => {
    it.each([
      [null, true],
      [undefined, true],
      ['', true],
      ['   ', true],
      ['0812345678', false],
    ])('%p → %p', (value, expected) => {
      expect(isBlankContact(value as string | null | undefined)).toBe(expected);
    });
  });
});
```
Run (จาก `apps/api` env ตาม Global Constraints): `npx jest src/modules/customer-journey/chat-identity-entries.spec.ts --runInBand` → Expected: FAIL `Cannot find module './chat-identity-entries'`

- [ ] **Step 2: ตัวประกอบแถว**

สร้าง `apps/api/src/modules/customer-journey/chat-identity-entries.ts`:
```ts
import type { JourneyEntryInput } from './journey-entry-writer.service';
import {
  journeyDedupeKey,
  type ContactAddedVia,
  type ContactField,
  type HandoffPriority,
  type HandoffReasonCode,
  type LineLinkChannel,
  type LineLinkedVia,
} from './journey-data-schemas';

/**
 * แถว SYSTEM ของการเดินทางลูกค้า 4 ชนิดที่เกิดจากแชทและการยืนยันตัวตน (เฟส 1 ไม่มีงานกรอกมือ)
 * วันนี้ระบบไม่ได้เก็บเป็นโครงสร้าง จึงเก็บ exact ตั้งแต่ deploy และไม่ย้อนหลัง
 * รูป data และ dedupeKey มาจากตารางกลางของ Task 2 (journey-data-schemas.ts) — ห้ามประกาศรูปของตัวเอง
 *
 * PDPA: ห้ามรับหรือเก็บข้อความแชท (summary ของ handoff), ข้อความเหตุผลส่งต่อ, เบอร์, เลขบัตร, ที่อยู่, LINE user id, Facebook PSID
 */

/**
 * ข้อความเหตุผลที่โค้ดส่งเข้า HandoffManagerService.initiateHandoff (message-router.service.ts) → รหัสปิด
 * domain handler อาจส่งข้อความที่ AI เขียน (มีชื่อ/เบอร์/ที่อยู่ได้) จึงไม่เก็บข้อความเลย ข้อความที่ไม่รู้จัก = OTHER
 * เพิ่มข้อความใหม่ในผู้เรียกเมื่อไร ให้เพิ่มแถวที่นี่ (เทสตรวจว่าทุกข้อความในตารางยังอยู่ในโค้ดผู้เรียก)
 */
export const HANDOFF_REASON_CODE_BY_TEXT: Readonly<Record<string, HandoffReasonCode>> = {
  'ส่งคำตอบบอทไม่สำเร็จ — ให้พนักงานติดต่อลูกค้า': 'BOT_SEND_FAILED',
  'AI ไม่มั่นใจในการตอบ — ส่งต่อให้พนักงาน': 'LOW_CONFIDENCE',
  'ระบบ AI ขัดข้อง — ส่งต่อให้พนักงาน': 'AI_ERROR',
  'ลูกค้าขอพูดกับพนักงาน': 'CUSTOMER_REQUEST',
};

export function handoffReasonCode(reason: string): HandoffReasonCode {
  const key = reason.trim();
  return Object.prototype.hasOwnProperty.call(HANDOFF_REASON_CODE_BY_TEXT, key) ? HANDOFF_REASON_CODE_BY_TEXT[key] : 'OTHER';
}

/** แถวเก่าบางเส้นทางเก็บเบอร์เป็น '' แทน null — นับว่ายังไม่มี */
export function isBlankContact(value: string | null | undefined): boolean {
  return value == null || value.trim() === '';
}

export function botHandoffEntry(input: {
  customerId: string;
  roomId: string;
  reason: string;
  priority: HandoffPriority;
  taggedAt: Date;
}): JourneyEntryInput {
  return {
    customerId: input.customerId,
    kind: 'BOT_HANDOFF',
    occurredAt: input.taggedAt,
    actorType: 'BOT',
    actorUserId: null,
    roomId: input.roomId,
    refType: null,
    refId: null,
    data: { priority: input.priority, reasonCode: handoffReasonCode(input.reason) },
    dedupeKey: journeyDedupeKey('BOT_HANDOFF', input.roomId, input.taggedAt.getTime()),
  };
}

export function contactAddedEntry(input: {
  customerId: string;
  fields: ContactField[];
  via: ContactAddedVia;
  actorUserId: string | null;
  occurredAt: Date;
}): JourneyEntryInput {
  const fields = Array.from(new Set(input.fields)).sort();
  const byBot = input.via === 'CAPTURE_LEAD';
  return {
    customerId: input.customerId,
    kind: 'CONTACT_ADDED',
    occurredAt: input.occurredAt,
    actorType: byBot ? 'BOT' : 'STAFF',
    actorUserId: byBot ? null : input.actorUserId,
    roomId: null,
    refType: null,
    refId: null,
    data: { fields, via: input.via },
    // DTO ห้ามล้างเบอร์ของคนที่มีเบอร์แล้ว ⇒ "ได้เบอร์ครั้งแรก" เกิดครั้งเดียวต่อคนต่อชุดช่อง
    dedupeKey: journeyDedupeKey('CONTACT_ADDED', input.customerId, fields.join('+')),
  };
}

export function lineLinkedEntry(input: {
  customerId: string;
  channel: LineLinkChannel;
  via: LineLinkedVia;
  occurredAt: Date;
}): JourneyEntryInput {
  return {
    customerId: input.customerId,
    kind: 'LINE_LINKED',
    occurredAt: input.occurredAt,
    actorType: 'CUSTOMER',
    actorUserId: null,
    roomId: null,
    refType: null,
    refId: null,
    data: { channel: input.channel, via: input.via },
    // ผู้เรียกบันทึกเฉพาะการผูกที่เปลี่ยนจริง ⇒ เวลาผูกแยกรอบผูก → ยกเลิก → ผูกใหม่ ได้คนละแถว
    dedupeKey: journeyDedupeKey('LINE_LINKED', input.channel, input.customerId, input.occurredAt.getTime()),
  };
}

export function productLinkClickEntry(input: {
  customerId: string;
  roomId: string;
  productId: string;
  occurredAt: Date;
}): JourneyEntryInput {
  return {
    customerId: input.customerId,
    kind: 'PRODUCT_LINK_CLICK',
    occurredAt: input.occurredAt,
    actorType: 'CUSTOMER',
    actorUserId: null,
    roomId: input.roomId,
    refType: 'product',
    refId: input.productId,
    data: { productId: input.productId },
    // เวลาเป็นเวลา event ของ Meta — ส่งซ้ำ (redelivery) ได้ค่าเดิม จึงไม่เกิดแถวซ้ำ
    dedupeKey: journeyDedupeKey('PRODUCT_LINK_CLICK', input.roomId, input.productId, input.occurredAt.getTime()),
  };
}
```
Run เทส Step 1 อีกครั้ง → Expected: PASS 20 tests · ถ้า `expectWhitelisted` แดง แปลว่า `JOURNEY_DATA_SCHEMAS` ของ Task 2 ไม่ตรงกับรูปใน **Interfaces → Consumes** ให้หยุดและรายงาน ห้ามแก้เทสหรือ schema ให้ผ่านเอง

- [ ] **Step 3: เทสแดง — BOT_HANDOFF**

สร้าง `apps/api/src/modules/chat-engine/services/handoff-manager.service.spec.ts`:
```ts
import { ChatPriority, ChatRoomStatus } from '@prisma/client';
import { HandoffManagerService } from './handoff-manager.service';

describe('HandoffManagerService.initiateHandoff → BOT_HANDOFF (writer mocked)', () => {
  const params = {
    roomId: 'room-1',
    reason: 'AI ไม่มั่นใจในการตอบ — ส่งต่อให้พนักงาน',
    priority: 'normal' as const,
    summary: 'ขอคุยกับคนหน่อย เบอร์ 0812345678',
  };
  let prisma: { chatRoom: { update: jest.Mock } };
  let gateway: { emitRoomUpdate: jest.Mock };
  let journey: { recordAfterCommit: jest.Mock };

  beforeEach(() => {
    prisma = { chatRoom: { update: jest.fn().mockResolvedValue({ customerId: 'cust-1' }) } };
    gateway = { emitRoomUpdate: jest.fn() };
    journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
  });

  function build(withWriter = true): HandoffManagerService {
    return new HandoffManagerService(prisma as any, gateway as any, withWriter ? (journey as any) : undefined);
  }

  it('ห้องมีเจ้าของ → ตั้งห้องเหมือนเดิม แล้วบันทึก BOT_HANDOFF ด้วยเวลาเดียวกับ handoffTaggedAt', async () => {
    await build().initiateHandoff(params);

    const updateArgs = prisma.chatRoom.update.mock.calls[0][0];
    expect(updateArgs).toEqual({
      where: { id: 'room-1' },
      data: {
        handoffMode: true,
        handoffReason: params.reason,
        handoffTaggedAt: expect.any(Date),
        status: ChatRoomStatus.ACTIVE,
        priority: ChatPriority.NORMAL,
      },
      select: { customerId: true },
    });
    const taggedAt = updateArgs.data.handoffTaggedAt as Date;
    expect(gateway.emitRoomUpdate).toHaveBeenCalledWith('room-1', expect.objectContaining({ event: 'handoff' }));
    expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
    expect(journey.recordAfterCommit).toHaveBeenCalledWith({
      customerId: 'cust-1',
      kind: 'BOT_HANDOFF',
      occurredAt: taggedAt,
      actorType: 'BOT',
      actorUserId: null,
      roomId: 'room-1',
      refType: null,
      refId: null,
      data: { priority: 'normal', reasonCode: 'LOW_CONFIDENCE' },
      dedupeKey: `BOT_HANDOFF:room-1:${taggedAt.getTime()}`,
    });
    expect(Object.keys(journey.recordAfterCommit.mock.calls[0][0].data)).toEqual(['priority', 'reasonCode']);
  });

  it('PDPA: ข้อความลูกค้า (summary) และข้อความเหตุผลไม่หลุดเข้าแถว', async () => {
    await build().initiateHandoff(params);
    const json = JSON.stringify(journey.recordAfterCommit.mock.calls[0][0]);
    expect(json).not.toContain('ขอคุยกับคนหน่อย');
    expect(json).not.toContain('0812345678');
    expect(json).not.toContain(params.reason);
  });

  it('ห้องยังไม่มีเจ้าของ (customerId null) → handoff ทำงานครบ แต่ไม่บันทึก', async () => {
    prisma.chatRoom.update.mockResolvedValue({ customerId: null });
    await build().initiateHandoff(params);
    expect(gateway.emitRoomUpdate).toHaveBeenCalled();
    expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('ไม่มี writer ต่อสาย (@Optional) → handoff ไม่พัง', async () => {
    await expect(build(false).initiateHandoff(params)).resolves.toBeUndefined();
    expect(gateway.emitRoomUpdate).toHaveBeenCalled();
  });

  it('ตั้งห้องล้ม (prisma โยน) → ไม่บันทึก และโยนต่อให้ผู้เรียกเหมือนเดิม', async () => {
    prisma.chatRoom.update.mockRejectedValue(new Error('room gone'));
    await expect(build().initiateHandoff(params)).rejects.toThrow('room gone');
    expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  });
});
```
Run: `npx jest src/modules/chat-engine/services/handoff-manager.service.spec.ts --runInBand` → Expected: FAIL `TS2554: Expected 1-2 arguments, but got 3.`

- [ ] **Step 4: เขียน BOT_HANDOFF ใน `initiateHandoff` + ต่อโมดูล**

`handoff-manager.service.ts` เพิ่ม import ถัดจากบรรทัด 4:
```ts
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { botHandoffEntry } from '../../customer-journey/chat-identity-entries';
```
แทน constructor (บรรทัด 31-34) และ `initiateHandoff` (บรรทัด 36-60) ด้วย:
```ts
  constructor(
    private prisma: PrismaService,
    @Optional() @Inject(CHAT_GATEWAY_TOKEN) private gateway?: IChatGateway,
    // การเดินทางของลูกค้า — BOT_HANDOFF (chat_rooms.handoffReason ถูกเขียนทับทุกรอบและถูกล้างตอนปิดงาน)
    @Optional() private journey?: JourneyEntryWriter,
  ) {}

  /** Initiate handoff — mark room for staff pickup */
  async initiateHandoff(params: HandoffParams): Promise<void> {
    const taggedAt = new Date();
    const room = await this.prisma.chatRoom.update({
      where: { id: params.roomId },
      data: {
        handoffMode: true,
        handoffReason: params.reason,
        handoffTaggedAt: taggedAt,
        status: ChatRoomStatus.ACTIVE,
        priority: PRIORITY_MAP[params.priority] ?? ChatPriority.NORMAL,
      },
      select: { customerId: true },
    });

    this.logger.warn(
      `[Handoff] roomId=${params.roomId} priority=${params.priority} reason="${params.reason}"`,
    );

    this.gateway?.emitRoomUpdate(params.roomId, {
      event: 'handoff',
      roomId: params.roomId,
      priority: params.priority,
      reason: params.reason,
      summary: params.summary,
    });

    // best-effort หลังเขียนห้องสำเร็จ: recordAfterCommit ไม่โยน · ห้องที่ยังไม่มีเจ้าของไม่มีลูกค้าให้ผูก จึงข้าม
    // PDPA: ห้ามส่ง params.summary (ข้อความลูกค้า) เข้าไป · reason ถูกแปลงเป็นรหัสปิดใน botHandoffEntry ไม่ลงแถว
    if (room.customerId) {
      await this.journey?.recordAfterCommit(
        botHandoffEntry({
          customerId: room.customerId,
          roomId: params.roomId,
          reason: params.reason,
          priority: params.priority,
          taggedAt,
        }),
      );
    }
  }
```
`chat-engine.module.ts` เพิ่ม import ถัดจากบรรทัด 3:
```ts
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';
```
แทนบรรทัด 24 ด้วย:
```ts
  imports: [forwardRef(() => StaffChatModule), ChatProspectsModule, CustomerJourneyModule],
```
Run เทส Step 3 อีกครั้ง → Expected: PASS 5 tests

- [ ] **Step 5: เทสแดง — CONTACT_ADDED (unit + DB จริง + controller)**

สร้าง `apps/api/src/modules/customers/services/customer-write.journey.spec.ts`:
```ts
import { ConflictException } from '@nestjs/common';
import { CustomerWriteService } from './customer-write.service';

/** CONTACT_ADDED — เบอร์/เลขบัตรจากว่าง → มีค่า (writer mocked) · ห้ามมีเบอร์หรือเลขบัตรในแถวที่ส่งให้ writer */
describe('CustomerWriteService → CONTACT_ADDED', () => {
  const PHONE = '0812345678';
  const NID = '1103700012345';
  let prevSalt: string | undefined;
  let prevKey: string | undefined;
  let prisma: { customer: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock } };
  let query: { findOne: jest.Mock };
  let audit: { log: jest.Mock };
  let journey: { recordAfterCommit: jest.Mock };
  let service: CustomerWriteService;

  beforeAll(() => {
    prevSalt = process.env.PII_HASH_SALT;
    prevKey = process.env.PII_ENCRYPTION_KEY;
    process.env.PII_HASH_SALT = 'journey-contact-spec-salt-0123456789';
    delete process.env.PII_ENCRYPTION_KEY;
  });

  afterAll(() => {
    if (prevSalt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = prevSalt;
    if (prevKey !== undefined) process.env.PII_ENCRYPTION_KEY = prevKey;
  });

  beforeEach(() => {
    prisma = {
      customer: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest
          .fn()
          .mockImplementation(async (args: { where: { id: string } }) => ({ id: args.where.id, name: 'สมชาย ใจดี', phone: PHONE })),
      },
    };
    query = { findOne: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
    service = new CustomerWriteService(prisma as any, {} as any, query as any, undefined, audit as any, journey as any);
  });

  describe('update (PATCH /customers/:id)', () => {
    it('ยังไม่มีเบอร์ → ใส่เบอร์ → CONTACT_ADDED {fields:[phone], via: UPDATE} ผู้ทำ = actor · ไม่มีเบอร์ในแถว', async () => {
      query.findOne.mockResolvedValue({ id: 'c1', phone: null });
      await service.update('c1', { phone: PHONE }, { id: 'u-owner', role: 'OWNER' });
      expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
      const entry = journey.recordAfterCommit.mock.calls[0][0];
      expect(entry).toEqual({
        customerId: 'c1',
        kind: 'CONTACT_ADDED',
        occurredAt: expect.any(Date),
        actorType: 'STAFF',
        actorUserId: 'u-owner',
        roomId: null,
        refType: null,
        refId: null,
        data: { fields: ['phone'], via: 'UPDATE' },
        dedupeKey: 'CONTACT_ADDED:c1:phone',
      });
      expect(JSON.stringify(entry)).not.toContain(PHONE);
    });

    it('แถวเดิมเก็บเบอร์เป็น "" → นับว่ายังไม่มีเบอร์', async () => {
      query.findOne.mockResolvedValue({ id: 'c1', phone: '' });
      await service.update('c1', { phone: PHONE }, { id: 'u-owner', role: 'OWNER' });
      expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
    });

    it('มีเบอร์อยู่แล้ว → เปลี่ยนเบอร์ไม่นับเป็นได้เบอร์ใหม่', async () => {
      query.findOne.mockResolvedValue({ id: 'c1', phone: '0899999999' });
      await service.update('c1', { phone: PHONE }, { id: 'u-owner', role: 'OWNER' });
      expect(journey.recordAfterCommit).not.toHaveBeenCalled();
    });

    it('แก้ช่องอื่นที่ไม่ใช่เบอร์ → ไม่บันทึก', async () => {
      query.findOne.mockResolvedValue({ id: 'c1', phone: null });
      await service.update('c1', { name: 'ชื่อใหม่' }, { id: 'u-owner', role: 'OWNER' });
      expect(journey.recordAfterCommit).not.toHaveBeenCalled();
    });

    it('ไม่มี actor → actorUserId null', async () => {
      query.findOne.mockResolvedValue({ id: 'c1', phone: null });
      await service.update('c1', { phone: PHONE });
      expect(journey.recordAfterCommit.mock.calls[0][0].actorUserId).toBeNull();
    });

    it('update ล้ม → ไม่บันทึก และโยนต่อ', async () => {
      query.findOne.mockResolvedValue({ id: 'c1', phone: null });
      prisma.customer.update.mockRejectedValue(new Error('db down'));
      await expect(service.update('c1', { phone: PHONE }, { id: 'u-owner', role: 'OWNER' })).rejects.toThrow('db down');
      expect(journey.recordAfterCommit).not.toHaveBeenCalled();
    });
  });

  describe('fillPlaceholderContact', () => {
    const placeholderRow = {
      id: 'p1',
      name: 'Facebook #1234',
      acquisitionSource: 'CHAT_FACEBOOK',
      phone: null,
      nationalId: null,
      deletedAt: null,
    };

    it('เติมเบอร์ → CONTACT_ADDED {fields:[phone], via: FILL_CONTACT} ผู้ทำ = พนักงาน', async () => {
      prisma.customer.findUnique.mockResolvedValue(placeholderRow);
      await service.fillPlaceholderContact('p1', { phone: PHONE }, { id: 'staff-1', role: 'SALES' });
      expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
      expect(journey.recordAfterCommit.mock.calls[0][0]).toMatchObject({
        customerId: 'p1',
        kind: 'CONTACT_ADDED',
        actorType: 'STAFF',
        actorUserId: 'staff-1',
        data: { fields: ['phone'], via: 'FILL_CONTACT' },
        dedupeKey: 'CONTACT_ADDED:p1:phone',
      });
    });

    it('เติมเบอร์ + เลขบัตร → fields [nationalId, phone] · ไม่มีเบอร์และเลขบัตรในแถว', async () => {
      prisma.customer.findUnique.mockResolvedValue(placeholderRow);
      await service.fillPlaceholderContact('p1', { phone: PHONE, nationalId: NID }, { id: 'staff-1', role: 'SALES' });
      const entry = journey.recordAfterCommit.mock.calls[0][0];
      expect(entry.data).toEqual({ fields: ['nationalId', 'phone'], via: 'FILL_CONTACT' });
      expect(entry.dedupeKey).toBe('CONTACT_ADDED:p1:nationalId+phone');
      const json = JSON.stringify(entry);
      expect(json).not.toContain(PHONE);
      expect(json).not.toContain(NID);
    });

    it('เบอร์ซ้ำ (409) → ไม่บันทึก', async () => {
      prisma.customer.findUnique.mockResolvedValue(placeholderRow);
      prisma.customer.findFirst.mockResolvedValueOnce({ id: 'other', name: 'ลูกค้าเดิม' });
      await expect(
        service.fillPlaceholderContact('p1', { phone: PHONE }, { id: 'staff-1', role: 'SALES' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(journey.recordAfterCommit).not.toHaveBeenCalled();
    });
  });
});
```
`customer-write.fill-contact.db.spec.ts` แทนบรรทัด 15-17 ด้วย:
```ts
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
  // contactResolver / query ไม่ถูกใช้ในเมธอดนี้ (อ่านผ่าน prisma ตรง) · ไม่ส่ง piiService = fallback inline (ไม่มี key → เก็บ plaintext, มี salt → hash จริง)
  const service = new CustomerWriteService(prisma as any, {} as any, {} as any, undefined, audit as any, journey as any);
```
แทนบรรทัด 35 ด้วย:
```ts
  beforeEach(() => {
    audit.log.mockClear();
    journey.recordAfterCommit.mockClear();
  });
```
เพิ่มเทสถัดจาก `it(...)` ตัวแรก (ปิดที่บรรทัด 59):
```ts
  it('เติมเบอร์บนแถวจริง → CONTACT_ADDED หนึ่งครั้ง ไม่มีเบอร์ในแถว · เบอร์ซ้ำ 409 → ไม่บันทึก', async () => {
    const p = await placeholder('journey');
    const phone = `02${stamp}`;
    await service.fillPlaceholderContact(p.id, { phone }, { id: 'staff-1', role: 'SALES' });
    expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
    const entry = journey.recordAfterCommit.mock.calls[0][0];
    expect(entry).toMatchObject({
      customerId: p.id,
      kind: 'CONTACT_ADDED',
      actorType: 'STAFF',
      actorUserId: 'staff-1',
      data: { fields: ['phone'], via: 'FILL_CONTACT' },
      dedupeKey: `CONTACT_ADDED:${p.id}:phone`,
    });
    expect(JSON.stringify(entry)).not.toContain(phone);

    journey.recordAfterCommit.mockClear();
    const again = await placeholder('journey-dup');
    await expect(
      service.fillPlaceholderContact(again.id, { phone }, { id: 'staff-1', role: 'SALES' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  });
```
`customers.controller.spec.ts` (หาจุดด้วยข้อความ ไม่ใช้เลขบรรทัด — Plan 1 ทำให้ไฟล์เลื่อน): ในการประกาศ `let service: { … }` ต่อท้าย `fillPlaceholderContact: jest.Mock` ด้วย `; update: jest.Mock` · ใน object `service = { … }` ของ `beforeEach` เพิ่ม `update: jest.fn(),` ถัดจาก `fillPlaceholderContact: jest.fn(),` · เพิ่ม describe ถัดจาก `});` ที่ปิด `describe('POST /customers/:id/fill-contact')` (ยังอยู่ใน describe นอกสุด — ก่อน `});` บรรทัดสุดท้ายของไฟล์):
```ts
  describe('PATCH /customers/:id', () => {
    it('ส่ง actor ต่อเข้า service — ใช้ระบุผู้เติมเบอร์ในแถว CONTACT_ADDED', async () => {
      service.update.mockResolvedValue({ id: 'c1' });
      const dto = { phone: '0812345678' };
      await controller.update('c1', dto as any, reqOf('OWNER'));
      expect(service.update).toHaveBeenCalledWith('c1', dto, { id: 'u1', role: 'OWNER' });
    });
  });
```
Run: `npx jest src/modules/customers/services/customer-write.journey.spec.ts src/modules/customers/customers.controller.spec.ts --runInBand` → Expected: FAIL `TS2554: Expected 3-5 arguments, but got 6.` (write spec) และ `TS2554: Expected 2 arguments, but got 3.` (controller spec)
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customers/services/customer-write.fill-contact.db.spec.ts --runInBand` → Expected: FAIL `TS2554: Expected 3-5 arguments, but got 6.`

- [ ] **Step 6: เขียน CONTACT_ADDED ใน `update` / `fillPlaceholderContact` + ส่ง actor + ต่อโมดูล**

`customer-write.service.ts` เพิ่ม import ถัดจากบรรทัด 12:
```ts
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { contactAddedEntry, isBlankContact, type ContactField } from '../../customer-journey/chat-identity-entries';
```
แทน constructor (บรรทัด 30-36) ด้วย:
```ts
  constructor(
    private prisma: PrismaService,
    private readonly contactResolver: ContactResolverService,
    private readonly query: CustomerQueryService,
    @Optional() private readonly piiService?: CustomerPiiService,
    @Optional() private readonly audit?: AuditService,
    // การเดินทางของลูกค้า — CONTACT_ADDED (body ใน audit ถูก REDACTED จึงย้อนหาเวลาที่ได้เบอร์ไม่ได้)
    @Optional() private readonly journey?: JourneyEntryWriter,
  ) {}
```
แทนเมธอด `update` ทั้งเมธอด (บรรทัด 355-405) ด้วย:
```ts
  async update(id: string, dto: UpdateCustomerDto, actor?: { id: string; role: string }) {
    const before = await this.query.findOne(id);
    // NID is intentionally not in UpdateCustomerDto — customers can't change
    // their ID through this endpoint. If NID needs correction, create a
    // dedicated admin-only flow that writes to an audit log.

    // T3-C9: normalize + dedup phone/email when either is being changed.
    const normalizedPhone = dto.phone !== undefined ? this.normalizePhone(dto.phone) : undefined;
    const normalizedPhoneSecondary =
      dto.phoneSecondary !== undefined ? this.normalizePhone(dto.phoneSecondary) : undefined;
    const normalizedEmail = dto.email !== undefined ? this.normalizeEmail(dto.email) : undefined;

    await this.assertContactNotDuplicate(
      normalizedPhone ?? null,
      normalizedEmail ?? null,
      id,
    );

    // Compute final plaintext values for fields being updated
    const finalPhone = normalizedPhone !== undefined ? (normalizedPhone ?? dto.phone) : undefined;
    const finalPhoneSecondary = normalizedPhoneSecondary;
    const finalEmail = normalizedEmail;

    const piiEncrypted = this.buildPiiEncryptedFields({
      // nationalId not in UpdateDto by design — never updated
      phone: finalPhone,
      phoneSecondary: finalPhoneSecondary,
      email: finalEmail,
      addressIdCard: dto.addressIdCard,
      addressCurrent: dto.addressCurrent,
      addressWork: dto.addressWork,
      references: dto.references,
    });

    const data: Prisma.CustomerUpdateInput = {
      ...dto,
      ...(normalizedPhone !== undefined ? { phone: normalizedPhone ?? dto.phone } : {}),
      ...(normalizedPhoneSecondary !== undefined
        ? { phoneSecondary: normalizedPhoneSecondary }
        : {}),
      ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
      ...(piiEncrypted as Partial<Prisma.CustomerUpdateInput>),
      references: dto.references !== undefined
        ? (dto.references as Prisma.InputJsonValue)
        : undefined,
    };
    const updated = await this.prisma.customer.update({
      where: { id },
      data,
    });

    // CONTACT_ADDED — เบอร์จากว่าง → มีค่า เทียบในโค้ด ไม่เก็บตัวเบอร์ · เปลี่ยนเบอร์ที่มีอยู่แล้วไม่นับ
    // (nationalId ไม่อยู่ใน UpdateCustomerDto ⇒ ทางนี้ได้แค่เบอร์)
    if (finalPhone !== undefined && !isBlankContact(finalPhone) && isBlankContact(before.phone)) {
      await this.journey?.recordAfterCommit(
        contactAddedEntry({
          customerId: id,
          fields: ['phone'],
          via: 'UPDATE',
          actorUserId: actor?.id ?? null,
          occurredAt: new Date(),
        }),
      );
    }
    return updated;
  }
```
ใน `fillPlaceholderContact` แทนบรรทัด 526-534 (ตั้งแต่ `await this.audit?.log({` ถึง `return { id: updated.id, ...`) ด้วย:
```ts
    await this.audit?.log({
      userId: actor.id,
      action: 'CUSTOMER_PLACEHOLDER_CONTACT_FILLED',
      entity: 'customer',
      entityId: id,
      oldValue: { name: current.name, phone: null },
      newValue: { name: updated.name, phone: updated.phone, nationalIdFilled: !!nationalId },
    });
    // CONTACT_ADDED — ด่าน isChatPlaceholder ข้างบนรับประกันว่าเดิมไม่มีทั้งเบอร์และเลขบัตร จึงนับทุกครั้งที่เติมสำเร็จ
    const filled: ContactField[] = nationalId ? ['phone', 'nationalId'] : ['phone'];
    await this.journey?.recordAfterCommit(
      contactAddedEntry({ customerId: id, fields: filled, via: 'FILL_CONTACT', actorUserId: actor.id, occurredAt: new Date() }),
    );
    return { id: updated.id, name: updated.name, phone: updated.phone as string };
```
`customers.service.ts` แทนเมธอด `update` (บรรทัด 74-76) ด้วย:
```ts
  update(id: string, dto: UpdateCustomerDto, actor?: { id: string; role: string }) {
    return this.write.update(id, dto, actor);
  }
```
`customers.controller.ts` แทนบรรทัด 261-265 ด้วย:
```ts
  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @Req() req: { user: { id: string; role: string } },
  ) {
    return this.customersService.update(id, dto, { id: req.user.id, role: req.user.role });
  }
```
`customers.module.ts` เพิ่ม import ถัดจากบรรทัด 16:
```ts
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';
```
ใน array `imports:` (บรรทัด 23) เพิ่ม `CustomerJourneyModule` เป็นตัวสุดท้าย (task ก่อนหน้าอาจเพิ่มไว้แล้ว ⇒ ต้องมีครั้งเดียว ห้ามซ้ำ):
```ts
  imports: [OverdueModule, CustomerPiiModule, ContactsModule, TestModeModule, CreditCheckModule, ChatProspectsModule, CustomerJourneyModule],
```
Run คำสั่ง unit ของ Step 5 → Expected: PASS ทั้งสองไฟล์ (write spec 9 tests) · Run คำสั่ง DB ของ Step 5 → Expected: PASS 6 tests · Run: `npx jest src/modules/customers/customers.service.spec.ts --runInBand` → Expected: PASS (เทส update เดิมไม่ provide writer จึงไม่บันทึก)

- [ ] **Step 7: เทสแดง — LINE_LINKED จาก LINE ร้าน (`selfLinkByPhone`) + facade `LineOaService`**

`line-customer-link.service.spec.ts` เพิ่ม import ถัดจากบรรทัด 1:
```ts
import { LineOaService } from '../line-oa.service';
```
เพิ่ม describe ท้ายไฟล์ (ถัดจากบรรทัด 56):
```ts
describe('LineCustomerLinkService.selfLinkByPhone → LINE_LINKED (LINE ร้าน)', () => {
  function linkingPrisma(): any {
    return {
      customer: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'cust-real', name: 'สมชาย' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
  }

  it('ผูกสำเร็จ → LINE_LINKED {SHOP, SELF_LINK_PHONE} หลัง update · ไม่มีเบอร์และ LINE user id ในแถว', async () => {
    const prisma = linkingPrisma();
    const order: string[] = [];
    prisma.customer.update.mockImplementation(async () => {
      order.push('update');
      return {};
    });
    const journey = {
      recordAfterCommit: jest.fn().mockImplementation(async () => {
        order.push('journey');
      }),
    };
    const service = new LineCustomerLinkService(prisma, {} as any, undefined, journey as any);
    await expect(service.selfLinkByPhone('Uabc', '0812345678')).resolves.toEqual({ success: true, customerName: 'สมชาย' });
    expect(order).toEqual(['update', 'journey']);
    const entry = journey.recordAfterCommit.mock.calls[0][0];
    expect(entry).toMatchObject({
      customerId: 'cust-real',
      kind: 'LINE_LINKED',
      actorType: 'CUSTOMER',
      actorUserId: null,
      data: { channel: 'SHOP', via: 'SELF_LINK_PHONE' },
    });
    expect(entry.dedupeKey).toBe(`LINE_LINKED:SHOP:cust-real:${entry.occurredAt.getTime()}`);
    const json = JSON.stringify(entry);
    expect(json).not.toContain('0812345678');
    expect(json).not.toContain('Uabc');
  });

  it('absorb ล้ม → ยังบันทึก LINE_LINKED (ผูกสำเร็จจริง)', async () => {
    const prisma = linkingPrisma();
    const merge = { absorbRoomsOfLineUser: jest.fn().mockRejectedValue(new Error('รวมไม่ได้: ผู้สนใจคนนี้มีใบจอง 1 รายการ')) };
    const journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
    const service = new LineCustomerLinkService(prisma, {} as any, merge as any, journey as any);
    await service.selfLinkByPhone('Uabc', '0812345678');
    expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
  });

  it('ไม่พบเบอร์ หรือ LINE นี้ผูกไว้แล้ว → ไม่บันทึก', async () => {
    const journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
    const notFound: any = { customer: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } };
    await new LineCustomerLinkService(notFound, {} as any, undefined, journey as any).selfLinkByPhone('Uabc', '0812345678');
    const already: any = { customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cust-real', name: 'สมชาย' }), update: jest.fn() } };
    await new LineCustomerLinkService(already, {} as any, undefined, journey as any).selfLinkByPhone('Uabc', '0812345678');
    expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('LineOaService ส่ง writer ต่อให้ LineCustomerLinkService (ตัวที่ถูก new เอง ไม่ผ่าน Nest DI)', async () => {
    const prisma = linkingPrisma();
    const journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
    const facade = new LineOaService({} as any, prisma, {} as any, {} as any, undefined, journey as any);
    await facade.selfLinkByPhone('Uabc', '0812345678');
    expect(journey.recordAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'LINE_LINKED', customerId: 'cust-real' }),
    );
  });
});
```
Run: `npx jest src/modules/line-oa/services/line-customer-link.service.spec.ts --runInBand` → Expected: FAIL `TS2554: Expected 2-3 arguments, but got 4.` และ `TS2554: Expected 4-5 arguments, but got 6.`

- [ ] **Step 8: เขียน LINE_LINKED ใน `selfLinkByPhone` + ส่ง writer ผ่าน `LineOaService`**

`line-customer-link.service.ts` เพิ่ม import ถัดจากบรรทัด 7:
```ts
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { lineLinkedEntry } from '../../customer-journey/chat-identity-entries';
```
แทน constructor (บรรทัด 13-17) ด้วย:
```ts
  constructor(
    private prisma: PrismaService,
    private apiClient: LineApiClientService,
    @Optional() private merge?: CustomerMergeService,
    // การเดินทางของลูกค้า — LINE_LINKED (lineIdShop ไม่มีคอลัมน์เวลาผูก)
    @Optional() private journey?: JourneyEntryWriter,
  ) {}
```
แทนบรรทัด 73-94 (ตั้งแต่ `// Link` ถึง `return { success: true, customerName: customer.name };`) ด้วย:
```ts
    // Link
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { lineIdShop: lineUserId },
    });
    const linkedAt = new Date();

    this.logger.log(`[LINE] Self-linked ${lineUserId} to customer ${customer.name} via phone ${phone}`);
    // ห้อง LINE ร้านของคนนี้ที่ถือผู้สนใจอัตโนมัติอยู่ → ดูดเข้าลูกค้าที่เพิ่งผูก (สเปค 3.3 ง)
    // best-effort: ผูก LINE ด้วยเบอร์สำเร็จแล้ว (update ข้างบน commit ไปแล้ว) ต้องไม่ถือว่าล้ม
    // เพราะดูด placeholder ไม่ได้ (เช่น placeholder มีเอกสารพ่วง — absorbPlaceholder โยน 409)
    try {
      await this.merge?.absorbRoomsOfLineUser(lineUserId, 'LINE_SHOP', customer.id, SYSTEM_ACTOR);
    } catch (err) {
      this.logger.warn(
        `[prospect] absorb rooms of ${lineUserId} → ${customer.id}: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { kind: 'chat-prospect' },
        extra: { lineUserId, customerId: customer.id },
      });
    }
    // LINE_LINKED หลังผูกสำเร็จ (absorb ล้มก็ยังบันทึก) · ไม่เก็บ lineUserId และเบอร์
    await this.journey?.recordAfterCommit(
      lineLinkedEntry({ customerId: customer.id, channel: 'SHOP', via: 'SELF_LINK_PHONE', occurredAt: linkedAt }),
    );
    return { success: true, customerName: customer.name };
```
`line-oa.service.ts` เพิ่ม import ถัดจากบรรทัด 6:
```ts
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
```
แทนบรรทัด 31-42 (constructor ถึงบรรทัดที่ `new LineCustomerLinkService`) ด้วย:
```ts
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private pdpaService: PDPAService,
    private integrationConfig: IntegrationConfigService,
    // ผู้สนใจอัตโนมัติจากแชท (แผน chat-prospects) — LineCustomerLinkService ถูก `new` ขึ้นเองข้างล่าง
    // ไม่ผ่าน Nest DI จึงต้องรับผ่าน constructor ของ facade นี้ (ตัวเดียวที่ Nest inject ให้จริง)
    // แล้วส่งต่อ ไม่งั้น absorbRoomsOfLineUser จะไม่ถูกเรียกเลยในโปรดักชัน
    @Optional() private merge?: CustomerMergeService,
    // การเดินทางของลูกค้า — เหตุผลเดียวกับ merge: ส่งต่อให้ LineCustomerLinkService บันทึก LINE_LINKED
    @Optional() private journey?: JourneyEntryWriter,
  ) {
    this.apiClient = new LineApiClientService(this.configService, this.integrationConfig);
    this.customerLink = new LineCustomerLinkService(this.prisma, this.apiClient, this.merge, this.journey);
```
Run เทส Step 7 อีกครั้ง → Expected: PASS 8 tests (4 เดิม + 4 ใหม่)

- [ ] **Step 9: เทสแดง — LINE_LINKED จาก LIFF (`confirmLinkLine`)**

`liff-api.service.spec.ts`:
- เพิ่ม import ถัดจากบรรทัด 4: `import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';`
- ถัดจาก `let merge: any;` (บรรทัด 12) เพิ่ม `let journey: { recordAfterCommit: jest.Mock };`
- ถัดจากบรรทัด 35 (`merge = { absorbRoomsOfLineUser: ... }`) เพิ่ม `journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };`
- ใน `providers` ถัดจากบรรทัด 41 เพิ่ม `{ provide: JourneyEntryWriter, useValue: journey },`

เพิ่มเทสใน `describe('confirmLinkLine')` ถัดจากบรรทัด 273:
```ts
    it('ผูกสำเร็จ (ยังไม่เคยผูก) → LINE_LINKED {FINANCE, LIFF} · ไม่มี LINE user id ในแถว', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1', deletedAt: null, lineIdFinance: null });
      prisma.customer.update.mockResolvedValue({});

      await service.confirmLinkLine('cust-1', 'Ufin');
      expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
      const entry = journey.recordAfterCommit.mock.calls[0][0];
      expect(entry).toMatchObject({
        customerId: 'cust-1',
        kind: 'LINE_LINKED',
        actorType: 'CUSTOMER',
        actorUserId: null,
        data: { channel: 'FINANCE', via: 'LIFF' },
      });
      expect(entry.dedupeKey).toBe(`LINE_LINKED:FINANCE:cust-1:${entry.occurredAt.getTime()}`);
      expect(JSON.stringify(entry)).not.toContain('Ufin');
    });

    it('absorb ล้ม → ยังบันทึก LINE_LINKED (ผูกสำเร็จจริง)', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1', deletedAt: null, lineIdFinance: null });
      prisma.customer.update.mockResolvedValue({});
      merge.absorbRoomsOfLineUser.mockRejectedValue(new Error('รวมไม่ได้: ผู้สนใจคนนี้มีใบจอง 1 รายการ'));

      await expect(service.confirmLinkLine('cust-1', 'Ufin')).resolves.toEqual({ success: true });
      expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
    });

    it('ลูกค้าคนเดิมกับ LINE เดิม (lineIdFinance เท่าเดิม) → ไม่นับเป็นการผูกใหม่', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1', deletedAt: null, lineIdFinance: 'Ufin' });
      prisma.customer.update.mockResolvedValue({});

      await expect(service.confirmLinkLine('cust-1', 'Ufin')).resolves.toEqual({ success: true });
      expect(journey.recordAfterCommit).not.toHaveBeenCalled();
    });

    it('ผูกไม่สำเร็จ (LINE ผูกคนอื่นแล้ว) → ไม่บันทึก', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'other_customer' });
      await service.confirmLinkLine('cust-1', 'Ufin');
      expect(journey.recordAfterCommit).not.toHaveBeenCalled();
    });

    it('update ล้ม → ไม่บันทึก และโยนต่อ', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1', deletedAt: null, lineIdFinance: null });
      prisma.customer.update.mockRejectedValue(new Error('db down'));

      await expect(service.confirmLinkLine('cust-1', 'Ufin')).rejects.toThrow('db down');
      expect(journey.recordAfterCommit).not.toHaveBeenCalled();
    });
```
Run: `npx jest src/modules/line-oa/liff-api.service.spec.ts --runInBand` → Expected: FAIL 2 tests (`ผูกสำเร็จ (ยังไม่เคยผูก)` และ `absorb ล้ม`) ด้วย `Expected number of calls: 1 Received number of calls: 0`

- [ ] **Step 10: เขียน LINE_LINKED ใน `confirmLinkLine` + ต่อ LineOaModule**

`liff-api.service.ts` เพิ่ม import ถัดจากบรรทัด 7:
```ts
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { lineLinkedEntry } from '../customer-journey/chat-identity-entries';
```
แทน constructor (บรรทัด 21-24) ด้วย:
```ts
  constructor(
    private prisma: PrismaService,
    @Optional() private merge?: CustomerMergeService,
    // การเดินทางของลูกค้า — LINE_LINKED ตอนลงทะเบียน LINE การเงินผ่าน LIFF
    @Optional() private journey?: JourneyEntryWriter,
  ) {}
```
แทนบรรทัด 194-215 (ตั้งแต่ `await this.prisma.customer.update({` ถึง `return { success: true };`) ด้วย:
```ts
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { lineIdFinance: lineId },
    });
    const linkedAt = new Date();

    // Log by customer id, not name — name is PII (PDPA). The id is enough to trace.
    this.logger.log(`[LIFF] Linked LINE ${lineId} to customer ${customerId} via finance registration`);
    // ห้อง LINE การเงินของคนนี้ที่ถือผู้สนใจอัตโนมัติอยู่ → ดูดเข้าลูกค้าที่เพิ่งผูก (สเปค 3.3 ง)
    // best-effort: ผูก LINE สำเร็จแล้ว (update ข้างบน commit ไปแล้ว) ต้องไม่ถือว่าล้มเพราะดูด
    // placeholder ไม่ได้ (เช่น placeholder มีเอกสารพ่วง — absorbPlaceholder โยน 409)
    try {
      await this.merge?.absorbRoomsOfLineUser(lineId, 'LINE_FINANCE', customerId, SYSTEM_ACTOR);
    } catch (err) {
      this.logger.warn(
        `[prospect] absorb rooms of ${lineId} → ${customerId}: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { kind: 'chat-prospect' },
        extra: { lineId, customerId },
      });
    }
    // LINE_LINKED — ลูกค้าคนเดิมกับ LINE เดิมไม่ใช่การผูกใหม่ จึงไม่บันทึกซ้ำ · ไม่เก็บ lineId
    if (customer.lineIdFinance !== lineId) {
      await this.journey?.recordAfterCommit(
        lineLinkedEntry({ customerId, channel: 'FINANCE', via: 'LIFF', occurredAt: linkedAt }),
      );
    }
    return { success: true };
```
`line-oa.module.ts` เพิ่ม import ถัดจากบรรทัด 33:
```ts
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';
```
ใน `imports:` ถัดจาก `ChatProspectsModule,` (บรรทัด 50) เพิ่ม:
```ts
    // การเดินทางของลูกค้า — LiffApiService / LineOaService บันทึก LINE_LINKED
    // (CustomerJourneyModule ไม่ import โมดูลแชทหรือ LINE กลับมา จึงไม่มีวงจร)
    CustomerJourneyModule,
```
Run เทส Step 9 อีกครั้ง → Expected: PASS ทั้งไฟล์

- [ ] **Step 11: เทสแดง — LINE_LINKED จาก OTP (`VerificationService.bind`)**

`verification.service.spec.ts` เพิ่ม import ถัดจากบรรทัด 8:
```ts
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
```
เพิ่ม describe ใหม่ถัดจากบรรทัด 415 (หลัง describe `Fix round 1 — R11` ปิด และยังอยู่ใน `describe('verifyOtp')` เพื่อใช้ `makeRecord`):
```ts
    describe('LINE_LINKED หลัง bind() commit', () => {
      let jPrisma: any;
      let upsert: jest.Mock;
      let journey: { recordAfterCommit: jest.Mock };
      let jService: VerificationService;
      let order: string[];

      beforeEach(async () => {
        order = [];
        upsert = jest.fn().mockResolvedValue({});
        jPrisma = {
          chatbotOtpRequest: {
            findUnique: jest.fn().mockResolvedValue(makeRecord('ignored-in-test-mode')),
            delete: jest.fn().mockResolvedValue({}),
          },
          customer: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', name: 'สมชาย' }) },
          customerLineLink: { findUnique: jest.fn().mockResolvedValue(null) },
          $transaction: jest.fn().mockImplementation(async (cb: any) => {
            const result = await cb({
              customerLineLink: { upsert },
              chatRoom: { updateMany: jest.fn().mockResolvedValue({}) },
              customer: { update: jest.fn().mockResolvedValue({}) },
            });
            order.push('commit');
            return result;
          }),
        };
        journey = {
          recordAfterCommit: jest.fn().mockImplementation(async () => {
            order.push('journey');
          }),
        };
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            VerificationService,
            { provide: PrismaService, useValue: jPrisma },
            { provide: NotificationsService, useValue: { sendSmsFromQueue: jest.fn() } },
            // test-mode bypass: ข้ามการเทียบ hash แต่ผ่าน bind() เส้นเดียวกับยืนยันจริง
            { provide: TestModeService, useValue: { isEnabled: jest.fn().mockResolvedValue(true) } },
            { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
            { provide: JourneyEntryWriter, useValue: journey },
          ],
        }).compile();
        jService = module.get(VerificationService);
      });

      it('ยืนยันสำเร็จ → LINE_LINKED {FINANCE, VERIFICATION} หลัง transaction commit · linkedAt ตรงกับ occurredAt · ไม่มี LINE user id ในแถว', async () => {
        await jService.verifyOtp({ lineUserId: 'U123', otp: '999999' });

        expect(order).toEqual(['commit', 'journey']);
        const entry = journey.recordAfterCommit.mock.calls[0][0];
        expect(entry).toMatchObject({
          customerId: 'c1',
          kind: 'LINE_LINKED',
          actorType: 'CUSTOMER',
          actorUserId: null,
          data: { channel: 'FINANCE', via: 'VERIFICATION' },
        });
        expect(entry.dedupeKey).toBe(`LINE_LINKED:FINANCE:c1:${entry.occurredAt.getTime()}`);
        expect(upsert.mock.calls[0][0].update.linkedAt).toEqual(entry.occurredAt);
        expect(JSON.stringify(entry)).not.toContain('U123');
        expect(jPrisma.customerLineLink.findUnique).toHaveBeenCalledWith({
          where: { lineUserId_channel: { lineUserId: 'U123', channel: 'FINANCE' } },
          select: { customerId: true, unlinkedAt: true, deletedAt: true },
        });
      });

      it('ยืนยันซ้ำกับลูกค้าคนเดิมที่ยังผูกอยู่ → ไม่นับเป็นการผูกใหม่ ไม่บันทึก', async () => {
        jPrisma.customerLineLink.findUnique.mockResolvedValue({ customerId: 'c1', unlinkedAt: null, deletedAt: null });
        await jService.verifyOtp({ lineUserId: 'U123', otp: '999999' });
        expect(order).toEqual(['commit']);
        expect(journey.recordAfterCommit).not.toHaveBeenCalled();
      });

      it('LINE นี้เคยผูกลูกค้าคนอื่น หรือเคยถูกยกเลิก → นับเป็นการผูกใหม่', async () => {
        jPrisma.customerLineLink.findUnique.mockResolvedValueOnce({ customerId: 'c-old', unlinkedAt: null, deletedAt: null });
        await jService.verifyOtp({ lineUserId: 'U123', otp: '999999' });
        jPrisma.customerLineLink.findUnique.mockResolvedValueOnce({ customerId: 'c1', unlinkedAt: new Date('2026-09-01T00:00:00.000Z'), deletedAt: null });
        await jService.verifyOtp({ lineUserId: 'U123', otp: '999999' });
        expect(journey.recordAfterCommit).toHaveBeenCalledTimes(2);
      });

      it('transaction ของ bind() ล้ม → ไม่บันทึก และ verifyOtp โยนต่อ', async () => {
        jPrisma.$transaction.mockRejectedValue(new Error('deadlock'));
        await expect(jService.verifyOtp({ lineUserId: 'U123', otp: '999999' })).rejects.toThrow('deadlock');
        expect(journey.recordAfterCommit).not.toHaveBeenCalled();
      });
    });
```
Run: `npx jest src/modules/chatbot-finance/services/verification.service.spec.ts --runInBand` → Expected: FAIL 2 tests — `ยืนยันสำเร็จ → LINE_LINKED ...` (`order` ได้ `["commit"]`) และ `LINE นี้เคยผูกลูกค้าคนอื่น หรือเคยถูกยกเลิก` (`Received number of calls: 0`) · เทส `ยืนยันซ้ำกับลูกค้าคนเดิม` ผ่านอยู่แล้ว

- [ ] **Step 12: เขียน LINE_LINKED ใน `bind` + ต่อ ChatbotFinanceModule**

`verification.service.ts` เพิ่ม import ถัดจากบรรทัด 11:
```ts
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { lineLinkedEntry } from '../../customer-journey/chat-identity-entries';
```
แทน constructor (บรรทัด 51-57) ด้วย:
```ts
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private testMode: TestModeService,
    private audit: AuditService,
    @Optional() private merge?: CustomerMergeService,
    // การเดินทางของลูกค้า — LINE_LINKED (ผูกซ้ำรีเซ็ต customer_line_links.linkedAt ประวัติรอบก่อนจึงหาย)
    @Optional() private journey?: JourneyEntryWriter,
  ) {}
```
แทนเมธอด `bind` (บรรทัด 396-425) ด้วย:
```ts
  private async bind(lineUserId: string, customerId: string): Promise<void> {
    // LINE_LINKED นับเฉพาะการผูกที่เปลี่ยนจริง — ยืนยัน OTP ซ้ำกับลูกค้าคนเดิมที่ยังผูกอยู่ไม่ใช่เหตุการณ์ใหม่
    const previous = await this.prisma.customerLineLink.findUnique({
      where: { lineUserId_channel: { lineUserId, channel: LineChannelType.FINANCE } },
      select: { customerId: true, unlinkedAt: true, deletedAt: true },
    });
    const newlyLinked =
      !previous || previous.customerId !== customerId || previous.unlinkedAt !== null || previous.deletedAt !== null;
    const linkedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.customerLineLink.upsert({
        where: {
          lineUserId_channel: { lineUserId, channel: LineChannelType.FINANCE },
        },
        create: { customerId, lineUserId, channel: LineChannelType.FINANCE },
        update: { customerId, unlinkedAt: null, linkedAt },
      });

      await tx.chatRoom.updateMany({
        where: { lineUserId, channel: 'LINE_FINANCE' },
        data: {
          customerId,
          verifiedAt: new Date(),
          verificationAttempts: 0,
        },
      });

      // Sync canonical customer.lineIdFinance — LIFF pages (LiffContract etc.)
      // lookup customer ด้วย field นี้ตรงๆ ถ้าไม่ update จะ "ไม่มีสัญญา"
      // ทั้งที่ chatbot/CustomerLineLink link เรียบร้อยแล้ว
      // Verification flow runs in line-finance OA context — write finance lineId
      await tx.customer.update({
        where: { id: customerId },
        data: { lineIdFinance: lineUserId },
      });
    });
    this.logger.log(`[Verify] Bound ${lineUserId.slice(0, 8)}... → customer ${customerId.slice(0, 8)}...`);
    // LINE_LINKED หลัง commit เท่านั้น — ห้ามย้ายเข้า $transaction (writer ใช้ prisma ของตัวเอง) · ไม่เก็บ lineUserId
    if (newlyLinked) {
      await this.journey?.recordAfterCommit(
        lineLinkedEntry({ customerId, channel: 'FINANCE', via: 'VERIFICATION', occurredAt: linkedAt }),
      );
    }
  }
```
`chatbot-finance.module.ts` เพิ่ม import ถัดจากบรรทัด 33:
```ts
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';
```
แทนบรรทัด 53 ด้วย:
```ts
  imports: [forwardRef(() => NotificationsModule), forwardRef(() => StaffChatModule), IntegrationsModule, TestModeModule, ChatProspectsModule, CustomerJourneyModule], // SMS for OTP + WS events to Unified Inbox; TestModeModule for LIFF OTP bypass (UAT); ChatProspectsModule for chat prospect auto-creation; CustomerJourneyModule for LINE_LINKED (VerificationService)
```
Run เทส Step 11 อีกครั้ง → Expected: PASS ทั้งไฟล์

- [ ] **Step 13: เทสแดง — PRODUCT_LINK_CLICK (Facebook webhook)**

`facebook-webhook.controller.spec.ts`:
- เพิ่ม import ถัดจากบรรทัด 12: `import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';`
- ใน describe `standalone referral จากลิงก์สินค้า (B4)` ถัดจาก `let postbackRouter: { route: jest.Mock };` (บรรทัด 397) เพิ่ม `let journey: { recordAfterCommit: jest.Mock };`
- ใน `beforeEach` ก่อน `const mod: TestingModule = ...` (บรรทัด 439) เพิ่ม `journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };`
- ใน `providers` ถัดจากบรรทัด 447 เพิ่ม `{ provide: JourneyEntryWriter, useValue: journey },`

เพิ่มเทสท้าย describe เดียวกัน (ถัดจากบรรทัด 695 ก่อน `});` ปิด describe):
```ts
  // ── PRODUCT_LINK_CLICK (การเดินทางของลูกค้า) ──
  it('ลิงก์สินค้า p:<id> + ห้องมีเจ้าของ → PRODUCT_LINK_CLICK หลังโพสต์โน้ต · เวลาและ dedupe มาจาก timestamp ของ event', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-1', customerId: 'cust-1' });
    const order: string[] = [];
    router.postSystemNote.mockImplementation(async () => {
      order.push('note');
    });
    journey.recordAfterCommit.mockImplementation(async () => {
      order.push('journey');
    });
    const { req, signature } = signedRequest(FB_APP_SECRET, referralEvent(`p:${PRODUCT_ID}`));
    await controller.handleWebhook(req, referralEvent(`p:${PRODUCT_ID}`), signature);

    expect(order).toEqual(['note', 'journey']);
    expect(journey.recordAfterCommit).toHaveBeenCalledWith({
      customerId: 'cust-1',
      kind: 'PRODUCT_LINK_CLICK',
      occurredAt: new Date(1),
      actorType: 'CUSTOMER',
      actorUserId: null,
      roomId: 'room-1',
      refType: 'product',
      refId: PRODUCT_ID,
      data: { productId: PRODUCT_ID },
      dedupeKey: `PRODUCT_LINK_CLICK:room-1:${PRODUCT_ID}:1`,
    });
    expect(JSON.stringify(journey.recordAfterCommit.mock.calls[0][0])).not.toContain(PSID);
  });

  it('ห้องยังไม่มีเจ้าของ (customerId null) → โน้ตยังโพสต์ แต่ไม่บันทึก', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-1', customerId: null });
    const { req, signature } = signedRequest(FB_APP_SECRET, referralEvent(`p:${PRODUCT_ID}`));
    await controller.handleWebhook(req, referralEvent(`p:${PRODUCT_ID}`), signature);
    expect(router.postSystemNote).toHaveBeenCalled();
    expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('ref ไม่ใช่สินค้า หรือไม่พบสินค้า → ไม่บันทึก', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-1', customerId: 'cust-1' });
    const promo = signedRequest(FB_APP_SECRET, referralEvent('promo-songkran'));
    await controller.handleWebhook(promo.req, referralEvent('promo-songkran'), promo.signature);
    prisma.product.findFirst.mockResolvedValue(null);
    const gone = signedRequest(FB_APP_SECRET, referralEvent(`p:${PRODUCT_ID}`));
    await controller.handleWebhook(gone.req, referralEvent(`p:${PRODUCT_ID}`), gone.signature);
    expect(router.postSystemNote).toHaveBeenCalledTimes(2);
    expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('โพสต์โน้ตล้ม → ไม่บันทึก และ webhook ยังตอบ EVENT_RECEIVED', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-1', customerId: 'cust-1' });
    router.postSystemNote.mockRejectedValue(new Error('send failed'));
    const { req, signature } = signedRequest(FB_APP_SECRET, referralEvent(`p:${PRODUCT_ID}`));
    await expect(controller.handleWebhook(req, referralEvent(`p:${PRODUCT_ID}`), signature)).resolves.toBe('EVENT_RECEIVED');
    expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('ลูกค้าใหม่ทักพร้อม message.referral ของลิงก์สินค้า → บันทึกหลัง routeInbound ด้วยเวลา event · ข้อความลูกค้าไม่หลุดเข้าแถว', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-1', customerId: 'cust-1' });
    const body = {
      object: 'page',
      entry: [{ id: 'page1', time: 1, messaging: [{
        sender: { id: PSID }, recipient: { id: 'page1' }, timestamp: 1790000000000,
        message: {
          mid: 'mid_journey_product_click',
          text: 'เครื่องนี้ยังมีไหมครับ',
          referral: { ref: `p:${PRODUCT_ID}`, source: 'SHORTLINK', type: 'OPEN_THREAD' },
        },
      }] }],
    };
    const { req, signature } = signedRequest(FB_APP_SECRET, body);
    await controller.handleWebhook(req, body, signature);
    await new Promise((r) => setImmediate(r));

    expect(journey.recordAfterCommit).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'PRODUCT_LINK_CLICK',
      customerId: 'cust-1',
      occurredAt: new Date(1790000000000),
      dedupeKey: `PRODUCT_LINK_CLICK:room-1:${PRODUCT_ID}:1790000000000`,
    }));
    expect(JSON.stringify(journey.recordAfterCommit.mock.calls[0][0])).not.toContain('เครื่องนี้ยังมีไหมครับ');
  });
```
Run: `npx jest src/modules/chat-adapters/facebook-webhook.controller.spec.ts --runInBand` → Expected: FAIL 2 tests (`ลิงก์สินค้า p:<id> + ห้องมีเจ้าของ` และ `ลูกค้าใหม่ทักพร้อม message.referral`) ด้วย `Received number of calls: 0` · อีก 3 เทสใหม่ผ่านอยู่แล้ว (ยืนยันว่ากรณีที่ไม่ควรบันทึกไม่บันทึก)

- [ ] **Step 14: เขียน PRODUCT_LINK_CLICK ใน `handleProductReferral` + ต่อ ChatAdaptersModule**

`facebook-webhook.controller.ts`:
- ใน import จาก `@nestjs/common` (บรรทัด 1-14) เพิ่ม `Optional,` ถัดจาก `Res,`
- เพิ่ม import ถัดจากบรรทัด 27:
```ts
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { productLinkClickEntry } from '../customer-journey/chat-identity-entries';
```
- แทนบรรทัด 80-81 (`private integrationConfig: IntegrationConfigService,` + `) {}`) ด้วย:
```ts
    private integrationConfig: IntegrationConfigService,
    // การเดินทางของลูกค้า — PRODUCT_LINK_CLICK (เดิมมีแค่ข้อความระบบในห้อง แกะย้อนหลังไม่ได้)
    @Optional() private journey?: JourneyEntryWriter,
  ) {}
```
- call site เส้น postback ที่ router รับแล้ว (บรรทัด 258-261) แทนด้วย:
```ts
                  await this.handleProductReferral(
                    senderId,
                    String(handledAttribution.utmContent),
                    this.eventTime(event),
                  );
```
- call site เส้น postback legacy (บรรทัด 306) แทนด้วย:
```ts
          attribution?.utmContent ? this.handleProductReferral(senderId, String(attribution.utmContent), this.eventTime(event)) : undefined,
```
- call site standalone referral (บรรทัด 332) แทนด้วย:
```ts
        await this.handleProductReferral(senderId, String(event.referral.ref), this.eventTime(event));
```
- call site เส้น message (บรรทัด 373) แทนด้วย:
```ts
          ? this.handleProductReferral(senderId, String(attribution.utmContent), this.eventTime(event))
```
- แทนบรรทัด 445-498 (JSDoc ของ `handleProductReferral` ถึงวงเล็บปิดของ `buildReferralNote`) ด้วย:
```ts
  /** เวลาของ event จาก Meta (ms) — redelivery ส่งค่าเดิม จึงใช้ทำ dedupeKey ได้ · ไม่มีค่า = เวลาปัจจุบัน */
  private eventTime(event: { timestamp?: number }): Date {
    return event.timestamp ? new Date(event.timestamp) : new Date();
  }

  /**
   * แปลง `ref` จากลิงก์ m.me เป็นโน้ตระบบในห้องแชท
   *
   * รูปแบบที่เว็บลูกค้าส่งมา: `p:<productId>` (ดู apps/web-shop/src/lib/copy.ts)
   * เจตนา: ให้ทีมงาน + ProductContextCard เห็นว่าลูกค้ามาจากเครื่องไหน โดย
   * ไม่ต้องมีคอลัมน์สถานะใหม่ (ChatRoom.attachedProductId ถูกตัดออกจาก scope)
   * การเดินทางของลูกค้า: หลังโพสต์โน้ตสำเร็จ เขียน PRODUCT_LINK_CLICK เฉพาะ `p:<id>` ที่พบสินค้าจริง
   * และห้องมีเจ้าของแล้ว (ref ที่มาจากลิงก์ปลอมจึงไม่ถูกเก็บ)
   */
  private async handleProductReferral(senderId: string, ref: string, occurredAt: Date): Promise<void> {
    try {
      const room = await this.prisma.chatRoom.findFirst({
        where: {
          externalUserId: senderId,
          channel: ChatChannel.FACEBOOK,
          deletedAt: null,
        },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true, customerId: true },
      });
      if (!room) {
        this.logger.log(
          `[FB referral] PSID ${senderId} ref="${ref}" — ยังไม่มีห้อง ข้ามการโพสต์โน้ต`,
        );
        return;
      }
      const note = await this.buildReferralNote(ref);
      if (!note) return;
      await this.messageRouter.postSystemNote(room.id, note.text);
      this.logger.log(`[FB referral] PSID ${senderId} ref="${ref}" → โน้ตระบบในห้อง ${room.id}`);
      // writer ไม่โยน · ห้ามส่ง PSID หรือข้อความลูกค้าเข้าแถว
      if (note.productId && room.customerId) {
        await this.journey?.recordAfterCommit(
          productLinkClickEntry({ customerId: room.customerId, roomId: room.id, productId: note.productId, occurredAt }),
        );
      }
    } catch (err) {
      // referral เป็นข้อมูลเสริม — ห้ามทำให้ webhook ทั้งก้อนล้ม
      this.logger.warn(
        `[FB referral] failed for PSID ${senderId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** productId ไม่เป็น null เฉพาะเมื่อ ref เป็น `p:<id>` และพบสินค้าจริง */
  private async buildReferralNote(ref: string): Promise<{ text: string; productId: string | null } | null> {
    const trimmed = ref.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith('p:')) {
      return { text: `ลูกค้ากดเข้ามาจากลิงก์เว็บ (ref: ${trimmed})`, productId: null };
    }
    const productId = trimmed.slice(2);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { brand: true, model: true, storage: true, color: true, imeiSerial: true },
    });
    if (!product) return { text: 'ลูกค้ากดเข้ามาจากลิงก์สินค้าบนเว็บ (ไม่พบสินค้านี้แล้ว)', productId: null };
    const name = [product.brand, product.model, product.storage, product.color]
      .filter(Boolean)
      .join(' ');
    const tail = product.imeiSerial ? ` (${product.imeiSerial.slice(-4)})` : '';
    return { text: `ลูกค้ากดมาจากสินค้า ${name}${tail} บนเว็บ`, productId };
  }
```
`chat-adapters.module.ts` เพิ่ม import ถัดจากบรรทัด 17:
```ts
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';
```
ใน `imports:` ถัดจาก `IntegrationsModule,` (บรรทัด 35) เพิ่ม:
```ts
    // การเดินทางของลูกค้า — FacebookWebhookController บันทึก PRODUCT_LINK_CLICK
    CustomerJourneyModule,
```
Run เทส Step 13 อีกครั้ง → Expected: PASS ทั้งไฟล์ (เทสเดิมทุกตัวยังผ่าน ห้องใน mock เดิมไม่มี customerId จึงไม่บันทึก)

- [ ] **Step 15: ตรวจรวม — typecheck · lint · เทสทุกโมดูลที่แตะ**

Run (จาก `apps/api`): `npx tsc --noEmit -p tsconfig.json` → Expected: 0 error

Run: `npx eslint src/modules/customer-journey/chat-identity-entries.ts src/modules/chat-engine/services/handoff-manager.service.ts src/modules/chat-engine/chat-engine.module.ts src/modules/customers/services/customer-write.service.ts src/modules/customers/customers.service.ts src/modules/customers/customers.controller.ts src/modules/customers/customers.module.ts src/modules/line-oa/services/line-customer-link.service.ts src/modules/line-oa/line-oa.service.ts src/modules/line-oa/liff-api.service.ts src/modules/line-oa/line-oa.module.ts src/modules/chatbot-finance/services/verification.service.ts src/modules/chatbot-finance/chatbot-finance.module.ts src/modules/chat-adapters/facebook-webhook.controller.ts src/modules/chat-adapters/chat-adapters.module.ts` → Expected: 0 error (🚨 ห้าม `npm run lint`)

Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/chat-identity-entries.spec.ts src/modules/chat-engine src/modules/customers src/modules/line-oa src/modules/chatbot-finance/services/verification.service.spec.ts src/modules/chat-adapters src/modules/webhooks/__tests__/webhook-inbound-regression.spec.ts src/modules/staff-chat/staff-chat.controller.spec.ts src/modules/collections-session/collections-summary.service.spec.ts --runInBand` → Expected: PASS ทุก suite

PDPA check: `grep -n "summary\|lineUserId\|lineId\|senderId\|phone" src/modules/customer-journey/chat-identity-entries.ts` → Expected: เจอเฉพาะในคอมเมนต์ (type `ContactField` import มาจาก `journey-data-schemas.ts`) ไม่มีพารามิเตอร์หรือคีย์ data ที่รับค่าเหล่านี้ · `grep -n "reason" src/modules/customer-journey/chat-identity-entries.ts` → เจอเฉพาะ `reason: string` ของ input และ `handoffReasonCode(input.reason)` ไม่มีคีย์ `reason` ใน data

- [ ] **Step 16: Commit**

```bash
git add apps/api/src/modules/customer-journey/chat-identity-entries.ts apps/api/src/modules/customer-journey/chat-identity-entries.spec.ts apps/api/src/modules/chat-engine/services/handoff-manager.service.ts apps/api/src/modules/chat-engine/services/handoff-manager.service.spec.ts apps/api/src/modules/chat-engine/chat-engine.module.ts apps/api/src/modules/customers/services/customer-write.service.ts apps/api/src/modules/customers/services/customer-write.journey.spec.ts apps/api/src/modules/customers/services/customer-write.fill-contact.db.spec.ts apps/api/src/modules/customers/customers.service.ts apps/api/src/modules/customers/customers.controller.ts apps/api/src/modules/customers/customers.controller.spec.ts apps/api/src/modules/customers/customers.module.ts apps/api/src/modules/line-oa/services/line-customer-link.service.ts apps/api/src/modules/line-oa/services/line-customer-link.service.spec.ts apps/api/src/modules/line-oa/line-oa.service.ts apps/api/src/modules/line-oa/liff-api.service.ts apps/api/src/modules/line-oa/liff-api.service.spec.ts apps/api/src/modules/line-oa/line-oa.module.ts apps/api/src/modules/chatbot-finance/services/verification.service.ts apps/api/src/modules/chatbot-finance/services/verification.service.spec.ts apps/api/src/modules/chatbot-finance/chatbot-finance.module.ts apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts apps/api/src/modules/chat-adapters/chat-adapters.module.ts
git commit -m "feat(customer-journey): บันทึกบอทส่งต่อ ได้เบอร์ ผูก LINE และกดลิงก์สินค้า เป็นแถวการเดินทางอัตโนมัติ

- BOT_HANDOFF ใน HandoffManagerService.initiateHandoff เก็บแค่ priority + รหัสเหตุผลปิด (ไม่เก็บข้อความลูกค้าและข้อความเหตุผล)
- CONTACT_ADDED ตอนเบอร์จากว่างเป็นมีค่า ใน update และ fill-contact (ไม่เก็บเบอร์และเลขบัตร) · PATCH /customers/:id ส่ง actor · ยังไม่ต่อเครื่องมือเก็บเบอร์ของบอทขาย (บอทยังไม่เปิด)
- LINE_LINKED ใน selfLinkByPhone, LIFF confirmLinkLine และ bind ของ OTP เฉพาะการผูกที่เปลี่ยนจริง (ไม่เก็บ LINE user id)
- PRODUCT_LINK_CLICK ใน handleProductReferral เฉพาะสินค้าที่พบจริงและห้องที่มีเจ้าของ
- ทุกจุดเขียนหลังการเขียนหลักสำเร็จแบบ best-effort · data และ dedupeKey ตามสัญญากลาง journey-data-schemas.ts

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: แยก `contract-event-sources.ts` ออกจาก `OverdueTimelineService.getFullTimeline` (ล็อก golden ก่อนแยก)

**เป้าหมาย:** ย้าย query 5 ชุดและตัวแปลง event ใน `overdue/timeline.service.ts` ไปเป็นฟังก์ชัน `contractEventSources(prisma, contractIds[], window?)` ที่รับได้หลายสัญญา กรองช่วงเวลาได้ และทำ keyset ได้ แท็บการเดินทางของลูกค้า (`sources/collections.source.ts` / `payment.source.ts`) จะเรียกฟังก์ชันนี้ ส่วน `GET /overdue/contracts/:id/full-timeline` ต้องคืนผลเหมือนเดิมทุกไบต์ ซึ่งล็อกไว้ด้วย golden spec ที่ต้องเขียวกับโค้ดเดิม **ก่อน** แตะ service

**Files:**
- Create: `apps/api/src/modules/overdue/timeline.service.golden.spec.ts` (golden · เขียนและรันก่อน refactor)
- Create: `apps/api/src/modules/overdue/contract-event-sources.ts`
- Create: `apps/api/src/modules/overdue/contract-event-sources.spec.ts`
- Create: `apps/api/src/modules/overdue/contract-event-sources.db.spec.ts`
- Modify: `apps/api/src/modules/overdue/timeline.service.ts:1-170` (เขียนทับทั้งไฟล์: type ในบรรทัด 4-19 และ `CALL_RESULT_LABELS` ในบรรทัด 21-28 ย้ายไปไฟล์ใหม่ · query 5 ชุดในบรรทัด 42-81 และตัวแปลงในบรรทัด 83-147 ย้ายไปไฟล์ใหม่ · ส่วน sort/slice ในบรรทัด 149-150 คงไว้ · `formatAuditTitle` ในบรรทัด 153-169 ย้ายไปเป็นฟังก์ชันระดับโมดูล)
- ไม่แตะ (ผู้เรียกเดิม ตรวจแล้ว): `apps/api/src/modules/overdue/overdue.controller.ts:226-230` · `apps/api/src/modules/overdue/overdue.module.ts:15,58,87` · `apps/web/src/pages/CollectionsPage/hooks/useCustomer360.ts:48` · `apps/api/src/modules/overdue/timeline.service.spec.ts` (6 เทสเดิมต้องเขียวโดยไม่แก้)

**Interfaces:**
- Consumes: delegate ของ Prisma คือ `callLog` · `payment` · `dunningAction` · `auditLog` · `contractLetter` (`PrismaService extends PrismaClient`) · route เดิม `GET /overdue/contracts/:id/full-timeline` → `OverdueTimelineService.getFullTimeline(contractId): Promise<TimelineEvent[]>` (รูปผลลัพธ์ห้ามเปลี่ยน)
- Produces (จาก `apps/api/src/modules/overdue/contract-event-sources.ts`):
  - `export type TimelineEventType = 'CALL' | 'PAYMENT' | 'DUNNING_ACTION' | 'STATUS_CHANGE' | 'MDM' | 'LETTER'`
  - `export interface TimelineEvent { id: string; type: TimelineEventType; timestamp: string; title: string; subtitle?: string; metadata?: Record<string, unknown> }` — `timeline.service.ts` re-export ทั้งสอง type ด้วยชื่อเดิม
  - `export interface ContractEventRow { contractId: string; actorUserId: string | null; event: TimelineEvent }`
  - `export interface ContractEventWindow { before?: { ts: string; id: string }; from?: Date; to?: Date; limit?: number }` — รูปตรงกับ window ของ `sources/*.source.ts` (`{ before?; from?; to?; limit: number }`) จึงส่งต่อได้ทันที
  - `export type ContractEventPrisma = Pick<PrismaClient, 'callLog' | 'payment' | 'dunningAction' | 'auditLog' | 'contractLetter'>`
  - `export const CONTRACT_EVENT_SOURCE_TAKE = 50`
  - `export async function contractEventSources(prisma: ContractEventPrisma, contractIds: string[], window?: ContractEventWindow): Promise<ContractEventRow[]>`
  - ความหมาย: `contractIds` ว่าง → `[]` และไม่ query · `from`/`to` รวมค่าที่เท่ากันทั้งสองข้าง (หนังสือใช้ `dispatchedAt ?? createdAt`) · `before` = keyset แบบเข้ม `(timestamp, id) < (ts, id)` และแปลง `ts` เป็น ISO ก่อนเทียบ · `limit` ใช้ **ต่อ source** · แถวเรียงตาม source (call → payment → dunning → audit → letter) **ไม่ได้ sort ข้าม source** ผู้เรียกต้อง sort เอง · PAYMENT ยังใช้ `updatedAt` (การเปลี่ยนเป็น `paidDate` เป็น PR แยก)
  - ผู้เรียกฝั่งการเดินทาง (Task 8 `sources/contract-timeline.ts`): เรียก **ครั้งเดียว** ต่อแหล่ง (payment / collections) ด้วย `contractIds` ทั้งหมดของลูกค้า + window `{ before, from, to, limit: scanTake(window) }` แล้วจับคู่ `row.contractId` กับเลขสัญญาเอง · ห้ามวนเรียกทีละสัญญาโดยไม่ส่ง window (หน้าหลังจะหยุดที่ 50 แถวต่อสัญญา)
  - 🚨 PDPA สำหรับผู้เรียกฝั่งการเดินทาง: `event.metadata.notes` ของ CALL (= `callLog.notes`) และ `event.subtitle` ของ DUNNING_ACTION (= `messageContent`) มีไว้ให้หน้า Collections เท่านั้น ห้ามส่งต่อ ต้องสร้าง `JourneyEvent` ใหม่จาก field ที่อนุญาต

> ข้อสังเกต (ไม่แก้ใน task นี้ เพราะจะทำให้ golden เปลี่ยน): query เดิมของ `callLog` และ `payment` ไม่ได้กรอง `deletedAt: null` ทั้งที่สองตารางมีคอลัมน์นี้ ⇒ วันนี้ไทม์ไลน์ Collections ยังแสดงแถวที่ถูก soft-delete ถ้าจะแก้ ให้เปิด PR แยกที่แก้ golden อย่างตั้งใจ

- [ ] **Step 1: golden — ล็อกผลลัพธ์ของโค้ดเดิม (ต้องเขียวก่อนแตะ service)**

สร้าง `apps/api/src/modules/overdue/timeline.service.golden.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OverdueTimelineService } from './timeline.service';

/**
 * Golden ของ GET /overdue/contracts/:id/full-timeline — ล็อกผลลัพธ์ "ก่อน" แยก contract-event-sources.ts
 * ครอบทุกกิ่งของตัวแปลง: ผลโทรที่ไม่มีป้าย · ผู้โทรว่าง · ยอด Decimal มีเศษ · messageContent ยาวเกิน/พอดี 80/ว่าง ·
 * audit ทุก action + default · จดหมายไม่มี dispatchedAt/tracking · เวลาเท่ากันต้องคงลำดับ call ก่อน payment (sort เสถียร)
 * 🚨 ห้ามแก้ค่าในไฟล์นี้เพื่อให้ refactor ผ่าน — ถ้าแดงหลัง refactor แปลว่าผลลัพธ์เปลี่ยน ให้แก้โค้ด
 */
const mockPrisma = {
  contract: { findFirst: jest.fn() },
  callLog: { findMany: jest.fn() },
  payment: { findMany: jest.fn() },
  dunningAction: { findMany: jest.fn() },
  auditLog: { findMany: jest.fn() },
  contractLetter: { findMany: jest.fn() },
};

const LONG_MESSAGE = '1234567890'.repeat(9);
const EXACT_80_MESSAGE = 'abcdefghij'.repeat(8);

function seedSources() {
  mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c1' });
  mockPrisma.callLog.findMany.mockResolvedValue([
    {
      id: 'cl-a',
      contractId: 'c1',
      callerId: 'u-nan',
      calledAt: new Date('2026-08-20T03:15:00.000Z'),
      result: 'PROMISED',
      notes: 'นัดโอนสิ้นเดือน',
      settlementDate: new Date('2026-08-31T00:00:00.000Z'),
      voiceMemoUrl: 'https://storage.example/memo-a.m4a',
      voiceMemoTier: 'HOT',
      caller: { id: 'u-nan', name: 'แนน' },
    },
    {
      id: 'cl-b',
      contractId: 'c1',
      callerId: null,
      calledAt: new Date('2026-08-18T09:00:00.000Z'),
      result: 'LEFT_VOICEMAIL',
      notes: null,
      settlementDate: null,
      voiceMemoUrl: null,
      voiceMemoTier: null,
      caller: null,
    },
  ]);
  mockPrisma.payment.findMany.mockResolvedValue([
    {
      id: 'pm-6',
      contractId: 'c1',
      recordedById: 'u-fin',
      updatedAt: new Date('2026-08-20T03:15:00.000Z'),
      amountPaid: new Prisma.Decimal('35000'),
      installmentNo: 6,
      paymentMethod: null,
    },
    {
      id: 'pm-7',
      contractId: 'c1',
      recordedById: null,
      updatedAt: new Date('2026-08-19T02:00:00.000Z'),
      amountPaid: new Prisma.Decimal('1234.50'),
      installmentNo: 7,
      paymentMethod: 'BANK_TRANSFER',
    },
  ]);
  mockPrisma.dunningAction.findMany.mockResolvedValue([
    {
      id: 'da-long',
      contractId: 'c1',
      executedById: null,
      createdAt: new Date('2026-08-17T01:00:00.000Z'),
      channel: 'LINE',
      messageContent: LONG_MESSAGE,
      status: 'SENT',
      dunningRule: { name: 'เตือนเลยกำหนด 3 วัน', channel: 'LINE' },
    },
    {
      id: 'da-short',
      contractId: 'c1',
      executedById: null,
      createdAt: new Date('2026-08-16T01:00:00.000Z'),
      channel: 'SMS',
      messageContent: EXACT_80_MESSAGE,
      status: 'DELIVERED',
      dunningRule: { name: 'SMS เลยกำหนด 7 วัน', channel: 'SMS' },
    },
    {
      id: 'da-null',
      contractId: 'c1',
      executedById: 'u-nan',
      createdAt: new Date('2026-08-15T01:00:00.000Z'),
      channel: 'CALL_TASK',
      messageContent: null,
      status: 'FAILED',
      dunningRule: { name: 'งานโทร', channel: 'CALL_TASK' },
    },
  ]);
  mockPrisma.auditLog.findMany.mockResolvedValue([
    { id: 'au-status', userId: 'u-sys', entity: 'contract', entityId: 'c1', action: 'STATUS_CHANGE', newValue: { from: 'ACTIVE', to: 'OVERDUE' }, createdAt: new Date('2026-08-14T05:00:00.000Z') },
    { id: 'au-status-null', userId: 'u-sys', entity: 'contract', entityId: 'c1', action: 'STATUS_CHANGE', newValue: null, createdAt: new Date('2026-08-13T05:00:00.000Z') },
    { id: 'au-esc', userId: 'u-owner', entity: 'contract', entityId: 'c1', action: 'DUNNING_ESCALATION_APPROVED', newValue: { dunningStage: 'NOTICE' }, createdAt: new Date('2026-08-12T05:00:00.000Z') },
    { id: 'au-lock', userId: 'u-owner', entity: 'mdm_lock_request', entityId: 'c1', action: 'MDM_LOCK_APPROVED', newValue: { requestId: 'mdm-1' }, createdAt: new Date('2026-08-11T05:00:00.000Z') },
    { id: 'au-unlock', userId: 'u-owner', entity: 'mdm_lock_request', entityId: 'c1', action: 'MDM_UNLOCK', newValue: null, createdAt: new Date('2026-08-10T05:00:00.000Z') },
    { id: 'au-other', userId: 'u-owner', entity: 'contract', entityId: 'c1', action: 'MDM_WALLPAPER_SET', newValue: null, createdAt: new Date('2026-08-09T05:00:00.000Z') },
  ]);
  mockPrisma.contractLetter.findMany.mockResolvedValue([
    {
      id: 'lt-1',
      contractId: 'c1',
      dispatchedById: 'u-bm',
      createdAt: new Date('2026-08-07T04:00:00.000Z'),
      dispatchedAt: new Date('2026-08-08T04:00:00.000Z'),
      letterType: 'RETURN_DEVICE_45D',
      letterNumber: 'LT-2569-0001',
      trackingNumber: 'EE123456789TH',
      status: 'DISPATCHED',
    },
    {
      id: 'lt-2',
      contractId: 'c1',
      dispatchedById: null,
      createdAt: new Date('2026-08-06T04:00:00.000Z'),
      dispatchedAt: null,
      letterType: 'CONTRACT_TERMINATION_60D',
      letterNumber: 'LT-2569-0002',
      trackingNumber: null,
      status: 'DELIVERED',
    },
  ]);
}

const GOLDEN = [
  {
    id: 'call-cl-a',
    type: 'CALL',
    timestamp: '2026-08-20T03:15:00.000Z',
    title: 'นัดชำระ',
    subtitle: 'แนน',
    metadata: {
      result: 'PROMISED',
      notes: 'นัดโอนสิ้นเดือน',
      settlementDate: new Date('2026-08-31T00:00:00.000Z'),
      callLogId: 'cl-a',
      voiceMemoUrl: 'https://storage.example/memo-a.m4a',
      voiceMemoTier: 'HOT',
    },
  },
  {
    id: 'payment-pm-6',
    type: 'PAYMENT',
    timestamp: '2026-08-20T03:15:00.000Z',
    title: 'ชำระ 35,000 ฿ (งวด 6)',
    metadata: { amount: '35000', method: undefined },
  },
  {
    id: 'payment-pm-7',
    type: 'PAYMENT',
    timestamp: '2026-08-19T02:00:00.000Z',
    title: 'ชำระ 1,234.5 ฿ (งวด 7)',
    metadata: { amount: '1234.5', method: 'BANK_TRANSFER' },
  },
  {
    id: 'call-cl-b',
    type: 'CALL',
    timestamp: '2026-08-18T09:00:00.000Z',
    title: 'LEFT_VOICEMAIL',
    subtitle: undefined,
    metadata: {
      result: 'LEFT_VOICEMAIL',
      notes: undefined,
      settlementDate: undefined,
      callLogId: 'cl-b',
      voiceMemoUrl: undefined,
      voiceMemoTier: undefined,
    },
  },
  {
    id: 'dunning-da-long',
    type: 'DUNNING_ACTION',
    timestamp: '2026-08-17T01:00:00.000Z',
    title: 'ส่ง LINE: เตือนเลยกำหนด 3 วัน',
    subtitle: `${'1234567890'.repeat(8)}…`,
    metadata: { status: 'SENT', channel: 'LINE' },
  },
  {
    id: 'dunning-da-short',
    type: 'DUNNING_ACTION',
    timestamp: '2026-08-16T01:00:00.000Z',
    title: 'ส่ง SMS: SMS เลยกำหนด 7 วัน',
    subtitle: EXACT_80_MESSAGE,
    metadata: { status: 'DELIVERED', channel: 'SMS' },
  },
  {
    id: 'dunning-da-null',
    type: 'DUNNING_ACTION',
    timestamp: '2026-08-15T01:00:00.000Z',
    title: 'ส่ง CALL_TASK: งานโทร',
    subtitle: undefined,
    metadata: { status: 'FAILED', channel: 'CALL_TASK' },
  },
  {
    id: 'audit-au-status',
    type: 'STATUS_CHANGE',
    timestamp: '2026-08-14T05:00:00.000Z',
    title: 'สถานะสัญญาเปลี่ยน: ACTIVE → OVERDUE',
    metadata: { action: 'STATUS_CHANGE', newValue: { from: 'ACTIVE', to: 'OVERDUE' } },
  },
  {
    id: 'audit-au-status-null',
    type: 'STATUS_CHANGE',
    timestamp: '2026-08-13T05:00:00.000Z',
    title: 'สถานะสัญญาเปลี่ยน: ? → ?',
    metadata: { action: 'STATUS_CHANGE', newValue: undefined },
  },
  {
    id: 'audit-au-esc',
    type: 'STATUS_CHANGE',
    timestamp: '2026-08-12T05:00:00.000Z',
    title: 'อนุมัติเลื่อนระดับเตือน: NOTICE',
    metadata: { action: 'DUNNING_ESCALATION_APPROVED', newValue: { dunningStage: 'NOTICE' } },
  },
  {
    id: 'audit-au-lock',
    type: 'MDM',
    timestamp: '2026-08-11T05:00:00.000Z',
    title: 'ล็อคเครื่องแล้ว',
    metadata: { action: 'MDM_LOCK_APPROVED', newValue: { requestId: 'mdm-1' } },
  },
  {
    id: 'audit-au-unlock',
    type: 'MDM',
    timestamp: '2026-08-10T05:00:00.000Z',
    title: 'ปลดล็อคเครื่องแล้ว',
    metadata: { action: 'MDM_UNLOCK', newValue: undefined },
  },
  {
    id: 'audit-au-other',
    type: 'MDM',
    timestamp: '2026-08-09T05:00:00.000Z',
    title: 'MDM_WALLPAPER_SET',
    metadata: { action: 'MDM_WALLPAPER_SET', newValue: undefined },
  },
  {
    id: 'letter-lt-1',
    type: 'LETTER',
    timestamp: '2026-08-08T04:00:00.000Z',
    title: 'ส่งหนังสือ: RETURN_DEVICE_45D (EMS: EE123456789TH)',
    metadata: { status: 'DISPATCHED', letterNumber: 'LT-2569-0001' },
  },
  {
    id: 'letter-lt-2',
    type: 'LETTER',
    timestamp: '2026-08-06T04:00:00.000Z',
    title: 'ส่งหนังสือ: CONTRACT_TERMINATION_60D (EMS: —)',
    metadata: { status: 'DELIVERED', letterNumber: 'LT-2569-0002' },
  },
];

describe('OverdueTimelineService.getFullTimeline — golden (ห้ามเปลี่ยนผลลัพธ์)', () => {
  let service: OverdueTimelineService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [OverdueTimelineService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = moduleRef.get(OverdueTimelineService);
    seedSources();
  });

  it('ผลลัพธ์ตรง golden ทุกฟิลด์ รวมคีย์ที่เป็น undefined', async () => {
    const result = await service.getFullTimeline('c1');
    expect(result).toStrictEqual(GOLDEN);
  });

  it('JSON ที่ส่งออก HTTP ตรง golden ทั้งลำดับ event และลำดับคีย์', async () => {
    const result = await service.getFullTimeline('c1');
    expect(JSON.stringify(result)).toBe(JSON.stringify(GOLDEN));
  });

  it('ไม่แตะตาราง source เมื่อไม่พบสัญญา', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    await expect(service.getFullTimeline('nope')).rejects.toThrow('ไม่พบสัญญา');
    expect(mockPrisma.callLog.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.contractLetter.findMany).not.toHaveBeenCalled();
  });
});
```
Run (จาก `apps/api`): `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/overdue/timeline.service.golden.spec.ts --runInBand` → Expected: **PASS 3 tests กับ `timeline.service.ts` เดิมที่ยังไม่แก้** · เทสนี้เป็น characterization ถ้าแดงในขั้นนี้แปลว่า fixture/GOLDEN พิมพ์ผิด ให้แก้ spec ให้ตรงผลของโค้ดเดิม **ห้ามแตะ `timeline.service.ts`** · (ตรวจตอนเขียนแผนแล้วว่า golden จับการเปลี่ยนได้จริง: ลองสลับลำดับคีย์ `metadata` ของ PAYMENT แล้วเทสที่ 2 แดงทันที ขณะที่ `toStrictEqual` ยังเขียว เพราะฉะนั้นต้องมีทั้งสองเทส)

- [ ] **Step 2: เทสแดง — unit ของ `contractEventSources` (mock prisma)**

สร้าง `apps/api/src/modules/overdue/contract-event-sources.spec.ts`:
```ts
import { Prisma } from '@prisma/client';
import {
  CONTRACT_EVENT_SOURCE_TAKE,
  contractEventSources,
  type ContractEventPrisma,
} from './contract-event-sources';

function mockPrisma() {
  return {
    callLog: { findMany: jest.fn().mockResolvedValue([]) },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    dunningAction: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    contractLetter: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

type MockPrisma = ReturnType<typeof mockPrisma>;
const asPrisma = (mock: MockPrisma) => mock as unknown as ContractEventPrisma;

function callRow(id: string, contractId: string, calledAtIso: string, callerId: string | null = null) {
  return {
    id,
    contractId,
    callerId,
    calledAt: new Date(calledAtIso),
    result: 'ANSWERED',
    notes: null,
    settlementDate: null,
    voiceMemoUrl: null,
    voiceMemoTier: null,
    caller: callerId ? { id: callerId, name: 'แนน' } : null,
  };
}

describe('contractEventSources', () => {
  it('contractIds ว่าง → คืน [] โดยไม่ query ฐานข้อมูล', async () => {
    const prisma = mockPrisma();
    await expect(contractEventSources(asPrisma(prisma), [])).resolves.toEqual([]);
    expect(prisma.callLog.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('หลายสัญญา ไม่ส่ง window → ทุก source ใช้ IN + ตัวกรองเดิมของ full-timeline + take 50', async () => {
    const prisma = mockPrisma();
    await contractEventSources(asPrisma(prisma), ['k1', 'k2']);

    expect(CONTRACT_EVENT_SOURCE_TAKE).toBe(50);
    expect(prisma.callLog.findMany).toHaveBeenCalledWith({
      where: { contractId: { in: ['k1', 'k2'] } },
      include: { caller: { select: { id: true, name: true } } },
      orderBy: { calledAt: 'desc' },
      take: 50,
    });
    expect(prisma.payment.findMany).toHaveBeenCalledWith({
      where: { contractId: { in: ['k1', 'k2'] }, status: 'PAID' },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    expect(prisma.dunningAction.findMany).toHaveBeenCalledWith({
      where: { contractId: { in: ['k1', 'k2'] }, deletedAt: null },
      include: { dunningRule: { select: { name: true, channel: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        entity: { in: ['contract', 'mdm_lock_request'] },
        entityId: { in: ['k1', 'k2'] },
        action: { in: ['STATUS_CHANGE', 'DUNNING_ESCALATION_APPROVED', 'MDM_LOCK_APPROVED', 'MDM_UNLOCK'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    expect(prisma.contractLetter.findMany).toHaveBeenCalledWith({
      where: { contractId: { in: ['k1', 'k2'] }, deletedAt: null, status: { in: ['DISPATCHED', 'DELIVERED'] } },
      orderBy: { dispatchedAt: 'desc' },
      take: 50,
    });
  });

  it('window from/to/before/limit → ขอบบน = ค่าที่น้อยกว่าระหว่าง to กับ before.ts · หนังสือใช้ dispatchedAt ?? createdAt', async () => {
    const prisma = mockPrisma();
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-31T00:00:00.000Z');
    await contractEventSources(asPrisma(prisma), ['k1'], {
      from,
      to,
      before: { ts: '2026-08-20T00:00:00.000Z', id: 'payment-x' },
      limit: 11,
    });
    const range = { gte: from, lte: new Date('2026-08-20T00:00:00.000Z') };

    expect(prisma.callLog.findMany.mock.calls[0][0]).toMatchObject({ where: { contractId: { in: ['k1'] }, calledAt: range }, take: 11 });
    expect(prisma.payment.findMany.mock.calls[0][0]).toMatchObject({ where: { status: 'PAID', updatedAt: range }, take: 11 });
    expect(prisma.dunningAction.findMany.mock.calls[0][0]).toMatchObject({ where: { deletedAt: null, createdAt: range }, take: 11 });
    expect(prisma.auditLog.findMany.mock.calls[0][0]).toMatchObject({ where: { entityId: { in: ['k1'] }, createdAt: range }, take: 11 });
    expect(prisma.contractLetter.findMany.mock.calls[0][0]).toMatchObject({
      where: { OR: [{ dispatchedAt: range }, { dispatchedAt: null, createdAt: range }] },
      take: 11,
    });
  });

  it('to เร็วกว่า before.ts และไม่มี from → lte = to อย่างเดียว', async () => {
    const prisma = mockPrisma();
    const to = new Date('2026-08-10T00:00:00.000Z');
    await contractEventSources(asPrisma(prisma), ['k1'], { to, before: { ts: '2026-09-01T00:00:00.000Z', id: 'call-z' } });
    expect(prisma.callLog.findMany.mock.calls[0][0].where).toEqual({ contractId: { in: ['k1'] }, calledAt: { lte: to } });
  });

  it('แถวผลลัพธ์ติด contractId + actorUserId ของแต่ละ source และคงลำดับ call → payment → dunning → audit → letter', async () => {
    const prisma = mockPrisma();
    prisma.callLog.findMany.mockResolvedValue([
      callRow('cl-1', 'k1', '2026-08-20T03:00:00.000Z', 'u-nan'),
      callRow('cl-2', 'k2', '2026-08-19T03:00:00.000Z'),
    ]);
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pm-1', contractId: 'k2', recordedById: 'u-fin', updatedAt: new Date('2026-08-21T03:00:00.000Z'), amountPaid: new Prisma.Decimal('4200'), installmentNo: 3, paymentMethod: 'CASH' },
    ]);
    prisma.dunningAction.findMany.mockResolvedValue([
      { id: 'da-1', contractId: 'k1', executedById: null, createdAt: new Date('2026-08-18T03:00:00.000Z'), channel: 'LINE', messageContent: null, status: 'SENT', dunningRule: { name: 'เตือน', channel: 'LINE' } },
    ]);
    prisma.auditLog.findMany.mockResolvedValue([
      { id: 'au-1', userId: 'u-owner', entity: 'contract', entityId: 'k2', action: 'STATUS_CHANGE', newValue: { from: 'ACTIVE', to: 'OVERDUE' }, createdAt: new Date('2026-08-17T03:00:00.000Z') },
    ]);
    prisma.contractLetter.findMany.mockResolvedValue([
      { id: 'lt-1', contractId: 'k1', dispatchedById: 'u-bm', createdAt: new Date('2026-08-15T03:00:00.000Z'), dispatchedAt: new Date('2026-08-16T03:00:00.000Z'), letterType: 'RETURN_DEVICE_45D', letterNumber: 'LT-1', trackingNumber: null, status: 'DISPATCHED' },
    ]);

    const rows = await contractEventSources(asPrisma(prisma), ['k1', 'k2']);

    expect(rows.map((row) => [row.contractId, row.actorUserId, row.event.id])).toEqual([
      ['k1', 'u-nan', 'call-cl-1'],
      ['k2', null, 'call-cl-2'],
      ['k2', 'u-fin', 'payment-pm-1'],
      ['k1', null, 'dunning-da-1'],
      ['k2', 'u-owner', 'audit-au-1'],
      ['k1', 'u-bm', 'letter-lt-1'],
    ]);
  });

  it('before → ตัด event ที่ (timestamp, id) ≥ cursor ทิ้ง · เวลาเท่ากันเทียบ id · cursor เขียนเวลาแบบ +07:00 ก็เทียบถูก', async () => {
    const prisma = mockPrisma();
    prisma.callLog.findMany.mockResolvedValue([
      callRow('cl-3', 'k1', '2026-08-20T03:00:00.000Z'),
      callRow('cl-2', 'k1', '2026-08-20T03:00:00.000Z'),
      callRow('cl-1', 'k1', '2026-08-20T02:59:00.000Z'),
    ]);

    const rows = await contractEventSources(asPrisma(prisma), ['k1'], {
      before: { ts: '2026-08-20T10:00:00.000+07:00', id: 'call-cl-3' },
    });

    expect(rows.map((row) => row.event.id)).toEqual(['call-cl-2', 'call-cl-1']);
  });
});
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/overdue/contract-event-sources.spec.ts --runInBand` → Expected: FAIL `Cannot find module './contract-event-sources' from 'modules/overdue/contract-event-sources.spec.ts'`

- [ ] **Step 3: เทสแดง — `contractEventSources` กับ Postgres จริง**

สร้าง `apps/api/src/modules/overdue/contract-event-sources.db.spec.ts`:
```ts
import { Prisma, PrismaClient } from '@prisma/client';
import { contractEventSources } from './contract-event-sources';

/**
 * พิสูจน์กับ Postgres จริง: contractId IN หลายสัญญา · ตัวกรองสถานะ/soft-delete เดิม · ช่วงเวลา · keyset เวลาเท่ากัน · หนังสือที่ dispatchedAt ว่าง
 * audit_logs ลบไม่ได้ (trigger audit_logs_no_delete) → แถว audit ของสเปคนี้ค้างในฐานทดสอบ แต่ผูก entity_id กับสัญญาที่สร้างใหม่ทุกรอบ จึงไม่ชนรอบถัดไป
 * ผู้ใช้ของสเปคจึง upsert ด้วยอีเมลคงที่และไม่ลบ (audit อ้าง user_id อยู่)
 * ต้องรันกับฐานที่ apply migration แล้ว: DATABASE_URL=<ฐานทดสอบ> npx jest <ไฟล์นี้> --runInBand
 */
describe('contractEventSources (real DB)', () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const dec = (value: string) => new Prisma.Decimal(value);
  const at = (iso: string) => new Date(iso);
  let userId = '';
  let branchId = '';
  let customerId = '';
  let ruleId = '';
  const productIds: string[] = [];
  const contractIds: string[] = [];
  const seeded = { callA: '', callB1: '', callB2: '', paymentA: '', dunningA: '', auditA: '', letterA: '', letterB: '' };

  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { email: 'contract-event-sources.db-spec@bestchoice.test' },
      update: {},
      create: { email: 'contract-event-sources.db-spec@bestchoice.test', password: 'x', name: 'สเปคไทม์ไลน์สัญญา', role: 'OWNER' },
    });
    userId = user.id;
    branchId = (await prisma.branch.create({ data: { name: `contract-event-sources spec ${stamp}` } })).id;
    customerId = (await prisma.customer.create({ data: { name: `contract-event-sources spec ${stamp}` } })).id;

    for (const label of ['A', 'B', 'C']) {
      const product = await prisma.product.create({
        data: {
          name: `spec phone ${label}`,
          brand: 'Apple',
          model: 'iPhone 15',
          category: 'PHONE_NEW',
          costPrice: dec('20000.00'),
          branchId,
          imeiSerial: `CES-${stamp}-${label}`,
        },
      });
      productIds.push(product.id);
      const contract = await prisma.contract.create({
        data: {
          contractNumber: `CES-${stamp}-${label}`,
          customerId,
          productId: product.id,
          branchId,
          salespersonId: userId,
          planType: 'STORE_WITH_INTEREST',
          sellingPrice: dec('30000.00'),
          downPayment: dec('5000.00'),
          interestRate: dec('0.0500'),
          totalMonths: 12,
          interestTotal: dec('15000.00'),
          financedAmount: dec('25000.00'),
          monthlyPayment: dec('3333.33'),
          status: 'OVERDUE',
        },
      });
      contractIds.push(contract.id);
    }
    const [contractA, contractB, contractC] = contractIds;
    // dunning_rules_trigger_exclusive_chk: ต้องมี triggerDay หรือ eventTrigger อย่างใดอย่างหนึ่งพอดี
    ruleId = (await prisma.dunningRule.create({ data: { name: `spec rule ${stamp}`, triggerDay: 3, channel: 'LINE', messageTemplate: 'แจ้งเตือนค้างชำระ' } })).id;

    // สัญญา A — อย่างละหนึ่งแถวที่ต้องได้ + แถวที่ตัวกรองเดิมต้องตัดทิ้ง
    seeded.callA = (await prisma.callLog.create({ data: { contractId: contractA, callerId: userId, calledAt: at('2026-08-20T03:00:00.000Z'), result: 'PROMISED' } })).id;
    seeded.paymentA = (await prisma.payment.create({
      data: { contractId: contractA, installmentNo: 1, dueDate: at('2026-08-05T00:00:00.000Z'), amountDue: dec('3333.33'), amountPaid: dec('3333.33'), status: 'PAID', updatedAt: at('2026-08-19T03:00:00.000Z') },
    })).id;
    const pendingA = await prisma.payment.create({
      data: { contractId: contractA, installmentNo: 2, dueDate: at('2026-09-05T00:00:00.000Z'), amountDue: dec('3333.33'), status: 'PENDING' },
    });
    seeded.dunningA = (await prisma.dunningAction.create({
      data: { dunningRuleId: ruleId, contractId: contractA, channel: 'LINE', status: 'SENT', createdAt: at('2026-08-18T03:00:00.000Z') },
    })).id;
    await prisma.dunningAction.create({
      data: { dunningRuleId: ruleId, contractId: contractA, paymentId: pendingA.id, channel: 'LINE', status: 'SENT', createdAt: at('2026-08-18T04:00:00.000Z'), deletedAt: at('2026-08-18T05:00:00.000Z') },
    });
    seeded.auditA = (await prisma.auditLog.create({
      data: { userId, action: 'STATUS_CHANGE', entity: 'contract', entityId: contractA, newValue: { from: 'ACTIVE', to: 'OVERDUE' }, createdAt: at('2026-08-17T03:00:00.000Z') },
    })).id;
    await prisma.auditLog.create({ data: { userId, action: 'UPDATE', entity: 'contract', entityId: contractA, createdAt: at('2026-08-17T04:00:00.000Z') } });
    seeded.letterA = (await prisma.contractLetter.create({
      data: { contractId: contractA, letterType: 'RETURN_DEVICE_45D', letterNumber: `CES-${stamp}-A-45`, status: 'DISPATCHED', dispatchedAt: at('2026-08-16T03:00:00.000Z') },
    })).id;
    await prisma.contractLetter.create({
      data: { contractId: contractA, letterType: 'CONTRACT_TERMINATION_60D', letterNumber: `CES-${stamp}-A-60`, status: 'PENDING_DISPATCH' },
    });

    // สัญญา B — โทรสองครั้งเวลาเดียวกัน (keyset เทียบ id) + หนังสือที่ไม่มี dispatchedAt (ใช้ createdAt)
    seeded.callB1 = (await prisma.callLog.create({ data: { contractId: contractB, calledAt: at('2026-08-10T03:00:00.000Z'), result: 'NO_ANSWER' } })).id;
    seeded.callB2 = (await prisma.callLog.create({ data: { contractId: contractB, calledAt: at('2026-08-10T03:00:00.000Z'), result: 'NO_ANSWER' } })).id;
    seeded.letterB = (await prisma.contractLetter.create({
      data: { contractId: contractB, letterType: 'RETURN_DEVICE_45D', letterNumber: `CES-${stamp}-B-45`, status: 'DELIVERED', createdAt: at('2026-08-05T03:00:00.000Z') },
    })).id;

    // สัญญา C — ไม่ได้ขอ ต้องไม่โผล่
    await prisma.callLog.create({ data: { contractId: contractC, calledAt: at('2026-08-21T03:00:00.000Z'), result: 'ANSWERED' } });
  }, 60_000);

  afterAll(async () => {
    await prisma.dunningAction.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.dunningRule.deleteMany({ where: { id: ruleId } });
    await prisma.callLog.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.payment.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contractLetter.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.branch.deleteMany({ where: { id: branchId } });
    await prisma.$disconnect();
  }, 60_000);

  it('หลายสัญญา → ได้ทุก source ของ A และ B เท่านั้น · ตัด PENDING / soft-delete / action อื่น / หนังสือยังไม่ส่ง · ติด contractId และผู้โทร', async () => {
    const [contractA, contractB] = contractIds;
    const rows = await contractEventSources(prisma, [contractA, contractB]);

    expect(rows.map((row) => `${row.contractId}|${row.event.id}`).sort()).toEqual(
      [
        `${contractA}|call-${seeded.callA}`,
        `${contractA}|payment-${seeded.paymentA}`,
        `${contractA}|dunning-${seeded.dunningA}`,
        `${contractA}|audit-${seeded.auditA}`,
        `${contractA}|letter-${seeded.letterA}`,
        `${contractB}|call-${seeded.callB1}`,
        `${contractB}|call-${seeded.callB2}`,
        `${contractB}|letter-${seeded.letterB}`,
      ].sort(),
    );
    expect(rows.find((row) => row.event.id === `call-${seeded.callA}`)?.actorUserId).toBe(userId);
    expect(rows.find((row) => row.event.id === `audit-${seeded.auditA}`)?.event.title).toBe('สถานะสัญญาเปลี่ยน: ACTIVE → OVERDUE');
    expect(rows.find((row) => row.event.id === `payment-${seeded.paymentA}`)?.event.timestamp).toBe('2026-08-19T03:00:00.000Z');
    expect(rows.find((row) => row.event.id === `letter-${seeded.letterB}`)?.event.timestamp).toBe('2026-08-05T03:00:00.000Z');
  });

  it('from/to รวมขอบทั้งสองข้าง บนคอลัมน์เวลาของแต่ละ source', async () => {
    const [contractA, contractB] = contractIds;
    const rows = await contractEventSources(prisma, [contractA, contractB], {
      from: at('2026-08-10T03:00:00.000Z'),
      to: at('2026-08-18T03:00:00.000Z'),
    });

    expect(rows.map((row) => row.event.id).sort()).toEqual(
      [
        `dunning-${seeded.dunningA}`,
        `audit-${seeded.auditA}`,
        `letter-${seeded.letterA}`,
        `call-${seeded.callB1}`,
        `call-${seeded.callB2}`,
      ].sort(),
    );
  });

  it('before ที่เวลาเท่ากับโทรสองครั้งของ B → เหลือเฉพาะ id ที่น้อยกว่า + หนังสือที่ใช้ createdAt', async () => {
    const [contractA, contractB] = contractIds;
    const [lowerCall, higherCall] = [`call-${seeded.callB1}`, `call-${seeded.callB2}`].sort();
    const rows = await contractEventSources(prisma, [contractA, contractB], {
      before: { ts: '2026-08-10T03:00:00.000Z', id: higherCall },
    });

    expect(rows.map((row) => row.event.id).sort()).toEqual([lowerCall, `letter-${seeded.letterB}`].sort());
  });

  it('limit ใช้ต่อ source — limit 1 ได้โทรล่าสุดของทุกสัญญาที่ขอเพียงแถวเดียว', async () => {
    const [contractA, contractB] = contractIds;
    const rows = await contractEventSources(prisma, [contractA, contractB], { limit: 1 });

    expect(rows.filter((row) => row.event.type === 'CALL').map((row) => row.event.id)).toEqual([`call-${seeded.callA}`]);
    expect(rows.filter((row) => row.event.type === 'LETTER')).toHaveLength(1);
  });
});
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/overdue/contract-event-sources.db.spec.ts --runInBand` → Expected: FAIL `Cannot find module './contract-event-sources' from 'modules/overdue/contract-event-sources.db.spec.ts'`

- [ ] **Step 4: `contract-event-sources.ts`**

สร้าง `apps/api/src/modules/overdue/contract-event-sources.ts` (ตัวแปลงของทั้ง 5 source ลอกจาก `timeline.service.ts:85-147` แบบคำต่อคำ ทั้งลำดับคีย์ ข้อความ และ `?? undefined` เปลี่ยนแค่ห่อด้วย `rows.push({ contractId, actorUserId, event })`):
```ts
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * แหล่ง event ของสัญญา (โทรติดตาม · ชำระ · แจ้งเตือน · สถานะ/MDM · หนังสือ) — แยกออกมาจาก OverdueTimelineService.getFullTimeline
 * ใช้ร่วมกันระหว่าง GET /overdue/contracts/:id/full-timeline (ผลลัพธ์เดิม ล็อกด้วย timeline.service.golden.spec.ts)
 * และ source ของแท็บการเดินทางของลูกค้า (รับหลายสัญญา + ช่วงเวลา + keyset)
 * PAYMENT ยังใช้ updatedAt ตามเดิม — การเปลี่ยนเป็น paidDate เป็น PR แยก
 */

export type TimelineEventType =
  | 'CALL'
  | 'PAYMENT'
  | 'DUNNING_ACTION'
  | 'STATUS_CHANGE'
  | 'MDM'
  | 'LETTER';

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: string;
  title: string;
  subtitle?: string;
  metadata?: Record<string, unknown>;
}

export interface ContractEventRow {
  contractId: string;
  /** ผู้โทร · ผู้บันทึกรับชำระ · ผู้กดส่งแจ้งเตือน · ผู้ทำรายการ audit · ผู้ส่งหนังสือ — null เมื่อระบบทำเอง */
  actorUserId: string | null;
  /**
   * รูปเดียวกับที่หน้า Collections ได้รับ
   * 🚨 PDPA: metadata.notes ของ CALL (callLog.notes) และ subtitle ของ DUNNING_ACTION (messageContent) มีไว้ให้หน้า Collections เท่านั้น
   * ผู้เรียกฝั่งการเดินทางของลูกค้าต้องสร้าง event ใหม่จาก field ที่อนุญาต ห้ามส่งต่อ subtitle/metadata ดิบ
   */
  event: TimelineEvent;
}

export interface ContractEventWindow {
  /** keyset ของการเรียง timestamp DESC, id DESC — คืนเฉพาะ event ที่ (timestamp, id) น้อยกว่าคู่นี้ */
  before?: { ts: string; id: string };
  /** ขอบล่าง รวมค่าที่เท่ากัน */
  from?: Date;
  /** ขอบบน รวมค่าที่เท่ากัน */
  to?: Date;
  /** จำนวนแถวสูงสุดต่อ source — ไม่ส่ง = CONTRACT_EVENT_SOURCE_TAKE (พฤติกรรมเดิมของ full-timeline) */
  limit?: number;
}

export type ContractEventPrisma = Pick<
  PrismaClient,
  'callLog' | 'payment' | 'dunningAction' | 'auditLog' | 'contractLetter'
>;

export const CONTRACT_EVENT_SOURCE_TAKE = 50;

const CALL_RESULT_LABELS: Record<string, string> = {
  NO_ANSWER: 'ไม่รับสาย',
  ANSWERED: 'รับสาย',
  PROMISED: 'นัดชำระ',
  REFUSED: 'ปฏิเสธ',
  WRONG_NUMBER: 'เบอร์ผิด',
  OTHER: 'อื่น ๆ',
};

function formatAuditTitle(action: string, newValue: Record<string, unknown> | null): string {
  switch (action) {
    case 'STATUS_CHANGE':
      return `สถานะสัญญาเปลี่ยน: ${newValue?.from ?? '?'} → ${newValue?.to ?? '?'}`;
    case 'DUNNING_ESCALATION_APPROVED':
      return `อนุมัติเลื่อนระดับเตือน: ${newValue?.dunningStage ?? '?'}`;
    case 'MDM_LOCK_APPROVED':
      return 'ล็อคเครื่องแล้ว';
    case 'MDM_UNLOCK':
      return 'ปลดล็อคเครื่องแล้ว';
    default:
      return action;
  }
}

/** ขอบบนใช้ค่าที่น้อยกว่าระหว่าง to กับเวลาของ cursor — กรองซ้ำแบบละเอียดด้วย isBeforeCursor หลังอ่าน */
function timeRange(window: ContractEventWindow): Prisma.DateTimeFilter | null {
  const uppers: number[] = [];
  if (window.to) uppers.push(window.to.getTime());
  if (window.before) uppers.push(new Date(window.before.ts).getTime());
  if (!window.from && uppers.length === 0) return null;
  return {
    ...(window.from ? { gte: window.from } : {}),
    ...(uppers.length > 0 ? { lte: new Date(Math.min(...uppers)) } : {}),
  };
}

function isBeforeCursor(event: TimelineEvent, before: ContractEventWindow['before']): boolean {
  if (!before) return true;
  const cursorTs = new Date(before.ts).toISOString();
  return event.timestamp < cursorTs || (event.timestamp === cursorTs && event.id < before.id);
}

export async function contractEventSources(
  prisma: ContractEventPrisma,
  contractIds: string[],
  window: ContractEventWindow = {},
): Promise<ContractEventRow[]> {
  if (contractIds.length === 0) return [];
  const take = window.limit ?? CONTRACT_EVENT_SOURCE_TAKE;
  const range = timeRange(window);

  const [calls, payments, dunningActions, audits, letters] = await Promise.all([
    prisma.callLog.findMany({
      where: { contractId: { in: contractIds }, ...(range ? { calledAt: range } : {}) },
      include: { caller: { select: { id: true, name: true } } },
      orderBy: { calledAt: 'desc' },
      take,
    }),
    prisma.payment.findMany({
      where: { contractId: { in: contractIds }, status: 'PAID', ...(range ? { updatedAt: range } : {}) },
      orderBy: { updatedAt: 'desc' },
      take,
    }),
    prisma.dunningAction.findMany({
      where: { contractId: { in: contractIds }, deletedAt: null, ...(range ? { createdAt: range } : {}) },
      include: { dunningRule: { select: { name: true, channel: true } } },
      orderBy: { createdAt: 'desc' },
      take,
    }),
    prisma.auditLog.findMany({
      where: {
        entity: { in: ['contract', 'mdm_lock_request'] },
        entityId: { in: contractIds },
        action: {
          in: [
            'STATUS_CHANGE',
            'DUNNING_ESCALATION_APPROVED',
            'MDM_LOCK_APPROVED',
            'MDM_UNLOCK',
          ],
        },
        ...(range ? { createdAt: range } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    }),
    prisma.contractLetter.findMany({
      where: {
        contractId: { in: contractIds },
        deletedAt: null,
        status: { in: ['DISPATCHED', 'DELIVERED'] },
        ...(range ? { OR: [{ dispatchedAt: range }, { dispatchedAt: null, createdAt: range }] } : {}),
      },
      orderBy: { dispatchedAt: 'desc' },
      take,
    }),
  ]);

  const rows: ContractEventRow[] = [];

  for (const c of calls) {
    rows.push({
      contractId: c.contractId,
      actorUserId: c.callerId ?? null,
      event: {
        id: `call-${c.id}`,
        type: 'CALL',
        timestamp: c.calledAt.toISOString(),
        title: CALL_RESULT_LABELS[c.result] ?? c.result,
        subtitle: c.caller?.name ?? undefined,
        metadata: {
          result: c.result,
          notes: c.notes ?? undefined,
          settlementDate: c.settlementDate ?? undefined,
          // P2 (Customer 360) — voice memo surfaced inline on the Collections timeline.
          callLogId: c.id,
          voiceMemoUrl: c.voiceMemoUrl ?? undefined,
          voiceMemoTier: c.voiceMemoTier ?? undefined,
        },
      },
    });
  }

  for (const p of payments) {
    rows.push({
      contractId: p.contractId,
      actorUserId: p.recordedById ?? null,
      event: {
        id: `payment-${p.id}`,
        type: 'PAYMENT',
        timestamp: p.updatedAt.toISOString(),
        title: `ชำระ ${Number(p.amountPaid.toFixed(2)).toLocaleString('th-TH')} ฿ (งวด ${p.installmentNo})`,
        metadata: { amount: p.amountPaid.toString(), method: p.paymentMethod ?? undefined },
      },
    });
  }

  for (const d of dunningActions) {
    rows.push({
      contractId: d.contractId,
      actorUserId: d.executedById ?? null,
      event: {
        id: `dunning-${d.id}`,
        type: 'DUNNING_ACTION',
        timestamp: d.createdAt.toISOString(),
        title: `ส่ง ${d.channel}: ${d.dunningRule.name}`,
        subtitle:
          d.messageContent
            ? d.messageContent.substring(0, 80) + (d.messageContent.length > 80 ? '…' : '')
            : undefined,
        metadata: { status: d.status, channel: d.channel },
      },
    });
  }

  for (const a of audits) {
    const isMdm = a.action.startsWith('MDM_');
    rows.push({
      contractId: a.entityId,
      actorUserId: a.userId ?? null,
      event: {
        id: `audit-${a.id}`,
        type: isMdm ? 'MDM' : 'STATUS_CHANGE',
        timestamp: a.createdAt.toISOString(),
        title: formatAuditTitle(a.action, a.newValue as Record<string, unknown> | null),
        metadata: { action: a.action, newValue: a.newValue ?? undefined },
      },
    });
  }

  for (const l of letters) {
    rows.push({
      contractId: l.contractId,
      actorUserId: l.dispatchedById ?? null,
      event: {
        id: `letter-${l.id}`,
        type: 'LETTER',
        timestamp: (l.dispatchedAt ?? l.createdAt).toISOString(),
        title: `ส่งหนังสือ: ${l.letterType} (EMS: ${l.trackingNumber ?? '—'})`,
        metadata: { status: l.status, letterNumber: l.letterNumber },
      },
    });
  }

  return rows.filter((row) => isBeforeCursor(row.event, window.before));
}
```
Run เทส Step 2 และ Step 3 อีกครั้ง → Expected: PASS 6 tests (unit) และ PASS 4 tests (db)

- [ ] **Step 5: `timeline.service.ts` เรียก `contractEventSources`**

เขียนทับ `apps/api/src/modules/overdue/timeline.service.ts` ทั้งไฟล์ (บรรทัด 1-170) ด้วย:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { contractEventSources, type TimelineEvent } from './contract-event-sources';

export type { TimelineEvent, TimelineEventType } from './contract-event-sources';

@Injectable()
export class OverdueTimelineService {
  constructor(private prisma: PrismaService) {}

  async getFullTimeline(contractId: string): Promise<TimelineEvent[]> {
    // Verify contract exists (avoid leaking other tenants' data via guessed IDs)
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const rows = await contractEventSources(this.prisma, [contractId]);
    const events = rows.map((row) => row.event);
    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return events.slice(0, 100);
  }
}
```
ต้องคงลำดับการ push ของแถว (call → payment → dunning → audit → letter) เพราะ `Array.prototype.sort` เสถียร และ golden มีเคสที่เวลาเท่ากัน (call-cl-a กับ payment-pm-6) ซึ่งล็อกลำดับนี้ไว้ · ห้ามเพิ่ม `deletedAt: null` ให้ `callLog`/`payment` ใน task นี้ (ดูข้อสังเกตด้านบน)

- [ ] **Step 6: ยืนยัน golden เหมือนเดิม + ชุดเทสเดิม + typecheck + lint**

Run (จาก `apps/api`):
```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/overdue/timeline.service.golden.spec.ts src/modules/overdue/timeline.service.spec.ts src/modules/overdue/contract-event-sources.spec.ts src/modules/overdue/contract-event-sources.db.spec.ts --runInBand
```
→ Expected: `Test Suites: 4 passed` · `Tests: 19 passed` (golden 3 · spec เดิม 6 ที่ไม่ได้แก้ · unit 6 · db 4) · ถ้า golden แดง = ผลลัพธ์เปลี่ยน ให้แก้ `contract-event-sources.ts` ห้ามแก้ `GOLDEN`

`npx tsc --noEmit -p tsconfig.json` → 0 error · `npx eslint src/modules/overdue/contract-event-sources.ts src/modules/overdue/timeline.service.ts src/modules/overdue/contract-event-sources.spec.ts src/modules/overdue/contract-event-sources.db.spec.ts src/modules/overdue/timeline.service.golden.spec.ts` → 0 error (🚨 ห้าม `npm run lint`)

รันเทส db ซ้ำอีกรอบ → ต้องยังผ่าน (อีเมลผู้ใช้ upsert · เลขสัญญา/หนังสือมี stamp) · หลังรันเสร็จ ในฐานทดสอบต้องไม่มีแถว `contracts.contract_number LIKE 'CES-%'` / `products.imei_serial LIKE 'CES-%'` / `dunning_rules.name LIKE 'spec rule %'` ค้าง จะเหลือแค่ผู้ใช้ `contract-event-sources.db-spec@bestchoice.test` 1 แถว กับแถว audit ที่ trigger ห้ามลบ

`git status --short` → ต้องเห็นแค่ 5 ไฟล์ของ task นี้ (`overdue.controller.ts` · `overdue.module.ts` · `useCustomer360.ts` ต้องไม่อยู่ในรายการ)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/overdue/timeline.service.golden.spec.ts apps/api/src/modules/overdue/contract-event-sources.ts apps/api/src/modules/overdue/contract-event-sources.spec.ts apps/api/src/modules/overdue/contract-event-sources.db.spec.ts apps/api/src/modules/overdue/timeline.service.ts
git commit -m "refactor(overdue): แยก contract-event-sources ออกจากไทม์ไลน์สัญญา รับหลายสัญญา ช่วงเวลา และ keyset โดยผลลัพธ์ full-timeline เท่าเดิม (golden test)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: API ตัวอ่านการเดินทางของลูกค้า — `GET /customers/:id/journey` (8 แหล่ง · keyset cursor · สิทธิ์ตามบทบาท · redirect placeholder)

**Files:**
- Create: `apps/api/src/modules/customer-journey/sources/journey-window.ts` + `journey-window.spec.ts`
- Create: `apps/api/src/modules/customer-journey/sources/chat.source.ts` + `chat.source.db.spec.ts`
- Create: `apps/api/src/modules/customer-journey/sources/credit.source.ts` · `sale.source.ts` + `credit-sale.source.spec.ts`
- Create: `apps/api/src/modules/customer-journey/sources/contract-timeline.ts` · `payment.source.ts` · `collections.source.ts` · `service.source.ts` · `points.source.ts` + `contract-service-points.source.spec.ts`
- Create: `apps/api/src/modules/customer-journey/sources/entries.source.ts` + `entries.source.spec.ts`
- Create: `apps/api/src/modules/customer-journey/dto/journey-list-query.dto.ts` + `.spec.ts`
- Create: `apps/api/src/modules/customer-journey/customer-journey.service.ts` + `customer-journey.service.spec.ts` + `customer-journey.pdpa.db.spec.ts` + `customer-journey.payments-cursor.db.spec.ts`
- Create: `apps/api/src/modules/customer-journey/customer-journey.controller.ts` + `.spec.ts`
- Modify: `apps/api/src/modules/credit-check/services/room-credit-access.ts:9-34` (ดึงกติกาห้องของ SALES บรรทัด 24-26 ออกเป็น `roomAssignmentScope`) + Create `room-credit-access.spec.ts`
- Modify: `apps/api/src/modules/customer-journey/customer-journey.module.ts` (ไฟล์ของ Task 3 — เขียนทับทั้งไฟล์: เพิ่ม controller + `CustomerJourneyService` คง provider/export เดิม)
- ไม่แตะ `apps/api/src/app.module.ts` — Task 2 ลงทะเบียน `CustomerJourneyModule` ไว้แล้ว (ถัดจาก `ImportedSalesModule`)

**Interfaces:**
- Consumes:
  - Task 1 — Prisma: `Customer.mergedIntoId` · `prisma.customerJourneyEntry` (ฟิลด์ตาม dataModel: `customerId, originCustomerId, origin, kind, occurredAt, actorType, actorUser, roomId, refType, refId, data, channel, outcome, lostReason, heardFrom, note, dedupeKey, deletedAt`)
  - Task 1 — `@installment/shared`: `JourneyEvent` = `{ id; type: string; group: JourneyEventGroup; stage: JourneyStage|null; timestamp: string; title: string; subtitle?; actor: {type:'STAFF'|'CUSTOMER'|'BOT'|'SYSTEM'; id?; name?}|null; reliability:'exact'|'approximate'; origin:'SOURCE'|'SYSTEM_ENTRY'|'MANUAL'; href?; metadata?: Record<string,unknown> }` · `JourneyEventGroup` · `JOURNEY_EVENT_GROUPS` · `JourneyStage` · `JourneyEntryKind` · `interface JourneyListResponse { customerId: string; mergedCustomerIds: string[]; summary?: JourneySummary; events: JourneyEvent[]; nextCursor: string | null; counts?: Partial<Record<JourneyEventGroup, number>>; notRecorded: string[] }` · `interface JourneyRedirect { redirectToCustomerId: string }` — **ห้ามประกาศ type คำตอบซ้ำในฝั่ง API**
  - Task 1 — `@installment/shared`: `JOURNEY_DEFAULT_GROUPS: readonly JourneyEventGroup[]` (`['chat','credit','sale','collections','service']`) · `JOURNEY_HIDDEN_GROUPS: Readonly<Record<string, readonly JourneyEventGroup[]>>` (`{ ACCOUNTANT: ['chat'], SALES: ['payment','collections'] }`) · `JOURNEY_LOST_REASON_LABELS` · `JOURNEY_HEARD_FROM_LABELS` (`Readonly<Record<string, string>>`) — **ห้ามประกาศกฎกลุ่ม/ป้ายซ้ำในฝั่ง API** (เว็บ Task 12 ใช้ชุดเดียวกัน)
  - Task 2 — `JOURNEY_DATA_SCHEMAS` (`customer-journey/journey-data-schemas.ts`, zod `.safeParse` ต่อ kind) · `journeyDedupeKey(kind, ...parts)` (seed ของเทส)
  - Task 3 — `CustomerJourneyModule` providers/exports `[JourneyEntryWriter, JourneyStateService]`
  - Task 7 — `contractEventSources(prisma: ContractEventPrisma, contractIds: string[], window?: ContractEventWindow): Promise<ContractEventRow[]>` จาก `apps/api/src/modules/overdue/contract-event-sources.ts` · `ContractEventRow = { contractId: string; actorUserId: string | null; event: TimelineEvent }` · `ContractEventWindow = { before?: { ts: string; id: string }; from?: Date; to?: Date; limit?: number }` (limit ต่อตารางต้นทาง · `before` กรองแบบเข้ม · แถวไม่ได้เรียงข้ามตาราง) · `TimelineEvent.type` = `CALL|PAYMENT|DUNNING_ACTION|STATUS_CHANGE|MDM|LETTER` · 🚨 `metadata.notes` ของ CALL และ `subtitle` ของ DUNNING_ACTION ห้ามส่งต่อ
  - ของเดิม: `creditHistoryAccess` (`credit-check/services/room-credit-access.ts:10`) · `CHAT_SOURCE_PREFIX` (`packages/shared/src/customer-sort.ts:113`) · `formatDateTime` (`apps/api/src/utils/thai-date.util.ts:111`) · guards/decorators แบบ `customers.controller.ts:26-30,40` · ValidationPipe `whitelist+transform+enableImplicitConversion` (`app.setup.ts:172-178`) · ป้ายสถานะซ่อม `apps/web/src/pages/insurance/components/RepairStatusBadge.tsx:11-18` · ป้ายแท็ก `ProspectFilterBar.tsx:30-36` · route เว็บที่มีจริง `/inbox/:roomId` (`App.tsx:508`) `/contracts/:id` (`:551`) `/insurance/:id` (`:740`) — ไม่มี `/sales/:id` `/bookings/:id` จึงไม่ใส่ href
- Produces:
  - `GET /customers/:id/journey` roles `OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT, SALES` · query `JourneyListQueryDto { limit?: number (1-100, 30); cursor?: string (base64 'isoTs|eventId'); groups?: JourneyEventGroup[] (csv); from?: string ISO; to?: string ISO }` → shared `JourneyListResponse` (task นี้ไม่ใส่ `summary`/`counts` — Task 9 เติม) | shared `JourneyRedirect`
  - `CustomerJourneyService.list(customerId: string, query: JourneyListQueryDto, actor: { id: string; role: string }): Promise<JourneyListResponse | JourneyRedirect>` (Task 9 เพิ่ม `summary()`, route `/summary`, query `include` csv `summary`/`counts` ของหน้าแรก — ValidationPipe `whitelist` ตัดคีย์ที่ไม่รู้จักทิ้งจึงไม่ 400)
  - `DEFAULT_JOURNEY_LIMIT` · `JOURNEY_NOT_RECORDED` · `resolveJourneyGroups(requested, role): Set<JourneyEventGroup>` (ไม่ส่ง groups = `JOURNEY_DEFAULT_GROUPS` · ตัด `JOURNEY_HIDDEN_GROUPS[role]` — ทั้งคู่ import จาก shared) · `sourcesForGroups(groups): JourneySource[]`
  - `sources/journey-window.ts`: `JourneyActor` · `JourneyWindow` · `JourneySource` · `JOURNEY_CHAT_ROLES` · `SOURCE_SCAN_PAD` · `scanTake` · `dbTimeRange` · `compareEventsDesc` · `encodeJourneyCursor` · `decodeJourneyCursor` · `finalizeSource` · `mergeJourneyPage` · `whenAny` · `asRecord` · `pickMetadata` · `staffActor` · `asActorType` · `bahtText`
  - แหล่ง (ทุกตัวเป็น `JourneySource`): `chatSource` `creditSource` `saleSource` `paymentSource` `collectionsSource` `serviceSource` `pointsSource` `entriesSource` · `entriesSourceFor(groups: ReadonlySet<JourneyEventGroup>): JourneySource` (DB กรอง kind ตามกลุ่มที่ขอ · อ่านแท็กเฉพาะเมื่อขอ `system` · `entriesSource = entriesSourceFor(ทุกกลุ่ม)` · Task 9 ใช้สแกนนับชิปทีละกลุ่ม) · `CHAT_CHANNEL_LABELS` · `interface CustomerContractEvent { contract: { id: string; contractNumber: string }; actorUserId: string | null; event: TimelineEvent }` · `customerContractEvents(prisma: PrismaService, customerIds: string[], window: JourneyWindow): Promise<CustomerContractEvent[]>` (เรียก `contractEventSources` ครั้งเดียวด้วยทุกสัญญา + `{ before, from, to, limit: scanTake(window) }`)
  - `roomAssignmentScope(actor: {id; role}): Prisma.ChatRoomWhereInput`
  - event `type` ที่เว็บต้องรู้จัก: `CHAT_ROOM_OPENED CHAT_DAY APPOINTMENT APPOINTMENT_DONE AI_LEAD_CAPTURED CUSTOMER_CREATED_BY_STAFF CUSTOMER_CREATED_BY_BOT CREDIT_CHECK_OPENED CHAT_STATEMENT_ANALYZED CREDIT_DECISION CREDIT_LIMIT_APPROVED BOOKING_OPENED BOOKING_DEPOSIT_PAID BOOKING_CANCELED BOOKING_CONVERTED BOOKING_EXPIRED SALE_CASH SALE_EXTERNAL_FINANCE SALE_VOIDED CONTRACT_DRAFTED CONTRACT_REVIEWED CONTRACT_SIGNED CONTRACT_ACTIVATED CONTRACT_ENDED PAYMENT_RECEIVED COLLECTION_CALL COLLECTION_DUNNING CONTRACT_STATUS_CHANGE COLLECTION_MDM COLLECTION_LETTER REPAIR_TICKET REPAIR_STATUS LOYALTY_POINTS LOYALTY_REDEEMED TAG_ADDED TAG_REMOVED` + kind ของ entries (`CONTRACT_ACTIVATED … REOPENED` ยกเว้น `CREDIT_CHECK_OPENED_BY`)

**แผนที่ eventCatalog → แหล่ง (reliability)**

| catalog | type ที่ส่งออก · ไฟล์ · กลุ่ม | reliability | รอบนี้ |
|---|---|---|---|
| CHAT_ROOM_OPENED | เดิม · chat · chat | exact · approximate ถ้าข้อความแรกของลูกค้าเก่ากว่าเวลาสร้างห้อง | ✅ |
| CHAT_DAY | เดิม · chat · chat | exact · มีข้อความร้าน = approximate | ✅ |
| APPOINTMENT | APPOINTMENT / APPOINTMENT_DONE · chat | exact | ✅ |
| AI_LEAD_CAPTURED | เดิม · chat (ids รวม placeholder) | exact | ✅ หยิบเฉพาะ packageChoice/downAmount/productId |
| CUSTOMER_CREATED_BY_STAFF | + `_BY_BOT` เมื่อที่มา `AI_CHAT` · chat | approximate | ✅ ไม่ระบุชื่อผู้สร้าง |
| CONTACT_ADDED · LINE_LINKED · PLACEHOLDER_MERGED · PRODUCT_LINK_CLICK · BOT_HANDOFF · TOUCHPOINT · HEARD_FROM · MARKED_LOST/REOPENED | kind เดิม · entries · chat | exact (เก็บตั้งแต่ deploy) | ✅ |
| CREDIT_CHECK_OPENED | เดิม + ผู้เปิดจาก entry `CREDIT_CHECK_OPENED_BY` · credit | ที่ร้าน exact · จากแชท approximate | ✅ |
| CHAT_STATEMENT_ANALYZED · CREDIT_DECISION · CREDIT_LIMIT_APPROVED | เดิม · credit | exact | ✅ ไม่คัด overrideReason |
| CREDIT_AI_SCORED | kind · entries · credit | exact ตั้งแต่ deploy | ✅ |
| BOOKING | BOOKING_* · sale | exact · หมดอายุ approximate | ✅ |
| SALE_CASH/EXTERNAL_FINANCE · SALE_VOIDED · CONTRACT_DRAFTED · CONTRACT_SIGNED | เดิม · sale | exact | ✅ ไม่คัด voidReason |
| CONTRACT_REVIEWED · CONTRACT_ACTIVATED | entry = exact · ย้อนหลัง (`reviewed_at` / ใบขาย INSTALLMENT) = approximate เฉพาะสัญญาที่ยังไม่มี entry | | ✅ |
| CONTRACT_ENDED | เฉพาะ COMPLETED/EARLY_PAYOFF จาก MAX(paid_date) | approximate | 🟡 บางส่วน |
| PAYMENT_RECEIVED | payment | approximate (updated_at จนกว่า PR paidDate) | ✅ |
| CONTRACT_STATUS_CHANGE · COLLECTION_* | collections | exact | ✅ ตัด messageContent/notes/voiceMemoUrl |
| REPAIR_TICKET | REPAIR_TICKET / REPAIR_STATUS · service | exact | ✅ |
| LOYALTY_POINTS | LOYALTY_POINTS / LOYALTY_REDEEMED · points | exact | ✅ |
| TAG_CHANGED | TAG_ADDED / TAG_REMOVED · entries · system | exact | ✅ ข้ามแท็กซ้ำที่ merge soft-delete |
| AD_REFERRAL · FIRST_STAFF_REPLY · ROOM_CLAIMED · WEB_HOLD/ONLINE_APPLICATION · TRADE_IN · AUTO_REMINDER · SKIP_TRACING_LOST · PDPA_CONSENT/KYC | — | — | ⏭ ไม่อยู่ในงานนี้ (prod 0-1 แถว / อยู่ใน summary / customer_id ว่าง) |

ตัวแปรที่ใช้ทุก Run (จาก `apps/api`): `J='DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test'` — คำสั่ง Run ด้านล่างเขียนเต็มทุกครั้ง

- [ ] **Step 1: ตรวจของจาก Task ก่อนหน้า**
```bash
grep -n "mergedIntoId\|model CustomerJourneyEntry" prisma/schema.prisma
grep -n "export async function contractEventSources\|export interface ContractEventRow" src/modules/overdue/contract-event-sources.ts
grep -n "JOURNEY_EVENT_GROUPS\|interface JourneyEvent\|JourneyEntryKind\|interface JourneyRedirect\|JOURNEY_HIDDEN_GROUPS\|JOURNEY_LOST_REASON_LABELS" ../../packages/shared/src/customer-journey.ts
grep -n "JOURNEY_DATA_SCHEMAS" src/modules/customer-journey/journey-data-schemas.ts
grep -n "CustomerJourneyModule\|JourneyStateService" src/modules/customer-journey/customer-journey.module.ts
npm run build --workspace=@installment/shared
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" npx prisma migrate status
```
Expected: ทุก grep มีผล · build ผ่าน · `Database schema is up to date!` (ขาดอันไหน = Task นั้นยังไม่ลง หยุดก่อน)

- [ ] **Step 2: เทสแดง — หน้าต่าง/cursor/รวมหน้า + กติกาห้อง SALES**

`sources/journey-window.spec.ts`:
```ts
import { BadRequestException } from '@nestjs/common';
import type { JourneyEvent, JourneyEventGroup } from '@installment/shared';
import {
  bahtText, compareEventsDesc, dbTimeRange, decodeJourneyCursor, encodeJourneyCursor,
  finalizeSource, mergeJourneyPage, pickMetadata, type JourneyWindow,
} from './journey-window';

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString();
const ev = (id: string, timestamp: string, group: JourneyEventGroup = 'chat'): JourneyEvent => ({
  id, type: 'TEST', group, stage: null, timestamp, title: id, actor: null, reliability: 'exact', origin: 'SOURCE',
});

describe('journey-window', () => {
  it('cursor เข้ารหัส/ถอดกลับได้ · ค่าเสีย → 400', () => {
    const cursor = encodeJourneyCursor(ev('chatday-r1-2026-09-09', '2026-09-08T17:50:00.000Z'));
    expect(decodeJourneyCursor(cursor)).toEqual({ ts: '2026-09-08T17:50:00.000Z', id: 'chatday-r1-2026-09-09' });
    for (const raw of ['nope', '2026-09-08|chat-1', '2026-09-08T17:50:00.000Z|']) {
      expect(() => decodeJourneyCursor(Buffer.from(raw).toString('base64'))).toThrow(BadRequestException);
    }
  });

  it('เรียงใหม่→เก่า เวลาเท่ากันใช้ id แบบ code point · ขอบ DB เลือกค่าที่เก่ากว่าระหว่าง cursor กับ to', () => {
    expect([ev('a', day(1)), ev('b', day(2)), ev('Z', day(2)), ev('c', day(2))].sort(compareEventsDesc).map((e) => e.id)).toEqual(['c', 'b', 'Z', 'a']);
    expect(dbTimeRange({ limit: 10 })).toBeUndefined();
    expect(dbTimeRange({ limit: 10, before: { ts: day(9), id: 'x' }, to: new Date(day(11)), from: new Date(day(0)) }))
      .toEqual({ lte: new Date(day(9)), gte: new Date(day(0)) });
  });

  it('finalizeSource ตัดตัวที่ไม่เก่ากว่า cursor + from แล้วคืนไม่เกิน limit+1', () => {
    const events = [ev('e5', day(5)), ev('e4b', day(4)), ev('e4a', day(4)), ev('e3', day(3)), ev('e2', day(2)), ev('e1', day(1))];
    const window: JourneyWindow = { limit: 2, before: { ts: day(4), id: 'e4b' }, from: new Date(day(2)) };
    expect(finalizeSource(events, window).map((e) => e.id)).toEqual(['e4a', 'e3', 'e2']);
  });

  it('แหล่งที่เต็มกำหนดขอบ · กลุ่มที่ไม่ได้ขอถูกกรองแต่ cursor ยังเดินต่อ', () => {
    const chat = new Set<JourneyEventGroup>(['chat']);
    expect(mergeJourneyPage([[ev('a2', day(2))], [ev('b1', day(1))]], 2, chat)).toEqual({ events: [ev('a2', day(2)), ev('b1', day(1))], nextCursor: null });
    const page = mergeJourneyPage([[ev('a9', day(9)), ev('a8', day(8)), ev('a7', day(7))], [ev('b6', day(6))]], 2, chat);
    expect(page.events.map((e) => e.id)).toEqual(['a9', 'a8']);
    expect(decodeJourneyCursor(page.nextCursor ?? '')).toEqual({ ts: day(8), id: 'a8' });
    const hidden = mergeJourneyPage([[ev('s9', day(9), 'system'), ev('s8', day(8), 'system'), ev('s7', day(7), 'system')], [ev('c6', day(6))]], 2, chat);
    expect(hidden.events).toEqual([]);
    expect(decodeJourneyCursor(hidden.nextCursor ?? '')).toEqual({ ts: day(7), id: 's7' });
  });

  it('เดินทีละ 2 จนหมด ได้ครบ ไม่ซ้ำ ไม่ข้าม แม้เวลาชนกันข้ามแหล่ง', () => {
    const sources: JourneyEvent[][] = [
      Array.from({ length: 7 }, (_, i) => ev(`chat-${i}`, day(i % 3))),
      Array.from({ length: 5 }, (_, i) => ev(`entry-${i}`, day(i % 2), i % 2 ? 'system' : 'sale')),
      Array.from({ length: 4 }, (_, i) => ev(`credit-${i}`, day(i), 'credit')),
    ];
    const groups = new Set<JourneyEventGroup>(['chat', 'sale', 'credit']);
    const expected = sources.flat().filter((e) => groups.has(e.group)).sort(compareEventsDesc).map((e) => e.id);
    const walked: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard += 1) {
      const window: JourneyWindow = cursor ? { limit: 2, before: decodeJourneyCursor(cursor) } : { limit: 2 };
      const page = mergeJourneyPage(sources.map((all) => finalizeSource(all, window)), window.limit, groups);
      walked.push(...page.events.map((e) => e.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(walked).toEqual(expected);
  });

  it('bahtText · pickMetadata หยิบเฉพาะคีย์ที่อนุญาต', () => {
    expect(bahtText(4200)).toBe('4,200');
    expect(bahtText('1234.5')).toBe('1,234.5');
    expect(pickMetadata({ result: 'PROMISED', notes: 'โทร 0812345678' }, ['result'])).toEqual({ result: 'PROMISED' });
    expect(pickMetadata(undefined, ['result'])).toBeUndefined();
  });
});
```
`credit-check/services/room-credit-access.spec.ts`:
```ts
import { creditHistoryAccess, roomAssignmentScope } from './room-credit-access';

describe('roomAssignmentScope', () => {
  it('SALES เห็นเฉพาะห้องที่ยังไม่มีผู้ดูแลหรือตัวเองดูแล · creditHistoryAccess ได้ where เดิมทุกบทบาท', () => {
    expect(roomAssignmentScope({ id: 's1', role: 'SALES' })).toEqual({ OR: [{ assignedToId: null }, { assignedToId: 's1' }] });
    expect(roomAssignmentScope({ id: 'o1', role: 'OWNER' })).toEqual({});
    expect(creditHistoryAccess()).toEqual({});
    expect(creditHistoryAccess({ id: 'a1', role: 'ACCOUNTANT' })).toEqual({ roomAnalysis: { is: null } });
    expect(creditHistoryAccess({ id: 's1', role: 'SALES' })).toEqual({
      OR: [{ roomAnalysis: { is: null } }, { roomAnalysis: { is: { deletedAt: null, room: { is: { deletedAt: null, OR: [{ assignedToId: null }, { assignedToId: 's1' }] } } } } }],
    });
    expect(creditHistoryAccess({ id: 'o1', role: 'OWNER' })).toEqual({
      OR: [{ roomAnalysis: { is: null } }, { roomAnalysis: { is: { deletedAt: null, room: { is: { deletedAt: null } } } } }],
    });
  });
});
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/sources/journey-window.spec.ts src/modules/credit-check/services/room-credit-access.spec.ts --runInBand` → Expected: FAIL `Cannot find module './journey-window'` และ `has no exported member 'roomAssignmentScope'`

- [ ] **Step 3: `journey-window.ts` + `roomAssignmentScope`**

`sources/journey-window.ts`:
```ts
import { BadRequestException } from '@nestjs/common';
import type { JourneyEvent, JourneyEventGroup } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';

export interface JourneyActor { id: string; role: string }

/** before = cursor ที่ถอดแล้ว (ตัว cursor เองไม่อยู่ในผล) */
export interface JourneyWindow { before?: { ts: string; id: string }; from?: Date; to?: Date; limit: number }

/** ทุกไฟล์ใน sources/ คืนรายการเรียงใหม่→เก่า ไม่เกิน limit+1 */
export type JourneySource = (prisma: PrismaService, customerIds: string[], window: JourneyWindow, actor: JourneyActor) => Promise<JourneyEvent[]>;

type EventActor = NonNullable<JourneyEvent['actor']>;
type EventKey = Pick<JourneyEvent, 'timestamp' | 'id'>;

/** ชุดเดียวกับ CHAT_VISIBLE_ROLES (apps/web/src/config/menu.ts:1204) */
export const JOURNEY_CHAT_ROLES: ReadonlySet<string> = new Set(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']);

/** DB เรียงด้วยเวลาอย่างเดียว เวลาเท่ากันตัดสินด้วย id ใน JS (ไม่พึ่ง collation) — ผิดได้เมื่อมีแถวเวลาเดียวกันเกิน 200 แถวที่รอยตัดเท่านั้น */
export const SOURCE_SCAN_PAD = 200;
export const scanTake = (window: JourneyWindow): number => window.limit + 1 + SOURCE_SCAN_PAD;

export interface TimeRange { lte?: Date; gte?: Date }

/** ขอบเวลาฝั่ง DB (รวมเวลาเท่ากับ cursor — finalizeSource ตัดเอง) */
export function dbTimeRange(window: JourneyWindow): TimeRange | undefined {
  const before = window.before ? new Date(window.before.ts) : undefined;
  const upper = before && window.to ? (before < window.to ? before : window.to) : before ?? window.to;
  const range: TimeRange = {};
  if (upper) range.lte = upper;
  if (window.from) range.gte = window.from;
  return range.lte || range.gte ? range : undefined;
}

export function compareEventsDesc(a: EventKey, b: EventKey): number {
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

export const encodeJourneyCursor = (event: EventKey): string => Buffer.from(`${event.timestamp}|${event.id}`, 'utf8').toString('base64');

export function decodeJourneyCursor(cursor: string): { ts: string; id: string } {
  const raw = Buffer.from(cursor, 'base64').toString('utf8');
  const bar = raw.indexOf('|');
  const ts = bar > 0 ? raw.slice(0, bar) : '';
  const id = bar > 0 ? raw.slice(bar + 1) : '';
  const validTs = !Number.isNaN(Date.parse(ts)) && new Date(ts).toISOString() === ts;
  if (!id || !validTs) throw new BadRequestException('cursor ไม่ถูกต้อง');
  return { ts, id };
}

export function finalizeSource(events: JourneyEvent[], window: JourneyWindow): JourneyEvent[] {
  const cursor = window.before ? { timestamp: window.before.ts, id: window.before.id } : null;
  const from = window.from?.toISOString();
  const to = window.to?.toISOString();
  return events
    .filter((e) => (!cursor || compareEventsDesc(e, cursor) > 0) && (!from || e.timestamp >= from) && (!to || e.timestamp <= to))
    .sort(compareEventsDesc)
    .slice(0, window.limit + 1);
}

/**
 * แหล่งที่คืนครบ limit+1 อาจยังมีรายการเก่ากว่า ⇒ หน้าไม่เลย "ขอบ" ที่ใหม่สุดของแหล่งเหล่านั้น
 * กรองกลุ่มหลังดึง (entries คืนหลายกลุ่ม) แต่ขอบคิดจากรายการก่อนกรอง หน้าจึงไม่ข้าม
 */
export function mergeJourneyPage(perSource: JourneyEvent[][], limit: number, groups: ReadonlySet<JourneyEventGroup>): { events: JourneyEvent[]; nextCursor: string | null } {
  let edge: JourneyEvent | null = null;
  for (const list of perSource) {
    if (list.length <= limit) continue;
    const last = list[list.length - 1];
    if (!edge || compareEventsDesc(last, edge) < 0) edge = last;
  }
  const boundary = edge;
  const visible = perSource.flat().filter((e) => groups.has(e.group)).sort(compareEventsDesc)
    .filter((e) => !boundary || compareEventsDesc(e, boundary) <= 0);
  if (visible.length > limit) {
    const events = visible.slice(0, limit);
    return { events, nextCursor: encodeJourneyCursor(events[events.length - 1]) };
  }
  return { events: visible, nextCursor: boundary ? encodeJourneyCursor(boundary) : null };
}

export async function whenAny<T>(keys: readonly unknown[], run: () => Promise<T[]>): Promise<T[]> {
  return keys.length ? run() : [];
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function pickMetadata(source: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  const record = asRecord(source);
  const picked = Object.fromEntries(keys.filter((k) => record[k] !== undefined && record[k] !== null).map((k) => [k, record[k]]));
  return Object.keys(picked).length ? picked : undefined;
}

export function staffActor(user: { id: string; name: string } | null | undefined): EventActor {
  return user ? { type: 'STAFF', id: user.id, name: user.name } : { type: 'STAFF' };
}

const ACTOR_TYPES: readonly string[] = ['STAFF', 'CUSTOMER', 'BOT', 'SYSTEM'];
export const asActorType = (value: string): EventActor['type'] => (ACTOR_TYPES.includes(value) ? (value as EventActor['type']) : 'SYSTEM');

export const bahtText = (value: { toString(): string }): string => Number(value.toString()).toLocaleString('th-TH', { maximumFractionDigits: 2 });
```
`room-credit-access.ts` แทนบรรทัด 9-34 (ตั้งแต่คอมเมนต์ `/** Imported statements…` ถึงปีกกาปิดของ `creditHistoryAccess`):
```ts
/** กติกาห้องของ SALES (ด่านเดียวกับ room-manager.service.ts:742,762) — ห้องที่ยังไม่มีผู้ดูแลหรือตัวเองดูแล · บทบาทอื่นไม่จำกัด */
export function roomAssignmentScope(actor: CreditHistoryActor): Prisma.ChatRoomWhereInput {
  return actor.role === 'SALES' ? { OR: [{ assignedToId: null }, { assignedToId: actor.id }] } : {};
}

/** Imported statements keep the same visibility as their source chat room. */
export function creditHistoryAccess(actor?: CreditHistoryActor): Prisma.CreditCheckWhereInput {
  if (!actor) return {}; // Internal contract checks already have their own access boundary.
  const legacy: Prisma.CreditCheckWhereInput = { roomAnalysis: { is: null } };
  if (!['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'].includes(actor.role)) return legacy;
  return {
    OR: [legacy, { roomAnalysis: { is: { deletedAt: null, room: { is: { deletedAt: null, ...roomAssignmentScope(actor) } } } } }],
  };
}
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/sources/journey-window.spec.ts src/modules/credit-check --runInBand` → Expected: PASS ทั้งหมด (รวม `chat-credit-contract-access.spec.ts` เดิม)

- [ ] **Step 4: เทสแดง — `chatSource` กับ Postgres จริง**

`sources/chat.source.db.spec.ts`:
```ts
import { ChatChannel, MessageRole, PrismaClient } from '@prisma/client';
import type { JourneyEvent } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { formatDateTime } from '../../../utils/thai-date.util';
import { chatSource } from './chat.source';

/** audit_logs ลบไม่ได้ (trigger migration 20260520300000) ⇒ แถว AI_LEAD_CAPTURED ของสเปคค้างในฐานทดสอบโดยตั้งใจ · ผู้ใช้ upsert ไม่ลบ */
describe('chatSource (real DB)', () => {
  const prisma = new PrismaClient();
  const db = prisma as unknown as PrismaService;
  const stamp = Date.now();
  const ids = { staff: '', staffName: '', other: '', customer: '', walkIn: '', open: '', assigned: '' };
  const OWNER = { id: 'owner-spec', role: 'OWNER' };
  const byId = (events: JourneyEvent[], id: string) => events.find((e) => e.id === id);
  const upsertUser = (email: string, name: string) =>
    prisma.user.upsert({ where: { email }, update: {}, create: { email, password: 'journey-spec', name, role: 'SALES' } });

  beforeAll(async () => {
    const staff = await upsertUser('journey-spec-staff@example.test', 'พนักงานสเปคการเดินทาง');
    Object.assign(ids, { staff: staff.id, staffName: staff.name, other: (await upsertUser('journey-spec-other@example.test', 'พนักงานอีกคน')).id });
    ids.customer = (await prisma.customer.create({ data: { name: 'journey chat spec', acquisitionSource: 'CHAT_FACEBOOK' } })).id;
    ids.walkIn = (await prisma.customer.create({ data: { name: 'journey walk-in spec', phone: `08${String(stamp).slice(-8)}`, createdAt: new Date('2026-09-01T03:00:00.000Z') } })).id;
    ids.open = (await prisma.chatRoom.create({ data: { channel: ChatChannel.FACEBOOK, externalUserId: `journey-open-${stamp}`, customerId: ids.customer, createdAt: new Date('2026-09-10T03:00:00.000Z') } })).id;
    ids.assigned = (await prisma.chatRoom.create({ data: { channel: ChatChannel.LINE_SHOP, externalUserId: `journey-assigned-${stamp}`, customerId: ids.customer, assignedToId: ids.other, createdAt: new Date('2026-09-12T03:00:00.000Z') } })).id;
    const msg = (roomId: string, role: MessageRole, text: string, iso: string, deletedAt?: Date) => ({ roomId, role, text, createdAt: new Date(iso), deletedAt });
    await prisma.chatMessage.createMany({ data: [
      msg(ids.open, MessageRole.CUSTOMER, 'สนใจครับ เบอร์ 0899999999', '2026-09-08T16:30:00.000Z'), // 23:30 ไทยวันที่ 8
      msg(ids.open, MessageRole.CUSTOMER, 'ผ่อนได้ไหม', '2026-09-08T17:30:00.000Z'), // 00:30 ไทยวันที่ 9
      msg(ids.open, MessageRole.STAFF, 'ได้ค่ะ', '2026-09-08T17:40:00.000Z'),
      msg(ids.open, MessageRole.BOT, 'ส่งตารางผ่อน', '2026-09-08T17:41:00.000Z'),
      msg(ids.open, MessageRole.CUSTOMER, 'บ้านเลขที่ 99/1', '2026-09-08T17:50:00.000Z', new Date('2026-09-14T00:00:00.000Z')),
      msg(ids.open, MessageRole.SYSTEM, 'ระบบ', '2026-09-08T17:55:00.000Z'),
      msg(ids.assigned, MessageRole.CUSTOMER, 'ห้องของคนอื่น', '2026-09-12T04:00:00.000Z'),
    ] });
    await prisma.todo.create({ data: { title: 'นัดลูกค้า 0899999999', createdById: ids.staff, roomId: ids.open, dueDate: new Date('2026-09-20T07:00:00.000Z'), createdAt: new Date('2026-09-09T02:00:00.000Z'), completedAt: new Date('2026-09-20T07:30:00.000Z') } });
    await prisma.auditLog.create({ data: { userId: ids.staff, action: 'AI_LEAD_CAPTURED', entity: 'customer', entityId: ids.customer, createdAt: new Date('2026-09-09T05:00:00.000Z'),
      newValue: { customerName: 'สมชาย ใจดี', phone: '0899999999', address: 'บ้านเลขที่ 99/1', productId: 'p-1', packageChoice: 'B', downAmount: 3000, visitPlan: 'เสาร์นี้' } } });
  });

  afterAll(async () => {
    const roomIds = [ids.open, ids.assigned];
    await prisma.todo.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: [ids.customer, ids.walkIn] } } });
    await prisma.$disconnect();
  });

  it('ห้องนำเข้านับจากข้อความแรกของลูกค้า (approximate) · แชทรายวันแบ่งวันไทย นับแถว soft-delete ไม่นับ SYSTEM · นัด · บอทจดความสนใจ', async () => {
    const events = await chatSource(db, [ids.customer], { limit: 50 }, OWNER);
    expect(byId(events, `chatroom-${ids.open}`)).toMatchObject({ stage: 'CONTACTED', timestamp: '2026-09-08T16:30:00.000Z', title: 'ทักแชทครั้งแรกทาง Facebook', reliability: 'approximate', href: `/inbox/${ids.open}` });
    expect(byId(events, `chatroom-${ids.assigned}`)).toMatchObject({ stage: null, title: 'ทักเพิ่มทาง LINE ร้าน', reliability: 'exact' });
    expect(byId(events, `chatday-${ids.open}-2026-09-09`)).toMatchObject({ timestamp: '2026-09-08T17:50:00.000Z', title: 'คุยแชท: ลูกค้า 2 ข้อความ · ร้านตอบ 1 · บอท 1', reliability: 'approximate' });
    expect(byId(events, `chatday-${ids.open}-2026-09-08`)).toMatchObject({ title: 'คุยแชท: ลูกค้า 1 ข้อความ', reliability: 'exact' });
    expect(events.find((e) => e.type === 'APPOINTMENT')).toMatchObject({ stage: 'INTERESTED', title: `นัดเข้าร้าน ${formatDateTime(new Date('2026-09-20T07:00:00.000Z'))}`, actor: { type: 'STAFF', id: ids.staff, name: ids.staffName } });
    expect(events.find((e) => e.type === 'APPOINTMENT_DONE')).toMatchObject({ timestamp: '2026-09-20T07:30:00.000Z', title: 'มาตามนัดแล้ว' });
    expect(events.find((e) => e.type === 'AI_LEAD_CAPTURED')).toMatchObject({ title: 'บอทจดความสนใจ · แพ็ก B · ดาวน์ 3,000 บาท', metadata: { packageChoice: 'B', downAmount: 3000, productId: 'p-1' } });
    const json = JSON.stringify(events);
    for (const secret of ['0899999999', 'บ้านเลขที่', 'ผ่อนได้ไหม', 'นัดลูกค้า', 'สมชาย', 'เสาร์นี้']) expect(json).not.toContain(secret);
  });

  it('SALES ไม่เห็นห้องที่คนอื่นดูแล · ผู้ดูแลเห็น · ACCOUNTANT ได้ [] · ลูกค้าหน้าร้าน = พนักงานเพิ่ม', async () => {
    const sales = await chatSource(db, [ids.customer], { limit: 50 }, { id: ids.staff, role: 'SALES' });
    expect(sales.some((e) => e.href === `/inbox/${ids.assigned}`)).toBe(false);
    expect(sales.some((e) => e.href === `/inbox/${ids.open}`)).toBe(true);
    expect((await chatSource(db, [ids.customer], { limit: 50 }, { id: ids.other, role: 'SALES' })).some((e) => e.href === `/inbox/${ids.assigned}`)).toBe(true);
    expect(await chatSource(db, [ids.customer], { limit: 50 }, { id: 'a1', role: 'ACCOUNTANT' })).toEqual([]);
    expect(await chatSource(db, [ids.walkIn], { limit: 50 }, OWNER)).toEqual([
      expect.objectContaining({ id: `customer-${ids.walkIn}`, type: 'CUSTOMER_CREATED_BY_STAFF', stage: 'IDENTIFIED', timestamp: '2026-09-01T03:00:00.000Z', reliability: 'approximate' }),
    ]);
  });

  it('cursor ตัดตัวที่ใหม่กว่าและคืนไม่เกิน limit+1', async () => {
    const all = await chatSource(db, [ids.customer], { limit: 50 }, OWNER);
    const page = await chatSource(db, [ids.customer], { limit: 1, before: { ts: all[1].timestamp, id: all[1].id } }, OWNER);
    expect(page.map((e) => e.id)).toEqual(all.slice(2, 4).map((e) => e.id));
  });
});
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/sources/chat.source.db.spec.ts --runInBand` → Expected: FAIL `Cannot find module './chat.source'`

- [ ] **Step 5: `chat.source.ts`**
```ts
import { Prisma } from '@prisma/client';
import { CHAT_SOURCE_PREFIX, type JourneyEvent } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { formatDateTime } from '../../../utils/thai-date.util';
import { roomAssignmentScope } from '../../credit-check/services/room-credit-access';
import { JOURNEY_CHAT_ROLES, asRecord, bahtText, dbTimeRange, finalizeSource, scanTake, staffActor, type JourneyActor, type JourneySource, type JourneyWindow } from './journey-window';

export const CHAT_CHANNEL_LABELS: Record<string, string> = { FACEBOOK: 'Facebook', LINE_SHOP: 'LINE ร้าน', LINE_FINANCE: 'LINE การเงิน', TIKTOK: 'TikTok', WEB: 'เว็บ' };

interface ChatDayRow { roomId: string; day: string; customer: number; staff: number; bot: number; firstCustomerAt: Date | null; lastAt: Date }

/** นับแถวอย่างเดียว ไม่อ่าน text/media · รวมแถวที่ retention soft-delete · created_at = timestamp(3) เก็บ UTC · ไม่มี LIMIT (หลักร้อยวันต่อคน) ตัดใน finalizeSource */
function chatDays(prisma: PrismaService, roomIds: string[]): Promise<ChatDayRow[]> {
  return prisma.$queryRaw<ChatDayRow[]>`
    SELECT m.room_id AS "roomId",
           to_char(((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS "day",
           (COUNT(*) FILTER (WHERE m.role = 'CUSTOMER'))::int AS "customer",
           (COUNT(*) FILTER (WHERE m.role = 'STAFF'))::int AS "staff",
           (COUNT(*) FILTER (WHERE m.role = 'BOT'))::int AS "bot",
           MIN(m.created_at) FILTER (WHERE m.role = 'CUSTOMER') AS "firstCustomerAt",
           MAX(m.created_at) AS "lastAt"
      FROM chat_messages m
     WHERE m.room_id IN (${Prisma.join(roomIds)}) AND m.role IN ('CUSTOMER', 'STAFF', 'BOT')
     GROUP BY 1, 2`;
}

async function roomEvents(prisma: PrismaService, customerIds: string[], actor: JourneyActor): Promise<JourneyEvent[]> {
  // รวมห้องที่ soft-delete (mergeRooms) · SALES เห็นเฉพาะห้องที่ยังไม่มีผู้ดูแลหรือตัวเองดูแล
  const rooms = await prisma.chatRoom.findMany({ where: { customerId: { in: customerIds }, ...roomAssignmentScope(actor) }, select: { id: true, channel: true, createdAt: true } });
  if (!rooms.length) return [];
  const roomIds = rooms.map((room) => room.id);
  const [days, todos] = await Promise.all([
    chatDays(prisma, roomIds),
    prisma.todo.findMany({
      where: { roomId: { in: roomIds }, dueDate: { not: null }, deletedAt: null },
      select: { id: true, roomId: true, dueDate: true, createdAt: true, completedAt: true, createdBy: { select: { id: true, name: true } } },
    }),
  ]);
  const firstCustomerAt = new Map<string, Date>();
  for (const row of days) {
    const seen = firstCustomerAt.get(row.roomId);
    if (row.firstCustomerAt && (!seen || row.firstCustomerAt < seen)) firstCustomerAt.set(row.roomId, row.firstCustomerAt);
  }
  const opened = rooms
    .map((room) => {
      const first = firstCustomerAt.get(room.id);
      const at = first && first < room.createdAt ? first : room.createdAt;
      return { room, at, imported: at !== room.createdAt };
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.room.id < b.room.id ? -1 : 1));

  const events: JourneyEvent[] = opened.map(({ room, at, imported }, index): JourneyEvent => ({
    id: `chatroom-${room.id}`, type: 'CHAT_ROOM_OPENED', group: 'chat', stage: index === 0 ? 'CONTACTED' : null, timestamp: at.toISOString(),
    title: `${index === 0 ? 'ทักแชทครั้งแรกทาง' : 'ทักเพิ่มทาง'} ${CHAT_CHANNEL_LABELS[room.channel] ?? room.channel}`,
    actor: { type: 'CUSTOMER' }, reliability: imported ? 'approximate' : 'exact', origin: 'SOURCE', href: `/inbox/${room.id}`, metadata: { channel: room.channel },
  }));
  for (const row of days) {
    const parts = [row.customer ? `ลูกค้า ${row.customer} ข้อความ` : '', row.staff ? `ร้านตอบ ${row.staff}` : '', row.bot ? `บอท ${row.bot}` : ''].filter(Boolean);
    events.push({
      id: `chatday-${row.roomId}-${row.day}`, type: 'CHAT_DAY', group: 'chat', stage: null, timestamp: row.lastAt.toISOString(), title: `คุยแชท: ${parts.join(' · ')}`, actor: null,
      // ข้อความทักทายอัตโนมัติ FB ถูกเก็บเป็น STAFF ⇒ จำนวนร้านเป็นค่าประมาณ
      reliability: row.staff > 0 ? 'approximate' : 'exact', origin: 'SOURCE', href: `/inbox/${row.roomId}`,
      metadata: { customerMessages: row.customer, staffMessages: row.staff, botMessages: row.bot },
    });
  }
  for (const todo of todos) {
    if (!todo.dueDate || !todo.roomId) continue;
    const href = `/inbox/${todo.roomId}`;
    events.push({ id: `appointment-${todo.id}`, type: 'APPOINTMENT', group: 'chat', stage: 'INTERESTED', timestamp: todo.createdAt.toISOString(), title: `นัดเข้าร้าน ${formatDateTime(todo.dueDate)}`, actor: staffActor(todo.createdBy), reliability: 'exact', origin: 'SOURCE', href });
    if (todo.completedAt) events.push({ id: `appointment-done-${todo.id}`, type: 'APPOINTMENT_DONE', group: 'chat', stage: 'INTERESTED', timestamp: todo.completedAt.toISOString(), title: 'มาตามนัดแล้ว', actor: { type: 'STAFF' }, reliability: 'exact', origin: 'SOURCE', href });
  }
  return events;
}

async function leadEvents(prisma: PrismaService, customerIds: string[], window: JourneyWindow): Promise<JourneyEvent[]> {
  const rows = await prisma.auditLog.findMany({
    where: { action: 'AI_LEAD_CAPTURED', entity: 'customer', entityId: { in: customerIds }, createdAt: dbTimeRange(window) },
    select: { id: true, createdAt: true, newValue: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: scanTake(window),
  });
  // newValue มีชื่อ เบอร์ ที่อยู่ — หยิบเฉพาะคีย์ที่ไม่ใช่ข้อมูลส่วนบุคคล
  return rows.map((row): JourneyEvent => {
    const value = asRecord(row.newValue);
    const packageChoice = typeof value.packageChoice === 'string' ? value.packageChoice : null;
    const downAmount = typeof value.downAmount === 'number' ? value.downAmount : null;
    const productId = typeof value.productId === 'string' ? value.productId : null;
    const title = ['บอทจดความสนใจ', packageChoice ? `แพ็ก ${packageChoice}` : '', downAmount !== null ? `ดาวน์ ${bahtText(downAmount)} บาท` : ''].filter(Boolean).join(' · ');
    return { id: `lead-${row.id}`, type: 'AI_LEAD_CAPTURED', group: 'chat', stage: 'INTERESTED', timestamp: row.createdAt.toISOString(), title, actor: { type: 'BOT' }, reliability: 'exact', origin: 'SOURCE', metadata: { packageChoice, downAmount, productId } };
  });
}

async function createdEvents(prisma: PrismaService, customerIds: string[]): Promise<JourneyEvent[]> {
  const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, createdAt: true, acquisitionSource: true } });
  return customers.filter((c) => !c.acquisitionSource?.startsWith(CHAT_SOURCE_PREFIX)).map((c): JourneyEvent => {
    const byBot = c.acquisitionSource === 'AI_CHAT';
    return {
      id: `customer-${c.id}`, type: byBot ? 'CUSTOMER_CREATED_BY_BOT' : 'CUSTOMER_CREATED_BY_STAFF', group: 'chat', stage: 'IDENTIFIED', timestamp: c.createdAt.toISOString(),
      title: byBot ? 'บอทบันทึกเป็นลูกค้าจากแชท' : 'พนักงานเพิ่มเป็นลูกค้า (หน้าร้าน)', actor: { type: byBot ? 'BOT' : 'STAFF' },
      reliability: 'approximate', origin: 'SOURCE', // revive-ghost / stub-upgrade ใช้ created_at เดิม
    };
  });
}

/** กลุ่ม chat · PDPA: ไม่อ่าน chat_messages.text · todo.title/description · เบอร์/ที่อยู่ใน audit */
export const chatSource: JourneySource = async (prisma, customerIds, window, actor) => {
  if (!JOURNEY_CHAT_ROLES.has(actor.role)) return [];
  const [rooms, leads, created] = await Promise.all([roomEvents(prisma, customerIds, actor), leadEvents(prisma, customerIds, window), createdEvents(prisma, customerIds)]);
  return finalizeSource([...rooms, ...leads, ...created], window);
};
```
Run เทส Step 4 → Expected: PASS 3 tests

- [ ] **Step 6: เทสแดง — `creditSource` + `saleSource`**

`sources/credit-sale.source.spec.ts`:
```ts
import type { JourneyEvent } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { creditSource } from './credit.source';
import { saleSource } from './sale.source';

const at = (iso: string) => new Date(iso);
const u1 = { id: 'u1', name: 'แนน' };
const u9 = { id: 'u9', name: 'เจ้าของ' };
const OWNER = { id: 'o1', role: 'OWNER' };
const byId = (events: JourneyEvent[], id: string) => events.find((e) => e.id === id);

function creditDb() {
  return {
    creditCheck: { findMany: jest.fn().mockResolvedValue([
      { id: 'cc-shop', createdAt: at('2026-09-01T03:00:00.000Z'), roomAnalysis: null },
      { id: 'cc-chat', createdAt: at('2026-09-02T03:00:00.000Z'), roomAnalysis: { roomId: 'r1' } },
    ]) },
    customerJourneyEntry: { findMany: jest.fn().mockResolvedValue([{ refId: 'cc-shop', actorUser: u1 }]) },
    roomCreditAnalysis: { findMany: jest.fn().mockResolvedValue([{ id: 'rca1', roomId: 'r1', createdAt: at('2026-09-02T02:00:00.000Z') }]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([{ id: 'al1', createdAt: at('2026-09-03T03:00:00.000Z'), newValue: { status: 'REJECTED', overrideReason: 'เบอร์ 0812345678' }, user: u9 }]) },
    creditApproval: { findMany: jest.fn().mockResolvedValue([{ id: 'ap1', createdAt: at('2026-09-04T03:00:00.000Z'), approvedMonthlyPayment: '4200.00', approvedBy: u9 }]) },
  };
}

describe('creditSource', () => {
  it('OWNER: เปิดตรวจ (ผู้เปิดจาก entry) · สเตทเม้นจากแชท · ผลตัดสิน · วงเงิน — ไม่คัด overrideReason', async () => {
    const events = await creditSource(creditDb() as unknown as PrismaService, ['c1'], { limit: 30 }, OWNER);
    expect(events.map((e) => e.id)).toEqual(['creditapproval-ap1', 'creditdecision-al1', 'credit-cc-chat', 'statement-rca1', 'credit-cc-shop']);
    expect(byId(events, 'credit-cc-shop')).toEqual({ id: 'credit-cc-shop', type: 'CREDIT_CHECK_OPENED', group: 'credit', stage: 'CREDIT', timestamp: '2026-09-01T03:00:00.000Z', title: 'เปิดตรวจเครดิต (ที่ร้าน)', actor: { type: 'STAFF', ...u1 }, reliability: 'exact', origin: 'SOURCE' });
    expect(byId(events, 'credit-cc-chat')).toMatchObject({ title: 'เปิดตรวจเครดิต (จากสเตทเม้นในแชท)', actor: null, reliability: 'approximate', href: '/inbox/r1' });
    expect(byId(events, 'statement-rca1')).toMatchObject({ type: 'CHAT_STATEMENT_ANALYZED', href: '/inbox/r1' });
    expect(byId(events, 'creditdecision-al1')).toMatchObject({ title: 'ไม่อนุมัติเครดิต', actor: { type: 'STAFF', ...u9 }, metadata: { status: 'REJECTED' } });
    expect(byId(events, 'creditapproval-ap1')).toMatchObject({ title: 'อนุมัติค่างวดไม่เกิน 4,200 บาท/เดือน' });
    expect(JSON.stringify(events)).not.toMatch(/0812345678|overrideReason/);
  });

  it('SALES ใช้ creditHistoryAccess + กติกาห้อง · ACCOUNTANT ไม่ดึงสเตทเม้นและไม่มีลิงก์แชท · ไม่มีผลตรวจ = ไม่ยิงต่อ', async () => {
    const sales = creditDb();
    await creditSource(sales as unknown as PrismaService, ['c1', 'p1'], { limit: 30 }, { id: 's1', role: 'SALES' });
    expect(sales.creditCheck.findMany.mock.calls[0][0].where.OR).toHaveLength(2);
    expect(sales.roomCreditAnalysis.findMany.mock.calls[0][0].where.room).toEqual({ is: { customerId: { in: ['c1', 'p1'] }, OR: [{ assignedToId: null }, { assignedToId: 's1' }] } });
    const accountant = creditDb();
    const events = await creditSource(accountant as unknown as PrismaService, ['c1'], { limit: 30 }, { id: 'a1', role: 'ACCOUNTANT' });
    expect(accountant.roomCreditAnalysis.findMany).not.toHaveBeenCalled();
    expect(accountant.creditCheck.findMany.mock.calls[0][0].where).toEqual({ customerId: { in: ['c1'] }, deletedAt: null, roomAnalysis: { is: null } });
    expect(events.filter((e) => e.href)).toEqual([]);
    const empty = creditDb();
    empty.creditCheck.findMany.mockResolvedValue([]);
    empty.roomCreditAnalysis.findMany.mockResolvedValue([]);
    await creditSource(empty as unknown as PrismaService, ['c1'], { limit: 30 }, OWNER);
    expect(empty.auditLog.findMany).not.toHaveBeenCalled();
    expect(empty.creditApproval.findMany).not.toHaveBeenCalled();
  });
});

function saleDb() {
  const sale = (o: Record<string, unknown>) => ({ financeCompany: null, contractId: null, saleSource: 'OFFLINE', deletedAt: null, salesperson: u1, voidedBy: null, product: null, netAmount: '30000.00', ...o });
  return {
    booking: { findMany: jest.fn().mockResolvedValue([
      { id: 'b1', bookingNumber: 'BK-1', status: 'CONVERTED', depositAmount: '1000.00', depositPaidAt: at('2026-09-01T05:00:00.000Z'), canceledAt: null, convertedAt: at('2026-09-02T02:00:00.000Z'), expireDate: at('2026-09-08T00:00:00.000Z'), createdAt: at('2026-09-01T03:00:00.000Z'), createdBy: u1, canceledBy: null },
      { id: 'b2', bookingNumber: 'BK-2', status: 'EXPIRED', depositAmount: '500.00', depositPaidAt: null, canceledAt: null, convertedAt: null, expireDate: at('2026-08-27T00:00:00.000Z'), createdAt: at('2026-08-20T03:00:00.000Z'), createdBy: u1, canceledBy: null },
    ]) },
    sale: { findMany: jest.fn().mockResolvedValue([
      sale({ id: 's1', saleNumber: 'SL-1', saleType: 'CASH', netAmount: '15900.00', createdAt: at('2026-09-02T03:00:00.000Z'), product: { brand: 'Apple', model: 'iPhone 15', storage: '128GB' } }),
      sale({ id: 's2', saleNumber: 'SL-2', saleType: 'EXTERNAL_FINANCE', financeCompany: 'GFIN', saleSource: 'ONLINE', createdAt: at('2026-09-03T03:00:00.000Z'), deletedAt: at('2026-09-04T03:00:00.000Z'), voidedBy: u9 }),
      sale({ id: 's3', saleNumber: 'SL-3', saleType: 'INSTALLMENT', contractId: 'k1', createdAt: at('2026-09-05T03:00:00.000Z') }),
      sale({ id: 's4', saleNumber: 'SL-4', saleType: 'INSTALLMENT', contractId: 'k2', createdAt: at('2026-02-01T05:00:00.000Z') }),
    ]) },
    contract: { findMany: jest.fn().mockResolvedValue([
      { id: 'k1', contractNumber: 'CT-1', status: 'ACTIVE', totalMonths: 12, monthlyPayment: '4200.00', createdAt: at('2026-09-04T03:00:00.000Z'), deletedAt: null, reviewedAt: at('2026-09-04T10:00:00.000Z'), workflowStatus: 'APPROVED', salesperson: u1, reviewedBy: u9 },
      { id: 'k2', contractNumber: 'CT-2', status: 'COMPLETED', totalMonths: 6, monthlyPayment: '5000.00', createdAt: at('2026-02-01T03:00:00.000Z'), deletedAt: null, reviewedAt: at('2026-02-01T10:00:00.000Z'), workflowStatus: 'REJECTED', salesperson: u1, reviewedBy: u9 },
      { id: 'k3', contractNumber: 'CT-3', status: 'DRAFT', totalMonths: 10, monthlyPayment: '3000.00', createdAt: at('2026-08-09T03:00:00.000Z'), deletedAt: at('2026-08-10T03:00:00.000Z'), reviewedAt: null, workflowStatus: 'CREATING', salesperson: u1, reviewedBy: null },
    ]) },
    signature: { findMany: jest.fn().mockResolvedValue([{ id: 'sig1', contractId: 'k1', signedAt: at('2026-09-04T11:00:00.000Z') }]) },
    customerJourneyEntry: { findMany: jest.fn().mockResolvedValue([{ kind: 'CONTRACT_ACTIVATED', refId: 'k2' }, { kind: 'CONTRACT_REVIEWED', refId: 'k2' }]) },
    payment: { findMany: jest.fn().mockResolvedValue([{ contractId: 'k2', paidDate: at('2026-08-31T04:00:00.000Z') }]) },
  };
}

describe('saleSource', () => {
  it('ใบจอง · ใบขาย · ยกเลิกใบขาย · สัญญา (ร่าง ตรวจ เซ็น เริ่มผ่อน ปิด) — ย้อนหลังข้ามเมื่อมี entry แล้ว', async () => {
    const db = saleDb();
    const events = await saleSource(db as unknown as PrismaService, ['c1'], { limit: 50 }, OWNER);
    expect(byId(events, 'booking-b1')).toMatchObject({ type: 'BOOKING_OPENED', stage: 'INTERESTED', title: 'เปิดใบจอง BK-1', actor: { type: 'STAFF', ...u1 } });
    expect(byId(events, 'booking-deposit-b1')).toMatchObject({ title: 'รับมัดจำ 1,000 บาท · BK-1' });
    expect(byId(events, 'booking-convert-b1')).toMatchObject({ title: 'แปลงใบจอง BK-1 เป็นใบขาย' });
    expect(byId(events, 'booking-expire-b2')).toMatchObject({ timestamp: '2026-08-27T00:00:00.000Z', title: 'ใบจอง BK-2 หมดอายุ', reliability: 'approximate' });
    expect(byId(events, 'sale-s1')).toMatchObject({ type: 'SALE_CASH', stage: 'PURCHASED', title: 'ซื้อเงินสด Apple iPhone 15 128GB 15,900 บาท', metadata: { saleNumber: 'SL-1' } });
    expect(byId(events, 'sale-s2')).toMatchObject({ type: 'SALE_EXTERNAL_FINANCE', title: 'ซื้อผ่านไฟแนนซ์ GFIN', actor: { type: 'SYSTEM', name: 'ออนไลน์' } });
    expect(byId(events, 'sale-void-s2')).toMatchObject({ type: 'SALE_VOIDED', title: 'ยกเลิกใบขาย SL-2', actor: { type: 'STAFF', ...u9 } });
    expect(byId(events, 'contract-k3')).toMatchObject({ title: 'ร่างสัญญาผ่อน CT-3 · ลบร่างแล้ว' });
    expect(byId(events, 'contract-k3')).not.toHaveProperty('href');
    expect(byId(events, 'contract-review-k1')).toMatchObject({ title: 'อนุมัติสัญญา CT-1', reliability: 'approximate', href: '/contracts/k1' });
    expect(byId(events, 'contract-review-k2')).toBeUndefined();
    expect(byId(events, 'signature-sig1')).toMatchObject({ title: 'ลูกค้าเซ็นสัญญา CT-1', actor: { type: 'CUSTOMER' } });
    expect(byId(events, 'activated-k1')).toMatchObject({ stage: 'PURCHASED', timestamp: '2026-09-05T03:00:00.000Z', title: 'เริ่มผ่อนสัญญา CT-1 · 12 งวด งวดละ 4,200 บาท', reliability: 'approximate' });
    expect(byId(events, 'activated-k2')).toBeUndefined();
    expect(byId(events, 'contract-end-k2')).toMatchObject({ timestamp: '2026-08-31T04:00:00.000Z', title: 'ปิดสัญญา CT-2: ผ่อนครบ' });
    expect(db.sale.findMany.mock.calls[0][0].select).not.toHaveProperty('voidReason');
    expect(db.signature.findMany.mock.calls[0][0].select).toEqual({ id: true, contractId: true, signedAt: true });
    expect(db.payment.findMany.mock.calls[0][0].where).toEqual({ contractId: { in: ['k2'] }, deletedAt: null, paidDate: { not: null } });
  });

  it('ไม่มีสัญญา → ไม่ยิงลายเซ็น/entry/งวด · คืนไม่เกิน limit+1', async () => {
    const db = saleDb();
    db.contract.findMany.mockResolvedValue([]);
    expect(await saleSource(db as unknown as PrismaService, ['c1'], { limit: 2 }, OWNER)).toHaveLength(3);
    expect(db.signature.findMany).not.toHaveBeenCalled();
    expect(db.customerJourneyEntry.findMany).not.toHaveBeenCalled();
    expect(db.payment.findMany).not.toHaveBeenCalled();
  });
});
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/sources/credit-sale.source.spec.ts --runInBand` → Expected: FAIL `Cannot find module './credit.source'`

- [ ] **Step 7: `credit.source.ts` + `sale.source.ts`**

`sources/credit.source.ts`:
```ts
import type { JourneyEvent } from '@installment/shared';
import { creditHistoryAccess, roomAssignmentScope } from '../../credit-check/services/room-credit-access';
import { JOURNEY_CHAT_ROLES, asRecord, bahtText, dbTimeRange, finalizeSource, scanTake, staffActor, whenAny, type JourneySource } from './journey-window';

const DECISION_TITLES: Record<string, string> = { APPROVED: 'อนุมัติเครดิต', REJECTED: 'ไม่อนุมัติเครดิต', MANUAL_REVIEW: 'ส่งตรวจเครดิตเพิ่ม', PENDING: 'ตั้งผลเครดิตกลับเป็นรอตรวจ' };

/** กลุ่ม credit · สิทธิ์ creditHistoryAccess · ไม่อ่าน aiAnalysis/statementFiles · ไม่คัด overrideReason/evidenceNotes */
export const creditSource: JourneySource = async (prisma, customerIds, window, actor) => {
  const range = dbTimeRange(window);
  const take = scanTake(window);
  const seesChat = JOURNEY_CHAT_ROLES.has(actor.role);
  const checks = await prisma.creditCheck.findMany({
    where: { customerId: { in: customerIds }, deletedAt: null, ...creditHistoryAccess(actor) },
    select: { id: true, createdAt: true, roomAnalysis: { select: { roomId: true } } },
  });
  const checkIds = checks.map((check) => check.id);
  const newestFirst = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
  const [openers, analyses, decisions, approvals] = await Promise.all([
    whenAny(checkIds, () => prisma.customerJourneyEntry.findMany({ where: { kind: 'CREDIT_CHECK_OPENED_BY', refId: { in: checkIds }, deletedAt: null }, select: { refId: true, actorUser: { select: { id: true, name: true } } } })),
    whenAny(seesChat ? customerIds : [], () => prisma.roomCreditAnalysis.findMany({
      where: { status: 'COMPLETED', deletedAt: null, createdAt: range, room: { is: { customerId: { in: customerIds }, ...roomAssignmentScope(actor) } } },
      select: { id: true, roomId: true, createdAt: true }, orderBy: newestFirst, take,
    })),
    whenAny(checkIds, () => prisma.auditLog.findMany({ where: { action: 'CREDIT_CHECK_OVERRIDE', entity: 'credit_check', entityId: { in: checkIds }, createdAt: range }, select: { id: true, createdAt: true, newValue: true, user: { select: { id: true, name: true } } }, orderBy: newestFirst, take })),
    whenAny(checkIds, () => prisma.creditApproval.findMany({ where: { creditCheckId: { in: checkIds }, deletedAt: null, createdAt: range }, select: { id: true, createdAt: true, approvedMonthlyPayment: true, approvedBy: { select: { id: true, name: true } } }, orderBy: newestFirst, take })),
  ]);
  const openerOf = new Map(openers.map((row) => [row.refId, row.actorUser] as const));
  const events: JourneyEvent[] = checks.map((check): JourneyEvent => {
    const roomId = check.roomAnalysis?.roomId;
    const opener = openerOf.get(check.id);
    return {
      id: `credit-${check.id}`, type: 'CREDIT_CHECK_OPENED', group: 'credit', stage: 'CREDIT', timestamp: check.createdAt.toISOString(),
      title: roomId ? 'เปิดตรวจเครดิต (จากสเตทเม้นในแชท)' : 'เปิดตรวจเครดิต (ที่ร้าน)',
      actor: opener ? staffActor(opener) : null, // ผู้เปิดมีตั้งแต่ entry CREDIT_CHECK_OPENED_BY ขึ้น prod
      reliability: roomId ? 'approximate' : 'exact', origin: 'SOURCE', // นำเข้าจากแชท created_at ย้อนเป็นเวลา OCR
      ...(roomId && seesChat ? { href: `/inbox/${roomId}` } : {}),
    };
  });
  for (const a of analyses) events.push({ id: `statement-${a.id}`, type: 'CHAT_STATEMENT_ANALYZED', group: 'credit', stage: 'CREDIT', timestamp: a.createdAt.toISOString(), title: 'วิเคราะห์สเตทเม้นจากแชทแล้ว', actor: { type: 'STAFF' }, reliability: 'exact', origin: 'SOURCE', href: `/inbox/${a.roomId}` });
  for (const d of decisions) {
    const status = String(asRecord(d.newValue).status ?? '');
    events.push({ id: `creditdecision-${d.id}`, type: 'CREDIT_DECISION', group: 'credit', stage: 'CREDIT', timestamp: d.createdAt.toISOString(), title: DECISION_TITLES[status] ?? 'ปรับผลตรวจเครดิต', actor: staffActor(d.user), reliability: 'exact', origin: 'SOURCE', metadata: { status } });
  }
  for (const ap of approvals) events.push({ id: `creditapproval-${ap.id}`, type: 'CREDIT_LIMIT_APPROVED', group: 'credit', stage: 'CREDIT', timestamp: ap.createdAt.toISOString(), title: `อนุมัติค่างวดไม่เกิน ${bahtText(ap.approvedMonthlyPayment)} บาท/เดือน`, actor: staffActor(ap.approvedBy), reliability: 'exact', origin: 'SOURCE' });
  return finalizeSource(events, window);
};
```
`sources/sale.source.ts`:
```ts
import type { JourneyEvent } from '@installment/shared';
import { bahtText, finalizeSource, staffActor, whenAny, type JourneySource } from './journey-window';

const productLabel = (p: { brand: string | null; model: string | null; storage: string | null } | null) => (p ? [p.brand, p.model, p.storage].filter(Boolean).join(' ') : '');
const base = { group: 'sale', origin: 'SOURCE' } as const;

/** กลุ่ม sale · เอกสารต่อคนหลักหน่วย ดึงหมดแล้วตัดใน finalizeSource · ไม่คัด notes/voidReason/reviewNotes · ไม่ select ลายเซ็น */
export const saleSource: JourneySource = async (prisma, customerIds, window) => {
  const who = { select: { id: true, name: true } };
  const [bookings, sales, contracts] = await Promise.all([
    prisma.booking.findMany({ where: { customerId: { in: customerIds }, deletedAt: null }, select: { id: true, bookingNumber: true, status: true, depositAmount: true, depositPaidAt: true, canceledAt: true, convertedAt: true, expireDate: true, createdAt: true, createdBy: who, canceledBy: who } }),
    prisma.sale.findMany({ where: { customerId: { in: customerIds } }, select: { id: true, saleNumber: true, saleType: true, netAmount: true, financeCompany: true, contractId: true, saleSource: true, createdAt: true, deletedAt: true, salesperson: who, voidedBy: who, product: { select: { brand: true, model: true, storage: true } } } }),
    prisma.contract.findMany({ where: { customerId: { in: customerIds } }, select: { id: true, contractNumber: true, status: true, totalMonths: true, monthlyPayment: true, createdAt: true, deletedAt: true, reviewedAt: true, workflowStatus: true, salesperson: who, reviewedBy: who } }),
  ]);
  const contractIds = contracts.map((c) => c.id);
  const endedIds = contracts.filter((c) => !c.deletedAt && (c.status === 'COMPLETED' || c.status === 'EARLY_PAYOFF')).map((c) => c.id);
  const [signatures, logged, lastPaid] = await Promise.all([
    whenAny(contractIds, () => prisma.signature.findMany({ where: { contractId: { in: contractIds }, signerType: 'CUSTOMER', deletedAt: null }, select: { id: true, contractId: true, signedAt: true } })),
    whenAny(contractIds, () => prisma.customerJourneyEntry.findMany({ where: { kind: { in: ['CONTRACT_ACTIVATED', 'CONTRACT_REVIEWED'] }, refId: { in: contractIds } }, select: { kind: true, refId: true } })),
    whenAny(endedIds, () => prisma.payment.findMany({ where: { contractId: { in: endedIds }, deletedAt: null, paidDate: { not: null } }, orderBy: [{ contractId: 'asc' }, { paidDate: 'desc' }], distinct: ['contractId'], select: { contractId: true, paidDate: true } })),
  ]);
  const hasEntry = new Set(logged.map((e) => `${e.kind}:${e.refId}`));
  const contractOf = new Map(contracts.map((c) => [c.id, c]));
  const events: JourneyEvent[] = [];

  for (const b of bookings) {
    const no = b.bookingNumber;
    events.push({ ...base, id: `booking-${b.id}`, type: 'BOOKING_OPENED', stage: 'INTERESTED', timestamp: b.createdAt.toISOString(), title: `เปิดใบจอง ${no}`, actor: staffActor(b.createdBy), reliability: 'exact' });
    if (b.depositPaidAt) events.push({ ...base, id: `booking-deposit-${b.id}`, type: 'BOOKING_DEPOSIT_PAID', stage: 'INTERESTED', timestamp: b.depositPaidAt.toISOString(), title: `รับมัดจำ ${bahtText(b.depositAmount)} บาท · ${no}`, actor: { type: 'STAFF' }, reliability: 'exact' });
    if (b.canceledAt) events.push({ ...base, id: `booking-cancel-${b.id}`, type: 'BOOKING_CANCELED', stage: null, timestamp: b.canceledAt.toISOString(), title: `ยกเลิกใบจอง ${no}`, actor: staffActor(b.canceledBy), reliability: 'exact' });
    if (b.convertedAt) events.push({ ...base, id: `booking-convert-${b.id}`, type: 'BOOKING_CONVERTED', stage: 'INTERESTED', timestamp: b.convertedAt.toISOString(), title: `แปลงใบจอง ${no} เป็นใบขาย`, actor: { type: 'STAFF' }, reliability: 'exact' });
    if (b.status === 'EXPIRED') events.push({ ...base, id: `booking-expire-${b.id}`, type: 'BOOKING_EXPIRED', stage: null, timestamp: b.expireDate.toISOString(), title: `ใบจอง ${no} หมดอายุ`, actor: { type: 'SYSTEM' }, reliability: 'approximate' });
  }
  for (const s of sales) {
    if (s.saleType === 'CASH' || s.saleType === 'EXTERNAL_FINANCE') {
      const cash = s.saleType === 'CASH';
      const product = productLabel(s.product);
      events.push({
        ...base, id: `sale-${s.id}`, type: cash ? 'SALE_CASH' : 'SALE_EXTERNAL_FINANCE', stage: 'PURCHASED', timestamp: s.createdAt.toISOString(),
        title: (cash ? ['ซื้อเงินสด', product, `${bahtText(s.netAmount)} บาท`] : ['ซื้อผ่านไฟแนนซ์', s.financeCompany, product]).filter(Boolean).join(' '),
        actor: s.saleSource === 'ONLINE' ? { type: 'SYSTEM', name: 'ออนไลน์' } : staffActor(s.salesperson), reliability: 'exact', metadata: { saleNumber: s.saleNumber },
      });
    }
    const activated = s.saleType === 'INSTALLMENT' && s.contractId && !hasEntry.has(`CONTRACT_ACTIVATED:${s.contractId}`) ? contractOf.get(s.contractId) : undefined;
    // ใบขาย INSTALLMENT สร้างใน tx เดียวกับ activate — ใกล้จริงแต่ไม่ใช่เวลาเปิดใช้
    if (activated) events.push({ ...base, id: `activated-${activated.id}`, type: 'CONTRACT_ACTIVATED', stage: 'PURCHASED', timestamp: s.createdAt.toISOString(), title: `เริ่มผ่อนสัญญา ${activated.contractNumber} · ${activated.totalMonths} งวด งวดละ ${bahtText(activated.monthlyPayment)} บาท`, actor: staffActor(s.salesperson), reliability: 'approximate', href: `/contracts/${activated.id}` });
    if (s.deletedAt) events.push({ ...base, id: `sale-void-${s.id}`, type: 'SALE_VOIDED', stage: null, timestamp: s.deletedAt.toISOString(), title: `ยกเลิกใบขาย ${s.saleNumber}`, actor: staffActor(s.voidedBy), reliability: 'exact' });
  }
  for (const c of contracts) {
    const link = c.deletedAt ? {} : { href: `/contracts/${c.id}` };
    events.push({ ...base, ...link, id: `contract-${c.id}`, type: 'CONTRACT_DRAFTED', stage: 'CREDIT', timestamp: c.createdAt.toISOString(), title: `ร่างสัญญาผ่อน ${c.contractNumber}${c.deletedAt ? ' · ลบร่างแล้ว' : ''}`, actor: staffActor(c.salesperson), reliability: 'exact' });
    // reviewed_at/workflowStatus ถูกเขียนทับ เหลือรอบล่าสุด ⇒ approximate
    if (c.reviewedAt && !hasEntry.has(`CONTRACT_REVIEWED:${c.id}`)) events.push({ ...base, ...link, id: `contract-review-${c.id}`, type: 'CONTRACT_REVIEWED', stage: 'CREDIT', timestamp: c.reviewedAt.toISOString(), title: `${c.workflowStatus === 'REJECTED' ? 'ตีกลับสัญญา' : 'อนุมัติสัญญา'} ${c.contractNumber}`, actor: staffActor(c.reviewedBy), reliability: 'approximate' });
  }
  for (const sig of signatures) {
    const c = contractOf.get(sig.contractId);
    if (c) events.push({ ...base, id: `signature-${sig.id}`, type: 'CONTRACT_SIGNED', stage: 'CREDIT', timestamp: sig.signedAt.toISOString(), title: `ลูกค้าเซ็นสัญญา ${c.contractNumber}`, actor: { type: 'CUSTOMER' }, reliability: 'exact', href: `/contracts/${c.id}` });
  }
  for (const row of lastPaid) {
    const c = contractOf.get(row.contractId);
    if (c && row.paidDate) events.push({ ...base, id: `contract-end-${c.id}`, type: 'CONTRACT_ENDED', stage: null, timestamp: row.paidDate.toISOString(), title: `ปิดสัญญา ${c.contractNumber}: ${c.status === 'EARLY_PAYOFF' ? 'ปิดก่อนกำหนด' : 'ผ่อนครบ'}`, actor: { type: 'SYSTEM' }, reliability: 'approximate', href: `/contracts/${c.id}` });
  }
  return finalizeSource(events, window);
};
```
Run เทส Step 6 → Expected: PASS 4 tests

- [ ] **Step 8: เทสแดง — payment · collections · service · points**

`sources/contract-service-points.source.spec.ts`:
```ts
import type { PrismaService } from '../../../prisma/prisma.service';
import { contractEventSources } from '../../overdue/contract-event-sources';
import { collectionsSource } from './collections.source';
import { paymentSource } from './payment.source';
import { pointsSource } from './points.source';
import { serviceSource } from './service.source';

jest.mock('../../overdue/contract-event-sources', () => ({ contractEventSources: jest.fn() }));

const at = (iso: string) => new Date(iso);
const OWNER = { id: 'o1', role: 'OWNER' };
const CALL = { id: 'call-1', type: 'CALL', timestamp: '2026-09-10T07:32:00.000Z', title: 'นัดชำระ', subtitle: 'แนน', metadata: { result: 'PROMISED', notes: 'โทร 0812345678', voiceMemoUrl: 'https://s/m.webm' } };
const ROWS = [
  { contractId: 'k1', actorUserId: 'u-nan', event: CALL },
  { contractId: 'k2', actorUserId: 'u-fin', event: { id: 'payment-1', type: 'PAYMENT', timestamp: '2026-09-09T03:00:00.000Z', title: 'ชำระ 4,200 ฿ (งวด 6)', metadata: { amount: '4200', method: 'TRANSFER' } } },
  { contractId: 'k1', actorUserId: null, event: { id: 'dunning-1', type: 'DUNNING_ACTION', timestamp: '2026-09-08T03:00:00.000Z', title: 'ส่ง LINE: เตือนก่อนครบกำหนด', subtitle: 'คุณสมชาย โทร 0812345678', metadata: { status: 'SENT', channel: 'LINE' } } },
  { contractId: 'k1', actorUserId: 'u-owner', event: { id: 'audit-1', type: 'STATUS_CHANGE', timestamp: '2026-09-06T00:00:00.000Z', title: 'สถานะสัญญาเปลี่ยน: ACTIVE → OVERDUE', metadata: { action: 'STATUS_CHANGE', newValue: { address: 'บ้านเลขที่ 1' } } } },
  { contractId: 'k1', actorUserId: null, event: { id: 'future-1', type: 'NEW_KIND', timestamp: '2026-09-04T00:00:00.000Z', title: 'ชนิดใหม่' } },
  { contractId: 'k-gone', actorUserId: null, event: { id: 'payment-orphan', type: 'PAYMENT', timestamp: '2026-09-03T00:00:00.000Z', title: 'ชำระ 1 ฿ (งวด 1)' } },
] as unknown as Awaited<ReturnType<typeof contractEventSources>>;

describe('paymentSource / collectionsSource', () => {
  const prisma = { contract: { findMany: jest.fn() } };
  const db = prisma as unknown as PrismaService;
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.contract.findMany.mockResolvedValue([{ id: 'k1', contractNumber: 'CT-2569-0042' }, { id: 'k2', contractNumber: 'CT-2569-0043' }]);
    jest.mocked(contractEventSources).mockResolvedValue(ROWS);
  });

  it('payment: เรียก contractEventSources ครั้งเดียวด้วยทุกสัญญาที่ไม่ใช่ร่าง + window (limit = scanTake) · เลขสัญญาจาก row.contractId · ผู้บันทึกจาก row.actorUserId · approximate', async () => {
    await expect(paymentSource(db, ['c1', 'p1'], { limit: 30 }, OWNER)).resolves.toEqual([
      { id: 'payment-1', type: 'PAYMENT_RECEIVED', group: 'payment', stage: null, timestamp: '2026-09-09T03:00:00.000Z', title: 'ชำระ 4,200 ฿ (งวด 6) · CT-2569-0043', actor: { type: 'STAFF', id: 'u-fin' }, reliability: 'approximate', origin: 'SOURCE', href: '/contracts/k2', metadata: { amount: '4200', method: 'TRANSFER' } },
    ]);
    expect(prisma.contract.findMany).toHaveBeenCalledWith({ where: { customerId: { in: ['c1', 'p1'] }, deletedAt: null, status: { not: 'DRAFT' } }, select: { id: true, contractNumber: true } });
    expect(contractEventSources).toHaveBeenCalledTimes(1);
    expect(contractEventSources).toHaveBeenCalledWith(db, ['k1', 'k2'], { before: undefined, from: undefined, to: undefined, limit: 231 });
  });

  it('cursor/from/to ส่งต่อถึง contractEventSources · ไม่มีสัญญา → ไม่ยิง', async () => {
    const window = { limit: 10, before: { ts: '2026-09-09T03:00:00.000Z', id: 'payment-9' }, from: new Date('2026-09-01T00:00:00.000Z'), to: new Date('2026-09-30T00:00:00.000Z') };
    await collectionsSource(db, ['c1'], window, OWNER);
    expect(contractEventSources).toHaveBeenCalledWith(db, ['k1', 'k2'], { before: window.before, from: window.from, to: window.to, limit: 211 });
    jest.clearAllMocks();
    prisma.contract.findMany.mockResolvedValue([]);
    await expect(paymentSource(db, ['c1'], { limit: 30 }, OWNER)).resolves.toEqual([]);
    expect(contractEventSources).not.toHaveBeenCalled();
  });

  it('collections: ตัดข้อความที่ส่ง โน้ต เสียง newValue และชนิดที่ไม่รู้จัก · ผู้โทรมี id จาก row · SALES ได้ [] ทั้งสองกลุ่ม', async () => {
    const events = await collectionsSource(db, ['c1'], { limit: 30 }, OWNER);
    expect(events.map((e) => e.type)).toEqual(['COLLECTION_CALL', 'COLLECTION_DUNNING', 'CONTRACT_STATUS_CHANGE']);
    expect(events[0]).toMatchObject({ title: 'โทรติดตาม: นัดชำระ · CT-2569-0042', actor: { type: 'STAFF', id: 'u-nan', name: 'แนน' }, metadata: { result: 'PROMISED' } });
    expect(events[1]).not.toHaveProperty('subtitle');
    expect(events[2].metadata).toEqual({ action: 'STATUS_CHANGE' });
    expect(JSON.stringify(events)).not.toMatch(/0812345678|voiceMemoUrl|notes|newValue|บ้านเลขที่|คุณสมชาย|ชนิดใหม่/);
    jest.clearAllMocks();
    await expect(paymentSource(db, ['c1'], { limit: 30 }, { id: 's1', role: 'SALES' })).resolves.toEqual([]);
    await expect(collectionsSource(db, ['c1'], { limit: 30 }, { id: 's1', role: 'SALES' })).resolves.toEqual([]);
    expect(prisma.contract.findMany).not.toHaveBeenCalled();
  });
});

describe('serviceSource / pointsSource', () => {
  it('ใบซ่อม + ประวัติสถานะ ลิงก์ /insurance/:id ไม่อ่านอาการเสีย/โน้ต/IMEI · แต้ม/แลกแต้ม ส่งช่วงเวลาไป DB', async () => {
    const prisma = {
      repairTicket: { findMany: jest.fn().mockResolvedValue([{ id: 't1', ticketNumber: 'RT-0001', deviceBrand: 'Apple', deviceModel: 'iPhone 15', createdAt: at('2026-09-01T03:00:00.000Z'), createdBy: { id: 'u1', name: 'แนน' },
        statusLogs: [{ id: 'l1', toStatus: 'READY_FOR_PICKUP', createdAt: at('2026-09-05T03:00:00.000Z'), changedBy: { id: 'u2', name: 'บอย' } }] }]) },
      loyaltyPoint: { findMany: jest.fn().mockResolvedValue([{ id: 'lp1', points: 42, reason: 'ON_TIME_PAYMENT', createdAt: at('2026-09-05T03:00:00.000Z'), contract: { contractNumber: 'CT-2569-0042' } }]) },
      loyaltyRedemption: { findMany: jest.fn().mockResolvedValue([{ id: 'lr1', points: 100, discountAmount: '100.00', createdAt: at('2026-09-06T03:00:00.000Z') }]) },
    };
    const db = prisma as unknown as PrismaService;
    const service = await serviceSource(db, ['c1'], { limit: 30 }, OWNER);
    expect(service.map((e) => [e.id, e.title, e.href])).toEqual([
      ['repairlog-l1', 'ใบซ่อม RT-0001: รอลูกค้ารับ', '/insurance/t1'],
      ['repair-t1', 'เปิดใบซ่อม/เคลม RT-0001 · Apple iPhone 15', '/insurance/t1'],
    ]);
    const select = prisma.repairTicket.findMany.mock.calls[0][0].select;
    for (const field of ['defectDescription', 'notes', 'deviceImei', 'deviceSerial']) expect(select).not.toHaveProperty(field);
    const points = await pointsSource(db, ['c1'], { limit: 2, before: { ts: '2026-09-10T00:00:00.000Z', id: 'zzz' } }, OWNER);
    expect(points.map((e) => [e.id, e.title, e.group])).toEqual([
      ['redeem-lr1', 'แลกแต้ม 100 แต้ม เป็นส่วนลด 100 บาท', 'points'],
      ['points-lp1', 'ได้แต้ม 42 แต้ม (จ่ายตรงเวลา · CT-2569-0042)', 'points'],
    ]);
    expect(prisma.loyaltyPoint.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: { in: ['c1'] }, deletedAt: null, createdAt: { lte: new Date('2026-09-10T00:00:00.000Z') } }, take: 203 }));
    expect(prisma.loyaltyRedemption.findMany.mock.calls[0][0].select).not.toHaveProperty('reason');
  });
});
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/sources/contract-service-points.source.spec.ts --runInBand` → Expected: FAIL `Cannot find module './collections.source'`

- [ ] **Step 9: 5 ไฟล์แหล่ง**

`sources/contract-timeline.ts`:
```ts
import type { PrismaService } from '../../../prisma/prisma.service';
import { contractEventSources, type TimelineEvent } from '../../overdue/contract-event-sources';
import { scanTake, type JourneyWindow } from './journey-window';

export interface CustomerContractEvent {
  contract: { id: string; contractNumber: string };
  /** ผู้โทร / ผู้บันทึกรับชำระ / ผู้ส่งหนังสือ — null เมื่อระบบทำเอง */
  actorUserId: string | null;
  /** รูปเดียวกับหน้า Collections — 🚨 ห้ามส่ง subtitle/metadata ดิบต่อ (มี callLog.notes / messageContent) */
  event: TimelineEvent;
}

/**
 * event ของทุกสัญญาที่ไม่ใช่ร่างของลูกค้าชุดนี้ — เรียก contractEventSources ครั้งเดียวด้วย contractIds ทั้งหมด + window
 * (cursor/from/to ลงไปถึง SQL และ limit = scanTake ต่อตารางต้นทาง) หน้าหลัง ๆ จึงไม่หยุดที่ 50 แถวต่อสัญญา และไม่มี N+1
 * แถวคืนมาไม่ได้เรียงข้ามตาราง — finalizeSource ของผู้เรียกเรียงเอง
 */
export async function customerContractEvents(prisma: PrismaService, customerIds: string[], window: JourneyWindow): Promise<CustomerContractEvent[]> {
  const contracts = await prisma.contract.findMany({ where: { customerId: { in: customerIds }, deletedAt: null, status: { not: 'DRAFT' } }, select: { id: true, contractNumber: true } });
  if (!contracts.length) return [];
  const byId = new Map(contracts.map((contract) => [contract.id, contract] as const));
  const rows = await contractEventSources(prisma, contracts.map((contract) => contract.id), {
    before: window.before,
    from: window.from,
    to: window.to,
    limit: scanTake(window),
  });
  return rows.flatMap((row) => {
    const contract = byId.get(row.contractId);
    return contract ? [{ contract, actorUserId: row.actorUserId, event: row.event }] : [];
  });
}
```
`sources/payment.source.ts`:
```ts
import type { JourneyEvent } from '@installment/shared';
import { customerContractEvents } from './contract-timeline';
import { finalizeSource, pickMetadata, type JourneySource } from './journey-window';

/** SALES ไม่เห็น (รอเจ้าของเคาะ ข้อ 5) · เวลาอิง payments.updated_at จนกว่า PR paidDate */
export const paymentSource: JourneySource = async (prisma, customerIds, window, actor) => {
  if (actor.role === 'SALES') return [];
  const events: JourneyEvent[] = [];
  for (const { contract, actorUserId, event } of await customerContractEvents(prisma, customerIds, window)) {
    if (event.type !== 'PAYMENT') continue;
    events.push({
      id: event.id, type: 'PAYMENT_RECEIVED', group: 'payment', stage: null, timestamp: event.timestamp, title: `${event.title} · ${contract.contractNumber}`,
      actor: actorUserId ? { type: 'STAFF', id: actorUserId } : null, reliability: 'approximate', origin: 'SOURCE', href: `/contracts/${contract.id}`,
      metadata: pickMetadata(event.metadata, ['amount', 'method']),
    });
  }
  return finalizeSource(events, window);
};
```
`sources/collections.source.ts`:
```ts
import type { JourneyEvent } from '@installment/shared';
import { customerContractEvents } from './contract-timeline';
import { finalizeSource, pickMetadata, type JourneySource } from './journey-window';

const VIEWS: Record<string, { type: string; keys: readonly string[]; actorType: 'STAFF' | 'SYSTEM' }> = {
  CALL: { type: 'COLLECTION_CALL', keys: ['result'], actorType: 'STAFF' },
  DUNNING_ACTION: { type: 'COLLECTION_DUNNING', keys: ['status', 'channel'], actorType: 'SYSTEM' },
  STATUS_CHANGE: { type: 'CONTRACT_STATUS_CHANGE', keys: ['action'], actorType: 'SYSTEM' },
  MDM: { type: 'COLLECTION_MDM', keys: ['action'], actorType: 'STAFF' },
  LETTER: { type: 'COLLECTION_LETTER', keys: ['status', 'letterNumber'], actorType: 'STAFF' },
};

/** PDPA: ไม่คัด subtitle (DUNNING = messageContent) · metadata เฉพาะคีย์ใน VIEWS · ชนิดที่ไม่รู้จักถูกทิ้ง */
export const collectionsSource: JourneySource = async (prisma, customerIds, window, actor) => {
  if (actor.role === 'SALES') return [];
  const events: JourneyEvent[] = [];
  for (const { contract, actorUserId, event } of await customerContractEvents(prisma, customerIds, window)) {
    const view = VIEWS[event.type];
    if (!view) continue;
    const isCall = event.type === 'CALL';
    events.push({
      id: event.id, type: view.type, group: 'collections', stage: null, timestamp: event.timestamp,
      title: `${isCall ? `โทรติดตาม: ${event.title}` : event.title} · ${contract.contractNumber}`,
      // subtitle ของ CALL = ชื่อผู้โทร (ไม่ใช่ข้อความ) · id ผู้โทรมาจาก row.actorUserId
      actor: isCall && event.subtitle ? { type: 'STAFF', ...(actorUserId ? { id: actorUserId } : {}), name: event.subtitle } : { type: view.actorType },
      reliability: 'exact', origin: 'SOURCE', href: `/contracts/${contract.id}`, metadata: pickMetadata(event.metadata, view.keys),
    });
  }
  return finalizeSource(events, window);
};
```
`sources/service.source.ts`:
```ts
import type { JourneyEvent } from '@installment/shared';
import { finalizeSource, staffActor, type JourneySource } from './journey-window';

/** ชุดเดียวกับ apps/web/src/pages/insurance/components/RepairStatusBadge.tsx:11-18 */
const REPAIR_STATUS_LABELS: Record<string, string> = { OPEN: 'รับเข้า', IN_PROGRESS: 'กำลังซ่อม', READY_FOR_PICKUP: 'รอลูกค้ารับ', CLOSED: 'คืนแล้ว', REPLACED: 'เปลี่ยนแล้ว', CANCELLED: 'ยกเลิก' };

/** ไม่คัด defectDescription / notes / IMEI / serial */
export const serviceSource: JourneySource = async (prisma, customerIds, window) => {
  const who = { select: { id: true, name: true } };
  const tickets = await prisma.repairTicket.findMany({
    where: { customerId: { in: customerIds }, deletedAt: null },
    select: { id: true, ticketNumber: true, deviceBrand: true, deviceModel: true, createdAt: true, createdBy: who, statusLogs: { select: { id: true, toStatus: true, createdAt: true, changedBy: who } } },
  });
  const events: JourneyEvent[] = [];
  for (const t of tickets) {
    const device = [t.deviceBrand, t.deviceModel].filter(Boolean).join(' ');
    const common = { group: 'service', stage: null, reliability: 'exact', origin: 'SOURCE', href: `/insurance/${t.id}` } as const;
    events.push({ ...common, id: `repair-${t.id}`, type: 'REPAIR_TICKET', timestamp: t.createdAt.toISOString(), title: `เปิดใบซ่อม/เคลม ${t.ticketNumber}${device ? ` · ${device}` : ''}`, actor: staffActor(t.createdBy) });
    for (const log of t.statusLogs) events.push({ ...common, id: `repairlog-${log.id}`, type: 'REPAIR_STATUS', timestamp: log.createdAt.toISOString(), title: `ใบซ่อม ${t.ticketNumber}: ${REPAIR_STATUS_LABELS[log.toStatus] ?? log.toStatus}`, actor: staffActor(log.changedBy) });
  }
  return finalizeSource(events, window);
};
```
`sources/points.source.ts`:
```ts
import type { JourneyEvent } from '@installment/shared';
import { bahtText, dbTimeRange, finalizeSource, scanTake, type JourneySource } from './journey-window';

const POINT_REASONS: Record<string, string> = { ON_TIME_PAYMENT: 'จ่ายตรงเวลา' };

/** ไม่คัด reason ของการแลกแต้ม (ข้อความอิสระ) */
export const pointsSource: JourneySource = async (prisma, customerIds, window) => {
  const where = { customerId: { in: customerIds }, deletedAt: null, createdAt: dbTimeRange(window) };
  const orderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
  const take = scanTake(window);
  const [points, redemptions] = await Promise.all([
    prisma.loyaltyPoint.findMany({ where, select: { id: true, points: true, reason: true, createdAt: true, contract: { select: { contractNumber: true } } }, orderBy, take }),
    prisma.loyaltyRedemption.findMany({ where, select: { id: true, points: true, discountAmount: true, createdAt: true }, orderBy, take }),
  ]);
  const common = { group: 'points', stage: null, reliability: 'exact', origin: 'SOURCE' } as const;
  const events: JourneyEvent[] = [
    ...points.map((p): JourneyEvent => ({ ...common, id: `points-${p.id}`, type: 'LOYALTY_POINTS', timestamp: p.createdAt.toISOString(), title: `ได้แต้ม ${p.points} แต้ม${POINT_REASONS[p.reason] ? ` (${POINT_REASONS[p.reason]} · ${p.contract.contractNumber})` : ''}`, actor: { type: 'SYSTEM' } })),
    ...redemptions.map((r): JourneyEvent => ({ ...common, id: `redeem-${r.id}`, type: 'LOYALTY_REDEEMED', timestamp: r.createdAt.toISOString(), title: `แลกแต้ม ${r.points} แต้ม เป็นส่วนลด ${bahtText(r.discountAmount)} บาท`, actor: { type: 'STAFF' } })),
  ];
  return finalizeSource(events, window);
};
```
Run เทส Step 8 → Expected: PASS 4 tests

- [ ] **Step 10: เทสแดง — `entriesSource` / `entriesSourceFor` (entries + แท็ก)**

`sources/entries.source.spec.ts`:
```ts
import type { JourneyEvent, JourneyEventGroup } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { entriesSource, entriesSourceFor } from './entries.source';

jest.mock('../journey-data-schemas', () => ({
  JOURNEY_DATA_SCHEMAS: {
    PLACEHOLDER_MERGED: { safeParse: (v: { roomCount?: unknown }) => (typeof v?.roomCount === 'number' ? { success: true, data: { roomCount: v.roomCount } } : { success: false }) },
    CREDIT_AI_SCORED: { safeParse: () => ({ success: false }) },
  },
}));

const at = (iso: string) => new Date(iso);
const entry = (o: Record<string, unknown>) => ({ origin: 'SYSTEM', actorType: 'STAFF', roomId: null, refType: null, refId: null, data: null, channel: null, outcome: null, lostReason: null, heardFrom: null, actorUser: null, ...o });
const byId = (events: JourneyEvent[], id: string) => events.find((e) => e.id === id);
function db() {
  return {
    customerJourneyEntry: { findMany: jest.fn().mockResolvedValue([
      entry({ id: 'act', kind: 'CONTRACT_ACTIVATED', occurredAt: at('2026-09-05T03:00:00.000Z'), refType: 'contract', refId: 'k1', actorUser: { id: 'u1', name: 'แนน' } }),
      entry({ id: 'merge', kind: 'PLACEHOLDER_MERGED', occurredAt: at('2026-09-04T03:00:00.000Z'), data: { roomCount: 2 } }),
      entry({ id: 'ai', kind: 'CREDIT_AI_SCORED', occurredAt: at('2026-09-03T12:00:00.000Z'), actorType: 'SYSTEM', data: { phone: '0812345678' } }),
      entry({ id: 'touch', kind: 'TOUCHPOINT', origin: 'MANUAL', occurredAt: at('2026-09-03T03:00:00.000Z'), channel: 'PHONE', outcome: 'APPOINTED' }),
      entry({ id: 'handoff', kind: 'BOT_HANDOFF', occurredAt: at('2026-09-02T03:00:00.000Z'), actorType: 'BOT', roomId: 'r2' }),
      entry({ id: 'future', kind: 'SOMETHING_NEW', occurredAt: at('2026-09-01T05:00:00.000Z') }),
    ]) },
    customerTag: { findMany: jest.fn().mockResolvedValue([
      { id: 'vip-target', tag: 'VIP', source: 'MANUAL', createdAt: at('2024-01-01T03:00:00.000Z'), deletedAt: null, appliedBy: { id: 'u1', name: 'แนน' } },
      { id: 'vip-dup', tag: 'VIP', source: 'MANUAL', createdAt: at('2026-08-01T03:00:00.000Z'), deletedAt: at('2026-09-10T00:00:00.000Z'), appliedBy: null },
      { id: 'new', tag: 'NEW', source: 'AUTO', createdAt: at('2026-08-01T03:00:00.000Z'), deletedAt: at('2026-09-01T00:00:00.000Z'), appliedBy: null },
    ]) },
    chatRoom: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('entriesSource', () => {
  it('kind → กลุ่ม/ขั้น/ลิงก์/origin · data ผ่าน whitelist เท่านั้น · kind ไม่รู้จักถูกทิ้ง · แท็กซ้ำจากการรวมไม่แสดง', async () => {
    const prisma = db();
    const events = await entriesSource(prisma as unknown as PrismaService, ['c1', 'p1'], { limit: 30 }, { id: 'o1', role: 'OWNER' });
    expect(events.map((e) => e.id)).toEqual(['entry-act', 'entry-merge', 'entry-ai', 'entry-touch', 'entry-handoff', 'tag-removed-new', 'tag-new', 'tag-vip-target']);
    expect(byId(events, 'entry-act')).toEqual({ id: 'entry-act', type: 'CONTRACT_ACTIVATED', group: 'sale', stage: 'PURCHASED', timestamp: '2026-09-05T03:00:00.000Z', title: 'เริ่มผ่อนสัญญา', actor: { type: 'STAFF', id: 'u1', name: 'แนน' }, reliability: 'exact', origin: 'SYSTEM_ENTRY', href: '/contracts/k1' });
    expect(byId(events, 'entry-merge')).toMatchObject({ group: 'chat', stage: 'IDENTIFIED', title: 'รวมประวัติแชท 2 ห้องเข้ากับลูกค้าคนนี้', metadata: { roomCount: 2 } });
    expect(byId(events, 'entry-ai')).toMatchObject({ group: 'credit', title: 'AI ประเมินเครดิตแล้ว', actor: { type: 'SYSTEM' } });
    expect(byId(events, 'entry-ai')).not.toHaveProperty('metadata');
    expect(byId(events, 'entry-touch')).toMatchObject({ stage: 'INTERESTED', origin: 'MANUAL', title: 'ติดต่อทางโทร: นัดแล้ว' });
    expect(byId(events, 'entry-handoff')).toMatchObject({ group: 'chat', actor: { type: 'BOT' }, href: '/inbox/r2' });
    expect(byId(events, 'tag-removed-new')).toMatchObject({ group: 'system', title: 'ถอดแท็ก ลูกค้าใหม่', actor: null });
    expect(byId(events, 'tag-new')).toMatchObject({ actor: { type: 'SYSTEM' } });
    expect(JSON.stringify(events)).not.toContain('0812345678');
    const args = prisma.customerJourneyEntry.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ customerId: { in: ['c1', 'p1'] }, deletedAt: null });
    expect(args.where.kind).toEqual({ in: ['CONTRACT_ACTIVATED', 'CONTRACT_REVIEWED', 'CREDIT_AI_SCORED', 'BOT_HANDOFF', 'CONTACT_ADDED', 'LINE_LINKED', 'PRODUCT_LINK_CLICK', 'PLACEHOLDER_MERGED', 'TOUCHPOINT', 'HEARD_FROM', 'MARKED_LOST', 'REOPENED'] });
    expect(args.select).not.toHaveProperty('note');
  });

  it('SALES: บันทึกที่ผูกห้องที่คนอื่นดูแลถูกทิ้ง · ACCOUNTANT: ไม่มีลิงก์แชท', async () => {
    const sales = db();
    const salesEvents = await entriesSource(sales as unknown as PrismaService, ['c1'], { limit: 30 }, { id: 's1', role: 'SALES' });
    expect(sales.chatRoom.findMany).toHaveBeenCalledWith({ where: { id: { in: ['r2'] }, OR: [{ assignedToId: null }, { assignedToId: 's1' }] }, select: { id: true } });
    expect(byId(salesEvents, 'entry-handoff')).toBeUndefined();
    const accountant = db();
    const accEvents = await entriesSource(accountant as unknown as PrismaService, ['c1'], { limit: 30 }, { id: 'a1', role: 'ACCOUNTANT' });
    expect(accountant.chatRoom.findMany).not.toHaveBeenCalled();
    expect(byId(accEvents, 'entry-handoff')).not.toHaveProperty('href');
  });

  it('entriesSourceFor: DB กรอง kind ตามกลุ่มที่ขอ · อ่านแท็กเฉพาะกลุ่มระบบ · ป้ายหลุด/รู้จักร้านมาจาก shared', async () => {
    const chat = db();
    chat.customerJourneyEntry.findMany.mockResolvedValue([
      entry({ id: 'lost', kind: 'MARKED_LOST', origin: 'MANUAL', occurredAt: at('2026-09-06T03:00:00.000Z'), lostReason: 'BOUGHT_ELSEWHERE' }),
      entry({ id: 'heard', kind: 'HEARD_FROM', origin: 'MANUAL', occurredAt: at('2026-09-05T03:00:00.000Z'), heardFrom: 'FRIEND' }),
      entry({ id: 'act', kind: 'CONTRACT_ACTIVATED', occurredAt: at('2026-09-04T03:00:00.000Z'), refType: 'contract', refId: 'k1' }),
    ]);
    const chatEvents = await entriesSourceFor(new Set<JourneyEventGroup>(['chat']))(chat as unknown as PrismaService, ['c1'], { limit: 30 }, { id: 'o1', role: 'OWNER' });
    expect(chat.customerJourneyEntry.findMany.mock.calls[0][0].where.kind).toEqual({ in: ['BOT_HANDOFF', 'CONTACT_ADDED', 'LINE_LINKED', 'PRODUCT_LINK_CLICK', 'PLACEHOLDER_MERGED', 'TOUCHPOINT', 'HEARD_FROM', 'MARKED_LOST', 'REOPENED'] });
    expect(chat.customerTag.findMany).not.toHaveBeenCalled();
    // แถวกลุ่มอื่นที่หลุดมา (mock ไม่กรอง where) ถูกทิ้งฝั่งโค้ดด้วย
    expect(chatEvents.map((e) => [e.id, e.title])).toEqual([
      ['entry-lost', 'ติดป้ายหลุด: ซื้อที่อื่น'],
      ['entry-heard', 'ลูกค้าบอกว่ารู้จักร้านจากเพื่อนแนะนำ'],
    ]);

    const system = db();
    const systemEvents = await entriesSourceFor(new Set<JourneyEventGroup>(['system']))(system as unknown as PrismaService, ['c1'], { limit: 30 }, { id: 'o1', role: 'OWNER' });
    expect(system.customerJourneyEntry.findMany).not.toHaveBeenCalled();
    expect(systemEvents.map((e) => e.id)).toEqual(['tag-removed-new', 'tag-new', 'tag-vip-target']);
  });
});
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/sources/entries.source.spec.ts --runInBand` → Expected: FAIL `Cannot find module './entries.source'`

- [ ] **Step 11: `entries.source.ts`**
```ts
import {
  JOURNEY_EVENT_GROUPS,
  JOURNEY_HEARD_FROM_LABELS,
  JOURNEY_LOST_REASON_LABELS,
  type JourneyEntryKind,
  type JourneyEvent,
  type JourneyEventGroup,
  type JourneyStage,
} from '@installment/shared';
import { roomAssignmentScope } from '../../credit-check/services/room-credit-access';
import { JOURNEY_DATA_SCHEMAS } from '../journey-data-schemas';
import { JOURNEY_CHAT_ROLES, asActorType, asRecord, dbTimeRange, finalizeSource, scanTake, staffActor, whenAny, type JourneySource } from './journey-window';

type ShownKind = Exclude<JourneyEntryKind, 'CREDIT_CHECK_OPENED_BY'>; // credit.source.ts ใช้เติมผู้เปิดแทน
const VIEWS: Record<ShownKind, { group: JourneyEventGroup; stage: JourneyStage | null; title: string }> = {
  CONTRACT_ACTIVATED: { group: 'sale', stage: 'PURCHASED', title: 'เริ่มผ่อนสัญญา' },
  CONTRACT_REVIEWED: { group: 'sale', stage: 'CREDIT', title: 'ผู้จัดการตรวจสัญญา' },
  CREDIT_AI_SCORED: { group: 'credit', stage: 'CREDIT', title: 'AI ประเมินเครดิตแล้ว' },
  BOT_HANDOFF: { group: 'chat', stage: null, title: 'บอทส่งต่อพนักงาน' },
  CONTACT_ADDED: { group: 'chat', stage: 'IDENTIFIED', title: 'ได้เบอร์/เลขบัตรลูกค้าแล้ว' },
  LINE_LINKED: { group: 'chat', stage: 'IDENTIFIED', title: 'ผูก LINE แล้ว' },
  PRODUCT_LINK_CLICK: { group: 'chat', stage: 'CONTACTED', title: 'กดมาจากสินค้าบนเว็บ' },
  PLACEHOLDER_MERGED: { group: 'chat', stage: 'IDENTIFIED', title: 'รวมประวัติแชทเข้ากับลูกค้าคนนี้' },
  TOUCHPOINT: { group: 'chat', stage: null, title: 'พนักงานบันทึกการติดต่อ' },
  HEARD_FROM: { group: 'chat', stage: null, title: 'ลูกค้าบอกว่ารู้จักร้าน' },
  MARKED_LOST: { group: 'chat', stage: null, title: 'ติดป้ายหลุด' },
  REOPENED: { group: 'chat', stage: null, title: 'เปิดใหม่' },
};
const TOUCH_CHANNELS: Record<string, string> = { PHONE: 'โทร', FB_APP: 'แชทในแอป FB', LINE_APP: 'LINE', WALK_IN: 'หน้าร้าน', OTHER: 'อื่น ๆ' };
const OUTCOMES: Record<string, string> = { APPOINTED: 'นัดแล้ว', VISITED: 'มาร้านแล้ว', THINKING: 'ขอคิดก่อน', BUDGET: 'งบ/ดาวน์ไม่พอ', NO_ANSWER: 'ไม่รับสาย', BOUGHT_ELSEWHERE: 'ซื้อที่อื่น', NOT_INTERESTED: 'ไม่สนใจ' };
// ป้ายรู้จักร้านจาก / เหตุผลหลุด = JOURNEY_HEARD_FROM_LABELS / JOURNEY_LOST_REASON_LABELS ของ shared (ชุดเดียวกับ summary และเว็บ)
/** ชุดเดียวกับ apps/web/src/pages/CustomersPage/components/ProspectFilterBar.tsx:30-36 */
const TAG_LABELS: Record<string, string> = { VIP: 'VIP', HIGH_RISK: 'เสี่ยงสูง', NEW: 'ลูกค้าใหม่', LOYAL: 'ลูกค้าประจำ', BLACKLIST: 'BLACKLIST' };

const isShownKind = (kind: string): kind is ShownKind => Object.prototype.hasOwnProperty.call(VIEWS, kind);

/** kind ที่แสดงของชุดกลุ่ม (ลำดับตาม VIEWS) — ให้ DB กรอง ไม่ใช่ตัดหลังดึง */
const kindsOf = (groups: ReadonlySet<JourneyEventGroup>): ShownKind[] =>
  (Object.keys(VIEWS) as ShownKind[]).filter((kind) => groups.has(VIEWS[kind].group));

/** data ผ่าน zod ของ kind อีกรอบก่อนส่งออก — ไม่ผ่าน/ไม่มี schema = ไม่ส่ง metadata */
function whitelisted(kind: string, data: unknown): Record<string, unknown> | undefined {
  const schema = (JOURNEY_DATA_SCHEMAS as unknown as Partial<Record<string, { safeParse(input: unknown): { success: boolean; data?: unknown } }>>)[kind];
  if (!schema || data === null || data === undefined) return undefined;
  const parsed = schema.safeParse(data);
  const record = parsed.success ? asRecord(parsed.data) : {};
  return Object.keys(record).length ? record : undefined;
}

interface TagRow { id: string; tag: string; createdAt: Date; deletedAt: Date | null }
/** absorbPlaceholder soft-delete แท็กที่ปลายทางมีอยู่แล้ว — ไม่ใช่การถอดจริง: มีแถวแท็กเดียวกันสร้างไม่เกิน 2 วินาทีหลังเวลาลบและยังอยู่ ณ เวลานั้น */
const isMergeDuplicate = (row: TagRow, all: readonly TagRow[]) => !!row.deletedAt && all.some((o) => o.id !== row.id && o.tag === row.tag
  && o.createdAt.getTime() <= row.deletedAt!.getTime() + 2000 && (!o.deletedAt || o.deletedAt > row.deletedAt!));

/**
 * แถว entries + แท็ก ของกลุ่มที่ขอ — kind กรองที่ DB (แถวของกลุ่มหนึ่งไม่ดันอีกกลุ่มหลุด take) · แท็ก (กลุ่ม system) อ่านเฉพาะเมื่อขอ system
 * entriesSource (ทุกกลุ่ม) ใช้ตัดหน้าตามเดิม · Task 9 สแกนทีละกลุ่มเพื่อนับตัวเลขบนชิป
 */
export function entriesSourceFor(groups: ReadonlySet<JourneyEventGroup>): JourneySource {
  const kinds = kindsOf(groups);
  const withTags = groups.has('system');
  return async (prisma, customerIds, window, actor) => {
    const [rows, tags] = await Promise.all([
      whenAny(kinds, () =>
        prisma.customerJourneyEntry.findMany({
          where: { customerId: { in: customerIds }, deletedAt: null, kind: { in: kinds }, occurredAt: dbTimeRange(window) },
          // ไม่ select note (ข้อความอิสระ) ทุกกรณี
          select: { id: true, kind: true, origin: true, occurredAt: true, actorType: true, roomId: true, refType: true, refId: true, data: true, channel: true, outcome: true, lostReason: true, heardFrom: true, actorUser: { select: { id: true, name: true } } },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: scanTake(window),
        }),
      ),
      whenAny(withTags ? customerIds : [], () =>
        prisma.customerTag.findMany({ where: { customerId: { in: customerIds } }, select: { id: true, tag: true, source: true, createdAt: true, deletedAt: true, appliedBy: { select: { id: true, name: true } } } }),
      ),
    ]);
    const roomIds = [...new Set(rows.map((r) => r.roomId).filter((id): id is string => id !== null))];
    const visibleRooms = actor.role === 'SALES'
      ? new Set((await whenAny(roomIds, () => prisma.chatRoom.findMany({ where: { id: { in: roomIds }, ...roomAssignmentScope(actor) }, select: { id: true } }))).map((r) => r.id))
      : null;
    const seesChat = JOURNEY_CHAT_ROLES.has(actor.role);
    const events: JourneyEvent[] = [];

    for (const row of rows) {
      const kind = row.kind;
      // DB กรอง kind แล้ว — ตรวจกลุ่มซ้ำฝั่งโค้ด · kind ที่ยังไม่มีใน VIEWS ถูกทิ้ง
      if (!isShownKind(kind) || !groups.has(VIEWS[kind].group) || (row.roomId && visibleRooms && !visibleRooms.has(row.roomId))) continue;
      const data = whitelisted(kind, row.data);
      const title = kind === 'TOUCHPOINT' ? `ติดต่อทาง${TOUCH_CHANNELS[row.channel ?? ''] ?? 'อื่น ๆ'}: ${OUTCOMES[row.outcome ?? ''] ?? 'บันทึกแล้ว'}`
        : kind === 'HEARD_FROM' ? `ลูกค้าบอกว่ารู้จักร้านจาก${JOURNEY_HEARD_FROM_LABELS[row.heardFrom ?? ''] ?? 'อื่น ๆ'}`
        : kind === 'MARKED_LOST' ? `ติดป้ายหลุด: ${JOURNEY_LOST_REASON_LABELS[row.lostReason ?? ''] ?? 'อื่น ๆ'}`
        : kind === 'PLACEHOLDER_MERGED' && typeof data?.roomCount === 'number' ? `รวมประวัติแชท ${data.roomCount} ห้องเข้ากับลูกค้าคนนี้`
        : VIEWS[kind].title;
      const href = row.refType === 'contract' && row.refId ? `/contracts/${row.refId}` : row.roomId && seesChat ? `/inbox/${row.roomId}` : undefined;
      const type = asActorType(row.actorType);
      events.push({
        id: `entry-${row.id}`, type: kind, group: VIEWS[kind].group,
        stage: kind === 'TOUCHPOINT' && (row.outcome === 'APPOINTED' || row.outcome === 'VISITED') ? 'INTERESTED' : VIEWS[kind].stage,
        timestamp: row.occurredAt.toISOString(), title,
        actor: row.actorUser ? { type, id: row.actorUser.id, name: row.actorUser.name } : { type },
        reliability: 'exact', origin: row.origin === 'MANUAL' ? 'MANUAL' : 'SYSTEM_ENTRY',
        ...(href ? { href } : {}), ...(data ? { metadata: data } : {}),
      });
    }
    for (const tag of tags) {
      if (isMergeDuplicate(tag, tags)) continue;
      const label = TAG_LABELS[tag.tag] ?? tag.tag;
      const common = { group: 'system', stage: null, reliability: 'exact', origin: 'SOURCE' } as const;
      events.push({ ...common, id: `tag-${tag.id}`, type: 'TAG_ADDED', timestamp: tag.createdAt.toISOString(), title: `ติดแท็ก ${label}`, actor: tag.appliedBy ? staffActor(tag.appliedBy) : { type: tag.source === 'AUTO' ? 'SYSTEM' : 'STAFF' } });
      if (tag.deletedAt) events.push({ ...common, id: `tag-removed-${tag.id}`, type: 'TAG_REMOVED', timestamp: tag.deletedAt.toISOString(), title: `ถอดแท็ก ${label}`, actor: null }); // ผู้ถอดไม่ได้บันทึก
    }
    return finalizeSource(events, window);
  };
}

/** ทุกกลุ่ม — ตัดหน้าของ GET /customers/:id/journey (sourcesForGroups ใน customer-journey.service.ts) */
export const entriesSource: JourneySource = entriesSourceFor(new Set(JOURNEY_EVENT_GROUPS));
```
Run เทส Step 10 → Expected: PASS 3 tests

- [ ] **Step 12: เทสแดง — DTO · service (unit) · PDPA (real DB)**

`dto/journey-list-query.dto.spec.ts`:
```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JourneyListQueryDto } from './journey-list-query.dto';

const check = async (plain: Record<string, unknown>) => {
  const dto = plainToInstance(JourneyListQueryDto, plain, { enableImplicitConversion: true });
  return { dto, fields: (await validate(dto, { whitelist: true })).map((e) => e.property) };
};

describe('JourneyListQueryDto', () => {
  it('ค่าตั้งต้น limit 30 · groups รับ csv และ key ซ้ำ', async () => {
    expect(await check({})).toMatchObject({ dto: { limit: 30 }, fields: [] });
    expect(await check({ groups: 'chat, credit', limit: '10' })).toMatchObject({ dto: { groups: ['chat', 'credit'], limit: 10 }, fields: [] });
    expect((await check({ groups: ['chat', 'sale,points'] })).dto.groups).toEqual(['chat', 'sale', 'points']);
  });
  it.each([
    [{ groups: 'chat,messages' }, 'groups'], [{ limit: '0' }, 'limit'], [{ limit: '101' }, 'limit'],
    [{ cursor: 'ไม่ใช่ cursor' }, 'cursor'], [{ from: 'เมื่อวาน' }, 'from'],
  ])('%j → error ที่ %s', async (plain, field) => {
    expect((await check(plain)).fields).toEqual([field]);
  });
});
```
`customer-journey.service.spec.ts`:
```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { JourneyEvent, JourneyEventGroup, JourneyListResponse } from '@installment/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import { CustomerJourneyService, resolveJourneyGroups } from './customer-journey.service';
import { chatSource } from './sources/chat.source';
import { collectionsSource } from './sources/collections.source';
import { creditSource } from './sources/credit.source';
import { entriesSource } from './sources/entries.source';
import { decodeJourneyCursor, encodeJourneyCursor } from './sources/journey-window';
import { paymentSource } from './sources/payment.source';
import { pointsSource } from './sources/points.source';
import { saleSource } from './sources/sale.source';
import { serviceSource } from './sources/service.source';

jest.mock('./sources/chat.source', () => ({ chatSource: jest.fn() }));
jest.mock('./sources/credit.source', () => ({ creditSource: jest.fn() }));
jest.mock('./sources/sale.source', () => ({ saleSource: jest.fn() }));
jest.mock('./sources/payment.source', () => ({ paymentSource: jest.fn() }));
jest.mock('./sources/collections.source', () => ({ collectionsSource: jest.fn() }));
jest.mock('./sources/service.source', () => ({ serviceSource: jest.fn() }));
jest.mock('./sources/points.source', () => ({ pointsSource: jest.fn() }));
jest.mock('./sources/entries.source', () => ({ entriesSource: jest.fn() }));

const ALL = [chatSource, creditSource, saleSource, paymentSource, collectionsSource, serviceSource, pointsSource, entriesSource];
const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString();
const ev = (id: string, timestamp: string, group: JourneyEventGroup): JourneyEvent => ({ id, type: 'TEST', group, stage: null, timestamp, title: id, actor: null, reliability: 'exact', origin: 'SOURCE' });
const OWNER = { id: 'o1', role: 'OWNER' };
const LIVE = { id: 'c1', deletedAt: null, mergedIntoId: null };
function setup(customer: { id: string; deletedAt: Date | null; mergedIntoId: string | null } | null, merged: { id: string }[] = []) {
  const prisma = { customer: { findUnique: jest.fn().mockResolvedValue(customer), findMany: jest.fn().mockResolvedValue(merged) } };
  return { prisma, service: new CustomerJourneyService(prisma as unknown as PrismaService) };
}
function asPage(result: Awaited<ReturnType<CustomerJourneyService['list']>>): JourneyListResponse {
  if (!('events' in result)) throw new Error('ได้ redirect แทนหน้าไทม์ไลน์');
  return result;
}

describe('CustomerJourneyService.list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const source of ALL) jest.mocked(source).mockResolvedValue([]);
  });

  it('placeholder ที่รวมแล้ว → redirect ไม่เรียกแหล่ง · ไม่มี/ลบด้วยเหตุอื่น → 404', async () => {
    await expect(setup({ id: 'p1', deletedAt: new Date(), mergedIntoId: 'c1' }).service.list('p1', {}, OWNER)).resolves.toEqual({ redirectToCustomerId: 'c1' });
    for (const source of ALL) expect(source).not.toHaveBeenCalled();
    await expect(setup(null).service.list('x', {}, OWNER)).rejects.toThrow(new NotFoundException('ไม่พบลูกค้า'));
    await expect(setup({ id: 'd1', deletedAt: new Date(), mergedIntoId: null }).service.list('d1', {}, OWNER)).rejects.toThrow(NotFoundException);
  });

  it('ids = ลูกค้า + placeholder ที่รวมเข้ามา · ค่าตั้งต้นเรียก chat/credit/sale/collections/service + entries ครั้งเดียว', async () => {
    const { prisma, service } = setup(LIVE, [{ id: 'p1' }, { id: 'p2' }]);
    const page = asPage(await service.list('c1', {}, OWNER));
    expect(prisma.customer.findMany).toHaveBeenCalledWith({ where: { mergedIntoId: 'c1' }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(page).toMatchObject({ customerId: 'c1', mergedCustomerIds: ['p1', 'p2'], events: [], nextCursor: null });
    expect(page.notRecorded.length).toBeGreaterThan(0);
    expect(chatSource).toHaveBeenCalledWith(prisma, ['c1', 'p1', 'p2'], { limit: 30, before: undefined, from: undefined, to: undefined }, OWNER);
    for (const source of [chatSource, creditSource, saleSource, collectionsSource, serviceSource, entriesSource]) expect(source).toHaveBeenCalledTimes(1);
    expect(paymentSource).not.toHaveBeenCalled();
    expect(pointsSource).not.toHaveBeenCalled();
  });

  it('ACCOUNTANT ไม่เรียกแชทและตัดกลุ่ม chat จาก entries · SALES ไม่เรียก payment/collections', async () => {
    jest.mocked(entriesSource).mockResolvedValue([ev('entry-chat', day(2), 'chat'), ev('entry-credit', day(1), 'credit')]);
    const page = asPage(await setup(LIVE).service.list('c1', { groups: ['chat', 'credit'] }, { id: 'a1', role: 'ACCOUNTANT' }));
    expect(chatSource).not.toHaveBeenCalled();
    expect(page.events.map((e) => e.id)).toEqual(['entry-credit']);
    await setup(LIVE).service.list('c1', { groups: ['payment', 'collections', 'sale'] }, { id: 's1', role: 'SALES' });
    expect(paymentSource).not.toHaveBeenCalled();
    expect(collectionsSource).not.toHaveBeenCalled();
    expect(saleSource).toHaveBeenCalledTimes(1);
    expect([...resolveJourneyGroups(undefined, 'SALES')]).toEqual(['chat', 'credit', 'sale', 'service']);
  });

  it('รวมหลายแหล่ง ตัดที่ limit คืน nextCursor · cursor เสีย 400 ก่อนแตะ DB · cursor/from/to ไปถึงแหล่ง', async () => {
    jest.mocked(chatSource).mockResolvedValue([ev('a', day(3), 'chat'), ev('b', day(1), 'chat')]);
    jest.mocked(saleSource).mockResolvedValue([ev('c', day(2), 'sale')]);
    const page = asPage(await setup(LIVE).service.list('c1', { groups: ['chat', 'sale'], limit: 2 }, OWNER));
    expect(page.events.map((e) => e.id)).toEqual(['a', 'c']);
    expect(decodeJourneyCursor(page.nextCursor ?? '')).toEqual({ ts: day(2), id: 'c' });
    const bad = setup(LIVE);
    await expect(bad.service.list('c1', { cursor: Buffer.from('nope').toString('base64') }, OWNER)).rejects.toThrow(BadRequestException);
    expect(bad.prisma.customer.findUnique).not.toHaveBeenCalled();
    const good = setup(LIVE);
    await good.service.list('c1', { cursor: encodeJourneyCursor({ timestamp: day(5), id: 'x-1' }), from: day(0), to: day(9), groups: ['service'], limit: 10 }, OWNER);
    expect(serviceSource).toHaveBeenCalledWith(good.prisma, ['c1'], { limit: 10, before: { ts: day(5), id: 'x-1' }, from: new Date(day(0)), to: new Date(day(9)) }, OWNER);
  });
});
```
`customer-journey.pdpa.db.spec.ts`:
```ts
import { ChatChannel, MessageRole, PrismaClient } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { JOURNEY_EVENT_GROUPS, type JourneyListResponse } from '@installment/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import { CustomerJourneyService } from './customer-journey.service';
import { journeyDedupeKey } from './journey-data-schemas';

const FORBIDDEN_KEYS = ['phone', 'phoneSecondary', 'nationalId', 'address', 'addressCurrent', 'addressIdCard', 'addressWork', 'text', 'content', 'messageContent', 'notes', 'note', 'voiceMemoUrl', 'overrideReason', 'customerName', 'reviewNotes', 'voidReason', 'defectDescription', 'reason'];
const EVENT_KEYS = ['id', 'type', 'group', 'stage', 'timestamp', 'title', 'subtitle', 'actor', 'reliability', 'origin', 'href', 'metadata'];
function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, keys));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { keys.add(k); allKeys(v, keys); }
  return keys;
}

/** PDPA snapshot ของคำตอบ GET /customers/:id/journey ทั้งก้อน กับ Postgres จริง — ต้อง apply migration ของ Task 1 แล้ว · audit_logs ลบไม่ได้ ค้างในฐานทดสอบโดยตั้งใจ */
describe('CustomerJourneyService.list (real DB) — PDPA · สิทธิ์ · รวมผู้สนใจ · หน้า', () => {
  const prisma = new PrismaClient();
  const service = new CustomerJourneyService(prisma as unknown as PrismaService);
  const stamp = Date.now();
  const phone = `08${String(stamp).slice(-8)}`;
  const nationalId = `3${String(stamp).padStart(12, '0').slice(-12)}`;
  const address = 'บ้านเลขที่ 88/8 ซอยสเปคการเดินทาง';
  const ids = { staff: '', other: '', target: '', placeholder: '', deleted: '', open: '', assigned: '' };
  const OWNER = { id: 'owner-spec', role: 'OWNER' };
  const query = { groups: [...JOURNEY_EVENT_GROUPS], limit: 100 };
  const page = async (id: string, actor: { id: string; role: string }, extra: Record<string, unknown> = {}) => {
    const result = await service.list(id, { ...query, ...extra }, actor);
    if (!('events' in result)) throw new Error('ได้ redirect');
    return result as JourneyListResponse;
  };

  beforeAll(async () => {
    const upsert = (email: string, name: string) => prisma.user.upsert({ where: { email }, update: {}, create: { email, password: 'journey-spec', name, role: 'SALES' } });
    ids.staff = (await upsert('journey-spec-staff@example.test', 'พนักงานสเปคการเดินทาง')).id;
    ids.other = (await upsert('journey-spec-other@example.test', 'พนักงานอีกคน')).id;
    ids.target = (await prisma.customer.create({ data: { name: 'สมหมาย สเปคการเดินทาง', phone, nationalId, addressCurrent: address } })).id;
    ids.placeholder = (await prisma.customer.create({ data: { name: 'Facebook #spec', acquisitionSource: 'CHAT_FACEBOOK', deletedAt: new Date(), mergedIntoId: ids.target } })).id;
    ids.deleted = (await prisma.customer.create({ data: { name: 'journey deleted spec', deletedAt: new Date() } })).id;
    ids.open = (await prisma.chatRoom.create({ data: { channel: ChatChannel.FACEBOOK, externalUserId: `journey-pdpa-open-${stamp}`, customerId: ids.target } })).id;
    ids.assigned = (await prisma.chatRoom.create({ data: { channel: ChatChannel.LINE_SHOP, externalUserId: `journey-pdpa-assigned-${stamp}`, customerId: ids.target, assignedToId: ids.other } })).id;
    await prisma.chatMessage.createMany({ data: [
      { roomId: ids.open, role: MessageRole.CUSTOMER, text: `ผมสมหมาย เบอร์ ${phone}` },
      { roomId: ids.open, role: MessageRole.STAFF, text: `ส่งที่ ${address}` },
      { roomId: ids.assigned, role: MessageRole.CUSTOMER, text: 'ห้องที่คนอื่นดูแล' },
    ] });
    await prisma.todo.create({ data: { title: `โทรหา ${phone}`, description: address, createdById: ids.staff, roomId: ids.open, dueDate: new Date(Date.now() + 86_400_000) } });
    await prisma.auditLog.create({ data: { userId: ids.staff, action: 'AI_LEAD_CAPTURED', entity: 'customer', entityId: ids.placeholder, newValue: { customerName: 'สมหมาย', phone, address, packageChoice: 'A', downAmount: 1990 } } });
    await prisma.creditCheck.create({ data: { customerId: ids.target } });
    await prisma.customerTag.create({ data: { customerId: ids.target, tag: 'VIP', source: 'MANUAL', appliedByUserId: ids.staff, reason: `ลูกค้า ${phone}` } });
    const entry = { customerId: ids.target, occurredAt: new Date(), actorType: 'STAFF', actorUserId: ids.staff };
    await prisma.customerJourneyEntry.create({ data: { ...entry, originCustomerId: ids.placeholder, origin: 'SYSTEM', kind: 'PLACEHOLDER_MERGED', dedupeKey: journeyDedupeKey('PLACEHOLDER_MERGED', ids.placeholder), data: { roomCount: 1 } } });
    await prisma.customerJourneyEntry.create({ data: { ...entry, originCustomerId: ids.target, origin: 'MANUAL', kind: 'TOUCHPOINT', roomId: ids.assigned, channel: 'PHONE', outcome: 'APPOINTED', note: `โทร ${phone}` } });
  });

  afterAll(async () => {
    const customerIds = [ids.target, ids.placeholder, ids.deleted];
    const roomIds = [ids.open, ids.assigned];
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.todo.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerTag.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: [ids.placeholder, ids.deleted] } } });
    await prisma.customer.deleteMany({ where: { id: ids.target } });
    await prisma.$disconnect();
  });

  it('redirect placeholder ที่รวมแล้ว · 404 ลบด้วยเหตุอื่น · หน้าลูกค้ามีประวัติของ placeholder', async () => {
    await expect(service.list(ids.placeholder, {}, OWNER)).resolves.toEqual({ redirectToCustomerId: ids.target });
    await expect(service.list(ids.deleted, {}, OWNER)).rejects.toThrow(NotFoundException);
    const result = await page(ids.target, OWNER);
    expect(result.mergedCustomerIds).toEqual([ids.placeholder]);
    const types = result.events.map((e) => e.type);
    for (const type of ['CHAT_ROOM_OPENED', 'CHAT_DAY', 'APPOINTMENT', 'AI_LEAD_CAPTURED', 'CUSTOMER_CREATED_BY_STAFF', 'CREDIT_CHECK_OPENED', 'TAG_ADDED', 'PLACEHOLDER_MERGED', 'TOUCHPOINT']) expect(types).toContain(type);
  });

  it('PDPA snapshot: ไม่มีคีย์ต้องห้าม ไม่มีข้อความแชท/เบอร์/บัตร/ที่อยู่ · รูปรายการอยู่ในชุดคีย์ที่อนุญาต', async () => {
    const result = await page(ids.target, OWNER);
    const keys = allKeys(result);
    expect(FORBIDDEN_KEYS.filter((k) => keys.has(k))).toEqual([]);
    const json = JSON.stringify(result);
    for (const secret of [phone, nationalId, address, 'สมหมาย', 'ห้องที่คนอื่นดูแล']) expect(json).not.toContain(secret);
    for (const event of result.events) {
      expect(Object.keys(event).filter((k) => !EVENT_KEYS.includes(k))).toEqual([]);
      expect(Object.keys(event.actor ?? {}).filter((k) => !['type', 'id', 'name'].includes(k))).toEqual([]);
    }
  });

  it('SALES ไม่เห็นห้อง/บันทึกของห้องที่คนอื่นดูแล · ACCOUNTANT ไม่ได้ chat แม้ขอมา', async () => {
    const sales = await page(ids.target, { id: ids.staff, role: 'SALES' });
    expect(sales.events.some((e) => e.href === `/inbox/${ids.assigned}` || e.type === 'TOUCHPOINT')).toBe(false);
    expect(sales.events.some((e) => e.href === `/inbox/${ids.open}`)).toBe(true);
    expect(sales.events.filter((e) => e.group === 'payment' || e.group === 'collections')).toEqual([]);
    const accountant = await page(ids.target, { id: 'acc-spec', role: 'ACCOUNTANT' });
    expect(accountant.events.filter((e) => e.group === 'chat')).toEqual([]);
    expect(accountant.events.map((e) => e.type)).toEqual(expect.arrayContaining(['CREDIT_CHECK_OPENED', 'TAG_ADDED']));
  });

  it('เดินทีละ 2 จนหมด ได้ลำดับเดียวกับหน้าเดียว ไม่ซ้ำ ไม่ข้าม', async () => {
    const full = (await page(ids.target, OWNER)).events.map((e) => e.id);
    const walked: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 50; guard += 1) {
      const next = await page(ids.target, OWNER, { limit: 2, cursor });
      walked.push(...next.events.map((e) => e.id));
      if (!next.nextCursor) break;
      cursor = next.nextCursor;
    }
    expect(walked).toEqual(full);
  });
});
```
`customer-journey.payments-cursor.db.spec.ts`:
```ts
import { Prisma, PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { CustomerJourneyService } from './customer-journey.service';

/**
 * สัญญาหนึ่งใบมีงวดที่ชำระแล้ว 60 งวด (มากกว่าเพดานเดิม 50 แถวต่อสัญญาของ full-timeline) —
 * เดินหน้าละ 30 ด้วย cursor ต้องได้ครบ 60 ไม่ซ้ำ ไม่ข้าม ⇒ พิสูจน์ว่า window ลงไปถึง contractEventSources (Task 7)
 * ผู้ใช้ upsert ด้วยอีเมลคงที่ไม่ลบ · แถวอื่นลบใน afterAll
 */
describe('CustomerJourneyService.list (real DB) — ชำระ 60 งวดเดินด้วย cursor', () => {
  const prisma = new PrismaClient();
  const service = new CustomerJourneyService(prisma as unknown as PrismaService);
  const stamp = Date.now();
  const OWNER = { id: 'owner-spec', role: 'OWNER' };
  const dec = (value: string) => new Prisma.Decimal(value);
  const ids = { branch: '', customer: '', product: '', contract: '' };
  const paymentIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { email: 'journey-payments-cursor@example.test' },
      update: {},
      create: { email: 'journey-payments-cursor@example.test', password: 'journey-spec', name: 'สเปคชำระ 60 งวด', role: 'OWNER' },
    });
    ids.branch = (await prisma.branch.create({ data: { name: `journey payments spec ${stamp}` } })).id;
    ids.customer = (await prisma.customer.create({ data: { name: `journey payments spec ${stamp}` } })).id;
    ids.product = (await prisma.product.create({
      data: { name: 'journey payments phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: dec('20000.00'), branchId: ids.branch, imeiSerial: `JPC-${stamp}` },
    })).id;
    ids.contract = (await prisma.contract.create({
      data: {
        contractNumber: `JPC-${stamp}`, customerId: ids.customer, productId: ids.product, branchId: ids.branch, salespersonId: user.id, planType: 'STORE_WITH_INTEREST',
        sellingPrice: dec('72000.00'), downPayment: dec('0.00'), interestRate: dec('0.0000'), totalMonths: 60, interestTotal: dec('0.00'),
        financedAmount: dec('72000.00'), monthlyPayment: dec('1200.00'), status: 'ACTIVE',
      },
    })).id;
    for (let n = 1; n <= 60; n += 1) {
      const row = await prisma.payment.create({
        data: {
          contractId: ids.contract, installmentNo: n, dueDate: new Date(Date.UTC(2026, 0, n)), amountDue: dec('1200.00'), amountPaid: dec('1200.00'),
          status: 'PAID', updatedAt: new Date(Date.UTC(2026, 0, n, 3)),
        },
      });
      paymentIds.push(row.id);
    }
  }, 60_000);

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { contractId: ids.contract } });
    await prisma.contract.deleteMany({ where: { id: ids.contract } });
    await prisma.product.deleteMany({ where: { id: ids.product } });
    await prisma.customer.deleteMany({ where: { id: ids.customer } });
    await prisma.branch.deleteMany({ where: { id: ids.branch } });
    await prisma.$disconnect();
  }, 60_000);

  it('limit 30: หน้าแรก 30 + nextCursor · หน้าสอง 30 ไม่มี cursor · รวม 60 ตรงกับทุกงวด เรียงใหม่→เก่า', async () => {
    const walked: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const result = await service.list(ids.customer, { groups: ['payment'], limit: 30, cursor }, OWNER);
      if (!('events' in result)) throw new Error('ได้ redirect');
      walked.push(...result.events.map((event) => event.id));
      pageSizes.push(result.events.length);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(pageSizes).toEqual([30, 30]);
    expect(new Set(walked).size).toBe(60);
    expect([...walked].sort()).toEqual(paymentIds.map((id) => `payment-${id}`).sort());
    expect(walked[0]).toBe(`payment-${paymentIds[59]}`);
    expect(walked[59]).toBe(`payment-${paymentIds[0]}`);
  }, 60_000);
});
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/dto src/modules/customer-journey/customer-journey.service.spec.ts src/modules/customer-journey/customer-journey.pdpa.db.spec.ts src/modules/customer-journey/customer-journey.payments-cursor.db.spec.ts --runInBand` → Expected: FAIL `Cannot find module './journey-list-query.dto'` / `'./customer-journey.service'`

- [ ] **Step 13: DTO + `CustomerJourneyService`**

`dto/journey-list-query.dto.ts`:
```ts
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { JOURNEY_EVENT_GROUPS, type JourneyEventGroup } from '@installment/shared';

/** csv หรือ key ซ้ำ → string[] (ท่าเดียวกับ splitCsv ของ overdue/dto/queue-query.dto.ts:62-70) */
function splitCsv(value: unknown): unknown {
  const parts = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : null;
  return parts ? parts.flatMap((p) => p.split(',')).map((p) => p.trim()).filter(Boolean) : value;
}

/** GET /customers/:id/journey — ไม่ส่ง groups = JOURNEY_DEFAULT_GROUPS (shared) */
export class JourneyListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 30;
  /** base64('isoTs|eventId') จาก nextCursor */
  @IsOptional() @IsString() @MaxLength(512) @Matches(/^[A-Za-z0-9+/]+={0,2}$/) cursor?: string;
  @IsOptional() @Transform(({ value }) => splitCsv(value)) @IsArray() @ArrayMaxSize(JOURNEY_EVENT_GROUPS.length) @IsIn([...JOURNEY_EVENT_GROUPS], { each: true })
  groups?: JourneyEventGroup[];
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}
```
`customer-journey.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { JOURNEY_DEFAULT_GROUPS, JOURNEY_HIDDEN_GROUPS, type JourneyEventGroup, type JourneyListResponse, type JourneyRedirect } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { JourneyListQueryDto } from './dto/journey-list-query.dto';
import { chatSource } from './sources/chat.source';
import { collectionsSource } from './sources/collections.source';
import { creditSource } from './sources/credit.source';
import { entriesSource } from './sources/entries.source';
import { decodeJourneyCursor, mergeJourneyPage, type JourneyActor, type JourneySource, type JourneyWindow } from './sources/journey-window';
import { paymentSource } from './sources/payment.source';
import { pointsSource } from './sources/points.source';
import { saleSource } from './sources/sale.source';
import { serviceSource } from './sources/service.source';

export const DEFAULT_JOURNEY_LIMIT = 30;

const SOURCES_BY_GROUP: Record<JourneyEventGroup, readonly JourneySource[]> = {
  chat: [chatSource, entriesSource], credit: [creditSource, entriesSource], sale: [saleSource, entriesSource],
  payment: [paymentSource], collections: [collectionsSource], service: [serviceSource], points: [pointsSource], system: [entriesSource],
};

/** ข้อความท้ายแท็บ "ระบบยังไม่เก็บ" (synthesis notRecordedToday ที่พนักงานต้องรู้) */
export const JOURNEY_NOT_RECORDED: readonly string[] = [
  'ใครในทีมตอบแชทในแอป Facebook (แสดงเป็น "ร้าน" ไม่ทราบชื่อ)',
  'ผู้เปิดตรวจเครดิต ผล AI ประเมินเครดิต และบอทส่งต่อพนักงาน ก่อนวันที่ระบบเริ่มเก็บ',
  'รอบตีกลับสัญญาก่อนรอบล่าสุด ก่อนวันที่ระบบเริ่มเก็บ',
  'เวลาที่ได้เบอร์ของผู้สนใจ และเวลาผูก LINE ร้าน ก่อนวันที่ระบบเริ่มเก็บ',
  'ลูกค้ากดมาจากโฆษณา (ยังไม่มีข้อมูลโฆษณาเข้าระบบ)',
  'ลูกค้าหน้าร้านรู้จักร้านจากไหน',
  'ผู้ถอดแท็ก การบล็อก/เลิกติดตาม LINE และการเข้าชมเว็บ',
];

/** ไม่ส่ง groups = JOURNEY_DEFAULT_GROUPS · ตัด JOURNEY_HIDDEN_GROUPS[role] (ACCOUNTANT ไม่เห็นแชท · SALES ไม่เห็นยอดชำระ/ติดตามหนี้ — รอเจ้าของเคาะ ข้อ 5 · ชุดเดียวกับเว็บ) */
export function resolveJourneyGroups(requested: readonly JourneyEventGroup[] | undefined, role: string): Set<JourneyEventGroup> {
  const hidden = new Set<JourneyEventGroup>(JOURNEY_HIDDEN_GROUPS[role] ?? []);
  return new Set((requested?.length ? requested : JOURNEY_DEFAULT_GROUPS).filter((g) => !hidden.has(g)));
}

export const sourcesForGroups = (groups: ReadonlySet<JourneyEventGroup>): JourneySource[] => [...new Set([...groups].flatMap((g) => SOURCES_BY_GROUP[g]))];

@Injectable()
export class CustomerJourneyService {
  constructor(private readonly prisma: PrismaService) {}

  async list(customerId: string, query: JourneyListQueryDto, actor: JourneyActor): Promise<JourneyListResponse | JourneyRedirect> {
    const before = query.cursor ? decodeJourneyCursor(query.cursor) : undefined;
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, deletedAt: true, mergedIntoId: true } });
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
    if (customer.deletedAt) {
      // ลิงก์เก่าที่ชี้ placeholder — chain ถูกยุบเหลือชั้นเดียวตอนรวม
      if (customer.mergedIntoId) return { redirectToCustomerId: customer.mergedIntoId };
      throw new NotFoundException('ไม่พบลูกค้า');
    }
    const merged = await this.prisma.customer.findMany({ where: { mergedIntoId: customerId }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const mergedCustomerIds = merged.map((row) => row.id);
    const groups = resolveJourneyGroups(query.groups, actor.role);
    const window: JourneyWindow = { limit: query.limit ?? DEFAULT_JOURNEY_LIMIT, before, from: query.from ? new Date(query.from) : undefined, to: query.to ? new Date(query.to) : undefined };
    const perSource = await Promise.all(sourcesForGroups(groups).map((source) => source(this.prisma, [customerId, ...mergedCustomerIds], window, actor)));
    const { events, nextCursor } = mergeJourneyPage(perSource, window.limit, groups);
    return { customerId, mergedCustomerIds, events, nextCursor, notRecorded: [...JOURNEY_NOT_RECORDED] };
  }
}
```
Run เทส Step 12 → Expected: PASS (DTO 6 · service 4 · PDPA 4 · payments-cursor 1)

- [ ] **Step 14: เทสแดง — controller**

`customer-journey.controller.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { BranchGuard } from '../auth/guards/branch.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CustomerJourneyController } from './customer-journey.controller';
import { CustomerJourneyService } from './customer-journey.service';
import { JourneyListQueryDto } from './dto/journey-list-query.dto';

describe('CustomerJourneyController', () => {
  const service = { list: jest.fn() };
  let controller: CustomerJourneyController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const allow = { canActivate: () => true };
    const module = await Test.createTestingModule({ controllers: [CustomerJourneyController], providers: [{ provide: CustomerJourneyService, useValue: service }] })
      .overrideGuard(JwtAuthGuard).useValue(allow).overrideGuard(RolesGuard).useValue(allow).overrideGuard(BranchGuard).useValue(allow).compile();
    controller = module.get(CustomerJourneyController);
  });

  it('GET customers/:id/journey เปิด 5 บทบาทเดียวกับหน้ารายละเอียดลูกค้า · ส่งต่อเฉพาะ id/role', async () => {
    expect(Reflect.getMetadata(PATH_METADATA, CustomerJourneyController)).toBe('customers');
    expect(Reflect.getMetadata(PATH_METADATA, CustomerJourneyController.prototype.list)).toBe(':id/journey');
    expect(Reflect.getMetadata(ROLES_KEY, CustomerJourneyController.prototype.list)).toEqual(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']);
    const query = Object.assign(new JourneyListQueryDto(), { limit: 6 });
    const user = { id: 'u1', role: 'SALES', branchId: 'b1' };
    service.list.mockResolvedValue({ redirectToCustomerId: 'c2' });
    await expect(controller.list('c1', query, user)).resolves.toEqual({ redirectToCustomerId: 'c2' });
    expect(service.list).toHaveBeenCalledWith('c1', query, { id: 'u1', role: 'SALES' });
  });
});
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/customer-journey.controller.spec.ts --runInBand` → Expected: FAIL `Cannot find module './customer-journey.controller'`

- [ ] **Step 15: controller + ลงทะเบียนโมดูล**

`customer-journey.controller.ts`:
```ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BranchGuard } from '../auth/guards/branch.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JourneyListResponse, JourneyRedirect } from '@installment/shared';
import { CustomerJourneyService } from './customer-journey.service';
import { JourneyListQueryDto } from './dto/journey-list-query.dto';

@ApiTags('Customer Journey')
@ApiBearerAuth('JWT')
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class CustomerJourneyController {
  constructor(private readonly journey: CustomerJourneyService) {}

  @Get(':id/journey')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'การเดินทางของลูกค้า — แชท เครดิต การขาย ชำระเงิน ติดตามหนี้ บริการ แต้ม (keyset cursor)' })
  list(@Param('id') id: string, @Query() query: JourneyListQueryDto, @CurrentUser() user: { id: string; role: string }): Promise<JourneyListResponse | JourneyRedirect> {
    return this.journey.list(id, query, { id: user.id, role: user.role });
  }
}
```
`customer-journey.module.ts` — เขียนทับทั้งไฟล์ (คง provider/export ของ Task 2-3):
```ts
import { Module } from '@nestjs/common';
import { CustomerJourneyController } from './customer-journey.controller';
import { CustomerJourneyService } from './customer-journey.service';
import { JourneyEntryWriter } from './journey-entry-writer.service';
import { JourneyStateService } from './journey-state.service';

/**
 * การเดินทางของลูกค้า — ไม่ import โมดูลอื่น (PrismaModule เป็น @Global)
 * ⇒ ChatProspectsModule (CustomerMergeService) และโมดูลที่มี hook import โมดูลนี้ได้โดยไม่เกิดวงจร
 * Task 9 เพิ่ม JourneySummaryService + CustomerJourneyCron
 */
@Module({
  controllers: [CustomerJourneyController],
  providers: [JourneyEntryWriter, JourneyStateService, CustomerJourneyService],
  exports: [JourneyEntryWriter, JourneyStateService],
})
export class CustomerJourneyModule {}
```
`app.module.ts` ไม่แตะ — ตรวจว่า Task 2 ลงทะเบียนไว้ครั้งเดียว: `grep -c "CustomerJourneyModule" src/app.module.ts` → Expected: `2` (import + อาร์เรย์ imports)
Run เทส Step 14 + `src/modules/customer-journey/customer-journey.module.spec.ts` (ของ Task 3) → Expected: PASS 2 tests

- [ ] **Step 16: ตรวจรวม**
```bash
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey src/modules/credit-check src/modules/overdue/timeline.service src/modules/customers/customers.controller.spec.ts --runInBand
npx tsc --noEmit -p tsconfig.json
npx eslint src/modules/customer-journey/sources/*.ts src/modules/customer-journey/dto/journey-list-query.dto.ts src/modules/customer-journey/dto/journey-list-query.dto.spec.ts src/modules/customer-journey/customer-journey.service.ts src/modules/customer-journey/customer-journey.service.spec.ts src/modules/customer-journey/customer-journey.pdpa.db.spec.ts src/modules/customer-journey/customer-journey.controller.ts src/modules/customer-journey/customer-journey.controller.spec.ts src/modules/customer-journey/customer-journey.module.ts src/modules/credit-check/services/room-credit-access.ts src/modules/credit-check/services/room-credit-access.spec.ts src/modules/customer-journey/customer-journey.payments-cursor.db.spec.ts
grep -rn "text: true\|notes: true\|note: true\|phone: true\|nationalId: true\|address[A-Za-z]*: true\|voidReason: true\|messageContent" src/modules/customer-journey/sources/*.source.ts
```
Expected: jest PASS ทั้งหมด (golden ของ Task 7 ยังเขียว) · tsc 0 error · eslint 0 problem · grep สุดท้ายไม่มีผล

- [ ] **Step 17: Commit** (จาก root ของ worktree)
```bash
git add apps/api/src/modules/customer-journey/sources/journey-window.ts apps/api/src/modules/customer-journey/sources/journey-window.spec.ts \
  apps/api/src/modules/customer-journey/sources/chat.source.ts apps/api/src/modules/customer-journey/sources/chat.source.db.spec.ts \
  apps/api/src/modules/customer-journey/sources/credit.source.ts apps/api/src/modules/customer-journey/sources/sale.source.ts apps/api/src/modules/customer-journey/sources/credit-sale.source.spec.ts \
  apps/api/src/modules/customer-journey/sources/contract-timeline.ts apps/api/src/modules/customer-journey/sources/payment.source.ts apps/api/src/modules/customer-journey/sources/collections.source.ts \
  apps/api/src/modules/customer-journey/sources/service.source.ts apps/api/src/modules/customer-journey/sources/points.source.ts apps/api/src/modules/customer-journey/sources/contract-service-points.source.spec.ts \
  apps/api/src/modules/customer-journey/sources/entries.source.ts apps/api/src/modules/customer-journey/sources/entries.source.spec.ts \
  apps/api/src/modules/customer-journey/dto/journey-list-query.dto.ts apps/api/src/modules/customer-journey/dto/journey-list-query.dto.spec.ts \
  apps/api/src/modules/customer-journey/customer-journey.service.ts apps/api/src/modules/customer-journey/customer-journey.service.spec.ts apps/api/src/modules/customer-journey/customer-journey.pdpa.db.spec.ts apps/api/src/modules/customer-journey/customer-journey.payments-cursor.db.spec.ts \
  apps/api/src/modules/customer-journey/customer-journey.controller.ts apps/api/src/modules/customer-journey/customer-journey.controller.spec.ts apps/api/src/modules/customer-journey/customer-journey.module.ts \
  apps/api/src/modules/credit-check/services/room-credit-access.ts apps/api/src/modules/credit-check/services/room-credit-access.spec.ts
git commit -m "feat(api): GET /customers/:id/journey — ไทม์ไลน์การเดินทางของลูกค้าจาก 8 แหล่ง พร้อม cursor สิทธิ์ตามบทบาท และ PDPA snapshot

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: สรุปขั้นการเดินทาง `GET /customers/:id/journey/summary` (ตรวจ BOUGHT สด · กติกาแคช 15 นาที) + `include` (`summary` · `counts` ขอเมื่อใช้) ของ list + cron `journey:recompute` / `journey:entry-guard`

งานนี้คือครึ่ง "summary" ที่แยกจากแคชของ Task 3: ตัวตรวจความเคลื่อนไหว · ตัวประกอบ summary · endpoint · ตัวเลขบนชิปของหน้าแรก · cron สองตัว

> กติกาเวลา: ฐานเก็บ `timestamp without time zone` เป็น UTC และ session ของฐานทดสอบเป็น `Asia/Bangkok` ⇒ SQL รับเวลาเป็นสตริง ISO แล้ว `::timestamp` ห้าม `now()`/`timestamptz` · PDPA: SQL อ่านแค่เวลา ไม่อ่าน `chat_messages.text`, `note`, `call_logs.notes` · summary ไม่มีเบอร์/เลขบัตร/ที่อยู่

**Files:**
- Create: `apps/api/src/modules/customer-journey/sql/journey-activity-probe.sql`
- Create: `apps/api/src/modules/customer-journey/sql/journey-active-since.sql`
- Modify: `apps/api/src/modules/customer-journey/journey-state.service.ts` (ไฟล์ของ Task 3 — เขียนทับทั้งไฟล์ เพิ่ม 3 เมธอด · สามเมธอดเดิมคงเดิม)
- Create: `apps/api/src/modules/customer-journey/journey-state.activity.db.spec.ts`
- Create: `apps/api/src/modules/customer-journey/journey-summary.builder.ts` + `journey-summary.builder.spec.ts`
- Create: `apps/api/src/modules/customer-journey/journey-summary.service.ts` + `journey-summary.service.db.spec.ts`
- Create: `apps/api/src/modules/customer-journey/customer-journey.cron.ts` + `customer-journey.cron.spec.ts`
- Create: `apps/api/src/modules/customer-journey/customer-journey.controller.summary.spec.ts`
- Modify: `apps/api/src/modules/customer-journey/customer-journey.service.ts` + `customer-journey.service.spec.ts` (ไฟล์ของ Task 8 — เขียนทับทั้งสองไฟล์)
- Modify: `apps/api/src/modules/customer-journey/dto/journey-list-query.dto.ts` + `journey-list-query.dto.spec.ts` (ไฟล์ของ Task 8 — เขียนทับ)
- Modify: `apps/api/src/modules/customer-journey/customer-journey.controller.ts` (ไฟล์ของ Task 8 — เขียนทับ)
- Modify: `apps/api/src/modules/customer-journey/customer-journey.pdpa.db.spec.ts` + `customer-journey.payments-cursor.db.spec.ts` (ไฟล์ของ Task 8 — บรรทัดสร้าง service + import · PDPA เพิ่ม 1 เทส)
- Modify: `apps/api/src/modules/customer-journey/customer-journey.module.ts` (เขียนทับ)
- Modify: `apps/api/package.json:8` (`verify:assets` ตรวจ SQL ครบ 3 ไฟล์)

**Interfaces:**
- Consumes:
  - Task 1 — Prisma `customerJourneyState` · `customerJourneyEntry` (`kind`, `occurredAt`, `outcome`, `refId`, `deletedAt`, `createdAt`) · `Customer.mergedIntoId` · `@installment/shared`: `JOURNEY_STAGES`, `JourneyStage`, `STAGE_LABELS`, `JOURNEY_EVENT_GROUPS`, `JourneyEvent`, `JourneyEventGroup`, `JourneyListResponse` (มี `summary?` และ `counts?`), `JourneyRedirect`, `JourneySummary` = `{ stage; stageLabel; stageEnteredAt; daysInStage; path; steps: { stage; label; at; state: 'done'|'current'|'skipped'|'todo'; evidence: 'SYSTEM'|'MANUAL' }[]; firstChannel; firstSource; firstSourceLabel; firstAd; heardFrom; contactedAt; firstStaffReplyAt; firstPurchaseAt; lastCustomerAt; lastTouchAt; silentDays; lost; postSaleBadges; creditRejected }`
  - Task 1 — `@installment/shared`: `JOURNEY_DEFAULT_GROUPS` · `JOURNEY_HIDDEN_GROUPS` (กฎกลุ่มของ `resolveJourneyGroups`) · `JOURNEY_HEARD_FROM_LABELS` (ป้าย `HEARD:<รหัส>` ใน `firstSourceLabel`) — ห้ามประกาศซ้ำ
  - Task 3 — `JourneyStateService { recompute(customerIds: string[]): Promise<void>; recomputeAll(): Promise<number>; purchasedParity(): Promise<{ purchasedStates: number; bought: number }> }` · `export const BOUGHT_WHERE` (`customer-query.service.ts:43`) · asset glob `modules/customer-journey/sql/*.sql` ใน `nest-cli.json`
  - Task 5 — entry `CONTRACT_ACTIVATED` (`refType: 'contract'`, `refId: contracts.id`, `dedupeKey: 'CONTRACT_ACTIVATED:<contractId>'`)
  - Task 2 — `journeyDedupeKey` (seed ของเทส)
  - Task 8 — `CustomerJourneyService(prisma)` + `list` · `resolveJourneyGroups` · `sourcesForGroups` · `DEFAULT_JOURNEY_LIMIT` · `JOURNEY_NOT_RECORDED` · `CustomerJourneyController` (`@Controller('customers')` + `JwtAuthGuard, RolesGuard, BranchGuard`) · `JourneyListQueryDto` · `sources/journey-window.ts` (`mergeJourneyPage`, `decodeJourneyCursor`, `encodeJourneyCursor`, `JourneyWindow`, `JourneyActor`) · 8 แหล่งใน `sources/*.source.ts` (`finalizeSource` เรียงแล้วตัดที่ `limit + 1`) · `entriesSourceFor(groups: ReadonlySet<JourneyEventGroup>): JourneySource` (DB กรอง kind ตามกลุ่ม · แท็กเฉพาะ `system`)
  - ของเดิม: `calculateDaysElapsed` (`apps/api/src/utils/date.util.ts:16`) · `bangkokStartOfDay` (`:37`) · `addBkkDays` (`:64`) · `bangkokDateString` (`:102`) · `CUSTOMER_BOUGHT_CONTRACT_STATUSES` / `CUSTOMER_BOUGHT_SALE_TYPES` (`packages/shared/src/customer-sort.ts:61,73`)
- Produces:
  - `JourneyStateService` เพิ่ม: `hasActivitySince(familyIds: string[], since: Date): Promise<boolean>` · `activeCustomerIdsSince(since: Date): Promise<string[]>` · `contractsMissingActivationEntry(range: { gte: Date; lt: Date }): Promise<string[]>`
  - `JourneySummaryService { constructor(prisma: PrismaService, journeyState: JourneyStateService); summary(customerId: string, actor: { id: string; role: string }): Promise<JourneySummary | JourneyRedirect> }`
    - กติกา: placeholder ที่รวมแล้ว → `{ redirectToCustomerId }` · ลบด้วยเหตุอื่น/ไม่มี → 404 `ไม่พบลูกค้า` · คำนวณแคชใหม่ในคำขอเมื่อ ไม่มีแคช / แคช PURCHASED ไม่ตรง BOUGHT สด / แคชเก่ากว่า `STALE_AFTER_MS = 900000` และครอบครัวขยับหลัง `computedAt` · คำนวณใหม่ล้ม = ใช้แคชเดิม (ถ้ามี) · ผลเสมอผ่าน `withLiveBought` (ขั้นซื้อแล้วตรง BOUGHT_WHERE สดทุกครั้ง)
  - pure (`journey-summary.builder.ts`): `interface JourneyStateRow` · `interface JourneySummaryExtras` · `STALE_AFTER_MS` · `buildJourneySummary(state: JourneyStateRow, extras: JourneySummaryExtras, now: Date): JourneySummary` · `withLiveBought(state: JourneyStateRow, bought: boolean, now: Date): JourneyStateRow` · `firstSourceLabel(firstSource: string, firstAd: { name: string } | null): string` · `postSaleBadges(input: { latestContractStatus: string | null; purchaseCount: number; hasRepairTicket: boolean; skipTracingLost: boolean }): string[]`
  - `CustomerJourneyService { constructor(prisma: PrismaService, summaries: JourneySummaryService); list(customerId, query, actor): Promise<JourneyListResponse | JourneyRedirect>; summary(customerId, actor): Promise<JourneySummary | JourneyRedirect> }`
    - `include` เป็น csv (`summary` · `counts`) มีผลเฉพาะหน้าแรก (ไม่มี cursor) · ไม่ขอ `counts` = พฤติกรรมเดิมของ Task 8 (แหล่งของกลุ่มที่ขอด้วย limit จริง ไม่มี `counts`) — การ์ดกิจกรรมล่าสุดจึงไม่จ่ายค่าสแกน
    - `include` มี `counts`: สแกนทุกแหล่งที่บทบาทเห็นครั้งเดียวด้วย `limit = max(limit, JOURNEY_COUNT_CAP)` — entries สแกนทีละกลุ่มด้วย `entriesSourceFor(new Set([g]))` (chat/credit/sale/system ที่บทบาทเห็น) เพื่อไม่ให้แถวใหม่ของกลุ่มหนึ่งดันแถวของอีกกลุ่มหลุดเพดาน → `counts: Partial<Record<JourneyEventGroup, number>>` (ทุกกลุ่มที่บทบาทเห็น นับ id ไม่ซ้ำ ไม่เกิน `JOURNEY_COUNT_CAP = 100` · ถึงเพดาน = อย่างน้อยเท่านี้) + หน้าตัดจากผลเดียวกัน
    - `include` มี `summary` → แนบ `summary` (ถ้า summary ตอบ redirect ไม่แนบ) · **คงไว้ให้ตรงแบบ แต่เฟส 1 ไม่มีผู้ใช้ฝั่งเว็บ** (Task 12 ดึง `/summary` แยกเพราะแถบขั้นแสดงทุกแท็บ)
    - หน้าถัดไป (มี cursor): พฤติกรรมเดิมของ Task 8 (ไม่มี `counts`/`summary` แม้ส่ง `include`)
    - `export const JOURNEY_COUNT_CAP = 100` · `export function countJourneyGroups(lists: readonly JourneyEvent[][], groups: ReadonlySet<JourneyEventGroup>): Partial<Record<JourneyEventGroup, number>>`
  - `JOURNEY_LIST_INCLUDES = ['summary','counts'] as const` · `type JourneyListInclude` · `JourneyListQueryDto.include?: JourneyListInclude[]` (csv ผ่าน `splitCsv` · `@IsIn(JOURNEY_LIST_INCLUDES, { each: true })`)
  - `GET /customers/:id/journey/summary` roles `OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT, SALES` → `JourneySummary` | `JourneyRedirect` | 404
  - `CustomerJourneyCron` — `@Cron('30 3 * * *', { name: 'journey:recompute', timeZone: 'Asia/Bangkok' }) recomputeDaily(now?: Date): Promise<{ mode: 'sweep' | 'active'; recomputed: number; purchasedStates: number; bought: number }>` (วันอาทิตย์เวลาไทย = `recomputeAll` · วันอื่น = คนที่ขยับใน 48 ชม. · PURCHASED ≠ BOUGHT_WHERE → Sentry error) · `@Cron('0 4 * * *', { name: 'journey:entry-guard', timeZone: 'Asia/Bangkok' }) entryGuard(now?: Date): Promise<{ missing: number }>` (ใบขายผ่อนของเมื่อวานเวลาไทยที่ขาด entry → Sentry error)
  - `CustomerJourneyModule` providers `[JourneyEntryWriter, JourneyStateService, JourneySummaryService, CustomerJourneyService, CustomerJourneyCron]` · exports `[JourneyEntryWriter, JourneyStateService]` · ไม่มี imports

- [ ] **Step 1: ตรวจของจาก Task 3 และ Task 8**

Run (จาก `apps/api`):
```bash
grep -n "async recompute\|async recomputeAll\|async purchasedParity" src/modules/customer-journey/journey-state.service.ts
grep -n "export const BOUGHT_WHERE" src/modules/customers/services/customer-query.service.ts
grep -n "export class CustomerJourneyService\|export function resolveJourneyGroups\|export const sourcesForGroups" src/modules/customer-journey/customer-journey.service.ts
grep -n "export function entriesSourceFor" src/modules/customer-journey/sources/entries.source.ts
grep -n "modules/customer-journey/sql" nest-cli.json
grep -n "ScheduleModule.forRoot" src/app.module.ts
DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" npx prisma migrate deploy
```
Expected: ทุก grep มีผลอย่างน้อย 1 บรรทัด (ขาดอันไหน = Task 3 หรือ Task 8 ยังไม่ลง หยุดก่อน) · `No pending migrations to apply.`

- [ ] **Step 2: เทสแดง — ตัวประกอบ summary (บริสุทธิ์)**

สร้าง `apps/api/src/modules/customer-journey/journey-summary.builder.spec.ts`:
```ts
import { JOURNEY_STAGES, STAGE_LABELS } from '@installment/shared';
import {
  buildJourneySummary,
  firstSourceLabel,
  postSaleBadges,
  withLiveBought,
  type JourneyStateRow,
  type JourneySummaryExtras,
} from './journey-summary.builder';

const NOW = new Date('2026-09-15T05:00:00.000Z');
const d = (iso: string) => new Date(iso);

function row(over: Partial<JourneyStateRow> = {}): JourneyStateRow {
  return {
    stage: 'CREDIT', stageEnteredAt: d('2026-09-10T05:00:00.000Z'), path: 'INSTALLMENT',
    contactedAt: d('2026-09-01T05:00:00.000Z'), identifiedAt: d('2026-09-03T05:00:00.000Z'), interestedAt: null,
    creditAt: d('2026-09-10T05:00:00.000Z'), firstPurchaseAt: null, firstStaffReplyAt: d('2026-09-01T06:00:00.000Z'),
    firstChannel: 'CHAT_FACEBOOK', firstSource: 'CHAT_FACEBOOK', firstAdCampaignId: null, heardFrom: null,
    lastCustomerAt: d('2026-09-12T05:00:00.000Z'), lastTouchAt: null, lostAt: null, lostReason: null,
    computedAt: d('2026-09-15T04:59:00.000Z'), ...over,
  };
}
const extras: JourneySummaryExtras = { firstAd: null, interestedByManualEntry: false, creditRejected: false, postSaleBadges: [] };

describe('buildJourneySummary', () => {
  it('ขั้น CREDIT: ก่อนหน้ามีเวลา=done ไม่มีเวลา=skipped · ถัดไป=todo · ค้างขั้น/เงียบเป็นวันเต็ม', () => {
    const s = buildJourneySummary(row(), extras, NOW);
    expect(s.steps.map((x) => [x.stage, x.state])).toEqual([
      ['CONTACTED', 'done'], ['IDENTIFIED', 'done'], ['INTERESTED', 'skipped'], ['CREDIT', 'current'], ['PURCHASED', 'todo'],
    ]);
    expect(s.steps.map((x) => x.label)).toEqual(JOURNEY_STAGES.map((k) => STAGE_LABELS[k]));
    expect(s).toMatchObject({
      stage: 'CREDIT', stageLabel: STAGE_LABELS.CREDIT, stageEnteredAt: '2026-09-10T05:00:00.000Z', daysInStage: 5,
      path: 'INSTALLMENT', firstSourceLabel: 'แชท Facebook', contactedAt: '2026-09-01T05:00:00.000Z',
      firstStaffReplyAt: '2026-09-01T06:00:00.000Z', firstPurchaseAt: null, silentDays: 3, lost: null,
      postSaleBadges: [], creditRejected: false,
    });
  });

  it('ซื้อเงินสดโดยไม่ตรวจเครดิต → CREDIT=skipped · silentDays=null · ป้ายหลังการขายแสดง · creditRejected ถูกปิด', () => {
    const s = buildJourneySummary(
      row({ stage: 'PURCHASED', path: 'CASH', creditAt: null, firstPurchaseAt: d('2026-09-14T05:00:00.000Z'), stageEnteredAt: d('2026-09-14T05:00:00.000Z') }),
      { ...extras, creditRejected: true, postSaleBadges: ['ซื้อซ้ำ'] },
      NOW,
    );
    expect(s.steps.find((x) => x.stage === 'CREDIT')?.state).toBe('skipped');
    expect(s.steps.find((x) => x.stage === 'PURCHASED')).toMatchObject({ state: 'current', at: '2026-09-14T05:00:00.000Z' });
    expect(s).toMatchObject({ silentDays: null, postSaleBadges: ['ซื้อซ้ำ'], creditRejected: false, daysInStage: 1 });
  });

  it('หลักฐานขั้นสนใจมาจากบันทึกมือ → MANUAL เฉพาะขั้นนั้น · ป้ายหลุดมีเหตุผล', () => {
    const s = buildJourneySummary(
      row({ stage: 'INTERESTED', interestedAt: d('2026-09-05T05:00:00.000Z'), creditAt: null, lostAt: d('2026-09-13T05:00:00.000Z'), lostReason: 'UNREACHABLE' }),
      { ...extras, interestedByManualEntry: true },
      NOW,
    );
    expect(s.steps.filter((x) => x.evidence === 'MANUAL').map((x) => x.stage)).toEqual(['INTERESTED']);
    expect(s.lost).toEqual({ at: '2026-09-13T05:00:00.000Z', reason: 'UNREACHABLE' });
  });
});

describe('withLiveBought', () => {
  it('แคชยังไม่ซื้อแต่ BOUGHT สดเป็นจริง → PURCHASED (ไม่มี firstPurchaseAt ใช้ now)', () => {
    expect(withLiveBought(row(), true, NOW)).toMatchObject({ stage: 'PURCHASED', stageEnteredAt: NOW });
  });
  it('แคชซื้อแล้วแต่ยกเลิกใบขายจน BOUGHT เป็นเท็จ → ถอยไปขั้นสูงสุดที่มีเวลา ล้าง firstPurchaseAt', () => {
    const r = withLiveBought(row({ stage: 'PURCHASED', firstPurchaseAt: d('2026-09-14T05:00:00.000Z') }), false, NOW);
    expect(r).toMatchObject({ stage: 'CREDIT', stageEnteredAt: d('2026-09-10T05:00:00.000Z'), firstPurchaseAt: null });
  });
  it('ตรงกันอยู่แล้ว → คืนแถวเดิม', () => {
    const r = row();
    expect(withLiveBought(r, false, NOW)).toBe(r);
  });
});

describe('firstSourceLabel / postSaleBadges', () => {
  it('ป้ายที่มา (คำเดียวกับ SOURCE_LABELS ของเว็บ)', () => {
    expect(firstSourceLabel('AD:1203', { name: 'iPhone ผ่อน 0%' })).toBe('โฆษณา: iPhone ผ่อน 0%');
    expect(firstSourceLabel('HEARD:FRIEND', null)).toBe('ลูกค้าบอกว่ารู้จักจาก เพื่อนแนะนำ');
    expect(firstSourceLabel('CHAT_LINE_SHOP', null)).toBe('แชท LINE ร้าน');
    expect(firstSourceLabel('REFERRAL', null)).toBe('คนแนะนำ');
    expect(firstSourceLabel('WALK_IN', null)).toBe('หน้าร้าน');
  });
  it('ป้ายหลังการขาย: สัญญาล่าสุด → ซื้อซ้ำ → ใบซ่อม → ติดตามตัวไม่ได้', () => {
    expect(postSaleBadges({ latestContractStatus: 'OVERDUE', purchaseCount: 2, hasRepairTicket: true, skipTracingLost: true }))
      .toEqual(['ค้างชำระ', 'ซื้อซ้ำ', 'มีใบซ่อม', 'ติดตามตัวไม่ได้']);
    expect(postSaleBadges({ latestContractStatus: 'EARLY_PAYOFF', purchaseCount: 1, hasRepairTicket: false, skipTracingLost: false })).toEqual(['ปิดสัญญาแล้ว']);
    expect(postSaleBadges({ latestContractStatus: null, purchaseCount: 1, hasRepairTicket: false, skipTracingLost: false })).toEqual([]);
  });
});
```
Run (จาก `apps/api`): `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-summary.builder.spec.ts --runInBand` → Expected: FAIL `Cannot find module './journey-summary.builder'`

- [ ] **Step 3: ตัวประกอบ summary**

สร้าง `apps/api/src/modules/customer-journey/journey-summary.builder.ts`:
```ts
import { JOURNEY_HEARD_FROM_LABELS, JOURNEY_STAGES, STAGE_LABELS, type JourneyStage, type JourneySummary } from '@installment/shared';
import { calculateDaysElapsed } from '../../utils/date.util';

/** แถว customer_journey_states (ชนิดเดียวกับ Prisma CustomerJourneyState ไม่รวม customerId) */
export interface JourneyStateRow {
  stage: string;
  stageEnteredAt: Date;
  path: string;
  contactedAt: Date;
  identifiedAt: Date | null;
  interestedAt: Date | null;
  creditAt: Date | null;
  firstPurchaseAt: Date | null;
  firstStaffReplyAt: Date | null;
  firstChannel: string;
  firstSource: string;
  firstAdCampaignId: string | null;
  heardFrom: string | null;
  lastCustomerAt: Date | null;
  lastTouchAt: Date | null;
  lostAt: Date | null;
  lostReason: string | null;
  computedAt: Date;
}

/** ค่าที่ไม่อยู่ในแคช — JourneySummaryService อ่านสดทุกคำขอ */
export interface JourneySummaryExtras {
  firstAd: { id: string; name: string } | null;
  interestedByManualEntry: boolean;
  creditRejected: boolean;
  postSaleBadges: string[];
}

type Step = JourneySummary['steps'][number];

/** แคชที่อายุไม่เกินนี้ถือว่าสด (ยกเว้นขั้นซื้อแล้วไม่ตรงกับ BOUGHT_WHERE สด) */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** คำเดียวกับ apps/web/src/pages/CustomersPage/components/sourceLabels.ts */
const SOURCE_LABELS: Record<string, string> = {
  CHAT_FACEBOOK: 'แชท Facebook',
  CHAT_LINE_SHOP: 'แชท LINE ร้าน',
  CHAT_LINE_FINANCE: 'แชท LINE การเงิน',
  CHAT_TIKTOK: 'แชท TikTok',
  CHAT_WEB: 'แชทหน้าเว็บ',
  REFERRAL: 'คนแนะนำ',
  WALK_IN: 'หน้าร้าน',
};

const CONTRACT_BADGES: Record<string, string> = {
  ACTIVE: 'ผ่อนอยู่', OVERDUE: 'ค้างชำระ', DEFAULT: 'ผิดนัด',
  COMPLETED: 'ปิดสัญญาแล้ว', EARLY_PAYOFF: 'ปิดสัญญาแล้ว', CANCELED: 'ปิดสัญญาแล้ว', TERMINATED: 'ปิดสัญญาแล้ว', CLOSED_BAD_DEBT: 'ปิดสัญญาแล้ว',
};

const iso = (value: Date | null) => (value ? value.toISOString() : null);

function stageTimes(state: JourneyStateRow): Record<JourneyStage, Date | null> {
  return {
    CONTACTED: state.contactedAt,
    IDENTIFIED: state.identifiedAt,
    INTERESTED: state.interestedAt,
    CREDIT: state.creditAt,
    PURCHASED: state.firstPurchaseAt,
  };
}

export function firstSourceLabel(firstSource: string, firstAd: { name: string } | null): string {
  if (firstSource.startsWith('AD:')) return firstAd ? `โฆษณา: ${firstAd.name}` : 'โฆษณา';
  if (firstSource.startsWith('HEARD:')) {
    const key = firstSource.slice('HEARD:'.length);
    return `ลูกค้าบอกว่ารู้จักจาก ${JOURNEY_HEARD_FROM_LABELS[key] ?? key}`;
  }
  return SOURCE_LABELS[firstSource] ?? 'ไม่ทราบ';
}

export function postSaleBadges(input: {
  latestContractStatus: string | null;
  purchaseCount: number;
  hasRepairTicket: boolean;
  skipTracingLost: boolean;
}): string[] {
  const badges: string[] = [];
  const contractBadge = input.latestContractStatus ? CONTRACT_BADGES[input.latestContractStatus] : undefined;
  if (contractBadge) badges.push(contractBadge);
  if (input.purchaseCount >= 2) badges.push('ซื้อซ้ำ');
  if (input.hasRepairTicket) badges.push('มีใบซ่อม');
  if (input.skipTracingLost) badges.push('ติดตามตัวไม่ได้');
  return badges;
}

/** แคชอาจตามไม่ทัน (recompute ล้ม) — ขั้นซื้อแล้วต้องตรงกับ BOUGHT_WHERE สดเสมอ */
export function withLiveBought(state: JourneyStateRow, bought: boolean, now: Date): JourneyStateRow {
  if (bought === (state.stage === 'PURCHASED')) return state;
  if (bought) return { ...state, stage: 'PURCHASED', stageEnteredAt: state.firstPurchaseAt ?? now };
  const times = stageTimes(state);
  const fallback = (['CREDIT', 'INTERESTED', 'IDENTIFIED'] as const).find((stage) => times[stage] !== null);
  return {
    ...state,
    stage: fallback ?? 'CONTACTED',
    stageEnteredAt: (fallback ? times[fallback] : null) ?? state.contactedAt,
    firstPurchaseAt: null,
  };
}

export function buildJourneySummary(state: JourneyStateRow, extras: JourneySummaryExtras, now: Date): JourneySummary {
  const stage = state.stage as JourneyStage;
  const current = JOURNEY_STAGES.indexOf(stage);
  const times = stageTimes(state);
  const purchased = stage === 'PURCHASED';
  const steps = JOURNEY_STAGES.map((key, index): Step => ({
    stage: key,
    label: STAGE_LABELS[key],
    at: iso(times[key]),
    state: index === current ? 'current' : index > current ? 'todo' : times[key] ? 'done' : 'skipped',
    evidence: key === 'INTERESTED' && extras.interestedByManualEntry ? 'MANUAL' : 'SYSTEM',
  }));
  const lastSeen = [state.lastCustomerAt, state.lastTouchAt, state.contactedAt]
    .filter((value): value is Date => value !== null)
    .reduce((a, b) => (a > b ? a : b));

  return {
    stage,
    stageLabel: STAGE_LABELS[stage],
    stageEnteredAt: state.stageEnteredAt.toISOString(),
    daysInStage: Math.max(0, calculateDaysElapsed(state.stageEnteredAt, now)),
    path: state.path as JourneySummary['path'],
    steps,
    firstChannel: state.firstChannel as JourneySummary['firstChannel'],
    firstSource: state.firstSource as JourneySummary['firstSource'],
    firstSourceLabel: firstSourceLabel(state.firstSource, extras.firstAd),
    firstAd: extras.firstAd,
    heardFrom: state.heardFrom as JourneySummary['heardFrom'],
    contactedAt: state.contactedAt.toISOString(),
    firstStaffReplyAt: iso(state.firstStaffReplyAt),
    firstPurchaseAt: iso(state.firstPurchaseAt),
    lastCustomerAt: iso(state.lastCustomerAt),
    lastTouchAt: iso(state.lastTouchAt),
    silentDays: purchased ? null : Math.max(0, calculateDaysElapsed(lastSeen, now)),
    lost: state.lostAt ? { at: state.lostAt.toISOString(), reason: state.lostReason ?? 'OTHER' } : null,
    postSaleBadges: purchased ? extras.postSaleBadges : [],
    creditRejected: !purchased && extras.creditRejected,
  };
}
```
Run เทส Step 2 → Expected: PASS 8 tests

- [ ] **Step 4: เทสแดง — ตัวตรวจความเคลื่อนไหว + entry-guard บน Postgres จริง**

สร้าง `apps/api/src/modules/customer-journey/journey-state.activity.db.spec.ts`:
```ts
import { Prisma, PrismaClient } from '@prisma/client';
import { JourneyStateService } from './journey-state.service';
import { journeyDedupeKey } from './journey-data-schemas';

/**
 * ตัวตรวจความเคลื่อนไหว (summary 15 นาที · cron 48 ชม.) และด่าน entry-guard กับ Postgres จริง
 * audit_logs ลบไม่ได้ (trigger audit_logs_no_delete) ⇒ ผู้ใช้ของ spec ถูกปล่อยไว้
 */
describe('JourneyStateService — ความเคลื่อนไหว + entry-guard (real DB)', () => {
  const prisma = new PrismaClient();
  const service = new JourneyStateService(prisma as any);
  const stamp = Date.now();
  const tail = String(stamp).slice(-7);
  const at = (value: string) => new Date(value);
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const saleIds: string[] = [];
  const contractIds: string[] = [];
  let branchId: string;
  let productId: string;
  let userId: string;

  async function customer(data: Prisma.CustomerUncheckedCreateInput) {
    const row = await prisma.customer.create({ data });
    customerIds.push(row.id);
    return row;
  }
  async function contract(customerId: string, status: 'ACTIVE' | 'OVERDUE', createdAt: string) {
    const row = await prisma.contract.create({
      data: {
        contractNumber: `JG-${tail}-${contractIds.length}`, customerId, productId, branchId, salespersonId: userId, planType: 'STORE_WITH_INTEREST',
        sellingPrice: 25000, downPayment: 5000, interestRate: 0.02, totalMonths: 10, interestTotal: 4000, financedAmount: 20000, monthlyPayment: 2400,
        status, createdAt: at(createdAt),
      },
    });
    contractIds.push(row.id);
    return row;
  }
  async function installmentSale(customerId: string, createdAt: string, contractId: string) {
    const row = await prisma.sale.create({
      data: { saleNumber: `JG-${tail}-${saleIds.length}`, saleType: 'INSTALLMENT', customerId, productId, branchId, salespersonId: userId, sellingPrice: 25000, netAmount: 25000, contractId, createdAt: at(createdAt) },
    });
    saleIds.push(row.id);
  }

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `journey activity spec ${stamp}` } })).id;
    userId = (await prisma.user.create({ data: { email: `journey-activity-${stamp}@spec.local`, password: 'x', name: 'journey activity spec' } })).id;
    productId = (await prisma.product.create({ data: { name: 'journey activity phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: 20000, branchId } })).id;
  });

  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.$disconnect();
  });

  it('placeholder ที่รวมแล้วขยับ → activeCustomerIdsSince ชี้กลับคนจริง · hasActivitySince ของครอบครัวตามเวลา', async () => {
    const target = await customer({ name: 'journey activity target', phone: `084${tail}` });
    const placeholder = await customer({
      name: 'journey activity placeholder', phone: null, acquisitionSource: 'CHAT_LINE_SHOP', deletedAt: new Date(), mergedIntoId: target.id,
    });
    const room = await prisma.chatRoom.create({ data: { channel: 'LINE_SHOP', externalUserId: `journey-activity-${stamp}`, customerId: target.id } });
    roomIds.push(room.id);
    await prisma.auditLog.create({ data: { userId, action: 'AI_LEAD_CAPTURED', entity: 'customer', entityId: placeholder.id } });

    const active = await service.activeCustomerIdsSince(new Date(Date.now() - 10 * 60_000));
    expect(active).toContain(target.id);
    expect(active).not.toContain(placeholder.id);
    expect(await service.hasActivitySince([target.id, placeholder.id], new Date(Date.now() - 60_000))).toBe(true);
    expect(await service.hasActivitySince([target.id, placeholder.id], new Date(Date.now() + 60_000))).toBe(false);
  });

  it('entry-guard: ใบขายผ่อนในช่วงเวลา → คืนเฉพาะสัญญาที่ยังไม่มี entry CONTRACT_ACTIVATED', async () => {
    const c = await customer({ name: 'journey guard installment', phone: `083${tail}`, createdAt: at('2031-01-01T00:00:00.000Z') });
    const k1 = await contract(c.id, 'ACTIVE', '2031-01-01T01:00:00.000Z');
    const k2 = await contract(c.id, 'OVERDUE', '2031-01-01T02:00:00.000Z');
    await installmentSale(c.id, '2031-01-01T05:00:00.000Z', k1.id);
    await installmentSale(c.id, '2031-01-01T06:00:00.000Z', k2.id);
    await prisma.customerJourneyEntry.create({
      data: {
        customerId: c.id, originCustomerId: c.id, origin: 'SYSTEM', kind: 'CONTRACT_ACTIVATED', occurredAt: at('2031-01-01T04:59:00.000Z'),
        actorType: 'STAFF', refType: 'contract', refId: k1.id, dedupeKey: journeyDedupeKey('CONTRACT_ACTIVATED', k1.id),
      },
    });

    expect(await service.contractsMissingActivationEntry({ gte: at('2031-01-01T00:00:00.000Z'), lt: at('2031-01-02T00:00:00.000Z') })).toEqual([k2.id]);
    expect(await service.contractsMissingActivationEntry({ gte: at('2031-01-02T00:00:00.000Z'), lt: at('2031-01-03T00:00:00.000Z') })).toEqual([]);
  });
});
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-state.activity.db.spec.ts --runInBand` → Expected: FAIL `Test suite failed to run` · `TS2339: Property 'activeCustomerIdsSince' does not exist on type 'JourneyStateService'`

- [ ] **Step 5: SQL สองไฟล์ + `JourneyStateService` ฉบับเต็ม + asset**

สร้าง `apps/api/src/modules/customer-journey/sql/journey-activity-probe.sql`:
```sql
-- journey-activity-probe.sql — ลูกค้าชุดนี้มีอะไรขยับหลัง $2 ไหม (summary ใช้ตัดสินว่าแคชที่เก่ากว่า 15 นาทีต้อง recompute)
-- $1 text[] id ลูกค้า + placeholder ที่รวมเข้ามา · $2 text เวลา ISO UTC · 🚨 ห้าม now() · PDPA: อ่านแค่เวลา
SELECT (
  EXISTS (SELECT 1 FROM customers c WHERE c.id = ANY($1::text[]) AND c.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM customer_journey_entries e WHERE e.customer_id = ANY($1::text[]) AND (e.created_at > $2::timestamp OR e.deleted_at > $2::timestamp))
  OR EXISTS (SELECT 1 FROM chat_rooms r WHERE r.customer_id = ANY($1::text[]) AND r.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM chat_rooms r JOIN chat_messages m ON m.room_id = r.id WHERE r.customer_id = ANY($1::text[]) AND m.created_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM chat_rooms r JOIN todos td ON td.room_id = r.id WHERE r.customer_id = ANY($1::text[]) AND td.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM chat_rooms r JOIN room_credit_analyses rca ON rca.room_id = r.id WHERE r.customer_id = ANY($1::text[]) AND rca.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM contracts k WHERE k.customer_id = ANY($1::text[]) AND k.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = ANY($1::text[]) AND s.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM credit_checks cc WHERE cc.customer_id = ANY($1::text[]) AND cc.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id = ANY($1::text[]) AND b.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM customer_line_links l WHERE l.customer_id = ANY($1::text[]) AND l.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM online_installment_applications a WHERE a.customer_id = ANY($1::text[]) AND a.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM product_reservations pr WHERE pr.customer_id = ANY($1::text[]) AND pr.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM trade_ins ti WHERE ti.customer_id = ANY($1::text[]) AND ti.updated_at > $2::timestamp)
  OR EXISTS (SELECT 1 FROM audit_logs al WHERE al.entity = 'customer' AND al.entity_id = ANY($1::text[]) AND al.action = 'AI_LEAD_CAPTURED' AND al.created_at > $2::timestamp)
) AS active
```

สร้าง `apps/api/src/modules/customer-journey/sql/journey-active-since.sql`:
```sql
-- journey-active-since.sql — id ลูกค้าปัจจุบัน (placeholder ที่รวมแล้วชี้ไปคนจริง) ที่ขยับตั้งแต่ $1 — cron journey:recompute
-- $1 text เวลา ISO UTC · 🚨 ห้าม now()
WITH hits AS (
  SELECT c.id AS member_id FROM customers c WHERE c.updated_at >= $1::timestamp
  UNION SELECT e.customer_id FROM customer_journey_entries e WHERE e.created_at >= $1::timestamp OR e.deleted_at >= $1::timestamp
  UNION SELECT r.customer_id FROM chat_rooms r WHERE r.updated_at >= $1::timestamp
  UNION SELECT r.customer_id FROM chat_messages m JOIN chat_rooms r ON r.id = m.room_id WHERE m.created_at >= $1::timestamp
  UNION SELECT r.customer_id FROM todos td JOIN chat_rooms r ON r.id = td.room_id WHERE td.updated_at >= $1::timestamp
  UNION SELECT r.customer_id FROM room_credit_analyses rca JOIN chat_rooms r ON r.id = rca.room_id WHERE rca.updated_at >= $1::timestamp
  UNION SELECT k.customer_id FROM contracts k WHERE k.updated_at >= $1::timestamp
  UNION SELECT s.customer_id FROM sales s WHERE s.updated_at >= $1::timestamp
  UNION SELECT cc.customer_id FROM credit_checks cc WHERE cc.updated_at >= $1::timestamp
  UNION SELECT b.customer_id FROM bookings b WHERE b.updated_at >= $1::timestamp
  UNION SELECT l.customer_id FROM customer_line_links l WHERE l.updated_at >= $1::timestamp
  UNION SELECT a.customer_id FROM online_installment_applications a WHERE a.updated_at >= $1::timestamp
  UNION SELECT pr.customer_id FROM product_reservations pr WHERE pr.updated_at >= $1::timestamp
  UNION SELECT ti.customer_id FROM trade_ins ti WHERE ti.updated_at >= $1::timestamp
  UNION SELECT al.entity_id FROM audit_logs al WHERE al.action = 'AI_LEAD_CAPTURED' AND al.entity = 'customer' AND al.created_at >= $1::timestamp
)
SELECT DISTINCT COALESCE(c.merged_into_id, c.id) AS customer_id
FROM hits h
JOIN customers c ON c.id = h.member_id
```

เขียนทับ `apps/api/src/modules/customer-journey/journey-state.service.ts` ทั้งไฟล์:
```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { CUSTOMER_BOUGHT_CONTRACT_STATUSES, CUSTOMER_BOUGHT_SALE_TYPES } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { BOUGHT_WHERE } from '../customers/services/customer-query.service';

const RECOMPUTE_BATCH = 500;
/** ไฟล์ SQL ถูกคัดลอกเข้า dist ผ่าน nest-cli.json assets และตรวจใน verify:assets */
const loadSql = (name: string) => readFileSync(join(__dirname, 'sql', name), 'utf8');

/**
 * แคช customer_journey_states — คำนวณได้ใหม่ทั้งหมดจากตารางต้นทาง ห้ามแก้มือ
 * ผู้เรียก: CustomerMergeService หลัง commit (Task 4) · JourneySummaryService ในคำขอ + CustomerJourneyCron (Task 9) · CLI backfill (Task 10)
 * สัญญา: ลูกค้าที่ deleted_at ไม่ว่าง (รวมผู้สนใจที่ถูกรวมแล้ว) ไม่มีแคชของตัวเองเสมอ · contactedAt/firstChannel/firstSource/firstAdCampaignId
 * เลื่อนได้เฉพาะไปค่าที่เก่ากว่า (ON CONFLICT ใน journey-state.sql)
 */
@Injectable()
export class JourneyStateService {
  private readonly stateSql = loadSql('journey-state.sql');
  private readonly probeSql = loadSql('journey-activity-probe.sql');
  private readonly activeSinceSql = loadSql('journey-active-since.sql');

  constructor(private readonly prisma: PrismaService) {}

  async recompute(customerIds: string[]): Promise<void> {
    const ids = [...new Set(customerIds.filter(Boolean))];
    const computedAt = new Date().toISOString();
    for (let i = 0; i < ids.length; i += RECOMPUTE_BATCH) {
      const batch = ids.slice(i, i + RECOMPUTE_BATCH);
      await this.prisma.$executeRawUnsafe(
        this.stateSql,
        batch,
        [...CUSTOMER_BOUGHT_CONTRACT_STATUSES],
        [...CUSTOMER_BOUGHT_SALE_TYPES],
        computedAt,
      );
      // placeholder ที่รวมแล้ว / ลูกค้าที่ถูกลบ ไม่มีแคชของตัวเอง
      await this.prisma.customerJourneyState.deleteMany({
        where: { customerId: { in: batch }, customer: { deletedAt: { not: null } } },
      });
    }
  }

  /** ทุกลูกค้าที่ยังไม่ถูกลบ ทีละ 500 (keyset ตาม id) — cron วันอาทิตย์ */
  async recomputeAll(): Promise<number> {
    let total = 0;
    let cursor: string | undefined;
    let more = true;
    while (more) {
      const rows = await this.prisma.customer.findMany({
        where: { deletedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: RECOMPUTE_BATCH,
        select: { id: true },
      });
      if (rows.length > 0) {
        await this.recompute(rows.map((row) => row.id));
        total += rows.length;
        cursor = rows[rows.length - 1].id;
      }
      more = rows.length === RECOMPUTE_BATCH;
    }
    return total;
  }

  /** ด่านความถูกต้อง: แคช PURCHASED ต้องเท่ากับจำนวนลูกค้าที่ BOUGHT_WHERE เป็นจริง */
  async purchasedParity(): Promise<{ purchasedStates: number; bought: number }> {
    const [purchasedStates, bought] = await Promise.all([
      this.prisma.customerJourneyState.count({ where: { stage: 'PURCHASED', customer: { deletedAt: null } } }),
      this.prisma.customer.count({ where: { AND: [{ deletedAt: null }, BOUGHT_WHERE] } }),
    ]);
    return { purchasedStates, bought };
  }

  /** familyIds = ลูกค้า + placeholder ที่ merged_into_id ชี้มา — summary ใช้ตัดสินว่าแคชที่เก่ากว่า 15 นาทีต้องคำนวณใหม่ไหม */
  async hasActivitySince(familyIds: string[], since: Date): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ active: boolean }>>(this.probeSql, familyIds, since.toISOString());
    return rows[0]?.active === true;
  }

  /** id ลูกค้าปัจจุบัน (placeholder ที่รวมแล้วชี้ไปคนจริง) ที่ขยับตั้งแต่ since — cron journey:recompute */
  async activeCustomerIdsSince(since: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ customer_id: string }>>(this.activeSinceSql, since.toISOString());
    return rows.map((row) => row.customer_id);
  }

  /** ใบขาย INSTALLMENT ถูกสร้างใน tx เดียวกับ activate — สัญญาที่ไม่มี entry CONTRACT_ACTIVATED (Task 5) = hook หลุด */
  async contractsMissingActivationEntry(range: { gte: Date; lt: Date }): Promise<string[]> {
    const sales = await this.prisma.sale.findMany({
      where: { saleType: 'INSTALLMENT', deletedAt: null, contractId: { not: null }, createdAt: range },
      select: { contractId: true },
    });
    const contractIds = sales.map((row) => row.contractId).filter((id): id is string => id !== null);
    if (contractIds.length === 0) return [];
    const entries = await this.prisma.customerJourneyEntry.findMany({
      where: { kind: 'CONTRACT_ACTIVATED', refId: { in: contractIds } },
      select: { refId: true },
    });
    const seen = new Set(entries.map((row) => row.refId));
    return contractIds.filter((id) => !seen.has(id)).sort();
  }
}
```

`apps/api/package.json` บรรทัด 8 (บรรทัด `verify:assets` ที่ Task 3 แก้) แทนทั้งบรรทัดด้วย:
```json
    "verify:assets": "node -e \"const fs=require('fs');for(const f of ['dist/src/modules/contracts/templates/hire-purchase-contract.html','dist/src/modules/customer-journey/sql/journey-state.sql','dist/src/modules/customer-journey/sql/journey-activity-probe.sql','dist/src/modules/customer-journey/sql/journey-active-since.sql']){if(!fs.existsSync(f)){console.error('❌ Missing critical asset:',f);process.exit(1)}}console.log('✓ Assets verified')\"",
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-state.activity.db.spec.ts src/modules/customer-journey/journey-state.service.spec.ts src/modules/customer-journey/journey-state.service.db.spec.ts --runInBand` → Expected: `Tests: 13 passed, 13 total` (activity 2 · unit ของ Task 3 = 3 · db ของ Task 3 = 8)

- [ ] **Step 6: เทสแดง — `JourneySummaryService` บน Postgres จริง**

สร้าง `apps/api/src/modules/customer-journey/journey-summary.service.db.spec.ts`:
```ts
import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { STAGE_LABELS } from '@installment/shared';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';

/** summary กับ Postgres จริง: ตรวจ BOUGHT สด · กติกา 15 นาที · redirect/404 · PDPA · ผู้ใช้ของ spec ถูกปล่อยไว้เพราะ audit_logs ลบไม่ได้ */
describe('JourneySummaryService.summary (real DB)', () => {
  const prisma = new PrismaClient();
  const state = new JourneyStateService(prisma as any);
  const service = new JourneySummaryService(prisma as any, state);
  const actor = { id: 'u1', role: 'SALES' };
  const stamp = Date.now();
  const tail = String(stamp).slice(-7);
  const customerIds: string[] = [];
  const saleIds: string[] = [];
  const contractIds: string[] = [];
  let branchId: string;
  let productId: string;
  let userId: string;

  async function walkIn(label: string, phone: string) {
    const row = await prisma.customer.create({ data: { name: `summary ${label}`, phone } });
    customerIds.push(row.id);
    return row;
  }
  async function cashSale(customerId: string) {
    const row = await prisma.sale.create({
      data: { saleNumber: `JSS-${tail}-${saleIds.length}`, saleType: 'CASH', customerId, productId, branchId, salespersonId: userId, sellingPrice: 9900, netAmount: 9900 },
    });
    saleIds.push(row.id);
  }
  const ageState = (customerId: string) =>
    prisma.customerJourneyState.update({ where: { customerId }, data: { computedAt: new Date(Date.now() - 60 * 60_000) } });

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `summary spec ${stamp}` } })).id;
    userId = (await prisma.user.create({ data: { email: `journey-summary-${stamp}@spec.local`, password: 'x', name: 'summary spec' } })).id;
    productId = (await prisma.product.create({ data: { name: 'summary phone', brand: 'Apple', model: 'iPhone 13', category: 'PHONE_USED', costPrice: 8000, branchId } })).id;
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.$disconnect();
  });

  it('ไม่มีแคช → คำนวณในคำขอ · แถบ 5 ขั้น · ไม่มีเบอร์ในคำตอบ · เรียกซ้ำภายใน 15 นาทีไม่คำนวณใหม่', async () => {
    const phone = `085${tail}`;
    const c = await walkIn('fresh', phone);
    const spy = jest.spyOn(state, 'recompute');
    const first = await service.summary(c.id, actor);
    expect(spy).toHaveBeenCalledWith([c.id]);
    expect(first).toMatchObject({ stage: 'IDENTIFIED', stageLabel: STAGE_LABELS.IDENTIFIED, firstSourceLabel: 'หน้าร้าน', creditRejected: false, postSaleBadges: [] });
    expect(JSON.stringify(first)).not.toContain(phone);
    spy.mockClear();
    await service.summary(c.id, actor);
    expect(spy).not.toHaveBeenCalled();
  });

  it('แคชยังไม่ซื้อ แต่ BOUGHT_WHERE สดเป็นจริง → คำนวณใหม่ทันทีแม้แคชยังไม่ถึง 15 นาที', async () => {
    const c = await walkIn('bought', `086${tail}`);
    await service.summary(c.id, actor);
    await cashSale(c.id);
    const res = await service.summary(c.id, actor);
    expect(res).toMatchObject({ stage: 'PURCHASED', path: 'CASH', silentDays: null });
    if (!('steps' in res)) throw new Error('คาดว่าเป็น JourneySummary');
    expect(res.steps.find((s) => s.stage === 'CREDIT')?.state).toBe('skipped');
  });

  it('แคชเก่ากว่า 15 นาที: มีความเคลื่อนไหวใหม่ → คำนวณใหม่ · ไม่มีอะไรขยับ → ใช้แคชเดิม', async () => {
    const moved = await walkIn('stale-moved', `087${tail}`);
    await service.summary(moved.id, actor);
    await ageState(moved.id);
    await prisma.creditCheck.create({ data: { customerId: moved.id } });
    expect(await service.summary(moved.id, actor)).toMatchObject({ stage: 'CREDIT', path: 'INSTALLMENT' });

    const idle = await walkIn('stale-idle', `088${tail}`);
    await service.summary(idle.id, actor);
    await ageState(idle.id);
    await prisma.$executeRawUnsafe('UPDATE customers SET updated_at = $1::timestamp WHERE id = $2', new Date(Date.now() - 2 * 60 * 60_000).toISOString(), idle.id);
    const spy = jest.spyOn(state, 'recompute');
    await service.summary(idle.id, actor);
    expect(spy).not.toHaveBeenCalled();
  });

  it('recompute ล้ม → ยังคืน PURCHASED สดจาก BOUGHT_WHERE บนแคชเก่า', async () => {
    const c = await walkIn('recompute-fails', `089${tail}`);
    await service.summary(c.id, actor);
    await cashSale(c.id);
    jest.spyOn(state, 'recompute').mockRejectedValueOnce(new Error('db down'));
    expect(await service.summary(c.id, actor)).toMatchObject({ stage: 'PURCHASED' });
    expect((await prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId: c.id } })).stage).toBe('IDENTIFIED');
  });

  it('placeholder ที่รวมแล้ว → redirectToCustomerId · ลบด้วยเหตุอื่น/ไม่มีอยู่ → 404', async () => {
    const target = await walkIn('target', `080${tail}`);
    const merged = await prisma.customer.create({ data: { name: 'summary merged', phone: null, acquisitionSource: 'CHAT_FACEBOOK', deletedAt: new Date(), mergedIntoId: target.id } });
    const removed = await prisma.customer.create({ data: { name: 'summary removed', phone: null, deletedAt: new Date() } });
    customerIds.push(merged.id, removed.id);
    expect(await service.summary(merged.id, actor)).toEqual({ redirectToCustomerId: target.id });
    await expect(service.summary(removed.id, actor)).rejects.toThrow(NotFoundException);
    await expect(service.summary('00000000-0000-0000-0000-000000000000', actor)).rejects.toThrow('ไม่พบลูกค้า');
  });

  it('ผู้จัดการตีตกเครดิตล่าสุด → creditRejected · นัดจากบันทึกมือ → evidence MANUAL', async () => {
    const c = await walkIn('rejected', `090${tail}`);
    const check = await prisma.creditCheck.create({ data: { customerId: c.id } });
    await prisma.auditLog.create({ data: { userId, action: 'CREDIT_CHECK_OVERRIDE', entity: 'credit_check', entityId: check.id, newValue: { status: 'REJECTED' } } });
    await prisma.customerJourneyEntry.create({
      data: { customerId: c.id, originCustomerId: c.id, origin: 'MANUAL', kind: 'TOUCHPOINT', channel: 'FB_APP', outcome: 'APPOINTED', occurredAt: new Date(Date.now() - 86_400_000), actorType: 'STAFF', actorUserId: userId },
    });
    const res = await service.summary(c.id, actor);
    expect(res).toMatchObject({ stage: 'CREDIT', creditRejected: true });
    if (!('steps' in res)) throw new Error('คาดว่าเป็น JourneySummary');
    expect(res.steps.find((s) => s.stage === 'INTERESTED')).toMatchObject({ state: 'done', evidence: 'MANUAL' });
  });

  it('ซื้อแล้ว: ป้ายหลังการขาย = สถานะสัญญาล่าสุด + ซื้อซ้ำ', async () => {
    const c = await walkIn('post-sale', `091${tail}`);
    await cashSale(c.id);
    const k = await prisma.contract.create({
      data: {
        contractNumber: `JSC-${tail}`, customerId: c.id, productId, branchId, salespersonId: userId, planType: 'STORE_WITH_INTEREST',
        sellingPrice: 25000, downPayment: 5000, interestRate: 0.02, totalMonths: 10, interestTotal: 4000, financedAmount: 20000, monthlyPayment: 2400, status: 'OVERDUE',
      },
    });
    contractIds.push(k.id);
    expect(await service.summary(c.id, actor)).toMatchObject({ stage: 'PURCHASED', postSaleBadges: ['ค้างชำระ', 'ซื้อซ้ำ'] });
  });
});
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/journey-summary.service.db.spec.ts --runInBand` → Expected: FAIL `Cannot find module './journey-summary.service'`

- [ ] **Step 7: `JourneySummaryService`**

สร้าง `apps/api/src/modules/customer-journey/journey-summary.service.ts`:
```ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ContractStatus, Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { CUSTOMER_BOUGHT_CONTRACT_STATUSES, CUSTOMER_BOUGHT_SALE_TYPES, type JourneyRedirect, type JourneySummary } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { BOUGHT_WHERE } from '../customers/services/customer-query.service';
import { JourneyStateService } from './journey-state.service';
import {
  buildJourneySummary,
  postSaleBadges,
  STALE_AFTER_MS,
  withLiveBought,
  type JourneyStateRow,
  type JourneySummaryExtras,
} from './journey-summary.builder';

const BOUGHT_CONTRACT_STATUSES = [...CUSTOMER_BOUGHT_CONTRACT_STATUSES] as ContractStatus[];
const BOUGHT_SALE_TYPES = [...CUSTOMER_BOUGHT_SALE_TYPES];

function isRejectedOverride(value: Prisma.JsonValue | undefined): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && value.status === 'REJECTED';
}

/**
 * แถบขั้นของหัวหน้าลูกค้า — อ่านแคช แล้วบังคับให้ขั้นซื้อแล้วตรงกับ BOUGHT_WHERE สดเสมอ
 * คำนวณแคชใหม่ในคำขอเมื่อ: ไม่มีแคช · แคช PURCHASED ไม่ตรง BOUGHT สด · แคชเก่ากว่า 15 นาทีและครอบครัว (ลูกค้า + placeholder ที่รวมเข้ามา) ขยับหลัง computedAt
 */
@Injectable()
export class JourneySummaryService {
  private readonly logger = new Logger(JourneySummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journeyState: JourneyStateService,
  ) {}

  /** ข้อมูลเท่ากันทุก role ที่เข้าได้ — ไม่มียอดชำระ/ติดตามหนี้ (actor เก็บไว้ให้สัญญาเดียวกับ list) */
  async summary(customerId: string, _actor: { id: string; role: string }): Promise<JourneySummary | JourneyRedirect> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, deletedAt: true, mergedIntoId: true, status: true },
    });
    if (customer?.deletedAt && customer.mergedIntoId) return { redirectToCustomerId: customer.mergedIntoId };
    if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');

    const now = new Date();
    const [absorbed, cached, boughtCount] = await Promise.all([
      this.prisma.customer.findMany({ where: { mergedIntoId: customerId }, select: { id: true } }),
      this.prisma.customerJourneyState.findUnique({ where: { customerId } }),
      this.prisma.customer.count({ where: { AND: [{ id: customerId }, BOUGHT_WHERE] } }),
    ]);
    const familyIds = [customerId, ...absorbed.map((row) => row.id)];
    const bought = boughtCount > 0;

    let state: JourneyStateRow | null = cached;
    if (await this.needsRecompute(cached, bought, familyIds, now)) {
      try {
        await this.journeyState.recompute([customerId]);
        state = await this.prisma.customerJourneyState.findUnique({ where: { customerId } });
      } catch (err) {
        this.logger.warn(`journey summary recompute ล้ม customer=${customerId}: ${err instanceof Error ? err.message : err}`);
        Sentry.captureException(err, { tags: { kind: 'customer-journey', op: 'summary-recompute' } });
        if (!cached) throw err;
      }
    }
    if (!state) throw new NotFoundException('ไม่พบลูกค้า');

    const live = withLiveBought(state, bought, now);
    return buildJourneySummary(live, await this.extras(live, familyIds, customer.status), now);
  }

  private async needsRecompute(cached: JourneyStateRow | null, bought: boolean, familyIds: string[], now: Date): Promise<boolean> {
    if (!cached) return true;
    if ((cached.stage === 'PURCHASED') !== bought) return true;
    if (now.getTime() - cached.computedAt.getTime() <= STALE_AFTER_MS) return false;
    return this.journeyState.hasActivitySince(familyIds, cached.computedAt);
  }

  private async extras(state: JourneyStateRow, familyIds: string[], customerStatus: string): Promise<JourneySummaryExtras> {
    const purchased = state.stage === 'PURCHASED';
    const [ad, manualInterest, creditChecks, latestContract, contractCount, saleCount, repairCount] = await Promise.all([
      state.firstAdCampaignId
        ? this.prisma.adsCampaign.findUnique({ where: { id: state.firstAdCampaignId }, select: { id: true, campaignName: true } })
        : Promise.resolve(null),
      state.interestedAt
        ? this.prisma.customerJourneyEntry.count({
            where: { customerId: { in: familyIds }, kind: 'TOUCHPOINT', outcome: { in: ['APPOINTED', 'VISITED'] }, deletedAt: null, occurredAt: state.interestedAt },
          })
        : Promise.resolve(0),
      purchased
        ? Promise.resolve([])
        : this.prisma.creditCheck.findMany({ where: { customerId: { in: familyIds }, deletedAt: null }, select: { id: true } }),
      purchased
        ? this.prisma.contract.findFirst({
            where: { customerId: { in: familyIds }, deletedAt: null, status: { in: BOUGHT_CONTRACT_STATUSES } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { status: true },
          })
        : Promise.resolve(null),
      purchased
        ? this.prisma.contract.count({ where: { customerId: { in: familyIds }, deletedAt: null, status: { in: BOUGHT_CONTRACT_STATUSES } } })
        : Promise.resolve(0),
      purchased
        ? this.prisma.sale.count({ where: { customerId: { in: familyIds }, deletedAt: null, saleType: { in: BOUGHT_SALE_TYPES } } })
        : Promise.resolve(0),
      purchased
        ? this.prisma.repairTicket.count({ where: { customerId: { in: familyIds }, deletedAt: null } })
        : Promise.resolve(0),
    ]);

    let creditRejected = false;
    if (creditChecks.length > 0) {
      const override = await this.prisma.auditLog.findFirst({
        where: { action: 'CREDIT_CHECK_OVERRIDE', entity: 'credit_check', entityId: { in: creditChecks.map((row) => row.id) } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { newValue: true },
      });
      creditRejected = isRejectedOverride(override?.newValue);
    }

    return {
      firstAd: ad ? { id: ad.id, name: ad.campaignName } : null,
      interestedByManualEntry: manualInterest > 0,
      creditRejected,
      postSaleBadges: purchased
        ? postSaleBadges({
            latestContractStatus: latestContract?.status ?? null,
            purchaseCount: contractCount + saleCount,
            hasRepairTicket: repairCount > 0,
            skipTracingLost: customerStatus === 'LOST',
          })
        : [],
    };
  }
}
```
Run เทส Step 6 → Expected: PASS 7 tests

- [ ] **Step 8: เทสแดง — cron**

สร้าง `apps/api/src/modules/customer-journey/customer-journey.cron.spec.ts`:
```ts
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { CustomerJourneyCron } from './customer-journey.cron';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

describe('CustomerJourneyCron', () => {
  const state = {
    recompute: jest.fn().mockResolvedValue(undefined),
    recomputeAll: jest.fn().mockResolvedValue(9000),
    activeCustomerIdsSince: jest.fn().mockResolvedValue(['c1', 'c2']),
    purchasedParity: jest.fn().mockResolvedValue({ purchasedStates: 10, bought: 10 }),
    contractsMissingActivationEntry: jest.fn().mockResolvedValue([]),
  };
  const cron = new CustomerJourneyCron(state as any);

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('วันธรรมดา 03:30 น. → คำนวณเฉพาะคนที่ขยับใน 48 ชม. · PURCHASED ตรง → ไม่เตือน', async () => {
    const now = new Date('2026-09-15T20:30:00.000Z'); // พุธ 16 ก.ย. 03:30 น. เวลาไทย
    await expect(cron.recomputeDaily(now)).resolves.toEqual({ mode: 'active', recomputed: 2, purchasedStates: 10, bought: 10 });
    expect(state.activeCustomerIdsSince).toHaveBeenCalledWith(new Date('2026-09-13T20:30:00.000Z'));
    expect(state.recompute).toHaveBeenCalledWith(['c1', 'c2']);
    expect(state.recomputeAll).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('วันอาทิตย์ (เวลาไทย) → คำนวณทุกคน · PURCHASED ไม่ตรง BOUGHT_WHERE → Sentry error', async () => {
    state.purchasedParity.mockResolvedValueOnce({ purchasedStates: 9, bought: 10 });
    const now = new Date('2026-09-19T20:30:00.000Z'); // อาทิตย์ 20 ก.ย. 03:30 น. เวลาไทย
    await expect(cron.recomputeDaily(now)).resolves.toMatchObject({ mode: 'sweep', recomputed: 9000 });
    expect(state.activeCustomerIdsSince).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'journey:recompute แคช PURCHASED ไม่เท่ากับ BOUGHT_WHERE',
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('recompute พัง → Sentry.captureException แล้วโยนต่อ', async () => {
    state.activeCustomerIdsSince.mockRejectedValueOnce(new Error('boom'));
    await expect(cron.recomputeDaily(new Date('2026-09-15T20:30:00.000Z'))).rejects.toThrow('boom');
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('entry-guard 04:00 น. ตรวจช่วง "เมื่อวาน" เวลาไทย · มีสัญญาขาด entry → Sentry error พร้อมจำนวน', async () => {
    state.contractsMissingActivationEntry.mockResolvedValueOnce(['k2']);
    await expect(cron.entryGuard(new Date('2026-09-15T21:00:00.000Z'))).resolves.toEqual({ missing: 1 });
    expect(state.contractsMissingActivationEntry).toHaveBeenCalledWith({
      gte: new Date('2026-09-14T17:00:00.000Z'),
      lt: new Date('2026-09-15T17:00:00.000Z'),
    });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'journey:entry-guard hook CONTRACT_ACTIVATED หลุด',
      expect.objectContaining({ level: 'error', extra: { day: '2026-09-15', missing: 1, contractIds: ['k2'] } }),
    );
  });
});
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/customer-journey.cron.spec.ts --runInBand` → Expected: FAIL `Cannot find module './customer-journey.cron'`

- [ ] **Step 9: cron**

สร้าง `apps/api/src/modules/customer-journey/customer-journey.cron.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { addBkkDays, bangkokDateString, bangkokStartOfDay } from '../../utils/date.util';
import { JourneyStateService } from './journey-state.service';

const ACTIVE_WINDOW_MS = 48 * 60 * 60 * 1000;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

@Injectable()
export class CustomerJourneyCron {
  private readonly logger = new Logger(CustomerJourneyCron.name);

  constructor(private readonly journeyState: JourneyStateService) {}

  /** 03:30 น. — คนที่ขยับใน 48 ชม. (วันอาทิตย์ = ทุกคน) แล้วเทียบจำนวน PURCHASED กับ BOUGHT_WHERE */
  @Cron('30 3 * * *', { name: 'journey:recompute', timeZone: 'Asia/Bangkok' })
  async recomputeDaily(
    now: Date = new Date(),
  ): Promise<{ mode: 'sweep' | 'active'; recomputed: number; purchasedStates: number; bought: number }> {
    try {
      const mode: 'sweep' | 'active' = new Date(now.getTime() + BANGKOK_OFFSET_MS).getUTCDay() === 0 ? 'sweep' : 'active';
      let recomputed: number;
      if (mode === 'sweep') {
        recomputed = await this.journeyState.recomputeAll();
      } else {
        const ids = await this.journeyState.activeCustomerIdsSince(new Date(now.getTime() - ACTIVE_WINDOW_MS));
        await this.journeyState.recompute(ids);
        recomputed = ids.length;
      }
      const parity = await this.journeyState.purchasedParity();
      const result = { mode, recomputed, ...parity };
      this.logger.log(`journey:recompute mode=${mode} recomputed=${recomputed} purchased=${parity.purchasedStates} bought=${parity.bought}`);
      if (parity.purchasedStates !== parity.bought) {
        Sentry.captureMessage('journey:recompute แคช PURCHASED ไม่เท่ากับ BOUGHT_WHERE', {
          level: 'error',
          tags: { kind: 'cron-job', cron: 'journey:recompute' },
          extra: result,
        });
      }
      return result;
    } catch (err) {
      this.logger.error(`journey:recompute failed: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'journey:recompute' } });
      throw err;
    }
  }

  /**
   * 04:00 น. — ใบขายผ่อนของเมื่อวาน (เวลาไทย) ต้องมี entry CONTRACT_ACTIVATED ครบ ถ้าขาด = hook หลุด
   * คืนแรกหลัง deploy อาจเตือนสัญญาที่เปิดก่อน deploy — ตรวจ contractIds ใน extra ก่อนสรุปว่าพัง
   */
  @Cron('0 4 * * *', { name: 'journey:entry-guard', timeZone: 'Asia/Bangkok' })
  async entryGuard(now: Date = new Date()): Promise<{ missing: number }> {
    try {
      const lt = bangkokStartOfDay(now);
      const gte = addBkkDays(lt, -1);
      const missing = await this.journeyState.contractsMissingActivationEntry({ gte, lt });
      if (missing.length > 0) {
        this.logger.warn(`journey:entry-guard missing CONTRACT_ACTIVATED=${missing.length}`);
        Sentry.captureMessage('journey:entry-guard hook CONTRACT_ACTIVATED หลุด', {
          level: 'error',
          tags: { kind: 'cron-job', cron: 'journey:entry-guard' },
          extra: { day: bangkokDateString(gte), missing: missing.length, contractIds: missing.slice(0, 50) },
        });
      }
      return { missing: missing.length };
    } catch (err) {
      this.logger.error(`journey:entry-guard failed: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'journey:entry-guard' } });
      throw err;
    }
  }
}
```
Run เทส Step 8 → Expected: PASS 4 tests

- [ ] **Step 10: เทสแดง — list หน้าแรก (`include=counts` · `include=summary`) · DTO · route summary**

เขียนทับ `apps/api/src/modules/customer-journey/customer-journey.service.spec.ts` ทั้งไฟล์:
```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { JourneyEvent, JourneyEventGroup, JourneyListResponse, JourneySummary } from '@installment/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import { CustomerJourneyService, JOURNEY_COUNT_CAP, countJourneyGroups, resolveJourneyGroups } from './customer-journey.service';
import type { JourneySummaryService } from './journey-summary.service';
import { chatSource } from './sources/chat.source';
import { collectionsSource } from './sources/collections.source';
import { creditSource } from './sources/credit.source';
import { entriesSource, entriesSourceFor } from './sources/entries.source';
import { decodeJourneyCursor, encodeJourneyCursor, type JourneySource } from './sources/journey-window';
import { paymentSource } from './sources/payment.source';
import { pointsSource } from './sources/points.source';
import { saleSource } from './sources/sale.source';
import { serviceSource } from './sources/service.source';

jest.mock('./sources/chat.source', () => ({ chatSource: jest.fn() }));
jest.mock('./sources/credit.source', () => ({ creditSource: jest.fn() }));
jest.mock('./sources/sale.source', () => ({ saleSource: jest.fn() }));
jest.mock('./sources/payment.source', () => ({ paymentSource: jest.fn() }));
jest.mock('./sources/collections.source', () => ({ collectionsSource: jest.fn() }));
jest.mock('./sources/service.source', () => ({ serviceSource: jest.fn() }));
jest.mock('./sources/points.source', () => ({ pointsSource: jest.fn() }));
jest.mock('./sources/entries.source', () => ({ entriesSource: jest.fn(), entriesSourceFor: jest.fn() }));

/** แหล่งจากตารางโดเมน (ไม่รวม entries) */
const DOMAIN = [chatSource, creditSource, saleSource, paymentSource, collectionsSource, serviceSource, pointsSource];
const ALL = [...DOMAIN, entriesSource];
const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString();
const ev = (id: string, timestamp: string, group: JourneyEventGroup): JourneyEvent => ({ id, type: 'TEST', group, stage: null, timestamp, title: id, actor: null, reliability: 'exact', origin: 'SOURCE' });
const OWNER = { id: 'o1', role: 'OWNER' };
const LIVE = { id: 'c1', deletedAt: null, mergedIntoId: null };
const SUMMARY = { stage: 'CREDIT', stageLabel: 'ตรวจเครดิต' } as unknown as JourneySummary;

/** แถว entries ที่ "DB" มี เรียงใหม่→เก่า — mock ตัดที่ limit+1 แบบ finalizeSource · entriesSourceFor ให้ DB กรองกลุ่มก่อนตัด */
let entryRows: JourneyEvent[] = [];
/** กลุ่มที่ entriesSourceFor ถูกเรียกอ่าน (หนึ่งสตริงต่อครั้ง) */
let entryScans: string[] = [];

function setup(customer: { id: string; deletedAt: Date | null; mergedIntoId: string | null } | null, merged: { id: string }[] = []) {
  const prisma = { customer: { findUnique: jest.fn().mockResolvedValue(customer), findMany: jest.fn().mockResolvedValue(merged) } };
  const summaries = { summary: jest.fn().mockResolvedValue(SUMMARY) };
  const service = new CustomerJourneyService(prisma as unknown as PrismaService, summaries as unknown as JourneySummaryService);
  return { prisma, summaries, service };
}
function asPage(result: Awaited<ReturnType<CustomerJourneyService['list']>>): JourneyListResponse {
  if (!('events' in result)) throw new Error('ได้ redirect แทนหน้าไทม์ไลน์');
  return result;
}
const cursorAt = (n: number) => encodeJourneyCursor({ timestamp: day(n), id: 'x-1' });

describe('CustomerJourneyService.list + summary (Task 9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const source of DOMAIN) jest.mocked(source).mockResolvedValue([]);
    entryRows = [];
    entryScans = [];
    jest.mocked(entriesSource).mockImplementation(async (...args: Parameters<JourneySource>) => entryRows.slice(0, args[2].limit + 1));
    jest.mocked(entriesSourceFor).mockImplementation((groups): JourneySource => async (...args) => {
      entryScans.push([...groups].join(','));
      return entryRows.filter((event) => groups.has(event.group)).slice(0, args[2].limit + 1);
    });
  });

  it('placeholder ที่รวมแล้ว → redirect ไม่เรียกแหล่งและ summary · ไม่มี/ลบด้วยเหตุอื่น → 404', async () => {
    const merged = setup({ id: 'p1', deletedAt: new Date(), mergedIntoId: 'c1' });
    await expect(merged.service.list('p1', { include: ['summary', 'counts'] }, OWNER)).resolves.toEqual({ redirectToCustomerId: 'c1' });
    for (const source of ALL) expect(source).not.toHaveBeenCalled();
    expect(entriesSourceFor).not.toHaveBeenCalled();
    expect(merged.summaries.summary).not.toHaveBeenCalled();
    await expect(setup(null).service.list('x', {}, OWNER)).rejects.toThrow(new NotFoundException('ไม่พบลูกค้า'));
    await expect(setup({ id: 'd1', deletedAt: new Date(), mergedIntoId: null }).service.list('d1', {}, OWNER)).rejects.toThrow(NotFoundException);
  });

  it('ไม่ขอ include (การ์ดภาพรวม) → พฤติกรรมของ Task 8: แหล่งของกลุ่มที่ขอด้วย limit จริง · ไม่สแกนนับ · ไม่มี counts/summary', async () => {
    jest.mocked(chatSource).mockResolvedValue([ev('chat-1', day(3), 'chat')]);
    entryRows = [ev('en-sys', day(4), 'system'), ev('en-credit', day(2), 'credit')];
    const { prisma, summaries, service } = setup(LIVE);

    const page = asPage(await service.list('c1', { groups: ['chat', 'credit', 'sale'], limit: 6 }, OWNER));

    expect(page.events.map((e) => e.id)).toEqual(['chat-1', 'en-credit']);
    expect(page).not.toHaveProperty('counts');
    expect(page).not.toHaveProperty('summary');
    expect(summaries.summary).not.toHaveBeenCalled();
    expect(chatSource).toHaveBeenCalledWith(prisma, ['c1'], { limit: 6, before: undefined, from: undefined, to: undefined }, OWNER);
    for (const source of [paymentSource, collectionsSource, serviceSource, pointsSource]) expect(source).not.toHaveBeenCalled();
    expect(entriesSource).toHaveBeenCalledTimes(1);
    expect(entriesSourceFor).not.toHaveBeenCalled();
  });

  it('include=counts หน้าแรก: ids = ลูกค้า + placeholder · แหล่งโดเมนที่ OWNER เห็นถูกเรียกครั้งเดียวด้วยเพดาน 100 · entries สแกนทีละกลุ่ม · counts ครบทุกกลุ่มที่มีเหตุการณ์ · ไม่ขอ summary = ไม่มี summary', async () => {
    jest.mocked(pointsSource).mockResolvedValue([ev('pt', day(1), 'points')]);
    entryRows = [ev('en-chat', day(2), 'chat'), ev('en-sys', day(1), 'system')];
    const { prisma, summaries, service } = setup(LIVE, [{ id: 'p1' }, { id: 'p2' }]);

    const page = asPage(await service.list('c1', { include: ['counts'] }, OWNER));

    expect(prisma.customer.findMany).toHaveBeenCalledWith({ where: { mergedIntoId: 'c1' }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(page).toMatchObject({ customerId: 'c1', mergedCustomerIds: ['p1', 'p2'], nextCursor: null });
    expect(page.events.map((e) => e.id)).toEqual(['en-chat']);
    expect(page.counts).toEqual({ chat: 1, points: 1, system: 1 });
    expect(page).not.toHaveProperty('summary');
    expect(summaries.summary).not.toHaveBeenCalled();
    expect(page.notRecorded.length).toBeGreaterThan(0);
    for (const source of DOMAIN) expect(source).toHaveBeenCalledTimes(1);
    expect(entriesSource).not.toHaveBeenCalled();
    expect([...entryScans].sort()).toEqual(['chat', 'credit', 'sale', 'system']);
    expect(chatSource).toHaveBeenCalledWith(prisma, ['c1', 'p1', 'p2'], { limit: JOURNEY_COUNT_CAP, before: undefined, from: undefined, to: undefined }, OWNER);
  });

  it('ACCOUNTANT ไม่เรียกแชทและไม่สแกน entries กลุ่มแชท · counts ไม่มี chat · SALES ไม่เรียก payment/collections ทั้งหน้าแรกและหน้าถัดไป', async () => {
    entryRows = [ev('entry-chat', day(2), 'chat'), ev('entry-credit', day(1), 'credit')];
    const page = asPage(await setup(LIVE).service.list('c1', { groups: ['chat', 'credit'], include: ['counts'] }, { id: 'a1', role: 'ACCOUNTANT' }));
    expect(chatSource).not.toHaveBeenCalled();
    expect(entryScans).not.toContain('chat');
    expect(page.events.map((e) => e.id)).toEqual(['entry-credit']);
    expect(page.counts).toEqual({ credit: 1 });

    jest.clearAllMocks();
    const sales = setup(LIVE);
    const salesActor = { id: 's1', role: 'SALES' };
    await sales.service.list('c1', { groups: ['payment', 'collections', 'sale'], include: ['counts'] }, salesActor);
    await sales.service.list('c1', { groups: ['payment', 'collections', 'sale'], include: ['counts'], cursor: cursorAt(5) }, salesActor);
    expect(paymentSource).not.toHaveBeenCalled();
    expect(collectionsSource).not.toHaveBeenCalled();
    expect(saleSource).toHaveBeenCalledTimes(2);
    expect([...resolveJourneyGroups(undefined, 'SALES')]).toEqual(['chat', 'credit', 'sale', 'service']);
  });

  it('รวมหลายแหล่ง ตัดที่ limit คืน nextCursor · cursor เสีย 400 ก่อนแตะ DB · หน้าถัดไปเรียกเฉพาะแหล่งที่ขอด้วย limit จริง ไม่มี counts แม้ขอ', async () => {
    jest.mocked(chatSource).mockResolvedValue([ev('a', day(3), 'chat'), ev('b', day(1), 'chat')]);
    jest.mocked(saleSource).mockResolvedValue([ev('c', day(2), 'sale')]);
    const page = asPage(await setup(LIVE).service.list('c1', { groups: ['chat', 'sale'], limit: 2, include: ['counts'] }, OWNER));
    expect(page.events.map((e) => e.id)).toEqual(['a', 'c']);
    expect(decodeJourneyCursor(page.nextCursor ?? '')).toEqual({ ts: day(2), id: 'c' });
    expect(page.counts).toEqual({ chat: 2, sale: 1 });

    const bad = setup(LIVE);
    await expect(bad.service.list('c1', { cursor: Buffer.from('nope').toString('base64') }, OWNER)).rejects.toThrow(BadRequestException);
    expect(bad.prisma.customer.findUnique).not.toHaveBeenCalled();

    jest.clearAllMocks();
    const good = setup(LIVE);
    const next = asPage(await good.service.list('c1', { cursor: cursorAt(5), from: day(0), to: day(9), groups: ['service'], limit: 10, include: ['counts'] }, OWNER));
    expect(serviceSource).toHaveBeenCalledWith(good.prisma, ['c1'], { limit: 10, before: { ts: day(5), id: 'x-1' }, from: new Date(day(0)), to: new Date(day(9)) }, OWNER);
    expect(chatSource).not.toHaveBeenCalled();
    expect(entriesSourceFor).not.toHaveBeenCalled();
    expect(next).not.toHaveProperty('counts');
  });

  it('counts ถึงเพดาน 100 · หน้าแรกยังตัดที่ limit · id ซ้ำนับครั้งเดียว', async () => {
    const newestFirst = Array.from({ length: 150 }, (_, i) => ev(`chat-${String(149 - i).padStart(3, '0')}`, new Date(Date.UTC(2026, 8, 1, 0, 149 - i)).toISOString(), 'chat'));
    jest.mocked(chatSource).mockResolvedValue(newestFirst);
    const page = asPage(await setup(LIVE).service.list('c1', { groups: ['chat'], include: ['counts'] }, OWNER));
    expect(page.counts).toEqual({ chat: JOURNEY_COUNT_CAP });
    expect(page.events).toHaveLength(30);
    expect(page.events[0].id).toBe('chat-149');
    expect(page.nextCursor).not.toBeNull();
    expect(countJourneyGroups([[ev('x', day(1), 'chat'), ev('x', day(1), 'chat')]], new Set<JourneyEventGroup>(['chat']))).toEqual({ chat: 1 });
  });

  it('entries หลายกลุ่ม: ระบบใหม่ 101 แถว + แชทเก่า 5 แถว → counts.chat = 5 (สแกน entries ก้อนเดียวจะนับแชทได้ 0)', async () => {
    const systemNewest = Array.from({ length: 101 }, (_, i) => ev(`sys-${String(i).padStart(3, '0')}`, new Date(Date.UTC(2026, 8, 20, 0, 101 - i)).toISOString(), 'system'));
    const chatOlder = Array.from({ length: 5 }, (_, i) => ev(`chat-${i}`, day(5 - i), 'chat'));
    entryRows = [...systemNewest, ...chatOlder];

    const page = asPage(await setup(LIVE).service.list('c1', { include: ['counts'] }, OWNER));

    expect(page.counts).toMatchObject({ chat: 5, system: JOURNEY_COUNT_CAP });
    expect(page.events.map((e) => e.id)).toEqual(['chat-0', 'chat-1', 'chat-2', 'chat-3', 'chat-4']);
    // หลักฐานว่าแบบสแกนรวม (entries ก้อนเดียวตัดที่เพดาน+1) นับแชทไม่ได้เลย
    expect(countJourneyGroups([entryRows.slice(0, JOURNEY_COUNT_CAP + 1)], new Set<JourneyEventGroup>(['chat', 'system'])).chat).toBeUndefined();
  });

  it('include=summary: หน้าแรกแนบ summary (มี/ไม่มี counts) · summary ตอบ redirect (ถูกรวมระหว่างคำขอ) → ไม่แนบ · หน้าถัดไปไม่เรียก summary', async () => {
    const first = setup(LIVE);
    const page = asPage(await first.service.list('c1', { include: ['summary', 'counts'] }, OWNER));
    expect(first.summaries.summary).toHaveBeenCalledWith('c1', OWNER);
    expect(page.summary).toBe(SUMMARY);
    expect(page.counts).toBeDefined();

    const summaryOnly = setup(LIVE);
    const plain = asPage(await summaryOnly.service.list('c1', { include: ['summary'] }, OWNER));
    expect(plain.summary).toBe(SUMMARY);
    expect(plain).not.toHaveProperty('counts');

    const raced = setup(LIVE);
    raced.summaries.summary.mockResolvedValue({ redirectToCustomerId: 'c9' });
    expect(asPage(await raced.service.list('c1', { include: ['summary'] }, OWNER))).not.toHaveProperty('summary');

    const later = setup(LIVE);
    await later.service.list('c1', { include: ['summary', 'counts'], cursor: cursorAt(5) }, OWNER);
    expect(later.summaries.summary).not.toHaveBeenCalled();
  });

  it('summary() ส่งต่อให้ JourneySummaryService', async () => {
    const { summaries, service } = setup(LIVE);
    await expect(service.summary('c1', OWNER)).resolves.toBe(SUMMARY);
    expect(summaries.summary).toHaveBeenCalledWith('c1', OWNER);
  });
});
```

เขียนทับ `apps/api/src/modules/customer-journey/dto/journey-list-query.dto.spec.ts` ทั้งไฟล์:
```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JourneyListQueryDto } from './journey-list-query.dto';

const check = async (plain: Record<string, unknown>) => {
  const dto = plainToInstance(JourneyListQueryDto, plain, { enableImplicitConversion: true });
  return { dto, fields: (await validate(dto, { whitelist: true })).map((e) => e.property) };
};

describe('JourneyListQueryDto', () => {
  it('ค่าตั้งต้น limit 30 · groups และ include รับ csv และ key ซ้ำ', async () => {
    expect(await check({})).toMatchObject({ dto: { limit: 30 }, fields: [] });
    expect(await check({ groups: 'chat, credit', limit: '10' })).toMatchObject({ dto: { groups: ['chat', 'credit'], limit: 10 }, fields: [] });
    expect((await check({ groups: ['chat', 'sale,points'] })).dto.groups).toEqual(['chat', 'sale', 'points']);
    expect(await check({ include: 'counts' })).toMatchObject({ dto: { include: ['counts'] }, fields: [] });
    expect(await check({ include: ['summary', 'counts'] })).toMatchObject({ dto: { include: ['summary', 'counts'] }, fields: [] });
  });
  it.each([
    [{ groups: 'chat,messages' }, 'groups'], [{ limit: '0' }, 'limit'], [{ limit: '101' }, 'limit'],
    [{ cursor: 'ไม่ใช่ cursor' }, 'cursor'], [{ from: 'เมื่อวาน' }, 'from'], [{ include: 'counts,events' }, 'include'],
  ])('%j → error ที่ %s', async (plain, field) => {
    expect((await check(plain)).fields).toEqual([field]);
  });
});
```

สร้าง `apps/api/src/modules/customer-journey/customer-journey.controller.summary.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { CustomerJourneyController } from './customer-journey.controller';
import { CustomerJourneyService } from './customer-journey.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

describe('CustomerJourneyController GET :id/journey/summary', () => {
  let controller: CustomerJourneyController;
  const service = { summary: jest.fn() };

  beforeEach(async () => {
    service.summary.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomerJourneyController],
      providers: [{ provide: CustomerJourneyService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard).useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(CustomerJourneyController);
  });

  it('ส่ง id + ผู้ใช้ต่อให้ service และคืน redirect ตามที่ service ตอบ', async () => {
    service.summary.mockResolvedValue({ redirectToCustomerId: 'c-real' });
    await expect(controller.summary('c-old', { id: 'u1', role: 'SALES' })).resolves.toEqual({ redirectToCustomerId: 'c-real' });
    expect(service.summary).toHaveBeenCalledWith('c-old', { id: 'u1', role: 'SALES' });
  });

  it('เปิดให้ 5 role เดียวกับหน้าลูกค้า', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CustomerJourneyController.prototype.summary)).toEqual([
      'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES',
    ]);
  });
});
```

`apps/api/src/modules/customer-journey/customer-journey.pdpa.db.spec.ts` ถัดจากเทสสุดท้าย (ก่อน `});` ปิด describe ท้ายไฟล์ ต่อจากเทส `เดินทีละ 2 จนหมด…`) เพิ่ม:
```ts
  it('include=summary,counts: summary ที่แนบมาไม่มีเบอร์/เลขบัตร/ที่อยู่/ชื่อ · counts (entries สแกนทีละกลุ่มกับ DB จริง) มีแต่ชื่อกลุ่ม', async () => {
    const result = await page(ids.target, OWNER, { include: ['summary', 'counts'] });
    expect(result.summary).toMatchObject({ stage: expect.any(String), steps: expect.any(Array) });
    expect(result.counts).toMatchObject({ chat: expect.any(Number), system: expect.any(Number) });
    const json = JSON.stringify({ summary: result.summary, counts: result.counts });
    for (const secret of [phone, nationalId, address, 'สมหมาย']) expect(json).not.toContain(secret);
    expect(Object.keys(result.counts ?? {}).every((key) => (JOURNEY_EVENT_GROUPS as readonly string[]).includes(key))).toBe(true);
  });
```
Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/customer-journey.service.spec.ts src/modules/customer-journey/dto src/modules/customer-journey/customer-journey.controller.summary.spec.ts --runInBand` → Expected: FAIL — `TS2554: Expected 1 arguments, but got 2.` (service spec) · DTO spec: Task 8 ยังไม่ประกาศ `include` whitelist จึงตัดทิ้ง (`dto.include` ไม่เป็น array · เคส `include: 'counts,events'` ได้ `fields` = `[]`) · `Property 'summary' does not exist on type 'CustomerJourneyController'`

- [ ] **Step 11: DTO + `CustomerJourneyService` + controller + โมดูล + spec ของ Task 8 ที่สร้าง service ตรง**

เขียนทับ `apps/api/src/modules/customer-journey/dto/journey-list-query.dto.ts` ทั้งไฟล์:
```ts
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { JOURNEY_EVENT_GROUPS, type JourneyEventGroup } from '@installment/shared';

/** csv หรือ key ซ้ำ → string[] (ท่าเดียวกับ splitCsv ของ overdue/dto/queue-query.dto.ts:62-70) */
function splitCsv(value: unknown): unknown {
  const parts = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : null;
  return parts ? parts.flatMap((p) => p.split(',')).map((p) => p.trim()).filter(Boolean) : value;
}

/** include ของหน้าแรก — summary = แนบ JourneySummary (คงไว้ตามแบบ เฟส 1 เว็บยังไม่ใช้) · counts = ตัวเลขบนชิปกรอง (แท็บการเดินทางขอ การ์ดภาพรวมไม่ขอ) */
export const JOURNEY_LIST_INCLUDES = ['summary', 'counts'] as const;
export type JourneyListInclude = (typeof JOURNEY_LIST_INCLUDES)[number];

/** GET /customers/:id/journey — ไม่ส่ง groups = JOURNEY_DEFAULT_GROUPS (shared) · Task 9 เพิ่ม include */
export class JourneyListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 30;
  /** base64('isoTs|eventId') จาก nextCursor */
  @IsOptional() @IsString() @MaxLength(512) @Matches(/^[A-Za-z0-9+/]+={0,2}$/) cursor?: string;
  @IsOptional() @Transform(({ value }) => splitCsv(value)) @IsArray() @ArrayMaxSize(JOURNEY_EVENT_GROUPS.length) @IsIn([...JOURNEY_EVENT_GROUPS], { each: true })
  groups?: JourneyEventGroup[];
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  /** csv (summary,counts) — มีผลเฉพาะหน้าแรก (ไม่มี cursor) */
  @IsOptional() @Transform(({ value }) => splitCsv(value)) @IsArray() @ArrayMaxSize(JOURNEY_LIST_INCLUDES.length) @IsIn([...JOURNEY_LIST_INCLUDES], { each: true })
  include?: JourneyListInclude[];
}
```

เขียนทับ `apps/api/src/modules/customer-journey/customer-journey.service.ts` ทั้งไฟล์:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  JOURNEY_DEFAULT_GROUPS,
  JOURNEY_EVENT_GROUPS,
  JOURNEY_HIDDEN_GROUPS,
  type JourneyEvent,
  type JourneyEventGroup,
  type JourneyListResponse,
  type JourneyRedirect,
  type JourneySummary,
} from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { JourneyListInclude, JourneyListQueryDto } from './dto/journey-list-query.dto';
import { JourneySummaryService } from './journey-summary.service';
import { chatSource } from './sources/chat.source';
import { collectionsSource } from './sources/collections.source';
import { creditSource } from './sources/credit.source';
import { entriesSource, entriesSourceFor } from './sources/entries.source';
import { decodeJourneyCursor, mergeJourneyPage, type JourneyActor, type JourneySource, type JourneyWindow } from './sources/journey-window';
import { paymentSource } from './sources/payment.source';
import { pointsSource } from './sources/points.source';
import { saleSource } from './sources/sale.source';
import { serviceSource } from './sources/service.source';

export const DEFAULT_JOURNEY_LIMIT = 30;
/** เพดานตัวเลขบนชิปกรองของหน้าแรก — ถึงเพดาน = "อย่างน้อยเท่านี้" (ไม่นับทั้งประวัติ เพื่อไม่ยิงทุกแหล่งแบบไม่จำกัด) */
export const JOURNEY_COUNT_CAP = 100;

const SOURCES_BY_GROUP: Record<JourneyEventGroup, readonly JourneySource[]> = {
  chat: [chatSource, entriesSource], credit: [creditSource, entriesSource], sale: [saleSource, entriesSource],
  payment: [paymentSource], collections: [collectionsSource], service: [serviceSource], points: [pointsSource], system: [entriesSource],
};
/** กลุ่มที่มีแถวจาก entries (chat · credit · sale · system) — สแกนนับชิปทีละกลุ่มด้วย entriesSourceFor */
const ENTRY_GROUPS: readonly JourneyEventGroup[] = JOURNEY_EVENT_GROUPS.filter((group) => SOURCES_BY_GROUP[group].includes(entriesSource));

/** ข้อความท้ายแท็บ "ระบบยังไม่เก็บ" (synthesis notRecordedToday ที่พนักงานต้องรู้) */
export const JOURNEY_NOT_RECORDED: readonly string[] = [
  'ใครในทีมตอบแชทในแอป Facebook (แสดงเป็น "ร้าน" ไม่ทราบชื่อ)',
  'ผู้เปิดตรวจเครดิต ผล AI ประเมินเครดิต และบอทส่งต่อพนักงาน ก่อนวันที่ระบบเริ่มเก็บ',
  'รอบตีกลับสัญญาก่อนรอบล่าสุด ก่อนวันที่ระบบเริ่มเก็บ',
  'เวลาที่ได้เบอร์ของผู้สนใจ และเวลาผูก LINE ร้าน ก่อนวันที่ระบบเริ่มเก็บ',
  'ลูกค้ากดมาจากโฆษณา (ยังไม่มีข้อมูลโฆษณาเข้าระบบ)',
  'ลูกค้าหน้าร้านรู้จักร้านจากไหน',
  'ผู้ถอดแท็ก การบล็อก/เลิกติดตาม LINE และการเข้าชมเว็บ',
];

/** ไม่ส่ง groups = JOURNEY_DEFAULT_GROUPS · ตัด JOURNEY_HIDDEN_GROUPS[role] (ACCOUNTANT ไม่เห็นแชท · SALES ไม่เห็นยอดชำระ/ติดตามหนี้ — รอเจ้าของเคาะ ข้อ 5 · ชุดเดียวกับเว็บ) */
export function resolveJourneyGroups(requested: readonly JourneyEventGroup[] | undefined, role: string): Set<JourneyEventGroup> {
  const hidden = new Set<JourneyEventGroup>(JOURNEY_HIDDEN_GROUPS[role] ?? []);
  return new Set((requested?.length ? requested : JOURNEY_DEFAULT_GROUPS).filter((g) => !hidden.has(g)));
}

export const sourcesForGroups = (groups: ReadonlySet<JourneyEventGroup>): JourneySource[] => [...new Set([...groups].flatMap((g) => SOURCES_BY_GROUP[g]))];

/** นับเหตุการณ์ต่อกลุ่ม (id ไม่ซ้ำ) เฉพาะกลุ่มที่บทบาทเห็น ไม่เกิน JOURNEY_COUNT_CAP */
export function countJourneyGroups(lists: readonly JourneyEvent[][], groups: ReadonlySet<JourneyEventGroup>): Partial<Record<JourneyEventGroup, number>> {
  const counts: Partial<Record<JourneyEventGroup, number>> = {};
  const seen = new Set<string>();
  for (const event of lists.flat()) {
    if (!groups.has(event.group) || seen.has(event.id)) continue;
    seen.add(event.id);
    counts[event.group] = Math.min((counts[event.group] ?? 0) + 1, JOURNEY_COUNT_CAP);
  }
  return counts;
}

const isRedirect = (value: JourneySummary | JourneyRedirect): value is JourneyRedirect => 'redirectToCustomerId' in value;

@Injectable()
export class CustomerJourneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: JourneySummaryService,
  ) {}

  async list(customerId: string, query: JourneyListQueryDto, actor: JourneyActor): Promise<JourneyListResponse | JourneyRedirect> {
    const before = query.cursor ? decodeJourneyCursor(query.cursor) : undefined;
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, deletedAt: true, mergedIntoId: true } });
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
    if (customer.deletedAt) {
      // ลิงก์เก่าที่ชี้ placeholder — chain ถูกยุบเหลือชั้นเดียวตอนรวม
      if (customer.mergedIntoId) return { redirectToCustomerId: customer.mergedIntoId };
      throw new NotFoundException('ไม่พบลูกค้า');
    }
    const merged = await this.prisma.customer.findMany({ where: { mergedIntoId: customerId }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const mergedCustomerIds = merged.map((row) => row.id);
    const ids = [customerId, ...mergedCustomerIds];
    const groups = resolveJourneyGroups(query.groups, actor.role);
    const window: JourneyWindow = { limit: query.limit ?? DEFAULT_JOURNEY_LIMIT, before, from: query.from ? new Date(query.from) : undefined, to: query.to ? new Date(query.to) : undefined };
    const notRecorded = [...JOURNEY_NOT_RECORDED];
    const pageSources = sourcesForGroups(groups);
    // include มีผลเฉพาะหน้าแรก — หน้าที่มี cursor ไม่แนบ counts/summary
    const include = new Set<JourneyListInclude>(before ? [] : (query.include ?? []));
    const summaryPromise = include.has('summary') ? this.summaries.summary(customerId, actor) : Promise.resolve(null);

    if (!include.has('counts')) {
      // หน้าถัดไป หรือหน้าแรกที่ไม่ขอ counts (การ์ดกิจกรรมล่าสุด · summary อย่างเดียว): เฉพาะแหล่งของกลุ่มที่ขอ ด้วย limit จริง
      const [perSource, summary] = await Promise.all([
        Promise.all(pageSources.map((source) => source(this.prisma, ids, window, actor))),
        summaryPromise,
      ]);
      const { events, nextCursor } = mergeJourneyPage(perSource, window.limit, groups);
      return { customerId, mergedCustomerIds, ...(summary && !isRedirect(summary) ? { summary } : {}), events, nextCursor, notRecorded };
    }

    // include=counts: สแกนทุกแหล่งที่บทบาทเห็นครั้งเดียวด้วยเพดาน JOURNEY_COUNT_CAP — ใช้ทั้งตัวเลขบนชิปและตัดหน้า
    // entries สแกนทีละกลุ่ม: สแกนก้อนเดียวแล้วตัดที่เพดาน แถวใหม่ของกลุ่มหนึ่ง (เช่นแท็กระบบ) จะดันแถวเก่าของอีกกลุ่มหลุด ตัวเลขชิปจะต่ำเกินจริง
    const countGroups = resolveJourneyGroups([...JOURNEY_EVENT_GROUPS], actor.role);
    const scanWindow: JourneyWindow = { ...window, limit: Math.max(window.limit, JOURNEY_COUNT_CAP) };
    const domainSources = sourcesForGroups(countGroups).filter((source) => source !== entriesSource);
    const entryGroups = ENTRY_GROUPS.filter((group) => countGroups.has(group));
    const [domainScans, entryScans, summary] = await Promise.all([
      Promise.all(domainSources.map((source) => source(this.prisma, ids, scanWindow, actor))),
      Promise.all(entryGroups.map((group) => entriesSourceFor(new Set([group]))(this.prisma, ids, scanWindow, actor))),
      summaryPromise,
    ]);
    // finalizeSource เรียงแล้วตัด ⇒ ส่วนต้น limit+1 ของผลสแกนคือผลเดียวกับการเรียกด้วย limit จริง
    // entries ต่อกลุ่มเป็นแหล่งย่อยที่ไม่ทับกัน รวมหน้าได้เหมือนแหล่งแยก
    const byDomainSource = new Map(domainSources.map((source, index) => [source, domainScans[index]] as const));
    const byEntryGroup = new Map(entryGroups.map((group, index) => [group, entryScans[index]] as const));
    const perSource = [
      ...pageSources.filter((source) => source !== entriesSource).map((source) => byDomainSource.get(source) ?? []),
      ...[...groups].map((group) => byEntryGroup.get(group) ?? []),
    ].map((list) => list.slice(0, window.limit + 1));
    const { events, nextCursor } = mergeJourneyPage(perSource, window.limit, groups);
    return {
      customerId,
      mergedCustomerIds,
      // ถูกรวมระหว่างคำขอ (summary ตอบ redirect) → ไม่แนบ ให้คำขอถัดไปได้ redirect เอง
      ...(summary && !isRedirect(summary) ? { summary } : {}),
      events,
      nextCursor,
      counts: countJourneyGroups([...domainScans, ...entryScans], countGroups),
      notRecorded,
    };
  }

  /** GET /customers/:id/journey/summary — ตรรกะอยู่ที่ JourneySummaryService */
  summary(customerId: string, actor: JourneyActor): Promise<JourneySummary | JourneyRedirect> {
    return this.summaries.summary(customerId, actor);
  }
}
```

เขียนทับ `apps/api/src/modules/customer-journey/customer-journey.controller.ts` ทั้งไฟล์:
```ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BranchGuard } from '../auth/guards/branch.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JourneyListResponse, JourneyRedirect, JourneySummary } from '@installment/shared';
import { CustomerJourneyService } from './customer-journey.service';
import { JourneyListQueryDto } from './dto/journey-list-query.dto';

@ApiTags('Customer Journey')
@ApiBearerAuth('JWT')
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class CustomerJourneyController {
  constructor(private readonly journey: CustomerJourneyService) {}

  @Get(':id/journey')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'การเดินทางของลูกค้า — แชท เครดิต การขาย ชำระเงิน ติดตามหนี้ บริการ แต้ม (keyset cursor)' })
  list(@Param('id') id: string, @Query() query: JourneyListQueryDto, @CurrentUser() user: { id: string; role: string }): Promise<JourneyListResponse | JourneyRedirect> {
    return this.journey.list(id, query, { id: user.id, role: user.role });
  }

  @Get(':id/journey/summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'แถบขั้นการเดินทางของลูกค้า — ขั้นซื้อแล้วตรวจสดกับ BOUGHT_WHERE ทุกคำขอ · ผู้สนใจที่ถูกรวมแล้วได้ redirect' })
  summary(@Param('id') id: string, @CurrentUser() user: { id: string; role: string }): Promise<JourneySummary | JourneyRedirect> {
    return this.journey.summary(id, { id: user.id, role: user.role });
  }
}
```

เขียนทับ `apps/api/src/modules/customer-journey/customer-journey.module.ts` ทั้งไฟล์:
```ts
import { Module } from '@nestjs/common';
import { CustomerJourneyController } from './customer-journey.controller';
import { CustomerJourneyCron } from './customer-journey.cron';
import { CustomerJourneyService } from './customer-journey.service';
import { JourneyEntryWriter } from './journey-entry-writer.service';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';

/**
 * การเดินทางของลูกค้า — ไม่ import โมดูลอื่น (PrismaModule เป็น @Global · ScheduleModule.forRoot อยู่ใน app.module)
 * ⇒ ChatProspectsModule (CustomerMergeService) และโมดูลที่มี hook import โมดูลนี้ได้โดยไม่เกิดวงจร
 */
@Module({
  controllers: [CustomerJourneyController],
  providers: [JourneyEntryWriter, JourneyStateService, JourneySummaryService, CustomerJourneyService, CustomerJourneyCron],
  exports: [JourneyEntryWriter, JourneyStateService],
})
export class CustomerJourneyModule {}
```

ใน `apps/api/src/modules/customer-journey/customer-journey.pdpa.db.spec.ts` และ `apps/api/src/modules/customer-journey/customer-journey.payments-cursor.db.spec.ts` (ทั้งสองไฟล์):
- ถัดจากบรรทัด `import { CustomerJourneyService } from './customer-journey.service';` เพิ่ม
```ts
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';
```
- แทนบรรทัด
```ts
  const service = new CustomerJourneyService(prisma as unknown as PrismaService);
```
ด้วย
```ts
  const db = prisma as unknown as PrismaService;
  const service = new CustomerJourneyService(db, new JourneySummaryService(db, new JourneyStateService(db)));
```

ตรวจว่าโมดูลถูกโหลดครั้งเดียว: `grep -c "CustomerJourneyModule" src/app.module.ts` → Expected: `2`

Run: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey/customer-journey.service.spec.ts src/modules/customer-journey/dto src/modules/customer-journey/customer-journey.controller.spec.ts src/modules/customer-journey/customer-journey.controller.summary.spec.ts src/modules/customer-journey/customer-journey.pdpa.db.spec.ts src/modules/customer-journey/customer-journey.payments-cursor.db.spec.ts src/modules/customer-journey/customer-journey.module.spec.ts --runInBand` → Expected: PASS ทุก suite — service 9 · DTO 7 · controller 1 · controller summary 2 · PDPA 5 · payments-cursor 1 · module DI 1

- [ ] **Step 12: ตรวจทั้งโมดูล + typecheck + lint + build asset**

Run (จาก `apps/api`):
- `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey src/modules/customers src/modules/chat-prospects/customer-merge.service.spec.ts --runInBand` → Expected: PASS ทุก suite
- `npx tsc --noEmit -p tsconfig.json` → Expected: 0 error
- `npx eslint src/modules/customer-journey/journey-state.service.ts src/modules/customer-journey/journey-state.activity.db.spec.ts src/modules/customer-journey/journey-summary.builder.ts src/modules/customer-journey/journey-summary.builder.spec.ts src/modules/customer-journey/journey-summary.service.ts src/modules/customer-journey/journey-summary.service.db.spec.ts src/modules/customer-journey/customer-journey.cron.ts src/modules/customer-journey/customer-journey.cron.spec.ts src/modules/customer-journey/customer-journey.service.ts src/modules/customer-journey/customer-journey.service.spec.ts src/modules/customer-journey/dto/journey-list-query.dto.ts src/modules/customer-journey/dto/journey-list-query.dto.spec.ts src/modules/customer-journey/customer-journey.controller.ts src/modules/customer-journey/customer-journey.controller.summary.spec.ts src/modules/customer-journey/customer-journey.pdpa.db.spec.ts src/modules/customer-journey/customer-journey.payments-cursor.db.spec.ts src/modules/customer-journey/customer-journey.module.ts` → Expected: 0 error (🚨 ห้าม `npm run lint`)
- `npm run build` → Expected: จบด้วย `✓ Assets verified` · `ls dist/src/modules/customer-journey/sql` แสดงไฟล์ `.sql` ครบ 3 ไฟล์

- [ ] **Step 13: Commit**

Run (จาก root worktree):
```bash
git add apps/api/src/modules/customer-journey/sql/journey-activity-probe.sql apps/api/src/modules/customer-journey/sql/journey-active-since.sql apps/api/src/modules/customer-journey/journey-state.service.ts apps/api/src/modules/customer-journey/journey-state.activity.db.spec.ts apps/api/src/modules/customer-journey/journey-summary.builder.ts apps/api/src/modules/customer-journey/journey-summary.builder.spec.ts apps/api/src/modules/customer-journey/journey-summary.service.ts apps/api/src/modules/customer-journey/journey-summary.service.db.spec.ts apps/api/src/modules/customer-journey/customer-journey.cron.ts apps/api/src/modules/customer-journey/customer-journey.cron.spec.ts apps/api/src/modules/customer-journey/customer-journey.controller.summary.spec.ts apps/api/src/modules/customer-journey/customer-journey.service.ts apps/api/src/modules/customer-journey/customer-journey.service.spec.ts apps/api/src/modules/customer-journey/dto/journey-list-query.dto.ts apps/api/src/modules/customer-journey/dto/journey-list-query.dto.spec.ts apps/api/src/modules/customer-journey/customer-journey.controller.ts apps/api/src/modules/customer-journey/customer-journey.pdpa.db.spec.ts apps/api/src/modules/customer-journey/customer-journey.payments-cursor.db.spec.ts apps/api/src/modules/customer-journey/customer-journey.module.ts apps/api/package.json
git commit -m "feat(customer-journey): GET /customers/:id/journey/summary + include=summary,counts หน้าแรก + cron recompute/entry-guard

- ขั้นซื้อแล้วตรวจสดกับ BOUGHT_WHERE ทุกคำขอ · แคชเก่ากว่า 15 นาทีและมีความเคลื่อนไหวใหม่ = คำนวณใหม่ในคำขอ
- ผู้สนใจที่ถูกรวมแล้วได้ redirect · counts (ขอเมื่อใช้) ต่อกลุ่มไม่เกิน 100 จากการสแกนหน้าแรกครั้งเดียว · entries สแกนทีละกลุ่มกันตัวเลขชิปต่ำเกินจริง
- cron 03:30 คำนวณคนที่ขยับ 48 ชม. (อาทิตย์ทุกคน) + เทียบ PURCHASED · 04:00 ตรวจ entry CONTRACT_ACTIVATED ที่หลุด

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

---

### Task 10: CLI ย้อนหลังแคชการเดินทาง `backfill:customer-journey` — ด่านห้องไม่มีเจ้าของ 1% และด่าน PURCHASED ตรง BOUGHT_WHERE

> งานนี้ไม่มีตรรกะขั้นของตัวเอง: แบ่งลูกค้าที่ยังไม่ถูกลบเป็นชุดแล้วเรียก `JourneyStateService.recompute(ids)` ของ Task 3 (ไฟล์ `journey-state.sql` เดียวกับ runtime และ cron ของ Task 9) · ด่าน PURCHASED ใช้ `JourneyStateService.purchasedParity()` ของ Task 3 ตัวเดียวกับ cron `journey:recompute` จึงไม่มี predicate ชุดที่สอง
> `BOUGHT_WHERE` ถูก export แล้วใน Task 3 (`customer-query.service.ts:43`) — งานนี้ไม่แตะไฟล์นั้น

**Files:**
- Create: `apps/api/src/cli/backfill-customer-journey.cli.ts`
- Create: `apps/api/src/cli/backfill-customer-journey.spec.ts` (ฟังก์ชันบริสุทธิ์ + keyset แบบ mock ไม่แตะ DB)
- Create: `apps/api/src/cli/backfill-customer-journey.db.spec.ts` (Postgres จริง ข้อมูลชุดเล็ก)
- Modify: `apps/api/src/cli/backfill-chat-prospects.cli.ts:49` (`const BACKFILL_WHERE` → `export const BACKFILL_WHERE` เปลี่ยนแค่คำเดียว ตรรกะเดิมไม่แตะ)
- Modify: `apps/api/package.json:59` (แทรก 2 บรรทัดต่อจาก `backfill:chat-prospects:help` ก่อน `seed:test-contracts` บรรทัด 60 — Task 3/9 แก้บรรทัด 8 แบบแทนที่ในที่ เลขบรรทัดนี้จึงไม่เลื่อน)

**Interfaces:**
- Consumes:
  - Task 3 + Task 9 — `JourneyStateService` จาก `apps/api/src/modules/customer-journey/journey-state.service.ts`
    - `constructor(prisma: PrismaService)` — อ่าน `sql/journey-state.sql` (Task 3) · `sql/journey-activity-probe.sql` · `sql/journey-active-since.sql` (Task 9) ด้วย `readFileSync(join(__dirname, 'sql', …))` ตอนสร้าง ⇒ ทั้ง 3 ไฟล์ต้องอยู่ใน `dist/src/modules/customer-journey/sql/` (asset ใน `nest-cli.json` ของ Task 3 + `verify:assets` ของ Task 9)
    - `recompute(customerIds: string[]): Promise<void>` — ตัด id ว่าง/ซ้ำ · ทีละ 500 · `INSERT … ON CONFLICT (customer_id) DO UPDATE` รันซ้ำได้ · ลบแคชของ id ที่ `deleted_at` ไม่ว่าง
    - `purchasedParity(): Promise<{ purchasedStates: number; bought: number }>` — `purchasedStates` = state `stage='PURCHASED'` ของลูกค้า `deletedAt: null` · `bought` = `customer.count({ AND: [{ deletedAt: null }, BOUGHT_WHERE] })`
    - (ไม่ใช้) `recomputeAll(): Promise<number>` — ไม่นับชุดที่ล้มและหยุดทั้งรอบเมื่อชุดใดโยน ⇒ CLI เดิน keyset เอง
  - Task 1 — Prisma `prisma.customerJourneyState` (`customerId` @id, `stage`) · `Customer.mergedIntoId` · migration `20261002100000_customer_journey` บน `bc_journey_test`
  - `CHAT_SOURCE_PREFIX` (`'CHAT_'`) จาก `@installment/shared` (`packages/shared/src/customer-sort.ts:113`)
  - `BACKFILL_WHERE: Prisma.ChatRoomWhereInput` จาก `backfill-chat-prospects.cli.ts:49` (task นี้ export ให้) = `{ deletedAt: null, customerId: null, OR: [{ channel: { not: 'WEB' } }, { channel: 'WEB', messages: { some: { role: 'CUSTOMER' } } }] }` ห้องที่ `backfill:chat-prospects` ยังต้องผูก (ไม่นับห้อง WEB ที่ลูกค้ายังไม่พิมพ์ ตาม R3) · ไฟล์นั้นเรียก `main()` เฉพาะ `require.main === module` (`:181`) import ได้ไม่มีผลข้างเคียง
  - รูปแบบ guard ของ `backfill-chat-prospects.cli.ts:140-184` (`assertExpectedDb` · `new PrismaService()` · `process.exitCode`)
- Produces (ทั้งหมด export จาก `apps/api/src/cli/backfill-customer-journey.cli.ts`):
  - `const UNLINKED_ROOMS_MAX_RATIO = 0.01`
  - `interface JourneyBackfillPlan { customers: number; existingStates: number; boughtCustomers: number; liveRooms: number; unlinkedRooms: number; mergedPlaceholders: number; unmergedDeletedChatPlaceholders: number }`
  - `interface JourneyBackfillResult { processed: number; batches: number; failedBatches: number; failedCustomers: number }`
  - `interface PurchasedParity { boughtCustomers: number; purchasedStates: number; ok: boolean }`
  - `planJourneyBackfill(prisma: Pick<PrismaClient, 'customer' | 'chatRoom' | 'customerJourneyState'>, stateService: Pick<JourneyStateService, 'purchasedParity'>): Promise<JourneyBackfillPlan>`
  - `unlinkedRoomsGate(plan: Pick<JourneyBackfillPlan, 'liveRooms' | 'unlinkedRooms'>): { ok: boolean; ratio: number }`
  - `runJourneyBackfill(prisma: Pick<PrismaClient, 'customer'>, stateService: Pick<JourneyStateService, 'recompute'>, opts: { batchSize: number; log: (line: string) => void }): Promise<JourneyBackfillResult>`
  - `checkPurchasedParity(stateService: Pick<JourneyStateService, 'purchasedParity'>): Promise<PurchasedParity>`
  - `backfillExitCode(input: { plan: Pick<JourneyBackfillPlan, 'customers'>; result: JourneyBackfillResult; parity: PurchasedParity }): 0 | 2`
  - npm script `backfill:customer-journey` (`node dist/src/cli/backfill-customer-journey.cli.js`) + `backfill:customer-journey:help`
  - exit code: `0` = ครบ · `1` = DB ไม่ตรง / ห้องไม่มีเจ้าของเกิน 1% (หยุดก่อนเขียน ทั้งตอน dry-run) / prod ไม่มี `ALLOW_PROD_BACKFILL` · `2` = เขียนแล้วแต่ PURCHASED ≠ BOUGHT_WHERE หรือ recompute ล้มบางชุด หรือ processed ≠ plan.customers
  - Task 13 (runbook) รันตัวนี้ผ่าน Cloud Run job `bestchoice-backfill-customer-journey` ด้วย `EXPECTED_DB_NAME=bestchoice`

- [ ] **Step 1: เทสแดง — ฟังก์ชันบริสุทธิ์ + keyset + parity (mock)**

สร้าง `apps/api/src/cli/backfill-customer-journey.spec.ts`:
```ts
import {
  backfillExitCode,
  checkPurchasedParity,
  runJourneyBackfill,
  unlinkedRoomsGate,
  UNLINKED_ROOMS_MAX_RATIO,
} from './backfill-customer-journey.cli';

const CUSTOMER_SELECT = { id: true, createdAt: true };
const ORDER = [{ createdAt: 'asc' }, { id: 'asc' }];

describe('unlinkedRoomsGate', () => {
  it('ไม่มีห้องแชทเลย → ผ่าน ratio 0 (ไม่หารด้วยศูนย์)', () => {
    expect(unlinkedRoomsGate({ liveRooms: 0, unlinkedRooms: 0 })).toEqual({ ok: true, ratio: 0 });
  });

  it('เท่ากับ 1% พอดี → ผ่าน (หยุดเฉพาะ "เกิน" 1%)', () => {
    expect(UNLINKED_ROOMS_MAX_RATIO).toBe(0.01);
    expect(unlinkedRoomsGate({ liveRooms: 100, unlinkedRooms: 1 })).toEqual({ ok: true, ratio: 0.01 });
  });

  it('เกิน 1% → ไม่ผ่าน · ตัวเลข prod ก่อนรัน backfill:chat-prospects (8,991/8,992) ต้องโดนหยุด', () => {
    expect(unlinkedRoomsGate({ liveRooms: 10_000, unlinkedRooms: 101 }).ok).toBe(false);
    expect(unlinkedRoomsGate({ liveRooms: 8_992, unlinkedRooms: 8_991 }).ok).toBe(false);
  });
});

describe('backfillExitCode', () => {
  const plan = { customers: 3 };
  const result = { processed: 3, batches: 1, failedBatches: 0, failedCustomers: 0 };
  const parity = { boughtCustomers: 1, purchasedStates: 1, ok: true };

  it('ครบทุกคน ไม่มีชุดล้ม parity ตรง → 0', () => {
    expect(backfillExitCode({ plan, result, parity })).toBe(0);
  });

  it('PURCHASED ≠ BOUGHT_WHERE → 2', () => {
    expect(backfillExitCode({ plan, result, parity: { boughtCustomers: 2, purchasedStates: 1, ok: false } })).toBe(2);
  });

  it('recompute ล้มอย่างน้อยหนึ่งชุด → 2', () => {
    expect(backfillExitCode({ plan, result: { ...result, failedBatches: 1, failedCustomers: 1 }, parity })).toBe(2);
  });

  it('processed ≠ plan.customers → 2', () => {
    expect(backfillExitCode({ plan, result: { ...result, processed: 2 }, parity })).toBe(2);
  });
});

describe('checkPurchasedParity', () => {
  it('แปลงผลของ JourneyStateService.purchasedParity (ตัวเดียวกับ cron journey:recompute) เป็นผลของ CLI', async () => {
    const stateService = { purchasedParity: jest.fn().mockResolvedValue({ purchasedStates: 4, bought: 5 }) };
    await expect(checkPurchasedParity(stateService)).resolves.toEqual({ boughtCustomers: 5, purchasedStates: 4, ok: false });
    stateService.purchasedParity.mockResolvedValueOnce({ purchasedStates: 5, bought: 5 });
    await expect(checkPurchasedParity(stateService)).resolves.toEqual({ boughtCustomers: 5, purchasedStates: 5, ok: true });
  });
});

describe('runJourneyBackfill keyset (Ruling R20 แบบเดียวกับ backfill-chat-prospects)', () => {
  const c1 = { id: 'c1', createdAt: new Date('2026-05-01T00:00:00.000Z') };
  const c2 = { id: 'c2', createdAt: new Date('2026-05-02T00:00:00.000Z') };
  const c3 = { id: 'c3', createdAt: new Date('2026-05-03T00:00:00.000Z') };

  it('ชุดแรกกรองแค่ deletedAt null · ชุดถัดไป (createdAt,id) > ตัวสุดท้ายของชุดก่อน · ไม่มี cursor/skip · recompute ได้ id ทีละชุด', async () => {
    const prisma: any = { customer: { findMany: jest.fn().mockResolvedValueOnce([c1, c2]).mockResolvedValueOnce([c3]).mockResolvedValueOnce([]) } };
    const stateService = { recompute: jest.fn().mockResolvedValue(undefined) };
    const log = jest.fn();

    await expect(runJourneyBackfill(prisma, stateService, { batchSize: 2, log })).resolves.toEqual({
      processed: 3, batches: 2, failedBatches: 0, failedCustomers: 0,
    });
    expect(stateService.recompute.mock.calls).toEqual([[['c1', 'c2']], [['c3']]]);
    expect(prisma.customer.findMany).toHaveBeenNthCalledWith(1, { where: { deletedAt: null }, select: CUSTOMER_SELECT, orderBy: ORDER, take: 2 });
    expect(prisma.customer.findMany).toHaveBeenNthCalledWith(2, {
      where: { AND: [{ deletedAt: null }, { OR: [{ createdAt: { gt: c2.createdAt } }, { createdAt: c2.createdAt, id: { gt: 'c2' } }] }] },
      select: CUSTOMER_SELECT,
      orderBy: ORDER,
      take: 2,
    });
    expect(prisma.customer.findMany.mock.calls[1][0]).not.toHaveProperty('cursor');
    expect(prisma.customer.findMany.mock.calls[1][0]).not.toHaveProperty('skip');
  });

  it('recompute ล้มทั้งชุด → นับ failed แล้วขยับ keyset ต่อ ไม่วนซ้ำชุดเดิม · log มีแค่ id (PDPA)', async () => {
    const prisma: any = { customer: { findMany: jest.fn().mockResolvedValueOnce([c1, c2]).mockResolvedValueOnce([]) } };
    const stateService = { recompute: jest.fn().mockRejectedValue(new Error('boom')) };
    const log = jest.fn();

    await expect(runJourneyBackfill(prisma, stateService, { batchSize: 2, log })).resolves.toEqual({
      processed: 2, batches: 1, failedBatches: 1, failedCustomers: 2,
    });
    expect(prisma.customer.findMany).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('FAILED batch first=c1 last=c2 size=2: boom');
  });
});
```
Run (จาก `apps/api`): `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/cli/backfill-customer-journey.spec.ts --runInBand` → Expected: FAIL `Cannot find module './backfill-customer-journey.cli'`

- [ ] **Step 2: เทสแดง — Postgres จริง ข้อมูลชุดเล็ก**

ตรวจก่อนว่า Task 1, 3 และ 9 วางของไว้ครบ (จาก `apps/api`):
```bash
npm run build --workspace=@installment/shared
grep -n "async recompute(\|async purchasedParity(" src/modules/customer-journey/journey-state.service.ts
grep -n "^export const BOUGHT_WHERE" src/modules/customers/services/customer-query.service.ts
ls src/modules/customer-journey/sql/
psql "postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket" -Atc "SELECT to_regclass('public.customer_journey_states'), (SELECT count(*) FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'merged_into_id')"
```
Expected:
- grep แรกได้ 2 บรรทัด (`async recompute(customerIds: string[]): Promise<void> {` และ `async purchasedParity(): Promise<{ purchasedStates: number; bought: number }> {`)
- `43:export const BOUGHT_WHERE: Prisma.CustomerWhereInput = {`
- `journey-active-since.sql  journey-activity-probe.sql  journey-state.sql`
- `customer_journey_states|1`
- ถ้าไม่ได้ผลนี้ ให้หยุดแล้วแจ้งผู้ประสานงาน (Task 1/3/9 ยังไม่ลง) ห้ามสร้างเองใน task นี้

สร้าง `apps/api/src/cli/backfill-customer-journey.db.spec.ts`:
```ts
import { ChatChannel, PrismaClient } from '@prisma/client';
import { JourneyStateService } from '../modules/customer-journey/journey-state.service';
import { backfillExitCode, checkPurchasedParity, planJourneyBackfill, runJourneyBackfill } from './backfill-customer-journey.cli';

/**
 * backfill:customer-journey บน Postgres จริง (ฐานทดสอบตาม Global Constraints เท่านั้น)
 * ข้อมูลชุดเล็ก: ผู้สนใจจากแชทไม่มีเบอร์ · walk-in มีเบอร์ยังไม่ซื้อ · คนซื้อเงินสด
 * + ห้องแชทมีเจ้าของ 1 / ไม่มีเจ้าของ 1 + placeholder ที่รวมแล้ว 1 + placeholder จากแชทที่ลบแต่ไม่มี merged_into_id 1
 * ตัวเลขแผนตรวจเป็นส่วนต่าง (after − before) กันแถวค้างจาก spec อื่นในฐานเดียวกัน
 * ข้อความแชทในชุดทดสอบไม่มีเนื้อหา — CLI ไม่อ่านข้อความ (PDPA)
 */
describe('backfill-customer-journey (real DB)', () => {
  const prisma = new PrismaClient();
  const stateService = new JourneyStateService(prisma as never);
  const stamp = Date.now();
  let seq = 0;
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const saleIds: string[] = [];
  const productIds: string[] = [];
  const userIds: string[] = [];
  const branchIds: string[] = [];

  afterEach(async () => {
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
    for (const list of [customerIds, roomIds, saleIds, productIds, userIds, branchIds]) list.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedDataset() {
    seq += 1;
    const tag = `${stamp}-${seq}`;
    const digits = `${String(stamp).slice(-7)}${seq}`;

    const branch = await prisma.branch.create({ data: { name: `journey-backfill-${tag}` } });
    branchIds.push(branch.id);
    const salesperson = await prisma.user.create({
      data: { email: `journey-backfill-${tag}@test.local`, password: 'x', name: 'journey backfill sales', role: 'SALES' },
    });
    userIds.push(salesperson.id);

    const prospect = await prisma.customer.create({
      data: { name: 'journey backfill prospect', phone: null, acquisitionSource: 'CHAT_FACEBOOK', createdAt: new Date('2026-05-01T03:00:00.000Z') },
    });
    const walkIn = await prisma.customer.create({
      data: { name: 'journey backfill walk-in', phone: `08${digits}`, createdAt: new Date('2026-05-02T03:00:00.000Z') },
    });
    const buyer = await prisma.customer.create({
      data: { name: 'journey backfill buyer', phone: `09${digits}`, createdAt: new Date('2026-05-03T03:00:00.000Z') },
    });
    const merged = await prisma.customer.create({
      data: {
        name: 'journey backfill merged placeholder',
        phone: null,
        acquisitionSource: 'CHAT_FACEBOOK',
        deletedAt: new Date('2026-05-04T03:00:00.000Z'),
        mergedIntoId: buyer.id,
      },
    });
    const orphan = await prisma.customer.create({
      data: { name: 'journey backfill orphan placeholder', phone: null, acquisitionSource: 'CHAT_FACEBOOK', deletedAt: new Date('2026-05-04T03:00:00.000Z') },
    });
    customerIds.push(prospect.id, walkIn.id, buyer.id, merged.id, orphan.id);

    const linkedRoom = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `journey-backfill-linked-${tag}`, customerId: prospect.id, createdAt: new Date('2026-05-01T03:00:00.000Z') },
    });
    const unlinkedRoom = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `journey-backfill-unlinked-${tag}` },
    });
    roomIds.push(linkedRoom.id, unlinkedRoom.id);
    await prisma.chatMessage.create({ data: { roomId: linkedRoom.id, role: 'CUSTOMER', createdAt: new Date('2026-05-01T03:00:05.000Z') } });

    const product = await prisma.product.create({
      data: { name: 'journey backfill phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: '20000.00', branchId: branch.id },
    });
    productIds.push(product.id);
    const sale = await prisma.sale.create({
      data: {
        saleNumber: `JB-${tag}`,
        saleType: 'CASH',
        customerId: buyer.id,
        productId: product.id,
        branchId: branch.id,
        salespersonId: salesperson.id,
        sellingPrice: '25000.00',
        netAmount: '25000.00',
      },
    });
    saleIds.push(sale.id);

    return { prospect, walkIn, buyer, merged, orphan, sale };
  }

  it('แผน (dry-run) นับส่วนต่างตรงกับข้อมูลที่ใส่ และไม่เขียนแคช', async () => {
    const before = await planJourneyBackfill(prisma, stateService);
    await seedDataset();
    const after = await planJourneyBackfill(prisma, stateService);

    expect({
      customers: after.customers - before.customers,
      existingStates: after.existingStates - before.existingStates,
      boughtCustomers: after.boughtCustomers - before.boughtCustomers,
      liveRooms: after.liveRooms - before.liveRooms,
      unlinkedRooms: after.unlinkedRooms - before.unlinkedRooms,
      mergedPlaceholders: after.mergedPlaceholders - before.mergedPlaceholders,
      unmergedDeletedChatPlaceholders: after.unmergedDeletedChatPlaceholders - before.unmergedDeletedChatPlaceholders,
    }).toEqual({
      customers: 3,
      existingStates: 0,
      boughtCustomers: 1,
      liveRooms: 2,
      unlinkedRooms: 1,
      mergedPlaceholders: 1,
      unmergedDeletedChatPlaceholders: 1,
    });
  });

  it('batchSize=1 เดินครบด้วย keyset → คนที่ยังไม่ถูกลบมีแคชทุกคน · ขั้นตามกติกา · parity ตรง → exit 0 · รันซ้ำไม่เพิ่มแถว', async () => {
    const { prospect, walkIn, buyer } = await seedDataset();
    const plan = await planJourneyBackfill(prisma, stateService);

    const result = await runJourneyBackfill(prisma, stateService, { batchSize: 1, log: jest.fn() });

    expect(result).toEqual({ processed: plan.customers, batches: plan.customers, failedBatches: 0, failedCustomers: 0 });
    const states = await prisma.customerJourneyState.findMany({
      where: { customerId: { in: customerIds } },
      select: { customerId: true, stage: true },
    });
    expect(Object.fromEntries(states.map((s) => [s.customerId, s.stage]))).toEqual({
      [prospect.id]: 'CONTACTED',
      [walkIn.id]: 'IDENTIFIED',
      [buyer.id]: 'PURCHASED',
    });
    const parity = await checkPurchasedParity(stateService);
    expect(parity.ok).toBe(true);
    expect(backfillExitCode({ plan, result, parity })).toBe(0);

    const again = await runJourneyBackfill(prisma, stateService, { batchSize: 2, log: jest.fn() });
    expect(again.failedBatches).toBe(0);
    expect(await prisma.customerJourneyState.count({ where: { customerId: { in: customerIds } } })).toBe(3);
  });

  it('ยกเลิกใบขายหลังสร้างแคชโดยยังไม่ recompute → PURCHASED มากกว่า BOUGHT_WHERE 1 → exit 2 · recompute คนนั้นแล้วกลับมาตรง', async () => {
    const { buyer, sale } = await seedDataset();
    const plan = await planJourneyBackfill(prisma, stateService);
    const result = await runJourneyBackfill(prisma, stateService, { batchSize: 50, log: jest.fn() });
    await prisma.sale.update({ where: { id: sale.id }, data: { deletedAt: new Date() } });

    const stale = await checkPurchasedParity(stateService);
    expect(stale.ok).toBe(false);
    expect(stale.purchasedStates - stale.boughtCustomers).toBe(1);
    expect(backfillExitCode({ plan, result, parity: stale })).toBe(2);

    await stateService.recompute([buyer.id]);
    expect((await checkPurchasedParity(stateService)).ok).toBe(true);
    expect((await prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId: buyer.id } })).stage).not.toBe('PURCHASED');
  });

  it('recompute ล้มชุดที่มี walk-in → failedBatches=1 · keyset ขยับต่อ คนซื้อ (createdAt หลังกว่า) ยังได้แคช → exit 2', async () => {
    const { prospect, walkIn, buyer } = await seedDataset();
    const plan = await planJourneyBackfill(prisma, stateService);
    const flaky = {
      recompute: async (ids: string[]) => {
        if (ids.includes(walkIn.id)) throw new Error('boom');
        await stateService.recompute(ids);
      },
    };
    const log = jest.fn();

    const result = await runJourneyBackfill(prisma, flaky, { batchSize: 1, log });

    expect(result.processed).toBe(plan.customers);
    expect(result.failedBatches).toBe(1);
    expect(result.failedCustomers).toBe(1);
    expect(log).toHaveBeenCalledWith(`FAILED batch first=${walkIn.id} last=${walkIn.id} size=1: boom`);
    const states = await prisma.customerJourneyState.findMany({
      where: { customerId: { in: [prospect.id, walkIn.id, buyer.id] } },
      select: { customerId: true },
    });
    expect(states.map((s) => s.customerId).sort()).toEqual([prospect.id, buyer.id].sort());
    expect(backfillExitCode({ plan, result, parity: await checkPurchasedParity(stateService) })).toBe(2);
  });
});
```
Run (จาก `apps/api`): `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/cli/backfill-customer-journey.db.spec.ts --runInBand` → Expected: FAIL `Cannot find module './backfill-customer-journey.cli'`

- [ ] **Step 3: export predicate ห้องไม่มีเจ้าของ (ไม่ลอกตรรกะซ้ำ)**

`apps/api/src/cli/backfill-chat-prospects.cli.ts` บรรทัด 49 จาก
```ts
const BACKFILL_WHERE: Prisma.ChatRoomWhereInput = {
```
เป็น
```ts
export const BACKFILL_WHERE: Prisma.ChatRoomWhereInput = {
```

- [ ] **Step 4: ตัว CLI**

สร้าง `apps/api/src/cli/backfill-customer-journey.cli.ts`:
```ts
/**
 * ย้อนหลัง "แคชการเดินทางของลูกค้า" (customer_journey_states) ให้ลูกค้าทุกคนที่ยังไม่ถูกลบ
 * (synthesis api §7 · แผน 2 การเดินทางของลูกค้า เฟส 1)
 *
 * ทำงานผ่าน JourneyStateService.recompute ตัวเดียวกับ runtime และ cron (journey-state.sql ไฟล์เดียว) —
 * CLI นี้ไม่มีสำเนาตรรกะขั้นที่สอง แค่แบ่งลูกค้าเป็นชุดแล้วเรียก recompute(ids) ทีละชุด
 * รันซ้ำได้: journey-state.sql เป็น INSERT … ON CONFLICT (customer_id) DO UPDATE · รันพร้อม cron journey:recompute ได้ (upsert ทั้งคู่)
 *
 * ลำดับบน prod: deploy → backfill:chat-prospects (ผูกห้องแชทให้ครบ) → backfill:customer-journey
 *
 * ด่านหยุดจริง (ก่อนเขียนอะไร และทำงานตอน dry-run ด้วย ⇒ exit 1):
 * - ห้องที่ backfill:chat-prospects ยังต้องผูก (BACKFILL_WHERE) เกิน 1% ของห้องที่ยังไม่ถูกลบ —
 *   ลูกค้าจากแชทที่ยังไม่ถูกสร้าง/ผูกจะไม่มีแคช และ firstSource/firstChannel ที่ถูกแช่แข็งจะผิด
 *
 * ด่านหลังเขียน (exit 2 = เขียนแล้วแต่ต้องมีคนดู):
 * - JourneyStateService.purchasedParity(): state stage=PURCHASED ≠ ลูกค้าที่ตรง BOUGHT_WHERE (ตัวเดียวกับ cron)
 * - recompute ล้มอย่างน้อยหนึ่งชุด
 * - plan.customers ≠ result.processed (สัญญาณสุขภาพ pagination — ลูกค้าใหม่เข้ามาระหว่างรันก็ทำให้ต่างได้จริง)
 *
 * KEYSET PAGINATION แบบเดียวกับ backfill-chat-prospects (Ruling R20): orderBy (createdAt,id) +
 * WHERE (createdAt,id) > ตัวสุดท้ายของชุดก่อนเสมอ ไม่ใช้ Prisma cursor/skip · ชุดที่ recompute ล้ม
 * ยังขยับคีย์ผ่านไป กันวนซ้ำชุดเดิมไม่รู้จบ (ไม่ใช้ recomputeAll เพราะชุดเดียวล้ม = หยุดทั้งรอบ)
 *
 * PDPA: log มีแค่ id ลูกค้า (uuid) กับตัวเลข — ไม่อ่าน/ไม่พิมพ์ชื่อ เบอร์ เลขบัตร ที่อยู่ ข้อความแชท
 *
 * GUARDS (แบบเดียวกับ backfill-chat-prospects.cli.ts)
 * - EXPECTED_DB_NAME ต้องตรง current_database() ไม่งั้น exit 1
 * - DRY-RUN เป็นค่าตั้งต้น: พิมพ์แผน + ด่าน 1% + parity ของแคชตอนนี้ ไม่เขียนอะไร
 * - CONFIRM_BACKFILL=YES_I_AM_SURE จึงเขียน · NODE_ENV=production ต้องมี ALLOW_PROD_BACKFILL=YES_I_AM_SURE ด้วย
 *
 * ใช้:  EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run backfill:customer-journey            (dry-run)
 *       CONFIRM_BACKFILL=YES_I_AM_SURE ALLOW_PROD_BACKFILL=YES_I_AM_SURE NODE_ENV=production \
 *       EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run backfill:customer-journey            (เขียนจริง)
 *       BATCH_SIZE=500 ปรับได้ · dev: DATABASE_URL=… npx ts-node --transpile-only src/cli/backfill-customer-journey.cli.ts
 *
 * รันจริงบน prod เป็น Cloud Run Job ในอิมเมจ API แบบเดียวกับ bestchoice-seed-gfin (dry-run ก่อนเสมอ · runbook ใน Task 13)
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { CHAT_SOURCE_PREFIX } from '@installment/shared';
import { PrismaService } from '../prisma/prisma.service';
import { JourneyStateService } from '../modules/customer-journey/journey-state.service';
import { BACKFILL_WHERE as UNLINKED_ROOM_WHERE } from './backfill-chat-prospects.cli';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

/** ห้องไม่มีเจ้าของเกินสัดส่วนนี้ = หยุดจริง (exit 1) */
export const UNLINKED_ROOMS_MAX_RATIO = 0.01;

const LIVE_CUSTOMER_WHERE: Prisma.CustomerWhereInput = { deletedAt: null };
const CUSTOMER_SELECT = { id: true, createdAt: true } as const;

export interface JourneyBackfillPlan {
  /** ลูกค้าที่ยังไม่ถูกลบ = จำนวนที่จะ recompute */
  customers: number;
  /** แถวแคชที่มีอยู่แล้วก่อนรัน */
  existingStates: number;
  /** ลูกค้าที่ตรง BOUGHT_WHERE (จาก purchasedParity) — หลังรันต้องเท่ากับจำนวน state PURCHASED */
  boughtCustomers: number;
  /** ห้องแชทที่ยังไม่ถูกลบ (ตัวหารของด่าน 1%) */
  liveRooms: number;
  /** ห้องที่ backfill:chat-prospects ยังต้องผูก (ตัวตั้งของด่าน 1%) */
  unlinkedRooms: number;
  /** placeholder ที่ถูกรวมแล้ว (deleted_at + merged_into_id) — ตัวอ่านดึง event ของพวกนี้ขึ้นใต้ลูกค้าจริง */
  mergedPlaceholders: number;
  /** placeholder จากแชทที่ถูกลบแต่ไม่มี merged_into_id = การรวมที่ audit ถูกข้าม — รายงานเป็นตัวเลข คาดว่า 0 */
  unmergedDeletedChatPlaceholders: number;
}

export interface JourneyBackfillResult {
  processed: number;
  batches: number;
  failedBatches: number;
  failedCustomers: number;
}

export interface PurchasedParity {
  boughtCustomers: number;
  purchasedStates: number;
  ok: boolean;
}

/** แผน (dry-run): นับอย่างเดียว ไม่เขียน */
export async function planJourneyBackfill(
  prisma: Pick<PrismaClient, 'customer' | 'chatRoom' | 'customerJourneyState'>,
  stateService: Pick<JourneyStateService, 'purchasedParity'>,
): Promise<JourneyBackfillPlan> {
  const [customers, existingStates, parity, liveRooms, unlinkedRooms, mergedPlaceholders, unmergedDeletedChatPlaceholders] =
    await Promise.all([
      prisma.customer.count({ where: LIVE_CUSTOMER_WHERE }),
      prisma.customerJourneyState.count(),
      stateService.purchasedParity(),
      prisma.chatRoom.count({ where: { deletedAt: null } }),
      prisma.chatRoom.count({ where: UNLINKED_ROOM_WHERE }),
      prisma.customer.count({ where: { deletedAt: { not: null }, mergedIntoId: { not: null } } }),
      prisma.customer.count({
        where: { deletedAt: { not: null }, mergedIntoId: null, acquisitionSource: { startsWith: CHAT_SOURCE_PREFIX } },
      }),
    ]);
  return {
    customers,
    existingStates,
    boughtCustomers: parity.bought,
    liveRooms,
    unlinkedRooms,
    mergedPlaceholders,
    unmergedDeletedChatPlaceholders,
  };
}

/** ด่าน 1%: เท่ากับ 1% พอดียังผ่าน · ไม่มีห้องเลย = ผ่าน */
export function unlinkedRoomsGate(plan: Pick<JourneyBackfillPlan, 'liveRooms' | 'unlinkedRooms'>): { ok: boolean; ratio: number } {
  const ratio = plan.liveRooms === 0 ? 0 : plan.unlinkedRooms / plan.liveRooms;
  return { ok: ratio <= UNLINKED_ROOMS_MAX_RATIO, ratio };
}

/**
 * เขียนจริง: วนลูกค้าที่ยังไม่ถูกลบด้วย explicit keyset เดินหน้าเสมอ (Ruling R20) แล้ว recompute ทีละชุด
 * ชุดที่ล้มถูกนับและ log (id ต้น/ท้ายชุด) แล้วขยับคีย์ต่อ
 */
export async function runJourneyBackfill(
  prisma: Pick<PrismaClient, 'customer'>,
  stateService: Pick<JourneyStateService, 'recompute'>,
  opts: { batchSize: number; log: (line: string) => void },
): Promise<JourneyBackfillResult> {
  const result: JourneyBackfillResult = { processed: 0, batches: 0, failedBatches: 0, failedCustomers: 0 };
  let last: { id: string; createdAt: Date } | undefined;
  for (;;) {
    const batch = await prisma.customer.findMany({
      where: last
        ? { AND: [LIVE_CUSTOMER_WHERE, { OR: [{ createdAt: { gt: last.createdAt } }, { createdAt: last.createdAt, id: { gt: last.id } }] }] }
        : LIVE_CUSTOMER_WHERE,
      select: CUSTOMER_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: opts.batchSize,
    });
    if (batch.length === 0) break;
    const ids = batch.map((c) => c.id);
    result.batches++;
    result.processed += ids.length;
    try {
      await stateService.recompute(ids);
    } catch (err) {
      result.failedBatches++;
      result.failedCustomers += ids.length;
      opts.log(`FAILED batch first=${ids[0]} last=${ids[ids.length - 1]} size=${ids.length}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // ขยับ keyset ไปที่ลูกค้าคนสุดท้ายของชุดเสมอ ไม่ว่าชุดนี้จะสำเร็จหรือล้ม (Ruling R20)
    const lastCustomer = batch[batch.length - 1];
    last = { id: lastCustomer.id, createdAt: lastCustomer.createdAt };
    opts.log(`batch done: processed=${result.processed} failedBatches=${result.failedBatches}`);
  }
  return result;
}

/** ด่านหลังเขียน: ใช้ purchasedParity ของ JourneyStateService ตัวเดียวกับ cron journey:recompute */
export async function checkPurchasedParity(stateService: Pick<JourneyStateService, 'purchasedParity'>): Promise<PurchasedParity> {
  const { purchasedStates, bought } = await stateService.purchasedParity();
  return { boughtCustomers: bought, purchasedStates, ok: bought === purchasedStates };
}

export function backfillExitCode(input: {
  plan: Pick<JourneyBackfillPlan, 'customers'>;
  result: JourneyBackfillResult;
  parity: PurchasedParity;
}): 0 | 2 {
  if (!input.parity.ok) return 2;
  if (input.result.failedBatches > 0) return 2;
  if (input.result.processed !== input.plan.customers) return 2;
  return 0;
}

async function assertExpectedDb(prisma: PrismaClient): Promise<void> {
  const expected = process.env.EXPECTED_DB_NAME;
  if (!expected) throw new Error('EXPECTED_DB_NAME is required');
  const [{ current_database }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (current_database !== expected) throw new Error(`DB mismatch: connected to "${current_database}", expected "${expected}"`);
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  try {
    await assertExpectedDb(prisma);
    const stateService = new JourneyStateService(prisma);
    const plan = await planJourneyBackfill(prisma, stateService);
    console.log('[plan]', JSON.stringify(plan));
    const gate = unlinkedRoomsGate(plan);
    if (!gate.ok) {
      throw new Error(
        `ห้องแชทยังไม่มีเจ้าของ ${plan.unlinkedRooms}/${plan.liveRooms} ห้อง (${(gate.ratio * 100).toFixed(2)}%) เกิน ${UNLINKED_ROOMS_MAX_RATIO * 100}% — รัน backfill:chat-prospects ให้ครบก่อน แล้วค่อยรันตัวนี้`,
      );
    }
    console.log('[parity-now]', JSON.stringify(await checkPurchasedParity(stateService)));
    const confirmed = process.env.CONFIRM_BACKFILL === REQUIRED_CONSENT;
    if (!confirmed) {
      console.log('DRY-RUN — set CONFIRM_BACKFILL=YES_I_AM_SURE to write');
      return;
    }
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_BACKFILL !== REQUIRED_CONSENT) {
      throw new Error('production requires ALLOW_PROD_BACKFILL=YES_I_AM_SURE');
    }
    const result = await runJourneyBackfill(prisma, stateService, {
      batchSize: Number(process.env.BATCH_SIZE ?? 500),
      log: (l) => console.log('[run]', l),
    });
    console.log('[result]', JSON.stringify(result));
    const parity = await checkPurchasedParity(stateService);
    console.log('[parity]', JSON.stringify(parity));
    if (!parity.ok) {
      console.warn(
        `[backfill-customer-journey] WARNING: PURCHASED states=${parity.purchasedStates} vs BOUGHT_WHERE=${parity.boughtCustomers} — แคชไม่ตรงแท็บลูกค้า ตรวจ journey-state.sql หรือมีการขาย/ยกเลิกระหว่างรัน`,
      );
    }
    if (result.processed !== plan.customers) {
      console.warn(
        `[backfill-customer-journey] WARNING: plan.customers=${plan.customers} vs result.processed=${result.processed} — check for a pagination gap or customers created during the run`,
      );
    }
    process.exitCode = backfillExitCode({ plan, result, parity });
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 5: เทสเขียว + เทสเดิมที่แตะไม่พัง + typecheck + lint**

Run (จาก `apps/api`, env `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test` ทุกคำสั่ง jest):
- `npx jest src/cli/backfill-customer-journey.spec.ts --runInBand` → Expected: PASS 10 tests
- `npx jest src/cli/backfill-customer-journey.db.spec.ts --runInBand` → Expected: PASS 4 tests · ถ้าเทสขั้น (`CONTACTED`/`IDENTIFIED`/`PURCHASED`) ไม่ตรง แสดงว่า `journey-state.sql` ของ Task 3 ไม่ตรงกติกา stages ใน synthesis — หยุดแล้วแจ้งผู้ประสานงาน ห้ามแก้ SQL หรือแก้ค่าที่คาดในเทสนี้
- `npx jest src/cli/backfill-chat-prospects.spec.ts src/cli/backfill-chat-prospects.db.spec.ts --runInBand` → Expected: PASS ทั้ง 2 suite (export ไม่เปลี่ยนพฤติกรรม)
- `npx tsc --noEmit -p tsconfig.json` → Expected: 0 error
- `npx eslint src/cli/backfill-customer-journey.cli.ts src/cli/backfill-customer-journey.spec.ts src/cli/backfill-customer-journey.db.spec.ts src/cli/backfill-chat-prospects.cli.ts` → Expected: 0 error (🚨 ห้าม `npm run lint`)

- [ ] **Step 6: npm script + ทดสอบจาก dist แบบที่ Cloud Run Job รันจริง**

`apps/api/package.json` แทรกต่อจากบรรทัด 59 (`"backfill:chat-prospects:help": ...`) ก่อน `"seed:test-contracts"`:
```json
    "backfill:customer-journey": "node dist/src/cli/backfill-customer-journey.cli.js",
    "backfill:customer-journey:help": "echo 'Dry-run default: EXPECTED_DB_NAME=<db> npm --prefix apps/api run backfill:customer-journey. To write: CONFIRM_BACKFILL=YES_I_AM_SURE EXPECTED_DB_NAME=<db> [ALLOW_PROD_BACKFILL=YES_I_AM_SURE NODE_ENV=production] [BATCH_SIZE=500] npm --prefix apps/api run backfill:customer-journey — รันหลัง backfill:chat-prospects เท่านั้น · exit 1 = DB ไม่ตรง หรือห้องแชทไม่มีเจ้าของเกิน 1% · exit 2 = PURCHASED ไม่ตรง BOUGHT_WHERE หรือ recompute ล้ม'",
```

Run (จาก `apps/api`):
```bash
node -e "require('./package.json')" && echo json-ok
npm run build --workspace=@installment/shared
npx nest build
npm run verify:assets
DB_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public"
PSQL_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket"

# 1) ชื่อ DB ไม่ตรง → exit 1
DATABASE_URL="$DB_URL" EXPECTED_DB_NAME=bestchoice node dist/src/cli/backfill-customer-journey.cli.js; echo "exit=$?"

# 2) dry-run
DATABASE_URL="$DB_URL" EXPECTED_DB_NAME=bc_journey_test node dist/src/cli/backfill-customer-journey.cli.js; echo "exit=$?"

# 3) เขียนจริงจาก dist กับลูกค้า 1 คน — พิสูจน์ว่าไฟล์ SQL ทั้ง 3 ไฟล์ไปถึง dist
SMOKE_ID=$(psql "$PSQL_URL" -qAtc "INSERT INTO customers (id, name, updated_at) VALUES (gen_random_uuid(), 'journey backfill smoke', now()) RETURNING id")
DATABASE_URL="$DB_URL" EXPECTED_DB_NAME=bc_journey_test CONFIRM_BACKFILL=YES_I_AM_SURE node dist/src/cli/backfill-customer-journey.cli.js; echo "exit=$?"
psql "$PSQL_URL" -qAtc "SELECT stage FROM customer_journey_states WHERE customer_id = '$SMOKE_ID'"
psql "$PSQL_URL" -qAtc "DELETE FROM customer_journey_states WHERE customer_id = '$SMOKE_ID'; DELETE FROM customers WHERE id = '$SMOKE_ID'"
```
Expected:
- `json-ok` · `✓ Assets verified`
- (1) `Error: DB mismatch: connected to "bc_journey_test", expected "bestchoice"` แล้ว `exit=1`
- (2) มีบรรทัด `[plan] {...}` · `[parity-now] {...}` · `DRY-RUN — set CONFIRM_BACKFILL=YES_I_AM_SURE to write` แล้ว `exit=0` (ฐานทดสอบว่าง ⇒ ตัวเลขเป็น 0 ทั้งหมดและ `"ok":true` · ถ้ามีแถวค้างจาก spec อื่น ตัวเลขต่างได้แต่ต้องครบ 3 บรรทัดนี้)
- (3) `[run] batch done: processed=1 failedBatches=0` · `[result] {"processed":1,"batches":1,"failedBatches":0,"failedCustomers":0}` · `[parity] {"boughtCustomers":0,"purchasedStates":0,"ok":true}` แล้ว `exit=0` · SELECT ได้ `CONTACTED` (ลูกค้าไม่มีเบอร์ ไม่มีห้อง ไม่ได้ซื้อ) · ถ้า (2) หรือ (3) ล้มด้วย `ENOENT ... .sql` ⇒ asset ของ Task 3/9 ไม่ถูก copy เข้า dist — หยุดแล้วแจ้งผู้ประสานงาน ห้ามแก้ `nest-cli.json` ใน task นี้ · รันคำสั่ง DELETE บรรทัดสุดท้ายทุกครั้งแม้ขั้นก่อนหน้าจะล้ม

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/cli/backfill-customer-journey.cli.ts apps/api/src/cli/backfill-customer-journey.spec.ts apps/api/src/cli/backfill-customer-journey.db.spec.ts apps/api/src/cli/backfill-chat-prospects.cli.ts apps/api/package.json
git commit -m "feat(customer-journey): CLI backfill:customer-journey เติมแคชการเดินทางย้อนหลัง พร้อมด่านห้องแชทไม่มีเจ้าของเกิน 1% (exit 1) และด่าน PURCHASED ต้องตรง BOUGHT_WHERE (exit 2)

ใช้ JourneyStateService.recompute/purchasedParity ตัวเดียวกับ cron — ไม่มีตรรกะขั้นชุดที่สอง

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: เว็บ — ไทม์ไลน์กลาง `EventTimeline` + ชิปกรองรับชุดชิปจากผู้เรียก + ย้ายไทม์ไลน์แผงติดตามหนี้มาใช้ของกลาง

> ทำไมต้องมีงานนี้: แท็บ "การเดินทาง" (Task 12) ต้องใช้ไทม์ไลน์หน้าตาเดียวกับแผงลูกค้า 360 ของหน้าติดตามหนี้ (แบ่งกลุ่มตามวัน · ไอคอนตามชนิด) และต้องมีอีก 2 อย่างที่ของเดิมไม่มี: ป้าย "ประมาณ" สำหรับเวลาย้อนหลังที่ระบบประมาณเอา กับหัวข้อที่กดเป็นลิงก์ได้ (`href`) · งานนี้แยกส่วนแสดงผลออกเป็น component กลางก่อน แล้วทำ `Customer360Timeline` ใหม่บนตัวกลางนั้น โดยหน้าจอเดิมต้องไม่เปลี่ยน
>
> เทสเดิม: ตรวจแล้ว **ไม่มี** เทสของ `Customer360Timeline` หรือ `TimelineFilterChips` เลย (grep ทั้ง `apps/web/src` และ `apps/web/e2e` · `e2e/collections-smoke.spec.ts` ไม่แตะไทม์ไลน์ · `UnifiedInboxPage/components/Customer360Panel.test.tsx` เป็นคนละ component) ⇒ Step 1 จึงเขียนเทสล็อกพฤติกรรมเดิมไว้ก่อน ต้องผ่านทั้งก่อนและหลังแก้โค้ด
>
> เทสใหม่ 4 ไฟล์ = 18 เทส · ป้ายกลุ่มใช้ชุดเดียวกับ `eventCatalog[].group` ของแบบ (`แชท/ติดต่อ · เครดิต · ขาย/สัญญา · ชำระเงิน · ติดตามหนี้ · บริการ/ประกัน · แต้ม · ระบบ`) และ Task 12 อ่านป้าย/ไอคอนจาก `GROUP_EVENT_STYLES` ของงานนี้ที่เดียว (ไม่ประกาศซ้ำในหน้าลูกค้า)
>
> ก่อนเริ่ม: `find src/pages/CollectionsPage -name '*.test.ts*' | wc -l` (จาก `apps/web`) = 10 ไฟล์ ณ วันเขียนแผน — ใช้เป็นฐานของ Step 6

**Files:**
- Create: `apps/web/src/components/timeline/eventTimelineUtils.ts` (ย้ายมาจาก `groupByDate` และ `timeLabel` ใน `Customer360Timeline.tsx:21-59` โดยรับ `now` จากผู้เรียกได้)
- Create: `apps/web/src/components/timeline/eventTimelineStyles.ts` (type `EventStyle` ย้ายมาจาก `Customer360Timeline.tsx:63-68` + ไอคอนและป้ายตามกลุ่มการเดินทาง)
- Create: `apps/web/src/components/timeline/EventTimeline.tsx` (ส่วนแสดงผลจาก `Customer360Timeline.tsx:146-193` และ `:250-277` เพิ่มป้าย "ประมาณ" · ลิงก์ `href` · `renderExtra` · `footer`)
- Create: `apps/web/src/components/timeline/__tests__/eventTimelineUtils.test.ts`
- Create: `apps/web/src/components/timeline/__tests__/EventTimeline.test.tsx`
- Create: `apps/web/src/pages/CollectionsPage/components/Customer360Timeline.test.tsx` (เทสล็อกพฤติกรรมเดิม)
- Create: `apps/web/src/pages/CollectionsPage/components/TimelineFilterChips.test.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/components/TimelineFilterChips.tsx:1-56` (เพิ่ม prop `chips` + `aria-pressed` · props เปลี่ยนเป็นชนิด `string`)
- Modify: `apps/web/src/pages/CollectionsPage/components/Customer360Timeline.tsx:1-281` (เขียนใหม่ทั้งไฟล์บน `EventTimeline` · props `{ events }` เหมือนเดิม)
- ไม่แตะ: `apps/web/src/pages/CollectionsPage/components/Customer360Panel.tsx:25` (import) และ `:386` (`<Customer360Timeline events={data?.timeline ?? []} />`) ใช้ต่อได้โดยไม่ต้องแก้

**Interfaces:**
- Consumes:
  - `TimelineEvent` จาก `apps/web/src/pages/CollectionsPage/hooks/useCustomer360.ts:4-11` → `{ id: string; type: 'CALL'|'PAYMENT'|'DUNNING_ACTION'|'STATUS_CHANGE'|'MDM'|'LETTER'; timestamp: string; title: string; subtitle?: string; metadata?: Record<string, unknown> }`
  - `formatThaiDateShort(input)` `apps/web/src/lib/date.ts:121` · `formatThaiTime(input)` `apps/web/src/lib/date.ts:142`
  - `Button` `apps/web/src/components/ui/button.tsx:341` (ส่ง props ที่เหลือต่อให้ `<button>` ทั้งหมด จึงรับ `aria-pressed` ได้) · `DateRangePicker` `apps/web/src/components/ui/DateRangePicker.tsx:73` (มีปุ่มลัดชื่อ "วันนี้" ซ้ำกับหัวกลุ่ม ⇒ เทสต้องกรองปุ่มออก)
  - `VoiceMemoPlayback({ voiceMemoUrl, tier?, callLogId? })` `apps/web/src/pages/CollectionsPage/components/VoiceMemoPlayback.tsx` (ไฟล์เสียงแบบ HOT แสดงเป็น `<audio src>`)
  - `Link` จาก `react-router` (^7.15 ตามที่ `components/chat/ChannelBadge.tsx:1` ใช้อยู่)
  - Task 1 — `JOURNEY_EVENT_GROUPS` (readonly `['chat','credit','sale','payment','collections','service','points','system']`) + `type JourneyEventGroup` จาก `@installment/shared` (เว็บ resolve ไป `packages/shared/src` ผ่าน alias ใน `apps/web/vite.config.ts:25` · `vitest.config.ts:11` · `tsconfig.json:24` ไม่ต้อง build)
  - Task 1 — `JourneyEvent` มีโครงครอบ `EventTimelineItem` (`id, type, group, timestamp, title, subtitle?, reliability, href?, metadata?`) · งานนี้ไม่ import `JourneyEvent` · Task 12 แปลงเป็น `EventTimelineItem` โดยตัด `metadata` ออกก่อนส่ง (PDPA)
- Produces:
  - `apps/web/src/components/timeline/EventTimeline.tsx`:
    - `export interface EventTimelineItem { id: string; type: string; group?: string; timestamp: string; title: string; subtitle?: string; reliability?: 'exact' | 'approximate'; href?: string; metadata?: Record<string, unknown> }`
    - `export interface EventTimelineProps<T extends EventTimelineItem> { events: T[]; getStyle?: (event: T) => EventStyle; renderExtra?: (event: T) => ReactNode; emptyText?: string; footer?: ReactNode }`
    - `export function EventTimeline<T extends EventTimelineItem>(props: EventTimelineProps<T>)` (named export) · ค่าตั้งต้น `emptyText = 'ยังไม่มีกิจกรรม'` · แสดง `footer` เฉพาะตอนมีรายการ · DOM มี `data-testid="event-timeline-group"` และ `data-testid="event-timeline-item"`
  - `apps/web/src/components/timeline/eventTimelineStyles.ts`: `export interface EventStyle { Icon: LucideIcon; iconBg: string; iconText: string; typeLabel: string }` · `export const GROUP_EVENT_STYLES: Readonly<Record<JourneyEventGroup, EventStyle>>` (key ครบ `JOURNEY_EVENT_GROUPS` ป้าย `แชท/ติดต่อ, เครดิต, ขาย/สัญญา, ชำระเงิน, ติดตามหนี้, บริการ/ประกัน, แต้ม, ระบบ` ตาม `eventCatalog[].group` ของแบบ) · `export function defaultEventStyle(event: { type: string; group?: string }): EventStyle`
  - `apps/web/src/components/timeline/eventTimelineUtils.ts`: `export interface DateGroup<T> { label: string; items: T[] }` · `export function groupEventsByDate<T extends { timestamp: string }>(events: T[], now?: Date): DateGroup<T>[]` · `export function relativeTimeLabel(iso: string, now?: number): string`
  - `apps/web/src/pages/CollectionsPage/components/TimelineFilterChips.tsx`: `export interface TimelineChip { value: string; label: string }` · default export props `{ value: string; onChange: (value: string) => void; counts?: Partial<Record<string, number>>; chips?: TimelineChip[]; className?: string }` (ไม่ส่ง `chips` = ชุดติดตามหนี้เดิม 7 ชิป) · ชิปทุกตัวมี `aria-pressed` · ยังส่งออก `TimelineEventType` และ `TimelineFilterValue` เหมือนเดิม
  - Task 12 ใช้แบบนี้: `<TimelineFilterChips chips={[{ value: 'ALL', label: 'ทั้งหมด' }, ...groups.map((g) => ({ value: g, label: GROUP_EVENT_STYLES[g].typeLabel }))]} … />` + `<EventTimeline events={items} emptyText=… footer={<ปุ่มโหลดเพิ่ม/>} />` (`items` = `EventTimelineItem[]` ที่ไม่มี `metadata`)

- [ ] **Step 1: เทสล็อกพฤติกรรมเดิมของ `Customer360Timeline` (ต้องผ่านก่อนแตะโค้ด)**

สร้าง `apps/web/src/pages/CollectionsPage/components/Customer360Timeline.test.tsx`:
```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatThaiDateShort, formatThaiTime } from '@/lib/date';
import type { TimelineEvent } from '../hooks/useCustomer360';

vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (url: string) => {
      throw new Error(`unexpected api.get ${url}`);
    },
    post: (url: string) => {
      throw new Error(`unexpected api.post ${url}`);
    },
  },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'error'),
}));

import Customer360Timeline from './Customer360Timeline';

// เทสล็อกพฤติกรรมเดิมก่อนย้ายไปใช้ EventTimeline กลาง — ต้องเขียวทั้งก่อนและหลังแตะโค้ด
const NOW = new Date('2026-09-15T05:00:00.000Z');
const OLD_CALL_AT = '2026-09-10T07:32:00.000Z';

const events: TimelineEvent[] = [
  { id: 'payment-p1', type: 'PAYMENT', timestamp: '2026-09-15T04:55:00.000Z', title: 'รับชำระงวด 6', subtitle: '4,200 บาท' },
  { id: 'dunning-d1', type: 'DUNNING_ACTION', timestamp: '2026-09-14T10:00:00.000Z', title: 'ส่ง LINE เตือนค้างชำระ' },
  {
    id: 'call-c1',
    type: 'CALL',
    timestamp: OLD_CALL_AT,
    title: 'โทรติดตาม',
    metadata: { result: 'PROMISED', voiceMemoUrl: 'https://files.example/voice-c1.webm', voiceMemoTier: 'HOT', callLogId: 'c1' },
  },
];

/** หัวกลุ่มวันที่ — ตัดปุ่มลัด "วันนี้" ของ DateRangePicker ออก */
function dateHeaders(text: string) {
  return screen.getAllByText(text).filter((el) => el.tagName !== 'BUTTON');
}

describe('Customer360Timeline (พฤติกรรมเดิม)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ไม่มีกิจกรรม → ยังไม่มีกิจกรรม', () => {
    render(<Customer360Timeline events={[]} />);
    expect(screen.getByText('ยังไม่มีกิจกรรม')).toBeInTheDocument();
  });

  it('จัดกลุ่ม วันนี้ / เมื่อวาน / วันที่ พร้อมป้ายเวลา ป้ายชนิด คำอธิบาย และจำนวนบนชิป', () => {
    render(<Customer360Timeline events={events} />);
    expect(dateHeaders('วันนี้')).toHaveLength(1);
    expect(dateHeaders('เมื่อวาน')).toHaveLength(1);
    expect(dateHeaders(formatThaiDateShort(OLD_CALL_AT))).toHaveLength(1);
    expect(screen.getByText('5 นาทีที่แล้ว')).toBeInTheDocument();
    expect(screen.getByText('19 ชม.ที่แล้ว')).toBeInTheDocument();
    expect(screen.getByText(formatThaiTime(OLD_CALL_AT))).toBeInTheDocument();
    expect(screen.getByText('รับชำระงวด 6')).toBeInTheDocument();
    expect(screen.getByText('4,200 บาท')).toBeInTheDocument();
    // ป้ายชนิดอยู่ทั้งบนชิปและในแถว
    expect(screen.getAllByText('ชำระ')).toHaveLength(2);
    expect(screen.getAllByText('แจ้งเตือน')).toHaveLength(2);
    expect(screen.getAllByText('โทร')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^ทั้งหมด/ })).toHaveTextContent('ทั้งหมด3');
    expect(screen.getByRole('button', { name: /^ชำระ/ })).toHaveTextContent('ชำระ1');
  });

  it('สีไอคอนโทรตามผล: นัดจ่าย = success · ปฏิเสธ = destructive · อื่น ๆ = primary', () => {
    const { container, rerender } = render(<Customer360Timeline events={[{ ...events[2], metadata: { result: 'PROMISED' } }]} />);
    expect(container.querySelector('svg.text-success')).not.toBeNull();
    rerender(<Customer360Timeline events={[{ ...events[2], metadata: { result: 'REFUSED' } }]} />);
    expect(container.querySelector('svg.text-destructive')).not.toBeNull();
    rerender(<Customer360Timeline events={[{ ...events[2], metadata: { result: 'NO_ANSWER' } }]} />);
    expect(container.querySelector('svg.text-primary')).not.toBeNull();
  });

  it('กดชิปโทร → เหลือเฉพาะโทร · ชิปหนังสือ → ไม่พบกิจกรรมตามตัวกรอง', async () => {
    const user = userEvent.setup();
    render(<Customer360Timeline events={events} />);
    await user.click(screen.getByRole('button', { name: /^โทร/ }));
    expect(screen.queryByText('รับชำระงวด 6')).toBeNull();
    expect(screen.getByText('โทรติดตาม')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^หนังสือ/ }));
    expect(screen.getByText('ไม่พบกิจกรรมตามตัวกรอง')).toBeInTheDocument();
  });

  it('โทรที่มีไฟล์เสียง HOT → มีตัวเล่นเสียงในแถว', () => {
    const { container } = render(<Customer360Timeline events={events} />);
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('https://files.example/voice-c1.webm');
  });

  it('ครบ 100 รายการและไม่กรอง → แสดง 100 รายการล่าสุด · กรองแล้วป้ายหาย', async () => {
    const user = userEvent.setup();
    const hundred: TimelineEvent[] = Array.from({ length: 100 }, (_, i) => ({
      id: `payment-p${i}`,
      type: 'PAYMENT',
      timestamp: new Date(NOW.getTime() - (i + 1) * 60_000).toISOString(),
      title: `รับชำระ ${i}`,
    }));
    render(<Customer360Timeline events={hundred} />);
    expect(screen.getByText('แสดง 100 รายการล่าสุด')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^ชำระ/ }));
    expect(screen.queryByText('แสดง 100 รายการล่าสุด')).toBeNull();
  });
});
```
Run: `TZ=UTC npx vitest run src/pages/CollectionsPage/components/Customer360Timeline.test.tsx` (จาก `apps/web`) → Expected: **PASS 6 tests** กับโค้ดเดิม (ถ้าแดง แปลว่าเทสอธิบายพฤติกรรมเดิมผิด ให้แก้เทส ห้ามแก้ component)

- [ ] **Step 2: เทสแดง — ตัวช่วยจัดกลุ่ม/ป้ายเวลา และ `EventTimeline`**

สร้าง `apps/web/src/components/timeline/__tests__/eventTimelineUtils.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatThaiDateShort, formatThaiTime } from '@/lib/date';
import { groupEventsByDate, relativeTimeLabel } from '../eventTimelineUtils';

const NOW = new Date('2026-09-15T05:00:00.000Z');
const OLDER = '2026-09-12T09:15:00.000Z';

describe('groupEventsByDate', () => {
  it('วันนี้ / เมื่อวาน / วันที่ — คงลำดับที่ส่งมา ไม่เรียงใหม่', () => {
    const groups = groupEventsByDate(
      [
        { id: 'a', timestamp: '2026-09-15T04:30:00.000Z' },
        { id: 'b', timestamp: '2026-09-15T01:00:00.000Z' },
        { id: 'c', timestamp: '2026-09-14T23:59:00.000Z' },
        { id: 'd', timestamp: OLDER },
        { id: 'e', timestamp: '2026-09-12T08:00:00.000Z' },
      ],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(['วันนี้', 'เมื่อวาน', formatThaiDateShort(OLDER)]);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([['a', 'b'], ['c'], ['d', 'e']]);
  });

  it('ไม่มีรายการ → ไม่มีกลุ่ม', () => {
    expect(groupEventsByDate([], NOW)).toEqual([]);
  });
});

describe('relativeTimeLabel', () => {
  const at = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

  it('ไม่ถึงนาที → ตอนนี้ · ไม่ถึงชั่วโมง → นาที · ไม่ถึงวัน → ชม. · เกินวัน → เวลา', () => {
    expect(relativeTimeLabel(at(30_000), NOW.getTime())).toBe('ตอนนี้');
    expect(relativeTimeLabel(at(5 * 60_000), NOW.getTime())).toBe('5 นาทีที่แล้ว');
    expect(relativeTimeLabel(at(3 * 3_600_000), NOW.getTime())).toBe('3 ชม.ที่แล้ว');
    expect(relativeTimeLabel(at(30 * 3_600_000), NOW.getTime())).toBe(formatThaiTime(at(30 * 3_600_000)));
  });
});
```

สร้าง `apps/web/src/components/timeline/__tests__/EventTimeline.test.tsx`:
```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PhoneCall } from 'lucide-react';
import { JOURNEY_EVENT_GROUPS } from '@installment/shared';
import { formatThaiDateShort } from '@/lib/date';
import { EventTimeline, type EventTimelineItem } from '../EventTimeline';
import { GROUP_EVENT_STYLES } from '../eventTimelineStyles';

const NOW = new Date('2026-09-15T05:00:00.000Z');
const SALE_AT = '2026-09-12T09:15:00.000Z';

const events: EventTimelineItem[] = [
  {
    id: 'chat-r1',
    type: 'CHAT_DAY',
    group: 'chat',
    timestamp: '2026-09-15T04:30:00.000Z',
    title: 'คุยแชท: ลูกค้า 4 ข้อความ · ร้านตอบ 2',
    reliability: 'approximate',
    href: '/inbox/r1',
  },
  {
    id: 'sale-s1',
    type: 'SALE_CASH',
    group: 'sale',
    timestamp: SALE_AT,
    title: 'ซื้อเงินสด iPhone 15',
    subtitle: 'สาขาสำนักงานใหญ่',
    reliability: 'exact',
  },
  { id: 'misc-1', type: 'UNKNOWN_KIND', timestamp: '2026-09-12T08:00:00.000Z', title: 'เหตุการณ์ที่ไม่มีกลุ่ม' },
];

const wrap = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('EventTimeline', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('จัดกลุ่มตามวัน หัวกลุ่ม วันนี้ / วันที่ และคงลำดับรายการ', () => {
    wrap(<EventTimeline events={events} />);
    const groups = screen.getAllByTestId('event-timeline-group');
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getByText('วันนี้')).toBeInTheDocument();
    expect(within(groups[0]).getAllByTestId('event-timeline-item')).toHaveLength(1);
    expect(within(groups[1]).getByText(formatThaiDateShort(SALE_AT))).toBeInTheDocument();
    const olderItems = within(groups[1]).getAllByTestId('event-timeline-item');
    expect(olderItems.map((el) => within(el).getByText(/ซื้อเงินสด|ไม่มีกลุ่ม/).textContent)).toEqual([
      'ซื้อเงินสด iPhone 15',
      'เหตุการณ์ที่ไม่มีกลุ่ม',
    ]);
    expect(screen.getByText('30 นาทีที่แล้ว')).toBeInTheDocument();
    expect(screen.getByText('สาขาสำนักงานใหญ่')).toBeInTheDocument();
  });

  it('ป้ายชนิดตามกลุ่ม · ไม่มีกลุ่มใช้ชื่อ type', () => {
    wrap(<EventTimeline events={events} />);
    const items = screen.getAllByTestId('event-timeline-item');
    expect(within(items[0]).getByText('แชท/ติดต่อ')).toBeInTheDocument();
    expect(within(items[1]).getByText('ขาย/สัญญา')).toBeInTheDocument();
    expect(within(items[2]).getByText('UNKNOWN_KIND')).toBeInTheDocument();
  });

  it('GROUP_EVENT_STYLES มีครบทุกกลุ่มของ shared และป้ายตรง eventCatalog ของแบบ', () => {
    expect(Object.keys(GROUP_EVENT_STYLES)).toEqual([...JOURNEY_EVENT_GROUPS]);
    expect(JOURNEY_EVENT_GROUPS.map((group) => GROUP_EVENT_STYLES[group].typeLabel)).toEqual([
      'แชท/ติดต่อ',
      'เครดิต',
      'ขาย/สัญญา',
      'ชำระเงิน',
      'ติดตามหนี้',
      'บริการ/ประกัน',
      'แต้ม',
      'ระบบ',
    ]);
  });

  it('เวลาโดยประมาณ → ป้าย "ประมาณ" เฉพาะแถวนั้น', () => {
    wrap(<EventTimeline events={events} />);
    const items = screen.getAllByTestId('event-timeline-item');
    expect(within(items[0]).getByText('ประมาณ')).toBeInTheDocument();
    expect(within(items[1]).queryByText('ประมาณ')).toBeNull();
    expect(screen.getAllByText('ประมาณ')).toHaveLength(1);
  });

  it('มี href → หัวข้อเป็นลิงก์ในแอป · ไม่มี href → ข้อความธรรมดา', () => {
    wrap(<EventTimeline events={events} />);
    expect(screen.getByRole('link', { name: 'คุยแชท: ลูกค้า 4 ข้อความ · ร้านตอบ 2' })).toHaveAttribute('href', '/inbox/r1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('getStyle และ renderExtra จากผู้เรียกมาก่อนค่าตั้งต้น', () => {
    wrap(
      <EventTimeline
        events={events}
        getStyle={() => ({ Icon: PhoneCall, iconBg: 'bg-primary/10', iconText: 'text-primary', typeLabel: 'โทร' })}
        renderExtra={(event) => (event.id === 'sale-s1' ? <span>ไฟล์แนบ</span> : null)}
      />,
    );
    expect(screen.getAllByText('โทร')).toHaveLength(3);
    const items = screen.getAllByTestId('event-timeline-item');
    expect(within(items[1]).getByText('ไฟล์แนบ')).toBeInTheDocument();
    expect(screen.getAllByText('ไฟล์แนบ')).toHaveLength(1);
  });

  it('ว่าง → emptyText (ค่าตั้งต้น ยังไม่มีกิจกรรม) และไม่แสดง footer · มีรายการ → แสดง footer', () => {
    const { rerender } = wrap(<EventTimeline events={[]} footer={<span>โหลดเพิ่ม</span>} />);
    expect(screen.getByText('ยังไม่มีกิจกรรม')).toBeInTheDocument();
    expect(screen.queryByText('โหลดเพิ่ม')).toBeNull();
    rerender(
      <MemoryRouter>
        <EventTimeline events={[]} emptyText="ไม่พบกิจกรรมตามตัวกรอง" />
      </MemoryRouter>,
    );
    expect(screen.getByText('ไม่พบกิจกรรมตามตัวกรอง')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <EventTimeline events={events} footer={<span>โหลดเพิ่ม</span>} />
      </MemoryRouter>,
    );
    expect(screen.getByText('โหลดเพิ่ม')).toBeInTheDocument();
  });
});
```
Run: `TZ=UTC npx vitest run src/components/timeline` (จาก `apps/web`) → Expected: FAIL 2 files · `Failed to resolve import "../eventTimelineUtils"` และ `Failed to resolve import "../EventTimeline"`

- [ ] **Step 3: ตัวช่วยจัดกลุ่ม + สไตล์ตามกลุ่ม + `EventTimeline`**

สร้าง `apps/web/src/components/timeline/eventTimelineUtils.ts`:
```ts
import { formatThaiDateShort, formatThaiTime } from '@/lib/date';

export interface DateGroup<T> {
  label: string;
  items: T[];
}

/**
 * จัดกลุ่มตามวันของเครื่องผู้ใช้: "วันนี้" · "เมื่อวาน" · วันที่แบบสั้น (พ.ศ.)
 * คงลำดับที่ส่งมา (API เรียงใหม่ → เก่าแล้ว) — ห้ามเรียงใหม่ในนี้ ไม่งั้นหน้าที่โหลดต่อ (keyset) จะสลับตำแหน่ง
 */
export function groupEventsByDate<T extends { timestamp: string }>(events: T[], now: Date = new Date()): DateGroup<T>[] {
  const today = new Date(now.getTime());
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 86_400_000);
  const groups = new Map<string, T[]>();
  const order: string[] = [];

  for (const event of events) {
    const day = new Date(event.timestamp);
    day.setHours(0, 0, 0, 0);
    let label: string;
    if (day.getTime() === today.getTime()) {
      label = 'วันนี้';
    } else if (day.getTime() === yesterday.getTime()) {
      label = 'เมื่อวาน';
    } else {
      label = formatThaiDateShort(day);
    }

    const bucket = groups.get(label);
    if (bucket) {
      bucket.push(event);
    } else {
      groups.set(label, [event]);
      order.push(label);
    }
  }

  return order.map((label) => ({ label, items: groups.get(label) ?? [] }));
}

/** ป้ายเวลาในแถว: ตอนนี้ · N นาทีที่แล้ว · N ชม.ที่แล้ว · เกิน 24 ชม. = HH:mm (วันที่อยู่ที่หัวกลุ่มแล้ว) */
export function relativeTimeLabel(iso: string, now: number = Date.now()): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'ตอนนี้';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ชม.ที่แล้ว`;
  return formatThaiTime(iso);
}
```

สร้าง `apps/web/src/components/timeline/eventTimelineStyles.ts`:
```ts
import {
  Activity,
  Banknote,
  CreditCard,
  Gift,
  MessageCircle,
  PhoneCall,
  Settings2,
  ShoppingBag,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { JOURNEY_EVENT_GROUPS, type JourneyEventGroup } from '@installment/shared';

export interface EventStyle {
  Icon: LucideIcon;
  iconBg: string;
  iconText: string;
  typeLabel: string;
}

/**
 * ไอคอน + ป้ายของกลุ่มเหตุการณ์ — key ตรงกับ JOURNEY_EVENT_GROUPS ใน packages/shared/src/customer-journey.ts
 * ป้ายไทยตาม eventCatalog[].group ของแบบ (แชท/ติดต่อ · เครดิต · ขาย/สัญญา · ชำระเงิน · ติดตามหนี้ · บริการ/ประกัน · แต้ม · ระบบ)
 * แท็บการเดินทาง (Task 12) ใช้ป้าย/ไอคอนชุดนี้ทั้งชิปและการ์ด — แก้ที่นี่ที่เดียว
 */
export const GROUP_EVENT_STYLES: Readonly<Record<JourneyEventGroup, EventStyle>> = {
  chat: { Icon: MessageCircle, iconBg: 'bg-primary/10', iconText: 'text-primary', typeLabel: 'แชท/ติดต่อ' },
  credit: { Icon: CreditCard, iconBg: 'bg-info/10', iconText: 'text-info', typeLabel: 'เครดิต' },
  sale: { Icon: ShoppingBag, iconBg: 'bg-success/10', iconText: 'text-success', typeLabel: 'ขาย/สัญญา' },
  payment: { Icon: Banknote, iconBg: 'bg-success/10', iconText: 'text-success', typeLabel: 'ชำระเงิน' },
  collections: { Icon: PhoneCall, iconBg: 'bg-warning/10', iconText: 'text-warning', typeLabel: 'ติดตามหนี้' },
  service: { Icon: Wrench, iconBg: 'bg-muted', iconText: 'text-muted-foreground', typeLabel: 'บริการ/ประกัน' },
  points: { Icon: Gift, iconBg: 'bg-primary/10', iconText: 'text-primary', typeLabel: 'แต้ม' },
  system: { Icon: Settings2, iconBg: 'bg-muted', iconText: 'text-muted-foreground', typeLabel: 'ระบบ' },
};

/** ค่าตั้งต้นของ EventTimeline: เลือกตาม group · ไม่มี/ไม่รู้จัก group → ไอคอนกลาง + ชื่อ type */
function isJourneyEventGroup(value: string): value is JourneyEventGroup {
  return (JOURNEY_EVENT_GROUPS as readonly string[]).includes(value);
}

export function defaultEventStyle(event: { type: string; group?: string }): EventStyle {
  if (event.group && isJourneyEventGroup(event.group)) {
    return GROUP_EVENT_STYLES[event.group];
  }
  return { Icon: Activity, iconBg: 'bg-muted', iconText: 'text-muted-foreground', typeLabel: event.type };
}
```

สร้าง `apps/web/src/components/timeline/EventTimeline.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { defaultEventStyle, type EventStyle } from './eventTimelineStyles';
import { groupEventsByDate, relativeTimeLabel } from './eventTimelineUtils';

/**
 * รูปขั้นต่ำที่ไทม์ไลน์กลางต้องการ — TimelineEvent ของแผงติดตามหนี้ และ JourneyEvent
 * (packages/shared/src/customer-journey.ts) ส่งเข้ามาได้ตรง ๆ โดยไม่ต้องแปลง
 */
export interface EventTimelineItem {
  id: string;
  type: string;
  group?: string;
  timestamp: string;
  title: string;
  subtitle?: string;
  /** 'approximate' = เวลาย้อนหลังที่ระบบประมาณจากข้อมูลอื่น → ป้าย "ประมาณ" */
  reliability?: 'exact' | 'approximate';
  /** ลิงก์ในแอป เช่น /inbox/:roomId · /contracts/:id — ไม่มี = หัวข้อไม่เป็นลิงก์ */
  href?: string;
  metadata?: Record<string, unknown>;
}

export interface EventTimelineProps<T extends EventTimelineItem> {
  events: T[];
  /** ไอคอน/สี/ป้ายชนิดต่อแถว — ไม่ส่ง = ตามกลุ่ม (defaultEventStyle) */
  getStyle?: (event: T) => EventStyle;
  /** ส่วนเสริมใต้คำอธิบาย เช่น ตัวเล่นไฟล์เสียงของการโทร — คืน null = ไม่มี */
  renderExtra?: (event: T) => ReactNode;
  emptyText?: string;
  /** แสดงท้ายรายการเมื่อมีรายการเท่านั้น เช่น ป้ายจำกัดจำนวน / ปุ่มโหลดเพิ่ม */
  footer?: ReactNode;
}

export function EventTimeline<T extends EventTimelineItem>({
  events,
  getStyle = defaultEventStyle,
  renderExtra,
  emptyText = 'ยังไม่มีกิจกรรม',
  footer,
}: EventTimelineProps<T>) {
  if (events.length === 0) {
    return <div className="text-center py-8 text-sm text-muted-foreground leading-snug">{emptyText}</div>;
  }

  const now = new Date();

  return (
    <div className="space-y-1">
      {groupEventsByDate(events, now).map((group, groupIdx) => (
        <div key={group.label} data-testid="event-timeline-group">
          <div
            className={`text-xs uppercase tracking-wider text-muted-foreground mb-1 leading-snug ${
              groupIdx === 0 ? '' : 'mt-4'
            }`}
          >
            {group.label}
          </div>

          <div>
            {group.items.map((event) => {
              const { Icon, iconBg, iconText, typeLabel } = getStyle(event);
              const extra = renderExtra ? renderExtra(event) : null;
              return (
                <div
                  key={event.id}
                  data-testid="event-timeline-item"
                  className="flex gap-3 px-1 py-2.5 rounded-lg hover:bg-muted/40 transition-colors"
                >
                  <div className={`shrink-0 mt-0.5 size-8 rounded-full flex items-center justify-center ${iconBg}`}>
                    <Icon className={`size-4 ${iconText}`} aria-hidden="true" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 text-xs text-muted-foreground mb-0.5">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="tabular-nums leading-snug">{relativeTimeLabel(event.timestamp, now.getTime())}</span>
                        {event.reliability === 'approximate' && (
                          <span
                            title="เวลาโดยประมาณ — ข้อมูลย้อนหลังระบุเวลาได้ไม่แน่นอน"
                            className="rounded-sm border border-border px-1 text-[10px] leading-snug text-muted-foreground"
                          >
                            ประมาณ
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider leading-snug shrink-0">{typeLabel}</span>
                    </div>

                    {event.href ? (
                      <Link
                        to={event.href}
                        className="block text-sm font-medium leading-snug truncate text-foreground hover:text-primary hover:underline"
                      >
                        {event.title}
                      </Link>
                    ) : (
                      <div className="text-sm font-medium leading-snug truncate">{event.title}</div>
                    )}

                    {event.subtitle && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate leading-snug">{event.subtitle}</div>
                    )}

                    {extra ? <div className="mt-1.5">{extra}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {footer}
    </div>
  );
}
```
Run: `TZ=UTC npx vitest run src/components/timeline` (จาก `apps/web`) → Expected: PASS 2 files · 10 tests

- [ ] **Step 4: เทสแดง — `TimelineFilterChips` รับชุดชิปจากผู้เรียก**

สร้าง `apps/web/src/pages/CollectionsPage/components/TimelineFilterChips.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TimelineFilterChips from './TimelineFilterChips';

describe('TimelineFilterChips', () => {
  it('ไม่ส่ง chips → ชุดติดตามหนี้เดิม 7 ชิปตามลำดับ', () => {
    render(<TimelineFilterChips value="ALL" onChange={() => {}} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'ทั้งหมด',
      'ชำระ',
      'แจ้งเตือน',
      'โทร',
      'หนังสือ',
      'เครื่อง',
      'สถานะ',
    ]);
    expect(screen.getByRole('button', { name: 'ทั้งหมด' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ส่ง chips → ใช้ชุดที่ส่ง พร้อมจำนวน ชิปที่เลือก และ onChange ส่ง value ของชิป', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TimelineFilterChips
        value="chat"
        onChange={onChange}
        counts={{ chat: 4 }}
        chips={[
          { value: 'ALL', label: 'ทั้งหมด' },
          { value: 'chat', label: 'แชท' },
          { value: 'sale', label: 'ขาย/สัญญา' },
        ]}
      />,
    );
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['ทั้งหมด', 'แชท4', 'ขาย/สัญญา']);
    expect(screen.getByRole('button', { name: /^แชท/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'ขาย/สัญญา' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'ขาย/สัญญา' }));
    expect(onChange).toHaveBeenCalledWith('sale');
  });
});
```
Run: `TZ=UTC npx vitest run src/pages/CollectionsPage/components/TimelineFilterChips.test.tsx` (จาก `apps/web`) → Expected: FAIL 2 tests · ข้อแรก `Expected the element to have attribute: aria-pressed="true" Received: null` · ข้อสอง `expected [ Array(7) ] to deeply equal [ 'ทั้งหมด', 'แชท4', 'ขาย/สัญญา' ]`

- [ ] **Step 5: `TimelineFilterChips` — prop `chips` + `aria-pressed`**

เขียนทับ `apps/web/src/pages/CollectionsPage/components/TimelineFilterChips.tsx` ทั้งไฟล์ (บรรทัด 1-56 เดิม):
```tsx
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TimelineEvent } from '../hooks/useCustomer360';

export type TimelineEventType = TimelineEvent['type'];
export type TimelineFilterValue = TimelineEventType | 'ALL';

export interface TimelineChip {
  value: string;
  label: string;
}

/** ชุดชิปของแผงติดตามหนี้ (Customer360) — ใช้เมื่อผู้เรียกไม่ส่ง chips */
const DEFAULT_CHIPS: { value: TimelineFilterValue; label: string }[] = [
  { value: 'ALL', label: 'ทั้งหมด' },
  { value: 'PAYMENT', label: 'ชำระ' },
  { value: 'DUNNING_ACTION', label: 'แจ้งเตือน' },
  { value: 'CALL', label: 'โทร' },
  { value: 'LETTER', label: 'หนังสือ' },
  { value: 'MDM', label: 'เครื่อง' },
  { value: 'STATUS_CHANGE', label: 'สถานะ' },
];

interface Props {
  value: string;
  onChange: (value: string) => void;
  counts?: Partial<Record<string, number>>;
  /** ชุดชิปของหน้าอื่น เช่น กลุ่มของแท็บการเดินทางลูกค้า — ไม่ส่ง = ชุดติดตามหนี้เดิม */
  chips?: TimelineChip[];
  className?: string;
}

export default function TimelineFilterChips({ value, onChange, counts, chips = DEFAULT_CHIPS, className }: Props) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {chips.map((chip) => {
        const count = counts?.[chip.value];
        const isActive = value === chip.value;
        return (
          <Button
            key={chip.value}
            type="button"
            variant={isActive ? 'primary' : 'ghost'}
            size="sm"
            className="h-7 px-2.5 text-xs"
            aria-pressed={isActive}
            onClick={() => onChange(chip.value)}
          >
            <span className="leading-snug">{chip.label}</span>
            {typeof count === 'number' && (
              <span
                className={cn(
                  'ml-1.5 tabular-nums text-[10px]',
                  isActive ? 'text-primary-foreground/80' : 'text-muted-foreground',
                )}
              >
                {count}
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
}
```
Run: `TZ=UTC npx vitest run src/pages/CollectionsPage/components/TimelineFilterChips.test.tsx src/pages/CollectionsPage/components/Customer360Timeline.test.tsx` (จาก `apps/web`) → Expected: PASS 2 files · 8 tests (ตอนนี้ยังไม่ต้องรัน `tsc` เพราะ `Customer360Timeline.tsx` เดิมยังส่ง `setFilterType` ที่เป็นชนิด `TimelineFilterValue` มา Step 6 จะแก้จุดนี้)

- [ ] **Step 6: `Customer360Timeline` ใช้ `EventTimeline` แทน (หน้าจอต้องเหมือนเดิม)**

เขียนทับ `apps/web/src/pages/CollectionsPage/components/Customer360Timeline.tsx` ทั้งไฟล์ (บรรทัด 1-281 เดิม · ย้าย `groupByDate`/`timeLabel` ไปไว้ที่ `eventTimelineUtils.ts` และ `EventCard` ไปไว้ที่ `EventTimeline.tsx` แล้ว · สีไอคอนตามผลการโทรกับตัวเล่นไฟล์เสียงยังอยู่ในไฟล์นี้):
```tsx
import { useMemo, useState } from 'react';
import { PhoneCall, Banknote, MessageCircle, Activity, Lock, FileText } from 'lucide-react';
import { EventTimeline } from '@/components/timeline/EventTimeline';
import type { EventStyle } from '@/components/timeline/eventTimelineStyles';
import { DateRangePicker, type DateRangeValue } from '@/components/ui/DateRangePicker';
import type { TimelineEvent } from '../hooks/useCustomer360';
import TimelineFilterChips from './TimelineFilterChips';
import VoiceMemoPlayback from './VoiceMemoPlayback';

// ─── icon/color config ───────────────────────────────────────────────────────

function getEventStyle(event: TimelineEvent): EventStyle {
  // CALL: override based on result metadata
  if (event.type === 'CALL') {
    const result = event.metadata?.result as string | undefined;
    if (result === 'PROMISED') {
      return { Icon: PhoneCall, iconBg: 'bg-success/10', iconText: 'text-success', typeLabel: 'โทร' };
    }
    if (result === 'REFUSED') {
      return { Icon: PhoneCall, iconBg: 'bg-destructive/10', iconText: 'text-destructive', typeLabel: 'โทร' };
    }
    return { Icon: PhoneCall, iconBg: 'bg-primary/10', iconText: 'text-primary', typeLabel: 'โทร' };
  }

  switch (event.type) {
    case 'PAYMENT':
      return { Icon: Banknote, iconBg: 'bg-success/10', iconText: 'text-success', typeLabel: 'ชำระ' };
    case 'DUNNING_ACTION':
      return { Icon: MessageCircle, iconBg: 'bg-primary/10', iconText: 'text-primary', typeLabel: 'แจ้งเตือน' };
    case 'STATUS_CHANGE':
      return { Icon: Activity, iconBg: 'bg-muted', iconText: 'text-muted-foreground', typeLabel: 'สถานะ' };
    case 'MDM':
      return { Icon: Lock, iconBg: 'bg-destructive/10', iconText: 'text-destructive', typeLabel: 'เครื่อง' };
    case 'LETTER':
      return { Icon: FileText, iconBg: 'bg-warning/10', iconText: 'text-warning', typeLabel: 'หนังสือ' };
    default:
      return { Icon: Activity, iconBg: 'bg-muted', iconText: 'text-muted-foreground', typeLabel: event.type };
  }
}

// P2 Task 4 — voice memo playback inline (CALL events only)
function renderVoiceMemo(event: TimelineEvent) {
  if (event.type !== 'CALL') return null;
  const voiceMemoUrl = event.metadata?.voiceMemoUrl as string | undefined;
  if (!voiceMemoUrl) return null;
  return (
    <VoiceMemoPlayback
      voiceMemoUrl={voiceMemoUrl}
      tier={event.metadata?.voiceMemoTier as string | undefined}
      callLogId={event.metadata?.callLogId as string | undefined}
    />
  );
}

// ─── main component ──────────────────────────────────────────────────────────

interface Props {
  events: TimelineEvent[];
}

export default function Customer360Timeline({ events }: Props) {
  const [filterType, setFilterType] = useState<string>('ALL');
  const [dateRange, setDateRange] = useState<DateRangeValue>({ from: null, to: null });

  // Counts per type — computed from full event set so chips show stable totals
  const counts = useMemo(() => {
    const c: Partial<Record<string, number>> = { ALL: events.length };
    for (const e of events) {
      c[e.type] = (c[e.type] ?? 0) + 1;
    }
    return c;
  }, [events]);

  // Apply in-memory filter (timeline capped at 100 events backend-side)
  const filteredEvents = useMemo(() => {
    const fromMs = dateRange.from ? dateRange.from.getTime() : null;
    const toMs = dateRange.to ? dateRange.to.getTime() : null;
    return events.filter((e) => {
      if (filterType !== 'ALL' && e.type !== filterType) return false;
      if (fromMs !== null || toMs !== null) {
        const t = new Date(e.timestamp).getTime();
        if (fromMs !== null && t < fromMs) return false;
        if (toMs !== null && t > toMs) return false;
      }
      return true;
    });
  }, [events, filterType, dateRange]);

  const hasDateFilter = dateRange.from !== null || dateRange.to !== null;
  const hasAnyFilter = filterType !== 'ALL' || hasDateFilter;

  return (
    <div className="space-y-3">
      {/* Filter controls */}
      <div className="space-y-2">
        <TimelineFilterChips value={filterType} onChange={setFilterType} counts={counts} />
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      <EventTimeline
        events={filteredEvents}
        getStyle={getEventStyle}
        renderExtra={renderVoiceMemo}
        emptyText={events.length === 0 ? 'ยังไม่มีกิจกรรม' : 'ไม่พบกิจกรรมตามตัวกรอง'}
        footer={
          // Cap notice — only when not filtering (full result hits cap)
          !hasAnyFilter && events.length >= 100 ? (
            <div className="pt-3 text-center text-xs text-muted-foreground leading-snug">แสดง 100 รายการล่าสุด</div>
          ) : null
        }
      />
    </div>
  );
}
```
Run (จาก `apps/web`):
- `TZ=UTC npx vitest run src/components/timeline src/pages/CollectionsPage/components/TimelineFilterChips.test.tsx src/pages/CollectionsPage/components/Customer360Timeline.test.tsx` → Expected: PASS 4 files · 18 tests (เทสล็อกของ Step 1 ต้องผ่านครบ 6 เทสโดยไม่ได้แก้)
- `TZ=UTC npx vitest run src/pages/CollectionsPage src/components/timeline` → Expected: `Test Files` ผ่านทั้งหมด `failed` = 0 · จำนวนไฟล์ = ฐานที่นับก่อนเริ่ม (10) + 4 ไฟล์ใหม่
- `npx tsc --noEmit` → Expected: 0 error
- `npx eslint src/components/timeline/EventTimeline.tsx src/components/timeline/eventTimelineStyles.ts src/components/timeline/eventTimelineUtils.ts src/components/timeline/__tests__/EventTimeline.test.tsx src/components/timeline/__tests__/eventTimelineUtils.test.ts src/pages/CollectionsPage/components/TimelineFilterChips.tsx src/pages/CollectionsPage/components/TimelineFilterChips.test.tsx src/pages/CollectionsPage/components/Customer360Timeline.tsx src/pages/CollectionsPage/components/Customer360Timeline.test.tsx` → Expected: ไม่มี error/warning
- ตรวจด้วยตา: `grep -nE "#[0-9a-fA-F]{3,6}\b|text-gray-|bg-white|leading-none" src/components/timeline/*.tsx src/components/timeline/*.ts src/pages/CollectionsPage/components/Customer360Timeline.tsx src/pages/CollectionsPage/components/TimelineFilterChips.tsx` → Expected: ไม่มีผลลัพธ์

- [ ] **Step 7: Commit** (จาก root ของ worktree)
```bash
git add apps/web/src/components/timeline/EventTimeline.tsx apps/web/src/components/timeline/eventTimelineStyles.ts apps/web/src/components/timeline/eventTimelineUtils.ts apps/web/src/components/timeline/__tests__/EventTimeline.test.tsx apps/web/src/components/timeline/__tests__/eventTimelineUtils.test.ts apps/web/src/pages/CollectionsPage/components/TimelineFilterChips.tsx apps/web/src/pages/CollectionsPage/components/TimelineFilterChips.test.tsx apps/web/src/pages/CollectionsPage/components/Customer360Timeline.tsx apps/web/src/pages/CollectionsPage/components/Customer360Timeline.test.tsx
git commit -m "refactor(web): แยกไทม์ไลน์กลาง EventTimeline (จัดกลุ่มตามวัน · ไอคอนตามกลุ่มการเดินทาง · ป้ายประมาณ · ลิงก์) และให้ชิปกรองรับชุดชิปจากผู้เรียก

ไทม์ไลน์ของแผงลูกค้า 360 หน้าติดตามหนี้ย้ายมาใช้ของกลาง หน้าจอเหมือนเดิม มีเทสล็อกพฤติกรรมเดิมกำกับ

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: เว็บ — แท็บการเดินทาง · แถบขั้น · การ์ดกิจกรรมล่าสุด · พาลิงก์เก่าไปหน้าลูกค้าจริง

> งานนี้ต่อจาก Plan 1 Task 3–6 · ไฟล์ของ Plan 1 (`pages/CustomerDetailPage/index.tsx`, `tabs/OverviewTab.tsx`, `__tests__/CustomerDetailPage.test.tsx`) อ้างด้วย **ข้อความที่ใช้หาจุดแก้** (ตรวจแล้วว่ามีจริงใน worktree ณ วันเขียนแผน) ไม่อ้างเลขบรรทัด เพราะ Plan 1 ยังแก้ไฟล์เหล่านั้นอยู่
> ไทม์ไลน์ ชิป ป้ายกลุ่ม และไอคอน มาจาก Task 11 ที่เดียว (`EventTimeline` · `TimelineFilterChips` · `GROUP_EVENT_STYLES`) · ชนิดคำตอบ API มาจาก `@installment/shared` ของ Task 1 ที่เดียว (`JourneyListResponse` · `JourneyRedirect` · `JourneySummary`) — ห้ามประกาศซ้ำในเว็บ
> PDPA: เว็บส่งเข้าไทม์ไลน์เฉพาะ `id/type/group/timestamp/title/subtitle/reliability/href` ของ `JourneyEvent` · ไม่อ่าน `metadata` · ไม่แสดงข้อความแชท โน้ตการโทร เบอร์ เลขบัตร หรือที่อยู่ (API ตัดมาแล้ว เว็บห้ามขยายต่อ)

**Files:**
- Create: `apps/web/src/pages/CustomerDetailPage/utils/journeyGroups.ts`
- Create: `apps/web/src/pages/CustomerDetailPage/__tests__/journeyGroups.test.ts`
- Create: `apps/web/src/pages/CustomerDetailPage/hooks/useCustomerJourney.ts`
- Create: `apps/web/src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts`
- Create: `apps/web/src/pages/CustomerDetailPage/components/JourneyStageStrip.tsx`
- Create: `apps/web/src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx`
- Create: `apps/web/src/pages/CustomerDetailPage/components/RecentActivityCard.tsx`
- Create: `apps/web/src/pages/CustomerDetailPage/tabs/JourneyTab.tsx`
- Modify: `apps/web/src/pages/CustomerDetailPage/tabs/OverviewTab.tsx` (ลูกตัวสุดท้ายของ `<div className="flex flex-col gap-5">` ถัดจากบล็อก `{kind !== 'PROSPECT' && customer.openContracts.length === 0 && sales.length === 0 && (` … `ยังไม่มีสัญญาหรือใบขาย`)
- Modify: `apps/web/src/pages/CustomerDetailPage/index.tsx` (4 จุด: ถัดจาก `const { user } = useAuth();` · ถัดจาก `<KpiTiles tiles={kpiTiles(customer, loyaltyPoints?.balance ?? null)} />` · ถัดจาก `</TabsTrigger>` ของ `value="loyalty"` ก่อน `</TabsList>` · ถัดจาก `</TabsContent>` ของ `value="loyalty"` ก่อน `</Tabs>`)
- Modify: `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx` (import · `vi.hoisted` · `beforeEach` ระดับไฟล์ · ค่าที่คาดของเทส `ลำดับแท็บ + แท็บที่ไม่มีข้อมูลโชว์จางแต่ยังกดได้` · describe ใหม่ท้ายไฟล์)
- อ่านอย่างเดียว (ยืนยันแล้ว): `apps/web/src/components/QueryBoundary.tsx:5-14,33` (default export · props `isLoading/isError/error/onRetry/errorTitle`) · `apps/web/src/components/ui/collapsible.tsx:34` · `apps/web/src/components/ui/card.tsx:123-131` (`CardTitle` = `h3`) · `apps/web/src/components/ui/badge.tsx:28,31,44` (variant `warning`/`destructive` · size `md` · appearance `light`) · `apps/web/src/utils/formatters.ts:104,142` (`formatDateShort`, `formatDateTime`) · `apps/api/src/modules/customers/services/customer-query.service.ts:796` (`findOne` โยน 404 เมื่อ `deletedAt` ไม่ว่าง ⇒ redirect ต้องเกิดก่อน early return ของหน้า) · `apps/web/src/config/menu.ts:1204-1208` (`CHAT_VISIBLE_ROLES` = OWNER/BRANCH_MANAGER/FINANCE_MANAGER/SALES ตรงกับ `JOURNEY_CHAT_ROLES` ของ Task 8 — กฎกลุ่มที่บทบาทไม่เห็นใช้ `JOURNEY_HIDDEN_GROUPS` จาก shared ชุดเดียวกับ API)

**Interfaces:**
- Consumes:
  - Task 1 — `@installment/shared`: `JOURNEY_DEFAULT_GROUPS: readonly JourneyEventGroup[]` · `JOURNEY_HIDDEN_GROUPS: Readonly<Record<string, readonly JourneyEventGroup[]>>` · `JOURNEY_LOST_REASON_LABELS: Readonly<Record<string, string>>` (กฎกลุ่มและป้ายชุดเดียวกับ API — ห้ามลอกมาประกาศในเว็บ) · `JOURNEY_STAGES` · `type JourneyStage` · `STAGE_LABELS: Record<JourneyStage, string>` · `JOURNEY_EVENT_GROUPS` · `type JourneyEventGroup` · `interface JourneyEvent { id; type; group; stage: JourneyStage | null; timestamp; title; subtitle?; actor: { type: JourneyActorType; id?; name? } | null; reliability: 'exact' | 'approximate'; origin; href?; metadata? }` · `interface JourneyStep { stage; label; at: string | null; state: JourneyStepState; evidence: 'SYSTEM' | 'MANUAL' }` · `interface JourneySummary { stage; stageLabel; stageEnteredAt; daysInStage; path: JourneyPath; steps: JourneyStep[]; firstChannel; firstSource; firstSourceLabel; firstAd: { id; name } | null; heardFrom; contactedAt; firstStaffReplyAt; firstPurchaseAt; lastCustomerAt; lastTouchAt; silentDays: number | null; lost: { at; reason } | null; postSaleBadges: string[]; creditRejected: boolean }` · `interface JourneyListResponse { customerId; mergedCustomerIds: string[]; summary?; events: JourneyEvent[]; nextCursor: string | null; counts?: Partial<Record<JourneyEventGroup, number>>; notRecorded: string[] }` · `interface JourneyRedirect { redirectToCustomerId: string }`
  - Task 8 — `GET /customers/:id/journey` roles `OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT, SALES` · query `limit` (1-100, ค่าตั้งต้น 30) · `cursor` · `groups` (csv) · ไม่ส่ง `groups` = `JOURNEY_DEFAULT_GROUPS` · ตัด `JOURNEY_HIDDEN_GROUPS[role]` (ทั้งคู่จาก shared ของ Task 1) · `href` มีเฉพาะ `/inbox/:roomId` `/contracts/:id` `/insurance/:id` · ผู้สนใจที่ถูกรวมแล้ว → `JourneyRedirect`
  - Task 9 — query `include` (csv `summary`,`counts`) · หน้าแรก (ไม่มี cursor) ที่ส่ง `include=counts` มี `counts` ของทุกกลุ่มที่บทบาทเห็น (ไม่เกิน 100 ต่อกลุ่ม) · ไม่ส่ง = ไม่มี `counts` และไม่จ่ายค่าสแกน · หน้าที่มี cursor ไม่มี `counts` เสมอ · `GET /customers/:id/journey/summary` → `JourneySummary | JourneyRedirect` · ลบด้วยเหตุอื่น → 404 · ขั้นซื้อแล้วตรวจสดกับ `BOUGHT_WHERE` ทุกคำขอ · (`include=summary` มีให้แต่งานนี้ไม่ใช้ — แถบขั้นต้องแสดงทุกแท็บ จึงดึง `/summary` แยก)
  - Task 11 — `export function EventTimeline<T extends EventTimelineItem>(props: { events: T[]; getStyle?: (event: T) => EventStyle; renderExtra?: (event: T) => ReactNode; emptyText?: string; footer?: ReactNode })` (named export · ป้าย "ประมาณ" จาก `reliability` · หัวข้อเป็น `Link` เมื่อมี `href` · footer แสดงเมื่อมีรายการ) · `interface EventTimelineItem { id; type; group?; timestamp; title; subtitle?; reliability?; href?; metadata? }` · `GROUP_EVENT_STYLES: Readonly<Record<JourneyEventGroup, EventStyle>>` · `defaultEventStyle(event: { type: string; group?: string }): EventStyle` · `TimelineFilterChips` (default export) props `{ value: string; onChange: (value: string) => void; counts?: Partial<Record<string, number>>; chips?: TimelineChip[]; className?: string }` แต่ละชิปเป็น `<Button aria-pressed>` ชื่อ = label (+ตัวเลขเมื่อมี counts) · `interface TimelineChip { value: string; label: string }`
  - Plan 1 (worktree): `OverviewTab({ customer, role, onOpenTab })` · `index.tsx`: `id` จาก `useParams`, `const { user } = useAuth();`, `handleTabChange`, early return `if (customerError)` / `if (isLoading || !customer)`, `<KpiTiles …/>`, TabsTrigger `loyalty` ตัวสุดท้าย · harness: `mocks` (`get`, `role`, `detail`), `RESPONSES`, `renderAt(path)`, `<output aria-label="current location">`, `detail()` + `emptyPurchase` จาก `./fixtures`, import `fireEvent, render, screen, waitFor, within`
- Produces:
  - `utils/journeyGroups.ts`: `JOURNEY_VIEW_ROLES: ReadonlySet<string>` · `canViewJourney(role: string): boolean` · `DEFAULT_EXCLUDED_GROUPS: ReadonlySet<JourneyEventGroup>` (คำนวณจาก `JOURNEY_DEFAULT_GROUPS` ของ shared) · `OVERVIEW_GROUPS: readonly JourneyEventGroup[]` · `OVERVIEW_LIMIT = 6` · `SILENT_AFTER_DAYS = 30` · `journeyGroupsForRole(role: string): JourneyEventGroup[]` · `journeyGroupLabel(group: JourneyEventGroup): string` · `allChipNote(role: string): string | null` · `journeyActorLabel(actor: JourneyEvent['actor']): string | null` · `journeyEventSubtitle(event: Pick<JourneyEvent, 'subtitle' | 'actor'>): string`
  - `hooks/useCustomerJourney.ts`: `type CustomerJourneyResult = JourneyListResponse | JourneyRedirect` · `type JourneySummaryResult = JourneySummary | JourneyRedirect` · `JOURNEY_PAGE_SIZE = 30` · `isJourneyRedirect(value: CustomerJourneyResult | JourneySummaryResult | null | undefined): value is JourneyRedirect` · `useCustomerJourney(customerId: string, groups: readonly JourneyEventGroup[] | null, options?: { limit?: number; enabled?: boolean; include?: string })` (`useInfiniteQuery` key `['customer-journey', customerId, groups]` · `include` ส่งเฉพาะหน้าแรก — แท็บส่ง `'counts'` การ์ดไม่ส่ง) · `useJourneySummary(customerId: string, enabled?: boolean)` (key `['customer-journey-summary', customerId]`) · `useJourneySummaryRedirect(customerId: string, enabled: boolean): JourneySummary | null`
  - `__tests__/journeyFixtures.ts`: `stageSteps(states, at?, manual?): JourneyStep[]` · `journeySummary(over?): JourneySummary` · `journeyEvent(over?): JourneyEvent` · `journeyPage(over?): JourneyListResponse`
  - `JourneyStageStrip({ summary }: { summary: JourneySummary })` — `<section aria-label="ขั้นการเดินทางของลูกค้า">` · `<li data-stage data-state aria-current="step"(ขั้นปัจจุบัน)>`
  - `RecentActivityCard({ customerId, role, onOpenJourney }: { customerId: string; role: string; onOpenJourney: () => void })` — การ์ด "กิจกรรมล่าสุด" 6 รายการ กลุ่ม chat/credit/sale
  - `JourneyTab({ customerId, role }: { customerId: string; role: string })` — ขอ `include: 'counts'` ให้ตัวเลขบนชิป
  - ค่า tab ใหม่ใน URL: `?tab=journey` (แท็บสุดท้าย ป้าย `การเดินทาง` เฉพาะ `canViewJourney(role)`)

- [ ] **Step 1: เทสแดง — กลุ่มเหตุการณ์ตามบทบาท + บรรทัดรอง + ป้าย**

สร้าง `apps/web/src/pages/CustomerDetailPage/__tests__/journeyGroups.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { JOURNEY_EVENT_GROUPS } from '@installment/shared';
import { GROUP_EVENT_STYLES } from '@/components/timeline/eventTimelineStyles';
import {
  allChipNote,
  canViewJourney,
  DEFAULT_EXCLUDED_GROUPS,
  journeyActorLabel,
  journeyEventSubtitle,
  journeyGroupLabel,
  journeyGroupsForRole,
} from '../utils/journeyGroups';

describe('journeyGroupsForRole — ตาม JOURNEY_HIDDEN_GROUPS ของ shared (ชุดเดียวกับ API)', () => {
  it('OWNER / BRANCH_MANAGER / FINANCE_MANAGER เห็นครบทุกกลุ่มตามลำดับกลาง', () => {
    expect(journeyGroupsForRole('OWNER')).toEqual([...JOURNEY_EVENT_GROUPS]);
    expect(journeyGroupsForRole('BRANCH_MANAGER')).toEqual([...JOURNEY_EVENT_GROUPS]);
    expect(journeyGroupsForRole('FINANCE_MANAGER')).toEqual([...JOURNEY_EVENT_GROUPS]);
  });

  it('SALES ไม่เห็นชำระเงินและติดตามหนี้ (สมมติฐานเจ้าของข้อ b)', () => {
    expect(journeyGroupsForRole('SALES')).toEqual(['chat', 'credit', 'sale', 'service', 'points', 'system']);
  });

  it('ACCOUNTANT ไม่เห็นแชท · บทบาทที่ API ไม่อนุญาตไม่ได้กลุ่มใดเลย', () => {
    expect(journeyGroupsForRole('ACCOUNTANT')).toEqual(['credit', 'sale', 'payment', 'collections', 'service', 'points', 'system']);
    expect(journeyGroupsForRole('VIEWER')).toEqual([]);
    expect(canViewJourney('VIEWER')).toBe(false);
    expect(canViewJourney('ACCOUNTANT')).toBe(true);
  });
});

describe('allChipNote', () => {
  it('บอกกลุ่มที่ชิป "ทั้งหมด" ไม่รวม (กลุ่มนอก JOURNEY_DEFAULT_GROUPS) เฉพาะกลุ่มที่บทบาทนั้นเห็น', () => {
    expect([...DEFAULT_EXCLUDED_GROUPS]).toEqual(['payment', 'points', 'system']);
    expect(allChipNote('OWNER')).toBe('ทั้งหมด ไม่รวม ชำระเงิน · แต้ม · ระบบ — กดชิปของกลุ่มนั้นเพื่อดู');
    expect(allChipNote('SALES')).toBe('ทั้งหมด ไม่รวม แต้ม · ระบบ — กดชิปของกลุ่มนั้นเพื่อดู');
    expect(allChipNote('VIEWER')).toBeNull();
  });
});

describe('journeyEventSubtitle', () => {
  it('ต่อรายละเอียดกับผู้ทำ', () => {
    expect(journeyEventSubtitle({ subtitle: 'CT-2569-0042', actor: { type: 'STAFF', name: 'แนน' } })).toBe('CT-2569-0042 · แนน');
  });

  it('ผู้ทำไม่มีชื่อ → ป้ายตามประเภท · ไม่มีทั้งรายละเอียดและผู้ทำ → ว่าง', () => {
    expect(journeyActorLabel({ type: 'STAFF' })).toBe('ร้าน (ไม่ทราบชื่อ)');
    expect(journeyActorLabel({ type: 'BOT' })).toBe('บอท');
    expect(journeyActorLabel(null)).toBeNull();
    expect(journeyEventSubtitle({ actor: null })).toBe('');
  });
});

describe('journeyGroupLabel', () => {
  it('ป้ายมาจาก GROUP_EVENT_STYLES ของไทม์ไลน์กลาง (Task 11) ทุกกลุ่ม ห้ามหลุดค่าดิบ', () => {
    for (const group of JOURNEY_EVENT_GROUPS) {
      expect(journeyGroupLabel(group)).toBe(GROUP_EVENT_STYLES[group].typeLabel);
      expect(journeyGroupLabel(group)).not.toBe(group);
    }
    expect(journeyGroupLabel('chat')).toBe('แชท/ติดต่อ');
  });
});
```
Run (จาก `apps/web`): `TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/journeyGroups.test.ts` → Expected: FAIL `Failed to resolve import "../utils/journeyGroups"`

- [ ] **Step 2: `utils/journeyGroups.ts`**

```ts
import {
  JOURNEY_DEFAULT_GROUPS,
  JOURNEY_EVENT_GROUPS,
  JOURNEY_HIDDEN_GROUPS,
  type JourneyEvent,
  type JourneyEventGroup,
} from '@installment/shared';
import { GROUP_EVENT_STYLES } from '@/components/timeline/eventTimelineStyles';

/** ตรง roles ของ GET /customers/:id/journey และ /summary — บทบาทอื่นไม่เห็นแท็บ แถบขั้น และการ์ด (และไม่ยิง API) */
export const JOURNEY_VIEW_ROLES: ReadonlySet<string> = new Set([
  'OWNER',
  'BRANCH_MANAGER',
  'FINANCE_MANAGER',
  'ACCOUNTANT',
  'SALES',
]);

export function canViewJourney(role: string): boolean {
  return JOURNEY_VIEW_ROLES.has(role);
}

/**
 * กลุ่มนอก JOURNEY_DEFAULT_GROUPS — ชิป "ทั้งหมด" ไม่ส่ง groups จึงไม่ได้กลุ่มเหล่านี้
 * กฎกลุ่ม (JOURNEY_DEFAULT_GROUPS / JOURNEY_HIDDEN_GROUPS) มาจาก shared ชุดเดียวกับ API — API ตัดข้อมูลจริง เว็บซ่อนชิปให้ตรง
 */
export const DEFAULT_EXCLUDED_GROUPS: ReadonlySet<JourneyEventGroup> = new Set<JourneyEventGroup>(
  JOURNEY_EVENT_GROUPS.filter((group) => !JOURNEY_DEFAULT_GROUPS.includes(group)),
);

/** การ์ด "กิจกรรมล่าสุด" บนแท็บภาพรวม — ค่าคงที่ระดับไฟล์ queryKey จึงไม่เปลี่ยนทุก render */
export const OVERVIEW_GROUPS: readonly JourneyEventGroup[] = ['chat', 'credit', 'sale'];
export const OVERVIEW_LIMIT = 6;

/** "เงียบ" = ยังไม่ซื้อ และไม่มีการติดต่อเกิน 30 วัน (API คำนวณ silentDays แล้ว เว็บแค่ตัดสินว่าจะติดป้าย) */
export const SILENT_AFTER_DAYS = 30;

export function journeyGroupsForRole(role: string): JourneyEventGroup[] {
  if (!canViewJourney(role)) return [];
  const hidden = JOURNEY_HIDDEN_GROUPS[role] ?? [];
  return JOURNEY_EVENT_GROUPS.filter((group) => !hidden.includes(group));
}

/** ป้ายกลุ่มชุดเดียวกับไทม์ไลน์กลาง — แก้ป้ายที่ eventTimelineStyles.ts ที่เดียว */
export function journeyGroupLabel(group: JourneyEventGroup): string {
  return GROUP_EVENT_STYLES[group].typeLabel;
}

export function allChipNote(role: string): string | null {
  const excluded = journeyGroupsForRole(role).filter((group) => DEFAULT_EXCLUDED_GROUPS.has(group));
  if (excluded.length === 0) return null;
  return `ทั้งหมด ไม่รวม ${excluded.map(journeyGroupLabel).join(' · ')} — กดชิปของกลุ่มนั้นเพื่อดู`;
}

const ACTOR_FALLBACK: Readonly<Record<string, string>> = {
  STAFF: 'ร้าน (ไม่ทราบชื่อ)',
  CUSTOMER: 'ลูกค้า',
  BOT: 'บอท',
  SYSTEM: 'ระบบ',
};

export function journeyActorLabel(actor: JourneyEvent['actor']): string | null {
  if (!actor) return null;
  return actor.name || ACTOR_FALLBACK[actor.type] || null;
}

/** บรรทัดรอง: รายละเอียดจาก API · ผู้ทำ — ไม่อ่าน metadata (PDPA) · ป้ายเวลาโดยประมาณแสดงแยกจาก reliability */
export function journeyEventSubtitle(event: Pick<JourneyEvent, 'subtitle' | 'actor'>): string {
  return [event.subtitle, journeyActorLabel(event.actor)].filter(Boolean).join(' · ');
}
```
Run เทส Step 1 → Expected: PASS 7 tests

- [ ] **Step 3: hook + fixture ของการเดินทาง**

สร้าง `apps/web/src/pages/CustomerDetailPage/hooks/useCustomerJourney.ts`:
```ts
import { useEffect } from 'react';
import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { JourneyEventGroup, JourneyListResponse, JourneyRedirect, JourneySummary } from '@installment/shared';
import api from '@/lib/api';

/** GET /customers/:id/journey — ชนิดจาก shared (Task 1) ห้ามประกาศซ้ำ */
export type CustomerJourneyResult = JourneyListResponse | JourneyRedirect;
/** GET /customers/:id/journey/summary */
export type JourneySummaryResult = JourneySummary | JourneyRedirect;

export const JOURNEY_PAGE_SIZE = 30;

export function isJourneyRedirect(
  value: CustomerJourneyResult | JourneySummaryResult | null | undefined,
): value is JourneyRedirect {
  return !!value && 'redirectToCustomerId' in value;
}

export function useCustomerJourney(
  customerId: string,
  groups: readonly JourneyEventGroup[] | null,
  options: { limit?: number; enabled?: boolean; include?: string } = {},
) {
  const limit = options.limit ?? JOURNEY_PAGE_SIZE;
  return useInfiniteQuery<
    CustomerJourneyResult,
    Error,
    InfiniteData<CustomerJourneyResult>,
    readonly unknown[],
    string | undefined
  >({
    // key ตามสัญญากลาง — limit / include ไม่อยู่ใน key ได้เพราะแท็บส่ง groups = null หรือกลุ่มเดียว (+ include=counts)
    // ส่วนการ์ดภาพรวมส่ง 3 กลุ่ม (OVERVIEW_GROUPS) และไม่ส่ง include จึงไม่มีทางชนกัน
    queryKey: ['customer-journey', customerId, groups],
    initialPageParam: undefined,
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string | number> = { limit };
      if (groups && groups.length > 0) params.groups = groups.join(',');
      if (pageParam) params.cursor = pageParam;
      // include มีผลเฉพาะหน้าแรกฝั่ง API — หน้าที่มี cursor ไม่ส่ง
      else if (options.include) params.include = options.include;
      const { data } = await api.get<CustomerJourneyResult>(`/customers/${customerId}/journey`, { params });
      return data;
    },
    getNextPageParam: (last) => (isJourneyRedirect(last) ? undefined : last.nextCursor ?? undefined),
    enabled: (options.enabled ?? true) && !!customerId,
    staleTime: 30_000,
  });
}

export function useJourneySummary(customerId: string, enabled = true) {
  return useQuery<JourneySummaryResult>({
    queryKey: ['customer-journey-summary', customerId],
    queryFn: async () => {
      const { data } = await api.get<JourneySummaryResult>(`/customers/${customerId}/journey/summary`);
      return data;
    },
    enabled: enabled && !!customerId,
    staleTime: 60_000,
  });
}

/**
 * ลิงก์เก่าที่ชี้ id ของผู้สนใจที่ถูกรวมแล้ว → summary ตอบ { redirectToCustomerId } → ไปหน้าลูกค้าจริงแบบ replace
 * ต้องเรียกก่อน early return ของหน้า: GET /customers/:id ของ id ที่ถูกลบตอบ 404 (findOne เช็ค deletedAt)
 * คืน JourneySummary เมื่อพร้อมใช้ ไม่งั้น null (กำลังโหลด / redirect / error / 404 / บทบาทไม่มีสิทธิ์)
 */
export function useJourneySummaryRedirect(customerId: string, enabled: boolean): JourneySummary | null {
  const navigate = useNavigate();
  const { data } = useJourneySummary(customerId, enabled);
  const redirectTo = isJourneyRedirect(data) ? data.redirectToCustomerId : null;

  useEffect(() => {
    if (redirectTo) navigate(`/customers/${redirectTo}`, { replace: true });
  }, [redirectTo, navigate]);

  if (!data || isJourneyRedirect(data)) return null;
  return data;
}
```

สร้าง `apps/web/src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts`:
```ts
import {
  JOURNEY_STAGES,
  STAGE_LABELS,
  type JourneyEvent,
  type JourneyListResponse,
  type JourneyStage,
  type JourneyStep,
  type JourneySummary,
} from '@installment/shared';

export function stageSteps(
  states: Record<JourneyStage, JourneyStep['state']>,
  at: Partial<Record<JourneyStage, string>> = {},
  manual: readonly JourneyStage[] = [],
): JourneyStep[] {
  return JOURNEY_STAGES.map(
    (stage): JourneyStep => ({
      stage,
      label: STAGE_LABELS[stage],
      at: states[stage] === 'todo' || states[stage] === 'skipped' ? null : at[stage] ?? null,
      state: states[stage],
      evidence: manual.includes(stage) ? 'MANUAL' : 'SYSTEM',
    }),
  );
}

export function journeySummary(over: Partial<JourneySummary> = {}): JourneySummary {
  return {
    stage: 'CONTACTED',
    stageLabel: STAGE_LABELS.CONTACTED,
    stageEnteredAt: '2026-09-01T03:00:00.000Z',
    daysInStage: 14,
    path: 'UNKNOWN',
    steps: stageSteps(
      { CONTACTED: 'current', IDENTIFIED: 'todo', INTERESTED: 'todo', CREDIT: 'todo', PURCHASED: 'todo' },
      { CONTACTED: '2026-09-01T03:00:00.000Z' },
    ),
    firstChannel: 'CHAT_FACEBOOK',
    firstSource: 'CHAT_FACEBOOK',
    firstSourceLabel: 'แชท Facebook',
    firstAd: null,
    heardFrom: null,
    contactedAt: '2026-09-01T03:00:00.000Z',
    firstStaffReplyAt: null,
    firstPurchaseAt: null,
    lastCustomerAt: '2026-09-01T03:00:00.000Z',
    lastTouchAt: null,
    silentDays: null,
    lost: null,
    postSaleBadges: [],
    creditRejected: false,
    ...over,
  };
}

export function journeyEvent(over: Partial<JourneyEvent> = {}): JourneyEvent {
  return {
    id: 'chat_room-r1',
    type: 'CHAT_ROOM_OPENED',
    group: 'chat',
    stage: 'CONTACTED',
    timestamp: '2026-09-01T03:00:00.000Z',
    title: 'ทักแชทครั้งแรกทาง Facebook',
    actor: { type: 'CUSTOMER' },
    reliability: 'exact',
    origin: 'SOURCE',
    ...over,
  };
}

export function journeyPage(over: Partial<JourneyListResponse> = {}): JourneyListResponse {
  return { customerId: 'c1', mergedCustomerIds: [], events: [], nextCursor: null, notRecorded: [], ...over };
}
```
Run: `npx tsc --noEmit` (จาก `apps/web`) → Expected: 0 error (ถ้า fixture ฟ้องว่าฟิลด์ไม่ตรง `JourneySummary`/`JourneyEvent` ของ `packages/shared/src/customer-journey.ts` ให้แก้ fixture ตาม type ใน shared — ห้ามใช้ `as`)

- [ ] **Step 4: เทสแดง — แถบขั้น**

สร้าง `apps/web/src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx`:
```tsx
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STAGE_LABELS, type JourneyStage } from '@installment/shared';
import { formatDateShort } from '@/utils/formatters';
import JourneyStageStrip from '../components/JourneyStageStrip';
import { journeySummary, stageSteps } from './journeyFixtures';

// วันที่คำนวณด้วย formatter ตัวเดียวกับหน้าจอเสมอ — CI รันเป็น UTC
const AT = {
  CONTACTED: '2026-08-01T03:00:00.000Z',
  IDENTIFIED: '2026-08-02T03:00:00.000Z',
  INTERESTED: '2026-08-20T03:00:00.000Z',
  CREDIT: '2026-09-01T03:00:00.000Z',
  PURCHASED: '2026-09-05T03:00:00.000Z',
};

function stepItem(stage: JourneyStage) {
  const strip = screen.getByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' });
  return within(strip).getByText(STAGE_LABELS[stage]).closest('li');
}

describe('JourneyStageStrip', () => {
  it('ซื้อเงินสดโดยไม่ตรวจเครดิต: ขั้นตรวจเครดิตเป็น "ข้าม (เงินสด)" · ซื้อแล้วเป็นขั้นปัจจุบันไม่นับวันค้าง', () => {
    render(
      <JourneyStageStrip
        summary={journeySummary({
          stage: 'PURCHASED',
          path: 'CASH',
          daysInStage: 10,
          steps: stageSteps({ CONTACTED: 'done', IDENTIFIED: 'done', INTERESTED: 'done', CREDIT: 'skipped', PURCHASED: 'current' }, AT),
        })}
      />,
    );
    expect(stepItem('CONTACTED')).toHaveAttribute('data-state', 'done');
    expect(stepItem('CONTACTED')).toHaveTextContent(formatDateShort(AT.CONTACTED));
    expect(stepItem('CREDIT')).toHaveAttribute('data-state', 'skipped');
    expect(stepItem('CREDIT')).toHaveTextContent('ข้าม (เงินสด)');
    expect(stepItem('PURCHASED')).toHaveAttribute('aria-current', 'step');
    expect(stepItem('PURCHASED')).not.toHaveTextContent('อยู่ขั้นนี้');
    expect(screen.queryByText(/^หลุด/)).toBeNull();
    expect(screen.queryByText(/^เงียบ/)).toBeNull();
  });

  it('ผู้สนใจที่พนักงานบันทึกนัด: ขั้นปัจจุบันบอกวันค้าง + "พนักงานบันทึก" · ป้ายหลุดและเงียบ', () => {
    render(
      <JourneyStageStrip
        summary={journeySummary({
          stage: 'INTERESTED',
          daysInStage: 12,
          silentDays: 45,
          lost: { at: '2026-09-10T03:00:00.000Z', reason: 'BOUGHT_ELSEWHERE' },
          steps: stageSteps(
            { CONTACTED: 'done', IDENTIFIED: 'done', INTERESTED: 'current', CREDIT: 'todo', PURCHASED: 'todo' },
            AT,
            ['INTERESTED'],
          ),
        })}
      />,
    );
    expect(stepItem('INTERESTED')).toHaveAttribute('aria-current', 'step');
    expect(stepItem('INTERESTED')).toHaveTextContent(`${formatDateShort(AT.INTERESTED)} · อยู่ขั้นนี้ 12 วัน · พนักงานบันทึก`);
    expect(stepItem('CREDIT')).toHaveAttribute('data-state', 'todo');
    expect(stepItem('CREDIT')).toHaveTextContent('ยังไม่ถึง');
    expect(screen.getByText('หลุด · ซื้อที่อื่น')).toBeInTheDocument();
    expect(screen.getByText('เงียบ 45 วัน')).toBeInTheDocument();
  });

  it('เครดิตไม่ผ่าน → ขั้นตรวจเครดิตบอกไม่ผ่าน · เงียบไม่เกิน 30 วันไม่ติดป้าย · รหัสหลุดที่ไม่รู้จักไม่แสดงค่าดิบ', () => {
    render(
      <JourneyStageStrip
        summary={journeySummary({
          stage: 'CREDIT',
          path: 'INSTALLMENT',
          daysInStage: 4,
          creditRejected: true,
          silentDays: 20,
          lost: { at: '2026-09-10T03:00:00.000Z', reason: 'SOMETHING_NEW' },
          steps: stageSteps({ CONTACTED: 'done', IDENTIFIED: 'done', INTERESTED: 'done', CREDIT: 'current', PURCHASED: 'todo' }, AT),
        })}
      />,
    );
    expect(stepItem('CREDIT')).toHaveTextContent(`${formatDateShort(AT.CREDIT)} · เครดิตไม่ผ่าน`);
    expect(stepItem('CREDIT')).not.toHaveTextContent('อยู่ขั้นนี้');
    expect(screen.queryByText(/^เงียบ/)).toBeNull();
    expect(screen.getByText('หลุด')).toBeInTheDocument();
    expect(screen.queryByText(/SOMETHING_NEW/)).toBeNull();
  });
});
```
Run: `TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx` → Expected: FAIL `Failed to resolve import "../components/JourneyStageStrip"`

- [ ] **Step 5: `components/JourneyStageStrip.tsx`**

```tsx
import { Check } from 'lucide-react';
import { JOURNEY_LOST_REASON_LABELS, STAGE_LABELS, type JourneyStep, type JourneySummary } from '@installment/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDateShort } from '@/utils/formatters';
import { SILENT_AFTER_DAYS } from '../utils/journeyGroups';

const DOT_CLASS: Record<JourneyStep['state'], string> = {
  done: 'bg-success text-success-foreground',
  current: 'bg-primary text-primary-foreground',
  skipped: 'bg-muted text-muted-foreground',
  todo: 'border border-dashed border-border bg-background text-muted-foreground',
};

function skippedCaption(path: JourneySummary['path']): string {
  if (path === 'CASH') return 'ข้าม (เงินสด)';
  if (path === 'EXTERNAL_FINANCE') return 'ข้าม (ไฟแนนซ์นอก)';
  return 'ข้าม';
}

function stepCaption(step: JourneyStep, summary: JourneySummary, failed: boolean): string {
  if (step.state === 'skipped') return skippedCaption(summary.path);
  if (step.state === 'todo') return 'ยังไม่ถึง';
  const parts = [step.at ? formatDateShort(step.at) : '—'];
  if (failed) parts.push('เครดิตไม่ผ่าน');
  else if (step.state === 'current' && step.stage !== 'PURCHASED') parts.push(`อยู่ขั้นนี้ ${summary.daysInStage} วัน`);
  if (step.evidence === 'MANUAL') parts.push('พนักงานบันทึก');
  return parts.join(' · ');
}

function lostLabel(reason: string): string {
  // รหัสที่ไม่มีใน shared แสดงแค่ "หลุด" ไม่แสดงค่าดิบ
  const label = JOURNEY_LOST_REASON_LABELS[reason];
  return label ? `หลุด · ${label}` : 'หลุด';
}

/** แถบ 5 ขั้นใต้ช่องตัวเลข — อ่านจาก summary เท่านั้น ห้าม derive ขั้นในเว็บ */
export default function JourneyStageStrip({ summary }: { summary: JourneySummary }) {
  const silentDays = summary.silentDays !== null && summary.silentDays > SILENT_AFTER_DAYS ? summary.silentDays : null;

  return (
    <section
      aria-label="ขั้นการเดินทางของลูกค้า"
      className="mb-5 rounded-xl border border-border/50 bg-card px-4 py-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ol className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-2">
          {summary.steps.map((step, index) => {
            const failed =
              step.stage === 'CREDIT' && summary.creditRejected && step.state !== 'todo' && step.state !== 'skipped';
            const muted = step.state === 'todo' || step.state === 'skipped';
            return (
              <li
                key={step.stage}
                data-stage={step.stage}
                data-state={step.state}
                aria-current={step.state === 'current' ? 'step' : undefined}
                className="flex min-w-[9rem] flex-1 items-center gap-2"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                    failed ? 'bg-destructive text-destructive-foreground' : DOT_CLASS[step.state],
                  )}
                >
                  {step.state === 'done' && !failed ? <Check className="size-3.5" /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block truncate text-[13px] font-medium leading-snug',
                      muted ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {STAGE_LABELS[step.stage]}
                  </span>
                  <span
                    className={cn('block truncate text-xs leading-snug', failed ? 'text-destructive' : 'text-muted-foreground')}
                  >
                    {stepCaption(step, summary, failed)}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        {(summary.lost || silentDays !== null) && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {summary.lost && (
              <Badge variant="destructive" appearance="light" size="md" className="leading-snug">
                {lostLabel(summary.lost.reason)}
              </Badge>
            )}
            {silentDays !== null && (
              <Badge variant="warning" appearance="light" size="md" className="leading-snug">
                {`เงียบ ${silentDays} วัน`}
              </Badge>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
```
Run เทส Step 4 → Expected: PASS 3 tests

- [ ] **Step 6: เทสแดง — ต่อ harness ของหน้า (แถบขั้น · การ์ดภาพรวม · แท็บ · redirect · สิทธิ์)**

แก้ `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx`:

(ก) import เพิ่มต่อจากบรรทัด `import { detail, emptyPurchase, progress, sale } from './fixtures';` (บรรทัด import ของ `@testing-library/react` มี `fireEvent, render, screen, waitFor, within` อยู่แล้ว — ถ้าขาดตัวใดให้เติมในบรรทัดเดิม):
```tsx
import { STAGE_LABELS } from '@installment/shared';
import { formatDateShort, formatDateTime } from '@/utils/formatters';
import { allChipNote } from '../utils/journeyGroups';
import { journeyEvent, journeyPage, journeySummary, stageSteps } from './journeyFixtures';
```

(ข) ใน `vi.hoisted(() => ({ … }))` ถัดจาก `detail: null as unknown,` เพิ่ม:
```tsx
  /** summary ต่อ customer id — id ที่ไม่ได้ตั้งจะโยน error ⇒ แถบขั้นไม่วาด */
  summaries: {} as Record<string, unknown>,
  /** ตอบ GET /customers/c1/journey ตาม params (limit / groups / cursor) */
  journey: vi.fn(),
```

(ค) แทน `beforeEach` ระดับไฟล์ (ก้อนที่ขึ้นต้น `beforeEach(() => {` แล้วมี `mocks.get.mockImplementation(async (url: string) => {` · `if (url === '/customers/c1') return { data: mocks.detail };`) ทั้งก้อนด้วย (ถ้า Plan 1 เติมบรรทัดอื่นไว้ในก้อนนั้น ให้คงบรรทัดนั้นไว้):
```tsx
beforeEach(() => {
  mocks.role = 'OWNER';
  mocks.detail = detail();
  // ค่าเริ่มต้นไม่ตั้ง summary: แถบขั้นไม่วาด เทสของ Plan 1 ที่ getByText ข้อความสั้น ๆ จึงไม่เจอป้ายขั้นซ้ำ — เทสแถบขั้นตั้งเอง
  mocks.summaries = {};
  mocks.journey.mockReset();
  mocks.journey.mockImplementation(() => journeyPage());
  mocks.get.mockReset();
  mocks.get.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === '/customers/c1') return { data: mocks.detail };
    const summaryId = /^\/customers\/([^/]+)\/journey\/summary$/.exec(url)?.[1];
    if (summaryId) {
      if (summaryId in mocks.summaries) return { data: mocks.summaries[summaryId] };
      throw new Error(`summary ไม่ได้ตั้งสำหรับ ${summaryId}`);
    }
    if (url === '/customers/c1/journey') return { data: mocks.journey(config?.params ?? {}) };
    if (url in RESPONSES) return { data: RESPONSES[url] };
    throw new Error(`unexpected GET ${url}`);
  });
});
```
(เทสเดิมที่ตั้ง `mocks.get.mockImplementation` เอง เช่นเทส R5 ของ Plan 1 ไม่มี URL การเดินทาง ⇒ summary/การ์ดได้ error เงียบ ๆ (`retry: false`) แถบขั้นไม่วาด การ์ดขึ้น `โหลดกิจกรรมไม่สำเร็จ` — ไม่กระทบสิ่งที่เทสนั้นตรวจ)

(ง) ในเทส `ลำดับแท็บ + แท็บที่ไม่มีข้อมูลโชว์จางแต่ยังกดได้` เปลี่ยนบรรทัด
```tsx
    expect(names).toEqual(['ภาพรวม', 'สัญญา (0)', 'ใบขาย (0)', 'เครดิต (0)', expect.stringMatching(/^แต้มสะสม/)]);
```
เป็น
```tsx
    expect(names).toEqual(['ภาพรวม', 'สัญญา (0)', 'ใบขาย (0)', 'เครดิต (0)', expect.stringMatching(/^แต้มสะสม/), 'การเดินทาง']);
```

(จ) เพิ่มท้ายไฟล์:
```tsx
describe('การเดินทางของลูกค้า', () => {
  it('แถบขั้นอยู่ใต้ช่องตัวเลข: ขั้นปัจจุบัน วันที่เข้าขั้น และวันที่ค้าง', async () => {
    mocks.detail = detail({ phone: null, chatPlaceholder: true, source: 'FACEBOOK', purchase: emptyPurchase, contracts: [] });
    mocks.summaries.c1 = journeySummary({
      stage: 'INTERESTED',
      daysInStage: 3,
      steps: stageSteps(
        { CONTACTED: 'done', IDENTIFIED: 'done', INTERESTED: 'current', CREDIT: 'todo', PURCHASED: 'todo' },
        { CONTACTED: '2026-09-01T03:00:00.000Z', IDENTIFIED: '2026-09-02T03:00:00.000Z', INTERESTED: '2026-09-12T03:00:00.000Z' },
      ),
    });
    renderAt('/customers/c1');
    const strip = await screen.findByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' });
    const current = within(strip).getByText(STAGE_LABELS.INTERESTED).closest('li');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(current).toHaveTextContent(`${formatDateShort('2026-09-12T03:00:00.000Z')} · อยู่ขั้นนี้ 3 วัน`);
    // ผู้สนใจ → ช่องตัวเลขช่องแรกคือ "ที่มา" (kpiTiles.ts) — แถบต้องมาหลังช่องตัวเลข
    const firstTileLabel = screen.getAllByText('ที่มา')[0];
    expect(firstTileLabel.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('ภาพรวม: การ์ดกิจกรรมล่าสุดขอ 6 รายการของแชท·เครดิต·ขาย และปุ่มพาไปแท็บการเดินทาง', async () => {
    mocks.journey.mockImplementation((params: Record<string, unknown>) =>
      params.limit === 6
        ? journeyPage({
            events: [
              journeyEvent({
                id: 'contract-k1',
                type: 'CONTRACT_SIGNED',
                group: 'sale',
                stage: 'PURCHASED',
                timestamp: '2026-08-20T09:05:00.000Z',
                title: 'เซ็นสัญญา CT-2569-0042',
                actor: { type: 'STAFF', name: 'บอส' },
                href: '/contracts/k1',
              }),
            ],
          })
        : journeyPage(),
    );
    renderAt('/customers/c1');
    expect(await screen.findByRole('heading', { name: 'กิจกรรมล่าสุด' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'เซ็นสัญญา CT-2569-0042' })).toHaveAttribute('href', '/contracts/k1');
    expect(screen.getByText(`${formatDateTime('2026-08-20T09:05:00.000Z')} · บอส`)).toBeInTheDocument();
    expect(mocks.journey).toHaveBeenCalledWith({ limit: 6, groups: 'chat,credit,sale' });

    fireEvent.click(screen.getByRole('button', { name: 'ดูการเดินทางทั้งหมด' }));
    expect(await screen.findByRole('tab', { name: 'การเดินทาง', selected: true })).toBeInTheDocument();
    expect(screen.getByLabelText('current location')).toHaveTextContent('/customers/c1?tab=journey');
    await waitFor(() => expect(mocks.journey).toHaveBeenCalledWith({ limit: 30, include: 'counts' }));
  });

  it('แท็บการเดินทาง: ป้ายประมาณจาก reliability · ไม่แสดง metadata · โหลดเพิ่มด้วย cursor จนหมด', async () => {
    mocks.journey.mockImplementation((params: Record<string, unknown>) =>
      params.cursor === 'cur-2'
        ? journeyPage({ events: [journeyEvent({ id: 'chat_room-r1', title: 'ทักแชทครั้งแรกทาง Facebook' })] })
        : journeyPage({
            events: [
              journeyEvent({
                id: 'credit_check-k1',
                type: 'CREDIT_CHECK_OPENED',
                group: 'credit',
                stage: 'CREDIT',
                timestamp: '2026-09-10T03:00:00.000Z',
                title: 'เปิดตรวจเครดิต (จากสเตทเม้นในแชท)',
                subtitle: 'คะแนน 72',
                actor: null,
                reliability: 'approximate',
                metadata: { leaked: '0899999999' },
              }),
            ],
            nextCursor: 'cur-2',
            counts: { chat: 1, credit: 1 },
          }),
    );
    renderAt('/customers/c1?tab=journey');
    expect(await screen.findByText('เปิดตรวจเครดิต (จากสเตทเม้นในแชท)')).toBeInTheDocument();
    const [item] = screen.getAllByTestId('event-timeline-item');
    expect(within(item).getByText('คะแนน 72')).toBeInTheDocument();
    expect(within(item).getByText('ประมาณ')).toBeInTheDocument();
    expect(screen.queryByText(/0899999999/)).toBeNull();
    // ชิปแสดงจำนวนจาก counts ของหน้าแรก (Task 9) ต่อท้ายป้าย
    expect(screen.getByRole('button', { name: /^เครดิต\s*1$/ })).toHaveAttribute('aria-pressed', 'false');
    expect(mocks.journey).toHaveBeenCalledWith({ limit: 30, include: 'counts' });

    fireEvent.click(screen.getByRole('button', { name: 'โหลดเพิ่ม' }));
    expect(await screen.findByText('ทักแชทครั้งแรกทาง Facebook')).toBeInTheDocument();
    // หน้าที่มี cursor ไม่ส่ง include (API ไม่แนบ counts ให้หน้าถัดไปอยู่แล้ว)
    expect(mocks.journey).toHaveBeenCalledWith({ limit: 30, cursor: 'cur-2' });
    expect(screen.queryByRole('button', { name: 'โหลดเพิ่ม' })).toBeNull();
  });

  it('ชิปกลุ่ม: กดแชทแล้วขอ groups=chat · OWNER เห็นชำระเงิน · SALES ไม่เห็นชำระเงินและติดตามหนี้', async () => {
    const { unmount } = renderAt('/customers/c1?tab=journey');
    expect(await screen.findByRole('button', { name: 'ชำระเงิน' })).toBeInTheDocument();
    const note = allChipNote('OWNER');
    expect(note).not.toBeNull();
    expect(screen.getByText(String(note))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'แชท/ติดต่อ' }));
    await waitFor(() => expect(mocks.journey).toHaveBeenCalledWith({ limit: 30, groups: 'chat', include: 'counts' }));
    expect(await screen.findByText('ยังไม่มีกิจกรรมในกลุ่มนี้')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'แชท/ติดต่อ' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(String(note))).toBeNull();
    unmount();

    mocks.role = 'SALES';
    renderAt('/customers/c1?tab=journey');
    expect(await screen.findByRole('button', { name: 'เครดิต' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ชำระเงิน' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ติดตามหนี้' })).toBeNull();
  });

  it('ไม่มีกิจกรรม → ข้อความว่าง · รายการ "ระบบยังไม่เก็บ" พับไว้และกางได้', async () => {
    mocks.journey.mockImplementation(() => journeyPage({ notRecorded: ['ลูกค้าหน้าร้านรู้จักร้านจากไหน', 'ผู้ถอดแท็ก การบล็อก/เลิกติดตาม LINE และการเข้าชมเว็บ'] }));
    renderAt('/customers/c1?tab=journey');
    expect(await screen.findByText('ยังไม่มีกิจกรรม')).toBeInTheDocument();
    expect(screen.queryByText('ลูกค้าหน้าร้านรู้จักร้านจากไหน')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /ระบบยังไม่เก็บ \(2\)/ }));
    expect(await screen.findByText('ลูกค้าหน้าร้านรู้จักร้านจากไหน')).toBeInTheDocument();
    expect(screen.getByText('ผู้ถอดแท็ก การบล็อก/เลิกติดตาม LINE และการเข้าชมเว็บ')).toBeInTheDocument();
  });

  it('ลิงก์เก่าของผู้สนใจที่ถูกรวมแล้ว → summary ตอบ redirectToCustomerId → ไปหน้าลูกค้าจริง', async () => {
    mocks.summaries.old = { redirectToCustomerId: 'c1' };
    renderAt('/customers/old');
    await waitFor(() => expect(screen.getByLabelText('current location')).toHaveTextContent('/customers/c1'));
    expect(await screen.findByRole('heading', { level: 1, name: 'สมชาย ใจดี' })).toBeInTheDocument();
  });

  it('บทบาทที่ API การเดินทางไม่อนุญาต → ไม่มีแท็บ ไม่มีแถบขั้น ไม่มีการ์ด และไม่ยิง API', async () => {
    mocks.role = 'VIEWER';
    renderAt('/customers/c1');
    await screen.findByRole('heading', { level: 1, name: 'สมชาย ใจดี' });
    expect(screen.queryByRole('tab', { name: 'การเดินทาง' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'กิจกรรมล่าสุด' })).toBeNull();
    expect(mocks.get).not.toHaveBeenCalledWith('/customers/c1/journey/summary');
    expect(mocks.journey).not.toHaveBeenCalled();
  });
});
```

Run: `TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx` → Expected: FAIL — `Unable to find role="region" and name "ขั้นการเดินทางของลูกค้า"` · `Unable to find role="heading" and name "กิจกรรมล่าสุด"` · เทส `ลำดับแท็บ` แดงเพราะยังไม่มี `การเดินทาง` · เทสอื่นของ Plan 1 ต้องยังเขียว (ถ้าแดงเพราะ `unexpected GET` แปลว่า beforeEach ข้อ (ค) วางไม่ครบ)

- [ ] **Step 7: `components/RecentActivityCard.tsx`**

```tsx
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { defaultEventStyle } from '@/components/timeline/eventTimelineStyles';
import { Card, CardContent, CardHeader, CardHeading, CardTitle, CardToolbar } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/utils/formatters';
import { isJourneyRedirect, useCustomerJourney } from '../hooks/useCustomerJourney';
import { canViewJourney, journeyEventSubtitle, OVERVIEW_GROUPS, OVERVIEW_LIMIT } from '../utils/journeyGroups';

/** การ์ดท้ายแท็บภาพรวม — 6 เหตุการณ์ล่าสุดของแชท/เครดิต/ขาย · ปุ่มพาไปแท็บการเดินทาง · ไม่อ่าน metadata (PDPA) */
export default function RecentActivityCard({
  customerId,
  role,
  onOpenJourney,
}: {
  customerId: string;
  role: string;
  onOpenJourney: () => void;
}) {
  const visible = canViewJourney(role);
  const query = useCustomerJourney(customerId, OVERVIEW_GROUPS, { limit: OVERVIEW_LIMIT, enabled: visible });
  if (!visible) return null;

  const first = query.data?.pages[0];
  const events = first && !isJourneyRedirect(first) ? first.events.slice(0, OVERVIEW_LIMIT) : [];

  return (
    <Card>
      <CardHeader>
        <CardHeading>
          <CardTitle>กิจกรรมล่าสุด</CardTitle>
        </CardHeading>
        <CardToolbar>
          <button
            type="button"
            onClick={onOpenJourney}
            className="inline-flex items-center gap-0.5 text-[13px] leading-snug text-primary hover:underline"
          >
            ดูการเดินทางทั้งหมด
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </button>
        </CardToolbar>
      </CardHeader>
      <CardContent className="pt-0">
        {query.isLoading ? (
          <div className="py-4 text-sm leading-snug text-muted-foreground">กำลังโหลดกิจกรรม…</div>
        ) : query.isError ? (
          <div className="py-4 text-sm leading-snug text-destructive">โหลดกิจกรรมไม่สำเร็จ</div>
        ) : events.length === 0 ? (
          <div className="py-4 text-sm leading-snug text-muted-foreground">ยังไม่มีกิจกรรม</div>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event) => {
              const { Icon, iconBg, iconText, typeLabel } = defaultEventStyle(event);
              const sub = [
                formatDateTime(event.timestamp),
                journeyEventSubtitle(event),
                event.reliability === 'approximate' ? 'ประมาณ' : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={event.id} className="flex items-start gap-3 py-2.5">
                  <span
                    title={typeLabel}
                    className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', iconBg)}
                  >
                    <Icon className={cn('size-3.5', iconText)} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    {event.href ? (
                      <Link
                        to={event.href}
                        className="block truncate text-sm font-medium leading-snug text-foreground hover:text-primary"
                      >
                        {event.title}
                      </Link>
                    ) : (
                      <div className="truncate text-sm font-medium leading-snug text-foreground">{event.title}</div>
                    )}
                    <div className="truncate text-xs leading-snug text-muted-foreground">{sub}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 8: `tabs/JourneyTab.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { JourneyEvent, JourneyListResponse } from '@installment/shared';
import QueryBoundary from '@/components/QueryBoundary';
import { EventTimeline, type EventTimelineItem } from '@/components/timeline/EventTimeline';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import TimelineFilterChips, { type TimelineChip } from '@/pages/CollectionsPage/components/TimelineFilterChips';
import { isJourneyRedirect, useCustomerJourney } from '../hooks/useCustomerJourney';
import { allChipNote, journeyEventSubtitle, journeyGroupLabel, journeyGroupsForRole } from '../utils/journeyGroups';

const ALL_CHIP = 'ALL';

/** ส่งเข้าไทม์ไลน์กลางเฉพาะฟิลด์ที่แสดง — ตัด metadata ทิ้ง (PDPA) · ผู้ทำต่อท้าย subtitle · ป้าย "ประมาณ" มาจาก reliability */
function toTimelineItem(event: JourneyEvent): EventTimelineItem {
  return {
    id: event.id,
    type: event.type,
    group: event.group,
    timestamp: event.timestamp,
    title: event.title,
    subtitle: journeyEventSubtitle(event) || undefined,
    reliability: event.reliability,
    href: event.href,
  };
}

function NotRecordedList({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium leading-snug text-muted-foreground hover:text-foreground"
        >
          <span>ระบบยังไม่เก็บ ({items.length})</span>
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="border-t border-border px-3 pt-2 text-xs leading-snug text-muted-foreground">
          เรื่องเหล่านี้ระบบยังไม่ได้บันทึก จึงไม่ปรากฏในการเดินทางด้านบน
        </p>
        <ul className="list-disc space-y-1 py-2 pl-7 pr-3 text-xs leading-snug text-muted-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function JourneyTab({ customerId, role }: { customerId: string; role: string }) {
  const visibleGroups = useMemo(() => journeyGroupsForRole(role), [role]);
  const [filter, setFilter] = useState<string>(ALL_CHIP);
  const groups = useMemo(() => {
    const picked = visibleGroups.find((group) => group === filter);
    return picked ? [picked] : null;
  }, [filter, visibleGroups]);
  // ตัวเลขบนชิปต้องใช้ counts ของหน้าแรก — การ์ดภาพรวมไม่ขอ จึงไม่จ่ายค่าสแกน
  const query = useCustomerJourney(customerId, groups, { include: 'counts' });

  const chips = useMemo<TimelineChip[]>(
    () => [
      { value: ALL_CHIP, label: 'ทั้งหมด' },
      ...visibleGroups.map((group) => ({ value: group, label: journeyGroupLabel(group) })),
    ],
    [visibleGroups],
  );

  const pages = (query.data?.pages ?? []).filter((page): page is JourneyListResponse => !isJourneyRedirect(page));
  const first: JourneyListResponse | undefined = pages[0];
  const items = pages.flatMap((page) => page.events.map(toTimelineItem));
  const note = filter === ALL_CHIP ? allChipNote(role) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <TimelineFilterChips chips={chips} value={filter} onChange={setFilter} counts={first?.counts} />
        {note && <p className="text-xs leading-snug text-muted-foreground">{note}</p>}
      </div>

      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        errorTitle="โหลดการเดินทางของลูกค้าไม่สำเร็จ"
      >
        <EventTimeline
          events={items}
          emptyText={filter === ALL_CHIP ? 'ยังไม่มีกิจกรรม' : 'ยังไม่มีกิจกรรมในกลุ่มนี้'}
          footer={
            query.hasNextPage ? (
              <div className="flex justify-center pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="leading-snug"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? 'กำลังโหลด…' : 'โหลดเพิ่ม'}
                </Button>
              </div>
            ) : null
          }
        />
      </QueryBoundary>

      {first && first.notRecorded.length > 0 && <NotRecordedList items={first.notRecorded} />}
    </div>
  );
}
```

- [ ] **Step 9: ต่อเข้าหน้า — `OverviewTab.tsx` + `index.tsx`**

`tabs/OverviewTab.tsx` — เพิ่ม import ต่อจาก `import ActiveContractCard from '../components/ActiveContractCard';`:
```tsx
import RecentActivityCard from '../components/RecentActivityCard';
```
แล้วเป็นลูกตัวสุดท้ายของ `<div className="flex flex-col gap-5">` (ถัดจากบล็อก `{kind !== 'PROSPECT' && customer.openContracts.length === 0 && sales.length === 0 && (` … `)}` ก่อน `</div>` ปิดของ root):
```tsx
      <RecentActivityCard customerId={customer.id} role={role} onOpenJourney={() => onOpenTab('journey')} />
```

`index.tsx` — เพิ่ม import ต่อจาก `import KpiTiles from './components/KpiTiles';` / กลุ่ม import เดิม:
```tsx
import JourneyStageStrip from './components/JourneyStageStrip';
import { useJourneySummaryRedirect } from './hooks/useCustomerJourney';
import JourneyTab from './tabs/JourneyTab';
import { canViewJourney } from './utils/journeyGroups';
```
จุดที่ 1 — ถัดจากบรรทัด `const { user } = useAuth();` (อยู่ก่อน early return `if (customerError)` เสมอ):
```tsx
  const journeyVisible = canViewJourney(user?.role ?? '');
  // ต้องอยู่ก่อน early return: id ของผู้สนใจที่ถูกรวมแล้ว GET /customers/:id ตอบ 404 แต่ summary ตอบ redirectToCustomerId
  const journeySummary = useJourneySummaryRedirect(id ?? '', journeyVisible);
```
จุดที่ 2 — ถัดจาก `<KpiTiles tiles={kpiTiles(customer, loyaltyPoints?.balance ?? null)} />`:
```tsx
      {journeySummary && <JourneyStageStrip summary={journeySummary} />}
```
จุดที่ 3 — ใน `TabsList` ถัดจาก `</TabsTrigger>` ของ `value="loyalty"` (ก่อน `</TabsList>`):
```tsx
                {journeyVisible && <TabsTrigger value="journey">การเดินทาง</TabsTrigger>}
```
จุดที่ 4 — ถัดจาก `</TabsContent>` ของ `value="loyalty"` (ก่อน `</Tabs>`):
```tsx
            {journeyVisible && (
              <TabsContent className="min-w-0" value="journey">
                <JourneyTab customerId={customer.id} role={user?.role ?? ''} />
              </TabsContent>
            )}
```
Run: `TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx` → Expected: PASS ทุกเทสในไฟล์ (เทสของ Plan 1 เดิมทั้งหมด + 7 เทสใหม่ · `failed` = 0)

- [ ] **Step 10: ยืนยันทั้งโฟลเดอร์**

Run (จาก `apps/web`):
```bash
TZ=UTC npx vitest run src/pages/CustomerDetailPage src/pages/CollectionsPage src/components/timeline
npx tsc --noEmit
npx eslint src/pages/CustomerDetailPage/utils/journeyGroups.ts src/pages/CustomerDetailPage/__tests__/journeyGroups.test.ts src/pages/CustomerDetailPage/hooks/useCustomerJourney.ts src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts src/pages/CustomerDetailPage/components/JourneyStageStrip.tsx src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx src/pages/CustomerDetailPage/components/RecentActivityCard.tsx src/pages/CustomerDetailPage/tabs/JourneyTab.tsx src/pages/CustomerDetailPage/tabs/OverviewTab.tsx src/pages/CustomerDetailPage/index.tsx src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx
grep -n "\.metadata" src/pages/CustomerDetailPage/tabs/JourneyTab.tsx src/pages/CustomerDetailPage/components/RecentActivityCard.tsx src/pages/CustomerDetailPage/components/JourneyStageStrip.tsx
grep -rn "interface JourneyRedirect\|CustomerJourneyPage\|JOURNEY_GROUP_LABELS" src/pages/CustomerDetailPage
grep -nE "#[0-9a-fA-F]{3,6}\b|text-gray-|bg-white|leading-none" src/pages/CustomerDetailPage/components/JourneyStageStrip.tsx src/pages/CustomerDetailPage/components/RecentActivityCard.tsx src/pages/CustomerDetailPage/tabs/JourneyTab.tsx
grep -rn "ACCOUNTANT: \['chat'\]\|BOUGHT_ELSEWHERE: 'ซื้อที่อื่น'" src/pages/CustomerDetailPage
```
Expected:
- vitest: `failed` = 0 (journeyGroups 7 · JourneyStageStrip 3 · CustomerDetailPage ทั้งไฟล์ · CollectionsPage + timeline ของ Task 11 ยังเขียว)
- tsc 0 error · eslint 0 error
- grep ทั้ง 4 ตัว: ไม่มีผลลัพธ์ (ไม่อ่าน metadata · ไม่ประกาศชนิดคำตอบ/ป้ายกลุ่มซ้ำ · ไม่มีสีนอก token · ไม่ลอกกฎกลุ่ม/ป้ายหลุดจาก shared)

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/pages/CustomerDetailPage/utils/journeyGroups.ts apps/web/src/pages/CustomerDetailPage/__tests__/journeyGroups.test.ts apps/web/src/pages/CustomerDetailPage/hooks/useCustomerJourney.ts apps/web/src/pages/CustomerDetailPage/__tests__/journeyFixtures.ts apps/web/src/pages/CustomerDetailPage/components/JourneyStageStrip.tsx apps/web/src/pages/CustomerDetailPage/__tests__/JourneyStageStrip.test.tsx apps/web/src/pages/CustomerDetailPage/components/RecentActivityCard.tsx apps/web/src/pages/CustomerDetailPage/tabs/JourneyTab.tsx apps/web/src/pages/CustomerDetailPage/tabs/OverviewTab.tsx apps/web/src/pages/CustomerDetailPage/index.tsx apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx
git commit -m "feat(web): แท็บการเดินทางของลูกค้า แถบ 5 ขั้น การ์ดกิจกรรมล่าสุด และพาลิงก์ผู้สนใจที่ถูกรวมไปหน้าลูกค้าจริง

ใช้ไทม์ไลน์/ชิป/ป้ายกลุ่มจาก EventTimeline กลาง และชนิดคำตอบจาก @installment/shared · ไม่อ่าน metadata ของเหตุการณ์

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: ปิดงานเฟส 1 — สิทธิ์ MCP อ่านตารางใหม่ (ไม่ให้ `note`) · DSAR ลบประวัติการเดินทาง · ตรวจทั้งชุด · เว็บ 26.9.28 · runbook เจ้าของ

**Files:**
- Modify: `.claude/mcp/sql/policy.mjs:46` (allowlist ของ `customers` เพิ่ม `merged_into_id`) และแทรกหลัง `:66` (`staff_chat_activities`) ก่อน `}` บรรทัด 67 = allowlist ใหม่ `customer_journey_entries`
- Modify: `.claude/mcp/sql/grants.sql` แทรก 2 บล็อกก่อน `:192` (`REVOKE ALL ON public."customer_line_links" FROM mcp_ro;`) + แก้ `:202` (GRANT ของ `customers`)
- Create: `.claude/mcp/test/journey-grants.test.mjs`
- Modify: `apps/api/src/modules/pdpa/pdpa.service.ts:2` (import `Prisma`) · `:195-223` (`processDSAR`) · เมธอด private ใหม่ `eraseCustomerJourney` ถัดจาก `processDSAR` ก่อน `generateCustomerDataExport` (`:225`)
- Modify: `apps/api/src/modules/pdpa/pdpa.service.spec.ts:79` (type ของ seed) · `:101-113` (mock `customer` เพิ่ม `findMany`) · `:185-187` (mock `customerJourneyEntry`/`customerJourneyState`/`$transaction`) · `:571-572` (เทสใหม่ท้าย `describe('processDSAR')`)
- Create: `apps/api/src/modules/pdpa/pdpa-dsar-journey.db.spec.ts`
- ตรวจอย่างเดียว (Step 10): ไม่มีทาง hard delete แถว `customers` นอกไฟล์เทส (`grep` ใน `apps/api/src` ณ วันเขียนแผน = 0 จุด) · factory reset ใช้ `TRUNCATE … CASCADE` กับ `WIPE_TABLES` ที่ Task 1 เพิ่ม `customer_journey_entries` / `customer_journey_states` แล้ว ⇒ FK `customer_journey_entries.customer_id` แบบ RESTRICT กระทบแค่ DSAR (งานนี้) กับ cleanup ของ spec
- Modify: `apps/web/package.json:3` (`26.9.27` → `26.9.28`; วันนี้เป็น `26.9.26` แล้ว Plan 1 Task 7 bump เป็น `26.9.27`)
- ไม่แตะ: `.claude/mcp/sql/grants-report.md` (ไฟล์สร้างอัตโนมัติ ตัวเลขรวมในนั้นเก่าอยู่แล้ว ดูเหตุผลใน Step 2)

**Interfaces:**
- Consumes:
  - Prisma models จาก Task 1 (migration `apps/api/prisma/migrations/20261002100000_customer_journey/migration.sql`): `prisma.customerJourneyEntry` (`customer_journey_entries`), `prisma.customerJourneyState` (`customer_journey_states`), `Customer.mergedIntoId` (`merged_into_id`)
  - คอลัมน์ตาม synthesis `dataModel`:
    - entries 21 คอลัมน์: `id, customer_id, origin_customer_id, origin, kind, occurred_at, actor_type, actor_user_id, room_id, ref_type, ref_id, data, channel, outcome, lost_reason, heard_from, note, dedupe_key, created_at, deleted_at, deleted_by_id`
    - states 20 คอลัมน์
  - `decide(table, column, dataType)` จาก `.claude/mcp/sql/policy.mjs:163`
  - Task 2 — `journeyDedupeKey(kind: JourneySystemEntryKind, ...parts: Array<string | number>): string` จาก `apps/api/src/modules/customer-journey/journey-data-schemas.ts` (seed ของ db spec)
  - Task 10 — npm script `backfill:customer-journey` → `apps/api/src/cli/backfill-customer-journey.cli.ts`:
    - dry-run เป็นค่าตั้งต้น
    - env `EXPECTED_DB_NAME`, `CONFIRM_BACKFILL=YES_I_AM_SURE`, `ALLOW_PROD_BACKFILL`
    - exit 1 = ห้องไม่มีเจ้าของเกิน 1%
    - exit 2 = PURCHASED ≠ BOUGHT_WHERE / recompute ล้มบางชุด / processed ≠ plan.customers
    - ใช้ใน runbook เท่านั้น
  - เทสของ Task 1–12 ทั้งหมด (ใช้ในขั้นตรวจทั้งชุด) — โมดูลที่ Task 4–6 ใส่ hook: `chat-prospects` · `contracts` · `credit-check` · `chat-engine` · `chat-adapters` · `customers` · `line-oa` · `chatbot-finance` · CLI ของ Task 10 · cron ของ Task 9 (`journey:recompute` 03:30 · `journey:entry-guard` 04:00 เวลาไทย)
  - Task 6 — `CONTACT_ADDED` เขียนจาก `PATCH /customers/:id` (`via: 'UPDATE'`) และ `POST /customers/:id/fill-contact` (`via: 'FILL_CONTACT'`) เท่านั้น · เครื่องมือเก็บเบอร์ของบอทขายไม่ได้ต่อ hook ในเฟสนี้ (ดูหัวข้อ "ขอบเขต")
- Produces:
  - `PDPAService.processDSAR(id: string, userId: string, status: string, responseNotes: string)` — ลายเซ็นเดิม
    - เมื่อ `requestType === 'DELETION' && status === 'COMPLETED'` จะทำใน `$transaction` เดียว: ลบ `customer_journey_entries` (เงื่อนไข `customerId ∈ ids OR originCustomerId ∈ ids`) + `customer_journey_states` (`customerId ∈ ids`) แล้วตั้ง `responseData = { journeyEntriesDeleted: number; journeyStatesDeleted: number }`
    - กรณีอื่นทำงานเหมือนเดิม
  - `private eraseCustomerJourney(tx: Prisma.TransactionClient, customerId: string): Promise<{ entries: number; states: number }>`
    - `ownerId = customer.mergedIntoId ?? customerId`
    - `ids = [ownerId, ...customers where mergedIntoId = ownerId]`
  - role `mcp_ro` ได้สิทธิ์:
    - `customer_journey_entries` 20/21 คอลัมน์ (ไม่มี `note`)
    - `customer_journey_states` ครบ 20 คอลัมน์
    - `customers.merged_into_id`
  - `PII_TABLE_ALLOWLIST.customer_journey_entries` ใน `policy.mjs` (fail-closed: คอลัมน์ที่เพิ่มทีหลังไม่ได้สิทธิ์จนกว่าจะใส่ลิสต์)
  - เว็บ version `26.9.28`

- [ ] **Step 1: เทสแดง — สิทธิ์ MCP ของตารางการเดินทาง**

สร้าง `.claude/mcp/test/journey-grants.test.mjs` (สไตล์ไม่มี `;` ตาม `guard.test.mjs` · ไม่พึ่ง `node_modules` เพราะ `policy.mjs` ไม่มี import):
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decide } from '../sql/policy.mjs'

const GRANTS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'sql', 'grants.sql'), 'utf8')
const GRANT_LINE = /^GRANT SELECT \(([^)]*)\) ON public\."([^"]+)" TO mcp_ro;$/gm

/** คอลัมน์ใน GRANT SELECT (...) ของตารางหนึ่ง — อ่านรูปแบบเดียวกับ aclDrift() ใน src/db.mjs */
function granted(table) {
  for (const m of GRANTS.matchAll(GRANT_LINE)) {
    if (m[2] === table) return m[1].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
  }
  return null
}

// ลำดับตาม field ใน schema.prisma (= attnum ของ CREATE TABLE ใน migration 20261002100000_customer_journey)
const ENTRY_COLUMNS = [
  'id', 'customer_id', 'origin_customer_id', 'origin', 'kind', 'occurred_at',
  'actor_type', 'actor_user_id', 'room_id', 'ref_type', 'ref_id', 'data',
  'channel', 'outcome', 'lost_reason', 'heard_from', 'dedupe_key',
  'created_at', 'deleted_at', 'deleted_by_id',
]
const STATE_COLUMNS = [
  'customer_id', 'stage', 'stage_entered_at', 'path', 'contacted_at', 'identified_at',
  'interested_at', 'credit_at', 'first_purchase_at', 'first_purchase_kind', 'first_staff_reply_at',
  'first_channel', 'first_source', 'first_ad_campaign_id', 'heard_from',
  'last_customer_at', 'last_touch_at', 'lost_at', 'lost_reason', 'computed_at',
]

test('customer_journey_entries: note (บันทึกมือ ข้อความอิสระ) ไม่ได้สิทธิ์ทั้งใน policy และใน grants.sql', () => {
  assert.equal(decide('customer_journey_entries', 'note', 'character varying(140)').allow, false)
  assert.deepEqual(granted('customer_journey_entries'), ENTRY_COLUMNS)
})

test('customer_journey_entries: คอลัมน์ที่ migration เพิ่มทีหลังไม่ได้สิทธิ์จนกว่าจะใส่ allowlist (fail-closed)', () => {
  assert.equal(decide('customer_journey_entries', 'future_column', 'text').allow, false)
})

test('customer_journey_states: แคชสรุปอ่านได้ทุกคอลัมน์', () => {
  assert.deepEqual(granted('customer_journey_states'), STATE_COLUMNS)
})

test('customers: merged_into_id อ่านได้ (ตามรอยการรวม placeholder เทียบกับ audit)', () => {
  assert.deepEqual(granted('customers'), ['id', 'created_at', 'updated_at', 'deleted_at', 'status', 'merged_into_id'])
})

test('ทุกคอลัมน์ที่ grants.sql ให้สิทธิ์ต้องผ่าน policy.mjs และไม่มี grant ทั้งตาราง (กันแก้ไฟล์ด้วยมือแล้วเปิด PII)', () => {
  const violations = []
  for (const m of GRANTS.matchAll(GRANT_LINE)) {
    for (const c of m[1].split(',').map(s => s.trim().replace(/^"|"$/g, ''))) {
      if (!decide(m[2], c, 'unknown').allow) violations.push(`${m[2]}.${c}`)
    }
  }
  assert.deepEqual(violations, [])
  assert.doesNotMatch(GRANTS, /^GRANT SELECT ON /m)
})
```
Run (จากรากของ worktree): `node --test .claude/mcp/test/journey-grants.test.mjs`

Expected: FAIL — `pass 1` · `fail 4`
- เทส 1, 3, 4 ล้มเพราะ `granted()` คืน `null` หรือไม่มี `merged_into_id`
- เทส 2 ล้มเพราะตารางยังไม่อยู่ใน allowlist จึงได้สิทธิ์ตามชื่อ
- เทส 5 ผ่านตั้งแต่ก่อนแก้ ตรวจแล้วว่าไฟล์ปัจจุบันมี 0 คอลัมน์ที่ขัด policy จึงใช้เป็นด่านกันถอยหลังได้

- [ ] **Step 2: policy + grants.sql**

`.claude/mcp/sql/policy.mjs:46` แทนบรรทัด
```js
  customers: ['id', 'created_at', 'updated_at', 'deleted_at', 'branch_id', 'customer_type', 'status'],
```
ด้วย
```js
  // merged_into_id = uuid ชี้ลูกค้าปลายทางของ placeholder ที่ถูกรวม (ไม่ใช่ตัวตน) — ใช้เทียบกับ audit CUSTOMER_PLACEHOLDER_MERGED
  customers: ['id', 'created_at', 'updated_at', 'deleted_at', 'branch_id', 'customer_type', 'status', 'merged_into_id'],
```
แทรกหลังบรรทัด 66 (`staff_chat_activities: [...]`) ก่อน `}`:
```js
  // ── การเดินทางของลูกค้า (migration 20261002100000_customer_journey) — ระบุคอลัมน์เป๊ะ
  //    ตั้งใจไม่ให้: note (บันทึกมือ ข้อความอิสระ ≤140 ตัว พนักงานอาจพิมพ์ชื่อ/รายละเอียดส่วนตัวลงไป แม้ DTO จะกันเลขยาว)
  //    data (jsonb) ให้ได้เพราะผ่าน JOURNEY_DATA_SCHEMAS (zod whitelist) ที่ห้ามข้อความแชท/เบอร์/เลขบัตร/ที่อยู่
  //    คอลัมน์ที่ migration เพิ่มทีหลังไม่ได้สิทธิ์จนกว่าจะใส่ในลิสต์นี้ = fail-closed
  customer_journey_entries: [
    'id', 'customer_id', 'origin_customer_id', 'origin', 'kind', 'occurred_at',
    'actor_type', 'actor_user_id', 'room_id', 'ref_type', 'ref_id', 'data',
    'channel', 'outcome', 'lost_reason', 'heard_from', 'dedupe_key',
    'created_at', 'deleted_at', 'deleted_by_id',
  ],
```
`.claude/mcp/sql/grants.sql`: แทรกก่อนบรรทัด 192 (`REVOKE ALL ON public."customer_line_links" FROM mcp_ro;`) ตามลำดับชื่อตารางแบบเดียวกับ generator (`customer_access_tokens` < `customer_journey_*` < `customer_line_links`):
```sql
REVOKE ALL ON public."customer_journey_entries" FROM mcp_ro;
GRANT SELECT ("id", "customer_id", "origin_customer_id", "origin", "kind", "occurred_at", "actor_type", "actor_user_id", "room_id", "ref_type", "ref_id", "data", "channel", "outcome", "lost_reason", "heard_from", "dedupe_key", "created_at", "deleted_at", "deleted_by_id") ON public."customer_journey_entries" TO mcp_ro;

REVOKE ALL ON public."customer_journey_states" FROM mcp_ro;
GRANT SELECT ("customer_id", "stage", "stage_entered_at", "path", "contacted_at", "identified_at", "interested_at", "credit_at", "first_purchase_at", "first_purchase_kind", "first_staff_reply_at", "first_channel", "first_source", "first_ad_campaign_id", "heard_from", "last_customer_at", "last_touch_at", "lost_at", "lost_reason", "computed_at") ON public."customer_journey_states" TO mcp_ro;

```
และแทนบรรทัด (เดิม `:202`)
```sql
GRANT SELECT ("id", "created_at", "updated_at", "deleted_at", "status") ON public."customers" TO mcp_ro;
```
ด้วย
```sql
GRANT SELECT ("id", "created_at", "updated_at", "deleted_at", "status", "merged_into_id") ON public."customers" TO mcp_ro;
```
**ทำไมไม่รัน `npm run grants` สร้างทั้งไฟล์ใหม่** (ตรวจตอนเขียนแผน โดยรัน generator กับ `bc_journey_test` ในโฟลเดอร์ scratchpad): ไฟล์ที่ commit อยู่ตามโครง prod ไม่ทัน 6 ตาราง + 3 คอลัมน์ ถ้าสร้างใหม่ทั้งไฟล์จะ diff 26 บรรทัด ได้แก่
- ตารางที่เพิ่ม: `credit_approvals`, `payment_approval_requests`, `room_credit_analyses`, `room_credit_files`, `sale_cost_snapshots`, `trade_in_credit_redemptions`
- คอลัมน์ที่เพิ่ม: `max_months`, `shop_commission_pct`, `additional_late_fee`
- ลำดับคอลัมน์ `call_logs` สลับ

ตารางใหม่เหล่านี้มีข้อความอิสระที่ผ่านด่านชื่อ เช่น `credit_approvals.evidence_notes`, `room_credit_analyses.result/error`, `payment_approval_requests.reason` ⇒ ถ้าสร้างทั้งไฟล์ในงานนี้ เท่ากับเปิดข้อมูลที่เจ้าของยังไม่ได้รีวิว
- งานนี้จึงแทรกเฉพาะบล็อกที่ generator จะสร้างให้ 3 ตารางนี้
- ส่วนด่านกันแก้มือหลุดคือเทส 5 ของ Step 1 · แก้ `grants-report.md` ในรอบที่เจ้าของรีวิวแล้วสร้างใหม่ทั้งไฟล์ (อยู่ในหัวข้อค้างของ runbook)

Run (จากรากของ worktree): `node --test .claude/mcp/test/guard.test.mjs .claude/mcp/test/journey-grants.test.mjs` → Expected: PASS `fail 0`

- [ ] **Step 3: พิสูจน์ว่า grants.sql apply ได้จริงหลัง migration (cluster ทดสอบในเครื่องเท่านั้น ห้ามชี้ prod)**

ตอนเขียนแผนตรวจแล้วว่าทุกตารางและทั้ง 2,378 คอลัมน์ใน grants.sql มีอยู่ใน `bc_journey_test` และ `prospects_test` เป็น superuser ของ cluster ทดสอบ ⇒ ถ้า apply ล้ม แปลว่าชื่อคอลัมน์ใน migration ของ Task 1 ไม่ตรงบล็อกที่แทรก ต้องแก้บล็อกให้ตรง migration

รันทีละคำสั่งจากรากของ worktree:
```bash
psql "postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket" -qX -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_ro') THEN CREATE ROLE mcp_ro NOLOGIN; END IF; END \$\$;"
psql "postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket" -qX -v ON_ERROR_STOP=1 -f .claude/mcp/sql/grants.sql
psql "postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket" -AtX -c "SELECT has_column_privilege('mcp_ro', 'public.customer_journey_entries', 'note', 'SELECT'), has_column_privilege('mcp_ro', 'public.customer_journey_entries', 'kind', 'SELECT'), has_column_privilege('mcp_ro', 'public.customer_journey_states', 'stage', 'SELECT'), has_column_privilege('mcp_ro', 'public.customers', 'merged_into_id', 'SELECT')"
psql "postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket" -AtX -c "SELECT attname FROM pg_attribute WHERE attrelid = 'public.customer_journey_entries'::regclass AND attnum > 0 AND NOT attisdropped AND NOT has_column_privilege('mcp_ro', attrelid, attnum, 'SELECT')"
psql "postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket" -AtX -c "SELECT attname FROM pg_attribute WHERE attrelid = 'public.customer_journey_states'::regclass AND attnum > 0 AND NOT attisdropped AND NOT has_column_privilege('mcp_ro', attrelid, attnum, 'SELECT')"
```
Expected:
- คำสั่ง 1–2 exit 0 ไม่มี `ERROR`
- คำสั่ง 3 = `f|t|t|t`
- คำสั่ง 4 = `note` บรรทัดเดียว
- คำสั่ง 5 = ว่าง (ถ้ามีชื่อคอลัมน์โผล่ แปลว่า migration มีคอลัมน์ที่ไม่อยู่ใน dataModel → เพิ่มในบล็อก/allowlist แล้วรัน Step 2–3 ใหม่)

- [ ] **Step 4: Commit สิทธิ์ MCP**

(`.claude/**` อยู่ใน `paths-ignore` ของ `deploy-gcp.yml` — commit นี้ไม่ทริกเกอร์ deploy)
```bash
git add .claude/mcp/sql/policy.mjs .claude/mcp/sql/grants.sql .claude/mcp/test/journey-grants.test.mjs
git commit -m "chore(mcp): ให้ mcp_ro อ่านตารางการเดินทางของลูกค้า (ไม่ให้ note) และ customers.merged_into_id

แทรกเฉพาะบล็อกที่ generator จะสร้าง — ไม่สร้าง grants.sql ใหม่ทั้งไฟล์ เพราะจะเปิด 6 ตารางที่เจ้าของยังไม่รีวิว
(credit_approvals.evidence_notes, room_credit_analyses.result ฯลฯ) · เทสกันแก้มือ: ทุกคอลัมน์ที่ grant ต้องผ่าน policy.mjs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: เทสแดง (mock) — DSAR DELETION ลบประวัติการเดินทาง**

`apps/api/src/modules/pdpa/pdpa.service.spec.ts`

(ก) ใน type ของ `seed` แทรกถัดจากบรรทัด 79 `exportCustomer?: CustomerRow | null;`:
```ts
  /** customer.findMany({ where: { mergedIntoId } }) — placeholder ที่ถูกรวมเข้าลูกค้าคนนี้ */
  absorbedCustomerIds?: string[];
  /** ผลนับของ deleteMany ตอนปิดคำร้อง DELETION */
  journeyEntryCount?: number;
  journeyStateCount?: number;
```
(ข) mock `customer` (บรรทัด 101-113) แทน
```ts
        return Promise.resolve(customers.find((c) => c.id === args.where.id) ?? null);
      }),
    },
    pDPAConsent: {
```
ด้วย
```ts
        return Promise.resolve(customers.find((c) => c.id === args.where.id) ?? null);
      }),
      findMany: jest.fn().mockImplementation(() =>
        Promise.resolve((seed.absorbedCustomerIds ?? []).map((id) => ({ id }))),
      ),
    },
    pDPAConsent: {
```
(ค) ท้าย mock (บรรทัด 185-187) แทน
```ts
  };

  return prisma as unknown as jest.Mocked<PrismaService> & typeof prisma;
```
ด้วย
```ts
    customerJourneyEntry: {
      deleteMany: jest.fn().mockResolvedValue({ count: seed.journeyEntryCount ?? 0 }),
    },
    customerJourneyState: {
      deleteMany: jest.fn().mockResolvedValue({ count: seed.journeyStateCount ?? 0 }),
    },
    $transaction: jest.fn(),
  };
  // interactive transaction: ส่ง mock ตัวเดียวกันเป็น tx
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));

  return prisma as unknown as jest.Mocked<PrismaService> & typeof prisma;
```
(ง) แทรกก่อน `  });` ที่ปิด `describe('processDSAR')` (บรรทัด 572 — ถัดจาก `});` ของเทส ACCESS บรรทัด 571):
```ts
    it('DELETION + COMPLETED → ลบประวัติการเดินทางของลูกค้าและ placeholder ที่ถูกรวมเข้ามา ในทรานแซกชันเดียวกับการปิดคำร้อง', async () => {
      const prisma = makePrismaMock({
        dsarRequests: [
          {
            id: 'd1',
            requestNumber: 'DSAR-2026-001',
            customerId: 'cust-1',
            requestType: 'DELETION',
            description: 'desc',
            dueDate: new Date(),
            deletedAt: null,
          },
        ],
        absorbedCustomerIds: ['placeholder-1'],
        journeyEntryCount: 4,
        journeyStateCount: 1,
      });
      const svc = new PDPAService(prisma);

      await svc.processDSAR('d1', 'user-9', 'COMPLETED', 'ลบประวัติการเดินทางแล้ว');

      const ids = ['cust-1', 'placeholder-1'];
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.customer.findMany).toHaveBeenCalledWith({ where: { mergedIntoId: 'cust-1' }, select: { id: true } });
      expect(prisma.customerJourneyEntry.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ customerId: { in: ids } }, { originCustomerId: { in: ids } }] },
      });
      expect(prisma.customerJourneyState.deleteMany).toHaveBeenCalledWith({ where: { customerId: { in: ids } } });
      const data = prisma.dSARRequest.update.mock.calls[0][0].data;
      expect(data.responseData).toEqual({ journeyEntriesDeleted: 4, journeyStatesDeleted: 1 });
      expect(data.completedAt).toBeInstanceOf(Date);
    });

    it.each([
      ['DELETION', 'IN_PROGRESS'],
      ['DELETION', 'REJECTED'],
      ['ACCESS', 'COMPLETED'],
    ])('%s + %s → ไม่แตะประวัติการเดินทาง', async (requestType, status) => {
      const prisma = makePrismaMock({
        dsarRequests: [
          {
            id: 'd1',
            requestNumber: 'DSAR-2026-001',
            customerId: 'cust-1',
            requestType,
            description: 'desc',
            dueDate: new Date(),
            deletedAt: null,
          },
        ],
        exportCustomer: {
          id: 'cust-1',
          name: 'สมหญิง',
          phone: null,
          email: null,
          nationalId: null,
          deletedAt: null,
          contracts: [],
          pdpaConsents: [],
        },
      });
      const svc = new PDPAService(prisma);

      await svc.processDSAR('d1', 'user-9', status, 'บันทึก');

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.customerJourneyEntry.deleteMany).not.toHaveBeenCalled();
      expect(prisma.customerJourneyState.deleteMany).not.toHaveBeenCalled();
    });
```
Run (จาก `apps/api`): `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/pdpa/pdpa.service.spec.ts --runInBand`

Expected: FAIL `Tests: 1 failed, 30 passed, 31 total`
- เทส DELETION + COMPLETED ล้มที่ `expect(jest.fn()).toHaveBeenCalledTimes(expected)` — Expected number of calls: 1 · Received number of calls: 0
- เทสเดิม 27 ตัว (รวม "sets completedAt when status === COMPLETED" ที่ใช้ DELETION) ยังผ่าน

- [ ] **Step 6: เทสแดง (Postgres จริง) — ลบจริง ไม่ลามคนอื่น ปิดซ้ำได้ และคำร้องที่ยื่นก่อนถูกรวม**

สร้าง `apps/api/src/modules/pdpa/pdpa-dsar-journey.db.spec.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import type { JourneySystemEntryKind } from '@installment/shared';
import { journeyDedupeKey } from '../customer-journey/journey-data-schemas';
import { PDPAService } from './pdpa.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * PDPA สิทธิ์ลบ กับ Postgres จริง — ปิดคำร้อง DELETION แล้ว customer_journey_entries (รวมบันทึกมือที่มี note)
 * และแคช customer_journey_states ของลูกค้า + placeholder ที่ถูกรวมเข้ามาต้องหายจริง ของลูกค้าคนอื่นต้องอยู่ครบ
 * รัน: DATABASE_URL=<ฐานทดสอบที่ apply 20261002100000_customer_journey แล้ว> npx jest <ไฟล์นี้> --runInBand
 */
describe('PDPAService.processDSAR — DELETION ลบประวัติการเดินทาง (real DB)', () => {
  const prisma = new PrismaClient();
  const service = new PDPAService(prisma as unknown as PrismaService);
  const stamp = Date.now();
  const at = new Date('2026-09-01T03:00:00.000Z');
  const customerIds: string[] = [];
  const dsarIds: string[] = [];

  beforeAll(() => {
    const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
    if (!/^test_db$|_test$/.test(dbName)) {
      throw new Error(`สเปคนี้ลบแถวจริง — ต้องรันกับฐานทดสอบ (test_db หรือ *_test) แต่ได้ "${dbName}"`);
    }
  });

  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({
      where: { OR: [{ customerId: { in: customerIds } }, { originCustomerId: { in: customerIds } }] },
    });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.dSARRequest.deleteMany({ where: { id: { in: dsarIds } } });
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
  });

  async function createCustomer(label: string, extra: { deletedAt?: Date; mergedIntoId?: string } = {}) {
    const row = await prisma.customer.create({ data: { name: `dsar journey spec ${label}`, phone: null, ...extra } });
    customerIds.push(row.id);
    return row;
  }

  function systemEntry(customerId: string, originCustomerId: string, kind: JourneySystemEntryKind, key: string) {
    return {
      customerId,
      originCustomerId,
      origin: 'SYSTEM',
      kind,
      occurredAt: at,
      actorType: 'SYSTEM',
      dedupeKey: journeyDedupeKey(kind, 'dsar-spec', key, stamp),
    };
  }

  function stateOf(customerId: string) {
    return {
      customerId,
      stage: 'IDENTIFIED',
      stageEnteredAt: at,
      path: 'UNKNOWN',
      contactedAt: at,
      firstChannel: 'CHAT_FACEBOOK',
      firstSource: 'CHAT_FACEBOOK',
      computedAt: at,
    };
  }

  async function createDeletionRequest(customerId: string, suffix: string) {
    const request = await prisma.dSARRequest.create({
      data: { requestNumber: `DSAR-SPEC-${stamp}-${suffix}`, customerId, requestType: 'DELETION', description: 'ขอลบข้อมูล', dueDate: at },
    });
    dsarIds.push(request.id);
    return request;
  }

  it('IN_PROGRESS ไม่ลบ · COMPLETED ลบ entries + state ของลูกค้าและ placeholder ที่รวม · ของคนอื่นอยู่ครบ · ปิดซ้ำได้', async () => {
    const target = await createCustomer('target');
    const placeholder = await createCustomer('placeholder', { deletedAt: at, mergedIntoId: target.id });
    const other = await createCustomer('other');
    await prisma.customerJourneyEntry.createMany({
      data: [
        systemEntry(target.id, target.id, 'CONTACT_ADDED', 'target'),
        systemEntry(target.id, placeholder.id, 'PLACEHOLDER_MERGED', 'merged'),
        {
          customerId: target.id,
          originCustomerId: target.id,
          origin: 'MANUAL',
          kind: 'TOUCHPOINT',
          occurredAt: at,
          actorType: 'STAFF',
          channel: 'PHONE',
          outcome: 'THINKING',
          note: 'ลูกค้าขอคิดก่อน',
        },
        systemEntry(other.id, other.id, 'CONTACT_ADDED', 'other'),
      ],
    });
    await prisma.customerJourneyState.createMany({ data: [stateOf(target.id), stateOf(placeholder.id), stateOf(other.id)] });
    const request = await createDeletionRequest(target.id, '1');

    await service.processDSAR(request.id, 'dsar-spec-user', 'IN_PROGRESS', 'กำลังตรวจ');
    expect(await prisma.customerJourneyEntry.count({ where: { customerId: target.id } })).toBe(3);

    const done = await service.processDSAR(request.id, 'dsar-spec-user', 'COMPLETED', 'ลบประวัติการเดินทางแล้ว');

    expect(done.responseData).toEqual({ journeyEntriesDeleted: 3, journeyStatesDeleted: 2 });
    expect(done.completedAt).not.toBeNull();
    const ids = [target.id, placeholder.id];
    expect(
      await prisma.customerJourneyEntry.count({
        where: { OR: [{ customerId: { in: ids } }, { originCustomerId: { in: ids } }] },
      }),
    ).toBe(0);
    expect(await prisma.customerJourneyState.count({ where: { customerId: { in: ids } } })).toBe(0);
    expect(await prisma.customerJourneyEntry.count({ where: { customerId: other.id } })).toBe(1);
    expect(await prisma.customerJourneyState.count({ where: { customerId: other.id } })).toBe(1);
    // ลบเฉพาะประวัติการเดินทาง — แถวลูกค้ายังอยู่ (สัญญา/ใบขายอยู่ใต้อายุความ)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: target.id } })).deletedAt).toBeNull();

    const again = await service.processDSAR(request.id, 'dsar-spec-user', 'COMPLETED', 'ปิดซ้ำ');
    expect(again.responseData).toEqual({ journeyEntriesDeleted: 0, journeyStatesDeleted: 0 });
  });

  it('คำร้องยื่นตอนยังเป็น placeholder แล้วถูกรวมก่อนปิดคำร้อง → ลบประวัติของเจ้าของปัจจุบัน (คนเดียวกัน)', async () => {
    const placeholder = await createCustomer('late-placeholder');
    const request = await createDeletionRequest(placeholder.id, '2');
    const target = await createCustomer('late-target');
    // จำลองผลของ absorbPlaceholder: entries อยู่ใต้เจ้าของใหม่ + placeholder ถูก soft-delete พร้อม merged_into_id
    await prisma.customerJourneyEntry.createMany({
      data: [
        systemEntry(target.id, placeholder.id, 'PLACEHOLDER_MERGED', 'late-merged'),
        systemEntry(target.id, target.id, 'LINE_LINKED', 'late-target'),
      ],
    });
    await prisma.customer.update({ where: { id: placeholder.id }, data: { deletedAt: at, mergedIntoId: target.id } });
    await prisma.customerJourneyState.create({ data: stateOf(target.id) });

    const done = await service.processDSAR(request.id, 'dsar-spec-user', 'COMPLETED', 'ลบแล้ว');

    expect(done.responseData).toEqual({ journeyEntriesDeleted: 2, journeyStatesDeleted: 1 });
    expect(
      await prisma.customerJourneyEntry.count({ where: { OR: [{ customerId: target.id }, { originCustomerId: placeholder.id }] } }),
    ).toBe(0);
    expect(await prisma.customerJourneyState.count({ where: { customerId: target.id } })).toBe(0);
  });
});
```
(`processedById` ของ `dsar_requests` ไม่มี FK — มีแค่ `dsar_requests_customer_id_fkey` — จึงใช้สตริงผู้ทำได้)

Run (จาก `apps/api`): `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/pdpa/pdpa-dsar-journey.db.spec.ts --runInBand`

Expected: FAIL `Tests: 2 failed` — ทั้งสองล้มที่ `expect(received).toEqual(expected)` ของ `responseData` (Received: `null`)

- [ ] **Step 7: implementation ใน `pdpa.service.ts`**

บรรทัด 2 แทน `import { DSARRequestType } from '@prisma/client';` ด้วย
```ts
import { DSARRequestType, Prisma } from '@prisma/client';
```
แทนเมธอด `processDSAR` ทั้งก้อน (บรรทัด 195-223) ด้วย:
```ts
  /** Process a DSAR request */
  async processDSAR(
    id: string,
    userId: string,
    status: string,
    responseNotes: string,
  ) {
    const request = await this.prisma.dSARRequest.findUnique({ where: { id } });
    if (!request || request.deletedAt) throw new NotFoundException('ไม่พบคำร้อง DSAR');

    const data: Record<string, unknown> = {
      status,
      responseNotes,
      processedById: userId,
      processedAt: new Date(),
    };

    // Auto-generate data export for ACCESS requests
    if (request.requestType === 'ACCESS') {
      const exportData = await this.generateCustomerDataExport(request.customerId);
      data.responseData = exportData;
    }

    if (status === 'COMPLETED') {
      data.completedAt = new Date();
    }

    // สิทธิ์ลบ (DELETION) ที่ปิดงาน: ลบประวัติการเดินทางของลูกค้า — บันทึกมือมี note อิสระ และแคชคัดลอก heardFrom/lostReason
    // ทำในทรานแซกชันเดียวกับการปิดคำร้อง: ลบไม่สำเร็จ = คำร้องไม่ถูกปิด · ปิดซ้ำได้ (รอบสองลบ 0 แถว)
    if (request.requestType === 'DELETION' && status === 'COMPLETED') {
      return this.prisma.$transaction(async (tx) => {
        const erased = await this.eraseCustomerJourney(tx, request.customerId);
        data.responseData = { journeyEntriesDeleted: erased.entries, journeyStatesDeleted: erased.states };
        return tx.dSARRequest.update({ where: { id }, data });
      });
    }

    return this.prisma.dSARRequest.update({ where: { id }, data });
  }

  /**
   * ลบ customer_journey_entries + customer_journey_states ของเจ้าของข้อมูล
   * - คำร้องที่ยื่นตอนยังเป็น placeholder แล้วถูกรวมไปก่อนปิด → เจ้าของปัจจุบันคือ merged_into_id (คนเดียวกัน)
   * - ids = เจ้าของปัจจุบัน + placeholder ทุกตัวที่ถูกรวมเข้ามา (ชั้นเดียว เพราะ absorbPlaceholder ยุบ chain แล้ว)
   * - entries จับทั้ง customerId (เจ้าของปัจจุบัน) และ originCustomerId (id ตอนเขียน)
   * แถว customers / สัญญา / ใบขาย ไม่แตะ — อยู่ใต้อายุความตามประกาศความเป็นส่วนตัว · แคช state คำนวณใหม่ได้จากข้อมูลธุรกิจที่เหลือ
   */
  private async eraseCustomerJourney(
    tx: Prisma.TransactionClient,
    customerId: string,
  ): Promise<{ entries: number; states: number }> {
    const subject = await tx.customer.findUnique({ where: { id: customerId }, select: { mergedIntoId: true } });
    const ownerId = subject?.mergedIntoId ?? customerId;
    const absorbed = await tx.customer.findMany({ where: { mergedIntoId: ownerId }, select: { id: true } });
    const ids = [ownerId, ...absorbed.map((row) => row.id)];
    const entries = await tx.customerJourneyEntry.deleteMany({
      where: { OR: [{ customerId: { in: ids } }, { originCustomerId: { in: ids } }] },
    });
    const states = await tx.customerJourneyState.deleteMany({ where: { customerId: { in: ids } } });
    return { entries: entries.count, states: states.count };
  }
```

- [ ] **Step 8: เทสเขียว + lint**

Run (จาก `apps/api`): `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/pdpa --runInBand`

Expected: PASS ทุก suite ในโมดูล
- `pdpa.service.spec.ts` 31 tests
- `pdpa-dsar-journey.db.spec.ts` 2 tests

`npx eslint src/modules/pdpa/pdpa.service.ts src/modules/pdpa/pdpa.service.spec.ts src/modules/pdpa/pdpa-dsar-journey.db.spec.ts` → 0 error (🚨 ห้าม `npm run lint` ใน apps/api)

- [ ] **Step 9: Commit DSAR**

```bash
git add apps/api/src/modules/pdpa/pdpa.service.ts apps/api/src/modules/pdpa/pdpa.service.spec.ts apps/api/src/modules/pdpa/pdpa-dsar-journey.db.spec.ts
git commit -m "feat(pdpa): ปิดคำร้อง DSAR ลบข้อมูล = ลบประวัติการเดินทางของลูกค้าและ placeholder ที่ถูกรวม

ลบ customer_journey_entries (customerId หรือ originCustomerId) + แคช customer_journey_states ในทรานแซกชันเดียวกับการปิดคำร้อง
responseData บันทึกจำนวนแถวที่ลบ · ปิดซ้ำได้ · คำร้องที่ยื่นก่อนถูกรวมตามไปลบที่เจ้าของปัจจุบัน

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 10: ตรวจทั้งชุด (ต้องเขียวทุกบรรทัดก่อน bump — ถ้าแดง ให้แก้ใน task ต้นเรื่อง ห้าม bump ข้าม)**

รันตามลำดับ:
1. จากรากของ worktree: `npm run build --workspace=packages/shared` → exit 0 (apps/api resolve `@installment/shared` ผ่าน `dist/` ของ package — ไม่ build แล้ว tsc/jest จะไม่เห็น `JOURNEY_STAGES` ฯลฯ)
2. จาก `apps/api`: `npx prisma generate` → `Generated Prisma Client`
3. จาก `apps/api`: `npx tsc --noEmit -p tsconfig.json` → 0 error
4. จาก `apps/api`: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest src/modules/customer-journey src/modules/customers src/modules/chat-prospects src/modules/overdue src/modules/pdpa src/modules/contracts src/modules/credit-check src/modules/chat-engine src/modules/chat-adapters src/modules/line-oa src/modules/chatbot-finance src/cli/backfill-customer-journey.spec.ts src/cli/backfill-customer-journey.db.spec.ts src/cli/backfill-chat-prospects.spec.ts src/cli/backfill-chat-prospects.db.spec.ts --runInBand` → `Test Suites: … 0 failed` (`*.integration.spec.ts` ถูก `testPathIgnorePatterns` ข้ามอยู่แล้ว)
   - ถ้า suite ใดล้มด้วย `Foreign key constraint violated` ที่ `customer_journey_entries_customer_id_fkey` = cleanup ของ spec นั้นลบลูกค้าที่ hook ของ Task 4–6 เขียน entry ไว้แล้ว → เปิดไฟล์ที่ jest พิมพ์ชื่อ แทรกบรรทัดนี้ก่อน `customer.deleteMany` ของ cleanup (ใช้ตัวแปร id ลูกค้าที่ไฟล์นั้นเก็บอยู่) แล้ว commit แยกด้วย `git add <ไฟล์ที่ jest พิมพ์>` ข้อความ `test(<โมดูล>): ลบ customer_journey_entries ก่อนลบลูกค้าใน cleanup`:
     ```ts
     await prisma.customerJourneyEntry.deleteMany({ where: { OR: [{ customerId: { in: customerIds } }, { originCustomerId: { in: customerIds } }] } });
     ```
5. จาก `apps/api`: `npx nest build && npm run verify:assets` → `✓ Assets verified` (SQL 3 ไฟล์ของ Task 3/9 อยู่ใน `dist` — CLI ของ Task 10 และ cron อ่านจากที่นั่น)
6. จากรากของ worktree: `grep -rnE "customer\.(delete|deleteMany)\(|DELETE FROM \"?customers" apps/api/src --include='*.ts' | grep -v "\.spec\.ts"` → ไม่มีผลลัพธ์ (ไม่มีทาง hard delete ลูกค้านอก DSAR ที่ต้องลบ entries ก่อน · ถ้ามีจุดใหม่โผล่ ต้องเรียกลบ `customer_journey_entries` แบบเดียวกับ `eraseCustomerJourney` ในทรานแซกชันเดียวกันก่อนลบลูกค้า)
7. จาก `apps/web`: `npx tsc --noEmit` → 0 error
8. จาก `apps/web`: `TZ=UTC npx vitest run` → ทุก test file ผ่าน (`failed` = 0)
9. จากรากของ worktree: `node --test .claude/mcp/test/guard.test.mjs .claude/mcp/test/journey-grants.test.mjs` → `fail 0`
10. จากรากของ worktree: `git status --short` → ไม่มีไฟล์ที่แก้ค้างนอกจาก `docs/superpowers/plans/*` ที่ยังไม่ track

- [ ] **Step 11: bump เว็บ 26.9.28 + commit**

ตรวจก่อน: `grep -n '"version"' apps/web/package.json` → Expected `3:  "version": "26.9.27",` (ค่าจาก Plan 1 Task 7) · และ `git show origin/main:apps/web/package.json | grep '"version"'` — ถ้าบน `origin/main` สูงกว่า `26.9.27` แล้ว ให้ใช้เลขถัดจากค่านั้นแทน `26.9.28` ทั้งในไฟล์ ข้อความ commit และ runbook ขั้น 3

`apps/web/package.json:3` แทน `"version": "26.9.27",` ด้วย `"version": "26.9.28",`
```bash
git add apps/web/package.json
git commit -m "chore(web): bump version 26.9.28

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
(ห้าม `git push` — เปิด PR เมื่อเจ้าของสั่ง)

#### ขอบเขตที่ตั้งใจไม่ทำในแผนนี้ (ใส่ใน PR body ด้วย)

- **ตั้งใจไม่ต่อ `CONTACT_ADDED` เข้า `capture_lead` ของบอทขายในเฟส 1** — บอทขายยังไม่เปิดให้ลูกค้าจริง (whitelist 3 คน เปิดเมื่อเจ้าของสั่งเท่านั้น) จึงไม่ใส่ hook ที่ทดสอบกับลูกค้าจริงไม่ได้ · Task 6 ไม่แตะโมดูลบอทขาย · ค่า `CAPTURE_LEAD` ใน `CONTACT_ADDED_VIA` (Task 2) สงวนไว้ให้ hook ในงานแยกตอนเปิดบอท · ไม่มีเทส คิวรี่ตรวจ หรือเกณฑ์ผ่านใดในแผนนี้ที่คาดแถวจากบอทขาย
- เปลี่ยนเวลา `PAYMENT_RECEIVED` จาก `payments.updated_at` เป็น `paidDate` = PR แยก (golden ของ `GET /overdue/contracts/:id/full-timeline` เปลี่ยน)
- เฟส 2-4 ของแบบ: funnel `GET /customers/journey/funnel` · ตัวกรองขั้นในหน้ารายชื่อ · คำใบ้รวมคนเดียวกันใน POS/สร้างสัญญา · บันทึกมือ `POST/DELETE /customers/:id/journey/entries` + ชิป "รู้จักร้านจากไหน" · `messaging_referrals` / `markConversion`
- DSAR ลบเฉพาะประวัติการเดินทาง (entries + แคช) ไม่ลบแถวลูกค้า/สัญญา/ใบขาย · แคช state ถูกคำนวณกลับได้จากข้อมูลธุรกิจที่เหลือ (summary ตอนเปิดหน้า หรือ cron เมื่อลูกค้าขยับ) ซึ่งไม่มีบันทึกมือแล้ว

#### Runbook เจ้าของ — ลำดับขึ้น prod (คัดลอกไปใส่ PR body ตอนเปิด PR)

> ใช้สูตร deploy จากเครื่อง (บิล GitHub Actions ตัน):
> 1. `gcloud builds submit --project=bestchoice-prod --tag=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<SHA40> --timeout=30m .`
>    - `<SHA40>` = SHA เต็ม 40 ตัวของ commit ที่ deploy รอบนั้น: ขั้น 1 = `f76582a52ad0b432acdc80af05576ab45835aae5` · ขั้น 3 = ผลของ `git fetch origin && git rev-parse origin/main` ที่รันทันทีหลัง merge PR นี้
> 2. `gcloud run jobs update bestchoice-migrate --image=...` แล้ว `gcloud run jobs execute bestchoice-migrate --wait`
> 3. `gcloud run services update --image=` 🚨 ห้ามใช้ `gcloud run deploy` ชุดเต็ม เพราะ env/secret ของ service จะเพี้ยน
> 4. build เว็บ แล้ว `firebase deploy --only hosting:admin,hosting:shop --project bestchoice-prod`
>
> ตรวจทุกรอบด้วย `curl https://api.bestchoicephone.app/api/health` + เวอร์ชันในบันเดิลของ `https://bestchoicephone.app/`

**ลำดับห้ามสลับ:** deploy #1592/#1593 → `backfill:chat-prospects` → deploy PR นี้ → apply สิทธิ์ MCP → `backfill:customer-journey` dry-run → รันจริง

เหตุผล: `journey-state.sql` นับ "ทักครั้งแรก" จากแถว customers ของห้องแชท — ถ้ายังไม่ backfill ผู้สนใจ ห้อง ~8,991 ห้องยังไม่มีเจ้าของ CLI จะหยุดเอง (exit 1)

1. **Deploy #1592/#1593** — SHA `f76582a52ad0b432acdc80af05576ab45835aae5` (`f76582a52` · web 26.9.26)
   - ถ้า PR นี้ merge เข้า main ไปก่อน ให้ deploy รอบนี้ด้วย `f76582a52` ไม่ใช่ HEAD ของ main
   - ทำขั้น "ก่อน deploy" ตาม PR #1592 ก่อน
   - ผ่านเมื่อ health ok และบันเดิลเป็น `26.9.26`
2. **`backfill:chat-prospects`** — ตาม runbook ใน PR #1592 (นับ PSID ซ้ำก่อน)
   - dry-run:
     ```bash
     gcloud run jobs create bestchoice-backfill-chat-prospects --project=bestchoice-prod --region=asia-southeast1 \
       --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:f76582a52ad0b432acdc80af05576ab45835aae5 \
       --set-secrets=DATABASE_URL=DATABASE_URL:latest \
       --set-cloudsql-instances=bestchoice-prod:asia-southeast1:bestchoice-db \
       --command=npm --args=--prefix,apps/api,run,backfill:chat-prospects \
       --set-env-vars=EXPECTED_DB_NAME=bestchoice --max-retries=0 --task-timeout=3600s
     gcloud run jobs execute bestchoice-backfill-chat-prospects --project=bestchoice-prod --region=asia-southeast1 --wait
     ```
   - รันจริง (ช่วงเงียบ):
     ```bash
     gcloud run jobs update bestchoice-backfill-chat-prospects --project=bestchoice-prod --region=asia-southeast1 \
       --update-env-vars=CONFIRM_BACKFILL=YES_I_AM_SURE,ALLOW_PROD_BACKFILL=YES_I_AM_SURE,NODE_ENV=production
     ```
     แล้ว `execute --wait` อีกครั้ง
   - exit 2 = เปิดดู log ก่อน ไม่ใช่ล้มเสมอ
   - ผ่านเมื่อ:
     - MCP `SELECT count(*) FROM chat_rooms WHERE deleted_at IS NULL AND customer_id IS NULL` ≈ 0
     - คิวรี่ตรวจ 2 ตัวใน PR #1592 = 0 ทั้งคู่ (คิวรี่นั้นใช้ `acquisition_source`/`phone` ซึ่ง `mcp_ro` อ่านไม่ได้ ต้องรันด้วย role เจ้าของ)
3. **Deploy PR นี้** — SHA หลัง merge
   - ทันทีหลัง merge รัน `git fetch origin && git rev-parse origin/main` → ได้ SHA 40 ตัว = `<SHA40 ของขั้น 3>` ใช้ทั้ง `gcloud builds submit` ของขั้นนี้และ image ของขั้น 5
   - job `bestchoice-migrate` ต้องลง `20261002100000_customer_journey` (สร้าง 2 ตาราง + เติม `merged_into_id` จาก audit)
   - ผ่านเมื่อ health ok และบันเดิลเป็น `26.9.28`
4. **Apply สิทธิ์ MCP** — `bash .claude/mcp/setup.sh`
   - รันซ้ำได้: เช็ค IAM user ก่อนสร้าง · `CREATE ROLE` แบบ `WHERE NOT EXISTS` · REVOKE/GRANT รายตาราง
   - 🚨 ต้องทำหลังขั้น 3 เท่านั้น — ถ้าตารางยังไม่มี `REVOKE` จะ error และ `ON_ERROR_STOP` ยกเลิกทั้งไฟล์ (ไม่มีอะไรเปลี่ยน)
   - ผ่านเมื่อ (เปิด session Claude Code ใหม่แล้ว):
     - MCP ไม่เตือน ACL drift
     - `SELECT count(*) FROM customer_journey_states` อ่านได้
     - `SELECT note FROM customer_journey_entries LIMIT 1` ถูกปฏิเสธ (ถูกต้อง)
     - `SELECT count(*) FROM customers WHERE merged_into_id IS NOT NULL` เท่ากับ `SELECT count(*) FROM audit_logs WHERE action = 'CUSTOMER_PLACEHOLDER_MERGED'`
5. **`backfill:customer-journey` dry-run**
   ```bash
   gcloud run jobs create bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
     --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<SHA40 ของขั้น 3> \
     --set-secrets=DATABASE_URL=DATABASE_URL:latest \
     --set-cloudsql-instances=bestchoice-prod:asia-southeast1:bestchoice-db \
     --command=npm --args=--prefix,apps/api,run,backfill:customer-journey \
     --set-env-vars=EXPECTED_DB_NAME=bestchoice --max-retries=0 --task-timeout=3600s
   gcloud run jobs execute bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --wait
   gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="bestchoice-backfill-customer-journey"' --project=bestchoice-prod --freshness=2h --limit=200 --format='value(textPayload,jsonPayload.message)'
   ```
   - exit 0 → ไปขั้น 6
   - **exit 1** = ห้องไม่มีเจ้าของเกิน 1% → กลับไปขั้น 2 ห้ามฝืน
   - **exit 2** = จำนวน PURCHASED ≠ BOUGHT_WHERE หรือ recompute ล้มบางชุด (`[run] FAILED batch …`) → หยุด ส่ง log ให้ dev (log มีแค่ id และตัวเลข)
6. **รันจริง** (ช่วงเงียบ) — รันซ้ำได้ เพราะ `INSERT … ON CONFLICT`
   ```bash
   gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
     --update-env-vars=CONFIRM_BACKFILL=YES_I_AM_SURE,ALLOW_PROD_BACKFILL=YES_I_AM_SURE,NODE_ENV=production
   gcloud run jobs execute bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --wait
   ```
   - ผ่านเมื่อ MCP `SELECT stage, count(*) FROM customer_journey_states GROUP BY stage ORDER BY 1` มีทั้ง 5 ขั้น
   - ผลรวมใกล้ `SELECT count(*) FROM customers WHERE deleted_at IS NULL`
   - แล้วเปิดหน้า `/customers/:id` ของผู้สนใจจริงหนึ่งคน ดูแท็บ "การเดินทาง" และแถบขั้น
7. **เช้าวันถัดไป** — Sentry ไม่มี error `journey:recompute แคช PURCHASED ไม่เท่ากับ BOUGHT_WHERE` · `journey:entry-guard` คืนแรกอาจเตือนสัญญาที่ activate ก่อน deploy (ดู `contractIds` ใน extra ก่อนสรุปว่า hook พัง) · MCP `SELECT kind, count(*) FROM customer_journey_entries GROUP BY kind ORDER BY 1` เริ่มมี `CONTRACT_ACTIVATED` / `CREDIT_CHECK_OPENED_BY` / `LINE_LINKED` ตามงานจริงของวันนั้น (`CONTACT_ADDED` มาจากหน้าลูกค้า/การเติมเบอร์ของพนักงานเท่านั้น — บอทขายไม่ได้ต่อในเฟสนี้)

**ค้างให้เจ้าของตัดสิน (ไม่ได้ทำในงานนี้):**
- **grants.sql ตามโครง prod ไม่ทัน** 6 ตาราง (`credit_approvals`, `payment_approval_requests`, `room_credit_analyses`, `room_credit_files`, `sale_cost_snapshots`, `trade_in_credit_redemptions`) + 3 คอลัมน์
  - ถ้าสร้างใหม่ทั้งไฟล์จะเปิดข้อความอิสระ เช่น `credit_approvals.evidence_notes`, `room_credit_analyses.result`
  - ต้องรีวิว/เพิ่ม allowlist ใน `policy.mjs` ก่อน `npm run grants`
- **ค่าที่งานนี้สมมติไว้:**
  - ขั้นที่ 2 = "รู้ตัวตน"
  - SALES ไม่เห็นกลุ่มยอดชำระ/ติดตามหนี้
  - ไม่ไล่รวมผู้ซื้อกับแชทย้อนหลัง ⇒ ตัวเลข "แชทปิดการขาย" นับตั้งแต่วันเปิดใช้

---

## คำตัดสินตอนเตรียมแผน

> แผนนี้เขียนโดย workflow หลายชั้น (ผู้เขียน 12 ส่วน → ตัวตรวจความสอดคล้อง → ผู้แก้ 2 ขั้น → ตัวตรวจรอบสุดท้าย) · ข้างล่างคือทุกการตัดสินใจที่ทำแทนเจ้าของระหว่างเตรียมแผน พร้อมต้นทุนถ้าผิด — เจ้าของอ่านแล้วสั่งย้อนข้อไหนก็ได้

### ของ controller

- **P2-R5 (ผู้แก้รอบย่อย):** `JOURNEY_DEFAULT_GROUPS` ประกาศเป็น `readonly JourneyEventGroup[]` ไม่ใช่ tuple `as const` เพราะ tuple ทำให้ `.includes(group)` ไม่ผ่าน type-check · `CAPTURE_LEAD` คงไว้ใน enum ของ `CONTACT_ADDED.via` แบบสงวน ไม่มีโค้ดเขียนในเฟสนี้ · hook ส่ง `include` เฉพาะหน้าแรก — ผิดแล้ว: ไม่มี

- **P2-R1 capture_lead ของบอทขาย ไม่อยู่ในเฟสนี้:** ถอด hook CONTACT_ADDED จาก CaptureLeadTool — บอทขายยังปิด (whitelist 3) และมีงานค้างก่อนเปิดบอทอยู่แล้ว (เบอร์ซ้ำต้อง absorb · audit AI_LEAD_CAPTURED เก็บเบอร์ดิบ) · เพิ่ม hook ตอนเปิดบอทพร้อมงานเหล่านั้น — ผิดแล้ว: ตอนเปิดบอทต้องเพิ่ม hook 1 จุด
- **P2-R2 กติกากลุ่มตาม role และป้ายชื่ออยู่ที่ shared ชุดเดียว:** `JOURNEY_DEFAULT_GROUPS` · `JOURNEY_HIDDEN_GROUPS` · `JOURNEY_LOST_REASON_LABELS` · `JOURNEY_HEARD_FROM_LABELS` export จาก `packages/shared/src/customer-journey.ts` ให้ API และเว็บ import ตัวเดียวกัน — ผิดแล้ว: ไม่มี (กันชิปบนเว็บไม่ตรงกับที่ API กรอง)
- **P2-R3 นับจำนวนต่อกลุ่มเมื่อขอเท่านั้น (`include=counts`):** แท็บการเดินทางขอ · การ์ดกิจกรรมล่าสุดไม่ขอ — ผิดแล้ว: แท็บการเดินทางยิงคำขอหนักขึ้นเฉพาะหน้าแรก
- **P2-R4 สมมติฐานแทนเจ้าของ (a)(b)(c) ใน Global Constraints ใช้ทั้งแผน** — เปลี่ยนภายหลังได้: (a) แก้กติกาขั้นใน journey-state.sql + STAGE_LABELS · (b) แก้ `JOURNEY_HIDDEN_GROUPS` จุดเดียว · (c) ไม่มีโค้ดให้แก้

### ผู้แก้ขั้นที่ 1 (Task 1–9)

- BOT_HANDOFF stores `reasonCode: z.enum(HANDOFF_REASON_CODES)` instead of the checker's `tags: piiSafeCode[]` — why: every reason passed to initiateHandoff is a code literal (or a domain-handler string), so a closed enum is stricter than free tag strings and cannot hold names; data keys are exactly ['priority','reasonCode']; a spec guards the literal map against message-router drift — cost if wrong: a new reason text shows as OTHER until the map is extended.
- Removed PII_LOOKING_PATTERN and piiSafeCode from journey-data-schemas.ts — why: once tags are gone there is no free-text field for them to guard, and a digit-run check would wrongly reject real contract numbers such as BCP2609-00042 — cost if wrong: the phase-3 manual-note DTO must bring its own digit-run check.
- contractNumber regex is /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/ instead of the checker's /^[A-Z0-9-]{1,32}$/ — why: covers the generateContractNumber format (BCP2609-00042) and imported legacy numbers, and still blocks spaces and Thai free text — cost if wrong: a legacy number with other characters stores data=null plus a Sentry warning, while the entry itself is kept.
- Chose to extend Task 2's schemas (checker option A) rather than strip hook keys; PLACEHOLDER_MERGED dropped the unused optional placeholderId; CONTACT_ADDED.via and LINE_LINKED.via are required — why: the hooks always send them and the extra keys are PII-free — cost if wrong: a future caller that omits via gets data=null plus a warning.
- Writer-level proof of the data contract is one real-DB table test in Task 2 covering all 9 SYSTEM kinds, plus sanitizeJourneyData assertions in the unit specs of Tasks 5 and 6 (the writer stores sanitized.data), rather than a DB spec per hook — why: the same guarantee without seeding contracts and credit checks in every hook task — cost if wrong: a hook that builds data outside the tested builders could drift unnoticed.
- CONTACT_ADDED and LINE_LINKED dedupe keys include the customer id as it was at write time — why: the global rule 'not bound to the customer' exists to avoid unique collisions when entries move on merge; that id is immutable (it equals originCustomerId), so there is still no collision — cost if wrong: none for uniqueness; the key simply names the original placeholder.
- Split of old task 8: Task 3 has recompute, recomputeAll and purchasedParity plus journey-state.sql; Task 9 overwrites journey-state.service.ts to add hasActivitySince, activeCustomerIdsSince and contractsMissingActivationEntry plus the two activity SQL files — why: those three are only consumed by summary and the crons; the CLI (Task 10) only needs recompute — cost if wrong: Task 9 rewrites a file Task 3 created (its full content is given, so no merge is needed).
- counts are computed by default on the first page (no cursor), not behind include — why: web Task 12 (old 11) sends only limit/cursor/groups and reads first?.counts. The first page scans every role-visible source once with limit max(limit,100) and cuts the page from the same results via slice; this is safe because finalizeSource sorts then truncates, so a smaller limit gives a prefix. counts cover the from/to window with unique ids, capped at 100 — cost if wrong: the first page runs all 8 sources, and a capped chip understates (≥100).
- include=summary attaches the summary only on the first page; if summary answers a redirect (the customer was merged mid-request) it is not attached — why: keeps the response type honest — cost if wrong: an overview card loaded during a merge shows no stage strip until the next request.
- CustomerJourneyModule stays registered in app.module once, by Task 2; Task 8 no longer edits app.module (old task 7 would have added a second registration at :18/:199) and instead asserts `grep -c CustomerJourneyModule src/app.module.ts` = 2 — cost if wrong: none.
- Task 8's payment events carry actor {type:'STAFF', id: actorUserId} (previously null) and collections CALL events add the caller id — why: the checker asked to map ContractEventRow.actorUserId; there is no name for payments, so only the id — cost if wrong: the web shows STAFF without a name for payments.
- CONTACT_ADDED from capture_lead is written only when the primary phone goes from blank to present, including creating a new customer with a phone, and the actor is BOT; handoffs the sales bot flags itself (the handoff_to_human tool, and the lead_captured flag set by capture_lead) are not recorded as BOT_HANDOFF and are listed as out of scope in Task 6 — cost if wrong: the timeline misses those two handoff paths. — **ถูกแทนด้วย P2-R1 (ถอด hook ออก)**
- Renamed code comments that looked like task cross-references to another plan: 'P2 Task 4 — voice memo' in contract-event-sources.ts became 'P2 (Customer 360)', and '(Task 10)' in the line-oa.service comment became '(แผน chat-prospects)' — why: every 'Task X' in the fixed sections must use the new Plan 2 numbers — cost if wrong: none (comments only; the golden test is unaffected).
- verify_fixed.py flags 'STAFF_EDIT' and 'OTP_VERIFY' in fixed task-02.md: they are intentional, inside the negative test that proves the old enum values are rejected with via:invalid_enum_value (codes confirmed against zod 3.25.76).

### ผู้แก้ขั้นที่ 2 (Task 10–13)

- needs change in Task 6: CaptureLeadTool already writes CONTACT_ADDED via CAPTURE_LEAD (Steps 15-16, SalesBotModule imports CustomerJourneyModule), but the brief says capture_lead is out of scope because the bot is not enabled. I did not touch Task 6. Task 13 treats it as out of scope for verification and the runbook (expects 0 rows) and says the hook starts collecting when the bot is enabled. If the code itself should go, drop Task 6 Steps 15-16, capture-lead.journey.spec.ts and the SalesBotModule import. Cost if wrong: an untested-in-prod hook path plus one extra module import. — **ถูกแทนด้วย P2-R1 (ถอด hook ออก)**
- needs change in Task 8 (or Task 1): HIDDEN_GROUPS and DEFAULT_JOURNEY_GROUPS are private to customer-journey.service.ts, so Task 12 has to mirror them (JOURNEY_HIDDEN_GROUPS, DEFAULT_EXCLUDED_GROUPS). Better: export both from @installment/shared so the API and web share one list. Cost if wrong: web chips drift from API filtering when the owner decides assumption (b). — **ถูกแทนด้วย P2-R2 (ย้ายไป shared)**
- Task 10 does not use JourneyStateService.recomputeAll(). One failing batch throws and ends the whole run with no failure count, which conflicts with R20 (keep going, count failures, exit 2). The CLI keeps its own (createdAt,id) keyset and calls recompute(ids). Cost: two batch loops over customers exist (the service's id-keyset for cron, the CLI's for backfill).
- Task 12 does not use include=summary. The stage strip shows on every tab, so it fetches /summary separately under the Global Constraints key ['customer-journey-summary', id]. Cost: one extra request when the journey tab is open.
- Group labels follow the design's eventCatalog ('แชท/ติดต่อ'), not old Task 11's meta ('แชท'). Collections chip labels are unchanged because they use their own DEFAULT_CHIPS.
- Checker hit in fixed Task 2 (STAFF_EDIT / OTP_VERIFY) is a false positive. Both appear only in negative tests asserting the schema rejects the old enum values, so no change is needed.
- LOST_REASON_LABELS stays in the web (no shared lost-reason constant exists, and lost is manual-only in phase 3). Unknown codes render just 'หลุด'. Phase 3 should move the codes to shared. Cost: the labels could fall out of step with the phase-3 DTO. — **ถูกแทนด้วย P2-R2 (ย้ายไป shared)**
- Task 12 anchors Plan 1 files by text, not line numbers. Plan 1 is still being executed in this worktree (files modified today), and I verified the anchors against the current files. Expected result for the page test is 'Plan 1 tests + 7 new, failed 0' rather than a fixed count.
- DSAR (Task 13) hard-deletes only customer_journey_entries (customerId or originCustomerId in the owner + absorbed ids) and customer_journey_states, inside the DSAR transaction. It never deletes customers, contracts or sales. States can be rebuilt later from the remaining business data, which no longer includes manual notes. This follows the design ('DSAR DELETION: ลบ entries ของคนนั้น').
- For FK violations in existing spec cleanup that Step 10 may surface, Task 13 gives a concrete fix (deleteMany on entries before customer.deleteMany, committed separately with the file path jest prints). I couldn't know those spec paths in advance without running the suite.
