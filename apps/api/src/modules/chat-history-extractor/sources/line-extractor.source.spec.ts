import { Test } from '@nestjs/testing';
import { LineExtractorSource } from './line-extractor.source';
import { PrismaService } from '../../../prisma/prisma.service';

describe('LineExtractorSource', () => {
  let source: LineExtractorSource;
  let prisma: { chatMessage: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { chatMessage: { findMany: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [LineExtractorSource, { provide: PrismaService, useValue: prisma }],
    }).compile();
    source = mod.get(LineExtractorSource);
  });

  it('extracts LINE messages grouped by room, oldest first', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([
      { id: 'm1', roomId: 'r1', role: 'CUSTOMER', text: 'สวัสดี', createdAt: new Date('2026-01-01'), externalMessageId: null },
      { id: 'm2', roomId: 'r1', role: 'STAFF', text: 'สวัสดีครับ', createdAt: new Date('2026-01-01T00:01:00'), externalMessageId: null },
    ]);
    const result = await source.extract({ channel: 'LINE_FINANCE', since: new Date('2025-04-22') });
    expect(result).toHaveLength(2);
    expect(result[0].roomId).toBe('r1');
    expect(result[0].text).toBe('สวัสดี');
    expect(result[0].role).toBe('CUSTOMER');
    expect(result[1].role).toBe('STAFF');
  });

  it('maps BOT role to STAFF', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([
      { id: 'm1', roomId: 'r1', role: 'BOT', text: 'ตอบอัตโนมัติ', createdAt: new Date('2026-01-01'), externalMessageId: 'ext1' },
    ]);
    const result = await source.extract({ channel: 'LINE_FINANCE', since: new Date('2025-04-22') });
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('STAFF');
    expect(result[0].externalMessageId).toBe('ext1');
  });

  it('maps non-STAFF/BOT roles to CUSTOMER', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([
      { id: 'm1', roomId: 'r1', role: 'SYSTEM', text: 'system msg', createdAt: new Date('2026-01-01'), externalMessageId: null },
      { id: 'm2', roomId: 'r2', role: 'AUTO_TRIGGER', text: 'reminder', createdAt: new Date('2026-01-01'), externalMessageId: null },
    ]);
    const result = await source.extract({ channel: 'LINE_FINANCE', since: new Date('2025-04-22') });
    expect(result[0].role).toBe('CUSTOMER');
    expect(result[1].role).toBe('CUSTOMER');
  });

  it('passes the correct query filters to prisma', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([]);
    const since = new Date('2025-04-22');
    await source.extract({ channel: 'LINE_FINANCE', since });
    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          room: { channel: 'LINE_FINANCE' },
          createdAt: { gte: since },
          deletedAt: null,
          text: { not: null },
        }),
        orderBy: [{ roomId: 'asc' }, { createdAt: 'asc' }],
      }),
    );
  });
});
