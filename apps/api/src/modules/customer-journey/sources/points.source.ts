import type { JourneyEvent } from '@installment/shared';
import { bahtText, dbTimeRange, finalizeSource, scanTake, type JourneySource } from './journey-window';

const POINT_REASONS: Record<string, string> = { ON_TIME_PAYMENT: 'จ่ายตรงเวลา' };

/** ไม่คัด reason ของการแลกแต้ม (ข้อความอิสระ) */
export const pointsSource: JourneySource = async (prisma, customerIds, window) => {
  const where = { customerId: { in: customerIds }, deletedAt: null, createdAt: dbTimeRange(window) };
  const orderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
  const take = scanTake(window);
  const [points, redemptions] = await Promise.all([
    prisma.loyaltyPoint.findMany({ where, select: { id: true, points: true, reason: true, createdAt: true, contract: { select: { contractNumber: true } } }, orderBy, take }),
    prisma.loyaltyRedemption.findMany({ where, select: { id: true, points: true, discountAmount: true, createdAt: true }, orderBy, take }),
  ]);
  const common = { group: 'points', stage: null, reliability: 'exact', origin: 'SOURCE' } as const;
  const events: JourneyEvent[] = [
    ...points.map((p): JourneyEvent => ({ ...common, id: `points-${p.id}`, type: 'LOYALTY_POINTS', timestamp: p.createdAt.toISOString(), title: `ได้แต้ม ${p.points} แต้ม${POINT_REASONS[p.reason] ? ` (${POINT_REASONS[p.reason]} · ${p.contract.contractNumber})` : ''}`, actor: { type: 'SYSTEM' } })),
    ...redemptions.map((r): JourneyEvent => ({ ...common, id: `redeem-${r.id}`, type: 'LOYALTY_REDEEMED', timestamp: r.createdAt.toISOString(), title: `แลกแต้ม ${r.points} แต้ม เป็นส่วนลด ${bahtText(r.discountAmount)} บาท`, actor: { type: 'STAFF' } })),
  ];
  return finalizeSource(events, window);
};
