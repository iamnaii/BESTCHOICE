import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { IntercoAgingService } from '../interco-aging.service';

/**
 * IntercoAgingService — รายงานอายุลูกหนี้ 11-2107 / S21-3001 (Phase 4 Task 1)
 * against a REAL database.
 *
 * Synthetic seeds go through `JournalAutoService.createAndPost` (never direct
 * inserts) with metadata shaped EXACTLY like the real producers — same
 * convention as interco-netting.integration.spec.ts:
 *   - A.3 → 11-2107 [SWAP_CREDIT] (flow 'exchange-buyback-receivable-11-2107'
 *     + explicit stamp)
 *   - A.4 → S21-3001 [SWAP_CREDIT] keyed by metadata.newContractId
 *     (contractId on that JE is the OLD contract — the conditional group key
 *     in Query B is what this suite guards)
 *   - C-2 redirect → 11-2107 + S21-3001 [PAYOUT_RECALL] keyed by
 *     metadata.contractId
 *   - JP4 shop-collect → 11-2107 [SHOP_COLLECT] (explicit stamp,
 *     repossession-jp5/JP4 shape)
 *
 * Fixtures use prefix AGINGTEST- for scoped cleanup. All row assertions are
 * find-by-contractId; the only global assertions (overdueCount) use a
 * deterministic huge threshold + self-consistency so leftover rows from other
 * suites can never break them.
 */

const prisma = new PrismaClient();
const journalAuto = new JournalAutoService(prisma as never);
const agingService = new IntercoAgingService(prisma as never);

const createdContractIds: string[] = [];
const createdProductIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdBatchIds: string[] = [];
let createdBranchId: string | null = null;

let adminId: string;
let shopId: string;
let financeId: string;
let branchId: string;

// Unique-per-run suffix — a crashed earlier run's leftovers (unique
// nationalId/imeiSerial/phone) can never collide with this run.
const RUN = Date.now().toString(36);
const RUN_NUM = String(Date.now() % 1_000_000).padStart(6, '0');

const dec = (s: string) => new Decimal(s);
const zero = dec('0');
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Customer + product + contract row — prefix AGINGTEST- for cleanup. */
async function seedBaseContract(seq: number): Promise<string> {
  const tag = `${RUN}-${seq}`;
  const customer = await prisma.customer.create({
    data: {
      name: `__AGINGTEST_${tag}__`,
      phone: `096${RUN_NUM}${seq}`,
      nationalId: `AGINGTEST-${tag}`,
    },
  });
  createdCustomerIds.push(customer.id);

  const product = await prisma.product.create({
    data: {
      name: `Aging Test ${tag}`,
      brand: 'AgingBrand',
      model: `AgingModel-${tag}`,
      storage: '128GB',
      imeiSerial: `AGINGTEST-${tag}`,
      category: 'PHONE_NEW',
      costPrice: dec('6000.00'),
      installmentPrice: dec('12000.00'),
      branchId,
      status: 'SOLD_INSTALLMENT',
      ownedByCompanyId: financeId,
    },
  });
  createdProductIds.push(product.id);

  const contract = await prisma.contract.create({
    data: {
      contractNumber: `AGINGTEST-${tag}`,
      customerId: customer.id,
      productId: product.id,
      branchId,
      salespersonId: adminId,
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
      status: 'ACTIVE',
    },
  });
  createdContractIds.push(contract.id);
  return contract.id;
}

/** A.3 synthetic — Dr 11-2107 [SWAP_CREDIT] (flow + explicit stamp, Phase 1 shape). */
async function seedA3(id: string, amount: string, postedAt?: Date) {
  await journalAuto.createAndPost({
    description: 'A.3 synthetic (aging)',
    companyId: financeId,
    postedAt,
    metadata: {
      flow: 'exchange-buyback-receivable-11-2107',
      idempotencyKey: `agta3:${id}`,
      contractId: id,
      shopReceivableType: 'SWAP_CREDIT',
    },
    lines: [
      { accountCode: '11-2107', dr: dec(amount), cr: zero },
      { accountCode: '21-1106', dr: zero, cr: dec(amount) },
    ],
  });
}

/**
 * A.4 synthetic — Cr S21-3001 [SWAP_CREDIT] keyed by metadata.newContractId;
 * metadata.contractId is deliberately the OLD contract (`${id}-old`) exactly
 * like the real ShopExchangeReturnTemplate — the conditional group key trap.
 */
async function seedA4(id: string, amount: string) {
  await journalAuto.createAndPost({
    description: 'A.4 synthetic (aging)',
    companyId: shopId,
    metadata: {
      flow: 'shop-exchange-return',
      idempotencyKey: `agta4:${id}`,
      contractId: `${id}-old`,
      newContractId: id,
      shopReceivableType: 'SWAP_CREDIT',
    },
    lines: [
      { accountCode: 'S11-2002', dr: dec(amount), cr: zero },
      { accountCode: 'S21-3001', dr: zero, cr: dec(amount) },
    ],
  });
}

/** Mirror synthetics of A.3/A.4 at swap-cancel (C-2) — carry the SWAP_CREDIT stamp. */
async function seedSwapCancelMirrors(id: string, amount: string) {
  await journalAuto.createAndPost({
    description: 'A.3 mirror synthetic (aging C-2 cancel)',
    companyId: financeId,
    metadata: {
      tag: 'REVERSAL',
      flow: 'agingtest-c2-cancel-sweep',
      idempotencyKey: `agtm3:${id}`,
      contractId: id,
      shopReceivableType: 'SWAP_CREDIT',
    },
    lines: [
      { accountCode: '21-1106', dr: dec(amount), cr: zero },
      { accountCode: '11-2107', dr: zero, cr: dec(amount) },
    ],
  });
  await journalAuto.createAndPost({
    description: 'A.4 mirror synthetic (aging C-2 cancel)',
    companyId: shopId,
    metadata: {
      tag: 'REVERSAL',
      flow: 'agingtest-c2-cancel-sweep-shop',
      idempotencyKey: `agtm4:${id}`,
      contractId: `${id}-old`,
      newContractId: id,
      shopReceivableType: 'SWAP_CREDIT',
    },
    lines: [
      { accountCode: 'S21-3001', dr: dec(amount), cr: zero },
      { accountCode: 'S11-2002', dr: zero, cr: dec(amount) },
    ],
  });
}

/** C-2 redirect pair — 11-2107 + S21-3001 [PAYOUT_RECALL] keyed by metadata.contractId. */
async function seedRecallPair(id: string, financeAmount: string, shopAmount: string) {
  await journalAuto.createAndPost({
    description: 'C-2 recall synthetic (aging)',
    companyId: financeId,
    metadata: {
      flow: 'agingtest-c2-recall',
      idempotencyKey: `agtc2:${id}`,
      contractId: id,
      shopReceivableType: 'PAYOUT_RECALL',
    },
    lines: [
      { accountCode: '11-2107', dr: dec(financeAmount), cr: zero },
      { accountCode: '21-1103', dr: zero, cr: dec(financeAmount) }, // ขาคู่ synthetic ให้ balance
    ],
  });
  await journalAuto.createAndPost({
    description: 'C-2 recall SHOP synthetic (aging)',
    companyId: shopId,
    metadata: {
      flow: 'agingtest-c2-recall-shop',
      idempotencyKey: `agtc2s:${id}`,
      contractId: id,
      shopReceivableType: 'PAYOUT_RECALL',
    },
    lines: [
      { accountCode: 'S21-3001', dr: zero, cr: dec(shopAmount) },
      { accountCode: 'S11-1201', dr: dec(shopAmount), cr: zero }, // ขาคู่ synthetic
    ],
  });
}

/**
 * A.3 legacy synthetic — flow เดิม **ไม่มี explicit stamp** (swap ยุคก่อน
 * Phase 1, spec §11.4). เลนส์นับเป็น SWAP_CREDIT ผ่าน flow fallback แต่คอลัมน์
 * legacy_swap_gross ต้องจับมันแยกได้ (Fix Round 1).
 */
async function seedLegacyA3(id: string, amount: string, postedAt?: Date) {
  await journalAuto.createAndPost({
    description: 'A.3 legacy synthetic (no explicit stamp, aging)',
    companyId: financeId,
    postedAt,
    metadata: {
      flow: 'exchange-buyback-receivable-11-2107',
      idempotencyKey: `agtl3:${id}`,
      contractId: id,
    },
    lines: [
      { accountCode: '11-2107', dr: dec(amount), cr: zero },
      { accountCode: '21-1106', dr: zero, cr: dec(amount) },
    ],
  });
}

/**
 * ใบ settle จาก settleShopCollect จริง — flow 'shop-collect-settlement' +
 * stamp SHOP_COLLECT (typeStamp default ของ ShopCollectSettlementTemplate).
 * นี่คือทางล้างของ legacy swap: ขา Cr ลงคอลัมน์ shopCollect ไม่ลด
 * swapCreditGross — sub-case 2 ของ review.
 */
async function seedShopCollectSettle(id: string, amount: string) {
  await journalAuto.createAndPost({
    description: 'shop-collect settle synthetic (aging)',
    companyId: financeId,
    metadata: {
      flow: 'shop-collect-settlement',
      idempotencyKey: `agtscs:${id}`,
      contractId: id,
      shopReceivableType: 'SHOP_COLLECT',
    },
    lines: [
      { accountCode: '11-1201', dr: dec(amount), cr: zero },
      { accountCode: '11-2107', dr: zero, cr: dec(amount) },
    ],
  });
}

/** JP4 shop-collect synthetic — Dr 11-2107 [SHOP_COLLECT] (explicit stamp). */
async function seedShopCollect(id: string, amount: string) {
  await journalAuto.createAndPost({
    description: 'JP4 shop-collect synthetic (aging)',
    companyId: financeId,
    metadata: {
      flow: 'agingtest-jp4-shop-collect',
      idempotencyKey: `agtsc:${id}`,
      contractId: id,
      shopReceivableType: 'SHOP_COLLECT',
    },
    lines: [
      { accountCode: '11-2107', dr: dec(amount), cr: zero },
      { accountCode: '21-1103', dr: zero, cr: dec(amount) }, // ขาคู่ synthetic
    ],
  });
}

/**
 * mirror ตอนยกเลิก swap **ยุค legacy** — ต้นฉบับ (A.3 ก่อน Phase 1) ไม่มี
 * explicit stamp ⇒ `ExchangeCancelReversalTemplate` ไม่มีอะไรให้ copy และ
 * flow ของ mirror เปลี่ยนเป็น 'exchange-cancel' ⇒ บรรทัดนี้ **ไม่เข้าเลนส์
 * typed ใดเลย** (ไม่ใช่ SWAP/RECALL/SHOP_COLLECT) — carry ข ของ Phase 4.
 */
async function seedUnstampedCancelMirror(id: string, amount: string) {
  await journalAuto.createAndPost({
    description: 'A.3 legacy mirror synthetic (no stamp — carry ข)',
    companyId: financeId,
    metadata: {
      tag: 'REVERSAL',
      flow: 'exchange-cancel',
      idempotencyKey: `agtlm3:${id}`,
      contractId: id,
    },
    lines: [
      { accountCode: '21-1106', dr: dec(amount), cr: zero },
      { accountCode: '11-2107', dr: zero, cr: dec(amount) },
    ],
  });
}

/** 1A synthetic — เจ้าหนี้หน้าร้าน Cr 21-1101 (+ 21-1102 ถ้ามีค่าคอม) */
async function seedFinancePayable(id: string, financed: string, commission: string) {
  const total = dec(financed).plus(dec(commission));
  const lines = [
    { accountCode: '11-2101', dr: total, cr: zero },
    { accountCode: '21-1101', dr: zero, cr: dec(financed) },
  ];
  if (dec(commission).gt(0)) {
    lines.push({ accountCode: '21-1102', dr: zero, cr: dec(commission) });
  }
  await journalAuto.createAndPost({
    description: '1A synthetic (aging pairing)',
    companyId: financeId,
    metadata: { flow: 'agingtest-1a', idempotencyKey: `agt1a:${id}`, contractId: id },
    lines,
  });
}

/** JE B ฝั่ง SHOP synthetic — ลูกหนี้ FINANCE Dr S11-3001 (+ S11-3002 ถ้ามีค่าคอม) */
async function seedShopReceivable(id: string, financed: string, commission: string) {
  const total = dec(financed).plus(dec(commission));
  const lines = [
    { accountCode: 'S11-3001', dr: dec(financed), cr: zero },
    { accountCode: 'S41-1101', dr: zero, cr: total },
  ];
  if (dec(commission).gt(0)) {
    lines.push({ accountCode: 'S11-3002', dr: dec(commission), cr: zero });
  }
  await journalAuto.createAndPost({
    description: 'JE B synthetic (aging pairing)',
    companyId: shopId,
    metadata: { flow: 'agingtest-shop-transfer', idempotencyKey: `agtjb:${id}`, contractId: id },
    lines,
  });
}

/** Minimal POSTED batch row for deduction items — no JE involved (item gate only). */
async function seedPostedBatch(seq: number) {
  const batch = await prisma.interCoSettlementBatch.create({
    data: {
      batchNumber: `IC-AGINGTEST-${RUN}-${seq}`,
      status: 'POSTED',
      transferDate: new Date(),
      financeBankCode: '11-1201',
      shopBankCode: 'S11-1201',
      totalFinanced: dec('10000.00'),
      totalCommission: dec('1000.00'),
      totalAmount: dec('11000.00'),
      shopPostedAmount: dec('11000.00'),
      makerId: adminId,
    },
  });
  createdBatchIds.push(batch.id);
  return batch;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

let swapId: string; // (a) swap ยังไม่ถูกหัก
let c2Id: string; // (b) C-2 หลังหักเครดิต — CANCELED, ทั้งสองประเภทบนสัญญาเดียว
let shopCollectId: string; // (c) shop-collect ค้าง
let settledId: string; // (d) settle ครบแล้ว
let agedId: string; // อายุ 45 วัน
let mismatchId: string; // สองสมุดไม่ตรง
let legacyUnsettledId: string; // legacy swap ยังไม่ล้าง (flow-only, ไม่มี S21-3001)
let legacySettledId: string; // legacy swap ที่ล้างแล้วผ่าน settleShopCollect (backdate 45 วัน)
let pairOkId: string; // (i) เจ้าหนี้/ลูกหนี้รอบจ่ายตรงกันสองสมุด
let pairMismatchId: string; // (j) สมุด SHOP ขาดค่าคอม 1,000
let pairLegacyNoShopId: string; // (k) FINANCE อย่างเดียว (activate ก่อน 2026-06-23)
let softDeletedId: string; // (l) M1 — สัญญาถูก soft-delete แต่ GL ยังค้าง
let phantomId: string; // (m) M1 — contractId ที่ไม่มีแถวสัญญาเลย (JV มือ/คีย์ผี)

describe('IntercoAgingService — รายงานอายุลูกหนี้ 11-2107/S21-3001 (real DB)', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    await seedShopCoa(prisma);

    const shop = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'SHOP', deletedAt: null },
    });
    const finance = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    shopId = shop.id;
    financeId = finance.id;

    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    adminId = admin.id;

    const existingBranch = await prisma.branch.findFirst({
      where: { name: '__interco_aging_test_branch__', deletedAt: null },
    });
    if (existingBranch) {
      branchId = existingBranch.id;
    } else {
      const branch = await prisma.branch.create({
        data: { name: '__interco_aging_test_branch__', companyId: shopId },
      });
      branchId = branch.id;
      createdBranchId = branch.id;
    }

    // (a) swap ยังไม่ถูกหัก: A.3 8,000 + A.4 8,000 — สองสมุดตรง
    swapId = await seedBaseContract(1);
    await seedA3(swapId, '8000');
    await seedA4(swapId, '8000');

    // (b) C-2 หลังหัก: swap เต็มวง (A.3+A.4 + mirrors ตอน cancel) + redirect
    // 11,000 [PAYOUT_RECALL] สองสมุด + SETTLEMENT item ใน batch POSTED ที่เคย
    // หักเครดิต 8,000 → intercoNet = 11,000 − 8,000 = 3,000 (เลขทองของเฟส 3).
    // สัญญาเป็น CANCELED — พิสูจน์ว่า hydrate ไม่กรอง status.
    c2Id = await seedBaseContract(2);
    await seedA3(c2Id, '8000');
    await seedA4(c2Id, '8000');
    await seedSwapCancelMirrors(c2Id, '8000');
    await seedRecallPair(c2Id, '11000', '11000');
    await prisma.contract.update({ where: { id: c2Id }, data: { status: 'CANCELED' } });
    const batch1 = await seedPostedBatch(1);
    await prisma.interCoSettlementItem.create({
      data: {
        batchId: batch1.id,
        contractId: c2Id,
        itemType: 'SETTLEMENT',
        financedGl: dec('10000.00'),
        commissionGl: dec('1000.00'),
        shopFinancedGl: dec('10000.00'),
        shopCommissionGl: dec('1000.00'),
        swapCreditAmount: dec('8000.00'),
      },
    });

    // (c) shop-collect ค้าง 1,771
    shopCollectId = await seedBaseContract(3);
    await seedShopCollect(shopCollectId, '1771');

    // (d) settle ครบแล้ว: recall 11,000 สองสมุด + RECALL item 11,000 ใน batch
    // POSTED → net = 0 → ต้องไม่โผล่
    settledId = await seedBaseContract(4);
    await seedRecallPair(settledId, '11000', '11000');
    await prisma.interCoSettlementItem.create({
      data: {
        batchId: batch1.id,
        contractId: settledId,
        itemType: 'RECALL',
        financedGl: zero,
        commissionGl: zero,
        shopFinancedGl: zero,
        shopCommissionGl: zero,
        recallAmount: dec('11000.00'),
      },
    });

    // (e) อายุ: A.3 backdate 45 วันผ่าน postedAt option ของ createAndPost
    agedId = await seedBaseContract(5);
    await seedA3(agedId, '8000', new Date(Date.now() - 45 * DAY_MS));
    await seedA4(agedId, '8000');

    // (f) mismatch: FINANCE 8,000 แต่ SHOP ขาดไป 500 (7,500)
    mismatchId = await seedBaseContract(6);
    await seedA3(mismatchId, '8000');
    await seedA4(mismatchId, '7500');

    // (g) legacy swap ยังไม่ล้าง: A.3 flow เดิมไม่มี stamp, ไม่มี S21-3001 —
    // spec §11.4 ถือเป็นสภาพปกติ (ล้างผ่าน shop-collect ทีหลัง) ไม่ใช่ anomaly
    legacyUnsettledId = await seedBaseContract(7);
    await seedLegacyA3(legacyUnsettledId, '8000');

    // (h) legacy swap ที่ล้างครบแล้วผ่าน settleShopCollect: A.3 legacy backdate
    // 45 วัน + ใบ settle [SHOP_COLLECT] — ยอด 11-2107 จริงของสัญญา = 0 แต่
    // typed columns เห็น +8,000/−8,000 ค้างถาวร (sub-case 2 ของ review)
    legacySettledId = await seedBaseContract(8);
    await seedLegacyA3(legacySettledId, '8000', new Date(Date.now() - 45 * DAY_MS));
    await seedShopCollectSettle(legacySettledId, '8000');

    // (i) คู่เจ้าหนี้/ลูกหนี้รอบจ่ายตรงกัน: 10,000 + 1,000 ทั้งสองสมุด
    pairOkId = await seedBaseContract(9);
    await seedFinancePayable(pairOkId, '10000', '1000');
    await seedShopReceivable(pairOkId, '10000', '1000');

    // (j) สมุด SHOP ขาดค่าคอม 1,000 — ไม่สมมาตร (มือมาแก้ข้างเดียว)
    pairMismatchId = await seedBaseContract(10);
    await seedFinancePayable(pairMismatchId, '10000', '1000');
    await seedShopReceivable(pairMismatchId, '10000', '0');

    // (k) legacyNoShop: FINANCE อย่างเดียว (สัญญาก่อน 2026-06-23) = สภาพปกติ
    pairLegacyNoShopId = await seedBaseContract(11);
    await seedFinancePayable(pairLegacyNoShopId, '19190', '0');

    // (l) M1 — สัญญาถูก soft-delete แต่ GL 11-2107 ยังค้าง 6,000 สองสมุด
    softDeletedId = await seedBaseContract(21);
    await seedA3(softDeletedId, '6000');
    await seedA4(softDeletedId, '6000');
    await prisma.contract.update({
      where: { id: softDeletedId },
      data: { deletedAt: new Date() },
    });

    // (m) M1 — คีย์ผี: JE stamp contractId ที่ไม่มีแถวสัญญารองรับเลย
    // (JV มือ / สัญญาถูก hard-delete จากยุคก่อน). push เข้า createdContractIds
    // เพื่อให้ afterAll กวาด JE ของมันตามปกติ (contract.deleteMany จะไม่แมตช์)
    phantomId = `AGINGTEST-PHANTOM-${RUN}`;
    createdContractIds.push(phantomId);
    await seedA3(phantomId, '5000');
    await seedA4(phantomId, '5000');
  }, 120_000);

  afterAll(async () => {
    // Sweep every JE this spec produced: metadata.contractId ∈ {ids, `${id}-old`}
    // plus metadata.newContractId ∈ ids (A.4 synthetics) — netting-spec pattern.
    const jeIds = new Set<string>();
    for (const cid of createdContractIds) {
      for (const key of ['contractId', 'newContractId']) {
        const rows = await prisma.journalEntry.findMany({
          where: { metadata: { path: [key], equals: cid } as never },
          select: { id: true },
        });
        rows.forEach((r) => jeIds.add(r.id));
      }
      const oldRows = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['contractId'], equals: `${cid}-old` } as never },
        select: { id: true },
      });
      oldRows.forEach((r) => jeIds.add(r.id));
    }
    const jeIdList = [...jeIds];

    // JournalPostAuditLog FK-references journal_entries — clear first (a48fe1fe convention)
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });

    await prisma.interCoSettlementItem.deleteMany({ where: { batchId: { in: createdBatchIds } } });
    await prisma.interCoSettlementBatch.deleteMany({ where: { id: { in: createdBatchIds } } });

    await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    if (createdBranchId) {
      try {
        await prisma.branch.delete({ where: { id: createdBranchId } });
      } catch {
        // referenced by rows outside this spec's scope — leave it
      }
    }
    await prisma.$disconnect();
  }, 120_000);

  // -------------------------------------------------------------------------
  it('(a) swap ยังไม่หัก → intercoNet = gross 8,000, สองสมุดตรง, ไม่ mismatch', async () => {
    const res = await agingService.getShopReceivableAging();
    const row = res.rows.find((r) => r.contractId === swapId)!;
    expect(row).toBeDefined();

    expect(row.swapCreditGross.toFixed(2)).toBe('8000.00');
    expect(row.payoutRecallGross.toFixed(2)).toBe('0.00');
    expect(row.settledDeduction.toFixed(2)).toBe('0.00');
    expect(row.intercoNet.toFixed(2)).toBe('8000.00');
    expect(row.shopMirrorNet.toFixed(2)).toBe('8000.00');
    expect(row.bookMismatch).toBe(false);
    expect(row.shopCollect.toFixed(2)).toBe('0.00');

    // สัญญายุคใหม่ (A.3 มี stamp) — ไม่ใช่ legacy
    expect(row.legacySwapGross.toFixed(2)).toBe('0.00');
    expect(row.legacyOneBook).toBe(false);

    // อายุกลุ่ม interco เพิ่งตั้งวันนี้
    expect(row.intercoOldestPostedAt).not.toBeNull();
    expect(row.intercoAgeDays).not.toBeNull();
    expect(row.intercoAgeDays!).toBeGreaterThanOrEqual(0);
    expect(row.intercoAgeDays!).toBeLessThanOrEqual(1);
    // ไม่มี shop-collect → ฝั่งนั้น null
    expect(row.shopCollectOldestPostedAt).toBeNull();
    expect(row.shopCollectAgeDays).toBeNull();

    expect(row.contractNumber.startsWith('AGINGTEST-')).toBe(true);
    expect(row.customerName).toContain('__AGINGTEST_');
  });

  it('(b) C-2 หลังหัก 8,000 → intercoNet = 3,000 (ไม่ใช่ gross 11,000) และ shopMirrorNet = 3,000', async () => {
    const res = await agingService.getShopReceivableAging();
    const row = res.rows.find((r) => r.contractId === c2Id)!;
    expect(row).toBeDefined();

    // SWAP_CREDIT net 0 (A.3 + mirror), PAYOUT_RECALL gross 11,000 —
    // สัญญาเดียวมีทั้งสองประเภท = ด่านจับ conditional group key ของ S21-3001
    expect(row.swapCreditGross.toFixed(2)).toBe('0.00');
    expect(row.payoutRecallGross.toFixed(2)).toBe('11000.00');
    expect(row.settledDeduction.toFixed(2)).toBe('8000.00');
    expect(row.intercoNet.toFixed(2)).toBe('3000.00');
    expect(row.shopMirrorNet.toFixed(2)).toBe('3000.00');
    expect(row.bookMismatch).toBe(false);

    // สัญญา CANCELED ต้องโผล่ — hydrate ห้ามกรอง status (หัวใจของ C-2)
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: c2Id } });
    expect(contract.status).toBe('CANCELED');
  });

  it('(c) shop-collect ค้าง → shopCollect = 1,771 แยกคอลัมน์ ไม่ปนกลุ่ม interco', async () => {
    const res = await agingService.getShopReceivableAging();
    const row = res.rows.find((r) => r.contractId === shopCollectId)!;
    expect(row).toBeDefined();

    expect(row.shopCollect.toFixed(2)).toBe('1771.00');
    expect(row.swapCreditGross.toFixed(2)).toBe('0.00');
    expect(row.payoutRecallGross.toFixed(2)).toBe('0.00');
    expect(row.intercoNet.toFixed(2)).toBe('0.00');
    expect(row.shopMirrorNet.toFixed(2)).toBe('0.00');
    // SHOP_COLLECT เป็น FINANCE-side-only โดยสถาปัตยกรรม — ไม่นับ mismatch
    expect(row.bookMismatch).toBe(false);

    // อายุแยกกลุ่ม: shop-collect มีวันที่, กลุ่ม interco เป็น null
    expect(row.shopCollectOldestPostedAt).not.toBeNull();
    expect(row.shopCollectAgeDays).not.toBeNull();
    expect(row.intercoOldestPostedAt).toBeNull();
    expect(row.intercoAgeDays).toBeNull();
  });

  it('(d) สัญญาที่ล้างครบ → ไม่อยู่ใน rows', async () => {
    const res = await agingService.getShopReceivableAging();
    expect(res.rows.some((r) => r.contractId === settledId)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Phase 5 Task 5 ข้อ 3 (M1) — แถวที่ hydrate สัญญาไม่ได้ต้อง "แสดง" ไม่ใช่ทิ้ง
  //
  // เดิม `buildAllRows` `continue` ทิ้งเงียบ ๆ ขณะที่ `getPayablePairing`
  // แสดงเป็น '(ไม่พบสัญญา)' — GL ที่ไม่มีสัญญารองรับคือสิ่งที่ต้องเห็น
  // (ตาข่ายกระทบยอด) ไม่ใช่สิ่งที่ต้องซ่อน: ยอดที่ถูกทิ้งไม่โผล่ทั้งในรายงาน
  // อายุ ทั้งใน `getNegativeTypedRows` และไม่เข้า totals ⇒ เห็นได้แค่ที่ drift
  // ระดับบัญชีซึ่ง**ไม่มีเลขสัญญา**ติดมาด้วย
  // -------------------------------------------------------------------------
  it('M1: สัญญาถูก soft-delete แต่ GL ค้าง → ยังอยู่ในรายงาน (เลขสัญญาจริง ไม่ถูกทิ้ง)', async () => {
    const res = await agingService.getShopReceivableAging();
    const row = res.rows.find((r) => r.contractId === softDeletedId);
    expect(row).toBeDefined();
    expect(row!.intercoNet.toFixed(2)).toBe('6000.00');
    expect(row!.shopMirrorNet.toFixed(2)).toBe('6000.00');
    // hydrate ไม่กรอง deletedAt (นิยามเดียวกับ getPayablePairing) — เลขสัญญาจริง
    // มีประโยชน์กว่า '(ไม่พบสัญญา)' เมื่อแถวยังอยู่ใน DB
    expect(row!.contractNumber).toMatch(/^AGINGTEST-/);
  });

  it('M1: contractId ผี (ไม่มีแถวสัญญา) → โผล่เป็น (ไม่พบสัญญา) เหมือน getPayablePairing', async () => {
    const res = await agingService.getShopReceivableAging();
    const row = res.rows.find((r) => r.contractId === phantomId);
    expect(row).toBeDefined();
    expect(row!.contractNumber).toBe('(ไม่พบสัญญา)');
    expect(row!.customerName).toBe('');
    expect(row!.intercoNet.toFixed(2)).toBe('5000.00');
  });

  it('อายุ: JE ตั้งหนี้ backdate 45 วัน → intercoAgeDays = 45 (±1) และนับ overdueCount เมื่อ threshold 30', async () => {
    const res = await agingService.getShopReceivableAging(); // default threshold 30
    const row = res.rows.find((r) => r.contractId === agedId)!;
    expect(row).toBeDefined();

    expect(row.intercoAgeDays).not.toBeNull();
    expect(row.intercoAgeDays!).toBeGreaterThanOrEqual(44);
    expect(row.intercoAgeDays!).toBeLessThanOrEqual(46);
    expect(row.intercoNet.toFixed(2)).toBe('8000.00');

    // overdueCount: แถว aged เข้าเงื่อนไข (อายุ ≥ 30 + intercoNet > 0.01)
    expect(res.totals.overdueCount).toBeGreaterThanOrEqual(1);
    // self-consistency กับนิยามที่ประกาศไว้ (แถว legacyOneBook ไม่นับ —
    // Fix Round 1: legacy = label ไม่ใช่ alert)
    const expected = res.rows.filter(
      (r) =>
        !r.legacyOneBook &&
        ((r.intercoAgeDays !== null && r.intercoAgeDays >= 30 && r.intercoNet.gt('0.01')) ||
          (r.shopCollectAgeDays !== null && r.shopCollectAgeDays >= 30 && r.shopCollect.gt('0.01'))),
    ).length;
    expect(res.totals.overdueCount).toBe(expected);

    // threshold ใหญ่จนไม่มีแถวไหนแก่พอ → 0 (deterministic แม้มี leftover จาก suite อื่น)
    const resBig = await agingService.getShopReceivableAging(undefined, 10_000);
    expect(resBig.totals.overdueCount).toBe(0);

    // เรียงอายุมากสุดก่อน: แถว aged (45 วัน) ต้องมาก่อนแถว swap สดของ run นี้
    const agedIdx = res.rows.findIndex((r) => r.contractId === agedId);
    const freshIdx = res.rows.findIndex((r) => r.contractId === swapId);
    expect(agedIdx).toBeGreaterThanOrEqual(0);
    expect(freshIdx).toBeGreaterThanOrEqual(0);
    expect(agedIdx).toBeLessThan(freshIdx);
  });

  it('bookMismatch: ตั้ง S21-3001 ฝั่ง SHOP ขาดไป 500 → bookMismatch = true และแถวโผล่แม้ intercoNet เท่าเดิม', async () => {
    const res = await agingService.getShopReceivableAging();
    const row = res.rows.find((r) => r.contractId === mismatchId)!;
    expect(row).toBeDefined();

    expect(row.bookMismatch).toBe(true);
    // FINANCE side ไม่กระทบจาก SHOP ที่ขาด — intercoNet เท่าเดิม
    expect(row.intercoNet.toFixed(2)).toBe('8000.00');
    expect(row.shopMirrorNet.toFixed(2)).toBe('7500.00');
  });

  it('legacyOneBook: legacy A.3 ไม่มี stamp + ไม่มี S21-3001 → flag true, mismatch ยัง true ตามนิยาม', async () => {
    const res = await agingService.getShopReceivableAging();
    const row = res.rows.find((r) => r.contractId === legacyUnsettledId)!;
    expect(row).toBeDefined();

    // เลนส์ยังนับเป็น SWAP_CREDIT ผ่าน flow fallback (สูตรเดิมห้ามขยับ)
    expect(row.swapCreditGross.toFixed(2)).toBe('8000.00');
    expect(row.intercoNet.toFixed(2)).toBe('8000.00');
    expect(row.shopMirrorNet.toFixed(2)).toBe('0.00');
    // bookMismatch คงความหมายคณิตศาสตร์บริสุทธิ์ — สองสมุดต่างกันจริง
    expect(row.bookMismatch).toBe(true);
    // flag แยกบริบท: มีบรรทัด legacy (flow-only ไม่มี stamp) + SHOP book = 0
    expect(row.legacySwapGross.toFixed(2)).toBe('8000.00');
    expect(row.legacyOneBook).toBe(true);
  });

  it('legacyOneBook: legacy ที่ล้างแล้วผ่าน shop-collect → แถวผีถูก flag แยก + ไม่นับ overdue', async () => {
    const res = await agingService.getShopReceivableAging();
    const row = res.rows.find((r) => r.contractId === legacySettledId)!;
    expect(row).toBeDefined();

    // Typed columns เห็นแถวผี: Dr legacy อยู่คอลัมน์ swap, Cr settle
    // [SHOP_COLLECT] อยู่คอลัมน์ shopCollect — ยอดบัญชีจริงของสัญญา = 0
    expect(row.swapCreditGross.toFixed(2)).toBe('8000.00');
    expect(row.shopCollect.toFixed(2)).toBe('-8000.00');
    expect(row.intercoNet.toFixed(2)).toBe('8000.00');
    expect(row.bookMismatch).toBe(true);
    expect(row.legacySwapGross.toFixed(2)).toBe('8000.00');
    expect(row.legacyOneBook).toBe(true);
    // ยอดสุทธิระดับสัญญา (interco + shopCollect) = 0 — ไม่มีหนี้จริง
    expect(row.intercoNet.plus(row.shopCollect).toFixed(2)).toBe('0.00');

    // แถวนี้แก่ 45 วัน + intercoNet > 0.01 — ถ้าไม่มี flag จะเป็น alert เท็จถาวร
    expect(row.intercoAgeDays!).toBeGreaterThanOrEqual(44);
    const wouldBeOverdue = res.rows.filter(
      (r) =>
        (r.intercoAgeDays !== null && r.intercoAgeDays >= 30 && r.intercoNet.gt('0.01')) ||
        (r.shopCollectAgeDays !== null && r.shopCollectAgeDays >= 30 && r.shopCollect.gt('0.01')),
    ).length;
    // flag ตัดแถว legacy ออกจาก overdueCount จริง (ไม่ใช่แค่บังเอิญเท่ากัน)
    expect(wouldBeOverdue).toBeGreaterThan(res.totals.overdueCount);
  });

  it('totals สอดคล้องกับ rows (กัน legacyOneBook ออก + รายงานแยก) + asOf ถูก echo', async () => {
    const asOf = new Date();
    const res = await agingService.getShopReceivableAging(asOf);
    expect(res.asOf.getTime()).toBe(asOf.getTime());

    // totals หลักไม่รวมแถว legacyOneBook — ตัวเลขต้องไม่หลอกว่ามีหนี้ typed จริง
    const nonLegacy = res.rows.filter((r) => !r.legacyOneBook);
    const sumInterco = nonLegacy.reduce((s, r) => s.plus(r.intercoNet), dec('0'));
    const sumCollect = nonLegacy.reduce((s, r) => s.plus(r.shopCollect), dec('0'));
    expect(res.totals.intercoNet.toFixed(2)).toBe(sumInterco.toFixed(2));
    expect(res.totals.shopCollect.toFixed(2)).toBe(sumCollect.toFixed(2));

    // แถว legacy รายงานแยกเป็นยอดสุทธิระดับสัญญา (intercoNet + shopCollect):
    // legacy ยังไม่ล้าง = หนี้จริง 8,000, legacy ล้างแล้ว = 0 — ไม่ซ่อนหนี้จริง
    const legacyNet = res.rows
      .filter((r) => r.legacyOneBook)
      .reduce((s, r) => s.plus(r.intercoNet).plus(r.shopCollect), dec('0'));
    expect(res.totals.legacyOneBookNet.toFixed(2)).toBe(legacyNet.toFixed(2));
    // สองแถว legacy ของ run นี้: 8,000 (ยังไม่ล้าง) + 0 (ล้างแล้ว) — อย่างน้อย
    // ต้องมี contribution 8,000 (leftover จาก suite อื่นอาจเพิ่ม จึง assert ผ่าน Σ)
    const unsettledRow = res.rows.find((r) => r.contractId === legacyUnsettledId)!;
    const settledRow = res.rows.find((r) => r.contractId === legacySettledId)!;
    expect(unsettledRow.intercoNet.plus(unsettledRow.shopCollect).toFixed(2)).toBe('8000.00');
    expect(settledRow.intercoNet.plus(settledRow.shopCollect).toFixed(2)).toBe('0.00');
  });

  // --- Phase 4 Task 4 — วัตถุดิบของ reconcile cron รายเดือน ------------------

  it('shopMirrorGross = ยอดดิบ S21-3001 ก่อนหัก deduction (ตัวชี้ขาด "สมุดเดียว")', async () => {
    const res = await agingService.getShopReceivableAging();

    // C-2 ที่ถูกหักไปแล้ว 8,000: net = 3,000 แต่ gross ยังเป็น 11,000 —
    // ถ้า reconcile ใช้ net จะเข้าใจผิดว่า "ไม่มีขาคู่" ทั้งที่มีครบแล้วหัก
    const c2 = res.rows.find((r) => r.contractId === c2Id)!;
    expect(c2.shopMirrorGross.toFixed(2)).toBe('11000.00');
    expect(c2.shopMirrorNet.toFixed(2)).toBe('3000.00');

    // swap ยุค legacy: ไม่มีขาคู่จริง ๆ → gross = 0
    const legacy = res.rows.find((r) => r.contractId === legacyUnsettledId)!;
    expect(legacy.shopMirrorGross.toFixed(2)).toBe('0.00');
  });

  it('getPhase2SwapContractIds: จับเฉพาะ A.4 ที่ stamp newContractId (ยุค Phase 2+)', async () => {
    const ids = await agingService.getPhase2SwapContractIds();

    // สัญญาที่มี A.4 (seedA4 → flow shop-exchange-return + newContractId)
    expect(ids.has(swapId)).toBe(true);
    expect(ids.has(mismatchId)).toBe(true);
    // legacy A.3 ล้วน — ไม่มี A.4 ยุคใหม่ ⇒ ต้องไม่อยู่ในเซต (spec §11.4)
    expect(ids.has(legacyUnsettledId)).toBe(false);
    expect(ids.has(legacySettledId)).toBe(false);
    // สัญญาที่ไม่ใช่ swap เลย
    expect(ids.has(shopCollectId)).toBe(false);
  });

  it('getPayablePairing: สองสมุดตรง / ขาดค่าคอมข้างเดียว = mismatch / legacyNoShop = ข้าม', async () => {
    const pairs = await agingService.getPayablePairing();

    const ok = pairs.find((p) => p.contractId === pairOkId)!;
    expect(ok).toBeDefined();
    expect(ok.financedGl.toFixed(2)).toBe('10000.00');
    expect(ok.commissionGl.toFixed(2)).toBe('1000.00');
    expect(ok.shopFinancedGl.toFixed(2)).toBe('10000.00');
    expect(ok.shopCommissionGl.toFixed(2)).toBe('1000.00');
    expect(ok.legacyNoShop).toBe(false);
    expect(ok.diff.toFixed(2)).toBe('0.00');
    expect(ok.mismatch).toBe(false);

    const bad = pairs.find((p) => p.contractId === pairMismatchId)!;
    expect(bad).toBeDefined();
    expect(bad.diff.toFixed(2)).toBe('1000.00');
    // แยกขา: ต่างเฉพาะค่าคอม = รูปแบบสัญญาที่ไม่ได้ระบุ storeCommission
    expect(bad.financedDiff.toFixed(2)).toBe('0.00');
    expect(bad.commissionDiff.toFixed(2)).toBe('1000.00');
    expect(bad.mismatch).toBe(true);
    expect(bad.contractNumber.startsWith('AGINGTEST-')).toBe(true);

    const legacyNoShop = pairs.find((p) => p.contractId === pairLegacyNoShopId)!;
    expect(legacyNoShop).toBeDefined();
    expect(legacyNoShop.legacyNoShop).toBe(true);
    // ต่างกันเต็มยอดตามคณิตศาสตร์ แต่ไม่ใช่ anomaly → mismatch = false
    expect(legacyNoShop.diff.toFixed(2)).toBe('19190.00');
    expect(legacyNoShop.mismatch).toBe(false);

    // ไม่มี HAVING/settled gate: สัญญาที่ไม่มีเจ้าหนี้เลยก็ไม่โผล่ (ทุกยอด 0)
    expect(pairs.some((p) => p.contractId === shopCollectId)).toBe(false);
  });

  it('getTypedAccountDrift: สมการ drift = ยอดบัญชี − (เลนส์ − deduction) และ mismatch ตามนิยาม', async () => {
    const drifts = await agingService.getTypedAccountDrift();

    expect(drifts.map((d) => d.accountCode)).toEqual(['11-2107', 'S21-3001']);
    for (const d of drifts) {
      expect(d.expected.toFixed(2)).toBe(d.lensTotal.minus(d.settledDeduction).toFixed(2));
      expect(d.drift.toFixed(2)).toBe(d.accountTotal.minus(d.expected).toFixed(2));
      expect(d.mismatch).toBe(d.drift.abs().gt('0.01'));
    }
  });

  it('C1 (Fix Round 1): หักเกินแบบสมมาตรสองสมุด → รายงานหลักกรองทิ้ง แต่ getNegativeTypedRows จับได้', async () => {
    // carry (d) ของจริง: เรียกคืน 11,000 สองสมุด แล้วถูกหัก 11,000 ในรอบหนึ่ง
    // + หักซ้ำอีก 3,000 ในอีกรอบ ⇒ ทั้งสองสมุดติดลบ **เท่ากัน** ⇒
    // bookMismatch = false และยอดบวกไม่มี → row filter ของรายงานหลักทิ้งแถวนี้
    const id = await seedBaseContract(13);
    await seedRecallPair(id, '11000', '11000');
    const b2 = await seedPostedBatch(2);
    await prisma.interCoSettlementItem.create({
      data: {
        batchId: b2.id,
        contractId: id,
        itemType: 'RECALL',
        financedGl: zero,
        commissionGl: zero,
        shopFinancedGl: zero,
        shopCommissionGl: zero,
        recallAmount: dec('11000.00'),
      },
    });
    const b3 = await seedPostedBatch(3);
    await prisma.interCoSettlementItem.create({
      data: {
        batchId: b3.id,
        contractId: id,
        itemType: 'RECALL',
        financedGl: zero,
        commissionGl: zero,
        shopFinancedGl: zero,
        shopCommissionGl: zero,
        recallAmount: dec('3000.00'),
      },
    });

    // รายงานหลัก (แท็บ/alert รายวัน) มองไม่เห็นโดยตั้งใจ — มันรายงาน "หนี้ที่ต้องไปตาม"
    const res = await agingService.getShopReceivableAging();
    expect(res.rows.some((r) => r.contractId === id)).toBe(false);

    // ตาข่ายของ reconcile: สแกนแถวดิบ ไม่ผ่าน filter ของรายงาน
    const negatives = await agingService.getNegativeTypedRows();
    const row = negatives.find((r) => r.contractId === id)!;
    expect(row).toBeDefined();
    expect(row.intercoNet.toFixed(2)).toBe('-3000.00');
    expect(row.shopMirrorNet.toFixed(2)).toBe('-3000.00');
    // สองสมุดติดลบเท่ากัน ⇒ bookMismatch จับไม่ได้ (นี่คือเหตุผลที่ต้องมี detector แยก)
    expect(row.bookMismatch).toBe(false);
    expect(row.legacyOneBook).toBe(false);
  });

  it('getOpenBatchPayableGross: Σ เจ้าหนี้ของ item ในรอบที่ค้างอนุมัติ (ใช้อธิบาย drift)', async () => {
    const before = await agingService.getOpenBatchPayableGross();

    const id = await seedBaseContract(14);
    await seedFinancePayable(id, '10000', '1000');
    await seedShopReceivable(id, '10000', '1000');
    const batch = await prisma.interCoSettlementBatch.create({
      data: {
        batchNumber: `IC-AGINGTEST-${RUN}-PA`,
        status: 'PENDING_APPROVAL',
        transferDate: new Date(),
        financeBankCode: '11-1201',
        shopBankCode: 'S11-1201',
        totalFinanced: dec('10000.00'),
        totalCommission: dec('1000.00'),
        totalAmount: dec('11000.00'),
        shopPostedAmount: dec('11000.00'),
        makerId: adminId,
      },
    });
    createdBatchIds.push(batch.id);
    await prisma.interCoSettlementItem.create({
      data: {
        batchId: batch.id,
        contractId: id,
        itemType: 'SETTLEMENT',
        financedGl: dec('10000.00'),
        commissionGl: dec('1000.00'),
        shopFinancedGl: dec('10000.00'),
        shopCommissionGl: dec('1000.00'),
      },
    });

    const after = await agingService.getOpenBatchPayableGross();
    // รอบยังไม่โพสต์ JE — เลนส์คิวรอจ่ายกันสัญญานี้ออกแล้วแต่ GL ยังเต็ม
    // ⇒ ยอดนี้คือตัวบวกกลับก่อนสรุปว่า drift ผิดปกติจริงหรือไม่
    expect(after.minus(before).toFixed(2)).toBe('11000.00');
  });

  // --- Phase 4 Task 6 — precedence ของ typed lens ---------------------------
  // SWAP_COND ต้อง mirror `classifyShopReceivable` (explicit stamp ก่อน FLOW_MAP)
  // เหมือนที่ SHOP_COLLECT_COND ทำอยู่แล้ว — ไม่งั้น JE รูป A.3 ที่ stamp
  // ประเภทอื่นจะถูกนับสองคอลัมน์พร้อมกัน (swap_gross + recall_gross) ⇒
  // intercoNet ของสัญญานั้นบวมเป็นสองเท่าและ legacyOneBook เพี้ยนตาม
  it('precedence: JE flow A.3 ที่ stamp PAYOUT_RECALL → เข้าเฉพาะคอลัมน์ recall ไม่ปนคอลัมน์ swap', async () => {
    const id = await seedBaseContract(15);
    await journalAuto.createAndPost({
      description: 'A.3 flow แต่ stamp PAYOUT_RECALL (aging)',
      companyId: financeId,
      metadata: {
        flow: 'exchange-buyback-receivable-11-2107',
        idempotencyKey: `agta3mis:${id}`,
        contractId: id,
        shopReceivableType: 'PAYOUT_RECALL',
      },
      lines: [
        { accountCode: '11-2107', dr: dec('5000'), cr: zero },
        { accountCode: '21-1103', dr: zero, cr: dec('5000') },
      ],
    });
    await journalAuto.createAndPost({
      description: 'ขาคู่ SHOP ของ recall (aging)',
      companyId: shopId,
      metadata: {
        flow: 'agingtest-c2-recall-shop',
        idempotencyKey: `agta3mis-s:${id}`,
        contractId: id,
        shopReceivableType: 'PAYOUT_RECALL',
      },
      lines: [
        { accountCode: 'S21-3001', dr: zero, cr: dec('5000') },
        { accountCode: 'S11-1201', dr: dec('5000'), cr: zero },
      ],
    });

    const row = (await agingService.getShopReceivableAging()).rows.find(
      (r) => r.contractId === id,
    )!;
    expect(row).toBeDefined();
    expect(row.swapCreditGross.toFixed(2)).toBe('0.00');
    expect(row.payoutRecallGross.toFixed(2)).toBe('5000.00');
    // นับครั้งเดียว — เดิมนับสองคอลัมน์ ⇒ intercoNet = 10,000 (บวมเท่าตัว)
    expect(row.intercoNet.toFixed(2)).toBe('5000.00');
    expect(row.shopMirrorNet.toFixed(2)).toBe('5000.00');
    expect(row.bookMismatch).toBe(false);
    // ไม่ใช่ legacy: มี explicit stamp อยู่ (LEGACY_SWAP_COND ต้องไม่จับ)
    expect(row.legacySwapGross.toFixed(2)).toBe('0.00');
    expect(row.legacyOneBook).toBe(false);
  });

  // ต้องเป็นเทสต์ท้ายสุดของไฟล์ — seed ข้างในเทสต์ (ต้องวัด before/after ระดับ
  // บัญชี ซึ่ง beforeAll ทำไม่ได้) และทิ้ง drift ค้างไว้ตลอดที่เหลือของ run
  it('carry ข: mirror ของ swap ยุค legacy ที่ไม่มี stamp → เลนส์เห็นค้าง แต่บัญชีจริง 0 (จับได้ที่ drift เท่านั้น)', async () => {
    const before = (await agingService.getTypedAccountDrift()).find(
      (d) => d.accountCode === '11-2107',
    )!;

    const id = await seedBaseContract(12);
    await seedLegacyA3(id, '8000');
    await seedUnstampedCancelMirror(id, '8000');

    const after = (await agingService.getTypedAccountDrift()).find(
      (d) => d.accountCode === '11-2107',
    )!;

    // ยอดบัญชีจริงไม่ขยับ (ตั้ง 8,000 แล้วกลับรายการ 8,000)
    expect(after.accountTotal.minus(before.accountTotal).toFixed(2)).toBe('0.00');
    // แต่เลนส์ typed เห็น +8,000 (ขาตั้งเข้าเลนส์ผ่าน flow, ขากลับรายการไม่เข้าเลย)
    expect(after.lensTotal.minus(before.lensTotal).toFixed(2)).toBe('8000.00');
    expect(after.drift.minus(before.drift).toFixed(2)).toBe('-8000.00');
    expect(after.mismatch).toBe(true);

    // และแถวนี้เป็น legacyOneBook → alert รายวัน/BOOK_MISMATCH ข้ามโดยตั้งใจ
    // (ถ้าไม่มี drift ระดับบัญชี ยอดผี 8,000 จะไม่มีใครเห็นเลย)
    const row = (await agingService.getShopReceivableAging()).rows.find(
      (r) => r.contractId === id,
    )!;
    expect(row.legacyOneBook).toBe(true);
    expect(row.intercoNet.toFixed(2)).toBe('8000.00');
  });
});
