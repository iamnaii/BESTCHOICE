import { Test } from '@nestjs/testing';
import { LlmProviderRegistry } from './llm-provider.registry';
import { ClaudeProvider } from './claude.provider';
import { GeminiProvider } from './gemini.provider';
import { PrismaService } from '../../../prisma/prisma.service';

describe('LlmProviderRegistry', () => {
  const fakeClaude = { providerName: 'claude' as const, chat: jest.fn() };
  const fakeGemini = { providerName: 'gemini' as const, chat: jest.fn() };

  function build(systemConfigValue: string | null) {
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
        { provide: GeminiProvider, useValue: fakeGemini },
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

  it('returns gemini when config = "gemini"', async () => {
    const { registry } = await build('gemini');
    const p = await registry.getActive();
    expect(p.providerName).toBe('gemini');
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

  it('invalidateCache forces re-read', async () => {
    const { registry, prisma } = await build('gemini');
    await registry.getActive();
    registry.invalidateCache();
    await registry.getActive();
    expect(prisma.systemConfig.findFirst).toHaveBeenCalledTimes(2);
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
        { provide: GeminiProvider, useValue: fakeGemini },
      ],
    }).compile();
    const registry = mod.get(LlmProviderRegistry);
    const p = await registry.getActive();
    expect(p.providerName).toBe('claude');
  });
});
