import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { AiTextService } from '../src/modules/ai-usage/ai-text.service';
import { SearchProductsTool } from '../src/modules/sales-bot/tools/search-products.tool';
import { CalculateInstallmentTool } from '../src/modules/sales-bot/tools/calculate-installment.tool';
import { RoomAssistanceController } from '../src/modules/staff-chat/room-assistance.controller';
import { PrepareOfferService } from '../src/modules/staff-chat/services/prepare-offer.service';
import { RoomAiAccessService, StaffAiActor } from '../src/modules/staff-chat/services/room-ai-access.service';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
  throw new Error('Run tools/test-chat-credit.sh against its disposable database');
}

describe('Staff offer workflow with HTTP, real stock and shared installment calculator', () => {
  const db = new PrismaService();
  const ai = { isAvailable: true, generate: jest.fn() };
  let app: INestApplication;
  let actor: StaffAiActor;
  let staff: StaffAiActor;
  let roomId: string;
  let otherRoomId: string;
  let customerId: string;
  let productId: string;
  let sourceId: string;
  let initialContracts: number;
  let initialMessages: number;
  let configId: string | undefined;
  let previousActiveConfigIds: string[] = [];

  beforeAll(async () => {
    await db.$connect();
    const branches = await Promise.all([1, 2].map((n) => db.branch.create({ data: { name: `OFFER TEST ${n}` } })));
    const staffUsers = await Promise.all(branches.map((branch) => db.user.create({ data: {
      name: 'SYNTHETIC STAFF', email: `${randomUUID()}@test.invalid`, password: 'unused', role: 'SALES', branchId: branch.id,
    } })));
    staff = { id: staffUsers[0].id, role: 'SALES', branchId: branches[0].id, accessibleCompanies: ['SHOP'] };
    customerId = (await db.customer.create({ data: { name: 'SYNTHETIC OFFER CUSTOMER', phone: '0000000000' } })).id;
    roomId = (await db.chatRoom.create({ data: { channel: 'FACEBOOK', customerId, assignedToId: staff.id } })).id;
    otherRoomId = (await db.chatRoom.create({ data: { channel: 'FACEBOOK', assignedToId: staffUsers[1].id } })).id;
    sourceId = (await db.chatMessage.create({ data: { roomId, role: 'CUSTOMER', type: 'TEXT', text: 'สนใจ iPhone 15 งบเงินสด 20000' } })).id;
    await db.chatMessage.create({ data: { roomId, role: 'STAFF', type: 'TEXT', text: 'INTERNAL SECRET: ห้ามส่งเข้า AI' } });
    const products = await Promise.all(branches.map((branch) => db.product.create({ data: {
      name: 'Synthetic iPhone 15', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_USED',
      costPrice: 10000, cashPrice: 18000, installmentPrice: 20000, branchId: branch.id,
      imeiSerial: randomUUID(), status: 'IN_STOCK', isOnlineVisible: true, batteryHealth: 90,
    } })));
    productId = products[0].id;
    // Isolated fixture owns this category's configuration for deterministic parity.
    previousActiveConfigIds = (await db.interestConfig.findMany({ where: { productCategories: { has: 'PHONE_USED' }, isActive: true }, select: { id: true } })).map(row => row.id);
    await db.interestConfig.updateMany({ where: { id: { in: previousActiveConfigIds } }, data: { isActive: false } });
    configId = (await db.interestConfig.create({ data: {
      name: 'Synthetic offer plan', productCategories: ['PHONE_USED'], interestRate: 0.10,
      minDownPaymentPct: 0.20, storeCommissionPct: 0, vatPct: 0,
      minInstallmentMonths: 6, maxInstallmentMonths: 12, isActive: true,
    } })).id;
    initialContracts = await db.contract.count();
    initialMessages = await db.chatMessage.count({ where: { roomId } });
    const module = await Test.createTestingModule({
      controllers: [RoomAssistanceController],
      providers: [PrepareOfferService, RoomAiAccessService, SearchProductsTool, CalculateInstallmentTool,
        { provide: PrismaService, useValue: db }, { provide: AiTextService, useValue: ai }],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate: (context: { switchToHttp(): { getRequest(): { user: unknown } } }) => {
        context.switchToHttp().getRequest().user = actor;
        return true;
      },
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    // Bind the same IPv4 destination Supertest uses; Darwin permits a different IPv6 server on the same port.
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(() => {
    actor = { ...staff };
    ai.generate.mockClear().mockResolvedValue(JSON.stringify({ summary: 'ต้องการ iPhone 15', searchQuery: 'iPhone 15' }));
  });
  afterAll(async () => {
    if (app) await app.close();
    if (configId) await db.interestConfig.delete({ where: { id: configId } });
    await db.interestConfig.updateMany({ where: { id: { in: previousActiveConfigIds } }, data: { isActive: true } });
    await db.$disconnect();
  });
  const post = (room = roomId) => request(app.getHttpServer()).post(`/staff-chat/rooms/${room}/prepare-offer`);

  it('builds a sourced draft from only the assigned branch and hands real customer/product context to contracts', async () => {
    const response = await post().send({ maxPriceThb: 20000, tenureMonths: 12 }).expect(201);
    expect(response.body.products.map((p: { productId: string }) => p.productId)).toEqual([productId]);
    const product = response.body.products[0];
    const calculated = await new CalculateInstallmentTool(db).run({ productId, tenureMonths: 12 }, { branchId: staff.branchId! }, true);
    expect(product.quote).toEqual(expect.objectContaining({ monthlyThb: calculated.monthlyThb, downAmountThb: calculated.downAmountThb, tenureMonths: 12 }));
    expect(product.cashPriceThb).toBe(18000);
    const next = new URL(product.contractPath, 'http://local.test');
    expect(next.pathname).toBe('/contracts/create');
    expect(next.searchParams.get('customerId')).toBe(customerId);
    expect(next.searchParams.get('productId')).toBe(productId);
    expect(next.searchParams.get('fromRoom')).toBe(roomId);
    expect(response.body.sources.map((s: { messageId: string }) => s.messageId)).toEqual([sourceId]);
    expect(JSON.stringify(ai.generate.mock.calls)).not.toContain('INTERNAL SECRET');
    expect(await db.chatMessage.count({ where: { roomId } })).toBe(initialMessages);
    expect(await db.contract.count()).toBe(initialContracts);
  });

  it('rejects another staff branch before model usage and ignores forged actor fields in the body', async () => {
    await post(otherRoomId).send({ tenureMonths: 12, role: 'OWNER', accessibleCompanies: ['SHOP'], branchId: null }).expect(403);
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('enforces roles, company and DTO validation at HTTP boundaries', async () => {
    actor = { ...staff, accessibleCompanies: ['FINANCE'] };
    await post().send({ tenureMonths: 12 }).expect(403);
    actor = { ...staff, role: 'VIEWER' };
    await post().send({ tenureMonths: 12 }).expect(403);
    actor = { ...staff };
    await post().send({ tenureMonths: 0, maxPriceThb: -1 }).expect(400);
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('removes a sold product from new offers without recording a sale or sending a message', async () => {
    await db.product.update({ where: { id: productId }, data: { status: 'SOLD_CASH' } });
    const response = await post().send({ query: 'iPhone 15', tenureMonths: 12 }).expect(201);
    expect(response.body.products).toEqual([]);
    expect(await db.contract.count()).toBe(initialContracts);
    expect(await db.chatMessage.count({ where: { roomId } })).toBe(initialMessages);
  });
});
