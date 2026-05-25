import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BubbleTranslatorService, Bubble, QuickReply } from './bubble-translator.service';
import { CannedResponseVariableService } from './canned-response-variable.service';
import { MessageRouterService } from '../../chat-engine/services/message-router.service';

/**
 * CannedResponseSenderService — orchestrates the Phase 4 multi-bubble send.
 *
 * Pipeline:
 *   1. Resolve the room and external user ID
 *   2. Load the canned-response template with bubbles + quick replies
 *   3. Enforce verifiedOnly gate
 *   4. Filter bubbles by the room's channel
 *   5. Expand variables in TEXT bubbles via CannedResponseVariableService
 *   6. Translate to OutboundMessage[] and attach quick replies to the LAST one
 *   7. Dispatch through MessageRouterService.sendStaffOutbound sequentially
 *      (preserves bubble order; adapter rate limits still apply per call)
 */
@Injectable()
export class CannedResponseSenderService {
  private readonly logger = new Logger(CannedResponseSenderService.name);

  constructor(
    private prisma: PrismaService,
    private translator: BubbleTranslatorService,
    private variableService: CannedResponseVariableService,
    private messageRouter: MessageRouterService,
  ) {}

  async send(
    roomId: string,
    templateId: string,
    staffId: string,
  ): Promise<{ sent: number; dropped: number; errors: string[] }> {
    // 1. Resolve room
    const room = await this.prisma.chatRoom.findFirst({
      where: { id: roomId, deletedAt: null },
      select: {
        id: true,
        channel: true,
        externalUserId: true,
        lineUserId: true,
        customerId: true,
        verifiedAt: true,
      },
    });
    if (!room) throw new NotFoundException('ไม่พบห้องแชท');

    const externalUserId = room.externalUserId ?? room.lineUserId;
    if (!externalUserId) {
      throw new BadRequestException('ห้องไม่มี externalUserId/lineUserId — ไม่สามารถส่งได้');
    }

    // 2. Load template
    const template = await this.prisma.cannedResponse.findFirst({
      where: { id: templateId, deletedAt: null, isActive: true },
      include: {
        bubbles: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        quickReplies: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!template) throw new NotFoundException('ไม่พบ template');

    // 3. verifiedOnly gate
    if (template.verifiedOnly && !room.verifiedAt) {
      throw new BadRequestException('Template นี้ใช้ได้เฉพาะลูกค้าที่ยืนยันตัวตนแล้ว');
    }

    // 4. Filter by channel
    const allBubbles = template.bubbles as unknown as Bubble[];
    const applicableBubbles = this.translator.filterByChannel(allBubbles, room.channel);
    if (applicableBubbles.length === 0) {
      throw new BadRequestException('ไม่มี bubble ที่ใช้กับ channel นี้');
    }

    // 5. Expand variables in TEXT bubbles.
    //
    // To avoid N+1 DB queries (each expandVariables call hits customer +
    // contract + payment + chatRoom), resolve every supported variable
    // ONCE via a probe string, build a substitution map, then apply it
    // locally to each TEXT bubble.
    //
    // The probe uses the ASCII SOH control char (U+0001) as a delimiter
    // that the variable service's final `result.replace(/\{(\w+)\}/g, ...)`
    // preserves verbatim — only `{name}` tokens are substituted, the
    // separator passes through unchanged. SOH was chosen because it
    // cannot appear in any user-facing value (name, phone, amount, etc.).
    const VARIABLE_KEYS = [
      'customerName',
      'customerPhone',
      'contractNumber',
      'amountDue',
      'dueDate',
      'installmentNo',
      'branchName',
    ] as const;
    const SEP = ''; // unlikely to appear in any resolved value
    const probe = VARIABLE_KEYS.map((k) => `{${k}}`).join(SEP);
    const expandedProbe = await this.variableService.expandVariables(probe, {
      roomId,
      customerId: room.customerId ?? undefined,
    });
    const resolvedParts = expandedProbe.split(SEP);
    const resolvedValues: Record<string, string> = {};
    VARIABLE_KEYS.forEach((k, i) => {
      resolvedValues[k] = resolvedParts[i] ?? '-';
    });

    const expandedBubbles = applicableBubbles.map((b) => {
      if (b.type === 'TEXT' && b.text) {
        const text = b.text.replace(
          /\{(\w+)\}/g,
          (_match, key: string) => resolvedValues[key] ?? '-',
        );
        return { ...b, text };
      }
      return b;
    });

    // 6. Translate to OutboundMessage[] and attach quick replies to LAST one
    const quickReplies = this.translator.translateQuickReplies(
      template.quickReplies as unknown as QuickReply[],
    );
    const outbound = expandedBubbles.map((b) =>
      this.translator.toOutboundMessage(b, externalUserId),
    );
    if (quickReplies.length > 0 && outbound.length > 0) {
      outbound[outbound.length - 1].quickReplies = quickReplies;
    }

    // 7. Sequential dispatch — preserves bubble order, surfaces per-message status
    let sent = 0;
    let dropped = 0;
    const errors: string[] = [];

    for (const msg of outbound) {
      try {
        const result = await this.messageRouter.sendStaffOutbound(roomId, msg, staffId);
        if (result.success) {
          if (result.droppedReason) {
            dropped++;
          } else {
            sent++;
          }
        } else {
          errors.push(result.error ?? 'unknown adapter error');
        }
      } catch (err) {
        const msgErr = err instanceof Error ? err.message : String(err);
        errors.push(msgErr);
        this.logger.error(`Failed to send bubble: ${msgErr}`);
      }
    }

    return { sent, dropped, errors };
  }
}
