import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ChatChannel } from '@prisma/client';
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

describe('real inbox HTTP reads follow the selected work company', () => {
  let db: PrismaService;
  let app: INestApplication;
  let actor: { id: string; role: string; accessibleCompanies: string[] };
  let shopIds: string[];
  let financeId: string;
  const prefix = `company-switch-${randomUUID()}`;
  // Independent expectation: changing the production mapping must not make this test pass for free.
  const channels = {
    SHOP: ['LINE_SHOP', 'FACEBOOK', 'TIKTOK', 'WEB'] as ChatChannel[],
    FINANCE: ['LINE_FINANCE'] as ChatChannel[],
  };

  beforeAll(async () => {
    db = new PrismaService();
    actor = await db.user.create({ data: {
      name: 'Inbox company test', email: `${randomUUID()}@test.invalid`, password: 'unused',
      role: 'OWNER', accessibleCompanies: ['SHOP', 'FINANCE'],
    } });
    const create = (channel: ChatChannel, deletedAt: Date | null = null) => db.chatRoom.create({
      data: {
        channel, assignedToId: actor.id, displayName: prefix, deletedAt,
        status: 'ACTIVE', handoffMode: true, waitingSince: new Date(), lastCustomerAt: new Date(),
      },
    });
    shopIds = [(await create('LINE_SHOP')).id, (await create('FACEBOOK')).id];
    financeId = (await create('LINE_FINANCE')).id;
    await create('LINE_FINANCE', new Date());
    const manager = new RoomManagerService(db, {} as StorageService);
    // Real controller, interceptor, validation, service and PostgreSQL. Only unrelated
    // send/AI dependencies are inert; no external messages or integrations can run.
    const dependencies: Array<new (...args: never[]) => unknown> = Reflect.getMetadata('design:paramtypes', StaffChatController);
    const module = await Test.createTestingModule({
      controllers: [StaffChatController],
      providers: dependencies.map(token => ({ provide: token, useValue: token === RoomManagerService ? manager : {} })),
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: (ctx: { switchToHttp(): { getRequest(): { user: unknown } } }) => {
        ctx.switchToHttp().getRequest().user = actor;
        return true;
      } })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalInterceptors(new EntityScopeInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => { await app?.close(); await db?.$disconnect(); });

  it.each(['SHOP', 'FINANCE'] as const)('%s changes actual rows, waiting pagination and counts together', async company => {
    const expectedIds = company === 'SHOP' ? shopIds : [financeId];
    for (const waiting of [false, true]) {
      const response = await request(app.getHttpServer()).get('/staff-chat/rooms')
        .query({ company: company.toLowerCase(), search: prefix, waiting }).expect(200);
      expect(response.body.data.map((r: { id: string }) => r.id).sort()).toEqual([...expectedIds].sort());
      expect(response.body.total).toBe(expectedIds.length);
      const paged = await request(app.getHttpServer()).get('/staff-chat/rooms')
        .query({ company: company.toLowerCase(), search: prefix, waiting, limit: 1 }).expect(200);
      expect(paged.body.data).toHaveLength(1);
      expect(expectedIds).toContain(paged.body.data[0].id);
      expect(paged.body.total).toBe(expectedIds.length);
    }
    const all = await request(app.getHttpServer()).get('/staff-chat/rooms').query({ company }).expect(200);
    const waiting = await request(app.getHttpServer()).get('/staff-chat/rooms').query({ company, waiting: true }).expect(200);
    const counts = await request(app.getHttpServer()).get('/staff-chat/rooms/counts').query({ company, tab: 'waiting' }).expect(200);
    expect(counts.body.all).toBe(all.body.total);
    expect(counts.body.waiting).toBe(waiting.body.total);
    expect(counts.body.mine).toBe(expectedIds.length);
    expect(Object.keys(counts.body.byChannel).every(channel => channels[company].includes(channel as ChatChannel))).toBe(true);
    const unread = await request(app.getHttpServer()).get('/staff-chat/unread-count').query({ company }).expect(200);
    expect(unread.body.unread).toBe(await db.chatRoom.count({ where: {
      deletedAt: null, channel: { in: channels[company] }, status: 'ACTIVE', handoffMode: true,
      OR: [{ assignedToId: actor.id }, { assignedToId: null }],
    } }));
  });

  it('intersects channel filters with company scope and supports the authorized scope header', async () => {
    for (const [company, channel] of [['shop', 'LINE_FINANCE'], ['finance', 'FACEBOOK']]) {
      for (const key of ['channel', 'channels']) {
        const response = await request(app.getHttpServer()).get('/staff-chat/rooms')
          .query({ company, [key]: channel, search: prefix }).expect(200);
        expect({ company, key, channel, body: response.body, text: response.text }).toMatchObject({
          company, key, channel, body: { total: 0, data: [] },
        });
      }
    }
    const response = await request(app.getHttpServer()).get('/staff-chat/rooms')
      .set('x-company-scope', 'FINANCE').query({ search: prefix }).expect(200);
    expect(response.body.data.map((r: { id: string }) => r.id)).toEqual([financeId]);
  });

  it('preserves company grants for all three reads', async () => {
    actor = { ...actor, accessibleCompanies: ['SHOP'] };
    try {
      for (const path of ['rooms', 'rooms/counts', 'unread-count']) {
        await request(app.getHttpServer()).get(`/staff-chat/${path}`).query({ company: 'finance' }).expect(403);
      }
    } finally { actor = { ...actor, accessibleCompanies: ['SHOP', 'FINANCE'] }; }
  });
});
