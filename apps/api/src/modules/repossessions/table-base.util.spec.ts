import { lookupTableBase } from './table-base.util';

describe('lookupTableBase', () => {
  const svc = () => ({ lookupValuation: jest.fn() });

  it('found → คืน grade/found/suggestedPrice/note จากตารางรับซื้อ และเรียกด้วย storage ที่ให้', async () => {
    const valuation = svc();
    valuation.lookupValuation.mockResolvedValue({
      found: true,
      suggestedPrice: 8000,
      brand: 'Apple',
      model: 'iPhone 14',
      storage: '128GB',
      condition: 'B',
      note: 'จอเดิม',
    });
    const hint = await lookupTableBase(
      valuation as never,
      { brand: 'Apple', model: 'iPhone 14', storage: '128GB' },
      'B',
    );
    expect(hint).toEqual({ grade: 'B', found: true, suggestedPrice: 8000, note: 'จอเดิม' });
    expect(valuation.lookupValuation).toHaveBeenCalledWith('Apple', 'iPhone 14', '128GB', 'B');
  });

  it('ไม่มีในตาราง → found=false, suggestedPrice=null; storage null → ส่ง ""', async () => {
    const valuation = svc();
    valuation.lookupValuation.mockResolvedValue({
      found: false,
      suggestedPrice: null,
      brand: 'X',
      model: 'Y',
      storage: '',
      condition: 'C',
      note: null,
    });
    const hint = await lookupTableBase(
      valuation as never,
      { brand: 'X', model: 'Y', storage: null },
      'C',
    );
    expect(hint).toEqual({ grade: 'C', found: false, suggestedPrice: null, note: null });
    expect(valuation.lookupValuation).toHaveBeenCalledWith('X', 'Y', '', 'C');
  });

  it('ไม่มี brand/model → null โดยไม่ query', async () => {
    const valuation = svc();
    expect(await lookupTableBase(valuation as never, { brand: '', model: 'Y' }, 'A')).toBeNull();
    expect(valuation.lookupValuation).not.toHaveBeenCalled();
  });

  it('lookup ล้มเหลว → null (ตารางเป็นตัวช่วย ไม่ใช่ด่าน — ห้ามล้มการยึด/รับคืน)', async () => {
    const valuation = svc();
    valuation.lookupValuation.mockRejectedValue(new Error('db down'));
    expect(await lookupTableBase(valuation as never, { brand: 'X', model: 'Y' }, 'A')).toBeNull();
  });
});
