import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AfterSalesQueryService, LIST_FETCH_CAP } from '../services/after-sales-query.service';

const BRANCH_A = 'branch-a';
const BRANCH_B = 'branch-b';

function buildRepairTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rt-1',
    ticketNumber: 'RT-20260901-0001',
    status: 'OPEN',
    payer: 'SHOP',
    estimatedCost: null,
    actualCost: null,
    sentToRepairAt: null,
    repairedAt: null,
    repairSupplierId: null,
    deletedAt: null,
    ...overrides,
  };
}

// เคส (a): สาขา A — ใช้ทั้งใน list() และ summary()
// Task 7 — เติม approvedAt/productId/replacementProductId ให้ builder เดียว (ไม่ใช่ต่อเทสต์) ตามที่
// task-7-brief บอกไว้: R25 (d) ต้องมี approvedAt ให้ decorate() ส่งต่อ stageSince ได้ และ
// productId/replacementProductId ต้องมีให้ attachExchange() ใช้เมื่อ override เป็นเคสเปลี่ยนเครื่อง
function buildCaseA(overrides: Record<string, unknown> = {}) {
  return {
    id: 'as-a',
    caseNumber: 'AS-20260901-0001',
    source: 'WALK_IN',
    outcome: 'REPAIR',
    stage: 'RECEIVED',
    receivedAt: new Date('2026-09-01T00:00:00.000Z'),
    deviceBrand: 'Apple',
    deviceModel: 'iPhone 13',
    deviceImei: '111111111111111',
    branchId: BRANCH_A,
    replacementContractId: null,
    productId: 'prod-a-old',
    replacementProductId: null,
    approvedAt: null,
    exchangeRequest: null,
    customer: { id: 'cust-a', name: 'ลูกค้า A', phone: '0810000000' },
    branch: { id: BRANCH_A, name: 'สาขา A' },
    receivedBy: { id: 'u-a', name: 'พนักงาน A' },
    repairTicket: buildRepairTicket(),
    cancelledAt: null,
    ...overrides,
  };
}

// เคส (b): สาขา B — ใช้พิสูจน์ branch scoping ของ getCase
function buildCaseB(overrides: Record<string, unknown> = {}) {
  return {
    ...buildCaseA(),
    id: 'as-b',
    caseNumber: 'AS-20260901-0002',
    branchId: BRANCH_B,
    branch: { id: BRANCH_B, name: 'สาขา B' },
    customer: { id: 'cust-b', name: 'ลูกค้า B', phone: '0820000000' },
    ...overrides,
  };
}

describe('AfterSalesQueryService — branch scoping + summary money gate', () => {
  let prisma: any;
  let svc: AfterSalesQueryService;

  beforeEach(() => {
    prisma = {
      afterSalesCase: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      repairTicket: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      // Task 7 — attachExchange() batched lookups; ต้อง "ไม่ถูกเรียก" เมื่อไม่มีเคสเปลี่ยนเครื่อง
      // ในหน้านั้น (แถวใน (a)-(g) เป็น outcome REPAIR ล้วน — mock ไว้กันพังถ้ามีการเรียกผิดที่)
      product: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    svc = new AfterSalesQueryService(prisma as never);
  });

  describe('(a) branch scoping — Review Focus 4', () => {
    const salesA = { id: 'u-a', role: 'SALES', branchId: BRANCH_A };

    it('list: SALES สาขา A ได้ where.branchId = A แม้ dto.branchId ส่งมาเป็นสาขา B', async () => {
      prisma.afterSalesCase.findMany.mockResolvedValue([buildCaseA()]);
      prisma.afterSalesCase.count.mockResolvedValue(1);

      await svc.list({ branchId: BRANCH_B } as never, salesA);

      const findManyWhere = prisma.afterSalesCase.findMany.mock.calls[0][0].where;
      expect(findManyWhere.branchId).toBe(BRANCH_A);
      const countWhere = prisma.afterSalesCase.count.mock.calls[0][0].where;
      expect(countWhere.branchId).toBe(BRANCH_A);
    });

    it('list: role ข้ามสาขา (OWNER) ได้ where.branchId ตามที่ dto ส่งมาจริง', async () => {
      const owner = { id: 'u-owner', role: 'OWNER', branchId: null };
      prisma.afterSalesCase.findMany.mockResolvedValue([]);
      prisma.afterSalesCase.count.mockResolvedValue(0);

      await svc.list({ branchId: BRANCH_B } as never, owner);

      const findManyWhere = prisma.afterSalesCase.findMany.mock.calls[0][0].where;
      expect(findManyWhere.branchId).toBe(BRANCH_B);
    });

    it('getCase: SALES สาขา A เปิดเคสของสาขา B → ForbiddenException', async () => {
      prisma.afterSalesCase.findFirst.mockResolvedValue(buildCaseB());

      await expect(svc.getCase('as-b', salesA)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('getCase: SALES สาขา A เปิดเคสของสาขาตัวเอง → ไม่ throw', async () => {
      prisma.afterSalesCase.findFirst.mockResolvedValue({
        ...buildCaseA(),
        customer: { ...buildCaseA().customer, lineIdShop: null },
        repairTicket: { ...buildRepairTicket(), statusLogs: [] },
        events: [],
        photoKeys: [],
        purchasePhotoKeys: [],
      });

      await expect(svc.getCase('as-a', salesA)).resolves.toMatchObject({ id: 'as-a' });
    });
  });

  describe('(b) summary — เกทเงินตาม role', () => {
    it('SALES: repairCostShop และ repairCostCustomer เป็น null', async () => {
      const salesA = { id: 'u-a', role: 'SALES', branchId: BRANCH_A };
      prisma.afterSalesCase.findMany.mockResolvedValue([buildCaseA()]);
      prisma.repairTicket.findMany.mockResolvedValue([{ payer: 'SHOP', actualCost: 500 }]);

      const result = await svc.summary(salesA);

      expect(result.repairCostShop).toBeNull();
      expect(result.repairCostCustomer).toBeNull();
    });

    it('OWNER: เห็นยอดเงินจริงตาม payer', async () => {
      const owner = { id: 'u-owner', role: 'OWNER', branchId: null };
      prisma.afterSalesCase.findMany.mockResolvedValue([]);
      prisma.repairTicket.findMany.mockResolvedValue([
        { payer: 'SHOP', actualCost: 500 },
        { payer: 'CUSTOMER', actualCost: 300 },
        { payer: 'SUPPLIER_CLAIM', actualCost: null },
      ]);

      const result = await svc.summary(owner);

      expect(result.repairCostShop).toBe(500);
      expect(result.repairCostCustomer).toBe(300);
      expect(result.supplierClaims).toBe(1);
    });
  });

  describe('(c) R15 — sort ทั้งก้อนก่อน paginate (fix round 1)', () => {
    const owner = { id: 'u-owner', role: 'OWNER', branchId: null };
    const DAY_MS = 86400000;

    it('เคสค้างนานที่ receivedAt ช้ากว่าขึ้นหน้าแรกก่อนเคสไม่ค้างของ "หน้า 1" เดิม + findMany ไม่มี skip และ take = 500', async () => {
      // 3 แถวเรียง receivedAt asc ตามที่ DB คืนมา — แถวสุดท้าย (receivedAt ช้าสุด) เป็น
      // เคสค้างนาน (IN_REPAIR เกิน STALE_DAYS.IN_REPAIR = 14 วัน) ส่วนสองแถวแรกไม่ค้าง
      const notStale1 = buildCaseA({
        id: 'as-1',
        receivedAt: new Date('2026-09-01T00:00:00.000Z'),
        repairTicket: buildRepairTicket({
          status: 'IN_PROGRESS',
          sentToRepairAt: new Date(Date.now() - 5 * DAY_MS),
        }),
      });
      const notStale2 = buildCaseA({
        id: 'as-2',
        receivedAt: new Date('2026-09-05T00:00:00.000Z'),
        repairTicket: buildRepairTicket({
          status: 'IN_PROGRESS',
          sentToRepairAt: new Date(Date.now() - 3 * DAY_MS),
        }),
      });
      const staleButLatest = buildCaseA({
        id: 'as-3',
        receivedAt: new Date('2026-09-10T00:00:00.000Z'),
        repairTicket: buildRepairTicket({
          status: 'IN_PROGRESS',
          sentToRepairAt: new Date(Date.now() - 20 * DAY_MS), // ค้างเกิน 14 วัน = stale
        }),
      });
      prisma.afterSalesCase.findMany.mockResolvedValue([notStale1, notStale2, staleButLatest]);
      prisma.afterSalesCase.count.mockResolvedValue(3);

      const result = await svc.list({ page: 1, limit: 2 } as never, owner);

      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe('as-3'); // stale ต้องขึ้นก่อนแม้ receivedAt ช้าสุด
      expect(result.data[0].stale).toBe(true);
      expect(result.truncated).toBe(false);

      const findManyArgs = prisma.afterSalesCase.findMany.mock.calls[0][0];
      expect(findManyArgs.skip).toBeUndefined();
      expect(findManyArgs.take).toBe(LIST_FETCH_CAP);
    });

    it('truncated = true เมื่อยอดทั้งแท็บเกิน LIST_FETCH_CAP', async () => {
      prisma.afterSalesCase.findMany.mockResolvedValue([]);
      prisma.afterSalesCase.count.mockResolvedValue(LIST_FETCH_CAP + 1);

      const result = await svc.list({} as never, owner);

      expect(result.truncated).toBe(true);
    });
  });

  describe('(d) A1 final-fix — reconcileStage self-heals ก่อนกรอง/นับ', () => {
    const owner = { id: 'u-owner', role: 'OWNER', branchId: null };

    it('list: แถวเก็บ stage=IN_REPAIR แต่ใบซ่อมถูกปิดนอก proxy (CLOSED) → CAS updateMany แล้วหลุดจากแท็บ ACTIVE', async () => {
      const drifted = buildCaseA({
        stage: 'IN_REPAIR',
        repairTicket: buildRepairTicket({ status: 'CLOSED' }),
      });
      prisma.afterSalesCase.findMany.mockResolvedValue([drifted]);
      prisma.afterSalesCase.count.mockResolvedValue(1);

      const result = await svc.list({ tab: 'ACTIVE' } as never, owner);

      expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledWith({
        where: { id: 'as-a', stage: 'IN_REPAIR' },
        data: { stage: 'CLOSED', closedAt: expect.any(Date) },
      });
      // derived เป็น CLOSED ⇒ ไม่ตรงแท็บ ACTIVE อีกต่อไป — ต้องหลุด ไม่ใช่โชว์ค้าง
      expect(result.data).toHaveLength(0);
    });

    it('summary: แถวเปิดที่ใบซ่อมถูกปิดนอก proxy ไม่ถูกนับเป็น open/openRepair หลัง reconcile', async () => {
      const drifted = buildCaseA({
        stage: 'IN_REPAIR',
        repairTicket: buildRepairTicket({ status: 'CLOSED' }),
      });
      prisma.afterSalesCase.findMany.mockResolvedValue([drifted]);

      const result = await svc.summary(owner);

      expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledTimes(1);
      expect(result.open).toBe(0);
      expect(result.openRepair).toBe(0);
    });

    it('getCase: stage เก็บไว้ READY_FOR_PICKUP แต่ใบซ่อม CLOSED → คืน stage=CLOSED และเขียนกลับ DB', async () => {
      const owner2 = { id: 'u-owner', role: 'OWNER', branchId: null };
      prisma.afterSalesCase.findFirst.mockResolvedValue({
        ...buildCaseA(),
        stage: 'READY_FOR_PICKUP',
        repairTicket: {
          ...buildRepairTicket({ status: 'CLOSED' }),
          statusLogs: [],
          expenseDocument: null,
          otherIncome: null,
          contract: null,
        },
        customer: { ...buildCaseA().customer, lineIdShop: null },
        events: [],
        photoKeys: [],
        purchasePhotoKeys: [],
      });

      const result = await svc.getCase('as-a', owner2);

      expect(result.stage).toBe('CLOSED');
      expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledWith({
        where: { id: 'as-a', stage: 'READY_FOR_PICKUP' },
        data: { stage: 'CLOSED', closedAt: expect.any(Date) },
      });
    });
  });

  describe('(e) C1 final-fix — PII: getCase ต้องไม่ส่ง lineIdShop ดิบออกไป', () => {
    const owner = { id: 'u-owner', role: 'OWNER', branchId: null };

    it('customer.lineIdShop ไม่โผล่ในผลลัพธ์ — มีแค่ lineLinked boolean', async () => {
      prisma.afterSalesCase.findFirst.mockResolvedValue({
        ...buildCaseA(),
        customer: { id: 'cust-a', name: 'ลูกค้า A', phone: '0810000000', lineIdShop: 'U1234abcd' },
        repairTicket: {
          ...buildRepairTicket(),
          statusLogs: [],
          expenseDocument: null,
          otherIncome: null,
          contract: null,
        },
        events: [],
        photoKeys: [],
        purchasePhotoKeys: [],
      });

      const result = await svc.getCase('as-a', owner);

      expect(result.lineLinked).toBe(true);
      expect(result.customer).not.toHaveProperty('lineIdShop');
      expect(result.customer).toEqual({ id: 'cust-a', name: 'ลูกค้า A', phone: '0810000000' });
    });
  });

  describe('(f) C2 final-fix — timeline ต้องมี actorName ต่อ event', () => {
    const owner = { id: 'u-owner', role: 'OWNER', branchId: null };

    it('resolve actorName จาก user.findMany ด้วย id ที่ไม่ซ้ำกัน', async () => {
      prisma.afterSalesCase.findFirst.mockResolvedValue({
        ...buildCaseA(),
        customer: { ...buildCaseA().customer, lineIdShop: null },
        repairTicket: {
          ...buildRepairTicket(),
          statusLogs: [],
          expenseDocument: null,
          otherIncome: null,
          contract: null,
        },
        events: [
          {
            id: 'ev-1',
            kind: 'RECEIVED',
            note: null,
            actorId: 'user-9',
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
          },
          {
            id: 'ev-2',
            kind: 'OUTCOME_SET',
            note: 'เลือกทางออก',
            actorId: 'user-9',
            createdAt: new Date('2026-09-01T00:05:00.000Z'),
          },
        ],
        photoKeys: [],
        purchasePhotoKeys: [],
      });
      prisma.user.findMany.mockResolvedValue([{ id: 'user-9', name: 'พนักงาน ทดสอบ' }]);

      const result = await svc.getCase('as-a', owner);

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['user-9'] } },
        select: { id: true, name: true },
      });
      expect(result.timeline[0]).toMatchObject({ kind: 'RECEIVED', actorName: 'พนักงาน ทดสอบ' });
      expect(result.timeline[1]).toMatchObject({ kind: 'OUTCOME_SET', actorName: 'พนักงาน ทดสอบ' });
    });
  });

  describe('(g) B1 final-fix — แท็บ DONE เรียงใหม่สุดก่อนที่ DB โดยไม่ re-sort ซ้ำ', () => {
    const owner = { id: 'u-owner', role: 'OWNER', branchId: null };

    it('list({tab:DONE}) สั่ง orderBy closedAt desc nulls last · cancelledAt desc nulls last · receivedAt desc', async () => {
      prisma.afterSalesCase.findMany.mockResolvedValue([]);
      prisma.afterSalesCase.count.mockResolvedValue(0);

      await svc.list({ tab: 'DONE' } as never, owner);

      const findManyArgs = prisma.afterSalesCase.findMany.mock.calls[0][0];
      expect(findManyArgs.orderBy).toEqual([
        { closedAt: { sort: 'desc', nulls: 'last' } },
        { cancelledAt: { sort: 'desc', nulls: 'last' } },
        { receivedAt: 'desc' },
      ]);
    });

    it('list({tab:ACTIVE}) ยังคง orderBy receivedAt asc (พฤติกรรมเดิม)', async () => {
      prisma.afterSalesCase.findMany.mockResolvedValue([]);
      prisma.afterSalesCase.count.mockResolvedValue(0);

      await svc.list({ tab: 'ACTIVE' } as never, owner);

      const findManyArgs = prisma.afterSalesCase.findMany.mock.calls[0][0];
      expect(findManyArgs.orderBy).toEqual([{ receivedAt: 'asc' }]);
    });

    it('แท็บ DONE คงลำดับที่ DB ส่งมา (ใหม่สุดก่อน) ไม่ re-sort ตาม stale/stageSince', async () => {
      const closedNewest = buildCaseA({
        id: 'as-newest',
        stage: 'CLOSED',
        repairTicket: buildRepairTicket({ status: 'CLOSED' }),
        receivedAt: new Date('2026-09-01T00:00:00.000Z'),
      });
      const closedOldest = buildCaseA({
        id: 'as-oldest',
        stage: 'CLOSED',
        repairTicket: buildRepairTicket({ status: 'CLOSED' }),
        receivedAt: new Date('2026-08-01T00:00:00.000Z'),
      });
      // DB คืนมาตามลำดับ orderBy (newest ก่อน) — service ต้องไม่พลิกลำดับนี้
      prisma.afterSalesCase.findMany.mockResolvedValue([closedNewest, closedOldest]);
      prisma.afterSalesCase.count.mockResolvedValue(2);

      const result = await svc.list({ tab: 'DONE', page: 1, limit: 50 } as never, owner);

      expect(result.data.map((r) => r.id)).toEqual(['as-newest', 'as-oldest']);
    });

    it('แท็บ DONE หน้า 2 ตัดตามลำดับ DB เดิม (ไม่ re-sort ก่อน slice)', async () => {
      const rows = [
        buildCaseA({
          id: 'as-1',
          stage: 'CLOSED',
          repairTicket: buildRepairTicket({ status: 'CLOSED' }),
        }),
        buildCaseA({
          id: 'as-2',
          stage: 'CLOSED',
          repairTicket: buildRepairTicket({ status: 'CLOSED' }),
        }),
        buildCaseA({
          id: 'as-3',
          stage: 'CLOSED',
          repairTicket: buildRepairTicket({ status: 'CLOSED' }),
        }),
      ];
      prisma.afterSalesCase.findMany.mockResolvedValue(rows);
      prisma.afterSalesCase.count.mockResolvedValue(3);

      const result = await svc.list({ tab: 'DONE', page: 2, limit: 2 } as never, owner);

      expect(result.data.map((r) => r.id)).toEqual(['as-3']);
    });
  });

  describe('(h) Task 7 — exchange sub-object: SAME_MODEL แถวรออนุมัติ', () => {
    const owner = { id: 'u-owner', role: 'OWNER', branchId: null };

    it('list: exchange.kind=SAME_MODEL, approverRole=BRANCH_MANAGER, newProduct จาก replacementProductId batched', async () => {
      const row = buildCaseA({
        id: 'as-same',
        outcome: 'SAME_MODEL_EXCHANGE',
        stage: 'AWAITING_APPROVAL',
        productId: 'prod-old',
        replacementProductId: 'prod-new',
        replacementContractId: null,
      });
      prisma.afterSalesCase.findMany.mockResolvedValue([row]);
      prisma.afterSalesCase.count.mockResolvedValue(1);
      prisma.product.findMany.mockResolvedValue([
        { id: 'prod-old', brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiSerial: '111' },
        { id: 'prod-new', brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiSerial: '222' },
      ]);

      const result = await svc.list({ tab: 'AWAITING_APPROVAL' } as never, owner);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].exchange).toEqual({
        kind: 'SAME_MODEL',
        mode: null,
        approvalTier: null,
        requestStatus: null,
        buybackPrice: null,
        ncvSnapshot: null,
        approverRole: 'BRANCH_MANAGER',
        oldProduct: { brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiSerial: '111' },
        newProduct: {
          id: 'prod-new',
          brand: 'Apple',
          model: 'iPhone 13',
          storage: '128GB',
          imeiSerial: '222',
        },
        replacementContract: null,
        requestedBy: { id: 'u-a', name: 'พนักงาน A' },
      });
      expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.product.findMany).toHaveBeenCalledWith({
        where: { id: { in: expect.arrayContaining(['prod-old', 'prod-new']) }, deletedAt: null },
        select: { id: true, brand: true, model: true, storage: true, imeiSerial: true },
      });
      // ยังไม่มีสัญญาทดแทน (รออนุมัติ) — ห้ามยิง contract.findMany
      expect(prisma.contract.findMany).not.toHaveBeenCalled();
    });

    it('list: แถว SAME_MODEL READY_FOR_PICKUP มี replacementContract จาก contract.findMany แบบ batched (ไม่ผ่าน exchangeRequest)', async () => {
      const row = buildCaseA({
        id: 'as-same-ready',
        outcome: 'SAME_MODEL_EXCHANGE',
        stage: 'READY_FOR_PICKUP',
        productId: 'prod-old',
        replacementProductId: 'prod-new',
        replacementContractId: 'contract-sm-1',
      });
      prisma.afterSalesCase.findMany.mockResolvedValue([row]);
      prisma.afterSalesCase.count.mockResolvedValue(1);
      prisma.product.findMany.mockResolvedValue([
        { id: 'prod-old', brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiSerial: '111' },
        { id: 'prod-new', brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiSerial: '222' },
      ]);
      prisma.contract.findMany.mockResolvedValue([
        { id: 'contract-sm-1', contractNumber: 'CT-9001', status: 'DRAFT' },
      ]);

      const result = await svc.list({ tab: 'READY' } as never, owner);

      expect(result.data[0].exchange?.replacementContract).toEqual({
        id: 'contract-sm-1',
        contractNumber: 'CT-9001',
        status: 'DRAFT',
      });
      expect(prisma.contract.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.contract.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['contract-sm-1'] }, deletedAt: null },
        select: { id: true, contractNumber: true, status: true },
      });
    });
  });

  describe('(i) Task 7 — exchange sub-object: PRICED ESCALATE', () => {
    const owner = { id: 'u-owner', role: 'OWNER', branchId: null };

    it('list: approverRole=OWNER (ESCALATE), mode/buybackPrice/ncvSnapshot string 2dp, replacementContract จาก exchangeRequest.newContract (ไม่ query contract.findMany)', async () => {
      const row = buildCaseA({
        id: 'as-priced',
        outcome: 'PRICED_EXCHANGE',
        stage: 'AWAITING_APPROVAL',
        productId: 'prod-old2',
        replacementProductId: 'prod-new2',
        replacementContractId: null,
        exchangeRequest: {
          status: 'PENDING',
          mode: 'PRICED',
          approvalTier: 'ESCALATE',
          buybackPrice: new Prisma.Decimal('8000'),
          ncvSnapshot: new Prisma.Decimal('9500.5'),
          memoAppliedAt: null,
          rejectionReason: null,
          cancelReason: null,
          canceledAt: null,
          approvedAt: null,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
          newContract: null,
        },
      });
      prisma.afterSalesCase.findMany.mockResolvedValue([row]);
      prisma.afterSalesCase.count.mockResolvedValue(1);
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'prod-old2',
          brand: 'Apple',
          model: 'iPhone 14',
          storage: '256GB',
          imeiSerial: '333',
        },
        {
          id: 'prod-new2',
          brand: 'Apple',
          model: 'iPhone 15',
          storage: '256GB',
          imeiSerial: '444',
        },
      ]);

      const result = await svc.list({ tab: 'AWAITING_APPROVAL' } as never, owner);

      expect(result.data[0].exchange).toMatchObject({
        kind: 'PRICED',
        mode: 'PRICED',
        approvalTier: 'ESCALATE',
        requestStatus: 'PENDING',
        buybackPrice: '8000.00',
        ncvSnapshot: '9500.50',
        approverRole: 'OWNER',
        replacementContract: null,
      });
      expect(prisma.contract.findMany).not.toHaveBeenCalled();
    });

    it('list: PRICED ที่ไม่ใช่ ESCALATE (REVIEW) → approverRole=BRANCH_MANAGER', async () => {
      const row = buildCaseA({
        id: 'as-priced-review',
        outcome: 'PRICED_EXCHANGE',
        stage: 'AWAITING_APPROVAL',
        productId: 'prod-old2',
        replacementProductId: 'prod-new2',
        replacementContractId: null,
        exchangeRequest: {
          status: 'PENDING',
          mode: 'PRICED',
          approvalTier: 'REVIEW',
          buybackPrice: null,
          ncvSnapshot: null,
          memoAppliedAt: null,
          rejectionReason: null,
          cancelReason: null,
          canceledAt: null,
          approvedAt: null,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
          newContract: null,
        },
      });
      prisma.afterSalesCase.findMany.mockResolvedValue([row]);
      prisma.afterSalesCase.count.mockResolvedValue(1);
      prisma.product.findMany.mockResolvedValue([]);

      const result = await svc.list({ tab: 'AWAITING_APPROVAL' } as never, owner);

      expect(result.data[0].exchange).toMatchObject({
        approvalTier: 'REVIEW',
        approverRole: 'BRANCH_MANAGER',
        buybackPrice: null,
        ncvSnapshot: null,
      });
    });
  });

  describe('(j) Task 7 — summary: openExchange/exchanges', () => {
    const owner = { id: 'u-owner', role: 'OWNER', branchId: null };

    it('openExchange นับเฉพาะเคสเปิด outcome เปลี่ยนเครื่อง (ไม่รวม REPAIR); exchanges มาจาก count() ที่ closedAt เดือนนี้', async () => {
      const openRepair = buildCaseA({ id: 'as-1', outcome: 'REPAIR' });
      const openSameModel = buildCaseA({
        id: 'as-2',
        outcome: 'SAME_MODEL_EXCHANGE',
        stage: 'AWAITING_APPROVAL',
        replacementContractId: null,
      });
      const openPriced = buildCaseA({
        id: 'as-3',
        outcome: 'PRICED_EXCHANGE',
        stage: 'AWAITING_APPROVAL',
        exchangeRequest: {
          status: 'PENDING',
          mode: 'PRICED',
          approvalTier: 'REVIEW',
          buybackPrice: null,
          ncvSnapshot: null,
          memoAppliedAt: null,
          rejectionReason: null,
          cancelReason: null,
          canceledAt: null,
          approvedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          newContract: null,
        },
      });
      prisma.afterSalesCase.findMany.mockResolvedValue([openRepair, openSameModel, openPriced]);
      prisma.repairTicket.findMany.mockResolvedValue([]);
      prisma.afterSalesCase.count.mockResolvedValue(4);

      const result = await svc.summary(owner);

      expect(result.openExchange).toBe(2);
      expect(result.exchanges).toBe(4);
      const countArgs = prisma.afterSalesCase.count.mock.calls[0][0];
      expect(countArgs.where.outcome).toEqual({ in: ['SAME_MODEL_EXCHANGE', 'PRICED_EXCHANGE'] });
      expect(countArgs.where.closedAt.gte).toBeInstanceOf(Date);
      // residual sweep — swap ที่ถูกยกเลิกหลังปิด (closedAt ยังอยู่ แต่ cancelledAt ตั้งแล้ว) ไม่นับ
      expect(countArgs.where.cancelledAt).toBeNull();
    });
  });

  describe('(k) R25 (a) — total ใต้ dto.stale = จำนวนหลังกรอง ไม่ใช่ DB count', () => {
    const owner = { id: 'u-owner', role: 'OWNER', branchId: null };
    const DAY_MS = 86400000;

    it('stale=true → total = แถวที่ผ่านตัวกรอง stale จริง (truncated ยังอิง DB count เดิม)', async () => {
      const staleRow = buildCaseA({
        id: 'as-stale',
        repairTicket: buildRepairTicket({
          status: 'IN_PROGRESS',
          sentToRepairAt: new Date(Date.now() - 20 * DAY_MS),
        }),
      });
      const freshRow = buildCaseA({
        id: 'as-fresh',
        repairTicket: buildRepairTicket({
          status: 'IN_PROGRESS',
          sentToRepairAt: new Date(Date.now() - 1 * DAY_MS),
        }),
      });
      prisma.afterSalesCase.findMany.mockResolvedValue([staleRow, freshRow]);
      // DB count ของทั้งแท็บ (ไม่กรอง stale) — ต้อง "ไม่" ใช่ค่านี้เป็น total ที่คืนออกไป
      prisma.afterSalesCase.count.mockResolvedValue(50);

      const result = await svc.list({ stale: true } as never, owner);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('as-stale');
      expect(result.total).toBe(1);
      expect(result.truncated).toBe(false); // ยังอิง DB count (50) ไม่ใช่ total ใหม่ (50 ≤ 500)
    });
  });

  describe('(l) Task 7 — getCase: timeline ของคำขอเปลี่ยนเครื่องมีราคา', () => {
    const owner = { id: 'u-owner', role: 'OWNER', branchId: null };

    it('มี EXCHANGE_REQUESTED + EXCHANGE_APPROVED และเรียงตามเวลาร่วมกับ event เดิม', async () => {
      const requestedAt = new Date('2026-09-01T00:00:00.000Z');
      const approvedAt = new Date('2026-09-02T00:00:00.000Z');
      prisma.afterSalesCase.findFirst.mockResolvedValue({
        ...buildCaseA({
          outcome: 'PRICED_EXCHANGE',
          stage: 'READY_FOR_PICKUP',
          approvedAt,
          productId: 'prod-old3',
          replacementProductId: 'prod-new3',
          replacementContractId: 'contract-new-1',
        }),
        customer: { ...buildCaseA().customer, lineIdShop: null },
        repairTicket: null,
        exchangeRequest: {
          status: 'APPROVED',
          mode: 'PRICED',
          approvalTier: 'AUTO',
          buybackPrice: new Prisma.Decimal('5000.00'),
          ncvSnapshot: new Prisma.Decimal('6000.00'),
          memoAppliedAt: null,
          rejectionReason: null,
          cancelReason: null,
          canceledAt: null,
          approvedAt,
          createdAt: requestedAt,
          updatedAt: approvedAt,
          // status DRAFT กันไม่ให้ reconcileStage เห็นว่า derived = CLOSED (newContractStatus !== DRAFT)
          // ทั้งที่ stored stage เป็น READY_FOR_PICKUP — เทสต์นี้ตรวจ timeline ไม่ใช่ reconcile drift
          newContract: { id: 'contract-new-1', contractNumber: 'CT-0001', status: 'DRAFT' },
        },
        // T7-4 — event ของเคสมาไม่เรียงเวลา (ตัวหลังสุดอยู่ก่อน) เพื่อพิสูจน์ว่า getCase sort จริง
        events: [
          {
            id: 'ev-2',
            kind: 'PHOTO_ADDED',
            note: null,
            actorId: null,
            createdAt: new Date('2026-09-03T00:00:00.000Z'),
          },
          {
            id: 'ev-1',
            kind: 'RECEIVED',
            note: null,
            actorId: null,
            createdAt: new Date('2026-08-31T00:00:00.000Z'),
          },
        ],
        photoKeys: [],
        purchasePhotoKeys: [],
      });
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'prod-old3',
          brand: 'Apple',
          model: 'iPhone 14',
          storage: '256GB',
          imeiSerial: '333',
        },
        {
          id: 'prod-new3',
          brand: 'Apple',
          model: 'iPhone 15',
          storage: '256GB',
          imeiSerial: '444',
        },
      ]);

      const result = await svc.getCase('as-a', owner);

      const kinds = result.timeline.map((t: { kind: string }) => t.kind);
      // T7-4 — ลำดับตายตัว: event ของเคส + event สังเคราะห์ของคำขอ สลับกันตามเวลาจริง
      expect(kinds).toEqual(['RECEIVED', 'EXCHANGE_REQUESTED', 'EXCHANGE_APPROVED', 'PHOTO_ADDED']);
      expect(result.exchange).toMatchObject({
        kind: 'PRICED',
        approverRole: 'BRANCH_MANAGER',
        buybackPrice: '5000.00',
        ncvSnapshot: '6000.00',
        replacementContract: { id: 'contract-new-1', contractNumber: 'CT-0001', status: 'DRAFT' },
      });
      expect(prisma.contract.findMany).not.toHaveBeenCalled();
    });
  });

  describe('(m) final fix wave — timeline I5/M6, ค้นเลขสัญญา M9, batching T7-1/T7-5, stageSince T7-2', () => {
    const owner = { id: 'u-owner', role: 'OWNER', branchId: null };
    const requestedAt = new Date('2026-09-01T00:00:00.000Z');
    const decidedAt = new Date('2026-09-02T00:00:00.000Z');

    function pricedCaseRow(
      request: Record<string, unknown>,
      events: Array<{ kind: string; createdAt: Date }> = [],
      stage = 'CANCELLED',
    ) {
      return {
        ...buildCaseA({
          outcome: 'PRICED_EXCHANGE',
          stage,
          cancelledAt: stage === 'CANCELLED' ? decidedAt : null,
          productId: null,
          replacementProductId: null,
        }),
        customer: { ...buildCaseA().customer, lineIdShop: null },
        repairTicket: null,
        exchangeRequest: {
          status: 'REJECTED',
          mode: 'PRICED',
          approvalTier: 'REVIEW',
          buybackPrice: null,
          ncvSnapshot: null,
          memoAppliedAt: null,
          rejectionReason: null,
          cancelReason: null,
          canceledAt: null,
          approvedAt: null,
          createdAt: requestedAt,
          updatedAt: decidedAt,
          newContract: null,
          ...request,
        },
        events: events.map((e, i) => ({ id: `ev-${i}`, note: null, actorId: null, ...e })),
        photoKeys: [],
        purchasePhotoKeys: [],
      };
    }
    const kindsOf = (r: { timeline: Array<{ kind: string }> }) => r.timeline.map((t) => t.kind);

    it('I5/T7-3: คำขอ REJECTED (engine เขียน approvedAt ตอนปฏิเสธ) → มี EXCHANGE_REJECTED แต่ไม่มี EXCHANGE_APPROVED', async () => {
      prisma.afterSalesCase.findFirst.mockResolvedValue(
        pricedCaseRow({
          status: 'REJECTED',
          approvedAt: decidedAt,
          rejectionReason: 'ราคาไม่ผ่าน',
        }),
      );
      const result = await svc.getCase('as-a', owner);
      expect(kindsOf(result)).toEqual(['EXCHANGE_REQUESTED', 'EXCHANGE_REJECTED']);
      expect(result.timeline[1]).toMatchObject({ note: 'ราคาไม่ผ่าน' });
    });

    it('T7-3: คำขอ CANCELED หลังอนุมัติ → EXCHANGE_APPROVED + EXCHANGE_CANCELED (ผ่าน endpoint เก่า ไม่มี event ของเคส)', async () => {
      const canceledAt = new Date('2026-09-05T00:00:00.000Z');
      prisma.afterSalesCase.findFirst.mockResolvedValue(
        pricedCaseRow({
          status: 'CANCELED',
          approvedAt: decidedAt,
          canceledAt,
          cancelReason: 'ลูกค้าคืนเครื่อง',
        }),
      );
      const result = await svc.getCase('as-a', owner);
      expect(kindsOf(result)).toEqual([
        'EXCHANGE_REQUESTED',
        'EXCHANGE_APPROVED',
        'EXCHANGE_CANCELED',
      ]);
    });

    it('M6: การกระทำผ่าน hub (มี event APPROVED/CANCELLED/REJECTED ของเคสเองภายใน 60 วิ) → ไม่สังเคราะห์ EXCHANGE_* ซ้ำ', async () => {
      const canceledAt = new Date('2026-09-05T00:00:00.000Z');
      prisma.afterSalesCase.findFirst.mockResolvedValue(
        pricedCaseRow({ status: 'CANCELED', approvedAt: decidedAt, canceledAt }, [
          { kind: 'APPROVED', createdAt: new Date(decidedAt.getTime() + 2_000) },
          { kind: 'CANCELLED', createdAt: new Date(canceledAt.getTime() + 1_500) },
        ]),
      );
      const result = await svc.getCase('as-a', owner);
      expect(kindsOf(result)).toEqual(['EXCHANGE_REQUESTED', 'APPROVED', 'CANCELLED']);

      prisma.afterSalesCase.findFirst.mockResolvedValue(
        pricedCaseRow({ status: 'REJECTED', approvedAt: decidedAt }, [
          { kind: 'REJECTED', createdAt: new Date(decidedAt.getTime() + 3_000) },
        ]),
      );
      const rejected = await svc.getCase('as-a', owner);
      expect(kindsOf(rejected)).toEqual(['EXCHANGE_REQUESTED', 'REJECTED']);
    });

    it('M6: event ของเคสห่างเกิน 60 วิ (คนละครั้ง) → ยังสังเคราะห์ EXCHANGE_APPROVED', async () => {
      prisma.afterSalesCase.findFirst.mockResolvedValue(
        pricedCaseRow(
          { status: 'APPROVED', approvedAt: decidedAt },
          [{ kind: 'APPROVED', createdAt: new Date(decidedAt.getTime() + 120_000) }],
          'READY_FOR_PICKUP',
        ),
      );
      const result = await svc.getCase('as-a', owner);
      expect(kindsOf(result)).toEqual(['EXCHANGE_REQUESTED', 'EXCHANGE_APPROVED', 'APPROVED']);
    });

    it('M9: list q → หาเลขสัญญาด้วย contract.findMany (deletedAt: null) แล้วเพิ่ม contractId in [...] ใน OR', async () => {
      prisma.contract.findMany.mockResolvedValueOnce([{ id: 'ct-1' }, { id: 'ct-2' }]);
      await svc.list({ q: 'CT-2026' } as never, owner);

      expect(prisma.contract.findMany).toHaveBeenCalledWith({
        where: { contractNumber: { contains: 'CT-2026', mode: 'insensitive' }, deletedAt: null },
        select: { id: true },
        take: LIST_FETCH_CAP,
      });
      const where = prisma.afterSalesCase.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual(expect.arrayContaining([{ contractId: { in: ['ct-1', 'ct-2'] } }]));
    });

    it('M9: ไม่เจอสัญญาที่ตรง → ไม่เพิ่มเงื่อนไข contractId', async () => {
      await svc.list({ q: 'zzz' } as never, owner);
      const where = prisma.afterSalesCase.findMany.mock.calls[0][0].where;
      expect(where.OR.some((c: Record<string, unknown>) => 'contractId' in c)).toBe(false);
    });

    it('T7-1: หลายแถวเปลี่ยนเครื่อง (SAME_MODEL 2 แถวมีสัญญาใหม่) → product.findMany และ contract.findMany ครั้งเดียวต่อหน้า', async () => {
      const rows = ['1', '2', '3'].map((n) =>
        buildCaseA({
          id: `as-${n}`,
          outcome: 'SAME_MODEL_EXCHANGE',
          stage: 'READY_FOR_PICKUP',
          productId: `old-${n}`,
          replacementProductId: `new-${n}`,
          replacementContractId: `ct-${n}`,
          repairTicket: null,
        }),
      );
      prisma.afterSalesCase.findMany.mockResolvedValue(rows);
      prisma.afterSalesCase.count.mockResolvedValue(3);
      prisma.contract.findMany.mockResolvedValue(
        rows.map((r) => ({
          id: r.replacementContractId,
          contractNumber: `N-${r.id}`,
          status: 'DRAFT',
        })),
      );

      const result = await svc.list({ tab: 'READY' } as never, owner);

      expect(result.data).toHaveLength(3);
      expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.contract.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.contract.findMany.mock.calls[0][0].where.id.in).toEqual([
        'ct-1',
        'ct-2',
        'ct-3',
      ]);
    });

    it('T7-2: READY_FOR_PICKUP ของทางออกเปลี่ยนเครื่อง → stageSince/daysInStage/stale นับจาก approvedAt ไม่ใช่ receivedAt', async () => {
      const approvedAt = new Date(Date.now() - 9 * 86400000); // เกินเพดาน 7 วันของ READY_FOR_PICKUP
      const row = buildCaseA({
        id: 'as-ready',
        outcome: 'SAME_MODEL_EXCHANGE',
        stage: 'READY_FOR_PICKUP',
        receivedAt: new Date(Date.now() - 30 * 86400000),
        approvedAt,
        replacementContractId: 'ct-r',
        repairTicket: null,
      });
      prisma.afterSalesCase.findMany.mockResolvedValue([row]);
      prisma.afterSalesCase.count.mockResolvedValue(1);

      const result = await svc.list({ tab: 'READY' } as never, owner);

      expect(result.data[0].stageSince).toEqual(approvedAt);
      expect(result.data[0].daysInStage).toBe(9);
      expect(result.data[0].stale).toBe(true);
    });

    it('T7-5: หน้าที่มีแต่เคสซ่อม → ไม่ยิง product.findMany/contract.findMany เลย', async () => {
      prisma.afterSalesCase.findMany.mockResolvedValue([buildCaseA(), buildCaseB()]);
      prisma.afterSalesCase.count.mockResolvedValue(2);

      await svc.list({} as never, owner);

      expect(prisma.product.findMany).not.toHaveBeenCalled();
      expect(prisma.contract.findMany).not.toHaveBeenCalled();
    });
  });

  describe('(n) Task 8 — getCase().lineEvents', () => {
    const owner = { id: 'u-owner', role: 'OWNER', branchId: null };

    it('กรองเฉพาะ event ที่ note ขึ้นต้น [AFTER_SALES_ (ไม่รวมบันทึกทั่วไป) เรียงใหม่สุดก่อน', async () => {
      prisma.afterSalesCase.findFirst.mockResolvedValue({
        ...buildCaseA(),
        customer: { ...buildCaseA().customer, lineIdShop: null },
        repairTicket: {
          ...buildRepairTicket(),
          statusLogs: [],
          expenseDocument: null,
          otherIncome: null,
          contract: null,
        },
        events: [
          {
            id: 'ev-1',
            kind: 'LINE_SENT',
            note: '[AFTER_SALES_READY] มารับได้แล้ว · ส่งแล้ว',
            actorId: null,
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
          },
          {
            id: 'ev-2',
            kind: 'NOTE',
            note: 'บันทึกทั่วไป',
            actorId: null,
            createdAt: new Date('2026-09-01T00:05:00.000Z'),
          },
          {
            id: 'ev-3',
            kind: 'NOTE',
            note: '[AFTER_SALES_CLOSED] ปิดเคส · ส่งไม่สำเร็จ (429)',
            actorId: null,
            createdAt: new Date('2026-09-01T00:10:00.000Z'),
          },
        ],
        photoKeys: [],
        purchasePhotoKeys: [],
      });

      const result = await svc.getCase('as-a', owner);

      expect(result.lineEvents).toHaveLength(2);
      // ใหม่สุดก่อน (ev-3 createdAt ทีหลัง ev-1) — บันทึกทั่วไป (ev-2) ไม่ปนเข้ามา
      expect(result.lineEvents[0]).toMatchObject({
        kind: 'NOTE',
        note: '[AFTER_SALES_CLOSED] ปิดเคส · ส่งไม่สำเร็จ (429)',
        at: '2026-09-01T00:10:00.000Z',
      });
      expect(result.lineEvents[1]).toMatchObject({
        kind: 'LINE_SENT',
        note: '[AFTER_SALES_READY] มารับได้แล้ว · ส่งแล้ว',
        at: '2026-09-01T00:00:00.000Z',
      });
      expect(result.lineEvents.some((e: { note: string }) => e.note === 'บันทึกทั่วไป')).toBe(
        false,
      );
    });

    it('จำกัดสูงสุด 5 แถว แม้มี event LINE ที่ note ขึ้นต้น [AFTER_SALES_ มากกว่านั้น', async () => {
      const events = Array.from({ length: 7 }, (_, i) => ({
        id: `ev-${i}`,
        kind: 'LINE_SENT',
        note: `[AFTER_SALES_READY] มารับได้แล้ว · ส่งแล้ว (${i})`,
        actorId: null,
        createdAt: new Date(2026, 8, 1, 0, i, 0),
      }));
      prisma.afterSalesCase.findFirst.mockResolvedValue({
        ...buildCaseA(),
        customer: { ...buildCaseA().customer, lineIdShop: null },
        repairTicket: {
          ...buildRepairTicket(),
          statusLogs: [],
          expenseDocument: null,
          otherIncome: null,
          contract: null,
        },
        events,
        photoKeys: [],
        purchasePhotoKeys: [],
      });

      const result = await svc.getCase('as-a', owner);

      expect(result.lineEvents).toHaveLength(5);
      // ใหม่สุดก่อน — index 6 (สร้างล่าสุด) มาก่อน index 2 (ตัวที่ 5 จากท้าย)
      expect(result.lineEvents[0].note).toContain('(6)');
      expect(result.lineEvents[4].note).toContain('(2)');
    });
  });
});
