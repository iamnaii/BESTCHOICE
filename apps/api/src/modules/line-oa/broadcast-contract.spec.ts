import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BroadcastService } from './broadcast.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

describe('Broadcast composer to LINE contract', () => {
  let service: BroadcastService;
  const prisma = {
    customer: {
      count: jest.fn().mockResolvedValue(3),
      findMany: jest.fn().mockResolvedValue([{ lineIdShop: 'synthetic-recipient' }]),
    },
    broadcastMessage: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    systemConfig: { upsert: jest.fn() },
  };
  let send: jest.SpyInstance;
  const integrationConfig = { getValue: jest.fn() };
  beforeEach(async () => {
    jest.clearAllMocks();
    integrationConfig.getValue.mockResolvedValue('dummy-test-token');
    send = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (!String(url).startsWith('https://api.line.me/v2/bot/message/'))
        throw new Error('Unexpected external request');
      return new Response('{}', { status: 200 });
    });
    prisma.broadcastMessage.create.mockImplementation(async ({ data }) => {
      const record = { id: 'draft', ...data };
      prisma.broadcastMessage.findUnique.mockResolvedValue(record);
      return record;
    });
    const module = await Test.createTestingModule({
      providers: [
        BroadcastService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: StorageService, useValue: {} },
        {
          provide: IntegrationConfigService,
          useValue: integrationConfig,
        },
      ],
    }).compile();
    service = module.get(BroadcastService);
  });
  afterEach(() => send.mockRestore());

  it('records FAILED when token lookup throws after approval, without an outbound send', async () => {
    await service.sendBroadcast({
      audience: 'ALL',
      createdById: 'creator',
      messages: [{ type: 'text', content: 'test' }],
    });
    integrationConfig.getValue.mockRejectedValueOnce(new Error('Token lookup unavailable'));
    await expect(service.approveBroadcast('draft', 'reviewer')).resolves.toMatchObject({
      success: false,
    });
    expect(send).not.toHaveBeenCalled();
    expect(prisma.broadcastMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft' },
        data: expect.objectContaining({
          status: 'FAILED',
          sentAt: null,
          errorMessage: 'Token lookup unavailable',
        }),
      }),
    );
  });

  it('preserves video and thumbnail through pending approval and dispatches only after a second user approves', async () => {
    const result = await service.sendBroadcast({
      audience: 'OVERDUE',
      createdById: 'creator',
      messages: [
        {
          type: 'video',
          content: {
            videoUrl: 'https://example.test/video.mp4',
            thumbnailUrl: 'https://example.test/cover.png',
          },
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(send).not.toHaveBeenCalled();
    await expect(service.approveBroadcast('draft', 'creator')).rejects.toThrow('ผู้อนุมัติ');
    await expect(service.approveBroadcast('draft', 'reviewer')).resolves.toMatchObject({
      success: true,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({
      to: ['synthetic-recipient'],
      messages: [
        {
          type: 'video',
          originalContentUrl: 'https://example.test/video.mp4',
          previewImageUrl: 'https://example.test/cover.png',
        },
      ],
    });
  });
  it('rejects an unsupported item instead of silently dropping it from a mixed broadcast', async () => {
    await expect(
      service.sendBroadcast({
        audience: 'ALL',
        createdById: 'creator',
        messages: [
          { type: 'text', content: { text: 'Keep both messages' } },
          { type: 'unknown', content: {} },
        ],
      }),
    ).rejects.toThrow('รูปแบบข้อความ');
    expect(prisma.broadcastMessage.create).not.toHaveBeenCalled();
  });

  it('maps existing composer image, flex and rich fields without losing messages', async () => {
    const contents = {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'Offer' }] },
    };
    await service.sendBroadcast({
      audience: 'active',
      createdById: 'creator',
      messages: [
        { type: 'image', content: { imageUrl: 'https://example.test/image.png' } },
        { type: 'flex', content: { flexContents: contents } },
        {
          type: 'rich',
          content: {
            imageUrl: 'https://example.test/rich.png',
            linkUrl: 'https://example.test/offer',
          },
        },
      ],
    });
    expect(prisma.broadcastMessage.create.mock.calls[0][0].data.audience).toBe('EXISTING');
    await service.approveBroadcast('draft', 'reviewer');
    const payload = JSON.parse(send.mock.calls[0][1].body);
    expect(payload.messages).toEqual([
      {
        type: 'image',
        originalContentUrl: 'https://example.test/image.png',
        previewImageUrl: 'https://example.test/image.png',
      },
      { type: 'flex', altText: 'ข้อความจาก BESTCHOICE', contents },
      {
        type: 'flex',
        altText: 'ข้อความจาก BESTCHOICE',
        contents: {
          type: 'bubble',
          hero: {
            type: 'image',
            url: 'https://example.test/rich.png',
            size: 'full',
            aspectMode: 'fit',
            action: { type: 'uri', uri: 'https://example.test/offer' },
          },
        },
      },
    ]);
  });

  it.each([
    [{ type: 'video', content: { videoUrl: 'https://example.test/v.mp4' } }],
    [
      {
        type: 'video',
        content: {
          videoUrl: 'http://example.test/v.mp4',
          thumbnailUrl: 'https://example.test/p.png',
        },
      },
    ],
    [{ type: 'text', content: { text: '' } }],
    [{ type: 'flex', content: { flexContents: {} } }],
  ])('rejects malformed composer payload %j before saving', async (message) => {
    await expect(
      service.sendBroadcast({ audience: 'ALL', createdById: 'creator', messages: [message] }),
    ).rejects.toThrow();
    expect(prisma.broadcastMessage.create).not.toHaveBeenCalled();
  });
  it('rejects an unknown audience before saving', async () => {
    await expect(
      service.sendBroadcast({
        audience: 'typo',
        createdById: 'creator',
        messages: [{ type: 'text', content: 'test' }],
      }),
    ).rejects.toThrow('กลุ่มผู้รับ');
    expect(prisma.broadcastMessage.create).not.toHaveBeenCalled();
  });
  it('does not dispatch when another reviewer already claimed the pending record', async () => {
    await service.sendBroadcast({
      audience: 'ALL',
      createdById: 'creator',
      messages: [{ type: 'text', content: 'test' }],
    });
    prisma.broadcastMessage.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.approveBroadcast('draft', 'reviewer')).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
