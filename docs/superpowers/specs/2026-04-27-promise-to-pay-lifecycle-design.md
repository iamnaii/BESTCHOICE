# Promise-to-Pay Lifecycle Redesign

**Date:** 2026-04-27
**Owner:** Akenarin
**Scope:** Collections — นัดชำระ (Promise to Pay)
**Status:** Approved (lifecycle decisions); pending implementation plan

---

## 1. Goal

ทำให้ "นัดชำระ" เป็น **first-class concept** ใน collections module — มี lifecycle ชัด, นับ kept/broken แม่นยำ, และเชื่อม MDM lock + escalation อัตโนมัติ ตามกติกาที่ owner ตัดสิน

ปัจจุบัน promise เก็บใน `CallLog` (result='PROMISED' + settlementDate/Amount) แต่:

1. ไม่มี state machine — kept ไม่มีเครื่องหมาย, broken มีแค่ `brokenAt` ผ่าน cron
2. แก้/เลื่อนนัดทำให้เกิด multiple active promise ต่อ contract (ไม่มี supersede logic)
3. Promise ไม่ลิงก์กับ Installment — ไม่รู้ว่าเงินที่นัดครอบงวดผ่อนไหน
4. MDM lock เป็น propose-then-approve ทั้งที่ owner ต้องการ auto-lock เมื่อโทรไม่ติด
5. ไม่รองรับ "1 รอบนัดมีหลายที่" (split mode มีแค่ 2 งวดสูงสุด)

---

## 2. Domain Concepts

### 2.1 "1 รอบนัด" (Promise Cycle)

```
งวด มี.ค. (ค้าง)              งวด เม.ย. (ครบกำหนด 28/เม.ย.)
   |                                          |
   ●─────────── 1 รอบนัด ────────────────────●
                                              ↑
                                         เพดาน (deadline ของรอบ)

ภายในรอบ ลูกค้านัดจ่ายได้หลาย "ที่":
   ●─── ที่ 1 ───● ที่ 2 ───● ที่ 3 ───●
   (5/เม.ย.)    (15/เม.ย.) (25/เม.ย.)
   1,000 ฿      1,500 ฿     1,500 ฿
```

- **รอบนัด** เริ่มต้นที่ **วันบันทึก promise ครั้งแรก** (CallLog แรกที่ result='PROMISED' หลังจาก contract overdue + ไม่มี active promise/รอบเดิม)
- **เพดาน (cycleDeadline)** = วันครบกำหนดงวดผ่อนถัดไปในอนาคต — **ตัวที่ใกล้สุด** ที่ `dueDate > now`. ถ้าทุกงวดผ่อนค้างหมด (ลูกค้าหยุดจ่ายมานาน) ใช้ `วันสุดท้ายของเดือนถัดไป (calendar) เป็น fallback`
- **"ที่" (attempt slot)** = sub-promise ภายในรอบ — ได้ไม่จำกัด ตราบใดที่ slot.settlementDate ≤ cycleDeadline
- **รอบจบเมื่อ**: (a) ลูกค้าจ่ายครบทุก "ที่" ในรอบ → KEPT ; (b) "ที่" ใดที่หนึ่งเลย grace ยังไม่ครบ → BROKEN ; (c) พนง./ผจก. cancel → CANCELED
- **รอบใหม่** สร้างได้เมื่อ active promise อันเดิมเข้าสู่ KEPT/BROKEN/CANCELED แล้ว (clean slate — `rescheduleCount = 0`)

### 2.2 Promise → Installment Mapping

ลูกค้าค้างหลายงวด — promise ต้องชี้ว่าเงินที่นัดจ่าย จะ allocate ไปงวดไหน

- **Default**: auto-FIFO (งวดเก่าสุดก่อน) — ลด friction พนง.
- **Override**: พนง.เลือกงวดเองได้ (popover checkbox) — ใช้เมื่อลูกค้าระบุชัด เช่น "ขอจ่ายงวด มี.ค. ก่อน"

### 2.3 State Machine

```
[NEW]
  └→ ACTIVE ─┬→ KEPT          (จ่ายครบทุก "ที่" ภายใน grace ของแต่ละที่)
             ├→ BROKEN        (ผิด "ที่" ใดที่หนึ่ง เลย grace)
             ├→ SUPERSEDED    (ทับด้วย promise ใหม่)
             └→ CANCELED      (พนง./ผจก. ยกเลิก, นับ broken)
```

States เป็น **derived** จาก fields บน CallLog — ไม่ต้องมี enum column

---

## 3. Decisions (Approved)

### 3.1 Kept Rule
- **เงื่อนไข kept**: จ่ายครบยอดของแต่ละ "ที่" ภายใน `settlementDate + 1 วัน` (grace 1 วัน)
- **ทำไม grace 1 วัน**: ครอบ bank settlement lag, weekend batch — กัน false-broken
- **ไม่ใช้ %**: ครบยอดเท่านั้น (กัน playbook ลูกค้าจ่ายขาด)

### 3.2 Active Promise Limit
- **1 active promise ต่อ contract** เท่านั้น
- บันทึกใหม่ขณะมี active เดิม → **confirm dialog** "มีนัดเก่า 5/พ.ค. ยอด 5,000 — ยกเลิกและสร้างใหม่?"
- ยืนยันแล้ว: นัดเก่า `supersededAt=now`, `supersededByCallLogId=newId`

### 3.3 Reschedule Penalty
| Scenario | นับ broken? |
|----------|-------------|
| เลื่อนก่อนวันนัดถึง — **ครั้งที่ 1** ของรอบ | ❌ ไม่นับ (good faith) |
| เลื่อนก่อนวันนัดถึง — **ครั้งที่ 2+** ของรอบ | ✅ นับ broken 1 ครั้ง |
| เลื่อนหลังวันนัดผ่านแล้ว (อยู่ใน grace) | ✅ นับ broken 1 ครั้ง |
| เลื่อนหลังเลย grace แล้ว | ✅ broken แล้วก่อนหน้านี้ — เลื่อนคือสร้าง promise ใหม่ |

Track ผ่าน `rescheduleCount` บน CallLog — inherit จาก promise ก่อน + 1 เมื่อ supersede

### 3.4 Promise Cycle (1 รอบนัด)
- **Q1: "ที่" สูงสุดต่อรอบ** = unlimited (ตราบใดที่ ≤ cycleDeadline)
- **Q2: ผิด "ที่" → ล็อค** = grace 1 วันก่อน (consistent กับ kept rule)
- **Q3: Unlock เมื่อไหร่** = ลูกค้าต้องจ่ายครบ **ทุก "ที่" ในรอบ** ถึงปลด (ไม่ใช่แค่ "ที่" ที่ผิด)
- **Q4: รอบเริ่ม** = วันบันทึก promise ครั้งแรก

### 3.5 No-Promise Auto-Lock
- **Trigger**: contract overdue ≥ 1 วัน + ไม่มี active promise + **CallLog 2 อันล่าสุด** ของ contract นั้น มี outcome ใน `[NO_ANSWER, UNREACHABLE]` ติดกัน (ไม่จำเป็นต้องวันเดียวกัน — ดูเรียงตาม createdAt desc, take 2)
- **Action**: MDM lock auto **ไม่ต้อง ผจก. approve**
- เปลี่ยน: `mdm-auto-propose.cron` (propose-then-approve) → เพิ่ม path `mdm-auto-lock` สำหรับเงื่อนไขนี้

### 3.6 Split Mode → Multi-Slot Mode
- เดิม: split 2 งวด ใน 1 CallLog (settlementDate + secondSettlementDate)
- ใหม่: **1 promise มี N "ที่"** — เก็บใน `PromiseSlot[]` table แยก (ดู schema)
- เก่ายังรันได้ (backward compat) — migration คือ 1 CallLog (split=true) → 2 PromiseSlot rows

---

## 4. Schema Changes

### 4.1 Modify `CallLog`

```prisma
model CallLog {
  // ... existing fields ...

  // Promise lifecycle (additions)
  supersededAt           DateTime? @map("superseded_at")
  supersededByCallLogId  String?   @map("superseded_by_call_log_id")
  rescheduleCount        Int       @default(0) @map("reschedule_count")
  keptAt                 DateTime? @map("kept_at")
  canceledAt             DateTime? @map("canceled_at")
  canceledReason         String?   @map("canceled_reason")

  // Promise cycle
  cycleStartedAt         DateTime? @map("cycle_started_at")     // วันบันทึก promise ครั้งแรกของรอบ
  cycleDeadline          DateTime? @map("cycle_deadline")       // = next installment dueDate

  // Installment mapping
  targetInstallmentIds   String[]  @map("target_installment_ids")  // UUID[] — งวดที่ promise นี้ครอบ

  // Self-relation: supersede chain
  supersededBy           CallLog?  @relation("PromiseSupersedeChain", fields: [supersededByCallLogId], references: [id])
  supersedes             CallLog[] @relation("PromiseSupersedeChain")

  // PromiseSlot relation (replaces secondSettlementDate/Amount)
  slots                  PromiseSlot[]

  // Indexes
  @@index([result, settlementDate, brokenAt, supersededAt, keptAt, canceledAt])  // active promise query
  @@index([cycleStartedAt, cycleDeadline])
}
```

**Deprecated (keep for backward compat, remove after data migration):**
- `secondSettlementDate`
- `secondSettlementAmount`

### 4.2 New `PromiseSlot`

```prisma
/// "ที่" ภายใน 1 รอบนัด — supports unlimited slots per promise
/// Replaces legacy secondSettlementDate/secondSettlementAmount on CallLog
model PromiseSlot {
  id                String    @id @default(uuid())
  callLogId         String    @map("call_log_id")
  callLog           CallLog   @relation(fields: [callLogId], references: [id], onDelete: Cascade)

  slotIndex         Int       @map("slot_index")          // 1, 2, 3, ...
  settlementDate    DateTime  @map("settlement_date")
  settlementAmount  Decimal   @map("settlement_amount") @db.Decimal(12, 2)

  paidAmount        Decimal   @default(0) @map("paid_amount") @db.Decimal(12, 2)
  keptAt            DateTime? @map("kept_at")
  brokenAt          DateTime? @map("broken_at")
  lockedAt          DateTime? @map("locked_at")           // ตอน MDM lock เพราะ slot นี้ผิด

  notes             String?

  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@unique([callLogId, slotIndex])
  @@index([callLogId, settlementDate])
  @@index([keptAt, brokenAt])
}
```

### 4.3 Modify `Contract`

```prisma
model Contract {
  // ... existing fields ...
  brokenPromiseCount  Int @default(0) @map("broken_promise_count")  // existing
  keptPromiseCount    Int @default(0) @map("kept_promise_count")    // new
}
```

---

## 5. Backend Logic

### 5.1 Active Promise Query (Canonical)
```ts
// บน CallLog
where: {
  result: 'PROMISED',
  brokenAt: null,
  supersededAt: null,
  keptAt: null,
  canceledAt: null,
}
```

### 5.2 Promise Resolution Cron (replaces broken-promise.cron)

ชื่อใหม่: `promise-resolution.cron.ts` — รายชั่วโมง

```
สำหรับแต่ละ active promise ที่มี slot ผ่าน settlementDate + 1 day grace แล้ว:
  สำหรับแต่ละ slot (เรียงตาม slotIndex):
    paidInWindow = sum(payments allocated to slot ภายใน [createdAt, settlementDate + 1 day])
    if paidInWindow >= settlementAmount:
      slot.keptAt = now
    else:
      slot.brokenAt = now
      promise.brokenAt = now  // ทั้ง promise พังเมื่อ slot ใดที่หนึ่งพัง
      contract.brokenPromiseCount++
      trigger MDM lock auto (slot.lockedAt = now)
      break  // ไม่ต้องประมวล slot ที่เหลือ

  ถ้าทุก slot kept:
    promise.keptAt = now
    contract.keptPromiseCount++
```

### 5.3 No-Promise Auto-Lock Cron

ชื่อใหม่: `no-promise-lock.cron.ts` — รายชั่วโมง

```
หา contract ที่:
  - overdue >= 1 วัน
  - ไม่มี active promise (query 5.1)
  - มี CallLog 2 อันล่าสุดของ contract นี้ result IN ['NO_ANSWER', 'UNREACHABLE'] ติดต่อกัน
  - ยังไม่ MDM lock

→ trigger MDM lock auto (audit log: 'NO_PROMISE_AUTO_LOCK')
→ Owner alert via LINE
```

### 5.4 Real-time Kept Detection

ในกรณีที่ลูกค้าจ่ายครบก่อน cron run — Payment service hook:

```ts
// after PaymentService.create()
async function checkPromiseKept(contractId, paymentId) {
  const activePromise = await findActivePromise(contractId);
  if (!activePromise) return;

  for (const slot of activePromise.slots.sortBy('slotIndex')) {
    if (slot.keptAt || slot.brokenAt) continue;

    const allocated = sumPaymentsAllocatedToSlot(slot, payments);
    if (allocated >= slot.settlementAmount) {
      slot.keptAt = now;
    }
  }

  if (allSlotsKept(activePromise)) {
    activePromise.keptAt = now;
    contract.keptPromiseCount++;
    if (contract.mdmLocked) await mdmUnlock(contract);  // Q3: ครบทุก "ที่" → ปลด
  }
}
```

### 5.5 Supersede (Reschedule) Logic

ใน `ContactLogService.create()`:

```ts
async function createPromise(input, user) {
  const oldPromise = await findActivePromise(input.contractId);

  if (oldPromise) {
    // confirm dialog ฝั่ง UI ผ่านมาแล้ว
    const newRescheduleCount = oldPromise.rescheduleCount + 1;

    // ตัดสินใจว่า oldPromise นับ broken หรือไม่
    const oldPastDue = oldPromise.slots.some(s => s.settlementDate < now);
    const shouldCountBroken = oldPastDue || newRescheduleCount >= 2;

    await prisma.callLog.update({
      where: { id: oldPromise.id },
      data: {
        supersededAt: now,
        supersededByCallLogId: 'PLACEHOLDER',
        ...(shouldCountBroken && { brokenAt: now }),
      },
    });
    if (shouldCountBroken) await incrementBrokenCount(input.contractId);

    // inherit cycle
    input.cycleStartedAt = oldPromise.cycleStartedAt;
    input.cycleDeadline = oldPromise.cycleDeadline;
    input.rescheduleCount = newRescheduleCount;
  } else {
    // first promise of cycle
    input.cycleStartedAt = now;
    input.cycleDeadline = nextInstallmentDueDate(input.contractId);
    input.rescheduleCount = 0;
  }

  // validate every slot.settlementDate <= cycleDeadline
  validateSlotsWithinDeadline(input.slots, input.cycleDeadline);

  const newPromise = await prisma.callLog.create({ ...input });
  if (oldPromise) {
    await prisma.callLog.update({
      where: { id: oldPromise.id },
      data: { supersededByCallLogId: newPromise.id },
    });
  }
  return newPromise;
}
```

### 5.6 MDM Auto-Lock Path

แทนที่ propose-then-approve ในเงื่อนไข:
1. Promise slot ผิด (5.2) → auto-lock ทันที
2. No-promise + 2 NO_ANSWER ติด (5.3) → auto-lock ทันที

`mdm-auto-propose.cron` ยังคงอยู่ สำหรับเคสอื่น (legacy escalation guardrail) — แต่เพิ่ม fast-path `mdm-auto-lock`

---

## 6. UI Changes

### 6.1 ContactLogDialog (apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx)

**เปลี่ยนหลัก:**
- Toggle "นัดแบ่งจ่าย 2 งวด" → "เพิ่ม 'ที่' ที่ N" (ปุ่มเพิ่ม slot ไม่จำกัด)
- ใต้แต่ละ slot: quick date pills + amount input + delete (ถ้า slot index > 1)
- แสดง **deadline banner** บนสุด: "เพดานรอบนัด: 28 เม.ย. (วันครบกำหนดงวด พ.ค.)"
- Validate ทุก slot.settlementDate ≤ cycleDeadline
- เมื่อมี active promise เดิม → confirm dialog popup ก่อนบันทึก

### 6.2 Installment Mapping Picker

ใต้ส่วน "ยอดที่ต้องนัด" — link "[ระบุงวดเอง]"
- กดเปิด popover: list งวดที่ค้าง + checkbox + แสดง "งวด — 4,000 ฿ ค้าง 25 วัน"
- เลือกงวด → auto-fill ยอดรวม → ใส่ field settlementAmount
- ไม่กด link → auto-FIFO (default)

### 6.3 PromiseTab — Cycle View

แสดง:
- รอบที่ active: cycleStartedAt → cycleDeadline (countdown)
- "ที่" ทุก slot ในรอบ (kept/broken/pending)
- KPI: kept rate ของ cycle ที่จบ, average broken count per cycle

### 6.4 Banner ใน Contract Detail
- เมื่อ supersede: "นัดเดิม 5 พ.ค. (5,000 ฿) ถูกแทนด้วย 10 พ.ค. โดย พนง.X"
- เมื่อ MDM lock: "ล็อคเครื่องอัตโนมัติ — เหตุ: ผิด 'ที่ 2' / โทรไม่ติด 2 ครั้งติด"

---

## 7. Migration Strategy

### Phase 1 — Schema (non-breaking)
1. Add nullable cols to `CallLog` (supersededAt, rescheduleCount, keptAt, canceledAt, cycleStartedAt, cycleDeadline, targetInstallmentIds)
2. Add `keptPromiseCount` to `Contract`
3. Create `PromiseSlot` table (empty)

### Phase 2 — Backfill
1. Existing `CallLog` rows with `result='PROMISED'`:
   - Create 1 PromiseSlot from `settlementDate/Amount`
   - If `secondSettlementDate` exists, create 2nd PromiseSlot
   - Set `cycleStartedAt = createdAt`, `cycleDeadline = nextInstallmentDueDate(contractId)`
   - `targetInstallmentIds = []` (legacy = FIFO fallback)
2. `keptAt` backfill: ถ้า `brokenAt IS NULL` AND `settlementDate < now` AND payment ครอบ → set `keptAt`
3. `Contract.keptPromiseCount` = count(CallLog WHERE keptAt IS NOT NULL)

### Phase 3 — Cutover
1. Enable `promise-resolution.cron` (disable old `broken-promise.cron`)
2. Enable `no-promise-lock.cron`
3. UI deploy: ContactLogDialog ใหม่ + Installment picker + PromiseTab cycle view
4. Hook `PaymentService` real-time kept detection

### Phase 4 — Cleanup (>=2 months later)
1. Remove deprecated `secondSettlementDate/Amount` from CallLog
2. Remove `mdm-auto-propose.cron` legacy paths ที่ replaced by auto-lock

---

## 8. Test Plan

### Unit
- Promise lifecycle state derivation (active/kept/broken/superseded/canceled)
- Reschedule penalty rules (5 cases ใน table 3.3)
- Slot resolution: kept all / broken at slot N / partial paid
- Cycle deadline validation (slot.settlementDate ≤ cycleDeadline)
- FIFO auto-allocate to installments
- Override allocate respect

### Integration
- Real-time kept detection on Payment.create()
- Supersede chain (3 promises ต่อกัน)
- No-promise auto-lock: 2 consecutive NO_ANSWER → MDM lock
- Promise unlock เมื่อจ่ายครบทั้งรอบ

### E2E
- Happy: นัด 3 ที่ → จ่ายครบทุกที่ → kept
- Sad: นัด 3 ที่ → ผิดที่ 2 → MDM lock auto
- Reschedule before due (ครั้งที่ 1) → ไม่ broken
- Reschedule before due (ครั้งที่ 2) → broken
- No-answer 2 ครั้ง → MDM lock auto

---

## 9. Out of Scope (Deferred)

- Owner override "ถือเป็น kept" สำหรับ partial payment (จ่ายขาดบาท) — ค่อยทำตอน Owner UI
- LINE template ใหม่สำหรับ multi-slot promise (ต้อง brainstorm copy แยก)
- Skip-tracing automation เมื่อ no-promise auto-lock fail (เครื่อง offline) — Phase 5
- Predictive: ML model ทำนาย kept-rate ก่อนบันทึก promise — Phase 5+
- LIFF customer-facing "นัดผ่าน LINE" — ต้องคุย flow แยก
- VAT-on-late-fee implication เมื่อ slot N ผิด — ต้องปรึกษานักบัญชี

---

## 10. Acceptance Criteria

- [ ] Schema migration applied + backfill verified (no data loss)
- [ ] Active promise query returns ≤ 1 row per contract
- [ ] `promise-resolution.cron` runs hourly + idempotent
- [ ] `no-promise-lock.cron` runs hourly + respects 2-consecutive-NO_ANSWER rule
- [ ] ContactLogDialog supports unlimited slots + cycle deadline validation
- [ ] Confirm dialog appears when active promise exists
- [ ] Reschedule rules match table 3.3 (verified by tests)
- [ ] Installment FIFO auto-allocate works + override path works
- [ ] MDM auto-lock fires on slot.brokenAt + on 2-NO_ANSWER
- [ ] MDM auto-unlock fires when entire cycle kept
- [ ] PromiseTab shows cycle view with countdown
- [ ] Audit log records every supersede / lock / unlock event
