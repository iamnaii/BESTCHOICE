import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateInterestConfigDto, UpdateInterestConfigDto } from './interest-config.dto';

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

describe('ดอกเบี้ยต่อเดือน 0 (ใช้ตารางรายงวดอย่างเดียว) — ปักพฤติกรรมเดิมของ DTO', () => {
  it('CreateInterestConfigDto รับ interestRate 0 พร้อมแถวรายงวด', async () => {
    const dto = plainToInstance(CreateInterestConfigDto, {
      name: 'มือถือมือ 1',
      productCategories: ['PHONE_NEW'],
      interestRate: 0,
      minDownPaymentPct: 0.15,
      minInstallmentMonths: 6,
      maxInstallmentMonths: 12,
      rates: [
        { months: 10, ratePct: 0.5 },
        { months: 12, ratePct: 0.5 },
      ],
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('UpdateInterestConfigDto รับ interestRate 0', async () => {
    expect(await validate(plainToInstance(UpdateInterestConfigDto, { interestRate: 0 }))).toEqual([]);
  });

  it('ยังปฏิเสธค่าติดลบ', async () => {
    expect((await validate(plainToInstance(UpdateInterestConfigDto, { interestRate: -0.01 }))).length).toBeGreaterThan(0);
  });
});
