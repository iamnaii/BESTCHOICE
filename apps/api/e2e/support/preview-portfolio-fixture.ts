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
  // COMPLETED + CLOSED_BAD_DEBT มีไว้ให้ชิป "ปิดแล้ว" / "หนี้สูญ" และ KPI ของหน้า
  // /customers มองเห็นได้จริงบน preview — ก่อนหน้านี้ฐานข้อมูล preview มีแต่ ACTIVE/OVERDUE
  // ⇒ เจ้าของเปิดดูแล้วไม่มีทางเห็นสองสถานะนั้น และเราก็ยืนยันไม่ได้ว่าทำงาน
  for (const status of ['ACTIVE', 'OVERDUE', 'COMPLETED', 'CLOSED_BAD_DEBT'] as const) {
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
        warrantyExpireDate: new Date(Date.now() + 200 * 86400000),
      } });
      await tx.contract.create({ data: {
        contractNumber, customerId: customer.id, productId: product.id,
        branchId: branch.id, salespersonId, planType: 'STORE_DIRECT',
        sellingPrice: 2000, downPayment: 0, financedAmount: 2000,
        interestRate: 0, interestTotal: 0, monthlyPayment: 1000, totalMonths: 2, status,
        notes: 'ข้อมูลจำลองสำหรับตรวจหน้าจอ Local เท่านั้น',
        payments: { create: [
          { installmentNo: 1, amountDue: 1000,
            amountPaid: status === 'OVERDUE' ? 250 : status === 'CLOSED_BAD_DEBT' ? 0 : 1000,
            status: status === 'OVERDUE' ? 'PARTIALLY_PAID' : status === 'CLOSED_BAD_DEBT' ? 'OVERDUE' : 'PAID',
            dueDate: new Date(Date.now() - 10 * 86400000) },
          { installmentNo: 2, amountDue: 1000,
            amountPaid: status === 'COMPLETED' ? 1000 : 0,
            status: status === 'COMPLETED' ? 'PAID' : 'PENDING',
            dueDate: new Date(Date.now() + 30 * 86400000) },
        ] },
      } });
    });
  }
}
