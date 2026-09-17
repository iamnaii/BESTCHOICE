import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCustomerContactDto } from './skip-tracing.dto';

async function run(newPhone: unknown) {
  const dto = plainToInstance(UpdateCustomerContactDto, { newPhone, reason: 'ญาติให้เบอร์' });
  const errors = await validate(dto);
  return { dto, errors };
}

describe('UpdateCustomerContactDto.newPhone', () => {
  it('รับเบอร์ 10 หลักตามที่วิซาร์ดส่ง', async () => {
    const { dto, errors } = await run('0812345678');
    expect(errors).toHaveLength(0);
    expect(dto.newPhone).toBe('0812345678');
  });

  it.each(['081-234 5678', '+66812345678', '(081) 234-5678'])(
    'normalize %s ก่อนตรวจ',
    async (raw) => {
      const { dto, errors } = await run(raw);
      expect(errors).toHaveLength(0);
      expect(dto.newPhone).toBe('0812345678');
    },
  );

  it.each(['12345', '08123456789', 'abc', '   '])('ปฏิเสธ %s ด้วยข้อความไทย', async (raw) => {
    const { errors } = await run(raw);
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})).toContain(
      'เบอร์โทรต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0',
    );
  });

  it('ไม่ส่งเบอร์ = ผ่าน (optional)', async () => {
    const { errors } = await run(undefined);
    expect(errors).toHaveLength(0);
  });
});
