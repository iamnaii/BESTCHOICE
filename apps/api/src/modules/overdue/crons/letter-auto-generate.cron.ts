import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContractLetterService } from '../contract-letter.service';

@Injectable()
export class LetterAutoGenerateCron {
  private readonly logger = new Logger(LetterAutoGenerateCron.name);

  constructor(
    private prisma: PrismaService,
    private letterService: ContractLetterService,
  ) {}

  @Cron('15 9 * * *')
  async run(): Promise<{ returnDevice: number; termination: number }> {
    try {
      // Batch-fetch all 3 config keys in a single query (was 3 sequential findUnique calls).
      const configs = await this.prisma.systemConfig.findMany({
        where: {
          key: {
            in: [
              'letter_auto_generate_enabled',
              'letter_return_device_days',
              'letter_termination_days',
            ],
          },
        },
      });
      const configMap = new Map(configs.map((c) => [c.key, c.value]));

      if (configMap.get('letter_auto_generate_enabled') !== 'true') {
        this.logger.log('letter_auto_generate_enabled=false — skipping');
        return { returnDevice: 0, termination: 0 };
      }

      const returnDays = Number(configMap.get('letter_return_device_days') ?? 45);
      const terminationDays = Number(configMap.get('letter_termination_days') ?? 60);

      const now = new Date();
      const returnThreshold = new Date(now.getTime() - returnDays * 86400000);
      const terminationThreshold = new Date(now.getTime() - terminationDays * 86400000);

      const returnCandidates = await this.prisma.contract.findMany({
        where: {
          status: { in: ['OVERDUE', 'DEFAULT'] },
          deletedAt: null,
          payments: {
            some: {
              dueDate: { lt: returnThreshold },
              status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
            },
          },
          contractLetters: {
            none: { letterType: 'RETURN_DEVICE_45D', deletedAt: null },
          },
        },
        select: { id: true },
      });

      let returnDevice = 0;
      for (const { id } of returnCandidates) {
        try {
          await this.letterService.createIfNotExists(id, 'RETURN_DEVICE_45D');
          returnDevice++;
        } catch (err) {
          Sentry.captureException(err, {
            tags: { cron: 'letter-auto-generate', letterType: 'RETURN_DEVICE_45D' },
            extra: { contractId: id },
          });
        }
      }

      const terminationCandidates = await this.prisma.contract.findMany({
        where: {
          status: { in: ['OVERDUE', 'DEFAULT'] },
          deletedAt: null,
          payments: {
            some: {
              dueDate: { lt: terminationThreshold },
              status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
            },
          },
          contractLetters: {
            none: { letterType: 'CONTRACT_TERMINATION_60D', deletedAt: null },
          },
        },
        select: { id: true },
      });

      let termination = 0;
      for (const { id } of terminationCandidates) {
        try {
          await this.letterService.createIfNotExists(id, 'CONTRACT_TERMINATION_60D');
          termination++;
        } catch (err) {
          Sentry.captureException(err, {
            tags: { cron: 'letter-auto-generate', letterType: 'CONTRACT_TERMINATION_60D' },
            extra: { contractId: id },
          });
        }
      }

      this.logger.log(
        `Letter auto-generate: return_device=${returnDevice}, termination=${termination}`,
      );
      return { returnDevice, termination };
    } catch (err) {
      Sentry.captureException(err, { tags: { cron: 'letter-auto-generate' } });
      this.logger.error(
        `letter-auto-generate failed: ${err instanceof Error ? err.message : err}`,
      );
      return { returnDevice: 0, termination: 0 };
    }
  }
}
