import { tokenizeThai, scoreKbEntries } from './kb-match.util';

const entry = (over: Record<string, unknown> = {}) => ({
  intent: 'late_fee',
  category: 'billing',
  responseTemplate: 'ค่าปรับ 50 บาท/วัน',
  responseType: 'auto',
  triggerKeywords: ['ค่าปรับ', 'ปรับล่าช้า'],
  exampleQuestions: ['ค่าปรับวันละเท่าไหร่'],
  priority: 5,
  ...over,
});

describe('tokenizeThai', () => {
  it('ตัดคำตามช่องว่าง/เครื่องหมาย และทิ้ง token สั้นกว่า 2 ตัว', () => {
    expect(tokenizeThai('ค่าปรับ ล่าช้า a')).toEqual(
      expect.arrayContaining(['ค่าปรับ', 'ล่าช้า']),
    );
    expect(tokenizeThai('ค่าปรับ ล่าช้า a')).not.toContain('a');
  });

  it('แยกคำที่ติดหางอนุภาคไทย (ครับ/ค่ะ/ไหม)', () => {
    expect(tokenizeThai('ค่าปรับเท่าไหร่ครับ')).toEqual(expect.arrayContaining(['ค่าปรับเท่าไหร่']));
  });
});

describe('scoreKbEntries', () => {
  it('คำถามตรง keyword ได้คะแนนสูงสุด', () => {
    const r = scoreKbEntries('ค่าปรับล่าช้า', [entry(), entry({ intent: 'other', triggerKeywords: ['สาขา'] })]);
    expect(r[0].intent).toBe('late_fee');
  });

  it('คำถามว่าง → ไม่มีผลลัพธ์', () => {
    expect(scoreKbEntries('   ', [entry()])).toEqual([]);
  });

  it('ไม่ตรงอะไรเลย → คัดออก (score = 0)', () => {
    expect(scoreKbEntries('ซื้อไอโฟน', [entry()])).toEqual([]);
  });

  it('จำกัดจำนวนผลลัพธ์ตาม take (ค่าเริ่มต้น 3)', () => {
    const many = Array.from({ length: 6 }, (_, i) => entry({ intent: `i${i}` }));
    expect(scoreKbEntries('ค่าปรับ', many)).toHaveLength(3);
    expect(scoreKbEntries('ค่าปรับ', many, 5)).toHaveLength(5);
  });

  it('คืนเฉพาะฟิลด์ที่ปลอดภัยส่งให้โมเดล (ไม่มี id/ช่องทาง)', () => {
    const r = scoreKbEntries('ค่าปรับ', [entry()]);
    expect(Object.keys(r[0]).sort()).toEqual(
      ['category', 'intent', 'responseTemplate', 'responseType', 'score'].sort(),
    );
  });
});
