import { Prisma } from '@prisma/client';
import { CustomerChatRoomsService } from './customer-chat-rooms.service';
import { PrismaService } from '../../../prisma/prisma.service';

type Room = Record<string, unknown>;

function fakeDb(rooms: Room[]) {
  const findMany = jest.fn(async (args: any) => {
    const where = args.where;
    const matching = rooms.filter(room =>
      where.customerId.in.includes(room.customerId) &&
      // 🔴 ถ้า service ลืม deletedAt: null ห้องที่ถูกลบจะผ่านตรงนี้เข้าไป
      (!('deletedAt' in where) || where.deletedAt !== null || room.deletedAt == null));
    return [...matching].sort((a, b) => {
      const delta = (b.lastMessageAt as Date).getTime() - (a.lastMessageAt as Date).getTime();
      return delta || String(a.id).localeCompare(String(b.id));
    });
  });
  return { findMany, chatRoom: { findMany } };
}

const room = (over: Room): Room => ({
  customerId: 'cu1', channel: 'LINE_FINANCE', lastCustomerAt: null,
  lastMessageAt: new Date('2026-09-01T00:00:00Z'), deletedAt: null, assignedTo: null, ...over,
});

const run = (rooms: Room[], ids = ['cu1']) => {
  const db = fakeDb(rooms);
  const service = new CustomerChatRoomsService(db as unknown as PrismaService);
  return service.forCustomers(ids, db as unknown as Prisma.TransactionClient).then(result => ({ result, db }));
};

describe('CustomerChatRoomsService', () => {
  it('LINE_FINANCE + LINE_SHOP ยุบเป็นโลโก้ LINE ใบเดียว และห้องที่คุยล่าสุดเป็นห้องที่ลิงก์พาไป', async () => {
    const { result } = await run([
      room({ id: 'r-shop', channel: 'LINE_SHOP', lastMessageAt: new Date('2026-09-10T00:00:00Z') }),
      room({ id: 'r-fin', channel: 'LINE_FINANCE', lastMessageAt: new Date('2026-09-02T00:00:00Z') }),
      room({ id: 'r-fb', channel: 'FACEBOOK', lastMessageAt: new Date('2026-09-05T00:00:00Z') }),
    ]);
    expect(result.get('cu1')!.chatRooms).toEqual([
      { roomId: 'r-shop', channel: 'LINE_SHOP', logo: 'LINE' },
      { roomId: 'r-fb', channel: 'FACEBOOK', logo: 'FACEBOOK' },
    ]);
  });

  it('ห้องที่ถูกลบไม่โผล่ (deletedAt: null ต้องอยู่ใน where)', async () => {
    const { result, db } = await run([
      room({ id: 'r-dead', channel: 'TIKTOK', deletedAt: new Date('2026-09-09T00:00:00Z'), lastMessageAt: new Date('2026-09-11T00:00:00Z') }),
      room({ id: 'r-live', channel: 'FACEBOOK' }),
    ]);
    expect(db.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
    expect(result.get('cu1')!.chatRooms.map(entry => entry.roomId)).toEqual(['r-live']);
  });

  it('ติดต่อล่าสุดเอา lastCustomerAt ก่อน lastMessageAt และบอกที่มาของค่า', async () => {
    const { result } = await run([
      room({ id: 'r1', lastMessageAt: new Date('2026-09-12T00:00:00Z'), lastCustomerAt: new Date('2026-09-08T00:00:00Z') }),
    ]);
    expect(result.get('cu1')).toMatchObject({
      lastContactAt: '2026-09-08T00:00:00.000Z',
      lastContactSource: 'CUSTOMER',
    });
    const fallback = await run([room({ id: 'r1', lastMessageAt: new Date('2026-09-12T00:00:00Z') })]);
    expect(fallback.result.get('cu1')).toMatchObject({
      lastContactAt: '2026-09-12T00:00:00.000Z',
      lastContactSource: 'ROOM',
    });
  });

  it('ติดต่อล่าสุดเป็นค่าที่ใหม่สุดข้ามทุกห้องของคนเดียวกัน', async () => {
    const { result } = await run([
      room({ id: 'r-new', channel: 'FACEBOOK', lastMessageAt: new Date('2026-09-10T00:00:00Z'), lastCustomerAt: new Date('2026-09-01T00:00:00Z') }),
      room({ id: 'r-old', channel: 'LINE_SHOP', lastMessageAt: new Date('2026-09-05T00:00:00Z'), lastCustomerAt: new Date('2026-09-04T00:00:00Z') }),
    ]);
    expect(result.get('cu1')!.lastContactAt).toBe('2026-09-04T00:00:00.000Z');
  });

  it('ผู้ดูแลมาจากห้องที่มีคนรับจริง ไม่ถูกห้องใหม่ที่ยังว่างลบทิ้ง', async () => {
    const { result } = await run([
      room({ id: 'r-new', channel: 'FACEBOOK', lastMessageAt: new Date('2026-09-10T00:00:00Z'), assignedTo: null }),
      room({ id: 'r-old', channel: 'LINE_SHOP', lastMessageAt: new Date('2026-09-05T00:00:00Z'), assignedTo: { id: 'u1', name: 'พนักงาน' } }),
    ]);
    expect(result.get('cu1')!.assignedTo).toEqual({ id: 'u1', name: 'พนักงาน' });
  });

  it('คนที่ไม่มีห้องได้ค่าว่างครบทุกฟิลด์ (คอลัมน์แชทโชว์ขีด)', async () => {
    const { result } = await run([], ['cu1', 'cu2']);
    expect(result.get('cu2')).toEqual({ chatRooms: [], lastContactAt: null, lastContactSource: null, assignedTo: null });
  });

  it('1 query ต่อหนึ่งชุด id — ห้ามกลับไปอ่านรายแถว', async () => {
    const ids = Array.from({ length: 200 }, (_, index) => `cu${index}`);
    const { db } = await run([], ids);
    expect(db.findMany).toHaveBeenCalledTimes(1);
  });
});
