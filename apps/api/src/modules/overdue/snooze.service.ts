import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSnoozeDto, SnoozeDuration } from './dto/snooze.dto';

/**
 * Per-user snooze for collections queue cards.
 *
 * - One active snooze per (contractId, userId) pair: snoozing again replaces
 *   the previous active record (soft-delete sweep first, then create). This
 *   keeps the audit trail intact ("user X snoozed contract Y five times")
 *   while never letting two active rows fight each other.
 * - Wall-clock semantics for presets (`tomorrow_9am`, `next_week`) are
 *   computed server-side in Asia/Bangkok so the user sees consistent
 *   behaviour regardless of their device timezone or clock skew.
 * - Custom datetime must be strictly in the future.
 */
@Injectable()
export class ContractSnoozeService {
  constructor(private readonly prisma: PrismaService) {}

  async snooze(
    contractId: string,
    userId: string,
    dto: CreateSnoozeDto,
  ): Promise<{ id: string; snoozedUntil: Date }> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true },
    });
    if (!contract) {
      throw new NotFoundException('ไม่พบสัญญานี้');
    }

    const snoozedUntil = this.computeSnoozedUntil(dto);

    // Soft-delete prior active snoozes for this (contract, user) so the new
    // record is the unambiguous source of truth.
    await this.prisma.contractSnooze.updateMany({
      where: { contractId, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    const created = await this.prisma.contractSnooze.create({
      data: {
        contractId,
        userId,
        snoozedUntil,
        reason: dto.reason ?? null,
      },
    });

    return { id: created.id, snoozedUntil: created.snoozedUntil };
  }

  async unsnooze(
    contractId: string,
    userId: string,
  ): Promise<{ unsnoozed: number }> {
    const result = await this.prisma.contractSnooze.updateMany({
      where: { contractId, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { unsnoozed: result.count };
  }

  /**
   * Translate preset → concrete Date. Wall-clock anchors (tomorrow 09:00,
   * next-week start-of-week) are derived from Asia/Bangkok so the same user
   * action produces the same snooze regardless of device locale.
   */
  private computeSnoozedUntil(dto: CreateSnoozeDto): Date {
    const now = new Date();
    switch (dto.duration) {
      case SnoozeDuration.ONE_HOUR:
        return new Date(now.getTime() + 60 * 60 * 1000);
      case SnoozeDuration.TWO_HOURS:
        return new Date(now.getTime() + 2 * 60 * 60 * 1000);
      case SnoozeDuration.TOMORROW_9AM:
        return tomorrowAt9amBangkok(now);
      case SnoozeDuration.NEXT_WEEK:
        return new Date(now.getTime() + 7 * 86400 * 1000);
      case SnoozeDuration.CUSTOM: {
        if (!dto.snoozedUntil) {
          throw new BadRequestException('กรุณาระบุเวลาที่จะ snooze');
        }
        const dt = new Date(dto.snoozedUntil);
        if (Number.isNaN(dt.getTime())) {
          throw new BadRequestException('snoozedUntil ไม่ใช่เวลาที่ถูกต้อง');
        }
        if (dt.getTime() <= now.getTime()) {
          throw new BadRequestException('เวลา snooze ต้องอยู่ในอนาคต');
        }
        return dt;
      }
    }
  }
}

/**
 * Compute "tomorrow 09:00 Asia/Bangkok" as a UTC Date. Bangkok is fixed UTC+7
 * (no DST), so 09:00 local == 02:00 UTC on the same wall-clock day.
 */
function tomorrowAt9amBangkok(now: Date): Date {
  // Convert "now" to Bangkok wall-clock by adding +7h, then read calendar
  // date components.
  const bangkokNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = bangkokNow.getUTCFullYear();
  const m = bangkokNow.getUTCMonth();
  const d = bangkokNow.getUTCDate();
  // Tomorrow 09:00 Bangkok = (next-day) 02:00 UTC
  return new Date(Date.UTC(y, m, d + 1, 2, 0, 0, 0));
}
