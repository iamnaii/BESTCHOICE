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
import { RoomManagerService } from '../chat-engine/services/room-manager.service';

/**
 * WebWidgetController — REST endpoints for the web chat widget.
 *
 * All endpoints are public (no auth required) since they serve anonymous website visitors.
 * The widget frontend calls these to initialize sessions and fetch message history.
 */
@Controller('widget')
export class WebWidgetController {
  constructor(private roomManager: RoomManagerService) {}

  /**
   * Initialize a widget chat room.
   * If a visitorId is provided and has an existing room, returns that room.
   * Otherwise creates a new room with channel=WEB.
   */
  @Post('init')
  @SkipCsrf()
  async initRoom(
    @Body() body: { visitorId?: string },
  ): Promise<{ roomId: string; visitorId: string }> {
    const visitorId = body.visitorId || uuidv4();

    const room = await this.roomManager.getOrCreateRoom({
      externalUserId: visitorId,
      channel: ChatChannel.WEB,
    });

    return {
      roomId: room.id,
      visitorId,
    };
  }

  /**
   * Get messages for a widget room.
   * No auth required — the roomId acts as a capability token.
   */
  @Get('messages/:roomId')
  @SkipCsrf()
  async getMessages(
    @Param('roomId') roomId: string,
    @Query('limit') limit?: string,
  ) {
    // Verify room exists and is a WEB channel room
    const room = await this.roomManager.findById(roomId);
    if (!room || room.channel !== ChatChannel.WEB) {
      throw new NotFoundException('ไม่พบห้องแชท');
    }

    const messageLimit = limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50;
    const messages = await this.roomManager.getRecentMessages(roomId, messageLimit);

    return {
      roomId,
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
