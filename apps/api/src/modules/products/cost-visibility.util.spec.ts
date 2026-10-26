import { redactShopHome } from './cost-visibility.util';
import type { ShopHomeResponse } from '../shop-home/shop-home.types';

/**
 * Owner decision 2026-08-04 §1.4: SALES ต้องไม่เห็นราคาทุน/กำไร บังคับที่ server.
 * หน้าหลักหน้าร้านมีต้นทุนซ่อนอยู่ 4 จุด: watch.costValue, monthly.cost/grossProfit,
 * thisMonth (ทุกช่องยกเว้นยอดขาย) และ slowMovers.costPrice.
 */
const full = (): ShopHomeResponse => ({
  generatedAt: '2026-10-22T01:12:00.000Z',
  branch: { id: null, name: 'ทุกสาขา' },
  today: {
    sales: { count: 6, netAmount: 48900, cash: 3, installment: 2, externalFinance: 1 },
    cashDrawer: { balance: 12450, closedToday: false, lastClosedAt: '2026-10-21T14:05:00.000Z' },
    bookingsExpiringToday: { count: 2, depositTotal: 4000, reservedUnits: 2 },
    afterSales: { waitingPickup: 3, overdue: 1 },
  },
  watch: [
    { key: 'LOW_STOCK', count: 4, severity: 'urgent', detail: 'ฟิล์ม 15 Pro · เคสใส 14', costValue: null },
    { key: 'AGING_90', count: 7, severity: 'urgent', detail: null, costValue: 61200 },
    { key: 'PO_APPROVAL', count: 1, severity: 'info', detail: 'PO-2610-014', costValue: null },
  ],
  monthly: [
    { month: '2026-05', sales: 312000, cost: 221000, grossProfit: 91000 },
    { month: '2026-06', sales: 298000, cost: 214000, grossProfit: 84000 },
    { month: '2026-07', sales: 355000, cost: 248000, grossProfit: 107000 },
    { month: '2026-08', sales: 341000, cost: 236000, grossProfit: 105000 },
    { month: '2026-09', sales: 372000, cost: 254000, grossProfit: 118000 },
    { month: '2026-10', sales: 384400, cost: 266000, grossProfit: 118400 },
  ],
  thisMonth: { sales: 384400, salesMomPct: 3, cost: 266000, grossProfit: 118400, grossMarginPct: 31, grossProfitMomPct: 0 },
  topSellers30d: {
    byModel: [{ name: 'Apple iPhone 15', count: 14 }],
    byCategory: [{ name: 'PHONE_NEW', count: 20 }],
  },
  slowMovers: [{ name: 'Apple iPhone 14 Plus', days: 164, costPrice: 18900 }],
  stockAging: [{ label: '0-30 วัน', count: 21 }],
});

describe('redactShopHome', () => {
  it('SALES: ตัดทุกฟิลด์ต้นทุน/กำไร แต่ count/วัน/ยอดขายคงเดิม', () => {
    const r = redactShopHome(full());

    expect(r.watch.find((w) => w.key === 'AGING_90')?.costValue).toBeNull();
    expect(r.watch.map((w) => w.count)).toEqual([4, 7, 1]);
    expect(r.monthly.every((m) => m.cost === null && m.grossProfit === null)).toBe(true);
    expect(r.monthly[5].sales).toBe(384400);
    expect(r.thisMonth).toEqual({
      sales: 384400,
      salesMomPct: 3,
      cost: null,
      grossProfit: null,
      grossMarginPct: null,
      grossProfitMomPct: null,
    });
    expect(r.slowMovers[0]).not.toHaveProperty('costPrice');
    expect(r.slowMovers[0].days).toBe(164);
    expect(r.today).toEqual(full().today);
    expect(r.topSellers30d).toEqual(full().topSellers30d);
    expect(r.stockAging).toEqual(full().stockAging);
  });

  it('ไม่แก้ object ต้นฉบับ (pure)', () => {
    const f = full();
    redactShopHome(f);
    expect(f.monthly[0].cost).toBe(221000);
    expect(f.slowMovers[0]).toHaveProperty('costPrice', 18900);
    expect(f.watch[1].costValue).toBe(61200);
  });
});
