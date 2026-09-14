# ผู้สนใจจากแชท — แผนงานฝั่ง API + migration + backfill (Plan 1 ของ 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทุกห้องแชท (Facebook / LINE ร้าน / LINE การเงิน / TikTok / เว็บ) มีเจ้าของเป็นแถว `customers` แบบ "ผู้สนใจอัตโนมัติ" ตั้งแต่ทักมา — หนึ่งคนหนึ่งแถวต่อช่องทาง — รวมเข้าลูกค้าตัวจริงได้เมื่อรู้เบอร์/ผูก LINE และย้อนหลังห้องเดิมทั้งหมดได้ด้วย CLI

**Architecture:** โมดูลใหม่ `chat-prospects` (3 บริการ: สร้าง placeholder ต่อคน · รวม placeholder → คนจริง · คำใบ้อาจเป็นคนเดียวกัน) ถูกเรียกจากจุดสร้างห้องเดิม 2 จุด และจากทุกทางที่ห้อง/LINE ถูกผูกกับลูกค้า · คอลัมน์ `customers.phone` เปลี่ยนเป็น nullable แล้วให้คอมไพเลอร์ชี้จุดที่ต้องใส่ด่าน · แท็บลูกค้า/ผู้สนใจใช้ตัวกรองเดิม เพิ่มแค่ธง `chatPlaceholder` KPI "มาจากแชท" และตัวกรอง "ที่มา" ทั้งสองแท็บ · หน้าจอ (การ์ดแผงขวา ฟอร์มเพิ่มเบอร์ ปุ่มรวม) อยู่ใน **Plan 2** หลัง PR นี้ merge

**Tech Stack:** NestJS 10 + Prisma (PostgreSQL) · jest (`--runInBand`) · `packages/shared` (vitest, ต้อง build ก่อน API เห็น export ใหม่) · advisory lock ของ Postgres

**Spec:** `docs/superpowers/specs/2026-09-13-chat-prospects-design.md` (commit `a484ab4aa`) — อ่านคู่กันเสมอ

## Global Constraints

- ทำงานใน worktree `BESTCHOICE/.claude/worktrees/feat+chat-prospects` branch `feat/chat-prospects` (deps ติดตั้งแล้ว, Prisma client generate แล้ว) — **ห้าม `cd` ไป checkout หลัก ห้าม `git add -A`** (หลาย session ใช้ repo เดียวกัน)
- คำสั่งทดสอบ API รันจาก `apps/api`: `npx jest <path> --runInBand` · typecheck: `npx tsc --noEmit -p tsconfig.json` (baseline = 0 error) · lint เฉพาะไฟล์: `npx eslint <files>` (**ห้าม `npm run lint` ของ apps/api — มี `--fix`**)
- spec ที่ลงท้าย `.db.spec.ts` ต่อฐานจริงผ่าน `DATABASE_URL` (ฐานทดสอบชื่อ `test_db` ที่ apply migration ของแผนนี้แล้ว) — รันแยก: `DATABASE_URL=postgresql://…/test_db npx jest <file> --runInBand`
- `packages/shared` ถูก import เป็น `@installment/shared` จาก `dist/` ⇒ หลังแก้ shared ต้อง `npm run build -w packages/shared` (รันจาก root worktree) ก่อนรัน jest/tsc ของ API
- นิยามคงที่ (ห้ามเปลี่ยนชื่อ): placeholder = `acquisitionSource` ขึ้นต้น `CHAT_` **และ** `phone == null` **และ** `nationalId == null` · ค่า `acquisitionSource` = `'CHAT_' + ChatChannel` (`CHAT_FACEBOOK` `CHAT_LINE_SHOP` `CHAT_LINE_FINANCE` `CHAT_TIKTOK` `CHAT_WEB`) · ชื่อ fallback = `<ป้ายช่องทาง> #<รหัสผู้ใช้ 4 ตัวท้าย>` (`Facebook #a1b2`, `LINE #…`, `TikTok #…`, `เว็บ #…`)
- ข้อความ error ภาษาไทย ตามสเปค: ทำสัญญา/ใบขาย/ใบจองกับคนไม่มีเบอร์ → `BadRequestException('ลูกค้ายังไม่มีเบอร์โทร กรุณาเติมเบอร์ก่อน…')`
- ทุก task: เขียนเทสก่อน (แดง) → โค้ดน้อยที่สุด (เขียว) → commit ทันที · commit message ภาษาไทย ลงท้าย `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- ห้ามแตะ `apps/web` ในแผนนี้ ยกเว้น `apps/web/package.json` version (Task 18)

---

## ผังไฟล์ (สร้าง/แก้)

| หน้าที่ | ไฟล์ |
|---|---|
| ค่าที่มา + normalize ชื่อ (ใช้ร่วม API/เว็บ) | `packages/shared/src/customer-sort.ts` (+ `customer-sort.chat-source.spec.ts`) |
| schema + migration | `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261001100000_chat_prospects_phone_nullable/migration.sql` |
| นิยาม placeholder (pure) | `apps/api/src/modules/chat-prospects/chat-placeholder.ts` (+ `.spec.ts`) |
| สร้างผู้สนใจอัตโนมัติต่อคน | `apps/api/src/modules/chat-prospects/chat-prospect.service.ts` (+ `.spec.ts`, `.db.spec.ts`) |
| รวม placeholder → คนจริง | `apps/api/src/modules/chat-prospects/customer-merge.service.ts` (+ `.spec.ts`) |
| คำใบ้อาจเป็นคนเดียวกัน | `apps/api/src/modules/chat-prospects/same-person.service.ts` (+ `.spec.ts`) |
| โมดูล | `apps/api/src/modules/chat-prospects/chat-prospects.module.ts` |
| จุดสร้างห้อง | `apps/api/src/modules/chat-engine/services/room-manager.service.ts`, `apps/api/src/modules/chatbot-finance/services/chat-room.service.ts` |
| จุดผูก LINE | `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts`, `apps/api/src/modules/line-oa/services/line-customer-link.service.ts`, `apps/api/src/modules/line-oa/liff-api.service.ts` |
| กติกาที่เคยถือว่า "ผูกแล้ว = ลูกค้าจริง" | `apps/api/src/modules/staff-chat/services/session-ops.service.ts`, `prepare-offer.service.ts` (+ `prepare-offer.policy.ts` ใหม่), `chat-commerce.service.ts`, `apps/api/src/modules/sales-bot/tools/capture-lead.tool.ts` |
| อ่าน/กรอง/KPI | `apps/api/src/modules/customers/services/customer-query.service.ts`, `customers.controller.ts` (endpoint รวม), `customer-write.service.ts` (ห้ามล้างเบอร์), `apps/api/src/modules/staff-chat/staff-chat.controller.ts` (room detail + dismiss) |
| phone nullable — 11 ไฟล์ | ดู Task 3 |
| backfill | `apps/api/src/cli/backfill-chat-prospects.cli.ts` (+ `backfill-chat-prospects.spec.ts`), `apps/api/package.json` |

การต่อโมดูล Nest: `ChatProspectsModule` ไม่ import อะไร (PrismaModule และ AuditModule เป็น `@Global()`) ⇒ ไม่มีวงจร · โมดูลที่ต้อง `imports: [ChatProspectsModule]`: `ChatEngineModule`, `ChatbotFinanceModule`, `StaffChatModule`, `CustomersModule`, `LineOaModule` · `RoomManagerService` รับบริการใหม่แบบ `@Optional()` เพื่อไม่ทำ spec เดิมที่ `new RoomManagerService(prisma, storage)` พัง

---

### Task 1: ค่าที่มา `CHAT_<ช่องทาง>` + normalize ชื่อ ใน packages/shared

**Files:**
- Modify: `packages/shared/src/customer-sort.ts` (ต่อท้ายไฟล์ หลัง `chatLogoOf` บรรทัด ~110)
- Test: `packages/shared/src/customer-sort.chat-source.spec.ts`

**Interfaces:**
- Produces: `CHAT_SOURCE_PREFIX: 'CHAT_'` · `chatSourceOf(channel: string): string` · `chatSourceChannel(source: string | null | undefined): string | null` · `THAI_NAME_PREFIXES: readonly string[]` · `normalizePersonName(raw: string | null | undefined): string` — ทุก task หลังจากนี้ import จาก `@installment/shared`

- [ ] **Step 1: เขียนเทสที่ยังแดง**

`packages/shared/src/customer-sort.chat-source.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { chatSourceOf, chatSourceChannel, normalizePersonName, CHAT_SOURCE_PREFIX, chatLogoOf } from './customer-sort';

describe('ที่มาจากแชท CHAT_<ช่องทาง>', () => {
  it('ประกอบ/แยกค่าที่มาได้ครบทุกช่องทาง', () => {
    expect(CHAT_SOURCE_PREFIX).toBe('CHAT_');
    expect(chatSourceOf('LINE_SHOP')).toBe('CHAT_LINE_SHOP');
    expect(chatSourceChannel('CHAT_LINE_SHOP')).toBe('LINE_SHOP');
    expect(chatSourceChannel('CHAT_FACEBOOK')).toBe('FACEBOOK');
    expect(chatLogoOf(chatSourceChannel('CHAT_LINE_FINANCE')!)).toBe('LINE');
  });
  it('ค่าที่ไม่ใช่ CHAT_ คืน null (AI_CHAT / WALK_IN / null / ว่าง)', () => {
    expect(chatSourceChannel('AI_CHAT')).toBeNull();
    expect(chatSourceChannel('WALK_IN')).toBeNull();
    expect(chatSourceChannel(null)).toBeNull();
    expect(chatSourceChannel('CHAT_')).toBeNull();
  });
});

describe('normalizePersonName', () => {
  it('ตัดช่องว่างซ้ำ/หัวท้าย ไม่สนตัวพิมพ์', () => {
    expect(normalizePersonName('  สมชาย   ใจดี ')).toBe('สมชาย ใจดี');
    expect(normalizePersonName('Somchai JAIDEE')).toBe('somchai jaidee');
  });
  it('ตัดคำนำหน้าไทย ทั้งแบบมีและไม่มีช่องว่าง (นางสาว ต้องชนะ นาง)', () => {
    expect(normalizePersonName('นาย สมชาย ใจดี')).toBe('สมชาย ใจดี');
    expect(normalizePersonName('นางสาวสมหญิง ใจดี')).toBe('สมหญิง ใจดี');
    expect(normalizePersonName('นางฟ้า')).toBe('นางฟ้า'); // ชื่อจริงที่ขึ้นต้นเหมือนคำนำหน้าแต่ไม่มีอะไรตาม ห้ามตัด
  });
  it('ค่าว่าง/null คืนสตริงว่าง', () => {
    expect(normalizePersonName(null)).toBe('');
    expect(normalizePersonName('   ')).toBe('');
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าแดง**

Run (จาก root worktree): `npx vitest run packages/shared/src/customer-sort.chat-source.spec.ts`
Expected: FAIL — `chatSourceOf is not a function` (export ยังไม่มี)

- [ ] **Step 3: เขียนโค้ด**

ต่อท้าย `packages/shared/src/customer-sort.ts`:
```ts
/** ที่มาของผู้สนใจอัตโนมัติจากแชท — เก็บช่องทางจริงติดตัว (`CHAT_LINE_SHOP` ≠ `CHAT_LINE_FINANCE`) แม้ห้องถูกลบ */
export const CHAT_SOURCE_PREFIX = 'CHAT_';

export function chatSourceOf(channel: string): string {
  return CHAT_SOURCE_PREFIX + channel;
}

/** `CHAT_LINE_SHOP` → `LINE_SHOP` · ค่าที่ไม่ได้ขึ้นต้น CHAT_ (AI_CHAT, WALK_IN, null) → null */
export function chatSourceChannel(source: string | null | undefined): string | null {
  if (!source || !source.startsWith(CHAT_SOURCE_PREFIX)) return null;
  const channel = source.slice(CHAT_SOURCE_PREFIX.length);
  return channel.length > 0 ? channel : null;
}

/** คำนำหน้าที่ตัดออกก่อนเทียบชื่อ — เรียงยาวก่อน ไม่งั้น "นาง" กิน "นางสาว" */
export const THAI_NAME_PREFIXES = ['นางสาว', 'นาง', 'นาย'] as const;

/**
 * ทำชื่อให้เทียบกันได้: trim · ยุบช่องว่างซ้ำ · ตัดคำนำหน้าไทย (มีหรือไม่มีช่องว่างหลังคำนำหน้าก็ได้
 * แต่ต้องมีตัวอักษรตามหลัง — "นางฟ้า" คือชื่อ ไม่ใช่ นาง+ฟ้า) · ตัวพิมพ์เล็ก
 * ใช้เฉพาะ "เทียบตรงกันเป๊ะ" เท่านั้น ไม่ทำ fuzzy (สเปค 3.6)
 */
export function normalizePersonName(raw: string | null | undefined): string {
  let name = (raw ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
  for (const prefix of THAI_NAME_PREFIXES) {
    if (name.startsWith(prefix + ' ') && name.length > prefix.length + 1) {
      name = name.slice(prefix.length + 1).trim();
      break;
    }
    // ไม่มีช่องว่าง: ตัดเฉพาะเมื่อส่วนที่เหลือมีช่องว่างอยู่ (= ชื่อ+นามสกุล) กัน "นางฟ้า"
    if (name.startsWith(prefix) && name.length > prefix.length && name.slice(prefix.length).includes(' ')) {
      name = name.slice(prefix.length).trim();
      break;
    }
  }
  return name.toLowerCase();
}
```

- [ ] **Step 4: รันเทสให้เขียว แล้ว build shared**

Run: `npx vitest run packages/shared/src/customer-sort.chat-source.spec.ts` → Expected: PASS (7 tests)
Run: `npm run build -w packages/shared` → Expected: จบโดยไม่มี error (ไฟล์ `packages/shared/dist/customer-sort.js` มี `chatSourceOf`)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/customer-sort.ts packages/shared/src/customer-sort.chat-source.spec.ts
git commit -m "feat(shared): ค่าที่มา CHAT_<ช่องทาง> + normalizePersonName สำหรับผู้สนใจจากแชท" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: schema + migration (`phone` nullable, `dismissed_same_person_ids`)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` — บรรทัด 905 (`phone String` ใน `model Customer`) และ `model ChatRoom` (ต่อจาก `pictureUrl`)
- Create: `apps/api/prisma/migrations/20261001100000_chat_prospects_phone_nullable/migration.sql`

**Interfaces:**
- Produces: `Customer.phone: string | null` · `ChatRoom.dismissedSamePersonIds: string[]` (Prisma type)

- [ ] **Step 1: แก้ schema**

`apps/api/prisma/schema.prisma` ใน `model Customer` เปลี่ยน
```prisma
  phone              String
```
เป็น
```prisma
  phone              String?   // null = ผู้สนใจอัตโนมัติจากแชทที่ยังไม่รู้เบอร์ (สเปค 2026-09-13-chat-prospects) — ห้ามล้างกลับเป็น null ผ่าน API
```
ใน `model ChatRoom` ต่อจากบรรทัด `pictureUrl  String? @map("picture_url")` เพิ่ม
```prisma
  /// คำใบ้ "อาจเป็นคนเดียวกัน" ที่พนักงานกด "ไม่ใช่" แล้ว — ไม่ถามซ้ำ (customer id)
  dismissedSamePersonIds String[] @default([]) @map("dismissed_same_person_ids")
```

- [ ] **Step 2: เขียน migration**

`apps/api/prisma/migrations/20261001100000_chat_prospects_phone_nullable/migration.sql`:
```sql
-- ผู้สนใจจากแชท (docs/superpowers/specs/2026-09-13-chat-prospects-design.md)
-- 1) เบอร์ว่างได้เฉพาะแถว placeholder ที่สร้างจากห้องแชท — โค้ดกันไม่ให้ล้างเบอร์ของคนที่มีเบอร์แล้ว
ALTER TABLE "customers" ALTER COLUMN "phone" DROP NOT NULL;

-- 2) คำใบ้ "อาจเป็นคนเดียวกัน" ที่ถูกกด "ไม่ใช่" (เก็บ customer id) — ไม่ถามซ้ำ
ALTER TABLE "chat_rooms" ADD COLUMN "dismissed_same_person_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
```

- [ ] **Step 3: generate + apply ลงฐานทดสอบ + typecheck**

Run (จาก `apps/api`): `npx prisma generate` → Expected: `Generated Prisma Client`
Run: `DATABASE_URL=postgresql://…/test_db npx prisma migrate deploy` → Expected: `1 migration applied` — ถ้าฐานสร้างด้วย `db push` แล้ว `migrate deploy` ล้ม (P3009) ให้ apply ตรง: `psql "$DATABASE_URL" -f prisma/migrations/20261001100000_chat_prospects_phone_nullable/migration.sql`
Run: `npx tsc --noEmit -p tsconfig.json` → Expected: **20 errors ใน 11 ไฟล์** (รายการตรงกับ Task 3) — นี่คือรายการงานของ Task 3 ไม่ใช่ความผิดพลาด

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261001100000_chat_prospects_phone_nullable/migration.sql
git commit -m "feat(prisma): customers.phone nullable + chat_rooms.dismissed_same_person_ids (ผู้สนใจจากแชท)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: ใส่ด่านทั้ง 20 จุดที่เคยสมมติว่ามีเบอร์เสมอ

**Files (แก้ทั้งหมด 12 ไฟล์ — 11 จาก tsc + type กลาง 1):**
- Modify: `apps/api/src/utils/test-data-markers.ts:41-45,67-69`
- Modify: `apps/api/src/modules/contracts/contract-snapshot.service.ts:26`
- Modify: `apps/api/src/modules/contracts/services/contract-lifecycle.service.ts:104-107`
- Modify: `apps/api/src/modules/sales/services/sale-writer.service.ts:313-315`
- Modify: `apps/api/src/modules/bookings/bookings.service.ts:~268` (ก่อน test-data fence บรรทัด 271)
- Modify: `apps/api/src/modules/chatbot-finance/services/verification.service.ts:136-215`
- Modify: `apps/api/src/modules/chatbot-finance/services/slip-processing.service.ts:155,233,253`
- Modify: `apps/api/src/modules/overdue/dunning-engine.service.ts:212,436`
- (คอมไพล์ผ่านเองหลังแก้ type กลาง: `contract-exchange.service.ts:152`, `defect-exchange.service.ts:232`, `sale-creation.service.ts:202`, `trade-in-lifecycle.service.ts:511`)
- Test: `apps/api/src/utils/test-data-markers.spec.ts` (มีอยู่แล้ว — เพิ่มเคส), `apps/api/src/modules/contracts/services/contract-lifecycle.phone-guard.spec.ts` (ใหม่)

**Interfaces:**
- Consumes: `Customer.phone: string | null` (Task 2)
- Produces: กติกา "ทำสัญญา/ใบขาย/ใบจอง ต้องมีเบอร์" — ข้อความ error คงที่ตามด้านล่าง ให้ Plan 2 (เว็บ) แสดงตรง ๆ

- [ ] **Step 1: เทสแดง — `isTestCustomer` รับเบอร์ null ได้**

ต่อท้าย `apps/api/src/utils/test-data-markers.spec.ts` (ถ้าไม่มีไฟล์นี้ ให้สร้างด้วย describe ด้านล่างอย่างเดียว):
```ts
import { isTestCustomer, TEST_CUSTOMER_ADDRESS } from './test-data-markers';

describe('isTestCustomer กับผู้สนใจอัตโนมัติ (phone null)', () => {
  it('เบอร์ null + ที่อยู่ปกติ = ไม่ใช่ลูกค้าทดสอบ (ไม่ throw)', () => {
    expect(isTestCustomer({ name: 'สมชาย ใจดี', phone: null, addressCurrent: null })).toBe(false);
  });
  it('เบอร์ null แต่ที่อยู่ทดสอบ = ลูกค้าทดสอบ', () => {
    expect(isTestCustomer({ name: 'x', phone: null, addressCurrent: TEST_CUSTOMER_ADDRESS })).toBe(true);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าแดง**

Run: `npx jest src/utils/test-data-markers.spec.ts --runInBand`
Expected: FAIL — type error `phone: null` ไม่เข้ากับ `string` (ts-jest) หรือ `Cannot read properties of null (reading 'startsWith')`

- [ ] **Step 3: แก้ type กลาง + 3 จุดใน chatbot-finance/overdue**

`apps/api/src/utils/test-data-markers.ts`:
```ts
export interface TestSideCustomer {
  name: string;
  phone: string | null; // ผู้สนใจอัตโนมัติจากแชทยังไม่มีเบอร์
  addressCurrent: string | null;
}
// …
export function isTestCustomer(c: TestSideCustomer): boolean {
  return c.addressCurrent === TEST_CUSTOMER_ADDRESS || (c.phone ?? '').startsWith(TEST_DOC_PREFIX);
}
```

`apps/api/src/modules/contracts/contract-snapshot.service.ts` บรรทัด 26: `phone: string;` → `phone: string | null;`

`apps/api/src/modules/chatbot-finance/services/slip-processing.service.ts` ทั้ง 3 จุด (155, 233, 253): `customerPhone: contract.customer.phone,` → `customerPhone: contract.customer.phone ?? undefined,`

`apps/api/src/modules/overdue/dunning-engine.service.ts` บรรทัด 212 และ 436: `rule.channel === 'LINE' ? payment.contract.customer.phone : undefined,` → `rule.channel === 'LINE' ? (payment.contract.customer.phone ?? undefined) : undefined,` (บรรทัด 436 ใช้ `contract.customer.phone` แทน `payment.contract.customer.phone`)

`apps/api/src/modules/chatbot-finance/services/verification.service.ts` — หลังบล็อก `if (!customer) { … throw … }` (บรรทัด ~150) และก่อน `this.clearLookupFails(...)` เพิ่ม:
```ts
    // ค้นด้วยเบอร์เจอแถวนี้ แปลว่ามีเบอร์แน่ — กันชนิด null จาก schema (ผู้สนใจจากแชทไม่มีทางถูกค้นเจอทางนี้)
    const customerPhone = customer.phone;
    if (!customerPhone) {
      this.recordLookupFail(params.lineUserId);
      throw new BadRequestException(
        'ไม่พบเบอร์โทรนี้ในระบบค่ะ กรุณาตรวจสอบเบอร์โทร หรือติดต่อสาขา 063-134-6356',
      );
    }
```
แล้วแทน `customer.phone` ที่เหลือ 6 จุดในฟังก์ชันเดียวกัน (upsert `create.phone`, `update.phone`, `maskPhone(...)` ×3, `sendSmsFromQueue(...)`) ด้วย `customerPhone`

- [ ] **Step 4: เทสแดง — สร้างสัญญา/ใบขาย/ใบจองกับคนไม่มีเบอร์ต้องถูกปฏิเสธ**

`apps/api/src/modules/contracts/services/contract-lifecycle.phone-guard.spec.ts`:
```ts
import { assertCustomerHasPhone } from './contract-create-policy';

describe('assertCustomerHasPhone — ผู้สนใจจากแชทที่ยังไม่มีเบอร์ทำเอกสารไม่ได้', () => {
  it('เบอร์ null → BadRequest ข้อความบอกให้เติมเบอร์ก่อน', () => {
    expect(() => assertCustomerHasPhone({ phone: null }, 'ทำสัญญา')).toThrow('ลูกค้ายังไม่มีเบอร์โทร กรุณาเติมเบอร์ก่อนทำสัญญา');
  });
  it('เบอร์ว่าง → ปฏิเสธเหมือนกัน', () => {
    expect(() => assertCustomerHasPhone({ phone: '' }, 'เปิดใบขาย')).toThrow('ลูกค้ายังไม่มีเบอร์โทร กรุณาเติมเบอร์ก่อนเปิดใบขาย');
  });
  it('มีเบอร์ → ผ่านและคืนเบอร์ (narrow เป็น string)', () => {
    expect(assertCustomerHasPhone({ phone: '0812345678' }, 'ทำสัญญา')).toBe('0812345678');
  });
});
```

- [ ] **Step 5: รันให้เห็นว่าแดง**

Run: `npx jest src/modules/contracts/services/contract-lifecycle.phone-guard.spec.ts --runInBand`
Expected: FAIL — `assertCustomerHasPhone` ไม่ถูก export

- [ ] **Step 6: เขียนด่าน + เรียกใช้ 3 จุด**

ต่อท้าย `apps/api/src/modules/contracts/services/contract-create-policy.ts`:
```ts
/**
 * ผู้สนใจอัตโนมัติจากแชท (สเปค 2026-09-13-chat-prospects) มี phone = null —
 * เอกสารที่ต้องติดต่อลูกค้าได้ (สัญญา ใบขาย ใบจอง) ต้องบังคับให้เติมเบอร์ก่อน
 * `action` = คำที่ต่อท้ายข้อความ เช่น 'ทำสัญญา' 'เปิดใบขาย' 'จองสินค้า'
 */
export function assertCustomerHasPhone(customer: { phone: string | null }, action: string): string {
  if (!customer.phone) {
    throw new BadRequestException(`ลูกค้ายังไม่มีเบอร์โทร กรุณาเติมเบอร์ก่อน${action}`);
  }
  return customer.phone;
}
```
(ไฟล์นี้ import `BadRequestException` จาก `@nestjs/common` อยู่แล้ว — ถ้ายัง ให้เพิ่ม)

`contract-lifecycle.service.ts` หลังบรรทัด `if (!customerData) throw new BadRequestException('ไม่พบลูกค้า');` เพิ่ม `assertCustomerHasPhone(customerData, 'ทำสัญญา');` (import จาก `./contract-create-policy`)

`sale-writer.service.ts` หลังบรรทัด `if (!customer) throw new BadRequestException('ไม่พบลูกค้า');` (บรรทัด ~314) เพิ่ม `assertCustomerHasPhone(customer, 'เปิดใบขาย');` (import จาก `../../contracts/services/contract-create-policy`)

`bookings.service.ts` ในเมธอดสร้างใบจอง ก่อนบล็อก `// test-data fence` (บรรทัด ~271 ที่ใช้ตัวแปร `customer`) เพิ่ม `assertCustomerHasPhone(customer, 'จองสินค้า');` (import จาก `../contracts/services/contract-create-policy`)

- [ ] **Step 7: typecheck ต้องกลับเป็น 0 + เทสที่แตะเขียว**

Run: `npx tsc --noEmit -p tsconfig.json` → Expected: **0 errors**
Run: `npx jest src/utils/test-data-markers.spec.ts src/modules/contracts/services/contract-lifecycle.phone-guard.spec.ts src/modules/chatbot-finance/services src/modules/overdue src/modules/sales src/modules/bookings src/modules/contracts --runInBand` → Expected: PASS ทั้งหมด (suite ที่ต้อง `DATABASE_URL` และแดงมาก่อนอยู่แล้วเพราะ `Environment variable not found: DATABASE_URL` ไม่นับ — เทียบกับ `git stash`-free baseline: รันชุดเดียวกันบน `origin/main` ก่อนถ้าไม่แน่ใจ)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/utils/test-data-markers.ts apps/api/src/utils/test-data-markers.spec.ts apps/api/src/modules/contracts/contract-snapshot.service.ts apps/api/src/modules/contracts/services/contract-create-policy.ts apps/api/src/modules/contracts/services/contract-lifecycle.service.ts apps/api/src/modules/contracts/services/contract-lifecycle.phone-guard.spec.ts apps/api/src/modules/sales/services/sale-writer.service.ts apps/api/src/modules/bookings/bookings.service.ts apps/api/src/modules/chatbot-finance/services/verification.service.ts apps/api/src/modules/chatbot-finance/services/slip-processing.service.ts apps/api/src/modules/overdue/dunning-engine.service.ts
git commit -m "feat(api): รองรับ customers.phone = null — ด่านเบอร์ก่อนทำสัญญา/ใบขาย/ใบจอง + ข้ามการส่งเมื่อไม่มีเบอร์" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: นิยาม placeholder (pure helper)

**Files:**
- Create: `apps/api/src/modules/chat-prospects/chat-placeholder.ts`
- Test: `apps/api/src/modules/chat-prospects/chat-placeholder.spec.ts`

**Interfaces:**
- Produces:
  - `interface PlaceholderShape { acquisitionSource: string | null; phone: string | null; nationalId: string | null }`
  - `isChatPlaceholder(c: PlaceholderShape): boolean`
  - `placeholderName(channel: ChatChannel, externalKey: string, displayName?: string | null): string`
  - `CHANNEL_LABEL: Record<ChatChannel, string>` (`FACEBOOK:'Facebook'`, `LINE_SHOP:'LINE'`, `LINE_FINANCE:'LINE'`, `TIKTOK:'TikTok'`, `WEB:'เว็บ'`)

- [ ] **Step 1: เทสแดง**

`apps/api/src/modules/chat-prospects/chat-placeholder.spec.ts`:
```ts
import { ChatChannel } from '@prisma/client';
import { isChatPlaceholder, placeholderName } from './chat-placeholder';

describe('isChatPlaceholder', () => {
  it('CHAT_* + ไม่มีเบอร์ + ไม่มีเลขบัตร = placeholder', () => {
    expect(isChatPlaceholder({ acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null })).toBe(true);
    expect(isChatPlaceholder({ acquisitionSource: 'CHAT_LINE_SHOP', phone: null, nationalId: null })).toBe(true);
  });
  it('เติมเบอร์หรือเลขบัตรแล้ว = ผู้สนใจธรรมดา ไม่ใช่ placeholder', () => {
    expect(isChatPlaceholder({ acquisitionSource: 'CHAT_FACEBOOK', phone: '0812345678', nationalId: null })).toBe(false);
    expect(isChatPlaceholder({ acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: '1234567890123' })).toBe(false);
  });
  it('ที่มาอื่น (บอท / เดินเข้าร้าน / null) ไม่ใช่ placeholder แม้เบอร์ว่าง', () => {
    expect(isChatPlaceholder({ acquisitionSource: 'AI_CHAT', phone: null, nationalId: null })).toBe(false);
    expect(isChatPlaceholder({ acquisitionSource: null, phone: null, nationalId: null })).toBe(false);
  });
});

describe('placeholderName', () => {
  it('มีชื่อจากห้อง → ใช้ชื่อนั้น (trim)', () => {
    expect(placeholderName(ChatChannel.FACEBOOK, 'psid-1234567890', '  สมชาย ใจดี ')).toBe('สมชาย ใจดี');
  });
  it('ไม่มีชื่อ → ป้ายช่องทาง + รหัส 4 ตัวท้าย', () => {
    expect(placeholderName(ChatChannel.FACEBOOK, 'psid-1234567890', null)).toBe('Facebook #7890');
    expect(placeholderName(ChatChannel.LINE_SHOP, 'Uabc123def', '')).toBe('LINE #3def');
    expect(placeholderName(ChatChannel.TIKTOK, 'tt-9', undefined)).toBe('TikTok #tt-9');
    expect(placeholderName(ChatChannel.WEB, 'visitor-55aa', '   ')).toBe('เว็บ #55aa');
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าแดง**

Run: `npx jest src/modules/chat-prospects/chat-placeholder.spec.ts --runInBand` → Expected: FAIL — `Cannot find module './chat-placeholder'`

- [ ] **Step 3: เขียนโค้ด**

`apps/api/src/modules/chat-prospects/chat-placeholder.ts`:
```ts
import { ChatChannel } from '@prisma/client';
import { CHAT_SOURCE_PREFIX } from '@installment/shared';

/**
 * "ผู้สนใจอัตโนมัติ" (placeholder) — แถว customers ที่ระบบสร้างจากห้องแชทเอง
 * (docs/superpowers/specs/2026-09-13-chat-prospects-design.md §3.1)
 * นิยามเดียว ใช้ทุกที่: ที่มาขึ้นต้น CHAT_ และยังไม่มีทั้งเบอร์และเลขบัตร
 * พอเติมอย่างใดอย่างหนึ่ง = ผู้สนใจธรรมดา (ที่มายังเป็น CHAT_* เพื่อการตลาด)
 */
export interface PlaceholderShape {
  acquisitionSource: string | null;
  phone: string | null;
  nationalId: string | null;
}

export function isChatPlaceholder(c: PlaceholderShape): boolean {
  return !!c.acquisitionSource?.startsWith(CHAT_SOURCE_PREFIX) && c.phone == null && c.nationalId == null;
}

export const CHANNEL_LABEL: Record<ChatChannel, string> = {
  FACEBOOK: 'Facebook',
  LINE_SHOP: 'LINE',
  LINE_FINANCE: 'LINE',
  TIKTOK: 'TikTok',
  WEB: 'เว็บ',
};

/** ชื่อของ placeholder: ชื่อโปรไฟล์จากห้อง ไม่มีก็ "<ป้ายช่องทาง> #<รหัสผู้ใช้ 4 ตัวท้าย>" */
export function placeholderName(channel: ChatChannel, externalKey: string, displayName?: string | null): string {
  const trimmed = (displayName ?? '').trim();
  if (trimmed) return trimmed;
  return `${CHANNEL_LABEL[channel]} #${externalKey.slice(-4)}`;
}
```

- [ ] **Step 4: รันให้เขียว**

Run: `npx jest src/modules/chat-prospects/chat-placeholder.spec.ts --runInBand` → Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/chat-prospects/chat-placeholder.ts apps/api/src/modules/chat-prospects/chat-placeholder.spec.ts
git commit -m "feat(chat-prospects): นิยาม placeholder + ชื่อ fallback ต่อช่องทาง" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `ChatProspectService.ensureForRoom` — หนึ่งคนหนึ่งแถว ล็อกต่อคน

**Files:**
- Create: `apps/api/src/modules/chat-prospects/chat-prospect.service.ts`
- Create: `apps/api/src/modules/chat-prospects/chat-prospects.module.ts`
- Test: `apps/api/src/modules/chat-prospects/chat-prospect.service.spec.ts` (mock) และ `chat-prospect.service.db.spec.ts` (ฐานจริง — race)

**Interfaces:**
- Consumes: `isChatPlaceholder`, `placeholderName` (Task 4) · `chatSourceOf` (Task 1)
- Produces:
  - `class ChatProspectService { constructor(prisma: PrismaService) }`
  - `ensureForRoom(roomId: string): Promise<{ customerId: string; created: boolean } | null>` — null = ห้องไม่มี/ถูกลบ/ไม่มีรหัสผู้ใช้
  - `syncNameFromRoom(roomId: string): Promise<boolean>` — true = อัปเดตชื่อ placeholder ตามชื่อห้อง
  - `ChatProspectsModule` (providers + exports: `ChatProspectService`)

- [ ] **Step 1: เทสแดง (mock)**

`apps/api/src/modules/chat-prospects/chat-prospect.service.spec.ts`:
```ts
import { ChatProspectService } from './chat-prospect.service';

function makeTx() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    chatRoom: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    customerLineLink: { findUnique: jest.fn().mockResolvedValue(null) },
    customer: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
}

const ROOM = {
  id: 'room-1', channel: 'FACEBOOK', lineUserId: null, externalUserId: 'psid-1234567890',
  customerId: null, displayName: 'สมชาย ใจดี', createdAt: new Date('2026-09-12T07:32:00Z'), deletedAt: null,
};

describe('ChatProspectService.ensureForRoom', () => {
  let tx: ReturnType<typeof makeTx>;
  let prisma: any;
  let service: ChatProspectService;

  beforeEach(() => {
    tx = makeTx();
    prisma = { chatRoom: { findUnique: jest.fn() }, $transaction: jest.fn((fn: any) => fn(tx)) };
    service = new ChatProspectService(prisma);
  });

  it('ห้องมีเจ้าของแล้ว → คืน customerId เดิม ไม่เปิดทรานแซกชัน', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({ ...ROOM, customerId: 'cust-9' });
    await expect(service.ensureForRoom('room-1')).resolves.toEqual({ customerId: 'cust-9', created: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ห้องใหม่ Facebook → ล็อกต่อคน สร้าง placeholder ด้วยชื่อห้อง ที่มา CHAT_FACEBOOK PSID createdAt ของห้อง แล้วผูกห้อง', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue(ROOM);
    tx.chatRoom.findUnique.mockResolvedValue({ customerId: null });
    tx.chatRoom.findFirst.mockResolvedValue(null);
    tx.customer.create.mockResolvedValue({ id: 'cust-new' });

    await expect(service.ensureForRoom('room-1')).resolves.toEqual({ customerId: 'cust-new', created: true });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1); // pg_advisory_xact_lock(hashtext('FACEBOOK:psid-1234567890'))
    expect(tx.customer.create).toHaveBeenCalledWith({
      data: {
        name: 'สมชาย ใจดี', phone: null, acquisitionSource: 'CHAT_FACEBOOK',
        createdAt: ROOM.createdAt, facebookUserId: 'psid-1234567890', facebookName: 'สมชาย ใจดี',
      },
      select: { id: true },
    });
    expect(tx.chatRoom.update).toHaveBeenCalledWith({ where: { id: 'room-1' }, data: { customerId: 'cust-new' } });
  });

  it('ห้องไม่มีชื่อ → ชื่อ fallback "Facebook #7890" และไม่ตั้ง facebookName', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({ ...ROOM, displayName: null });
    tx.chatRoom.findUnique.mockResolvedValue({ customerId: null });
    tx.chatRoom.findFirst.mockResolvedValue(null);
    tx.customer.create.mockResolvedValue({ id: 'cust-new' });
    await service.ensureForRoom('room-1');
    expect(tx.customer.create.mock.calls[0][0].data).toMatchObject({ name: 'Facebook #7890', facebookName: null });
  });

  it('คนเดิมมีห้องอื่นในช่องทางเดียวกันที่ผูกแล้ว → ใช้คนนั้น ไม่สร้างใหม่', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue(ROOM);
    tx.chatRoom.findUnique.mockResolvedValue({ customerId: null });
    tx.chatRoom.findFirst.mockResolvedValue({ customerId: 'cust-old' });
    await expect(service.ensureForRoom('room-1')).resolves.toEqual({ customerId: 'cust-old', created: false });
    expect(tx.customer.create).not.toHaveBeenCalled();
    expect(tx.chatRoom.update).toHaveBeenCalledWith({ where: { id: 'room-1' }, data: { customerId: 'cust-old' } });
  });

  it('ห้อง LINE ร้าน: ลูกค้าที่ผูก lineIdShop ไว้แล้ว → ใช้คนนั้น (ช่องโหว่เดิม getOrCreateRoom เช็คแค่ CustomerLineLink)', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({ ...ROOM, channel: 'LINE_SHOP', lineUserId: 'Uabc123def', externalUserId: null });
    tx.chatRoom.findUnique.mockResolvedValue({ customerId: null });
    tx.chatRoom.findFirst.mockResolvedValue(null);
    tx.customer.findFirst.mockResolvedValue({ id: 'cust-line' });
    await expect(service.ensureForRoom('room-1')).resolves.toEqual({ customerId: 'cust-line', created: false });
    expect(tx.customer.findFirst).toHaveBeenCalledWith({ where: { lineIdShop: 'Uabc123def', deletedAt: null }, select: { id: true } });
    expect(tx.customer.create).not.toHaveBeenCalled();
  });

  it('ห้อง LINE การเงินที่มี CustomerLineLink → ใช้คนจาก link ก่อนคอลัมน์', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({ ...ROOM, channel: 'LINE_FINANCE', lineUserId: 'Ufin', externalUserId: null });
    tx.chatRoom.findUnique.mockResolvedValue({ customerId: null });
    tx.chatRoom.findFirst.mockResolvedValue(null);
    tx.customerLineLink.findUnique.mockResolvedValue({ customerId: 'cust-link' });
    await expect(service.ensureForRoom('room-1')).resolves.toEqual({ customerId: 'cust-link', created: false });
    expect(tx.customerLineLink.findUnique).toHaveBeenCalledWith({
      where: { lineUserId_channel: { lineUserId: 'Ufin', channel: 'FINANCE' } }, select: { customerId: true },
    });
    expect(tx.customer.findFirst).not.toHaveBeenCalled();
  });

  it('ห้อง LINE ร้านสร้าง placeholder ด้วยที่มา CHAT_LINE_SHOP และไม่แตะช่อง facebook*', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({ ...ROOM, channel: 'LINE_SHOP', lineUserId: 'Uabc123def', externalUserId: null, displayName: 'มิ้นท์' });
    tx.chatRoom.findUnique.mockResolvedValue({ customerId: null });
    tx.chatRoom.findFirst.mockResolvedValue(null);
    tx.customer.create.mockResolvedValue({ id: 'cust-new' });
    await service.ensureForRoom('room-1');
    expect(tx.customer.create.mock.calls[0][0].data).toEqual({
      name: 'มิ้นท์', phone: null, acquisitionSource: 'CHAT_LINE_SHOP', createdAt: ROOM.createdAt,
    });
  });

  it('ระหว่างรอล็อก มีคนผูกห้องไปแล้ว → คืนคนนั้น ไม่สร้างซ้ำ', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue(ROOM);
    tx.chatRoom.findUnique.mockResolvedValue({ customerId: 'cust-raced' });
    await expect(service.ensureForRoom('room-1')).resolves.toEqual({ customerId: 'cust-raced', created: false });
    expect(tx.customer.create).not.toHaveBeenCalled();
  });

  it('ห้องถูกลบ / ไม่มีรหัสผู้ใช้ → null', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({ ...ROOM, deletedAt: new Date() });
    await expect(service.ensureForRoom('room-1')).resolves.toBeNull();
    prisma.chatRoom.findUnique.mockResolvedValue({ ...ROOM, externalUserId: null });
    await expect(service.ensureForRoom('room-1')).resolves.toBeNull();
  });
});

describe('ChatProspectService.syncNameFromRoom', () => {
  it('placeholder ที่ยังชื่อ fallback → ตั้งชื่อตามห้อง (+facebookName)', async () => {
    const prisma: any = {
      chatRoom: { findUnique: jest.fn().mockResolvedValue({
        id: 'room-1', channel: 'FACEBOOK', lineUserId: null, externalUserId: 'psid-1234567890', displayName: 'สมชาย ใจดี',
        customer: { id: 'cust-1', name: 'Facebook #7890', acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null, deletedAt: null },
      }) },
      customer: { update: jest.fn().mockResolvedValue({}) },
    };
    const service = new ChatProspectService(prisma);
    await expect(service.syncNameFromRoom('room-1')).resolves.toBe(true);
    expect(prisma.customer.update).toHaveBeenCalledWith({ where: { id: 'cust-1' }, data: { name: 'สมชาย ใจดี', facebookName: 'สมชาย ใจดี' } });
  });
  it('คนที่มีเบอร์แล้ว หรือชื่อถูกแก้มือแล้ว → ไม่แตะ', async () => {
    const base = { id: 'room-1', channel: 'FACEBOOK', lineUserId: null, externalUserId: 'psid-1234567890', displayName: 'สมชาย ใจดี' };
    const prisma: any = { chatRoom: { findUnique: jest.fn() }, customer: { update: jest.fn() } };
    const service = new ChatProspectService(prisma);
    prisma.chatRoom.findUnique.mockResolvedValue({ ...base, customer: { id: 'c', name: 'Facebook #7890', acquisitionSource: 'CHAT_FACEBOOK', phone: '0812345678', nationalId: null, deletedAt: null } });
    await expect(service.syncNameFromRoom('room-1')).resolves.toBe(false);
    prisma.chatRoom.findUnique.mockResolvedValue({ ...base, customer: { id: 'c', name: 'สมชาย ใจดี (ร้าน)', acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null, deletedAt: null } });
    await expect(service.syncNameFromRoom('room-1')).resolves.toBe(false);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าแดง**

Run: `npx jest src/modules/chat-prospects/chat-prospect.service.spec.ts --runInBand` → Expected: FAIL — `Cannot find module './chat-prospect.service'`

- [ ] **Step 3: เขียนบริการ + โมดูล**

`apps/api/src/modules/chat-prospects/chat-prospect.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel, Prisma } from '@prisma/client';
import { chatSourceOf } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { isChatPlaceholder, placeholderName } from './chat-placeholder';

type Tx = Prisma.TransactionClient;
const LINE_CHANNELS: ReadonlySet<ChatChannel> = new Set([ChatChannel.LINE_SHOP, ChatChannel.LINE_FINANCE]);

/**
 * ผู้สนใจอัตโนมัติจากแชท — หนึ่งคน (ช่องทาง + รหัสผู้ใช้) = หนึ่งแถว customers
 * (docs/superpowers/specs/2026-09-13-chat-prospects-design.md §3.2)
 *
 * ล็อกต่อคนด้วย pg_advisory_xact_lock(hashtext('<channel>:<key>')) ในทรานแซกชันเดียวกับการหา/สร้าง
 * ⇒ ข้อความแรกสองชิ้นที่มาพร้อมกัน (พิมพ์+รูป) ได้ลูกค้าคนเดียว แม้จะเผลอได้สองห้อง
 * (ห้องซ้ำเป็นบั๊กเดิมของ getOrCreateRoom ที่ findFirst ไม่มี lock — ไม่แก้ในรอบนี้)
 */
@Injectable()
export class ChatProspectService {
  private readonly logger = new Logger(ChatProspectService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureForRoom(roomId: string): Promise<{ customerId: string; created: boolean } | null> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { id: true, channel: true, lineUserId: true, externalUserId: true, customerId: true, displayName: true, createdAt: true, deletedAt: true },
    });
    if (!room || room.deletedAt) return null;
    if (room.customerId) return { customerId: room.customerId, created: false };
    const externalKey = room.lineUserId ?? room.externalUserId;
    if (!externalKey) return null;

    return this.prisma.$transaction(async (tx) => {
      // ล็อกต่อคน — ปล่อยเองตอนทรานแซกชันจบ
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${room.channel}:${externalKey}`}))`;
      // อ่านซ้ำหลังได้ล็อก: อีกคำขออาจผูกห้องนี้ไปแล้วระหว่างรอ
      const fresh = await tx.chatRoom.findUnique({ where: { id: roomId }, select: { customerId: true } });
      if (fresh?.customerId) return { customerId: fresh.customerId, created: false };

      const existingId = await this.findExistingCustomerId(tx, room.channel, externalKey);
      if (existingId) {
        await tx.chatRoom.update({ where: { id: roomId }, data: { customerId: existingId } });
        return { customerId: existingId, created: false };
      }

      const created = await tx.customer.create({
        data: {
          name: placeholderName(room.channel, externalKey, room.displayName),
          phone: null,
          acquisitionSource: chatSourceOf(room.channel),
          createdAt: room.createdAt, // วันที่เพิ่ม = วันทักครั้งแรก
          ...(room.channel === ChatChannel.FACEBOOK
            ? { facebookUserId: externalKey, facebookName: room.displayName?.trim() || null }
            : {}),
        },
        select: { id: true },
      });
      await tx.chatRoom.update({ where: { id: roomId }, data: { customerId: created.id } });
      this.logger.log(`[prospect] created ${created.id} for room ${roomId} (${room.channel})`);
      return { customerId: created.id, created: true };
    });
  }

  /**
   * หาคนเดิมก่อนสร้าง (สเปค 3.2 ข้อ 3): (ก) ห้องอื่นของคนเดียวกันในช่องทางนี้ที่ผูกแล้ว
   * (ข) LINE: CustomerLineLink แล้วค่อยคอลัมน์ lineIdShop / lineIdFinance — ฝั่ง LINE ร้านผูกที่คอลัมน์
   * (line-customer-link.service.ts selfLinkByPhone) ไม่ใช่ตาราง link
   */
  private async findExistingCustomerId(tx: Tx, channel: ChatChannel, externalKey: string): Promise<string | null> {
    const isLine = LINE_CHANNELS.has(channel);
    const sibling = await tx.chatRoom.findFirst({
      where: {
        deletedAt: null,
        channel,
        customerId: { not: null },
        customer: { is: { deletedAt: null } },
        ...(isLine ? { lineUserId: externalKey } : { externalUserId: externalKey }),
      },
      orderBy: { createdAt: 'asc' },
      select: { customerId: true },
    });
    if (sibling?.customerId) return sibling.customerId;
    if (!isLine) return null;

    const linkChannel = channel === ChatChannel.LINE_SHOP ? 'SHOP' : 'FINANCE';
    const link = await tx.customerLineLink.findUnique({
      where: { lineUserId_channel: { lineUserId: externalKey, channel: linkChannel } },
      select: { customerId: true },
    });
    if (link) return link.customerId;

    const byColumn = await tx.customer.findFirst({
      where: { ...(channel === ChatChannel.LINE_SHOP ? { lineIdShop: externalKey } : { lineIdFinance: externalKey }), deletedAt: null },
      select: { id: true },
    });
    return byColumn?.id ?? null;
  }

  /** ชื่อโปรไฟล์มาทีหลัง (mirrorOutbound สร้างห้องก่อนรู้ชื่อ) → ตั้งชื่อ placeholder ที่ยังเป็น fallback ตาม */
  async syncNameFromRoom(roomId: string): Promise<boolean> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: {
        id: true, channel: true, lineUserId: true, externalUserId: true, displayName: true,
        customer: { select: { id: true, name: true, acquisitionSource: true, phone: true, nationalId: true, deletedAt: true } },
      },
    });
    const displayName = room?.displayName?.trim();
    const customer = room?.customer;
    if (!room || !displayName || !customer || customer.deletedAt || !isChatPlaceholder(customer)) return false;
    const externalKey = room.lineUserId ?? room.externalUserId ?? '';
    if (customer.name !== placeholderName(room.channel, externalKey, null)) return false; // ถูกแก้มือแล้ว ไม่ทับ
    if (customer.name === displayName) return false;
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { name: displayName, ...(room.channel === ChatChannel.FACEBOOK ? { facebookName: displayName } : {}) },
    });
    return true;
  }
}
```

`apps/api/src/modules/chat-prospects/chat-prospects.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ChatProspectService } from './chat-prospect.service';

/** ผู้สนใจจากแชท — ไม่ import โมดูลอื่น (PrismaModule/AuditModule เป็น @Global) จึงไม่มีวงจร */
@Module({
  providers: [ChatProspectService],
  exports: [ChatProspectService],
})
export class ChatProspectsModule {}
```

- [ ] **Step 4: รันให้เขียว**

Run: `npx jest src/modules/chat-prospects/chat-prospect.service.spec.ts --runInBand` → Expected: PASS (11 tests)

- [ ] **Step 5: เทสฐานจริง — สองคำขอพร้อมกันได้คนเดียว**

`apps/api/src/modules/chat-prospects/chat-prospect.service.db.spec.ts`:
```ts
import { PrismaClient, ChatChannel } from '@prisma/client';
import { ChatProspectService } from './chat-prospect.service';

/**
 * พิสูจน์ advisory lock ต่อคน (สเปค §3.2 / ผลตรวจ Blocker 1): ห้อง Facebook สองห้องของ PSID เดียวกัน
 * (บั๊กเดิมของ findFirst ไม่มี lock ทำให้เกิดได้) เรียก ensureForRoom พร้อมกัน → ลูกค้า 1 คน
 * ต้องรันกับ Postgres จริง: DATABASE_URL=…/test_db npx jest <ไฟล์นี้> --runInBand
 */
describe('ChatProspectService.ensureForRoom (real DB, race)', () => {
  const prisma = new PrismaClient();
  const service = new ChatProspectService(prisma as any);
  const psid = `prospect-race-${Date.now()}`;
  const roomIds: string[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const room = await prisma.chatRoom.create({
        data: { channel: ChatChannel.FACEBOOK, externalUserId: psid, displayName: 'race spec' },
      });
      roomIds.push(room.id);
    }
  });

  afterAll(async () => {
    const customerIds = (await prisma.chatRoom.findMany({ where: { id: { in: roomIds } }, select: { customerId: true } }))
      .map((r) => r.customerId).filter((id): id is string => !!id);
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
  });

  it('สองห้องพร้อมกัน → customerId เดียวกัน สร้างแค่ครั้งเดียว และ customers ของ PSID นี้มี 1 แถว', async () => {
    const results = await Promise.all(roomIds.map((id) => service.ensureForRoom(id)));
    expect(results[0]?.customerId).toBeDefined();
    expect(results[1]?.customerId).toBe(results[0]?.customerId);
    expect(results.filter((r) => r?.created).length).toBe(1);
    const count = await prisma.customer.count({ where: { facebookUserId: psid, deletedAt: null } });
    expect(count).toBe(1);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: results[0]!.customerId } });
    expect(customer.phone).toBeNull();
    expect(customer.acquisitionSource).toBe('CHAT_FACEBOOK');
    expect(customer.name).toBe('race spec');
  });

  it('รันซ้ำบนห้องที่ผูกแล้ว → ไม่สร้างเพิ่ม (idempotent สำหรับ backfill)', async () => {
    const before = await prisma.customer.count({ where: { facebookUserId: psid, deletedAt: null } });
    const again = await service.ensureForRoom(roomIds[0]);
    expect(again?.created).toBe(false);
    expect(await prisma.customer.count({ where: { facebookUserId: psid, deletedAt: null } })).toBe(before);
  });
});
```

Run: `DATABASE_URL=postgresql://…/test_db npx jest src/modules/chat-prospects/chat-prospect.service.db.spec.ts --runInBand` → Expected: PASS (2 tests) — ถ้าล้มที่ `pg_advisory_xact_lock` แปลว่า `$queryRaw` ถูกเขียนเป็น `$executeRaw` (SELECT ต้องใช้ `$queryRaw`)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/chat-prospects/chat-prospect.service.ts apps/api/src/modules/chat-prospects/chat-prospect.service.spec.ts apps/api/src/modules/chat-prospects/chat-prospect.service.db.spec.ts apps/api/src/modules/chat-prospects/chat-prospects.module.ts
git commit -m "feat(chat-prospects): ChatProspectService — ผู้สนใจอัตโนมัติหนึ่งคนต่อช่องทาง ล็อกต่อคน + หาคนเดิมจาก LINE link/คอลัมน์" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: เรียกจากจุดสร้างห้อง — `RoomManagerService.getOrCreateRoom` (ทุกช่องทาง)

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/room-manager.service.ts:102-110` (constructor), `:150-228` (getOrCreateRoom)
- Modify: `apps/api/src/modules/chat-engine/chat-engine.module.ts:23` (imports)
- Test: `apps/api/src/modules/chat-engine/services/room-manager.service.spec.ts` (เพิ่ม provider + 3 เทส)

**Interfaces:**
- Consumes: `ChatProspectService.ensureForRoom`, `syncNameFromRoom` (Task 5)
- Produces: `getOrCreateRoom` คืน room ที่ `customerId` ถูกเติมแล้วเมื่อสร้างผู้สนใจสำเร็จ (ผู้เรียกเดิมทุกตัวได้ค่าถูกต้องโดยไม่ต้องอ่านซ้ำ)

- [ ] **Step 1: เทสแดง**

ใน `room-manager.service.spec.ts` (1) เพิ่ม import `import { ChatProspectService } from '../../chat-prospects/chat-prospect.service';` (2) ใน `beforeEach` ประกาศ `chatProspects = { ensureForRoom: jest.fn().mockResolvedValue({ customerId: 'cust-auto', created: true }), syncNameFromRoom: jest.fn().mockResolvedValue(false) };` และเพิ่ม `{ provide: ChatProspectService, useValue: chatProspects }` ใน providers (3) เพิ่ม describe:
```ts
describe('getOrCreateRoom → ผู้สนใจอัตโนมัติ', () => {
  it('ห้อง Facebook ใหม่ → เรียก ensureForRoom แล้วคืน customerId ที่ได้', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue(null);
    prisma.chatRoom.create.mockResolvedValue({ id: 'room-new', channel: ChatChannel.FACEBOOK, customerId: null, attributionId: null });
    const room = await service.getOrCreateRoom({ externalUserId: 'psid-1', channel: ChatChannel.FACEBOOK, displayName: 'สมชาย' });
    expect(chatProspects.ensureForRoom).toHaveBeenCalledWith('room-new');
    expect(room.customerId).toBe('cust-auto');
  });

  it('ห้องเดิมที่ยังไม่มีเจ้าของ → self-heal ด้วย ensureForRoom', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-old', channel: ChatChannel.FACEBOOK, status: ChatRoomStatus.ACTIVE, resolvedAt: null, customerId: null, displayName: 'สมชาย', pictureUrl: 'x', attributionId: null });
    const room = await service.getOrCreateRoom({ externalUserId: 'psid-1', channel: ChatChannel.FACEBOOK });
    expect(chatProspects.ensureForRoom).toHaveBeenCalledWith('room-old');
    expect(room.customerId).toBe('cust-auto');
  });

  it('ห้องเดิมมีเจ้าของอยู่แล้วและเพิ่งได้ชื่อ → ไม่สร้าง แต่ซิงก์ชื่อ', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-old', channel: ChatChannel.FACEBOOK, status: ChatRoomStatus.ACTIVE, resolvedAt: null, customerId: 'cust-1', displayName: null, pictureUrl: null, attributionId: null });
    prisma.chatRoom.update.mockResolvedValue({ id: 'room-old', customerId: 'cust-1', displayName: 'สมชาย', attributionId: null });
    await service.getOrCreateRoom({ externalUserId: 'psid-1', channel: ChatChannel.FACEBOOK, displayName: 'สมชาย' });
    expect(chatProspects.ensureForRoom).not.toHaveBeenCalled();
    expect(chatProspects.syncNameFromRoom).toHaveBeenCalledWith('room-old');
  });

  it('ensureForRoom ล้ม → ห้องยังถูกคืนตามปกติ (best-effort)', async () => {
    chatProspects.ensureForRoom.mockRejectedValue(new Error('db down'));
    prisma.chatRoom.findFirst.mockResolvedValue(null);
    prisma.chatRoom.create.mockResolvedValue({ id: 'room-new', channel: ChatChannel.FACEBOOK, customerId: null, attributionId: null });
    const room = await service.getOrCreateRoom({ externalUserId: 'psid-1', channel: ChatChannel.FACEBOOK });
    expect(room.id).toBe('room-new');
    expect(room.customerId).toBeNull();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าแดง**

Run: `npx jest src/modules/chat-engine/services/room-manager.service.spec.ts --runInBand` → Expected: 4 เทสใหม่ FAIL (`ensureForRoom` ไม่ถูกเรียก / customerId เป็น null)

- [ ] **Step 3: เขียนโค้ด**

`room-manager.service.ts` — constructor เพิ่มพารามิเตอร์ท้ายสุด (แบบ optional เพื่อไม่ทำ `new RoomManagerService(prisma, storage)` ใน `.db.spec` เดิมพัง):
```ts
import { ChatProspectService } from '../../chat-prospects/chat-prospect.service';
// …
    @Optional() @Inject(forwardRef(() => MessageRouterService))
    private messageRouter?: MessageRouterService,
    @Optional()
    private chatProspects?: ChatProspectService,
  ) {}
```
(ถ้าคลาสยังไม่มี `private readonly logger = new Logger(RoomManagerService.name);` ให้เพิ่ม และ import `Logger` จาก `@nestjs/common`)

เพิ่มเมธอด private:
```ts
  /** ผู้สนใจอัตโนมัติ (สเปค 3.2) — best-effort: ห้องต้องไม่ล้มเพราะสร้างผู้สนใจไม่ได้ กิ่ง existing เก็บตกให้ตอนคนทักกลับ */
  private async ensureProspect(roomId: string): Promise<string | null> {
    if (!this.chatProspects) return null;
    try {
      const result = await this.chatProspects.ensureForRoom(roomId);
      return result?.customerId ?? null;
    } catch (err) {
      this.logger.warn(`[prospect] room ${roomId}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
```
ใน `getOrCreateRoom` กิ่ง `existing` — แทนที่ท้ายกิ่ง (ตั้งแต่ `const room = Object.keys(updateData).length > 0 ? … : existing;` จนถึง `return room;`) ด้วย:
```ts
      let room =
        Object.keys(updateData).length > 0
          ? await this.prisma.chatRoom.update({ where: { id: existing.id }, data: updateData })
          : existing;
      if (!room.customerId) {
        const customerId = await this.ensureProspect(room.id);
        if (customerId) room = { ...room, customerId };
      } else if (updateData.displayName && this.chatProspects) {
        await this.chatProspects.syncNameFromRoom(room.id).catch((err) =>
          this.logger.warn(`[prospect] sync name ${room.id}: ${err instanceof Error ? err.message : err}`));
      }
      // ลูกค้าเก่ากดโฆษณา/ลิงก์ซ้ำ — บันทึกที่มาครั้งล่าสุดให้ห้องเดิมด้วย (เดิมบันทึกเฉพาะห้องใหม่)
      if (params.attribution?.utmSource) {
        await this.linkAttribution(room.id, params.attribution, room.attributionId);
      }
      return room;
```
กิ่งสร้างใหม่ — หลัง `linkAttribution` ก่อน `return room;` (บรรทัด ~226):
```ts
    if (!room.customerId) {
      const customerId = await this.ensureProspect(room.id);
      if (customerId) return { ...room, customerId };
    }
    return room;
```

`chat-engine.module.ts`: `imports: [forwardRef(() => StaffChatModule), ChatProspectsModule],` (+ `import { ChatProspectsModule } from '../chat-prospects/chat-prospects.module';`)

- [ ] **Step 4: รันให้เขียว (ทั้ง spec เดิมของ room-manager ต้องยังผ่าน)**

Run: `npx jest src/modules/chat-engine --runInBand` → Expected: PASS ทั้งหมด
Run: `npx tsc --noEmit -p tsconfig.json` → Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/chat-engine/services/room-manager.service.ts apps/api/src/modules/chat-engine/services/room-manager.service.spec.ts apps/api/src/modules/chat-engine/chat-engine.module.ts
git commit -m "feat(chat-engine): ห้องใหม่ทุกช่องทางได้ผู้สนใจอัตโนมัติ + self-heal ห้องเก่า + ซิงก์ชื่อเมื่อโปรไฟล์มาทีหลัง" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: จุดสร้างห้องที่สอง — บอท LINE การเงิน `ChatRoomService.getOrCreate`

**Files:**
- Modify: `apps/api/src/modules/chatbot-finance/services/chat-room.service.ts:15-70`
- Modify: `apps/api/src/modules/chatbot-finance/chatbot-finance.module.ts:52` (imports)
- Test: `apps/api/src/modules/chatbot-finance/services/chat-room.service.prospect.spec.ts` (ใหม่)

**Interfaces:**
- Consumes: `ChatProspectService.ensureForRoom` (Task 5)
- Produces: ห้อง LINE การเงินที่ไม่มี `CustomerLineLink` ได้ placeholder ที่มา `CHAT_LINE_FINANCE` (หรือคนเดิมจาก `lineIdFinance`)

- [ ] **Step 1: เทสแดง**

`apps/api/src/modules/chatbot-finance/services/chat-room.service.prospect.spec.ts`:
```ts
import { ChatChannel } from '@prisma/client';
import { ChatRoomService } from './chat-room.service';

describe('ChatRoomService.getOrCreate → ผู้สนใจอัตโนมัติ (LINE การเงิน)', () => {
  let prisma: any;
  let lineClient: any;
  let chatProspects: any;
  let service: ChatRoomService;

  beforeEach(() => {
    prisma = {
      chatRoom: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
      customerLineLink: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    lineClient = { getUserProfile: jest.fn().mockResolvedValue({ displayName: 'มิ้นท์', pictureUrl: null }) };
    chatProspects = { ensureForRoom: jest.fn().mockResolvedValue({ customerId: 'cust-auto', created: true }) };
    service = new ChatRoomService(prisma, lineClient, undefined, chatProspects);
  });

  it('ไม่มี link → สร้างห้องแล้วเรียก ensureForRoom คืน customerId ที่ได้', async () => {
    prisma.chatRoom.create.mockResolvedValue({ id: 'room-fin', channel: ChatChannel.LINE_FINANCE, customerId: null });
    const room = await service.getOrCreate('Ufin1');
    expect(chatProspects.ensureForRoom).toHaveBeenCalledWith('room-fin');
    expect(room.customerId).toBe('cust-auto');
  });

  it('มี link อยู่แล้ว → ห้องผูกลูกค้าจริงตั้งแต่สร้าง ไม่เรียก ensureForRoom', async () => {
    prisma.customerLineLink.findUnique.mockResolvedValue({ customerId: 'cust-real' });
    prisma.chatRoom.create.mockResolvedValue({ id: 'room-fin', channel: ChatChannel.LINE_FINANCE, customerId: 'cust-real' });
    const room = await service.getOrCreate('Ufin1');
    expect(chatProspects.ensureForRoom).not.toHaveBeenCalled();
    expect(room.customerId).toBe('cust-real');
  });

  it('ensureForRoom ล้ม → ยังคืนห้อง', async () => {
    chatProspects.ensureForRoom.mockRejectedValue(new Error('x'));
    prisma.chatRoom.create.mockResolvedValue({ id: 'room-fin', channel: ChatChannel.LINE_FINANCE, customerId: null });
    await expect(service.getOrCreate('Ufin1')).resolves.toMatchObject({ id: 'room-fin' });
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าแดง**

Run: `npx jest src/modules/chatbot-finance/services/chat-room.service.prospect.spec.ts --runInBand` → Expected: FAIL (constructor รับ 3 อาร์กิวเมนต์ / ensureForRoom ไม่ถูกเรียก)

- [ ] **Step 3: เขียนโค้ด**

`chat-room.service.ts` — constructor:
```ts
import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { ChatProspectService } from '../../chat-prospects/chat-prospect.service';
// …
  private readonly logger = new Logger(ChatRoomService.name);
  constructor(
    private prisma: PrismaService,
    private lineClient: LineFinanceClientService,
    @Optional() @Inject(forwardRef(() => StaffChatGateway))
    private staffChatGateway?: StaffChatGateway,
    @Optional()
    private chatProspects?: ChatProspectService,
  ) {}
```
ใน `getOrCreate` แทน `return this.prisma.chatRoom.create({ … });` (ท้ายเมธอด) ด้วย:
```ts
    const room = await this.prisma.chatRoom.create({
      data: {
        lineUserId,
        channel: ChatChannel.LINE_FINANCE,
        customerId: link?.customerId,
        verifiedAt: link ? new Date() : null,
        displayName: profile?.displayName ?? null,
        pictureUrl: profile?.pictureUrl ?? null,
      },
    });
    if (room.customerId || !this.chatProspects) return room;
    // ผู้สนใจอัตโนมัติ (สเปค 3.2) — best-effort; หาคนเดิมจาก lineIdFinance ให้ด้วย
    try {
      const ensured = await this.chatProspects.ensureForRoom(room.id);
      return ensured ? { ...room, customerId: ensured.customerId } : room;
    } catch (err) {
      this.logger.warn(`[prospect] room ${room.id}: ${err instanceof Error ? err.message : err}`);
      return room;
    }
```
`chatbot-finance.module.ts`: เพิ่ม `ChatProspectsModule` ใน `imports` (+ import path `../chat-prospects/chat-prospects.module`)

- [ ] **Step 4: รันให้เขียว**

Run: `npx jest src/modules/chatbot-finance --runInBand` → Expected: PASS (spec เดิม + 3 ใหม่)
Run: `npx tsc --noEmit -p tsconfig.json` → Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/chatbot-finance/services/chat-room.service.ts apps/api/src/modules/chatbot-finance/services/chat-room.service.prospect.spec.ts apps/api/src/modules/chatbot-finance/chatbot-finance.module.ts
git commit -m "feat(chatbot-finance): ห้อง LINE การเงินที่ยังไม่ผูกได้ผู้สนใจอัตโนมัติ" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `CustomerMergeService.absorbPlaceholder` — รวม placeholder → คนจริง (ขอบเขตแคบ)

**Files:**
- Create: `apps/api/src/modules/chat-prospects/customer-merge.service.ts`
- Modify: `apps/api/src/modules/chat-prospects/chat-prospects.module.ts` (เพิ่ม provider/export)
- Test: `apps/api/src/modules/chat-prospects/customer-merge.service.spec.ts`

**Interfaces:**
- Consumes: `isChatPlaceholder` (Task 4) · `lockCreditCustomer(tx, id)` จาก `apps/api/src/modules/credit-check/services/room-credit-history.ts` · `AuditService.log({ userId, action, entity, entityId, oldValue, newValue })` (`@Global` AuditModule)
- Produces:
  - `interface MergeActor { id: string; role: string }`
  - `interface AbsorbResult { placeholderId: string; targetId: string; movedRooms: number; movedCreditChecks: number }`
  - `absorbPlaceholder(placeholderId: string, targetId: string, actor: MergeActor, opts?: { allowPlaceholderTarget?: boolean }): Promise<AbsorbResult>`
  - audit action `'CUSTOMER_PLACEHOLDER_MERGED'` entity `'customer'`

- [ ] **Step 1: เทสแดง**

`apps/api/src/modules/chat-prospects/customer-merge.service.spec.ts`:
```ts
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { CustomerMergeService } from './customer-merge.service';

const PLACEHOLDER = { id: 'p1', deletedAt: null, acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null, creditCheckStatus: 'PRE_CHECK_PASSED' };
const TARGET = { id: 't1', deletedAt: null, acquisitionSource: null, phone: '0812345678', nationalId: null, creditCheckStatus: 'NONE' };
const ZERO_COUNTS = {
  contracts: 0, sales: 0, bookings: 0, reservations: 0, tradeIns: 0, onlineOrders: 0, savingPlans: 0, onlineApplications: 0,
  loyaltyPoints: 0, loyaltyRedemptions: 0, promotionUsages: 0, repairTickets: 0, otherIncomes: 0, partialPaymentLinks: 0,
  kycVerifications: 0, pdpaConsents: 0, dsarRequests: 0, lineLinks: 0, referrals: 0, reviews: 0, creditApprovals: 0,
  websiteVisits: 0, websiteSessions: 0,
};

function makeTx(overrides: { placeholder?: any; target?: any; counts?: Partial<typeof ZERO_COUNTS> } = {}) {
  const placeholder = { ...PLACEHOLDER, _count: { ...ZERO_COUNTS, ...(overrides.counts ?? {}) }, ...(overrides.placeholder ?? {}) };
  const target = { ...TARGET, ...(overrides.target ?? {}) };
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    customer: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(where.id === 'p1' ? placeholder : where.id === 't1' ? target : null)),
      update: jest.fn().mockResolvedValue({}),
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
  };
}

describe('CustomerMergeService.absorbPlaceholder', () => {
  const actor = { id: 'staff-1', role: 'SALES' };
  let audit: any;
  const build = (tx: any) => {
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    return new CustomerMergeService(prisma, audit);
  };

  it('ย้ายห้อง/ผลเช็คเครดิต/แท็ก/lead/attribution/trigger แล้ว soft-delete placeholder + audit', async () => {
    const tx = makeTx();
    const service = build(tx);
    await expect(service.absorbPlaceholder('p1', 't1', actor)).resolves.toEqual({ placeholderId: 'p1', targetId: 't1', movedRooms: 2, movedCreditChecks: 1 });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2); // ล็อกทั้งสองฝั่ง
    expect(tx.chatRoom.updateMany).toHaveBeenCalledWith({ where: { customerId: 'p1' }, data: { customerId: 't1' } });
    expect(tx.creditCheck.updateMany).toHaveBeenCalledWith({ where: { customerId: 'p1' }, data: { customerId: 't1' } });
    // แท็ก VIP ย้าย · HOT ซ้ำกับปลายทาง → soft-delete
    expect(tx.customerTag.update).toHaveBeenCalledWith({ where: { id: 'tag-a' }, data: { customerId: 't1' } });
    expect(tx.customerTag.update).toHaveBeenCalledWith({ where: { id: 'tag-b' }, data: { deletedAt: expect.any(Date) } });
    // trigger k1 ย้าย · k2 ชน unique (customerId, referenceKey) → ลบของ placeholder
    expect(tx.chatAutoTrigger.update).toHaveBeenCalledWith({ where: { id: 'tr-1' }, data: { customerId: 't1' } });
    expect(tx.chatAutoTrigger.delete).toHaveBeenCalledWith({ where: { id: 'tr-2' } });
    expect(tx.crmLead.updateMany).toHaveBeenCalledWith({ where: { customerId: 'p1' }, data: { customerId: 't1' } });
    expect(tx.adsAttribution.updateMany).toHaveBeenCalledWith({ where: { customerId: 'p1' }, data: { customerId: 't1' } });
    expect(tx.customerScore.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'p1' } });
    // สถานะเครดิต: ปลายทาง NONE, placeholder ผ่าน pre-check → คัดลอก
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { creditCheckStatus: 'PRE_CHECK_PASSED' } });
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { deletedAt: expect.any(Date) } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'staff-1', action: 'CUSTOMER_PLACEHOLDER_MERGED', entity: 'customer', entityId: 't1',
      oldValue: { placeholderId: 'p1' }, newValue: { roomIds: ['r1', 'r2'], movedCreditChecks: 1 },
    }));
  });

  it('ปลายทางมีสถานะเครดิตอยู่แล้ว → คงของปลายทาง', async () => {
    const tx = makeTx({ target: { creditCheckStatus: 'FULL_CHECK_PASSED' } });
    await build(tx).absorbPlaceholder('p1', 't1', actor);
    expect(tx.customer.update).not.toHaveBeenCalledWith({ where: { id: 't1' }, data: expect.anything() });
  });

  it('placeholder มีใบจอง → 409 บอกชื่อรายการ ไม่แตะอะไร', async () => {
    const tx = makeTx({ counts: { bookings: 1 } });
    await expect(build(tx).absorbPlaceholder('p1', 't1', actor)).rejects.toThrow(new ConflictException('รวมไม่ได้: ผู้สนใจคนนี้มีใบจอง 1 รายการ — ให้แก้ที่รายการนั้นก่อน'));
    expect(tx.chatRoom.updateMany).not.toHaveBeenCalled();
  });

  it('ต้นทางไม่ใช่ placeholder (มีเบอร์แล้ว) → 409', async () => {
    const tx = makeTx({ placeholder: { phone: '0899999999' } });
    await expect(build(tx).absorbPlaceholder('p1', 't1', actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('ปลายทางเป็น placeholder → 409 เว้นแต่ allowPlaceholderTarget (ใช้ตอนรวมห้อง)', async () => {
    const tx = makeTx({ target: { acquisitionSource: 'CHAT_LINE_SHOP', phone: null } });
    await expect(build(tx).absorbPlaceholder('p1', 't1', actor)).rejects.toBeInstanceOf(ConflictException);
    const tx2 = makeTx({ target: { acquisitionSource: 'CHAT_LINE_SHOP', phone: null } });
    await expect(build(tx2).absorbPlaceholder('p1', 't1', actor, { allowPlaceholderTarget: true })).resolves.toMatchObject({ movedRooms: 2 });
  });

  it('รวมกับตัวเอง → 400 · ไม่พบ/ถูกลบ → 404', async () => {
    const tx = makeTx();
    await expect(build(tx).absorbPlaceholder('p1', 'p1', actor)).rejects.toBeInstanceOf(BadRequestException);
    const gone = makeTx({ target: { deletedAt: new Date() } });
    await expect(build(gone).absorbPlaceholder('p1', 't1', actor)).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าแดง**

Run: `npx jest src/modules/chat-prospects/customer-merge.service.spec.ts --runInBand` → Expected: FAIL — `Cannot find module './customer-merge.service'`

- [ ] **Step 3: เขียนโค้ด**

`apps/api/src/modules/chat-prospects/customer-merge.service.ts`:
```ts
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { lockCreditCustomer } from '../credit-check/services/room-credit-history';
import { isChatPlaceholder } from './chat-placeholder';

export interface MergeActor { id: string; role: string }
export interface AbsorbResult { placeholderId: string; targetId: string; movedRooms: number; movedCreditChecks: number }

/** relation ที่ placeholder ห้ามมี (สเปค 3.3) — ชื่อ relation ใน Prisma → ป้ายไทยในข้อความ 409 */
const BLOCKING_RELATIONS = {
  contracts: 'สัญญา', sales: 'ใบขาย', bookings: 'ใบจอง', reservations: 'การจองสินค้า', tradeIns: 'รายการรับซื้อ',
  onlineOrders: 'คำสั่งซื้อออนไลน์', savingPlans: 'แผนออม', onlineApplications: 'ใบสมัครผ่อนออนไลน์',
  loyaltyPoints: 'แต้มสะสม', loyaltyRedemptions: 'การแลกแต้ม', promotionUsages: 'การใช้โปรโมชัน', repairTickets: 'ใบซ่อม',
  otherIncomes: 'รายได้อื่น', partialPaymentLinks: 'ลิงก์ชำระบางส่วน', kycVerifications: 'การยืนยันตัวตน',
  pdpaConsents: 'ความยินยอม PDPA', dsarRequests: 'คำขอ PDPA', lineLinks: 'การผูก LINE', referrals: 'คนที่แนะนำมา',
  reviews: 'รีวิว', creditApprovals: 'ผลอนุมัติเครดิต', websiteVisits: 'การเข้าเว็บ', websiteSessions: 'เซสชันเว็บ',
} as const;
type BlockingKey = keyof typeof BLOCKING_RELATIONS;
const COUNT_SELECT = Object.fromEntries(Object.keys(BLOCKING_RELATIONS).map((k) => [k, true])) as Record<BlockingKey, true>;

/**
 * รวม "ผู้สนใจอัตโนมัติจากแชท" เข้าลูกค้าตัวจริง — ทางเดียว ไม่ใช่ merge ลูกค้าทั่วไป
 * (docs/superpowers/specs/2026-09-13-chat-prospects-design.md §3.3)
 * ย้ายเฉพาะ: ห้องแชท · CreditCheck ที่ import จากห้อง (updateMany ตรง — linkRoomCreditHistory ย้ายเฉพาะ
 * ผลที่ยังไม่ import) · แท็ก · crmLeads · adsAttributions · chatAutoTriggers · แล้ว soft-delete placeholder
 */
@Injectable()
export class CustomerMergeService {
  private readonly logger = new Logger(CustomerMergeService.name);

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async absorbPlaceholder(
    placeholderId: string,
    targetId: string,
    actor: MergeActor,
    opts: { allowPlaceholderTarget?: boolean } = {},
  ): Promise<AbsorbResult> {
    if (placeholderId === targetId) throw new BadRequestException('รวมกับตัวเองไม่ได้');
    return this.prisma.$transaction(async (tx) => {
      // ล็อกทั้งสองฝั่งเรียงตาม id กัน deadlock กับ absorb สวนทาง
      for (const id of [placeholderId, targetId].sort()) await lockCreditCustomer(tx, id);
      const [placeholder, target] = await Promise.all([
        tx.customer.findUnique({
          where: { id: placeholderId },
          select: { id: true, deletedAt: true, acquisitionSource: true, phone: true, nationalId: true, creditCheckStatus: true, _count: { select: COUNT_SELECT } },
        }),
        tx.customer.findUnique({
          where: { id: targetId },
          select: { id: true, deletedAt: true, acquisitionSource: true, phone: true, nationalId: true, creditCheckStatus: true },
        }),
      ]);
      if (!placeholder || placeholder.deletedAt) throw new NotFoundException('ไม่พบผู้สนใจที่จะรวม');
      if (!target || target.deletedAt) throw new NotFoundException('ไม่พบลูกค้าปลายทาง');
      if (!isChatPlaceholder(placeholder)) {
        throw new ConflictException('รวมได้เฉพาะผู้สนใจอัตโนมัติจากแชทที่ยังไม่มีเบอร์และเลขบัตร');
      }
      if (isChatPlaceholder(target) && !opts.allowPlaceholderTarget) {
        throw new ConflictException('ปลายทางต้องเป็นลูกค้าหรือผู้สนใจที่มีเบอร์แล้ว — ผู้สนใจอัตโนมัติสองคนให้ใช้ "รวมห้องแชท"');
      }
      const blocking = (Object.keys(BLOCKING_RELATIONS) as BlockingKey[]).filter((k) => placeholder._count[k] > 0);
      if (blocking.length > 0) {
        const detail = blocking.map((k) => `${BLOCKING_RELATIONS[k]} ${placeholder._count[k]} รายการ`).join(', ');
        throw new ConflictException(`รวมไม่ได้: ผู้สนใจคนนี้มี${detail} — ให้แก้ที่รายการนั้นก่อน`);
      }

      const rooms = await tx.chatRoom.findMany({ where: { customerId: placeholderId }, select: { id: true } });
      const movedRooms = (await tx.chatRoom.updateMany({ where: { customerId: placeholderId }, data: { customerId: targetId } })).count;
      const movedCreditChecks = (await tx.creditCheck.updateMany({ where: { customerId: placeholderId }, data: { customerId: targetId } })).count;

      // แท็ก: unique [customerId, tag, deletedAt] — ที่ปลายทางมีแล้ว soft-delete แทนย้าย
      const targetTags = new Set(
        (await tx.customerTag.findMany({ where: { customerId: targetId, deletedAt: null }, select: { tag: true } })).map((t) => t.tag),
      );
      const tags = await tx.customerTag.findMany({ where: { customerId: placeholderId, deletedAt: null }, select: { id: true, tag: true } });
      for (const tag of tags) {
        await tx.customerTag.update({
          where: { id: tag.id },
          data: targetTags.has(tag.tag) ? { deletedAt: new Date() } : { customerId: targetId },
        });
      }

      await tx.crmLead.updateMany({ where: { customerId: placeholderId }, data: { customerId: targetId } });
      await tx.adsAttribution.updateMany({ where: { customerId: placeholderId }, data: { customerId: targetId } });

      // trigger: unique [customerId, referenceKey] — ตรวจชนก่อน ห้ามใช้ try/catch ใน tx (Postgres ยกเลิกทั้งทรานแซกชันเมื่อ statement ล้ม)
      const targetKeys = new Set(
        (await tx.chatAutoTrigger.findMany({ where: { customerId: targetId }, select: { referenceKey: true } })).map((t) => t.referenceKey),
      );
      const triggers = await tx.chatAutoTrigger.findMany({ where: { customerId: placeholderId }, select: { id: true, referenceKey: true } });
      for (const trigger of triggers) {
        if (targetKeys.has(trigger.referenceKey)) await tx.chatAutoTrigger.delete({ where: { id: trigger.id } });
        else await tx.chatAutoTrigger.update({ where: { id: trigger.id }, data: { customerId: targetId } });
      }
      await tx.customerScore.deleteMany({ where: { customerId: placeholderId } });

      if (target.creditCheckStatus === 'NONE' && placeholder.creditCheckStatus !== 'NONE') {
        await tx.customer.update({ where: { id: targetId }, data: { creditCheckStatus: placeholder.creditCheckStatus } });
      }
      await tx.customer.update({ where: { id: placeholderId }, data: { deletedAt: new Date() } });

      await this.audit.log({
        userId: actor.id,
        action: 'CUSTOMER_PLACEHOLDER_MERGED',
        entity: 'customer',
        entityId: targetId,
        oldValue: { placeholderId },
        newValue: { roomIds: rooms.map((r) => r.id), movedCreditChecks },
      });
      this.logger.log(`[merge] placeholder ${placeholderId} → ${targetId} rooms=${movedRooms} creditChecks=${movedCreditChecks} by ${actor.id}`);
      return { placeholderId, targetId, movedRooms, movedCreditChecks };
    });
  }
}
```
ตรวจชื่อคอลัมน์ `referenceKey` ของ `ChatAutoTrigger` ใน `prisma/schema.prisma` (บรรทัด ~5593 — `@@unique([customerId, referenceKey])` ตาม comment ใน `auto-trigger.service.ts:196`) ถ้าชื่อต่าง ให้ใช้ชื่อจริงทั้งในโค้ดและเทส

`chat-prospects.module.ts`: `providers: [ChatProspectService, CustomerMergeService], exports: [ChatProspectService, CustomerMergeService]`

- [ ] **Step 4: รันให้เขียว**

Run: `npx jest src/modules/chat-prospects --runInBand` → Expected: PASS ทั้งหมด (ไม่รวม `.db.spec` ถ้าไม่มี DATABASE_URL — รัน `--testPathIgnorePatterns db.spec` ได้)
Run: `npx tsc --noEmit -p tsconfig.json` → Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/chat-prospects/customer-merge.service.ts apps/api/src/modules/chat-prospects/customer-merge.service.spec.ts apps/api/src/modules/chat-prospects/chat-prospects.module.ts
git commit -m "feat(chat-prospects): CustomerMergeService — รวมผู้สนใจอัตโนมัติเข้าลูกค้าจริง (ย้าย 6 relation, ปฏิเสธถ้ามีเอกสารพ่วง, audit)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: ผูกห้องกับลูกค้าเดิม (`linkCustomer`) ดูด placeholder แทนโยน 409

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/room-manager.service.ts` (constructor + `linkCustomer` บรรทัด ~660-690)
- Test: `apps/api/src/modules/chat-engine/services/room-manager.service.spec.ts` (เพิ่ม provider + 2 เทส)

**Interfaces:**
- Consumes: `CustomerMergeService.absorbPlaceholder` (Task 8)
- Produces: `PATCH /staff-chat/rooms/:id/customer` (controller เดิม ไม่แก้) ทำงานกับห้องที่มี placeholder ได้

- [ ] **Step 1: เทสแดง**

ใน `room-manager.service.spec.ts` เพิ่ม `import { CustomerMergeService } from '../../chat-prospects/customer-merge.service';` · ใน `beforeEach`: `merge = { absorbPlaceholder: jest.fn().mockResolvedValue({ placeholderId: 'p1', targetId: 'cust-real', movedRooms: 1, movedCreditChecks: 0 }) };` + provider `{ provide: CustomerMergeService, useValue: merge }` · เพิ่ม `prisma.chatRoom.findUniqueOrThrow = jest.fn()` ใน mock prisma · เพิ่ม describe:
```ts
describe('linkCustomer กับห้องที่มีผู้สนใจอัตโนมัติ', () => {
  const actor = { id: 'staff-1', role: 'OWNER' };
  it('ห้องผูก placeholder อยู่ → absorb เข้าลูกค้าที่เลือก แล้วคืนห้อง (ไม่โยน 409)', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({
      id: 'room-1', customerId: 'p1', deletedAt: null, assignedToId: null,
      customer: { acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null, deletedAt: null },
    });
    prisma.chatRoom.findUniqueOrThrow.mockResolvedValue({ id: 'room-1', customerId: 'cust-real' });
    const room = await service.linkCustomer('room-1', 'cust-real', actor);
    expect(merge.absorbPlaceholder).toHaveBeenCalledWith('p1', 'cust-real', actor);
    expect(room.customerId).toBe('cust-real');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('ห้องผูกลูกค้าจริงคนอื่น → ยังโยน 409 เหมือนเดิม', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({
      id: 'room-1', customerId: 'cust-a', deletedAt: null, assignedToId: null,
      customer: { acquisitionSource: null, phone: '0811111111', nationalId: null, deletedAt: null },
    });
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    await expect(service.linkCustomer('room-1', 'cust-b', actor)).rejects.toThrow('ห้องแชทนี้ผูกกับลูกค้ารายอื่นอยู่แล้ว');
    expect(merge.absorbPlaceholder).not.toHaveBeenCalled();
  });
});
```
(ถ้า `$transaction` mock เดิมของ spec ไม่รองรับฟังก์ชัน ให้ตั้งใน it นั้น ๆ ตามตัวอย่าง · `lockCreditRoom` ใช้ `tx.$queryRaw` — เพิ่ม `prisma.$queryRaw = jest.fn().mockResolvedValue([])` ใน mock)

- [ ] **Step 2: รันให้เห็นว่าแดง**

Run: `npx jest src/modules/chat-engine/services/room-manager.service.spec.ts --runInBand` → Expected: เทสแรก FAIL (โยน 409)

- [ ] **Step 3: เขียนโค้ด**

constructor เพิ่มต่อจาก `chatProspects`:
```ts
    @Optional()
    private merge?: CustomerMergeService,
```
(import `CustomerMergeService` จาก `'../../chat-prospects/customer-merge.service'`)

ใน `linkCustomer(roomId, customerId, actor)` ก่อน `return this.prisma.$transaction(async tx => {` เพิ่ม:
```ts
    // ห้องที่มี "ผู้สนใจอัตโนมัติ" (สเปค 3.3 ก) — ดูดเข้าคนที่เลือก แทนที่จะโยน "ผูกกับลูกค้ารายอื่น"
    // ทำนอกทรานแซกชันด้านล่าง เพราะ absorbPlaceholder เปิดทรานแซกชันของตัวเอง
    if (this.merge) {
      const current = await this.prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: {
          id: true, customerId: true, deletedAt: true, assignedToId: true,
          customer: { select: { acquisitionSource: true, phone: true, nationalId: true, deletedAt: true } },
        },
      });
      if (current && !current.deletedAt && current.customerId && current.customerId !== customerId
        && current.customer && !current.customer.deletedAt && isChatPlaceholder(current.customer)) {
        if (actor.role === 'SALES' && current.assignedToId && current.assignedToId !== actor.id) {
          throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้');
        }
        await this.merge.absorbPlaceholder(current.customerId, customerId, actor);
        return this.prisma.chatRoom.findUniqueOrThrow({ where: { id: roomId } });
      }
    }
```
(import `isChatPlaceholder` จาก `'../../chat-prospects/chat-placeholder'`)

- [ ] **Step 4: รันให้เขียว**

Run: `npx jest src/modules/chat-engine --runInBand` → Expected: PASS · `npx tsc --noEmit -p tsconfig.json` → 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/chat-engine/services/room-manager.service.ts apps/api/src/modules/chat-engine/services/room-manager.service.spec.ts
git commit -m "feat(chat-engine): ผูกลูกค้าเดิมกับห้องที่มีผู้สนใจอัตโนมัติ = รวมเข้าคนนั้น" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: ทุกทางที่ LINE ถูกผูก → ดูด placeholder (`absorbRoomsOfLineUser`)

**Files:**
- Modify: `apps/api/src/modules/chat-prospects/customer-merge.service.ts` (เพิ่มเมธอด)
- Modify: `apps/api/src/modules/chatbot-finance/services/chat-room.service.ts:141-150` (`linkRoomToCustomer`)
- Modify: `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts:218`
- Modify: `apps/api/src/modules/line-oa/services/line-customer-link.service.ts:52-78` (`selfLinkByPhone`)
- Modify: `apps/api/src/modules/line-oa/liff-api.service.ts:167-197` (`confirmLinkLine`)
- Modify: `apps/api/src/modules/line-oa/line-oa.module.ts` (imports `ChatProspectsModule`)
- Test: `customer-merge.service.spec.ts` (เพิ่ม describe), `chat-room.service.prospect.spec.ts` (เพิ่ม 1 เทส), `line-customer-link.service.spec.ts` (ใหม่), `liff-api.service.spec.ts` (เพิ่ม 1 เทส), `chatbot-finance.service.spec.ts` (เพิ่ม 1 เทส)

**Interfaces:**
- Produces: `absorbRoomsOfLineUser(lineUserId: string, channel: 'LINE_SHOP' | 'LINE_FINANCE', customerId: string, actor: MergeActor): Promise<{ absorbed: number; linked: number }>` — `absorbed` = placeholder ที่ถูกรวม · `linked` = ห้องที่ยังไม่มีเจ้าของแล้วถูกผูกตรง
- `SYSTEM_ACTOR = { id: 'system', role: 'SYSTEM' }` export จาก `customer-merge.service.ts` สำหรับทางที่ลูกค้าทำเอง (ไม่มีพนักงาน)

- [ ] **Step 1: เทสแดง (บริการ)**

ต่อท้าย `customer-merge.service.spec.ts`:
```ts
describe('CustomerMergeService.absorbRoomsOfLineUser', () => {
  it('ห้อง LINE ของ lineUserId: placeholder → absorb · ไม่มีเจ้าของ → ผูกตรง · คนจริงคนเดิม → ข้าม', async () => {
    const prisma: any = {
      chatRoom: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'r-ph', customerId: 'p1', customer: { acquisitionSource: 'CHAT_LINE_SHOP', phone: null, nationalId: null, deletedAt: null } },
          { id: 'r-none', customerId: null, customer: null },
          { id: 'r-same', customerId: 'cust-real', customer: { acquisitionSource: null, phone: '0812345678', nationalId: null, deletedAt: null } },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new CustomerMergeService(prisma, { log: jest.fn() } as any);
    const absorb = jest.spyOn(service, 'absorbPlaceholder').mockResolvedValue({ placeholderId: 'p1', targetId: 'cust-real', movedRooms: 1, movedCreditChecks: 0 });
    await expect(service.absorbRoomsOfLineUser('Uabc', 'LINE_SHOP', 'cust-real', { id: 'system', role: 'SYSTEM' })).resolves.toEqual({ absorbed: 1, linked: 1 });
    expect(prisma.chatRoom.findMany).toHaveBeenCalledWith({
      where: { lineUserId: 'Uabc', channel: 'LINE_SHOP', deletedAt: null },
      select: { id: true, customerId: true, customer: { select: { acquisitionSource: true, phone: true, nationalId: true, deletedAt: true } } },
    });
    expect(absorb).toHaveBeenCalledWith('p1', 'cust-real', { id: 'system', role: 'SYSTEM' });
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({ where: { id: 'r-none' }, data: { customerId: 'cust-real' } });
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าแดง** — `npx jest src/modules/chat-prospects/customer-merge.service.spec.ts --runInBand` → FAIL (`absorbRoomsOfLineUser is not a function`)

- [ ] **Step 3: เขียนเมธอด**

ใน `customer-merge.service.ts` เพิ่ม export + เมธอด:
```ts
/** ทางที่ลูกค้าทำเอง (พิมพ์เบอร์ใน LINE / LIFF / OTP) ไม่มีพนักงาน — audit ระบุระบบ */
export const SYSTEM_ACTOR: MergeActor = { id: 'system', role: 'SYSTEM' };

  /**
   * LINE ถูกผูกกับลูกค้า (OTP บอทการเงิน / พิมพ์เบอร์ใน LINE ร้าน / LIFF) → ห้อง LINE ของคนนั้น
   * ที่ยังถือ placeholder ต้องถูกดูดเข้าลูกค้าจริง ห้องที่ไม่มีเจ้าของผูกตรง (สเปค 3.3 ง)
   */
  async absorbRoomsOfLineUser(
    lineUserId: string,
    channel: 'LINE_SHOP' | 'LINE_FINANCE',
    customerId: string,
    actor: MergeActor,
  ): Promise<{ absorbed: number; linked: number }> {
    const rooms = await this.prisma.chatRoom.findMany({
      where: { lineUserId, channel, deletedAt: null },
      select: { id: true, customerId: true, customer: { select: { acquisitionSource: true, phone: true, nationalId: true, deletedAt: true } } },
    });
    let absorbed = 0;
    let linked = 0;
    const absorbedIds = new Set<string>();
    for (const room of rooms) {
      if (!room.customerId) {
        await this.prisma.chatRoom.update({ where: { id: room.id }, data: { customerId } });
        linked++;
      } else if (room.customerId !== customerId && room.customer && !room.customer.deletedAt
        && isChatPlaceholder(room.customer) && !absorbedIds.has(room.customerId)) {
        await this.absorbPlaceholder(room.customerId, customerId, actor);
        absorbedIds.add(room.customerId);
        absorbed++;
      }
    }
    return { absorbed, linked };
  }
```

- [ ] **Step 4: เทสแดง 4 จุดเรียกใช้**

(ก) ต่อท้าย `chat-room.service.prospect.spec.ts`:
```ts
describe('ChatRoomService.linkRoomToCustomer (หลัง LIFF verify)', () => {
  it('ห้องถือ placeholder → absorb ก่อน แล้วค่อยตั้ง verifiedAt', async () => {
    const prisma: any = {
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue({ id: 'room-fin', customerId: 'p1', customer: { acquisitionSource: 'CHAT_LINE_FINANCE', phone: null, nationalId: null, deletedAt: null } }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const merge = { absorbPlaceholder: jest.fn().mockResolvedValue({}) };
    const service = new ChatRoomService(prisma, {} as any, undefined, undefined, merge as any);
    await service.linkRoomToCustomer('room-fin', 'cust-real');
    expect(merge.absorbPlaceholder).toHaveBeenCalledWith('p1', 'cust-real', { id: 'system', role: 'SYSTEM' });
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({ where: { id: 'room-fin' }, data: { customerId: 'cust-real', verifiedAt: expect.any(Date) } });
  });
});
```
(ข) ใน `chatbot-finance.service.spec.ts` หา describe ที่ทดสอบ inbound เมื่อ `isLinked` คืน linked (มี `linkRoomToCustomer` ใน mock ของ `sessions`) แล้วเพิ่ม:
```ts
  it('session ถือ placeholder แต่ LINE ผูกลูกค้าจริงแล้ว → เรียก linkRoomToCustomer (เดิมเช็คแค่ !customerId)', async () => {
    // จัด mock ตามแบบเทสข้างเคียง: session.customerId = 'p1', verification.isLinked → { linked: true, customerId: 'cust-real', customerName: 'x' }
    // …
    expect(sessions.linkRoomToCustomer).toHaveBeenCalledWith(session.id, 'cust-real');
  });
```
(ค) `apps/api/src/modules/line-oa/services/line-customer-link.service.spec.ts` (ใหม่):
```ts
import { LineCustomerLinkService } from './line-customer-link.service';

describe('LineCustomerLinkService.selfLinkByPhone → ดูดผู้สนใจอัตโนมัติของห้อง LINE ร้าน', () => {
  it('ผูกสำเร็จ → absorbRoomsOfLineUser(lineUserId, LINE_SHOP, customerId, SYSTEM)', async () => {
    const prisma: any = {
      customer: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'cust-real', name: 'สมชาย' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const merge = { absorbRoomsOfLineUser: jest.fn().mockResolvedValue({ absorbed: 1, linked: 0 }) };
    const service = new LineCustomerLinkService(prisma, {} as any, merge as any);
    await expect(service.selfLinkByPhone('Uabc', '0812345678')).resolves.toEqual({ success: true, customerName: 'สมชาย' });
    expect(merge.absorbRoomsOfLineUser).toHaveBeenCalledWith('Uabc', 'LINE_SHOP', 'cust-real', { id: 'system', role: 'SYSTEM' });
  });
  it('ไม่พบเบอร์ → ไม่เรียก absorb', async () => {
    const prisma: any = { customer: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } };
    const merge = { absorbRoomsOfLineUser: jest.fn() };
    const service = new LineCustomerLinkService(prisma, {} as any, merge as any);
    await expect(service.selfLinkByPhone('Uabc', '0812345678')).resolves.toEqual({ success: false });
    expect(merge.absorbRoomsOfLineUser).not.toHaveBeenCalled();
  });
});
```
(ง) ใน `liff-api.service.spec.ts` เพิ่ม (ปรับ mock ให้ตรงแบบเทสเดิมในไฟล์):
```ts
  it('confirmLinkLine สำเร็จ → absorbRoomsOfLineUser(lineId, LINE_FINANCE, customerId, SYSTEM)', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1', deletedAt: null, lineIdFinance: null });
    prisma.customer.update.mockResolvedValue({});
    await expect(service.confirmLinkLine('cust-1', 'Ufin')).resolves.toEqual({ success: true });
    expect(merge.absorbRoomsOfLineUser).toHaveBeenCalledWith('Ufin', 'LINE_FINANCE', 'cust-1', { id: 'system', role: 'SYSTEM' });
  });
```
(สร้าง `service = new LiffApiService(prisma, merge as any)` — constructor รับพารามิเตอร์ที่สองแบบ optional)

- [ ] **Step 5: รันให้เห็นว่าแดง** — `npx jest src/modules/chatbot-finance src/modules/line-oa --runInBand` → เทสใหม่ 4 ตัว FAIL

- [ ] **Step 6: เขียนโค้ด 4 จุด**

(ก) `chat-room.service.ts` constructor เพิ่มท้ายสุด `@Optional() private merge?: CustomerMergeService,` (import จาก `../../chat-prospects/customer-merge.service` พร้อม `SYSTEM_ACTOR`) และแทน `linkRoomToCustomer`:
```ts
  /** Sync room.customerId หลังจาก LIFF verify (CustomerLineLink ถูกสร้างแล้ว) — ห้องที่ถือผู้สนใจอัตโนมัติถูกดูดเข้าคนจริงก่อน */
  async linkRoomToCustomer(roomId: string, customerId: string): Promise<void> {
    if (this.merge) {
      const room = await this.prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: { id: true, customerId: true, customer: { select: { acquisitionSource: true, phone: true, nationalId: true, deletedAt: true } } },
      });
      if (room?.customerId && room.customerId !== customerId && room.customer && !room.customer.deletedAt && isChatPlaceholder(room.customer)) {
        await this.merge.absorbPlaceholder(room.customerId, customerId, SYSTEM_ACTOR);
      }
    }
    await this.prisma.chatRoom.update({ where: { id: roomId }, data: { customerId, verifiedAt: new Date() } });
  }
```
(import `isChatPlaceholder` จาก `../../chat-prospects/chat-placeholder`)

(ข) `chatbot-finance.service.ts:218`: `if (!session.customerId && linkStatus.customerId) {` → `if (linkStatus.customerId && session.customerId !== linkStatus.customerId) {`

(ค) `line-customer-link.service.ts` constructor เพิ่ม `@Optional() private merge?: CustomerMergeService,` (import `Optional` จาก `@nestjs/common`, `CustomerMergeService`/`SYSTEM_ACTOR` จาก `../../chat-prospects/customer-merge.service`) และใน `selfLinkByPhone` หลัง `await this.prisma.customer.update({ … lineIdShop: lineUserId })` เพิ่ม:
```ts
    // ห้อง LINE ร้านของคนนี้ที่ถือผู้สนใจอัตโนมัติอยู่ → ดูดเข้าลูกค้าที่เพิ่งผูก (สเปค 3.3 ง)
    await this.merge?.absorbRoomsOfLineUser(lineUserId, 'LINE_SHOP', customer.id, SYSTEM_ACTOR);
```
(ง) `liff-api.service.ts` constructor → `constructor(private prisma: PrismaService, @Optional() private merge?: CustomerMergeService) {}` และใน `confirmLinkLine` หลัง `update({ data: { lineIdFinance: lineId } })` เพิ่ม `await this.merge?.absorbRoomsOfLineUser(lineId, 'LINE_FINANCE', customerId, SYSTEM_ACTOR);`

`line-oa.module.ts`: เพิ่ม `ChatProspectsModule` ใน `imports`

- [ ] **Step 7: รันให้เขียว** — `npx jest src/modules/chatbot-finance src/modules/line-oa src/modules/chat-prospects --runInBand` → PASS · `npx tsc --noEmit -p tsconfig.json` → 0

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/chat-prospects/customer-merge.service.ts apps/api/src/modules/chat-prospects/customer-merge.service.spec.ts apps/api/src/modules/chatbot-finance/services/chat-room.service.ts apps/api/src/modules/chatbot-finance/services/chat-room.service.prospect.spec.ts apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts apps/api/src/modules/line-oa/services/line-customer-link.service.ts apps/api/src/modules/line-oa/services/line-customer-link.service.spec.ts apps/api/src/modules/line-oa/liff-api.service.ts apps/api/src/modules/line-oa/liff-api.service.spec.ts apps/api/src/modules/line-oa/line-oa.module.ts
git commit -m "feat(line): ผูก LINE ทุกทาง (OTP บอทการเงิน / พิมพ์เบอร์ใน LINE ร้าน / LIFF) ดูดผู้สนใจอัตโนมัติเข้าลูกค้าจริง" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: รวมห้องแชท (`mergeRooms`) — placeholder ไม่ใช่ "ลูกค้าคนละคน"

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/session-ops.service.ts:19` (constructor), `:77-105` (mergeRooms)
- Modify: `apps/api/src/modules/staff-chat/staff-chat.module.ts` (imports `ChatProspectsModule`)
- Test: `apps/api/src/modules/staff-chat/services/session-ops.merge-placeholder.spec.ts` (ใหม่)

**Interfaces:**
- Consumes: `CustomerMergeService.absorbPlaceholder(…, { allowPlaceholderTarget: true })` (Task 8)
- Produces: `mergeRooms(primaryId, secondaryId)` รับกรณี placeholder 3 แบบตามสเปค 3.3 (ค) · ผู้เรียก controller เดิมไม่เปลี่ยน signature — เพิ่มพารามิเตอร์ที่ 3 `actor: MergeActor = SYSTEM_ACTOR`

- [ ] **Step 1: เทสแดง**

`session-ops.merge-placeholder.spec.ts`:
```ts
import { BadRequestException } from '@nestjs/common';
import { SessionOpsService } from './session-ops.service';

const real = { acquisitionSource: null, phone: '0812345678', nationalId: null, deletedAt: null };
const ph = (src = 'CHAT_FACEBOOK') => ({ acquisitionSource: src, phone: null, nationalId: null, deletedAt: null });

function build(primary: any, secondary: any) {
  const tx: any = {
    chatMessage: { updateMany: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
    chatNote: { updateMany: jest.fn().mockResolvedValue({}) },
    conversationTag: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), delete: jest.fn() },
    chatRoom: { findUnique: jest.fn().mockResolvedValue({ waitingSince: null }), update: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    chatRoom: { findFirst: jest.fn(({ where }: any) => Promise.resolve(where.id === 'p' ? primary : secondary)) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const merge = { absorbPlaceholder: jest.fn().mockResolvedValue({}) };
  return { service: new SessionOpsService(prisma, merge as any), merge, tx };
}

describe('mergeRooms กับผู้สนใจอัตโนมัติ', () => {
  it('ห้องรองถือ placeholder, ห้องหลักคนจริง → absorb รองเข้าหลัก แล้วรวมห้องต่อ', async () => {
    const { service, merge, tx } = build(
      { id: 'p', customerId: 'c-real', customer: real, createdAt: new Date('2026-01-01') },
      { id: 's', customerId: 'c-ph', customer: ph(), createdAt: new Date('2026-02-01') },
    );
    await service.mergeRooms('p', 's');
    expect(merge.absorbPlaceholder).toHaveBeenCalledWith('c-ph', 'c-real', { id: 'system', role: 'SYSTEM' }, { allowPlaceholderTarget: true });
    expect(tx.chatRoom.update).toHaveBeenCalledWith({ where: { id: 's' }, data: { deletedAt: expect.any(Date) } });
  });
  it('ห้องหลักถือ placeholder, ห้องรองคนจริง → absorb หลักเข้าคนของห้องรอง', async () => {
    const { service, merge } = build(
      { id: 'p', customerId: 'c-ph', customer: ph(), createdAt: new Date('2026-01-01') },
      { id: 's', customerId: 'c-real', customer: real, createdAt: new Date('2026-02-01') },
    );
    await service.mergeRooms('p', 's');
    expect(merge.absorbPlaceholder).toHaveBeenCalledWith('c-ph', 'c-real', { id: 'system', role: 'SYSTEM' }, { allowPlaceholderTarget: true });
  });
  it('placeholder ทั้งคู่ → ใหม่กว่าเข้าเก่ากว่า', async () => {
    const { service, merge } = build(
      { id: 'p', customerId: 'c-old', customer: ph(), createdAt: new Date('2026-01-01') },
      { id: 's', customerId: 'c-new', customer: ph('CHAT_LINE_SHOP'), createdAt: new Date('2026-02-01') },
    );
    await service.mergeRooms('p', 's');
    expect(merge.absorbPlaceholder).toHaveBeenCalledWith('c-new', 'c-old', { id: 'system', role: 'SYSTEM' }, { allowPlaceholderTarget: true });
  });
  it('คนจริงคนละคน → 400 เหมือนเดิม', async () => {
    const { service, merge } = build(
      { id: 'p', customerId: 'c1', customer: real, createdAt: new Date() },
      { id: 's', customerId: 'c2', customer: { ...real, phone: '0899999999' }, createdAt: new Date() },
    );
    await expect(service.mergeRooms('p', 's')).rejects.toBeInstanceOf(BadRequestException);
    expect(merge.absorbPlaceholder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าแดง** — `npx jest src/modules/staff-chat/services/session-ops.merge-placeholder.spec.ts --runInBand` → FAIL

- [ ] **Step 3: เขียนโค้ด**

`session-ops.service.ts`:
```ts
import { CustomerMergeService, MergeActor, SYSTEM_ACTOR } from '../../chat-prospects/customer-merge.service';
import { isChatPlaceholder } from '../../chat-prospects/chat-placeholder';
// …
  constructor(private prisma: PrismaService, @Optional() private merge?: CustomerMergeService) {}
```
ใน `mergeRooms(primaryId: string, secondaryId: string, actor: MergeActor = SYSTEM_ACTOR)` — เปลี่ยน `findFirst` ทั้งสองให้ `include`/`select` ลูกค้า: `{ where: { id: primaryId, deletedAt: null }, include: { customer: { select: { acquisitionSource: true, phone: true, nationalId: true, deletedAt: true } } } }` (ห้องรองเหมือนกัน) และแทนบล็อก "Validate same customer" ด้วย:
```ts
    // ผู้สนใจอัตโนมัติ (สเปค 3.3 ค): placeholder ไม่ใช่ "ลูกค้าคนละคน" — ดูดเข้าอีกฝั่งก่อนรวมห้อง
    if (secondary.customerId && primary.customerId && secondary.customerId !== primary.customerId) {
      const primaryPh = !!primary.customer && !primary.customer.deletedAt && isChatPlaceholder(primary.customer);
      const secondaryPh = !!secondary.customer && !secondary.customer.deletedAt && isChatPlaceholder(secondary.customer);
      if (!this.merge || (!primaryPh && !secondaryPh)) {
        throw new BadRequestException('ไม่สามารถรวมเซสชันที่เป็นของลูกค้าคนละคนได้');
      }
      if (secondaryPh && !primaryPh) {
        await this.merge.absorbPlaceholder(secondary.customerId, primary.customerId, actor, { allowPlaceholderTarget: true });
      } else if (primaryPh && !secondaryPh) {
        await this.merge.absorbPlaceholder(primary.customerId, secondary.customerId, actor, { allowPlaceholderTarget: true });
      } else {
        // ทั้งคู่ placeholder → ใหม่กว่าเข้าเก่ากว่า
        const [older, newer] = primary.createdAt <= secondary.createdAt ? [primary, secondary] : [secondary, primary];
        await this.merge.absorbPlaceholder(newer.customerId!, older.customerId!, actor, { allowPlaceholderTarget: true });
      }
    }
```
(บล็อกทรานแซกชันย้ายข้อความ/โน้ต/แท็ก/soft-delete ห้องรอง คงเดิม) · `staff-chat.module.ts`: เพิ่ม `ChatProspectsModule` ใน imports · ผู้เรียกคือ `apps/api/src/modules/staff-chat/session-ops.controller.ts:24-34` (`POST rooms/merge`) — เพิ่ม `@Req() req: { user: { id: string; role: string } }` แล้วส่ง `{ id: req.user.id, role: req.user.role }` เป็นอาร์กิวเมนต์ที่ 3 ของ `mergeRooms` เพื่อให้ audit ระบุพนักงานที่กดรวม

- [ ] **Step 4: รันให้เขียว** — `npx jest src/modules/staff-chat --runInBand` → PASS · tsc 0

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/session-ops.service.ts apps/api/src/modules/staff-chat/services/session-ops.merge-placeholder.spec.ts apps/api/src/modules/staff-chat/staff-chat.module.ts apps/api/src/modules/staff-chat/session-ops.controller.ts
git commit -m "feat(staff-chat): รวมห้องแชทข้ามช่องทางเมื่อฝั่งใดเป็นผู้สนใจอัตโนมัติ" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: กติกาที่เคยถือว่า "ผูกแล้ว = ลูกค้าจริง" — เตรียมข้อเสนอ · ส่งข้อมูลชำระ · บอทขาย

**Files:**
- Create: `apps/api/src/modules/staff-chat/services/prepare-offer.policy.ts` (+ `.spec.ts`)
- Modify: `apps/api/src/modules/staff-chat/services/prepare-offer.service.ts:41-48,116-132`
- Modify: `apps/api/src/modules/staff-chat/services/chat-commerce.service.ts:62-80` (+ เพิ่มเทสใน `chat-commerce.service.spec.ts`)
- Modify: `apps/api/src/modules/sales-bot/tools/capture-lead.tool.ts:123-146` (+ เพิ่มเทสใน `capture-lead.tool.spec.ts`)

**Interfaces:**
- Produces: `offerContractPolicy(input: { customerId: string | null; placeholder: boolean }): { canContract: boolean; nextStep: string }`
- ข้อความคงที่: `'ผูกลูกค้ากับห้องแชทก่อนทำสัญญา'` (ไม่มีลูกค้า) · `'เติมเบอร์และเลขบัตรของผู้สนใจก่อนทำสัญญา'` (placeholder) · `'ตรวจผลเครดิตและตารางผ่อนในหน้าสร้างสัญญาก่อนยืนยัน'` (พร้อม)

- [ ] **Step 1: เทสแดง**

`prepare-offer.policy.spec.ts`:
```ts
import { offerContractPolicy } from './prepare-offer.policy';

describe('offerContractPolicy', () => {
  it('ไม่มีลูกค้า → ห้ามสร้างสัญญา บอกให้ผูกก่อน', () => {
    expect(offerContractPolicy({ customerId: null, placeholder: false })).toEqual({ canContract: false, nextStep: 'ผูกลูกค้ากับห้องแชทก่อนทำสัญญา' });
  });
  it('ผู้สนใจอัตโนมัติ → ห้ามสร้างสัญญา บอกให้เติมเบอร์/เลขบัตร', () => {
    expect(offerContractPolicy({ customerId: 'p1', placeholder: true })).toEqual({ canContract: false, nextStep: 'เติมเบอร์และเลขบัตรของผู้สนใจก่อนทำสัญญา' });
  });
  it('ลูกค้าที่มีเบอร์ → สร้างสัญญาได้', () => {
    expect(offerContractPolicy({ customerId: 'c1', placeholder: false })).toEqual({ canContract: true, nextStep: 'ตรวจผลเครดิตและตารางผ่อนในหน้าสร้างสัญญาก่อนยืนยัน' });
  });
});
```
ใน `chat-commerce.service.spec.ts` เพิ่ม (ตามแบบ mock ของไฟล์นั้น — session ถูกอ่านด้วย `prisma.chatRoom.findUnique`):
```ts
  it('ห้องที่ถือผู้สนใจอัตโนมัติ (ไม่มีเบอร์) → 400 เหมือนยังไม่ผูกลูกค้า', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({
      id: 's1', lineUserId: null, channel: 'FACEBOOK', customerId: 'p1',
      customer: { id: 'p1', name: 'Facebook #7890', lineIdFinance: null, lineIdShop: null, acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null },
    });
    await expect(service.sendPaymentInfo({ sessionId: 's1' } as any)).rejects.toThrow('ห้องแชทนี้ยังไม่ได้เชื่อมกับลูกค้า');
  });
```
(ใช้ชื่อเมธอดจริงที่มีบล็อก `if (!session.customerId || !session.customer)` — ดูบรรทัด 62-80 ของไฟล์)
ใน `capture-lead.tool.spec.ts` เพิ่ม:
```ts
  it('ห้องถือผู้สนใจอัตโนมัติ → เติมชื่อ+เบอร์ให้คนเดิม ไม่ทับที่มา CHAT_*', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({ id: 'room-1', lineUserId: null, customerId: 'p1' });
    prisma.systemConfig.findMany.mockResolvedValue([{ key: 'shop_bot_central_branch_id', value: 'branch-central' }]);
    txClient.customer.findUnique.mockResolvedValue({ phone: null, phoneSecondary: null, acquisitionSource: 'CHAT_FACEBOOK', nationalId: null });
    await tool.execute({ roomId: 'room-1', customerName: 'สมชาย ใจดี', phone: '0812345678' } as any);
    expect(txClient.customer.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { name: 'สมชาย ใจดี', phone: '0812345678' },
    });
  });
```
(ปรับชื่อเมธอด/รูปแบบ input ให้ตรงกับเทสข้างเคียงในไฟล์ — เช่น `tool.execute(...)` หรือ `tool.run(...)`)

- [ ] **Step 2: รันให้เห็นว่าแดง** — `npx jest src/modules/staff-chat/services/prepare-offer.policy.spec.ts src/modules/staff-chat/services/chat-commerce.service.spec.ts src/modules/sales-bot/tools/capture-lead.tool.spec.ts --runInBand` → 3 เทสใหม่ FAIL

- [ ] **Step 3: เขียนโค้ด**

`prepare-offer.policy.ts`:
```ts
/** ลิงก์สร้างสัญญาจากข้อเสนอ — ผู้สนใจอัตโนมัติ (ยังไม่มีเบอร์/เลขบัตร) ทำสัญญาไม่ได้ (สเปค 3.4) */
export function offerContractPolicy(input: { customerId: string | null; placeholder: boolean }): { canContract: boolean; nextStep: string } {
  if (!input.customerId) return { canContract: false, nextStep: 'ผูกลูกค้ากับห้องแชทก่อนทำสัญญา' };
  if (input.placeholder) return { canContract: false, nextStep: 'เติมเบอร์และเลขบัตรของผู้สนใจก่อนทำสัญญา' };
  return { canContract: true, nextStep: 'ตรวจผลเครดิตและตารางผ่อนในหน้าสร้างสัญญาก่อนยืนยัน' };
}
```
`prepare-offer.service.ts` — หลัง `const room = await this.access.assertAccess(roomId, actor);` เพิ่ม:
```ts
    const linkedCustomer = room.customerId
      ? await this.prisma.customer.findUnique({ where: { id: room.customerId }, select: { acquisitionSource: true, phone: true, nationalId: true } })
      : null;
    const policy = offerContractPolicy({ customerId: room.customerId, placeholder: !!linkedCustomer && isChatPlaceholder(linkedCustomer) });
```
แล้วแทน `if (room.customerId) params.set('customerId', room.customerId);` → `if (policy.canContract && room.customerId) params.set('customerId', room.customerId);` · `contractPath: room.customerId ? … : null` → `contractPath: policy.canContract ? \`/contracts/create?${params.toString()}\` : null` · `nextStep: !room.customerId ? '…' : '…'` → `nextStep: policy.nextStep` (import `offerContractPolicy`, `isChatPlaceholder`)

`chat-commerce.service.ts` — ใน select ของ `customer` เพิ่ม `acquisitionSource: true, phone: true, nationalId: true` และแก้ด่าน:
```ts
    if (!session.customerId || !session.customer || isChatPlaceholder(session.customer)) {
      throw new BadRequestException('ห้องแชทนี้ยังไม่ได้เชื่อมกับลูกค้า');
    }
```
`capture-lead.tool.ts` Branch 1 — เปลี่ยน select ของ `bound` เป็น `{ phone: true, phoneSecondary: true, acquisitionSource: true, nationalId: true }` และแทนบล็อก update:
```ts
        const placeholder = !!bound && isChatPlaceholder(bound);
        const phoneChanged = !!bound && bound.phone !== input.phone;
        const aiOwned = bound?.acquisitionSource?.startsWith('AI_CHAT') ?? false;
        await tx.customer.update({
          where: { id: room.customerId },
          data: {
            name: input.customerName,
            // ผู้สนใจอัตโนมัติ: ที่มายังเป็นช่องทางที่ทักมา (CHAT_*) ไม่ใช่บอท — สเปค 3.4
            ...(placeholder ? {} : { acquisitionSource: 'AI_CHAT_RETURN' }),
            ...(phoneChanged && (aiOwned || placeholder) ? { phone: input.phone } : {}),
            ...(phoneChanged && !aiOwned && !placeholder && !bound?.phoneSecondary ? { phoneSecondary: input.phone } : {}),
          },
        });
```
(import `isChatPlaceholder` จาก `'../../chat-prospects/chat-placeholder'`)

- [ ] **Step 4: รันให้เขียว** — `npx jest src/modules/staff-chat src/modules/sales-bot --runInBand` → PASS · tsc 0

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/prepare-offer.policy.ts apps/api/src/modules/staff-chat/services/prepare-offer.policy.spec.ts apps/api/src/modules/staff-chat/services/prepare-offer.service.ts apps/api/src/modules/staff-chat/services/chat-commerce.service.ts apps/api/src/modules/staff-chat/services/chat-commerce.service.spec.ts apps/api/src/modules/sales-bot/tools/capture-lead.tool.ts apps/api/src/modules/sales-bot/tools/capture-lead.tool.spec.ts
git commit -m "feat(chat): ผู้สนใจอัตโนมัติยังทำสัญญา/ส่งข้อมูลชำระไม่ได้จนกว่าจะมีเบอร์ · บอทเติมเบอร์ให้คนเดิมโดยไม่ทับที่มา" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: รายชื่อลูกค้า — ธง `chatPlaceholder` · ที่มาจาก `CHAT_*` · ตัวกรอง "ที่มา" ทั้งสองแท็บ · KPI "มาจากแชท"

**Files:**
- Modify: `apps/api/src/modules/customers/services/customer-query.service.ts` — `SOURCE_CHANNELS` (~101), `deriveSource` (~184), `CUSTOMER_SELECT` (~208), `findAll` (`source` gate ~327, ตัวกรอง ~432-445, `kpiPredicates` ~533-546, `summary` ~594-596, row mapping ~597-650), `findOne` (~706)
- Test: `apps/api/src/modules/customers/services/customer-query-chat-source.spec.ts` (ใหม่ ใช้ `buildQueryService`/`enrichmentMocks` จาก `./__tests__/mock-customer-db`)

**Interfaces:**
- Consumes: `chatSourceChannel`, `CHAT_SOURCE_PREFIX`, `chatLogoOf` (`@installment/shared`) · `isChatPlaceholder` (Task 4)
- Produces (สัญญากับ Plan 2 ฝั่งเว็บ):
  - แถวแท็บผู้สนใจเพิ่ม `chatPlaceholder: boolean`
  - แถวแท็บลูกค้าเพิ่ม `source: ProspectSource` และ `acquisitionSourceRaw: string | null`
  - `summary` แท็บลูกค้าเพิ่ม `fromChat: number` (KPI ใบที่ 6) — predicate `{ acquisitionSource: { startsWith: 'CHAT_' } }`
  - `GET /customers?view=customers&source=LINE|FACEBOOK|TIKTOK|WEB|BOT|REFERRAL|WALK_IN` ใช้ได้ (เดิมเฉพาะ prospects)
  - `GET /customers/:id` เพิ่ม `chatPlaceholder: boolean`

- [ ] **Step 1: เทสแดง**

`customer-query-chat-source.spec.ts`:
```ts
import { buildQueryService, enrichmentMocks } from './__tests__/mock-customer-db';

const baseRow = {
  id: 'c1', name: 'สมชาย ใจดี', nickname: null, nationalId: null, phone: null, createdAt: new Date('2026-09-12T07:32:00Z'),
  contracts: [], _count: { contracts: 0 }, creditChecks: [], creditCheckStatus: 'NONE', acquisitionSource: 'CHAT_FACEBOOK', referredById: null, tags: [],
};
function fixture(row = baseRow) {
  const findMany = jest.fn(async () => [row]);
  const count = jest.fn().mockResolvedValue(3);
  const db = { customer: { findMany, count }, ...enrichmentMocks() };
  const tier = { getCustomerTiers: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, { tier: 'NEW' }]))) };
  return { db, findMany, count, service: buildQueryService(db, tier) };
}
const whereOf = (findMany: jest.Mock) => findMany.mock.calls[0][0].where;

describe('ผู้สนใจอัตโนมัติในรายชื่อ', () => {
  it('แถวผู้สนใจมี chatPlaceholder=true เมื่อ CHAT_* + ไม่มีเบอร์/เลขบัตร', async () => {
    const { service } = fixture();
    const res = await service.findAll({ view: 'prospects' });
    expect(res.data[0]).toMatchObject({ chatPlaceholder: true, source: 'FACEBOOK', acquisitionSourceRaw: 'CHAT_FACEBOOK' });
  });
  it('เติมเบอร์แล้ว → chatPlaceholder=false แต่ที่มายังเป็น FACEBOOK', async () => {
    const { service } = fixture({ ...baseRow, phone: '0812345678' });
    const res = await service.findAll({ view: 'prospects' });
    expect(res.data[0]).toMatchObject({ chatPlaceholder: false, source: 'FACEBOOK' });
  });
  it('ที่มา CHAT_LINE_SHOP แม้ไม่มีห้องแชทเหลือ → LINE (ไม่ตกเป็น WALK_IN)', async () => {
    const { service } = fixture({ ...baseRow, acquisitionSource: 'CHAT_LINE_SHOP' });
    const res = await service.findAll({ view: 'prospects' });
    expect(res.data[0].source).toBe('LINE');
  });
});

describe('แท็บลูกค้า: ตัวกรองที่มา + KPI มาจากแชท', () => {
  it('view=customers&source=LINE กรองด้วยห้อง LINE หรือที่มา CHAT_LINE_* (และไม่ใช่บอท)', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers', source: 'LINE' });
    const and = whereOf(findMany).AND as any[];
    expect(and).toEqual(expect.arrayContaining([
      { OR: [{ acquisitionSource: null }, { acquisitionSource: { not: { startsWith: 'AI_CHAT' } } }] },
      { OR: [
        { chatRooms: { some: { deletedAt: null, channel: { in: ['LINE_FINANCE', 'LINE_SHOP'] } } } },
        { acquisitionSource: { in: ['CHAT_LINE_FINANCE', 'CHAT_LINE_SHOP'] } },
      ] },
    ]));
  });
  it('summary แท็บลูกค้ามี fromChat และแถวมี source', async () => {
    const { service, count } = fixture({ ...baseRow, phone: '0812345678', contracts: [{ status: 'ACTIVE' }] });
    const res = await service.findAll({ view: 'customers' });
    expect(res.summary).toMatchObject({ fromChat: 3 });
    expect(count).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: expect.arrayContaining([{ acquisitionSource: { startsWith: 'CHAT_' } }]) } }));
    expect(res.data[0]).toMatchObject({ source: 'FACEBOOK', acquisitionSourceRaw: 'CHAT_FACEBOOK' });
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าแดง** — `npx jest src/modules/customers/services/customer-query-chat-source.spec.ts --runInBand` → FAIL (ไม่มี `chatPlaceholder`, `source` ถูกมองข้ามในแท็บลูกค้า, ไม่มี `fromChat`)

- [ ] **Step 3: เขียนโค้ด**

(1) import เพิ่ม: `import { chatSourceChannel, CHAT_SOURCE_PREFIX, … } from '@installment/shared';` และ `import { isChatPlaceholder } from '../../chat-prospects/chat-placeholder';`

(2) ใต้ `SOURCE_CHANNELS` เพิ่ม:
```ts
/** ที่มา → ค่า acquisitionSource ของผู้สนใจอัตโนมัติที่นับว่าตรง (ห้องถูกลบไปแล้วก็ยังกรองได้) */
const SOURCE_CHAT_VALUES: Record<string, string[]> = {
  FACEBOOK: ['CHAT_FACEBOOK'],
  TIKTOK: ['CHAT_TIKTOK'],
  WEB: ['CHAT_WEB'],
  LINE: ['CHAT_LINE_FINANCE', 'CHAT_LINE_SHOP'],
};
```

(3) `deriveSource` — เพิ่มกิ่งหลัง `AI_CHAT`:
```ts
  if (acquisitionSource?.startsWith('AI_CHAT')) return 'BOT';
  const chatChannel = chatSourceChannel(acquisitionSource);
  if (chatChannel) return chatLogoOf(chatChannel); // ที่มาติดตัวจากตอนทักครั้งแรก ชนะห้องล่าสุด
  if (newestChannel) return chatLogoOf(newestChannel);
```

(4) `CUSTOMER_SELECT` เพิ่ม `acquisitionSource: true, referredById: true,` (ถ้ายังไม่มี)

(5) ใน `findAll`: `const source = isProspects ? filters.source : undefined;` → `const source = filters.source;` และในบล็อก `if (source)` แทน
```ts
      } else if (SOURCE_CHANNELS[source]) {
        filterAnd.push(NOT_BOT_WHERE, { chatRooms: { some: { deletedAt: null, channel: SOURCE_CHANNELS[source] } } });
```
ด้วย
```ts
      } else if (SOURCE_CHANNELS[source]) {
        filterAnd.push(NOT_BOT_WHERE, {
          OR: [
            { chatRooms: { some: { deletedAt: null, channel: SOURCE_CHANNELS[source] } } },
            { acquisitionSource: { in: SOURCE_CHAT_VALUES[source] } },
          ],
        });
```

(6) `kpiPredicates` ฝั่งลูกค้า เพิ่มตัวที่ 5: `{ acquisitionSource: { startsWith: CHAT_SOURCE_PREFIX } },` และ `summary` ฝั่งลูกค้าเพิ่ม `fromChat: kpiCounts[4] ?? 0`

(7) row mapping ผู้สนใจ: หลัง `phone`/`nationalId` เพิ่ม
```ts
          chatPlaceholder: isChatPlaceholder({
            acquisitionSource: (row.acquisitionSource ?? null) as string | null,
            phone: (decrypted.phone ?? null) as string | null,
            nationalId: (decrypted.nationalId ?? null) as string | null,
          }),
```
row mapping ลูกค้า: เพิ่ม
```ts
        source: deriveSource((row.acquisitionSource ?? null) as string | null, chatRooms[0]?.channel ?? null, (row.referredById ?? null) as string | null),
        acquisitionSourceRaw: (row.acquisitionSource ?? null) as string | null,
```

(8) `findOne` — แทน `return this.decryptCustomerPII(…) as typeof customer;` ด้วย:
```ts
    const decrypted = this.decryptCustomerPII(customer as unknown as Record<string, unknown>, { strict }) as typeof customer;
    return {
      ...decrypted,
      chatPlaceholder: isChatPlaceholder({
        acquisitionSource: decrypted.acquisitionSource ?? null,
        phone: decrypted.phone ?? null,
        nationalId: decrypted.nationalId ?? null,
      }),
    };
```

- [ ] **Step 4: รันให้เขียว (spec เดิมของ customers ทั้งชุดต้องผ่าน)** — `npx jest src/modules/customers --runInBand` → PASS · tsc 0 · ถ้า `customer-query-view.spec.ts` เดิม assert ว่า `source` ถูกมองข้ามในแท็บลูกค้า ให้แก้ assertion นั้นให้ตรงพฤติกรรมใหม่ (สเปค 3.6)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/customers/services/customer-query.service.ts apps/api/src/modules/customers/services/customer-query-chat-source.spec.ts apps/api/src/modules/customers/services/customer-query-view.spec.ts
git commit -m "feat(customers): ธง chatPlaceholder · ที่มาจาก CHAT_* · ตัวกรองที่มาทั้งสองแท็บ · KPI มาจากแชท" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: ห้ามล้างเบอร์ผ่าน `PATCH /customers/:id` (DTO ปฏิเสธ `phone: null`)

**Files:**
- Modify: `apps/api/src/modules/customers/dto/customer.dto.ts:141-144` (`UpdateCustomerDto.phone`)
- Test: `apps/api/src/modules/customers/dto/customer.dto.phone.spec.ts` (ใหม่)

**Interfaces:**
- Produces: `phone` ใน UpdateCustomerDto — ไม่ส่ง = คงค่าเดิม (placeholder ยังไม่มีเบอร์ก็เว้นได้) · ส่ง `null`/`''` = 400 · ส่งเบอร์ = ต้องตรง `^0[0-9]{9}$` (เดิม)

- [ ] **Step 1: เทสแดง**

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCustomerDto } from './customer.dto';

const errorsFor = async (body: Record<string, unknown>) => (await validate(plainToInstance(UpdateCustomerDto, body))).map((e) => e.property);

describe('UpdateCustomerDto.phone — ผู้สนใจอัตโนมัติ', () => {
  it('ไม่ส่ง phone → ผ่าน (คงค่าเดิม / ยังไม่มีเบอร์ก็เว้นได้)', async () => {
    expect(await errorsFor({ nickname: 'เล็ก' })).not.toContain('phone');
  });
  it('phone: null → ปฏิเสธ (ล้างเบอร์ไม่ได้)', async () => {
    expect(await errorsFor({ phone: null })).toContain('phone');
  });
  it('phone: "" → ปฏิเสธ', async () => {
    expect(await errorsFor({ phone: '' })).toContain('phone');
  });
  it('phone ถูกรูปแบบ → ผ่าน', async () => {
    expect(await errorsFor({ phone: '0812345678' })).not.toContain('phone');
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าแดง** — `npx jest src/modules/customers/dto/customer.dto.phone.spec.ts --runInBand` → เทส `phone: null` FAIL (`@IsOptional` ปล่อย null ผ่าน)

- [ ] **Step 3: แก้ DTO**

```ts
  // ไม่ส่ง = คงเบอร์เดิม · ส่ง null/ว่าง = ปฏิเสธ (ห้ามล้างเบอร์ของคนที่มีเบอร์แล้ว — สเปค 3.6)
  @ValidateIf((o) => o.phone !== undefined)
  @IsString()
  @Matches(/^0[0-9]{9}$/, { message: 'เบอร์โทรต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0' })
  phone?: string;
```
(`ValidateIf` import อยู่แล้วบรรทัด 1)

- [ ] **Step 4: รันให้เขียว** — `npx jest src/modules/customers --runInBand` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/customers/dto/customer.dto.ts apps/api/src/modules/customers/dto/customer.dto.phone.spec.ts
git commit -m "fix(customers): PATCH /customers/:id ห้ามล้างเบอร์ (phone null/ว่าง = 400)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: endpoint รวม `POST /customers/:id/absorb-into/:targetId`

**Files:**
- Modify: `apps/api/src/modules/customers/customers.controller.ts:40-46` (constructor), เพิ่ม handler หลัง `@Patch(':id')`
- Modify: `apps/api/src/modules/customers/customers.module.ts` (imports `ChatProspectsModule`)
- Test: `apps/api/src/modules/customers/customers.controller.spec.ts` (เพิ่ม provider + 1 เทส)

**Interfaces:**
- Consumes: `CustomerMergeService.absorbPlaceholder` (Task 8)
- Produces: `POST /customers/:id/absorb-into/:targetId` → `AbsorbResult` · roles `OWNER, BRANCH_MANAGER, FINANCE_MANAGER, SALES` (เท่ากับผูกห้อง) · 409/404/400 ส่งต่อจากบริการ

- [ ] **Step 1: เทสแดง**

ใน `customers.controller.spec.ts`: import `CustomerMergeService` จาก `'../chat-prospects/customer-merge.service'` · ประกาศ `const merge = { absorbPlaceholder: jest.fn().mockResolvedValue({ placeholderId: 'p1', targetId: 't1', movedRooms: 1, movedCreditChecks: 0 }) };` · เพิ่ม `{ provide: CustomerMergeService, useValue: merge }` ใน providers · เพิ่ม:
```ts
  it('absorbInto ส่งต่อไป CustomerMergeService พร้อม actor', async () => {
    const req = { user: { id: 'staff-1', role: 'SALES' } } as any;
    await expect(controller.absorbInto('p1', 't1', req)).resolves.toEqual({ placeholderId: 'p1', targetId: 't1', movedRooms: 1, movedCreditChecks: 0 });
    expect(merge.absorbPlaceholder).toHaveBeenCalledWith('p1', 't1', { id: 'staff-1', role: 'SALES' });
  });
```

- [ ] **Step 2: รันให้เห็นว่าแดง** — `npx jest src/modules/customers/customers.controller.spec.ts --runInBand` → FAIL (`controller.absorbInto is not a function`)

- [ ] **Step 3: เขียนโค้ด**

constructor เพิ่ม `private readonly merge: CustomerMergeService,` · handler:
```ts
  /** รวมผู้สนใจอัตโนมัติจากแชท (:id) เข้าลูกค้าเดิม (:targetId) — ใช้ตอนเติมเบอร์แล้วซ้ำ (สเปค 3.3 ข) */
  @Post(':id/absorb-into/:targetId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  absorbInto(
    @Param('id') id: string,
    @Param('targetId') targetId: string,
    @Req() req: { user: { id: string; role: string } },
  ) {
    return this.merge.absorbPlaceholder(id, targetId, { id: req.user.id, role: req.user.role });
  }
```
`customers.module.ts`: `imports: [OverdueModule, CustomerPiiModule, ContactsModule, TestModeModule, CreditCheckModule, ChatProspectsModule]`

- [ ] **Step 4: รันให้เขียว** — `npx jest src/modules/customers --runInBand` → PASS · tsc 0

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/customers/customers.controller.ts apps/api/src/modules/customers/customers.controller.spec.ts apps/api/src/modules/customers/customers.module.ts
git commit -m "feat(customers): POST /customers/:id/absorb-into/:targetId รวมผู้สนใจอัตโนมัติเข้าลูกค้าเดิม" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: รายละเอียดห้อง — `customer.chatPlaceholder` + `possibleSamePerson` + กด "ไม่ใช่"

**Files:**
- Create: `apps/api/src/modules/chat-prospects/same-person.service.ts` (+ `.spec.ts`)
- Modify: `apps/api/src/modules/chat-prospects/chat-prospects.module.ts` (provider/export)
- Modify: `apps/api/src/modules/chat-engine/services/room-manager.service.ts:631` (`findById` select ลูกค้าเพิ่ม `acquisitionSource`)
- Modify: `apps/api/src/modules/staff-chat/staff-chat.controller.ts:67-80` (constructor), `:144-168` (`getRoom`), เพิ่ม handler dismiss
- Test: `apps/api/src/modules/staff-chat/staff-chat.controller.spec.ts` (เพิ่ม provider + 2 เทส)

**Interfaces:**
- Produces:
  - `interface PossibleSamePerson { customerId: string; name: string; channel: 'LINE' | 'FACEBOOK' | 'TIKTOK' | 'WEB' | null; hasPhone: boolean; chatPlaceholder: boolean; createdAt: Date; mergeDirection: 'absorb_current_into_other' | 'absorb_other_into_current' | 'none' }`
  - `SamePersonService.findForRoom(roomId: string): Promise<PossibleSamePerson[]>` (สูงสุด 3)
  - `SamePersonService.dismiss(roomId: string, customerId: string): Promise<void>`
  - `GET /staff-chat/rooms/:id` → `{ ...room, customer: { …, chatPlaceholder }, possibleSamePerson }`
  - `PATCH /staff-chat/rooms/:id/same-person/dismiss` body `{ customerId }` → `{ success: true }`

- [ ] **Step 1: เทสแดง (บริการ)**

`same-person.service.spec.ts`:
```ts
import { SamePersonService } from './same-person.service';

const me = { id: 'p1', name: 'สมชาย ใจดี', facebookName: 'สมชาย ใจดี', acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null, deletedAt: null };
const room = { id: 'room-1', channel: 'FACEBOOK', customerId: 'p1', dismissedSamePersonIds: [] as string[], customer: me };
const cand = (over: Partial<any>) => ({
  id: 'c', name: 'สมชาย ใจดี', facebookName: null, phone: null, nationalId: null, acquisitionSource: 'CHAT_LINE_SHOP',
  createdAt: new Date('2026-09-03'), chatRooms: [{ channel: 'LINE_SHOP' }], ...over,
});

function build(candidates: any[], r = room) {
  const prisma: any = {
    chatRoom: { findUnique: jest.fn().mockResolvedValue(r), update: jest.fn().mockResolvedValue({}) },
    customer: { findMany: jest.fn().mockResolvedValue(candidates) },
  };
  return { prisma, service: new SamePersonService(prisma) };
}

describe('SamePersonService.findForRoom', () => {
  it('ชื่อตรงกัน (หลัง normalize) ในช่องทางอื่น → ขึ้นคำใบ้ ทิศทาง: ห้องนี้ placeholder ดูดเข้าอีกคน', async () => {
    const { service } = build([cand({ id: 'c-line', name: 'นาย สมชาย ใจดี', phone: '0812345678' })]);
    const res = await service.findForRoom('room-1');
    expect(res).toEqual([{ customerId: 'c-line', name: 'นาย สมชาย ใจดี', channel: 'LINE', hasPhone: true, chatPlaceholder: false, createdAt: new Date('2026-09-03'), mergeDirection: 'absorb_current_into_other' }]);
  });
  it('ชื่อคล้ายแต่ไม่ตรง → ไม่ขึ้น', async () => {
    const { service } = build([cand({ id: 'c2', name: 'สมชาย ใจดีมาก' })]);
    await expect(service.findForRoom('room-1')).resolves.toEqual([]);
  });
  it('ช่องทางเดียวกันและไม่มีเบอร์ → ไม่ขึ้น (คนละ PSID = คนละคน)', async () => {
    const { service } = build([cand({ id: 'c3', chatRooms: [{ channel: 'FACEBOOK' }] })]);
    await expect(service.findForRoom('room-1')).resolves.toEqual([]);
  });
  it('เรียงคนมีเบอร์ก่อน แล้วเก่าก่อน · สูงสุด 3', async () => {
    const { service } = build([
      cand({ id: 'a', createdAt: new Date('2026-09-05') }),
      cand({ id: 'b', phone: '0899999999', createdAt: new Date('2026-09-09') }),
      cand({ id: 'c', createdAt: new Date('2026-09-01') }),
      cand({ id: 'd', createdAt: new Date('2026-09-02') }),
    ]);
    expect((await service.findForRoom('room-1')).map((p) => p.customerId)).toEqual(['b', 'c', 'd']);
  });
  it('ทิศทางรวม: ห้องนี้คนจริง อีกคน placeholder → ดูดอีกคนเข้าห้องนี้ · placeholder ทั้งคู่ → ใหม่เข้าเก่า · คนจริงทั้งคู่ → none', async () => {
    const realMe = { ...room, customer: { ...me, phone: '0811111111' } };
    let r = await build([cand({ id: 'x' })], realMe).service.findForRoom('room-1');
    expect(r[0].mergeDirection).toBe('absorb_other_into_current');
    r = await build([cand({ id: 'y', createdAt: new Date('2026-09-20') })], { ...room, customer: { ...me, createdAt: new Date('2026-09-10') } } as any).service.findForRoom('room-1');
    expect(r[0].mergeDirection).toBe('absorb_other_into_current'); // อีกคนใหม่กว่า → เข้าห้องนี้ (เก่ากว่า)
    r = await build([cand({ id: 'z', phone: '0822222222' })], realMe).service.findForRoom('room-1');
    expect(r[0].mergeDirection).toBe('none');
  });
  it('คนที่กด "ไม่ใช่" แล้วถูกตัดออกตั้งแต่ query', async () => {
    const { service, prisma } = build([], { ...room, dismissedSamePersonIds: ['c-no'] });
    await service.findForRoom('room-1');
    expect(prisma.customer.findMany.mock.calls[0][0].where.id).toEqual({ not: 'p1', notIn: ['c-no'] });
  });
  it('dismiss → push customerId ลง dismissedSamePersonIds', async () => {
    const { service, prisma } = build([]);
    await service.dismiss('room-1', 'c-no');
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({ where: { id: 'room-1' }, data: { dismissedSamePersonIds: { push: 'c-no' } } });
  });
});
```
(เทสทิศทาง "placeholder ทั้งคู่" ต้องให้ห้องนี้มี `customer.createdAt` — เพิ่ม `createdAt` ใน select ของบริการ ดู Step 3)

- [ ] **Step 2: รันให้เห็นว่าแดง** — `npx jest src/modules/chat-prospects/same-person.service.spec.ts --runInBand` → FAIL (module ไม่มี)

- [ ] **Step 3: เขียนบริการ**

`same-person.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { chatLogoOf, normalizePersonName, type ChatLogo } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { isChatPlaceholder } from './chat-placeholder';

export interface PossibleSamePerson {
  customerId: string;
  name: string;
  channel: ChatLogo | null;
  hasPhone: boolean;
  chatPlaceholder: boolean;
  createdAt: Date;
  mergeDirection: 'absorb_current_into_other' | 'absorb_other_into_current' | 'none';
}

const MAX_HINTS = 3;
const SCAN_LIMIT = 50;

/**
 * คำใบ้ "อาจเป็นคนเดียวกัน" (สเปค 3.6): ชื่อตรงกันเป๊ะหลัง normalize ในช่องทางอื่น หรือคนที่มีเบอร์แล้ว
 * ไม่ทำ fuzzy · ไม่รวมอัตโนมัติ · พนักงานกด "รวม" หรือ "ไม่ใช่" (dismiss เก็บที่ห้อง)
 */
@Injectable()
export class SamePersonService {
  constructor(private readonly prisma: PrismaService) {}

  async findForRoom(roomId: string): Promise<PossibleSamePerson[]> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: {
        id: true, channel: true, customerId: true, dismissedSamePersonIds: true,
        customer: { select: { id: true, name: true, facebookName: true, acquisitionSource: true, phone: true, nationalId: true, createdAt: true, deletedAt: true } },
      },
    });
    const me = room?.customer;
    if (!room || !me || me.deletedAt) return [];
    const keys = [...new Set([normalizePersonName(me.name), normalizePersonName(me.facebookName)].filter(Boolean))];
    if (keys.length === 0) return [];

    // ค้นหยาบด้วย contains (ไม่สนตัวพิมพ์) แล้วกรอง "ตรงเป๊ะหลัง normalize" ใน JS — ตัดคำนำหน้า/ช่องว่างซ้ำไม่ได้ใน SQL
    const candidates = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        id: { not: me.id, notIn: room.dismissedSamePersonIds },
        OR: keys.flatMap((k) => [
          { name: { contains: k, mode: 'insensitive' as const } },
          { facebookName: { contains: k, mode: 'insensitive' as const } },
        ]),
      },
      select: {
        id: true, name: true, facebookName: true, phone: true, nationalId: true, acquisitionSource: true, createdAt: true,
        chatRooms: { where: { deletedAt: null }, orderBy: { lastMessageAt: 'desc' }, take: 1, select: { channel: true } },
      },
      take: SCAN_LIMIT,
    });

    const mePlaceholder = isChatPlaceholder(me);
    return candidates
      .filter((c) => keys.includes(normalizePersonName(c.name)) || keys.includes(normalizePersonName(c.facebookName)))
      .map((c) => {
        const channelRaw = c.chatRooms[0]?.channel ?? null;
        const hasPhone = !!c.phone;
        const otherPlaceholder = isChatPlaceholder(c);
        return {
          customerId: c.id,
          name: c.name,
          channel: channelRaw ? chatLogoOf(channelRaw) : null,
          hasPhone,
          chatPlaceholder: otherPlaceholder,
          createdAt: c.createdAt,
          differentChannel: !!channelRaw && channelRaw !== room.channel,
          mergeDirection: this.direction(mePlaceholder, me.createdAt, otherPlaceholder, c.createdAt),
        };
      })
      .filter((c) => c.hasPhone || c.differentChannel)
      .sort((a, b) => Number(b.hasPhone) - Number(a.hasPhone) || a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, MAX_HINTS)
      .map(({ differentChannel: _d, ...rest }) => rest);
  }

  /** สเปค 3.6: ห้องนี้ placeholder → เข้าอีกคน · อีกคน placeholder + ห้องนี้จริง → เข้าห้องนี้ · ทั้งคู่ placeholder → ใหม่เข้าเก่า · จริงทั้งคู่ → ไม่มีปุ่ม */
  private direction(mePlaceholder: boolean, meCreatedAt: Date, otherPlaceholder: boolean, otherCreatedAt: Date): PossibleSamePerson['mergeDirection'] {
    if (mePlaceholder && !otherPlaceholder) return 'absorb_current_into_other';
    if (!mePlaceholder && otherPlaceholder) return 'absorb_other_into_current';
    if (mePlaceholder && otherPlaceholder) return meCreatedAt <= otherCreatedAt ? 'absorb_other_into_current' : 'absorb_current_into_other';
    return 'none';
  }

  async dismiss(roomId: string, customerId: string): Promise<void> {
    await this.prisma.chatRoom.update({ where: { id: roomId }, data: { dismissedSamePersonIds: { push: customerId } } });
  }
}
```
`chat-prospects.module.ts`: เพิ่ม `SamePersonService` ใน providers + exports

- [ ] **Step 4: รันบริการให้เขียว** — `npx jest src/modules/chat-prospects/same-person.service.spec.ts --runInBand` → PASS

- [ ] **Step 5: เทสแดง (controller)**

ใน `staff-chat.controller.spec.ts`: เพิ่ม provider `{ provide: SamePersonService, useValue: samePerson }` โดย `samePerson = { findForRoom: jest.fn().mockResolvedValue([]), dismiss: jest.fn().mockResolvedValue(undefined) }` (import จาก `'../chat-prospects/same-person.service'`) แล้วเพิ่ม:
```ts
  it('getRoom ติดธง chatPlaceholder และแนบ possibleSamePerson', async () => {
    roomManager.findById.mockResolvedValue({ id: 'r1', assignedToId: null, customer: { id: 'p1', name: 'Facebook #7890', phone: null, nationalId: null, acquisitionSource: 'CHAT_FACEBOOK' } });
    samePerson.findForRoom.mockResolvedValue([{ customerId: 'c2' }]);
    const res = await controller.getRoom('r1', { user: { id: 'u', role: 'OWNER' } } as any);
    expect(res.customer).toMatchObject({ chatPlaceholder: true });
    expect(res.possibleSamePerson).toEqual([{ customerId: 'c2' }]);
  });
  it('dismissSamePerson ต้องมี customerId แล้วส่งต่อ', async () => {
    await expect(controller.dismissSamePerson('r1', '')).rejects.toThrow('กรุณาระบุ customerId');
    await expect(controller.dismissSamePerson('r1', 'c2')).resolves.toEqual({ success: true });
    expect(samePerson.dismiss).toHaveBeenCalledWith('r1', 'c2');
  });
```

- [ ] **Step 6: เขียน controller + select**

`room-manager.service.ts` `findById`: `customer: { select: { id: true, name: true, phone: true, nationalId: true, acquisitionSource: true } },`

`staff-chat.controller.ts`: constructor เพิ่ม `private samePerson: SamePersonService,` (import จาก `'../chat-prospects/same-person.service'`; `isChatPlaceholder` จาก `'../chat-prospects/chat-placeholder'`) · ใน `getRoom` แทนสองบรรทัดท้าย (redact + `return room;`) ด้วย:
```ts
    const customer = room.customer
      ? { ...room.customer, chatPlaceholder: isChatPlaceholder(room.customer) }
      : null;
    const possibleSamePerson = customer ? await this.samePerson.findForRoom(id) : [];
    // PDPA: SALES ที่ไม่ได้ถือห้องนี้ต้องไม่เห็นเลขบัตร (เดิม)
    const redacted = req.user.role === 'SALES' && room.assignedToId !== req.user.id && customer
      ? { ...customer, nationalId: null }
      : customer;
    return { ...room, customer: redacted, possibleSamePerson };
```
เพิ่ม handler:
```ts
  /** กด "ไม่ใช่" บนคำใบ้อาจเป็นคนเดียวกัน — ไม่ถามซ้ำสำหรับคนนั้น (สเปค 3.6) */
  @Patch('rooms/:id/same-person/dismiss')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async dismissSamePerson(@Param('id') id: string, @Body('customerId') customerId: string) {
    if (!customerId || typeof customerId !== 'string') throw new BadRequestException('กรุณาระบุ customerId');
    await this.samePerson.dismiss(id, customerId);
    return { success: true };
  }
```

- [ ] **Step 7: รันให้เขียว** — `npx jest src/modules/staff-chat src/modules/chat-engine src/modules/chat-prospects --runInBand` → PASS · tsc 0

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/chat-prospects/same-person.service.ts apps/api/src/modules/chat-prospects/same-person.service.spec.ts apps/api/src/modules/chat-prospects/chat-prospects.module.ts apps/api/src/modules/chat-engine/services/room-manager.service.ts apps/api/src/modules/staff-chat/staff-chat.controller.ts apps/api/src/modules/staff-chat/staff-chat.controller.spec.ts
git commit -m "feat(staff-chat): รายละเอียดห้องมี chatPlaceholder + คำใบ้อาจเป็นคนเดียวกัน + กดไม่ใช่" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: CLI ย้อนหลัง `backfill-chat-prospects` (dry-run เป็นค่าตั้งต้น)

**Files:**
- Create: `apps/api/src/cli/backfill-chat-prospects.cli.ts`
- Create: `apps/api/src/cli/backfill-chat-prospects.spec.ts`
- Modify: `apps/api/package.json` (scripts)

**Interfaces:**
- Consumes: `ChatProspectService.ensureForRoom` (Task 5)
- Produces: `planBackfill(prisma): Promise<BackfillPlan>` · `runBackfill(prisma, service, opts: { batchSize: number; log: (line: string) => void }): Promise<BackfillResult>` · npm script `backfill:chat-prospects` (+ `:help`)
  - `BackfillPlan = { rooms: number; persons: number; personsWithExistingCustomer: number; roomsWithoutName: number; byChannel: Record<string, number> }`
  - `BackfillResult = { processed: number; created: number; linkedExisting: number; skipped: number; failed: number }`

- [ ] **Step 1: เทสแดง**

`backfill-chat-prospects.spec.ts`:
```ts
import { planBackfill, runBackfill } from './backfill-chat-prospects.cli';

const rooms = [
  { id: 'r1', channel: 'FACEBOOK', lineUserId: null, externalUserId: 'psid-a', displayName: 'A', createdAt: new Date('2026-05-12') },
  { id: 'r2', channel: 'FACEBOOK', lineUserId: null, externalUserId: 'psid-a', displayName: null, createdAt: new Date('2026-06-01') }, // ห้องซ้ำของ A
  { id: 'r3', channel: 'LINE_SHOP', lineUserId: 'Ub', externalUserId: null, displayName: 'B', createdAt: new Date('2026-07-01') },
];

describe('planBackfill', () => {
  it('นับห้อง/คน (จัดกลุ่มช่องทาง+รหัส)/คนที่มีลูกค้าเดิม/ห้องไม่มีชื่อ', async () => {
    const prisma: any = {
      chatRoom: { findMany: jest.fn().mockResolvedValue(rooms) },
      customer: { findFirst: jest.fn(({ where }: any) => Promise.resolve(where.lineIdShop === 'Ub' ? { id: 'cust-b' } : null)) },
      customerLineLink: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    await expect(planBackfill(prisma)).resolves.toEqual({
      rooms: 3, persons: 2, personsWithExistingCustomer: 1, roomsWithoutName: 1, byChannel: { FACEBOOK: 2, LINE_SHOP: 1 },
    });
    expect(prisma.chatRoom.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null, customerId: null },
      select: { id: true, channel: true, lineUserId: true, externalUserId: true, displayName: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  });
});

describe('runBackfill', () => {
  it('เรียก ensureForRoom เรียงตาม createdAt ทีละชุด และนับผล', async () => {
    const prisma: any = { chatRoom: { findMany: jest.fn().mockResolvedValueOnce(rooms).mockResolvedValueOnce([]) } };
    const service: any = { ensureForRoom: jest.fn()
      .mockResolvedValueOnce({ customerId: 'c1', created: true })
      .mockResolvedValueOnce({ customerId: 'c1', created: false })
      .mockRejectedValueOnce(new Error('boom')) };
    const log = jest.fn();
    await expect(runBackfill(prisma, service, { batchSize: 500, log })).resolves.toEqual({ processed: 3, created: 1, linkedExisting: 1, skipped: 0, failed: 1 });
    expect(service.ensureForRoom.mock.calls.map((c: any[]) => c[0])).toEqual(['r1', 'r2', 'r3']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('r3'));
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าแดง** — `npx jest src/cli/backfill-chat-prospects.spec.ts --runInBand` → FAIL

- [ ] **Step 3: เขียน CLI**

`apps/api/src/cli/backfill-chat-prospects.cli.ts`:
```ts
/**
 * ย้อนหลัง "ผู้สนใจอัตโนมัติจากแชท" ให้ห้องแชทเดิมที่ยังไม่มีเจ้าของ
 * (docs/superpowers/specs/2026-09-13-chat-prospects-design.md §3.5)
 *
 * ทำงานผ่าน ChatProspectService.ensureForRoom ตัวเดียวกับ runtime — ไม่มีสำเนาตรรกะที่สอง:
 * ห้องเรียงตาม created_at จากเก่าไปใหม่ ⇒ ห้องแรกของคนหนึ่งสร้างแถว (createdAt = วันทักครั้งแรก)
 * ห้องถัดไปของคนเดียวกันเจอ sibling ที่ผูกแล้ว ⇒ ใช้คนเดิม · รันซ้ำได้ (ห้องที่ผูกแล้วถูกข้ามตั้งแต่ query)
 *
 * GUARDS (แบบเดียวกับ backfill-payment-receipts.cli.ts)
 * - EXPECTED_DB_NAME ต้องตรง current_database() ไม่งั้น exit 1
 * - DRY-RUN เป็นค่าตั้งต้น: พิมพ์แผน ไม่เขียนอะไร
 * - CONFIRM_BACKFILL=YES_I_AM_SURE จึงเขียน · NODE_ENV=production ต้องมี ALLOW_PROD_BACKFILL=YES_I_AM_SURE ด้วย
 *
 * ใช้:  EXPECTED_DB_NAME=bestchoice_prod npm --prefix apps/api run backfill:chat-prospects            (dry-run)
 *       CONFIRM_BACKFILL=YES_I_AM_SURE ALLOW_PROD_BACKFILL=YES_I_AM_SURE NODE_ENV=production \
 *       EXPECTED_DB_NAME=bestchoice_prod npm --prefix apps/api run backfill:chat-prospects            (เขียนจริง)
 *       BATCH_SIZE=500 ปรับได้ · dev: DATABASE_URL=… npx tsx src/cli/backfill-chat-prospects.cli.ts
 */
import { PrismaClient } from '@prisma/client';
import { ChatProspectService } from '../modules/chat-prospects/chat-prospect.service';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';
const ROOM_SELECT = { id: true, channel: true, lineUserId: true, externalUserId: true, displayName: true, createdAt: true } as const;

type Db = Pick<PrismaClient, 'chatRoom' | 'customer' | 'customerLineLink'>;
type Room = { id: string; channel: string; lineUserId: string | null; externalUserId: string | null; displayName: string | null; createdAt: Date };

export interface BackfillPlan { rooms: number; persons: number; personsWithExistingCustomer: number; roomsWithoutName: number; byChannel: Record<string, number> }
export interface BackfillResult { processed: number; created: number; linkedExisting: number; skipped: number; failed: number }

const personKey = (r: Room) => `${r.channel}:${r.lineUserId ?? r.externalUserId ?? ''}`;

/** แผน (dry-run): ห้องที่ยังไม่มีเจ้าของ จัดกลุ่มเป็น "คน" และนับคนที่มีลูกค้าเดิมอยู่แล้วทาง LINE */
export async function planBackfill(prisma: Db): Promise<BackfillPlan> {
  const rooms = (await prisma.chatRoom.findMany({
    where: { deletedAt: null, customerId: null },
    select: ROOM_SELECT,
    orderBy: { createdAt: 'asc' },
  })) as Room[];
  const persons = new Map<string, Room>();
  const byChannel: Record<string, number> = {};
  let roomsWithoutName = 0;
  for (const room of rooms) {
    byChannel[room.channel] = (byChannel[room.channel] ?? 0) + 1;
    if (!room.displayName?.trim()) roomsWithoutName++;
    if (!persons.has(personKey(room))) persons.set(personKey(room), room);
  }
  let personsWithExistingCustomer = 0;
  for (const room of persons.values()) {
    if (!room.lineUserId) continue;
    const linkChannel = room.channel === 'LINE_SHOP' ? 'SHOP' : 'FINANCE';
    const link = await prisma.customerLineLink.findUnique({ where: { lineUserId_channel: { lineUserId: room.lineUserId, channel: linkChannel } }, select: { customerId: true } });
    const byColumn = link ? null : await prisma.customer.findFirst({
      where: { ...(room.channel === 'LINE_SHOP' ? { lineIdShop: room.lineUserId } : { lineIdFinance: room.lineUserId }), deletedAt: null },
      select: { id: true },
    });
    if (link || byColumn) personsWithExistingCustomer++;
  }
  return { rooms: rooms.length, persons: persons.size, personsWithExistingCustomer, roomsWithoutName, byChannel };
}

/** เขียนจริง: วนห้องที่ยังไม่มีเจ้าของทีละชุด (query ใหม่ทุกชุด — ห้องที่ผูกแล้วหลุดจากชุดถัดไปเอง) */
export async function runBackfill(
  prisma: Pick<PrismaClient, 'chatRoom'>,
  service: Pick<ChatProspectService, 'ensureForRoom'>,
  opts: { batchSize: number; log: (line: string) => void },
): Promise<BackfillResult> {
  const result: BackfillResult = { processed: 0, created: 0, linkedExisting: 0, skipped: 0, failed: 0 };
  const seen = new Set<string>();
  for (;;) {
    const batch = (await prisma.chatRoom.findMany({
      where: { deletedAt: null, customerId: null },
      select: ROOM_SELECT,
      orderBy: { createdAt: 'asc' },
      take: opts.batchSize,
    })) as Room[];
    const fresh = batch.filter((r) => !seen.has(r.id)); // ห้องที่ล้มรอบก่อนจะยังอยู่ในชุด — ไม่วนซ้ำไม่รู้จบ
    if (fresh.length === 0) break;
    for (const room of fresh) {
      seen.add(room.id);
      result.processed++;
      try {
        const ensured = await service.ensureForRoom(room.id);
        if (!ensured) result.skipped++;
        else if (ensured.created) result.created++;
        else result.linkedExisting++;
      } catch (err) {
        result.failed++;
        opts.log(`FAILED room ${room.id} (${room.channel}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    opts.log(`batch done: processed=${result.processed} created=${result.created} linkedExisting=${result.linkedExisting} failed=${result.failed}`);
  }
  return result;
}

async function assertExpectedDb(prisma: PrismaClient): Promise<void> {
  const expected = process.env.EXPECTED_DB_NAME;
  if (!expected) throw new Error('EXPECTED_DB_NAME is required');
  const [{ current_database }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (current_database !== expected) throw new Error(`DB mismatch: connected to "${current_database}", expected "${expected}"`);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await assertExpectedDb(prisma);
    const plan = await planBackfill(prisma);
    console.log('[plan]', JSON.stringify(plan));
    const confirmed = process.env.CONFIRM_BACKFILL === REQUIRED_CONSENT;
    if (!confirmed) {
      console.log('DRY-RUN — set CONFIRM_BACKFILL=YES_I_AM_SURE to write');
      return;
    }
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_BACKFILL !== REQUIRED_CONSENT) {
      throw new Error('production requires ALLOW_PROD_BACKFILL=YES_I_AM_SURE');
    }
    const service = new ChatProspectService(prisma as never);
    const result = await runBackfill(prisma, service, { batchSize: Number(process.env.BATCH_SIZE ?? 500), log: (l) => console.log('[run]', l) });
    console.log('[result]', JSON.stringify(result));
    if (result.failed > 0) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
```
`apps/api/package.json` scripts (วางถัดจาก `backfill:receipts:help`):
```json
    "backfill:chat-prospects": "node dist/src/cli/backfill-chat-prospects.cli.js",
    "backfill:chat-prospects:help": "echo 'Dry-run default: EXPECTED_DB_NAME=<db> npm --prefix apps/api run backfill:chat-prospects. To write: CONFIRM_BACKFILL=YES_I_AM_SURE EXPECTED_DB_NAME=<db> [ALLOW_PROD_BACKFILL=YES_I_AM_SURE NODE_ENV=production] npm --prefix apps/api run backfill:chat-prospects'",
```

- [ ] **Step 4: รันให้เขียว + ลองจริงกับฐานทดสอบ** — `npx jest src/cli/backfill-chat-prospects.spec.ts --runInBand` → PASS · `DATABASE_URL=…/test_db EXPECTED_DB_NAME=test_db npx tsx src/cli/backfill-chat-prospects.cli.ts` → พิมพ์ `[plan]` แล้ว `DRY-RUN` · เพิ่ม `CONFIRM_BACKFILL=YES_I_AM_SURE` → `[result]` และ `SELECT count(*) FROM chat_rooms WHERE deleted_at IS NULL AND customer_id IS NULL` = 0

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cli/backfill-chat-prospects.cli.ts apps/api/src/cli/backfill-chat-prospects.spec.ts apps/api/package.json
git commit -m "feat(cli): backfill-chat-prospects — ย้อนหลังผู้สนใจอัตโนมัติให้ห้องแชทเดิม (dry-run default, จัดกลุ่มต่อคน)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: ตรวจรวม · bump version · เปิด PR (ยังไม่ merge — เจ้าของสั่ง)

**Files:**
- Modify: `apps/web/package.json` (`"version": "26.9.24"` → `"26.9.25"`)

- [ ] **Step 1: ชุดทดสอบทั้งหมดที่แตะ**

Run (จาก `apps/api`):
```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/chat-prospects src/modules/chat-engine src/modules/chatbot-finance src/modules/line-oa src/modules/staff-chat src/modules/sales-bot src/modules/customers src/modules/contracts src/modules/sales src/modules/bookings src/modules/overdue src/utils src/cli --runInBand
DATABASE_URL=postgresql://…/test_db npx jest src/modules/chat-prospects/chat-prospect.service.db.spec.ts --runInBand
npx eslint $(git diff --name-only origin/main -- 'apps/api/src/**/*.ts' | sed 's#^apps/api/##')
```
Expected: tsc 0 · jest ผ่านทั้งหมด (suite ที่แดงเพราะ `DATABASE_URL` ไม่มี = ของเดิม เทียบกับ `origin/main`) · eslint 0 error (warning เดิมปล่อยได้)
Run (จาก root): `npx vitest run packages/shared` → PASS

- [ ] **Step 2: bump version + commit**

แก้ `apps/web/package.json` version เป็น `26.9.25` (กติกา bump ทุก deploy — pipeline deploy ทั้ง API และ web)
```bash
git add apps/web/package.json
git commit -m "chore(web): bump version 26.9.25" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 3: push + PR (ไม่ merge เอง)**

```bash
git fetch origin && git diff --stat origin/main   # ต้องเห็นเฉพาะไฟล์ของแผนนี้
git push -u origin feat/chat-prospects
gh pr create --title "feat: ผู้สนใจจากแชท — ทุกห้องแชทมีเจ้าของเป็นผู้สนใจ (API + migration + backfill)" --body-file - <<'EOF'
## อะไร
ทุกห้องแชท (FB / LINE ร้าน / LINE การเงิน / TikTok / เว็บ) มีแถว `customers` เป็น "ผู้สนใจอัตโนมัติ" ตั้งแต่ทักมา — หนึ่งคนหนึ่งแถวต่อช่องทาง · รวมเข้าลูกค้าจริงเมื่อรู้เบอร์/ผูก LINE · ตัวกรอง "ที่มา" + KPI "มาจากแชท" ในแท็บลูกค้า · CLI ย้อนหลัง 8,866 ห้อง
สเปค: `docs/superpowers/specs/2026-09-13-chat-prospects-design.md` · แผน: `docs/superpowers/plans/2026-09-13-chat-prospects-api.md` · หน้าจอ = Plan 2 (mockup https://claude.ai/code/artifact/1388f98e-0659-41c7-acb4-c61766ac364d)

## Migration
`20261001100000_chat_prospects_phone_nullable` — `customers.phone` DROP NOT NULL + `chat_rooms.dismissed_same_person_ids text[]` (pipeline deploy รัน migrations ก่อน API)

## หลัง deploy (ทำตามลำดับ)
1. นับ PSID ซ้ำผ่าน cloud-sql-proxy: `SELECT count(*) FROM (SELECT external_user_id FROM chat_rooms WHERE deleted_at IS NULL AND channel='FACEBOOK' GROUP BY 1 HAVING count(*)>1) d;`
2. Cloud Run job จาก image API เดียวกัน command `node dist/src/cli/backfill-chat-prospects.cli.js` env `EXPECTED_DB_NAME=<prod db>` → dry-run อ่าน `[plan]`
3. รันจริง: เพิ่ม env `CONFIRM_BACKFILL=YES_I_AM_SURE ALLOW_PROD_BACKFILL=YES_I_AM_SURE NODE_ENV=production`
4. ตรวจ: `SELECT count(*) FROM chat_rooms WHERE deleted_at IS NULL AND customer_id IS NULL;` = 0 · `SELECT count(*) FROM customers WHERE deleted_at IS NULL AND acquisition_source LIKE 'CHAT_%';` ≈ จำนวนคน · เปิด /customers?view=prospects ตัวเลขตรง

## เทส
jest ทุก suite ที่แตะ + `.db.spec` race + vitest shared (ดูแผน Task 18)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```
Expected: PR เปิด · CI เขียว (E2E ที่แดงมาก่อนอยู่แล้วเทียบกับ run ของ PR ก่อนหน้า) · **ห้าม merge เอง** — แจ้งเจ้าของพร้อมลิงก์ PR และคำเตือนว่าต้องรัน backfill หลัง deploy

- [ ] **Step 4: บันทึก memory** — อัปเดต `bestchoice-chat-prospects.md` (สถานะ PR, ขั้นตอน backfill, สิ่งที่ค้าง = Plan 2 เว็บ)

---

## Self-review (ทำแล้วตอนเขียนแผน)

- **ครอบสเปค:** 3.1 ข้อมูล → T2/T4/T5 · 3.2 หน่วยนับ+ล็อก+จุดเรียก 3 จุด → T5/T6/T7/T17 · 3.3 รวม (ก)(ข)(ค)(ง) → T9/T15/T11/T10 · 3.4 prepare-offer/chat-commerce/capture-lead → T12 · 3.5 backfill → T17 · 3.6 ฝั่ง API ของหน้าจอ (chatPlaceholder, possibleSamePerson, dismiss, KPI, ที่มา) → T13/T16 · phone nullable 11 ไฟล์ → T3 · 3.8 เทส → ทุก task · 3.9 ลำดับขึ้น prod → T18
- **ไม่ได้อยู่ในแผนนี้ (ตั้งใจ):** หน้าจอทั้งหมด (Plan 2) · คอลัมน์ "ที่มา" ใน Excel ฝั่งเว็บ (Plan 2 — API ส่ง `source` แล้วใน T13) · partial unique index ห้องซ้ำ (follow-up ตามสเปค 3.10)
- **ชื่อ/ลายเซ็นตรงกันข้าม task:** `ensureForRoom` (T5→T6/T7/T17) · `absorbPlaceholder(placeholderId, targetId, actor, opts?)` (T8→T9/T10/T11/T15) · `absorbRoomsOfLineUser(lineUserId, channel, customerId, actor)` (T10) · `SYSTEM_ACTOR` (T10→T11) · `isChatPlaceholder` (T4→T9/T10/T11/T12/T13/T16) · `offerContractPolicy` (T12) · `findForRoom`/`dismiss` (T16)

