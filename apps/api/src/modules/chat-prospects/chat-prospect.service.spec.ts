import { Logger } from '@nestjs/common';
import { ChatProspectService } from './chat-prospect.service';

// เงียบ log "[prospect] created …" ให้ผลเทสสะอาด
beforeAll(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));
afterAll(() => jest.restoreAllMocks());

function makeTx() {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    chatRoom: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    customerLineLink: { findUnique: jest.fn().mockResolvedValue(null) },
    customer: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
}

const ROOM = {
  id: 'room-1', channel: 'FACEBOOK', lineUserId: null, externalUserId: 'psid-1234567890',
  customerId: null, displayName: 'สมชาย ใจดี', createdAt: new Date('2026-09-12T07:32:00Z'), deletedAt: null,
};

describe('ChatProspectService.ensureForRoom', () => {
  let tx: ReturnType<typeof makeTx>;
  let prisma: any;
  let service: ChatProspectService;

  beforeEach(() => {
    tx = makeTx();
    prisma = { chatRoom: { findUnique: jest.fn() }, $transaction: jest.fn((fn: any) => fn(tx)) };
    service = new ChatProspectService(prisma);
  });

  it('ห้องมีเจ้าของแล้ว → คืน customerId เดิม ไม่เปิดทรานแซกชัน', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({ ...ROOM, customerId: 'cust-9' });
    await expect(service.ensureForRoom('room-1')).resolves.toEqual({ customerId: 'cust-9', created: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ห้องใหม่ Facebook → ล็อกต่อคน สร้าง placeholder ด้วยชื่อห้อง ที่มา CHAT_FACEBOOK PSID createdAt ของห้อง แล้วผูกห้อง', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue(ROOM);
    tx.chatRoom.findUnique.mockResolvedValue({ customerId: null });
    tx.chatRoom.findFirst.mockResolvedValue(null);
    tx.customer.create.mockResolvedValue({ id: 'cust-new' });

    await expect(service.ensureForRoom('room-1')).resolves.toEqual({ customerId: 'cust-new', created: true });

    // pg_advisory_xact_lock(hashtext('FACEBOOK:psid-1234567890')) — $executeRaw ตาม Ruling R2
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [lockSql, lockKey] = tx.$executeRaw.mock.calls[0];
    expect(lockSql.join('?')).toContain('pg_advisory_xact_lock(hashtext(');
    expect(lockKey).toBe('FACEBOOK:psid-1234567890');
    expect(tx.customer.create).toHaveBeenCalledWith({
      data: {
        name: 'สมชาย ใจดี', phone: null, acquisitionSource: 'CHAT_FACEBOOK',
        createdAt: ROOM.createdAt, facebookUserId: 'psid-1234567890', facebookName: 'สมชาย ใจดี',
      },
      select: { id: true },
    });
    expect(tx.chatRoom.update).toHaveBeenCalledWith({ where: { id: 'room-1' }, data: { customerId: 'cust-new' } });
  });

  it('ห้องไม่มีชื่อ → ชื่อ fallback "Facebook #7890" และไม่ตั้ง facebookName', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({ ...ROOM, displayName: null });
    tx.chatRoom.findUnique.mockResolvedValue({ customerId: null });
    tx.chatRoom.findFirst.mockResolvedValue(null);
    tx.customer.create.mockResolvedValue({ id: 'cust-new' });
    await service.ensureForRoom('room-1');
    expect(tx.customer.create.mock.calls[0][0].data).toMatchObject({ name: 'Facebook #7890', facebookName: null });
  });

  it('คนเดิมมีห้องอื่นในช่องทางเดียวกันที่ผูกแล้ว → ใช้คนนั้น ไม่สร้างใหม่', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue(ROOM);
    tx.chatRoom.findUnique.mockResolvedValue({ customerId: null });
    tx.chatRoom.findFirst.mockResolvedValue({ customerId: 'cust-old' });
    await expect(service.ensureForRoom('room-1')).resolves.toEqual({ customerId: 'cust-old', created: false });
    expect(tx.customer.create).not.toHaveBeenCalled();
    expect(tx.chatRoom.update).toHaveBeenCalledWith({ where: { id: 'room-1' }, data: { customerId: 'cust-old' } });
  });

  it('ห้อง LINE ร้าน: ลูกค้าที่ผูก lineIdShop ไว้แล้ว → ใช้คนนั้น (ช่องโหว่เดิม getOrCreateRoom เช็คแค่ CustomerLineLink)', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({ ...ROOM, channel: 'LINE_SHOP', lineUserId: 'Uabc123def', externalUserId: null });
    tx.chatRoom.findUnique.mockResolvedValue({ customerId: null });
    tx.chatRoom.findFirst.mockResolvedValue(null);
    tx.customer.findFirst.mockResolvedValue({ id: 'cust-line' });
    await expect(service.ensureForRoom('room-1')).resolves.toEqual({ customerId: 'cust-line', created: false });
    expect(tx.customer.findFirst).toHaveBeenCalledWith({ where: { lineIdShop: 'Uabc123def', deletedAt: null }, select: { id: true } });
    expect(tx.customer.create).not.toHaveBeenCalled();
  });

  it('ห้อง LINE การเงินที่มี CustomerLineLink → ใช้คนจาก link ก่อนคอลัมน์', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({ ...ROOM, channel: 'LINE_FINANCE', lineUserId: 'Ufin', externalUserId: null });
    tx.chatRoom.findUnique.mockResolvedValue({ customerId: null });
    tx.chatRoom.findFirst.mockResolvedValue(null);
    tx.customerLineLink.findUnique.mockResolvedValue({ customerId: 'cust-link' });
    await expect(service.ensureForRoom('room-1')).resolves.toEqual({ customerId: 'cust-link', created: false });
    expect(tx.customerLineLink.findUnique).toHaveBeenCalledWith({
      where: {
        lineUserId_channel: { lineUserId: 'Ufin', channel: 'FINANCE' },
        unlinkedAt: null, deletedAt: null, customer: { is: { deletedAt: null } },
      },
      select: { customerId: true },
    });
    expect(tx.customer.findFirst).not.toHaveBeenCalled();
  });

  it('ห้อง LINE การเงิน: ไม่มี link ที่ยังผูกอยู่ → ไปหาคอลัมน์ lineIdFinance', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({ ...ROOM, channel: 'LINE_FINANCE', lineUserId: 'Ufin', externalUserId: null });
    tx.chatRoom.findUnique.mockResolvedValue({ customerId: null });
    tx.chatRoom.findFirst.mockResolvedValue(null);
    tx.customer.findFirst.mockResolvedValue({ id: 'cust-col' });
    await expect(service.ensureForRoom('room-1')).resolves.toEqual({ customerId: 'cust-col', created: false });
    expect(tx.chatRoom.findFirst).toHaveBeenCalledWith({
      where: { deletedAt: null, channel: 'LINE_FINANCE', customerId: { not: null }, customer: { is: { deletedAt: null } }, lineUserId: 'Ufin' },
      orderBy: { createdAt: 'asc' },
      select: { customerId: true },
    });
    expect(tx.customer.findFirst).toHaveBeenCalledWith({ where: { lineIdFinance: 'Ufin', deletedAt: null }, select: { id: true } });
    expect(tx.chatRoom.update).toHaveBeenCalledWith({ where: { id: 'room-1' }, data: { customerId: 'cust-col' } });
  });

  it('ห้อง LINE ร้านสร้าง placeholder ด้วยที่มา CHAT_LINE_SHOP และไม่แตะช่อง facebook*', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({ ...ROOM, channel: 'LINE_SHOP', lineUserId: 'Uabc123def', externalUserId: null, displayName: 'มิ้นท์' });
    tx.chatRoom.findUnique.mockResolvedValue({ customerId: null });
    tx.chatRoom.findFirst.mockResolvedValue(null);
    tx.customer.create.mockResolvedValue({ id: 'cust-new' });
    await service.ensureForRoom('room-1');
    expect(tx.customer.create.mock.calls[0][0].data).toEqual({
      name: 'มิ้นท์', phone: null, acquisitionSource: 'CHAT_LINE_SHOP', createdAt: ROOM.createdAt,
    });
  });

  it('ระหว่างรอล็อก มีคนผูกห้องไปแล้ว → คืนคนนั้น ไม่สร้างซ้ำ', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue(ROOM);
    tx.chatRoom.findUnique.mockResolvedValue({ customerId: 'cust-raced' });
    await expect(service.ensureForRoom('room-1')).resolves.toEqual({ customerId: 'cust-raced', created: false });
    expect(tx.customer.create).not.toHaveBeenCalled();
  });

  it('ห้องถูกลบ / ไม่มีรหัสผู้ใช้ → null', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({ ...ROOM, deletedAt: new Date() });
    await expect(service.ensureForRoom('room-1')).resolves.toBeNull();
    prisma.chatRoom.findUnique.mockResolvedValue({ ...ROOM, externalUserId: null });
    await expect(service.ensureForRoom('room-1')).resolves.toBeNull();
  });
});

describe('ChatProspectService.syncNameFromRoom', () => {
  it('placeholder ที่ยังชื่อ fallback → ตั้งชื่อตามห้อง (+facebookName)', async () => {
    const prisma: any = {
      chatRoom: { findUnique: jest.fn().mockResolvedValue({
        id: 'room-1', channel: 'FACEBOOK', lineUserId: null, externalUserId: 'psid-1234567890', displayName: 'สมชาย ใจดี',
        customer: { id: 'cust-1', name: 'Facebook #7890', acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null, deletedAt: null },
      }) },
      customer: { update: jest.fn().mockResolvedValue({}) },
    };
    const service = new ChatProspectService(prisma);
    await expect(service.syncNameFromRoom('room-1')).resolves.toBe(true);
    expect(prisma.customer.update).toHaveBeenCalledWith({ where: { id: 'cust-1' }, data: { name: 'สมชาย ใจดี', facebookName: 'สมชาย ใจดี' } });
  });
  it('คนที่มีเบอร์แล้ว หรือชื่อถูกแก้มือแล้ว → ไม่แตะ', async () => {
    const base = { id: 'room-1', channel: 'FACEBOOK', lineUserId: null, externalUserId: 'psid-1234567890', displayName: 'สมชาย ใจดี' };
    const prisma: any = { chatRoom: { findUnique: jest.fn() }, customer: { update: jest.fn() } };
    const service = new ChatProspectService(prisma);
    prisma.chatRoom.findUnique.mockResolvedValue({ ...base, customer: { id: 'c', name: 'Facebook #7890', acquisitionSource: 'CHAT_FACEBOOK', phone: '0812345678', nationalId: null, deletedAt: null } });
    await expect(service.syncNameFromRoom('room-1')).resolves.toBe(false);
    prisma.chatRoom.findUnique.mockResolvedValue({ ...base, customer: { id: 'c', name: 'สมชาย ใจดี (ร้าน)', acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null, deletedAt: null } });
    await expect(service.syncNameFromRoom('room-1')).resolves.toBe(false);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });
  it('ห้องไม่มีรหัสผู้ใช้ → ไม่แตะ (ไม่เทียบกับชื่อ fallback "Facebook #" ที่ไม่มีเลขท้าย)', async () => {
    const prisma: any = {
      chatRoom: { findUnique: jest.fn().mockResolvedValue({
        id: 'room-1', channel: 'FACEBOOK', lineUserId: null, externalUserId: null, displayName: 'สมชาย ใจดี',
        customer: { id: 'c', name: 'Facebook #', acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null, deletedAt: null },
      }) },
      customer: { update: jest.fn() },
    };
    const service = new ChatProspectService(prisma);
    await expect(service.syncNameFromRoom('room-1')).resolves.toBe(false);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });
});
