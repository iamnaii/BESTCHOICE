import {
  evaluateSlipChecks,
  slipFingerprint,
  slipPaymentDate,
  type SlipReading,
} from './slip-checks';

describe('slip-checks — กติกา 5 ข้อก่อนปิดยอดโดยไม่ต้องอนุมัติ', () => {
  const now = new Date('2026-09-24T05:00:00.000Z'); // 12:00 น. ไทย
  const good: SlipReading = {
    isSlip: true,
    amount: 18135.85,
    refNo: '2026092318425510',
    bankName: 'KBANK',
    date: '2026-09-23',
    time: '14:32',
    toAccount: '203-1-16520-5',
    confidence: 0.97,
  };
  const company = (a: string | null | undefined) => (a ?? '').replace(/\D/g, '') === '2031165205';
  const run = (
    reading: SlipReading | null,
    over: Partial<Parameters<typeof evaluateSlipChecks>[0]> = {},
  ) =>
    evaluateSlipChecks({
      reading,
      expectedAmount: 18135.85,
      isCompanyAccount: company,
      reused: false,
      now,
      ...over,
    });
  const okMap = (checks: ReturnType<typeof evaluateSlipChecks>) =>
    Object.fromEntries(checks.map((c) => [c.code, c.ok]));

  it('สลิปดีผ่านครบ 5 ข้อ (ลำดับคงที่)', () => {
    const checks = run(good);
    expect(checks.map((c) => c.code)).toEqual([
      'READABLE',
      'AMOUNT_MATCH',
      'COMPANY_ACCOUNT',
      'NOT_REUSED',
      'DATE_VALID',
    ]);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it('ยอดต่าง 0.01 ผ่าน · ต่าง 0.02 ไม่ผ่านพร้อมบอกส่วนต่าง', () => {
    expect(okMap(run({ ...good, amount: 18135.84 })).AMOUNT_MATCH).toBe(true);
    const short = run({ ...good, amount: 18000 });
    expect(okMap(short).AMOUNT_MATCH).toBe(false);
    expect(short.find((c) => c.code === 'AMOUNT_MATCH')?.detail).toContain('ขาดอีก 135.85');
    expect(
      run({ ...good, amount: 18200 }).find((c) => c.code === 'AMOUNT_MATCH')?.detail,
    ).toContain('เกินยอดปิด 64.15');
  });

  it('อ่านไม่ได้ (null) / ไม่ใช่สลิป / ความมั่นใจต่ำกว่า 0.9 → READABLE ไม่ผ่านและข้ออื่นไม่ผ่านตาม', () => {
    for (const reading of [null, { ...good, isSlip: false }, { ...good, confidence: 0.89 }]) {
      const m = okMap(run(reading));
      expect(m.READABLE).toBe(false);
      expect(m.AMOUNT_MATCH).toBe(false);
      expect(m.COMPANY_ACCOUNT).toBe(false);
      expect(m.NOT_REUSED).toBe(false);
    }
    expect(run(null)[0].detail).toContain('ไม่พร้อม');
  });

  it('บัญชีปลายทางไม่ใช่ของบริษัท หรืออ่านไม่ได้ → COMPANY_ACCOUNT ไม่ผ่าน (fail-closed)', () => {
    expect(okMap(run({ ...good, toAccount: '579-4-13208-8' })).COMPANY_ACCOUNT).toBe(false);
    expect(okMap(run({ ...good, toAccount: null })).COMPANY_ACCOUNT).toBe(false);
  });

  it('สลิปเคยใช้ → NOT_REUSED ไม่ผ่าน', () => {
    expect(okMap(run(good, { reused: true })).NOT_REUSED).toBe(false);
  });

  it('วันที่อนาคตไม่ผ่าน · วันนี้ผ่าน · อ่านวันที่ไม่ได้ผ่านแต่บอกว่าจะใช้วันนี้', () => {
    expect(okMap(run({ ...good, date: '2026-09-25', time: '09:00' })).DATE_VALID).toBe(false);
    expect(okMap(run({ ...good, date: '2026-09-24', time: '09:00' })).DATE_VALID).toBe(true);
    const unreadable = run({ ...good, date: null });
    expect(okMap(unreadable).DATE_VALID).toBe(true);
    expect(unreadable.find((c) => c.code === 'DATE_VALID')?.detail).toContain('ใช้วันนี้');
  });

  it('slipPaymentDate: วันในสลิป (เวลาไทย) เมื่ออ่านได้และไม่เป็นอนาคต ไม่งั้น now', () => {
    expect(slipPaymentDate(good, now).toISOString()).toBe('2026-09-23T07:32:00.000Z');
    expect(slipPaymentDate({ ...good, date: null }, now)).toBe(now);
    expect(slipPaymentDate({ ...good, date: '2026-09-25' }, now)).toBe(now);
  });

  it('slipFingerprint: สูตรเดียวกับบอท (refNo|amount|BANK|date) · ไม่มี refNo ใช้ key ของรูป', () => {
    const a = slipFingerprint(good, 'k1');
    expect(a).toBe(slipFingerprint({ ...good, bankName: 'kbank' }, 'k2')); // ตัวพิมพ์ธนาคารไม่มีผล · key ไม่มีผลเมื่อมี refNo
    expect(a).not.toBe(slipFingerprint({ ...good, amount: 18135.86 }, 'k1'));
    expect(slipFingerprint({ ...good, refNo: null }, 'k1')).not.toBe(
      slipFingerprint({ ...good, refNo: null }, 'k2'),
    );
  });
});
