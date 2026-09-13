import { Injectable } from '@nestjs/common';
import { Prisma, WarrantyStatus } from '@prisma/client';
import {
  CUSTOMER_BOUGHT_CONTRACT_STATUSES,
  CUSTOMER_BOUGHT_SALE_TYPES,
  CUSTOMER_INSTALLMENT_STATE_STATUSES,
  type CustomerInstallmentState,
} from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { dSum } from '../../../utils/decimal.util';
import {
  nextDueOf,
  outstandingOf,
  UNPAID_INSTALLMENT_WHERE,
} from '../../contracts/contract-outstanding';
import { detectWarrantyStatus } from '../../repair-tickets/utils/detect-warranty-status';

/** จำนวน id ต่อหนึ่งรอบ query — ตรงกับ CustomerTierService.getCustomerTiers */
const CHUNK_SIZE = 200;

/**
 * สัญญาที่ "ยังมีหนี้ค้างให้รายงานได้" — ใช้เลือกสัญญาที่ต้องไปอ่านตารางงวด
 *
 * 🔴 ต้องครอบถัง BAD_DEBT ให้ครบ (CANCELED + TERMINATED + CLOSED_BAD_DEBT ตาม
 * CUSTOMER_INSTALLMENT_STATE_STATUSES) ไม่ใช่แค่ TERMINATED: สถานะ "ตัดหนี้สูญ X ฿"
 * ของคอลัมน์ คงค้าง อ่าน `installmentBalance.outstanding` ของสัญญาที่ถูกตัดหนี้สูญ
 * ถ้าไม่เก็บสัญญาพวกนั้นไว้ installmentBalance เป็น null และสถานะนั้นไม่มีทางขึ้นจอเลย
 *
 * ตัด COMPLETED / EARLY_PAYOFF ทิ้งเท่านั้น — สองตัวนั้นปิดครบจริง ไม่เหลือหนี้
 * (clamp ราย **สัญญา** ข้างล่างกันยอดของสัญญาที่จ่ายเกินไม่ให้ไปหักหนี้ของใบอื่น)
 */
const OPEN_CONTRACT_STATUSES = ['ACTIVE', 'OVERDUE', 'DEFAULT', 'TERMINATED', 'CANCELED', 'CLOSED_BAD_DEBT'] as const;

export type CustomerPurchaseStateBucket = CustomerInstallmentState | 'OTHER';

export interface CustomerPurchaseChips {
  /** จำนวนสัญญาที่นับว่า "ซื้อกับเราแล้ว" (ตัด DRAFT/EXCHANGED/DEFECT_EXCHANGED ตาม D1) */
  installmentTotal: number;
  installmentByState: Record<CustomerPurchaseStateBucket, number>;
  cashCount: number;
  externalFinanceCount: number;
}

export interface CustomerLatestPurchase {
  at: string;
  kind: 'INSTALLMENT' | 'CASH' | 'EXTERNAL_FINANCE';
  number: string;
  productLabel: string;
  imeiSerial: string | null;
  branchId: string | null;
  branchName: string | null;
}

export interface CustomerWarrantySummary {
  endDate: string | null;
  source: 'SHOP' | 'CENTER' | null;
  shopEndDate: string | null;
  centerEndDate: string | null;
  status: WarrantyStatus;
}

export interface CustomerInstallmentBalance {
  outstanding: number;
  nextDueDate: string | null;
  nextAmountDue: number | null;
  openContracts: number;
}

export interface CustomerPurchaseSummary {
  purchase: CustomerPurchaseChips;
  latestPurchase: CustomerLatestPurchase | null;
  warranty: CustomerWarrantySummary | null;
  installmentBalance: CustomerInstallmentBalance | null;
}

const deviceSelect = {
  brand: true,
  model: true,
  storage: true,
  imeiSerial: true,
  warrantyExpireDate: true,
} satisfies Prisma.ProductSelect;

type LatestSale = {
  customerId: string;
  saleNumber: string;
  saleType: string;
  createdAt: Date;
  branchId: string | null;
  shopWarrantyEndDate: Date | null;
  branch: { id: string; name: string } | null;
  product: Prisma.ProductGetPayload<{ select: typeof deviceSelect }> | null;
};

type LatestContract = {
  customerId: string;
  contractNumber: string;
  createdAt: Date;
  branchId: string | null;
  deviceReceivedAt: Date | null;
  shopWarrantyEndDate: Date | null;
  branch: { id: string; name: string } | null;
  product: Prisma.ProductGetPayload<{ select: typeof deviceSelect }> | null;
};

function emptyChips(): CustomerPurchaseChips {
  return {
    installmentTotal: 0,
    installmentByState: { ACTIVE: 0, OVERDUE: 0, CLOSED: 0, BAD_DEBT: 0, OTHER: 0 },
    cashCount: 0,
    externalFinanceCount: 0,
  };
}

/** ContractStatus → ถังสถานะที่ UI แสดง (ตัวที่ไม่อยู่ในถังไหน = OTHER ตาม D1) */
function bucketOf(status: string): CustomerPurchaseStateBucket {
  for (const [bucket, statuses] of Object.entries(CUSTOMER_INSTALLMENT_STATE_STATUSES)) {
    if (statuses.includes(status)) return bucket as CustomerInstallmentState;
  }
  return 'OTHER';
}

/** ชื่อรุ่นที่โชว์ในคอลัมน์ "ซื้อล่าสุด" — สูตรเดียวกับ liff-warranty.service.ts:129 */
function productLabelOf(product: { brand?: string | null; model?: string | null; storage?: string | null } | null): string {
  if (!product) return '';
  return [product.brand, product.model, product.storage].filter(Boolean).join(' ');
}

/**
 * สรุป "การซื้อ / ซื้อล่าสุด / ประกันถึง / คงค้าง·งวดถัดไป" ของลูกค้าหลายคนพร้อมกัน
 *
 * 🔴 batched เท่านั้น — จำนวน query คงที่ต่อหนึ่งหน้า ไม่โตตามจำนวนแถว
 * (7 query ต่อ 200 id) มีเทสล็อกจำนวน query ไว้ที่ customer-purchase-summary.service.spec.ts
 * ถ้าวันหนึ่งมีใครเผลอเรียกแบบ per-row เทสนั้นจะแดงทันที
 *
 * ⚠️ `db` ต้องรับ TransactionClient ได้ ไม่งั้น Excel export จะอ่านข้อมูลออกนอก
 * snapshot ของตัวเอง (readExportSnapshot เปิด RepeatableRead READ ONLY transaction ไว้)
 */
@Injectable()
export class CustomerPurchaseSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async forCustomers(
    ids: string[],
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Map<string, CustomerPurchaseSummary>> {
    const result = new Map<string, CustomerPurchaseSummary>();
    for (let offset = 0; offset < ids.length; offset += CHUNK_SIZE) {
      await this.collectChunk(ids.slice(offset, offset + CHUNK_SIZE), db, result);
    }
    return result;
  }

  private async collectChunk(
    ids: string[],
    db: Prisma.TransactionClient,
    result: Map<string, CustomerPurchaseSummary>,
  ): Promise<void> {
    if (!ids.length) return;

    const [saleCounts, contractCounts, latestSales, latestContracts, openContracts] = await Promise.all([
      // (1) ชิป เงินสด N / ไฟแนนซ์นอก N
      db.sale.groupBy({
        by: ['customerId', 'saleType'],
        _count: { _all: true },
        where: { customerId: { in: ids }, deletedAt: null, saleType: { in: [...CUSTOMER_BOUGHT_SALE_TYPES] } },
      }),
      // (2) ชิป ผ่อน N + ถังสถานะย่อย
      db.contract.groupBy({
        by: ['customerId', 'status'],
        _count: { _all: true },
        where: { customerId: { in: ids }, deletedAt: null },
      }),
      // (3) ใบขายสด/ไฟแนนซ์นอกใบล่าสุดของแต่ละคน — DISTINCT ON (customer_id)
      //     distinct key ต้องมาก่อนใน orderBy และต้องมี id ปิดท้ายกันผลแกว่งเมื่อ createdAt ชนกัน
      db.sale.findMany({
        where: { customerId: { in: ids }, deletedAt: null, saleType: { in: [...CUSTOMER_BOUGHT_SALE_TYPES] } },
        orderBy: [{ customerId: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['customerId'],
        select: {
          customerId: true, saleNumber: true, saleType: true, createdAt: true,
          branchId: true, shopWarrantyEndDate: true,
          branch: { select: { id: true, name: true } },
          product: { select: deviceSelect },
        },
      }),
      // (4) สัญญาใบล่าสุดของแต่ละคน
      db.contract.findMany({
        where: { customerId: { in: ids }, deletedAt: null, status: { in: [...CUSTOMER_BOUGHT_CONTRACT_STATUSES] } },
        orderBy: [{ customerId: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['customerId'],
        select: {
          customerId: true, contractNumber: true, createdAt: true,
          branchId: true, deviceReceivedAt: true, shopWarrantyEndDate: true,
          branch: { select: { id: true, name: true } },
          product: { select: deviceSelect },
        },
      }),
      // (5) contractId → customerId ของสัญญาที่ยังเป็นหนี้ได้
      db.contract.findMany({
        where: { customerId: { in: ids }, deletedAt: null, status: { in: [...OPEN_CONTRACT_STATUSES] } },
        select: { id: true, customerId: true },
      }),
    ]);

    const openIds = openContracts.map(contract => contract.id);
    // (6) ผลรวมคงค้างต่อสัญญา — groupBy ครั้งเดียวสำหรับทุกสัญญาในหน้านี้
    // (7) งวดที่ครบกำหนดเร็วที่สุดต่อสัญญา — ต้องเป็น findMany + distinct ไม่ใช่ _min
    //     เพราะ groupBy ให้ MIN(due_date) กับ MIN(amount_due) จากคนละแถวได้ (ดู nextDueOf)
    const [unpaidSums, nextRows] = openIds.length
      ? await Promise.all([
          db.payment.groupBy({
            by: ['contractId'],
            where: { contractId: { in: openIds }, ...UNPAID_INSTALLMENT_WHERE },
            _sum: { amountDue: true, amountPaid: true },
          }),
          db.payment.findMany({
            where: { contractId: { in: openIds }, ...UNPAID_INSTALLMENT_WHERE },
            orderBy: [{ contractId: 'asc' }, { dueDate: 'asc' }, { installmentNo: 'asc' }],
            distinct: ['contractId'],
            select: { contractId: true, dueDate: true, amountDue: true, amountPaid: true, installmentNo: true },
          }),
        ])
      : [[], []];

    const sumByContract = new Map(unpaidSums.map(row => [row.contractId, row._sum]));
    const nextByContract = new Map(nextRows.map(row => [row.contractId, row]));

    const chipsById = new Map<string, CustomerPurchaseChips>(ids.map(id => [id, emptyChips()]));
    for (const row of saleCounts) {
      const chips = chipsById.get(row.customerId);
      if (!chips) continue;
      if (row.saleType === 'CASH') chips.cashCount += row._count._all;
      else if (row.saleType === 'EXTERNAL_FINANCE') chips.externalFinanceCount += row._count._all;
    }
    for (const row of contractCounts) {
      const chips = chipsById.get(row.customerId);
      if (!chips) continue;
      const bucket = bucketOf(row.status);
      chips.installmentByState[bucket] += row._count._all;
      // installmentTotal นับเฉพาะสัญญาที่ถือว่า "ซื้อแล้ว" — OTHER (DRAFT/EXCHANGED/
      // DEFECT_EXCHANGED) โชว์แยกในถัง OTHER แต่ไม่บวกเข้ายอดชิป "ผ่อน N" (D1)
      if (bucket !== 'OTHER') chips.installmentTotal += row._count._all;
    }

    const saleById = new Map<string, LatestSale>(latestSales.map(row => [row.customerId, row as LatestSale]));
    const contractById = new Map<string, LatestContract>(latestContracts.map(row => [row.customerId, row as LatestContract]));
    const openByCustomer = new Map<string, string[]>();
    for (const contract of openContracts) {
      const group = openByCustomer.get(contract.customerId) ?? [];
      group.push(contract.id);
      openByCustomer.set(contract.customerId, group);
    }

    for (const id of ids) {
      const sale = saleById.get(id) ?? null;
      const contract = contractById.get(id) ?? null;
      // ซื้อล่าสุด = ใบที่ createdAt ใหม่กว่า · เสมอกันให้สัญญาชนะ (เอกสารที่ลูกค้าเซ็น)
      const contractWins = !!contract && (!sale || contract.createdAt >= sale.createdAt);
      const latest = contractWins ? contract : sale;

      let latestPurchase: CustomerLatestPurchase | null = null;
      let warranty: CustomerWarrantySummary | null = null;
      if (latest) {
        latestPurchase = {
          at: latest.createdAt.toISOString(),
          kind: contractWins ? 'INSTALLMENT' : (sale!.saleType as 'CASH' | 'EXTERNAL_FINANCE'),
          number: contractWins ? contract!.contractNumber : sale!.saleNumber,
          productLabel: productLabelOf(latest.product),
          imeiSerial: latest.product?.imeiSerial ?? null,
          branchId: latest.branchId ?? latest.branch?.id ?? null,
          branchName: latest.branch?.name ?? null,
        };
        warranty = warrantyOf(contractWins ? contract : null, contractWins ? null : sale, latest.product);
      }

      const openContractIds = openByCustomer.get(id) ?? [];
      let installmentBalance: CustomerInstallmentBalance | null = null;
      if (openContractIds.length) {
        // clamp ราย **สัญญา** แล้วจึงบวก — ตรงกับการ์ด Customer 360 ที่เปิดทีละสัญญา
        // (ถ้า clamp ที่ผลรวม สัญญาที่จ่ายเกินจะไปหักหนี้ของสัญญาอีกใบ)
        const perContract = openContractIds.map(contractId => {
          const sums = sumByContract.get(contractId);
          return outstandingOf(sums ? [{ amountDue: sums.amountDue, amountPaid: sums.amountPaid }] : []);
        });
        const next = nextDueOf(
          openContractIds
            .map(contractId => nextByContract.get(contractId))
            .filter((row): row is NonNullable<typeof row> => !!row),
        );
        installmentBalance = {
          outstanding: dSum(perContract).toDecimalPlaces(2).toNumber(),
          nextDueDate: next ? next.dueDate.toISOString() : null,
          nextAmountDue: next ? next.amountDue : null,
          openContracts: openContractIds.length,
        };
      }

      result.set(id, {
        purchase: chipsById.get(id) ?? emptyChips(),
        latestPurchase,
        warranty,
        installmentBalance,
      });
    }
  }
}

/**
 * ประกันของ "เครื่องล่าสุด" — ไม่คำนวณกฎเอง ใช้ detectWarrantyStatus ตัวเดียวกับ
 * ใบซ่อม (repair-tickets) เพื่อไม่ให้ลูกค้าคนเดียวกันเห็นสถานะประกันไม่ตรงกันสองหน้า
 */
function warrantyOf(
  contract: { deviceReceivedAt: Date | null; shopWarrantyEndDate: Date | null } | null,
  sale: { shopWarrantyEndDate: Date | null } | null,
  product: { warrantyExpireDate: Date | null } | null,
): CustomerWarrantySummary {
  // สัญญาชนะใบขาย — ลำดับเดียวกับ shopWarrantyEndOf() ใน detect-warranty-status.ts
  const shopEnd = contract?.shopWarrantyEndDate ?? sale?.shopWarrantyEndDate ?? null;
  const centerEnd = product?.warrantyExpireDate ?? null;
  const endDate = !shopEnd ? centerEnd : !centerEnd ? shopEnd : shopEnd >= centerEnd ? shopEnd : centerEnd;
  const source = endDate === null ? null : endDate === shopEnd ? 'SHOP' : 'CENTER';
  return {
    endDate: endDate ? endDate.toISOString() : null,
    source,
    shopEndDate: shopEnd ? shopEnd.toISOString() : null,
    centerEndDate: centerEnd ? centerEnd.toISOString() : null,
    status: detectWarrantyStatus({ contract, sale, product }),
  };
}
