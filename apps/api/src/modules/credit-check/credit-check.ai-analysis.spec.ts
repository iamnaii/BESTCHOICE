import { InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { CreditCheckService } from './credit-check.service';

/**
 * Characterization (golden) tests for CreditCheckService AI-analysis path:
 *   - getAnthropicClient()      (credit-check.service.ts ~line 18)
 *   - performAIAnalysis()       (~line 962) — Claude-first / rule-based fallback decision
 *   - performClaudeAnalysis()   (~line 985) — SSRF guard, prompt build, JSON parse, clamp/defaults
 *
 * These PIN the EXACT current behaviour (Wave 3 backfill — review finding D7). The
 * service source is NOT modified; surprising behaviour is encoded as the golden value.
 *
 * What this file locks:
 *   - getAnthropicClient: getValue('claude-ai','apiKey') of '' / '   ' / null -> null
 *     (the `(value || '').trim()` short-circuit). The real-key `new Anthropic()`
 *     branch is intentionally NOT exercised.
 *   - performAIAnalysis routing:
 *       * client null            -> performClaudeAnalysis NOT called, rule-based returned
 *       * client + files + throw -> Claude error swallowed, rule-based returned (graceful)
 *   - performClaudeAnalysis:
 *       * SSRF guard: only `data:image/(jpeg|png|gif|webp);base64,<b64>` becomes an
 *         image block; http(s) and non-image data: URLs are skipped
 *       * slice(0,5): at most 5 image blocks regardless of input count
 *       * markdown ```json unwrap before JSON.parse
 *       * score clamp: Number.isFinite(Number(score)) ? clamp[0,100] : 50
 *         (a finite score — including 0 — is honored; only missing/NaN -> 50)
 *       * field defaults (summary/recommendation/analysis)
 *       * InternalServerErrorException when no text block in the response
 *
 * Mock-only — no DB, no real Anthropic SDK. PrismaService is a jest-mocked stub and
 * IntegrationConfigService is a stub with getValue(). Private methods are reached via
 * typed accessors / jest.spyOn on the instance, mirroring the sibling risk-score spec.
 * Money is Prisma.Decimal in production; here Number(...) coerces it, so plain JS
 * numbers in params are faithful (Number(6000) === 6000).
 */

type ConfigValue = string | null;

/** Build the service with a stub IntegrationConfig that returns `apiKey` from getValue. */
const makeService = (apiKey: ConfigValue): CreditCheckService => {
  const prisma = {} as unknown as PrismaService;
  const config = {
    getValue: jest.fn().mockResolvedValue(apiKey),
  } as unknown as IntegrationConfigService;
  const aiUsage = { record: jest.fn() } as unknown as AiUsageService;
  return new CreditCheckService(prisma, config, aiUsage);
};

/** Typed view of the private methods we drive directly. */
type AiParams = {
  bankName: string | null;
  statementMonths: number;
  statementFiles: string[];
  monthlyPayment: number;
  customerSalary: number;
  customerOccupation: string | null;
};

type Privates = {
  getAnthropicClient: () => Promise<unknown>;
  performAIAnalysis: (p: AiParams & { statementFileCount: number }) => Promise<unknown>;
  performClaudeAnalysis: (p: AiParams) => Promise<{
    score: number;
    summary: string;
    recommendation: string;
    analysis: Record<string, unknown>;
  }>;
};

// The AI-analysis methods live on the internally-constructed CreditCheckAiAnalysisService
// sub-service (svc.ai); reach the (sub-service-private) methods through it.
const asPrivate = (svc: CreditCheckService): Privates => svc.ai as unknown as Privates;

/**
 * Spy on a private method by name. We cast to a loosely-typed jest.Mock because the
 * method types are erased behind the `Record<string, unknown>` cast — this keeps the
 * `mockResolvedValue` / `mockReturnValue` / assertion calls type-safe at the call site.
 */
const spyPrivate = (svc: CreditCheckService, method: string): jest.Mock =>
  jest.spyOn(svc.ai as unknown as Record<string, () => unknown>, method) as unknown as jest.Mock;

/** A minimal fake Anthropic client whose messages.create returns a single text block. */
type FakeCreate = jest.Mock;
const fakeClientReturning = (text: string): { client: { messages: { create: FakeCreate } } } => {
  const create: FakeCreate = jest.fn().mockResolvedValue({ content: [{ type: 'text', text }] });
  return { client: { messages: { create } } };
};

const baseParams: AiParams = {
  bankName: 'KBank',
  statementMonths: 3,
  statementFiles: [],
  monthlyPayment: 6000,
  customerSalary: 30000,
  customerOccupation: 'พนักงาน',
};

// A short valid base64 payload ("ABC") used in data: URLs.
const B64 = 'QUJD';
const dataImage = (mime: string): string => `data:image/${mime};base64,${B64}`;

describe('CreditCheckService AI analysis (characterization)', () => {
  describe('getAnthropicClient', () => {
    it('returns null when apiKey is empty string', async () => {
      const svc = makeService('');
      await expect(asPrivate(svc).getAnthropicClient()).resolves.toBeNull();
    });

    it('returns null when apiKey is whitespace-only (trimmed away)', async () => {
      const svc = makeService('   ');
      await expect(asPrivate(svc).getAnthropicClient()).resolves.toBeNull();
    });

    it('returns null when apiKey is null (|| "" then trim)', async () => {
      const svc = makeService(null);
      await expect(asPrivate(svc).getAnthropicClient()).resolves.toBeNull();
    });
  });

  describe('performAIAnalysis routing', () => {
    it('skips Claude and returns rule-based result when client is null', async () => {
      const svc = makeService(null);
      const ruleResult = { score: 42, summary: 'rule', recommendation: 'rec', analysis: {} };

      const getClient = spyPrivate(svc, 'getAnthropicClient').mockResolvedValue(null);
      const claude = spyPrivate(svc, 'performClaudeAnalysis');
      const rule = spyPrivate(svc, 'performRuleBasedAnalysis').mockReturnValue(ruleResult);

      const out = await asPrivate(svc).performAIAnalysis({
        ...baseParams,
        statementFiles: [dataImage('png')],
        statementFileCount: 1,
      });

      expect(getClient).toHaveBeenCalledTimes(1);
      expect(claude).not.toHaveBeenCalled();
      expect(rule).toHaveBeenCalledTimes(1);
      expect(out).toBe(ruleResult);
    });

    it('returns rule-based result when client exists but Claude analysis throws (graceful fallback)', async () => {
      const svc = makeService('sk-test');
      const ruleResult = { score: 55, summary: 'fallback', recommendation: 'rec', analysis: {} };

      spyPrivate(svc, 'getAnthropicClient').mockResolvedValue({ messages: { create: jest.fn() } });
      const claude = spyPrivate(svc, 'performClaudeAnalysis').mockRejectedValue(
        new Error('Claude API 500'),
      );
      const rule = spyPrivate(svc, 'performRuleBasedAnalysis').mockReturnValue(ruleResult);

      const out = await asPrivate(svc).performAIAnalysis({
        ...baseParams,
        statementFiles: [dataImage('png')],
        statementFileCount: 1,
      });

      expect(claude).toHaveBeenCalledTimes(1);
      expect(rule).toHaveBeenCalledTimes(1);
      expect(out).toBe(ruleResult);
    });
  });

  describe('performClaudeAnalysis', () => {
    /** Spy getAnthropicClient on the instance to hand back a fake client. */
    const wire = (svc: CreditCheckService, fakeClient: unknown): void => {
      spyPrivate(svc, 'getAnthropicClient').mockResolvedValue(fakeClient);
    };

    type Block = { type: string };
    const blocksOf = (create: FakeCreate): Block[] =>
      create.mock.calls[0][0].messages[0].content as Block[];
    const imageBlocks = (create: FakeCreate): Block[] =>
      blocksOf(create).filter((b) => b.type === 'image');

    it('SSRF guard: only the data:image URL becomes an image block; http(s) is skipped', async () => {
      const svc = makeService('sk-test');
      const { client } = fakeClientReturning(
        JSON.stringify({ score: 80, summary: 'ok', recommendation: 'go', analysis: { a: 1 } }),
      );
      wire(svc, client);

      await asPrivate(svc).performClaudeAnalysis({
        ...baseParams,
        statementFiles: ['http://evil.example/x.png', dataImage('png')],
      });

      const imgs = imageBlocks(client.messages.create);
      expect(imgs).toHaveLength(1);
      // The text prompt block is always appended after the images.
      const last = blocksOf(client.messages.create).at(-1) as Block;
      expect(last.type).toBe('text');
    });

    it('SSRF guard: a non-image data: URL (text/plain) is skipped by the regex', async () => {
      const svc = makeService('sk-test');
      const { client } = fakeClientReturning(JSON.stringify({ score: 50 }));
      wire(svc, client);

      await asPrivate(svc).performClaudeAnalysis({
        ...baseParams,
        statementFiles: ['data:text/plain;base64,QQ==', dataImage('jpeg')],
      });

      expect(imageBlocks(client.messages.create)).toHaveLength(1);
    });

    it('caps image blocks at 5 via slice(0,5) even with 6 valid data:image URLs', async () => {
      const svc = makeService('sk-test');
      const { client } = fakeClientReturning(JSON.stringify({ score: 70 }));
      wire(svc, client);

      await asPrivate(svc).performClaudeAnalysis({
        ...baseParams,
        statementFiles: Array.from({ length: 6 }, () => dataImage('png')),
      });

      expect(imageBlocks(client.messages.create)).toHaveLength(5);
    });

    it('unwraps a ```json markdown code block before parsing', async () => {
      const svc = makeService('sk-test');
      const inner = JSON.stringify({ score: 88, summary: 'จากมาร์กดาวน์', recommendation: 'ok' });
      const { client } = fakeClientReturning('```json\n' + inner + '\n```');
      wire(svc, client);

      const out = await asPrivate(svc).performClaudeAnalysis({ ...baseParams });
      expect(out.score).toBe(88);
      expect(out.summary).toBe('จากมาร์กดาวน์');
    });

    it('clamps a score above 100 down to 100', async () => {
      const svc = makeService('sk-test');
      const { client } = fakeClientReturning(JSON.stringify({ score: 150 }));
      wire(svc, client);

      const out = await asPrivate(svc).performClaudeAnalysis({ ...baseParams });
      expect(out.score).toBe(100);
    });

    it('clamps a negative score up to 0', async () => {
      const svc = makeService('sk-test');
      const { client } = fakeClientReturning(JSON.stringify({ score: -5 }));
      wire(svc, client);

      const out = await asPrivate(svc).performClaudeAnalysis({ ...baseParams });
      expect(out.score).toBe(0);
    });

    it('falls back to 50 when score is missing (undefined -> NaN -> default)', async () => {
      const svc = makeService('sk-test');
      const { client } = fakeClientReturning(JSON.stringify({ summary: 'no score field' }));
      wire(svc, client);

      const out = await asPrivate(svc).performClaudeAnalysis({ ...baseParams });
      expect(out.score).toBe(50);
    });

    it('honors a legitimate score of 0 (regression: not collapsed to the 50 default)', async () => {
      // Previously `Number(0) || 50` turned an absolute-reject 0 into 50; the
      // finiteness gate now lets a real 0 through to the clamp unchanged.
      const svc = makeService('sk-test');
      const { client } = fakeClientReturning(JSON.stringify({ score: 0, summary: 'reject' }));
      wire(svc, client);

      const out = await asPrivate(svc).performClaudeAnalysis({ ...baseParams });
      expect(out.score).toBe(0);
    });

    it('falls back to 50 when score is non-numeric / NaN', async () => {
      const svc = makeService('sk-test');
      const { client } = fakeClientReturning(JSON.stringify({ score: 'abc' }));
      wire(svc, client);

      const out = await asPrivate(svc).performClaudeAnalysis({ ...baseParams });
      expect(out.score).toBe(50);
    });

    it('applies Thai default summary/recommendation and empty analysis when fields are missing', async () => {
      const svc = makeService('sk-test');
      const { client } = fakeClientReturning(JSON.stringify({ score: 60 }));
      wire(svc, client);

      const out = await asPrivate(svc).performClaudeAnalysis({ ...baseParams });
      expect(out.summary).toBe('วิเคราะห์โดย AI');
      expect(out.recommendation).toBe('กรุณาตรวจสอบเพิ่มเติม');
      expect(out.analysis).toEqual({});
    });

    it('passes through provided summary/recommendation/analysis verbatim', async () => {
      const svc = makeService('sk-test');
      const { client } = fakeClientReturning(
        JSON.stringify({
          score: 73,
          summary: 'สรุป AI',
          recommendation: 'แนะนำอนุมัติ',
          analysis: { monthlyIncome: 30000, affordabilityRatio: 0.2 },
        }),
      );
      wire(svc, client);

      const out = await asPrivate(svc).performClaudeAnalysis({ ...baseParams });
      expect(out).toEqual({
        score: 73,
        summary: 'สรุป AI',
        recommendation: 'แนะนำอนุมัติ',
        analysis: { monthlyIncome: 30000, affordabilityRatio: 0.2 },
      });
    });

    it('throws InternalServerErrorException when the response has no text block', async () => {
      const svc = makeService('sk-test');
      const create: FakeCreate = jest
        .fn()
        .mockResolvedValue({ content: [{ type: 'image', source: {} }] });
      wire(svc, { messages: { create } });

      await expect(asPrivate(svc).performClaudeAnalysis({ ...baseParams })).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    it('throws InternalServerErrorException when getAnthropicClient yields null', async () => {
      const svc = makeService(null);
      spyPrivate(svc, 'getAnthropicClient').mockResolvedValue(null);

      await expect(asPrivate(svc).performClaudeAnalysis({ ...baseParams })).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    // #1317 — credit-check-ai-analysis.service.ts never recorded to AiUsageLog.
    it('records AI usage (service=credit-check, method=performClaudeAnalysis) with real token counts', async () => {
      const prisma = {} as unknown as PrismaService;
      const config = { getValue: jest.fn().mockResolvedValue('sk-test') } as unknown as IntegrationConfigService;
      const aiUsage = { record: jest.fn() };
      const svc = new CreditCheckService(prisma, config, aiUsage as unknown as AiUsageService);

      const create: FakeCreate = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ score: 80 }) }],
        usage: { input_tokens: 111, output_tokens: 22 },
      });
      spyPrivate(svc, 'getAnthropicClient').mockResolvedValue({ messages: { create } });

      await asPrivate(svc).performClaudeAnalysis({ ...baseParams });

      expect(aiUsage.record).toHaveBeenCalledTimes(1);
      expect(aiUsage.record).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'credit-check',
          method: 'performClaudeAnalysis',
          model: 'claude-sonnet-4-5-20250514',
          inputTokens: 111,
          outputTokens: 22,
          status: 'success',
        }),
      );
    });
  });
});
