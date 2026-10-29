import { Prisma, PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { CustomerPiiService } from '../../../modules/customers/customer-pii.service';
import { customerPhoneLockKey } from '../../../modules/customers/customer-phone-lock';
import { JournalAutoService } from '../../../modules/journal/journal-auto.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import { hashPII } from '../../../utils/pii.util';
import { TEST_NAME_PREFIX } from '../../../utils/test-data-markers';
import { legacyFileContentType, type LegacyFileDetail } from '../files';
import type { LegacyContract } from '../legacy-book';
import { planImport, type ImportPlan } from '../plan-import';
import {
  LegacyWriteBlocked,
  legacyImportAuditEntry,
  writeLegacyImport,
  type WriteReport,
  type WriterDeps,
} from '../writer';
import {
  CUTOFF,
  MONTHLY,
  peakMatch,
  standardInstallments,
  syntheticBook,
  syntheticContract,
  syntheticMember,
  syntheticRecon,
  thaiId,
} from './synthetic-book';

/**
 * ตัวเขียนนำเข้าระบบเก่าบน Postgres จริง (Task 10) — ข้อมูลสังเคราะห์ทั้งหมด (เลขสัญญา TEST-T10-<stamp>-…, เลขบัตรขึ้นต้น 09
 * ที่คำนวณหลักตรวจเอง, เบอร์ 0976…, IMEI 35998…) · ลบเฉพาะแถวที่สเปคนี้สร้าง
 *
 * สามสัญญา: (1) ผ่อนอยู่ ค้าง + จ่ายบางส่วน + จ่ายล่วงหน้าบางส่วน (2) ปิดก่อนกำหนด (ประวัติ) (3) ผ่อนอยู่ จ่ายล่วงหน้าครบงวด
 * รัน: DATABASE_URL=<ฐานทดสอบ test_db หรือ *_test> PII_* ตั้งในสเปคเอง · npx jest <ไฟล์นี้> --runInBand · ไม่มี DATABASE_URL = ข้าม
 */
const KEY = 'b8'.repeat(32);
const SALT = 'legacy-t10-writer-db-spec-salt-0001';
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const TX = { timeout: 120_000, maxWait: 20_000 };

class Rollback extends Error {
  constructor(readonly value: unknown) {
    super('rollback');
  }
}

describeDb('writeLegacyImport (real DB)', () => {
  let prisma: PrismaClient;
  let logged: PrismaClient<Prisma.PrismaClientOptions, 'query'>;
  let pii: CustomerPiiService;
  let capture = false;
  const statements: Array<{ query: string; params: string }> = [];
  const saved = { key: process.env.PII_ENCRYPTION_KEY, salt: process.env.PII_HASH_SALT };
  const stamp = Date.now().toString(36).toUpperCase();
  const batch = `t10-${stamp.toLowerCase()}`;
  let seq = 0;

  let financeCompanyId = '';
  let createdCompanyId: string | null = null;
  let branchId = '';
  let userId = '';
  const extraCustomerIds: string[] = [];

  beforeAll(async () => {
    const dbName = new URL(process.env.DATABASE_URL as string).pathname.slice(1);
    if (!/^test_db$|_test$/.test(dbName)) {
      throw new Error(
        `สเปคนี้เขียนแถวจริง — ต้องรันกับฐานทดสอบ (test_db หรือ *_test) แต่ได้ "${dbName}"`,
      );
    }
    process.env.PII_ENCRYPTION_KEY = KEY;
    process.env.PII_HASH_SALT = SALT;
    prisma = new PrismaClient();
    logged = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
    logged.$on('query', (e) => {
      if (capture && !/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(e.query.trim())) {
        statements.push({ query: e.query, params: e.params });
      }
    });
    await Promise.all([prisma.$connect(), logged.$connect()]);
    pii = new CustomerPiiService(prisma as unknown as PrismaService);

    await seedFinanceCoa(prisma);
    const finance = await prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (finance) financeCompanyId = finance.id;
    else {
      const created = await prisma.companyInfo.create({
        data: {
          nameTh: `${TEST_NAME_PREFIX} FINANCE T10`,
          taxId: '0000000000000',
          companyCode: 'FINANCE',
          address: '1 Test Rd.',
          directorName: `${TEST_NAME_PREFIX} กรรมการ`,
        },
      });
      financeCompanyId = created.id;
      createdCompanyId = created.id;
    }
    branchId = (
      await prisma.branch.create({
        data: { name: `${TEST_NAME_PREFIX} T10 ${stamp}`, companyId: financeCompanyId },
      })
    ).id;
    userId = (
      await prisma.user.create({
        data: {
          email: `t10-${stamp.toLowerCase()}@bestchoice-test.internal`,
          password: 'hashed_placeholder',
          name: `${TEST_NAME_PREFIX} ย้ายจากระบบเก่า T10`,
          role: 'OWNER',
          branchId,
        },
      })
    ).id;
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    const mine = { legacyContractCode: { startsWith: `TEST-T10-${stamp}` } };
    const contracts = await prisma.contract.findMany({
      where: mine,
      select: { id: true, productId: true, customerId: true },
    });
    const contractIds = contracts.map((c) => c.id);
    const entries = await prisma.journalEntry.findMany({
      where: { metadata: { path: ['importBatch'], string_starts_with: batch } },
      select: { id: true },
    });
    await prisma.journalLine.deleteMany({
      where: { journalEntryId: { in: entries.map((e) => e.id) } },
    });
    await prisma.journalEntry.deleteMany({ where: { id: { in: entries.map((e) => e.id) } } });
    await prisma.paymentEvidence.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.payment.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.installmentSchedule.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contractDocument.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.product.deleteMany({
      where: { legacyProductCode: { startsWith: `TEST-T10-${stamp}` } },
    });
    const customers = await prisma.customer.findMany({
      where: {
        OR: [
          { legacyMemberCode: { startsWith: `TEST-T10M-${stamp}` } },
          { id: { in: extraCustomerIds } },
        ],
      },
      select: { id: true, contactId: true },
    });
    await prisma.customer.deleteMany({ where: { id: { in: customers.map((c) => c.id) } } });
    await prisma.contact.deleteMany({
      where: { id: { in: customers.map((c) => c.contactId).filter((id): id is string => !!id) } },
    });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.branch.deleteMany({ where: { id: branchId } });
    if (createdCompanyId) await prisma.companyInfo.deleteMany({ where: { id: createdCompanyId } });
    await Promise.all([prisma.$disconnect(), logged.$disconnect()]);
    if (saved.key === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = saved.key;
    if (saved.salt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = saved.salt;
  }, 120_000);

  const hash = (v: string) => hashPII(v, SALT);

  async function freshNationalId(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const id = thaiId(`09${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`);
      const taken =
        (await prisma.customer.count({
          where: { OR: [{ nationalId: id }, { nationalIdHash: hash(id) }] },
        })) + (await prisma.contact.count({ where: { nationalIdHash: hash(id) } }));
      if (taken === 0) return id;
    }
    throw new Error('หาเลขบัตรทดสอบที่ว่างไม่ได้');
  }

  async function freshPhone(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const phone = `0976${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
      const taken = await prisma.customer.count({
        where: { OR: [{ phone }, { phoneHash: hash(phone) }] },
      });
      if (taken === 0) return phone;
    }
    throw new Error('หาเบอร์ทดสอบที่ว่างไม่ได้');
  }

  const imei = () => `35998${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`;

  type Scenario = {
    plan: ImportPlan;
    overdue: LegacyContract;
    history: LegacyContract;
    prepaid: LegacyContract;
    phones: string[];
    missingPath: string;
  };

  /** สามสัญญาของ brief — รหัสไม่ซ้ำต่อการเรียก (นำเข้าได้หลายชุดในสเปคเดียว) */
  async function scenario(): Promise<Scenario> {
    const run = ++seq;
    const code = (n: number) => `TEST-T10-${stamp}-${run}-${n}`;
    const memberIds = [`${run}01`, `${run}02`, `${run}03`];
    const phones = [await freshPhone(), await freshPhone(), await freshPhone()];
    const members = await Promise.all(
      memberIds.map(async (id, i) =>
        syntheticMember({
          id,
          code: `TEST-T10M-${stamp}-${run}-${i + 1}`,
          nationalId: await freshNationalId(),
          phone: phones[i],
          name: `${TEST_NAME_PREFIX} T10 สมาชิก`,
        }),
      ),
    );
    const full = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, { paid: MONTHLY }]));
    const overdue = syntheticContract({
      id: `${run}1`,
      code: code(1),
      date: '2026-01-05',
      memberId: memberIds[0],
      firstDue: [2026, 1, 5],
      imei: imei(),
      installments: standardInstallments({
        ...full(8),
        9: { paid: '300' },
        11: { paid: '500', paidOn: new Date('2026-11-20T09:00:00+07:00') },
      }),
    });
    const history = syntheticContract({
      id: `${run}2`,
      code: code(2),
      statusCode: '3',
      date: '2025-06-01',
      memberId: memberIds[1],
      firstDue: [2025, 6, 1],
      imei: imei(),
      installments: standardInstallments(full(6)),
      close: { amount: '7500', discount: '1595', date: new Date('2026-01-15T11:00:00+07:00') },
    });
    const prepaid = syntheticContract({
      id: `${run}3`,
      code: code(3),
      date: '2026-08-10',
      memberId: memberIds[2],
      firstDue: [2026, 8, 10],
      imei: imei(),
      installments: standardInstallments(full(4)),
    });
    const book = syntheticBook([overdue, history, prepaid], members);
    const plan = planImport(book, {
      cutoff: CUTOFF,
      peakRecon: syntheticRecon([
        [overdue, peakMatch(overdue, `T10${run}A`)],
        [history, peakMatch(history, `T10${run}B`, '0')],
        [prepaid, peakMatch(prepaid, `T10${run}C`)],
      ]),
      canceledMap: new Map(),
      moneyOverrides: new Map(),
      customerOverrides: new Map(),
    });
    expect(plan.blockers).toEqual([]);
    const missingPath = `uploads/contract/TEST-${code(3)}.jpg`;
    return { plan, overdue, history, prepaid, phones, missingPath };
  }

  function deps(s: Scenario): WriterDeps {
    const files = new Map<string, LegacyFileDetail>();
    for (const path of s.plan.items.flatMap((i) => i.attachmentPaths)) {
      if (path === s.missingPath) continue;
      files.set(path, {
        key: `legacy-import-test/${path}`,
        size: 2048,
        sha256: 'c'.repeat(64),
        contentType: legacyFileContentType(path),
      });
    }
    return {
      journal: new JournalAutoService(prisma as unknown as PrismaService),
      pii,
      financeCompanyId,
      branchId,
      systemUserId: userId,
      files,
      importBatch: `${batch}-${seq}`,
    };
  }

  const write = (s: Scenario, d = deps(s)) =>
    prisma.$transaction((tx) => writeLegacyImport(tx, s.plan, d), TX);

  const money = (v: Prisma.Decimal | null | undefined) => (v == null ? null : v.toFixed(2));

  describe('commit run', () => {
    let s: Scenario;
    let report: WriteReport;
    let d: WriterDeps;

    beforeAll(async () => {
      s = await scenario();
      d = deps(s);
      report = await write(s, d);
    }, 120_000);

    it('row counts match the WriteReport', async () => {
      const ids = [...report.contractIds.values()];
      expect(ids).toHaveLength(3);
      const [schedules, payments, evidences, documents, entries] = await Promise.all([
        prisma.installmentSchedule.count({ where: { contractId: { in: ids } } }),
        prisma.payment.count({ where: { contractId: { in: ids } } }),
        prisma.paymentEvidence.count({ where: { contractId: { in: ids } } }),
        prisma.contractDocument.count({ where: { contractId: { in: ids } } }),
        prisma.journalEntry.count({
          where: { metadata: { path: ['importBatch'], equals: d.importBatch } },
        }),
      ]);
      expect(report.created).toEqual({
        customers: 3,
        products: 3,
        contracts: 3,
        schedules,
        payments,
        evidences,
        documents,
        journalEntries: entries,
      });
      // ผ่อนอยู่ 12 + 12 งวด · ประวัติ 6 งวดที่จ่าย · สลิป 10 (1: งวด 1–9 + 11) + 7 (2 รวมใบปิดบัญชี) + 4 (3) · เอกสารหายหนึ่งไฟล์
      expect([schedules, payments, evidences, documents]).toEqual([24, 30, 21, 2]);
      // (1) ยกมา + marker 2 + ไล่ VAT · (3) ยกมา
      expect(entries).toBe(5);
      expect(report.skippedExisting).toEqual([]);
      expect(report.missingAttachments).toEqual([{ code: s.prepaid.code, paths: [s.missingPath] }]);
    });

    it('contracts, products and payments carry the legacy fields', async () => {
      const contract = await prisma.contract.findUniqueOrThrow({
        where: { legacyContractCode: s.overdue.code },
        include: { product: true, payments: { orderBy: { installmentNo: 'asc' } } },
      });
      expect(contract).toMatchObject({
        contractNumber: s.overdue.code,
        status: 'OVERDUE',
        workflowStatus: 'APPROVED',
        planType: 'STORE_WITH_INTEREST',
        salespersonId: userId,
        branchId,
        interestConfigId: null,
        totalMonths: 12,
        paymentDueDay: 5,
      });
      expect(contract.createdAt.toISOString()).toBe(s.overdue.createdAt.toISOString());
      expect(contract.deviceReceivedAt?.toISOString()).toBe(s.overdue.createdAt.toISOString());
      expect([
        money(contract.financedAmount),
        money(contract.interestTotal),
        money(contract.vatAmount),
      ]).toEqual(['10000.00', '6000.00', '1190.00']);
      expect(contract.product).toMatchObject({
        legacyProductCode: `${s.overdue.code}/${s.overdue.detail.mobile_imei}`,
        imeiSerial: s.overdue.detail.mobile_imei,
        status: 'SOLD_INSTALLMENT',
        ownedByCompanyId: financeCompanyId,
      });
      expect(
        contract.payments.map((p) => [p.installmentNo, p.status, money(p.amountPaid)]),
      ).toEqual([
        ...Array.from({ length: 8 }, (_, i) => [i + 1, 'PAID', MONTHLY]),
        [9, 'PARTIALLY_PAID', '300.00'],
        [10, 'OVERDUE', '0.00'],
        [11, 'PARTIALLY_PAID', '500.00'],
        [12, 'PENDING', '0.00'],
      ]);
      expect(contract.payments.every((p) => p.lateFee.isZero())).toBe(true);
      expect(contract.payments[0].legacyInstallmentCode).toBe(`TEST-I-${s.overdue.code}-1`);

      const history = await prisma.contract.findUniqueOrThrow({
        where: { legacyContractCode: s.history.code },
        include: { product: true, installmentSchedules: true },
      });
      expect(history.status).toBe('EARLY_PAYOFF');
      expect(history.installmentSchedules).toEqual([]);
      expect(history.product.imeiSerial).toBeNull();
      expect(history.notes).toContain('ปิดบัญชีก่อนกำหนดในระบบเก่า');
    });

    it('opening JE balances, is stamped peakSyncedAt = cutoff, and carries the legacy-opening metadata', async () => {
      const contractId = report.contractIds.get(s.overdue.code) as string;
      const opening = await prisma.journalEntry.findFirstOrThrow({
        where: { referenceType: 'AUTO', referenceId: `legacy-opening:${s.overdue.code}` },
        include: { lines: true },
      });
      const dr = opening.lines.reduce((t, l) => t.plus(l.debit), new Prisma.Decimal(0));
      const cr = opening.lines.reduce((t, l) => t.plus(l.credit), new Prisma.Decimal(0));
      expect(dr.eq(cr)).toBe(true);
      expect(opening.postedAt?.toISOString()).toBe(CUTOFF.toISOString());
      expect(opening.peakSyncedAt?.toISOString()).toBe(CUTOFF.toISOString());
      expect(opening.companyId).toBe(financeCompanyId);
      expect(opening.metadata).toEqual({
        tag: 'legacy-opening',
        flow: 'legacy-opening',
        idempotencyKey: s.overdue.code,
        contractId,
        importBatch: d.importBatch,
      });
      const planned = s.plan.items.find((i) => i.code === s.overdue.code);
      expect(
        opening.lines.map((l) => [l.accountCode, money(l.debit), money(l.credit)]).sort(),
      ).toEqual(
        planned!.opening!.openingLines.map((l) => [l.accountCode, money(l.dr), money(l.cr)]).sort(),
      );
    });

    it('one marker per partially paid installment (2B legacy-prior-receipt, no paymentId) + catch-up dated 1 Dec 00:05', async () => {
      const contractId = report.contractIds.get(s.overdue.code) as string;
      const schedules = await prisma.installmentSchedule.findMany({
        where: { contractId },
        orderBy: { installmentNo: 'asc' },
      });
      const markers = await prisma.journalEntry.findMany({
        where: {
          metadata: { path: ['flow'], equals: 'legacy-prior-receipt' },
          AND: [{ metadata: { path: ['contractId'], equals: contractId } }],
        },
        include: { lines: true },
        orderBy: { entryNumber: 'asc' },
      });
      expect(
        markers.map((m) => [
          (m.metadata as Record<string, string>).installmentScheduleId,
          m.referenceId,
          m.lines.map((l) => [l.accountCode, money(l.debit), money(l.credit)]),
        ]),
      ).toEqual([
        [
          schedules[8].id,
          `legacy-prior:${schedules[8].id}`,
          [
            ['32-1101', '300.00', '0.00'],
            ['11-2103', '0.00', '300.00'],
          ],
        ],
        [
          schedules[10].id,
          `legacy-prior:${schedules[10].id}`,
          [
            ['32-1101', '500.00', '0.00'],
            ['11-2103', '0.00', '500.00'],
          ],
        ],
      ]);
      for (const m of markers) {
        expect(m.metadata).toEqual({
          tag: '2B',
          flow: 'legacy-prior-receipt',
          contractId,
          installmentScheduleId: (m.metadata as Record<string, string>).installmentScheduleId,
          importBatch: d.importBatch,
        });
        expect(m.peakSyncedAt?.toISOString()).toBe(CUTOFF.toISOString());
      }

      const catchUp = await prisma.journalEntry.findFirstOrThrow({
        where: { referenceType: 'AUTO', referenceId: `legacy-vat-catchup:${s.overdue.code}` },
        include: { lines: true },
      });
      expect(catchUp.postedAt?.toISOString()).toBe(
        new Date('2026-12-01T00:05:00+07:00').toISOString(),
      );
      expect(catchUp.peakSyncedAt).toBeNull();
      expect(catchUp.metadata).toEqual({
        tag: 'legacy-vat-catchup',
        flow: 'legacy-vat-catchup',
        contractId,
        importBatch: d.importBatch,
      });
      expect(
        catchUp.lines.map((l) => [l.accountCode, money(l.debit), money(l.credit)]).sort(),
      ).toEqual([
        ['21-2101', '0.00', '178.71'],
        ['21-2102', '178.71', '0.00'],
      ]);
      // ไม่มีรายการไล่ VAT / marker ของสัญญาที่ไม่มีงวดค้าง
      const prepaidId = report.contractIds.get(s.prepaid.code) as string;
      expect(
        await prisma.journalEntry.count({
          where: { metadata: { path: ['contractId'], equals: prepaidId } },
        }),
      ).toBe(1);
    });

    it('no 21-1101 / 21-1102 line on any entry of an imported contract; every entry carries contractId', async () => {
      const ids = [...report.contractIds.values()];
      const entries = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['importBatch'], equals: d.importBatch } },
        include: { lines: true },
      });
      expect(
        entries.every((e) => ids.includes((e.metadata as Record<string, string>).contractId)),
      ).toBe(true);
      const shopLines = await prisma.journalLine.count({
        where: {
          accountCode: { in: ['21-1101', '21-1102'] },
          journalEntry: {
            OR: ids.map((id) => ({ metadata: { path: ['contractId'], equals: id } })),
          },
        },
      });
      expect(shopLines).toBe(0);
      expect(report.journalEntries.map((e) => e.kind).sort()).toEqual([
        'catch-up',
        'marker',
        'marker',
        'opening',
        'opening',
      ]);
    });

    it('stamps: accrualJournalEntryId = opening entryNumber on accrued rows, accrued columns on partial future rows, never vat60', async () => {
      const contractId = report.contractIds.get(s.overdue.code) as string;
      const opening = report.journalEntries.find(
        (e) => e.kind === 'opening' && e.contractId === contractId,
      )!;
      const rows = await prisma.installmentSchedule.findMany({
        where: { contractId },
        orderBy: { installmentNo: 'asc' },
      });
      expect(
        rows.map((r) => [
          r.installmentNo,
          r.accrualJournalEntryId,
          money(r.accruedAmount),
          money(r.accruedVat),
          money(r.accruedInterest),
        ]),
      ).toEqual([
        ...Array.from({ length: 10 }, (_, i) => [
          i + 1,
          opening.entryNumber,
          MONTHLY,
          '99.17',
          '500.00',
        ]),
        [11, null, '500.00', '32.71', '164.93'],
        [12, null, '0.00', '0.00', '0.00'],
      ]);
      expect(rows.every((r) => r.vat60dayJournalEntryId === null)).toBe(true);
      expect(rows.map((r) => r.dueDate.toISOString())).toEqual(
        s.overdue.installments.map((i) => i.dueDate.toISOString()),
      );

      const prepaidId = report.contractIds.get(s.prepaid.code) as string;
      const prepaidOpening = report.journalEntries.find(
        (e) => e.kind === 'opening' && e.contractId === prepaidId,
      )!;
      const prepaidRows = await prisma.installmentSchedule.findMany({
        where: { contractId: prepaidId },
        orderBy: { installmentNo: 'asc' },
      });
      expect(prepaidRows.map((r) => r.accrualJournalEntryId)).toEqual([
        ...Array(4).fill(prepaidOpening.entryNumber),
        ...Array(8).fill(null),
      ]);
    });

    it('customers are linked with the PEAK contact code of their contract', async () => {
      const customers = await prisma.contract.findMany({
        where: { id: { in: [...report.contractIds.values()] } },
        select: {
          legacyContractCode: true,
          customer: {
            select: { legacyMemberCode: true, contact: { select: { peakContactCode: true } } },
          },
        },
      });
      const byCode = new Map(customers.map((c) => [c.legacyContractCode, c.customer]));
      for (const item of s.plan.items) {
        expect(byCode.get(item.code)?.legacyMemberCode).toBe(item.memberCode);
        expect(byCode.get(item.code)?.contact?.peakContactCode).toBe(item.customer.peakContactCode);
      }
      expect(report.customers.map((c) => c.outcome)).toEqual(['CREATED', 'CREATED', 'CREATED']);
    });

    it('evidences (APPROVED, imageUrl = storage key) and documents (key + size/type/hash) rows', async () => {
      const contractId = report.contractIds.get(s.history.code) as string;
      const evidences = await prisma.paymentEvidence.findMany({
        where: { contractId },
        orderBy: { createdAt: 'asc' },
      });
      expect(evidences).toHaveLength(7);
      expect(
        evidences.every(
          (e) => e.status === 'APPROVED' && e.imageUrl.startsWith('legacy-import-test/'),
        ),
      ).toBe(true);
      expect(evidences.every((e) => e.reviewNote?.startsWith('ยกมาจากระบบเก่า'))).toBe(true);
      expect(evidences.filter((e) => e.paymentId === null)).toHaveLength(1);
      const docs = await prisma.contractDocument.findMany({ where: { contractId } });
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        documentType: 'SIGNED_CONTRACT',
        fileUrl: `legacy-import-test/uploads/contract/TEST-${s.history.code}.jpg`,
        fileName: `TEST-${s.history.code}.jpg`,
        mimeType: 'image/jpeg',
        fileSize: 2048,
        fileHash: 'c'.repeat(64),
        uploadedById: userId,
      });
    });

    it('audit payload for after-commit (one row per batch, counts + customer writes)', () => {
      const entry = legacyImportAuditEntry(report, userId);
      expect(entry).toMatchObject({
        userId,
        action: 'LEGACY_IMPORT_COMMITTED',
        entity: 'legacy-import',
        entityId: d.importBatch,
      });
      expect((entry.newValue as { customerWrites: unknown[] }).customerWrites).toHaveLength(3);
    });

    it('a second call skips every contract (skippedExisting) and adds no JournalEntry', async () => {
      const before = await prisma.journalEntry.count();
      const again = await write(s, { ...d, importBatch: `${d.importBatch}-again` });
      expect(again.skippedExisting.sort()).toEqual(s.plan.items.map((i) => i.code).sort());
      expect(again.created).toEqual({
        customers: 0,
        products: 0,
        contracts: 0,
        schedules: 0,
        payments: 0,
        evidences: 0,
        documents: 0,
        journalEntries: 0,
      });
      expect(await prisma.journalEntry.count()).toBe(before);
    });
  });

  it('dry run: the caller throws a Rollback sentinel → nothing persists', async () => {
    const s = await scenario();
    const d = deps(s);
    const entriesBefore = await prisma.journalEntry.count();
    const outcome = await prisma
      .$transaction(async (tx) => {
        throw new Rollback(await writeLegacyImport(tx, s.plan, d));
      }, TX)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(outcome).toBeInstanceOf(Rollback);
    const report = (outcome as Rollback).value as WriteReport;
    expect(report.created.contracts).toBe(3);
    expect(report.created.journalEntries).toBe(5);
    expect(await prisma.journalEntry.count()).toBe(entriesBefore);
    expect(
      await prisma.contract.count({
        where: { legacyContractCode: { in: s.plan.items.map((i) => i.code) } },
      }),
    ).toBe(0);
    expect(
      await prisma.customer.count({
        where: { legacyMemberCode: { in: s.plan.items.map((i) => i.memberCode) } },
      }),
    ).toBe(0);
  }, 120_000);

  it('the first SQL statements of the transaction are the phone advisory locks (sorted, one per phone)', async () => {
    const s = await scenario();
    const d = deps(s);
    statements.length = 0;
    capture = true;
    await logged
      .$transaction(async (tx) => {
        await writeLegacyImport(tx, s.plan, d);
        throw new Rollback(null);
      }, TX)
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
    capture = false;
    const keys = s.phones.map((p) => customerPhoneLockKey(pii, p) as string).sort();
    const head = statements.slice(0, keys.length);
    expect(head.every((st) => /pg_advisory_xact_lock\(hashtext\(\$1\)\)/.test(st.query))).toBe(
      true,
    );
    expect(head.map((st) => JSON.parse(st.params)[0])).toEqual(keys);
    expect(statements[keys.length].query).not.toMatch(/hashtext/);
  }, 120_000);

  it('DB-level conflicts → LegacyWriteBlocked carrying every row (phone owner + IMEI holder); the caller rolls back', async () => {
    const s = await scenario();
    const d = deps(s);
    // เบอร์ของสมาชิกคนแรกเป็นของลูกค้าอื่นอยู่แล้ว (ไม่มีเลขบัตรตรงกัน) · IMEI ของสัญญาที่ 3 ถือโดยเครื่องในคลัง
    const owner = await prisma.customer.create({
      data: {
        name: `${TEST_NAME_PREFIX} T10 เจ้าของเบอร์`,
        phone: s.phones[0],
        phoneHash: hash(s.phones[0]),
      },
    });
    extraCustomerIds.push(owner.id);
    const stock = await prisma.product.create({
      data: {
        name: `${TEST_NAME_PREFIX} T10 เครื่องในคลัง`,
        brand: 'Apple',
        model: 'ทดสอบ',
        category: 'PHONE_USED',
        costPrice: 0,
        branchId,
        imeiSerial: s.prepaid.detail.mobile_imei,
        legacyProductCode: `TEST-T10-${stamp}-stock`,
      },
    });
    try {
      const error = await prisma
        .$transaction((tx) => writeLegacyImport(tx, s.plan, d), TX)
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(error).toBeInstanceOf(LegacyWriteBlocked);
      const rows = (error as LegacyWriteBlocked).rows;
      expect(rows.map((r) => [r.code, r.reason]).sort()).toEqual(
        [
          [s.overdue.code, 'CUSTOMER_PHONE_TAKEN'],
          [s.prepaid.code, 'IMEI_TAKEN'],
        ].sort(),
      );
      expect(rows.find((r) => r.reason === 'CUSTOMER_PHONE_TAKEN')?.detail?.relatedCustomerId).toBe(
        owner.id,
      );
      expect(rows.find((r) => r.reason === 'IMEI_TAKEN')?.detail?.productId).toBe(stock.id);
      expect(JSON.stringify(rows)).not.toContain(s.phones[0]);
      expect(
        await prisma.contract.count({
          where: { legacyContractCode: { in: s.plan.items.map((i) => i.code) } },
        }),
      ).toBe(0);
    } finally {
      await prisma.product.delete({ where: { id: stock.id } });
    }
  }, 120_000);

  it('a plan with blockers is refused before any statement (unless allowPlanBlockers)', async () => {
    const s = await scenario();
    const blocked: ImportPlan = {
      ...s.plan,
      blockers: [{ code: 'TEST-X', reason: 'PEAK_UNMATCHED' }],
    };
    const tx = new Proxy(
      {},
      {
        get: () => {
          throw new Error('no statement expected');
        },
      },
    );
    await expect(
      writeLegacyImport(tx as Prisma.TransactionClient, blocked, deps(s)),
    ).rejects.toBeInstanceOf(LegacyWriteBlocked);
  });
});
