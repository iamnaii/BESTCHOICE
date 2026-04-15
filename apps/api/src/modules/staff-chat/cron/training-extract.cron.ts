import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class TrainingExtractCron {
  private readonly logger = new Logger(TrainingExtractCron.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 3 * * *', { timeZone: 'Asia/Bangkok' })
  async extractTrainingPairs(): Promise<{ created: number }> {
    this.logger.log('Starting daily training pair extraction');

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 1);

    const customerMessages = await this.prisma.chatMessage.findMany({
      where: {
        role: 'CUSTOMER',
        text: { not: null },
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: 'asc' },
    });

    let created = 0;
    for (const custMsg of customerMessages) {
      const fiveMinLater = new Date(custMsg.createdAt.getTime() + 5 * 60 * 1000);
      const staffReply = await this.prisma.chatMessage.findFirst({
        where: {
          sessionId: custMsg.sessionId,
          role: 'STAFF',
          text: { not: null },
          createdAt: { gt: custMsg.createdAt, lte: fiveMinLater },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (!staffReply?.text) continue;

      const exists = await this.prisma.aiTrainingPair.findFirst({
        where: {
          source: 'SYSTEM_EXTRACT',
          customerMessage: custMsg.text!,
          humanEdit: staffReply.text,
        },
      });
      if (exists) continue;

      await this.prisma.aiTrainingPair.create({
        data: {
          type: 'ACCEPT',
          source: 'SYSTEM_EXTRACT',
          sessionId: custMsg.sessionId,
          customerMessage: custMsg.text!,
          humanEdit: staffReply.text,
          quality: 0.6,
        },
      });
      created++;
    }

    this.logger.log(`Extracted ${created} training pairs`);
    return { created };
  }
}
