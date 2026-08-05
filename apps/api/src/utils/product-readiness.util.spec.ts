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

  // [Important 1, mutation ก] structural-echo fix: เดิม `toContainEqual` แยกทีละตัว
  // ไม่เคยตรวจ `brand`/`category` เลย — ลบ `{brand:'Apple'}` ออกจาก fragment เทสต์เขียวหมด
  // ทั้งที่นี่คือ shop gate ("ขายเฉพาะ iPhone") ที่ Task 11 จะฝัง 7+ จุด ใช้ `toEqual` กับ
  // array เต็มแทน — mutation ไหนก็ตามที่ลบ/แก้สมาชิกจะทำให้เทสต์นี้แดงทันที
  it('default AND ครบทุกสมาชิกตามลำดับ (mutation-proof — ตรวจ brand/category ที่เคยไม่มีเทสต์คลุม)', () => {
    const and = (productReadinessWhere() as { AND: Record<string, unknown>[] }).AND;
    expect(and).toEqual([
      { deletedAt: null },
      { isOnlineVisible: true },
      { status: 'IN_STOCK' },
      { brand: 'Apple' },
      { category: { in: ['PHONE_NEW', 'PHONE_USED'] } },
      { cashPrice: { gt: 0 } },
      { gallery: { isEmpty: false } },
      {
        OR: [
          { category: { not: 'PHONE_USED' } },
          { conditionGrade: { in: ['A', 'B', 'C', 'D'] } },
        ],
      },
    ]);
  });

  it('default excludeDemo:false → ไม่กรอง [DEMO] (owner decision: prod มีแต่ [DEMO] ที่ข้อมูลครบ ต้องยังโชว์จนกว่าจะเปิด flag)', () => {
    const and = (productReadinessWhere() as { AND: Record<string, unknown>[] }).AND;
    expect(and).not.toContainEqual({ NOT: { name: { startsWith: '[DEMO]' } } });
  });

  it('excludeDemo:true → กรอง [DEMO] แบบไม่ผูกกับ NODE_ENV', () => {
    const and = (productReadinessWhere({ excludeDemo: true }) as { AND: Record<string, unknown>[] }).AND;
    expect(and).toContainEqual({ NOT: { name: { startsWith: '[DEMO]' } } });
  });

  it('มือสองต้องมีเกรด — ห่ออยู่ใน AND ไม่ใช่ OR ระดับบนสุด และใช้ชุดเกรดเดียวกับ checklist (compose ถูกทั้งกับ excludeDemo true/false)', () => {
    const nested = {
      OR: [
        { category: { not: 'PHONE_USED' } },
        { conditionGrade: { in: ['A', 'B', 'C', 'D'] } },
      ],
    };
    expect((productReadinessWhere() as { AND: Record<string, unknown>[] }).AND).toContainEqual(nested);
    expect(
      (productReadinessWhere({ excludeDemo: true }) as { AND: Record<string, unknown>[] }).AND,
    ).toContainEqual(nested);
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

  it('ครบทุกข้อ → ready = true, isDemo = false, ไม่มี entry isDemo ใน checks (non-demo)', () => {
    const r = evaluateReadiness(ok as never);
    expect(r.ready).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.isDemo).toBe(false);
    expect(r.checks.find((c) => c.key === 'isDemo')).toBeUndefined();
  });

  it('ไม่มีราคา → ไม่ ready และมี check ราคาเป็น false', () => {
    const r = evaluateReadiness({ ...ok, cashPrice: null } as never);
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.key === 'cashPrice')?.ok).toBe(false);
  });

  it('มือสองไม่มีเกรด → ไม่ ready + hint แนะนำวิธีแก้ (Minor fix: hint อยู่ฝั่งตกไม่ใช่ฝั่งผ่าน)', () => {
    const r = evaluateReadiness({ ...ok, category: 'PHONE_USED', conditionGrade: null } as never);
    expect(r.checks.find((c) => c.key === 'conditionGrade')?.ok).toBe(false);
    expect(r.checks.find((c) => c.key === 'conditionGrade')?.hint).toContain('ตั้งเกรดได้');
    expect(r.ready).toBe(false);
  });

  it('มือ 1 (ไม่บังคับเกรด) → conditionGrade ok:true และไม่มี hint', () => {
    const r = evaluateReadiness(ok as never);
    expect(r.checks.find((c) => c.key === 'conditionGrade')?.ok).toBe(true);
    expect(r.checks.find((c) => c.key === 'conditionGrade')?.hint).toBeUndefined();
  });

  // ปักหมุดความสอดคล้อง where ↔ checklist: เกรดที่เป็นช่องว่าง/ค่านอกชุด ต้องไม่ผ่านทั้งคู่
  it('มือสองเกรดเป็นช่องว่างหรือค่านอกชุด A-D → ไม่ ready (ตรงกับ where ที่ใช้ in [A,B,C,D])', () => {
    for (const grade of [' ', '', 'ก', 'E']) {
      const r = evaluateReadiness({ ...ok, category: 'PHONE_USED', conditionGrade: grade } as never);
      expect(r.checks.find((c) => c.key === 'conditionGrade')?.ok).toBe(false);
      expect(r.ready).toBe(false);
    }
  });

  // [Important 1, mutation ข] เดิมมีแต่เคส negative (ค่านอกชุด) — ไม่มีเคสยืนยันว่า A/B/C/D
  // ทั้ง 4 ค่าผ่านจริง ถ้า evaluateReadiness แอบหด VALID_CONDITION_GRADES เหลือ ['A'] เฉพาะ
  // ฝั่งนี้ (drift จาก where ที่ยังใช้ 4 ค่า) เทสต์เดิมเขียวหมดเพราะไม่มีใครทดสอบ B/C/D
  it.each(['A', 'B', 'C', 'D'])('มือสองเกรด %s (ถูกต้องตามชุด VALID_CONDITION_GRADES) → ready:true', (grade) => {
    const r = evaluateReadiness({ ...ok, category: 'PHONE_USED', conditionGrade: grade } as never);
    expect(r.checks.find((c) => c.key === 'conditionGrade')?.ok).toBe(true);
    expect(r.ready).toBe(true);
  });

  it('แบรนด์นอก shop gate → เตือนว่าเว็บไม่รับ', () => {
    const r = evaluateReadiness({ ...ok, brand: 'Samsung' } as never);
    expect(r.checks.find((c) => c.key === 'shopGate')?.ok).toBe(false);
    expect(r.checks.find((c) => c.key === 'shopGate')?.hint).toContain('iPhone');
  });

  it('ชื่อขึ้นต้น [DEMO] → isDemo:true, entry isDemo severity:info ไม่ทำให้ ready เป็น false (owner decision: default โชว์ [DEMO] จนกว่าจะเปิด flag)', () => {
    const r = evaluateReadiness({ ...ok, name: '[DEMO] iPhone 15' } as never);
    expect(r.isDemo).toBe(true);
    expect(r.ready).toBe(true);
    const demoCheck = r.checks.find((c) => c.key === 'isDemo');
    expect(demoCheck?.ok).toBe(true);
    expect(demoCheck?.severity).toBe('info');
    expect(demoCheck?.hint).toContain('[DEMO]');
  });

  // [Important 2] severity marker ต้องตรงประเภทจริง — 7 blocking checks ต้องเป็น 'blocking'
  // เสมอ (ไม่ใช่แค่ isDemo ที่เป็น 'info') กันสับสนตอน B1 render แยกสไตล์ตาม severity
  it('checks ทุกตัวที่ไม่ใช่ isDemo ต้องมี severity:blocking', () => {
    const r = evaluateReadiness({ ...ok, name: '[DEMO] iPhone 15' } as never);
    const blockingKeys = [
      'notDeleted',
      'shopGate',
      'inStock',
      'cashPrice',
      'gallery',
      'conditionGrade',
      'isOnlineVisible',
    ];
    for (const key of blockingKeys) {
      expect(r.checks.find((c) => c.key === key)?.severity).toBe('blocking');
    }
  });

  // [Important 1, mutation ค] เดิมพลิก ok:true ให้ notDeleted/inStock/gallery/isOnlineVisible
  // (4 ตัวที่ไม่เคยมีเคสทดสอบแยก) → เทสต์เขียวหมด เพราะไม่มีเคสไหนพัง "เฉพาะ" ฟิลด์เหล่านี้
  // table-driven: product ผ่านทุกอย่าง แล้วพังทีละ 1 ฟิลด์ ครบทั้ง 7 blocking check
  describe('table-driven — พังทีละ 1 ฟิลด์ (mutation-proof, ครอบคลุมทั้ง 7 blocking check)', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['notDeleted', { deletedAt: new Date('2026-01-01') }],
      ['shopGate', { brand: 'Samsung' }],
      ['inStock', { status: 'RESERVED' }],
      ['cashPrice', { cashPrice: null }],
      ['gallery', { gallery: [] }],
      ['conditionGrade', { category: 'PHONE_USED', conditionGrade: null }],
      ['isOnlineVisible', { isOnlineVisible: false }],
    ];

    it.each(cases)('พังฟิลด์ของ check "%s" เท่านั้น → check นั้น ok:false และ ready:false', (key, patch) => {
      const r = evaluateReadiness({ ...ok, ...patch } as never);
      expect(r.checks.find((c) => c.key === key)?.ok).toBe(false);
      expect(r.ready).toBe(false);
    });
  });
});
