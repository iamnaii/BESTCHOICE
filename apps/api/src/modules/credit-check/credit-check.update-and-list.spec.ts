import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { CreditCheckService } from './credit-check.service';

/**
 * Characterization (golden) tests for CreditCheckService — Wave 3 backfill
 * (review finding D7). Mock-only: no DB, no `new PrismaClient()`. The service is
 * constructed directly with a jest-mocked PrismaService + a stub
 * IntegrationConfigService, mirroring credit-check.risk-score.spec.ts.
 *
 * Pins the CURRENT behaviour of three already-shipped methods:
 *
 * 1. updateWithAiFields (credit-check.service.ts ~line 711):
 *    - NotFoundException when the credit check is missing OR soft-deleted.
 *    - `!= null` gating: only NON-null/undefined provided fields reach
 *      prisma.creditCheck.update args.data — absent/null fields are omitted.
 *    - salaryPayDay side-effect: when provided ALSO calls
 *      prisma.customer.update({ salaryPayDay }) on creditCheck.customerId;
 *      when NOT provided, customer.update is never called.
 *
 * 2. getAutoScore (credit-check.service.ts ~line 945):
 *    - delegates to calculateRiskScore (stubbed), persists the score onto the
 *      credit check (aiScore / aiSummary `"{score}/100 ({riskLevel})"` /
 *      aiRecommendation / aiAnalysis { autoScore: true, factors }), and RETURNS
 *      the same result object untouched.
 *
 * 3. findAll (credit-check.service.ts ~line 27):
 *    - Promise.all([findMany(data), count, findMany(summary)]) — the FIRST
 *      findMany call is the paginated data page, the SECOND is the summary
 *      projection [{ status, aiScore }].
 *    - summary counts: pendingCount = PENDING + MANUAL_REVIEW, approvedCount =
 *      APPROVED, rejectedCount = REJECTED.
 *    - avgScore = Math.round(mean of aiScore where aiScore !== null), and 0 when
 *      there are no scored items.
 *    - pagination: page defaults 1, limit defaults 50 and is clamped to
 *      min(limit, 100); totalPages = Math.ceil(total / limit).
 *
 * Money is Prisma.Decimal in production but the code coerces via Number(...); the
 * mocks pass plain numbers (Number(6000) === 6000) which is faithful.
 */

type CreditCheckMock = {
  findUnique: jest.Mock;
  update: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
};

type CustomerMock = {
  update: jest.Mock;
};

type MockPrisma = {
  creditCheck: CreditCheckMock;
  customer: CustomerMock;
};

const makePrisma = (): MockPrisma => ({
  creditCheck: {
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  customer: {
    update: jest.fn(),
  },
});

const makeService = (prisma: MockPrisma): CreditCheckService =>
  new CreditCheckService(
    prisma as unknown as PrismaService,
    {} as unknown as IntegrationConfigService,
  );

describe('CreditCheckService.updateWithAiFields', () => {
  describe('not-found guard', () => {
    it('throws NotFoundException when the credit check is missing', async () => {
      const prisma = makePrisma();
      prisma.creditCheck.findUnique.mockResolvedValue(null);
      await expect(makeService(prisma).updateWithAiFields('nope', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.creditCheck.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the credit check is soft-deleted', async () => {
      const prisma = makePrisma();
      prisma.creditCheck.findUnique.mockResolvedValue({
        id: 'cc-1',
        deletedAt: new Date(),
        customerId: 'cu-1',
      });
      await expect(
        makeService(prisma).updateWithAiFields('cc-1', { salaryVerified: 5 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.creditCheck.update).not.toHaveBeenCalled();
    });
  });

  describe('!= null field gating', () => {
    it('includes ONLY the non-null provided fields in update args.data', async () => {
      const prisma = makePrisma();
      prisma.creditCheck.findUnique.mockResolvedValue({
        id: 'cc-1',
        deletedAt: null,
        customerId: 'cu-1',
      });
      prisma.creditCheck.update.mockResolvedValue({ id: 'cc-1' });

      await makeService(prisma).updateWithAiFields('cc-1', {
        salaryVerified: 25000,
        statementAvgIncome: 30000,
      });

      const data = prisma.creditCheck.update.mock.calls[0][0].data;
      expect(Object.keys(data).sort()).toEqual(['salaryVerified', 'statementAvgIncome']);
      expect(data.salaryVerified).toBe(25000);
      expect(data.statementAvgIncome).toBe(30000);
      // fields not passed must NOT appear
      expect(data).not.toHaveProperty('employerName');
      expect(data).not.toHaveProperty('salaryPayDay');
      expect(data).not.toHaveProperty('statementBankName');
    });

    it('produces an empty data object when no fields are provided', async () => {
      const prisma = makePrisma();
      prisma.creditCheck.findUnique.mockResolvedValue({
        id: 'cc-1',
        deletedAt: null,
        customerId: 'cu-1',
      });
      prisma.creditCheck.update.mockResolvedValue({ id: 'cc-1' });

      await makeService(prisma).updateWithAiFields('cc-1', {});

      expect(prisma.creditCheck.update.mock.calls[0][0].data).toEqual({});
    });

    it('treats falsy-but-non-null values (0, empty string, empty array) as present', async () => {
      const prisma = makePrisma();
      prisma.creditCheck.findUnique.mockResolvedValue({
        id: 'cc-1',
        deletedAt: null,
        customerId: 'cu-1',
      });
      prisma.creditCheck.update.mockResolvedValue({ id: 'cc-1' });

      await makeService(prisma).updateWithAiFields('cc-1', {
        salaryVerified: 0,
        employerName: '',
        salarySlipFiles: [],
      });

      const data = prisma.creditCheck.update.mock.calls[0][0].data;
      expect(Object.keys(data).sort()).toEqual(['employerName', 'salarySlipFiles', 'salaryVerified']);
      expect(data.salaryVerified).toBe(0);
      expect(data.employerName).toBe('');
      expect(data.salarySlipFiles).toEqual([]);
    });

    it('returns the object produced by prisma.creditCheck.update', async () => {
      const prisma = makePrisma();
      prisma.creditCheck.findUnique.mockResolvedValue({
        id: 'cc-1',
        deletedAt: null,
        customerId: 'cu-1',
      });
      const updated = { id: 'cc-1', salaryVerified: 25000 };
      prisma.creditCheck.update.mockResolvedValue(updated);

      const result = await makeService(prisma).updateWithAiFields('cc-1', {
        salaryVerified: 25000,
      });

      expect(result).toBe(updated);
    });
  });

  describe('salaryPayDay customer side-effect', () => {
    it('also updates customer.salaryPayDay on the customerId when provided', async () => {
      const prisma = makePrisma();
      prisma.creditCheck.findUnique.mockResolvedValue({
        id: 'cc-1',
        deletedAt: null,
        customerId: 'cu-42',
      });
      prisma.creditCheck.update.mockResolvedValue({ id: 'cc-1' });

      await makeService(prisma).updateWithAiFields('cc-1', { salaryPayDay: 25 });

      expect(prisma.customer.update).toHaveBeenCalledTimes(1);
      expect(prisma.customer.update.mock.calls[0][0]).toEqual({
        where: { id: 'cu-42' },
        data: { salaryPayDay: 25 },
      });
      // and it flows into the creditCheck update too
      expect(prisma.creditCheck.update.mock.calls[0][0].data.salaryPayDay).toBe(25);
    });

    it('does NOT touch customer.update when salaryPayDay is omitted', async () => {
      const prisma = makePrisma();
      prisma.creditCheck.findUnique.mockResolvedValue({
        id: 'cc-1',
        deletedAt: null,
        customerId: 'cu-42',
      });
      prisma.creditCheck.update.mockResolvedValue({ id: 'cc-1' });

      await makeService(prisma).updateWithAiFields('cc-1', { salaryVerified: 25000 });

      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });
});

describe('CreditCheckService.getAutoScore', () => {
  it('persists the auto score and returns the calculateRiskScore result verbatim', async () => {
    const prisma = makePrisma();
    prisma.creditCheck.update.mockResolvedValue({ id: 'cc-1' });
    const svc = makeService(prisma);

    const riskResult = {
      score: 72,
      riskLevel: 'MEDIUM',
      recommendation: 'ควรพิจารณาเพิ่มเติม',
      factors: [{ name: 'อายุ', weight: 15, score: 100, detail: 'ok' }],
    };
    // getAutoScore + calculateRiskScore both live on the internally-constructed
    // CreditCheckRiskService sub-service (svc.risk); getAutoScore resolves its
    // calculateRiskScore dependency through that same instance.
    const spy = jest
      .spyOn(svc.risk as unknown as { calculateRiskScore: (id: string) => Promise<typeof riskResult> }, 'calculateRiskScore')
      .mockResolvedValue(riskResult);

    const result = await svc.getAutoScore('cc-1');

    expect(spy).toHaveBeenCalledWith('cc-1');
    expect(result).toBe(riskResult);

    const args = prisma.creditCheck.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'cc-1' });
    expect(args.data.aiScore).toBe(72);
    expect(args.data.aiSummary).toContain('72/100');
    expect(args.data.aiSummary).toContain('(MEDIUM)');
    expect(args.data.aiRecommendation).toBe('ควรพิจารณาเพิ่มเติม');
    expect(args.data.aiAnalysis).toEqual({
      autoScore: true,
      factors: riskResult.factors,
    });
  });
});

describe('CreditCheckService.findAll', () => {
  type SummaryRow = { status: string; aiScore: number | null };

  const setup = (opts: {
    data?: unknown[];
    total: number;
    summary: SummaryRow[];
  }): { prisma: MockPrisma; svc: CreditCheckService } => {
    const prisma = makePrisma();
    // Promise.all order: findMany(data) -> count -> findMany(summary)
    prisma.creditCheck.findMany
      .mockResolvedValueOnce(opts.data ?? [])
      .mockResolvedValueOnce(opts.summary);
    prisma.creditCheck.count.mockResolvedValue(opts.total);
    return { prisma, svc: makeService(prisma) };
  };

  it('returns the full response shape with summary subtotals', async () => {
    const dataPage = [{ id: 'cc-1' }, { id: 'cc-2' }];
    const summary: SummaryRow[] = [
      { status: 'PENDING', aiScore: 80 },
      { status: 'MANUAL_REVIEW', aiScore: 51 },
      { status: 'APPROVED', aiScore: null },
      { status: 'REJECTED', aiScore: 40 },
    ];
    const { svc } = setup({ data: dataPage, total: 4, summary });

    const res = await svc.findAll({});

    expect(res.data).toBe(dataPage);
    expect(res.total).toBe(4);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(50);
    expect(res.totalPages).toBe(1); // ceil(4/50)
    expect(res.summary).toEqual({
      totalCount: 4,
      pendingCount: 2, // PENDING + MANUAL_REVIEW
      approvedCount: 1,
      rejectedCount: 1,
      avgScore: 57, // mean(80,51,40) = 57 -> round 57
    });
  });

  it('avgScore rounds the mean of only scored items (null aiScore excluded)', async () => {
    // scores [80, 51, null] -> mean(80, 51) = 65.5 -> Math.round -> 66
    const summary: SummaryRow[] = [
      { status: 'PENDING', aiScore: 80 },
      { status: 'APPROVED', aiScore: 51 },
      { status: 'REJECTED', aiScore: null },
    ];
    const { svc } = setup({ total: 3, summary });

    const res = await svc.findAll({});

    expect(res.summary.avgScore).toBe(66);
    expect(res.summary.pendingCount).toBe(1);
    expect(res.summary.approvedCount).toBe(1);
    expect(res.summary.rejectedCount).toBe(1);
  });

  it('avgScore is 0 when there are no scored items', async () => {
    const summary: SummaryRow[] = [
      { status: 'PENDING', aiScore: null },
      { status: 'APPROVED', aiScore: null },
    ];
    const { svc } = setup({ total: 2, summary });

    const res = await svc.findAll({});

    expect(res.summary.avgScore).toBe(0);
  });

  it('avgScore is 0 when the summary set is entirely empty', async () => {
    const { svc } = setup({ total: 0, summary: [] });

    const res = await svc.findAll({});

    expect(res.summary).toEqual({
      totalCount: 0,
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      avgScore: 0,
    });
    expect(res.totalPages).toBe(0); // ceil(0/50)
  });

  it('clamps a too-large limit to 100 and computes totalPages off the clamp', async () => {
    const { svc } = setup({ total: 250, summary: [] });

    const res = await svc.findAll({ limit: 500 });

    expect(res.limit).toBe(100); // min(500, 100)
    expect(res.page).toBe(1);
    expect(res.totalPages).toBe(3); // ceil(250/100)
  });

  it('honours an explicit page and a within-bounds limit (skip/take wiring)', async () => {
    const { prisma, svc } = setup({ total: 30, summary: [] });

    const res = await svc.findAll({ page: 2, limit: 10 });

    expect(res.page).toBe(2);
    expect(res.limit).toBe(10);
    expect(res.totalPages).toBe(3); // ceil(30/10)

    // first findMany call (the data page) gets skip/take wired from page+limit
    const dataQuery = prisma.creditCheck.findMany.mock.calls[0][0];
    expect(dataQuery.skip).toBe(10); // (2 - 1) * 10
    expect(dataQuery.take).toBe(10);
  });
});
