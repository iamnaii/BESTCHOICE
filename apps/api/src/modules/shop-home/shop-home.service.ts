import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import { BookingsService } from '../bookings/bookings.service';
import { AfterSalesService } from '../after-sales/after-sales.service';
import { ShopCashCloseService } from '../shop-tenders/shop-cash-close.service';
import { ProductsStockService } from '../products/products-stock.service';
import { ReorderPointsService } from '../inventory/reorder-points.service';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { AccountingService } from '../accounting/accounting.service';
import { bangkokCalendarParts, bangkokDateString, bangkokMidnight } from '../../utils/date.util';
import type { ShopHomeMonth, ShopHomeResponse, ShopHomeWatchItem } from './shop-home.types';

export type ShopHomeActor = { id: string; role: string; branchId?: string | null };

type LedgerRow = { code: string; amount: unknown };

/**
 * หน้าหลักหน้าร้าน — ประกอบ response เต็มจาก service เจ้าของข้อมูล (spec §5).
 * ไม่ตัดต้นทุนที่นี่: controller เรียก redactShopHome() ตาม canSeeCost(role).
 * ไม่ query Prisma ตรงยกเว้นเลข PO ร่างล่าสุดและชื่อสาขา (plan Task 4).
 */
@Injectable()
export class ShopHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly bookings: BookingsService,
    private readonly afterSales: AfterSalesService,
    private readonly cashClose: ShopCashCloseService,
    private readonly stock: ProductsStockService,
    private readonly reorderPoints: ReorderPointsService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly accounting: AccountingService,
  ) {}

  async build(actor: ShopHomeActor, branchId: string | undefined, now = new Date()): Promise<ShopHomeResponse> {
    const today = bangkokDateString(now);
    const [daily, drawer, expiring, pickup, dashboard, alerts, poSummary, latestDraftPo, topSellers, monthly, branch] =
      await Promise.all([
        this.sales.getDailySummary(today, actor, branchId),
        this.cashClose.getDrawerSnapshot(branchId, now),
        this.bookings.countExpiringToday(actor, branchId, now),
        this.afterSales.countReadyForPickup(branchId),
        this.stock.getStockDashboard(branchId),
        this.reorderPoints.getActiveAlerts(branchId, 1, 4),
        this.purchaseOrders.getSummary(),
        this.prisma.purchaseOrder.findFirst({
          where: { status: 'DRAFT' },
          orderBy: { createdAt: 'desc' },
          select: { poNumber: true },
        }),
        this.sales.getTopSellers30d(actor, branchId),
        this.loadMonthly(now),
        branchId
          ? this.prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } })
          : Promise.resolve(null),
      ]);

    const a = dashboard.actionRequired;
    const candidates: ShopHomeWatchItem[] = [
      {
        key: 'LOW_STOCK',
        count: alerts.total,
        severity: 'urgent',
        detail: alerts.data.slice(0, 4).map((x) => `${x.brand} ${x.model}`).join(' · ') || null,
        costValue: null,
      },
      { key: 'AGING_90', count: a.agingOver90, severity: 'urgent', detail: null, costValue: dashboard.stockAging[3]?.value ?? null },
      {
        key: 'QC_PHOTO',
        count: a.qcPending + a.photoPending,
        severity: 'wait',
        detail: `รอ QC ${a.qcPending} · รอถ่ายรูป ${a.photoPending}`,
        costValue: null,
      },
      { key: 'TRANSFER_PENDING', count: a.pendingTransfers, severity: 'wait', detail: null, costValue: null },
      { key: 'REPOSSESSED', count: a.repossessed, severity: 'wait', detail: null, costValue: null },
      { key: 'PO_APPROVAL', count: poSummary.pendingApproval, severity: 'info', detail: latestDraftPo?.poNumber ?? null, costValue: null },
    ];
    const watch = candidates.filter((w) => w.count > 0);

    const cur = monthly[monthly.length - 1];
    const prev = monthly.length >= 2 ? monthly[monthly.length - 2] : null;
    const curCost = cur.cost ?? 0;
    const curGp = cur.grossProfit ?? 0;

    return {
      generatedAt: now.toISOString(),
      branch: { id: branchId ?? null, name: branchId ? (branch?.name ?? '') : 'ทุกสาขา' },
      today: {
        sales: {
          count: daily.totalSales,
          netAmount: daily.totalRevenue,
          cash: daily.cashSales,
          installment: daily.installmentSales,
          externalFinance: daily.externalFinanceSales,
        },
        cashDrawer: drawer,
        bookingsExpiringToday: expiring,
        afterSales: pickup,
      },
      watch,
      monthly,
      thisMonth: {
        sales: cur.sales,
        salesMomPct: momPct(cur.sales, prev?.sales ?? 0),
        cost: curCost,
        grossProfit: curGp,
        grossMarginPct: cur.sales > 0 ? Math.round((curGp / cur.sales) * 100) : null,
        grossProfitMomPct: momPct(curGp, prev?.grossProfit ?? 0),
      },
      topSellers30d: topSellers,
      slowMovers: dashboard.slowMovers.filter((s) => s.days >= 30).slice(0, 5),
      stockAging: dashboard.stockAging.map((b) => ({ label: b.label, count: b.count })),
    };
  }

  /**
   * งบ SHOP รายเดือน 6 เดือนย้อนหลังจาก journal (ไม่ขึ้นกับสาขา — ledger ไม่มีสาขา):
   * ยอดขาย = Σ S41 (S42 รายได้อื่นไม่นับ), ต้นทุน = Σ S50. ตัดเดือนนำหน้าที่ว่างออก
   * แต่คงเดือนปัจจุบันไว้เสมอ.
   */
  private async loadMonthly(now: Date): Promise<ShopHomeMonth[]> {
    const { year, month } = bangkokCalendarParts(now); // month เป็น 0-based
    const rows = await Promise.all(
      Array.from({ length: 6 }, (_, i) => {
        const d = new Date(Date.UTC(year, month - 5 + i, 1));
        return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
      }).map(async ({ y, m }) => {
        const start = bangkokMidnight(y, m, 1);
        const end = new Date(bangkokMidnight(y, m + 1, 1).getTime() - 1);
        const pl = await this.accounting.getProfitLossFromJournal(start, end, undefined, 'SHOP');
        const sales = sumByPrefix(pl.revenue.rows, 'S41');
        const cost = sumByPrefix(pl.expenses.rows, 'S50');
        return { month: `${y}-${String(m + 1).padStart(2, '0')}`, sales, cost, grossProfit: sales - cost };
      }),
    );
    const firstWithData = rows.findIndex((r) => r.sales !== 0 || r.cost !== 0);
    return rows.slice(firstWithData === -1 ? rows.length - 1 : firstWithData);
  }
}

function sumByPrefix(rows: LedgerRow[], prefix: string): number {
  return rows.filter((r) => r.code.startsWith(prefix)).reduce((sum, r) => sum + Number(r.amount), 0);
}

/** % เทียบเดือนก่อน (ทั้งเดือน) — null เมื่อฐานเป็น 0 หรือติดลบ เพื่อไม่ให้ได้ Infinity/NaN */
function momPct(current: number, previous: number): number | null {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
}
