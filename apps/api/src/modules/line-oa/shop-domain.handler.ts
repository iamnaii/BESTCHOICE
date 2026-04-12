import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel, MessageType } from '@prisma/client';
import {
  IDomainHandler,
  DomainContext,
  DomainResult,
} from '../chat-engine/interfaces/domain-handler.interface';
import { OutboundMessage } from '../chat-engine/interfaces/channel-adapter.interface';

/**
 * ShopDomainHandler — handles LINE Shop channel messages.
 *
 * The LINE Shop OA chatbot is simpler than Finance — mostly product inquiries
 * and general support. This handler bridges to the existing ChatbotService
 * for AI-powered replies.
 *
 * Like FinanceDomainHandler, the actual LINE webhook path still works
 * independently. This handler enables the unified engine to route
 * Shop messages when adapters are fully wired.
 */
@Injectable()
export class ShopDomainHandler implements IDomainHandler {
  readonly supportedChannels: ChatChannel[] = [ChatChannel.LINE_SHOP];
  private readonly logger = new Logger(ShopDomainHandler.name);

  supportsChannel(channel: ChatChannel): boolean {
    return this.supportedChannels.includes(channel);
  }

  async handleMessage(context: DomainContext): Promise<DomainResult> {
    const { session, message, isHandoff } = context;

    if (isHandoff) {
      return { replies: [] };
    }

    // Shop domain currently stores messages for staff pickup.
    // AI auto-reply for Shop will be added when Shop chatbot matures.
    this.logger.debug(
      `[ShopDomain] message from session ${session.id}: ${message.text?.substring(0, 50) ?? '(media)'}`,
    );

    return { replies: [] };
  }
}
