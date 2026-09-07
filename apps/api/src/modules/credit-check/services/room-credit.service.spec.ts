import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Readable } from 'stream';
import { RoomCreditService } from './room-credit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { OcrService } from '../../ocr/ocr.service';

describe('room statement attachments and analysis', () => {
  const actor = { id: 'staff', role: 'SALES' };
  const bytes = Buffer.from('%PDF-1.7\n%%EOF');
  const room = { id: 'room', assignedToId: 'staff', customerId: null, deletedAt: null };
  const file = {
    id: 'file',
    roomId: 'room',
    key: 'room-credit/room/file.pdf',
    name: 'Statement.pdf',
    mimeType: 'application/pdf',
    size: bytes.length,
    sourceMessageId: 'message',
    deletedAt: null,
  };
  const db = {
    chatRoom: { findFirst: jest.fn() },
    chatMessage: { findFirst: jest.fn() },
    roomCreditFile: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    roomCreditAnalysis: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    creditCheck: { create: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const storage = { configured: true, upload: jest.fn(), getStream: jest.fn(), delete: jest.fn() };
  const ocr = { analyzeBankStatement: jest.fn() };
  const service = new RoomCreditService(
    db as unknown as PrismaService,
    storage as unknown as StorageService,
    ocr as unknown as OcrService,
  );
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = fetchMock;
    storage.configured = true;
    db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
    db.chatRoom.findFirst.mockResolvedValue({ ...room });
    db.chatMessage.findFirst.mockResolvedValue({
      id: 'message',
      roomId: 'room',
      type: 'FILE',
      mediaUrl: 'https://scontent.xx.fbcdn.net/document',
    });
    db.roomCreditFile.findMany.mockResolvedValue([]);
    db.roomCreditFile.create.mockResolvedValue(file);
    db.roomCreditFile.findFirst.mockResolvedValue(file);
    db.roomCreditAnalysis.findFirst.mockResolvedValue(null);
    db.roomCreditAnalysis.findMany.mockResolvedValue([]);
    db.roomCreditAnalysis.create.mockResolvedValue({
      id: 'analysis',
      roomId: 'room',
      fileIds: ['file'],
    });
    db.roomCreditAnalysis.updateMany.mockResolvedValue({ count: 1 });
    storage.getStream.mockImplementation(async () => Readable.from([bytes]));
    fetchMock.mockResolvedValue(
      new Response(bytes, { headers: { 'content-type': 'application/pdf' } }),
    );
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('checks room access before reading message or fetching any media', async () => {
    db.chatRoom.findFirst.mockResolvedValue({ ...room, assignedToId: 'other' });
    await expect(service.attachMessage('room', 'message', actor)).rejects.toThrow(
      ForbiddenException,
    );
    expect(db.chatMessage.findFirst).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects a guessed message from another room', async () => {
    db.chatMessage.findFirst.mockResolvedValue(null);
    await expect(service.attachMessage('room', 'elsewhere', actor)).rejects.toThrow();
    expect(db.chatMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'elsewhere', roomId: 'room' }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('stores an attachment without a customer and never analyzes on attach', async () => {
    await service.attachMessage('room', 'message', actor);
    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^room-credit\/room\//),
      bytes,
      'application/pdf',
    );
    expect(db.roomCreditFile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: 'room',
          sourceMessageId: 'message',
          mimeType: 'application/pdf',
        }),
      }),
    );
    expect(ocr.analyzeBankStatement).not.toHaveBeenCalled();
    expect(db.creditCheck.create).not.toHaveBeenCalled();
  });
  it('rejects expired files with 400 and does not save a ghost attachment', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 403 }));
    await expect(service.attachMessage('room', 'message', actor)).rejects.toThrow('ไฟล์หมดอายุ');
    expect(storage.upload).not.toHaveBeenCalled();
    expect(db.roomCreditFile.create).not.toHaveBeenCalled();
  });
  it('does not trust Content-Type for a response containing HTML', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>expired</html>', { headers: { 'content-type': 'application/pdf' } }),
    );
    await expect(service.attachMessage('room', 'message', actor)).rejects.toThrow(
      BadRequestException,
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('blocks a redirect into a private/internal host', async () => {
    fetchMock.mockResolvedValue(
      new Response('', { status: 302, headers: { location: 'http://127.0.0.1/secret' } }),
    );
    await expect(service.attachMessage('room', 'message', actor)).rejects.toThrow(
      BadRequestException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('rejects oversize responses before allocating their body', async () => {
    fetchMock.mockResolvedValue(
      new Response('', { headers: { 'content-length': String(11 * 1024 * 1024) } }),
    );
    await expect(service.attachMessage('room', 'message', actor)).rejects.toThrow('10MB');
  });
  it('refuses storage that would silently skip upload', async () => {
    storage.configured = false;
    await expect(service.attachMessage('room', 'message', actor)).rejects.toThrow();
    expect(db.roomCreditFile.create).not.toHaveBeenCalled();
  });
  it('rejects stale selection rather than analyzing silently missing files', async () => {
    db.roomCreditFile.findMany.mockResolvedValue([file]);
    await expect(service.analyze('room', ['file', 'missing'], actor)).rejects.toThrow(
      ConflictException,
    );
    expect(ocr.analyzeBankStatement).not.toHaveBeenCalled();
  });
  it('blocks concurrent analyses and changes while an analysis is in progress', async () => {
    db.roomCreditAnalysis.findFirst.mockResolvedValue({
      id: 'busy',
      status: 'ANALYZING',
      createdAt: new Date(),
    });
    db.roomCreditFile.findMany.mockResolvedValue([file]);
    await expect(service.analyze('room', ['file'], actor)).rejects.toThrow(ConflictException);
    await expect(service.remove('room', 'file', actor)).rejects.toThrow(ConflictException);
    expect(ocr.analyzeBankStatement).not.toHaveBeenCalled();
  });
  it('analyzes all stored files together and persists a result without creating a customer', async () => {
    db.roomCreditFile.findMany.mockResolvedValue([
      file,
      { ...file, id: 'second', key: 'room-credit/room/second.pdf' },
    ]);
    ocr.analyzeBankStatement.mockResolvedValue({
      totalIncome: 50000,
      totalExpense: 35000,
      balance: 1000,
      dateRange: '3 months',
      confidence: 0.9,
    });
    await service.analyze('room', ['file', 'second'], actor);
    expect(ocr.analyzeBankStatement).toHaveBeenCalledWith([
      expect.stringMatching(/^data:application\/pdf;base64,/),
      expect.stringMatching(/^data:application\/pdf;base64,/),
    ], actor.id);
    expect(db.roomCreditAnalysis.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'analysis', status: 'ANALYZING' }),
        data: expect.objectContaining({
          status: 'COMPLETED',
          result: expect.objectContaining({ totalIncome: 50000 }),
        }),
      }),
    );
    expect(db.creditCheck.create).not.toHaveBeenCalled();
  });
  it('checks room access for stored downloads as well', async () => {
    db.chatRoom.findFirst.mockResolvedValue({ ...room, assignedToId: 'other' });
    await expect(service.download('room', 'file', actor)).rejects.toThrow(ForbiddenException);
    expect(storage.getStream).not.toHaveBeenCalled();
  });
  it('cleans up only the new object if attachment persistence fails', async () => {
    db.roomCreditFile.create.mockRejectedValue(new Error('database failed'));
    await expect(service.attachMessage('room', 'message', actor)).rejects.toThrow(
      'database failed',
    );
    expect(storage.delete).toHaveBeenCalledWith(storage.upload.mock.calls[0][0]);
  });
});
