import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async log(entry: AuditEntry) {
    try {
      await this.prisma.systemConfig.create({
        data: {
          key: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          value: JSON.stringify({
            ...entry,
            timestamp: new Date().toISOString(),
          }),
        },
      });
    } catch (err) {
      this.logger.error('Failed to write audit log', err);
    }
  }

  async getAuditLogs(filters: {
    userId?: string;
    entity?: string;
    action?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 50;

    const logs = await this.prisma.systemConfig.findMany({
      where: {
        key: { startsWith: 'audit_' },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const parsed = logs
      .map((l) => {
        try {
          const data = JSON.parse(l.value);
          return { id: l.id, ...data };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((log) => {
        if (filters.userId && log.userId !== filters.userId) return false;
        if (filters.entity && log.entity !== filters.entity) return false;
        if (filters.action && log.action !== filters.action) return false;
        if (filters.from && log.timestamp < filters.from) return false;
        if (filters.to && log.timestamp > filters.to) return false;
        return true;
      });

    return { data: parsed, page, limit };
  }
}
