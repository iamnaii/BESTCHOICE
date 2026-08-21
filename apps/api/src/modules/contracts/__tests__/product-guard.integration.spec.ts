/**
 * Phase 5 Task 2 — เปิดสัญญา (activate) ต้องไม่รับสินค้าที่ถูก soft-delete
 *
 * ช่องโหว่ที่ปิด: `product.status` กับ `product.deletedAt` เป็นคนละมิติกัน — เครื่องที่ถูก
 * ลบทิ้ง (deletedAt ≠ null) ยังคงค้างสถานะ RESERVED/IN_STOCK ไว้ได้ ดังนั้น lookup แบบ
 * `findUnique({ where: { id } })` ที่เช็คแค่สถานะ จึงปล่อยให้เปิดสัญญาบนเครื่องที่ถูกลบไปแล้ว
 * ผลคือ IMEI หลุดจาก partial unique index (`WHERE deleted_at IS NULL`) → รับเครื่องเดิม
 * เข้าสต็อกซ้ำแล้วขาย/จัดไฟแนนซ์ซ้ำได้ ทั้งที่สัญญาแรกยังเดินอยู่
 *
 * เส้นทางเปลี่ยนเครื่อง (PRICED) ใช้ `activate()` ตัวเดียวกันเป็นประตูเข้า
 * `finalizeAfterActivation` — guard เดียวกันจึงกันทั้ง "เปิดสัญญาปกติ" และ "finalize
 * เปลี่ยนเครื่อง" ในจุดเดียว (finalize ไม่มี caller อื่นในระบบ)
 *
 * Runner: vitest (DB-backed — jest ignore *.integration.spec.ts). รัน:
 *   cd apps/api && npx vitest run --no-file-parallelism \
 *     src/modules/contracts/__tests__/product-guard.integration.spec.ts
 *
 * CI: ครอบด้วย glob `CONTRACTS_FILES` ใน deploy-gcp.yml อยู่แล้ว
 * (`src/modules/contracts/__tests__/*.integration.spec.ts`)
 *
 * Deps ของ `ContractWorkflowService` ส่วนใหญ่ผ่านเป็น null โดยตั้งใจ — guard ที่ทดสอบอยู่
 * ก่อนจุดที่ dependency ตัวใดถูกแตะ (ยกเว้นเทสควบคุมที่จงใจให้พังหลังผ่าน guard)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ContractWorkflowService } from '../contract-workflow.service';

const prisma = new PrismaClient();

const service = new ContractWorkflowService(
  prisma as never,
  null as never, // notificationsService — ไม่ถูกเรียกก่อน guard
  null as never, // journalAutoService
  null as never, // contractActivation1ATemplate
  null as never, // productsService
  null as never, // contractExchangeService
  null as never, // shopInventoryTransferTemplate
  null as never, // shopDownPaymentTemplate
  null as never, // shopAccountResolver
);

const dec = (s: string) => new Decimal(s);

const RUN = Date.now().toString(36);
const RUN_NUM = String(Date.now() % 1_000_000).padStart(6, '0');

const createdContractIds: string[] = [];
const createdProductIds: string[] = [];
const createdCustomerIds: string[] = [];
let createdBranchId: string | null = null;

let adminId: string;
let shopId: string;
let branchId: string;

const PRODUCT_GUARD_MSG = 'สินค้าไม่พร้อมสำหรับเปิดสัญญา';

async function ensureCompany(code: 'SHOP' | 'FINANCE'): Promise<string> {
  const existing = await prisma.companyInfo.findFirst({
    where: { companyCode: code, deletedAt: null },
  });
  if (existing) return existing.id;
  const created = await prisma.companyInfo.create({
    data: {
      nameTh: code === 'SHOP' ? 'BESTCHOICE SHOP' : 'BESTCHOICE FINANCE',
      taxId: code === 'SHOP' ? '0000000000001' : '0000000000002',
      companyCode: code,
      address: '1 Test Rd.',
      directorName: 'Test Director',
      vatRegistered: code === 'FINANCE',
      vatRate: dec('0.0700'),
    },
  });
  return created.id;
}

/**
 * สัญญา DRAFT ที่ผ่านด่านก่อนหน้า guard สินค้าครบ: workflowStatus APPROVED +
 * PDPA consent + ลายเซ็นครบ 4 (ลูกค้า/บริษัท/พยาน 2). `contractHash` เป็น null
 * ⇒ `verifyContractHash` ข้าม (legacy path)
 */
async function seedSignedDraftContract(
  seq: number,
  opts: { productDeleted: boolean; exchangedFromContractId?: string },
): Promise<{ contractId: string; productId: string }> {
  const tag = `${RUN}-${seq}`;
  const customer = await prisma.customer.create({
    data: {
      name: `__PRODGUARD_${tag}__`,
      phone: `095${RUN_NUM}${seq}`,
      nationalId: `PRODGUARD-${tag}`,
    },
  });
  createdCustomerIds.push(customer.id);

  const consent = await prisma.pDPAConsent.create({
    data: {
      customerId: customer.id,
      consentVersion: '1.0',
      privacyNoticeText: 'test',
      status: 'GRANTED',
      grantedAt: new Date(),
    },
  });

  const product = await prisma.product.create({
    data: {
      name: `ProdGuard Phone ${tag}`,
      brand: 'ProdGuardBrand',
      model: `ProdGuardModel-${tag}`,
      storage: '128GB',
      imeiSerial: `PRODGUARD-${tag}`,
      category: 'PHONE_NEW',
      costPrice: dec('6000.00'),
      installmentPrice: dec('12000.00'),
      branchId,
      // จุดสำคัญของบั๊ก: สถานะยัง RESERVED (พร้อมเปิดสัญญาในสายตา guard เดิม)
      // แต่แถวถูก soft-delete ไปแล้ว
      status: 'RESERVED',
      ownedByCompanyId: shopId,
      ...(opts.productDeleted ? { deletedAt: new Date() } : {}),
    },
  });
  createdProductIds.push(product.id);

  const contract = await prisma.contract.create({
    data: {
      contractNumber: `PRODGUARD-${tag}`,
      customerId: customer.id,
      productId: product.id,
      branchId,
      salespersonId: adminId,
      pdpaConsentId: consent.id,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: dec('12000.00'),
      downPayment: dec('2000.00'),
      financedAmount: dec('10000.00'),
      interestRate: dec('0.0500'),
      totalMonths: 12,
      interestTotal: dec('6000.00'),
      storeCommission: dec('1000.00'),
      vatAmount: dec('1190.00'),
      vatPct: dec('0.0700'),
      monthlyPayment: dec('1515.83'),
      status: 'DRAFT',
      workflowStatus: 'APPROVED',
      ...(opts.exchangedFromContractId
        ? { exchangedFromContractId: opts.exchangedFromContractId }
        : {}),
    },
  });
  createdContractIds.push(contract.id);

  for (const signerType of ['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2'] as const) {
    await prisma.signature.create({
      data: { contractId: contract.id, signerType, signatureImage: 'data:image/png;base64,AA==' },
    });
  }

  return { contractId: contract.id, productId: product.id };
}

describe('activate() — guard สินค้าที่ถูกลบ (Phase 5 Task 2)', () => {
  beforeAll(async () => {
    shopId = await ensureCompany('SHOP');
    await ensureCompany('FINANCE');

    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    adminId = admin.id;

    const existingBranch = await prisma.branch.findFirst({
      where: { name: '__prodguard_test_branch__', deletedAt: null },
    });
    if (existingBranch) {
      branchId = existingBranch.id;
    } else {
      const branch = await prisma.branch.create({
        data: { name: '__prodguard_test_branch__', companyId: shopId },
      });
      branchId = branch.id;
      createdBranchId = branch.id;
    }
  }, 120_000);

  afterAll(async () => {
    await prisma.signature.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
    await prisma.pDPAConsent.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    if (createdBranchId) await prisma.branch.deleteMany({ where: { id: createdBranchId } });
    await prisma.$disconnect();
  }, 60_000);

  it('เปิดสัญญาไม่ได้ถ้าสินค้าถูกลบไปแล้ว (deletedAt ≠ null) แม้สถานะยัง RESERVED', async () => {
    const { contractId } = await seedSignedDraftContract(1, { productDeleted: true });

    await expect(service.activate(contractId)).rejects.toThrow(PRODUCT_GUARD_MSG);

    // สัญญาต้องยังเป็น DRAFT — ไม่มีอะไรถูก commit
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(after.status).toBe('DRAFT');
  }, 60_000);

  it('finalize เปลี่ยนเครื่องไม่ได้ถ้าเครื่องใหม่ถูกลบ (activate คือประตูเข้า finalize)', async () => {
    const old = await seedSignedDraftContract(2, { productDeleted: false });
    // สัญญาเดิมของ swap — เพียงต้องมีอยู่จริงเพื่อผูก exchangedFromContractId
    await prisma.contract.update({ where: { id: old.contractId }, data: { status: 'ACTIVE' } });

    const swap = await seedSignedDraftContract(3, {
      productDeleted: true,
      exchangedFromContractId: old.contractId,
    });

    await expect(service.activate(swap.contractId)).rejects.toThrow(PRODUCT_GUARD_MSG);

    // finalizeAfterActivation ไม่เคยถูกเรียก (contractExchangeService = null
    // ⇒ ถ้าหลุด guard จะพังเป็น TypeError คนละข้อความ) และสัญญาเดิมไม่ถูกแตะ
    const oldAfter = await prisma.contract.findUniqueOrThrow({ where: { id: old.contractId } });
    expect(oldAfter.status).toBe('ACTIVE');
    const swapAfter = await prisma.contract.findUniqueOrThrow({ where: { id: swap.contractId } });
    expect(swapAfter.status).toBe('DRAFT');
  }, 60_000);

  it('เช็คซ้ำใน transaction: สินค้าถูกลบหลังผ่านด่านแรก → ยังเปิดสัญญาไม่ได้ (race window)', async () => {
    const { contractId, productId } = await seedSignedDraftContract(4, { productDeleted: false });

    // `companyInfo.findFirst` ถูกเรียก 2 ครั้ง (FINANCE แล้ว SHOP) ระหว่างด่านแรกกับการเปิด
    // transaction — แทรกการลบเครื่องตรงกลางเพื่อจำลอง race แล้วให้ด่านใน tx เป็นคนจับ
    const orig = prisma.companyInfo.findFirst.bind(prisma.companyInfo);
    let hits = 0;
    const spy = vi
      .spyOn(prisma.companyInfo, 'findFirst')
      .mockImplementation((async (args: never) => {
        hits += 1;
        if (hits === 2) {
          await prisma.product.update({
            where: { id: productId },
            data: { deletedAt: new Date() },
          });
        }
        return orig(args);
      }) as never);

    try {
      await expect(service.activate(contractId)).rejects.toThrow(PRODUCT_GUARD_MSG);
      expect(hits).toBe(2);
    } finally {
      spy.mockRestore();
    }

    const after = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(after.status).toBe('DRAFT');
  }, 60_000);

  it('ไม่ over-block: สินค้าปกติ (RESERVED, ยังไม่ถูกลบ) ผ่านด่านสินค้าไปต่อได้', async () => {
    const { contractId } = await seedSignedDraftContract(5, { productDeleted: false });

    // deps ตัวถัดไปเป็น null ⇒ ต้องพังแน่ แต่ต้อง **ไม่ใช่** ข้อความของด่านสินค้า
    await expect(service.activate(contractId)).rejects.toThrow();
    await expect(service.activate(contractId)).rejects.not.toThrow(PRODUCT_GUARD_MSG);

    // transaction ต้อง rollback ครบ — สัญญายัง DRAFT
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(after.status).toBe('DRAFT');
  }, 60_000);
});
