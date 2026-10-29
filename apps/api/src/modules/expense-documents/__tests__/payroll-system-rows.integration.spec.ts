import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  Prisma,
  PrismaClient,
  type AttendanceDayKind,
  type CommissionStatus,
  type DocumentStatus,
  type EmploymentType,
  type PayoutStatus,
  type PayrollCommissionItemKind,
} from '@prisma/client';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { AuditService } from '../../audit/audit.service';
import { AccountRoleService } from '../../journal/account-role.service';
import { AttendanceSettingsService } from '../../attendance/attendance-settings.service';
import { dbDate } from '../../attendance/attendance-rules';
import { bangkokMidnight } from '../../../utils/date.util';
import { PayrollSystemRowsService } from '../payroll-system/payroll-system-rows.service';
import { resolveRoleCodes } from '../payroll-system/role-codes';
import type { SystemRowsQuery } from '../payroll-system/payroll-system.types';

/**
 * Payroll D4 ส่วนที่ 1 · Task 3 — `PayrollSystemRowsService.compute` บน Postgres จริง (migrations อย่างเดียว ไม่มี seed)
 * แถว OT / ทำงานวันหยุด / OT วันหยุด จากตารางลงเวลา · รวมทุกสาขาตาม userId · กติกาเวลางานรายสาขา ·
 * ใบอื่นถือแถวลงเวลาแล้ว · ไม่เข้าเกณฑ์ · วันที่ต้องตรวจ · ก่อนเวลาปิดงวด · role → บัญชีอ่านจาก DB ไม่ผ่าน cache
 * ส่วนที่ 2 · Task 3 — ค่าคอม (PAY) + หักคืนค่าคอม (CLAWBACK) ทุกบรรทัด SHOP ที่ผูกพนักงาน ไม่ขึ้นกับเกณฑ์ OT / ใบอื่น / รหัสตอกบัตร
 * (ข้อ (d)–(q) ของแผน + กรณีของคำตัดสิน P2-R6/R17) · ดัชนี partial unique ของรายการ PAY ที่ยังมีผล (Task 1)
 * รัน: bash tools/test-db-vitest.sh src/modules/expense-documents/__tests__/payroll-system-rows.integration.spec.ts
 */

const prisma = new PrismaClient();
const audit = new AuditService(prisma as never);
const roles = new AccountRoleService(prisma as never, audit);
const settings = new AttendanceSettingsService(prisma as never);
const service = new PayrollSystemRowsService(settings);

const stamp = Date.now();
const PERIOD = '2026-10';
const AFTER_CUTOFF = new Date('2026-11-02T03:00:00.000Z');
const CUTOFF_ISO = '2026-11-01T11:00:00.000Z'; // 18:00 เวลาไทย วันที่ 1 พ.ย.
const RATES = { ot: '93.7500', holiday: '62.5000', holidayOt: '187.5000' }; // เงินเดือน 15,000 ÷ 240 × เท่า

const userIds: string[] = [];
const docIds: string[] = [];
const commissionIds: string[] = [];
const payoutIds: string[] = [];
// Task 6 carry (Task 3) — fixture ที่ผูกสัญญา/ใบขายจริง ให้ reference ไม่ตกไปที่ id
const saleIds: string[] = [];
const contractIds: string[] = [];
const productIds: string[] = [];
const customerIds: string[] = [];
let ownerId: string;
let branch1: { id: string; name: string };
let branch2: { id: string; name: string };

const bkkDay = (d: number, month0 = 9) => bangkokMidnight(2026, month0, d);
const at = (d: number, hhmm: string, month0 = 9) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(bkkDay(d, month0).getTime() + (h * 60 + m) * 60_000);
};

async function mkUser(tag: string, opts: { pin?: boolean; profile?: { employmentType: EmploymentType; baseSalary: number | null } | null } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `prs-${tag}-${stamp}@test.local`,
      password: 'x',
      name: `พนักงาน ${tag}`,
      role: 'SALES',
      isActive: true,
      branchId: branch1.id,
      attendancePinHash: opts.pin === false ? null : `pin-${tag}-${stamp}`,
    },
  });
  userIds.push(user.id);
  const profile = opts.profile === undefined ? { employmentType: 'MONTHLY' as const, baseSalary: 15000 } : opts.profile;
  if (profile) await prisma.employeeProfile.create({ data: { userId: user.id, employmentType: profile.employmentType, baseSalary: profile.baseSalary } });
  return user.id;
}

async function mkDay(
  userId: string,
  branchId: string,
  d: number,
  o: { kind?: AttendanceDayKind; in?: string; out?: string; ot?: number; late?: number; flags?: string[]; month0?: number; deleted?: boolean } = {},
) {
  const month0 = o.month0 ?? 9;
  return prisma.attendanceDay.create({
    data: {
      userId,
      branchId,
      workDate: dbDate(bkkDay(d, month0)),
      dayKind: o.kind ?? 'WORK',
      clockIn: o.in ? at(d, o.in, month0) : null,
      clockOut: o.out ? at(d, o.out, month0) : null,
      otHours: o.ot ?? 0,
      lateMinutes: o.late ?? 0,
      flags: o.flags ?? [],
      deletedAt: o.deleted ? new Date() : null,
    },
  });
}

const query = (ids: string[], extra: Partial<SystemRowsQuery> = {}): SystemRowsQuery => ({
  branchId: branch1.id,
  entityScope: 'SHOP',
  payrollPeriod: PERIOD,
  userIds: ids,
  now: AFTER_CUTOFF,
  ...extra,
});
const computeOne = async (userId: string, extra: Partial<SystemRowsQuery> = {}) => {
  const res = await service.compute(prisma as never, query([userId], extra));
  expect(res.rows).toHaveLength(1);
  return res.rows[0];
};
const otRow = (hours: string, amount: string, accountCode = 'S52-1202') => ({
  source: 'ATTENDANCE_OT', accountCode, name: 'OT วันทำงาน (1.5 เท่า)', quantity: hours, rate: RATES.ot, multiplier: '1.5', amount, isTaxable: true,
});
const holidayRow = (hours: string, amount: string, accountCode = 'S52-1202') => ({
  source: 'ATTENDANCE_HOLIDAY', accountCode, name: 'ทำงานวันหยุด (1 เท่า)', quantity: hours, rate: RATES.holiday, multiplier: '1.0', amount, isTaxable: true,
});
const holidayOtRow = (hours: string, amount: string, accountCode = 'S52-1202') => ({
  source: 'ATTENDANCE_HOLIDAY_OT', accountCode, name: 'OT วันหยุด (3 เท่า)', quantity: hours, rate: RATES.holidayOt, multiplier: '3.0', amount, isTaxable: true,
});

async function mkPayrollDoc(tag: string, userId: string, o: { branchId: string; period?: string; source?: 'ATTENDANCE_OT' | 'MANUAL' }) {
  const doc = await prisma.expenseDocument.create({
    data: {
      number: `PR-PRS-${tag}-${stamp}`,
      documentType: 'PAYROLL',
      branchId: o.branchId,
      documentDate: new Date('2026-10-31T00:00:00.000Z'),
      subtotal: 15000,
      totalAmount: 15140.63,
      netPayment: 15140.63,
      status: 'DRAFT',
      createdById: ownerId,
      payroll: {
        create: {
          payrollPeriod: o.period ?? PERIOD,
          entityScope: 'SHOP',
          lines: {
            create: [
              {
                userId,
                employeeName: `พนักงาน ${tag}`,
                baseSalary: 15000,
                netPaid: 15140.63,
                customIncome: {
                  create: [
                    o.source === 'MANUAL'
                      ? { accountCode: 'S52-1204', name: 'โบนัส', amount: 140.63, source: 'MANUAL' }
                      : { accountCode: 'S52-1202', name: 'OT วันทำงาน (1.5 เท่า)', amount: 140.63, source: 'ATTENDANCE_OT', quantity: 1.5, rate: 93.75, multiplier: 1.5 },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  });
  docIds.push(doc.id);
  return doc;
}

// ── ส่วนที่ 2 · ค่าคอม ─────────────────────────────────────────────────────────────────────────────
const COMMISSION_CODE = 'S51-1101'; // shop_payroll_commission (migration 20261107000000_payroll_commission)
const D = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(v);
const iso = (s: string) => new Date(`${s}T05:00:00.000Z`);

/** พนักงานขายรายเดือน ตอกบัตรหนึ่งวันไม่มี OT ⇒ ไม่มีคำเตือนฝั่งลงเวลา — คำเตือนที่เห็นมาจากค่าคอมล้วน */
async function mkSeller(tag: string) {
  const u = await mkUser(tag);
  await mkDay(u, branch1.id, 1, { in: '10:00', out: '19:00' });
  return u;
}

interface CommissionOpts {
  id?: string;
  period?: string;
  status?: CommissionStatus;
  amount?: number | string;
  createdAt?: Date;
  deletedAt?: Date;
  paidAt?: Date;
  paidAmount?: number;
  clawbackAmount?: number;
  clawbackPercent?: number;
  clawbackAt?: Date;
  clawbackReason?: string;
}

/** ไม่ผูก contract/sale ⇒ อ้างอิงของรายการ = id ของค่าคอม (P2-R21 ตัวสุดท้ายของลำดับ) */
async function mkCommission(salespersonId: string, o: CommissionOpts = {}) {
  const c = await prisma.salesCommission.create({
    data: {
      ...(o.id ? { id: o.id } : {}),
      salespersonId,
      snapshotSalespersonId: salespersonId,
      period: o.period ?? PERIOD,
      saleAmount: 20000,
      commissionRate: 0.05,
      commissionAmount: o.amount ?? 1000,
      status: o.status ?? 'APPROVED',
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
      deletedAt: o.deletedAt ?? null,
      paidAt: o.paidAt ?? null,
      paidAmount: o.paidAmount ?? null,
      clawbackAmount: o.clawbackAmount ?? null,
      clawbackPercent: o.clawbackPercent ?? null,
      clawbackAt: o.clawbackAt ?? null,
      clawbackReason: o.clawbackReason ?? null,
    },
  });
  commissionIds.push(c.id);
  return c;
}

/** ใบขาย / สัญญาจริง (ฟิลด์บังคับเท่านั้น) ให้ค่าคอมผูก — reference ของรายการอ่านจากสองตารางนี้ (P2-R21) */
async function mkSaleAndContract(tag: string, salespersonId: string) {
  const customer = await prisma.customer.create({ data: { name: `ลูกค้า PRS-${tag} ${stamp}` } });
  customerIds.push(customer.id);
  const product = (n: number) =>
    prisma.product.create({
      data: { name: `เครื่อง PRS-${tag}-${n}`, brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: 20000, branchId: branch1.id },
    });
  const [p1, p2] = await Promise.all([product(1), product(2)]);
  productIds.push(p1.id, p2.id);
  const sale = await prisma.sale.create({
    data: {
      saleNumber: `SL-PRS-${tag}-${stamp}`, saleType: 'CASH', customerId: customer.id, productId: p1.id,
      branchId: branch1.id, salespersonId, sellingPrice: 24000, netAmount: 24000,
    },
  });
  saleIds.push(sale.id);
  const contract = await prisma.contract.create({
    data: {
      contractNumber: `CT-PRS-${tag}-${stamp}`, customerId: customer.id, productId: p2.id, branchId: branch1.id,
      salespersonId, planType: 'STORE_WITH_INTEREST', sellingPrice: 24000, downPayment: 4000, interestRate: 0.08,
      totalMonths: 10, interestTotal: 1600, financedAmount: 20000, monthlyPayment: 2160,
    },
  });
  contractIds.push(contract.id);
  return { sale, contract };
}

/** ค่าคอมที่จ่ายแล้ว (paidAt) แล้วถูกเรียกคืน — สถานะที่ helper ของ Task 2 ทิ้งไว้: clawbackAmount = paidAmount × % */
async function mkPaidClawback(userId: string, o: { paid: number; clawback: number; at: Date; id?: string; period?: string }) {
  return mkCommission(userId, {
    id: o.id,
    period: o.period ?? '2026-08',
    amount: o.paid,
    status: o.clawback === o.paid ? 'CLAWED_BACK' : 'PARTIALLY_CLAWED_BACK',
    paidAt: new Date('2026-09-01T03:00:00.000Z'),
    paidAmount: o.paid,
    clawbackAmount: o.clawback,
    clawbackPercent: Math.round((o.clawback / o.paid) * 100),
    clawbackAt: o.at,
    clawbackReason: `ยกเลิกใบขาย ทดสอบ ${o.clawback}`,
  });
}

interface ItemSpec {
  commissionId: string;
  kind: PayrollCommissionItemKind;
  amount: number | string;
  accountCode?: string;
  released?: boolean;
}

/** ใบเงินเดือนหนึ่งบรรทัดที่ถือรายการค่าคอม · ไม่มีแถว ATTENDANCE_* ⇒ ไม่เข้ากติกา "ใบอื่นถือ OT" ของส่วนที่ 1 */
async function mkCommissionDoc(tag: string, userId: string, o: { status: DocumentStatus; branchId?: string; period?: string; items: ItemSpec[] }) {
  const pay = o.items.filter((i) => i.kind === 'PAY').reduce((s, i) => s.plus(i.amount), D(0));
  const doc = await prisma.expenseDocument.create({
    data: {
      number: `PR-PRS-${tag}-${stamp}`,
      documentType: 'PAYROLL',
      branchId: o.branchId ?? branch1.id,
      documentDate: new Date('2026-10-31T00:00:00.000Z'),
      subtotal: 15000,
      totalAmount: D(15000).plus(pay),
      netPayment: D(15000).plus(pay),
      status: o.status,
      createdById: ownerId,
      payroll: {
        create: {
          payrollPeriod: o.period ?? PERIOD,
          entityScope: 'SHOP',
          lines: {
            create: [
              {
                userId,
                employeeName: `พนักงาน ${tag}`,
                baseSalary: 15000,
                netPaid: D(15000).plus(pay),
                ...(pay.gt(0) ? { customIncome: { create: [{ accountCode: COMMISSION_CODE, name: 'ค่าคอมมิชชัน', amount: pay, source: 'COMMISSION' as const }] } } : {}),
                commissionItems: {
                  create: o.items.map((i) => ({
                    salesCommissionId: i.commissionId,
                    kind: i.kind,
                    accountCode: i.accountCode ?? COMMISSION_CODE,
                    amount: i.amount,
                    releasedAt: i.released ? new Date() : null,
                  })),
                },
              },
            ],
          },
        },
      },
    },
    include: { payroll: { include: { lines: { select: { id: true } } } } },
  });
  docIds.push(doc.id);
  return { id: doc.id, number: doc.number, lineId: doc.payroll!.lines[0].id };
}

async function mkPayout(salespersonId: string, period: string, status: PayoutStatus, generatedAt: Date | null, deleted = false) {
  const p = await prisma.commissionPayout.create({
    data: { salespersonId, period, totalSales: 20000, totalCommission: 100, commissionCount: 1, status, generatedAt, deletedAt: deleted ? new Date() : null },
  });
  payoutIds.push(p.id);
  return p;
}

const commissionRow = (n: number, amount: string, accountCode = COMMISSION_CODE) => ({
  source: 'COMMISSION', accountCode, name: `ค่าคอมมิชชัน (${n} รายการ)`, quantity: null, rate: null, multiplier: null, amount, isTaxable: true,
});
const clawbackRow = (n: number, amount: string, accountCode = COMMISSION_CODE) => ({
  source: 'COMMISSION_CLAWBACK', accountCode, name: `หักคืนค่าคอม (${n} รายการ)`, amount,
});
const payItem = (c: { id: string; createdAt: Date }, amount: string, accountCode = COMMISSION_CODE) => ({
  salesCommissionId: c.id, kind: 'PAY', accountCode, amount, reference: c.id, date: c.createdAt.toISOString(), reason: null, carriedForward: null,
});
const clawItem = (
  c: { id: string; clawbackAt: Date | null; clawbackReason: string | null },
  amount: string,
  carriedForward: string | null = null,
  accountCode = COMMISSION_CODE,
) => ({
  salesCommissionId: c.id, kind: 'CLAWBACK', accountCode, amount, reference: c.id, date: c.clawbackAt!.toISOString(), reason: c.clawbackReason, carriedForward,
});

beforeAll(async () => {
  await seedFinanceCoa(prisma);
  await seedShopCoa(prisma);
  await roles.onModuleInit();
  ownerId = (await prisma.user.create({ data: { email: `prs-owner-${stamp}@test.local`, password: 'x', name: 'เจ้าของ PRS', role: 'OWNER', isActive: true } })).id;
  userIds.push(ownerId);
  // ตั้งเวลางานรายสาขาไว้ชัด ⇒ ไม่ขึ้นกับ SystemConfig ที่ spec อื่นในชุด CI อาจตั้งไว้
  branch1 = await prisma.branch.create({ data: { name: `สาขา PRS-1 ${stamp}`, workStart: '10:00', workEnd: '19:00' }, select: { id: true, name: true } });
  branch2 = await prisma.branch.create({ data: { name: `สาขา PRS-2 ${stamp}`, workStart: '10:00', workEnd: '20:00' }, select: { id: true, name: true } });
}, 120_000);

afterAll(async () => {
  // ลำดับบังคับ (P2-R17): ใบก่อน (cascade → payroll_details → lines → income + payroll_commission_items ซึ่ง RESTRICT ค่าคอม)
  // → ค่าคอม → รอบจ่ายเดิม (ทั้งสองอ้าง users) → แถวส่วนที่ 1
  if (docIds.length > 0) await prisma.expenseDocument.deleteMany({ where: { id: { in: docIds } } });
  if (commissionIds.length > 0) await prisma.salesCommission.deleteMany({ where: { id: { in: commissionIds } } });
  if (payoutIds.length > 0) await prisma.commissionPayout.deleteMany({ where: { id: { in: payoutIds } } });
  // ค่าคอมอ้างใบขาย/สัญญา → ลบหลังค่าคอม · ใบขาย/สัญญาอ้างสินค้า + ลูกค้า + ผู้ใช้ → ลบก่อนแถวเหล่านั้น
  if (saleIds.length > 0) await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
  if (contractIds.length > 0) await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
  if (productIds.length > 0) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  if (customerIds.length > 0) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.attendanceDay.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { id: { in: [branch1?.id, branch2?.id].filter(Boolean) } } });
  await prisma.$disconnect();
}, 120_000);

describe('PayrollSystemRowsService.compute (Postgres)', () => {
  it('(a) salary 15,000: weekday OT 6.5 h rounded once = 609.38 · DAY_OFF 10:00–21:00 = holiday 8 h 500.00 + holiday OT 2 h 375.00 · period bounds and soft-deleted days respected · summary snapshot', async () => {
    const u = await mkUser('a');
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, branch1.id, 2, { in: '10:20', out: '20:30', ot: 1.5, late: 20 });
    await mkDay(u, branch1.id, 3); // WORK ไม่มีตอก = ขาด
    await mkDay(u, branch1.id, 4, { kind: 'DAY_OFF', in: '10:00', out: '21:00', ot: 0 }); // OT วันหยุดคิดใหม่จากกติกา ไม่ใช้ค่าที่เก็บ
    await mkDay(u, branch1.id, 5, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, branch1.id, 6, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, branch1.id, 7, { in: '10:00', out: '19:30', ot: 0.5 });
    await mkDay(u, branch1.id, 8, { kind: 'LEAVE_SICK' });
    await mkDay(u, branch1.id, 9, { in: '10:00', out: '22:00', ot: 3, deleted: true });
    await mkDay(u, branch1.id, 30, { in: '10:00', out: '22:00', ot: 3, month0: 8 }); // 30 ก.ย. — นอกงวด
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '22:00', ot: 3, month0: 10 }); // 1 พ.ย. — นอกงวด

    const res = await service.compute(prisma as never, query([u]));
    expect(res.attendanceAccountCodes).toEqual(['S52-1202']);
    expect(res.commissionAccountCodes).toEqual([COMMISSION_CODE]);
    expect(res.rows).toEqual([
      {
        userId: u,
        autoOtEligible: true,
        attendanceTracked: true,
        systemIncome: [otRow('6.5', '609.38'), holidayRow('8.0', '500.00'), holidayOtRow('2.0', '375.00')],
        systemDeductions: [],
        commissionItems: [],
        attendanceSummary: {
          workDays: 6,
          lateCount: 1,
          lateMinutes: 20,
          absent: 1,
          leave: 1,
          otHours: '6.5',
          holidayHours: '8.0',
          holidayOtHours: '2.0',
          holidayWorkedDays: 1,
          reviewCount: 0,
          autoOtEligible: true,
          attendanceTracked: true,
        },
        notes: { review: [], warnings: [] },
      },
    ]);
  });

  it('(R4) holiday hours use the Bangkok work window: DAY_OFF 10:00–21:00 → holiday 8 h, OT 2 h (the raw UTC DATE would give 4 h / 0 h)', async () => {
    const u = await mkUser('r4');
    await mkDay(u, branch1.id, 18, { kind: 'DAY_OFF', in: '10:00', out: '21:00', ot: 2 });
    const row = await computeOne(u);
    expect(row.attendanceSummary).toMatchObject({ holidayHours: '8.0', holidayOtHours: '2.0', holidayWorkedDays: 1 });
    expect(row.systemIncome).toEqual([holidayRow('8.0', '500.00'), holidayOtRow('2.0', '375.00')]);
  });

  it('(b) days at two branches all count (LEAVE_* with a punch = weekday OT; SHOP_CLOSED = holiday) and each holiday uses its own branch rules; batched users keep request order', async () => {
    const u = await mkUser('b');
    const other = await mkUser('b-other');
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, branch2.id, 2, { in: '10:00', out: '21:00', ot: 1 });
    await mkDay(u, branch2.id, 3, { kind: 'LEAVE_PERSONAL', in: '10:00', out: '20:30', ot: 0.5 });
    await mkDay(u, branch2.id, 4, { kind: 'DAY_OFF', in: '10:00', out: '21:00' }); // สาขา 2 เลิก 20:00 → 9 ชม. ชนเพดาน 8 · OT 1
    await mkDay(u, branch1.id, 11, { kind: 'SHOP_CLOSED', in: '13:00', out: '21:00' }); // สาขา 1 เลิก 19:00 → 6 − พัก 1 = 5 · OT 2
    await mkDay(other, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });

    const res = await service.compute(prisma as never, query([u, other, u], { branchId: branch2.id }));
    expect(res.rows.map((r) => r.userId)).toEqual([u, other]);
    expect(res.rows[0].systemIncome).toEqual([otRow('3.0', '281.25'), holidayRow('13.0', '812.50'), holidayOtRow('3.0', '562.50')]);
    expect(res.rows[0].attendanceSummary).toMatchObject({ workDays: 5, otHours: '3.0', holidayHours: '13.0', holidayOtHours: '3.0', holidayWorkedDays: 2 });
    expect(res.rows[1].systemIncome).toEqual([otRow('1.5', '140.63')]);
  });

  it('(c) DAILY employee → no attendance rows + NOT_MONTHLY_OR_NO_BASE with weekday + holiday OT hours', async () => {
    const u = await mkUser('c', { profile: { employmentType: 'DAILY', baseSalary: 15000 } });
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, branch1.id, 4, { kind: 'DAY_OFF', in: '10:00', out: '21:00' });
    const row = await computeOne(u);
    expect(row.autoOtEligible).toBe(false);
    expect(row.systemIncome).toEqual([]);
    expect(row.notes.warnings).toEqual([{ code: 'NOT_MONTHLY_OR_NO_BASE', otHours: '3.5' }]);
    expect(row.attendanceSummary).toMatchObject({ otHours: '1.5', holidayHours: '8.0', holidayOtHours: '2.0', autoOtEligible: false });
  });

  it('(R5) ineligible with no OT and no holiday work → no NOT_MONTHLY_OR_NO_BASE; holiday work alone still warns (payload = weekday + holiday OT)', async () => {
    const plain = await mkUser('r5-plain', { profile: { employmentType: 'DAILY', baseSalary: 15000 } });
    const noRows = await mkUser('r5-norows', { profile: { employmentType: 'CONTRACT', baseSalary: 15000 } });
    const holidayOnly = await mkUser('r5-holiday', { profile: { employmentType: 'DAILY', baseSalary: 15000 } });
    await mkDay(plain, branch1.id, 1, { in: '10:00', out: '19:00' });
    await mkDay(plain, branch1.id, 2, { in: '10:00', out: '19:10' }); // ไม่ถึง 15 นาที = ไม่มี OT
    await mkDay(holidayOnly, branch1.id, 4, { kind: 'DAY_OFF', in: '10:00', out: '17:00' }); // ทำงานวันหยุด 6 ชม. · OT 0
    const res = await service.compute(prisma as never, query([plain, noRows, holidayOnly]));
    expect(res.rows[0].notes.warnings).toEqual([]);
    expect(res.rows[1].notes.warnings).toEqual([]);
    expect(res.rows[2].notes.warnings).toEqual([{ code: 'NOT_MONTHLY_OR_NO_BASE', otHours: '0.0' }]);
    expect(res.rows[2].attendanceSummary).toMatchObject({ holidayHours: '6.0', holidayOtHours: '0.0', autoOtEligible: false });
    for (const row of res.rows) expect(row.systemIncome).toEqual([]);
  });

  it('(l) registry salary 0, null, or no profile → NOT_MONTHLY_OR_NO_BASE', async () => {
    const zero = await mkUser('l-zero', { profile: { employmentType: 'MONTHLY', baseSalary: 0 } });
    const none = await mkUser('l-null', { profile: { employmentType: 'MONTHLY', baseSalary: null } });
    const noProfile = await mkUser('l-noprofile', { profile: null });
    for (const u of [zero, none, noProfile]) await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    const res = await service.compute(prisma as never, query([zero, none, noProfile]));
    for (const row of res.rows) {
      expect(row.autoOtEligible).toBe(false);
      expect(row.systemIncome).toEqual([]);
      expect(row.notes.warnings).toEqual([{ code: 'NOT_MONTHLY_OR_NO_BASE', otHours: '1.5' }]);
    }
  });

  it('(h) review lists days with review flags (only those flags); DEVICE_CONFLICT is blocking; rows are still computed', async () => {
    const u = await mkUser('h');
    const conflict = await mkDay(u, branch1.id, 3, { in: '10:00', out: '20:30', ot: 1.5, flags: ['NO_PHOTO', 'DEVICE_CONFLICT'] });
    const corrected = await mkDay(u, branch2.id, 8, { kind: 'DAY_OFF', in: '10:00', out: '18:00', flags: ['WORKED_ON_OFF_DAY', 'CORRECTED'] });
    await mkDay(u, branch1.id, 9, { in: '10:00', out: '19:00', flags: ['NO_PHOTO', 'OUT_UPDATED'] });
    const missingOut = await mkDay(u, branch1.id, 10, { in: '10:00', flags: ['MISSING_OUT', 'NETWORK_CHANGED'] });
    const row = await computeOne(u);
    expect(row.notes.review).toEqual([
      { dayId: conflict.id, date: '2026-10-03', branchId: branch1.id, flags: ['DEVICE_CONFLICT'], blocking: true },
      { dayId: corrected.id, date: '2026-10-08', branchId: branch2.id, flags: ['CORRECTED'], blocking: false },
      { dayId: missingOut.id, date: '2026-10-10', branchId: branch1.id, flags: ['MISSING_OUT', 'NETWORK_CHANGED'], blocking: false },
    ]);
    expect(row.attendanceSummary.reviewCount).toBe(3);
    expect(row.systemIncome.map((r) => r.source)).toEqual(['ATTENDANCE_OT', 'ATTENDANCE_HOLIDAY']);
  });

  it('(i) before the cutoff → NOT_YET_CLOSABLE with closableAt; from the cutoff on → no warning', async () => {
    const u = await mkUser('i');
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    const before = await computeOne(u, { now: new Date('2026-11-01T10:59:59.999Z') });
    expect(before.notes.warnings).toEqual([{ code: 'NOT_YET_CLOSABLE', closableAt: CUTOFF_ISO }]);
    expect(before.systemIncome).toEqual([otRow('1.5', '140.63')]);
    const atCutoff = await computeOne(u, { now: new Date(CUTOFF_ISO) });
    expect(atCutoff.notes.warnings).toEqual([]);
  });

  it('NO_PIN only when the user has no PIN and no attendance rows in the period · R20: NO_ATTENDANCE for an auto-OT user with a PIN and no rows · attendanceTracked = has rows', async () => {
    const noPinNoRows = await mkUser('pin-none', { pin: false });
    const noPinWithRows = await mkUser('pin-rows', { pin: false });
    await mkDay(noPinWithRows, branch1.id, 1, { in: '10:00', out: '19:00' });
    const pinNoRows = await mkUser('pin-no-device');
    const dailyPinNoRows = await mkUser('pin-daily', { profile: { employmentType: 'DAILY', baseSalary: null } });
    const deletedOnly = await mkUser('pin-deleted-day');
    await mkDay(deletedOnly, branch1.id, 2, { in: '10:00', out: '20:30', ot: 1.5, deleted: true });
    const res = await service.compute(prisma as never, query([noPinNoRows, noPinWithRows, pinNoRows, dailyPinNoRows, deletedOnly]));
    expect(res.rows.map((r) => [r.notes.warnings, r.attendanceTracked, r.attendanceSummary.attendanceTracked, r.autoOtEligible])).toEqual([
      [[{ code: 'NO_PIN' }], false, false, true],
      [[], true, true, true],
      [[{ code: 'NO_ATTENDANCE' }], false, false, true],
      [[], false, false, false], // รายวัน: ระบบไม่คิด OT ให้อยู่แล้ว ไม่มีชั่วโมงให้เตือน
      [[{ code: 'NO_ATTENDANCE' }], false, false, true], // แถวที่ถูกลบไม่นับ (ชุดวันเดียวกับที่ใช้คิดชั่วโมง)
    ]);
    expect(res.rows[0].systemIncome).toEqual([]);
    expect(res.rows[2].systemIncome).toEqual([]);
  });

  it('(k) document A (branch 1) holds U attendance rows → compute for branch 2 gets none + IN_OTHER_DOCUMENT; excluded / VOIDED / soft-deleted A, a MANUAL-only document and another period do not block', async () => {
    const u = await mkUser('k');
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    const docA = await mkPayrollDoc('k-A', u, { branchId: branch1.id });
    await mkPayrollDoc('k-manual', u, { branchId: branch2.id, source: 'MANUAL' });
    await mkPayrollDoc('k-sep', u, { branchId: branch1.id, period: '2026-09' });

    const blocked = await computeOne(u, { branchId: branch2.id });
    expect(blocked.systemIncome).toEqual([]);
    expect(blocked.notes.warnings).toEqual([
      { code: 'IN_OTHER_DOCUMENT', documentId: docA.id, documentNumber: docA.number, branchName: branch1.name, status: 'DRAFT' },
    ]);
    expect(blocked.attendanceSummary.otHours).toBe('1.5');

    const self = await computeOne(u, { excludeDocumentId: docA.id });
    expect(self.systemIncome).toEqual([otRow('1.5', '140.63')]);
    expect(self.notes.warnings).toEqual([]);

    await prisma.expenseDocument.update({ where: { id: docA.id }, data: { status: 'VOIDED' } });
    expect((await computeOne(u, { branchId: branch2.id })).systemIncome).toEqual([otRow('1.5', '140.63')]);

    await prisma.expenseDocument.update({ where: { id: docA.id }, data: { status: 'DRAFT', deletedAt: new Date() } });
    expect((await computeOne(u, { branchId: branch2.id })).systemIncome).toEqual([otRow('1.5', '140.63')]);
  });

  it('(m) account_role_map changed in the DB without invalidate() → compute uses the new code (AccountRoleService cache still has the old one)', async () => {
    const u = await mkUser('m');
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, branch1.id, 4, { kind: 'DAY_OFF', in: '10:00', out: '21:00' });
    const row = await prisma.accountRoleMap.findFirstOrThrow({ where: { role: 'shop_payroll_overtime', accountCode: 'S52-1202', isActive: true } });
    await prisma.accountRoleMap.update({ where: { id: row.id }, data: { accountCode: 'S52-1204' } });
    try {
      const res = await service.compute(prisma as never, query([u]));
      expect(roles.code('shop_payroll_overtime')).toBe('S52-1202'); // cache ต่อ instance ยังเป็นค่าเก่า
      expect(res.attendanceAccountCodes).toEqual(['S52-1204', 'S52-1202']);
      expect(res.rows[0].systemIncome).toEqual([otRow('1.5', '140.63', 'S52-1204'), holidayRow('8.0', '500.00'), holidayOtRow('2.0', '375.00')]);
    } finally {
      await prisma.accountRoleMap.update({ where: { id: row.id }, data: { accountCode: 'S52-1202' } });
    }
  });

  it('FINANCE scope resolves payroll_overtime / payroll_holiday (53-1103)', async () => {
    const u = await mkUser('fin');
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    await mkDay(u, branch1.id, 4, { kind: 'DAY_OFF', in: '10:00', out: '21:00' });
    const res = await service.compute(prisma as never, query([u], { entityScope: 'FINANCE' }));
    expect(res.attendanceAccountCodes).toEqual(['53-1103']);
    expect(res.commissionAccountCodes).toEqual([]);
    expect(res.rows[0].systemIncome.map((r) => r.accountCode)).toEqual(['53-1103', '53-1103', '53-1103']);
  });

  it('resolveRoleCodes: lowest priority among active rows wins (inactive ignored); a missing role throws naming it', async () => {
    const role = `prs_test_role_${stamp}`;
    await prisma.accountRoleMap.createMany({
      data: [
        { role, accountCode: 'S52-1204', priority: 2, isActive: true },
        { role, accountCode: 'S52-1202', priority: 1, isActive: true },
        { role, accountCode: 'S52-1201', priority: 0, isActive: false },
      ],
    });
    try {
      expect(await resolveRoleCodes(prisma as never, [role, 'shop_payroll_holiday'])).toEqual({ [role]: 'S52-1202', shop_payroll_holiday: 'S52-1202' });
      await expect(resolveRoleCodes(prisma as never, [role, 'prs_missing_role'])).rejects.toThrow(/prs_missing_role/);
    } finally {
      await prisma.accountRoleMap.deleteMany({ where: { role } });
    }
  });
});

describe('PayrollSystemRowsService.compute — commission PAY items and clawback deductions (Part 2 · Task 3, Postgres)', () => {
  it('(e) APPROVED 2026-09 + 2026-10 pulled for 2026-10 in [period, createdAt, id] order · PENDING / unpaid CLAWED_BACK / 2026-11 / zero amount excluded · one COMMISSION row on shop_payroll_commission', async () => {
    const u = await mkSeller('e');
    const sep = await mkCommission(u, { period: '2026-09', amount: 500, createdAt: iso('2026-09-20') });
    const late = await mkCommission(u, { amount: '1200.50', createdAt: iso('2026-10-15') });
    const early = await mkCommission(u, { amount: 300, createdAt: iso('2026-10-02') });
    await mkCommission(u, { status: 'PENDING', amount: 700 });
    await mkCommission(u, { status: 'CLAWED_BACK', amount: 800, clawbackPercent: 100, clawbackAt: iso('2026-10-20') }); // ยังไม่จ่าย 100% = clawbackAmount null
    await mkCommission(u, { period: '2026-11', amount: 900 });
    await mkCommission(u, { amount: 0 }); // P2-R6 — ยอด 0 ไม่เป็นรายการ
    const res = await service.compute(prisma as never, query([u]));
    expect(res.commissionAccountCodes).toEqual([COMMISSION_CODE]);
    const row = res.rows[0];
    expect(row.systemIncome).toEqual([commissionRow(3, '2000.50')]);
    expect(row.commissionItems).toEqual([payItem(sep, '500.00'), payItem(early, '300.00'), payItem(late, '1200.50')]);
    expect(row.systemDeductions).toEqual([]);
    expect(row.notes.warnings).toEqual([]);
  });

  it('(u) Task 3 carry — reference = contract number ?? sale number ?? commission id (P2-R21), read through the real contract / sale rows', async () => {
    const u = await mkSeller('u');
    const { sale, contract } = await mkSaleAndContract('u', u);
    const both = await mkCommission(u, { amount: 100, createdAt: iso('2026-10-03') });
    const saleOnly = await mkCommission(u, { amount: 200, createdAt: iso('2026-10-04') });
    const neither = await mkCommission(u, { amount: 300, createdAt: iso('2026-10-05') });
    await prisma.salesCommission.update({ where: { id: both.id }, data: { contractId: contract.id, saleId: sale.id } });
    await prisma.salesCommission.update({ where: { id: saleOnly.id }, data: { saleId: sale.id } });
    const res = await service.compute(prisma as never, query([u]));
    expect(res.rows[0].commissionItems.map((i) => [i.salesCommissionId, i.reference])).toEqual([
      [both.id, contract.contractNumber],
      [saleOnly.id, sale.saleNumber],
      [neither.id, neither.id],
    ]);
  });

  it('(s) a soft-deleted APPROVED commission is not pulled; a soft-deleted paid clawback is not deducted', async () => {
    const u = await mkSeller('s');
    const live = await mkCommission(u, { amount: 1000 });
    await mkCommission(u, { amount: 400, deletedAt: new Date() });
    const gone = await mkPaidClawback(u, { paid: 600, clawback: 600, at: iso('2026-10-05') });
    await mkCommissionDoc('s-paid', u, { status: 'POSTED', period: '2026-08', items: [{ commissionId: gone.id, kind: 'PAY', amount: 600 }] });
    await prisma.salesCommission.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    const row = await computeOne(u);
    expect(row.systemIncome).toEqual([commissionRow(1, '1000.00')]);
    expect(row.commissionItems).toEqual([payItem(live, '1000.00')]);
    expect(row.systemDeductions).toEqual([]);
    expect(row.notes.warnings).toEqual([]);
  });

  it('(r) legacy payout rounds: APPROVED/PAID rounds generated at/after the commission (or with no generatedAt) cover it → not pulled; DRAFT / CANCELLED / soft-deleted rounds, or a round generated before the commission → pulled', async () => {
    const u = await mkSeller('r');
    const mk = (period: string, day: string) => mkCommission(u, { period, amount: 100, createdAt: iso(`${period}-${day}`) });
    await mk('2026-03', '10');
    await mkPayout(u, '2026-03', 'PAID', iso('2026-03-10')); // generatedAt = createdAt → ครอบ
    const apr = await mk('2026-04', '10');
    await mkPayout(u, '2026-04', 'APPROVED', null, true); // รอบที่ถูกลบไม่นับ
    await mk('2026-05', '10');
    await mkPayout(u, '2026-05', 'APPROVED', null); // ยุคก่อนมี generatedAt → ถือว่าครอบ
    await mk('2026-06', '10');
    await mkPayout(u, '2026-06', 'PAID', iso('2026-06-30'));
    const jul = await mk('2026-07', '10');
    await mkPayout(u, '2026-07', 'DRAFT', iso('2026-07-30'));
    const aug = await mk('2026-08', '10');
    await mkPayout(u, '2026-08', 'CANCELLED', iso('2026-08-30'));
    const sep = await mk('2026-09', '20');
    await mkPayout(u, '2026-09', 'APPROVED', iso('2026-09-15')); // สร้างรอบก่อนค่าคอมเกิด → ไม่ได้นับ
    const row = await computeOne(u);
    expect(row.commissionItems).toEqual([payItem(apr, '100.00'), payItem(jul, '100.00'), payItem(aug, '100.00'), payItem(sep, '100.00')]);
    expect(row.systemIncome).toEqual([commissionRow(4, '400.00')]);
  });

  it('(f) a commission with a live PAY item in another document is not pulled → COMMISSION_IN_OTHER_DOCUMENT {count, documentId, documentNumber}; a released item does not hold; the document itself (excludeDocumentId) does not count', async () => {
    const u = await mkSeller('f');
    const c1 = await mkCommission(u, { amount: 100, createdAt: iso('2026-10-01') });
    const c2 = await mkCommission(u, { amount: 200, createdAt: iso('2026-10-02') });
    const c3 = await mkCommission(u, { amount: 300, createdAt: iso('2026-10-03') });
    const c4 = await mkCommission(u, { amount: 400, createdAt: iso('2026-10-04') });
    const docX = await mkCommissionDoc('f-X', u, {
      status: 'DRAFT',
      branchId: branch2.id,
      items: [
        { commissionId: c1.id, kind: 'PAY', amount: 100 },
        { commissionId: c2.id, kind: 'PAY', amount: 200 },
      ],
    });
    await mkCommissionDoc('f-void', u, { status: 'VOIDED', period: '2026-09', items: [{ commissionId: c4.id, kind: 'PAY', amount: 400, released: true }] });

    const row = await computeOne(u);
    expect(row.systemIncome).toEqual([commissionRow(2, '700.00')]);
    expect(row.commissionItems).toEqual([payItem(c3, '300.00'), payItem(c4, '400.00')]);
    expect(row.notes.warnings).toEqual([{ code: 'COMMISSION_IN_OTHER_DOCUMENT', count: 2, documentId: docX.id, documentNumber: docX.number }]);

    const self = await computeOne(u, { excludeDocumentId: docX.id });
    expect(self.commissionItems.map((i) => i.salesCommissionId)).toEqual([c1.id, c2.id, c3.id, c4.id]);
    expect(self.systemIncome).toEqual([commissionRow(4, '1000.00')]);
    expect(self.notes.warnings).toEqual([]);
  });

  it('(g) clawbacks 800 + 600 (both paid through a POSTED payroll) vs this period commission 1,000 → items 800 / 200 (carried 400), one deduction 1,000.00 on the PAY item account, CLAWBACK_CARRIED', async () => {
    const u = await mkSeller('g');
    const pay = await mkCommission(u, { amount: 1000 });
    const c800 = await mkPaidClawback(u, { paid: 800, clawback: 800, at: iso('2026-10-05') });
    const c600 = await mkPaidClawback(u, { paid: 1200, clawback: 600, at: iso('2026-10-10') }); // 50% ของที่จ่าย
    await mkCommissionDoc('g-paid', u, {
      status: 'POSTED',
      period: '2026-08',
      items: [
        { commissionId: c800.id, kind: 'PAY', amount: 800 },
        { commissionId: c600.id, kind: 'PAY', amount: 1200 },
      ],
    });
    const res = await service.compute(prisma as never, query([u]));
    expect(res.commissionAccountCodes).toEqual([COMMISSION_CODE]);
    const row = res.rows[0];
    expect(row.systemIncome).toEqual([commissionRow(1, '1000.00')]);
    expect(row.systemDeductions).toEqual([clawbackRow(2, '1000.00')]);
    expect(row.commissionItems).toEqual([payItem(pay, '1000.00'), clawItem(c800, '800.00'), clawItem(c600, '200.00', '400.00')]);
    expect(row.notes.warnings).toEqual([{ code: 'CLAWBACK_CARRIED', deducted: '1000.00', carried: '400.00' }]);
  });

  it('(g2) two clawbacks with the same clawbackAt split deterministically by id (insertion order does not matter)', async () => {
    const u = await mkSeller('g2');
    const pay = await mkCommission(u, { amount: 1000 });
    const at = iso('2026-10-07');
    const b = await mkPaidClawback(u, { id: `prs-g2-b-${stamp}`, paid: 700, clawback: 700, at });
    const a = await mkPaidClawback(u, { id: `prs-g2-a-${stamp}`, paid: 600, clawback: 600, at });
    await mkCommissionDoc('g2-paid', u, {
      status: 'POSTED',
      period: '2026-08',
      items: [
        { commissionId: b.id, kind: 'PAY', amount: 700 },
        { commissionId: a.id, kind: 'PAY', amount: 600 },
      ],
    });
    for (let i = 0; i < 2; i++) {
      const row = await computeOne(u);
      expect(row.commissionItems).toEqual([payItem(pay, '1000.00'), clawItem(a, '600.00'), clawItem(b, '400.00', '300.00')]);
      expect(row.systemDeductions).toEqual([clawbackRow(2, '1000.00')]);
      expect(row.notes.warnings).toEqual([{ code: 'CLAWBACK_CARRIED', deducted: '1000.00', carried: '300.00' }]);
    }
  });

  it('(g3) P2-R6: no commission this period → the clawback is carried in full: no item, no deduction row, no COMMISSION row, CLAWBACK_CARRIED {0.00, 500.00}; a clawback already deducted in full elsewhere → nothing', async () => {
    const u = await mkSeller('g3');
    const open = await mkPaidClawback(u, { paid: 500, clawback: 500, at: iso('2026-10-03') });
    const done = await mkPaidClawback(u, { paid: 300, clawback: 300, at: iso('2026-10-01') });
    await mkCommissionDoc('g3-paid', u, {
      status: 'POSTED',
      period: '2026-08',
      items: [
        { commissionId: open.id, kind: 'PAY', amount: 500 },
        { commissionId: done.id, kind: 'PAY', amount: 300 },
      ],
    });
    await mkCommissionDoc('g3-deducted', u, { status: 'POSTED', period: '2026-09', items: [{ commissionId: done.id, kind: 'CLAWBACK', amount: 300 }] });
    const res = await service.compute(prisma as never, query([u]));
    expect(res.commissionAccountCodes).toEqual([COMMISSION_CODE]);
    const row = res.rows[0];
    expect(row.systemIncome).toEqual([]);
    expect(row.systemDeductions).toEqual([]);
    expect(row.commissionItems).toEqual([]);
    expect(row.notes.warnings).toEqual([{ code: 'CLAWBACK_CARRIED', deducted: '0.00', carried: '500.00' }]);
  });

  it('(g4) deduction rows are grouped per PAY-item account (sorted by account), each named by its own item count; commissionAccountCodes lists every clawback account', async () => {
    const u = await mkSeller('g4');
    const pay = await mkCommission(u, { amount: 1000 });
    const z = await mkPaidClawback(u, { paid: 100, clawback: 100, at: iso('2026-10-01') });
    const x = await mkPaidClawback(u, { paid: 300, clawback: 300, at: iso('2026-10-02') });
    const y = await mkPaidClawback(u, { paid: 200, clawback: 200, at: iso('2026-10-03') });
    await mkCommissionDoc('g4-jul', u, {
      status: 'POSTED',
      period: '2026-07',
      items: [
        { commissionId: z.id, kind: 'PAY', amount: 100, accountCode: 'S51-1102' }, // จ่ายตอน role ยังชี้บัญชีอื่น
        { commissionId: x.id, kind: 'PAY', amount: 300 },
      ],
    });
    await mkCommissionDoc('g4-aug', u, { status: 'POSTED', period: '2026-08', items: [{ commissionId: y.id, kind: 'PAY', amount: 200 }] });
    const res = await service.compute(prisma as never, query([u]));
    expect(res.commissionAccountCodes).toEqual([COMMISSION_CODE, 'S51-1102']);
    const row = res.rows[0];
    expect(row.commissionItems).toEqual([
      payItem(pay, '1000.00'),
      clawItem(z, '100.00', null, 'S51-1102'),
      clawItem(x, '300.00'),
      clawItem(y, '200.00'),
    ]);
    expect(row.systemDeductions).toEqual([clawbackRow(2, '500.00'), clawbackRow(1, '100.00', 'S51-1102')]);
    expect(row.notes.warnings).toEqual([]);
  });

  it('(t) Decision 1: outstanding = clawbackAmount − live CLAWBACK items in other documents (a draft counts; a released item and the document itself do not)', async () => {
    const u = await mkSeller('t');
    const pay = await mkCommission(u, { amount: 1000 });
    const c = await mkPaidClawback(u, { paid: 800, clawback: 800, at: iso('2026-10-05') });
    await mkCommissionDoc('t-paid', u, { status: 'POSTED', period: '2026-08', items: [{ commissionId: c.id, kind: 'PAY', amount: 800 }] });
    await mkCommissionDoc('t-draft', u, { status: 'DRAFT', branchId: branch2.id, period: '2026-11', items: [{ commissionId: c.id, kind: 'CLAWBACK', amount: 300 }] });
    await mkCommissionDoc('t-void', u, { status: 'VOIDED', period: '2026-09', items: [{ commissionId: c.id, kind: 'CLAWBACK', amount: 200, released: true }] });
    const self = await mkCommissionDoc('t-self', u, {
      status: 'DRAFT',
      items: [
        { commissionId: pay.id, kind: 'PAY', amount: 1000 },
        { commissionId: c.id, kind: 'CLAWBACK', amount: 100 },
      ],
    });

    const row = await computeOne(u, { excludeDocumentId: self.id });
    expect(row.commissionItems).toEqual([payItem(pay, '1000.00'), clawItem(c, '500.00')]); // 800 − 300 (ร่างอื่น)
    expect(row.systemDeductions).toEqual([clawbackRow(1, '500.00')]);
    expect(row.notes.warnings).toEqual([]);

    // ทางสร้างใบใหม่ (ไม่มี excludeDocumentId): ร่าง t-self เป็น "ใบอื่น" — ถือค่าคอมงวดนี้และหักไว้แล้ว 100
    const fresh = await computeOne(u);
    expect(fresh.systemIncome).toEqual([]);
    expect(fresh.commissionItems).toEqual([]);
    expect(fresh.notes.warnings).toEqual([
      { code: 'COMMISSION_IN_OTHER_DOCUMENT', count: 1, documentId: self.id, documentNumber: self.number },
      { code: 'CLAWBACK_CARRIED', deducted: '0.00', carried: '400.00' },
    ]);
  });

  it('(j) partial unique index payroll_commission_items_one_active_pay: a second live PAY item for one commission → P2002; released PAY + new live PAY → OK; two live CLAWBACK items → OK', async () => {
    const u = await mkSeller('j');
    const c = await mkCommission(u, { amount: 1000 });
    const docA = await mkCommissionDoc('j-A', u, { status: 'DRAFT', items: [{ commissionId: c.id, kind: 'PAY', amount: 1000 }] });
    const docB = await mkCommissionDoc('j-B', u, { status: 'DRAFT', branchId: branch2.id, items: [] });
    const item = (payrollLineId: string, salesCommissionId: string, kind: PayrollCommissionItemKind, amount: number) =>
      prisma.payrollCommissionItem.create({ data: { payrollLineId, salesCommissionId, kind, accountCode: COMMISSION_CODE, amount } });

    const err = await item(docB.lineId, c.id, 'PAY', 1000).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((err as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
    // Prisma 6 ไม่ใส่ชื่อดัชนีใน meta — ตัวจับ COMMISSION_TAKEN ของ Task 4 (P2-R4) ต้องจับคู่ด้วย modelName/target ชุดนี้
    expect((err as Prisma.PrismaClientKnownRequestError).meta).toEqual({ modelName: 'PayrollCommissionItem', target: ['sales_commission_id'] });
    // compute อ่านชุดเดียวกับดัชนี: ใบ A ถือค่าคอมนี้
    expect((await computeOne(u, { excludeDocumentId: docB.id })).notes.warnings).toEqual([
      { code: 'COMMISSION_IN_OTHER_DOCUMENT', count: 1, documentId: docA.id, documentNumber: docA.number },
    ]);

    await prisma.payrollCommissionItem.updateMany({ where: { payrollLineId: docA.lineId }, data: { releasedAt: new Date() } });
    await item(docB.lineId, c.id, 'PAY', 1000);
    expect(await prisma.payrollCommissionItem.count({ where: { salesCommissionId: c.id, kind: 'PAY' } })).toBe(2);
    expect((await computeOne(u)).notes.warnings).toEqual([{ code: 'COMMISSION_IN_OTHER_DOCUMENT', count: 1, documentId: docB.id, documentNumber: docB.number }]);

    const clawed = await mkPaidClawback(u, { paid: 500, clawback: 500, at: iso('2026-10-09') });
    await item(docA.lineId, clawed.id, 'CLAWBACK', 200);
    await item(docB.lineId, clawed.id, 'CLAWBACK', 300);
    expect(await prisma.payrollCommissionItem.count({ where: { salesCommissionId: clawed.id, kind: 'CLAWBACK', releasedAt: null } })).toBe(2);
  });

  it('(n) a PAID commission clawed back with no PAY item in a POSTED payroll → no deduction + CLAWBACK_PAID_OUTSIDE_PAYROLL {reference} (also when its PAY item sits in a document not yet posted)', async () => {
    const u = await mkSeller('n');
    const pay = await mkCommission(u, { amount: 1000 });
    const outside = await mkPaidClawback(u, { paid: 900, clawback: 900, at: iso('2026-10-05') });
    const unposted = await mkPaidClawback(u, { paid: 400, clawback: 200, at: iso('2026-10-06') });
    await mkCommissionDoc('n-pending', u, { status: 'PENDING_APPROVAL', branchId: branch2.id, period: '2026-09', items: [{ commissionId: unposted.id, kind: 'PAY', amount: 400 }] });
    const row = await computeOne(u);
    expect(row.systemIncome).toEqual([commissionRow(1, '1000.00')]);
    expect(row.commissionItems).toEqual([payItem(pay, '1000.00')]);
    expect(row.systemDeductions).toEqual([]);
    expect(row.notes.warnings).toEqual([
      { code: 'CLAWBACK_PAID_OUTSIDE_PAYROLL', reference: outside.id },
      { code: 'CLAWBACK_PAID_OUTSIDE_PAYROLL', reference: unposted.id },
    ]);
  });

  it('(n2) an APPROVED (unpaid) commission hit by the cron at 50% (PARTIALLY_CLAWED_BACK, clawbackAmount 500, paidAt null) → not paid, nothing deducted, no warning', async () => {
    const u = await mkSeller('n2');
    const pay = await mkCommission(u, { amount: 1000 });
    await mkCommission(u, {
      status: 'PARTIALLY_CLAWED_BACK',
      amount: 1000,
      clawbackAmount: 500,
      clawbackPercent: 50,
      clawbackAt: iso('2026-10-12'),
      clawbackReason: 'ลูกค้าผิดนัดก่อนครบ 3 งวด',
    });
    const row = await computeOne(u);
    expect(row.systemIncome).toEqual([commissionRow(1, '1000.00')]);
    expect(row.commissionItems).toEqual([payItem(pay, '1000.00')]);
    expect(row.systemDeductions).toEqual([]);
    expect(row.notes.warnings).toEqual([]);
  });

  it('(o) role remapped after payment → the COMMISSION row and PAY item use the new code; the clawback still credits the PAY item account; commissionAccountCodes lists both', async () => {
    const u = await mkSeller('o');
    const c = await mkPaidClawback(u, { paid: 400, clawback: 400, at: iso('2026-10-04') });
    await mkCommissionDoc('o-paid', u, { status: 'POSTED', period: '2026-08', items: [{ commissionId: c.id, kind: 'PAY', amount: 400 }] }); // จ่ายตอน role ชี้ S51-1101
    const pay = await mkCommission(u, { amount: 1000 });
    const role = await prisma.accountRoleMap.findFirstOrThrow({ where: { role: 'shop_payroll_commission', accountCode: COMMISSION_CODE, isActive: true } });
    await prisma.accountRoleMap.update({ where: { id: role.id }, data: { accountCode: 'S51-1102' } });
    try {
      const res = await service.compute(prisma as never, query([u]));
      expect(res.commissionAccountCodes).toEqual(['S51-1102', COMMISSION_CODE]);
      const row = res.rows[0];
      expect(row.systemIncome).toEqual([commissionRow(1, '1000.00', 'S51-1102')]);
      expect(row.commissionItems).toEqual([payItem(pay, '1000.00', 'S51-1102'), clawItem(c, '400.00')]);
      expect(row.systemDeductions).toEqual([clawbackRow(1, '400.00')]);
    } finally {
      await prisma.accountRoleMap.update({ where: { id: role.id }, data: { accountCode: COMMISSION_CODE } });
    }
  });

  it('(p) commission rows ignore attendance eligibility and PIN: a DAILY salesperson with OT gets a COMMISSION row + NOT_MONTHLY_OR_NO_BASE; one with no PIN and no profile gets one + NO_PIN', async () => {
    const daily = await mkUser('p-daily', { profile: { employmentType: 'DAILY', baseSalary: 15000 } });
    await mkDay(daily, branch1.id, 2, { in: '10:00', out: '21:00', ot: 2 });
    const noPin = await mkUser('p-nopin', { pin: false, profile: null });
    const cd = await mkCommission(daily, { amount: 1000 });
    const cn = await mkCommission(noPin, { amount: 750 });
    const res = await service.compute(prisma as never, query([daily, noPin]));
    expect(res.rows[0].autoOtEligible).toBe(false);
    expect(res.rows[0].systemIncome).toEqual([commissionRow(1, '1000.00')]);
    expect(res.rows[0].commissionItems).toEqual([payItem(cd, '1000.00')]);
    expect(res.rows[0].notes.warnings).toEqual([{ code: 'NOT_MONTHLY_OR_NO_BASE', otHours: '2.0' }]);
    expect(res.rows[1].systemIncome).toEqual([commissionRow(1, '750.00')]);
    expect(res.rows[1].commissionItems).toEqual([payItem(cn, '750.00')]);
    expect(res.rows[1].notes.warnings).toEqual([{ code: 'NO_PIN' }]);
  });

  it('(q) a line whose OT sits in another document still gets its commission (attendance rows suppressed, IN_OTHER_DOCUMENT kept)', async () => {
    const u = await mkUser('q');
    await mkDay(u, branch1.id, 1, { in: '10:00', out: '20:30', ot: 1.5 });
    const docA = await mkPayrollDoc('q-A', u, { branchId: branch1.id });
    const c = await mkCommission(u, { amount: 1000 });
    const row = await computeOne(u, { branchId: branch2.id });
    expect(row.systemIncome).toEqual([commissionRow(1, '1000.00')]);
    expect(row.commissionItems).toEqual([payItem(c, '1000.00')]);
    expect(row.notes.warnings).toEqual([{ code: 'IN_OTHER_DOCUMENT', documentId: docA.id, documentNumber: docA.number, branchName: branch1.name, status: 'DRAFT' }]);
  });

  it('(d) FINANCE → no commission rows, items, deductions or commission warnings even with payable commissions + clawbacks (central staff earn no commission); commissionAccountCodes empty', async () => {
    const u = await mkSeller('d');
    await mkCommission(u, { period: '2026-09', amount: 500 });
    await mkCommission(u, { amount: 1000 });
    const c = await mkPaidClawback(u, { paid: 400, clawback: 400, at: iso('2026-10-04') });
    await mkCommissionDoc('d-paid', u, { status: 'POSTED', period: '2026-08', items: [{ commissionId: c.id, kind: 'PAY', amount: 400 }] });
    const none = await mkSeller('d-none');
    const res = await service.compute(prisma as never, query([u, none], { entityScope: 'FINANCE' }));
    expect(res.commissionAccountCodes).toEqual([]);
    for (const row of res.rows) {
      expect(row.systemIncome).toEqual([]);
      expect(row.systemDeductions).toEqual([]);
      expect(row.commissionItems).toEqual([]);
    }
    expect(res.rows[0].notes.warnings).toEqual([]);
    expect(res.rows[1].notes.warnings).toEqual([]);
  });
});
