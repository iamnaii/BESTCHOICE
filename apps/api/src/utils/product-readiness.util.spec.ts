import { productReadinessWhere, evaluateReadiness } from './product-readiness.util';

describe('productReadinessWhere', () => {
  it('ใช้คีย์ AND อย่างเดียวที่ระดับบนสุด (ไม่ชนกับ where.OR ของ search)', () => {
    const w = productReadinessWhere() as Record<string, unknown>;
    expect(Object.keys(w)).toEqual(['AND']);
    expect(w).not.toHaveProperty('OR');
  });

  it('บังคับ IN_STOCK + ราคา > 0 + มีรูปขึ้นเว็บ + ไม่ถูกลบ + เปิดแสดง', () => {
    const and = (productReadinessWhere() as { AND: Record<string, unknown>[] }).AND;
    expect(and).toContainEqual({ deletedAt: null });
    expect(and).toContainEqual({ isOnlineVisible: true });
    expect(and).toContainEqual({ status: 'IN_STOCK' });
    expect(and).toContainEqual({ cashPrice: { gt: 0 } });
    expect(and).toContainEqual({ gallery: { isEmpty: false } });
  });

  it('กรอง [DEMO] แบบไม่ผูกกับ NODE_ENV', () => {
    const and = (productReadinessWhere() as { AND: Record<string, unknown>[] }).AND;
    expect(and).toContainEqual({ NOT: { name: { startsWith: '[DEMO]' } } });
  });

  it('มือสองต้องมีเกรด — ห่ออยู่ใน AND ไม่ใช่ OR ระดับบนสุด และใช้ชุดเกรดเดียวกับ checklist', () => {
    const and = (productReadinessWhere() as { AND: Record<string, unknown>[] }).AND;
    expect(and).toContainEqual({
      OR: [
        { category: { not: 'PHONE_USED' } },
        { conditionGrade: { in: ['A', 'B', 'C', 'D'] } },
      ],
    });
  });

  it('requireInStock:false ตัดเฉพาะเงื่อนไขสถานะ (permalink เครื่องที่ขายแล้ว)', () => {
    const and = (productReadinessWhere({ requireInStock: false }) as { AND: Record<string, unknown>[] }).AND;
    expect(and).not.toContainEqual({ status: 'IN_STOCK' });
    expect(and).toContainEqual({ cashPrice: { gt: 0 } });
  });
});

describe('evaluateReadiness', () => {
  const ok = {
    name: 'iPhone 15 128GB',
    brand: 'Apple',
    category: 'PHONE_NEW',
    status: 'IN_STOCK',
    cashPrice: '28900',
    gallery: ['https://cdn/x.jpg'],
    conditionGrade: null,
    isOnlineVisible: true,
    deletedAt: null,
  };

  it('ครบทุกข้อ → ready = true', () => {
    const r = evaluateReadiness(ok as never);
    expect(r.ready).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it('ไม่มีราคา → ไม่ ready และมี check ราคาเป็น false', () => {
    const r = evaluateReadiness({ ...ok, cashPrice: null } as never);
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.key === 'cashPrice')?.ok).toBe(false);
  });

  it('มือสองไม่มีเกรด → ไม่ ready', () => {
    const r = evaluateReadiness({ ...ok, category: 'PHONE_USED', conditionGrade: null } as never);
    expect(r.checks.find((c) => c.key === 'conditionGrade')?.ok).toBe(false);
    expect(r.ready).toBe(false);
  });

  // ปักหมุดความสอดคล้อง where ↔ checklist: เกรดที่เป็นช่องว่าง/ค่านอกชุด ต้องไม่ผ่านทั้งคู่
  it('มือสองเกรดเป็นช่องว่างหรือค่านอกชุด A-D → ไม่ ready (ตรงกับ where ที่ใช้ in [A,B,C,D])', () => {
    for (const grade of [' ', '', 'ก', 'E']) {
      const r = evaluateReadiness({ ...ok, category: 'PHONE_USED', conditionGrade: grade } as never);
      expect(r.checks.find((c) => c.key === 'conditionGrade')?.ok).toBe(false);
      expect(r.ready).toBe(false);
    }
  });

  it('แบรนด์นอก shop gate → เตือนว่าเว็บไม่รับ', () => {
    const r = evaluateReadiness({ ...ok, brand: 'Samsung' } as never);
    expect(r.checks.find((c) => c.key === 'shopGate')?.ok).toBe(false);
    expect(r.checks.find((c) => c.key === 'shopGate')?.hint).toContain('iPhone');
  });

  it('ชื่อขึ้นต้น [DEMO] → ไม่ ready', () => {
    const r = evaluateReadiness({ ...ok, name: '[DEMO] iPhone 15' } as never);
    expect(r.checks.find((c) => c.key === 'notDemo')?.ok).toBe(false);
  });
});
