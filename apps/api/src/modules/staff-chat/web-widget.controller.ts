import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { ChatChannel } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { SessionManagerService } from '../chat-engine/services/session-manager.service';

/**
 * WebWidgetController — REST endpoints for the web chat widget.
 *
 * All endpoints are public (no auth required) since they serve anonymous website visitors.
 * The widget frontend calls these to initialize sessions and fetch message history.
 */
@Controller('widget')
export class WebWidgetController {
  constructor(private sessionManager: SessionManagerService) {}

  /**
   * Initialize a widget chat session.
   * If a visitorId is provided and has an existing session, returns that session.
   * Otherwise creates a new session with channel=WEB.
   */
  @Post('init')
  @SkipCsrf()
  async initSession(
    @Body() body: { visitorId?: string },
  ): Promise<{ sessionId: string; visitorId: string }> {
    const visitorId = body.visitorId || uuidv4();

    const session = await this.sessionManager.getOrCreateSession({
      externalUserId: visitorId,
      channel: ChatChannel.WEB,
    });

    return {
      sessionId: session.id,
      visitorId,
    };
  }

  /**
   * Get messages for a widget session.
   * No auth required — the sessionId acts as a capability token.
   */
  @Get('messages/:sessionId')
  @SkipCsrf()
  async getMessages(
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ) {
    // Verify session exists and is a WEB channel session
    const session = await this.sessionManager.findById(sessionId);
    if (!session || session.channel !== ChatChannel.WEB) {
      throw new NotFoundException('ไม่พบเซสชัน');
    }

    const messageLimit = limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50;
    const messages = await this.sessionManager.getRecentMessages(sessionId, messageLimit);

    return {
      sessionId,
      messages: messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        text: msg.text,
        createdAt: msg.createdAt,
        staff: msg.staff,
      })),
    };
  }
}
