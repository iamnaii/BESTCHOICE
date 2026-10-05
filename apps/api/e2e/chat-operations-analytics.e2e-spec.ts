import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChatWorkAccessService } from '../src/modules/staff-chat/services/chat-work-access.service';
import { ChatAnalyticsV2Service } from '../src/modules/chat-analytics/chat-analytics-v2.service';
import {
  DEFAULT_SLA_POLICY,
  policyVersion,
} from '../src/modules/chat-engine/services/chat-sla-policy';
import type { ChatWorkActor } from '@installment/shared';
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.'))
  throw new Error('Use disposable harness');
describe('Scoped human/bot analytics and event cohorts', () => {
  const db = new PrismaService();
  const svc = new ChatAnalyticsV2Service(db, new ChatWorkAccessService(db));
  let actor: ChatWorkActor, responder: ChatWorkActor, foreign: ChatWorkActor, branchId: string;
  const observed = new Date('2026-10-07T04:00:00Z');
  const query = () => ({
    company: 'SHOP' as const,
    branchId,
    from: '2026-10-05T00:00:00+07:00',
    to: '2026-10-06T00:00:00+07:00',
    page: 1,
    limit: 20,
  });
  beforeAll(async () => {
    await db.$connect();
    branchId = (await db.branch.create({ data: { name: 'Analytics isolated' } })).id;
    const staff = (role: 'OWNER' | 'SALES', branch = branchId) =>
      db.user.create({
        data: {
          role,
          branchId: branch,
          name: role,
          email: `${randomUUID()}@analytics.invalid`,
          password: 'unused',
          accessibleCompanies: ['SHOP'],
        },
      });
    actor = await staff('OWNER');
    responder = await staff('SALES');
    foreign = await staff(
      'SALES',
      (await db.branch.create({ data: { name: 'Other analytics' } })).id,
    );
    await db.systemConfig.upsert({
      where: { key: 'chat_analytics_v2_enabled' },
      create: { key: 'chat_analytics_v2_enabled', value: 'true' },
      update: { value: 'true', deletedAt: null },
    });
  });
  afterAll(() => db.$disconnect());
  const room = () => db.chatRoom.create({ data: { channel: 'FACEBOOK', assignedToId: actor.id } });
  it('counts acknowledged actual responder, keeps bot independent, and includes replies after cohort end', async () => {
    const r = await room();
    await db.chatResponseCycle.create({
      data: {
        roomId: r.id,
        startedAt: new Date('2026-10-05T03:00:00Z'),
        firstBotSentAt: new Date('2026-10-05T03:01:00Z'),
        firstHumanSentAt: new Date('2026-10-05T03:06:00Z'),
        firstHumanStaffId: responder.id,
        assignedAtOpenId: actor.id,
        endedAt: new Date('2026-10-05T03:06:00Z'),
        endReason: 'HUMAN_REPLY',
        policyVersion: policyVersion(DEFAULT_SLA_POLICY),
      },
    });
    const overnight = await room();
    await db.chatResponseCycle.create({
      data: {
        roomId: overnight.id,
        startedAt: new Date('2026-10-05T11:58:00Z'),
        firstHumanSentAt: new Date('2026-10-06T03:02:00Z'),
        firstHumanStaffId: responder.id,
        endedAt: new Date('2026-10-06T03:02:00Z'),
        endReason: 'HUMAN_REPLY',
        policyVersion: policyVersion({ ...DEFAULT_SLA_POLICY, ownerMinutes: 10 }),
      },
    });
    await db.chatMessage.create({
      data: {
        roomId: r.id,
        role: 'STAFF',
        staffId: actor.id,
        text: 'Failed draft',
        createdAt: new Date('2026-10-05T03:02:00Z'),
      },
    });
    const result = await svc.overview(actor, query(), observed);
    expect(result.responses).toMatchObject({
      cycles: 2,
      rooms: 2,
      nResponded: 2,
      nAwaiting: 0,
      humanMedianMinutes: 4,
      humanP90Minutes: 6,
      humanSamples: 2,
      botMedianMinutes: 1,
      botSamples: 1,
      slaBreached: 1,
    });
    const staff = await svc.staff(actor, query(), observed);
    expect(staff.data.find((s) => s.staffId === responder.id)).toMatchObject({ nResponded: 2 });
    expect(staff.data.find((s) => s.staffId === actor.id)).toBeUndefined();
    const drill = await svc.cycles(actor, { ...query(), metric: 'RESPONDED' }, observed);
    expect(drill.total).toBe(2);
    expect(drill.data.map((x) => x.humanMinutes).sort()).toEqual([4, 6]);
  });
  it('separates unknown staff and legacy coverage and survives message retention', async () => {
    const unknown = await room(),
      legacy = await room();
    await db.chatResponseCycle.create({
      data: {
        roomId: unknown.id,
        startedAt: new Date('2026-10-05T04:00:00Z'),
        firstHumanSentAt: new Date('2026-10-05T04:03:00Z'),
        endedAt: new Date('2026-10-05T04:03:00Z'),
        endReason: 'HUMAN_REPLY',
        policyVersion: 'initial-5-15',
      },
    });
    await db.chatResponseCycle.create({
      data: {
        roomId: legacy.id,
        startedAt: new Date('2026-10-05T01:00:00Z'),
        origin: 'LEGACY_OPEN',
        policyVersion: 'legacy',
      },
    });
    const a = await svc.overview(actor, query(), observed);
    expect(a.coverage).toMatchObject({ legacyExcluded: 1, unknownStaffCycles: 1 });
    expect(a.responses.cycles).toBe(3);
    await db.chatMessage.updateMany({
      where: { room: { assignedToId: actor.id } },
      data: { deletedAt: new Date() },
    });
    expect((await svc.overview(actor, query(), observed)).responses).toEqual(a.responses);
    expect(
      (await svc.staff(actor, query(), observed)).data.find((s) => s.staffId === null)?.nResponded,
    ).toBe(1);
  });
  it('uses work event times and counts one service Todo once', async () => {
    const r = await room();
    const before = new Date('2026-10-04T03:00:00Z'),
      inside = new Date('2026-10-05T03:00:00Z'),
      after = new Date('2026-10-06T03:00:00Z');
    const task = (workKind: 'CHAT_HANDOFF' | 'CHAT_FOLLOW_UP' | 'CHAT_SERVICE') =>
      db.todo.create({
        data: {
          roomId: r.id,
          title: workKind,
          workKind,
          createdById: actor.id,
          assigneeId: responder.id,
          dueDate: inside,
          status: 'DONE',
        },
      });
    const handoff = await task('CHAT_HANDOFF'),
      follow = await task('CHAT_FOLLOW_UP'),
      service = await task('CHAT_SERVICE');
    await db.todoWorkEvent.createMany({
      data: [
        {
          todoId: handoff.id,
          actorId: actor.id,
          kind: 'CREATED',
          toStatus: 'TODO',
          createdAt: before,
        },
        {
          todoId: handoff.id,
          actorId: responder.id,
          kind: 'STATUS_CHANGED',
          fromStatus: 'TODO',
          toStatus: 'DOING',
          createdAt: inside,
        },
        {
          todoId: handoff.id,
          actorId: responder.id,
          kind: 'STATUS_CHANGED',
          fromStatus: 'DOING',
          toStatus: 'DONE',
          createdAt: after,
        },
        {
          todoId: follow.id,
          actorId: actor.id,
          kind: 'CREATED',
          toStatus: 'TODO',
          toDueAt: inside,
          toAssigneeId: responder.id,
          createdAt: before,
        },
        {
          todoId: follow.id,
          actorId: responder.id,
          kind: 'STATUS_CHANGED',
          fromStatus: 'TODO',
          toStatus: 'DONE',
          toDueAt: inside,
          toAssigneeId: responder.id,
          createdAt: after,
        },
        {
          todoId: service.id,
          actorId: actor.id,
          kind: 'CREATED',
          toStatus: 'TODO',
          createdAt: inside,
        },
      ],
    });
    const intake = await db.chatServiceRequest.create({
      data: {
        roomId: r.id,
        todoId: service.id,
        createdById: actor.id,
        requestKey: randomUUID(),
        requestFingerprint: 'fixture',
        symptom: 'อาการทดสอบ',
        status: 'RESOLVED',
      },
    });
    await db.chatServiceRequestEvent.createMany({
      data: [
        {
          requestId: intake.id,
          kind: 'CREATE',
          toStatus: 'OPEN',
          actorId: actor.id,
          createdAt: inside,
        },
        {
          requestId: intake.id,
          kind: 'STATUS',
          fromStatus: 'OPEN',
          toStatus: 'RESOLVED',
          actorId: actor.id,
          createdAt: inside,
        },
      ],
    });
    const report = await svc.work(actor, query(), observed);
    expect(report.handoffs).toEqual({ created: 0, accepted: 1, completed: 0, overdueNow: 0 });
    expect(report.followUps).toEqual({ due: 1, completed: 0, overdueNow: 0 });
    expect(report.serviceRequests).toEqual({
      created: 1,
      linkedToCase: 0,
      resolved: 1,
      overdueNow: 0,
    });
    const detail = await svc.workDetails(
      actor,
      { ...query(), metric: 'SERVICE_CREATED' },
      observed,
    );
    expect(detail.total).toBe(1);
    expect(detail.data[0]).toMatchObject({ targetType: 'SERVICE_REQUEST', targetId: intake.id });
    const countBefore = (await svc.overview(actor, query(), observed)).openWorkNow.activeTasks;
    await db.todo.update({ where: { id: service.id }, data: { status: 'TODO' } });
    expect((await svc.overview(actor, query(), observed)).openWorkNow.activeTasks).toBe(
      countBefore + 1,
    );
  });
  it('reports unresolved/closed-without-reply and unknown policy separately; pagination keeps total', async () => {
    const waiting = await room(),
      closed = await room(),
      unknown = await room();
    await db.chatResponseCycle.createMany({
      data: [
        {
          roomId: waiting.id,
          startedAt: new Date('2026-10-05T05:00:00Z'),
          assignedAtOpenId: actor.id,
          policyVersion: 'initial-5-15',
        },
        {
          roomId: closed.id,
          startedAt: new Date('2026-10-05T05:00:00Z'),
          endedAt: new Date('2026-10-05T05:02:00Z'),
          endReason: 'RESOLVED',
          policyVersion: 'initial-5-15',
        },
        {
          roomId: unknown.id,
          startedAt: new Date('2026-10-05T05:00:00Z'),
          firstHumanSentAt: new Date('2026-10-05T05:02:00Z'),
          firstHumanStaffId: responder.id,
          endedAt: new Date('2026-10-05T05:02:00Z'),
          endReason: 'HUMAN_REPLY',
          policyVersion: 'unknown-import',
        },
      ],
    });
    const a = await svc.overview(actor, query(), observed);
    expect(a.responses).toMatchObject({
      nAwaiting: 1,
      nResolvedWithoutReply: 1,
      humanSamples: 3,
      nResponded: 4,
    });
    expect(a.coverage.unknownPolicyCycles).toBe(1);
    const page = await svc.cycles(
      actor,
      { ...query(), metric: 'RESPONDED', page: 2, limit: 2 },
      observed,
    );
    expect(page.total).toBe(4);
    expect(page.data).toHaveLength(2);
    const responderReport = await svc.overview(
      actor,
      { ...query(), staffId: responder.id },
      observed,
    );
    expect(responderReport.responses.nResponded).toBe(3);
    expect(responderReport.responses.nAwaiting).toBe(0);
  });
  it('counts incoming comment threads and confirmed replies separately without assigning old inbound to the current owner', async () => {
    const pageId = randomUUID(),
      date = new Date('2026-10-05T03:00:00Z');
    await db.facebookCommentPage.create({ data: { pageId, branchId, enabled: true } });
    const thread = await db.facebookCommentThread.create({
      data: {
        pageId,
        postId: 'post',
        rootCommentId: 'root',
        company: 'SHOP',
        branchId,
        assigneeId: responder.id,
        waitingSince: date,
      },
    });
    for (const [verb, author] of [
      ['ADD', 'customer'],
      ['EDIT', 'customer'],
      ['ADD', pageId],
    ])
      await db.facebookCommentEvent.create({
        data: {
          threadId: thread.id,
          pageId,
          commentId: 'root',
          eventKey: randomUUID(),
          verb,
          payload: { from: { id: author } },
          createdAt: date,
        },
      });
    await db.facebookCommentReply.createMany({
      data: [
        {
          threadId: thread.id,
          pageId,
          authorId: responder.id,
          requestKey: randomUUID(),
          text: 'confirmed',
          status: 'CONFIRMED',
          externalId: 'ack',
          inboundSequence: 1,
          confirmedAt: date,
        },
        {
          threadId: thread.id,
          pageId,
          authorId: responder.id,
          requestKey: randomUUID(),
          text: 'unknown',
          status: 'UNKNOWN',
          inboundSequence: 2,
        },
      ],
    });
    const report = await svc.work(actor, query(), observed);
    expect(report.comments).toEqual({ received: 1, confirmedReplies: 1, unresolvedNow: 1 });
    const filtered = await svc.work(actor, { ...query(), staffId: responder.id }, observed);
    expect(filtered.comments.received).toBeNull();
    expect(filtered.comments.confirmedReplies).toBe(1);
    expect(
      (await svc.workDetails(actor, { ...query(), metric: 'COMMENT_CONFIRMED' }, observed)).total,
    ).toBe(1);
  });
  it('returns null for no samples, rejects scope escalation/range abuse and excludes revoked grants', async () => {
    const empty = await svc.overview(
      actor,
      { ...query(), from: '2020-01-01T00:00:00Z', to: '2020-01-02T00:00:00Z' },
      observed,
    );
    expect(empty.responses.humanMedianMinutes).toBeNull();
    expect(empty.responses.botSamples).toBe(0);
    await expect(svc.overview(foreign, query(), observed)).rejects.toThrow();
    await expect(
      svc.overview(actor, { ...query(), company: 'FINANCE' }, observed),
    ).rejects.toThrow();
    await expect(
      svc.overview(actor, { ...query(), from: '2020-01-01T00:00:00Z' }, observed),
    ).rejects.toThrow();
    await db.user.update({ where: { id: actor.id }, data: { accessibleCompanies: ['FINANCE'] } });
    await expect(svc.overview(actor, query(), observed)).rejects.toThrow();
    await db.user.update({ where: { id: actor.id }, data: { accessibleCompanies: ['SHOP'] } });
  });
});
