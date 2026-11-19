import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateInterestConfigDto } from './interest-config.dto';

describe('UpdateInterestConfigDto — rates', () => {
  const check = (ratePct: number) =>
    validate(plainToInstance(UpdateInterestConfigDto, { rates: [{ months: 12, ratePct }] }));

  it('ปฏิเสธดอกเบี้ยรวม 0%', async () => {
    const errors = await check(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('ปฏิเสธค่าติดลบ', async () => {
    expect((await check(-0.1)).length).toBeGreaterThan(0);
  });

  it('ยอมรับ 0.5 (50%)', async () => {
    expect(await check(0.5)).toEqual([]);
  });
});
