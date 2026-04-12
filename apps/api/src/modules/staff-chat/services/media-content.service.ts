import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineFinanceClientService } from '../../chatbot-finance/services/line-finance-client.service';
import { StorageService } from '../../storage/storage.service';

@Injectable()
export class MediaContentService {
  private readonly logger = new Logger(MediaContentService.name);

  constructor(
    private prisma: PrismaService,
    private lineFinanceClient: LineFinanceClientService,
    private storageService: StorageService,
  ) {}

  /**
   * Get a playable audio URL for a voice message.
   * Downloads from LINE if not yet cached in storage, then returns a signed URL.
   */
  async getAudioUrl(messageId: string): Promise<{ url: string }> {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('ไม่พบข้อความ');
    }

    if (message.type !== 'AUDIO') {
      throw new BadRequestException('ข้อความนี้ไม่ใช่ไฟล์เสียง');
    }

    // If already stored in our storage (not a LINE internal URL), return signed URL
    if (message.mediaUrl && !message.mediaUrl.startsWith('line://')) {
      const url = await this.storageService.getSignedDownloadUrl(message.mediaUrl, 900);
      return { url };
    }

    // Download from LINE Content API using the external message ID
    if (!message.externalMessageId) {
      throw new BadRequestException('ไม่มี external message ID สำหรับดาวน์โหลดไฟล์เสียง');
    }

    try {
      const buffer = await this.lineFinanceClient.getMessageContent(message.externalMessageId);
      const storageKey = `chat-audio/${messageId}.m4a`;

      await this.storageService.upload(storageKey, buffer, 'audio/mp4');

      // Update mediaUrl to storage key so next request skips LINE download
      await this.prisma.chatMessage.update({
        where: { id: messageId },
        data: { mediaUrl: storageKey },
      });

      const url = await this.storageService.getSignedDownloadUrl(storageKey, 900);
      return { url };
    } catch (error) {
      this.logger.error(`Failed to download audio for message ${messageId}`, error);
      throw new BadRequestException('ไม่สามารถดาวน์โหลดไฟล์เสียงได้');
    }
  }
}
