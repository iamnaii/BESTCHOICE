import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChatDispatchService } from '../src/modules/chat-engine/services/chat-dispatch.service';
import { ChatDispatchController } from '../src/modules/staff-chat/chat-dispatch.controller';
import { ChatWorkAccessService } from '../src/modules/staff-chat/services/chat-work-access.service';
import { ChatWorkSettingsService } from '../src/modules/staff-chat/services/chat-work-settings.service';
import { RoomManagerService } from '../src/modules/chat-engine/services/room-manager.service';
import { ResponseCycleService } from '../src/modules/chat-engine/services/response-cycle.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { ChatRoomService } from '../src/modules/chatbot-finance/services/chat-room.service';
import { LineFinanceClientService } from '../src/modules/chatbot-finance/services/line-finance-client.service';
import type { ChatWorkActor } from '@installment/shared';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.'))
  throw new Error('Use isolated chat-operations harness');

describe('Durable round-robin dispatch (real PostgreSQL, actual inbound and HTTP paths)', () => {
  const db = new PrismaService();
  const scope = { company: 'SHOP' as const };
  const fixtureName = `Dispatch test ${randomUUID()}`;
  let app: INestApplication;
  let service: ChatDispatchService;
  let rooms: RoomManagerService;
  let finance: ChatRoomService;
  let settings: ChatWorkSettingsService;
  let staff: ChatWorkActor[];
  let actor: ChatWorkActor;
  let owner: ChatWorkActor;
  let otherBranch: string;
  const flags = ['chat_work_queue_enabled', 'chat_round_robin_enabled'];
  beforeAll(async () => {
    await db.$connect();
    await db.companyInfo.upsert({
      where: { companyCode: 'SHOP' },
      create: {
        companyCode: 'SHOP',
        nameTh: 'Isolated shop',
        taxId: '0000000000000',
        address: 'Synthetic',
        directorName: 'Synthetic',
      },
      update: {},
    });
    const branch = await db.branch.create({ data: { name: 'Round robin isolated' } });
    otherBranch = (await db.branch.create({ data: { name: 'Other isolated branch' } })).id;
    staff = await Promise.all(
      ['Alice', 'Bob', 'Carol'].map((name) =>
        db.user.create({
          data: {
            name,
            email: `${randomUUID()}@dispatch.invalid`,
            password: 'unused',
            role: 'SALES',
            branchId: branch.id,
            accessibleCompanies: ['SHOP'],
          },
        }),
      ),
    );
    owner = await db.user.create({
      data: {
        name: 'Queue owner',
        email: `${randomUUID()}@dispatch.invalid`,
        password: 'unused',
        role: 'OWNER',
        accessibleCompanies: ['SHOP', 'FINANCE'],
      },
    });
    const module = await Test.createTestingModule({
      controllers: [ChatDispatchController],
      providers: [
        ChatDispatchService,
        ChatWorkAccessService,
        ChatWorkSettingsService,
        RoomManagerService,
        ResponseCycleService,
        ChatRoomService,
        { provide: PrismaService, useValue: db },
        { provide: StorageService, useValue: {} },
        { provide: LineFinanceClientService, useValue: {} },
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
    service = module.get(ChatDispatchService);
    rooms = module.get(RoomManagerService);
    finance = module.get(ChatRoomService);
    settings = module.get(ChatWorkSettingsService);
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    actor = staff[0];
    await db.chatDispatchMember.updateMany({ data: { readyUntil: null } });
    await db.chatRoom.updateMany({
      where: { dispatchQueuedAt: { not: null } },
      data: { dispatchQueuedAt: null },
    });
    await db.user.updateMany({
      where: { id: { in: staff.map((s) => s.id) } },
      data: { isActive: true, accessibleCompanies: ['SHOP'] },
    });
    for (const key of flags)
      await db.systemConfig.upsert({
        where: { key },
        create: { key, value: 'true' },
        update: { value: 'true', deletedAt: null },
      });
  });
  afterEach(async () => {
    await db.chatRoom.updateMany({
      where: { displayName: fixtureName },
      data: { deletedAt: new Date() },
    });
  });
  afterAll(async () => {
    await db.chatDispatchMember.updateMany({ data: { readyUntil: null } });
    await db.systemConfig.update({
      where: { key: 'chat_round_robin_enabled' },
      data: { value: 'false' },
    });
    await app?.close();
    await db.$disconnect();
  });
  const room = async (data = {}) =>
    db.chatRoom.create({ data: { channel: 'FACEBOOK', displayName: fixtureName, ...data } });
  const inbound = (roomId: string) =>
    rooms.saveMessage({ roomId, role: 'CUSTOMER', text: 'Synthetic customer' });
  const assigned = async (id: string) =>
    (await db.chatRoom.findUniqueOrThrow({ where: { id } })).assignedToId;
  const readyAll = async () => {
    for (const member of staff) await service.setReady(member, scope, true);
  };

  it('rotates A → B → C → A through the real inbound path and keeps an existing owner', async () => {
    await readyAll();
    const ids: string[] = [];
    for (let n = 0; n < 4; n++) {
      const r = await room();
      ids.push(r.id);
      await inbound(r.id);
    }
    expect(await Promise.all(ids.map(assigned))).toEqual([
      staff[0].id,
      staff[1].id,
      staff[2].id,
      staff[0].id,
    ]);
    await inbound(ids[0]);
    expect(await assigned(ids[0])).toBe(staff[0].id);
    expect((await service.read(staff[1], scope)).position).toBe(1);
  });
  it('holds unanswered rooms with nobody ready, then assigns oldest first without historic backfill', async () => {
    const historic = await room({ waitingSince: new Date('2020-01-01') });
    const pending = await room();
    await inbound(pending.id);
    expect(await assigned(pending.id)).toBeNull();
    await service.setReady(staff[0], scope, true);
    expect(await assigned(pending.id)).toBe(staff[0].id);
    expect(await assigned(historic.id)).toBeNull();
    await service.setReady(staff[0], scope, false);
    const first = await room();
    await inbound(first.id);
    const second = await room();
    await inbound(second.id);
    // Lease setup prevents the first join from draining the whole pending queue; drain is tested separately here.
    await db.chatDispatchMember.updateMany({
      where: { staffId: staff[0].id },
      data: { readyUntil: new Date(Date.now() + 60_000), position: 1 },
    });
    await db.chatDispatchMember.upsert({
      where: { staffId_company: { staffId: staff[1].id, company: 'SHOP' } },
      create: {
        staffId: staff[1].id,
        company: 'SHOP',
        position: 2,
        readyUntil: new Date(Date.now() + 60_000),
      },
      update: { position: 2, readyUntil: new Date(Date.now() + 60_000) },
    });
    await service.drain('SHOP');
    expect(await assigned(first.id)).toBe(staff[0].id);
    expect(await assigned(second.id)).toBe(staff[1].id);
  });
  it("puts a new waiting cycle at the back instead of reusing a closed room's old queue time", async () => {
    const returning = await room();
    await inbound(returning.id);
    await db.$transaction((tx) =>
      new ResponseCycleService(db).resolveInTx(tx, {
        roomId: returning.id,
        resolvedAt: new Date(),
      }),
    );
    const waiting = await room();
    await inbound(waiting.id);
    const latest = await inbound(returning.id);
    const reopened = await db.chatRoom.findUniqueOrThrow({ where: { id: returning.id } });
    expect(reopened.dispatchQueuedAt).toEqual(latest.createdAt);
    const queued = await db.chatRoom.findMany({
      where: { id: { in: [returning.id, waiting.id] } },
      orderBy: [{ dispatchQueuedAt: 'asc' }, { id: 'asc' }],
    });
    expect(queued.map((row) => row.id)).toEqual([waiting.id, returning.id]);
  });
  it('serializes concurrent arrivals and workers: one assignment per room and equal turns', async () => {
    await readyAll();
    const pending = await Promise.all(Array.from({ length: 9 }, () => room()));
    await Promise.all([
      ...pending.map((r) => inbound(r.id)),
      service.drain('SHOP'),
      service.drain('SHOP'),
    ]);
    const owners = await Promise.all(pending.map((r) => assigned(r.id)));
    for (const member of staff) expect(owners.filter((id) => id === member.id)).toHaveLength(3);
    const activities = await db.staffChatActivity.findMany({
      where: { action: 'assign', metadata: { path: ['source'], equals: 'round_robin' } },
    });
    for (const r of pending)
      expect(
        activities.filter((a) => (a.metadata as { roomId: string }).roomId === r.id),
      ).toHaveLength(1);
    const same = await room();
    await Promise.all([inbound(same.id), inbound(same.id)]);
    expect(await assigned(same.id)).not.toBeNull();
  });
  it('pause retains existing rooms, rejoin goes last, and stale/expired heartbeats cannot rejoin', async () => {
    await readyAll();
    const old = await service.read(staff[0], scope);
    const owned = await room({ assignedToId: staff[0].id });
    await service.setReady(staff[0], scope, false);
    expect((await service.heartbeat(staff[0], scope, old.generation!)).ready).toBe(false);
    expect(await assigned(owned.id)).toBe(staff[0].id);
    const renewed = await service.setReady(staff[0], scope, true);
    expect(renewed.position).toBe(3);
    expect(renewed.generation).not.toBe(old.generation);
    await db.chatDispatchMember.updateMany({
      where: { staffId: staff[0].id },
      data: { readyUntil: new Date(0) },
    });
    expect((await service.heartbeat(staff[0], scope, renewed.generation!)).ready).toBe(false);
    const r = await room();
    await inbound(r.id);
    expect(await assigned(r.id)).toBe(staff[1].id);
  });
  it('rechecks revoked grants, inactive employees, branch and company before assigning', async () => {
    await readyAll();
    await db.user.update({
      where: { id: staff[0].id },
      data: { accessibleCompanies: ['FINANCE'] },
    });
    await db.user.update({ where: { id: staff[1].id }, data: { isActive: false } });
    const customer = await db.customer.create({
      data: { name: 'Other branch', accessBranchId: otherBranch, accessCompanyCode: 'SHOP' },
    });
    const restricted = await room({ customerId: customer.id });
    await inbound(restricted.id);
    const financeRoom = await room({ channel: 'LINE_FINANCE' });
    await inbound(financeRoom.id);
    const allowed = await room();
    await inbound(allowed.id);
    expect(await assigned(restricted.id)).toBeNull();
    expect(await assigned(financeRoom.id)).toBeNull();
    expect(await assigned(allowed.id)).toBe(staff[2].id);
    await expect(service.setReady(staff[0], scope, true)).rejects.toThrow();
  });
  it('does not starve eligible rooms behind 100 rooms belonging to another branch', async () => {
    const customer = await db.customer.create({
      data: { name: 'Blocked branch', accessBranchId: otherBranch, accessCompanyCode: 'SHOP' },
    });
    await db.chatRoom.createMany({
      data: Array.from({ length: 101 }, () => ({
        channel: 'FACEBOOK' as const,
        displayName: fixtureName,
        customerId: customer.id,
        dispatchQueuedAt: new Date(0),
        waitingSince: new Date(0),
      })),
    });
    await service.setReady(staff[0], scope, true);
    const allowed = await room();
    await inbound(allowed.id);
    expect(await assigned(allowed.id)).toBe(staff[0].id);
  });
  it('disabling routing clears readiness/pending and requires an explicit fresh join after re-enable', async () => {
    const pending = await room();
    await inbound(pending.id);
    await settings.update(owner, { flags: [{ key: 'chat_round_robin_enabled', enabled: false }] });
    expect(
      (await db.chatRoom.findUniqueOrThrow({ where: { id: pending.id } })).dispatchQueuedAt,
    ).toBeNull();
    await expect(service.setReady(staff[0], scope, true)).rejects.toThrow();
    await settings.update(owner, { flags: [{ key: 'chat_round_robin_enabled', enabled: true }] });
    expect((await service.read(staff[0], scope)).ready).toBe(false);
    await service.setReady(staff[0], scope, true);
    expect(await assigned(pending.id)).toBeNull();
  });
  it('never lets an unassigned employee claim by replying while round robin is on', async () => {
    const pending = await room();
    await expect(service.assertMayReply(pending.id, staff[0].id)).rejects.toThrow();
    await db.chatRoom.update({ where: { id: pending.id }, data: { assignedToId: staff[0].id } });
    await expect(service.assertMayReply(pending.id, staff[0].id)).resolves.toBeUndefined();
    await db.systemConfig.update({
      where: { key: 'chat_round_robin_enabled' },
      data: { value: 'false' },
    });
    await expect(service.assertMayReply(pending.id, staff[1].id)).resolves.toBeUndefined();
  });
  it('wires the Finance bot inbound path to the same dispatcher', async () => {
    await service.setReady(owner, { company: 'FINANCE' }, true);
    const r = await room({ channel: 'LINE_FINANCE' });
    await finance.saveMessage({ roomId: r.id, role: 'CUSTOMER', text: 'Finance inbound' });
    expect(await assigned(r.id)).toBe(owner.id);
  });
  it('validates HTTP readiness and ignores caller-supplied staff identity', async () => {
    await request(app.getHttpServer())
      .patch('/staff-chat/dispatch/readiness?company=SHOP')
      .send({ ready: 'true' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/staff-chat/dispatch/readiness?company=SHOP')
      .send({ ready: true, staffId: staff[1].id })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/staff-chat/dispatch/readiness?company=FINANCE')
      .send({ ready: true })
      .expect(403);
    const response = await request(app.getHttpServer())
      .patch('/staff-chat/dispatch/readiness?company=SHOP')
      .send({ ready: true })
      .expect(200);
    expect(response.body.ready).toBe(true);
    await request(app.getHttpServer())
      .post('/staff-chat/dispatch/heartbeat?company=SHOP')
      .send({ generation: 'invalid' })
      .expect(400);
    await request(app.getHttpServer()).get('/staff-chat/dispatch').expect(400);
  });
});
