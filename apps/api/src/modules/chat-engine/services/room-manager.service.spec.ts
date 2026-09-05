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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      chatMessage: {
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
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
        data: { status: ChatRoomStatus.ACTIVE, resolvedAt: null },
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

    it('CUSTOMER → ตั้ง waitingSince แบบ set-if-null ด้วยเวลาข้อความนั้น (สเปก §4.2)', async () => {
      const createdAt = new Date('2026-09-05T08:00:00.000Z');
      prisma.chatMessage.create.mockResolvedValue({ id: 'm-c', createdAt });
      prisma.chatRoom.update.mockResolvedValue({});

      await service.saveMessage({ roomId: 'room-1', role: MessageRole.CUSTOMER, text: 'สนใจค่ะ' });

      expect(prisma.chatRoom.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-1', waitingSince: null },
        data: { waitingSince: createdAt },
      });
    });

    it('STAFF / BOT → ไม่แตะ waitingSince เลย (ล้างที่ markOutboundSent/mirrorOutbound เท่านั้น)', async () => {
      prisma.chatMessage.create.mockResolvedValue({ id: 'm-s', createdAt: new Date() });
      prisma.chatRoom.findUnique.mockResolvedValue({ firstResponseAt: null });
      prisma.chatRoom.update.mockResolvedValue({});

      await service.saveMessage({ roomId: 'room-1', role: MessageRole.STAFF, text: 'ตอบแล้วค่ะ' });
      await service.saveMessage({ roomId: 'room-1', role: MessageRole.BOT, text: 'บอทตอบ' });

      expect(prisma.chatRoom.updateMany).not.toHaveBeenCalled();
      for (const call of prisma.chatRoom.update.mock.calls) {
        expect(call[0].data).not.toHaveProperty('waitingSince');
      }
    });

  });

  describe('clearWaiting / markOutboundSent', () => {
    it('clearWaiting ล้างเฉพาะห้องที่กำลังรออยู่', async () => {
      await service.clearWaiting('room-1');
      expect(prisma.chatRoom.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-1', waitingSince: { not: null } },
        data: { waitingSince: null },
      });
    });

    it('markOutboundSent (ส่งสำเร็จ) → stamp outboundSentAt แล้วล้าง waiting ของห้องนั้น', async () => {
      prisma.chatMessage.update.mockResolvedValue({ id: 'm1', roomId: 'room-9' });

      await service.markOutboundSent('m1', 'mid-1');

      expect(prisma.chatMessage.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { outboundSentAt: expect.any(Date), externalMessageId: 'mid-1' },
      });
      expect(prisma.chatRoom.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-9', waitingSince: { not: null } },
        data: { waitingSince: null },
      });
    });

    it('markOutboundSent ชน P2002 (echo จอง mid ก่อน) → stamp เฉพาะ outboundSentAt และยังล้าง waiting', async () => {
      const dup: any = new Error('dup');
      dup.code = 'P2002';
      prisma.chatMessage.update
        .mockRejectedValueOnce(dup)
        .mockResolvedValueOnce({ id: 'm1', roomId: 'room-9' });

      await service.markOutboundSent('m1', 'mid-dup');

      expect(prisma.chatMessage.update).toHaveBeenLastCalledWith({
        where: { id: 'm1' },
        data: { outboundSentAt: expect.any(Date) },
      });
      expect(prisma.chatRoom.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-9', waitingSince: { not: null } },
        data: { waitingSince: null },
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

  describe('markOutboundSent', () => {
    // fix round 1 [I1]: the P2002 catch/fallback branch had zero coverage —
    // mutation-tested and proven live (all 42 chat-engine tests stayed green
    // with that branch disabled). These two tests close that gap.
    it('P2002 (echo ชิงบันทึก externalMessageId ก่อน) → fallback stamp เฉพาะ outboundSentAt โดยไม่ throw', async () => {
      const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      prisma.chatMessage.update
        .mockRejectedValueOnce(p2002) // 1st attempt: stamp outboundSentAt + externalMessageId → collides
        .mockResolvedValueOnce({}); // fallback attempt: stamp outboundSentAt only → succeeds

      await expect(service.markOutboundSent('m1', 'ext-1')).resolves.toBeUndefined();

      expect(prisma.chatMessage.update).toHaveBeenCalledTimes(2);
      expect(prisma.chatMessage.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'm1' },
        data: { outboundSentAt: expect.any(Date), externalMessageId: 'ext-1' },
      });
      expect(prisma.chatMessage.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'm1' },
        data: { outboundSentAt: expect.any(Date) },
      });
    });

    it('error อื่นที่ไม่ใช่ P2002 → throw ตามเดิม (กัน mutation กลืน error ทุกชนิด)', async () => {
      const dbDown = Object.assign(new Error('connection refused'), { code: 'P1001' });
      prisma.chatMessage.update.mockRejectedValueOnce(dbDown);

      await expect(service.markOutboundSent('m1', 'ext-1')).rejects.toThrow('connection refused');
      // no fallback attempted for a non-P2002 error
      expect(prisma.chatMessage.update).toHaveBeenCalledTimes(1);
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

  describe('listRooms — แท็บรอตอบ', () => {
    beforeEach(() => {
      prisma.chatRoom.findMany.mockResolvedValue([]);
      prisma.chatRoom.count.mockResolvedValue(0);
    });

    it('waiting=true → กรอง waitingSince not null และเรียง waitingSince asc อย่างเดียว', async () => {
      await service.listRooms({ waiting: true });
      const args = prisma.chatRoom.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ deletedAt: null, waitingSince: { not: null } });
      expect(args.orderBy).toEqual([{ waitingSince: 'asc' }]);
    });

    it('ไม่ส่ง waiting → เรียงแบบเดิม (ปักหมุดก่อน แล้ว lastMessageAt)', async () => {
      await service.listRooms({});
      const args = prisma.chatRoom.findMany.mock.calls[0][0];
      expect(args.where).not.toHaveProperty('waitingSince');
      expect(args.orderBy).toEqual([
        { pinnedAt: { sort: 'desc', nulls: 'last' } },
        { lastMessageAt: 'desc' },
      ]);
    });
  });

  describe('getRoomBadgeCounts — waiting', () => {
    it('คืน waiting = จำนวนห้อง waitingSince not null ทั้งบริษัท', async () => {
      // ลำดับ count: all(unread) · mine(unread) · waiting
      prisma.chatRoom.count
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(52);
      prisma.chatRoom.groupBy.mockResolvedValue([{ channel: 'FACEBOOK', _count: { id: 7 } }]);

      const res = await service.getRoomBadgeCounts('staff-1');

      expect(res).toEqual({ mine: 2, all: 7, unread: 7, waiting: 52, byChannel: { FACEBOOK: 7 } });
      expect(prisma.chatRoom.count).toHaveBeenCalledWith({
        where: { deletedAt: null, waitingSince: { not: null } },
      });
    });
  });
});
