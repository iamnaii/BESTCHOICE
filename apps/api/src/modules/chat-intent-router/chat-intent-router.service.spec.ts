import { Test } from '@nestjs/testing';
import { ChatIntentRouterService } from './chat-intent-router.service';
import { PrismaService } from '../../prisma/prisma.service';
import Anthropic from '@anthropic-ai/sdk';

jest.mock('@anthropic-ai/sdk');

describe('ChatIntentRouterService', () => {
  let svc: ChatIntentRouterService;
  let prisma: { customer: { findUnique: jest.Mock } };

  beforeEach(async () => {
    (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"intent":"sales","confidence":0.92}' }],
        }),
      },
    }));
    prisma = { customer: { findUnique: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [ChatIntentRouterService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = mod.get(ChatIntentRouterService);
  });

  it('routes sales intent to sales bot', async () => {
    const result = await svc.classify({ text: 'iPhone 15 กี่บาท', roomId: 'r1', customerId: null });
    expect(result.routeTo).toBe('sales');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('defaults greeting → service when customer has active contract', async () => {
    (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"intent":"greeting","confidence":0.85}' }],
        }),
      },
    }));
    prisma.customer.findUnique.mockResolvedValue({ id: 'c1', contracts: [{ status: 'ACTIVE' }] });
    const result = await svc.classify({ text: 'สวัสดีครับ', roomId: 'r1', customerId: 'c1' });
    expect(result.routeTo).toBe('service');
  });

  it('routes unknown + low confidence to handoff', async () => {
    (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"intent":"unknown","confidence":0.3}' }],
        }),
      },
    }));
    const result = await svc.classify({ text: '???', roomId: 'r1', customerId: null });
    expect(result.routeTo).toBe('handoff');
  });
});
