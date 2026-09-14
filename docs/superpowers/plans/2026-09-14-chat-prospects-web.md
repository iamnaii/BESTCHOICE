# ผู้สนใจจากแชท — แผนงานฝั่งเว็บ + API เติมเบอร์ (Plan 2 ของ 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้าจอใช้ "ผู้สนใจอัตโนมัติ" ที่ Plan 1 (PR #1592) สร้างไว้ได้จริง — การ์ดผู้สนใจในแผงขวาของอินบ็อกซ์ (เติมเบอร์ · ผูกกับลูกค้าเดิม · คำใบ้อาจเป็นคนเดียวกัน · เบอร์ซ้ำ→รวม) ตาม mockup 6 บอร์ดที่เจ้าของเคาะ 2026-09-13 + หน้ารายชื่อ/รายละเอียด/ตัวเลือกลูกค้ารู้จักผู้สนใจที่ยังไม่มีเบอร์ + KPI "มาจากแชท" กดแล้วกรอง + กันส่งออกเกิน 10,000 — และปิดช่องว่างที่ Plan 1 พบ: พนักงานขาย (SALES) ต้องเติมเบอร์ให้ผู้สนใจได้ (`PATCH /customers/:id` เป็น OWNER/BM เท่านั้น — Ruling R27)

**Architecture:** เว็บ **ไม่ derive** ว่าใครเป็น placeholder — ใช้ธง `chatPlaceholder` ที่ API ส่งมาเท่านั้น (R6/R15) · เพิ่ม endpoint เดียวฝั่ง API `POST /customers/:id/fill-contact` (เติมเบอร์ให้ placeholder เท่านั้น, roles เท่าทางผูกห้อง, SALES ผ่านด่านห้องเดียวกับ `absorb-into` — R26) · ฟอร์มสร้างลูกค้าตัวเดิม (`CustomerCreateDialog`) ได้โหมด `fill` แทนสร้างฟอร์มใหม่ · การ์ดผู้สนใจอยู่ใน `RoomDossier` แทนกล่องเหลือง โดยกล่องเหลืองยังอยู่สำหรับห้องที่ไม่มีเจ้าของจริง ๆ (ห้องเว็บก่อนข้อความแรก / เจ้าของถูกลบ) · หน้ารายชื่อเพิ่มการ์ด KPI ใบที่ 6 + ตัวกรอง "ที่มา" ทั้งสองแท็บ โดยไม่เพิ่มคอลัมน์ (กติกา #1557)

**Tech Stack:** React 18 + TS + Vite + Tailwind + shadcn (`apps/web`, vitest + testing-library) · NestJS 10 + Prisma (`apps/api`, jest `--runInBand`) · copy ภาษาไทย inline ตามกติกา repo

**Spec:** `docs/superpowers/specs/2026-09-13-chat-prospects-design.md` §3.6 (หน้าจอ) + §3.3 ข (เบอร์ซ้ำ→รวม) — อ่านคู่กันเสมอ · mockup: `https://claude.ai/code/artifact/1388f98e-0659-41c7-acb4-c61766ac364d` (บอร์ด 1 การ์ดผู้สนใจ · 2 คำใบ้ · 3 ฟอร์มเติมเบอร์ · 4 เบอร์ซ้ำ→รวม · 5 หลังรวม) · สำเนา (copy) ในแผนนี้ลอกจากบอร์ดคำต่อคำ · Rulings ของ Plan 1 ที่ผูกแผนนี้: R6/R15 (ธงจาก API เท่านั้น) · R22 (`absorb-into` รับปลายทาง placeholder) · R26 (SALES ต้องผ่าน `assertActorMayAbsorb`) · R27 (ทางเติมเบอร์สำหรับ SALES)

## Global Constraints

- ทำงานใน worktree `BESTCHOICE/.claude/worktrees/feat+chat-prospects-web` branch **`feat/chat-prospects-web`** (ต่อยอดจาก `feat/chat-prospects` = PR #1592 ที่ยังไม่ merge — **PR ของแผนนี้ต้อง base เป็น `feat/chat-prospects` ก่อน แล้ว retarget เป็น `main` หลัง #1592 merge**; ห้าม merge stacked PR โดยไม่ retarget) — **ห้าม `cd` ไป checkout หลัก ห้าม `git add -A`** · ก่อนเริ่ม Task ใด ๆ รัน `npm ci` (ครั้งเดียว) และ `npx prisma generate --schema=apps/api/prisma/schema.prisma` จาก root worktree
- คำสั่งทดสอบเว็บ รันจาก `apps/web`: `npx vitest run <path>` · typecheck `npx tsc --noEmit` (จาก `apps/web`; baseline = 0 error) · lint เฉพาะไฟล์ `npx eslint <files>`
- คำสั่งทดสอบ API รันจาก `apps/api`: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_prospects_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest <path> --runInBand` (ฐาน Postgres แยกของ Plan 1, migration ครบแล้ว; ถ้าฐานไม่รัน: `pg_ctl -D /tmp/bc-chat-prospects-pg/data -l /tmp/bc-chat-prospects-pg/postgres.log start`) · typecheck `npx tsc --noEmit -p apps/api/tsconfig.json` (จาก root worktree) · **ห้าม `npm run lint` ของ apps/api (มี --fix)**
- **ธง placeholder ฝั่งเว็บ = `chatPlaceholder` จาก API เท่านั้น** (`GET /customers?…` ทุก branch · `GET /customers/:id` · `GET /staff-chat/rooms/:id` → `customer.chatPlaceholder`) — ห้ามเขียน `phone == null && source.startsWith('CHAT_')` ในเว็บ
- สำเนา (copy) ตามบอร์ด mockup คำต่อคำ: ป้าย `ผู้สนใจจากแชท` / `ยังไม่มีเบอร์` · ปุ่ม `เพิ่มเบอร์/ข้อมูล` (primary) / `ผูกกับลูกค้าเดิม` (outline) · คำใบ้ `อาจเป็นคนเดียวกับ <ชื่อ> — <ช่องทาง> · <มีเบอร์|ยังไม่มีเบอร์> · ทักเมื่อ <วันที่>` + ปุ่ม `รวมเป็นคนเดียวกัน` / `ไม่ใช่` · ฟอร์ม `เพิ่มเบอร์/ข้อมูลผู้สนใจ` · เบอร์ซ้ำ `เบอร์ <เบอร์> เป็นของลูกค้าเดิมอยู่แล้ว` / `ระบบไม่สร้างซ้ำ — รวมแชทห้องนี้และผลเช็คเครดิตเข้าคนเดิม หรือแก้เบอร์แล้วบันทึกใหม่` + ปุ่ม `รวมกับลูกค้าเดิมคนนี้` / `แก้เบอร์` · ตัวเลือกลูกค้า `จากแชท · ยังไม่มีเบอร์` · KPI `มาจากแชท`
- Design tokens เท่านั้น (ห้าม hex): primary `#0D9668` = `bg-primary`/`text-primary` · warning `#F59F0A` = `warning` · border `#E4E1DD` = `border-border` · ตัวหนังสือรอง = `text-muted-foreground` · การ์ดหมวด = `Group` เดิม (radius 10px) · ปุ่ม `size="sm"` (28px) · ข้อความไทยใช้ `leading-snug`
- ฝั่ง API แตะได้เฉพาะ Task 1 (endpoint เติมเบอร์) และ Task 2 (ข้อความส่งข้อมูลชำระ) · ทุก task: เทสก่อน (แดง) → โค้ดน้อยที่สุด (เขียว) → commit ทันที · commit message ภาษาไทย ลงท้าย `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- ห้ามแก้ `apps/web/package.json` version ยกเว้น Task 8 (bump **26.9.26**)

---

## ผังไฟล์ (สร้าง/แก้)

| หน้าที่ | ไฟล์ |
|---|---|
| API: DTO เติมเบอร์ | `apps/api/src/modules/customers/dto/fill-prospect-contact.dto.ts` (ใหม่) |
| API: เติมเบอร์ให้ placeholder (dedup + PII + audit) | `apps/api/src/modules/customers/services/customer-write.service.ts` (+ `customer-write.fill-contact.db.spec.ts` ใหม่) · facade `customers.service.ts` · route `customers.controller.ts` (+ `customers.controller.spec.ts`) |
| API: ข้อความส่งข้อมูลชำระให้ผู้สนใจ | `apps/api/src/modules/staff-chat/services/chat-commerce.service.ts` (+ `.spec.ts`) |
| เว็บ: สิทธิ์ปุ่มเติมเบอร์ | `apps/web/src/lib/constants.ts` |
| เว็บ: hooks รวม/ไม่ใช่ | `apps/web/src/pages/UnifiedInboxPage/hooks/useProspectActions.ts` (ใหม่, + `.test.tsx`) |
| เว็บ: ฟอร์มโหมดเติมเบอร์ | `apps/web/src/components/customer/CustomerCreateDialog.tsx` (+ `.test.tsx`) · `apps/web/src/lib/schemas.ts` |
| เว็บ: การ์ดผู้สนใจ + คำใบ้ | `apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.tsx` (+ `.test.tsx`) · `LinkCustomerDialog.tsx` |
| เว็บ: หน้ารายชื่อ | `apps/web/src/pages/CustomersPage/{types.ts, hooks/useCustomersQuery.ts, components/CustomerKpiCards.tsx, components/CustomerFilterBar.tsx, components/ProspectFilterBar.tsx, components/sourceLabels.ts (ใหม่), utils/customersExport.ts, index.tsx, __tests__/CustomersPage.test.tsx}` · `apps/web/src/lib/fetch-export-pages.ts` |
| เว็บ: หน้ารายละเอียด + ตัวเลือก | `apps/web/src/pages/CustomerDetailPage.tsx` · `apps/web/src/components/customer/ProspectPhoneLine.tsx` (ใหม่, + `.test.tsx`) · `apps/web/src/pages/ContractCreatePage/{types.ts, components/CustomerSelectStep.tsx}` · `apps/web/src/components/credit-check/{types.tsx, CreditCheckCreateModal.tsx}` · `apps/web/src/pages/BookingsPage.tsx` |

สัญญาข้อมูลจาก Plan 1 ที่แผนนี้พึ่ง (ไม่ต้องแก้):
- `GET /staff-chat/rooms/:id` → `{ …, customerId, customer: { id, name, phone: string|null, chatPlaceholder: boolean }, possibleSamePerson: PossibleSamePerson[] }` โดย `PossibleSamePerson = { customerId, name, channel: 'FACEBOOK'|'LINE_SHOP'|'LINE_FINANCE'|'TIKTOK'|'WEB', hasPhone: boolean, chatPlaceholder: boolean, createdAt: string, mergeDirection: 'absorb_current_into_other'|'absorb_other_into_current'|'none' }` (สูงสุด 3)
- `PATCH /staff-chat/rooms/:id/same-person/dismiss` body `{ customerId }` (roles OWNER/BM/FM/SALES, SALES ต้องเป็นห้องตัวเอง/ไม่มีคนถือ)
- `POST /customers/:id/absorb-into/:targetId` (placeholder → คนจริง หรือ placeholder ทั้งคู่ตาม R22) → `{ placeholderId, targetId, movedRooms, movedCreditChecks }` · 409 เมื่อต้นทางไม่ใช่ placeholder หรือมี relation ค้าง · 403 SALES นอกขอบเขตห้อง
- `PATCH /staff-chat/rooms/:id/customer` body `{ customerId }` — ผูกห้องกับลูกค้าเดิม; ถ้าห้องถือ placeholder อยู่ API ดูด placeholder เข้าคนนั้นให้เอง (Task 9 ของ Plan 1)
- `GET /customers?view=customers|prospects|<ไม่ส่ง>` ทุกแถวมี `chatPlaceholder`, `source`, `acquisitionSourceRaw` · `summary.fromChat` ในแท็บลูกค้า · query `fromChat=true|false`, `source=<FACEBOOK|LINE|TIKTOK|WEB|…>` ใช้ได้ทั้งสองแท็บ
- `GET /customers/:id` → มี `chatPlaceholder`

---

### Task 1: API `POST /customers/:id/fill-contact` — เติมเบอร์/ชื่อให้ผู้สนใจอัตโนมัติ (SALES ใช้ได้)

**Files:**
- Create: `apps/api/src/modules/customers/dto/fill-prospect-contact.dto.ts`
- Modify: `apps/api/src/modules/customers/services/customer-write.service.ts` (constructor + method ใหม่ท้ายคลาส)
- Modify: `apps/api/src/modules/customers/customers.service.ts` (facade)
- Modify: `apps/api/src/modules/customers/customers.controller.ts` (route ใหม่ใต้ `absorbInto`)
- Test: `apps/api/src/modules/customers/services/customer-write.fill-contact.db.spec.ts` (ใหม่ — Postgres จริง), `apps/api/src/modules/customers/customers.controller.spec.ts` (เพิ่ม describe)

**Interfaces:**
- Consumes: `CustomerMergeService.assertActorMayAbsorb(placeholderId, actor)` (Plan 1 R26) · `isChatPlaceholder`, `PLACEHOLDER_FIELDS_SELECT` จาก `chat-prospects/chat-placeholder.ts` · `AuditService.log({ userId, action, entity, entityId, oldValue, newValue })` (`modules/audit/audit.service.ts`) · `hashPII(plaintext, salt)` จาก `utils/pii.util.ts`
- Produces: `POST /customers/:id/fill-contact` body `FillProspectContactDto { phone: string (บังคับ, /^0[0-9]{9}$/); name?: string; prefix?: string; nickname?: string; nationalId?: string (13 หลัก); facebookName?: string }` → 200 `{ id: string; name: string; phone: string }` · 404 `ไม่พบลูกค้า` · 409 `{ message: 'เติมเบอร์ได้เฉพาะผู้สนใจอัตโนมัติจากแชทที่ยังไม่มีเบอร์' }` เมื่อไม่ใช่ placeholder · 409 `{ message: 'ลูกค้าที่มีเบอร์โทรนี้มีอยู่แล้ว', existingCustomer: { id, name } }` เมื่อเบอร์ซ้ำ (รูปเดียวกับ `POST /customers`) · 403 `ไม่มีสิทธิ์เข้าถึงห้องแชทนี้` เมื่อ SALES แตะห้องของคนอื่น · audit `CUSTOMER_PLACEHOLDER_CONTACT_FILLED` · `CustomerWriteService.fillPlaceholderContact(id, dto, actor)` · `CustomersService.fillPlaceholderContact(id, dto, actor)`

- [ ] **Step 1: เขียน DTO**

สร้าง `apps/api/src/modules/customers/dto/fill-prospect-contact.dto.ts`:
```ts
import { IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';

/**
 * เติมเบอร์/ข้อมูลให้ "ผู้สนใจอัตโนมัติจากแชท" (สเปค 3.6 ปุ่ม "เพิ่มเบอร์/ข้อมูล", Ruling R27)
 * ใช้กับแถวที่ยังเป็น placeholder เท่านั้น — คนที่มีเบอร์แล้วต้องไป PATCH /customers/:id (OWNER/BM)
 * เบอร์บังคับ · ชื่อแก้ได้ · เลขบัตรไม่บังคับ (เติมตอนทำสัญญาก็ได้ — mockup บอร์ด 3)
 */
export class FillProspectContactDto {
  @Matches(/^0[0-9]{9}$/, { message: 'เบอร์โทรต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0' })
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'ชื่อยาวเกินไป' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'คำนำหน้ายาวเกินไป' })
  prefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'ชื่อเล่นยาวเกินไป' })
  nickname?: string;

  // ไม่ส่ง = ไม่แตะ · ส่งค่าว่างไม่ได้ (ValidateIf ตรวจเมื่อมีค่าเท่านั้น — เหมือน CreateCustomerDto)
  @IsOptional()
  @ValidateIf((o) => !!o.nationalId)
  @IsString()
  @Length(13, 13, { message: 'เลขบัตรประชาชนต้อง 13 หลัก' })
  nationalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'ชื่อ Facebook ยาวเกินไป' })
  facebookName?: string;
}
```

- [ ] **Step 2: เทสแดง — controller**

ใน `customers.controller.spec.ts` (describe เดิม `CustomersController PII (Phase 5)`): ขยาย type ของ `let service: { findOne: jest.Mock; findAll: jest.Mock; search: jest.Mock }` ให้มี `fillPlaceholderContact: jest.Mock` และเพิ่ม `fillPlaceholderContact: jest.fn(),` ใน object `service = { … }` ของ `beforeEach` (`merge` mock มี `assertActorMayAbsorb: jest.fn().mockResolvedValue(undefined)` และ `ForbiddenException` import อยู่แล้ว · `reqOf(role)` คืน `{ user: { id: 'u1', role }, ip, headers }`) แล้วเพิ่ม describe ซ้อนท้าย describe ใหญ่ (ให้เห็น `controller`/`service`/`merge`/`reqOf`):
```ts
describe('POST /customers/:id/fill-contact', () => {
  it('SALES: ผ่านด่านขอบเขตห้องก่อน แล้วส่ง dto + actor เข้า service', async () => {
    service.fillPlaceholderContact.mockResolvedValue({ id: 'p1', name: 'สมชาย ใจดี', phone: '0812345678' });
    const dto = { phone: '0812345678', name: 'สมชาย ใจดี' };
    const result = await controller.fillContact('p1', dto as any, reqOf('SALES'));
    expect(merge.assertActorMayAbsorb).toHaveBeenCalledWith('p1', { id: 'u1', role: 'SALES' });
    expect(service.fillPlaceholderContact).toHaveBeenCalledWith('p1', dto, { id: 'u1', role: 'SALES' });
    expect(result).toEqual({ id: 'p1', name: 'สมชาย ใจดี', phone: '0812345678' });
  });

  it('SALES นอกขอบเขตห้อง → 403 จากด่าน และไม่แตะ service', async () => {
    merge.assertActorMayAbsorb.mockRejectedValueOnce(new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้'));
    await expect(controller.fillContact('p1', { phone: '0812345678' } as any, reqOf('SALES'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.fillPlaceholderContact).not.toHaveBeenCalled();
  });
});
```
Run: `npx jest src/modules/customers/customers.controller.spec.ts --runInBand` (จาก `apps/api`, env ตาม Global Constraints) → Expected: FAIL `controller.fillContact is not a function`

- [ ] **Step 3: route + facade**

`customers.controller.ts` — import เพิ่ม `import { FillProspectContactDto } from './dto/fill-prospect-contact.dto';` แล้วเพิ่ม handler ใต้ `absorbInto` (ก่อน `@Delete(':id')`):
```ts
  /**
   * เติมเบอร์/ชื่อให้ "ผู้สนใจอัตโนมัติจากแชท" (สเปค 3.6 ปุ่ม "เพิ่มเบอร์/ข้อมูล" · Ruling R27)
   * roles เท่าทางผูกห้อง — SALES ผ่านด่านห้องเดียวกับ absorb-into (R26): ห้องของ placeholder ต้องไม่มีคนดูแลหรือเป็นของตัวเอง
   * เบอร์ซ้ำ → 409 พร้อม existingCustomer (รูปเดียวกับ POST /customers) ให้เว็บเสนอ "รวมกับลูกค้าเดิมคนนี้"
   */
  @Post(':id/fill-contact')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async fillContact(
    @Param('id') id: string,
    @Body() dto: FillProspectContactDto,
    @Req() req: { user: { id: string; role: string } },
  ) {
    const actor = { id: req.user.id, role: req.user.role };
    await this.merge.assertActorMayAbsorb(id, actor);
    return this.customersService.fillPlaceholderContact(id, dto, actor);
  }
```
`customers.service.ts` — import `FillProspectContactDto` แล้วเพิ่ม method ใต้ `update`:
```ts
  fillPlaceholderContact(id: string, dto: FillProspectContactDto, actor: { id: string; role: string }) {
    return this.write.fillPlaceholderContact(id, dto, actor);
  }
```

- [ ] **Step 4: เทสแดง — DB จริง**

สร้าง `apps/api/src/modules/customers/services/customer-write.fill-contact.db.spec.ts`:
```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CustomerWriteService } from './customer-write.service';
import { hashPII } from '../../../utils/pii.util';

/**
 * พิสูจน์กับ Postgres จริง: เติมเบอร์ให้ placeholder เขียน phone + phoneHash (dedup ทำงานจริง) ·
 * เบอร์ซ้ำ → 409 พร้อม existingCustomer · คนที่มีเบอร์แล้ว → 409 · audit ถูกเรียก
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest <ไฟล์นี้> --runInBand
 */
describe('CustomerWriteService.fillPlaceholderContact (real DB)', () => {
  const SALT = 'fill-contact-spec-salt-0123456789abcdef';
  const prisma = new PrismaClient();
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  // contactResolver / query ไม่ถูกใช้ในเมธอดนี้ (อ่านผ่าน prisma ตรง) · ไม่ส่ง piiService = fallback inline (ไม่มี key → เก็บ plaintext, มี salt → hash จริง)
  const service = new CustomerWriteService(prisma as any, {} as any, {} as any, undefined, audit as any);
  const stamp = String(Date.now()).slice(-8);
  const ids: string[] = [];
  let prevSalt: string | undefined;
  let prevKey: string | undefined;

  beforeAll(() => {
    prevSalt = process.env.PII_HASH_SALT;
    prevKey = process.env.PII_ENCRYPTION_KEY;
    process.env.PII_HASH_SALT = SALT;
    delete process.env.PII_ENCRYPTION_KEY;
  });
  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    if (prevSalt === undefined) delete process.env.PII_HASH_SALT; else process.env.PII_HASH_SALT = prevSalt;
    if (prevKey !== undefined) process.env.PII_ENCRYPTION_KEY = prevKey;
  });
  beforeEach(() => audit.log.mockClear());

  async function placeholder(label: string) {
    const row = await prisma.customer.create({
      data: { name: `fill spec ${label}`, phone: null, nationalId: null, acquisitionSource: 'CHAT_FACEBOOK', creditCheckStatus: 'PRE_CHECK_PASSED' },
    });
    ids.push(row.id);
    return row;
  }

  it('placeholder + เบอร์ใหม่ → เขียน phone/phoneHash/ชื่อ · ไม่ใช่ placeholder อีก · audit CUSTOMER_PLACEHOLDER_CONTACT_FILLED', async () => {
    const p = await placeholder('ok');
    const phone = `08${stamp}`;
    const result = await service.fillPlaceholderContact(p.id, { phone, name: 'สมชาย ใจดี', nickname: 'ชาย' }, { id: 'staff-1', role: 'SALES' });
    expect(result).toEqual({ id: p.id, name: 'สมชาย ใจดี', phone });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.phone).toBe(phone);
    expect(row.phoneHash).toBe(hashPII(phone, SALT));
    expect(row.nickname).toBe('ชาย');
    expect(row.acquisitionSource).toBe('CHAT_FACEBOOK'); // ที่มาไม่ถูกทับ
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'staff-1', action: 'CUSTOMER_PLACEHOLDER_CONTACT_FILLED', entity: 'customer', entityId: p.id,
      newValue: expect.objectContaining({ phone, name: 'สมชาย ใจดี' }),
    }));
  });

  it('เบอร์ซ้ำกับลูกค้าเดิม → 409 พร้อม existingCustomer {id, name} และไม่แตะแถว', async () => {
    const phone = `09${stamp}`;
    const existing = await prisma.customer.create({ data: { name: 'fill spec existing', phone, phoneHash: hashPII(phone, SALT) } });
    ids.push(existing.id);
    const p = await placeholder('dup');
    let error: unknown;
    try { await service.fillPlaceholderContact(p.id, { phone }, { id: 'staff-1', role: 'OWNER' }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({ message: 'ลูกค้าที่มีเบอร์โทรนี้มีอยู่แล้ว', existingCustomer: { id: existing.id, name: 'fill spec existing' } });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.phone).toBeNull();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('แถวที่มีเบอร์แล้ว (ไม่ใช่ placeholder) → 409 ข้อความชี้ทางไปหน้ารายละเอียด · แถวที่ถูกลบ → 404', async () => {
    const real = await prisma.customer.create({ data: { name: 'fill spec real', phone: `07${stamp}`, acquisitionSource: 'CHAT_LINE_SHOP' } });
    ids.push(real.id);
    await expect(service.fillPlaceholderContact(real.id, { phone: `06${stamp}` }, { id: 'staff-1', role: 'OWNER' }))
      .rejects.toThrow('เติมเบอร์ได้เฉพาะผู้สนใจอัตโนมัติจากแชทที่ยังไม่มีเบอร์');
    const gone = await placeholder('gone');
    await prisma.customer.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    await expect(service.fillPlaceholderContact(gone.id, { phone: `05${stamp}` }, { id: 'staff-1', role: 'OWNER' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

Run: `npx jest src/modules/customers/services/customer-write.fill-contact.db.spec.ts --runInBand` (env ตาม Global Constraints) → Expected: FAIL `service.fillPlaceholderContact is not a function`

- [ ] **Step 5: เขียนเมธอดใน `CustomerWriteService`**

แก้ constructor (บรรทัด ~27-32) เพิ่มพารามิเตอร์ท้ายสุดแบบ `@Optional()` (spec เดิมที่ `new CustomerWriteService(prisma, resolver, query, pii?)` ยังใช้ได้):
```ts
import { NotFoundException } from '@nestjs/common'; // เพิ่มในบรรทัด import เดิมของ @nestjs/common
import { AuditService } from '../../audit/audit.service';
import { FillProspectContactDto } from '../dto/fill-prospect-contact.dto';
import { isChatPlaceholder, PLACEHOLDER_FIELDS_SELECT } from '../../chat-prospects/chat-placeholder';
…
  constructor(
    private prisma: PrismaService,
    private readonly contactResolver: ContactResolverService,
    private readonly query: CustomerQueryService,
    @Optional() private readonly piiService?: CustomerPiiService,
    @Optional() private readonly audit?: AuditService,
  ) {}
```
เพิ่มเมธอดท้ายคลาส:
```ts
  /**
   * เติมเบอร์/ชื่อให้ "ผู้สนใจอัตโนมัติจากแชท" (สเปค 3.6 · Ruling R27) — แถวเดิม ไม่สร้างคนใหม่
   * ใช้ได้เฉพาะ placeholder ที่ยังไม่ถูกลบ · dedup เบอร์เหมือน create/update (409 พร้อม existingCustomer ให้เว็บเสนอ "รวม")
   * ที่มา CHAT_* ไม่ถูกแตะ (เป็นข้อมูลวิเคราะห์ lead — R14/R24)
   */
  async fillPlaceholderContact(
    id: string,
    dto: FillProspectContactDto,
    actor: { id: string; role: string },
  ): Promise<{ id: string; name: string; phone: string }> {
    const current = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true, name: true, ...PLACEHOLDER_FIELDS_SELECT }, // SELECT มี deletedAt อยู่แล้ว
    });
    if (!current || current.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');
    if (!isChatPlaceholder(current)) {
      throw new ConflictException('เติมเบอร์ได้เฉพาะผู้สนใจอัตโนมัติจากแชทที่ยังไม่มีเบอร์ — คนนี้มีเบอร์แล้ว แก้ได้ที่หน้ารายละเอียดลูกค้า');
    }
    const phone = this.normalizePhone(dto.phone) ?? dto.phone;
    const nationalId = dto.nationalId?.trim() || undefined;
    await this.assertContactNotDuplicate(phone, null, id);

    const piiEncrypted = this.buildPiiEncryptedFields({ phone, ...(nationalId ? { nationalId } : {}) });
    const name = dto.name?.trim() || current.name;
    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        phone,
        name,
        ...(dto.prefix !== undefined ? { prefix: dto.prefix || null } : {}),
        ...(dto.nickname !== undefined ? { nickname: dto.nickname || null } : {}),
        ...(dto.facebookName !== undefined ? { facebookName: dto.facebookName || null } : {}),
        ...(nationalId ? { nationalId } : {}),
        ...(piiEncrypted as Partial<Prisma.CustomerUpdateInput>),
      },
      select: { id: true, name: true, phone: true },
    });

    await this.audit?.log({
      userId: actor.id,
      action: 'CUSTOMER_PLACEHOLDER_CONTACT_FILLED',
      entity: 'customer',
      entityId: id,
      oldValue: { name: current.name, phone: null },
      newValue: { name: updated.name, phone: updated.phone, nationalIdFilled: !!nationalId },
    });
    return { id: updated.id, name: updated.name, phone: updated.phone as string };
  }
```
(ตรวจชื่อคอลัมน์ `prefix`, `nickname`, `facebookName`, `nationalId` ใน `schema.prisma` model `Customer` ก่อน — ทั้งสี่มีอยู่ตาม `CreateCustomerDto`/`UpdateCustomerDto`; ถ้า `prefix` ไม่มี ให้ตัดบรรทัดนั้นและตัด `prefix` ออกจาก DTO แล้วบันทึกใน report)

- [ ] **Step 6: รันให้เขียว**

Run: `npx jest src/modules/customers/services/customer-write.fill-contact.db.spec.ts src/modules/customers/customers.controller.spec.ts --runInBand` → Expected: PASS · แล้ว `npx jest src/modules/customers --runInBand` → PASS · `npx tsc --noEmit -p apps/api/tsconfig.json` (จาก root) → 0 error · `npx eslint src/modules/customers/customers.controller.ts src/modules/customers/customers.service.ts src/modules/customers/services/customer-write.service.ts src/modules/customers/dto/fill-prospect-contact.dto.ts src/modules/customers/services/customer-write.fill-contact.db.spec.ts` → 0 error

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/customers/dto/fill-prospect-contact.dto.ts apps/api/src/modules/customers/services/customer-write.service.ts apps/api/src/modules/customers/services/customer-write.fill-contact.db.spec.ts apps/api/src/modules/customers/customers.service.ts apps/api/src/modules/customers/customers.controller.ts apps/api/src/modules/customers/customers.controller.spec.ts
git commit -m "feat(customers): POST /customers/:id/fill-contact เติมเบอร์ให้ผู้สนใจอัตโนมัติ (SALES ใช้ได้ ผ่านด่านห้องเดียวกับ absorb-into)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: API — ข้อความตอนส่งข้อมูลชำระให้ห้องที่เป็นผู้สนใจ

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/chat-commerce.service.ts:81-84`
- Test: `apps/api/src/modules/staff-chat/services/chat-commerce.service.spec.ts:61-70`

**Interfaces:**
- Produces: 400 `ผู้สนใจคนนี้ยังไม่มีเบอร์ — เติมเบอร์หรือผูกกับลูกค้าเดิมก่อนส่งข้อมูลชำระ` เมื่อห้องถือ placeholder · ข้อความเดิม `ห้องแชทนี้ยังไม่ได้เชื่อมกับลูกค้า` คงไว้สำหรับห้องที่ไม่มีเจ้าของ

- [ ] **Step 1: เทสแดง** — ในเทส `'ห้องที่ถือผู้สนใจอัตโนมัติ (ไม่มีเบอร์) → 400 เหมือนยังไม่ผูกลูกค้า'` เปลี่ยนชื่อเป็น `'ห้องที่ถือผู้สนใจอัตโนมัติ (ไม่มีเบอร์) → 400 บอกให้เติมเบอร์หรือผูกคนเดิม'` และเปลี่ยน `rejects.toThrow('ห้องแชทนี้ยังไม่ได้เชื่อมกับลูกค้า')` เป็น `rejects.toThrow('ผู้สนใจคนนี้ยังไม่มีเบอร์ — เติมเบอร์หรือผูกกับลูกค้าเดิมก่อนส่งข้อมูลชำระ')` · เพิ่มเทสใหม่ถัดไป:
```ts
  it('ห้องที่ไม่มีเจ้าของเลย → 400 ข้อความเดิม "ยังไม่ได้เชื่อมกับลูกค้า"', async () => {
    const { svc, prisma } = makeCommerceOnlyService();
    prisma.chatRoom.findUnique.mockResolvedValue({ id: 's1', lineUserId: null, channel: 'FACEBOOK', customerId: null, customer: null });
    await expect(svc.createPaymentLinkInChat({ sessionId: 's1', staffId: 'u1', contractId: 'contract-1' })).rejects.toThrow('ห้องแชทนี้ยังไม่ได้เชื่อมกับลูกค้า');
  });
```
Run: `npx jest src/modules/staff-chat/services/chat-commerce.service.spec.ts --runInBand` → Expected: FAIL (ข้อความเดิม)

- [ ] **Step 2: แก้ guard** — แทนบรรทัด 81-84 ด้วย:
```ts
    // ผู้สนใจอัตโนมัติจากแชท (ยังไม่มีเบอร์/เลขบัตร) ส่งข้อมูลชำระไม่ได้ — ต้องมีคนที่ติดต่อได้จริง (สเปค 3.4)
    // ข้อความชี้ทางที่ทำได้จริงบนการ์ดผู้สนใจ (เติมเบอร์ / ผูกกับลูกค้าเดิม) ไม่ใช่ "ยังไม่ได้เชื่อม" ซึ่งชวนหาปุ่มผูกที่ไม่มี
    if (!session.customerId || !session.customer) {
      throw new BadRequestException('ห้องแชทนี้ยังไม่ได้เชื่อมกับลูกค้า');
    }
    if (isChatPlaceholder(session.customer)) {
      throw new BadRequestException('ผู้สนใจคนนี้ยังไม่มีเบอร์ — เติมเบอร์หรือผูกกับลูกค้าเดิมก่อนส่งข้อมูลชำระ');
    }
```

- [ ] **Step 3: เขียว** — Run เทสเดิม → PASS · `npx jest src/modules/staff-chat --runInBand` → PASS · tsc 0

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/modules/staff-chat/services/chat-commerce.service.ts apps/api/src/modules/staff-chat/services/chat-commerce.service.spec.ts
git commit -m "fix(staff-chat): ส่งข้อมูลชำระให้ห้องผู้สนใจ บอกให้เติมเบอร์/ผูกคนเดิม แทน 'ยังไม่ได้เชื่อมกับลูกค้า'" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: เว็บ — สิทธิ์ปุ่มเติมเบอร์ · type ของห้อง · hooks รวม/ไม่ใช่

**Files:**
- Modify: `apps/web/src/lib/constants.ts` (ใต้ `canCreateCustomer` บรรทัด ~93)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.tsx:45-59` (type `DossierRoom`)
- Create: `apps/web/src/pages/UnifiedInboxPage/hooks/useProspectActions.ts`
- Test: `apps/web/src/pages/UnifiedInboxPage/hooks/useProspectActions.test.tsx` (ใหม่)

**Interfaces:**
- Produces:
  - `PROSPECT_CONTACT_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']`, `canFillProspectContact(role)` (constants.ts)
  - `DossierRoom.customer?: { id; name; phone?: string | null; chatPlaceholder?: boolean } | null` · `DossierRoom.possibleSamePerson?: PossibleSamePerson[]` · `export interface PossibleSamePerson { customerId: string; name: string; channel: string; hasPhone: boolean; chatPlaceholder: boolean; createdAt: string; mergeDirection: 'absorb_current_into_other' | 'absorb_other_into_current' | 'none' }` (RoomDossier.tsx, export)
  - `useAbsorbCustomer(roomId, { onSuccess?, onError? })` → `mutate({ placeholderId, targetId })` = `POST /customers/:placeholderId/absorb-into/:targetId`, invalidate `['chat-room', roomId]`, `['chat-rooms']`, `ROOM_LINK_INVALIDATE_KEYS`
  - `useDismissSamePerson(roomId, { onSuccess?, onError? })` → `mutate(customerId)` = `PATCH /staff-chat/rooms/:roomId/same-person/dismiss { customerId }`, invalidate `['chat-room', roomId]`

- [ ] **Step 1: เทสแดง (hooks)**

สร้าง `apps/web/src/pages/UnifiedInboxPage/hooks/useProspectActions.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiPost = vi.fn();
const apiPatch = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => apiPost(...a), patch: (...a: unknown[]) => apiPatch(...a), get: vi.fn() },
}));

import { useAbsorbCustomer, useDismissSamePerson } from './useProspectActions';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

describe('useProspectActions', () => {
  beforeEach(() => { apiPost.mockReset(); apiPatch.mockReset(); });

  it('useAbsorbCustomer: POST /customers/:placeholder/absorb-into/:target แล้ว invalidate ห้อง รายการห้อง และคีย์ลูกค้า/เครดิต', async () => {
    apiPost.mockResolvedValue({ data: { placeholderId: 'p1', targetId: 'c1', movedRooms: 1, movedCreditChecks: 0 } });
    const { wrapper, spy } = makeWrapper();
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useAbsorbCustomer('r-1', { onSuccess }), { wrapper });
    result.current.mutate({ placeholderId: 'p1', targetId: 'c1' });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith('/customers/p1/absorb-into/c1');
    const keys = spy.mock.calls.map(([arg]) => JSON.stringify((arg as { queryKey: unknown }).queryKey));
    expect(keys).toEqual(expect.arrayContaining([JSON.stringify(['chat-room', 'r-1']), JSON.stringify(['chat-rooms']), JSON.stringify(['customers'])]));
  });

  it('useDismissSamePerson: PATCH /staff-chat/rooms/:id/same-person/dismiss { customerId } แล้ว invalidate ห้อง', async () => {
    apiPatch.mockResolvedValue({ data: {} });
    const { wrapper, spy } = makeWrapper();
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useDismissSamePerson('r-1', { onSuccess }), { wrapper });
    result.current.mutate('c9');
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(apiPatch).toHaveBeenCalledWith('/staff-chat/rooms/r-1/same-person/dismiss', { customerId: 'c9' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['chat-room', 'r-1'] });
  });
});
```
Run: `npx vitest run src/pages/UnifiedInboxPage/hooks/useProspectActions.test.tsx` (จาก `apps/web`) → Expected: FAIL (module not found)

- [ ] **Step 2: เขียน hooks + constants + type**

สร้าง `apps/web/src/pages/UnifiedInboxPage/hooks/useProspectActions.ts`:
```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { ROOM_LINK_INVALIDATE_KEYS } from './useLinkRoomCustomer';

/**
 * การกระทำบนการ์ด "ผู้สนใจจากแชท" ในแผงขวา (สเปค 3.3 ข / 3.6)
 * - รวม placeholder เข้าคนเดิม: `POST /customers/:placeholderId/absorb-into/:targetId` (ทางเดียว placeholder → คนจริง
 *   หรือ placeholder → placeholder ตามทิศทางที่คำใบ้บอก — R22) · หลังรวม ห้องนี้ชี้ไปคนที่รอด จึงต้องโหลดห้องใหม่
 * - กด "ไม่ใช่" ที่คำใบ้: `PATCH /staff-chat/rooms/:id/same-person/dismiss` — เก็บในห้อง ไม่ถามซ้ำ
 * toast เป็นของผู้เรียก (ข้อความต่างกันตามทางเข้า) — แบบเดียวกับ useLinkRoomCustomer
 */
export interface AbsorbArgs { placeholderId: string; targetId: string }

export function useAbsorbCustomer(roomId: string, opts: { onSuccess?: (args: AbsorbArgs) => void; onError?: (err: unknown, args: AbsorbArgs) => void } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: AbsorbArgs) => api.post(`/customers/${args.placeholderId}/absorb-into/${args.targetId}`),
    onSuccess: (_res, args) => {
      queryClient.invalidateQueries({ queryKey: ['chat-room', roomId] });
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      for (const key of ROOM_LINK_INVALIDATE_KEYS) queryClient.invalidateQueries({ queryKey: [key] });
      opts.onSuccess?.(args);
    },
    onError: (err, args) => opts.onError?.(err, args),
  });
}

export function useDismissSamePerson(roomId: string, opts: { onSuccess?: (customerId: string) => void; onError?: (err: unknown, customerId: string) => void } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (customerId: string) => api.patch(`/staff-chat/rooms/${roomId}/same-person/dismiss`, { customerId }),
    onSuccess: (_res, customerId) => {
      queryClient.invalidateQueries({ queryKey: ['chat-room', roomId] });
      opts.onSuccess?.(customerId);
    },
    onError: (err, customerId) => opts.onError?.(err, customerId),
  });
}
```
`apps/web/src/lib/constants.ts` — ต่อจาก `canCreateCustomer`:
```ts
/**
 * บทบาทที่ "เพิ่มเบอร์/ข้อมูล" ให้ผู้สนใจจากแชทได้ — ต้องตรงกับ `@Roles` ของ `POST /customers/:id/fill-contact`
 * (เท่าทางผูกห้อง PATCH rooms/:id/customer — มี FINANCE_MANAGER ต่างจาก POST /customers)
 */
export const PROSPECT_CONTACT_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'];
export const canFillProspectContact = (role: string | null | undefined): boolean => PROSPECT_CONTACT_ROLES.includes(role ?? '');
```
`RoomDossier.tsx` — แทน type `DossierRoom` (บรรทัด 45-59) ด้วย:
```ts
/** คำใบ้ "อาจเป็นคนเดียวกัน" จาก GET /staff-chat/rooms/:id (สเปค 3.6 · สูงสุด 3 · ไม่รวมอัตโนมัติ) */
export interface PossibleSamePerson {
  customerId: string;
  name: string;
  channel: string;
  hasPhone: boolean;
  chatPlaceholder: boolean;
  createdAt: string;
  mergeDirection: 'absorb_current_into_other' | 'absorb_other_into_current' | 'none';
}

export interface DossierRoom {
  id: string;
  channel: string;
  displayName?: string | null;
  pictureUrl?: string | null;
  createdAt?: string;
  lastMessageAt?: string;
  totalMessages?: number;
  /** `chatPlaceholder` = ผู้สนใจอัตโนมัติจากแชท (API ตัดสินให้ — เว็บห้าม derive เอง) */
  customer?: { id: string; name: string; phone?: string | null; chatPlaceholder?: boolean } | null;
  possibleSamePerson?: PossibleSamePerson[];
  attribution?: {
    firstTouch?: string;
    lastTouch?: string | null;
    campaign?: { campaignId: string; campaignName: string; adName?: string | null; adPhotoUrl?: string | null } | null;
  } | null;
}
```

- [ ] **Step 3: เขียว** — Run เทส hooks → PASS · `npx tsc --noEmit` (จาก `apps/web`) → 0 error · `npx eslint src/lib/constants.ts src/pages/UnifiedInboxPage/hooks/useProspectActions.ts src/pages/UnifiedInboxPage/hooks/useProspectActions.test.tsx src/pages/UnifiedInboxPage/components/RoomDossier.tsx` → 0 error

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/lib/constants.ts apps/web/src/pages/UnifiedInboxPage/hooks/useProspectActions.ts apps/web/src/pages/UnifiedInboxPage/hooks/useProspectActions.test.tsx apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.tsx
git commit -m "feat(inbox): type ผู้สนใจ/คำใบ้ของห้อง + hooks รวมผู้สนใจ/กดไม่ใช่ + สิทธิ์ปุ่มเติมเบอร์" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: เว็บ — `CustomerCreateDialog` โหมด `fill` (เพิ่มเบอร์/ข้อมูลผู้สนใจ)

**Files:**
- Modify: `apps/web/src/lib/schemas.ts` (ใต้ `customerSchema`)
- Modify: `apps/web/src/components/customer/CustomerCreateDialog.tsx` (props :82-94 · Dialog :96-108 · form setup :112-116 · mutation :134-185 · หัว :357-358 · alert 409 :366-380 · ช่องเลขบัตร :474-490)
- Test: `apps/web/src/components/customer/CustomerCreateDialog.test.tsx` (เพิ่ม describe)

**Interfaces:**
- Consumes: `POST /customers/:id/fill-contact` (Task 1)
- Produces: props ใหม่ `mode?: 'create' | 'fill'` (default `'create'`), `fillCustomerId?: string` (บังคับเมื่อ `mode='fill'`), `onFilled?: (customer: CreatedCustomer) => void` · ใน `fill`: หัว `เพิ่มเบอร์/ข้อมูลผู้สนใจ`, เลขบัตรไม่บังคับ, submit = `POST /customers/:fillCustomerId/fill-contact` · 409 → alert `เบอร์ <เบอร์> เป็นของลูกค้าเดิมอยู่แล้ว` + ปุ่ม `รวมกับลูกค้าเดิมคนนี้` (เรียก `onUseExisting(existing)` แล้วปิด) และ `แก้เบอร์` (กลับไปแก้ฟอร์ม) · export `prospectFillSchema` จาก schemas.ts

- [ ] **Step 1: เทสแดง**

เพิ่มใน `CustomerCreateDialog.test.tsx` (mock `@/lib/api` เดิมมีแค่ `post` — ใช้ต่อได้):
```tsx
describe('CustomerCreateDialog mode="fill" (เพิ่มเบอร์/ข้อมูลผู้สนใจ)', () => {
  beforeEach(() => { apiPost.mockReset(); });

  it('หัวเป็น "เพิ่มเบอร์/ข้อมูลผู้สนใจ" · เลขบัตรไม่บังคับ · บันทึกแล้ว POST /customers/:id/fill-contact โดยไม่ส่ง nationalId ว่าง · เรียก onFilled แล้วปิด', async () => {
    apiPost.mockResolvedValue({ data: { id: 'p1', name: 'สมชาย ใจดี', phone: '0812345678' } });
    const onFilled = vi.fn();
    const onOpenChange = vi.fn();
    wrap(
      <CustomerCreateDialog
        open
        mode="fill"
        fillCustomerId="p1"
        onOpenChange={onOpenChange}
        initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี', facebookName: 'สมชาย ใจดี' }}
        submitLabel="บันทึก"
        onCreated={vi.fn()}
        onFilled={onFilled}
      />,
    );
    expect(screen.getByRole('heading', { name: 'เพิ่มเบอร์/ข้อมูลผู้สนใจ' })).toBeInTheDocument();
    expect(screen.getByText(/ไม่บังคับ — เติมตอนทำสัญญาก็ได้/)).toBeInTheDocument();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'นาย' } });
    fireEvent.change(mainField('0XX-XXX-XXXX'), { target: { value: '0812345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [url, payload] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/customers/p1/fill-contact');
    expect(payload).toEqual({ phone: '0812345678', name: 'สมชาย ใจดี', prefix: 'นาย', facebookName: 'สมชาย ใจดี' });
    expect(payload).not.toHaveProperty('nationalId');
    await waitFor(() => expect(onFilled).toHaveBeenCalledWith({ id: 'p1', name: 'สมชาย ใจดี', phone: '0812345678' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('เบอร์ซ้ำ (409 existingCustomer) → alert ตาม mockup + ปุ่ม "รวมกับลูกค้าเดิมคนนี้" เรียก onUseExisting แล้วปิด · ปุ่ม "แก้เบอร์" กลับไปแก้ฟอร์ม', async () => {
    apiPost.mockRejectedValue({ response: { status: 409, data: { message: 'ลูกค้าที่มีเบอร์โทรนี้มีอยู่แล้ว', existingCustomer: { id: 'c-old', name: 'สมชาย ใจดี' } } } });
    const onUseExisting = vi.fn();
    const onOpenChange = vi.fn();
    wrap(<CustomerCreateDialog open mode="fill" fillCustomerId="p1" onOpenChange={onOpenChange} initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี' }} onCreated={vi.fn()} onUseExisting={onUseExisting} />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'นาย' } });
    fireEvent.change(mainField('0XX-XXX-XXXX'), { target: { value: '0812345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('เบอร์ 0812345678 เป็นของลูกค้าเดิมอยู่แล้ว');
    expect(alert).toHaveTextContent('ระบบไม่สร้างซ้ำ — รวมแชทห้องนี้และผลเช็คเครดิตเข้าคนเดิม หรือแก้เบอร์แล้วบันทึกใหม่');
    expect(alert).toHaveTextContent('สมชาย ใจดี');
    fireEvent.click(screen.getByRole('button', { name: 'แก้เบอร์' }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'รวมกับลูกค้าเดิมคนนี้' }));
    expect(onUseExisting).toHaveBeenCalledWith({ id: 'c-old', name: 'สมชาย ใจดี' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

});
```
(โหมดสร้างเดิมมีเทสครอบอยู่แล้วในไฟล์ — `'ไม่ผ่าน validation → ไม่ยิง API (เลขบัตร/เบอร์ยังบังคับเหมือนหน้าลูกค้า)'` และเทส POST `/customers` ต้องยังผ่านหลังแก้ = หลักฐานว่า default `mode='create'` ไม่เปลี่ยน — ไม่เขียนซ้ำ)

Run: `npx vitest run src/components/customer/CustomerCreateDialog.test.tsx` → Expected: 2 เทสใหม่ FAIL (ไม่มี heading โหมด fill / ยิง /customers), เทสเดิม PASS

- [ ] **Step 2: schema**

`apps/web/src/lib/schemas.ts` — ต่อจาก `export type CustomerFormData …`:
```ts
/**
 * โหมด "เพิ่มเบอร์/ข้อมูลผู้สนใจ" (สเปค 3.6): เลขบัตรไม่บังคับ — เติมตอนทำสัญญาก็ได้
 * ช่องว่างผ่าน · มีค่าต้องเป็นเลขบัตร 13 หลักที่ checksum ถูก (ใช้ refine เดียว ไม่ใช้ union — union ให้ข้อความ "Invalid input" ภาษาอังกฤษ)
 */
export const prospectFillSchema = customerSchema.extend({
  nationalId: z
    .string()
    .refine((v) => v === '' || (v.length === 13 && isValidThaiNationalId(v)), 'เลขบัตรประชาชนไม่ถูกต้อง (13 หลัก) — เว้นว่างได้'),
});
```

- [ ] **Step 3: dialog**

(ก) props (บรรทัด 82-94) เพิ่ม:
```ts
  /** 'fill' = เพิ่มเบอร์/ข้อมูลให้ผู้สนใจอัตโนมัติคนเดิม (POST /customers/:id/fill-contact) — ไม่สร้างคนใหม่ (สเปค 3.6) */
  mode?: 'create' | 'fill';
  /** id ของผู้สนใจที่จะเติม — บังคับเมื่อ mode='fill' */
  fillCustomerId?: string;
  /** โหมด fill บันทึกสำเร็จ — dialog ปิดตัวเองหลังเรียก */
  onFilled?: (customer: CreatedCustomer) => void;
```
(ข) `CustomerCreateDialog` (บรรทัด 96-108): `aria-label={formProps.mode === 'fill' ? 'เพิ่มเบอร์/ข้อมูลผู้สนใจ' : 'เพิ่มลูกค้าใหม่'}`

(ค) `CustomerCreateForm` signature + form setup (บรรทัด 112-116):
```ts
function CustomerCreateForm({ mode = 'create', fillCustomerId, initialValues, context, submitLabel = 'บันทึก', onCreated, onFilled, onUseExisting, onClose }: FormProps) {
  const isFill = mode === 'fill';
  const form = useForm<CustomerFormData>({
    resolver: standardSchemaResolver(isFill ? prospectFillSchema : customerSchema),
    defaultValues: { ...emptyForm, ...initialValues },
  });
```
import: `import { customerSchema, prospectFillSchema, type CustomerFormData } from '@/lib/schemas';`

(ง) mutation (บรรทัด 134-185): ใน `mutationFn` ก่อนประกอบ `payload` เดิม เพิ่ม:
```ts
      if (isFill) {
        if (!fillCustomerId) throw new Error('fillCustomerId is required in fill mode');
        const fillPayload: Record<string, unknown> = { phone: data.phone, name };
        if (data.prefix) fillPayload.prefix = data.prefix;
        if (data.nickname) fillPayload.nickname = data.nickname;
        if (data.nationalId) fillPayload.nationalId = data.nationalId;
        if (data.facebookName) fillPayload.facebookName = data.facebookName;
        return api.post<CreatedCustomer>(`/customers/${fillCustomerId}/fill-contact`, fillPayload);
      }
```
(`name` คำนวณอยู่แล้วบรรทัดแรกของ mutationFn) และ `onSuccess`:
```ts
    onSuccess: (res) => {
      if (isFill) {
        toast.success('บันทึกข้อมูลผู้สนใจแล้ว');
        onFilled?.(res.data);
      } else {
        toast.success('เพิ่มลูกค้าสำเร็จ');
        onCreated(res.data);
      }
      onClose();
    },
```
เก็บเบอร์ที่ชนไว้แสดงใน alert: เพิ่ม state `const [dupPhone, setDupPhone] = useState('');` ข้าง `existing` และใน `onError` ก่อน `setExisting(dup)` เติม `setDupPhone(form.getValues('phone'));`

(จ) หัว (บรรทัด 357-358):
```tsx
        <DialogTitle className="text-lg font-semibold text-foreground">{isFill ? 'เพิ่มเบอร์/ข้อมูลผู้สนใจ' : 'เพิ่มลูกค้าใหม่'}</DialogTitle>
        <DialogDescription className="sr-only">{isFill ? 'แก้ข้อมูลของผู้สนใจคนเดิม — ไม่สร้างลูกค้าใหม่' : 'กรอกข้อมูลลูกค้าใหม่ หรืออ่านจากบัตรประชาชน'}</DialogDescription>
```

(ฉ) alert 409 (บรรทัด 366-380) — แทนทั้งบล็อกด้วย:
```tsx
          {existing && (
            <div role="alert" className="rounded-xl border border-warning bg-warning/10 p-4 text-sm">
              <p className="m-0 font-semibold leading-snug">
                {isFill ? `เบอร์ ${dupPhone} เป็นของลูกค้าเดิมอยู่แล้ว` : `มีลูกค้าเบอร์นี้หรืออีเมลนี้อยู่แล้ว: ${existing.name}`}
              </p>
              <p className="m-0 mt-0.5 text-xs leading-snug text-muted-foreground">
                {isFill
                  ? 'ระบบไม่สร้างซ้ำ — รวมแชทห้องนี้และผลเช็คเครดิตเข้าคนเดิม หรือแก้เบอร์แล้วบันทึกใหม่'
                  : 'ระบบไม่สร้างซ้ำ — ใช้คนเดิม หรือแก้เบอร์/อีเมลแล้วบันทึกใหม่'}
              </p>
              {isFill && (
                <div className="mt-2.5 flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-xs">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><User className="size-3.5" strokeWidth={1.5} /></span>
                  <span className="min-w-0 truncate font-semibold">{existing.name}</span>
                  <span className="text-muted-foreground">· โทร {dupPhone}</span>
                </div>
              )}
              <div className="mt-3 flex items-center gap-3">
                {onUseExisting && (
                  <button
                    type="button"
                    onClick={() => { onUseExisting(existing); onClose(); }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
                  >
                    <Link2 className="size-4" strokeWidth={1.5} /> {isFill ? 'รวมกับลูกค้าเดิมคนนี้' : 'ใช้ลูกค้าเดิมคนนี้แทน'}
                  </button>
                )}
                {isFill && (
                  <button type="button" onClick={() => setExisting(null)} className="text-sm text-muted-foreground hover:text-foreground">แก้เบอร์</button>
                )}
              </div>
            </div>
          )}
```
(`User` icon import มีอยู่แล้วบรรทัด 15)

(ช) ช่องเลขบัตร (บรรทัด ~477): แทน label ด้วย:
```tsx
                      <FormLabel className="text-xs font-medium">
                        เลขบัตรประชาชน (13 หลัก){' '}
                        {isFill ? <span className="font-normal text-muted-foreground">ไม่บังคับ — เติมตอนทำสัญญาก็ได้</span> : <span className="text-destructive">*</span>}
                      </FormLabel>
```

- [ ] **Step 4: เขียว** — Run เทส dialog ทั้งไฟล์ → PASS (รวมเทสเดิม) · `npx tsc --noEmit` → 0 · `npx eslint src/components/customer/CustomerCreateDialog.tsx src/components/customer/CustomerCreateDialog.test.tsx src/lib/schemas.ts` → 0 error

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/lib/schemas.ts apps/web/src/components/customer/CustomerCreateDialog.tsx apps/web/src/components/customer/CustomerCreateDialog.test.tsx
git commit -m "feat(customers): ฟอร์มลูกค้าโหมด 'เพิ่มเบอร์/ข้อมูลผู้สนใจ' — เลขบัตรไม่บังคับ · เบอร์ซ้ำเสนอรวมกับคนเดิม" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: เว็บ — การ์ดผู้สนใจในแผงขวา + คำใบ้ "อาจเป็นคนเดียวกัน" + ผูกกับลูกค้าเดิม

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.tsx` (imports :1-30 · `ChannelsGroup` :159-214 · derivations :372-386 · header :421-425, :464-470 · tabs :427-431 · กลุ่มข้อมูลลูกค้า :500-553 · กลุ่มตรวจเครดิต :555-560 · dialogs :626-649)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/LinkCustomerDialog.tsx` (props + หัว + toast)
- Test: `apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx`

**Interfaces:**
- Consumes: Task 3 (`PossibleSamePerson`, `useAbsorbCustomer`, `useDismissSamePerson`, `canFillProspectContact`) · Task 4 (`mode="fill"`, `fillCustomerId`, `onFilled`)
- Produces: `LinkCustomerDialog` prop ใหม่ `mergesProspect?: boolean` · พฤติกรรมการ์ด: `placeholder = !!customerId && !!room.customer?.chatPlaceholder`, `linked = !!customerId && !placeholder`

- [ ] **Step 1: เทสแดง**

ใน `RoomDossier.test.tsx`: (1) ขยาย mock ของ `CustomerCreateDialog` ให้โชว์ `mode`/`fillCustomerId` และมีปุ่มจำลอง `onFilled` — แทน component ใน `vi.mock('@/components/customer/CustomerCreateDialog', …)` ด้วย:
```tsx
    default: (p: { open: boolean; mode?: string; fillCustomerId?: string; submitLabel?: string; initialValues?: Record<string, string>; onCreated: (c: { id: string; name: string }) => void; onFilled?: (c: { id: string; name: string }) => void; onUseExisting?: (c: { id: string; name: string }) => void }) =>
      p.open ? (
        <div data-testid="create-dialog" data-mode={p.mode ?? 'create'} data-fill-id={p.fillCustomerId ?? ''}>
          <span>{JSON.stringify(p.initialValues)}</span>
          <span>{p.submitLabel}</span>
          <button onClick={() => p.onCreated({ id: 'c-new', name: 'ลูกค้าใหม่' })}>จำลองสร้างเสร็จ</button>
          <button onClick={() => p.onFilled?.({ id: 'p1', name: 'สมชาย ใจดี' })}>จำลองเติมเสร็จ</button>
          <button onClick={() => p.onUseExisting?.({ id: 'c-old', name: 'คนเดิม' })}>จำลองใช้คนเดิม</button>
        </div>
      ) : null,
```
(2) เพิ่ม `apiPost` ใน mock `@/lib/api` (`post: (...args: unknown[]) => apiPost(...args)`) และ reset ใน `beforeEach` (`apiPost.mockReset(); apiPost.mockResolvedValue({ data: {} });`). (3) เพิ่ม fixture + describe:
```tsx
const PROSPECT_ROOM = {
  ...ROOM,
  displayName: 'สมชาย ใจดี',
  customer: { id: 'p1', name: 'สมชาย ใจดี', phone: null, chatPlaceholder: true },
  possibleSamePerson: [
    { customerId: 'c-line', name: 'สมชาย ใจดี', channel: 'LINE_SHOP', hasPhone: true, chatPlaceholder: false, createdAt: '2026-09-03T02:00:00Z', mergeDirection: 'absorb_current_into_other' as const },
  ],
};

describe('RoomDossier — การ์ดผู้สนใจจากแชท (mockup 1388f98e บอร์ด 1-5)', () => {
  it('ห้องที่ถือผู้สนใจอัตโนมัติ: ป้าย 2 ชิป · ปุ่มเพิ่มเบอร์ (primary) + ผูกกับลูกค้าเดิม · ไม่มีกล่องเหลือง · ไม่ยิง cross-channel/summary · หัวบอก "ผู้สนใจจากแชท · ยังไม่มีเบอร์"', () => {
    wrap(<RoomDossier room={PROSPECT_ROOM} customerId="p1" activeRoomId="r-1" />);
    expect(screen.getByText('ผู้สนใจจากแชท')).toBeInTheDocument();
    expect(screen.getByText('ยังไม่มีเบอร์')).toBeInTheDocument();
    expect(screen.getByText(/ผู้สนใจจากแชท · ยังไม่มีเบอร์ · เริ่มคุย/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /เพิ่มเบอร์\/ข้อมูล/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /ผูกกับลูกค้าเดิม/ })).toBeEnabled();
    expect(screen.queryByText('⚠ ห้องนี้ยังไม่ได้ผูกกับลูกค้า')).toBeNull();
    expect(screen.queryByRole('button', { name: /สร้างลูกค้าใหม่/ })).toBeNull();
    expect(screen.getByText(/เติมเบอร์แล้วจะเช็คเครดิต ทำสัญญา และเห็นแชทช่องทางอื่นของคนนี้ได้/)).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่รู้ว่ามีช่องทางอื่นไหม — จะเห็นเมื่อเติมเบอร์ หรือผูกกับลูกค้าเดิม/)).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining('/cross-channel'));
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining('/chat-summary'));
    expect(screen.getByRole('button', { name: 'เปิดโปรไฟล์ลูกค้าเต็มหน้า' })).toBeEnabled();
  });

  it('เพิ่มเบอร์/ข้อมูล → เปิดฟอร์มโหมด fill ของผู้สนใจคนนี้ (ชื่อเติมให้) · เติมเสร็จโหลดห้องใหม่ · เบอร์ซ้ำ→ใช้คนเดิม = POST absorb-into', async () => {
    wrap(<RoomDossier room={PROSPECT_ROOM} customerId="p1" activeRoomId="r-1" />);
    fireEvent.click(screen.getByRole('button', { name: /เพิ่มเบอร์\/ข้อมูล/ }));
    const dlg = screen.getByTestId('create-dialog');
    expect(dlg).toHaveAttribute('data-mode', 'fill');
    expect(dlg).toHaveAttribute('data-fill-id', 'p1');
    expect(JSON.parse(dlg.querySelector('span')!.textContent!)).toEqual({ firstName: 'สมชาย', lastName: 'ใจดี', facebookName: 'สมชาย ใจดี' });
    fireEvent.click(screen.getByRole('button', { name: 'จำลองเติมเสร็จ' }));
    expect(apiPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /เพิ่มเบอร์\/ข้อมูล/ }));
    fireEvent.click(screen.getByRole('button', { name: 'จำลองใช้คนเดิม' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/customers/p1/absorb-into/c-old'));
  });

  it('คำใบ้อาจเป็นคนเดียวกัน: ข้อความตาม mockup · "รวมเป็นคนเดียวกัน" ยิง absorb ตามทิศทาง · "ไม่ใช่" ยิง dismiss', async () => {
    wrap(<RoomDossier room={PROSPECT_ROOM} customerId="p1" activeRoomId="r-1" />);
    expect(screen.getByText(/อาจเป็นคนเดียวกับ/)).toHaveTextContent('LINE ร้าน · มีเบอร์ · ทักเมื่อ');
    fireEvent.click(screen.getByRole('button', { name: 'รวมเป็นคนเดียวกัน' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/customers/p1/absorb-into/c-line'));
    fireEvent.click(screen.getByRole('button', { name: 'ไม่ใช่' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/staff-chat/rooms/r-1/same-person/dismiss', { customerId: 'c-line' }));
  });

  it('ทิศทาง absorb_other_into_current = ดูดอีกคนเข้าห้องนี้ · mergeDirection none = ไม่มีปุ่มรวม', async () => {
    const other = { ...PROSPECT_ROOM, possibleSamePerson: [
      { customerId: 'p-other', name: 'สมชาย ใจดี', channel: 'TIKTOK', hasPhone: false, chatPlaceholder: true, createdAt: '2026-09-10T02:00:00Z', mergeDirection: 'absorb_other_into_current' as const },
      { customerId: 'c-real2', name: 'สมชาย ใจดี', channel: 'WEB', hasPhone: true, chatPlaceholder: false, createdAt: '2026-09-01T02:00:00Z', mergeDirection: 'none' as const },
    ] };
    wrap(<RoomDossier room={other} customerId="p1" activeRoomId="r-1" />);
    const buttons = screen.getAllByRole('button', { name: 'รวมเป็นคนเดียวกัน' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/customers/p-other/absorb-into/p1'));
    expect(screen.getByText('ตรวจสอบเอง')).toBeInTheDocument();
  });

  it('บทบาทที่ fill-contact ไม่รับ (ACCOUNTANT) → ปุ่มเพิ่มเบอร์ปิดพร้อมเหตุผล', () => {
    authRole.role = 'ACCOUNTANT';
    wrap(<RoomDossier room={PROSPECT_ROOM} customerId="p1" activeRoomId="r-1" />);
    const btn = screen.getByRole('button', { name: /เพิ่มเบอร์\/ข้อมูล/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringContaining('เจ้าของ'));
  });
});
```
Run: `npx vitest run src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx` → Expected: เทสใหม่ FAIL (ยังเป็นกล่องเหลือง/ปุ่มเดิม), เทสเดิมยัง PASS

- [ ] **Step 2: LinkCustomerDialog**

เพิ่ม prop `mergesProspect?: boolean` (default false) ในทั้ง signature และ type; หัว/คำอธิบาย:
```tsx
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-4" /> {mergesProspect ? 'ผูกกับลูกค้าเดิม' : 'ผูกลูกค้าที่มีอยู่'}
          </DialogTitle>
          {mergesProspect ? (
            <DialogDescription className="text-xs leading-snug text-muted-foreground">แชทและผลเช็คเครดิตของผู้สนใจคนนี้จะย้ายไปรวมกับลูกค้าที่เลือก — แถวผู้สนใจอัตโนมัติจะถูกเก็บ</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">ค้นหาและผูกลูกค้าที่มีอยู่กับห้องแชทนี้</DialogDescription>
          )}
```
toast สำเร็จ: `toast.success(mergesProspect ? 'ผูกกับลูกค้าเดิมและรวมข้อมูลแชทแล้ว' : 'ผูกลูกค้ากับแชทนี้แล้ว');`

- [ ] **Step 3: RoomDossier**

(ก) imports: เพิ่ม `Phone, Users` ใน lucide import · `import { canCreateCustomer, canFillProspectContact } from '@/lib/constants';` · `import { useAbsorbCustomer, useDismissSamePerson } from '../hooks/useProspectActions';`

(ข) derivations (แทนบรรทัด `const linked = !!customerId;`):
```ts
  /* ห้องมีเจ้าของ 3 แบบ: ไม่มีเลย (ห้องเว็บก่อนข้อความแรก / เจ้าของถูกลบ) · ผู้สนใจอัตโนมัติจากแชท (placeholder — ธงจาก API เท่านั้น) · ลูกค้าจริง
     "linked" ของแผงเดิม = ลูกค้าจริงเท่านั้น (สัญญา/ประกัน/ช่องทางอื่นมีความหมายกับคนที่มีเบอร์แล้ว) */
  const placeholder = !!customerId && !!room?.customer?.chatPlaceholder;
  const linked = !!customerId && !placeholder;
  const canFill = canFillProspectContact(user?.role);
  const [fillOpen, setFillOpen] = useState(false);
  const absorb = useAbsorbCustomer(room?.id ?? '', {
    onSuccess: () => toast.success('รวมเป็นคนเดียวกันแล้ว — แชทและผลเช็คเครดิตย้ายไปแล้ว'),
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const dismiss = useDismissSamePerson(room?.id ?? '', {
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const queryClient = useQueryClient();
```
import `getErrorMessage` จาก `@/lib/api` (`import api, { getErrorMessage } from '@/lib/api';`) และ `useQueryClient` จาก `@tanstack/react-query` (`import { useQuery, useQueryClient } from '@tanstack/react-query';`) · `const { user } = useAuth();` ประกาศอยู่ก่อนบรรทัด `linked` แล้ว — ไม่ต้องย้าย · `canCreate` เดิมยังใช้ในกล่องเหลือง คงไว้

(ค) header `metaLine` (บรรทัด 423-425):
```ts
  const metaLine = placeholder
    ? ['ผู้สนใจจากแชท · ยังไม่มีเบอร์', room.createdAt ? `เริ่มคุย ${fmtDate(room.createdAt)}` : null].filter(Boolean).join(' · ')
    : linked
      ? [room.customer?.phone ? `โทร ${room.customer.phone}` : null, room.createdAt ? `เริ่มคุย ${fmtDate(room.createdAt)}` : null].filter(Boolean).join(' · ')
      : 'ยังไม่ได้ผูกกับลูกค้าในระบบ';
```
ปุ่มเปิดโปรไฟล์ (บรรทัด 464-470): `title={customerId ? 'เปิดโปรไฟล์ลูกค้าเต็มหน้า' : 'ผูกลูกค้าก่อนถึงเปิดโปรไฟล์ได้'}` · `disabled={!customerId}` (placeholder ก็มีหน้า /customers/:id)

(ง) กลุ่ม "ข้อมูลลูกค้า" (บรรทัด 500-536): แทน `{linked ? ( … ) : ( กล่องเหลือง )}` ด้วยสามแขน:
```tsx
              {linked ? (
                <button type="button" onClick={() => navigate(`/customers/${customerId}`)} className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-left text-xs font-semibold hover:bg-muted">
                  <span className="min-w-0 flex-1 truncate">{room.customer?.name}</span>
                  <span className="text-muted-foreground">›</span>
                </button>
              ) : placeholder ? (
                <ProspectCard
                  room={room}
                  customerId={customerId!}
                  canFill={canFill}
                  onFill={() => setFillOpen(true)}
                  onLink={() => setLinkOpen(true)}
                  onOpenProfile={() => navigate(`/customers/${customerId}`)}
                  onMerge={(placeholderId, targetId) => absorb.mutate({ placeholderId, targetId })}
                  onDismiss={(id) => dismiss.mutate(id)}
                  busy={absorb.isPending || dismiss.isPending}
                />
              ) : (
                <div className="rounded-[10px] border border-dashed border-warning bg-warning/10 p-3 text-xs leading-relaxed text-foreground">
                  … (กล่องเหลืองเดิมทั้งก้อน ไม่แก้) …
                </div>
              )}
```
เพิ่ม component ระดับไฟล์ (วางหลัง `AdGroup`):
```tsx
/** ─── การ์ดผู้สนใจจากแชท (mockup 1388f98e บอร์ด 1-2) — ทุกห้องมีเจ้าของตั้งแต่ทักมา กล่องเหลือง "ยังไม่ผูก" จึงเหลือเฉพาะห้องที่ไม่มีเจ้าของจริง ๆ */
function ProspectCard({ room, customerId, canFill, onFill, onLink, onOpenProfile, onMerge, onDismiss, busy }: {
  room: DossierRoom;
  customerId: string;
  canFill: boolean;
  onFill: () => void;
  onLink: () => void;
  onOpenProfile: () => void;
  onMerge: (placeholderId: string, targetId: string) => void;
  onDismiss: (customerId: string) => void;
  busy: boolean;
}) {
  const hints = (room.possibleSamePerson ?? []).slice(0, 3);
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold leading-4 text-primary">ผู้สนใจจากแชท</span>
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold leading-4 text-muted-foreground">ยังไม่มีเบอร์</span>
      </div>
      <button type="button" onClick={onOpenProfile} className="mt-2 flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-left text-xs font-semibold hover:bg-muted">
        <span className="min-w-0 flex-1 truncate">{room.customer?.name}</span>
        <span className="text-muted-foreground">›</span>
      </button>
      <p className="m-0 mt-2 text-xs leading-relaxed text-muted-foreground">
        เติมเบอร์แล้วจะเช็คเครดิต ทำสัญญา และเห็นแชทช่องทางอื่นของคนนี้ได้ · ถ้าเป็นลูกค้าเดิมอยู่แล้ว ผูกกับคนเดิมได้เลย
      </p>
      <div className="mt-2 flex gap-1.5">
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          disabled={!canFill}
          title={canFill ? undefined : 'เติมเบอร์ได้เฉพาะเจ้าของ ผู้จัดการสาขา ผู้จัดการการเงิน และฝ่ายขาย'}
          onClick={onFill}
        >
          <Phone className="mr-1 size-3.5" /> เพิ่มเบอร์/ข้อมูล
        </Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={onLink}>
          <Search className="mr-1 size-3.5" /> ผูกกับลูกค้าเดิม
        </Button>
      </div>
      {hints.map((p) => (
        <div key={p.customerId} className="mt-2 rounded-lg border border-primary/35 bg-primary/5 px-2.5 py-2 text-xs leading-snug">
          <p className="m-0">
            <Users className="mr-1 inline size-3.5 text-primary" aria-hidden="true" />
            อาจเป็นคนเดียวกับ <span className="font-semibold">{p.name}</span> — {channelLabel[p.channel] ?? p.channel} · {p.hasPhone ? 'มีเบอร์' : 'ยังไม่มีเบอร์'} · ทักเมื่อ {fmtDate(p.createdAt) || '—'}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            {p.mergeDirection === 'none' ? (
              <span className="text-muted-foreground">ตรวจสอบเอง</span>
            ) : (
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => (p.mergeDirection === 'absorb_current_into_other' ? onMerge(customerId, p.customerId) : onMerge(p.customerId, customerId))}
              >
                รวมเป็นคนเดียวกัน
              </Button>
            )}
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onDismiss(p.customerId)}>ไม่ใช่</Button>
          </div>
        </div>
      ))}
    </>
  );
}
```
(ตรวจว่า `Button` มี `variant="primary"` จริง — `button.tsx` มี variants primary/mono/destructive/secondary/outline/dashed/ghost/dim/foreground/inverse)

(จ) กลุ่ม "ตรวจเครดิต" (บรรทัด 555-560): ใน `<Group label="ตรวจเครดิต" …>` ก่อน `<RoomCreditCard …/>` เพิ่ม
```tsx
                {placeholder && <Hint>ผลจะติดอยู่กับผู้สนใจคนนี้ และตามไปเมื่อรวมกับลูกค้าเดิม</Hint>}
```

(ฉ) `ChannelsGroup`: เพิ่ม prop `placeholder: boolean`; แทนบล็อก `{!linked && ( … )}` ด้วย:
```tsx
      {placeholder && (
        <p className="mb-0 mt-2 text-xs leading-relaxed text-muted-foreground">ยังไม่รู้ว่ามีช่องทางอื่นไหม — จะเห็นเมื่อเติมเบอร์ หรือผูกกับลูกค้าเดิม</p>
      )}
      {!linked && !placeholder && (
        <>
          … (hint + ปุ่ม "ผูกห้องนี้กับลูกค้าเพื่อดูช่องทางอื่น" เดิม) …
        </>
      )}
```
และที่จุดเรียก `<ChannelsGroup …>` ส่ง `placeholder={placeholder}`

(ช) dialogs (บรรทัด 626-649): `<LinkCustomerDialog open={linkOpen} onOpenChange={setLinkOpen} roomId={room.id} mergesProspect={placeholder} />` และเพิ่ม dialog โหมด fill ถัดจาก `<CustomerCreateDialog key={room.id} …/>` เดิม (ตัวเดิมคงไว้สำหรับห้องไม่มีเจ้าของ):
```tsx
      {placeholder && customerId && (
        <CustomerCreateDialog
          key={`fill-${room.id}`}
          mode="fill"
          fillCustomerId={customerId}
          open={fillOpen}
          onOpenChange={setFillOpen}
          initialValues={createInitialValues}
          submitLabel="บันทึก"
          onCreated={() => undefined}
          onFilled={() => {
            queryClient.invalidateQueries({ queryKey: ['chat-room', room.id] });
            queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
            queryClient.invalidateQueries({ queryKey: ['customers'] });
          }}
          onUseExisting={(c) => absorb.mutate({ placeholderId: customerId, targetId: c.id })}
          context={
            <div className="flex items-center gap-2.5 border-b border-primary/25 bg-primary/8 px-6 py-2.5 text-xs leading-snug">
              <span className="relative size-7 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-border">
                <img src={avatar} alt="" className="size-full object-cover" />
                <span className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card', channelDot[room.channel] ?? 'bg-muted-foreground')} />
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="text-muted-foreground">แก้ข้อมูลของ </span>
                <span className="font-semibold">{name}</span>
                <span className="text-muted-foreground"> · {channelLabel[room.channel] ?? room.channel} · ไม่สร้างคนใหม่</span>
              </span>
              <span className="shrink-0 font-medium text-primary">ยังอยู่ในห้องนี้หลังบันทึก</span>
            </div>
          }
        />
      )}
```
(`createInitialValues` เดิมเติมชื่อ/นามสกุลจาก `room.displayName` + `facebookName` ห้อง Facebook — ใช้ร่วมได้ตรง mockup บอร์ด 3 "ชื่อเติมให้จากห้องแชทแล้ว")

- [ ] **Step 4: เขียว** — Run เทส RoomDossier ทั้งไฟล์ → PASS (เทสเดิม 10 ตัว + ใหม่ 5) · `npx tsc --noEmit` → 0 · `npx eslint src/pages/UnifiedInboxPage/components/RoomDossier.tsx src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx src/pages/UnifiedInboxPage/components/LinkCustomerDialog.tsx` → 0 error

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.tsx apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx apps/web/src/pages/UnifiedInboxPage/components/LinkCustomerDialog.tsx
git commit -m "feat(inbox): การ์ดผู้สนใจจากแชทในแผงขวา — เพิ่มเบอร์/ผูกกับลูกค้าเดิม/คำใบ้อาจเป็นคนเดียวกัน (mockup 1388f98e)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: เว็บ — หน้ารายชื่อ: KPI "มาจากแชท" กดแล้วกรอง · ตัวกรอง "ที่มา" ทั้งสองแท็บ · ส่งออกมีคอลัมน์ที่มา · กันส่งออกเกิน 10,000

**Files:**
- Create: `apps/web/src/pages/CustomersPage/components/sourceLabels.ts`
- Modify: `apps/web/src/pages/CustomersPage/types.ts:69-118` · `hooks/useCustomersQuery.ts:44-47, 128-150, 279-327, 395-405` · `components/CustomerKpiCards.tsx:43-81, 140-145` · `components/CustomerFilterBar.tsx` · `components/ProspectFilterBar.tsx:17-25` · `utils/customersExport.ts:29-47, 68-76, 157-160` · `index.tsx:181-208, 285-296` · `apps/web/src/lib/fetch-export-pages.ts:22`
- Test: `apps/web/src/pages/CustomersPage/__tests__/CustomersPage.test.tsx`

**Interfaces:**
- Consumes: API `summary.fromChat`, query `fromChat`, `source` ทั้งสองแท็บ (Plan 1 Task 13)
- Produces: `CustomerRow.phone: string | null`, `CustomerRow.chatPlaceholder?: boolean`, `CustomerRow.source?: ProspectSource | null`, `CustomerRow.acquisitionSourceRaw?: string | null` · `ProspectRow.phone: string | null`, `ProspectRow.chatPlaceholder?: boolean` · `CustomerTabSummary.fromChat: number` · hook คืน `fromChat: '' | 'true'` และ `source` (ทั้งสองแท็บ) · `SOURCE_LABELS` ที่เดียว (`components/sourceLabels.ts`) · `EXPORT_ROW_LIMIT = 10_000` export จาก `fetch-export-pages.ts`

- [ ] **Step 1: เทสแดง**

ใน `CustomersPage.test.tsx`: ใน `show()` เปลี่ยน summary แท็บลูกค้าเป็น `{ total: 10, installment: 6, cash: 3, externalFinance: 1, overdue: 2, fromChat: 4 }` และให้ `total` ของ `/customers` อ่านจาก `mocks.total ?? rows.length` (เพิ่ม `total: null as number | null` ใน `mocks` แล้ว reset ใน `beforeEach`) · แล้วเพิ่ม:
```tsx
describe('ผู้สนใจจากแชท — KPI/ตัวกรอง/ส่งออก (สเปค 3.6)', () => {
  it('แท็บลูกค้ามีการ์ดใบที่ 6 "มาจากแชท" กดแล้วเขียน ?fromChat=true และส่ง fromChat=true ให้ API', async () => {
    show();
    await screen.findByText('มาจากแชท');
    expect(screen.getByRole('group', { name: 'ตัวเลขสรุป' }).querySelectorAll('button')).toHaveLength(6);
    expect(screen.getByText('มาจากแชท').closest('button')).toHaveTextContent('4');
    fireEvent.click(screen.getByText('มาจากแชท'));
    await waitFor(() => expect(locationText()).toContain('fromChat=true'));
    await waitFor(() => expect(lastListParams().fromChat).toBe('true'));
    expect(screen.getByText('มาจากแชท').closest('button')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByText('ลูกค้าทั้งหมด'));
    await waitFor(() => expect(locationText()).not.toContain('fromChat'));
  });

  it('ตัวกรอง "ที่มา" มีในแท็บลูกค้าด้วย และส่ง source ให้ API · มี source อยู่ = ไม่มีการ์ดไหนเด่น · การ์ด "ลูกค้าทั้งหมด" ล้าง source ด้วย', async () => {
    show('/customers?zone=shop&source=LINE');
    await waitFor(() => expect(lastListParams().source).toBe('LINE'));
    expect(lastListParams().view).toBe('customers');
    expect(screen.getByRole('combobox', { name: 'ที่มา' })).toBeInTheDocument();
    expect(screen.getByText('ลูกค้าทั้งหมด').closest('button')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByText('ลูกค้าทั้งหมด'));
    await waitFor(() => expect(locationText()).not.toContain('source='));
  });

  it('ส่งออก Excel: เกิน 10,000 รายการ → เตือนให้กรองก่อน ไม่ยิง /customers/export', async () => {
    mocks.total = 10_001;
    show('/customers?zone=shop&view=prospects');
    await screen.findByRole('button', { name: /ส่งออก Excel/ });
    fireEvent.click(screen.getByRole('button', { name: /ส่งออก Excel/ }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining('เกิน 10,000')));
    expect(mocks.get).not.toHaveBeenCalledWith('/customers/export', expect.anything());
  });
});
```
(`mocks.toastError` + `vi.mock('sonner')` และ `locationText()`/`lastListParams()` มีอยู่แล้วในไฟล์ · `show(initialPath)` รับ path ที่มี `view=prospects` ได้อยู่แล้ว · การสลับแท็บ (`setView`) ล้างตัวกรองทุกตัวของทั้งสองแท็บอยู่แล้ว — `source` จึงไม่ข้ามแท็บ เป็นพฤติกรรมเดิมที่คงไว้)

Run: `npx vitest run src/pages/CustomersPage/__tests__/CustomersPage.test.tsx` → Expected: 3 เทสใหม่ FAIL

- [ ] **Step 2: types + labels**

`types.ts`: ใน `CustomerRow` เปลี่ยน `phone: string;` → `phone: string | null;` และเพิ่มท้าย interface:
```ts
  /** ผู้สนใจอัตโนมัติจากแชท (API ตัดสินให้) — แท็บลูกค้าไม่มี แต่ตัวเลือกลูกค้า (ไม่ส่ง view) ได้แถวเดียวกัน */
  chatPlaceholder?: boolean;
  source?: ProspectSource | null;
  acquisitionSourceRaw?: string | null;
```
ใน `ProspectRow` เปลี่ยน `phone: string;` → `phone: string | null;` และเพิ่ม `chatPlaceholder?: boolean;` · ใน `CustomerTabSummary` เพิ่ม `fromChat: number;`

สร้าง `components/sourceLabels.ts`:
```ts
/** ป้ายค่า `source` ของ API (ProspectSource) — ใช้ร่วมกันทั้งตัวกรองสองแท็บและไฟล์ส่งออก */
export const SOURCE_LABELS: Record<string, string> = {
  BOT: 'บอทขาย',
  FACEBOOK: 'แชท Facebook',
  LINE: 'แชท LINE',
  TIKTOK: 'แชท TikTok',
  WEB: 'เว็บ',
  REFERRAL: 'คนแนะนำ',
  WALK_IN: 'หน้าร้าน',
};
```
`ProspectFilterBar.tsx`: ลบ `const SOURCE_LABELS …` (บรรทัด 17-25) แล้ว `import { SOURCE_LABELS } from './sourceLabels';` · `customersExport.ts`: ลบสำเนา `SOURCE_LABELS` (บรรทัด ~68-76) แล้ว import จาก `../components/sourceLabels`

- [ ] **Step 3: hook**

`useCustomersQuery.ts`:
- บรรทัด 44: `const CUSTOMER_FILTER_KEYS = ['purchase', 'state', 'bought', 'tier', 'branchId', 'source', 'fromChat'] as const;`
- บรรทัด 144: `const source = pick(searchParams.get('source'), PROSPECT_SOURCES);` (ตัด `!isBuyers ?` ออก — ใช้ได้ทั้งสองแท็บ) และเพิ่มถัดไป: `const fromChat = isBuyers && searchParams.get('fromChat') === 'true' ? 'true' : '';`
- `buildParams`: ย้าย `if (source) params.source = source;` ออกจาก `else` ไปอยู่ก่อน `if (isBuyers) {` และเพิ่ม `if (fromChat) params.fromChat = 'true';` ใน branch `isBuyers`; เพิ่ม `fromChat` ใน deps array
- `hasActiveFilters` (บรรทัด ~363-368): แขน `isBuyers` เปลี่ยนเป็น `purchase || state || bought || tier || branchId || source || fromChat` (แขนผู้สนใจคงเดิม)
- interface ผลลัพธ์ของ hook (บล็อกที่มี `hasActiveFilters: boolean;` บรรทัด ~85-115): เพิ่ม `fromChat: string;` ถัดจาก `source: string;`
- ค่าที่ hook คืน (บรรทัด ~395-405): เพิ่ม `fromChat,` (และ `source` มีอยู่แล้ว)

- [ ] **Step 4: KPI + filter bar + index**

`CustomerKpiCards.tsx`: การ์ด `all` เปลี่ยน `params: { purchase: '', state: '', bought: '', fromChat: '', source: '' }` · เพิ่มใบที่ 6 ท้ายอาร์เรย์:
```ts
    {
      key: 'fromChat',
      label: 'มาจากแชท',
      tone: 'info',
      value: summary?.fromChat ?? 0,
      params: { fromChat: 'true' },
    },
```
grid (บรรทัด 144): `className={cn('mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4', cards.length === 6 ? 'lg:grid-cols-6' : 'lg:grid-cols-5')}`

`CustomerFilterBar.tsx`: เพิ่ม prop `source: string` (type + destructure) และ `import { PROSPECT_SOURCES } from '@installment/shared'; import { SOURCE_LABELS } from './sourceLabels';` · เพิ่ม `FilterSelect` เป็นตัวแรกในกริดตัวกรอง (ก่อน "การซื้อ") และปรับ `lg:grid-cols-4` → `lg:grid-cols-5` (อ่าน className จริงของกริดในไฟล์ก่อน):
```tsx
        <FilterSelect
          ariaLabel="ที่มา"
          placeholder="ทุกที่มา"
          width={148}
          value={source}
          onChange={(value) => setFilters({ source: value })}
          groups={[{ options: PROSPECT_SOURCES.map((key) => ({ value: key, label: SOURCE_LABELS[key] })) }]}
        />
```
`index.tsx`: ส่ง `source={q.source}` ให้ `<CustomerFilterBar …>` · `activeKpiKey` (บรรทัด 195-208): current ของแท็บลูกค้า = `{ purchase: q.purchase, state: q.state, bought: q.bought, fromChat: q.fromChat, source: q.source }` และเพิ่ม `q.fromChat` ใน deps

- [ ] **Step 5: ส่งออก**

`fetch-export-pages.ts`: `export const EXPORT_ROW_LIMIT = 10_000;` แล้วใช้แทน `10_000` ที่บรรทัด 22 · `customersExport.ts` `customerColumns`: แทรก `{ header: 'ที่มา', key: 'source', width: 16 },` หลัง `เบอร์โทร` และใน mapping แท็บลูกค้า (บรรทัด ~160) เพิ่ม `source: c.source ? (SOURCE_LABELS[c.source] ?? c.source) : '-',` หลัง `phone` · `index.tsx` `handleExport`:
```ts
  const handleExport = async () => {
    if (q.total > EXPORT_ROW_LIMIT) {
      toast.error(`รายการเกิน ${EXPORT_ROW_LIMIT.toLocaleString()} ราย — กรอง "ติดต่อล่าสุด" หรือตัวกรองอื่นให้แคบลงก่อนส่งออก`);
      return;
    }
    setIsExporting(true);
    …
```
(`import { EXPORT_ROW_LIMIT } from '@/lib/fetch-export-pages';`)

- [ ] **Step 6: เขียว** — Run เทส CustomersPage ทั้งไฟล์ → PASS (รวมเทสเดิม เช่น "5 ใบ" ของแท็บลูกค้าที่ต้องแก้เป็น 6 — ปรับเทสเดิม `'แท็บลูกค้า: 5 ใบ …'` ให้นับ 6 และเช็คว่า 5 ใบเดิมยังอยู่) · `npx tsc --noEmit` → 0 · eslint ไฟล์ที่แตะ → 0 error

- [ ] **Step 7: Commit**
```bash
git add apps/web/src/pages/CustomersPage/types.ts apps/web/src/pages/CustomersPage/hooks/useCustomersQuery.ts apps/web/src/pages/CustomersPage/components/CustomerKpiCards.tsx apps/web/src/pages/CustomersPage/components/CustomerFilterBar.tsx apps/web/src/pages/CustomersPage/components/ProspectFilterBar.tsx apps/web/src/pages/CustomersPage/components/sourceLabels.ts apps/web/src/pages/CustomersPage/utils/customersExport.ts apps/web/src/pages/CustomersPage/index.tsx apps/web/src/pages/CustomersPage/__tests__/CustomersPage.test.tsx apps/web/src/lib/fetch-export-pages.ts
git commit -m "feat(customers): KPI 'มาจากแชท' กดแล้วกรอง · ตัวกรองที่มาทั้งสองแท็บ · ส่งออกมีคอลัมน์ที่มา · กันส่งออกเกิน 10,000" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: เว็บ — ป้ายผู้สนใจในหน้ารายละเอียด + ตัวเลือกลูกค้า 3 จุด แสดง "จากแชท · ยังไม่มีเบอร์"

**Files:**
- Create: `apps/web/src/components/customer/ProspectPhoneLine.tsx` (+ `ProspectPhoneLine.test.tsx`)
- Modify: `apps/web/src/pages/CustomerDetailPage.tsx:43-92` (type) และ `:593-611` (แถวชิป)
- Modify: `apps/web/src/pages/ContractCreatePage/types.ts:17-27` · `apps/web/src/pages/ContractCreatePage/components/CustomerSelectStep.tsx:83` · `apps/web/src/components/credit-check/types.tsx:12-20` · `apps/web/src/components/credit-check/CreditCheckCreateModal.tsx:156, 193` · `apps/web/src/pages/BookingsPage.tsx:95-99, 501`

**Interfaces:**
- Produces: `<ProspectPhoneLine phone={string|null|undefined} chatPlaceholder={boolean|undefined} className? />` → `จากแชท · ยังไม่มีเบอร์` (เมื่อ chatPlaceholder) / เบอร์ / `—`

- [ ] **Step 1: เทสแดง**

`apps/web/src/components/customer/ProspectPhoneLine.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProspectPhoneLine from './ProspectPhoneLine';

describe('ProspectPhoneLine', () => {
  it('ผู้สนใจจากแชท → "จากแชท · ยังไม่มีเบอร์" (ไม่ใช่บรรทัดว่าง)', () => {
    render(<ProspectPhoneLine phone={null} chatPlaceholder />);
    expect(screen.getByText('จากแชท · ยังไม่มีเบอร์')).toBeInTheDocument();
  });
  it('มีเบอร์ → แสดงเบอร์ · ไม่มีเบอร์และไม่ใช่ผู้สนใจจากแชท → ขีด', () => {
    const { rerender } = render(<ProspectPhoneLine phone="0812345678" />);
    expect(screen.getByText('0812345678')).toBeInTheDocument();
    rerender(<ProspectPhoneLine phone={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
```
Run: `npx vitest run src/components/customer/ProspectPhoneLine.test.tsx` → FAIL (module not found)

- [ ] **Step 2: component**

```tsx
import { cn } from '@/lib/utils';

/**
 * บรรทัดเบอร์ในตัวเลือกลูกค้า (POS · ใบจอง · ตรวจเครดิต) — ผู้สนใจจากแชทที่ยังไม่มีเบอร์ต้อง "เห็น ไม่ซ่อน"
 * (ค้นชื่อ Facebook เจอได้เป็นฟีเจอร์ — สเปค 3.6) แต่แทนบรรทัดว่างด้วยป้ายที่บอกว่าทำไมไม่มีเบอร์
 * ธง `chatPlaceholder` มาจาก API เท่านั้น
 */
export default function ProspectPhoneLine({ phone, chatPlaceholder, className }: { phone?: string | null; chatPlaceholder?: boolean; className?: string }) {
  if (chatPlaceholder) {
    return <span className={cn('inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold leading-4 text-primary', className)}>จากแชท · ยังไม่มีเบอร์</span>;
  }
  if (!phone) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return <span className={cn('tabular-nums', className)}>{phone}</span>;
}
```

- [ ] **Step 3: ใช้ใน 3 ตัวเลือก + หน้ารายละเอียด**

- `ContractCreatePage/types.ts` `Customer`: `phone: string | null;` + `chatPlaceholder?: boolean;` · `CustomerSelectStep.tsx:83` แทน `<div className="text-xs text-muted-foreground mt-1">{c.phone}</div>` ด้วย `<div className="mt-1 text-xs text-muted-foreground"><ProspectPhoneLine phone={c.phone} chatPlaceholder={c.chatPlaceholder} /></div>` (+ import)
- `credit-check/types.tsx` `Customer`: เหมือนกัน · `CreditCheckCreateModal.tsx:156` แทน `{c.phone}{' '}…` ด้วย `<ProspectPhoneLine phone={c.phone} chatPlaceholder={c.chatPlaceholder} />{' '}…` และ `:193` `<div className="text-xs font-medium"><ProspectPhoneLine phone={selectedCustomer.phone} chatPlaceholder={selectedCustomer.chatPlaceholder} /></div>`
- `BookingsPage.tsx` `CustomerOption`: เพิ่ม `chatPlaceholder?: boolean;` · บรรทัด 501: `{c.chatPlaceholder ? ' — จากแชท · ยังไม่มีเบอร์' : c.phone ? ` — ${c.phone}` : ''}`
- `CustomerDetailPage.tsx`: `CustomerDetail.phone: string | null;` + `chatPlaceholder?: boolean;` · ในแถวชิป (หลัง `{customer?.phone && …}`) เพิ่ม:
```tsx
                {customer?.chatPlaceholder && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">ผู้สนใจจากแชท · ยังไม่มีเบอร์</span>
                )}
```
(ฟอร์มแก้ไขของหน้านี้ส่ง `phone` เฉพาะเมื่อมีค่า — เบอร์ว่างของผู้สนใจไม่ถูกส่ง จึงตรงสเปค "ห้ามล้างเบอร์" อยู่แล้ว; ไม่ต้องแก้)

- [ ] **Step 4: เขียว** — Run เทส ProspectPhoneLine → PASS · `npx tsc --noEmit` → 0 (ถ้า `phone: string | null` ทำให้ที่อื่นแดง เช่น `maskNationalId(c.phone)` — แก้จุดนั้นให้รับ null ด้วย `?? ''` และบันทึกใน report) · eslint ไฟล์ที่แตะ → 0 error · `npx vitest run src/pages/ContractCreatePage src/components/credit-check src/pages/BookingsPage.test.tsx` → PASS

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/components/customer/ProspectPhoneLine.tsx apps/web/src/components/customer/ProspectPhoneLine.test.tsx apps/web/src/pages/CustomerDetailPage.tsx apps/web/src/pages/ContractCreatePage/types.ts apps/web/src/pages/ContractCreatePage/components/CustomerSelectStep.tsx apps/web/src/components/credit-check/types.tsx apps/web/src/components/credit-check/CreditCheckCreateModal.tsx apps/web/src/pages/BookingsPage.tsx
git commit -m "feat(customers): ป้าย 'ผู้สนใจจากแชท' หน้ารายละเอียด + ตัวเลือกลูกค้า POS/ใบจอง/ตรวจเครดิต แสดง 'จากแชท · ยังไม่มีเบอร์'" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: ตรวจรวม · bump version 26.9.26 · PR (stacked — ยังไม่ merge)

- [ ] **Step 1: ชุดทดสอบทั้งหมดที่แตะ**
  - เว็บ (จาก `apps/web`): `npx vitest run` ทั้งชุด → 0 failed · `npx tsc --noEmit` → 0 error · `npx eslint` ทุกไฟล์ `.ts/.tsx` ที่ branch นี้แตะ (`git diff --name-only abe13491e..HEAD -- apps/web | grep -E '\.tsx?$'`) → 0 error
  - API (จาก `apps/api`, env ตาม Global Constraints): `npx jest src/modules/customers src/modules/staff-chat --runInBand` → 0 failed · จากนั้น `npx jest --runInBand` ทั้งชุด → 0 failed (baseline หลัง Plan 1 = 680 suites / 8,397 tests) · `npx tsc --noEmit -p apps/api/tsconfig.json` → 0
- [ ] **Step 2: bump + commit** — `apps/web/package.json` `"version": "26.9.25"` → `"26.9.26"` · `git add apps/web/package.json && git commit -m "chore(web): bump version 26.9.26" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`
- [ ] **Step 3: push + PR (ไม่ merge เอง — ถามเจ้าของก่อน push ตามแบบ Plan 1 R8)** — `git push -u origin feat/chat-prospects-web` → `gh pr create --base feat/chat-prospects --head feat/chat-prospects-web --title "feat(chat-prospects): Plan 2 เว็บ — การ์ดผู้สนใจในอินบ็อกซ์ + หน้าลูกค้า + เติมเบอร์สำหรับ SALES" --body-file <ไฟล์ body>` · body ระบุ: **stacked บน #1592 — retarget base เป็น `main` หลัง #1592 merge ก่อน merge PR นี้** · หลัง deploy ทั้งสอง PR แล้วจึงประกาศให้ทีมใช้อินบ็อกซ์ (ข้อจำกัด R21 ของ Plan 1 หมดไป)
- [ ] **Step 4: บันทึก memory** — อัปเดต `bestchoice-chat-prospects.md` (สถานะ PR Plan 2, สิ่งที่ค้าง)

---

## อะไร

ครึ่งหน้าจอของ "ผู้สนใจจากแชท" + endpoint เติมเบอร์ที่ SALES ใช้ได้ — ปิดข้อจำกัดชั่วคราวของเว็บ 26.9.24 (ปุ่มผูก/สร้างหายเพราะทุกห้องมี placeholder)

## ลำดับขึ้น prod

1. merge + deploy #1592 (Plan 1) → backfill ตาม runbook ใน PR #1592
2. retarget PR แผนนี้เป็น `main` → merge → deploy web 26.9.26 + API
3. เปิดห้องในอินบ็อกซ์เห็นการ์ดผู้สนใจ · ทดลอง: เติมเบอร์ (SALES) → ห้องกลายเป็นลูกค้าปกติ · เติมเบอร์ซ้ำ → "รวมกับลูกค้าเดิมคนนี้" → ห้องย้ายไปคนเดิม · คำใบ้ → รวม/ไม่ใช่ · แท็บลูกค้า KPI "มาจากแชท" กดแล้วกรอง
4. แล้วค่อยประกาศให้ทีมใช้อินบ็อกซ์

## เทส

- API: controller spec (fill-contact ผ่านด่าน SALES) · `.db.spec.ts` บน Postgres จริง (เขียน phone/phoneHash · 409 เบอร์ซ้ำพร้อม existingCustomer · 409 ไม่ใช่ placeholder · 404 ถูกลบ · audit) · chat-commerce ข้อความใหม่/เดิม
- เว็บ: hooks (URL + invalidate) · dialog โหมด fill (payload · 409 → รวม/แก้เบอร์ · โหมดสร้างไม่เปลี่ยน) · RoomDossier (การ์ด · ฟอร์ม fill · absorb ทั้ง 2 ทิศ · dismiss · สิทธิ์ · ห้องไม่มีเจ้าของยังเป็นกล่องเหลือง) · CustomersPage (KPI 6 ใบ กดแล้ว fromChat=true · ที่มาทั้งสองแท็บ · กันส่งออกเกิน 10,000) · ProspectPhoneLine

## Self-review (ทำแล้วตอนเขียนแผน)

- **สเปค §3.6 ครบ:** การ์ดแผงขวา + 2 ปุ่ม (T5) · เบอร์ซ้ำ→รวมผ่าน `onUseExisting` (T4+T5) · PhoneCell "—" (มีแล้ว) + ป้ายหน้ารายละเอียด (T7) + ฟอร์มแก้ไขไม่ล้างเบอร์ (พฤติกรรมเดิม) · ตัวเลือกลูกค้า 3 จุด (T7) · คำใบ้อาจเป็นคนเดียวกัน + ไม่ใช่ (T5) · KPI มาจากแชท กดแล้วกรอง + ที่มาทั้งสองแท็บ + ส่งออกคอลัมน์ที่มา (T6) · กันส่งออกเกิน 10,000 (T6) · SALES เติมเบอร์ (T1 — R27) · ข้อความส่งข้อมูลชำระ (T2 — final review M4)
- **ไม่ทำในแผนนี้ (บอกไว้):** แท็บ "สัญญา/ชำระ" และ "ประกัน" ของห้องผู้สนใจยังเป็นสถานะว่างเดิม (คำแนะนำในนั้นพูดถึง "ผูกลูกค้า" — ยอมรับได้ เพราะการ์ดแท็บ 1 บอกทางแล้ว) · การ์ดรายละเอียด "ผ่อนอยู่ N สัญญา / ลูกค้าตั้งแต่" ในกล่องเบอร์ซ้ำ (API 409 ส่งแค่ id+name — ไม่ขยาย payload) · ห้องหลังรวม (บอร์ด 5) = หน้าตาลูกค้าปกติเดิม ไม่มีโค้ดใหม่
- **ชื่อ/ชนิดตรงกันข้าม task:** `chatPlaceholder` (API → DossierRoom.customer / CustomerRow / ProspectRow / CustomerDetail / ตัวเลือก) · `PossibleSamePerson.mergeDirection` 3 ค่า (T3 นิยาม, T5 ใช้) · `useAbsorbCustomer.mutate({ placeholderId, targetId })` (T3 → T5) · `mode/fillCustomerId/onFilled` (T4 → T5) · `fromChat: 'true'` string (T6 hook ↔ KPI params ↔ API DTO) · `EXPORT_ROW_LIMIT` (T6) · `PROSPECT_CONTACT_ROLES` = roles ของ `fill-contact` (T1 ↔ T3)
- **Placeholder scan:** ทุก step มีโค้ด/คำสั่งจริง; จุดที่ต้องอ่านไฟล์จริงก่อนแก้ (เลขบรรทัด/ชื่อ className ของกริดตัวกรอง/`reqOf`) ระบุไว้ชัดเจนพร้อมสิ่งที่ต้องคง
