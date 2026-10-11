import { AppointmentConfirmationService } from '../src/modules/store-appointments/appointment-confirmation.service';
import { MessageRouterService } from '../src/modules/chat-engine/services/message-router.service';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppointmentPublicController } from '../src/modules/store-appointments/appointment-links.controller';
import { storeAppointmentSource } from '../src/modules/customer-journey/sources/store-appointment.source';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { StoreAppointmentsService } from '../src/modules/store-appointments/store-appointments.service';
import { AppointmentScheduleService } from '../src/modules/store-appointments/appointment-schedule.service';
import {
  bangkokDay,
  dayBounds,
  DAY_MS,
} from '../src/modules/store-appointments/appointment-policy';

const db = new PrismaService();
const appointments = new StoreAppointmentsService(db);
import { AppointmentLinksService } from '../src/modules/store-appointments/appointment-links.service';
const links = new AppointmentLinksService(db, appointments);
const schedule = new AppointmentScheduleService(db);
let ownerId: string, branchId: string, secondBranchId: string;
const day = bangkokDay(new Date(Date.now() + 2 * DAY_MS));
const time = (hour: number, minute = 0) =>
  new Date(dayBounds(day)[0].getTime() + (hour * 60 + minute) * 60_000).toISOString();
const actor = () => ({ staffId: ownerId });
const requestId = () => randomUUID();
async function customer(status: 'APPROVED' | 'REJECTED' = 'APPROVED') {
  const row = await db.customer.create({
    data: {
      name: 'TEST-appointment',
      phone: '0800000000',
      nationalId: randomUUID(),
      addressCurrent: 'ข้อมูลทดสอบระบบ — ลบได้',
    },
  });
  const check = await db.creditCheck.create({ data: { customerId: row.id, status } });
  return { ...row, check };
}
async function employee() {
  return db.user.create({
    data: {
      name: 'TEST-appointment staff',
      email: `${randomUUID()}@example.invalid`,
      password: 'unused',
      role: 'SALES',
      branchId,
    },
  });
}
async function window(staffId: string, start = 10, end = 13) {
  return schedule.save(
    { branchId, staffUserId: staffId, startsAt: time(start), endsAt: time(end) },
    actor(),
  );
}
async function book(customerId: string, startsAt = time(10)) {
  return appointments.create({ customerId, branchId, startsAt, requestId: requestId() }, actor());
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes('/bc_appointments_test?host=/tmp/bc-appointments.'))
    throw new Error('Isolated DB required');
  await db.$connect();
  const company = await db.companyInfo.upsert({
    where: { companyCode: 'SHOP' },
    update: {},
    create: {
      companyCode: 'SHOP',
      nameTh: 'TEST SHOP',
      taxId: '9999999999996',
      address: 'TEST',
      directorName: 'TEST',
    },
  });
  branchId = (
    await db.branch.create({ data: { name: 'TEST Appointment A', companyId: company.id } })
  ).id;
  secondBranchId = (
    await db.branch.create({ data: { name: 'TEST Appointment B', companyId: company.id } })
  ).id;
  ownerId = (
    await db.user.create({
      data: {
        name: 'TEST OWNER',
        email: `${randomUUID()}@example.invalid`,
        password: 'unused',
        role: 'OWNER',
      },
    })
  ).id;
}, 120_000);
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await db.storeAppointment.updateMany({ data: { status: 'CANCELED' } });
  await db.staffAppointmentWindow.updateMany({ data: { deletedAt: new Date() } });
});

describe('store appointments on isolated PostgreSQL', () => {
  it('counts the full calendar beyond 200 rows, distinct customers and Bangkok boundaries, with paginated details', async () => {
    const c = await customer(),
      second = await customer(),
      staff = await employee();
    const w = await window(staff.id);
    const month = day.slice(0, 7);
    const first = dayBounds(`${month}-01`)[0];
    const startsAt = new Date(first.getTime() + 10 * 3600000);
    const base = {
      customerId: c.id,
      branchId,
      staffUserId: staff.id,
      windowId: w.id,
      creditCheckId: c.check.id,
      creditCheckTypeAtBooking: 'FULL',
      source: 'STAFF',
      startsAt,
      endsAt: new Date(+startsAt + 45 * 60000),
    };
    const prefix = randomUUID();
    await db.storeAppointment.createMany({
      data: [
        ...Array.from({ length: 205 }, (_, i) => ({
          ...base,
          reference: `${prefix}-${i}`,
          status: 'COMPLETED' as const,
        })),
        { ...base, customerId: second.id, reference: `${prefix}-second`, status: 'BOOKED' },
        { ...base, reference: `${prefix}-canceled`, status: 'CANCELED' },
        { ...base, reference: `${prefix}-absent`, status: 'NO_SHOW' },
        {
          ...base,
          reference: `${prefix}-previous`,
          startsAt: new Date(+first - 1),
          endsAt: new Date(+first - 1 + 45 * 60000),
          status: 'COMPLETED',
        },
        {
          ...base,
          reference: `${prefix}-midnight`,
          startsAt: first,
          endsAt: new Date(+first + 45 * 60000),
          status: 'COMPLETED',
        },
        { ...base, branchId: secondBranchId, reference: `${prefix}-branch`, status: 'COMPLETED' },
        { ...base, reference: `${prefix}-deleted`, status: 'COMPLETED', deletedAt: new Date() },
      ],
    });
    const result = await appointments.calendar(branchId, month, actor());
    expect(result.customers).toBe(2);
    expect(result.appointments).toBe(207);
    expect(result.days.find((d) => d.day === `${month}-01`)).toMatchObject({
      customers: 2,
      appointments: 207,
      completed: 206,
      booked: 1,
      noShow: 1,
    });
    const firstPage = await appointments.calendarDay(branchId, `${month}-01`, 1, actor());
    const secondPage = await appointments.calendarDay(branchId, `${month}-01`, 2, actor());
    expect(firstPage.rows).toHaveLength(50);
    expect(secondPage.rows).toHaveLength(50);
    expect(firstPage.total).toBeGreaterThanOrEqual(209);
    expect(firstPage.rows[0].startsAt).toEqual(first);
    expect(new Set([...firstPage.rows, ...secondPage.rows].map((r) => r.id)).size).toBe(100);
    expect((await appointments.calendar(secondBranchId, month, actor())).appointments).toBe(1);
  });
  it('guards calendar scope and rejects malformed dates and pagination', async () => {
    const sales = await employee();
    const scoped = { staffId: sales.id };
    await expect(appointments.calendar(secondBranchId, day.slice(0, 7), scoped)).rejects.toThrow();
    await expect(appointments.calendarDay(secondBranchId, day, 1, scoped)).rejects.toThrow();
    await expect(appointments.calendar(branchId, '2026-13', actor())).rejects.toThrow();
    await expect(appointments.calendarDay(branchId, '2026-02-30', 1, actor())).rejects.toThrow();
    await expect(appointments.calendarDay(branchId, day, 0, actor())).rejects.toThrow();
    await expect(appointments.calendarDay(branchId, day, 1.5, actor())).rejects.toThrow();
    await db.user.update({ where: { id: sales.id }, data: { accessibleCompanies: ['FINANCE'] } });
    await expect(appointments.calendar(branchId, day.slice(0, 7), scoped)).rejects.toThrow();
  });
  it('persists actual FULL decisions and does not resurrect approval after rejected then pending', async () => {
    const c = await customer();
    expect(c.check.checkType).toBe('FULL');
    expect((await appointments.eligibility(c.id, actor())).eligible).toBe(true);
    const newer = await db.creditCheck.create({ data: { customerId: c.id } });
    expect((await appointments.eligibility(c.id, actor())).eligible).toBe(true);
    await db.creditCheck.update({ where: { id: newer.id }, data: { status: 'REJECTED' } });
    await db.creditCheck.update({ where: { id: newer.id }, data: { status: 'PENDING' } });
    expect((await appointments.eligibility(c.id, actor())).eligible).toBe(false);
    expect(
      (await db.creditCheck.findUniqueOrThrow({ where: { id: newer.id } })).lastAppointmentDecision,
    ).toBe('REJECTED');
  });
  it('enforces the 18:30 cutoff for staff and public booking and rescheduling', async () => {
    await window((await employee()).id, 10, 21);
    const c = await customer();
    const issued = await links.issue({ customerId: c.id, branchIds: [branchId] }, actor());
    const publicActor = { linkId: issued.id };
    await expect(book(c.id, time(18, 31))).rejects.toThrow('18:30');
    await expect(
      appointments.create(
        { customerId: c.id, branchId, startsAt: time(19), requestId: requestId() },
        publicActor,
      ),
    ).rejects.toThrow('18:30');
    const booking = await appointments.create(
      { customerId: c.id, branchId, startsAt: time(18, 30), requestId: requestId() },
      publicActor,
    );
    expect(new Date(booking.endsAt).toISOString()).toBe(time(19, 15));
    for (const user of [actor(), publicActor])
      await expect(
        appointments.reschedule(
          booking.id,
          { branchId, startsAt: time(18, 31), version: booking.version, requestId: requestId() },
          user,
        ),
      ).rejects.toThrow('18:30');
    expect(
      (
        await db.storeAppointment.findUniqueOrThrow({ where: { id: booking.id } })
      ).startsAt.toISOString(),
    ).toBe(time(18, 30));
  });
  it('gives exactly three winners for four concurrent customers and three employees', async () => {
    for (let i = 0; i < 3; i++) await window((await employee()).id);
    const customers = await Promise.all([customer(), customer(), customer(), customer()]);
    const result = await Promise.allSettled(customers.map((c) => book(c.id)));
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(result.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await db.storeAppointment.count({ where: { status: 'BOOKED' } })).toBe(3);
  });
  it('replays successful create and prevents a second open appointment for the customer', async () => {
    await window((await employee()).id);
    await window((await employee()).id);
    const c = await customer();
    const dto = { customerId: c.id, branchId, startsAt: time(10), requestId: requestId() };
    const results = await Promise.all([
      appointments.create(dto, actor()),
      appointments.create(dto, actor()),
    ]);
    expect(results[0].id).toBe(results[1].id);
    await expect(book(c.id, time(11))).rejects.toThrow();
    expect(await db.storeAppointment.count({ where: { customerId: c.id } })).toBe(1);
  });
  it('rejects shifted overlap and preserves old booking when a reschedule fails', async () => {
    const staff = await employee();
    await window(staff.id);
    const c = await customer();
    const first = await book(c.id);
    const second = await book((await customer()).id, time(10, 45));
    await expect(
      appointments.reschedule(
        first.id,
        { branchId, startsAt: time(10, 45), version: first.version, requestId: requestId() },
        actor(),
      ),
    ).rejects.toThrow();
    expect(
      (
        await db.storeAppointment.findUniqueOrThrow({ where: { id: first.id } })
      ).startsAt.toISOString(),
    ).toBe(time(10));
    await expect(book((await customer()).id, time(10, 30))).rejects.toThrow();
    expect(second.staffUserId).toBe(staff.id);
  });
  it('blocks destructive schedule edits but permits disabling staff and exposes reassignment', async () => {
    const staff = await employee();
    const w = await window(staff.id);
    const a = await book((await customer()).id);
    await expect(schedule.remove(w.id, w.version, actor())).rejects.toThrow();
    await db.user.update({ where: { id: staff.id }, data: { isActive: false } });
    expect((await appointments.findOne(a.id, actor())).assignmentIssue).toBe(true);
    expect(await appointments.availability(branchId, day, actor())).toEqual([]);
    const replacement = await employee();
    await window(replacement.id);
    const updated = await appointments.reassign(
      a.id,
      { staffUserId: replacement.id, version: a.version, requestId: requestId() },
      actor(),
    );
    expect(updated.staffUserId).toBe(replacement.id);
    expect(updated.assignmentIssue).toBe(false);
  });
  it('denies foreign branches and FINANCE-only company grants', async () => {
    const sales = await employee();
    await expect(
      appointments.availability(secondBranchId, day, { staffId: sales.id }),
    ).rejects.toThrow();
    await db.user.update({ where: { id: sales.id }, data: { accessibleCompanies: ['FINANCE'] } });
    await expect(schedule.options({ staffId: sales.id })).rejects.toThrow();
  });
  it('validates lifecycle and optimistic version without losing the original booking', async () => {
    await window((await employee()).id);
    const a = await book((await customer()).id);
    await expect(
      appointments.transition(
        a.id,
        { status: 'NO_SHOW', version: a.version, requestId: requestId() },
        actor(),
      ),
    ).rejects.toThrow();
    const checked = await appointments.transition(
      a.id,
      { status: 'CHECKED_IN', version: a.version, requestId: requestId() },
      actor(),
    );
    await expect(
      appointments.transition(
        a.id,
        { status: 'IN_SERVICE', version: a.version, requestId: requestId() },
        actor(),
      ),
    ).rejects.toThrow();
    const started = await appointments.transition(
      a.id,
      { status: 'IN_SERVICE', version: checked.version, requestId: requestId() },
      actor(),
    );
    const done = await appointments.transition(
      a.id,
      { status: 'COMPLETED', version: started.version, requestId: requestId() },
      actor(),
    );
    expect(done.status).toBe('COMPLETED');
    expect(await db.storeAppointmentEvent.count({ where: { appointmentId: a.id } })).toBe(4);
  });
});

describe('private customer appointment links', () => {
  it('stores only a hash and permits bound management after create capability expires', async () => {
    await window((await employee()).id);
    const c = await customer();
    const issued = await links.issue({ customerId: c.id, branchIds: [branchId] }, actor());
    expect(
      (await db.storeAppointmentLink.findUniqueOrThrow({ where: { id: issued.id } })).tokenHash,
    ).not.toBe(issued.token);
    const publicActor = await links.resolve(issued.token);
    const a = await appointments.create(
      { customerId: c.id, branchId, startsAt: time(10), requestId: requestId() },
      publicActor,
    );
    await db.storeAppointmentLink.update({
      where: { id: issued.id },
      data: { bookingExpiresAt: new Date(Date.now() - 1000) },
    });
    const context = await links.context(issued.token);
    expect(context.canBook).toBe(false);
    expect(context.appointment?.id).toBe(a.id);
    expect(context.appointment).not.toHaveProperty('customerId');
    expect(context.appointment).not.toHaveProperty('staff');
    const moved = await appointments.reschedule(
      a.id,
      { branchId, startsAt: time(10, 45), version: a.version, requestId: requestId() },
      publicActor,
    );
    expect(moved.startsAt.toISOString()).toBe(time(10, 45));
    await links.revoke(issued.id, actor());
    await expect(links.context(issued.token)).rejects.toThrow();
  });
  it('denies unbound appointments, branch substitution and expired creation; issuer deactivation preserves customer access', async () => {
    await window((await employee()).id);
    const c = await customer();
    const a = await book(c.id);
    const issued = await links.issue({ customerId: c.id, branchIds: [branchId] }, actor());
    const publicActor = await links.resolve(issued.token);
    await expect(appointments.findOne(a.id, publicActor)).rejects.toThrow();
    await expect(appointments.availability(secondBranchId, day, publicActor)).rejects.toThrow();
    await db.user.update({ where: { id: ownerId }, data: { isActive: false } });
    try {
      expect((await links.context(issued.token)).canBook).toBe(true);
    } finally {
      await db.user.update({ where: { id: ownerId }, data: { isActive: true } });
    }
    await db.storeAppointmentLink.update({
      where: { id: issued.id },
      data: { bookingExpiresAt: new Date(0) },
    });
    await expect(links.context(issued.token)).rejects.toThrow();
  });
});

it('projects a booking without source room to every linked room, scopes staff and deduplicates journey', async () => {
  const employeeA = await employee();
  await window(employeeA.id);
  const c = await customer();
  const a = await book(c.id);
  const r1 = await db.chatRoom.create({
    data: { channel: 'FACEBOOK', externalUserId: requestId(), customerId: c.id },
  });
  const r2 = await db.chatRoom.create({
    data: { channel: 'FACEBOOK', externalUserId: requestId(), customerId: c.id },
  });
  const summary = await appointments.roomSummaries([r1.id, r2.id], actor());
  expect(summary[r1.id]?.id).toBe(a.id);
  expect(summary[r2.id]?.id).toBe(a.id);
  await db.chatRoom.update({ where: { id: r2.id }, data: { assignedToId: ownerId } });
  expect(
    (await appointments.roomSummaries([r1.id, r2.id], { staffId: employeeA.id }))[r2.id],
  ).toBeUndefined();
  await expect(
    appointments.list({ roomId: r2.id, customerId: c.id }, { staffId: employeeA.id }),
  ).rejects.toThrow();
  const events = await storeAppointmentSource(
    db,
    [c.id],
    { limit: 20 },
    { id: ownerId, role: 'OWNER' },
  );
  expect(events).toHaveLength(1);
  expect(events[0].href).toContain(a.id);
});

it('validates real public HTTP DTOs and returns only public fields without staff auth', async () => {
  const module = await Test.createTestingModule({
    controllers: [AppointmentPublicController],
    providers: [
      { provide: StoreAppointmentsService, useValue: appointments },
      { provide: AppointmentLinksService, useValue: links },
    ],
  }).compile();
  const app = module.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  try {
    await window((await employee()).id);
    const c = await customer();
    const issued = await links.issue({ customerId: c.id, branchIds: [branchId] }, actor());
    await request(app.getHttpServer()).get('/store-appointments-public/context').expect(410);
    await request(app.getHttpServer())
      .post('/store-appointments-public/book')
      .set('x-appointment-token', issued.token)
      .send({ branchId, startsAt: 'wrong', requestId: requestId() })
      .expect(400);
    const result = await request(app.getHttpServer())
      .post('/store-appointments-public/book')
      .set('x-appointment-token', issued.token)
      .send({ branchId, startsAt: time(10), requestId: requestId() })
      .expect(201);
    expect(result.body.status).toBe('BOOKED');
    expect(result.body).not.toHaveProperty('customer');
    expect(result.body).not.toHaveProperty('creditCheckId');
    expect(result.headers['cache-control']).toBe('no-store');
  } finally {
    await app.close();
  }
});

it('serializes mixed staff/public claims and a simultaneous staff disable', async () => {
  const staff = await employee();
  await window(staff.id);
  const c1 = await customer(),
    c2 = await customer();
  const link = await links.issue({ customerId: c2.id, branchIds: [branchId] }, actor());
  const result = await Promise.allSettled([
    book(c1.id),
    appointments.create(
      { customerId: c2.id, branchId, startsAt: time(10), requestId: requestId() },
      await links.resolve(link.token),
    ),
  ]);
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const winner = result.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
    Awaited<ReturnType<typeof book>>
  >;
  const c3 = await customer();
  const race = await Promise.allSettled([
    book(c3.id, time(10, 45)),
    db.user.update({ where: { id: staff.id }, data: { isActive: false } }),
  ]);
  expect(race[1].status).toBe('fulfilled');
  expect((await appointments.findOne(winner.value.id, actor())).assignmentIssue).toBe(true);
  if (race[0].status === 'fulfilled')
    expect((await appointments.findOne(race[0].value.id, actor())).assignmentIssue).toBe(true);
  expect(await appointments.availability(branchId, day, actor())).toEqual([]);
});
it('copies the entire day atomically and rolls back all rows on a destination conflict', async () => {
  const a = await employee(),
    b = await employee();
  await window(a.id);
  await window(b.id);
  const target = bangkokDay(new Date(+new Date(time(10)) + DAY_MS));
  await schedule.save(
    {
      branchId,
      staffUserId: b.id,
      startsAt: `${target}T10:00:00+07:00`,
      endsAt: `${target}T13:00:00+07:00`,
    },
    actor(),
  );
  await expect(schedule.copyDay(branchId, day, target, actor())).rejects.toThrow();
  expect(await schedule.list(branchId, target, actor())).toHaveLength(1);
  const another = bangkokDay(new Date(+new Date(time(10)) + 2 * DAY_MS));
  expect(await schedule.copyDay(branchId, day, another, actor())).toEqual({ count: 2 });
});

it('allows reassigning a future slot to an employee serving an unrelated time today', async () => {
  const a = await employee(),
    b = await employee();
  await window(a.id);
  await window(b.id);
  const current = await book((await customer()).id);
  await db.storeAppointment.update({
    where: { id: current.id },
    data: {
      staffUserId: b.id,
      startsAt: new Date(Date.now() - 60000),
      endsAt: new Date(Date.now() + 44 * 60000),
      status: 'IN_SERVICE',
    },
  });
  const future = await book((await customer()).id, time(10, 45));
  expect(
    (
      await appointments.reassign(
        future.id,
        { staffUserId: b.id, version: future.version, requestId: requestId() },
        actor(),
      )
    ).staffUserId,
  ).toBe(b.id);
});
it('permits the appointment capability header through production CORS preflight', async () => {
  const { configureApp } = await import('../src/app.setup');
  const module = await Test.createTestingModule({}).compile();
  const app = module.createNestApplication();
  configureApp(app, { swagger: false });
  await app.init();
  try {
    const response = await request(app.getHttpServer())
      .options('/api/store-appointments-public/context')
      .set('Origin', 'https://bestchoicephone.app')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'x-appointment-token')
      .expect(204);
    expect(response.headers['access-control-allow-headers'].toLowerCase()).toContain(
      'x-appointment-token',
    );
  } finally {
    await app.close();
  }
});
it('lists prior capabilities without tokens so staff can revoke them after returning', async () => {
  const c = await customer();
  const issued = await links.issue({ customerId: c.id, branchIds: [branchId] }, actor());
  const rows = await links.list(c.id, actor());
  expect(rows.map((r) => r.id)).toContain(issued.id);
  expect(rows[0]).not.toHaveProperty('tokenHash');
  expect(rows[0]).not.toHaveProperty('token');
  await links.revoke(rows[0].id, actor());
  await expect(links.resolve(issued.token)).rejects.toThrow();
});

it('enforces the public per-IP throttle using the deployed short bucket', async () => {
  const { ThrottlerModule, ThrottlerGuard } = await import('@nestjs/throttler');
  const { APP_GUARD } = await import('@nestjs/core');
  const module = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ name: 'short', ttl: 1000, limit: 200 }])],
    controllers: [AppointmentPublicController],
    providers: [
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: StoreAppointmentsService, useValue: appointments },
      { provide: AppointmentLinksService, useValue: links },
    ],
  }).compile();
  const app = module.createNestApplication();
  await app.init();
  try {
    for (let i = 0; i < 40; i++)
      await request(app.getHttpServer()).get('/store-appointments-public/context').expect(410);
    await request(app.getHttpServer()).get('/store-appointments-public/context').expect(429);
  } finally {
    await app.close();
  }
});

describe('automatic appointment confirmations', () => {
  const sendMessage = jest.fn();
  const worker = new AppointmentConfirmationService(db, {
    getAdapter: () => ({ sendMessage }),
  } as unknown as MessageRouterService);
  async function setup(twoRooms = false) {
    await window((await employee()).id);
    const c = await customer();
    const room = await db.chatRoom.create({
      data: {
        customerId: c.id,
        channel: 'LINE_SHOP',
        externalUserId: requestId(),
        waitingSince: new Date(),
      },
    });
    if (twoRooms)
      await db.chatRoom.create({
        data: { customerId: c.id, channel: 'FACEBOOK', externalUserId: requestId() },
      });
    sendMessage.mockReset().mockResolvedValue({ success: true });
    return { c, room };
  }
  it('binds the originating room, queues once in the booking transaction and sends once across workers', async () => {
    const { c, room } = await setup(true);
    const link = await links.issue(
      { customerId: c.id, branchIds: [branchId], sourceRoomId: room.id },
      actor(),
    );
    const dto = { customerId: c.id, branchId, startsAt: time(10), requestId: requestId() };
    const publicActor = await links.resolve(link.token);
    const a = await appointments.create(dto, publicActor);
    await appointments.create(dto, publicActor);
    const jobs = await db.appointmentConfirmation.findMany({ where: { appointmentId: a.id } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].roomId).toBe(room.id);
    await Promise.all([worker.deliver(jobs[0].id), worker.deliver(jobs[0].id)]);
    await worker.deliver(jobs[0].id);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        externalUserId: room.externalUserId,
        text: expect.stringContaining('BESTCHOICE ยืนยันนัดหมาย'),
      }),
    );
    const result = await links.context(link.token);
    expect(result.appointment?.confirmation?.status).toBe('SENT');
    expect(result.appointment?.confirmation).not.toHaveProperty('recipientId');
    expect((await db.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).waitingSince).toEqual(
      room.waitingSince,
    );
    expect(
      await db.chatMessage.count({
        where: { roomId: room.id, intent: 'APPOINTMENT_CONFIRMATION' },
      }),
    ).toBe(1);
  });
  it('keeps the booking when delivery fails, retries only definitive failures and never resends an unknown outcome', async () => {
    const { c } = await setup();
    const a = await book(c.id);
    const id = a.confirmations[0].id;
    sendMessage.mockResolvedValueOnce({ success: false, definitelyNotSent: true });
    await worker.deliver(id);
    expect((await db.appointmentConfirmation.findUniqueOrThrow({ where: { id } })).status).toBe(
      'FAILED',
    );
    expect((await db.storeAppointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      'BOOKED',
    );
    await appointments.retryConfirmation(a.id, actor());
    sendMessage.mockRejectedValueOnce(new Error('connection lost'));
    await worker.deliver(id);
    expect((await db.appointmentConfirmation.findUniqueOrThrow({ where: { id } })).status).toBe(
      'UNKNOWN',
    );
    await expect(appointments.retryConfirmation(a.id, actor())).rejects.toThrow();
    await worker.deliver(id);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
  it('does not guess between rooms or send when the original room has been relinked', async () => {
    const { c, room } = await setup(true);
    const a = await book(c.id);
    expect(a.confirmations[0].status).toBe('NO_CHANNEL');
    const other = await customer();
    await expect(
      links.issue({ customerId: other.id, branchIds: [branchId], sourceRoomId: room.id }, actor()),
    ).rejects.toThrow();
    await appointments.transition(
      a.id,
      { status: 'CANCELED', version: a.version, requestId: requestId() },
      actor(),
    );
    const a2 = await appointments.create(
      {
        customerId: c.id,
        branchId,
        startsAt: time(10),
        sourceRoomId: room.id,
        requestId: requestId(),
      },
      actor(),
    );
    await db.chatRoom.update({ where: { id: room.id }, data: { customerId: other.id } });
    await worker.deliver(a2.confirmations[0].id);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(
      (
        await db.appointmentConfirmation.findUniqueOrThrow({
          where: { id: a2.confirmations[0].id },
        })
      ).status,
    ).toBe('NO_CHANNEL');
  });
  it('serializes different versions so a slow booking send cannot arrive after cancellation', async () => {
    const { c } = await setup();
    const a = await book(c.id);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    sendMessage.mockImplementationOnce(async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { success: true };
    });
    const inFlight = worker.deliver(a.confirmations[0].id);
    await started;
    const canceled = await appointments.transition(
      a.id,
      { status: 'CANCELED', version: a.version, requestId: requestId() },
      actor(),
    );
    await worker.deliver(canceled.confirmations[0].id);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(
      (
        await db.appointmentConfirmation.findUniqueOrThrow({
          where: { id: canceled.confirmations[0].id },
        })
      ).status,
    ).toBe('PENDING');
    release();
    await inFlight;
    await worker.deliver(canceled.confirmations[0].id);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1][0].text).toContain('ยืนยันยกเลิกนัดหมาย');
  });
  it('blocks later messages when an earlier delivery is uncertain, and never treats WEB as delivered', async () => {
    const { c, room } = await setup();
    const a = await book(c.id);
    sendMessage.mockRejectedValueOnce(new Error('lost ack'));
    await worker.deliver(a.confirmations[0].id);
    const moved = await appointments.reschedule(
      a.id,
      { branchId, startsAt: time(10, 45), version: a.version, requestId: requestId() },
      actor(),
    );
    await worker.deliver(moved.confirmations[0].id);
    expect(
      (
        await db.appointmentConfirmation.findUniqueOrThrow({
          where: { id: moved.confirmations[0].id },
        })
      ).status,
    ).toBe('BLOCKED');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await db.chatRoom.update({ where: { id: room.id }, data: { channel: 'WEB' } });
    const canceled = await appointments.transition(
      a.id,
      { status: 'CANCELED', version: moved.version, requestId: requestId() },
      actor(),
    );
    expect(canceled.confirmations[0].status).toBe('NO_CHANNEL');
    await worker.deliver(canceled.confirmations[0].id);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
  it('supersedes pending old details on reschedule and sends the new time then cancellation', async () => {
    const { c } = await setup();
    const a = await book(c.id);
    const moved = await appointments.reschedule(
      a.id,
      { branchId, startsAt: time(10, 45), version: a.version, requestId: requestId() },
      actor(),
    );
    await worker.deliver(a.confirmations[0].id);
    expect(sendMessage).not.toHaveBeenCalled();
    await worker.deliver(moved.confirmations[0].id);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('10:45–11:30') }),
    );
    const canceled = await appointments.transition(
      a.id,
      { status: 'CANCELED', version: moved.version, requestId: requestId() },
      actor(),
    );
    await worker.deliver(canceled.confirmations[0].id);
    expect(sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: expect.stringContaining('ยืนยันยกเลิกนัดหมาย') }),
    );
  });
});
