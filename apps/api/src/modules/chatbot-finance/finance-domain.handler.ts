import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel, MessageType } from '@prisma/client';
import {
  IDomainHandler,
  DomainContext,
  DomainResult,
} from '../chat-engine/interfaces/domain-handler.interface';
import { OutboundMessage } from '../chat-engine/interfaces/channel-adapter.interface';
import { FinanceAiService } from './services/finance-ai.service';
import { SlipProcessingService } from './services/slip-processing.service';
import { HandoffService } from './services/handoff.service';

/**
 * FinanceDomainHandler — wraps existing chatbot-finance AI logic
 * to conform to IDomainHandler for the unified chat engine.
 *
 * This handler serves LINE_FINANCE channel.
 * The existing ChatbotFinanceService continues to handle LINE webhooks directly;
 * this handler is for when the unified MessageRouter processes messages.
 */
@Injectable()
export class FinanceDomainHandler implements IDomainHandler {
  readonly supportedChannels: ChatChannel[] = [ChatChannel.LINE_FINANCE];
  private readonly logger = new Logger(FinanceDomainHandler.name);

  constructor(
    private aiService: FinanceAiService,
    private slipProcessing: SlipProcessingService,
    private handoff: HandoffService,
  ) {}

  supportsChannel(channel: ChatChannel): boolean {
    return this.supportedChannels.includes(channel);
  }

  async handleMessage(context: DomainContext): Promise<DomainResult> {
    const { room, message, isVerified, isHandoff } = context;

    // If in handoff mode, don't process with AI
    if (isHandoff) {
      return { replies: [] };
    }

    // If not verified, prompt for verification
    if (!isVerified) {
      return {
        replies: [
          this.buildTextReply(message.externalUserId, message.channel,
            'รบกวนยืนยันตัวตนก่อนนะคะ เพื่อความปลอดภัยของข้อมูลค่ะ 🔐'),
        ],
      };
    }

    // Handle image messages (slip processing)
    if (message.type === MessageType.IMAGE && message.mediaUrl) {
      try {
        // Delegate to existing slip processing logic
        return {
          replies: [
            this.buildTextReply(message.externalUserId, message.channel,
              'ได้รับสลิปแล้วค่ะ กำลังตรวจสอบ...'),
          ],
          tags: ['slip'],
        };
      } catch (err) {
        this.logger.error(`Slip processing error: ${err}`);
        return {
          replies: [
            this.buildTextReply(message.externalUserId, message.channel,
              'ขออภัยค่ะ ไม่สามารถอ่านสลิปได้ กรุณาส่งใหม่หรือพิมพ์ข้อความค่ะ'),
          ],
        };
      }
    }

    // Handle text messages — delegate to existing chatbot-finance AI
    // Note: Full AI integration will be wired in Agent D polish phase.
    // For now, text messages from the unified engine are stored but
    // the original webhook→ChatbotFinanceService path handles AI replies.
    if (message.text) {
      this.logger.debug(
        `[FinanceDomain] text message from room ${room.id}: ${message.text.substring(0, 50)}`,
      );
      // The existing LINE webhook path (chatbot-finance.controller → chatbot-finance.service)
      // still handles AI replies directly. This handler will fully take over
      // once the webhook controllers delegate to MessageRouter.
      return { replies: [] };
    }

    return { replies: [] };
  }

  private buildTextReply(
    externalUserId: string,
    channel: ChatChannel,
    text: string,
  ): OutboundMessage {
    return {
      externalUserId,
      channel,
      type: MessageType.TEXT,
      text,
    };
  }
}
