import {
  LEGACY_LINK_DUNNING_GRACE_DAYS,
  findContractsInLegacyLinkGrace,
  inLegacyLinkGraceWhere,
  legacyLinkGraceCutoff,
} from './legacy-link-grace';

describe('legacy-link-grace — Task 30 ข้อ 2', () => {
  const now = new Date('2026-12-05T03:00:00Z');

  it('ช่วงผ่อนผัน = 7 วัน (ค่าคงที่ที่เดียว) · ครบ 7 × 24 ชม. = พ้นช่วง', () => {
    expect(LEGACY_LINK_DUNNING_GRACE_DAYS).toBe(7);
    expect(legacyLinkGraceCutoff(now)).toEqual(new Date('2026-11-28T03:00:00Z'));
  });

  it('เงื่อนไข: สัญญานำเข้า + ยังผูก LINE การเงินอยู่ + ผูกครั้งแรกหลังจุดตัด (รอบ 2 ข้อ 4 — แถว FINANCE ทุกสถานะ ไม่มีแถวไหนผูก/สร้างตั้งแต่จุดตัดลงไป)', () => {
    const cutoff = new Date('2026-11-28T03:00:00Z');
    expect(inLegacyLinkGraceWhere(now)).toEqual({
      legacyContractCode: { not: null },
      customer: {
        lineLinks: {
          some: { channel: 'FINANCE', unlinkedAt: null, deletedAt: null },
          // ผูกซ้ำ/ผูกกลับตั้ง linkedAt ใหม่ แต่ createdAt ของแถวคือเวลาผูกครั้งแรก — ไม่กรอง unlinkedAt/deletedAt (นับแถวที่ปิดแล้วด้วย)
          none: {
            channel: 'FINANCE',
            OR: [{ linkedAt: { lte: cutoff } }, { createdAt: { lte: cutoff } }],
          },
        },
      },
    });
  });

  it('ชุดว่าง / id ว่าง → ไม่ query', async () => {
    const prisma = { contract: { findMany: jest.fn() } };
    await expect(
      findContractsInLegacyLinkGrace(prisma as never, [undefined, null, ''], now),
    ).resolves.toEqual(new Set());
    expect(prisma.contract.findMany).not.toHaveBeenCalled();
  });

  it('query เดียวต่อชุด (ตัด id ซ้ำ) → คืนชุด id ที่อยู่ในช่วง', async () => {
    const prisma = { contract: { findMany: jest.fn().mockResolvedValue([{ id: 'k1' }]) } };
    const result = await findContractsInLegacyLinkGrace(prisma as never, ['k1', 'k2', 'k1'], now);
    expect(result).toEqual(new Set(['k1']));
    expect(prisma.contract.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.contract.findMany.mock.calls[0][0].where.id).toEqual({ in: ['k1', 'k2'] });
  });
});
