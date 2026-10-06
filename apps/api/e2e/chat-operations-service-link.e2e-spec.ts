import { ChatWorkQueryService } from '../src/modules/staff-chat/services/chat-work-query.service';
import { AfterSalesCaseService } from '../src/modules/after-sales/services/after-sales-case.service';
import { AfterSalesDocNumberService } from '../src/modules/after-sales/services/after-sales-doc-number.service';
import { randomUUID } from 'node:crypto';
import type { ChatWorkActor } from '@installment/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChatWorkAccessService } from '../src/modules/staff-chat/services/chat-work-access.service';
import { StaffInboxService } from '../src/modules/staff-chat/services/staff-inbox.service';
import { ChatFollowUpService } from '../src/modules/staff-chat/services/chat-follow-up.service';
import { ChatServiceRequestService } from '../src/modules/staff-chat/services/chat-service-request.service';
import { ChatServiceCaseLinkService } from '../src/modules/after-sales/services/chat-service-case-link.service';
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.'))
  throw new Error('Use disposable harness');
describe('Canonical after-sales case linking', () => {
  const db = new PrismaService();
  const access = new ChatWorkAccessService(db);
  const intake = new ChatServiceRequestService(
    db,
    access,
    new ChatFollowUpService(db, access, new StaffInboxService(db, access)),
  );
  const links = new ChatServiceCaseLinkService(db, access);
  let actor: ChatWorkActor;
  let customerId: string;
  let roomId: string;
  let branchId: string;
  const scope = { company: 'SHOP' as const };
  beforeAll(async () => {
    await db.$connect();
    branchId = (await db.branch.create({ data: { name: 'Service link branch' } })).id;
    actor = await db.user.create({
      data: {
        name: 'Service link owner',
        email: `${randomUUID()}@test.invalid`,
        password: 'unused',
        role: 'OWNER',
        branchId,
        accessibleCompanies: ['SHOP'],
      },
    });
    customerId = (await db.customer.create({ data: { name: 'Service link customer' } })).id;
    roomId = (
      await db.chatRoom.create({
        data: { channel: 'FACEBOOK', assignedToId: actor.id, customerId },
      })
    ).id;
    await db.systemConfig.upsert({
      where: { key: 'chat_service_requests_enabled' },
      create: { key: 'chat_service_requests_enabled', value: 'true' },
      update: { value: 'true', deletedAt: null },
    });
  });
  afterAll(() => db.$disconnect());
  const request = (room = roomId, extras = {}) =>
    intake.create(
      room,
      {
        clientRequestId: randomUUID(),
        symptom: 'เครื่องเปิดไม่ติด',
        assigneeId: actor.id,
        dueAt: '2026-10-08T10:00:00+07:00',
        ...extras,
      },
      actor,
      scope,
    );
  const physicalCase = (customer = customerId, extras = {}) =>
    db.afterSalesCase.create({
      data: {
        caseNumber: `AS-link-${randomUUID()}`,
        branchId,
        customerId: customer,
        source: 'WALK_IN',
        symptom: 'รับฝากแล้ว',
        receivedById: actor.id,
        warrantySnapshot: {},
        deviceImei: '123456789012345',
        ...extras,
      },
    });
  it('links an explicitly selected same-customer case once without creating or notifying another receipt', async () => {
    const req = await request();
    const c = await physicalCase();
    const count = await db.afterSalesCase.count();
    const caseEvents = await db.afterSalesEvent.count();
    await links.link(req.id, { caseId: c.id, expectedRevision: 0 }, actor, scope);
    await links.link(req.id, { caseId: c.id, expectedRevision: 0 }, actor, scope);
    const row = await db.chatServiceRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(row.status).toBe('LINKED');
    expect(row.afterSalesCaseId).toBe(c.id);
    expect(row.revision).toBe(1);
    expect(
      await db.chatServiceRequestEvent.count({ where: { requestId: req.id, kind: 'LINK_CASE' } }),
    ).toBe(1);
    expect(await db.afterSalesCase.count()).toBe(count);
    expect(await db.afterSalesEvent.count()).toBe(caseEvents);
    await expect(
      intake.update(
        req.id,
        { expectedRevision: 1, status: 'RESOLVED', reason: 'ปิดโดยไม่มีหลักฐาน' },
        actor,
        scope,
      ),
    ).rejects.toThrow();
  });
  it('rejects different customer and a room without canonical customer without writes', async () => {
    const other = await db.customer.create({ data: { name: 'Other case customer' } });
    const req = await request();
    const c = await physicalCase(other.id);
    await expect(
      links.link(req.id, { caseId: c.id, expectedRevision: 0 }, actor, scope),
    ).rejects.toThrow();
    const unknown = await db.chatRoom.create({
      data: { channel: 'FACEBOOK', assignedToId: actor.id },
    });
    const unknownRequest = await request(unknown.id);
    await expect(
      links.link(unknownRequest.id, { caseId: c.id, expectedRevision: 0 }, actor, scope),
    ).rejects.toThrow();
    expect((await db.chatServiceRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe(
      'OPEN',
    );
  });
  it('resolves merged aliases but preserves the historical case customer', async () => {
    const alias = await db.customer.create({
      data: { name: 'Former profile', deletedAt: new Date(), mergedIntoId: customerId },
    });
    const c = await physicalCase(alias.id);
    const req = await request();
    await links.link(req.id, { caseId: c.id, expectedRevision: 0 }, actor, scope);
    expect((await db.afterSalesCase.findUniqueOrThrow({ where: { id: c.id } })).customerId).toBe(
      alias.id,
    );
  });
  it('checks selected product and IMEI, current grants, revision, and one-source-per-case', async () => {
    const product = await db.product.create({
      data: {
        name: 'Linked phone',
        brand: 'Apple',
        model: 'Phone',
        category: 'PHONE_USED',
        branchId,
        costPrice: 1000,
        imeiSerial: '111111111111111',
      },
    });
    const sale = await db.sale.create({
      data: {
        saleNumber: `service-link-${randomUUID()}`,
        customerId,
        productId: product.id,
        branchId,
        salespersonId: actor.id,
        saleType: 'CASH',
        sellingPrice: 9000,
        netAmount: 9000,
      },
    });
    const req = await request(roomId, { productId: product.id, saleId: sale.id });
    const wrong = await physicalCase(customerId, { productId: product.id, saleId: sale.id });
    await expect(
      links.link(req.id, { caseId: wrong.id, expectedRevision: 0 }, actor, scope),
    ).rejects.toThrow();
    const c = await physicalCase(customerId, {
      productId: product.id,
      saleId: sale.id,
      deviceImei: product.imeiSerial,
    });
    await expect(
      links.link(req.id, { caseId: c.id, expectedRevision: 1 }, actor, scope),
    ).rejects.toThrow();
    await links.link(req.id, { caseId: c.id, expectedRevision: 0 }, actor, scope);
    const second = await request();
    await expect(
      links.link(second.id, { caseId: c.id, expectedRevision: 0 }, actor, scope),
    ).rejects.toThrow();
    await db.user.update({ where: { id: actor.id }, data: { accessibleCompanies: ['FINANCE'] } });
    try {
      await expect(
        links.link(req.id, { caseId: c.id, expectedRevision: 1 }, actor, scope),
      ).rejects.toThrow();
    } finally {
      await db.user.update({ where: { id: actor.id }, data: { accessibleCompanies: ['SHOP'] } });
    }
  });
  const creator = () => {
    const files = new Map<string, Buffer>();
    const notify = jest.fn().mockResolvedValue(undefined);
    const storage = {
      upload: async (key: string, bytes: Buffer) => {
        files.set(key, bytes);
        return key;
      },
      delete: async (key: string) => {
        files.delete(key);
      },
    };
    // Real case transaction and real child rows; storage/lookup/LINE boundaries are synthetic.
    const repair = {
      createInTx: async (
        dto: {
          customerId: string;
          branchId: string;
          deviceImei: string;
          defectDescription: string;
        },
        user: { id: string },
        tx: Parameters<ChatServiceCaseLinkService['linkInTx']>[0],
      ) => ({
        ticket: await tx.repairTicket.create({
          data: { ticketNumber: `RT-chat-${randomUUID()}`, ...dto, createdById: user.id },
        }),
      }),
    };
    const lookup = {
      lookup: async () => ({
        found: false,
        source: 'WALK_IN',
        customer: { id: customerId },
        product: null,
        contract: null,
        sale: null,
        warranty: { status: 'WALK_IN', daysRemainingIn7Day: 0 },
        purchasePhotos: {},
        openCase: null,
        outcomes: [{ outcome: 'REPAIR', enabled: true, payerDefault: 'SHOP' }],
      }),
    };
    const service = new AfterSalesCaseService(
      db,
      storage as never,
      { log: async () => undefined } as never,
      repair as never,
      new AfterSalesDocNumberService(db),
      lookup as never,
      {} as never,
      {} as never,
      { notifyMoment: notify } as never,
      links,
    );
    const photo = {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
      mimetype: 'image/png',
      originalname: 'intake.png',
    } as Express.Multer.File;
    return { service, files, notify, photo };
  };
  it('creates and links one canonical case across competing submissions; retries skip receipt side effects', async () => {
    const req = await request();
    const fixture = creator();
    const draft = {
      serviceRequestId: req.id,
      imei: `imei-${randomUUID()}`.slice(0, 30),
      customerId,
      branchId,
      symptom: 'เครื่องเปิดไม่ติด',
      accessories: {},
      unlockConfirmed: true,
      outcome: 'REPAIR' as const,
    };
    const rows = await Promise.all([
      fixture.service.createCase(draft, [fixture.photo], actor),
      fixture.service.createCase(draft, [fixture.photo], actor),
    ]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    const retry = await fixture.service.createCase(draft, [], actor);
    expect(retry.id).toBe(rows[0].id);
    expect(fixture.notify).toHaveBeenCalledTimes(1);
    expect(fixture.files.size).toBe(1);
    expect(
      (await db.chatServiceRequest.findUniqueOrThrow({ where: { id: req.id } })).afterSalesCaseId,
    ).toBe(rows[0].id);
  });
  it('rolls back the physical case and repair when intake linking fails in the case transaction', async () => {
    const req = await request();
    const fixture = creator();
    const before = await db.afterSalesCase.count();
    const tickets = await db.repairTicket.count();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION fail_case_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'LINK_CASE' THEN RAISE EXCEPTION 'synthetic link failure'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER fail_case_link BEFORE INSERT ON chat_service_request_events FOR EACH ROW EXECUTE FUNCTION fail_case_link()`,
    );
    try {
      await expect(
        fixture.service.createCase(
          {
            serviceRequestId: req.id,
            imei: randomUUID().slice(0, 30),
            customerId,
            branchId,
            symptom: 'เครื่องเปิดไม่ติด',
            accessories: {},
            unlockConfirmed: true,
            outcome: 'REPAIR',
          },
          [fixture.photo],
          actor,
        ),
      ).rejects.toThrow('synthetic link failure');
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER fail_case_link ON chat_service_request_events');
      await db.$executeRawUnsafe('DROP FUNCTION fail_case_link()');
    }
    expect(await db.afterSalesCase.count()).toBe(before);
    expect(await db.repairTicket.count()).toBe(tickets);
    expect(fixture.notify).not.toHaveBeenCalled();
    expect(fixture.files.size).toBe(0);
  });
  it('derives live repair completion, closes only follow-up work and does not credit a reader as the closer', async () => {
    const req = await request();
    const fixture = creator();
    const c = await fixture.service.createCase(
      {
        serviceRequestId: req.id,
        imei: randomUUID().slice(0, 30),
        customerId,
        branchId,
        symptom: 'เครื่องเปิดไม่ติด',
        accessories: {},
        unlockConfirmed: true,
        outcome: 'REPAIR',
      },
      [fixture.photo],
      actor,
    );
    expect((await intake.get(req.id, actor, scope)).linkedCase?.stage).toBe('RECEIVED');
    const returnedAt = new Date('2026-10-08T10:00:00+07:00');
    await db.repairTicket.update({
      where: { id: c.repairTicketId! },
      data: { status: 'CLOSED', returnedToCustomerAt: returnedAt },
    });
    const result = await intake.get(req.id, actor, scope);
    expect(result.linkedCase?.stage).toBe('CLOSED');
    expect(result.todo.status).toBe('DONE');
    expect(result.todo.completedAt).toEqual(returnedAt);
    expect(result.status).toBe('LINKED');
    const events = await db.todoWorkEvent.findMany({
      where: { todoId: req.todoId, kind: 'CASE_CLOSED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBeNull();
    await intake.get(req.id, actor, scope);
    expect(
      await db.todoWorkEvent.count({ where: { todoId: req.todoId, kind: 'CASE_CLOSED' } }),
    ).toBe(1);
    expect(fixture.notify).toHaveBeenCalledTimes(1);
  });
  it('prefills only canonical customer and symptom; case choices stay scoped and exclude already linked cases', async () => {
    const req = await request();
    const c = await physicalCase();
    const prefill = await links.prefill(req.id, actor, scope);
    expect(prefill.customer.id).toBe(customerId);
    expect(prefill.imei).toBe('');
    expect(prefill.serviceRequestId).toBe(req.id);
    expect(
      (await links.options(req.id, actor, scope, c.caseNumber, 1, 20)).data.map((row) => row.id),
    ).toEqual([c.id]);
    await links.link(req.id, { caseId: c.id, expectedRevision: 0 }, actor, scope);
    const another = await request();
    expect((await links.options(another.id, actor, scope, c.caseNumber, 1, 20)).data).toEqual([]);
    await db.user.update({ where: { id: actor.id }, data: { role: 'FINANCE_MANAGER' } });
    try {
      expect((await intake.get(another.id, actor, scope)).canOpenCase).toBe(false);
      await expect(links.prefill(another.id, actor, scope)).rejects.toThrow();
    } finally {
      await db.user.update({ where: { id: actor.id }, data: { role: 'OWNER' } });
    }
  });
  it('removes closed and cancelled linked work from the queue without first opening its card', async () => {
    const queue = new ChatWorkQueryService(db, access);
    for (const cancelled of [false, true]) {
      const req = await request();
      const c = await physicalCase(customerId, { outcome: 'SAME_MODEL_EXCHANGE' });
      await links.link(req.id, { caseId: c.id, expectedRevision: 0 }, actor, scope);
      const active = await intake.update(
        req.id,
        { expectedRevision: 1, dueAt: '2026-10-09T10:00:00+07:00' },
        actor,
        scope,
      );
      expect(active.todo.status).toBe('TODO');
      await db.afterSalesCase.update({
        where: { id: c.id },
        data: cancelled ? { cancelledAt: new Date() } : { closedAt: new Date() },
      });
      const page = await queue.list(actor, { ...scope, view: 'FOR_ME', page: 1, limit: 200 });
      expect(page.data.some((row) => row.targetId === req.todoId)).toBe(false);
      expect((await db.todo.findUniqueOrThrow({ where: { id: req.todoId } })).status).toBe(
        cancelled ? 'CANCELLED' : 'DONE',
      );
    }
  });
  it('keeps exchange follow-up active until the canonical memo or replacement contract actually completes', async () => {
    const product = () =>
      db.product.create({
        data: {
          name: 'Exchange proof',
          brand: 'Apple',
          model: 'Phone',
          category: 'PHONE_USED',
          branchId,
          costPrice: 5000,
        },
      });
    const [oldProduct, newProduct] = await Promise.all([product(), product()]);
    const contract = (productId: string, status: 'ACTIVE' | 'DRAFT') =>
      db.contract.create({
        data: {
          contractNumber: `service-exchange-${randomUUID()}`,
          customerId,
          productId,
          branchId,
          salespersonId: actor.id,
          status,
          planType: 'STORE_DIRECT',
          sellingPrice: 10000,
          downPayment: 2000,
          financedAmount: 8000,
          interestRate: 0.02,
          interestTotal: 1000,
          totalMonths: 10,
          monthlyPayment: 900,
        },
      });
    const old = await contract(oldProduct.id, 'ACTIVE');
    for (const mode of ['MEMO', 'PRICED'] as const) {
      const replacement = mode === 'PRICED' ? await contract(newProduct.id, 'DRAFT') : null;
      const exchange = await db.contractExchangeRequest.create({
        data: {
          oldContractId: old.id,
          oldProductId: oldProduct.id,
          newProductId: newProduct.id,
          requestedById: actor.id,
          mode,
          status: 'APPROVED',
          newContractId: replacement?.id,
        },
      });
      const c = await physicalCase(customerId, {
        outcome: 'PRICED_EXCHANGE',
        exchangeRequestId: exchange.id,
      });
      const req = await request();
      await links.link(req.id, { caseId: c.id, expectedRevision: 0 }, actor, scope);
      expect((await intake.get(req.id, actor, scope)).todo.status).toBe('TODO');
      if (mode === 'MEMO')
        await db.contractExchangeRequest.update({
          where: { id: exchange.id },
          data: { memoAppliedAt: new Date() },
        });
      else await db.contract.update({ where: { id: replacement!.id }, data: { status: 'ACTIVE' } });
      const closed = await intake.get(req.id, actor, scope);
      expect(closed.linkedCase?.stage).toBe('CLOSED');
      expect(closed.todo.status).toBe('DONE');
    }
    const rejected = await db.contractExchangeRequest.create({
      data: {
        oldContractId: old.id,
        oldProductId: oldProduct.id,
        newProductId: newProduct.id,
        requestedById: actor.id,
        status: 'REJECTED',
      },
    });
    const c = await physicalCase(customerId, {
      outcome: 'PRICED_EXCHANGE',
      exchangeRequestId: rejected.id,
    });
    const req = await request();
    await links.link(req.id, { caseId: c.id, expectedRevision: 0 }, actor, scope);
    expect((await intake.get(req.id, actor, scope)).todo.status).toBe('CANCELLED');
  });
});
