import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel, MessageType } from '@prisma/client';
import {
  IDomainHandler,
  DomainContext,
  DomainResult,
} from '../chat-engine/interfaces/domain-handler.interface';
import { OutboundMessage } from '../chat-engine/interfaces/channel-adapter.interface';
import { FacebookQuickReplyService, FacebookQuickReply } from './facebook-quick-reply.service';

/**
 * FacebookDomainHandler — processes messages from Facebook Messenger.
 *
 * Separate from LINE handlers to allow Facebook-specific customization
 * (templates, quick replies, persistent menu payloads).
 *
 * Logic branches:
 * 1. Handoff active → don't process (staff handles)
 * 2. Not verified → prompt with onboarding quick replies
 * 3. Image (slip) → acknowledge + tag
 * 4. Text → AI route (same as LINE finance, handled by AI auto-reply in MessageRouter)
 */
@Injectable()
export class FacebookDomainHandler implements IDomainHandler {
  readonly supportedChannels: ChatChannel[] = [ChatChannel.FACEBOOK];
  private readonly logger = new Logger(FacebookDomainHandler.name);

  constructor(private quickReply: FacebookQuickReplyService) {}

  supportsChannel(channel: ChatChannel): boolean {
    return this.supportedChannels.includes(channel);
  }

  async handleMessage(context: DomainContext): Promise<DomainResult> {
    const { room, message, isVerified, isHandoff } = context;

    // If in handoff mode, don't process with AI
    if (isHandoff) {
      return { replies: [] };
    }

    // If not verified, prompt for verification with onboarding quick replies
    if (!isVerified) {
      return {
        replies: [
          this.buildTextReplyWithQuickReplies(
            message.externalUserId,
            'สวัสดีค่ะ ยินดีต้อนรับสู่ BESTCHOICE 🏪\nรบกวนยืนยันตัวตนก่อนนะคะ เพื่อความปลอดภัยของข้อมูลค่ะ 🔐',
            this.quickReply.onboarding(),
          ),
        ],
      };
    }

    // Handle image messages (slip processing)
    if (message.type === MessageType.IMAGE && message.mediaUrl) {
      return {
        replies: [
          this.buildTextReplyWithQuickReplies(
            message.externalUserId,
            'ได้รับสลิปแล้วค่ะ กำลังตรวจสอบ... 🔍',
            this.quickReply.afterPayment(),
          ),
        ],
        tags: ['slip'],
      };
    }

    // Handle text messages
    if (message.text) {
      this.logger.debug(
        `[FacebookDomain] text from room ${room.id}: ${message.text.substring(0, 50)}`,
      );

      // Handle specific payloads from persistent menu / quick replies
      const payload = message.text.trim();

      if (payload === 'คุยกับพนักงาน') {
        return {
          replies: [
            this.buildTextReply(
              message.externalUserId,
              'กำลังส่งต่อให้พนักงานค่ะ รอสักครู่นะคะ 🙏',
            ),
          ],
          shouldHandoff: true,
          handoffReason: 'ลูกค้าขอพูดกับพนักงานผ่าน Facebook',
          handoffPriority: 'normal',
        };
      }

      // For other text, return empty replies to let AI auto-reply handle it.
      return { replies: [] };
    }

    return { replies: [] };
  }

  private buildTextReply(
    externalUserId: string,
    text: string,
  ): OutboundMessage {
    return {
      externalUserId,
      channel: ChatChannel.FACEBOOK,
      type: MessageType.TEXT,
      text,
    };
  }

  private buildTextReplyWithQuickReplies(
    externalUserId: string,
    text: string,
    quickReplies: FacebookQuickReply[],
  ): OutboundMessage {
    return {
      externalUserId,
      channel: ChatChannel.FACEBOOK,
      type: MessageType.TEXT,
      text,
      templatePayload: { quick_replies: quickReplies },
    };
  }
}
