import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FinanceApplicationFilesService } from '../services/finance-application-files.service';
import * as media from '../../credit-check/services/media-fetch.util';
import { hashLockKey } from '../../../utils/advisory-lock.util';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
const actor = { id: 'u1', role: 'OWNER' };
const draft = { id: 'app-1', roomId: 'room-1', status: 'DRAFT', productId: 'p-1', files: [] as any[], room: { channel: 'FACEBOOK' } };

function build(overrides: Record<string, unknown> = {}, ocrOverrides: Record<string, unknown> = {}) {
  const prisma: any = {
    chatMessage: { findFirst: jest.fn() },
    externalFinanceApplicationFile: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockImplementation(({ data }) => ({ id: 'f-1', ...data })), findFirst: jest.fn(), update: jest.fn() },
    productPhoto: { findUnique: jest.fn() },
    product: { findFirst: jest.fn() },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    $executeRawUnsafe: jest.fn(),
    ...overrides,
  };
  const storage = { configured: true, upload: jest.fn().mockResolvedValue('k'), delete: jest.fn().mockResolvedValue(undefined), getStream: jest.fn() };
  const applications = { get: jest.fn().mockResolvedValue(draft), access: jest.fn().mockResolvedValue({ channel: 'FACEBOOK' }), addEvent: jest.fn() };
  const lineOa = { downloadContent: jest.fn() };
  const lineFinance = { getMessageContent: jest.fn() };
  const ocr = { extractIdCard: jest.fn(), ...ocrOverrides };
  const service = new FinanceApplicationFilesService(prisma, storage as any, applications as any, lineOa as any, lineFinance as any, ocr as any);
  return { service, prisma, storage, applications, lineOa, lineFinance, ocr };
}

describe('FinanceApplicationFilesService.fromMessage', () => {
  it('copies a Facebook image via fetchProviderMedia and stores it under external-finance/<appId>/', async () => {
    const { service, prisma, storage } = build();
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm1', roomId: 'room-1', type: 'IMAGE', mediaUrl: 'https://scontent.xx.fbcdn.net/a.jpg', externalMessageId: null });
    jest.spyOn(media, 'fetchProviderMedia').mockResolvedValue({ bytes: JPEG, contentType: 'image/jpeg' });
    const file = await service.fromMessage('app-1', { messageId: 'm1', slot: 'INCOME' }, actor);
    expect(storage.upload).toHaveBeenCalledWith(expect.stringMatching(/^external-finance\/app-1\/[0-9a-f-]+\.jpg$/), JPEG, 'image/jpeg');
    expect(file).toMatchObject({ slot: 'INCOME', source: 'CHAT_MESSAGE', sourceMessageId: 'm1', mimeType: 'image/jpeg' });
  });
  it('downloads a LINE finance image by message id when there is no mediaUrl', async () => {
    const { service, prisma, lineFinance } = build();
    (service as any).applications.get.mockResolvedValue({ ...draft, room: { channel: 'LINE_FINANCE' } });
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm2', roomId: 'room-1', type: 'IMAGE', mediaUrl: null, externalMessageId: 'LINE-1' });
    lineFinance.getMessageContent.mockResolvedValue(JPEG);
    await service.fromMessage('app-1', { messageId: 'm2', slot: 'ID_CARD' }, actor);
    expect(lineFinance.getMessageContent).toHaveBeenCalledWith('LINE-1');
  });
  it('404s with an upload hint for a legacy LINE image that has neither mediaUrl nor message id', async () => {
    const { service, prisma } = build();
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm3', roomId: 'room-1', type: 'IMAGE', mediaUrl: null, externalMessageId: null });
    await expect(service.fromMessage('app-1', { messageId: 'm3', slot: 'ID_CARD' }, actor)).rejects.toThrow(NotFoundException);
    await expect(service.fromMessage('app-1', { messageId: 'm3', slot: 'ID_CARD' }, actor)).rejects.toThrow('อัปโหลด');
  });
  it('returns the existing row instead of duplicating the same message', async () => {
    const { service, prisma, storage } = build();
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm1', roomId: 'room-1', type: 'IMAGE', mediaUrl: 'https://scontent.xx.fbcdn.net/a.jpg' });
    prisma.externalFinanceApplicationFile.findMany.mockResolvedValue([{ id: 'f-0', sourceMessageId: 'm1', slot: 'INCOME' }]);
    jest.spyOn(media, 'fetchProviderMedia').mockResolvedValue({ bytes: JPEG, contentType: 'image/jpeg' });
    const file = await service.fromMessage('app-1', { messageId: 'm1', slot: 'INCOME' }, actor);
    expect(file.id).toBe('f-0');
    expect(storage.delete).toHaveBeenCalled(); // ไฟล์ที่อัปโหลดไปแล้วถูกเก็บกวาด
  });
  it('removes the uploaded object when the DB write fails (no orphan)', async () => {
    const { service, prisma, storage } = build();
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm1', roomId: 'room-1', type: 'IMAGE', mediaUrl: 'https://scontent.xx.fbcdn.net/a.jpg' });
    jest.spyOn(media, 'fetchProviderMedia').mockResolvedValue({ bytes: JPEG, contentType: 'image/jpeg' });
    prisma.externalFinanceApplicationFile.create.mockRejectedValue(new Error('db down'));
    await expect(service.fromMessage('app-1', { messageId: 'm1', slot: 'INCOME' }, actor)).rejects.toThrow('db down');
    expect(storage.delete).toHaveBeenCalled();
  });
  it('rejects when the application is closed', async () => {
    const { service } = build();
    (service as any).applications.get.mockResolvedValue({ ...draft, status: 'APPROVED' });
    await expect(service.fromMessage('app-1', { messageId: 'm1', slot: 'INCOME' }, actor)).rejects.toThrow(BadRequestException);
  });
  it('takes an application-scoped advisory lock before checking for a duplicate/MAX_FILES (race fix)', async () => {
    const { service, prisma } = build();
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm1', roomId: 'room-1', type: 'IMAGE', mediaUrl: 'https://scontent.xx.fbcdn.net/a.jpg', externalMessageId: null });
    jest.spyOn(media, 'fetchProviderMedia').mockResolvedValue({ bytes: JPEG, contentType: 'image/jpeg' });
    await service.fromMessage('app-1', { messageId: 'm1', slot: 'INCOME' }, actor);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      `SELECT pg_advisory_xact_lock(${hashLockKey('finance-app-files:app-1')})`,
    );
    const lockOrder = prisma.$executeRawUnsafe.mock.invocationCallOrder[0];
    const findManyOrder = prisma.externalFinanceApplicationFile.findMany.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(findManyOrder);
  });
});

describe('FinanceApplicationFilesService.fromProduct', () => {
  it('copies the 6 completed angles of a PHONE_USED product into DEVICE_PHOTO', async () => {
    const { service, prisma, storage } = build();
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', category: 'PHONE_USED' });
    const dataUrl = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
    prisma.productPhoto.findUnique.mockResolvedValue({ isCompleted: true, front: dataUrl, back: dataUrl, left: dataUrl, right: dataUrl, top: dataUrl, bottom: dataUrl });
    const files = await service.fromProduct('app-1', actor);
    expect(files).toHaveLength(6);
    expect(storage.upload).toHaveBeenCalledTimes(6);
    expect(files.map((f: any) => f.sourceAngle)).toEqual(['front', 'back', 'left', 'right', 'top', 'bottom']);
  });
  it('400s for a new phone or an incomplete photo set', async () => {
    const { service, prisma } = build();
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', category: 'PHONE_NEW' });
    await expect(service.fromProduct('app-1', actor)).rejects.toThrow('ถ่ายเพิ่ม');
  });
});

describe('FinanceApplicationFilesService.ocrIdCardFromMessage', () => {
  it('loads the chat image and hands a data URL to OcrService.extractIdCard', async () => {
    const { service, prisma, storage, ocr } = build(
      {},
      { extractIdCard: jest.fn().mockResolvedValue({ nationalId: '1234567890123', fullName: 'สมหญิง ใจดี', confidence: 0.95 }) },
    );
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm1', roomId: 'room-1', type: 'IMAGE', mediaUrl: 'https://scontent.xx.fbcdn.net/a.jpg', externalMessageId: null });
    jest.spyOn(media, 'fetchProviderMedia').mockResolvedValue({ bytes: JPEG, contentType: 'image/jpeg' });
    const result = await service.ocrIdCardFromMessage('room-1', 'm1', actor);
    expect(result.nationalId).toBe('1234567890123');
    expect(ocr.extractIdCard).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/jpeg;base64,/), actor.id);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects a PDF with a Thai message', async () => {
    const { service, prisma, ocr } = build();
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm2', roomId: 'room-1', type: 'FILE', mediaUrl: 'https://scontent.xx.fbcdn.net/a.pdf', externalMessageId: null });
    jest.spyOn(media, 'fetchProviderMedia').mockResolvedValue({ bytes: Buffer.from('%PDF-1.4'), contentType: 'application/pdf' });
    await expect(service.ocrIdCardFromMessage('room-1', 'm2', actor)).rejects.toThrow('อ่านบัตรได้เฉพาะรูปภาพ');
    expect(ocr.extractIdCard).not.toHaveBeenCalled();
  });

  it('404s when the message is not found in the room', async () => {
    const { service, prisma } = build();
    prisma.chatMessage.findFirst.mockResolvedValue(null);
    await expect(service.ocrIdCardFromMessage('room-1', 'm3', actor)).rejects.toThrow(NotFoundException);
  });
});
