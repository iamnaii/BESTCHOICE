import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StaffChatController } from './staff-chat.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { RoomManagerService } from '../chat-engine/services/room-manager.service';
import { AssignmentService } from '../chat-engine/services/assignment.service';
import { ConversationTagService } from '../chat-engine/services/conversation-tag.service';
import { HandoffManagerService } from '../chat-engine/services/handoff-manager.service';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { StaffMessageService } from './services/staff-message.service';
import { AiAssistantService } from './services/ai-assistant.service';
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
import { StorageService } from '../storage/storage.service';
import { StaffChatGateway } from './staff-chat.gateway';

describe('StaffChatController', () => {
  let controller: StaffChatController;
  let staffMessage: StaffMessageService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [StaffChatController],
      providers: [
        { provide: PrismaService, useValue: {} },
        { provide: RoomManagerService, useValue: {} },
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
        { provide: AiAssistantService, useValue: {} },
        { provide: MediaContentService, useValue: {} },
        { provide: ChatToContractService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: MessageRouterService, useValue: {} },
        { provide: AiSuggestService, useValue: {} },
        { provide: LeadScoringService, useValue: {} },
        { provide: ProductDetectService, useValue: {} },
        { provide: AiTrainingService, useValue: {} },
        { provide: AiAutoReplyService, useValue: {} },
        { provide: AiImportService, useValue: {} },
        { provide: AiMetricsService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: TrainingExtractCron, useValue: {} },
        { provide: StaffChatGateway, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(StaffChatController);
    staffMessage = module.get(StaffMessageService);
  });

  describe('GET /staff-chat/rooms/:roomId/canned-responses/:id/preview', () => {
    it('returns expanded content for a canned response', async () => {
      const mockResult = {
        id: 'cr-1',
        shortcut: 'สวัสดี',
        title: 'ทักทาย',
        content: 'สวัสดีคุณ {customerName}',
        expandedContent: 'สวัสดีคุณ สมชาย',
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
});
