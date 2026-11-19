import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * อัตราดอกเบี้ยรวมทั้งสัญญาของ (ตั้งค่าดอกเบี้ย, จำนวนงวด) — ค่าที่ใช้เป็น `ยอดจัด × อัตรา = ดอกเบี้ย`
 *
 * กติกาเดียวกับ `toBcConfig` (`bc-installment-config.util.ts`) ที่หน้าราคา / การ์ดคำนวณ / บอทใช้
 * เพื่อให้ค่างวดในสัญญาเท่ากับค่างวดที่บอกลูกค้า (สเปค 2026-11-19 ข้อ 4.2):
 *  - ตั้งค่าดอกเบี้ยมีแถวรายงวดที่ยังไม่ถูกลบอย่างน้อย 1 แถว → ใช้แถวของงวดนั้น · ไม่มีแถวของงวดนั้น = ปฏิเสธ
 *  - ไม่มีแถวรายงวดเลย → ดอกเบี้ยต่อเดือน (`InterestConfig.interestRate`) × งวด
 *
 * เดิมเลือกทางด้วย env `USE_NEW_RATE_LOOKUP` — เลิกอ่านแล้ว
 */
export async function getRateForMonths(
  prisma: Pick<Prisma.TransactionClient, 'interestConfig' | 'interestConfigRate'>,
  configId: string,
  months: number,
): Promise<Prisma.Decimal> {
  const rows = await prisma.interestConfigRate.findMany({
    where: { configId, deletedAt: null },
    select: { months: true, ratePct: true },
    orderBy: { months: 'asc' },
  });

  if (rows.length > 0) {
    const row = rows.find((r) => r.months === months);
    if (!row) {
      throw new BadRequestException(
        `ไม่มีอัตราดอกเบี้ยสำหรับ ${months} งวด — เลือกได้: ${rows.map((r) => r.months).join(', ')} งวด`,
      );
    }
    return new Prisma.Decimal(row.ratePct);
  }

  const config = await prisma.interestConfig.findUnique({ where: { id: configId } });
  if (!config || config.deletedAt) {
    throw new NotFoundException(`ไม่พบ InterestConfig (configId=${configId})`);
  }
  return new Prisma.Decimal(config.interestRate).mul(months);
}
