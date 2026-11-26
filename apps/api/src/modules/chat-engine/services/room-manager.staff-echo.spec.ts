import { MessageRole } from '@prisma/client';
import { RoomManagerService } from './room-manager.service';

const T0 = new Date('2026-11-27T03:00:00.000Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

type Row = { id: string; role: MessageRole; createdAt: Date; deletedAt?: Date | null };

/** prisma จำลองเท่าที่ isHumanStaffEcho + shouldSkipFirstOutboundClear ใช้ — ห้อง r1 ห้องเดียว */
function makeRoomManager(
  rows: Row[],
  opts: { waitingSince?: Date | null; responseCycles?: unknown } = {},
) {
  const messages = rows.map((r) => ({ roomId: 'r1', ...r, deletedAt: r.deletedAt ?? null }));
  const waitingSince = opts.waitingSince === undefined ? T0 : opts.waitingSince;
  const prisma = {
    chatRoom: {
      findUnique: jest.fn(async ({ where }: any) => (where.id === 'r1' ? { waitingSince } : null)),
    },
    chatMessage: {
      findUnique: jest.fn(
        async ({ where }: any) => messages.find((m) => m.id === where.id) ?? null,
      ),
      count: jest.fn(
        async ({ where }: any) =>
          messages.filter(
            (m) =>
              m.roomId === where.roomId && m.deletedAt === null && where.role.in.includes(m.role),
          ).length,
      ),
      findFirst: jest.fn(
        async ({ where }: any) =>
          messages
            .filter(
              (m) =>
                m.roomId === where.roomId &&
                m.role === where.role &&
                m.deletedAt === null &&
                m.createdAt.getTime() <= where.createdAt.lte.getTime(),
            )
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
      ),
    },
  };
  return new RoomManagerService(
    prisma as any,
    {} as any,
    undefined,
    undefined,
    undefined,
    undefined,
    opts.responseCycles as any,
  );
}

const C = MessageRole.CUSTOMER;
const S = MessageRole.STAFF;
const B = MessageRole.BOT;

describe('RoomManagerService.isHumanStaffEcho — กติกาเดียวของ "คนตอบ"', () => {
  it('คนตอบ 30 วิหลังลูกค้าทัก (ห้องเคยมีขาออกแล้ว) → true', async () => {
    const rm = makeRoomManager([
      { id: 'c1', role: C, createdAt: at(0) },
      { id: 'b1', role: B, createdAt: at(1) },
      { id: 'e1', role: S, createdAt: at(30) },
    ]);
    await expect(rm.isHumanStaffEcho('r1', 'e1')).resolves.toBe(true);
  });

  it('echo 2 วิหลังข้อความลูกค้าใบล่าสุด = เพจตอบเอง → false', async () => {
    const rm = makeRoomManager([
      { id: 'c1', role: C, createdAt: at(0) },
      { id: 'b1', role: B, createdAt: at(1) },
      { id: 'c2', role: C, createdAt: at(100) },
      { id: 'e1', role: S, createdAt: at(102) },
    ]);
    await expect(rm.isHumanStaffEcho('r1', 'e1')).resolves.toBe(false);
  });

  it('ขาออกใบแรกของห้องภายใน 60 วิหลังเริ่มรอ = ข้อความทักทาย → false แม้ช้ากว่า 5 วิ', async () => {
    const rm = makeRoomManager([
      { id: 'c1', role: C, createdAt: at(0) },
      { id: 'e1', role: S, createdAt: at(30) },
    ]);
    await expect(rm.isHumanStaffEcho('r1', 'e1')).resolves.toBe(false);
  });

  it('ข้อความลูกค้าที่บันทึกหลัง echo ไม่นับ → true', async () => {
    const rm = makeRoomManager([
      { id: 'c1', role: C, createdAt: at(0) },
      { id: 'b1', role: B, createdAt: at(1) },
      { id: 'e1', role: S, createdAt: at(30) },
      { id: 'c2', role: C, createdAt: at(32) },
    ]);
    await expect(rm.isHumanStaffEcho('r1', 'e1')).resolves.toBe(true);
  });

  it('ข้อความลูกค้าที่ถูกลบภายใน 5 วิไม่นับ → true', async () => {
    const rm = makeRoomManager([
      { id: 'c1', role: C, createdAt: at(0) },
      { id: 'b1', role: B, createdAt: at(1) },
      { id: 'cx', role: C, createdAt: at(28), deletedAt: at(29) },
      { id: 'e1', role: S, createdAt: at(30) },
    ]);
    await expect(rm.isHumanStaffEcho('r1', 'e1')).resolves.toBe(true);
  });

  it('ห้องไม่มีข้อความลูกค้าเลยและไม่มีใครรอ → true', async () => {
    const rm = makeRoomManager(
      [
        { id: 'b1', role: B, createdAt: at(1) },
        { id: 'e1', role: S, createdAt: at(30) },
      ],
      { waitingSince: null },
    );
    await expect(rm.isHumanStaffEcho('r1', 'e1')).resolves.toBe(true);
  });

  it('อ่านแถว echo ไม่ได้ → false (ห้องค้างในคิว = ทางปลอดภัย)', async () => {
    const rm = makeRoomManager([{ id: 'c1', role: C, createdAt: at(0) }]);
    await expect(rm.isHumanStaffEcho('r1', 'missing')).resolves.toBe(false);
  });
});

describe('RoomManagerService.confirmExternalEcho — ส่ง closeAsHuman ต่อ', () => {
  it('สวิตช์คิวงานแชทปิด → false และไม่เรียก response cycle', async () => {
    const responseCycles = {
      enabled: jest.fn().mockResolvedValue(false),
      confirmUnknownEcho: jest.fn(),
    };
    const rm = makeRoomManager([], { responseCycles });
    await expect(rm.confirmExternalEcho('e1', { closeAsHuman: true })).resolves.toBe(false);
    expect(responseCycles.confirmUnknownEcho).not.toHaveBeenCalled();
  });

  it('สวิตช์เปิด → true และส่ง closeAsHuman ต่อทั้งก้อน', async () => {
    const responseCycles = {
      enabled: jest.fn().mockResolvedValue(true),
      confirmUnknownEcho: jest.fn().mockResolvedValue(undefined),
    };
    const rm = makeRoomManager([], { responseCycles });
    await expect(rm.confirmExternalEcho('e1', { closeAsHuman: true })).resolves.toBe(true);
    expect(responseCycles.confirmUnknownEcho).toHaveBeenCalledWith('e1', { closeAsHuman: true });
  });

  it('ไม่ส่ง opts → ส่งต่อเป็นวัตถุว่าง (ไม่ปิดรอบ)', async () => {
    const responseCycles = {
      enabled: jest.fn().mockResolvedValue(true),
      confirmUnknownEcho: jest.fn().mockResolvedValue(undefined),
    };
    const rm = makeRoomManager([], { responseCycles });
    await rm.confirmExternalEcho('e1');
    expect(responseCycles.confirmUnknownEcho).toHaveBeenCalledWith('e1', {});
  });
});
