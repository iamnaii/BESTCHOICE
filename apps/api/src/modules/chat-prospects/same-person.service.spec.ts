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
    expect(res).toEqual([{ customerId: 'c-line', name: 'นาย สมชาย ใจดี', channel: 'LINE', hasPhone: true, chatPlaceholder: false, createdAt: new Date('2026-09-03'), mergeDirection: 'absorb_current_into_other' }]);
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
    await service.dismiss('room-1', 'c-no');
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
