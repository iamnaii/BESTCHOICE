import { hasCompanyAccess } from '@installment/shared';
import { dbTimeRange, finalizeSource, scanTake, type JourneySource } from './journey-window';
const titles: Record<string, string> = {
  BOOKED: 'นัดเข้าร้าน',
  RESCHEDULED: 'เลื่อนนัดเข้าร้าน',
  REASSIGNED: 'เปลี่ยนพนักงานรับนัด',
  CHECKED_IN: 'ลูกค้ามาถึงร้าน',
  IN_SERVICE: 'เริ่มให้บริการ',
  COMPLETED: 'นัดเข้าร้านเสร็จสิ้น',
  CANCELED: 'ยกเลิกนัดเข้าร้าน',
  NO_SHOW: 'ไม่มาตามนัด',
};
/** Read each immutable event once by customer, independent of source/linked room count. */
export const storeAppointmentSource: JourneySource = async (db, customerIds, window, actor) => {
  const user = await db.user.findFirst({
    where: { id: actor.id, isActive: true, deletedAt: null },
  });
  if (
    !user ||
    !['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user.role) ||
    !hasCompanyAccess(user.role, user.accessibleCompanies, 'SHOP') ||
    (user.role !== 'OWNER' && !user.branchId)
  )
    return [];
  const rows = await db.storeAppointmentEvent.findMany({
    where: {
      createdAt: dbTimeRange(window),
      appointment: {
        customerId: { in: customerIds },
        deletedAt: null,
        ...(user.role !== 'OWNER' ? { branchId: user.branchId! } : {}),
        branch: { deletedAt: null, company: { companyCode: 'SHOP' } },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: scanTake(window),
    select: { id: true, kind: true, createdAt: true, appointmentId: true, actorType: true },
  });
  return finalizeSource(
    rows.map((row) => ({
      id: `store-appointment-${row.id}`,
      type: `STORE_APPOINTMENT_${row.kind}`,
      group: 'chat',
      stage: null,
      timestamp: row.createdAt.toISOString(),
      title: titles[row.kind] || 'อัปเดตนัดเข้าร้าน',
      actor: { type: row.actorType === 'CUSTOMER_LINK' ? 'CUSTOMER' : 'STAFF' },
      reliability: 'exact',
      origin: 'SOURCE',
      href: `/appointments?appointmentId=${row.appointmentId}`,
    })),
    window,
  );
};
