import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StaffNotificationService } from './staff-notification.service';

export type HandoffPriority = 'low' | 'normal' | 'high' | 'critical';

export interface HandoffParams {
  roomId: string;
  reason: string;
  priority: HandoffPriority;
  summary: string;
  tags?: string[];
}

/**
 * Handoff Service — mark session ว่าต้องส่งต่อพนักงาน
 *
 * Phase B: เก็บใน DB + log
 * Phase A3 (อนาคต): ส่ง notification ผ่าน LINE Staff OA / Group
 */
@Injectable()
export class HandoffService {
  private readonly logger = new Logger(HandoffService.name);

  constructor(
    private prisma: PrismaService,
    private staffNotify: StaffNotificationService,
  ) {}

  async handoff(params: HandoffParams): Promise<{ handoffId: string; estimatedTime: string }> {
    await this.prisma.chatRoom.update({
      where: { id: params.roomId },
      data: {
        handoffMode: true,
        handoffReason: params.reason,
        handoffTaggedAt: new Date(),
      },
    });

    this.logger.warn(
      `🚨 [Handoff] roomId=${params.roomId} priority=${params.priority} reason="${params.reason}"`,
    );

    // ส่ง notification ไป Staff LINE OA (best-effort, ไม่ fail handoff)
    try {
      await this.staffNotify.notifyHandoff({
        roomId: params.roomId,
        reason: params.reason,
        priority: params.priority,
        summary: params.summary,
      });
    } catch (err) {
      this.logger.error(
        `[Handoff] staff notify failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    const estimatedTime = params.priority === 'critical' ? '30 นาที' : '2 ชั่วโมง';

    return {
      handoffId: params.roomId,
      estimatedTime,
    };
  }

  /** เช็คว่า room อยู่ใน handoff mode หรือไม่ — bot จะหยุดตอบ */
  async isInHandoffMode(roomId: string): Promise<boolean> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { handoffMode: true },
    });
    return room?.handoffMode ?? false;
  }
}
