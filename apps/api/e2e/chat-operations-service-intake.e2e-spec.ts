import { ChatWorkQueryService } from '../src/modules/staff-chat/services/chat-work-query.service';
import { randomUUID } from 'node:crypto';
import type { ChatWorkActor } from '@installment/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChatWorkAccessService } from '../src/modules/staff-chat/services/chat-work-access.service';
import { StaffInboxService } from '../src/modules/staff-chat/services/staff-inbox.service';
import { ChatFollowUpService } from '../src/modules/staff-chat/services/chat-follow-up.service';
import { ChatServiceRequestService } from '../src/modules/staff-chat/services/chat-service-request.service';
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.'))
  throw new Error('Use disposable harness');
describe('Chat service intake without physical receipt', () => {
  const db = new PrismaService();
  const access = new ChatWorkAccessService(db);
  const tasks = new ChatFollowUpService(db, access, new StaffInboxService(db, access));
  const service = new ChatServiceRequestService(db, access, tasks);
  let actor: ChatWorkActor;
  let foreign: ChatWorkActor;
  let roomId: string;
  const scope = { company: 'SHOP' as const };
  const input = () => ({
    clientRequestId: randomUUID(),
    symptom: 'หน้าจอสัมผัสไม่ตอบสนองบางครั้ง',
    assigneeId: actor.id,
    dueAt: '2026-10-07T10:00:00+07:00',
  });
  beforeAll(async () => {
    await db.$connect();
    const branch = await db.branch.create({ data: { name: 'Service intake test' } });
    const staff = (role: 'OWNER' | 'SALES') =>
      db.user.create({
        data: {
          name: role,
          role,
          branchId: branch.id,
          email: `${randomUUID()}@test.invalid`,
          password: 'unused',
          accessibleCompanies: ['SHOP'],
        },
      });
    actor = await staff('OWNER');
    foreign = await staff('SALES');
    roomId = (await db.chatRoom.create({ data: { channel: 'FACEBOOK', assignedToId: actor.id } }))
      .id;
    await db.systemConfig.upsert({
      where: { key: 'chat_service_requests_enabled' },
      create: { key: 'chat_service_requests_enabled', value: 'true' },
      update: { value: 'true', deletedAt: null },
    });
  });
  afterAll(() => db.$disconnect());
  const receipts = () =>
    Promise.all([
      db.afterSalesCase.count(),
      db.repairTicket.count(),
      db.expenseDocument.count(),
      db.otherIncome.count(),
    ]);
  it('creates exactly one request + canonical task on concurrent retry without any case/accounting effects', async () => {
    const before = await receipts();
    const customerCount = await db.customer.count();
    const draft = input();
    const rows = await Promise.all(
      Array.from({ length: 8 }, () => service.create(roomId, draft, actor, scope)),
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    const row = rows[0];
    expect(row.customerId).toBeNull();
    expect(row.afterSalesCaseId).toBeNull();
    expect(row.todo.workKind).toBe('CHAT_SERVICE');
    expect(row.todo.assigneeId).toBe(actor.id);
    expect(row.todo.dueDate?.toISOString()).toBe('2026-10-07T03:00:00.000Z');
    expect(
      await db.chatServiceRequestEvent.count({ where: { requestId: row.id, kind: 'CREATE' } }),
    ).toBe(1);
    expect(await receipts()).toEqual(before);
    expect(await db.customer.count()).toBe(customerCount);
    await expect(
      service.create(roomId, { ...draft, symptom: 'เปลี่ยนเนื้อหาคำขอเดิม' }, actor, scope),
    ).rejects.toThrow();
  });
  it('projects each service task once and resolves queue and legacy notices to the exact intake', async () => {
    const row = await service.create(roomId, input(), actor, scope);
    const queue = new ChatWorkQueryService(db, access);
    const result = await queue.list(actor, { ...scope, view: 'FOR_ME', page: 1, limit: 100 });
    const items = result.data.filter((i) => i.targetId === row.id || i.targetId === row.todoId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'SERVICE_REQUEST',
      targetType: 'SERVICE_REQUEST',
      targetId: row.id,
    });
    expect(await queue.target(actor, scope, 'SERVICE_REQUEST', row.id)).toMatchObject({
      targetId: row.id,
      roomId,
    });
    expect(await queue.target(actor, scope, 'TODO', row.todoId)).toMatchObject({
      targetType: 'SERVICE_REQUEST',
      targetId: row.id,
    });
    const notices = await new StaffInboxService(db, access).list(actor, scope, 1, 100);
    expect(notices.data.filter((i) => i.todoId === row.todoId)[0]).toMatchObject({
      targetType: 'SERVICE_REQUEST',
      targetId: row.id,
    });
    await expect(queue.target(foreign, scope, 'SERVICE_REQUEST', row.id)).rejects.toThrow();
  });
  it('rejects unauthorized rooms, cross-room/deleted evidence and unlinked device/customer references', async () => {
    await expect(service.create(roomId, input(), foreign, scope)).rejects.toThrow();
    await expect(service.create(roomId, input(), actor, { company: 'FINANCE' })).rejects.toThrow();
    const otherRoom = await db.chatRoom.create({ data: { channel: 'FACEBOOK' } });
    const message = await db.chatMessage.create({
      data: { roomId: otherRoom.id, role: 'CUSTOMER', text: 'ข้อมูลจากห้องอื่น' },
    });
    await expect(
      service.create(roomId, { ...input(), sourceMessageIds: [message.id] }, actor, scope),
    ).rejects.toThrow();
    await expect(
      service.create(roomId, { ...input(), productId: randomUUID() }, actor, scope),
    ).rejects.toThrow();
    const deleted = await db.chatMessage.create({
      data: { roomId, role: 'CUSTOMER', text: 'ถูกลบ', deletedAt: new Date() },
    });
    await expect(
      service.create(roomId, { ...input(), sourceMessageIds: [deleted.id] }, actor, scope),
    ).rejects.toThrow();
  });
  it('keeps evidence as scoped message references and hides it after deletion', async () => {
    const message = await db.chatMessage.create({
      data: { roomId, role: 'CUSTOMER', text: 'รายละเอียดอาการ' },
    });
    const row = await service.create(
      roomId,
      { ...input(), sourceMessageIds: [message.id] },
      actor,
      scope,
    );
    expect((await service.get(row.id, actor, scope)).sourceMessages.map((m) => m.id)).toEqual([
      message.id,
    ]);
    await db.chatMessage.update({ where: { id: message.id }, data: { deletedAt: new Date() } });
    expect((await service.get(row.id, actor, scope)).sourceMessages).toEqual([]);
  });
  it('uses request CAS and canonical task history, waiting remains active, closing requires a reason', async () => {
    const row = await service.create(roomId, input(), actor, scope);
    const waiting = await service.update(
      row.id,
      { expectedRevision: 0, status: 'WAITING_CUSTOMER', dueAt: '2026-10-08T11:00:00+07:00' },
      actor,
      scope,
    );
    expect(waiting.todo.status).toBe('TODO');
    expect(waiting.todo.dueRevision).toBe(1);
    await expect(
      service.update(row.id, { expectedRevision: 0, symptom: 'ผู้แก้ไขอีกคน' }, actor, scope),
    ).rejects.toThrow();
    await expect(
      service.update(row.id, { expectedRevision: 1, status: 'RESOLVED' }, actor, scope),
    ).rejects.toThrow();
    const done = await service.update(
      row.id,
      {
        expectedRevision: 1,
        status: 'RESOLVED',
        reason: 'แนะนำวิธีใช้งานและลูกค้ายืนยันว่าใช้ได้',
      },
      actor,
      scope,
    );
    expect(done.todo.status).toBe('DONE');
    expect(done.status).toBe('RESOLVED');
    await expect(
      service.update(row.id, { expectedRevision: 2, status: 'OPEN' }, actor, scope),
    ).rejects.toThrow();
    const event = await db.chatServiceRequestEvent.findFirstOrThrow({
      where: { requestId: row.id },
    });
    await expect(
      db.chatServiceRequestEvent.update({ where: { id: event.id }, data: { kind: 'REWRITE' } }),
    ).rejects.toThrow();
  });
  it('rolls back task, inbox and request when event insert fails', async () => {
    const before = await db.todo.count();
    const notices = await db.staffInboxItem.count();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION fail_service_intake() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic intake failure'; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER fail_service_intake BEFORE INSERT ON chat_service_request_events FOR EACH ROW EXECUTE FUNCTION fail_service_intake()`,
    );
    try {
      await expect(service.create(roomId, input(), actor, scope)).rejects.toThrow(
        'synthetic intake failure',
      );
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER fail_service_intake ON chat_service_request_events');
      await db.$executeRawUnsafe('DROP FUNCTION fail_service_intake()');
    }
    expect(await db.todo.count()).toBe(before);
    expect(await db.staffInboxItem.count()).toBe(notices);
  });
  it('requires an explicit device choice and validates customer and branch evidence', async () => {
    const customer = await db.customer.create({ data: { name: 'Service device customer' } });
    const alias = await db.customer.create({
      data: { name: 'Merged service customer', mergedIntoId: customer.id, deletedAt: new Date() },
    });
    const outsider = await db.customer.create({ data: { name: 'Someone else' } });
    const r = await db.chatRoom.create({
      data: { channel: 'FACEBOOK', customerId: customer.id, assignedToId: actor.id },
    });
    const product = () =>
      db.product.create({
        data: {
          name: 'Service device',
          brand: 'Apple',
          model: 'iPhone 15',
          category: 'PHONE_USED',
          branchId: actor.branchId!,
          costPrice: 5000,
        },
      });
    const [a, b, c] = await Promise.all([product(), product(), product()]);
    const sale = (customerId: string, productId: string, branchId = actor.branchId!) =>
      db.sale.create({
        data: {
          saleNumber: `service-${randomUUID()}`,
          customerId,
          productId,
          branchId,
          salespersonId: actor.id,
          saleType: 'CASH',
          sellingPrice: 9900,
          netAmount: 9900,
        },
      });
    const first = await sale(alias.id, a.id);
    await sale(customer.id, b.id);
    const wrong = await sale(outsider.id, c.id);
    const choices = await service.intakeOptions(r.id, actor, {
      ...scope,
      kind: 'SALE',
      search: first.saleNumber,
      page: 1,
      limit: 10,
    });
    expect(choices.data.map((x) => x.id)).toEqual([first.id]);
    await expect(
      service.intakeOptions(r.id, foreign, { ...scope, kind: 'SALE', page: 1, limit: 10 }),
    ).rejects.toThrow();
    const noChoice = await service.create(r.id, input(), actor, scope);
    expect(noChoice.requestedProductId).toBeNull();
    expect(noChoice.saleId).toBeNull();
    const explicit = await service.create(
      r.id,
      { ...input(), productId: a.id, saleId: first.id },
      actor,
      scope,
    );
    expect(explicit.customerId).toBe(customer.id);
    expect(explicit.requestedProductId).toBe(a.id);
    expect((await db.sale.findUniqueOrThrow({ where: { id: first.id } })).customerId).toBe(
      alias.id,
    );
    await expect(
      service.create(r.id, { ...input(), productId: b.id, saleId: first.id }, actor, scope),
    ).rejects.toThrow();
    await expect(
      service.create(r.id, { ...input(), saleId: wrong.id }, actor, scope),
    ).rejects.toThrow();
    const otherBranch = await db.branch.create({ data: { name: 'Other service branch' } });
    const elsewhere = await sale(customer.id, a.id, otherBranch.id);
    await expect(
      service.create(r.id, { ...input(), saleId: elsewhere.id }, actor, {
        ...scope,
        branchId: actor.branchId!,
      }),
    ).rejects.toThrow();
  });

  it('rejects a FINANCE sale from SHOP intake and rejects generic task completion', async () => {
    const company = await db.companyInfo.upsert({
      where: { companyCode: 'FINANCE' },
      create: {
        companyCode: 'FINANCE',
        nameTh: 'Finance test',
        taxId: '0000000000000',
        address: 'Test',
        directorName: 'Test',
      },
      update: {},
    });
    const branch = await db.branch.create({
      data: { name: 'Finance service evidence', companyId: company.id },
    });
    const customer = await db.customer.create({ data: { name: 'Customer with finance sale' } });
    const product = await db.product.create({
      data: {
        name: 'Finance device',
        brand: 'Apple',
        model: 'Phone',
        category: 'PHONE_USED',
        branchId: branch.id,
        costPrice: 5000,
      },
    });
    const sale = await db.sale.create({
      data: {
        saleNumber: `service-finance-${randomUUID()}`,
        customerId: customer.id,
        productId: product.id,
        branchId: branch.id,
        salespersonId: actor.id,
        saleType: 'CASH',
        sellingPrice: 9900,
        netAmount: 9900,
      },
    });
    const room = await db.chatRoom.create({
      data: { channel: 'FACEBOOK', customerId: customer.id, assignedToId: actor.id },
    });
    await expect(
      service.create(room.id, { ...input(), saleId: sale.id }, actor, scope),
    ).rejects.toThrow();
    const row = await service.create(roomId, input(), actor, scope);
    await expect(
      tasks.updateLegacy(row.todo, { expectedRevision: 0, status: 'DONE' }, actor.id, 'SHOP'),
    ).rejects.toThrow();
    const cancelled = await service.update(
      row.id,
      { expectedRevision: 0, status: 'CANCELLED', reason: 'ลูกค้ายกเลิกการติดตาม' },
      actor,
      scope,
    );
    expect(cancelled.todo.status).toBe('CANCELLED');
  });
});
