import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { RoomManagerService } from './room-manager.service';
import { AssignmentService } from './assignment.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatChannel, ChatRoomStatus, ChatPriority, MessageRole } from '@prisma/client';
import { StorageService } from '../../storage/storage.service';
import { ChatProspectService } from '../../chat-prospects/chat-prospect.service';
import { CustomerMergeService } from '../../chat-prospects/customer-merge.service';
import { makeFakeChatPrisma } from './__tests__/fake-chat-prisma';

describe('RoomManagerService', () => {
  let service: RoomManagerService;
  let prisma: any;
  let module: TestingModule;
  let chatProspects: { ensureForRoom: jest.Mock; syncNameFromRoom: jest.Mock };
  let merge: { absorbPlaceholder: jest.Mock };

  beforeEach(async () => {
    chatProspects = {
      ensureForRoom: jest.fn().mockResolvedValue({ customerId: 'cust-auto', created: true }),
      syncNameFromRoom: jest.fn().mockResolvedValue(false),
    };
    merge = {
      absorbPlaceholder: jest
        .fn()
        .mockResolvedValue({ placeholderId: 'p1', targetId: 'cust-real', movedRooms: 1, movedCreditChecks: 0 }),
    };
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
      customer: {
        findUnique: jest.fn(),
      },
      roomCreditAnalysis: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((fns: any[]) => Promise.all(fns)),
    };

    module = await Test.createTestingModule({
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
        { provide: AssignmentService, useValue: { autoAssign: jest.fn() } },
        { provide: ChatProspectService, useValue: chatProspects },
        { provide: CustomerMergeService, useValue: merge },
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

      // ห้องยังไม่มีเจ้าของ → ได้ผู้สนใจกลับมาในผลลัพธ์ (self-heal)
      expect(result).toEqual({ ...existingRoom, customerId: 'cust-auto' });
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

      expect(result).toEqual({ ...newRoom, customerId: 'cust-auto' });
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

    it('ห้องใหม่ → ไม่ autoAssign (ใครตอบก่อนได้เป็นเจ้าของ — สเปก §5)', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue(null);
      prisma.chatRoom.findFirst.mockResolvedValue(null);
      prisma.chatRoom.create.mockResolvedValue({ id: 'room-new', channel: 'FACEBOOK', status: 'ACTIVE' });

      const assignment = module.get(AssignmentService) as { autoAssign: jest.Mock };
      await service.getOrCreateRoom({ externalUserId: 'PSID-new', channel: ChatChannel.FACEBOOK });

      expect(assignment.autoAssign).not.toHaveBeenCalled();
    });
  });

  describe('getOrCreateRoom → ผู้สนใจอัตโนมัติ', () => {
    it('ห้อง Facebook ใหม่ → เรียก ensureForRoom แล้วคืน customerId ที่ได้', async () => {
      prisma.chatRoom.findFirst.mockResolvedValue(null);
      prisma.chatRoom.create.mockResolvedValue({ id: 'room-new', channel: ChatChannel.FACEBOOK, customerId: null, attributionId: null });
      const room = await service.getOrCreateRoom({ externalUserId: 'psid-1', channel: ChatChannel.FACEBOOK, displayName: 'สมชาย' });
      expect(chatProspects.ensureForRoom).toHaveBeenCalledWith('room-new');
      expect(room.customerId).toBe('cust-auto');
    });

    it('ห้องเดิมที่ยังไม่มีเจ้าของ → self-heal ด้วย ensureForRoom', async () => {
      prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-old', channel: ChatChannel.FACEBOOK, status: ChatRoomStatus.ACTIVE, resolvedAt: null, customerId: null, displayName: 'สมชาย', pictureUrl: 'x', attributionId: null });
      const room = await service.getOrCreateRoom({ externalUserId: 'psid-1', channel: ChatChannel.FACEBOOK });
      expect(chatProspects.ensureForRoom).toHaveBeenCalledWith('room-old');
      expect(room.customerId).toBe('cust-auto');
    });

    // Ruling R23 (I3) — ห้องที่ผูกกับลูกค้าที่ถูกลบ (แพ้ race กับการรวม / ถูกลบจากหน้าลูกค้า) ต้องกู้ได้เอง
    it('ห้องเดิมที่เจ้าของถูกลบแล้ว → self-heal ด้วย ensureForRoom เหมือนห้องไม่มีเจ้าของ', async () => {
      prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-dead', channel: ChatChannel.FACEBOOK, status: ChatRoomStatus.ACTIVE, resolvedAt: null, customerId: 'cust-dead', displayName: 'สมชาย', pictureUrl: 'x', attributionId: null });
      prisma.customer.findUnique.mockResolvedValue({ deletedAt: new Date() });
      const room = await service.getOrCreateRoom({ externalUserId: 'psid-1', channel: ChatChannel.FACEBOOK });
      expect(chatProspects.ensureForRoom).toHaveBeenCalledWith('room-dead');
      expect(room.customerId).toBe('cust-auto');
    });

    it('ห้อง WEB ที่เจ้าของถูกลบแต่ไม่ส่งธง → ไม่ self-heal (R3 ยังคุมอยู่)', async () => {
      prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-web', channel: ChatChannel.WEB, status: ChatRoomStatus.ACTIVE, resolvedAt: null, customerId: 'cust-dead', displayName: null, pictureUrl: null, attributionId: null });
      prisma.customer.findUnique.mockResolvedValue({ deletedAt: new Date() });
      const room = await service.getOrCreateRoom({ externalUserId: 'visitor-1', channel: ChatChannel.WEB });
      expect(chatProspects.ensureForRoom).not.toHaveBeenCalled();
      expect(room.customerId).toBe('cust-dead');
    });

    it('ห้องเดิมมีเจ้าของอยู่แล้วและเพิ่งได้ชื่อ → ไม่สร้าง แต่ซิงก์ชื่อ', async () => {
      prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-old', channel: ChatChannel.FACEBOOK, status: ChatRoomStatus.ACTIVE, resolvedAt: null, customerId: 'cust-1', displayName: null, pictureUrl: null, attributionId: null });
      prisma.chatRoom.update.mockResolvedValue({ id: 'room-old', customerId: 'cust-1', displayName: 'สมชาย', attributionId: null });
      await service.getOrCreateRoom({ externalUserId: 'psid-1', channel: ChatChannel.FACEBOOK, displayName: 'สมชาย' });
      expect(chatProspects.ensureForRoom).not.toHaveBeenCalled();
      expect(chatProspects.syncNameFromRoom).toHaveBeenCalledWith('room-old');
    });

    it('ensureForRoom ล้ม → ห้องยังถูกคืนตามปกติ (best-effort)', async () => {
      chatProspects.ensureForRoom.mockRejectedValue(new Error('db down'));
      prisma.chatRoom.findFirst.mockResolvedValue(null);
      prisma.chatRoom.create.mockResolvedValue({ id: 'room-new', channel: ChatChannel.FACEBOOK, customerId: null, attributionId: null });
      const room = await service.getOrCreateRoom({ externalUserId: 'psid-1', channel: ChatChannel.FACEBOOK });
      expect(room.id).toBe('room-new');
      expect(room.customerId).toBeNull();
    });

    it('syncNameFromRoom ล้ม → ห้องยังถูกคืนตามปกติ (best-effort)', async () => {
      chatProspects.syncNameFromRoom.mockRejectedValue(new Error('db down'));
      prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-old', channel: ChatChannel.FACEBOOK, status: ChatRoomStatus.ACTIVE, resolvedAt: null, customerId: 'cust-1', displayName: null, pictureUrl: null, attributionId: null });
      prisma.chatRoom.update.mockResolvedValue({ id: 'room-old', customerId: 'cust-1', displayName: 'สมชาย', attributionId: null });
      const room = await service.getOrCreateRoom({ externalUserId: 'psid-1', channel: ChatChannel.FACEBOOK, displayName: 'สมชาย' });
      expect(room).toEqual({ id: 'room-old', customerId: 'cust-1', displayName: 'สมชาย', attributionId: null });
    });

    // Ruling R3: widget init / socket connect สร้างห้อง WEB ทุกครั้งที่เปิดหน้าเว็บ — ยังไม่ใช่ "ลูกค้าที่ทักเข้ามา"
    it('ห้อง WEB ใหม่ไม่ส่งธง (widget init) → ไม่สร้างผู้สนใจ', async () => {
      prisma.chatRoom.findFirst.mockResolvedValue(null);
      prisma.chatRoom.create.mockResolvedValue({ id: 'room-web', channel: ChatChannel.WEB, customerId: null, attributionId: null });
      const room = await service.getOrCreateRoom({ externalUserId: 'visitor-1', channel: ChatChannel.WEB });
      expect(chatProspects.ensureForRoom).not.toHaveBeenCalled();
      expect(room.customerId).toBeNull();
    });

    it('ห้อง WEB เดิมไม่ส่งธง (socket connect ซ้ำ) → ไม่ self-heal', async () => {
      prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-web', channel: ChatChannel.WEB, status: ChatRoomStatus.ACTIVE, resolvedAt: null, customerId: null, displayName: null, pictureUrl: null, attributionId: null });
      const room = await service.getOrCreateRoom({ externalUserId: 'visitor-1', channel: ChatChannel.WEB });
      expect(chatProspects.ensureForRoom).not.toHaveBeenCalled();
      expect(room.customerId).toBeNull();
    });

    it('ห้อง WEB ที่ส่งธง ensureProspect: true (ผู้ชมทักจริง) → สร้างผู้สนใจ', async () => {
      prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-web', channel: ChatChannel.WEB, status: ChatRoomStatus.ACTIVE, resolvedAt: null, customerId: null, displayName: null, pictureUrl: null, attributionId: null });
      const room = await service.getOrCreateRoom({ externalUserId: 'visitor-1', channel: ChatChannel.WEB, ensureProspect: true });
      expect(chatProspects.ensureForRoom).toHaveBeenCalledWith('room-web');
      expect(room.customerId).toBe('cust-auto');
    });
  });

  // widget:send (WebWidgetGateway) บันทึกข้อความเองไม่ผ่าน getOrCreateRoom → เรียกเมธอดนี้ตรง ๆ
  describe('ensureProspect (เรียกจาก widget:send)', () => {
    it('คืน customerId ของผู้สนใจที่ได้', async () => {
      await expect(service.ensureProspect('room-web')).resolves.toBe('cust-auto');
      expect(chatProspects.ensureForRoom).toHaveBeenCalledWith('room-web');
    });

    it('ensureForRoom ล้ม → คืน null ไม่โยน (best-effort)', async () => {
      chatProspects.ensureForRoom.mockRejectedValue(new Error('db down'));
      await expect(service.ensureProspect('room-web')).resolves.toBeNull();
    });
  });

  // สเปค 3.3 (ก): PATCH /staff-chat/rooms/:id/customer กับห้องที่ผูก placeholder อยู่
  describe('linkCustomer กับห้องที่มีผู้สนใจอัตโนมัติ', () => {
    const actor = { id: 'staff-1', role: 'OWNER' };
    const placeholderRoom = {
      id: 'room-1', customerId: 'p1', deletedAt: null, assignedToId: null,
      customer: { acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null, deletedAt: null },
    };
    /** หลัง absorb ห้องอยู่กับลูกค้าที่เลือกแล้ว — ทรานแซกชันผูกห้องอ่านเจอเป็นการผูกซ้ำคนเดิม */
    const roomAfterAbsorb = { id: 'room-1', customerId: 'cust-real', deletedAt: null, assignedToId: null };

    beforeEach(() => {
      prisma.$transaction.mockImplementation((fn: (db: typeof prisma) => unknown) => fn(prisma));
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust-real', deletedAt: null });
      prisma.chatRoom.update.mockResolvedValue({ id: 'room-1', customerId: 'cust-real' });
    });

    it('ห้องผูก placeholder อยู่ → absorb เข้าลูกค้าที่เลือก แล้วคืนห้อง (ไม่โยน 409)', async () => {
      prisma.chatRoom.findUnique.mockResolvedValueOnce(placeholderRoom).mockResolvedValueOnce(roomAfterAbsorb);
      merge.absorbPlaceholder.mockResolvedValueOnce({ placeholderId: 'p1', targetId: 'cust-real', movedRooms: 1, movedCreditChecks: 2 });
      const room = await service.linkCustomer('room-1', 'cust-real', actor);
      expect(merge.absorbPlaceholder).toHaveBeenCalledWith('p1', 'cust-real', actor);
      expect(room.customerId).toBe('cust-real');
      // M-A4: ผลการรวมที่ PATCH ผูกห้องส่งต่อให้เว็บ (เฉพาะสองคีย์ที่เว็บใช้)
      expect(room.absorbed).toEqual({ targetId: 'cust-real', movedCreditChecks: 2 });
      // absorbPlaceholder เปิดทรานแซกชันของตัวเอง — ต้องจบก่อนทรานแซกชันผูกห้อง (ไม่ซ้อนกัน)
      expect(merge.absorbPlaceholder.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$transaction.mock.invocationCallOrder[0],
      );
    });

    it('หลัง absorb ยังนำเข้าผลสเตทเม้นของห้องที่ค้างอยู่ให้ลูกค้าที่เลือก (เหมือนผูกห้องปกติ)', async () => {
      prisma.chatRoom.findUnique.mockResolvedValueOnce(placeholderRoom).mockResolvedValueOnce(roomAfterAbsorb);
      prisma.roomCreditAnalysis.findMany.mockResolvedValue([{ id: 'analysis-1', createdAt: new Date(), fileIds: [], result: {} }]);
      prisma.roomCreditAnalysis.update = jest.fn();
      prisma.creditCheck = {
        create: jest.fn().mockResolvedValue({ id: 'check-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
      };
      await service.linkCustomer('room-1', 'cust-real', actor);
      expect(prisma.creditCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ customerId: 'cust-real' }) }),
      );
    });

    it('ห้องผูกลูกค้าจริงคนอื่น → ยังโยน 409 เหมือนเดิม', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue({
        id: 'room-1', customerId: 'cust-a', deletedAt: null, assignedToId: null,
        customer: { acquisitionSource: null, phone: '0811111111', nationalId: null, deletedAt: null },
      });
      await expect(service.linkCustomer('room-1', 'cust-b', actor)).rejects.toThrow('ห้องแชทนี้ผูกกับลูกค้ารายอื่นอยู่แล้ว');
      expect(merge.absorbPlaceholder).not.toHaveBeenCalled();
    });

    // Ruling R23 (I3) — เจ้าของที่ถูก soft-delete = ห้องไม่มีเจ้าของ ผูกทับได้เลย
    it('ห้องผูกกับลูกค้าที่ถูกลบแล้ว → ผูกลูกค้าใหม่ได้ ไม่โยน 409 (ไม่ต้องรวมเพราะไม่มีอะไรให้รวม)', async () => {
      const deadOwnerRoom = {
        id: 'room-1', customerId: 'cust-dead', deletedAt: null, assignedToId: null,
        customer: { acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null, deletedAt: new Date() },
      };
      prisma.chatRoom.findUnique.mockResolvedValue(deadOwnerRoom);
      const room = await service.linkCustomer('room-1', 'cust-real', actor);
      expect(merge.absorbPlaceholder).not.toHaveBeenCalled();
      expect(prisma.chatRoom.update).toHaveBeenCalledWith({ where: { id: 'room-1' }, data: { customerId: 'cust-real' } });
      expect(room.customerId).toBe('cust-real');
      expect(room.absorbed).toBeNull(); // M-A4: ไม่ได้รวม → null
    });

    it('ห้องยังไม่มีเจ้าของ → ผูกตรง ไม่รวม · absorbed: null (M-A4)', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue({
        id: 'room-1', customerId: null, deletedAt: null, assignedToId: null, customer: null,
      });
      const room = await service.linkCustomer('room-1', 'cust-real', actor);
      expect(merge.absorbPlaceholder).not.toHaveBeenCalled();
      expect(room).toEqual({ id: 'room-1', customerId: 'cust-real', absorbed: null });
    });

    it('SALES ที่ไม่ได้ดูแลห้อง → 403 ก่อนรวม (ไม่แตะ placeholder)', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue({ ...placeholderRoom, assignedToId: 'staff-other' });
      await expect(service.linkCustomer('room-1', 'cust-real', { id: 'sales-1', role: 'SALES' })).rejects.toThrow(
        'ไม่มีสิทธิ์เข้าถึงห้องแชทนี้',
      );
      expect(merge.absorbPlaceholder).not.toHaveBeenCalled();
      expect(prisma.chatRoom.update).not.toHaveBeenCalled();
    });

    it('รวมไม่ผ่าน (เช่น placeholder มีเอกสารพ่วง) → โยนต่อ ไม่ผูกห้อง', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue(placeholderRoom);
      merge.absorbPlaceholder.mockRejectedValue(new ConflictException('รวมไม่ได้: ผู้สนใจคนนี้มีใบจอง 1 รายการ — ให้แก้ที่รายการนั้นก่อน'));
      await expect(service.linkCustomer('room-1', 'cust-real', actor)).rejects.toThrow('รวมไม่ได้');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.chatRoom.update).not.toHaveBeenCalled();
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

    it('CUSTOMER → ตั้ง lastCustomerAt แบบเดินหน้าอย่างเดียว (หน้าต่าง 24 ชม. ของ FB นับจากใบล่าสุด)', async () => {
      const createdAt = new Date('2026-09-05T03:00:00Z');
      prisma.chatMessage.create.mockResolvedValue({ id: 'm1', createdAt });
      await service.saveMessage({ roomId: 'room-1', role: MessageRole.CUSTOMER, text: 'ยังอยู่ไหมคะ' });
      expect(prisma.chatRoom.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-1', OR: [{ lastCustomerAt: null }, { lastCustomerAt: { lt: createdAt } }] },
        data: { lastCustomerAt: createdAt },
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

  describe('saveMessage — ข้อความระบบแบบเงียบ (silent)', () => {
    it('silent=true → บันทึกข้อความ แต่ไม่แตะสถิติห้อง (lastMessageAt/totalMessages/unread) — ห้องไม่เด้ง พรีวิวไม่เปลี่ยน', async () => {
      prisma.chatMessage.create.mockResolvedValue({ id: 'm-sys', createdAt: new Date() });
      await service.saveMessage({ roomId: 'r1', role: MessageRole.SYSTEM, text: 'ปิดงานโดย แนน', silent: true });
      expect(prisma.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: MessageRole.SYSTEM, text: 'ปิดงานโดย แนน' }) }));
      expect(prisma.chatRoom.update).not.toHaveBeenCalled();
      expect(prisma.chatRoom.updateMany).not.toHaveBeenCalled();
    });
    it('ไม่ silent → อัปเดตสถิติห้องเหมือนเดิม', async () => {
      prisma.chatMessage.create.mockResolvedValue({ id: 'm1', createdAt: new Date() });
      prisma.chatRoom.findUnique.mockResolvedValue({ firstResponseAt: null });
      await service.saveMessage({ roomId: 'r1', role: MessageRole.STAFF, text: 'สวัสดี', staffId: 'u1' });
      expect(prisma.chatRoom.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'r1' } }));
    });
  });

  describe('listRooms — แท็บรอตอบ', () => {
    beforeEach(() => {
      prisma.chatRoom.findMany.mockResolvedValue([]);
      prisma.chatRoom.count.mockResolvedValue(0);
    });

    it('waiting=true → กรอง "รอตอบและยังทัน" แล้วเรียงสองชั้น: FB ใกล้หมดเวลาก่อน แล้วรอนานก่อน (สเปก §7 แก้ไข)', async () => {
      const now = Date.now();
      const h = (n: number) => new Date(now - n * 3600 * 1000);
      // FB เหลือ 2 ชม. (ทักเมื่อ 22 ชม.) · LINE รอ 3 วัน · FB ทักเมื่อ 1 ชม. รอ 1 ชม. · FB ทักซ้ำเมื่อ 2 ชม. แต่รอมา 22 ชม.
      const keys = [
        { id: 'fb-fresh', channel: 'FACEBOOK', lastCustomerAt: h(1), waitingSince: h(1) },
        { id: 'line-old', channel: 'LINE_FINANCE', lastCustomerAt: h(72), waitingSince: h(72) },
        { id: 'fb-closing', channel: 'FACEBOOK', lastCustomerAt: h(22), waitingSince: h(22) },
        { id: 'fb-nudged', channel: 'FACEBOOK', lastCustomerAt: h(2), waitingSince: h(22) },
      ];
      prisma.chatRoom.findMany
        .mockResolvedValueOnce(keys)
        .mockResolvedValueOnce(keys.map((k) => ({ id: k.id })));

      const res = await service.listRooms({ waiting: true });

      // where ชุดเดียวกับตัวนับ: waitingSince not null + (ไม่ใช่ FB หรือ FB ที่ยังอยู่ในหน้าต่าง)
      const keyArgs = prisma.chatRoom.findMany.mock.calls[0][0];
      expect(keyArgs.where).toMatchObject({ deletedAt: null, waitingSince: { not: null } });
      // เงื่อนไข OR ซ้อนใน AND — ไม่ทับ OR ของการค้นหา
      expect(keyArgs.where.AND).toEqual([
        {
          OR: [
            { channel: { not: 'FACEBOOK' } },
            { channel: 'FACEBOOK', lastCustomerAt: { gte: expect.any(Date) } },
          ],
        },
      ]);
      expect(keyArgs.orderBy).toBeUndefined();
      // ชั้น 1 = FB ที่เหลือ ≤3 ชม. · ชั้น 2 = ที่เหลือเรียงรอนานสุด (LINE 3 วัน > FB ทักซ้ำแต่รอ 22 ชม. > FB 1 ชม.)
      expect(res.data.map((r: { id: string }) => r.id)).toEqual(['fb-closing', 'line-old', 'fb-nudged', 'fb-fresh']);
      expect(res.total).toBe(4);
      // hydrate เฉพาะหน้าที่ขอ
      const rowArgs = prisma.chatRoom.findMany.mock.calls[1][0];
      expect(rowArgs.where).toEqual({ id: { in: ['fb-closing', 'line-old', 'fb-nudged', 'fb-fresh'] } });
      // พรีวิวรายการซ้าย = ข้อความสนทนาล่าสุด — ข้อความระบบห้ามมาแทนที่ข้อความลูกค้า
      expect(rowArgs.include.messages.where).toEqual({ deletedAt: null, role: { not: MessageRole.SYSTEM } });
    });

    it('expired=true → เฉพาะ FACEBOOK ที่รออยู่และ lastCustomerAt พ้น 24 ชม. หรือยังไม่มีค่า', async () => {
      await service.listRooms({ expired: true });
      const args = prisma.chatRoom.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ deletedAt: null, waitingSince: { not: null } });
      expect(args.where.AND).toEqual([
        { channel: 'FACEBOOK' },
        { OR: [{ lastCustomerAt: null }, { lastCustomerAt: { lt: expect.any(Date) } }] },
      ]);
    });

    it('ค้นหาบนแท็บรอตอบ → เงื่อนไขค้นหาและเงื่อนไขรอตอบอยู่ครบทั้งคู่ (เดิม OR ทับกัน ค้นหาถูกทิ้งเงียบ ๆ)', async () => {
      await service.listRooms({ waiting: true, search: 'สมชาย' });
      const args = prisma.chatRoom.findMany.mock.calls[0][0];
      expect(args.where.AND).toHaveLength(2);
      expect(args.where.AND[0].OR).toEqual(
        expect.arrayContaining([{ customer: { name: { contains: 'สมชาย', mode: 'insensitive' } } }]),
      );
      expect(args.where.AND[1].OR).toEqual(
        expect.arrayContaining([{ channel: { not: 'FACEBOOK' } }]),
      );
    });

    it('ตอบไม่ทัน + เลือกช่องทาง → channel=FACEBOOK ยังอยู่ (LINE ที่ lastCustomerAt ว่างต้องไม่ถูกป้ายว่าพ้น 24 ชม.)', async () => {
      await service.listRooms({ expired: true, channels: ['LINE_SHOP'] });
      const args = prisma.chatRoom.findMany.mock.calls[0][0];
      expect(args.where.AND).toEqual(
        expect.arrayContaining([{ channel: 'FACEBOOK' }, { channel: { in: ['LINE_SHOP'] } }]),
      );
    });

    it('ไม่ส่ง waiting → เรียงแบบเดิม (ปักหมุดก่อน แล้ว lastMessageAt)', async () => {
      await service.listRooms({});
      const args = prisma.chatRoom.findMany.mock.calls[0][0];
      expect(args.where).not.toHaveProperty('waitingSince');
      expect(args.orderBy).toEqual([
        { pinnedAt: { sort: 'desc', nulls: 'last' } },
        // ห้องปิดงานแล้วไปท้ายรายการ (เจ้าของเคาะ 2026-09-06)
        { resolvedAt: { sort: 'desc', nulls: 'first' } },
        { lastMessageAt: 'desc' },
      ]);
    });
  });

  describe('getRoomBadgeCounts — ป้ายต้องเท่ากับจำนวนแถวที่แท็บนั้นแสดง', () => {
    it('นับแต่ละแท็บด้วยตัวกรองของตัวเอง ไม่ใช่ "ยังไม่อ่าน" ชุดเดียวทั้งหมด', async () => {
      // ลำดับ count: all · mine · waiting · expired
      prisma.chatRoom.count
        .mockResolvedValueOnce(8320)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(24)
        .mockResolvedValueOnce(44);
      prisma.chatRoom.groupBy.mockResolvedValue([{ channel: 'FACEBOOK', _count: { id: 8320 } }]);

      const res = await service.getRoomBadgeCounts('staff-1');

      // all = ห้องทั้งหมด · mine = ห้องของฉันที่ยังเปิด · waiting = รอและยังทัน · expired = รอแต่พ้นหน้าต่าง
      expect(res).toEqual({ mine: 2, all: 8320, waiting: 24, expired: 44, byChannel: { FACEBOOK: 8320 } });
      // ไม่มีตัวนับใบไหนกรอง unreadCount อีกต่อไป
      expect(prisma.chatRoom.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
      expect(prisma.chatRoom.count).toHaveBeenCalledWith({
        // ของฉัน = งานที่ยังเปิดของฉัน — ห้องปิดงานแล้วไม่นับ (ชุดเดียวกับ openOnly ของรายการ)
        where: { deletedAt: null, assignedToId: 'staff-1', resolvedAt: null },
      });
      expect(prisma.chatRoom.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ deletedAt: null, waitingSince: { not: null }, AND: [expect.objectContaining({ OR: expect.any(Array) })] }),
      });
      expect(prisma.chatRoom.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          deletedAt: null,
          waitingSince: { not: null },
          AND: expect.arrayContaining([{ channel: 'FACEBOOK' }]),
        }),
      });
      for (const call of prisma.chatRoom.count.mock.calls) {
        expect(call[0].where.unreadCount).toBeUndefined();
      }
    });

    it('ชิปช่องทางนับในจักรวาลของแท็บที่เปิดอยู่ (รอตอบ) ไม่ใช่ทั้งบริษัท', async () => {
      prisma.chatRoom.count.mockResolvedValue(0);
      prisma.chatRoom.groupBy.mockResolvedValue([]);

      await service.getRoomBadgeCounts('staff-1', { tab: 'waiting' });

      expect(prisma.chatRoom.groupBy).toHaveBeenCalledWith({
        by: ['channel'],
        where: expect.objectContaining({ deletedAt: null, waitingSince: { not: null }, AND: expect.any(Array) }),
        _count: { id: true },
      });
    });

    it('ไม่รู้ว่าใครถาม → mine = 0 และแท็บ "ของฉัน" ไม่มีชิปให้นับ', async () => {
      prisma.chatRoom.count.mockResolvedValue(9);
      prisma.chatRoom.groupBy.mockResolvedValue([{ channel: 'LINE_SHOP', _count: { id: 9 } }]);

      const res = await service.getRoomBadgeCounts(undefined, { tab: 'mine' });

      expect(res.mine).toBe(0);
      // ชิปนับด้วยเงื่อนไขที่ไม่ตรงห้องใดเลย — ไม่ใช่ตกไปนับทั้งบริษัท
      // (mock คืนค่าเดิมไม่ว่า where เป็นอะไร — ตัวชี้ขาดคือ where ที่ส่งไป)
      expect(prisma.chatRoom.groupBy).toHaveBeenCalledWith({
        by: ['channel'],
        where: { id: { in: [] } },
        _count: { id: true },
      });
    });
  });
});

describe('RoomManagerService.listDueAppointments — นัดที่ถึงเวลา/ใกล้ถึง 15 นาที/เลยไม่เกิน 24 ชม.', () => {
  it('กรอง: มีห้อง · ยังไม่เสร็จ · dueDate ในช่วง [now-24h, now+15m] · เรียงใกล้สุดก่อน · ไม่เกิน 20', async () => {
    const prisma = { todo: { findMany: jest.fn().mockResolvedValue([]) } };
    const svc = new RoomManagerService(prisma as any, {} as any);
    const now = new Date('2026-09-06T07:00:00.000Z');
    await svc.listDueAppointments(now);
    const args = prisma.todo.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ deletedAt: null, roomId: { not: null }, status: { not: 'DONE' } });
    expect(args.where.dueDate).toEqual({ gte: new Date('2026-09-05T07:00:00.000Z'), lte: new Date('2026-09-06T07:15:00.000Z') });
    expect(args.orderBy).toEqual({ dueDate: 'asc' });
    expect(args.take).toBe(20);
    expect(args.select.room.select.customer).toEqual({ select: { name: true } });
  });
});

describe('RoomManagerService — ข้อความตอบกลับอัตโนมัติของเพจ (2026-09-22)', () => {
  const MARKER = 'อันนี้ตารางผ่อนเครื่องนอก';
  const SCRIPT = `${MARKER}ค่ะ 😊\nสนใจรุ่นไหนคะ`;
  // สคริปต์ปุ่ม "ใช้บัตรอะไรยื่นได้บ้าง" — คำขึ้นต้นที่พนักงานพิมพ์เองได้ตอนตอบเรื่องเอกสาร (RT-F3)
  const DOCS_MARKER = 'ใช้บัตรประชาชนยื่นได้เลยค่ะ';
  const DOCS_SCRIPT = `${DOCS_MARKER} 😊 ผลอนุมัติขึ้นอยู่กับบริษัทสินเชื่อ`;
  const T0 = new Date('2026-09-22T10:00:00.000Z').getTime();
  const at = (sec: number) => new Date(T0 + sec * 1000);

  const make = (opts: { markers?: string[] | null; rawMarkers?: string } = {}) => {
    const fake = makeFakeChatPrisma({
      room: { id: 'r1' },
      markers: opts.markers === undefined ? [MARKER, DOCS_MARKER] : opts.markers,
      rawMarkers: opts.rawMarkers,
    });
    return { ...fake, svc: new RoomManagerService(fake.prisma as any, {} as any) };
  };
  const customer = (fake: ReturnType<typeof make>, sec: number, text = 'ฟรีดาวน์มีรุ่นไหนบ้าง?') =>
    fake.addMessage({ role: MessageRole.CUSTOMER, text, createdAt: at(sec) });
  const pageImage = (fake: ReturnType<typeof make>, sec: number) =>
    fake.addMessage({ role: MessageRole.STAFF, type: 'IMAGE', text: null, createdAt: at(sec) });
  const pageScript = (fake: ReturnType<typeof make>, sec: number, text = SCRIPT) =>
    fake.addMessage({ role: MessageRole.STAFF, text, createdAt: at(sec) });

  describe('isPageAutoReplyText / hasPageAutoReplyMarkers', () => {
    it('ขึ้นต้นตามรายการ (มีช่องว่างนำหน้าก็นับ) → true · ข้อความอื่น/ว่าง → false', async () => {
      const f = make();
      expect(await f.svc.isPageAutoReplyText(SCRIPT)).toBe(true);
      expect(await f.svc.isPageAutoReplyText(`  ${SCRIPT}`)).toBe(true);
      expect(await f.svc.isPageAutoReplyText('สวัสดีค่ะ สนใจรุ่นไหนคะ')).toBe(false);
      expect(await f.svc.isPageAutoReplyText(null)).toBe(false);
      expect(await f.svc.hasPageAutoReplyMarkers()).toBe(true);
    });

    it('ไม่ได้ตั้งรายการ / JSON พัง / คำสั้นเกิน → ปิดด่านทั้งหมด ไม่อ่านแชท', async () => {
      for (const cfg of [{ markers: null }, { rawMarkers: '{bad' }, { markers: ['ab'] }]) {
        const f = make(cfg);
        pageScript(f, 1);
        expect(await f.svc.isPageAutoReplyText(SCRIPT)).toBe(false);
        expect(await f.svc.hasPageAutoReplyMarkers()).toBe(false);
        expect(await f.svc.hasPageAutoReplyNear('r1', at(0), 20_000)).toBe(false);
        expect(await f.svc.pageAutoReplyCoversTurn('r1', at(-2), at(0))).toBe(false);
        expect(f.prisma.chatMessage.findMany).not.toHaveBeenCalled();
      }
    });
  });

  describe('hasPageAutoReplyNear — รูปตารางที่เพจส่งนำหน้าสคริปต์', () => {
    it('สคริปต์มาหลังรูปไม่กี่วิ → true · สคริปต์ห่างเกินหน้าต่าง → false', async () => {
      const f = make();
      customer(f, 0);
      pageScript(f, 3);
      expect(await f.svc.hasPageAutoReplyNear('r1', at(1), 20_000)).toBe(true);
      expect(await f.svc.hasPageAutoReplyNear('r1', at(60), 20_000)).toBe(false);
    });

    it('ข้อความพนักงานพิมพ์เองใกล้ ๆ ไม่นับ', async () => {
      const f = make();
      customer(f, 0);
      f.addMessage({ role: MessageRole.STAFF, text: 'รุ่นนี้มีสีดำค่ะ', createdAt: at(2) });
      expect(await f.svc.hasPageAutoReplyNear('r1', at(1), 20_000)).toBe(false);
    });

    it('RT-F3: ข้อความขึ้นต้นเหมือนสคริปต์แต่ไม่มีลูกค้าทักใกล้ ๆ (พนักงานพิมพ์เอง) ไม่นับ · ลูกค้ารอคิวอยู่ (ยังไม่มีแถว) นับ', async () => {
      const f = make();
      customer(f, -300, 'ต้องใช้เอกสารอะไรบ้างคะ');
      pageScript(f, 3, DOCS_SCRIPT);
      expect(await f.svc.hasPageAutoReplyNear('r1', at(1), 20_000)).toBe(false);
      expect(await f.svc.hasPageAutoReplyNear('r1', at(1), 20_000, [at(1)])).toBe(true);
    });

    it('RT-Q4: อ่าน echo ใหม่สุดก่อน — echo เก่าเกิน 10 แถวในช่วงเดียวกันไม่ดันสคริปต์ที่เพิ่งมาหลุดชุด', async () => {
      const f = make();
      for (let i = 0; i < 12; i++) {
        f.addMessage({ role: MessageRole.STAFF, text: `ข้อความพนักงาน ${i}`, createdAt: at(-19 + i) });
      }
      customer(f, 0);
      pageScript(f, 3);
      expect(await f.svc.hasPageAutoReplyNear('r1', at(1), 20_000)).toBe(true);
    });
  });

  describe('isPageAutoReplyEcho — RT-F3 คำขึ้นต้นตรง + มีลูกค้าทักภายใน ±15 วิ', () => {
    it('ลูกค้ากดปุ่มแล้วเพจตอบภายในไม่กี่วิ → true', async () => {
      const f = make();
      customer(f, 0, 'ใช้บัตรอะไรยื่นได้บ้าง?');
      expect(await f.svc.isPageAutoReplyEcho('r1', DOCS_SCRIPT, at(1.2))).toBe(true);
    });

    it('พนักงานพิมพ์ประโยคเดียวกับสคริปต์ 5 นาทีหลังข้อความลูกค้าล่าสุด → false (คนตอบจริง)', async () => {
      const f = make();
      customer(f, 0, 'ต้องใช้เอกสารอะไรบ้างคะ');
      expect(
        await f.svc.isPageAutoReplyEcho('r1', `${DOCS_MARKER} ถ้าสะดวกแวะร้านได้เลยนะคะ`, at(300)),
      ).toBe(false);
    });

    it('echo ถูกบันทึกก่อนแถวลูกค้า (ดึงโปรไฟล์อยู่ — ROUTER-2) → ยังนับ เพราะหน้าต่างเป็น ± ไม่ใช่แค่ "ก่อน"', async () => {
      const f = make();
      customer(f, 2);
      expect(await f.svc.isPageAutoReplyEcho('r1', DOCS_SCRIPT, at(0.5))).toBe(true);
    });

    it('แถวลูกค้ายังไม่ถูกบันทึก (รอคิวหลังเทิร์นก่อน) แต่ router รับเข้าแล้ว → นับจากเวลารับเข้า', async () => {
      const f = make();
      customer(f, -60, 'สนใจ 15 Pro ค่ะ');
      expect(await f.svc.isPageAutoReplyEcho('r1', SCRIPT, at(3))).toBe(false);
      expect(await f.svc.isPageAutoReplyEcho('r1', SCRIPT, at(3), [at(1)])).toBe(true);
    });

    it('ข้อความไม่ขึ้นต้นตาม marker → false โดยไม่อ่านแชท', async () => {
      const f = make();
      customer(f, 0);
      expect(await f.svc.isPageAutoReplyEcho('r1', 'รุ่นนี้มีสีดำค่ะ', at(1))).toBe(false);
      expect(f.prisma.chatMessage.findMany).not.toHaveBeenCalled();
    });
  });

  describe('pageAutoReplyCoversTurn — ข้ามเทิร์นได้เฉพาะเมื่อเพจตอบครบทุกข้อความของลูกค้า', () => {
    it('กดปุ่มโฆษณา 1 ครั้ง → เพจส่งรูป+สคริปต์ → ข้ามได้', async () => {
      const f = make();
      customer(f, 0);
      pageImage(f, 1);
      pageScript(f, 1.5);
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(-2), at(0))).toBe(true);
    });

    it('ROUTER-4: กดปุ่ม + พิมพ์คำถามจริงในช่วงรวมข้อความ (echo มาทีหลัง) → ห้ามข้าม', async () => {
      const f = make();
      customer(f, 0);
      customer(f, 2, 'สนใจ 15 Pro Max ค่ะ');
      pageImage(f, 4.9); // รูปอย่างเดียวต้องไม่กลายเป็น "คำตอบ" ของคำถาม
      pageScript(f, 5);
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(0), at(2))).toBe(false);
    });

    it('กดปุ่ม → เพจตอบ → พิมพ์คำถามต่อทันที (ถูกรวมเป็นเทิร์นเดียว) → ห้ามข้าม', async () => {
      const f = make();
      customer(f, 0);
      pageScript(f, 1);
      customer(f, 2, 'สนใจ 15 Pro Max ค่ะ');
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(0), at(2))).toBe(false);
    });

    it('เช็คหลังบอทคิดของเทิร์นปุ่มโฆษณา: ข้อความใหม่ที่มาหลังตัวตั้งเทิร์นเป็นของเทิร์นถัดไป ไม่นับ → ข้ามได้', async () => {
      const f = make();
      customer(f, 0);
      pageScript(f, 5);
      customer(f, 15, 'สนใจ 15 Pro Max ค่ะ'); // รอคิวอยู่ — เทิร์นของมันจะตอบเอง
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(-2), at(0))).toBe(true);
    });

    it('กดปุ่มซ้ำ 2 ครั้งติดกัน เพจตอบทั้ง 2 ครั้ง → ข้ามได้', async () => {
      const f = make();
      customer(f, 0);
      customer(f, 1);
      pageScript(f, 2);
      pageScript(f, 3);
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(-1), at(1))).toBe(true);
    });

    it('ข้อความเก่าที่ค้างไม่มีใครตอบ (เกิน 10 นาที) ไม่ทำให้บอทตอบปุ่มโฆษณาซ้ำกับเพจ', async () => {
      const f = make();
      customer(f, -3 * 24 * 3600, 'ยังมีเครื่องไหมคะ');
      customer(f, 0);
      pageScript(f, 1);
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(-2), at(0))).toBe(true);
    });

    it('พนักงานตอบต่อจากสคริปต์แล้ว ลูกค้าถามต่อ → สคริปต์นั้นไม่ใช่คำตอบของคำถามใหม่ → ห้ามข้าม', async () => {
      const f = make();
      customer(f, 0);
      pageScript(f, 1);
      f.addMessage({ role: MessageRole.STAFF, text: 'ฟรีดาวน์เป็นเครื่องนอกนะคะ', createdAt: at(1.5) });
      customer(f, 2.5, 'สนใจ 15 Pro Max ค่ะ');
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(0.5), at(2.5))).toBe(false);
    });

    it('บอทพิมพ์ประโยคขึ้นต้นเหมือนสคริปต์ = คำตอบของบอท ไม่ใช่ข้อความอัตโนมัติของเพจ', async () => {
      const f = make();
      customer(f, 0);
      f.addMessage({ role: MessageRole.BOT, text: SCRIPT, createdAt: at(1) });
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(-2), at(0))).toBe(false);
    });

    it('สคริปต์ก่อนขอบ since (ตอบปุ่มครั้งก่อน) + คำถามใหม่ → ห้ามข้าม', async () => {
      const f = make();
      customer(f, 0);
      pageScript(f, 1);
      customer(f, 40, 'ผ่อนเดือนละเท่าไหร่คะ');
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(38), at(40))).toBe(false);
    });

    it('RT-V1: กดปุ่มฟรีดาวน์ → เพจตอบ → กดปุ่มเอกสารอีก 60 วิ → เพจตอบ → ข้ามได้ทั้งสองเทิร์น', async () => {
      const f = make();
      customer(f, 0);
      pageImage(f, 2);
      pageScript(f, 3);
      customer(f, 60, 'ใช้บัตรอะไรยื่นได้บ้าง?');
      pageScript(f, 62, DOCS_SCRIPT);
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(-2), at(0))).toBe(true);
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(58), at(60))).toBe(true);
    });

    it('RT-V1: กดปุ่มเดิมซ้ำห่างกัน 2 นาที เพจตอบทั้งสองครั้ง → ข้ามได้', async () => {
      const f = make();
      customer(f, 0);
      pageScript(f, 1);
      customer(f, 120);
      pageScript(f, 121);
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(118), at(120))).toBe(true);
    });

    it('RT-V1: กดปุ่ม 2 ครั้ง + พิมพ์คำถาม 1 ข้อ (สคริปต์ 2 ใบ ลูกค้า 3 ข้อความ) → ห้ามข้าม', async () => {
      const f = make();
      customer(f, 0);
      pageScript(f, 1);
      customer(f, 60, 'ใช้บัตรอะไรยื่นได้บ้าง?');
      pageScript(f, 61, DOCS_SCRIPT);
      customer(f, 62, 'แล้ว 15 Pro มีไหมคะ');
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(60), at(62))).toBe(false);
    });

    it('RT-V2: คำถามที่ลูกค้าพิมพ์ + กดปุ่มระหว่างบอทคิด (ปุ่มยังรอคิว ไม่มีแถว) → สคริปต์หลังขอบ scriptsBefore ไม่นับ → ห้ามข้าม', async () => {
      const f = make();
      customer(f, 0);
      pageScript(f, 1);
      customer(f, 30, 'ผ่อน 15 pro เดือนละเท่าไหร่');
      // ลูกค้ากดปุ่มที่ 40 (router รับเข้าแล้ว แต่แถวยังไม่ถูกบันทึกเพราะเทิร์นคำถามยังไม่จบ) เพจตอบที่ 41
      pageScript(f, 41);
      // ไม่มีขอบบน = ตรรกะเห็นสคริปต์ 2 ใบ ลูกค้า 2 ข้อความ แล้วกลืนคำถามทิ้ง (บั๊กเดิม)
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(28), at(30))).toBe(true);
      expect(
        await f.svc.pageAutoReplyCoversTurn('r1', at(28), at(30), {
          scriptsBefore: at(38),
          extraCustomerAt: [at(30), at(40)],
        }),
      ).toBe(false);
    });

    it('RT-F3: พนักงานพิมพ์ประโยคขึ้นต้นเหมือนสคริปต์ 5 นาทีหลังลูกค้า → ไม่ใช่สคริปต์ ไม่ข้าม', async () => {
      const f = make();
      f.addMessage({ role: MessageRole.BOT, text: 'สวัสดีค่ะ สนใจรุ่นไหนคะ', createdAt: at(-600) });
      customer(f, 0, 'ต้องใช้เอกสารอะไรบ้างคะ');
      pageScript(f, 300, `${DOCS_MARKER} ถ้าสะดวกแวะร้านได้เลยนะคะ`);
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(-2), at(0))).toBe(false);
    });

    it('RT-F3: ลูกค้ายังไม่มีแถว (รอคิว) แต่ router รับเข้าแล้ว → สคริปต์ผ่านด่านเวลาจากเวลารับเข้า', async () => {
      const f = make();
      pageScript(f, 3);
      customer(f, 40); // แถวของปุ่มถูกบันทึกช้าเพราะรอคิวหลังเทิร์นก่อนหน้า (รับเข้าจริงที่ 1)
      expect(await f.svc.pageAutoReplyCoversTurn('r1', at(-1), at(40))).toBe(false);
      expect(
        await f.svc.pageAutoReplyCoversTurn('r1', at(-1), at(40), { extraCustomerAt: [at(1)] }),
      ).toBe(true);
    });
  });
});
