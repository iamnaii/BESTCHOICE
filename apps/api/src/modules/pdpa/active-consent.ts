import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * "ลูกค้ามีความยินยอม PDPA ที่ยังมีผล" — **นิยามเดียว** (Task 34 ข้อ 3): แถว `pdpa_consents` สถานะ GRANTED ที่ไม่ถูกลบ ทุกวัตถุประสงค์
 * (ยินยอมตอนทำสัญญา `PDPAService.recordConsent` · ยินยอมตอนผูก LINE การเงิน `recordLineFinanceConsentInTx` — #1763)
 *
 * ผู้อ่าน: `PDPAService.hasActiveConsent` (→ ด่าน `ComplianceService.canSend` ของทุก `dispatch.send` หมวด REMINDER/DUNNING/MARKETING ·
 * แจ้งสถานะ A3 · Flex ใบเสร็จ) และ `ensurePdpaConsentOrLogSkip` (ผู้ส่งตรงที่ไม่ผ่าน `canSend`: A1 · A2 · การ์ดลิงก์ชำระ A6 · บอทเตือน/ทวง ·
 * ทาง Flex ของแม่แบบขั้นทวง `dunning.*`) —
 * ห้ามเขียนเงื่อนไขชุดที่สอง
 */
export const ACTIVE_PDPA_CONSENT_WHERE = {
  status: 'GRANTED',
  deletedAt: null,
} satisfies Prisma.PDPAConsentWhereInput;

export async function hasActivePdpaConsent(
  prisma: Pick<PrismaService, 'pDPAConsent'>,
  customerId: string,
): Promise<boolean> {
  const consent = await prisma.pDPAConsent.findFirst({
    where: { customerId, ...ACTIVE_PDPA_CONSENT_WHERE },
    select: { id: true },
  });
  return consent !== null;
}
