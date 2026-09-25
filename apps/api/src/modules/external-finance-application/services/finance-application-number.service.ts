import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hashLockKey } from '../../../utils/advisory-lock.util';

/** BC-YYMMDD-NNN — วันตาม Asia/Bangkok, ลำดับต่อวัน, ใบที่ยกเลิก/ลบยังถือเลข (ห้ามกรอง deletedAt) */
@Injectable()
export class FinanceApplicationNumberService {
  static yymmddBangkok(at = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}${get('month')}${get('day')}`;
  }

  async next(tx: Prisma.TransactionClient, at = new Date()): Promise<string> {
    const day = FinanceApplicationNumberService.yymmddBangkok(at);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${hashLockKey(`finance-app:${day}`)})`);
    const last = await tx.externalFinanceApplication.findFirst({
      where: { number: { startsWith: `BC-${day}-` } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const seq = last ? Number(last.number.split('-')[2]) + 1 : 1;
    return `BC-${day}-${String(seq).padStart(3, '0')}`;
  }
}
