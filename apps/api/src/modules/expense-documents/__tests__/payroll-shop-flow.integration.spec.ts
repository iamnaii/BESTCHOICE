import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { AccountRoleService } from '../../journal/account-role.service';
import { AuditService } from '../../audit/audit.service';
import { PayrollTemplate } from '../../journal/cpa-templates/payroll.template';
import { ExpenseDocumentCreateService } from '../services/expense-document-create.service';
import { LineAggregatorService } from '../services/line-aggregator.service';
import { StatusTransitionService } from '../services/status-transition.service';
import { SsoConfigService } from '../../sso-config/sso-config.service';
import { PayrollCustomService } from '../services/payroll-custom.service';
import { PettyCashService } from '../services/petty-cash.service';
import { GeneralLedgerReportService } from '../../accounting/general-ledger-report.service';
import { TaxPreviewService } from '../../tax/services/tax-preview.service';
import { PayrollRemittanceTemplate } from '../../journal/cpa-templates/payroll-remittance.template';
import { ExpenseDocumentQueryService } from '../services/expense-document-query.service';

/**
 * Payroll ฝั่ง SHOP — สถานการณ์สมมุติ E2E กับ DB จริง (คำสั่งเจ้าของ 2026-08-06 ข้อ 4:
 * "ทำเสร็จแล้ว...ลองสมมุติเหตุการณ์ เพื่อลองบันทึก").
 *
 * เหตุการณ์: จ่ายเงินเดือนพนักงานสาขา 2 คน งวด 2099-01 (งวดอนาคตกันข้อมูล dev ปน)
 *   - สมชาย  ฐาน 12,000 + OT 1,000 (S52-1202, เสียภาษี) − SSO 600 − หักคืนเงินยืม 500
 *            → สุทธิ 11,900
 *   - สมหญิง ฐาน 18,000 + โบนัส 2,000 (S52-1204) − SSO 875 (เพดาน 17,500) − WHT 150
 *            → สุทธิ 18,975
 *
 * ยืนยัน:
 *   1. สร้างใบ SHOP scope สำเร็จ (DRAFT) + กันซ้ำงวด/สาขา/ฝั่ง + กันบัญชีจ่ายผิดฝั่ง
 *      + V19 กันรหัสรายการหักมั่ว
 *   2. JE: Dr S52-1201 30,000 / Dr S52-1205 1,475 / Dr S52-1202 1,000 /
 *      Dr S52-1204 2,000 // Cr S21-3101 150 / Cr S21-3105 1,475 / Cr S21-3106 1,475 /
 *      Cr S21-1103 500 / Cr S11-1202 30,875 — balanced 34,475 ทั้งสองข้าง,
 *      companyId = SHOP, ทุกรหัสขึ้นต้น S, metadata.idempotencyKey ครบ
 *   3. B2 fix: Trial Balance scope=SHOP เห็น S52-1201; scope=FINANCE ไม่เห็นบรรทัดใด
 *      ของ JE นี้ (เดิมเงินเดือนหายจากรายงานทั้งสอง scope)
 *   4. ภ.ง.ด.1: แสดงพนักงานทุกคนรวมคนภาษี 0, gross รวม OT/โบนัสที่เสียภาษี
 *   5. FINANCE scope: ใบส่วนกลางใช้ผังเดิม 53-1101 แต่ companyId = FINANCE
 */

const prisma = new PrismaClient();

const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const audit = new AuditService(prisma as never);
const roles = new AccountRoleService(prisma as never, audit);
const payrollTemplate = new PayrollTemplate(journal, prisma as never, roles, companyResolver);
const ssoConfig = new SsoConfigService(prisma as never);
const payrollCustom = new PayrollCustomService(prisma as never);
let docSeq = 0;
const docNumberStub = {
  next: async () => `PR-TEST-${Date.now()}-${++docSeq}`,
} as never;
const creator = new ExpenseDocumentCreateService(
  prisma as never,
  docNumberStub,
  new LineAggregatorService(),
  new StatusTransitionService(),
  ssoConfig,
  payrollCustom,
  new PettyCashService(prisma as never),
);
const glReport = new GeneralLedgerReportService(prisma as never, companyResolver);
const taxPreview = new TaxPreviewService(prisma as never);
const remitTemplate = new PayrollRemittanceTemplate(
  journal,
  prisma as never,
  roles,
  companyResolver,
);
// buildPayrollBankCsv path never touches jePreview — safe to omit here.
const queryService = new ExpenseDocumentQueryService(prisma as never, undefined as never);

let shopCompanyId: string;
let financeCompanyId: string;
let branchId: string;
let adminId: string;
const createdDocIds: string[] = [];
// นำส่ง ปกส./ภ.ง.ด.1 — JE ไม่ผูกกับ document จึงต้อง track แยกเพื่อ cleanup
const remitJeEntryNos: string[] = [];

const OWNER_USER = () => ({ id: adminId, branchId: null, role: 'OWNER' });

const shopLines = [
  {
    employeeName: 'สมชาย ทดสอบเงินเดือน',
    baseSalary: 12000,
    ssoEmployee: 600,
    whtAmount: 0,
    customIncome: [{ accountCode: 'S52-1202', name: 'OT', amount: 1000, isTaxable: true }],
    customDeduction: [{ accountCode: 'S21-1103', name: 'คืนเงินยืม', amount: 500 }],
  },
  {
    employeeName: 'สมหญิง ทดสอบเงินเดือน',
    baseSalary: 18000,
    ssoEmployee: 875,
    whtAmount: 150,
    customIncome: [{ accountCode: 'S52-1204', name: 'โบนัส', amount: 2000, isTaxable: true }],
  },
];

beforeAll(async () => {
  await seedFinanceCoa(prisma);
  await seedShopCoa(prisma);
  // Role cache — loads shop_* rows seeded by migration 20260990000000 and
  // asserts every mapped code exists in the CoA (fails loudly if the migration
  // has not been applied to this DB).
  await roles.onModuleInit();

  shopCompanyId = await companyResolver.getShopCompanyId();
  financeCompanyId = await companyResolver.getFinanceCompanyId();

  const admin = await prisma.user.findFirst({
    where: { email: 'admin@bestchoice.com' },
    select: { id: true },
  });
  if (!admin) throw new Error('admin@bestchoice.com not seeded — run prisma seed first');
  adminId = admin.id;

  const branch = await prisma.branch.create({
    data: {
      name: '__PAYROLL_TEST_BRANCH__',
      companyId: shopCompanyId,
    },
  });
  branchId = branch.id;
}, 120_000);

afterAll(async () => {
  // Scoped cleanup — only rows this spec created.
  const jes = await prisma.journalEntry.findMany({
    where: {
      metadata: { path: ['idempotencyKey'], string_starts_with: 'expense-payroll:' } as never,
    },
    select: { id: true, metadata: true },
  });
  const ourJeIds = jes
    .filter((j) => {
      const key = (j.metadata as { idempotencyKey?: string } | null)?.idempotencyKey ?? '';
      return createdDocIds.some((d) => key.endsWith(d));
    })
    .map((j) => j.id);
  // Remittance JEs (flow sso-remittance / pnd1-remittance) tracked by entryNumber
  if (remitJeEntryNos.length > 0) {
    const remitJes = await prisma.journalEntry.findMany({
      where: { entryNumber: { in: remitJeEntryNos } },
      select: { id: true },
    });
    ourJeIds.push(...remitJes.map((j) => j.id));
  }
  if (ourJeIds.length > 0) {
    await prisma.expenseDocument.updateMany({
      where: { id: { in: createdDocIds } },
      data: { journalEntryId: null },
    });
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: ourJeIds } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: ourJeIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: ourJeIds } } });
  }
  // Hard-delete docs — cascades payroll_details → payroll_lines → custom rows.
  if (createdDocIds.length > 0) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM expense_documents WHERE id IN (${createdDocIds.map((id) => `'${id}'`).join(',')})`,
    );
  }
  try {
    await prisma.branch.delete({ where: { id: branchId } });
  } catch {
    // referenced outside this spec — leave it
  }
  await prisma.$disconnect();
}, 120_000);

describe('Payroll SHOP scope — สถานการณ์สมมุติเต็ม flow', () => {
  let shopDocId: string;

  it('1. สร้างใบเงินเดือนพนักงานสาขา (SHOP) 2 คน → DRAFT + snapshot ครบ', async () => {
    const doc = await creator.createPayroll(
      {
        branchId,
        documentDate: '2099-01-15',
        payrollPeriod: '2099-01',
        entityScope: 'SHOP',
        depositAccountCode: 'S11-1202',
        lines: shopLines,
      } as never,
      OWNER_USER(),
    );
    shopDocId = doc.id;
    createdDocIds.push(doc.id);

    expect(doc.status).toBe('DRAFT');
    expect(doc.payroll?.entityScope).toBe('SHOP');
    expect(doc.payroll?.lines).toHaveLength(2);
    const somchai = doc.payroll!.lines.find((l) => l.employeeName.startsWith('สมชาย'))!;
    expect(somchai.netPaid.toString()).toBe('11900');
    const somying = doc.payroll!.lines.find((l) => l.employeeName.startsWith('สมหญิง'))!;
    expect(somying.netPaid.toString()).toBe('18975');
    // header: subtotal = Σ ฐาน, netPayment = Σ สุทธิ
    expect(doc.subtotal.toString()).toBe('30000');
    expect(doc.netPayment?.toString()).toBe('30875');
  });

  it('2. กันซ้ำ: งวดเดียวกัน + สาขาเดียวกัน + ฝั่งเดียวกัน → ปฏิเสธพร้อมเลขเอกสารเดิม', async () => {
    await expect(
      creator.createPayroll(
        {
          branchId,
          documentDate: '2099-01-20',
          payrollPeriod: '2099-01',
          entityScope: 'SHOP',
          depositAccountCode: 'S11-1202',
          lines: [{ employeeName: 'ใครก็ได้ ซ้ำงวด', baseSalary: 1000 }],
        } as never,
        OWNER_USER(),
      ),
    ).rejects.toThrow(/มีใบเงินเดือนงวด 2099-01/);
  });

  it('3. กันบัญชีจ่ายผิดฝั่ง: SHOP doc + บัญชี FINANCE 11-1101 → ปฏิเสธ', async () => {
    await expect(
      creator.createPayroll(
        {
          branchId,
          documentDate: '2099-02-15',
          payrollPeriod: '2099-02',
          entityScope: 'SHOP',
          depositAccountCode: '11-1101',
          lines: [{ employeeName: 'ทดสอบ ผิดบัญชี', baseSalary: 1000 }],
        } as never,
        OWNER_USER(),
      ),
    ).rejects.toThrow(/S11-XXXX/);
  });

  it('4. V19: รหัสรายการหักไม่มีในผังบัญชี → ปฏิเสธตอนสร้าง (ไม่ระเบิดตอน post)', async () => {
    await expect(
      creator.createPayroll(
        {
          branchId,
          documentDate: '2099-02-15',
          payrollPeriod: '2099-02',
          entityScope: 'SHOP',
          depositAccountCode: 'S11-1202',
          lines: [
            {
              employeeName: 'ทดสอบ รหัสมั่ว',
              baseSalary: 1000,
              customDeduction: [{ accountCode: 'S99-9999', name: 'มั่ว', amount: 10 }],
            },
          ],
        } as never,
        OWNER_USER(),
      ),
    ).rejects.toThrow(/V19/);
  });

  it('5. POST → JE ถูกฝั่ง ถูกบัญชี ถูกยอด และ balanced (Dr = Cr = 34,475)', async () => {
    const { entryNo } = await payrollTemplate.execute(shopDocId);
    expect(entryNo).toMatch(/^JE-/);

    const doc = await prisma.expenseDocument.findUniqueOrThrow({
      where: { id: shopDocId },
      select: { status: true, journalEntryId: true },
    });
    expect(doc.status).toBe('POSTED');

    const je = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: doc.journalEntryId! },
      include: { lines: true },
    });
    expect(je.status).toBe('POSTED');
    expect(je.companyId).toBe(shopCompanyId); // ← B2 fix: code S + companyId SHOP ตรงกัน

    const byCode = new Map(je.lines.map((l) => [l.accountCode, l]));
    expect(byCode.get('S52-1201')?.debit.toString()).toBe('30000');
    expect(byCode.get('S52-1205')?.debit.toString()).toBe('1475');
    expect(byCode.get('S52-1202')?.debit.toString()).toBe('1000'); // OT — ไม่ใช่ 53-1105 ค่าอบรม (B1 fix)
    expect(byCode.get('S52-1204')?.debit.toString()).toBe('2000'); // โบนัส
    expect(byCode.get('S21-3101')?.credit.toString()).toBe('150');
    expect(byCode.get('S21-3105')?.credit.toString()).toBe('1475');
    expect(byCode.get('S21-3106')?.credit.toString()).toBe('1475');
    expect(byCode.get('S21-1103')?.credit.toString()).toBe('500');
    expect(byCode.get('S11-1202')?.credit.toString()).toBe('30875');

    // ทุกรหัสต้องอยู่ผัง SHOP (ขึ้นต้น S) — ห้ามข้ามสมุด
    expect(je.lines.every((l) => l.accountCode.startsWith('S'))).toBe(true);

    const sumDr = je.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const sumCr = je.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(sumDr.toString()).toBe('34475');
    expect(sumCr.toString()).toBe(sumDr.toString());

    const md = je.metadata as { flow?: string; idempotencyKey?: string; entityScope?: string };
    expect(md.flow).toBe('expense-payroll');
    expect(md.idempotencyKey).toBe(`expense-payroll:${shopDocId}`);
    expect(md.entityScope).toBe('SHOP');
  });

  it('6. B2 fix: TB scope=SHOP เห็นเงินเดือน / scope=FINANCE ไม่เห็น', async () => {
    const asOf = new Date('2099-12-31');
    const flatRows = (tb: { sections: Array<{ rows: Array<{ code: string }> }> }) =>
      tb.sections.flatMap((s) => s.rows);

    const tbShop = await glReport.getTrialBalance(asOf, 'SHOP');
    const shopRow = flatRows(tbShop).find((r) => r.code === 'S52-1201');
    expect(shopRow).toBeDefined();
    // มียอด movement ฝั่ง Dr อย่างน้อย 30,000 (จาก JE ของ spec นี้)
    expect(JSON.stringify(shopRow)).toContain('30000');

    const tbFinance = await glReport.getTrialBalance(asOf, 'FINANCE');
    // ผัง FINANCE ไม่มีรหัส S — บรรทัดเงินเดือน SHOP ห้ามรั่วเข้ารายงาน FINANCE
    expect(flatRows(tbFinance).find((r) => r.code.startsWith('S'))).toBeUndefined();
  });

  it('7. ภ.ง.ด.1 งวด 2099-01: ครบทุกคน (รวมคนภาษี 0) + gross รวม OT/โบนัส', async () => {
    const result = await taxPreview.previewPND1(shopCompanyId, 2099, 1);
    const ours = result.items.filter((i) => i.employeeName.includes('ทดสอบเงินเดือน'));
    expect(ours).toHaveLength(2);

    const somchai = ours.find((i) => i.employeeName.startsWith('สมชาย'))!;
    expect(somchai.whtAmount.toString()).toBe('0'); // คนภาษี 0 ต้องปรากฏ
    expect(somchai.gross.toString()).toBe('13000'); // 12,000 + OT 1,000

    const somying = ours.find((i) => i.employeeName.startsWith('สมหญิง'))!;
    expect(somying.gross.toString()).toBe('20000'); // 18,000 + โบนัส 2,000
    expect(somying.whtAmount.toString()).toBe('150');
  });

  it('8. FINANCE scope (ส่วนกลาง): ผังเดิม 53-1101 แต่ companyId = FINANCE (B2 fix)', async () => {
    const doc = await creator.createPayroll(
      {
        branchId,
        documentDate: '2099-03-15',
        payrollPeriod: '2099-03',
        entityScope: 'FINANCE',
        depositAccountCode: '11-1101',
        lines: [
          { employeeName: 'สมศรี ส่วนกลางทดสอบ', baseSalary: 20000, ssoEmployee: 875, whtAmount: 300 },
        ],
      } as never,
      OWNER_USER(),
    );
    createdDocIds.push(doc.id);

    await payrollTemplate.execute(doc.id);
    const posted = await prisma.expenseDocument.findUniqueOrThrow({
      where: { id: doc.id },
      select: { journalEntryId: true },
    });
    const je = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: posted.journalEntryId! },
      include: { lines: true },
    });
    expect(je.companyId).toBe(financeCompanyId);
    const codes = je.lines.map((l) => l.accountCode);
    expect(codes).toContain('53-1101');
    expect(codes.every((c) => !c.startsWith('S'))).toBe(true);

    // ภ.ง.ด.1 ยื่นรวมนิติบุคคลเดียว (review fix): เลือกบริษัท FINANCE (ไม่มี
    // branch) ต้องเห็นพนักงานส่วนกลางคนนี้ ไม่ใช่รายงานว่าง
    const pnd1 = await taxPreview.previewPND1(financeCompanyId, 2099, 3);
    const somsri = pnd1.items.find((i) => i.employeeName.startsWith('สมศรี'));
    expect(somsri).toBeDefined();
    expect(somsri!.whtAmount.toString()).toBe('300');
  });

  it('9. สปส.1-10 preview: เฉพาะคน SSO > 0 + แยกยอด per scope', async () => {
    const sso = await taxPreview.previewSso110(2099, 1);
    const ours = sso.items.filter((i) => i.employeeName.includes('ทดสอบเงินเดือน'));
    expect(ours).toHaveLength(2);
    const somchai = ours.find((i) => i.employeeName.startsWith('สมชาย'))!;
    expect(somchai.ssoEmployee.toString()).toBe('600');
    expect(somchai.ssoEmployer.toString()).toBe('600');
    expect(somchai.scope).toBe('SHOP');
    // งวด 2099-01 มีแต่ SHOP → ฝั่ง SHOP = 600+875 = 1,475 ต่อข้าง
    expect(sso.perScope.shop.employeeTotal.toString()).toBe('1475');
    expect(sso.perScope.shop.grandTotal.toString()).toBe('2950');
  });

  it('10. ภ.ง.ด.1ก annual: รวมทั้งปีต่อคน (ฐาน+รายได้พิเศษที่เสียภาษี)', async () => {
    const annual = await taxPreview.previewPnd1Annual(2099);
    const ours = annual.items.filter((i) => i.employeeName.includes('ทดสอบ'));
    // สมชาย + สมหญิง (2099-01) + สมศรี (2099-03) + คนจากใบแก้ไข (ยัง DRAFT — ไม่นับ)
    const somying = ours.find((i) => i.employeeName.startsWith('สมหญิง'))!;
    expect(somying.grossTotal.toString()).toBe('20000'); // 18,000 + โบนัส 2,000
    expect(somying.whtTotal.toString()).toBe('150');
    expect(somying.monthsPaid).toBe(1);
  });

  it('11. นำส่ง ปกส. ฝั่ง SHOP งวด 2099-01 → GL S21-3105/S21-3106 เหลือ 0 + กันนำส่งซ้ำ', async () => {
    const result = await remitTemplate.executeSso({
      scope: 'SHOP',
      period: '2099-01',
      depositAccountCode: 'S11-1202',
    });
    remitJeEntryNos.push(result.entryNo);
    expect(result.amountPerSide).toBe('1475.00');
    expect(result.total).toBe('2950.00');

    const glBalance = async (accountCode: string, companyId: string) => {
      const agg = await prisma.journalLine.aggregate({
        where: {
          accountCode,
          deletedAt: null,
          journalEntry: { status: 'POSTED', deletedAt: null, companyId },
        },
        _sum: { credit: true, debit: true },
      });
      return new Decimal((agg._sum.credit ?? 0).toString()).minus(
        (agg._sum.debit ?? 0).toString(),
      );
    };
    expect((await glBalance('S21-3105', shopCompanyId)).toString()).toBe('0');
    expect((await glBalance('S21-3106', shopCompanyId)).toString()).toBe('0');

    // นำส่งซ้ำงวดเดิม → ปฏิเสธ
    await expect(
      remitTemplate.executeSso({
        scope: 'SHOP',
        period: '2099-01',
        depositAccountCode: 'S11-1202',
      }),
    ).rejects.toThrow(/นำส่งไปแล้ว/);
  });

  it('12. นำส่ง ภ.ง.ด.1 ฝั่ง SHOP งวด 2099-01 → GL S21-3101 เหลือ 0', async () => {
    const result = await remitTemplate.executePnd1({
      scope: 'SHOP',
      period: '2099-01',
      depositAccountCode: 'S11-1202',
    });
    remitJeEntryNos.push(result.entryNo);
    expect(result.total).toBe('150.00');

    const agg = await prisma.journalLine.aggregate({
      where: {
        accountCode: 'S21-3101',
        deletedAt: null,
        journalEntry: { status: 'POSTED', deletedAt: null, companyId: shopCompanyId },
      },
      _sum: { credit: true, debit: true },
    });
    const balance = new Decimal((agg._sum.credit ?? 0).toString()).minus(
      (agg._sum.debit ?? 0).toString(),
    );
    expect(balance.toString()).toBe('0');
  });

  it('13. แก้ไขร่าง (R3-2): เปลี่ยนพนักงาน + ยอด → totals ใหม่ถูก และงวดเดิมของตัวเองไม่ชน dup guard', async () => {
    const draft = await creator.createPayroll(
      {
        branchId,
        documentDate: '2099-04-15',
        payrollPeriod: '2099-04',
        entityScope: 'SHOP',
        depositAccountCode: 'S11-1202',
        lines: [{ employeeName: 'คนแรก ก่อนแก้', baseSalary: 9000 }],
      } as never,
      OWNER_USER(),
    );
    createdDocIds.push(draft.id);

    const updated = await creator.updatePayroll(
      draft.id,
      {
        documentDate: '2099-04-20',
        payrollPeriod: '2099-04', // งวดเดิม — ต้องไม่ชนกับตัวเอง
        entityScope: 'SHOP',
        depositAccountCode: 'S11-1202',
        lines: [
          { employeeName: 'คนแรก หลังแก้', baseSalary: 9500, ssoEmployee: 475 },
          { employeeName: 'คนที่สอง เพิ่มใหม่', baseSalary: 11000, ssoEmployee: 550 },
        ],
      } as never,
      OWNER_USER(),
    );

    expect(updated.subtotal.toString()).toBe('20500');
    expect(updated.netPayment?.toString()).toBe('19475'); // 9,025 + 10,450
    expect(updated.payroll?.lines).toHaveLength(2);
    expect(
      updated.payroll?.lines.find((l) => l.employeeName === 'คนแรก ก่อนแก้'),
    ).toBeUndefined();
  });

  it('14. ไฟล์โอนธนาคาร (R3-3): แถว free-text ไม่มีเลขบัญชี → ข้ามพร้อมนับ', async () => {
    const { csv, skipped } = await queryService.buildPayrollBankCsv(shopDocId, 'OWNER', null);
    // พนักงานในสถานการณ์สมมุติเป็น free-text (ไม่มี userId) → ถูกข้ามทั้งคู่
    expect(skipped).toHaveLength(2);
    expect(csv).toContain('ลำดับ,ชื่อพนักงาน,ธนาคาร,เลขบัญชี,จำนวนเงิน');
  });
});
