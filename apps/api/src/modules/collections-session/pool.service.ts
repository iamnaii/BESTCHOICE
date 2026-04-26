import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const SELF_CLAIM_LOCK_HOURS = 2;

@Injectable()
export class PoolService {
  constructor(private prisma: PrismaService) {}

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
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SELF_CLAIM_LOCK_HOURS * 60 * 60 * 1000);

    const row = await this.prisma.dailyAssignment.findFirst({
      where: { id: assignmentId, collectorId: null, status: 'PENDING', deletedAt: null },
    });
    if (!row) {
      throw new ConflictException('สัญญานี้ถูกหยิบไปแล้วหรือไม่อยู่ใน pool');
    }

    return this.prisma.dailyAssignment.update({
      where: { id: assignmentId },
      data: {
        collectorId: userId,
        source: 'SELF_CLAIMED',
        lockedAt: now,
        lockExpiresAt: expiresAt,
      },
    });
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
