import { ShopHomeService } from './shop-home.service';

/**
 * ShopHomeService ประกอบ response จาก service เจ้าของข้อมูล (ไม่ตัดต้นทุน — controller ทำ).
 * ทุก dependency เป็น mock; กติกาที่ต้องตรง: spec §5 + plan Task 4.
 */
describe('ShopHomeService.build', () => {
  const owner = { id: 'owner', role: 'OWNER', branchId: null };
  const now = new Date('2026-10-22T03:00:00Z'); // 10:00 เวลาไทย 22 ต.ค.

  /** P&L ของเดือน 'YYYY-MM' → แถวรายได้/ค่าใช้จ่ายแบบที่ getProfitLossFromJournal คืน */
  type PlMonth = { s41?: number; s42?: number; s50?: number; s52?: number };
  const plRows = (m: PlMonth) => ({
    revenue: {
      rows: [
        ...(m.s41 != null ? [{ code: 'S41-1101', name: 'รายได้ขาย', amount: m.s41 }] : []),
        ...(m.s42 != null ? [{ code: 'S42-1101', name: 'รายได้อื่น', amount: m.s42 }] : []),
      ],
      total: (m.s41 ?? 0) + (m.s42 ?? 0),
    },
    expenses: {
      rows: [
        ...(m.s50 != null ? [{ code: 'S50-1101', name: 'ต้นทุนขาย', amount: m.s50 }] : []),
        ...(m.s52 != null ? [{ code: 'S52-1201', name: 'เงินเดือน', amount: m.s52 }] : []),
      ],
      total: (m.s50 ?? 0) + (m.s52 ?? 0),
    },
  });
  const monthOf = (start: Date) => new Date(start.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 7);

  const dashboard = () => ({
    stockAging: [
      { label: '0-30 วัน', min: 0, max: 30, count: 21, value: 200000 },
      { label: '31-60 วัน', min: 31, max: 60, count: 6, value: 50000 },
      { label: '61-90 วัน', min: 61, max: 90, count: 3, value: 30000 },
      { label: '90+ วัน', min: 91, max: Infinity, count: 7, value: 61200 },
    ],
    actionRequired: { inspection: 0, qcPending: 2, photoPending: 3, pendingTransfers: 1, repossessed: 2, agingOver90: 7 },
    slowMovers: [
      { name: 'Apple iPhone 14 Plus', days: 164, costPrice: 18900 },
      { name: 'Samsung S23 FE', days: 131, costPrice: 11500 },
      { name: 'Apple iPhone 12', days: 20, costPrice: 7800 },
    ],
    topSellers: [],
  });

  function deps(over: {
    pl?: Record<string, PlMonth>;
    alerts?: { total: number; data: { brand: string; model: string }[] };
    actionRequired?: Partial<ReturnType<typeof dashboard>['actionRequired']>;
    pendingApproval?: number;
    latestDraftPo?: { poNumber: string } | null;
  } = {}) {
    const pl = over.pl ?? {
      '2026-05': { s41: 312000, s50: 221000 },
      '2026-06': { s41: 298000, s50: 214000 },
      '2026-07': { s41: 355000, s50: 248000 },
      '2026-08': { s41: 341000, s50: 236000 },
      '2026-09': { s41: 372000, s50: 254000 },
      '2026-10': { s41: 384400, s42: 5000, s50: 266000, s52: 40000 },
    };
    const d = dashboard();
    d.actionRequired = { ...d.actionRequired, ...(over.actionRequired ?? {}) };
    const m = {
      prisma: {
        purchaseOrder: { findFirst: jest.fn().mockResolvedValue(over.latestDraftPo === undefined ? { poNumber: 'PO-2610-014' } : over.latestDraftPo) },
        branch: { findUnique: jest.fn().mockResolvedValue({ name: 'สาขา 2' }) },
      },
      sales: {
        getDailySummary: jest.fn().mockResolvedValue({ totalSales: 6, cashSales: 3, installmentSales: 2, externalFinanceSales: 1, totalRevenue: 48900, sales: [] }),
        getTopSellers30d: jest.fn().mockResolvedValue({ byModel: [{ name: 'Apple iPhone 15', count: 14 }], byCategory: [{ name: 'PHONE_NEW', count: 20 }] }),
      },
      bookings: { countExpiringToday: jest.fn().mockResolvedValue({ count: 2, depositTotal: 4000, reservedUnits: 2 }) },
      afterSales: { countReadyForPickup: jest.fn().mockResolvedValue({ waitingPickup: 3, overdue: 1 }) },
      cashClose: { getDrawerSnapshot: jest.fn().mockResolvedValue({ balance: 12450, closedToday: false, lastClosedAt: '2026-10-21T14:05:00.000Z' }) },
      stock: { getStockDashboard: jest.fn().mockResolvedValue(d) },
      reorderPoints: {
        getActiveAlerts: jest.fn().mockResolvedValue(
          over.alerts ?? { total: 4, data: [{ brand: 'ฟิล์ม', model: '15 Pro' }, { brand: 'เคสใส', model: '14' }, { brand: 'สายชาร์จ', model: '20W' }, { brand: 'หูฟัง', model: 'Buds' }] },
        ),
      },
      purchaseOrders: { getSummary: jest.fn().mockResolvedValue({ pendingApproval: over.pendingApproval ?? 1 }) },
      accounting: {
        getProfitLossFromJournal: jest.fn(async (start: Date, _end: Date, _companyId?: string, _scope?: string) =>
          plRows(pl[monthOf(start)] ?? {}),
        ),
      },
    };
    const service = new ShopHomeService(
      m.prisma as never, m.sales as never, m.bookings as never, m.afterSales as never, m.cashClose as never,
      m.stock as never, m.reorderPoints as never, m.purchaseOrders as never, m.accounting as never,
    );
    return { m, service };
  }

  it('ประกอบ today/watch/monthly/thisMonth/topSellers/slowMovers/stockAging ครบตามสเปก', async () => {
    const { service } = deps();
    const r = await service.build(owner, undefined, now);

    expect(r.generatedAt).toBe(now.toISOString());
    expect(r.branch).toEqual({ id: null, name: 'ทุกสาขา' });
    expect(r.today).toEqual({
      sales: { count: 6, netAmount: 48900, cash: 3, installment: 2, externalFinance: 1 },
      cashDrawer: { balance: 12450, closedToday: false, lastClosedAt: '2026-10-21T14:05:00.000Z' },
      bookingsExpiringToday: { count: 2, depositTotal: 4000, reservedUnits: 2 },
      afterSales: { waitingPickup: 3, overdue: 1 },
    });
    expect(r.watch.map((w) => w.key)).toEqual(['LOW_STOCK', 'AGING_90', 'QC_PHOTO', 'TRANSFER_PENDING', 'REPOSSESSED', 'PO_APPROVAL']);
    expect(r.watch[1]).toEqual({ key: 'AGING_90', count: 7, severity: 'urgent', detail: null, costValue: 61200 });
    expect(r.watch[2]).toEqual({ key: 'QC_PHOTO', count: 5, severity: 'wait', detail: 'รอ QC 2 · รอถ่ายรูป 3', costValue: null });
    expect(r.watch[5]).toEqual({ key: 'PO_APPROVAL', count: 1, severity: 'info', detail: 'PO-2610-014', costValue: null });
    expect(r.monthly).toHaveLength(6);
    expect(r.monthly[0]).toEqual({ month: '2026-05', sales: 312000, cost: 221000, grossProfit: 91000 });
    expect(r.monthly[5]).toEqual({ month: '2026-10', sales: 384400, cost: 266000, grossProfit: 118400 });
    expect(r.thisMonth).toEqual({ sales: 384400, salesMomPct: 3, cost: 266000, grossProfit: 118400, grossMarginPct: 31, grossProfitMomPct: 0 });
    expect(r.topSellers30d.byModel[0]).toEqual({ name: 'Apple iPhone 15', count: 14 });
    expect(r.slowMovers).toEqual([
      { name: 'Apple iPhone 14 Plus', days: 164, costPrice: 18900 },
      { name: 'Samsung S23 FE', days: 131, costPrice: 11500 },
    ]);
    expect(r.stockAging).toEqual([
      { label: '0-30 วัน', count: 21 },
      { label: '31-60 วัน', count: 6 },
      { label: '61-90 วัน', count: 3 },
      { label: '90+ วัน', count: 7 },
    ]);
  });

  it('watch: ตัดแถว count 0 และเรียง urgent→wait→info; LOW_STOCK detail รวมชื่อ 4 รายการคั่นด้วย " · "', async () => {
    const { service } = deps({ actionRequired: { qcPending: 0, photoPending: 0, pendingTransfers: 0 }, pendingApproval: 0 });
    const r = await service.build(owner, undefined, now);
    expect(r.watch.map((w) => w.key)).toEqual(['LOW_STOCK', 'AGING_90', 'REPOSSESSED']);
    expect(r.watch[0]).toEqual({
      key: 'LOW_STOCK', count: 4, severity: 'urgent',
      detail: 'ฟิล์ม 15 Pro · เคสใส 14 · สายชาร์จ 20W · หูฟัง Buds', costValue: null,
    });
  });

  it('watch ว่างเมื่อไม่มีงานค้างเลย', async () => {
    const { service } = deps({
      actionRequired: { qcPending: 0, photoPending: 0, pendingTransfers: 0, repossessed: 0, agingOver90: 0 },
      alerts: { total: 0, data: [] }, pendingApproval: 0, latestDraftPo: null,
    });
    expect((await service.build(owner, undefined, now)).watch).toEqual([]);
  });

  it('monthly: วันที่ 1 ของเดือน ขอ 6 เดือนและเดือนปัจจุบันเป็น 0 แต่ไม่ถูกตัด', async () => {
    const firstOfNov = new Date('2026-11-01T01:00:00Z'); // 08:00 ไทย 1 พ.ย.
    const { service, m } = deps({
      pl: { '2026-06': { s41: 10, s50: 5 }, '2026-07': { s41: 10, s50: 5 }, '2026-08': { s41: 10, s50: 5 }, '2026-09': { s41: 10, s50: 5 }, '2026-10': { s41: 10, s50: 5 } },
    });
    const r = await service.build(owner, undefined, firstOfNov);
    expect(r.monthly.map((x) => x.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(r.monthly[5]).toEqual({ month: '2026-11', sales: 0, cost: 0, grossProfit: 0 });
    // ช่วงเดือนที่ส่งให้ P&L ต้องเป็นเที่ยงคืนไทยวันที่ 1 ถึงสิ้นเดือน (ms สุดท้าย)
    const [start, end] = m.accounting.getProfitLossFromJournal.mock.calls[0];
    expect(start).toEqual(new Date('2026-05-31T17:00:00Z'));
    expect(end).toEqual(new Date(new Date('2026-06-30T17:00:00Z').getTime() - 1));
    expect(m.accounting.getProfitLossFromJournal.mock.calls[0][3]).toBe('SHOP');
  });

  it('monthly: เดือนนำหน้าที่ sales=0,cost=0 ถูกตัดออก (3 เดือนแรกว่าง → เหลือ 3 เดือน)', async () => {
    const { service } = deps({
      pl: { '2026-08': { s41: 100, s50: 60 }, '2026-09': { s41: 200, s50: 120 }, '2026-10': { s41: 300, s50: 180 } },
    });
    const r = await service.build(owner, undefined, now);
    expect(r.monthly.map((x) => x.month)).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('thisMonth: เดือนก่อนยอด 0 → salesMomPct และ grossProfitMomPct เป็น null ไม่ใช่ Infinity', async () => {
    const { service } = deps({ pl: { '2026-10': { s41: 300, s50: 180 } } });
    const r = await service.build(owner, undefined, now);
    expect(r.monthly).toHaveLength(1);
    expect(r.thisMonth).toEqual({ sales: 300, salesMomPct: null, cost: 180, grossProfit: 120, grossMarginPct: 40, grossProfitMomPct: null });
  });

  it('thisMonth: ไม่มีข้อมูลเลย → ยังมีเดือนปัจจุบัน 1 แถวที่เป็น 0 และ margin เป็น null', async () => {
    const { service } = deps({ pl: {} });
    const r = await service.build(owner, undefined, now);
    expect(r.monthly).toEqual([{ month: '2026-10', sales: 0, cost: 0, grossProfit: 0 }]);
    expect(r.thisMonth.grossMarginPct).toBeNull();
  });

  it('sales = Σ เฉพาะแถว S41 (S42 ไม่นับ) และ cost = Σ เฉพาะแถว S50 (ไม่รวม S52)', async () => {
    const { service } = deps();
    const r = await service.build(owner, undefined, now);
    expect(r.monthly[5].sales).toBe(384400); // ไม่รวม S42 5000
    expect(r.monthly[5].cost).toBe(266000); // ไม่รวม S52 40000
  });

  it('LOW_STOCK มาจาก getActiveAlerts (ไม่ใช่ low-stock N+1): count = total, detail = 4 รายการแรก', async () => {
    const { service, m } = deps({ alerts: { total: 9, data: [{ brand: 'A', model: '1' }, { brand: 'B', model: '2' }] } });
    const r = await service.build(owner, 'b-1', now);
    expect(m.reorderPoints.getActiveAlerts).toHaveBeenCalledWith('b-1', 1, 4);
    expect(r.watch[0]).toMatchObject({ key: 'LOW_STOCK', count: 9, detail: 'A 1 · B 2' });
  });

  it('branchId → ส่งต่อให้ทุก service ย่อย ยกเว้น P&L และ PO summary; ชื่อสาขามาจาก branch.findUnique', async () => {
    const { service, m } = deps();
    const r = await service.build(owner, 'b-2', now);
    expect(r.branch).toEqual({ id: 'b-2', name: 'สาขา 2' });
    expect(m.sales.getDailySummary).toHaveBeenCalledWith('2026-10-22', owner, 'b-2');
    expect(m.sales.getTopSellers30d).toHaveBeenCalledWith(owner, 'b-2');
    expect(m.bookings.countExpiringToday).toHaveBeenCalledWith(owner, 'b-2', now);
    expect(m.afterSales.countReadyForPickup).toHaveBeenCalledWith('b-2');
    expect(m.cashClose.getDrawerSnapshot).toHaveBeenCalledWith('b-2', now);
    expect(m.stock.getStockDashboard).toHaveBeenCalledWith('b-2');
    expect(m.purchaseOrders.getSummary).toHaveBeenCalledWith();
    expect(m.accounting.getProfitLossFromJournal.mock.calls.every((c) => c[2] === undefined)).toBe(true);
  });
});
