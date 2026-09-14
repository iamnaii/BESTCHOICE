# หน้ารายละเอียดลูกค้า — รีดีไซน์ทิศทาง A (Plan 1 ของ 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้า `/customers/:id` แสดง "ภาพรวมก่อน แล้วค่อยเจาะ" ตาม mockup ทิศทาง A — หัวหน้าบรรทัดเดียว · ตัวเลข 5 ช่องที่เปลี่ยนชุดตามประเภทลูกค้า (ผ่อน / เงินสด-ไฟแนนซ์นอก / ผู้สนใจ) · แถบเตือนค้างชำระที่บอกงวดและยอด · 2 คอลัมน์ (ซ้ายแท็บ · ขวาข้อมูลติดต่อที่เห็นตลอด) · แท็บภาพรวมที่มีการ์ดสัญญาที่กำลังผ่อน

**Architecture:** API เพิ่มเมธอด `CustomerQueryService.findDetail(id)` ที่ห่อ `findOne` เดิม แล้วเติมข้อมูลด้วย service ที่หน้ารายชื่อใช้อยู่แล้ว (`CustomerPurchaseSummaryService`, `CustomerChatRoomsService`) + ตัวคำนวณบริสุทธิ์ `buildContractProgress` · `findOne` เดิมไม่แตะ (ถูกใช้เป็นด่านเช็คว่ามีลูกค้าอยู่หลายจุด) · เว็บแตกไฟล์เดี่ยว 1,436 บรรทัดเป็นโฟลเดอร์ `pages/CustomerDetailPage/` ตามแบบ `pages/CustomersPage/`

**Tech Stack:** React 18 + TS + Vite + Tailwind + shadcn (`apps/web`, vitest + testing-library) · NestJS 10 + Prisma 6 (`apps/api`, jest `--runInBand`)

**Spec:** mockup canvas `https://claude.ai/code/artifact/8155ff8c-0594-44d0-9a27-0fb7e7fa2682` (บอร์ด "A · ลูกค้าผ่อน มีค้างชำระ" · "A · ลูกค้าเงินสด / ไฟแนนซ์นอก" · "A · ผู้สนใจ" + โน้ต) · Plan 2 (การเดินทางของลูกค้า) เป็นไฟล์แยก `2026-09-15-customer-journey.md` — แท็บ "การเดินทาง" และการ์ด "กิจกรรมล่าสุด" **ไม่อยู่ในแผนนี้**

## Global Constraints

- ทำงานใน worktree `BESTCHOICE/.claude/worktrees/feat+customer-detail-journey` branch `worktree-feat+customer-detail-journey` (ตั้งชื่อ branch ตอนเปิด PR เป็น `feat/customer-detail-redesign`) · base = `origin/main` `f76582a52`
- **เจ้าของสั่ง 2026-09-15 "วางแผน เขียน code โดยใช้ sub agent ได้เลย"** โดยยังไม่ได้ตอบคำถาม 5 ข้อบนแคนวาส ⇒ ใช้ค่าตั้งต้นต่อไปนี้ (ทุกข้อเปลี่ยนทีหลังได้โดยไม่รื้อโครง): ตัวเลข 5 ช่องเปลี่ยนชุดตามประเภท · คำสั่งรวมในปุ่ม `ดำเนินการ` · แท็บที่ไม่มีข้อมูลโชว์จาง ไม่ซ่อน · คอลัมน์ขวาเป็นการ์ดเดียวคั่นเส้น · ป้ายสถานะสัญญาใช้ `contractStatusMap` เดิม
- เทสเว็บ รันจาก `apps/web`: `TZ=UTC npx vitest run <path>` · typecheck `npx tsc --noEmit` (baseline 0 error) · lint เฉพาะไฟล์ที่แตะ `npx eslint <files>`
- เทส API รันจาก `apps/api`: `DATABASE_URL="postgresql://prospects_test@localhost:55491/bc_journey_test?host=/tmp/bc-chat-prospects-pg/socket&schema=public" TZ=Asia/Bangkok NODE_ENV=test npx jest <path> --runInBand` · typecheck `npx tsc --noEmit -p tsconfig.json` (baseline 0 error) · 🚨 **ห้าม `npm run lint` ใน apps/api** (สคริปต์มี `--fix`) ใช้ `npx eslint <files>` แทน
- Design tokens เท่านั้น ห้าม hex ห้าม `text-gray-*`/`bg-white` (ข้อยกเว้นเดียว = สีแบรนด์ใน `ChannelBadge` ที่มีอยู่แล้ว) · ข้อความไทยใช้ `leading-snug` ห้าม `leading-none` · ไอคอน `lucide-react` · แจ้งเตือน `toast` จาก `sonner` · ดึงข้อมูลด้วย `useQuery`/`useMutation` + `api` จาก `@/lib/api` เท่านั้น
- ธงผู้สนใจจากแชท = `chatPlaceholder` จาก API เท่านั้น ห้าม derive ในเว็บ · ประเภทลูกค้า (ผ่อน/เงินสด/ผู้สนใจ) derive จากฟิลด์ `purchase` ที่ API ส่งมา (นิยามเจ้าของ: ลูกค้า = ซื้อแล้ว)
- เลขบัตรประชาชน: OWNER เห็นเต็ม คนอื่นเห็นแบบปิดบัง (`formatNationalId` / `maskNationalId` ตามเดิม) · API ปิดบังให้ SALES อยู่แล้วผ่าน `applyRoleMask`
- เทส vitest: hook (`beforeEach`/`afterEach`) **ห้าม return ค่า** ต้องคร่อมปีกกา · ห้าม hardcode สตริงวันที่ ให้คำนวณด้วย formatter ตัวเดียวกับหน้าจอ (`formatDateShort`) · mock `@/lib/api` ให้ fallback **โยน error** พร้อม URL
- ข้อความ UI ที่ชี้ทาง ต้องชี้ทางที่มีจริง: `/contracts/create?customerId=<id>` (OWNER/BM/SALES) · `/pos` ไม่รับ customerId ⇒ ป้าย `เปิดหน้าขาย` · `/bookings` ไม่รับ customerId ⇒ ป้าย `เปิดหน้าจอง / มัดจำ` · `/payments?contractId=<id>` · `/inbox/<roomId>` เฉพาะ `isChatVisibleForRole(role)`
- commit ภาษาไทย ทีละ task · `git add <ไฟล์ที่แตะ>` ระบุชื่อไฟล์เท่านั้น 🚨 ห้าม `git add -A` / `git add .` · ท้าย commit: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- ห้ามแก้ `apps/web/package.json` version ยกเว้น Task 7 (bump **26.9.27**) · ห้าม `git push` ในทุก task
- 🚨 ห้ามฆ่า process ด้วย pattern ใด ๆ (pkill ตามพอร์ต/ชื่อ) — ฆ่าได้เฉพาะ PID ที่ตัวเองเปิด

---

## ผังไฟล์

| หน้าที่ | ไฟล์ |
|---|---|
| API: ความคืบหน้าสัญญาที่กำลังผ่อน (บริสุทธิ์) | `apps/api/src/modules/customers/services/customer-contract-progress.ts` (ใหม่) + `.spec.ts` |
| API: `findDetail` | `apps/api/src/modules/customers/services/customer-query.service.ts` + `customer-query-detail.spec.ts` (ใหม่) |
| API: facade + route | `apps/api/src/modules/customers/customers.service.ts` · `customers.controller.ts` · `customers.controller.spec.ts` |
| เว็บ: type + ตัวคำนวณ | `apps/web/src/pages/CustomerDetailPage/types.ts` · `utils/customerKind.ts` · `utils/kpiTiles.ts` (+ `__tests__/`) |
| เว็บ: hooks | `apps/web/src/pages/CustomerDetailPage/hooks/useCustomerDetailData.ts` |
| เว็บ: หน้า | `apps/web/src/pages/CustomerDetailPage/index.tsx` (แทน `pages/CustomerDetailPage.tsx` ที่ถูกลบ — `App.tsx` import `@/pages/CustomerDetailPage` resolve เป็นโฟลเดอร์ได้โดยไม่แก้) |
| เว็บ: ชิ้นส่วน | `components/DetailHeader.tsx` · `components/KpiTiles.tsx` · `components/RiskBanner.tsx` · `components/CustomerSidePanel.tsx` · `components/ActiveContractCard.tsx` · `components/EditCustomerDialog.tsx` · `components/ActionsMenu.tsx` |
| เว็บ: แท็บ | `tabs/OverviewTab.tsx` · `tabs/ContractsTab.tsx` · `tabs/SalesTab.tsx` · `tabs/CreditTab.tsx` · `tabs/LoyaltyTab.tsx` |
| เว็บ: เทสหน้า | `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx` (ใหม่) |

---

### Task 1: API `findDetail` — เติมสรุปการซื้อ · ห้องแชท · แท็ก · ที่มา · ความคืบหน้าสัญญาที่กำลังผ่อน

**Files:**
- Create: `apps/api/src/modules/customers/services/customer-contract-progress.ts`
- Create: `apps/api/src/modules/customers/services/customer-contract-progress.spec.ts`
- Create: `apps/api/src/modules/customers/services/customer-query-detail.spec.ts`
- Modify: `apps/api/src/modules/customers/services/customer-query.service.ts` (เมธอดใหม่ `findDetail` ถัดจาก `findOne` ~บรรทัด 802)
- Modify: `apps/api/src/modules/customers/customers.service.ts` (facade ถัดจาก `findOne` บรรทัด 50)
- Modify: `apps/api/src/modules/customers/customers.controller.ts:179-200` (`GET :id` เรียก `findDetail`)
- Modify: `apps/api/src/modules/customers/customers.controller.spec.ts` (mock `findDetail`)

**Interfaces:**
- Consumes: `CustomerPurchaseSummaryService.forCustomers(ids)` → `Map<string, CustomerPurchaseSummary>` · `CustomerChatRoomsService.forCustomers(ids)` → `Map<string, CustomerChatSummary>` · `outstandingOf(rows)`, `nextDueOf(rows)` จาก `../../contracts/contract-outstanding` · `d()` จาก `../../../utils/decimal.util` · ฟังก์ชันภายในไฟล์ `deriveSource(acquisitionSource, newestChannel, referredById)`
- Produces: `GET /customers/:id` คืนฟิลด์เดิมทั้งหมดของ `findOne` **บวก** `{ tags: {tag: string}[]; source: ProspectSource; purchase: CustomerPurchaseChips; latestPurchase: CustomerLatestPurchase|null; warranty: CustomerWarrantySummary|null; installmentBalance: CustomerInstallmentBalance|null; chatRooms: CustomerChatRoomRef[]; lastContactAt: string|null; assignedTo: {id,name}|null; openContracts: ContractProgress[] }` · `ContractProgress` ตามไฟล์ข้างล่าง (Task 2 ของเว็บลอก type นี้)

- [ ] **Step 1: เทสแดง — ตัวคำนวณบริสุทธิ์**

สร้าง `customer-contract-progress.spec.ts`:
```ts
import { buildContractProgress, type ProgressContractRow, type ProgressPaymentRow } from './customer-contract-progress';

const NOW = new Date('2026-09-15T05:00:00.000Z');

const contract: ProgressContractRow = {
  id: 'k1',
  contractNumber: 'CT-2569-0042',
  status: 'OVERDUE',
  monthlyPayment: '4200.00',
  totalMonths: 12,
  createdAt: new Date('2026-03-05T03:00:00.000Z'),
  mdmLockedAt: null,
  shopWarrantyEndDate: null,
  branch: { name: 'สำนักงานใหญ่' },
  product: { brand: 'Apple', model: 'iPhone 15', storage: '128GB', imeiSerial: '351234567890123', warrantyExpireDate: new Date('2027-03-05T00:00:00.000Z') },
};

function pay(installmentNo: number, status: string, dueIso: string, amountPaid = '0'): ProgressPaymentRow {
  return { contractId: 'k1', installmentNo, status, dueDate: new Date(dueIso), amountDue: '4200.00', amountPaid };
}

// งวด 1-6 จ่ายแล้ว (ครบกำหนดเดือน มี.ค.-ส.ค.) · งวด 7 ครบกำหนด 05/09 ยังไม่จ่าย ⇒ ค้าง ณ NOW · งวด 8-12 ยังไม่ถึงกำหนด
const PAID_DUE_DAYS = ['2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05'];
const schedule: ProgressPaymentRow[] = [
  ...PAID_DUE_DAYS.map((day, i) => pay(i + 1, 'PAID', `${day}T00:00:00.000Z`, '4200.00')),
  pay(7, 'OVERDUE', '2026-09-05T00:00:00.000Z'),
  pay(8, 'PENDING', '2026-10-05T00:00:00.000Z'),
  pay(9, 'PENDING', '2026-11-05T00:00:00.000Z'),
  pay(10, 'PENDING', '2026-12-05T00:00:00.000Z'),
  pay(11, 'PENDING', '2027-01-05T00:00:00.000Z'),
  pay(12, 'PENDING', '2027-02-05T00:00:00.000Z'),
];

describe('buildContractProgress', () => {
  it('นับงวดจ่ายแล้ว/ค้าง/เหลือ + ยอดคงค้าง + งวดถัดไปที่ยังไม่ถึงกำหนด + งวดค้างงวดแรก', () => {
    const [p] = buildContractProgress({ contracts: [contract], payments: schedule, lastCalls: [], now: NOW });
    expect(p).toMatchObject({
      id: 'k1',
      contractNumber: 'CT-2569-0042',
      status: 'OVERDUE',
      productLabel: 'Apple iPhone 15 128GB',
      imeiSerial: '351234567890123',
      branchName: 'สำนักงานใหญ่',
      startedAt: '2026-03-05T03:00:00.000Z',
      monthlyPayment: 4200,
      totalInstallments: 12,
      paidInstallments: 6,
      remainingInstallments: 6,
      overdueInstallments: 1,
      overdueAmount: 4200,
      outstanding: 25200,
      nextDueDate: '2026-10-05T00:00:00.000Z',
      nextAmountDue: 4200,
      firstOverdueInstallmentNo: 7,
      firstOverdueDueDate: '2026-09-05T00:00:00.000Z',
      mdmLocked: false,
      shopWarrantyEndDate: null,
      centerWarrantyEndDate: '2027-03-05T00:00:00.000Z',
      lastCall: null,
    });
  });

  it('งวดค้างที่จ่ายมาบางส่วน → ยอดค้างหักส่วนที่จ่ายแล้ว', () => {
    const partial = schedule.map((row) => (row.installmentNo === 7 ? { ...row, status: 'PARTIALLY_PAID', amountPaid: '1000.00' } : row));
    const [p] = buildContractProgress({ contracts: [contract], payments: partial, lastCalls: [], now: NOW });
    expect(p.overdueAmount).toBe(3200);
    expect(p.outstanding).toBe(24200);
  });

  it('โทรล่าสุด + เครื่องล็อก + ไม่มีตารางงวด → ศูนย์และ null ไม่พัง', () => {
    const [p] = buildContractProgress({
      contracts: [{ ...contract, mdmLockedAt: new Date('2026-09-10T02:00:00.000Z'), product: null, branch: null }],
      payments: [],
      lastCalls: [{ contractId: 'k1', calledAt: new Date('2026-09-10T07:32:00.000Z'), result: 'PROMISED', notes: 'จะจ่ายวันที่ 15', caller: { name: 'แนน' } }],
      now: NOW,
    });
    expect(p).toMatchObject({
      productLabel: '',
      imeiSerial: null,
      branchName: null,
      paidInstallments: 0,
      remainingInstallments: 0,
      overdueInstallments: 0,
      overdueAmount: 0,
      outstanding: 0,
      nextDueDate: null,
      nextAmountDue: null,
      firstOverdueInstallmentNo: null,
      mdmLocked: true,
      centerWarrantyEndDate: null,
      lastCall: { calledAt: '2026-09-10T07:32:00.000Z', result: 'PROMISED', notes: 'จะจ่ายวันที่ 15', callerName: 'แนน' },
    });
  });
});
```
Run: `npx jest src/modules/customers/services/customer-contract-progress.spec.ts --runInBand` (env ตาม Global Constraints) → Expected: FAIL `Cannot find module './customer-contract-progress'`

- [ ] **Step 2: ตัวคำนวณ**

สร้าง `customer-contract-progress.ts`:
```ts
import { Prisma } from '@prisma/client';
import { d } from '../../../utils/decimal.util';
import { nextDueOf, outstandingOf } from '../../contracts/contract-outstanding';

type DecimalLike = Prisma.Decimal | string | number;

/** สัญญาที่ยังผ่อนอยู่ (ACTIVE/OVERDUE/DEFAULT) — findDetail อ่านมาด้วย select ชุดนี้ */
export interface ProgressContractRow {
  id: string;
  contractNumber: string;
  status: string;
  monthlyPayment: DecimalLike;
  totalMonths: number;
  createdAt: Date;
  mdmLockedAt: Date | null;
  shopWarrantyEndDate: Date | null;
  branch: { name: string } | null;
  product: {
    brand: string | null;
    model: string | null;
    storage: string | null;
    imeiSerial: string | null;
    warrantyExpireDate: Date | null;
  } | null;
}

export interface ProgressPaymentRow {
  contractId: string;
  installmentNo: number;
  status: string;
  dueDate: Date;
  amountDue: DecimalLike;
  amountPaid: DecimalLike;
}

export interface ProgressCallRow {
  contractId: string;
  calledAt: Date;
  result: string;
  notes: string | null;
  caller: { name: string } | null;
}

/** การ์ด "สัญญาที่กำลังผ่อน" บนแท็บภาพรวม — ทุกยอดเงินเป็น number บาท ทศนิยม 2 ตำแหน่ง */
export interface ContractProgress {
  id: string;
  contractNumber: string;
  status: string;
  productLabel: string;
  imeiSerial: string | null;
  branchName: string | null;
  startedAt: string;
  monthlyPayment: number;
  totalInstallments: number;
  paidInstallments: number;
  remainingInstallments: number;
  overdueInstallments: number;
  overdueAmount: number;
  /** คงค้าง = กฎกลาง D2 ของ contract-outstanding.ts (งวดที่ยังไม่ PAID, ไม่รวมค่าปรับ) */
  outstanding: number;
  /** งวดที่ยังไม่ปิดและยังไม่ถึงกำหนด ใกล้สุด — งวดที่เลยกำหนดแล้วอยู่ใน firstOverdue* */
  nextDueDate: string | null;
  nextAmountDue: number | null;
  firstOverdueInstallmentNo: number | null;
  firstOverdueDueDate: string | null;
  mdmLocked: boolean;
  shopWarrantyEndDate: string | null;
  centerWarrantyEndDate: string | null;
  lastCall: { calledAt: string; result: string; notes: string | null; callerName: string | null } | null;
}

function productLabelOf(product: ProgressContractRow['product']): string {
  if (!product) return '';
  return [product.brand, product.model, product.storage].filter(Boolean).join(' ');
}

export function buildContractProgress(input: {
  contracts: ProgressContractRow[];
  payments: ProgressPaymentRow[];
  lastCalls: ProgressCallRow[];
  now: Date;
}): ContractProgress[] {
  const paymentsByContract = new Map<string, ProgressPaymentRow[]>();
  for (const row of input.payments) {
    const group = paymentsByContract.get(row.contractId) ?? [];
    group.push(row);
    paymentsByContract.set(row.contractId, group);
  }
  const callByContract = new Map(input.lastCalls.map((call) => [call.contractId, call]));
  const nowMs = input.now.getTime();

  return input.contracts.map((contract) => {
    const rows = paymentsByContract.get(contract.id) ?? [];
    const unpaid = rows.filter((row) => row.status !== 'PAID');
    const overdue = unpaid
      .filter((row) => row.dueDate.getTime() < nowMs)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.installmentNo - b.installmentNo);
    const next = nextDueOf(unpaid.filter((row) => row.dueDate.getTime() >= nowMs));
    const call = callByContract.get(contract.id) ?? null;

    return {
      id: contract.id,
      contractNumber: contract.contractNumber,
      status: contract.status,
      productLabel: productLabelOf(contract.product),
      imeiSerial: contract.product?.imeiSerial ?? null,
      branchName: contract.branch?.name ?? null,
      startedAt: contract.createdAt.toISOString(),
      monthlyPayment: d(contract.monthlyPayment).toDecimalPlaces(2).toNumber(),
      totalInstallments: contract.totalMonths,
      paidInstallments: rows.length - unpaid.length,
      remainingInstallments: unpaid.length,
      overdueInstallments: overdue.length,
      overdueAmount: outstandingOf(overdue),
      outstanding: outstandingOf(unpaid),
      nextDueDate: next ? next.dueDate.toISOString() : null,
      nextAmountDue: next ? next.amountDue : null,
      firstOverdueInstallmentNo: overdue[0]?.installmentNo ?? null,
      firstOverdueDueDate: overdue[0] ? overdue[0].dueDate.toISOString() : null,
      mdmLocked: contract.mdmLockedAt !== null,
      shopWarrantyEndDate: contract.shopWarrantyEndDate ? contract.shopWarrantyEndDate.toISOString() : null,
      centerWarrantyEndDate: contract.product?.warrantyExpireDate ? contract.product.warrantyExpireDate.toISOString() : null,
      lastCall: call
        ? { calledAt: call.calledAt.toISOString(), result: call.result, notes: call.notes, callerName: call.caller?.name ?? null }
        : null,
    };
  });
}
```
Run เทส Step 1 อีกครั้ง → Expected: PASS 3 tests

- [ ] **Step 3: เทสแดง — `findDetail`**

สร้าง `customer-query-detail.spec.ts`:
```ts
import { buildQueryService, enrichmentMocks } from './__tests__/mock-customer-db';

function detailFixture(overrides: Record<string, unknown> = {}) {
  const findUnique = jest.fn().mockResolvedValue({
    id: 'c1', name: 'สมชาย ใจดี', nickname: null, phone: '0812345678', nationalId: null,
    acquisitionSource: 'CHAT_FACEBOOK', referredById: null, deletedAt: null,
    contracts: [], sales: [], _count: { contracts: 0, referrals: 0 }, referredBy: null,
    ...overrides,
  });
  const enrich = enrichmentMocks();
  const db = {
    customer: { findUnique },
    customerTag: { findMany: jest.fn().mockResolvedValue([{ tag: 'LOYAL' }]) },
    callLog: { findMany: jest.fn().mockResolvedValue([]) },
    ...enrich,
  };
  return { db, service: buildQueryService(db, {}) };
}

describe('CustomerQueryService.findDetail', () => {
  it('รวมแท็ก · ที่มา · สรุปการซื้อ · ห้องแชท ไว้ในคำตอบเดียว และคงฟิลด์ของ findOne', async () => {
    const { db, service } = detailFixture();
    db.chatRoom.findMany.mockResolvedValue([
      { id: 'r1', customerId: 'c1', channel: 'FACEBOOK', lastMessageAt: new Date('2026-09-14T11:40:00.000Z'), lastCustomerAt: new Date('2026-09-14T11:40:00.000Z'), assignedTo: { id: 'u2', name: 'แนน' } },
    ]);
    const res = await service.findDetail('c1');
    expect(res).toMatchObject({
      id: 'c1',
      chatPlaceholder: false,
      tags: [{ tag: 'LOYAL' }],
      source: 'FACEBOOK',
      purchase: { installmentTotal: 0, cashCount: 0, externalFinanceCount: 0 },
      latestPurchase: null,
      installmentBalance: null,
      assignedTo: { id: 'u2', name: 'แนน' },
      openContracts: [],
    });
    expect(res.chatRooms).toEqual([expect.objectContaining({ roomId: 'r1', channel: 'FACEBOOK' })]);
    expect(db.customerTag.findMany).toHaveBeenCalledWith({ where: { customerId: 'c1', deletedAt: null }, select: { tag: true } });
  });

  it('สัญญาที่กำลังผ่อน → openContracts มาจากตารางงวดของสัญญานั้น + โทรล่าสุด', async () => {
    const { db, service } = detailFixture();
    const openRow = {
      id: 'k1', contractNumber: 'CT-2569-0042', status: 'ACTIVE', monthlyPayment: '4200.00', totalMonths: 2,
      createdAt: new Date('2026-08-05T03:00:00.000Z'), mdmLockedAt: null, shopWarrantyEndDate: null,
      branch: { name: 'สำนักงานใหญ่' }, product: { brand: 'Apple', model: 'iPhone 15', storage: '128GB', imeiSerial: null, warrantyExpireDate: null },
    };
    // purchase summary ก็เรียก contract.findMany / payment.findMany — แยกคำขอของ findDetail ด้วย select ที่มีเฉพาะมัน
    db.contract.findMany.mockImplementation(async (args: { select?: Record<string, unknown> }) => (args.select?.mdmLockedAt ? [openRow] : []));
    db.payment.findMany.mockImplementation(async (args: { distinct?: unknown }) =>
      args.distinct
        ? []
        : [
            { contractId: 'k1', installmentNo: 1, status: 'PAID', dueDate: new Date('2026-09-05T00:00:00.000Z'), amountDue: '4200.00', amountPaid: '4200.00' },
            { contractId: 'k1', installmentNo: 2, status: 'PENDING', dueDate: new Date('2099-10-05T00:00:00.000Z'), amountDue: '4200.00', amountPaid: '0' },
          ],
    );
    db.callLog.findMany.mockResolvedValue([
      { contractId: 'k1', calledAt: new Date('2026-09-10T07:32:00.000Z'), result: 'ANSWERED', notes: null, caller: { name: 'แนน' } },
    ]);
    const res = await service.findDetail('c1');
    expect(res.openContracts).toHaveLength(1);
    expect(res.openContracts[0]).toMatchObject({ contractNumber: 'CT-2569-0042', paidInstallments: 1, remainingInstallments: 1, outstanding: 4200, lastCall: { result: 'ANSWERED', callerName: 'แนน' } });
  });

  it('ลูกค้าไม่มีอยู่ → NotFoundException จาก findOne เดิม และไม่ยิง query เสริม', async () => {
    const { db, service } = detailFixture();
    db.customer.findUnique.mockResolvedValue(null);
    await expect(service.findDetail('nope')).rejects.toThrow('ไม่พบลูกค้า');
    expect(db.customerTag.findMany).not.toHaveBeenCalled();
  });
});
```
Run: `npx jest src/modules/customers/services/customer-query-detail.spec.ts --runInBand` → Expected: FAIL `service.findDetail is not a function`

- [ ] **Step 4: `findDetail`**

ใน `customer-query.service.ts` เพิ่ม import บนสุด:
```ts
import { buildContractProgress } from './customer-contract-progress';
```
เพิ่มเมธอดถัดจาก `findOne` (หลังวงเล็บปิดของ `findOne`):
```ts
  /**
   * หน้า /customers/:id เท่านั้น — findOne + ข้อมูลที่หน้ารายชื่อคำนวณอยู่แล้ว (ตัวเดียวกัน ห้ามเขียนสูตรใหม่)
   * findOne เดิมไม่แตะ: ถูกใช้เป็นด่านเช็คว่ามีลูกค้าอยู่ใน getReferrals/getChatSummary ถ้าเติม query ลงไปทุกจุดจะช้าลง
   */
  async findDetail(id: string) {
    const base = await this.findOne(id);
    const OPEN_STATUSES = ['ACTIVE', 'OVERDUE', 'DEFAULT'] as const;

    const [purchaseMap, chatMap, tags, openContracts] = await Promise.all([
      this.purchaseSummary.forCustomers([id]),
      this.chatRooms.forCustomers([id]),
      this.prisma.customerTag.findMany({ where: { customerId: id, deletedAt: null }, select: { tag: true } }),
      this.prisma.contract.findMany({
        where: { customerId: id, deletedAt: null, status: { in: [...OPEN_STATUSES] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true, contractNumber: true, status: true, monthlyPayment: true, totalMonths: true, createdAt: true,
          mdmLockedAt: true, shopWarrantyEndDate: true,
          branch: { select: { name: true } },
          product: { select: { brand: true, model: true, storage: true, imeiSerial: true, warrantyExpireDate: true } },
        },
      }),
    ]);

    const openIds = openContracts.map((contract) => contract.id);
    const [payments, lastCalls] = openIds.length
      ? await Promise.all([
          this.prisma.payment.findMany({
            where: { contractId: { in: openIds }, deletedAt: null },
            select: { contractId: true, installmentNo: true, status: true, dueDate: true, amountDue: true, amountPaid: true },
          }),
          this.prisma.callLog.findMany({
            where: { contractId: { in: openIds }, deletedAt: null },
            orderBy: [{ contractId: 'asc' }, { calledAt: 'desc' }, { id: 'desc' }],
            distinct: ['contractId'],
            select: { contractId: true, calledAt: true, result: true, notes: true, caller: { select: { name: true } } },
          }),
        ])
      : [[], []];

    const purchase = purchaseMap.get(id);
    const chat = chatMap.get(id);
    const chatRooms = chat?.chatRooms ?? [];
    return {
      ...base,
      tags,
      source: deriveSource(base.acquisitionSource ?? null, chatRooms[0]?.channel ?? null, base.referredById ?? null),
      purchase: purchase?.purchase ?? null,
      latestPurchase: purchase?.latestPurchase ?? null,
      warranty: purchase?.warranty ?? null,
      installmentBalance: purchase?.installmentBalance ?? null,
      chatRooms,
      lastContactAt: chat?.lastContactAt ?? null,
      assignedTo: chat?.assignedTo ?? null,
      openContracts: buildContractProgress({ contracts: openContracts, payments, lastCalls, now: new Date() }),
    };
  }
```
Run เทส Step 3 → Expected: PASS 3 tests · ถ้า TS ฟ้องว่า `base.referredById`/`base.acquisitionSource` ไม่มีใน type ให้ดู select ของ `findOne` (ใช้ `include` จึงได้ทุกคอลัมน์ของ Customer อยู่แล้ว) — ห้ามแก้ด้วย `as any`

- [ ] **Step 5: facade + controller + เทส controller**

`customers.service.ts` ถัดจาก `findOne` (บรรทัด 50-52):
```ts
  findDetail(id: string) {
    return this.query.findDetail(id);
  }
```
`customers.controller.ts` ใน handler `@Get(':id')` เปลี่ยนบรรทัดแรกของเมธอดเป็น:
```ts
    const customer = await this.customersService.findDetail(id);
```
`customers.controller.spec.ts`: ขยาย type ของ `service` ให้มี `findDetail: jest.Mock` เพิ่ม `findDetail: jest.fn(),` ใน object mock (ถัดจาก `findOne: jest.fn(),` บรรทัด 23) และเปลี่ยน **ทุก** `service.findOne.mockResolvedValue(` ที่อยู่ก่อน `controller.findOne(` (บรรทัด 67, 74, 80, 90, 137) เป็น `service.findDetail.mockResolvedValue(` · เพิ่มเทสหนึ่งตัวใน describe เดิม:
```ts
  it('GET /customers/:id อ่านผ่าน findDetail ไม่ใช่ findOne (findOne ยังเป็นด่านเช็คของ endpoint อื่น)', async () => {
    service.findDetail.mockResolvedValue({ id: 'c1', nationalId: '1234567890123', openContracts: [] });
    await controller.findOne('c1', reqOf('OWNER'));
    expect(service.findDetail).toHaveBeenCalledWith('c1');
    expect(service.findOne).not.toHaveBeenCalled();
  });
```
Run: `npx jest src/modules/customers --runInBand` → Expected: PASS ทุก suite ในโมดูล · `npx tsc --noEmit -p tsconfig.json` → 0 error · `npx eslint src/modules/customers/services/customer-contract-progress.ts src/modules/customers/services/customer-query.service.ts src/modules/customers/customers.service.ts src/modules/customers/customers.controller.ts` → 0 error

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/customers/services/customer-contract-progress.ts apps/api/src/modules/customers/services/customer-contract-progress.spec.ts apps/api/src/modules/customers/services/customer-query-detail.spec.ts apps/api/src/modules/customers/services/customer-query.service.ts apps/api/src/modules/customers/customers.service.ts apps/api/src/modules/customers/customers.controller.ts apps/api/src/modules/customers/customers.controller.spec.ts
git commit -m "feat(customers): GET /customers/:id ส่งสรุปการซื้อ ห้องแชท แท็ก ที่มา และความคืบหน้าสัญญาที่กำลังผ่อน

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: เว็บ — type ของหน้า + ประเภทลูกค้า + ตัวเลข 5 ช่อง (ฟังก์ชันบริสุทธิ์)

**Files:**
- Create: `apps/web/src/pages/CustomerDetailPage/types.ts`
- Create: `apps/web/src/pages/CustomerDetailPage/utils/customerKind.ts`
- Create: `apps/web/src/pages/CustomerDetailPage/utils/kpiTiles.ts`
- Test: `apps/web/src/pages/CustomerDetailPage/__tests__/kpiTiles.test.ts`

**Interfaces:**
- Consumes: รูปคำตอบ `GET /customers/:id` จาก Task 1 · `CustomerPurchaseSummary`, `CustomerLatestPurchase`, `CustomerWarranty`, `CustomerInstallmentBalance`, `CustomerChatRoom`, `ProspectSource` จาก `@/pages/CustomersPage/types` · `CustomerTagType` จาก `@/pages/CollectionsPage/hooks/useCustomerTags` · `SOURCE_LABELS` จาก `@/pages/CustomersPage/components/sourceLabels` · `customerCreditStatusMap` จาก `@/lib/status-badges` · `formatDateShort` จาก `@/utils/formatters`
- Produces: `types.ts` export `ReferenceData`, `CustomerDetail`, `ContractProgress`, `RiskFlag`, `CreditCheckItem`, `AuditLog` · `customerKind(c: Pick<CustomerDetail, 'purchase'>): CustomerKind` โดย `CustomerKind = 'INSTALLMENT' | 'CASH' | 'PROSPECT'` · `kpiTiles(c: CustomerDetail, loyaltyBalance: number | null): KpiTile[]` โดย `KpiTile = { key: string; label: string; value: string; sub: string; tone: 'default' | 'primary' | 'success' | 'destructive' }` (ผ่อน/เงินสด = 5 ช่อง · ผู้สนใจ = 4 ช่อง)

- [ ] **Step 1: `types.ts`**

คัดลอก interface 5 ตัวจาก `apps/web/src/pages/CustomerDetailPage.tsx` บรรทัด 35-139 (`ReferenceData`, `CustomerDetail`, `RiskFlag`, `CreditCheckItem`, `AuditLog`) มาไว้ในไฟล์ใหม่ เติม `export` หน้าทุกตัว · **ไฟล์เดิมยังไม่ลบใน task นี้** (Task 3 ลบ) · บนสุดของไฟล์:
```ts
import type {
  CustomerChatRoom,
  CustomerInstallmentBalance,
  CustomerLatestPurchase,
  CustomerPurchaseSummary,
  CustomerWarranty,
  ProspectSource,
} from '@/pages/CustomersPage/types';
import type { CustomerTagType } from '@/pages/CollectionsPage/hooks/useCustomerTags';
```
ใน `CustomerDetail` เพิ่มฟิลด์ต่อท้าย (หลัง `sales?`):
```ts
  /** ค่าดิบ เช่น CHAT_FACEBOOK — ใช้แสดงผลเท่านั้น ห้าม derive ธงผู้สนใจจากค่านี้ (ใช้ chatPlaceholder) */
  acquisitionSource: string | null;
  /** CustomerCreditCheckStatus — ป้ายอ่านจาก customerCreditStatusMap */
  creditCheckStatus: string;
  tags: { tag: CustomerTagType }[];
  source: ProspectSource;
  purchase: CustomerPurchaseSummary | null;
  latestPurchase: CustomerLatestPurchase | null;
  warranty: CustomerWarranty | null;
  installmentBalance: CustomerInstallmentBalance | null;
  chatRooms: CustomerChatRoom[];
  lastContactAt: string | null;
  assignedTo: { id: string; name: string } | null;
  openContracts: ContractProgress[];
```
และเพิ่ม interface (ฟิลด์ตรงกับ API `customer-contract-progress.ts` ทุกตัว):
```ts
/** การ์ด "สัญญาที่กำลังผ่อน" — ต้องตรงกับ apps/api/src/modules/customers/services/customer-contract-progress.ts */
export interface ContractProgress {
  id: string;
  contractNumber: string;
  status: string;
  productLabel: string;
  imeiSerial: string | null;
  branchName: string | null;
  startedAt: string;
  monthlyPayment: number;
  totalInstallments: number;
  paidInstallments: number;
  remainingInstallments: number;
  overdueInstallments: number;
  overdueAmount: number;
  outstanding: number;
  nextDueDate: string | null;
  nextAmountDue: number | null;
  firstOverdueInstallmentNo: number | null;
  firstOverdueDueDate: string | null;
  mdmLocked: boolean;
  shopWarrantyEndDate: string | null;
  centerWarrantyEndDate: string | null;
  lastCall: { calledAt: string; result: string; notes: string | null; callerName: string | null } | null;
}
```

- [ ] **Step 2: เทสแดง**

สร้าง `__tests__/kpiTiles.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatDateShort } from '@/utils/formatters';
import { customerKind } from '../utils/customerKind';
import { kpiTiles } from '../utils/kpiTiles';
import type { ContractProgress, CustomerDetail } from '../types';

// วันที่คำนวณด้วย formatter ตัวเดียวกับหน้าจอเสมอ — CI รันเป็น UTC
const NEXT_DUE = '2026-10-05T00:00:00.000Z';
const WARRANTY = '2026-11-20T00:00:00.000Z';
const LATEST = '2026-08-20T09:05:00.000Z';
const LAST_CONTACT = '2026-09-14T11:40:00.000Z';
const baht = (n: number) => `${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;

const emptyPurchase = { installmentTotal: 0, installmentByState: { ACTIVE: 0, OVERDUE: 0, CLOSED: 0, BAD_DEBT: 0, OTHER: 0 }, cashCount: 0, externalFinanceCount: 0 };

function detail(over: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    id: 'c1', nationalId: '', prefix: null, name: 'สมชาย ใจดี', nickname: null, isForeigner: false, birthDate: null,
    phone: '0812345678', chatPlaceholder: false, phoneSecondary: null, email: null, lineIdFinance: null, lineIdShop: null,
    facebookLink: null, facebookName: null, facebookFriends: null, googleMapLink: null, addressIdCard: null, addressCurrent: null,
    occupation: null, occupationDetail: null, salary: null, workplace: null, addressWork: null, references: null, documents: null,
    createdAt: '2024-04-05T03:00:00.000Z', contracts: [], sales: [],
    acquisitionSource: null, creditCheckStatus: 'NONE', tags: [], source: 'WALK_IN', purchase: emptyPurchase,
    latestPurchase: null, warranty: null, installmentBalance: null, chatRooms: [], lastContactAt: null, assignedTo: null, openContracts: [],
    ...over,
  };
}

function progress(over: Partial<ContractProgress> = {}): ContractProgress {
  return {
    id: 'k1', contractNumber: 'CT-2569-0042', status: 'OVERDUE', productLabel: 'Apple iPhone 15 128GB', imeiSerial: null, branchName: 'สำนักงานใหญ่',
    startedAt: '2026-03-05T03:00:00.000Z', monthlyPayment: 4200, totalInstallments: 12, paidInstallments: 6, remainingInstallments: 6,
    overdueInstallments: 1, overdueAmount: 4200, outstanding: 25200, nextDueDate: NEXT_DUE, nextAmountDue: 4200,
    firstOverdueInstallmentNo: 7, firstOverdueDueDate: '2026-09-05T00:00:00.000Z', mdmLocked: false,
    shopWarrantyEndDate: null, centerWarrantyEndDate: null, lastCall: null, ...over,
  };
}

const latestPurchase = { at: LATEST, kind: 'CASH' as const, number: 'SL-2569-0210', productLabel: 'iPhone 13 128GB', imeiSerial: null, branchId: null, branchName: null };

describe('customerKind', () => {
  it('มีสัญญาผ่อนที่นับว่าซื้อแล้ว → INSTALLMENT', () => {
    expect(customerKind({ purchase: { ...emptyPurchase, installmentTotal: 1, cashCount: 3 } })).toBe('INSTALLMENT');
  });
  it('มีแต่เงินสด/ไฟแนนซ์นอก → CASH', () => {
    expect(customerKind({ purchase: { ...emptyPurchase, externalFinanceCount: 1 } })).toBe('CASH');
  });
  it('ยังไม่เคยซื้อ หรือ purchase เป็น null → PROSPECT', () => {
    expect(customerKind({ purchase: emptyPurchase })).toBe('PROSPECT');
    expect(customerKind({ purchase: null })).toBe('PROSPECT');
  });
});

describe('kpiTiles', () => {
  it('ลูกค้าผ่อน: การซื้อ · คงค้าง(แดงเมื่อค้าง) · งวดถัดไป · ประกันถึง · แต้มสะสม', () => {
    const tiles = kpiTiles(detail({
      purchase: { ...emptyPurchase, installmentTotal: 2, cashCount: 1 },
      installmentBalance: { outstanding: 25200, nextDueDate: NEXT_DUE, nextAmountDue: 4200, openContracts: 1 },
      openContracts: [progress()],
      warranty: { endDate: WARRANTY, source: 'SHOP', shopEndDate: WARRANTY, centerEndDate: null, status: 'IN_SHOP_WARRANTY' },
      latestPurchase,
    }), 120);
    expect(tiles.map((t) => t.key)).toEqual(['purchase', 'outstanding', 'nextDue', 'warranty', 'loyalty']);
    expect(tiles[0]).toMatchObject({ label: 'การซื้อ', value: '3 รายการ', sub: 'ผ่อน 2 · เงินสด 1' });
    expect(tiles[1]).toMatchObject({ label: 'คงค้าง', value: baht(25200), sub: `ค้างชำระ 1 งวด · ${baht(4200)}`, tone: 'destructive' });
    expect(tiles[2]).toMatchObject({ label: 'งวดถัดไป', value: formatDateShort(NEXT_DUE), sub: `${baht(4200)} · CT-2569-0042` });
    expect(tiles[3]).toMatchObject({ label: 'ประกันถึง', value: `ร้าน ${formatDateShort(WARRANTY)}`, sub: 'iPhone 13 128GB' });
    expect(tiles[4]).toMatchObject({ label: 'แต้มสะสม', value: '120', tone: 'primary' });
  });

  it('ลูกค้าผ่อนที่ไม่มีงวดค้าง → คงค้างไม่แดง และบอกว่าไม่มีงวดค้าง', () => {
    const tiles = kpiTiles(detail({
      purchase: { ...emptyPurchase, installmentTotal: 1 },
      installmentBalance: { outstanding: 8400, nextDueDate: NEXT_DUE, nextAmountDue: 4200, openContracts: 1 },
      openContracts: [progress({ overdueInstallments: 0, overdueAmount: 0 })],
    }), 0);
    expect(tiles[1]).toMatchObject({ sub: 'ไม่มีงวดค้าง', tone: 'default' });
    expect(tiles[4]).toMatchObject({ value: '0', tone: 'default' });
  });

  it('ลูกค้าเงินสด/ไฟแนนซ์นอก: การซื้อ · ยอดซื้อรวม · ซื้อล่าสุด · ประกันถึง · แต้มสะสม', () => {
    const tiles = kpiTiles(detail({
      purchase: { ...emptyPurchase, cashCount: 1, externalFinanceCount: 1 },
      sales: [
        { id: 's1', saleNumber: 'SL-1', saleType: 'CASH', netAmount: '590.00', createdAt: LATEST, shopWarrantyEndDate: null, product: null, branch: null },
        { id: 's2', saleNumber: 'SL-2', saleType: 'EXTERNAL_FINANCE', netAmount: '29900.00', createdAt: LATEST, shopWarrantyEndDate: null, product: null, branch: null },
      ],
      latestPurchase,
      warranty: { endDate: WARRANTY, source: 'CENTER', shopEndDate: null, centerEndDate: WARRANTY, status: 'IN_MANUFACTURER' },
    }), null);
    expect(tiles.map((t) => t.key)).toEqual(['purchase', 'salesTotal', 'latest', 'warranty', 'loyalty']);
    expect(tiles[0]).toMatchObject({ value: '2 รายการ', sub: 'เงินสด 1 · ไฟแนนซ์นอก 1' });
    expect(tiles[1]).toMatchObject({ label: 'ยอดซื้อรวม', value: baht(30490) });
    expect(tiles[2]).toMatchObject({ label: 'ซื้อล่าสุด', value: formatDateShort(LATEST), sub: 'iPhone 13 128GB' });
    expect(tiles[3]).toMatchObject({ value: `ศูนย์ ${formatDateShort(WARRANTY)}` });
  });

  it('ผู้สนใจ: 4 ช่อง ที่มา · ติดต่อล่าสุด · ผู้ดูแล · เครดิต', () => {
    const tiles = kpiTiles(detail({
      phone: null, chatPlaceholder: true, source: 'FACEBOOK', creditCheckStatus: 'FULL_CHECK_PASSED',
      lastContactAt: LAST_CONTACT, assignedTo: { id: 'u2', name: 'แนน' },
    }), null);
    expect(tiles.map((t) => t.key)).toEqual(['source', 'lastContact', 'owner', 'credit']);
    expect(tiles[0]).toMatchObject({ label: 'ที่มา', value: 'แชท Facebook', sub: 'ยังไม่มีเบอร์' });
    expect(tiles[1]).toMatchObject({ label: 'ติดต่อล่าสุด', value: formatDateShort(LAST_CONTACT) });
    expect(tiles[2]).toMatchObject({ label: 'ผู้ดูแล', value: 'แนน' });
    expect(tiles[3]).toMatchObject({ label: 'เครดิต', value: 'ผ่านเต็ม', tone: 'success' });
  });

  it('ผู้สนใจที่ยังไม่มีข้อมูล → ขีด · ยังไม่มีผู้ดูแล · ยังไม่เคยตรวจ', () => {
    const tiles = kpiTiles(detail(), null);
    expect(tiles[1].value).toBe('—');
    expect(tiles[2].value).toBe('ยังไม่มีผู้ดูแล');
    expect(tiles[3]).toMatchObject({ value: 'ยังไม่เคยตรวจ', tone: 'default' });
  });
});
```
Run: `TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/kpiTiles.test.ts` (จาก `apps/web`) → Expected: FAIL `Failed to resolve import "../utils/customerKind"`

- [ ] **Step 3: `customerKind.ts`**
```ts
import type { CustomerDetail } from '../types';

export type CustomerKind = 'INSTALLMENT' | 'CASH' | 'PROSPECT';

/** นิยามเจ้าของ 2026-09-12: ลูกค้า = ซื้อแล้ว (ผ่อนกับเรา / เงินสด / ไฟแนนซ์นอก) ที่เหลือ = ผู้สนใจ */
export function customerKind(c: Pick<CustomerDetail, 'purchase'>): CustomerKind {
  const purchase = c.purchase;
  if (purchase && purchase.installmentTotal > 0) return 'INSTALLMENT';
  if (purchase && purchase.cashCount + purchase.externalFinanceCount > 0) return 'CASH';
  return 'PROSPECT';
}
```

- [ ] **Step 4: `kpiTiles.ts`**
```ts
import { customerCreditStatusMap } from '@/lib/status-badges';
import { SOURCE_LABELS } from '@/pages/CustomersPage/components/sourceLabels';
import { formatDateShort } from '@/utils/formatters';
import type { CustomerDetail } from '../types';
import { customerKind } from './customerKind';

export type KpiTone = 'default' | 'primary' | 'success' | 'destructive';
export interface KpiTile {
  key: string;
  label: string;
  value: string;
  sub: string;
  tone: KpiTone;
}

const baht = (n: number) => `${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;
const dateOrDash = (iso: string | null | undefined) => (iso ? formatDateShort(iso) : '—');

function purchaseTile(c: CustomerDetail): KpiTile {
  const p = c.purchase;
  const installment = p?.installmentTotal ?? 0;
  const cash = p?.cashCount ?? 0;
  const external = p?.externalFinanceCount ?? 0;
  const parts = [
    installment ? `ผ่อน ${installment}` : '',
    cash ? `เงินสด ${cash}` : '',
    external ? `ไฟแนนซ์นอก ${external}` : '',
  ].filter(Boolean);
  return { key: 'purchase', label: 'การซื้อ', value: `${installment + cash + external} รายการ`, sub: parts.join(' · '), tone: 'default' };
}

function warrantyTile(c: CustomerDetail): KpiTile {
  const w = c.warranty;
  const prefix = w?.source === 'SHOP' ? 'ร้าน ' : w?.source === 'CENTER' ? 'ศูนย์ ' : '';
  return {
    key: 'warranty',
    label: 'ประกันถึง',
    value: w?.endDate ? `${prefix}${formatDateShort(w.endDate)}` : '—',
    sub: c.latestPurchase?.productLabel ?? '',
    tone: 'default',
  };
}

function loyaltyTile(balance: number | null): KpiTile {
  const value = balance ?? 0;
  return { key: 'loyalty', label: 'แต้มสะสม', value: value.toLocaleString('th-TH'), sub: '', tone: value > 0 ? 'primary' : 'default' };
}

export function kpiTiles(c: CustomerDetail, loyaltyBalance: number | null): KpiTile[] {
  const kind = customerKind(c);

  if (kind === 'INSTALLMENT') {
    const overdueCount = c.openContracts.reduce((sum, k) => sum + k.overdueInstallments, 0);
    const overdueAmount = c.openContracts.reduce((sum, k) => sum + k.overdueAmount, 0);
    const next = c.openContracts
      .filter((k) => k.nextDueDate)
      .sort((a, b) => (a.nextDueDate! < b.nextDueDate! ? -1 : 1))[0];
    return [
      purchaseTile(c),
      {
        key: 'outstanding',
        label: 'คงค้าง',
        // ตัวเลขเดียวกับคอลัมน์ "คงค้าง" ของหน้ารายชื่อ (installmentBalance) — ห้ามรวมเองจาก openContracts
        value: baht(c.installmentBalance?.outstanding ?? 0),
        sub: overdueCount > 0 ? `ค้างชำระ ${overdueCount} งวด · ${baht(overdueAmount)}` : 'ไม่มีงวดค้าง',
        tone: overdueCount > 0 ? 'destructive' : 'default',
      },
      {
        key: 'nextDue',
        label: 'งวดถัดไป',
        value: dateOrDash(next?.nextDueDate),
        sub: next && next.nextAmountDue !== null ? `${baht(next.nextAmountDue)} · ${next.contractNumber}` : '',
        tone: 'default',
      },
      warrantyTile(c),
      loyaltyTile(loyaltyBalance),
    ];
  }

  if (kind === 'CASH') {
    const salesTotal = (c.sales ?? []).reduce((sum, s) => sum + Number(s.netAmount), 0);
    return [
      purchaseTile(c),
      { key: 'salesTotal', label: 'ยอดซื้อรวม', value: baht(salesTotal), sub: '', tone: 'default' },
      { key: 'latest', label: 'ซื้อล่าสุด', value: dateOrDash(c.latestPurchase?.at), sub: c.latestPurchase?.productLabel ?? '', tone: 'default' },
      warrantyTile(c),
      loyaltyTile(loyaltyBalance),
    ];
  }

  const credit = customerCreditStatusMap[c.creditCheckStatus] ?? customerCreditStatusMap.NONE;
  return [
    { key: 'source', label: 'ที่มา', value: SOURCE_LABELS[c.source] ?? c.source, sub: c.chatPlaceholder ? 'ยังไม่มีเบอร์' : '', tone: 'default' },
    { key: 'lastContact', label: 'ติดต่อล่าสุด', value: dateOrDash(c.lastContactAt), sub: '', tone: 'default' },
    { key: 'owner', label: 'ผู้ดูแล', value: c.assignedTo?.name ?? 'ยังไม่มีผู้ดูแล', sub: '', tone: 'default' },
    {
      key: 'credit',
      label: 'เครดิต',
      value: credit.label,
      sub: '',
      tone: c.creditCheckStatus === 'FULL_CHECK_PASSED' ? 'success' : c.creditCheckStatus === 'REJECTED' ? 'destructive' : 'default',
    },
  ];
}
```
Run เทส Step 2 → Expected: PASS 8 tests · `npx tsc --noEmit` → 0 error (ถ้า fixture ฟ้องว่าขาดฟิลด์ของ `CustomerDetail` ให้เติมฟิลด์นั้นใน `detail()` ตามค่าในไฟล์ type ห้ามใช้ `as`)

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/pages/CustomerDetailPage/types.ts apps/web/src/pages/CustomerDetailPage/utils/customerKind.ts apps/web/src/pages/CustomerDetailPage/utils/kpiTiles.ts apps/web/src/pages/CustomerDetailPage/__tests__/kpiTiles.test.ts
git commit -m "feat(web): ตัวคำนวณประเภทลูกค้าและตัวเลข 5 ช่องของหน้ารายละเอียดลูกค้า

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: เว็บ — แตกไฟล์เดี่ยวเป็นโฟลเดอร์ (หน้าตาและพฤติกรรมเหมือนเดิมทุกอย่าง)

**Files:**
- Create: `apps/web/src/pages/CustomerDetailPage/__tests__/fixtures.ts` (ย้าย `emptyPurchase`, `detail()`, `progress()` ออกจาก `kpiTiles.test.ts` แล้ว export)
- Modify: `apps/web/src/pages/CustomerDetailPage/__tests__/kpiTiles.test.ts` (import จาก `./fixtures`)
- Create: `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx`
- Create: `apps/web/src/pages/CustomerDetailPage/index.tsx` · `hooks/useCustomerDetailData.ts` · `components/EditCustomerDialog.tsx` · `tabs/ContractsTab.tsx` · `tabs/SalesTab.tsx` · `tabs/CreditTab.tsx` · `tabs/LoyaltyTab.tsx`
- Delete: `apps/web/src/pages/CustomerDetailPage.tsx`

**Interfaces:**
- Consumes: `types.ts` จาก Task 2
- Produces:
  - `useCustomerDetailData(id: string)` → `{ customer, isLoading, customerError, customerErrorDetail, refetchCustomer, risk, creditChecks, tierData, loyaltyPoints, loyaltyHistory, referralStats, activityLogs }` — query ทุกตัวย้ายมาทั้งก้อน **queryKey เดิมทุกตัว** (`['customer', id]`, `['customer-risk', id]`, `['customer-credit-checks', id]`, `['customer-tier', id]`, `['customer-loyalty-points', id]`, `['customer-loyalty-history', id]`, `['customer-referral-stats', id]`, `['customer-activity', id]`) · `enabled` ของ activity ยังเป็น OWNER เท่านั้น
  - `EditCustomerDialog({ customer, open, onClose }: { customer: CustomerDetail; open: boolean; onClose: () => void })` — เป็นเจ้าของ state ฟอร์มแก้ไข + `updateCustomerMutation` · เมื่อ `open` เปลี่ยนเป็น `true` ตั้งค่าฟอร์มจาก `customer` ด้วยเนื้อ `startEdit` เดิม (ใน `useEffect`)
  - `ContractsTab({ customer, isOwner, activityLogs })` · `SalesTab({ customer })` · `CreditTab({ customer, creditChecks, canStartCredit, canReviewCredit, onOpenCreate })` (เป็นเจ้าของ `analyzeCreditMutation`, `overrideCreditMutation`, state override และ `<CreditCheckOverrideDialog>`) · `LoyaltyTab({ customerId, canEdit, loyaltyPoints, loyaltyHistory, referralStats })` (เป็นเจ้าของ `redeemForm` + `redeemMutation`)
  - `index.tsx` default export `CustomerDetailPage` — ยังเป็นเจ้าของ: tab ใน URL (`?tab=`), สิทธิ์ `canEdit/canStartCredit/canUploadDocuments/canReviewCredit`, `showCreditDialog` + `<CreditCheckCreateDialog>`, mutation อัปโหลด/ลบเอกสาร, และ JSX ของแท็บ `info`/`contact`/`work` ตามเดิม (Task 4 ย้ายไปคอลัมน์ขวา)

- [ ] **Step 1: เทสจับพฤติกรรมหน้าเดิม (ต้องเขียวกับไฟล์เดิมก่อนแตก)**

สร้าง `__tests__/fixtures.ts` โดยย้าย `emptyPurchase`, `detail()`, `progress()` จาก `kpiTiles.test.ts` มาทั้งตัว เติม `export` · ใน `detail()` เปลี่ยน `contracts: []` เป็น
```ts
    contracts: [{
      id: 'k1', contractNumber: 'CT-2569-0042', status: 'ACTIVE', sellingPrice: '30000.00', monthlyPayment: '4200.00',
      totalMonths: 12, createdAt: '2026-03-05T03:00:00.000Z',
      product: { id: 'p1', name: 'iPhone 15', brand: 'Apple', model: 'iPhone 15' },
      branch: { id: 'b1', name: 'สำนักงานใหญ่' },
    }],
```
แล้วแก้ `kpiTiles.test.ts` ให้ `import { detail, emptyPurchase, progress } from './fixtures';` (ลบนิยามซ้ำในไฟล์) → รัน `TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/kpiTiles.test.ts` ต้องยัง PASS 8 tests

สร้าง `__tests__/CustomerDetailPage.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomerDetailPage from '@/pages/CustomerDetailPage';
import { detail } from './fixtures';

/**
 * harness ลอกจาก pages/CustomersPage/__tests__/CustomersPage.test.tsx
 * 🔴 hook ของ vitest ห้าม return ค่า — คร่อมปีกกาเสมอ
 * 🔴 GET ที่ไม่ได้ลงทะเบียนต้องโยน error พร้อม URL — ถ้าคอมโพเนนต์ในหน้าเรียก endpoint ใหม่
 *    ให้เพิ่ม URL นั้นใน RESPONSES ด้วยรูปข้อมูลที่คอมโพเนนต์นั้นอ่าน (ดูจากไฟล์คอมโพเนนต์)
 */
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  role: 'OWNER',
  detail: null as unknown,
}));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.del },
  getErrorMessage: () => 'ผิดพลาด',
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'admin', role: mocks.role } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const RESPONSES: Record<string, unknown> = {
  '/customers/c1/risk-flag': { hasRisk: false, riskLevel: 'NONE', overdueContracts: [] },
  '/customers/c1/credit-check': [],
  '/customers/c1/tier': { tier: 'GOOD' },
  '/loyalty/c1/points': { balance: 120, lifetimeEarned: 140, lifetimeRedeemed: 20, referralCount: 0 },
  '/loyalty/c1/history?limit=20': { data: [] },
  '/loyalty/referral-stats/c1': { totalReferrals: 0, referralsWithContract: 0, totalPointsFromReferrals: 0, referrals: [] },
  '/audit/logs?entity=customers&entityId=c1&limit=20': { data: [] },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/customers/c1']}>
        <Routes>
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.role = 'OWNER';
  mocks.detail = detail();
  mocks.get.mockReset();
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/customers/c1') return { data: mocks.detail };
    if (url in RESPONSES) return { data: RESPONSES[url] };
    throw new Error(`unexpected GET ${url}`);
  });
});

describe('CustomerDetailPage', () => {
  it('แสดงชื่อลูกค้า และแท็บสัญญาแสดงเลขสัญญา', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'สมชาย ใจดี' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /สัญญา/ }));
    expect(await screen.findByText('CT-2569-0042')).toBeInTheDocument();
  });

  it('OWNER เห็นปุ่มแก้ไขข้อมูล และเปิดฟอร์มพร้อมชื่อเดิม', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'แก้ไขข้อมูล' }));
    const dialog = await screen.findByRole('dialog', { name: 'แก้ไขข้อมูลลูกค้า' });
    await waitFor(() => expect(dialog.querySelector('input[value="สมชาย ใจดี"]')).not.toBeNull());
  });

  it('SALES ไม่เห็นปุ่มแก้ไขข้อมูล', async () => {
    mocks.role = 'SALES';
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'สมชาย ใจดี' });
    expect(screen.queryByRole('button', { name: 'แก้ไขข้อมูล' })).toBeNull();
  });
});
```
Run: `TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx` → Expected: **PASS 3 tests กับไฟล์เดิม** (`@/pages/CustomerDetailPage` resolve ไป `CustomerDetailPage.tsx` ก่อนโฟลเดอร์) · ถ้าแดงเพราะ `unexpected GET` ให้เพิ่ม URL นั้นใน `RESPONSES` จนเขียว — ห้ามแก้ไฟล์หน้าเดิมใน step นี้

- [ ] **Step 2: ย้ายโค้ด (ห้ามแก้ logic, ห้ามแก้ className, ห้ามแก้ข้อความ)**

อ้างบรรทัดของ `apps/web/src/pages/CustomerDetailPage.tsx` ปัจจุบัน (ยืนยันด้วยการค้นชื่อตัวแปรก่อนตัด):
- `hooks/useCustomerDetailData.ts` ← query `customer` (~196-206 รวม `useDocumentTitle`), `risk` (207-210), `creditChecks` (212-215), `tierData` (217-226), `loyaltyPoints` (394-404), `loyaltyHistory` (406-421), `referralStats` (423-434), `activityLogs` (452-459) · รับ `user` จาก `useAuth()` ภายใน hook สำหรับ `enabled` ของ activity
- `components/EditCustomerDialog.tsx` ← state ฟอร์ม (169-190), `startEdit` (224-266 ย้ายเนื้อไปใน `useEffect(() => { if (open) { ... } }, [open])`), `updateEditRef` (268-270), `updateCustomerMutation` (272-312 — ใน `onSuccess` เดิมที่ปิดโมดัล ให้เรียก `onClose()`), JSX โมดัล (1150-1390 — เงื่อนไข `showEditModal &&` เปลี่ยนเป็น `if (!open) return null`)
- `tabs/ContractsTab.tsx` ← `contractColumns` (480-490) + JSX แท็บ `contracts` (919-958) + `actionLabels` (130-137)
- `tabs/SalesTab.tsx` ← `saleColumns` + `purchases` (492-545) + JSX แท็บ `purchases` (960-975)
- `tabs/CreditTab.tsx` ← state override (158-166), `analyzeCreditMutation` (314-324), `overrideCreditMutation` (326-352), JSX แท็บ `credit` (875-917 — ปุ่ม `+ ตรวจเครดิตใหม่` เรียก `onOpenCreate`), `<CreditCheckOverrideDialog>` (1407-1432)
- `tabs/LoyaltyTab.tsx` ← `redeemForm` state + `redeemMutation` (436-450) + JSX แท็บ `loyalty` (977-1146)
- `index.tsx` ← ส่วนที่เหลือทั้งหมด: imports ที่ยังใช้, tab state + `handleTabChange` (146-167), สิทธิ์ (192-195), mutation เอกสาร (354-392), early returns (461-478), `callableContract`/`displayName`/`refs` (547-557), JSX หน้า (559-1148 โดยแทนเนื้อแท็บที่ย้ายด้วย `<ContractsTab …/>` ฯลฯ), `{showEditModal && …}` → `<EditCustomerDialog customer={customer} open={showEditModal} onClose={() => setShowEditModal(false)} />`, `<CreditCheckCreateDialog>` (1391-1406), ฟังก์ชัน `Info` (1436)
- import `type` จาก `./types` แทนการประกาศ interface ในไฟล์ · ลบ `apps/web/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 3: ยืนยันว่าเหมือนเดิม**

Run (จาก `apps/web`):
```bash
TZ=UTC npx vitest run src/pages/CustomerDetailPage
npx tsc --noEmit
npx eslint src/pages/CustomerDetailPage
```
Expected: PASS 11 tests (8 kpiTiles + 3 page) · tsc 0 error · eslint 0 error · `grep -rn "pages/CustomerDetailPage'" src/App.tsx` ยังเป็น `import('@/pages/CustomerDetailPage')` ไม่ต้องแก้

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/pages/CustomerDetailPage apps/web/src/pages/CustomerDetailPage.tsx
git commit -m "refactor(web): แตกหน้ารายละเอียดลูกค้าเป็นโฟลเดอร์ (หน้าตาเหมือนเดิม)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: เว็บ — หัวหน้าใหม่ · ตัวเลข 5 ช่อง · แถบเตือนค้างชำระ · คอลัมน์ขวา

**Files:**
- Create: `apps/web/src/pages/CustomerDetailPage/components/DetailHeader.tsx` · `ActionsMenu.tsx` · `KpiTiles.tsx` · `RiskBanner.tsx` · `CustomerSidePanel.tsx`
- Modify: `apps/web/src/pages/CustomerDetailPage/index.tsx` (แทน `PageHeader` + การ์ดโปรไฟล์ + กล่องเตือนความเสี่ยงเดิม + การ์ดสรุป 4 ใบ · ถอดแท็บ `info`/`contact`/`work` ไปไว้คอลัมน์ขวา · จัด 2 คอลัมน์)
- Modify: `apps/web/src/pages/CustomerDetailPage/hooks/useCustomerDetailData.ts` (ถอด query `risk` — แถบเตือนใหม่อ่านจาก `customer.openContracts`)
- Test: `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx` (เพิ่ม describe)

**Interfaces:**
- Consumes: `CustomerDetail`, `ContractProgress` (Task 2) · `customerKind`, `kpiTiles`, `KpiTile` (Task 2) · `ChatCell` จาก `@/pages/CustomersPage/components/CustomerCells` · `isChatVisibleForRole` จาก `@/config/menu` · `CustomerTierBadge` จาก `@/components/customer/CustomerTierBadge` · `CustomerTagChips` จาก `@/pages/CollectionsPage/components/CustomerTagChips` · `ProspectPhoneLine` จาก `@/components/customer/ProspectPhoneLine` · `CallButton` จาก `@/components/CallButton` · `canFillProspectContact` จาก `@/lib/constants` · `CustomerCreateDialog`, `splitDisplayName` จาก `@/components/customer/CustomerCreateDialog` · `useAbsorbCustomer` จาก `@/pages/UnifiedInboxPage/hooks/useProspectActions`
- Produces:
  - `DetailHeader(props: { customer: CustomerDetail; tier: CustomerTier | null; role: string; canEdit: boolean; canStartCredit: boolean; onEdit: () => void; onStartCredit: () => void })`
  - `ActionsMenu(props: { customerId: string; role: string; chatPlaceholder: boolean; canStartCredit: boolean; onStartCredit: () => void; payContractId: string | null })`
  - `KpiTiles(props: { tiles: KpiTile[] })`
  - `RiskBanner(props: { contracts: ContractProgress[] })` — ไม่วาดอะไรเมื่อไม่มีงวดค้าง
  - `CustomerSidePanel(props: { customer: CustomerDetail; role: string; canEdit: boolean; canUploadDocuments: boolean; onEdit: () => void })` — เป็นเจ้าของ mutation อัปโหลด/ลบเอกสาร (ย้ายจาก `index.tsx`)
  - ค่าคงที่ใน `index.tsx`: `DEFAULT_TAB = 'contracts'` (Task 5 เปลี่ยนเป็น `'overview'`) และ `LEGACY_TAB_REDIRECT: Record<string, string> = { info: DEFAULT_TAB, contact: DEFAULT_TAB, work: DEFAULT_TAB }`

- [ ] **Step 1: เทสแดง**

เพิ่มท้าย `CustomerDetailPage.test.tsx` (import เพิ่ม `useLocation` จาก `react-router`, `formatNationalId, maskNationalId` จาก `@/utils/mask.util`, `progress, emptyPurchase` จาก `./fixtures`):
```tsx
function Location() {
  const location = useLocation();
  return <output aria-label="current location">{location.pathname}{location.search}</output>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/customers/:id" element={<><CustomerDetailPage /><Location /></>} />
          <Route path="*" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('หัวหน้า + ตัวเลข + แถบเตือน + คอลัมน์ขวา', () => {
  it('ลูกค้าผ่อนค้างชำระ: ป้ายระดับ + แท็ก + ช่องคงค้าง + แถบเตือนพาไปรับชำระ', async () => {
    mocks.detail = detail({
      tags: [{ tag: 'LOYAL' }],
      purchase: { ...emptyPurchase, installmentTotal: 1 },
      installmentBalance: { outstanding: 25200, nextDueDate: '2026-10-05T00:00:00.000Z', nextAmountDue: 4200, openContracts: 1 },
      openContracts: [progress()],
    });
    renderAt('/customers/c1');
    expect(await screen.findByText('ลูกค้าดี')).toBeInTheDocument();
    expect(screen.getByText('ลูกค้าประจำ')).toBeInTheDocument();
    expect(screen.getByText('คงค้าง')).toBeInTheDocument();
    expect(screen.getByText(/ค้างชำระ 1 งวด/, { selector: '[data-testid="risk-banner"] *' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'รับชำระ' }));
    expect(await screen.findByLabelText('current location')).toHaveTextContent('/payments?contractId=k1');
  });

  it('ผู้สนใจจากแชท (SALES): ป้ายผู้สนใจ · ไม่มีเบอร์ · ปุ่มเติมเบอร์ · 4 ช่อง · เมนูไม่มีสร้างสัญญา', async () => {
    mocks.role = 'SALES';
    mocks.detail = detail({ phone: null, chatPlaceholder: true, source: 'FACEBOOK', purchase: emptyPurchase, contracts: [] });
    renderAt('/customers/c1');
    expect(await screen.findByText('ผู้สนใจ')).toBeInTheDocument();
    expect(screen.getAllByText('จากแชท · ยังไม่มีเบอร์').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'เติมเบอร์' })).toBeInTheDocument();
    for (const label of ['ที่มา', 'ติดต่อล่าสุด', 'ผู้ดูแล', 'เครดิต']) expect(screen.getByText(label)).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: /ดำเนินการ/ }), { button: 0, pointerType: 'mouse' });
    expect(await screen.findByRole('menuitem', { name: 'ตรวจเครดิตใหม่' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'สร้างสัญญาผ่อน' })).toBeNull();
  });

  it('คอลัมน์ขวา: เลขบัตรเต็มเฉพาะ OWNER · SALES เห็นแบบปิดบัง · LINE ยังไม่ผูก', async () => {
    mocks.detail = detail({ nationalId: '1101401234567' });
    const { unmount } = renderAt('/customers/c1');
    expect(await screen.findByText(formatNationalId('1101401234567'))).toBeInTheDocument();
    expect(screen.getAllByText('ยังไม่ผูก').length).toBe(2);
    unmount();
    mocks.role = 'SALES';
    renderAt('/customers/c1');
    expect(await screen.findByText(maskNationalId('1101401234567'))).toBeInTheDocument();
  });

  it('ลิงก์เก่า ?tab=contact ยังเปิดได้ (ข้อมูลติดต่อย้ายไปคอลัมน์ขวา)', async () => {
    renderAt('/customers/c1?tab=contact');
    expect(await screen.findByRole('heading', { level: 1, name: 'สมชาย ใจดี' })).toBeInTheDocument();
    expect(screen.getByText('ติดต่อ')).toBeInTheDocument();
  });
});
```
Run: `TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx` → Expected: FAIL (ไม่มีข้อความ `ผู้สนใจ` / `risk-banner`)

- [ ] **Step 2: `KpiTiles.tsx`**
```tsx
import { cn } from '@/lib/utils';
import type { KpiTile, KpiTone } from '../utils/kpiTiles';

const TONE_TEXT: Record<KpiTone, string> = {
  default: 'text-foreground',
  primary: 'text-primary',
  success: 'text-success',
  destructive: 'text-destructive',
};

export default function KpiTiles({ tiles }: { tiles: KpiTile[] }) {
  return (
    <div className={cn('mb-5 grid grid-cols-2 gap-4 md:grid-cols-4', tiles.length === 5 ? 'xl:grid-cols-5' : 'xl:grid-cols-4')}>
      {tiles.map((tile) => (
        <div key={tile.key} className="min-w-0 rounded-xl border border-border/50 bg-card p-4 shadow-sm">
          <div className="truncate text-xs leading-snug text-muted-foreground">{tile.label}</div>
          <div className={cn('mt-1 truncate text-xl font-bold leading-snug tabular-nums', TONE_TEXT[tile.tone])} title={tile.value}>
            {tile.value}
          </div>
          <div className="mt-0.5 truncate text-xs leading-snug text-muted-foreground" title={tile.sub}>
            {tile.sub || ' '}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `RiskBanner.tsx`**
```tsx
import { AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDateShort } from '@/utils/formatters';
import type { ContractProgress } from '../types';

// ป้ายเดียวกับ CALL_RESULT_LABELS ของ apps/api/src/modules/overdue/timeline.service.ts
const CALL_RESULT_LABELS: Record<string, string> = {
  NO_ANSWER: 'ไม่รับสาย', ANSWERED: 'รับสาย', PROMISED: 'นัดชำระ', REFUSED: 'ปฏิเสธ', WRONG_NUMBER: 'เบอร์ผิด', OTHER: 'อื่น ๆ',
};
const baht = (n: number) => `${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;

export default function RiskBanner({ contracts }: { contracts: ContractProgress[] }) {
  const navigate = useNavigate();
  const late = contracts.filter((k) => k.overdueInstallments > 0);
  if (late.length === 0) return null;
  const first = late[0];
  const count = late.reduce((sum, k) => sum + k.overdueInstallments, 0);
  const amount = late.reduce((sum, k) => sum + k.overdueAmount, 0);
  const days = first.firstOverdueDueDate
    ? Math.max(0, Math.floor((Date.now() - new Date(first.firstOverdueDueDate).getTime()) / 86_400_000))
    : null;
  const severe = late.some((k) => k.status === 'DEFAULT');
  const call = first.lastCall;

  return (
    <div
      data-testid="risk-banner"
      className={cn(
        'relative mb-5 flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-xl border py-3 pl-5 pr-4',
        severe ? 'border-destructive/20 bg-destructive/5' : 'border-warning/20 bg-warning/5',
      )}
    >
      <div className={cn('absolute bottom-0 left-0 top-0 w-1 rounded-r-full', severe ? 'bg-destructive' : 'bg-warning')} />
      <div className="min-w-0">
        <div className={cn('flex items-center gap-2 text-sm font-semibold leading-snug', severe ? 'text-destructive' : 'text-warning')}>
          <AlertTriangle className="size-4" aria-hidden="true" />
          <span>ค้างชำระ {count} งวด · <span className="tabular-nums">{baht(amount)}</span></span>
        </div>
        <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
          สัญญา <span className="font-mono tabular-nums">{first.contractNumber}</span>
          {first.firstOverdueInstallmentNo !== null && first.firstOverdueDueDate && (
            <> งวด {first.firstOverdueInstallmentNo} ครบกำหนด {formatDateShort(first.firstOverdueDueDate)}{days !== null && ` (ค้าง ${days} วัน)`}</>
          )}
          {call && (
            <> · โทรล่าสุด {formatDateShort(call.calledAt)} {CALL_RESULT_LABELS[call.result] ?? call.result}{call.notes ? ` "${call.notes}"` : ''}</>
          )}
        </div>
      </div>
      <Button variant="primary" size="sm" onClick={() => navigate(`/payments?contractId=${first.id}`)}>
        รับชำระ
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: `ActionsMenu.tsx`**
```tsx
import { ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const SALE_ROLES = ['OWNER', 'BRANCH_MANAGER', 'SALES']; // ตรง ProtectedRoute ของ /contracts/create และ /pos ใน App.tsx
const BOOKING_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']; // ตรง /bookings

export default function ActionsMenu({ customerId, role, chatPlaceholder, canStartCredit, onStartCredit, payContractId }: {
  customerId: string;
  role: string;
  chatPlaceholder: boolean;
  canStartCredit: boolean;
  onStartCredit: () => void;
  payContractId: string | null;
}) {
  const navigate = useNavigate();
  // ผู้สนใจที่ยังไม่มีเบอร์: API กันเปิดสัญญา/ใบขาย/ใบจอง (assertCustomerHasPhone) ⇒ ไม่เสนอทางที่ทำไม่ได้
  const canSell = SALE_ROLES.includes(role) && !chatPlaceholder;
  const items = [
    canStartCredit && { key: 'credit', label: 'ตรวจเครดิตใหม่', run: onStartCredit },
    canSell && { key: 'contract', label: 'สร้างสัญญาผ่อน', run: () => navigate(`/contracts/create?customerId=${customerId}`) },
    canSell && { key: 'pos', label: 'เปิดหน้าขาย', run: () => navigate('/pos') },
    BOOKING_ROLES.includes(role) && !chatPlaceholder && { key: 'booking', label: 'เปิดหน้าจอง / มัดจำ', run: () => navigate('/bookings') },
    payContractId && { key: 'pay', label: 'รับชำระ', run: () => navigate(`/payments?contractId=${payContractId}`) },
  ].filter((item): item is { key: string; label: string; run: () => void } => Boolean(item));
  if (items.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="primary" size="md">
          ดำเนินการ
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem key={item.key} onSelect={item.run}>{item.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 5: `DetailHeader.tsx`**

โครง (ใช้คลาสเดียวกับ `PageHeader` เดิม: `flex flex-col gap-2 py-5 mb-5 border-b border-border`):
```tsx
import { Pencil, Phone } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { CallButton } from '@/components/CallButton';
import CustomerTierBadge from '@/components/customer/CustomerTierBadge';
import CustomerCreateDialog, { splitDisplayName } from '@/components/customer/CustomerCreateDialog';
import ProspectPhoneLine from '@/components/customer/ProspectPhoneLine';
import { isChatVisibleForRole } from '@/config/menu';
import { canFillProspectContact } from '@/lib/constants';
import CustomerTagChips from '@/pages/CollectionsPage/components/CustomerTagChips';
import { ChatCell } from '@/pages/CustomersPage/components/CustomerCells';
import { useAbsorbCustomer } from '@/pages/UnifiedInboxPage/hooks/useProspectActions';
import type { CustomerTier } from '@/types/customer-tier';
import { formatDateShort } from '@/utils/formatters';
import type { CustomerDetail } from '../types';
import { customerKind } from '../utils/customerKind';
import ActionsMenu from './ActionsMenu';
```
พฤติกรรมที่ต้องมี (ทุกข้อมีเทสใน Step 1):
1. breadcrumb `ลูกค้า › <ชื่อ>` (ลอก JSX breadcrumb เดิมจาก `index.tsx`)
2. แถวชื่อ: `<h1 className="text-lg font-semibold leading-snug text-foreground">{[customer.prefix, customer.name].filter(Boolean).join('')}</h1>` · ถ้า `customerKind(customer) === 'PROSPECT'` → `<Badge variant="secondary" size="md">ผู้สนใจ</Badge>` · ไม่งั้นถ้ามี `tier` → `<CustomerTierBadge tier={tier} size="md" />` · ต่อด้วย `<CustomerTagChips tags={customer.tags} compact />` · `customer.isForeigner` → `<Badge variant="warning" appearance="light" size="md">ชาวต่างชาติ</Badge>`
3. บรรทัดเมตา `flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug text-muted-foreground` คั่นด้วย `<span aria-hidden="true">·</span>`: ชื่อเล่น (ถ้ามี) · `<ProspectPhoneLine phone={customer.phone} chatPlaceholder={customer.chatPlaceholder} />` + ปุ่มคัดลอกเบอร์ (ลอกปุ่ม `CopyButton` + `copyValue` แบบเดียวกับ `pages/CustomersPage/index.tsx` — ค้น `copyValue` แล้วใช้ hook ตัวเดียวกัน) · `<ChatCell rooms={customer.chatRooms} canOpenChat={isChatVisibleForRole(role)} />` (ไม่วาดเมื่อไม่มีห้อง — ถ้า `ChatCell` คืน `Dash` ให้ครอบด้วย `customer.chatRooms.length > 0 &&`) · ลูกค้า: `ลูกค้าตั้งแต่ {formatDateShort(customer.createdAt)}` / ผู้สนใจ: `เพิ่มเมื่อ {formatDateShort(customer.createdAt)}` · `customer.latestPurchase?.branchName` (ถ้ามี)
4. ปุ่มขวา `flex items-center gap-2`:
   - สัญญาที่โทรได้ = `customer.openContracts[0]` · ถ้ามีและ `customer.phone` → `<CallButton customerId={customer.id} contractId={customer.openContracts[0].id} phone={customer.phone} size="md" variant="outline" />`
   - ถ้า `customer.chatPlaceholder && canFillProspectContact(role)` → `<Button variant="outline" size="md" onClick={() => setFillOpen(true)}><Phone className="size-4" />เติมเบอร์</Button>` และวาง `CustomerCreateDialog` โหมดเติมเบอร์โดยลอก props จาก `pages/UnifiedInboxPage/components/RoomDossier.tsx:780-795` (`mode="fill"`, `fillCustomerId={customer.id}`, `initialValues` สร้างด้วย `splitDisplayName` แบบเดียวกับ `createInitialValues` ในไฟล์นั้น, `submitLabel="บันทึก"`, `onCreated={() => undefined}`) · `onFilled` → `queryClient.invalidateQueries({ queryKey: ['customer', customer.id] })` + `['customers']` · `onUseExisting={(c) => absorb.mutate({ placeholderId: customer.id, targetId: c.id }, { onSuccess: () => navigate(`/customers/${c.id}`, { replace: true }) })}` · ไม่ใส่ prop `context`
   - `canEdit` → `<Button variant="outline" size="md" onClick={onEdit}><Pencil className="size-4" />แก้ไขข้อมูล</Button>`
   - `<ActionsMenu customerId={customer.id} role={role} chatPlaceholder={!!customer.chatPlaceholder} canStartCredit={canStartCredit} onStartCredit={onStartCredit} payContractId={customer.openContracts[0]?.id ?? null} />`
   - ปุ่ม `กลับ` เดิมถอดออก (breadcrumb ทำหน้าที่แทน)

- [ ] **Step 6: `CustomerSidePanel.tsx`**

การ์ดเดียว `rounded-xl bg-card shadow-sm shadow-black/5 overflow-hidden` แต่ละหมวดคั่น `border-t border-border` (หมวดแรกไม่มี) · หัวหมวด `text-[11px] font-semibold uppercase tracking-wider text-muted-foreground` · แถวข้อมูลใช้ `Info` เดิม (ย้ายฟังก์ชัน `Info` จาก `index.tsx` มาไว้ไฟล์นี้แล้ว export) · หมวดตามลำดับ:
1. **ติดต่อ** (ขวาหัวหมวด: ลิงก์ `แก้ไข` เมื่อ `canEdit` เรียก `onEdit`) — เบอร์โทร (`ProspectPhoneLine`) · เบอร์สำรอง · อีเมล · `LINE Finance (น้องเบส)` → ถ้า `customer.lineIdFinance` = `<Badge variant="success" appearance="light" size="sm">ผูกแล้ว</Badge>` ไม่งั้น `<Badge variant="secondary" size="sm">ยังไม่ผูก</Badge>` · `LINE Shop (ร้าน)` → `customer.lineIdShop` แบบเดียวกัน · Facebook (ลิงก์ `facebookLink` + ชื่อ `facebookName` + `เพื่อน {facebookFriends}`) · ลิงก์ Google Map · **ห้ามแสดงค่า lineId ดิบ**
2. **ข้อมูลส่วนตัว** — คำนำหน้า · ชื่อเล่น · เลขบัตร ปชช. (`role === 'OWNER' ? formatNationalId : maskNationalId` เหมือนเดิม) · วันเกิด · อายุ (ย้ายสูตรอายุเดิมจากแท็บ `info`)
3. **ที่อยู่** — ตามบัตร · ปัจจุบัน (`displayAddress`)
4. **งาน & รายได้** — ชื่อที่ทำงาน · อาชีพ · รายละเอียดอาชีพ · เงินเดือน · ที่อยู่ที่ทำงาน (ย้ายจากแท็บ `work`)
5. **บุคคลอ้างอิง ({refs.length})** — ย้ายรายการจากแท็บ `work`
6. **เอกสาร** — ย้ายบล็อกเอกสาร + mutation อัปโหลด/ลบจาก `index.tsx` มาทั้งก้อน (เงื่อนไข `canUploadDocuments` / `canEdit` เดิม)
- หมวดที่ทุกช่องว่าง (หมวด 2-5) → แทนแถว `-` ด้วยกล่อง `rounded-lg border border-dashed border-border px-3 py-2.5 text-[13px] leading-snug text-muted-foreground` ข้อความ `ยังไม่กรอก` + ปุ่มลิงก์ `เพิ่ม` (เฉพาะ `canEdit`) เรียก `onEdit`

- [ ] **Step 7: ประกอบใน `index.tsx`**
- ลบ: `PageHeader`, การ์ดโปรไฟล์, กล่อง Risk Warning, การ์ดสรุป 4 ใบ, TabsTrigger/TabsContent ของ `info`/`contact`/`work`, mutation เอกสาร (ย้ายแล้ว), ฟังก์ชัน `Info` (ย้ายแล้ว)
- ใส่ตามลำดับ: `<DetailHeader … />` → `<ContractReturnNotice customerId={id} />` (คงไว้) → `<RiskBanner contracts={customer.openContracts} />` → `<KpiTiles tiles={kpiTiles(customer, loyaltyPoints?.balance ?? null)} />` → `<div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"><div className="min-w-0">{Tabs}</div><CustomerSidePanel … /></div>`
- tab เริ่มต้น: `const DEFAULT_TAB = 'contracts'` · `const raw = searchParams.get('tab'); const initialTab = raw ? (LEGACY_TAB_REDIRECT[raw] ?? raw) : DEFAULT_TAB;` · ใน `handleTabChange` ลบ `tab` ออกจาก URL เมื่อ `value === DEFAULT_TAB`
- `useCustomerDetailData`: ลบ query `risk` และ interface `RiskFlag` ออกจาก `types.ts` ถ้าไม่มีใครใช้แล้ว

- [ ] **Step 8: ยืนยัน**
```bash
TZ=UTC npx vitest run src/pages/CustomerDetailPage
npx tsc --noEmit
npx eslint src/pages/CustomerDetailPage
```
Expected: PASS ทุกเทส (เทส Task 3 ที่คลิกแท็บสัญญายังเขียว) · 0 error · ถ้าเทสเมนู Radix ไม่เปิดด้วย `pointerDown` ให้ใช้ `userEvent` จาก `@testing-library/user-event` ถ้ามีใน `apps/web/package.json` (ตรวจก่อน) ไม่งั้นใช้ `fireEvent.keyDown(trigger, { key: 'Enter' })`

- [ ] **Step 9: Commit**
```bash
git add apps/web/src/pages/CustomerDetailPage
git commit -m "feat(web): หน้ารายละเอียดลูกค้า — หัวใหม่ ตัวเลขตามประเภทลูกค้า แถบค้างชำระ และคอลัมน์ข้อมูลติดต่อ

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: เว็บ — แท็บภาพรวม (แท็บเริ่มต้น) + การ์ดสัญญาที่กำลังผ่อน

> ทำไมไม่ใช้ `ContractHeroCard` ของอินบ็อกซ์: type `SummaryContract` ไม่มีงวดค้าง/ยอดค้าง/คงเหลือ/โทรล่าสุด และการ์ดนั้นออกแบบให้แผงกว้าง ~320px — การ์ดนี้กว้างเต็มคอลัมน์ซ้ายและอ่าน `ContractProgress` จาก API โดยตรง ป้ายสถานะใช้ `contractStatusMap` กลางของระบบ

**Files:**
- Create: `apps/web/src/pages/CustomerDetailPage/utils/callResultLabels.ts`
- Create: `apps/web/src/pages/CustomerDetailPage/components/ActiveContractCard.tsx`
- Create: `apps/web/src/pages/CustomerDetailPage/tabs/OverviewTab.tsx`
- Modify: `apps/web/src/pages/CustomerDetailPage/components/RiskBanner.tsx` (ย้าย `CALL_RESULT_LABELS` ไปไฟล์ utils แล้ว import)
- Modify: `apps/web/src/pages/CustomerDetailPage/tabs/SalesTab.tsx` (แยก `SalesTable` ออกมา export)
- Modify: `apps/web/src/pages/CustomerDetailPage/index.tsx` (`DEFAULT_TAB = 'overview'` + แท็บภาพรวมเป็นแท็บแรก)
- Test: `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx`

**Interfaces:**
- Consumes: `CustomerDetail`, `ContractProgress`, `CreditCheckItem` · `customerKind` · `getStatusBadgeProps`, `contractStatusMap`, `customerCreditStatusMap` จาก `@/lib/status-badges` · `LineLinkInvite` จาก `@/components/customer/LineLinkInvite` · `ChannelBadge` จาก `@/components/chat/ChannelBadge` · `isChatVisibleForRole`
- Produces:
  - `CALL_RESULT_LABELS: Record<string, string>` (utils/callResultLabels.ts)
  - `ActiveContractCard({ contract }: { contract: ContractProgress })` — root มี `data-testid={`active-contract-${contract.id}`}`
  - `SalesTable({ sales, limit }: { sales: NonNullable<CustomerDetail['sales']>; limit?: number })`
  - `OverviewTab({ customer, role, onOpenTab }: { customer: CustomerDetail; role: string; onOpenTab: (tab: string) => void })`
  - Plan 2 จะเพิ่มการ์ด "กิจกรรมล่าสุด" ต่อท้ายสุดของ `OverviewTab` — ให้ JSX ของแท็บจบด้วย `<div className="flex flex-col gap-5">…</div>` ก้อนเดียวเพื่อให้ต่อท้ายได้

- [ ] **Step 1: เทสแดง**

เพิ่มท้าย `CustomerDetailPage.test.tsx`:
```tsx
describe('แท็บภาพรวม', () => {
  it('เป็นแท็บเริ่มต้น และการ์ดสัญญาที่กำลังผ่อนบอกงวด ยอด และพาไปหน้าสัญญา', async () => {
    mocks.detail = detail({
      purchase: { ...emptyPurchase, installmentTotal: 1 },
      installmentBalance: { outstanding: 25200, nextDueDate: '2026-10-05T00:00:00.000Z', nextAmountDue: 4200, openContracts: 1 },
      openContracts: [progress()],
    });
    renderAt('/customers/c1');
    const card = await screen.findByTestId('active-contract-k1');
    expect(within(card).getByText('ผ่อนแล้ว 6/12 งวด')).toBeInTheDocument();
    expect(within(card).getByText('งวด 7 · 4,200 ฿')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'ดูสัญญา' }));
    expect(await screen.findByLabelText('current location')).toHaveTextContent('/contracts/k1');
  });

  it('ลิงก์เก่า ?tab=info พามาที่ภาพรวม', async () => {
    mocks.detail = detail({ purchase: { ...emptyPurchase, installmentTotal: 1 }, openContracts: [progress()] });
    renderAt('/customers/c1?tab=info');
    expect(await screen.findByTestId('active-contract-k1')).toBeInTheDocument();
  });

  it('ผู้สนใจที่ยังไม่มีเบอร์ บอกขั้นต่อไปตามจริง', async () => {
    mocks.detail = detail({ phone: null, chatPlaceholder: true, purchase: emptyPurchase, contracts: [] });
    renderAt('/customers/c1');
    expect(await screen.findByText('ยังไม่มีเบอร์ — เปิดสัญญา / ใบขาย / ใบจองได้เมื่อมีเบอร์')).toBeInTheDocument();
  });
});
```
(import `within` จาก `@testing-library/react` เพิ่ม) · Run: `TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx` → Expected: FAIL `Unable to find ... active-contract-k1`

- [ ] **Step 2: `utils/callResultLabels.ts`**
```ts
/** ป้ายผลการโทร — ตรงกับ CALL_RESULT_LABELS ของ apps/api/src/modules/overdue/timeline.service.ts */
export const CALL_RESULT_LABELS: Record<string, string> = {
  NO_ANSWER: 'ไม่รับสาย',
  ANSWERED: 'รับสาย',
  PROMISED: 'นัดชำระ',
  REFUSED: 'ปฏิเสธ',
  WRONG_NUMBER: 'เบอร์ผิด',
  OTHER: 'อื่น ๆ',
};
```
แก้ `RiskBanner.tsx`: ลบค่าคงที่ในไฟล์ แล้ว `import { CALL_RESULT_LABELS } from '../utils/callResultLabels';`

- [ ] **Step 3: `ActiveContractCard.tsx`**
```tsx
import { Lock, LockOpen, Phone, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { contractStatusMap, getStatusBadgeProps } from '@/lib/status-badges';
import { cn } from '@/lib/utils';
import { formatDateShort } from '@/utils/formatters';
import type { ContractProgress } from '../types';
import { CALL_RESULT_LABELS } from '../utils/callResultLabels';

const baht = (n: number) => `${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={cn('min-w-0 rounded-lg px-2.5 py-2', danger ? 'bg-destructive/5' : 'bg-muted/50')}>
      <div className="truncate text-[11.5px] leading-snug text-muted-foreground">{label}</div>
      <div className={cn('truncate text-sm font-bold leading-snug tabular-nums', danger && 'text-destructive')}>{value}</div>
    </div>
  );
}

export default function ActiveContractCard({ contract }: { contract: ContractProgress }) {
  const navigate = useNavigate();
  const status = getStatusBadgeProps(contract.status, contractStatusMap);
  const total = contract.totalInstallments;
  const pct = total > 0 ? Math.round((contract.paidInstallments / total) * 100) : 0;
  const latePct = total > 0 ? Math.round((contract.overdueInstallments / total) * 100) : 0;
  const warrantyEnd = contract.shopWarrantyEndDate ?? contract.centerWarrantyEndDate;
  const warrantyLabel = contract.shopWarrantyEndDate ? 'ประกันร้านถึง' : 'ประกันศูนย์ถึง';
  const meta = [
    <>สัญญา <span className="font-mono tabular-nums">{contract.contractNumber}</span></>,
    `เริ่ม ${formatDateShort(contract.startedAt)}`,
    `${total} งวด`,
    contract.branchName,
    contract.imeiSerial && <>IMEI <span className="font-mono tabular-nums">{contract.imeiSerial}</span></>,
  ].filter(Boolean);

  return (
    <div data-testid={`active-contract-${contract.id}`} className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-bold leading-snug">{contract.productLabel || contract.contractNumber}</span>
            <Badge variant={status.variant} appearance={status.appearance} size="sm">{status.label}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-1.5 text-xs leading-snug text-muted-foreground">
            {meta.map((item, i) => (
              <span key={i} className="whitespace-nowrap">{i > 0 && '· '}{item}</span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button variant="primary" size="sm" onClick={() => navigate(`/payments?contractId=${contract.id}`)}>รับชำระ</Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/contracts/${contract.id}`)}>ดูสัญญา</Button>
        </div>
      </div>

      <div className="mt-3.5">
        <div className="mb-1.5 flex justify-between text-xs leading-snug">
          <span>ผ่อนแล้ว {contract.paidInstallments}/{total} งวด</span>
          <span className="tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={contract.paidInstallments} aria-valuemin={0} aria-valuemax={total}>
          <i className="block h-full bg-success" style={{ width: `${pct}%` }} />
          {latePct > 0 && <i className="block h-full bg-destructive" style={{ width: `${latePct}%` }} />}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="งวดละ" value={baht(contract.monthlyPayment)} />
        <Stat label="เหลือ" value={`${contract.remainingInstallments} งวด · ${baht(contract.outstanding)}`} />
        <Stat
          label="ค้างชำระ"
          value={contract.overdueInstallments > 0 && contract.firstOverdueInstallmentNo !== null ? `งวด ${contract.firstOverdueInstallmentNo} · ${baht(contract.overdueAmount)}` : 'ไม่มี'}
          danger={contract.overdueInstallments > 0}
        />
        <Stat label="งวดถัดไป" value={contract.nextDueDate ? formatDateShort(contract.nextDueDate) : '—'} />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs leading-snug text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {contract.mdmLocked ? <Lock className="size-3.5" aria-hidden="true" /> : <LockOpen className="size-3.5" aria-hidden="true" />}
          ล็อคเครื่อง (MDM): {contract.mdmLocked ? 'ล็อคแล้ว' : 'ยังไม่ล็อค'}
        </span>
        {warrantyEnd && (
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden="true" />{warrantyLabel} {formatDateShort(warrantyEnd)}
          </span>
        )}
        {contract.lastCall && (
          <span className="inline-flex items-center gap-1.5">
            <Phone className="size-3.5" aria-hidden="true" />
            โทรล่าสุด {formatDateShort(contract.lastCall.calledAt)} · {CALL_RESULT_LABELS[contract.lastCall.result] ?? contract.lastCall.result}
            {contract.lastCall.callerName && ` · ${contract.lastCall.callerName}`}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `SalesTable` ใน `tabs/SalesTab.tsx`**

ย้าย `saleColumns` + `<DataTable>` ออกเป็น component ที่ export ในไฟล์เดียวกัน:
```tsx
export function SalesTable({ sales, limit }: { sales: NonNullable<CustomerDetail['sales']>; limit?: number }) {
  const rows = limit ? sales.slice(0, limit) : sales;
  return <DataTable columns={saleColumns} data={rows} emptyMessage="ยังไม่มีการซื้อแบบเงินสด/ไฟแนนซ์นอก" />;
}
```
(`saleColumns` ย้ายเป็นค่าคงที่ระดับไฟล์ — ไม่มีการอ้าง state ของหน้า) · `SalesTab` เดิมเรียก `<SalesTable sales={customer.sales ?? []} />` แทน DataTable ตรง

- [ ] **Step 5: `tabs/OverviewTab.tsx`**
```tsx
import { ChevronRight } from 'lucide-react';
import ChannelBadge from '@/components/chat/ChannelBadge';
import LineLinkInvite from '@/components/customer/LineLinkInvite';
import { Card, CardContent } from '@/components/ui/card';
import { isChatVisibleForRole } from '@/config/menu';
import { customerCreditStatusMap } from '@/lib/status-badges';
import { formatDateShort } from '@/utils/formatters';
import ActiveContractCard from '../components/ActiveContractCard';
import type { CustomerDetail } from '../types';
import { customerKind } from '../utils/customerKind';
import { SalesTable } from './SalesTab';

function SectionHead({ title, count, action }: { title: string; count?: number; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-semibold leading-snug">{title}</span>
        {count !== undefined && <span className="text-[13px] text-muted-foreground">({count})</span>}
      </div>
      {action && (
        <button type="button" onClick={action.onClick} className="inline-flex items-center gap-0.5 text-[13px] text-primary hover:underline">
          {action.label}<ChevronRight className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default function OverviewTab({ customer, role, onOpenTab }: { customer: CustomerDetail; role: string; onOpenTab: (tab: string) => void }) {
  const kind = customerKind(customer);
  const sales = customer.sales ?? [];
  const closedCount = customer.contracts.length - customer.openContracts.length;

  return (
    <div className="flex flex-col gap-5">
      {customer.openContracts.length > 0 && (
        <Card><CardContent className="p-5">
          <SectionHead title="สัญญาที่กำลังผ่อน" count={customer.openContracts.length} action={{ label: 'ดูสัญญาทั้งหมด', onClick: () => onOpenTab('contracts') }} />
          <div className="flex flex-col gap-2.5">
            {customer.openContracts.map((contract) => <ActiveContractCard key={contract.id} contract={contract} />)}
          </div>
          {closedCount > 0 && <div className="mt-2.5 text-xs leading-snug text-muted-foreground">สัญญาอื่นที่ไม่ได้ผ่อนอยู่ {closedCount} ใบ อยู่ในแท็บสัญญา</div>}
        </CardContent></Card>
      )}

      {kind === 'CASH' && <LineLinkInvite lineIdShop={customer.lineIdShop} customerName={customer.name} />}

      {sales.length > 0 && (
        <Card><CardContent className="p-5">
          <SectionHead title="ใบขายเงินสด / ไฟแนนซ์นอก" count={sales.length} action={sales.length > 3 ? { label: 'ดูทั้งหมด', onClick: () => onOpenTab('sales') } : undefined} />
          <SalesTable sales={sales} limit={3} />
        </CardContent></Card>
      )}

      {kind === 'PROSPECT' && (
        <Card><CardContent className="p-5">
          <SectionHead title="ขั้นต่อไป" />
          <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4 text-[13px] leading-snug">
            {customer.chatPlaceholder
              ? 'ยังไม่มีเบอร์ — เปิดสัญญา / ใบขาย / ใบจองได้เมื่อมีเบอร์'
              : `ยังไม่เคยซื้อกับเรา · เครดิต: ${(customerCreditStatusMap[customer.creditCheckStatus] ?? customerCreditStatusMap.NONE).label}`}
          </div>
          {customer.chatRooms.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] leading-snug text-muted-foreground">
              <span>แชท</span>
              {customer.chatRooms.map((room) => (
                <ChannelBadge key={room.roomId} channel={room.channel} variant="logo" roomId={isChatVisibleForRole(role) ? room.roomId : null} />
              ))}
              {customer.lastContactAt && <span>· ติดต่อล่าสุด {formatDateShort(customer.lastContactAt)}</span>}
            </div>
          )}
        </CardContent></Card>
      )}

      {kind !== 'PROSPECT' && customer.openContracts.length === 0 && sales.length === 0 && (
        <div className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีสัญญาหรือใบขาย</div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: `index.tsx`**
- `const DEFAULT_TAB = 'overview';` (`LEGACY_TAB_REDIRECT` ใช้ค่านี้อยู่แล้ว)
- เพิ่ม `<TabsTrigger value="overview">ภาพรวม</TabsTrigger>` เป็นตัวแรก และ `<TabsContent className="min-w-0" value="overview"><OverviewTab customer={customer} role={user?.role ?? ''} onOpenTab={handleTabChange} /></TabsContent>`

- [ ] **Step 7: ยืนยัน**
```bash
TZ=UTC npx vitest run src/pages/CustomerDetailPage
npx tsc --noEmit
npx eslint src/pages/CustomerDetailPage
```
Expected: PASS ทุกเทส · 0 error

- [ ] **Step 8: Commit**
```bash
git add apps/web/src/pages/CustomerDetailPage
git commit -m "feat(web): แท็บภาพรวมของลูกค้า พร้อมการ์ดสัญญาที่กำลังผ่อน

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: เว็บ — ชุดแท็บใหม่: ภาพรวม · สัญญา · ใบขาย · เครดิต · แต้มสะสม

> "การซื้อ" เปลี่ยนเป็น "ใบขาย" เพราะช่องตัวเลข "การซื้อ" นับรวมสัญญาผ่อนด้วย ถ้าแท็บชื่อเดียวกันแต่นับเฉพาะใบขายเงินสด/ไฟแนนซ์นอก ตัวเลขสองจุดจะขัดกันบนหน้าเดียว (ผลตรวจ mockup รอบสอง)

**Files:**
- Modify: `apps/web/src/pages/CustomerDetailPage/index.tsx`
- Test: `apps/web/src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx`

**Interfaces:**
- Consumes: `OverviewTab`, `ContractsTab`, `SalesTab`, `CreditTab`, `LoyaltyTab`
- Produces: ค่า tab ใน URL = `overview` (ไม่ใส่ใน URL) · `contracts` · `sales` · `credit` · `loyalty` · `LEGACY_TAB_REDIRECT = { info: 'overview', contact: 'overview', work: 'overview', purchases: 'sales' }` · Plan 2 เพิ่ม `journey` เป็นตัวสุดท้าย

- [ ] **Step 1: เทสแดง**
```tsx
describe('ชุดแท็บ', () => {
  it('ลำดับแท็บ + แท็บที่ไม่มีข้อมูลโชว์จางแต่ยังกดได้', async () => {
    mocks.detail = detail({ contracts: [], sales: [] });
    renderAt('/customers/c1');
    await screen.findByRole('heading', { level: 1, name: 'สมชาย ใจดี' });
    const names = screen.getAllByRole('tab').map((tab) => tab.textContent?.replace(/\s+/g, ' ').trim());
    expect(names).toEqual(['ภาพรวม', 'สัญญา (0)', 'ใบขาย (0)', 'เครดิต (0)', expect.stringMatching(/^แต้มสะสม/)]);
    const salesTab = screen.getByRole('tab', { name: /ใบขาย/ });
    expect(salesTab).toHaveAttribute('data-empty', 'true');
    fireEvent.mouseDown(salesTab);
    fireEvent.click(salesTab);
    expect(await screen.findByText('ยังไม่มีการซื้อแบบเงินสด/ไฟแนนซ์นอก')).toBeInTheDocument();
  });

  it('ลิงก์เก่า ?tab=purchases เปิดแท็บใบขาย', async () => {
    mocks.detail = detail({ sales: [] });
    renderAt('/customers/c1?tab=purchases');
    expect(await screen.findByText('ยังไม่มีการซื้อแบบเงินสด/ไฟแนนซ์นอก')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /ใบขาย/ })).toHaveAttribute('data-state', 'active');
  });
});
```
Run: `TZ=UTC npx vitest run src/pages/CustomerDetailPage/__tests__/CustomerDetailPage.test.tsx` → Expected: FAIL (ยังไม่มีแท็บ `ใบขาย`)

- [ ] **Step 2: `index.tsx`**

`LEGACY_TAB_REDIRECT` เพิ่ม `purchases: 'sales'` · แทน `TabsList` ทั้งก้อนด้วย:
```tsx
const tabs = [
  { value: 'overview', label: 'ภาพรวม', count: null as number | null },
  { value: 'contracts', label: 'สัญญา', count: customer.contracts.length },
  { value: 'sales', label: 'ใบขาย', count: (customer.sales ?? []).length },
  { value: 'credit', label: 'เครดิต', count: creditChecks.length },
];
```
```tsx
<TabsList variant="line" className="min-w-max">
  {tabs.map((tab) => (
    <TabsTrigger
      key={tab.value}
      value={tab.value}
      data-empty={tab.count === 0 ? 'true' : undefined}
      className="data-[empty=true]:text-muted-foreground/55"
    >
      {tab.label}{tab.count !== null && ` (${tab.count})`}
    </TabsTrigger>
  ))}
  <TabsTrigger value="loyalty" data-empty={!loyaltyPoints?.balance ? 'true' : undefined} className="data-[empty=true]:text-muted-foreground/55">
    แต้มสะสม
    {!!loyaltyPoints?.balance && (
      <span className="ml-1.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-2xs font-bold text-primary">{loyaltyPoints.balance.toLocaleString()}</span>
    )}
  </TabsTrigger>
</TabsList>
```
เปลี่ยน `<TabsContent value="purchases">` เป็น `value="sales"`

- [ ] **Step 3: ยืนยัน**
```bash
TZ=UTC npx vitest run src/pages/CustomerDetailPage
npx tsc --noEmit
npx eslint src/pages/CustomerDetailPage
grep -rn "tab=purchases\|tab=info\|tab=contact\|tab=work" src --include='*.tsx' --include='*.ts'
```
Expected: PASS ทุกเทส · 0 error · grep: ลิงก์ในแอปที่ยังส่ง tab ชื่อเก่า ให้เปลี่ยนเป็นชื่อใหม่ในไฟล์นั้น (redirect ยังรองรับของเก่า แต่ลิงก์ในโค้ดต้องเป็นชื่อใหม่) — ถ้าไม่มี ไม่ต้องทำอะไร

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/pages/CustomerDetailPage
git commit -m "feat(web): แท็บลูกค้าชุดใหม่ ภาพรวม สัญญา ใบขาย เครดิต แต้มสะสม

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: ตรวจรวม · วัดหน้าจอจริง 3 ประเภทลูกค้า · bump version

**Files:**
- Modify: `apps/web/package.json` (`version`)
- Create (นอก repo): สคริปต์วัดและภาพหน้าจอเก็บใน scratchpad ของ session เท่านั้น ห้าม commit

**Interfaces:**
- Consumes: ทุก task ก่อนหน้า
- Produces: branch พร้อมเปิด PR (ไม่ push ใน task นี้)

- [ ] **Step 1: ด่านทดสอบทั้งหมด**

จาก `apps/api` (env ตาม Global Constraints):
```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/customers src/modules/chat-prospects --runInBand
npx eslint src/modules/customers
```
จาก `apps/web`:
```bash
npx tsc --noEmit
TZ=UTC npx vitest run
npx eslint src/pages/CustomerDetailPage
```
Expected: tsc 0 error ทั้งสองฝั่ง · jest ทุก suite PASS · vitest ทั้งชุด PASS (baseline ก่อนเริ่มงาน: เฉพาะชุดลูกค้า/ติดตามหนี้ 13 ไฟล์ 131 เทสผ่าน) · ถ้ามีเทสแดงนอกไฟล์ที่แตะ ให้เทียบกับ `git stash`-free baseline โดยรันเทสนั้นบน commit `f76582a52` ใน worktree ชั่วคราว (`git worktree add /tmp/<ชื่อ> f76582a52`) ก่อนสรุปว่าเป็นของเดิม

- [ ] **Step 2: วัดหน้าจอจริง**

1. ดูว่ามีสคริปต์พรีวิวในเครื่องไหม: `grep -n '"local:preview"' package.json` (root ของ worktree)
2. ถ้ามี: `LOCAL_PREVIEW_PORT=5207 npm run local:preview` แบบ background จด PID ที่ได้ · ถ้าไม่มี: ข้าม Step 2 ทั้งหมดและเขียนในรายงานว่า "ไม่ได้วัดหน้าจอจริง เพราะไม่มีสคริปต์พรีวิว" — ห้ามแก้ `vite.config.ts` ห้ามใช้พอร์ต 3000/5173/5199 (ของ OBI และเจ้าของ)
3. หา id ลูกค้า 3 ประเภทจากฐานพรีวิว (ผ่อนที่มีงวดค้าง · เงินสด · ผู้สนใจจากแชท) ผ่าน `GET /api/admin/customers?view=customers&purchase=INSTALLMENT` / `purchase=CASH` / `view=prospects` บนพอร์ตพรีวิว
4. สคริปต์ Playwright (ใช้ `node_modules/playwright` ของ repo) เปิด `/customers/<id>` ที่ viewport 1440×900 และ 1280×900 · **reload หนึ่งครั้งก่อนวัด** (เมนูโซนขึ้นช้าในโหลดแรก) · วัดว่า `document.documentElement.scrollWidth <= clientWidth` และทุก element ใน `[data-testid^="active-contract-"]`, ช่องตัวเลข และหัวหน้าที่มี `text-overflow: ellipsis` ไม่มี `scrollWidth > clientWidth + 1` · บันทึกภาพไว้ใน scratchpad
5. หยุดพรีวิวด้วย `kill <PID ที่จดไว้>` เท่านั้น — 🚨 ห้าม pkill ตามพอร์ต/ชื่อ

Expected: ไม่มีแถบเลื่อนแนวนอน · ไม่มีข้อความโดนตัด · ถ้าเจอข้อความโดนตัด แก้ความกว้าง/ย่อข้อความในคอมโพเนนต์นั้น แล้วรัน Step 1 ซ้ำ

- [ ] **Step 3: bump version**

`apps/web/package.json`: `"version": "26.9.26"` → `"26.9.27"` (ถ้า `origin/main` ขยับเลขไปแล้ว ให้ใช้เลขถัดจากค่าบน `origin/main` ณ ตอนนั้น — ดูด้วย `git show origin/main:apps/web/package.json | grep '"version"'`)

- [ ] **Step 4: Commit**
```bash
git add apps/web/package.json
git commit -m "chore(web): bump version 26.9.27

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

</content>
</invoke>
