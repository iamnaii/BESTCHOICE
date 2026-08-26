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
    const r = await cleanupTestContracts(ctx.prisma, { dryRun });
    return {
      removed: {
        สัญญา: r.contracts,
        งวดชำระ: r.payments,
        ตารางงวด: r.installmentSchedules,
        ใบเสร็จ: r.receipts,
        'รายการบัญชี (ลบถาวร)': r.journalEntries,
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
