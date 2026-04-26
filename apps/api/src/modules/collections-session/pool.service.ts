import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class PoolService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  async list(branchId?: string) {
    const today = startOfDay(new Date());
    return this.prisma.dailyAssignment.findMany({
      where: {
        date: today,
        collectorId: null,
        status: 'PENDING',
        deletedAt: null,
        ...(branchId ? { contract: { branchId } } : {}),
      },
      include: {
        contract: {
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            branch: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ escalationFlag: 'desc' }, { position: 'asc' }],
    });
  }

  async claim(assignmentId: string, userId: string) {
    const cfg = await this.settings.getCollectionsConfig();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + cfg.selfClaimLockHours * 60 * 60 * 1000);

    // Atomic claim: only updates if still unclaimed.
    // Two concurrent claims for the same id: one will hit count=1, the other count=0.
    const result = await this.prisma.dailyAssignment.updateMany({
      where: {
        id: assignmentId,
        collectorId: null,
        status: 'PENDING',
        deletedAt: null,
      },
      data: {
        collectorId: userId,
        source: 'SELF_CLAIMED',
        lockedAt: now,
        lockExpiresAt: expiresAt,
      },
    });

    if (result.count === 0) {
      throw new ConflictException('สัญญานี้ถูกหยิบไปแล้วหรือไม่อยู่ใน pool');
    }

    // Re-read to return the updated row (consumer may want full data).
    return this.prisma.dailyAssignment.findUnique({
      where: { id: assignmentId },
    });
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
