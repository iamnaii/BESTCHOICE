import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';
import { cleanupTestContracts } from '../cleanup-test-contracts.cli';
import {
  TEST_CONTRACT_PREFIX,
  TEST_CUSTOMER_ADDRESS,
  TEST_IMEI_PREFIX,
  seedTestContracts,
} from '../seed-test-contracts.cli';

/** จำนวน scenario ของ seeder เดิม — ตรงกับ SCENARIOS.length ใน seed-test-contracts.cli.ts */
const CONTRACT_COUNT = 7;

/**
 * seedTestContracts ต้องการ Refs รูปของตัวเอง (มี interestConfigId ที่ SeedRefs ไม่มี)
 * แปลงตรงนี้ที่เดียว — ไม่ไปแก้ไฟล์เดิมซึ่งยังต้องรันด้วยตัวเองได้อยู่
 */
async function adaptRefs(ctx: SeedContext) {
  const ic = await ctx.prisma.interestConfig.findFirst({ select: { id: true } });
  return {
    branchId: ctx.refs.branchId,
    branchName: ctx.refs.branchName,
    salespersonId: ctx.refs.salespersonId,
    reviewerId: ctx.refs.reviewerId,
    interestConfigId: ic?.id ?? null,
    shopCompanyId: ctx.refs.shopCompanyId,
    financeCompanyId: ctx.refs.financeCompanyId,
  };
}

export const contractsSeeder: DomainSeeder = {
  key: 'contracts',
  label: 'สัญญาผ่อน + เครื่องว่าง + ลูกค้าเปล่า',
  routes: [
    '/payments',
    '/contracts',
    '/contracts/:id',
    '/overdue',
    '/collections',
    '/letters',
    '/repossessions',
    '/early-payoff',
    '/pos',
    '/receipts',
    '/finance/contract-cancellation',
  ],
  markerDoc: `Contract.contractNumber ขึ้นต้น "${TEST_CONTRACT_PREFIX}" · Customer.addressCurrent = "${TEST_CUSTOMER_ADDRESS}" · Product.imeiSerial ขึ้นต้น "${TEST_IMEI_PREFIX}" (สัญญาที่เปิดผ่าน UI ระหว่างเทสจะได้เลขจริง BCP- แต่ถูกกวาดตามลูกค้า/เครื่อง)`,

  async plan(ctx: SeedContext): Promise<PlanRow[]> {
    const refs = await adaptRefs(ctx);
    await seedTestContracts(ctx.prisma, refs, { count: CONTRACT_COUNT, dryRun: true });
    return [
      {
        label: `สัญญาทดสอบ ${CONTRACT_COUNT} ใบ`,
        detail:
          'ครบกำหนดวันนี้ · ค้าง 1/2/3 งวด · งวดอนาคต · TERMINATED รอยึด · ใกล้ปิดยอด (รายละเอียดพิมพ์ด้านบนจาก seeder เดิม)',
      },
      { label: 'เครื่องว่าง 3 เครื่อง', detail: 'มือถือใหม่ · มือสอง · หูฟัง (IN_STOCK)' },
      { label: 'ลูกค้าเปล่า 2 คน', detail: 'ไม่มีสัญญา — สำหรับลูกค้าใหม่ / trade-in / จอง' },
    ];
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const refs = await adaptRefs(ctx);
    const r = await seedTestContracts(ctx.prisma, refs, { count: CONTRACT_COUNT, dryRun: false });
    return {
      created: r.created + r.productsCreated + r.blankCustomersCreated,
      skipped: 0,
      notes: [
        `เลขสัญญา: ${r.contractNumbers[0] ?? '-'} .. ${r.contractNumbers[r.contractNumbers.length - 1] ?? '-'}`,
      ],
    };
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    // ── รูที่ปิด (2026-08-26): CLI เดิมลบ JE เฉพาะ metadata.contractId แต่ JE ของใบขาย
    // (ShopCashSaleTemplate ต่อชิ้น · ShopExternalFinanceSale/ReceiptTemplate — รวมใบขายจาก
    // การแปลงใบจอง/ยืนยันออเดอร์ออนไลน์ซึ่งสร้าง Sale เหมือนกัน) stamp metadata.saleId
    // ⇒ ตัวใบขายถูก soft-delete จนหน้าจอสะอาด แต่งบทดลองยังถือรายการค้างถาวร.
    // wrapper นี้กวาดส่วนนั้นเพิ่มเอง — ห้ามแก้ CLI เดิม (ต้องรันเดี่ยวได้เหมือนเดิม).

    // เก็บ id ใบขายทดสอบ "ก่อน" delegate — marker ชุดเดียวกับ CLI ทุกประการ แต่จงใจ
    // "ไม่กรอง deletedAt" ทุกชั้น (ลูกค้า/เครื่อง/สัญญา/ใบขาย) เพราะ:
    //   1. CLI กำลังจะ soft-delete ใบขายในรอบนี้ (กรองแล้วไปหาใหม่หลัง delegate จะไม่เจอ)
    //   2. รอบก่อนอาจ soft-delete ไปแล้วแต่ JE ยังค้าง (โค้ดยุคก่อนปิดรูนี้ / crash กลางคัน
    //      — การลบ JE ของ wrapper อยู่คนละ transaction กับของ CLI จึงต้องทน re-run ได้)
    //   3. ใบขายที่ถูก "ยกเลิก" (void) ระหว่างเทสมี deletedAt อยู่แล้ว แต่ JE ต้นฉบับ
    //      + ใบกลับรายการยังอยู่ทั้งคู่
    const [testCustomers, testProducts] = await Promise.all([
      ctx.prisma.customer.findMany({
        where: { addressCurrent: TEST_CUSTOMER_ADDRESS },
        select: { id: true },
      }),
      ctx.prisma.product.findMany({
        where: { imeiSerial: { startsWith: TEST_IMEI_PREFIX } },
        select: { id: true },
      }),
    ]);
    const testCustomerIds = testCustomers.map((c) => c.id);
    const testProductIds = testProducts.map((p) => p.id);
    const testContracts = await ctx.prisma.contract.findMany({
      where: {
        OR: [
          { contractNumber: { startsWith: TEST_CONTRACT_PREFIX } },
          ...(testCustomerIds.length ? [{ customerId: { in: testCustomerIds } }] : []),
          ...(testProductIds.length ? [{ productId: { in: testProductIds } }] : []),
        ],
      },
      select: { id: true },
    });
    const saleWhereOr = [
      ...(testProductIds.length ? [{ productId: { in: testProductIds } }] : []),
      ...(testCustomerIds.length ? [{ customerId: { in: testCustomerIds } }] : []),
      ...(testContracts.length ? [{ contractId: { in: testContracts.map((c) => c.id) } }] : []),
    ];
    const sales = saleWhereOr.length
      ? await ctx.prisma.sale.findMany({
          where: { OR: saleWhereOr },
          select: { id: true, saleNumber: true },
        })
      : [];

    // ── CLI เดิมทำงานตามปกติ (JE ที่ stamp contractId + soft delete ทุกอย่าง) ──
    const r = await cleanupTestContracts(ctx.prisma, { dryRun });

    // ── กวาด JE ของใบขาย (metadata.saleId) + ใบกลับรายการของมัน ──
    // query "หลัง" delegate เพื่อไม่นับซ้ำกับใบที่ CLI เพิ่งลบไปแล้ว (โหมดจริง)
    const saleJes = sales.length
      ? await ctx.prisma.journalEntry.findMany({
          where: {
            OR: sales.map((s) => ({ metadata: { path: ['saleId'], equals: s.id } as never })),
          },
          select: { id: true, metadata: true },
        })
      : [];
    const saleJeIds = saleJes.map((j) => j.id);
    // ใบกลับรายการจากการยกเลิกใบขาย (flow 'shop-cash-sale-void') "จงใจไม่ carry saleId"
    // (กัน sweep ของ void เจอ mirror ตัวเอง — sale-void.service.ts) จึงตามด้วย
    // metadata.reversesEntryId แทน: ลบต้นฉบับแต่ทิ้ง mirror ไว้ = งบทดลองเพี้ยนหนักกว่าเดิม
    // (ขากลับรายการยืนโดดโดยไม่มีคู่หักล้าง)
    const mirrorJes = saleJeIds.length
      ? await ctx.prisma.journalEntry.findMany({
          where: {
            OR: saleJeIds.map((id) => ({
              metadata: { path: ['reversesEntryId'], equals: id } as never,
            })),
          },
          select: { id: true },
        })
      : [];
    const jeIds = [...new Set([...saleJeIds, ...mirrorJes.map((j) => j.id)])];

    if (jeIds.length) {
      // identity ให้คนตรวจก่อน/หลังลบ — พิมพ์ทั้ง dry-run และโหมดจริง
      const affected = new Set<string>();
      for (const je of saleJes) {
        const saleId = (je.metadata as Record<string, unknown> | null)?.saleId;
        const sale = sales.find((s) => s.id === saleId);
        if (sale) affected.add(sale.saleNumber);
      }
      console.log(
        `  รายการบัญชีใบขาย (metadata.saleId): ${saleJeIds.length} ใบ + ใบกลับรายการ ${mirrorJes.length} ใบ จากใบขาย:`,
      );
      for (const n of affected) console.log(`    ${n}`);
      if (dryRun) {
        console.log(`  (dry-run) จะลบถาวร ${jeIds.length} รายการบัญชีใบขาย — ยังไม่ลบ`);
      } else {
        // ไม่มีคอลัมน์เอกสารใดชี้มาที่ JE กลุ่มนี้ (Sale ไม่มี journalEntryId — ตรวจ
        // schema.prisma 2026-08-26) ⇒ ล้างเฉพาะ FK Restrict สองตัว ตามลำดับบังคับ
        // เดียวกับ CLI เดิม: audit log → lines → entries
        await ctx.prisma.$transaction(async (tx) => {
          await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
        });
      }
    }

    return {
      removed: {
        สัญญา: r.contracts,
        งวดชำระ: r.payments,
        ตารางงวด: r.installmentSchedules,
        ใบเสร็จ: r.receipts,
        'รายการบัญชี (ลบถาวร)': r.journalEntries,
        'รายการบัญชีใบขาย (ลบถาวร)': jeIds.length,
        ใบขาย: r.sales,
        ลูกหนี้ไฟแนนซ์: r.financeReceivables,
        ค่าคอม: r.salesCommissions,
        รับซื้อมือสอง: r.tradeIns,
        รายการยึด: r.repossessions,
        หนังสือทวง: r.letters,
        คำขอยกเลิกสัญญา: r.cancellations,
        เครื่องทดสอบ: r.products,
        ลูกค้าทดสอบ: r.customers,
      },
      warnings: [],
    };
  },
};
