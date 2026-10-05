import { ChatRoomService } from '../src/modules/chatbot-finance/services/chat-room.service';
import { LineFinanceClientService } from '../src/modules/chatbot-finance/services/line-finance-client.service';
import { SessionOpsService } from '../src/modules/staff-chat/services/session-ops.service';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { RoomManagerService } from '../src/modules/chat-engine/services/room-manager.service';
import { ResponseCycleService } from '../src/modules/chat-engine/services/response-cycle.service';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.'))
  throw new Error('Use isolated chat-operations harness');

describe('Causal response cycles with real PostgreSQL', () => {
  const db = new PrismaService();
  let cycles: ResponseCycleService;
  let rooms: RoomManagerService;
  let roomId: string;
  let financeRooms: ChatRoomService;
  let sessionOps: SessionOpsService;
  beforeAll(async () => {
    await db.$connect();
    await db.systemConfig.upsert({
      where: { key: 'chat_work_queue_enabled' },
      create: { key: 'chat_work_queue_enabled', value: 'true' },
      update: { value: 'true' },
    });
    const module = await Test.createTestingModule({
      providers: [
        ResponseCycleService,
        RoomManagerService,
        ChatRoomService,
        SessionOpsService,
        { provide: LineFinanceClientService, useValue: {} },
        { provide: PrismaService, useValue: db },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    cycles = module.get(ResponseCycleService);
    rooms = module.get(RoomManagerService);
    financeRooms = module.get(ChatRoomService);
    sessionOps = module.get(SessionOpsService);
  });
  beforeEach(async () => {
    roomId = (await db.chatRoom.create({ data: { channel: 'FACEBOOK' } })).id;
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  const inbound = () => rooms.saveMessage({ roomId, role: 'CUSTOMER', text: 'Synthetic inbound' });
  const draft = () => rooms.saveMessage({ roomId, role: 'STAFF', text: 'Synthetic reply' });
  const open = () => db.chatResponseCycle.findMany({ where: { roomId, endedAt: null } });

  it('concurrent inbound opens one cycle, and a saved reply or read never closes it', async () => {
    await Promise.all([inbound(), inbound()]);
    await draft();
    await rooms.markAsRead(roomId);
    expect(await open()).toHaveLength(1);
    expect(
      (await db.chatRoom.findUniqueOrThrow({ where: { id: roomId } })).waitingSince,
    ).not.toBeNull();
    expect(
      await db.chatResponseCycle.count({ where: { roomId, firstHumanSentAt: { not: null } } }),
    ).toBe(0);
  });
  it('records only acknowledged BOT replies and keeps waiting for a human', async () => {
    await inbound();
    const bot = await rooms.saveMessage({ roomId, role: 'BOT', text: 'Synthetic bot' });
    expect((await open())[0].firstBotSentAt).toBeNull();
    await rooms.markOutboundSent(bot.id, 'bot-ack-' + bot.id);
    expect((await open())[0].firstBotSentAt).not.toBeNull();
    expect((await open())[0].firstHumanSentAt).toBeNull();
  });
  it('keeps an inbound received while the provider request was in flight in a new cycle', async () => {
    await inbound();
    const reply = await draft();
    expect(await cycles.prepareAttempt(reply.id)).toBe(true);
    const newer = await inbound();
    await rooms.markOutboundSent(reply.id, 'staff-ack-' + reply.id);
    const remaining = await open();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].firstCustomerMessageId).toBe(newer.id);
    expect((await db.chatRoom.findUniqueOrThrow({ where: { id: roomId } })).waitingSince).toEqual(
      newer.createdAt,
    );
    expect(await db.chatResponseCycle.count({ where: { roomId, endReason: 'HUMAN_REPLY' } })).toBe(
      1,
    );
    await rooms.markOutboundSent(reply.id, 'staff-ack-' + reply.id);
    expect(await open()).toHaveLength(1);
  });
  it('a reply started before any inbound cannot clear a subsequent customer message', async () => {
    const reply = await draft();
    await cycles.prepareAttempt(reply.id);
    const customer = await inbound();
    await rooms.markOutboundSent(reply.id);
    expect((await open())[0].firstCustomerMessageId).toBe(customer.id);
  });
  it('blocks ambiguous retries, but allows a provider-confirmed failure to retry', async () => {
    await inbound();
    const reply = await draft();
    expect(await cycles.prepareAttempt(reply.id)).toBe(true);
    expect(await cycles.prepareAttempt(reply.id)).toBe(false);
    await cycles.failAttempt(reply.id, false);
    expect(await cycles.prepareAttempt(reply.id)).toBe(false);
    // Explicit rejection is evidence that the provider did not send this message.
    await cycles.failAttempt(reply.id, true);
    expect(await cycles.prepareAttempt(reply.id)).toBe(true);
    await rooms.markOutboundSent(reply.id);
    expect(await open()).toHaveLength(0);
  });
  it('resolve does not fabricate a human response', async () => {
    await inbound();
    await db.$transaction((tx) => cycles.resolveInTx(tx, { roomId, resolvedAt: new Date() }));
    expect(await open()).toHaveLength(0);
    expect(await db.chatResponseCycle.findFirst({ where: { roomId } })).toMatchObject({
      endReason: 'RESOLVED',
      firstHumanSentAt: null,
    });
    expect(
      (await db.chatRoom.findUniqueOrThrow({ where: { id: roomId } })).waitingSince,
    ).toBeNull();
  });
  it('does not infer an answer boundary for an external echo with unknown ordering', async () => {
    await inbound();
    const echo = await rooms.saveMessage({
      roomId,
      role: 'STAFF',
      externalMessageId: 'echo-' + roomId,
    });
    await cycles.confirmUnknownEcho(echo.id);
    expect(await open()).toHaveLength(1);
    expect(
      (await db.chatMessage.findUniqueOrThrow({ where: { id: echo.id } })).outboundSentAt,
    ).not.toBeNull();
  });
  it('reconciles an echo preceding our acknowledgement to one visible outbound bubble', async () => {
    await inbound();
    const reply = await draft();
    await cycles.prepareAttempt(reply.id);
    const externalId = 'race-' + reply.id;
    const echo = await rooms.saveMessage({ roomId, role: 'STAFF', externalMessageId: externalId });
    await cycles.confirmUnknownEcho(echo.id);
    await rooms.markOutboundSent(reply.id, externalId);
    expect(await db.chatMessage.count({ where: { roomId, role: 'STAFF', deletedAt: null } })).toBe(
      1,
    );
    expect(await open()).toHaveLength(0);
  });
  it('tracks inbound from the direct Finance bot writer in the same transaction', async () => {
    await db.chatRoom.update({ where: { id: roomId }, data: { channel: 'LINE_FINANCE' } });
    const message = await financeRooms.saveMessage({
      roomId,
      role: 'CUSTOMER',
      text: 'Synthetic finance',
    });
    expect((await open())[0]?.firstCustomerMessageId).toBe(message.id);
    expect((await db.chatRoom.findUniqueOrThrow({ where: { id: roomId } })).waitingSince).toEqual(
      message.createdAt,
    );
  });
  it('merges two open rooms without inventing a response or clearing the oldest waiting', async () => {
    const first = await inbound();
    const secondary = await db.chatRoom.create({ data: { channel: 'FACEBOOK' } });
    await rooms.saveMessage({
      roomId: secondary.id,
      role: 'CUSTOMER',
      text: 'Another conversation',
    });
    const reply = await draft();
    await cycles.prepareAttempt(reply.id);
    await sessionOps.mergeRooms(roomId, secondary.id);
    expect(await open()).toHaveLength(1);
    expect((await open())[0].startedAt).toEqual(first.createdAt);
    expect(
      await db.chatResponseCycle.count({
        where: { roomId, endReason: 'MERGED', firstHumanSentAt: null },
      }),
    ).toBe(1);
    await rooms.markOutboundSent(reply.id);
    expect(await open()).toHaveLength(1);
  });
  it('rolls back failed finalization and refuses to send an uncertain attempt twice', async () => {
    await inbound();
    const reply = await draft();
    await cycles.prepareAttempt(reply.id);
    await db.$executeRawUnsafe(
      "CREATE FUNCTION test_cycle_finalization_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic finalization failure'; END $$",
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER test_cycle_finalization BEFORE UPDATE ON chat_response_cycles FOR EACH ROW EXECUTE FUNCTION test_cycle_finalization_failure()',
    );
    try {
      await expect(rooms.markOutboundSent(reply.id)).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_cycle_finalization ON chat_response_cycles');
      await db.$executeRawUnsafe('DROP FUNCTION test_cycle_finalization_failure()');
    }
    expect(
      (await db.chatMessage.findUniqueOrThrow({ where: { id: reply.id } })).outboundSentAt,
    ).toBeNull();
    expect(await cycles.prepareAttempt(reply.id)).toBe(false);
    expect(await open()).toHaveLength(1);
  });

  it('legacy seed is dry-run by default, preserves old waits and never invents a customer message', async () => {
    const waitingSince = new Date('2026-01-01T03:00:00Z');
    await db.chatRoom.update({ where: { id: roomId }, data: { waitingSince } });
    const report = await cycles.seedLegacy();
    expect(report.pending).toBeGreaterThan(0);
    expect(await open()).toHaveLength(0);
    await cycles.seedLegacy(false);
    expect((await open())[0]).toMatchObject({
      origin: 'LEGACY_OPEN',
      firstCustomerMessageId: null,
      startedAt: waitingSince,
      alertEligibleAt: null,
    });
    const reply = await draft();
    await cycles.prepareAttempt(reply.id);
    await rooms.markOutboundSent(reply.id);
    expect(await open()).toHaveLength(0);
    expect(
      (await db.chatRoom.findUniqueOrThrow({ where: { id: roomId } })).waitingSince,
    ).toBeNull();
  });
});
