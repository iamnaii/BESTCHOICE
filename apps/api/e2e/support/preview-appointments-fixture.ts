import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AppointmentScheduleService } from '../../src/modules/store-appointments/appointment-schedule.service';
import { bangkokDay, DAY_MS } from '../../src/modules/store-appointments/appointment-policy';
export async function seedAppointmentPreview(db: PrismaService, ownerId: string) {
  const company = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  let branch = await db.branch.findFirst({
    where: { name: 'สาขาตัวอย่างนัดหมาย', deletedAt: null },
  });
  branch ??= await db.branch.create({
    data: {
      name: 'สาขาตัวอย่างนัดหมาย',
      companyId: company.id,
      location: 'กรุงเทพมหานคร — ข้อมูลจำลอง',
      phone: '020000000',
    },
  });
  const staff = await db.user.upsert({
    where: { email: 'appointment-preview@example.invalid' },
    update: { branchId: branch.id, isActive: true },
    create: {
      name: 'พนักงานรับนัดตัวอย่าง',
      email: 'appointment-preview@example.invalid',
      password: 'unused',
      role: 'SALES',
      branchId: branch.id,
      accessibleCompanies: ['SHOP'],
    },
  });
  const schedule = new AppointmentScheduleService(db);
  for (let offset = 0; offset < 14; offset++) {
    const day = bangkokDay(new Date(Date.now() + offset * DAY_MS));
    if (
      !(await db.staffAppointmentWindow.count({
        where: {
          branchId: branch.id,
          deletedAt: null,
          startsAt: new Date(`${day}T10:00:00+07:00`),
        },
      }))
    )
      await schedule.save(
        {
          branchId: branch.id,
          staffUserId: staff.id,
          startsAt: `${day}T10:00:00+07:00`,
          endsAt: `${day}T18:00:00+07:00`,
        },
        { staffId: ownerId },
      );
    const finalStartsAt = new Date(`${day}T18:30:00+07:00`);
    const finalEndsAt = new Date(`${day}T19:15:00+07:00`);
    if (
      !(await db.staffAppointmentWindow.count({
        where: {
          staffUserId: staff.id,
          deletedAt: null,
          startsAt: { lt: finalEndsAt },
          endsAt: { gt: finalStartsAt },
        },
      }))
    )
      await schedule.save(
        {
          branchId: branch.id,
          staffUserId: staff.id,
          startsAt: finalStartsAt.toISOString(),
          endsAt: finalEndsAt.toISOString(),
        },
        { staffId: ownerId },
      );
  }
  const customers = [];
  for (let i = 1; i <= 3; i++) {
    let customer = await db.customer.findFirst({
      where: { name: `ลูกค้านัดหมายตัวอย่าง ${i}`, deletedAt: null },
    });
    if (!customer) {
      customer = await db.customer.create({
        data: {
          name: `ลูกค้านัดหมายตัวอย่าง ${i}`,
          phone: `080000000${i}`,
          nationalId: randomUUID(),
          addressCurrent: 'ข้อมูลจำลอง',
        },
      });
      await db.creditCheck.create({ data: { customerId: customer.id, status: 'APPROVED' } });
    }
    customers.push({ id: customer.id, name: customer.name });
  }
  return { branchId: branch.id, staffId: staff.id, customers };
}
