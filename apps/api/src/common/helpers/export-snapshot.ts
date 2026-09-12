import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const EXPORT_ROW_LIMIT = 10_000;

export function assertExportRowCount(count: number) {
  if (count > EXPORT_ROW_LIMIT) throw new BadRequestException('ส่งออกได้ครั้งละไม่เกิน 10,000 รายการ กรุณาจำกัดช่วงวันที่หรือคำค้นแล้วลองใหม่ (ระดับลูกค้าจะคำนวณหลังจำกัดรายการ)');
}

/** The timestamp, rows, totals and derived history all share one database snapshot. */
export async function readExportSnapshot<T>(
  prisma: PrismaService,
  read: (tx: Prisma.TransactionClient, asOf: Date) => Promise<{ data: T[]; total: number }>,
) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [clock] = await tx.$queryRaw<Array<{ asOf: Date }>>`SELECT transaction_timestamp() AS "asOf"`;
    const result = await read(tx, clock.asOf);
    assertExportRowCount(result.total);
    if (result.data.length !== result.total) throw new BadRequestException('ข้อมูลส่งออกไม่ครบ กรุณาลองใหม่');
    return { data: result.data, total: result.total, asOf: clock.asOf.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 60_000 });
}
