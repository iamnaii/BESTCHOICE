# งบทดลอง FINANCE แบบช่วงเวลา (PEAK) + รายงานบัญชีนับวันตามเวลาไทย · แผนลงมือ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มหน้า "งบทดลอง" ฝั่ง FINANCE แบบช่วงเวลา (ยอดยกมา / ระหว่างงวด / ยอดคงเหลือ) ที่กดบัญชีแล้วเปิดบัญชีแยกประเภทช่วงเดียวกันได้ตัวเลขตรงกัน และแก้รายงานบัญชีจากสมุดรายวันทั้งชุดให้นับวันเต็มวันตามเวลาไทย

**Architecture:** ตัวช่วยแปลงวันที่ตัวเดียวใน `utils/date.util.ts` ใช้กับทุก endpoint `ledger/*` ของ `AccountingController` (เดิม `new Date('YYYY-MM-DD')` = 07:00 น. ไทย) · งบทดลองแบบช่วงเวลา**ประกอบจาก `getTrialBalance` ที่มีอยู่สองครั้ง** (ก่อนวันเริ่ม · ณ วันสิ้นสุด) ไม่มี query ชุดใหม่ และเปิดผ่าน endpoint เดิม `GET /expenses/ledger/trial-balance` ด้วยพารามิเตอร์ `periodStart` (ไม่มี route ใหม่ ⇒ access manifest ไม่เปลี่ยน) · หน้าเว็บใหม่ `/finance/trial-balance` อยู่ในกลุ่มใช้ร่วม `finStatementsSection` · หน้าบัญชีแยกประเภทรับบัญชี/ช่วงวันที่จาก URL

**Tech Stack:** NestJS + Prisma (`apps/api`, Jest) · React 18 + Vite + Vitest (`apps/web`)

## Global Constraints

- mockup ที่เจ้าของดูแล้ว: https://claude.ai/artifact/V3Qr2r671Xfw88ov44mPqK (หน้า 1 = งบทดลอง · หน้า 2 เป็นภาพประกอบเท่านั้น — **ห้ามออกแบบหน้าบัญชีแยกประเภทใหม่** เพิ่มได้แค่รับค่าจากลิงก์ + ปุ่มกลับ)
- เงินใช้ `Prisma.Decimal` เท่านั้น ห้าม `Number()` กับยอดเงินฝั่ง API
- วันที่แบบ `YYYY-MM-DD` = วันตามปฏิทินไทย: เริ่ม 00:00:00.000 น. · สิ้นสุด 23:59:59.999 น. (เวลาไทย) ไม่ขึ้นกับ TZ ของโปรเซส · ค่าที่ไม่ใช่รูป `YYYY-MM-DD` ต้องได้พฤติกรรมเดิมทุกประการ
- ไม่เพิ่ม/เปลี่ยน route หรือ decorator (`@Get` / `@Roles`) ของ API — `tools/check-access-coverage.mjs` ต้องผ่านโดยไม่แก้ `access-policy.manifest.json`
- ยอดยกมาและยอดคงเหลือ = ยอดสุทธิของบัญชี แสดงฝั่งเดียว (เดบิตเมื่อสุทธิ > 0 · เครดิตเมื่อ < 0) · ระหว่างงวด = เดบิตรวมและเครดิตรวมของรายการในช่วง
- หน้าเว็บ: ข้อความไทย · `leading-snug` · ห้าม hardcode สี (`.claude/rules/frontend.md`) · สถานะห้ามบอกด้วยสีอย่างเดียว · `useQuery` + `api.get` · lazy route + `ProtectedRoute`
- `route-reachability.test.ts` เขียวทั้งสองทิศ `KNOWN_GAPS_*` ว่าง · กลุ่มใช้ร่วม `fin-*` มีเฉพาะหน้าที่ OWNER / FINANCE_MANAGER / ACCOUNTANT เข้าได้ครบ
- ชื่อเมนูและหัวหน้าอ่านจาก `NAV_LABELS`
- ทำบน branch `feat/finance-trial-balance` (ต่อจาก `fix/overdue-menu-name` ซึ่งเว็บเป็น 26.11.10) · เว็บ → `26.11.11`
- commit ลงท้ายด้วย `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `apps/api/src/utils/date.util.ts` | + `reportDayStart` / `reportDayEnd` / `reportAsOf` |
| `apps/api/src/utils/date.util.report-day.spec.ts` (ใหม่) | เทสต์ตัวช่วย |
| `apps/api/src/modules/accounting/accounting.controller.ts` | endpoint `ledger/*` ใช้ตัวช่วย · `ledger/trial-balance` รับ `periodStart`/`periodEnd` |
| `apps/api/src/modules/accounting/accounting.controller.report-dates.spec.ts` (ใหม่) | ปักว่า controller ส่งขอบวันไทยให้ service |
| `apps/api/src/modules/accounting/general-ledger-report.service.ts` | + `getPeriodTrialBalance` |
| `apps/api/src/modules/accounting/accounting.service.ts` | + ตัวส่งต่อ `getPeriodTrialBalance` |
| `apps/api/src/modules/accounting/accounting.service.spec.ts` | + เทสต์ `getPeriodTrialBalance` |
| `apps/web/src/pages/finance/trial-balance.ts` (ใหม่) | ชนิดข้อมูล + ฟังก์ชันล้วน (จัดรูปยอด · ซ่อนบัญชีว่าง · ลิงก์ไปบัญชีแยกประเภท) |
| `apps/web/src/pages/finance/TrialBalancePage.tsx` (ใหม่) | หน้างบทดลอง |
| `apps/web/src/pages/finance/__tests__/trial-balance.test.ts` · `TrialBalancePage.test.tsx` (ใหม่) | เทสต์ |
| `apps/web/src/pages/GeneralLedgerPage.tsx` (+ `.test.tsx`) | รับ `account` / `start` / `end` / `from` จาก URL + ปุ่มกลับ |
| `apps/web/src/config/work-navigation.ts` · `menu.ts` · `App.tsx` | ชื่อ · เมนู · route |
| `apps/web/src/config/__tests__/menu.fin-groups.test.ts` · `menu.fin-labels.test.ts` | ปักเมนูใหม่ |
| `apps/web/package.json` | เวอร์ชัน |

---

### Task 1: รายงานบัญชี `ledger/*` นับวันเต็มวันตามเวลาไทย

**Files:**
- Modify: `apps/api/src/utils/date.util.ts` (ต่อท้าย `bangkokDateRange`)
- Create: `apps/api/src/utils/date.util.report-day.spec.ts`
- Modify: `apps/api/src/modules/accounting/accounting.controller.ts` (เมธอด `getTrialBalance` · `getProfitLossFromJournal` · `getShopTrialBalance` · `getShopProfitLoss` · `getBalanceSheetFromJournal` · `getCashFlowFromJournal` · `getEquityStatementFromJournal` · `getGeneralLedger`)
- Create: `apps/api/src/modules/accounting/accounting.controller.report-dates.spec.ts`

**Interfaces:**
- Produces (จาก `utils/date.util.ts`): `reportDayStart(value: string): Date` · `reportDayEnd(value: string): Date` · `reportAsOf(value: string): Date` — Task 2 ใช้ `reportDayStart` / `reportDayEnd`

- [ ] **Step 1: เขียนเทสต์ตัวช่วยที่ต้องล้ม**

สร้าง `apps/api/src/utils/date.util.report-day.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { reportAsOf, reportDayEnd, reportDayStart } from './date.util';

/**
 * รายงานบัญชีรับวันที่แบบ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิม controller ใช้ new Date('YYYY-MM-DD') = เที่ยงคืน UTC = 07:00 น. ไทย ⇒ รายการ 00:00–06:59 น.
 * ของวันเริ่ม (เช่น รายการตั้งลูกหนี้งวดที่ลงเที่ยงคืนไทยของวันครบกำหนด) ตกนอกช่วง และงบ ณ วันที่
 * ไม่นับรายการหลัง 07:00 น. ของวันที่เลือก
 */
describe('report day helpers', () => {
  it('reportDayStart: YYYY-MM-DD = 00:00 น. เวลาไทย', () => {
    expect(reportDayStart('2026-11-01').toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('reportDayEnd: YYYY-MM-DD = 23:59:59.999 น. เวลาไทย', () => {
    expect(reportDayEnd('2026-11-17').toISOString()).toBe('2026-11-17T16:59:59.999Z');
  });

  it('reportAsOf: YYYY-MM-DD = สิ้นวันไทยของวันนั้น', () => {
    expect(reportAsOf('2026-11-17').toISOString()).toBe('2026-11-17T16:59:59.999Z');
  });

  it('รายการเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · รายการเที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', () => {
    const start = reportDayStart('2026-11-01');
    const end = reportDayEnd('2026-11-30');
    const dueOnFirst = new Date('2026-11-01T00:00:00+07:00');
    const dueOnNextFirst = new Date('2026-12-01T00:00:00+07:00');
    expect(dueOnFirst >= start && dueOnFirst <= end).toBe(true);
    expect(dueOnNextFirst <= end).toBe(false);
  });

  it('วันที่ไม่มีจริง = 400 ภาษาไทย', () => {
    expect(() => reportDayStart('2026-02-31')).toThrow(BadRequestException);
    expect(() => reportDayEnd('2026-02-31')).toThrow(BadRequestException);
    expect(() => reportAsOf('2026-02-31')).toThrow(BadRequestException);
  });

  it('ค่าที่ไม่ใช่ YYYY-MM-DD ได้พฤติกรรมเดิม', () => {
    const iso = '2026-11-17T03:04:05.000Z';
    expect(reportDayStart(iso).toISOString()).toBe(iso);
    expect(reportAsOf(iso).toISOString()).toBe(iso);
    const legacyEnd = new Date(iso);
    legacyEnd.setHours(23, 59, 59, 999);
    expect(reportDayEnd(iso).getTime()).toBe(legacyEnd.getTime());
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && npx jest src/utils/date.util.report-day.spec.ts
```

Expected: FAIL — `reportDayStart` ไม่ถูก export จาก `./date.util`

- [ ] **Step 3: เพิ่มตัวช่วย**

`apps/api/src/utils/date.util.ts` วางต่อจากฟังก์ชัน `bangkokDateRange`:

```ts
const REPORT_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * วันเริ่มของช่วงรายงาน — 'YYYY-MM-DD' = 00:00 น. เวลาไทยของวันนั้น (ไม่ขึ้นกับ TZ ของโปรเซส)
 * ค่ารูปแบบอื่น = new Date(value) ตามเดิม
 */
export function reportDayStart(value: string): Date {
  if (REPORT_DATE_ONLY.test(value)) return bangkokDateRange(value, value).gte!;
  return new Date(value);
}

/**
 * วันสิ้นสุดของช่วงรายงาน (รวมทั้งวัน) — 'YYYY-MM-DD' = 23:59:59.999 น. เวลาไทยของวันนั้น
 * ค่ารูปแบบอื่น = พฤติกรรมเดิมของ endpoint แบบช่วง (สิ้นวันตามเวลาโปรเซส)
 */
export function reportDayEnd(value: string): Date {
  if (REPORT_DATE_ONLY.test(value)) return new Date(bangkokDateRange(value, value).lt!.getTime() - 1);
  const end = new Date(value);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * จุดตัดยอดของรายงาน "ณ วันที่" — 'YYYY-MM-DD' = สิ้นวันไทยของวันนั้น (รวมรายการทั้งวัน)
 * ค่ารูปแบบอื่น = new Date(value) ตามเดิม
 */
export function reportAsOf(value: string): Date {
  if (REPORT_DATE_ONLY.test(value)) return reportDayEnd(value);
  return new Date(value);
}
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
npx jest src/utils/date.util.report-day.spec.ts
```

Expected: PASS 6 tests

- [ ] **Step 5: เขียนเทสต์ controller ที่ต้องล้ม**

สร้าง `apps/api/src/modules/accounting/accounting.controller.report-dates.spec.ts`:

```ts
import { AccountingController } from './accounting.controller';

/**
 * endpoint ledger/* ต้องส่งขอบวันตามเวลาไทยให้ service (2026-11-18)
 * 2026-11-01 เริ่ม = 2026-10-31T17:00:00.000Z · 2026-11-17 สิ้นสุด = 2026-11-17T16:59:59.999Z
 */
describe('AccountingController — วันที่ของรายงาน ledger/*', () => {
  const START = '2026-10-31T17:00:00.000Z';
  const END = '2026-11-17T16:59:59.999Z';
  const service = {
    getTrialBalance: jest.fn(),
    getProfitLossFromJournal: jest.fn(),
    getBalanceSheetFromJournal: jest.fn(),
    getCashFlowFromJournal: jest.fn(),
    getEquityStatementFromJournal: jest.fn(),
    getGeneralLedger: jest.fn(),
  };
  const controller = new AccountingController(service as never, {} as never, {} as never, {} as never);
  const iso = (d: Date) => d.toISOString();

  beforeEach(() => jest.clearAllMocks());

  it('งบทดลอง ณ วันที่: ตัดยอดสิ้นวันไทย', () => {
    controller.getTrialBalance('2026-11-17');
    expect(iso(service.getTrialBalance.mock.calls[0][0])).toBe(END);
    expect(service.getTrialBalance.mock.calls[0][1]).toBe('FINANCE');
  });

  it('งบทดลองหน้าร้าน: ตัดยอดสิ้นวันไทย', () => {
    controller.getShopTrialBalance('2026-11-17');
    expect(iso(service.getTrialBalance.mock.calls[0][0])).toBe(END);
    expect(service.getTrialBalance.mock.calls[0][1]).toBe('SHOP');
  });

  it('งบฐานะการเงิน: ตัดยอดสิ้นวันไทย', () => {
    controller.getBalanceSheetFromJournal('2026-11-17');
    expect(iso(service.getBalanceSheetFromJournal.mock.calls[0][0])).toBe(END);
  });

  it('ไม่ส่งวันที่ = undefined ตามเดิม', () => {
    controller.getTrialBalance();
    controller.getBalanceSheetFromJournal();
    expect(service.getTrialBalance.mock.calls[0][0]).toBeUndefined();
    expect(service.getBalanceSheetFromJournal.mock.calls[0][0]).toBeUndefined();
  });

  it.each([
    ['งบกำไรขาดทุน', () => controller.getProfitLossFromJournal('2026-11-01', '2026-11-17'), service.getProfitLossFromJournal, 0],
    ['งบกำไรขาดทุนหน้าร้าน', () => controller.getShopProfitLoss('2026-11-01', '2026-11-17'), service.getProfitLossFromJournal, 0],
    ['งบกระแสเงินสด', () => controller.getCashFlowFromJournal('2026-11-01', '2026-11-17'), service.getCashFlowFromJournal, 0],
    ['งบส่วนของผู้ถือหุ้น', () => controller.getEquityStatementFromJournal('2026-11-01', '2026-11-17'), service.getEquityStatementFromJournal, 0],
    ['บัญชีแยกประเภท', () => controller.getGeneralLedger('11-1201', '2026-11-01', '2026-11-17'), service.getGeneralLedger, 1],
  ] as const)('%s: ช่วง = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', (_name, call, mock, startIndex) => {
    call();
    const args = (mock as jest.Mock).mock.calls[0];
    expect(iso(args[startIndex])).toBe(START);
    expect(iso(args[startIndex + 1])).toBe(END);
  });
});
```

- [ ] **Step 6: รันให้เห็นว่าล้ม**

```bash
npx jest src/modules/accounting/accounting.controller.report-dates.spec.ts
```

Expected: FAIL — ค่าที่ได้เป็น `2026-11-17T00:00:00.000Z` / `2026-11-01T00:00:00.000Z` (ถ้า constructor ของ controller รับอาร์กิวเมนต์ไม่ตรง 4 ตัว ให้ปรับจำนวน `{} as never` ให้ตรง constructor จริง แล้วรันใหม่จนล้มด้วยเหตุผลเรื่องวันที่)

- [ ] **Step 7: แก้ controller**

`apps/api/src/modules/accounting/accounting.controller.ts`

แก้ import:

```ts
import { bangkokDateRange, reportAsOf, reportDayEnd, reportDayStart } from '../../utils/date.util';
```

แทนการแปลงวันที่ในแต่ละเมธอด (ไม่แตะ decorator · ไม่แตะพารามิเตอร์อื่น · ไม่แตะการเรียก service ส่วนที่เหลือ):

| เมธอด | เดิม | ใหม่ |
|---|---|---|
| `getTrialBalance` | `asOfDate ? new Date(asOfDate) : undefined` | `asOfDate ? reportAsOf(asOfDate) : undefined` |
| `getShopTrialBalance` | `asOfDate ? new Date(asOfDate) : undefined` | `asOfDate ? reportAsOf(asOfDate) : undefined` |
| `getBalanceSheetFromJournal` | `asOfDate ? new Date(asOfDate) : undefined` | `asOfDate ? reportAsOf(asOfDate) : undefined` |
| `getProfitLossFromJournal` · `getShopProfitLoss` · `getCashFlowFromJournal` · `getEquityStatementFromJournal` · `getGeneralLedger` | `const start = new Date(periodStart);` + `const end = new Date(periodEnd);` + `end.setHours(23, 59, 59, 999);` | `const start = reportDayStart(periodStart);` + `const end = reportDayEnd(periodEnd);` |

ตัวอย่างหลังแก้ (`getGeneralLedger`):

```ts
    const start = reportDayStart(periodStart);
    const end = reportDayEnd(periodEnd);
    return this.service.getGeneralLedger(accountCode, start, end, companyId);
```

ตรวจว่าไม่เหลือของเดิมในกลุ่ม `ledger/*`:

```bash
grep -n "new Date(periodStart)\|new Date(periodEnd)\|new Date(asOfDate)\|setHours(23" src/modules/accounting/accounting.controller.ts
```

Expected: ไม่มีผลลัพธ์ในเมธอดทั้ง 8 ตัวข้างบน (ถ้าเจอในเมธอดอื่นนอกรายการ ให้คงไว้และจดไว้ในรายงาน)

- [ ] **Step 8: รันเทสต์ + ตรวจชนิด + ตรวจ manifest**

```bash
npx jest src/utils/date.util.report-day.spec.ts src/modules/accounting/accounting.controller src/modules/accounting/accounting.service.spec.ts
cd "/d/BESTCHOICE APP/BESTCHOICE" && ./tools/check-types.sh api && node tools/check-access-coverage.mjs
```

Expected: jest PASS ทั้งหมด · type check 0 errors · access coverage ไม่มี error (ไม่มีการแก้ manifest)

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/utils/date.util.ts apps/api/src/utils/date.util.report-day.spec.ts apps/api/src/modules/accounting/accounting.controller.ts apps/api/src/modules/accounting/accounting.controller.report-dates.spec.ts
git commit -m "รายงานบัญชี ledger/*: นับวันเต็มวันตามเวลาไทย (เดิมตัดที่ 07:00 น.)

วันที่ YYYY-MM-DD เดิมแปลงเป็นเที่ยงคืน UTC = 07:00 น. ไทย ⇒ งบ ณ วันที่ ไม่นับรายการหลัง 07:00 น.
ของวันที่เลือก และรายงานแบบช่วงไม่นับรายการ 00:00–06:59 น. ของวันเริ่ม (เช่น ตั้งลูกหนี้งวดของวันครบกำหนด)
กระทบ: งบทดลอง (FINANCE/SHOP) · งบฐานะการเงิน · งบกำไรขาดทุน (FINANCE/SHOP) · งบกระแสเงินสด ·
งบส่วนของผู้ถือหุ้น · บัญชีแยกประเภท — ตัวช่วยเดียว reportDayStart/reportDayEnd/reportAsOf

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 2: งบทดลองแบบช่วงเวลา (API)

**Files:**
- Modify: `apps/api/src/modules/accounting/general-ledger-report.service.ts` (เพิ่มเมธอดต่อจาก `getTrialBalance`)
- Modify: `apps/api/src/modules/accounting/accounting.service.ts` (เพิ่มตัวส่งต่อใต้ `getTrialBalance`)
- Modify: `apps/api/src/modules/accounting/accounting.controller.ts` (เมธอด `getTrialBalance`)
- Modify: `apps/api/src/modules/accounting/accounting.service.spec.ts` (เพิ่ม describe ต่อจาก `describe('getTrialBalance (T17)'`)
- Modify: `apps/api/src/modules/accounting/accounting.controller.report-dates.spec.ts`

**Interfaces:**
- Consumes: `reportDayStart` / `reportDayEnd` / `reportAsOf` จาก Task 1 · `GeneralLedgerReportService.getTrialBalance(asOfDate?: Date, scope)` เดิม (คืน `sections[].rows[]` ที่มี `code` `name` `type` `normalBalance` `drBalance` `crBalance` เป็น `Prisma.Decimal` ยอดสะสมถึงจุดตัด)
- Produces: `GET /expenses/ledger/trial-balance?periodStart=YYYY-MM-DD&periodEnd=YYYY-MM-DD[&scope=]` คืน

```ts
type Amounts = { openingDr: Decimal; openingCr: Decimal; periodDr: Decimal; periodCr: Decimal; closingDr: Decimal; closingCr: Decimal };
{
  periodStart: Date; periodEnd: Date; scope: 'FINANCE' | 'SHOP' | 'ALL';
  sections: { sectionName: string; codePrefix: string; rows: ({ code: string; name: string; type: string; normalBalance: string } & Amounts)[]; totals: Amounts }[];
  totals: Amounts;
  isBalanced: { opening: boolean; period: boolean; closing: boolean };
}
```
(Decimal ถูกส่งออกเป็นสตริงใน JSON)

- [ ] **Step 1: เขียนเทสต์ service ที่ต้องล้ม**

`apps/api/src/modules/accounting/accounting.service.spec.ts` — เพิ่ม describe ใหม่**ถัดจาก**ปิดวงเล็บของ `describe('getTrialBalance (T17)', ...)` (ใช้ `service` / `prisma` ตัวเดียวกับ describe ข้างบน):

```ts
  describe('getPeriodTrialBalance (งบทดลองแบบช่วงเวลา)', () => {
    const coa = (code: string, name: string, normalBalance: string) => ({
      id: code, code, name, type: 'ทดสอบ', normalBalance,
      category: null, vatApplicable: false, notes: null, status: 'ใช้งาน', deletedAt: null,
    });
    const sum = (accountCode: string, debit: number, credit: number) => ({
      accountCode,
      _sum: { debit: new Prisma.Decimal(debit), credit: new Prisma.Decimal(credit) },
    });
    const START = new Date('2026-10-31T17:00:00.000Z'); // 1 พ.ย. 00:00 น. ไทย
    const END = new Date('2026-11-17T16:59:59.999Z'); // 17 พ.ย. 23:59:59.999 น. ไทย

    beforeEach(() => {
      prisma.chartOfAccount = {
        findMany: jest.fn().mockResolvedValue([
          coa('11-1201', 'ธนาคาร KBank', 'Dr'),
          coa('11-2106', 'รายได้รอตัดบัญชี-ดอกเบี้ย', 'Cr'),
          coa('21-1101', 'เจ้าหนี้-หน้าร้าน', 'Cr'),
          coa('53-1101', 'เงินเดือน', 'Dr'),
        ]),
      };
      // ยอดสะสมก่อนวันเริ่ม (ยกมา) กับยอดสะสมถึงวันสิ้นสุด — แยกด้วยจุดตัดที่ service ส่งมา
      prisma.journalLine = {
        groupBy: jest.fn().mockImplementation(({ where }) => {
          const cutoff: Date = where.journalEntry.entryDate.lte;
          return Promise.resolve(
            cutoff.getTime() < START.getTime()
              ? [sum('11-1201', 250000, 0), sum('11-2106', 0, 96000), sum('21-1101', 0, 154000)]
              : [
                  sum('11-1201', 295480, 138000),
                  sum('11-2106', 9000, 110400),
                  sum('21-1101', 120000, 204000),
                  sum('53-1101', 18000, 0),
                  sum('99-9999', 85920, 85920 + 0),
                ],
          );
        }),
      };
    });

    const rowOf = (result: Awaited<ReturnType<typeof service.getPeriodTrialBalance>>, code: string) =>
      result.sections.flatMap((s) => s.rows).find((r) => r.code === code)!;

    it('จุดตัดยอดยกมา = 1 มิลลิวินาทีก่อนวันเริ่ม · จุดตัดยอดคงเหลือ = วันสิ้นสุด', async () => {
      await service.getPeriodTrialBalance(START, END);
      const cutoffs = prisma.journalLine.groupBy.mock.calls.map(
        (c: [{ where: { journalEntry: { entryDate: { lte: Date } } } }]) => c[0].where.journalEntry.entryDate.lte.toISOString(),
      );
      expect(cutoffs).toEqual(['2026-10-31T16:59:59.999Z', '2026-11-17T16:59:59.999Z']);
    });

    it('ยอดยกมา/ยอดคงเหลือเป็นยอดสุทธิฝั่งเดียว · ระหว่างงวดเป็นเดบิตรวมและเครดิตรวมของช่วง', async () => {
      const result = await service.getPeriodTrialBalance(START, END);
      const bank = rowOf(result, '11-1201');
      expect(bank.openingDr.toFixed(2)).toBe('250000.00');
      expect(bank.openingCr.toFixed(2)).toBe('0.00');
      expect(bank.periodDr.toFixed(2)).toBe('45480.00');
      expect(bank.periodCr.toFixed(2)).toBe('138000.00');
      expect(bank.closingDr.toFixed(2)).toBe('157480.00');
      expect(bank.closingCr.toFixed(2)).toBe('0.00');

      const unearned = rowOf(result, '11-2106'); // บัญชีปกติฝั่งเครดิต
      expect(unearned.openingCr.toFixed(2)).toBe('96000.00');
      expect(unearned.periodDr.toFixed(2)).toBe('9000.00');
      expect(unearned.periodCr.toFixed(2)).toBe('14400.00');
      expect(unearned.closingCr.toFixed(2)).toBe('101400.00');
      expect(unearned.closingDr.toFixed(2)).toBe('0.00');
    });

    it('บัญชีที่เพิ่งมีรายการในช่วง: ยกมา 0 · ระหว่างงวด = ยอดทั้งหมด', async () => {
      const salary = rowOf(await service.getPeriodTrialBalance(START, END), '53-1101');
      expect(salary.openingDr.toFixed(2)).toBe('0.00');
      expect(salary.periodDr.toFixed(2)).toBe('18000.00');
      expect(salary.closingDr.toFixed(2)).toBe('18000.00');
    });

    it('รหัสที่ไม่มีในผังบัญชีแต่มีรายการ ยังอยู่ในงบ', async () => {
      const orphan = rowOf(await service.getPeriodTrialBalance(START, END), '99-9999');
      expect(orphan.periodDr.toFixed(2)).toBe('85920.00');
      expect(orphan.periodCr.toFixed(2)).toBe('85920.00');
      expect(orphan.closingDr.toFixed(2)).toBe('0.00');
      expect(orphan.closingCr.toFixed(2)).toBe('0.00');
    });

    it('รวมทั้งสิ้นและธงสมดุลของทั้ง 3 คู่', async () => {
      const result = await service.getPeriodTrialBalance(START, END);
      expect(result.totals.openingDr.toFixed(2)).toBe('250000.00');
      expect(result.totals.openingCr.toFixed(2)).toBe('250000.00');
      expect(result.totals.periodDr.toFixed(2)).toBe('278400.00');
      expect(result.totals.periodCr.toFixed(2)).toBe('288320.00');
      expect(result.isBalanced).toEqual({ opening: true, period: false, closing: false });
      const assets = result.sections.find((s) => s.codePrefix === '11')!;
      expect(assets.totals.closingDr.toFixed(2)).toBe('157480.00');
      expect(assets.totals.closingCr.toFixed(2)).toBe('101400.00');
    });
  });
```

ตัวเลขตรวจมือ: ระหว่างงวดเดบิต = 45,480 + 9,000 + 120,000 + 18,000 + 85,920 = 278,400 · เครดิต = 138,000 + 14,400 + 50,000 + 85,920 = 288,320 (ไม่สมดุลโดยตั้งใจ เพื่อพิสูจน์ธง)

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && npx jest src/modules/accounting/accounting.service.spec.ts -t "getPeriodTrialBalance"
```

Expected: FAIL — `service.getPeriodTrialBalance is not a function`

- [ ] **Step 3: เพิ่มเมธอดใน service**

`apps/api/src/modules/accounting/general-ledger-report.service.ts` — วางต่อจากปิดวงเล็บของ `getTrialBalance`:

```ts
  /**
   * งบทดลองแบบช่วงเวลา (แบบ PEAK): ยอดยกมา / ระหว่างงวด / ยอดคงเหลือ
   *
   * ประกอบจาก getTrialBalance สองครั้ง — ยอดสะสมก่อนวันเริ่ม กับยอดสะสมถึงวันสิ้นสุด —
   * จึงใช้ตัวกรองบริษัท/ผังบัญชี/สถานะรายการชุดเดียวกับงบทดลอง ณ วันที่ ไม่มี query ชุดที่สอง
   *   - ยอดยกมา · ยอดคงเหลือ = ยอดสุทธิของบัญชี แสดงฝั่งเดียว (เดบิตเมื่อสุทธิ > 0 · เครดิตเมื่อ < 0)
   *   - ระหว่างงวด = เดบิตรวมและเครดิตรวมของรายการในช่วง (ยอดสะสมปลายงวด − ยอดสะสมต้นงวด)
   */
  async getPeriodTrialBalance(
    periodStart: Date,
    periodEnd: Date,
    scope: 'FINANCE' | 'SHOP' | 'ALL' = 'FINANCE',
  ) {
    const opening = await this.getTrialBalance(new Date(periodStart.getTime() - 1), scope);
    const closing = await this.getTrialBalance(periodEnd, scope);

    const zero = new Prisma.Decimal(0);
    const oneSided = (net: Prisma.Decimal) => ({
      dr: net.gt(0) ? net : zero,
      cr: net.lt(0) ? net.neg() : zero,
    });
    const emptyAmounts = () => ({
      openingDr: zero, openingCr: zero, periodDr: zero, periodCr: zero, closingDr: zero, closingCr: zero,
    });
    type Amounts = ReturnType<typeof emptyAmounts>;
    const addInto = (target: Amounts, row: Amounts) => {
      target.openingDr = target.openingDr.add(row.openingDr);
      target.openingCr = target.openingCr.add(row.openingCr);
      target.periodDr = target.periodDr.add(row.periodDr);
      target.periodCr = target.periodCr.add(row.periodCr);
      target.closingDr = target.closingDr.add(row.closingDr);
      target.closingCr = target.closingCr.add(row.closingCr);
    };

    const openingByCode = new Map(
      opening.sections.flatMap((s) => s.rows).map((r) => [r.code, r] as const),
    );

    const totals = emptyAmounts();
    // ยอดสะสมถึงวันสิ้นสุดครอบทุกบัญชีที่มียอดก่อนวันเริ่มอยู่แล้ว ⇒ ไล่จากฝั่งปลายงวดอย่างเดียวพอ
    const sections = closing.sections.map((section) => {
      const sectionTotals = emptyAmounts();
      const rows = section.rows.map((row) => {
        const before = openingByCode.get(row.code);
        const beforeDr = before?.drBalance ?? zero;
        const beforeCr = before?.crBalance ?? zero;
        const open = oneSided(beforeDr.sub(beforeCr));
        const close = oneSided(row.drBalance.sub(row.crBalance));
        const amounts: Amounts = {
          openingDr: open.dr,
          openingCr: open.cr,
          periodDr: row.drBalance.sub(beforeDr),
          periodCr: row.crBalance.sub(beforeCr),
          closingDr: close.dr,
          closingCr: close.cr,
        };
        addInto(sectionTotals, amounts);
        addInto(totals, amounts);
        return { code: row.code, name: row.name, type: row.type, normalBalance: row.normalBalance, ...amounts };
      });
      return { sectionName: section.sectionName, codePrefix: section.codePrefix, rows, totals: sectionTotals };
    });

    return {
      periodStart,
      periodEnd,
      scope,
      sections,
      totals,
      isBalanced: {
        opening: totals.openingDr.equals(totals.openingCr),
        period: totals.periodDr.equals(totals.periodCr),
        closing: totals.closingDr.equals(totals.closingCr),
      },
    };
  }
```

`apps/api/src/modules/accounting/accounting.service.ts` — วางต่อจากเมธอด `getTrialBalance`:

```ts
  /** งบทดลองแบบช่วงเวลา (ยอดยกมา / ระหว่างงวด / ยอดคงเหลือ) — ดู GeneralLedgerReportService.getPeriodTrialBalance */
  async getPeriodTrialBalance(
    periodStart: Date,
    periodEnd: Date,
    scope: 'FINANCE' | 'SHOP' | 'ALL' = 'FINANCE',
  ) {
    return this.generalLedgerReport.getPeriodTrialBalance(periodStart, periodEnd, scope);
  }
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
npx jest src/modules/accounting/accounting.service.spec.ts -t "getPeriodTrialBalance"
```

Expected: PASS 5 tests

- [ ] **Step 5: เพิ่มเทสต์ controller ที่ต้องล้ม**

`apps/api/src/modules/accounting/accounting.controller.report-dates.spec.ts` — เพิ่ม `getPeriodTrialBalance: jest.fn(),` ในออบเจ็กต์ `service` และเพิ่ม `import { BadRequestException } from '@nestjs/common';` แล้วเพิ่มเทสต์ท้าย describe:

```ts
  it('งบทดลองแบบช่วงเวลา: มี periodStart = เรียก getPeriodTrialBalance ด้วยขอบวันไทย', () => {
    controller.getTrialBalance(undefined, undefined, '2026-11-01', '2026-11-17');
    expect(service.getTrialBalance).not.toHaveBeenCalled();
    const [start, end, scope] = service.getPeriodTrialBalance.mock.calls[0];
    expect(iso(start)).toBe(START);
    expect(iso(end)).toBe(END);
    expect(scope).toBe('FINANCE');
  });

  it('งบทดลองแบบช่วงเวลา: ไม่มีวันสิ้นสุด หรือวันเริ่มหลังวันสิ้นสุด = 400', () => {
    expect(() => controller.getTrialBalance(undefined, undefined, '2026-11-01')).toThrow(BadRequestException);
    expect(() => controller.getTrialBalance(undefined, undefined, '2026-11-18', '2026-11-17')).toThrow(BadRequestException);
    expect(service.getPeriodTrialBalance).not.toHaveBeenCalled();
  });
```

รัน: `npx jest src/modules/accounting/accounting.controller.report-dates.spec.ts` → Expected: FAIL (2 เทสต์ใหม่ — `getPeriodTrialBalance` ไม่ถูกเรียก)

- [ ] **Step 6: แก้ endpoint**

`apps/api/src/modules/accounting/accounting.controller.ts` — แทนเมธอด `getTrialBalance` ทั้งตัว (decorator สองบรรทัดเหนือเมธอดคงเดิมทุกตัวอักษร):

```ts
  getTrialBalance(
    @Query('asOfDate') asOfDate?: string,
    @Query('scope') scope?: 'FINANCE' | 'SHOP' | 'ALL',
    @Query('periodStart') periodStart?: string,
    @Query('periodEnd') periodEnd?: string,
  ) {
    // มี periodStart = งบทดลองแบบช่วงเวลา (ยอดยกมา / ระหว่างงวด / ยอดคงเหลือ) · ไม่มี = งบ ณ วันที่ ตามเดิม
    if (periodStart) {
      if (!periodEnd) throw new BadRequestException('กรุณาระบุวันสิ้นสุด');
      const start = reportDayStart(periodStart);
      const end = reportDayEnd(periodEnd);
      if (start.getTime() > end.getTime()) {
        throw new BadRequestException('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด');
      }
      return this.service.getPeriodTrialBalance(start, end, scope ?? 'FINANCE');
    }
    return this.service.getTrialBalance(
      asOfDate ? reportAsOf(asOfDate) : undefined,
      scope ?? 'FINANCE',
    );
  }
```

- [ ] **Step 7: รันเทสต์ + ตรวจชนิด + manifest**

```bash
npx jest src/modules/accounting/accounting.controller src/modules/accounting/accounting.service.spec.ts src/modules/accounting/consolidated.service.spec.ts
cd "/d/BESTCHOICE APP/BESTCHOICE" && ./tools/check-types.sh api && node tools/check-access-coverage.mjs
```

Expected: PASS ทั้งหมด · 0 type errors · access coverage ผ่านโดยไม่แก้ manifest

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/accounting
git commit -m "งบทดลองแบบช่วงเวลา (API): ยอดยกมา / ระหว่างงวด / ยอดคงเหลือ

GET /expenses/ledger/trial-balance รับ periodStart + periodEnd (ไม่มี route ใหม่) —
ประกอบจาก getTrialBalance สองครั้ง (ก่อนวันเริ่ม · ณ วันสิ้นสุด) ไม่มี query ชุดที่สอง
ยอดยกมา/คงเหลือ = ยอดสุทธิฝั่งเดียว · ระหว่างงวด = เดบิตรวม/เครดิตรวม · ธงสมดุล 3 คู่

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 3: หน้างบทดลอง + กดบัญชีไปบัญชีแยกประเภท (เว็บ)

**Files:**
- Create: `apps/web/src/pages/finance/trial-balance.ts`
- Create: `apps/web/src/pages/finance/TrialBalancePage.tsx`
- Create: `apps/web/src/pages/finance/__tests__/trial-balance.test.ts`
- Create: `apps/web/src/pages/finance/__tests__/TrialBalancePage.test.tsx`
- Modify: `apps/web/src/pages/GeneralLedgerPage.tsx` · `apps/web/src/pages/GeneralLedgerPage.test.tsx`
- Modify: `apps/web/src/config/work-navigation.ts` · `apps/web/src/config/menu.ts` (`finStatementsSection` + import ไอคอน) · `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/__tests__/menu.fin-groups.test.ts` · `apps/web/src/config/__tests__/menu.fin-labels.test.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: `GET /expenses/ledger/trial-balance?periodStart=&periodEnd=` (รูปคำตอบใน Task 2 — ยอดเป็นสตริง) · `GET /expenses/ledger/general-ledger` เดิม
- Produces: route `/finance/trial-balance?start=YYYY-MM-DD&end=YYYY-MM-DD` · หน้าบัญชีแยกประเภทรับ `?account=<code>&start=&end=&from=trial-balance` · `NAV_LABELS.trialBalance = 'งบทดลอง'`

- [ ] **Step 1: เทสต์ฟังก์ชันล้วนที่ต้องล้ม**

สร้าง `apps/web/src/pages/finance/__tests__/trial-balance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fmtAmount, ledgerHref, unbalancedLabels, visibleSections, type PeriodTbSection } from '../trial-balance';

const amounts = (o: Partial<Record<'openingDr' | 'openingCr' | 'periodDr' | 'periodCr' | 'closingDr' | 'closingCr', string>>) => ({
  openingDr: '0', openingCr: '0', periodDr: '0', periodCr: '0', closingDr: '0', closingCr: '0', ...o,
});
const row = (code: string, o: Parameters<typeof amounts>[0] = {}) => ({
  code, name: `บัญชี ${code}`, type: 'ทดสอบ', normalBalance: 'Dr', ...amounts(o),
});

describe('trial-balance helpers', () => {
  it('fmtAmount: ศูนย์เว้นว่างในช่องบัญชี · แสดง 0.00 ในแถวรวม', () => {
    expect(fmtAmount('157480')).toBe('157,480.00');
    expect(fmtAmount('0')).toBe('');
    expect(fmtAmount('0.00')).toBe('');
    expect(fmtAmount('0', false)).toBe('0.00');
    expect(fmtAmount(undefined, false)).toBe('0.00');
  });

  it('visibleSections: ซ่อนบัญชีที่ไม่มียอดทั้ง 6 ช่อง และซ่อนหมวดที่ไม่เหลือบัญชี', () => {
    const sections: PeriodTbSection[] = [
      { sectionName: 'สินทรัพย์หมุนเวียน', codePrefix: '11', totals: amounts({}), rows: [row('11-1201', { closingDr: '10' }), row('11-1202')] },
      { sectionName: 'ทุน', codePrefix: '31', totals: amounts({}), rows: [row('31-1101')] },
    ];
    const hidden = visibleSections(sections, true);
    expect(hidden.map((s) => s.codePrefix)).toEqual(['11']);
    expect(hidden[0].rows.map((r) => r.code)).toEqual(['11-1201']);
    expect(visibleSections(sections, false)).toBe(sections);
  });

  it('ledgerHref: พาบัญชีและช่วงวันที่ไปหน้าบัญชีแยกประเภท', () => {
    expect(ledgerHref('11-1201', '2026-11-01', '2026-11-17')).toBe(
      '/finance/general-ledger?account=11-1201&start=2026-11-01&end=2026-11-17&from=trial-balance',
    );
  });

  it('unbalancedLabels: บอกคู่ที่ไม่สมดุลเป็นคำ', () => {
    expect(unbalancedLabels({ opening: true, period: true, closing: true })).toEqual([]);
    expect(unbalancedLabels({ opening: true, period: false, closing: false })).toEqual(['ระหว่างงวด', 'ยอดคงเหลือ']);
  });
});
```

รัน: `cd "/d/BESTCHOICE APP/BESTCHOICE/apps/web" && npx vitest run src/pages/finance/__tests__/trial-balance.test.ts` → Expected: FAIL (ไม่พบโมดูล `../trial-balance`)

- [ ] **Step 2: เขียนฟังก์ชันล้วน**

สร้าง `apps/web/src/pages/finance/trial-balance.ts`:

```ts
/** งบทดลองแบบช่วงเวลา (ยอดยกมา / ระหว่างงวด / ยอดคงเหลือ) — ชนิดข้อมูลของ GET /expenses/ledger/trial-balance?periodStart= */

export const TB_AMOUNT_KEYS = ['openingDr', 'openingCr', 'periodDr', 'periodCr', 'closingDr', 'closingCr'] as const;
export type TbAmountKey = (typeof TB_AMOUNT_KEYS)[number];
export type PeriodTbAmounts = Record<TbAmountKey, string | number>;

export interface PeriodTbRow extends PeriodTbAmounts {
  code: string;
  name: string;
  type: string;
  normalBalance: string;
}

export interface PeriodTbSection {
  sectionName: string;
  codePrefix: string;
  rows: PeriodTbRow[];
  totals: PeriodTbAmounts;
}

export interface PeriodTbBalanced {
  opening: boolean;
  period: boolean;
  closing: boolean;
}

export interface PeriodTbData {
  periodStart: string;
  periodEnd: string;
  sections: PeriodTbSection[];
  totals: PeriodTbAmounts;
  isBalanced: PeriodTbBalanced;
}

const toNumber = (value: string | number | null | undefined): number => {
  if (value == null) return 0;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isNaN(n) ? 0 : n;
};

/** ยอดเงิน 2 ตำแหน่ง · ศูนย์ = เว้นว่าง (แบบ PEAK) ยกเว้นแถวรวมที่ส่ง blankZero = false */
export function fmtAmount(value: string | number | null | undefined, blankZero = true): string {
  const n = toNumber(value);
  if (n === 0 && blankZero) return '';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const hasAnyAmount = (row: PeriodTbRow): boolean => TB_AMOUNT_KEYS.some((key) => toNumber(row[key]) !== 0);

/** ซ่อนบัญชีที่ไม่มียอดทั้ง 6 ช่อง (และหมวดที่ไม่เหลือบัญชี) — แถวรวมของหมวดไม่เปลี่ยน */
export function visibleSections(sections: PeriodTbSection[], hideZero: boolean): PeriodTbSection[] {
  if (!hideZero) return sections;
  return sections
    .map((section) => ({ ...section, rows: section.rows.filter(hasAnyAmount) }))
    .filter((section) => section.rows.length > 0);
}

/** ลิงก์ไปบัญชีแยกประเภทของบัญชีนั้น ช่วงวันที่เดียวกับงบทดลอง */
export function ledgerHref(code: string, startDate: string, endDate: string): string {
  const params = new URLSearchParams({ account: code, start: startDate, end: endDate, from: 'trial-balance' });
  return `/finance/general-ledger?${params}`;
}

/** ชื่อคู่คอลัมน์ที่เดบิตรวมไม่เท่าเครดิตรวม (ว่าง = สมดุลครบ) */
export function unbalancedLabels(balanced: PeriodTbBalanced): string[] {
  return [
    ...(balanced.opening ? [] : ['ยอดยกมา']),
    ...(balanced.period ? [] : ['ระหว่างงวด']),
    ...(balanced.closing ? [] : ['ยอดคงเหลือ']),
  ];
}
```

รันเทสต์เดิม → Expected: PASS 4 tests

- [ ] **Step 3: ชื่อ + เมนู + เทสต์เมนูที่ต้องล้ม**

`apps/web/src/config/__tests__/menu.fin-groups.test.ts` — ในเทสต์ `'บัญชี & งบการเงิน รวมสมุดรายวันกับบัญชีแยกประเภท'` แทนรายการที่คาดหวังด้วย:

```ts
    expect(paths('OWNER', 'fin-statements')).toEqual([
      '/finance/general-journal', '/finance/general-ledger', '/finance/trial-balance', '/finance/balance-sheet',
      '/profit-loss', '/finance/cash-flow', '/finance/equity-statement',
    ]);
```

`apps/web/src/config/__tests__/menu.fin-labels.test.ts` — เพิ่มใน `EXPECTED`: `'/finance/trial-balance': NAV_LABELS.trialBalance,` และในเทสต์ `'ชื่อตาม PEAK'`: `expect(NAV_LABELS.trialBalance).toBe('งบทดลอง');`

รัน `npx vitest run src/config` → Expected: FAIL (ไม่มี `/finance/trial-balance` ในกลุ่ม · `NAV_LABELS.trialBalance` undefined)

แล้วแก้:

`apps/web/src/config/work-navigation.ts` — เพิ่มใน `NAV_LABELS` ต่อจาก `generalLedger`:

```ts
  trialBalance: 'งบทดลอง',
```

`apps/web/src/config/menu.ts` — เพิ่ม `Scale` ในรายการ import จาก `lucide-react` และเพิ่มใน `finStatementsSection.items` ต่อจากรายการ `/finance/general-ledger`:

```ts
    // งบทดลองแบบช่วงเวลา (ยอดยกมา / ระหว่างงวด / ยอดคงเหลือ) — กดบัญชีแล้วเปิดบัญชีแยกประเภท (2026-11-18)
    { label: NAV_LABELS.trialBalance, path: '/finance/trial-balance', icon: Scale },
```

`apps/web/src/App.tsx` — เพิ่ม lazy import ต่อจากบรรทัด `const BalanceSheetPage = lazy(...)`:

```tsx
const TrialBalancePage = lazy(() => import('@/pages/finance/TrialBalancePage'));
```

และเพิ่ม route ต่อจากบล็อก `<Route path="/finance/general-ledger" ... />`:

```tsx
          <Route
            path="/finance/trial-balance"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <TrialBalancePage />
              </ProtectedRoute>
            }
          />
```

(`npx vitest run src/config` จะผ่านหลัง Step 5 สร้างไฟล์หน้า — route-reachability อ่าน `App.tsx` เป็นข้อความ จึงผ่านได้ตั้งแต่ตอนนี้ แต่ type check ต้องรอไฟล์หน้า)

- [ ] **Step 4: เทสต์หน้าที่ต้องล้ม**

สร้าง `apps/web/src/pages/finance/__tests__/TrialBalancePage.test.tsx` — ใช้วิธี mock `@/lib/api` · `useUiFlags` · QueryClient แบบเดียวกับส่วนหัวของ `apps/web/src/pages/GeneralLedgerPage.test.tsx` (เปิดไฟล์นั้นแล้วทำตามรูปแบบ mock เดียวกัน) โดยให้ `api.get` คืนข้อมูลนี้:

```ts
const DATA = {
  periodStart: '2026-10-31T17:00:00.000Z',
  periodEnd: '2026-11-17T16:59:59.999Z',
  sections: [
    {
      sectionName: 'สินทรัพย์หมุนเวียน', codePrefix: '11',
      rows: [
        { code: '11-1201', name: 'ธนาคาร KBank', type: 'สินทรัพย์', normalBalance: 'Dr', openingDr: '250000', openingCr: '0', periodDr: '45480', periodCr: '138000', closingDr: '157480', closingCr: '0' },
        { code: '11-1202', name: 'ธนาคาร SCB (ค่าใช้จ่าย)', type: 'สินทรัพย์', normalBalance: 'Dr', openingDr: '0', openingCr: '0', periodDr: '0', periodCr: '0', closingDr: '0', closingCr: '0' },
      ],
      totals: { openingDr: '250000', openingCr: '0', periodDr: '45480', periodCr: '138000', closingDr: '157480', closingCr: '0' },
    },
  ],
  totals: { openingDr: '250000', openingCr: '250000', periodDr: '45480', periodCr: '138000', closingDr: '157480', closingCr: '0' },
  isBalanced: { opening: true, period: false, closing: false },
};
```

เรนเดอร์ด้วย `MemoryRouter initialEntries={['/finance/trial-balance?start=2026-11-01&end=2026-11-17']}` แล้วตรวจ 5 ข้อ (เทสต์ละข้อ):

1. `api.get` ถูกเรียกด้วย `'/expenses/ledger/trial-balance'` และ `{ params: { periodStart: '2026-11-01', periodEnd: '2026-11-17' } }` (วันที่มาจาก URL)
2. หัวหน้า: `screen.getByRole('heading', { level: 1, name: 'งบทดลอง' })`
3. ลิงก์ชื่อบัญชี: `screen.getByRole('link', { name: 'ธนาคาร KBank' })` มี `href` = `/finance/general-ledger?account=11-1201&start=2026-11-01&end=2026-11-17&from=trial-balance`
4. ซ่อนบัญชีที่ไม่มียอดเป็นค่าเริ่มต้น: `screen.queryByText('ธนาคาร SCB (ค่าใช้จ่าย)')` เป็น null → คลิก `screen.getByRole('checkbox', { name: 'ซ่อนบัญชีที่ไม่มียอด' })` → ชื่อบัญชีนั้นปรากฏ
5. สถานะไม่สมดุลบอกเป็นคำ: `screen.getByText('ไม่สมดุล: ระหว่างงวด, ยอดคงเหลือ')`

รัน `npx vitest run src/pages/finance/__tests__/TrialBalancePage.test.tsx` → Expected: FAIL (ไม่พบ `../TrialBalancePage`)

- [ ] **Step 5: เขียนหน้า**

สร้าง `apps/web/src/pages/finance/TrialBalancePage.tsx`:

```tsx
import { useId, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Scale } from 'lucide-react';
import api from '@/lib/api';
import { NAV_LABELS } from '@/config/work-navigation';
import { computeDefaultTimeRange } from '@/lib/date';
import { useUiFlags } from '@/hooks/useUiFlags';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import ScreenTable from '@/components/ui/ScreenTable';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { DateRangeChips } from '@/components/ui/DateRangeChips';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formControlClass, formLabelClass } from '@/components/ui/form-styles';
import {
  TB_AMOUNT_KEYS,
  fmtAmount,
  ledgerHref,
  unbalancedLabels,
  visibleSections,
  type PeriodTbData,
} from './trial-balance';

/**
 * งบทดลอง FINANCE แบบช่วงเวลา (แบบ PEAK) — ยอดยกมา / ระหว่างงวด / ยอดคงเหลือ แยกเดบิต-เครดิต
 * กดรหัสหรือชื่อบัญชี = เปิดบัญชีแยกประเภทของบัญชีนั้น ช่วงวันที่เดียวกัน
 * Routed at `/finance/trial-balance` (รับ ?start=&end= เมื่อกลับมาจากบัญชีแยกประเภท)
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const numberCell = 'whitespace-nowrap px-4 py-3 text-right align-top font-mono tabular-nums';
const groupEdge = 'border-l border-border';

function handleTableKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  const viewport = event.currentTarget;
  if (event.target !== viewport || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (viewport.scrollWidth <= viewport.clientWidth) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    viewport.scrollBy({ left: event.key === 'ArrowRight' ? 160 : -160 });
  }
}

export default function TrialBalancePage() {
  const fieldId = useId();
  const [searchParams] = useSearchParams();
  const fromUrl = (key: string) => {
    const value = searchParams.get(key);
    return value && DATE_ONLY.test(value) ? value : null;
  };
  const defaults = computeDefaultTimeRange('this_month');
  const [startDate, setStartDate] = useState(fromUrl('start') ?? defaults.startDate);
  const [endDate, setEndDate] = useState(fromUrl('end') ?? defaults.endDate);
  const [hideZero, setHideZero] = useState(true);
  const { cacheTtlReports } = useUiFlags();

  const query = useQuery({
    queryKey: ['period-trial-balance', startDate, endDate],
    queryFn: async (): Promise<PeriodTbData> => {
      const { data } = await api.get('/expenses/ledger/trial-balance', {
        params: { periodStart: startDate, periodEnd: endDate },
      });
      return data as PeriodTbData;
    },
    enabled: !!startDate && !!endDate && startDate <= endDate,
    staleTime: cacheTtlReports * 1000,
  });

  const data = query.data;
  const sections = data ? visibleSections(data.sections, hideZero) : [];
  const unbalanced = data ? unbalancedLabels(data.isBalanced) : [];
  const rangeInvalid = !!startDate && !!endDate && startDate > endDate;

  return (
    <div className="min-w-0">
      <PageHeader
        title={NAV_LABELS.trialBalance}
        subtitle="FINANCE — ยอดยกมา รายการระหว่างงวด และยอดคงเหลือของทุกบัญชี"
        icon={<Scale className="size-6" />}
      />

      <div className="mb-3">
        <DateRangeChips
          startDate={startDate}
          endDate={endDate}
          showAllChip={false}
          onChange={({ startDate: sd, endDate: ed }) => {
            setStartDate(sd);
            setEndDate(ed);
          }}
        />
      </div>

      <Card className="min-w-0">
        <CardHeader className="px-4 py-5 sm:px-6">
          <div className="flex w-full min-w-0 flex-wrap items-end gap-5">
            <div className="w-full min-w-0 sm:w-52">
              <label htmlFor={`${fieldId}-start`} className={formLabelClass}>ตั้งแต่วันที่</label>
              <ThaiDateInput
                id={`${fieldId}-start`}
                className={`${formControlClass} pr-10`}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value || defaults.startDate)}
              />
            </div>
            <div className="w-full min-w-0 sm:w-52">
              <label htmlFor={`${fieldId}-end`} className={formLabelClass}>ถึงวันที่</label>
              <ThaiDateInput
                id={`${fieldId}-end`}
                className={`${formControlClass} pr-10`}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value || defaults.endDate)}
              />
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm leading-snug sm:ml-auto">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={hideZero}
                onChange={(e) => setHideZero(e.target.checked)}
              />
              ซ่อนบัญชีที่ไม่มียอด
            </label>
          </div>
          {rangeInvalid && (
            <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
              วันเริ่มต้นต้องไม่เกินวันสิ้นสุด
            </p>
          )}
          {data && (
            <p
              className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium leading-snug ${
                unbalanced.length === 0 ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
              }`}
            >
              {unbalanced.length === 0 ? (
                <CheckCircle2 aria-hidden="true" className="size-3.5" />
              ) : (
                <AlertTriangle aria-hidden="true" className="size-3.5" />
              )}
              {unbalanced.length === 0 ? 'สมดุลทั้ง 3 คู่' : `ไม่สมดุล: ${unbalanced.join(', ')}`}
            </p>
          )}
        </CardHeader>
        <CardContent className="min-w-0 px-4 py-5 sm:px-6">
          <QueryBoundary
            isLoading={query.isLoading}
            isError={query.isError}
            error={query.error}
            onRetry={() => query.refetch()}
            errorTitle={`ไม่สามารถโหลด${NAV_LABELS.trialBalance}ได้`}
          >
            {data &&
              (sections.length === 0 ? (
                <p className="py-10 text-center text-sm leading-snug text-muted-foreground">
                  ไม่มีบัญชีที่มียอดในช่วงนี้
                </p>
              ) : (
                <div
                  role="region"
                  aria-label="ตารางงบทดลอง เลื่อนดูคอลัมน์"
                  tabIndex={0}
                  onKeyDown={handleTableKeyDown}
                  className="max-w-full overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <ScreenTable aria-label={NAV_LABELS.trialBalance} className="w-full min-w-[72rem] text-sm leading-6">
                    <thead className="bg-muted text-muted-foreground">
                      <tr>
                        <th scope="col" rowSpan={2} className="w-28 px-4 py-3 text-left font-medium">รหัส</th>
                        <th scope="col" rowSpan={2} className="px-4 py-3 text-left font-medium">ชื่อบัญชี</th>
                        <th scope="colgroup" colSpan={2} className={`px-4 pt-3 text-center font-semibold ${groupEdge}`}>ยอดยกมา</th>
                        <th scope="colgroup" colSpan={2} className={`px-4 pt-3 text-center font-semibold ${groupEdge}`}>ระหว่างงวด</th>
                        <th scope="colgroup" colSpan={2} className={`px-4 pt-3 text-center font-semibold ${groupEdge}`}>ยอดคงเหลือ</th>
                      </tr>
                      <tr>
                        {['ยอดยกมา', 'ระหว่างงวด', 'ยอดคงเหลือ'].flatMap((group) => [
                          <th key={`${group}-dr`} scope="col" className={`whitespace-nowrap px-4 pb-3 text-right font-medium ${groupEdge}`}>
                            <span className="sr-only">{group} </span>เดบิต
                          </th>,
                          <th key={`${group}-cr`} scope="col" className="whitespace-nowrap px-4 pb-3 text-right font-medium">
                            <span className="sr-only">{group} </span>เครดิต
                          </th>,
                        ])}
                      </tr>
                    </thead>
                    {sections.map((section) => (
                      <tbody key={section.codePrefix}>
                        <tr className="border-t border-border">
                          <th scope="rowgroup" colSpan={8} className="px-4 pb-2 pt-4 text-left text-sm font-semibold leading-snug text-foreground">
                            {section.sectionName}
                          </th>
                        </tr>
                        {section.rows.map((row) => {
                          const href = ledgerHref(row.code, startDate, endDate);
                          return (
                            <tr key={row.code} className="border-t border-border">
                              <td className="whitespace-nowrap px-4 py-3 align-top font-mono">
                                <Link to={href} className="text-primary hover:underline" aria-label={`${row.code} ${row.name} — ดูบัญชีแยกประเภท`}>
                                  {row.code}
                                </Link>
                              </td>
                              <td className="break-words px-4 py-3 align-top">
                                <Link to={href} className="text-primary hover:underline">{row.name}</Link>
                              </td>
                              {TB_AMOUNT_KEYS.map((key, index) => (
                                <td key={key} className={`${numberCell} ${index % 2 === 0 ? groupEdge : ''}`}>
                                  {fmtAmount(row[key])}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                        <tr className="border-t border-border bg-muted/50 font-semibold">
                          <td className="px-4 py-3" colSpan={2}>รวม{section.sectionName}</td>
                          {TB_AMOUNT_KEYS.map((key, index) => (
                            <td key={key} className={`${numberCell} ${index % 2 === 0 ? groupEdge : ''}`}>
                              {fmtAmount(section.totals[key], false)}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    ))}
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted font-bold">
                        <td className="px-4 py-3" colSpan={2}>รวมทั้งสิ้น</td>
                        {TB_AMOUNT_KEYS.map((key, index) => (
                          <td key={key} className={`${numberCell} ${index % 2 === 0 ? groupEdge : ''}`}>
                            {fmtAmount(data.totals[key], false)}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  </ScreenTable>
                </div>
              ))}
          </QueryBoundary>
          <p className="mt-4 text-sm leading-snug text-muted-foreground">
            กดรหัสหรือชื่อบัญชีเพื่อดูรายการในบัญชีแยกประเภทช่วงวันที่เดียวกัน
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

ถ้า `QueryBoundary` ไม่มี prop `errorTitle` หรือ `ScreenTable` ไม่รับ `<tfoot>`/หลาย `<tbody>` ให้ทำตามวิธีที่ `apps/web/src/pages/ShopAccountingPage.tsx` และ `apps/web/src/pages/finance/BalanceSheetPage.tsx` ใช้ (เปิดสองไฟล์นั้นดู) และจดสิ่งที่ปรับไว้ในรายงาน — ห้ามเปลี่ยนพฤติกรรมที่เทสต์ Step 4 ตรวจ

รัน `npx vitest run src/pages/finance/__tests__` → Expected: PASS

- [ ] **Step 6: หน้าบัญชีแยกประเภทรับค่าจากลิงก์ — เทสต์ที่ต้องล้ม**

`apps/web/src/pages/GeneralLedgerPage.test.tsx` — เพิ่มเทสต์ (ใช้ตัวช่วยเรนเดอร์ของไฟล์นั้น ถ้าตัวช่วยไม่รับ `initialEntries` ให้เพิ่มพารามิเตอร์ `initialEntries?: string[]` ส่งต่อให้ `MemoryRouter`):

1. เปิดด้วย `['/finance/general-ledger?account=11-1201&start=2026-11-01&end=2026-11-17&from=trial-balance']` → `api.get` ถูกเรียกด้วย URL ที่มี `accountCode=11-1201` · `periodStart=2026-11-01` · `periodEnd=2026-11-17` โดยไม่ต้องเลือกบัญชีเอง
2. เปิดด้วย URL เดียวกัน → มีลิงก์ `screen.getByRole('link', { name: 'กลับไปงบทดลอง' })` ที่ `href` = `/finance/trial-balance?start=2026-11-01&end=2026-11-17`
3. เปิดโดยไม่มีพารามิเตอร์ → ไม่มีลิงก์ "กลับไปงบทดลอง" และ `api.get` ของ general-ledger ยังไม่ถูกเรียก (พฤติกรรมเดิม)
4. `start=abc` (รูปแบบผิด) → ใช้ค่าเริ่มต้นเดิมของหน้า (ไม่ส่ง `periodStart=abc`)

รัน `npx vitest run src/pages/GeneralLedgerPage.test.tsx` → Expected: FAIL (เทสต์ใหม่ 1, 2, 4)

- [ ] **Step 7: แก้หน้าบัญชีแยกประเภท**

`apps/web/src/pages/GeneralLedgerPage.tsx`

import:

```tsx
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, BookOpen, Download, FileSpreadsheet } from 'lucide-react';
```

แทนบรรทัด state ของ `startDate` / `endDate` / `accountCode` (คง `toLocalIso` · `now` · `companyId` ตามเดิม):

```tsx
  // งบทดลองส่งบัญชีและช่วงวันที่มาทาง URL (?account=&start=&end=&from=trial-balance) — 2026-11-18
  const [searchParams] = useSearchParams();
  const dateParam = (key: string) => {
    const value = searchParams.get(key);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  };
  const fromTrialBalance = searchParams.get('from') === 'trial-balance';
  const [startDate, setStartDate] = useState(
    dateParam('start') ?? toLocalIso(new Date(now.getFullYear(), now.getMonth(), 1)),
  );
  const [endDate, setEndDate] = useState(
    dateParam('end') ?? toLocalIso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  );
  const [companyId, setCompanyId] = useState('');
  const [accountCode, setAccountCode] = useState(searchParams.get('account') ?? '');
```

เพิ่มลิงก์กลับเป็นลูกตัวแรกของ `<div>` ที่ครอบหน้า (เหนือ `<PageHeader`):

```tsx
      {fromTrialBalance && (
        <Link
          to={`/finance/trial-balance?start=${startDate}&end=${endDate}`}
          className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium leading-snug text-primary hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          กลับไป{NAV_LABELS.trialBalance}
        </Link>
      )}
```

รัน `npx vitest run src/pages/GeneralLedgerPage.test.tsx` → Expected: PASS ทั้งไฟล์ (เทสต์เดิมต้องไม่แดง)

- [ ] **Step 8: เวอร์ชัน + ตรวจทั้งหมด**

`apps/web/package.json`: `"version": "26.11.10"` → `"version": "26.11.11"`

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && ./tools/check-types.sh web
cd apps/web && npx vitest run src/config src/components/layout src/pages/finance src/pages/GeneralLedgerPage.test.tsx
npx eslint src/pages/finance/TrialBalancePage.tsx src/pages/finance/trial-balance.ts src/pages/GeneralLedgerPage.tsx src/config src/App.tsx
```

Expected: 0 type errors · vitest PASS (รวม `route-reachability.test.ts` ทั้งสองทิศ และ `menu.fin-groups` / `menu.fin-labels`) · eslint 0 errors

- [ ] **Step 9: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/web/src apps/web/package.json
git commit -m "หน้างบทดลอง FINANCE แบบช่วงเวลา + กดบัญชีไปบัญชีแยกประเภท (เว็บ 26.11.11)

/finance/trial-balance — ยอดยกมา / ระหว่างงวด / ยอดคงเหลือ แยกเดบิต-เครดิต · รวมต่อหมวด · ธงสมดุล 3 คู่ ·
ซ่อนบัญชีที่ไม่มียอด · อยู่กลุ่ม บัญชี & งบการเงิน (เจ้าของ / ผจก.การเงิน / ฝ่ายบัญชี)
บัญชีแยกประเภทรับ ?account=&start=&end=&from=trial-balance + ปุ่มกลับไปงบทดลองช่วงเดิม

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

## นอกขอบเขต (แจ้งเจ้าของ)

- `MonthlyCloseService.generateReportSnapshots` (`monthly-close.service.ts` — `getTrialBalance(new Date(asOfDate), 'ALL')`) และ `ConsolidatedController` ยังแปลงวันที่แบบเดิม — ภาพงบทดลองที่เก็บตอนปิดงวดอาจไม่รวมรายการหลัง 07:00 น. ของวันสุดท้าย · ต้องให้เจ้าของ/ฝ่ายบัญชีตัดสินก่อนแตะขั้นตอนปิดงวด
- endpoint ที่ยังแปลงวันที่แบบเดิม (พบตอนตรวจทั้ง branch 2026-11-18): `ledger/general-journal` (สมุดรายวัน — กรองด้วย `postedAt` จาก 07:00 น. วันเริ่มถึง 07:00 น. วันสิ้นสุด จึงไม่แสดงเกือบทั้งวันสุดท้าย · อยู่กลุ่มเมนูเดียวกับงบทดลอง ควรเป็นงานถัดไป) · `ledger/aging` · `ledger/bad-debt` · `inter-co/report`
- หน้า "งบกำไรขาดทุน" (`/profit-loss`) คำนวณจากยอดขาย (`/reports/profit-loss`) ไม่ใช่จากสมุดบัญชี ⇒ ยอดรายได้/ค่าใช้จ่ายไม่ตรงกับงบทดลองช่วงเดียวกัน (เป็นมาก่อนงานนี้)
- ปุ่มส่งออก Excel ของงบทดลอง · งบทดลองสำหรับ VIEWER · e2e ของหน้าใหม่
