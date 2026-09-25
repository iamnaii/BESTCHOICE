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
    externalFinanceApplication: { count: jest.fn().mockResolvedValue(1) },
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
  // minor 4 — ส่ง id ไป LINE API ตามช่องทางของห้องเท่านั้น
  it('downloads a LINE shop image through the shop OA (not the finance OA)', async () => {
    const { service, prisma, lineOa, lineFinance } = build();
    (service as any).applications.get.mockResolvedValue({ ...draft, room: { channel: 'LINE_SHOP' } });
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm5', roomId: 'room-1', type: 'IMAGE', mediaUrl: null, externalMessageId: 'LS-1' });
    lineOa.downloadContent.mockResolvedValue(JPEG);
    await service.fromMessage('app-1', { messageId: 'm5', slot: 'ID_CARD' }, actor);
    expect(lineOa.downloadContent).toHaveBeenCalledWith('LS-1', 'line-shop');
    expect(lineFinance.getMessageContent).not.toHaveBeenCalled();
  });
  it('never sends a Facebook message id to the LINE API — 404 with the upload hint', async () => {
    const { service, prisma, lineOa, lineFinance } = build();
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm6', roomId: 'room-1', type: 'IMAGE', mediaUrl: null, externalMessageId: 'm_fb_mid' });
    await expect(service.fromMessage('app-1', { messageId: 'm6', slot: 'ID_CARD' }, actor)).rejects.toThrow('อัปโหลด');
    expect(lineOa.downloadContent).not.toHaveBeenCalled();
    expect(lineFinance.getMessageContent).not.toHaveBeenCalled();
  });
  it('a line:// media reference is fetched from LINE by message id (never by the fake URL)', async () => {
    const { service, prisma, lineFinance } = build();
    const fetchSpy = jest.spyOn(media, 'fetchProviderMedia');
    fetchSpy.mockClear();
    (service as any).applications.get.mockResolvedValue({ ...draft, room: { channel: 'LINE_FINANCE' } });
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm7', roomId: 'room-1', type: 'IMAGE', mediaUrl: 'line://content/LF-7', externalMessageId: 'LF-7' });
    lineFinance.getMessageContent.mockResolvedValue(JPEG);
    await service.fromMessage('app-1', { messageId: 'm7', slot: 'ID_CARD' }, actor);
    expect(lineFinance.getMessageContent).toHaveBeenCalledWith('LF-7');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('a line:// media reference without a message id → 404 with the upload hint', async () => {
    const { service, prisma, lineFinance } = build();
    (service as any).applications.get.mockResolvedValue({ ...draft, room: { channel: 'LINE_FINANCE' } });
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm8', roomId: 'room-1', type: 'IMAGE', mediaUrl: 'line://content/x', externalMessageId: null });
    await expect(service.fromMessage('app-1', { messageId: 'm8', slot: 'ID_CARD' }, actor)).rejects.toThrow(NotFoundException);
    expect(lineFinance.getMessageContent).not.toHaveBeenCalled();
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
  // I3 — กันมุมซ้ำตัวจริงอยู่ใต้ล็อกของใบยื่น: คำขอที่สองที่ผ่านตัวกรองนอกล็อกมาได้ ต้องไม่สร้างแถวซ้ำ
  it('an angle that another request already attached (seen only inside the lock) is not duplicated; the extra upload is removed', async () => {
    const { service, prisma, storage } = build();
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', category: 'PHONE_USED' });
    const dataUrl = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
    prisma.productPhoto.findUnique.mockResolvedValue({ isCompleted: true, front: dataUrl, back: dataUrl, left: dataUrl, right: dataUrl, top: dataUrl, bottom: dataUrl });
    const angles = ['front', 'back', 'left', 'right', 'top', 'bottom'];
    prisma.externalFinanceApplicationFile.findMany
      .mockResolvedValueOnce([]) // ตัวกรองนอกล็อก — ยังไม่เห็นอะไร
      .mockResolvedValue(angles.map((a, i) => ({ id: `f-${i}`, source: 'PRODUCT_PHOTO', sourceAngle: a, slot: 'DEVICE_PHOTO', sentAt: null }))); // ใต้ล็อก — อีกคำขอแนบครบแล้ว
    const files = await service.fromProduct('app-1', actor);
    expect(files).toHaveLength(0);
    expect(prisma.externalFinanceApplicationFile.create).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledTimes(6);
  });
  it('stock photos already SENT (e.g. of the previous device before a MORE_INFO device change) do not block the new device\'s angles', async () => {
    const { service, prisma } = build();
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', category: 'PHONE_USED' });
    const dataUrl = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
    prisma.productPhoto.findUnique.mockResolvedValue({ isCompleted: true, front: dataUrl, back: dataUrl, left: dataUrl, right: dataUrl, top: dataUrl, bottom: dataUrl });
    const sentOld = ['front', 'back', 'left', 'right', 'top', 'bottom'].map((a, i) => ({ id: `old-${i}`, source: 'PRODUCT_PHOTO', sourceAngle: a, slot: 'DEVICE_PHOTO', sentAt: new Date() }));
    prisma.externalFinanceApplicationFile.findMany.mockImplementation(({ where }: any) => Promise.resolve(where.sentAt === null ? [] : sentOld));
    const files = await service.fromProduct('app-1', actor);
    expect(files).toHaveLength(6);
    expect(prisma.externalFinanceApplicationFile.create).toHaveBeenCalledTimes(6);
  });
  it('409 when the application switched to another device while the stock photos were being copied', async () => {
    const { service, prisma, storage } = build();
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', category: 'PHONE_USED' });
    const dataUrl = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
    prisma.productPhoto.findUnique.mockResolvedValue({ isCompleted: true, front: dataUrl, back: dataUrl, left: dataUrl, right: dataUrl, top: dataUrl, bottom: dataUrl });
    prisma.externalFinanceApplication.count.mockResolvedValue(0);
    await expect(service.fromProduct('app-1', actor)).rejects.toThrow('เครื่องในใบยื่นเปลี่ยนไป');
    expect(prisma.externalFinanceApplication.count).toHaveBeenCalledWith({ where: { id: 'app-1', productId: 'p-1', deletedAt: null } });
    expect(prisma.externalFinanceApplicationFile.create).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalled();
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

  it('accepts a LINE finance image (no mediaUrl, provider gives no contentType) by sniffing magic bytes instead of trusting contentType', async () => {
    const { service, prisma, applications, lineFinance, ocr } = build(
      {},
      { extractIdCard: jest.fn().mockResolvedValue({ nationalId: '1234567890123', fullName: 'สมหญิง ใจดี', confidence: 0.95 }) },
    );
    applications.access.mockResolvedValue({ channel: 'LINE_FINANCE' });
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm4', roomId: 'room-1', type: 'IMAGE', mediaUrl: null, externalMessageId: 'L1' });
    lineFinance.getMessageContent.mockResolvedValue(JPEG);
    const result = await service.ocrIdCardFromMessage('room-1', 'm4', actor);
    expect(lineFinance.getMessageContent).toHaveBeenCalledWith('L1');
    expect(ocr.extractIdCard).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/jpeg;base64,/), actor.id);
    expect(result.nationalId).toBe('1234567890123');
  });
});
