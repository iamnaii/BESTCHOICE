import { LiffAfterSalesService } from './liff-after-sales.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTicket(overrides: Record<string, any> = {}) {
  return {
    status: 'OPEN',
    deletedAt: null,
    returnedToCustomerAt: null,
    payer: 'SHOP',
    estimatedCost: null,
    actualCost: null,
    sentToRepairAt: null,
    repairedAt: null,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCase(overrides: Record<string, any> = {}) {
  return {
    id: 'as-1',
    caseNumber: 'AS-20260920-0001',
    outcome: 'REPAIR',
    stage: 'RECEIVED',
    cancelledAt: null,
    closedAt: null,
    replacementContractId: null,
    receivedAt: new Date('2026-09-20T00:00:00.000Z'),
    approvedAt: null,
    updatedAt: new Date('2026-09-20T01:00:00.000Z'),
    deviceBrand: 'Apple',
    deviceModel: 'iPhone 13',
    // "poison" fields — ต้องไม่มีทางหลุดไปที่ response (test (c))
    deviceImei: '111111111111111',
    receivedBy: { id: 'u-1', name: 'พนักงาน A' },
    lineIdShop: 'U_line1',
    branch: { name: 'สาขาลาดพร้าว' },
    repairTicket: null,
    exchangeRequest: null,
    ...overrides,
  };
}

describe('LiffAfterSalesService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let service: LiffAfterSalesService;

  beforeEach(() => {
    prisma = {
      customer: { findFirst: jest.fn() },
      afterSalesCase: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new LiffAfterSalesService(prisma);
  });

  // ─── (a) ───────────────────────────────────────────────

  it('(a) returns {linked:false, cases:[]} when no customer matches lineIdShop', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);

    const result = await service.getMyCases('U_unknown');

    expect(result).toEqual({ linked: false, cases: [] });
    expect(prisma.afterSalesCase.findMany).not.toHaveBeenCalled();
  });

  it('(a) looks the customer up by lineIdShop + deletedAt:null only (never customerLineLink)', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);

    await service.getMyCases('U_unknown');

    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { lineIdShop: 'U_unknown', deletedAt: null },
      select: { id: true },
    });
  });

  // ─── (b) ───────────────────────────────────────────────

  it('(b) returns 1 case with correct 14-day/take-10 query shape, current step "now", costLine per payer', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    const row = buildCase({
      caseNumber: 'AS-20260920-0002',
      outcome: 'REPAIR',
      stage: 'IN_REPAIR',
      receivedAt: new Date('2026-09-20T00:00:00.000Z'),
      repairTicket: buildTicket({
        status: 'IN_PROGRESS',
        payer: 'CUSTOMER',
        estimatedCost: { toString: () => '500.00' },
        sentToRepairAt: new Date('2026-09-21T00:00:00.000Z'),
      }),
    });
    prisma.afterSalesCase.findMany.mockResolvedValue([row]);

    const result = await service.getMyCases('U_line1');

    expect(result.linked).toBe(true);
    expect(result.cases).toHaveLength(1);
    const c = result.cases[0];
    expect(c.stageLabel).toBe('กำลังซ่อม');
    expect(c.steps[1].state).toBe('now');
    expect(c.steps[0].state).toBe('done');
    expect(c.steps[2].state).toBe('idle');
    expect(c.steps[3].state).toBe('idle');
    expect(c.costLine).toBe('ค่าซ่อมประมาณ 500 บาท');

    const call = prisma.afterSalesCase.findMany.mock.calls[0][0];
    expect(call.where.customerId).toBe('cust-1');
    expect(call.where.deletedAt).toBeNull();
    expect(call.where.OR[0]).toEqual({ stage: { notIn: ['CLOSED', 'CANCELLED'] } });
    expect(call.where.OR[1].closedAt.gte).toBeInstanceOf(Date);
    const cutoffMs = call.where.OR[1].closedAt.gte.getTime();
    const expectedCutoffMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoffMs - expectedCutoffMs)).toBeLessThan(5000);
    expect(call.orderBy).toEqual({ receivedAt: 'desc' });
    expect(call.take).toBe(10);
  });

  it('(b) costLine "ชำระที่สาขา" when actualCost is set (payer CUSTOMER)', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    prisma.afterSalesCase.findMany.mockResolvedValue([
      buildCase({
        stage: 'READY_FOR_PICKUP',
        repairTicket: buildTicket({
          status: 'READY_FOR_PICKUP',
          payer: 'CUSTOMER',
          actualCost: { toString: () => '1500' },
          repairedAt: new Date('2026-09-22T00:00:00.000Z'),
        }),
      }),
    ]);

    const result = await service.getMyCases('U_line1');

    expect(result.cases[0].costLine).toBe('ค่าซ่อม 1,500 บาท ชำระที่สาขา');
  });

  it('(b) costLine "ไม่มี (ในประกันร้าน)" when payer is SHOP', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    prisma.afterSalesCase.findMany.mockResolvedValue([
      buildCase({ repairTicket: buildTicket({ payer: 'SHOP' }) }),
    ]);

    const result = await service.getMyCases('U_line1');

    expect(result.cases[0].costLine).toBe('ไม่มี (ในประกันร้าน)');
  });

  it('(b) costLine "ไม่มี (เปลี่ยนเครื่องตามประกัน)" for exchange outcomes (no repair ticket)', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    prisma.afterSalesCase.findMany.mockResolvedValue([
      buildCase({ outcome: 'SAME_MODEL_EXCHANGE', stage: 'AWAITING_APPROVAL', repairTicket: null }),
    ]);

    const result = await service.getMyCases('U_line1');

    const c = result.cases[0];
    expect(c.costLine).toBe('ไม่มี (เปลี่ยนเครื่องตามประกัน)');
    expect(c.stageLabel).toBe('รอผู้จัดการยืนยัน');
    expect(c.steps.map((s) => s.title)).toEqual([
      'รับเรื่องแล้ว',
      'รอผู้จัดการยืนยัน',
      'รอรับเครื่องใหม่',
      'ปิดเคส',
    ]);
  });

  it('(b) PRICED_EXCHANGE uses its own step titles + stageLabel', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    prisma.afterSalesCase.findMany.mockResolvedValue([
      buildCase({ outcome: 'PRICED_EXCHANGE', stage: 'AWAITING_APPROVAL', repairTicket: null }),
    ]);

    const result = await service.getMyCases('U_line1');

    const c = result.cases[0];
    expect(c.stageLabel).toBe('รออนุมัติ');
    expect(c.steps.map((s) => s.title)).toEqual([
      'รับเรื่องแล้ว',
      'รออนุมัติ',
      'ทำสัญญาใหม่',
      'ปิดเคส',
    ]);
    expect(c.steps[1].state).toBe('now');
  });

  it('(b) CANCELLED case: stageLabel ยกเลิก, step 0 done, rest idle, no "now"', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    prisma.afterSalesCase.findMany.mockResolvedValue([
      buildCase({ stage: 'CANCELLED', cancelledAt: new Date('2026-09-21T00:00:00.000Z') }),
    ]);

    const result = await service.getMyCases('U_line1');

    const c = result.cases[0];
    expect(c.stageLabel).toBe('ยกเลิก');
    expect(c.steps.map((s) => s.state)).toEqual(['done', 'idle', 'idle', 'idle']);
    expect(c.steps.every((s) => s.state !== 'now')).toBe(true);
  });

  it('(b) deviceName falls back to "เครื่องของคุณ" when brand/model are both null', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    prisma.afterSalesCase.findMany.mockResolvedValue([
      buildCase({ deviceBrand: null, deviceModel: null }),
    ]);

    const result = await service.getMyCases('U_line1');

    expect(result.cases[0].deviceName).toBe('เครื่องของคุณ');
  });

  // ─── (c) ───────────────────────────────────────────────

  it('(c) response never carries id/deviceImei/receivedBy/lineIdShop keys or values', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    prisma.afterSalesCase.findMany.mockResolvedValue([buildCase()]);

    const result = await service.getMyCases('U_line1');
    const json = JSON.stringify(result);

    expect(json).not.toMatch(/"id"\s*:/);
    expect(json).not.toMatch(/deviceImei/);
    expect(json).not.toMatch(/receivedBy/);
    expect(json).not.toMatch(/lineIdShop/);
    expect(json).not.toContain('111111111111111'); // ค่าจริงของ deviceImei
    expect(json).not.toContain('พนักงาน A'); // ค่าจริงของ receivedBy.name
    expect(json).not.toContain('U_line1'); // ค่าจริงของ lineIdShop — คนละความหมายกับ arg ที่ส่งเข้ามา
  });

  // ─── (d) ───────────────────────────────────────────────

  it('(d) reconciles a stale stored stage (repair ticket already CLOSED) before mapping to "ปิดเคส"', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    const row = buildCase({
      id: 'as-stale',
      caseNumber: 'AS-20260901-0007',
      outcome: 'REPAIR',
      stage: 'IN_REPAIR', // ค้าง — proxy นอกเส้นทางปกติปิดใบซ่อมไปแล้วโดยไม่อัปเดตแถวนี้
      repairTicket: buildTicket({
        status: 'CLOSED',
        returnedToCustomerAt: new Date('2026-09-10T00:00:00.000Z'),
        payer: 'SHOP',
      }),
    });
    prisma.afterSalesCase.findMany.mockResolvedValue([row]);

    const result = await service.getMyCases('U_line1');

    expect(result.cases).toHaveLength(1);
    expect(result.cases[0].stageLabel).toBe('ปิดเคส');
    expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledWith({
      where: { id: 'as-stale', stage: 'IN_REPAIR' },
      data: expect.objectContaining({ stage: 'CLOSED' }),
    });
  });

  it('(d) also reconciles a stale READY_FOR_PICKUP → CLOSED case correctly', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    const row = buildCase({
      id: 'as-stale-2',
      outcome: 'REPAIR',
      stage: 'READY_FOR_PICKUP',
      repairTicket: buildTicket({
        status: 'CLOSED',
        returnedToCustomerAt: new Date('2026-09-11T00:00:00.000Z'),
        payer: 'CUSTOMER',
        actualCost: { toString: () => '800' },
      }),
    });
    prisma.afterSalesCase.findMany.mockResolvedValue([row]);

    const result = await service.getMyCases('U_line1');

    expect(result.cases[0].stageLabel).toBe('ปิดเคส');
    expect(result.cases[0].steps[3].state).toBe('now');
    expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledWith({
      where: { id: 'as-stale-2', stage: 'READY_FOR_PICKUP' },
      data: expect.objectContaining({ stage: 'CLOSED' }),
    });
  });
});
