import { PrismaService } from '../../src/prisma/prisma.service';

/** Synthetic report rows only; called after the preview's isolated-database guard. */
export async function seedPreviewPortfolio(db: PrismaService, salespersonId: string) {
  const finance = await db.companyInfo.upsert({
    where: { companyCode: 'FINANCE' },
    update: {},
    create: {
      companyCode: 'FINANCE', nameTh: 'FINANCE ตัวอย่าง Local', taxId: '0000000000000',
      address: 'ข้อมูลทดสอบระบบ — ลบได้', directorName: 'ผู้ทดสอบ Local',
    },
  });
  const branch = await db.branch.findFirstOrThrow({ where: { name: 'LOCAL PREVIEW BRANCH' } });
  for (const status of ['ACTIVE', 'OVERDUE'] as const) {
    const contractNumber = `TEST-LOCAL-PORTFOLIO-${status}`;
    // Keep manual edits and payments when the preview restarts.
    if (await db.contract.findUnique({ where: { contractNumber } })) continue;
    await db.$transaction(async tx => {
      const customer = await tx.customer.create({ data: {
        name: `ลูกค้าพอร์ตตัวอย่าง ${status}`, phone: '0000000000',
      } });
      const product = await tx.product.create({ data: {
        name: 'โทรศัพท์ตัวอย่างพอร์ต Local', brand: 'Apple', model: 'iPhone 15',
        category: 'PHONE_NEW', costPrice: 1500, cashPrice: 2000, installmentPrice: 2000,
        branchId: branch.id, ownedByCompanyId: finance.id, status: 'SOLD_INSTALLMENT',
      } });
      await tx.contract.create({ data: {
        contractNumber, customerId: customer.id, productId: product.id,
        branchId: branch.id, salespersonId, planType: 'STORE_DIRECT',
        sellingPrice: 2000, downPayment: 0, financedAmount: 2000,
        interestRate: 0, interestTotal: 0, monthlyPayment: 1000, totalMonths: 2, status,
        notes: 'ข้อมูลจำลองสำหรับตรวจหน้าจอ Local เท่านั้น',
        payments: { create: [
          { installmentNo: 1, amountDue: 1000, amountPaid: status === 'ACTIVE' ? 1000 : 250,
            status: status === 'ACTIVE' ? 'PAID' : 'PARTIALLY_PAID',
            dueDate: new Date(Date.now() - 10 * 86400000) },
          { installmentNo: 2, amountDue: 1000, amountPaid: 0, status: 'PENDING',
            dueDate: new Date(Date.now() + 30 * 86400000) },
        ] },
      } });
    });
  }
}
