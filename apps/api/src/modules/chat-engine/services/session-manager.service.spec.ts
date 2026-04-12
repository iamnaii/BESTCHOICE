import { Test } from '@nestjs/testing';
import { SessionManagerService } from './session-manager.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatChannel, ChatSessionStatus, ChatPriority, MessageRole } from '@prisma/client';

describe('SessionManagerService', () => {
  let service: SessionManagerService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      chatSession: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      chatMessage: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      customerLineLink: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((fns: any[]) => Promise.all(fns)),
    };

    const module = await Test.createTestingModule({
      providers: [
        SessionManagerService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(SessionManagerService);
  });

  describe('getOrCreateSession', () => {
    it('should return existing LINE session', async () => {
      const existingSession = { id: 'sess-1', lineUserId: 'U123', channel: 'LINE_FINANCE' };
      prisma.chatSession.findUnique.mockResolvedValue(existingSession);

      const result = await service.getOrCreateSession({
        externalUserId: 'U123',
        channel: ChatChannel.LINE_FINANCE,
      });

      expect(result).toEqual(existingSession);
      expect(prisma.chatSession.create).not.toHaveBeenCalled();
    });

    it('should create new LINE session if not exists', async () => {
      prisma.chatSession.findUnique.mockResolvedValue(null);
      prisma.customerLineLink.findUnique.mockResolvedValue(null);
      const newSession = { id: 'sess-new', lineUserId: 'U456', channel: 'LINE_FINANCE' };
      prisma.chatSession.create.mockResolvedValue(newSession);

      const result = await service.getOrCreateSession({
        externalUserId: 'U456',
        channel: ChatChannel.LINE_FINANCE,
      });

      expect(result).toEqual(newSession);
      expect(prisma.chatSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          lineUserId: 'U456',
          channel: 'LINE_FINANCE',
          sessionStatus: 'OPEN',
          priority: 'NORMAL',
        }),
      });
    });

    it('should lookup non-LINE session by externalUserId', async () => {
      prisma.chatSession.findFirst.mockResolvedValue(null);
      const newSession = { id: 'sess-fb', externalUserId: 'FB123', channel: 'FACEBOOK' };
      prisma.chatSession.create.mockResolvedValue(newSession);

      await service.getOrCreateSession({
        externalUserId: 'FB123',
        channel: ChatChannel.FACEBOOK,
      });

      expect(prisma.chatSession.findFirst).toHaveBeenCalledWith({
        where: { externalUserId: 'FB123', channel: 'FACEBOOK', deletedAt: null },
      });
    });

    it('should link customer if CustomerLineLink exists', async () => {
      prisma.chatSession.findUnique.mockResolvedValue(null);
      prisma.customerLineLink.findUnique.mockResolvedValue({ customerId: 'cust-1' });
      prisma.chatSession.create.mockResolvedValue({ id: 'sess-linked' });

      await service.getOrCreateSession({
        externalUserId: 'U789',
        channel: ChatChannel.LINE_FINANCE,
      });

      expect(prisma.chatSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerId: 'cust-1',
          verifiedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('saveMessage', () => {
    it('should create message and update session stats', async () => {
      const msg = { id: 'msg-1', createdAt: new Date() };
      prisma.chatMessage.create.mockResolvedValue(msg);
      prisma.chatSession.findUnique.mockResolvedValue({ firstResponseAt: null });
      prisma.chatSession.update.mockResolvedValue({});

      const result = await service.saveMessage({
        sessionId: 'sess-1',
        role: MessageRole.CUSTOMER,
        text: 'สวัสดี',
      });

      expect(result).toEqual(msg);
      expect(prisma.chatSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: expect.objectContaining({
          totalMessages: { increment: 1 },
        }),
      });
    });

    it('should set firstResponseAt for first BOT reply', async () => {
      prisma.chatMessage.create.mockResolvedValue({ id: 'msg-2', createdAt: new Date() });
      prisma.chatSession.findUnique.mockResolvedValue({ firstResponseAt: null });
      prisma.chatSession.update.mockResolvedValue({});

      await service.saveMessage({
        sessionId: 'sess-1',
        role: MessageRole.BOT,
        text: 'สวัสดีค่ะ',
      });

      expect(prisma.chatSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: expect.objectContaining({
          firstResponseAt: expect.any(Date),
        }),
      });
    });
  });

  describe('updateSessionStatus', () => {
    it('should set resolvedAt when status is RESOLVED', async () => {
      prisma.chatSession.update.mockResolvedValue({});

      await service.updateSessionStatus('sess-1', ChatSessionStatus.RESOLVED);

      expect(prisma.chatSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: expect.objectContaining({
          sessionStatus: 'RESOLVED',
          resolvedAt: expect.any(Date),
        }),
      });
    });
  });
});
