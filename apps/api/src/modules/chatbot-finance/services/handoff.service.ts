import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export type HandoffPriority = 'low' | 'normal' | 'high' | 'critical';

export interface HandoffParams {
  sessionId: string;
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

  constructor(private prisma: PrismaService) {}

  async handoff(params: HandoffParams): Promise<{ handoffId: string; estimatedTime: string }> {
    await this.prisma.chatSession.update({
      where: { id: params.sessionId },
      data: {
        handoffMode: true,
        handoffReason: params.reason,
        handoffTaggedAt: new Date(),
      },
    });

    this.logger.warn(
      `🚨 [Handoff] sessionId=${params.sessionId} priority=${params.priority} reason="${params.reason}"`,
    );
    this.logger.log(`   Summary: ${params.summary}`);
    if (params.tags?.length) {
      this.logger.log(`   Tags: ${params.tags.join(', ')}`);
    }

    // TODO Phase A3: notify Staff LINE Group/OA
    // - findOnDutyStaff(role=FINANCE_MANAGER)
    // - lineStaffClient.pushFlexMessage(handoffCard)

    const estimatedTime = params.priority === 'critical' ? '30 นาที' : '2 ชั่วโมง';

    return {
      handoffId: params.sessionId,
      estimatedTime,
    };
  }

  /** เช็คว่า session อยู่ใน handoff mode หรือไม่ — bot จะหยุดตอบ */
  async isInHandoffMode(sessionId: string): Promise<boolean> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { handoffMode: true },
    });
    return session?.handoffMode ?? false;
  }
}
