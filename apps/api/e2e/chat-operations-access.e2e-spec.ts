import { ChatWorkController } from '../src/modules/staff-chat/chat-work.controller';
import { ChatWorkQueryService } from '../src/modules/staff-chat/services/chat-work-query.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { ChatWorkActor } from '@installment/shared';
import { ChatWorkAccessService } from '../src/modules/staff-chat/services/chat-work-access.service';
import { StaffInboxService } from '../src/modules/staff-chat/services/staff-inbox.service';
import { StaffInboxController } from '../src/modules/staff-chat/staff-inbox.controller';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
  throw new Error('Run CREDIT_SUITE=chat-operations bash tools/test-chat-credit.sh');
}

describe('Scoped durable staff work inbox (real PostgreSQL)', () => {
  const db = new PrismaService();
  let app: INestApplication;
  let inbox: StaffInboxService;
  let access: ChatWorkAccessService;
  let actor: ChatWorkActor;
  let alice: ChatWorkActor;
  let bob: ChatWorkActor;
  let owner: ChatWorkActor;
  let roomA: string;
  let roomB: string;
  let itemA: string;
  let itemB: string;
  const scope = { company: 'SHOP' as const };
  beforeAll(async () => {
    await db.$connect();
    const branches = await Promise.all(
      [1, 2].map((n) => db.branch.create({ data: { name: `WORK TEST ${n}` } })),
    );
    const staff = await Promise.all(
      branches.map((branch) =>
        db.user.create({
          data: {
            name: 'Synthetic work staff',
            email: `${randomUUID()}@test.invalid`,
            password: 'unused',
            role: 'SALES',
            branchId: branch.id,
            accessibleCompanies: ['SHOP'],
          },
        }),
      ),
    );
    [alice, bob] = staff;
    owner = await db.user.create({
      data: {
        name: 'Synthetic owner',
        email: `${randomUUID()}@test.invalid`,
        password: 'unused',
        role: 'OWNER',
        accessibleCompanies: ['SHOP'],
      },
    });
    roomA = (await db.chatRoom.create({ data: { channel: 'FACEBOOK', assignedToId: alice.id } }))
      .id;
    roomB = (await db.chatRoom.create({ data: { channel: 'LINE_SHOP', assignedToId: bob.id } })).id;
    const module = await Test.createTestingModule({
      controllers: [StaffInboxController, ChatWorkController],
      providers: [
        ChatWorkAccessService, ChatWorkQueryService,
        StaffInboxService,
        { provide: PrismaService, useValue: db },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: { switchToHttp(): { getRequest(): { user: unknown } } }) => {
          context.switchToHttp().getRequest().user = actor;
          return true;
        },
      })
      .compile();
    inbox = module.get(StaffInboxService);
    access = module.get(ChatWorkAccessService);
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.listen(0, '127.0.0.1');
    for (const [person, room, key] of [
      [alice, roomA, 'a'],
      [bob, roomB, 'b'],
    ] as const) {
      const item = await db.$transaction((tx) =>
        inbox.enqueue(tx, {
          recipientId: person.id,
          kind: 'CHAT_SLA',
          roomId: room,
          dedupeKey: `test:${key}`,
          title: 'มีแชทรอตอบ',
          targetType: 'ROOM',
          targetId: room,
        }),
      );
      if (key === 'a') itemA = item!.id;
      else itemB = item!.id;
    }
  });
  beforeEach(() => {
    actor = alice;
  });
  afterAll(async () => {
    if (app) await app.close();
    await db.$disconnect();
  });
  const list = () =>
    request(app.getHttpServer()).get('/staff-chat/work-notifications?company=SHOP');

  it('returns only the current recipient and refuses another recipient read mutation', async () => {
    const response = await list().expect(200);
    expect(response.body.data.map((item: { id: string }) => item.id)).toEqual([itemA]);
    expect(response.body).toMatchObject({ total: 1, unreadCount: 1, page: 1, limit: 50 });
    await request(app.getHttpServer())
      .patch(`/staff-chat/work-notifications/${itemB}/read?company=SHOP`)
      .send({ recipientId: bob.id })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/staff-chat/work-notifications/${itemA}/read?company=SHOP`)
      .expect(200);
    expect((await list()).body.unreadCount).toBe(0);
  });
  it('accepts lowercase company scope sent by the shared browser client', async () => {
    await request(app.getHttpServer()).get('/staff-chat/work-notifications?company=shop').expect(200);
  });
  it('validates queue filters and rechecks exact deep-link access', async () => {
    await request(app.getHttpServer()).get('/staff-chat/work?company=shop&view=WAITING&limit=2').expect(200);
    await request(app.getHttpServer()).get('/staff-chat/work?company=shop&view=INVALID').expect(400);
    await request(app.getHttpServer()).get('/staff-chat/work?company=shop&limit=201').expect(400);
    await request(app.getHttpServer()).get(`/staff-chat/work-targets/ROOM/${roomB}?company=shop`).expect(404);
    await request(app.getHttpServer()).get(`/staff-chat/work-targets/ROOM/${roomA}?company=shop`).expect(200);
  });
  it('rechecks current grants despite a stale authenticated actor', async () => {
    await db.user.update({ where: { id: alice.id }, data: { accessibleCompanies: ['FINANCE'] } });
    await list().expect(403);
    await db.user.update({ where: { id: alice.id }, data: { accessibleCompanies: ['SHOP'] } });
  });
  it('hides both data and counts after room ownership moves outside access', async () => {
    await db.chatRoom.update({ where: { id: roomA }, data: { assignedToId: bob.id } });
    expect((await list().expect(200)).body).toMatchObject({ data: [], total: 0, unreadCount: 0 });
    await request(app.getHttpServer())
      .patch(`/staff-chat/work-notifications/${itemA}/read?company=SHOP`)
      .expect(404);
    await db.chatRoom.update({ where: { id: roomA }, data: { assignedToId: alice.id } });
  });
  it('deduplicates concurrent transactions without poisoning either transaction', async () => {
    const input = {
      recipientId: alice.id,
      kind: 'CHAT_SLA' as const,
      roomId: roomA,
      dedupeKey: 'concurrent',
      title: 'มีแชทรอตอบ',
      targetType: 'ROOM' as const,
      targetId: roomA,
    };
    const items = await Promise.all(
      [1, 2].map(() => db.$transaction((tx) => inbox.enqueue(tx, input))),
    );
    expect(items[0]!.id).toBe(items[1]!.id);
    expect(await db.staffInboxItem.count({ where: { dedupeKey: 'concurrent' } })).toBe(1);
  });
  it.each(['false', '0', ' FALSE '])('does not enqueue while the master toggle is off (%s)', async disabled => {
    await db.systemConfig.upsert({
      where: { key: 'in_app_notifications_enabled' },
      create: { key: 'in_app_notifications_enabled', value: disabled },
      update: { value: disabled },
    });
    expect(
      await db.$transaction((tx) =>
        inbox.enqueue(tx, {
          recipientId: alice.id,
          kind: 'FOLLOW_UP',
          roomId: roomA,
          dedupeKey: `off:${disabled}`,
          title: 'งานติดตาม',
          targetType: 'ROOM',
          targetId: roomA,
        }),
      ),
    ).toBeNull();
    expect(await db.staffInboxItem.count({ where: { dedupeKey: `off:${disabled}` } })).toBe(0);
    await db.systemConfig.update({
      where: { key: 'in_app_notifications_enabled' },
      data: { value: 'true' },
    });
  });
  it('excludes disabled staff and cross-branch staff from assignment', async () => {
    await db.user.update({ where: { id: alice.id }, data: { isActive: false } });
    const eligible = await access.eligibleStaff(roomA, owner, scope);
    expect(eligible.map((user) => user.id)).toContain(owner.id);
    expect(eligible.map((user) => user.id)).not.toContain(alice.id);
    expect(eligible.map((user) => user.id)).not.toContain(bob.id);
    await db.user.update({ where: { id: alice.id }, data: { isActive: true } });
  });
  it('validates query boundaries and keeps foreign company rooms out of the inbox', async () => {
    await request(app.getHttpServer())
      .get('/staff-chat/work-notifications?company=SHOP&limit=9999')
      .expect(400);
    await request(app.getHttpServer())
      .get('/staff-chat/work-notifications?company=INVALID')
      .expect(400);
    const finance = await db.chatRoom.create({ data: { channel: 'LINE_FINANCE' } });
    await expect(access.assertRoom(finance.id, alice, scope)).rejects.toThrow();
  });
});
