# FB echo ปิดรอบรอตอบ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** คำตอบที่พนักงานส่งจาก Meta Business Suite (FB echo) ปิดรอบรอตอบและล้าง `waitingSince` ได้ — ยกเว้นข้อความที่เพจตอบเอง (ภายใน 5 วินาทีหลังลูกค้าทัก) และข้อความทักทายใบแรก

**Architecture:** กติกาเวลาเป็นฟังก์ชันล้วนไฟล์เดียว (`staff-echo-rule.ts`) · `RoomManagerService.isHumanStaffEcho` ประกอบกติกา (ทักทายใบแรก + เวลา) จากฐานข้อมูล — ผู้ตัดสินตัวเดียว · `MessageRouterService.mirrorOutbound` ถามตัวนี้แล้วส่ง `closeAsHuman` เข้า `confirmExternalEcho` → `ResponseCycleService.confirmUnknownEcho` ซึ่งปิดรอบด้วย `closeHumanInTx` ตัวเดิมภายใต้ล็อกห้องเดิม · ปิดสวิตช์คิวงานแชทใช้กติกาเดียวกันก่อน `clearWaiting`

**Tech Stack:** NestJS 11 · Prisma 6.19 · PostgreSQL · Jest + ts-jest (`*.spec.ts` unit, `*.db.spec.ts` บนฐานทดสอบจริง)

**Spec:** `docs/superpowers/specs/2026-11-26-fb-echo-closes-response-cycle-design.md`

## Global Constraints

- เกณฑ์ = `5_000` มิลลิวินาที, ขอบ 5 วินาทีพอดี = เพจตอบเอง (คำตัดสินเจ้าของ D1 2026-11-26)
- ตัดสินตอน echo เข้ามา — ไม่มี cron (D2)
- รอบที่ปิดด้วย echo: `endReason HUMAN_REPLY` · `firstHumanStaffId = null` · `firstHumanSentAt = echo.createdAt` (D3)
- ไม่มี migration · ไม่มีค่าตั้งใหม่ · ไม่แตะหน้าเว็บ · ไม่แตะ `pauseAiForStaffEcho`
- **ห้าม commit / push / PR / deploy จนกว่าเจ้าของสั่งตรง ๆ** (กติกาเจ้าของ) — ขั้น "Commit" ทุกขั้นในแผนนี้ = หยุดรอคำสั่ง
- ทำงานใน worktree `D:\BESTCHOICE APP\BESTCHOICE\.worktrees\fb-echo` (branch `feat/fb-echo-closes-cycle` จาก `origin/main` a1acf9f04) เท่านั้น — main tree มีงานของ session อื่น
- worktree มี `node_modules` ของตัวเอง (junction ทุกตัว ยกเว้น `@prisma/client` ที่คัดลอกจริง + `.prisma` ที่ generate จาก schema ของ worktree + `@installment/*` ชี้ worktree) — **ห้าม `prisma generate` ใน main tree** (ทับ client ของ session อื่น)
- jest ต้องใช้ `NODE_OPTIONS=--max-old-space-size=8192` (ts-jest type-check ชนิด Prisma ใหญ่ — ไม่ตั้ง = heap OOM)
- ข้อความ/คอมเมนต์ภาษาไทยได้ · ชื่อตัวแปรภาษาอังกฤษ · Prettier (singleQuote, printWidth 100)

คำสั่งพื้นฐาน (ทุกคำสั่งรันจาก `D:\BESTCHOICE APP\BESTCHOICE\.worktrees\fb-echo\apps\api`):

```bash
export NODE_OPTIONS=--max-old-space-size=8192
npx jest <path> --runInBand
```

---

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| Create `apps/api/src/modules/chat-engine/utils/staff-echo-rule.ts` | กติกาเวลาล้วน + ค่าคงที่ 5 วิ |
| Create `apps/api/src/modules/chat-engine/utils/staff-echo-rule.spec.ts` | ตารางขอบเวลา |
| Modify `apps/api/src/modules/chat-engine/services/room-manager.service.ts` (~:947 `shouldSkipFirstOutboundClear`, ~:1008 `confirmExternalEcho`) | `isHumanStaffEcho` + ส่ง `closeAsHuman` ต่อ |
| Create `apps/api/src/modules/chat-engine/services/room-manager.staff-echo.spec.ts` | กติการวมบน prisma จำลอง |
| Modify `apps/api/src/modules/chat-engine/services/response-cycle.service.ts` (:220-232 `confirmUnknownEcho`) | ปิดรอบด้วย echo ของคน |
| Create `apps/api/src/modules/chat-engine/services/response-cycle.echo.db.spec.ts` | ปิด/เปิดรอบบนฐานจริง |
| Modify `apps/api/src/modules/chat-engine/services/message-router.service.ts` (:873-885) | ต่อสาย `mirrorOutbound` |
| Modify `apps/api/src/modules/chat-engine/services/message-router.service.spec.ts` (:720-745, :793-910) | ปรับเทสต์ echo ตามกติกาใหม่ |
| Create `apps/api/src/modules/chat-engine/services/message-router.echo-cycle.db.spec.ts` | ทางจริง `mirrorOutbound` → รอบ บนฐานจริง |

---

### Task 1: กติกาเวลา (ฟังก์ชันล้วน)

**Files:**
- Create: `apps/api/src/modules/chat-engine/utils/staff-echo-rule.ts`
- Test: `apps/api/src/modules/chat-engine/utils/staff-echo-rule.spec.ts`

**Interfaces:**
- Produces: `PAGE_AUTOREPLY_MAX_DELAY_MS: 5000` · `isHumanStaffEchoTiming(input: { echoAt: Date; customerAtBefore: Date | null }): boolean` — ผู้เรียกต้องส่งข้อความลูกค้าใบล่าสุดที่ `createdAt <= echoAt` เท่านั้น

- [x] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/chat-engine/utils/staff-echo-rule.spec.ts
import { isHumanStaffEchoTiming, PAGE_AUTOREPLY_MAX_DELAY_MS } from './staff-echo-rule';

const echoAt = new Date('2026-11-27T03:00:10.000Z');
const before = (ms: number) => new Date(echoAt.getTime() - ms);

describe('isHumanStaffEchoTiming — echo ช้ากว่าข้อความลูกค้าเกิน 5 วินาที = คนตอบ', () => {
  const cases: Array<[string, Date | null, boolean]> = [
    ['ไม่มีข้อความลูกค้าก่อนหน้า = คนตอบ', null, true],
    ['ลูกค้าทักเวลาเดียวกันพอดี = เพจตอบเอง', before(0), false],
    ['4.999 วิ = เพจตอบเอง', before(4_999), false],
    ['5 วิพอดี (ขอบ) = เพจตอบเอง', before(5_000), false],
    ['5.001 วิ = คนตอบ', before(5_001), true],
    ['3 นาที = คนตอบ', before(180_000), true],
  ];
  it.each(cases)('%s', (_label, customerAtBefore, expected) => {
    expect(isHumanStaffEchoTiming({ echoAt, customerAtBefore })).toBe(expected);
  });

  it('เกณฑ์ = 5 วินาที (คำตัดสินเจ้าของ D1 2026-11-26)', () => {
    expect(PAGE_AUTOREPLY_MAX_DELAY_MS).toBe(5_000);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/chat-engine/utils/staff-echo-rule.spec.ts --runInBand`
Expected: FAIL — `Cannot find module './staff-echo-rule'`

- [x] **Step 3: Write minimal implementation**

```ts
// apps/api/src/modules/chat-engine/utils/staff-echo-rule.ts
/**
 * กติกาเวลาของ "echo ของพนักงานใบนี้เป็นคนตอบไหม" — สเปก 2026-11-26-fb-echo-closes-response-cycle-design.md
 *
 * ข้อมูล prod 7 วัน (2026-11-26): ข้อความที่เพจตอบเอง ("📱 อัปเดตสต๊อค…") มาภายใน 5 วิหลังลูกค้าทัก 424/611 ครั้ง
 * ค่ากลาง 3 วิ · คำสั้นที่คนพิมพ์มาภายใน 5 วิแค่ 9/271 ครั้ง ค่ากลาง 48 วิ ⇒ ระยะเวลาแยกได้ ·
 * รหัสแอปของ echo แยกไม่ได้ (ทั้งสองแบบมาจากแอปเดียวกัน) และรายการคำขึ้นต้นจับได้ 0
 *
 * ผู้เรียกต้องส่งข้อความลูกค้าใบล่าสุดที่บันทึก "ไม่หลัง" echo — ทั้งสองฝั่งเป็นเวลาที่เซิร์ฟเวอร์บันทึก
 * ข้อความลูกค้าที่ประมวลผลช้าทำให้ระยะดูสั้นกว่าจริง ⇒ ตกเป็นเพจตอบเอง = ห้องค้างในคิว (ผิดได้ทางเดียวคือทางปลอดภัย)
 */
export const PAGE_AUTOREPLY_MAX_DELAY_MS = 5_000;

export function isHumanStaffEchoTiming(input: {
  echoAt: Date;
  customerAtBefore: Date | null;
}): boolean {
  if (!input.customerAtBefore) return true;
  return input.echoAt.getTime() - input.customerAtBefore.getTime() > PAGE_AUTOREPLY_MAX_DELAY_MS;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/chat-engine/utils/staff-echo-rule.spec.ts --runInBand`
Expected: PASS — 7 tests

- [x] **Step 5: Commit** — หยุด ไม่ commit จนกว่าเจ้าของสั่ง (Global Constraints)

---

### Task 2: ผู้ตัดสินตัวเดียว `RoomManagerService.isHumanStaffEcho` + ส่ง `closeAsHuman`

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/room-manager.service.ts` (เพิ่มเมธอดต่อจาก `shouldSkipFirstOutboundClear` ~:947-971 · แก้ `confirmExternalEcho` ~:1008-1012 · เพิ่ม import)
- Test: `apps/api/src/modules/chat-engine/services/room-manager.staff-echo.spec.ts`

**Interfaces:**
- Consumes: `isHumanStaffEchoTiming` (Task 1) · `shouldSkipFirstOutboundClear(roomId, outboundMessageId): Promise<boolean>` (เดิม)
- Produces: `isHumanStaffEcho(roomId: string, messageId: string): Promise<boolean>` · `confirmExternalEcho(messageId: string, opts?: { closeAsHuman?: boolean }): Promise<boolean>` — ส่ง `opts` ต่อให้ `ResponseCycleService.confirmUnknownEcho(messageId, opts)` (Task 3 เปลี่ยนลายเซ็นฝั่งนั้น)

- [x] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/chat-engine/services/room-manager.staff-echo.spec.ts
import { MessageRole } from '@prisma/client';
import { RoomManagerService } from './room-manager.service';

const T0 = new Date('2026-11-27T03:00:00.000Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

type Row = { id: string; role: MessageRole; createdAt: Date; deletedAt?: Date | null };

/** prisma จำลองเท่าที่ isHumanStaffEcho + shouldSkipFirstOutboundClear ใช้ — ห้อง r1 ห้องเดียว */
function makeRoomManager(rows: Row[], opts: { waitingSince?: Date | null; responseCycles?: unknown } = {}) {
  const messages = rows.map((r) => ({ roomId: 'r1', ...r, deletedAt: r.deletedAt ?? null }));
  const waitingSince = opts.waitingSince === undefined ? T0 : opts.waitingSince;
  const prisma = {
    chatRoom: {
      findUnique: jest.fn(async ({ where }: any) => (where.id === 'r1' ? { waitingSince } : null)),
    },
    chatMessage: {
      findUnique: jest.fn(async ({ where }: any) => messages.find((m) => m.id === where.id) ?? null),
      count: jest.fn(
        async ({ where }: any) =>
          messages.filter(
            (m) => m.roomId === where.roomId && m.deletedAt === null && where.role.in.includes(m.role),
          ).length,
      ),
      findFirst: jest.fn(
        async ({ where }: any) =>
          messages
            .filter(
              (m) =>
                m.roomId === where.roomId &&
                m.role === where.role &&
                m.deletedAt === null &&
                m.createdAt.getTime() <= where.createdAt.lte.getTime(),
            )
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
      ),
    },
  };
  return new RoomManagerService(
    prisma as any,
    {} as any,
    undefined,
    undefined,
    undefined,
    undefined,
    opts.responseCycles as any,
  );
}

const C = MessageRole.CUSTOMER;
const S = MessageRole.STAFF;
const B = MessageRole.BOT;

describe('RoomManagerService.isHumanStaffEcho — กติกาเดียวของ "คนตอบ"', () => {
  it('คนตอบ 30 วิหลังลูกค้าทัก (ห้องเคยมีขาออกแล้ว) → true', async () => {
    const rm = makeRoomManager([
      { id: 'c1', role: C, createdAt: at(0) },
      { id: 'b1', role: B, createdAt: at(1) },
      { id: 'e1', role: S, createdAt: at(30) },
    ]);
    await expect(rm.isHumanStaffEcho('r1', 'e1')).resolves.toBe(true);
  });

  it('echo 2 วิหลังข้อความลูกค้าใบล่าสุด = เพจตอบเอง → false', async () => {
    const rm = makeRoomManager([
      { id: 'c1', role: C, createdAt: at(0) },
      { id: 'b1', role: B, createdAt: at(1) },
      { id: 'c2', role: C, createdAt: at(100) },
      { id: 'e1', role: S, createdAt: at(102) },
    ]);
    await expect(rm.isHumanStaffEcho('r1', 'e1')).resolves.toBe(false);
  });

  it('ขาออกใบแรกของห้องภายใน 60 วิหลังเริ่มรอ = ข้อความทักทาย → false แม้ช้ากว่า 5 วิ', async () => {
    const rm = makeRoomManager([
      { id: 'c1', role: C, createdAt: at(0) },
      { id: 'e1', role: S, createdAt: at(30) },
    ]);
    await expect(rm.isHumanStaffEcho('r1', 'e1')).resolves.toBe(false);
  });

  it('ข้อความลูกค้าที่บันทึกหลัง echo ไม่นับ → true', async () => {
    const rm = makeRoomManager([
      { id: 'c1', role: C, createdAt: at(0) },
      { id: 'b1', role: B, createdAt: at(1) },
      { id: 'e1', role: S, createdAt: at(30) },
      { id: 'c2', role: C, createdAt: at(32) },
    ]);
    await expect(rm.isHumanStaffEcho('r1', 'e1')).resolves.toBe(true);
  });

  it('ข้อความลูกค้าที่ถูกลบภายใน 5 วิไม่นับ → true', async () => {
    const rm = makeRoomManager([
      { id: 'c1', role: C, createdAt: at(0) },
      { id: 'b1', role: B, createdAt: at(1) },
      { id: 'cx', role: C, createdAt: at(28), deletedAt: at(29) },
      { id: 'e1', role: S, createdAt: at(30) },
    ]);
    await expect(rm.isHumanStaffEcho('r1', 'e1')).resolves.toBe(true);
  });

  it('ห้องไม่มีข้อความลูกค้าเลยและไม่มีใครรอ → true', async () => {
    const rm = makeRoomManager(
      [
        { id: 'b1', role: B, createdAt: at(1) },
        { id: 'e1', role: S, createdAt: at(30) },
      ],
      { waitingSince: null },
    );
    await expect(rm.isHumanStaffEcho('r1', 'e1')).resolves.toBe(true);
  });

  it('อ่านแถว echo ไม่ได้ → false (ห้องค้างในคิว = ทางปลอดภัย)', async () => {
    const rm = makeRoomManager([{ id: 'c1', role: C, createdAt: at(0) }]);
    await expect(rm.isHumanStaffEcho('r1', 'missing')).resolves.toBe(false);
  });
});

describe('RoomManagerService.confirmExternalEcho — ส่ง closeAsHuman ต่อ', () => {
  it('สวิตช์คิวงานแชทปิด → false และไม่เรียก response cycle', async () => {
    const responseCycles = {
      enabled: jest.fn().mockResolvedValue(false),
      confirmUnknownEcho: jest.fn(),
    };
    const rm = makeRoomManager([], { responseCycles });
    await expect(rm.confirmExternalEcho('e1', { closeAsHuman: true })).resolves.toBe(false);
    expect(responseCycles.confirmUnknownEcho).not.toHaveBeenCalled();
  });

  it('สวิตช์เปิด → true และส่ง closeAsHuman ต่อทั้งก้อน', async () => {
    const responseCycles = {
      enabled: jest.fn().mockResolvedValue(true),
      confirmUnknownEcho: jest.fn().mockResolvedValue(undefined),
    };
    const rm = makeRoomManager([], { responseCycles });
    await expect(rm.confirmExternalEcho('e1', { closeAsHuman: true })).resolves.toBe(true);
    expect(responseCycles.confirmUnknownEcho).toHaveBeenCalledWith('e1', { closeAsHuman: true });
  });

  it('ไม่ส่ง opts → ส่งต่อเป็นวัตถุว่าง (ไม่ปิดรอบ)', async () => {
    const responseCycles = {
      enabled: jest.fn().mockResolvedValue(true),
      confirmUnknownEcho: jest.fn().mockResolvedValue(undefined),
    };
    const rm = makeRoomManager([], { responseCycles });
    await rm.confirmExternalEcho('e1');
    expect(responseCycles.confirmUnknownEcho).toHaveBeenCalledWith('e1', {});
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/chat-engine/services/room-manager.staff-echo.spec.ts --runInBand`
Expected: FAIL — `rm.isHumanStaffEcho is not a function` (และ `confirmUnknownEcho` ถูกเรียกด้วยอาร์กิวเมนต์เดียว)

- [x] **Step 3: Write minimal implementation**

เพิ่ม import ใกล้ import อื่นของ `../utils/` ด้านบนไฟล์:

```ts
import { isHumanStaffEchoTiming } from '../utils/staff-echo-rule';
```

เพิ่มเมธอดต่อจากปิดวงเล็บของ `shouldSkipFirstOutboundClear`:

```ts
  /**
   * echo ของพนักงานใบนี้เป็น "คนตอบ" ไหม — ผู้ตัดสินตัวเดียว ใช้ทั้งตอนเปิด/ปิดสวิตช์คิวงานแชท
   * (สเปก 2026-11-26-fb-echo-closes-response-cycle-design.md) ห้ามเขียนเงื่อนไขชุดที่สอง:
   *   1. ไม่ใช่ข้อความทักทายใบแรกของห้อง (`shouldSkipFirstOutboundClear` — เรียกหลังบันทึก echo เท่านั้น)
   *   2. ไม่มีข้อความลูกค้าภายใน 5 วิก่อน echo (`isHumanStaffEchoTiming`) — เร็วกว่านั้น = เพจตอบเอง
   * อ่านแถว echo ไม่ได้ = ไม่ใช่ (ห้องค้างในคิว — ทางปลอดภัย)
   */
  async isHumanStaffEcho(roomId: string, messageId: string): Promise<boolean> {
    const echo = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { createdAt: true },
    });
    if (!echo) return false;
    if (await this.shouldSkipFirstOutboundClear(roomId, messageId)) return false;
    const customer = await this.prisma.chatMessage.findFirst({
      where: {
        roomId,
        role: MessageRole.CUSTOMER,
        deletedAt: null,
        createdAt: { lte: echo.createdAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return isHumanStaffEchoTiming({
      echoAt: echo.createdAt,
      customerAtBefore: customer?.createdAt ?? null,
    });
  }
```

แทนที่ `confirmExternalEcho` เดิมทั้งเมธอด:

```ts
  /** echo จาก Meta — `closeAsHuman` (ผลของ `isHumanStaffEcho`) ให้ response cycle ปิดรอบได้ · คืน true เมื่อสวิตช์คิวงานแชทเปิด */
  async confirmExternalEcho(
    messageId: string,
    opts: { closeAsHuman?: boolean } = {},
  ): Promise<boolean> {
    if (!this.responseCycles || !(await this.responseCycles.enabled())) return false;
    await this.responseCycles.confirmUnknownEcho(messageId, opts);
    return true;
  }
```

(ถ้า `MessageRole` ยังไม่ถูก import ในไฟล์ — มีอยู่แล้วเพราะ `shouldSkipFirstOutboundClear` ใช้ `MessageRole.STAFF` — ไม่ต้องเพิ่ม)

- [x] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/chat-engine/services/room-manager.staff-echo.spec.ts --runInBand`
Expected: PASS — 10 tests. ถ้า TS ฟ้องว่า `confirmUnknownEcho` รับอาร์กิวเมนต์เดียว = ถูกต้อง ทำ Task 3 Step 3 ก่อนแล้วรันใหม่ (ลายเซ็นสองฝั่งต้องเปลี่ยนคู่กัน)

- [x] **Step 5: Commit** — หยุด ไม่ commit จนกว่าเจ้าของสั่ง

---

### Task 3: `ResponseCycleService.confirmUnknownEcho` ปิดรอบด้วย echo ของคน

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/response-cycle.service.ts:220-232`
- Test: `apps/api/src/modules/chat-engine/services/response-cycle.echo.db.spec.ts`

**Interfaces:**
- Consumes: `lock(tx, roomId)` · `closeHumanInTx(tx, { roomId, cycleId, messageId, answeredThroughMessageId, staffId, sentAt })` · `openInTx(tx, { roomId, messageId, receivedAt })` (เดิมทั้งหมด)
- Produces: `confirmUnknownEcho(messageId: string, opts?: { closeAsHuman?: boolean }): Promise<void>`

- [x] **Step 1: เตรียมฐานทดสอบ** (ครั้งเดียว — สเปก db ต้องมีชื่อฐาน `test_db` หรือลงท้าย `_test`)

```bash
docker ps --format '{{.Names}} {{.Image}}' | grep -i postgres
# ใช้ container ของ docker compose (image pgvector/pgvector:pg16, user postgres, พอร์ต 5432)
docker exec <container> psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='bestchoice_echo_test'" | grep -q 1 \
  || docker exec <container> createdb -U postgres bestchoice_echo_test
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/bestchoice_echo_test?schema=public'
npx prisma migrate deploy
```

Expected: `All migrations have been successfully applied.` (ถ้า docker ไม่รัน: `docker compose up -d` ที่ root ของ main tree ก่อน)

- [x] **Step 2: Write the failing test**

```ts
// apps/api/src/modules/chat-engine/services/response-cycle.echo.db.spec.ts
/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/chat-engine/services/response-cycle.echo.db.spec.ts --runInBand
 *
 * สเปก 2026-11-26-fb-echo-closes-response-cycle-design.md — echo ของคนจาก Meta ปิดรอบ (HUMAN_REPLY, ไม่ทราบผู้ตอบ,
 * เวลาตอบ = เวลาบันทึก echo) · ข้อความลูกค้าหลังเส้นแบ่งเปิดรอบใหม่ · ไม่ใช่คน / ไม่มีรอบ / รอบเริ่มหลัง echo = ไม่ปิด
 */
import { ChatChannel, MessageRole, PrismaClient } from '@prisma/client';
import { ResponseCycleService } from './response-cycle.service';

const prisma = new PrismaClient();
const service = new ResponseCycleService(prisma as never);
const tag = `echo-${Date.now().toString(36)}`;
const T0 = new Date(Date.now() - 3_600_000);
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
let seq = 0;

async function room(): Promise<string> {
  const r = await prisma.chatRoom.create({
    data: { channel: ChatChannel.FACEBOOK, externalUserId: `${tag}-${++seq}` },
  });
  return r.id;
}

/** ข้อความลูกค้า + เปิดรอบแบบเดียวกับ saveMessage ทาง tracking */
async function customer(roomId: string, createdAt: Date): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const m = await tx.chatMessage.create({
      data: { roomId, role: MessageRole.CUSTOMER, text: 'สนใจครับ', createdAt },
    });
    await service.openInTx(tx, { roomId, messageId: m.id, receivedAt: createdAt });
    return m.id;
  });
}

async function outbound(roomId: string, createdAt: Date, role: MessageRole = MessageRole.STAFF) {
  const m = await prisma.chatMessage.create({ data: { roomId, role, text: 'ตอบจาก Meta', createdAt } });
  return m.id;
}

const openCycles = (roomId: string) =>
  prisma.chatResponseCycle.findMany({ where: { roomId, endedAt: null } });

beforeAll(() => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียน/ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
});

afterAll(async () => {
  const rooms = await prisma.chatRoom.findMany({
    where: { externalUserId: { startsWith: tag } },
    select: { id: true },
  });
  const ids = rooms.map((r) => r.id);
  await prisma.chatMessage.deleteMany({ where: { roomId: { in: ids } } });
  await prisma.chatResponseCycle.deleteMany({ where: { roomId: { in: ids } } });
  await prisma.chatRoom.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('ResponseCycleService.confirmUnknownEcho — echo ของคนปิดรอบ', () => {
  it('คนตอบ → HUMAN_REPLY · ไม่ทราบผู้ตอบ · เวลาตอบ = เวลา echo · waitingSince ว่าง · echo ถือเส้นแบ่ง', async () => {
    const r = await room();
    const c1 = await customer(r, at(0));
    const [cycle] = await openCycles(r);
    const e1 = await outbound(r, at(30));

    await service.confirmUnknownEcho(e1, { closeAsHuman: true });

    const closed = await prisma.chatResponseCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(closed.endReason).toBe('HUMAN_REPLY');
    expect(closed.endedAt).toEqual(at(30));
    expect(closed.firstHumanSentAt).toEqual(at(30));
    expect(closed.firstHumanStaffId).toBeNull();
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: r } })).waitingSince).toBeNull();
    const echo = await prisma.chatMessage.findUniqueOrThrow({ where: { id: e1 } });
    const cust = await prisma.chatMessage.findUniqueOrThrow({ where: { id: c1 } });
    expect(echo.cycleId).toBe(cycle.id);
    expect(echo.answeredThroughMessageId).toBe(c1);
    expect(echo.answeredThroughSequence).toBe(cust.inboundSequence);
    expect(echo.outboundSentAt).not.toBeNull();
    expect(await openCycles(r)).toHaveLength(0);
  });

  it('ลูกค้าทักต่อหลังเวลา echo → ปิดรอบเดิมแล้วเปิดรอบใหม่จากข้อความนั้น ห้องยังรอตอบ', async () => {
    const r = await room();
    await customer(r, at(0));
    const c2 = await customer(r, at(40));
    const e1 = await outbound(r, at(30));

    await service.confirmUnknownEcho(e1, { closeAsHuman: true });

    const open = await openCycles(r);
    expect(open).toHaveLength(1);
    expect(open[0].startedAt).toEqual(at(40));
    expect(open[0].firstCustomerMessageId).toBe(c2);
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: r } })).waitingSince).toEqual(at(40));
    const ended = await prisma.chatResponseCycle.findMany({ where: { roomId: r, endedAt: { not: null } } });
    expect(ended).toHaveLength(1);
    expect(ended[0].endReason).toBe('HUMAN_REPLY');
  });

  it('closeAsHuman = false (เพจตอบเอง) → ประทับส่งถึงอย่างเดียว รอบยังเปิด', async () => {
    const r = await room();
    await customer(r, at(0));
    const e1 = await outbound(r, at(2));

    await service.confirmUnknownEcho(e1, { closeAsHuman: false });

    expect(await openCycles(r)).toHaveLength(1);
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: r } })).waitingSince).toEqual(at(0));
    const echo = await prisma.chatMessage.findUniqueOrThrow({ where: { id: e1 } });
    expect(echo.outboundSentAt).not.toBeNull();
    expect(echo.cycleId).toBeNull();
  });

  it('ไม่ส่ง opts → พฤติกรรมเดิม ไม่ปิดรอบ', async () => {
    const r = await room();
    await customer(r, at(0));
    const e1 = await outbound(r, at(30));

    await service.confirmUnknownEcho(e1);

    expect(await openCycles(r)).toHaveLength(1);
  });

  it('ไม่มีรอบเปิด → ไม่ทำอะไร ไม่ error', async () => {
    const r = await room();
    const e1 = await outbound(r, at(30));

    await expect(service.confirmUnknownEcho(e1, { closeAsHuman: true })).resolves.toBeUndefined();

    expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: e1 } })).cycleId).toBeNull();
  });

  it('รอบเริ่มหลังเวลา echo (echo ตอบข้อความเก่า) → ไม่ปิด', async () => {
    const r = await room();
    const e1 = await outbound(r, at(10));
    await customer(r, at(20));

    await service.confirmUnknownEcho(e1, { closeAsHuman: true });

    expect(await openCycles(r)).toHaveLength(1);
  });

  it('ข้อความ BOT แม้ส่ง closeAsHuman → ไม่ปิด', async () => {
    const r = await room();
    await customer(r, at(0));
    const b1 = await outbound(r, at(30), MessageRole.BOT);

    await service.confirmUnknownEcho(b1, { closeAsHuman: true });

    expect(await openCycles(r)).toHaveLength(1);
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL='postgresql://postgres:postgres@localhost:5432/bestchoice_echo_test?schema=public' npx jest src/modules/chat-engine/services/response-cycle.echo.db.spec.ts --runInBand`
Expected: FAIL — ts-jest ฟ้อง `Expected 1 arguments, but got 2` ที่ `confirmUnknownEcho(e1, { … })`

- [x] **Step 4: Write minimal implementation**

แทนที่ `confirmUnknownEcho` เดิม (คอมเมนต์ `/** Echo proves delivery … */` ถึงปิดเมธอด) ด้วย:

```ts
  /**
   * echo จาก Meta (พนักงานตอบนอก inbox ของเรา): ประทับว่าส่งถึงแล้วเสมอ ·
   * `closeAsHuman` = ผลของ `RoomManagerService.isHumanStaffEcho` (ไม่ใช่ทักทายใบแรก + ไม่มีลูกค้าใน 5 วิก่อนหน้า)
   * → ปิดรอบที่เปิดอยู่ด้วยเส้นแบ่งจากข้อความลูกค้าที่บันทึกก่อน echo (สเปก 2026-11-26-fb-echo-closes-response-cycle-design.md)
   * เดิมไม่ปิดเลย ⇒ พนักงานที่ตอบผ่าน Meta ทั้งหมดทำให้คิวรอตอบ/แจ้งเตือนเวลารอสะสมไม่หยุด
   */
  async confirmUnknownEcho(messageId: string, opts: { closeAsHuman?: boolean } = {}) {
    await this.prisma.$transaction(async (tx) => {
      const message = await tx.chatMessage.findUniqueOrThrow({ where: { id: messageId } });
      await this.lock(tx, message.roomId);
      const sentAt = new Date();
      await tx.chatMessage.updateMany({
        where: { id: messageId, outboundSentAt: null },
        data: { outboundSentAt: sentAt, outboundAttemptState: 'CONFIRMED' },
      });
      if (message.role === 'BOT')
        await this.recordBotSentInTx(tx, { roomId: message.roomId, sentAt });
      if (message.role === 'STAFF' && opts.closeAsHuman)
        await this.closeByEchoInTx(tx, {
          id: message.id,
          roomId: message.roomId,
          createdAt: message.createdAt,
        });
    });
  }

  /** ปิดรอบด้วย echo ของคน — ผู้ตอบ "ไม่ทราบ" (Meta ไม่บอกว่าพนักงานคนไหน) · เวลาตอบ = เวลาที่บันทึก echo */
  private async closeByEchoInTx(
    tx: Prisma.TransactionClient,
    echo: { id: string; roomId: string; createdAt: Date },
  ) {
    const cycle = await tx.chatResponseCycle.findFirst({
      where: { roomId: echo.roomId, endedAt: null },
      select: { id: true, startedAt: true },
    });
    // ไม่มีรอบเปิด = ไม่มีใครรอ · รอบเริ่มหลัง echo = echo ตอบข้อความเก่า ไม่ใช่ข้อความที่เปิดรอบนี้
    if (!cycle || cycle.startedAt > echo.createdAt) return;
    const through = await tx.chatMessage.findFirst({
      where: {
        roomId: echo.roomId,
        role: 'CUSTOMER',
        deletedAt: null,
        inboundSequence: { not: null },
        createdAt: { lte: echo.createdAt },
      },
      orderBy: { inboundSequence: 'desc' },
      select: { id: true, inboundSequence: true },
    });
    if (!through || through.inboundSequence === null) return;
    await tx.chatMessage.update({
      where: { id: echo.id },
      data: {
        cycleId: cycle.id,
        answeredThroughMessageId: through.id,
        answeredThroughSequence: through.inboundSequence,
      },
    });
    await this.closeHumanInTx(tx, {
      roomId: echo.roomId,
      cycleId: cycle.id,
      messageId: echo.id,
      answeredThroughMessageId: through.id,
      staffId: null,
      sentAt: echo.createdAt,
    });
  }
```

- [x] **Step 5: Run tests to verify they pass**

Run (ฐานทดสอบ): `DATABASE_URL='postgresql://postgres:postgres@localhost:5432/bestchoice_echo_test?schema=public' npx jest src/modules/chat-engine/services/response-cycle.echo.db.spec.ts src/modules/chat-engine/services/room-manager.staff-echo.spec.ts --runInBand`
Expected: PASS — 7 + 10 tests

- [x] **Step 6: Commit** — หยุด ไม่ commit จนกว่าเจ้าของสั่ง

---

### Task 4: ต่อสาย `mirrorOutbound` + ปรับเทสต์ router

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.ts:873-885`
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.spec.ts:720-745` (ชุด "echo ล้าง waiting") และ `:793-910` (ชุด "ข้อความทักทายอัตโนมัติของเพจ…")

**Interfaces:**
- Consumes: `isHumanStaffEcho(roomId, messageId)` · `confirmExternalEcho(messageId, { closeAsHuman })` (Task 2) · `clearWaiting(roomId)` (เดิม)
- Produces: พฤติกรรม — echo STAFF ที่เป็นคน → เปิดสวิตช์: รอบปิดผ่าน `confirmExternalEcho` · ปิดสวิตช์: `clearWaiting` · echo ที่ไม่ใช่คน → ไม่ทั้งสองอย่าง · roomManager ที่ไม่มี `isHumanStaffEcho` (mock บางส่วน) = ถือว่าคน (พฤติกรรมก่อนมีกติกานี้)

- [x] **Step 1: Write the failing tests** — ในชุด `describe('MessageRouterService.mirrorOutbound — echo ล้าง waiting'` (เดิม 3 เทสต์ คงไว้) เพิ่มต่อท้ายก่อน `});` ปิด describe:

```ts
  it('กติกาบอกว่าไม่ใช่คน (เพจตอบเอง) → ไม่ล้าง waiting', async () => {
    const { router, roomManager } = makeRouter({});
    (roomManager as any).isHumanStaffEcho = jest.fn().mockResolvedValue(false);
    await router.mirrorOutbound({ ...base, role: MessageRole.STAFF, externalMessageId: 'mid-3' });
    expect((roomManager as any).isHumanStaffEcho).toHaveBeenCalledWith('r1', 'm1');
    expect(roomManager.clearWaiting).not.toHaveBeenCalled();
  });

  it('สวิตช์คิวงานแชทเปิด + คนตอบ → ส่ง closeAsHuman: true ให้ response cycle และไม่เรียก clearWaiting', async () => {
    const { router, roomManager } = makeRouter({});
    (roomManager as any).isHumanStaffEcho = jest.fn().mockResolvedValue(true);
    (roomManager as any).confirmExternalEcho = jest.fn().mockResolvedValue(true);
    await router.mirrorOutbound({ ...base, role: MessageRole.STAFF, externalMessageId: 'mid-4' });
    expect((roomManager as any).confirmExternalEcho).toHaveBeenCalledWith('m1', { closeAsHuman: true });
    expect(roomManager.clearWaiting).not.toHaveBeenCalled();
  });

  it('สวิตช์เปิด + เพจตอบเอง → ส่ง closeAsHuman: false', async () => {
    const { router, roomManager } = makeRouter({});
    (roomManager as any).isHumanStaffEcho = jest.fn().mockResolvedValue(false);
    (roomManager as any).confirmExternalEcho = jest.fn().mockResolvedValue(true);
    await router.mirrorOutbound({ ...base, role: MessageRole.STAFF, externalMessageId: 'mid-5' });
    expect((roomManager as any).confirmExternalEcho).toHaveBeenCalledWith('m1', { closeAsHuman: false });
    expect(roomManager.clearWaiting).not.toHaveBeenCalled();
  });

  it('BOT echo → ไม่ถามกติกา · closeAsHuman: false', async () => {
    const { router, roomManager } = makeRouter({});
    (roomManager as any).isHumanStaffEcho = jest.fn();
    (roomManager as any).confirmExternalEcho = jest.fn().mockResolvedValue(true);
    await router.mirrorOutbound({ ...base, role: MessageRole.BOT, externalMessageId: 'mid-6' });
    expect((roomManager as any).isHumanStaffEcho).not.toHaveBeenCalled();
    expect((roomManager as any).confirmExternalEcho).toHaveBeenCalledWith('m1', { closeAsHuman: false });
  });
```

แล้วแก้ชุด `describe('MessageRouterService.mirrorOutbound — ข้อความทักทายอัตโนมัติของเพจต้องไม่เตะลูกค้าใหม่ออกจากคิว'` ให้ตัดสินด้วย `isHumanStaffEcho` ตัวจริง:

1. ใน `makeEchoRouter` หลัง `const messages: any[] = [];` เพิ่มข้อความลูกค้าที่เวลาเริ่มรอ:

```ts
    messages.push({
      id: 'cust-0',
      roomId: 'r1',
      role: MessageRole.CUSTOMER,
      createdAt: WAITING_SINCE,
      deletedAt: null,
    });
```

2. ใน `prisma.chatMessage` ของ fake เพิ่ม `findFirst`:

```ts
        findFirst: jest.fn(
          async ({ where }: any) =>
            messages
              .filter(
                (m) =>
                  m.roomId === where.roomId &&
                  m.role === where.role &&
                  m.deletedAt === null &&
                  m.createdAt.getTime() <= where.createdAt.lte.getTime(),
              )
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
        ),
```

3. ใน `roomManager` ของ fake แทน `shouldSkipFirstOutboundClear: jest.fn(…)` ด้วย:

```ts
      isHumanStaffEcho: jest.fn((roomId: string, msgId: string) =>
        realRoomManager.isHumanStaffEcho(roomId, msgId),
      ),
```

4. แทนเทสต์ `'ห้องที่เคยมี outbound แล้ว → echo ใบถัดไปล้างเสมอ แม้จะมาเร็ว'` ด้วยสองเทสต์:

```ts
  it('ห้องที่เคยมี outbound แล้ว + echo มาภายใน 5 วิหลังลูกค้าทัก (= เพจตอบเอง) → ไม่ล้าง', async () => {
    const { router, roomManager } = makeEchoRouter({
      priorOutbound: 1,
      echoAt: new Date(WAITING_SINCE.getTime() + 2_000),
    });
    await router.mirrorOutbound({ ...base, role: MessageRole.STAFF, externalMessageId: 'mid-g3' } as any);
    expect(roomManager.clearWaiting).not.toHaveBeenCalled();
  });

  it('ห้องที่เคยมี outbound แล้ว + echo มาหลังลูกค้าทัก 30 วิ (= คนตอบ) → ล้าง', async () => {
    const { router, roomManager } = makeEchoRouter({
      priorOutbound: 1,
      echoAt: new Date(WAITING_SINCE.getTime() + 30_000),
    });
    await router.mirrorOutbound({ ...base, role: MessageRole.STAFF, externalMessageId: 'mid-g3b' } as any);
    expect(roomManager.clearWaiting).toHaveBeenCalledWith('r1');
  });
```

5. ในเทสต์ `'BOT echo → ไม่ล้าง และไม่ต้องถามด่านเลย'` และ `'echo ซ้ำ (P2002) → …'` เปลี่ยน `expect(roomManager.shouldSkipFirstOutboundClear).not.toHaveBeenCalled();` เป็น `expect(roomManager.isHumanStaffEcho).not.toHaveBeenCalled();`

- [x] **Step 2: Run tests to verify the new ones fail**

Run: `npx jest src/modules/chat-engine/services/message-router.service.spec.ts --runInBand`
Expected: FAIL — เทสต์ใหม่ใน "echo ล้าง waiting" (`isHumanStaffEcho` ไม่ถูกเรียก / `confirmExternalEcho` ถูกเรียกด้วยอาร์กิวเมนต์เดียว) และ "…+ echo มาภายใน 5 วิ… → ไม่ล้าง" (ยังล้าง)

- [x] **Step 3: Write minimal implementation** — แทนบล็อกคอมเมนต์ + โค้ดเดิมตั้งแต่ `// echo STAFF = Facebook ยืนยันว่าข้อความจากคนถึงลูกค้าแล้ว …` ถึงปิด `if (params.role === MessageRole.STAFF && !trackedEcho) { … }` ด้วย:

```ts
    // echo STAFF = ข้อความถึงลูกค้าแล้ว — "คนตอบ" ตัดสินด้วยกติกาเดียว RoomManagerService.isHumanStaffEcho
    // (ไม่ใช่ข้อความทักทายใบแรก + ไม่มีลูกค้าทักภายใน 5 วิก่อนหน้า — เร็วกว่านั้น = เพจตอบเอง)
    // ใช้ทั้งสองโหมด (สเปก 2026-11-26-fb-echo-closes-response-cycle-design.md):
    //   สวิตช์คิวงานแชทเปิด → response cycle ปิดรอบให้ (closeAsHuman) — เดิมไม่ปิดเลย คิวรอตอบสะสมไม่หยุด
    //   สวิตช์ปิด → clearWaiting เฉพาะคนตอบ — เดิมล้างทุก echo ยกเว้นทักทาย (ข้อความอัตโนมัติปลดห้องได้)
    // BOT ไม่ใช่คำตอบจากคน · `?.` เพราะ spec หลายตัว mock roomManager บางส่วน — ไม่มีเมธอด = ถือว่าคน (พฤติกรรมเดิม)
    const human =
      params.role === MessageRole.STAFF && !!saved?.id
        ? (await this.roomManager.isHumanStaffEcho?.(room.id, saved.id)) !== false
        : false;
    const trackedEcho = saved?.id
      ? await this.roomManager.confirmExternalEcho?.(saved.id, { closeAsHuman: human })
      : false;
    if (human && !trackedEcho) await this.roomManager.clearWaiting?.(room.id);
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx jest src/modules/chat-engine/services/message-router.service.spec.ts --runInBand`
Expected: PASS — 81 เดิม + 4 ใหม่ + 1 (แยกเทสต์ g3 เป็นสอง) = 86 tests

- [x] **Step 5: ตรวจผู้เรียกอื่นที่ mock `shouldSkipFirstOutboundClear`/`confirmExternalEcho`**

Run: `grep -rn "shouldSkipFirstOutboundClear\|confirmExternalEcho" src --include=*.spec.ts`
Expected: เหลือเฉพาะในไฟล์ที่แก้ใน Task 2/4 — ถ้ามีไฟล์อื่น ปรับ mock ตาม Step 1 ข้อ 3 แล้วรันไฟล์นั้น

- [x] **Step 6: Commit** — หยุด ไม่ commit จนกว่าเจ้าของสั่ง

---

### Task 5: ทางจริง `mirrorOutbound` → รอบ บนฐานจริง + ตรวจรวม

**Files:**
- Test: `apps/api/src/modules/chat-engine/services/message-router.echo-cycle.db.spec.ts`
- Modify: `docs/superpowers/specs/2026-11-26-fb-echo-closes-response-cycle-design.md` (หัวข้อ "ทดสอบ" ข้อ 1 และ 4 ให้ตรงกับแผน)

**Interfaces:**
- Consumes: ทุกอย่างจาก Task 1-4 · `RoomManagerService(prisma, storage, assignment?, router?, chatProspects?, merge?, responseCycles?)` · `MessageRouterService(roomManager, handoffManager, configService, …)` · `saveMessage` (ทาง tracking เปิดรอบเอง)

- [x] **Step 1: Write the test**

```ts
// apps/api/src/modules/chat-engine/services/message-router.echo-cycle.db.spec.ts
/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/chat-engine/services/message-router.echo-cycle.db.spec.ts --runInBand
 *
 * ทางจริงของ echo จาก Meta: MessageRouterService.mirrorOutbound → RoomManagerService.isHumanStaffEcho
 * → confirmExternalEcho → ResponseCycleService (สเปก 2026-11-26-fb-echo-closes-response-cycle-design.md)
 * เวลา echo = now() ของฐาน จึงถอยเวลาข้อความลูกค้า/รอบ/waitingSince แทนการรอจริง
 */
import { ChatChannel, MessageRole, PrismaClient } from '@prisma/client';
import { MessageRouterService } from './message-router.service';
import { ResponseCycleService } from './response-cycle.service';
import { RoomManagerService } from './room-manager.service';

const prisma = new PrismaClient();
const cycles = new ResponseCycleService(prisma as never);
const rooms = new RoomManagerService(
  prisma as never,
  {} as never,
  undefined,
  undefined,
  undefined,
  undefined,
  cycles,
);
const router = new MessageRouterService(
  rooms,
  { initiateHandoff: jest.fn() } as never,
  { get: jest.fn().mockReturnValue(undefined) } as never,
);
const tag = `echoe2e-${Date.now().toString(36)}`;
const FLAG = 'chat_work_queue_enabled';
let originalFlag: { value: string; deletedAt: Date | null } | null = null;
let seq = 0;

async function setFlag(on: boolean) {
  await prisma.systemConfig.upsert({
    where: { key: FLAG },
    create: { key: FLAG, value: on ? 'true' : 'false' },
    update: { value: on ? 'true' : 'false', deletedAt: null },
  });
}

/** ห้อง FB + ลูกค้าทัก (ทาง saveMessage จริง) แล้วถอยเวลาลูกค้า/รอบ/waitingSince ไป `agoSec` วินาที */
async function roomWithCustomer(agoSec: number, opts: { priorBot?: boolean } = {}) {
  const psid = `${tag}-${++seq}`;
  const r = await rooms.getOrCreateRoom({ externalUserId: psid, channel: ChatChannel.FACEBOOK });
  const ago = new Date(Date.now() - agoSec * 1000);
  if (opts.priorBot) {
    await rooms.saveMessage({ roomId: r.id, role: MessageRole.BOT, text: 'สวัสดีค่ะ' });
    await prisma.chatMessage.updateMany({
      where: { roomId: r.id, role: MessageRole.BOT },
      data: { createdAt: new Date(ago.getTime() - 60_000) },
    });
  }
  const c = await rooms.saveMessage({ roomId: r.id, role: MessageRole.CUSTOMER, text: 'สนใจ' });
  await prisma.chatMessage.update({ where: { id: c.id }, data: { createdAt: ago } });
  await prisma.chatResponseCycle.updateMany({
    where: { roomId: r.id, endedAt: null },
    data: { startedAt: ago },
  });
  await prisma.chatRoom.update({ where: { id: r.id }, data: { waitingSince: ago } });
  return { roomId: r.id, psid };
}

const echo = (psid: string, mid: string) =>
  router.mirrorOutbound({
    externalUserId: psid,
    channel: ChatChannel.FACEBOOK,
    role: MessageRole.STAFF,
    text: 'มีค่ะ สีดำ',
    externalMessageId: `${tag}-${mid}`,
  });

const state = async (roomId: string) => ({
  waitingSince: (await prisma.chatRoom.findUniqueOrThrow({ where: { id: roomId } })).waitingSince,
  open: await prisma.chatResponseCycle.count({ where: { roomId, endedAt: null } }),
  human: await prisma.chatResponseCycle.count({
    where: { roomId, endReason: 'HUMAN_REPLY', firstHumanStaffId: null },
  }),
});

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียน/ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
  originalFlag = await prisma.systemConfig.findUnique({
    where: { key: FLAG },
    select: { value: true, deletedAt: true },
  });
});

afterAll(async () => {
  const ids = (
    await prisma.chatRoom.findMany({
      where: { externalUserId: { startsWith: tag } },
      select: { id: true },
    })
  ).map((r) => r.id);
  await prisma.chatMessage.deleteMany({ where: { roomId: { in: ids } } });
  await prisma.chatResponseCycle.deleteMany({ where: { roomId: { in: ids } } });
  await prisma.chatRoom.deleteMany({ where: { id: { in: ids } } });
  if (originalFlag)
    await prisma.systemConfig.update({ where: { key: FLAG }, data: originalFlag });
  else await prisma.systemConfig.deleteMany({ where: { key: FLAG } });
  await prisma.$disconnect();
});

describe('mirrorOutbound → รอบรอตอบ (สวิตช์คิวงานแชทเปิด)', () => {
  beforeEach(() => setFlag(true));

  it('คนตอบ 30 วิหลังลูกค้าทัก → รอบปิด HUMAN_REPLY ไม่ทราบผู้ตอบ · ห้องหลุดจากรอตอบ', async () => {
    const { roomId, psid } = await roomWithCustomer(30, { priorBot: true });
    await echo(psid, 'h1');
    expect(await state(roomId)).toEqual({ waitingSince: null, open: 0, human: 1 });
  });

  it('echo ทันทีหลังลูกค้าทัก (เพจตอบเอง) → รอบยังเปิด ห้องยังรอตอบ', async () => {
    const { roomId, psid } = await roomWithCustomer(1, { priorBot: true });
    await echo(psid, 'a1');
    const s = await state(roomId);
    expect(s.open).toBe(1);
    expect(s.human).toBe(0);
    expect(s.waitingSince).not.toBeNull();
  });

  it('ขาออกใบแรกของห้อง 30 วิหลังลูกค้าทัก (ข้อความทักทาย) → รอบยังเปิด', async () => {
    const { roomId, psid } = await roomWithCustomer(30);
    await echo(psid, 'g1');
    expect((await state(roomId)).open).toBe(1);
  });
});

describe('mirrorOutbound → waitingSince (สวิตช์คิวงานแชทปิด — กติกาเดียวกัน)', () => {
  beforeEach(() => setFlag(false));

  it('คนตอบ → ล้าง waitingSince', async () => {
    const { roomId, psid } = await roomWithCustomer(30, { priorBot: true });
    await echo(psid, 'h2');
    expect((await state(roomId)).waitingSince).toBeNull();
  });

  it('เพจตอบเอง → ไม่ล้าง', async () => {
    const { roomId, psid } = await roomWithCustomer(1, { priorBot: true });
    await echo(psid, 'a2');
    expect((await state(roomId)).waitingSince).not.toBeNull();
  });
});
```

หมายเหตุ: สวิตช์ปิด `saveMessage` ไม่เปิดรอบ (ไม่มีแถว cycle) — `updateMany` ของรอบใน `roomWithCustomer` จึงไม่มีผล และ `waitingSince` ตั้งโดย `saveMessage` ทางเดิมก่อนถูกถอยเวลา

- [x] **Step 2: Run to verify it passes**

Run: `DATABASE_URL='postgresql://postgres:postgres@localhost:5432/bestchoice_echo_test?schema=public' npx jest src/modules/chat-engine/services/message-router.echo-cycle.db.spec.ts --runInBand`
Expected: PASS — 5 tests. ถ้า "คนตอบ…" ล้ม ให้ตรวจว่า `RoomManagerService` ได้ `responseCycles` เป็นอาร์กิวเมนต์ที่ 7 จริง (ลำดับ constructor)

- [x] **Step 3: Sanity — ย้อน Task 4 Step 3 ชั่วคราวแล้วเทสต์ต้องแดง**

แก้ `closeAsHuman: human` เป็น `closeAsHuman: false` ชั่วคราว → รันคำสั่ง Step 2 → Expected: FAIL ที่ "คนตอบ 30 วิ…" (`open: 1`) → คืนค่าเดิม → รันอีกครั้ง PASS

- [x] **Step 4: แก้สเปกหัวข้อ "ทดสอบ" ให้ตรงกับแผน**

ใน `docs/superpowers/specs/2026-11-26-fb-echo-closes-response-cycle-design.md`:
- ข้อ 1 เปลี่ยน `· ลูกค้าหลัง echo ไม่นับ` เป็น `(ลูกค้าหลัง echo ไม่นับ — ทดสอบที่ isHumanStaffEcho)`
- ข้อ 4 แทนทั้งข้อด้วย: `4. **รายงาน** — ไม่เพิ่มเทสต์: ตัวนับ unknownStaffCycles (chat-analytics-v2.service.ts:97) กรอง origin LIVE + first_human_sent_at ไม่ว่าง + first_human_staff_id ว่าง ซึ่งเทสต์ข้อ 2 ยืนยันทั้งสามค่าบนแถวรอบแล้ว`

- [x] **Step 5: ตรวจรวม**

```bash
npx jest src/modules/chat-engine --runInBand
npx eslint src/modules/chat-engine/utils/staff-echo-rule.ts src/modules/chat-engine/utils/staff-echo-rule.spec.ts src/modules/chat-engine/services/room-manager.service.ts src/modules/chat-engine/services/room-manager.staff-echo.spec.ts src/modules/chat-engine/services/response-cycle.service.ts src/modules/chat-engine/services/response-cycle.echo.db.spec.ts src/modules/chat-engine/services/message-router.service.ts src/modules/chat-engine/services/message-router.service.spec.ts src/modules/chat-engine/services/message-router.echo-cycle.db.spec.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: jest — ทุกไฟล์ใน chat-engine ผ่าน ยกเว้น `*.db.spec.ts` ที่ต้องมี `DATABASE_URL` ฐานทดสอบ (รันชุดแรกพร้อม `DATABASE_URL` ของฐานทดสอบ) · eslint ไม่มี error · tsc ไม่มี error

- [x] **Step 6: Commit** — หยุด ไม่ commit จนกว่าเจ้าของสั่ง · รายงานผลให้เจ้าของพร้อมรายการไฟล์ที่แก้
