// apps/api/src/modules/equity/__tests__/equity.integration.spec.ts
//
// DB-backed integration spec (Task 6) — real PrismaService, real Postgres.
// Named `*.integration.spec.ts` so jest's testPathIgnorePatterns skips it;
// runs ONLY under vitest (see CI glob EQUITY_FILES in deploy-gcp.yml).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { EquityDocNumberService } from '../services/equity-doc-number.service';
import { EquityService } from '../equity.service';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';

const D = Prisma.Decimal;

/** ยอดทั้งบัญชี (POSTED) — mirror ของ EquityService.accountBalance ไว้ assert */
async function bal(prisma: PrismaService, code: string, side: 'dr' | 'cr') {
  const lines = await prisma.journalLine.findMany({
    where: {
      accountCode: code,
      deletedAt: null,
      journalEntry: { status: 'POSTED', deletedAt: null },
    },
    select: { debit: true, credit: true },
  });
  return lines.reduce(
    (s, l) =>
      side === 'dr'
        ? s.plus(l.debit.toString()).minus(l.credit.toString())
        : s.plus(l.credit.toString()).minus(l.debit.toString()),
    new D(0),
  );
}

describe('EquityService — integration (DB จริง)', () => {
  const prisma = new PrismaService();
  const service = new EquityService(
    prisma,
    new EquityDocNumberService(),
    new CompanyResolverService(prisma),
    new JournalAutoService(prisma),
  );
  let userId: string;
  let approverUserId: string;
  let financeCompanyId: string;
  let sh1: string;
  let sh2: string;

  /**
   * ล้างข้อมูล equity ทั้งหมด (JE ที่ flow=equity/equity-reverse + เอกสาร equity
   * ทุกตาราง + SystemConfig maker-checker) — ใช้ทั้งใน beforeEach (แต่ละเทสต้อง
   * เริ่มจากศูนย์เพราะ accountBalance เป็น whole-account) และต้นๆ afterAll
   * (เทสสุดท้ายอาจทิ้ง EquityShareholderLine ที่อ้าง sh1/sh2 ไว้ — ถ้าไม่ล้างก่อน
   * shareholder.deleteMany ด้านล่างจะชน onDelete:Restrict).
   */
  async function cleanupEquityData() {
    const jes = await prisma.journalEntry.findMany({
      where: {
        OR: [
          { metadata: { path: ['flow'], equals: 'equity' } },
          { metadata: { path: ['flow'], equals: 'equity-reverse' } },
        ],
      },
      select: { id: true },
    });
    const ids = jes.map((j) => j.id);
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: ids } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: ids } } });
    await prisma.equityAttachment.deleteMany({});
    await prisma.equityShareholderLine.deleteMany({});
    await prisma.equityDocument.deleteMany({});
    await prisma.systemConfig.deleteMany({ where: { key: 'EQUITY_MAKER_CHECKER_ENABLED' } });
  }

  beforeAll(async () => {
    await prisma.$connect();
    await seedFinanceCoa(prisma);

    // FINANCE company ต้องมี — dev DB ที่ seed แล้วมีอยู่แล้วเสมอ (branch นี้จึง
    // แทบไม่เคยรัน) แต่เผื่อ DB ว่าง สร้างด้วย required fields จริงของ schema
    // (nameTh/taxId/address/directorName — ไม่ใช่ `name` แบบใน brief เดิม)
    let finance = await prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    if (!finance) {
      finance = await prisma.companyInfo.create({
        data: {
          companyCode: 'FINANCE',
          nameTh: 'บริษัท เบสท์ช้อยส์ไฟแนนซ์ จำกัด (test)',
          taxId: '0000000000000',
          address: 'ที่อยู่ทดสอบ (integration spec)',
          directorName: 'ผู้ทดสอบระบบ',
        },
      });
    }
    financeCompanyId = finance.id;

    const admin = await prisma.user.findFirst({
      where: { email: 'admin@bestchoice.com', deletedAt: null },
    });
    if (!admin)
      throw new Error('ต้อง seed dev DB ก่อน (admin@bestchoice.com) — ดู project_local_dev_setup');
    userId = admin.id;

    // เลือก approver จริงคนละคนกับ maker — dev seed มี finance@bestchoice.com
    // (FINANCE_MANAGER) อยู่แล้ว ใช้อันนั้นก่อน ถ้าไม่มีค่อย fallback ไปผู้ใช้อื่น
    // แล้วสุดท้ายค่อย fallback เป็น admin เอง (self-approve, สาขา else ของเทส MC)
    const financeManager = await prisma.user.findFirst({
      where: { email: 'finance@bestchoice.com', deletedAt: null },
    });
    const other =
      financeManager ??
      (await prisma.user.findFirst({
        where: { email: { not: 'admin@bestchoice.com' }, deletedAt: null },
      }));
    approverUserId = other?.id ?? admin.id;

    const a = await prisma.shareholder.create({
      data: { name: 'ผู้ถือหุ้นทดสอบ 1', taxId: '1100200111111', type: 'INDIVIDUAL' },
    });
    const b = await prisma.shareholder.create({
      data: { name: 'ผู้ถือหุ้นทดสอบ 2 (นิติบุคคล)', taxId: '0105500000001', type: 'JURISTIC_TH' },
    });
    sh1 = a.id;
    sh2 = b.id;
  }, 60_000);

  beforeEach(async () => {
    await cleanupEquityData();
  });

  afterAll(async () => {
    await cleanupEquityData();
    await prisma.shareholder.deleteMany({ where: { id: { in: [sh1, sh2] } } });
    await prisma.accountingPeriod.deleteMany({
      where: { companyId: financeCompanyId, year: 2020, month: 1 },
    });
    await prisma.$disconnect();
  }, 60_000);

  const capInitDto = () => ({
    txnType: 'CAP_INIT' as const,
    txnDate: new Date().toISOString(),
    resolutionNo: 'MOA-TEST-001',
    resolutionDate: new Date().toISOString(),
    paymentAccountCode: '11-1201',
    lines: [
      { shareholderId: sh1, amount: 700000, paid: 700000 },
      { shareholderId: sh2, amount: 300000, paid: 0 },
    ],
  });

  async function withAttachment(docId: string) {
    await prisma.equityAttachment.create({
      data: {
        documentId: docId,
        s3Key: `test/${docId}.pdf`,
        filename: 'มติ.pdf',
        size: 100,
        mimeType: 'application/pdf',
        uploadedById: userId,
      },
    });
  }

  it('CAP_INIT post → GL ถูกต้อง แล้ว reverse → net 0 ทุกบัญชี', async () => {
    const doc = await service.create(capInitDto(), userId);
    await withAttachment(doc.id);
    await service.post(doc.id, userId);

    expect((await bal(prisma, '31-1101', 'cr')).toFixed(2)).toBe('1000000.00');
    expect((await bal(prisma, '11-1310', 'dr')).toFixed(2)).toBe('300000.00');
    expect((await bal(prisma, '11-1201', 'dr')).toFixed(2)).toBe('700000.00');

    await service.reverse(doc.id, { reason: 'ทดสอบกลับรายการยาวสิบตัวอักษร' }, userId);
    expect((await bal(prisma, '31-1101', 'cr')).toFixed(2)).toBe('0.00');
    expect((await bal(prisma, '11-1310', 'dr')).toFixed(2)).toBe('0.00');
    expect((await bal(prisma, '11-1201', 'dr')).toFixed(2)).toBe('0.00');

    const after = await service.findOne(doc.id);
    expect(after.status).toBe('REVERSED');
    expect(after.reverseJournalEntryId).toBeTruthy();
  });

  it('V_INIT_ONCE — สร้าง CAP_INIT ใบสองไม่ได้ จนกว่าใบแรกถูก reverse', async () => {
    const doc = await service.create(capInitDto(), userId);
    await expect(service.create(capInitDto(), userId)).rejects.toThrow(/CAP_INIT/);
    await withAttachment(doc.id);
    await service.post(doc.id, userId);
    await service.reverse(doc.id, { reason: 'กลับรายการเพื่อทดสอบระบบ' }, userId);
    await expect(service.create(capInitDto(), userId)).resolves.toBeTruthy();
  });

  /**
   * เทสเพิ่ม (review 2026-08) — pin defense-in-depth ของ V_INIT_ONCE:
   * (1) create-time guard (assertInitOnce ใน service.create) กันใบสองตั้งแต่สร้าง
   *     — แยกเป็นเทสของตัวเอง ไม่ผูกกับ lifecycle เทสด้านบน (post+reverse+recreate)
   * (2) ถ้ามีใบ DRAFT สองใบพร้อมกันอยู่แล้วจริงๆ (จำลองด้วยการ insert ตรงผ่าน
   *     prisma บายพาส create-time guard — เช่น race หรือข้อมูลที่หลุดมาก่อนหน้า)
   *     post() เองก็มี guard ของตัวเอง — และพบว่ากันแบบ "blanket": บล็อกทั้งคู่
   *     ใบใดใบหนึ่งที่พยายาม post ก่อน ไม่ใช่แค่ใบที่สอง (assertInitOnce เช็คว่า
   *     "มีเอกสารอื่นที่ไม่ใช่ REVERSED" อยู่หรือไม่ ไม่สนว่าใบไหนถูกสร้างก่อน)
   */
  it('V_INIT_ONCE — ร่างใบที่สองถูกกันตั้งแต่ create', async () => {
    const doc1 = await service.create(capInitDto(), userId);

    // (1) create-time guard — ยืนยันแยกเป็นเทสของตัวเอง
    await expect(service.create(capInitDto(), userId)).rejects.toThrow(/CAP_INIT/);

    // บายพาส create-time guard ตรงๆ ผ่าน prisma เพื่อจำลอง "มี CAP_INIT DRAFT
    // สองใบพร้อมกัน" แล้วพิสูจน์ว่า post() มี guard ของตัวเองด้วย (ไม่ใช่แค่ create)
    const doc2 = await prisma.equityDocument.create({
      data: {
        docNumber: `EQ-BYPASS-${Date.now()}`,
        companyId: financeCompanyId,
        txnType: 'CAP_INIT',
        status: 'DRAFT',
        txnDate: new Date(),
        resolutionNo: 'MOA-TEST-BYPASS',
        resolutionDate: new Date(),
        paymentAccountCode: '11-1201',
        makerId: userId,
        lines: {
          create: [
            {
              shareholderId: sh1,
              shareholderName: 'ผู้ถือหุ้นทดสอบ 1',
              lineNo: 1,
              amount: 700000,
              paid: 700000,
            },
            {
              shareholderId: sh2,
              shareholderName: 'ผู้ถือหุ้นทดสอบ 2 (นิติบุคคล)',
              lineNo: 2,
              amount: 300000,
              paid: 0,
            },
          ],
        },
      },
    });
    await withAttachment(doc1.id);
    await withAttachment(doc2.id);

    // (2) post() guard เป็นแบบ blanket — บล็อกทั้งสองใบตราบใดที่อีกใบยังไม่ reverse
    // (ไม่ใช่แค่ "ใบที่สอง" เท่านั้นที่ถูกบล็อก — ใบแรกก็โพสต์ไม่ได้เหมือนกัน
    // เพราะ assertInitOnce เช็คแค่ "มีใบอื่นที่ไม่ใช่ REVERSED อยู่หรือไม่")
    await expect(service.post(doc1.id, userId)).rejects.toThrow(/CAP_INIT/);
    await expect(service.post(doc2.id, userId)).rejects.toThrow(/CAP_INIT/);

    // เอาตัวก่อกวน (doc2) ออกด้วยมือ (ไม่ผ่าน service — ยัง DRAFT อยู่ ลบตรงได้)
    // แล้วพิสูจน์ปิดท้ายว่า doc1 โพสต์ผ่านได้ตามปกติเมื่อไม่มีคู่แข่งแล้ว
    await prisma.equityShareholderLine.deleteMany({ where: { documentId: doc2.id } });
    await prisma.equityAttachment.deleteMany({ where: { documentId: doc2.id } });
    await prisma.equityDocument.delete({ where: { id: doc2.id } });

    await service.post(doc1.id, userId);
    expect((await service.findOne(doc1.id)).status).toBe('POSTED');
  });

  it('V_DIV_PAY_LE_PAYABLE — DIV_PAY โดยไม่มี DIV_DEC ถูก block; หลัง DIV_DEC ผ่าน + WHT default', async () => {
    const payDto = {
      txnType: 'DIV_PAY' as const,
      txnDate: new Date().toISOString(),
      paymentAccountCode: '11-1201',
      lines: [
        { shareholderId: sh1, amount: 60000 }, // INDIVIDUAL → WHT default 6000
        { shareholderId: sh2, amount: 40000 }, // JURISTIC_TH → 0
      ],
    };
    const pay1 = await service.create(payDto, userId);
    await expect(service.post(pay1.id, userId)).rejects.toThrow(/V_DIV_PAY_LE_PAYABLE/);

    const dec = await service.create(
      {
        txnType: 'DIV_DEC' as const,
        txnDate: new Date().toISOString(),
        resolutionNo: 'AGM-TEST-001',
        resolutionDate: new Date().toISOString(),
        lines: [
          { shareholderId: sh1, amount: 60000 },
          { shareholderId: sh2, amount: 40000 },
        ],
      },
      userId,
    );
    await withAttachment(dec.id);
    const decRes = await service.post(dec.id, userId);
    // 32-1101 ว่าง → DIV_VS_RE warning (ไม่ block)
    expect(decRes.warning).toMatch(/DIV_VS_RE/);

    const posted = await service.post(pay1.id, userId);
    expect(posted.warning ?? null).toBeNull();
    expect((await bal(prisma, '21-4104', 'cr')).toFixed(2)).toBe('0.00'); // ตัดหมด
    expect((await bal(prisma, '21-3104', 'cr')).toFixed(2)).toBe('6000.00'); // WHT default เฉพาะบุคคลธรรมดา
    const payDoc = await service.findOne(pay1.id);
    expect(payDoc.lines.find((l) => l.shareholderId === sh1)!.wht.toString()).toBe('6000');
    expect(payDoc.lines.find((l) => l.shareholderId === sh2)!.wht.toString()).toBe('0');
  });

  it('V_CAP_DEC_LE_CAPITAL — ลดทุนเกิน 31-1101 ถูก block', async () => {
    const dec = await service.create(
      {
        txnType: 'CAP_DEC' as const,
        txnDate: new Date().toISOString(),
        resolutionNo: 'EGM-TEST-001',
        resolutionDate: new Date().toISOString(),
        paymentAccountCode: '11-1201',
        lines: [{ shareholderId: sh1, amount: 50000 }],
      },
      userId,
    );
    await withAttachment(dec.id);
    await expect(service.post(dec.id, userId)).rejects.toThrow(/V_CAP_DEC_LE_CAPITAL/);
  });

  it('post ซ้ำ → ConflictException (status guard)', async () => {
    const doc = await service.create(capInitDto(), userId);
    await withAttachment(doc.id);
    await service.post(doc.id, userId);
    await expect(service.post(doc.id, userId)).rejects.toThrow(/ลงบัญชีซ้ำไม่ได้|สถานะ/);
  });

  it('maker-checker ON — maker โพสต์เองไม่ได้ ต้อง submit แล้วให้อีกคนโพสต์', async () => {
    await prisma.systemConfig.create({
      data: { key: 'EQUITY_MAKER_CHECKER_ENABLED', value: 'true' },
    });
    const doc = await service.create(capInitDto(), userId);
    await withAttachment(doc.id);
    await expect(service.post(doc.id, userId)).rejects.toThrow(/ส่งอนุมัติก่อน/);
    await service.submit(doc.id, userId);
    if (approverUserId !== userId) {
      await expect(service.post(doc.id, userId)).rejects.toThrow(/ผู้อนุมัติต้องไม่ใช่ผู้สร้าง/);
      await service.post(doc.id, approverUserId);
      expect((await service.findOne(doc.id)).status).toBe('POSTED');
    } else {
      await expect(service.post(doc.id, userId)).rejects.toThrow(/ผู้อนุมัติต้องไม่ใช่ผู้สร้าง/);
    }
  });

  it('period guard — txnDate ในงวด CLOSED ถูก block', async () => {
    const closed = new Date(2020, 0, 15); // ม.ค. 2020
    await prisma.accountingPeriod.upsert({
      where: { companyId_year_month: { companyId: financeCompanyId, year: 2020, month: 1 } },
      update: { status: 'CLOSED' },
      create: { companyId: financeCompanyId, year: 2020, month: 1, status: 'CLOSED' },
    });
    const doc = await service.create({ ...capInitDto(), txnDate: closed.toISOString() }, userId);
    await withAttachment(doc.id);
    await expect(service.post(doc.id, userId)).rejects.toThrow(/งวดที่ปิดแล้ว/);
  });
});
