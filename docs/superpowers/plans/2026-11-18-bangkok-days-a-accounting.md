# แผน ก — รายงานบัญชีและการเงิน: นับวันเต็มวันตามเวลาไทย · แผนลงมือ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แก้ทุกจุดในโมดูลบัญชี/การเงิน (accounting · journal · inter-company · interco-settlement · asset · finance-receivable · tax · peak · other-income) ที่แปลงวันที่ `YYYY-MM-DD` เป็นขอบช่วงเวลาผิด (เดิม = 07:00 น. ไทย) ให้เป็นวันเต็มตามปฏิทินไทย — รวมสแนปช็อตปิดงวด, ภ.ง.ด.1ก รายปี, ด่านวันที่จำหน่ายสินทรัพย์ และการส่งออก PEAK

**Architecture:** ใช้ตัวช่วยที่มีอยู่แล้วใน `utils/date.util.ts` (`reportDayStart` / `reportDayEnd` / `reportAsOf` / `bangkokMidnight` / `isFutureBkkDay`) แทนที่ `new Date(value)` / `setHours(23,59,59,999)` / `Date.UTC(...)` ณ จุดที่อ่านสตริงวันที่ — controller แปลงเองเมื่อ controller เป็นผู้อ่านสตริง, service แปลงเองเมื่อ service เป็นผู้อ่านสตริง · ไม่เพิ่ม route/decorator · แต่ละ task = หนึ่งโมดูล หนึ่งวงจรเทสต์ หนึ่ง commit · **Task 4 (สแนปช็อตปิดงวด) แยกเดี่ยว** เพราะแตะตัวเลขที่เก็บถาวรตอนปิดงวด

**Tech Stack:** NestJS + Prisma (`apps/api`, Jest)

## Global Constraints

- วันที่แบบ `YYYY-MM-DD` = วันตามปฏิทินไทย: เริ่ม 00:00:00.000 น. · สิ้นสุด 23:59:59.999 น. (เวลาไทย) ไม่ขึ้นกับ TZ ของโปรเซส · ใช้ตัวช่วยใน `apps/api/src/utils/date.util.ts` เท่านั้น ห้ามเขียนสูตรแปลงวันชุดใหม่
- ค่าที่ไม่ใช่รูป `YYYY-MM-DD` ต้องได้พฤติกรรมเดิม (ยกเว้นจุดที่แผนระบุว่าเปลี่ยนเป็น 400)
- ไม่เพิ่ม/เปลี่ยน route หรือ decorator (`@Get` / `@Post` / `@Roles` / `@UseGuards`) — `apps/api/src/modules/employee-access/access-policy.manifest.json` ต้องไม่ถูกแก้
- ไม่เปลี่ยนตรรกะอื่นของรายงาน/รายการ (ตัวกรองอื่น · การเรียงลำดับ · การแบ่งหน้า · รูปคำตอบ)
- เงินใช้ `Prisma.Decimal` เท่านั้น
- ช่อง `@db.Date` (เก็บแค่วันที่) ไม่อยู่ในขอบเขต — ห้ามเปลี่ยนขอบของช่องแบบนี้
- ข้อมูลเดิมในฐานข้อมูลไม่ถูกแก้ (forward-only) — แก้เฉพาะการอ่าน/การกรอง
- สภาพแวดล้อมเครื่องนี้: jest/tsc ของ `apps/api` ต้องรันด้วย `NODE_OPTIONS=--max-old-space-size=8192` · `node tools/check-access-coverage.mjs` ล้มบน Windows checkout อยู่ก่อนแล้ว (CI เป็นตัวตัดสิน)
- ทำบน branch `fix/bangkok-day-bounds` (ต่อจาก `feat/finance-trial-balance` / PR #1789)
- commit ลงท้ายด้วย `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`

**ข้อกำหนดเฉพาะแผน ก:**

- `YYYY-MM-DD` ที่ไม่มีจริงในปฏิทิน = 400 `วันที่ไม่ถูกต้อง` ตามพฤติกรรมของตัวช่วย — แก้ข้อความเดิมที่เขียนว่าเดิมเป็น `Invalid Date` → 500 ทุกกรณี: ที่จริง **วันล้นเดือน เช่น `2026-02-31` เดิมไหลเงียบ ๆ ไปเดือนถัดไป** (`new Date` ได้ 3 มี.ค.) ส่วน `Invalid Date` เกิดเฉพาะเดือน > 12 / วัน > 31 · ตอนนี้ทั้งสองแบบเป็น 400 `วันที่ไม่ถูกต้อง` — ถือเป็นการเปลี่ยนที่ตั้งใจ
- ข้อยกเว้นข้อ "ค่าที่ไม่ใช่ `YYYY-MM-DD` ต้องได้พฤติกรรมเดิม" ที่แผนนี้เปลี่ยนเป็น 400 มีเฉพาะ: `start` / `end` ที่ **ไม่ส่งหรือว่าง** ของ `ledger/bad-debt` · `ledger/general-journal` · `accounting/consolidated/profit-loss` (Task 1, 2) — ข้อความ `กรุณาระบุวันเริ่มต้น (start) และวันสิ้นสุด (end)`
- **เลือกตัวช่วยของขอบสิ้นสุดตามโค้ดเดิม:** ที่เดิมเรียก `setHours(23,59,59,999)` กับขอบสิ้นสุดอยู่แล้ว (Task 3 · 7 · 9) ใช้ `reportDayEnd` · ที่เดิมเป็น `new Date(end)` เปล่า ไม่ขยายเป็นสิ้นวัน (Task 1 · 2 · 5 · 6 · 12) ใช้ `reportAsOf` — `'YYYY-MM-DD'` = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมาทุกประการ ⇒ ไม่มีข้อยกเว้นของกติกา "ค่าที่ไม่ใช่ `YYYY-MM-DD` ต้องได้พฤติกรรมเดิม" ในจุดเหล่านี้ · ทุกจุดที่ใช้ `reportAsOf` ใส่คอมเมนต์ `// reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)`
- ลำดับ task: **Task 3 ต้องมาก่อน Task 4** (Task 4 ต่อสายจริงผ่าน `TransactionalReportService`) · task อื่นไม่ขึ้นต่อกัน
- ฝั่งเว็บแก้เฉพาะ `AssetAuditPage` (Task 14 — เทสต์ Vitest · ใช้ `toBangkokDateString` จาก `apps/web/src/lib/date.ts` · เวอร์ชันเว็บ `26.11.11` → `26.11.12`) · `ProfitLossPage` ไม่แก้ · **เมื่อ merge แผนนี้ร่วมกับ PR อื่นที่แตะ `apps/web/package.json` ให้ใช้เลข patch ถัดจากค่าปัจจุบัน ณ ตอนนั้น**
- เทสต์ที่ต้องเขียนใหม่ใช้ hand-built mock ตามแบบ spec เดิมของโมดูลนั้น (ชื่อไฟล์ที่ใช้เป็นแบบอยู่ในแต่ละ task) · **ทุกเทสต์ในแผนนี้ถูกรันแล้วในสภาพก่อนแก้โค้ด และล้มด้วยเหตุผลที่ถูกต้อง** (ขอบเขตวันผิด / ไม่ throw) — ไม่ใช่ล้มเพราะ mock ผิด

## File Structure

| ไฟล์ (ใต้ `apps/api/src/` เว้นแต่ขึ้นต้นด้วย `apps/web/`) | หน้าที่ |
|---|---|
| `modules/accounting/accounting.controller.ts` | `getBadDebtReport` · `getGeneralJournal` · `getInterCoReport` ใช้ `reportDayStart/End` + 400 เมื่อไม่ส่งวันที่ (Task 1) |
| `modules/accounting/accounting.controller.range-dates.spec.ts` (ใหม่) | ปักขอบวันของสามเมธอดข้างบน |
| `modules/accounting/consolidated.controller.ts` | `trialBalance` · `profitLoss` · `dashboard` (Task 2) |
| `modules/accounting/consolidated.controller.report-dates.spec.ts` (ใหม่) | ปักขอบวันของงบรวม |
| `modules/accounting/transactional-report.service.ts` | `getProfitLossReport` · `getCashFlowStatement` (Task 3) |
| `modules/accounting/transactional-report.service.report-dates.spec.ts` (ใหม่) | ปักขอบวันของ P&L และกระแสเงินสด |
| `modules/accounting/monthly-close.service.ts` | `generateReportSnapshots` — งบทดลองตัดที่สิ้นเดือนไทย (Task 4) |
| `modules/accounting/monthly-close.service.snapshot-dates.spec.ts` (ใหม่) | ปักขอบวันของสแนปช็อตงบทดลอง + P&L |
| `modules/journal/journal.service.ts` | `findAll` (Task 5) |
| `modules/journal/journal.service.find-all-dates.spec.ts` (ใหม่) | ปักขอบ `entryDate` |
| `modules/inter-company/inter-company.service.ts` | `findAll` · `getProfitSummary` (Task 6) |
| `modules/inter-company/inter-company.service.report-dates.spec.ts` (ใหม่) | ปักขอบ `createdAt` |
| `modules/asset/services/asset-query.service.ts` | `listGlobalAudit` (Task 7) |
| `modules/asset/asset-journal.service.ts` | `list` (Task 7) |
| `modules/asset/__tests__/asset-report-dates.spec.ts` (ใหม่) | ปักขอบวันของ audit/journal ของสินทรัพย์ |
| `modules/asset/services/asset-lifecycle.service.ts` | `dispose` ด่านวันที่ในอนาคต (Task 8) |
| `modules/asset/__tests__/asset-lifecycle.dispose-date.spec.ts` (ใหม่) | ปักด่านวันที่จำหน่าย |
| `modules/finance-receivable/finance-receivable.service.ts` | `findAll` (Task 9) |
| `modules/finance-receivable/finance-receivable.service.spec.ts` | แก้เทสต์ `expands endDate…` (บรรทัด 91-103) ให้ปักขอบไทย |
| `modules/tax/services/tax-preview.service.ts` | `previewPnd1Annual` ขอบปี (Task 10) |
| `modules/tax/services/tax-preview.pnd1-annual-dates.spec.ts` (ใหม่) | ปักขอบปีไทย |
| `modules/interco-settlement/interco-settlement.controller.ts` | `aging` ใช้ `reportAsOf` (Task 11) |
| `modules/interco-settlement/interco-settlement.controller.spec.ts` | แก้เทสต์ `parses asOf…` + เพิ่มเคสขอบ |
| `modules/peak/peak.controller.ts` | `exportEntries` (Task 12) |
| `modules/peak/peak.controller.spec.ts` (ใหม่) | ปักขอบวันของการส่งออก PEAK |
| `modules/other-income/services/validation.service.ts` | `checkLateFeeCollision` ขอบเดือน (Task 13) |
| `modules/other-income/__tests__/validation.late-fee-month.spec.ts` (ใหม่) | ปักขอบเดือนไทยของ C14 |
| `apps/web/src/pages/assets/utils/auditDateFilter.ts` (ใหม่) | ตัวกรองวันที่ของประวัติสินทรัพย์รายตัว เทียบวันไทย (Task 14) |
| `apps/web/src/pages/assets/AssetAuditPage.tsx` | ใช้ตัวกรองข้างบนแทน `new Date(fromDate)` (Task 14) |
| `apps/web/src/pages/assets/__tests__/auditDateFilter.test.ts` (ใหม่) | เทสต์ Vitest ของตัวกรอง |
| `apps/web/package.json` | เวอร์ชัน `26.11.11` → `26.11.12` |

---

### Task 1: รายงานหนี้สูญ · สมุดรายวันทั่วไป · เจ้าหนี้ระหว่างกิจการ (AccountingController)

**Files:**
- Modify: `apps/api/src/modules/accounting/accounting.controller.ts` (เมธอด `getBadDebtReport` `:139` · `getGeneralJournal` `:242` · `getInterCoReport` `:379`)
- Create/Test: `apps/api/src/modules/accounting/accounting.controller.range-dates.spec.ts` (แบบจาก `accounting.controller.report-dates.spec.ts`)

**Interfaces:**
- Consumes (นำเข้าอยู่แล้วที่บรรทัด 22 ของ controller): `reportDayStart(value: string): Date` (ขอบเริ่ม) · `reportAsOf(value: string): Date` (ขอบสิ้นสุด — เดิมเป็น `new Date(end)` เปล่า) · `BadRequestException`
- Produces: ไม่มี

**ที่มาของข้อบกพร่อง (เปิดโค้ดแล้ว):** service ของทั้งสามรายงานกรอง `postedAt` / `entryDate` ด้วย `gte` + `lte` (`receivables-report.service.ts:getBadDebtReport` · `general-ledger-report.service.ts:getGeneralJournal` · `intercompany-report.service.ts:getReport` — ยอดยกมาใช้ `lt periodStart`) · controller ส่ง `new Date('YYYY-MM-DD')` = 07:00 น. ไทย ⇒ รายการตั้งลูกหนี้งวดที่ลง 00:00 น. ของวันครบกำหนด และรายการ 00:00–06:59 น. ของวันเริ่มหายไป + ทุกรายการหลัง 07:00 น. ของวันสิ้นสุดหาย (วันสิ้นสุด = วันนี้ ⇒ รายงานไม่เห็นรายการของวันนี้) · ที่ inter-co ยอดยกมาใช้ `lt periodStart` ⇒ รายการ 00:00–06:59 น. ของวันเริ่มถูกนับเป็น "ยอดยกมา" แทนที่จะเป็น "ระหว่างงวด" ยอดคงเหลือปลายงวดจึงผิดด้วย · `getBadDebtReport` และ `getGeneralJournal` ยังส่ง `new Date(undefined)` (Invalid Date) เข้า Prisma เมื่อไม่ส่ง `start`/`end` — เฉพาะ `inter-co/report` ที่ตรวจอยู่แล้ว

**`:127 getAgingReport` — แก้ในรอบตรวจทั้งแผน (final review)**: ตอนเขียนแผนตรวจแล้วเห็นว่าผลเท่ากันสำหรับ due date ที่ระบบเขียน จึงไม่แก้ (แถว A1) แต่ guard ของแผน ค ไม่ให้มีข้อยกเว้น จึงเปลี่ยนเป็น `asOf ? reportAsOf(asOf) : new Date()` พร้อมเทสใน `accounting.controller.range-dates.spec.ts`

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/accounting/accounting.controller.range-dates.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { AccountingController } from './accounting.controller';

/**
 * ช่วงวันที่ของ ledger/bad-debt · ledger/general-journal · inter-co/report (2026-11-18)
 * วันเริ่ม 2026-11-01 = 2026-10-31T17:00:00.000Z · วันสิ้นสุด 2026-11-17 = 2026-11-17T16:59:59.999Z
 *
 * เดิมใช้ new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ ตัดรายการ 00:00–06:59 น. ของวันเริ่ม (รายการตั้งลูกหนี้งวด
 * ลงเที่ยงคืนไทยของวันครบกำหนด) และตัดทุกรายการหลัง 07:00 น. ของวันสิ้นสุด
 */
describe('AccountingController — ช่วงวันที่ bad-debt / general-journal / inter-co', () => {
  const START = '2026-10-31T17:00:00.000Z';
  const END = '2026-11-17T16:59:59.999Z';
  const service = { getBadDebtReport: jest.fn(), getGeneralJournal: jest.fn() };
  const intercoReportService = { getReport: jest.fn() };
  const controller = new AccountingController(
    service as never,
    {} as never,
    {} as never,
    intercoReportService as never,
  );
  const iso = (d: Date) => d.toISOString();

  beforeEach(() => jest.clearAllMocks());

  const endpoints = [
    ['bad-debt', () => controller.getBadDebtReport('2026-11-01', '2026-11-17'), service.getBadDebtReport],
    ['general-journal', () => controller.getGeneralJournal('2026-11-01', '2026-11-17'), service.getGeneralJournal],
    ['inter-co/report', () => controller.getInterCoReport('2026-11-01', '2026-11-17'), intercoReportService.getReport],
  ] as const;

  it.each(endpoints)('%s: ช่วง = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', (_name, call, mock) => {
    call();
    const [from, to] = (mock as jest.Mock).mock.calls[0];
    expect(iso(from)).toBe(START);
    expect(iso(to)).toBe(END);
  });

  it.each(endpoints)(
    '%s: รายการเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง',
    (_name, call, mock) => {
      call();
      const [from, to] = (mock as jest.Mock).mock.calls[0];
      const accrualOnStartDay = new Date('2026-11-01T00:00:00+07:00');
      const afternoonOnEndDay = new Date('2026-11-17T14:00:00+07:00');
      const accrualOnNextDay = new Date('2026-11-18T00:00:00+07:00');
      expect(accrualOnStartDay >= from && accrualOnStartDay <= to).toBe(true);
      expect(afternoonOnEndDay <= to).toBe(true);
      expect(accrualOnNextDay <= to).toBe(false);
    },
  );

  it.each(endpoints)('%s: ค่าที่ไม่ใช่ YYYY-MM-DD (ISO เต็ม) ผ่านไปตามที่ส่งมา ไม่ขยายเป็นสิ้นวัน', (name, _call, mock) => {
    const run = {
      'bad-debt': () => controller.getBadDebtReport('2026-11-01T03:00:00.000Z', '2026-11-17T03:04:05.000Z'),
      'general-journal': () => controller.getGeneralJournal('2026-11-01T03:00:00.000Z', '2026-11-17T03:04:05.000Z'),
      'inter-co/report': () => controller.getInterCoReport('2026-11-01T03:00:00.000Z', '2026-11-17T03:04:05.000Z'),
    }[name];
    run();
    const [from, to] = (mock as jest.Mock).mock.calls[0];
    expect(iso(from)).toBe('2026-11-01T03:00:00.000Z');
    expect(iso(to)).toBe('2026-11-17T03:04:05.000Z');
  });

  it('bad-debt: ส่ง companyId ต่อให้ service', () => {
    controller.getBadDebtReport('2026-11-01', '2026-11-17', 'co-1');
    expect(service.getBadDebtReport.mock.calls[0][2]).toBe('co-1');
  });

  it('general-journal: หน้า/จำนวนต่อหน้า/บริษัทส่งต่อเหมือนเดิม', () => {
    controller.getGeneralJournal('2026-11-01', '2026-11-17', '2', '25', 'co-1');
    expect(service.getGeneralJournal.mock.calls[0][2]).toEqual({ page: 2, limit: 25, companyId: 'co-1' });
  });

  it('bad-debt: ไม่ส่ง start หรือ end = 400 ภาษาไทย (เดิมส่ง Invalid Date เข้า Prisma)', () => {
    expect(() => controller.getBadDebtReport(undefined as never, '2026-11-17')).toThrow(BadRequestException);
    expect(() => controller.getBadDebtReport('2026-11-01', '')).toThrow(/กรุณาระบุ/);
    expect(service.getBadDebtReport).not.toHaveBeenCalled();
  });

  it('general-journal: ไม่ส่ง start หรือ end = 400 ภาษาไทย (เดิมส่ง Invalid Date เข้า Prisma)', () => {
    expect(() => controller.getGeneralJournal('2026-11-01', undefined as never)).toThrow(BadRequestException);
    expect(() => controller.getGeneralJournal('', '2026-11-17')).toThrow(/กรุณาระบุ/);
    expect(service.getGeneralJournal).not.toHaveBeenCalled();
  });

  it('inter-co/report: ไม่ส่ง start หรือ end = 400 เหมือนเดิม', () => {
    expect(() => controller.getInterCoReport('2026-11-01', undefined as never)).toThrow(BadRequestException);
    expect(intercoReportService.getReport).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/accounting/accounting.controller.range-dates.spec.ts
```

Expected: FAIL 8 เคส — ช่วง/ขอบของทั้งสามรายงานได้ `2026-11-01T00:00:00.000Z` (07:00 น. ไทย) แทน `2026-10-31T17:00:00.000Z` · bad-debt และ general-journal `Received function did not throw` เมื่อไม่ส่งวันที่ · เคส `companyId` / หน้า-จำนวนต่อหน้า / inter-co ไม่ส่งวันที่ ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/accounting/accounting.controller.ts`

`getBadDebtReport`:

```ts
// ก่อน
  ) {
    return this.service.getBadDebtReport(new Date(start), new Date(end), companyId);
  }

// หลัง
  ) {
    if (!start || !end) {
      throw new BadRequestException('กรุณาระบุวันเริ่มต้น (start) และวันสิ้นสุด (end)');
    }
    // reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)
    return this.service.getBadDebtReport(reportDayStart(start), reportAsOf(end), companyId);
  }
```

`getGeneralJournal`:

```ts
// ก่อน
  ) {
    return this.service.getGeneralJournal(new Date(start), new Date(end), {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      companyId,
    });
  }

// หลัง
  ) {
    if (!start || !end) {
      throw new BadRequestException('กรุณาระบุวันเริ่มต้น (start) และวันสิ้นสุด (end)');
    }
    // reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)
    return this.service.getGeneralJournal(reportDayStart(start), reportAsOf(end), {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      companyId,
    });
  }
```

`getInterCoReport` (ข้อความ 400 เดิมคงไว้ทุกตัวอักษร):

```ts
// ก่อน
    return this.intercoReportService.getReport(new Date(start), new Date(end));

// หลัง
    // reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)
    return this.intercoReportService.getReport(reportDayStart(start), reportAsOf(end));
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/accounting/accounting.controller src/modules/accounting/accounting.service.spec.ts src/modules/accounting/intercompany-report.service.spec.ts
```

Expected: PASS ทั้งหมด (spec ระดับ service ส่ง `Date` สำเร็จรูปอยู่แล้ว ไม่กระทบ; `accounting.controller.report-dates.spec.ts` และ `accounting.controller.export-peak.spec.ts` ต้องไม่แดง)

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/accounting/accounting.controller.ts apps/api/src/modules/accounting/accounting.controller.range-dates.spec.ts
git commit -m "รายงานหนี้สูญ/สมุดรายวันทั่วไป/เจ้าหนี้ระหว่างกิจการ: นับวันเต็มวันตามเวลาไทย + ไม่ส่งวันที่ = 400

เดิมใช้ new Date('YYYY-MM-DD') = 07:00 น. ไทย ตัดรายการตั้งลูกหนี้งวด (เที่ยงคืนไทย) ของวันเริ่ม
และทุกรายการหลัง 07:00 น. ของวันสิ้นสุด · รายงานเจ้าหนี้ระหว่างกิจการนับรายการเที่ยงคืนของวันเริ่มเป็นยอดยกมา
ไม่ส่ง start/end ของหนี้สูญและสมุดรายวันทั่วไปเดิมส่ง Invalid Date เข้า Prisma

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 2: งบรวม SHOP+FINANCE (ConsolidatedController)

**Files:**
- Modify: `apps/api/src/modules/accounting/consolidated.controller.ts` (เมธอด `trialBalance` `:23` · `profitLoss` `:32` · `dashboard` `:41` + import)
- Create/Test: `apps/api/src/modules/accounting/consolidated.controller.report-dates.spec.ts` (แบบจาก `accounting.controller.report-dates.spec.ts`)

**Interfaces:**
- Consumes จาก `../../utils/date.util`: `reportAsOf(value: string): Date` (ตัดยอด ณ วันที่ และขอบสิ้นสุดของกำไรขาดทุน) · `reportDayStart(value: string): Date`
- Produces: ไม่มี

**ที่มาของข้อบกพร่อง:** `getConsolidatedTrialBalance` ส่ง `asOfDate` ไปเป็นขอบ `entryDate lte` โดยไม่ `setHours` ⇒ ตัดรายการหลัง 07:00 น. ของวันที่เลือก · `getConsolidatedProfitLoss` ใช้ `entryDate gte/lte` ของสมุดรายวัน และ `InterCompanyTransaction.createdAt gte/lte` ของรายการตัดกลบ · `getConsolidatedDashboard` ใช้ `asOf` เป็นขอบบนของทั้งสองอย่าง · ยังไม่มีหน้าเว็บเรียกกลุ่มนี้ (latent) แต่แก้ตามกติกา · `dashboard` ใช้ `now.getFullYear()/getMonth()` หาต้นเดือนซึ่งคงเดิมได้ เพราะสิ้นวันไทยยังอยู่ในเดือนเดียวกัน (ไม่แก้ — ดู "ตรวจแล้วไม่ต้องแก้")

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/accounting/consolidated.controller.report-dates.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { ConsolidatedController } from './consolidated.controller';

/**
 * รายงานงบรวม SHOP+FINANCE รับวันที่ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิม new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ งบทดลอง/แดชบอร์ด ณ วันที่ ไม่นับรายการหลัง 07:00 น. ของวันนั้น
 * และกำไรขาดทุนตัดรายการ 00:00–06:59 น. ของวันเริ่ม
 */
describe('ConsolidatedController — วันที่ของรายงาน', () => {
  const START = '2026-10-31T17:00:00.000Z';
  const END = '2026-11-17T16:59:59.999Z';
  const svc = {
    getConsolidatedTrialBalance: jest.fn(),
    getConsolidatedProfitLoss: jest.fn(),
    getConsolidatedDashboard: jest.fn(),
  };
  const controller = new ConsolidatedController(svc as never);
  const iso = (d: Date) => d.toISOString();

  beforeEach(() => jest.clearAllMocks());

  it('trial-balance: ตัดยอดสิ้นวันไทยของ asOf', () => {
    controller.trialBalance('2026-11-17');
    expect(iso(svc.getConsolidatedTrialBalance.mock.calls[0][0])).toBe(END);
  });

  it('dashboard: ตัดยอดสิ้นวันไทยของ asOf', () => {
    controller.dashboard('2026-11-17');
    expect(iso(svc.getConsolidatedDashboard.mock.calls[0][0])).toBe(END);
  });

  it('trial-balance / dashboard: ไม่ส่ง asOf = undefined ตามเดิม (service ใช้ตอนนี้)', () => {
    controller.trialBalance();
    controller.dashboard();
    expect(svc.getConsolidatedTrialBalance.mock.calls[0][0]).toBeUndefined();
    expect(svc.getConsolidatedDashboard.mock.calls[0][0]).toBeUndefined();
  });

  it('profit-loss: ช่วง = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', () => {
    controller.profitLoss('2026-11-01', '2026-11-17');
    const [from, to] = svc.getConsolidatedProfitLoss.mock.calls[0];
    expect(iso(from)).toBe(START);
    expect(iso(to)).toBe(END);
  });

  it('profit-loss: รายการเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', () => {
    controller.profitLoss('2026-11-01', '2026-11-17');
    const [from, to] = svc.getConsolidatedProfitLoss.mock.calls[0];
    const onStartDay = new Date('2026-11-01T00:00:00+07:00');
    const onNextDay = new Date('2026-11-18T00:00:00+07:00');
    expect(onStartDay >= from && onStartDay <= to).toBe(true);
    expect(onNextDay <= to).toBe(false);
  });

  it('profit-loss: ค่าที่ไม่ใช่ YYYY-MM-DD (ISO เต็ม) ผ่านไปตามที่ส่งมา ไม่ขยายเป็นสิ้นวัน', () => {
    controller.profitLoss('2026-11-01T03:00:00.000Z', '2026-11-17T03:04:05.000Z');
    const [from, to] = svc.getConsolidatedProfitLoss.mock.calls[0];
    expect(iso(from)).toBe('2026-11-01T03:00:00.000Z');
    expect(iso(to)).toBe('2026-11-17T03:04:05.000Z');
  });

  it('profit-loss: ไม่ส่ง start หรือ end = 400 ภาษาไทย (เดิมส่ง Invalid Date)', () => {
    expect(() => controller.profitLoss(undefined as never, '2026-11-17')).toThrow(BadRequestException);
    expect(() => controller.profitLoss('2026-11-01', '')).toThrow(/กรุณาระบุ/);
    expect(svc.getConsolidatedProfitLoss).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/accounting/consolidated.controller.report-dates.spec.ts
```

Expected: FAIL 5 เคส — `trial-balance` / `dashboard` ได้ `2026-11-17T00:00:00.000Z` แทน `2026-11-17T16:59:59.999Z` · `profit-loss` ได้ `2026-11-01T00:00:00.000Z` แทน `2026-10-31T17:00:00.000Z` และไม่ throw เมื่อไม่ส่งวันที่ · เคส "ไม่ส่ง asOf = undefined" ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/accounting/consolidated.controller.ts`

```ts
// ก่อน (บรรทัด 1)
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
// หลัง
import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
```

เพิ่มต่อจากบรรทัด `import { ConsolidatedService } from './consolidated.service';`:

```ts
import { reportAsOf, reportDayStart } from '../../utils/date.util';
```

```ts
// ก่อน
  trialBalance(@Query('asOf') asOf?: string) {
    return this.svc.getConsolidatedTrialBalance(asOf ? new Date(asOf) : undefined);
  }
// หลัง
  trialBalance(@Query('asOf') asOf?: string) {
    return this.svc.getConsolidatedTrialBalance(asOf ? reportAsOf(asOf) : undefined);
  }
```

```ts
// ก่อน
  profitLoss(@Query('start') start: string, @Query('end') end: string) {
    return this.svc.getConsolidatedProfitLoss(new Date(start), new Date(end));
  }
// หลัง
  profitLoss(@Query('start') start: string, @Query('end') end: string) {
    if (!start || !end) {
      throw new BadRequestException('กรุณาระบุวันเริ่มต้น (start) และวันสิ้นสุด (end)');
    }
    // reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)
    return this.svc.getConsolidatedProfitLoss(reportDayStart(start), reportAsOf(end));
  }
```

```ts
// ก่อน
  dashboard(@Query('asOf') asOf?: string) {
    return this.svc.getConsolidatedDashboard(asOf ? new Date(asOf) : undefined);
  }
// หลัง
  dashboard(@Query('asOf') asOf?: string) {
    return this.svc.getConsolidatedDashboard(asOf ? reportAsOf(asOf) : undefined);
  }
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/accounting/consolidated
```

Expected: PASS ทั้ง `consolidated.controller.report-dates.spec.ts` และ `consolidated.service.spec.ts` (service ไม่ถูกแตะ)

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/accounting/consolidated.controller.ts apps/api/src/modules/accounting/consolidated.controller.report-dates.spec.ts
git commit -m "งบรวม SHOP+FINANCE: งบทดลอง/แดชบอร์ดตัดยอดสิ้นวันไทย · กำไรขาดทุนนับวันเต็มวัน

เดิม new Date('YYYY-MM-DD') = 07:00 น. ไทย ไม่นับรายการหลัง 07:00 น. ของวันที่เลือก
ไม่ส่ง start/end ของกำไรขาดทุนรวมเดิมส่ง Invalid Date — เปลี่ยนเป็น 400

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 3: งบกำไรขาดทุน (จากยอดขาย) และกระแสเงินสด (TransactionalReportService)

**Files:**
- Modify: `apps/api/src/modules/accounting/transactional-report.service.ts` (เมธอด `getProfitLossReport` `:132-134` · `getCashFlowStatement` `:792-794` + import)
- Create/Test: `apps/api/src/modules/accounting/transactional-report.service.report-dates.spec.ts` (แบบจาก `accounting.pl-expense.spec.ts` — `makeFullService`)

**Interfaces:**
- Consumes: `reportDayStart(value: string): Date` · `reportDayEnd(value: string): Date`
- Produces: `getProfitLossReport(startDate, endDate, …)` และ `getCashFlowStatement(startDate, endDate, …)` ตีความ `'YYYY-MM-DD'` เป็นวันไทยแล้ว — Task 4 ต่อสายจริงเข้าเมธอดนี้

**ผู้เรียกที่ได้ผลจากการแก้จุดเดียวนี้** (ตรวจแล้วว่าทุกทางส่งสตริงวันที่แบบ `YYYY-MM-DD`): `GET /reports/profit-loss` · `GET /reports/comparative-pl` (`getComparativePL` สร้าง `YYYY-MM-01` ถึงวันสุดท้ายของเดือน สามช่วง) · `GET /reports/quarterly` · สแนปช็อต P&L ตอนปิดงวด (Task 4) · `GET /reports/cash-flow`

**ที่มาของข้อบกพร่อง:** `start = new Date(startDate)` = 07:00 น. ไทยของวันแรก ⇒ `Sale.createdAt` / `Payment.paidDate` / `FinanceReceivable.receivedDate` / `JournalEntry.entryDate` (51-54 ผ่าน `aggregateFinanceExpenses`) ของ 00:00–06:59 น. วันแรกหาย · ฝั่ง `end` ใช้ `setHours(23,59,59,999)` ซึ่งถูกเฉพาะเมื่อโปรเซสรัน `TZ=Asia/Bangkok` — เปลี่ยนเป็นตัวช่วยที่ไม่ขึ้นกับ TZ ด้วย · `period` ที่ echo กลับยังเป็นสตริงเดิม

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/accounting/transactional-report.service.report-dates.spec.ts`:

```ts
import { TransactionalReportService } from './transactional-report.service';

/**
 * /reports/profit-loss · /reports/comparative-pl · /reports/quarterly · สแนปช็อตปิดงวด (getProfitLossReport)
 * และ /reports/cash-flow (getCashFlowStatement) รับวันที่ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * วันเริ่ม 2026-11-01 = 2026-10-31T17:00:00.000Z · วันสิ้นสุด 2026-11-17 = 2026-11-17T16:59:59.999Z
 *
 * เดิม start = new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ ใบขาย/การรับชำระ 00:00–06:59 น. ของวันแรกหายจากรายงาน
 * และ end ถูกต้องเพราะ setHours(23,59,59,999) ตาม TZ ของโปรเซสเท่านั้น
 */
describe('TransactionalReportService — วันที่ของ P&L และกระแสเงินสด', () => {
  const START = new Date('2026-10-31T17:00:00.000Z');
  const END = new Date('2026-11-17T16:59:59.999Z');

  function build() {
    const prisma = {
      sale: {
        aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
      },
      financeReceivable: { aggregate: jest.fn().mockResolvedValue({ _sum: {} }) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      purchaseOrder: { aggregate: jest.fn().mockResolvedValue({ _sum: {} }) },
      journalLine: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    const companyResolver = { getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-1') };
    const service = new TransactionalReportService(prisma as never, companyResolver as never);
    return { service, prisma };
  }

  describe('getProfitLossReport', () => {
    it('ทุก query ใช้ช่วง 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
      const { service, prisma } = build();
      await service.getProfitLossReport('2026-11-01', '2026-11-17', undefined, undefined, true);

      for (const call of prisma.sale.aggregate.mock.calls) {
        expect(call[0].where.createdAt).toEqual({ gte: START, lte: END });
      }
      expect(prisma.sale.findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
      expect(prisma.payment.findMany.mock.calls[0][0].where.paidDate).toEqual({ gte: START, lte: END });
      expect(prisma.financeReceivable.aggregate.mock.calls[0][0].where.receivedDate).toEqual({
        gte: START,
        lte: END,
      });
      expect(prisma.journalLine.groupBy.mock.calls[0][0].where.journalEntry.entryDate).toEqual({
        gte: START,
        lte: END,
      });
    });

    it('ใบขาย/รับชำระเที่ยงคืนไทยของวันแรกอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
      const { service, prisma } = build();
      await service.getProfitLossReport('2026-11-01', '2026-11-17');
      const range = prisma.sale.aggregate.mock.calls[0][0].where.createdAt as { gte: Date; lte: Date };
      const firstMinute = new Date('2026-11-01T00:00:00+07:00');
      const lastDayEvening = new Date('2026-11-17T23:30:00+07:00');
      const nextMidnight = new Date('2026-11-18T00:00:00+07:00');
      expect(firstMinute >= range.gte && firstMinute <= range.lte).toBe(true);
      expect(lastDayEvening <= range.lte).toBe(true);
      expect(nextMidnight <= range.lte).toBe(false);
    });

    it('ค่าที่ไม่ใช่ YYYY-MM-DD ได้พฤติกรรมเดิม (ISO เต็ม = new Date(value) · สิ้นวันตาม setHours)', async () => {
      const { service, prisma } = build();
      await service.getProfitLossReport('2026-11-01T03:00:00.000Z', '2026-11-17T03:00:00.000Z');
      const range = prisma.sale.aggregate.mock.calls[0][0].where.createdAt as { gte: Date; lte: Date };
      expect(range.gte.toISOString()).toBe('2026-11-01T03:00:00.000Z');
      const legacyEnd = new Date('2026-11-17T03:00:00.000Z');
      legacyEnd.setHours(23, 59, 59, 999);
      expect(range.lte.getTime()).toBe(legacyEnd.getTime());
    });
  });

  describe('getCashFlowStatement', () => {
    it('ทุก query ใช้ช่วง 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
      const { service, prisma } = build();
      const result = await service.getCashFlowStatement('2026-11-01', '2026-11-17');

      for (const call of prisma.sale.aggregate.mock.calls) {
        expect(call[0].where.createdAt).toEqual({ gte: START, lte: END });
      }
      expect(prisma.payment.aggregate.mock.calls[0][0].where.paidDate).toEqual({ gte: START, lte: END });
      expect(prisma.financeReceivable.aggregate.mock.calls[0][0].where.receivedDate).toEqual({
        gte: START,
        lte: END,
      });
      expect(prisma.purchaseOrder.aggregate.mock.calls[0][0].where.orderDate).toEqual({ gte: START, lte: END });
      // คำตอบยัง echo ค่าที่ผู้ใช้ส่งมาตามเดิม
      expect(result.period).toEqual({ start: '2026-11-01', end: '2026-11-17' });
    });

    it('รับชำระเที่ยงคืนไทยของวันแรกอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
      const { service, prisma } = build();
      await service.getCashFlowStatement('2026-11-01', '2026-11-17');
      const range = prisma.payment.aggregate.mock.calls[0][0].where.paidDate as { gte: Date; lte: Date };
      const firstMinute = new Date('2026-11-01T00:00:00+07:00');
      const nextMidnight = new Date('2026-11-18T00:00:00+07:00');
      expect(firstMinute >= range.gte && firstMinute <= range.lte).toBe(true);
      expect(nextMidnight <= range.lte).toBe(false);
    });
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/accounting/transactional-report.service.report-dates.spec.ts
```

Expected: FAIL 4 เคส — `gte` ได้ `2026-11-01T00:00:00.000Z` แทน `2026-10-31T17:00:00.000Z` (ทั้ง P&L และกระแสเงินสด) และเคส "เที่ยงคืนไทยของวันแรกอยู่ในช่วง" ได้ `false` · เคส "ค่าที่ไม่ใช่ YYYY-MM-DD ได้พฤติกรรมเดิม" ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/accounting/transactional-report.service.ts`

เพิ่ม import ต่อจากบรรทัด `import { EXPENSE_ACCOUNT_CATEGORY } from './accounting-section-map.util';`:

```ts
import { reportDayEnd, reportDayStart } from '../../utils/date.util';
```

`getProfitLossReport` (`:132-134`) และ `getCashFlowStatement` (`:792-794`) — บล็อกเดียวกันทั้งสองที่:

```ts
// ก่อน
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

// หลัง
    const start = reportDayStart(startDate);
    const end = reportDayEnd(endDate);
```

(เมธอดอื่นที่มี `setHours(23,59,59,999)` ในไฟล์นี้ — `getMonthlyPLSummary` `:408-409,450-451` และ `getBalanceSheet` `:589-590` — ไม่แตะ: ตรวจแล้วถูกต้องภายใต้ `TZ=Asia/Bangkok` ของโปรเซส ดู "ตรวจแล้วไม่ต้องแก้")

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/accounting/transactional-report src/modules/accounting/accounting.pl-expense.spec.ts src/modules/reports
```

Expected: PASS ทั้งหมด (`accounting.pl-expense.spec.ts` เรียก `getProfitLossReport('2026-01-01','2026-01-31')` และไม่ตรวจขอบวัน)

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/accounting/transactional-report.service.ts apps/api/src/modules/accounting/transactional-report.service.report-dates.spec.ts
git commit -m "งบกำไรขาดทุน/เปรียบเทียบ/รายไตรมาส/กระแสเงินสด: วันเริ่มนับตั้งแต่ 00:00 น. ไทย

เดิม start = new Date('YYYY-MM-DD') = 07:00 น. ไทย ใบขายและการรับชำระ 00:00-06:59 น. ของวันแรกหายจากรายงาน
ขอบสิ้นสุดเปลี่ยนเป็นตัวช่วยที่ไม่ขึ้นกับ TZ ของโปรเซส (ผลเท่าเดิมเมื่อรัน TZ=Asia/Bangkok)

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 4: สแนปช็อตรายงานตอนปิดงวด (MonthlyCloseService) — แยกเดี่ยว

> **อ่านก่อนลงมือ:** task นี้เปลี่ยนตัวเลขที่ **เก็บถาวร** ใน `AccountingPeriod.reportSnapshot` ตอน `closePeriod` (REVIEW → CLOSED)
> - **สแนปช็อตที่เก็บไว้แล้วของงวดที่ปิดไปก่อน deploy ไม่ถูกเขียนใหม่** — ไม่มี migration · ไม่มีสคริปต์ backfill · งวดเหล่านั้นยังมีงบทดลอง ณ 07:00 น. ของวันสุดท้ายและ P&L ที่เริ่มนับ 07:00 น. ของวันที่ 1 ตามเดิม
> - สแนปช็อตใหม่เกิดเฉพาะงวดที่ปิดหลัง deploy (รวมงวดที่ถูก `reopenPeriod` แล้วปิดซ้ำ — `closePeriod` สร้างสแนปช็อตใหม่ทับทุกครั้ง · งวด `SYNCED` เปิดใหม่ไม่ได้อยู่แล้ว)
> - ตัวเลขที่เปลี่ยน: `trialBalance` (รายการหลัง 07:00 น. ของวันสุดท้ายเดือนเข้ามาครบ) และ `profitLoss` (ใบขาย/รับชำระ/ค่าใช้จ่าย 00:00–06:59 น. ของวันที่ 1 เข้ามา — ส่วนนี้เปลี่ยนจาก Task 3) · `balanceSheet` / `vatSummary` ไม่เปลี่ยน (ตรวจแล้ว: `getBalanceSheet` สิ้นวันตาม `setHours` ถูกอยู่แล้ว · `previewPP30` ใช้ขอบเดือนไทยอยู่แล้ว)
> - ส่ง/ deploy Task 3 และ Task 4 ในรอบเดียวกัน — ถ้าส่งเฉพาะ Task 3 สแนปช็อต P&L ที่ปิดระหว่างนั้นจะเริ่มถูกแล้วแต่งบทดลองยังผิด

**Files:**
- Modify: `apps/api/src/modules/accounting/monthly-close.service.ts` (เมธอด `generateReportSnapshots` `:653` งบทดลอง · `:654` P&L)
- Create/Test: `apps/api/src/modules/accounting/monthly-close.service.snapshot-dates.spec.ts` (แบบจาก `monthly-close.service.spec.ts` — `makePrisma` / `makeAccountingService` + describe `closePeriod`)

**Interfaces:**
- Consumes: `this.periodEnd(year, month): Date` (เมธอด private ของ service เอง `:72` = 00:00 น. ไทยวันที่ 1 เดือนถัดไป − 1 ms) · `TransactionalReportService.getProfitLossReport` จาก Task 3
- Produces: ไม่มี

**ที่มาของข้อบกพร่อง:** `asOfDate = this.lastDayStr(year, month)` (สตริง `YYYY-MM-DD` วันสุดท้ายของเดือน) แล้ว `getTrialBalance(new Date(asOfDate), 'ALL')` ⇒ ตัดยอดที่ 07:00 น. ไทยของวันสุดท้าย · `:654` ส่ง `startDate='YYYY-MM-01'` และ `asOfDate` เป็นสตริงให้ `getProfitLossReport` — **โค้ดบรรทัดนี้ไม่ต้องเปลี่ยนตรรกะ** เพราะการแปลงอยู่ใน service (Task 3) แต่ task นี้ปักผลปลายทางด้วยเทสต์ต่อสายจริงและเพิ่มคอมเมนต์กำกับ · `runDataAudit` `:556-557` และ `syncToPeak` `:316-317` ใช้ `periodStart/periodEnd` ที่เป็นขอบไทยอยู่แล้ว (ไม่แตะ)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/accounting/monthly-close.service.snapshot-dates.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { MonthlyCloseService } from './monthly-close.service';
import { TransactionalReportService } from './transactional-report.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { TaxService } from '../tax/tax.service';
import { AccountingService } from './accounting.service';
import { PeakService } from '../peak/peak.service';
import { AuditService } from '../audit/audit.service';

/**
 * สแนปช็อตตอนปิดงวด (reportSnapshot) ต้องนับเต็มเดือนตามปฏิทินไทย (2026-11-18)
 *
 * เดิม: งบทดลองตัดยอดที่ new Date('YYYY-MM-30') = 07:00 น. ไทยของวันสุดท้าย ⇒ ทุกรายการหลัง 07:00 น. ของวันสุดท้าย
 * หายจาก trialBalance ที่เก็บ · P&L เริ่มนับที่ 07:00 น. ของวันที่ 1 ⇒ ใบขาย/รับชำระ 00:00–06:59 น. ของวันที่ 1 หาย
 *
 * ส่วน P&L: monthly-close ยังส่งสตริงวันที่ 'YYYY-MM-01' / 'YYYY-MM-DD' เหมือนเดิม — การแปลงเป็นขอบวันไทยอยู่ใน
 * TransactionalReportService.getProfitLossReport (Task 3) · เทสต์นี้ต่อสายจริงเพื่อปักผลปลายทาง
 */
describe('MonthlyCloseService.closePeriod — วันที่ของสแนปช็อต', () => {
  let service: MonthlyCloseService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let accountingService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let reportPrisma: any;

  beforeEach(async () => {
    prisma = {
      accountingPeriod: { findUnique: jest.fn(), update: jest.fn() },
      companyInfo: { findUnique: jest.fn().mockResolvedValue({ companyCode: 'FINANCE' }) },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };
    reportPrisma = {
      sale: {
        aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      financeReceivable: { aggregate: jest.fn().mockResolvedValue({ _sum: {} }) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      journalLine: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    const transactional = new TransactionalReportService(
      reportPrisma as never,
      { getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-1') } as never,
    );
    accountingService = {
      getBranchIdsForCompany: jest.fn().mockResolvedValue(['branch-1']),
      getTrialBalance: jest.fn().mockResolvedValue({ accounts: [], isBalanced: true }),
      getProfitLossReport: jest.fn((...args: unknown[]) =>
        (transactional.getProfitLossReport as (...a: unknown[]) => unknown)(...args),
      ),
      getBalanceSheet: jest.fn().mockResolvedValue({ totalAssets: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonthlyCloseService,
        { provide: PrismaService, useValue: prisma },
        { provide: JournalAutoService, useValue: { getTrialBalance: jest.fn() } },
        { provide: TaxService, useValue: { previewPP30: jest.fn().mockResolvedValue({}) } },
        { provide: AccountingService, useValue: accountingService },
        { provide: PeakService, useValue: { isConfigured: jest.fn(), exportJournalEntries: jest.fn() } },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(MonthlyCloseService);
  });

  const closeMonth = async (year: number, month: number) => {
    prisma.accountingPeriod.findUnique.mockResolvedValue({
      id: 'period-1',
      companyId: 'company-1',
      year,
      month,
      status: 'REVIEW',
    });
    prisma.accountingPeriod.update.mockResolvedValue({ id: 'period-1', status: 'CLOSED' });
    await service.closePeriod('company-1', year, month, 'user-1');
  };

  it('พ.ย. 2026: งบทดลอง ณ สิ้นเดือนไทย (30 พ.ย. 23:59:59.999 น.) ขอบเขต ALL', async () => {
    await closeMonth(2026, 11);
    const [asOf, scope] = accountingService.getTrialBalance.mock.calls[0];
    expect(asOf.toISOString()).toBe('2026-11-30T16:59:59.999Z');
    expect(scope).toBe('ALL');
  });

  it('ธ.ค. 2026: งบทดลอง ณ 31 ธ.ค. 23:59:59.999 น. ไทย (เดือนสุดท้ายของปี)', async () => {
    await closeMonth(2026, 12);
    expect(accountingService.getTrialBalance.mock.calls[0][0].toISOString()).toBe('2026-12-31T16:59:59.999Z');
  });

  it('P&L: ยังส่งสตริงวันที่ YYYY-MM-01 ถึงวันสุดท้ายของเดือนให้ getProfitLossReport', async () => {
    await closeMonth(2026, 11);
    expect(accountingService.getProfitLossReport).toHaveBeenCalledWith(
      '2026-11-01',
      '2026-11-30',
      undefined,
      ['branch-1'],
      true,
    );
  });

  it('P&L ต่อสายจริง: ทุก query นับ 00:00 น. วันที่ 1 ถึง 23:59:59.999 น. วันสุดท้ายของเดือน (เวลาไทย)', async () => {
    await closeMonth(2026, 11);
    const range = { gte: new Date('2026-10-31T17:00:00.000Z'), lte: new Date('2026-11-30T16:59:59.999Z') };
    expect(reportPrisma.sale.aggregate.mock.calls[0][0].where.createdAt).toEqual(range);
    expect(reportPrisma.payment.findMany.mock.calls[0][0].where.paidDate).toEqual(range);
    expect(reportPrisma.journalLine.groupBy.mock.calls[0][0].where.journalEntry.entryDate).toEqual(range);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/accounting/monthly-close.service.snapshot-dates.spec.ts
```

Expected (หลัง Task 3 แล้ว): FAIL 2 เคส — งบทดลอง `Received: "2026-11-30T00:00:00.000Z"` แทน `2026-11-30T16:59:59.999Z` (และ `2026-12-31T…` ของเดือนธันวาคม) · เคส "P&L ยังส่งสตริง…" และ "P&L ต่อสายจริง" ผ่านอยู่แล้วเพราะ Task 3 · (ถ้ารันก่อน Task 3 เคส "P&L ต่อสายจริง" จะล้มที่ `gte` ด้วย)

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/accounting/monthly-close.service.ts` ใน `generateReportSnapshots`

```ts
// ก่อน
      this.accountingService.getTrialBalance(new Date(asOfDate), 'ALL'),
      this.accountingService.getProfitLossReport(startDate, asOfDate, undefined, branchIds, includeFinanceExpenses),

// หลัง
      this.accountingService.getTrialBalance(this.periodEnd(year, month), 'ALL'),
      // P&L ยังส่งสตริง 'YYYY-MM-01' .. 'YYYY-MM-DD' — getProfitLossReport แปลงเป็น 00:00 น. .. 23:59:59.999 น. ไทยเอง
      this.accountingService.getProfitLossReport(startDate, asOfDate, undefined, branchIds, includeFinanceExpenses),
```

(`asOfDate` ยังใช้ต่อที่ `getProfitLossReport` และ `getBalanceSheet(asOfDate, …)` จึงไม่ลบตัวแปร)

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/accounting/monthly-close
```

Expected: PASS ทั้ง `monthly-close.service.snapshot-dates.spec.ts` และ `monthly-close.service.spec.ts` (spec เดิม mock `getTrialBalance` และไม่ตรวจอาร์กิวเมนต์วันที่)

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/accounting/monthly-close.service.ts apps/api/src/modules/accounting/monthly-close.service.snapshot-dates.spec.ts
git commit -m "สแนปช็อตปิดงวด: งบทดลองตัดยอดสิ้นเดือนไทย (เดิมตัดที่ 07:00 น. ของวันสุดท้าย)

สแนปช็อตที่เก็บไว้แล้วของงวดที่ปิดก่อนหน้านี้ไม่ถูกเขียนใหม่ — มีผลเฉพาะงวดที่ปิดหลังนี้
P&L ในสแนปช็อตเริ่มนับ 00:00 น. วันที่ 1 จากการแก้ TransactionalReportService (commit ก่อนหน้า) เทสต์นี้ปักผลปลายทาง

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 5: รายการบัญชี (JournalService.findAll)

**Files:**
- Modify: `apps/api/src/modules/journal/journal.service.ts` (เมธอด `findAll` `:129-136` + import)
- Create/Test: `apps/api/src/modules/journal/journal.service.find-all-dates.spec.ts` (แบบจาก `journal.service.spec.ts` — `Test.createTestingModule` + prisma mock)

**Interfaces:**
- Consumes: `reportDayStart(value: string): Date` · `reportAsOf(value: string): Date` (ขอบสิ้นสุด — เดิมเป็น `new Date(endDate)` เปล่า)
- Produces: ไม่มี

**ที่มาของข้อบกพร่อง (latent — ยังไม่มีหน้าเว็บส่งวันที่):** `GET /journal-entries?startDate&endDate` กรอง `entryDate gte new Date(startDate)` / `lte new Date(endDate)` = 07:00 น. ไทยทั้งสองขอบ ⇒ ตัดรายการตั้งลูกหนี้งวด (เที่ยงคืนไทย) ของวันเริ่มและทุกรายการหลัง 07:00 น. ของวันสิ้นสุด · `JournalService.create` (writer, `entryDate = new Date(dto.entryDate)`) ไม่แตะ

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/journal/journal.service.find-all-dates.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { JournalService } from './journal.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * GET /journal-entries?startDate&endDate — 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * entryDate ของรายการอัตโนมัติเป็นเวลาจริง · รายการตั้งลูกหนี้งวดลงเที่ยงคืนไทยของวันครบกำหนด
 * เดิมใช้ new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ ตัดรายการเที่ยงคืนของวันเริ่ม และทุกรายการหลัง 07:00 น. ของวันสิ้นสุด
 */
describe('JournalService.findAll — ช่วงวันที่ entryDate', () => {
  let service: JournalService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      journalEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [JournalService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(JournalService);
  });

  const entryDateOf = () => prisma.journalEntry.findMany.mock.calls[0][0].where.entryDate;

  it('startDate + endDate = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await service.findAll({ startDate: '2026-11-01', endDate: '2026-11-17' });
    expect(entryDateOf()).toEqual({
      gte: new Date('2026-10-31T17:00:00.000Z'),
      lte: new Date('2026-11-17T16:59:59.999Z'),
    });
  });

  it('รายการตั้งลูกหนี้งวดเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
    await service.findAll({ startDate: '2026-11-01', endDate: '2026-11-17' });
    const { gte, lte } = entryDateOf() as { gte: Date; lte: Date };
    const accrual = new Date('2026-11-01T00:00:00+07:00');
    const lateEvening = new Date('2026-11-17T23:59:00+07:00');
    const nextDayAccrual = new Date('2026-11-18T00:00:00+07:00');
    expect(accrual >= gte && accrual <= lte).toBe(true);
    expect(lateEvening <= lte).toBe(true);
    expect(nextDayAccrual <= lte).toBe(false);
  });

  it('ส่งแค่ startDate = มีเฉพาะ gte · ส่งแค่ endDate = มีเฉพาะ lte', async () => {
    await service.findAll({ startDate: '2026-11-01' });
    expect(entryDateOf()).toEqual({ gte: new Date('2026-10-31T17:00:00.000Z') });
    prisma.journalEntry.findMany.mockClear();
    await service.findAll({ endDate: '2026-11-17' });
    expect(entryDateOf()).toEqual({ lte: new Date('2026-11-17T16:59:59.999Z') });
  });

  it('ค่าที่ไม่ใช่ YYYY-MM-DD (ISO เต็ม) ผ่านไปตามที่ส่งมา ไม่ขยายเป็นสิ้นวัน', async () => {
    await service.findAll({ startDate: '2026-11-01T03:00:00.000Z', endDate: '2026-11-17T03:04:05.000Z' });
    expect(entryDateOf()).toEqual({
      gte: new Date('2026-11-01T03:00:00.000Z'),
      lte: new Date('2026-11-17T03:04:05.000Z'),
    });
  });

  it('ไม่ส่งวันที่ = ไม่กรอง entryDate', async () => {
    await service.findAll({});
    expect(prisma.journalEntry.findMany.mock.calls[0][0].where.entryDate).toBeUndefined();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/journal/journal.service.find-all-dates.spec.ts
```

Expected: FAIL 3 เคส — `gte` ได้ `2026-11-01T00:00:00.000Z` แทน `2026-10-31T17:00:00.000Z` · `lte` ได้ `2026-11-17T00:00:00.000Z` แทน `2026-11-17T16:59:59.999Z` · เคส "ไม่ส่งวันที่" ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/journal/journal.service.ts`

เพิ่ม import ต่อจากบรรทัด `import { validatePeriodOpen } from '../../utils/period-lock.util';`:

```ts
import { reportAsOf, reportDayStart } from '../../utils/date.util';
```

```ts
// ก่อน
      if (filters.startDate) {
        entryDate.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        entryDate.lte = new Date(filters.endDate);
      }

// หลัง
      if (filters.startDate) {
        entryDate.gte = reportDayStart(filters.startDate);
      }
      if (filters.endDate) {
        // reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)
        entryDate.lte = reportAsOf(filters.endDate);
      }
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/journal/journal.service
```

Expected: PASS ทั้ง `journal.service.find-all-dates.spec.ts` และ `journal.service.spec.ts`

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/journal/journal.service.ts apps/api/src/modules/journal/journal.service.find-all-dates.spec.ts
git commit -m "รายการบัญชี GET /journal-entries: กรองวันที่เต็มวันตามเวลาไทย

เดิมทั้ง startDate และ endDate เป็น 07:00 น. ไทย ตัดรายการตั้งลูกหนี้งวด (เที่ยงคืนไทย) ของวันเริ่ม
และรายการหลัง 07:00 น. ของวันสิ้นสุด

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 6: ธุรกรรมระหว่างกิจการ (InterCompanyService)

**Files:**
- Modify: `apps/api/src/modules/inter-company/inter-company.service.ts` (`findAll` `:177-178` · `getProfitSummary` `:278-279` + import)
- Create/Test: `apps/api/src/modules/inter-company/inter-company.service.report-dates.spec.ts` (แบบจาก `inter-company.service.spec.ts` — `Test.createTestingModule` + prisma mock)

**Interfaces:**
- Consumes: `reportDayStart(value: string): Date` · `reportAsOf(value: string): Date` (ขอบสิ้นสุด — เดิมเป็น `new Date(endDate)` เปล่า)
- Produces: ไม่มี

**ที่มาของข้อบกพร่อง (latent):** `InterCompanyTransaction.createdAt` (`@default(now())` = เวลาจริง) กรอง `gte new Date(startDate)` / `lte new Date(endDate)` (ไม่ขยายเป็นสิ้นวัน) = 07:00 น. ไทยทั้งสองขอบ · `FinanceReceivablePage` เรียก `GET /inter-company` และ `profit-summary` โดยไม่ส่งวันที่ ⇒ ยังไม่เห็นผล

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/inter-company/inter-company.service.report-dates.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { InterCompanyService } from './inter-company.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * GET /inter-company และ /inter-company/profit-summary — startDate/endDate 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * InterCompanyTransaction.createdAt เป็นเวลาจริง (@default(now())) ·
 * เดิม gte = 07:00 น. ไทยของวันเริ่ม และ lte = 07:00 น. ไทยของวันสิ้นสุด (ไม่ขยายเป็นสิ้นวัน)
 */
describe('InterCompanyService — ช่วงวันที่ createdAt', () => {
  let service: InterCompanyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      interCompanyTransaction: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [InterCompanyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(InterCompanyService);
  });

  const createdAtOf = () => prisma.interCompanyTransaction.findMany.mock.calls[0][0].where.createdAt;
  const RANGE = {
    gte: new Date('2026-10-31T17:00:00.000Z'),
    lte: new Date('2026-11-17T16:59:59.999Z'),
  };

  it('findAll: 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await service.findAll({ startDate: '2026-11-01', endDate: '2026-11-17' });
    expect(createdAtOf()).toEqual(RANGE);
  });

  it('getProfitSummary: 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await service.getProfitSummary({ startDate: '2026-11-01', endDate: '2026-11-17' });
    expect(createdAtOf()).toEqual(RANGE);
  });

  it('รายการเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
    await service.findAll({ startDate: '2026-11-01', endDate: '2026-11-17' });
    const { gte, lte } = createdAtOf() as { gte: Date; lte: Date };
    const firstMinute = new Date('2026-11-01T00:00:00+07:00');
    const afternoonOnEndDay = new Date('2026-11-17T15:00:00+07:00');
    const nextMidnight = new Date('2026-11-18T00:00:00+07:00');
    expect(firstMinute >= gte && firstMinute <= lte).toBe(true);
    expect(afternoonOnEndDay <= lte).toBe(true);
    expect(nextMidnight <= lte).toBe(false);
  });

  it('ส่งแค่ startDate / แค่ endDate = ใส่เฉพาะขอบที่ส่ง', async () => {
    await service.findAll({ startDate: '2026-11-01' });
    expect(createdAtOf()).toEqual({ gte: RANGE.gte });
    prisma.interCompanyTransaction.findMany.mockClear();
    await service.getProfitSummary({ endDate: '2026-11-17' });
    expect(createdAtOf()).toEqual({ lte: RANGE.lte });
  });

  it('ค่าที่ไม่ใช่ YYYY-MM-DD (ISO เต็ม) ผ่านไปตามที่ส่งมา ไม่ขยายเป็นสิ้นวัน', async () => {
    const iso = { startDate: '2026-11-01T03:00:00.000Z', endDate: '2026-11-17T03:04:05.000Z' };
    const expected = { gte: new Date(iso.startDate), lte: new Date(iso.endDate) };
    await service.findAll(iso);
    expect(createdAtOf()).toEqual(expected);
    prisma.interCompanyTransaction.findMany.mockClear();
    await service.getProfitSummary(iso);
    expect(createdAtOf()).toEqual(expected);
  });

  it('ไม่ส่งวันที่ = ไม่กรอง createdAt', async () => {
    await service.findAll({});
    expect(prisma.interCompanyTransaction.findMany.mock.calls[0][0].where.createdAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/inter-company/inter-company.service.report-dates.spec.ts
```

Expected: FAIL 4 เคส — ขอบ `createdAt` ได้ `2026-11-01T00:00:00.000Z` / `2026-11-17T00:00:00.000Z` แทน `2026-10-31T17:00:00.000Z` / `2026-11-17T16:59:59.999Z` · เคส "ไม่ส่งวันที่" ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/inter-company/inter-company.service.ts`

เพิ่ม import ต่อจากบรรทัด `import { d, dAdd } from '../../utils/decimal.util';`:

```ts
import { reportAsOf, reportDayStart } from '../../utils/date.util';
```

สองที่ (`findAll` และ `getProfitSummary`) เหมือนกันทุกตัวอักษร:

```ts
// ก่อน
      if (params.startDate) (where.createdAt as Record<string, unknown>).gte = new Date(params.startDate);
      if (params.endDate) (where.createdAt as Record<string, unknown>).lte = new Date(params.endDate);

// หลัง
      if (params.startDate) (where.createdAt as Record<string, unknown>).gte = reportDayStart(params.startDate);
      // reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)
      if (params.endDate) (where.createdAt as Record<string, unknown>).lte = reportAsOf(params.endDate);
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/inter-company
```

Expected: PASS ทั้ง `inter-company.service.report-dates.spec.ts` และ `inter-company.service.spec.ts`

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/inter-company/inter-company.service.ts apps/api/src/modules/inter-company/inter-company.service.report-dates.spec.ts
git commit -m "ธุรกรรมระหว่างกิจการ + สรุปกำไร: กรองวันที่เต็มวันตามเวลาไทย

เดิมวันเริ่มและวันสิ้นสุดเป็น 07:00 น. ไทย (createdAt เป็นเวลาจริง) ตัดรายการเช้ามืดของวันเริ่ม
และรายการหลัง 07:00 น. ของวันสิ้นสุด

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 7: ประวัติ audit และสมุดรายวันของสินทรัพย์ถาวร (AssetQueryService · AssetJournalService)

**Files:**
- Modify: `apps/api/src/modules/asset/services/asset-query.service.ts` (`listGlobalAudit` `:443-446` + import)
- Modify: `apps/api/src/modules/asset/asset-journal.service.ts` (`list` `:56-60` + import)
- Create/Test: `apps/api/src/modules/asset/__tests__/asset-report-dates.spec.ts` (แบบจาก `asset-register-summary.spec.ts` — `new AssetQueryService(prisma as never)` ด้วย hand-built mock)

**Interfaces:**
- Consumes: `reportDayStart(value: string): Date` · `reportDayEnd(value: string): Date`
- Produces: ไม่มี

**ที่มาของข้อบกพร่อง:** `GET /assets/audit` กรอง `AuditLog.createdAt` (เวลาจริง) ด้วย `gte new Date(fromDate)` = 07:00 น. ไทย ⇒ ประวัติ 00:00–06:59 น. ของวันเริ่มหาย · `GET /assets/journal` กรอง `JournalEntry.entryDate`: รายการซื้อ/จำหน่ายถูกลงที่ 07:00 น. ไทย (ยังอยู่ในช่วง) แต่รายการกลับรายการ/ใบกำกับมาถึงเป็นเวลาจริง ⇒ 00:00–06:59 น. ของวันเริ่มหาย · ฝั่ง `lte` ของทั้งสองใช้ `setHours` อยู่แล้ว (เปลี่ยนเป็นตัวช่วยเพื่อไม่ขึ้นกับ TZ)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/asset/__tests__/asset-report-dates.spec.ts`:

```ts
import { AssetQueryService } from '../services/asset-query.service';
import { AssetJournalService } from '../asset-journal.service';

/**
 * GET /assets/audit?fromDate&toDate และ GET /assets/journal?fromDate&toDate — 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * - AuditLog.createdAt และ JournalEntry.entryDate ของรายการกลับรายการ/ใบกำกับมาถึงเป็นเวลาจริง
 * - เดิม gte = new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ รายการ 00:00–06:59 น. ของวันเริ่มหาย
 *   (ฝั่ง lte ถูกเพราะ setHours(23,59,59,999) ตาม TZ ของโปรเซสเท่านั้น)
 * ตามแบบ asset-register-summary.spec.ts (hand-built prisma mock + new Service(prisma))
 */
describe('Asset reports — ช่วงวันที่', () => {
  const RANGE = {
    gte: new Date('2026-10-31T17:00:00.000Z'),
    lte: new Date('2026-11-17T16:59:59.999Z'),
  };

  describe('AssetQueryService.listGlobalAudit', () => {
    const prisma = {
      auditLog: { findMany: jest.fn(), count: jest.fn() },
      fixedAsset: { findMany: jest.fn() },
    };
    const service = new AssetQueryService(prisma as never);

    beforeEach(() => {
      jest.clearAllMocks();
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);
      prisma.fixedAsset.findMany.mockResolvedValue([]);
    });

    it('createdAt = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
      await service.listGlobalAudit({ fromDate: '2026-11-01', toDate: '2026-11-17' });
      expect(prisma.auditLog.findMany.mock.calls[0][0].where.createdAt).toEqual(RANGE);
      expect(prisma.auditLog.count.mock.calls[0][0].where.createdAt).toEqual(RANGE);
    });

    it('บันทึกเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
      await service.listGlobalAudit({ fromDate: '2026-11-01', toDate: '2026-11-17' });
      const { gte, lte } = prisma.auditLog.findMany.mock.calls[0][0].where.createdAt as { gte: Date; lte: Date };
      const reversal = new Date('2026-11-01T00:00:00+07:00');
      const nextMidnight = new Date('2026-11-18T00:00:00+07:00');
      expect(reversal >= gte && reversal <= lte).toBe(true);
      expect(nextMidnight <= lte).toBe(false);
    });

    it('ส่งแค่ fromDate / แค่ toDate = ใส่เฉพาะขอบที่ส่ง · ไม่ส่ง = ไม่กรอง', async () => {
      await service.listGlobalAudit({ fromDate: '2026-11-01' });
      expect(prisma.auditLog.findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: RANGE.gte });
      await service.listGlobalAudit({ toDate: '2026-11-17' });
      expect(prisma.auditLog.findMany.mock.calls[1][0].where.createdAt).toEqual({ lte: RANGE.lte });
      await service.listGlobalAudit({});
      expect(prisma.auditLog.findMany.mock.calls[2][0].where.createdAt).toBeUndefined();
    });
  });

  describe('AssetJournalService.list', () => {
    const prisma = {
      journalEntry: { findMany: jest.fn(), count: jest.fn() },
      fixedAsset: { findMany: jest.fn() },
    };
    const service = new AssetJournalService(prisma as never);

    beforeEach(() => {
      jest.clearAllMocks();
      prisma.journalEntry.findMany.mockResolvedValue([]);
      prisma.journalEntry.count.mockResolvedValue(0);
      prisma.fixedAsset.findMany.mockResolvedValue([]);
    });

    it('entryDate = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
      await service.list({ fromDate: '2026-11-01', toDate: '2026-11-17' });
      expect(prisma.journalEntry.findMany.mock.calls[0][0].where.entryDate).toEqual(RANGE);
      expect(prisma.journalEntry.count.mock.calls[0][0].where.entryDate).toEqual(RANGE);
    });

    it('รายการกลับรายการเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
      await service.list({ fromDate: '2026-11-01', toDate: '2026-11-17' });
      const { gte, lte } = prisma.journalEntry.findMany.mock.calls[0][0].where.entryDate as {
        gte: Date;
        lte: Date;
      };
      const reversal = new Date('2026-11-01T00:00:00+07:00');
      const nextMidnight = new Date('2026-11-18T00:00:00+07:00');
      expect(reversal >= gte && reversal <= lte).toBe(true);
      expect(nextMidnight <= lte).toBe(false);
    });

    it('ส่งแค่ fromDate / แค่ toDate = ใส่เฉพาะขอบที่ส่ง · ไม่ส่ง = ไม่กรอง', async () => {
      await service.list({ fromDate: '2026-11-01' });
      expect(prisma.journalEntry.findMany.mock.calls[0][0].where.entryDate).toEqual({ gte: RANGE.gte });
      await service.list({ toDate: '2026-11-17' });
      expect(prisma.journalEntry.findMany.mock.calls[1][0].where.entryDate).toEqual({ lte: RANGE.lte });
      await service.list({});
      expect(prisma.journalEntry.findMany.mock.calls[2][0].where.entryDate).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/asset/__tests__/asset-report-dates.spec.ts
```

Expected: FAIL 6 เคส — `gte` ได้ `2026-11-01T00:00:00.000Z` แทน `2026-10-31T17:00:00.000Z` · เคส "เที่ยงคืนไทยของวันเริ่มอยู่ในช่วง" ได้ `false`

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/asset/services/asset-query.service.ts`

เพิ่ม import ต่อจากบรรทัด `import { buildDepreciationSchedule } from '../depreciation-schedule.util';`:

```ts
import { reportDayEnd, reportDayStart } from '../../../utils/date.util';
```

```ts
// ก่อน
      const range: Record<string, Date> = {};
      if (params.fromDate) range.gte = new Date(params.fromDate);
      if (params.toDate) {
        const end = new Date(params.toDate);
        end.setHours(23, 59, 59, 999);
        range.lte = end;
      }
      where.createdAt = range;

// หลัง
      const range: Record<string, Date> = {};
      if (params.fromDate) range.gte = reportDayStart(params.fromDate);
      if (params.toDate) range.lte = reportDayEnd(params.toDate);
      where.createdAt = range;
```

`apps/api/src/modules/asset/asset-journal.service.ts`

เพิ่ม import ต่อจากบรรทัด `import { PrismaService } from '../../prisma/prisma.service';`:

```ts
import { reportDayEnd, reportDayStart } from '../../utils/date.util';
```

```ts
// ก่อน
      where.entryDate = {};
      if (filters.fromDate) where.entryDate.gte = new Date(filters.fromDate);
      if (filters.toDate) {
        const end = new Date(filters.toDate);
        end.setHours(23, 59, 59, 999);
        where.entryDate.lte = end;
      }

// หลัง
      where.entryDate = {};
      if (filters.fromDate) where.entryDate.gte = reportDayStart(filters.fromDate);
      if (filters.toDate) where.entryDate.lte = reportDayEnd(filters.toDate);
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/asset/__tests__/asset-report-dates.spec.ts src/modules/asset/__tests__/asset-global-audit.spec.ts src/modules/asset/__tests__/asset-register-summary.spec.ts
```

Expected: PASS ทั้งหมด · `asset-journal.service.spec.ts` (เทสต์ DB เคส `date range filter on entryDate`) ไม่เปลี่ยนผลเพราะ JE ทดสอบลงที่ `2026-03-01` / `2026-04-xx` กลางเดือน — รันใน CI หรือเมื่อมี DB ทดสอบ

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/asset/services/asset-query.service.ts apps/api/src/modules/asset/asset-journal.service.ts apps/api/src/modules/asset/__tests__/asset-report-dates.spec.ts
git commit -m "ประวัติ audit/สมุดรายวันสินทรัพย์ถาวร: วันเริ่มนับตั้งแต่ 00:00 น. ไทย

เดิม fromDate = 07:00 น. ไทย ตัดบันทึก/รายการกลับรายการ 00:00-06:59 น. ของวันเริ่ม
วันสิ้นสุดเปลี่ยนเป็นตัวช่วยที่ไม่ขึ้นกับ TZ ของโปรเซส

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 8: ด่าน "วันที่จำหน่ายต้องไม่อยู่ในอนาคต" ของสินทรัพย์ (AssetLifecycleService.dispose)

**Files:**
- Modify: `apps/api/src/modules/asset/services/asset-lifecycle.service.ts` (เมธอด `dispose` `:362-366` + import)
- Create/Test: `apps/api/src/modules/asset/__tests__/asset-lifecycle.dispose-date.spec.ts` (hand-built mock แบบ `asset-register-summary.spec.ts`; spec เต็มของ `dispose` เป็น DB spec ใน `asset.service.spec.ts` ซึ่งไม่แตะ)

**Interfaces:**
- Consumes: `isFutureBkkDay(date: Date, now?: Date): boolean` จาก `../../../utils/date.util` (เทียบวันปฏิทินไทยของ `date` กับ `now`)
- Produces: ไม่มี

**ที่มาของข้อบกพร่อง (ฝั่งเขียน — ตระกูลเดียวกัน):** `disposalDate = new Date(dto.disposalDate)` = 07:00 น. ไทยของวันนั้น แล้ว `disposalDate.getTime() > Date.now()` ⇒ ช่วง 00:00–06:59 น. ไทย การจำหน่าย "วันนี้" ถูกปฏิเสธว่าเป็นอนาคต · **ค่า `disposalDate` ที่ส่งเข้า template (วันที่ลงรายการบัญชี) ไม่เปลี่ยน** (ยังเป็น 07:00 น. ไทยของวันนั้น เหมือนทุกรายการจำหน่ายที่ผ่านมา) — แก้เฉพาะด่านเปรียบเทียบ · ผลข้างเคียงที่ตั้งใจ: ค่าที่ส่งมาเป็น ISO เต็ม (มีเวลา) ที่เป็นเวลาในอนาคตของ **วันนี้** จะผ่านด่านด้วย (เทียบระดับวัน) — DTO ใช้ `@IsDateString` และเว็บส่ง `YYYY-MM-DD` เท่านั้น · ด่านเดียวกันของ `asset-transfer.service.ts:70-71` (`todayEnd.setHours(23,59,59,999)`) ถูกต้องอยู่แล้ว ไม่แตะ

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/asset/__tests__/asset-lifecycle.dispose-date.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { AssetLifecycleService } from '../services/asset-lifecycle.service';

/**
 * AssetLifecycleService.dispose — ด่าน "วันที่จำหน่ายต้องไม่อยู่ในอนาคต" นับตามวันปฏิทินไทย (2026-11-18)
 *
 * disposalDate 'YYYY-MM-DD' ถูกแปลงเป็น 00:00 UTC = 07:00 น. ไทยของวันนั้น (ค่านี้ยังเป็นวันที่ลงรายการบัญชี — ไม่เปลี่ยน)
 * เดิมเทียบ getTime() กับ Date.now() ⇒ ช่วง 00:00–06:59 น. ไทย การจำหน่าย "วันนี้" ถูกปฏิเสธว่าเป็นอนาคต
 * เทสต์นี้ hand-built mock (ไม่แตะ DB) — เคสเต็มของ dispose อยู่ที่ asset.service.spec.ts (DB spec)
 */
describe('AssetLifecycleService.dispose — ด่านวันที่ในอนาคต', () => {
  const asset = {
    id: 'asset-1',
    assetCode: 'EQ-0001',
    status: 'POSTED',
    netBookValue: new Decimal(1000),
  };
  const dto = {
    disposalType: 'WRITE_OFF' as const,
    disposalDate: '2026-11-18',
    reason: 'ตัดจำหน่ายทดสอบ',
  };

  function build() {
    const tx = {
      fixedAsset: {
        findUnique: jest.fn().mockResolvedValue({ status: 'WRITTEN_OFF' }),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      fixedAsset: { findFirst: jest.fn().mockResolvedValue(asset) },
      companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'finance-co-1' }) },
      accountingPeriod: { findUnique: jest.fn().mockResolvedValue(null) },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };
    const disposalTemplate = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-1' }) };
    const service = new AssetLifecycleService(
      prisma as never,
      {} as never,
      {} as never,
      disposalTemplate as never,
      {} as never,
      {} as never,
    );
    return { service, disposalTemplate };
  }

  afterEach(() => jest.useRealTimers());

  it('03:00 น. ไทยของ 18 พ.ย. (= 17 พ.ย. 20:00Z) จำหน่ายวันที่ 18 พ.ย. ได้ · วันที่ลงรายการยังเป็น 07:00 น. ไทยเหมือนเดิม', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-17T20:00:00.000Z'));
    const { service, disposalTemplate } = build();
    await expect(service.dispose('asset-1', dto, 'user-1')).resolves.toEqual({ entryNo: 'JE-1' });
    expect(disposalTemplate.execute.mock.calls[0][0].disposalDate.toISOString()).toBe('2026-11-18T00:00:00.000Z');
  });

  it('00:00 น. ไทยตรง (= 17 พ.ย. 17:00:00.000Z) จำหน่ายวันนี้ได้', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-17T17:00:00.000Z'));
    const { service } = build();
    await expect(service.dispose('asset-1', dto, 'user-1')).resolves.toEqual({ entryNo: 'JE-1' });
  });

  it('17:00 น. ไทยของวันเดียวกัน จำหน่ายวันนี้ได้ (เหมือนเดิม)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-18T10:00:00.000Z'));
    const { service } = build();
    await expect(service.dispose('asset-1', dto, 'user-1')).resolves.toEqual({ entryNo: 'JE-1' });
  });

  it('23:59:59.999 น. ไทยของ 17 พ.ย. จำหน่ายวันที่ 18 พ.ย. (พรุ่งนี้) ไม่ได้', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-17T16:59:59.999Z'));
    const { service, disposalTemplate } = build();
    await expect(service.dispose('asset-1', dto, 'user-1')).rejects.toThrow(BadRequestException);
    await expect(service.dispose('asset-1', dto, 'user-1')).rejects.toThrow(/อนาคต/);
    expect(disposalTemplate.execute).not.toHaveBeenCalled();
  });

  it('03:00 น. ไทยของ 18 พ.ย. จำหน่ายวันที่ 19 พ.ย. ไม่ได้', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-17T20:00:00.000Z'));
    const { service, disposalTemplate } = build();
    await expect(
      service.dispose('asset-1', { ...dto, disposalDate: '2026-11-19' }, 'user-1'),
    ).rejects.toThrow(/อนาคต/);
    expect(disposalTemplate.execute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/asset/__tests__/asset-lifecycle.dispose-date.spec.ts
```

Expected: FAIL 2 เคส (`Received promise rejected instead of resolved`) — เคส 03:00 น. ไทย และ 00:00 น. ไทยตรง จำหน่ายวันนี้ถูกปฏิเสธว่าเป็นอนาคต · อีก 3 เคส (17:00 น. · พรุ่งนี้ 23:59:59.999 · 19 พ.ย.) ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/asset/services/asset-lifecycle.service.ts`

เพิ่ม import ต่อจากบรรทัด `import { validatePeriodOpen } from '../../../utils/period-lock.util';`:

```ts
import { isFutureBkkDay } from '../../../utils/date.util';
```

```ts
// ก่อน
    const disposalDate = new Date(dto.disposalDate);
    if (disposalDate.getTime() > Date.now()) {
      throw new BadRequestException('วันที่จำหน่ายต้องไม่อยู่ในอนาคต (future date not allowed)');
    }

// หลัง
    const disposalDate = new Date(dto.disposalDate);
    // เทียบระดับวันปฏิทินไทย — 'YYYY-MM-DD' ถูกแปลงเป็น 07:00 น. ไทยของวันนั้น ซึ่งยังไม่ถึงเวลาจริงช่วง 00:00-06:59 น. ของวันเดียวกัน
    if (isFutureBkkDay(disposalDate)) {
      throw new BadRequestException('วันที่จำหน่ายต้องไม่อยู่ในอนาคต (future date not allowed)');
    }
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/asset/__tests__/asset-lifecycle.dispose-date.spec.ts
```

Expected: PASS 5 เคส · เคสเต็มของ `dispose` (`asset.service.spec.ts` — มีเคส `rejects if disposalDate is in the future` ที่ใช้วันอีกหนึ่งปีข้างหน้า) เป็น DB spec รันใน CI

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/asset/services/asset-lifecycle.service.ts apps/api/src/modules/asset/__tests__/asset-lifecycle.dispose-date.spec.ts
git commit -m "จำหน่ายสินทรัพย์: จำหน่าย 'วันนี้' ได้ตลอดวัน (เดิมช่วง 00:00-06:59 น. ถูกปฏิเสธว่าเป็นอนาคต)

ด่านเทียบวันปฏิทินไทยแทนเทียบเวลา · วันที่ลงรายการบัญชีของรายการจำหน่ายไม่เปลี่ยน

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 9: ลูกหนี้บริษัทไฟแนนซ์ภายนอก (FinanceReceivableService.findAll)

**Files:**
- Modify: `apps/api/src/modules/finance-receivable/finance-receivable.service.ts` (`findAll` `:43-46` + import)
- Modify/Test: `apps/api/src/modules/finance-receivable/finance-receivable.service.spec.ts` (แทนเทสต์ `expands endDate to end-of-day so the bound is inclusive` บรรทัด 91-103)

**Interfaces:**
- Consumes: `reportDayStart(value: string): Date` · `reportDayEnd(value: string): Date`
- Produces: ไม่มี

**ที่มาของข้อบกพร่อง:** `FinanceReceivable.expectedDate` ของแถวที่ระบบสร้างเอง = `new Date()` + 7 วัน (เวลาจริงของวัน — `sale-writer.service.ts:433-445`) แถวที่พนักงานแก้วันคาดรับ = 07:00 น. ไทย · `gte new Date(startDate)` = 07:00 น. ไทย ⇒ แถวอัตโนมัติที่ตั้งตอน 00:00–06:59 น. หายจากวันเริ่ม (ความถี่ต่ำ) · ฝั่ง `lte` ใช้ `setHours` ซึ่งถูกตาม TZ ของโปรเซส · เทสต์เดิมใช้ `getHours()` (ขึ้นกับ TZ ของเครื่องที่รันเทสต์) จึงต้องเขียนใหม่ให้ปักอินสแตนซ์ ISO

- [ ] **Step 1: แก้เทสต์ให้ปักขอบไทย (ต้องล้ม)**

`apps/api/src/modules/finance-receivable/finance-receivable.service.spec.ts` — แทนเทสต์นี้ทั้งก้อน:

```ts
    it('expands endDate to end-of-day so the bound is inclusive', async () => {
      prisma.financeReceivable.findMany.mockResolvedValue([]);
      prisma.financeReceivable.count.mockResolvedValue(0);

      await service.findAll({ endDate: '2026-04-09' });

      const arg = prisma.financeReceivable.findMany.mock.calls[0][0];
      const lte = arg.where.expectedDate.lte as Date;
      expect(lte.getHours()).toBe(23);
      expect(lte.getMinutes()).toBe(59);
      expect(lte.getSeconds()).toBe(59);
    });
```

ด้วยสามเทสต์นี้ (อยู่ใน `describe('findAll', …)` เดิม ตำแหน่งเดิม):

```ts
    it('startDate = 00:00 น. ไทย · endDate = 23:59:59.999 น. ไทย (รวมทั้งวัน ไม่ขึ้นกับ TZ ของโปรเซส)', async () => {
      prisma.financeReceivable.findMany.mockResolvedValue([]);
      prisma.financeReceivable.count.mockResolvedValue(0);

      await service.findAll({ startDate: '2026-04-01', endDate: '2026-04-09' });

      const arg = prisma.financeReceivable.findMany.mock.calls[0][0];
      const range = arg.where.expectedDate as { gte: Date; lte: Date };
      expect(range.gte.toISOString()).toBe('2026-03-31T17:00:00.000Z');
      expect(range.lte.toISOString()).toBe('2026-04-09T16:59:59.999Z');
    });

    it('แถววันคาดรับ 00:00 น. ไทยของวันเริ่มอยู่ในช่วง · 00:00 น. ไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
      prisma.financeReceivable.findMany.mockResolvedValue([]);
      prisma.financeReceivable.count.mockResolvedValue(0);

      await service.findAll({ startDate: '2026-04-01', endDate: '2026-04-09' });

      const { gte, lte } = prisma.financeReceivable.findMany.mock.calls[0][0].where.expectedDate as {
        gte: Date;
        lte: Date;
      };
      const earlyMorningOnStartDay = new Date('2026-04-01T03:00:00+07:00');
      const eveningOnEndDay = new Date('2026-04-09T22:00:00+07:00');
      const nextMidnight = new Date('2026-04-10T00:00:00+07:00');
      expect(earlyMorningOnStartDay >= gte && earlyMorningOnStartDay <= lte).toBe(true);
      expect(eveningOnEndDay <= lte).toBe(true);
      expect(nextMidnight <= lte).toBe(false);
    });

    it('ส่งแค่ endDate = ใส่เฉพาะ lte · ส่งแค่ startDate = ใส่เฉพาะ gte', async () => {
      prisma.financeReceivable.findMany.mockResolvedValue([]);
      prisma.financeReceivable.count.mockResolvedValue(0);

      await service.findAll({ endDate: '2026-04-09' });
      expect(prisma.financeReceivable.findMany.mock.calls[0][0].where.expectedDate).toEqual({
        lte: new Date('2026-04-09T16:59:59.999Z'),
      });

      await service.findAll({ startDate: '2026-04-01' });
      expect(prisma.financeReceivable.findMany.mock.calls[1][0].where.expectedDate).toEqual({
        gte: new Date('2026-03-31T17:00:00.000Z'),
      });
    });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/finance-receivable/finance-receivable.service.spec.ts -t "findAll"
```

Expected: FAIL ทั้ง 3 เคสใหม่ — `gte` ได้ `2026-04-01T00:00:00.000Z` แทน `2026-03-31T17:00:00.000Z` (เคสที่ 3 ล้มที่ส่วน `startDate`; ส่วน `endDate` ผ่านเมื่อรันเครื่องที่ `TZ=Asia/Bangkok` และไม่ผ่านเมื่อเครื่องเป็น TZ อื่น — ตั้งใจ)

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/finance-receivable/finance-receivable.service.ts`

เพิ่ม import ต่อจากบรรทัด `import { ShopExternalFinanceReceiptTemplate } from '../journal/cpa-templates/shop-external-finance-receipt.template';`:

```ts
import { reportDayEnd, reportDayStart } from '../../utils/date.util';
```

```ts
// ก่อน
    if (startDate || endDate) {
      where.expectedDate = {};
      if (startDate) where.expectedDate.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.expectedDate.lte = end;
      }
    }

// หลัง
    if (startDate || endDate) {
      where.expectedDate = {};
      if (startDate) where.expectedDate.gte = reportDayStart(startDate);
      if (endDate) where.expectedDate.lte = reportDayEnd(endDate);
    }
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/finance-receivable
```

Expected: PASS ทั้งโมดูล

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/finance-receivable/finance-receivable.service.ts apps/api/src/modules/finance-receivable/finance-receivable.service.spec.ts
git commit -m "ลูกหนี้ไฟแนนซ์ภายนอก: กรองวันคาดรับเต็มวันตามเวลาไทย

เดิม startDate = 07:00 น. ไทย ตัดแถวที่ระบบตั้งวันคาดรับ (เวลาจริงของวัน) ช่วง 00:00-06:59 น. ของวันเริ่ม
เทสต์เดิมใช้ getHours() ขึ้นกับ TZ เครื่อง — เปลี่ยนเป็นปักอินสแตนซ์ ISO

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 10: ภ.ง.ด.1ก รายปี (TaxPreviewService.previewPnd1Annual)

**Files:**
- Modify: `apps/api/src/modules/tax/services/tax-preview.service.ts` (`previewPnd1Annual` `:971-972` + import)
- Create/Test: `apps/api/src/modules/tax/services/tax-preview.pnd1-annual-dates.spec.ts` (แบบจาก `tax-preview.input-vat.spec.ts` — `new TaxPreviewService(prisma as never)` + hand-built mock)

**Interfaces:**
- Consumes: `bangkokMidnight(year: number, month: number, day: number): Date` จาก `../../../utils/date.util` (month เป็น index 0-11 และ overflow ได้)
- Produces: ไม่มี

**ที่มาของข้อบกพร่อง:** ขอบปีใช้ `Date.UTC(year,0,1)` .. `Date.UTC(year,11,31,23,59,59,999)` = 07:00 น. ไทย 1 ม.ค. .. 06:59:59.999 น. ไทย 1 ม.ค. ปีถัดไป · ใบเงินเดือนที่จ่ายจริง (`paidAt` เป็นเวลาจริง) 00:00–06:59 น. ของ 1 ม.ค. ปี Y ถูกนับเข้าปี Y−1 และที่จ่าย 00:00–06:59 น. ของ 1 ม.ค. ปี Y+1 ถูกนับเข้าปี Y · `documentDate` ที่เป็น `YYYY-MM-DD` (07:00 น. ไทย) ของ 1 ม.ค. และ 31 ธ.ค. ยังอยู่ในปีเดิมทั้งก่อนและหลังแก้ (เทสต์ข้อสุดท้ายปัก) · ตัวเลขเปลี่ยนเฉพาะรายการที่จ่ายเที่ยงคืน–เจ็ดโมงเช้าของวันที่ 1 ม.ค. — `getDateRange(year, month)` รายเดือน (`:222-223`) ไม่แตะ ดู "ตรวจแล้วไม่ต้องแก้"

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/tax/services/tax-preview.pnd1-annual-dates.spec.ts`:

```ts
import { TaxPreviewService } from './tax-preview.service';

/**
 * ภ.ง.ด.1ก (previewPnd1Annual) — ขอบปีต้องเป็นปีปฏิทินไทย (2026-11-18)
 * เดิมใช้ Date.UTC(year,0,1) .. Date.UTC(year,11,31,23,59,59,999) = 07:00 น. ไทย 1 ม.ค. .. 06:59:59.999 น. ไทย 1 ม.ค. ปีถัดไป
 * ⇒ ใบเงินเดือนที่จ่าย (paidAt เป็นเวลาจริง) 00:00–06:59 น. ของ 1 ม.ค. ถูกนับเข้าปีก่อน
 * และที่จ่าย 00:00–06:59 น. ของ 1 ม.ค. ปีถัดไปถูกนับเข้าปีนี้
 * ตามแบบ tax-preview.input-vat.spec.ts (new TaxPreviewService(prisma) + hand-built prisma mock)
 */
describe('TaxPreviewService.previewPnd1Annual — ขอบปีปฏิทินไทย', () => {
  const START = new Date('2025-12-31T17:00:00.000Z'); // 00:00 น. ไทย 1 ม.ค. 2026
  const END = new Date('2026-12-31T16:59:59.999Z'); // 23:59:59.999 น. ไทย 31 ธ.ค. 2026

  function build() {
    const prisma = { expenseDocument: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new TaxPreviewService(prisma as never);
    return { service, prisma };
  }

  it('paidAt และ documentDate ใช้ช่วงเดียวกัน = 1 ม.ค. 00:00 น. ถึง 31 ธ.ค. 23:59:59.999 น. (เวลาไทย)', async () => {
    const { service, prisma } = build();
    await service.previewPnd1Annual(2026);
    const where = prisma.expenseDocument.findMany.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ paidAt: { gte: START, lte: END } });
    expect(where.OR[1]).toEqual({ paidAt: null, documentDate: { gte: START, lte: END } });
  });

  it('จ่ายเที่ยงคืนไทยของ 1 ม.ค. อยู่ในปีนั้น · จ่าย 23:59:59.999 น. ไทยของ 31 ธ.ค. ปีก่อนอยู่นอก · จ่ายเที่ยงคืนไทยของ 1 ม.ค. ปีถัดไปอยู่นอก', async () => {
    const { service, prisma } = build();
    await service.previewPnd1Annual(2026);
    const { gte, lte } = prisma.expenseDocument.findMany.mock.calls[0][0].where.OR[0].paidAt as {
      gte: Date;
      lte: Date;
    };
    const newYearMidnight = new Date('2026-01-01T00:00:00+07:00');
    const lastMomentOfPreviousYear = new Date('2025-12-31T23:59:59.999+07:00');
    const lastMomentOfYear = new Date('2026-12-31T23:59:59.999+07:00');
    const nextNewYearMidnight = new Date('2027-01-01T00:00:00+07:00');
    expect(newYearMidnight >= gte && newYearMidnight <= lte).toBe(true);
    expect(lastMomentOfYear >= gte && lastMomentOfYear <= lte).toBe(true);
    expect(lastMomentOfPreviousYear >= gte).toBe(false);
    expect(nextNewYearMidnight <= lte).toBe(false);
  });

  it('ใบเงินเดือนที่ลงวันที่จ่าย 07:00 น. ไทย (documentDate แบบ YYYY-MM-DD) ของ 1 ม.ค. และ 31 ธ.ค. ยังอยู่ในปีเดิม', async () => {
    const { service, prisma } = build();
    await service.previewPnd1Annual(2026);
    const { gte, lte } = prisma.expenseDocument.findMany.mock.calls[0][0].where.OR[1].documentDate as {
      gte: Date;
      lte: Date;
    };
    const firstDay = new Date('2026-01-01'); // 07:00 น. ไทย
    const lastDay = new Date('2026-12-31'); // 07:00 น. ไทย
    expect(firstDay >= gte && firstDay <= lte).toBe(true);
    expect(lastDay >= gte && lastDay <= lte).toBe(true);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/tax/services/tax-preview.pnd1-annual-dates.spec.ts
```

Expected: FAIL 2 เคส — `gte` ได้ `2026-01-01T00:00:00.000Z` แทน `2025-12-31T17:00:00.000Z` และ `lte` ได้ `2026-12-31T23:59:59.999Z` แทน `2026-12-31T16:59:59.999Z` · เคส `documentDate` 07:00 น. ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/tax/services/tax-preview.service.ts`

เพิ่ม import ต่อจากบรรทัด `import { PrismaService } from '../../../prisma/prisma.service';`:

```ts
import { bangkokMidnight } from '../../../utils/date.util';
```

```ts
// ก่อน
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

// หลัง
    const startDate = bangkokMidnight(year, 0, 1);
    const endDate = new Date(bangkokMidnight(year + 1, 0, 1).getTime() - 1);
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/tax
```

Expected: PASS ทั้งโมดูล (`payroll-tax-base.integration.spec.ts` / `payroll-shop-flow.integration.spec.ts` ใน `expense-documents/__tests__` ใช้ปี 2098/2099 และเอกสารกลางปี — เป็น DB spec รันใน CI)

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/tax/services/tax-preview.service.ts apps/api/src/modules/tax/services/tax-preview.pnd1-annual-dates.spec.ts
git commit -m "ภ.ง.ด.1ก รายปี: ขอบปีเป็น 00:00 น. 1 ม.ค. ถึง 23:59:59.999 น. 31 ธ.ค. ตามเวลาไทย

เดิมใช้ Date.UTC (07:00 น. ไทย) ใบเงินเดือนที่จ่ายเที่ยงคืน-เจ็ดโมงเช้าของ 1 ม.ค. ถูกนับผิดปี

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 11: รายงานอายุลูกหนี้หน้าร้าน — `asOf` (IntercoSettlementController.aging)

**Files:**
- Modify: `apps/api/src/modules/interco-settlement/interco-settlement.controller.ts` (เมธอด `aging` `:91` + import)
- Modify/Test: `apps/api/src/modules/interco-settlement/interco-settlement.controller.spec.ts` (describe `aging()` บรรทัด 230-260 — แก้เทสต์ `parses asOf to a Date…` + เพิ่มสองเคส)

**Interfaces:**
- Consumes: `reportAsOf(value: string): Date`
- Produces: ไม่มี

**ผลการตัดสิน UNSURE (`interco-settlement.controller.ts:91`) = BUG ระดับเบา:** `asOf` ไม่ได้กรองแถว — ใช้คำนวณ `ageDays = floor((asOf − oldestPostedAt) / 86,400,000)` เท่านั้น (`interco-aging.service.ts` `getShopReceivableAging` → `buildAllRows`) · `asOf='2026-11-18'` เดิม = 07:00 น. ไทย ⇒ รายการที่ลงบัญชีบ่ายของวันเดียวกัน (14:00 น.) ได้อายุ **−1 วัน** (ติดลบ) และทุกรายการอายุน้อยกว่าสิ้นวันสูงสุด 17 ชั่วโมง · ตัดสินใช้ **สิ้นวันไทย** (`reportAsOf`) เพราะ (1) รายงาน "ณ วันที่" อื่นทั้งระบบ (งบทดลอง · งบฐานะการเงิน · งบรวม) ตัดสิ้นวัน (2) อายุติดลบไม่มีความหมายทางธุรกิจ (3) หน้าเว็บ `IntercompanySettlementPage` ไม่ส่ง `asOf` (ค่าเริ่มต้น = ตอนนี้ ไม่เปลี่ยน) ⇒ กระทบเฉพาะการเรียก API ตรง · ถ้าเจ้าของต้องการ "ต้นวัน" แทน ดูหัวข้อ "ต้องให้เจ้าของตัดสิน" ข้อ 2 ก่อนลงมือ task นี้

- [ ] **Step 1: แก้/เพิ่มเทสต์ (ต้องล้ม)**

`apps/api/src/modules/interco-settlement/interco-settlement.controller.spec.ts` — แทนเทสต์นี้:

```ts
    it('parses asOf to a Date and thresholdDays to a number', async () => {
      await controller.aging('2026-08-21', '60');
      expect(agingService.getShopReceivableAging).toHaveBeenCalledWith(new Date('2026-08-21'), 60);
    });
```

ด้วยสามเทสต์นี้ (ตำแหน่งเดิมใน `describe('aging()', …)`; เทสต์ `rejects an invalid asOf…` ที่อยู่ถัดไปคงเดิมทุกตัวอักษร):

```ts
    it('asOf แบบ YYYY-MM-DD = สิ้นวันไทย (23:59:59.999 น.) · thresholdDays เป็นตัวเลข', async () => {
      await controller.aging('2026-08-21', '60');
      expect(agingService.getShopReceivableAging).toHaveBeenCalledWith(
        new Date('2026-08-21T16:59:59.999Z'),
        60,
      );
    });

    it('asOf แบบ ISO เต็ม = ตามที่ส่งมา (ไม่ปัดเป็นสิ้นวัน)', async () => {
      await controller.aging('2026-08-21T03:00:00.000Z', undefined);
      expect(agingService.getShopReceivableAging).toHaveBeenCalledWith(
        new Date('2026-08-21T03:00:00.000Z'),
        undefined,
      );
    });

    it('รายการที่ลงบัญชีบ่ายของวัน asOf ไม่ได้อายุติดลบ (เดิม asOf = 07:00 น. ⇒ −1 วัน)', async () => {
      await controller.aging('2026-08-21', undefined);
      const asOf = agingService.getShopReceivableAging.mock.calls[0][0] as Date;
      const postedAfternoon = new Date('2026-08-21T14:00:00+07:00');
      // สูตรเดียวกับ IntercoAgingService: floor((asOf − postedAt) / DAY_MS)
      expect(Math.floor((asOf.getTime() - postedAfternoon.getTime()) / 86_400_000)).toBe(0);
    });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/interco-settlement/interco-settlement.controller.spec.ts -t "aging"
```

Expected: FAIL 2 เคส — `asOf แบบ YYYY-MM-DD = สิ้นวันไทย…` (ได้ `2026-08-21T00:00:00.000Z`) และเคสอายุติดลบ (`Expected: 0 · Received: -1`) · เคส ISO เต็ม และเคส `rejects an invalid asOf…` ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/interco-settlement/interco-settlement.controller.ts`

เพิ่ม import ต่อจากบรรทัด `import { SettleRecallCashDto } from './dto/settle-recall-cash.dto';`:

```ts
import { reportAsOf } from '../../utils/date.util';
```

```ts
// ก่อน
    let asOfDate: Date | undefined;
    if (asOf !== undefined && asOf !== '') {
      asOfDate = new Date(asOf);
      if (Number.isNaN(asOfDate.getTime())) {
        throw new BadRequestException(
          'รูปแบบวันที่ (asOf) ไม่ถูกต้อง — ใช้รูปแบบ ISO เช่น 2026-08-21',
        );
      }
    }

// หลัง
    let asOfDate: Date | undefined;
    if (asOf !== undefined && asOf !== '') {
      const invalidAsOf = () =>
        new BadRequestException('รูปแบบวันที่ (asOf) ไม่ถูกต้อง — ใช้รูปแบบ ISO เช่น 2026-08-21');
      try {
        asOfDate = reportAsOf(asOf);
      } catch {
        // YYYY-MM-DD ที่ไม่มีจริงในปฏิทิน (เช่น 2026-99-99) — ตัวช่วยโยน 400 ข้อความกลาง; คงข้อความเดิมของ endpoint นี้
        throw invalidAsOf();
      }
      if (Number.isNaN(asOfDate.getTime())) {
        throw invalidAsOf();
      }
    }
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/interco-settlement/interco-settlement.controller.spec.ts
```

Expected: PASS ทั้งไฟล์ (รวมเทสต์ roles matrix — decorator ไม่ถูกแตะ)

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/interco-settlement/interco-settlement.controller.ts apps/api/src/modules/interco-settlement/interco-settlement.controller.spec.ts
git commit -m "รายงานอายุลูกหนี้หน้าร้าน: asOf แบบวันที่ = สิ้นวันไทย (เดิม 07:00 น. ทำให้รายการบ่ายของวันเดียวกันอายุ -1 วัน)

asOf ใช้คำนวณอายุเท่านั้น ไม่กรองแถว · ค่าที่เป็น ISO เต็มคงเดิม · ข้อความ 400 เดิมคงไว้

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 12: ส่งออกรายการบัญชีไป PEAK (PeakController.exportEntries)

**Files:**
- Modify: `apps/api/src/modules/peak/peak.controller.ts` (`exportEntries` `:31` + import)
- Create/Test: `apps/api/src/modules/peak/peak.controller.spec.ts` (ไม่มี controller spec ให้ลอกในโมดูลนี้ — ใช้ hand-built service mock แบบ `accounting.controller.report-dates.spec.ts`)

**Interfaces:**
- Consumes: `reportDayStart(value: string): Date` · `reportAsOf(value: string): Date` (ขอบสิ้นสุด — เดิมเป็น `new Date(dto.endDate)` เปล่า)
- Produces: ไม่มี

**ผลการตัดสิน UNSURE (`peak.controller.ts:31` → `PeakService.exportJournalEntries`) = BUG:** เปิดโค้ดแล้ว — `exportJournalEntries(startDate, endDate)` กรอง `JournalEntry.entryDate gte/lte` + `peakSyncedAt: null` + `companyId = FINANCE` · `entryDate` ของรายการที่ cron ลง (ตั้งลูกหนี้งวดรอบ 00:01 น. · ค่าเผื่อฯ 00:30 น. · ไล่ VAT 60 วัน) เป็นเวลาจริงหลังเที่ยงคืนไทย และรายการตั้งลูกหนี้งวด 2A ถูกประทับ 00:00 น. ไทยของวันครบกำหนดพอดี · controller ส่ง `new Date(dto.startDate)` = 07:00 น. ไทย (DTO เป็น `@IsDateString` ซึ่งรับ `YYYY-MM-DD`) ⇒ การส่งออกด้วยมือช่วงวันที่ข้ามรายการเหล่านี้ของวันเริ่ม และตัดทุกรายการหลัง 07:00 น. ของวันสิ้นสุด · cron รายวัน (`PeakSyncCron` — `yesterday 00:00 → now` ตามเวลาโปรเซส) ส่ง `Date` ตรงเข้า service ไม่ผ่าน controller จึงไม่ได้รับผลกระทบ (ตรวจแล้ว ไม่แตะ) · ไม่มีหน้าเว็บเรียก (latent)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/peak/peak.controller.spec.ts`:

```ts
import { PeakController } from './peak.controller';

/**
 * POST /peak/export — startDate/endDate 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิมใช้ new Date('YYYY-MM-DD') = 07:00 น. ไทยทั้งสองขอบ ⇒ รายการ 00:00–06:59 น. ของวันเริ่ม
 * (รายการตั้งลูกหนี้งวด / ค่าเผื่อฯ ที่ cron ลงหลังเที่ยงคืน) ไม่ถูกส่ง และทุกรายการหลัง 07:00 น. ของวันสิ้นสุดไม่ถูกส่ง
 * ขอบวันเขียนด้วย journalEntry.entryDate gte/lte ใน PeakService.exportJournalEntries (ไม่แก้ — รับ Date อยู่แล้ว)
 */
describe('PeakController.exportEntries — ช่วงวันที่', () => {
  const peakService = { exportJournalEntries: jest.fn().mockResolvedValue({ exported: 0, skipped: 0, errors: [] }) };
  const controller = new PeakController(peakService as never);

  beforeEach(() => jest.clearAllMocks());

  it('ช่วง = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await controller.exportEntries({ startDate: '2026-11-01', endDate: '2026-11-17' });
    const [from, to] = peakService.exportJournalEntries.mock.calls[0];
    expect(from.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-17T16:59:59.999Z');
  });

  it('รายการเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
    await controller.exportEntries({ startDate: '2026-11-01', endDate: '2026-11-17' });
    const [from, to] = peakService.exportJournalEntries.mock.calls[0];
    const accrual = new Date('2026-11-01T00:00:00+07:00');
    const nextMidnight = new Date('2026-11-18T00:00:00+07:00');
    expect(accrual >= from && accrual <= to).toBe(true);
    expect(nextMidnight <= to).toBe(false);
  });

  it('ค่าที่ไม่ใช่ YYYY-MM-DD (ISO เต็มที่ @IsDateString รับ) ผ่านไปตามที่ส่งมา ไม่ขยายเป็นสิ้นวัน', async () => {
    await controller.exportEntries({
      startDate: '2026-11-01T03:00:00.000Z',
      endDate: '2026-11-17T03:04:05.000Z',
    });
    const [from, to] = peakService.exportJournalEntries.mock.calls[0];
    expect(from.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-17T03:04:05.000Z');
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/peak/peak.controller.spec.ts
```

Expected: FAIL 2 เคส — `from` ได้ `2026-11-01T00:00:00.000Z` แทน `2026-10-31T17:00:00.000Z` · `to` ได้ `2026-11-17T00:00:00.000Z` แทน `2026-11-17T16:59:59.999Z` · เคสที่ 3 (ISO เต็มผ่านไปตามที่ส่งมา) ผ่านอยู่แล้วและต้องไม่แดงหลังแก้

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/peak/peak.controller.ts`

เพิ่ม import ต่อจากบรรทัด `import { Roles } from '../auth/decorators/roles.decorator';`:

```ts
import { reportAsOf, reportDayStart } from '../../utils/date.util';
```

```ts
// ก่อน
    return this.peakService.exportJournalEntries(new Date(dto.startDate), new Date(dto.endDate));

// หลัง
    // reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)
    return this.peakService.exportJournalEntries(reportDayStart(dto.startDate), reportAsOf(dto.endDate));
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/peak
```

Expected: PASS ทั้ง `peak.controller.spec.ts` · `peak.service.spec.ts` · `peak-sync.cron.spec.ts`

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/peak/peak.controller.ts apps/api/src/modules/peak/peak.controller.spec.ts
git commit -m "ส่งออกรายการบัญชีไป PEAK (POST /peak/export): ช่วงวันที่เต็มวันตามเวลาไทย

เดิมทั้งวันเริ่มและวันสิ้นสุดเป็น 07:00 น. ไทย ข้ามรายการที่ cron ลงหลังเที่ยงคืน (ตั้งลูกหนี้งวด/ค่าเผื่อฯ/VAT 60 วัน)
ของวันเริ่ม และตัดรายการหลัง 07:00 น. ของวันสิ้นสุด · cron รายวันส่ง Date ตรงเข้า service ไม่ได้รับผล

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 13: คำเตือนค่าปรับซ้ำของรายได้อื่น C14 — ขอบเดือน (ValidationService.checkLateFeeCollision)

**Files:**
- Modify: `apps/api/src/modules/other-income/services/validation.service.ts` (`checkLateFeeCollision` `:268-283` + import)
- Create/Test: `apps/api/src/modules/other-income/__tests__/validation.late-fee-month.spec.ts` (แบบจาก `validation.spec.ts` describe `C14 — checkLateFeeCollision`)

**Interfaces:**
- Consumes: `bangkokCalendarParts(date: Date): { year: number; month: number; day: number }` (month เป็น index 0-11) · `bangkokMidnight(year, month, day): Date`
- Produces: ไม่มี

**ที่มาของข้อบกพร่อง (พบจากรายการ "ที่ regex พลาด" ของการสแกนทั้ง API — โมดูล other-income):** C14 ค้นงวดที่มีค่าปรับในเดือนของ `issueDate` ด้วย `Payment.dueDate gte Date.UTC(y,m,1) / lte Date.UTC(y,m+1,0,23,59,59,999)` พร้อมคอมเมนต์ว่า "dueDate เก็บที่ 00:00 UTC" — **ไม่จริง**: `Payment.dueDate` ถูกเขียนที่ **00:00 น. ไทยของวันครบกำหนด** (= 17:00Z ของวันก่อนหน้า — `installment-schedule.util.ts` ใช้ `bangkokMidnight`, `installment.util.ts` anchor `Date.UTC(...) − 7h`) · ผล: งวดที่ครบกำหนด **วันที่ 1** ของเดือนนี้หลุดจากเดือนนี้ (ไปนับเดือนก่อน) และงวดที่ครบกำหนดวันที่ 1 ของเดือนหน้าถูกนับเข้าเดือนนี้ · ผลกระทบ = คำเตือนแบบอ่อน (ไม่บล็อกการบันทึก) แสดงผิดเดือนเป็นครั้งคราว · `y`/`m` ของ `issueDate` ใช้ `getFullYear/getMonth` ของโปรเซส (ถูกภายใต้ `TZ=Asia/Bangkok`) — เปลี่ยนเป็นปฏิทินไทยด้วย

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/other-income/__tests__/validation.late-fee-month.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ValidationService } from '../services/validation.service';

/**
 * C14 — checkLateFeeCollision: ขอบเดือนของ Payment.dueDate ต้องเป็นเดือนปฏิทินไทย (2026-11-18)
 * Payment.dueDate เก็บที่ 00:00 น. ไทยของวันครบกำหนด (= 17:00Z ของวันก่อนหน้า) ไม่ใช่ 00:00 UTC
 * เดิมใช้ Date.UTC เป็นขอบเดือน ⇒ งวดที่ครบกำหนดวันที่ 1 ของเดือนนี้หลุดจากเดือนนี้ (ไปนับเดือนก่อน)
 * และงวดที่ครบกำหนดวันที่ 1 ของเดือนหน้าถูกนับเข้าเดือนนี้
 * ตามแบบ validation.spec.ts (describe C14) — hand-built prisma mock ที่ payment.findFirst
 */
describe('C14 — checkLateFeeCollision: ขอบเดือนตามปฏิทินไทย', () => {
  const customerId = '11111111-1111-1111-1111-111111111111';
  const items = [{ lineNo: 1, accountCode: '42-1103' }];

  async function build() {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prismaMock = { payment: { findFirst } } as unknown as PrismaService;
    const module = await Test.createTestingModule({
      providers: [ValidationService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    return { service: module.get(ValidationService), findFirst };
  }

  const dueDateOf = (findFirst: jest.Mock) => findFirst.mock.calls[0][0].where.dueDate;

  it('issueDate พ.ค. 2026 → dueDate ตั้งแต่ 00:00 น. ไทย 1 พ.ค. จนถึงก่อน 00:00 น. ไทย 1 มิ.ย.', async () => {
    const { service, findFirst } = await build();
    await service.checkLateFeeCollision(customerId, new Date('2026-05-14T03:00:00.000Z'), items);
    expect(dueDateOf(findFirst)).toEqual({
      gte: new Date('2026-04-30T17:00:00.000Z'),
      lt: new Date('2026-05-31T17:00:00.000Z'),
    });
  });

  it('งวดที่ครบกำหนด 1 พ.ค. (00:00 น. ไทย) อยู่ในเดือน · งวดที่ครบกำหนด 1 มิ.ย. (00:00 น. ไทย) อยู่นอกเดือน', async () => {
    const { service, findFirst } = await build();
    await service.checkLateFeeCollision(customerId, new Date('2026-05-14T03:00:00.000Z'), items);
    const { gte, lt } = dueDateOf(findFirst) as { gte: Date; lt: Date };
    const dueOnFirstOfMay = new Date('2026-05-01T00:00:00+07:00');
    const dueOnLastOfMay = new Date('2026-05-31T00:00:00+07:00');
    const dueOnFirstOfJune = new Date('2026-06-01T00:00:00+07:00');
    expect(dueOnFirstOfMay >= gte && dueOnFirstOfMay < lt).toBe(true);
    expect(dueOnLastOfMay >= gte && dueOnLastOfMay < lt).toBe(true);
    expect(dueOnFirstOfJune < lt).toBe(false);
  });

  it('issueDate 01:00 น. ไทยของ 1 มิ.ย. (= 31 พ.ค. 18:00Z) นับเป็นเดือนมิถุนายน ไม่ขึ้นกับ TZ ของโปรเซส', async () => {
    const { service, findFirst } = await build();
    await service.checkLateFeeCollision(customerId, new Date('2026-05-31T18:00:00.000Z'), items);
    expect(dueDateOf(findFirst)).toEqual({
      gte: new Date('2026-05-31T17:00:00.000Z'),
      lt: new Date('2026-06-30T17:00:00.000Z'),
    });
  });

  it('ข้อความเตือนยังระบุเดือนตามปฏิทินไทย', async () => {
    const { service, findFirst } = await build();
    findFirst.mockResolvedValue({
      id: 'p1',
      installmentNo: 4,
      lateFee: { toString: () => '50' },
      dueDate: new Date('2026-05-04T17:00:00.000Z'),
    });
    const warnings = await service.checkLateFeeCollision(customerId, new Date('2026-05-31T18:00:00.000Z'), items);
    expect(warnings[0].msg).toMatch(/งวด 2026-06/);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/other-income/__tests__/validation.late-fee-month.spec.ts
```

Expected: FAIL 3 เคส — `dueDate` ได้ `{ gte: 2026-05-01T00:00:00.000Z, lte: 2026-05-31T23:59:59.999Z }` แทน `{ gte: 2026-04-30T17:00:00.000Z, lt: 2026-05-31T17:00:00.000Z }` · เคส "ข้อความเตือนยังระบุเดือนตามปฏิทินไทย" ผ่านอยู่แล้วเมื่อรันเครื่องที่ `TZ=Asia/Bangkok`

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/other-income/services/validation.service.ts`

เพิ่ม import ต่อจากบรรทัด `import { PrismaService } from '../../../prisma/prisma.service';`:

```ts
import { bangkokCalendarParts, bangkokMidnight } from '../../../utils/date.util';
```

```ts
// ก่อน
    // BKK month bounds for issueDate
    // We compare against Payment.dueDate (the installment's billing month),
    // which is the field used by PaymentReceipt2BTemplate to attach lateFee
    // to 42-1103. We use UTC-month bounds here because Payment.dueDate values
    // are stored as the contract's installment due-day at 00:00 UTC, which
    // already lines up with BKK calendar months for all production data.
    const y = issueDate.getFullYear();
    const m = issueDate.getMonth();
    const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));

    const colliding = await this.prisma.payment.findFirst({
      where: {
        contract: { customerId },
        lateFee: { gt: 0 },
        dueDate: { gte: monthStart, lte: monthEnd },
        deletedAt: null,
      },

// หลัง
    // เดือนปฏิทินไทยของ issueDate เทียบกับ Payment.dueDate (งวดที่ผูกค่าปรับเข้า 42-1103 ผ่าน PaymentReceipt2BTemplate)
    // Payment.dueDate เก็บที่ 00:00 น. ไทยของวันครบกำหนด (ไม่ใช่ 00:00 UTC) ⇒ ขอบเดือนต้องเป็นเที่ยงคืนไทย
    const { year: y, month: m } = bangkokCalendarParts(issueDate);
    const monthStart = bangkokMidnight(y, m, 1);
    const nextMonthStart = bangkokMidnight(y, m + 1, 1);

    const colliding = await this.prisma.payment.findFirst({
      where: {
        contract: { customerId },
        lateFee: { gt: 0 },
        dueDate: { gte: monthStart, lt: nextMonthStart },
        deletedAt: null,
      },
```

(บรรทัดที่ใช้ `y` / `m` ต่อมา — `const monthLabel = \`${y}-${String(m + 1).padStart(2, '0')}\`` — คงเดิม: ตอนนี้ `y`/`m` มาจากปฏิทินไทย)

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/other-income/__tests__/validation
```

Expected: PASS ทั้ง `validation.late-fee-month.spec.ts` และ `validation.spec.ts` (เคส C14 เดิมตรวจเฉพาะ `customerId` / `lateFee` / `deletedAt` ไม่ตรวจขอบ `dueDate`)

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/other-income/services/validation.service.ts apps/api/src/modules/other-income/__tests__/validation.late-fee-month.spec.ts
git commit -m "รายได้อื่น C14 (คำเตือนค่าปรับซ้ำ): ขอบเดือนของ Payment.dueDate เป็นเที่ยงคืนไทย

dueDate เก็บที่ 00:00 น. ไทย ไม่ใช่ 00:00 UTC — ขอบเดือนแบบ Date.UTC ทำให้งวดที่ครบกำหนดวันที่ 1 นับผิดเดือน
คำเตือนยังเป็นแบบอ่อน ไม่บล็อกการบันทึก

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 14 (เว็บ): ตัวกรองวันที่ของหน้าประวัติสินทรัพย์รายตัว (AssetAuditPage)

**Files:**
- Create: `apps/web/src/pages/assets/utils/auditDateFilter.ts`
- Modify: `apps/web/src/pages/assets/AssetAuditPage.tsx` (ฟังก์ชัน `filtered` ใน `useMemo` บรรทัด 62-73 + import)
- Modify: `apps/web/package.json` (`version`: `26.11.11` → `26.11.12`)
- Test: `apps/web/src/pages/assets/__tests__/auditDateFilter.test.ts` (ใหม่ — ที่ตั้งและรูปแบบ Vitest ตาม `AssetAuditPage.global.test.tsx` ในโฟลเดอร์เดียวกัน; เป็นเทสต์ฟังก์ชันล้วน ไม่ต้อง render หน้า)

**Interfaces:**
- Consumes: `toBangkokDateString(d?: Date): string` จาก `@/lib/date` (วันปฏิทินไทยของ instant เป็น `YYYY-MM-DD` ไม่ขึ้นกับ TZ ของเบราว์เซอร์)
- Produces: `isAuditLogInDayRange(createdAt: string, fromDate: string, toDate: string): boolean` — `fromDate` / `toDate` เป็น `YYYY-MM-DD` หรือสตริงว่าง (= ไม่กรองขอบนั้น)

**ผลตรวจ (เปิดโค้ดแล้ว) = BUG จริง:** หน้านี้มีสองโหมด — โหมดรวม (`/assets/audit`) ให้ server กรอง (แก้แล้วที่ Task 7) แต่โหมดรายตัว (`/assets/:id/audit`) ดึง 100 รายการล่าสุดแล้วกรองฝั่ง client ด้วย `new Date(log.createdAt) < new Date(fromDate)` · `ThaiDateInput` ส่งค่า `YYYY-MM-DD` (ตรวจ `ThaiDateInput.tsx`: `value: string; // YYYY-MM-DD (CE)`) และ `new Date('YYYY-MM-DD')` = 00:00 UTC = 07:00 น. ไทย ⇒ รายการ 00:00–06:59 น. ไทยของวันเริ่มถูกซ่อน · ขอบสิ้นสุดใช้ `end = new Date(toDate); end.setHours(23,59,59,999)` ซึ่งเป็นสิ้นวันตาม **TZ ของเบราว์เซอร์** ไม่ใช่เวลาไทย (ผิดบนเครื่องที่ไม่ได้ตั้งเขตเวลาไทย) · แก้โดยเทียบ `toBangkokDateString(createdAt)` กับสตริง `YYYY-MM-DD` ตรง ๆ (เปรียบเทียบสตริงรูปแบบนี้ตามลำดับตัวอักษร = ลำดับวัน)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/web/src/pages/assets/__tests__/auditDateFilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isAuditLogInDayRange } from '../utils/auditDateFilter';

/**
 * ตัวกรองวันที่ฝั่ง client ของหน้าประวัติสินทรัพย์รายตัว (/assets/:id/audit) — วันที่จากช่องเลือกเป็น 'YYYY-MM-DD'
 * = วันตามปฏิทินไทย เทียบกับวันไทยของ createdAt (ไม่ขึ้นกับ TZ ของเบราว์เซอร์)
 * เดิม: new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ รายการ 00:00–06:59 น. ของวันเริ่มถูกซ่อน
 * และขอบสิ้นสุดใช้ setHours ตาม TZ ของเบราว์เซอร์
 */
describe('isAuditLogInDayRange', () => {
  it('รายการ 00:30 น. ไทยของวันเริ่มอยู่ในช่วง (เดิมถูกซ่อน)', () => {
    expect(isAuditLogInDayRange('2026-11-01T00:30:00+07:00', '2026-11-01', '')).toBe(true);
    expect(isAuditLogInDayRange('2026-10-31T17:30:00.000Z', '2026-11-01', '')).toBe(true);
  });

  it('รายการ 23:59:59.999 น. ไทยของวันก่อนวันเริ่มอยู่นอกช่วง', () => {
    expect(isAuditLogInDayRange('2026-10-31T23:59:59.999+07:00', '2026-11-01', '')).toBe(false);
  });

  it('รายการ 23:30 น. ไทยของวันสิ้นสุดอยู่ในช่วง · 00:00 น. ไทยของวันถัดไปอยู่นอกช่วง', () => {
    expect(isAuditLogInDayRange('2026-11-17T23:30:00+07:00', '', '2026-11-17')).toBe(true);
    expect(isAuditLogInDayRange('2026-11-18T00:00:00+07:00', '', '2026-11-17')).toBe(false);
  });

  it('วันเดียว (เริ่ม = สิ้นสุด) ได้ทั้งวันไทย', () => {
    expect(isAuditLogInDayRange('2026-11-17T00:00:00+07:00', '2026-11-17', '2026-11-17')).toBe(true);
    expect(isAuditLogInDayRange('2026-11-17T23:59:59.999+07:00', '2026-11-17', '2026-11-17')).toBe(true);
    expect(isAuditLogInDayRange('2026-11-18T00:00:00+07:00', '2026-11-17', '2026-11-17')).toBe(false);
  });

  it('ไม่เลือกวันที่ = ผ่านทั้งหมด', () => {
    expect(isAuditLogInDayRange('2026-11-17T12:00:00+07:00', '', '')).toBe(true);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/web" && npx vitest run src/pages/assets/__tests__/auditDateFilter.test.ts
```

Expected: FAIL — `Failed to resolve import "../utils/auditDateFilter"` (ยังไม่มีไฟล์ตัวช่วย) · หลังสร้างไฟล์ตัวช่วยแต่ก่อนแก้ตรรกะ (ถ้าลองคำนวณด้วยสูตรเดิม `new Date(fromDate)`) เคสแรก `รายการ 00:30 น. ไทยของวันเริ่ม` จะได้ `false`

- [ ] **Step 3: แก้โค้ด**

สร้าง `apps/web/src/pages/assets/utils/auditDateFilter.ts`:

```ts
import { toBangkokDateString } from '@/lib/date';

/**
 * กรองประวัติสินทรัพย์รายตัวตามช่วงวันที่ (ฝั่ง client) — `fromDate` / `toDate` เป็น 'YYYY-MM-DD' = วันตามปฏิทินไทย
 * เทียบกับวันไทยของ `createdAt` ตรง ๆ ไม่สร้าง Date จากสตริงวันที่ (ไม่ขึ้นกับ TZ ของเบราว์เซอร์)
 */
export function isAuditLogInDayRange(createdAt: string, fromDate: string, toDate: string): boolean {
  const day = toBangkokDateString(new Date(createdAt));
  if (fromDate && day < fromDate) return false;
  if (toDate && day > toDate) return false;
  return true;
}
```

`apps/web/src/pages/assets/AssetAuditPage.tsx`

เพิ่ม import ต่อจากบรรทัด `import AssetHubTabs from './components/AssetHubTabs';`:

```ts
import { isAuditLogInDayRange } from './utils/auditDateFilter';
```

```ts
// ก่อน
      if (actionFilter && log.action !== actionFilter) return false;
      if (fromDate && new Date(log.createdAt) < new Date(fromDate)) return false;
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        if (new Date(log.createdAt) > end) return false;
      }
      return true;

// หลัง
      if (actionFilter && log.action !== actionFilter) return false;
      return isAuditLogInDayRange(log.createdAt, fromDate, toDate);
```

`apps/web/package.json`:

```json
// ก่อน
  "version": "26.11.11",
// หลัง
  "version": "26.11.12",
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/web" && npx vitest run src/pages/assets
cd "/d/BESTCHOICE APP/BESTCHOICE" && ./tools/check-types.sh web
```

Expected: vitest PASS ทั้งโฟลเดอร์ `src/pages/assets` (รวม `AssetAuditPage.global.test.tsx` ที่ไม่ได้แตะโหมดรวม) · type check 0 errors

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/web/src/pages/assets/utils/auditDateFilter.ts apps/web/src/pages/assets/AssetAuditPage.tsx apps/web/src/pages/assets/__tests__/auditDateFilter.test.ts apps/web/package.json
git commit -m "ประวัติสินทรัพย์รายตัว: กรองช่วงวันที่ตามวันปฏิทินไทย (เว็บ 26.11.12)

เดิมเทียบกับ new Date('YYYY-MM-DD') = 07:00 น. ไทย ซ่อนรายการ 00:00-06:59 น. ของวันเริ่ม
และขอบสิ้นสุดนับตามเขตเวลาของเบราว์เซอร์ — เปลี่ยนเป็นเทียบ toBangkokDateString กับสตริงวันที่

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

## ตรวจรวมก่อนเปิด PR

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api"
NODE_OPTIONS=--max-old-space-size=8192 npx jest src/utils src/modules/accounting src/modules/journal/journal.service src/modules/inter-company src/modules/asset/__tests__/asset-report-dates.spec.ts src/modules/asset/__tests__/asset-lifecycle.dispose-date.spec.ts src/modules/finance-receivable src/modules/tax src/modules/interco-settlement/interco-settlement.controller.spec.ts src/modules/peak src/modules/other-income/__tests__/validation src/modules/reports
cd "/d/BESTCHOICE APP/BESTCHOICE" && ./tools/check-types.sh api
git diff --stat feat/finance-trial-balance...HEAD -- apps/api/src/modules/employee-access/access-policy.manifest.json
git diff -U0 feat/finance-trial-balance...HEAD -- apps/api/src | grep -E "^[+-].*@(Get|Post|Put|Patch|Delete|Roles|UseGuards)\("
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/web" && npx vitest run src/pages/assets
cd "/d/BESTCHOICE APP/BESTCHOICE" && ./tools/check-types.sh web
```

Expected: jest PASS ทั้งหมด · type check 0 errors · diff ของ manifest ว่าง · คำสั่ง grep ตรวจ decorator ที่เพิ่ม/ลบ ไม่แสดงอะไร · vitest ของเว็บ PASS · type check เว็บ 0 errors · เทสต์ DB ที่เกี่ยวข้อง (`asset-journal.service.spec.ts` · `asset.service.spec.ts` · `payroll-tax-base.integration.spec.ts` · `payroll-shop-flow.integration.spec.ts`) รันใน CI

## ตรวจแล้วไม่ต้องแก้

ห้ามมีใคร "แก้" รายการเหล่านี้ภายหลังโดยไม่อ่านเหตุผล — ทุกแถวเปิดโค้ดตรวจแล้ว

| ที่ | ผลตรวจ | เหตุผล |
|---|---|---|
| **A1** `accounting.controller.ts:127` `getAgingReport` (`GET /expenses/ledger/aging?asOf`) | **แก้แล้วใน final-review fix** | ผลลัพธ์เท่ากันสำหรับ `Payment.dueDate` ที่ระบบเขียน (00:00 น. ไทยเสมอ) จึงเดิมถูกจัดเป็น "ไม่ต้องแก้" · แต่เปลี่ยนเป็น `reportAsOf(asOf)` เพื่อให้ regression guard ของแผน ค ไม่ต้องมีข้อยกเว้น (ไม่เปลี่ยนผลสำหรับ due date ของระบบ · ค่าที่ไม่ใช่ `YYYY-MM-DD` ผ่านตามเดิม) · เทส: `accounting.controller.range-dates.spec.ts` |
| `accounting/monthly-close.service.ts:316-317,556-557` (`syncToPeak`, `runDataAudit`) · `:655` `getBalanceSheet(asOfDate)` · `:656` `previewPP30` | OK | ขอบมาจาก `periodStart/periodEnd` (`bangkokMidnight`) อยู่แล้ว · งบฐานะการเงินตัดสิ้นวันด้วย `setHours` ถูกภายใต้ `TZ=Asia/Bangkok` · `previewPP30` ใช้ขอบเดือนไทย (`pp30MonthRange`) |
| `accounting/transactional-report.service.ts:408-409,450-451` `getMonthlyPLSummary` · `:589-590` `getBalanceSheet` | OK (ขึ้นกับ TZ ของโปรเซส) | ใช้ปี/เดือนเป็นเลขจำนวนเต็มและ `new Date(y,m,d)` / `setHours(23,59,59,999)` ซึ่งเท่ากับขอบไทยเมื่อ `TZ=Asia/Bangkok` (`app.setup.ts:20` ตั้งไม่มีเงื่อนไข) · ไม่มีหน้าเว็บส่งสตริงวันที่ (`/reports/balance-sheet` ไม่มีผู้เรียกเว็บ) |
| `accounting/general-ledger-report.service.ts:1018` ต้นปีของงบส่วนของผู้ถือหุ้น | OK (ขึ้นกับ TZ) | `new Date(periodEnd.getFullYear(),0,1)` — `periodEnd` มาจาก `reportDayEnd` ของ controller อยู่แล้ว ปีตามเวลาโปรเซสเท่ากับปีไทยเมื่อ `TZ=Asia/Bangkok` |
| `accounting/consolidated.service.ts` `getConsolidatedDashboard` `monthStart = new Date(now.getFullYear(), now.getMonth(), 1)` | OK (ขึ้นกับ TZ) | สิ้นวันไทยของ `asOf` ยังอยู่เดือนเดียวกันทั้งกรณี UTC และ Bangkok — Task 2 เปลี่ยนเฉพาะ `asOf` ที่ controller |
| `journal/journal.service.ts:57,87` `create` (writer) | OK | `entryDate = new Date(dto.entryDate)` เป็นการเขียน ไม่ใช่ตัวกรอง (07:00 น. ไทยของวันที่ที่ระบุ — ถูกต้องตามกติกาข้อมูลเดิม) |
| `interco-settlement.controller.ts:222` `approveBatch(postedAt)` · `service:482,575` `transferDate` | OK | writer — `postedAt` ที่ส่งเป็น `YYYY-MM-DD` ถูกเก็บที่ 07:00 น. ไทย (เป็นแบบแผนของ `postedAt` ที่เลือกวันเอง) |
| `asset/services/asset-query.service.ts:165` `getRegister` · `asset-reports.service.ts:38` `summary` (`asOfDate`) | OK | ตัวกรอง `purchaseDate lte asOf` / `disposalDate` — ทั้งสองคอลัมน์ถูกเขียนที่ 07:00 น. ไทยของวันที่เลือก = ค่าเดียวกับ `asOfDate` และรวมขอบแล้ว (`lte`) · เปลี่ยนเป็น `reportAsOf` จะเท่ากันทุกแถวที่ระบบเขียนเอง จึงไม่แตะ |
| `asset/asset-transfer.service.ts:254-258` `listAllTransfers` · `:65-74` ด่าน `transferDate ≤ วันนี้` | OK | `transferDate` เขียนที่ 07:00 น. ไทยของวันที่เลือก · ขอบสิ้นวันใช้ `setHours` ตามโปรเซส · ด่านอนาคตเทียบ `todayEnd = setHours(23,59,59,999)` ไม่มีช่วงที่ปฏิเสธ "วันนี้" |
| `other-income/services/other-income-report.service.ts:25-60` `dailySheet` | OK | ใช้ `[gte start, lt end+1d)` แบบ `bangkokDateRange` อยู่แล้ว |
| `other-income` list `:217-218` (`GET /other-income?startDate&endDate`) | OK (ขึ้นกับผู้เขียน) | `issueDate` เขียนที่ 07:00 น. ไทยทุกทางที่ใช้งานจริง ⇒ `gte`/`lte` แบบเดิมรวมขอบทั้งสองข้าง · `createDraftForRepair` เขียนเวลาจริงแต่ไม่มีผู้เรียกจริง — ถ้าต่อสายภายหลัง ให้แก้ตอนนั้น |
| `finance-receivable.service.ts:123,187` `receive` (writer) | OK | `receivedDate = new Date(dto.receivedDate)` เป็นการเขียน |
| `expense-documents/services/expense-document-query.service.ts:103-107,159-163,225-229,403-406` (`list` · `getSummary` · `getTaxDisallowedSummary` · `getDailySummary`) | OK (ขึ้นกับผู้เขียน/TZ) | `documentDate` เขียนที่ 07:00 น. ไทย (หรือ 12:00 น. ของบิลประจำ) ⇒ `gte`/`lte` แบบเดิมรวมทั้งวัน · `getDailySummary` ใช้ `setHours(0,0,0,0)`/`(23,59,59,999)` ตามโปรเซส |
| `tax/services/tax-preview.service.ts:222-223` `getDateRange(year, month)` (PP30 · ภ.ง.ด.3/53 · เงินเดือน · ภ.ง.ด.2 · ปกส.) | OK (ขึ้นกับ TZ) | `new Date(y, m-1, 1)` / `new Date(y, m, 0, 23,59,59,999)` = เดือนไทยเมื่อ `TZ=Asia/Bangkok` · รับเลขปี/เดือน ไม่ใช่สตริงวันที่ |
| `tax/tax.controller.ts:151,162` `payDate` | OK | writer (`new Date(dto.payDate)`) |
| `finance-tax/finance-tax.service.ts:39-42` `buildPeriod` · `:90` | OK (ขึ้นกับ TZ) | ขอบเดือน `new Date(y,m-1,1)` / `(y,m,1)` และ `pp30MonthRange` · `finance-tax.service.spec.ts:150-151` ฝังค่า `…T17:00:00.000Z` จึงเขียวเฉพาะเครื่องที่ `TZ=Asia/Bangkok` (jest ไม่ pin TZ) — เป็นข้อสังเกตของเทสต์ ไม่ใช่บั๊กโค้ด |
| `peak/peak-sync.cron.ts:34` ช่วง `เมื่อวาน 00:00 → ตอนนี้` | OK (ขึ้นกับ TZ) | ใช้ `setDate` / `setHours(0,0,0,0)` ตามโปรเซสซึ่งเป็นเวลาไทย · ส่ง `Date` ตรงเข้า service · กรองซ้ำด้วย `peakSyncedAt: null` |
| `GET /reports/quarterly` — `reports.service.ts:200` `new Date(year, endMonth, 0).toISOString().split('T')[0]` | นอกขอบเขตแผน ก | อยู่ใต้ `reports/` (แผนอื่นเป็นเจ้าของ) · ตามรายงานตรวจ ได้วันสิ้นไตรมาสถอยหลังหนึ่งวันแล้วส่งเข้า `getProfitLossReport` — Task 3 ไม่แก้และไม่ทำให้แย่ลง |

## ตามต่อ (นอกขอบเขตแผนนี้)

- สมุดรายวันทั่วไป (`general-ledger-report.service.ts` ~:1188) และรายงานหนี้สูญ (`receivables-report.service.ts` ~:104) กรองด้วย `postedAt` ขณะที่รายงานอื่น (งบทดลอง · ส่งออก PEAK) กรองด้วย `entryDate` ⇒ รายการที่ลงย้อนวันอาจโผล่ต่างเดือนกันระหว่างสมุดรายวันกับงบทดลอง/PEAK · จะให้สมุดรายวันใช้วันที่ลงรายการหรือไม่เป็นการตัดสินใจทางธุรกิจ

## ต้องให้เจ้าของตัดสิน

1. **สแนปช็อตงบที่เก็บไว้แล้วของงวดที่ปิดไปก่อน deploy (Task 3 + 4)**
   - **ตัวเลือก ก (ค่าตั้งต้นของแผน):** ไม่แตะ — งวดที่ปิดแล้วเก็บ `trialBalance` ที่ตัด 07:00 น. ของวันสุดท้ายและ `profitLoss` ที่เริ่ม 07:00 น. ของวันที่ 1 ตามเดิม · ตัวเลขใหม่เริ่มที่งวดแรกที่ปิดหลัง deploy
   - **ตัวเลือก ข:** ให้ฝ่ายบัญชีเปิดงวดกลับ (`reopenPeriod`) แล้วปิดใหม่ทีละงวดเมื่อต้องการสแนปช็อตใหม่ — ทำได้เฉพาะงวดที่ยังเป็น `CLOSED` (งวด `SYNCED` ที่ส่ง PEAK แล้วเปิดไม่ได้ตามคำตัดสินเจ้าของ #23) · ไม่มีสคริปต์ในแผนนี้ และการเปิด–ปิดงวดเป็นการตัดสินใจทางบัญชีของฝั่งบัญชี
2. **ความหมายของ `asOf` แบบวันที่ในรายงานอายุลูกหนี้หน้าร้าน (Task 11)** — แผนตัดสินให้เป็น **สิ้นวันไทย** (เหมือนงบ "ณ วันที่" อื่นทั้งระบบ · อายุไม่ติดลบ) · หน้าเว็บไม่ส่ง `asOf` จึงไม่มีผลที่มองเห็น · ถ้าเจ้าของต้องการ "ต้นวัน" (07:00 น./00:00 น.) ให้บอกก่อนลงมือ Task 11 (ถ้าเลือกต้นวัน ต้องไม่ใช่ 07:00 น. — ใช้ 00:00 น. ไทยด้วย `reportDayStart` และยอมให้รายการที่ลงบัญชีหลังเที่ยงคืนของวันนั้นมีอายุติดลบหนึ่งวัน)

## ผลต่อผู้ใช้

เมื่อทำครบทุก task ตัวเลขในหน้าต่าง ๆ จะ **นับครบทั้งวันตามเวลาไทย** — ไม่มีหน้าจอใหม่ ไม่มีปุ่มใหม่ ไม่เปลี่ยนสิทธิ์ใครเข้าเมนูใด

**เจ้าของ / ผจก.การเงิน / ฝ่ายบัญชีจะเห็นตัวเลขเปลี่ยนในหน้าเหล่านี้** (เมื่อเลือกช่วงวันที่):
- **รายงานหนี้สูญ** และ **สมุดรายวันทั่วไป** — เดิมวันเริ่มข้ามรายการเช้ามืด (รวมรายการตั้งลูกหนี้ค่างวดที่ระบบลงเที่ยงคืนวันครบกำหนด) และวันสิ้นสุด (ปกติ = วันนี้) เห็นเฉพาะรายการก่อน 07:00 น. ⇒ ตอนนี้เห็นรายการของวันสิ้นสุดครบทั้งวัน และรายการเที่ยงคืนของวันเริ่ม
- **รายงานเจ้าหนี้ระหว่างกิจการ** — ยอดยกมา / เคลื่อนไหวระหว่างงวด / ยอดคงเหลือปลายงวดเปลี่ยน: รายการเที่ยงคืนของวันเริ่มย้ายจาก "ยอดยกมา" ไปเป็น "ระหว่างงวด" และรายการของวันสิ้นสุดหลัง 07:00 น. เข้ามาครบ
- **งบกำไรขาดทุน (จากยอดขาย)** · **กระแสเงินสด** · เปรียบเทียบรายเดือน (MoM/YoY ในแดชบอร์ดผู้บริหาร) · รายไตรมาส — วันแรกของช่วงนับใบขาย/การรับชำระ/ค่าใช้จ่ายตั้งแต่เที่ยงคืน (เดิมเริ่ม 07:00 น.) ยอดวันที่ 1 ของเดือนสูงขึ้นเล็กน้อยถ้ามีรายการเช้ามืด
- **ประวัติ audit และสมุดรายวันของสินทรัพย์ถาวร** · **ลูกหนี้บริษัทไฟแนนซ์ภายนอก (กรองวันคาดรับ)** — วันเริ่มรวมรายการเช้ามืด
- **ภ.ง.ด.1ก รายปี** — ใบเงินเดือนที่จ่ายเที่ยงคืนถึงตีหกห้าสิบเก้าของวันที่ 1 ม.ค. ย้ายเข้าปีที่ถูกต้อง (ผลน้อยมาก — ส่วนใหญ่จ่ายในเวลาทำการ)
- **ปิดงวดบัญชี** — งบทดลองที่เก็บในงวดที่ปิดหลังจากนี้จะรวมรายการหลัง 07:00 น. ของวันสุดท้ายเดือนครบ และ P&L ที่เก็บเริ่มนับตั้งแต่เที่ยงคืนวันที่ 1 · **งวดที่ปิดไปแล้วไม่ถูกแก้** (ดู "ต้องให้เจ้าของตัดสิน" ข้อ 1)
- **ประวัติสินทรัพย์รายตัว (หน้า /assets/:id/audit) ตัวกรองวันที่** — รายการ 00:00–06:59 น. ของวันเริ่มไม่ถูกซ่อนอีก และวันสิ้นสุดนับตามเวลาไทยแม้เบราว์เซอร์ตั้งเขตเวลาอื่น (เว็บ 26.11.12)
- **ตัดจำหน่ายสินทรัพย์ถาวร** — ทำรายการ "จำหน่ายวันนี้" ได้ตลอดวัน รวมช่วง 00:00–06:59 น. (เดิมระบบตอบว่าเป็นวันในอนาคต)
- **ส่งออกรายการบัญชีไป PEAK ด้วยมือ (OWNER)** และ **คำเตือนค่าปรับซ้ำของรายได้อื่น** — ส่งออกรวมรายการของวันเริ่ม/วันสิ้นสุดครบ · คำเตือนนับงวดที่ครบกำหนดวันที่ 1 เข้าเดือนที่ถูกต้อง

**ที่ยังไม่มีหน้าจอเรียกใช้ (ยังไม่เห็นผล แต่แก้แล้ว):** งบรวม SHOP+FINANCE · `/journal-entries` · `/inter-company` (รายการและสรุปกำไร) · `/reports/cash-flow` ตรง · อายุลูกหนี้หน้าร้านแบบระบุ `asOf`

**ตัวเลขที่ไม่เปลี่ยน:** ทุกหน้าที่ไม่เลือกวันที่ (ใช้ค่าเริ่มต้น "วันนี้/เดือนนี้") · รายงาน "อายุลูกหนี้" ทั่วไป (ตรวจแล้วผลเท่าเดิม) · งบทดลอง / บัญชีแยกประเภท / งบฐานะการเงินแบบจากสมุดบัญชี (แก้ไปแล้วใน PR #1789)
