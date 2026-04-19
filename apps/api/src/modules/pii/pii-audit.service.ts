import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface LogDecryptionInput {
  userId: string;
  customerId: string;
  fields: string[];
  role: string;
  masked: boolean;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class PiiAuditService {
  private readonly logger = new Logger(PiiAuditService.name);

  constructor(private prisma: PrismaService) {}

  async logDecryption(input: LogDecryptionInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: input.userId,
          action: input.masked ? 'PII_DECRYPT_MASKED' : 'PII_DECRYPT_FULL',
          entity: 'customer',
          entityId: input.customerId,
          newValue: { fields: input.fields, role: input.role },
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });
    } catch (err) {
      // Never let audit failure block PII access — audit is best-effort
      this.logger.error(`PII audit log failed: ${(err as Error).message}`);
    }
  }
}
