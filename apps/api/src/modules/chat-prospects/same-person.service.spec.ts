import { SamePersonService } from './same-person.service';

const me = { id: 'p1', name: 'สมชาย ใจดี', facebookName: 'สมชาย ใจดี', acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null, deletedAt: null };
const room = { id: 'room-1', channel: 'FACEBOOK', customerId: 'p1', dismissedSamePersonIds: [] as string[], customer: me };
const cand = (over: Partial<any>) => ({
  id: 'c', name: 'สมชาย ใจดี', facebookName: null, phone: null, nationalId: null, acquisitionSource: 'CHAT_LINE_SHOP',
  createdAt: new Date('2026-09-03'), chatRooms: [{ channel: 'LINE_SHOP' }], ...over,
});

function build(candidates: any[], r: any = room) {
  const prisma: any = {
    chatRoom: { findUnique: jest.fn().mockResolvedValue(r), update: jest.fn().mockResolvedValue({}) },
    customer: { findMany: jest.fn().mockResolvedValue(candidates) },
  };
  return { prisma, service: new SamePersonService(prisma) };
}

describe('SamePersonService.findForRoom', () => {
  it('ชื่อตรงกัน (หลัง normalize) ในช่องทางอื่น → ขึ้นคำใบ้ ทิศทาง: ห้องนี้ placeholder ดูดเข้าอีกคน', async () => {
    const { service } = build([cand({ id: 'c-line', name: 'นาย สมชาย ใจดี', phone: '0812345678' })]);
    const res = await service.findForRoom('room-1');
    expect(res).toEqual([{ customerId: 'c-line', name: 'นาย สมชาย ใจดี', channel: 'LINE', channelDetail: 'LINE_SHOP', hasPhone: true, chatPlaceholder: false, createdAt: new Date('2026-09-03'), mergeDirection: 'absorb_current_into_other' }]);
  });
  // A2: ป้าย "LINE ร้าน" / "LINE การเงิน" ต้องรู้ช่องทางจริง — channel (โลโก้) ยุบสอง LINE เป็นค่าเดียว
  // จึงเพิ่ม channelDetail (additive) · channel เดิมคงไว้เป็นสัญญาเดิมของ API
  it('channelDetail = ChatChannel จริงของห้องล่าสุด (LINE_FINANCE) · channel ยังเป็นโลโก้ LINE เหมือนเดิม', async () => {
    const { service } = build([cand({ id: 'c-fin', chatRooms: [{ channel: 'LINE_FINANCE' }] })]);
    const [hint] = await service.findForRoom('room-1');
    expect(hint).toMatchObject({ customerId: 'c-fin', channel: 'LINE', channelDetail: 'LINE_FINANCE' });
  });
  it('คนที่ไม่มีห้องแชท (มีเบอร์) → channel และ channelDetail เป็น null ทั้งคู่', async () => {
    const { service } = build([cand({ id: 'c-noroom', phone: '0833333333', chatRooms: [] })]);
    const [hint] = await service.findForRoom('room-1');
    expect(hint).toMatchObject({ customerId: 'c-noroom', channel: null, channelDetail: null, hasPhone: true });
  });
  it('ชื่อคล้ายแต่ไม่ตรง → ไม่ขึ้น', async () => {
    const { service } = build([cand({ id: 'c2', name: 'สมชาย ใจดีมาก' })]);
    await expect(service.findForRoom('room-1')).resolves.toEqual([]);
  });
  it('ช่องทางเดียวกันและไม่มีเบอร์ → ไม่ขึ้น (คนละ PSID = คนละคน)', async () => {
    const { service } = build([cand({ id: 'c3', chatRooms: [{ channel: 'FACEBOOK' }] })]);
    await expect(service.findForRoom('room-1')).resolves.toEqual([]);
  });
  it('เรียงคนมีเบอร์ก่อน แล้วเก่าก่อน · สูงสุด 3', async () => {
    const { service } = build([
      cand({ id: 'a', createdAt: new Date('2026-09-05') }),
      cand({ id: 'b', phone: '0899999999', createdAt: new Date('2026-09-09') }),
      cand({ id: 'c', createdAt: new Date('2026-09-01') }),
      cand({ id: 'd', createdAt: new Date('2026-09-02') }),
    ]);
    expect((await service.findForRoom('room-1')).map((p) => p.customerId)).toEqual(['b', 'c', 'd']);
  });
  it('ทิศทางรวม: ห้องนี้คนจริง อีกคน placeholder → ดูดอีกคนเข้าห้องนี้ · placeholder ทั้งคู่ → ใหม่เข้าเก่า · คนจริงทั้งคู่ → none', async () => {
    const realMe = { ...room, customer: { ...me, phone: '0811111111' } };
    let r = await build([cand({ id: 'x' })], realMe).service.findForRoom('room-1');
    expect(r[0].mergeDirection).toBe('absorb_other_into_current');
    r = await build([cand({ id: 'y', createdAt: new Date('2026-09-20') })], { ...room, customer: { ...me, createdAt: new Date('2026-09-10') } } as any).service.findForRoom('room-1');
    expect(r[0].mergeDirection).toBe('absorb_other_into_current'); // อีกคนใหม่กว่า → เข้าห้องนี้ (เก่ากว่า)
    r = await build([cand({ id: 'z', phone: '0822222222' })], realMe).service.findForRoom('room-1');
    expect(r[0].mergeDirection).toBe('none');
  });
  it('คนที่กด "ไม่ใช่" แล้วถูกตัดออกตั้งแต่ query', async () => {
    const { service, prisma } = build([], { ...room, dismissedSamePersonIds: ['c-no'] });
    await service.findForRoom('room-1');
    expect(prisma.customer.findMany.mock.calls[0][0].where.id).toEqual({ not: 'p1', notIn: ['c-no'] });
  });
  it('dismiss → push customerId ลง dismissedSamePersonIds', async () => {
    const { service, prisma } = build([]);
    await service.dismiss('room-1', 'c-no', { id: 'staff-1', role: 'OWNER' });
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({ where: { id: 'room-1' }, data: { dismissedSamePersonIds: { push: 'c-no' } } });
  });
  it('ไม่มีชื่อให้เทียบ (name ว่าง, facebookName null) → คืน [] โดยไม่ค้นหาเพิ่ม', async () => {
    const { service, prisma } = build([], { ...room, customer: { ...me, name: '', facebookName: null } });
    await expect(service.findForRoom('room-1')).resolves.toEqual([]);
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });
  it('ลูกค้าของห้องนี้ถูกลบไปแล้ว (deletedAt) → คืน [] โดยไม่ค้นหาเพิ่ม', async () => {
    const { service, prisma } = build([], { ...room, customer: { ...me, deletedAt: new Date('2026-09-01') } });
    await expect(service.findForRoom('room-1')).resolves.toEqual([]);
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });
});

// I1/R19: dismiss ต้องใช้กติกาเข้าถึงห้องเดียวกับ RoomManagerService.linkCustomer (sibling write path) —
// เขียนห้ามหลวมกว่าอ่าน: ไม่มี room-scope guard เดิม ทำให้ SALES ที่ไม่ได้ถือห้องเขียนห้องที่ตัวเองเปิดอ่านไม่ได้
describe('SamePersonService.dismiss — ขอบเขตห้อง (I1/R19)', () => {
  it('SALES ไม่ได้ถือห้องนี้ (คนอื่นถืออยู่) → 403 ไม่อัปเดต', async () => {
    const { service, prisma } = build([], { ...room, assignedToId: 'staff-9' });
    await expect(
      service.dismiss('room-1', 'c-no', { id: 'sales-2', role: 'SALES' }),
    ).rejects.toThrow('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้');
    expect(prisma.chatRoom.update).not.toHaveBeenCalled();
  });

  it('ห้องไม่พบ หรือถูกลบไปแล้ว → 404 ไทย ไม่อัปเดต', async () => {
    const notFound = build([], null);
    await expect(
      notFound.service.dismiss('room-x', 'c-no', { id: 'u1', role: 'OWNER' }),
    ).rejects.toThrow('ห้องแชทไม่พบหรือถูกลบ');
    expect(notFound.prisma.chatRoom.update).not.toHaveBeenCalled();

    const deleted = build([], { ...room, deletedAt: new Date('2026-09-01') });
    await expect(
      deleted.service.dismiss('room-1', 'c-no', { id: 'u1', role: 'OWNER' }),
    ).rejects.toThrow('ห้องแชทไม่พบหรือถูกลบ');
    expect(deleted.prisma.chatRoom.update).not.toHaveBeenCalled();
  });

  it('SALES ที่ถือห้องเอง และ OWNER ข้ามสาขา (รวมห้องที่ยังไม่มีเจ้าของ) → อัปเดตสำเร็จ', async () => {
    const assignedToSelf = build([], { ...room, assignedToId: 'sales-2' });
    await assignedToSelf.service.dismiss('room-1', 'c-no', { id: 'sales-2', role: 'SALES' });
    expect(assignedToSelf.prisma.chatRoom.update).toHaveBeenCalledWith({
      where: { id: 'room-1' },
      data: { dismissedSamePersonIds: { push: 'c-no' } },
    });

    const owner = build([], { ...room, assignedToId: 'sales-9' });
    await owner.service.dismiss('room-1', 'c-no', { id: 'owner-1', role: 'OWNER' });
    expect(owner.prisma.chatRoom.update).toHaveBeenCalledWith({
      where: { id: 'room-1' },
      data: { dismissedSamePersonIds: { push: 'c-no' } },
    });

    // ห้องยังไม่มีเจ้าของ (assignedToId ว่าง) — SALES คนไหนก็ยังกด "ไม่ใช่" ได้ เหมือนสิทธิ์เปิดห้อง (pickup)
    const unassigned = build([], { ...room, assignedToId: null });
    await unassigned.service.dismiss('room-1', 'c-no', { id: 'sales-3', role: 'SALES' });
    expect(unassigned.prisma.chatRoom.update).toHaveBeenCalledWith({
      where: { id: 'room-1' },
      data: { dismissedSamePersonIds: { push: 'c-no' } },
    });
  });
});
