import type { StockSortKey, StockSortDirection } from '@installment/shared';
import { sortedStockPageKeys } from './products-stock-sort';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import type { productInclude } from './products.service';
import { CASH_LABEL } from '../../utils/product-price-sync.util';

export interface StockListFilters {
  search?: string;
  branchId?: string;
  status?: string | string[];
  category?: string;
  brand?: string;
  model?: string;
  storage?: string;
  supplierId?: string;
  page?: number;
  limit?: number;
  sortBy?: StockSortKey;
  sortDirection?: StockSortDirection;
  groupAccessories?: boolean;
  accessoryGroupId?: string;
}

// Accessory model often means the compatible phone. Name/type distinguish e.g. a case
// from a screen protector for that same phone. Unit codes and prices are not SKU keys.
export function accessoryGroupWhere(product: {
  name: string;
  model: string;
  accessoryType: string | null;
  accessoryBrand: string | null;
  color: string | null;
  branchId: string;
}): Prisma.ProductWhereInput {
  return {
    category: 'ACCESSORY',
    name: product.name,
    model: product.model,
    accessoryType: product.accessoryType,
    accessoryBrand: product.accessoryBrand,
    color: product.color,
    branchId: product.branchId,
  };
}

const accessoryIdentity = Prisma.sql`jsonb_build_array('ACCESSORY', p.name, p.model,
  p.accessory_type, p.accessory_brand, p.color, p.branch_id)::text`;

/** Resolve the original SKU/branch even if its former representative unit was moved. */
export async function findAccessoryGroupWhere(
  prisma: PrismaService,
  key: string,
  branchId?: string,
) {
  const [group] = await prisma.$queryRaw<
    Array<Parameters<typeof accessoryGroupWhere>[0]>
  >(Prisma.sql`
    SELECT p.name, p.model, p.accessory_type AS "accessoryType", p.accessory_brand AS "accessoryBrand",
      p.color, p.branch_id AS "branchId"
    FROM products p WHERE p.deleted_at IS NULL AND p.category = 'ACCESSORY'
      AND md5(${accessoryIdentity}) = ${key}
      ${branchId ? Prisma.sql`AND p.branch_id = ${branchId}` : Prisma.empty}
    LIMIT 1
  `);
  return group ? accessoryGroupWhere(group) : null;
}

type GroupRow = {
  key: string;
  id: string;
  category: string;
  unitCount: number;
  inStockQuantity: number;
  statuses: string[];
  costPrice: Prisma.Decimal;
  costPriceMax: Prisma.Decimal;
  cashPrice: Prisma.Decimal | null;
  cashPriceMax: Prisma.Decimal | null;
  cashPriceMissingCount: number;
};

export async function findStockGroups(
  prisma: PrismaService,
  filters: StockListFilters,
  include: typeof productInclude,
) {
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 50));
  const clauses: Prisma.Sql[] = [Prisma.sql`p.deleted_at IS NULL`];
  const fields = {
    branchId: 'branch_id',
    category: 'category',
    brand: 'brand',
    model: 'model',
    storage: 'storage',
    supplierId: 'supplier_id',
  } as const;
  for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
    if (filters[key])
      clauses.push(Prisma.sql`p.${Prisma.raw(fields[key])}::text = ${filters[key]}`);
  }
  const statuses = (Array.isArray(filters.status) ? filters.status : [filters.status ?? ''])
    .flatMap((status) => status.split(','))
    .map((status) => status.trim())
    .filter(Boolean);
  // ตัวกรองสถานะแยกจากฐาน: ฐาน (clauses) ใช้นับทั้งสองฝั่งของสวิตช์ "พร้อมขาย | ทั้งหมด"
  // บนหน้ารายการสินค้า — ถ้านับรวมสถานะที่ผู้ใช้เลือก ตัวเลขฝั่งที่ไม่ได้เลือกจะผิด
  const statusClause = statuses.length
    ? Prisma.sql`p.status::text IN (${Prisma.join(statuses)})`
    : null;
  if (filters.search) {
    // Literal substring search, matching Prisma's contains semantics.
    const term = `%${filters.search.replace(/[\\%_]/g, '\\$&')}%`;
    clauses.push(Prisma.sql`(p.name ILIKE ${term} OR p.brand ILIKE ${term}
      OR p.model ILIKE ${term} OR p.imei_serial ILIKE ${term}
      OR p.accessory_type ILIKE ${term} OR p.legacy_product_code ILIKE ${term})`);
  }
  if (filters.accessoryGroupId)
    clauses.push(
      Prisma.sql`p.category = 'ACCESSORY' AND md5(${accessoryIdentity}) = ${filters.accessoryGroupId}`,
    );
  const grouped = !!filters.groupAccessories && !filters.accessoryGroupId;
  const filteredFrom = (where: Prisma.Sql[]) => Prisma.sql`
    SELECT p.*,
      CASE WHEN ${grouped} AND p.category = 'ACCESSORY'
        THEN ${accessoryIdentity}
        ELSE p.id END AS group_key
    FROM products p WHERE ${Prisma.join(where, ' AND ')}
  `;
  const filteredBase = filteredFrom(clauses);
  const filtered = statusClause ? filteredFrom([...clauses, statusClause]) : filteredBase;
  return prisma.$transaction(
    async (tx) => {
      const [{ total }] = await tx.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT group_key)::int AS total FROM (${filtered}) filtered
    `);
      // ตัวเลขบนสวิตช์ พร้อมขาย | ทั้งหมด — ฐานเดียวกับรายการ (หมวด/สาขา/คำค้น) แต่ไม่รวมตัวกรองสถานะ
      // กลุ่มอุปกรณ์นับเป็น "พร้อมขาย" เมื่อมีชิ้น IN_STOCK อย่างน้อยหนึ่งชิ้น (ตรงกับคอลัมน์คงเหลือ)
      const [{ readyTotal, allTotal }] = await tx.$queryRaw<
        Array<{ readyTotal: number; allTotal: number }>
      >(Prisma.sql`
      SELECT COUNT(DISTINCT group_key) FILTER (WHERE status::text = 'IN_STOCK')::int AS "readyTotal",
        COUNT(DISTINCT group_key)::int AS "allTotal"
      FROM (${filteredBase}) filtered
    `);
      const viewCounts = { ready: readyTotal, all: allTotal };
      const sortedKeys = filters.sortBy
        ? await sortedStockPageKeys(
            tx,
            filtered,
            filters.sortBy,
            filters.sortDirection ?? 'asc',
            grouped,
            page,
            limit,
          )
        : null;
      if (sortedKeys?.length === 0) return { ...paginatedResponse([], total, page, limit), viewCounts };
      const groups = await tx.$queryRaw<GroupRow[]>(Prisma.sql`
      WITH filtered AS (${filtered}), page_groups AS (
        SELECT group_key, MAX(created_at) AS latest FROM filtered
        ${sortedKeys ? Prisma.sql`WHERE md5(group_key) IN (${Prisma.join(sortedKeys)})` : Prisma.empty}
        GROUP BY group_key ORDER BY latest DESC, group_key ASC
        LIMIT ${limit} OFFSET ${sortedKeys ? 0 : (page - 1) * limit}
      ), priced AS (
        SELECT p.*, COALESCE(CASE WHEN p.cash_price > 0 THEN p.cash_price END, legacy.amount) AS display_cash
        FROM filtered p JOIN page_groups g ON g.group_key = p.group_key
        LEFT JOIN LATERAL (
          SELECT amount FROM product_prices
          WHERE product_id = p.id AND deleted_at IS NULL AND label LIKE ${`${CASH_LABEL}%`}
          ORDER BY (label = ${CASH_LABEL}) DESC, created_at ASC, id ASC LIMIT 1
        ) legacy ON p.cash_price IS NULL OR p.cash_price <= 0
      )
      SELECT md5(p.group_key) AS key, MIN(p.id) AS id, MIN(p.category::text) AS category,
        COUNT(*)::int AS "unitCount",
        COUNT(*) FILTER (WHERE p.status = 'IN_STOCK')::int AS "inStockQuantity",
        ARRAY_AGG(DISTINCT p.status::text ORDER BY p.status::text) AS statuses,
        MIN(p.cost_price) AS "costPrice", MAX(p.cost_price) AS "costPriceMax",
        MIN(p.display_cash) FILTER (WHERE p.display_cash > 0) AS "cashPrice",
        MAX(p.display_cash) FILTER (WHERE p.display_cash > 0) AS "cashPriceMax",
        COUNT(*) FILTER (WHERE p.display_cash IS NULL OR p.display_cash <= 0)::int AS "cashPriceMissingCount"
      FROM priced p GROUP BY p.group_key
      ORDER BY MAX(p.created_at) DESC, p.group_key ASC
    `);
      if (sortedKeys) {
        const positions = new Map(sortedKeys.map((key, index) => [key, index]));
        groups.sort((a, b) => positions.get(a.key)! - positions.get(b.key)!);
      }
      const products = await tx.product.findMany({
        where: { id: { in: groups.map((group) => group.id) }, deletedAt: null },
        include,
      });
      const byId = new Map(products.map((product) => [product.id, product]));
      const data = groups.flatMap((group) => {
        const product = byId.get(group.id);
        if (!product) return [];
        const stockGroup =
          grouped && group.category === 'ACCESSORY'
            ? {
                key: group.key,
                unitCount: group.unitCount,
                inStockQuantity: group.inStockQuantity,
                statuses: group.statuses,
                costPriceMax: group.costPriceMax,
                cashPriceMax: group.cashPriceMax,
                cashPriceMissingCount: group.cashPriceMissingCount,
              }
            : null;
        return [
          {
            ...product,
            ...(stockGroup
              ? {
                  imeiSerial: null,
                  legacyProductCode: null,
                  costPrice: group.costPrice,
                  cashPrice: group.cashPrice,
                }
              : {}),
            stockGroup,
          },
        ];
      });
      return { ...paginatedResponse(data, total, page, limit), viewCounts };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
