import { ForbiddenException } from '@nestjs/common';
import { AfterSalesQueryService } from '../services/after-sales-query.service';

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
      },
      repairTicket: {
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
});
