import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { BroadcastService } from './broadcast.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

// Only the disposable PostgreSQL harness may run this suite.
const isolated = process.env.CREDIT_RUN_API_REGRESSION === '1' &&
  /\/bc_chat_credit_test\?host=\/tmp\/bc-chat-credit\./.test(process.env.DATABASE_URL ?? '');
describe.runIf(isolated)('Broadcast lifecycle on isolated PostgreSQL', () => {
  const db = new PrismaClient();
  const service = new BroadcastService(new ConfigService({}), db as unknown as PrismaService,
    {} as StorageService, { getValue: async () => 'dummy-isolated-line-token' } as unknown as IntegrationConfigService);
  let users: string[];
  let records: string[] = [];
  const sends: unknown[] = [];
  beforeAll(async () => {
    users = await Promise.all(['creator', 'reviewer-a', 'reviewer-b'].map(async name => (await db.user.create({ data: {
      email: `broadcast-${name}-${Date.now()}@example.test`, name, role: 'OWNER', password: 'unused-test-only',
    } })).id));
  });
  beforeEach(() => {
    sends.length = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (String(url) !== 'https://api.line.me/v2/bot/message/broadcast') throw new Error('Unexpected outbound request');
      sends.push(JSON.parse(String(options?.body)));
      return new Response('{}', { status: 200 });
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.broadcastMessage.deleteMany({ where: { id: { in: records } } });
    records = [];
  });
  afterAll(async () => { await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect(); });
  async function draft(scheduledAt?: Date) {
    const result = await service.sendBroadcast({ audience: 'all', createdById: users[0], scheduledAt,
      messages: [{ type: 'video', content: { videoUrl: 'https://media.example.test/video.mp4', thumbnailUrl: 'https://media.example.test/cover.png' } }],
    });
    if (!result.id) throw new Error('Expected pending broadcast');
    records.push(result.id); return result.id;
  }
  it('persists the complete video and allows only one concurrent approval to send', async () => {
    const id = await draft();
    expect((await service.getHistory()).data.find(row => row.id === id)).toMatchObject({ status: 'PENDING_APPROVAL', audience: 'ALL' });
    await expect(service.approveBroadcast(id, users[0])).rejects.toThrow('ผู้อนุมัติ');
    expect(sends).toHaveLength(0);
    const outcomes = await Promise.allSettled([service.approveBroadcast(id, users[1]), service.approveBroadcast(id, users[2])]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(sends).toEqual([{ messages: [{ type: 'video', originalContentUrl: 'https://media.example.test/video.mp4', previewImageUrl: 'https://media.example.test/cover.png' }] }]);
    expect(await db.broadcastMessage.findUnique({ where: { id } })).toMatchObject({ status: 'SENT' });
  });
  it('keeps an approval/rejection race consistent with the single winning action', async () => {
    const id = await draft();
    const outcomes = await Promise.allSettled([service.approveBroadcast(id, users[1]), service.rejectBroadcast(id, users[2], 'ทดสอบการปฏิเสธ')]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const record = await db.broadcastMessage.findUniqueOrThrow({ where: { id } });
    expect(['SENT', 'REJECTED']).toContain(record.status);
    expect(sends).toHaveLength(record.status === 'SENT' ? 1 : 0);
  });
  it('supports scheduling, cancellation and cron dispatch without sending twice', async () => {
    const cancelled = await draft(new Date(Date.now() + 60_000));
    await service.approveBroadcast(cancelled, users[1]);
    expect(await service.cancelScheduled(cancelled)).toMatchObject({ success: true });
    expect(await db.broadcastMessage.findUnique({ where: { id: cancelled } })).toMatchObject({ status: 'CANCELLED' });
    const due = await draft(new Date(Date.now() + 60_000));
    await service.approveBroadcast(due, users[1]);
    expect(sends).toHaveLength(0);
    await db.broadcastMessage.update({ where: { id: due }, data: { scheduledAt: new Date(Date.now() - 1_000) } });
    expect(await service.sendScheduledMessages()).toEqual({ sent: 1, failed: 0 });
    expect(await service.sendScheduledMessages()).toEqual({ sent: 0, failed: 0 });
    expect(sends).toHaveLength(1);
  });
  it('backfills legacy messages without changing status and also supports schema-synced tables', async () => {
    const migration = readFileSync(resolve(process.cwd(), 'prisma/migrations/20261003210000_broadcast_multi_message_payload/migration.sql'), 'utf8');
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE SCHEMA broadcast_migration_test');
      await tx.$executeRawUnsafe('SET LOCAL search_path TO broadcast_migration_test');
      await tx.$executeRawUnsafe(`CREATE TABLE broadcast_messages (id text, type text NOT NULL, content jsonb NOT NULL, status text)`);
      await tx.$executeRawUnsafe(`INSERT INTO broadcast_messages VALUES ('legacy', 'text', '{"text":"ข้อความเดิม"}', 'SENT')`);
      await tx.$executeRawUnsafe(migration);
      await tx.$executeRawUnsafe(migration);
      const rows = await tx.$queryRawUnsafe<{ messages: unknown; status: string }[]>('SELECT messages, status FROM broadcast_messages');
      expect(rows).toEqual([{ messages: [{ type: 'text', content: { text: 'ข้อความเดิม' } }], status: 'SENT' }]);
      await tx.$executeRawUnsafe(`INSERT INTO broadcast_messages (id, messages) VALUES ('new', '[{"type":"text","content":"new"}]')`);
      await tx.$executeRawUnsafe('DROP TABLE broadcast_messages');
      await tx.$executeRawUnsafe('CREATE TABLE broadcast_messages (messages jsonb NOT NULL)');
      await tx.$executeRawUnsafe(migration);
      await tx.$executeRawUnsafe('DROP SCHEMA broadcast_migration_test CASCADE');
    });
  });

});
