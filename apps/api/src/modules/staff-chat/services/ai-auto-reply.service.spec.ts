import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiAutoReplyService } from './ai-auto-reply.service';
import { AiSuggestService } from './ai-suggest.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('AiAutoReplyService.shouldAutoReply', () => {
  let svc: AiAutoReplyService;
  let prisma: { systemConfig: any; aiAutoReplyLog: any };

  beforeEach(async () => {
    prisma = {
      systemConfig: { findMany: jest.fn().mockResolvedValue([
        { key: 'ai.autoEnabled', value: 'true' },
        { key: 'ai.autoChannels', value: '["LINE_SHOP"]' },
        { key: 'ai.autoMaxRepliesPerSession', value: '50' },
      ]) },
      aiAutoReplyLog: { count: jest.fn().mockResolvedValue(0) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AiAutoReplyService,
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: PrismaService, useValue: prisma },
        { provide: AiSuggestService, useValue: {} },
      ],
    }).compile();
    svc = mod.get(AiAutoReplyService);
  });

  it('returns false when room.aiPaused is true', async () => {
    const session = { id: 'r1', channel: 'LINE_SHOP', aiPaused: true, handoffMode: false };
    expect(await svc.shouldAutoReply(session)).toBe(false);
  });

  it('returns false when room.handoffMode is true', async () => {
    const session = { id: 'r1', channel: 'LINE_SHOP', aiPaused: false, handoffMode: true };
    expect(await svc.shouldAutoReply(session)).toBe(false);
  });

  it('returns true for active LINE_SHOP room', async () => {
    const session = { id: 'r1', channel: 'LINE_SHOP', aiPaused: false, handoffMode: false };
    expect(await svc.shouldAutoReply(session)).toBe(true);
  });
});
