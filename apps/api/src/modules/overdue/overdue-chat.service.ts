import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RoomManagerService } from '../chat-engine/services/room-manager.service';
import { ConversationTagService } from '../chat-engine/services/conversation-tag.service';
import { ChatChannel, ChatPriority, MessageRole, ContractStatus } from '@prisma/client';
import { format } from 'date-fns';
import * as Sentry from '@sentry/nestjs';

/**
 * OverdueChatService — creates/tags inbox sessions for overdue customers.
 *
 * Runs daily at 9:30 AM (after auto-trigger reminders at 9:00).
 * For each overdue contract with a LINE Finance-linked customer:
 *   1. Creates or retrieves the chat session
 *   2. Tags it with 'overdue'
 *   3. Elevates priority to HIGH
 *   4. Posts a system message with overdue details
 */
@Injectable()
export class OverdueChatService {
  private readonly logger = new Logger(OverdueChatService.name);

  constructor(
    private prisma: PrismaService,
    private sessionManager: RoomManagerService,
    private tagService: ConversationTagService,
  ) {}

  /**
   * Daily cron: create/tag inbox sessions for overdue customers.
   * Finds ACTIVE contracts with unpaid payments past due date,
   * then ensures each customer has a tagged chat session for follow-up.
   */
  @Cron('30 9 * * *', { timeZone: 'Asia/Bangkok' })
  async createOverdueInboxSessions(): Promise<void> {
    try {
      const now = new Date();

      // Find contracts that are ACTIVE or OVERDUE with unpaid payments past due
      const overdueContracts = await this.prisma.contract.findMany({
        where: {
          deletedAt: null,
          status: { in: [ContractStatus.ACTIVE, ContractStatus.OVERDUE] },
          payments: {
            some: {
              paidAt: null,
              dueDate: { lt: now },
            },
          },
        },
        include: {
          customer: {
            include: {
              lineLinks: {
                where: {
                  channel: 'FINANCE',
                  deletedAt: null,
                  unlinkedAt: null,
                },
              },
            },
          },
          payments: {
            where: {
              paidAt: null,
              dueDate: { lt: now },
            },
            orderBy: { dueDate: 'asc' },
            take: 1, // oldest unpaid payment
          },
        },
      });

      let sessionsCreated = 0;
      let sessionsSkipped = 0;

      for (const contract of overdueContracts) {
        const lineLink = contract.customer?.lineLinks?.[0];

        if (!lineLink) {
          sessionsSkipped++;
          continue;
        }

        try {
          // 1. Get or create chat session
          const session = await this.sessionManager.getOrCreateRoom({
            externalUserId: lineLink.lineUserId,
            channel: ChatChannel.LINE_FINANCE,
            customerId: contract.customerId,
          });

          // 2. Tag session as overdue
          await this.tagService.addTag(session.id, 'overdue');

          // 3. Update session priority to HIGH
          await this.prisma.chatRoom.update({
            where: { id: session.id },
            data: { priority: ChatPriority.HIGH },
          });

          // 4. Save system message with overdue details
          const oldestUnpaid = contract.payments[0];
          const amountFormatted = Number(oldestUnpaid.amountDue).toLocaleString();
          const dueDateFormatted = format(oldestUnpaid.dueDate, 'dd/MM/yyyy');

          await this.sessionManager.saveMessage({
            roomId: session.id,
            role: MessageRole.SYSTEM,
            text: `⚠️ ลูกค้ามียอดค้างชำระ สัญญา ${contract.contractNumber} จำนวน ${amountFormatted} บาท ครบกำหนด ${dueDateFormatted}`,
          });

          sessionsCreated++;
        } catch (contractError) {
          this.logger.error(
            `Failed to create overdue session for contract ${contract.contractNumber}`,
            contractError,
          );
          Sentry.captureException(contractError, {
            extra: { contractId: contract.id, contractNumber: contract.contractNumber },
          });
        }
      }

      this.logger.log(
        `Overdue inbox sessions: ${sessionsCreated} created/updated, ${sessionsSkipped} skipped (no LINE link)`,
      );
    } catch (error) {
      this.logger.error('Failed to create overdue inbox sessions', error);
      Sentry.captureException(error);
    }
  }
}
