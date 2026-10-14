import { readFileSync } from 'fs';
import { resolve } from 'path';
import { startDocumentsApp, DocumentsHarness, Client } from './support/harness';
import { seedDocumentsWorld } from './support/fixtures';

describe('UX/UI chatbot pages on the migrated database', () => {
  let h: DocumentsHarness, api: Client, roomId: string;
  beforeAll(async () => {
    h = await startDocumentsApp();
    const world = await seedDocumentsWorld(h.prisma);
    const session = await h.login(world.users.owner.email, world.password);
    api = h.client({ session, company: 'FINANCE' });
    const room = await h.prisma.chatRoom.create({ data: { channel: 'LINE_FINANCE', lineUserId: `uxui-${world.prefix}` } });
    roomId = room.id;
    await h.prisma.chatMessage.create({ data: { roomId, role: 'CUSTOMER', text: 'ข้อมูลสังเคราะห์ UX/UI', intent: `uxui-${world.prefix}`, costUsd: 0.02 } });
    await h.prisma.chatMessage.create({ data: { room: { create: { channel: 'LINE_SHOP', lineUserId: `uxui-shop-${world.prefix}` } }, role: 'CUSTOMER', text: 'ไม่รวมในสถิติ FINANCE', costUsd: 9 } });
  }, 180000);
  afterAll(async () => { await h?.close(); });
  it('serves analytics from rooms, excluding SHOP messages from FINANCE totals', async () => {
    const overview = (await api.get('/chatbot/finance/admin/analytics').expect(200)).body.data;
    expect(overview.today.messages).toBe(1);
    expect(overview.today.totalCostUsd).toBe(0.02);
    expect(overview.topIntents).toHaveLength(1);
    const stats = (await api.get('/chatbot/finance/admin/analytics/date-range?startDate=2000-01-01&endDate=2100-01-01').expect(200)).body.data;
    expect(stats.totalMessages).toBe(1);
    expect(stats.totalCost).toBe(0.02);
    expect(stats.dailyStats[0].messages).toBe(1);
  });
  it('preserves old suggestion room identifiers and safely accepts an already repaired database', async () => {
    const migration = readFileSync(resolve(__dirname, '../../prisma/migrations/20261026000000_repair_chat_suggestion_room_column/migration.sql'), 'utf8');
    await h.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE SCHEMA uxui_suggestion_repair');
      await tx.$executeRawUnsafe('SET LOCAL search_path TO uxui_suggestion_repair');
      await tx.$executeRawUnsafe('CREATE TABLE chat_kb_suggestions (id text PRIMARY KEY, session_id text NOT NULL)');
      await tx.$executeRawUnsafe('CREATE INDEX chat_kb_suggestions_session_id_idx ON chat_kb_suggestions(session_id)');
      await tx.$executeRaw`INSERT INTO chat_kb_suggestions(id, session_id) VALUES ('existing-suggestion', ${roomId})`;
      await tx.$executeRawUnsafe(migration);
      await tx.$executeRawUnsafe(migration);
      expect(await tx.$queryRaw`SELECT id, room_id FROM chat_kb_suggestions`).toEqual([{ id: 'existing-suggestion', room_id: roomId }]);
      const indexes = await tx.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`;
      expect(indexes.map(i => i.indexname)).toContain('chat_kb_suggestions_room_id_idx');
      await tx.$executeRawUnsafe('DROP SCHEMA uxui_suggestion_repair CASCADE');
    });
  });
  it('loads suggestions with roomId using the real migration chain', async () => {
    const suggestion = await h.prisma.chatKbSuggestion.create({ data: { roomId, customerQuestion: 'คำถามทดสอบ UX/UI', suggestedIntent: 'uxui', source: 'handoff' } });
    const response = (await api.get('/chatbot/finance/admin/learning/suggestions?status=PENDING').expect(200)).body.data;
    expect(response.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: suggestion.id, roomId })]));
    expect(h.external.calls).toEqual([]);
  });
});
