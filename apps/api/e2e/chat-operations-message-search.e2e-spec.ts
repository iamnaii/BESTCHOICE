import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { EntityScopeInterceptor } from '../src/interceptors/entity-scope.interceptor';
import { StaffChatController } from '../src/modules/staff-chat/staff-chat.controller';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { RoomManagerService } from '../src/modules/chat-engine/services/room-manager.service';
import { StorageService } from '../src/modules/storage/storage.service';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
  throw new Error('Use disposable chat-operations harness');
}

describe('message history search and opening an older search result', () => {
  let db: PrismaService;
  let app: INestApplication;
  let actor: { id: string; role: string; accessibleCompanies: string[] };
  let manager: RoomManagerService;
  let ownId: string;
  let otherId: string;
  let financeId: string;
  let targetId: string;
  let deletedMessageId: string;
  const term = `สนใจรุ่น-${randomUUID()}`;

  beforeAll(async () => {
    db = new PrismaService();
    const branch = await db.branch.create({ data: { name: `search-${randomUUID()}` } });
    actor = await db.user.create({ data: {
      name: 'Search actor', email: `${randomUUID()}@test.invalid`, password: 'unused',
      role: 'OWNER', branchId: branch.id, accessibleCompanies: ['SHOP', 'FINANCE'],
    } });
    const other = await db.user.create({ data: {
      name: 'Other owner', email: `${randomUUID()}@test.invalid`, password: 'unused',
      role: 'SALES', branchId: branch.id, accessibleCompanies: ['SHOP'],
    } });
    const own = await db.chatRoom.create({ data: {
      channel: 'LINE_SHOP', assignedToId: actor.id, displayName: 'ชื่อที่ไม่มีคำค้น',
      waitingSince: new Date(), lastCustomerAt: new Date(), lastMessageAt: new Date(),
    } });
    ownId = own.id;
    otherId = (await db.chatRoom.create({ data: { channel: 'LINE_SHOP', assignedToId: other.id } })).id;
    financeId = (await db.chatRoom.create({ data: { channel: 'LINE_FINANCE', assignedToId: actor.id } })).id;
    const hiddenId = (await db.chatRoom.create({ data: { channel: 'LINE_SHOP' } })).id;
    const deletedRoomId = (await db.chatRoom.create({ data: { channel: 'LINE_SHOP', deletedAt: new Date() } })).id;
    const stamp = new Date(Date.now() - 200 * 60_000);
    targetId = (await db.chatMessage.create({ data: {
      roomId: ownId, role: 'CUSTOMER', type: 'TEXT', text: `ข้อความยาว ${'รายละเอียด '.repeat(40)}${term}`, createdAt: stamp,
    } })).id;
    await db.chatMessage.createMany({ data: Array.from({ length: 150 }, (_, i) => ({
      roomId: ownId, role: 'CUSTOMER' as const, type: 'TEXT' as const,
      text: `ข้อความหลังจากนั้น ${i}`, createdAt: new Date(stamp.getTime() + (i + 1) * 60_000),
    })) });
    for (const roomId of [otherId, financeId, deletedRoomId]) {
      await db.chatMessage.create({ data: { roomId, role: 'CUSTOMER', type: 'TEXT', text: term } });
    }
    deletedMessageId = (await db.chatMessage.create({ data: {
      roomId: ownId, role: 'CUSTOMER', type: 'TEXT', text: term, deletedAt: new Date(),
    } })).id;
    await db.chatMessage.createMany({ data: [
      { roomId: hiddenId, role: 'CUSTOMER', type: 'TEXT', text: term, deletedAt: new Date() },
      { roomId: hiddenId, role: 'BOT', type: 'TEXT', text: term, intent: 'DRAFT:old' },
      { roomId: hiddenId, role: 'SYSTEM', type: 'TEXT', text: term },
    ] });
    manager = new RoomManagerService(db, { configured: false } as StorageService);
    const dependencies: Array<new (...args: never[]) => unknown> = Reflect.getMetadata('design:paramtypes', StaffChatController);
    const module = await Test.createTestingModule({
      controllers: [StaffChatController],
      providers: dependencies.map(token => ({ provide: token, useValue: token === RoomManagerService ? manager : {} })),
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: (ctx: { switchToHttp(): { getRequest(): { user: unknown } } }) => {
      ctx.switchToHttp().getRequest().user = actor;
      return true;
    } }).overrideGuard(RolesGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalInterceptors(new EntityScopeInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(async () => { await app?.close(); await db?.$disconnect(); });
  const search = (extra = {}) => request(app.getHttpServer()).get('/staff-chat/rooms').query({ company: 'SHOP', search: term, ...extra });
  const context = (roomId: string, messageId: string, company = 'SHOP') =>
    request(app.getHttpServer()).get(`/staff-chat/rooms/${roomId}/messages`).query({ around: messageId, company });

  it('searches all history in one authorized room with paging and validated input', async () => {
    const searchRoom = (extra = {}) => request(app.getHttpServer()).get(`/staff-chat/rooms/${ownId}/messages/search`).query({ company: 'SHOP', q: term, ...extra });
    const hit = await searchRoom().expect(200);
    expect(hit.body).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(hit.body.data.map((row: { id: string }) => row.id)).toEqual([targetId]);
    const first = await searchRoom({ q: 'ข้อความหลังจากนั้น', limit: 10 }).expect(200);
    const second = await searchRoom({ q: 'ข้อความหลังจากนั้น', limit: 10, page: 2 }).expect(200);
    expect(first.body.total).toBe(150);
    expect(first.body.data).toHaveLength(10);
    expect(second.body.data).toHaveLength(10);
    expect(new Set([...first.body.data, ...second.body.data].map((row: { id: string }) => row.id)).size).toBe(20);
    await searchRoom({ company: 'FINANCE' }).expect(404);
    for (const invalid of [{ q: ' ' }, { q: 'ก'.repeat(201) }, { page: 0 }, { limit: 51 }, { page: 'abc' }]) await searchRoom(invalid).expect(400);
  });

  it('finds historical text, returns its excerpt, excludes deleted/draft/system and retains the latest preview', async () => {
    const result = await search().expect(200);
    expect(result.body.data.map((row: { id: string }) => row.id).sort()).toEqual([ownId, otherId].sort());
    const own = result.body.data.find((row: { id: string }) => row.id === ownId);
    expect(own.searchMatch.id).toBe(targetId);
    expect(own.searchMatch.text).toContain(term);
    expect(own.messages[0].text).toBe('ข้อความหลังจากนั้น 149');
    const recent = await manager.getRecentMessages(ownId, 100);
    expect(recent.some(message => message.id === targetId)).toBe(false);
    expect((await search({ limit: 1 }).expect(200)).body).toMatchObject({ total: 2, limit: 1 });
  });
  it('intersects text search with waiting, owner, channel and company filters', async () => {
    for (const extra of [{ waiting: true }, { assignedToId: actor.id }, { assignedToId: actor.id, openOnly: true }]) {
      const result = await search(extra).expect(200);
      expect(result.body.data.map((row: { id: string }) => row.id)).toEqual([ownId]);
    }
    expect((await search({ channels: 'FACEBOOK' }).expect(200)).body.total).toBe(0);
    const fin = await search({ company: 'FINANCE' }).expect(200);
    expect(fin.body.data.map((row: { id: string }) => row.id)).toEqual([financeId]);
  });
  it('opens a bounded chronological context around a hit older than the latest 100 messages', async () => {
    const result = await context(ownId, targetId).expect(200);
    expect(result.body.length).toBeLessThanOrEqual(51);
    expect(result.body[0].id).toBe(targetId);
    expect(result.body.at(-1).text).toBe('ข้อความหลังจากนั้น 24');
    await context(otherId, targetId).expect(404);
    await context(ownId, deletedMessageId).expect(404);
    const contextSpy = jest.spyOn(manager, 'getMessageContext');
    const wrongCompany = await context(ownId, targetId, 'FINANCE');
    expect(contextSpy).toHaveBeenLastCalledWith(ownId, targetId, actor, 'FINANCE');
    expect(wrongCompany.status).toBe(404);
    contextSpy.mockRestore();
    for (let attempt = 0; attempt < 5; attempt++) {
      await context(ownId, targetId, 'FINANCE').expect(404);
      await context(ownId, targetId, 'SHOP').expect(200);
    }
    await context(ownId, 'invalid').expect(400);
    await search({ search: 'ก'.repeat(201) }).expect(400);
  });
  it('rechecks current database role and grants before exposing text or opening context', async () => {
    // JWT remains OWNER deliberately: stale claims cannot reveal another staff member’s text.
    await db.user.update({ where: { id: actor.id }, data: { role: 'SALES', accessibleCompanies: ['SHOP'] } });
    try {
      const result = await search().expect(200);
      expect(result.body.data.map((row: { id: string }) => row.id)).toEqual([ownId]);
      const otherMessage = await db.chatMessage.findFirstOrThrow({ where: { roomId: otherId } });
      await context(otherId, otherMessage.id).expect(404);
      await request(app.getHttpServer()).get(`/staff-chat/rooms/${otherId}/messages/search`).query({ company: 'SHOP', q: term }).expect(404);
      await search({ company: 'FINANCE' }).expect(403);
    } finally {
      await db.user.update({ where: { id: actor.id }, data: { role: 'OWNER', accessibleCompanies: ['SHOP', 'FINANCE'] } });
    }
  });
});
