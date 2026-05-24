import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  Delete,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RoomManagerService } from '../chat-engine/services/room-manager.service';
import { AssignmentService } from '../chat-engine/services/assignment.service';
import { ConversationTagService } from '../chat-engine/services/conversation-tag.service';
import { HandoffManagerService } from '../chat-engine/services/handoff-manager.service';
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
import { AiSuggestRequestDto } from './dto/ai-suggest.dto';
import { SaveFeedbackDto } from './dto/ai-training.dto';
import { UpdateAiSettingsDto } from './dto/ai-settings.dto';
import { SessionQueryDto } from '../chat-engine/dto/session-query.dto';
import { ChatRoomStatus, ChatChannel, ChatPriority, MessageRole, MessageType } from '@prisma/client';
import { StorageService } from '../storage/storage.service';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { StaffChatGateway } from './staff-chat.gateway';
import { CHAT_EVENTS, CHAT_ROOMS } from '../chat-engine/constants/chat-events';

@Controller('staff-chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaffChatController {
  constructor(
    private prisma: PrismaService,
    private roomManager: RoomManagerService,
    private assignment: AssignmentService,
    private tags: ConversationTagService,
    private handoff: HandoffManagerService,
    private staffMessage: StaffMessageService,
    private aiAssistant: AiAssistantService,
    private mediaContent: MediaContentService,
    private chatToContract: ChatToContractService,
    private storageService: StorageService,
    private messageRouter: MessageRouterService,
    private aiSuggest: AiSuggestService,
    private leadScoring: LeadScoringService,
    private productDetect: ProductDetectService,
    private aiTraining: AiTrainingService,
    private aiAutoReply: AiAutoReplyService,
    private aiImport: AiImportService,
    private aiMetrics: AiMetricsService,
    private config: ConfigService,
    private trainingExtractCron: TrainingExtractCron,
    private staffChatGateway: StaffChatGateway,
  ) {}

  // ─── Rooms ────────────────────────────────────────────

  @Get('rooms')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async listRooms(@Query() query: SessionQueryDto) {
    return this.roomManager.listRooms({
      channel: query.channel as ChatChannel | undefined,
      status: query.status as ChatRoomStatus | undefined,
      priority: query.priority as ChatPriority | undefined,
      assignedToId: query.assignedToId,
      unassignedOnly: query.unassignedOnly,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('rooms/:id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getRoom(@Param('id') id: string) {
    return this.roomManager.findById(id);
  }

  @Get('rooms/:id/messages')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getMessages(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.roomManager.getRecentMessages(id, limit ? parseInt(limit, 10) : 50);
  }

  @Post('rooms/:id/messages')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async sendRoomMessage(
    @Param('id') id: string,
    @Body() body: { text: string },
    @Req() req: { user: { id: string } },
  ) {
    const text = (body?.text ?? '').trim();
    if (!text) {
      return { success: false, error: 'กรุณาพิมพ์ข้อความก่อนส่ง' };
    }
    const result = await this.messageRouter.sendStaffMessage({
      roomId: id,
      staffId: req.user.id,
      text,
    });

    // Broadcast to staff viewing this room so the message appears in real-time
    this.staffChatGateway.emitNewMessage(id, {
      roomId: id,
      role: 'STAFF',
      staffId: req.user.id,
      text,
      createdAt: new Date().toISOString(),
    });

    return result;
  }

  // ─── Unread + Search ────────────────────────────────────

  @Get('unread-count')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getUnreadCount(@Req() req: any) {
    return this.roomManager.getUnreadCount(req.user.id);
  }

  @Get('search')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async searchMessages(
    @Query('q') query: string,
    @Query('channel') channel?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.roomManager.searchMessages({
      query: query || '',
      channel: channel as any,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // ─── Assignment ────────────────────────────────────────

  @Patch('rooms/:id/assign')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async assignRoom(
    @Param('id') id: string,
    @Body('staffId') staffId: string,
  ) {
    await this.assignment.assign(id, staffId);
    return { success: true };
  }

  @Patch('rooms/:id/customer')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async linkCustomerToRoom(
    @Param('id') id: string,
    @Body('customerId') customerId: string,
  ) {
    if (!customerId || typeof customerId !== 'string') {
      throw new BadRequestException('กรุณาระบุ customerId');
    }
    await this.roomManager.linkCustomer(id, customerId);
    return { success: true };
  }

  @Patch('rooms/:id/transfer')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async transferRoom(
    @Param('id') id: string,
    @Body('toStaffId') toStaffId: string,
    @Req() req: any,
  ) {
    // T4-C11: service rejects post-signature handoff unless actorRole=OWNER
    await this.assignment.transfer(id, req.user.id, toStaffId, req.user.role);
    return { success: true };
  }

  @Patch('rooms/:id/resolve')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async resolveRoom(@Param('id') id: string, @Req() req: any) {
    await this.assignment.resolve(id, req.user.id);
    return { success: true };
  }

  // ─── Tags ──────────────────────────────────────────────

  @Post('rooms/:id/tags')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async addTag(
    @Param('id') id: string,
    @Body('tag') tag: string,
  ) {
    await this.tags.addTag(id, tag);
    return { success: true };
  }

  @Delete('rooms/:id/tags/:tag')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async removeTag(@Param('id') id: string, @Param('tag') tag: string) {
    await this.tags.removeTag(id, tag);
    return { success: true };
  }

  @Get('tags')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getAllTags() {
    return this.tags.getAllUniqueTags();
  }

  // ─── Notes ─────────────────────────────────────────────

  @Post('rooms/:id/notes')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async addNote(
    @Param('id') id: string,
    @Body('content') content: string,
    @Req() req: any,
  ) {
    return this.staffMessage.addNote(id, req.user.id, content);
  }

  @Get('rooms/:id/notes')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getNotes(@Param('id') id: string) {
    return this.staffMessage.getNotes(id);
  }

  // ─── Canned Responses ─────────────────────────────────

  @Get('canned-responses')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getCannedResponses(@Query('category') category?: string) {
    return this.staffMessage.getCannedResponses(category);
  }

  @Get('rooms/:roomId/canned-responses/:id/preview')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async previewCannedResponse(
    @Param('roomId') roomId: string,
    @Param('id') id: string,
  ) {
    return this.staffMessage.getCannedResponseExpanded(id, roomId);
  }

  @Post('canned-responses')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async createCannedResponse(@Body() body: { shortcut: string; title: string; content: string; category?: string; sortOrder?: number }) {
    return this.staffMessage.createCannedResponse(body);
  }

  @Patch('canned-responses/:id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async updateCannedResponse(@Param('id') id: string, @Body() body: any) {
    return this.staffMessage.updateCannedResponse(id, body);
  }

  @Delete('canned-responses/:id')
  @Roles('OWNER')
  async deleteCannedResponse(@Param('id') id: string) {
    return this.staffMessage.deleteCannedResponse(id);
  }

  // ─── Handoff ───────────────────────────────────────────

  @Patch('rooms/:id/return-to-ai')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async returnToAI(@Param('id') id: string) {
    await this.handoff.resolveHandoff(id, true);
    return { success: true };
  }

  // ─── Presence ──────────────────────────────────────────

  @Get('staff/online')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getOnlineStaff() {
    return this.assignment.getStaffRoomCounts();
  }

  // ─── AI Assistant ──────────────────────────────────────

  @Post('rooms/:id/summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async summarizeRoom(@Param('id') id: string) {
    const summary = await this.aiAssistant.summarizeConversation(id);
    return { summary };
  }

  @Post('ai/adjust-tone')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async adjustTone(@Body() body: { text: string; tone: 'formal' | 'casual' | 'friendly' }) {
    const adjusted = await this.aiAssistant.adjustTone(body.text, body.tone);
    return { text: adjusted };
  }

  @Post('rooms/:id/suggest')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getSuggestions(@Param('id') id: string, @Body() dto: AiSuggestRequestDto) {
    const enabled = this.config.get<string>('AI_SUGGEST_ENABLED') === 'true';
    const hasApiKey = !!this.config.get<string>('ANTHROPIC_API_KEY');
    // Allow mock mode (no API key) even without AI_SUGGEST_ENABLED
    if (!enabled && hasApiKey) {
      return { suggestions: [], detectedProducts: [], processingTimeMs: 0 };
    }
    return this.aiSuggest.suggest(id, dto.currentDraft);
  }

  @Get('rooms/:id/products')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getDetectedProducts(@Param('id') id: string): Promise<any[]> {
    const messages = await this.roomManager.getRecentMessages(id, 20);
    const texts = messages.map((m: any) => m.text ?? '').filter(Boolean);
    return this.productDetect.detectProducts(texts);
  }

  @Get('rooms/:id/lead-score')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getLeadScore(@Param('id') id: string): Promise<any> {
    return this.leadScoring.scoreSession(id);
  }

  // ─── Media Content ────────────────────────────────────

  @Get('messages/:messageId/audio')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getAudioUrl(@Param('messageId') messageId: string) {
    return this.mediaContent.getAudioUrl(messageId);
  }

  // ─── File Upload ──────────────────────────────────────

  @Post('rooms/:id/upload')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @Param('id') roomId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024, message: 'ไฟล์มีขนาดเกิน 10MB' }),
          new FileTypeValidator({ fileType: /^(image\/(jpeg|png|webp)|application\/pdf|application\/(msword|vnd\.openxmlformats))/ }),
        ],
        fileIsRequired: true,
        errorHttpStatusCode: 400,
      }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    };
    const ext = extMap[file.mimetype] || '';
    const key = `staff-chat/${roomId}/${Date.now()}${ext}`;

    await this.storageService.upload(key, file.buffer, file.mimetype);
    const downloadUrl = this.storageService.configured
      ? await this.storageService.getSignedDownloadUrl(key, 3600)
      : key;

    // Save as a message with media
    await this.roomManager.saveMessage({
      roomId,
      role: MessageRole.BOT,
      type: file.mimetype.startsWith('image/') ? MessageType.IMAGE : MessageType.FILE,
      text: file.originalname,
      mediaUrl: key,
      mediaType: file.mimetype,
      staffId: userId,
    });

    return { success: true, url: downloadUrl, key, filename: file.originalname };
  }

  // ─── Contract Prefill ─────────────────────────────────

  @Get('rooms/:id/contract-prefill')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getContractPrefill(@Param('id') id: string) {
    return this.chatToContract.getContractPrefill(id);
  }

  // ─── Pin / Unpin Room ─────────────────────────────────

  @Post('rooms/:id/pin')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async pinRoom(@Param('id') id: string, @Req() req: any) {
    const userId = req.user.id;
    await this.prisma.chatRoom.update({
      where: { id },
      data: { pinnedAt: new Date(), pinnedById: userId },
    });
    return { success: true };
  }

  @Delete('rooms/:id/pin')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async unpinRoom(@Param('id') id: string) {
    await this.prisma.chatRoom.update({
      where: { id },
      data: { pinnedAt: null, pinnedById: null },
    });
    return { success: true };
  }

  // ─── Mark as Read ─────────────────────────────────────

  @Post('rooms/:id/read')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async markAsRead(@Param('id') id: string) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.chatMessage.updateMany({
        where: { roomId: id, role: 'CUSTOMER', readAt: null },
        data: { readAt: now },
      });
      const remaining = await tx.chatMessage.count({
        where: { roomId: id, role: 'CUSTOMER', readAt: null },
      });
      await tx.chatRoom.update({
        where: { id },
        data: { unreadCount: remaining },
      });
      return { markedCount: updated.count };
    });
  }

  // ─── Customer-scoped messages (LineChatPanel — Customer 360) ──

  /**
   * Last N messages across the customer's LINE rooms (LINE_FINANCE preferred).
   * Used by the Customer 360 LineChatPanel — collectors don't need to leave
   * the collections workspace to see what was said in chat.
   *
   * Returns messages in reverse-chronological order (newest first) so
   * `before=<oldest.id>` paging walks backward through history. The frontend
   * reverses for display.
   */
  @Get('customer/:customerId/messages')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')
  async getCustomerMessages(
    @Param('customerId') customerId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const take = Math.min(Math.max(parseInt(limit ?? '30', 10) || 30, 1), 100);

    // Find the customer's LINE Finance room (preferred) or fall back to any
    // LINE room. Collections is a finance-only workflow — no point pulling
    // shop-side LINE chat here.
    const room = await this.prisma.chatRoom.findFirst({
      where: {
        customerId,
        deletedAt: null,
        channel: { in: [ChatChannel.LINE_FINANCE, ChatChannel.LINE_SHOP] },
      },
      orderBy: [
        // Prefer LINE_FINANCE if both exist (alphabetical "LINE_FINANCE" <
        // "LINE_SHOP" so an explicit ordering by lastMessageAt is the
        // tiebreaker that matters).
        { lastMessageAt: 'desc' },
      ],
      select: {
        id: true,
        channel: true,
        lineUserId: true,
        lastMessageAt: true,
        unreadCount: true,
      },
    });

    if (!room) {
      return { roomId: null, channel: null, messages: [], hasMore: false };
    }

    let cursorWhere: { createdAt?: { lt: Date } } = {};
    if (before) {
      const cursor = await this.prisma.chatMessage.findUnique({
        where: { id: before },
        select: { createdAt: true },
      });
      if (cursor) cursorWhere = { createdAt: { lt: cursor.createdAt } };
    }

    const messages = await this.prisma.chatMessage.findMany({
      where: { roomId: room.id, deletedAt: null, ...cursorWhere },
      orderBy: { createdAt: 'desc' },
      take: take + 1, // overfetch by 1 to detect hasMore
      select: {
        id: true,
        role: true,
        type: true,
        text: true,
        mediaUrl: true,
        mediaType: true,
        createdAt: true,
        readAt: true,
        deliveredAt: true,
        staff: { select: { id: true, name: true } },
      },
    });

    const hasMore = messages.length > take;
    const sliced = hasMore ? messages.slice(0, take) : messages;

    return {
      roomId: room.id,
      channel: room.channel,
      messages: sliced,
      hasMore,
    };
  }

  /**
   * Inline send from Customer 360 LineChatPanel. Resolves the customer's
   * LINE Finance room and forwards through `MessageRouterService` so
   * delivery and adapter selection match the rest of staff-chat.
   *
   * Returns 404 when the customer has no LINE room — the FE only renders
   * the panel when `customer.lineIdFinance` is set, but that's a customer-record
   * field; the room is created lazily on first inbound message. Until then
   * outbound is impossible (no LINE userId to push to).
   */
  @Post('customer/:customerId/messages')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')
  async sendCustomerMessage(
    @Param('customerId') customerId: string,
    @Body() body: { text: string },
    @Req() req: { user: { id: string } },
  ) {
    const text = (body?.text ?? '').trim();
    if (!text) {
      return { success: false, error: 'กรุณาพิมพ์ข้อความก่อนส่ง' };
    }

    const room = await this.prisma.chatRoom.findFirst({
      where: {
        customerId,
        deletedAt: null,
        channel: { in: [ChatChannel.LINE_FINANCE, ChatChannel.LINE_SHOP] },
      },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    });

    if (!room) {
      return {
        success: false,
        error: 'ลูกค้ายังไม่เคยทักเข้ามาในแชท LINE — รอลูกค้าทักก่อน',
      };
    }

    const result = await this.messageRouter.sendStaffMessage({
      roomId: room.id,
      staffId: req.user.id,
      text,
    });

    // Broadcast to staff viewing this room so the message appears in real-time
    this.staffChatGateway.emitNewMessage(room.id, {
      roomId: room.id,
      role: 'STAFF',
      staffId: req.user.id,
      text,
      createdAt: new Date().toISOString(),
    });

    return result;
  }

  // ─── Cross-Channel Rooms ──────────────────────────────

  @Get('rooms/:id/cross-channel')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getCrossChannelRooms(@Param('id') id: string) {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id },
      select: { customerId: true },
    });
    if (!room?.customerId) return [];
    return this.prisma.chatRoom.findMany({
      where: { customerId: room.customerId, deletedAt: null },
      select: {
        id: true,
        channel: true,
        lastMessageAt: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { text: true, createdAt: true },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  // ─── AI Training & Settings ───────────────────────────

  @Post('ai/training-feedback')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async saveTrainingFeedback(@Body() dto: SaveFeedbackDto) {
    return this.aiTraining.saveFeedback(dto);
  }

  @Get('ai/training-stats')
  @Roles('OWNER')
  async getTrainingStats() {
    return this.aiTraining.getTrainingStats();
  }

  @Get('ai/settings')
  @Roles('OWNER')
  async getAiSettings() {
    return this.aiAutoReply.getSettings();
  }

  @Patch('ai/settings')
  @Roles('OWNER')
  async updateAiSettings(@Body() dto: UpdateAiSettingsDto) {
    return this.aiAutoReply.updateSettings(dto);
  }

  @Post('ai/test-send')
  @Roles('OWNER')
  async testSendAi() {
    return this.aiAutoReply.testSend();
  }

  // ─── AI Import & Metrics ──────────────────────────────

  @Post('ai/import')
  @Roles('OWNER')
  @UseInterceptors(FileInterceptor('file'))
  async importChatHistory(@UploadedFile() file: Express.Multer.File) {
    const content = file.buffer.toString('utf-8');
    const isJSON = file.originalname.endsWith('.json');
    const rows = isJSON ? this.aiImport.parseJSON(content) : this.aiImport.parseCSV(content);
    return this.aiImport.importChatHistory(rows);
  }

  @Get('ai/metrics')
  @Roles('OWNER')
  async getAiMetrics(@Query('from') from?: string, @Query('to') to?: string) {
    return this.aiMetrics.getMetrics(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Post('ai/training-extract')
  @Roles('OWNER')
  async triggerTrainingExtract() {
    return this.trainingExtractCron.extractTrainingPairs();
  }
}
