import { BranchReceivingController } from '../inventory/branch-receiving.controller';
import { BranchReceivingService } from '../inventory/branch-receiving.service';
import { StockCountController } from '../inventory/stock-count.controller';
import { StockCountService } from '../inventory/stock-count.service';
import { ReorderPointsController } from '../inventory/reorder-points.controller';
import { ReorderPointsService } from '../inventory/reorder-points.service';
import { InventoryForecastController } from '../inventory/inventory-forecast.controller';
import { InventoryForecastService } from '../inventory/inventory-forecast.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AccessSensitiveService } from './access-sensitive.service';
import { AccessInventoryBoundaries, INVENTORY_BOUNDARY_ROUTES } from './access-inventory-boundaries';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PERMISSION_CATALOG, PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (!url?.includes('/bc_access_task2?host=/tmp/bc-access-')) throw new Error('Explicit isolated URL required');
const db = new PrismaClient({ datasources: { db: { url } } });
const prisma = db as PrismaService;
const snapshots = new AccessSnapshotService(prisma);
const suffix = randomUUID();
const successes = new Map<string, { method: string; path: string; body: unknown }>();
let app: INestApplication, actor: string, denied: string, stock: string, branchA: string, branchB: string;
async function user(role: 'SALES' | 'OWNER' = 'SALES') { return (await db.user.create({ data: { name: 'Procurement fixture', email: `${randomUUID()}@test.invalid`, password: 'unused', role, accessManaged: true } })).id; }
async function grant(id: string, permissions: PermissionKey[], branches = [branchA]) {
  const p = await db.accessPosition.create({ data: { code: randomUUID(), name: 'Fixture', permissions } });
  await db.employeeAccessAssignment.create({ data: { userId: id, positionId: p.id, companyCode: 'SHOP', scope: 'BRANCHES', branches: { create: branches.map(branchId => ({ branchId })) } } });
  return p.id;
}
function http(method: string, path: string, body?: unknown, id = actor) {
  const agent = request(app.getHttpServer());
  const req = method === 'get' ? agent.get(path) : method === 'patch' ? agent.patch(path) : method === 'delete' ? agent.delete(path) : agent.post(path);
  const test = req.set('x-test-user', id).expect('x-access-test-instance', suffix);
  if (body && (typeof body === 'object' || typeof body === 'string')) test.send(body);
  test.on('response', (res: request.Response) => { if (res.status >= 500) console.error(path, res.status, res.body); });
  return test;
}
const get = (path: string, id = actor) => http('get', path, undefined, id);
const post = (path: string, body: unknown, id = actor) => http('post', path, body, id);
beforeAll(async () => {
  for (const companyCode of ['SHOP', 'FINANCE']) await db.companyInfo.upsert({ where: { companyCode }, create: { companyCode, nameTh: 'Fixture', taxId: 'TEST', address: 'TEST', directorName: 'TEST' }, update: {} });
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchA = (await db.branch.create({ data: { name: 'A', companyId: shop.id, isMainWarehouse: true } })).id;
  branchB = (await db.branch.create({ data: { name: 'B', companyId: shop.id } })).id;
  actor = await user(); denied = await user(); stock = await user();
  await grant(actor, PERMISSION_CATALOG.filter(p => !p.ownerOnly && !p.allStaff).map(p => p.key));
  await grant(stock, ['stock-receiving.read', 'stock-receiving.create']);
  await db.user.create({ data: { name: 'Journal fixture', email: 'admin@bestchoice.com', password: 'unused', role: 'OWNER', isSystemUser: true } });

  const module = await Test.createTestingModule({
    controllers: [BranchReceivingController, StockCountController, ReorderPointsController, InventoryForecastController],
    providers: [AccessResourceService, AccessProcurementSourceService, AccessSensitiveService, AccessInventoryBoundaries, AccessPolicyService, RolesGuard, BranchGuard,
      { provide: PrismaService, useValue: db }, { provide: AccessSnapshotService, useValue: snapshots },
      BranchReceivingService, StockCountService, ReorderPointsService, InventoryForecastService,
      { provide: NotificationsService, useValue: { send: jest.fn().mockResolvedValue(undefined) } },
      { provide: APP_INTERCEPTOR, useClass: AccessPolicyInterceptor }],
  }).overrideGuard(JwtAuthGuard).useValue({ canActivate: async (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest(), res = ctx.switchToHttp().getResponse();
    const route = `${ctx.getClass().name}.${ctx.getHandler().name}`;
    res.on('finish', () => { if (res.statusCode < 300 || (route.endsWith('.updatePayment') && res.statusCode === 410)) successes.set(route, { method: req.method.toLowerCase(), path: req.originalUrl, body: structuredClone(req.body) }); });
    req.user = { ...await db.user.findUniqueOrThrow({ where: { id: req.headers['x-test-user'] } }), access: await snapshots.forUser(req.headers['x-test-user']) };
    return true;
  } }).overrideGuard(RolesGuard).useValue({ canActivate: () => true }).overrideGuard(BranchGuard).useValue({ canActivate: () => true }).compile();
  app = module.createNestApplication();
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => { res.setHeader('x-access-test-instance', suffix); next(); });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, '127.0.0.1');
}, 60000);
afterAll(async () => { ACCESS_BOUNDARIES.clear(); await app?.close(); await db.$disconnect(); });


async function product(branchId = branchA) {
  return db.product.create({ data: { name: 'Inventory fixture', brand: 'Apple', model: randomUUID(), category: 'PHONE_NEW', status: 'IN_STOCK', branchId, costPrice: 100, cashPrice: 200 } });
}
test('stock-count scopes before count and rejects record and submit substitution', async () => {
  const a = await product(), b = await product(branchB);
  const session = (await post('/stock-counts', { branchId: branchA }).expect(201)).body;
  await db.stockCount.create({ data: { countNumber: randomUUID(), branchId: branchB, countedById: actor } });
  expect((await get('/stock-counts?limit=1').expect(200)).body.total).toBe(1);
  await post('/stock-counts', { branchId: branchB }).expect(403);
  await post(`/stock-counts/${session.id}/submit`, { items: [{ productId: b.id, actualFound: true }] }).expect(403);
  expect((await db.stockCount.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('IN_PROGRESS');
  await post(`/stock-counts/${session.id}/submit`, { items: [{ productId: a.id, actualFound: true }] }).expect(201);
});

async function transfer(toBranchId = branchA, fromBranchId = branchB) {
  const p = await product(fromBranchId);
  return db.stockTransfer.create({ data: { productId: p.id, fromBranchId, toBranchId, transferredBy: actor, status: 'IN_TRANSIT' } });
}
async function approvedPO(company: 'SHOP' | 'FINANCE' = 'SHOP', status: 'APPROVED' | 'DRAFT' = 'APPROVED') {
  const supplier = await db.supplier.create({ data: { name: 'Lookup fixture', phone: '020000000', accessCompanyCode: company } });
  return db.purchaseOrder.create({ data: { poNumber: randomUUID(), supplierId: supplier.id, createdById: actor, orderDate: new Date(), totalAmount: 999, accessCompanyCode: company, status,
    items: { create: { brand: 'Apple', model: 'Lookup', category: 'PHONE_NEW', quantity: 3, receivedQty: 1, unitPrice: 333 } } }, include: { items: true } });
}
test('safe STOCK lookup returns approved SHOP quantities at the real warehouse without procurement or cost grants', async () => {
  const approved = await approvedPO();
  const full = await approvedPO(); await db.pOItem.update({ where: { id: full.items[0].id }, data: { receivedQty: 3 } });
  const draft = await approvedPO('SHOP', 'DRAFT'), finance = await approvedPO('FINANCE');
  const response = await get(`/branch-receiving/approved-purchase-orders?branchId=${branchA}&limit=1`, stock).expect(200);
  expect(response.body).toMatchObject({ destination: { id: branchA }, total: 1, data: [{ id: approved.id, items: [{ id: approved.items[0].id, quantity: 3, receivedQty: 1, remainingQty: 2 }] }] });
  expect(JSON.stringify(response.body)).not.toMatch(/unitPrice|totalAmount|costPrice|supplier|payment|goodsReceiving/);
  expect(JSON.stringify(response.body)).not.toContain(draft.id); expect(JSON.stringify(response.body)).not.toContain(finance.id);
  await get(`/branch-receiving/approved-purchase-orders?branchId=${branchB}`, stock).expect(403);
  const destinationB = await user(); await grant(destinationB, ['stock-receiving.read'], [branchB]);
  await get('/branch-receiving/approved-purchase-orders', destinationB).expect(403);
  await get('/branch-receiving/approved-purchase-orders?company=FINANCE', stock).expect(403);
});
test('branch receiving checks actual destination and exact transfer product, retains source and masks cost', async () => {
  await grant(stock, ['stock-receiving.update']);
  const intoA = await transfer(), intoB = await transfer(branchB, branchA);
  const pending = await get(`/branch-receiving/pending-deliveries?branchId=${branchA}`, stock).expect(200);
  expect(pending.body.map((r: { id: string }) => r.id)).toContain(intoA.id);
  await post('/branch-receiving', { transferId: intoB.id, items: [{ productId: intoB.productId, status: 'PASS' }] }, stock).expect(403);
  await post('/branch-receiving', { transferId: intoA.id, items: [{ productId: intoB.productId, status: 'PASS' }] }, stock).expect(403);
  await post('/branch-receiving', { transferId: intoA.id, items: [{ productId: intoA.productId, status: 'PASS' }] }, stock).expect(201);
  expect((await db.product.findUniqueOrThrow({ where: { id: intoA.productId } })).branchId).toBe(branchA);
  const receipt = await db.branchReceiving.findUniqueOrThrow({ where: { transferId: intoA.id } });
  const detail = await get(`/branch-receiving/${receipt.id}`, stock).expect(200);
  expect(detail.body.transfer.product.costPrice).toBeNull();
  expect((await get('/branch-receiving?limit=1', stock).expect(200)).body.total).toBe(1);
  await db.branchReceiving.update({ where: { id: receipt.id }, data: { deletedAt: new Date() } });
  expect((await get('/branch-receiving', stock).expect(200)).body.total).toBe(0);
  await db.branchReceiving.update({ where: { id: receipt.id }, data: { deletedAt: null } });
  const noDestination = await user(); await grant(noDestination, ['stock-receiving.read'], [branchB]);
  await get(`/branch-receiving/${receipt.id}`, noDestination).expect(200);
  await grant(noDestination, ['stock-receiving.update'], [branchB]);
  const sourceOnly = await transfer();
  await post('/branch-receiving', { transferId: sourceOnly.id, items: [{ productId: sourceOnly.productId, status: 'PASS' }] }, noDestination).expect(403);
});
test('count numbering is global including unrelated branch sessions and concurrent creation', async () => {
  const prefix = `SC-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-`;
  await db.stockCount.create({ data: { countNumber: `${prefix}500`, branchId: branchB, countedById: actor } });
  const results = await Promise.all([post('/stock-counts', { branchId: branchA }).expect(201), post('/stock-counts', { branchId: branchA }).expect(201)]);
  expect(results.map(r => r.body.countNumber).sort()).toEqual([`${prefix}501`, `${prefix}502`]);
  const id = results[0].body.id;
  await get(`/stock-counts/${id}`).expect(200);
  await get(`/stock-counts/${id}/variance`).expect(200);
  await post(`/stock-counts/${id}/cancel`, {}).expect(201);
});
test('count expected products use ownership; submit rechecks current item company and cost authority', async () => {
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  const foreign = await product(); await db.product.update({ where: { id: foreign.id }, data: { ownedByCompanyId: finance.id } });
  const reader = await user(); await grant(reader, ['stock-count.read', 'stock-count.create', 'stock-count.update']);
  const session = (await post('/stock-counts', { branchId: branchA }, reader).expect(201)).body;
  const detail = (await get(`/stock-counts/${session.id}`, reader).expect(200)).body;
  expect(detail.items.some((i: { productId: string }) => i.productId === foreign.id)).toBe(false);
  expect(detail.items.every((i: { product: { costPrice: unknown } }) => i.product.costPrice === null)).toBe(true);
  const target = detail.items[0].productId;
  await db.product.update({ where: { id: target }, data: { ownedByCompanyId: finance.id } });
  await post(`/stock-counts/${session.id}/submit`, { items: [{ productId: target, actualFound: true }] }, reader).expect(403);
  await get(`/stock-counts/${session.id}`, reader).expect(403);
  await db.product.update({ where: { id: target }, data: { ownedByCompanyId: null } });
});
test('reorder batches mutate exactly permitted branches and linked PO needs independent source read', async () => {
  const create = (branchId: string) => ({ brand: 'Apple', model: randomUUID(), category: 'PHONE_NEW', branchId, minQuantity: 1, reorderQuantity: 2 });
  const a = (await post('/reorder-points', create(branchA)).expect(201)).body;
  const b = await db.reorderPoint.create({ data: { ...create(branchB), category: 'PHONE_NEW' } });
  const reader = await user(); await grant(reader, ['reorder-points.read']);
  await post('/reorder-points/check-stock', {}, reader).expect(403);
  await post('/reorder-points/check-stock', {}).expect(201);
  expect(await db.stockAlert.count({ where: { reorderPointId: b.id } })).toBe(0);
  const alert = await db.stockAlert.findFirstOrThrow({ where: { reorderPointId: a.id } });
  await get('/reorder-points?limit=1').expect(200).then(r => expect(r.body.total).toBe(1));
  await get(`/reorder-points/${a.id}`).expect(200);
  await get(`/reorder-points/${b.id}`).expect(403);
  await get('/reorder-points/alerts').expect(200).then(r => expect(r.body.total).toBe(1));
  await get('/reorder-points/alerts/active').expect(200);
  await get('/reorder-points/low-stock').expect(200);
  await http('patch', `/reorder-points/${a.id}`, { minQuantity: 2 }).expect(200);
  const updater = await user(); await grant(updater, ['reorder-points.update']);
  const central = await approvedPO();
  await post(`/reorder-points/alerts/${alert.id}/resolve`, { poId: central.id }, updater).expect(403);
  await post(`/reorder-points/alerts/${alert.id}/resolve`, {}, updater).expect(201);
  await grant(updater, ['purchase-orders.read']);
  await db.purchaseOrder.update({ where: { id: central.id }, data: { accessBranchId: branchA } });
  await post(`/reorder-points/alerts/${alert.id}/resolve`, { poId: central.id }, updater).expect(201);
  expect((await db.stockAlert.findUniqueOrThrow({ where: { id: alert.id } })).poId).toBe(central.id);
  await db.purchaseOrder.update({ where: { id: central.id }, data: { accessBranchId: branchB } });
  await post(`/reorder-points/alerts/${alert.id}/resolve`, { poId: central.id }, updater).expect(403);
  await http('delete', `/reorder-points/${a.id}`).expect(200);
});
test('forecast scopes Sale independently from current Product ownership, branch and assignment', async () => {
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  const customer = await db.customer.create({ data: { name: 'Inventory sale fixture', phone: '0800000000', nationalId: randomUUID() } });
  const p = await product(branchB);
  await db.product.update({ where: { id: p.id }, data: { ownedByCompanyId: finance.id } });
  await db.sale.create({ data: { saleNumber: randomUUID(), saleType: 'CASH', customerId: customer.id, productId: p.id, branchId: branchA, salespersonId: actor, sellingPrice: 200, netAmount: 200 } });
  const other = await product();
  await db.sale.create({ data: { saleNumber: randomUUID(), saleType: 'CASH', customerId: customer.id, productId: other.id, branchId: branchB, salespersonId: stock, sellingPrice: 200, netAmount: 200 } });
  const result = await get('/inventory/forecast').expect(200);
  expect(result.body.categories.find((c: { category: string }) => c.category === 'PHONE_NEW').salesLast90d).toBe(1);
  const assigned = await user();
  const position = await db.accessPosition.create({ data: { code: randomUUID(), name: 'Assigned forecast', permissions: ['inventory-forecast.read'] } });
  await db.employeeAccessAssignment.create({ data: { userId: assigned, positionId: position.id, companyCode: 'SHOP', scope: 'ASSIGNED' } });
  expect((await get('/inventory/forecast', assigned).expect(200)).body.categories.every((c: { salesLast90d: number }) => c.salesLast90d === 0)).toBe(true);
  await db.sale.updateMany({ where: { productId: p.id }, data: { salespersonId: assigned } });
  expect((await get('/inventory/forecast', assigned).expect(200)).body.categories.find((c: { category: string }) => c.category === 'PHONE_NEW').salesLast90d).toBe(1);
});
test('mixed capability tuples do not authorize another branch mutation or leak its product counts', async () => {
  const mixed = await user();
  await grant(mixed, ['reorder-points.update'], [branchA]);
  await grant(mixed, ['reorder-points.read'], [branchB]);
  const p = await product(branchB);
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await db.product.update({ where: { id: p.id }, data: { ownedByCompanyId: finance.id } });
  const point = await db.reorderPoint.create({ data: { brand: p.brand, model: p.model, category: p.category, branchId: branchB, minQuantity: 1, reorderQuantity: 2 } });
  const rows = (await get(`/reorder-points?branchId=${branchB}`, mixed).expect(200)).body.data;
  expect(rows.find((row: { id: string }) => row.id === point.id).currentStock).toBe(0);
  await http('patch', `/reorder-points/${point.id}`, { minQuantity: 9 }, mixed).expect(403);
  await post('/reorder-points/check-stock', {}, mixed).expect(201);
  expect(await db.stockAlert.count({ where: { reorderPointId: point.id } })).toBe(0);
  await grant(mixed, ['reorder-points.update'], [branchB]);
  await http('patch', `/reorder-points/${point.id}`, { minQuantity: 9 }, mixed).expect(200);
});
test('outer failure rolls back receiving, count and reorder writes and sends no notifications', async () => {
  const sensitive = app.get(AccessSensitiveService), notifications = app.get(NotificationsService);
  const intoA = await transfer();
  let fail = jest.spyOn(sensitive, 'projectProductResult').mockRejectedValueOnce(new Error('synthetic terminal projection failure'));
  await post('/branch-receiving', { transferId: intoA.id, items: [{ productId: intoA.productId, status: 'PASS' }] }).expect(500);
  fail.mockRestore();
  expect(await db.branchReceiving.count({ where: { transferId: intoA.id } })).toBe(0);
  expect((await db.product.findUniqueOrThrow({ where: { id: intoA.productId } })).branchId).toBe(branchB);
  expect((await db.stockTransfer.findUniqueOrThrow({ where: { id: intoA.id } })).status).toBe('IN_TRANSIT');
  const before = await db.stockCount.count();
  fail = jest.spyOn(sensitive, 'projectProductResult').mockRejectedValueOnce(new Error('synthetic terminal projection failure'));
  await post('/stock-counts', { branchId: branchA }).expect(500);
  fail.mockRestore(); expect(await db.stockCount.count()).toBe(before);
  const rp = await db.reorderPoint.create({ data: { brand: 'Apple', model: randomUUID(), category: 'PHONE_NEW', branchId: branchA, minQuantity: 1, reorderQuantity: 2 } });
  jest.mocked(notifications.send).mockClear();
  fail = jest.spyOn(sensitive, 'projectProductResult').mockRejectedValueOnce(new Error('synthetic terminal projection failure'));
  await post('/reorder-points/check-stock', {}).expect(500);
  fail.mockRestore();
  expect(await db.stockAlert.count({ where: { reorderPointId: rp.id } })).toBe(0);
  expect(notifications.send).not.toHaveBeenCalled();
  await post('/reorder-points/check-stock', {}).expect(201);
  expect(await db.stockAlert.count({ where: { reorderPointId: rp.id } })).toBe(1);
  expect(notifications.send).toHaveBeenCalled();
});
test('malformed collection filters fail before queries', async () => {
  await get('/reorder-points?category=unknown').expect(400);
  await get('/stock-counts?limit=-1').expect(400);
  await get('/branch-receiving?status=unknown').expect(400);
  await get('/inventory/forecast?unknown=true').expect(400);
});
test('every enabled inventory route has actual successful HTTP evidence and persisted no-grant denial', async () => {
  expect(INVENTORY_BOUNDARY_ROUTES.filter(route => !successes.has(route))).toEqual([]);
  for (const route of INVENTORY_BOUNDARY_ROUTES) {
    const evidence = successes.get(route)!;
    await http(evidence.method, evidence.path, evidence.body, denied).expect(403);
  }
});
