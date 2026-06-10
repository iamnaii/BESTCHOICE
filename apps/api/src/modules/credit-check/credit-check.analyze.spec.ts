import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { CreditCheckService } from './credit-check.service';

/**
 * Characterization (golden) tests for CreditCheckService.analyze (line ~404)
 * and .analyzeForCustomer (line ~212) — the two entry points that run an AI
 * analysis then PERSIST a regulated decision status. Wave 3 backfill (review
 * finding D7).
 *
 * Both methods share the exact same decision gate when writing back the status:
 *   score >= 60          -> 'APPROVED'
 *   60 > score >= 40     -> 'MANUAL_REVIEW'
 *   score < 40           -> 'REJECTED'
 * This file pins those THREE bands AT THEIR BOUNDARIES (60/59 and 40/39) for
 * BOTH methods, plus the two pre-flight guards they also share:
 *   - missing / soft-deleted credit check -> NotFoundException
 *   - empty statementFiles                -> BadRequestException
 *
 * Strategy:
 *   - Boundary tests jest.spyOn the PRIVATE performAIAnalysis so the score is
 *     controlled exactly — this isolates the persist-time status mapping (the
 *     regulated gate) from the scoring engine.
 *   - One true end-to-end test takes the real rule-based path (getValue -> null
 *     skips the Claude client) to prove the whole chain wires together.
 *
 * QUIRK pinned here: via the rule-based fallback the score FLOOR is 40
 * (base 50, worst affordability -10), so the no-API path can never emit a
 * REJECTED status (<40). A weak profile (salary 0) still lands >= 40 ->
 * MANUAL_REVIEW. REJECTED is reachable only when an upstream AI score (Claude)
 * comes back under 40.
 *
 * Mock-only — no DB. The service is built with a jest-mocked PrismaService
 * (creditCheck.findUnique + creditCheck.update) and a stub IntegrationConfig
 * whose getValue resolves null (no Claude API key -> rule-based fallback).
 * Money is Prisma.Decimal in production; here Number(...) coerces it, so the
 * mock passes plain numbers (Number(6000) === 6000) which is faithful to the
 * exact coercion the implementation performs.
 */

type AiAnalysisResult = {
  score: number;
  summary: string;
  recommendation: string;
  analysis: Record<string, unknown>;
};

type CustomerShape = {
  name?: string | null;
  salary?: number | null;
  occupation?: string | null;
  occupationDetail?: string | null;
};

type ContractShape = {
  monthlyPayment?: number | null;
  totalMonths?: number | null;
  financedAmount?: number | null;
} | null;

type CcOverride = {
  deletedAt?: Date | null;
  statementFiles?: string[];
  bankName?: string | null;
  statementMonths?: number;
  customer?: CustomerShape;
  contract?: ContractShape;
};

const buildCreditCheck = (over: CcOverride = {}) => ({
  id: 'cc-1',
  deletedAt: over.deletedAt ?? null,
  bankName: 'bankName' in over ? over.bankName : 'KBank',
  statementMonths: over.statementMonths ?? 3,
  statementFiles: over.statementFiles ?? ['file-1.jpg', 'file-2.jpg', 'file-3.jpg'],
  customer: {
    name: over.customer?.name ?? 'ทดสอบ',
    salary: over.customer?.salary ?? null,
    occupation: over.customer?.occupation ?? null,
    occupationDetail: over.customer?.occupationDetail ?? null,
  },
  contract: over.contract === undefined ? null : over.contract,
});

type MockPrisma = {
  creditCheck: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

/**
 * Build the service with a hand-mocked Prisma. update() echoes back its
 * args.data so assertions can read the persisted status directly off
 * update.mock.calls[0][0].data.status. getValue -> null skips Claude.
 */
const makeService = (
  creditCheck: unknown,
): { svc: CreditCheckService; prisma: MockPrisma } => {
  const prisma: MockPrisma = {
    creditCheck: {
      findUnique: jest.fn().mockResolvedValue(creditCheck),
      update: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'cc-1', ...args.data }),
      ),
    },
  };
  const config = {
    getValue: jest.fn().mockResolvedValue(null),
  };
  const svc = new CreditCheckService(
    prisma as unknown as PrismaService,
    config as unknown as IntegrationConfigService,
  );
  return { svc, prisma };
};

/**
 * Typed accessor for the private performAIAnalysis — stub it to control score.
 * The method lives on the internally-constructed CreditCheckAiAnalysisService
 * sub-service (svc.ai), which analyze / analyzeForCustomer delegate to.
 */
const spyAnalysis = (svc: CreditCheckService, result: AiAnalysisResult) =>
  jest
    .spyOn(svc.ai as unknown as Record<string, unknown>, 'performAIAnalysis' as never)
    .mockResolvedValue(result as never);

const aiResult = (score: number): AiAnalysisResult => ({
  score,
  summary: `score ${score}`,
  recommendation: 'rec',
  analysis: { traced: true },
});

const persistedStatus = (prisma: MockPrisma): string =>
  prisma.creditCheck.update.mock.calls[0][0].data.status;

// Each entry point under test, driven uniformly by id so both share the cases.
type Variant = {
  label: 'analyze' | 'analyzeForCustomer';
  call: (svc: CreditCheckService) => Promise<unknown>;
};
const VARIANTS: Variant[] = [
  { label: 'analyze', call: (svc) => svc.analyze('cc-1') },
  { label: 'analyzeForCustomer', call: (svc) => svc.analyzeForCustomer('cc-1') },
];

describe('CreditCheckService analyze / analyzeForCustomer (persist-time decision gate)', () => {
  describe.each(VARIANTS)('$label — pre-flight guards', ({ call }) => {
    it('throws NotFoundException when the credit check is missing', async () => {
      const { svc } = makeService(null);
      await expect(call(svc)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the credit check is soft-deleted', async () => {
      const { svc } = makeService(buildCreditCheck({ deletedAt: new Date() }));
      await expect(call(svc)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when there are no statement files', async () => {
      const { svc } = makeService(buildCreditCheck({ statementFiles: [] }));
      await expect(call(svc)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe.each(VARIANTS)('$label — status mapping at the boundaries', ({ call }) => {
    it('score 60 -> APPROVED (lower edge of approve band)', async () => {
      const { svc, prisma } = makeService(buildCreditCheck());
      spyAnalysis(svc, aiResult(60));
      await call(svc);
      expect(persistedStatus(prisma)).toBe('APPROVED');
    });

    it('score 59 -> MANUAL_REVIEW (just below approve)', async () => {
      const { svc, prisma } = makeService(buildCreditCheck());
      spyAnalysis(svc, aiResult(59));
      await call(svc);
      expect(persistedStatus(prisma)).toBe('MANUAL_REVIEW');
    });

    it('score 40 -> MANUAL_REVIEW (lower edge of review band)', async () => {
      const { svc, prisma } = makeService(buildCreditCheck());
      spyAnalysis(svc, aiResult(40));
      await call(svc);
      expect(persistedStatus(prisma)).toBe('MANUAL_REVIEW');
    });

    it('score 39 -> REJECTED (just below review)', async () => {
      const { svc, prisma } = makeService(buildCreditCheck());
      spyAnalysis(svc, aiResult(39));
      await call(svc);
      expect(persistedStatus(prisma)).toBe('REJECTED');
    });
  });

  describe('analyze — real rule-based end-to-end (no spy, getValue -> null)', () => {
    it('strong profile (salary 30000 / payment 6000 / 3 files / occupation) -> score 95 -> APPROVED', async () => {
      const { svc, prisma } = makeService(
        buildCreditCheck({
          customer: { salary: 30000, occupation: 'พนักงาน' },
          contract: { monthlyPayment: 6000, totalMonths: 12, financedAmount: 60000 },
          statementFiles: ['a.jpg', 'b.jpg', 'c.jpg'],
        }),
      );
      // base 50 + affordability 6000/30000=0.2 (<=0.2 => +30=80)
      //        + 3 files (+10=90) + occupation (+5=95)
      const updated = (await svc.analyze('cc-1')) as { aiScore: number; status: string };
      expect(updated.aiScore).toBe(95);
      expect(persistedStatus(prisma)).toBe('APPROVED');
    });

    it('QUIRK: weak rule-based profile (salary 0) floors at >= 40 -> MANUAL_REVIEW, never REJECTED', async () => {
      const { svc, prisma } = makeService(
        buildCreditCheck({
          customer: { salary: 0, occupation: null },
          contract: { monthlyPayment: 6000, totalMonths: 12, financedAmount: 60000 },
          statementFiles: ['only-one.jpg'],
        }),
      );
      // base 50 + no salary (-10=40) + 1 file (+5=45) + no occupation (+0=45)
      const updated = (await svc.analyze('cc-1')) as { aiScore: number; status: string };
      expect(updated.aiScore).toBe(45);
      expect(persistedStatus(prisma)).toBe('MANUAL_REVIEW');
      expect(persistedStatus(prisma)).not.toBe('REJECTED');
    });
  });
});
