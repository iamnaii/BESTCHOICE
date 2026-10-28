import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { TaxPreviewService } from '../../tax/services/tax-preview.service';

/**
 * D4 ส่วนที่ 2 (Task 5) — ฐาน ภ.ง.ด.1 หักคืนค่าคอม (COMMISSION_CLAWBACK) แล้ว · รายการหักมือไม่กระทบฐาน
 * ใช้ปี 2098 + เลขผู้เสียภาษีเฉพาะ spec นี้ (previewPnd1Annual รวมทั้งบริษัท)
 */

const prisma = new PrismaClient();
const taxPreview = new TaxPreviewService(prisma as never);
const YEAR = 2098;
const TAX_CLAW = '9800000000011';
const TAX_PLAIN = '9800000000022';
const stamp = Date.now();
let branchId: string;
let shopCompanyId: string;
let ownerId: string;
const docIds: string[] = [];

async function seedDoc(n: number, month: string, lines: Array<{ name: string; taxId: string; income?: number[]; deductions?: Array<{ amount: number; source: 'MANUAL' | 'COMMISSION_CLAWBACK' }> }>) {
  const doc = await prisma.expenseDocument.create({
    data: {
      number: `PR-TAXBASE-${stamp}-${n}`,
      documentType: 'PAYROLL',
      branchId,
      documentDate: new Date(`${YEAR}-${month}-28T00:00:00.000Z`),
      subtotal: 0,
      vatAmount: 0,
      withholdingTax: 0,
      totalAmount: 0,
      netPayment: 0,
      depositAccountCode: 'S11-1202',
      status: 'POSTED',
      journalEntryId: `je-taxbase-${stamp}-${n}`,
      createdById: ownerId,
      payroll: {
        create: {
          payrollPeriod: `${YEAR}-${month}`,
          entityScope: 'SHOP',
          lines: {
            create: lines.map((l, i) => ({
              employeeName: l.name,
              employeeTaxId: l.taxId,
              baseSalary: 15000,
              netPaid: 0,
              lineNo: i + 1,
              customIncome: {
                create: (l.income ?? []).map((a) => ({ accountCode: 'S51-1101', name: 'ค่าคอม', amount: a, isTaxable: true, source: 'COMMISSION' as const })),
              },
              customDeduction: {
                create: (l.deductions ?? []).map((d) => ({ accountCode: 'S51-1101', name: 'หัก', amount: d.amount, source: d.source })),
              },
            })),
          },
        },
      },
    },
    select: { id: true },
  });
  docIds.push(doc.id);
}

beforeAll(async () => {
  const owner = await prisma.user.upsert({
    where: { email: 'admin@bestchoice.com' },
    create: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    update: {},
    select: { id: true },
  });
  ownerId = owner.id;
  shopCompanyId = await new CompanyResolverService(prisma as never).getShopCompanyId();
  const branch = await prisma.branch.create({ data: { name: `__TAXBASE_BRANCH_${stamp}__`, companyId: shopCompanyId } });
  branchId = branch.id;

  await seedDoc(1, '03', [
    {
      name: 'พนง ทดสอบหักคืน',
      taxId: TAX_CLAW,
      income: [1000],
      deductions: [
        { amount: 1000, source: 'COMMISSION_CLAWBACK' },
        { amount: 300, source: 'MANUAL' },
      ],
    },
    { name: 'พนง ทดสอบปกติ', taxId: TAX_PLAIN, income: [1000], deductions: [{ amount: 300, source: 'MANUAL' }] },
  ]);
}, 120_000);

afterAll(async () => {
  if (docIds.length > 0) {
    await prisma.$executeRawUnsafe(`DELETE FROM expense_documents WHERE id IN (${docIds.map((id) => `'${id}'`).join(',')})`);
  }
  try {
    await prisma.branch.delete({ where: { id: branchId } });
  } catch {
    // referenced elsewhere
  }
  await prisma.$disconnect();
}, 120_000);

describe('ฐานภาษี ภ.ง.ด.1 สุทธิจากหักคืนค่าคอม', () => {
  it('previewPND1 (WHT): gross หักคืนแล้ว · แถวไม่มีหักคืนเท่าเดิม', async () => {
    const r = await taxPreview.previewPND1(shopCompanyId, YEAR, 3);
    const claw = r.items.find((i) => i.employeeTaxId === TAX_CLAW)!;
    const plain = r.items.find((i) => i.employeeTaxId === TAX_PLAIN)!;
    expect(claw.gross.toFixed(2)).toBe('15000.00');
    expect(plain.gross.toFixed(2)).toBe('16000.00');
  });

  it('previewPnd1Annual: grossTotal เท่ากัน', async () => {
    const r = await taxPreview.previewPnd1Annual(YEAR);
    const claw = r.items.find((e) => e.employeeTaxId === TAX_CLAW)!;
    const plain = r.items.find((e) => e.employeeTaxId === TAX_PLAIN)!;
    expect(claw.grossTotal.toFixed(2)).toBe('15000.00');
    expect(plain.grossTotal.toFixed(2)).toBe('16000.00');
  });
});
