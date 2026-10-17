import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessSensitiveService } from './access-sensitive.service';
import { AccessShopBoundaries } from './access-shop-boundaries';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { ProductsController } from '../products/products.controller';
import { ProductsService } from '../products/products.service';
import { ProductsStockService } from '../products/products-stock.service';
import { ProductsPricingService } from '../products/products-pricing.service';
import { ProductsOnlineListingService } from '../products/products-online-listing.service';
import { InspectionsController } from '../quality-control/inspections.controller';
import { InspectionsService } from '../quality-control/inspections.service';
import { ProductPhotosController } from '../quality-control/product-photos.controller';
import { ProductPhotosService } from '../quality-control/product-photos.service';
import { StorageService } from '../storage/storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { permissionScopes } from './access-context';
import { productScopeSql, productScopeWhere } from './access-query-scope';
import { PermissionKey } from '@installment/shared';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (!url || !url.includes('/bc_access_task2?host=/tmp/bc-access-')) throw new Error('Explicit isolated employee-access test URL required');
const db = new PrismaClient({ datasources: { db: { url } } });
const snapshots = new AccessSnapshotService(db as any);
let app: INestApplication, owner: string, actor: string, branchA: string, branchB: string, branchC: string, productA: string, productB: string, productC: string, financeProduct: string;
let managerPosition: string;
const suffix = randomUUID();
const succeeded = new Map<string, { method: string; path: string; body: any }>();
async function grant(permissions: PermissionKey[], branches: string[], company: 'SHOP' | 'FINANCE' = 'SHOP', scope: 'BRANCHES' | 'ASSIGNED' | 'COMPANY' = 'BRANCHES') {
  const position = await db.accessPosition.create({ data: { code: randomUUID(), name: 'Fixture', permissions } });
  await db.employeeAccessAssignment.create({ data: { userId: actor, positionId: position.id, companyCode: company, scope, branches: { create: branches.map(branchId => ({ branchId })) } } });
  return position.id;
}
async function createProduct(branchId: string, extra: Record<string, any> = {}) {
  return db.product.create({ data: { name: 'Fixture', brand: 'Apple', model: 'Phone', category: 'PHONE_USED', costPrice: 9876, branchId, ...extra } });
}
const get = (path: string) => request(app.getHttpServer()).get(path).set('x-test-user', actor);
const post = (path: string) => request(app.getHttpServer()).post(path).set('x-test-user', actor);
const patch = (path: string) => request(app.getHttpServer()).patch(path).set('x-test-user', actor);

beforeAll(async () => {
  for (const companyCode of ['SHOP', 'FINANCE']) await db.companyInfo.upsert({ where: { companyCode }, create: { companyCode, nameTh: 'Fixture', taxId: 'TEST', address: 'TEST', directorName: 'TEST' }, update: {} });
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const finance = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  branchA = (await db.branch.create({ data: { name: 'A', companyId: shop.id, isMainWarehouse: true } })).id;
  branchB = (await db.branch.create({ data: { name: 'B', companyId: shop.id } })).id;
  branchC = (await db.branch.create({ data: { name: 'C', companyId: shop.id } })).id;
  owner = (await db.user.create({ data: { name: 'Owner', email: `${suffix}-owner@test.invalid`, password: 'unused', role: 'OWNER', accessManaged: true } })).id;
  actor = (await db.user.create({ data: { name: 'Sales role with scoped positions', email: `${suffix}-actor@test.invalid`, password: 'unused', role: 'SALES', accessManaged: true, branchId: branchC } })).id;
  productA = (await createProduct(branchA)).id;
  productB = (await createProduct(branchB)).id;
  productC = (await createProduct(branchC)).id;
  financeProduct = (await createProduct(branchA, { ownedByCompanyId: finance.id })).id;
  managerPosition = await grant(['products.read', 'products.create', 'products.update', 'products.delete', 'stock-transfers.create', 'stock-transfers.update', 'stock-transfers.receive', 'stock-transfers.approve', 'inspections.read', 'inspections.create', 'inspections.update', 'product-photos.read', 'product-photos.create', 'product-photos.update', 'product-photos.delete'], [branchA]);
  await grant(['products.read', 'product-photos.read'], [branchB]);
  await grant(['sensitive.cost.read'], [branchA]);
  const module = await Test.createTestingModule({
    controllers: [ProductsController, InspectionsController, ProductPhotosController],
    providers: [ProductsService, ProductsStockService, ProductsPricingService, ProductsOnlineListingService, InspectionsService, ProductPhotosService, AccessResourceService, AccessSensitiveService, AccessShopBoundaries, AccessPolicyService, RolesGuard, BranchGuard,
      { provide: PrismaService, useValue: db }, { provide: AccessSnapshotService, useValue: snapshots },
      { provide: StorageService, useValue: { upload: jest.fn(), getPublicUrl: () => 'https://test.invalid/photo' } },
      { provide: APP_INTERCEPTOR, useClass: AccessPolicyInterceptor }],
  }).overrideGuard(JwtAuthGuard).useValue({ canActivate: async (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const route = `${ctx.getClass().name}.${ctx.getHandler().name}`;
    res.on('finish', () => { if (res.statusCode < 300) succeeded.set(route, { method: req.method.toLowerCase(), path: req.originalUrl, body: structuredClone(req.body) }); });
    const id = req.headers['x-test-user'];
    req.user = { ...await db.user.findUniqueOrThrow({ where: { id } }), access: await snapshots.forUser(id) };
    // The separate runtime suite proves JWT verification; here only identity is a fixture.
    return true;
  } }).overrideGuard(RolesGuard).useValue({ canActivate: () => true }).overrideGuard(BranchGuard).useValue({ canActivate: () => true }).compile();
  app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
}, 30000);
afterAll(async () => { ACCESS_BOUNDARIES.clear(); await app?.close(); await db.$disconnect(); });

test('registers all 49 concrete product/QC boundaries', () => expect(ACCESS_BOUNDARIES.size).toBe(49));
test('real SQL and Prisma predicates select identical original tuples and isolate FINANCE ownership', async () => {
  const snapshot = await snapshots.forUser(actor);
  const scope = { userId: actor, company: 'SHOP' as const, permission: 'products.read' as const, tuples: permissionScopes({ id: actor, access: snapshot }, 'products.read', 'SHOP') };
  const rows = await db.product.findMany({ where: productScopeWhere(scope), select: { id: true } });
  const sqlRows = await db.$queryRaw<Array<{ id: string }>>`SELECT p.id FROM products p WHERE ${productScopeSql(scope)}`;
  expect(rows.map(r => r.id).sort()).toEqual([productA, productB].sort());
  expect(sqlRows.map(r => r.id).sort()).toEqual(rows.map(r => r.id).sort());
});
test('scopes rows/count/pagination and source cost, independent of legacy SALES role', async () => {
  const first = await get('/products?limit=1&page=1').expect(200);
  const second = await get('/products?limit=1&page=2').expect(200);
  expect(first.body.total).toBe(2);
  expect(second.body.total).toBe(2);
  expect(new Set([first.body.data[0].id, second.body.data[0].id])).toEqual(new Set([productA, productB]));
  const a = await get(`/products/${productA}`).expect(200);
  const b = await get(`/products/${productB}`).expect(200);
  expect(Number(a.body.costPrice)).toBe(9876);
  expect(b.body.costPrice).toBeNull();
  await get(`/products/${productC}`).expect(403);
  await get(`/products/${financeProduct}`).expect(403);
  await get('/products?sortBy=costPrice').expect(403);
});
test('grouped raw SQL is scoped before counts and pagination', async () => {
  const response = await get('/products?groupAccessories=true&limit=1').expect(200);
  expect(response.body.total).toBe(2);
  expect(response.body.viewCounts.all).toBe(2);
  expect(response.body.data).toHaveLength(1);
});
test('collection callbacks validate DTOs, filters and arrays', async () => {
  for (const query of ['limit=-1', 'sortBy=secret', 'groupAccessories=bad', 'search[x]=bad', 'status=NOT_A_STATUS', 'category=NOT_A_CATEGORY']) await get(`/products?${query}`).expect(400);
  await get('/inspections?isCompleted=invalid').expect(400);
});
test('manager A plus sales B cannot mutate B; actual reservation succeeds in A', async () => {
  await post(`/products/${productB}/reserve`).send({}).expect(403);
  await post(`/products/${productA}/reserve`).send({}).expect(201);
  expect((await db.product.findUniqueOrThrow({ where: { id: productA } })).status).toBe('RESERVED');
  await post(`/products/${productA}/unreserve`).send({}).expect(201);
});
test('source and destination must both be authorized to create a transfer', async () => {
  await post(`/products/${productA}/transfer`).send({ toBranchId: branchB }).expect(403);
  await grant(['stock-transfers.create', 'stock-transfers.receive'], [branchB]);
  const created = await post(`/products/${productA}/transfer`).send({ toBranchId: branchB }).expect(201);
  await post(`/products/transfers/${created.body.id}/dispatch`).send({}).expect(201);
  await post(`/products/transfers/${created.body.id}/confirm`).send({}).expect(201);
  expect((await db.product.findUniqueOrThrow({ where: { id: productA } })).branchId).toBe(branchB);
  await db.product.update({ where: { id: productA }, data: { branchId: branchA } });
});
test('photo callbacks and direct ID substitution use persisted product scope', async () => {
  await get(`/products/${productA}/photos`).expect(200);
  await get(`/products/${productC}/photos`).expect(403);
  await post(`/products/${productC}/photos/upload`).send({ angle: 'front', photo: 'data:image/png;base64,aGVsbG8=' }).expect(403);
});
test('inspection creation and completion preserve real workflow and scope', async () => {
  const template = await db.inspectionTemplate.create({ data: { name: 'Fixture', deviceType: 'PHONE', accessCompanyCode: 'SHOP' } });
  await post('/inspections').send({ productId: productB, templateId: template.id }).expect(403);
  const inspection = await post('/inspections').send({ productId: productA, templateId: template.id }).expect(201);
  await get(`/inspections/${inspection.body.id}`).expect(200);
  await post(`/inspections/${inspection.body.id}/complete`).send({}).expect(201);
  expect((await db.product.findUniqueOrThrow({ where: { id: productA } })).status).toBe('QC_PENDING');
  await db.product.update({ where: { id: productA }, data: { status: 'IN_STOCK' } });
});
test('ASSIGNED with no genuine product assignment cannot become branch access', async () => {
  await grant(['products.read'], [branchC], 'SHOP', 'ASSIGNED');
  await get(`/products/${productC}`).expect(403);
  expect((await get('/products').expect(200)).body.total).toBe(2);
});
test('current authority is rechecked after preflight and no real service write runs', async () => {
  const original = await snapshots.forUser(actor);
  const boundary = ACCESS_BOUNDARIES.get('ProductsController.reserve')!;
  const req = { user: { id: actor, role: 'SALES', access: original }, params: { id: productA }, query: {}, body: {} };
  const decision = await boundary(req, original, 'products.update');
  if (decision.kind !== 'resource' || !decision.execute) throw new Error('Expected resource executor');
  await db.accessPosition.update({ where: { id: managerPosition }, data: { isActive: false } });
  const handler = jest.fn(() => app.get(ProductsStockService).reserve(productA));
  await expect(decision.execute(handler)).rejects.toThrow();
  expect(handler).not.toHaveBeenCalled();
  expect((await db.product.findUniqueOrThrow({ where: { id: productA } })).status).toBe('IN_STOCK');
  await db.accessPosition.update({ where: { id: managerPosition }, data: { isActive: true } });
});
test('real service mutation rolls back when outer execution fails', async () => {
  const resources = app.get(AccessResourceService);
  const before = await db.product.findUniqueOrThrow({ where: { id: productA } });
  await expect(resources.execute(actor, 'products.update', 'SHOP', async tx => ({ company: 'SHOP', resources: [await resources.product(tx, productA)], productIds: [productA] }), async () => {
    await app.get(ProductsStockService).reserve(productA);
    throw new Error('failure after domain write');
  })).rejects.toThrow('failure after domain write');
  expect((await db.product.findUniqueOrThrow({ where: { id: productA } })).status).toBe(before.status);
});
test('managed owners cannot execute a stale preflight after account disablement', async () => {
  const snapshot = await snapshots.forUser(owner);
  const decision = await ACCESS_BOUNDARIES.get('ProductsController.reserve')!({ user: { id: owner, access: snapshot }, params: { id: productA }, query: {}, body: {} }, snapshot, 'products.update');
  await db.user.update({ where: { id: owner }, data: { isActive: false } });
  const handler = jest.fn();
  if (decision.kind !== 'resource' || !decision.execute) throw new Error('Expected executor');
  await expect(decision.execute(handler)).rejects.toThrow();
  expect(handler).not.toHaveBeenCalled();
  await db.user.update({ where: { id: owner }, data: { isActive: true } });
});

test('generic product update and cost read do not authorize hidden cost writes', async () => {
  await patch(`/products/${productA}`).send({ costPrice: 123 }).expect(403);
});

test('safe legacy reference reads work before first use; new templates persist authenticated origin', async () => {
  const unknown = await db.inspectionTemplate.create({ data: { name: 'Unknown origin', deviceType: 'PHONE' } });
  const list = await get('/inspection-templates').expect(200);
  expect(list.body.some((row: any) => row.id === unknown.id)).toBe(true);
  await get(`/inspection-templates/${unknown.id}`).expect(200);
  await patch(`/inspection-templates/${unknown.id}`).send({ name: 'Attempt shared edit' }).expect(403);
  await post('/inspections').send({ productId: productA, templateId: unknown.id }).expect(201);
  const created = await request(app.getHttpServer()).post('/inspection-templates').set('x-test-user', owner).send({ name: 'New origin', deviceType: 'PHONE', accessCompanyCode: 'FINANCE' }).expect(201);
  expect((await db.inspectionTemplate.findUniqueOrThrow({ where: { id: created.body.id } })).accessCompanyCode).toBe('SHOP');
});
test('price authority cannot be bypassed by generic product update or price endpoints', async () => {
  await patch(`/products/${productA}`).send({ cashPrice: 19999 }).expect(403);
  await post(`/products/${productA}/prices`).send({ label: 'Cash', amount: 19999 }).expect(403);
  const position = await grant(['pricing.update', 'products.cost.update'], [branchA]);
  await patch(`/products/${productA}`).send({ costPrice: 9876, cashPrice: 19999 }).expect(200);
  await post(`/products/${productA}/prices`).send({ label: 'Second', amount: 21000 }).expect(201);
  await db.accessPosition.update({ where: { id: position }, data: { isActive: false } });
});

test('scoped pricing authority edits price rows without product creation or deletion authority', async () => {
  const position = await grant(['pricing.update'], [branchA]);
  await db.accessPosition.update({ where: { id: managerPosition }, data: { isActive: false } });
  try {
    const price = await post(`/products/${productA}/prices`).send({ label: 'Pricing only', amount: 21000 }).expect(201);
    await patch(`/products/${productA}/prices/${price.body.id}`).send({ amount: 22000 }).expect(200);
    await request(app.getHttpServer()).delete(`/products/${productA}/prices/${price.body.id}`).set('x-test-user', actor).expect(200);
    await post(`/products/${productB}/prices`).send({ label: 'Outside source', amount: 21000 }).expect(403);
    await post('/products').send({ name: 'Unauthorized', branchId: branchA }).expect(403);
    await request(app.getHttpServer()).delete(`/products/${productA}`).set('x-test-user', actor).expect(403);
  } finally {
    await db.accessPosition.update({ where: { id: managerPosition }, data: { isActive: true } });
    await db.accessPosition.update({ where: { id: position }, data: { isActive: false } });
  }
});

test('all collection adapters preserve usable response shapes with scoped underlying queries', async () => {
  for (const path of ['/products/stock', '/products/stock/dashboard', '/products/brands', '/products/accessory-skus', '/products/warranty/expiring', '/products/supplier-performance', '/products/transfers/pending', '/products/transfers/in-transit', '/products/transfers/history', '/inspections', '/inspection-templates']) await get(path).expect(200);
  const dashboard = await get('/products/stock/dashboard').expect(200);
  expect(dashboard.body.marginOverview).toBeNull();
  expect(dashboard.body.stockAging.every((row: any) => row.value === null)).toBe(true);
  const stock = await get('/products/stock').expect(200);
  expect(stock.body.summary.some((row: any) => row.branch.id === branchC)).toBe(false);
});
test('explicit COMPANY is isolated, while FINANCE may use a SHOP origin branch', async () => {
  const company = await grant(['products.read'], [], 'SHOP', 'COMPANY');
  const shop = await get('/products').expect(200);
  expect(shop.body.data.some((row: any) => row.id === productC)).toBe(true);
  expect(shop.body.data.some((row: any) => row.id === financeProduct)).toBe(false);
  await db.accessPosition.update({ where: { id: company }, data: { isActive: false } });
  const finance = await grant(['products.read'], [branchA], 'FINANCE');
  await get(`/products/${financeProduct}?company=FINANCE`).expect(200);
  await get(`/products/${productA}?company=FINANCE`).expect(403);
  expect((await get('/products?company=FINANCE').expect(200)).body.total).toBe(1);
  await db.accessPosition.update({ where: { id: finance }, data: { isActive: false } });
});
test('unknown persisted company is denied, not inferred from controller name', async () => {
  const branch = await db.branch.create({ data: { name: 'No company' } });
  const product = await createProduct(branch.id);
  const company = await grant(['products.read'], [], 'SHOP', 'COMPANY');
  await get(`/products/${product.id}`).expect(403);
  expect((await get('/products').expect(200)).body.data.some((row: any) => row.id === product.id)).toBe(false);
  await db.accessPosition.update({ where: { id: company }, data: { isActive: false } });
});
test('transaction resolver rejects a source moved after preflight', async () => {
  const snapshot = await snapshots.forUser(actor);
  const decision = await ACCESS_BOUNDARIES.get('ProductsController.reserve')!({ user: { id: actor, access: snapshot }, params: { id: productA }, query: {}, body: {} }, snapshot, 'products.update');
  if (decision.kind !== 'resource' || !decision.execute) throw new Error('Expected executor');
  await db.product.update({ where: { id: productA }, data: { branchId: branchC } });
  const handler = jest.fn();
  await expect(decision.execute(handler)).rejects.toThrow();
  expect(handler).not.toHaveBeenCalled();
  await db.product.update({ where: { id: productA }, data: { branchId: branchA } });
});
test('nested pricing transaction joins outer authorization transaction and rolls back', async () => {
  const resources = app.get(AccessResourceService);
  const before = await db.productPrice.count({ where: { productId: productA } });
  await expect(resources.execute(actor, 'products.update', 'SHOP', async tx => ({ company: 'SHOP', resources: [await resources.product(tx, productA)], productIds: [productA] }), async () => {
    await app.get(ProductsPricingService).addPrice(productA, { label: 'rolled back', amount: 22222 });
    throw new Error('rollback nested transaction');
  }, false)).rejects.toThrow('rollback nested transaction');
  expect(await db.productPrice.count({ where: { productId: productA } })).toBe(before);
});
test('shared template editing requires permission-specific COMPANY grants in both companies', async () => {
  const template = await db.inspectionTemplate.create({ data: { name: 'Shared definition', deviceType: 'PHONE' } });
  const shop = await grant(['inspections.update'], [], 'SHOP', 'COMPANY');
  await patch(`/inspection-templates/${template.id}`).send({ name: 'Must not change' }).expect(403);
  const finance = await grant(['inspections.update'], [], 'FINANCE', 'COMPANY');
  await patch(`/inspection-templates/${template.id}`).send({ name: 'Authorized shared edit' }).expect(200);
  await db.accessPosition.updateMany({ where: { id: { in: [shop, finance] } }, data: { isActive: false } });
});
test('company-owned template cannot be applied to another company product', async () => {
  const template = await db.inspectionTemplate.create({ data: { name: 'Finance only', deviceType: 'PHONE', accessCompanyCode: 'FINANCE' } });
  await post('/inspections').send({ productId: productA, templateId: template.id }).expect(403);
});

test('product mutation adapters preserve create/update/pricing/photo/status/bulk/delete behavior', async () => {
  const authority = await grant(['products.cost.update', 'pricing.update'], [branchA]);
  const created = await post('/products').send({ name: 'Working phone', brand: 'Apple', model: 'Fixture', category: 'PHONE_USED', branchId: branchA, costPrice: 1000, cashPrice: 2000, status: 'PHOTO_PENDING' }).expect(201);
  const id = created.body.id;
  await get(`/products/${id}/readiness`).expect(200);
  await get(`/products/${id}/workflow`).expect(200);
  await patch(`/products/${id}`).send({ name: 'Updated phone' }).expect(200);
  await patch(`/products/${id}/online-listing`).send({ isOnlineVisible: false }).expect(200);
  for (const angle of ['front', 'back', 'left', 'right', 'top', 'bottom']) await post(`/products/${id}/photos/upload`).send({ angle, photo: 'data:image/png;base64,aGVsbG8=' }).expect(201);
  await post(`/products/${id}/online-listing/photos`).send({ source: 'ANGLE', angle: 'front' }).expect(201);
  await request(app.getHttpServer()).delete(`/products/${id}/photos/back`).set('x-test-user', actor).expect(200);
  await post(`/products/${id}/photos/upload`).send({ angle: 'back', photo: 'data:image/png;base64,aGVsbG8=' }).expect(201);
  await post(`/products/${id}/photos/complete`).send({}).expect(201);
  const price = await post(`/products/${id}/prices`).send({ label: 'Special', amount: 2200 }).expect(201);
  await patch(`/products/${id}/prices/${price.body.id}`).send({ amount: 2300 }).expect(200);
  await request(app.getHttpServer()).delete(`/products/${id}/prices/${price.body.id}`).set('x-test-user', actor).expect(200);
  await post('/products/online-listing/bulk-visibility').send({ scope: 'SELECTED', productIds: [id], isOnlineVisible: true }).expect(201);
  await db.product.update({ where: { id }, data: { status: 'REFURBISHED' } });
  await post(`/products/${id}/return-to-stock`).send({ cashPrice: 2000 }).expect(201);
  await request(app.getHttpServer()).delete(`/products/${id}`).set('x-test-user', actor).expect(200);
  await db.accessPosition.update({ where: { id: authority }, data: { isActive: false } });
});
test('bulk transfer/read/reject adapters execute their real workflow', async () => {
  const product = await createProduct(branchA);
  await post('/products/bulk-transfer').send({ productIds: [product.id], toBranchId: branchB }).expect(201);
  const transfer = await db.stockTransfer.findFirstOrThrow({ where: { productId: product.id } });
  await get(`/products/transfers/${transfer.id}`).expect(200);
  const receiver = await grant(['stock-transfers.approve'], [branchB]);
  await post(`/products/transfers/${transfer.id}/reject`).send({ reason: 'Fixture rejection' }).expect(201);
  await db.accessPosition.update({ where: { id: receiver }, data: { isActive: false } });
});
test('template item and inspection result adapters execute without opening other scopes', async () => {
  const sendOwner = (method: string, path: string, body: any = {}) => (request(app.getHttpServer()) as any)[method](path).set('x-test-user', owner).send(body);
  const template = await sendOwner('post', '/inspection-templates', { name: 'Owned reference', deviceType: 'PHONE' }).expect(201);
  const templateId = template.body.id;
  const item = await sendOwner('post', `/inspection-templates/${templateId}/items`, { category: 'Screen', itemName: 'Working', scoreType: 'PASS_FAIL', weight: 1 }).expect(201);
  await sendOwner('patch', `/inspection-templates/${templateId}/items/${item.body.id}`, { itemName: 'Working screen' }).expect(200);
  const product = await createProduct(branchA);
  const inspection = await post('/inspections').send({ productId: product.id, templateId }).expect(201);
  const otherTemplate = await db.inspectionTemplate.create({ data: { name: 'Foreign company', deviceType: 'PHONE', accessCompanyCode: 'FINANCE' } });
  const foreignItem = await db.inspectionTemplateItem.create({ data: { templateId: otherTemplate.id, category: 'Hidden', itemName: 'Foreign item', scoreType: 'PASS_FAIL' } });
  await patch(`/inspections/${inspection.body.id}`).send({ results: [{ templateItemId: foreignItem.id, passFail: true }] }).expect(403);
  await patch(`/inspections/${inspection.body.id}`).send({ results: [{ templateItemId: item.body.id, passFail: true }] }).expect(200);
  await post(`/inspections/${inspection.body.id}/complete`).send({}).expect(201);
  await patch(`/inspections/${inspection.body.id}/override-grade`).send({ grade: 'B', reason: 'Fixture' }).expect(200);
  await sendOwner('delete', `/inspection-templates/${templateId}/items/${item.body.id}`).expect(200);
  await sendOwner('delete', `/inspection-templates/${templateId}`).expect(200);
});
test('accessory grouping, group drilldown and last-cost SQL cannot include another branch', async () => {
  const label = `Scoped accessory ${suffix}`;
  await createProduct(branchA, { name: label, category: 'ACCESSORY', model: 'Accessory', costPrice: 100 });
  await createProduct(branchA, { name: label, category: 'ACCESSORY', model: 'Accessory', costPrice: 200 });
  await createProduct(branchC, { name: label, category: 'ACCESSORY', model: 'Accessory', costPrice: 999999 });
  const grouped = await get(`/products?groupAccessories=true&search=${encodeURIComponent(label)}`).expect(200);
  expect(grouped.body.total).toBe(1);
  expect(grouped.body.data[0].stockGroup.unitCount).toBe(2);
  expect(Number(grouped.body.data[0].stockGroup.costPriceMax)).toBe(200);
  const key = grouped.body.data[0].stockGroup.key;
  const units = await get(`/products?accessoryGroupId=${key}`).expect(200);
  expect(units.body.total).toBe(2);
  expect(units.body.data.every((row: any) => row.branchId === branchA)).toBe(true);
  const skus = await get(`/products/accessory-skus?search=${encodeURIComponent(label)}`).expect(200);
  expect(skus.body.data[0].inStock).toBe(2);
  // Mixed read scope means the aggregate last cost is conservatively hidden.
  expect(skus.body.data[0].lastCost).toBeNull();
});
test('empty bulk selection executes no unscoped mutation and preserves zero-result response', async () => {
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const empty = await db.branch.create({ data: { name: 'Empty branch', companyId: shop.id } });
  const access = await grant(['products.update'], [empty.id]);
  await db.accessPosition.update({ where: { id: managerPosition }, data: { isActive: false } });
  const before = await db.product.count({ where: { isOnlineVisible: true } });
  const result = await post('/products/online-listing/bulk-visibility').send({ scope: 'ALL_IN_STOCK', isOnlineVisible: false }).expect(201);
  expect(result.body.matched).toBe(0);
  expect(await db.product.count({ where: { isOnlineVisible: true } })).toBe(before);
  await db.accessPosition.update({ where: { id: managerPosition }, data: { isActive: true } });
  await db.accessPosition.update({ where: { id: access }, data: { isActive: false } });
});
test('owner collection executors also honor requested persisted company', async () => {
  const list = await request(app.getHttpServer()).get('/products?company=SHOP').set('x-test-user', owner).expect(200);
  expect(list.body.data.some((row: any) => row.id === financeProduct)).toBe(false);
  const grouped = await request(app.getHttpServer()).get('/products?company=FINANCE&groupAccessories=true').set('x-test-user', owner).expect(200);
  expect(grouped.body.total).toBe(1);
  expect(grouped.body.data[0].id).toBe(financeProduct);
});
test('all 49 adapters have successful real HTTP execution and deny a no-grants principal', async () => {
  expect([...ACCESS_BOUNDARIES.keys()].filter(route => !succeeded.has(route))).toEqual([]);
  const noGrants = await db.user.create({ data: { name: 'No grants', email: `${suffix}-none@test.invalid`, password: 'unused', role: 'SALES', accessManaged: true } });
  for (const route of ACCESS_BOUNDARIES.keys()) {
    const example = succeeded.get(route)!;
    await (request(app.getHttpServer()) as any)[example.method](example.path).set('x-test-user', noGrants.id).send(example.body).expect(403);
  }
});
