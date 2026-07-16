import { Test } from '@nestjs/testing';
import { RoomManagerService } from './room-manager.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatChannel, ChatRoomStatus, ChatPriority, MessageRole } from '@prisma/client';
import { StorageService } from '../../storage/storage.service';

describe('RoomManagerService', () => {
  let service: RoomManagerService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      chatRoom: {
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
        RoomManagerService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: StorageService,
          useValue: {
            configured: true,
            upload: jest.fn(),
            getSignedDownloadUrl: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(RoomManagerService);
  });

  describe('getOrCreateRoom', () => {
    it('should return existing LINE room', async () => {
      const existingRoom = { id: 'room-1', lineUserId: 'U123', channel: 'LINE_FINANCE', status: 'ACTIVE' };
      prisma.chatRoom.findUnique.mockResolvedValue(existingRoom);

      const result = await service.getOrCreateRoom({
        externalUserId: 'U123',
        channel: ChatChannel.LINE_FINANCE,
      });

      expect(result).toEqual(existingRoom);
      expect(prisma.chatRoom.create).not.toHaveBeenCalled();
    });

    it('should reopen IDLE room and return it', async () => {
      const idleRoom = { id: 'room-1', lineUserId: 'U123', channel: 'LINE_FINANCE', status: ChatRoomStatus.IDLE };
      prisma.chatRoom.findUnique.mockResolvedValue(idleRoom);
      prisma.chatRoom.update.mockResolvedValue({ ...idleRoom, status: ChatRoomStatus.ACTIVE });

      const result = await service.getOrCreateRoom({
        externalUserId: 'U123',
        channel: ChatChannel.LINE_FINANCE,
      });

      expect(prisma.chatRoom.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { status: ChatRoomStatus.ACTIVE },
      });
      expect(result.status).toBe(ChatRoomStatus.ACTIVE);
      expect(prisma.chatRoom.create).not.toHaveBeenCalled();
    });

    it('should create new LINE room if not exists', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue(null);
      prisma.customerLineLink.findUnique.mockResolvedValue(null);
      const newRoom = { id: 'room-new', lineUserId: 'U456', channel: 'LINE_FINANCE', status: 'ACTIVE' };
      prisma.chatRoom.create.mockResolvedValue(newRoom);

      const result = await service.getOrCreateRoom({
        externalUserId: 'U456',
        channel: ChatChannel.LINE_FINANCE,
      });

      expect(result).toEqual(newRoom);
      expect(prisma.chatRoom.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          lineUserId: 'U456',
          channel: 'LINE_FINANCE',
          status: 'ACTIVE',
          priority: 'NORMAL',
        }),
      });
    });

    it('should lookup non-LINE room by externalUserId', async () => {
      prisma.chatRoom.findFirst.mockResolvedValue(null);
      const newRoom = { id: 'room-fb', externalUserId: 'FB123', channel: 'FACEBOOK', status: 'ACTIVE' };
      prisma.chatRoom.create.mockResolvedValue(newRoom);

      await service.getOrCreateRoom({
        externalUserId: 'FB123',
        channel: ChatChannel.FACEBOOK,
      });

      expect(prisma.chatRoom.findFirst).toHaveBeenCalledWith({
        where: { externalUserId: 'FB123', channel: 'FACEBOOK', deletedAt: null },
      });
    });

    it('should link customer if CustomerLineLink exists', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue(null);
      prisma.customerLineLink.findUnique.mockResolvedValue({ customerId: 'cust-1' });
      prisma.chatRoom.create.mockResolvedValue({ id: 'room-linked' });

      await service.getOrCreateRoom({
        externalUserId: 'U789',
        channel: ChatChannel.LINE_FINANCE,
      });

      expect(prisma.chatRoom.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerId: 'cust-1',
          verifiedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('saveMessage', () => {
    it('should create message and update room stats', async () => {
      const msg = { id: 'msg-1', createdAt: new Date() };
      prisma.chatMessage.create.mockResolvedValue(msg);
      prisma.chatRoom.findUnique.mockResolvedValue({ firstResponseAt: null });
      prisma.chatRoom.update.mockResolvedValue({});

      const result = await service.saveMessage({
        roomId: 'room-1',
        role: MessageRole.CUSTOMER,
        text: 'สวัสดี',
      });

      expect(result).toEqual(msg);
      expect(prisma.chatRoom.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: expect.objectContaining({
          totalMessages: { increment: 1 },
        }),
      });
    });

    it('should increment unreadCount on inbound CUSTOMER messages', async () => {
      prisma.chatMessage.create.mockResolvedValue({ id: 'm', createdAt: new Date() });
      prisma.chatRoom.update.mockResolvedValue({});

      await service.saveMessage({ roomId: 'room-1', role: MessageRole.CUSTOMER, text: 'hi' });

      expect(prisma.chatRoom.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: expect.objectContaining({ unreadCount: { increment: 1 } }),
      });
    });

    it('should NOT increment unreadCount on STAFF or BOT messages', async () => {
      prisma.chatMessage.create.mockResolvedValue({ id: 'm', createdAt: new Date() });
      prisma.chatRoom.findUnique.mockResolvedValue({ firstResponseAt: null });
      prisma.chatRoom.update.mockResolvedValue({});

      await service.saveMessage({ roomId: 'room-1', role: MessageRole.STAFF, text: 'reply' });

      expect(prisma.chatRoom.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: expect.not.objectContaining({ unreadCount: expect.anything() }),
      });
    });

    it('should set firstResponseAt for first BOT reply', async () => {
      prisma.chatMessage.create.mockResolvedValue({ id: 'msg-2', createdAt: new Date() });
      prisma.chatRoom.findUnique.mockResolvedValue({ firstResponseAt: null });
      prisma.chatRoom.update.mockResolvedValue({});

      await service.saveMessage({
        roomId: 'room-1',
        role: MessageRole.BOT,
        text: 'สวัสดีค่ะ',
      });

      expect(prisma.chatRoom.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: expect.objectContaining({
          firstResponseAt: expect.any(Date),
        }),
      });
    });

  });

  describe('getRecentMessages', () => {
    it('excludes undelivered legacy drafts without dropping NULL-intent messages', async () => {
      prisma.chatMessage.findMany.mockResolvedValue([]);

      await service.getRecentMessages('r1', 20);

      // NULL-safe form — a bare NOT{intent startsWith, deliveredAt null} is
      // NULL under SQL 3VL for intent IS NULL rows (every customer/staff
      // message) and blanked the inbox. Real-DB semantics are covered by
      // room-manager.recent-messages.db.spec.ts.
      expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { intent: null },
              { NOT: { intent: { startsWith: 'DRAFT:' } } },
              { deliveredAt: { not: null } },
            ],
          }),
        }),
      );
    });
  });

  describe('updateRoomStatus', () => {
    it('should set resolvedAt when status is IDLE', async () => {
      prisma.chatRoom.update.mockResolvedValue({});

      await service.updateRoomStatus('room-1', ChatRoomStatus.IDLE);

      expect(prisma.chatRoom.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: expect.objectContaining({
          status: 'IDLE',
          resolvedAt: expect.any(Date),
        }),
      });
    });
  });
});
