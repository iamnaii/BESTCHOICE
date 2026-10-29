import { Prisma, PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import type { PrismaService } from '../../../prisma/prisma.service';
import { TEST_NAME_PREFIX } from '../../../utils/test-data-markers';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { PeakExportService } from '../peak-export.service';

/**
 * ไฟล์ส่งออก PEAK ไม่ส่งรายการยกมา / marker และบรรทัดดอกเบี้ยของสัญญาที่ย้ายจากระบบเก่า (Task 10b · ร่าง 5)
 * บน Postgres จริง — ผังบัญชีจาก `seedFinanceCoa` (รหัส PEAK ของ 11-2101 / 11-2103 / 21-2102 / 32-1101 มาจากไฟล์)
 *
 * สเปคนี้ตั้งรหัส PEAK ทดสอบให้ 11-2106 / 41-1101 (ในไฟล์ผังยังว่าง — สเปค §5.11) และล้างรหัสของ 21-5101
 * เพื่อให้มีบรรทัด "ไม่ได้จับคู่" แล้วคืนค่าเดิมตอนจบ · แถวอื่นที่สร้าง (บริษัท FINANCE ถ้ายังไม่มี, สาขา, ผู้ใช้,
 * ผู้ติดต่อ, ลูกค้า, สินค้า, สัญญา, รายการบัญชี) ลบเฉพาะของสเปคนี้
 *
 * รัน: DATABASE_URL=<ฐานทดสอบ test_db หรือ *_test> npx jest <ไฟล์นี้> --runInBand · ไม่มี DATABASE_URL = ข้าม
 */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

/** ช่วงส่งออกของทุกเคส: 1 พ.ย. – 1 ธ.ค. 2026 (วันตัด 30 พ.ย.) */
const FROM = new Date('2026-11-01T00:00:00.000Z');
const TO = new Date('2026-12-01T23:59:59.999Z');
const NOV20 = new Date('2026-11-20T00:00:00.000Z');
const NOV30 = new Date('2026-11-30T00:00:00.000Z');
const DEC1 = new Date('2026-12-01T00:00:00.000Z');

/** รหัส PEAK ทดสอบของบัญชีดอกเบี้ย (สำนักงานบัญชียังไม่ให้รหัสจริง) */
const PEAK_2106 = 'T10B-2106';
const PEAK_4101 = 'T10B-4101';
const UNMAPPED_ACCOUNT = '21-5101';

type Line = [accountCode: string, debit: string, credit: string, description?: string];

/** 2A เต็มงวดของสัญญามาตรฐาน 17k/12 เดือน — 7 บรรทัดเดียวกับ `build-accrual-2a-lines.ts` */
const ACCRUAL_2A_LINES: Line[] = [
  ['11-2103', '1515.84', '0', 'ลูกหนี้ค้างชำระ (Accrual)'],
  ['21-2102', '99.17', '0', 'ล้าง ภาษีขายรอเรียกเก็บ'],
  ['11-2106', '500.00', '0', 'ล้าง รายได้รอตัดบัญชี-ดอกเบี้ย'],
  ['11-2101', '0', '1416.67', 'ลูกหนี้ Gross (ลด excl.VAT)'],
  ['11-2105', '0', '99.17', 'ลูกหนี้ภาษีขายรอฯ (ล้าง)'],
  ['41-1101', '0', '500.00', 'รายได้ดอกเบี้ย (รับรู้)'],
  ['21-2101', '0', '99.17', 'ภาษีขาย ภ.พ.30'],
];

describeDb('PeakExportService — legacy backoffice exclusion (real DB)', () => {
  let prisma: PrismaClient;
  let service: PeakExportService;
  const stamp = Date.now().toString(36).toUpperCase();
  let seq = 0;

  let financeCompanyId = '';
  let createdCompanyId: string | null = null;
  let branchId = '';
  let userId = '';
  const contactIds: string[] = [];
  const customerIds: string[] = [];
  const productIds: string[] = [];
  const contractIds: string[] = [];
  const entryIds: string[] = [];
  const savedMappings: Array<{
    code: string;
    peakCode: string | null;
    peakSubCode: string | null;
    peakSubCodeSource: string;
  }> = [];

  /** สัญญาที่นำเข้าจากระบบเก่า (มี legacyContractCode) · ลูกค้ารหัส PEAK C90001 */
  let legacyContractId = '';
  /** สัญญาปกติ (legacyContractCode = null) · ลูกค้ารหัส PEAK C90002 */
  let plainContractId = '';

  beforeAll(async () => {
    const dbName = new URL(process.env.DATABASE_URL as string).pathname.slice(1);
    if (!/^test_db$|_test$/.test(dbName)) {
      throw new Error(
        `สเปคนี้เขียนแถวจริง — ต้องรันกับฐานทดสอบ (test_db หรือ *_test) แต่ได้ "${dbName}"`,
      );
    }
    prisma = new PrismaClient();
    await prisma.$connect();
    const asService = prisma as unknown as PrismaService;
    service = new PeakExportService(asService, new CompanyResolverService(asService));

    await seedFinanceCoa(prisma);
    for (const code of ['11-2106', '41-1101', UNMAPPED_ACCOUNT]) {
      const row = await prisma.chartOfAccount.findUniqueOrThrow({
        where: { code },
        select: { code: true, peakCode: true, peakSubCode: true, peakSubCodeSource: true },
      });
      savedMappings.push(row);
    }
    await setPeakCode('11-2106', PEAK_2106);
    await setPeakCode('41-1101', PEAK_4101);
    await setPeakCode(UNMAPPED_ACCOUNT, null);

    const finance = await prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (finance) {
      financeCompanyId = finance.id;
    } else {
      const created = await prisma.companyInfo.create({
        data: {
          nameTh: `${TEST_NAME_PREFIX} FINANCE T10B`,
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
        data: { name: `${TEST_NAME_PREFIX} T10B ${stamp}`, companyId: financeCompanyId },
      })
    ).id;
    userId = (
      await prisma.user.create({
        data: {
          email: `t10b-${stamp.toLowerCase()}@bestchoice-test.internal`,
          password: 'hashed_placeholder',
          name: `${TEST_NAME_PREFIX} T10B`,
          role: 'SALES',
          branchId,
        },
      })
    ).id;
    legacyContractId = await createContract('L', 'C90001', `TEST-T10B-${stamp}`);
    plainContractId = await createContract('P', 'C90002', null);
  });

  afterEach(async () => {
    await deleteEntries();
  });

  afterAll(async () => {
    if (!prisma) return;
    await deleteEntries();
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (branchId) await prisma.branch.deleteMany({ where: { id: branchId } });
    if (createdCompanyId) await prisma.companyInfo.deleteMany({ where: { id: createdCompanyId } });
    for (const m of savedMappings) {
      await prisma.chartOfAccount.update({
        where: { code: m.code },
        data: {
          peakCode: m.peakCode,
          peakSubCode: m.peakSubCode,
          peakSubCodeSource: m.peakSubCodeSource,
        },
      });
    }
    await prisma.$disconnect();
  });

  async function setPeakCode(code: string, peakCode: string | null): Promise<void> {
    await prisma.chartOfAccount.update({ where: { code }, data: { peakCode } });
  }

  async function createContract(
    key: string,
    peakContactCode: string,
    legacyContractCode: string | null,
  ): Promise<string> {
    const contact = await prisma.contact.create({
      data: {
        contactCode: `T10B-${stamp}-${key}`,
        name: `${TEST_NAME_PREFIX} T10B ${key}`,
        peakContactCode,
      },
    });
    contactIds.push(contact.id);
    const customer = await prisma.customer.create({
      data: { name: `${TEST_NAME_PREFIX} T10B ${key}`, contactId: contact.id },
    });
    customerIds.push(customer.id);
    const product = await prisma.product.create({
      data: {
        name: `${TEST_NAME_PREFIX} T10B ${key}`,
        brand: 'TestBrand',
        model: 'TestModel',
        imeiSerial: `TEST-T10B-${stamp}-${key}`,
        category: 'PHONE_NEW',
        costPrice: new Prisma.Decimal('8000.00'),
        branchId,
      },
    });
    productIds.push(product.id);
    const contract = await prisma.contract.create({
      data: {
        contractNumber: `TEST-T10B-${stamp}-${key}`,
        legacyContractCode,
        customerId: customer.id,
        productId: product.id,
        branchId,
        salespersonId: userId,
        planType: 'STORE_WITH_INTEREST',
        sellingPrice: new Prisma.Decimal('12000.00'),
        downPayment: new Prisma.Decimal('2000.00'),
        financedAmount: new Prisma.Decimal('10000.00'),
        interestRate: new Prisma.Decimal('0.6000'),
        totalMonths: 12,
        interestTotal: new Prisma.Decimal('6000.00'),
        monthlyPayment: new Prisma.Decimal('1515.84'),
        status: 'ACTIVE',
      },
    });
    contractIds.push(contract.id);
    return contract.id;
  }

  /** ลงรายการ POSTED ฝั่ง FINANCE · คืนเลขรายการ (เรียงตามลำดับที่สร้าง) */
  async function post(
    entryDate: Date,
    description: string,
    metadata: Prisma.InputJsonValue,
    lines: Line[],
  ): Promise<string> {
    seq += 1;
    const entry = await prisma.journalEntry.create({
      data: {
        entryNumber: `T10B-${stamp}-${String(seq).padStart(3, '0')}`,
        companyId: financeCompanyId,
        entryDate,
        description,
        status: 'POSTED',
        postedAt: entryDate,
        createdById: userId,
        metadata,
        lines: {
          create: lines.map(([accountCode, debit, credit, desc]) => ({
            accountCode,
            debit: new Prisma.Decimal(debit),
            credit: new Prisma.Decimal(credit),
            description: desc ?? null,
          })),
        },
      },
      select: { id: true, entryNumber: true },
    });
    entryIds.push(entry.id);
    return entry.entryNumber;
  }

  async function deleteEntries(): Promise<void> {
    if (entryIds.length === 0) return;
    const ids = entryIds.splice(0);
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: ids } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: ids } } });
  }

  /** แถวข้อมูลของไฟล์ (ไม่มี BOM / หัวตาราง) */
  function body(csv: string): string[] {
    const rows = csv.replace(/^﻿/, '').split('\n').slice(1);
    return rows.filter((r) => r.length > 0);
  }
  const entryOf = (row: string) => row.split(',')[1];
  const rowsOf = (csv: string, entryNumber: string) =>
    body(csv).filter((r) => entryOf(r) === entryNumber);
  const accountsOf = (rows: string[]) => rows.map((r) => r.split(',')[4]).sort();

  it('(1) skips the whole legacy-opening entry; a normal receipt the same day still exports', async () => {
    const opening = await post(
      NOV30,
      'ยกยอดสัญญาจากระบบเก่า',
      {
        tag: 'legacy-opening',
        flow: 'legacy-opening',
        idempotencyKey: `TEST-T10B-${stamp}`,
        contractId: legacyContractId,
        importBatch: `T10B-${stamp}`,
      },
      [
        ['11-2101', '8500.00', '0'],
        ['11-2105', '595.00', '0'],
        ['11-2106', '0', '3000.00'],
        ['21-2102', '0', '595.00'],
        ['32-1101', '0', '5500.00'],
      ],
    );
    const receipt = await post(
      NOV30,
      'รับชำระค่างวด',
      { tag: '2B', flow: 'payment-receipt', contractId: plainContractId },
      [
        ['11-1101', '1515.84', '0'],
        ['11-2103', '0', '1515.84'],
      ],
    );

    const res = await service.exportJournalWithPeakCodes(FROM, TO);

    expect(body(res.csv).map(entryOf)).toEqual([receipt, receipt]);
    expect(rowsOf(res.csv, opening)).toEqual([]);
    expect(rowsOf(res.csv, receipt).sort()).toEqual(
      [
        `2026-11-30,${receipt},111101,CSH001,11-1101,เงินสด - สุทธินีย์ คงเดช,1515.84,0,รับชำระค่างวด,`,
        `2026-11-30,${receipt},113101,C90002,11-2103,ลูกหนี้ค้างชำระ (Overdue),0,1515.84,รับชำระค่างวด,`,
      ].sort(),
    );
    expect(res).toMatchObject({
      rowCount: 2,
      skippedLineCount: 0,
      unresolvedSubCodeCount: 0,
      excludedEntryCount: 1,
      excludedLegacyInterestLineCount: 0,
    });
  });

  it('(2) skips the tag-2B prior-receipt marker by flow; a real tag-2B receipt still exports', async () => {
    const marker = await post(
      NOV30,
      'ยอดรับก่อนวันตัด (ระบบเก่า)',
      {
        tag: '2B',
        flow: 'legacy-prior-receipt',
        contractId: legacyContractId,
        installmentScheduleId: `T10B-${stamp}-inst-3`,
        importBatch: `T10B-${stamp}`,
      },
      [
        ['32-1101', '300.00', '0'],
        ['11-2103', '0', '300.00'],
      ],
    );
    const receipt = await post(
      DEC1,
      'รับชำระค่างวด',
      { tag: '2B', flow: 'payment-receipt', contractId: legacyContractId },
      [
        ['11-1101', '1215.84', '0'],
        ['11-2103', '0', '1215.84'],
      ],
    );

    const res = await service.exportJournalWithPeakCodes(FROM, TO);

    expect(rowsOf(res.csv, marker)).toEqual([]);
    expect(rowsOf(res.csv, receipt).sort()).toEqual(
      [
        `2026-12-01,${receipt},111101,CSH001,11-1101,เงินสด - สุทธินีย์ คงเดช,1215.84,0,รับชำระค่างวด,`,
        `2026-12-01,${receipt},113101,C90001,11-2103,ลูกหนี้ค้างชำระ (Overdue),0,1215.84,รับชำระค่างวด,`,
      ].sort(),
    );
    expect(res).toMatchObject({
      rowCount: 2,
      excludedEntryCount: 1,
      excludedLegacyInterestLineCount: 0,
    });
  });

  it('(3) drops 11-2106 / 41-1101 of a legacy contract only — the same 2A of a new contract exports in full', async () => {
    const legacy2A = await post(
      DEC1,
      'ตั้งลูกหนี้งวดที่ 1',
      { tag: '2A', contractId: legacyContractId },
      ACCRUAL_2A_LINES,
    );
    const plain2A = await post(
      DEC1,
      'ตั้งลูกหนี้งวดที่ 1',
      { tag: '2A', contractId: plainContractId },
      ACCRUAL_2A_LINES,
    );

    const res = await service.exportJournalWithPeakCodes(FROM, TO);

    const legacyRows = rowsOf(res.csv, legacy2A);
    expect(accountsOf(legacyRows)).toEqual(['11-2101', '11-2103', '11-2105', '21-2101', '21-2102']);
    expect(accountsOf(rowsOf(res.csv, plain2A))).toEqual([
      '11-2101',
      '11-2103',
      '11-2105',
      '11-2106',
      '21-2101',
      '21-2102',
      '41-1101',
    ]);
    expect(res.csv).toContain(`2026-12-01,${plain2A},${PEAK_2106},,11-2106,`);
    expect(res.csv).toContain(`2026-12-01,${plain2A},${PEAK_4101},,41-1101,`);
    expect(res.csv).not.toContain(`${legacy2A},${PEAK_2106}`);
    expect(res.csv).not.toContain(`${legacy2A},${PEAK_4101}`);
    // The kept lines still carry the legacy contract's PEAK contact code.
    expect(legacyRows.filter((r) => r.includes(',113101,C90001,'))).toHaveLength(3);
    // 11-2106 Dr and 41-1101 Cr of a 2A are the same amount, so dropping the pair keeps the 2A balanced.
    const sum = (col: number) =>
      legacyRows.reduce(
        (s, r) => s.plus(new Prisma.Decimal(r.split(',')[col])),
        new Prisma.Decimal(0),
      );
    expect(sum(6).toFixed(2)).toBe('1615.01');
    expect(sum(7).toFixed(2)).toBe('1615.01');
    expect(res).toMatchObject({
      rowCount: 12,
      skippedLineCount: 0,
      unresolvedSubCodeCount: 0,
      excludedEntryCount: 0,
      excludedLegacyInterestLineCount: 2,
    });
  });

  it('(3b) counts legacy interest lines as excluded (not as unmapped skips) while 11-2106 / 41-1101 have no PEAK code', async () => {
    await setPeakCode('11-2106', null);
    await setPeakCode('41-1101', null);
    try {
      await post(
        DEC1,
        'ตั้งลูกหนี้งวดที่ 1',
        { tag: '2A', contractId: legacyContractId },
        ACCRUAL_2A_LINES,
      );
      await post(
        DEC1,
        'ตั้งลูกหนี้งวดที่ 1',
        { tag: '2A', contractId: plainContractId },
        ACCRUAL_2A_LINES,
      );

      const res = await service.exportJournalWithPeakCodes(FROM, TO);

      expect(res).toMatchObject({
        rowCount: 10,
        skippedLineCount: 2, // the new contract's 11-2106 / 41-1101 — unmapped, as before
        excludedEntryCount: 0,
        excludedLegacyInterestLineCount: 2,
      });
    } finally {
      await setPeakCode('11-2106', PEAK_2106);
      await setPeakCode('41-1101', PEAK_4101);
    }
  });

  it('(4) no legacy data → the file is what the export produced before Task 10b', async () => {
    // Same lines as the first case of peak-export.service.spec.ts (fixed sub-code + unresolved
    // contact + unmapped account), plus a 2A and a receipt of a contract without a legacy code.
    const manual = await post(NOV20, 'd', {}, [
      ['11-6101', '100.00', '0'],
      ['11-2101', '0', '100.00'],
      [UNMAPPED_ACCOUNT, '0', '1.00'],
    ]);
    const accrual = await post(
      DEC1,
      'ตั้งลูกหนี้งวดที่ 1',
      { tag: '2A', contractId: plainContractId },
      ACCRUAL_2A_LINES,
    );
    const receipt = await post(
      DEC1,
      'รับชำระค่างวด',
      { tag: '2B', flow: 'payment-receipt', contractId: plainContractId },
      [
        ['11-1101', '1515.84', '0', 'รับเงินสด, หน้าร้าน'],
        ['11-2103', '0', '1515.84'],
      ],
    );

    const res = await service.exportJournalWithPeakCodes(FROM, TO);

    const [header] = res.csv.split('\n');
    expect(header).toBe(
      '﻿entryDate,entryNumber,peakCode,peakSubCode,accountCode,accountName,debit,credit,description,reference',
    );
    // Entries in date / entry-number order; lines within an entry have no ORDER BY, so compare as sets.
    expect(body(res.csv).map(entryOf)).toEqual([
      manual,
      manual,
      ...Array(7).fill(accrual),
      receipt,
      receipt,
    ]);
    expect(body(res.csv).sort()).toEqual(
      [
        `2026-11-20,${manual},212203,ADV001,11-6101,ภาษีจ่ายแทน SHOP - ภ.พ.30,100,0,d,`,
        `2026-11-20,${manual},113101,,11-2101,ลูกหนี้ผ่อนชำระ (Gross),0,100,d,`,
        `2026-12-01,${accrual},113101,C90002,11-2103,ลูกหนี้ค้างชำระ (Overdue),1515.84,0,ลูกหนี้ค้างชำระ (Accrual),`,
        `2026-12-01,${accrual},215102,,21-2102,ภาษีขายรอเรียกเก็บ,99.17,0,ล้าง ภาษีขายรอเรียกเก็บ,`,
        `2026-12-01,${accrual},${PEAK_2106},,11-2106,รายได้รอตัดบัญชี-ดอกเบี้ย,500,0,ล้าง รายได้รอตัดบัญชี-ดอกเบี้ย,`,
        `2026-12-01,${accrual},113101,C90002,11-2101,ลูกหนี้ผ่อนชำระ (Gross),0,1416.67,ลูกหนี้ Gross (ลด excl.VAT),`,
        `2026-12-01,${accrual},113101,C90002,11-2105,ลูกหนี้ภาษีขายรอเรียกเก็บ,0,99.17,ลูกหนี้ภาษีขายรอฯ (ล้าง),`,
        `2026-12-01,${accrual},${PEAK_4101},,41-1101,รายได้ดอกเบี้ย (รับรู้ตามงวด),0,500,รายได้ดอกเบี้ย (รับรู้),`,
        `2026-12-01,${accrual},215101,,21-2101,ภาษีขาย ภ.พ.30,0,99.17,ภาษีขาย ภ.พ.30,`,
        `2026-12-01,${receipt},111101,CSH001,11-1101,เงินสด - สุทธินีย์ คงเดช,1515.84,0,"รับเงินสด, หน้าร้าน",`,
        `2026-12-01,${receipt},113101,C90002,11-2103,ลูกหนี้ค้างชำระ (Overdue),0,1515.84,รับชำระค่างวด,`,
      ].sort(),
    );
    expect(res).toEqual({
      csv: res.csv,
      rowCount: 11,
      skippedLineCount: 1,
      unresolvedSubCodeCount: 1,
      excludedEntryCount: 0,
      excludedLegacyInterestLineCount: 0,
    });
  });
});
