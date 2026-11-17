# เมนูโซนไฟแนนซ์ — จัดกลุ่มและตั้งชื่อตาม PEAK · แผนลงมือ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** จัดเมนูโซนไฟแนนซ์ของ เจ้าของ / ผจก.การเงิน / ฝ่ายบัญชี ให้กลุ่มหนึ่งมีงานชนิดเดียวและเรียงเหมือนกันทุกตำแหน่ง และเปลี่ยนชื่อเมนูที่เป็นศัพท์บัญชีให้ตรงกับ PEAK (เมนูกับหัวหน้าใช้ชื่อเดียวกัน)

**Architecture:** ชื่อเมนูศัพท์บัญชีเก็บที่เดียวใน `NAV_LABELS` (`config/work-navigation.ts` — ไฟล์นี้ประกาศไว้แล้วว่าเป็นชื่อกลางของเมนูและหัวหน้า) · กลุ่มที่สมาชิกเหมือนกันทุกตำแหน่งเขียนเป็นค่าคงที่ใช้ร่วมใน `config/menu.ts` แบบเดียวกับ `assetMenuSection` ที่มีอยู่ · กลุ่มที่สิทธิ์ต่างกัน (ติดตามหนี้ · ปิดงวด & ทุน · รายงาน) ยังเขียนแยกต่อตำแหน่ง แต่ใช้ชื่อกลุ่มและรายการย่อยร่วมกัน · **ไม่**สร้างระบบกรองเมนูตามสิทธิ์ใหม่ (สิทธิ์ยังอยู่ที่ `ProtectedRoute` ใน `App.tsx` ที่เดียว)

**Tech Stack:** React 18 + TypeScript + Vite · Vitest (`apps/web`) · Playwright (e2e)

## Global Constraints

- **ห้ามเริ่ม Task 1 จนกว่าเจ้าของยืนยันโครงในแผนนี้** — 9 กลุ่มปัจจุบันของเจ้าของมาจากไฟล์ "BESTCHOICE FINANCE" ที่เจ้าของส่งมาเอง (`menu.ts` คอมเมนต์ "FIN zone restructure (per owner CSV)")
- คำสั่งเจ้าของที่ต้องคงไว้: "สินทรัพย์" เป็นกลุ่มแยก (`assetMenuSection`) · "รับเครื่องคืน / ยึดคืน" อยู่**โซนไฟแนนซ์ที่เดียว**ของเจ้าของ (คำสั่ง 2026-08-29 — ย้ายกลุ่มได้ ห้ามย้ายโซน)
- ไม่เปลี่ยนที่อยู่หน้า (path) ใด ๆ · ไม่เปลี่ยน `ProtectedRoute` ใน `App.tsx` · ไม่แตะเมนูโซนร้าน (shop) ยกเว้นชื่อเมนูตามตาราง Task 1
- `route-reachability.test.ts` ต้องเขียวทั้งสองทิศ (หน้าที่มีสิทธิ์ต้องมีเมนู · เมนูที่แสดงต้องมีสิทธิ์) และ `KNOWN_GAPS_*` ต้องว่างเหมือนเดิม
- กลุ่มใช้ร่วม (`fin-*`) ใส่ได้เฉพาะเมนูที่ `ProtectedRoute` อนุญาตครบทั้ง OWNER / FINANCE_MANAGER / ACCOUNTANT
- ห้ามเอาเมนูใดออกจากทุกกลุ่มของโซน — `resolveZoneForPath` หาไม่เจอ = MainLayout เด้งพร้อม toast "ไม่มีสิทธิ์"
- ข้อความบนจอเป็นภาษาไทย · ใช้ `leading-snug` · ห้าม hardcode สี (`.claude/rules/frontend.md`)
- ทำบน branch ใหม่จาก `origin/main` (เครื่องนี้ค้างที่ `fix/expense-create-followups-2` ซึ่ง merge แล้ว)
- เวอร์ชันเว็บ (`apps/web/package.json`) เพิ่ม patch หนึ่งขั้นจากค่าบน `origin/main` ตอนเริ่มงาน (ณ วันเขียนแผน = `26.11.8` → `26.11.9`)
- commit ลงท้ายด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## โครงเป้าหมาย (โซนไฟแนนซ์)

ลำดับกลุ่มเหมือนกันทุกตำแหน่ง · ✱ = กลุ่มใช้ร่วม (ค่าคงที่ตัวเดียว)

| ลำดับ | กลุ่ม | OWNER | FINANCE_MANAGER | ACCOUNTANT |
|---|---|---|---|---|
| 1 | ภาพรวม | หน้าหลัก | หน้าหลัก · งานของทีม · เวลาทำงานของฉัน | ภาพรวม การเงิน · งานของทีม · เวลาทำงานของฉัน |
| — | ลูกค้า & สัญญา (FM เท่านั้น) | — | สัญญาผ่อนชำระ · ลูกค้า · ตรวจเครดิต | — |
| 2 | ✱ รายรับ | รับชำระค่างวด · รายได้อื่น · เอกสารยกเลิกสัญญา · ใบเสร็จอิเล็กทรอนิกส์อัตโนมัติ | (เหมือนกัน) | (เหมือนกัน) |
| 3 | ติดตามหนี้ | ติดตามลูกค้าค้างชำระ · จัดการจดหมาย · ล็อคเครื่อง (MDM) · รับเครื่องคืน / ยึดคืน | ติดตามลูกค้าค้างชำระ · จัดการจดหมาย · รับเครื่องคืน / ยึดคืน | จัดการจดหมาย · รับเครื่องคืน / ยึดคืน |
| 4 | ✱ รายจ่าย | จ่ายให้หน้าร้าน · บันทึกค่าใช้จ่าย · บิลประจำ | (เหมือนกัน) | (เหมือนกัน) |
| 5 | ✱ สินทรัพย์ | สินทรัพย์ถาวร (ของเดิม `assetMenuSection`) | (เหมือนกัน) | (เหมือนกัน) |
| 6 | ✱ การเงิน | เงินสด/ธนาคาร | (เหมือนกัน) | (เหมือนกัน) |
| 7 | ✱ ภาษี | ภาษีมูลค่าเพิ่ม · ภาษีหัก ณ ที่จ่าย · ภ.ง.ด.1 เงินเดือน · ประกันสังคม · ภ.ง.ด.1ก/50 ทวิ · e-Tax · รายการบัญชี VAT อัตโนมัติ | (เหมือนกัน) | (เหมือนกัน) |
| 8 | ✱ บัญชี & งบการเงิน | สมุดรายวัน · บัญชีแยกประเภท · งบฐานะการเงิน · งบกำไรขาดทุน · งบกระแสเงินสด · งบส่วนของผู้ถือหุ้น | (เหมือนกัน) | (เหมือนกัน) |
| 9 | ปิดงวด & ทุน | ปิดรายเดือน · ปิดสิ้นปี · **งวดบัญชี** · ตรวจสอบบัญชี · ส่งออก PEAK CSV · ส่วนของผู้ถือหุ้น · ทะเบียนปันผล | ไม่มีงวดบัญชี | ไม่มีงวดบัญชี |
| 10 | รายงาน | รายงานรวม · ยอดขายย้อนหลัง · อายุลูกหนี้ · หนี้สูญ · ลูกหนี้ระหว่างบริษัท · **ค่าคอมมิชชัน** | มีค่าคอมมิชชัน | ไม่มีค่าคอมมิชชัน |
| 11 | ข้อมูลอ้างอิง (ACC เท่านั้น) | — | — | ของเดิม 6 รายการ + พิมพ์สติกเกอร์ · การจอง / มัดจำ · หลังการขาย |

ถอดออก: กลุ่ม "การแจ้งเตือนลูกค้า" (OWNER) · "บัญชีธนาคาร/เงินสด" / "ธนาคาร" (แทนด้วย ✱ การเงิน) · "งานประจำวัน" ของ ACC (สมาชิกกระจายไปกลุ่มที่ถูก) · VIEWER คงโครงเดิม เปลี่ยนเฉพาะชื่อ

## File Structure

| ไฟล์ | หน้าที่ในงานนี้ |
|---|---|
| `apps/web/src/config/work-navigation.ts` | เพิ่มชื่อเมนูศัพท์บัญชีใน `NAV_LABELS` |
| `apps/web/src/config/menu.ts` | ใช้ชื่อจาก `NAV_LABELS` · เพิ่มกลุ่มใช้ร่วม `fin*` · จัดกลุ่ม OWNER / FM / ACC ใหม่ |
| `apps/web/src/config/__tests__/menu.fin-labels.test.ts` (ใหม่) | ปักว่าหน้าเดียวกันชื่อเดียวกันทุกตำแหน่ง ทุกโซน |
| `apps/web/src/config/__tests__/menu.fin-groups.test.ts` (ใหม่) | ปักลำดับกลุ่มและสมาชิกของโซนไฟแนนซ์ทั้งสามตำแหน่ง |
| `apps/web/src/config/menu.test.ts` | แก้ key กลุ่มเดิมที่ถูกแทน |
| `apps/web/src/pages/finance/BalanceSheetPage.tsx` · `finance/VatPage.tsx` · `finance/WhtPage.tsx` · `BankAccountsPage.tsx` · `ExpensesPage.tsx` · `ProfitLossPage.tsx` · `GeneralLedgerPage.tsx` | หัวหน้าใช้ชื่อจาก `NAV_LABELS` |
| `apps/web/e2e/sp6-bank-accounts.spec.ts` | หัวหน้าเงินสด/ธนาคารเปลี่ยนชื่อ |
| `apps/web/package.json` | เพิ่มเวอร์ชัน |

---

### Task 1: ชื่อเมนูศัพท์บัญชีตาม PEAK — ชื่อกลางที่เดียว ใช้ทั้งเมนูและหัวหน้า

**Files:**
- Modify: `apps/web/src/config/work-navigation.ts:5-13`
- Modify: `apps/web/src/config/menu.ts` (ทุกบรรทัดที่ระบุในขั้น 3)
- Modify: `apps/web/src/pages/finance/BalanceSheetPage.tsx:112,136` · `apps/web/src/pages/finance/VatPage.tsx:383` · `apps/web/src/pages/finance/WhtPage.tsx:107` · `apps/web/src/pages/BankAccountsPage.tsx:565` · `apps/web/src/pages/ExpensesPage.tsx:535-536` · `apps/web/src/pages/ProfitLossPage.tsx:150,192` · `apps/web/src/pages/GeneralLedgerPage.tsx:169`
- Modify: `apps/web/e2e/sp6-bank-accounts.spec.ts:35,54`
- Modify: `apps/web/src/pages/finance/__tests__/VatPage.test.tsx:11` (คอมเมนต์อ้างชื่อเมนูเก่า)
- Test: `apps/web/src/config/__tests__/menu.fin-labels.test.ts` (ใหม่)

**Interfaces:**
- Produces: `NAV_LABELS.overdue` · `.expenses` · `.cashBank` · `.vat` · `.wht` · `.generalJournal` · `.generalLedger` · `.balanceSheet` · `.profitLoss` · `.cashFlow` · `.equityStatement` (ค่าเป็น string literal ผ่าน `as const`) — Task 2 ใช้ชื่อเหล่านี้ในกลุ่มใช้ร่วม

- [ ] **Step 1: สร้าง branch**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
git fetch origin main
git switch -c feat/fin-menu-peak-groups origin/main
```

- [ ] **Step 2: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/web/src/config/__tests__/menu.fin-labels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getSidebarForRole, getZoneConfigForRole, type MenuItem, type Zone } from '../menu';
import { NAV_LABELS } from '../work-navigation';

/**
 * ชื่อเมนูศัพท์บัญชีตาม PEAK (2026-11-17) — หน้าเดียวกันต้องชื่อเดียวกันทุกตำแหน่ง ทุกโซน
 * เดิมหน้า /expenses มี 2 ชื่อ ("ค่าใช้จ่ายดำเนินงาน" / "บันทึกรายจ่าย") และ /finance/vat สลับลำดับ
 * เพราะเมนูแต่ละตำแหน่งเขียนชื่อเอง — ตอนนี้ทุกที่อ่านจาก NAV_LABELS
 */
const ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER'];
const ZONES: Zone[] = ['shop', 'fin'];

const EXPECTED: Record<string, string> = {
  '/overdue': NAV_LABELS.overdue,
  '/expenses': NAV_LABELS.expenses,
  '/finance/bank-accounts': NAV_LABELS.cashBank,
  '/finance/vat': NAV_LABELS.vat,
  '/finance/wht': NAV_LABELS.wht,
  '/finance/general-journal': NAV_LABELS.generalJournal,
  '/finance/general-ledger': NAV_LABELS.generalLedger,
  '/finance/balance-sheet': NAV_LABELS.balanceSheet,
  '/profit-loss': NAV_LABELS.profitLoss,
  '/finance/cash-flow': NAV_LABELS.cashFlow,
  '/finance/equity-statement': NAV_LABELS.equityStatement,
};

function itemsOf(role: string, zone: Zone): MenuItem[] {
  return getSidebarForRole(role, zone).flatMap((s) => s.items.flatMap((i) => [i, ...(i.children ?? [])]));
}

describe('ชื่อเมนูศัพท์บัญชี — ชื่อเดียวทุกตำแหน่ง', () => {
  it('ชื่อตาม PEAK', () => {
    expect(NAV_LABELS.balanceSheet).toBe('งบฐานะการเงิน');
    expect(NAV_LABELS.profitLoss).toBe('งบกำไรขาดทุน');
    expect(NAV_LABELS.generalLedger).toBe('บัญชีแยกประเภท');
    expect(NAV_LABELS.expenses).toBe('บันทึกค่าใช้จ่าย');
    expect(NAV_LABELS.vat).toBe('ภาษีมูลค่าเพิ่ม (ภ.พ.30)');
    expect(NAV_LABELS.wht).toBe('ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.1/3/53)');
    expect(NAV_LABELS.cashBank).toBe('เงินสด/ธนาคาร');
  });

  for (const role of ROLES) {
    for (const zone of ZONES) {
      it(`${role} โซน ${zone}: เมนูศัพท์บัญชีใช้ชื่อจาก NAV_LABELS`, () => {
        const wrong = itemsOf(role, zone)
          .filter((i) => i.path in EXPECTED && i.label !== EXPECTED[i.path])
          .map((i) => `${i.path} = "${i.label}" (ควรเป็น "${EXPECTED[i.path]}")`);
        expect(wrong).toEqual([]);
      });
    }
  }

  it('แถบล่างมือถือของ VIEWER ไม่เหลือชื่อเก่า', () => {
    const labels = getZoneConfigForRole('VIEWER')!.bottomNav.fin.map((i) => i.label);
    expect(labels).not.toContain('งบดุล');
    expect(labels).not.toContain('P&L');
  });
});
```

- [ ] **Step 3: รันให้เห็นว่าล้ม**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE/apps/web"
npx vitest run src/config/__tests__/menu.fin-labels.test.ts
```

Expected: FAIL — TypeScript/vitest แจ้ง `NAV_LABELS.balanceSheet` เป็น `undefined` และรายการชื่อผิด เช่น `/finance/balance-sheet = "งบดุล"`

- [ ] **Step 4: เพิ่มชื่อใน `NAV_LABELS`**

`apps/web/src/config/work-navigation.ts` แทนที่บล็อก `NAV_LABELS` ทั้งก้อนด้วย:

```ts
/** Names shared by the sidebar, search, page titles and staff start screen. */
export const NAV_LABELS = {
  home: 'หน้าหลัก',
  sales: 'ขายสินค้า',
  customers: 'ลูกค้า',
  contracts: 'สัญญาผ่อนชำระ',
  payments: 'รับชำระค่างวด',
  stock: 'คลังสินค้า',
  chat: 'แชทลูกค้า',
  // โซนไฟแนนซ์ — ศัพท์บัญชีตาม PEAK (2026-11-17) · ใช้ทั้งเมนูและหัวหน้า ห้ามเขียนชื่อเองที่อื่น
  overdue: 'ติดตามลูกค้าค้างชำระ',
  expenses: 'บันทึกค่าใช้จ่าย',
  cashBank: 'เงินสด/ธนาคาร',
  vat: 'ภาษีมูลค่าเพิ่ม (ภ.พ.30)',
  wht: 'ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.1/3/53)',
  generalJournal: 'สมุดรายวัน',
  generalLedger: 'บัญชีแยกประเภท',
  balanceSheet: 'งบฐานะการเงิน',
  profitLoss: 'งบกำไรขาดทุน',
  cashFlow: 'งบกระแสเงินสด',
  equityStatement: 'งบส่วนของผู้ถือหุ้น',
} as const;
```

- [ ] **Step 5: เปลี่ยนชื่อในเมนู**

ใน `apps/web/src/config/menu.ts` แทนชื่อเขียนตายตัวด้วย `NAV_LABELS` ทุกจุดตามตารางนี้ (หาด้วย path — ทุกตำแหน่ง ทุกโซน รวม BRANCH_MANAGER และ VIEWER):

| path | ชื่อเดิมที่เจอ | แทนด้วย |
|---|---|---|
| `/overdue` | `'ค้างชำระ'` (bm-followup) · `'ติดตามหนี้'` (fm-collection) · `'ติดตามลูกค้าค้างชำระ'` (owner-fin-revenue) | `NAV_LABELS.overdue` |
| `/expenses` | `'บันทึกรายจ่าย'` · `'ค่าใช้จ่ายดำเนินงาน'` | `NAV_LABELS.expenses` |
| `/finance/bank-accounts` | `'บัญชีเงินสด/ธนาคาร'` · `'บัญชีธนาคาร'` | `NAV_LABELS.cashBank` |
| `/finance/vat` | `'ภ.พ.30 (VAT)'` · `'VAT (ภ.พ.30)'` | `NAV_LABELS.vat` |
| `/finance/wht` | `'ภ.ง.ด. 1/3/53 (WHT)'` · `'WHT (ภ.ง.ด. 1/3/53)'` | `NAV_LABELS.wht` |
| `/finance/general-journal` | `'สมุดรายวัน'` | `NAV_LABELS.generalJournal` |
| `/finance/general-ledger` | `'สมุดแยกประเภท'` | `NAV_LABELS.generalLedger` |
| `/finance/balance-sheet` | `"งบดุล"` | `NAV_LABELS.balanceSheet` |
| `/profit-loss` | `'กำไร-ขาดทุน (P&L)'` | `NAV_LABELS.profitLoss` |
| `/finance/cash-flow` | `'งบกระแสเงินสด'` | `NAV_LABELS.cashFlow` |
| `/finance/equity-statement` | `"งบส่วนของผู้ถือหุ้น"` | `NAV_LABELS.equityStatement` |

ตัวอย่างบรรทัดหลังแก้:

```ts
        { label: NAV_LABELS.balanceSheet, path: '/finance/balance-sheet', icon: Landmark },
        { label: NAV_LABELS.profitLoss, path: '/profit-loss', icon: PieChart },
```

**ไม่**เปลี่ยนแถบล่างมือถือที่ใช้ชื่อสั้น (`'ค้างชำระ'` · `'รายจ่าย'` ฯลฯ) ยกเว้นของ VIEWER (`menu.ts` บล็อก `VIEWER_CONFIG.bottomNav`):

```ts
  bottomNav: [
    { label: 'รายงาน', path: '/reports', icon: BarChart3 },
    { label: 'งบฐานะ', path: '/finance/balance-sheet', icon: PieChart },
    { label: 'กำไรขาดทุน', path: '/profit-loss', icon: PieChart },
    { label: "ประวัติการดำเนินการ", path: '/audit-logs', icon: ScrollText },
  ],
```

แก้คอมเมนต์ใน `FINANCE_MANAGER_CONFIG` ที่เขียน "(งบดุล/งบกระแสเงินสด/สมุดรายวัน/แยกประเภท/" เป็น "(งบฐานะการเงิน/งบกระแสเงินสด/สมุดรายวัน/บัญชีแยกประเภท/"

- [ ] **Step 6: รันเทสต์ให้ผ่าน**

```bash
npx vitest run src/config
```

Expected: PASS ทุกไฟล์ใน `src/config` (รวม `route-reachability.test.ts` · `menu.test.ts` · `menu.fin-labels.test.ts`)

- [ ] **Step 7: หัวหน้าใช้ชื่อเดียวกับเมนู**

ทุกไฟล์เพิ่ม `import { NAV_LABELS } from '@/config/work-navigation';` (ถ้ายังไม่มี) แล้วแก้:

`apps/web/src/pages/finance/BalanceSheetPage.tsx`
```tsx
        title={NAV_LABELS.balanceSheet}
```
```tsx
        errorTitle={`ไม่สามารถโหลด${NAV_LABELS.balanceSheet}ได้`}
```

`apps/web/src/pages/finance/VatPage.tsx`
```tsx
        title={`${NAV_LABELS.vat} — รายเดือน`}
```

`apps/web/src/pages/finance/WhtPage.tsx`
```tsx
        title={`${NAV_LABELS.wht} — รายเดือน`}
```

`apps/web/src/pages/BankAccountsPage.tsx`
```tsx
        title={NAV_LABELS.cashBank}
```

`apps/web/src/pages/ProfitLossPage.tsx` (ค่าเท่าเดิม — เปลี่ยนให้อ่านจากที่เดียว)
```tsx
        title={NAV_LABELS.profitLoss}
```
```tsx
        errorTitle={`ไม่สามารถโหลด${NAV_LABELS.profitLoss}ได้`}
```

`apps/web/src/pages/GeneralLedgerPage.tsx` (ค่าเท่าเดิม)
```tsx
        title={NAV_LABELS.generalLedger}
```

`apps/web/src/pages/ExpensesPage.tsx:535-536`
```tsx
            <h1 className="text-base font-semibold leading-snug text-foreground break-words">{NAV_LABELS.expenses}</h1>
            <p className="text-sm text-muted-foreground leading-snug">รายการค่าใช้จ่ายและติดตามการจ่ายเงิน</p>
```

`apps/web/src/pages/finance/__tests__/VatPage.test.tsx:11` แก้คอมเมนต์ `(เมนู "VAT (ภ.พ.30)")` เป็น `(เมนู "ภาษีมูลค่าเพิ่ม (ภ.พ.30)")`

- [ ] **Step 8: แก้ e2e ที่อ้างหัวหน้าเงินสด/ธนาคาร**

`apps/web/e2e/sp6-bank-accounts.spec.ts` บรรทัด 35 และ 54 — ใช้ role heading (ชื่อเดียวกันอยู่ในเมนูด้วย `getByText` จะเจอสองที่แล้ว strict mode ล้ม):

```ts
    await expect(page.getByRole('heading', { name: 'เงินสด/ธนาคาร' })).toBeVisible();
```

- [ ] **Step 9: หาเทสต์ที่ยังอ้างชื่อเก่า**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE/apps/web"
grep -rnE "งบดุล|VAT \(ภ\.พ\.30\)|WHT \(ภ\.ง\.ด|บัญชีเงินสดและธนาคาร|กำไร-ขาดทุน \(P&L\)|สมุดแยกประเภท" src e2e --include=*.ts --include=*.tsx | grep -v node_modules
```

Expected: เหลือเฉพาะข้อความที่ไม่ใช่ชื่อเมนู/หัวหน้า (เช่น `BankAccountsPage.tsx:368` "สมุดแยกประเภท หรือย่อช่วงเวลาลง" ในคำอธิบาย และ `SettingsPage/tabs/VatTab.tsx` หัวการ์ดตั้งค่า) · ถ้าเจอเทสต์ที่ assert หัวหน้าเก่า ให้แก้เป็นชื่อจาก `NAV_LABELS`

- [ ] **Step 10: ตรวจชนิดและรันเทสต์หน้า**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
./tools/check-types.sh web
cd apps/web
npx vitest run src/config src/pages/finance src/pages/ProfitLossPage src/pages/GeneralLedgerPage src/pages/BankAccountsPage src/pages/ExpensesPage
npx eslint src/config src/pages/finance/BalanceSheetPage.tsx src/pages/finance/VatPage.tsx src/pages/finance/WhtPage.tsx src/pages/BankAccountsPage.tsx src/pages/ExpensesPage.tsx src/pages/ProfitLossPage.tsx src/pages/GeneralLedgerPage.tsx e2e/sp6-bank-accounts.spec.ts
```

Expected: type check 0 errors · vitest PASS · eslint ไม่มี error (ไฟล์เทสต์ที่ไม่มีอยู่ใน path ที่ส่ง vitest จะข้ามเอง)

- [ ] **Step 11: Commit**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
git add apps/web/src/config apps/web/src/pages apps/web/e2e/sp6-bank-accounts.spec.ts
git commit -m "เมนูไฟแนนซ์: ชื่อศัพท์บัญชีตาม PEAK เก็บที่ NAV_LABELS ที่เดียว (เมนู + หัวหน้า)

งบดุล → งบฐานะการเงิน · กำไร-ขาดทุน (P&L) → งบกำไรขาดทุน · สมุดแยกประเภท → บัญชีแยกประเภท
บันทึกรายจ่าย/ค่าใช้จ่ายดำเนินงาน → บันทึกค่าใช้จ่าย · VAT/WHT ชื่อไทยนำ · เงินสด/ธนาคาร
หน้าเดียวกันชื่อเดียวกันทุกตำแหน่ง ทุกโซน (ปักที่ menu.fin-labels.test.ts)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: จัดกลุ่มโซนไฟแนนซ์ใหม่ + กลุ่มใช้ร่วม

**Files:**
- Modify: `apps/web/src/config/menu.ts` (เพิ่มค่าคงที่ต่อจาก `assetMenuSection` · แทน `sidebar` ส่วนไฟแนนซ์ของ `FINANCE_MANAGER_CONFIG` · `ACCOUNTANT_CONFIG` · `OWNER_CONFIG`)
- Modify: `apps/web/src/config/menu.test.ts:101-116,159-163`
- Modify: `apps/web/src/components/layout/__tests__/SettingsNav.test.tsx:88` (คอมเมนต์อ้าง `acc-daily`)
- Modify: `apps/web/package.json` (version)
- Test: `apps/web/src/config/__tests__/menu.fin-groups.test.ts` (ใหม่)

**Interfaces:**
- Consumes: `NAV_LABELS.*` จาก Task 1
- Produces: ค่าคงที่ใน `menu.ts` (ไม่ export): `finRevenueSection` · `finExpenseSection` · `finCashSection` · `finTaxSection` · `finStatementsSection` (ชนิด `MenuSection`, key `fin-revenue` / `fin-expense` / `fin-cash` / `fin-tax` / `fin-statements`) · `FIN_CLOSE_HEAD_ITEMS` · `FIN_CLOSE_TAIL_ITEMS` · `FIN_REPORT_ITEMS` (ชนิด `MenuItem[]`) · `COMMISSIONS_REPORT_ITEM` (ชนิด `MenuItem`) · key กลุ่มต่อตำแหน่งใหม่ `owner-collection` · `acc-overview` · `acc-revenue` ถูกแทนด้วย `fin-revenue` (ไม่มี key นี้) · `acc-collection`

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/web/src/config/__tests__/menu.fin-groups.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getSidebarForRole, resolveZoneForPath } from '../menu';

/**
 * จัดกลุ่มโซนไฟแนนซ์ตาม PEAK (2026-11-17) — กลุ่มหนึ่งมีงานชนิดเดียว เรียงเหมือนกันทุกตำแหน่ง
 * กลุ่ม fin-* เป็นค่าคงที่ใช้ร่วม (แบบ assetMenuSection) ⇒ สมาชิกเหมือนกันโดยโครงสร้าง
 */
const fin = (role: string) => getSidebarForRole(role, 'fin');
const labels = (role: string) => fin(role).map((s) => s.label);
const paths = (role: string, key: string) =>
  fin(role).find((s) => s.key === key)?.items.map((i) => i.path);

const SHARED_TAIL = ['รายรับ', 'ติดตามหนี้', 'รายจ่าย', 'สินทรัพย์', 'การเงิน', 'ภาษี', 'บัญชี & งบการเงิน', 'ปิดงวด & ทุน', 'รายงาน'];

describe('โซนไฟแนนซ์ — ลำดับกลุ่ม', () => {
  it('OWNER', () => {
    expect(labels('OWNER')).toEqual(['ภาพรวม', ...SHARED_TAIL]);
  });
  it('FINANCE_MANAGER', () => {
    expect(labels('FINANCE_MANAGER')).toEqual(['ภาพรวม', 'ลูกค้า & สัญญา', ...SHARED_TAIL]);
  });
  it('ACCOUNTANT', () => {
    expect(labels('ACCOUNTANT')).toEqual(['ภาพรวม', ...SHARED_TAIL, 'ข้อมูลอ้างอิง']);
  });
});

describe('โซนไฟแนนซ์ — กลุ่มใช้ร่วมเป็นตัวเดียวกันทุกตำแหน่ง', () => {
  it.each(['fin-revenue', 'fin-expense', 'asset', 'fin-cash', 'fin-tax', 'fin-statements'])('%s', (key) => {
    const [o, f, a] = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].map((r) => fin(r).find((s) => s.key === key));
    expect(o).toBeDefined();
    expect(f).toBe(o);
    expect(a).toBe(o);
  });

  it('รายรับ มีใบเสร็จอิเล็กทรอนิกส์อัตโนมัติ (ไม่ใช่กลุ่มแยกเมนูเดียว)', () => {
    expect(paths('OWNER', 'fin-revenue')).toEqual([
      '/payments', '/other-income', '/finance/contract-cancellation', '/finance/e-receipt-auto',
    ]);
  });

  it('บัญชี & งบการเงิน รวมสมุดรายวันกับบัญชีแยกประเภท', () => {
    expect(paths('OWNER', 'fin-statements')).toEqual([
      '/finance/general-journal', '/finance/general-ledger', '/finance/balance-sheet',
      '/profit-loss', '/finance/cash-flow', '/finance/equity-statement',
    ]);
  });
});

describe('โซนไฟแนนซ์ — กลุ่มที่สิทธิ์ต่างกัน', () => {
  it('ติดตามหนี้: งานทวงหนี้ออกจากกลุ่มรายรับแล้ว', () => {
    expect(paths('OWNER', 'owner-collection')).toEqual(['/overdue', '/letters', '/mdm', '/repossessions']);
    expect(paths('FINANCE_MANAGER', 'fm-collection')).toEqual(['/overdue', '/letters', '/repossessions']);
    expect(paths('ACCOUNTANT', 'acc-collection')).toEqual(['/letters', '/repossessions']);
  });

  it('ยึดคืนของเจ้าของยังอยู่โซนไฟแนนซ์ที่เดียว (คำสั่งเจ้าของ 2026-08-29)', () => {
    expect(resolveZoneForPath('OWNER', '/repossessions')).toBe('fin');
    expect(getSidebarForRole('OWNER', 'shop').flatMap((s) => s.items.map((i) => i.path))).not.toContain('/repossessions');
  });

  it('ปิดงวด & ทุน: งวดบัญชีมีเฉพาะเจ้าของ', () => {
    const tail = ['/financial-audit', '/finance/peak-export', '/finance/equity', '/finance/dividend-register'];
    expect(paths('OWNER', 'owner-period-close')).toEqual(['/monthly-close', '/finance/year-end-closing', '/accounting/periods', ...tail]);
    expect(paths('FINANCE_MANAGER', 'fm-closing')).toEqual(['/monthly-close', '/finance/year-end-closing', ...tail]);
    expect(paths('ACCOUNTANT', 'acc-close')).toEqual(['/monthly-close', '/finance/year-end-closing', ...tail]);
  });

  it('รายงาน: ค่าคอมมิชชันเฉพาะเจ้าของกับผจก.การเงิน', () => {
    const base = ['/reports', '/imported-sales', '/finance/aging-report', '/finance/bad-debt-report', '/finance/intercompany-report'];
    expect(paths('OWNER', 'owner-reports')).toEqual([...base, '/commissions']);
    expect(paths('FINANCE_MANAGER', 'fm-reports')).toEqual([...base, '/commissions']);
    expect(paths('ACCOUNTANT', 'acc-reports')).toEqual(base);
  });

  it('ไม่มีกลุ่มเมนูเดียวที่ถอดแล้ว', () => {
    const keys = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].flatMap((r) => fin(r).map((s) => s.key));
    for (const gone of ['owner-fin-notifications', 'owner-bank', 'fm-bank', 'acc-bank', 'acc-daily']) {
      expect(keys).not.toContain(gone);
    }
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE/apps/web"
npx vitest run src/config/__tests__/menu.fin-groups.test.ts
```

Expected: FAIL — ลำดับกลุ่มของ OWNER ได้ `['ภาพรวม', 'รายรับ', 'รายจ่าย', 'สินทรัพย์', 'ปิดบัญชี', ...]` · ไม่พบ key `fin-revenue`

- [ ] **Step 3: เพิ่มกลุ่มใช้ร่วม**

`apps/web/src/config/menu.ts` วางต่อจากบล็อก `assetMenuSection` (ก่อน `/* ── SALES — พนักงานขาย`):

```ts
/* ── โซนไฟแนนซ์ — กลุ่มใช้ร่วม OWNER / FINANCE_MANAGER / ACCOUNTANT (PEAK 2026-11-17) ──
 * จัดตาม PEAK: กลุ่มหนึ่งมีงานชนิดเดียว · ลำดับกลุ่มทุกตำแหน่ง
 *   ภาพรวม → รายรับ → ติดตามหนี้ → รายจ่าย → สินทรัพย์ → การเงิน → ภาษี
 *   → บัญชี & งบการเงิน → ปิดงวด & ทุน → รายงาน
 * ใช้ร่วมแบบเดียวกับ assetMenuSection — ใส่ได้เฉพาะเมนูที่ ProtectedRoute อนุญาตครบทั้ง 3 ตำแหน่ง
 * (ไม่งั้น route-reachability ทิศ B แดง) · กลุ่มที่สิทธิ์ต่างกันเขียนต่อตำแหน่ง ใช้รายการย่อยด้านล่าง
 */
const finRevenueSection: MenuSection = {
  key: 'fin-revenue',
  label: 'รายรับ',
  icon: TrendingUp,
  zone: 'fin',
  items: [
    { label: NAV_LABELS.payments, path: '/payments', icon: HandCoins },
    { label: 'รายได้อื่น', path: '/other-income', icon: TrendingUp },
    { label: 'เอกสารยกเลิกสัญญา', path: '/finance/contract-cancellation', icon: FileText },
    // P4-SP2 — ตั้งค่าส่งใบเสร็จอัตโนมัติ · อยู่โซนนี้เพราะ FM/ACC เข้าได้ แต่หมวดตั้งค่าบางหมวดเห็นเฉพาะเจ้าของ
    { label: 'ใบเสร็จอิเล็กทรอนิกส์อัตโนมัติ', path: '/finance/e-receipt-auto', icon: Receipt },
  ],
};

const finExpenseSection: MenuSection = {
  key: 'fin-expense',
  label: 'รายจ่าย',
  icon: TrendingDown,
  zone: 'fin',
  items: [
    { label: 'จ่ายให้หน้าร้าน', path: '/accounting/intercompany', icon: Store },
    { label: NAV_LABELS.expenses, path: '/expenses', icon: Receipt },
    { label: 'บิลประจำ', path: '/expenses/recurring-bills', icon: CalendarClock },
  ],
};

const finCashSection: MenuSection = {
  key: 'fin-cash',
  label: 'การเงิน',
  icon: Landmark,
  zone: 'fin',
  items: [
    // SP6 — Bank/Cash account directory (mirrors CoA 11-1101..1203) · ผังบัญชีอยู่ settings › บัญชี & ภาษี
    { label: NAV_LABELS.cashBank, path: '/finance/bank-accounts', icon: Landmark },
  ],
};

const finTaxSection: MenuSection = {
  key: 'fin-tax',
  label: 'ภาษี',
  icon: Calculator,
  zone: 'fin',
  items: [
    { label: NAV_LABELS.vat, path: '/finance/vat', icon: Receipt },
    { label: NAV_LABELS.wht, path: '/finance/wht', icon: Receipt },
    { label: 'ภ.ง.ด.1 เงินเดือน (รายพนักงาน)', path: '/finance/wht-report', icon: Receipt },
    { label: 'ประกันสังคม (สปส.1-10)', path: '/finance/sso-report', icon: Receipt },
    { label: 'ภ.ง.ด.1ก / ใบ 50 ทวิ (รายปี)', path: '/finance/wht-annual', icon: Receipt },
    { label: 'e-Tax Invoice', path: '/finance/e-tax', icon: FileText },
    // รายงานรายการสมุดรายวันที่มีบัญชี VAT ของเดือน (VatAutoJournalPage) — อ่านอย่างเดียว
    { label: 'รายการบัญชี VAT อัตโนมัติ', path: '/finance/vat-auto-journal', icon: Calculator },
  ],
};

const finStatementsSection: MenuSection = {
  key: 'fin-statements',
  label: 'บัญชี & งบการเงิน',
  icon: PieChart,
  zone: 'fin',
  items: [
    { label: NAV_LABELS.generalJournal, path: '/finance/general-journal', icon: BookOpen },
    { label: NAV_LABELS.generalLedger, path: '/finance/general-ledger', icon: BookOpen },
    // CSV §5 — "งบ 4 ประเภท" (full 4-statement set per TFRS)
    { label: NAV_LABELS.balanceSheet, path: '/finance/balance-sheet', icon: Landmark },
    { label: NAV_LABELS.profitLoss, path: '/profit-loss', icon: PieChart },
    { label: NAV_LABELS.cashFlow, path: '/finance/cash-flow', icon: Banknote },
    { label: NAV_LABELS.equityStatement, path: '/finance/equity-statement', icon: BarChart3 },
  ],
};

/** ปิดงวด & ทุน — เจ้าของแทรก "งวดบัญชี" (/accounting/periods เป็น roles={['OWNER']}) ระหว่างสองชุดนี้ */
const FIN_CLOSE_HEAD_ITEMS: MenuItem[] = [
  { label: 'ปิดบัญชีรายเดือน', path: '/monthly-close', icon: CalendarDays },
  { label: 'ปิดบัญชีสิ้นปี', path: '/finance/year-end-closing', icon: CalendarDays },
];
const FIN_CLOSE_TAIL_ITEMS: MenuItem[] = [
  { label: 'ตรวจสอบบัญชี', path: '/financial-audit', icon: ClipboardList },
  // P3-SP3 — PEAK CSV export (mapping config lives in /settings#peak-mapping)
  { label: 'ส่งออก PEAK CSV', path: '/finance/peak-export', icon: Plug },
  { label: 'ส่วนของผู้ถือหุ้น', path: '/finance/equity', icon: Landmark },
  { label: 'ทะเบียนปันผล + ภ.ง.ด.2', path: '/finance/dividend-register', icon: Coins },
];

/** รายงาน — ค่าคอมมิชชันต่อท้ายเฉพาะตำแหน่งที่ route อนุญาต (OWNER / FINANCE_MANAGER) */
const FIN_REPORT_ITEMS: MenuItem[] = [
  { label: 'รายงานรวม', path: '/reports', icon: BarChart3 },
  // Tooltify import flow B — read-only historical sales dashboard (imported_sales table)
  { label: 'ยอดขายย้อนหลัง (Tooltify)', path: '/imported-sales', icon: History },
  { label: 'รายงานลูกหนี้และอายุหนี้', path: '/finance/aging-report', icon: AlertTriangle },
  { label: 'รายงานหนี้สูญ', path: '/finance/bad-debt-report', icon: TrendingDown },
  { label: 'รายงานลูกหนี้ระหว่างบริษัท', path: '/finance/intercompany-report', icon: Building2 },
];
const COMMISSIONS_REPORT_ITEM: MenuItem = { label: 'ค่าคอมมิชชัน', path: '/commissions', icon: Coins };
```

- [ ] **Step 4: จัดกลุ่ม FINANCE_MANAGER ใหม่**

ใน `FINANCE_MANAGER_CONFIG.sidebar`:
- คง `fm-overview` และ `fm-shop-ops` ไว้ตามเดิมทุกตัวอักษร
- แทน `fm-fin-daily` ด้วย (ย้าย "รับชำระค่างวด" ไปกลุ่มรายรับ · คงคอมเมนต์เรื่อง `/customers` เดิมไว้เหนือรายการลูกค้า):

```ts
    {
      key: 'fm-fin-daily',
      label: 'ลูกค้า & สัญญา',
      icon: Users,
      zone: 'fin',
      items: [
        { label: NAV_LABELS.contracts, path: '/contracts', icon: FileCheck },
        // (คงคอมเมนต์เดิมเรื่อง /customers ของ FM ไว้ตรงนี้ทั้งก้อน)
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: 'ตรวจเครดิต', path: '/credit-checks', icon: ShieldCheck },
      ],
    },
```

- แทนทุกอย่างตั้งแต่ `fm-collection` จนจบอาร์เรย์ (`fm-collection` · คอมเมนต์ "โซนบัญชีของ ผจก.การเงิน" · `fm-revenue` · `fm-spend` · `fm-closing` · `fm-tax` · `fm-statements` · `fm-reports` · `fm-bank` · `assetMenuSection`) ด้วย:

```ts
    /* โซนบัญชีของ ผจก.การเงิน — โครงเดียวกับ OWNER (PEAK 2026-11-17)
     * ต่างจากเจ้าของแค่: ติดตามหนี้ไม่มี MDM (อยู่โซนร้านของ FM) · ปิดงวดไม่มีงวดบัญชี (OWNER เท่านั้น)
     * ปักที่ __tests__/menu.fin-groups.test.ts + route-reachability.test.ts */
    finRevenueSection,
    {
      key: 'fm-collection',
      label: 'ติดตามหนี้',
      icon: AlertTriangle,
      zone: 'fin',
      items: [
        { label: NAV_LABELS.overdue, path: '/overdue', icon: AlertTriangle },
        { label: 'จัดการจดหมาย', path: '/letters', icon: Mail },
        { label: 'รับเครื่องคืน / ยึดคืน', path: '/repossessions', icon: Lock },
      ],
    },
    finExpenseSection,
    assetMenuSection,
    finCashSection,
    finTaxSection,
    finStatementsSection,
    {
      key: 'fm-closing',
      label: 'ปิดงวด & ทุน',
      icon: CalendarDays,
      zone: 'fin',
      // ไม่มี /accounting/periods — เป็น roles={['OWNER']}
      items: [...FIN_CLOSE_HEAD_ITEMS, ...FIN_CLOSE_TAIL_ITEMS],
    },
    {
      key: 'fm-reports',
      label: 'รายงาน',
      icon: BarChart3,
      zone: 'fin',
      items: [...FIN_REPORT_ITEMS, COMMISSIONS_REPORT_ITEM],
    },
  ],
```

- [ ] **Step 5: จัดกลุ่ม ACCOUNTANT ใหม่**

แทน `ACCOUNTANT_CONFIG.sidebar` ทั้งอาร์เรย์ด้วย (คง `acc-shop-accounting` ตามเดิม · คงคอมเมนต์ route-reachability เดิมของ `acc-reference`):

```ts
  sidebar: [
    {
      key: 'acc-shop-accounting', label: 'บัญชีหน้าร้าน (SHOP)', icon: Store, zone: 'shop',
      items: [
        { label: 'งบทดลอง + P&L', path: '/shop/accounting', icon: PieChart },
        { label: 'สรุปเงินรายวัน', path: '/shop/daily-cash', icon: Banknote },
        { label: 'เงินสดย่อย', path: '/shop/petty-cash', icon: Wallet },
      ],
    },
    {
      key: 'acc-overview',
      label: 'ภาพรวม',
      icon: Home,
      zone: 'fin',
      items: [
        // /finance-portfolio ต้องอยู่ในเมนู — เป็นปลายทางของ getZoneEntryPathForRole('ACCOUNTANT', 'fin')
        { label: 'ภาพรวม การเงิน', path: '/finance-portfolio', icon: CircleDollarSign },
        { label: 'งานของทีม', path: '/todos', icon: CheckSquare },
        { label: 'เวลาทำงานของฉัน', path: '/attendance/me', icon: Timer },
      ],
    },
    finRevenueSection,
    {
      key: 'acc-collection',
      label: 'ติดตามหนี้',
      icon: AlertTriangle,
      zone: 'fin',
      items: [
        { label: 'จัดการจดหมาย', path: '/letters', icon: Mail },
        { label: 'รับเครื่องคืน / ยึดคืน', path: '/repossessions', icon: Lock },
      ],
    },
    finExpenseSection,
    assetMenuSection,
    finCashSection,
    finTaxSection,
    finStatementsSection,
    {
      key: 'acc-close',
      label: 'ปิดงวด & ทุน',
      icon: CalendarDays,
      zone: 'fin',
      // /accounting/periods เป็น ProtectedRoute roles={['OWNER']} ⇒ ไม่ใส่ (route-reachability ทิศ B)
      items: [...FIN_CLOSE_HEAD_ITEMS, ...FIN_CLOSE_TAIL_ITEMS],
    },
    {
      key: 'acc-reports',
      label: 'รายงาน',
      icon: BarChart3,
      zone: 'fin',
      items: [...FIN_REPORT_ITEMS],
    },
    {
      key: 'acc-reference',
      label: 'ข้อมูลอ้างอิง',
      icon: FileSearch,
      zone: 'fin',
      items: [
        // (คงคอมเมนต์ route-reachability เดิมของกลุ่มนี้ไว้ตรงนี้ทั้งก้อน)
        { label: 'ลูกค้า', path: '/customers', icon: Users },
        { label: NAV_LABELS.contracts, path: '/contracts', icon: FileCheck },
        { label: NAV_LABELS.stock, path: '/stock', icon: Warehouse },
        // ก้อน 5 (Q1) — ฝ่ายบัญชีบันทึก/แก้ใบกำกับภาษีที่มาทีหลังที่ใบรับของ
        { label: 'สั่งซื้อ (PO)', path: '/purchase-orders', icon: ClipboardList },
        { label: 'รายการสินค้า', path: '/stock/products', icon: ClipboardList },
        { label: 'ตัดสินค้า', path: '/stock/adjustments', icon: PackageMinus, badgeKey: 'stock-adjustment-pending' },
        // ย้ายมาจาก "งานประจำวัน" เดิม (2026-11-17) — ไม่ใช่งานบัญชี แต่ route อนุญาต ACC
        { label: 'พิมพ์สติกเกอร์', path: '/stickers', icon: Tag },
        { label: 'การจอง / มัดจำ', path: '/bookings', icon: CalendarDays },
        { label: 'หลังการขาย', path: '/after-sales', icon: ShieldCheck },
      ],
    },
    // acc-doc-config section ลบออก (2026-06-24) — document-config เป็น OWNER-only page
  ],
```

- [ ] **Step 6: จัดกลุ่ม OWNER ใหม่**

ใน `OWNER_CONFIG.sidebar` คง `owner-overview` · `owner-inventory` · `owner-sales` · `owner-shop-accounting` ไว้ตามเดิม แล้ว:

1. ในคอมเมนต์ท้าย `owner-sales` แก้ `(owner-fin-revenue)` เป็น `(owner-collection)`
2. แทนทุกอย่างตั้งแต่คอมเมนต์ `/* ── FIN zone restructure (per owner CSV)` จนจบกลุ่ม `owner-bank` (รวม `owner-fin-revenue` · `owner-fin-expense` · `assetMenuSection` · `owner-period-close` · `owner-tax` · `owner-accounting` · `owner-reports` · `owner-bank` และคอมเมนต์ "ตั้งค่าเอกสาร section ลบออก") ด้วย:

```ts
    /* ── โซนไฟแนนซ์ — จัดตาม PEAK (2026-11-17) ───────────────────
     * เดิม 9 กลุ่มตามไฟล์ "BESTCHOICE FINANCE" ของเจ้าของ · รอบนี้: งานทวงหนี้แยกออกจากรายรับ ·
     * สมุดรายวัน/บัญชีแยกประเภทอยู่กับงบ · ทุนอยู่กับปิดงวด · ตัดกลุ่มเมนูเดียว
     * (ตั้งค่าเอกสาร/เครื่องมือเชื่อมต่อ/Dunning/ผังบัญชี อยู่ settings ตั้งแต่ dedupe 2026-06-24) */
    finRevenueSection,
    {
      key: 'owner-collection',
      label: 'ติดตามหนี้',
      icon: AlertTriangle,
      zone: 'fin',
      items: [
        { label: NAV_LABELS.overdue, path: '/overdue', icon: AlertTriangle },
        { label: 'จัดการจดหมาย', path: '/letters', icon: Mail },
        { label: 'ล็อคเครื่อง (MDM)', path: '/mdm', icon: Lock },
        // คำสั่งเจ้าของ 2026-08-29: ยึดคืนอยู่โซนไฟแนนซ์ที่เดียว — 2026-11-17 ย้ายจากกลุ่มรายรับมากลุ่มนี้ (โซนเดิม)
        { label: 'รับเครื่องคืน / ยึดคืน', path: '/repossessions', icon: Lock },
      ],
    },
    finExpenseSection,
    assetMenuSection,
    finCashSection,
    finTaxSection,
    finStatementsSection,
    {
      key: 'owner-period-close',
      label: 'ปิดงวด & ทุน',
      icon: CalendarDays,
      zone: 'fin',
      items: [
        ...FIN_CLOSE_HEAD_ITEMS,
        { label: 'งวดบัญชี', path: '/accounting/periods', icon: CalendarDays },
        ...FIN_CLOSE_TAIL_ITEMS,
      ],
    },
    {
      key: 'owner-reports',
      label: 'รายงาน',
      icon: BarChart3,
      zone: 'fin',
      items: [...FIN_REPORT_ITEMS, COMMISSIONS_REPORT_ITEM],
    },
```

3. ลบกลุ่ม `owner-fin-notifications` ทั้งก้อน (ใบเสร็จอิเล็กทรอนิกส์อัตโนมัติอยู่ใน `finRevenueSection` แล้ว)
4. เมนูเดียวกันห้ามเหลือสองที่ในโซนไฟแนนซ์ — ตรวจด้วย Step 8

- [ ] **Step 7: แก้เทสต์เดิมที่อ้าง key กลุ่มเก่า**

`apps/web/src/config/menu.test.ts:101-116` แทนเทสต์ `'OWNER fin sections include all FIN-zone keys (regression guard)'` ทั้งก้อนด้วย:

```ts
  it('OWNER fin sections have exact expected keys (regression guard — PEAK 2026-11-17)', () => {
    const keys = getSidebarForRole('OWNER', 'fin').map((s) => s.key);
    expect(keys).toEqual([
      'owner-overview',
      'fin-revenue',
      'owner-collection',
      'fin-expense',
      'asset',
      'fin-cash',
      'fin-tax',
      'fin-statements',
      'owner-period-close',
      'owner-reports',
    ]);
    // owner-doc-config + owner-fin-integrations removed (dedupe 2026-06-24) — both duplicated the settings submenu
    expect(keys).not.toContain('owner-doc-config');
    expect(keys).not.toContain('owner-fin-integrations');
  });
```

`apps/web/src/config/menu.test.ts:159-163` แทนด้วย:

```ts
  it('ACCOUNTANT fin sections include cash/bank but no longer doc-config (removed — OWNER-only page)', () => {
    const keys = getSidebarForRole('ACCOUNTANT', 'fin').map((s) => s.key);
    expect(keys).not.toContain('acc-doc-config'); // removed 2026-06-24 (document-config is OWNER-only; lived in settings)
    expect(keys).toContain('fin-cash');
  });
```

`apps/web/src/components/layout/__tests__/SettingsNav.test.tsx:88` แก้คอมเมนต์ `เข้าเมนู acc-daily` เป็น `เข้าเมนู acc-overview`

- [ ] **Step 8: รันเทสต์ทั้งโฟลเดอร์ config + layout**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE/apps/web"
npx vitest run src/config src/components/layout
```

Expected: PASS ทุกไฟล์ · โดยเฉพาะ:
- `menu.fin-groups.test.ts` PASS
- `route-reachability.test.ts` A และ B PASS โดย `KNOWN_GAPS_*` ยังว่าง
- `menu.test.ts` เทสต์ `/repossessions` "ใช้ป้ายใหม่ path เดิม" ยังได้ `toHaveLength(1)` ทุกตำแหน่ง (ยืนยันว่าไม่มีเมนูซ้ำ)
- `menu.stock-adjustments.test.ts` ACC ยังเจอ "ตัดสินค้า" ในโซน fin

ถ้า route-reachability ทิศ A แดง = มีเมนูหลุดจากทุกกลุ่ม → เทียบรายการที่แจ้งกับตาราง "โครงเป้าหมาย" แล้วใส่คืนกลุ่มที่ถูก · ถ้าทิศ B แดง = ใส่เมนูที่ตำแหน่งนั้นไม่มีสิทธิ์ในกลุ่มใช้ร่วม → ย้ายออกไปกลุ่มต่อตำแหน่ง

- [ ] **Step 9: เพิ่มเวอร์ชันเว็บ**

`apps/web/package.json` เพิ่ม patch หนึ่งขั้นจากค่าปัจจุบันบน branch (เช่น `"version": "26.11.8"` → `"version": "26.11.9"`)

- [ ] **Step 10: ตรวจทั้งหมดก่อน commit**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
./tools/check-types.sh web
cd apps/web
npx vitest run
npx eslint src/config src/components/layout
```

Expected: type check 0 errors · vitest ทั้งเว็บ PASS · eslint ไม่มี error

- [ ] **Step 11: ดูเมนูจริงบนจอ**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
npm run dev
```

ล็อกอินที่ `http://localhost:5173` ด้วยบัญชีทดสอบใน `.claude/CLAUDE.md` หัวข้อ "Test Accounts" (เจ้าของ · ผจก.การเงิน · ฝ่ายบัญชี) สลับไปโซน "งานการเงิน" แล้วตรวจ:
- ลำดับกลุ่มตรงตาราง "โครงเป้าหมาย" ทั้งสามบัญชี
- กดเมนูทุกเมนูในกลุ่ม "ติดตามหนี้" · "การเงิน" · "บัญชี & งบการเงิน" · "ปิดงวด & ทุน" ไม่ขึ้น toast "ไม่มีสิทธิ์" และแถบโซนไม่สลับไปโซนร้าน
- หัวหน้าตรงชื่อเมนู: งบฐานะการเงิน · ภาษีมูลค่าเพิ่ม (ภ.พ.30) — รายเดือน · ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.1/3/53) — รายเดือน · เงินสด/ธนาคาร · บันทึกค่าใช้จ่าย
- จอแคบ (มือถือ): ชื่อ "ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.1/3/53)" ในลิ้นชักเมนูตัดบรรทัดอ่านได้ ไม่ล้นจอ

- [ ] **Step 12: Commit**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
git add apps/web/src/config apps/web/src/components/layout/__tests__/SettingsNav.test.tsx apps/web/package.json
git commit -m "เมนูไฟแนนซ์: จัดกลุ่มตาม PEAK เรียงเหมือนกันทุกตำแหน่ง + กลุ่มใช้ร่วม

แยกงานทวงหนี้ออกจากรายรับ (กลุ่มติดตามหนี้) · สมุดรายวัน/บัญชีแยกประเภทอยู่กับงบ ·
ทุนอยู่กับปิดงวด · ใบเสร็จอิเล็กทรอนิกส์อัตโนมัติเข้ารายรับ · ตัดกลุ่มเมนูเดียว
กลุ่มที่สมาชิกเหมือนกันเขียนครั้งเดียวแบบ assetMenuSection (fin-revenue/expense/cash/tax/statements)
ฝ่ายบัญชีเลิกกอง 13 เมนูใน "งานประจำวัน" · ปักที่ menu.fin-groups.test.ts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## นอกขอบเขต (แผนแยก)

- **หน้างบทดลองฝั่ง FINANCE** — เว็บไม่มีหน้า (มีแค่ `/shop/accounting` ของหน้าร้าน) ทั้งที่ API คำนวณได้ (`AccountingService.getTrialBalance`) · เมื่อทำแล้วเพิ่มเข้า `finStatementsSection` ต่อจาก "บัญชีแยกประเภท" พร้อม route ที่อนุญาตทั้ง 3 ตำแหน่ง
- **e2e `finance.spec.ts:249`** ชื่อ describe "บันทึกรายจ่าย" — ตัวตรวจในเทสต์ใช้ regex `/รายจ่าย|ค่าใช้จ่าย|Expense/` ยังผ่าน · ไม่แก้
