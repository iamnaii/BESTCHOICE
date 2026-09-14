import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StaffChatController } from './staff-chat.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RoomManagerService } from '../chat-engine/services/room-manager.service';
import { AssignmentService } from '../chat-engine/services/assignment.service';
import { ConversationTagService } from '../chat-engine/services/conversation-tag.service';
import { HandoffManagerService } from '../chat-engine/services/handoff-manager.service';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { StaffMessageService } from './services/staff-message.service';
import { CannedResponseBubbleService } from './services/canned-response-bubble.service';
import { CannedResponseQuickReplyService } from './services/canned-response-quickreply.service';
import { CannedResponseSenderService } from './services/canned-response-sender.service';
import { AiAssistantService } from './services/ai-assistant.service';
import { RoomAiAccessService } from './services/room-ai-access.service';
import { MediaContentService } from './services/media-content.service';
import { ChatToContractService } from './services/chat-to-contract.service';
import { AiSuggestService } from './services/ai-suggest.service';
import { LeadScoringService } from './services/lead-scoring.service';
import { ProductDetectService } from './services/product-detect.service';
import { AiTrainingService } from './services/ai-training.service';
import { AiAutoReplyService } from './services/ai-auto-reply.service';
import { AiImportService } from './services/ai-import.service';
import { AiMetricsService } from './services/ai-metrics.service';
import { TrainingExtractCron } from './cron/training-extract.cron';
import { EmbeddingBackfillCron } from './cron/embedding-backfill.cron';
import { StorageService } from '../storage/storage.service';
import { StaffChatGateway } from './staff-chat.gateway';
import { SamePersonService } from '../chat-prospects/same-person.service';

describe('StaffChatController', () => {
  let controller: StaffChatController;
  let staffMessage: StaffMessageService;
  let cannedResponseBubble: CannedResponseBubbleService;
  let cannedResponseQuickReply: CannedResponseQuickReplyService;
  let cannedResponseSender: CannedResponseSenderService;
  let roomManager: RoomManagerService;
  let gateway: StaffChatGateway;
  let router: MessageRouterService;
  let aiAutoReply: AiAutoReplyService;
  let roomAiAccess: RoomAiAccessService;
  let aiAssistant: AiAssistantService;
  let aiSuggest: AiSuggestService;
  let config: ConfigService;
  let samePerson: { findForRoom: jest.Mock; dismiss: jest.Mock };

  beforeEach(async () => {
    samePerson = { findForRoom: jest.fn().mockResolvedValue([]), dismiss: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      controllers: [StaffChatController],
      providers: [
        { provide: RoomAiAccessService, useValue: { assertAccess: jest.fn().mockResolvedValue({}) } },
        { provide: PrismaService, useValue: {} },
        { provide: SamePersonService, useValue: samePerson },
        {
          provide: RoomManagerService,
          useValue: {
            pinRoom: jest.fn(),
            unpinRoom: jest.fn(),
            markAsRead: jest.fn(),
            uploadFile: jest.fn(),
            getCustomerMessages: jest.fn(),
            sendCustomerMessage: jest.fn(),
            getCrossChannelRooms: jest.fn(),
            findById: jest.fn(),
          },
        },
        { provide: AssignmentService, useValue: {} },
        { provide: ConversationTagService, useValue: {} },
        { provide: HandoffManagerService, useValue: {} },
        {
          provide: StaffMessageService,
          useValue: {
            getCannedResponseExpanded: jest.fn(),
            reorderCannedResponses: jest.fn(),
          },
        },
        { provide: AiAssistantService, useValue: { summarizeConversation: jest.fn(), adjustTone: jest.fn() } },
        { provide: MediaContentService, useValue: {} },
        { provide: ChatToContractService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: MessageRouterService, useValue: { sendStaffMessage: jest.fn() } },
        { provide: AiSuggestService, useValue: { suggest: jest.fn() } },
        { provide: LeadScoringService, useValue: {} },
        { provide: ProductDetectService, useValue: {} },
        { provide: AiTrainingService, useValue: {} },
        { provide: AiAutoReplyService, useValue: { getRuntimeStatus: jest.fn() } },
        { provide: AiImportService, useValue: {} },
        { provide: AiMetricsService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: TrainingExtractCron, useValue: {} },
        { provide: EmbeddingBackfillCron, useValue: {} },
        { provide: StaffChatGateway, useValue: { emitNewMessage: jest.fn(), emitSendFailed: jest.fn() } },
        {
          provide: CannedResponseBubbleService,
          useValue: {
            listBubbles: jest.fn(),
            createBubble: jest.fn(),
            updateBubble: jest.fn(),
            deleteBubble: jest.fn(),
            reorderBubbles: jest.fn(),
          },
        },
        {
          provide: CannedResponseQuickReplyService,
          useValue: {
            list: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            reorder: jest.fn(),
          },
        },
        {
          provide: CannedResponseSenderService,
          useValue: {
            send: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(StaffChatController);
    staffMessage = module.get(StaffMessageService);
    cannedResponseBubble = module.get(CannedResponseBubbleService);
    cannedResponseQuickReply = module.get(CannedResponseQuickReplyService);
    cannedResponseSender = module.get(CannedResponseSenderService);
    roomManager = module.get(RoomManagerService);
    gateway = module.get(StaffChatGateway);
    router = module.get(MessageRouterService);
    aiAutoReply = module.get(AiAutoReplyService);
    roomAiAccess = module.get(RoomAiAccessService);
    aiAssistant = module.get(AiAssistantService);
    aiSuggest = module.get(AiSuggestService);
    config = module.get(ConfigService);
  });

  describe('room AI access and authenticated attribution', () => {
    const user = { id: 'staff-1', role: 'SALES', branchId: 'branch-1', accessibleCompanies: ['SHOP'] };

    it('checks current room permission before a cached summary can be returned', async () => {
      jest.spyOn(aiAssistant, 'summarizeConversation').mockResolvedValue('private cached summary');
      await expect(controller.summarizeRoom('room-1', { user })).resolves.toEqual({ summary: 'private cached summary' });
      expect(aiAssistant.summarizeConversation).toHaveBeenCalledWith('room-1', user.id);

      jest.mocked(aiAssistant.summarizeConversation).mockClear();
      jest.spyOn(roomAiAccess, 'assertAccess').mockRejectedValue(new ForbiddenException());
      await expect(controller.summarizeRoom('room-1', { user })).rejects.toBeInstanceOf(ForbiddenException);
      expect(roomAiAccess.assertAccess).toHaveBeenLastCalledWith('room-1', user);
      expect(aiAssistant.summarizeConversation).not.toHaveBeenCalled();
    });

    it('checks permission before suggestions even when the feature would return an empty response', async () => {
      jest.spyOn(config, 'get').mockReturnValue('configured-key');
      jest.spyOn(roomAiAccess, 'assertAccess').mockRejectedValue(new ForbiddenException());
      await expect(controller.getSuggestions('room-1', { currentDraft: 'hello' }, { user }))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(aiSuggest.suggest).not.toHaveBeenCalled();
    });

    it('attributes authorized suggestions and tone changes to the authenticated actor', async () => {
      await controller.getSuggestions('room-1', { currentDraft: 'hello' }, { user });
      expect(aiSuggest.suggest).toHaveBeenCalledWith('room-1', 'hello', user.id);
      await controller.adjustTone({ text: 'hello', tone: 'friendly' }, { user });
      expect(aiAssistant.adjustTone).toHaveBeenCalledWith('hello', 'friendly', user.id);
    });
  });

  describe('GET /staff-chat/rooms/:roomId/canned-responses/:id/preview', () => {
    it('returns expanded content for a canned response', async () => {
      const mockResult = {
        id: 'cr-1',
        shortcut: 'สวัสดี',
        title: 'ทักทาย',
        content: 'สวัสดีคุณ {customerName}',
        expandedContent: 'สวัสดีคุณ สมชาย',
        bubbles: [],
        quickReplies: [],
      };
      jest.spyOn(staffMessage, 'getCannedResponseExpanded').mockResolvedValue(mockResult);

      const result = await controller.previewCannedResponse('room-1', 'cr-1');

      expect(result).toEqual(mockResult);
      expect(staffMessage.getCannedResponseExpanded).toHaveBeenCalledWith('cr-1', 'room-1');
    });

    it('propagates 404 when template not found', async () => {
      jest.spyOn(staffMessage, 'getCannedResponseExpanded').mockRejectedValue(
        new NotFoundException('ไม่พบข้อความสำเร็จรูป'),
      );

      await expect(controller.previewCannedResponse('room-1', 'missing')).rejects.toThrow(
        'ไม่พบข้อความสำเร็จรูป',
      );
    });
  });

  describe('PATCH /staff-chat/canned-responses/reorder', () => {
    it('updates sortOrder + category for each item', async () => {
      jest.spyOn(staffMessage, 'reorderCannedResponses').mockResolvedValue({ updated: 2 });

      const body = {
        items: [
          { id: 'a', sortOrder: 10, category: 'X' },
          { id: 'b', sortOrder: 11, category: 'X' },
        ],
      };
      const result = await controller.reorderCannedResponses(body);

      expect(result).toEqual({ updated: 2 });
      expect(staffMessage.reorderCannedResponses).toHaveBeenCalledWith(body.items);
    });

    it('rejects payload with > 200 items', async () => {
      const items = Array.from({ length: 201 }, (_, i) => ({ id: `id-${i}`, sortOrder: i, category: 'X' }));
      await expect(controller.reorderCannedResponses({ items })).rejects.toThrow(/200/);
    });

    it('rejects payload with non-integer sortOrder', async () => {
      await expect(
        controller.reorderCannedResponses({ items: [{ id: 'a', sortOrder: 1.5, category: 'X' }] }),
      ).rejects.toThrow();
    });
  });

  describe('Bubble endpoints (Phase 1)', () => {
    it('GET listBubbles delegates', async () => {
      jest.spyOn(cannedResponseBubble, 'listBubbles').mockResolvedValue([] as any);
      await controller.listBubbles('cr-1');
      expect(cannedResponseBubble.listBubbles).toHaveBeenCalledWith('cr-1');
    });

    it('POST createBubble delegates', async () => {
      jest.spyOn(cannedResponseBubble, 'createBubble').mockResolvedValue({} as any);
      await controller.createBubble('cr-1', { type: 'TEXT', text: 'hi' });
      expect(cannedResponseBubble.createBubble).toHaveBeenCalledWith('cr-1', { type: 'TEXT', text: 'hi' });
    });

    it('PATCH updateBubble delegates', async () => {
      jest.spyOn(cannedResponseBubble, 'updateBubble').mockResolvedValue({} as any);
      await controller.updateBubble('b-1', { text: 'new' });
      expect(cannedResponseBubble.updateBubble).toHaveBeenCalledWith('b-1', { text: 'new' });
    });

    it('DELETE deleteBubble delegates', async () => {
      jest.spyOn(cannedResponseBubble, 'deleteBubble').mockResolvedValue({} as any);
      await controller.deleteBubble('b-1');
      expect(cannedResponseBubble.deleteBubble).toHaveBeenCalledWith('b-1');
    });

    it('PATCH reorder delegates', async () => {
      jest.spyOn(cannedResponseBubble, 'reorderBubbles').mockResolvedValue({ updated: 2 } as any);
      await controller.reorderBubbles({ items: [{ id: 'a', sortOrder: 0 }, { id: 'b', sortOrder: 1 }] });
      expect(cannedResponseBubble.reorderBubbles).toHaveBeenCalledWith([{ id: 'a', sortOrder: 0 }, { id: 'b', sortOrder: 1 }]);
    });
  });

  describe('Quick Reply endpoints (Phase 2)', () => {
    it('GET listQuickReplies delegates', async () => {
      jest.spyOn(cannedResponseQuickReply, 'list').mockResolvedValue([] as any);
      await controller.listQuickReplies('cr-1');
      expect(cannedResponseQuickReply.list).toHaveBeenCalledWith('cr-1');
    });

    it('POST createQuickReply delegates', async () => {
      jest.spyOn(cannedResponseQuickReply, 'create').mockResolvedValue({} as any);
      const body = { label: 'ตกลง', type: 'POSTBACK' as const, payload: 'OK' };
      await controller.createQuickReply('cr-1', body);
      expect(cannedResponseQuickReply.create).toHaveBeenCalledWith('cr-1', body);
    });
  });

  describe('POST /staff-chat/rooms/:roomId/send-canned-response', () => {
    it('delegates to sender service with templateId and current user id', async () => {
      jest
        .spyOn(cannedResponseSender, 'send')
        .mockResolvedValue({ sent: 2, dropped: 0, errors: [] });

      const result = await controller.sendCannedResponse(
        'room-1',
        { templateId: 'tpl-1' },
        { user: { id: 'user-1' } } as any,
      );

      expect(cannedResponseSender.send).toHaveBeenCalledWith('room-1', 'tpl-1', 'user-1');
      expect(result).toEqual({ sent: 2, dropped: 0, errors: [] });
    });

    it('propagates BadRequest when verified-only template + unverified room', async () => {
      jest
        .spyOn(cannedResponseSender, 'send')
        .mockRejectedValue(
          new BadRequestException(
            'Template นี้ใช้ได้เฉพาะลูกค้าที่ยืนยันตัวตนแล้ว',
          ),
        );

      await expect(
        controller.sendCannedResponse(
          'room-1',
          { templateId: 'tpl-1' },
          { user: { id: 'user-1' } } as any,
        ),
      ).rejects.toThrow('ยืนยันตัวตน');
    });

    it('rejects empty templateId with BadRequestException', async () => {
      await expect(
        controller.sendCannedResponse(
          'room-1',
          { templateId: '' },
          { user: { id: 'user-1' } } as any,
        ),
      ).rejects.toThrow('templateId');
      expect(cannedResponseSender.send).not.toHaveBeenCalled();
    });
  });

  // ─── Moved handlers (delegate to RoomManagerService) ──────────────

  describe('POST /staff-chat/rooms/:id/pin', () => {
    it('delegates to roomManager.pinRoom with room + user id and returns success', async () => {
      jest.spyOn(roomManager, 'pinRoom').mockResolvedValue(undefined);
      const result = await controller.pinRoom('room-1', { user: { id: 'user-1' } } as any);
      expect(roomManager.pinRoom).toHaveBeenCalledWith('room-1', 'user-1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('DELETE /staff-chat/rooms/:id/pin', () => {
    it('delegates to roomManager.unpinRoom and returns success', async () => {
      jest.spyOn(roomManager, 'unpinRoom').mockResolvedValue(undefined);
      const result = await controller.unpinRoom('room-1');
      expect(roomManager.unpinRoom).toHaveBeenCalledWith('room-1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('POST /staff-chat/rooms/:id/read', () => {
    it('delegates to roomManager.markAsRead and returns markedCount', async () => {
      jest.spyOn(roomManager, 'markAsRead').mockResolvedValue({ markedCount: 3 });
      const result = await controller.markAsRead('room-1');
      expect(roomManager.markAsRead).toHaveBeenCalledWith('room-1');
      expect(result).toEqual({ markedCount: 3 });
    });
  });

  describe('POST /staff-chat/rooms/:id/upload', () => {
    it('delegates to roomManager.uploadFile with room, file, user id, clientMessageId', async () => {
      const file = { originalname: 'x.png', mimetype: 'image/png', buffer: Buffer.from('') } as any;
      const uploadResult = {
        success: true,
        url: 'signed-url',
        key: 'k',
        filename: 'x.png',
        delivered: true,
      };
      jest.spyOn(roomManager, 'uploadFile').mockResolvedValue(uploadResult);

      const result = await controller.uploadFile('room-1', file, 'tok-1', {
        user: { id: 'user-1' },
      } as any);

      expect(roomManager.uploadFile).toHaveBeenCalledWith('room-1', file, 'user-1', 'tok-1');
      expect(result).toEqual(uploadResult);
    });

    it('ไม่ส่ง clientMessageId มาก็ยังทำงาน (ผู้เรียกเก่า)', async () => {
      const file = { originalname: 'x.pdf', mimetype: 'application/pdf', buffer: Buffer.from('') } as any;
      jest.spyOn(roomManager, 'uploadFile').mockResolvedValue({
        success: true,
        url: 'signed-url',
        key: 'k',
        filename: 'x.pdf',
        delivered: false,
      });

      await controller.uploadFile('room-1', file, undefined, { user: { id: 'user-1' } } as any);

      expect(roomManager.uploadFile).toHaveBeenCalledWith('room-1', file, 'user-1', undefined);
    });
  });

  describe('GET /staff-chat/customer/:customerId/messages', () => {
    it('clamps limit and delegates to roomManager.getCustomerMessages', async () => {
      const payload = { roomId: 'r-1', channel: 'LINE_FINANCE', messages: [], hasMore: false };
      jest.spyOn(roomManager, 'getCustomerMessages').mockResolvedValue(payload as any);

      const result = await controller.getCustomerMessages('cust-1', '30', undefined);

      expect(roomManager.getCustomerMessages).toHaveBeenCalledWith('cust-1', 30, undefined);
      expect(result).toEqual(payload);
    });

    it('clamps limit above 100 down to 100', async () => {
      jest.spyOn(roomManager, 'getCustomerMessages').mockResolvedValue({} as any);
      await controller.getCustomerMessages('cust-1', '999', 'msg-9');
      expect(roomManager.getCustomerMessages).toHaveBeenCalledWith('cust-1', 100, 'msg-9');
    });
  });

  describe('POST /staff-chat/customer/:customerId/messages', () => {
    it('returns non-throwing {success:false} for empty text without resolving a room', async () => {
      const result = await controller.sendCustomerMessage(
        'cust-1',
        { text: '   ' },
        { user: { id: 'user-1' } } as any,
      );
      expect(result).toEqual({ success: false, error: 'กรุณาพิมพ์ข้อความก่อนส่ง' });
      expect(roomManager.sendCustomerMessage).not.toHaveBeenCalled();
    });

    it('returns non-throwing {success:false} when customer has no LINE room', async () => {
      jest.spyOn(roomManager, 'sendCustomerMessage').mockResolvedValue({ room: null });
      const result = await controller.sendCustomerMessage(
        'cust-1',
        { text: 'hello' },
        { user: { id: 'user-1' } } as any,
      );
      expect(roomManager.sendCustomerMessage).toHaveBeenCalledWith('cust-1', 'user-1', 'hello');
      expect(result).toEqual({
        success: false,
        error: 'ลูกค้ายังไม่เคยทักเข้ามาในแชท LINE — รอลูกค้าทักก่อน',
      });
      expect(gateway.emitNewMessage).not.toHaveBeenCalled();
    });

    it('emits the broadcast with the exact STAFF payload and returns the send result', async () => {
      jest
        .spyOn(roomManager, 'sendCustomerMessage')
        .mockResolvedValue({ room: { id: 'room-9' }, result: { success: true } });

      const result = await controller.sendCustomerMessage(
        'cust-1',
        { text: 'hi there' },
        { user: { id: 'user-1' } } as any,
      );

      expect(gateway.emitNewMessage).toHaveBeenCalledWith('room-9', {
        roomId: 'room-9',
        role: 'STAFF',
        staffId: 'user-1',
        text: 'hi there',
        createdAt: expect.any(String),
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('GET /staff-chat/rooms/:id — chatPlaceholder + possibleSamePerson (Task 16)', () => {
    it('getRoom ติดธง chatPlaceholder และแนบ possibleSamePerson', async () => {
      (roomManager.findById as jest.Mock).mockResolvedValue({
        id: 'r1',
        assignedToId: null,
        customer: { id: 'p1', name: 'Facebook #7890', phone: null, nationalId: null, acquisitionSource: 'CHAT_FACEBOOK' },
      });
      samePerson.findForRoom.mockResolvedValue([{ customerId: 'c2' }]);

      const res = await controller.getRoom('r1', { user: { id: 'u', role: 'OWNER' } } as any);

      expect(res.customer).toMatchObject({ chatPlaceholder: true });
      expect((res as any).possibleSamePerson).toEqual([{ customerId: 'c2' }]);
      expect(samePerson.findForRoom).toHaveBeenCalledWith('r1');
    });

    it('SALES เปิดห้องที่ยังไม่มีเจ้าของ — ยังเห็น chatPlaceholder(false) + possibleSamePerson แต่ nationalId ถูกซ่อน (PDPA เดิม)', async () => {
      // ลูกค้าจริง (มีทั้งเบอร์และเลขบัตร) — ไม่ใช่ placeholder แต่ยังต้องผ่านด่าน PDPA
      // เดิมของห้องที่ยังไม่มีเจ้าของ เพื่อพิสูจน์ว่าการเติม chatPlaceholder/possibleSamePerson
      // ไม่ได้ไปแทนที่โลจิกซ่อน nationalId ที่มีอยู่ก่อนแล้ว
      (roomManager.findById as jest.Mock).mockResolvedValue({
        id: 'r1',
        assignedToId: null,
        customer: {
          id: 'p1',
          name: 'สมชาย ใจดี',
          phone: '0812345678',
          nationalId: '1234567890123',
          acquisitionSource: 'WALK_IN',
        },
      });
      samePerson.findForRoom.mockResolvedValue([{ customerId: 'c2' }]);

      const res: any = await controller.getRoom('r1', { user: { id: 'sales-1', role: 'SALES' } } as any);

      expect(res.customer).toMatchObject({ chatPlaceholder: false, nationalId: null });
      expect(res.possibleSamePerson).toEqual([{ customerId: 'c2' }]);
    });
  });

  describe('PATCH /staff-chat/rooms/:id/same-person/dismiss', () => {
    it('dismissSamePerson ต้องมี customerId แล้วส่งต่อ', async () => {
      await expect(controller.dismissSamePerson('r1', '')).rejects.toThrow('กรุณาระบุ customerId');
      await expect(controller.dismissSamePerson('r1', 'c2')).resolves.toEqual({ success: true });
      expect(samePerson.dismiss).toHaveBeenCalledWith('r1', 'c2');
    });
  });

  describe('GET /staff-chat/rooms/:id/cross-channel', () => {
    it('delegates to roomManager.getCrossChannelRooms', async () => {
      const rooms = [{ id: 'r-1', channel: 'LINE_FINANCE', lastMessageAt: null, messages: [] }];
      jest.spyOn(roomManager, 'getCrossChannelRooms').mockResolvedValue(rooms as any);

      const result = await controller.getCrossChannelRooms('room-1');

      expect(roomManager.getCrossChannelRooms).toHaveBeenCalledWith('room-1');
      expect(result).toEqual(rooms);
    });
  });

  describe('GET /staff-chat/ai/status (B3 Task 13)', () => {
    it('@Roles restricts to OWNER only', () => {
      const reflector = new Reflector();
      const roles = reflector.get<string[]>(ROLES_KEY, StaffChatController.prototype.getAiStatus);
      expect(roles).toEqual(['OWNER']);
    });

    it('delegates to aiAutoReply.getRuntimeStatus', async () => {
      const status = {
        fbBotDisabled: false,
        fbWhitelistCount: 0,
        centralBranchSet: true,
        promptpaySet: true,
        tiktokAdapterStub: true,
        financeBotSeparatePipeline: true,
      };
      jest.spyOn(aiAutoReply, 'getRuntimeStatus').mockResolvedValue(status);

      const result = await controller.getAiStatus();

      expect(aiAutoReply.getRuntimeStatus).toHaveBeenCalledWith();
      expect(result).toEqual(status);
    });
  });

  // 2026-09-13: เดิม broadcast เหมือนส่งสำเร็จเสมอ ⇒ เพื่อนร่วมทีมเห็นบับเบิลปกติ
  // ทั้งที่ลูกค้าไม่ได้รับ แล้วข้ามห้องนั้นไปเพราะคิดว่า "ตอบแล้ว"
  describe('POST /staff-chat/rooms/:id/messages — บอกสถานะการส่งให้ทั้งห้อง', () => {
    it('ส่งสำเร็จ → delivered: true และไม่แจ้งล้มเหลว', async () => {
      (router.sendStaffMessage as jest.Mock).mockResolvedValue({
        success: true,
        message: { id: 'msg-1', createdAt: new Date('2026-09-13T01:00:00Z') },
      });

      const result = await controller.sendRoomMessage(
        'room-1',
        { text: 'สวัสดีครับ' },
        { user: { id: 'user-1' } } as any,
      );

      expect(gateway.emitNewMessage).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({ role: 'STAFF', text: 'สวัสดีครับ', delivered: true }),
      );
      expect(gateway.emitSendFailed).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('ส่งไม่สำเร็จ → delivered: false และแจ้งล้มเหลวให้ทั้งห้อง', async () => {
      (router.sendStaffMessage as jest.Mock).mockResolvedValue({
        success: false,
        error: 'พ้นหน้าต่าง 24 ชั่วโมงของ Facebook',
        message: { id: 'msg-2', createdAt: new Date('2026-09-13T01:00:00Z') },
      });

      await controller.sendRoomMessage(
        'room-1',
        { text: 'ยังสนใจอยู่ไหมครับ' },
        { user: { id: 'user-1' } } as any,
      );

      expect(gateway.emitNewMessage).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({ delivered: false }),
      );
      expect(gateway.emitSendFailed).toHaveBeenCalledWith('room-1', {
        text: 'ยังสนใจอยู่ไหมครับ',
        error: 'พ้นหน้าต่าง 24 ชั่วโมงของ Facebook',
      });
    });
  });
});
