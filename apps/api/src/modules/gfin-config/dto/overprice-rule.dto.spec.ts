import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateOverpriceRuleDto, UpdateOverpriceRuleDto } from './overprice-rule.dto';

const base = { label: 'iPhone 17 มือ 1', seriesPattern: 'iPhone 17', condition: 'HAND_1', allowance: 2000 };

describe('OverpriceRule DTO — minDownPct (ดาวน์ขั้นต่ำ % ของกลุ่มรุ่น)', () => {
  it.each([undefined, null, 0, 30, 80])('รับ %p', (minDownPct) => {
    expect(validateSync(plainToInstance(CreateOverpriceRuleDto, { ...base, minDownPct }))).toHaveLength(0);
    expect(validateSync(plainToInstance(UpdateOverpriceRuleDto, { minDownPct }))).toHaveLength(0);
  });

  it.each([-1, 81, 30.5])('ปฏิเสธ %p', (minDownPct) => {
    expect(validateSync(plainToInstance(CreateOverpriceRuleDto, { ...base, minDownPct })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(UpdateOverpriceRuleDto, { minDownPct })).length).toBeGreaterThan(0);
  });
});
