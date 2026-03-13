/**
 * Demo seed: สร้างข้อมูลตัวอย่างสำหรับ DEMO LINE OA
 * รัน: npx tsx prisma/seed-demo.ts
 *
 * สร้าง:
 * - ลูกค้า 3 คน (มี lineId, ไม่มี lineId, หลายสัญญา)
 * - สัญญา 5 ฉบับ (ACTIVE x2, OVERDUE x1, DEFAULT x1, COMPLETED x1)
 * - งวดชำระแต่ละสัญญา
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Creating DEMO data for LINE OA ===');

  // ── ตรวจสอบข้อมูลที่ต้องใช้ ──
  const branchResult = await prisma.branch.findFirst({ where: { isActive: true } });
  if (!branchResult) throw new Error('ไม่มี branch ในระบบ กรุณารัน seed หลักก่อน');
  const branch = branchResult;

  const salespersonResult = await prisma.user.findFirst({ where: { role: 'SALES', isActive: true } });
  if (!salespersonResult) throw new Error('ไม่มี salesperson ในระบบ');
  const salesperson = salespersonResult;

  const reviewer = await prisma.user.findFirst({ where: { role: { in: ['BRANCH_MANAGER', 'OWNER'] }, isActive: true } });

  console.log(`Using branch: ${branch.name}, salesperson: ${salesperson.name}`);

  // ── ลูกค้า 3 คน ──
  const cust1 = await prisma.customer.upsert({
    where: { nationalId: 'DEMO_LINE_001' },
    update: {},
    create: {
      id: 'demo-cust-001',
      nationalId: 'DEMO_LINE_001',
      prefix: 'นาย',
      name: 'ทดสอบ มีไลน์',
      nickname: 'เทส',
      phone: '0999999901',
      addressIdCard: '123 ถ.ทดสอบ กทม.',
      occupation: 'พนักงานบริษัท',
      salary: 30000,
      birthDate: new Date('1995-01-15'),
      references: [{ prefix: 'นาง', firstName: 'ทดสอบ', lastName: 'แม่', phone: '0888888801', relationship: 'มารดา' }],
    },
  });

  const cust2 = await prisma.customer.upsert({
    where: { nationalId: 'DEMO_LINE_002' },
    update: {},
    create: {
      id: 'demo-cust-002',
      nationalId: 'DEMO_LINE_002',
      prefix: 'นางสาว',
      name: 'สมศรี ยังไม่ผูกไลน์',
      nickname: 'ศรี',
      phone: '0999999902',
      addressIdCard: '456 ถ.ทดสอบ กทม.',
      occupation: 'ค้าขาย',
      salary: 25000,
      birthDate: new Date('1998-06-20'),
      references: [{ prefix: 'นาย', firstName: 'สมชาย', lastName: 'พ่อ', phone: '0888888802', relationship: 'บิดา' }],
    },
  });

  const cust3 = await prisma.customer.upsert({
    where: { nationalId: 'DEMO_LINE_003' },
    update: {},
    create: {
      id: 'demo-cust-003',
      nationalId: 'DEMO_LINE_003',
      prefix: 'นาย',
      name: 'วิชัย หลายสัญญา',
      nickname: 'ชัย',
      phone: '0999999903',
      addressIdCard: '789 ถ.ทดสอบ กทม.',
      occupation: 'รับราชการ',
      salary: 35000,
      birthDate: new Date('1990-03-10'),
      references: [{ prefix: 'นาง', firstName: 'สุดา', lastName: 'ภรรยา', phone: '0888888803', relationship: 'ภรรยา' }],
    },
  });

  console.log(`Customers: ${cust1.name}, ${cust2.name}, ${cust3.name}`);

  // ── สินค้า (ใช้สินค้า IN_STOCK ที่มีอยู่ หรือสร้างใหม่) ──
  const existingProducts = await prisma.product.findMany({
    where: { status: 'IN_STOCK', deletedAt: null },
    take: 5,
  });

  // ถ้าสินค้าไม่พอ สร้างเพิ่ม
  const products: string[] = [];
  for (let i = 0; i < 5; i++) {
    if (existingProducts[i]) {
      products.push(existingProducts[i].id);
    } else {
      const p = await prisma.product.create({
        data: {
          id: `demo-prod-${i + 1}`,
          name: `Demo iPhone ${15 + i} 128GB`,
          brand: 'Apple',
          model: `iPhone ${15 + i}`,
          color: ['Black', 'Blue', 'Pink', 'Gold', 'White'][i],
          storage: '128GB',
          imeiSerial: `DEMO${String(i + 1).padStart(12, '0')}`,
          category: 'PHONE_NEW',
          costPrice: 25000 + i * 5000,
          branchId: branch.id,
          status: 'SOLD_INSTALLMENT',
          stockInDate: new Date(),
        },
      });
      products.push(p.id);
    }
  }

  const now = new Date();

  // ── Helper: สร้างสัญญาพร้อมงวด ──
  async function createContractWithPayments(opts: {
    id: string;
    contractNumber: string;
    customerId: string;
    productId: string;
    sellingPrice: number;
    downPayment: number;
    totalMonths: number;
    interestRate: number;
    status: 'ACTIVE' | 'OVERDUE' | 'DEFAULT' | 'COMPLETED';
    paidCount: number;
    paymentDueDay: number;
    startMonth: number; // months ago the contract started
  }) {
    const financed = opts.sellingPrice - opts.downPayment;
    const interestTotal = Math.round(financed * opts.interestRate * opts.totalMonths);
    const monthly = Math.round((financed + interestTotal) / opts.totalMonths);

    // Check if contract already exists
    const existing = await prisma.contract.findUnique({ where: { id: opts.id } });
    if (existing) {
      console.log(`  Contract ${opts.contractNumber} already exists, skipping`);
      return;
    }

    await prisma.contract.create({
      data: {
        id: opts.id,
        contractNumber: opts.contractNumber,
        customerId: opts.customerId,
        productId: opts.productId,
        branchId: branch.id,
        salespersonId: salesperson.id,
        planType: 'STORE_DIRECT',
        sellingPrice: opts.sellingPrice,
        downPayment: opts.downPayment,
        interestRate: opts.interestRate,
        totalMonths: opts.totalMonths,
        financedAmount: financed,
        interestTotal: interestTotal,
        monthlyPayment: monthly,
        status: opts.status,
        workflowStatus: 'APPROVED',
        reviewedById: reviewer?.id,
        reviewedAt: new Date(now.getFullYear(), now.getMonth() - opts.startMonth, 1),
        paymentDueDay: opts.paymentDueDay,
      },
    });

    // สร้างงวด
    for (let i = 1; i <= opts.totalMonths; i++) {
      const dueDate = new Date(now.getFullYear(), now.getMonth() - opts.startMonth + i, opts.paymentDueDay);
      const isPaid = i <= opts.paidCount;
      const isOverdue = !isPaid && dueDate < now;

      await prisma.payment.create({
        data: {
          contractId: opts.id,
          installmentNo: i,
          dueDate,
          amountDue: monthly,
          amountPaid: isPaid ? monthly : 0,
          paidDate: isPaid ? new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() - 1) : null,
          paymentMethod: isPaid ? 'BANK_TRANSFER' : null,
          lateFee: isOverdue ? Math.min(Math.floor((now.getTime() - dueDate.getTime()) / 86400000) * 100, 200) : 0,
          status: isPaid ? 'PAID' : (isOverdue ? 'OVERDUE' : 'PENDING'),
          recordedById: isPaid ? salesperson.id : null,
        },
      });
    }

    console.log(`  ${opts.contractNumber} (${opts.status}) - ${opts.paidCount}/${opts.totalMonths} paid`);
  }

  // ── สัญญา 1: ลูกค้า 1 — ACTIVE, จ่ายปกติ ──
  await createContractWithPayments({
    id: 'demo-cont-001',
    contractNumber: 'DEMO-2026-0001',
    customerId: cust1.id,
    productId: products[0],
    sellingPrice: 35900,
    downPayment: 5900,
    totalMonths: 10,
    interestRate: 0.08,
    status: 'ACTIVE',
    paidCount: 3,
    paymentDueDay: 15,
    startMonth: 4,
  });

  // ── สัญญา 2: ลูกค้า 2 — ACTIVE ──
  await createContractWithPayments({
    id: 'demo-cont-002',
    contractNumber: 'DEMO-2026-0002',
    customerId: cust2.id,
    productId: products[1],
    sellingPrice: 19900,
    downPayment: 3900,
    totalMonths: 6,
    interestRate: 0.10,
    status: 'ACTIVE',
    paidCount: 2,
    paymentDueDay: 1,
    startMonth: 3,
  });

  // ── สัญญา 3: ลูกค้า 3 — OVERDUE, มีค้างชำระ ──
  await createContractWithPayments({
    id: 'demo-cont-003',
    contractNumber: 'DEMO-2026-0003',
    customerId: cust3.id,
    productId: products[2],
    sellingPrice: 29900,
    downPayment: 4900,
    totalMonths: 8,
    interestRate: 0.08,
    status: 'OVERDUE',
    paidCount: 2,
    paymentDueDay: 10,
    startMonth: 5,
  });

  // ── สัญญา 4: ลูกค้า 3 — ACTIVE (สัญญาที่ 2 ของ ลูกค้า 3 — เพื่อ demo multi-contract) ──
  await createContractWithPayments({
    id: 'demo-cont-004',
    contractNumber: 'DEMO-2026-0004',
    customerId: cust3.id,
    productId: products[3],
    sellingPrice: 15900,
    downPayment: 2900,
    totalMonths: 6,
    interestRate: 0.10,
    status: 'ACTIVE',
    paidCount: 1,
    paymentDueDay: 10,
    startMonth: 2,
  });

  // ── สัญญา 5: ลูกค้า 1 — COMPLETED ──
  await createContractWithPayments({
    id: 'demo-cont-005',
    contractNumber: 'DEMO-2025-0001',
    customerId: cust1.id,
    productId: products[4],
    sellingPrice: 12900,
    downPayment: 2900,
    totalMonths: 6,
    interestRate: 0.10,
    status: 'COMPLETED',
    paidCount: 6,
    paymentDueDay: 20,
    startMonth: 8,
  });

  console.log('\n=== DEMO data created! ===');
  console.log('');
  console.log('ลูกค้าสำหรับทดสอบ LINE OA:');
  console.log(`  1. ${cust1.name} (${cust1.phone}) — 2 สัญญา (ACTIVE + COMPLETED)`);
  console.log(`  2. ${cust2.name} (${cust2.phone}) — 1 สัญญา (ACTIVE)`);
  console.log(`  3. ${cust3.name} (${cust3.phone}) — 2 สัญญา (OVERDUE + ACTIVE) ← multi-contract demo`);
  console.log('');
  console.log('วิธีทดสอบ LINE OA:');
  console.log('  1. เพิ่ม Bot เป็นเพื่อน');
  console.log('  2. พิมพ์เบอร์โทรลูกค้า เช่น 0999999901 เพื่อผูก LINE');
  console.log('  3. พิมพ์ "เช็คยอด" "งวด" "ชำระ" "ใบเสร็จ" "ติดต่อ"');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
