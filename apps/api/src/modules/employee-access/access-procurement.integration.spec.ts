import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PERMISSION_CATALOG, PermissionKey } from '@installment/shared';
import { seedShopCoa } from '../../../prisma/seed-coa-shop';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessResourceService } from './access-resource.service';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessProcurementProjectionService } from './access-procurement-projection.service';
import { AccessProcurementBoundaries, PROCUREMENT_BOUNDARY_ROUTES } from './access-procurement-boundaries';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { PurchaseOrdersController } from '../purchase-orders/purchase-orders.controller';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { SuppliersController } from '../suppliers/suppliers.controller';
import { SuppliersService } from '../suppliers/suppliers.service';
import { ContactResolverService } from '../contacts/contact-resolver.service';
import { GoodsReceivingTaxInvoiceService } from '../purchase-orders/services/goods-receiving-tax-invoice.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { ShopGoodsReceivingTemplate } from '../journal/cpa-templates/shop-goods-receiving.template';
import { ShopSupplierPaymentTemplate } from '../journal/cpa-templates/shop-supplier-payment.template';
import { InstallmentInputVatTemplate } from '../journal/cpa-templates/installment-input-vat.template';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';

const url = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;
if (!url?.includes('/bc_access_task2?host=/tmp/bc-access-')) throw new Error('Explicit isolated URL required');
const db = new PrismaClient({ datasources: { db: { url } } });
const prisma = db as PrismaService;
const snapshots = new AccessSnapshotService(prisma);
const journal = new JournalAutoService(prisma);
const companies = new CompanyResolverService(prisma);
const accounts = new ShopAccountResolver(prisma);
const receivingTemplate = new ShopGoodsReceivingTemplate(journal, prisma, companies);
const paymentTemplate = new ShopSupplierPaymentTemplate(journal, prisma, companies);
const vatTemplate = new InstallmentInputVatTemplate(journal, prisma, companies);
const audit = new AuditService(prisma);
const suffix = randomUUID();
const storage = { upload: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined), getSignedDownloadUrl: jest.fn(async (key: string) => key) };
const successes = new Map<string, { method: string; path: string; body: unknown }>();
let app: INestApplication, actor: string, owner: string, denied: string, stock: string, branchA: string, branchB: string, supplierA: string, supplierB: string;
const today = new Date().toISOString().slice(0, 10);
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
const poBody = (supplierId = supplierA) => ({ supplierId, accessBranchId: branchA, orderDate: today, items: [{ category: 'ACCESSORY', accessoryType: 'Cable', brand: 'Apple', model: 'Fixture', quantity: 1, unitPrice: 100 }], paymentMethod: 'BANK_TRANSFER' });
async function createPo() { return (await post('/purchase-orders', poBody()).expect(201)).body; }
async function receive(po: { id: string; items: Array<{ id: string }> }, id = actor) { return post(`/purchase-orders/${po.id}/goods-receiving`, { supplierDocType: 'DELIVERY_NOTE', supplierDocNumber: randomUUID(), supplierDocDate: today, items: [{ poItemId: po.items[0].id, status: 'PASS' }] }, id).expect(201); }

beforeAll(async () => {
  for (const companyCode of ['SHOP', 'FINANCE']) await db.companyInfo.upsert({ where: { companyCode }, create: { companyCode, nameTh: 'Fixture', taxId: 'TEST', address: 'TEST', directorName: 'TEST' }, update: {} });
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  branchA = (await db.branch.create({ data: { name: 'A', companyId: shop.id, isMainWarehouse: true } })).id;
  branchB = (await db.branch.create({ data: { name: 'B', companyId: shop.id } })).id;
  actor = await user(); owner = await user('OWNER'); denied = await user(); stock = await user();
  await grant(actor, PERMISSION_CATALOG.filter(p => !p.ownerOnly && !p.allStaff).map(p => p.key));
  await grant(stock, ['stock-receiving.read', 'stock-receiving.create']);
  await db.user.create({ data: { name: 'Journal fixture', email: 'admin@bestchoice.com', password: 'unused', role: 'OWNER', isSystemUser: true } });
  await seedShopCoa(db); await seedFinanceCoa(db);
  const module = await Test.createTestingModule({
    controllers: [PurchaseOrdersController, SuppliersController],
    providers: [AccessResourceService, AccessProcurementSourceService, AccessProcurementProjectionService, AccessProcurementBoundaries, AccessPolicyService, RolesGuard, BranchGuard,
      { provide: PrismaService, useValue: db }, { provide: AccessSnapshotService, useValue: snapshots },
      { provide: PurchaseOrdersService, useValue: new PurchaseOrdersService(prisma, receivingTemplate, accounts, companies, paymentTemplate) },
      { provide: SuppliersService, useValue: new SuppliersService(prisma, new ContactResolverService(prisma)) },
      { provide: GoodsReceivingTaxInvoiceService, useValue: new GoodsReceivingTaxInvoiceService(prisma, vatTemplate, storage as unknown as StorageService, audit) },
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
  supplierA = (await post('/suppliers', { name: 'Supplier A', phone: '020000001', hasVat: true, accessBranchId: branchA, paymentMethods: [{ paymentMethod: 'BANK_TRANSFER', bankName: 'Fixture bank', bankAccountNumber: '1234567890', isDefault: true }] }).expect(201)).body.id;
  supplierB = (await db.supplier.create({ data: { name: 'Supplier B', phone: '020000002', accessCompanyCode: 'SHOP', accessBranchId: branchB } })).id;
}, 60000);
afterAll(async () => { ACCESS_BOUNDARIES.clear(); await app?.close(); await db.$disconnect(); });

test('real HTTP origins scope rows and counts before pagination; historical unresolvable rows deny', async () => {
  const a = await createPo();
  await db.purchaseOrder.create({ data: { poNumber: randomUUID(), supplierId: supplierB, createdById: owner, orderDate: new Date(), totalAmount: 100, accessCompanyCode: 'SHOP', accessBranchId: branchB } });
  const legacy = await db.purchaseOrder.create({ data: { poNumber: randomUUID(), supplierId: supplierA, createdById: actor, orderDate: new Date(), totalAmount: 100 } });
  const list = await get('/purchase-orders?limit=1').expect(200);
  expect(list.body.total).toBe(1); expect(list.body.data[0].id).toBe(a.id);
  await get(`/purchase-orders/${legacy.id}`).expect(403);
  expect((await get('/suppliers?limit=1').expect(200)).body.total).toBe(1);
  await get(`/suppliers/${supplierB}`).expect(403);
  await get('/purchase-orders?company=FINANCE').expect(403);
  await post('/purchase-orders', { ...poBody(), accessBranchId: branchB }).expect(403);
  await post('/purchase-orders', { ...poBody(), accessBranchId: undefined }).expect(403);
});

test('stock-only employee receives approved quantities without reading or overriding costs; actual JE posts', async () => {
  const po = await createPo();
  await post(`/purchase-orders/${po.id}/approve`, {}).expect(201);
  await post(`/purchase-orders/${po.id}/goods-receiving`, { supplierDocType: 'NONE', notes: 'Fixture', items: [{ poItemId: po.items[0].id, status: 'PASS', costPrice: 1 }] }, stock).expect(403);
  const response = await receive(po, stock);
  const product = await db.product.findFirstOrThrow({ where: { poId: po.id } });
  expect(Number(product.costPrice)).toBeGreaterThan(100);
  const gr = await db.goodsReceiving.findFirstOrThrow({ where: { poId: po.id }, include: { items: true } });
  expect(gr.items[0].journalEntryId).not.toBeNull();
  const detail = await get(`/purchase-orders/${po.id}/goods-receivings/${gr.id}`, stock).expect(200);
  expect(detail.body.items[0].receivedCost).toBeNull();
  const resources = app.get(AccessResourceService), projection = app.get(AccessProcurementProjectionService);
  const projected = await resources.execute(stock, 'stock-receiving.read', 'SHOP', undefined, () => projection.receivingItem(gr.items[0].id));
  expect(projected.result).toMatchObject({ id: gr.items[0].id, receivedCost: null, poItem: { unitPrice: null } });
  const productOnly = await user(); await grant(productOnly, ['products.read']);
  expect((await resources.execute(productOnly, 'products.read', 'SHOP', undefined, () => projection.receivingItem(gr.items[0].id))).result).toBeNull();
  expect(response.body).toBeDefined();
  await get(`/purchase-orders/${po.id}`, stock).expect(403);
  await post(`/purchase-orders/${po.id}/goods-receivings/${gr.id}/tax-invoice`, { number: randomUUID(), date: today }).expect(201);
});

test('historical PO provenance permits complete product joins and denies unresolved receipt sources', async () => {
  const po = await createPo();
  await post(`/purchase-orders/${po.id}/approve`, {}).expect(201);
  await receive(po);
  await db.purchaseOrder.update({ where: { id: po.id }, data: { accessCompanyCode: null, accessBranchId: null } });
  await get(`/purchase-orders/${po.id}`).expect(200);
  const gr = await db.goodsReceiving.findFirstOrThrow({ where: { poId: po.id } });
  await db.goodsReceivingItem.create({ data: { receivingId: gr.id, poItemId: po.items[0].id, status: 'REJECT', rejectReason: 'Unknown historical source' } });
  await get(`/purchase-orders/${po.id}`).expect(403);
  const page = await get('/purchase-orders?limit=200').expect(200);
  expect(page.body.data.some((row: { id: string }) => row.id === po.id)).toBe(false);
  expect(page.body.total).toBe(page.body.data.length);
});

test('all32 routes execute their actual authorized workflow, including retained retired-payment410', async () => {
  const po = await createPo();
  await http('patch', `/purchase-orders/${po.id}`, { notes: 'Updated' }).expect(200);
  await get(`/purchase-orders/${po.id}`).expect(200);
  await post(`/purchase-orders/${po.id}/approve`, {}).expect(201);
  await receive(po);
  const gr = await db.goodsReceiving.findFirstOrThrow({ where: { poId: po.id } });
  for (const path of ['/purchase-orders', '/purchase-orders/accounts-payable', '/purchase-orders/summary', '/purchase-orders/qc-pending', `/purchase-orders/receiving-doc-check?supplierId=${supplierA}`, '/purchase-orders/payables/ledger', `/purchase-orders/payables/ledger/${supplierA}`, `/purchase-orders/${po.id}/goods-receivings`, `/purchase-orders/${po.id}/goods-receivings/summary`, `/purchase-orders/${po.id}/goods-receivings/${gr.id}`, `/purchase-orders/${po.id}/payments`, '/suppliers', `/suppliers/${supplierA}`, `/suppliers/${supplierA}/purchase-history`]) await get(path).expect(200);
  const payment = await post(`/purchase-orders/${po.id}/payments`, { amount: 10, paidAt: today, slipUrl: 'fixture://slip', requestId: randomUUID() }).expect(201);
  const paymentRow = await db.purchaseOrderPayment.findFirstOrThrow({ where: { poId: po.id, kind: 'SETTLEMENT' } });
  expect(payment.body).toBeDefined();
  await post(`/purchase-orders/${po.id}/payments/${paymentRow.id}/void`, { reason: 'Fixture' }, owner).expect(201);
  await http('patch', `/purchase-orders/${po.id}/payment`, { paidAmount: 1, paymentStatus: 'PARTIALLY_PAID' }).expect(410);
  const ordered = await createPo(); await db.purchaseOrder.update({ where: { id: ordered.id }, data: { status: 'APPROVED' } });
  await post(`/purchase-orders/${ordered.id}/order`, {}).expect(201);
  await post(`/purchase-orders/${ordered.id}/cancel`, {}).expect(201);
  const rejected = await createPo(); await post(`/purchase-orders/${rejected.id}/reject`, { reason: 'Fixture' }).expect(201);
  const direct = await post('/purchase-orders/direct-receive', { ...poBody(), supplierDocType: 'NONE', notes: 'Fixture', items: [{ ...poBody().items[0], status: 'PASS' }] }).expect(201);
  expect(direct.body.poNumber).toBeTruthy();
  const qc = await db.product.create({ data: { name: 'QC fixture', brand: 'Apple', model: 'Fixture', category: 'PHONE_USED', branchId: branchA, costPrice: 100, status: 'PHOTO_PENDING', supplierId: supplierA } });
  await post('/purchase-orders/qc-reject', { productIds: [qc.id], reason: 'Fixture' }).expect(201);
  // Separate party without unresolved legacy PO for mutation invariants.
  const mutable = (await post('/suppliers', { name: 'Mutable', phone: '020000003', accessBranchId: branchA }).expect(201)).body.id;
  await http('patch', `/suppliers/${mutable}`, { name: 'Changed' }).expect(200);
  await http('patch', `/suppliers/${mutable}/repair-center`, {}).expect(200);
  await http('delete', `/suppliers/${mutable}`).expect(200);
});

test('real source-scoped supplier ledger excludes another origin even when its stock is in the visible warehouse', async () => {
  const hidden = (await post('/purchase-orders', { ...poBody(supplierB), accessBranchId: branchB }, owner).expect(201)).body;
  await receive(hidden, owner);
  const ledger = await get('/purchase-orders/payables/ledger').expect(200);
  expect(JSON.stringify(ledger.body)).not.toContain(supplierB);
  expect(JSON.stringify(ledger.body)).not.toContain(hidden.poNumber);
  await get(`/purchase-orders/${hidden.id}/payments`).expect(403);
  expect((await get(`/purchase-orders/payables/ledger/${supplierB}`).expect(200)).body.rows).toEqual([]);
  const history = await get(`/suppliers/${supplierA}/purchase-history?limit=1`).expect(200);
  expect(history.body.purchaseOrders.total).toBeGreaterThan(0);
  expect(history.body.products.total).toBeGreaterThan(0);
  await get('/purchase-orders?limit=-1').expect(400);
  await get('/purchase-orders?status=INVALID').expect(400);
  await get('/suppliers?search[x]=bad').expect(400);
});

test('receiving and payment service writes, journals and quantity changes roll back with the outer authorization transaction', async () => {
  const po = await createPo();
  await post(`/purchase-orders/${po.id}/approve`, {}).expect(201);
  const resources = app.get(AccessResourceService), sources = app.get(AccessProcurementSourceService), service = app.get(PurchaseOrdersService);
  const beforeJournals = await db.journalEntry.count();
  await expect(resources.execute(actor, 'stock-receiving.create', 'SHOP', async (tx, _snapshot, lock) => ({ ...await sources.po(tx, po.id, 'SHOP', lock), receivingBranchId: branchA }), async () => {
    await service.goodsReceiving(po.id, { supplierDocType: 'NONE', notes: 'Fixture', items: [{ poItemId: po.items[0].id, status: 'PASS' }] }, actor);
    throw new Error('rollback receiving');
  }, false, { domain: 'procurement', isolationLevel: 'Serializable' })).rejects.toThrow('rollback receiving');
  expect(await db.goodsReceiving.count({ where: { poId: po.id } })).toBe(0);
  expect(await db.product.count({ where: { poId: po.id } })).toBe(0);
  expect((await db.pOItem.findUniqueOrThrow({ where: { id: po.items[0].id } })).receivedQty).toBe(0);
  expect(await db.journalEntry.count()).toBe(beforeJournals);
  await receive(po);
  const afterReceive = await db.journalEntry.count();
  await expect(resources.execute(actor, 'supplier-payments.create', 'SHOP', (tx, _snapshot, lock) => sources.po(tx, po.id, 'SHOP', lock), async () => {
    await service.recordSupplierPayment(po.id, { amount: 10, paidAt: today, slipUrl: 'fixture://slip' }, actor);
    throw new Error('rollback payment');
  }, false, { domain: 'procurement', isolationLevel: 'Serializable' })).rejects.toThrow('rollback payment');
  expect(await db.purchaseOrderPayment.count({ where: { poId: po.id } })).toBe(0);
  expect(await db.journalEntry.count()).toBe(afterReceive);
  expect(Number((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).paidAmount)).toBe(0);
});

test('staged tax-invoice upload is outside the lock, survives retry, and cleans only terminal failure with atomic audit', async () => {
  const po = await createPo(); await post(`/purchase-orders/${po.id}/approve`, {}).expect(201); await receive(po);
  const gr = await db.goodsReceiving.findFirstOrThrow({ where: { poId: po.id } });
  const projection = app.get(AccessProcurementProjectionService);
  const project = projection.project.bind(projection);
  const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6upkAAAAASUVORK5CYII=', 'base64');
  storage.upload.mockImplementationOnce(async () => {
    const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM pg_locks WHERE locktype = 'advisory' AND objid = 718294630 AND granted`;
    expect(Number(rows[0].count)).toBe(0);
  });
  const uploadBefore = storage.upload.mock.calls.length, cleanupBefore = storage.delete.mock.calls.length;
  const spy = jest.spyOn(projection, 'project').mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('retry fixture', { code: 'P2034', clientVersion: 'fixture' })).mockImplementation(project);
  await request(app.getHttpServer()).post(`/purchase-orders/${po.id}/goods-receivings/${gr.id}/tax-invoice`).set('x-test-user', actor).field('number', 'RETRY-INVOICE').field('date', today).attach('photo', photo, { filename: 'fixture.png', contentType: 'image/png' }).expect(201);
  expect(storage.upload.mock.calls.length).toBe(uploadBefore + 1);
  expect(storage.delete.mock.calls.length).toBe(cleanupBefore);
  expect((await db.goodsReceiving.findUniqueOrThrow({ where: { id: gr.id } })).taxInvoiceNumber).toBe('RETRY-INVOICE');
  expect(await db.auditLog.count({ where: { entityId: gr.id } })).toBe(1);
  spy.mockRejectedValueOnce(new Error('terminal fixture'));
  await request(app.getHttpServer()).post(`/purchase-orders/${po.id}/goods-receivings/${gr.id}/tax-invoice`).set('x-test-user', actor).field('number', 'FAILED-INVOICE').field('date', today).attach('photo', photo, { filename: 'fixture.png', contentType: 'image/png' }).expect(500);
  expect(storage.delete.mock.calls.length).toBe(cleanupBefore + 1);
  expect((await db.goodsReceiving.findUniqueOrThrow({ where: { id: gr.id } })).taxInvoiceNumber).toBe('RETRY-INVOICE');
  expect(await db.auditLog.count({ where: { entityId: gr.id } })).toBe(1);
  spy.mockRestore();
});

test('independent payment/read/cost grants do not inherit writes and mixed-branch costs remain source scoped', async () => {
  const po = await createPo();
  const reader = await user();
  await grant(reader, ['purchase-orders.read', 'suppliers.read', 'supplier-payments.read']);
  expect((await get(`/purchase-orders/${po.id}`, reader).expect(200)).body.items[0].unitPrice).toBeNull();
  await grant(reader, ['sensitive.cost.read']);
  expect(Number((await get(`/purchase-orders/${po.id}`, reader).expect(200)).body.items[0].unitPrice)).toBe(100);
  await post('/purchase-orders', poBody(), reader).expect(403);
  await post(`/purchase-orders/${po.id}/payments`, { amount: 10, paidAt: today, slipUrl: 'fixture://slip' }, reader).expect(403);
  const costWriter = await user();
  await grant(costWriter, ['purchase-orders.create', 'suppliers.read']);
  await post('/purchase-orders', poBody(), costWriter).expect(403);
  await grant(costWriter, ['products.cost.update']);
  await post('/purchase-orders', poBody(), costWriter).expect(201);
  await post(`/purchase-orders/${po.id}/approve`, {}, costWriter).expect(403);
  const hidden = (await post('/purchase-orders', { ...poBody(supplierB), accessBranchId: branchB }, owner).expect(201)).body;
  await grant(reader, ['purchase-orders.read'], [branchB]);
  expect((await get(`/purchase-orders/${hidden.id}`, reader).expect(200)).body.items[0].unitPrice).toBeNull();
  expect(Number((await get(`/purchase-orders/${po.id}`, reader).expect(200)).body.items[0].unitPrice)).toBe(100);
});

test('explicit FINANCE central and SHOP-origin branches remain distinct from SHOP grants; owners also filter selected company', async () => {
  const financePo = await db.purchaseOrder.create({ data: { poNumber: randomUUID(), supplierId: supplierB, createdById: owner, orderDate: new Date(), totalAmount: 200, accessCompanyCode: 'FINANCE', accessBranchId: branchA } });
  const centralPo = await db.purchaseOrder.create({ data: { poNumber: randomUUID(), supplierId: supplierB, createdById: owner, orderDate: new Date(), totalAmount: 300, accessCompanyCode: 'FINANCE' } });
  const finance = await user();
  const p = await db.accessPosition.create({ data: { code: randomUUID(), name: 'Finance fixture', permissions: ['purchase-orders.read'] } });
  await db.employeeAccessAssignment.create({ data: { userId: finance, positionId: p.id, companyCode: 'FINANCE', scope: 'BRANCHES', branches: { create: { branchId: branchA } } } });
  await get(`/purchase-orders/${financePo.id}?company=FINANCE`, finance).expect(200);
  await get(`/purchase-orders/${centralPo.id}?company=FINANCE`, finance).expect(403);
  await get(`/purchase-orders/${financePo.id}`, finance).expect(403);
  await db.employeeAccessAssignment.create({ data: { userId: finance, positionId: p.id, companyCode: 'FINANCE', scope: 'COMPANY' } });
  await get(`/purchase-orders/${centralPo.id}?company=FINANCE`, finance).expect(200);
  const selected = await get('/purchase-orders?company=FINANCE', owner).expect(200);
  expect(selected.body.total).toBe(2);
  expect(selected.body.data.every((row: { accessCompanyCode: string }) => row.accessCompanyCode === 'FINANCE')).toBe(true);
});

test('stock at the actual pinned warehouse receives an approved central PO without PO or cost grants', async () => {
  const po = (await post('/purchase-orders', { ...poBody(), accessBranchId: undefined }, owner).expect(201)).body;
  await get(`/purchase-orders/${po.id}`, stock).expect(403);
  await receive(po, stock);
  const product = await db.product.findFirstOrThrow({ where: { poId: po.id } });
  expect(product.branchId).toBe(branchA);
  expect(Number(product.costPrice)).toBeGreaterThan(100);
  const otherStock = await user(); await grant(otherStock, ['stock-receiving.create'], [branchB]);
  const other = (await post('/purchase-orders', { ...poBody(), accessBranchId: undefined }, owner).expect(201)).body;
  await post(`/purchase-orders/${other.id}/goods-receiving`, { supplierDocType: 'NONE', notes: 'Fixture', items: [{ poItemId: other.items[0].id, status: 'PASS' }] }, otherStock).expect(403);
});

test('procurement expansions and product counts require independent current product scope', async () => {
  const po = await createPo(); await post(`/purchase-orders/${po.id}/approve`, {}).expect(201); await receive(po);
  const product = await db.product.findFirstOrThrow({ where: { poId: po.id } });
  const gr = await db.goodsReceiving.findFirstOrThrow({ where: { poId: po.id } });
  const reader = await user(); await grant(reader, ['purchase-orders.read', 'stock-receiving.read']);
  const check = async (visible: boolean) => {
    const detail = (await get(`/purchase-orders/${po.id}`, reader).expect(200)).body;
    expect(detail.products.map((row: { id: string }) => row.id)).toEqual(visible ? [product.id] : []);
    expect(detail.items[0].receivingItems[0].product?.id ?? null).toBe(visible ? product.id : null);
    const list = (await get('/purchase-orders?limit=200', reader).expect(200)).body;
    expect(list.data.find((row: { id: string }) => row.id === po.id)._count.products).toBe(visible ? 1 : 0);
    for (const path of [`/purchase-orders/${po.id}/goods-receivings/${gr.id}`, `/purchase-orders/${po.id}/goods-receivings`]) {
      const body = (await get(path, reader).expect(200)).body;
      expect((body.data?.[0] ?? body).items[0].product?.id ?? null).toBe(visible ? product.id : null);
    }
  };
  await check(false);
  await grant(reader, ['products.read']); await check(true);
  await db.product.update({ where: { id: product.id }, data: { branchId: branchB } });
  await check(false);
  await grant(reader, ['products.read'], [branchB]); await check(true);
});

test('supplier relationship reads cannot discard a foreign-company origin for mutations', async () => {
  const po = await createPo(); await post(`/purchase-orders/${po.id}/approve`, {}).expect(201); await receive(po);
  const product = await db.product.findFirstOrThrow({ where: { poId: po.id } });
  const supplier = await db.supplier.create({ data: { name: 'Finance-origin party', phone: '020000099', accessCompanyCode: 'FINANCE', accessBranchId: branchA } });
  await db.product.update({ where: { id: product.id }, data: { supplierId: supplier.id } });
  const editor = await user(); await grant(editor, ['suppliers.read', 'suppliers.update', 'suppliers.delete']);
  await get(`/suppliers/${supplier.id}`, editor).expect(200);
  await http('patch', `/suppliers/${supplier.id}`, { name: 'Unauthorized' }, editor).expect(403);
  await http('patch', `/suppliers/${supplier.id}/repair-center`, {}, editor).expect(403);
  await http('delete', `/suppliers/${supplier.id}`, undefined, editor).expect(403);
  expect(await db.supplier.findUniqueOrThrow({ where: { id: supplier.id } })).toMatchObject({ name: 'Finance-origin party', deletedAt: null, isRepairCenter: false });
  const position = await db.accessPosition.create({ data: { code: randomUUID(), name: 'Finance party edits', permissions: ['suppliers.update', 'suppliers.delete'] } });
  await db.employeeAccessAssignment.create({ data: { userId: editor, positionId: position.id, companyCode: 'FINANCE', scope: 'BRANCHES', branches: { create: { branchId: branchA } } } });
  await http('patch', `/suppliers/${supplier.id}`, { name: 'Authorized both sources' }, editor).expect(200);
  await http('patch', `/suppliers/${supplier.id}/repair-center`, {}, editor).expect(200);
  await http('delete', `/suppliers/${supplier.id}`, undefined, editor).expect(200);
});

test('every enabled route has actual positive evidence then rejects a persisted no-grants employee', async () => {
  expect([...successes.keys()].sort()).toEqual([...PROCUREMENT_BOUNDARY_ROUTES].sort());
  for (const fixture of successes.values()) await http(fixture.method, fixture.path, fixture.body, denied).expect(403);
});
