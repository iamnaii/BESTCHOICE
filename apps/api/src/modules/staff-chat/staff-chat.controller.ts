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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SessionManagerService } from '../chat-engine/services/session-manager.service';
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
import { AiSuggestRequestDto } from './dto/ai-suggest.dto';
import { SaveFeedbackDto } from './dto/ai-training.dto';
import { UpdateAiSettingsDto } from './dto/ai-settings.dto';
import { SessionQueryDto } from '../chat-engine/dto/session-query.dto';
import { ChatSessionStatus, ChatChannel, ChatPriority, MessageRole, MessageType } from '@prisma/client';
import { StorageService } from '../storage/storage.service';
import { MessageRouterService } from '../chat-engine/services/message-router.service';

@Controller('staff-chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaffChatController {
  constructor(
    private sessionManager: SessionManagerService,
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
  ) {}

  // ─── Sessions ──────────────────────────────────────────

  @Get('sessions')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async listSessions(@Query() query: SessionQueryDto) {
    return this.sessionManager.listSessions({
      channel: query.channel as ChatChannel | undefined,
      sessionStatus: query.sessionStatus as ChatSessionStatus | undefined,
      priority: query.priority as ChatPriority | undefined,
      assignedToId: query.assignedToId,
      unassignedOnly: query.unassignedOnly,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('sessions/:id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getSession(@Param('id') id: string) {
    return this.sessionManager.findById(id);
  }

  @Get('sessions/:id/messages')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getMessages(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.sessionManager.getRecentMessages(id, limit ? parseInt(limit, 10) : 50);
  }

  // ─── Unread + Search ────────────────────────────────────

  @Get('unread-count')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getUnreadCount(@Req() req: any) {
    return this.sessionManager.getUnreadCount(req.user.id);
  }

  @Get('search')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async searchMessages(
    @Query('q') query: string,
    @Query('channel') channel?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.sessionManager.searchMessages({
      query: query || '',
      channel: channel as any,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // ─── Assignment ────────────────────────────────────────

  @Patch('sessions/:id/assign')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async assignSession(
    @Param('id') id: string,
    @Body('staffId') staffId: string,
  ) {
    await this.assignment.assign(id, staffId);
    return { success: true };
  }

  @Patch('sessions/:id/transfer')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async transferSession(
    @Param('id') id: string,
    @Body('toStaffId') toStaffId: string,
    @Req() req: any,
  ) {
    await this.assignment.transfer(id, req.user.id, toStaffId);
    return { success: true };
  }

  @Patch('sessions/:id/resolve')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async resolveSession(@Param('id') id: string, @Req() req: any) {
    await this.assignment.resolve(id, req.user.id);
    return { success: true };
  }

  // ─── Tags ──────────────────────────────────────────────

  @Post('sessions/:id/tags')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async addTag(
    @Param('id') id: string,
    @Body('tag') tag: string,
  ) {
    await this.tags.addTag(id, tag);
    return { success: true };
  }

  @Delete('sessions/:id/tags/:tag')
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

  @Post('sessions/:id/notes')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async addNote(
    @Param('id') id: string,
    @Body('content') content: string,
    @Req() req: any,
  ) {
    return this.staffMessage.addNote(id, req.user.id, content);
  }

  @Get('sessions/:id/notes')
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

  @Patch('sessions/:id/return-to-ai')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async returnToAI(@Param('id') id: string) {
    await this.handoff.resolveHandoff(id, true);
    return { success: true };
  }

  // ─── Presence ──────────────────────────────────────────

  @Get('staff/online')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getOnlineStaff() {
    return this.assignment.getStaffSessionCounts();
  }

  // ─── AI Assistant ──────────────────────────────────────

  @Post('sessions/:id/summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async summarizeSession(@Param('id') id: string) {
    const summary = await this.aiAssistant.summarizeConversation(id);
    return { summary };
  }

  @Post('ai/adjust-tone')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async adjustTone(@Body() body: { text: string; tone: 'formal' | 'casual' | 'friendly' }) {
    const adjusted = await this.aiAssistant.adjustTone(body.text, body.tone);
    return { text: adjusted };
  }

  @Post('sessions/:id/suggest')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getSuggestions(@Param('id') id: string, @Body() dto: AiSuggestRequestDto) {
    const enabled = this.config.get<string>('AI_SUGGEST_ENABLED') === 'true';
    if (!enabled) {
      return { suggestions: [], detectedProducts: [], processingTimeMs: 0 };
    }
    return this.aiSuggest.suggest(id, dto.currentDraft);
  }

  @Get('sessions/:id/products')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getDetectedProducts(@Param('id') id: string): Promise<any[]> {
    const messages = await this.sessionManager.getRecentMessages(id, 20);
    const texts = messages.map((m: any) => m.text ?? '').filter(Boolean);
    return this.productDetect.detectProducts(texts);
  }

  @Get('sessions/:id/lead-score')
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

  @Post('sessions/:id/upload')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @Param('id') sessionId: string,
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
    const key = `staff-chat/${sessionId}/${Date.now()}${ext}`;

    await this.storageService.upload(key, file.buffer, file.mimetype);
    const downloadUrl = this.storageService.configured
      ? await this.storageService.getSignedDownloadUrl(key, 3600)
      : key;

    // Save as a message with media
    await this.sessionManager.saveMessage({
      sessionId,
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

  @Get('sessions/:id/contract-prefill')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getContractPrefill(@Param('id') id: string) {
    return this.chatToContract.getContractPrefill(id);
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
}
