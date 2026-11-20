import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BulkUpsertOverpriceRulesDto } from './bulk-upsert-overprice-rules.dto';

const items = [{ series: 'iPhone 17', condition: 'HAND_1' }];
const check = (body: Record<string, unknown>) => {
  const dto = plainToInstance(BulkUpsertOverpriceRulesDto, { items, ...body });
  return { dto, errors: validateSync(dto) };
};

describe('BulkUpsertOverpriceRulesDto — null ไม่ลอดด่าน', () => {
  it('allowance: null → error', () => {
    expect(check({ allowance: null }).errors.length).toBeGreaterThan(0);
  });

  it('maxMonths: null → error (ห้ามเอาเพดานงวดออกโดยไม่ตั้งใจ)', () => {
    expect(check({ maxMonths: null }).errors.length).toBeGreaterThan(0);
  });

  it('minDownPct: null → ผ่าน และยังเป็น null (= ใช้ค่ากลาง)', () => {
    const { dto, errors } = check({ minDownPct: null });
    expect(errors).toHaveLength(0);
    expect(dto.minDownPct).toBeNull();
  });

  it('ไม่ส่งฟิลด์ค่า → ผ่าน (ไม่เปลี่ยน)', () => {
    expect(check({}).errors).toHaveLength(0);
  });

  it('ส่งครบถูกต้อง → ผ่าน', () => {
    expect(check({ allowance: 2000, maxMonths: 15, minDownPct: 30 }).errors).toHaveLength(0);
  });

  it('ค่านอกช่วง → error', () => {
    expect(check({ maxMonths: 0 }).errors.length).toBeGreaterThan(0);
    expect(check({ allowance: -1 }).errors.length).toBeGreaterThan(0);
  });
});
