import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MediaContentService } from './media-content.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineFinanceClientService } from '../../chatbot-finance/services/line-finance-client.service';
import { StorageService } from '../../storage/storage.service';

describe('MediaContentService.getAudioUrl', () => {
  let service: MediaContentService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let line: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let storage: any;

  beforeEach(async () => {
    prisma = {
      chatMessage: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    line = {
      getMessageContent: jest.fn().mockResolvedValue(Buffer.from('audio')),
    };
    storage = {
      upload: jest.fn().mockResolvedValue(undefined),
      getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/audio.m4a'),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        MediaContentService,
        { provide: PrismaService, useValue: prisma },
        { provide: LineFinanceClientService, useValue: line },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = mod.get(MediaContentService);
  });

  it('throws NotFound when message missing', async () => {
    prisma.chatMessage.findUnique.mockResolvedValue(null);
    await expect(service.getAudioUrl('msg-1')).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequest when message type is not AUDIO', async () => {
    prisma.chatMessage.findUnique.mockResolvedValue({ id: 'msg-1', type: 'TEXT' });
    await expect(service.getAudioUrl('msg-1')).rejects.toThrow(BadRequestException);
  });

  it('returns signed URL directly when mediaUrl is already cached (non-line://)', async () => {
    prisma.chatMessage.findUnique.mockResolvedValue({
      id: 'msg-1',
      type: 'AUDIO',
      mediaUrl: 'chat-audio/msg-1.m4a',
    });
    const result = await service.getAudioUrl('msg-1');
    expect(result.url).toBe('https://signed.example/audio.m4a');
    expect(line.getMessageContent).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('throws BadRequest when LINE download needed but externalMessageId missing', async () => {
    prisma.chatMessage.findUnique.mockResolvedValue({
      id: 'msg-1',
      type: 'AUDIO',
      mediaUrl: null,
      externalMessageId: null,
    });
    await expect(service.getAudioUrl('msg-1')).rejects.toThrow(BadRequestException);
  });

  it('downloads from LINE, uploads to storage, updates DB, returns signed URL', async () => {
    prisma.chatMessage.findUnique.mockResolvedValue({
      id: 'msg-1',
      type: 'AUDIO',
      mediaUrl: null,
      externalMessageId: 'line-ext-123',
    });
    const result = await service.getAudioUrl('msg-1');
    expect(line.getMessageContent).toHaveBeenCalledWith('line-ext-123');
    expect(storage.upload).toHaveBeenCalledWith(
      'chat-audio/msg-1.m4a',
      expect.any(Buffer),
      'audio/mp4',
    );
    expect(prisma.chatMessage.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { mediaUrl: 'chat-audio/msg-1.m4a' },
    });
    expect(result.url).toContain('https://');
  });

  it('downloads from LINE when mediaUrl starts with line:// (not yet migrated)', async () => {
    prisma.chatMessage.findUnique.mockResolvedValue({
      id: 'msg-1',
      type: 'AUDIO',
      mediaUrl: 'line://placeholder',
      externalMessageId: 'line-ext-123',
    });
    await service.getAudioUrl('msg-1');
    expect(line.getMessageContent).toHaveBeenCalled();
  });

  it('wraps LINE download failure in friendly Thai BadRequest', async () => {
    prisma.chatMessage.findUnique.mockResolvedValue({
      id: 'msg-1',
      type: 'AUDIO',
      mediaUrl: null,
      externalMessageId: 'line-ext-123',
    });
    line.getMessageContent.mockRejectedValue(new Error('LINE API down'));
    await expect(service.getAudioUrl('msg-1')).rejects.toThrow(
      /ไม่สามารถดาวน์โหลดไฟล์เสียงได้/,
    );
  });
});
