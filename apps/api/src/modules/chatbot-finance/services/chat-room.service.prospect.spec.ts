import { ChatChannel } from '@prisma/client';
import { ChatRoomService } from './chat-room.service';

describe('ChatRoomService.getOrCreate → ผู้สนใจอัตโนมัติ (LINE การเงิน)', () => {
  let prisma: any;
  let lineClient: any;
  let chatProspects: any;
  let service: ChatRoomService;

  beforeEach(() => {
    prisma = {
      chatRoom: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
      customerLineLink: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    lineClient = { getUserProfile: jest.fn().mockResolvedValue({ displayName: 'มิ้นท์', pictureUrl: null }) };
    chatProspects = { ensureForRoom: jest.fn().mockResolvedValue({ customerId: 'cust-auto', created: true }) };
    service = new ChatRoomService(prisma, lineClient, undefined, chatProspects);
  });

  it('ไม่มี link → สร้างห้องแล้วเรียก ensureForRoom คืน customerId ที่ได้', async () => {
    prisma.chatRoom.create.mockResolvedValue({ id: 'room-fin', channel: ChatChannel.LINE_FINANCE, customerId: null });
    const room = await service.getOrCreate('Ufin1');
    expect(chatProspects.ensureForRoom).toHaveBeenCalledWith('room-fin');
    expect(room.customerId).toBe('cust-auto');
  });

  it('มี link อยู่แล้ว → ห้องผูกลูกค้าจริงตั้งแต่สร้าง ไม่เรียก ensureForRoom', async () => {
    prisma.customerLineLink.findUnique.mockResolvedValue({ customerId: 'cust-real' });
    prisma.chatRoom.create.mockResolvedValue({ id: 'room-fin', channel: ChatChannel.LINE_FINANCE, customerId: 'cust-real' });
    const room = await service.getOrCreate('Ufin1');
    expect(chatProspects.ensureForRoom).not.toHaveBeenCalled();
    expect(room.customerId).toBe('cust-real');
  });

  it('ensureForRoom ล้ม → ยังคืนห้อง', async () => {
    chatProspects.ensureForRoom.mockRejectedValue(new Error('x'));
    prisma.chatRoom.create.mockResolvedValue({ id: 'room-fin', channel: ChatChannel.LINE_FINANCE, customerId: null });
    await expect(service.getOrCreate('Ufin1')).resolves.toMatchObject({ id: 'room-fin' });
  });
});

describe('ChatRoomService.linkRoomToCustomer (หลัง LIFF verify)', () => {
  it('ห้องยังไม่มีเจ้าของ → ผูกตรง ไม่เรียก absorb', async () => {
    const prisma: any = {
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue({ id: 'room-fin', customerId: null, customer: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const merge = { absorbPlaceholder: jest.fn() };
    const service = new ChatRoomService(prisma, {} as any, undefined, undefined, merge as any);
    await service.linkRoomToCustomer('room-fin', 'cust-real');
    expect(merge.absorbPlaceholder).not.toHaveBeenCalled();
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({
      where: { id: 'room-fin' },
      data: { customerId: 'cust-real', verifiedAt: expect.any(Date), verificationAttempts: 0 },
    });
  });

  it('ห้องถือ placeholder → absorb ก่อน แล้วค่อยตั้ง verifiedAt', async () => {
    const prisma: any = {
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue({ id: 'room-fin', customerId: 'p1', customer: { acquisitionSource: 'CHAT_LINE_FINANCE', phone: null, nationalId: null, deletedAt: null } }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const merge = { absorbPlaceholder: jest.fn().mockResolvedValue({}) };
    const service = new ChatRoomService(prisma, {} as any, undefined, undefined, merge as any);
    await service.linkRoomToCustomer('room-fin', 'cust-real');
    expect(merge.absorbPlaceholder).toHaveBeenCalledWith('p1', 'cust-real', { id: 'system', role: 'SYSTEM' });
    // update ยังคง verificationAttempts: 0 เหมือนก่อน Task 10 — ตัวนี้คือ reset ตัวนับ OTP ล้มเหลว
    // (ยืนยันแล้วว่าโค้ดจริงตั้งค่านี้เสมอที่ chat-room.service.ts:162 — brief ตัด field นี้ออกจากตัวอย่างเทส)
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({
      where: { id: 'room-fin' },
      data: { customerId: 'cust-real', verifiedAt: expect.any(Date), verificationAttempts: 0 },
    });
  });

  it('ห้องผูกลูกค้าจริงคนอื่นอยู่แล้ว → ไม่ทับประวัติ ไม่เรียก absorb (R4 กรณีที่สาม)', async () => {
    const prisma: any = {
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue({ id: 'room-fin', customerId: 'cust-other', customer: { acquisitionSource: null, phone: '0812345678', nationalId: null, deletedAt: null } }),
        update: jest.fn(),
      },
    };
    const merge = { absorbPlaceholder: jest.fn() };
    const service = new ChatRoomService(prisma, {} as any, undefined, undefined, merge as any);
    await service.linkRoomToCustomer('room-fin', 'cust-real');
    expect(merge.absorbPlaceholder).not.toHaveBeenCalled();
    expect(prisma.chatRoom.update).not.toHaveBeenCalled();
  });

  it('absorb placeholder ล้ม (เช่น มีเอกสารพ่วง) → ห้องนี้ยังผูกกับลูกค้าที่ยืนยันตัวตนต่อไป (best-effort)', async () => {
    const prisma: any = {
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue({ id: 'room-fin', customerId: 'p1', customer: { acquisitionSource: 'CHAT_LINE_FINANCE', phone: null, nationalId: null, deletedAt: null } }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const merge = { absorbPlaceholder: jest.fn().mockRejectedValue(new Error('รวมไม่ได้: ผู้สนใจคนนี้มีใบจอง 1 รายการ')) };
    const service = new ChatRoomService(prisma, {} as any, undefined, undefined, merge as any);
    await expect(service.linkRoomToCustomer('room-fin', 'cust-real')).resolves.toBeUndefined();
    expect(merge.absorbPlaceholder).toHaveBeenCalledWith('p1', 'cust-real', { id: 'system', role: 'SYSTEM' });
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({
      where: { id: 'room-fin' },
      data: { customerId: 'cust-real', verifiedAt: expect.any(Date), verificationAttempts: 0 },
    });
  });
});
