import { RoomNotesController } from '../src/modules/staff-chat/room-notes.controller';
import { StaffMessageService } from '../src/modules/staff-chat/services/staff-message.service';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChatWorkAccessService } from '../src/modules/staff-chat/services/chat-work-access.service';
import { StaffInboxService } from '../src/modules/staff-chat/services/staff-inbox.service';
import { NoteMentionService } from '../src/modules/staff-chat/services/note-mention.service';
import { ChatWorkQueryService } from '../src/modules/staff-chat/services/chat-work-query.service';
import type { ChatWorkActor } from '@installment/shared';
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) throw new Error('Use isolated chat operations harness');
describe('Explicit note mentions', () => {
  const db = new PrismaService(); const access = new ChatWorkAccessService(db); const inbox = new StaffInboxService(db, access);
  const gateway = { emitNoteChanged: jest.fn(), emitRoomUpdate: jest.fn(), emitToStaff: jest.fn(), emitNewMessage: jest.fn() };
  const service = new NoteMentionService(db, access, inbox, gateway);
  const notes = Object.assign(Object.create(StaffMessageService.prototype), { prisma: db, gateway }) as StaffMessageService;
  const controller = new RoomNotesController(service, access, notes);
  let actor: ChatWorkActor; let a: ChatWorkActor; let b: ChatWorkActor; let forbidden: ChatWorkActor; let roomId: string;
  const scope = { company: 'SHOP' as const };
  beforeAll(async () => {
    await db.$connect(); const branch = await db.branch.create({ data: { name: 'Mention branch' } });
    [actor,a,b,forbidden] = await Promise.all([0,1,2,3].map(i => db.user.create({ data: { name: i === 0 ? 'Sender' : 'ชื่อซ้ำ', email: `${randomUUID()}@test.invalid`, password: 'unused', role: i === 0 ? 'SALES' : 'BRANCH_MANAGER', branchId: branch.id, accessibleCompanies: i === 3 ? ['FINANCE'] : ['SHOP'] } })));
    roomId = (await db.chatRoom.create({ data: { channel: 'FACEBOOK', assignedToId: actor.id } })).id;
  });
  beforeEach(async () => { jest.clearAllMocks(); for (const key of ['chat_mentions_enabled','in_app_notifications_enabled']) await db.systemConfig.upsert({ where: { key }, create: { key, value: 'true' }, update: { value: 'true', deletedAt: null } }); });
  afterAll(() => db.$disconnect());
  it('mentions only the selected ID despite duplicate names; concurrent retries are one note and notification', async () => {
    const input = { content: '@ชื่อซ้ำ ช่วยตรวจข้อมูล', mentionedUserIds: [a.id], clientRequestId: randomUUID() };
    const [first, retry] = await Promise.all([service.create(roomId, input, actor, scope), service.create(roomId, input, actor, scope)]);
    expect(first.id).toBe(retry.id);
    expect(await db.chatNoteMention.count({ where: { noteId: first.id } })).toBe(1);
    const notifications = await db.staffInboxItem.findMany({ where: { targetType: 'NOTE', targetId: first.id } });
    expect(notifications.map(item => item.recipientId)).toEqual([a.id]);
    expect(gateway.emitToStaff.mock.calls.map(call => call[0])).not.toContain(b.id);
    expect(gateway.emitNewMessage).not.toHaveBeenCalled();
    expect(await new ChatWorkQueryService(db,access).target(a,scope,'NOTE',first.id)).toMatchObject({ content: input.content, roomId });
  });
  it('plain @name text has no inferred recipient and legacy content-only requests still save', async () => {
    const note = await service.create(roomId, { content: '@ชื่อซ้ำ สอบถาม' }, actor, scope);
    expect(await db.chatNoteMention.count({ where: { noteId: note.id } })).toBe(0);
    expect(await db.staffInboxItem.count({ where: { targetId: note.id } })).toBe(0);
  });
  it('revoked company membership or an inactive recipient rejects the complete transaction', async () => {
    const before = await db.chatNote.count({ where: { roomId } });
    await expect(service.create(roomId, { content: 'must rollback', mentionedUserIds: [a.id, forbidden.id] }, actor, scope)).rejects.toThrow();
    await db.user.update({ where: { id: b.id }, data: { isActive: false } });
    await expect(service.create(roomId, { content: 'inactive', mentionedUserIds: [b.id] }, actor, scope)).rejects.toThrow();
    expect(await db.chatNote.count({ where: { roomId } })).toBe(before);
    expect(gateway.emitNoteChanged).not.toHaveBeenCalled();
  });
  it.each(['in_app_notifications_enabled','chat_mentions_enabled'])('saves the note while %s is disabled without sending inbox notifications', async key => {
    await db.systemConfig.update({ where: { key }, data: { value: 'false' } });
    const note = await service.create(roomId, { content: 'บันทึกไว้', mentionedUserIds: [a.id] }, actor, scope);
    expect(await db.chatNote.findUnique({ where: { id: note.id } })).not.toBeNull();
    expect(await db.staffInboxItem.count({ where: { targetId: note.id } })).toBe(0);
    expect(gateway.emitToStaff).not.toHaveBeenCalled();
  });
  it('original note read/pin/unpin operations all enforce current scope and preserve one pin per room', async () => {
    const first = await controller.create(roomId, { content: 'First note' }, { user: actor }, {});
    const second = await controller.create(roomId, { content: 'Second note' }, { user: actor }, scope);
    await controller.pin(roomId, first.id, { user: actor }, scope);
    await controller.pin(roomId, second.id, { user: actor }, scope);
    expect(await db.chatNote.count({ where: { roomId, pinnedAt: { not: null } } })).toBe(1);
    await expect(controller.list(roomId, { user: forbidden }, scope)).rejects.toThrow();
    await expect(controller.unpin(roomId, second.id, { user: forbidden }, scope)).rejects.toThrow();
    expect((await controller.list(roomId, { user: actor }, scope)).map(n => n.id)).toContain(second.id);
    await controller.unpin(roomId, second.id, { user: actor }, scope);
    expect(await db.chatNote.count({ where: { roomId, pinnedAt: { not: null } } })).toBe(0);
  });
  it('rolls back the note, mentions and audit if notification insertion fails, without a socket hint', async () => {
    const requestId = randomUUID();
    await db.$executeRawUnsafe(`CREATE FUNCTION test_reject_mention() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'MENTION' THEN RAISE EXCEPTION 'synthetic rollback'; END IF; RETURN NEW; END; $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER test_reject_mention BEFORE INSERT ON staff_inbox_items FOR EACH ROW EXECUTE FUNCTION test_reject_mention()`);
    try {
      await expect(service.create(roomId, { content: 'Atomic note', mentionedUserIds: [a.id], clientRequestId: requestId }, actor, scope)).rejects.toThrow();
      expect(await db.chatNote.count({ where: { requestKey: { contains: requestId } } })).toBe(0);
      expect(gateway.emitNoteChanged).not.toHaveBeenCalled();
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_reject_mention ON staff_inbox_items');
      await db.$executeRawUnsafe('DROP FUNCTION test_reject_mention()');
    }
  });
  it('deleted notes leave a safe notification marker and can no longer be read by a deep link', async () => {
    const note = await service.create(roomId, { content: 'ข้อความที่ลบแล้ว', mentionedUserIds: [a.id] }, actor, scope);
    await controller.remove(roomId, note.id, { user: actor }, scope);
    const result = await inbox.list(a,scope);
    expect(result.data.find(item => item.targetId === note.id)).toMatchObject({ title: 'โน้ตถูกลบ', targetDeleted: true });
    expect(JSON.stringify(result)).not.toContain('ข้อความที่ลบแล้ว');
    await expect(new ChatWorkQueryService(db,access).target(a,scope,'NOTE',note.id)).rejects.toThrow();
  });
});
