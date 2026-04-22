import { Test } from '@nestjs/testing';
import { ChatAiDraftService } from './chat-ai-draft.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatIntentRouterService } from '../chat-intent-router/chat-intent-router.service';
import { SalesBotService } from '../sales-bot/sales-bot.service';
import { FinanceAiService } from '../chatbot-finance/services/finance-ai.service';
import { LineFinanceClientService } from '../chatbot-finance/services/line-finance-client.service';

describe('ChatAiDraftService', () => {
  it('routes sales intent to sales bot and creates DRAFT message with role=BOT', async () => {
    const prisma = {
      chatMessage: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'in1',
          roomId: 'r1',
          text: 'iPhone 15 กี่บาท',
          room: {
            id: 'r1',
            customerId: null,
            aiPaused: false,
            channel: 'LINE_FINANCE',
          },
        }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'd1' }),
      },
      aiSettings: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ salesBotMode: 'HYBRID', serviceBotMode: 'HYBRID' }),
      },
    };
    const router = {
      classify: jest
        .fn()
        .mockResolvedValue({ intent: 'sales', confidence: 0.9, routeTo: 'sales' }),
    };
    const salesBot = {
      generateReply: jest.fn().mockResolvedValue({
        reply: 'รุ่น iPhone 15 ราคา 30,000 ค่ะ',
        confidence: 0.85,
        toolsUsed: ['search_products'],
        inputTokens: 100,
        outputTokens: 30,
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ChatAiDraftService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatIntentRouterService, useValue: router },
        { provide: SalesBotService, useValue: salesBot },
        { provide: FinanceAiService, useValue: { generateReply: jest.fn() } },
        { provide: LineFinanceClientService, useValue: { pushText: jest.fn() } },
      ],
    }).compile();
    const svc = mod.get(ChatAiDraftService);
    const result = await svc.generateDraft('in1');
    expect(result.draftMessageId).toBe('d1');
    expect(prisma.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'BOT', intent: 'DRAFT:sales' }),
      }),
    );
  });

  it('skips draft when salesBotMode is OFF', async () => {
    const prisma = {
      chatMessage: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'in1',
          roomId: 'r1',
          text: 'iPhone 15',
          room: {
            id: 'r1',
            customerId: null,
            aiPaused: false,
            channel: 'LINE_FINANCE',
          },
        }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      aiSettings: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ salesBotMode: 'OFF', serviceBotMode: 'HYBRID' }),
      },
    };
    const router = {
      classify: jest
        .fn()
        .mockResolvedValue({ intent: 'sales', confidence: 0.9, routeTo: 'sales' }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ChatAiDraftService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatIntentRouterService, useValue: router },
        { provide: SalesBotService, useValue: { generateReply: jest.fn() } },
        { provide: FinanceAiService, useValue: { generateReply: jest.fn() } },
        { provide: LineFinanceClientService, useValue: { pushText: jest.fn() } },
      ],
    }).compile();
    const svc = mod.get(ChatAiDraftService);
    const result = await svc.generateDraft('in1');
    expect(result.draftMessageId).toBe('');
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
  });

  it('skips draft when room is AI-paused', async () => {
    const prisma = {
      chatMessage: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'in1',
          roomId: 'r1',
          text: 'hello',
          room: {
            id: 'r1',
            customerId: null,
            aiPaused: true,
            channel: 'LINE_FINANCE',
          },
        }),
        findMany: jest.fn(),
        create: jest.fn(),
      },
      aiSettings: { findUnique: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ChatAiDraftService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatIntentRouterService, useValue: { classify: jest.fn() } },
        { provide: SalesBotService, useValue: { generateReply: jest.fn() } },
        { provide: FinanceAiService, useValue: { generateReply: jest.fn() } },
        { provide: LineFinanceClientService, useValue: { pushText: jest.fn() } },
      ],
    }).compile();
    const svc = mod.get(ChatAiDraftService);
    const result = await svc.generateDraft('in1');
    expect(result.draftMessageId).toBe('');
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
  });

  it('marks room as handoff when router returns handoff', async () => {
    const prisma = {
      chatMessage: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'in1',
          roomId: 'r1',
          text: 'เรื่องร้องเรียน',
          room: {
            id: 'r1',
            customerId: null,
            aiPaused: false,
            channel: 'LINE_FINANCE',
          },
        }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      aiSettings: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ salesBotMode: 'HYBRID', serviceBotMode: 'HYBRID' }),
      },
      chatRoom: { update: jest.fn().mockResolvedValue({}) },
    };
    const router = {
      classify: jest
        .fn()
        .mockResolvedValue({ intent: 'complaint', confidence: 0.95, routeTo: 'handoff' }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ChatAiDraftService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatIntentRouterService, useValue: router },
        { provide: SalesBotService, useValue: { generateReply: jest.fn() } },
        { provide: FinanceAiService, useValue: { generateReply: jest.fn() } },
        { provide: LineFinanceClientService, useValue: { pushText: jest.fn() } },
      ],
    }).compile();
    const svc = mod.get(ChatAiDraftService);
    const result = await svc.generateDraft('in1');
    expect(result.draftMessageId).toBe('');
    expect(prisma.chatRoom.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({
          handoffMode: true,
          handoffReason: 'router_handoff',
        }),
      }),
    );
  });

  it('approveDraft strips DRAFT prefix, sets deliveredAt, pushes to LINE', async () => {
    const prisma = {
      chatMessage: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'd1',
          text: 'original reply',
          intent: 'DRAFT:sales',
          room: {
            id: 'r1',
            channel: 'LINE_FINANCE',
            lineUserId: 'U123',
          },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const lineClient = { pushText: jest.fn().mockResolvedValue(undefined) };
    const mod = await Test.createTestingModule({
      providers: [
        ChatAiDraftService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatIntentRouterService, useValue: { classify: jest.fn() } },
        { provide: SalesBotService, useValue: { generateReply: jest.fn() } },
        { provide: FinanceAiService, useValue: { generateReply: jest.fn() } },
        { provide: LineFinanceClientService, useValue: lineClient },
      ],
    }).compile();
    const svc = mod.get(ChatAiDraftService);
    const result = await svc.approveDraft('d1', 'staff1', 'edited reply');
    expect(result.sent).toBe(true);
    expect(lineClient.pushText).toHaveBeenCalledWith('U123', 'edited reply');
    expect(prisma.chatMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({
          text: 'edited reply',
          intent: 'sales',
          staffId: 'staff1',
          deliveredAt: expect.any(Date),
        }),
      }),
    );
  });

  it('skipDraft soft-deletes the draft', async () => {
    const prisma = {
      chatMessage: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ChatAiDraftService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatIntentRouterService, useValue: { classify: jest.fn() } },
        { provide: SalesBotService, useValue: { generateReply: jest.fn() } },
        { provide: FinanceAiService, useValue: { generateReply: jest.fn() } },
        { provide: LineFinanceClientService, useValue: { pushText: jest.fn() } },
      ],
    }).compile();
    const svc = mod.get(ChatAiDraftService);
    const result = await svc.skipDraft('d1', 'staff1');
    expect(result.skipped).toBe(true);
    expect(prisma.chatMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          staffId: 'staff1',
        }),
      }),
    );
  });

  it('takeOver pauses AI and assigns room to staff', async () => {
    const prisma = {
      chatRoom: { update: jest.fn().mockResolvedValue({}) },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ChatAiDraftService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatIntentRouterService, useValue: { classify: jest.fn() } },
        { provide: SalesBotService, useValue: { generateReply: jest.fn() } },
        { provide: FinanceAiService, useValue: { generateReply: jest.fn() } },
        { provide: LineFinanceClientService, useValue: { pushText: jest.fn() } },
      ],
    }).compile();
    const svc = mod.get(ChatAiDraftService);
    const result = await svc.takeOver('r1', 'staff1');
    expect(result.paused).toBe(true);
    expect(prisma.chatRoom.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({
          aiPaused: true,
          aiPausedById: 'staff1',
          assignedToId: 'staff1',
        }),
      }),
    );
  });
});
