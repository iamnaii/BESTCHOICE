import { Test } from '@nestjs/testing';
import { LlmProviderRegistry } from './llm-provider.registry';
import { ClaudeProvider } from './claude.provider';
import { GeminiProvider } from './gemini.provider';
import { PrismaService } from '../../../prisma/prisma.service';

describe('LlmProviderRegistry', () => {
  const fakeClaude = { providerName: 'claude' as const, chat: jest.fn() };
  // Gemini stub defaults to ready=true. Override per-test for misconfigured case.
  const makeFakeGemini = (isReady = true) => ({
    providerName: 'gemini' as const,
    chat: jest.fn(),
    isReady: () => isReady,
  });

  function build(
    systemConfigValue: string | null,
    geminiReady = true,
  ) {
    const prisma = {
      systemConfig: {
        findFirst: jest.fn().mockResolvedValue(
          systemConfigValue == null ? null : { value: systemConfigValue },
        ),
      },
    };
    return Test.createTestingModule({
      providers: [
        LlmProviderRegistry,
        { provide: PrismaService, useValue: prisma },
        { provide: ClaudeProvider, useValue: fakeClaude },
        { provide: GeminiProvider, useValue: makeFakeGemini(geminiReady) },
      ],
    })
      .compile()
      .then((mod) => ({
        registry: mod.get(LlmProviderRegistry),
        prisma,
      }));
  }

  it('defaults to claude when no config row', async () => {
    const { registry } = await build(null);
    const p = await registry.getActive();
    expect(p.providerName).toBe('claude');
  });

  it('returns gemini when config = "gemini" AND gemini.isReady() = true', async () => {
    const { registry } = await build('gemini', true);
    const p = await registry.getActive();
    expect(p.providerName).toBe('gemini');
  });

  it('falls back to claude when config = "gemini" but gemini.isReady() = false', async () => {
    const { registry } = await build('gemini', false);
    const p = await registry.getActive();
    expect(p.providerName).toBe('claude');
  });

  it('case-insensitive — "GEMINI" still selects gemini', async () => {
    const { registry } = await build('GEMINI');
    const p = await registry.getActive();
    expect(p.providerName).toBe('gemini');
  });

  it('falls back to claude on unknown value', async () => {
    const { registry } = await build('llama');
    const p = await registry.getActive();
    expect(p.providerName).toBe('claude');
  });

  it('caches result for 60s — second call does not hit DB', async () => {
    const { registry, prisma } = await build('gemini');
    await registry.getActive();
    await registry.getActive();
    expect(prisma.systemConfig.findFirst).toHaveBeenCalledTimes(1);
  });

  it('invalidateCache() forces next call to re-read SystemConfig', async () => {
    const { registry, prisma } = await build('gemini');
    await registry.getActive();
    registry.invalidateCache();
    await registry.getActive();
    expect(prisma.systemConfig.findFirst).toHaveBeenCalledTimes(2);
  });

  it('invalidateCache() is idempotent — safe to call when cache empty', async () => {
    const { registry } = await build('gemini');
    expect(() => registry.invalidateCache()).not.toThrow();
    expect(() => registry.invalidateCache()).not.toThrow();
    const p = await registry.getActive();
    expect(p.providerName).toBe('gemini');
  });

  it('falls back to claude when DB errors', async () => {
    const prisma = {
      systemConfig: {
        findFirst: jest.fn().mockRejectedValue(new Error('connection refused')),
      },
    };
    const mod = await Test.createTestingModule({
      providers: [
        LlmProviderRegistry,
        { provide: PrismaService, useValue: prisma },
        { provide: ClaudeProvider, useValue: fakeClaude },
        { provide: GeminiProvider, useValue: makeFakeGemini(true) },
      ],
    }).compile();
    const registry = mod.get(LlmProviderRegistry);
    const p = await registry.getActive();
    expect(p.providerName).toBe('claude');
  });
});
