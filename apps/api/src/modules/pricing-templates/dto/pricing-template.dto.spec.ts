import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePricingTemplateDto, UpdatePricingTemplateDto } from './pricing-template.dto';

describe('pricing template DTOs accept null rate fields', () => {
  it('CreatePricingTemplateDto: null rate1/rate2 term+down and omitted storage pass', async () => {
    const dto = plainToInstance(CreatePricingTemplateDto, {
      brand: 'Apple',
      model: 'iPhone 15',
      category: 'PHONE_NEW',
      hasWarranty: false,
      cashPrice: 25900,
      installmentBestchoicePrice: 25900,
      installmentFinancePrice: 25900,
      rate1TermMonths: null,
      rate1DownPayment: null,
      rate2TermMonths: null,
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('UpdatePricingTemplateDto: edit form sends null to clear every rate field', async () => {
    const dto = plainToInstance(UpdatePricingTemplateDto, {
      cashPrice: 1,
      installmentBestchoicePrice: 1,
      installmentFinancePrice: 1,
      rate1DownPayment: null,
      rate1TermMonths: null,
      rate2DownPayment: null,
      rate2TermMonths: null,
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('still rejects a non-integer or zero term', async () => {
    const dto = plainToInstance(UpdatePricingTemplateDto, { rate1TermMonths: 0 });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
