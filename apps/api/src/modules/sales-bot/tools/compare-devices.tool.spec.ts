import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompareDevicesTool } from './compare-devices.tool';
import { TRADE_IN_NOTE } from './trade-in-estimate';

const makePrisma = (valuations: { storage: string; basePrice: Prisma.Decimal }[] = []) => {
  const tradeInValuation = { findMany: jest.fn().mockResolvedValue(valuations) };
  return { prisma: { tradeInValuation } as unknown as PrismaService, tradeInValuation };
};

describe('CompareDevicesTool.run', () => {
  it('รู้จักทั้งคู่ → ประโยค better/same/worse จาก compareDevices + generationGap + tradeIn ของเครื่องเดิม', async () => {
    const { prisma, tradeInValuation } = makePrisma([
      { storage: '64GB', basePrice: new Prisma.Decimal('3500') },
      { storage: '128GB', basePrice: new Prisma.Decimal('4000') },
    ]);
    const tool = new CompareDevicesTool(prisma);
    const r = await tool.run({ currentModel: 'ใช้ 12 อยู่', candidateModel: '15' });

    expect(r.current).toEqual({ model: 'iPhone 12', recognized: true });
    expect(r.candidate).toEqual({ model: 'iPhone 15', recognized: true });
    expect(r.generationGap).toBe(3);
    // 12 (A14, 12MP, OLED, 5G, Lightning) → 15 (A16, 48MP, USB-C, Dynamic Island) — ข้อเด่นสูงสุด ≤3 + iOS note
    expect(r.better.length).toBeGreaterThanOrEqual(3);
    expect(r.better.join(' ')).toContain('48MP');
    expect(r.better.join(' ')).toContain('A16');
    // ประโยคจาก tool ต้องไม่ขึ้นต้นด้วย emoji (กฎ BASE จำกัด emoji)
    expect(r.better.every((t) => /^[\p{L}\p{N}]/u.test(t))).toBe(true);
    expect(r.better[r.better.length - 1]).toContain('iOS');
    expect(r.same).toContain('จอขนาด 6.1" เท่าเดิม');
    expect(r.worse).toEqual([]);
    // ไม่มีราคาเครื่องในผลลัพธ์ — มีแค่ราคาเทิร์น (เกรด A, max เมื่อไม่บอกความจุ)
    expect(r.tradeIn).toEqual({ model: 'iPhone 12', estimateThb: 3500, note: TRADE_IN_NOTE }); // ไม่บอกความจุ → ราคาความจุต่ำสุด
    expect(tradeInValuation.findMany.mock.calls[0][0].where).toMatchObject({
      OR: [{ model: { equals: 'iPhone 12', mode: 'insensitive' } }],
      condition: 'A',
      deletedAt: null,
    });
    expect(Object.keys(r).sort()).toEqual(
      ['better', 'candidate', 'current', 'generationGap', 'same', 'tradeIn', 'worse'].sort(),
    );
  });

  it('ไม่รู้จักรุ่นใดรุ่นหนึ่ง → recognized:false, arrays ว่าง, generationGap null, ไม่ยิง query เทิร์น', async () => {
    const { prisma, tradeInValuation } = makePrisma([
      { storage: '128GB', basePrice: new Prisma.Decimal('4000') },
    ]);
    const tool = new CompareDevicesTool(prisma);

    // candidate ไม่รู้จัก (รุ่นไม่มีจริง) — current รู้จัก → tradeIn ยังคืนได้
    const r1 = await tool.run({ currentModel: 'iPhone 12', candidateModel: '14 mini' });
    expect(r1.current.recognized).toBe(true);
    expect(r1.candidate).toEqual({ model: '14 mini', recognized: false });
    expect(r1.better).toEqual([]);
    expect(r1.same).toEqual([]);
    expect(r1.worse).toEqual([]);
    expect(r1.generationGap).toBeNull();
    expect(r1.tradeIn?.estimateThb).toBe(4000);

    // current ไม่รู้จัก → ไม่มี diff และไม่มีราคาเทิร์น (ไม่ query)
    tradeInValuation.findMany.mockClear();
    const r2 = await tool.run({ currentModel: 'Galaxy S21', candidateModel: 'iPhone 15' });
    expect(r2.current).toEqual({ model: 'Galaxy S21', recognized: false });
    expect(r2.candidate).toEqual({ model: 'iPhone 15', recognized: true });
    expect(r2.better).toEqual([]);
    expect(r2.generationGap).toBeNull();
    expect(r2.tradeIn).toBeNull();
    expect(tradeInValuation.findMany).not.toHaveBeenCalled();
  });
});
