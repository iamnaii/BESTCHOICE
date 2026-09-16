import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { RoomManagerService } from './room-manager.service';
import { AssignmentService } from './assignment.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatChannel, ChatRoomStatus, ChatPriority, MessageRole } from '@prisma/client';
import { StorageService } from '../../storage/storage.service';
import { ChatProspectService } from '../../chat-prospects/chat-prospect.service';
import { CustomerMergeService } from '../../chat-prospects/customer-merge.service';

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
