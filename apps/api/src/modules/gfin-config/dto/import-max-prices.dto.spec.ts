import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ImportMaxPricesDto } from './import-max-prices.dto';

const errorsFor = (items: unknown[]) =>
  validate(plainToInstance(ImportMaxPricesDto, { items }));
const ok = { model: 'iPhone 15', storage: '128GB', condition: 'HAND_1', maxPrice: 20000 };

describe('ImportMaxPricesDto', () => {
  it('รับแถวปกติ', async () => {
    expect(await errorsFor([ok])).toHaveLength(0);
  });
  it('ปฏิเสธชื่อรุ่นที่เป็นช่องว่างล้วน', async () => {
    expect((await errorsFor([{ ...ok, model: '   ' }])).length).toBeGreaterThan(0);
  });
  it('ปฏิเสธความจุที่เป็นช่องว่างล้วน', async () => {
    expect((await errorsFor([{ ...ok, storage: '  ' }])).length).toBeGreaterThan(0);
  });
  it('ปฏิเสธรายการว่าง', async () => {
    const errs = await errorsFor([]);
    expect(errs.length).toBeGreaterThan(0);
    expect(JSON.stringify(errs)).toContain('ใบราคาต้องมีอย่างน้อย 1 แถว');
  });
});
